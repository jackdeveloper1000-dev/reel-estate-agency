import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));

// Show a readable message instead of a blank 500 when the API isn't running
function explain(proxy) {
  proxy.on('error', (_err, _req, res) => {
    if (res.headersSent) return;
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API server is not running on port 5005. Run "npm run dev" from the project root and check the [api] logs.' }));
  });
}

/** Every page Vite builds: the React app, About, Privacy and every .html file in client/guides/ */
function pageInputs() {
  const input = {
    main: resolve(here, 'index.html'),
    about: resolve(here, 'about.html'),
    privacy: resolve(here, 'privacy.html'),
  };
  const guides = resolve(here, 'guides');
  if (existsSync(guides)) {
    for (const f of readdirSync(guides)) {
      if (f.endsWith('.html')) input[`guides/${f.slice(0, -5)}`] = resolve(guides, f);
    }
  }
  return input;
}

/**
 * Site pages + Google AdSense – driven by client/.env (rebuild after changing it):
 *   VITE_ADSENSE_CLIENT=ca-pub-…      → AdSense script in the <head> of every page, plus dist/ads.txt and dist/app-ads.txt
 *   VITE_ADSENSE_SLOT_ARTICLE=…       → ad unit shown inside the guides (falls back to VITE_ADSENSE_SLOT_HOME)
 *   VITE_CONTACT_EMAIL=…              → shown on the About and Privacy pages (the contact block is left out while empty)
 *   VITE_SITE_URL=https://…           → writes dist/sitemap.xml so Google finds every page
 * Static pages (about, privacy, guides) can use these markers:
 *   <!-- site:head --> <!-- site:header --> <!-- site:footer --> <!-- site:more-guides -->  → files in client/partials/
 *   <!-- ad -->                                                                            → an AdSense unit (removed while not set up)
 * With the values empty no ads are added, so the site works exactly as before.
 */
function sitePages(env) {
  const raw = (env.VITE_ADSENSE_CLIENT || '').trim();
  const client = raw.startsWith('pub-') ? `ca-${raw}` : raw; // accept "pub-…" as shown in AdSense account info
  const valid = /^ca-pub-\d{10,20}$/.test(client);
  const email = (env.VITE_CONTACT_EMAIL || '').trim();
  const slot = (env.VITE_ADSENSE_SLOT_ARTICLE || env.VITE_ADSENSE_SLOT_HOME || '').trim();
  const siteUrl = (env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
  const partial = (name) => readFileSync(resolve(here, 'partials', `${name}.html`), 'utf8').trim();
  const adUnit = valid && /^\d+$/.test(slot)
    ? `<aside class="ad-slot" aria-label="Advertisement"><small>Advertisement</small>
<ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(window.adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`
    : '';
  let warned = false;

  return {
    name: 'estamotion-site',
    buildStart() {
      if (warned) return;
      warned = true;
      if (client && !valid) this.warn(`VITE_ADSENSE_CLIENT "${raw}" should look like ca-pub-1234567890123456 – AdSense code NOT added.`);
      if (valid && !email) this.warn('VITE_CONTACT_EMAIL is empty – the About and Privacy pages will have no contact email (AdSense reviewers look for one).');
    },
    transformIndexHtml: {
      order: 'pre', // before Vite bundles the pages, so the CSS linked from partials is bundled too
      handler(html, ctx) {
        let out = html.replace(/<!-- site:([a-z-]+) -->/g, (_m, name) => partial(name));
        // don't list the guide you are reading under "More guides"
        out = out.replace(new RegExp(`<li>\\s*<a href="${ctx.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?</li>\\s*`, 'g'), '');
        out = out.replaceAll('<!-- ad -->', adUnit);
        out = email
          ? out.replaceAll('{{CONTACT_EMAIL}}', email)
          : out.replace(/<!-- contact -->[\s\S]*?<!-- \/contact -->/g, '');
        const tags = valid
          ? [{
              tag: 'script',
              attrs: { async: true, src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`, crossorigin: 'anonymous' },
              injectTo: 'head',
            }]
          : [];
        return { html: out, tags };
      },
    },
    generateBundle() {
      if (valid) {
        // Lists Google as an authorised seller of your ad space: ads.txt for AdSense, app-ads.txt for AdMob (same account)
        const line = `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`;
        this.emitFile({ type: 'asset', fileName: 'ads.txt', source: line });
        this.emitFile({ type: 'asset', fileName: 'app-ads.txt', source: line });
      }
      if (siteUrl) {
        const pages = Object.keys(pageInputs()).sort()
          .map((k) => (k === 'main' ? '/' : k.endsWith('index') ? `/${k.slice(0, -5)}` : `/${k}.html`));
        const urls = pages.map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`).join('\n');
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
      }
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nDisallow: /api/\nDisallow: /media/\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, 'VITE_');
  return {
    plugins: [react(), sitePages(env)],
    server: {
      port: 5180,
      host: true, // also reachable from phones on the same Wi-Fi (Flutter app: http://<PC IP>:5180/api)
      proxy: {
        '/api': { target: 'http://127.0.0.1:5005', configure: explain },
        '/media': { target: 'http://127.0.0.1:5005' },
      },
    },
    build: {
      // About, Privacy and the guides are plain HTML pages so Google can read them without running the app
      rollupOptions: { input: pageInputs() },
    },
  };
});
