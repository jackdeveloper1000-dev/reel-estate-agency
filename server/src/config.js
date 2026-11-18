const path = require('path');
const { execFileSync } = require('child_process');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv optional */ }

const SERVER_ROOT = path.join(__dirname, '..');

function hasDrawtext(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return /\bdrawtext\b/.test(out);
  } catch {
    return false;
  }
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) {
    const bin = process.env.FFMPEG_PATH;
    return { bin, drawtext: hasDrawtext(bin) };
  }
  const candidates = [];
  try {
    const p = require('ffmpeg-static');
    if (p) candidates.push(p);
  } catch (_) { /* fall through */ }
  if (process.platform !== 'win32') {
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  }
  candidates.push('ffmpeg');

  // Prefer a binary with libfreetype/drawtext enabled (Linux ffmpeg-static builds omit drawtext)
  for (const bin of candidates) {
    if (hasDrawtext(bin)) return { bin, drawtext: true };
  }
  return { bin: candidates[0] || 'ffmpeg', drawtext: false };
}

const ffmpegInfo = resolveFfmpeg();

module.exports = {
  SERVER_ROOT,
  PORT: Number(process.env.PORT) || 5000,
  // MySQL – defaults match a fresh XAMPP install (user root, no password)
  MYSQL: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'realassets_ai',
  },
  STORAGE_DIR: path.resolve(SERVER_ROOT, process.env.STORAGE_DIR || 'storage'),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5180',
  FFMPEG: ffmpegInfo.bin,
  FFMPEG_DRAWTEXT: ffmpegInfo.drawtext,
  // Signs login sessions and OTP hashes. Set a long random value in server/.env.
  APP_SECRET: process.env.APP_SECRET || 'dev-only-secret-change-me',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  SMS: {
    // console = print OTP in the server window (development) | fast2sms | msg91 | twilio
    provider: (process.env.SMS_PROVIDER || 'console').toLowerCase(),
    fast2smsKey: process.env.FAST2SMS_API_KEY || '',
    msg91AuthKey: process.env.MSG91_AUTH_KEY || '',
    msg91OtpTemplateId: process.env.MSG91_OTP_TEMPLATE_ID || '',
    msg91NotifyTemplateId: process.env.MSG91_NOTIFY_TEMPLATE_ID || '',
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
    notifyFilmReady: String(process.env.SMS_NOTIFY_FILM_READY || 'false').toLowerCase() === 'true',
  },
  PAYMENTS: {
    keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    keySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    pricePerFilm: Math.max(1, Number(process.env.PRICE_PER_FILM_INR) || 499), // rupees
    currency: 'INR',
  },
  SCRAPER: {
    apiUrl: (process.env.SCRAPER_API_URL || '').trim(),
    proxyUrl: (process.env.SCRAPER_PROXY_URL || '').trim(),
    alwaysProxy: String(process.env.SCRAPER_ALWAYS_PROXY || '').toLowerCase() === 'true',
  },
};
