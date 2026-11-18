import { useEffect, useRef, useState } from 'react';
import { api, BUSY } from '../api.js';
import PhotoGrid from './PhotoGrid.jsx';
import { go } from '../router.js';

const OPTIONS = {
  format: [['16:9', 'Landscape 16:9'], ['9:16', 'Vertical 9:16'], ['1:1', 'Square 1:1']],
  transition: [['cinematic', 'Cinematic mix'], ['smooth', 'Soft dissolves'], ['dynamic', 'Dynamic slides'], ['dark', 'Dip to black']],
  grade: [['golden', 'Golden hour'], ['natural', 'Natural'], ['cool', 'Cool modern'], ['mono', 'Black & white']],
  motion: [['subtle', 'Subtle'], ['standard', 'Standard'], ['bold', 'Bold']],
  music: [['ambient', 'Cinematic ambient (built-in)'], ['upload', 'My own track'], ['none', 'No music']],
};

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

  const generate = async () => {
    setError('');
    setSaving(true);
    try {
      await save();
      const p = await api.render(id);
      setProject(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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

  return (
    <section className="studio">
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
          <div className={`screen ${project.video && !busy ? '' : 'placeholder'}`} style={{ aspectRatio: aspect }}>
            {busy ? (
              <Progress project={project} />
            ) : project.video ? (
              <video key={project.video.url} src={project.video.url} poster={project.video.posterUrl || undefined} controls playsInline />
            ) : project.status === 'error' ? (
              <div className="screen-msg">
                <p className="error">{project.error}</p>
                <div className="row">
                  {project.source === 'url' && <button className="btn btn-ghost" onClick={retry}>Try again</button>}
                  <button className="btn btn-gold" onClick={() => addRef.current?.click()}>Upload photos</button>
                </div>
              </div>
            ) : (
              <div className="screen-msg">
                <p className="stage">{images.length ? `${images.length} images collected` : 'No images yet'}</p>
                <p className="muted">Step 2 — tick the photos you want, set the style, then press <b className="gold">Make Film</b>.</p>
              </div>
            )}
          </div>

          <div className="screen-actions">
            <button className="btn btn-gold lg" onClick={generate} disabled={busy || saving || !selectedCount}>
              {saving ? <span className="spinner" /> : project.video ? 'Make Film Again' : '🎬 Make Film'}
            </button>
            {project.video && !busy && (
              <a className="btn btn-ghost lg" href={project.video.url} download={`${slug(title)}.mp4`}>Download MP4</a>
            )}
            <span className="muted small">
              {selectedCount} shots · ≈{estSeconds}s
              {project.video?.duration ? ` · last render ${Math.round(project.video.duration)}s` : ''}
            </span>
          </div>
          {dirty && project.video && !busy && <p className="hint">You have unsaved changes — press Make Film Again to apply them.</p>}

          <div className="panel">
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
          <div className="panel">
            <h3>Listing details</h3>
            {DETAIL_FIELDS.map(([k, label, ph]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <input value={details[k] || ''} placeholder={ph} onChange={(e) => setD(k, e.target.value)} disabled={busy} />
              </label>
            ))}
          </div>

          <div className="panel">
            <h3>Style</h3>
            <Select label="Format" k="format" settings={settings} setS={setS} disabled={busy} />
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

          <div className="panel">
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
        </aside>
      </div>
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
