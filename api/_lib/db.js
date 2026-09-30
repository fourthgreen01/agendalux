'use strict';

/* ═══════════════ Cliente Supabase (apenas no servidor) ═══════════════
   A service_role JAMAIS é enviada ao navegador: só existe aqui.
   ══════════════════════════════════════════════════════════════════ */
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_BUCKET || 'assets';

let _client = null;
let _tried = false;

function envUrl() {
  return process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '';
}

function admin() {
  if (_client) return _client;
  if (_tried) return null;
  _tried = true;
  const url = envUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'agendalux-api' } }
  });
  return _client;
}

function configured() { return !!admin(); }

function publicUrl(path) {
  if (!envUrl()) return null;
  return `${envUrl().replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
}

/* sobe um binário já reduzido no navegador e devolve a URL pública */
async function uploadAsset(path, buffer, contentType) {
  const db = admin();
  if (!db) throw Object.assign(new Error('Storage não configurado'), { status: 503 });
  const { error } = await db.storage.from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true, cacheControl: '31536000' });
  if (error) throw Object.assign(new Error('Falha no upload: ' + error.message), { status: 502 });
  return publicUrl(path);
}

/* ─────────────────────── helpers de tenant ─────────────────────── */
function requireDb() {
  const db = admin();
  if (!db) {
    const e = new Error('Backend não configurado — defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
    e.status = 503;
    throw e;
  }
  return db;
}

async function findTenant(slug) {
  const db = requireDb();
  let q = db.from('tenants').select('*').eq('is_active', true);
  if (slug) q = q.eq('slug', slug);
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data;
  if (slug) return null;
  const { data: any } = await db.from('tenants')
    .select('*').eq('is_active', true).order('created_at').limit(1);
  return (any && any[0]) || null;
}

function phoneDigitsOf(tenant, forWhatsApp) {
  if (forWhatsApp && tenant && tenant.whatsapp_e164) return tenant.whatsapp_e164;
  if (tenant && tenant.phone_e164) return tenant.phone_e164;
  if (tenant && tenant.phone) {
    let d = String(tenant.phone).replace(/\D/g, '');
    if (d && !d.startsWith('55')) d = '55' + d;
    return d;
  }
  return '';
}

/* config pública do site (nunca vaza nada interno) */
async function publicConfig(tenant) {
  const db = requireDb();
  const [{ data: services }, { data: staff }] = await Promise.all([
    db.from('services').select('id,name,description,price,duration_min,sort_order')
      .eq('tenant_id', tenant.id).eq('active', true).order('sort_order'),
    db.from('staff').select('id,name,role,photo_url,active')
      .eq('tenant_id', tenant.id).eq('active', true).order('sort_order')
  ]);
  return {
    slug: tenant.slug,
    company: {
      name: tenant.name,
      tagline: tenant.tagline,
      phone: tenant.phone,
      phone_e164: phoneDigitsOf(tenant, false),
      whatsapp_e164: phoneDigitsOf(tenant, true),
      address: tenant.address,
      instagram: tenant.instagram,
      facebook: tenant.facebook,
      logo: tenant.logo_url || null
    },
    theme: tenant.theme || {},
    amenities: tenant.amenities || [],
    hours: tenant.hours || {},
    services: (services || []).map((s) => ({
      id: s.id, name: s.name, desc: s.description,
      price: Number(s.price), dur: s.duration_min
    })),
    staff: (staff || []).map((s) => ({
      id: s.id, name: s.name, role: s.role, photo: s.photo_url || null
    }))
  };
}

async function audit(db, entry) {
  try {
    await db.from('audit_log').insert({
      tenant_id: entry.tenantId || null,
      user_id: entry.userId || null,
      action: cleanShort(entry.action),
      entity: cleanShort(entry.entity || ''),
      entity_id: cleanShort(entry.entityId || ''),
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
      ip: cleanShort(entry.ip || '')
    });
  } catch (e) { console.error('[audit]', e.message); }
}

function cleanShort(v) { return String(v || '').slice(0, 120); }

module.exports = { admin, configured, uploadAsset, publicUrl, findTenant, phoneDigitsOf, publicConfig, audit, BUCKET };
