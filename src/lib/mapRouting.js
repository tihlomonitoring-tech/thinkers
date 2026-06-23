import { polylineDistanceKm, bearingDeg, offsetPoint, polylineDistanceM } from './routeCorridorGeofence.js';

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
  const routes = await fetchOsrmRoutes([[fromLng, fromLat], [toLng, toLat]], { alternatives: true });
  return routes;
}

/** Snap a manually plotted path to roads — strict leg-by-leg through every waypoint in order. */
export async function drivingRouteThroughWaypoints(waypoints) {
  const pts = (waypoints || [])
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 2) throw new Error('At least 2 waypoints required');

  const snapped = await Promise.all(pts.map((p) => snapPointToRoad(p.lat, p.lng)));

  let polyline = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;
  const legs = [];

  for (let i = 0; i < snapped.length - 1; i += 1) {
    const from = snapped[i];
    const to = snapped[i + 1];
    const legBearing = bearingDeg(from.lat, from.lng, to.lat, to.lng);
    const seg = await fetchOsrmStrictSegment(from, to, legBearing);
    if (!seg?.polyline?.length) {
      throw new Error(`No drivable road between waypoint ${i + 1} and ${i + 2}. Add an intermediate point.`);
    }

    const legPoly = [...seg.polyline];
    legPoly[0] = { lat: from.lat, lng: from.lng };
    legPoly[legPoly.length - 1] = { lat: to.lat, lng: to.lng };

    if (polyline.length) polyline.push(...legPoly.slice(1));
    else polyline = legPoly;

    legs.push(legPoly);
    totalDistanceM += seg.distance_m ?? polylineDistanceM(legPoly);
    totalDurationS += seg.duration_s ?? 0;
  }

  polyline = injectWaypointIntoPolyline(polyline, snapped[0], 0);
  polyline = injectWaypointIntoPolyline(polyline, snapped[snapped.length - 1], polyline.length - 1);
  for (let i = 1; i < snapped.length - 1; i += 1) {
    polyline = injectWaypointAtNearestIndex(polyline, snapped[i]);
  }

  return {
    distance_km: Math.round((totalDistanceM / 1000) * 100) / 100,
    osrm_distance_km: Math.round((totalDistanceM / 1000) * 100) / 100,
    duration_min: Math.max(1, Math.round(totalDurationS / 60)),
    polyline,
    legs,
    waypoints: pts,
    strict: true,
  };
}

/** Snap a point to the nearest drivable road (OSRM nearest). */
async function snapPointToRoad(lat, lng) {
  const url = `${OSRM}/nearest/v1/driving/${Number(lng)},${Number(lat)}?number=1`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { lat, lng };
  const data = await res.json();
  const loc = data.waypoints?.[0]?.location;
  if (!loc || data.code !== 'Ok') return { lat, lng };
  return { lat: Number(loc[1]), lng: Number(loc[0]) };
}

/** Route one leg with bearing + tight search radius so OSRM follows the plotted direction. */
async function fetchOsrmStrictSegment(from, to, bearing) {
  const b = Math.round((bearing + 360) % 360);
  const range = 30;
  const radiusM = 80;
  const coordStr = `${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}`;
  const url = `${OSRM}/${coordStr}?overview=full&geometries=geojson&steps=false&alternatives=false&continue_straight=false&bearings=${b},${range};${b},${range}&radiuses=${radiusM};${radiusM}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    return fetchOsrmStrictSegmentFallback(from, to);
  }
  const route = data.routes[0];
  const coords = route.geometry?.coordinates || [];
  return {
    polyline: coords.map(([lng, lat]) => ({ lat, lng })),
    distance_m: route.distance,
    duration_s: route.duration,
  };
}

/** Fallback without bearings when a sharp turn blocks strict bearing constraints. */
async function fetchOsrmStrictSegmentFallback(from, to) {
  const coordStr = `${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}`;
  const url = `${OSRM}/${coordStr}?overview=full&geometries=geojson&steps=false&alternatives=false&continue_straight=false&radiuses=120;120`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) return null;
  const route = data.routes[0];
  const coords = route.geometry?.coordinates || [];
  return {
    polyline: coords.map(([lng, lat]) => ({ lat, lng })),
    distance_m: route.distance,
    duration_s: route.duration,
  };
}

function samePoint(a, b, tolM = 8) {
  if (!a || !b) return false;
  const dLat = (a.lat - b.lat) * 111320;
  const dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) <= tolM;
}

function injectWaypointIntoPolyline(polyline, waypoint, forceIndex) {
  if (!polyline?.length || !waypoint) return polyline;
  if (forceIndex === 0) return [{ lat: waypoint.lat, lng: waypoint.lng }, ...polyline.slice(1)];
  if (forceIndex != null && forceIndex >= polyline.length - 1) {
    return [...polyline.slice(0, -1), { lat: waypoint.lat, lng: waypoint.lng }];
  }
  return polyline;
}

/** Insert a via-point into the polyline at the closest index so the route visibly passes through it. */
function injectWaypointAtNearestIndex(polyline, waypoint) {
  if (!polyline?.length || !waypoint) return polyline;
  if (polyline.some((p) => samePoint(p, waypoint))) return polyline;

  let bestIdx = 1;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i += 1) {
    const d = pointToSegmentDistM(waypoint, polyline[i], polyline[Math.min(i + 1, polyline.length - 1)]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i + 1;
    }
  }
  const next = [...polyline];
  next.splice(bestIdx, 0, { lat: waypoint.lat, lng: waypoint.lng });
  return next;
}

async function fetchOsrmRoutes(lngLatPairs, { alternatives = false } = {}) {
  const coordStr = lngLatPairs.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${OSRM}/${coordStr}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives ? 'true' : 'false'}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Route lookup failed (${res.status})`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data.message || 'No driving route found between these points');
  }
  return data.routes.map((route) => {
    const coords = route.geometry?.coordinates || [];
    const polyline = coords.map(([lng, lat]) => ({ lat, lng }));
    const osrmDistanceKm = Math.round((route.distance / 1000) * 100) / 100;
    const geometryDistanceKm = polylineDistanceKm(polyline);
    return {
      distance_km: geometryDistanceKm ?? osrmDistanceKm,
      osrm_distance_km: osrmDistanceKm,
      duration_min: Math.round(route.duration / 60),
      polyline,
    };
  });
}

function pointToSegmentDistM(p, a, b) {
  const lat = p.lat;
  const lng = p.lng;
  const lat1 = a.lat;
  const lng1 = a.lng;
  const lat2 = b.lat;
  const lng2 = b.lng;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const x = lat * mPerDegLat;
  const y = lng * mPerDegLng;
  const x1 = lat1 * mPerDegLat;
  const y1 = lng1 * mPerDegLng;
  const x2 = lat2 * mPerDegLat;
  const y2 = lng2 * mPerDegLng;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function minDistToPolylineM(point, polyline) {
  if (!polyline?.length) return Infinity;
  if (polyline.length === 1) return polylineDistanceM([point, polyline[0]]);
  let min = Infinity;
  for (let i = 1; i < polyline.length; i += 1) {
    min = Math.min(min, pointToSegmentDistM(point, polyline[i - 1], polyline[i]));
  }
  return min;
}

/** True when two routes follow the same road (avg sample distance below threshold). */
export function routesSimilar(routeA, routeB, thresholdM = 180) {
  const a = routeA?.polyline;
  const b = routeB?.polyline;
  if (!a?.length || !b?.length) return false;
  const shorter = a.length <= b.length ? a : b;
  const other = shorter === a ? b : a;
  const step = Math.max(1, Math.floor(shorter.length / 14));
  let total = 0;
  let count = 0;
  for (let i = 0; i < shorter.length; i += step) {
    total += minDistToPolylineM(shorter[i], other);
    count += 1;
  }
  return count > 0 && total / count < thresholdM;
}

function mergeUniqueRoutes(existing, candidate) {
  if (!candidate?.polyline?.length) return existing;
  if (existing.some((r) => routesSimilar(r, candidate))) return existing;
  return [...existing, candidate];
}

/** Probe the road network with via-waypoints to discover more distinct paths A→B (up to 8). */
export async function drivingRouteAlternativesDeep(fromLat, fromLng, toLat, toLng, { maxRoutes = 8 } = {}) {
  const base = await drivingRouteAlternatives(fromLat, fromLng, toLat, toLng);
  let collected = [...base];

  const directM = polylineDistanceM([{ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }]);
  if (directM < 500) return collected.map((r, index) => ({ ...r, index }));

  const abBearing = bearingDeg(fromLat, fromLng, toLat, toLng);
  const probes = [];

  const addProbe = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (probes.some((p) => p.key === key)) return;
    probes.push({ key, lat, lng });
  };

  for (const frac of [0.3, 0.45, 0.55, 0.7]) {
    const lat = fromLat + (toLat - fromLat) * frac;
    const lng = fromLng + (toLng - fromLng) * frac;
    for (const side of [-90, 90]) {
      for (const off of [0.06, 0.12, 0.2, 0.28]) {
        const distM = Math.max(800, directM * off);
        const wp = offsetPoint(lat, lng, (abBearing + side + 360) % 360, distM);
        addProbe(wp.lat, wp.lng);
      }
    }
  }

  for (const route of base) {
    const pl = route.polyline || [];
    if (pl.length < 8) continue;
    for (const frac of [0.25, 0.5, 0.75]) {
      const pt = pl[Math.min(pl.length - 1, Math.floor(pl.length * frac))];
      for (const side of [-90, 90]) {
        const distM = Math.max(1000, directM * 0.1);
        const wp = offsetPoint(pt.lat, pt.lng, (abBearing + side + 360) % 360, distM);
        addProbe(wp.lat, wp.lng);
      }
    }
  }

  const batchSize = 4;
  for (let i = 0; i < probes.length && collected.length < maxRoutes; i += batchSize) {
    const batch = probes.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((wp) => fetchOsrmRoutes(
        [[fromLng, fromLat], [wp.lng, wp.lat], [toLng, toLat]],
        { alternatives: false }
      ))
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const route of result.value) {
        collected = mergeUniqueRoutes(collected, route);
        if (collected.length >= maxRoutes) break;
      }
    }
  }

  return collected
    .sort((a, b) => (a.duration_min - b.duration_min) || (a.distance_km - b.distance_km))
    .slice(0, maxRoutes)
    .map((r, index) => ({ ...r, index }));
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
