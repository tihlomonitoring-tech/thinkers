import { useState, useEffect } from 'react';
import { shiftScore } from '../api';
import InfoHint from './InfoHint.jsx';

const CAT_LABELS = {
  punctuality: 'Clock-in',
  evaluation: 'Evaluations',
  tasks: 'Tasks',
  reportTiming: 'Report timing',
  teamProgress: 'Team progress',
};

export default function EmployeeProductivityScoreSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    setLoading(true);
    shiftScore
      .tenant({ days: 30 })
      .then((r) => {
        if (!c) setData(r);
      })
      .catch((e) => {
        if (!c) setError(e?.message || 'Could not load tenant scores');
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
      <div className="space-y-4">
        <div className="h-10 bg-surface-100 rounded w-1/2 animate-pulse" />
        <div className="h-64 bg-surface-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm p-4">{error}</div>;
  }

  const people = data?.people || [];
  const top = people.slice(0, 5);
  const bottom = [...people].sort((a, b) => a.total - b.total).slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Employee productivity score</h1>
          <InfoHint
            title="Management insights"
            text="Scores aggregate Command Centre team members only (page or tab access). Each row is a rolling total from clock punctuality, evaluations on authored reports, assigned tasks, shift-report submission timing, and team progress (achieved measurable objectives plus management 1–5 ratings). Use this to spot coaching opportunities — not as the sole measure of performance."
          />
        </div>
        <p className="text-sm text-surface-500">
          {data?.fromYmd} → {data?.toYmd} · {data?.windowDays} days · {data?.ccUserCount} CC team
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Team average</p>
          <p className="text-2xl font-bold text-indigo-700 tabular-nums mt-1">{data?.groupAverage ?? 0}</p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Median</p>
          <p className="text-2xl font-bold text-surface-900 tabular-nums mt-1">{data?.median ?? 0}</p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Range</p>
          <p className="text-lg font-bold text-surface-900 tabular-nums mt-1">
            {data?.min ?? 0} <span className="text-surface-400 font-normal">to</span> {data?.max ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Avg / category</p>
          <div className="text-xs text-surface-700 mt-2 space-y-0.5 tabular-nums">
            <div>P: {data?.componentAverages?.punctuality ?? 0}</div>
            <div>E: {data?.componentAverages?.evaluation ?? 0}</div>
            <div>T: {data?.componentAverages?.tasks ?? 0}</div>
            <div>R: {data?.componentAverages?.reportTiming ?? 0}</div>
            <div>Tm: {data?.componentAverages?.teamProgress ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <h2 className="text-sm font-semibold text-emerald-900 mb-2">Top momentum</h2>
          <ol className="text-sm space-y-2">
            {top.map((p, i) => (
              <li key={p.userId} className="flex justify-between gap-2">
                <span className="text-surface-800">
                  {i + 1}. {p.full_name}
                </span>
                <span className="font-mono font-semibold text-emerald-800 tabular-nums">{p.total}</span>
              </li>
            ))}
            {!top.length && <li className="text-surface-500">No data yet.</li>}
          </ol>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-sm font-semibold text-amber-900 mb-2">Attention band</h2>
          <ol className="text-sm space-y-2">
            {bottom.map((p, i) => (
              <li key={p.userId} className="flex justify-between gap-2">
                <span className="text-surface-800">
                  {i + 1}. {p.full_name}
                </span>
                <span className="font-mono font-semibold text-amber-900 tabular-nums">{p.total}</span>
              </li>
            ))}
            {!bottom.length && <li className="text-surface-500">No data yet.</li>}
          </ol>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80">
          <h2 className="font-semibold text-surface-900">Full roster</h2>
          <p className="text-xs text-surface-500 mt-0.5">Per-person totals and category points</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-surface-700">Employee</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700">Total</th>
                {Object.keys(CAT_LABELS).map((k) => (
                  <th key={k} className="text-right px-4 py-2 font-medium text-surface-700 whitespace-nowrap">
                    {CAT_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {people.map((p) => (
                <tr key={p.userId} className="hover:bg-surface-50/80">
                  <td className="px-4 py-2">
                    <span className="font-medium text-surface-900">{p.full_name}</span>
                    {p.email && <span className="block text-xs text-surface-500 truncate max-w-[220px]">{p.email}</span>}
                  </td>
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${p.total >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {p.total}
                  </td>
                  {Object.keys(CAT_LABELS).map((k) => {
                    const pts = p.breakdown?.[k]?.points ?? 0;
                    return (
                      <td key={k} className={`px-4 py-2 text-right tabular-nums text-xs ${pts >= 0 ? 'text-surface-700' : 'text-red-600'}`}>
                        {pts}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
