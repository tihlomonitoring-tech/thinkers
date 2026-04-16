import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from '../api';
import InfoHint from './InfoHint.jsx';

export default function ColleagueEvaluationResultsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selId, setSelId] = useState(null);
  const [addr, setAddr] = useState('');
  const [diff, setDiff] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    performanceEvaluations
      .aboutMe()
      .then((d) => setRows(d.evaluations || []))
      .catch((e) => setError(e?.message || 'Could not load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id) => {
    setSelId(id);
    setDetailLoading(true);
    setError('');
    try {
      const d = await performanceEvaluations.submissionDetail(id);
      setDetail(d);
      const s = d.submission || {};
      setAddr(String(s.plan_addressing_feedback || s.Plan_addressing_feedback || ''));
      setDiff(String(s.plan_will_do_differently || s.Plan_will_do_differently || ''));
    } catch (e) {
      setError(e?.message || 'Could not load detail');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const savePlan = async (e) => {
    e.preventDefault();
    if (!selId) return;
    if (!addr.trim() || !diff.trim()) {
      setError('Complete both improvement fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await performanceEvaluations.saveEvaluateeImprovement({
        submission_id: selId,
        addressing_feedback: addr.trim(),
        will_do_differently: diff.trim(),
      });
      await load();
      await openDetail(selId);
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 py-6">Loading your evaluation results…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Colleagues evaluation results</h1>
        <InfoHint
          title="Your feedback"
          text="Evaluations where you were the person being assessed. Read scores and comments, then record how you will address feedback and what you will do differently. This plan is visible to management for follow-up."
        />
      </div>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 dark:bg-red-950/40 dark:text-red-200">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">Evaluations about you</h2>
          <ul className="text-sm space-y-2 max-h-80 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openDetail(r.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 ${
                    selId === r.id ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30' : 'border-surface-200 dark:border-surface-700'
                  }`}
                >
                  <span className="font-medium">{String(r.submitted_at || '').slice(0, 10)}</span>
                  <span className="text-surface-500 mx-1">·</span>
                  <span className="text-surface-700 dark:text-surface-300">{r.relationship_type}</span>
                  <span className="block text-xs text-surface-500">From {r.evaluator_name || '—'}</span>
                  {(r.evaluation_period_title || r.Evaluation_period_title) && (
                    <span className="block text-xs text-surface-400">Period: {r.evaluation_period_title || r.Evaluation_period_title}</span>
                  )}
                  {r.plan_addressing_feedback && <span className="text-xs text-emerald-700 dark:text-emerald-400">Improvement plan on file</span>}
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="text-surface-500">No evaluations yet.</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          {detailLoading && <p className="text-sm text-surface-500">Loading detail…</p>}
          {!detailLoading && detail && (
            <div className="space-y-4 text-sm">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Scores &amp; comments</h2>
              {(detail.submission?.evaluation_period_title || detail.submission?.Evaluation_period_title) && (
                <p className="text-xs text-surface-500">
                  Period: {detail.submission.evaluation_period_title || detail.submission.Evaluation_period_title}
                </p>
              )}
              <ul className="space-y-2">
                {(detail.answers || []).map((a) => (
                  <li key={a.id} className="rounded-lg border border-surface-100 p-2 dark:border-surface-800">
                    <span className="text-xs font-semibold text-surface-500 uppercase">{a.category}</span>
                    <p className="text-surface-800 dark:text-surface-100">{a.question_text}</p>
                    <p className="text-brand-700 font-semibold mt-1">Score: {a.score} / 3</p>
                    {a.comment && <p className="text-surface-600 dark:text-surface-400 mt-1 whitespace-pre-wrap">{a.comment}</p>}
                  </li>
                ))}
              </ul>

              <form onSubmit={savePlan} className="border-t border-surface-200 pt-4 space-y-3 dark:border-surface-800">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Your improvement plan</h3>
                <div>
                  <label className="text-xs text-surface-500">How you will address the feedback</label>
                  <textarea
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                  />
                </div>
                <div>
                  <label className="text-xs text-surface-500">What you will do differently (if needed)</label>
                  <textarea
                    value={diff}
                    onChange={(e) => setDiff(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save improvement plan'}
                </button>
              </form>
            </div>
          )}
          {!detailLoading && !detail && selId == null && (
            <p className="text-sm text-surface-500">Select an evaluation on the left to view questions and add your plan.</p>
          )}
        </div>
      </div>
    </div>
  );
}
