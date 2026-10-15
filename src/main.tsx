import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './app/App';
import { initStore, useStore } from './store/store';
import { startScheduler } from './services/scheduler';

function Boot() {
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    initStore().catch(() => setError('The preview workspace could not start. Try reloading the page.'));
  }, []);
  useEffect(() => {
    if (!ready) return;
    return startScheduler();
  }, [ready]);
  if (error) {
    return (
      <div className="empty" role="alert" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h2>Something went wrong</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="empty" role="status" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <span className="spinner" aria-hidden="true" />
        <p>Loading the Social Studio preview workspace…</p>
      </div>
    );
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
