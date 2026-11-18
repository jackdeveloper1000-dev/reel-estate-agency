import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { go } from '../router.js';

/** Sign up (name + mobile) or log in (mobile) with a 6-digit SMS code. */
export default function Auth({ mode = 'login', onDone }) {
  const [tab, setTab] = useState(mode);
  const [step, setStep] = useState('details'); // details → code
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);

  useEffect(() => { setTab(mode); setStep('details'); setError(''); }, [mode]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const switchTab = (t) => {
    setTab(t); setStep('details'); setError(''); setCode(''); setDevCode('');
    go(t === 'signup' ? 'signup' : 'login');
  };

  const send = async (e) => {
    e?.preventDefault();
    setError('');
    if (tab === 'signup' && name.trim().length < 2) return setError('Please enter your name.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter your 10-digit mobile number.');
    setBusy(true);
    try {
      const r = await api.sendOtp(phone, tab, name);
      setSentTo(r.phone);
      setDevCode(r.devCode || '');
      setWait(r.resendAfter || 30);
      setCode('');
      setStep('code');
    } catch (err) {
      setError(err.message);
      if (err.code === 'ALREADY_REGISTERED') setTab('login');
      if (err.code === 'NOT_REGISTERED') setTab('signup');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    if (code.length !== 6) return setError('Enter the 6-digit code.');
    setError('');
    setBusy(true);
    try {
      const r = await api.verifyOtp(sentTo || phone, code);
      onDone(r.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // auto-submit when 6 digits are entered
  useEffect(() => { if (step === 'code' && code.length === 6 && !busy) verify(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="auth">
      <div className="auth-card">
        <div className="auth-brand-row">
          <div className="auth-brand" aria-hidden>
            <svg viewBox="0 0 64 64"><path d="M14 46V22l18-10 18 10v24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M28 30l10 6-10 6z" fill="currentColor"/></svg>
          </div>
          <div className="auth-brand-text">
            <strong>ESTAMOTION</strong>
            <small>PROPERTY IN MOTION</small>
          </div>
        </div>

        {step === 'details' ? (
          <>
            <h2>{tab === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="muted">{tab === 'signup' ? 'Sign up with your mobile number to create films.' : 'Log in with your mobile number.'}</p>

            <div className="seg" role="tablist">
              <button type="button" className={tab === 'signup' ? 'on' : ''} onClick={() => switchTab('signup')}>Sign up</button>
              <button type="button" className={tab === 'login' ? 'on' : ''} onClick={() => switchTab('login')}>Log in</button>
            </div>

            <form onSubmit={send} className="auth-form">
              {tab === 'signup' && (
                <label className="field">
                  <span>Full name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" disabled={busy} />
                </label>
              )}
              <label className="field">
                <span>Mobile number</span>
                <div className="phone-input">
                  <span className="cc">+91</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, '').slice(0, 16))}
                    placeholder="98765 43210"
                    inputMode="tel"
                    autoComplete="tel-national"
                    disabled={busy}
                  />
                </div>
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-gold lg block" disabled={busy}>
                {busy ? <span className="spinner" /> : 'Send OTP'}
              </button>
              <p className="muted small center">We’ll text you a 6-digit code. Standard SMS rates may apply.</p>
            </form>
          </>
        ) : (
          <>
            <h2>Enter the code</h2>
            <p className="muted">Sent to <b>{sentTo}</b> · <button type="button" className="link" onClick={() => setStep('details')}>Change</button></p>
            <form onSubmit={verify} className="auth-form">
              <input
                ref={codeRef}
                className="otp-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                aria-label="6-digit code"
                disabled={busy}
              />
              {devCode && (
                <p className="dev-note">Test mode (no SMS provider set): your code is <b>{devCode}</b></p>
              )}
              {error && <p className="error">{error}</p>}
              <button className="btn btn-gold lg block" disabled={busy || code.length !== 6}>
                {busy ? <span className="spinner" /> : tab === 'signup' ? 'Verify & create account' : 'Verify & log in'}
              </button>
              <p className="muted small center">
                {wait > 0 ? `Resend code in ${wait}s` : <button type="button" className="link" onClick={send} disabled={busy}>Resend code</button>}
              </p>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
