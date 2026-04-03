import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from './api';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

export default function SignUp() {
  const [full_name, setFullName] = useState('');
  const [id_number, setIdNumber] = useState('');
  const [email, setEmail] = useState('');
  const [cellphone, setCellphone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await auth.signUp({ full_name: full_name.trim(), id_number: id_number.trim() || undefined, email: email.trim(), cellphone: cellphone.trim() || undefined });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-50 dark:bg-surface-950">
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md bg-white dark:bg-surface-900 rounded-2xl shadow-xl shadow-surface-200/50 dark:shadow-none border border-surface-100 dark:border-surface-800 p-8 text-center">
            <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Request submitted</h1>
            <p className="mt-3 text-surface-600 dark:text-surface-400 text-sm">
              Thank you. Your request has been submitted for approval. You will receive an email with your login details once an administrator has approved your account.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block text-brand-600 font-medium hover:text-brand-700 focus:outline-none focus:underline"
            >
              ← Back to sign in
            </Link>
          </div>
        </div>
        <AppAttributionFooter className="text-surface-500 dark:text-surface-400 border-t border-surface-200 dark:border-surface-800" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-50 dark:bg-surface-950">
      <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white dark:bg-surface-900 rounded-2xl shadow-xl shadow-surface-200/50 dark:shadow-none border border-surface-100 dark:border-surface-800 p-8">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Sign up</h1>
        <p className="mt-1 text-surface-500 dark:text-surface-400 text-sm">Complete the form below. Your account will be created after approval.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-surface-700 mb-1">Full name</label>
            <input
              id="full_name"
              type="text"
              required
              value={full_name}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="e.g. Jane Doe"
            />
          </div>
          <div>
            <label htmlFor="id_number" className="block text-sm font-medium text-surface-700 mb-1">ID number</label>
            <input
              id="id_number"
              type="text"
              value={id_number}
              onChange={(e) => setIdNumber(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="Optional"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-surface-700 mb-1">Email address</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="cellphone" className="block text-sm font-medium text-surface-700 mb-1">Cellphone number</label>
            <input
              id="cellphone"
              type="tel"
              value={cellphone}
              onChange={(e) => setCellphone(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              placeholder="Optional"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || !full_name.trim() || !email.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
            <Link
              to="/login"
              className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
            >
              Cancel
            </Link>
          </div>
        </form>
        <p className="mt-4 text-center text-surface-500 dark:text-surface-400 text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-600 font-medium hover:text-brand-700">Sign in</Link>
        </p>
      </div>
      </div>
      <AppAttributionFooter className="text-surface-500 dark:text-surface-400 border-t border-surface-200 dark:border-surface-800" />
    </div>
  );
}
