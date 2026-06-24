import { useMemo, useState } from 'react';
import InfoHint from './InfoHint.jsx';
import {
  SCORE_CATEGORIES,
  CAT_LABELS,
  CAT_LABELS_SHORT,
  describeScoreEvent,
  ScoringRulesPanel,
} from '../lib/productivityScoreDisplay.jsx';
import ProductivityScoreExportButtons from './ProductivityScoreExportButtons.jsx';

function PointsBadge({ value, size = 'md' }) {
  const n = Number(value) || 0;
  const cls = size === 'lg'
    ? 'text-2xl font-bold tabular-nums'
    : 'text-sm font-semibold tabular-nums';
  const color = n >= 0 ? 'text-emerald-700' : 'text-red-600';
  return (
    <span className={`${cls} ${color}`}>
      {n > 0 ? '+' : ''}
      {n}
    </span>
  );
}

function CategoryBreakdownCard({ categoryId, breakdown, defaultOpen = false }) {
  const row = breakdown?.[categoryId] || { points: 0, events: [] };
  const events = row.events || [];
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-50/80 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-surface-900">{CAT_LABELS[categoryId]}</p>
          <p className="text-xs text-surface-500 mt-0.5">{events.length} contributing event{events.length === 1 ? '' : 's'}</p>
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
        <div className="border-t border-surface-100 px-4 py-3 bg-surface-50/40">
          {events.length === 0 ? (
            <p className="text-xs text-surface-500">No events in this category for the selected window.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {events.map((ev, i) => (
                <li
                  key={`${categoryId}-${i}`}
                  className="text-xs text-surface-700 leading-snug rounded-lg bg-white border border-surface-100 px-3 py-2"
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

export default function EmployeeProductivityScoreBreakdownTab({ data, loading, onReload, windowDays, onWindowDaysChange, onError }) {
  const people = data?.people || [];
  const [selectedUserId, setSelectedUserId] = useState('');

  const selected = useMemo(() => {
    if (!selectedUserId) return people[0] || null;
    return people.find((p) => p.userId === selectedUserId) || people[0] || null;
  }, [people, selectedUserId]);

  const breakdown = selected?.breakdown || {};

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-surface-100 rounded w-1/2 animate-pulse" />
        <div className="h-48 bg-surface-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!people.length) {
    return (
      <div className="rounded-xl border border-surface-200 bg-surface-50 p-6 text-sm text-surface-600">
        No Command Centre team members with productivity data in this window yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900">Score breakdown</h2>
          <InfoHint
            title="Detailed score analysis"
            text="See every event that added or subtracted points for each employee: clock-ins, evaluations, tasks, report submissions, team objectives, management ratings, team-leader daily pulse, and performance evaluations. Totals match the overview roster."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm flex items-center gap-2">
            <span className="text-xs text-surface-500">Window</span>
            <select
              value={windowDays}
              onChange={(e) => onWindowDaysChange(Number(e.target.value))}
              className="rounded-lg border border-surface-200 px-2 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <ProductivityScoreExportButtons
            data={data}
            selectedPerson={selected}
            disabled={loading}
            onError={onError}
            compact
          />
          <button
            type="button"
            onClick={onReload}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 px-2 py-1.5"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm block min-w-[220px] flex-1 max-w-md">
          <span className="text-xs font-medium text-surface-500 block mb-1">Employee</span>
          <select
            value={selected?.userId || ''}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
          >
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.full_name} · {p.total} pts
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white px-5 py-3 shadow-sm">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Total score</p>
            <PointsBadge value={selected.total} size="lg" />
            <p className="text-xs text-surface-500 mt-1">
              Team avg <span className="font-semibold tabular-nums">{data?.groupAverage ?? '—'}</span>
            </p>
          </div>
        )}
      </div>

      {selected && (
        <>
          <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80">
              <p className="font-semibold text-surface-900">{selected.full_name}</p>
              <p className="text-xs text-surface-500">{selected.email}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-surface-700">Category</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-700">Points</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-700">Events</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-700">Share of total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {SCORE_CATEGORIES.map((id) => {
                  const row = breakdown[id] || { points: 0, events: [] };
                  const share = selected.total !== 0
                    ? Math.round((row.points / selected.total) * 1000) / 10
                    : 0;
                  return (
                    <tr key={id}>
                      <td className="px-4 py-2 text-surface-800">{CAT_LABELS_SHORT[id]}</td>
                      <td className="px-4 py-2 text-right">
                        <PointsBadge value={row.points} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-surface-600">{row.events?.length || 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-surface-500">
                        {selected.total !== 0 ? `${share}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-surface-50/80 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">
                    <PointsBadge value={selected.total} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-surface-600">
                    {SCORE_CATEGORIES.reduce((n, id) => n + (breakdown[id]?.events?.length || 0), 0)}
                  </td>
                  <td className="px-4 py-2 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-surface-900 mb-3">Contributing events by category</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {SCORE_CATEGORIES.map((id, i) => (
                <CategoryBreakdownCard
                  key={id}
                  categoryId={id}
                  breakdown={breakdown}
                  defaultOpen={i < 2 && (breakdown[id]?.events?.length || 0) > 0}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <ScoringRulesPanel scoring={data?.scoring} />

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80">
          <h3 className="font-semibold text-surface-900 text-sm">All employees — category totals</h3>
          <p className="text-xs text-surface-500 mt-0.5">Compare what drove each person&apos;s score at a glance</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-surface-700">Employee</th>
                <th className="text-right px-4 py-2 font-medium text-surface-700">Total</th>
                {SCORE_CATEGORIES.map((id) => (
                  <th key={id} className="text-right px-4 py-2 font-medium text-surface-700 whitespace-nowrap">
                    {CAT_LABELS_SHORT[id]}
                  </th>
                ))}
                <th className="text-right px-4 py-2 font-medium text-surface-700">Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {people.map((p) => {
                const eventCount = SCORE_CATEGORIES.reduce(
                  (n, id) => n + (p.breakdown?.[id]?.events?.length || 0),
                  0
                );
                const isSelected = p.userId === selected?.userId;
                return (
                  <tr
                    key={p.userId}
                    className={`cursor-pointer hover:bg-brand-50/50 ${isSelected ? 'bg-brand-50/80' : ''}`}
                    onClick={() => setSelectedUserId(p.userId)}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium text-surface-900">{p.full_name}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <PointsBadge value={p.total} />
                    </td>
                    {SCORE_CATEGORIES.map((id) => {
                      const pts = p.breakdown?.[id]?.points ?? 0;
                      return (
                        <td
                          key={id}
                          className={`px-4 py-2 text-right tabular-nums text-xs ${pts >= 0 ? 'text-surface-700' : 'text-red-600'}`}
                        >
                          {pts > 0 ? '+' : ''}
                          {pts}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular-nums text-surface-500">{eventCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
