import { useState } from 'react';

export default function PhotoGrid({ images, onChange, disabled }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  if (!images.length) return <p className="muted">No photos yet.</p>;

  const toggle = (i) => {
    if (disabled) return;
    const next = images.map((img, j) => (j === i ? { ...img, selected: !img.selected } : img));
    onChange(next);
  };

  const move = (from, to) => {
    if (from === to || from == null || to == null) return;
    const next = [...images];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const all = (v) => onChange(images.map((img) => ({ ...img, selected: v })));
  let shot = 0;

  return (
    <>
      <div className="grid-tools">
        <button className="link" onClick={() => all(true)} disabled={disabled}>Select all</button>
        <button className="link" onClick={() => all(false)} disabled={disabled}>Clear</button>
      </div>
      <ul className="photo-grid">
        {images.map((img, i) => {
          const n = img.selected ? ++shot : null;
          return (
            <li
              key={img.id}
              className={`photo ${img.selected ? 'on' : 'off'} ${overIdx === i ? 'over' : ''} ${dragIdx === i ? 'dragging' : ''}`}
              draggable={!disabled}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
              onDragLeave={() => setOverIdx(null)}
              onDrop={(e) => { e.preventDefault(); move(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              onClick={() => toggle(i)}
              title={img.selected ? 'Included – click to remove' : 'Excluded – click to include'}
            >
              <img src={img.url} alt="" loading="lazy" />
              <span className="num">{n ?? '–'}</span>
              {img.width && <span className="dim">{img.width}×{img.height}</span>}
              <span className="check" aria-hidden>{img.selected ? '✓' : ''}</span>
              <span className="moves">
                <button onClick={(e) => { e.stopPropagation(); move(i, Math.max(0, i - 1)); }} disabled={disabled || i === 0} aria-label="Move earlier">‹</button>
                <button onClick={(e) => { e.stopPropagation(); move(i, Math.min(images.length - 1, i + 1)); }} disabled={disabled || i === images.length - 1} aria-label="Move later">›</button>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
