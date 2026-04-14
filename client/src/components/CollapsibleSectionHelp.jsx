/**
 * Info (circle-i) next to a page section heading; expands help text.
 * Used across Command Centre tabs (same pattern as Truck update records).
 */
export function CollapsibleSectionHelp({ title, titleClassName, open, setOpen, topic, children }) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <h2 className={`${titleClassName} flex-1`}>{title}</h2>
        <button
          type="button"
          className={`shrink-0 mt-0.5 p-1.5 rounded-full border transition-colors ${
            open
              ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
              : 'border-transparent text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:text-brand-400 dark:hover:bg-surface-800'
          }`}
          aria-expanded={open}
          aria-label={open ? `Hide ${topic}` : `Show ${topic}`}
          title={`About: ${topic}`}
          onClick={() => setOpen((v) => !v)}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 p-3 text-sm text-surface-600 dark:text-surface-300 max-w-3xl leading-relaxed shadow-sm">
          {children}
        </div>
      )}
    </div>
  );
}
