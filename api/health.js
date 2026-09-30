'use strict';
/* GET /api/health — checagem de vida do backend (não expõe segredos) */

const { ok, methodGuard, handler } = require('./_lib/http');
const { configured } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['GET'])) return;
  ok(res, { ok: true, database: configured(), time: new Date().toISOString() });
});
