import { useEffect, useState, useCallback } from 'react';
import Hero from './components/Hero.jsx';
import Studio from './components/Studio.jsx';
import Library from './components/Library.jsx';
import { api } from './api.js';
import { go } from './router.js';

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


export default function App() {
  const route = useHashRoute();
  const [projects, setProjects] = useState([]);
  const [health, setHealth] = useState(null);

  const refresh = useCallback(() => api.list().then(setProjects).catch(() => {}), []);

  useEffect(() => {
    refresh();
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
  }, [refresh, route]);

  const projectId = route.startsWith('project/') ? route.split('/')[1] : null;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go(''); }}>
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 64 64"><path d="M14 46V22l18-10 18 10v24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M28 30l10 6-10 6z" fill="currentColor"/></svg>
          </span>
          <span>RealAssets<em>AI</em></span>
        </a>
        <nav>
          <a href="#/" onClick={(e) => { e.preventDefault(); go(''); }} className={!route ? 'active' : ''}>Create</a>
          <a href="#/films" onClick={(e) => { e.preventDefault(); go('films'); }} className={route === 'films' ? 'active' : ''}>
            My Films {projects.length > 0 && <span className="count">{projects.length}</span>}
          </a>
        </nav>
      </header>

      {health && (!health.ok || health.db !== 'connected') && (
        <div className="banner">Server or database is offline – start <b>MySQL</b> in the XAMPP Control Panel and the API (<code>npm run dev</code>).</div>
      )}

      <main>
        {projectId ? (
          <Studio key={projectId} id={projectId} onChange={refresh} />
        ) : route === 'films' ? (
          <Library projects={projects} onChange={refresh} />
        ) : (
          <>
            <Hero onCreated={(p) => { refresh(); go(`project/${p.id}`); }} />
            {projects.length > 0 && <Library projects={projects.slice(0, 6)} onChange={refresh} compact />}
          </>
        )}
      </main>

      <footer className="footer">
        <span>© {new Date().getFullYear()} RealAssets AI</span>
        <span className="muted">Cinematic films from real listing photos – nothing added that isn’t there.</span>
      </footer>
    </div>
  );
}
