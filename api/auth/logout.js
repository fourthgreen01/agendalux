'use strict';
/* POST /api/auth/logout — encerra a sessão e apaga o cookie */

const { ok, methodGuard, handler, guardMutation, dbFrom, fail } = require('./_lib/http');
const { destroySession, clearSessionCookie } = require('./_lib/security');

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
