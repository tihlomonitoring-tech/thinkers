import { routeOptionStyle } from '../../lib/routeOptionColors.js';

export default function AlternativeRoutesPanel({
  preview,
  corridorManual,
  onSetPrimary,
  onToggleOption,
  onIncludeAll,
  onZoomRoute,
  onZoomAll,
}) {
  if (!preview?.alternatives?.length) return null;

  const primaryIndex = preview.selected_route_index ?? 0;
  const altCorridors = preview.alt_corridors || {};
  const altCount = preview.alternatives.length;
  const includedCount = preview.alternatives.filter((_, i) => altCorridors[i]?.enabled).length;

  return (
    <div className="rounded-xl border border-brand-200 dark:border-brand-900/50 bg-gradient-to-br from-brand-50/60 to-white dark:from-brand-950/20 dark:to-surface-900 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            Route options — {altCount} road{altCount === 1 ? '' : 's'} found
          </h3>
          <p className="text-[11px] text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
            All routes are shown on the map with coloured lines (A, B, C). Choose one as the <strong>primary</strong> deviation corridor,
            then add any others as <strong>approved route options</strong> so trucks on those roads are allowed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={onZoomAll} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-300 hover:bg-white dark:hover:bg-surface-800">
            Show all on map
          </button>
          {altCount > 1 && includedCount < altCount && (
            <button type="button" onClick={onIncludeAll} className="text-xs px-2.5 py-1.5 rounded-md border border-cyan-600 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/30">
              Add all as options
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {preview.alternatives.map((alt, i) => {
          const style = routeOptionStyle(i);
          const isPrimary = i === primaryIndex;
          const included = !!altCorridors[i]?.enabled;
          const isManual = isPrimary ? corridorManual : altCorridors[i]?.corridor_manual;

          return (
            <div
              key={alt.index ?? i}
              className={`rounded-lg border p-3 flex flex-col gap-2 transition-shadow ${
                isPrimary
                  ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/40 ring-1 ring-brand-400/50'
                  : included
                    ? 'border-cyan-400/70 bg-cyan-50/50 dark:bg-cyan-950/20'
                    : 'border-surface-200 dark:border-surface-700 bg-white/80 dark:bg-surface-900/50'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className={`shrink-0 w-8 h-8 rounded-full ${style.chip} text-white text-sm font-bold flex items-center justify-center shadow-sm`}>
                  {style.letter}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{style.label}</p>
                  <p className="text-xs text-surface-600 dark:text-surface-400">
                    ~{alt.distance_km ?? '—'} km · ~{alt.duration_min ?? '—'} min
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {isPrimary && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-600 text-white">
                        Primary
                      </span>
                    )}
                    {included && !isPrimary && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-600 text-white">
                        Approved option
                      </span>
                    )}
                    {!included && !isPrimary && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-600">
                        Preview only
                      </span>
                    )}
                    {isManual && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Adjusted
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-auto pt-1 border-t border-surface-200/80 dark:border-surface-700/80">
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onSetPrimary(i)}
                    className="text-[11px] px-2 py-1 rounded border border-brand-400 text-brand-800 dark:text-brand-300 hover:bg-brand-100/80 dark:hover:bg-brand-950/50"
                  >
                    Set primary
                  </button>
                )}
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onToggleOption(i)}
                    className={`text-[11px] px-2 py-1 rounded border ${
                      included
                        ? 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:text-rose-300'
                        : 'border-cyan-500 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/40'
                    }`}
                  >
                    {included ? 'Remove option' : 'Add as option'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onZoomRoute(i)}
                  className="text-[11px] px-2 py-1 rounded border border-surface-300 text-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800 ml-auto"
                >
                  Zoom
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {altCount === 1 && (
        <p className="text-xs text-surface-500 italic">
          Only one driving route was found between these points. Try different A/B coordinates if you expected alternatives.
        </p>
      )}
    </div>
  );
}
