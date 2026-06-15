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
