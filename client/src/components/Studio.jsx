import { useCallback, useEffect, useRef, useState } from 'react';
import { api, BUSY } from '../api.js';
import { go } from '../router.js';
import { ambientPreview } from '../utils/audioPreview.js';
import {
  DETAIL_FIELDS,
  OPTIONS,
  STEPS,
  formatAspectRatio,
  label,
  labelFor,
  safeHost,
  slug,
} from '../utils/studioOptions.js';
import FilmPreview from './FilmPreview.jsx';
import PayModal from './PayModal.jsx';
import PhotoGrid from './PhotoGrid.jsx';

const END_CARD_KEYS = new Set(['cta', 'agentName', 'agentPhone', 'agency']);

export default function Studio({ id, onChange }) {
  const [project, setProject] = useState(null);
  const [details, setDetails] = useState({});
  const [settings, setSettings] = useState({});
  const [images, setImages] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [htmlText, setHtmlText] = useState('');
  const [importingHtml, setImportingHtml] = useState(false);
  const [step, setStep] = useState('photos'); // photos | details | style | music
  const [previewMode, setPreviewMode] = useState('opening'); // opening | shots | endcard
  const [audioPlaying, setAudioPlaying] = useState(false); // false | 'ambient' | 'upload'
  const [payOpen, setPayOpen] = useState(false);
  const [price, setPrice] = useState(null);
  const [duplicatingFmt, setDuplicatingFmt] = useState('');
  const [purging, setPurging] = useState(false);

  const musicRef = useRef(null);
  const addRef = useRef(null);
  const audioRef = useRef(null);
  const editSeqRef = useRef(0);
  const autoSaveTimerRef = useRef(null);
  const latestRef = useRef({ details: {}, settings: {}, images: [] });
  latestRef.current = { details, settings, images };

  const hydrate = useCallback((p) => {
    setProject(p);
    setDetails(p.details || {});
    setSettings(p.settings || {});
    setImages(p.images || []);
    setDirty(false);
  }, []);

  // initial load
  useEffect(() => {
    api.get(id).then(hydrate).catch((e) => setError(e.message));
    api.price().then((r) => setPrice(r.price)).catch(() => {});
  }, [id, hydrate]);

  // cleanup audio and timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      ambientPreview.stop();
    };
  }, []);

  // warn only if user tries closing tab with un-synced edits
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // poll while busy; only refresh status/progress so in-progress edits aren't lost
  useEffect(() => {
    if (!project || !BUSY.includes(project.status)) return;
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
          setProject(p);
          if (!dirty) hydrate(p);
          else setImages((cur) => (cur.length ? cur : p.images));
          onChange && onChange();
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [project?.status, id, dirty, hydrate]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushAutoSave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!project || BUSY.includes(project.status) || project.status === 'done') return;
    const seq = editSeqRef.current;
    const snap = latestRef.current;
    setSaveState('saving');
    try {
      const updated = await api.update(id, {
        details: snap.details,
        settings: snap.settings,
        images: snap.images.map((i) => ({ id: i.id, selected: i.selected })),
      });
      setProject((old) => (old ? { ...old, ...updated, details: old.details, settings: old.settings, images: old.images } : updated));
      if (editSeqRef.current === seq) {
        setDirty(false);
        setSaveState('saved');
      }
    } catch {
      if (editSeqRef.current === seq) setSaveState('error');
    }
  }, [id, project]);

  // debounced auto-save after any edit
  useEffect(() => {
    if (!dirty || !project || BUSY.includes(project.status) || project.status === 'done') return;
    setSaveState('idle');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      flushAutoSave();
    }, 900);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [dirty, details, settings, images, project, flushAutoSave]);

  const stopAudioPreview = useCallback(() => {
    ambientPreview.stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setAudioPlaying(false);
  }, []);

  useEffect(() => {
    stopAudioPreview();
  }, [settings.music, project?.musicFile, stopAudioPreview]);

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
  const selectedImages = images.filter((i) => i.selected);
  const selectedCount = selectedImages.length;
  const estSeconds = Math.round(selectedCount * ((settings.secondsPerShot || 4) - 1) + 4.5);
  const { ratio: targetRatio, css: previewAspect } = formatAspectRatio(settings.format, selectedImages);

  const markEdit = () => {
    editSeqRef.current += 1;
    setDirty(true);
  };
  const setD = (k, v) => {
    setDetails((d) => ({ ...d, [k]: v }));
    markEdit();
  };
  const setS = (k, v) => {
    setSettings((s) => ({ ...s, [k]: v }));
    markEdit();
  };
  const setImgs = (next) => {
    setImages(next);
    markEdit();
  };

  const save = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const p = await api.update(id, {
      details,
      settings,
      images: images.map((i) => ({ id: i.id, selected: i.selected })),
    });
    hydrate(p);
    setSaveState('saved');
    return p;
  };

  const leaveToLibrary = async () => {
    stopAudioPreview();
    if (dirty && !busy && project.status !== 'done') {
      await flushAutoSave();
    }
    go('films');
  };

  // One payment = one render (a failed render can be retried without paying again)
  const generate = async () => {
    stopAudioPreview();
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
    if (k === 'photos' && previewMode === 'endcard') setPreviewMode('shots');
    if (k === 'details' && previewMode === 'shots') setPreviewMode('opening');
    if (dirty) flushAutoSave();
    if (typeof window !== 'undefined' && window.innerWidth <= 960) {
      requestAnimationFrame(() => document.querySelector('.stepper')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const toggleAudioPreview = async () => {
    setError('');
    if (audioPlaying) {
      stopAudioPreview();
      return;
    }
    try {
      if (settings.music === 'upload' && project.musicFile && audioRef.current) {
        await audioRef.current.play();
        setAudioPlaying('upload');
      } else if (settings.music !== 'none') {
        ambientPreview.start();
        setAudioPlaying('ambient');
      }
    } catch (e) {
      setError(e.message || 'Could not start audio preview.');
      stopAudioPreview();
    }
  };

  const onMusic = async (file) => {
    if (!file) return;
    stopAudioPreview();
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
    stopAudioPreview();
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

  const duplicateAs = async (fmt) => {
    setError('');
    setDuplicatingFmt(fmt);
    try {
      const copy = await api.duplicate(id, { format: fmt });
      onChange && onChange();
      go(`project/${copy.id}`);
    } catch (e) {
      setError(e.message);
      setDuplicatingFmt('');
    }
  };

  const purgeSources = async () => {
    setError('');
    setPurging(true);
    try {
      const updated = await api.purgeSources(id);
      hydrate(updated);
      onChange && onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setPurging(false);
    }
  };

  const title = details.address || project.details?.title || (project.sourceUrl ? safeHost(project.sourceUrl) : 'Uploaded photos');
  const uploadedMusicUrl = project.musicFile ? `/media/projects/${project.id}/${encodeURIComponent(project.musicFile)}` : '';

  // Finished film: show player + optional multi-format export while sources are retained
  if (project.status === 'done' && project.video) {
    const v = project.video;
    const hasSources = images.length > 0;
    const exportTargets = [
      ['9:16', 'Reels / Shorts (9:16)'],
      ['16:9', 'Landscape (16:9)'],
      ['1:1', 'Square (1:1)'],
      ['4:5', 'Portrait (4:5)'],
    ];
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
          <span>{v.width && v.height ? `${v.width}×${v.height}` : label('format', settings.format || 'auto')}</span>
          {v.duration ? <span>{Math.round(v.duration)}s</span> : null}
          {v.renderedAt ? <span>Made {new Date(v.renderedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> : null}
        </div>
        <div className="screen-actions step-actions final-actions">
          <a className="btn btn-gold lg next-btn" href={v.url} download={`${slug(title)}.mp4`}>Download MP4</a>
          <button className="btn btn-ghost lg" onClick={() => go('')}>+ New film</button>
        </div>
        {hasSources && (
          <div className="panel export-box">
            <div className="panel-head">
              <h3>Export another format <span className="muted">· reuse the same {images.length} photos</span></h3>
              <button className="link small" type="button" onClick={purgeSources} disabled={purging}>
                {purging ? 'Removing…' : 'Remove source photos now'}
              </button>
            </div>
            <div className="export-chips">
              {exportTargets.map(([fmt, lbl]) => (
                <button
                  key={fmt}
                  type="button"
                  className="btn btn-ghost sm"
                  disabled={Boolean(duplicatingFmt)}
                  onClick={() => duplicateAs(fmt)}
                >
                  {duplicatingFmt === fmt ? 'Preparing…' : `+ ${lbl}`}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="muted small center final-note">
          {hasSources
            ? `Source photos stay available for ${project.sourceRetentionDays || 7} days so you can create another aspect ratio, then are removed automatically. Each payment covers one rendered film.`
            : 'The listing photos were removed after your film was made. Each payment covers one film.'}
        </p>
      </section>
    );
  }

  const showLivePreview = !busy && !project.video && !(project.status === 'error' && images.length === 0) && selectedCount > 0;

  return (
    <section className="studio" data-mtab={step}>
      <div className="studio-head">
        <div>
          <button className="link back" onClick={leaveToLibrary}>← All films</button>
          <h2>{title}</h2>
          {project.sourceUrl && (
            <a className="source" href={project.sourceUrl} target="_blank" rel="noreferrer">{project.sourceUrl}</a>
          )}
        </div>
        <div className="head-actions">
          {!busy && (
            <span className={`save-pill ${saveState}`}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' && !dirty ? 'Saved ✓' : dirty ? 'Unsaved' : ''}
            </span>
          )}
          <span className={`badge s-${project.status}`}>{labelFor(project.status)}</span>
          <button className={`btn sm ${confirmDel ? 'btn-danger' : 'btn-ghost'}`} onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : confirmDel ? 'Click again to delete' : 'Delete'}
          </button>
        </div>
      </div>

      {error && <p className="error top-error">{error}</p>}

      <div className="studio-grid">
        {/* Screen / Live Stage Preview */}
        <div className="screen-col">
          {showLivePreview ? (
            <FilmPreview
              images={images}
              details={details}
              settings={settings}
              mode={previewMode}
              onModeChange={setPreviewMode}
            />
          ) : (
            <div
              className={`screen ${project.video && !busy ? '' : 'placeholder'} ${showHtml ? 'html-open' : ''}`}
              style={showHtml ? undefined : { aspectRatio: project.video?.width && project.video?.height ? `${project.video.width} / ${project.video.height}` : previewAspect }}
            >
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
                  <p className="stage">{images.length ? 'No photos selected' : 'No images yet'}</p>
                  <p className="muted">
                    {images.length
                      ? 'Select at least one photo on the right to see your live film preview.'
                      : 'Add listing photos to begin building your film.'}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="studio-summary" aria-label="Film summary">
            <span>{selectedCount} shots</span>
            <span>≈{estSeconds}s</span>
            <span>{label('format', settings.format || 'auto')}</span>
            <span>{label('grade', settings.grade)}</span>
          </div>
        </div>

        {/* Editor wizard */}
        <div className="studio-editor">
          <ol className="stepper" aria-label="Film steps">
            {STEPS.map(([k, lbl], i) => (
              <li key={k} className={`${step === k ? 'on' : ''} ${i < stepIndex ? 'done' : ''}`}>
                <button type="button" onClick={() => goStep(k)} aria-current={step === k ? 'step' : undefined}>
                  <span className="num">{i < stepIndex ? '✓' : i + 1}</span>
                  <span className="lbl">{lbl}{k === 'photos' && selectedCount ? <i>{selectedCount}</i> : null}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="controls">
            <div className="panel" data-tab="photos">
              <div className="panel-head">
                <h3>Photos <span className="muted">· click to include, drag to reorder</span></h3>
                <button className="btn btn-ghost sm" onClick={() => addRef.current?.click()} disabled={busy}>+ Add photos</button>
                <input ref={addRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onAddPhotos(e.target.files)} />
              </div>
              {project.status === 'scraping' && !images.length ? (
                <div className="skeleton-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" />)}</div>
              ) : (
                <PhotoGrid
                  images={images}
                  onChange={setImgs}
                  disabled={busy}
                  targetRatio={targetRatio}
                  fitMode={settings.imageFit || 'auto'}
                  endCardImageId={settings.endCardImageId || ''}
                  onSetEndCard={(imgId) => setS('endCardImageId', settings.endCardImageId === imgId ? '' : imgId)}
                />
              )}
            </div>

            <div className="panel" data-tab="details">
              <h3>Listing details</h3>
              {DETAIL_FIELDS.map(([k, lbl, ph]) => (
                <label key={k} className="field">
                  <span>{lbl}</span>
                  <input
                    value={details[k] || ''}
                    placeholder={ph}
                    onFocus={() => setPreviewMode(END_CARD_KEYS.has(k) ? 'endcard' : 'opening')}
                    onChange={(e) => setD(k, e.target.value)}
                    disabled={busy}
                  />
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
              {settings.music !== 'none' && (
                <div className="music-preview-row">
                  {(settings.music !== 'upload' || project.musicFile) && (
                    <button type="button" className="btn btn-ghost sm" onClick={toggleAudioPreview} disabled={busy}>
                      {audioPlaying ? '■ Stop preview' : settings.music === 'upload' ? '▶ Play uploaded track' : '▶ Preview built-in score'}
                    </button>
                  )}
                  {project.musicFile && settings.music === 'upload' && (
                    <audio
                      ref={audioRef}
                      src={uploadedMusicUrl}
                      preload="metadata"
                      onEnded={() => setAudioPlaying(false)}
                    />
                  )}
                </div>
              )}
              {settings.music === 'upload' && (
                <div className="music-up">
                  <span className="muted small">{project.musicFile ? `Track uploaded: ${project.musicFile}` : 'No track yet'}</span>
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
                <li><span>Format</span><b>{label('format', settings.format || 'auto')}</b></li>
                <li><span>Style</span><b>{label('grade', settings.grade)} · {label('transition', settings.transition)}</b></li>
                <li className="total"><span>{project.paid ? 'Payment' : 'To pay'}</span><b>{project.paid ? 'Paid ✓' : priceLabel || '—'}</b></li>
              </ul>
              {!project.paid && <p className="muted small">One payment = one film. After it’s made, the photos are removed and your MP4 stays here to download.</p>}
              {dirty && project.video && !busy && <p className="hint">You have unsaved changes — press Make Film Again to apply them.</p>}
            </div>
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
                    <span className="dl-full">Download MP4</span><span className="dl-short">MP4</span>
                  </a>
                )}
                {!isLast ? (
                  <button className="btn btn-gold lg next-btn" onClick={() => goStep(STEPS[stepIndex + 1][0])} disabled={step === 'photos' && !selectedCount}>
                    {step === 'photos' && !selectedCount ? 'Select photos' : `Next: ${STEPS[stepIndex + 1][1]} →`}
                  </button>
                ) : (
                  <button className="btn btn-gold lg next-btn" onClick={generate} disabled={saving || !selectedCount}>
                    {saving ? <span className="spinner" /> : project.paid || !priceLabel ? 'Make Film' : `Pay ${priceLabel} & Make Film`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PayModal open={payOpen} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); generate(); }} />
    </section>
  );
}

function Select({ label: fieldLabel, k, settings, setS, disabled }) {
  return (
    <label className="field">
      <span>{fieldLabel}</span>
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
