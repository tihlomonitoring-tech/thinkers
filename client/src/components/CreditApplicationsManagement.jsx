import { useState } from 'react';
import { profileManagement as pm } from '../api';
import InfoHint from './InfoHint.jsx';

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export default function CreditApplicationsManagement({ applications = [], onRefresh, onError }) {
  const [filter, setFilter] = useState('pending');
  const [reviewId, setReviewId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = filter === 'all' ? applications : applications.filter((a) => a.status === filter);

  const submitReview = async (status) => {
    if (!reviewId) return;
    setSaving(true);
    onError('');
    try {
      await pm.creditApplications.review(reviewId, { status, review_notes: reviewNotes.trim() || undefined });
      setReviewId(null);
      setReviewNotes('');
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Review failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Credit applications</h1>
        <InfoHint
          title="Grace credit applications"
          text="Employees request grace credits from Profile → Disciplinary & rewards. Approve to issue the requested points as a grace credit on their record; reject with optional notes. Approved applications appear on the employee profile with the outcome."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              filter === f.id ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button type="button" onClick={onRefresh} className="ml-auto text-sm text-brand-600 font-medium">
          Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-surface-500 app-glass-card p-6">No applications in this view.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div key={a.id} className="app-glass-card p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium text-surface-900">{a.user_name || a.user_email}</p>
                  <p className="text-sm text-surface-600">
                    {a.requested_points} points · {a.category_name || 'General request'}
                  </p>
                  <p className="text-sm text-surface-700 mt-1">{a.justification}</p>
                  <p className="text-xs text-surface-400 mt-1">Submitted {formatDate(a.created_at)}</p>
                </div>
                <span
                  className={`inline-flex h-fit px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                    a.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : a.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {a.status}
                </span>
              </div>
              {a.status !== 'pending' && (
                <p className="text-xs text-surface-500 mt-2">
                  Reviewed {formatDate(a.reviewed_at)} {a.reviewed_by_name ? `by ${a.reviewed_by_name}` : ''}
                  {a.review_notes && ` — ${a.review_notes}`}
                </p>
              )}
              {a.status === 'pending' && (
                <div className="mt-3 pt-3 border-t border-surface-100">
                  {reviewId === a.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="Review notes (optional)"
                        rows={2}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => submitReview('approved')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => submitReview('rejected')}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button type="button" onClick={() => setReviewId(null)} className="text-sm text-surface-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewId(a.id);
                        setReviewNotes('');
                      }}
                      className="text-sm font-medium text-brand-600"
                    >
                      Review application
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
