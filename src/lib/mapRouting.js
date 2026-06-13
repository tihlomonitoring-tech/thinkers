/** Geocode + driving route via OpenStreetMap (Nominatim + OSRM). Used server-side to avoid browser CORS. */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

const UA = 'ThinkersTracking/1.0 (fleet geofence; contact@thinkers.app)';

export async function geocodeAddress(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=za`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const data = await res.json();
  const hit = data?.[0];
  if (!hit) return null;
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    display_name: hit.display_name,
    query: q,
  };
}

export async function drivingRoute(fromLat, fromLng, toLat, toLng) {
  const routes = await drivingRouteAlternatives(fromLat, fromLng, toLat, toLng);
  if (!routes.length) throw new Error('No driving route found between these points');
  return routes[0];
}

/** Up to 3 road-following alternatives via OSRM (fastest first). */
export async function drivingRouteAlternatives(fromLat, fromLng, toLat, toLng) {
  const a = `${Number(fromLng)},${Number(fromLat)}`;
  const b = `${Number(toLng)},${Number(toLat)}`;
  const url = `${OSRM}/${a};${b}?overview=full&geometries=geojson&steps=false&alternatives=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Route lookup failed (${res.status})`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data.message || 'No driving route found between these points');
  }
  return data.routes.map((route, index) => {
    const coords = route.geometry?.coordinates || [];
    return {
      index,
      distance_km: Math.round((route.distance / 1000) * 10) / 10,
      duration_min: Math.round(route.duration / 60),
      polyline: coords.map(([lng, lat]) => ({ lat, lng })),
    };
  });
}
