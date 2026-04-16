import { useState, useEffect } from 'react';
import { shiftScore } from '../api';
import InfoHint from './InfoHint.jsx';

const CAT_LABELS = {
  punctuality: 'Clock-in punctuality',
  evaluation: 'Controller evaluations',
  tasks: 'Tasks (on time vs overdue)',
  reportTiming: 'Shift report hand-in (by 06:15 / 18:15 SAST)',
  teamProgress: 'Team progress (objectives & management ratings)',
};

export default function ProductivityScoreTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    setLoading(true);
    shiftScore
      .me({ days: 30 })
      .then((r) => {
        if (!c) setData(r);
      })
      .catch((e) => {
        if (!c) setError(e?.message || 'Could not load score');
      })
      .finally(() => {
        if (!c) setLoading(false);
      });
    return () => {
      c = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-8 animate-pulse space-y-4">
        <div className="h-8 bg-surface-100 rounded w-1/3" />
        <div className="h-40 bg-surface-100 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm p-4">
        {error}
      </div>
    );
  }

  const sc = data?.scoring || {};
  const b = data?.breakdown || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-surface-900">Productivity score</h2>
            <InfoHint
              title="How your score is built"
              text="Rolling window on your tenant calendar. Points come from: shift clock-in vs scheduled day (06:00) or night (18:00) start; manager evaluations on shift reports you authored; tasks assigned to you completed on or before due date; shift reports submitted before shift end plus 15 minutes (18:15 day / 06:15 morning after night); measurable objectives marked achieved and management 1–5 team ratings (neutral at 3). Only Command Centre team members are included in the team average."
            />
          </div>
          <p className="text-sm text-surface-600 mt-1">
            Window: <span className="font-medium tabular-nums">{data?.fromYmd}</span> →{' '}
            <span className="font-medium tabular-nums">{data?.toYmd}</span> ({data?.windowDays} days)
          </p>
        </div>
        <div className="text-right rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Your total</p>
          <p className="text-3xl font-bold text-indigo-700 tabular-nums">{data?.total ?? 0}</p>
          <p className="text-xs text-surface-500 mt-1">
            Team avg <span className="font-semibold text-surface-800 tabular-nums">{data?.groupAverage ?? '—'}</span>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 border-b border-surface-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-surface-700">Category</th>
              <th className="text-right px-4 py-3 font-medium text-surface-700">Points</th>
              <th className="text-right px-4 py-3 font-medium text-surface-700">Events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {['punctuality', 'evaluation', 'tasks', 'reportTiming', 'teamProgress'].map((id) => {
              const row = b[id] || { points: 0, events: [] };
              return (
                <tr key={id}>
                  <td className="px-4 py-3 text-surface-800">{CAT_LABELS[id] || id}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.points >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {row.points > 0 ? '+' : ''}
                    {row.points}
                  </td>
                  <td className="px-4 py-3 text-right text-surface-600 tabular-nums">{row.events?.length || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-surface-200 bg-surface-50/80 p-4 text-xs text-surface-600 space-y-2">
        <p className="font-semibold text-surface-800">Point rules (this period)</p>
        <ul className="list-disc ml-4 space-y-1">
          <li>Punctuality: {sc.punctuality?.onTime ?? 15} on time, {sc.punctuality?.late ?? -15} late (after {sc.punctuality?.graceMinutes ?? 5} min grace).</li>
          <li>Evaluation: {sc.evaluation?.good ?? 20} if ≥ {sc.evaluation?.minYesOf || '9/11'} Yes; otherwise {sc.evaluation?.bad ?? -20}.</li>
          <li>Tasks: {sc.tasks?.onTime ?? 30} completed on/before due; {sc.tasks?.lateOrOverdue ?? -30} late completion or still overdue.</li>
          <li>Report hand-in: {sc.reportHandIn?.onTime ?? 50} by {sc.reportHandIn?.by || 'shift end + 15 min'}; {sc.reportHandIn?.late ?? -50} otherwise.</li>
          <li>
            Team progress: +{sc.teamProgress?.objectiveAchieved ?? 15} per achieved objective (credited); management ratings use (rating − {sc.teamProgress?.ratingNeutral ?? 3}) ×{' '}
            {sc.teamProgress?.ratingMultiplier ?? 5} (daily/weekly/monthly entries in the window).
          </li>
        </ul>
      </div>

      {['punctuality', 'evaluation', 'tasks', 'reportTiming', 'teamProgress'].map((id) => {
        const evs = (b[id] && b[id].events) || [];
        if (!evs.length) return null;
        return (
          <div key={`d-${id}`} className="rounded-xl border border-surface-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-surface-900 mb-2">{CAT_LABELS[id]} — detail</h3>
            <ul className="text-xs text-surface-600 space-y-1 max-h-48 overflow-y-auto">
              {evs.slice(0, 40).map((ev, i) => (
                <li key={i} className="font-mono tabular-nums">
                  <span className={ev.points >= 0 ? 'text-emerald-700' : 'text-red-600'}>{ev.points > 0 ? '+' : ''}{ev.points}</span>
                  {' · '}
                  {ev.detail}
                  {ev.work_date && ` · ${ev.work_date}`}
                  {ev.task_id && ` · task`}
                  {ev.report_id && ` · report`}
                </li>
              ))}
              {evs.length > 40 && <li className="text-surface-400">… {evs.length - 40} more</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
