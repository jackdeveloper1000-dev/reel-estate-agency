const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv optional */ }

const SERVER_ROOT = path.join(__dirname, '..');

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    if (p) return p;
  } catch (_) { /* fall through */ }
  return 'ffmpeg'; // rely on PATH
}

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
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  FFMPEG: resolveFfmpeg(),
};
