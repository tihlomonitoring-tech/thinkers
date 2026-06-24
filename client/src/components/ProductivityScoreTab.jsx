import { useState, useEffect, useCallback, useMemo } from 'react';
import { shiftScore } from '../api';
import InfoHint from './InfoHint.jsx';
import {
  SCORE_CATEGORIES,
  CAT_LABELS,
  CAT_LABELS_SHORT,
  describeScoreEvent,
  ScoringRulesPanel,
} from '../lib/productivityScoreDisplay.jsx';

function PointsBadge({ value, size = 'md' }) {
  const n = Number(value) || 0;
  const cls = size === 'lg' ? 'text-3xl font-bold tabular-nums' : 'text-sm font-semibold tabular-nums';
  const color = n >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={`${cls} ${color}`}>
      {n > 0 ? '+' : ''}
      {n}
    </span>
  );
}

function CategoryBreakdownCard({ categoryId, breakdown, teamAverage, defaultOpen = false }) {
  const row = breakdown?.[categoryId] || { points: 0, events: [] };
  const events = row.events || [];
  const [open, setOpen] = useState(defaultOpen);
  const delta = Math.round(((row.points || 0) - (teamAverage || 0)) * 10) / 10;

  return (
    <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-50/80 dark:hover:bg-surface-800/50 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{CAT_LABELS[categoryId]}</p>
          <p className="text-xs text-surface-500 mt-0.5">
            {events.length} event{events.length === 1 ? '' : 's'}
            {teamAverage != null && (
              <>
                {' · '}
                <span className={delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  {delta >= 0 ? '+' : ''}
                  {delta} vs team avg
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <PointsBadge value={row.points} />
          <svg
            className={`w-4 h-4 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="border-t border-surface-100 dark:border-surface-800 px-4 py-3 bg-surface-50/40 dark:bg-surface-950/40">
          {events.length === 0 ? (
            <p className="text-xs text-surface-500">No events in this category for the selected window.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {events.map((ev, i) => (
                <li
                  key={`${categoryId}-${i}`}
                  className="text-xs text-surface-700 dark:text-surface-300 leading-snug rounded-lg bg-white dark:bg-surface-900 border border-surface-100 dark:border-surface-800 px-3 py-2"
                >
                  {describeScoreEvent(ev, categoryId)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonBar({ label, yours, teamAvg }) {
  const max = Math.max(Math.abs(yours), Math.abs(teamAvg), 1);
  const yoursPct = Math.round((Math.abs(yours) / max) * 100);
  const teamPct = Math.round((Math.abs(teamAvg) / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-surface-700 dark:text-surface-300">{label}</span>
        <span className="text-surface-500 tabular-nums">
          You {yours > 0 ? '+' : ''}
          {yours} · Team {teamAvg > 0 ? '+' : ''}
          {teamAvg}
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${yours >= 0 ? 'bg-indigo-500' : 'bg-red-500'}`}
            style={{ width: `${yoursPct}%` }}
          />
        </div>
        <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden">
          <div className="h-full rounded-full bg-surface-400/60" style={{ width: `${teamPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function ProductivityScoreTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(30);

  const load = useCallback(() => {
    setLoading(true);
    return shiftScore
      .me({ days: windowDays })
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => {
        setError(e?.message || 'Could not load score');
      })
      .finally(() => setLoading(false));
  }, [windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  const recentEvents = useMemo(() => {
    const b = data?.breakdown || {};
    const items = [];
    for (const id of SCORE_CATEGORIES) {
      for (const ev of b[id]?.events || []) {
        items.push({
          categoryId: id,
          ev,
          sortKey: ev.at || ev.submitted_at || ev.completed_at || ev.work_date || '',
        });
      }
    }
    return items
      .sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)))
      .slice(0, 12);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-surface-100 dark:bg-surface-800 rounded w-1/2 animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm p-4 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {error}
      </div>
    );
  }

  const analytics = data?.analytics || {};
  const b = data?.breakdown || {};
  const roles = data?.roles || {};
  const vsAvg = analytics.vsTeamAverage ?? 0;
  const hasActivity = analytics.hasActivity;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Productivity score</h2>
            <InfoHint
              title="Your productivity analysis"
              text="Rolling window on your tenant calendar. Points come from clock-in punctuality, telematics evaluations on your shift reports, task completion, report hand-in timing, team objectives, management ratings, daily pulse (team leaders), and employee/colleague performance evaluations. Compare your breakdown to the Command Centre team average."
            />
          </div>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
            <span className="font-medium tabular-nums">{data?.fromYmd}</span> →{' '}
            <span className="font-medium tabular-nums">{data?.toYmd}</span> ({data?.windowDays} days)
            {data?.rosterUserCount != null && (
              <span className="text-surface-400"> · {data.rosterUserCount} in team comparison</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {roles.isCommandCentreMember && (
              <span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 px-2.5 py-0.5 text-xs font-medium">
                Command Centre
              </span>
            )}
            {roles.isTeamLeader && (
              <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 px-2.5 py-0.5 text-xs font-medium">
                Team leader
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm flex items-center gap-2">
            <span className="text-xs text-surface-500">Window</span>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="rounded-lg border border-surface-200 dark:border-surface-700 px-2 py-1.5 text-sm dark:bg-surface-900"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 px-2 py-1.5 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-surface-900 px-5 py-4 shadow-sm lg:col-span-1">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Your total</p>
          <PointsBadge value={data?.total ?? 0} size="lg" />
          <p className="text-xs text-surface-500 mt-2">
            Team avg{' '}
            <span className="font-semibold text-surface-800 dark:text-surface-200 tabular-nums">
              {data?.groupAverage ?? '—'}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Vs team average</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${vsAvg >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {vsAvg > 0 ? '+' : ''}
            {vsAvg}
          </p>
          <p className="text-xs text-surface-500 mt-1">Points above or below team mean</p>
        </div>
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Team rank</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums mt-1">
            {analytics.rank != null ? `#${analytics.rank}` : '—'}
            {analytics.teamSize > 0 && (
              <span className="text-base font-normal text-surface-400"> / {analytics.teamSize}</span>
            )}
          </p>
          {analytics.percentile != null && (
            <p className="text-xs text-surface-500 mt-1">Top {analytics.percentile}% of roster</p>
          )}
        </div>
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Contributing events</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums mt-1">
            {analytics.eventCount ?? 0}
          </p>
          <p className="text-xs text-surface-500 mt-1">
            <span className="text-emerald-600 dark:text-emerald-400">+{analytics.positiveEvents ?? 0}</span>
            {' · '}
            <span className="text-red-600 dark:text-red-400">{analytics.negativeEvents ?? 0} negative</span>
          </p>
        </div>
      </div>

      {!hasActivity && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold">No scoring activity in this window yet</p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
            Clock in for scheduled shifts, complete assigned tasks, submit shift reports on time, or participate in team
            objectives to start building your score. Categories that apply to your role are shown below.
          </p>
        </div>
      )}

      {hasActivity && (analytics.strongestCategory || analytics.attentionCategory) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {analytics.strongestCategory && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                Strongest area
              </p>
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">
                {CAT_LABELS_SHORT[analytics.strongestCategory]}
              </p>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                Highest net points among categories with activity this period.
              </p>
            </div>
          )}
          {analytics.attentionCategory && analytics.attentionCategory !== analytics.strongestCategory && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                Needs attention
              </p>
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 mt-1">
                {CAT_LABELS_SHORT[analytics.attentionCategory]}
              </p>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                Lowest net points among categories with activity — review events below for specifics.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-800/50">
          <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">Category summary</h3>
          <p className="text-xs text-surface-500 mt-0.5">Your points vs team average per category</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-surface-700 dark:text-surface-300">Category</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700 dark:text-surface-300">Your points</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700 dark:text-surface-300">Team avg</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700 dark:text-surface-300">Delta</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700 dark:text-surface-300">Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {(analytics.categories || SCORE_CATEGORIES.map((id) => ({ id, points: 0, teamAverage: 0, delta: 0, events: 0 }))).map(
                (row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 text-surface-800 dark:text-surface-200">{CAT_LABELS_SHORT[row.id]}</td>
                    <td className="px-4 py-2 text-right">
                      <PointsBadge value={row.points} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-surface-600 dark:text-surface-400">
                      {row.teamAverage > 0 ? '+' : ''}
                      {row.teamAverage}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium ${
                        row.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {row.delta > 0 ? '+' : ''}
                      {row.delta}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-surface-600 dark:text-surface-400">
                      {row.events}
                    </td>
                  </tr>
                )
              )}
              <tr className="bg-surface-50/80 dark:bg-surface-800/30 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">
                  <PointsBadge value={data?.total ?? 0} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  {data?.groupAverage ?? 0}
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${
                    vsAvg >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {vsAvg > 0 ? '+' : ''}
                  {vsAvg}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-surface-600 dark:text-surface-400">
                  {analytics.eventCount ?? 0}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {roles.isCommandCentreMember && (analytics.categories || []).some((c) => c.points !== 0 || c.events > 0) && (
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">You vs team — visual comparison</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {SCORE_CATEGORIES.map((id) => {
              const cat = (analytics.categories || []).find((c) => c.id === id) || { points: 0, teamAverage: 0 };
              if (cat.points === 0 && cat.teamAverage === 0) return null;
              return (
                <ComparisonBar
                  key={id}
                  label={CAT_LABELS_SHORT[id]}
                  yours={cat.points}
                  teamAvg={cat.teamAverage}
                />
              );
            })}
          </div>
          <p className="text-xs text-surface-400 mt-3">Thicker bar = your score · thinner bar = team average</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Event breakdown by category</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {SCORE_CATEGORIES.map((id, i) => (
            <CategoryBreakdownCard
              key={id}
              categoryId={id}
              breakdown={b}
              teamAverage={data?.componentAverages?.[id]}
              defaultOpen={i < 2 && (b[id]?.events?.length || 0) > 0}
            />
          ))}
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Recent activity</h3>
          <ul className="space-y-2">
            {recentEvents.map(({ categoryId, ev }, i) => (
              <li
                key={i}
                className="text-xs text-surface-700 dark:text-surface-300 rounded-lg border border-surface-100 dark:border-surface-800 px-3 py-2"
              >
                <span className="font-medium text-surface-500 dark:text-surface-400">{CAT_LABELS_SHORT[categoryId]} · </span>
                {describeScoreEvent(ev, categoryId)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScoringRulesPanel scoring={data?.scoring} />
    </div>
  );
}
