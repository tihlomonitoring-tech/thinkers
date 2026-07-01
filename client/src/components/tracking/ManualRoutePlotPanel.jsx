import { formatRouteDistanceKm } from '../../lib/routeCorridorGeofence.js';

export default function ManualRoutePlotPanel({
  active,
  editingRouteLabel = null,
  waypoints = [],
  snapPreview = null,
  snapping = false,
  label = '',
  onLabelChange,
  onStart,
  onCancel,
  onUndo,
  onClear,
  onSeedFromAB,
  onRemoveWaypoint,
  onInsertWaypointAfter,
  onUpdateWaypointCoords,
  onFinalize,
  finalizing = false,
  canSeedFromAB = false,
}) {
  if (!active && !onStart) return null;

  if (!active) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Plot custom alternative route</h3>
            <p className="text-[11px] text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
              Click points on the map <strong>in order</strong>, or click <strong>on a line segment</strong> to insert a waypoint between two points.
              Pan and zoom freely — use the <strong>crosshair</strong> and <strong>Place at crosshair</strong> for pin-point accuracy.
            </p>
          </div>
          <button
            type="button"
            onClick={onStart}
            className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700"
          >
            Start plotting route
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-surface-900 p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            {editingRouteLabel ? `Editing: ${editingRouteLabel}` : 'Plotting custom route — click the map'}
          </h3>
          <p className="text-[11px] text-surface-600 dark:text-surface-400 mt-1">
            Place waypoints in order. Click <strong>on a dashed segment</strong> to insert between two points.
            Drag markers to adjust. Edit coordinates below for precision.
            <kbd className="px-1 py-0.5 rounded bg-surface-200 text-[10px]">⌘Z</kbd> undo · <kbd className="px-1 py-0.5 rounded bg-surface-200 text-[10px]">Esc</kbd> cancel
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-white">
          Cancel
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold text-surface-500 uppercase tracking-wide">Route name (optional)</label>
          <input
            className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            placeholder="e.g. Quarry bypass via R34"
            value={label}
            onChange={(e) => onLabelChange?.(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          {canSeedFromAB && (
            <button type="button" onClick={onSeedFromAB} className="text-xs px-3 py-2 rounded-lg border border-brand-400 text-brand-800 hover:bg-brand-50">
              Use point A → B as start/end
            </button>
          )}
          <button type="button" onClick={onUndo} disabled={!waypoints.length} className="text-xs px-3 py-2 rounded-lg border disabled:opacity-40">
            Undo point
          </button>
          <button type="button" onClick={onClear} disabled={!waypoints.length} className="text-xs px-3 py-2 rounded-lg border disabled:opacity-40">
            Clear all
          </button>
        </div>
      </div>

      {waypoints.length > 0 && (
        <div className="rounded-lg border border-amber-200/80 dark:border-amber-900/40 bg-white/70 dark:bg-surface-900/50 p-3">
          <p className="text-[10px] font-semibold text-surface-500 mb-2">
            Waypoints ({waypoints.length})
            {snapPreview?.distance_km != null && (
              <span className="font-normal ml-2 text-amber-800 dark:text-amber-300">
                {snapping ? ' · Snapping to roads…' : ` · ${formatRouteDistanceKm(snapPreview.distance_km)} · ~${snapPreview.duration_min ?? '—'} min`}
              </span>
            )}
          </p>
          <ol className="max-h-48 overflow-y-auto space-y-2 text-[11px]">
            {waypoints.map((pt, i) => (
              <li key={`wp-${i}`} className="rounded-lg border border-surface-200/80 dark:border-surface-700 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-700">
                    {i + 1}.
                    {i === 0 && <span className="text-brand-600 font-normal ml-1">start</span>}
                    {i === waypoints.length - 1 && waypoints.length > 1 && <span className="text-emerald-600 font-normal ml-1">end</span>}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {i < waypoints.length - 1 && (
                      <button
                        type="button"
                        onClick={() => onInsertWaypointAfter?.(i)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-amber-400 text-amber-800 hover:bg-amber-50"
                        title="Insert waypoint between this point and the next"
                      >
                        + between
                      </button>
                    )}
                    {waypoints.length > 2 && (
                      <button type="button" onClick={() => onRemoveWaypoint?.(i)} className="text-[10px] text-rose-600 hover:underline">
                        remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="rounded border px-2 py-1 font-mono text-[10px] dark:bg-surface-950"
                    value={Number(pt.lat).toFixed(6)}
                    onChange={(e) => onUpdateWaypointCoords?.(i, e.target.value, pt.lng)}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    className="rounded border px-2 py-1 font-mono text-[10px] dark:bg-surface-950"
                    value={Number(pt.lng).toFixed(6)}
                    onChange={(e) => onUpdateWaypointCoords?.(i, pt.lat, e.target.value)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onFinalize}
          disabled={waypoints.length < 2 || finalizing || snapping}
          className="text-sm px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {finalizing
            ? (editingRouteLabel ? 'Saving route…' : 'Adding route…')
            : (editingRouteLabel ? 'Save edited route' : 'Add snapped route to list')}
        </button>
        {waypoints.length < 2 && (
          <span className="text-xs text-surface-500 self-center">Place at least 2 points on the map</span>
        )}
      </div>
    </div>
  );
}
