import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from './api';
import InfoHint from './components/InfoHint.jsx';

export default function Auditor() {
  const [queue, setQueue] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickId, setPickId] = useState('');
  const [fairness, setFairness] = useState('4');
  const [recommendations, setRecommendations] = useState('');
  const [auditReport, setAuditReport] = useState('');
  const [saving, setSaving] = useState(false);
  const [followUps, setFollowUps] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      performanceEvaluations.auditorQueue().catch(() => ({ queue: [] })),
      performanceEvaluations.listAuditorReviews().catch(() => ({ reviews: [] })),
    ])
      .then(([q, r]) => {
        setQueue(q.queue || []);
        setReviews(r.reviews || []);
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitReview = async (e) => {
    e.preventDefault();
    if (!pickId) {
      setError('Select a submission from the queue.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await performanceEvaluations.createAuditorReview({
        submission_id: pickId,
        fairness_rating: parseInt(fairness, 10),
        recommendations: recommendations.trim() || null,
        audit_report: auditReport.trim() || null,
      });
      setPickId('');
      setRecommendations('');
      setAuditReport('');
      await load();
    } catch (err) {
      setError(err?.message || 'Could not save review');
    } finally {
      setSaving(false);
    }
  };

  const sendFollowUp = async (reviewId) => {
    const text = String(followUps[reviewId] || '').trim();
    if (!text) return;
    setError('');
    try {
      await performanceEvaluations.patchAuditorFollowUp(reviewId, { auditor_followup_comment: text });
      setFollowUps((f) => ({ ...f, [reviewId]: '' }));
      await load();
    } catch (err) {
      setError(err?.message || 'Could not add comment');
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-sm text-surface-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Auditor</h1>
          <InfoHint
            title="Auditor responsibilities"
            text="Review evaluation submissions for fairness. Rate overall fairness, document recommendations and your audit report. Management responds under Management → Auditor results; you can add a follow-up comment when they reply."
          />
        </div>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Use this workspace to confirm evaluations and shift/team objectives are being addressed constructively. One auditor review per submission.
        </p>
      </header>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">Queue (not yet audited)</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-surface-500">No pending submissions.</p>
          ) : (
            <ul className="text-sm space-y-2 max-h-64 overflow-y-auto">
              {queue.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPickId(String(s.id))}
                    className={`w-full text-left rounded-lg border px-3 py-2 ${
                      pickId === String(s.id) ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30' : 'border-surface-200 dark:border-surface-700'
                    }`}
                  >
                    <span className="font-mono text-xs">{String(s.id).slice(0, 8)}…</span>
                    <span className="block text-surface-700 dark:text-surface-300">{s.relationship_type}</span>
                    <span className="text-xs text-surface-500">
                      {s.evaluator_name} → {s.evaluatee_name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={submitReview} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3 dark:border-surface-800 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">New audit review</h2>
          <div>
            <label className="text-xs font-medium text-surface-500">Fairness rating (1–5)</label>
            <select
              value={fairness}
              onChange={(e) => setFairness(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-surface-500">Recommendations</label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-surface-500">Audit report</label>
            <textarea
              value={auditReport}
              onChange={(e) => setAuditReport(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
              placeholder="Summary of fairness, gaps, and next steps…"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !pickId}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Submit auditor review'}
          </button>
        </form>
      </div>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Your reviews &amp; management responses</h2>
        <div className="space-y-4 text-sm">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-surface-100 p-3 dark:border-surface-800">
              <p className="text-xs text-surface-500">
                Submission {String(r.submission_id).slice(0, 8)}… · {r.relationship_type} · Fairness {r.fairness_rating ?? '—'}
              </p>
              {r.recommendations && <p className="mt-1 text-surface-800 dark:text-surface-200 whitespace-pre-wrap">{r.recommendations}</p>}
              {r.audit_report && <p className="mt-2 text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{r.audit_report}</p>}
              {r.management_response && (
                <div className="mt-3 rounded-lg bg-surface-50 p-2 dark:bg-surface-950">
                  <p className="text-[10px] font-semibold uppercase text-surface-500">Management response</p>
                  <p className="whitespace-pre-wrap">{r.management_response}</p>
                  {r.management_submitted_at && (
                    <p className="text-xs text-surface-500 mt-1">{new Date(r.management_submitted_at).toLocaleString()}</p>
                  )}
                </div>
              )}
              {r.auditor_followup_comment && (
                <p className="mt-2 text-xs text-surface-600">
                  <span className="font-semibold">Your follow-up:</span> {r.auditor_followup_comment}
                </p>
              )}
              {r.management_response && !r.auditor_followup_comment && (
                <div className="mt-2 flex flex-wrap gap-2 items-end">
                  <textarea
                    value={followUps[r.id] || ''}
                    onChange={(e) => setFollowUps((f) => ({ ...f, [r.id]: e.target.value }))}
                    rows={2}
                    placeholder="Comment on management’s response…"
                    className="flex-1 min-w-[12rem] rounded-lg border border-surface-200 px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-950"
                  />
                  <button
                    type="button"
                    onClick={() => sendFollowUp(r.id)}
                    className="px-3 py-1.5 rounded-lg border border-surface-200 text-sm font-medium hover:bg-surface-50 dark:border-surface-700"
                  >
                    Send follow-up
                  </button>
                </div>
              )}
            </div>
          ))}
          {reviews.length === 0 && <p className="text-surface-500">No reviews yet.</p>}
        </div>
      </section>
    </div>
  );
}
