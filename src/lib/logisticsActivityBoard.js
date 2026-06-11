import { todayYmd } from './appTime.js';

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
  { id: 'scheduled', label: 'Scheduled', hint: 'Awaiting arrival at loading geofence' },
  { id: 'at_loading', label: 'At loading', hint: 'Capture loading slip or proceed without' },
  { id: 'enroute', label: 'En route', hint: 'Tracked to destination geofence' },
  { id: 'at_destination', label: 'At destination', hint: 'Capture offloading slip to clear board' },
];

export function inferActivityStage(trip, openDelivery) {
  const explicit = String(get(trip, 'activity_stage') || '').toLowerCase();
  if (explicit && ACTIVITY_STAGES.some((s) => s.id === explicit)) return explicit;

  const status = String(get(trip, 'status') || '').toLowerCase();
  const phase = String(get(openDelivery, 'activity_phase') || '').toLowerCase();

  if (status === 'enroute' || status === 'deviated' || status === 'overdue') return 'enroute';
  if (status === 'pending' && phase === 'destination') return 'at_destination';
  if (status === 'pending' && get(trip, 'at_loading_at')) return 'at_loading';
  if (get(trip, 'scheduled_at') && !get(trip, 'at_loading_at')) return 'scheduled';
  if (status === 'pending') return 'at_loading';
  return 'scheduled';
}

export function mapActivityTrip(row, openDelivery, routeMeta) {
  const rid = gid(get(row, 'contractor_route_id')) || gid(get(row, 'route_id'));
  const route = routeMeta?.get(rid);
  const started = get(row, 'started_at');
  const hours = started ? (Date.now() - new Date(started).getTime()) / 3600000 : null;
  const stage = inferActivityStage(row, openDelivery);

  return {
    trip_id: gid(get(row, 'id')),
    trip_ref: get(row, 'trip_ref'),
    truck_registration: get(row, 'truck_registration'),
    contractor_name: get(row, 'contractor_name'),
    driver_name: get(row, 'driver_name') || get(row, 'linked_driver_name'),
    contractor_route_id: rid,
    route_name: route?.name || get(row, 'collection_point_name') || '—',
    loading_address: route?.loading_address || get(row, 'collection_point_name'),
    destination_address: route?.destination_address || get(row, 'destination_name'),
    activity_stage: stage,
    status: get(row, 'status'),
    scheduled_at: get(row, 'scheduled_at'),
    at_loading_at: get(row, 'at_loading_at'),
    at_destination_at: get(row, 'at_destination_at'),
    loading_slip_no: get(row, 'loading_slip_no'),
    loading_slip_deferred: !!get(row, 'loading_slip_deferred'),
    offloading_slip_no: get(row, 'offloading_slip_no'),
    delivery_id: openDelivery ? gid(get(openDelivery, 'id')) : null,
    delivery_note_no: get(openDelivery, 'delivery_note_no'),
    tons_loaded: get(openDelivery, 'tons_loaded') != null ? Number(get(openDelivery, 'tons_loaded')) : null,
    pending_note: openDelivery ? !!get(openDelivery, 'pending_note') : false,
    activity_phase: get(openDelivery, 'activity_phase'),
    hours_on_route: hours != null ? Math.round(hours * 100) / 100 : null,
    deviation_count: get(row, 'deviation_count') || 0,
    is_overdue: !!get(row, 'is_overdue'),
    last_seen_at: get(row, 'last_seen_at'),
    last_speed_kmh: get(row, 'last_speed_kmh') != null ? Number(get(row, 'last_speed_kmh')) : null,
    needs_action: stage === 'at_loading' || stage === 'at_destination',
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
    if (item.needs_action) s.action_needed += 1;
    if (item.is_overdue || item.deviation_count > 0) s.alerts += 1;
  }

  const summaries = [...map.values()].filter((s) => s.total > 0 || (routes || []).some((r) => r.id === s.route_id));

  for (const s of summaries) {
    s.priority_score =
      s.action_needed * 100 +
      s.alerts * 45 +
      s.at_loading * 25 +
      s.at_destination * 30 +
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
  const [tripsR, routesR, deliveriesR] = await Promise.all([
    query(
      `SELECT t.*, c.name AS contractor_name,
              (SELECT TOP 1 d.full_name FROM contractor_drivers d
               WHERE d.linked_truck_id = ct.id AND d.tenant_id = t.tenant_id) AS linked_driver_name
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
      `SELECT id, name, loading_address, destination_address FROM contractor_routes WHERE tenant_id = @tenantId ORDER BY [order], name`,
      { tenantId }
    ),
    query(
      `SELECT d.* FROM tracking_delivery_record d
       INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId
         AND t.status NOT IN (N'completed', N'cancelled')
         AND (d.pending_note = 1 OR d.activity_phase IS NOT NULL)
       ORDER BY d.delivered_at DESC`,
      { tenantId }
    ),
  ]);

  const routeMeta = new Map((routesR.recordset || []).map((r) => [gid(get(r, 'id')), {
    name: get(r, 'name'),
    loading_address: get(r, 'loading_address'),
    destination_address: get(r, 'destination_address'),
  }]));

  const deliveryByTrip = new Map();
  for (const d of deliveriesR.recordset || []) {
    const tid = gid(get(d, 'trip_id'));
    if (tid && !deliveryByTrip.has(tid)) deliveryByTrip.set(tid, d);
  }

  const items = (tripsR.recordset || []).map((row) =>
    mapActivityTrip(row, deliveryByTrip.get(gid(get(row, 'id'))), routeMeta)
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
        contractor_truck_id = COALESCE(@ctid, contractor_truck_id)
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
