import { useState, useEffect, useCallback, useMemo } from 'react';
import { performanceEvaluations } from './api';
import { useAuth } from './AuthContext';
import InfoHint from './components/InfoHint.jsx';

const RELATIONSHIP_OPTIONS = [
  { id: 'employee_to_manager', label: 'Employee → Manager' },
  { id: 'manager_to_employee', label: 'Manager → Employee' },
  { id: 'manager_to_director', label: 'Manager → Director' },
  { id: 'director_to_manager', label: 'Director → Manager' },
  { id: 'employee_to_director', label: 'Employee → Director' },
  { id: 'colleague_to_colleague', label: 'Colleague → Colleague' },
];

export default function PerformanceEvaluations() {
  const { user } = useAuth();
  const [tenantUsers, setTenantUsers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [relationshipType, setRelationshipType] = useState('employee_to_manager');
  const [evaluateeId, setEvaluateeId] = useState('');
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [mySubmissions, setMySubmissions] = useState([]);
  const [currentPeriod, setCurrentPeriod] = useState(null);

  const activeQuestions = useMemo(() => questions.filter((q) => q.is_active !== false && q.is_active !== 0), [questions]);

  const normalizeUser = (u) => {
    const id = u?.id ?? u?.Id;
    if (id == null) return null;
    return {
      id: String(id),
      full_name: u?.full_name ?? u?.Full_name ?? '',
      email: u?.email ?? u?.Email ?? '',
    };
  };

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      performanceEvaluations.listEvaluateeOptions(),
      performanceEvaluations.listQuestions(),
      performanceEvaluations.listMySubmissions(),
      performanceEvaluations.getCurrentEvaluationPeriod().catch(() => ({ period: null })),
    ])
      .then(([u, q, s, per]) => {
        const raw = u.users || [];
        setTenantUsers(raw.map(normalizeUser).filter(Boolean));
        setQuestions(q.questions || []);
        setMySubmissions(s.submissions || []);
        setCurrentPeriod(per?.period || null);
        const aq = (q.questions || []).filter((x) => x.is_active !== false && x.is_active !== 0);
        setAnswers((prev) => {
          const next = { ...prev };
          for (const qq of aq) {
            const id = String(qq.id);
            if (!next[id]) next[id] = { score: '2', comment: '' };
          }
          return next;
        });
      })
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const peers = useMemo(() => {
    const uid = String(user?.id || '');
    return (tenantUsers || []).filter((u) => u && String(u.id) !== uid);
  }, [tenantUsers, user?.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!evaluateeId) {
      setError('Select who you are evaluating.');
      return;
    }
    for (const q of activeQuestions) {
      const id = String(q.id);
      const a = answers[id] || {};
      const sc = parseInt(String(a.score), 10);
      if (!Number.isFinite(sc) || sc < 1 || sc > 3) {
        setError('Each question needs a score from 1 to 3.');
        return;
      }
      if (!String(a.comment || '').trim()) {
        setError('Each question needs a comment.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await performanceEvaluations.submit({
        relationship_type: relationshipType,
        evaluatee_user_id: evaluateeId,
        answers: activeQuestions.map((q) => ({
          question_id: q.id,
          score: parseInt(String(answers[String(q.id)].score), 10),
          comment: String(answers[String(q.id)].comment).trim(),
        })),
      });
      setEvaluateeId('');
      await load();
    } catch (err) {
      setError(err?.message || 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-sm text-surface-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Performance evaluations</h1>
          <InfoHint
            title="How this works"
            text="Evaluations run inside an evaluation period opened by management. Choose the evaluation type, then the person you are evaluating. Answer every active question with a score (1 = needs improvement, 3 = strong) and a required comment. You can submit only one evaluation per person and type in each open period. Colleagues you receive feedback from appear under Profile → Colleagues evaluation results."
          />
        </div>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
          Covers work environment, culture, work ethic, competence, leadership, and related behaviours.
        </p>
      </header>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200">
          {error}
        </div>
      )}

      {!currentPeriod && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-100">
          No evaluation period is open. New submissions are disabled until management opens a period (Management → Evaluation period).
        </div>
      )}

      {currentPeriod && (
        <div className="text-sm text-surface-700 bg-surface-50 border border-surface-200 rounded-lg px-4 py-2 dark:bg-surface-900 dark:border-surface-700 dark:text-surface-200">
          <span className="font-semibold text-emerald-800 dark:text-emerald-300">Period open</span>
          {currentPeriod.title ? ` — ${currentPeriod.title}` : ''}
          <span className="text-surface-500"> (since {String(currentPeriod.opened_at || '').slice(0, 10)})</span>
        </div>
      )}

      <form onSubmit={submit} className="rounded-xl border border-surface-200 bg-white shadow-sm p-5 space-y-5 dark:border-surface-800 dark:bg-surface-900">
        <div>
          <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wide mb-1">Evaluation type</label>
          <select
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value)}
            className="w-full max-w-xl rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
          >
            {RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wide mb-1">Who are you evaluating?</label>
          <select
            required
            value={evaluateeId}
            onChange={(e) => setEvaluateeId(e.target.value)}
            className="w-full max-w-xl rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
          >
            <option value="">— Select colleague —</option>
            {peers.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {(p.full_name || '').trim() || p.email || String(p.id).slice(0, 8) + '…'}
              </option>
            ))}
          </select>
          {peers.length === 0 && !error && (
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-2">
              No other active users found for this organisation. Ensure colleagues are active and linked to this tenant (user record or user–tenant membership).
            </p>
          )}
        </div>

        <div className="border-t border-surface-200 pt-4 space-y-4 dark:border-surface-800">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Questionnaire (1–3 + comment)</h2>
          {activeQuestions.length === 0 && <p className="text-sm text-surface-500">No active questions. Ask management to enable questions.</p>}
          {activeQuestions.map((q) => {
            const id = String(q.id);
            const a = answers[id] || { score: '2', comment: '' };
            return (
              <div key={id} className="rounded-lg border border-surface-100 p-4 space-y-2 dark:border-surface-800">
                <p className="text-[10px] font-semibold uppercase text-surface-500">{String(q.category || '').replace(/_/g, ' ')}</p>
                <p className="text-sm text-surface-800 dark:text-surface-100">{q.question_text}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs text-surface-600">Score</label>
                  <select
                    value={a.score}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [id]: { ...a, score: e.target.value } }))}
                    className="rounded-lg border border-surface-200 px-2 py-1 text-sm dark:border-surface-700 dark:bg-surface-950"
                  >
                    <option value="1">1 — Needs improvement</option>
                    <option value="2">2 — Meets expectations</option>
                    <option value="3">3 — Strong</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-surface-600">Comment (required)</label>
                  <textarea
                    value={a.comment}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [id]: { ...a, comment: e.target.value } }))}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
                    placeholder="Specific, constructive feedback…"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={saving || activeQuestions.length === 0 || !currentPeriod}
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit evaluation'}
        </button>
      </form>

      <section>
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-2">Your recent submissions</h2>
        <ul className="text-sm space-y-2">
          {mySubmissions.slice(0, 15).map((s) => (
            <li key={s.id} className="rounded-lg border border-surface-200 px-3 py-2 dark:border-surface-800">
              <span className="font-medium">{String(s.submitted_at || '').slice(0, 10)}</span>
              <span className="text-surface-500 mx-2">·</span>
              <span className="text-surface-700 dark:text-surface-300">{s.relationship_type}</span>
              <span className="text-surface-500 mx-2">→</span>
              {s.evaluatee_name || '—'}
              {(s.evaluation_period_title || s.Evaluation_period_title) && (
                <span className="block text-xs text-surface-500 mt-0.5">
                  Period: {s.evaluation_period_title || s.Evaluation_period_title}
                </span>
              )}
            </li>
          ))}
          {mySubmissions.length === 0 && <li className="text-surface-500">None yet.</li>}
        </ul>
      </section>
    </div>
  );
}
