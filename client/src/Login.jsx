import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getFirstAllowedPath } from './lib/pageAccess.js';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const heroImage = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 1200'>
      <defs>
        <linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#6d7f91'/>
          <stop offset='100%' stop-color='#2f3a46'/>
        </linearGradient>
        <linearGradient id='pit1' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#7a5b3d'/>
          <stop offset='100%' stop-color='#3d2b1f'/>
        </linearGradient>
        <linearGradient id='pit2' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#5f4732'/>
          <stop offset='100%' stop-color='#2a1d14'/>
        </linearGradient>
      </defs>
      <rect width='1600' height='1200' fill='url(#sky)'/>
      <path d='M0 500 L420 360 L900 500 L1600 390 L1600 1200 L0 1200 Z' fill='url(#pit1)'/>
      <path d='M0 640 L420 520 L900 650 L1600 560 L1600 1200 L0 1200 Z' fill='url(#pit2)' opacity='0.92'/>
      <path d='M0 760 L500 670 L1000 780 L1600 710 L1600 1200 L0 1200 Z' fill='#1e1610' opacity='0.88'/>
      <rect x='980' y='520' width='220' height='90' rx='8' fill='#d97b22'/>
      <rect x='1160' y='540' width='140' height='70' rx='6' fill='#a95b18'/>
      <circle cx='1035' cy='628' r='26' fill='#1b1b1b'/>
      <circle cx='1170' cy='628' r='26' fill='#1b1b1b'/>
      <circle cx='1270' cy='628' r='26' fill='#1b1b1b'/>
      <rect x='640' y='600' width='200' height='76' rx='8' fill='#e08a2e'/>
      <circle cx='690' cy='685' r='22' fill='#181818'/>
      <circle cx='810' cy='685' r='22' fill='#181818'/>
      <rect x='720' y='560' width='110' height='20' fill='#5f5f5f'/>
      <rect x='250' y='690' width='470' height='16' fill='#8b6f50' opacity='0.95'/>
      <rect x='300' y='705' width='70' height='8' fill='#6a543d'/>
      <rect x='420' y='705' width='70' height='8' fill='#6a543d'/>
      <rect x='540' y='705' width='70' height='8' fill='#6a543d'/>
      <rect x='660' y='705' width='70' height='8' fill='#6a543d'/>
    </svg>`
  )}`;

  if (user) return <Navigate to={getFirstAllowedPath(user)} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      if (u) navigate(getFirstAllowedPath(u), { replace: true });
      else navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
        <div className="relative hidden lg:flex overflow-hidden">
          <img
            src={heroImage}
            alt="Coal mine operation"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/58 via-[#450a0a]/45 to-black/62" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(248,113,113,0.20),transparent_42%),radial-gradient(circle_at_78%_80%,rgba(185,28,28,0.18),transparent_46%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.05)_0%,transparent_22%,transparent_78%,rgba(255,255,255,0.05)_100%)]" />
          <div className="relative z-10 p-12 xl:p-16 flex flex-col justify-between w-full">
            <div />
            <div className="max-w-xl">
              <h1 className="text-4xl xl:text-5xl font-black tracking-tight text-white leading-tight">
                Operations workspace
              </h1>
              <p className="text-[#fca5a5]/90 mt-5 text-base leading-relaxed max-w-lg">
                Run high-impact mining operations from a single platform designed for fleet oversight,
                contractor coordination, and safety-first decision making.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#fecaca]/20 bg-black/35 px-3 py-3 text-center backdrop-blur-sm">
                  <p className="text-lg font-bold text-white">24/7</p>
                  <p className="text-[11px] text-[#fecaca]/85">Monitoring</p>
                </div>
                <div className="rounded-xl border border-[#fecaca]/20 bg-black/35 px-3 py-3 text-center backdrop-blur-sm">
                  <p className="text-lg font-bold text-white">Live</p>
                  <p className="text-[11px] text-[#fecaca]/85">Fleet Control</p>
                </div>
                <div className="rounded-xl border border-[#fecaca]/20 bg-black/35 px-3 py-3 text-center backdrop-blur-sm">
                  <p className="text-lg font-bold text-white">Safe</p>
                  <p className="text-[11px] text-[#fecaca]/85">Operations</p>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[#fca5a5]/75">Mining intelligence, communication, and compliance in one dashboard.</p>
          </div>
        </div>

        <div className="relative flex items-center justify-center p-6 md:p-10 bg-[#171717] overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1800&q=80"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-22 scale-105"
          />
          <img
            src="https://images.unsplash.com/photo-1581093804475-577d72e5d2a1?auto=format&fit=crop&w=1600&q=80"
            alt=""
            aria-hidden="true"
            className="absolute -right-12 -bottom-12 h-[55%] w-[58%] object-cover opacity-30 mix-blend-screen"
          />
          <img
            src="https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1200&q=80"
            alt=""
            aria-hidden="true"
            className="absolute -left-12 top-10 h-[42%] w-[36%] object-cover opacity-20 mix-blend-lighten"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/62 via-[#171717]/88 to-black/70" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(185,28,28,0.23),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(127,29,29,0.22),transparent_45%)]" />
          <div className="w-full max-w-[420px] relative z-10">
            <div className="lg:hidden text-center mb-6">
              <h1 className="text-2xl font-bold text-white">Operations workspace</h1>
            </div>

            <div className="bg-[#262626]/90 rounded-2xl shadow-2xl shadow-black/45 border border-[#404040]/90 backdrop-blur-md overflow-hidden">
              <div className="p-6">
                <div className="mb-5">
                  <h2 className="text-xl font-semibold text-white">Sign in</h2>
                  <p className="text-[#a3a3a3] text-xs mt-0.5">Enter your credentials to access your operations workspace</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="text-xs text-red-300 bg-red-950/50 border border-red-800 rounded-lg px-3 py-2" role="alert">
                      {error}
                    </div>
                  )}
                  <div>
                    <label htmlFor="email" className="block text-xs font-medium text-[#e5e5e5] mb-1">Email</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-[#525252] bg-[#171717] px-3 py-2.5 text-sm text-white placeholder:text-[#737373] focus:ring-2 focus:ring-[#b91c1c]/60 focus:border-[#b91c1c] outline-none transition"
                      placeholder="you@company.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="password" className="block text-xs font-medium text-[#e5e5e5]">Password</label>
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium text-[#f87171] hover:text-[#fca5a5] focus:outline-none focus:underline"
                      >
                        Forgot?
                      </Link>
                    </div>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#525252] bg-[#171717] px-3 py-2.5 text-sm text-white placeholder:text-[#737373] focus:ring-2 focus:ring-[#b91c1c]/60 focus:border-[#b91c1c] outline-none transition"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-[#b91c1c] hover:bg-[#991b1b] disabled:opacity-50 transition-colors focus:ring-2 focus:ring-[#b91c1c] focus:ring-offset-2 focus:ring-offset-[#262626]"
                  >
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>

                  <div>
                    <Link
                      to="/report-breakdown"
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-medium text-[#e5e5e5] border border-[#525252] hover:bg-[#404040] hover:border-[#737373] transition-colors"
                    >
                      Don&apos;t have access? Report a breakdown
                    </Link>
                  </div>
                </form>

                <p className="mt-4 text-center text-xs text-[#a3a3a3]">
                  No account?{' '}
                  <Link to="/signup" className="font-semibold text-[#f87171] hover:text-[#fca5a5] focus:outline-none focus:underline">
                    Sign up
                  </Link>
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[#525252]/80 bg-black/45 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-[11px] text-[#d4d4d4]">
                For support, please contact the application developer: Vincent Mogashoa on:{' '}
                <a href="tel:+27720934212" className="text-[#fca5a5] hover:text-[#fecaca] underline">
                  0720934212
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
      <AppAttributionFooter className="text-[#737373] border-t border-[#262626] bg-[#0f0f0f]" />
    </div>
  );
}
