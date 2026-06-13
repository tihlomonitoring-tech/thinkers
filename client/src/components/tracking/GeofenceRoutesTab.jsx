import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracking as trackingApi } from '../../api';
import GeofenceMapEditor from './GeofenceMapEditor.jsx';
import {
  bufferPolylineToPolygon,
  expandPolygonRing,
  parsePolygonJson,
  serializeCorridorPolygon,
  serializeSimplePolygon,
} from '../../lib/routeCorridorGeofence.js';
import { hasValidCoords, parseLatLngPair } from '../../lib/geoCoords.js';

const LEG_OPTIONS = [
  { value: 'origin', label: 'Origin / loading (auto-allocate)' },
  { value: 'destination', label: 'Destination (delivery note)' },
  { value: 'corridor', label: 'Road corridor (exit alerts)' },
  { value: 'alert', label: 'Alert zone (high risk / hazard)' },
];

const ALERT_ZONE_TYPES = [
  { value: 'hazard', label: 'High risk area', radius: 150, alert_on_entry: true, alert_on_exit: false },
  { value: 'hazard', label: 'Crime hotspot', radius: 200, alert_on_entry: true, alert_on_exit: false },
  { value: 'no_stop', label: 'No-stop zone', radius: 120, alert_on_entry: true, alert_on_exit: true },
  { value: 'hazard', label: 'Custom alert zone', radius: 150, alert_on_entry: true, alert_on_exit: false },
];

export default function GeofenceRoutesTab({ setError }) {
  const [routes, setRoutes] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [corridorManual, setCorridorManual] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  const [drawForm, setDrawForm] = useState({
    contractor_route_id: '',
    corridor_m: '400',
    endpoint_radius_m: '500',
    origin_query: '',
    destination_query: '',
    origin_lat: '',
    origin_lng: '',
    dest_lat: '',
    dest_lng: '',
    use_origin_coords: false,
    use_dest_coords: false,
  });

  const [alertForm, setAlertForm] = useState({
    name: '',
    zone_type: '0',
    contractor_route_id: '',
    center_lat: '',
    center_lng: '',
    radius_m: '150',
    alert_on_entry: true,
    alert_on_exit: false,
  });
  const [mapClickTarget, setMapClickTarget] = useState(null);
  const [savingAlert, setSavingAlert] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editRing, setEditRing] = useState(null);
  const [editCenter, setEditCenter] = useState(null);
  const [editRadius, setEditRadius] = useState('500');
  const [savingEdit, setSavingEdit] = useState(false);

  const alertPreview = useMemo(() => {
    const coords = parseLatLngPair(alertForm.center_lat, alertForm.center_lng);
    if (!coords) return null;
    return { ...coords, radius_m: Number(alertForm.radius_m) || 150 };
  }, [alertForm.center_lat, alertForm.center_lng, alertForm.radius_m]);

  const handleMapClick = (lat, lng) => {
    const latStr = lat.toFixed(6);
    const lngStr = lng.toFixed(6);
    if (mapClickTarget === 'origin') {
      setDrawForm((f) => ({ ...f, origin_lat: latStr, origin_lng: lngStr, use_origin_coords: true }));
    } else if (mapClickTarget === 'destination') {
      setDrawForm((f) => ({ ...f, dest_lat: latStr, dest_lng: lngStr, use_dest_coords: true }));
    } else if (mapClickTarget === 'alert') {
      setAlertForm((f) => ({ ...f, center_lat: latStr, center_lng: lngStr }));
    }
    setMapClickTarget(null);
    setFitKey((k) => k + 1);
  };
  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === drawForm.contractor_route_id),
    [routes, drawForm.contractor_route_id]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [r, g] = await Promise.all([trackingApi.contractorRoutes.list(), trackingApi.geofences.list()]);
      setRoutes(r.routes || []);
      setGeofences(g.geofences || []);
    } catch (e) {
      setError(e?.message || 'Failed to load routes');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedRoute) return;
    setDrawForm((f) => ({
      ...f,
      origin_query: f.origin_query || selectedRoute.loading_address || selectedRoute.starting_point || '',
      destination_query: f.destination_query || selectedRoute.destination_address || selectedRoute.destination || '',
    }));
  }, [selectedRoute]);

  const applyPreviewRoute = (alt, index, corridorM, endpointRadiusM, extras = {}) => {
    const polyline = alt.polyline || [];
    const ring = bufferPolylineToPolygon(polyline, corridorM);
    setPreview({
      route_polyline: polyline,
      corridor_polygon: ring,
      origin: extras.origin,
      destination: extras.destination,
      endpoint_radius_m: endpointRadiusM,
      driving: { distance_km: alt.distance_km, duration_min: alt.duration_min, polyline },
      alternatives: extras.alternatives,
      selected_route_index: index,
    });
    setCorridorManual(false);
    setFitKey((k) => k + 1);
  };

  const drawRouteOnMap = async () => {
    if (!drawForm.contractor_route_id) {
      setError('Select a route first.');
      return;
    }
    setDrawing(true);
    setError('');
    setEditing(null);
    setCorridorManual(false);
    try {
      const payload = {
        contractor_route_id: drawForm.contractor_route_id,
        corridor_m: Number(drawForm.corridor_m) || 400,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        origin_query: drawForm.origin_query || undefined,
        destination_query: drawForm.destination_query || undefined,
        save: false,
      };
      if (drawForm.use_origin_coords && hasValidCoords(drawForm.origin_lat, drawForm.origin_lng)) {
        const o = parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng);
        payload.origin_lat = o.lat;
        payload.origin_lng = o.lng;
      }
      if (drawForm.use_dest_coords && hasValidCoords(drawForm.dest_lat, drawForm.dest_lng)) {
        const d = parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng);
        payload.dest_lat = d.lat;
        payload.dest_lng = d.lng;
      }
      const r = await trackingApi.geofences.drawRoute(payload);
      const alternatives = r.alternatives?.length ? r.alternatives : [{
        index: 0,
        distance_km: r.driving?.distance_km,
        duration_min: r.driving?.duration_min,
        polyline: r.route_polyline,
      }];
      const selectedIndex = r.selected_route_index ?? 0;
      const selected = alternatives[selectedIndex] || alternatives[0];
      applyPreviewRoute(selected, selectedIndex, Number(drawForm.corridor_m) || 400, Number(drawForm.endpoint_radius_m) || 500, {
        origin: r.origin,
        destination: r.destination,
        alternatives,
      });
    } catch (err) {
      setError(err?.message || 'Could not draw route on map');
      setPreview(null);
    } finally {
      setDrawing(false);
    }
  };

  const selectAlternativeRoute = (index) => {
    if (!preview?.alternatives?.[index]) return;
    applyPreviewRoute(
      preview.alternatives[index],
      index,
      Number(drawForm.corridor_m) || 400,
      preview.endpoint_radius_m || Number(drawForm.endpoint_radius_m) || 500,
      {
        origin: preview.origin,
        destination: preview.destination,
        alternatives: preview.alternatives,
      }
    );
  };

  const saveDrawnRoute = async () => {
    if (!preview || !drawForm.contractor_route_id) return;
    setDrawing(true);
    setError('');
    try {
      await trackingApi.geofences.drawRoute({
        contractor_route_id: drawForm.contractor_route_id,
        corridor_m: Number(drawForm.corridor_m) || 400,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        origin_query: drawForm.origin_query || undefined,
        destination_query: drawForm.destination_query || undefined,
        origin_lat: drawForm.use_origin_coords ? parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng)?.lat : preview.origin?.lat,
        origin_lng: drawForm.use_origin_coords ? parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng)?.lng : preview.origin?.lng,
        dest_lat: drawForm.use_dest_coords ? parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng)?.lat : preview.destination?.lat,
        dest_lng: drawForm.use_dest_coords ? parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng)?.lng : preview.destination?.lng,
        route_polyline: preview.route_polyline,
        corridor_polygon: preview.corridor_polygon,
        selected_route_index: preview.selected_route_index ?? 0,
        save: true,
      });
      setPreview(null);
      setCorridorManual(false);
      await load();
      alert('Route geofences saved: origin, road corridor, and destination.');
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setDrawing(false);
    }
  };

  const adjustCorridorWidth = (corridorM) => {
    if (!preview?.route_polyline?.length) return;
    const ring = bufferPolylineToPolygon(preview.route_polyline, corridorM);
    setDrawForm((f) => ({ ...f, corridor_m: String(corridorM) }));
    setPreview((p) => (p ? { ...p, corridor_polygon: ring } : p));
    setCorridorManual(false);
  };

  const expandCorridorOnMap = (extraM) => {
    if (!preview?.corridor_polygon?.length) return;
    const ring = expandPolygonRing(preview.corridor_polygon, extraM);
    setPreview((p) => (p ? { ...p, corridor_polygon: ring } : p));
    setCorridorManual(true);
  };

  const resetCorridorShape = () => {
    if (!preview?.route_polyline?.length) return;
    const ring = bufferPolylineToPolygon(preview.route_polyline, Number(drawForm.corridor_m) || 400);
    setPreview((p) => (p ? { ...p, corridor_polygon: ring } : p));
    setCorridorManual(false);
  };

  const startEdit = (g) => {
    setPreview(null);
    const ring = parsePolygonJson(g.polygon_json);
    if (ring?.length >= 3) {
      setEditing(g);
      setEditRing(ring.map((p) => ({ ...p })));
      setEditCenter(null);
      setEditRadius(String(g.radius_m || 500));
      setFitKey((k) => k + 1);
      return;
    }
    if (g.center_lat != null && g.center_lng != null) {
      setEditing(g);
      setEditRing(null);
      setEditCenter({ lat: g.center_lat, lng: g.center_lng });
      setEditRadius(String(g.radius_m || 500));
      setFitKey((k) => k + 1);
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditRing(null);
    setEditCenter(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    setError('');
    try {
      const body = {
        alert_on_exit: editing.alert_on_exit,
        alert_on_entry: editing.alert_on_entry,
      };
      if (editRing?.length >= 3) {
        const existing = parsePolygonJson(editing.polygon_json);
        let meta = {};
        if (typeof editing.polygon_json === 'string') {
          try {
            const parsed = JSON.parse(editing.polygon_json);
            if (parsed?.type === 'corridor') meta = { corridor_m: parsed.corridor_m, route_polyline: parsed.route_polyline };
          } catch { /* ignore */ }
        }
        body.polygon_json = meta.route_polyline
          ? serializeCorridorPolygon(editRing, meta)
          : serializeSimplePolygon(editRing);
        body.center_lat = null;
        body.center_lng = null;
        body.radius_m = null;
      } else if (editCenter) {
        body.center_lat = editCenter.lat;
        body.center_lng = editCenter.lng;
        body.radius_m = Number(editRadius) || 500;
      }
      await trackingApi.geofences.update(editing.id, body);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err?.message || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const removeGeofence = async (id) => {
    if (!window.confirm('Remove this geofence?')) return;
    try {
      await trackingApi.geofences.delete(id);
      if (editing?.id === id) cancelEdit();
      load();
    } catch (err) {
      setError(err?.message || 'Delete failed');
    }
  };

  const saveAlertZone = async (e) => {
    e.preventDefault();
    const coords = parseLatLngPair(alertForm.center_lat, alertForm.center_lng);
    if (!coords) {
      setError('Enter valid latitude and longitude, or click the map to place the zone.');
      return;
    }
    if (!alertForm.name.trim()) {
      setError('Name the alert zone (e.g. High risk bridge).');
      return;
    }
    const preset = ALERT_ZONE_TYPES[Number(alertForm.zone_type)] || ALERT_ZONE_TYPES[0];
    setSavingAlert(true);
    setError('');
    try {
      await trackingApi.geofences.create({
        name: alertForm.name.trim(),
        fence_type: preset.value,
        leg: 'alert',
        contractor_route_id: alertForm.contractor_route_id || null,
        center_lat: coords.lat,
        center_lng: coords.lng,
        radius_m: Number(alertForm.radius_m) || preset.radius,
        alert_on_entry: alertForm.alert_on_entry,
        alert_on_exit: alertForm.alert_on_exit,
      });
      setAlertForm({
        name: '',
        zone_type: '0',
        contractor_route_id: alertForm.contractor_route_id,
        center_lat: '',
        center_lng: '',
        radius_m: String(preset.radius),
        alert_on_entry: true,
        alert_on_exit: false,
      });
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to save alert zone');
    } finally {
      setSavingAlert(false);
    }
  };

  const applyAlertPreset = (idx) => {
    const preset = ALERT_ZONE_TYPES[idx] || ALERT_ZONE_TYPES[0];
    setAlertForm((f) => ({
      ...f,
      zone_type: String(idx),
      radius_m: String(preset.radius),
      alert_on_entry: preset.alert_on_entry,
      alert_on_exit: preset.alert_on_exit,
    }));
  };

  const otherGeofences = editing ? geofences.filter((g) => g.id !== editing.id) : geofences;

  if (loading) return <p className="text-sm text-surface-500">Loading geofences…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Route geofencing</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Pick a route from{' '}
          <Link to="/access-management" className="text-brand-600 hover:underline">Access Management</Link>,
          then <strong>Draw route on map</strong> — the system geocodes loading/destination, snaps to roads (OSRM),
          shows alternative road routes to choose from, and builds a corridor geofence you can expand on the map.
          Use coordinates when addresses are unavailable. Add small alert zones for high-risk areas.
        </p>
      </header>

      <GeofenceMapEditor
        geofences={otherGeofences}
        preview={editing ? null : preview}
        editRing={editRing}
        editCenter={editCenter}
        editRadius={editRadius}
        editLeg={editing?.leg}
        editFenceType={editing?.fence_type}
        fitKey={fitKey}
        alertPreview={mapClickTarget === 'alert' || alertPreview ? alertPreview : null}
        mapClickMode={!!mapClickTarget}
        onMapClick={handleMapClick}
        onVertexDrag={(index, lat, lng) => {
          setEditRing((ring) => ring.map((p, i) => (i === index ? { lat, lng } : p)));
        }}
        onCenterDrag={(lat, lng) => setEditCenter({ lat, lng })}
        onPreviewVertexDrag={(index, lat, lng) => {
          setPreview((p) => {
            if (!p?.corridor_polygon) return p;
            const corridor_polygon = p.corridor_polygon.map((pt, i) => (i === index ? { lat, lng } : pt));
            return { ...p, corridor_polygon };
          });
          setCorridorManual(true);
        }}
      />

      {editing && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 dark:bg-brand-950/30 dark:border-brand-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Editing <strong>{editing.name}</strong>
            {editRing ? ' — drag blue handles to reshape the corridor' : ' — drag the pin to move; adjust radius below'}
          </p>
          <div className="flex gap-2">
            {!editRing && (
              <label className="text-sm flex items-center gap-2">
                Radius (m)
                <input
                  type="number"
                  className="w-24 rounded border px-2 py-1 text-sm dark:bg-surface-950"
                  value={editRadius}
                  onChange={(e) => setEditRadius(e.target.value)}
                />
              </label>
            )}
            <button type="button" onClick={cancelEdit} className="px-3 py-1.5 text-sm rounded-lg border">Cancel</button>
            <button type="button" onClick={saveEdit} disabled={savingEdit} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-surface-200 bg-white dark:bg-surface-900 dark:border-surface-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold">Draw route on road</h2>
          <div>
            <label className="text-xs text-surface-500">Route</label>
            <select
              className="w-full mt-1 rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
              value={drawForm.contractor_route_id}
              onChange={(e) => setDrawForm((f) => ({ ...f, contractor_route_id: e.target.value }))}
            >
              <option value="">— Select route —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-surface-500">Loading / origin</label>
              <label className="inline-flex items-center gap-1.5 text-[10px] text-surface-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={drawForm.use_origin_coords}
                  onChange={(e) => setDrawForm((f) => ({ ...f, use_origin_coords: e.target.checked }))}
                />
                Use coordinates
              </label>
            </div>
            {drawForm.use_origin_coords ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border px-3 py-2 text-sm font-mono dark:border-surface-700 dark:bg-surface-950"
                  placeholder="Latitude"
                  value={drawForm.origin_lat}
                  onChange={(e) => setDrawForm((f) => ({ ...f, origin_lat: e.target.value }))}
                />
                <input
                  className="rounded-lg border px-3 py-2 text-sm font-mono dark:border-surface-700 dark:bg-surface-950"
                  placeholder="Longitude"
                  value={drawForm.origin_lng}
                  onChange={(e) => setDrawForm((f) => ({ ...f, origin_lng: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setMapClickTarget(mapClickTarget === 'origin' ? null : 'origin')}
                  className={`col-span-2 text-xs px-2 py-1.5 rounded-md border ${
                    mapClickTarget === 'origin'
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-surface-300 text-surface-600 hover:bg-surface-50'
                  }`}
                >
                  {mapClickTarget === 'origin' ? 'Click map for origin…' : 'Pick origin on map'}
                </button>
              </div>
            ) : (
              <input
                className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                value={drawForm.origin_query}
                onChange={(e) => setDrawForm((f) => ({ ...f, origin_query: e.target.value }))}
                placeholder="Address from Access Management or type address"
              />
            )}
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-surface-500">Destination</label>
              <label className="inline-flex items-center gap-1.5 text-[10px] text-surface-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={drawForm.use_dest_coords}
                  onChange={(e) => setDrawForm((f) => ({ ...f, use_dest_coords: e.target.checked }))}
                />
                Use coordinates
              </label>
            </div>
            {drawForm.use_dest_coords ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border px-3 py-2 text-sm font-mono dark:border-surface-700 dark:bg-surface-950"
                  placeholder="Latitude"
                  value={drawForm.dest_lat}
                  onChange={(e) => setDrawForm((f) => ({ ...f, dest_lat: e.target.value }))}
                />
                <input
                  className="rounded-lg border px-3 py-2 text-sm font-mono dark:border-surface-700 dark:bg-surface-950"
                  placeholder="Longitude"
                  value={drawForm.dest_lng}
                  onChange={(e) => setDrawForm((f) => ({ ...f, dest_lng: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setMapClickTarget(mapClickTarget === 'destination' ? null : 'destination')}
                  className={`col-span-2 text-xs px-2 py-1.5 rounded-md border ${
                    mapClickTarget === 'destination'
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-surface-300 text-surface-600 hover:bg-surface-50'
                  }`}
                >
                  {mapClickTarget === 'destination' ? 'Click map for destination…' : 'Pick destination on map'}
                </button>
              </div>
            ) : (
              <input
                className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                value={drawForm.destination_query}
                onChange={(e) => setDrawForm((f) => ({ ...f, destination_query: e.target.value }))}
                placeholder="Destination site address"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-surface-500">Corridor width (m)</label>
              <input
                type="range"
                min="150"
                max="1200"
                step="50"
                className="w-full mt-2"
                value={drawForm.corridor_m}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDrawForm((f) => ({ ...f, corridor_m: String(v) }));
                  adjustCorridorWidth(v);
                }}
              />
              <p className="text-xs text-surface-500 mt-1">{drawForm.corridor_m} m each side of road</p>
            </div>
            <div>
              <label className="text-xs text-surface-500">Endpoint radius (m)</label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                value={drawForm.endpoint_radius_m}
                onChange={(e) => setDrawForm((f) => ({ ...f, endpoint_radius_m: e.target.value }))}
              />
            </div>
          </div>
          {preview?.alternatives?.length > 1 && (
            <div className="space-y-2 rounded-lg border border-surface-200 dark:border-surface-700 p-3 bg-surface-50/80 dark:bg-surface-900/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-surface-500">Choose road route</p>
              <p className="text-[11px] text-surface-500">Dashed grey lines on the map are alternatives. Select the corridor that best matches your haul road.</p>
              <div className="flex flex-col gap-2">
                {preview.alternatives.map((alt, i) => {
                  const selected = (preview.selected_route_index ?? 0) === i;
                  const label = String.fromCharCode(65 + i);
                  return (
                    <button
                      key={alt.index ?? i}
                      type="button"
                      onClick={() => selectAlternativeRoute(i)}
                      className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100'
                          : 'border-surface-200 dark:border-surface-700 hover:bg-white dark:hover:bg-surface-800'
                      }`}
                    >
                      <span className="font-medium">Route {label}</span>
                      {i === 0 && <span className="ml-1.5 text-[10px] text-brand-600 dark:text-brand-300">fastest</span>}
                      <span className="block text-xs text-surface-500 mt-0.5 tabular-nums">
                        ~{alt.distance_km} km · ~{alt.duration_min} min driving
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {preview?.corridor_polygon?.length >= 3 && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-violet-900 dark:text-violet-200">Adjust corridor on map</p>
              <p className="text-[11px] text-surface-600 dark:text-surface-400">
                Drag the purple handles on the map, or use quick expand. {corridorManual ? 'Custom shape applied.' : 'Auto-generated from road width.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => expandCorridorOnMap(50)} className="text-xs px-2.5 py-1 rounded-md border border-violet-300 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-950/40">
                  Expand +50 m
                </button>
                <button type="button" onClick={() => expandCorridorOnMap(100)} className="text-xs px-2.5 py-1 rounded-md border border-violet-300 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-950/40">
                  Expand +100 m
                </button>
                <button type="button" onClick={resetCorridorShape} className="text-xs px-2.5 py-1 rounded-md border border-surface-300 text-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800">
                  Reset to road width
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={drawRouteOnMap}
              disabled={drawing}
              className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {drawing ? 'Drawing…' : 'Draw route on map'}
            </button>
            {preview && (
              <button
                type="button"
                onClick={saveDrawnRoute}
                disabled={drawing}
                className="rounded-lg border border-emerald-600 text-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-50 disabled:opacity-50"
              >
                Save geofences (origin + corridor + destination)
              </button>
            )}
          </div>
          {preview?.driving && (
            <p className="text-xs text-surface-500">
              Road distance ~{preview.driving.distance_km} km · ~{preview.driving.duration_min} min driving
            </p>
          )}
        </section>

        <div className="rounded-xl border border-surface-200 bg-white dark:bg-surface-900 dark:border-surface-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 text-sm font-semibold">Configured geofences</div>
          <ul className="divide-y divide-surface-100 dark:divide-surface-800 max-h-[28rem] overflow-y-auto">
            {geofences.map((g) => {
              const isPoly = !!parsePolygonJson(g.polygon_json)?.length;
              return (
                <li key={g.id} className={`px-4 py-3 text-sm ${editing?.id === g.id ? 'bg-brand-50/50 dark:bg-brand-950/20' : ''}`}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium flex items-center gap-2 flex-wrap">
                        {g.name}
                        {(g.leg === 'alert' || g.fence_type === 'hazard') && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                            Alert zone
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-surface-500">
                        {g.contractor_route_name || (g.leg === 'alert' ? 'All routes' : '—')} · {g.leg || g.fence_type}
                        {isPoly ? ' · road corridor' : ` · ${g.radius_m}m`}
                        {g.alert_on_entry && ' · entry alert'}
                        {g.alert_on_exit && ' · exit alert'}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => startEdit(g)} className="text-xs text-brand-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => removeGeofence(g.id)} className="text-xs text-rose-600 hover:underline">Remove</button>
                    </div>
                  </div>
                </li>
              );
            })}
            {geofences.length === 0 && (
              <li className="px-4 py-6 text-surface-500 text-sm">No geofences yet. Select a route and draw on the map.</li>
            )}
          </ul>
        </div>
      </div>

      <section className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/10 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Alert zones</h2>
          <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
            Small geofences for high-risk areas, crime hotspots, or no-stop zones. Trucks entering trigger email alerts and alarm records.
            Optional route link — leave blank to monitor all trucks on the tenant.
          </p>
        </div>
        <form onSubmit={saveAlertZone} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            placeholder="Zone name (e.g. High risk N12)"
            value={alertForm.name}
            onChange={(e) => setAlertForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            value={alertForm.zone_type}
            onChange={(e) => applyAlertPreset(Number(e.target.value))}
          >
            {ALERT_ZONE_TYPES.map((t, i) => (
              <option key={`${t.label}-${i}`} value={i}>{t.label}</option>
            ))}
          </select>
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            value={alertForm.contractor_route_id}
            onChange={(e) => setAlertForm((f) => ({ ...f, contractor_route_id: e.target.value }))}
          >
            <option value="">All routes (tenant-wide)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <input
            className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950"
            placeholder="Latitude"
            value={alertForm.center_lat}
            onChange={(e) => setAlertForm((f) => ({ ...f, center_lat: e.target.value }))}
          />
          <input
            className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950"
            placeholder="Longitude"
            value={alertForm.center_lng}
            onChange={(e) => setAlertForm((f) => ({ ...f, center_lng: e.target.value }))}
          />
          <input
            type="number"
            min="50"
            max="2000"
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            placeholder="Radius (m)"
            value={alertForm.radius_m}
            onChange={(e) => setAlertForm((f) => ({ ...f, radius_m: e.target.value }))}
          />
          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={alertForm.alert_on_entry} onChange={(e) => setAlertForm((f) => ({ ...f, alert_on_entry: e.target.checked }))} />
              Alert on entry
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={alertForm.alert_on_exit} onChange={(e) => setAlertForm((f) => ({ ...f, alert_on_exit: e.target.checked }))} />
              Alert on exit
            </label>
            <button
              type="button"
              onClick={() => setMapClickTarget(mapClickTarget === 'alert' ? null : 'alert')}
              className={`px-2.5 py-1.5 rounded-md border ${
                mapClickTarget === 'alert'
                  ? 'border-rose-500 bg-rose-100 text-rose-900'
                  : 'border-surface-300 text-surface-600 hover:bg-surface-50'
              }`}
            >
              {mapClickTarget === 'alert' ? 'Click map to place zone…' : 'Place on map'}
            </button>
            <button
              type="submit"
              disabled={savingAlert}
              className="ml-auto rounded-lg bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
            >
              {savingAlert ? 'Saving…' : 'Save alert zone'}
            </button>
          </div>
        </form>
      </section>

      <details className="rounded-xl border border-dashed border-surface-300 dark:border-surface-700 p-4 text-sm">
        <summary className="font-medium cursor-pointer">Manual point geofence (advanced)</summary>
        <ManualGeofenceForm routes={routes} onSaved={load} setError={setError} legOptions={LEG_OPTIONS} />
      </details>
    </div>
  );
}

function ManualGeofenceForm({ routes, onSaved, setError, legOptions }) {
  const [form, setForm] = useState({
    name: '',
    contractor_route_id: '',
    leg: 'origin',
    center_lat: '',
    center_lng: '',
    radius_m: '500',
    alert_on_exit: true,
  });

  const save = async (e) => {
    e.preventDefault();
    if (!form.center_lat || !form.center_lng) {
      setError('Enter lat/lng for a manual circle geofence.');
      return;
    }
    try {
      await trackingApi.geofences.create({
        name: form.name,
        fence_type: form.leg === 'alert' ? 'hazard' : form.leg === 'destination' ? 'destination' : 'deviation',
        contractor_route_id: form.contractor_route_id || null,
        leg: form.leg,
        center_lat: Number(form.center_lat),
        center_lng: Number(form.center_lng),
        radius_m: Number(form.radius_m) || 500,
        alert_on_entry: form.leg === 'alert' ? true : !!form.alert_on_entry,
        alert_on_exit: form.alert_on_exit,
      });
      onSaved();
      setForm((f) => ({ ...f, name: '', center_lat: '', center_lng: '' }));
    } catch (err) {
      setError(err?.message || 'Save failed');
    }
  };

  return (
    <form onSubmit={save} className="mt-4 grid sm:grid-cols-2 gap-3">
      <input className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      <select className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" value={form.contractor_route_id} onChange={(e) => setForm((f) => ({ ...f, contractor_route_id: e.target.value }))}>
        <option value="">All routes (optional)</option>
        {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <select className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" value={form.leg} onChange={(e) => setForm((f) => ({ ...f, leg: e.target.value }))}>
        {legOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950" placeholder="Lat" value={form.center_lat} onChange={(e) => setForm((f) => ({ ...f, center_lat: e.target.value }))} />
      <input className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950" placeholder="Lng" value={form.center_lng} onChange={(e) => setForm((f) => ({ ...f, center_lng: e.target.value }))} />
      <input className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" placeholder="Radius m" value={form.radius_m} onChange={(e) => setForm((f) => ({ ...f, radius_m: e.target.value }))} />
      <button type="submit" className="sm:col-span-2 rounded-lg border border-brand-600 text-brand-700 px-4 py-2 text-sm w-fit">Add manual circle</button>
    </form>
  );
}
