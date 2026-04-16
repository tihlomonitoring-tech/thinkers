import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from '../api';
import InfoHint from './InfoHint.jsx';

function isOpenRow(p) {
  return p.is_open === true || p.is_open === 1;
}

export default function PerformanceEvaluationPeriodSection({ onError }) {
  const [periods, setPeriods] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      performanceEvaluations.listEvaluationPeriods().catch(() => ({ periods: [] })),
      performanceEvaluations.getCurrentEvaluationPeriod().catch(() => ({ period: null })),
    ])
      .then(([list, cur]) => {
        setPeriods(list.periods || []);
        setCurrent(cur.period || null);
      })
      .catch((e) => onError?.(e?.message || 'Could not load periods'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const openPeriod = async () => {
    setBusy(true);
    onError?.('');
    try {
      await performanceEvaluations.openEvaluationPeriod({ title: title.trim() || undefined });
      setTitle('');
      await load();
    } catch (e) {
      onError?.(e?.message || 'Could not open period');
    } finally {
      setBusy(false);
    }
  };

  const closePeriod = async (id) => {
    if (!window.confirm('Close this evaluation period? Staff will not be able to submit new evaluations until you open another period.')) return;
    setBusy(true);
    onError?.('');
    try {
      await performanceEvaluations.closeEvaluationPeriod(id);
      await load();
    } catch (e) {
      onError?.(e?.message || 'Could not close period');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 py-4">Loading evaluation periods…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Evaluation period</h1>
        <InfoHint
          title="How periods work"
          text="Every performance evaluation is stored under one period. Open a period when you want colleagues to submit feedback; close it when the window ends. Opening a new period automatically closes the previous open period. Only one open period exists per organisation at a time."
        />
      </div>
      <p className="text-sm text-surface-600 dark:text-surface-400 max-w-3xl">
        Staff can submit evaluations only while a period is open. Past submissions stay linked to the period they were filed under.
      </p>

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">Current status</h2>
        {current ? (
          <p className="text-sm text-surface-800 dark:text-surface-200">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Open</span>
            {current.title ? ` — ${current.title}` : ''}
            <span className="text-surface-500"> · started {String(current.opened_at || '').slice(0, 10)}</span>
          </p>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-200">No period is open. Colleagues cannot submit evaluations until you open one.</p>
        )}
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3 dark:border-surface-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Open a new period</h2>
        <p className="text-xs text-surface-500">Any currently open period is closed first, then the new period opens.</p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[12rem]">
            <label className="text-xs text-surface-500">Label (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q2 2026 feedback cycle"
              className="block mt-1 w-full rounded-lg border border-surface-200 px-2 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={openPeriod}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Open period'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="px-4 py-2 border-b border-surface-100 text-sm font-semibold dark:border-surface-800">Recent periods</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500 dark:bg-surface-950">
              <tr>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2">Closed</th>
                <th className="px-3 py-2">Submissions</th>
                <th className="px-3 py-2 w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {periods.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">{p.title || '—'}</td>
                  <td className="px-3 py-2">{isOpenRow(p) ? <span className="text-emerald-700 dark:text-emerald-400 font-medium">Open</span> : 'Closed'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{String(p.opened_at || '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.closed_at ? String(p.closed_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{p.submission_count ?? '—'}</td>
                  <td className="px-3 py-2">
                    {isOpenRow(p) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => closePeriod(p.id)}
                        className="text-xs font-semibold text-red-700 hover:underline dark:text-red-400 disabled:opacity-50"
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {periods.length === 0 && <p className="text-sm text-surface-500 px-4 py-6">No periods yet. Open the first one above.</p>}
        </div>
      </div>
    </div>
  );
}
