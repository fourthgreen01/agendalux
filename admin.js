/* ═══════════════════════════════════════════════════════════════════
   ADMIN.JS — painel do gestor (exige login com role "admin")
   • foto de perfil do atendente
   • alterar o SLUG (endereço) da página
   • tudo salva via API (/api/admin?section=...) — no modo demonstração, no navegador
   ═══════════════════════════════════════════════════════════════════ */

let adminTab = 'geral';
const ADMIN = { cfg: null, services: [], staff: [], bookings: [] };

const ADMIN_TABS = [
  ['geral', 'layout-dashboard', 'Visão geral'],
  ['agendamentos', 'calendar-days', 'Agendamentos'],
  ['servicos', 'scissors', 'Serviços'],
  ['equipe', 'users', 'Equipe'],
  ['horarios', 'clock-3', 'Horários'],
  ['financeiro', 'wallet', 'Financeiro'],
  ['aparencia', 'palette', 'Aparência']
];

async function loadAdminData() {
  const cfg = await Data.adminConfig();
  ADMIN.cfg = cfg;
  CONFIG = mergeConfig(CONFIG, cfg);
  applyTheme();
  document.title = (CONFIG.company.name || 'Painel') + ' · Painel';
  const res = await Promise.all([Data.services(), Data.staff(), Data.bookings()]);
  ADMIN.services = res[0];
  ADMIN.staff = res[1];
  ADMIN.bookings = res[2];
}

async function renderAdmin() {
  const me = session();
  if (!me) return go('#/login');
  if (me.role !== 'admin') { toast('Área restrita a administradores', false); return go('#/home'); }

  $('#app').innerHTML =
    '<div class="admin">'
    + '<aside class="admin-side">'
    + '<div class="side-brand"><span class="brand-logo">' + logoHTML() + '</span>'
    + '<span><b>' + esc(CONFIG.company.name) + '</b><small>Console do gestor</small></span></div>'
    + ADMIN_TABS.map((t) =>
      '<button class="nav-item ' + (adminTab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">'
      + '<i data-lucide="' + t[1] + '"></i>' + t[2] + '</button>').join('')
    + '<div class="side-foot">'
    + '<a class="nav-item" href="/' + esc(TENANT_SLUG) + '" target="_blank" rel="noopener">'
    + '<i data-lucide="external-link"></i>Ver minha página</a>'
    + '<button class="nav-item" id="ad-logout"><i data-lucide="log-out"></i>Sair ('
    + esc(String(me.name).split(' ')[0]) + ')</button>'
    + (OFFLINE ? '<div class="demo-badge">modo demonstração</div>' : '')
    + '</div>'
    + '</aside>'
    + '<main class="admin-main" id="ad-main"><p class="hint">Carregando dados…</p></main>'
    + '</div>';

  $$('[data-tab]').forEach((b) => { b.onclick = function () { adminTab = b.dataset.tab; renderAdmin(); }; });
  $('#ad-logout').onclick = async function () {
    await Data.logout();
    toast('Sessão encerrada');
    go('#/home');
  };
  refreshIcons();

  try { await loadAdminData(); }
  catch (e) {
    const m = $('#ad-main');
    if (m) {
      m.innerHTML = '<div class="admin-head"><div><h2>Não foi possível carregar</h2>'
        + '<p>' + esc(e.message) + '</p></div></div>'
        + '<button class="btn btn-solid btn-sm" id="ad-retry">Tentar de novo</button>';
      const r = $('#ad-retry'); if (r) r.onclick = function () { renderAdmin(); };
    }
    return;
  }
  paintAdmin(); refreshIcons();
}

function paintAdmin() {
  const m = $('#ad-main'); if (!m) return;
  const views = {
    geral: adGeral, agendamentos: adAgendamentos, servicos: adServicos, equipe: adEquipe,
    horarios: adHorarios, financeiro: adFinanceiro, aparencia: adAparencia
  };
  try { m.innerHTML = views[adminTab](); }
  catch (e) { m.innerHTML = '<p class="hint">Erro: ' + esc(e.message) + '</p>'; }
  refreshIcons(); wireAdmin();
}

async function reloadTab() {
  try { await loadAdminData(); paintAdmin(); refreshIcons(); }
  catch (e) { toast(e.message, false); }
}

const allBookings = () => (ADMIN.bookings || []).slice()
  .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));

/* ═════════ visão geral ═════════ */
function adGeral() {
  const bs = allBookings(), today = todayISO();
  const valid = bs.filter((b) => b.status !== 'cancelado');
  const future = valid.filter((b) => b.date >= today);
  const revenue = valid.reduce((s, b) => s + b.price, 0);
  const clients = new Set(valid.map((b) => b.customer.phone)).size;
  const todayN = valid.filter((b) => b.date === today).length;

  let upcoming = '';
  if (future.length) {
    upcoming = '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
      + '<th>Quando</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Valor</th><th>Status</th></tr></thead><tbody>'
      + future.slice(0, 6).map((b) =>
        '<tr><td><b>' + fmtDate(b.date) + ' · ' + esc(b.time) + '</b></td>'
        + '<td>' + esc(b.customer.name) + '</td><td>' + esc(b.serviceName) + '</td>'
        + '<td>' + esc(b.staffName) + '</td><td class="money">' + BRL(b.price) + '</td>'
        + '<td>' + statusPill(b.status) + '</td></tr>').join('')
      + '</tbody></table></div>';
  } else {
    upcoming = '<p class="hint">Nenhum agendamento futuro — divulgue o link da sua página!</p>';
  }

  return '<div class="admin-head"><div><h2>Visão geral</h2>'
    + '<p>' + DOW[new Date().getDay()] + ', ' + new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    + (clients ? ' · ' + clients + ' cliente(s)' : '') + '</p></div>'
    + '<a class="btn btn-ghost btn-sm" href="/' + esc(TENANT_SLUG) + '" target="_blank" rel="noopener">'
    + '<i data-lucide="external-link"></i>Abrir site</a></div>'
    + '<div class="stats-ledger">'
    + '<div class="stat"><div class="num">' + todayN + '</div><div class="lbl">Hoje</div></div>'
    + '<div class="stat"><div class="num">' + future.length + '</div><div class="lbl">Próximos</div></div>'
    + '<div class="stat"><div class="num">' + valid.length + '</div><div class="lbl">Atendimentos</div></div>'
    + '<div class="stat"><div class="num"><em>R$</em> ' + revenue.toLocaleString('pt-BR') + '</div><div class="lbl">Faturamento total</div></div>'
    + '</div>'
    + '<div class="panel"><h3>Atendimentos — últimos 14 dias</h3>' + chart14() + '</div>'
    + '<div class="panel"><h3>Próximos de hoje</h3>' + upcoming + '</div>';
}

function chart14() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ iso: d.toISOString().slice(0, 10), lbl: DOWs[d.getDay()], n: 0 });
  }
  allBookings().forEach((b) => {
    if (b.status === 'cancelado') return;
    days.forEach((d) => { if (d.iso === b.date) d.n++; });
  });
  const max = Math.max(1, ...days.map((d) => d.n));
  let out = '<svg class="chart-svg" viewBox="0 0 560 130">'
    + '<line x1="0" y1="105" x2="560" y2="105" stroke="var(--line)"/>';
  days.forEach((d, i) => {
    const h = d.n ? (d.n / max) * 88 : 2, x = i * 40 + 8;
    const fill = d.n ? 'var(--accent)' : 'color-mix(in srgb,var(--ink) 12%,transparent)';
    out += '<rect x="' + x + '" y="' + (103 - h) + '" width="16" height="' + h + '" rx="3" fill="' + fill + '">'
      + '<title>' + d.iso + ': ' + d.n + ' atendimento(s)</title></rect>';
    if (i % 2 === 0) out += '<text x="' + (x + 8) + '" y="122" text-anchor="middle">' + d.lbl + '</text>';
  });
  return out + '</svg>';
}

function statusPill(s) {
  const map = {
    pago: '<span class="pill pay">Pago · Pix</span>',
    confirmado: '<span class="pill ok">Confirmado</span>',
    concluido: '<span class="pill">Concluído</span>',
    cancelado: '<span class="pill dgr">Cancelado</span>',
    nao_compareceu: '<span class="pill dgr">Não compareceu</span>'
  };
  return map[s] || esc(s);
}

/* ═════════ agendamentos ═════════ */
function adAgendamentos() {
  const bs = allBookings().slice().reverse();
  const PAY_SHORT = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro' };
  let rows = '';
  bs.forEach((b) => {
    const canDo = (b.status === 'confirmado' || b.status === 'pago');
    rows += '<tr>'
      + '<td><b>' + fmtDate(b.date) + '</b> · ' + esc(b.time) + '</td>'
      + '<td>' + esc(b.customer.name) + '</td><td>' + esc(b.customer.phone) + '</td>'
      + '<td>' + esc(b.serviceName) + '</td><td>' + esc(b.staffName) + '</td>'
      + '<td>' + (PAY_SHORT[b.payment] || esc(b.payment)) + '</td>'
      + '<td class="money">' + BRL(b.price) + '</td><td>' + statusPill(b.status) + '</td>'
      + '<td><div class="actions">'
      + (canDo ? '<button class="icon-btn" title="Marcar concluído" data-done="' + esc(b.id) + '">'
        + '<i data-lucide="check"></i></button>'
        + '<button class="icon-btn danger" title="Cancelar" data-cancel="' + esc(b.id) + '">'
        + '<i data-lucide="x"></i></button>' : '')
      + '</div></td></tr>';
  });
  if (!rows) rows = '<tr><td colspan="9" class="hint">Nenhum agendamento ainda.</td></tr>';

  return '<div class="admin-head"><div><h2>Agendamentos</h2><p>' + bs.length + ' no total</p></div></div>'
    + '<div class="tbl-wrap tbl-scroll"><table class="tbl"><thead><tr>'
    + '<th>Data</th><th>Cliente</th><th>Contato</th><th>Serviço</th><th>Profissional</th>'
    + '<th>Pgto</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>'
    + rows + '</tbody></table></div>';
}

/* ═════════ serviços (CRUD) ═════════ */
function adServicos() {
  let rows = '';
  (ADMIN.services || []).forEach((s) => {
    rows += '<tr' + (s.active === false ? ' class="row-off"' : '') + '><td><b>' + esc(s.name) + '</b>'
      + (s.active === false ? ' <span class="pill">oculto</span>' : '') + '</td>'
      + '<td>' + esc(s.desc) + '</td>'
      + '<td>' + esc(s.dur) + ' min</td><td class="money">' + BRL(s.price) + '</td>'
      + '<td><div class="actions">'
      + '<button class="icon-btn" data-svc-edit="' + esc(s.id) + '"><i data-lucide="pencil"></i></button>'
      + '<button class="icon-btn danger" data-svc-del="' + esc(s.id) + '"><i data-lucide="trash-2"></i></button>'
      + '</div></td></tr>';
  });
  if (!rows) rows = '<tr><td colspan="5" class="hint">Nenhum serviço ainda.</td></tr>';

  return '<div class="admin-head"><div><h2>Serviços</h2><p>O que aparece na tela de agendamento</p></div>'
    + '<button class="btn btn-solid btn-sm" id="svc-add"><i data-lucide="plus"></i>Novo serviço</button></div>'
    + '<div class="tbl-wrap tbl-scroll"><table class="tbl"><thead><tr>'
    + '<th>Serviço</th><th>Descrição</th><th>Duração</th><th>Valor</th><th></th></tr></thead><tbody>'
    + rows + '</tbody></table></div>';
}

function svcModal(s) {
  openModal('<h3>' + (s ? 'Editar' : 'Novo') + ' serviço</h3>'
    + '<p class="msub">Ele aparecerá na etapa 1 do agendamento</p>'
    + '<div class="field"><label>Nome</label><input class="input" id="sv-name" value="' + esc(s ? s.name : '') + '"></div>'
    + '<div class="field"><label>Descrição</label><input class="input" id="sv-desc" value="' + esc(s ? s.desc : '') + '"></div>'
    + '<div class="grid2">'
    + '<div class="field"><label>Duração (min)</label>'
    + '<input class="input" id="sv-dur" type="number" min="5" max="600" step="5" value="' + (s ? s.dur : 30) + '"></div>'
    + '<div class="field"><label>Preço (R$)</label>'
    + '<input class="input" id="sv-price" type="number" min="0" max="999999" step="0.5" value="' + (s ? s.price : '') + '"></div>'
    + '</div>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Cancelar</button>'
    + '<button class="btn btn-solid btn-sm" id="sv-save">Salvar</button></div>');

  $('#sv-save').onclick = async function () {
    const btn = $('#sv-save');
    const name = $('#sv-name').value.trim();
    if (!name) return toast('Informe o nome', false);
    btn.disabled = true;
    try {
      await Data.saveService({
        id: s ? s.id : undefined,
        name: name,
        desc: $('#sv-desc').value.trim(),
        dur: +$('#sv-dur').value || 30,
        price: +$('#sv-price').value || 0
      });
      closeModal();
      toast('Serviço salvo');
      await reloadTab();
    } catch (e) { btn.disabled = false; toast(e.message, false); }
  };
}

/* ═════════ equipe (CRUD) + FOTO DE PERFIL ═════════ */
function staffAvatar(p, size) {
  const px = size || 38;
  const ini = String(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const style = 'width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.38) + 'px';
  if (p.photo) {
    return '<span class="avatar" style="' + style + '"><img src="' + esc(p.photo) + '" alt="'
      + esc(p.name) + '" loading="lazy"></span>';
  }
  return '<span class="avatar" style="' + style + '">' + esc(ini) + '</span>';
}

function adEquipe() {
  let rows = '';
  (ADMIN.staff || []).forEach((p) => {
    rows += '<tr' + (p.active === false ? ' class="row-off"' : '') + '>'
      + '<td style="width:56px">' + staffAvatar(p) + '</td>'
      + '<td><b>' + esc(p.name) + '</b>' + (p.active === false ? ' <span class="pill">oculto</span>' : '') + '</td>'
      + '<td>' + esc(p.role) + '</td>'
      + '<td class="hint">' + (p.phone ? esc(p.phone) : '—') + '</td>'
      + '<td><div class="actions">'
      + '<button class="icon-btn" title="Editar" data-stf-edit="' + esc(p.id) + '"><i data-lucide="pencil"></i></button>'
      + '<button class="icon-btn danger" title="Excluir" data-stf-del="' + esc(p.id) + '"><i data-lucide="trash-2"></i></button>'
      + '</div></td></tr>';
  });
  if (!rows) rows = '<tr><td colspan="5" class="hint">Nenhum profissional ainda.</td></tr>';

  return '<div class="admin-head"><div><h2>Equipe</h2>'
    + '<p>Profissionais disponíveis para agendamento — cada um com foto de perfil</p></div>'
    + '<button class="btn btn-solid btn-sm" id="stf-add"><i data-lucide="plus"></i>Novo profissional</button></div>'
    + '<div class="tbl-wrap tbl-scroll"><table class="tbl"><thead><tr>'
    + '<th></th><th>Nome</th><th>Função</th><th>Telefone</th><th></th></tr></thead><tbody>'
    + rows + '</tbody></table></div>';
}

let STF_PHOTO = undefined; /* undefined = não mexeu; null = removeu; dataURL = nova foto */

function stfModal(p) {
  STF_PHOTO = undefined;
  const preview = p && p.photo ? p.photo : null;
  openModal('<h3>' + (p ? 'Editar' : 'Novo') + ' profissional</h3>'
    + '<p class="msub">Aparecerá na etapa 3 do agendamento</p>'
    + '<div class="stf-photo-row">'
    + '<span class="avatar stf-photo-prev" id="st-photo-prev">'
    + (preview ? '<img src="' + esc(preview) + '" alt="Foto">' : 'Foto')
    + '</span>'
    + '<div class="stf-photo-acts">'
    + '<label class="btn btn-ghost btn-sm" style="cursor:pointer"><i data-lucide="camera"></i>Escolher foto'
    + '<input type="file" accept="image/png,image/jpeg,image/webp" id="st-photo" hidden></label>'
    + (preview ? '<button class="btn btn-danger btn-sm" id="st-photo-rm" type="button">Remover foto</button>' : '')
    + '<p class="hint">Redimensionamos para 320px · máx. 800KB</p>'
    + '</div></div>'
    + '<div class="field"><label>Nome</label><input class="input" id="st-name" value="' + esc(p ? p.name : '') + '"></div>'
    + '<div class="field"><label>Função</label><input class="input" id="st-role" value="' + esc(p ? p.role : '') + '" placeholder="Barbeiro, colorista…"></div>'
    + '<div class="field"><label>Telefone / WhatsApp</label><input class="input" id="st-phone" inputmode="tel" placeholder="(11) 90000-0000" value="' + esc(p ? p.phone || '' : '') + '"></div>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Cancelar</button>'
    + '<button class="btn btn-solid btn-sm" id="st-save">Salvar</button></div>');

  const ph = $('#st-phone');
  ph.oninput = function () { ph.value = maskPhone(ph.value); };

  $('#st-photo').onchange = async function (e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const dataURL = await fileToDataURL(f, 320);
      STF_PHOTO = dataURL;
      $('#st-photo-prev').innerHTML = '<img src="' + dataURL + '" alt="Foto">';
      toast('Foto pronta — não esqueça de salvar');
    } catch (err) { toast(err.message, false); }
  };
  const rm = $('#st-photo-rm');
  if (rm) rm.onclick = function () {
    STF_PHOTO = null;
    $('#st-photo-prev').textContent = 'Foto';
    rm.remove();
  };

  $('#st-save').onclick = async function () {
    const btn = $('#st-save');
    const name = $('#st-name').value.trim();
    if (!name) return toast('Informe o nome', false);
    const payload = {
      id: p ? p.id : undefined,
      name: name,
      role: $('#st-role').value.trim() || 'Profissional',
      phone: $('#st-phone').value
    };
    if (STF_PHOTO !== undefined) payload.photo = STF_PHOTO;
    btn.disabled = true;
    try {
      await Data.saveStaff(payload);
      closeModal();
      toast('Profissional salvo');
      await reloadTab();
    } catch (e) { btn.disabled = false; toast(e.message, false); }
  };
}

/* ═════════ horários ═════════ */
function adHorarios() {
  let rows = '';
  [1, 2, 3, 4, 5, 6, 0].forEach((i) => {
    const h = CONFIG.hours[i] || { open: false, from: '09:00', to: '18:00', slot: 30 };
    rows += '<div class="day-row">'
      + '<span class="day-name">' + DOW[i] + '</span>'
      + '<button class="switch ' + (h.open ? 'on' : '') + '" data-sw="' + i + '" aria-label="Abrir/fechar ' + DOW[i] + '"></button>';
    if (h.open) {
      rows += '<div class="field" style="margin:0"><label>Abre</label>'
        + '<input class="input" type="time" value="' + esc(h.from) + '" data-hr="from" data-day="' + i + '"></div>'
        + '<div class="field" style="margin:0"><label>Fecha</label>'
        + '<input class="input" type="time" value="' + esc(h.to) + '" data-hr="to" data-day="' + i + '"></div>'
        + '<div class="field" style="margin:0"><label>Intervalo</label>'
        + '<select class="input" data-hr="slot" data-day="' + i + '">'
        + [15, 20, 30, 45, 60].map((v) =>
          '<option value="' + v + '"' + (h.slot == v ? ' selected' : '') + '>' + v + ' min</option>').join('')
        + '</select></div>';
    } else {
      rows += '<span class="day-closed" style="grid-column:3/6">Fechado neste dia</span>';
    }
    rows += '</div>';
  });

  return '<div class="admin-head"><div><h2>Horários de atendimento</h2>'
    + '<p>Define os horários disponíveis no agendamento e o status "aberto agora" da página inicial</p></div></div>'
    + '<div class="panel">' + rows
    + '<div style="margin-top:22px"><button class="btn btn-solid btn-sm" id="hr-save">Salvar horários</button></div>'
    + '</div>';
}

function collectHours() {
  CONFIG.hours = CONFIG.hours || {};
  $$('[data-hr]').forEach((el) => {
    const d = el.dataset.day;
    if (!CONFIG.hours[d]) CONFIG.hours[d] = { open: false, from: '09:00', to: '18:00', slot: 30 };
    CONFIG.hours[d][el.dataset.hr] = el.dataset.hr === 'slot' ? (+el.value || 30) : el.value;
  });
}

async function pushHours(msg) {
  try {
    await Data.saveConfig({ hours: CONFIG.hours });
    toast(msg || 'Horários atualizados — refletidos no agendamento');
  } catch (e) { toast(e.message, false); }
}

/* ═════════ financeiro ═════════ */
function adFinanceiro() {
  const bs = allBookings().filter((b) => b.status !== 'cancelado');
  const total = bs.reduce((s, b) => s + b.price, 0);
  const byPay = (p) => bs.filter((b) => b.payment === p);

  const mk = (k, lbl) => {
    const arr = byPay(k), v = arr.reduce((s, b) => s + b.price, 0);
    const w = total ? (v / total * 100) : 0;
    return '<div class="hbar"><div class="htop"><span>' + lbl + ' · ' + arr.length + ' atendimento(s)</span>'
      + '<b>' + BRL(v) + '</b></div><div class="track"><div class="fill" style="width:' + w + '%"></div></div></div>';
  };

  const bySvc = (ADMIN.services || []).map((s) => {
    const arr = bs.filter((b) => b.serviceId === s.id || b.serviceName === s.name);
    return Object.assign({}, s, { n: arr.length, v: arr.reduce((x, b) => x + b.price, 0) });
  }).sort((a, b) => b.n - a.n);

  const clients = {};
  bs.forEach((b) => {
    const k = b.customer.phone || b.customer.name;
    if (!clients[k]) clients[k] = { name: b.customer.name, phone: b.customer.phone, n: 0, v: 0 };
    clients[k].n++; clients[k].v += b.price;
  });
  const cl = Object.values(clients).sort((a, b) => b.v - a.v);

  let svcRows = '';
  bySvc.forEach((s) => {
    svcRows += '<tr><td><b>' + esc(s.name) + '</b></td><td>' + s.n + '</td><td class="money">' + BRL(s.v) + '</td></tr>';
  });
  if (!svcRows) svcRows = '<tr><td colspan="3" class="hint">Sem dados.</td></tr>';

  let clRows = '';
  cl.forEach((c) => {
    clRows += '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.phone) + '</td><td>' + c.n + '</td>'
      + '<td class="money">' + BRL(c.v) + '</td></tr>';
  });
  if (!clRows) clRows = '<tr><td colspan="4" class="hint">Sem clientes ainda.</td></tr>';

  const localV = byPay('card').concat(byPay('cash')).reduce((s, b) => s + b.price, 0);

  return '<div class="admin-head"><div><h2>Financeiro</h2>'
    + '<p>' + bs.length + ' atendimentos válidos · ' + cl.length + ' clientes</p></div></div>'
    + '<div class="stats-ledger">'
    + '<div class="stat"><div class="num"><em>R$</em> ' + total.toLocaleString('pt-BR') + '</div><div class="lbl">Faturamento total</div></div>'
    + '<div class="stat"><div class="num">' + BRL(byPay('pix').reduce((s, b) => s + b.price, 0)) + '</div><div class="lbl">Recebido via Pix</div></div>'
    + '<div class="stat"><div class="num">' + BRL(localV) + '</div><div class="lbl">A receber no local</div></div>'
    + '<div class="stat"><div class="num">' + (bs.length ? BRL(total / bs.length) : '—') + '</div><div class="lbl">Ticket médio</div></div>'
    + '</div>'
    + '<div class="panel"><h3>Por forma de pagamento</h3>'
    + mk('pix', 'Pix (online)') + mk('card', 'Cartão (no local)') + mk('cash', 'Dinheiro (no local)') + '</div>'
    + '<div class="panel"><h3>Atendimentos por serviço</h3>'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
    + '<th>Serviço</th><th>Atendimentos</th><th style="text-align:right">Receita</th></tr></thead><tbody>'
    + svcRows + '</tbody></table></div></div>'
    + '<div class="panel"><h3>Clientes</h3>'
    + '<div class="tbl-wrap tbl-scroll"><table class="tbl"><thead><tr>'
    + '<th>Cliente</th><th>Telefone</th><th>Atendimentos</th><th style="text-align:right">Total gasto</th>'
    + '</tr></thead><tbody>' + clRows + '</tbody></table></div></div>';
}

/* ═════════ aparência + dados da página + SLUG ═════════ */
const PRESETS = [
  { n: 'Marfim & Cobre', bg: '#F4EFE6', sf: '#FDFAF3', ink: '#1D1A16', ac: '#B4652E', ln: '#E2D9C8' },
  { n: 'Oliva & Porcelana', bg: '#F0F0E8', sf: '#FAFAF4', ink: '#22261D', ac: '#5C6B34', ln: '#DCDCCB' },
  { n: 'Grafite & Âmbar', bg: '#191817', sf: '#232120', ink: '#EDE8E0', ac: '#D9A05B', ln: '#383533' },
  { n: 'Terracota', bg: '#F6EEE8', sf: '#FDF9F5', ink: '#2B211C', ac: '#A64B2A', ln: '#E5D5CA' },
  { n: 'Pinhal', bg: '#EDEFE9', sf: '#F9FBF6', ink: '#1A241C', ac: '#2F5241', ln: '#D6DCD0' }
];
const ICON_OPTIONS = [
  { v: 'wifi', l: 'Wi-Fi' }, { v: 'accessibility', l: 'Acessibilidade' }, { v: 'baby', l: 'Bebê / criança' },
  { v: 'coffee', l: 'Café' }, { v: 'martini', l: 'Drinks' }, { v: 'glass-water', l: 'Água' },
  { v: 'plug', l: 'Tomadas' }, { v: 'car', l: 'Estacionamento' }, { v: 'paw-print', l: 'Pet friendly' },
  { v: 'tv', l: 'TV' }, { v: 'music', l: 'Música' }, { v: 'leaf', l: 'Vegano' }
];

function adAparencia() {
  const c = CONFIG.company;
  const swatches = PRESETS.map((p, i) =>
    '<button class="swatch" data-preset="' + i + '">'
    + '<span class="prev"><i style="background:' + p.bg + '"></i><i style="background:' + p.ac + '"></i>'
    + '<i style="background:' + p.ink + '"></i></span><small>' + p.n + '</small></button>').join('');

  const colors = [['bg', 'Fundo'], ['surface', 'Superfície'], ['ink', 'Texto'],
  ['accent', 'Destaque'], ['line', 'Linhas']].map((x) =>
    '<div class="color-field"><span>' + x[1] + '</span>'
    + '<input type="color" value="' + esc(CONFIG.theme[x[0]]) + '" data-color="' + x[0] + '"></div>').join('');

  const amens = (CONFIG.amenities || []).map((a, i) => {
    const opts = ICON_OPTIONS.map((o) =>
      '<option value="' + o.v + '"' + (a.icon === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');
    return '<div class="amenity-edit"><select class="input" data-amen-icon="' + i + '">' + opts + '</select>'
      + '<input class="input" value="' + esc(a.label) + '" data-amen-lbl="' + i + '" style="flex:1;min-width:140px">'
      + '<button class="icon-btn danger" data-amen-del="' + i + '"><i data-lucide="trash-2"></i></button></div>';
  }).join('') || '<p class="hint">Nenhuma comodidade.</p>';

  const wa = String(CONFIG.company.whatsapp_e164 || '').replace(/\D/g, '');

  return '<div class="admin-head"><div><h2>Aparência & página</h2>'
    + '<p>Tema, logo, textos, endereço e comodidades — mudam na hora</p></div>'
    + '<a class="btn btn-ghost btn-sm" href="/' + esc(TENANT_SLUG) + '" target="_blank" rel="noopener">'
    + '<i data-lucide="external-link"></i>Ver página</a></div>'

    + '<div class="panel"><h3>Endereço da página (slug)</h3>'
    + '<div class="field"><label>Slug</label>'
    + '<input class="input" id="cf-slug" value="' + esc(TENANT_SLUG) + '" spellcheck="false" '
    + 'placeholder="minha-barbearia" style="font-family:monospace">'
    + '<span class="hint">Sua página fica em <b>agendalux.vercel.app/'
    + esc(TENANT_SLUG || 'seu-endereco') + '</b> — só letras minúsculas, números e hífen. '
    + 'Ao salvar, o endereço muda na hora.</span></div></div>'

    + '<div class="panel"><h3>Paleta pronta</h3><div class="swatches">' + swatches + '</div>'
    + '<h3 style="margin-top:26px">Cores personalizadas</h3>'
    + '<div class="color-row">' + colors + '</div></div>'

    + '<div class="panel"><h3>Logotipo / foto da empresa</h3><div class="logo-upload">'
    + '<span class="brand-logo">' + logoHTML() + '</span><div>'
    + '<label class="btn btn-ghost btn-sm" style="cursor:pointer"><i data-lucide="upload"></i>Enviar imagem'
    + '<input type="file" accept="image/png,image/jpeg,image/webp" id="logo-file" hidden></label>'
    + '<p class="hint" style="margin-top:8px">Imagem redonda, mín. 200×200px. Sem envio, usamos o monograma.</p>'
    + (c.logo ? '<button class="btn btn-danger btn-sm" id="logo-rm" style="margin-top:8px">Remover logo</button>' : '')
    + '</div></div></div>'

    + '<div class="panel"><h3>Textos & contatos</h3><div class="grid2">'
    + '<div class="field"><label>Nome da empresa</label><input class="input" id="cf-name" value="' + esc(c.name) + '"></div>'
    + '<div class="field"><label>Slogan</label><input class="input" id="cf-tag" value="' + esc(c.tagline) + '"></div>'
    + '<div class="field"><label>Telefone</label><input class="input" id="cf-phone" value="' + esc(c.phone) + '"></div>'
    + '<div class="field"><label>WhatsApp (só números, com DDI)</label>'
    + '<input class="input" id="cf-wa" inputmode="numeric" placeholder="5511987654321" value="' + esc(wa) + '">'
    + '<span class="hint">Usado nos botões wa.me — ex.: 55 + DDD + número</span></div>'
    + '<div class="field"><label>Endereço (usado no mapa)</label><input class="input" id="cf-addr" value="' + esc(c.address) + '"></div>'
    + '<div class="field"><label>Instagram (URL)</label><input class="input" id="cf-ig" value="' + esc(c.instagram) + '"></div>'
    + '<div class="field"><label>Facebook (URL)</label><input class="input" id="cf-fb" value="' + esc(c.facebook) + '"></div>'
    + '</div></div>'

    + '<div class="panel"><h3>Comodidades exibidas</h3><div id="amen-list">' + amens + '</div>'
    + '<button class="btn btn-ghost btn-sm" id="amen-add" style="margin-top:8px"><i data-lucide="plus"></i>Adicionar</button></div>'

    + '<button class="btn btn-accent" id="ap-save"><i data-lucide="check"></i>Salvar alterações</button>';
}

/* ═════════ imagem: reduz no navegador antes de enviar ═════════ */
function fileToDataURL(file, maxSide) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Nenhum arquivo'));
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      return reject(new Error('Use PNG, JPG ou WebP'));
    }
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Imagem muito grande (máx. 8MB)'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      const side = maxSide || 320;
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      let out = '';
      try { out = cv.toDataURL('image/webp', 0.85); } catch (e) { out = ''; }
      if (!out || out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/jpeg', 0.85);
      if (out.length > 1400000) return reject(new Error('Imagem ainda grande demais — use outra'));
      resolve(out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem')); };
    img.src = url;
  });
}

/* ═════════ wiring geral do admin ═════════ */
function wireAdmin() {
  const T = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

  /* agendamentos */
  $$('[data-done]').forEach((b) => {
    b.onclick = async function () {
      b.disabled = true;
      try { await setBkStatus(b.dataset.done, 'concluido'); toast('Marcado como concluído'); }
      catch (e) { toast(e.message, false); b.disabled = false; }
    };
  });
  $$('[data-cancel]').forEach((b) => {
    b.onclick = function () {
      confirmModal('Cancelar este agendamento?', 'Cancelar agendamento', async function () {
        try { await setBkStatus(b.dataset.cancel, 'cancelado'); toast('Agendamento cancelado'); }
        catch (e) { toast(e.message, false); }
      });
    };
  });

  /* serviços */
  T('#svc-add', function () { svcModal(null); });
  $$('[data-svc-edit]').forEach((b) => {
    b.onclick = function () { svcModal((ADMIN.services || []).find((s) => s.id === b.dataset.svcEdit)); };
  });
  $$('[data-svc-del]').forEach((b) => {
    b.onclick = function () {
      confirmModal('Excluir este serviço?', 'Excluir', async function () {
        try {
          const r = await Data.deleteService(b.dataset.svcDel);
          toast(r && r.message ? r.message : 'Serviço excluído');
          await reloadTab();
        } catch (e) { toast(e.message, false); }
      });
    };
  });

  /* equipe */
  T('#stf-add', function () { stfModal(null); });
  $$('[data-stf-edit]').forEach((b) => {
    b.onclick = function () { stfModal((ADMIN.staff || []).find((p) => p.id === b.dataset.stfEdit)); };
  });
  $$('[data-stf-del]').forEach((b) => {
    b.onclick = function () {
      confirmModal('Excluir este profissional?', 'Excluir', async function () {
        try {
          const r = await Data.deleteStaff(b.dataset.stfDel);
          toast(r && r.message ? r.message : 'Profissional excluído');
          await reloadTab();
        } catch (e) { toast(e.message, false); }
      });
    };
  });

  /* horários */
  $$('[data-sw]').forEach((sw) => {
    sw.onclick = async function () {
      const i = sw.dataset.sw;
      collectHours();
      if (!CONFIG.hours[i]) CONFIG.hours[i] = { open: false, from: '09:00', to: '18:00', slot: 30 };
      CONFIG.hours[i].open = !CONFIG.hours[i].open;
      await pushHours('Horário atualizado');
      paintAdmin(); refreshIcons();
    };
  });
  T('#hr-save', async function () {
    collectHours();
    await pushHours('Horários atualizados — refletidos no agendamento');
    paintAdmin(); refreshIcons();
  });

  /* aparência */
  $$('[data-preset]').forEach((b) => {
    b.onclick = function () {
      const p = PRESETS[+b.dataset.preset];
      CONFIG.theme = { bg: p.bg, surface: p.sf, ink: p.ink, accent: p.ac, line: p.ln };
      applyTheme();
      Data.saveConfig({ theme: CONFIG.theme }).then(() => { paintAdmin(); refreshIcons(); })
        .catch((e) => toast(e.message, false));
      toast('Tema "' + p.n + '" aplicado');
    };
  });
  $$('[data-color]').forEach((i) => {
    i.oninput = function () {
      CONFIG.theme[i.dataset.color] = i.value;
      applyTheme();
    };
    i.onchange = function () {
      Data.saveConfig({ theme: CONFIG.theme }).catch((e) => toast(e.message, false));
    };
  });

  const lf = $('#logo-file');
  if (lf) lf.onchange = async function () {
    const f = lf.files[0]; if (!f) return;
    try {
      const dataURL = await fileToDataURL(f, 512);
      await Data.saveConfig({ logo: dataURL });
      toast('Logo atualizada');
      await reloadTab();
    } catch (e) { toast(e.message, false); }
  };
  T('#logo-rm', async function () {
    try { await Data.saveConfig({ logo: null }); toast('Logo removida'); await reloadTab(); }
    catch (e) { toast(e.message, false); }
  });

  T('#amen-add', async function () {
    const list = (CONFIG.amenities || []).slice();
    list.push({ icon: 'wifi', label: 'Nova comodidade' });
    try { await Data.saveConfig({ amenities: list }); await reloadTab(); }
    catch (e) { toast(e.message, false); }
  });
  $$('[data-amen-del]').forEach((b) => {
    b.onclick = async function () {
      const list = (CONFIG.amenities || []).slice();
      list.splice(+b.dataset.amenDel, 1);
      try { await Data.saveConfig({ amenities: list }); await reloadTab(); }
      catch (e) { toast(e.message, false); }
    };
  });

  T('#ap-save', async function () {
    const btn = $('#ap-save');
    const slug = String($('#cf-slug').value || '').trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40) {
      return toast('Endereço inválido: use só letras minúsculas, números e hífen (3 a 40)', false);
    }
    const instagram = $('#cf-ig').value.trim();
    const facebook = $('#cf-fb').value.trim();
    if (instagram && !/^https:\/\//i.test(instagram)) return toast('Instagram precisa começar com https://', false);
    if (facebook && !/^https:\/\//i.test(facebook)) return toast('Facebook precisa começar com https://', false);

    const amenities = [];
    $$('#amen-list .amenity-edit').forEach((row, i) => {
      amenities.push({
        icon: row.querySelector('[data-amen-icon]').value,
        label: row.querySelector('[data-amen-lbl]').value.trim() || 'Comodidade'
      });
    });

    btn.disabled = true;
    try {
      const patch = {
        slug: slug,
        name: $('#cf-name').value.trim() || CONFIG.company.name,
        tagline: $('#cf-tag').value.trim(),
        phone: $('#cf-phone').value.trim(),
        whatsapp: String($('#cf-wa').value || '').replace(/\D/g, ''),
        address: $('#cf-addr').value.trim(),
        instagram: instagram,
        facebook: facebook,
        amenities: amenities,
        hours: CONFIG.hours
      };
      const res = await Data.saveConfig(patch);
      const newSlug = (res && res.slug) || slug;
      if (newSlug !== TENANT_SLUG) {
        goToSlug(newSlug);
        document.title = (patch.name || '') + ' · Agendamentos';
        toast('Endereço alterado para /' + newSlug);
      } else {
        toast('Alterações salvas — veja a página inicial');
      }
      await reloadTab();
      const side = $('.side-brand b'); if (side) side.textContent = patch.name;
      const brand = $('.admin-side .brand-logo'); if (brand) brand.innerHTML = logoHTML();
    } catch (e) { toast(e.message, false); }
    btn.disabled = false;
  });
}

async function setBkStatus(id, status) {
  await Data.setBookingStatus(id, status);
  await reloadTab();
}

function confirmModal(msg, title, fn) {
  openModal('<h3>' + esc(title) + '</h3><p class="msub">' + esc(msg) + '</p>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Manter</button>'
    + '<button class="btn btn-accent btn-sm" id="cf-yes">Confirmar</button></div>');
  $('#cf-yes').onclick = async function () {
    const b = $('#cf-yes');
    b.disabled = true;
    closeModal();
    await fn();
  };
}


