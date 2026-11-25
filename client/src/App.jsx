import { useEffect, useState, useCallback } from 'react';
import Hero from './components/Hero.jsx';
import Studio from './components/Studio.jsx';
import Library from './components/Library.jsx';
import Auth from './components/Auth.jsx';
import Account from './components/Account.jsx';
import AdSlot from './components/AdSlot.jsx';
import { api } from './api.js';
import { go } from './router.js';
import { clearPendingDraft, takePendingDraft } from './utils/studioOptions.js';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read());
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const Icon = {
  create: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  films: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" /></svg>,
  user: <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.4-3.6 4.3-5.4 7.5-5.4s6.1 1.8 7.5 5.4" /></svg>,
};

export default function App() {
  const route = useHashRoute();
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [projects, setProjects] = useState([]);
  const [health, setHealth] = useState(null);
  const [resumingDraft, setResumingDraft] = useState(false);

  const refresh = useCallback(() => {
    if (!user) return Promise.resolve();
    return api.list().then(setProjects).catch(() => {});
  }, [user]);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    const out = () => setUser(null);
    window.addEventListener('ra:logged-out', out);
    return () => window.removeEventListener('ra:logged-out', out);
  }, []);

  useEffect(() => {
    if (user) refresh(); else setProjects([]);
  }, [refresh, user]);

  // already logged in → leave the login page (unless resuming a pending draft)
  useEffect(() => {
    if (user && !resumingDraft && (route === 'login' || route === 'signup')) go('films');
  }, [user, route, resumingDraft]);

  const projectId = route.startsWith('project/') ? route.split('/')[1] : null;
  const section = projectId ? 'films' : route === 'films' ? 'films' : ['account', 'login', 'signup'].includes(route) ? 'account' : 'create';
  const needsLogin = !user && (projectId || route === 'films' || route === 'account');

  const loggedIn = async (u) => {
    setUser(u);
    const draft = takePendingDraft();
    if (!draft) {
      go('films');
      return;
    }
    setResumingDraft(true);
    try {
      const p = draft.type === 'files'
        ? await api.createFromPhotos(draft.files, { format: draft.format || 'auto' })
        : await api.createFromUrl(draft.url, { format: draft.format || 'auto' }, false);
      const list = await api.list().catch(() => []);
      if (Array.isArray(list)) setProjects(list);
      go(`project/${p.id}`);
    } catch {
      go('');
    } finally {
      setResumingDraft(false);
    }
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearPendingDraft();
    setUser(null);
    go('');
  };

  let page;
  if (user === undefined || resumingDraft) {
    page = (
      <section className="studio loading">
        <span className="spinner big" />
        {resumingDraft && <p className="muted">Starting your film project…</p>}
      </section>
    );
  } else if (route === 'login' || route === 'signup' || needsLogin) {
    page = user ? null : <Auth mode={route === 'login' ? 'login' : 'signup'} onDone={loggedIn} />;
  } else if (projectId) page = <Studio key={projectId} id={projectId} onChange={refresh} />;
  else if (route === 'films') page = <Library projects={projects} onChange={refresh} />;
  else if (route === 'account') page = <Account user={user} onUser={setUser} onLogout={logout} filmCount={projects.length} />;
  else {
    page = (
      <>
        <Hero user={user} onCreated={(p) => { refresh(); go(`project/${p.id}`); }} />
        {user && projects.length > 0 && <Library projects={projects.slice(0, 6)} onChange={refresh} compact />}
        {/* Ads only on the home page – never on login, film-editing or payment screens */}
        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_HOME} />
      </>
    );
  }

  const navItems = [
    { key: 'create', label: 'Create', to: '', icon: Icon.create },
    { key: 'films', label: 'My Films', to: 'films', icon: Icon.films, count: projects.length },
    { key: 'account', label: user ? 'Account' : 'Log in', to: user ? 'account' : 'login', icon: Icon.user },
  ];
  const nav = (e, to) => { e.preventDefault(); go(to); };

  return (
    <div className={`app ${projectId ? 'in-studio' : ''}`}>
      <header className="topbar">
        <a className="brand" href="#/" onClick={(e) => nav(e, '')}>
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 64 64"><path d="M14 46V22l18-10 18 10v24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M28 30l10 6-10 6z" fill="currentColor"/></svg>
          </span>
          <span className="brand-text">
            <strong>ESTAMOTION</strong>
            <small>PROPERTY IN MOTION</small>
          </span>
        </a>
        <nav className="top-nav">
          {navItems.map((n) => (
            <a key={n.key} href={`#/${n.to}`} onClick={(e) => nav(e, n.to)} className={section === n.key ? 'active' : ''}>
              {n.label} {n.count > 0 && <span className="count">{n.count}</span>}
            </a>
          ))}
        </nav>
        {user ? (
          <button className="top-avatar" onClick={() => go('account')} aria-label="Account">
            {user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </button>
        ) : (
          <button className="btn btn-gold sm top-login" onClick={() => go('login')}>Log in</button>
        )}
      </header>

      {health && (!health.ok || health.db !== 'connected') && (
        <div className="banner">Server or database is offline – start <b>MySQL</b> in the XAMPP Control Panel and the API (<code>npm run dev</code>).</div>
      )}

      <main>{page}</main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} ESTAMOTION · PROPERTY IN MOTION</span>
        <span className="muted">Cinematic films from real listing photos – nothing added that isn’t there.</span>
        <span className="footer-links">
          <a href="/guides/">Guides</a>
          <a href="/about.html">About &amp; contact</a>
          <a href="/privacy.html">Privacy policy</a>
          <a href="/terms.html">Terms &amp; conditions</a>
        </span>
      </footer>

      {/* App-style bottom bar (phones) */}
      <nav className="bottom-nav" aria-label="Main">
        {navItems.map((n) => (
          <a key={n.key} href={`#/${n.to}`} onClick={(e) => nav(e, n.to)} className={`${section === n.key ? 'active' : ''} ${n.key === 'create' ? 'fab' : ''}`}>
            <span className="ico">{n.icon}{n.count > 0 && <i className="dot">{n.count}</i>}</span>
            <span className="lbl">{n.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
