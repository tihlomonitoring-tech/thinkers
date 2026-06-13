/** Parse latitude/longitude from form input (decimal or "lat, lng" pair). */
export function parseCoord(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return null;
}

export function parseLatLngPair(latVal, lngVal) {
  const lat = parseCoord(latVal);
  const lng = parseCoord(lngVal);
  if (lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    return { lat, lng };
  }
  return null;
}

/** Accept "lat, lng" in a single field. */
export function parseCombinedLatLng(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const parts = s.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

export function hasValidCoords(latVal, lngVal) {
  return !!parseLatLngPair(latVal, lngVal);
}
