function Chevron({ open, className = '' }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

/** Collapsible panel — archived (collapsed) by default for a cleaner activity board. */
export default function LogisticsArchivePanel({
  title,
  hint,
  archived,
  onToggleArchived,
  summary,
  children,
  className = 'border border-surface-200 dark:border-surface-800',
  contentClassName = 'p-4 pt-0 space-y-3',
}) {
  const toggle = () => onToggleArchived(!archived);

  return (
    <section className={`app-glass-card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={toggle}
          className="min-w-0 flex-1 flex items-start gap-2 text-left group rounded-md -ml-1 pl-1 py-0.5 hover:bg-surface-50/80 dark:hover:bg-surface-900/40"
          aria-expanded={!archived}
        >
          <Chevron
            open={!archived}
            className="mt-0.5 text-surface-400 group-hover:text-surface-600 dark:group-hover:text-surface-300"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {title}
            </p>
            {archived && summary ? (
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5 truncate">{summary}</p>
            ) : null}
            {!archived && hint ? (
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5 max-w-2xl">{hint}</p>
            ) : null}
          </div>
        </button>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 font-medium"
        >
          {archived ? 'Show' : 'Archive'}
        </button>
      </div>
      {!archived && <div className={contentClassName}>{children}</div>}
    </section>
  );
}
