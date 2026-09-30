'use strict';
/* GET /api/public?slug=barbearia-do-luiz
   Configuração pública de uma página (tenant). Sem segredo algum. */

const { ok, fail, methodGuard, handler, clean } = require('./_lib/http');
const { findTenant, publicConfig } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['GET'])) return;

  const slug = clean((req.query && req.query.slug) || '', 40).toLowerCase();
  if (slug && !/^[a-z0-9-]{3,40}$/.test(slug)) return fail(res, 400, 'Endereço inválido');

  const tenant = await findTenant(slug || null);
  if (!tenant) return fail(res, 404, slug ? 'Página não encontrada' : 'Nenhuma empresa configurada');

  ok(res, await publicConfig(tenant));
});
