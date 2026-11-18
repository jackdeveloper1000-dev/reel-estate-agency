import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

export default function Account({ user, onUser, onLogout, filmCount }) {
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [summary, setSummary] = useState(null);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    api.paymentSummary().then(setSummary).catch(() => {});
    api.payments().then(setPayments).catch(() => {});
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const r = await api.updateMe(name);
      onUser(r.user);
      setMsg('Saved ✓');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <section className="account">
      <div className="account-head">
        <div className="avatar" aria-hidden>{initials}</div>
        <div>
          <h2>{user.name}</h2>
          <p className="muted">{user.phone}</p>
        </div>
      </div>

      <div className="stat-row">
        <button className="stat" onClick={() => go('films')}>
          <b>{filmCount}</b><span>Films</span>
        </button>
        <div className="stat">
          <b>{summary ? summary.credits : '–'}</b><span>Unused credits</span>
        </div>
        <div className="stat">
          <b>{summary ? `₹${Number(summary.price).toLocaleString('en-IN')}` : '–'}</b><span>Per film</span>
        </div>
      </div>

      <div className="panel">
        <h3>Profile</h3>
        <form onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="field">
            <span>Mobile number</span>
            <input value={user.phone} disabled />
          </label>
          <div className="row">
            <button className="btn btn-gold sm" disabled={saving || name.trim() === user.name}>Save</button>
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </form>
      </div>

      <div className="panel">
        <h3>Payments</h3>
        {!payments.length ? (
          <p className="muted small">No payments yet.</p>
        ) : (
          <ul className="pay-list">
            {payments.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>₹{Number(p.amount).toLocaleString('en-IN')}</strong>
                  <span className="muted small">
                    {new Date(p.paid_at || p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {p.provider === 'demo' ? ' · demo' : p.payment_id ? ` · ${p.payment_id}` : ''}
                  </span>
                </div>
                <span className={`badge ${p.status === 'paid' ? (p.project_id ? 's-done' : 's-ready') : 's-error'}`}>
                  {p.status !== 'paid' ? 'Failed' : p.project_id ? (p.film ? `Used · ${p.film.slice(0, 18)}` : 'Used') : 'Available'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="btn btn-ghost block" onClick={onLogout}>Log out</button>
    </section>
  );
}
