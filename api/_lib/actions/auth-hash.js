'use strict';
/* POST /api/auth?action=hash  { password }
   Utilitário de infraestrutura: gera o hash PBKDF2-SHA256 para você
   colar no SQL quando criar um ADMIN diretamente no banco
   (não existe tela de criação de administrador, por decisão de projeto).

   Exemplo de uso no SQL Editor do Supabase:
     insert into public.users (tenant_id, email, name, password_hash, role)
     values ((select id from public.tenants where slug='meu-salon'),
             'dono@empresa.com','Dono','pbkdf2$sha256$150000$...','admin');
   (cole aqui o hash retornado por este endpoint, entre aspas simples) */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit, passwordOk, clean
} = require('../http');
const { hashPassword, clientIp } = require('../security');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['POST'])) return;
  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'hash', 4, 60 * 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const body = await readBody(req, 4000);
  const password = String(body.password || '');
  if (!passwordOk(password)) {
    return fail(res, 400, 'A senha precisa de 8+ caracteres, com letras e números');
  }

  console.warn('[auth/hash] gerado para ip', clientIp(req));
  ok(res, { hash: hashPassword(password) });
});
