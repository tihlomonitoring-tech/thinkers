import { useState, useEffect } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getFirstAllowedPath } from './lib/pageAccess.js';
import { getCurrentPosition } from './lib/geolocation.js';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

const BG_IMAGE =
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=85';

const REMEMBER_KEY = 'thinkers-login-remember';
const EMAIL_KEY = 'thinkers-login-email';

function DecorativeIcon({ children, label }) {
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset] backdrop-blur-sm transition hover:bg-white/20 hover:border-white/40"
      title={label}
      aria-hidden
    >
      {children}
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [geoStatus, setGeoStatus] = useState('pending');
  const [locationError, setLocationError] = useState('');
  const [signInLocation, setSignInLocation] = useState(null);
  const { user, login } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to={getFirstAllowedPath(user)} replace />;

  useEffect(() => {
    try {
      const r = localStorage.getItem(REMEMBER_KEY) === '1';
      const saved = localStorage.getItem(EMAIL_KEY);
      if (r && saved) {
        setRememberMe(true);
        setEmail(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGeoStatus('pending');
    setLocationError('');
    getCurrentPosition()
      .then((loc) => {
        if (cancelled) return;
        setSignInLocation(loc);
        setGeoStatus('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        setGeoStatus('error');
        setSignInLocation(null);
        setLocationError(
          err?.code === 1
            ? 'Location permission denied. Allow location for this site in your browser settings, then refresh the page.'
            : 'Could not read location. Check connection and permissions, then refresh.'
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (geoStatus !== 'ok' || !signInLocation) {
      setError('Location is required to sign in. Allow location permission in your browser and try again.');
      return;
    }
    setLoading(true);
    try {
      try {
        if (rememberMe && email.trim()) {
          localStorage.setItem(REMEMBER_KEY, '1');
          localStorage.setItem(EMAIL_KEY, email.trim());
        } else {
          localStorage.removeItem(REMEMBER_KEY);
          localStorage.removeItem(EMAIL_KEY);
        }
      } catch {
        /* ignore */
      }
      const u = await login(email.trim(), password, signInLocation);
      if (u) navigate(getFirstAllowedPath(u), { replace: true });
      else navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col text-white relative overflow-x-hidden"
      style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      {/* Full-bleed cinematic background */}
      <div className="fixed inset-0 z-0" aria-hidden>
        <img src={BG_IMAGE} alt="" className="h-full w-full object-cover scale-105" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/55 to-slate-950/75" />
        <div className="absolute inset-0 bg-gradient-to-t from-orange-950/50 via-transparent to-amber-500/15" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_0%_20%,rgba(251,146,60,0.35),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_100%,rgba(15,23,42,0.9),transparent_50%)]" />
        <div
          className="absolute inset-0 opacity-[0.07] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 flex-1 flex flex-col min-h-screen">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] min-h-0">
          {/* Left — branding */}
          <section className="relative hidden lg:flex flex-col justify-between px-12 xl:px-20 py-14 xl:py-20 min-h-[50vh] lg:min-h-screen">
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-orange-200/90 mb-4">Thinkers</p>
              <h1
                className="text-[clamp(3rem,5.5vw,4.75rem)] leading-[0.98] font-normal uppercase tracking-tight text-white drop-shadow-[0_4px_32px_rgba(0,0,0,0.45)]"
                style={{ fontFamily: "'Anton', sans-serif" }}
              >
                Operations
                <br />
                <span className="text-orange-400">workspace</span>
              </h1>
              <p className="mt-5 text-lg font-medium text-white/95 tracking-wide">Welcome back</p>
              <p className="mt-6 max-w-md text-base leading-relaxed text-white/80 font-light">
                Fleet, contractors, command centre, and compliance — one place for high-stakes operations. Sign in to continue.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <DecorativeIcon label="Fleet">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.25 2.25 0 00-1.92-1.092A48.64 48.64 0 0112 12c-2.928 0-5.647.108-8.048.292a2.25 2.25 0 00-1.846 1.092 17.915 17.915 0 00-3.213 9.193c-.04.62.508 1.124 1.129 1.124H9.75m-6-4.5h6" />
                  </svg>
                </DecorativeIcon>
                <DecorativeIcon label="Safety">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </DecorativeIcon>
                <DecorativeIcon label="Reports">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v7.125c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 20.25v-7.125zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </DecorativeIcon>
                <DecorativeIcon label="Network">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                </DecorativeIcon>
              </div>
            </div>
            <p className="text-xs text-white/50 max-w-sm leading-relaxed">
              Mining intelligence, communication, and compliance — engineered for teams who cannot afford downtime.
            </p>
          </section>

          {/* Right — form (reference: Sign in, white fields, orange CTA) */}
          <section className="flex flex-col justify-center px-5 sm:px-10 py-12 lg:py-16 lg:pr-12 xl:pr-20">
            <div className="w-full max-w-[420px] mx-auto lg:ml-auto lg:mr-0">
              <div className="lg:hidden mb-8 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-200/90 mb-2">Thinkers</p>
                <h1
                  className="text-[2.65rem] leading-[0.95] font-normal uppercase text-white"
                  style={{ fontFamily: "'Anton', sans-serif" }}
                >
                  Operations
                  <br />
                  <span className="text-orange-400">workspace</span>
                </h1>
                <p className="mt-3 text-base font-medium text-white/90">Welcome back</p>
              </div>

              <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-6 sm:p-8 shadow-[0_25px_80px_-12px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                <h2
                  className="text-3xl sm:text-4xl font-normal uppercase tracking-tight text-white mb-1"
                  style={{ fontFamily: "'Anton', sans-serif" }}
                >
                  Sign in
                </h2>
                <p className="text-sm text-white/65 mb-6 font-light">
                  Enter your credentials to access your <span className="text-white/90 font-medium">Operations workspace</span>.
                </p>

                {locationError && (
                  <div className="mb-4 text-xs text-amber-100 bg-amber-500/15 border border-amber-400/30 rounded-xl px-3 py-2.5" role="alert">
                    {locationError}
                  </div>
                )}
                {geoStatus === 'pending' && !locationError && (
                  <div className="mb-4 text-xs text-white/70 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin shrink-0" aria-hidden />
                    Confirming your location for secure sign-in…
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  {error && (
                    <div className="text-xs text-red-100 bg-red-600/25 border border-red-400/40 rounded-xl px-3 py-2.5" role="alert">
                      {error}
                    </div>
                  )}
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-white/90 mb-1.5">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border-0 bg-white px-4 py-3.5 text-slate-900 text-sm placeholder:text-slate-400 shadow-lg shadow-black/20 focus:ring-2 focus:ring-orange-400 focus:outline-none transition"
                      placeholder="you@company.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-1.5">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border-0 bg-white px-4 py-3.5 text-slate-900 text-sm placeholder:text-slate-400 shadow-lg shadow-black/20 focus:ring-2 focus:ring-orange-400 focus:outline-none transition"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-white/85">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-white/40 bg-white/10 text-orange-500 focus:ring-orange-400 focus:ring-offset-0"
                      />
                      Remember me
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-sm font-medium text-white underline decoration-white/40 underline-offset-4 hover:text-orange-200 hover:decoration-orange-200/80"
                    >
                      Lost your password?
                    </Link>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || geoStatus !== 'ok'}
                    className="w-full py-4 rounded-xl text-base font-bold uppercase tracking-wide text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 disabled:opacity-45 disabled:cursor-not-allowed shadow-[0_12px_40px_-8px_rgba(234,88,12,0.55)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  >
                    {loading ? 'Signing in…' : geoStatus === 'pending' ? 'Waiting for location…' : 'Sign in now'}
                  </button>

                  <Link
                    to="/report-breakdown"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-xs font-semibold uppercase tracking-wider text-white/90 border border-white/25 bg-white/5 hover:bg-white/10 transition"
                  >
                    No access? Report a breakdown
                  </Link>
                </form>

                <p className="mt-6 text-center text-sm text-white/70">
                  No account?{' '}
                  <Link to="/signup" className="font-semibold text-orange-300 hover:text-orange-200 underline decoration-orange-400/50 underline-offset-2">
                    Request access
                  </Link>
                </p>

                <p className="mt-5 text-[11px] leading-relaxed text-center text-white/45">
                  By clicking &quot;Sign in now&quot; you confirm use under your organisation’s policies. Location is recorded once per sign-in for security.
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center backdrop-blur-md">
                <p className="text-[11px] text-white/70 leading-relaxed">
                  Support — Vincent Mogashoa:{' '}
                  <a href="tel:+27720934212" className="text-orange-200 font-medium hover:text-white underline underline-offset-2">
                    072 093 4212
                  </a>
                </p>
              </div>
            </div>
          </section>
        </div>

        <AppAttributionFooter className="relative z-10 text-white/40 border-t border-white/10 bg-black/35 backdrop-blur-md" />
      </div>
    </div>
  );
}
