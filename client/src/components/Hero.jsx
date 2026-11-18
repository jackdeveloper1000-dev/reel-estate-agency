import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

const FORMATS = [
  { v: '16:9', label: 'Landscape', sub: 'YouTube · Web' },
  { v: '9:16', label: 'Vertical', sub: 'Reels · TikTok' },
  { v: '1:1', label: 'Square', sub: 'Feed posts' },
];

const DRAFT = 'ra_draft_url';

export default function Hero({ onCreated, user }) {
  const [url, setUrl] = useState(() => { try { return sessionStorage.getItem(DRAFT) || ''; } catch { return ''; } });
  const [format, setFormat] = useState('16:9');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const [price, setPrice] = useState(null);

  useEffect(() => { api.price().then((p) => setPrice(p.price)).catch(() => {}); }, []);

  /** Login (if needed) → run the action. Importing photos is free; payment comes at "Make Film". */
  const guarded = async (action) => {
    setError('');
    if (!user) {
      try { sessionStorage.setItem(DRAFT, url); } catch { /* ignore */ }
      go('signup');
      return;
    }
    setBusy(true);
    try {
      await action();
      try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
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
    await guarded(async () => onCreated(await api.createFromUrl(link, { format }, false)));
  };

  const onFiles = async (files) => {
    if (!files || !files.length) return;
    const list = [...files];
    if (fileRef.current) fileRef.current.value = '';
    await guarded(async () => onCreated(await api.createFromPhotos(list, { format })));
  };

  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden />
      <p className="eyebrow">AI listing films · in minutes</p>
      <h1>
        Turn any listing into a <span className="gold-text">cinematic film</span>
      </h1>
      <p className="lead">
        Paste a property link and we pull in the listing photos. Pick your favourites, press Make Film,
        and get smooth camera moves, a golden grade, titles, music and your branded end card.
      </p>

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
        <button className="btn btn-gold" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Get Images'}
        </button>
      </form>

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

      <p className="or">
        No link?{' '}
        <button type="button" className="link" onClick={() => fileRef.current?.click()} disabled={busy}>
          Upload property photos instead
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </p>

      <ol className="steps">
        <li><span>01</span><div><strong>Get the images</strong><p>Paste any agency or listing link — we collect the photos.</p></div></li>
        <li><span>02</span><div><strong>Make the film</strong><p>Choose photos &amp; style, then camera moves, grade, titles &amp; score are added.</p></div></li>
        <li><span>03</span><div><strong>Download &amp; post</strong><p>Full-HD MP4 ready for portals and socials.</p></div></li>
      </ol>
    </section>
  );
}
