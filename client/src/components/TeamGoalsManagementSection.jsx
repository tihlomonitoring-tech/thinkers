import { useState, useEffect, useCallback } from 'react';
import { teamGoals, shiftScore } from '../api';
import InfoHint from './InfoHint.jsx';
import DepartmentGoalsTab from './DepartmentGoalsTab.jsx';
import { todayYmd } from '../lib/appTime.js';

function parseMembers(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

export default function TeamGoalsManagementSection({ tenantUsers = [], onError }) {
  const [objectives, setObjectives] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [questionnaires, setQuestionnaires] = useState([]);
  const [summary, setSummary] = useState(null);
  const [scoreSnap, setScoreSnap] = useState(null);
  const [workDate, setWorkDate] = useState(todayYmd());
  const [shiftType, setShiftType] = useState('day');
  const [cohort, setCohort] = useState([]);
  const [selectedLeader, setSelectedLeader] = useState('');
  const [ratingMember, setRatingMember] = useState('');
  const [ratingVal, setRatingVal] = useState('3');
  const [ratingPeriod, setRatingPeriod] = useState('daily');
  const [ratingNarrative, setRatingNarrative] = useState('');
  const [leaderPick, setLeaderPick] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    onError?.('');
    const sumReq = selectedLeader
      ? teamGoals.teamScoresSummary({ leader_id: selectedLeader }).catch(() => null)
      : teamGoals.teamScoresSummary().catch(() => null);
    Promise.all([
      teamGoals.listObjectives().catch(() => ({ objectives: [] })),
      teamGoals.listTeamLeaders().catch(() => ({ leaders: [] })),
      teamGoals.listRatings({ days: 45 }).catch(() => ({ ratings: [] })),
      teamGoals.listManagementQuestionnaires({ days: 60 }).catch(() => ({ entries: [] })),
      sumReq,
      shiftScore.tenant({ days: 30 }).catch(() => null),
    ])
      .then(([o, l, r, q, s, sc]) => {
        setObjectives(o.objectives || []);
        setLeaders(l.leaders || []);
        setRatings(r.ratings || []);
        setQuestionnaires(q.entries || []);
        setSummary(s);
        setScoreSnap(sc);
      })
      .catch((e) => onError?.(e?.message || 'Load failed'));
  }, [onError, selectedLeader]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadCohort = async () => {
    setBusy(true);
    onError?.('');
    try {
      const d = await teamGoals.scheduleCohort(workDate, shiftType);
      setCohort(d.members || []);
      setSelectedLeader('');
      setRatingMember('');
    } catch (e) {
      onError?.(e?.message || 'Could not load schedule cohort');
      setCohort([]);
    } finally {
      setBusy(false);
    }
  };

  const assignLeader = async () => {
    if (!leaderPick) return;
    setBusy(true);
    onError?.('');
    try {
      await teamGoals.assignTeamLeader(leaderPick);
      setLeaderPick('');
      await refresh();
    } catch (e) {
      onError?.(e?.message || 'Assign failed');
    } finally {
      setBusy(false);
    }
  };

  const removeLeader = async (userId) => {
    setBusy(true);
    onError?.('');
    try {
      await teamGoals.removeTeamLeader(userId);
      await refresh();
    } catch (e) {
      onError?.(e?.message || 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async (e) => {
    e.preventDefault();
    if (!ratingMember || !workDate) return;
    setBusy(true);
    onError?.('');
    try {
      await teamGoals.postRating({
        member_user_id: ratingMember,
        work_date: workDate,
        period: ratingPeriod,
        rating: parseInt(ratingVal, 10),
        narrative: ratingNarrative || null,
      });
      setRatingNarrative('');
      await refresh();
    } catch (err) {
      onError?.(err?.message || 'Rating failed');
    } finally {
      setBusy(false);
    }
  };

  const teamRows = objectives.filter((o) => String(o.scope || '').toLowerCase() === 'team');
  const shiftRows = objectives.filter((o) => String(o.scope || '').toLowerCase() === 'shift');

  const name = (id) => {
    const u = tenantUsers.find((x) => String(x.id) === String(id));
    return u?.full_name || u?.email || String(id).slice(0, 8);
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Team goals &amp; shift objectives</h1>
        <p className="text-sm text-surface-600 mt-1 max-w-3xl">
          Align department strategy, measurable objectives, team leaders, and management ratings. Ratings and achieved objectives feed the{' '}
          <strong>team progress</strong> band of the Command Centre productivity score.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Department strategy</h2>
        <DepartmentGoalsTab />
      </section>

      <section className="space-y-4 rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Team leaders</h2>
          <InfoHint
            title="Who counts as a team leader"
            text="Anyone with the Team leader admin page role for this organisation is a team leader and appears in this list. Use “Add management roster mark” only if you want an extra record for shift-cohort reference; removing it does not take away their page access — change page roles in User management for that."
          />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <select
            value={leaderPick}
            onChange={(e) => setLeaderPick(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm min-w-[200px]"
          >
            <option value="">Select employee…</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !leaderPick}
            onClick={assignLeader}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Add management roster mark
          </button>
        </div>
        <ul className="text-sm divide-y divide-surface-100 border border-surface-100 rounded-lg">
          {leaders.length === 0 && (
            <li className="px-3 py-2 text-surface-500">
              No users have the Team leader admin page role for this tenant. Grant it in User management.
            </li>
          )}
          {leaders.map((L) => {
            const uid = L.user_id ?? L.user_Id;
            const roster =
              L.roster_registered === true || L.roster_registered === 1 || String(L.roster_registered) === '1';
            return (
              <li key={uid} className="px-3 py-2 flex justify-between gap-2 items-center">
                <span>
                  {L.full_name || L.email}
                  {roster ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                      Management roster
                    </span>
                  ) : null}
                </span>
                {roster ? (
                  <button
                    type="button"
                    className="text-xs text-red-600 font-medium"
                    disabled={busy}
                    onClick={() => removeLeader(uid)}
                  >
                    Remove roster mark
                  </button>
                ) : (
                  <span className="text-[10px] text-surface-500">Page role only</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Shift cohort &amp; controller ratings</h2>
        <p className="text-xs text-surface-600">
          Load people on the same scheduled day/shift, pick a team leader reference, then rate members (1–5). Use the narrative field for a short progress note (daily / weekly / monthly).
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-surface-500 mb-1">Work date</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="px-2 py-1.5 rounded border border-surface-200 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Shift</label>
            <select value={shiftType} onChange={(e) => setShiftType(e.target.value)} className="px-2 py-1.5 rounded border border-surface-200 text-sm">
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </div>
          <button type="button" disabled={busy} onClick={loadCohort} className="px-3 py-2 rounded-lg bg-surface-800 text-white text-sm disabled:opacity-50">
            Load cohort
          </button>
        </div>
        {cohort.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-surface-600 mb-1">On schedule ({cohort.length})</p>
              <ul className="text-sm border border-surface-100 rounded-lg max-h-48 overflow-y-auto divide-y divide-surface-50">
                {cohort.map((m) => (
                  <li key={m.user_id ?? m.user_Id} className="px-2 py-1.5">
                    {m.full_name || m.email}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-surface-600 mb-1">Mark team leader (reference)</p>
              <select
                value={selectedLeader}
                onChange={(e) => setSelectedLeader(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm mb-3"
              >
                <option value="">—</option>
                {cohort.map((m) => {
                  const id = String(m.user_id ?? m.user_Id);
                  return (
                    <option key={id} value={id}>
                      {m.full_name || m.email}
                    </option>
                  );
                })}
              </select>
              <form onSubmit={submitRating} className="space-y-2 border border-surface-100 rounded-lg p-3 bg-surface-50/50">
                <p className="text-xs font-semibold text-surface-700">Rate controller / member</p>
                <select
                  value={ratingMember}
                  onChange={(e) => setRatingMember(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
                  required
                >
                  <option value="">Select member…</option>
                  {cohort.map((m) => {
                    const id = String(m.user_id ?? m.user_Id);
                    return (
                      <option key={id} value={id}>
                        {m.full_name || m.email}
                      </option>
                    );
                  })}
                </select>
                <div className="flex gap-2 flex-wrap">
                  <select value={ratingPeriod} onChange={(e) => setRatingPeriod(e.target.value)} className="px-2 py-1.5 rounded border border-surface-200 text-sm">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <select value={ratingVal} onChange={(e) => setRatingVal(e.target.value)} className="px-2 py-1.5 rounded border border-surface-200 text-sm">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n} — {n === 3 ? 'neutral' : n < 3 ? 'below' : 'above'}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={ratingNarrative}
                  onChange={(e) => setRatingNarrative(e.target.value)}
                  rows={3}
                  placeholder="Progress report / coaching notes…"
                  className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
                />
                <button type="submit" disabled={busy} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
                  Save rating
                </button>
              </form>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">Objective mix</p>
          <ul className="mt-2 text-sm text-surface-800 space-y-1">
            {(summary?.objectivesByStatus || []).map((row) => (
              <li key={`${row.scope}-${row.status}`}>
                {row.scope} · {row.status}: <strong>{row.n}</strong>
              </li>
            ))}
            {(!summary?.objectivesByStatus || summary.objectivesByStatus.length === 0) && <li className="text-surface-500">No rows</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">Questionnaires (60d)</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{summary?.questionnaireCount ?? 0}</p>
          <p className="text-xs text-surface-500 mt-1">Team leader daily submissions</p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">CC score · team progress avg</p>
          <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{scoreSnap?.componentAverages?.teamProgress ?? '—'}</p>
          <p className="text-xs text-surface-500 mt-1">Rolling 30d tenant view</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Team shift objectives</h2>
          <button type="button" className="text-sm text-brand-600 font-medium" onClick={refresh}>
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-3 py-2">Title / team</th>
                <th className="text-left px-3 py-2">Leader &amp; members</th>
                <th className="text-left px-3 py-2">Metric</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2 w-[160px]">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {teamRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-surface-500">
                    No team objectives yet.
                  </td>
                </tr>
              )}
              {teamRows.map((row) => {
                const id = row.id ?? row.Id;
                const mem = parseMembers(row.member_user_ids);
                return (
                  <tr key={id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-surface-900">{row.title}</div>
                      <div className="text-xs text-surface-500">{row.team_name || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Leader: {name(row.leader_user_id)}</div>
                      <div className="text-surface-500 mt-0.5">{mem.length} members</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.metric_name ? (
                        <>
                          {row.current_value ?? '—'} / {row.target_value ?? '—'} {row.unit || ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        defaultValue={row.status}
                        key={`mst-${id}-${row.updated_at}`}
                        disabled={busy}
                        onChange={(e) => {
                          setBusy(true);
                          teamGoals
                            .patchObjective(id, { status: e.target.value })
                            .then(() => refresh())
                            .catch((err) => onError?.(err?.message || 'Update failed'))
                            .finally(() => setBusy(false));
                        }}
                        className="text-xs rounded border border-surface-200 px-2 py-1"
                      >
                        <option value="active">active</option>
                        <option value="achieved">achieved</option>
                        <option value="paused">paused</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        defaultValue={row.current_value ?? ''}
                        key={`mtp-${id}-${row.updated_at}`}
                        className="w-20 px-2 py-1 rounded border border-surface-200 text-xs font-mono mb-1"
                        id={`mgmt-cv-${id}`}
                      />
                      <button
                        type="button"
                        className="block text-xs text-brand-600 font-medium"
                        disabled={busy}
                        onClick={() => {
                          const el = document.getElementById(`mgmt-cv-${id}`);
                          const v = el?.value;
                          setBusy(true);
                          teamGoals
                            .patchObjective(id, { current_value: v === '' ? null : Number(v) })
                            .then(() => refresh())
                            .catch((err) => onError?.(err?.message || 'Update failed'))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Save progress
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3 className="text-xs font-semibold text-surface-600 uppercase mt-4">Personal shift objectives (all staff)</h3>
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Owner</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {shiftRows.slice(0, 40).map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.title}</td>
                  <td className="px-3 py-2 text-xs">{name(row.created_by)}</td>
                  <td className="px-3 py-2 text-xs">{row.status}</td>
                </tr>
              ))}
              {shiftRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-surface-500">
                    None
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Recent management ratings</h2>
        <div className="overflow-x-auto overflow-y-auto max-h-64 rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Member</th>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Rating</th>
                <th className="text-left px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {ratings.slice(0, 40).map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-xs">{name(r.member_user_id)}</td>
                  <td className="px-3 py-1.5 text-xs">{r.period}</td>
                  <td className="px-3 py-1.5 font-mono">{r.rating}</td>
                  <td className="px-3 py-1.5 text-xs text-surface-600 max-w-[240px] truncate">{r.narrative || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Team leader questionnaires</h2>
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Leader</th>
                <th className="text-left px-3 py-2">Morale</th>
                <th className="text-left px-3 py-2">On track</th>
                <th className="text-left px-3 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {questionnaires.map((q) => (
                <tr key={q.id} className="border-t border-surface-100">
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">{String(q.work_date).slice(0, 10)}</td>
                  <td className="px-3 py-1.5 text-xs">{q.leader_name || '—'}</td>
                  <td className="px-3 py-1.5 text-xs">{q.team_morale}</td>
                  <td className="px-3 py-1.5 text-xs">{q.delivery_on_track}</td>
                  <td className="px-3 py-1.5 text-xs text-surface-600 max-w-[280px] truncate">{q.team_summary || q.top_blocker || '—'}</td>
                </tr>
              ))}
              {questionnaires.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-surface-500">
                    No questionnaire rows in range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
