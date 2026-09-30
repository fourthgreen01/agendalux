'use strict';
/* PATCH /api/bookings/:id  { status }   — somente admin
   Cancelamento também cancela a mensagem de lembrete na fila. */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit, dbFrom
} = require('./_lib/http');
const { requireAdmin, logAction } = require('./_lib/auth');

const STATUSES = ['pago', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu'];

module.exports = handler(async (req, res) => {
  if (!methodGuard(res, req, ['PATCH', 'POST'])) return;
  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'booking-status', 60, 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = String((req.query && req.query.id) || '').trim();
  if (!/^[0-9a-f-]{10,64}$/i.test(id)) return fail(res, 400, 'Identificador inválido');

  const body = await readBody(req, 4000);
  const status = String(body.status || '');
  if (STATUSES.indexOf(status) < 0) return fail(res, 400, 'Status inválido');

  const { data: before, error: findErr } = await ctx.db.from('bookings')
    .select('id, status, date, time, customer_name')
    .eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle();
  if (findErr) return fail(res, 500, 'Erro ao buscar agendamento');
  if (!before) return fail(res, 404, 'Agendamento não encontrado');

  const { error } = await ctx.db.from('bookings')
    .update({ status }).eq('id', id).eq('tenant_id', ctx.tenantId);
  if (error) return fail(res, 500, 'Não foi possível atualizar');

  if (status === 'cancelado' || status === 'nao_compareceu') {
    await ctx.db.from('message_queue')
      .update({ status: 'cancelled' })
      .eq('booking_id', id).eq('status', 'pending');
  }

  await logAction(ctx, req, 'booking.' + status, 'booking', id, { before: before.status });
  ok(res, { ok: true, status });
});
