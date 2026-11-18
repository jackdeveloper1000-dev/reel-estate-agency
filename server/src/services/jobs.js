/**
 * Background jobs: listing scraping (parallel) and video rendering (one at a
 * time, FIFO queue – FFmpeg already uses all CPU cores).
 */
const fs = require('fs');
const path = require('path');
const Project = require('../models/Project');
const { scrapeListing, scrapeHtml } = require('./scraper');
const { renderVideo } = require('./videoEngine');
const { STORAGE_DIR } = require('../config');

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
  } catch (err) {
    if (signal && signal.aborted) return; // project is being deleted
    console.error(`[render ${id}]`, err.message);
    await update(id, { status: 'error', error: err.message, stage: '' });
  }
}

/** After a restart, jobs that were mid-flight can't resume – mark them clearly. */
async function recoverInterrupted() {
  await Project.recoverInterrupted();
}

module.exports = { runScrape, runScrapeHtml, enqueueRender, cancelRender, recoverInterrupted, projectDir };
