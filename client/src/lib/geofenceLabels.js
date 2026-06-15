import { parsePolygonJson, polygonCentroid } from './routeCorridorGeofence.js';

const ROAD_LEGS = new Set(['corridor', 'corridor_alt']);

/** Site / land geofences — excludes haul-road corridor shapes. */
export function isLandGeofence(g) {
  const leg = String(g?.leg || '').toLowerCase();
  if (ROAD_LEGS.has(leg)) return false;
  return !!String(g?.name || '').trim();
}

export function geofenceLabelPosition(g) {
  const ring = parsePolygonJson(g?.polygon_json);
  if (ring?.length >= 3) {
    return polygonCentroid(ring) || ring[0];
  }
  if (g?.center_lat != null && g?.center_lng != null) {
    const lat = Number(g.center_lat);
    const lng = Number(g.center_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

export function landGeofencePlace(g) {
  if (!isLandGeofence(g)) return null;
  const pos = geofenceLabelPosition(g);
  if (!pos) return null;
  const leg = String(g.leg || '').toLowerCase();
  const subtitle = g.contractor_route_name
    || (leg === 'alert' ? 'Alert zone' : leg === 'origin' ? 'Loading / origin' : leg === 'destination' ? 'Destination' : 'Land geofence');
  return {
    id: g.id,
    geofenceId: g.id,
    name: String(g.name).trim(),
    lat: pos.lat,
    lng: pos.lng,
    subtitle,
    kind: 'geofence',
  };
}

export function landGeofencePlaces(geofences) {
  return (geofences || []).map(landGeofencePlace).filter(Boolean);
}

export function searchLandGeofencePlaces(places, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2 || !places?.length) return [];
  return places.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.subtitle?.toLowerCase().includes(q)) return true;
    return false;
  }).slice(0, limit);
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
