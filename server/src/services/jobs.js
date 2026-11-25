/**
 * Background jobs: listing scraping (parallel) and video rendering (one at a
 * time, FIFO queue – FFmpeg already uses all CPU cores).
 */
const fs = require('fs');
const path = require('path');
const Project = require('../models/Project');
const { scrapeListing, scrapeHtml } = require('./scraper');
const { renderVideo } = require('./videoEngine');
const { STORAGE_DIR, SOURCE_RETENTION_DAYS } = require('../config');

const projectDir = (id) => path.join(STORAGE_DIR, 'projects', String(id));

async function update(id, patch) {
  await Project.update(id, patch);
}

async function finishScrape(id, details, images, autoRender) {
  const fresh = await Project.findById(id);
  if (!fresh) return;
  const max = fresh.settings.maxShots || 12;
  fresh.images = images.map((img, i) => ({ ...img, selected: i < max }));
  for (const k of ['title', 'address', 'price', 'description']) {
    if (!fresh.details[k] && details[k]) fresh.details[k] = details[k].slice(0, 160);
  }
  fresh.status = 'ready';
  fresh.stage = `${images.length} photos ready`;
  fresh.progress = 100;
  fresh.error = null;
  await Project.save(fresh);
  if (autoRender) enqueueRender(id);
}

function makeScrapeProgress(id) {
  let lastWrite = 0;
  return (p) => {
    const now = Date.now();
    if (now - lastWrite < 400) return;
    lastWrite = now;
    if (p.stage === 'found') update(id, { stage: `Found ${p.count} possible photos`, progress: 15 }).catch(() => {});
    if (p.stage === 'download')
      update(id, { stage: `Collecting photos ${p.done}/${p.total}`, progress: 15 + Math.round((p.done / p.total) * 80) }).catch(() => {});
  };
}

async function runScrape(project, { autoRender = false } = {}) {
  const id = project._id;
  try {
    await update(id, { status: 'scraping', stage: 'Reading the listing…', progress: 5, error: null });
    const { details, images } = await scrapeListing(project.sourceUrl, projectDir(id), {
      onProgress: makeScrapeProgress(id),
    });
    await finishScrape(id, details, images, autoRender);
  } catch (err) {
    await update(id, { status: 'error', error: err.message, stage: '' });
  }
}

async function runScrapeHtml(project, html, { autoRender = false } = {}) {
  const id = project._id;
  try {
    await update(id, { status: 'scraping', stage: 'Extracting photos from HTML…', progress: 10, error: null });
    const { details, images } = await scrapeHtml(html, project.sourceUrl, projectDir(id), {
      onProgress: makeScrapeProgress(id),
    });
    await finishScrape(id, details, images, autoRender);
  } catch (err) {
    await update(id, { status: 'error', error: err.message, stage: '' });
  }
}

// ---------- render queue ----------
const queue = [];
let busy = false;
let current = null; // { id, controller }

/** Stop a queued or running render (used by delete). */
async function cancelRender(id) {
  id = String(id);
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  if (current && current.id === id) {
    current.controller.abort();
    // wait for ffmpeg to exit so Windows releases the files
    for (let n = 0; n < 50 && current && current.id === id; n++) await new Promise((r) => setTimeout(r, 100));
  }
}

function enqueueRender(id) {
  id = String(id);
  if (!queue.includes(id)) queue.push(id);
  update(id, { status: 'queued', stage: queue.length > 1 || busy ? 'Waiting in queue…' : 'Starting…', progress: 0, error: null }).catch(() => {});
  setImmediate(drain);
}

async function drain() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  current = { id, controller: new AbortController() };
  try {
    await renderProject(id, current.controller.signal);
  } finally {
    busy = false;
    current = null;
    setImmediate(drain);
  }
}

async function renderProject(id, signal) {
  const project = await Project.findById(id);
  if (!project) return;
  const dir = projectDir(id);
  const workDir = path.join(dir, 'work');
  const selected = project.images.filter((i) => i.selected).map((i) => path.join(dir, i.file)).filter((f) => fs.existsSync(f));
  const endCardRow = project.settings?.endCardImageId
    ? project.images.find((i) => String(i._id) === String(project.settings.endCardImageId))
    : null;
  const endCardImage = endCardRow ? path.join(dir, endCardRow.file) : null;

  try {
    if (!selected.length) throw new Error('Select at least one photo before generating.');
    await update(id, { status: 'rendering', progress: 1, stage: 'Preparing footage' });

    const plain = project;
    const stamp = Date.now();
    const outName = `film_${stamp}.mp4`;
    const outFile = path.join(dir, outName);
    let last = 0;

    const result = await renderVideo({
      images: selected,
      endCardImage,
      details: plain.details || {},
      settings: plain.settings || {},
      musicFile: project.musicFile ? path.join(dir, project.musicFile) : null,
      workDir,
      outFile,
      signal,
      onProgress: (pct, label) => {
        const now = Date.now();
        if (now - last < 700 && pct < 100) return;
        last = now;
        update(id, { progress: Math.max(1, Math.min(99, pct)), stage: label }).catch(() => {});
      },
    });

    // remove the previous film, keep the folder tidy
    if (project.video && project.video.file && project.video.file !== outName) {
      fs.rmSync(path.join(dir, project.video.file), { force: true });
      if (project.video.poster) fs.rmSync(path.join(dir, project.video.poster), { force: true });
    }
    fs.rmSync(workDir, { recursive: true, force: true });

    await update(id, {
      status: 'done',
      progress: 100,
      stage: 'Your film is ready',
      video: {
        file: outName,
        poster: result.poster ? path.basename(result.poster) : null,
        duration: result.duration,
        width: result.width,
        height: result.height,
        renderedAt: new Date(),
      },
    });
    // If immediate deletion is configured (SOURCE_RETENTION_DAYS === 0), clean source files now;
    // otherwise keep them for SOURCE_RETENTION_DAYS so the user can export additional aspect formats.
    if (SOURCE_RETENTION_DAYS === 0) {
      await removeSourceFiles(id, dir, [outName, result.poster ? path.basename(result.poster) : null]);
    }
    notifyFilmReady(project).catch((e) => console.warn('[sms] film-ready message failed:', e.message));
  } catch (err) {
    if (signal && signal.aborted) return; // project is being deleted
    console.error(`[render ${id}]`, err.message);
    await update(id, { status: 'error', error: err.message, stage: '' });
  }
}

/** Delete every file in the project folder except the finished film, and the photo rows in MySQL. */
async function removeSourceFiles(id, dir, keep) {
  const { getPool } = require('../db');
  const keepSet = new Set(keep.filter(Boolean));
  for (const name of fs.readdirSync(dir)) {
    if (keepSet.has(name)) continue;
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (e) { console.warn(`[cleanup ${id}] could not remove ${name}:`, e.message); }
  }
  await getPool().query('DELETE FROM project_images WHERE project_id = ?', [String(id)]);
  await getPool().query('UPDATE projects SET music_file = NULL WHERE id = ?', [String(id)]);
}

/** Optional text message when a film finishes (SMS_NOTIFY_FILM_READY=true). */
async function notifyFilmReady(project) {
  const { SMS } = require('../config');
  if (!SMS.notifyFilmReady || !project.userId) return;
  const { getPool } = require('../db');
  const { sendText } = require('./sms');
  const [[u]] = await getPool().query('SELECT name, phone FROM users WHERE id = ?', [project.userId]);
  if (!u) return;
  const what = (project.details && (project.details.address || project.details.title)) || 'property';
  await sendText(u.phone, `Hi ${u.name.split(' ')[0]}, your ESTAMOTION film for ${what.slice(0, 60)} is ready to download.`);
}

/** After a restart, jobs that were mid-flight can't resume – mark them clearly. */
async function recoverInterrupted() {
  await Project.recoverInterrupted();
}

/** Purge source photos/music on finished films older than SOURCE_RETENTION_DAYS. */
async function purgeExpiredSources() {
  if (SOURCE_RETENTION_DAYS <= 0) return;
  const { getPool } = require('../db');
  const db = getPool();
  const [rows] = await db.query(
    `SELECT p.id, p.video FROM projects p
      WHERE p.status = 'done'
        AND p.updated_at < NOW() - INTERVAL ? DAY
        AND (p.music_file IS NOT NULL OR EXISTS (SELECT 1 FROM project_images pi WHERE pi.project_id = p.id))
      LIMIT 50`,
    [SOURCE_RETENTION_DAYS]
  );
  for (const row of rows) {
    let v = null;
    try { v = typeof row.video === 'string' ? JSON.parse(row.video) : row.video; } catch { /* ignore */ }
    if (!v || !v.file) continue;
    await removeSourceFiles(row.id, projectDir(row.id), [v.file, v.poster || null]);
  }
}

let sweeperTimer = null;
function startRetentionSweeper() {
  if (SOURCE_RETENTION_DAYS <= 0 || sweeperTimer) return;
  purgeExpiredSources().catch((e) => console.warn('[retention]', e.message));
  sweeperTimer = setInterval(() => {
    purgeExpiredSources().catch((e) => console.warn('[retention]', e.message));
  }, 6 * 3600 * 1000);
  if (sweeperTimer.unref) sweeperTimer.unref();
}

module.exports = {
  runScrape,
  runScrapeHtml,
  enqueueRender,
  cancelRender,
  recoverInterrupted,
  removeSourceFiles,
  startRetentionSweeper,
  projectDir,
};
