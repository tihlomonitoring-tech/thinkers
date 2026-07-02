/** Geofence geometry helpers — circle fences (radius_m) and simple polygon JSON. */

/** Minimum distance outside destination geofence before auto-completing delivery (queues near fence). */
export const DESTINATION_DEPARTURE_COMPLETE_KM = 2;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function pointInCircle(lat, lng, centerLat, centerLng, radiusM) {
  if (lat == null || lng == null || centerLat == null || centerLng == null) return false;
  const r = Number(radiusM);
  if (!Number.isFinite(r) || r <= 0) return false;
  return haversineMeters(Number(lat), Number(lng), Number(centerLat), Number(centerLng)) <= r;
}

/** @param {Array<{lat:number,lng:number}>|string|null} polygon */
export function pointInPolygon(lat, lng, polygon) {
  if (lat == null || lng == null || !polygon) return false;
  let pts = polygon;
  if (typeof polygon === 'string') {
    try {
      pts = JSON.parse(polygon);
    } catch {
      return false;
    }
  }
  if (!Array.isArray(pts) || pts.length < 3) return false;
  const x = Number(lng);
  const y = Number(lat);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = Number(pts[i].lng ?? pts[i][1]);
    const yi = Number(pts[i].lat ?? pts[i][0]);
    const xj = Number(pts[j].lng ?? pts[j][1]);
    const yj = Number(pts[j].lat ?? pts[j][0]);
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInsideGeofence(lat, lng, fence) {
  if (!fence) return false;
  const clat = fence.center_lat ?? fence.centerLat;
  const clng = fence.center_lng ?? fence.centerLng;
  const radius = fence.radius_m ?? fence.radiusM;
  if (clat != null && clng != null && radius != null) {
    return pointInCircle(lat, lng, clat, clng, radius);
  }
  const poly = fence.polygon_json ?? fence.polygonJson;
  if (!poly) return false;
  let parsed = poly;
  if (typeof poly === 'string') {
    try {
      parsed = JSON.parse(poly);
    } catch {
      return false;
    }
  }
  if (parsed?.ring && Array.isArray(parsed.ring)) return pointInPolygon(lat, lng, parsed.ring);
  return pointInPolygon(lat, lng, parsed);
}

/** Distance in km from point to outside edge of fence (0 if inside). */
export function distanceOutsideGeofenceKm(lat, lng, fence) {
  if (!fence || lat == null || lng == null) return null;
  const plat = Number(lat);
  const plng = Number(lng);
  if (!Number.isFinite(plat) || !Number.isFinite(plng)) return null;
  if (isInsideGeofence(plat, plng, fence)) return 0;

  const clat = fence.center_lat ?? fence.centerLat;
  const clng = fence.center_lng ?? fence.centerLng;
  const radius = Number(fence.radius_m ?? fence.radiusM ?? 0);
  if (clat != null && clng != null && Number.isFinite(radius) && radius > 0) {
    const distM = haversineMeters(plat, plng, Number(clat), Number(clng));
    return Math.round(Math.max(0, distM - radius) / 10) / 100;
  }

  const poly = fence.polygon_json ?? fence.polygonJson;
  if (poly) {
    let parsed = poly;
    if (typeof poly === 'string') {
      try { parsed = JSON.parse(poly); } catch { parsed = null; }
    }
    const ring = parsed?.ring || parsed;
    if (Array.isArray(ring) && ring.length >= 3) {
      let minM = Infinity;
      for (const p of ring) {
        const glat = Number(p.lat ?? p[0]);
        const glng = Number(p.lng ?? p[1]);
        if (!Number.isFinite(glat) || !Number.isFinite(glng)) continue;
        minM = Math.min(minM, haversineMeters(plat, plng, glat, glng));
      }
      if (Number.isFinite(minM)) return Math.round(minM / 10) / 100;
    }
  }
  return null;
}

export function maxDistanceOutsideRouteLegKm(lat, lng, routeId, geofences, leg) {
  if (!routeId || !geofences?.length) return 0;
  const rid = String(routeId).replace(/[{}]/g, '').toLowerCase();
  const wantLeg = String(leg || '').toLowerCase();
  let maxKm = 0;
  for (const fence of geofences) {
    const frid = String(fence.contractor_route_id ?? '').replace(/[{}]/g, '').toLowerCase();
    if (frid && frid !== rid) continue;
    if (String(fence.leg || '').toLowerCase() !== wantLeg) continue;
    const d = distanceOutsideGeofenceKm(lat, lng, fence);
    if (d != null && d > maxKm) maxKm = d;
  }
  return maxKm;
}

/** Auto-complete only after truck entered destination geofence, exited it, then reached 2+ km outside. */
export function shouldAutoCompleteAfterDestinationExit(trip, kmOutsideDestination, hasExitedGeofence) {
  if (!trip) return false;
  const entered = !!(trip.at_destination_at || String(trip.activity_stage || '').toLowerCase() === 'at_destination');
  const exited = hasExitedGeofence ?? !!trip.destination_geofence_exited_at;
  const outside = Number(kmOutsideDestination);
  return entered && exited && Number.isFinite(outside) && outside >= DESTINATION_DEPARTURE_COMPLETE_KM;
}
