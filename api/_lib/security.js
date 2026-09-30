'use strict';

/* ═══════════════ Segurança: hash, sessão e cookies ═══════════════
   • Senha  → PBKDF2-HMAC-SHA256 (150.000 iterações + salt aleatório de 128 bits)
   • Sessão → token aleatório de 256 bits em cookie HttpOnly;
              apenas o SHA-256 do token fica gravado no banco.
   ════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');

const PBKDF2_ITER = 150000;
const KEYLEN = 32;
const COOKIE_NAME = 'al_session';
const SESSION_DAYS = 30;

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITER, KEYLEN, 'sha256')
    .toString('base64url');
  return `pbkdf2$sha256$${PBKDF2_ITER}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
    const iter = parseInt(parts[2], 10);
    if (!Number.isFinite(iter) || iter < 10000 || iter > 1000000) return false;
    const calc = crypto.pbkdf2Sync(String(password), parts[3], iter, KEYLEN, 'sha256');
    const expect = Buffer.from(parts[4], 'base64url');
    if (expect.length !== calc.length) return false;
    return crypto.timingSafeEqual(calc, expect);
  } catch (e) {
    return false;
  }
}

/* ─────────────────────────── cookies ─────────────────────────── */
function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i < 0) return;
    const k = pair.slice(0, i).trim();
    if (!k) return;
    out[k] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function cookie(name, value, opts) {
  const o = Object.assign({ Path: '/', HttpOnly: true, SameSite: 'Lax' }, opts || {});
  let str = `${name}=${encodeURIComponent(value)}`;
  Object.keys(o).forEach((k) => {
    if (o[k] === false || o[k] === undefined || o[k] === null) return;
    str += `; ${k}${o[k] === true ? '' : '=' + o[k]}`;
  });
  return str;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookie(COOKIE_NAME, token, {
    'Max-Age': SESSION_DAYS * 86400,
    Secure: isHttps(res.req)
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie(COOKIE_NAME, '', { 'Max-Age': 0, Secure: isHttps(res.req) }));
}

function isHttps(req) {
  if (!req) return process.env.NODE_ENV === 'production';
  const proto = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
  return String(proto).split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production';
}

function sessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sessionExpiry(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (days || SESSION_DAYS));
  return d.toISOString();
}

/* ───────────────────── leitura da sessão atual ───────────────────── */
async function currentUser(req, db) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || token.length < 20 || token.length > 120) return null;
  if (!db) return null;
  const tokenHash = sha256hex(token);

  const { data: sess, error } = await db
    .from('sessions')
    .select('user_id, tenant_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !sess) return null;
  if (new Date(sess.expires_at).getTime() <= Date.now()) {
    db.from('sessions').delete().eq('token_hash', tokenHash).then(() => {}, () => {});
    return null;
  }

  const { data: user, error: uerr } = await db
    .from('users')
    .select('id, tenant_id, email, name, phone, role, is_active')
    .eq('id', sess.user_id)
    .maybeSingle();
  if (uerr || !user || !user.is_active) return null;
  return { user, tenantId: sess.tenant_id };
}

async function createSession(db, user, req) {
  const token = sessionToken();
  const { error } = await db.from('sessions').insert({
    token_hash: sha256hex(token),
    user_id: user.id,
    tenant_id: user.tenant_id,
    expires_at: sessionExpiry(),
    ip: clientIp(req),
    user_agent: String((req.headers && (req.headers['user-agent'] || '')) || '').slice(0, 200)
  });
  if (error) throw new Error('Não foi possível iniciar a sessão');
  return token;
}

async function destroySession(req, db) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !db) return;
  await db.from('sessions').delete().eq('token_hash', sha256hex(token));
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = h['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return (req.connection && req.connection.remoteAddress) || '';
}

module.exports = {
  sha256hex, hashPassword, verifyPassword,
  parseCookies, setSessionCookie, clearSessionCookie,
  sessionToken, sessionExpiry, currentUser, createSession, destroySession,
  clientIp, COOKIE_NAME
};
