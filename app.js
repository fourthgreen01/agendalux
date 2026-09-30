/* ═══════════════════════════════════════════════════════════════════
   APP.JS — site público, agendamento em etapas, obrigado, login/cadastro
   ═══════════════════════════════════════════════════════════════════ */

/* ═════════ ROUTER ═════════ */
window.addEventListener('hashchange', route);
function route() {
  const h = location.hash || '#/home';
  const map = {
    '#/home': renderHome, '#/booking': renderBooking, '#/obrigado': renderThanks,
    '#/admin': renderAdmin, '#/login': renderLogin, '#/cadastro': renderRegister
  };
  const fn = map[h] || renderHome;
  const me = session();
  if (h === '#/admin' && !(me && me.role === 'admin')) {
    toast('Faça login como gestor para acessar o painel', false);
    return go('#/login');
  }
  if (h === '#/obrigado' && !readStore(K.last, null)) return go('#/home');
  window.scrollTo(0, 0);
  try { fn(); } catch (e) { console.error(e); toast('Erro ao renderizar página: ' + e.message, false); }
  refreshIcons();
}

/* navegação genérica por atributo data-go */
document.addEventListener('click', (e) => {
  const g = e.target && e.target.closest && e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
});

/* ═════════ 1. HOME ═════════ */
function renderHome() {
  const c = CONFIG.company, st = openStatus(), hours = CONFIG.hours;
  const firstWord = (c.name || '?').trim().split(/\s+/)[0];
  const nameWords = (c.name || '?').trim().split(/\s+/);
  const nameA = nameWords.slice(0, -1).join(' ') || c.name;
  const nameB = nameWords.length > 1 ? nameWords[nameWords.length - 1] : '';
  const mapsQ = encodeURIComponent(c.address || '');
  const today = new Date().getDay();
  const wa = waLink('Olá! Vim pelo site de ' + (c.name || '') + ' e gostaria de agendar um horário.');

  $('#app').innerHTML =
    '<div class="wordmark">' + esc(firstWord) + '</div>'
    + '<div class="container">'
    + '<div class="topbar"><span>Est. 2016 · São Paulo</span>'
    + '<a href="#/login">Acesso do gestor</a></div>'
    + '<section class="hero"><div>'
    + '<div class="brand-logo">' + logoHTML() + '</div>'
    + '<h1>' + esc(nameA) + (nameB ? ' <em>' + esc(nameB) + '</em>' : '') + '</h1>'
    + '<p class="tagline">' + esc(c.tagline) + '</p>'
    + '<div class="amenities">'
    + (CONFIG.amenities || []).map((a) =>
      '<span class="amenity"><i data-lucide="' + esc(a.icon) + '"></i>' + esc(a.label) + '</span>').join('')
    + '</div>'
    + '<div class="cta-row">'
    + '<button class="btn btn-solid" data-go="#/booking">Agende agora <i data-lucide="arrow-right"></i></button>'
    + (wa ? '<a class="btn btn-ghost" href="' + esc(wa) + '" target="_blank" rel="noopener">'
      + '<i data-lucide="message-circle"></i>WhatsApp</a>' : '')
    + '<a class="cta-phone" href="tel:' + esc(String(c.phone).replace(/\D/g, '')) + '">'
    + '<i data-lucide="phone"></i>' + esc(c.phone) + '</a>'
    + '</div>'
    + '</div>'
    + '<aside class="info-panel">'
    + '<span class="status-badge ' + (st.open ? '' : 'closed') + '"><span class="status-dot"></span>' + esc(st.label) + '</span>'
    + '<div class="info-block"><h3><i data-lucide="clock-3"></i>Horários de atendimento</h3>'
    + '<div class="hours-list">'
    + [1, 2, 3, 4, 5, 6, 0].map((i) => {
      const d = hours[i] || {};
      return '<div class="row ' + (i === today ? 'today' : '') + '"><span class="day">' + DOW[i] + '</span>'
        + '<span>' + (d.open ? d.from + ' — ' + d.to : 'Fechado') + '</span></div>';
    }).join('')
    + '</div></div>'
    + '<div class="info-block"><h3><i data-lucide="map-pin"></i>Endereço</h3>'
    + '<p class="address">' + esc(c.address) + '</p></div>'
    + '<div class="info-block"><h3><i data-lucide="at-sign"></i>Redes sociais</h3>'
    + '<div class="social-row">'
    + (c.instagram ? '<a class="social-pill" href="' + esc(c.instagram) + '" target="_blank" rel="noopener">'
      + '<i data-lucide="instagram"></i>Instagram</a>' : '')
    + (c.facebook ? '<a class="social-pill" href="' + esc(c.facebook) + '" target="_blank" rel="noopener">'
      + '<i data-lucide="facebook"></i>Facebook</a>' : '')
    + '</div></div>'
    + '</aside></section>'
    + '<div class="map-wrap">'
    + '<iframe src="https://maps.google.com/maps?q=' + mapsQ + '&output=embed" loading="lazy" '
    + 'title="Mapa" referrerpolicy="no-referrer-when-downgrade"></iframe>'
    + '<div class="map-caption">'
    + '<span><a href="https://maps.google.com/?q=' + mapsQ + '" target="_blank" rel="noopener">'
    + esc(c.address) + '</a></span><span>Como chegar</span></div>'
    + '</div>'
    + '<footer class="site"><span>© ' + new Date().getFullYear() + ' ' + esc(c.name) + '</span>'
    + '<span>Cuidar de você é o nosso ofício</span></footer>'
    + '</div>';
}

/* ═════════ 2. AGENDAMENTO ═════════ */
let bk = { step: 0, serviceId: null, date: '', time: '', staffId: null, busy: null, loading: false };
function bkReset() { bk = { step: 0, serviceId: null, date: '', time: '', staffId: null, busy: null, loading: false }; }

function loadBusy() {
  if (!bk.date || bk.loading) return;
  bk.loading = true;
  Data.availability(bk.date)
    .then((busy) => { bk.busy = busy; bk.loading = false; if (document.getElementById('bk-content')) paintStep(); })
    .catch((e) => {
      bk.busy = {}; bk.loading = false;
      if (document.getElementById('bk-content')) paintStep();
      toast('Não foi possível verificar horários: ' + e.message, false);
    });
}

function renderBooking() {
  const steps = ['Serviço', 'Data & hora', 'Profissional', 'Confirmação'];
  let stepper = '';
  steps.forEach((s, i) => {
    if (i > 0) stepper += '<div class="step-bar ' + (i <= bk.step ? 'done' : '') + '"></div>';
    const inner = i < bk.step ? '<i data-lucide="check"></i>' : String(i + 1);
    stepper += '<div class="step ' + (i === bk.step ? 'active' : (i < bk.step ? 'done' : '')) + '">'
      + '<span class="dot">' + inner + '</span><span class="lbl">' + s + '</span></div>';
  });

  $('#app').innerHTML =
    '<div class="wordmark">' + esc((CONFIG.company.name || '?').split(' ')[0]) + '</div>'
    + '<div class="page-head"><h2>Faça seu agendamento</h2>'
    + '<p>' + esc(CONFIG.company.name) + ' — leve menos de um minuto</p></div>'
    + '<div class="booking-shell">'
    + '<div class="stepper">' + stepper + '</div>'
    + '<div class="step-content" id="bk-content"></div>'
    + '<div class="booking-footer">'
    + '<button class="btn btn-ghost btn-sm" id="bk-back"' + (bk.step === 0 ? ' style="visibility:hidden"' : '') + '>'
    + '<i data-lucide="arrow-left"></i>Voltar</button>'
    + '<button class="btn btn-solid btn-sm" id="bk-next"' + (canNext() ? '' : ' disabled') + '>Continuar '
    + '<i data-lucide="arrow-right"></i></button>'
    + '</div>'
    + '</div>';

  if (bk.date && bk.busy === null && !bk.loading) loadBusy();
  paintStep(); refreshIcons();
  $('#bk-back').onclick = function () {
    if (bk.step === 2) { bk.time = ''; bk.staffId = null; }
    if (bk.step > 0) bk.step--;
    renderBooking();
  };
  $('#bk-next').onclick = function () { bk.step++; renderBooking(); };
}
function canNext() { return [!!bk.serviceId, !!(bk.date && bk.time), !!bk.staffId, true][bk.step]; }

function paintStep() {
  const el = $('#bk-content'); if (!el) return;
  if (bk.step === 0) el.innerHTML = stepServices();
  if (bk.step === 1) el.innerHTML = stepDateTime();
  if (bk.step === 2) el.innerHTML = stepStaff();
  if (bk.step === 3) { el.innerHTML = stepSummary(); const n = $('#bk-next'); if (n) n.style.display = 'none'; }
  refreshIcons(); wireStep();
}

/* — etapa 1: serviços — */
function stepServices() {
  let list = '';
  (CONFIG.services || []).forEach((s) => {
    list += '<div class="service-row ' + (bk.serviceId === s.id ? 'sel' : '') + '" data-svc="' + esc(s.id) + '" role="button" tabindex="0">'
      + '<span><span class="svc-name">' + esc(s.name) + '</span>'
      + '<div class="svc-desc">' + esc(s.desc) + '</div></span>'
      + '<span class="svc-dots"></span>'
      + '<span class="svc-meta"><div class="svc-price">' + BRL(s.price) + '</div>'
      + '<div class="svc-dur">' + esc(s.dur) + ' min</div></span></div>';
  });
  if (!list) return '<p class="step-title">Nenhum serviço publicado</p><p class="step-sub">Volte mais tarde.</p>';
  return '<p class="step-title">Escolha o serviço</p>'
    + '<p class="step-sub">Toque em uma opção para selecioná-la</p><div>' + list + '</div>';
}

/* — etapa 2: data + horários — */
function stepDateTime() {
  let slotsHTML = '';
  if (bk.date) {
    const p = bk.date.split('-').map(Number);
    const dw = new Date(p[0], p[1] - 1, p[2]).getDay();
    const cfg = (CONFIG.hours || {})[dw];
    if (!cfg || !cfg.open) {
      slotsHTML = '<div class="closed-note"><i data-lucide="calendar-x"></i>'
        + 'Estamos fechados neste dia — escolha outra data</div>';
    } else if (bk.loading) {
      slotsHTML = '<div class="closed-note"><i data-lucide="loader-circle" class="spin"></i>'
        + 'Verificando horários disponíveis…</div>';
    } else {
      const occ = bk.busy || {};
      const now = new Date(), isToday = (bk.date === todayISO());
      const cur = now.getHours() * 60 + now.getMinutes();
      const slots = [];
      let m = toMin(cfg.from); const end = toMin(cfg.to), step = +cfg.slot || 30;
      while (m < end) {
        slots.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
        m += step;
      }
      slotsHTML = '<p class="step-sub" style="margin:14px 0 4px">Horários disponíveis</p><div class="slots">';
      slots.forEach((t) => {
        const busyN = (occ[t] || []).length;
        const allBusy = busyN >= (CONFIG.staff || []).length;
        const past = isToday && toMin(t) <= cur;
        const off = allBusy || past;
        const why = allBusy ? 'Sem profissionais disponíveis' : 'Horário já passou';
        slotsHTML += '<button class="slot ' + (bk.time === t ? 'sel' : '') + (off ? ' off' : '')
          + '" data-slot="' + t + '"' + (off ? ' disabled title="' + why + '"' : '') + '>' + t + '</button>';
      });
      slotsHTML += '</div>';
    }
  }
  return '<p class="step-title">Quando você quer vir?</p>'
    + '<p class="step-sub">Datas anteriores a hoje não são permitidas</p>'
    + '<div class="date-row"><div class="field"><label for="bk-date">Data</label>'
    + '<input class="input" type="date" id="bk-date" value="' + esc(bk.date) + '" min="' + todayISO() + '"></div></div>'
    + (bk.date ? '<div class="summary" style="margin-bottom:6px"><div class="srow">'
      + '<span>Escolhido</span><strong>' + fmtDate(bk.date) + (bk.time ? ' · ' + bk.time : '') + '</strong></div></div>' : '')
    + slotsHTML;
}

/* — etapa 3: profissional — */
function stepStaff() {
  const occ = (bk.busy && bk.busy[bk.time]) || [];
  let list = '';
  (CONFIG.staff || []).forEach((p) => {
    const busy = occ.indexOf(p.id) >= 0;
    const ini = (p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const avatar = p.photo
      ? '<span class="avatar"><img src="' + esc(p.photo) + '" alt="' + esc(p.name) + '" loading="lazy"></span>'
      : '<span class="avatar">' + esc(ini) + '</span>';
    list += '<div class="staff-card ' + (bk.staffId === p.id ? 'sel' : '') + (busy ? ' off' : '')
      + '" data-staff="' + esc(p.id) + '" role="button" tabindex="0">'
      + avatar
      + '<span><span class="staff-name">' + esc(p.name) + '</span>'
      + '<div class="staff-role">' + esc(p.role) + '</div></span>'
      + (busy ? '<span class="staff-busy">Horário ocupado</span>' : '')
      + '</div>';
  });
  return '<p class="step-title">Quem vai te atender?</p>'
    + '<p class="step-sub">' + fmtDate(bk.date) + ' · ' + bk.time + '</p>'
    + '<div class="staff-list">' + list + '</div>';
}

/* — etapa 4: resumo — */
function stepSummary() {
  const s = (CONFIG.services || []).find((x) => x.id === bk.serviceId);
  const p = (CONFIG.staff || []).find((x) => x.id === bk.staffId);
  if (!s || !p) return '<p class="hint">Selecione tudo e volte uma etapa.</p>';
  return '<p class="step-title">Revise o agendamento</p>'
    + '<p class="step-sub">Tudo certo? Confirme para finalizar</p>'
    + '<div class="summary">'
    + '<div class="srow"><span>Serviço</span><strong>' + esc(s.name) + '</strong></div>'
    + '<div class="srow"><span>Profissional</span><strong>' + esc(p.name) + '</strong></div>'
    + '<div class="srow"><span>Data</span><strong>' + fmtDate(bk.date) + ' · ' + bk.time + '</strong></div>'
    + '<div class="srow"><span>Duração</span><strong>' + esc(s.dur) + ' minutos</strong></div>'
    + '<div class="srow total"><span>Valor</span><strong>' + BRL(s.price) + '</strong></div></div>'
    + '<p class="hint" style="margin-top:14px">O valor é confirmado pelo estabelecimento no atendimento.</p>'
    + '<div style="margin-top:20px;text-align:center">'
    + '<button class="btn btn-accent" id="bk-confirm">Continuar <i data-lucide="arrow-right"></i></button></div>';
}

/* — eventos da etapa atual — */
function wireStep() {
  $$('[data-svc]').forEach((r) => {
    r.onclick = function () {
      bk.serviceId = r.dataset.svc; paintStep();
      const n = $('#bk-next'); if (n) n.disabled = !canNext();
    };
  });

  const dt = $('#bk-date');
  if (dt) dt.onchange = function () {
    if (dt.value && dt.value < todayISO()) {
      toast('Não é possível agendar em datas passadas', false); dt.value = bk.date;
      return;
    }
    bk.date = dt.value; bk.time = ''; bk.busy = null;
    paintStep();
    const n = $('#bk-next'); if (n) n.disabled = !canNext();
    if (bk.date) loadBusy();
  };

  $$('[data-slot]').forEach((b) => {
    b.onclick = function () {
      bk.time = b.dataset.slot; paintStep();
      const n = $('#bk-next'); if (n) n.disabled = !canNext();
    };
  });

  $$('[data-staff]').forEach((c) => {
    c.onclick = function () {
      bk.staffId = c.dataset.staff; paintStep();
      const n = $('#bk-next'); if (n) n.disabled = !canNext();
    };
  });

  const cf = $('#bk-confirm'); if (cf) cf.onclick = openAuthModal;
}

/* ═════════ MODAL: sem cadastro / cadastrar-se + pagamento ═════════ */
function openAuthModal() {
  const user = session();
  if (user && user.role === 'customer') return payModalPage(user); /* logado → direto ao pagamento */
  authChoicePage();
}

function authChoicePage() {
  openModal('<h3>Quase lá!</h3><p class="msub">Como você quer finalizar seu agendamento?</p>'
    + '<div class="auth-choice">'
    + '<button class="choice" id="ch-guest"><i data-lucide="user-round"></i>'
    + '<span><b>Continuar sem cadastro</b><small>Rápido — só nome e telefone</small></span></button>'
    + '<button class="choice" id="ch-signup"><i data-lucide="user-round-plus"></i>'
    + '<span><b>Criar uma conta</b><small>Guarde seu histórico e agende mais rápido</small></span></button>'
    + '</div>');
  $('#ch-guest').onclick = guestFormPage;
  $('#ch-signup').onclick = signupFormPage;
}

function guestFormPage(err) {
  openModal('<h3>Seus dados</h3><p class="msub">É só o essencial, prometo</p>'
    + '<div class="field ' + (err === 'name' ? 'invalid' : '') + '"><label>Nome completo</label>'
    + '<input class="input" id="g-name" placeholder="Como devemos te chamar?">'
    + '<span class="err">Informe seu nome</span></div>'
    + '<div class="field ' + (err === 'phone' ? 'invalid' : '') + '"><label>Telefone / WhatsApp</label>'
    + '<input class="input" id="g-phone" inputmode="tel" placeholder="(11) 90000-0000">'
    + '<span class="err">Telefone inválido (mínimo 10 dígitos)</span></div>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Voltar</button>'
    + '<button class="btn btn-solid btn-sm" id="g-go">Ir ao pagamento <i data-lucide="arrow-right"></i></button></div>');
  const ph = $('#g-phone'); ph.oninput = function () { ph.value = maskPhone(ph.value); };
  $('#g-go').onclick = function () {
    const name = $('#g-name').value.trim(), phone = $('#g-phone').value;
    if (name.length < 2) return guestFormPage('name');
    if (phone.replace(/\D/g, '').length < 10) return guestFormPage('phone');
    payModalPage({ name: name, phone: phone, email: '' });
  };
}

function signupFormPage(err) {
  const F = (id, lbl, ph, type) =>
    '<div class="field ' + (err === id ? 'invalid' : '') + '"><label>' + lbl + '</label>'
    + '<input class="input" id="' + id + '" type="' + (type || 'text') + '" placeholder="' + ph + '"></div>';
  openModal('<h3>Criar conta</h3><p class="msub">Seus dados ficam salvos para os próximos agendamentos</p>'
    + F('s-name', 'Nome completo', 'Seu nome')
    + F('s-phone', 'Telefone / WhatsApp', '(11) 90000-0000')
    + F('s-email', 'E-mail', 'voce@email.com', 'email')
    + '<div class="field ' + (err === 'pass' ? 'invalid' : '') + '"><label>Senha</label>'
    + '<input class="input" id="s-pass" type="password" placeholder="8+ caracteres, com letra e número">'
    + '<span class="err">Use 8+ caracteres, com letras e números</span></div>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Voltar</button>'
    + '<button class="btn btn-solid btn-sm" id="s-go">Criar conta <i data-lucide="arrow-right"></i></button></div>');
  const ph = $('#s-phone'); ph.oninput = function () { ph.value = maskPhone(ph.value); };
  $('#s-go').onclick = async function () {
    const btn = $('#s-go');
    const name = $('#s-name').value.trim(), phone = $('#s-phone').value,
      email = $('#s-email').value.trim(), pass = $('#s-pass').value;
    if (name.length < 2) return signupFormPage('name');
    if (phone.replace(/\D/g, '').length < 10) return signupFormPage('phone');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return signupFormPage('email');
    if (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass)) return signupFormPage('pass');
    btn.disabled = true;
    try {
      const user = await Data.register({ name: name, email: email, phone: phone, password: pass });
      toast('Conta criada! Bem-vindo(a) ' + String(user.name).split(' ')[0]);
      payModalPage(user);
    } catch (e) {
      btn.disabled = false;
      if (e.status === 409) { toast(e.message, false); closeModal(); return go('#/login'); }
      toast(e.message, false);
    }
  };
}

function payModalPage(user) {
  const s = (CONFIG.services || []).find((x) => x.id === bk.serviceId);
  if (!s) return closeModal();
  openModal('<h3>Forma de pagamento</h3>'
    + '<p class="msub">' + esc(s.name) + ' · ' + fmtDate(bk.date) + ' às ' + bk.time + ' — ' + BRL(s.price) + '</p>'
    + '<div class="pay-options">'
    + '<button class="pay-opt" data-pay="pix"><i data-lucide="qr-code"></i>'
    + '<span><b>Pix</b><small>Reserve agora — a equipe confirma o Pix no WhatsApp</small></span>'
    + '<span class="tag">Reserva</span></button>'
    + '<button class="pay-opt" data-pay="card"><i data-lucide="credit-card"></i>'
    + '<span><b>Cartão</b><small>No local, na hora do atendimento</small></span>'
    + '<span class="tag">No local</span></button>'
    + '<button class="pay-opt" data-pay="cash"><i data-lucide="banknote"></i>'
    + '<span><b>Dinheiro</b><small>No local, na hora do atendimento</small></span>'
    + '<span class="tag">No local</span></button>'
    + '</div>'
    + '<div class="field" style="margin-top:20px"><label>Observações (opcional)</label>'
    + '<textarea class="input" id="p-notes" placeholder="Alguma preferência ou detalhe?"></textarea></div>'
    + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Cancelar</button>'
    + '<button class="btn btn-accent btn-sm" id="p-go" disabled>Confirmar agendamento '
    + '<i data-lucide="check"></i></button></div>');

  let pay = null;
  $$('.pay-opt').forEach((b) => {
    b.onclick = function () {
      pay = b.dataset.pay;
      $$('.pay-opt').forEach((x) => x.classList.toggle('sel', x === b));
      $('#p-go').disabled = false;
    };
  });
  $('#p-go').onclick = function () {
    if (!pay) return;
    finalizeBooking(user, pay, $('#p-notes').value.trim());
  };
}

async function finalizeBooking(user, payment, notes) {
  const s = (CONFIG.services || []).find((x) => x.id === bk.serviceId);
  const p = (CONFIG.staff || []).find((x) => x.id === bk.staffId);
  if (!s || !p) return;
  const btn = $('#p-go');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmando…'; }
  try {
    const booking = await Data.createBooking({
      serviceId: s.id, staffId: p.id, date: bk.date, time: bk.time,
      payment: payment, notes: notes,
      customer: { name: user.name, phone: user.phone || '', email: user.email || '' }
    });
    writeStore(K.last, booking);
    delete AVAIL[bk.date];
    bkReset();
    closeModal();
    toast('Agendamento confirmado!');
    go('#/obrigado');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar agendamento'; refreshIcons(); }
    toast(e.message || 'Não foi possível concluir', false);
    if (e.status === 409) {
      closeModal();
      bk.busy = null;
      bk.step = 1;
      renderBooking();
      setTimeout(loadBusy, 30);
    }
  }
}

/* ═════════ 3. OBRIGADO ═════════ */
function renderThanks() {
  const b = readStore(K.last, null); if (!b) return go('#/home');
  const c = CONFIG.company;
  const payLbl = PAY_LABEL[b.payment] || b.payment;
  const firstName = String((b.customer && b.customer.name) || '').split(' ')[0] || 'tudo bom';

  /* mensagem pronta para o WhatsApp do estabelecimento */
  const msg = 'Olá, ' + (c.name || '') + '! Aqui é ' + firstName + '. '
    + 'Quero ser avisado(a) com antecedência sobre meu agendamento nº ' + (b.code || String(b.id).slice(-6)) + ' — '
    + b.serviceName + ', em ' + fmtDate(b.date) + ' às ' + b.time
    + ', com ' + b.staffName + '. Cliente: ' + (b.customer ? b.customer.name : '') + '. '
    + 'Pode me confirmar?';
  const wa = waLink(msg);

  $('#app').innerHTML =
    '<div class="wordmark">' + esc((c.name || '?').split(' ')[0]) + '</div>'
    + '<div class="thanks-shell">'
    + '<div class="check-ring"><i data-lucide="check"></i></div>'
    + '<h2>Até breve, ' + esc(firstName) + '!</h2>'
    + '<p class="sub">Seu horário está reservado. Chegue com 5 minutinhos de folga.</p>'
    + '<div class="ticket">'
    + '<span class="ticket-notch l"></span><span class="ticket-notch r"></span>'
    + '<div class="ticket-head"><span class="tbrand">' + esc(c.name) + '</span>'
    + '<span class="tnum">Nº ' + esc(b.code || String(b.id).slice(-6)) + '</span></div>'
    + '<div class="ticket-body">'
    + '<div class="srow"><span>Serviço</span><strong>' + esc(b.serviceName) + '</strong></div>'
    + '<div class="srow"><span>Profissional</span><strong>' + esc(b.staffName) + '</strong></div>'
    + '<div class="srow"><span>Data</span><strong>' + fmtDate(b.date) + ' · ' + esc(b.time) + '</strong></div>'
    + '<div class="srow"><span>Cliente</span><strong>' + esc(b.customer.name) + ' · ' + esc(b.customer.phone) + '</strong></div>'
    + '<div class="srow"><span>Pagamento</span><strong>' + esc(payLbl) + '</strong></div>'
    + '<div class="srow total"><span>Valor</span><strong>' + BRL(b.price) + '</strong></div>'
    + '</div></div>'
    + (wa
      ? '<a class="remind-btn" id="remind" href="' + esc(wa) + '" target="_blank" rel="noopener">'
      + '<i data-lucide="message-circle"></i>Avisar pelo WhatsApp</a>'
      + '<p class="hint" style="margin-top:12px">Abrimos o WhatsApp com a mensagem pronta — '
      + 'é só enviar para ser avisado(a) com antecedência.</p>'
      : '<button class="remind-btn" id="remind"><i data-lucide="bell-ring"></i>Avise-me</button>'
        + '<p class="hint" style="margin-top:12px">Cadastre o WhatsApp da empresa no painel para liberar o aviso.</p>')
    + '<div class="thanks-links">'
    + '<a class="link-arrow" href="#/booking">Agendar outro serviço <i data-lucide="arrow-right"></i></a>'
    + '<a class="link-arrow" href="#/home">Voltar ao início <i data-lucide="arrow-right"></i></a>'
    + '</div>'
    + '</div>';

  const btn = $('#remind');
  if (btn && !wa) {
    btn.onclick = function () {
      btn.classList.add('on');
      btn.innerHTML = '<i data-lucide="bell-check"></i>Lembrete ativado';
      refreshIcons();
      toast('Pronto! Você será avisado(a) antes do horário');
    };
  }
}

/* ═════════ 4. LOGIN / 5. CADASTRO ═════════ */
function renderLogin() {
  const firstWord = (CONFIG.company.name || '?').split(' ')[0];
  $('#app').innerHTML =
    '<div class="wordmark">' + esc(firstWord) + '</div>'
    + '<div class="auth-shell">'
    + '<a class="link-arrow auth-back" href="#/home"><i data-lucide="arrow-left"></i>Início</a>'
    + '<div class="auth-card">'
    + '<div class="brand-logo">' + logoHTML() + '</div>'
    + '<h2>Entrar</h2><p class="asub">Bem-vindo(a) de volta ao ' + esc(CONFIG.company.name) + '</p>'
    + '<div class="field"><label>E-mail</label>'
    + '<input class="input" id="l-email" type="email" autocomplete="username" placeholder="voce@email.com"></div>'
    + '<div class="field"><label>Senha</label>'
    + '<input class="input" id="l-pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>'
    + '<button class="btn btn-solid" style="width:100%;justify-content:center" id="l-go">Entrar</button>'
    + '<p class="auth-alt">Ainda não tem conta? <a href="#/cadastro">Cadastre-se</a></p>'
    + (OFFLINE
      ? '<div class="demo-hint"><b>Demonstração (offline)</b><br>'
      + 'Gestor: admin@solano.com · admin123<br>Cliente: cliente@exemplo.com · 123456</div>'
      : '')
    + '</div></div>';
  refreshIcons();

  const tryLogin = async function () {
    const btn = $('#l-go');
    const email = $('#l-email').value.trim(), pass = $('#l-pass').value;
    if (!email || !pass) return toast('Informe e-mail e senha', false);
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const u = await Data.login(email, pass);
      toast('Olá, ' + String(u.name).split(' ')[0] + '!');
      btn.disabled = false; btn.textContent = 'Entrar';
      go(u.role === 'admin' ? '#/admin' : '#/home');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar';
      toast(e.message, false);
    }
  };
  $('#l-go').onclick = tryLogin;
  $('#l-pass').onkeydown = (e) => { if (e.key === 'Enter') tryLogin(); };
}

function renderRegister() {
  const firstWord = (CONFIG.company.name || '?').split(' ')[0];
  $('#app').innerHTML =
    '<div class="wordmark">' + esc(firstWord) + '</div>'
    + '<div class="auth-shell">'
    + '<a class="link-arrow auth-back" href="#/home"><i data-lucide="arrow-left"></i>Início</a>'
    + '<div class="auth-card">'
    + '<div class="brand-logo">' + logoHTML() + '</div>'
    + '<h2>Criar conta</h2><p class="asub">Agende mais rápido e guarde seu histórico</p>'
    + '<div class="field"><label>Nome completo</label>'
    + '<input class="input" id="r-name" placeholder="Seu nome"></div>'
    + '<div class="field"><label>Telefone / WhatsApp</label>'
    + '<input class="input" id="r-phone" placeholder="(11) 90000-0000"></div>'
    + '<div class="field"><label>E-mail</label>'
    + '<input class="input" id="r-email" type="email" placeholder="voce@email.com"></div>'
    + '<div class="field"><label>Senha</label>'
    + '<input class="input" id="r-pass" type="password" placeholder="8+ caracteres, com letra e número"></div>'
    + '<button class="btn btn-solid" style="width:100%;justify-content:center" id="r-go">Criar minha conta</button>'
    + '<p class="auth-alt">Já tem conta? <a href="#/login">Entrar</a></p>'
    + '</div></div>';
  refreshIcons();

  $('#r-phone').oninput = (e) => { e.target.value = maskPhone(e.target.value); };
  $('#r-go').onclick = async function () {
    const name = $('#r-name').value.trim(), phone = $('#r-phone').value,
      email = $('#r-email').value.trim(), pass = $('#r-pass').value;
    if (name.length < 2) return toast('Informe seu nome', false);
    if (phone.replace(/\D/g, '').length < 10) return toast('Telefone inválido', false);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('E-mail inválido', false);
    if (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
      return toast('Senha precisa de 8+ caracteres, com letras e números', false);
    }
    const btn = $('#r-go');
    btn.disabled = true; btn.textContent = 'Criando…';
    try {
      await Data.register({ name: name, email: email, phone: phone, password: pass });
      toast('Conta criada! Bem-vindo(a)');
      go('#/home');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Criar minha conta';
      toast(e.message, false);
    }
  };
}
