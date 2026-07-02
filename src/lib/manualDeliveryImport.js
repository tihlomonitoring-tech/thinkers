/**
 * Manual delivery import — backfill historical completed deliveries with optional
 * system economics (route + trip GPS) or user-entered figures.
 */

import { resolveRouteDestination, resolveRouteOrigin } from './logisticsFlowWhatsApp.js';
import {
  computeDeliveryFuelEconomics,
  snapshotDeliveryFuelEconomics,
  computeEmptyReturnFuelEconomics,
  getFuelRegulation,
} from './trackingDeliveryFuel.js';
import { resolveReturnLeg } from './deliveryReturnLeg.js';
import { parseGuid, rowId } from './guidUtils.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function gid(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.replace(/[{}]/g, '').toLowerCase();
  if (Buffer.isBuffer(v)) {
    const h = v.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toLowerCase();
  }
  return String(v);
}

function normReg(reg) {
  return String(reg || '').trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
}

function buildTripRowFromFleetTrip(trip) {
  if (!trip) return null;
  return {
    id: gid(get(trip, 'id')),
    contractor_truck_id: gid(get(trip, 'contractor_truck_id')),
    contractor_route_id: gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id')),
    route_id: gid(get(trip, 'route_id')),
    collection_point_name: get(trip, 'collection_point_name'),
    destination_name: get(trip, 'destination_name'),
    last_speed_kmh: get(trip, 'last_speed_kmh'),
    truck_registration: get(trip, 'truck_registration'),
  };
}

/** Find a fleet trip that best matches a manually entered delivery. */
export async function findMatchingTrip(query, tenantId, { truck_registration, delivered_at, contractor_route_id }) {
  const reg = String(truck_registration || '').trim();
  if (!reg) return null;
  const deliveredAt = delivered_at ? new Date(delivered_at) : null;
  if (!deliveredAt || Number.isNaN(deliveredAt.getTime())) return null;

  const routeId = contractor_route_id ? gid(contractor_route_id) : null;
  const r = await query(
    `SELECT TOP 1 t.*
     FROM fleet_trip t
     WHERE t.tenant_id = @tenantId
       AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(t.truck_registration)), ' ', ''), '-', '')) = @reg
       AND (
         @routeId IS NULL
         OR t.contractor_route_id = @routeId
         OR t.route_id = @routeId
       )
       AND (
         t.at_destination_at BETWEEN DATEADD(hour, -18, @at) AND DATEADD(hour, 18, @at)
         OR t.started_at BETWEEN DATEADD(hour, -36, @at) AND DATEADD(hour, 12, @at)
         OR t.scheduled_at BETWEEN DATEADD(day, -2, @at) AND DATEADD(day, 1, @at)
       )
     ORDER BY
       CASE WHEN t.at_destination_at IS NOT NULL
         THEN ABS(DATEDIFF(minute, t.at_destination_at, @at)) ELSE 999999 END,
       t.updated_at DESC`,
    { tenantId, reg: normReg(reg), routeId: routeId || null, at: deliveredAt }
  );
  return r.recordset?.[0] || null;
}

export async function previewManualDeliveryEconomics(query, tenantId, body) {
  const trip = await findMatchingTrip(query, tenantId, body);
  const routeId = gid(body.contractor_route_id);
  let routeMeta = null;
  if (routeId) {
    const rr = await query(
      `SELECT name, starting_point, destination, loading_address, destination_address
       FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
      { tenantId, routeId }
    );
    routeMeta = rr.recordset?.[0];
  }

  const deliveryRow = {
    trip_id: trip ? gid(get(trip, 'id')) : null,
    truck_registration: body.truck_registration,
    tons_loaded: body.tons_loaded != null ? Number(body.tons_loaded) : null,
    contractor_route_id: routeId,
    origin_name: body.origin_name || resolveRouteOrigin(routeMeta),
    destination_name: body.destination_name || resolveRouteDestination(routeMeta),
  };

  const tripRow = trip
    ? buildTripRowFromFleetTrip(trip)
    : {
      contractor_route_id: routeId,
      route_id: routeId,
      collection_point_name: resolveRouteOrigin(routeMeta),
      destination_name: resolveRouteDestination(routeMeta),
    };

  const econ = await computeDeliveryFuelEconomics(query, tenantId, deliveryRow, tripRow);

  const returnLeg = await resolveReturnLeg(query, tenantId, {
    deliveryRow: { ...deliveryRow, delivered_at: body.delivered_at },
    tripRow,
    loadedRouteId: routeId,
    loadedDistanceKm: econ.distance_km,
    loadedOriginName: deliveryRow.origin_name,
    loadedDestinationName: deliveryRow.destination_name,
    loadedAvgSpeed: econ.avg_speed_kmh,
    deliveredAt: body.delivered_at,
  });

  const truckId = trip ? gid(get(trip, 'contractor_truck_id')) : null;
  const regulation = await getFuelRegulation(query, tenantId, truckId);
  const returnEcon = computeEmptyReturnFuelEconomics({
    returnDistanceKm: returnLeg.return_distance_km,
    avgSpeedKmh: returnLeg.return_avg_speed_kmh ?? econ.avg_speed_kmh,
    loadedLitresPer100: econ.fuel_litres_per_100km,
    fuelPricePerLitre: econ.fuel_price_per_litre,
    regulation,
    calcSource: returnLeg.return_fuel_calc_source,
  });

  return {
    trip_linked: !!trip,
    trip_id: trip ? gid(get(trip, 'id')) : null,
    trip_ref: trip ? get(trip, 'trip_ref') : null,
    economics: {
      ...econ,
      ...returnEcon,
      return_destination_name: returnLeg.return_destination_name,
      return_arrived: returnLeg.return_arrived,
    },
  };
}

export async function createManualDelivery(query, tenantId, body, userId) {
  const b = body || {};
  const reg = String(b.truck_registration || '').trim();
  if (!reg) throw Object.assign(new Error('Truck registration is required'), { status: 400 });

  const routeId = b.contractor_route_id ? gid(b.contractor_route_id) : null;
  if (!routeId) throw Object.assign(new Error('Route is required'), { status: 400 });

  const deliveredAt = b.delivered_at ? new Date(b.delivered_at) : null;
  if (!deliveredAt || Number.isNaN(deliveredAt.getTime())) {
    throw Object.assign(new Error('Delivery date and time is required'), { status: 400 });
  }

  const offloadingSlip = String(b.offloading_slip_no || b.delivery_note_no || '').trim();
  if (!offloadingSlip) {
    throw Object.assign(new Error('Offloading slip or delivery note number is required'), { status: 400 });
  }

  const tons = b.tons_loaded != null && b.tons_loaded !== '' ? Number(b.tons_loaded) : null;
  if (!tons || tons <= 0) throw Object.assign(new Error('Tons loaded is required'), { status: 400 });

  const economicsMode = String(b.economics_mode || 'system').toLowerCase() === 'manual' ? 'manual' : 'system';

  const rr = await query(
    `SELECT name, loading_address, destination_address, destination, starting_point
     FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
    { tenantId, routeId }
  );
  const route = rr.recordset?.[0];
  if (!route) throw Object.assign(new Error('Route not found'), { status: 400 });

  const trip = b.trip_id
    ? (await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId, id: gid(b.trip_id) })).recordset?.[0]
    : await findMatchingTrip(query, tenantId, { truck_registration: reg, delivered_at: deliveredAt, contractor_route_id: routeId });

  const tripId = trip ? gid(get(trip, 'id')) : null;
  const originName = b.origin_name || resolveRouteOrigin(route);
  const destName = b.destination_name || resolveRouteDestination(route);
  const loadingSlip = b.loading_slip_no ? String(b.loading_slip_no).trim() : null;
  const driverName = b.driver_name ? String(b.driver_name).trim() : (trip ? get(trip, 'driver_name') : null);
  const notes = b.notes ? String(b.notes).trim() : null;
  const userGuid = userId ? parseGuid(userId) : null;

  const ins = await query(
    `INSERT INTO tracking_delivery_record (
      tenant_id, trip_id, truck_registration, delivered_at, net_weight_kg, tons_loaded,
      destination_name, origin_name, status, notes, contractor_route_id, driver_name,
      delivery_note_no, loading_slip_no, offloading_slip_no, pending_note, activity_phase,
      record_source, economics_mode, created_by_user_id, trip_linked
    ) OUTPUT INSERTED.id VALUES (
      @tenantId, @tripId, @reg, @at, @kg, @tons,
      @dest, @origin, N'completed', @notes, @routeId, @driver,
      @noteNo, @loadSlip, @offSlip, 0, N'destination',
      N'manual', @econMode, @userId, @tripLinked
    )`,
    {
      tenantId,
      tripId,
      reg,
      at: deliveredAt,
      kg: Math.round(tons * 1000),
      tons,
      dest: destName,
      origin: originName,
      notes: notes || 'Manually imported completed delivery',
      routeId,
      driver: driverName,
      noteNo: b.delivery_note_no ? String(b.delivery_note_no).trim() : offloadingSlip,
      loadSlip: loadingSlip,
      offSlip: offloadingSlip,
      econMode: economicsMode,
      userId: userGuid,
      tripLinked: tripId ? 1 : 0,
    }
  );

  const deliveryId = rowId(ins.recordset?.[0]);
  if (!deliveryId) throw new Error('Failed to create delivery');

  if (economicsMode === 'system') {
    await snapshotDeliveryFuelEconomics(query, tenantId, deliveryId, { force: true });
  } else {
    await query(
      `UPDATE tracking_delivery_record SET
        fuel_litres = @fl,
        fuel_cost = @fc,
        return_fuel_litres = @rfl,
        return_fuel_cost = @rfc,
        include_return_fuel_in_cost = @inc,
        revenue_amount = @rev,
        fuel_snapshot_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId,
        id: deliveryId,
        fl: b.fuel_litres != null && b.fuel_litres !== '' ? Number(b.fuel_litres) : null,
        fc: b.fuel_cost != null && b.fuel_cost !== '' ? Number(b.fuel_cost) : null,
        rfl: b.return_fuel_litres != null && b.return_fuel_litres !== '' ? Number(b.return_fuel_litres) : null,
        rfc: b.return_fuel_cost != null && b.return_fuel_cost !== '' ? Number(b.return_fuel_cost) : null,
        inc: b.include_return_fuel_in_cost !== false ? 1 : 0,
        rev: b.revenue_amount != null && b.revenue_amount !== '' ? Number(b.revenue_amount) : null,
      }
    );
  }

  return { id: deliveryId, trip_linked: !!tripId, economics_mode: economicsMode };
}
