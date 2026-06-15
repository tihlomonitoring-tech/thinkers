/** Geocode + driving route via OpenStreetMap (Nominatim + OSRM). Used server-side to avoid browser CORS. */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const UA = 'ThinkersTracking/1.0 (fleet geofence; contact@thinkers.app)';

/** @type {Map<string, { at: number, data: object }>} */
const locationContextCache = new Map();
const LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

/** Parse "lat, lng" or "lat lng" from a search string. */
export function parseCoordinateQuery(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const parts = s.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

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

const ZA_SPEED_DEFAULTS = {
  'za:urban': 60,
  'za:rural': 100,
  'za:trunk': 120,
  'za:motorway': 120,
  'za:nsl': 60,
};

export function parseMaxspeedKmh(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'walk' || s === 'none' || s === 'signals') return null;
  if (ZA_SPEED_DEFAULTS[s] != null) return ZA_SPEED_DEFAULTS[s];
  const mph = s.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mph) return Math.round(Number(mph[1]) * 1.60934);
  const kmh = s.match(/(\d+(?:\.\d+)?)/);
  return kmh ? Math.round(Number(kmh[1])) : null;
}

function pickAddressField(addr, keys) {
  if (!addr) return null;
  for (const k of keys) {
    const v = addr[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Build a FleetCam-style single-line address from Nominatim address parts. */
export function formatAddressFromNominatim(hit) {
  const addr = hit?.address || {};
  const house = pickAddressField(addr, ['house_number']);
  const road = pickAddressField(addr, ['road', 'pedestrian', 'footway', 'path', 'residential', 'street']);
  const streetLine = [house, road].filter(Boolean).join(' ') || road;
  const suburb = pickAddressField(addr, ['suburb', 'neighbourhood', 'quarter', 'hamlet']);
  const town = pickAddressField(addr, ['town', 'village', 'city_district']);
  const city = pickAddressField(addr, ['city', 'municipality', 'county']);
  const state = pickAddressField(addr, ['state', 'region']);
  const postcode = pickAddressField(addr, ['postcode']);

  const locality = town || city;
  const parts = [streetLine, suburb, locality, state, postcode].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);

  return {
    display_name: hit?.display_name || unique.join(', ') || null,
    address_line: unique.join(', ') || hit?.display_name || null,
    house_number: house,
    street: road,
    suburb,
    town: town || city,
    city: city || town,
    state,
    postcode,
  };
}

/** Reverse geocode lat/lng to street, town, city (Nominatim). */
export async function reverseGeocode(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const url = `${NOMINATIM_REVERSE}?lat=${la}&lon=${ln}&format=json&addressdetails=1&zoom=18`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Reverse geocode failed (${res.status})`);
  const hit = await res.json();
  if (!hit || hit.error) return null;
  return {
    lat: la,
    lng: ln,
    ...formatAddressFromNominatim(hit),
  };
}

/** Nearest mapped road name + speed limit via Overpass (OpenStreetMap). */
export async function nearestRoadInfo(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const query = `[out:json][timeout:20];
way(around:45,${la},${ln})[highway][highway!~"^(footway|path|cycleway|steps|corridor|bridleway|track)$"];
out tags 25;`;

  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Road lookup failed (${res.status})`);
  const data = await res.json();
  const ways = (data?.elements || []).filter((el) => el.type === 'way' && el.tags);

  let best = null;
  let bestRank = -1;
  const highwayRank = {
    motorway: 10,
    trunk: 9,
    primary: 8,
    secondary: 7,
    tertiary: 6,
    unclassified: 5,
    residential: 4,
    service: 2,
  };

  for (const way of ways) {
    const tags = way.tags || {};
    const hw = String(tags.highway || '').toLowerCase();
    const rank = highwayRank[hw] ?? 3;
    const hasSpeed = tags.maxspeed != null;
    const hasName = !!(tags.name || tags.ref);
    const score = rank + (hasSpeed ? 2 : 0) + (hasName ? 1 : 0);
    if (score > bestRank) {
      bestRank = score;
      best = tags;
    }
  }

  if (!best) return null;

  const roadName = best.name || best.ref || null;
  const speedLimitKmh = parseMaxspeedKmh(best.maxspeed);

  return {
    road_name: roadName,
    road_ref: best.ref || null,
    highway_type: best.highway || null,
    speed_limit_kmh: speedLimitKmh,
    speed_limit_raw: best.maxspeed != null ? String(best.maxspeed) : null,
  };
}

/** Address + road speed limit at a GPS point (cached ~5 min). */
export async function locationContextAt(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const key = cacheKey(la, ln);
  const cached = locationContextCache.get(key);
  if (cached && Date.now() - cached.at < LOCATION_CACHE_TTL_MS) {
    return cached.data;
  }

  const [address, road] = await Promise.all([
    reverseGeocode(la, ln).catch(() => null),
    nearestRoadInfo(la, ln).catch(() => null),
  ]);

  const data = {
    lat: la,
    lng: ln,
    display_name: address?.display_name || null,
    address_line: address?.address_line || null,
    house_number: address?.house_number || null,
    street: address?.street || road?.road_name || null,
    suburb: address?.suburb || null,
    town: address?.town || null,
    city: address?.city || null,
    state: address?.state || null,
    postcode: address?.postcode || null,
    road_name: road?.road_name || address?.street || null,
    road_ref: road?.road_ref || null,
    highway_type: road?.highway_type || null,
    speed_limit_kmh: road?.speed_limit_kmh ?? null,
    speed_limit_raw: road?.speed_limit_raw || null,
  };

  locationContextCache.set(key, { at: Date.now(), data });
  return data;
}
