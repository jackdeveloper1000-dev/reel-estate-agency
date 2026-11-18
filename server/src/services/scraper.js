/**
 * Listing scraper – pulls property photos + basic details from a listing URL.
 * Dependency-free (uses Node's global fetch). Works on most agency sites, CMS
 * listing pages and portals that render images/JSON into the HTML.
 * Some big portals block automated requests – the UI falls back to photo upload.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { imageInfo } = require('../utils/imageInfo');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const IMG_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i;
const BAD_WORDS =
  /(logo|icon|sprite|avatar|favicon|badge|placeholder|spinner|loader|blank|pixel|tracking|staticmap|maps\.google|mapbox|agent|profile|headshot|team|brand|banner-ad|advert|\.svg|\.gif|emoji|flag|social|facebook|twitter|instagram|youtube|linkedin|whatsapp|qr)/i;
const PHOTO_HOSTS =
  /(reastatic|domainstatic|zillowstatic|rdcpix|cloudinary|imgix|cloudfront|akamaized|rightmove|zoopla|onthehouse|ljhooker|raywhite|mcgrath|belle|harcourts|propertyimages|listing|photos?)/i;

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;|&#47;/g, '/');

const unescapeJson = (s) => s.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\u0026/g, '&');

function absolutize(u, base) {
  if (!u) return null;
  u = decodeEntities(unescapeJson(u.trim()));
  if (u.startsWith('data:') || u.startsWith('blob:')) return null;
  try {
    const abs = new URL(u, base);
    if (!/^https?:$/.test(abs.protocol)) return null;
    return abs.href;
  } catch {
    return null;
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? m[2] ?? m[3] ?? m[4] : null;
}

function largestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestW = -1;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 0;
    if (w >= bestW) { bestW = w; best = u; }
  }
  return best;
}

/** Normalised key so the same photo in different sizes is counted once. */
function dedupeKey(u) {
  try {
    const x = new URL(u);
    ['w', 'h', 'width', 'height', 'size', 'q', 'quality', 'fit', 'crop', 'auto', 'fm', 'format', 'dpr'].forEach((p) =>
      x.searchParams.delete(p)
    );
    return (x.host + x.pathname + x.search)
      .toLowerCase()
      .replace(/\/\d{2,4}x\d{2,4}(-[a-z]+)?\//g, '/')
      .replace(/[-_](\d{2,4}x\d{2,4}|w\d{2,4}|h\d{2,4}|small|medium|large|thumb|thumbnail)(?=[./_-])/g, '')
      .replace(/\/(fit-in|resize|thumb|thumbnail|small|medium|large)\//g, '/');
  } catch {
    return u;
  }
}

/** Rough "size score" from the URL so we keep the biggest variant. */
function sizeHint(u) {
  const m = u.match(/(\d{3,4})x(\d{3,4})/) || u.match(/[?&](?:w|width)=(\d{3,4})/);
  return m ? parseInt(m[1], 10) * (m[2] ? parseInt(m[2], 10) : 1) : 0;
}

/** Try to upgrade well-known CDN thumbnail URLs to large versions. */
function upgradeUrl(u) {
  return u
    .replace(/(reastatic\.net\/)\d{2,4}x\d{2,4}[^/]*\//, (_, host) => `${host}1600x1200/`)
    .replace(/([?&])(w|width)=\d{2,4}/, '$1$2=2000');
}

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const c = attr(m[0], 'content');
    if (c) out.push(decodeEntities(c));
  }
  return out;
}

function walkJson(node, visit, depth = 0) {
  if (depth > 40 || node == null) return;
  if (Array.isArray(node)) return node.forEach((n) => walkJson(n, visit, depth + 1));
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      visit(k, v, node);
      walkJson(v, visit, depth + 1);
    }
  }
}

function parseDetails(html, ldBlocks) {
  const details = { title: '', address: '', price: '', description: '' };
  details.title = (extractMeta(html, 'og:title')[0] || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  details.description = (extractMeta(html, 'og:description')[0] || extractMeta(html, 'description')[0] || '').trim();

  for (const block of ldBlocks) {
    walkJson(block, (k, v, parent) => {
      if (k === 'address' && v && typeof v === 'object' && !details.address) {
        const parts = [v.streetAddress, v.addressLocality, v.addressRegion].filter(Boolean);
        if (parts.length) details.address = decodeEntities(parts.join(', '));
      } else if (k === 'address' && typeof v === 'string' && !details.address) {
        details.address = decodeEntities(v);
      }
      if (k === 'price' && !details.price && (typeof v === 'string' || typeof v === 'number')) {
        const cur = parent.priceCurrency ? `${parent.priceCurrency} ` : '';
        const num = Number(v);
        details.price = Number.isFinite(num) && num > 1000 ? `${cur}${num.toLocaleString('en-US')}` : String(v);
      }
    });
  }

  // Fallbacks from visible text
  if (!details.price) {
    const pm = html.replace(/<[^>]+>/g, ' ').match(/(?:\$|£|€|AUD\s?|USD\s?)\s?\d{1,3}(?:[,.]\d{3})+(?:\s?(?:-|to)\s?(?:\$|£|€)?\s?\d{1,3}(?:[,.]\d{3})+)?/);
    if (pm) details.price = pm[0].replace(/\s+/g, ' ').trim();
  }
  if (!details.address && details.title) {
    details.address = details.title.split(/\s[|–-]\s/)[0].trim();
  }
  return details;
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
  });
  if (!res.ok) {
    const err = new Error(
      res.status === 403 || res.status === 429
        ? `This website blocked automatic access (HTTP ${res.status}). Please upload the photos instead.`
        : `Could not open the listing (HTTP ${res.status}).`
    );
    err.status = res.status;
    throw err;
  }
  return { html: await res.text(), finalUrl: res.url || url };
}

/** Collects candidate image URLs from raw HTML. Exported for testing. */
function collectImageUrls(html, baseUrl) {
  const found = new Map(); // key -> {url, score, order}
  let order = 0;
  const add = (raw, weight = 1, requireExt = false) => {
    const u = absolutize(raw, baseUrl);
    if (!u) return;
    if (BAD_WORDS.test(u)) return;
    const hasExt = IMG_EXT.test(u);
    if (requireExt && !hasExt && !PHOTO_HOSTS.test(u)) return;
    const big = upgradeUrl(u);
    const key = dedupeKey(big);
    const score = weight * 1e7 + sizeHint(big);
    const prev = found.get(key);
    if (!prev) found.set(key, { url: big, score, order: order++ });
    else if (sizeHint(big) > sizeHint(prev.url)) prev.url = big;
    if (prev && score > prev.score) prev.score = score;
  };

  // 1. OpenGraph / Twitter
  [...extractMeta(html, 'og:image'), ...extractMeta(html, 'og:image:url'), ...extractMeta(html, 'twitter:image')].forEach((u) =>
    add(u, 5)
  );

  // 2. JSON-LD
  const ldBlocks = [];
  const ldRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      ldBlocks.push(json);
      walkJson(json, (k, v) => {
        if (/^(image|photo|photos|images|contentUrl|thumbnailUrl)$/i.test(k)) {
          const list = Array.isArray(v) ? v : [v];
          list.forEach((x) => (typeof x === 'string' ? add(x, 4) : x && (x.url || x.contentUrl) && add(x.url || x.contentUrl, 4)));
        }
      });
    } catch { /* ignore broken JSON-LD */ }
  }

  // 3. <img>, <source>, lazy-load attributes
  const tagRe = /<(img|source)\b[^>]*>/gi;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const alt = (attr(tag, 'alt') || '').toLowerCase();
    if (BAD_WORDS.test(alt)) continue;
    const w = parseInt(attr(tag, 'width') || '0', 10);
    if (w && w < 200) continue;
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset') || attr(tag, 'data-lazy-srcset');
    const best = largestFromSrcset(srcset);
    [best, attr(tag, 'data-src'), attr(tag, 'data-lazy-src'), attr(tag, 'data-original'), attr(tag, 'data-full'), attr(tag, 'data-large'), attr(tag, 'src')]
      .filter(Boolean)
      .forEach((u) => add(u, 2));
  }

  // 4. Links pointing directly at images (lightbox galleries)
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  while ((m = aRe.exec(html))) add(m[1], 3);

  // 5. CSS background images
  const bgRe = /url\(\s*["']?([^"')]+\.(?:jpe?g|png|webp)[^"')]*)["']?\s*\)/gi;
  while ((m = bgRe.exec(html))) add(m[1], 1);

  // 6. Any image URL inside inline scripts (Next.js / Nuxt state, gallery JSON)
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRe.exec(html))) {
    const body = unescapeJson(m[1]);
    const urlRe = /https?:\/\/[^"'\s<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>()\\]*)?/gi;
    let u;
    while ((u = urlRe.exec(body))) add(u[0], 1, true);
  }

  const urls = [...found.values()].sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.url);
  return { urls, ldBlocks };
}

async function downloadImage(url, referer) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Scrapes a listing and saves photos to destDir.
 * @returns {Promise<{details, images: Array<{file, sourceUrl, width, height}>}>}
 */
async function scrapeListing(listingUrl, destDir, { maxImages = 30, onProgress } = {}) {
  const { html, finalUrl } = await fetchText(listingUrl);
  const { urls, ldBlocks } = collectImageUrls(html, finalUrl);
  const details = parseDetails(html, ldBlocks);
  onProgress && onProgress({ stage: 'found', count: urls.length });

  if (!urls.length) {
    throw new Error('No property photos were found on that page. Try another link or upload the photos.');
  }

  fs.mkdirSync(destDir, { recursive: true });
  const seenHashes = new Set();
  let done = 0;
  const results = await mapLimit(urls.slice(0, 60), 6, async (url) => {
    const buf = await downloadImage(url, finalUrl);
    done++;
    onProgress && onProgress({ stage: 'download', done, total: Math.min(urls.length, 60) });
    const info = imageInfo(buf);
    if (!info || !['jpg', 'png', 'webp'].includes(info.type)) return null;
    if (info.width < 640 || info.height < 400) return null;
    const ratio = info.width / info.height;
    if (ratio < 0.45 || ratio > 3.2) return null;
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    if (seenHashes.has(hash)) return null;
    seenHashes.add(hash);
    return { buf, info, url, hash };
  });

  const images = [];
  for (const r of results) {
    if (!r || images.length >= maxImages) continue;
    const file = `src_${String(images.length + 1).padStart(2, '0')}.${r.info.type}`;
    fs.writeFileSync(path.join(destDir, file), r.buf);
    images.push({ file, sourceUrl: r.url, width: r.info.width, height: r.info.height });
  }

  if (!images.length) {
    throw new Error('Photos were found but none were large enough for video. Please upload high-resolution photos.');
  }
  return { details, images };
}

module.exports = { scrapeListing, collectImageUrls, parseDetails };
