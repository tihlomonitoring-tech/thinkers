import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracking as trackingApi } from '../../api';
import GeofenceMapEditor from './GeofenceMapEditor.jsx';
import {
  bufferPolylineToPolygon,
  parsePolygonJson,
  serializeCorridorPolygon,
  serializeSimplePolygon,
} from '../../lib/routeCorridorGeofence.js';

const LEG_OPTIONS = [
  { value: 'origin', label: 'Origin / loading (auto-allocate)' },
  { value: 'destination', label: 'Destination (delivery note)' },
  { value: 'corridor', label: 'Road corridor (exit alerts)' },
];

export default function GeofenceRoutesTab({ setError }) {
  const [routes, setRoutes] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fitKey, setFitKey] = useState(0);

  const [drawForm, setDrawForm] = useState({
    contractor_route_id: '',
    corridor_m: '400',
    endpoint_radius_m: '500',
    origin_query: '',
    destination_query: '',
  });

  const [editing, setEditing] = useState(null);
  const [editRing, setEditRing] = useState(null);
  const [editCenter, setEditCenter] = useState(null);
  const [editRadius, setEditRadius] = useState('500');
  const [savingEdit, setSavingEdit] = useState(false);

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

  const drawRouteOnMap = async () => {
    if (!drawForm.contractor_route_id) {
      setError('Select a route first.');
      return;
    }
    setDrawing(true);
    setError('');
    setEditing(null);
    try {
      const r = await trackingApi.geofences.drawRoute({
        contractor_route_id: drawForm.contractor_route_id,
        corridor_m: Number(drawForm.corridor_m) || 400,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        origin_query: drawForm.origin_query || undefined,
        destination_query: drawForm.destination_query || undefined,
        save: false,
      });
      setPreview({
        route_polyline: r.route_polyline,
        corridor_polygon: r.corridor_polygon,
        origin: r.origin,
        destination: r.destination,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        driving: r.driving,
      });
      setFitKey((k) => k + 1);
    } catch (err) {
      setError(err?.message || 'Could not draw route on map');
      setPreview(null);
    } finally {
      setDrawing(false);
    }
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
        origin_lat: preview.origin?.lat,
        origin_lng: preview.origin?.lng,
        dest_lat: preview.destination?.lat,
        dest_lng: preview.destination?.lng,
        save: true,
      });
      setPreview(null);
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

  const otherGeofences = editing ? geofences.filter((g) => g.id !== editing.id) : geofences;

  if (loading) return <p className="text-sm text-surface-500">Loading geofences…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Route geofencing</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Pick a route from{' '}
          <Link to="/access-management" className="text-brand-600 hover:underline">Access Management</Link>,
          then <strong>Draw route on map</strong> — the system geocodes loading/destination, snaps to roads (OSRM), and builds a corridor geofence.
          Drag corner points to adjust any fence before saving.
        </p>
      </header>

      <GeofenceMapEditor
        geofences={otherGeofences}
        preview={editing ? null : preview}
        editRing={editRing}
        editCenter={editCenter}
        editRadius={editRadius}
        editLeg={editing?.leg}
        fitKey={fitKey}
        onVertexDrag={(index, lat, lng) => {
          setEditRing((ring) => ring.map((p, i) => (i === index ? { lat, lng } : p)));
        }}
        onCenterDrag={(lat, lng) => setEditCenter({ lat, lng })}
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
            <label className="text-xs text-surface-500">Loading / origin address</label>
            <input
              className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
              value={drawForm.origin_query}
              onChange={(e) => setDrawForm((f) => ({ ...f, origin_query: e.target.value }))}
              placeholder="From Access Management or type address"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500">Destination address</label>
            <input
              className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
              value={drawForm.destination_query}
              onChange={(e) => setDrawForm((f) => ({ ...f, destination_query: e.target.value }))}
              placeholder="Destination site"
            />
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
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-surface-500">
                        {g.contractor_route_name || '—'} · {g.leg || g.fence_type}
                        {isPoly ? ' · road corridor' : ` · ${g.radius_m}m`}
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
        fence_type: form.leg === 'destination' ? 'destination' : 'deviation',
        contractor_route_id: form.contractor_route_id,
        leg: form.leg,
        center_lat: Number(form.center_lat),
        center_lng: Number(form.center_lng),
        radius_m: Number(form.radius_m) || 500,
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
      <select className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950" value={form.contractor_route_id} onChange={(e) => setForm((f) => ({ ...f, contractor_route_id: e.target.value }))} required>
        <option value="">Route</option>
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
