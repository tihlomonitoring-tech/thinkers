/** Compact row showing a picked map point with clear / re-pick actions. */
export default function PickedPointRow({
  label,
  color = '#2563eb',
  coords,
  active,
  onPick,
  onClear,
}) {
  const hasPoint = coords?.lat != null && coords?.lng != null;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
        active ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/30' : 'border-surface-200 dark:border-surface-700'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-surface-800 dark:text-surface-100">{label}</p>
          {hasPoint ? (
            <p className="text-[10px] font-mono text-surface-500 tabular-nums truncate">
              {Number(coords.lat).toFixed(6)}, {Number(coords.lng).toFixed(6)}
            </p>
          ) : (
            <p className="text-[10px] text-surface-400">Not set — pick on map or search</p>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onPick}
          className={`text-[10px] px-2 py-1 rounded-md border ${
            active ? 'border-brand-500 text-brand-800' : 'border-surface-300 text-surface-600 hover:bg-surface-50'
          }`}
        >
          {active ? 'Click map…' : hasPoint ? 'Re-pick' : 'Pick'}
        </button>
        {hasPoint && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] px-2 py-1 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
