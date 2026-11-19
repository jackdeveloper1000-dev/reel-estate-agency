import { useEffect, useRef, useState } from 'react';
import { api, BUSY } from '../api.js';
import PhotoGrid from './PhotoGrid.jsx';
import { go } from '../router.js';
import PayModal from './PayModal.jsx';

const OPTIONS = {
  format: [
    ['auto', 'Auto (Best fit for photos)'],
    ['16:9', 'Landscape 16:9 (YouTube / Web)'],
    ['9:16', 'Vertical 9:16 (Reels / TikTok)'],
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
  transition: [['cinematic', 'Cinematic mix'], ['smooth', 'Soft dissolves'], ['dynamic', 'Dynamic slides'], ['dark', 'Dip to black']],
  grade: [['golden', 'Golden hour'], ['natural', 'Natural'], ['cool', 'Cool modern'], ['mono', 'Black & white']],
  motion: [['subtle', 'Subtle'], ['standard', 'Standard'], ['bold', 'Bold']],
  music: [['ambient', 'Cinematic ambient (built-in)'], ['upload', 'My own track'], ['none', 'No music']],
};

const STEPS = [['photos', 'Photos'], ['details', 'Details'], ['style', 'Style'], ['music', 'Music & Pay']];
const label = (k, v) => (OPTIONS[k].find(([x]) => x === v) || OPTIONS[k][0])[1];

const DETAIL_FIELDS = [
  ['address', 'Property address', '42 Ocean View Drive, Bondi'],
  ['price', 'Price / headline', '$2,450,000 · Auction 12 Dec'],
  ['kicker', 'Opening line', 'Now Showing'],
  ['agentName', 'Agent name', 'Jane Smith'],
  ['agentPhone', 'Agent phone', '0400 000 000'],
  ['agency', 'Agency', 'Gold Realty'],
  ['cta', 'End card message', 'Book your private inspection'],
];

export default function Studio({ id, onChange }) {
  const [project, setProject] = useState(null);
  const [details, setDetails] = useState({});
  const [settings, setSettings] = useState({});
  const [images, setImages] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [htmlText, setHtmlText] = useState('');
  const [importingHtml, setImportingHtml] = useState(false);
  const [step, setStep] = useState('photos'); // wizard: photos → details → style → music & pay
  const [payOpen, setPayOpen] = useState(false);
  const [price, setPrice] = useState(null);
  const musicRef = useRef(null);
  const addRef = useRef(null);
  const wasBusy = useRef(false);

  const hydrate = (p) => {
    setProject(p);
    setDetails(p.details || {});
    setSettings(p.settings || {});
    setImages(p.images || []);
    setDirty(false);
  };

  // initial load
  useEffect(() => {
    api.get(id).then(hydrate).catch((e) => setError(e.message));
    api.price().then((r) => setPrice(r.price)).catch(() => {});
  }, [id]);

  // poll while busy; only refresh status/progress so in-progress edits aren't lost
  useEffect(() => {
    if (!project || !BUSY.includes(project.status)) return;
    wasBusy.current = true;
    const t = setInterval(async () => {
      try {
        const p = await api.get(id);
        if (BUSY.includes(p.status)) {
          setProject((old) => ({ ...old, status: p.status, progress: p.progress, stage: p.stage, details: p.details }));
          if (!dirty) {
            setImages(p.images || []);
            setDetails(p.details || {});
            setSettings(p.settings || {});
          }
        } else {
          // finished: take fresh images/details from the server unless the user is editing
          setProject(p);
          if (!dirty) hydrate(p);
          else setImages((cur) => (cur.length ? cur : p.images));
          onChange && onChange();
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [project?.status, id, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !project) {
    return (
      <section className="studio empty">
        <p className="error">{error}</p>
        <button className="btn btn-ghost" onClick={() => go('')}>Back</button>
      </section>
    );
  }
  if (!project) return <section className="studio loading"><span className="spinner big" /></section>;

  const busy = BUSY.includes(project.status);
  const selectedCount = images.filter((i) => i.selected).length;
  const estSeconds = Math.round(selectedCount * ((settings.secondsPerShot || 4) - 1) + 4.5);

  const setD = (k, v) => { setDetails((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setS = (k, v) => { setSettings((s) => ({ ...s, [k]: v })); setDirty(true); };
  const setImgs = (next) => { setImages(next); setDirty(true); };

  const save = async () => {
    const p = await api.update(id, {
      details,
      settings,
      images: images.map((i) => ({ id: i.id, selected: i.selected })),
    });
    hydrate(p);
    return p;
  };

  // One payment = one render (a failed render can be retried without paying again)
  const generate = async () => {
    setError('');
    setSaving(true);
    try {
      const saved = await save();
      if (!saved.paid) {
        const s = await api.paymentSummary();
        if (s.credits < 1) { setPayOpen(true); return; }
      }
      const p = await api.render(id);
      setProject(p);
    } catch (e) {
      if (e.code === 'PAYMENT_REQUIRED') setPayOpen(true);
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const priceLabel = price ? `₹${Number(price).toLocaleString('en-IN')}` : '';

  const stepIndex = STEPS.findIndex(([k]) => k === step);
  const isLast = stepIndex === STEPS.length - 1;
  const goStep = (k) => {
    setStep(k);
    requestAnimationFrame(() => document.querySelector('.stepper')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const onMusic = async (file) => {
    if (!file) return;
    try {
      await save();
      hydrate(await api.uploadMusic(id, file));
    } catch (e) { setError(e.message); }
  };

  const onAddPhotos = async (files) => {
    if (!files?.length) return;
    try {
      await save();
      hydrate(await api.addPhotos(id, files));
    } catch (e) { setError(e.message); }
  };

  const retry = async () => {
    setError('');
    try { setProject(await api.retry(id)); } catch (e) { setError(e.message); }
  };

  const submitHtml = async (e) => {
    e.preventDefault();
    if (!htmlText.trim()) return setError('Paste the listing page HTML first.');
    setError('');
    setImportingHtml(true);
    try {
      const p = await api.importHtml(id, htmlText, project.sourceUrl);
      setShowHtml(false);
      setHtmlText('');
      setProject(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingHtml(false);
    }
  };

  // Two-step delete (no browser popup – some browsers block confirm dialogs)
  const remove = async () => {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    setDeleting(true);
    try {
      await api.remove(id);
      onChange && onChange();
      go('films');
    } catch (e) {
      setError(e.message);
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  const title = details.address || project.details?.title || (project.sourceUrl ? new URL(project.sourceUrl).hostname : 'Uploaded photos');
  const aspect = (project.video?.width && project.video?.height) ? `${project.video.width} / ${project.video.height}` : (settings.format || '16:9').replace(':', ' / ');

  // Finished film: photos are deleted, only the video is shown
  if (project.status === 'done' && project.video) {
    const v = project.video;
    return (
      <section className="studio final">
        <div className="studio-head">
          <div>
            <button className="link back" onClick={() => go('films')}>← All films</button>
            <h2>{title}</h2>
            {details.price && <p className="muted final-price">{details.price}</p>}
          </div>
          <div className="head-actions">
            <span className="badge s-done">Film ready</span>
            <button className={`btn sm ${confirmDel ? 'btn-danger' : 'btn-ghost'}`} onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting…' : confirmDel ? 'Click again to delete' : 'Delete'}
            </button>
          </div>
        </div>
        {error && <p className="error top-error">{error}</p>}
        <div className="final-player" style={{ aspectRatio: `${v.width || 16} / ${v.height || 9}` }}>
          <video src={v.url} poster={v.posterUrl || undefined} controls playsInline preload="metadata" />
        </div>
        <div className="final-meta">
          <span>{v.width && v.height ? `${v.width}×${v.height}` : settings.format}</span>
          {v.duration ? <span>{Math.round(v.duration)}s</span> : null}
          {v.renderedAt ? <span>Made {new Date(v.renderedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> : null}
        </div>
        <div className="screen-actions step-actions final-actions">
          <a className="btn btn-gold lg next-btn" href={v.url} download={`${slug(title)}.mp4`}>⬇ Download MP4</a>
          <button className="btn btn-ghost lg" onClick={() => go('')}>+ New film</button>
        </div>
        <p className="muted small center final-note">The listing photos were removed after your film was made. Each payment covers one film.</p>
      </section>
    );
  }

  return (
    <section className="studio" data-mtab={step}>
      <div className="studio-head">
        <div>
          <button className="link back" onClick={() => go('films')}>← All films</button>
          <h2>{title}</h2>
          {project.sourceUrl && (
            <a className="source" href={project.sourceUrl} target="_blank" rel="noreferrer">{project.sourceUrl}</a>
          )}
        </div>
        <div className="head-actions">
          <span className={`badge s-${project.status}`}>{labelFor(project.status)}</span>
          <button className={`btn sm ${confirmDel ? 'btn-danger' : 'btn-ghost'}`} onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : confirmDel ? 'Click again to delete' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <p className="error top-error">{error}</p>}

      <div className="studio-grid">
        {/* Screen */}
        <div className="screen-col">
          <div className={`screen ${project.video && !busy ? '' : 'placeholder'} ${showHtml ? 'html-open' : ''}`} style={showHtml ? undefined : { aspectRatio: aspect }}>
            {busy ? (
              <Progress project={project} />
            ) : project.video ? (
              <video key={project.video.url} src={project.video.url} poster={project.video.posterUrl || undefined} controls playsInline />
            ) : project.status === 'error' ? (
              showHtml ? (
                <form className="html-box" onSubmit={submitHtml}>
                  <p className="stage">Import from page HTML</p>
                  <p className="muted small html-steps">
                    1.{' '}
                    {project.sourceUrl ? (
                      <a href={project.sourceUrl} target="_blank" rel="noreferrer">Open the listing page</a>
                    ) : (
                      'Open the listing page'
                    )}{' '}
                    in your browser · 2. Press <code>Ctrl+U</code> (View Source), then <code>Ctrl+A</code> and <code>Ctrl+C</code> · 3. Paste below.
                  </p>
                  <textarea
                    rows={6}
                    value={htmlText}
                    onChange={(e) => setHtmlText(e.target.value)}
                    placeholder="Paste full page HTML (or image URLs, one per line)…"
                    disabled={importingHtml}
                    autoFocus
                  />
                  <div className="row">
                    <button type="submit" className="btn btn-gold" disabled={importingHtml || !htmlText.trim()}>
                      {importingHtml ? <span className="spinner" /> : 'Extract photos'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setShowHtml(false)} disabled={importingHtml}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="screen-msg">
                  <p className="error">{project.error}</p>
                  <div className="row">
                    {project.source === 'url' && <button className="btn btn-ghost" onClick={retry}>Try again</button>}
                    <button className="btn btn-ghost" onClick={() => { setError(''); setShowHtml(true); }}>Paste page HTML</button>
                    <button className="btn btn-gold" onClick={() => addRef.current?.click()}>Upload photos</button>
                  </div>
                </div>
              )
            ) : (
              <div className="screen-msg">
                <p className="stage">{images.length ? `${images.length} images collected` : 'No images yet'}</p>
                <p className="muted">Tick the photos you want, then press <b className="gold">Next</b> to add details and style.</p>
              </div>
            )}
          </div>

          <ol className="stepper" aria-label="Film steps">
            {STEPS.map(([k, label], i) => (
              <li key={k} className={`${step === k ? 'on' : ''} ${i < stepIndex ? 'done' : ''}`}>
                <button type="button" onClick={() => goStep(k)} aria-current={step === k ? 'step' : undefined}>
                  <span className="num">{i < stepIndex ? '✓' : i + 1}</span>
                  <span className="lbl">{label}{k === 'photos' && selectedCount ? <i>{selectedCount}</i> : null}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="panel" data-tab="photos">
            <div className="panel-head">
              <h3>Photos <span className="muted">· click to include, drag to reorder</span></h3>
              <button className="btn btn-ghost sm" onClick={() => addRef.current?.click()} disabled={busy}>+ Add photos</button>
              <input ref={addRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onAddPhotos(e.target.files)} />
            </div>
            {project.status === 'scraping' && !images.length ? (
              <div className="skeleton-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" />)}</div>
            ) : (
              <PhotoGrid images={images} onChange={setImgs} disabled={busy} />
            )}
          </div>
        </div>

        {/* Controls */}
        <aside className="controls">
          <div className="panel" data-tab="details">
            <h3>Listing details</h3>
            {DETAIL_FIELDS.map(([k, label, ph]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <input value={details[k] || ''} placeholder={ph} onChange={(e) => setD(k, e.target.value)} disabled={busy} />
              </label>
            ))}
          </div>

          <div className="panel" data-tab="style">
            <h3>Style</h3>
            <Select label="Format" k="format" settings={settings} setS={setS} disabled={busy} />
            <Select label="Image framing" k="imageFit" settings={settings} setS={setS} disabled={busy} />
            <Select label="Transitions" k="transition" settings={settings} setS={setS} disabled={busy} />
            <Select label="Colour grade" k="grade" settings={settings} setS={setS} disabled={busy} />
            <Select label="Camera motion" k="motion" settings={settings} setS={setS} disabled={busy} />
            <label className="field">
              <span>Seconds per shot <b className="gold">{settings.secondsPerShot || 4}s</b></span>
              <input type="range" min="2.5" max="7" step="0.5" value={settings.secondsPerShot || 4} onChange={(e) => setS('secondsPerShot', Number(e.target.value))} disabled={busy} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={settings.letterbox !== false} onChange={(e) => setS('letterbox', e.target.checked)} disabled={busy} />
              <span className="track" />
              <span>Cinema letterbox (landscape)</span>
            </label>
          </div>

          <div className="panel" data-tab="music">
            <h3>Music</h3>
            <Select label="Soundtrack" k="music" settings={settings} setS={setS} disabled={busy} />
            {settings.music === 'upload' && (
              <div className="music-up">
                <span className="muted small">{project.musicFile ? 'Track uploaded ✓' : 'No track yet'}</span>
                <button className="btn btn-ghost sm" onClick={() => musicRef.current?.click()} disabled={busy}>
                  {project.musicFile ? 'Replace track' : 'Upload MP3 / WAV'}
                </button>
                <input ref={musicRef} type="file" accept="audio/*" hidden onChange={(e) => onMusic(e.target.files?.[0])} />
                <p className="muted small">Only use music you own or have a licence for.</p>
              </div>
            )}
          </div>

          <div className="panel review" data-tab="music">
            <h3>Review &amp; make film</h3>
            <ul className="review-list">
              <li><span>Photos</span><b>{selectedCount} shots</b></li>
              <li><span>Length</span><b>≈{estSeconds}s</b></li>
              <li><span>Format</span><b>{settings.format || '16:9'}</b></li>
              <li><span>Style</span><b>{label('grade', settings.grade)} · {label('transition', settings.transition)}</b></li>
              <li className="total"><span>{project.paid ? 'Payment' : 'To pay'}</span><b>{project.paid ? 'Paid ✓' : priceLabel || '—'}</b></li>
            </ul>
            {!project.paid && <p className="muted small">One payment = one film. After it’s made, the photos are removed and your MP4 stays here to download.</p>}
            {dirty && project.video && !busy && <p className="hint">You have unsaved changes — press Make Film Again to apply them.</p>}
          </div>
        </aside>
      </div>

      {/* Step navigation – the payment button only appears on the last step */}
      <div className="screen-actions step-actions">
        {busy ? (
          <button className="btn btn-gold lg" disabled>{`${labelFor(project.status)} ${Math.max(0, project.progress || 0)}%`}</button>
        ) : (
          <>
            {stepIndex > 0 && (
              <button className="btn btn-ghost lg back-btn" onClick={() => goStep(STEPS[stepIndex - 1][0])}>← Back</button>
            )}
            {project.video && (
              <a className="btn btn-ghost lg" href={project.video.url} download={`${slug(title)}.mp4`}>
                <span className="dl-full">Download MP4</span><span className="dl-short">⬇ MP4</span>
              </a>
            )}
            {!isLast ? (
              <button className="btn btn-gold lg next-btn" onClick={() => goStep(STEPS[stepIndex + 1][0])} disabled={step === 'photos' && !selectedCount}>
                {step === 'photos' && !selectedCount ? 'Select photos' : `Next: ${STEPS[stepIndex + 1][1]} →`}
              </button>
            ) : (
              <button className="btn btn-gold lg next-btn" onClick={generate} disabled={saving || !selectedCount}>
                {saving ? <span className="spinner" /> : project.paid || !priceLabel ? '🎬 Make Film' : `Pay ${priceLabel} & Make Film`}
              </button>
            )}
          </>
        )}
      </div>

      <PayModal open={payOpen} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); generate(); }} />
    </section>
  );
}

function Select({ label, k, settings, setS, disabled }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={settings[k] || OPTIONS[k][0][0]} onChange={(e) => setS(k, e.target.value)} disabled={disabled}>
        {OPTIONS[k].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Progress({ project }) {
  const pct = Math.max(2, project.progress || 0);
  return (
    <div className="progress-wrap">
      <div className="reel" aria-hidden><span /><span /><span /></div>
      <p className="stage">{project.stage || labelFor(project.status)}</p>
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="muted small">
        {project.status === 'scraping' ? 'Collecting listing photos' : project.status === 'queued' ? 'Queued' : 'Rendering in Full HD'} · {pct}%
      </p>
    </div>
  );
}

export function labelFor(status) {
  return { scraping: 'Importing', ready: 'Ready', queued: 'Queued', rendering: 'Rendering', done: 'Film ready', error: 'Needs attention' }[status] || status;
}

const slug = (s) => String(s || 'property-film').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'property-film';
