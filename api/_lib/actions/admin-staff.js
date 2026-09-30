'use strict';
/* CRUD de atendentes (somente admin) + FOTO DE PERFIL
   GET    /api/admin?section=staff
   POST   /api/admin?section=staff
   PUT    /api/admin?section=staff&id=...
   DELETE /api/admin?section=staff&id=...

   A foto é enviada como dataURL já redimensionada no navegador,
   validada por magic bytes e salva no Supabase Storage.             */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  clean, cleanPhone, isDataImage
} = require('../http');
const { requireAdmin, logAction } = require('../auth');
const { uploadAsset } = require('../db');
const { decodeDataUrl, extOf } = require('../image');

const ID = (v) => /^[0-9a-f-]{10,64}$/i.test(String(v || ''));

async function savePhoto(ctx, staffId, dataUrl) {
  const img = decodeDataUrl(dataUrl);
  if (!img) return { error: 'Imagem inválida ou grande demais (máx. 800KB)' };
  const path = `tenants/${ctx.tenant.id}/staff/${staffId}.${extOf(img.mime)}?v=${Date.now()}`;
  const url = await uploadAsset(path, img.buffer, img.mime);
  return { url };
}

function row(r) {
  return {
    id: r.id, name: r.name, role: r.role, photo: r.photo_url || null,
    phone: r.phone || '', whatsapp_ready: !!r.whatsapp_ready, active: r.active
  };
}

module.exports = handler(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET') {
    if (!methodGuard(res, req, ['GET'])) return;
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.db.from('staff')
      .select('*').eq('tenant_id', ctx.tenantId)
      .order('sort_order').order('created_at');
    if (error) return fail(res, 500, 'Erro ao listar equipe');
    ok(res, { staff: (data || []).map(row) });
    return;
  }

  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);
  const wait = limit(req, 'admin-staff', 60, 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const b = await readBody(req, 900000);

  const name = clean(b.name, 80);
  const role = clean(b.role, 60) || 'Profissional';
  const phone = clean(b.phone, 24);
  if (name.length < 2) return fail(res, 400, 'Informe o nome do profissional');
  if (phone && cleanPhone(phone).length < 10) return fail(res, 400, 'Telefone inválido');
  if (b.photo !== undefined && b.photo !== null && !isDataImage(b.photo) && b.photo !== '') {
    return fail(res, 400, 'Imagem inválida');
  }

  if (method === 'POST') {
    if (!methodGuard(res, req, ['POST'])) return;
    const { data: created, error } = await ctx.db.from('staff').insert({
      tenant_id: ctx.tenantId, name, role, phone,
      whatsapp_ready: !!b.whatsapp_ready, active: true
    }).select('*').single();
    if (error) { console.error('[staff]', error); return fail(res, 500, 'Não foi possível criar'); }

    if (b.photo) {
      const up = await savePhoto(ctx, created.id, b.photo);
      if (up.error) return fail(res, 400, up.error);
      await ctx.db.from('staff').update({ photo_url: up.url }).eq('id', created.id);
      created.photo_url = up.url;
    }
    await logAction(ctx, req, 'staff.create', 'staff', created.id, { name });
    ok(res, { staff: row(created) });
    return;
  }

  if (method === 'PUT') {
    if (!methodGuard(res, req, ['PUT'])) return;
    const id = (req.query && req.query.id) || '';
    if (!ID(id)) return fail(res, 400, 'Identificador inválido');
    const { data: current } = await ctx.db.from('staff')
      .select('*').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
    if (!current) return fail(res, 404, 'Profissional não encontrado');

    const patch = { name, role, phone, whatsapp_ready: !!b.whatsapp_ready };
    if (typeof b.active === 'boolean') patch.active = b.active;

    if (b.photo !== undefined) {
      if (b.photo === null || b.photo === '') patch.photo_url = null;
      else {
        const up = await savePhoto(ctx, id, b.photo);
        if (up.error) return fail(res, 400, up.error);
        patch.photo_url = up.url;
      }
    }

    const { error } = await ctx.db.from('staff')
      .update(patch).eq('id', id).eq('tenant_id', ctx.tenantId);
    if (error) return fail(res, 500, 'Não foi possível salvar');
    await logAction(ctx, req, 'staff.update', 'staff', id, { name });
    ok(res, { staff: row(Object.assign({}, current, patch)) });
    return;
  }

  if (method === 'DELETE') {
    if (!methodGuard(res, req, ['DELETE'])) return;
    const id = (req.query && req.query.id) || '';
    if (!ID(id)) return fail(res, 400, 'Identificador inválido');
    const { count } = await ctx.db.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId).eq('staff_id', id);
    if (count) {
      const { error } = await ctx.db.from('staff')
        .update({ active: false }).eq('id', id).eq('tenant_id', ctx.tenantId);
      if (error) return fail(res, 500, 'Não foi possível desativar');
      await logAction(ctx, req, 'staff.deactivate', 'staff', id, {});
      ok(res, { ok: true, deactivated: true,
        message: 'Profissional já tem agendamentos — apenas ocultado' });
      return;
    }
    const { error } = await ctx.db.from('staff')
      .delete().eq('id', id).eq('tenant_id', ctx.tenantId);
    if (error) return fail(res, 500, 'Não foi possível excluir');
    await logAction(ctx, req, 'staff.delete', 'staff', id, {});
    ok(res, { ok: true });
    return;
  }

  fail(res, 405, 'Método não permitido');
});
