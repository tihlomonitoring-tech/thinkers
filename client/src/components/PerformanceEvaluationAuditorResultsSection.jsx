import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from '../api';

export default function PerformanceEvaluationAuditorResultsSection({ onError }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    performanceEvaluations
      .listManagementAuditorReviews()
      .then((d) => setReviews(d.reviews || []))
      .catch((e) => onError?.(e?.message || 'Could not load'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const submitResponse = async (id) => {
    const txt = String(responses[id] || '').trim();
    if (!txt) {
      onError?.('Enter a response for the auditor.');
      return;
    }
    setSavingId(id);
    try {
      await performanceEvaluations.patchManagementAuditorResponse(id, { management_response: txt });
      setResponses((r) => ({ ...r, [id]: '' }));
      await load();
    } catch (e) {
      onError?.(e?.message || 'Submit failed');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 py-4">Loading auditor results…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Auditor results</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Respond to auditor recommendations and audit reports. Your response is sent back to the auditor for follow-up comment.
        </p>
      </div>

      <div className="space-y-4">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900 text-sm">
            <p className="text-xs text-surface-500">
              Auditor {r.auditor_name} · {String(r.created_at || '').slice(0, 16)} · Fairness {r.fairness_rating ?? '—'}
            </p>
            <p className="text-xs font-mono text-surface-400 mt-1">Submission {String(r.submission_id)}</p>
            <p className="mt-2 text-surface-800 dark:text-surface-100 whitespace-pre-wrap">
              <span className="font-semibold text-surface-600">Recommendations: </span>
              {r.recommendations || '—'}
            </p>
            <p className="mt-2 text-surface-700 dark:text-surface-200 whitespace-pre-wrap">
              <span className="font-semibold text-surface-600">Audit report: </span>
              {r.audit_report || '—'}
            </p>
            {r.management_response && (
              <div className="mt-3 rounded-lg bg-surface-50 p-2 dark:bg-surface-950">
                <p className="text-[10px] font-semibold uppercase text-surface-500">Your response (submitted)</p>
                <p className="whitespace-pre-wrap">{r.management_response}</p>
              </div>
            )}
            {r.auditor_followup_comment && (
              <p className="mt-2 text-xs text-surface-600">
                <span className="font-semibold">Auditor follow-up:</span> {r.auditor_followup_comment}
              </p>
            )}
            {!r.management_response && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={responses[r.id] ?? ''}
                  onChange={(e) => setResponses((x) => ({ ...x, [r.id]: e.target.value }))}
                  rows={3}
                  placeholder="How management will address these recommendations…"
                  className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                />
                <button
                  type="button"
                  disabled={savingId === r.id}
                  onClick={() => submitResponse(r.id)}
                  className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {savingId === r.id ? 'Submitting…' : 'Submit response to auditor'}
                </button>
              </div>
            )}
          </div>
        ))}
        {reviews.length === 0 && <p className="text-surface-500">No auditor reviews yet.</p>}
      </div>
    </div>
  );
}
