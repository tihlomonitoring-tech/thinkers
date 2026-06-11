/** Geofence geometry helpers — circle fences (radius_m) and simple polygon JSON. */

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
