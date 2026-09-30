'use strict';

/* Guards de acesso — sempre devolvem {user, tenantId} ou null
   (e já enviam a resposta de erro quando devolvem null). */

const { fail, dbFrom } = require('./http');
const { currentUser } = require('./security');
const { audit } = require('./db');

async function requireUser(req, res) {
  let db;
  try { db = dbFrom(req); } catch (e) { fail(res, 503, e.message); return null; }
  const ctx = await currentUser(req, db);
  if (!ctx) { fail(res, 401, 'Faça login para continuar'); return null; }
  return Object.assign({ db }, ctx);
}

/* Só aceita admin. Não existe rota para CRIAR admin:
   administradores são inseridos direto no banco (ver supabase/schema.sql). */
async function requireAdmin(req, res, tenantSlug) {
  const ctx = await requireUser(req, res);
  if (!ctx) return null;
  if (ctx.user.role !== 'admin') {
    fail(res, 403, 'Área restrita a administradores');
    return null;
  }
  if (!ctx.user.is_active) { fail(res, 403, 'Conta desativada'); return null; }

  const { data: tenant, error } = await ctx.db
    .from('tenants').select('*').eq('id', ctx.tenantId).maybeSingle();
  if (error || !tenant) { fail(res, 404, 'Empresa não encontrada'); return null; }

  /* o painel só mexe na própria página (slug vindo da query, se houver) */
  const want = String(tenantSlug || (req.query && req.query.slug) || '').toLowerCase().trim();
  if (want && tenant.slug !== want) {
    fail(res, 403, 'Esta conta não administra esta página');
    return null;
  }
  return Object.assign({ tenant }, ctx);
}

async function logAction(ctx, req, action, entity, entityId, meta) {
  await audit(ctx.db, {
    tenantId: ctx.tenantId, userId: ctx.user.id, action, entity, entityId, meta,
    ip: require('./security').clientIp(req)
  });
}

module.exports = { requireUser, requireAdmin, logAction };
