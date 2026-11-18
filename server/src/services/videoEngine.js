/**
 * Cinematic video engine (FFmpeg).
 *  1. Each photo -> its own shot with an eased camera move (push-in, pull-out,
 *     pans, tilt) + colour grade, rendered from a 2x supersampled frame to keep
 *     motion smooth.
 *  2. A branded end card (blurred last photo + agent details).
 *  3. Shots joined with cinematic cross-transitions, title overlay, letterbox,
 *     fades, and a music bed (built-in ambient score or uploaded track).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { FFMPEG, SERVER_ROOT } = require('../config');

const FPS = 30;
const GOLD = '0xD4AF37';
const FONT_DIR = path.join(SERVER_ROOT, 'assets', 'fonts');

const FORMATS = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
};

const TRANSITIONS = {
  cinematic: ['fade', 'dissolve', 'smoothleft', 'fadeblack', 'smoothup', 'circleopen', 'fade', 'smoothright'],
  smooth: ['fade', 'dissolve'],
  dynamic: ['smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'slideleft', 'circleopen', 'wipeleft'],
  dark: ['fadeblack'],
};

const GRADES = {
  golden: 'eq=contrast=1.07:saturation=1.12:gamma=0.98,colorbalance=rs=0.035:gs=0.01:bs=-0.04:rm=0.025:bm=-0.03:rh=0.02:bh=-0.02,vignette=angle=PI/5',
  natural: 'eq=contrast=1.04:saturation=1.06,vignette=angle=PI/6',
  cool: 'eq=contrast=1.06:saturation=1.0,colorbalance=rs=-0.03:bs=0.04:bm=0.02,vignette=angle=PI/5',
  mono: 'hue=s=0,eq=contrast=1.15:brightness=-0.01,vignette=angle=PI/4.5',
};

// Camera moves. E = eased progress 0..1 (cosine ease-in-out). Z = max extra zoom.
const MOVES = {
  pushIn: { z: '1+Z*E', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2' },
  pullOut: { z: '1+Z*(1-E)', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2' },
  panRight: { z: '1+Z', x: '(iw-iw/zoom)*E', y: '(ih-ih/zoom)/2' },
  panLeft: { z: '1+Z', x: '(iw-iw/zoom)*(1-E)', y: '(ih-ih/zoom)/2' },
  tiltUp: { z: '1+Z', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)*(1-E)' },
  driftIn: { z: '1+Z*E', x: '(iw-iw/zoom)*(0.25+0.5*E)', y: '(ih-ih/zoom)*(0.6-0.2*E)' },
};
const LANDSCAPE_SEQ = ['pushIn', 'panRight', 'pullOut', 'driftIn', 'panLeft', 'tiltUp'];
const PORTRAIT_SEQ = ['panRight', 'pushIn', 'panLeft', 'driftIn', 'panRight', 'pullOut'];

let currentSignal = null; // set per render so every ffmpeg call can be cancelled

function run(args, { cwd = SERVER_ROOT, totalSec, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (currentSignal && currentSignal.aborted) return reject(new Error('Cancelled'));
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { cwd, windowsHide: true });
    const onAbort = () => { try { p.kill('SIGKILL'); } catch { /* ignore */ } };
    if (currentSignal) currentSignal.addEventListener('abort', onAbort, { once: true });
    let tail = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (onProgress && totalSec) {
        const m = s.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / totalSec));
      }
    });
    p.on('error', (e) => reject(new Error(`Could not start FFmpeg (${FFMPEG}): ${e.message}`)));
    p.on('close', (code) => (currentSignal && currentSignal.aborted ? reject(new Error('Cancelled')) : code === 0 ? resolve() : reject(new Error(`FFmpeg failed (code ${code}): ${tail.split('\n').slice(-6).join(' ')}`))));
  });
}

/** Path relative to cwd with forward slashes – avoids Windows "C:" escaping issues inside filters. */
const rel = (p, cwd = SERVER_ROOT) => path.relative(cwd, p).split(path.sep).join('/');

const fadeAlpha = (start, end, f = 0.6) =>
  `'if(lt(t,${start}),0,if(lt(t,${start + f}),(t-${start})/${f},if(lt(t,${end - f}),1,if(lt(t,${end}),(${end}-t)/${f},0))))'`;

function drawText({ textFile, font, size, color = 'white', x = '(w-text_w)/2', y, alpha, shadow = true, spacing }) {
  const parts = [
    `fontfile=${rel(path.join(FONT_DIR, font))}`,
    `textfile=${rel(textFile)}`,
    `fontsize=${Math.round(size)}`,
    `fontcolor=${color}`,
    `x=${x}`,
    `y=${y}`,
  ];
  if (alpha) parts.push(`alpha=${alpha}`);
  if (shadow) parts.push('shadowcolor=black@0.55', 'shadowx=2', 'shadowy=2');
  if (spacing) parts.push(`line_spacing=${spacing}`);
  return `drawtext=${parts.join(':')}`;
}

/** Shrink font so a single line fits ~88% of the frame width. */
const fit = (text, size, w) => Math.min(size, (w * 0.88) / (Math.max(1, String(text || '').length) * 0.52));

function writeText(dir, name, text) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, String(text || '').replace(/\r/g, '').trim(), 'utf8');
  return f;
}

/** Render one photo into a moving shot. */
async function renderShot({ input, out, w, h, seconds, move, grade, zoom }) {
  const frames = Math.round(seconds * FPS);
  const E = `((1-cos(PI*on/${frames}))/2)`;
  const m = MOVES[move];
  const expr = (s) => s.replace(/E/g, E).replace(/Z/g, String(zoom));
  const W2 = w * 2;
  const H2 = h * 2;
  const vf = [
    `scale=${W2}:${H2}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W2}:${H2}`,
    `zoompan=z='${expr(m.z)}':x='${expr(m.x)}':y='${expr(m.y)}':d=${frames}:s=${w}x${h}:fps=${FPS}`,
    GRADES[grade] || GRADES.golden,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  await run(['-i', input, '-vf', vf, '-frames:v', String(frames), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-an', out]);
}

/** Branded end card: blurred final photo + agent details. */
async function renderEndCard({ input, out, w, h, seconds, details, workDir }) {
  const frames = Math.round(seconds * FPS);
  const u = Math.min(w, h) / 1080; // type scale unit
  const lines = [];
  const add = (name, text, font, size, color, y, start) => {
    if (!text) return;
    const tf = writeText(workDir, name, text);
    lines.push(drawText({ textFile: tf, font, size: fit(text, size * u, w), color, y, alpha: fadeAlpha(start, seconds + 1, 0.7), shadow: false }));
  };
  const cy = h / 2;
  add('end_cta.txt', (details.cta || 'Book your private inspection').toUpperCase(), 'Poppins-Light.ttf', 30, GOLD, `${cy - 190 * u}`, 0.2);
  add('end_agent.txt', details.agentName, 'Lora-Variable.ttf', 78, 'white', `${cy - 110 * u}`, 0.4);
  add('end_agency.txt', details.agency, 'Poppins-Light.ttf', 34, '0xE8E2D0', `${cy + 5 * u}`, 0.6);
  add('end_phone.txt', details.agentPhone, 'Poppins-Medium.ttf', 52, GOLD, `${cy + 75 * u}`, 0.8);
  add('end_addr.txt', details.address, 'Poppins-Light.ttf', 28, '0xBBBBBB', `${cy + 170 * u}`, 1.0);

  const lineW = Math.round(220 * u);
  const vf = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    'boxblur=24:2',
    'eq=brightness=-0.32:saturation=0.6',
    'vignette=angle=PI/3.5',
    `drawbox=x=(iw-${lineW})/2:y=${Math.round(cy - 225 * u)}:w=${lineW}:h=${Math.max(2, Math.round(2 * u))}:color=${GOLD}:t=fill`,
    ...lines,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  await run(['-loop', '1', '-framerate', String(FPS), '-i', input, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-an', out]);
}

/** Built-in ambient cinematic score (synth pad), generated on the fly – no licensing needed. */
function ambientScoreArgs(duration) {
  const chordA = [110, 164.81, 220, 261.63, 329.63, 493.88]; // Am9
  const chordB = [87.31, 130.81, 174.61, 261.63, 329.63, 440]; // Fmaj7
  const voice = (f, i) => `sin(2*PI*${f}*t+${i})*(0.55+0.45*sin(2*PI*${(0.07 + i * 0.013).toFixed(3)}*t))`;
  const mixA = chordA.map(voice).join('+');
  const mixB = chordB.map(voice).join('+');
  const blend = '(0.5+0.5*sin(2*PI*t/16))';
  const expr = `0.045*((${mixA})*${blend}+(${mixB})*(1-${blend}))`;
  return ['-f', 'lavfi', '-t', String(duration + 1), '-i', `aevalsrc=${expr}:s=44100:c=stereo`];
}

/**
 * Main entry. project: { _id, images[{file, selected}], details, settings }, dirs: { workDir, mediaDir }
 */
async function renderVideo(opts) {
  currentSignal = opts.signal || null;
  try {
    return await renderVideoInner(opts);
  } finally {
    currentSignal = null;
  }
}

async function renderVideoInner({ images, details = {}, settings = {}, workDir, outFile, musicFile, onProgress = () => {} }) {
  const fmt = FORMATS[settings.format] || FORMATS['16:9'];
  const { w, h } = fmt;
  const shotSec = Math.max(2.5, Math.min(7, Number(settings.secondsPerShot) || 4));
  const trans = Math.min(1.2, shotSec / 3.2);
  const grade = GRADES[settings.grade] ? settings.grade : 'golden';
  const pool = TRANSITIONS[settings.transition] || TRANSITIONS.cinematic;
  const zoom = settings.motion === 'subtle' ? 0.1 : settings.motion === 'bold' ? 0.26 : 0.17;
  const endSec = details.agentName || details.agentPhone || details.agency ? 4.5 : 3;
  const seq = h > w ? PORTRAIT_SEQ : LANDSCAPE_SEQ;

  if (!images.length) throw new Error('Select at least one photo.');
  fs.mkdirSync(workDir, { recursive: true });

  // Weighted progress: shots 65%, end card 5%, final mux 30%
  const report = (p, label) => onProgress(Math.round(p * 100), label);

  // 1. Shots
  const shots = [];
  for (let i = 0; i < images.length; i++) {
    report((i / images.length) * 0.65, `Filming shot ${i + 1} of ${images.length}`);
    const out = path.join(workDir, `shot_${String(i).padStart(2, '0')}.mp4`);
    await renderShot({ input: images[i], out, w, h, seconds: shotSec, move: seq[i % seq.length], grade, zoom });
    shots.push(out);
  }

  // 2. End card
  report(0.66, 'Designing end card');
  const endOut = path.join(workDir, 'endcard.mp4');
  await renderEndCard({ input: images[images.length - 1], out: endOut, w, h, seconds: endSec, details, workDir });
  shots.push(endOut);

  // 3. Assemble
  report(0.7, 'Editing & colour finishing');
  const durations = shots.map((_, i) => (i === shots.length - 1 ? endSec : shotSec));
  const total = durations.reduce((a, b) => a + b, 0) - trans * (shots.length - 1);

  const filters = [];
  let last = '[0:v]';
  let offset = 0;
  for (let i = 1; i < shots.length; i++) {
    offset += durations[i - 1] - trans;
    const t = i === shots.length - 1 ? 'fadeblack' : pool[(i - 1) % pool.length];
    const label = `[x${i}]`;
    filters.push(`${last}[${i}:v]xfade=transition=${t}:duration=${trans.toFixed(3)}:offset=${offset.toFixed(3)}${label}`);
    last = label;
  }

  // Title overlay on the opening shot
  const u = Math.min(w, h) / 1080;
  const post = [];
  if (settings.letterbox !== false && w > h) {
    const bar = Math.round((h - w / 2.39) / 2);
    post.push(`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`, `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`);
  }
  const titleEnd = Math.min(shotSec * 1.6, total - endSec - 0.5);
  const kicker = details.kicker || 'NOW SHOWING';
  const tKick = writeText(workDir, 'title_kicker.txt', kicker.toUpperCase());
  const tAddr = details.address ? writeText(workDir, 'title_addr.txt', details.address) : null;
  const tPrice = details.price ? writeText(workDir, 'title_price.txt', details.price) : null;
  const baseY = h > w ? h * 0.66 : h * 0.62;
  post.push(drawText({ textFile: tKick, font: 'Poppins-Light.ttf', size: 30 * u, color: GOLD, y: `${baseY - 70 * u}`, alpha: fadeAlpha(0.5, titleEnd) }));
  if (tAddr) post.push(drawText({ textFile: tAddr, font: 'Lora-Variable.ttf', size: fit(details.address, (h > w ? 64 : 72) * u, w), color: 'white', y: `${baseY - 20 * u}`, alpha: fadeAlpha(0.8, titleEnd) }));
  if (tPrice) post.push(drawText({ textFile: tPrice, font: 'Poppins-Medium.ttf', size: 38 * u, color: GOLD, y: `${baseY + 80 * u}`, alpha: fadeAlpha(1.1, titleEnd) }));
  post.push(`fade=t=in:st=0:d=0.8`, `fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8`, 'format=yuv420p');
  filters.push(`${last}${post.join(',')}[vout]`);

  // Audio
  const inputs = shots.flatMap((s) => ['-i', s]);
  const audioIdx = shots.length;
  let audioArgs = [];
  if (settings.music === 'upload' && musicFile && fs.existsSync(musicFile)) {
    audioArgs = ['-stream_loop', '-1', '-i', musicFile];
  } else if (settings.music !== 'none') {
    audioArgs = ambientScoreArgs(total);
  }
  if (audioArgs.length) {
    const ambient = settings.music !== 'upload' || !musicFile;
    const chain = ambient
      ? `lowpass=f=1600,aecho=0.8:0.6:180|360:0.3|0.2,volume=1.6`
      : `volume=0.9`;
    filters.push(
      `[${audioIdx}:a]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,${chain},afade=t=in:st=0:d=1.5,afade=t=out:st=${(total - 2).toFixed(2)}:d=2,aformat=sample_rates=44100:channel_layouts=stereo[aout]`
    );
  }

  const script = path.join(workDir, 'filter.txt');
  fs.writeFileSync(script, filters.join(';\n'), 'utf8');

  const args = [
    ...inputs,
    ...audioArgs,
    '-filter_complex_script', rel(script),
    '-map', '[vout]',
    ...(audioArgs.length ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', '-t', total.toFixed(2),
    outFile,
  ];
  await run(args, { totalSec: total, onProgress: (p) => report(0.7 + p * 0.3, 'Final render') });

  // Poster frame
  const poster = outFile.replace(/\.mp4$/, '.jpg');
  await run(['-ss', String(Math.min(1.8, total / 3)), '-i', outFile, '-frames:v', '1', '-q:v', '3', poster]).catch(() => {});

  // Clean temporary shots
  for (const s of shots) fs.rmSync(s, { force: true });
  report(1, 'Done');
  return { duration: total, width: w, height: h, poster: fs.existsSync(poster) ? poster : null };
}

module.exports = { renderVideo, FORMATS, TRANSITIONS, GRADES };
