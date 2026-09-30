'use strict';
/* POST /api/auth?action=logout — encerra a sessão e apaga o cookie */

const { ok, methodGuard, handler, guardMutation, dbFrom, fail } = require('../http');
const { destroySession, clearSessionCookie } = require('../security');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['POST'])) return;
  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);
  try {
    const db = dbFrom(req);
    await destroySession(req, db);
  } catch (e) { /* sem banco: só limpa o cookie */ }
  clearSessionCookie(res);
  ok(res, { ok: true });
});
