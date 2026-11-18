const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { PORT, MYSQL, STORAGE_DIR, CLIENT_ORIGIN, FFMPEG, FFMPEG_DRAWTEXT, SCRAPER } = require('./config');
const projectRoutes = require('./routes/projects');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const { loadUser } = require('./utils/session');
const { apiKeyGuard, isValidKey } = require('./utils/apiKey');
const { APP_SECRET, IS_PRODUCTION, PAYMENTS, SMS, API_KEYS } = require('./config');
const { recoverInterrupted } = require('./services/jobs');

fs.mkdirSync(path.join(STORAGE_DIR, 'projects'), { recursive: true });

const app = express();
app.use(cors({ origin: [CLIENT_ORIGIN, /localhost:\d+$/, /127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '15mb' }));
app.set('trust proxy', 1);

app.use('/api', apiKeyGuard); // x-api-key required on every /api route (except /api/health)

app.get('/api/health', async (req, res) => {
  const ok = await db.ping();
  res.json({
    ok: true,
    db: ok ? 'connected' : 'disconnected',
    database: 'mysql',
    apiKey: !API_KEYS.length ? 'not required' : isValidKey(req.get('x-api-key')) ? 'valid' : 'missing or invalid',
    ffmpeg: FFMPEG,
    ffmpegDrawtext: FFMPEG_DRAWTEXT,
    scraperProxy: Boolean(SCRAPER.apiUrl || SCRAPER.proxyUrl),
  });
});
// Friendly error while MySQL is unavailable
app.use(['/api/projects', '/api/auth', '/api/payments', '/media'], (_req, res, next) => {
  if (db.isConnected()) return next();
  res.status(503).json({
    error: 'Database not connected. Start MySQL in the XAMPP Control Panel – the API reconnects automatically.',
  });
});
app.use(['/api', '/media'], loadUser); // adds req.user from the login cookie
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/projects', projectRoutes);

// Photos & rendered films – only the film's owner can view or download them
app.use('/media/projects/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    const [[row]] = await db.getPool().query('SELECT user_id FROM projects WHERE id = ?', [req.params.id]);
    if (!row || Number(row.user_id) !== req.user.id) return res.status(404).json({ error: 'Not found' });
    next();
  } catch (err) { next(err); }
});
app.use('/media', express.static(STORAGE_DIR, { maxAge: 0, fallthrough: false }));

// Serve the built React app in production
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Errors
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (max 25 MB).' });
  if (err && err.status === 404) return res.status(404).json({ error: 'Not found' });
  if (err && (err.status === 503 || ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(err.code))) {
    return res.status(503).json({ error: 'Database not connected. Start MySQL in the XAMPP Control Panel.' });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`✔ ESTAMOTION API running on http://localhost:${PORT}`);
  // Addresses the Flutter app on a real phone (same Wi-Fi) can use
  const lan = Object.values(require('os').networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n.address}:${PORT}`);
  if (lan.length) console.log(`  Mobile app server address (same Wi-Fi): ${lan.join('  ')}`);
});
if (APP_SECRET === 'dev-only-secret-change-me') {
  console.warn(`${IS_PRODUCTION ? '✖' : '!'} APP_SECRET is not set in server/.env – set a long random value before going live.`);
}
console.log(`  Payments: ${PAYMENTS.keyId && PAYMENTS.keySecret ? `Razorpay (${PAYMENTS.keyId.startsWith('rzp_live') ? 'LIVE' : 'test'} keys)` : 'DEMO mode – add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET'} · ₹${PAYMENTS.pricePerFilm} per film`);
console.log(`  API key:  ${API_KEYS.length ? `required (${API_KEYS.length} key${API_KEYS.length > 1 ? 's' : ''})` : 'OFF – set API_KEY in server/.env to protect the API'}`);
console.log(`  SMS/OTP:  ${SMS.provider === 'console' ? 'console – codes are printed here and shown on screen' : SMS.provider}`);

// Connect to MySQL (creates the database + tables on first run). Retries until MySQL is up.
async function connectDb() {
  try {
    const version = await db.connect();
    console.log(`✔ MySQL connected (${version}) – database "${MYSQL.database}" on ${MYSQL.host}:${MYSQL.port}`);
    await recoverInterrupted();
  } catch (err) {
    const hint =
      err.code === 'ECONNREFUSED' ? 'Is MySQL running? Start it in the XAMPP Control Panel.'
      : err.code === 'ER_ACCESS_DENIED_ERROR' ? 'Wrong MYSQL_USER / MYSQL_PASSWORD in server/.env.'
      : '';
    console.error(`✖ Could not connect to MySQL: ${err.message}. ${hint} Retrying in 5s…`);
    setTimeout(connectDb, 5000);
  }
}
connectDb();

const shutdown = async () => {
  try { await db.close(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
