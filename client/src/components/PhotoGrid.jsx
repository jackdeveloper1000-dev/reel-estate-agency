import { useEffect, useState } from 'react';
import { isRatioMismatch } from '../utils/studioOptions.js';

export default function PhotoGrid({ images, onChange, disabled, targetRatio, fitMode = 'auto', endCardImageId = '', onSetEndCard }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [inspectIdx, setInspectIdx] = useState(null);

  useEffect(() => {
    if (inspectIdx === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setInspectIdx(null);
      if (e.key === 'ArrowRight') setInspectIdx((i) => (i == null ? null : (i + 1) % images.length));
      if (e.key === 'ArrowLeft') setInspectIdx((i) => (i == null ? null : (i - 1 + images.length) % images.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectIdx, images.length]);

  if (!images.length) return <p className="muted">No photos yet.</p>;

  const toggle = (i) => {
    if (disabled) return;
    const next = images.map((img, j) => (j === i ? { ...img, selected: !img.selected } : img));
    onChange(next);
  };

  const move = (from, to) => {
    if (disabled || from === to || from == null || to == null) return;
    const next = [...images];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
    if (inspectIdx === from) setInspectIdx(to);
  };

  const all = (v) => !disabled && onChange(images.map((img) => ({ ...img, selected: v })));
  let shot = 0;

  const inspected = inspectIdx != null ? images[inspectIdx] : null;
  const inspectedLowRes = inspected && ((inspected.width && inspected.width < 900) || (inspected.height && inspected.height < 550));
  const inspectedMismatch = inspected && isRatioMismatch(inspected, targetRatio);

  return (
    <>
      <div className="grid-tools">
        <button type="button" className="link" onClick={() => all(true)} disabled={disabled}>Select all</button>
        <button type="button" className="link" onClick={() => all(false)} disabled={disabled}>Clear</button>
        <span className="muted small grid-tip">Tap to include · zoom icon to inspect</span>
      </div>
      <ul className="photo-grid">
        {images.map((img, i) => {
          const n = img.selected ? ++shot : null;
          const lowRes = (img.width && img.width < 900) || (img.height && img.height < 550);
          const cropRisk = img.selected && fitMode === 'crop' && isRatioMismatch(img, targetRatio);
          return (
            <li
              key={img.id}
              tabIndex={disabled ? -1 : 0}
              className={`photo ${img.selected ? 'on' : 'off'} ${overIdx === i ? 'over' : ''} ${dragIdx === i ? 'dragging' : ''}`}
              draggable={!disabled}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
              onDragLeave={() => setOverIdx(null)}
              onDrop={(e) => { e.preventDefault(); move(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              onClick={() => toggle(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(i);
                }
              }}
              title={img.selected ? 'Included – click to remove' : 'Excluded – click to include'}
            >
              <img src={img.url} alt="" loading="lazy" />
              <span className="num">{n ?? '–'}</span>
              {String(endCardImageId) === String(img.id) && (
                <span className="end-pin" title="Used as end card backdrop">END</span>
              )}
              {(lowRes || cropRisk) && (
                <span
                  className="photo-warn"
                  title={lowRes ? 'Lower resolution photo — may look softer in Full HD' : 'Aspect ratio differs from format — Auto framing avoids heavy cropping'}
                >
                  !
                </span>
              )}
              {img.width && <span className="dim">{img.width}×{img.height}</span>}
              <span className="check" aria-hidden>{img.selected ? '✓' : ''}</span>
              <span className="moves">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setInspectIdx(i); }}
                  aria-label="Inspect photo"
                  title="Inspect photo"
                >
                  ⤢
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); move(i, Math.max(0, i - 1)); }}
                  disabled={disabled || i === 0}
                  aria-label="Move earlier"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); move(i, Math.min(images.length - 1, i + 1)); }}
                  disabled={disabled || i === images.length - 1}
                  aria-label="Move later"
                >
                  ›
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {inspected && (
        <div className="sheet-backdrop lightbox-bg" onClick={() => setInspectIdx(null)}>
          <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo preview" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-head">
              <div>
                <strong>Photo {inspectIdx + 1} of {images.length}</strong>
                {inspected.width && (
                  <span className="muted small">
                    {' '}· {inspected.width}×{inspected.height} ({inspected.width >= inspected.height ? 'Landscape' : 'Portrait'})
                  </span>
                )}
              </div>
              <button type="button" className="btn btn-ghost sm" onClick={() => setInspectIdx(null)} aria-label="Close preview">✕</button>
            </div>
            <div className="lightbox-img">
              <img src={inspected.url} alt="" />
            </div>
            {(inspectedLowRes || inspectedMismatch) && (
              <p className="hint lightbox-note">
                {inspectedLowRes ? 'Lower resolution image — works best as a shorter shot or excluded if blurry. ' : ''}
                {inspectedMismatch ? 'Orientation differs from your selected video format — Auto or Blur-pad framing keeps the full room visible.' : ''}
              </p>
            )}
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => setInspectIdx((inspectIdx - 1 + images.length) % images.length)}
                disabled={images.length <= 1}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => move(inspectIdx, Math.max(0, inspectIdx - 1))}
                disabled={disabled || inspectIdx === 0}
              >
                Move earlier
              </button>
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => move(inspectIdx, Math.min(images.length - 1, inspectIdx + 1))}
                disabled={disabled || inspectIdx === images.length - 1}
              >
                Move later
              </button>
              <button
                type="button"
                className={`btn sm ${inspected.selected ? 'btn-ghost' : 'btn-gold'}`}
                onClick={() => toggle(inspectIdx)}
                disabled={disabled}
              >
                {inspected.selected ? 'Exclude from film' : 'Include in film'}
              </button>
              {onSetEndCard && (
                <button
                  type="button"
                  className={`btn sm ${String(endCardImageId) === String(inspected.id) ? 'btn-gold' : 'btn-ghost'}`}
                  onClick={() => onSetEndCard(inspected.id)}
                  disabled={disabled}
                >
                  {String(endCardImageId) === String(inspected.id) ? 'End Card Backdrop ✓' : 'Use as End Card'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => setInspectIdx((inspectIdx + 1) % images.length)}
                disabled={images.length <= 1}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
