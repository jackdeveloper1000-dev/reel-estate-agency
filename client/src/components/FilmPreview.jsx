import { useEffect, useState } from 'react';
import { formatAspectRatio, gradeFilter, resolveFraming } from '../utils/studioOptions.js';

/**
 * Interactive cinema stage preview used in both Hero (demo) and Studio (live project).
 * Renders true aspect ratio framing, colour grade, letterbox bars, title overlay & end card.
 */
export default function FilmPreview({
  images = [],
  details = {},
  settings = {},
  mode = 'opening',
  onModeChange,
  interactive = true,
  compact = false,
}) {
  const [shotIdx, setShotIdx] = useState(0);
  const [playing, setPlaying] = useState(true);

  const selected = images.filter((i) => i.selected !== false);
  const safeIdx = selected.length ? Math.min(shotIdx, selected.length - 1) : 0;
  const endCardImg =
    (settings.endCardImageId && images.find((i) => String(i.id) === String(settings.endCardImageId))) ||
    selected[selected.length - 1] ||
    images[images.length - 1];
  const activeImg = mode === 'endcard' ? endCardImg : selected[safeIdx] || selected[0];

  const { key: formatKey, ratio, css: aspectCss } = formatAspectRatio(settings.format, selected);
  const portraitFrame = ratio < 0.95;
  const framing = resolveFraming(activeImg, ratio, settings.imageFit || 'auto');
  const filter = gradeFilter(settings.grade || 'golden');
  const showLetterbox = settings.letterbox !== false && ratio > 1.05;
  const motion = settings.motion || 'standard';

  const hasGreeting = Boolean(
    details.cta?.trim() || details.agentName?.trim() || details.agentPhone?.trim() || details.agency?.trim()
  );

  // Auto-advance shots when in "shots" mode and playing
  useEffect(() => {
    if (mode !== 'shots' || !playing || selected.length <= 1) return;
    const ms = Math.max(1800, Math.round((settings.secondsPerShot || 4) * 700));
    const t = setInterval(() => {
      setShotIdx((i) => (i + 1) % selected.length);
    }, ms);
    return () => clearInterval(t);
  }, [mode, playing, selected.length, settings.secondsPerShot]);

  const modes = [
    ['opening', 'Opening title'],
    ['shots', `Shots (${selected.length})`],
    ['endcard', 'End card'],
  ];

  const renderMedia = (img, isEnd = false) => {
    if (!img) return null;
    if (img.svg) return img.svg;
    return <img src={img.url} alt="" draggable={false} />;
  };

  return (
    <div className={`preview-shell ${compact ? 'compact' : ''}`}>
      <div className="stage-viewport">
        <div
          className={`stage-frame ${portraitFrame ? 'portrait' : 'landscape'} motion-${motion}`}
          style={{ aspectRatio: aspectCss }}
        >
          {/* Blurred backdrop for blur_pad or endcard */}
          {(framing === 'blur_pad' || mode === 'endcard') && activeImg && (
            <div className="stage-bg" style={{ filter: `${filter} blur(22px) brightness(0.55)` }}>
              {renderMedia(activeImg, mode === 'endcard')}
            </div>
          )}

          {/* Main photo / scene layer */}
          {mode !== 'endcard' && activeImg && (
            <div
              key={`${activeImg.id || safeIdx}-${mode}`}
              className={`stage-media fit-${framing} ${playing ? 'animate' : ''}`}
              style={{ filter }}
            >
              {renderMedia(activeImg)}
            </div>
          )}

          {/* Subtle vignette matching FFmpeg vignette */}
          <div className="stage-vignette" aria-hidden />

          {/* Cinema letterbox bars (landscape only) */}
          {showLetterbox && (
            <>
              <div className="letterbox top" aria-hidden />
              <div className="letterbox bottom" aria-hidden />
            </>
          )}

          {/* Opening Title Overlay */}
          {mode === 'opening' && (
            <div className="stage-titles">
              <span className="st-kicker">{(details.kicker || 'Now Showing').toUpperCase()}</span>
              {details.address && <strong className="st-address">{details.address}</strong>}
              {details.price && <span className="st-price">{details.price}</span>}
            </div>
          )}

          {/* Branded End Card Overlay */}
          {mode === 'endcard' && (
            <div className="stage-endcard">
              {hasGreeting ? (
                <>
                  <span className="ec-rule" aria-hidden />
                  {details.cta?.trim() && <span className="ec-cta">{details.cta.trim().toUpperCase()}</span>}
                  {details.agentName?.trim() && <strong className="ec-agent">{details.agentName.trim()}</strong>}
                  {details.agency?.trim() && <span className="ec-agency">{details.agency.trim()}</span>}
                  {details.agentPhone?.trim() && <span className="ec-phone">{details.agentPhone.trim()}</span>}
                  {details.address?.trim() && <span className="ec-addr">{details.address.trim()}</span>}
                </>
              ) : (
                <div className="ec-empty">
                  <span className="ec-rule" aria-hidden />
                  <strong>End card skipped</strong>
                  <p>Add agent name, phone, agency or greeting in Details to include a branded end card.</p>
                </div>
              )}
            </div>
          )}

          {/* Live badge inside viewport */}
          <div className="stage-hud">
            <span className="hud-pill">{formatKey}</span>
            {mode === 'shots' && selected.length > 0 && (
              <span className="hud-pill">
                Shot {safeIdx + 1}/{selected.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {interactive && (
        <div className="stage-toolbar">
          <div className="stage-modes" role="tablist" aria-label="Preview view">
            {modes.map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mode === k}
                className={mode === k ? 'on' : ''}
                onClick={() => onModeChange && onModeChange(k)}
              >
                {lbl}
              </button>
            ))}
          </div>

          {mode === 'shots' && selected.length > 1 && (
            <div className="stage-transport">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShotIdx((i) => (i - 1 + selected.length) % selected.length)}
                aria-label="Previous shot"
              >
                ‹
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause preview' : 'Play preview'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShotIdx((i) => (i + 1) % selected.length)}
                aria-label="Next shot"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
