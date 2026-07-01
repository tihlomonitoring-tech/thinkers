/** Record and query GPS breadcrumb trails for fleet trips. */

import { haversineMeters } from './geo.js';
import { bearingDeg, offsetPoint, parseCorridorPolyline } from './routeCorridorGeofence.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

async function positionsTableExists(query) {
  try {
    const r = await query(
      `SELECT CASE WHEN OBJECT_ID(N'fleet_trip_position', N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`,
      {}
    );
    return !!get(r.recordset?.[0], 'ok');
  } catch {
    return false;
  }
}

const MIN_MOVE_M = 8;
const MIN_INTERVAL_MS = 15_000;
const MERGE_DEDUPE_M = 12;

function mapPoint(lat, lng, extra = {}) {
  return {
    lat: Number(lat),
    lng: Number(lng),
    ...extra,
  };
}

function trailDistanceM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return total;
}

function mergeTrailPoints(sources) {
  const merged = sources
    .flat()
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => new Date(a.recorded_at || 0) - new Date(b.recorded_at || 0));

  const out = [];
  for (const point of merged) {
    const prev = out[out.length - 1];
    if (prev && haversineMeters(prev.lat, prev.lng, point.lat, point.lng) < MERGE_DEDUPE_M) continue;
    out.push(point);
  }
  return out;
}

function trimTrailToKm(points, km) {
  if (!points.length) return { points: [], distance_km: 0 };
  const maxM = km * 1000;
  const trail = [points[points.length - 1]];
  let accumulatedM = 0;

  for (let i = points.length - 2; i >= 0; i--) {
    const cur = points[i];
    const next = trail[0];
    accumulatedM += haversineMeters(cur.lat, cur.lng, next.lat, next.lng);
    trail.unshift(cur);
    if (accumulatedM >= maxM) break;
  }

  return {
    points: trail,
    distance_km: Math.round((trailDistanceM(trail) / 1000) * 100) / 100,
  };
}

function closestPolylineIndex(polyline, lat, lng) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(lat, lng, polyline[i].lat, polyline[i].lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function slicePolylineBack(polyline, startIdx, maxM) {
  const trail = [polyline[startIdx]];
  let acc = 0;
  for (let i = startIdx; i > 0; i--) {
    acc += haversineMeters(polyline[i].lat, polyline[i].lng, polyline[i - 1].lat, polyline[i - 1].lng);
    trail.unshift(polyline[i - 1]);
    if (acc >= maxM) break;
  }
  return trail;
}

function buildHeadingTrail(lat, lng, headingDeg, maxM, stepM = 35) {
  const reverseBearing = (Number(headingDeg) + 180) % 360;
  const points = [mapPoint(lat, lng, { source: 'heading' })];
  let remaining = maxM;
  let curLat = lat;
  let curLng = lng;
  while (remaining > 0) {
    const step = Math.min(stepM, remaining);
    const next = offsetPoint(curLat, curLng, reverseBearing, step);
    points.unshift(mapPoint(next.lat, next.lng, { source: 'heading' }));
    curLat = next.lat;
    curLng = next.lng;
    remaining -= step;
  }
  return points;
}

async function loadStoredTrailPoints(query, tenantId, tripId) {
  if (!(await positionsTableExists(query))) return [];
  const r = await query(
    `SELECT lat, lng, speed_kmh, heading_deg, recorded_at
     FROM fleet_trip_position
     WHERE tenant_id = @tenantId AND trip_id = @tripId
     ORDER BY recorded_at ASC`,
    { tenantId, tripId }
  );
  return (r.recordset || []).map((row) =>
    mapPoint(get(row, 'lat'), get(row, 'lng'), {
      speed_kmh: get(row, 'speed_kmh') != null ? Number(get(row, 'speed_kmh')) : null,
      heading_deg: get(row, 'heading_deg') != null ? Number(get(row, 'heading_deg')) : null,
      recorded_at: get(row, 'recorded_at'),
      source: 'gps',
    })
  );
}

async function loadSupplementaryTrailPoints(query, tenantId, tripId) {
  const points = [];
  const alarms = await query(
    `SELECT lat, lng, occurred_at FROM tracking_alarm_record
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND lat IS NOT NULL AND lng IS NOT NULL
     ORDER BY occurred_at ASC`,
    { tenantId, tripId }
  );
  for (const row of alarms.recordset || []) {
    points.push(
      mapPoint(get(row, 'lat'), get(row, 'lng'), {
        recorded_at: get(row, 'occurred_at'),
        source: 'alarm',
      })
    );
  }

  const deviations = await query(
    `SELECT lat, lng, occurred_at FROM fleet_trip_deviation
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND lat IS NOT NULL AND lng IS NOT NULL
     ORDER BY occurred_at ASC`,
    { tenantId, tripId }
  );
  for (const row of deviations.recordset || []) {
    points.push(
      mapPoint(get(row, 'lat'), get(row, 'lng'), {
        recorded_at: get(row, 'occurred_at'),
        source: 'deviation',
      })
    );
  }
  return points;
}

async function loadRoutePolylineTrail(query, tenantId, contractorRouteId, lat, lng, maxM) {
  if (!contractorRouteId) return [];
  const r = await query(
    `SELECT polygon_json FROM tracking_geofence
     WHERE tenant_id = @tenantId AND contractor_route_id = @routeId
       AND leg IN (N'corridor', N'corridor_alt')
     ORDER BY CASE leg WHEN N'corridor' THEN 0 ELSE 1 END, created_at DESC`,
    { tenantId, routeId: contractorRouteId }
  );

  let bestPolyline = null;
  let bestDist = Infinity;
  for (const row of r.recordset || []) {
    const polyline = parseCorridorPolyline(get(row, 'polygon_json'));
    if (!polyline?.length) continue;
    const idx = closestPolylineIndex(polyline, lat, lng);
    const d = haversineMeters(lat, lng, polyline[idx].lat, polyline[idx].lng);
    if (d < bestDist) {
      bestDist = d;
      bestPolyline = polyline;
    }
  }

  if (!bestPolyline?.length) return [];
  const idx = closestPolylineIndex(bestPolyline, lat, lng);
  return slicePolylineBack(bestPolyline, idx, maxM).map((p) =>
    mapPoint(p.lat, p.lng, { source: 'route' })
  );
}

/** Append a GPS point when the truck moved or enough time passed. */
export async function recordTripPosition(query, tenantId, tripId, payload) {
  if (!(await positionsTableExists(query))) return;
  const lat = payload?.lat != null ? Number(payload.lat) : null;
  const lng = payload?.lng != null ? Number(payload.lng) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const lastR = await query(
    `SELECT TOP 1 lat, lng, recorded_at FROM fleet_trip_position
     WHERE tenant_id = @tenantId AND trip_id = @tripId ORDER BY recorded_at DESC`,
    { tenantId, tripId }
  );
  const last = lastR.recordset?.[0];
  if (last) {
    const lastLat = Number(get(last, 'lat'));
    const lastLng = Number(get(last, 'lng'));
    const moved = haversineMeters(lastLat, lastLng, lat, lng);
    const recordedAt = get(last, 'recorded_at');
    const elapsed = recordedAt ? Date.now() - new Date(recordedAt).getTime() : Infinity;
    if (moved < MIN_MOVE_M && elapsed < MIN_INTERVAL_MS) return;
  }

  await query(
    `INSERT INTO fleet_trip_position (tenant_id, trip_id, lat, lng, speed_kmh, heading_deg)
     VALUES (@tenantId, @tripId, @lat, @lng, @spd, @hdg)`,
    {
      tenantId,
      tripId,
      lat,
      lng,
      spd: payload?.speed_kmh ?? null,
      hdg: payload?.heading_deg ?? null,
    }
  );
}

/** Return chronological points covering up to `km` travelled (newest point last). */
export async function getTripTrailLastKm(query, tenantId, tripId, km = 2) {
  const requestedKm = Math.max(0.1, Math.min(50, Number(km) || 2));
  const maxM = requestedKm * 1000;
  const tableReady = await positionsTableExists(query);

  const tripR = await query(
    `SELECT last_lat, last_lng, last_heading_deg, last_seen_at, contractor_route_id
     FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
    { tenantId, id: tripId }
  );
  const trip = tripR.recordset?.[0];
  const curLat = get(trip, 'last_lat') != null ? Number(get(trip, 'last_lat')) : null;
  const curLng = get(trip, 'last_lng') != null ? Number(get(trip, 'last_lng')) : null;
  const curHeading = get(trip, 'last_heading_deg') != null ? Number(get(trip, 'last_heading_deg')) : null;
  const routeId = get(trip, 'contractor_route_id');

  if (!Number.isFinite(curLat) || !Number.isFinite(curLng)) {
    return { points: [], distance_km: 0, requested_km: requestedKm, table_ready: tableReady, source: 'none' };
  }

  const currentPoint = mapPoint(curLat, curLng, {
    recorded_at: get(trip, 'last_seen_at'),
    source: 'current',
  });

  const stored = tableReady ? await loadStoredTrailPoints(query, tenantId, tripId) : [];
  const supplementary = await loadSupplementaryTrailPoints(query, tenantId, tripId);
  let merged = mergeTrailPoints([stored, supplementary, [currentPoint]]);

  let source = stored.length >= 2 ? 'gps' : supplementary.length ? 'mixed' : 'none';
  let { points, distance_km: distanceKm } = trimTrailToKm(merged, requestedKm);

  if (points.length < 2 || trailDistanceM(points) < Math.min(maxM, 120)) {
    const routeTrail = await loadRoutePolylineTrail(query, tenantId, routeId, curLat, curLng, maxM);
    if (routeTrail.length >= 2) {
      merged = mergeTrailPoints([routeTrail, [currentPoint]]);
      ({ points, distance_km: distanceKm } = trimTrailToKm(merged, requestedKm));
      source = stored.length ? 'gps+route' : 'route';
    }
  }

  if (points.length < 2) {
    const heading = Number.isFinite(curHeading)
      ? curHeading
      : merged.length >= 2
        ? bearingDeg(
            merged[merged.length - 2].lat,
            merged[merged.length - 2].lng,
            curLat,
            curLng
          )
        : null;
    if (Number.isFinite(heading)) {
      const headingTrail = buildHeadingTrail(curLat, curLng, heading, maxM);
      ({ points, distance_km: distanceKm } = trimTrailToKm(headingTrail, requestedKm));
      source = stored.length ? 'gps+heading' : 'heading';
    }
  }

  if (points.length < 2 && Number.isFinite(curLat) && Number.isFinite(curLng)) {
    const fallback = buildHeadingTrail(curLat, curLng, curHeading || 0, Math.min(maxM, 400));
    points = fallback;
    distanceKm = Math.round((trailDistanceM(points) / 1000) * 100) / 100;
    source = 'estimated';
  }

  return {
    points,
    distance_km: distanceKm,
    requested_km: requestedKm,
    table_ready: tableReady,
    source,
  };
}

function averageSpeedKmh(points) {
  const speeds = points.map((p) => p.speed_kmh).filter((s) => Number.isFinite(s) && s > 0);
  if (speeds.length) {
    return Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10;
  }
  return null;
}

/** Total trip distance from GPS breadcrumbs, with route-distance fallback. */
export async function getTripTotalDistanceKm(query, tenantId, tripId) {
  const tripR = await query(
    `SELECT last_speed_kmh, contractor_route_id, collection_point_name, destination_name
     FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
    { tenantId, id: tripId }
  );
  const trip = tripR.recordset?.[0];
  if (!trip) return { distance_km: null, avg_speed_kmh: null, source: 'none', origin_name: null, destination_name: null };

  const stored = (await positionsTableExists(query))
    ? await loadStoredTrailPoints(query, tenantId, tripId)
    : [];
  if (stored.length >= 2) {
    const distanceKm = Math.round((trailDistanceM(stored) / 1000) * 100) / 100;
    const avgSpeed = averageSpeedKmh(stored) ?? (get(trip, 'last_speed_kmh') != null ? Number(get(trip, 'last_speed_kmh')) : null);
    return {
      distance_km: distanceKm,
      avg_speed_kmh: avgSpeed,
      source: 'gps_trail',
      origin_name: get(trip, 'collection_point_name'),
      destination_name: get(trip, 'destination_name'),
    };
  }

  const routeId = get(trip, 'contractor_route_id');
  if (routeId) {
    const rr = await query(
      `SELECT COALESCE(reg.distance_km, r.distance_km) AS distance_km,
              r.loading_address, r.destination_address
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @tenantId
       WHERE r.id = @routeId AND r.tenant_id = @tenantId`,
      { tenantId, routeId }
    );
    const row = rr.recordset?.[0];
    const distanceKm = row && get(row, 'distance_km') != null ? Number(get(row, 'distance_km')) : null;
    if (distanceKm > 0) {
      return {
        distance_km: Math.round(distanceKm * 100) / 100,
        avg_speed_kmh: get(trip, 'last_speed_kmh') != null ? Number(get(trip, 'last_speed_kmh')) : null,
        source: 'route_distance',
        origin_name: get(trip, 'collection_point_name') || get(row, 'loading_address'),
        destination_name: get(trip, 'destination_name') || get(row, 'destination_address'),
      };
    }
  }

  return {
    distance_km: null,
    avg_speed_kmh: get(trip, 'last_speed_kmh') != null ? Number(get(trip, 'last_speed_kmh')) : null,
    source: 'none',
    origin_name: get(trip, 'collection_point_name'),
    destination_name: get(trip, 'destination_name'),
  };
}
