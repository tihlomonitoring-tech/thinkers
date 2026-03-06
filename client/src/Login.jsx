import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/users" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/users');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0f0f0f]">
      {/* Left: branding */}
      <div
        className="hidden md:flex md:w-1/2 p-10 flex-col justify-center"
        style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #450a0a 50%, #1c0a0a 100%)' }}
      >
        <div className="max-w-sm">
          <h1 className="text-2xl font-bold text-white tracking-tight">Thinkers Afrika</h1>
          <p className="text-[#fecaca] text-base mt-1.5 font-medium">Smart Administration System</p>
          <p className="text-[#fca5a5]/80 mt-3 text-sm leading-relaxed">
            Sign in to manage your operations in one place.
          </p>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-10 bg-[#171717]">
        <div className="w-full max-w-[340px]">
          {/* Mobile branding */}
          <div className="md:hidden text-center mb-6">
            <h1 className="text-xl font-bold text-white">Thinkers Afrika</h1>
            <p className="text-[#b91c1c] text-sm font-medium mt-0.5">Smart Administration System</p>
          </div>

          <div className="bg-[#262626]/90 rounded-xl shadow-2xl shadow-black/20 border border-[#404040]/80 p-6 backdrop-blur-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-white">Sign in</h2>
              <p className="text-[#a3a3a3] text-xs mt-0.5">Enter your credentials</p>
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

          <p className="mt-4 text-center text-[10px] text-[#525252]">
            Thinkers Afrika Smart Administration System
          </p>
          <p className="mt-1 text-center text-[10px] text-[#525252]">For support, please contact the application developer: Vincent Mogashoa on: <a href="mailto:vincent@thinkersafrika.co.za" className="text-[#737373] hover:text-[#a3a3a3] underline">vincent@thinkersafrika.co.za</a></p>
        </div>
      </div>
    </div>
  );
}
