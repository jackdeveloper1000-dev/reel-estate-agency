/**
 * Listing scraper – pulls property photos + basic details from a listing URL.
 * Dependency-free (uses Node's global fetch). Works on most agency sites, CMS
 * listing pages and portals that render images/JSON into the HTML.
 * Some big portals block automated requests – the UI falls back to photo upload.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const tls = require('tls');
const zlib = require('zlib');
const { SCRAPER } = require('../config');
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

function pageHeaders() {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-AU;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

function buildScraperApiUrl(template, targetUrl) {
  const enc = encodeURIComponent(targetUrl);
  if (template.includes('{url}')) return template.replace(/\{url\}/g, enc);
  return `${template}${template.includes('?') ? '&' : '?'}url=${enc}`;
}

/** Zero-dependency HTTP/HTTPS proxy fetch (supports http://[user:pass@]host:port). */
function fetchViaHttpProxy(targetUrl, proxyUrl, headers, timeoutMs = 30000, redirects = 5) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const proxy = new URL(proxyUrl);
    const isHttps = target.protocol === 'https:';
    const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
    const auth = proxy.username || proxy.password
      ? 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
      : null;

    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(val);
    };
    const timer = setTimeout(() => done(new Error('Proxy request timed out')), timeoutMs);

    const handleRes = (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        fetchViaHttpProxy(nextUrl, proxyUrl, headers, timeoutMs, redirects - 1).then((v) => done(null, v), (e) => done(e));
        return;
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', (e) => done(e));
      stream.on('end', () => done(null, {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode || 0,
        url: targetUrl,
        buffer: Buffer.concat(chunks),
      }));
    };

    const reqHeaders = { ...headers, 'Accept-Encoding': 'gzip, deflate, br', Host: target.host };

    if (!isHttps) {
      if (auth) reqHeaders['Proxy-Authorization'] = auth;
      const req = http.request({
        host: proxy.hostname,
        port: proxyPort,
        method: 'GET',
        path: targetUrl,
        headers: reqHeaders,
      }, handleRes);
      req.on('error', (e) => done(e));
      req.end();
      return;
    }

    const connectHeaders = { Host: `${target.hostname}:${target.port || 443}` };
    if (auth) connectHeaders['Proxy-Authorization'] = auth;
    const connectReq = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers: connectHeaders,
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return done(new Error(`Proxy CONNECT failed (HTTP ${res.statusCode})`));
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname });
      tlsSocket.on('error', (e) => done(e));
      const req = https.request({
        host: target.hostname,
        port: target.port || 443,
        method: 'GET',
        path: `${target.pathname}${target.search}`,
        headers: reqHeaders,
        createConnection: () => tlsSocket,
      }, handleRes);
      req.on('error', (e) => done(e));
      req.end();
    });
    connectReq.on('error', (e) => done(e));
    connectReq.end();
  });
}

async function fetchViaConfiguredProxy(url) {
  if (SCRAPER.apiUrl) {
    const apiTarget = buildScraperApiUrl(SCRAPER.apiUrl, url);
    let res = await fetch(apiTarget, {
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    // ZenRows returns HTTP 422 (RESP001) or 417/403 when a protected page requires JS rendering – retry once with js_render=true
    if ([422, 417, 403].includes(res.status) && /zenrows\.com/i.test(apiTarget) && !/[?&]js_render=true/i.test(apiTarget)) {
      res = await fetch(`${apiTarget}&js_render=true`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(65000),
      });
    }
    if (!res.ok) {
      const err = new Error(`Proxy API returned HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { html: await res.text(), finalUrl: url };
  }
  if (SCRAPER.proxyUrl) {
    const res = await fetchViaHttpProxy(url, SCRAPER.proxyUrl, pageHeaders(), 35000);
    if (!res.ok) {
      const err = new Error(`Proxy returned HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { html: res.buffer.toString('utf8'), finalUrl: res.url || url };
  }
  return null;
}

function blockedError(status, fromProxy = false) {
  let msg;
  if (fromProxy && (status === 401 || status === 402)) {
    msg = `Scraper proxy authentication/quota error (HTTP ${status} – check SCRAPER_API_URL in server/.env). You can still paste the page HTML or upload the photos instead.`;
  } else if ([403, 406, 417, 429].includes(status)) {
    msg = `This website blocked automatic access (HTTP ${status}). You can paste the page HTML or upload the photos instead.`;
  } else {
    msg = `Could not open the listing (HTTP ${status}).`;
  }
  const err = new Error(msg);
  err.status = status;
  return err;
}

async function fetchText(url) {
  const hasProxy = Boolean(SCRAPER.apiUrl || SCRAPER.proxyUrl);
  if (SCRAPER.alwaysProxy && hasProxy) {
    try {
      return await fetchViaConfiguredProxy(url);
    } catch (e) {
      throw blockedError(e.status || 403, true);
    }
  }

  let directStatus = 0;
  let directErr = null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: pageHeaders(),
    });
    if (res.ok) return { html: await res.text(), finalUrl: res.url || url };
    directStatus = res.status;
  } catch (e) {
    directErr = e;
  }

  // Fallback to configured scraping API or HTTP proxy when blocked (403/417/429/etc.) or network error
  if (hasProxy && (directErr || (directStatus && directStatus !== 404))) {
    try {
      return await fetchViaConfiguredProxy(url);
    } catch (e) {
      throw blockedError(e.status || directStatus || 403, true);
    }
  }

  if (directErr) throw directErr;
  throw blockedError(directStatus);
}

/** Collects candidate image URLs from raw HTML (or a pasted list of URLs). Exported for testing. */
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

  // 7. Plain image URLs (supports pasting direct image links or non-script HTML snippets)
  if (found.size < 3) {
    const plain = unescapeJson(html);
    const urlRe = /https?:\/\/[^"'\s<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>()\\]*)?/gi;
    let u;
    while ((u = urlRe.exec(plain))) add(u[0], 1, true);
  }

  const urls = [...found.values()].sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.url);
  return { urls, ldBlocks };
}

async function downloadImage(url, referer) {
  const headers = { 'User-Agent': UA, Referer: referer, Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8' };
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  if (SCRAPER.proxyUrl && [403, 417, 429].includes(res.status)) {
    const proxied = await fetchViaHttpProxy(url, SCRAPER.proxyUrl, headers, 25000);
    if (proxied.ok) return proxied.buffer;
  }
  throw new Error(`HTTP ${res.status}`);
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
 * Extracts details + photos from already-fetched HTML and saves photos to destDir.
 * @returns {Promise<{details, images: Array<{file, sourceUrl, width, height}>}>}
 */
async function scrapeHtml(html, baseUrl, destDir, { maxImages = 30, onProgress } = {}) {
  const finalUrl = baseUrl && /^https?:\/\//i.test(baseUrl) ? baseUrl : 'https://localhost/';
  const { urls, ldBlocks } = collectImageUrls(html, finalUrl);
  const details = parseDetails(html, ldBlocks);
  onProgress && onProgress({ stage: 'found', count: urls.length });

  if (!urls.length) {
    throw new Error('No property photos were found in that page. Make sure you copied the full page source (Ctrl+U) or upload the photos.');
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

/**
 * Scrapes a listing URL and saves photos to destDir.
 * @returns {Promise<{details, images: Array<{file, sourceUrl, width, height}>}>}
 */
async function scrapeListing(listingUrl, destDir, opts = {}) {
  const { html, finalUrl } = await fetchText(listingUrl);
  return scrapeHtml(html, finalUrl, destDir, opts);
}

module.exports = { scrapeListing, scrapeHtml, collectImageUrls, parseDetails };
