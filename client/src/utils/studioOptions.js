export const FORMATS = [
  { v: 'auto', label: 'Auto size', sub: 'Matches photos' },
  { v: '16:9', label: 'Landscape', sub: 'YouTube · Web' },
  { v: '9:16', label: 'Vertical', sub: 'Reels · Shorts' },
  { v: '4:5', label: 'Portrait', sub: 'Instagram Feed' },
  { v: '1:1', label: 'Square', sub: 'Feed posts' },
  { v: '21:9', label: 'Cinema', sub: '21:9 Ultrawide' },
];

export const OPTIONS = {
  format: [
    ['auto', 'Auto (Best fit for photos)'],
    ['16:9', 'Landscape 16:9 (YouTube / Web)'],
    ['9:16', 'Vertical 9:16 (Reels / Shorts)'],
    ['4:5', 'Portrait 4:5 (Instagram Feed)'],
    ['1:1', 'Square 1:1 (Feed posts)'],
    ['4:3', 'Classic 4:3 (iPad / Tablet)'],
    ['21:9', 'Cinematic 21:9 (Ultrawide)'],
  ],
  imageFit: [
    ['auto', 'Auto framing (Smart crop / soft blur)'],
    ['crop', 'Crop & fill (Cinematic zoom)'],
    ['blur_pad', 'No crop (Blurred background)'],
    ['letterbox', 'Fit entire image (Black bars)'],
  ],
  transition: [
    ['cinematic', 'Cinematic mix'],
    ['smooth', 'Soft dissolves'],
    ['dynamic', 'Dynamic slides'],
    ['dark', 'Dip to black'],
  ],
  grade: [
    ['golden', 'Golden hour'],
    ['natural', 'Natural'],
    ['cool', 'Cool modern'],
    ['mono', 'Black & white'],
  ],
  motion: [
    ['subtle', 'Subtle'],
    ['standard', 'Standard'],
    ['bold', 'Bold'],
  ],
  music: [
    ['ambient', 'Cinematic ambient (built-in)'],
    ['upload', 'My own track'],
    ['none', 'No music'],
  ],
};

export const DETAIL_FIELDS = [
  ['address', 'Property address', '42 Ocean View Drive, Bandra'],
  ['price', 'Price / headline', '₹2.45 Cr · Sea-facing 3 BHK'],
  ['kicker', 'Opening line', 'Now Showing'],
  ['agentName', 'Agent name', 'Ananya Mehta'],
  ['agentPhone', 'Agent phone', '+91 98765 43210'],
  ['agency', 'Agency', 'Gold Realty'],
  ['cta', 'End card message', 'Book your private inspection'],
];

export const STEPS = [
  ['photos', 'Photos'],
  ['details', 'Details'],
  ['style', 'Style'],
  ['music', 'Music & Pay'],
];

export const label = (k, v) => (OPTIONS[k].find(([x]) => x === v) || OPTIONS[k][0])[1];

export function safeHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

export const slug = (s) =>
  String(s || 'property-film')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'property-film';

export function labelFor(status) {
  return (
    {
      scraping: 'Importing',
      ready: 'Ready',
      queued: 'Queued',
      rendering: 'Rendering',
      done: 'Film ready',
      error: 'Needs attention',
    }[status] || status
  );
}

const RATIO_NUM = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '1:1': 1,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
};

/** Mirrors server detectAutoFormat() so preview accurately reflects auto sizing. */
export function resolvePreviewFormat(format, images = []) {
  if (format && format !== 'auto' && RATIO_NUM[format]) return format;
  let total = 0;
  let count = 0;
  for (const img of images) {
    if (img?.width && img?.height) {
      total += img.width / img.height;
      count++;
    }
  }
  if (!count) return '16:9';
  const avg = total / count;
  if (avg >= 2.0) return '21:9';
  if (avg >= 1.45) return '16:9';
  if (avg >= 1.18) return '4:3';
  if (avg >= 0.88) return '1:1';
  if (avg >= 0.68) return '4:5';
  return '9:16';
}

export function formatAspectRatio(format, images = []) {
  const f = resolvePreviewFormat(format, images);
  return { key: f, ratio: RATIO_NUM[f] || 16 / 9, css: f.replace(':', ' / ') };
}

/** Mirrors server renderShot() framing decision (auto / crop / blur_pad / letterbox). */
export function resolveFraming(img, targetRatio, fitMode = 'auto') {
  if (fitMode === 'letterbox') return 'letterbox';
  if (fitMode === 'blur_pad') return 'blur_pad';
  if (fitMode === 'crop') return 'crop';
  if (img?.width && img?.height && targetRatio) {
    const imgRatio = img.width / img.height;
    const diff = Math.abs(imgRatio - targetRatio) / targetRatio;
    if (diff > 0.32) return 'blur_pad';
  }
  return 'crop';
}

export function isRatioMismatch(img, targetRatio) {
  if (!img?.width || !img?.height || !targetRatio) return false;
  const imgRatio = img.width / img.height;
  return Math.abs(imgRatio - targetRatio) / targetRatio > 0.32;
}

export function gradeFilter(grade) {
  switch (grade) {
    case 'natural':
      return 'contrast(1.04) saturate(1.06)';
    case 'cool':
      return 'contrast(1.06) saturate(0.95) hue-rotate(8deg) brightness(0.98)';
    case 'mono':
      return 'grayscale(1) contrast(1.16) brightness(0.98)';
    case 'golden':
    default:
      return 'contrast(1.07) saturate(1.15) sepia(0.16) brightness(0.99)';
  }
}

// ---------- Seamless draft handoff across auth ----------
const DRAFT_KEY = 'ra_draft_project';
let pendingUpload = null; // { files: File[], format: string } kept in-memory during SPA login

export function savePendingUrl(url, format = 'auto') {
  pendingUpload = null;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ url, format }));
  } catch { /* ignore */ }
}

export function savePendingFiles(files, format = 'auto') {
  pendingUpload = { files: [...files], format };
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

export function readDraftUrl() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function takePendingDraft() {
  if (pendingUpload) {
    const out = { type: 'files', ...pendingUpload };
    pendingUpload = null;
    return out;
  }
  const urlDraft = readDraftUrl();
  clearPendingDraft();
  if (urlDraft?.url) return { type: 'url', ...urlDraft };
  return null;
}

export function clearPendingDraft() {
  pendingUpload = null;
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}
