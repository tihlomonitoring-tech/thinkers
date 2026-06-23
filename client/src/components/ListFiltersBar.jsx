export const FILTER_INPUT_CLASS =
  'w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 shadow-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400';

export function FilterField({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-surface-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export default function ListFiltersBar({
  search,
  onSearch,
  searchPlaceholder,
  showAdvanced,
  onToggleAdvanced,
  activeCount,
  activePills = [],
  onClearAll,
  onClearSearch,
  resultSummary,
  refineTitle = 'Refine results',
  refineColumns = 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
  children,
  compact = false,
  embedded = false,
}) {
  const hasSearch = Boolean((search || '').trim());
  const hasAnyFilter = activeCount > 0 || hasSearch;

  const shellClass = embedded
    ? 'space-y-4'
    : `rounded-xl border border-surface-200 bg-gradient-to-b from-surface-50/90 to-white shadow-sm ${compact ? 'p-3 space-y-3' : 'p-4 space-y-4'}`;

  return (
    <div className={shellClass}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px] max-w-xl">
          <FilterField label="Search">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className={FILTER_INPUT_CLASS}
            />
          </FilterField>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          {onToggleAdvanced && (
            <button
              type="button"
              onClick={onToggleAdvanced}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showAdvanced
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-50'
              }`}
            >
              <span>Refine</span>
              {activeCount > 0 && (
                <span className="inline-flex min-w-[1.25rem] h-5 px-1.5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white tabular-nums">
                  {activeCount}
                </span>
              )}
            </button>
          )}
          {hasAnyFilter && onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="px-3.5 py-2 text-sm font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50 hover:text-surface-900"
            >
              Clear all
            </button>
          )}
        </div>
        {resultSummary && (
          <p className="text-xs text-surface-500 ml-auto pb-2 tabular-nums">{resultSummary}</p>
        )}
      </div>

      {activePills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 mr-1">Active</span>
          {activePills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={pill.onClear}
              className="inline-flex items-center gap-1.5 max-w-[260px] rounded-full border border-brand-200 bg-brand-50/80 px-2.5 py-1 text-xs font-medium text-brand-900 hover:bg-brand-100"
              title={`Remove filter: ${pill.label}`}
            >
              <span className="truncate">{pill.label}</span>
              <span className="text-brand-500 shrink-0" aria-hidden>×</span>
            </button>
          ))}
          {hasSearch && onClearSearch && (
            <button
              type="button"
              onClick={onClearSearch}
              className="inline-flex items-center gap-1.5 rounded-full border border-surface-200 bg-white px-2.5 py-1 text-xs font-medium text-surface-600 hover:bg-surface-50"
            >
              Clear search
              <span className="text-surface-400" aria-hidden>×</span>
            </button>
          )}
        </div>
      )}

      {showAdvanced && children && (
        <div className="pt-4 border-t border-surface-200/80">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-500 mb-3">{refineTitle}</p>
          <div className={`grid gap-4 ${refineColumns}`}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
