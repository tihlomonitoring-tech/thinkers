import { useState, useEffect, useCallback, useMemo } from 'react';
import { teamGoals, profileManagement as pm } from './api';
import { useAuth } from './AuthContext';
import InfoHint from './components/InfoHint.jsx';
import ShiftObjectivesTab from './components/ShiftObjectivesTab.jsx';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import { todayYmd } from './lib/appTime.js';

const MAIN_TABS = [
  { id: 'pulse', label: 'Daily pulse' },
  { id: 'submissions', label: 'Recent submissions' },
  { id: 'objectives', label: 'Shift & team objectives' },
  { id: 'insights', label: 'Performance snapshot' },
];

const CUSTOM_MEMBER = '__custom__';

function rosterUid(m) {
  return String(m?.user_id ?? m?.User_id ?? m?.User_Id ?? '').trim();
}

function rosterName(m) {
  return String(m?.full_name ?? m?.Full_name ?? m?.email ?? '').trim() || 'Member';
}

function emptyTouchpointRow(r) {
  return !String(r?.member_label || '').trim() && !r?.member_user_id;
}

function mergeRosterIntoChecks(prev, roster) {
  const onlyPlaceholder = prev.length === 1 && emptyTouchpointRow(prev[0]);
  const base = onlyPlaceholder ? [] : [...prev];
  const seen = new Set(base.map((r) => (r.member_user_id ? String(r.member_user_id) : '')).filter(Boolean));
  for (const m of roster) {
    const id = rosterUid(m);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    base.push({ member_user_id: id, member_label: rosterName(m), status: 'ok', note: '' });
  }
  if (base.length === 0) base.push({ member_user_id: null, member_label: '', status: 'ok', note: '' });
  return base;
}

function qField(en, name) {
  if (!en || typeof en !== 'object') return undefined;
  const k = Object.keys(en).find((x) => x && String(x).toLowerCase() === String(name).toLowerCase());
  return k !== undefined ? en[k] : undefined;
}

function questionnaireEntryId(en) {
  return String(qField(en, 'id') ?? '');
}

function parseIndividualChecksJson(en) {
  const raw = qField(en, 'individual_checks_json') ?? qField(en, 'individual_checks');
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function SubmissionDetailReadOnly({ en, onClose }) {
  const checks = parseIndividualChecksJson(en);
  const created = qField(en, 'created_at');
  const createdStr = created ? new Date(created).toLocaleString() : '—';
  const detailClass = 'mt-1 text-sm text-surface-800 dark:text-surface-100 whitespace-pre-wrap break-words';
  const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-surface-500';

  return (
    <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/30 p-4 dark:border-brand-900/50 dark:bg-brand-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
          Submission · {String(qField(en, 'work_date') || '').slice(0, 10)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs font-medium text-surface-600 hover:text-surface-900 px-2 py-1 rounded-lg border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300 dark:hover:text-surface-100"
        >
          Close
        </button>
      </div>
      <p className={`${labelClass} mb-0.5`}>Submitted</p>
      <p className={detailClass}>{createdStr}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className={labelClass}>Team morale</p>
          <p className={detailClass}>{qField(en, 'team_morale') ?? '—'}</p>
        </div>
        <div>
          <p className={labelClass}>Delivery on track</p>
          <p className={detailClass}>{qField(en, 'delivery_on_track') ?? '—'}</p>
        </div>
      </div>
      <div className="mt-3">
        <p className={labelClass}>Top blocker</p>
        <p className={detailClass}>{qField(en, 'top_blocker') || '—'}</p>
      </div>
      <div className="mt-3">
        <p className={labelClass}>What went well</p>
        <p className={detailClass}>{qField(en, 'team_went_well') || '—'}</p>
      </div>
      <div className="mt-3">
        <p className={labelClass}>Whole-team summary</p>
        <p className={detailClass}>{qField(en, 'team_summary') || '—'}</p>
      </div>
      <div className="mt-4 border-t border-surface-200 dark:border-surface-700 pt-3">
        <p className={labelClass}>Individual touchpoints</p>
        {checks.length === 0 ? (
          <p className="mt-1 text-sm text-surface-500">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {checks.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-900"
              >
                <span className="font-medium text-surface-900 dark:text-surface-100">{row.member_label || '—'}</span>
                {row.member_user_id ? (
                  <span className="block text-[10px] text-surface-500 font-mono mt-0.5">User id: {String(row.member_user_id)}</span>
                ) : null}
                <span className="text-surface-500 mx-2">·</span>
                <span className="capitalize text-surface-700 dark:text-surface-300">{row.status === 'concern' ? 'Concern' : 'On track'}</span>
                {row.note ? <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">{row.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RecentSubmissionsPanel({ entries }) {
  const [detailEntryId, setDetailEntryId] = useState(null);

  useEffect(() => {
    if (!detailEntryId) return;
    if (!entries.some((e) => questionnaireEntryId(e) === detailEntryId)) setDetailEntryId(null);
  }, [entries, detailEntryId]);

  const detailEntry = detailEntryId ? entries.find((e) => questionnaireEntryId(e) === detailEntryId) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">Recent submissions</h2>
        <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
          Your last 20 daily questionnaires. Click a row to view the full report.
        </p>
        <ul className="space-y-2 text-sm max-h-[min(24rem,50vh)] overflow-y-auto pr-1">
          {entries.slice(0, 20).map((en) => {
            const eid = questionnaireEntryId(en);
            const selected = detailEntryId === eid;
            return (
              <li key={eid || String(qField(en, 'work_date'))}>
                <button
                  type="button"
                  onClick={() => setDetailEntryId((cur) => (cur === eid ? null : eid))}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    selected
                      ? 'border-brand-400 bg-brand-50/80 ring-1 ring-brand-400/60 dark:border-brand-700 dark:bg-brand-950/40 dark:ring-brand-700/50'
                      : 'border-surface-200 bg-surface-50/80 hover:bg-surface-100/80 dark:border-surface-800 dark:bg-surface-950/80 dark:hover:bg-surface-900/80'
                  }`}
                >
                  <span className="font-medium text-surface-900 dark:text-surface-100">
                    {String(qField(en, 'work_date') ?? en.work_date).slice(0, 10)}
                  </span>
                  <span className="text-surface-500 mx-2">·</span>
                  <span className="text-surface-700 dark:text-surface-300">
                    Morale {qField(en, 'team_morale') ?? en.team_morale}, delivery {qField(en, 'delivery_on_track') ?? en.delivery_on_track}
                  </span>
                  {(qField(en, 'team_summary') || en.team_summary) && (
                    <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 line-clamp-2">
                      {qField(en, 'team_summary') || en.team_summary}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
          {entries.length === 0 && <li className="text-surface-500 text-sm">No past entries.</li>}
        </ul>
        {detailEntry && <SubmissionDetailReadOnly en={detailEntry} onClose={() => setDetailEntryId(null)} />}
      </div>
    </div>
  );
}

function PulsePanel({
  workDate,
  setWorkDate,
  teamMorale,
  setTeamMorale,
  onTrack,
  setOnTrack,
  topBlocker,
  setTopBlocker,
  wentWell,
  setWentWell,
  teamSummary,
  setTeamSummary,
  checks,
  setChecks,
  addCheckRow,
  submit,
  saving,
}) {
  const [formHidden, setFormHidden] = useState(false);
  const [shiftRosterMode, setShiftRosterMode] = useState('auto');
  const [cohort, setCohort] = useState([]);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortErr, setCohortErr] = useState('');
  const [shiftTypeUsed, setShiftTypeUsed] = useState('day');
  const [rosterMergeBusy, setRosterMergeBusy] = useState(false);

  const cohortById = useMemo(() => {
    const m = new Map();
    for (const row of cohort) {
      const id = rosterUid(row);
      if (id) m.set(id, row);
    }
    return m;
  }, [cohort]);

  useEffect(() => {
    let cancelled = false;
    if (!workDate) return undefined;
    setCohortLoading(true);
    setCohortErr('');
    teamGoals
      .teamLeaderTouchpointRoster(workDate, shiftRosterMode)
      .then((d) => {
        if (cancelled) return;
        setCohort(d.members || []);
        setShiftTypeUsed(d.shift_type_used || 'day');
      })
      .catch((e) => {
        if (cancelled) return;
        setCohortErr(e?.message || 'Could not load schedule roster');
        setCohort([]);
      })
      .finally(() => {
        if (!cancelled) setCohortLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workDate, shiftRosterMode]);

  const appendScheduledColleagues = () => {
    setRosterMergeBusy(true);
    setCohortErr('');
    teamGoals
      .teamLeaderTouchpointRoster(workDate, shiftRosterMode)
      .then((d) => {
        const roster = d.members || [];
        setCohort(roster);
        setShiftTypeUsed(d.shift_type_used || 'day');
        setChecks((prev) => mergeRosterIntoChecks(prev, roster));
      })
      .catch((e) => setCohortErr(e?.message || 'Could not load schedule roster'))
      .finally(() => setRosterMergeBusy(false));
  };

  const memberSelectValue = (row) => {
    if (row.member_user_id) return String(row.member_user_id);
    if (String(row.member_label || '').trim()) return CUSTOM_MEMBER;
    return '';
  };

  const setMemberPick = (idx, value) => {
    setChecks((c) =>
      c.map((row, i) => {
        if (i !== idx) return row;
        if (!value) return { ...row, member_user_id: null, member_label: '' };
        if (value === CUSTOM_MEMBER) return { ...row, member_user_id: null, member_label: row.member_label || '' };
        const m = cohortById.get(value);
        return {
          ...row,
          member_user_id: value,
          member_label: m ? rosterName(m) : row.member_label || value,
        };
      })
    );
  };

  const fieldClass =
    'w-full px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100';

  return (
    <div className="max-w-3xl">
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5 border-b border-surface-200 dark:border-surface-800 bg-surface-50/40 dark:bg-surface-950/40">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Today&apos;s questionnaire</h2>
          <button
            type="button"
            onClick={() => setFormHidden((v) => !v)}
            className="shrink-0 text-sm font-medium text-surface-600 hover:text-surface-900 px-3 py-1.5 rounded-lg border border-surface-200 bg-white hover:bg-surface-50 dark:text-surface-400 dark:border-surface-700 dark:bg-surface-900 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          >
            {formHidden ? 'Show questionnaire' : 'Hide questionnaire'}
          </button>
        </div>
        {formHidden ? (
          <div className="px-4 py-4 sm:px-5 text-sm text-surface-600 dark:text-surface-400">
            The questionnaire is hidden. Your draft fields are kept until you show the form again or leave this page.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-4 sm:p-5 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Work date</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={fieldClass} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Team morale</label>
            <select value={teamMorale} onChange={(e) => setTeamMorale(e.target.value)} className={fieldClass}>
              <option value="good">Good</option>
              <option value="mixed">Mixed</option>
              <option value="strained">Strained</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Delivery on track?</label>
            <select value={onTrack} onChange={(e) => setOnTrack(e.target.value)} className={fieldClass}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Top blocker (if any)</label>
          <textarea value={topBlocker} onChange={(e) => setTopBlocker(e.target.value)} rows={2} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">What went well</label>
          <textarea value={wentWell} onChange={(e) => setWentWell(e.target.value)} rows={2} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Whole-team summary</label>
          <textarea
            value={teamSummary}
            onChange={(e) => setTeamSummary(e.target.value)}
            rows={3}
            className={fieldClass}
            placeholder="One paragraph for management…"
          />
        </div>
        <div className="border-t border-surface-200 dark:border-surface-800 pt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Individual touchpoints</h3>
            <button type="button" onClick={addCheckRow} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              + Add member row
            </button>
          </div>
          <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
            Pick people from <strong>work schedules</strong> for the work date (stable user id for reporting). Names stay in sync with HR data; use “Other” only when someone is not on the roster.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-1">Shift line for roster</label>
              <select
                value={shiftRosterMode}
                onChange={(e) => setShiftRosterMode(e.target.value)}
                className="min-w-[12rem] px-2 py-1.5 rounded-lg border border-surface-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
              >
                <option value="auto">Auto (my schedule on this date)</option>
                <option value="day">Day shift</option>
                <option value="night">Night shift</option>
              </select>
            </div>
            <button
              type="button"
              disabled={rosterMergeBusy || cohortLoading}
              onClick={appendScheduledColleagues}
              className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm font-medium text-surface-800 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:hover:bg-surface-800"
            >
              {rosterMergeBusy ? 'Loading…' : 'Add scheduled colleagues to list'}
            </button>
          </div>
          <div className="text-xs text-surface-500 dark:text-surface-400 flex flex-wrap items-center gap-x-2 gap-y-1">
            {cohortLoading && <span>Loading roster…</span>}
            {!cohortLoading && (
              <span>
                Roster for <span className="font-medium text-surface-700 dark:text-surface-300">{workDate}</span>
                {' · '}
                <span className="font-medium text-surface-700 dark:text-surface-300">{shiftTypeUsed}</span> shift
                {' · '}
                {cohort.length} colleague{cohort.length === 1 ? '' : 's'} (excluding you)
              </span>
            )}
          </div>
          {cohortErr && <p className="text-xs text-red-600 dark:text-red-400">{cohortErr}</p>}
          {checks.map((row, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-12 items-start rounded-lg border border-surface-200 bg-surface-50/50 p-3 dark:border-surface-800 dark:bg-surface-950/50">
              <div className="sm:col-span-5 space-y-1.5 min-w-0">
                <select
                  className="w-full px-2 py-1.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100 disabled:opacity-60"
                  disabled={cohortLoading}
                  value={memberSelectValue(row)}
                  onChange={(e) => setMemberPick(idx, e.target.value)}
                >
                  <option value="">— Select from roster —</option>
                  {row.member_user_id && !cohortById.has(String(row.member_user_id)) && (
                    <option value={String(row.member_user_id)}>{row.member_label || 'Colleague (saved)'}</option>
                  )}
                  {cohort.map((m) => {
                    const id = rosterUid(m);
                    if (!id) return null;
                    return (
                      <option key={id} value={id}>
                        {rosterName(m)}
                      </option>
                    );
                  })}
                  <option value={CUSTOM_MEMBER}>Other (type name)</option>
                </select>
                {!row.member_user_id && (
                  <input
                    className="w-full px-2 py-1.5 rounded-lg border border-surface-200 text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
                    placeholder="Member name (when not on roster)"
                    value={row.member_label}
                    onChange={(e) =>
                      setChecks((c) => c.map((x, i) => (i === idx ? { ...x, member_label: e.target.value } : x)))
                    }
                  />
                )}
              </div>
              <select
                className="sm:col-span-3 px-2 py-1.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
                value={row.status}
                onChange={(e) => setChecks((c) => c.map((x, i) => (i === idx ? { ...x, status: e.target.value } : x)))}
              >
                <option value="ok">On track</option>
                <option value="concern">Concern</option>
              </select>
              <input
                className="sm:col-span-4 px-2 py-1.5 rounded-lg border border-surface-200 text-sm text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
                placeholder="Short note"
                value={row.note}
                onChange={(e) => setChecks((c) => c.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Submit daily report'}
        </button>
          </form>
        )}
      </div>
    </div>
  );
}

function InsightsPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    teamGoals
      .teamScoresSummary()
      .then(setData)
      .catch((e) => setErr(e?.message || 'Could not load'));
  }, []);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!data) return <p className="text-sm text-surface-500">Loading snapshot…</p>;
  const rows = data.objectivesByStatus || [];
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-surface-600 dark:text-surface-400">
        High-level counts for your tenant. Detailed management ratings and cohort tools stay under <strong>Management</strong>.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
          <p className="text-xs font-semibold text-surface-500 uppercase">Questionnaire submissions</p>
          <p className="text-2xl font-bold text-brand-700 mt-1 tabular-nums">{data.questionnaireCount ?? 0}</p>
        </div>
        <div className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 sm:col-span-2">
          <p className="text-xs font-semibold text-surface-500 uppercase mb-2">Objectives by status</p>
          <ul className="text-sm space-y-1">
            {rows.map((r) => (
              <li key={`${r.scope}-${r.status}`} className="flex justify-between border-b border-surface-100 dark:border-surface-800 py-1">
                <span className="text-surface-700 dark:text-surface-300 capitalize">
                  {r.scope} · {r.status}
                </span>
                <span className="font-mono font-semibold">{r.n}</span>
              </li>
            ))}
            {rows.length === 0 && <li className="text-surface-500">No objective rows yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function TeamLeaderAdmin() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('team-leader');
  const [mainTab, setMainTab] = useState('pulse');
  const [entries, setEntries] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [workDate, setWorkDate] = useState(todayYmd());
  const [teamMorale, setTeamMorale] = useState('mixed');
  const [onTrack, setOnTrack] = useState('yes');
  const [topBlocker, setTopBlocker] = useState('');
  const [wentWell, setWentWell] = useState('');
  const [teamSummary, setTeamSummary] = useState('');
  const [checks, setChecks] = useState([{ member_user_id: null, member_label: '', status: 'ok', note: '' }]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    teamGoals
      .teamLeaderMe()
      .then(async (me) => {
        if (!me?.isAssigned && user?.role !== 'super_admin') {
          setEntries([]);
          return;
        }
        const q = await teamGoals.listMyQuestionnaires().catch(() => ({ entries: [] }));
        setEntries(q.entries || []);
      })
      .catch((e) => {
        setError(e?.message || 'Could not load');
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mainTab !== 'objectives') return;
    pm.tenantUsers()
      .then((d) => setTenantUsers(d.users || []))
      .catch(() => setTenantUsers([]));
  }, [mainTab]);

  const addCheckRow = () => setChecks((c) => [...c, { member_user_id: null, member_label: '', status: 'ok', note: '' }]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const individual_checks = checks
      .filter((r) => String(r.member_label || '').trim())
      .map((r) => {
        const row = {
          member_label: String(r.member_label).trim(),
          status: r.status === 'concern' ? 'concern' : 'ok',
          note: r.note ? String(r.note).trim() : '',
        };
        if (r.member_user_id) row.member_user_id = String(r.member_user_id).trim();
        return row;
      });
    try {
      await teamGoals.postQuestionnaire({
        work_date: workDate,
        team_morale: teamMorale,
        delivery_on_track: onTrack,
        top_blocker: topBlocker || null,
        team_went_well: wentWell || null,
        team_summary: teamSummary || null,
        individual_checks,
      });
      await load();
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  useAutoHideNavAfterTabChange(mainTab, { ready: !loading });

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center">
        <div className="w-full max-w-md rounded-xl border border-surface-200 bg-white p-8 shadow-sm animate-pulse space-y-4 dark:border-surface-800 dark:bg-surface-900">
          <div className="h-8 bg-surface-100 dark:bg-surface-800 rounded w-1/3" />
          <div className="h-10 bg-surface-100 dark:bg-surface-800 rounded w-2/3" />
          <div className="h-48 bg-surface-100 dark:bg-surface-800 rounded" />
        </div>
      </div>
    );
  }

  const activeTabLabel = MAIN_TABS.find((t) => t.id === mainTab)?.label || '';

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav
        className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden dark:border-surface-800 dark:bg-surface-900 ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Team leader</h2>
              <InfoHint
                title="Workspace sections"
                text="Use the list on the left — each section opens separately. Daily pulse is the questionnaire; Recent submissions lists your past reports; Shift & team objectives covers operational goals; Performance snapshot shows aggregate counts. Hide navigation to use full width for wide tables."
              />
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-2 leading-snug">
              Signed in as <span className="font-medium text-surface-700 dark:text-surface-200">{user?.full_name || user?.email}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            aria-label="Hide navigation"
            title="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {MAIN_TABS.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => setMainTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                  mainTab === tab.id
                    ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium dark:bg-brand-950/40 dark:text-brand-300'
                    : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent dark:text-surface-400 dark:hover:bg-surface-800/80 dark:hover:text-surface-100'
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:hover:bg-surface-800"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1 min-h-0 flex flex-col">
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center dark:bg-red-950/40 dark:border-red-900 dark:text-red-200">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="shrink-0 text-sm font-medium">
                Dismiss
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">{activeTabLabel}</h1>
            {mainTab === 'pulse' && (
              <InfoHint
                title="Daily pulse"
                text="Submit one questionnaire per work day for your team. Individual touchpoints are optional rows for member-level notes. Past reports are under Recent submissions."
              />
            )}
            {mainTab === 'objectives' && (
              <InfoHint
                title="Shift & team objectives"
                text="Operational measurable goals for your shift and teams. Team-scoped rows are available when you have the Team leader admin page role."
              />
            )}
            {mainTab === 'submissions' && (
              <InfoHint
                title="Recent submissions"
                text="Read-only history of questionnaires you submitted. Open Daily pulse to create or update today’s report for a given work date."
              />
            )}
            {mainTab === 'insights' && (
              <InfoHint
                title="Performance snapshot"
                text="Tenant-level counts only. For ratings, cohorts, and management tools, use Management."
              />
            )}
          </div>

          <div className="flex-1 min-h-0">
            {mainTab === 'pulse' && (
              <PulsePanel
                workDate={workDate}
                setWorkDate={setWorkDate}
                teamMorale={teamMorale}
                setTeamMorale={setTeamMorale}
                onTrack={onTrack}
                setOnTrack={setOnTrack}
                topBlocker={topBlocker}
                setTopBlocker={setTopBlocker}
                wentWell={wentWell}
                setWentWell={setWentWell}
                teamSummary={teamSummary}
                setTeamSummary={setTeamSummary}
                checks={checks}
                setChecks={setChecks}
                addCheckRow={addCheckRow}
                submit={submit}
                saving={saving}
              />
            )}
            {mainTab === 'submissions' && <RecentSubmissionsPanel entries={entries} />}
            {mainTab === 'objectives' && <ShiftObjectivesTab userId={user?.id} tenantUsers={tenantUsers} leadershipMode />}
            {mainTab === 'insights' && <InsightsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
