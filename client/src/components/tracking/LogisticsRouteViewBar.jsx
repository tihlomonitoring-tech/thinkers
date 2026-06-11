import { useEffect, useMemo, useRef, useState } from 'react';
import LogisticsArchivePanel from './LogisticsArchivePanel.jsx';
import {
  ALTERNATE_INTERVALS,
  ALTERNATE_MODES,
  UNASSIGNED_ROUTE_ID,
  findRouteSummary,
  pickNextAlternateRoute,
} from '../../lib/logisticsActivityRouteView.js';

function priorityTone(score, actionNeeded, alerts) {
  if (actionNeeded > 0) return 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-700';
  if (alerts > 0) return 'border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-800';
  if (score >= 20) return 'border-brand-300 bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100 dark:border-brand-700';
  if (score > 0) return 'border-surface-300 bg-surface-50 text-surface-800 dark:bg-surface-900 dark:text-surface-200 dark:border-surface-600';
  return 'border-surface-200 bg-white text-surface-500 dark:bg-surface-900 dark:text-surface-400 dark:border-surface-700 opacity-70';
}

export default function LogisticsRouteViewBar({
  routeSummaries,
  filterRouteId,
  onFilterRouteId,
  autoAlternate,
  onAutoAlternate,
  alternateMode,
  onAlternateMode,
  intervalSec,
  onIntervalSec,
  autoPaused,
  onResumeAuto,
  archived,
  onToggleArchived,
  persistPrefs,
}) {
  const [countdown, setCountdown] = useState(intervalSec);
  const tickRef = useRef(null);

  const activeSummaries = useMemo(
    () => (routeSummaries || []).filter((s) => s.total > 0),
    [routeSummaries]
  );

  const focused = useMemo(
    () => (filterRouteId && filterRouteId !== 'all' ? findRouteSummary(routeSummaries, filterRouteId) : null),
    [routeSummaries, filterRouteId]
  );

  useEffect(() => {
    if (!autoAlternate || autoPaused || filterRouteId === 'all') {
      setCountdown(intervalSec);
      return undefined;
    }
    setCountdown(intervalSec);
    tickRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) return intervalSec;
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [autoAlternate, autoPaused, filterRouteId, intervalSec]);

  const persist = (patch) => {
    persistPrefs?.(patch);
  };

  const totalActive = (routeSummaries || []).reduce((n, s) => n + s.total, 0);
  const routeSummaryLine = useMemo(() => {
    const count = filterRouteId === 'all' ? totalActive : (focused?.total ?? 0);
    const parts = [];
    parts.push(filterRouteId === 'all' ? 'All routes' : (focused?.route_name || 'Route filter'));
    parts.push(`${count} truck${count === 1 ? '' : 's'}`);
    if (autoAlternate) parts.push(autoPaused ? 'auto paused' : 'auto-alternate on');
    return parts.join(' · ');
  }, [filterRouteId, focused, totalActive, autoAlternate, autoPaused]);

  return (
    <LogisticsArchivePanel
      title="Route view"
      hint="Filter the board by corridor, or enable auto-alternate to rotate through routes intelligently."
      archived={archived}
      onToggleArchived={onToggleArchived}
      summary={routeSummaryLine}
    >
      <div className="flex flex-wrap items-center justify-end gap-2 -mt-1">
          <label className="inline-flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
              checked={autoAlternate}
              onChange={(e) => {
                onAutoAlternate(e.target.checked);
                persist({ autoAlternate: e.target.checked });
              }}
            />
            Auto-alternate
          </label>
          {autoAlternate && (
            <>
              <select
                value={alternateMode}
                onChange={(e) => {
                  onAlternateMode(e.target.value);
                  persist({ alternateMode: e.target.value });
                }}
                className="rounded-lg border border-surface-200 dark:border-surface-700 px-2 py-1 text-xs bg-white dark:bg-surface-950"
                title={ALTERNATE_MODES.find((m) => m.id === alternateMode)?.hint}
              >
                {ALTERNATE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <select
                value={intervalSec}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onIntervalSec(v);
                  persist({ intervalSec: v });
                }}
                className="rounded-lg border border-surface-200 dark:border-surface-700 px-2 py-1 text-xs bg-white dark:bg-surface-950"
              >
                {ALTERNATE_INTERVALS.map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            </>
          )}
        </div>

      {autoAlternate && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {autoPaused ? (
            <>
              <span className="text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/50 px-2 py-1 rounded-full">
                Auto-alternate paused — manual route selected
              </span>
              <button
                type="button"
                onClick={onResumeAuto}
                className="px-2 py-1 rounded-md border border-brand-300 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
              >
                Resume rotation
              </button>
            </>
          ) : (
            <span className="text-brand-800 dark:text-brand-200 bg-brand-100 dark:bg-brand-950/50 px-2 py-1 rounded-full inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
              {ALTERNATE_MODES.find((m) => m.id === alternateMode)?.label}
              {filterRouteId !== 'all' && countdown > 0 && (
                <span className="tabular-nums opacity-80">· next in {countdown}s</span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onFilterRouteId('all');
            persist({ filterRouteId: 'all' });
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filterRouteId === 'all'
              ? 'bg-brand-600 text-white border-brand-600'
              : 'border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'
          }`}
        >
          All routes
          <span className="ml-1.5 opacity-80 tabular-nums">
            {(routeSummaries || []).reduce((n, s) => n + s.total, 0)}
          </span>
        </button>
        {(routeSummaries || []).map((s) => {
          const active = filterRouteId === s.route_id;
          const tone = priorityTone(s.priority_score, s.action_needed, s.alerts);
          return (
            <button
              key={s.route_id}
              type="button"
              onClick={() => {
                onFilterRouteId(s.route_id);
                persist({ filterRouteId: s.route_id });
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all max-w-[220px] truncate ${
                active ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-surface-950 ' + tone : tone + ' hover:brightness-95'
              }`}
              title={s.priority_reason || s.route_name}
            >
              {s.route_name}
              <span className="ml-1.5 tabular-nums font-bold">{s.total}</span>
              {s.action_needed > 0 && (
                <span className="ml-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">!</span>
              )}
            </button>
          );
        })}
      </div>

      {focused && (
        <div className="rounded-lg border border-brand-200/80 dark:border-brand-800/60 bg-brand-50/40 dark:bg-brand-950/20 px-3 py-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{focused.route_name}</p>
              <p className="text-xs text-surface-600 dark:text-surface-400 truncate">
                {focused.loading_address || '—'} → {focused.destination_address || '—'}
              </p>
              {focused.priority_reason && (
                <p className="text-[10px] text-brand-700 dark:text-brand-300 mt-1">{focused.priority_reason}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {[
                ['Sch', focused.scheduled, 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'],
                ['Load', focused.at_loading, 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'],
                ['Enr', focused.enroute, 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'],
                ['Dest', focused.at_destination, 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200'],
              ].map(([label, count, cls]) => (
                <span key={label} className={`px-1.5 py-0.5 rounded tabular-nums ${cls}`}>
                  {label} {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!activeSummaries.length && (
        <p className="text-xs text-surface-500">No active routes on the board — schedule a truck to begin.</p>
      )}
    </LogisticsArchivePanel>
  );
}

export { UNASSIGNED_ROUTE_ID, pickNextAlternateRoute };
