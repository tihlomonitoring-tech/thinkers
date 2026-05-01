import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from '../api';

export default function PerformanceEvaluationTrendsSection({ onError }) {
  const [trends, setTrends] = useState(null);
  const [ws, setWs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      performanceEvaluations.trends({ days: 56 }).catch(() => null),
      performanceEvaluations.getManagementWorkspace().catch(() => ({ workspace: null })),
    ])
      .then(([t, w]) => {
        setTrends(t);
        setWs(w.workspace || null);
      })
      .catch((e) => onError?.(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const saveWorkspace = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(e.target);
      await performanceEvaluations.putManagementWorkspace({
        trends_notes: String(form.get('trends_notes') || ''),
        improvement_plan: String(form.get('improvement_plan') || ''),
        progress_report_started: form.get('progress_report_started') === 'on',
      });
      await load();
    } catch (err) {
      onError?.(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 py-4">Loading trends…</p>;

  const byCat = trends?.by_category || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Evaluation trends</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Aggregated scores by category (last {trends?.days ?? 56} days) and recent submissions. Use the workspace below for management improvement plans and to flag when a formal progress report has been started.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {byCat.map((r) => (
          <div key={r.category} className="app-glass-card p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase text-surface-500">{String(r.category || '').replace(/_/g, ' ')}</p>
            <p className="text-2xl font-semibold text-brand-700 tabular-nums mt-1">{r.avg_score != null ? Number(r.avg_score).toFixed(2) : '—'}</p>
            <p className="text-xs text-surface-500 mt-1">Avg (1–3) · {r.submission_count} submissions</p>
          </div>
        ))}
        {byCat.length === 0 && <p className="text-sm text-surface-500 sm:col-span-2">No scored answers in this window yet.</p>}
      </div>

      <div className="app-glass-card overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-surface-100 text-sm font-semibold dark:border-surface-800">Recent submissions</div>
        <div className="overflow-x-auto max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="app-glass-thead-row sticky top-0 z-[1]">
              <tr className="text-left text-xs text-surface-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Evaluator</th>
                <th className="px-3 py-2">Evaluatee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {(trends?.recent_submissions || []).map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{String(s.submitted_at || '').slice(0, 10)}</td>
                  <td className="px-3 py-1.5 text-surface-600 max-w-[140px] truncate" title={s.evaluation_period_title || ''}>
                    {s.evaluation_period_title || '—'}
                  </td>
                  <td className="px-3 py-1.5">{s.relationship_type}</td>
                  <td className="px-3 py-1.5">{s.evaluator_name}</td>
                  <td className="px-3 py-1.5">{s.evaluatee_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={saveWorkspace} className="app-glass-card p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Management workspace</h2>
        <div>
          <label className="text-xs text-surface-500">Trends &amp; observations</label>
          <textarea
            name="trends_notes"
            key={ws?.updated_at || 't'}
            defaultValue={ws?.trends_notes || ''}
            rows={4}
            className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
          />
        </div>
        <div>
          <label className="text-xs text-surface-500">Improvement plan (management)</label>
          <textarea
            name="improvement_plan"
            key={(ws?.updated_at || '') + 'p'}
            defaultValue={ws?.improvement_plan || ''}
            rows={4}
            className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="progress_report_started" defaultChecked={!!ws?.progress_report_started} />
          Progress report started
        </label>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save workspace'}
        </button>
      </form>
    </div>
  );
}
