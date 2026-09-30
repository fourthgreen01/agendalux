'use strict';
/* Roteador de autenticação — UMA única função da Vercel
   (o plano Hobby aceita no máximo 12 funções por deploy).

   GET  /api/auth?action=me
   POST /api/auth?action=login     { slug, email, password }
   POST /api/auth?action=register  { slug, name, email, phone, password }
   POST /api/auth?action=logout    {}
   POST /api/auth?action=hash      { password }   ← utilitário p/ criar admin no SQL */

const { fail, handler } = require('./_lib/http');

const ACTIONS = {
  login: require('./_lib/actions/auth-login'),
  register: require('./_lib/actions/auth-register'),
  logout: require('./_lib/actions/auth-logout'),
  me: require('./_lib/actions/auth-me'),
  hash: require('./_lib/actions/auth-hash')
};

module.exports = handler(async (req, res) => {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  const fn = ACTIONS[action];
  if (!fn) return fail(res, 400, 'Ação inválida');
  return fn(req, res);
});
