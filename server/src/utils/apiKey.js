/**
 * API key protection: every /api request must send "x-api-key: <key>".
 * Keys come from API_KEY in server/.env (comma-separate several keys, e.g. one for the
 * website and one for the mobile app, so each can be changed on its own).
 * /api/health stays open (it only reports status), and /media files are protected by login.
 */
const crypto = require('crypto');
const { API_KEYS } = require('../config');

function isValidKey(key) {
  if (!key) return false;
  const given = Buffer.from(String(key));
  return API_KEYS.some((k) => {
    const real = Buffer.from(k);
    return real.length === given.length && crypto.timingSafeEqual(real, given);
  });
}

function apiKeyGuard(req, res, next) {
  if (!API_KEYS.length || req.path === '/health') return next();
  if (isValidKey(req.get('x-api-key'))) return next();
  res.status(403).json({ error: 'Invalid or missing API key.', code: 'API_KEY' });
}

module.exports = { apiKeyGuard, isValidKey };
