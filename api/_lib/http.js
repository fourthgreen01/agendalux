'use strict';

/* ═══════════════ HTTP: resposta, validação, rate-limit ═══════════════ */

const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.keys(SAFE_HEADERS).forEach((k) => res.setHeader(k, SAFE_HEADERS[k]));
  res.end(payload === undefined ? '' : JSON.stringify(payload));
}

function ok(res, data) { send(res, 200, data || {}); }
function fail(res, status, message) { send(res, status, { error: String(message || 'Erro') }); }

function methodGuard(res, req, allowed) {
  const m = (req.method || 'GET').toUpperCase();
  if (allowed.indexOf(m) >= 0) return true;
  res.setHeader('Allow', allowed.join(', '));
  fail(res, 405, 'Método não permitido');
  return false;
}

/* ─────────────────────── corpo da requisição ─────────────────────── */
function readBody(req, limit) {
  const max = limit || 900000; /* ~900KB (fotos já reduzidas no navegador) */
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        const err = new Error('Conteúdo muito grande');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('bad');
        resolve(parsed);
      } catch (e) {
        const err = new Error('JSON inválido');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/* ─────────────────── anti-CSRF / origem ─────────────────── */
function sameOrigin(req) {
  const h = req.headers || {};
  const host = String(h.host || '').toLowerCase();
  const site = String(h['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') return false;
  const origin = h.origin || h.referer;
  if (!origin) return true; /* sem Origin = requisição programática/sem navegador */
  let oHost = '';
  try { oHost = new URL(origin).host.toLowerCase(); } catch (e) { return false; }
  return oHost === host;
}

function guardMutation(req) {
  if (sameOrigin(req)) return null;
  return 'Origem inválida (CSRF bloqueado)';
}

/* ─────────────────────── rate limiting ─────────────────────── */
const BUCKETS = new Map();
let lastSweep = Date.now();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (now - lastSweep > 60000) {
    BUCKETS.forEach((v, k) => { if (v.reset <= now) BUCKETS.delete(k); });
    lastSweep = now;
  }
  const k = `${key}`;
  let b = BUCKETS.get(k);
  if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; BUCKETS.set(k, b); }
  b.n += 1;
  return { allowed: b.n <= max, remaining: Math.max(0, max - b.n), reset: b.reset };
}

function limit(req, name, max, windowMs) {
  const ip = (require('./security').clientIp(req) || '0.0.0.0');
  const r = rateLimit(`${name}:${ip}`, max, windowMs);
  if (!r.allowed) {
    const wait = Math.ceil((r.reset - Date.now()) / 1000);
    return `Muitas tentativas. Tente de novo em ${wait}s`;
  }
  return null;
}

/* ─────────────────────── validação ─────────────────────── */
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'app', 'assets', 'static', 'www', 'login', 'cadastro',
  'booking', 'agendar', 'obrigado', 'sobre', 'contato', 'ajuda', 'termos',
  'privacidade', 'favicon', 'robots', 'manifest', 'vercel', 'health'
]);

const clean = (v, max) => String(v === undefined || v === null ? '' : v)
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, max || 200);

const cleanMultiline = (v, max) => String(v || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .trim()
  .slice(0, max || 1000);

const isEmail = (v) => typeof v === 'string' && v.length <= 120 &&
  /^[^\s@,;:<>]+@[^\s@,;:<>"']+\.[A-Za-z]{2,}$/.test(v.trim());

const slugOk = (v) => typeof v === 'string' &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length >= 3 && v.length <= 40 &&
  !RESERVED_SLUGS.has(v);

const digits = (v) => String(v || '').replace(/\D/g, '');

const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function clampMoney(v, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.min(999999, Math.round(n * 100) / 100));
}

function isSafeUrl(v) {
  if (!v) return true;
  const s = String(v).trim();
  if (s.length > 300) return false;
  if (s.startsWith('/')) return true;
  return /^https?:\/\/[^\s"'<>\\]+$/.test(s);
}

function isDataImage(v) {
  return typeof v === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(v) &&
    v.length <= 1400000;
}

function cleanPhone(v) {
  const d = digits(v).slice(0, 15);
  if (d.length < 10) return '';
  return d;
}

function toE164(v, country) {
  let d = digits(v);
  if (!d) return '';
  if ((country || 'BR') === 'BR') {
    if (d.startsWith('0')) d = d.slice(1);
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
    if (d.length === 10 || d.length === 11) return '55' + d;
  }
  return d;
}

function passwordOk(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 72 &&
    !/^\s+$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v);
}

/* ─────────────────────── handler wrapper ─────────────────────── */
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      if (status >= 500) console.error('[api]', req.url, e);
      if (res.headersSent) return;
      fail(res, status, status >= 500 ? 'Erro interno do servidor' : (e.message || 'Erro'));
    }
  };
}

function noDatabase() {
  const e = new Error('Backend não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes)');
  e.status = 503;
  return e;
}

function dbFrom(req) {
  const db = require('./db').admin();
  if (!db) throw noDatabase();
  return db;
}

module.exports = {
  send, ok, fail, methodGuard, readBody, guardMutation, rateLimit, limit,
  clean, cleanMultiline, isEmail, slugOk, digits, isHex, isDate, isTime,
  clampInt, clampMoney, isSafeUrl, isDataImage, cleanPhone, toE164,
  passwordOk, handler, noDatabase, dbFrom, RESERVED_SLUGS
};
