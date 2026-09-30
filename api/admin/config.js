'use strict';
/* GET  /api/admin/config — configuração da empresa (painel)
   PUT  /api/admin/config — salva textos, cores, horários, comodidades,
        logo e o SLUG da página (multi-tenant)                          */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  clean, cleanMultiline, slugOk, isHex, isSafeUrl, clampInt, dbFrom
} = require('./_lib/http');
const { requireAdmin, logAction } = require('./_lib/auth');
const { publicConfig, uploadAsset, audit } = require('./_lib/db');
const { decodeDataUrl, extOf } = require('./_lib/image');
const { clientIp } = require('./_lib/security');

const HEXES = ['bg', 'surface', 'ink', 'accent', 'line'];
const URL_FIELDS = ['instagram', 'facebook'];

function validTheme(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  HEXES.forEach((k) => { if (isHex(input[k])) out[k] = String(input[k]).toLowerCase(); });
  return Object.keys(out).length ? out : null;
}

function validAmenities(input) {
  if (!Array.isArray(input)) return null;
  const list = input.slice(0, 24).map((a) => ({
    icon: /^[a-z][a-z0-9-]{0,23}$/.test(String((a && a.icon) || '')) ? String(a.icon) : 'wifi',
    label: clean(a && a.label, 60) || 'Comodidade'
  }));
  return list;
}

function validHours(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (let i = 0; i <= 6; i++) {
    const h = input[i] || input[String(i)];
    if (!h || typeof h !== 'object') continue;
    out[i] = {
      open: !!h.open,
      from: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h.from)) ? String(h.from) : '09:00',
      to: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h.to)) ? String(h.to) : '18:00',
      slot: clampInt(h.slot, 5, 240, 30)
    };
  }
  return Object.keys(out).length ? out : null;
}

module.exports = handler(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') return getConfig(req, res);
  if (method === 'PUT' || method === 'POST') return putConfig(req, res);
  return fail(res, 405, 'Método não permitido');
});

async function getConfig(req, res) {
  if (!methodGuard(res, req, ['GET'])) return;
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const cfg = await publicConfig(ctx.tenant);
  ok(res, Object.assign({}, cfg, {
    whatsapp: ctx.tenant.whatsapp_e164 || '',
    country: ctx.tenant.country,
    timezone: ctx.tenant.timezone,
    isDefault: !!ctx.tenant.is_default
  }));
}

async function putConfig(req, res) {
  if (!methodGuard(res, req, ['PUT', 'POST'])) return;
  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'admin-config', 60, 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const b = await readBody(req, 900000);
  const patch = {};
  const changes = {};

  if (b.name !== undefined) {
    const name = clean(b.name, 80);
    if (name.length < 2) return fail(res, 400, 'Nome muito curto');
    patch.name = name;
  }
  if (b.tagline !== undefined) patch.tagline = cleanMultiline(b.tagline, 120);
  if (b.phone !== undefined) patch.phone = clean(b.phone, 24);
  if (b.whatsapp !== undefined) patch.whatsapp_e164 = String(b.whatsapp).replace(/\D/g, '').slice(0, 15);
  if (b.address !== undefined) patch.address = cleanMultiline(b.address, 180);

  for (const f of URL_FIELDS) {
    if (b[f] === undefined) continue;
    const v = clean(b[f], 300);
    if (v && !isSafeUrl(v)) return fail(res, 400, `Link inválido: ${f}`);
    if (v && !/^https:\/\//i.test(v)) return fail(res, 400, 'Use um link começando com https://');
    patch[f] = v;
  }

  const theme = validTheme(b.theme);
  if (b.theme !== undefined) {
    if (!theme) return fail(res, 400, 'Cores inválidas');
    patch.theme = Object.assign({}, ctx.tenant.theme || {}, theme);
  }
  if (b.amenities !== undefined) {
    const a = validAmenities(b.amenities);
    if (!a) return fail(res, 400, 'Comodidades inválidas');
    patch.amenities = a;
  }
  if (b.hours !== undefined) {
    const h = validHours(b.hours);
    if (!h) return fail(res, 400, 'Horários inválidos');
    patch.hours = h;
  }

  /* ─────── slug (endereço da página) ─────── */
  if (b.slug !== undefined) {
    const slug = clean(b.slug, 40).toLowerCase();
    if (!slugOk(slug)) {
      return fail(res, 400,
        'Endereço inválido: use só letras minúsculas, números e hífen (3 a 40 caracteres)');
    }
    if (slug !== ctx.tenant.slug) {
      const { data: dup } = await ctx.db.from('tenants')
        .select('id').eq('slug', slug).neq('id', ctx.tenant.id).maybeSingle();
      if (dup) return fail(res, 409, 'Já existe outra página com esse endereço');
      patch.slug = slug;
      changes.slug = { from: ctx.tenant.slug, to: slug };
    }
  }

  /* ─────── logo (enviado como dataURL já redimensionado) ─────── */
  if (b.logo !== undefined) {
    if (b.logo === null || b.logo === '') {
      patch.logo_url = null;
      changes.logo = 'removido';
    } else {
      const img = decodeDataUrl(b.logo);
      if (!img) return fail(res, 400, 'Imagem inválida ou grande demais (máx. 800KB)');
      const path = `tenants/${ctx.tenant.id}/logo.${extOf(img.mime)}?v=${Date.now()}`;
      const url = await uploadAsset(path, img.buffer, img.mime);
      patch.logo_url = url;
      changes.logo = 'atualizado';
    }
  }

  if (!Object.keys(patch).length) return fail(res, 400, 'Nada para salvar');

  const { error } = await ctx.db.from('tenants')
    .update(patch).eq('id', ctx.tenant.id);
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'Já existe outra página com esse endereço');
    console.error('[config]', error);
    return fail(res, 500, 'Não foi possível salvar');
  }

  await logAction(ctx, req, 'tenant.update', 'tenant', ctx.tenant.id,
    { fields: Object.keys(patch).join(','), changes });

  const { data: fresh } = await ctx.db.from('tenants').select('*').eq('id', ctx.tenant.id).maybeSingle();
  const cfg = await publicConfig(fresh);
  ok(res, Object.assign({}, cfg, {
    whatsapp: fresh.whatsapp_e164 || '',
    country: fresh.country,
    timezone: fresh.timezone,
    isDefault: !!fresh.is_default,
    changed: changes
  }));
}
