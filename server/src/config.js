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
  SCRAPER: {
    apiUrl: (process.env.SCRAPER_API_URL || '').trim(),
    proxyUrl: (process.env.SCRAPER_PROXY_URL || '').trim(),
    alwaysProxy: String(process.env.SCRAPER_ALWAYS_PROXY || '').toLowerCase() === 'true',
  },
};
