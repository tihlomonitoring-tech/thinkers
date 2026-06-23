/** Shared corridor buffer (server + can mirror client). */

const R = 6371000;

function toRad(d) {
  return (d * Math.PI) / 180;
}

function toDeg(r) {
  return (r * 180) / Math.PI;
}

function bearingDeg(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function offsetPoint(lat, lng, bearingDegrees, distM) {
  const br = toRad(bearingDegrees);
  const d = distM / R;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

export function parseCorridorPolyline(raw) {
  if (!raw) return null;
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data?.route_polyline?.length) return null;
  return data.route_polyline
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export { bearingDeg, offsetPoint };

function haversineM(a, b) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lng - a.lng);
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function polylineDistanceM(points) {
  if (!points?.length || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineM(points[i - 1], points[i]);
  }
  return total;
}

export function polylineDistanceKm(points) {
  const m = polylineDistanceM(points);
  if (!m) return null;
  return Math.round((m / 1000) * 100) / 100;
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

/** Fraction along segment a→b closest to point p (planar lat/lng projection). */
function projectionFraction(p, a, b) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return clamp01(((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2);
}

/**
 * Distance along a route polyline from start → truck position → end.
 * Uses perpendicular projection onto each segment (not just vertices).
 */
export function distanceProgressAlongPolyline(polyline, lat, lng) {
  if (!polyline?.length || polyline.length < 2) return null;
  const p = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;

  let bestOffRouteM = Infinity;
  let bestTraveledM = 0;
  let cumM = 0;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segM = haversineM(a, b);
    const t = projectionFraction(p, a, b);
    const proj = {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    };
    const offM = haversineM(p, proj);
    const traveledM = cumM + t * segM;
    if (offM < bestOffRouteM) {
      bestOffRouteM = offM;
      bestTraveledM = traveledM;
    }
    cumM += segM;
  }

  const totalM = cumM;
  return {
    traveledM: bestTraveledM,
    remainingM: Math.max(0, totalM - bestTraveledM),
    totalM,
    offRouteM: bestOffRouteM,
  };
}

export function parseMonitorWaypoints(raw) {
  if (!raw) return null;
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data)) return null;
  const pts = data
    .map((p) => ({ lat: Number(p.lat ?? p[0]), lng: Number(p.lng ?? p[1]) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return pts.length >= 2 ? pts : null;
}

export function bufferPolylineToPolygon(points, bufferM) {
  if (!points?.length || points.length < 2) return [];
  const half = Math.max(50, Number(bufferM) || 400) / 2;
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    let b;
    if (i === 0) b = bearingDeg(points[0].lat, points[0].lng, points[1].lat, points[1].lng);
    else if (i === points.length - 1) {
      b = bearingDeg(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    } else {
      const b1 = bearingDeg(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      const b2 = bearingDeg(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
      let diff = b2 - b1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      b = (b1 + b2) / 2 + (Math.abs(diff) > 90 ? 180 : 0);
    }
    left.push(offsetPoint(points[i].lat, points[i].lng, b - 90, half));
    right.push(offsetPoint(points[i].lat, points[i].lng, b + 90, half));
  }
  return [...left, ...right.reverse()];
}
