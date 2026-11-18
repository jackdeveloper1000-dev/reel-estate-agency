const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Project = require('../models/Project');
const { runScrape, runScrapeHtml, enqueueRender, cancelRender, projectDir } = require('../services/jobs');
const { imageInfo } = require('../utils/imageInfo');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 40 },
});

const mediaUrl = (id, file) => (file ? `/media/projects/${id}/${encodeURIComponent(file)}` : null);

function serialize(p) {
  const o = p;
  return {
    ...o,
    id: String(o._id),
    images: (o.images || []).map((img) => ({ ...img, id: String(img._id), url: mediaUrl(o._id, img.file) })),
    video: o.video && o.video.file
      ? { ...o.video, url: mediaUrl(o._id, o.video.file), posterUrl: mediaUrl(o._id, o.video.poster) }
      : null,
    musicFile: o.musicFile || null,
  };
}

async function load(req, res) {
  const p = await Project.findById(req.params.id);
  if (!p) res.status(404).json({ error: 'Project not found' });
  return p;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// List recent projects
router.get(
  '/',
  wrap(async (_req, res) => {
    const list = await Project.list(40);
    res.json(list.map(serialize));
  })
);

// Create from listing URL
router.post(
  '/',
  wrap(async (req, res) => {
    let { url, settings, details, autoRender } = req.body || {};
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Please paste a valid property link.' });
    }
    const p = await Project.create({ sourceUrl: url, source: 'url', settings, details });
    runScrape(p, { autoRender: !!autoRender }); // async – client polls
    res.status(201).json(serialize(p));
  })
);

// Create from pasted listing HTML (or direct image URLs)
router.post(
  '/html',
  wrap(async (req, res) => {
    const { html, url, settings, details, autoRender } = req.body || {};
    const raw = String(html || '').trim();
    if (!raw) return res.status(400).json({ error: 'Please paste the listing page HTML.' });
    let sourceUrl = String(url || '').trim();
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) sourceUrl = `https://${sourceUrl}`;
    const p = await Project.create({ sourceUrl: sourceUrl || null, source: 'url', settings, details });
    runScrapeHtml(p, raw, { autoRender: !!autoRender });
    res.status(201).json(serialize(p));
  })
);

// Create from uploaded photos
router.post(
  '/upload',
  upload.array('photos', 40),
  wrap(async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Please choose some photos.' });
    let details = {};
    let settings = {};
    try { details = JSON.parse(req.body.details || '{}'); } catch { /* ignore */ }
    try { settings = JSON.parse(req.body.settings || '{}'); } catch { /* ignore */ }

    const p = Project.build({ source: 'upload', status: 'ready', details, settings, progress: 100 });
    const dir = projectDir(p._id);
    fs.mkdirSync(dir, { recursive: true });
    const images = [];
    for (const f of files) {
      const info = imageInfo(f.buffer);
      if (!info || !['jpg', 'png', 'webp'].includes(info.type)) continue;
      const file = `up_${String(images.length + 1).padStart(2, '0')}_${crypto.randomBytes(3).toString('hex')}.${info.type}`;
      fs.writeFileSync(path.join(dir, file), f.buffer);
      images.push({ file, width: info.width, height: info.height, selected: images.length < (p.settings.maxShots || 12) });
    }
    if (!images.length) return res.status(400).json({ error: 'Only JPG, PNG or WebP photos are supported.' });
    p.images = images;
    p.stage = `${images.length} photos ready`;
    await Project.save(p);
    res.status(201).json(serialize(p));
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (p) res.json(serialize(p));
  })
);

// Update details / settings / photo order & selection
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    const { details, settings, images } = req.body || {};
    if (details && typeof details === 'object') {
      for (const [k, v] of Object.entries(details)) if (typeof v === 'string') p.details[k] = v.slice(0, 200);
    }
    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) p.settings[k] = v; // validated on save
    }
    if (Array.isArray(images)) {
      // images: [{id, selected}] in the desired order
      const byId = new Map(p.images.map((i) => [String(i._id), i]));
      const ordered = [];
      for (const it of images) {
        const img = byId.get(String(it.id));
        if (!img) continue;
        img.selected = !!it.selected;
        ordered.push(img);
        byId.delete(String(it.id));
      }
      p.images = [...ordered, ...byId.values()];
    }
    await Project.save(p);
    res.json(serialize(p));
  })
);

// Add more photos to an existing project
router.post(
  '/:id/photos',
  upload.array('photos', 40),
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    const dir = projectDir(p._id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of req.files || []) {
      const info = imageInfo(f.buffer);
      if (!info || !['jpg', 'png', 'webp'].includes(info.type)) continue;
      const file = `up_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${info.type}`;
      fs.writeFileSync(path.join(dir, file), f.buffer);
      p.images.push({ file, width: info.width, height: info.height, selected: true });
    }
    if (p.status === 'error' && p.images.length) { p.status = 'ready'; p.error = null; }
    await Project.save(p);
    res.json(serialize(p));
  })
);

// Upload a music track
router.post(
  '/:id/music',
  upload.single('music'),
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Please choose an audio file.' });
    const ext = (path.extname(f.originalname || '').toLowerCase() || '.mp3').replace(/[^.a-z0-9]/g, '');
    if (!['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) {
      return res.status(400).json({ error: 'Supported audio: MP3, WAV, M4A, AAC, OGG.' });
    }
    const dir = projectDir(p._id);
    fs.mkdirSync(dir, { recursive: true });
    if (p.musicFile) fs.rmSync(path.join(dir, p.musicFile), { force: true });
    p.musicFile = `music${ext}`;
    fs.writeFileSync(path.join(dir, p.musicFile), f.buffer);
    p.settings.music = 'upload';
    await Project.save(p);
    res.json(serialize(p));
  })
);

// Start rendering
router.post(
  '/:id/render',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    if (['rendering', 'queued', 'scraping'].includes(p.status)) {
      return res.status(409).json({ error: 'This project is already being processed.' });
    }
    if (!p.images.some((i) => i.selected)) return res.status(400).json({ error: 'Select at least one photo.' });
    enqueueRender(p._id);
    p.status = 'queued';
    res.json(serialize(p));
  })
);

// Retry an import
router.post(
  '/:id/retry',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    if (p.source !== 'url') return res.status(400).json({ error: 'Nothing to retry.' });
    runScrape(p);
    p.status = 'scraping';
    res.json(serialize(p));
  })
);

// Import from pasted listing HTML (fallback when a portal blocks the server with HTTP 403)
router.post(
  '/:id/html',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    const raw = String(req.body?.html || '').trim();
    if (!raw) return res.status(400).json({ error: 'Please paste the listing page HTML.' });
    if (req.body?.url && !p.sourceUrl) {
      let u = String(req.body.url).trim();
      if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
      p.sourceUrl = u;
      await Project.save(p);
    }
    runScrapeHtml(p, raw);
    p.status = 'scraping';
    p.error = null;
    res.json(serialize(p));
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const p = await load(req, res);
    if (!p) return;
    await cancelRender(p._id);
    await Project.remove(p._id);
    try {
      fs.rmSync(projectDir(p._id), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      console.warn('Could not remove files for', String(p._id), e.message);
    }
    res.json({ ok: true });
  })
);

module.exports = router;
