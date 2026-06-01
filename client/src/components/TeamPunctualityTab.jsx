import { useState, useEffect, useCallback } from 'react';
import { todayYmd } from '../lib/appTime.js';
import { shiftClock } from '../api';
import { expectedClockInLabel, punctualityStatus } from '../lib/shiftPunctuality.js';
import InfoHint from './InfoHint.jsx';

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function statusBadgeClass(detail) {
  if (detail === 'on_time') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200';
  if (detail === 'late') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
  if (detail === 'no_clock') return 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200';
  return 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
}

export default function TeamPunctualityTab() {
  const [teamDate, setTeamDate] = useState(() => todayYmd());
  const [shiftMode, setShiftMode] = useState('auto');
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTeam = useCallback(() => {
    setLoading(true);
    setError('');
    shiftClock
      .teamDay(teamDate, { scope: 'scheduled_shift', shift_type: shiftMode })
      .then((d) => setTeam(d))
      .catch((err) => {
        setTeam(null);
        setError(err?.message || 'Could not load team punctuality.');
      })
      .finally(() => setLoading(false));
  }, [teamDate, shiftMode]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const shiftLabel = team?.shift_type_used === 'night' ? 'Night' : 'Day';
  const expectedIn = expectedClockInLabel(team?.shift_type_used || 'day');

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-surface-600 dark:text-surface-400 max-w-2xl">
          Everyone scheduled on your shift line for the selected date — clock-in, clock-out, breaks, and punctuality
          vs expected start ({expectedIn} SAST for {shiftLabel.toLowerCase()} shift).
        </p>
        <InfoHint
          title="Team punctuality"
          text="Shows colleagues on the same work schedule (day or night) as you. Punctuality uses a 5-minute grace after the nominal shift start. Break types are 30 minutes (minor) or 1 hour (major)."
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Work date</label>
          <input
            type="date"
            value={teamDate}
            onChange={(e) => setTeamDate(e.target.value)}
            className="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Shift line</label>
          <select
            value={shiftMode}
            onChange={(e) => setShiftMode(e.target.value)}
            className="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 px-3 py-2 text-sm min-w-[140px]"
          >
            <option value="auto">Auto (my schedule)</option>
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </div>
        <button
          type="button"
          onClick={loadTeam}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 bg-white hover:bg-surface-50 disabled:opacity-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {team?.shift_inferred && (
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Shift line inferred from your schedule: <strong>{shiftLabel}</strong>.
        </p>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100 dark:border-surface-700 bg-surface-50/80 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
            {shiftLabel} shift · {String(teamDate).slice(0, 10)}
          </h2>
          <p className="text-xs text-surface-500 mt-0.5">
            {team?.team?.length ?? 0} scheduled colleague{team?.team?.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="p-4 space-y-4 max-h-[560px] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-surface-500">Loading…</p>
          ) : !team?.team?.length ? (
            <p className="text-sm text-surface-500">
              No one scheduled on this shift line for this date. Try another date or shift, or confirm work schedules
              are published.
            </p>
          ) : (
            team.team.map((row, idx) => {
              const uid = row.user?.id ?? `row-${idx}`;
              const punct = punctualityStatus(row, teamDate, team.shift_type_used);
              const session = row.session;
              const checkoutDone = !!session?.clock_out_at;
              return (
                <article
                  key={uid}
                  className="rounded-xl border border-surface-200 dark:border-surface-600 p-4 bg-surface-50/50 dark:bg-surface-950/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-surface-900 dark:text-white">
                        {row.user?.full_name || row.user?.email || 'User'}
                      </p>
                      <p className="text-xs text-surface-500">{row.user?.email}</p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadgeClass(punct.detail)}`}
                    >
                      {punct.label}
                    </span>
                  </div>

                  {row.entries?.length > 0 ? (
                    <p className="text-xs mt-2 text-surface-600 dark:text-surface-400">
                      Scheduled:{' '}
                      {row.entries
                        .map((e) => `${e.shift_type || '—'} (${String(e.work_date).slice(0, 10)})`)
                        .join(', ')}
                    </p>
                  ) : null}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                    <div className="rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Check in</p>
                      <p className="font-mono text-surface-800 dark:text-surface-200 mt-0.5">
                        {session?.clock_in_at ? fmt(session.clock_in_at) : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Check out</p>
                      <p className="font-mono text-surface-800 dark:text-surface-200 mt-0.5">
                        {checkoutDone ? fmt(session.clock_out_at) : session ? 'Still on shift' : '—'}
                      </p>
                    </div>
                  </div>

                  {row.breaks?.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-1">
                        Breaks
                      </p>
                      <ul className="space-y-1 text-xs text-surface-700 dark:text-surface-300">
                        {row.breaks.map((b) => (
                          <li
                            key={b.id ?? b.Id}
                            className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono border-l-2 border-brand-300 pl-2"
                          >
                            <span>{b.break_type === 'major_60' ? '1 h major' : '30 min minor'}</span>
                            <span className="text-surface-500">·</span>
                            <span>{fmt(b.started_at)}</span>
                            <span>→</span>
                            <span>{b.ended_at ? fmt(b.ended_at) : 'ongoing'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : session ? (
                    <p className="text-xs mt-2 text-surface-500">No breaks recorded</p>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
