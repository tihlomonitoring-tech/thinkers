import { useState, useEffect, useCallback } from 'react';
import { performanceEvaluations } from './api';
import InfoHint from './components/InfoHint.jsx';

const SECTIONS = [
  {
    id: 'intake',
    label: 'Intake queue',
    subtitle: 'Engagements awaiting assignment',
  },
  {
    id: 'fieldwork',
    label: 'Fieldwork',
    subtitle: 'Ratings, recommendations, and working papers',
  },
  {
    id: 'deliverables',
    label: 'Deliverables',
    subtitle: 'Issued opinions and management correspondence',
  },
  {
    id: 'framework',
    label: 'Assurance framework',
    subtitle: 'Scope, independence, and quality standards',
  },
];

function TabIconIntake({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
function TabIconFieldwork({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
function TabIconDeliverables({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}
function TabIconFramework({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

const SECTION_ICONS = [TabIconIntake, TabIconFieldwork, TabIconDeliverables, TabIconFramework];

function fmtWhen(v) {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

/** Full engagement file: submission header, Q&A by category, evaluatee improvement plan. */
function EngagementDossierView({ submission, answers, footer }) {
  if (!submission) return null;
  const sub = submission;
  const planText = (k) => {
    const v = sub[k];
    return v != null && String(v).trim() !== '' ? String(v) : null;
  };
  const addr = planText('plan_addressing_feedback');
  const diff = planText('plan_will_do_differently');
  const byCategory = (answers || []).reduce((acc, a) => {
    const c = a.category || 'Uncategorised';
    if (!acc[c]) acc[c] = [];
    acc[c].push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5 text-sm text-slate-800 dark:text-slate-200">
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 dark:bg-slate-950/50 dark:border-slate-700 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Engagement register</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs sm:text-sm">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Submission ID</dt>
            <dd className="font-mono text-[11px] sm:text-xs break-all text-slate-900 dark:text-slate-100 mt-0.5">{sub.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Relationship</dt>
            <dd className="font-medium capitalize mt-0.5">{sub.relationship_type || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Evaluation period</dt>
            <dd className="mt-0.5">{sub.evaluation_period_title || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Submitted</dt>
            <dd className="mt-0.5">{fmtWhen(sub.submitted_at)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500 dark:text-slate-400">Parties</dt>
            <dd className="mt-0.5">
              <span className="font-medium">{sub.evaluator_name || '—'}</span>
              <span className="text-slate-400 mx-1.5">→</span>
              <span className="font-medium">{sub.evaluatee_name || '—'}</span>
            </dd>
          </div>
          {(sub.evaluation_period_opened_at || sub.evaluation_period_closed_at) && (
            <div className="sm:col-span-2 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-200/80 dark:border-slate-700 pt-2 mt-1">
              Period window: opened {fmtWhen(sub.evaluation_period_opened_at)}
              {sub.evaluation_period_closed_at != null && sub.evaluation_period_closed_at !== ''
                ? ` · closed ${fmtWhen(sub.evaluation_period_closed_at)}`
                : ''}
            </div>
          )}
        </dl>
      </div>

      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Evaluation responses (evidence)</h3>
        <div className="space-y-4">
          {Object.keys(byCategory).length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">No scored responses on file.</p>
          ) : (
            Object.entries(byCategory).map(([cat, rows]) => (
              <div key={cat} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800/80 text-xs font-semibold text-slate-700 dark:text-slate-200">{cat}</div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((a) => (
                    <li key={a.id || `${a.question_id}-${a.sort_order}`} className="px-3 py-3 bg-white dark:bg-slate-900/40">
                      <p className="text-sm text-slate-900 dark:text-slate-100 leading-snug">{a.question_text || 'Question'}</p>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs font-semibold text-amber-900 dark:text-amber-300">Score: {a.score != null ? a.score : '—'}</span>
                        {a.comment != null && String(a.comment).trim() !== '' && (
                          <span className="text-xs text-slate-600 dark:text-slate-400">Evaluator comment on file</span>
                        )}
                      </div>
                      {a.comment != null && String(a.comment).trim() !== '' && (
                        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed border-l-2 border-amber-400/60 pl-3">
                          {a.comment}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      {(addr || diff) && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Evaluatee improvement plan</h3>
          {addr && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase text-slate-500">Addressing feedback</p>
              <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed">{addr}</p>
            </div>
          )}
          {diff && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-slate-500">Will do differently</p>
              <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed">{diff}</p>
            </div>
          )}
        </div>
      )}

      {footer ? <div className="pt-1">{footer}</div> : null}
    </div>
  );
}

export default function Auditor() {
  const [activeSection, setActiveSection] = useState('intake');
  const [queue, setQueue] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickId, setPickId] = useState('');
  const [engagementDetail, setEngagementDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
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

  useEffect(() => {
    if (!pickId) {
      setEngagementDetail(null);
      setDetailLoading(false);
      setDetailError('');
      return;
    }
    const ac = new AbortController();
    setDetailLoading(true);
    setDetailError('');
    setEngagementDetail(null);
    performanceEvaluations
      .submissionDetail(pickId, { signal: ac.signal })
      .then((data) => {
        setEngagementDetail({
          submission: data.submission,
          answers: data.answers || [],
        });
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setEngagementDetail(null);
        setDetailError(e?.message || 'Could not load engagement file');
      })
      .finally(() => {
        if (!ac.signal.aborted) setDetailLoading(false);
      });
    return () => ac.abort();
  }, [pickId]);

  const submitReview = async (e) => {
    e.preventDefault();
    if (!pickId) {
      setError('Select a submission from the queue.');
      setActiveSection('intake');
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
      setActiveSection('deliverables');
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
      <div className="flex flex-1 min-h-0 flex-col w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300 animate-spin" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Loading assurance workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col w-full min-w-0 -m-4 sm:-m-6">
      {/* Enterprise header */}
      <header className="shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white px-4 sm:px-8 py-6 sm:py-8 border-b border-amber-500/40 shadow-lg">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400/90 mb-1">Independent assurance</p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Auditor workspace</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <InfoHint
                title="Auditor responsibilities"
                text="Review evaluation submissions for fairness. Rate overall fairness, document recommendations and your audit report. Management responds under Management → Auditor results; you can add a follow-up comment when they reply."
              />
            </div>
          </div>
        </div>
      </header>

      {/* Four-way navigation */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <nav className="max-w-[1600px] mx-auto px-3 sm:px-6" aria-label="Auditor sections">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-0">
            {SECTIONS.map((s, i) => {
              const Icon = SECTION_ICONS[i];
              const active = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSection(s.id)}
                  className={`flex flex-col items-start text-left gap-2 px-4 py-4 sm:px-5 sm:py-5 border-b-2 transition-colors min-h-[5.5rem] ${
                    active
                      ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/25 text-slate-900 dark:text-slate-100'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2 w-full">
                    <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`} />
                    <span className={`text-sm font-semibold ${active ? 'text-slate-900 dark:text-white' : ''}`}>{s.label}</span>
                  </span>
                  <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-500 line-clamp-2">{s.subtitle}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Main workspace — fills remaining viewport */}
      <div className="flex-1 min-h-0 overflow-auto bg-slate-100/80 dark:bg-slate-950">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 min-h-full flex flex-col">
          {error && (
            <div className="mb-4 text-sm text-red-800 bg-red-50 border border-red-200/80 rounded-lg px-4 py-3 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 shrink-0">
              {error}
            </div>
          )}

          {activeSection === 'intake' && (
            <div className="flex-1 min-h-0 grid lg:grid-cols-12 gap-4 lg:gap-6">
              <section className="lg:col-span-5 flex flex-col min-h-0 rounded-xl border border-slate-200/90 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Open engagements</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">
                    Select an engagement to load the full evaluation file. Review every response before fieldwork.
                  </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  {queue.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">No pending submissions in queue.</p>
                  ) : (
                    <ul className="space-y-2">
                      {queue.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setPickId(String(item.id))}
                            className={`w-full text-left rounded-lg border px-3 py-3 transition-shadow ${
                              pickId === String(item.id)
                                ? 'border-amber-500/70 bg-amber-50/90 shadow-md ring-1 ring-amber-500/20 dark:bg-amber-950/30 dark:border-amber-600/50'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-slate-600'
                            }`}
                          >
                            <span className="font-mono text-[10px] text-slate-400">{String(item.id).slice(0, 8)}…</span>
                            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">{item.relationship_type}</span>
                            <span className="text-xs text-slate-600 dark:text-slate-400 mt-1 block">
                              {item.evaluator_name} → {item.evaluatee_name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
              <section className="lg:col-span-7 flex flex-col min-h-0 rounded-xl border border-slate-200/90 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 shrink-0">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Engagement file</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">
                    Complete record: period, parties, every question score and comment, and evaluatee plan where captured.
                  </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
                  {!pickId && (
                    <div className="h-full min-h-[12rem] flex flex-col items-center justify-center text-center text-sm text-slate-600 dark:text-slate-400 px-4">
                      <p className="max-w-md">
                        Choose an engagement from the queue to load its full submission. When you are ready to sign off, continue to{' '}
                        <span className="text-amber-800 dark:text-amber-300 font-semibold">Fieldwork</span>.
                      </p>
                    </div>
                  )}
                  {pickId && detailLoading && (
                    <div className="flex flex-col items-center justify-center gap-3 py-16">
                      <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300 animate-spin" />
                      <p className="text-sm text-slate-600 dark:text-slate-400">Loading engagement file…</p>
                    </div>
                  )}
                  {pickId && !detailLoading && detailError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/30 dark:border-red-900 dark:text-red-200">
                      {detailError}
                    </div>
                  )}
                  {pickId && !detailLoading && !detailError && engagementDetail && (
                    <EngagementDossierView
                      submission={engagementDetail.submission}
                      answers={engagementDetail.answers}
                      footer={
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => setActiveSection('fieldwork')}
                            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 dark:bg-amber-600 dark:hover:bg-amber-500 dark:text-slate-950"
                          >
                            Continue to fieldwork
                          </button>
                          <button
                            type="button"
                            onClick={() => setPickId('')}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Clear selection
                          </button>
                        </div>
                      }
                    />
                  )}
                </div>
              </section>
            </div>
          )}

          {activeSection === 'fieldwork' && (
            <div className="flex-1 min-h-0 flex flex-col gap-6 max-w-4xl w-full">
              {pickId && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800 overflow-hidden shrink-0">
                  <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Engagement file (reference)</h2>
                    <button
                      type="button"
                      onClick={() => setActiveSection('intake')}
                      className="text-xs font-medium text-amber-800 hover:underline dark:text-amber-400"
                    >
                      Open in Intake
                    </button>
                  </div>
                  <div className="max-h-[min(42vh,22rem)] overflow-y-auto p-4 sm:p-5">
                    {detailLoading && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
                        <div className="h-5 w-5 rounded-full border-2 border-slate-200 border-t-slate-600 animate-spin shrink-0" />
                        Loading file…
                      </div>
                    )}
                    {!detailLoading && detailError && (
                      <p className="text-sm text-red-700 dark:text-red-300">{detailError}</p>
                    )}
                    {!detailLoading && !detailError && engagementDetail && (
                      <EngagementDossierView submission={engagementDetail.submission} answers={engagementDetail.answers} />
                    )}
                    {!detailLoading && !detailError && !engagementDetail && pickId && (
                      <p className="text-sm text-slate-500">No file loaded. Return to Intake or pick an engagement again.</p>
                    )}
                  </div>
                </div>
              )}
              <form
                onSubmit={submitReview}
                className="rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800 p-5 sm:p-6 space-y-5 flex-1 min-h-0 flex flex-col"
              >
                <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Working papers</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">One formal review per submission. Complete all sections before sign-off.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Engagement reference</label>
                  <select
                    value={pickId}
                    onChange={(e) => setPickId(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">— Select from intake queue —</option>
                    {queue.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {String(s.id).slice(0, 8)}… · {s.relationship_type} · {s.evaluator_name} → {s.evaluatee_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fairness rating (1–5)</label>
                  <select
                    value={fairness}
                    onChange={(e) => setFairness(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n} — {n <= 2 ? 'needs attention' : n === 3 ? 'adequate' : n === 4 ? 'strong' : 'exceptional'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recommendations</label>
                  <textarea
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    rows={4}
                    className="mt-1.5 w-full flex-1 min-h-[6rem] rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    placeholder="Document findings, gaps, and required management actions…"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Audit report (formal opinion)</label>
                  <textarea
                    value={auditReport}
                    onChange={(e) => setAuditReport(e.target.value)}
                    rows={5}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    placeholder="Summary of fairness assessment, evidence considered, and overall conclusion…"
                  />
                </div>
                <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="submit"
                    disabled={saving || !pickId}
                    className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500 dark:text-slate-950"
                  >
                    {saving ? 'Publishing…' : 'Submit auditor review'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSection('intake')}
                    className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Back to intake
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeSection === 'deliverables' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Issued workpapers</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Your published reviews and management responses.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('fieldwork')}
                  className="text-sm font-medium text-amber-800 hover:underline dark:text-amber-400"
                >
                  + New review
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                {reviews.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 p-12 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No completed reviews yet. Finalise an engagement under Fieldwork to appear here.
                  </div>
                ) : (
                  reviews.map((r) => (
                    <article
                      key={r.id}
                      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800 overflow-hidden"
                    >
                      <div className="px-4 py-3 bg-slate-50/90 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex flex-wrap justify-between gap-2">
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Ref {String(r.submission_id).slice(0, 8)}… · {r.relationship_type}
                        </p>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Fairness {r.fairness_rating ?? '—'} / 5</span>
                      </div>
                      <div className="p-4 sm:p-5 space-y-3 text-sm text-slate-800 dark:text-slate-200">
                        {r.recommendations && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Recommendations</p>
                            <p className="whitespace-pre-wrap leading-relaxed">{r.recommendations}</p>
                          </div>
                        )}
                        {r.audit_report && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Audit report</p>
                            <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">{r.audit_report}</p>
                          </div>
                        )}
                        {r.management_response && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:bg-slate-950 dark:border-slate-700">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-400 mb-2">Management response</p>
                            <p className="whitespace-pre-wrap leading-relaxed">{r.management_response}</p>
                            {r.management_submitted_at && (
                              <p className="text-xs text-slate-500 mt-2">{new Date(r.management_submitted_at).toLocaleString()}</p>
                            )}
                          </div>
                        )}
                        {r.auditor_followup_comment && (
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Your follow-up:</span> {r.auditor_followup_comment}
                          </p>
                        )}
                        {r.management_response && !r.auditor_followup_comment && (
                          <div className="flex flex-wrap gap-2 items-end pt-2 border-t border-slate-100 dark:border-slate-800">
                            <textarea
                              value={followUps[r.id] || ''}
                              onChange={(e) => setFollowUps((f) => ({ ...f, [r.id]: e.target.value }))}
                              rows={2}
                              placeholder="Comment on management’s response…"
                              className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                            />
                            <button
                              type="button"
                              onClick={() => sendFollowUp(r.id)}
                              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 dark:bg-amber-600 dark:hover:bg-amber-500 dark:text-slate-950"
                            >
                              Send follow-up
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}

          {activeSection === 'framework' && (
            <div className="flex-1 min-h-0 max-w-4xl grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Scope and mandate</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  This portal supports independent review of structured performance evaluations. Engagements are limited to submissions routed through
                  the evaluation workflow; the auditor does not alter underlying HR records.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Independence</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Maintain objectivity when rating fairness and drafting recommendations. Escalate conflicts of interest to management before issuing an opinion.
                  Management replies are visible under Deliverables for transparent closure.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-slate-800 sm:col-span-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Quality standards</h3>
                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc list-inside leading-relaxed">
                  <li>Each submission receives at most one formal auditor review.</li>
                  <li>Fairness ratings and narrative findings should be proportionate, evidence-based, and actionable.</li>
                  <li>Use Fieldwork for contemporaneous documentation; Deliverables serves as the official file of record.</li>
                  <li>Follow-up comments should address management responses specifically and respect confidentiality.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
