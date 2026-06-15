import { useEffect, useMemo, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import { colorMetaJson } from '../../lib/geofenceStyle.js';
import { serializeSimplePolygon } from '../../lib/routeCorridorGeofence.js';
import { clampRadius, MAX_RADIUS_M, MIN_RADIUS_M } from './geofenceCircleDraw.jsx';
import GeofenceColorPicker from './GeofenceColorPicker.jsx';

const MANUAL_LEG_OPTIONS = [
  { value: 'origin', label: 'Origin / loading yard', fence_type: 'deviation', alert_on_entry: false, alert_on_exit: true, defaultColor: '#2563eb' },
  { value: 'destination', label: 'Destination / offloading', fence_type: 'destination', alert_on_entry: false, alert_on_exit: true, defaultColor: '#059669' },
  { value: 'alert', label: 'Alert / hazard zone', fence_type: 'hazard', alert_on_entry: true, alert_on_exit: false, defaultColor: '#e11d48' },
  { value: 'custom', label: 'Custom monitoring zone', fence_type: 'deviation', alert_on_entry: true, alert_on_exit: true, defaultColor: '#f59e0b' },
];

const RADIUS_PRESETS = [
  { label: '100 m', value: 100 },
  { label: '250 m', value: 250 },
  { label: '500 m', value: 500 },
  { label: '1 km', value: 1000 },
  { label: '2 km', value: 2000 },
  { label: '5 km', value: 5000 },
];

const DRAW_MODES = [
  { id: 'circle', label: 'Circle', hint: 'Press & drag from centre outward' },
  { id: 'polygon', label: 'Polygon', hint: 'Click vertices — double-click or Enter to finish' },
  { id: 'freehand', label: 'Freehand', hint: 'Hold and drag to sketch — auto-smoothed on release' },
];

function formatArea(radius_m) {
  const area = Math.PI * radius_m * radius_m;
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(2)} km²`;
  return `${Math.round(area).toLocaleString()} m²`;
}

function polygonAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const j = (i + 1) % ring.length;
    area += (rad(ring[j].lng) - rad(ring[i].lng)) * (2 + Math.sin(rad(ring[i].lat)) + Math.sin(rad(ring[j].lat)));
  }
  return Math.abs((area * R * R) / 2);
}

export default function ManualGeofencePanel({
  routes,
  drawMode,
  onDrawModeChange,
  circle,
  onCircleChange,
  circlePreview,
  polygonPoints,
  onPolygonPointsChange,
  onPolygonUndo,
  onPolygonRedo,
  onPolygonClear,
  freehandPreview,
  polygonDraft,
  onPolygonDraftChange,
  color,
  onColorChange,
  setError,
  onSaved,
  onFitMap,
}) {
  const [form, setForm] = useState({
    name: '',
    leg: 'origin',
    contractor_route_id: '',
    alert_on_entry: false,
    alert_on_exit: true,
  });
  const [placeHint, setPlaceHint] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  const legMeta = useMemo(
    () => MANUAL_LEG_OPTIONS.find((o) => o.value === form.leg) || MANUAL_LEG_OPTIONS[0],
    [form.leg]
  );

  const hasCircleDraft = !!circle?.lat && !!circle?.lng && !!circle?.radius_m;
  const hasPolygonDraft = polygonDraft?.ring?.length >= 3;
  const isDrawing = !!drawMode && !hasCircleDraft && !hasPolygonDraft;
  const activeMode = DRAW_MODES.find((m) => m.id === drawMode);

  useEffect(() => {
    if (!color && legMeta.defaultColor) onColorChange?.(legMeta.defaultColor);
  }, [form.leg, legMeta.defaultColor]);

  const lookupPlace = async (lat, lng) => {
    try {
      const res = await trackingApi.map.locationContext(lat, lng);
      const ctx = res?.context;
      if (!ctx) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const parts = [ctx.town || ctx.city, ctx.suburb, ctx.road_name || ctx.street].filter(Boolean);
      return parts.join(' · ') || ctx.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  };

  useEffect(() => {
    if (nameTouched) return;
    let cancelled = false;
    const lat = hasCircleDraft ? circle.lat : hasPolygonDraft ? polygonDraft.ring[0].lat : null;
    const lng = hasCircleDraft ? circle.lng : hasPolygonDraft ? polygonDraft.ring[0].lng : null;
    if (lat == null) return undefined;
    lookupPlace(lat, lng).then((hint) => {
      if (cancelled) return;
      setPlaceHint(hint);
      if (!form.name.trim()) {
        const label = hint.split(' · ')[0];
        setForm((f) => ({ ...f, name: label ? `Zone — ${label}` : '' }));
      }
    });
    return () => { cancelled = true; };
  }, [hasCircleDraft, hasPolygonDraft, circle?.lat, circle?.lng, polygonDraft?.ring, nameTouched, form.name]);

  const applyLeg = (leg) => {
    const meta = MANUAL_LEG_OPTIONS.find((o) => o.value === leg) || MANUAL_LEG_OPTIONS[0];
    setForm((f) => ({
      ...f,
      leg,
      alert_on_entry: meta.alert_on_entry,
      alert_on_exit: meta.alert_on_exit,
    }));
    onColorChange?.(meta.defaultColor);
  };

  const startDraw = (mode) => {
    setError('');
    onCircleChange?.(null);
    onPolygonDraftChange?.(null);
    onPolygonPointsChange?.([]);
    setPlaceHint('');
    setNameTouched(false);
    onDrawModeChange?.(mode);
  };

  const cancelAll = () => {
    onCircleChange?.(null);
    onPolygonDraftChange?.(null);
    onPolygonPointsChange?.([]);
    onDrawModeChange?.(null);
    setForm((f) => ({ ...f, name: '' }));
    setPlaceHint('');
    setNameTouched(false);
  };

  const undoPolygonPoint = () => {
    onPolygonUndo?.();
  };

  const redoPolygonPoint = () => {
    onPolygonRedo?.();
  };

  const clearAllPolygonPoints = () => {
    onPolygonClear?.();
  };

  const save = async (e) => {
    e.preventDefault();
    if (!hasCircleDraft && !hasPolygonDraft) {
      setError('Draw a shape on the map first.');
      return;
    }
    if (!form.name.trim()) {
      setError('Name your geofence.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const base = {
        name: form.name.trim(),
        fence_type: legMeta.fence_type,
        leg: form.leg === 'custom' ? null : form.leg,
        contractor_route_id: form.contractor_route_id || null,
        alert_on_entry: form.alert_on_entry,
        alert_on_exit: form.alert_on_exit,
      };
      if (hasCircleDraft) {
        await trackingApi.geofences.create({
          ...base,
          center_lat: circle.lat,
          center_lng: circle.lng,
          radius_m: clampRadius(circle.radius_m),
          polygon_json: colorMetaJson(color),
        });
      } else {
        await trackingApi.geofences.create({
          ...base,
          polygon_json: serializeSimplePolygon(polygonDraft.ring, { color }),
          center_lat: null,
          center_lng: null,
          radius_m: null,
        });
      }
      cancelAll();
      setForm({
        name: '',
        leg: 'origin',
        contractor_route_id: form.contractor_route_id,
        alert_on_entry: false,
        alert_on_exit: true,
      });
      onSaved?.();
    } catch (err) {
      setError(err?.message || 'Failed to save geofence');
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = hasCircleDraft || hasPolygonDraft;

  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-950/20 dark:to-surface-900 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            Land & site boundary
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-200/80 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
              Draw on map
            </span>
          </h2>
          <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
            Search your site on the map, then use <strong>Draw area</strong> (polygon recommended for land parcels).
            Map pan/zoom locks while drawing so points stay precise. Name the area and optionally link it to a haul route.
          </p>
        </div>
      </div>

      {!hasDraft && (
        <div className="flex flex-wrap gap-2">
          {DRAW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => startDraw(m.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                drawMode === m.id
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'border-surface-300 text-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800'
              }`}
            >
              {m.label}
            </button>
          ))}
          {drawMode && (
            <button type="button" onClick={cancelAll} className="text-xs text-surface-500 underline px-2">
              Cancel drawing
            </button>
          )}
        </div>
      )}

      {isDrawing && activeMode && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-100/60 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-950 dark:text-amber-100 space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <strong>{activeMode.label} mode:</strong> {activeMode.hint}
          </div>
          {drawMode === 'polygon' && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span>{polygonPoints?.length || 0} vertices</span>
              {polygonPoints?.length > 0 && (
                <span className="font-mono tabular-nums">
                  Last: {polygonPoints[polygonPoints.length - 1].lat.toFixed(6)},{' '}
                  {polygonPoints[polygonPoints.length - 1].lng.toFixed(6)}
                </span>
              )}
              <button type="button" onClick={undoPolygonPoint} className="underline">Undo</button>
              <button type="button" onClick={redoPolygonPoint} className="underline">Redo</button>
              {polygonPoints?.length > 0 && (
                <button type="button" onClick={clearAllPolygonPoints} className="underline text-rose-700">Clear all</button>
              )}
              <span className="text-surface-600">⌘Z undo · double-click to close</span>
            </div>
          )}
          {drawMode === 'freehand' && freehandPreview?.length > 0 && (
            <span className="text-[11px]">{freehandPreview.length} trace points — release to finish</span>
          )}
          {drawMode === 'circle' && circlePreview && (
            <span className="text-[11px] tabular-nums">
              Radius {circlePreview.radius_m?.toLocaleString()} m · {circlePreview.lat.toFixed(6)}, {circlePreview.lng.toFixed(6)}
            </span>
          )}
        </div>
      )}

      {(isDrawing || hasDraft) && (
        <GeofenceColorPicker value={color} onChange={onColorChange} />
      )}

      {hasDraft && (
        <form onSubmit={save} className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="text-xs text-surface-500">Geofence name</label>
              <input
                className="w-full mt-1 rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                placeholder="e.g. Sasol loading bay, High risk bridge"
                value={form.name}
                onChange={(e) => { setNameTouched(true); setForm((f) => ({ ...f, name: e.target.value })); }}
                required
              />
              {placeHint && <p className="text-[10px] text-surface-500 mt-1">Near: {placeHint}</p>}
            </div>
            <div>
              <label className="text-xs text-surface-500">Zone type</label>
              <select className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" value={form.leg} onChange={(e) => applyLeg(e.target.value)}>
                {MANUAL_LEG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-surface-500">Link to route (optional)</label>
              <select className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" value={form.contractor_route_id} onChange={(e) => setForm((f) => ({ ...f, contractor_route_id: e.target.value }))}>
                <option value="">All routes (tenant-wide)</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          {hasCircleDraft && (
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white/70 dark:bg-surface-950/50 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                <span>
                  <strong>{circle.radius_m.toLocaleString()} m</strong> · {formatArea(circle.radius_m)} · {circle.lat.toFixed(6)}, {circle.lng.toFixed(6)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {RADIUS_PRESETS.map((p) => (
                    <button key={p.value} type="button" onClick={() => { onCircleChange({ ...circle, radius_m: clampRadius(p.value) }); onFitMap?.(); }}
                      className={`text-[10px] px-2 py-1 rounded-md border ${circle.radius_m === p.value ? 'border-amber-500 bg-amber-100' : 'border-surface-300'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <input type="range" min={MIN_RADIUS_M} max={Math.min(MAX_RADIUS_M, 10000)} step="10" className="w-full" value={circle.radius_m}
                onChange={(e) => onCircleChange({ ...circle, radius_m: clampRadius(Number(e.target.value)) })} />
            </div>
          )}

          {hasPolygonDraft && (
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white/70 dark:bg-surface-950/50 p-3 text-xs tabular-nums">
              <strong>{polygonDraft.ring.length} vertices</strong>
              {' · '}
              {polygonAreaM2(polygonDraft.ring) >= 1_000_000
                ? `${(polygonAreaM2(polygonDraft.ring) / 1_000_000).toFixed(2)} km²`
                : `${Math.round(polygonAreaM2(polygonDraft.ring)).toLocaleString()} m²`}
              <p className="text-[10px] text-surface-500 mt-1">Drag vertices or the blue scale handle on the map to resize.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.alert_on_entry} onChange={(e) => setForm((f) => ({ ...f, alert_on_entry: e.target.checked }))} />
              Alert on entry
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.alert_on_exit} onChange={(e) => setForm((f) => ({ ...f, alert_on_exit: e.target.checked }))} />
              Alert on exit
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => startDraw(hasCircleDraft ? 'circle' : 'polygon')} className="px-3 py-1.5 rounded-lg border text-sm">Redraw</button>
              <button type="button" onClick={cancelAll} className="px-3 py-1.5 rounded-lg border text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save geofence'}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
