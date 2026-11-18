/**
 * Project data access – MySQL version.
 * Returns plain objects shaped like the old Mongoose documents
 * ({ _id, details, settings, images[{ _id, file, … }], video, … })
 * so the routes, jobs and React client keep working unchanged.
 */
const crypto = require('crypto');
const { getPool } = require('../db');

const newId = () => crypto.randomBytes(12).toString('hex'); // 24 hex chars, same as old ObjectIds
const isValidId = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

const ENUMS = {
  format: ['16:9', '9:16', '1:1'],
  transition: ['cinematic', 'smooth', 'dynamic', 'dark'],
  grade: ['golden', 'natural', 'cool', 'mono'],
  motion: ['subtle', 'standard', 'bold'],
  music: ['ambient', 'upload', 'none'],
};
const DEFAULT_SETTINGS = {
  format: '16:9', secondsPerShot: 4, transition: 'cinematic', grade: 'golden',
  motion: 'standard', music: 'ambient', letterbox: true, maxShots: 12,
};
const DEFAULT_DETAILS = { kicker: 'Now Showing', cta: 'Book your private inspection' };
const DETAIL_KEYS = ['title', 'address', 'price', 'description', 'kicker', 'agentName', 'agentPhone', 'agency', 'cta'];

function cleanSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, allowed] of Object.entries(ENUMS)) if (allowed.includes(s[k])) out[k] = s[k];
  if (Number.isFinite(Number(s.secondsPerShot))) out.secondsPerShot = Number(s.secondsPerShot);
  if (Number.isFinite(Number(s.maxShots))) out.maxShots = Math.max(1, Math.round(Number(s.maxShots)));
  if (s.letterbox !== undefined) out.letterbox = !!s.letterbox;
  return out;
}

function cleanDetails(d = {}) {
  const out = { ...DEFAULT_DETAILS };
  for (const k of DETAIL_KEYS) if (typeof d[k] === 'string') out[k] = d[k];
  return out;
}

const parse = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

function fromRow(row, imageRows = []) {
  const video = parse(row.video);
  if (video && video.renderedAt) video.renderedAt = new Date(video.renderedAt);
  return {
    _id: row.id,
    sourceUrl: row.source_url,
    source: row.source,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    error: row.error,
    details: cleanDetails(parse(row.details) || {}),
    settings: cleanSettings(parse(row.settings) || {}),
    images: imageRows.map((r) => ({
      _id: r.id, file: r.file, sourceUrl: r.source_url, width: r.width, height: r.height, selected: !!r.selected,
    })),
    musicFile: row.music_file,
    video: video && video.file ? video : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** New, unsaved project with defaults (like `new Project({...})`). */
function build(data = {}) {
  return {
    _id: newId(),
    sourceUrl: data.sourceUrl || null,
    source: data.source === 'upload' ? 'upload' : 'url',
    status: data.status || 'scraping',
    progress: data.progress || 0,
    stage: data.stage || '',
    error: null,
    details: cleanDetails(data.details || {}),
    settings: cleanSettings(data.settings || {}),
    images: [],
    musicFile: null,
    video: null,
  };
}

async function writeImages(conn, p) {
  await conn.query('DELETE FROM project_images WHERE project_id = ?', [p._id]);
  if (!p.images.length) return;
  for (const img of p.images) if (!img._id) img._id = newId();
  await conn.query(
    'INSERT INTO project_images (id, project_id, position, file, source_url, width, height, selected) VALUES ?',
    [p.images.map((img, i) => [
      String(img._id), p._id, i, img.file, img.sourceUrl || null, img.width || null, img.height || null, img.selected === false ? 0 : 1,
    ])]
  );
}

/** Insert or fully update a project and its photo list (in one transaction). */
async function save(p) {
  p.settings = cleanSettings(p.settings);
  p.details = cleanDetails(p.details);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO projects (id, source_url, source, status, progress, stage, error, details, settings, music_file, video)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE source_url=VALUES(source_url), source=VALUES(source), status=VALUES(status),
         progress=VALUES(progress), stage=VALUES(stage), error=VALUES(error), details=VALUES(details),
         settings=VALUES(settings), music_file=VALUES(music_file), video=VALUES(video)`,
      [p._id, p.sourceUrl || null, p.source, p.status, Math.round(p.progress || 0), (p.stage || '').slice(0, 255),
       p.error || null, JSON.stringify(p.details), JSON.stringify(p.settings), p.musicFile || null,
       p.video ? JSON.stringify(p.video) : null]
    );
    await writeImages(conn, p);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return p;
}

async function create(data) {
  return save(build(data));
}

async function findById(id) {
  if (!isValidId(id)) return null;
  const db = getPool();
  const [[row]] = await db.query('SELECT * FROM projects WHERE id = ?', [String(id)]);
  if (!row) return null;
  const [imgs] = await db.query('SELECT * FROM project_images WHERE project_id = ? ORDER BY position', [row.id]);
  return fromRow(row, imgs);
}

async function list(limit = 40) {
  const db = getPool();
  const [rows] = await db.query('SELECT * FROM projects ORDER BY created_at DESC LIMIT ?', [limit]);
  if (!rows.length) return [];
  const [imgs] = await db.query(
    'SELECT * FROM project_images WHERE project_id IN (?) ORDER BY project_id, position',
    [rows.map((r) => r.id)]
  );
  const byProject = new Map();
  for (const img of imgs) {
    if (!byProject.has(img.project_id)) byProject.set(img.project_id, []);
    byProject.get(img.project_id).push(img);
  }
  return rows.map((r) => fromRow(r, byProject.get(r.id) || []));
}

/** Partial status update used by background jobs: status, stage, progress, error, video. */
async function update(id, patch) {
  const cols = { status: 'status', stage: 'stage', progress: 'progress', error: 'error', video: 'video' };
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!cols[k]) continue;
    sets.push(`${cols[k]} = ?`);
    if (k === 'video') vals.push(v ? JSON.stringify(v) : null);
    else if (k === 'progress') vals.push(Math.round(v || 0));
    else if (k === 'stage') vals.push(String(v || '').slice(0, 255));
    else vals.push(v);
  }
  if (!sets.length) return;
  await getPool().query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [...vals, String(id)]);
}

async function remove(id) {
  await getPool().query('DELETE FROM projects WHERE id = ?', [String(id)]); // images cascade
}

/** After a restart, jobs that were mid-flight can't resume – mark them clearly. */
async function recoverInterrupted() {
  const db = getPool();
  await db.query(
    `UPDATE projects SET status='ready', stage='Render was interrupted – press Generate again', progress=0
      WHERE status IN ('rendering','queued')`
  );
  await db.query(
    `UPDATE projects SET status='error', error='Import was interrupted by a server restart – please try again.'
      WHERE status = 'scraping'`
  );
}

module.exports = { newId, isValidId, build, save, create, findById, list, update, remove, recoverInterrupted };
