/**
 * Resolve empty-return leg after offloading: destination → next loading site
 * (same origin or a different scheduled route), using GPS trail when available.
 */

import { haversineMeters } from './geo.js';
import { isInsideGeofence } from './trackingGeofence.js';
import { resolveRouteOrigin } from './logisticsFlowWhatsApp.js';
import { parseGuid } from './guidUtils.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : null;
}

function gid(v) {
  return parseGuid(v);
}

function normReg(reg) {
  return String(reg || '').trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function averageSpeed(points) {
  const speeds = (points || []).map((p) => p.speed_kmh).filter((s) => Number.isFinite(s) && s > 0);
  if (!speeds.length) return null;
  return round2(speeds.reduce((a, b) => a + b, 0) / speeds.length);
}

function trailDistanceKm(points) {
  let totalM = 0;
  for (let i = 1; i < points.length; i++) {
    totalM += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return round2(totalM / 1000);
}

function pointInsideFence(lat, lng, fence) {
  return isInsideGeofence(lat, lng, {
    center_lat: get(fence, 'center_lat'),
    center_lng: get(fence, 'center_lng'),
    radius_m: get(fence, 'radius_m'),
    polygon_json: get(fence, 'polygon_json'),
  });
}

async function loadRouteMeta(query, tenantId, routeId) {
  if (!routeId) return null;
  const r = await query(
    `SELECT id, name, starting_point, destination, loading_address, destination_address, distance_km
     FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
    { tenantId, routeId }
  );
  return r.recordset?.[0] || null;
}

async function loadRouteGeofences(query, tenantId, routeId, leg) {
  if (!routeId) return [];
  const r = await query(
    `SELECT center_lat, center_lng, radius_m, polygon_json, leg
     FROM tracking_geofence
     WHERE tenant_id = @tenantId AND contractor_route_id = @routeId AND leg = @leg`,
    { tenantId, routeId, leg }
  );
  return r.recordset || [];
}

async function geofenceCentroid(query, tenantId, routeId, leg) {
  const fences = await loadRouteGeofences(query, tenantId, routeId, leg);
  const pts = [];
  for (const f of fences) {
    const lat = get(f, 'center_lat');
    const lng = get(f, 'center_lng');
    if (lat != null && lng != null) pts.push({ lat: Number(lat), lng: Number(lng) });
  }
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat, lng };
}

/** Straight-line road estimate between route legs (destination → next origin). */
async function estimateLegToLegDistanceKm(query, tenantId, fromRouteId, toRouteId, fallbackKm) {
  const [fromCent, toCent] = await Promise.all([
    geofenceCentroid(query, tenantId, fromRouteId, 'destination'),
    geofenceCentroid(query, tenantId, toRouteId, 'origin'),
  ]);
  if (fromCent && toCent) {
    const m = haversineMeters(fromCent.lat, fromCent.lng, toCent.lat, toCent.lng);
    if (m > 500) return round2((m / 1000) * 1.18);
  }
  if (toRouteId && toRouteId !== fromRouteId) {
    const route = await loadRouteMeta(query, tenantId, toRouteId);
    const km = route && get(route, 'distance_km') != null ? Number(get(route, 'distance_km')) : null;
    if (km > 0) return round2(km);
  }
  return fallbackKm > 0 ? round2(fallbackKm) : null;
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

/**
 * GPS distance from offloading time until truck enters the target loading geofence.
 */
async function gpsReturnTrailKm(query, tenantId, {
  truckRegistration,
  deliveredAt,
  targetRouteId,
  maxHours = 96,
}) {
  if (!(await positionsTableExists(query))) return null;
  const reg = normReg(truckRegistration);
  if (!reg || !deliveredAt) return null;

  const from = new Date(deliveredAt);
  if (Number.isNaN(from.getTime())) return null;
  const to = new Date(from.getTime() + maxHours * 3600 * 1000);

  const r = await query(
    `SELECT p.lat, p.lng, p.speed_kmh, p.recorded_at
     FROM fleet_trip_position p
     INNER JOIN fleet_trip t ON t.id = p.trip_id AND t.tenant_id = p.tenant_id
     WHERE p.tenant_id = @tenantId
       AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(t.truck_registration)), ' ', ''), '-', '')) = @reg
       AND p.recorded_at >= @from AND p.recorded_at <= @to
     ORDER BY p.recorded_at ASC`,
    { tenantId, reg, from, to }
  );

  const raw = (r.recordset || [])
    .map((row) => ({
      lat: Number(get(row, 'lat')),
      lng: Number(get(row, 'lng')),
      speed_kmh: get(row, 'speed_kmh') != null ? Number(get(row, 'speed_kmh')) : null,
      recorded_at: get(row, 'recorded_at'),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (raw.length < 2) return null;

  const fences = targetRouteId ? await loadRouteGeofences(query, tenantId, targetRouteId, 'origin') : [];
  const trail = [raw[0]];
  let arrived = false;

  for (let i = 1; i < raw.length; i++) {
    const pt = raw[i];
    trail.push(pt);
    if (fences.length && fences.some((f) => pointInsideFence(pt.lat, pt.lng, f))) {
      arrived = true;
      break;
    }
  }

  const distanceKm = trailDistanceKm(trail);
  if (distanceKm < 0.5) return null;

  return {
    distance_km: distanceKm,
    avg_speed_kmh: averageSpeed(trail),
    calc_source: arrived ? 'gps_return_trail' : 'gps_return_partial',
    arrived,
  };
}

/**
 * Determine where the truck went after offloading: back to same loading origin or next route.
 */
export async function findReturnTarget(query, tenantId, {
  tripId,
  truckRegistration,
  deliveredAt,
  loadedRouteId,
  loadedOriginName,
  loadedDestinationName,
}) {
  const loadedRid = gid(loadedRouteId);
  let trip = null;

  if (tripId) {
    const tr = await query(
      `SELECT id, contractor_route_id, route_id, activity_stage, at_loading_at, scheduled_at,
              collection_point_name, destination_name, truck_registration
       FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id: tripId }
    );
    trip = tr.recordset?.[0] || null;
  }

  const reg = normReg(truckRegistration || get(trip, 'truck_registration'));
  const delivered = deliveredAt ? new Date(deliveredAt) : null;

  if (!trip && reg) {
    const tr = await query(
      `SELECT TOP 1 id, contractor_route_id, route_id, activity_stage, at_loading_at, scheduled_at,
              collection_point_name, destination_name, truck_registration
       FROM fleet_trip
       WHERE tenant_id = @tenantId
         AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(truck_registration)), ' ', ''), '-', '')) = @reg
         AND status NOT IN (N'completed', N'cancelled')
       ORDER BY updated_at DESC`,
      { tenantId, reg }
    );
    trip = tr.recordset?.[0] || null;
  }

  const currentRouteId = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));
  const atLoadingAt = get(trip, 'at_loading_at');
  const stage = String(get(trip, 'activity_stage') || '').toLowerCase();

  const arrivedAtNextLoading = atLoadingAt && delivered && new Date(atLoadingAt) >= delivered;

  if (currentRouteId && loadedRid && currentRouteId !== loadedRid
    && (arrivedAtNextLoading || ['scheduled', 'at_loading'].includes(stage))) {
    const routeMeta = await loadRouteMeta(query, tenantId, currentRouteId);
    return {
      kind: 'next_loading_site',
      target_route_id: currentRouteId,
      from_route_id: loadedRid,
      target_name: resolveRouteOrigin(routeMeta) || get(trip, 'collection_point_name'),
      from_name: loadedDestinationName,
      trip_id: gid(get(trip, 'id')) || tripId,
      arrived: !!arrivedAtNextLoading,
    };
  }

  if (arrivedAtNextLoading || stage === 'at_loading' || stage === 'scheduled') {
    const routeMeta = loadedRid ? await loadRouteMeta(query, tenantId, loadedRid) : null;
    return {
      kind: 'return_to_origin',
      target_route_id: loadedRid,
      from_route_id: loadedRid,
      target_name: loadedOriginName || resolveRouteOrigin(routeMeta),
      from_name: loadedDestinationName,
      trip_id: gid(get(trip, 'id')) || tripId,
      arrived: !!arrivedAtNextLoading,
    };
  }

  // Another trip scheduled on a different route after this delivery
  if (reg && delivered) {
    const nr = await query(
      `SELECT TOP 1 t.id, t.contractor_route_id, t.route_id, t.collection_point_name, t.scheduled_at, t.at_loading_at
       FROM fleet_trip t
       WHERE t.tenant_id = @tenantId
         AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(t.truck_registration)), ' ', ''), '-', '')) = @reg
         AND t.id <> COALESCE(@tripId, '00000000-0000-0000-0000-000000000000')
         AND COALESCE(t.scheduled_at, t.created_at) >= DATEADD(hour, -2, @delivered)
       ORDER BY COALESCE(t.at_loading_at, t.scheduled_at, t.created_at) ASC`,
      { tenantId, reg, tripId: tripId || null, delivered }
    );
    const next = nr.recordset?.[0];
    const nextRid = gid(get(next, 'contractor_route_id')) || gid(get(next, 'route_id'));
    if (next && nextRid && nextRid !== loadedRid) {
      const routeMeta = await loadRouteMeta(query, tenantId, nextRid);
      return {
        kind: 'next_loading_site',
        target_route_id: nextRid,
        from_route_id: loadedRid,
        target_name: resolveRouteOrigin(routeMeta) || get(next, 'collection_point_name'),
        from_name: loadedDestinationName,
        trip_id: gid(get(next, 'id')),
        arrived: !!get(next, 'at_loading_at'),
      };
    }
  }

  const routeMeta = loadedRid ? await loadRouteMeta(query, tenantId, loadedRid) : null;
  return {
    kind: 'return_to_origin',
    target_route_id: loadedRid,
    from_route_id: loadedRid,
    target_name: loadedOriginName || resolveRouteOrigin(routeMeta),
    from_name: loadedDestinationName,
    trip_id: tripId,
    arrived: false,
  };
}

/**
 * Resolve return-leg distance & metadata for empty haul after offloading.
 */
export async function resolveReturnLeg(query, tenantId, {
  deliveryRow,
  tripRow,
  loadedRouteId,
  loadedDistanceKm,
  loadedOriginName,
  loadedDestinationName,
  loadedAvgSpeed,
  deliveredAt,
}) {
  const truckRegistration = get(deliveryRow, 'truck_registration') || get(tripRow, 'truck_registration');
  const tripId = gid(get(deliveryRow, 'trip_id') || get(tripRow, 'id'));
  const delivered = deliveredAt || get(deliveryRow, 'delivered_at');

  const target = await findReturnTarget(query, tenantId, {
    tripId,
    truckRegistration,
    deliveredAt: delivered,
    loadedRouteId,
    loadedOriginName,
    loadedDestinationName,
  });

  const gps = await gpsReturnTrailKm(query, tenantId, {
    truckRegistration,
    deliveredAt: delivered,
    targetRouteId: target.target_route_id,
  });

  if (gps?.distance_km > 0) {
    return {
      return_distance_km: gps.distance_km,
      return_avg_speed_kmh: gps.avg_speed_kmh ?? loadedAvgSpeed,
      return_destination_name: target.target_name,
      return_origin_name: target.from_name,
      return_fuel_calc_source: gps.calc_source,
      return_target_kind: target.kind,
      return_arrived: gps.arrived,
    };
  }

  let distanceKm = null;
  let calcSource = 'route_distance_return';

  if (target.kind === 'next_loading_site' && target.from_route_id && target.target_route_id) {
    distanceKm = await estimateLegToLegDistanceKm(
      query,
      tenantId,
      target.from_route_id,
      target.target_route_id,
      loadedDistanceKm
    );
    calcSource = target.arrived ? 'next_loading_route' : 'next_loading_planned';
  } else {
    distanceKm = loadedDistanceKm > 0 ? loadedDistanceKm : null;
    calcSource = target.arrived ? 'origin_return' : 'origin_return_planned';
  }

  return {
    return_distance_km: distanceKm,
    return_avg_speed_kmh: loadedAvgSpeed,
    return_destination_name: target.target_name,
    return_origin_name: target.from_name,
    return_fuel_calc_source: calcSource,
    return_target_kind: target.kind,
    return_arrived: target.arrived,
  };
}

/** Return economics should be refreshed when truck has since arrived at next loading. */
export function returnLegNeedsRefresh(delivery, returnLeg) {
  if (!delivery || !returnLeg) return false;
  const prevSource = String(get(delivery, 'return_fuel_calc_source') || '');
  const prevArrived = get(delivery, 'return_arrived') === true || get(delivery, 'return_arrived') === 1;
  if (returnLeg.return_arrived && !prevArrived) return true;
  if (prevSource.endsWith('_planned') && returnLeg.return_arrived) return true;
  if (prevSource === 'route_distance_return' && returnLeg.return_fuel_calc_source?.startsWith('gps')) return true;
  return false;
}
