import { useState } from 'react';
import { profileManagement as pm } from '../api';
import InfoHint from './InfoHint.jsx';
import GraceCreditsChart from './GraceCreditsChart.jsx';

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export default function DisciplinaryRewardsProfile({
  warnings = [],
  rewards = [],
  graceCredits = [],
  sanctions = [],
  applications = [],
  summary = null,
  creditCategories = [],
  onRefresh,
  onError,
}) {
  const [justification, setJustification] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [requestedPoints, setRequestedPoints] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const submitApplication = async (e) => {
    e.preventDefault();
    const just = justification.trim();
    if (!just) {
      onError('Please explain why you are requesting a grace credit');
      return;
    }
    if (!categoryId) {
      onError('Select a credit category');
      return;
    }
    setSubmitting(true);
    onError('');
    try {
      await pm.creditApplications.create({
        category_id: categoryId || undefined,
        requested_points: Number(requestedPoints) || 1,
        justification: just,
      });
      setJustification('');
      setCategoryId('');
      setRequestedPoints(1);
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  const net = summary?.netBalance ?? 0;
  const creditPts = summary?.graceCreditPoints ?? 0;
  const sanctionPts = summary?.debtorSanctionPoints ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Disciplinary & rewards</h1>
        <InfoHint
          title="Grace credits, sanctions & your rights"
          bullets={[
            'Grace credits are positive points recorded when management recognises recovery or approves your credit application.',
            'Debtor sanctions are demerit points recorded by management with a written justification, often linked to productivity score.',
            'You may request a grace credit below; your team leader reviews applications under Team leader admin → Members credit requests.',
            'Your net balance = grace credit points minus debtor sanction points (informational, not payroll).',
            'Formal warnings and rewards remain separate records; contact HR if anything is incorrect.',
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="app-glass-card p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Grace credits</p>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">{creditPts}</p>
          <p className="text-xs text-surface-500">total points</p>
        </div>
        <div className="app-glass-card p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Debtor sanctions</p>
          <p className="text-2xl font-bold text-red-700 tabular-nums mt-1">{sanctionPts}</p>
          <p className="text-xs text-surface-500">total points</p>
        </div>
        <div className="app-glass-card p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Net balance</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${net >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>{net}</p>
          <p className="text-xs text-surface-500">credits − sanctions</p>
        </div>
      </div>

      <div className="app-glass-card p-4">
        <p className="text-sm font-medium text-surface-800 mb-3">Credits vs sanctions (by month)</p>
        <GraceCreditsChart
          creditsByMonth={summary?.creditsByMonth || []}
          sanctionsByMonth={summary?.sanctionsByMonth || []}
        />
      </div>

      <div className="app-glass-card p-4">
        <p className="text-sm font-medium text-surface-800 mb-2">Request a grace credit</p>
        <form onSubmit={submitApplication} className="space-y-3 max-w-xl">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Category (required)</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            >
              <option value="">— Select category —</option>
              {creditCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.default_points} pts default)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Requested points</label>
            <input
              type="number"
              min={1}
              value={requestedPoints}
              onChange={(e) => setRequestedPoints(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm max-w-[120px]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Justification (required)</label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              required
              rows={4}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              placeholder="Explain why you believe a grace credit should be granted…"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit credit application'}
          </button>
        </form>
      </div>

      <div className="app-glass-card p-4">
        <p className="text-sm font-medium text-surface-800 mb-2">My credit applications</p>
        {applications.length === 0 ? (
          <p className="text-sm text-surface-500">No applications yet.</p>
        ) : (
          <ul className="space-y-3">
            {applications.map((a) => (
              <li key={a.id} className="text-sm border-l-2 border-indigo-200 pl-3">
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${
                    a.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : a.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {a.status}
                </span>
                <span className="ml-2 font-medium">{a.requested_points} pts</span>
                {a.category_name && <span className="text-surface-500 text-xs ml-1">· {a.category_name}</span>}
                <p className="text-surface-600 mt-1">{a.justification}</p>
                <p className="text-xs text-surface-400 mt-0.5">Submitted {formatDate(a.created_at)}</p>
                {a.status !== 'pending' && (
                  <p className="text-xs text-surface-500 mt-1">
                    Outcome {formatDate(a.reviewed_at)}
                    {a.review_notes && ` — ${a.review_notes}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Grace credits</p>
          {graceCredits.length === 0 ? (
            <p className="text-sm text-surface-500">None on record.</p>
          ) : (
            <ul className="space-y-2">
              {graceCredits.map((g) => (
                <li key={g.id} className="text-sm border-l-2 border-emerald-300 pl-2">
                  <span className="font-medium text-emerald-800">+{g.points} pts</span>
                  {g.category_name && <span className="text-surface-600 ml-1">· {g.category_name}</span>}
                  <span className="text-surface-500 text-xs ml-1">{formatDate(g.created_at)}</span>
                  <p className="text-surface-600 mt-0.5">{g.justification}</p>
                  {g.issued_by_name && <p className="text-xs text-surface-400">Recorded by {g.issued_by_name}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Debtor sanctions</p>
          {sanctions.length === 0 ? (
            <p className="text-sm text-surface-500">None on record.</p>
          ) : (
            <ul className="space-y-2">
              {sanctions.map((s) => (
                <li key={s.id} className="text-sm border-l-2 border-red-300 pl-2">
                  <span className="font-medium text-red-800">−{s.points} pts</span>
                  {s.category_name && <span className="text-surface-600 ml-1">· {s.category_name}</span>}
                  <span className="text-surface-500 text-xs ml-1">{formatDate(s.created_at)}</span>
                  <p className="text-surface-600 mt-0.5">{s.justification}</p>
                  {s.issued_by_name && <p className="text-xs text-surface-400">Recorded by {s.issued_by_name}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Warnings & cases</p>
          {warnings.length === 0 ? (
            <p className="text-sm text-surface-500">None on record.</p>
          ) : (
            <ul className="space-y-2">
              {warnings.map((w) => (
                <li key={w.id} className="text-sm border-l-2 border-amber-200 pl-2">
                  <span className="font-medium">{w.warning_type}</span>
                  <span className="text-surface-500 text-xs ml-1">{formatDate(w.created_at)}</span>
                  {w.description && <p className="text-surface-600 mt-0.5">{w.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Rewards</p>
          {rewards.length === 0 ? (
            <p className="text-sm text-surface-500">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {rewards.map((r) => (
                <li key={r.id} className="text-sm border-l-2 border-emerald-200 pl-2">
                  <span className="font-medium">{r.reward_type}</span>
                  <span className="text-surface-500 text-xs ml-1">{formatDate(r.created_at)}</span>
                  {r.description && <p className="text-surface-600 mt-0.5">{r.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
