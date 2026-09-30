'use strict';
/* CRUD de serviços (somente admin)
   GET    /api/admin?section=services
   POST   /api/admin?section=services
   PUT    /api/admin?section=services&id=...
   DELETE /api/admin?section=services&id=...                                   */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  clean, clampInt, clampMoney
} = require('../http');
const { requireAdmin, logAction } = require('../auth');

const ID = (v) => /^[0-9a-f-]{10,64}$/i.test(String(v || ''));

function bodyToService(b) {
  const name = clean(b.name, 80);
  if (name.length < 2) return { error: 'Informe um nome de ao menos 2 caracteres' };
  const desc = clean(b.desc, 140);
  const dur = clampInt(b.dur, 5, 600, 30);
  const price = clampMoney(b.price, 0);
  return { value: { name, description: desc, duration_min: dur, price } };
}

module.exports = handler(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET') {
    if (!methodGuard(res, req, ['GET'])) return;
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.db.from('services')
      .select('*').eq('tenant_id', ctx.tenantId).order('sort_order').order('created_at');
    if (error) return fail(res, 500, 'Erro ao listar serviços');
    ok(res, {
      services: (data || []).map((s) => ({
        id: s.id, name: s.name, desc: s.description,
        price: Number(s.price), dur: s.duration_min, active: s.active
      }))
    });
    return;
  }

  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);
  const wait = limit(req, 'admin-services', 60, 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  if (method === 'POST') {
    if (!methodGuard(res, req, ['POST'])) return;
    const parsed = bodyToService(await readBody(req, 8000));
    if (parsed.error) return fail(res, 400, parsed.error);
    const { data, error } = await ctx.db.from('services').insert(
      Object.assign({ tenant_id: ctx.tenantId, active: true }, parsed.value)
    ).select('*').single();
    if (error) { console.error('[svc]', error); return fail(res, 500, 'Não foi possível criar'); }
    await logAction(ctx, req, 'service.create', 'service', data.id, { name: parsed.value.name });
    ok(res, { service: { id: data.id, name: data.name, desc: data.description,
      price: Number(data.price), dur: data.duration_min, active: data.active } });
    return;
  }

  if (method === 'PUT') {
    if (!methodGuard(res, req, ['PUT'])) return;
    const id = (req.query && req.query.id) || '';
    if (!ID(id)) return fail(res, 400, 'Identificador inválido');
    const parsed = bodyToService(await readBody(req, 8000));
    if (parsed.error) return fail(res, 400, parsed.error);
    const { data: current } = await ctx.db.from('services')
      .select('id').eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
    if (!current) return fail(res, 404, 'Serviço não encontrado');
    const { error } = await ctx.db.from('services')
      .update(parsed.value).eq('id', id).eq('tenant_id', ctx.tenantId);
    if (error) return fail(res, 500, 'Não foi possível salvar');
    await logAction(ctx, req, 'service.update', 'service', id, { name: parsed.value.name });
    ok(res, { ok: true });
    return;
  }

  if (method === 'DELETE') {
    if (!methodGuard(res, req, ['DELETE']) ) return;
    const id = (req.query && req.query.id) || '';
    if (!ID(id)) return fail(res, 400, 'Identificador inválido');
    const { count } = await ctx.db.from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId).eq('service_id', id);
    if (count) {
      const { error } = await ctx.db.from('services')
        .update({ active: false }).eq('id', id).eq('tenant_id', ctx.tenantId);
      if (error) return fail(res, 500, 'Não foi possível desativar');
      await logAction(ctx, req, 'service.deactivate', 'service', id, {});
      ok(res, { ok: true, deactivated: true,
        message: 'Serviço já foi usado em agendamentos — apenas ocultado' });
      return;
    }
    const { error } = await ctx.db.from('services')
      .delete().eq('id', id).eq('tenant_id', ctx.tenantId);
    if (error) return fail(res, 500, 'Não foi possível excluir');
    await logAction(ctx, req, 'service.delete', 'service', id, {});
    ok(res, { ok: true });
    return;
  }

  fail(res, 405, 'Método não permitido');
});
