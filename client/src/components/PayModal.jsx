import { useEffect, useState } from 'react';
import { api } from '../api.js';

let scriptPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load Razorpay. Check your internet connection.')); };
      document.body.appendChild(s);
    });
  }
  return scriptPromise;
}

/** Bottom sheet that takes payment for one film, then calls onPaid(). */
export default function PayModal({ open, onClose, onPaid }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    api.paymentSummary().then(setSummary).catch((e) => setError(e.message));
  }, [open]);

  if (!open) return null;

  const done = async (body) => {
    await api.verifyPayment(body);
    setBusy(false);
    onPaid();
  };

  const pay = async () => {
    setError('');
    setBusy(true);
    try {
      const order = await api.createOrder();
      if (order.mode === 'demo') {
        await done({ razorpay_order_id: order.orderId });
        return;
      }
      await loadRazorpay();
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        prefill: order.prefill,
        theme: { color: '#d4af37' },
        handler: (resp) => done(resp).catch((e) => { setError(e.message); setBusy(false); }),
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (resp) => {
        setError(resp?.error?.description || 'Payment failed. Please try again.');
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const price = summary ? `₹${Number(summary.price).toLocaleString('en-IN')}` : '…';

  return (
    <div className="sheet-backdrop" onClick={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Payment" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <h3>Make your film</h3>
        <p className="muted">Your photos are ready. One payment makes one film – after it’s rendered, the photos are removed and the MP4 stays in My Films to download.</p>
        <ul className="pay-lines">
          <li><span>Cinematic property film (Full HD)</span><b>{price}</b></li>
          <li className="muted small"><span>MP4 download included</span><span>✓</span></li>
        </ul>
        {summary?.mode === 'demo' && (
          <p className="dev-note">Demo mode – Razorpay keys aren’t set on the server, so no real money is taken.</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-gold lg block" onClick={pay} disabled={busy || !summary || summary.mode === 'disabled'}>
          {busy ? <span className="spinner" /> : `Pay ${price}`}
        </button>
        <button className="btn btn-ghost block" onClick={onClose} disabled={busy}>Not now</button>
        <p className="muted small center secure">🔒 Secure payment by Razorpay · UPI, cards, net banking & wallets</p>
      </div>
    </div>
  );
}
