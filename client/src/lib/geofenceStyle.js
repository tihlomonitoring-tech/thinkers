/** Geofence colours and metadata stored in polygon_json. */

export const GEOFENCE_COLOR_PRESETS = [
  { label: 'Blue', value: '#2563eb' },
  { label: 'Green', value: '#059669' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Cyan', value: '#0891b2' },
  { label: 'Slate', value: '#64748b' },
  { label: 'Orange', value: '#ea580c' },
];

export function legColor(leg, fenceType) {
  const ft = String(fenceType || '').toLowerCase();
  if (leg === 'alert' || ft === 'hazard') return '#e11d48';
  if (leg === 'origin') return '#2563eb';
  if (leg === 'destination') return '#059669';
  if (leg === 'corridor') return '#7c3aed';
  if (leg === 'corridor_alt') return '#0891b2';
  return '#64748b';
}

export function parseGeofenceMeta(raw) {
  if (!raw) return { color: null, type: null, corridor_m: null, route_polyline: null };
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { color: null, type: null, corridor_m: null, route_polyline: null };
    }
  }
  if (Array.isArray(data)) return { color: null, type: 'polygon', corridor_m: null, route_polyline: null };
  return {
    color: data?.color || null,
    type: data?.type || null,
    corridor_m: data?.corridor_m ?? null,
    route_polyline: data?.route_polyline ?? null,
  };
}

export function geofenceDisplayColor(geofence) {
  const meta = parseGeofenceMeta(geofence?.polygon_json);
  if (meta.color) return meta.color;
  return legColor(geofence?.leg, geofence?.fence_type);
}

export function colorMetaJson(color) {
  if (!color) return null;
  return JSON.stringify({ color });
}

export function mergeColorIntoPolygonJson(existingJson, ring, extra = {}) {
  const meta = parseGeofenceMeta(existingJson);
  if (meta.type === 'corridor' || extra.type === 'corridor') {
    return JSON.stringify({
      type: 'corridor',
      color: extra.color ?? meta.color ?? null,
      corridor_m: extra.corridor_m ?? meta.corridor_m ?? null,
      route_polyline: extra.route_polyline ?? meta.route_polyline ?? null,
      ring,
    });
  }
  const color = extra.color ?? meta.color ?? null;
  if (color) return JSON.stringify({ type: 'polygon', color, ring });
  return JSON.stringify(ring);
}
