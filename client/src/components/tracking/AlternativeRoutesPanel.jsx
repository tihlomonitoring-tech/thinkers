import { formatRouteDistanceKm } from '../../lib/routeCorridorGeofence.js';
import { routeOptionStyle } from '../../lib/routeOptionColors.js';

export default function AlternativeRoutesPanel({
  preview,
  onSetPrimary,
  onToggleOption,
  onIncludeAll,
  onExcludeAll,
  onZoomRoute,
  onZoomAll,
  onRemoveManual,
  onStartPlotManual,
  systemRouteDistanceKm = null,
}) {
  if (!preview?.alternatives?.length) return null;

  const primaryIndex = preview.selected_route_index ?? 0;
  const altCorridors = preview.alt_corridors || {};
  const altCount = preview.alternatives.length;
  const manualCount = preview.alternatives.filter((a) => a.is_manual).length;
  const includedCount = preview.alternatives.filter((_, i) => altCorridors[i]?.enabled).length;

  return (
    <div className="rounded-xl border border-brand-200 dark:border-brand-900/50 bg-gradient-to-br from-brand-50/60 to-white dark:from-brand-950/20 dark:to-surface-900 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {altCount} route{altCount === 1 ? '' : 's'} — auto + custom
          </h3>
          <p className="text-[11px] text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
            All paths show on the map. Set a <strong>primary</strong> corridor, allow alternatives, or{' '}
            <strong>plot your own road</strong> on the map and add it here.
            {manualCount > 0 && (
              <span className="text-amber-700 dark:text-amber-400"> {manualCount} custom plotted.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={onStartPlotManual} className="text-xs px-2.5 py-1.5 rounded-md border border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200">
            + Plot custom route
          </button>
          <button type="button" onClick={onZoomAll} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-300 hover:bg-white dark:hover:bg-surface-800">
            Fit all on map
          </button>
          {includedCount < altCount && (
            <button type="button" onClick={onIncludeAll} className="text-xs px-2.5 py-1.5 rounded-md border border-cyan-600 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/30">
              Allow all
            </button>
          )}
          {includedCount > 1 && altCount > 1 && (
            <button type="button" onClick={onExcludeAll} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-300 text-surface-600 hover:bg-surface-50">
              Primary only
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {preview.alternatives.map((alt, i) => {
          const style = routeOptionStyle(i, alt);
          const isPrimary = i === primaryIndex;
          const included = !!altCorridors[i]?.enabled;

          return (
            <div
              key={alt.uid || `route-${i}`}
              role="button"
              tabIndex={0}
              onClick={() => onZoomRoute?.(i)}
              onKeyDown={(e) => { if (e.key === 'Enter') onZoomRoute?.(i); }}
              className={`rounded-lg border p-3 flex flex-col gap-2 cursor-pointer transition-shadow hover:shadow-md ${
                alt.is_manual
                  ? 'border-amber-400/80 bg-amber-50/60 dark:bg-amber-950/25'
                  : isPrimary
                    ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/40 ring-1 ring-brand-400/50'
                    : included
                      ? 'border-cyan-400/70 bg-cyan-50/50 dark:bg-cyan-950/20'
                      : 'border-surface-200 dark:border-surface-700 bg-white/80 dark:bg-surface-900/50 opacity-90'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`shrink-0 w-9 h-9 rounded-full ${style.chip} text-white text-sm font-bold flex items-center justify-center shadow-sm`}
                  style={{ boxShadow: `0 0 0 2px white, 0 0 0 4px ${style.line}` }}
                >
                  {alt.is_manual ? '✦' : style.letter}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{style.label}</p>
                  <p className="text-xs text-surface-600 dark:text-surface-400">
                    {formatRouteDistanceKm(alt.distance_km)} · ~{alt.duration_min ?? '—'} min
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {alt.is_manual && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-600 text-white">
                        Plotted
                      </span>
                    )}
                    {isPrimary && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-brand-600 text-white">
                        Primary
                      </span>
                    )}
                    {included && !isPrimary && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-cyan-600 text-white">
                        Allowed
                      </span>
                    )}
                    {!included && !isPrimary && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-500">
                        Not allowed
                      </span>
                    )}
                  </div>
                  {systemRouteDistanceKm != null && isPrimary && !alt.is_manual && (
                    <p className="text-[10px] text-surface-500 mt-1">
                      System route: {formatRouteDistanceKm(systemRouteDistanceKm)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-auto pt-1 border-t border-surface-200/80 dark:border-surface-700/80" onClick={(e) => e.stopPropagation()}>
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onSetPrimary(i)}
                    className="text-[11px] px-2 py-1 rounded border border-brand-400 text-brand-800 dark:text-brand-300 hover:bg-brand-100/80"
                  >
                    Set primary
                  </button>
                )}
                {alt.is_manual && (
                  <button
                    type="button"
                    onClick={() => onRemoveManual?.(i)}
                    className="text-[11px] px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                )}
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onToggleOption(i)}
                    className={`text-[11px] px-2 py-1 rounded border ml-auto ${
                      included
                        ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                        : 'border-cyan-500 text-cyan-800 hover:bg-cyan-50'
                    }`}
                  >
                    {included ? 'Disallow' : 'Allow trucks'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
