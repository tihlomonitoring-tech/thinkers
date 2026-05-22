import { useState, useEffect, useCallback, useMemo } from 'react';
import { teamGoals } from '../api';
import InfoHint from './InfoHint.jsx';

const SCORE_DAYS_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '56', label: '56 days' },
  { value: '90', label: '90 days' },
];

const COMPONENT_META = [
  { key: 'punctuality', label: 'Clock-in', color: 'bg-sky-500' },
  { key: 'evaluation', label: 'Evaluations', color: 'bg-violet-500' },
  { key: 'tasks', label: 'Tasks', color: 'bg-amber-500' },
  { key: 'reportTiming', label: 'Reports', color: 'bg-emerald-500' },
  { key: 'teamProgress', label: 'Team progress', color: 'bg-indigo-500' },
  { key: 'dailyPulse', label: 'Daily pulse', color: 'bg-rose-500' },
];

function bandStyles(band) {
  if (band === 'leading') return 'border-emerald-300 bg-emerald-50/60 text-emerald-900';
  if (band === 'attention') return 'border-amber-300 bg-amber-50/60 text-amber-900';
  return 'border-surface-200 bg-white text-surface-800';
}

function bandLabel(band) {
  if (band === 'leading') return 'Leading';
  if (band === 'attention') return 'Needs attention';
  return 'On track';
}

function ComponentStack({ totals, maxAbs }) {
  const scale = maxAbs > 0 ? maxAbs : 1;
  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-surface-100 ring-1 ring-surface-200/80">
      {COMPONENT_META.map((c) => {
        const v = totals[c.key] || 0;
        if (!v) return null;
        const w = Math.max(2, (Math.abs(v) / scale) * 100);
        return (
          <div
            key={c.key}
            className={`${c.color} ${v < 0 ? 'opacity-70' : ''}`}
            style={{ width: `${Math.min(100, w)}%` }}
            title={`${c.label}: ${v > 0 ? '+' : ''}${v}`}
          />
        );
      })}
    </div>
  );
}

function TeamDetailPanel({ team, maxComposite }) {
  const maxBar = maxComposite || team.team_composite_score || 1;
  const barPct = Math.min(100, Math.max(4, (team.team_composite_score / maxBar) * 100));
  const maxComp = Math.max(
    1,
    ...COMPONENT_META.map((c) => Math.abs(team.component_totals[c.key] || 0))
  );

  return (
    <div className="mt-4 space-y-5 border-t border-surface-200 pt-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-2">Composite vs top team</p>
        <div className="h-3 rounded-full bg-surface-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all"
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className="text-xs text-surface-500 mt-1 tabular-nums">
          {team.team_composite_score} pts · {team.vs_org_average_pct > 0 ? '+' : ''}
          {team.vs_org_average_pct}% vs org average
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3">
          <p className="text-[10px] uppercase text-surface-500 font-semibold">Members (sum)</p>
          <p className="text-xl font-bold text-surface-900 tabular-nums">{team.members_sum}</p>
          <p className="text-xs text-surface-500">avg {team.members_avg} · {team.members.length} listed</p>
        </div>
        <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3">
          <p className="text-[10px] uppercase text-surface-500 font-semibold">Leaders (sum)</p>
          <p className="text-xl font-bold text-indigo-800 tabular-nums">{team.leaders_sum}</p>
          <p className="text-xs text-surface-500">avg {team.leaders_avg} · pulse {team.daily_pulse.points > 0 ? '+' : ''}{team.daily_pulse.points}</p>
        </div>
        <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3">
          <p className="text-[10px] uppercase text-surface-500 font-semibold">Per capita</p>
          <p className="text-xl font-bold text-surface-900 tabular-nums">{team.team_average_per_capita}</p>
          <p className="text-xs text-surface-500">{team.headcount_scored} scored</p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3">
          <p className="text-[10px] uppercase text-rose-800/80 font-semibold">Daily pulse compliance</p>
          <p className="text-xl font-bold text-rose-900 tabular-nums">
            {team.daily_pulse.compliance_pct != null ? `${team.daily_pulse.compliance_pct}%` : '—'}
          </p>
          <p className="text-xs text-rose-800/70">
            {team.daily_pulse.on_time} on time · {team.daily_pulse.missed} missed
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-2">Team component mix (all roles)</p>
        <ComponentStack totals={team.component_totals} maxAbs={maxComp} />
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-surface-600">
          {COMPONENT_META.map((c) => (
            <li key={c.key} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm ${c.color}`} />
              {c.label}{' '}
              <span className="font-mono font-semibold tabular-nums">{team.component_totals[c.key] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-surface-200 overflow-hidden">
          <div className="px-3 py-2 bg-surface-50 border-b border-surface-200 text-xs font-semibold text-surface-700">
            Team members — individual scores
          </div>
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-50/80 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-surface-600">Name</th>
                  <th className="text-right px-3 py-2 font-medium text-surface-600">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {team.members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="px-3 py-2 text-surface-800">{m.full_name}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {m.productivity_total != null ? Number(m.productivity_total).toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
                {!team.members.length && (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-surface-500 text-center">
                      No members on team objectives.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-indigo-100 overflow-hidden">
          <div className="px-3 py-2 bg-indigo-50/80 border-b border-indigo-100 text-xs font-semibold text-indigo-900">
            Team leaders — scores &amp; daily pulse
          </div>
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-indigo-50/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-indigo-800">Leader</th>
                  <th className="text-right px-3 py-2 font-medium text-indigo-800">Total</th>
                  <th className="text-right px-3 py-2 font-medium text-indigo-800">Pulse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {team.leaders.map((l) => (
                  <tr key={l.user_id}>
                    <td className="px-3 py-2 text-surface-800">{l.full_name}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {l.productivity_total != null ? Number(l.productivity_total).toFixed(1) : '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        (l.daily_pulse_points || 0) < 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {l.daily_pulse_points > 0 ? '+' : ''}
                      {l.daily_pulse_points || 0}
                    </td>
                  </tr>
                ))}
                {!team.leaders.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-surface-500 text-center">
                      No leader linked on objectives.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeamProductivityDashboardTab({ onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoreDays, setScoreDays] = useState('30');
  const [openTeamKey, setOpenTeamKey] = useState(null);
  const [sortBy, setSortBy] = useState('composite');

  const load = useCallback(() => {
    setLoading(true);
    onError('');
    teamGoals
      .teamProductivityDashboard({ score_days: parseInt(scoreDays, 10) })
      .then(setData)
      .catch((e) => onError(e?.message || 'Failed to load team dashboard'))
      .finally(() => setLoading(false));
  }, [onError, scoreDays]);

  useEffect(() => {
    load();
  }, [load]);

  const teams = useMemo(() => {
    const list = [...(data?.teams || [])];
    if (sortBy === 'composite') list.sort((a, b) => b.team_composite_score - a.team_composite_score);
    else if (sortBy === 'members') list.sort((a, b) => b.members_sum - a.members_sum);
    else if (sortBy === 'pulse') list.sort((a, b) => (b.daily_pulse.compliance_pct ?? 0) - (a.daily_pulse.compliance_pct ?? 0));
    return list;
  }, [data?.teams, sortBy]);

  const maxComposite = useMemo(() => Math.max(0, ...teams.map((t) => t.team_composite_score)), [teams]);

  if (loading) {
    return <div className="text-sm text-surface-500 py-12 text-center">Loading team productivity dashboard…</div>;
  }

  const org = data?.org || {};
  const sc = data?.scoring?.dailyPulse;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-surface-900">Team productivity dashboard</h2>
            <InfoHint
              title="How team scores are built"
              text="Each named team comes from Shift & team objectives (team scope). Team composite = sum of all members’ individual productivity scores plus all linked leaders’ scores (including Daily pulse ±10/−30 on scheduled shifts). Compare teams by rank, component mix, and pulse compliance."
            />
          </div>
          <p className="text-sm text-surface-600 mt-1">
            Window {data?.fromYmd} → {data?.toYmd} ({data?.windowDays} days)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-surface-500">
            Score window
            <select
              value={scoreDays}
              onChange={(e) => setScoreDays(e.target.value)}
              className="ml-2 px-2 py-2 rounded-lg border border-surface-200 text-sm bg-white"
            >
              {SCORE_DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-2 rounded-lg border border-surface-200 text-sm bg-white"
          >
            <option value="composite">Sort: composite</option>
            <option value="members">Sort: members sum</option>
            <option value="pulse">Sort: pulse compliance</option>
          </select>
          <button
            type="button"
            onClick={load}
            className="px-3 py-2 rounded-lg border border-surface-200 text-sm font-medium hover:bg-surface-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {sc && (
        <div className="rounded-xl border border-rose-100 bg-rose-50/40 px-4 py-3 text-xs text-rose-950">
          <span className="font-semibold">Daily pulse scoring: </span>
          +{sc.onTime} when submitted within {sc.withinHoursAfterShiftEnd}h after shift end; {sc.missed} if missed after
          deadline (scheduled team leader shifts only).
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-surface-500">Teams tracked</p>
          <p className="text-2xl font-bold text-surface-900 tabular-nums mt-1">{org.team_count ?? 0}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-indigo-800">Org avg composite</p>
          <p className="text-2xl font-bold text-indigo-900 tabular-nums mt-1">{org.average_composite ?? 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-emerald-800">Top team</p>
          <p className="text-sm font-bold text-emerald-900 mt-1 truncate">{org.top_team || '—'}</p>
          <p className="text-lg font-bold text-emerald-800 tabular-nums">{org.top_composite ?? 0}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-rose-800">Pulse compliance</p>
          <p className="text-2xl font-bold text-rose-900 tabular-nums mt-1">
            {org.pulse_compliance_pct != null ? `${org.pulse_compliance_pct}%` : '—'}
          </p>
          <p className="text-xs text-rose-800/80">
            {org.pulse_on_time ?? 0} on · {org.pulse_missed ?? 0} missed
          </p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-surface-500">People scored</p>
          <p className="text-2xl font-bold text-surface-900 tabular-nums mt-1">{org.total_members_scored ?? 0}</p>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="app-glass-card p-8 text-center text-sm text-surface-600">
          No teams found. Create team-scoped objectives with a team name and members in Shift &amp; team objectives.
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => {
            const open = openTeamKey === team.team_key;
            return (
              <div
                key={team.team_key}
                className={`rounded-xl border shadow-sm overflow-hidden transition-colors ${bandStyles(team.performance_band)}`}
              >
                <button
                  type="button"
                  onClick={() => setOpenTeamKey(open ? null : team.team_key)}
                  className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-surface-500 tabular-nums">#{team.rank}</span>
                      <span className="font-semibold text-surface-900 truncate">{team.team_name}</span>
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-white/80 border border-surface-200">
                        {bandLabel(team.performance_band)}
                      </span>
                      {team.synthetic && (
                        <span className="text-[10px] text-surface-500 italic">Leader cohort</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-surface-600 tabular-nums">
                      <span>
                        Composite <strong className="text-surface-900">{team.team_composite_score}</strong>
                      </span>
                      <span>
                        Members <strong>{team.members_sum}</strong>
                      </span>
                      <span>
                        Leaders <strong>{team.leaders_sum}</strong>
                      </span>
                      <span>
                        Pulse{' '}
                        <strong>
                          {team.daily_pulse.compliance_pct != null ? `${team.daily_pulse.compliance_pct}%` : '—'}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-2 max-w-xl">
                      <ComponentStack
                        totals={team.component_totals}
                        maxAbs={Math.max(1, ...COMPONENT_META.map((c) => Math.abs(team.component_totals[c.key] || 0)))}
                      />
                    </div>
                  </div>
                  <span className="text-surface-400 text-sm shrink-0">{open ? '▼' : '▶'}</span>
                </button>
                {open && <div className="px-4 pb-4"><TeamDetailPanel team={team} maxComposite={maxComposite} /></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
