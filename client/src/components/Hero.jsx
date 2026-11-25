import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';
import {
  FORMATS,
  OPTIONS,
  readDraftUrl,
  savePendingFiles,
  savePendingUrl,
} from '../utils/studioOptions.js';
import FilmPreview from './FilmPreview.jsx';

const DEMO_SCENES = [
  {
    id: 'villa',
    width: 1600,
    height: 1000,
    svg: (
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="demo-svg" aria-hidden="true">
        <defs>
          <linearGradient id="sky1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b263b" />
            <stop offset="55%" stopColor="#4a3728" />
            <stop offset="100%" stopColor="#c58b3c" />
          </linearGradient>
          <linearGradient id="pool1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#264b63" />
            <stop offset="100%" stopColor="#0d1b26" />
          </linearGradient>
          <linearGradient id="glow1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe4a1" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect width="1600" height="1000" fill="url(#sky1)" />
        <circle cx="1220" cy="240" r="140" fill="#f6c96c" opacity="0.22" />
        <circle cx="1220" cy="240" r="64" fill="#ffe7ad" opacity="0.35" />
        <polygon points="0,580 540,470 980,560 1600,450 1600,1000 0,1000" fill="#121417" />
        {/* Architectural cantilevered pavilion */}
        <rect x="260" y="340" width="980" height="24" fill="#e6dcc8" />
        <rect x="330" y="364" width="840" height="250" fill="#17191c" />
        <rect x="360" y="384" width="320" height="210" fill="url(#glow1)" opacity="0.85" />
        <rect x="700" y="384" width="320" height="210" fill="url(#glow1)" opacity="0.72" />
        <line x1="520" y1="384" x2="520" y2="594" stroke="#1c1c1e" strokeWidth="6" />
        <line x1="860" y1="384" x2="860" y2="594" stroke="#1c1c1e" strokeWidth="6" />
        <rect x="210" y="594" width="1140" height="36" fill="#2b2620" />
        {/* Infinity pool */}
        <polygon points="240,680 1320,680 1440,920 120,920" fill="url(#pool1)" />
        <rect x="360" y="688" width="320" height="75" fill="#f3d27a" opacity="0.18" />
        <rect x="700" y="688" width="320" height="75" fill="#f3d27a" opacity="0.14" />
      </svg>
    ),
  },
  {
    id: 'living',
    width: 1600,
    height: 1000,
    svg: (
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="demo-svg" aria-hidden="true">
        <defs>
          <linearGradient id="wall2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1e1b18" />
            <stop offset="100%" stopColor="#2e271f" />
          </linearGradient>
          <linearGradient id="win2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5d7894" />
            <stop offset="65%" stopColor="#d99a4e" />
            <stop offset="100%" stopColor="#26201a" />
          </linearGradient>
        </defs>
        <rect width="1600" height="1000" fill="url(#wall2)" />
        <rect x="180" y="130" width="820" height="510" fill="url(#win2)" />
        <line x1="450" y1="130" x2="450" y2="640" stroke="#1a1714" strokeWidth="10" />
        <line x1="720" y1="130" x2="720" y2="640" stroke="#1a1714" strokeWidth="10" />
        <polygon points="0,710 1600,710 1600,1000 0,1000" fill="#171310" />
        {/* Warm sunlight beam across floor */}
        <polygon points="180,640 1000,640 1320,1000 120,1000" fill="#f3d27a" opacity="0.12" />
        {/* Low-profile luxury sofa & pendant */}
        <rect x="430" y="610" width="660" height="120" rx="22" fill="#d8cfc0" />
        <rect x="450" y="660" width="620" height="90" rx="14" fill="#bfb39f" />
        <line x1="1240" y1="0" x2="1240" y2="330" stroke="#554932" strokeWidth="4" />
        <ellipse cx="1240" cy="345" rx="68" ry="26" fill="#d4af37" />
        <circle cx="1240" cy="370" r="46" fill="#ffe7a8" opacity="0.3" />
      </svg>
    ),
  },
  {
    id: 'terrace',
    width: 1600,
    height: 1000,
    svg: (
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="demo-svg" aria-hidden="true">
        <defs>
          <linearGradient id="sky3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#121826" />
            <stop offset="60%" stopColor="#2c3a4f" />
            <stop offset="100%" stopColor="#d48c46" />
          </linearGradient>
        </defs>
        <rect width="1600" height="1000" fill="url(#sky3)" />
        {/* Distant skyline silhouette */}
        <rect x="120" y="420" width="90" height="260" fill="#151b26" />
        <rect x="230" y="340" width="120" height="340" fill="#121722" />
        <rect x="380" y="390" width="95" height="290" fill="#161c28" />
        <rect x="1120" y="360" width="130" height="320" fill="#131822" />
        <rect x="1280" y="410" width="110" height="270" fill="#171d29" />
        {/* Glass terrace balustrade */}
        <rect x="0" y="680" width="1600" height="320" fill="#1a1714" />
        <rect x="0" y="540" width="1600" height="140" fill="#7aa6c2" opacity="0.16" />
        <rect x="0" y="536" width="1600" height="8" fill="#d4af37" opacity="0.7" />
        {/* Warm lounge chairs */}
        <rect x="520" y="640" width="210" height="110" rx="16" fill="#2d2720" />
        <rect x="820" y="640" width="210" height="110" rx="16" fill="#2d2720" />
        <circle cx="775" cy="705" r="32" fill="#d4af37" opacity="0.75" />
      </svg>
    ),
  },
];

const DEMO_DETAILS = {
  kicker: 'Now Showing',
  address: '42 Ocean View Drive, Bandra',
  price: '₹2.45 Cr · Sea-facing 3 BHK',
  cta: 'Book your private inspection',
  agentName: 'Ananya Mehta',
  agency: 'Gold Realty',
  agentPhone: '+91 98765 43210',
};

export default function Hero({ onCreated, user }) {
  const initialDraft = readDraftUrl();
  const [sourceTab, setSourceTab] = useState('url'); // url | upload
  const [url, setUrl] = useState(initialDraft?.url || '');
  const [format, setFormat] = useState(initialDraft?.format || 'auto');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [price, setPrice] = useState(null);

  // Showcase state
  const [demoMode, setDemoMode] = useState('opening');
  const [demoGrade, setDemoGrade] = useState('golden');
  const [demoLetterbox, setDemoLetterbox] = useState(true);

  const fileRef = useRef(null);

  useEffect(() => {
    api.price().then((p) => setPrice(p.price)).catch(() => {});
  }, []);

  /** Login (if needed) → run the action. Importing photos is free; payment comes at "Make Film". */
  const guarded = async (onNeedsAuth, action) => {
    setError('');
    if (!user) {
      onNeedsAuth();
      go('signup');
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return setError('Paste a property listing link to begin.');
    const link = url.trim();
    await guarded(
      () => savePendingUrl(link, format),
      async () => onCreated(await api.createFromUrl(link, { format }, false))
    );
  };

  const onFiles = async (files) => {
    if (!files || !files.length) return;
    const list = [...files];
    if (fileRef.current) fileRef.current.value = '';
    await guarded(
      () => savePendingFiles(list, format),
      async () => onCreated(await api.createFromPhotos(list, { format }))
    );
  };

  const pasteClipboard = async () => {
    setError('');
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) setUrl(text.trim());
    } catch {
      setError('Clipboard access is blocked — paste directly into the box.');
    }
  };

  const demoFormat = format === 'auto' ? '16:9' : format;

  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden />
      <p className="eyebrow">PROPERTY IN MOTION</p>
      <h1>
        Turn any listing into a <span className="gold-text">cinematic film</span>
      </h1>
      <p className="lead">
        Paste a property link or upload listing photos. Pick your favourites, choose a look,
        and render a Full-HD film with smooth camera moves, titles, music, and your agent end card.
      </p>

      <div className="hero-source-tabs" role="tablist" aria-label="Import method">
        <button
          type="button"
          role="tab"
          aria-selected={sourceTab === 'url'}
          className={sourceTab === 'url' ? 'on' : ''}
          onClick={() => { setSourceTab('url'); setError(''); }}
        >
          Paste Listing Link
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sourceTab === 'upload'}
          className={sourceTab === 'upload' ? 'on' : ''}
          onClick={() => { setSourceTab('upload'); setError(''); }}
        >
          Upload Photos
        </button>
      </div>

      {sourceTab === 'url' ? (
        <form className="url-form" onSubmit={submit}>
          <span className="url-icon" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </span>
          <input
            type="text"
            inputMode="url"
            placeholder="https://www.agency.com/listing/42-ocean-view-drive"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            aria-label="Property listing URL"
          />
          {!url && typeof navigator !== 'undefined' && navigator.clipboard && (
            <button type="button" className="btn btn-ghost sm paste-btn" onClick={pasteClipboard} disabled={busy}>
              Paste
            </button>
          )}
          <button className="btn btn-gold" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Get Images'}
          </button>
        </form>
      ) : (
        <div
          className={`dropzone ${dragOver ? 'over' : ''} ${busy ? 'busy' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => !busy && fileRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) onFiles(e.dataTransfer.files); }}
        >
          <span className="dz-icon" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v11M7.5 8.5 12 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <strong>{busy ? 'Uploading photos…' : 'Drop property photos here or click to browse'}</strong>
          <small className="muted">JPG, PNG or WebP · Up to 40 photos · High-res recommended</small>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      <div className="format-row" role="radiogroup" aria-label="Video format">
        {FORMATS.map((f) => (
          <button
            type="button"
            key={f.v}
            className={`format-chip ${format === f.v ? 'on' : ''}`}
            onClick={() => setFormat(f.v)}
            role="radio"
            aria-checked={format === f.v}
          >
            <span className={`ratio r${f.v.replace(':', 'x')}`} />
            <span>
              <strong>{f.label}</strong>
              <small>{f.sub}</small>
            </span>
          </button>
        ))}
      </div>

      {price && (
        <p className="price-note">
          Fetching photos is free · <b>₹{Number(price).toLocaleString('en-IN')}</b> when you make the film
          {!user && <> · <button type="button" className="link" onClick={() => go('login')}>Log in</button></>}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {/* Interactive Cinema Preview Showcase */}
      <div className="showcase">
        <div className="showcase-head">
          <div>
            <span className="eyebrow sm">LIVE FILM PREVIEW</span>
            <h2>See how your photos move &amp; grade</h2>
          </div>
          <div className="showcase-controls">
            <div className="grade-pills" role="group" aria-label="Colour grade preview">
              {OPTIONS.grade.map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  className={`grade-chip g-${val} ${demoGrade === val ? 'on' : ''}`}
                  onClick={() => setDemoGrade(val)}
                >
                  <i aria-hidden /> {lbl}
                </button>
              ))}
            </div>
            <label className="toggle sm-toggle">
              <input type="checkbox" checked={demoLetterbox} onChange={(e) => setDemoLetterbox(e.target.checked)} />
              <span className="track" />
              <span>Letterbox</span>
            </label>
          </div>
        </div>
        <FilmPreview
          images={DEMO_SCENES}
          details={DEMO_DETAILS}
          settings={{ format: demoFormat, grade: demoGrade, letterbox: demoLetterbox, motion: 'standard', imageFit: 'crop' }}
          mode={demoMode}
          onModeChange={setDemoMode}
          compact
        />
      </div>

      <ol className="steps">
        <li><span>01</span><div><strong>Get the images</strong><p>Paste any agency or listing link — or drop photos straight from your device.</p></div></li>
        <li><span>02</span><div><strong>Preview &amp; style</strong><p>Reorder shots, check titles &amp; colour grade live before rendering.</p></div></li>
        <li><span>03</span><div><strong>Download &amp; post</strong><p>Full-HD MP4 ready for property portals, YouTube, Reels &amp; WhatsApp.</p></div></li>
      </ol>

      <p className="guides-note">
        New to property videos? Read our <a href="/guides/">free guides</a> – photo tips, Reels ideas, video sizes and music.
      </p>
    </section>
  );
}
