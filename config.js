/* ═══════════════════════════════════════════════════════════════════
   CONFIG.JS — estado global, camada de dados e utilidades

   • Lê a página pelo ENDEREÇO (slug):  /barbearia-do-luiz
   • Fala com a API (/api/*) — Supabase fica atrás do servidor
   • Se a API não responder, entra em MODO DEMONSTRAÇÃO (localStorage)
     e avisa na tela; o site nunca fica em branco.
   ═══════════════════════════════════════════════════════════════════ */

/* ═════════ CONFIGURAÇÃO PADRÃO (usada só como base/fallback) ═════════ */
const DEFAULT_CONFIG = {
  slug: 'atelier-solano',
  company: {
    name: 'Atelier Solano',
    tagline: 'Barbearia & studio de bem-estar',
    phone: '(11) 98765-4321',
    phone_e164: '5511987654321',
    whatsapp_e164: '5511987654321',
    address: 'Rua Harmonia, 182 — Vila Madalena, São Paulo · SP',
    instagram: 'https://instagram.com/atelier.solano',
    facebook: 'https://facebook.com/ateliersolano',
    logo: null
  },
  theme: { bg: '#F4EFE6', surface: '#FDFAF3', ink: '#1D1A16', accent: '#B4652E', line: '#E2D9C8' },
  amenities: [
    { icon: 'wifi', label: 'Wi-Fi gratuito' },
    { icon: 'accessibility', label: 'Acesso cadeirante' },
    { icon: 'baby', label: 'Atende crianças' },
    { icon: 'coffee', label: 'Cafés & bebidas' }
  ],
  hours: {
    0: { open: false, from: '09:00', to: '14:00', slot: 30 },
    1: { open: true, from: '09:00', to: '19:00', slot: 30 },
    2: { open: true, from: '09:00', to: '19:00', slot: 30 },
    3: { open: true, from: '09:00', to: '19:00', slot: 30 },
    4: { open: true, from: '09:00', to: '20:00', slot: 30 },
    5: { open: true, from: '09:00', to: '20:00', slot: 30 },
    6: { open: true, from: '09:00', to: '18:00', slot: 30 }
  },
  services: [
    { id: 's1', name: 'Corte Signature', desc: 'Consultoria de visagismo, corte e finalização', price: 70, dur: 45 },
    { id: 's2', name: 'Corte + Barba', desc: 'Corte completo com toalha quente e navalhado', price: 110, dur: 75 },
    { id: 's3', name: 'Barba Terapia', desc: 'Modelagem, óleos e compressa morna', price: 50, dur: 30 },
    { id: 's4', name: 'Ritual Completo', desc: 'Corte, barba, hidratação e massageamento', price: 160, dur: 90 }
  ],
  staff: [
    { id: 'p1', name: 'Rafael Moretti', role: 'Barbeiro sênior' },
    { id: 'p2', name: 'Diego Antunes', role: 'Barbeiro' },
    { id: 'p3', name: 'Larissa Prado', role: 'Colorista' }
  ]
};

/* ═════════ chaves locais (modo demonstração) ═════════ */
const K = {
  cfg: 'al.config',
  bkg: 'al.bookings',
  usr: 'al.users',
  ses: 'al.session',
  last: 'al.lastBooking',
  demo: 'al.demoSeeded'
};

function readStore(k, f) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? f : v; }
  catch (e) { return f; }
}
function writeStore(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ }
}

/* ═════════ estado em memória ═════════ */
let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let TENANT_SLUG = DEFAULT_CONFIG.slug;
let OFFLINE = false;          /* true = sem backend, modo demonstração */
let SESSION = null;           /* {id,name,email,phone,role} — a senha nunca fica aqui */
const AVAIL = {};             /* cache de horários ocupados por data */

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function mergeConfig(base, extra) {
  const out = Object.assign(clone(base), extra || {});
  ['hours', 'theme'].forEach((k) => {
    out[k] = Object.assign(clone(DEFAULT_CONFIG[k]), (extra && extra[k]) || {});
  });
  return out;
}

/* ═════════ API (mesmo domínio, cookie HttpOnly) ═════════ */
const API = {
  async req(path, opts) {
    const o = opts || {};
    const init = {
      method: o.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (o.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    let res;
    try { res = await fetch(path, init); }
    catch (e) { const err = new Error('Sem conexão com o servidor'); err.status = 0; throw err; }

    const text = await res.text();
    const ctype = String(res.headers.get('content-type') || '');
    if (ctype.indexOf('json') < 0) {
      /* respondeu HTML (ex.: rewrite errado) — não dá para usar a API */
      const err = new Error('O servidor não respondeu dados (verifique o deploy)');
      err.status = res.status || 503;
      throw err;
    }
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }

    if (!res.ok) {
      const err = new Error(data.error || ('Erro ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST', body: body }); },
  put(p, body) { return this.req(p, { method: 'PUT', body: body }); },
  del(p) { return this.req(p, { method: 'DELETE' }); }
};

function qs(params) {
  const p = Object.keys(params || {})
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return p.length ? '?' + p.join('&') : '';
}

/* ═════════ camada de dados (API ou demonstração local) ═════════ */
const Data = {
  /* — página pública — */
  async config(slug) {
    const target = slug || TENANT_SLUG;
    return API.get('/api/public' + qs({ slug: target }));
  },

  async availability(date) {
    if (AVAIL[date]) return AVAIL[date];
    if (OFFLINE) { const busy = occupiedOnLocal(date); AVAIL[date] = busy; return busy; }
    const r = await API.get('/api/availability' + qs({ slug: TENANT_SLUG, date: date }));
    AVAIL[date] = r.busy || {};
    return AVAIL[date];
  },

  /* — sessão — */
  async login(email, password) {
    if (OFFLINE) return localLogin(email, password);
    const r = await API.post('/api/auth' + qs({ action: 'login' }), { slug: TENANT_SLUG, email: email, password: password });
    setSession(r.user);
    return r.user;
  },
  async register(payload) {
    if (OFFLINE) return localRegister(payload);
    const r = await API.post('/api/auth' + qs({ action: 'register' }), Object.assign({ slug: TENANT_SLUG }, payload));
    setSession(r.user);
    return r.user;
  },
  async logout() {
    if (!OFFLINE) { try { await API.post('/api/auth' + qs({ action: 'logout' }), {}); } catch (e) { /* segue */ } }
    setSession(null);
  },
  async restoreSession() {
    const cached = readStore(K.ses, null);
    if (OFFLINE) { SESSION = cached && cached.id ? cached : null; return SESSION; }
    try {
      const r = await API.get('/api/auth' + qs({ action: 'me' }));
      SESSION = r.user;
      writeStore(K.ses, SESSION);
    } catch (e) {
      if (e.status === 401) { SESSION = null; writeStore(K.ses, null); }
      else SESSION = cached && cached.id ? cached : null;
    }
    return SESSION;
  },

  /* — agendamentos — */
  async createBooking(payload) {
    if (OFFLINE) return localCreateBooking(payload);
    const r = await API.post('/api/bookings', Object.assign({ slug: TENANT_SLUG }, payload));
    return r.booking;
  },
  async bookings() {
    if (OFFLINE) return readStore(K.bkg, []).slice().reverse();
    const r = await API.get('/api/bookings' + qs({ slug: TENANT_SLUG }));
    return r.bookings || [];
  },
  async setBookingStatus(id, status) {
    if (OFFLINE) {
      const all = readStore(K.bkg, []);
      all.forEach((b) => { if (b.id === id) b.status = status; });
      writeStore(K.bkg, all);
      return true;
    }
    await API.req('/api/bookings/' + encodeURIComponent(id) + qs({ slug: TENANT_SLUG }),
      { method: 'PATCH', body: { status: status } });
    return true;
  },

  /* — painel — */
  async adminConfig() {
    if (OFFLINE) return clone(CONFIG);
    return API.get('/api/admin' + qs({ section: 'config', slug: TENANT_SLUG }));
  },
  async saveConfig(patch) {
    if (OFFLINE) {
      CONFIG = applyFlatPatch(CONFIG, patch);
      if (patch.slug) TENANT_SLUG = patch.slug;
      writeStore(K.cfg, CONFIG);
      applyTheme();
      return clone(CONFIG);
    }
    const r = await API.put('/api/admin' + qs({ section: 'config', slug: TENANT_SLUG }), patch);
    CONFIG = mergeConfig(CONFIG, r);
    applyTheme();
    return r;
  },

  async services() {
    if (OFFLINE) return clone(CONFIG.services || []);
    const r = await API.get('/api/admin' + qs({ section: 'services', slug: TENANT_SLUG }));
    return r.services || [];
  },
  async saveService(s) {
    if (OFFLINE) {
      if (s.id) CONFIG.services = CONFIG.services.map((x) => x.id === s.id ? Object.assign(x, s) : x);
      else CONFIG.services.push(Object.assign({ id: 's' + Date.now() }, s));
      writeStore(K.cfg, CONFIG);
      return true;
    }
    if (s.id) await API.put('/api/admin' + qs({ section: 'services', id: s.id, slug: TENANT_SLUG }), s);
    else await API.post('/api/admin' + qs({ section: 'services', slug: TENANT_SLUG }), s);
    return true;
  },
  async deleteService(id) {
    if (OFFLINE) {
      CONFIG.services = CONFIG.services.filter((x) => x.id !== id);
      writeStore(K.cfg, CONFIG);
      return { ok: true };
    }
    return API.del('/api/admin' + qs({ section: 'services', id: id, slug: TENANT_SLUG }));
  },

  async staff() {
    if (OFFLINE) return clone(CONFIG.staff || []);
    const r = await API.get('/api/admin' + qs({ section: 'staff', slug: TENANT_SLUG }));
    return r.staff || [];
  },
  async saveStaff(p) {
    if (OFFLINE) {
      const data = { name: p.name, role: p.role, phone: p.phone || '' };
      if (p.photo !== undefined) data.photo = p.photo || null;
      if (p.id) CONFIG.staff = CONFIG.staff.map((x) => x.id === p.id ? Object.assign(x, data) : x);
      else CONFIG.staff.push(Object.assign({ id: 'p' + Date.now(), photo: null }, data));
      writeStore(K.cfg, CONFIG);
      return true;
    }
    if (p.id) await API.put('/api/admin' + qs({ section: 'staff', id: p.id, slug: TENANT_SLUG }), p);
    else await API.post('/api/admin' + qs({ section: 'staff', slug: TENANT_SLUG }), p);
    return true;
  },
  async deleteStaff(id) {
    if (OFFLINE) {
      CONFIG.staff = CONFIG.staff.filter((x) => x.id !== id);
      writeStore(K.cfg, CONFIG);
      return { ok: true };
    }
    return API.del('/api/admin' + qs({ section: 'staff', id: id, slug: TENANT_SLUG }));
  }
};

/* ═════════ sessão (cache local sem senha) ═════════ */
function setSession(user) {
  SESSION = user || null;
  writeStore(K.ses, SESSION);
}
const session = () => SESSION;

/* ═════════ slug da página (multi-tenant) ═════════ */
function slugFromPath() {
  let p = String(location.pathname || '').replace(/^\/+|\/+$/g, '');
  if (!p) return '';
  if (/\.[a-z0-9]{1,5}$/i.test(p)) return '';            /* arquivo estático */
  p = p.split('/')[0].toLowerCase();
  if (p === 'api' || p === 'index.html') return '';
  if (!/^[a-z0-9-]{3,40}$/.test(p)) return '';
  return p;
}
function goToSlug(slug) {
  const base = '/' + String(slug || '').replace(/^\/+|\/+$/g, '');
  history.pushState({}, '', base || '/');
  TENANT_SLUG = (base || '/').replace(/^\/+|\/+$/g, '') || DEFAULT_CONFIG.slug;
}
window.addEventListener('popstate', function () {
  const s = slugFromPath();
  if (s && s !== TENANT_SLUG) location.reload();
});

/* ═════════ WhatsApp (wa.me com mensagem pronta) ═════════ */
function waNumber() {
  const c = CONFIG.company || {};
  let n = String(c.whatsapp_e164 || c.phone_e164 || c.phone || '').replace(/\D/g, '');
  if (n && n.slice(0, 2) !== '55' && n.length >= 10 && n.length <= 11) n = '55' + n;
  return n;
}
function waLink(text) {
  const n = waNumber();
  if (!n) return null;
  return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
}

/* ═════════ utilidades ═════════ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DOW = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DOWs = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PAY_LABEL = { pix: 'Pix — reservado, confirmar no local', card: 'Cartão — no local', cash: 'Dinheiro — no local' };

function fmtDate(iso) {
  const p = String(iso || '').split('-').map(Number);
  if (p.length !== 3 || !p[0]) return String(iso || '');
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}
function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const toMin = (t) => { const p = String(t || '0:0').split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); };

function refreshIcons() {
  try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (e) { /* CDN fora do ar */ }
}

function toast(msg, ok) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const t = document.createElement('div');
  t.className = 'toast' + (ok === false ? ' err' : '');
  t.innerHTML = '<i data-lucide="' + (ok === false ? 'alert-circle' : 'check-circle-2') + '"></i>' + esc(msg);
  root.appendChild(t);
  refreshIcons();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3400);
}
function openModal(html) {
  document.getElementById('modal-root').innerHTML =
    '<div class="overlay" data-overlay><div class="modal">' + html + '</div></div>';
  document.body.style.overflow = 'hidden';
  refreshIcons();
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.body.style.overflow = '';
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.matches && e.target.matches('[data-overlay]')) closeModal();
  if (e.target && e.target.closest && e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function maskPhone(v) {
  v = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (v.length <= 10) return v.replace(/(\d{2})(\d{0,4})(\d{0,4}).*/, '($1) $2-$3').replace(/[-\s)]+$/, '');
  return v.replace(/(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3');
}

/* ═════════ tema (com guarda de contraste) ═════════ */
function hexToRgb(h) {
  h = String(h || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.substr(0, 2), 16) || 0, parseInt(h.substr(2, 2), 16) || 0, parseInt(h.substr(4, 2), 16) || 0];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function colorMixed(a, b, pct) {
  const p = (h) => { h = String(h).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) || 0); };
  try {
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v * (pct / 100) + B[i] * (1 - pct / 100))
      .toString(16).padStart(2, '0')).join('');
  } catch (e) { return '#8B8172'; }
}
function luminance(hex) {
  const c = hexToRgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function fixTheme(t) {
  if (contrastRatio(t.ink, t.bg) < 4.5) t.ink = luminance(t.bg) > 0.4 ? '#1D1A16' : '#EDE8E0';
  if (contrastRatio(t.accent, t.bg) < 2.6) {
    t.accent = luminance(t.bg) > 0.4
      ? colorMixed('#000000', t.accent, 45)
      : colorMixed('#FFFFFF', t.accent, 40);
  }
  if (contrastRatio(t.line, t.bg) < 1.15 || contrastRatio(t.line, t.bg) > 3) t.line = colorMixed(t.ink, t.bg, 18);
  if (contrastRatio(t.surface, t.bg) < 1.08) {
    t.surface = luminance(t.bg) > 0.4 ? colorMixed('#FFFFFF', t.bg, 8) : colorMixed('#FFFFFF', t.bg, 4);
  }
  return t;
}
function applyTheme() {
  const t = fixTheme(Object.assign({}, DEFAULT_CONFIG.theme, CONFIG.theme || {}));
  CONFIG.theme = t;
  const r = document.documentElement.style;
  ['bg', 'surface', 'ink', 'accent', 'line'].forEach((k) => r.setProperty('--' + k, t[k]));
  r.setProperty('--muted', colorMixed(t.ink, t.bg, 58));
}
applyTheme();

/* logo: URL enviada pelo painel ou monograma padrão */
function logoHTML() {
  const name = (CONFIG.company.name || '?').trim();
  const words = name.split(/\s+/);
  const ini = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
  if (CONFIG.company.logo) {
    return '<img src="' + esc(CONFIG.company.logo) + '" alt="' + esc(name) + '" loading="lazy">';
  }
  return '<svg viewBox="0 0 100 100" role="img" aria-label="' + esc(name) + '">'
    + '<circle cx="50" cy="50" r="49" fill="var(--ink)"/>'
    + '<circle cx="50" cy="50" r="42.5" fill="none" stroke="var(--accent)" stroke-width="1.2"/>'
    + '<text x="50" y="59" text-anchor="middle" font-family="Fraunces,Georgia,serif" font-size="34" '
    + 'font-style="italic" fill="var(--bg)">' + esc(ini) + '</text></svg>';
}

/* status aberto/fechado */
function openStatus() {
  const now = new Date();
  const h = (CONFIG.hours || {})[now.getDay()];
  if (!h || !h.open) return { open: false, label: 'Fechado hoje' };
  const cur = now.getHours() * 60 + now.getMinutes();
  if (cur >= toMin(h.from) && cur < toMin(h.to)) return { open: true, label: 'Aberto agora · até ' + h.to };
  return { open: false, label: 'Fechado · abre ' + h.from };
}

function go(hash) { location.hash = hash; }

/* horários ocupados (modo demonstração) */
function occupiedOnLocal(date) {
  const occ = {};
  readStore(K.bkg, []).filter((b) => b.date === date && b.status !== 'cancelado')
    .forEach((b) => { if (!occ[b.time]) occ[b.time] = []; occ[b.time].push(b.staffId); });
  return occ;
}

/* ═════════ registro de erro (nunca tela branca silenciosa) ═════════ */
window.onerror = function (msg, src, line) {
  try {
    const root = document.getElementById('toast-root');
    if (root) {
      const t = document.createElement('div');
      t.className = 'toast err';
      t.textContent = 'Erro JS: ' + msg + ' (linha ' + line + ')';
      root.appendChild(t);
      setTimeout(() => t.remove(), 5000);
    }
  } catch (e) { /* ignora */ }
  return false;
};

/* ═══════════════════════════════════════════════════════════════════
   MODO DEMONSTRAÇÃO — usado quando o backend não responde (ex.: rodando
   direto no disco, ou Supabase ainda não configurado).
   ═══════════════════════════════════════════════════════════════════ */
function localConfig() {
  const saved = readStore(K.cfg, null);
  const base = saved ? mergeConfig(DEFAULT_CONFIG, saved) : clone(DEFAULT_CONFIG);
  if (!saved) writeStore(K.cfg, base);
  return base;
}

/* mesmo formato de "patch" usado pela API, aplicado ao CONFIG local */
function applyFlatPatch(cfg, patch) {
  const out = clone(cfg);
  out.company = out.company || {};
  ['name', 'tagline', 'phone', 'address', 'instagram', 'facebook'].forEach((k) => {
    if (patch[k] !== undefined) out.company[k] = patch[k];
  });
  if (patch.whatsapp !== undefined) out.company.whatsapp_e164 = String(patch.whatsapp).replace(/\D/g, '');
  if (patch.logo !== undefined) out.company.logo = patch.logo || null;
  if (patch.theme) out.theme = Object.assign({}, out.theme, patch.theme);
  if (patch.amenities !== undefined) out.amenities = patch.amenities;
  if (patch.hours !== undefined) out.hours = patch.hours;
  if (patch.slug) out.slug = patch.slug;
  return out;
}

function seedDemo() {
  if (readStore(K.demo, false)) return;
  writeStore(K.demo, true);
  const demo = [];
  const sv = CONFIG.services, st = CONFIG.staff;
  const names = [['Marina Costa', '(11) 99111-0001'], ['Otávio Lima', '(11) 99111-0002'],
  ['Bruna Ferraz', '(11) 99111-0003'], ['Théo Ramos', '(11) 99111-0004'],
  ['Carla Nunes', '(11) 99111-0005'], ['André Siqueira', '(11) 99111-0006'],
  ['Paula Rego', '(11) 99111-0007'], ['Fábio Terra', '(11) 99111-0008']];
  const pays = ['pix', 'pix', 'card', 'cash', 'card', 'pix', 'cash', 'card'];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (12 - i * 2));
    demo.push({
      id: 'd' + i, serviceId: sv[i % sv.length].id, serviceName: sv[i % sv.length].name,
      price: sv[i % sv.length].price, date: d.toISOString().slice(0, 10),
      time: (9 + (i % 8)) + ':00', staffId: st[i % st.length].id, staffName: st[i % st.length].name,
      customer: { name: names[i][0], phone: names[i][1], email: '' },
      payment: pays[i], notes: '', status: 'concluido', createdAt: Date.now()
    });
  }
  writeStore(K.bkg, demo);

  writeStore(K.usr, [
    { id: 'u1', name: 'Gestor Solano', email: 'admin@solano.com', phone: '(11) 98765-4321', pass: 'admin123', isStaff: true },
    { id: 'u2', name: 'Marina Costa', email: 'cliente@exemplo.com', phone: '(11) 99111-0001', pass: '123456', isStaff: false }
  ]);
}

function localLogin(email, password) {
  const users = readStore(K.usr, []);
  const u = users.find((x) => String(x.email).toLowerCase() === String(email).toLowerCase().trim()
    && x.pass === password);
  if (!u) throw new Error('E-mail ou senha incorretos');
  const safe = { id: u.id, name: u.name, email: u.email, role: u.isStaff ? 'admin' : 'customer' };
  setSession(safe);
  return safe;
}

function localRegister(p) {
  const users = readStore(K.usr, []);
  if (users.some((x) => String(x.email).toLowerCase() === String(p.email).toLowerCase().trim())) {
    throw new Error('Este e-mail já tem conta — faça login');
  }
  const u = { id: 'u' + Date.now(), name: p.name, phone: p.phone, email: p.email, pass: p.password, isStaff: false };
  users.push(u);
  writeStore(K.usr, users);
  const safe = { id: u.id, name: u.name, email: u.email, role: 'customer' };
  setSession(safe);
  return safe;
}

function localCreateBooking(p) {
  const svc = (CONFIG.services || []).find((s) => s.id === p.serviceId);
  const stf = (CONFIG.staff || []).find((s) => s.id === p.staffId);
  if (!svc || !stf) throw new Error('Serviço ou profissional não encontrado');
  const booking = {
    id: 'b' + Date.now(), serviceId: svc.id, serviceName: svc.name, price: svc.price,
    staffId: stf.id, staffName: stf.name,
    date: p.date, time: p.time,
    payment: p.payment, notes: p.notes || '', status: 'confirmado',
    customer: p.customer, createdAt: Date.now()
  };
  const all = readStore(K.bkg, []);
  all.push(booking);
  writeStore(K.bkg, all);
  return booking;
}

/* ═══════════════════════════════════════════════════════════════════
   BOOT — carrega a página do endereço, depois renderiza
   ═══════════════════════════════════════════════════════════════════ */
function showNotFound(slug, customMsg) {
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '<div class="notfound">'
      + '<div class="nf-mark">?</div>'
      + '<h1>Página não encontrada</h1>'
      + '<p>' + (customMsg
        ? esc(customMsg)
        : 'Não existe nenhuma agenda publicada em <b>/' + esc(slug) + '</b>.') + '</p>'
      + '<a class="btn btn-solid" href="/">Ir para a página inicial</a>'
      + '</div>';
  }
  document.title = 'Página não encontrada · AgendaLux';
  if (window.Splash) Splash.done();
}

async function boot() {
  const want = slugFromPath();

  if (window.Splash) Splash.step('Carregando configurações…', 45);

  let cfg = null;
  try {
    cfg = await Data.config(want);
    OFFLINE = false;
    TENANT_SLUG = cfg.slug || want || DEFAULT_CONFIG.slug;
    CONFIG = mergeConfig(DEFAULT_CONFIG, cfg);
  } catch (e) {
    if (e.status === 404) {
      showNotFound(want, want ? '' : 'Nenhuma empresa foi publicada ainda.');
      return;
    }
    OFFLINE = true;
    TENANT_SLUG = want || DEFAULT_CONFIG.slug;
    cfg = localConfig();
    CONFIG = mergeConfig(DEFAULT_CONFIG, cfg);
    TENANT_SLUG = CONFIG.slug || TENANT_SLUG;
    seedDemo();
  }

  applyTheme();
  document.title = (CONFIG.company.name || 'Agendamentos') + ' · Agendamentos';

  if (window.Splash) Splash.step('Quase pronto…', 75);
  await Data.restoreSession();

  /* rota inicial */
  try {
    if (typeof route === 'function') route();
    else location.hash = location.hash || '#/home';
  } catch (e) {
    console.error(e);
    toast('Erro ao renderizar a página: ' + e.message, false);
  }
  refreshIcons();

  if (OFFLINE) {
    setTimeout(() => toast('Modo demonstração — servidor offline, dados só neste navegador', false), 700);
  }

  if (window.Splash) Splash.done();
}

/* navegação do histórico (voltar/avançar) */
window.addEventListener('popstate', () => { if (typeof route === 'function') route(); });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();

function startApp() {
  boot().catch((e) => {
    console.error('[boot]', e);
    if (window.Splash) Splash.fail('Não foi possível iniciar a aplicação: ' + (e.message || e));
  });
}
