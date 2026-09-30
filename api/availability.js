'use strict';
/* GET /api/availability?slug=...&date=2026-09-29
   Horários ocupados do dia: { "14:00": ["uuid", ...] } */

const { ok, fail, methodGuard, handler, isDate, clean } = require('./_lib/http');
const { findTenant, admin } = require('./_lib/db');

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['GET'])) return;

  const slug = clean((req.query && req.query.slug) || '', 40).toLowerCase();
  const date = clean((req.query && req.query.date) || '', 10);
  if (!isDate(date)) return fail(res, 400, 'Data inválida');
  if (!admin()) return fail(res, 503, 'Backend não configurado');

  const tenant = await findTenant(slug || null);
  if (!tenant) return fail(res, 404, 'Página não encontrada');

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return ok(res, { date, busy: {} });
  if (date > new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10)) {
    return fail(res, 400, 'Data fora do intervalo permitido');
  }

  const { data, error } = await admin().from('bookings')
    .select('time, staff_id')
    .eq('tenant_id', tenant.id)
    .eq('date', date)
    .neq('status', 'cancelado');
  if (error) return fail(res, 500, 'Não foi possível carregar horários');

  const busy = {};
  (data || []).forEach((b) => {
    if (!busy[b.time]) busy[b.time] = [];
    if (b.staff_id) busy[b.time].push(b.staff_id);
  });
  ok(res, { date, busy });
});
