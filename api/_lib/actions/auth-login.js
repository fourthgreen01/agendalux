'use strict';
/* POST /api/auth?action=login  { slug, email, password }
   Senhas: PBKDF2-HMAC-SHA256. Erros são sempre genéricos (sem vazar
   se o e-mail existe) e o tempo de resposta é igual nos dois casos. */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  isEmail, clean, dbFrom
} = require('../http');
const { verifyPassword, setSessionCookie, createSession } = require('../security');
const { findTenant, audit } = require('../db');

/* hash "fantasma" p/ igualar o tempo quando o e-mail não existe */
let DUMMY = null;
function dummyVerify(password) {
  if (!DUMMY) DUMMY = require('../security').hashPassword('agenda-lux-phantom-000');
  verifyPassword(password, DUMMY);
}

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['POST'])) return;

  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'login', 8, 10 * 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const body = await readBody(req, 8000);
  const email = clean(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  const slug = clean(body.slug, 40).toLowerCase();

  if (!isEmail(email)) return fail(res, 400, 'Informe um e-mail válido');
  if (!password || password.length > 200) return fail(res, 400, 'Informe a senha');
  if (!slug) return fail(res, 400, 'Endereço da página não informado');

  const db = dbFrom(req);
  const tenant = await findTenant(slug);
  if (!tenant) return fail(res, 404, 'Página não encontrada');

  const { data: user } = await db.from('users')
    .select('id, tenant_id, email, name, phone, password_hash, role, is_active')
    .eq('tenant_id', tenant.id)
    .eq('email', email)
    .maybeSingle();

  if (!user || !user.password_hash) {
    dummyVerify(password);
    return fail(res, 401, 'E-mail ou senha incorretos');
  }

  const valid = verifyPassword(password, user.password_hash);
  if (!valid || !user.is_active) return fail(res, 401, 'E-mail ou senha incorretos');

  const token = await createSession(db, user, req);
  setSessionCookie(res, token);
  db.from('users').update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id).then(() => {}, () => {});
  await audit(db, {
    tenantId: tenant.id, userId: user.id, action: 'auth.login', entity: 'user',
    entityId: user.id, ip: require('../security').clientIp(req)
  });

  ok(res, {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '', role: user.role },
    tenant: { slug: tenant.slug, name: tenant.name }
  });
});
