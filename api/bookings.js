'use strict';
/* POST /api/bookings  — cria agendamento (cliente logado ou visitante)
   GET  /api/bookings  — lista (somente admin)

   SEGURANÇA: preço, duração, existência do serviço/profissional, horário
   de funcionamento, conflito de agenda e status são TODOS validados aqui.
   O navegador só envia a escolha — nunca o valor. */

const {
  ok, fail, methodGuard, handler, readBody, guardMutation, limit,
  isEmail, isDate, isTime, clean, cleanMultiline, cleanPhone, toE164, dbFrom
} = require('./_lib/http');
const { currentUser, clientIp } = require('./_lib/security');
const { findTenant, audit } = require('./_lib/db');

const PAYMENTS = ['pix', 'card', 'cash'];
const STATUSES = ['pago', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu'];
const toMin = (t) => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); };

module.exports = handler(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'POST') return createBooking(req, res);
  if (method === 'GET') return listBookings(req, res);
  return fail(res, 405, 'Método não permitido');
});

/* ───────────────────────── criar ───────────────────────── */
async function createBooking(req, res) {
  const bad = guardMutation(req);
  if (bad) return fail(res, 403, bad);

  const wait = limit(req, 'booking', 12, 60 * 60 * 1000);
  if (wait) return fail(res, 429, wait);

  const b = await readBody(req, 20000);
  const slug = clean(b.slug, 40).toLowerCase();
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const serviceId = String(b.serviceId || '');
  const staffId = String(b.staffId || '');
  const payment = String(b.payment || '');
  const notes = cleanMultiline(b.notes, 500);
  const cust = b.customer || {};
  const name = clean(cust.name, 80);
  let phone = cleanPhone(cust.phone);
  let phoneRaw = clean(cust.phone, 20);
  const email = clean(cust.email, 120).toLowerCase();

  if (!slug) return fail(res, 400, 'Endereço da página não informado');
  if (!isDate(date) || !isTime(time)) return fail(res, 400, 'Data ou horário inválido');
  if (!/^[0-9a-f-]{10,64}$/i.test(serviceId)) return fail(res, 400, 'Serviço inválido');
  if (!/^[0-9a-f-]{10,64}$/i.test(staffId)) return fail(res, 400, 'Profissional inválido');
  if (PAYMENTS.indexOf(payment) < 0) return fail(res, 400, 'Forma de pagamento inválida');
  if (name.length < 2) return fail(res, 400, 'Informe seu nome completo');
  if (email && !isEmail(email)) return fail(res, 400, 'E-mail inválido');

  const db = dbFrom(req);
  const tenant = await findTenant(slug);
  if (!tenant || !tenant.is_active) return fail(res, 404, 'Página não encontrada');

  /* cliente logado? (opcional — visitante também pode agendar) */
  let customerId = null;
  let account = null;
  const ctx = await currentUser(req, db);
  if (ctx && ctx.user.role === 'customer' && ctx.tenantId === tenant.id) {
    customerId = ctx.user.id;
    account = ctx.user;
  }

  /* o payload veio sem telefone? (conta logada não reenvia o campo)
     usa o telefone guardado no cadastro da conta logada. */
  if (!phone && account) {
    phone = cleanPhone(account.phone);
    phoneRaw = clean(account.phone, 20);
  }
  if (!phone) return fail(res, 400, 'Telefone inválido (mínimo 10 dígitos)');

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return fail(res, 400, 'Não é possível agendar no passado');
  if (date > new Date(Date.now() + 240 * 86400000).toISOString().slice(0, 10)) {
    return fail(res, 400, 'Datas até 8 meses à frente');
  }

  const [svcRes, staffRes] = await Promise.all([
    db.from('services').select('id,name,price,duration_min,active')
      .eq('tenant_id', tenant.id).eq('id', serviceId).maybeSingle(),
    db.from('staff').select('id,name,active').eq('tenant_id', tenant.id)
      .eq('id', staffId).maybeSingle()
  ]);
  const service = svcRes.data;
  const staff = staffRes.data;
  if (!service || !service.active) return fail(res, 404, 'Serviço não encontrado');
  if (!staff || !staff.active) return fail(res, 404, 'Profissional não encontrado');

  /* horário de funcionamento do dia */
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const cfg = (tenant.hours || {})[dow] || {};
  if (!cfg.open) return fail(res, 400, 'Estamos fechados neste dia');
  const from = toMin(cfg.from || '00:00');
  const to = toMin(cfg.to || '23:59');
  const step = Math.max(5, Math.min(240, parseInt(cfg.slot, 10) || 30));
  const t = toMin(time);
  if (t < from || t >= to) return fail(res, 400, 'Horário fora do expediente');
  if ((t - from) % step !== 0) return fail(res, 400, 'Horário não corresponde a um intervalo disponível');
  if (date === today && t < Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15 + 15) {
    return fail(res, 400, 'Este horário já passou — escolha outro');
  }

  /* conflito de agenda (índice único também protege) */
  const { data: conflict } = await db.from('bookings')
    .select('id').eq('tenant_id', tenant.id).eq('staff_id', staffId)
    .eq('date', date).eq('time', time).neq('status', 'cancelado').limit(1);
  if (conflict && conflict.length) return fail(res, 409, 'Este horário acabou de ser ocupado');

  /* teto anti-abuso por telefone */
  const phoneE164 = toE164(phone, tenant.country);
  const { count } = await db.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id).eq('phone_e164', phoneE164)
    .neq('status', 'cancelado').gte('date', today);
  if ((count || 0) >= 8) return fail(res, 429, 'Muitos horários reservados para este telefone — fale conosco');

  const status = 'confirmado';
  const { data: row, error } = await db.from('bookings').insert({
    tenant_id: tenant.id,
    service_id: service.id,
    staff_id: staff.id,
    customer_id: customerId,
    service_name: service.name,
    staff_name: staff.name,
    price: Number(service.price),
    duration_min: service.duration_min,
    date: date,
    time: time,
    customer_name: name,
    customer_phone: phoneRaw,
    customer_email: email,
    payment: payment,
    notes: notes,
    status: status,
    source: 'site'
  }).select('id, date, time, status, price').single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'Este horário acabou de ser ocupado');
    console.error('[booking]', error);
    return fail(res, 500, 'Não foi possível concluir o agendamento');
  }

  await audit(db, {
    tenantId: tenant.id, userId: customerId, action: 'booking.create', entity: 'booking',
    entityId: row.id, meta: { date, time, service: service.name, staff: staff.name, payment },
    ip: clientIp(req)
  });

  ok(res, {
    booking: {
      id: row.id,
      code: String(row.id).replace(/-/g, '').slice(-6).toUpperCase(),
      serviceId: service.id, serviceName: service.name,
      staffId: staff.id, staffName: staff.name,
      price: Number(row.price),
      date: row.date, time: row.time,
      payment: payment, status: row.status,
      customer: { name: name, phone: phoneRaw, email: email },
      notes: notes,
      createdAt: Date.now()
    }
  });
}

/* ───────────────────────── listar (admin) ───────────────────────── */
async function listBookings(req, res) {
  const ctx = await require('./_lib/auth').requireAdmin(req, res);
  if (!ctx) return;
  const { tenantId, db } = ctx;

  const { data, error } = await db.from('bookings')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(2000);
  if (error) return fail(res, 500, 'Não foi possível carregar agendamentos');

  ok(res, {
    bookings: (data || []).map((r) => ({
      id: r.id,
      serviceId: r.service_id, serviceName: r.service_name,
      staffId: r.staff_id, staffName: r.staff_name,
      price: Number(r.price),
      date: r.date, time: r.time,
      payment: r.payment, status: r.status, notes: r.notes,
      customer: { name: r.customer_name, phone: r.customer_phone, email: r.customer_email },
      createdAt: r.created_at ? new Date(r.created_at).getTime() : null
    }))
  });
}
