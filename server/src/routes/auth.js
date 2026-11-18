/**
 * Phone + OTP sign-up and login.
 *   POST /api/auth/otp     { phone, purpose: 'signup'|'login', name? }  → sends a 6-digit code
 *   POST /api/auth/verify  { phone, code }                               → creates/logs in the user
 *   GET  /api/auth/me      → current user (or null)
 *   PATCH /api/auth/me     { name }
 *   POST /api/auth/logout
 */
const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../db');
const { APP_SECRET } = require('../config');
const { sendOtp, isConsole } = require('../services/sms');
const { setSession, clearSession, requireUser } = require('../utils/session');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const OTP_TTL_MIN = 5;
const RESEND_AFTER_SEC = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/** Accepts 9876543210, 09876543210, +91 98765 43210, 919876543210 or any +E.164 number. */
function normalizePhone(input) {
  const raw = String(input || '').trim();
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && d.length >= 10 && d.length <= 15) return `+${d}`;
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith('0')) return normalizePhone(d.slice(1));
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  return null;
}

const hashCode = (phone, code) => crypto.createHmac('sha256', APP_SECRET).update(`${phone}:${code}`).digest('hex');
const publicUser = (u) => (u ? { id: u.id, name: u.name, phone: u.phone } : null);

router.post('/otp', wrap(async (req, res) => {
  const db = getPool();
  const purpose = req.body?.purpose === 'signup' ? 'signup' : 'login';
  const phone = normalizePhone(req.body?.phone);
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (purpose === 'signup' && name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });

  const [[existing]] = await db.query('SELECT id FROM users WHERE phone = ?', [phone]);
  if (purpose === 'signup' && existing) {
    return res.status(409).json({ error: 'This number is already registered – please log in.', code: 'ALREADY_REGISTERED' });
  }
  if (purpose === 'login' && !existing) {
    return res.status(404).json({ error: 'No account with this number – please sign up first.', code: 'NOT_REGISTERED' });
  }

  // throttle
  const [[recent]] = await db.query(
    `SELECT COUNT(*) AS n, MAX(created_at) AS last, TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS ago
       FROM otp_codes WHERE phone = ? AND created_at > NOW() - INTERVAL 1 HOUR`, [phone]);
  if (recent.n >= MAX_PER_HOUR) return res.status(429).json({ error: 'Too many codes requested. Please try again in an hour.' });
  if (recent.last && recent.ago < RESEND_AFTER_SEC) {
    return res.status(429).json({ error: `Please wait ${RESEND_AFTER_SEC - recent.ago}s before requesting a new code.` });
  }

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await db.query('UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0', [phone]);
  await db.query(
    `INSERT INTO otp_codes (phone, purpose, name, code_hash, expires_at)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ${OTP_TTL_MIN} MINUTE)`,
    [phone, purpose, purpose === 'signup' ? name : null, hashCode(phone, code)]
  );

  try {
    await sendOtp(phone, code);
  } catch (err) {
    console.error(err.message);
    return res.status(502).json({ error: 'Could not send the SMS right now. Please try again.' });
  }

  res.json({
    ok: true,
    phone,
    resendAfter: RESEND_AFTER_SEC,
    // Only while no SMS provider is configured, so you can test locally
    ...(isConsole() ? { devCode: code } : {}),
  });
}));

router.post('/verify', wrap(async (req, res) => {
  const db = getPool();
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code.' });

  const [[otp]] = await db.query(
    `SELECT * FROM otp_codes WHERE phone = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1`, [phone]);
  if (!otp) return res.status(400).json({ error: 'Code expired – please request a new one.' });
  if (otp.attempts >= MAX_ATTEMPTS) {
    await db.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [otp.id]);
    return res.status(429).json({ error: 'Too many wrong attempts – please request a new code.' });
  }

  const ok = crypto.timingSafeEqual(Buffer.from(otp.code_hash), Buffer.from(hashCode(phone, code)));
  if (!ok) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
    return res.status(400).json({ error: `Wrong code. ${MAX_ATTEMPTS - otp.attempts - 1} attempts left.` });
  }
  await db.query('UPDATE otp_codes SET used = 1 WHERE id = ?', [otp.id]);

  let [[user]] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
  if (!user) {
    if (otp.purpose !== 'signup') return res.status(404).json({ error: 'No account with this number – please sign up.' });
    const [r] = await db.query('INSERT INTO users (name, phone) VALUES (?, ?)', [otp.name || 'User', phone]);
    [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [r.insertId]);
  }
  if (!user.is_active) return res.status(403).json({ error: 'This account is disabled.' });
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  setSession(res, user.id);
  res.json({ user: publicUser(user), isNew: otp.purpose === 'signup' });
}));

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireUser, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  await getPool().query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
  res.json({ user: { ...req.user, name } });
}));

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

module.exports = router;
module.exports.normalizePhone = normalizePhone;
