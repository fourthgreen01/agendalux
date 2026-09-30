'use strict';
/* GET /api/auth?action=me — usuário da sessão atual (cookie HttpOnly) */

const { ok, fail, methodGuard, handler, dbFrom } = require('../http');
const { currentUser } = require('../security');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['GET'])) return;
  const db = dbFrom(req);
  const ctx = await currentUser(req, db);
  if (!ctx) return fail(res, 401, 'Sessão inválida');
  ok(res, {
    user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role }
  });
});
