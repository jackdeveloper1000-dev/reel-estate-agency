import { useEffect, useRef } from 'react';

const RAW = (import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const CLIENT = RAW.startsWith('pub-') ? `ca-${RAW}` : RAW; // "pub-…" and "ca-pub-…" both work
const VALID_CLIENT = /^ca-pub-\d{10,20}$/.test(CLIENT);

/**
 * One Google AdSense display ad unit.
 * Renders nothing until VITE_ADSENSE_CLIENT and the slot id are set in client/.env,
 * so it is safe to leave in the page before your AdSense account is approved.
 */
export default function AdSlot({ slot, format = 'auto', className = '' }) {
  const ref = useRef(null);
  const slotId = String(slot || '').trim();
  const enabled = VALID_CLIENT && /^\d+$/.test(slotId);

  useEffect(() => {
    const ins = ref.current;
    // each <ins> may only be filled once (React StrictMode runs effects twice in development)
    if (!enabled || !ins || ins.dataset.filled) return;
    ins.dataset.filled = '1';
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* ad blockers or a missing script – the page carries on without the ad */ }
  }, [enabled]);

  if (!enabled) return null;
  return (
    <aside className={`ad-slot ${className}`} aria-label="Advertisement">
      <small>Advertisement</small>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
