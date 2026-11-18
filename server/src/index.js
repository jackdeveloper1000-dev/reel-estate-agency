const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { PORT, MYSQL, STORAGE_DIR, CLIENT_ORIGIN, FFMPEG } = require('./config');
const projectRoutes = require('./routes/projects');
const { recoverInterrupted } = require('./services/jobs');

fs.mkdirSync(path.join(STORAGE_DIR, 'projects'), { recursive: true });

const app = express();
app.use(cors({ origin: [CLIENT_ORIGIN, /localhost:\d+$/, /127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const ok = await db.ping();
  res.json({ ok: true, db: ok ? 'connected' : 'disconnected', database: 'mysql', ffmpeg: FFMPEG });
});
// Friendly error while MySQL is unavailable
app.use('/api/projects', (_req, res, next) => {
  if (db.isConnected()) return next();
  res.status(503).json({
    error: 'Database not connected. Start MySQL in the XAMPP Control Panel – the API reconnects automatically.',
  });
});
app.use('/api/projects', projectRoutes);

// Photos & rendered films (supports range requests for video seeking)
app.use('/media', express.static(STORAGE_DIR, { maxAge: '1h', fallthrough: false }));

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

app.listen(PORT, () => console.log(`✔ RealAssets AI API running on http://localhost:${PORT}`));

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
