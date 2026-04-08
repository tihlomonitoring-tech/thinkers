/** Haversine distance in metres — no external APIs (cost-free). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Slack radius: base + GPS uncertainty (m). */
export function allowedLocationRadiusMeters(anchorAccuracy, currentAccuracy) {
  const base = 200;
  const a = Number.isFinite(anchorAccuracy) ? Math.min(Math.max(anchorAccuracy, 0), 500) : 50;
  const c = Number.isFinite(currentAccuracy) ? Math.min(Math.max(currentAccuracy, 0), 500) : 50;
  return base + Math.max(a, c, 50);
}

export function parseClientCoords(body) {
  if (!body || typeof body !== 'object') return null;
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lng ?? body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  let acc = body.accuracy_meters != null ? Number(body.accuracy_meters) : body.accuracy != null ? Number(body.accuracy) : null;
  if (acc != null && !Number.isFinite(acc)) acc = null;
  return { lat, lng, accuracy: acc };
}
