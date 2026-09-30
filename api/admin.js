'use strict';
/* Roteador do painel — UMA única função da Vercel
   (o plano Hobby aceita no máximo 12 funções por deploy).

   GET/PUT    /api/admin?section=config
   GET/POST/PUT/DELETE /api/admin?section=services  (&id=...)
   GET/POST/PUT/DELETE /api/admin?section=staff     (&id=...)
   Todas exigem sessão de administrador. */

const { fail, handler } = require('./_lib/http');

const SECTIONS = {
  config: require('./_lib/actions/admin-config'),
  services: require('./_lib/actions/admin-services'),
  staff: require('./_lib/actions/admin-staff')
};

module.exports = handler(async (req, res) => {
  const section = String((req.query && req.query.section) || '').toLowerCase();
  const fn = SECTIONS[section];
  if (!fn) return fail(res, 400, 'Seção inválida (config, services ou staff)');
  return fn(req, res);
});
