import { todayYmd } from './appTime.js';
import { haversineMeters } from './geo.js';

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

export function computeKmRemaining({ activity_stage, last_lat, last_lng, destination_lat, destination_lng, route_distance_km }) {
  const stage = String(activity_stage || '').toLowerCase();
  if (stage === 'awaiting_reschedule') return 0;

  const lat = last_lat != null ? Number(last_lat) : null;
  const lng = last_lng != null ? Number(last_lng) : null;
  const dLat = destination_lat != null ? Number(destination_lat) : null;
  const dLng = destination_lng != null ? Number(destination_lng) : null;

  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(dLat) && Number.isFinite(dLng)) {
    const m = haversineMeters(lat, lng, dLat, dLng);
    const km = Math.round((m / 1000) * 10) / 10;
    const routeKm = route_distance_km != null ? Number(route_distance_km) : null;
    if (Number.isFinite(routeKm) && routeKm > 0 && stage === 'enroute') {
      return Math.min(km, routeKm);
    }
    return km;
  }

  const routeKm = route_distance_km != null ? Number(route_distance_km) : null;
  if (Number.isFinite(routeKm) && routeKm > 0 && (stage === 'scheduled' || stage === 'at_loading' || stage === 'enroute' || stage === 'at_destination')) {
    return Math.round(routeKm * 10) / 10;
  }

  return null;
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
  return Math.round((m / 1000) * 10) / 10;
}

export function resolveRouteDistanceKm(route, originCoords, destCoords) {
  const fromRoute = route?.distance_km != null ? Number(route.distance_km) : null;
  if (Number.isFinite(fromRoute) && fromRoute > 0) return fromRoute;
  const span = geofenceSpanKm(originCoords, destCoords);
  return span != null && span > 0 ? span : null;
}

export function mapActivityTrip(row, openDelivery, routeMeta, originCoords, destCoords, alarmCounts) {
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
  const routeDistanceKm = resolveRouteDistanceKm(route, origin, dest);

  const kmRemaining = computeKmRemaining({
    activity_stage: stage,
    last_lat: lastLat,
    last_lng: lastLng,
    destination_lat: destLat,
    destination_lng: destLng,
    route_distance_km: routeDistanceKm,
  });

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
    route_distance_km: routeDistanceKm,
    km_remaining: kmRemaining,
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
    tons_loaded: get(openDelivery, 'tons_loaded') != null ? Number(get(openDelivery, 'tons_loaded')) : null,
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
  const [tripsR, routesR, deliveriesR, geofencesR, alarmsR] = await Promise.all([
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
  ]);

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
  for (const d of deliveriesR.recordset || []) {
    const tid = gid(get(d, 'trip_id'));
    if (tid && !deliveryByTrip.has(tid)) deliveryByTrip.set(tid, d);
  }

  const items = (tripsR.recordset || []).map((row) =>
    mapActivityTrip(row, deliveryByTrip.get(gid(get(row, 'id'))), routeMeta, originCoords, destCoords, alarmCounts)
  );

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
  const allowed = ['scheduled', 'at_loading', 'enroute'];
  if (!allowed.includes(stage)) throw new Error('Stage must be scheduled, at_loading, or enroute');

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

  return { activity_stage: stage };
}
