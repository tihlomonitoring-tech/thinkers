import { countActiveSearchFilters } from '../lib/advancedColumnSearch.js';

const inputClass =
  'w-full rounded-lg border border-surface-200 px-2.5 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950 focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400';

/**
 * Collapsible advanced search: global query + per-column filters.
 * @param {{ key: string, label: string }[]} columns
 */
export default function AdvancedColumnSearchBar({
  columns,
  columnValues,
  onColumnChange,
  globalQuery,
  onGlobalQueryChange,
  expanded,
  onToggleExpanded,
  onClear,
  resultCount,
  totalCount,
  className = '',
}) {
  const activeCount = countActiveSearchFilters(columnValues, globalQuery);

  return (
    <div className={`rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-surface-100 dark:border-surface-800">
        <div className="flex-1 min-w-[200px] flex items-center gap-2">
          <svg className="w-4 h-4 text-surface-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={globalQuery}
            onChange={(e) => onGlobalQueryChange(e.target.value)}
            placeholder="Search all columns…"
            className={`${inputClass} border-0 shadow-none focus:ring-0 px-0`}
          />
        </div>
        <button
          type="button"
          onClick={onToggleExpanded}
          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
            expanded || activeCount > 0
              ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
              : 'border-surface-200 text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300'
          }`}
        >
          Advanced{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="text-xs font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 px-2 py-1.5">
            Clear
          </button>
        )}
        {resultCount != null && totalCount != null && (
          <span className="text-xs text-surface-500 tabular-nums">
            {resultCount} of {totalCount}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 bg-surface-50/60 dark:bg-surface-950/40">
          {columns.map((col) => (
            <label key={col.key} className="block text-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 block mb-1">{col.label}</span>
              <input
                type="search"
                value={columnValues[col.key] || ''}
                onChange={(e) => onColumnChange(col.key, e.target.value)}
                placeholder={`Filter ${col.label.toLowerCase()}…`}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
