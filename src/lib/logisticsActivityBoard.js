import { todayYmd } from './appTime.js';
import { haversineMeters } from './geo.js';
import {
  distanceProgressAlongPolyline,
  parseCorridorPolyline,
  parseMonitorWaypoints,
  polylineDistanceKm,
} from './routeCorridorGeofence.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function gid(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.replace(/[{}]/g, '').toLowerCase();
  if (Buffer.isBuffer(v)) {
    const h = v.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toLowerCase();
  }
  return String(v);
}

export const ACTIVITY_STAGES = [
  { id: 'scheduled', label: 'Scheduled', hint: 'Awaiting arrival at loading geofence — or drag truck here' },
  { id: 'at_loading', label: 'At loading', hint: 'Capture loading slip — drag here if late to schedule' },
  { id: 'enroute', label: 'En route', hint: 'Tracked to destination — drag here to start tracking' },
  { id: 'at_destination', label: 'At destination', hint: 'Capture offloading slip to clear board' },
  { id: 'awaiting_reschedule', label: 'Awaiting reschedule', hint: 'Returns to At loading automatically at origin geofence' },
];

export function inferActivityStage(trip, openDelivery) {
  const explicit = String(get(trip, 'activity_stage') || '').toLowerCase();
  if (explicit && ACTIVITY_STAGES.some((s) => s.id === explicit)) return explicit;

  const status = String(get(trip, 'status') || '').toLowerCase();
  const phase = String(get(openDelivery, 'activity_phase') || '').toLowerCase();

  if (status === 'enroute' || status === 'deviated' || status === 'overdue') return 'enroute';
  if (status === 'pending' && phase === 'destination') return 'at_destination';
  if (explicit === 'awaiting_reschedule') return 'awaiting_reschedule';
  if (status === 'pending' && get(trip, 'at_loading_at')) return 'at_loading';
  if (get(trip, 'scheduled_at') && !get(trip, 'at_loading_at')) return 'scheduled';
  if (status === 'pending') return 'at_loading';
  return 'scheduled';
}

function roundKm2(km) {
  if (km == null || !Number.isFinite(Number(km))) return null;
  return Math.round(Number(km) * 100) / 100;
}

export function computeRouteDistances({
  activity_stage,
  last_lat,
  last_lng,
  destination_lat,
  destination_lng,
  route_polyline,
  route_distance_km,
  route_distance_source,
}) {
  const stage = String(activity_stage || '').toLowerCase();
  const polyline = route_polyline?.length >= 2 ? route_polyline : null;

  let totalKm = polyline ? polylineDistanceKm(polyline) : null;
  let basis = polyline ? 'road' : null;

  const recordKm = route_distance_km != null ? Number(route_distance_km) : null;
  if (totalKm == null && Number.isFinite(recordKm) && recordKm > 0) {
    totalKm = roundKm2(recordKm);
    basis = route_distance_source || 'record';
  }

  if (stage === 'awaiting_reschedule' || stage === 'at_destination') {
    return {
      route_distance_km: totalKm,
      km_remaining: 0,
      km_traveled: totalKm,
      distance_basis: basis || 'none',
      off_route_m: null,
    };
  }

  if (stage === 'scheduled' || stage === 'at_loading') {
    return {
      route_distance_km: totalKm,
      km_remaining: totalKm,
      km_traveled: 0,
      distance_basis: basis || 'none',
      off_route_m: null,
    };
  }

  if (stage === 'enroute') {
    const lat = last_lat != null ? Number(last_lat) : null;
    const lng = last_lng != null ? Number(last_lng) : null;

    if (polyline && Number.isFinite(lat) && Number.isFinite(lng)) {
      const prog = distanceProgressAlongPolyline(polyline, lat, lng);
      if (prog) {
        const routeTotal = roundKm2(prog.totalM / 1000);
        const remaining = roundKm2(prog.remainingM / 1000);
        const traveled = roundKm2(prog.traveledM / 1000);
        return {
          route_distance_km: routeTotal ?? totalKm,
          km_remaining: remaining,
          km_traveled: traveled,
          distance_basis: 'road',
          off_route_m: prog.offRouteM > 500 ? Math.round(prog.offRouteM) : null,
        };
      }
    }

    const dLat = destination_lat != null ? Number(destination_lat) : null;
    const dLng = destination_lng != null ? Number(destination_lng) : null;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(dLat) && Number.isFinite(dLng)) {
      const directKm = roundKm2(haversineMeters(lat, lng, dLat, dLng) / 1000);
      const capped = totalKm != null ? Math.min(directKm, totalKm) : directKm;
      const traveled = totalKm != null ? roundKm2(Math.max(0, totalKm - capped)) : null;
      return {
        route_distance_km: totalKm,
        km_remaining: capped,
        km_traveled: traveled,
        distance_basis: 'direct',
        off_route_m: null,
      };
    }

    return {
      route_distance_km: totalKm,
      km_remaining: totalKm,
      km_traveled: null,
      distance_basis: basis || 'none',
      off_route_m: null,
    };
  }

  return {
    route_distance_km: totalKm,
    km_remaining: null,
    km_traveled: null,
    distance_basis: basis || 'none',
    off_route_m: null,
  };
}

/** @deprecated Use computeRouteDistances — kept for callers expecting km only. */
export function computeKmRemaining(args) {
  return computeRouteDistances(args).km_remaining;
}

function geofenceSpanKm(originCoords, destCoords) {
  if (!originCoords || !destCoords) return null;
  const oLat = Number(originCoords.lat);
  const oLng = Number(originCoords.lng);
  const dLat = Number(destCoords.lat);
  const dLng = Number(destCoords.lng);
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    return null;
  }
  const m = haversineMeters(oLat, oLng, dLat, dLng);
  return roundKm2(m / 1000);
}

export function resolveRouteDistanceKm(route, originCoords, destCoords, routePolyline) {
  if (routePolyline?.length >= 2) {
    return polylineDistanceKm(routePolyline);
  }
  const fromRoute = route?.distance_km != null ? Number(route.distance_km) : null;
  if (Number.isFinite(fromRoute) && fromRoute > 0) return roundKm2(fromRoute);
  const span = geofenceSpanKm(originCoords, destCoords);
  return span != null && span > 0 ? roundKm2(span) : null;
}

export function resolveRouteDistanceSource(routePolyline, route) {
  if (routePolyline?.length >= 2) return 'road';
  const fromRoute = route?.distance_km != null ? Number(route.distance_km) : null;
  if (Number.isFinite(fromRoute) && fromRoute > 0) return 'record';
  return 'direct';
}

export function mapActivityTrip(row, openDelivery, routeMeta, originCoords, destCoords, alarmCounts, loadingDelivery, routePolylineMap) {
  const rid = gid(get(row, 'contractor_route_id')) || gid(get(row, 'route_id'));
  const route = routeMeta?.get(rid);
  const origin = originCoords?.get(rid);
  const dest = destCoords?.get(rid);
  const started = get(row, 'started_at');
  const hours = started ? (Date.now() - new Date(started).getTime()) / 3600000 : null;
  const stage = inferActivityStage(row, openDelivery);
  const tripId = gid(get(row, 'id'));
  const alarms = alarmCounts?.get(tripId) || {};

  const lastLat = get(row, 'last_lat') != null ? Number(get(row, 'last_lat')) : null;
  const lastLng = get(row, 'last_lng') != null ? Number(get(row, 'last_lng')) : null;
  const destLat = dest?.lat ?? null;
  const destLng = dest?.lng ?? null;
  const routePolyline = routePolylineMap?.get(rid) || null;
  const routeDistanceSource = resolveRouteDistanceSource(routePolyline, route);
  const routeDistanceKm = resolveRouteDistanceKm(route, origin, dest, routePolyline);

  const distances = computeRouteDistances({
    activity_stage: stage,
    last_lat: lastLat,
    last_lng: lastLng,
    destination_lat: destLat,
    destination_lng: destLng,
    route_polyline: routePolyline,
    route_distance_km: routeDistanceKm,
    route_distance_source: routeDistanceSource,
  });
  const kmRemaining = distances.km_remaining;

  const lastSpeed = get(row, 'last_speed_kmh') != null ? Number(get(row, 'last_speed_kmh')) : null;
  let etaMinutes = null;
  if (stage === 'enroute' && kmRemaining != null && kmRemaining > 0 && lastSpeed != null && lastSpeed >= 5) {
    etaMinutes = Math.round((kmRemaining / lastSpeed) * 60);
  }

  return {
    trip_id: tripId,
    trip_ref: get(row, 'trip_ref'),
    truck_registration: get(row, 'truck_registration'),
    contractor_name: get(row, 'contractor_name'),
    driver_name: get(row, 'driver_name') || get(row, 'linked_driver_name'),
    driver_phone: get(row, 'driver_phone') || get(row, 'linked_driver_phone'),
    contractor_route_id: rid,
    route_name: route?.name || get(row, 'collection_point_name') || '—',
    loading_address: route?.loading_address || get(row, 'collection_point_name'),
    destination_address: route?.destination_address || get(row, 'destination_name'),
    destination_name: get(row, 'destination_name') || route?.destination_address || route?.name,
    destination_lat: destLat,
    destination_lng: destLng,
    route_distance_km: distances.route_distance_km ?? routeDistanceKm,
    route_distance_source: routeDistanceSource,
    km_remaining: kmRemaining,
    km_traveled: distances.km_traveled,
    distance_basis: distances.distance_basis,
    off_route_m: distances.off_route_m,
    eta_minutes: etaMinutes,
    activity_stage: stage,
    status: get(row, 'status'),
    scheduled_at: get(row, 'scheduled_at'),
    at_loading_at: get(row, 'at_loading_at'),
    at_destination_at: get(row, 'at_destination_at'),
    completed_at: get(row, 'completed_at'),
    loading_slip_no: get(row, 'loading_slip_no'),
    loading_slip_deferred: !!get(row, 'loading_slip_deferred'),
    offloading_slip_no: get(row, 'offloading_slip_no'),
    delivery_id: openDelivery ? gid(get(openDelivery, 'id')) : null,
    delivery_note_no: get(openDelivery, 'delivery_note_no'),
    tons_loaded: get(loadingDelivery, 'tons_loaded') != null
      ? Number(get(loadingDelivery, 'tons_loaded'))
      : (get(openDelivery, 'tons_loaded') != null ? Number(get(openDelivery, 'tons_loaded')) : null),
    loading_notes: get(loadingDelivery, 'notes') || null,
    pending_note: openDelivery ? !!get(openDelivery, 'pending_note') : false,
    activity_phase: get(openDelivery, 'activity_phase'),
    hours_on_route: hours != null ? Math.round(hours * 100) / 100 : null,
    deviation_count: get(row, 'deviation_count') || alarms.deviation_count || 0,
    overspeed_count: alarms.overspeed_count || 0,
    is_overdue: !!get(row, 'is_overdue'),
    last_seen_at: get(row, 'last_seen_at'),
    last_lat: lastLat,
    last_lng: lastLng,
    last_speed_kmh: lastSpeed,
    last_heading_deg: get(row, 'last_heading_deg') != null ? Number(get(row, 'last_heading_deg')) : null,
    needs_action: stage === 'at_loading' || stage === 'at_destination' || stage === 'awaiting_reschedule',
  };
}

const UNASSIGNED_ROUTE_ID = '__unassigned__';

function emptyRouteSummary(routeId, routeName, loadingAddress, destinationAddress) {
  return {
    route_id: routeId,
    route_name: routeName,
    loading_address: loadingAddress || null,
    destination_address: destinationAddress || null,
    total: 0,
    scheduled: 0,
    at_loading: 0,
    enroute: 0,
    at_destination: 0,
    awaiting_reschedule: 0,
    action_needed: 0,
    alerts: 0,
    priority_score: 0,
    priority_reason: null,
  };
}

/** Per-route intelligence for filters and auto-alternate rotation. */
export function buildRouteSummaries(items, routes) {
  const map = new Map();
  for (const r of routes || []) {
    map.set(r.id, emptyRouteSummary(r.id, r.name, r.loading_address, r.destination_address));
  }
  map.set(UNASSIGNED_ROUTE_ID, emptyRouteSummary(UNASSIGNED_ROUTE_ID, 'Unassigned', null, null));

  for (const item of items || []) {
    const rid = item.contractor_route_id || UNASSIGNED_ROUTE_ID;
    if (!map.has(rid)) {
      map.set(rid, emptyRouteSummary(rid, item.route_name || 'Unknown route', item.loading_address, item.destination_address));
    }
    const s = map.get(rid);
    s.total += 1;
    const stage = item.activity_stage;
    if (stage === 'scheduled') s.scheduled += 1;
    else if (stage === 'at_loading') s.at_loading += 1;
    else if (stage === 'enroute') s.enroute += 1;
    else if (stage === 'at_destination') s.at_destination += 1;
    else if (stage === 'awaiting_reschedule') s.awaiting_reschedule += 1;
    if (item.needs_action) s.action_needed += 1;
    if (item.is_overdue || item.deviation_count > 0 || item.overspeed_count > 0) s.alerts += 1;
  }

  const summaries = [...map.values()].filter((s) => s.total > 0 || (routes || []).some((r) => r.id === s.route_id));

  for (const s of summaries) {
    s.priority_score =
      s.action_needed * 100 +
      s.alerts * 45 +
      s.at_loading * 25 +
      s.at_destination * 30 +
      s.awaiting_reschedule * 35 +
      s.enroute * 8 +
      s.scheduled * 3;
    if (s.action_needed > 0) s.priority_reason = `${s.action_needed} slip(s) awaiting capture`;
    else if (s.alerts > 0) s.priority_reason = `${s.alerts} alert(s) on route`;
    else if (s.enroute > 0) s.priority_reason = `${s.enroute} en route`;
    else if (s.total > 0) s.priority_reason = `${s.total} active truck(s)`;
    else s.priority_reason = 'No activity';
  }

  summaries.sort((a, b) => b.priority_score - a.priority_score || b.total - a.total || a.route_name.localeCompare(b.route_name));
  return summaries;
}

export function filterBoardStages(stages, routeId) {
  if (!routeId || routeId === 'all') return stages;
  return (stages || []).map((stage) => {
    const items = (stage.items || []).filter((item) =>
      routeId === UNASSIGNED_ROUTE_ID ? !item.contractor_route_id : item.contractor_route_id === routeId
    );
    return { ...stage, items, count: items.length };
  });
}

export { UNASSIGNED_ROUTE_ID };

/** Active logistics activity board grouped by stage (aviation-style lanes). */
export async function buildLogisticsActivityBoard(query, tenantId) {
  const [tripsR, routesR, deliveriesR, geofencesR, alarmsR, corridorR, monitorR] = await Promise.all([
    query(
      `SELECT t.*, c.name AS contractor_name,
              (SELECT TOP 1 d.full_name FROM contractor_drivers d
               WHERE d.linked_truck_id = ct.id AND d.tenant_id = t.tenant_id) AS linked_driver_name,
              (SELECT TOP 1 d.phone FROM contractor_drivers d
               WHERE d.linked_truck_id = ct.id AND d.tenant_id = t.tenant_id) AS linked_driver_phone
       FROM fleet_trip t
       LEFT JOIN contractor_trucks ct ON ct.id = t.contractor_truck_id AND ct.tenant_id = t.tenant_id
       LEFT JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = t.tenant_id
       WHERE t.tenant_id = @tenantId
         AND t.status NOT IN (N'completed', N'cancelled')
         AND (
           t.activity_stage IS NOT NULL
           OR t.scheduled_at IS NOT NULL
           OR t.status IN (N'pending', N'enroute', N'deviated', N'overdue')
         )
       ORDER BY t.updated_at DESC`,
      { tenantId }
    ),
    query(
      `SELECT r.id, r.name, r.loading_address, r.destination_address,
              COALESCE(reg.distance_km, r.distance_km) AS distance_km
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @tenantId
       WHERE r.tenant_id = @tenantId
       ORDER BY r.[order], r.name`,
      { tenantId }
    ),
    query(
      `SELECT d.* FROM tracking_delivery_record d
       INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId
         AND d.deleted_at IS NULL
         AND t.status NOT IN (N'completed', N'cancelled')
         AND (d.pending_note = 1 OR d.activity_phase IS NOT NULL)
       ORDER BY d.delivered_at DESC`,
      { tenantId }
    ),
    query(
      `SELECT contractor_route_id, leg, center_lat, center_lng FROM tracking_geofence
       WHERE tenant_id = @tenantId AND leg IN (N'origin', N'destination')
         AND contractor_route_id IS NOT NULL AND center_lat IS NOT NULL AND center_lng IS NOT NULL`,
      { tenantId }
    ),
    query(
      `SELECT trip_id, alarm_type, COUNT(*) AS cnt FROM tracking_alarm_record
       WHERE tenant_id = @tenantId AND alarm_type IN (N'overspeed', N'deviation')
       GROUP BY trip_id, alarm_type`,
      { tenantId }
    ),
    query(
      `SELECT contractor_route_id, polygon_json FROM tracking_geofence
       WHERE tenant_id = @tenantId AND leg = N'corridor' AND contractor_route_id IS NOT NULL`,
      { tenantId }
    ),
    query(
      `SELECT contractor_route_id, waypoints_json FROM tracking_monitor_route
       WHERE tenant_id = @tenantId AND contractor_route_id IS NOT NULL AND is_active = 1`,
      { tenantId }
    ),
  ]);

  const routePolylineMap = new Map();
  for (const row of corridorR.recordset || []) {
    const rid = gid(get(row, 'contractor_route_id'));
    if (!rid) continue;
    const pl = parseCorridorPolyline(get(row, 'polygon_json'));
    if (pl?.length >= 2) routePolylineMap.set(rid, pl);
  }
  for (const row of monitorR.recordset || []) {
    const rid = gid(get(row, 'contractor_route_id'));
    if (!rid || routePolylineMap.has(rid)) continue;
    const pl = parseMonitorWaypoints(get(row, 'waypoints_json'));
    if (pl?.length >= 2) routePolylineMap.set(rid, pl);
  }

  const routeMeta = new Map((routesR.recordset || []).map((r) => [gid(get(r, 'id')), {
    name: get(r, 'name'),
    loading_address: get(r, 'loading_address'),
    destination_address: get(r, 'destination_address'),
    distance_km: get(r, 'distance_km') != null ? Number(get(r, 'distance_km')) : null,
  }]));

  const originCoords = new Map();
  const destCoords = new Map();
  for (const g of geofencesR.recordset || []) {
    const rid = gid(get(g, 'contractor_route_id'));
    if (!rid) continue;
    const leg = String(get(g, 'leg') || '').toLowerCase();
    const coords = {
      lat: Number(get(g, 'center_lat')),
      lng: Number(get(g, 'center_lng')),
    };
    if (leg === 'origin' && !originCoords.has(rid)) originCoords.set(rid, coords);
    if (leg === 'destination' && !destCoords.has(rid)) destCoords.set(rid, coords);
  }

  const alarmCounts = new Map();
  for (const row of alarmsR.recordset || []) {
    const tid = gid(get(row, 'trip_id'));
    if (!tid) continue;
    if (!alarmCounts.has(tid)) alarmCounts.set(tid, { overspeed_count: 0, deviation_count: 0 });
    const type = String(get(row, 'alarm_type') || '').toLowerCase();
    const cnt = Number(get(row, 'cnt')) || 0;
    if (type === 'overspeed') alarmCounts.get(tid).overspeed_count = cnt;
    if (type === 'deviation') alarmCounts.get(tid).deviation_count = cnt;
  }

  const deliveryByTrip = new Map();
  const loadingDeliveryByTrip = new Map();
  for (const d of deliveriesR.recordset || []) {
    const tid = gid(get(d, 'trip_id'));
    if (!tid) continue;
    const phase = String(get(d, 'activity_phase') || '').toLowerCase();
    if (phase === 'loading' && !loadingDeliveryByTrip.has(tid)) loadingDeliveryByTrip.set(tid, d);
    if (!deliveryByTrip.has(tid)) deliveryByTrip.set(tid, d);
  }

  const items = (tripsR.recordset || []).map((row) => {
    const tripId = gid(get(row, 'id'));
    return mapActivityTrip(
      row,
      deliveryByTrip.get(tripId),
      routeMeta,
      originCoords,
      destCoords,
      alarmCounts,
      loadingDeliveryByTrip.get(tripId),
      routePolylineMap
    );
  });

  const stages = ACTIVITY_STAGES.map((s) => ({
    ...s,
    count: items.filter((i) => i.activity_stage === s.id).length,
    items: items.filter((i) => i.activity_stage === s.id),
  }));

  const routeList = (routesR.recordset || []).map((r) => ({
    id: gid(get(r, 'id')),
    name: get(r, 'name'),
    loading_address: get(r, 'loading_address'),
    destination_address: get(r, 'destination_address'),
    distance_km: get(r, 'distance_km') != null ? Number(get(r, 'distance_km')) : null,
  }));

  const route_summaries = buildRouteSummaries(items, routeList);

  return {
    stages,
    routes: routeList,
    route_summaries,
    total_active: items.length,
    updated_at: new Date().toISOString(),
  };
}

export async function findActiveTripForTruck(query, tenantId, truckRegistration) {
  const reg = String(truckRegistration || '').trim();
  if (!reg) return null;
  const r = await query(
    `SELECT TOP 1 * FROM fleet_trip
     WHERE tenant_id = @tenantId AND truck_registration = @reg
       AND status NOT IN (N'completed', N'cancelled')
     ORDER BY updated_at DESC`,
    { tenantId, reg }
  );
  return r.recordset?.[0] || null;
}

export async function scheduleTruckForRoute(query, tenantId, { truck_registration, contractor_truck_id, contractor_route_id }) {
  let reg = String(truck_registration || '').trim();
  let ctid = contractor_truck_id ? gid(contractor_truck_id) : null;
  const rid = gid(contractor_route_id);
  if (!rid) throw new Error('Route is required');
  if (!reg && ctid) {
    const tr = await query(`SELECT registration FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`, { id: ctid, tenantId });
    reg = String(get(tr.recordset?.[0], 'registration') || '').trim();
  }
  if (!reg) throw new Error('Truck registration is required');

  const routeR = await query(
    `SELECT name, loading_address, destination_address FROM contractor_routes WHERE id = @rid AND tenant_id = @tenantId`,
    { rid, tenantId }
  );
  const route = routeR.recordset?.[0];
  if (!route) throw new Error('Route not found');

  const existing = await findActiveTripForTruck(query, tenantId, reg);
  if (existing) {
    await query(
      `UPDATE fleet_trip SET
        contractor_route_id = @rid, route_id = @rid,
        collection_point_name = @cp, destination_name = @dn,
        activity_stage = N'scheduled', scheduled_at = SYSUTCDATETIME(),
        status = N'pending', updated_at = SYSUTCDATETIME(),
        contractor_truck_id = COALESCE(@ctid, contractor_truck_id),
        offloading_slip_no = NULL, at_destination_at = NULL,
        started_at = NULL, eta_due_at = NULL, is_overdue = 0
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId,
        id: gid(get(existing, 'id')),
        rid,
        cp: get(route, 'loading_address') || get(route, 'name'),
        dn: get(route, 'destination_address'),
        ctid: ctid || null,
      }
    );
    return { trip_id: gid(get(existing, 'id')), updated: true };
  }

  const ref = `SCH-${todayYmd().replace(/-/g, '')}-${reg.replace(/\s+/g, '').slice(-6).toUpperCase()}`;
  const ins = await query(
    `INSERT INTO fleet_trip (
      tenant_id, trip_ref, truck_registration, contractor_truck_id, contractor_route_id, route_id,
      collection_point_name, destination_name, status, activity_stage, scheduled_at
    ) OUTPUT INSERTED.id VALUES (
      @tenantId, @ref, @reg, @ctid, @rid, @rid, @cp, @dn, N'pending', N'scheduled', SYSUTCDATETIME()
    )`,
    {
      tenantId,
      ref,
      reg,
      ctid: ctid || null,
      rid,
      cp: get(route, 'loading_address') || get(route, 'name'),
      dn: get(route, 'destination_address'),
    }
  );
  return { trip_id: gid(get(ins.recordset?.[0], 'id')), updated: false };
}

export async function openLoadingDeliveryRecord(query, tenantId, tripId, trip, contractorRouteId) {
  const existing = await query(
    `SELECT TOP 1 id FROM tracking_delivery_record
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading' AND pending_note = 1`,
    { tenantId, tripId }
  );
  if (existing.recordset?.[0]) return gid(get(existing.recordset[0], 'id'));

  const ins = await query(
    `INSERT INTO tracking_delivery_record (
      tenant_id, trip_id, truck_registration, delivered_at, destination_name,
      status, notes, contractor_route_id, driver_name, pending_note, activity_phase
    ) OUTPUT INSERTED.id VALUES (
      @tenantId, @tripId, @reg, SYSUTCDATETIME(), @dn,
      N'pending_loading', N'Awaiting loading slip', @rid, @driver, 1, N'loading'
    )`,
    {
      tenantId,
      tripId,
      reg: get(trip, 'truck_registration'),
      dn: get(trip, 'destination_name'),
      rid: contractorRouteId,
      driver: get(trip, 'driver_name'),
    }
  );
  return gid(get(ins.recordset?.[0], 'id'));
}

export async function openDestinationDeliveryRecord(query, tenantId, tripId, trip, contractorRouteId) {
  const existing = await query(
    `SELECT TOP 1 id FROM tracking_delivery_record
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'destination' AND pending_note = 1`,
    { tenantId, tripId }
  );
  if (existing.recordset?.[0]) return gid(get(existing.recordset[0], 'id'));

  const ins = await query(
    `INSERT INTO tracking_delivery_record (
      tenant_id, trip_id, truck_registration, delivered_at, destination_name,
      status, notes, contractor_route_id, driver_name, pending_note, activity_phase
    ) OUTPUT INSERTED.id VALUES (
      @tenantId, @tripId, @reg, SYSUTCDATETIME(), @dn,
      N'pending_offload', N'Awaiting offloading slip', @rid, @driver, 1, N'destination'
    )`,
    {
      tenantId,
      tripId,
      reg: get(trip, 'truck_registration'),
      dn: get(trip, 'destination_name'),
      rid: contractorRouteId,
      driver: get(trip, 'driver_name'),
    }
  );
  return gid(get(ins.recordset?.[0], 'id'));
}

/** Move a truck to the loading geofence stage (manual or GPS return after delivery). */
export async function allocateTripAtLoading(query, tenantId, tripId, trip, contractorRouteId, route) {
  const rid = gid(contractorRouteId);
  if (!rid) throw new Error('Route is required');

  await query(
    `UPDATE fleet_trip SET
      contractor_route_id = @rid, route_id = @rid,
      collection_point_name = COALESCE(@cp, collection_point_name),
      destination_name = COALESCE(@dn, destination_name),
      activity_stage = N'at_loading',
      at_loading_at = COALESCE(at_loading_at, SYSUTCDATETIME()),
      status = N'pending',
      offloading_slip_no = NULL,
      at_destination_at = NULL,
      started_at = NULL,
      eta_due_at = NULL,
      is_overdue = 0,
      updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    {
      tenantId,
      id: tripId,
      rid,
      cp: route ? get(route, 'loading_address') || get(route, 'name') : get(trip, 'collection_point_name'),
      dn: route ? get(route, 'destination_address') : get(trip, 'destination_name'),
    }
  );
  await openLoadingDeliveryRecord(query, tenantId, tripId, trip, rid);
  return { activity_stage: 'at_loading' };
}

/** Manually move a truck between logistics activity stages. */
export async function moveTripActivityStage(query, tenantId, tripId, targetStage, options = {}) {
  const stage = String(targetStage || '').toLowerCase();
  const allowed = ACTIVITY_STAGES.map((s) => s.id);
  if (!allowed.includes(stage)) throw new Error(`Stage must be one of: ${allowed.join(', ')}`);

  const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId, id: tripId });
  const trip = tr.recordset?.[0];
  if (!trip) throw new Error('Trip not found');

  const rid = gid(options.contractor_route_id) || gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));

  if (stage === 'scheduled') {
    if (!rid) throw new Error('Assign a route before scheduling');
    const routeR = await query(
      `SELECT name, loading_address, destination_address FROM contractor_routes WHERE id = @rid AND tenant_id = @tenantId`,
      { rid, tenantId }
    );
    const route = routeR.recordset?.[0];
    if (!route) throw new Error('Route not found');

    await query(
      `UPDATE fleet_trip SET
        contractor_route_id = @rid, route_id = @rid,
        collection_point_name = @cp, destination_name = @dn,
        activity_stage = N'scheduled',
        scheduled_at = SYSUTCDATETIME(),
        status = N'pending',
        at_loading_at = NULL,
        at_destination_at = NULL,
        started_at = NULL,
        eta_due_at = NULL,
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId,
        id: tripId,
        rid,
        cp: get(route, 'loading_address') || get(route, 'name'),
        dn: get(route, 'destination_address'),
      }
    );
    return { activity_stage: 'scheduled' };
  }

  if (stage === 'at_loading') {
    if (!rid) throw new Error('Assign a route before moving to At loading');
    const routeR = await query(
      `SELECT name, loading_address, destination_address FROM contractor_routes WHERE id = @rid AND tenant_id = @tenantId`,
      { rid, tenantId }
    );
    const route = routeR.recordset?.[0];
    if (!route) throw new Error('Route not found');
    return allocateTripAtLoading(query, tenantId, tripId, trip, rid, route);
  }

  if (stage === 'enroute') {
    if (!rid) throw new Error('Assign a route before moving to En route');
    const st = await query(`SELECT max_enroute_minutes FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId });
    let maxM = st.recordset?.[0] ? get(st.recordset[0], 'max_enroute_minutes') : 240;
    if (maxM == null || maxM < 1) maxM = 240;

    const defer = options.defer_slip !== false;
    await query(
      `UPDATE fleet_trip SET
        activity_stage = N'enroute',
        status = N'enroute',
        loading_slip_deferred = CASE WHEN @defer = 1 AND (loading_slip_no IS NULL OR loading_slip_no = N'') THEN 1 ELSE loading_slip_deferred END,
        started_at = COALESCE(started_at, SYSUTCDATETIME()),
        eta_due_at = DATEADD(minute, @maxM, COALESCE(started_at, SYSUTCDATETIME())),
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id: tripId, defer: defer ? 1 : 0, maxM }
    );

    await query(
      `UPDATE tracking_delivery_record SET
        pending_note = 0,
        loading_slip_deferred = CASE WHEN @defer = 1 THEN 1 ELSE loading_slip_deferred END,
        status = N'loading_complete'
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
      { tenantId, tripId, defer: defer ? 1 : 0 }
    );

    const pendingLoad = await query(
      `SELECT TOP 1 id FROM tracking_delivery_record
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
      { tenantId, tripId }
    );
    if (!pendingLoad.recordset?.[0]) {
      await openLoadingDeliveryRecord(query, tenantId, tripId, trip, rid);
      if (defer) {
        await query(
          `UPDATE tracking_delivery_record SET pending_note = 0, loading_slip_deferred = 1, status = N'loading_complete'
           WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
          { tenantId, tripId }
        );
      }
    }

    return { activity_stage: 'enroute' };
  }

  if (stage === 'at_destination') {
    if (!rid) throw new Error('Assign a route before moving to At destination');
    await query(
      `UPDATE fleet_trip SET
        activity_stage = N'at_destination',
        at_destination_at = COALESCE(at_destination_at, SYSUTCDATETIME()),
        status = N'pending',
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id: tripId }
    );
    await openDestinationDeliveryRecord(query, tenantId, tripId, trip, rid);
    return { activity_stage: 'at_destination' };
  }

  if (stage === 'awaiting_reschedule') {
    await query(
      `UPDATE fleet_trip SET
        activity_stage = N'awaiting_reschedule',
        status = N'pending',
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id: tripId }
    );
    return { activity_stage: 'awaiting_reschedule' };
  }

  return { activity_stage: stage };
}

export function normalizePersonName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Trucks scheduled / at loading (or deferred slip) assigned to a driver by name or linked truck. */
export async function listLoadingAssignmentsForDriver(query, tenantId, userFullName) {
  const driverName = normalizePersonName(userFullName);
  if (!driverName) return [];

  const driversR = await query(
    `SELECT d.id, d.full_name, d.linked_truck_id
     FROM contractor_drivers d
     WHERE d.tenant_id = @tenantId
       AND LOWER(LTRIM(RTRIM(d.full_name))) = @driverName`,
    { tenantId, driverName }
  );
  const linkedTruckIds = [...new Set(
    (driversR.recordset || []).map((row) => gid(get(row, 'linked_truck_id'))).filter(Boolean)
  )];

  const ors = ['LOWER(LTRIM(RTRIM(COALESCE(t.driver_name, N\'\')))) = @driverName'];
  const params = { tenantId, driverName };
  linkedTruckIds.forEach((id, i) => {
    ors.push(`t.contractor_truck_id = @truck${i}`);
    params[`truck${i}`] = id;
  });
  if (linkedTruckIds.length) {
    ors.push(
      `EXISTS (
        SELECT 1 FROM contractor_drivers d
        WHERE d.tenant_id = @tenantId AND d.linked_truck_id = t.contractor_truck_id
          AND LOWER(LTRIM(RTRIM(d.full_name))) = @driverName
      )`
    );
  }

  const r = await query(
    `SELECT t.id AS trip_id, t.trip_ref, t.truck_registration, t.driver_name, t.activity_stage,
            t.loading_slip_no, t.loading_slip_deferred, t.scheduled_at, t.at_loading_at,
            r.name AS route_name, r.loading_address, r.destination_address,
            ld.tons_loaded, ld.notes AS loading_notes
     FROM fleet_trip t
     LEFT JOIN contractor_routes r ON r.id = t.contractor_route_id AND r.tenant_id = t.tenant_id
     LEFT JOIN contractor_trucks ct ON ct.id = t.contractor_truck_id AND ct.tenant_id = t.tenant_id
     LEFT JOIN tracking_delivery_record ld ON ld.trip_id = t.id AND ld.tenant_id = t.tenant_id
       AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL
     WHERE t.tenant_id = @tenantId
       AND t.status NOT IN (N'completed', N'cancelled')
       AND (
         COALESCE(t.activity_stage, N'scheduled') IN (N'scheduled', N'at_loading')
         OR (
           t.activity_stage = N'enroute' AND t.loading_slip_deferred = 1
           AND (t.loading_slip_no IS NULL OR LTRIM(RTRIM(t.loading_slip_no)) = N'')
         )
       )
       AND (${ors.join(' OR ')})
     ORDER BY COALESCE(t.at_loading_at, t.scheduled_at, t.updated_at) DESC`,
    params
  );

  return (r.recordset || []).map((row) => ({
    trip_id: gid(get(row, 'trip_id')),
    trip_ref: get(row, 'trip_ref'),
    truck_registration: get(row, 'truck_registration'),
    driver_name: get(row, 'driver_name'),
    activity_stage: get(row, 'activity_stage') || 'scheduled',
    loading_slip_no: get(row, 'loading_slip_no'),
    loading_slip_deferred: !!get(row, 'loading_slip_deferred'),
    scheduled_at: get(row, 'scheduled_at'),
    at_loading_at: get(row, 'at_loading_at'),
    route_name: get(row, 'route_name'),
    loading_address: get(row, 'loading_address'),
    destination_address: get(row, 'destination_address'),
    tons_loaded: get(row, 'tons_loaded') != null ? Number(get(row, 'tons_loaded')) : null,
    loading_notes: get(row, 'loading_notes'),
  }));
}

export async function assertTripAssignedToDriver(query, tenantId, tripId, userFullName) {
  const assignments = await listLoadingAssignmentsForDriver(query, tenantId, userFullName);
  const ok = assignments.some((a) => a.trip_id === gid(tripId));
  if (!ok) {
    const err = new Error('This load is not assigned to you');
    err.status = 403;
    throw err;
  }
}

export async function captureLoadingSlip(query, tenantId, tripId, body, { defer = false } = {}) {
  const b = body || {};
  const slipNo = b.loading_slip_no ? String(b.loading_slip_no).trim() : '';
  if (!defer && !slipNo) throw new Error('Loading slip number required');

  const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId, id: tripId });
  const trip = tr.recordset?.[0];
  if (!trip) {
    const err = new Error('Trip not found');
    err.status = 404;
    throw err;
  }

  const st = await query(`SELECT max_enroute_minutes FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId });
  let maxM = st.recordset?.[0] ? get(st.recordset[0], 'max_enroute_minutes') : 240;
  if (maxM == null || maxM < 1) maxM = 240;

  const rid = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));
  await openLoadingDeliveryRecord(query, tenantId, tripId, trip, rid);

  const driver = b.driver_name ? String(b.driver_name).trim() : null;
  const tons = b.tons_loaded !== '' && b.tons_loaded != null ? Number(b.tons_loaded) : null;
  let notes = b.notes != null ? String(b.notes).trim() : null;
  if (b.loaded_at) {
    const stamp = `Loaded at: ${String(b.loaded_at).trim()}`;
    notes = notes ? `${notes}\n${stamp}` : stamp;
  }

  await query(
    `UPDATE fleet_trip SET
      loading_slip_no = @slip,
      loading_slip_deferred = @defer,
      driver_name = COALESCE(@driver, driver_name),
      activity_stage = N'enroute',
      status = N'enroute',
      started_at = COALESCE(started_at, SYSUTCDATETIME()),
      eta_due_at = DATEADD(minute, @maxM, COALESCE(started_at, SYSUTCDATETIME())),
      is_overdue = 0,
      at_loading_at = COALESCE(at_loading_at, SYSUTCDATETIME()),
      updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    {
      tenantId,
      id: tripId,
      slip: slipNo || null,
      defer: defer ? 1 : 0,
      driver,
      maxM,
    }
  );

  await query(
    `UPDATE tracking_delivery_record SET
      loading_slip_no = @slip,
      loading_slip_deferred = @defer,
      driver_name = COALESCE(@driver, driver_name),
      tons_loaded = COALESCE(@tons, tons_loaded),
      notes = COALESCE(@notes, notes),
      pending_note = 0,
      status = N'loading_complete',
      delivered_at = COALESCE(@loadedAt, delivered_at)
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
    {
      tenantId,
      tripId,
      slip: slipNo || null,
      defer: defer ? 1 : 0,
      driver,
      tons,
      notes,
      loadedAt: b.loaded_at ? new Date(b.loaded_at) : null,
    }
  );

  return { ok: true, activity_stage: 'enroute' };
}

export async function updateLoadingSlipFields(query, tenantId, tripId, body) {
  const b = body || {};
  const slipNo = b.loading_slip_no != null ? String(b.loading_slip_no).trim() : null;
  if (!slipNo) throw new Error('Loading slip number is required');

  const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId, id: tripId });
  if (!tr.recordset?.[0]) {
    const err = new Error('Trip not found');
    err.status = 404;
    throw err;
  }

  const tons = b.tons_loaded !== '' && b.tons_loaded != null ? Number(b.tons_loaded) : null;
  let notes = b.notes != null ? String(b.notes) : null;
  const driver = b.driver_name != null ? String(b.driver_name).trim() || null : null;
  if (b.loaded_at) {
    const stamp = `Loaded at: ${String(b.loaded_at).trim()}`;
    notes = notes ? `${notes}\n${stamp}` : stamp;
  }

  await query(
    `UPDATE fleet_trip SET
      loading_slip_no = @slip,
      loading_slip_deferred = 0,
      driver_name = COALESCE(@driver, driver_name),
      updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    { tenantId, id: tripId, slip: slipNo, driver }
  );

  await query(
    `UPDATE tracking_delivery_record SET
      loading_slip_no = @slip,
      loading_slip_deferred = 0,
      driver_name = COALESCE(@driver, driver_name),
      tons_loaded = @tons,
      notes = @notes,
      pending_note = 0,
      delivered_at = COALESCE(@loadedAt, delivered_at)
     WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
    {
      tenantId,
      tripId,
      slip: slipNo,
      driver,
      tons,
      notes,
      loadedAt: b.loaded_at ? new Date(b.loaded_at) : null,
    }
  );

  return { ok: true };
}
