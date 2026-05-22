import { useState, useEffect, useCallback, useMemo } from 'react';
import { teamGoals } from '../api';
import InfoHint from './InfoHint.jsx';
import {
  parseIndividualChecks,
  questionnaireReportKey,
  questionnaireToPayload,
  generateDailyPulsePdf,
  generateDailyPulsePackPdf,
  downloadDailyPulsePdf,
  safePdfFilename,
} from '../lib/dailyPulsePdf.js';
import TeamProductivityDashboardTab from './TeamProductivityDashboardTab.jsx';

const AUDIT_TABS = [
  { id: 'dashboard', label: 'Team dashboard' },
  { id: 'audit', label: 'Leader audit' },
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function qField(en, name) {
  if (!en || typeof en !== 'object') return undefined;
  const k = Object.keys(en).find((x) => x && String(x).toLowerCase() === String(name).toLowerCase());
  return k !== undefined ? en[k] : undefined;
}

function moraleLabel(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'good') return 'Good';
  if (s === 'strained') return 'Strained';
  if (s === 'mixed') return 'Mixed';
  return v || '—';
}

function onTrackLabel(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'yes') return 'Yes';
  if (s === 'no') return 'No';
  return v || '—';
}

const QUESTIONNAIRE_RANGES = [
  { value: '60', label: 'Last 60 days', param: 60 },
  { value: '365', label: 'Last 12 months', param: 365 },
  { value: '730', label: 'Last 2 years', param: 730 },
  { value: 'all', label: 'All submissions', param: 'all' },
];

function sortQuestionnairesNewestFirst(list) {
  return [...(list || [])].sort((a, b) => {
    const da = new Date(qField(a, 'work_date') || 0).getTime();
    const db = new Date(qField(b, 'work_date') || 0).getTime();
    return db - da;
  });
}

function QuestionnaireCard({ q }) {
  const checks = parseIndividualChecks(q);
  const qid = questionnaireReportKey(q);
  return (
    <div key={qid} className="rounded-lg border border-surface-200 bg-white p-4 text-sm space-y-3 shadow-sm">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-surface-600 border-b border-surface-100 pb-2">
        <span>
          <span className="text-surface-500">Work date: </span>
          <span className="font-medium text-surface-800">{formatDate(qField(q, 'work_date'))}</span>
        </span>
        <span>
          <span className="text-surface-500">Submitted: </span>
          <span className="font-medium text-surface-800">{formatDateTime(qField(q, 'created_at'))}</span>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Team morale</span>
          <p className="text-surface-900 mt-0.5">{moraleLabel(qField(q, 'team_morale'))}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Delivery on track</span>
          <p className="text-surface-900 mt-0.5">{onTrackLabel(qField(q, 'delivery_on_track'))}</p>
        </div>
      </div>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Top blocker</span>
        <p className="text-surface-800 mt-0.5 whitespace-pre-wrap break-words">{qField(q, 'top_blocker') || '—'}</p>
      </div>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">What went well</span>
        <p className="text-surface-800 mt-0.5 whitespace-pre-wrap break-words">{qField(q, 'team_went_well') || '—'}</p>
      </div>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Whole-team summary</span>
        <p className="text-surface-800 mt-0.5 whitespace-pre-wrap break-words">{qField(q, 'team_summary') || '—'}</p>
      </div>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Individual touchpoints</span>
        {checks.length === 0 ? (
          <p className="text-surface-500 mt-1 text-sm">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {checks.map((row, i) => (
              <li key={i} className="rounded-lg border border-surface-100 bg-surface-50/80 px-3 py-2 text-sm">
                <span className="font-medium text-surface-900">{row.member_label || '—'}</span>
                {row.member_user_id ? (
                  <span className="block text-[10px] text-surface-500 font-mono mt-0.5">User id: {String(row.member_user_id)}</span>
                ) : null}
                <span className="text-surface-500 mx-1">·</span>
                <span className="capitalize text-surface-700">{row.status === 'concern' ? 'Concern' : 'On track'}</span>
                {row.note ? <p className="text-xs text-surface-600 mt-1 whitespace-pre-wrap break-words">{row.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LeaderDailyPulsePanel({ leader, reportFilter, setReportFilter }) {
  const sorted = useMemo(() => sortQuestionnairesNewestFirst(leader.questionnaires), [leader.questionnaires]);
  const filter = reportFilter || (sorted[0] ? questionnaireReportKey(sorted[0]) : 'all');

  const filtered =
    filter === 'all' ? sorted : sorted.filter((q) => questionnaireReportKey(q) === filter);

  const selectedQ = filter === 'all' ? null : sorted.find((q) => questionnaireReportKey(q) === filter);

  const downloadOne = () => {
    const q = selectedQ || sorted[0];
    if (!q) return;
    const payload = questionnaireToPayload(q, leader);
    const doc = generateDailyPulsePdf(payload);
    const wd = String(qField(q, 'work_date') || '').slice(0, 10);
    downloadDailyPulsePdf(doc, `${safePdfFilename(leader.full_name)}-daily-pulse-${wd}.pdf`);
  };

  const downloadAll = () => {
    if (!sorted.length) return;
    const doc = generateDailyPulsePackPdf({
      leaderName: leader.full_name || 'Team leader',
      leaderEmail: leader.email,
      reports: sorted,
    });
    downloadDailyPulsePdf(doc, `${safePdfFilename(leader.full_name)}-daily-pulse-all.pdf`);
  };

  if (!sorted.length) {
    return <p className="text-sm text-surface-500">No questionnaires in this period.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-indigo-100 bg-indigo-50/50">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-1">
            Filter by report
          </label>
          <select
            value={filter}
            onChange={(e) => setReportFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All reports ({sorted.length})</option>
            {sorted.map((q) => {
              const key = questionnaireReportKey(q);
              const wd = formatDate(qField(q, 'work_date'));
              const sub = formatDateTime(qField(q, 'created_at'));
              return (
                <option key={key} value={key}>
                  {wd} — submitted {sub}
                </option>
              );
            })}
          </select>
        </div>
        <button
          type="button"
          onClick={downloadOne}
          disabled={!sorted.length || (filter !== 'all' && !selectedQ)}
          title={filter === 'all' ? 'Downloads the most recent report' : 'Downloads the selected report'}
          className="px-3 py-2 rounded-lg border border-indigo-200 bg-white text-sm font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
        >
          {filter === 'all' ? 'Download latest PDF' : 'Download PDF'}
        </button>
        <button
          type="button"
          onClick={downloadAll}
          className="px-3 py-2 rounded-lg bg-indigo-700 text-sm font-semibold text-white hover:bg-indigo-800"
        >
          Download all (PDF)
        </button>
      </div>
      <p className="text-xs text-surface-500">
        {filter === 'all'
          ? `Showing all ${filtered.length} report(s). Choose a single report to focus the view and download one PDF.`
          : `Showing 1 of ${sorted.length} report(s).`}
      </p>
      <div className={filter === 'all' ? 'space-y-4 max-h-[min(28rem,55vh)] overflow-y-auto pr-1' : ''}>
        {filtered.map((q) => (
          <QuestionnaireCard key={questionnaireReportKey(q)} q={q} />
        ))}
      </div>
    </div>
  );
}

export default function TeamLeaderAuditSection({ onError }) {
  const [auditTab, setAuditTab] = useState('dashboard');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [reportFilterByLeader, setReportFilterByLeader] = useState({});
  const [qRange, setQRange] = useState('365');

  const load = useCallback(() => {
    setLoading(true);
    onError('');
    const sel = QUESTIONNAIRE_RANGES.find((r) => r.value === qRange) || QUESTIONNAIRE_RANGES[1];
    const questionnaire_days = sel.param === 'all' ? 'all' : sel.param;
    teamGoals
      .teamLeaderAudit({ questionnaire_days, score_days: 56, ratings_days: 90 })
      .then(setData)
      .catch((e) => onError(e?.message || 'Failed to load team leader audit'))
      .finally(() => setLoading(false));
  }, [onError, qRange]);

  useEffect(() => {
    if (auditTab === 'audit') load();
  }, [load, auditTab]);

  const leaders = data?.leaders || [];
  const qAllTime = data?.questionnaire_all_time === true;
  const qDays = data?.window_questionnaire_days;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Team leader audit</h1>
            <InfoHint
              title="Team leader audit"
              text="Team dashboard ranks named teams by composite productivity (sum of member + leader individual scores). Leader audit lists each team leader’s daily pulse submissions, objectives, and member scores. Daily pulse on scheduled shifts: +10 within 12h after shift end, −30 if missed."
            />
          </div>
          {auditTab === 'audit' && !loading && (
            <p className="text-sm text-surface-600 mt-1 max-w-3xl">
              Questionnaires:{' '}
              {qAllTime ? (
                <span className="font-medium text-surface-800">all time</span>
              ) : (
                <span className="font-medium text-surface-800">last {qDays ?? '—'} days</span>
              )}
              . Productivity scores: last {data?.window_score_days ?? 56} days. Management ratings: last{' '}
              {data?.window_ratings_days ?? 90} days.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {AUDIT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAuditTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              auditTab === t.id
                ? 'bg-white text-indigo-800 shadow-sm ring-1 ring-surface-200'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {auditTab === 'dashboard' && <TeamProductivityDashboardTab onError={onError} />}

      {auditTab === 'audit' && loading && (
        <div className="text-sm text-surface-500 py-12 text-center">Loading team leader audit…</div>
      )}

      {auditTab === 'audit' && !loading && (
        <>
      <div className="flex flex-wrap items-center justify-end gap-2 -mt-2">
          <label className="text-xs text-surface-500 whitespace-nowrap">
            Questionnaire history
            <select
              value={qRange}
              onChange={(e) => setQRange(e.target.value)}
              className="ml-2 px-2 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-800 bg-white"
            >
              {QUESTIONNAIRE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={load}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-700 hover:bg-surface-50"
          >
            Refresh
          </button>
      </div>

      {leaders.length === 0 ? (
        <div className="app-glass-card p-8 text-center text-surface-600 text-sm">
          No team leaders with the Team leader admin page role, and no matching submissions in this period. Grant the page role in User management, or widen questionnaire history.
        </div>
      ) : (
        <div className="space-y-3">
          {leaders.map((L) => {
            const open = openId === L.user_id;
            const fromSubOnly = L.leader_from_submissions_only === true;
            return (
              <div key={L.user_id} className="app-glass-card shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    const nextOpen = open ? null : L.user_id;
                    setOpenId(nextOpen);
                    if (!open && (L.questionnaires || []).length) {
                      const latest = sortQuestionnairesNewestFirst(L.questionnaires)[0];
                      setReportFilterByLeader((prev) => ({
                        ...prev,
                        [L.user_id]: prev[L.user_id] ?? (latest ? questionnaireReportKey(latest) : 'all'),
                      }));
                    }
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-50/80"
                >
                  <div>
                    <span className="font-semibold text-surface-900">{L.full_name || '—'}</span>
                    {L.email && <span className="text-surface-500 text-sm ml-2">{L.email}</span>}
                    {fromSubOnly && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        Historical — no team leader page access
                      </span>
                    )}
                    <div className="text-xs text-surface-500 mt-0.5">
                      {L.questionnaires?.length ?? 0} submission(s) · {L.objectives?.length ?? 0} objective(s) ·{' '}
                      {L.team_members?.length ?? 0} linked member(s)
                    </div>
                  </div>
                  <span className="text-surface-400 text-sm shrink-0">{open ? '▼' : '▶'}</span>
                </button>
                {open && (
                  <div className="border-t border-surface-100 px-4 py-4 space-y-6 bg-surface-50/40">
                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-2">
                        Daily pulse — full capture
                      </h3>
                      <LeaderDailyPulsePanel
                        leader={L}
                        reportFilter={reportFilterByLeader[L.user_id]}
                        setReportFilter={(key) =>
                          setReportFilterByLeader((prev) => ({ ...prev, [L.user_id]: key }))
                        }
                      />
                    </section>

                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-2">
                        Shift &amp; team objectives (full detail)
                      </h3>
                      {(L.objectives || []).length === 0 ? (
                        <p className="text-sm text-surface-500">No objectives where this user is the named leader.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white">
                          <table className="w-full text-sm min-w-[960px]">
                            <thead className="bg-surface-50 border-b border-surface-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Title</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Scope</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Team / shift</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Description</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Metric</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Members</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Status</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Audit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                              {(L.objectives || []).map((o) => {
                                const desc = qField(o, 'description');
                                const members = o.members_on_objective || [];
                                const wd = qField(o, 'work_date');
                                const st = qField(o, 'shift_type');
                                const tn = qField(o, 'team_name');
                                return (
                                  <tr key={qField(o, 'id')} className="align-top">
                                    <td className="px-3 py-2 font-medium text-surface-900">{qField(o, 'title')}</td>
                                    <td className="px-3 py-2 text-surface-700 capitalize">{qField(o, 'scope')}</td>
                                    <td className="px-3 py-2 text-surface-700 text-xs">
                                      {wd ? <div>Date: {formatDate(wd)}</div> : null}
                                      {st ? <div className="capitalize">Shift: {st}</div> : null}
                                      {tn ? <div>Team: {tn}</div> : null}
                                      {!wd && !st && !tn ? '—' : null}
                                    </td>
                                    <td className="px-3 py-2 text-surface-700 text-xs max-w-xs whitespace-pre-wrap break-words">
                                      {desc || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-surface-600 text-xs">
                                      {qField(o, 'metric_name') != null
                                        ? `${qField(o, 'metric_name')}: ${qField(o, 'current_value') ?? '—'} / ${qField(o, 'target_value') ?? '—'} ${qField(o, 'unit') || ''}`
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-surface-700">
                                      {members.length === 0 ? (
                                        '—'
                                      ) : (
                                        <ul className="space-y-0.5">
                                          {members.map((m) => (
                                            <li key={m.user_id}>
                                              {m.full_name}
                                              {m.user_id ? (
                                                <span className="text-surface-500 font-mono text-[10px] block">{m.user_id}</span>
                                              ) : null}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-surface-700">{qField(o, 'status')}</td>
                                    <td className="px-3 py-2 text-surface-600 text-xs">
                                      <div>Updated {formatDateTime(qField(o, 'updated_at'))}</div>
                                      {qField(o, 'created_at') ? (
                                        <div>Created {formatDateTime(qField(o, 'created_at'))}</div>
                                      ) : null}
                                      {qField(o, 'created_by_name') || qField(o, 'created_by') ? (
                                        <div>
                                          By {qField(o, 'created_by_name') || qField(o, 'created_by')}
                                        </div>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-2">
                        Team members — productivity score (window)
                      </h3>
                      {(L.team_members || []).length === 0 ? (
                        <p className="text-sm text-surface-500">
                          No members listed on this leader&apos;s objectives — add members to team objectives to track scores here.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white">
                          <table className="w-full text-sm min-w-[480px]">
                            <thead className="bg-surface-50 border-b border-surface-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Member</th>
                                <th className="text-right px-3 py-2 font-medium text-surface-700">Total</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Components (pts)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                              {(L.team_members || []).map((m) => {
                                const b = m.breakdown;
                                const parts = b
                                  ? [
                                      `Punctuality ${b.punctuality?.points ?? 0}`,
                                      `Eval ${b.evaluation?.points ?? 0}`,
                                      `Tasks ${b.tasks?.points ?? 0}`,
                                      `Reports ${b.reportTiming?.points ?? 0}`,
                                      `Team ${b.teamProgress?.points ?? 0}`,
                                      `Pulse ${b.dailyPulse?.points ?? 0}`,
                                    ].join(' · ')
                                  : '—';
                                return (
                                  <tr key={m.user_id}>
                                    <td className="px-3 py-2 text-surface-900">{m.full_name}</td>
                                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                                      {m.productivity_total != null ? Number(m.productivity_total).toFixed(1) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-surface-600">{parts}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-2">
                        Management ratings (team members)
                      </h3>
                      {(L.management_ratings_for_team || []).length === 0 ? (
                        <p className="text-sm text-surface-500">No ratings in this window for listed members.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white">
                          <table className="w-full text-sm min-w-[640px]">
                            <thead className="bg-surface-50 border-b border-surface-200">
                              <tr>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Date</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Period</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Manager</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Member</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Rating</th>
                                <th className="text-left px-3 py-2 font-medium text-surface-700">Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                              {(L.management_ratings_for_team || []).map((r) => {
                                const mem = (L.team_members || []).find((x) => String(x.user_id) === String(qField(r, 'member_user_id')));
                                return (
                                  <tr key={qField(r, 'id')}>
                                    <td className="px-3 py-2 text-surface-700 whitespace-nowrap">
                                      {formatDate(qField(r, 'work_date'))}
                                    </td>
                                    <td className="px-3 py-2 text-surface-700 text-xs">{qField(r, 'period') || '—'}</td>
                                    <td className="px-3 py-2 text-surface-700 text-xs">
                                      {qField(r, 'manager_full_name') || qField(r, 'manager_user_id') || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-surface-900">{mem?.full_name || qField(r, 'member_user_id')}</td>
                                    <td className="px-3 py-2">{qField(r, 'rating')}/5</td>
                                    <td className="px-3 py-2 text-surface-600 text-xs max-w-md whitespace-pre-wrap break-words">
                                      {qField(r, 'narrative') || '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
