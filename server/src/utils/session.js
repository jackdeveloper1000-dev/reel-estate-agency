/**
 * Login sessions: a signed token in an httpOnly cookie (no extra packages needed).
 * The cookie also travels with <video>/<img> requests, so /media can be protected.
 */
const crypto = require('crypto');
const { APP_SECRET, IS_PRODUCTION } = require('../config');
const { getPool } = require('../db');

const COOKIE = 'ra_session';
const MAX_AGE_DAYS = 30;

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', APP_SECRET).update(data).digest('base64url');

function makeToken(userId) {
  const payload = b64(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_DAYS * 864e5 }));
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(res, userId) {
  res.cookie(COOKIE, makeToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: MAX_AGE_DAYS * 864e5,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

const BRAND_KEYS = ['agentName', 'agentPhone', 'agency', 'cta'];

function parseBrandKit(raw) {
  let obj = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw); } catch { obj = {}; }
  }
  if (!obj || typeof obj !== 'object') obj = {};
  const out = {};
  for (const k of BRAND_KEYS) {
    if (typeof obj[k] === 'string') out[k] = obj[k].trim().slice(0, 200);
  }
  return out;
}

/** Adds req.user ({ id, name, phone, brandKit }) from the login cookie (website) or an
 *  "Authorization: Bearer <token>" header (mobile app). */
async function loadUser(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const data = readToken(bearer || parseCookies(req.headers.cookie)[COOKIE]);
    if (data) {
      const [[u]] = await getPool().query('SELECT id, name, phone, is_active, brand_kit FROM users WHERE id = ?', [data.uid]);
      if (u && u.is_active) req.user = { id: u.id, name: u.name, phone: u.phone, brandKit: parseBrandKit(u.brand_kit) };
    }
  } catch { /* not logged in */ }
  next();
}

function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Please log in to continue.', code: 'LOGIN_REQUIRED' });
}

module.exports = { setSession, clearSession, loadUser, requireUser, makeToken, parseBrandKit };
