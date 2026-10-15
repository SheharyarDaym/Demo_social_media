import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, X } from 'lucide-react';
import { dismissToast, useStore } from '../store/store';
import { postRows } from '../domain/simplePosts';
import { useMedia } from '../components/media';
import { useMediaUrl } from '../services/media';

const BUNDLED_LOGO = '/assets/brand/lifeguard-pro-logo.png';

function Brand() {
  const brand = useStore((s) => s.data.brand);
  const uploaded = useMedia(brand.logoMediaId);
  const { url } = useMediaUrl(uploaded, 'square');
  // "Lifeguard-Pro.org" → bold "Lifeguard-Pro" + regular ".org", as in the company header.
  const dot = brand.name.lastIndexOf('.');
  const main = dot > 0 ? brand.name.slice(0, dot) : brand.name;
  const tld = dot > 0 ? brand.name.slice(dot) : '';
  return (
    <NavLink to="/" className="top-brand" aria-label={`${brand.name} Social Studio — Create Post`}>
      <img src={url ?? BUNDLED_LOGO} alt="" className="top-logo" />
      <span className="top-text">
        <span className="wordmark">
          {main}
          <span className="wordmark-tld">{tld}</span>
        </span>
        <span className="top-sub">Social Studio</span>
      </span>
    </NavLink>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const navigate = useNavigate();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span style={{ flex: 1 }}>
            {t.message}{' '}
            {t.action ? (
              <a
                href={t.action.href}
                onClick={(e) => {
                  e.preventDefault();
                  dismissToast(t.id);
                  navigate(t.action!.href);
                }}
              >
                {t.action.label}
              </a>
            ) : null}
          </span>
          <button className="icon-btn x" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Layout() {
  const loc = useLocation();
  const storageError = useStore((s) => s.storageError);
  const needsApproval = useStore((s) => postRows(s.data).filter((r) => r.state.status === 'needs_approval').length);
  useEffect(() => {
    document.title = 'Lifeguard-Pro.org — Social Studio';
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className="simple-app">
      <header className="top">
        <div className="top-inner">
          <Brand />
          <nav className="top-nav" aria-label="Main">
            <NavLink to="/" end>
              Create Post
            </NavLink>
            <NavLink to="/posts">
              My Posts
              {needsApproval ? (
                <span className="count" aria-label={`${needsApproval} need approval`}>
                  {needsApproval}
                </span>
              ) : null}
            </NavLink>
          </nav>
        </div>
        <div className="preview-bar">Preview only — no real posts are published</div>
      </header>
      {storageError ? (
        <div className="banner-storage" role="alert">
          <CircleAlert size={16} /> {storageError}
        </div>
      ) : null}
      <main id="main" className="simple-main">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}
