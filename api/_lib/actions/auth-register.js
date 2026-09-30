'use strict';
/* POST /api/auth?action=register  { slug, name, email, phone, password }
   Cria APENAS conta de cliente. Admin não tem tela de criação:
   é inserido direto no banco (supabase/schema.sql). */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  isEmail, clean, cleanPhone, passwordOk, dbFrom
} = require('../http');
const { hashPassword, setSessionCookie, createSession } = require('../security');
const { findTenant, audit } = require('../db');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['POST'])) return;

  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'register', 5, 60 * 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const body = await readBody(req, 8000);
  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const phone = cleanPhone(body.phone);
  const password = String(body.password || '');
  const slug = clean(body.slug, 40).toLowerCase();

  if (name.length < 2) return fail(res, 400, 'Informe seu nome completo');
  if (!isEmail(email)) return fail(res, 400, 'E-mail inválido');
  if (!phone) return fail(res, 400, 'Telefone inválido (mínimo 10 dígitos)');
  if (!passwordOk(password)) {
    return fail(res, 400, 'A senha precisa de 8+ caracteres, com letras e números');
  }
  if (!slug) return fail(res, 400, 'Endereço da página não informado');

  const db = dbFrom(req);
  const tenant = await findTenant(slug);
  if (!tenant) return fail(res, 404, 'Página não encontrada');

  const { data: dup } = await db.from('users')
    .select('id').eq('tenant_id', tenant.id).eq('email', email).maybeSingle();
  if (dup) return fail(res, 409, 'Este e-mail já tem conta — faça login');

  const { data: created, error } = await db.from('users').insert({
    tenant_id: tenant.id,
    email: email,
    name: name,
    phone: body.phone ? clean(body.phone, 20) : '',
    password_hash: hashPassword(password),
    role: 'customer'
  }).select('id, tenant_id, email, name, phone, role').single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'Este e-mail já tem conta');
    console.error('[register]', error);
    return fail(res, 500, 'Não foi possível criar a conta');
  }

  const token = await createSession(db, created, req);
  setSessionCookie(res, token);
  await audit(db, {
    tenantId: tenant.id, userId: created.id, action: 'auth.register', entity: 'user',
    entityId: created.id, ip: require('../security').clientIp(req)
  });

  ok(res, {
    user: { id: created.id, name: created.name, email: created.email, role: created.role },
    tenant: { slug: tenant.slug, name: tenant.name }
  });
});
