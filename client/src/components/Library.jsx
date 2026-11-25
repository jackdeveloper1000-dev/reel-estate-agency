import { useEffect, useState } from 'react';
import { api, BUSY } from '../api.js';
import { go } from '../router.js';
import { labelFor, safeHost } from '../utils/studioOptions.js';

export default function Library({ projects, onChange, compact }) {
  // keep statuses fresh while anything is processing
  const anyBusy = projects.some((p) => BUSY.includes(p.status));
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');

  const del = async (e, id) => {
    e.stopPropagation();
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 4000);
      return;
    }
    setError('');
    setDeletingId(id);
    try { await api.remove(id); } catch (err) { setError(err.message); }
    setDeletingId(null);
    setConfirmId(null);
    onChange && onChange();
  };
  useEffect(() => {
    if (!anyBusy) return;
    const t = setInterval(onChange, 3000);
    return () => clearInterval(t);
  }, [anyBusy, onChange]);

  return (
    <section className={`library ${compact ? 'compact' : ''}`}>
      <div className="lib-head">
        <h2>{compact ? 'Recent films' : 'My films'}</h2>
        {compact && projects.length > 0 && <button className="link" onClick={() => go('films')}>View all →</button>}
      </div>
      {error && <p className="error top-error">{error}</p>}
      {!projects.length ? (
        <div className="empty-lib">
          <p>No films yet.</p>
          <button className="btn btn-gold" onClick={() => go('')}>Create your first film</button>
        </div>
      ) : (
        <ul className="cards">
          {projects.map((p) => {
            const thumb = p.video?.posterUrl || p.images?.[0]?.url;
            const title = p.details?.address || p.details?.title || (p.sourceUrl ? safeHost(p.sourceUrl) : 'Uploaded photos');
            return (
              <li key={p.id} className="card" onClick={() => go(`project/${p.id}`)}>
                <div className="thumb">
                  {thumb ? <img src={thumb} alt="" loading="lazy" /> : <div className="thumb-empty" />}
                  {p.video && <span className="play" aria-hidden>▶</span>}
                  <button
                    className={`card-del ${confirmId === p.id ? 'confirm' : ''}`}
                    onClick={(e) => del(e, p.id)}
                    disabled={deletingId === p.id}
                    title="Delete"
                  >
                    {deletingId === p.id ? '…' : confirmId === p.id ? 'Delete?' : '✕'}
                  </button>
                  {BUSY.includes(p.status) && (
                    <div className="thumb-progress"><div style={{ width: `${Math.max(3, p.progress || 0)}%` }} /></div>
                  )}
                </div>
                <div className="card-body">
                  <strong title={title}>{title}</strong>
                  <div className="card-meta">
                    <span className={`badge s-${p.status}`}>{labelFor(p.status)}</span>
                    <span className="muted small">
                      {p.settings?.format === 'auto' ? 'Auto size' : p.settings?.format} · {p.video ? `${Math.round(p.video.duration || 0)}s film` : `${p.images?.filter((i) => i.selected).length || 0} shots`}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
