import { useState, useEffect, useCallback, useMemo } from 'react';
import { shiftClock } from '../api';
import { useAuth } from '../AuthContext';

function fmt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function userIdOf(row) {
  const u = row?.user;
  if (!u) return null;
  return u.id ?? u.Id ?? null;
}

export default function ShiftActivityTab() {
  const { user: me } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [teamDate, setTeamDate] = useState(() => new Date().toISOString().slice(0, 10));
  /** command_centre = CC page or CC tab grants; all = whole tenant (management only). */
  const [teamScope, setTeamScope] = useState('command_centre');
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState('');

  const canSeeFullTenant = useMemo(() => {
    if (me?.role === 'super_admin') return true;
    return (me?.page_roles || []).includes('management');
  }, [me]);

  const loadHistory = useCallback(() => {
    setLoading(true);
    shiftClock
      .myHistory({ from: undefined, to: undefined })
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadTeam = useCallback(() => {
    setTeamLoading(true);
    setTeamError('');
    const scope = teamScope === 'all' && canSeeFullTenant ? 'all' : 'command_centre';
    shiftClock
      .teamDay(teamDate, { scope })
      .then((d) => {
        setTeam(d);
        if (d?.scope && d.scope !== scope && teamScope === 'all') {
          setTeamError('Full tenant list is only available with Management access. Showing Command Centre team.');
        }
      })
      .catch((err) => {
        setTeam(null);
        setTeamError(err?.message || 'Could not load team schedules.');
      })
      .finally(() => setTeamLoading(false));
  }, [teamDate, teamScope, canSeeFullTenant]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">Shift activity</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Your clock-in history, breaks, and overtime. Supervisors use the same data under Management → Shift activity.
        </p>
      </div>

      <section className="bg-white dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Your sessions</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-slate-500">No clock sessions yet.</p>
          ) : (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-600">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">In</th>
                  <th className="pb-2 pr-4">Out</th>
                  <th className="pb-2 pr-4">OT (min)</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sessions.map((s) => (
                  <tr key={s.id ?? s.Id}>
                    <td className="py-2 pr-4 font-mono text-xs">{String(s.work_date).slice(0, 10)}</td>
                    <td className="py-2 pr-4">{fmt(s.clock_in_at)}</td>
                    <td className="py-2 pr-4">{fmt(s.clock_out_at)}</td>
                    <td className="py-2 pr-4">{s.overtime_minutes ?? 0}</td>
                    <td className="py-2 capitalize">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Team schedules & breaks</h2>
            <input
              type="date"
              value={teamDate}
              onChange={(e) => setTeamDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-sm dark:text-slate-100"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 text-xs">
            <span className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">View</span>
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="teamScope"
                checked={teamScope === 'command_centre'}
                onChange={() => setTeamScope('command_centre')}
                className="rounded-full border-slate-400 text-brand-600 focus:ring-brand-500"
              />
              Command Centre team
            </label>
            {canSeeFullTenant && (
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="teamScope"
                  checked={teamScope === 'all'}
                  onChange={() => setTeamScope('all')}
                  className="rounded-full border-slate-400 text-brand-600 focus:ring-brand-500"
                />
                Full tenant
              </label>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Default list includes people with the <strong>Command Centre</strong> page or a Command Centre tab grant. You always appear on your
            own list. Management can switch to <strong>Full tenant</strong> to see everyone.
          </p>
        </div>
        <div className="p-4 space-y-4 max-h-[480px] overflow-y-auto">
          {teamError && (
            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              {teamError}
            </div>
          )}
          {teamLoading ? (
            <p className="text-sm text-slate-500">Loading team…</p>
          ) : !team?.team?.length ? (
            <p className="text-sm text-slate-500">No people in this view for the selected date.</p>
          ) : (
            team.team.map((row, idx) => {
              const uid = userIdOf(row);
              return (
                <div
                  key={uid || `row-${idx}`}
                  className="rounded-xl border border-slate-200 dark:border-slate-600 p-4 bg-slate-50/50 dark:bg-slate-950/40"
                >
                  <p className="font-medium text-slate-900 dark:text-white">{row.user?.full_name || row.user?.email || 'User'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{row.user?.email}</p>
                  {row.entries?.length > 0 ? (
                    <p className="text-xs mt-2 text-slate-600 dark:text-slate-400">
                      Scheduled:{' '}
                      {row.entries.map((e) => `${e.shift_type} (${String(e.work_date).slice(0, 10)})`).join(', ')}
                    </p>
                  ) : (
                    <p className="text-xs mt-2 text-slate-500">No shift on this date</p>
                  )}
                  {row.session ? (
                    <div className="mt-2 text-xs space-y-1 font-mono text-slate-700 dark:text-slate-300">
                      <p>
                        Clock in: {fmt(row.session.clock_in_at)} · Out: {row.session.clock_out_at ? fmt(row.session.clock_out_at) : '—'}
                      </p>
                      {row.breaks?.length > 0 && (
                        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400">
                          {row.breaks.map((b) => (
                            <li key={b.id ?? b.Id}>
                              {b.break_type === 'major_60' ? '1 h' : '30 min'} · {fmt(b.started_at)} →{' '}
                              {b.ended_at ? fmt(b.ended_at) : 'ongoing'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs mt-2 text-amber-800 dark:text-amber-200">Not clocked in</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
