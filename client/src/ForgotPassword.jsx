import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from './api';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await auth.forgotPassword({
        email: email.trim().toLowerCase(),
        id_number: idNumber.trim(),
      });
      setSuccess('If an account exists with this email, you will receive reset instructions shortly. Check your inbox and spam folder.');
      setEmail('');
      setIdNumber('');
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-950">
      <div className="flex flex-1 flex-col md:flex-row min-h-0">
      <div
        className="hidden md:flex md:w-1/2 p-10 flex-col justify-center"
        style={{ background: 'linear-gradient(135deg, #020617 0%, #164e63 50%, #083344 100%)' }}
      >
        <div className="max-w-sm">
          <h1 className="text-2xl font-bold text-white tracking-tight">Thinkers Afrika</h1>
          <p className="text-cyan-200 text-base mt-1.5 font-medium">Management System</p>
          <p className="text-cyan-100/80 mt-3 text-sm leading-relaxed">
            Enter your username and SA ID to receive a password reset link and code by email.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-10 bg-surface-900">
        <div className="w-full max-w-[340px]">
          <div className="md:hidden text-center mb-6">
            <h1 className="text-xl font-bold text-white">Thinkers Afrika</h1>
            <p className="text-brand-400 text-sm font-medium mt-0.5">Management System</p>
          </div>

          <div className="bg-surface-800/95 rounded-xl shadow-2xl shadow-black/25 border border-surface-600/80 p-6 backdrop-blur-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-white">Forgot password</h2>
              <p className="text-[#a3a3a3] text-xs mt-0.5">Enter your username and SA ID to receive a reset link and code</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-xs text-red-300 bg-red-950/50 border border-red-800 rounded-lg px-3 py-2" role="alert">
                  {error}
                </div>
              )}
              {success && (
                <div className="text-xs text-green-300 bg-green-950/50 border border-green-800 rounded-lg px-3 py-2" role="status">
                  {success}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-xs font-medium text-[#e5e5e5] mb-1">Username (email)</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2.5 text-sm text-white placeholder:text-surface-500 focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition"
                  placeholder="you@company.com"
                  required
                  autoComplete="username"
                />
              </div>
              <div>
                <label htmlFor="id_number" className="block text-xs font-medium text-[#e5e5e5] mb-1">SA ID number</label>
                <input
                  id="id_number"
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2.5 text-sm text-white placeholder:text-surface-500 focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 outline-none transition"
                  placeholder="South African ID number"
                  required
                  autoComplete="off"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-surface-800"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="mt-4 text-center">
              <Link to="/login" className="text-xs font-medium text-brand-400 hover:text-brand-300 focus:outline-none focus:underline">
                ← Back to sign in
              </Link>
            </p>
          </div>

          <p className="mt-4 text-center text-[10px] text-[#525252]">Thinkers Afrika Smart Administration System</p>
          <p className="mt-1 text-center text-[10px] text-[#525252]">For support, please contact the application developer: Vincent Mogashoa on: <a href="mailto:vincent@thinkersafrika.co.za" className="text-[#737373] hover:text-[#a3a3a3] underline">vincent@thinkersafrika.co.za</a></p>
        </div>
      </div>
      </div>
      <AppAttributionFooter className="text-surface-500 border-t border-surface-800 bg-surface-950" />
    </div>
  );
}
