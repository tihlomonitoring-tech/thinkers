/**
 * Fuel expense & revenue snapshots for tracking completed deliveries.
 * Snapshots are frozen at completion — later regulation changes do not rewrite history.
 */

import { getTripTotalDistanceKm } from './tripPositionTrail.js';
import { estimateAllocationRevenue, resolveTruckRoute } from './deliveryActivityLedger.js';
import { parseCorridorPolyline, parseMonitorWaypoints, polylineDistanceKm } from './routeCorridorGeofence.js';
import { resolveRouteDestination, resolveRouteOrigin } from './logisticsFlowWhatsApp.js';
import { parseGuid, rowId } from './guidUtils.js';
import { resolveReturnLeg, returnLegNeedsRefresh } from './deliveryReturnLeg.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function gid(v) {
  return parseGuid(v);
}

/** Ensure every SQL parameter is bound (undefined → null). */
function sqlBind(params) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = value === undefined ? null : value;
  }
  return out;
}

const DELIVERY_TRIP_JOIN = `
  FROM tracking_delivery_record d
  LEFT JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id`;

function buildTripRowFromDelivery(delivery) {
  return {
    id: get(delivery, 'trip_id') || get(delivery, 'trip_row_id'),
    contractor_truck_id: get(delivery, 'trip_contractor_truck_id') || get(delivery, 'contractor_truck_id'),
    contractor_route_id: get(delivery, 'effective_contractor_route_id')
      || get(delivery, 'contractor_route_id')
      || get(delivery, 'trip_contractor_route_id')
      || get(delivery, 'trip_route_id'),
    route_id: get(delivery, 'trip_route_id') || get(delivery, 'route_id'),
    collection_point_name: get(delivery, 'trip_collection_point_name') || get(delivery, 'collection_point_name'),
    destination_name: get(delivery, 'trip_destination_name') || get(delivery, 'destination_name'),
    last_speed_kmh: get(delivery, 'trip_last_speed_kmh') ?? get(delivery, 'last_speed_kmh'),
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

const DEFAULT_LITRES_PER_100KM = 42;
const DEFAULT_EMPTY_CONSUMPTION_FACTOR = 0.75;
const REFERENCE_SPEED_KMH = 75;

/** Speed-aware consumption factor (fleet-style: higher cruise speed uses more fuel). */
export function speedConsumptionFactor(avgSpeedKmh) {
  const spd = Number(avgSpeedKmh);
  if (!Number.isFinite(spd) || spd <= 0) return 1;
  let factor = 1;
  if (spd > REFERENCE_SPEED_KMH) {
    factor += ((spd - REFERENCE_SPEED_KMH) / 10) * 0.03;
  } else if (spd < 40) {
    factor *= 1.05;
  }
  return Math.round(factor * 1000) / 1000;
}

function mapRegulationRow(reg) {
  if (!reg) return null;
  return {
    id: gid(get(reg, 'id')),
    fuel_price_per_litre: Number(get(reg, 'fuel_price_per_litre')),
    fuel_litres_per_100km: get(reg, 'fuel_litres_per_100km') != null ? Number(get(reg, 'fuel_litres_per_100km')) : null,
    fuel_litres_per_100km_empty: get(reg, 'fuel_litres_per_100km_empty') != null
      ? Number(get(reg, 'fuel_litres_per_100km_empty')) : null,
    return_empty_consumption_factor: get(reg, 'return_empty_consumption_factor') != null
      ? Number(get(reg, 'return_empty_consumption_factor')) : null,
    notes: get(reg, 'notes'),
    updated_at: get(reg, 'updated_at'),
    updated_by: get(reg, 'updated_by'),
  };
}

export async function getFuelRegulation(query, tenantId, contractorTruckId) {
  if (contractorTruckId) {
    const tr = await query(
      `SELECT TOP 1 fuel_price_per_litre, fuel_litres_per_100km, fuel_litres_per_100km_empty,
              return_empty_consumption_factor, notes
       FROM tracking_fuel_regulation
       WHERE tenant_id = @tenantId AND contractor_truck_id = @truckId`,
      { tenantId, truckId: contractorTruckId }
    );
    if (tr.recordset?.[0]) return tr.recordset[0];
  }
  const def = await query(
    `SELECT TOP 1 fuel_price_per_litre, fuel_litres_per_100km, fuel_litres_per_100km_empty,
            return_empty_consumption_factor, notes
     FROM tracking_fuel_regulation
     WHERE tenant_id = @tenantId AND contractor_truck_id IS NULL`,
    { tenantId }
  );
  return def.recordset?.[0] || null;
}

/** Resolve empty-return L/100km from regulation (explicit empty rate or factor on loaded rate). */
export function resolveEmptyReturnLitresPer100km(regulation, loadedLitresPer100) {
  const loaded = loadedLitresPer100 > 0 ? loadedLitresPer100 : DEFAULT_LITRES_PER_100KM;
  if (regulation && get(regulation, 'fuel_litres_per_100km_empty') != null) {
    const empty = Number(get(regulation, 'fuel_litres_per_100km_empty'));
    if (empty > 0) return round2(empty);
  }
  const factorRaw = regulation && get(regulation, 'return_empty_consumption_factor') != null
    ? Number(get(regulation, 'return_empty_consumption_factor'))
    : DEFAULT_EMPTY_CONSUMPTION_FACTOR;
  const factor = factorRaw > 0 && factorRaw <= 1.5 ? factorRaw : DEFAULT_EMPTY_CONSUMPTION_FACTOR;
  return round2(loaded * factor);
}

/**
 * Fuel for empty return leg: destination → logistics field (loading point).
 * Uses same route distance as loaded leg unless return_distance_km is supplied.
 */
export function computeEmptyReturnFuelEconomics({
  returnDistanceKm,
  avgSpeedKmh,
  loadedLitresPer100,
  fuelPricePerLitre,
  regulation,
  calcSource = 'route_distance',
}) {
  const distanceKm = returnDistanceKm > 0 ? Number(returnDistanceKm) : null;
  if (!distanceKm) {
    return {
      return_distance_km: null,
      return_avg_speed_kmh: avgSpeedKmh,
      return_fuel_litres_per_100km: null,
      return_fuel_litres_estimated: null,
      return_fuel_cost_estimated: null,
      return_fuel_litres: null,
      return_fuel_cost: null,
      return_fuel_calc_source: null,
    };
  }

  const emptyL100 = resolveEmptyReturnLitresPer100km(regulation, loadedLitresPer100);
  const speedFactor = speedConsumptionFactor(avgSpeedKmh);
  const baseLitres = (distanceKm * emptyL100) / 100;
  const fuelLitresEst = round3(baseLitres * speedFactor);
  const price = fuelPricePerLitre != null ? Number(fuelPricePerLitre) : null;
  const fuelCostEst = fuelLitresEst != null && price > 0
    ? round2(round3(fuelLitresEst) * round2(price))
    : null;

  return {
    return_distance_km: round2(distanceKm),
    return_avg_speed_kmh: avgSpeedKmh,
    return_fuel_litres_per_100km: emptyL100,
    return_fuel_litres_estimated: fuelLitresEst,
    return_fuel_cost_estimated: fuelCostEst,
    return_fuel_litres: fuelLitresEst,
    return_fuel_cost: fuelCostEst,
    return_fuel_calc_source: calcSource,
  };
}

function deliveryEconomicsIncomplete(delivery) {
  if (!delivery) return true;
  return get(delivery, 'fuel_litres') == null
    || get(delivery, 'fuel_cost') == null
    || get(delivery, 'revenue_amount') == null
    || get(delivery, 'return_fuel_cost') == null;
}

async function resolveContractorRouteId(query, tenantId, deliveryRow, tripRow) {
  let rid = gid(get(deliveryRow, 'contractor_route_id'))
    || gid(get(tripRow, 'contractor_route_id'))
    || gid(get(tripRow, 'route_id'));
  if (rid) return rid;

  const truckId = gid(get(tripRow, 'contractor_truck_id'));
  if (truckId) {
    const { routeId } = await resolveTruckRoute(query, tenantId, truckId);
    if (routeId) return gid(routeId);
  }

  const truck = await resolveTruckProfile(query, tenantId, {
    contractorTruckId: truckId,
    truckRegistration: get(deliveryRow, 'truck_registration') || get(tripRow, 'truck_registration'),
  });
  if (truck) {
    const { routeId } = await resolveTruckRoute(query, tenantId, gid(get(truck, 'id')));
    if (routeId) return gid(routeId);
  }
  return null;
}

/** Pick the most reliable haul-road distance: corridor → monitor → route record → GPS (when aligned). */
async function resolveRouteDistanceKm(query, tenantId, contractorRouteId, tripId) {
  let gpsDist = null;
  if (tripId) {
    const dist = await getTripTotalDistanceKm(query, tenantId, tripId);
    if (dist?.distance_km > 0) gpsDist = dist;
  }

  if (!contractorRouteId) {
    if (gpsDist) return gpsDist;
    return { distance_km: null, avg_speed_kmh: null, source: 'none', origin_name: null, destination_name: null };
  }

  const [rr, corridorR, monitorR] = await Promise.all([
    query(
      `SELECT COALESCE(reg.distance_km, r.distance_km) AS distance_km,
              r.name, r.starting_point, r.destination, r.loading_address, r.destination_address
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @tenantId
       WHERE r.id = @routeId AND r.tenant_id = @tenantId`,
      { tenantId, routeId: contractorRouteId }
    ),
    query(
      `SELECT TOP 1 polygon_json FROM tracking_geofence
       WHERE tenant_id = @tenantId AND contractor_route_id = @routeId AND leg = N'corridor'`,
      { tenantId, routeId: contractorRouteId }
    ),
    query(
      `SELECT TOP 1 waypoints_json FROM tracking_monitor_route
       WHERE tenant_id = @tenantId AND contractor_route_id = @routeId AND is_active = 1`,
      { tenantId, routeId: contractorRouteId }
    ),
  ]);

  const row = rr.recordset?.[0];
  const routeMeta = row ? {
    name: get(row, 'name'),
    starting_point: get(row, 'starting_point'),
    destination: get(row, 'destination'),
    loading_address: get(row, 'loading_address'),
    destination_address: get(row, 'destination_address'),
  } : null;
  const originName = resolveRouteOrigin(routeMeta);
  const destinationName = resolveRouteDestination(routeMeta);

  const corridorPoly = parseCorridorPolyline(get(corridorR.recordset?.[0], 'polygon_json'));
  const corridorKm = corridorPoly?.length >= 2 ? polylineDistanceKm(corridorPoly) : null;
  const monitorPoly = parseMonitorWaypoints(get(monitorR.recordset?.[0], 'waypoints_json'));
  const monitorKm = monitorPoly?.length >= 2 ? polylineDistanceKm(monitorPoly) : null;
  const recordKm = row && Number(get(row, 'distance_km')) > 0 ? Number(get(row, 'distance_km')) : null;

  const plannedCandidates = [
    corridorKm > 0 ? { km: round2(corridorKm), source: 'corridor_polyline' } : null,
    monitorKm > 0 ? { km: round2(monitorKm), source: 'monitor_route' } : null,
    recordKm ? { km: round2(recordKm), source: 'route_distance' } : null,
  ].filter(Boolean);

  const planned = plannedCandidates[0] || null;

  if (gpsDist?.distance_km && planned?.km) {
    const ratio = gpsDist.distance_km / planned.km;
    if (ratio >= 0.85 && ratio <= 1.25) {
      return {
        distance_km: round2(gpsDist.distance_km),
        avg_speed_kmh: gpsDist.avg_speed_kmh,
        source: 'gps_trail',
        origin_name: gpsDist.origin_name || originName,
        destination_name: gpsDist.destination_name || destinationName,
      };
    }
  }

  if (planned) {
    return {
      distance_km: planned.km,
      avg_speed_kmh: gpsDist?.avg_speed_kmh ?? null,
      source: planned.source,
      origin_name: originName,
      destination_name: destinationName,
    };
  }

  if (gpsDist) return gpsDist;

  return {
    distance_km: null,
    avg_speed_kmh: gpsDist?.avg_speed_kmh ?? null,
    source: 'none',
    origin_name: originName,
    destination_name: destinationName,
  };
}

async function resolveTruckProfile(query, tenantId, { contractorTruckId, truckRegistration }) {
  let truckId = contractorTruckId ? gid(contractorTruckId) : null;
  if (!truckId && truckRegistration) {
    const norm = String(truckRegistration).trim().toUpperCase().replace(/\s+/g, '');
    const tr = await query(
      `SELECT TOP 1 id FROM contractor_trucks
       WHERE tenant_id = @tenantId
         AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(registration)), ' ', ''), '-', '')) = @reg`,
      { tenantId, reg: norm }
    );
    truckId = gid(get(tr.recordset?.[0], 'id'));
  }
  if (!truckId) return null;
  const truckGuid = parseGuid(truckId);
  const tenantGuid = parseGuid(tenantId);
  if (!truckGuid || !tenantGuid) return null;
  const r = await query(
    `SELECT id, registration, make_model, year_model, fuel_consumption_litres_per_100km
     FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
    { id: truckGuid, tenantId: tenantGuid }
  );
  return r.recordset?.[0] || null;
}

export async function computeDeliveryFuelEconomics(query, tenantId, deliveryRow, tripRow) {
  const tripId = gid(get(deliveryRow, 'trip_id') || get(tripRow, 'id'));
  const contractorTruckId = gid(get(tripRow, 'contractor_truck_id'));
  const contractorRouteId = await resolveContractorRouteId(query, tenantId, deliveryRow, tripRow);
  let tons = get(deliveryRow, 'tons_loaded') != null ? Number(get(deliveryRow, 'tons_loaded')) : null;

  if ((!tons || tons <= 0) && tripId) {
    const loadR = await query(
      `SELECT TOP 1 tons_loaded FROM tracking_delivery_record
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading' AND deleted_at IS NULL
       ORDER BY delivered_at DESC`,
      { tenantId, tripId }
    );
    const fromLoad = get(loadR.recordset?.[0], 'tons_loaded');
    if (fromLoad != null && Number(fromLoad) > 0) tons = Number(fromLoad);
  }

  if ((!tons || tons <= 0) && contractorRouteId) {
    const avgR = await query(
      `SELECT TOP 1 avg_payload_tons FROM access_route_target_regulations
       WHERE tenant_id = @tenantId AND route_id = @routeId AND avg_payload_tons > 0`,
      { tenantId, routeId: contractorRouteId }
    );
    const avg = Number(get(avgR.recordset?.[0], 'avg_payload_tons'));
    if (Number.isFinite(avg) && avg > 0) tons = avg;
  }

  const truck = await resolveTruckProfile(query, tenantId, {
    contractorTruckId,
    truckRegistration: get(deliveryRow, 'truck_registration'),
  });

  const regulation = await getFuelRegulation(query, tenantId, truck ? gid(get(truck, 'id')) : null);

  let litresPer100 = null;
  if (truck && get(truck, 'fuel_consumption_litres_per_100km') != null) {
    litresPer100 = Number(get(truck, 'fuel_consumption_litres_per_100km'));
  }
  if (regulation && get(regulation, 'fuel_litres_per_100km') != null) {
    litresPer100 = Number(get(regulation, 'fuel_litres_per_100km'));
  }
  if ((!litresPer100 || litresPer100 <= 0) && contractorRouteId) {
    const rr = await query(
      `SELECT reg.fuel_litres_per_100km, reg.fuel_price_per_litre
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @tenantId
       WHERE r.id = @routeId AND r.tenant_id = @tenantId`,
      { tenantId, routeId: contractorRouteId }
    );
    const row = rr.recordset?.[0];
    if (row && get(row, 'fuel_litres_per_100km') != null) {
      litresPer100 = Number(get(row, 'fuel_litres_per_100km'));
    }
  }
  litresPer100 = litresPer100 > 0 ? litresPer100 : DEFAULT_LITRES_PER_100KM;

  let fuelPrice = regulation && get(regulation, 'fuel_price_per_litre') != null
    ? Number(get(regulation, 'fuel_price_per_litre'))
    : null;
  if (fuelPrice == null && contractorRouteId) {
    const rr = await query(
      `SELECT reg.fuel_price_per_litre FROM access_route_target_regulations reg
       WHERE reg.tenant_id = @tenantId AND reg.route_id = @routeId`,
      { tenantId, routeId: contractorRouteId }
    );
    const p = get(rr.recordset?.[0], 'fuel_price_per_litre');
    if (p != null) fuelPrice = Number(p);
  }

  let distanceKm = null;
  let avgSpeed = null;
  let calcSource = 'regulation';
  let originName = get(deliveryRow, 'origin_name') || get(tripRow, 'collection_point_name');
  let destinationName = get(deliveryRow, 'destination_name') || get(tripRow, 'destination_name');

  const dist = await resolveRouteDistanceKm(query, tenantId, contractorRouteId, tripId);
  if (dist.distance_km > 0) {
    distanceKm = dist.distance_km;
    avgSpeed = dist.avg_speed_kmh ?? (get(tripRow, 'last_speed_kmh') != null ? Number(get(tripRow, 'last_speed_kmh')) : null);
    calcSource = dist.source === 'gps_trail' ? 'gps_trail' : dist.source;
    originName = dist.origin_name || originName;
    destinationName = dist.destination_name || destinationName;
  }

  if (!originName || !destinationName) {
    const rr = contractorRouteId ? await query(
      `SELECT name, starting_point, destination, loading_address, destination_address
       FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
      { tenantId, routeId: contractorRouteId }
    ) : { recordset: [] };
    const routeMeta = rr.recordset?.[0];
    originName = originName || resolveRouteOrigin({
      name: get(routeMeta, 'name'),
      starting_point: get(routeMeta, 'starting_point'),
      loading_address: get(routeMeta, 'loading_address'),
    });
    destinationName = destinationName || resolveRouteDestination({
      name: get(routeMeta, 'name'),
      destination: get(routeMeta, 'destination'),
      destination_address: get(routeMeta, 'destination_address'),
    });
  }

  const speedFactor = speedConsumptionFactor(avgSpeed);
  const baseLitres = distanceKm > 0 ? (distanceKm * litresPer100) / 100 : null;
  const fuelLitresEst = baseLitres != null ? round3(baseLitres * speedFactor) : null;
  const fuelCostEst = fuelLitresEst != null && fuelPrice > 0
    ? round2(round3(fuelLitresEst) * round2(fuelPrice))
    : null;

  let revenueAmount = null;
  let revenuePerTon = null;
  if (contractorRouteId) {
    const effectiveTons = tons > 0 ? tons : null;
    if (effectiveTons) {
      const rev = await estimateAllocationRevenue(query, tenantId, contractorRouteId, 1, effectiveTons);
      revenueAmount = rev.revenue_amount;
      revenuePerTon = rev.revenue_amount != null && effectiveTons > 0 ? round2(rev.revenue_amount / effectiveTons) : null;
    }
    if (revenueAmount == null) {
      const revPerLoad = await estimateAllocationRevenue(query, tenantId, contractorRouteId, 1, null);
      revenueAmount = revPerLoad.revenue_amount;
      revenuePerTon = revPerLoad.revenue_per_load;
    }
    if (revenuePerTon == null) {
      const rateR = await query(
        `SELECT TOP 1 rate_per_ton FROM access_route_target_regulations
         WHERE tenant_id = @tenantId AND route_id = @routeId AND rate_per_ton > 0`,
        { tenantId, routeId: contractorRouteId }
      );
      const rate = Number(get(rateR.recordset?.[0], 'rate_per_ton'));
      if (Number.isFinite(rate) && rate > 0) revenuePerTon = rate;
      if (revenueAmount == null && revenuePerTon != null && effectiveTons) {
        revenueAmount = round2(revenuePerTon * effectiveTons);
      }
    }
  }

  return {
    distance_km: distanceKm != null ? round2(distanceKm) : null,
    avg_speed_kmh: avgSpeed,
    origin_name: originName,
    destination_name: destinationName,
    truck_make_model: truck ? get(truck, 'make_model') : null,
    truck_year_model: truck ? get(truck, 'year_model') : null,
    fuel_litres_per_100km: round2(litresPer100),
    fuel_price_per_litre: fuelPrice != null ? round2(fuelPrice) : null,
    fuel_litres_estimated: fuelLitresEst,
    fuel_cost_estimated: fuelCostEst,
    fuel_litres: fuelLitresEst,
    fuel_cost: fuelCostEst,
    revenue_amount: revenueAmount,
    revenue_per_ton: revenuePerTon,
    tons_loaded: tons > 0 ? tons : null,
    fuel_calc_source: calcSource,
    speed_factor: speedFactor,
  };
}

/** Freeze fuel & revenue figures on a delivery (once, or when incomplete / forced). */
export async function snapshotDeliveryFuelEconomics(query, tenantId, deliveryId, options = {}) {
  const force = options.force === true;
  const deliveryGuid = parseGuid(deliveryId);
  const tenantGuid = parseGuid(tenantId);
  if (!deliveryGuid) throw new Error('Delivery id is required');
  if (!tenantGuid) throw new Error('Tenant id is required');

  const dr = await query(
    `SELECT d.*,
            t.id AS trip_row_id,
            t.contractor_truck_id AS trip_contractor_truck_id,
            t.contractor_route_id AS trip_contractor_route_id,
            t.route_id AS trip_route_id,
            COALESCE(d.contractor_route_id, t.contractor_route_id, t.route_id) AS effective_contractor_route_id,
            t.collection_point_name AS trip_collection_point_name,
            t.destination_name AS trip_destination_name,
            t.last_speed_kmh AS trip_last_speed_kmh
     ${DELIVERY_TRIP_JOIN}
     WHERE d.id = @id AND d.tenant_id = @tenantId AND d.deleted_at IS NULL`,
    sqlBind({ tenantId: tenantGuid, id: deliveryGuid })
  );
  const delivery = dr.recordset?.[0];
  if (!delivery) return null;

  const alreadySnapshotted = !!get(delivery, 'fuel_snapshot_at');
  const incomplete = deliveryEconomicsIncomplete(delivery);
  const loadedComplete = get(delivery, 'fuel_litres') != null && get(delivery, 'fuel_cost') != null;

  const tripRow = buildTripRowFromDelivery(delivery);
  const econ = await computeDeliveryFuelEconomics(query, tenantGuid, delivery, tripRow);
  const resolvedRouteId = await resolveContractorRouteId(query, tenantGuid, delivery, tripRow);

  const returnLeg = await resolveReturnLeg(query, tenantGuid, {
    deliveryRow: delivery,
    tripRow,
    loadedRouteId: resolvedRouteId,
    loadedDistanceKm: get(delivery, 'distance_km') != null ? Number(get(delivery, 'distance_km')) : econ.distance_km,
    loadedOriginName: get(delivery, 'origin_name') || econ.origin_name,
    loadedDestinationName: get(delivery, 'destination_name') || econ.destination_name,
    loadedAvgSpeed: get(delivery, 'avg_speed_kmh') != null ? Number(get(delivery, 'avg_speed_kmh')) : econ.avg_speed_kmh,
    deliveredAt: get(delivery, 'delivered_at'),
  });

  const returnNeedsRefresh = returnLegNeedsRefresh(delivery, returnLeg);
  const needsReturnOnly = !force && alreadySnapshotted && loadedComplete && !incomplete
    && (get(delivery, 'return_fuel_cost') == null || returnNeedsRefresh);

  if (alreadySnapshotted && !incomplete && !needsReturnOnly && !force) {
    return delivery;
  }

  const truckId = gid(get(tripRow, 'contractor_truck_id'));
  const regulation = await getFuelRegulation(query, tenantId, truckId);
  const loadedL100 = needsReturnOnly && get(delivery, 'fuel_litres_per_100km') != null
    ? Number(get(delivery, 'fuel_litres_per_100km'))
    : econ.fuel_litres_per_100km;
  const fuelPrice = needsReturnOnly && get(delivery, 'fuel_price_per_litre') != null
    ? Number(get(delivery, 'fuel_price_per_litre'))
    : econ.fuel_price_per_litre;
  const returnDistance = returnLeg.return_distance_km;
  const returnSpeed = returnLeg.return_avg_speed_kmh ?? econ.avg_speed_kmh;

  const returnEcon = computeEmptyReturnFuelEconomics({
    returnDistanceKm: returnDistance,
    avgSpeedKmh: returnSpeed,
    loadedLitresPer100: loadedL100,
    fuelPricePerLitre: fuelPrice,
    regulation,
    calcSource: returnLeg.return_fuel_calc_source || 'route_distance_return',
  });
  returnEcon.return_destination_name = returnLeg.return_destination_name;
  returnEcon.return_arrived = returnLeg.return_arrived;

  if (needsReturnOnly) {
    await query(
      `UPDATE tracking_delivery_record SET
        return_distance_km = @rdkm,
        return_avg_speed_kmh = @rspd,
        return_fuel_litres_per_100km = @rl100,
        return_fuel_litres_estimated = @rlest,
        return_fuel_cost_estimated = @rcest,
        return_fuel_litres = @rlest,
        return_fuel_cost = @rcest,
        return_fuel_calc_source = @rsrc,
        return_destination_name = @rdn,
        return_arrived = @rarrived
       WHERE id = @id AND tenant_id = @tenantId`,
      sqlBind({
        tenantId: tenantGuid,
        id: deliveryGuid,
        rdkm: returnEcon.return_distance_km,
        rspd: returnEcon.return_avg_speed_kmh,
        rl100: returnEcon.return_fuel_litres_per_100km,
        rlest: returnEcon.return_fuel_litres_estimated,
        rcest: returnEcon.return_fuel_cost_estimated,
        rsrc: returnEcon.return_fuel_calc_source,
        rdn: returnLeg.return_destination_name,
        rarrived: returnLeg.return_arrived ? 1 : 0,
      })
    );
    return { ...econ, ...returnEcon, ...returnLeg };
  }

  await query(
    `UPDATE tracking_delivery_record SET
      distance_km = @dkm,
      avg_speed_kmh = @spd,
      origin_name = COALESCE(@origin, origin_name),
      destination_name = COALESCE(@dest, destination_name),
      contractor_route_id = COALESCE(@rid, contractor_route_id),
      truck_make_model = @mm,
      truck_year_model = @yr,
      fuel_litres_per_100km = @l100,
      fuel_price_per_litre = @price,
      fuel_litres_estimated = @lest,
      fuel_cost_estimated = @cest,
      fuel_litres = @lest,
      fuel_cost = @cest,
      revenue_amount = @rev,
      revenue_per_ton = @rpt,
      tons_loaded = COALESCE(tons_loaded, @tons),
      fuel_calc_source = @src,
      return_distance_km = @rdkm,
      return_avg_speed_kmh = @rspd,
      return_fuel_litres_per_100km = @rl100,
      return_fuel_litres_estimated = @rlest,
      return_fuel_cost_estimated = @rcest,
      return_fuel_litres = @rlest,
      return_fuel_cost = @rcest,
      return_fuel_calc_source = @rsrc,
      return_destination_name = @rdn,
      return_arrived = @rarrived,
      fuel_snapshot_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    sqlBind({
      tenantId: tenantGuid,
      id: deliveryGuid,
      dkm: econ.distance_km,
      spd: econ.avg_speed_kmh,
      origin: econ.origin_name,
      dest: econ.destination_name,
      rid: resolvedRouteId,
      mm: econ.truck_make_model,
      yr: econ.truck_year_model,
      l100: econ.fuel_litres_per_100km,
      price: econ.fuel_price_per_litre,
      lest: econ.fuel_litres_estimated,
      cest: econ.fuel_cost_estimated,
      rev: econ.revenue_amount,
      rpt: econ.revenue_per_ton,
      tons: econ.tons_loaded,
      src: econ.fuel_calc_source,
      rdkm: returnEcon.return_distance_km,
      rspd: returnEcon.return_avg_speed_kmh,
      rl100: returnEcon.return_fuel_litres_per_100km,
      rlest: returnEcon.return_fuel_litres_estimated,
      rcest: returnEcon.return_fuel_cost_estimated,
      rsrc: returnEcon.return_fuel_calc_source,
      rdn: returnLeg.return_destination_name,
      rarrived: returnLeg.return_arrived ? 1 : 0,
    })
  );

  return { ...econ, ...returnEcon, ...returnLeg };
}

/** Backfill economics for completed deliveries missing fuel or revenue figures. */
export async function backfillDeliveryEconomics(query, tenantId, deliveryIds, { force = true } = {}) {
  const updated = [];
  for (const id of deliveryIds) {
    try {
      await snapshotDeliveryFuelEconomics(query, tenantId, id, { force });
      updated.push(id);
    } catch (err) {
      console.warn('[delivery-economics] backfill failed for', id, err?.message || err);
    }
  }
  return updated;
}

export async function listFuelRegulations(query, tenantId) {
  const [trucksR, regsR, defaultR] = await Promise.all([
    query(
      `SELECT ct.id, ct.registration, ct.make_model, ct.year_model,
              ct.fuel_consumption_litres_per_100km, ct.fuel_tank_capacity_litres,
              c.name AS contractor_name
       FROM contractor_trucks ct
       LEFT JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = ct.tenant_id
       WHERE ct.tenant_id = @tenantId
       ORDER BY c.name, ct.registration`,
      { tenantId }
    ),
    query(
      `SELECT id, contractor_truck_id, fuel_price_per_litre, fuel_litres_per_100km,
              fuel_litres_per_100km_empty, return_empty_consumption_factor, notes, updated_at, updated_by
       FROM tracking_fuel_regulation WHERE tenant_id = @tenantId AND contractor_truck_id IS NOT NULL`,
      { tenantId }
    ),
    query(
      `SELECT id, fuel_price_per_litre, fuel_litres_per_100km, fuel_litres_per_100km_empty,
              return_empty_consumption_factor, notes, updated_at, updated_by
       FROM tracking_fuel_regulation WHERE tenant_id = @tenantId AND contractor_truck_id IS NULL`,
      { tenantId }
    ),
  ]);

  const regByTruck = new Map((regsR.recordset || []).map((r) => [gid(get(r, 'contractor_truck_id')), r]));
  const trucks = (trucksR.recordset || []).map((row) => {
    const id = gid(get(row, 'id'));
    const reg = regByTruck.get(id);
    return {
      contractor_truck_id: id,
      registration: get(row, 'registration'),
      make_model: get(row, 'make_model'),
      year_model: get(row, 'year_model'),
      contractor_name: get(row, 'contractor_name'),
      fuel_consumption_litres_per_100km: get(row, 'fuel_consumption_litres_per_100km') != null
        ? Number(get(row, 'fuel_consumption_litres_per_100km')) : null,
      fuel_tank_capacity_litres: get(row, 'fuel_tank_capacity_litres') != null
        ? Number(get(row, 'fuel_tank_capacity_litres')) : null,
      regulation: mapRegulationRow(reg),
    };
  });

  const def = defaultR.recordset?.[0];
  return {
    default_regulation: mapRegulationRow(def),
    trucks,
  };
}

export async function upsertFuelRegulation(query, tenantId, {
  contractor_truck_id,
  fuel_price_per_litre,
  fuel_litres_per_100km,
  fuel_litres_per_100km_empty,
  return_empty_consumption_factor,
  notes,
}, updatedBy) {
  const price = Number(fuel_price_per_litre);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Fuel price per litre is required');
  const truckId = contractor_truck_id ? gid(contractor_truck_id) : null;
  const l100 = fuel_litres_per_100km != null && fuel_litres_per_100km !== '' ? Number(fuel_litres_per_100km) : null;
  const l100Empty = fuel_litres_per_100km_empty != null && fuel_litres_per_100km_empty !== ''
    ? Number(fuel_litres_per_100km_empty) : null;
  const emptyFactor = return_empty_consumption_factor != null && return_empty_consumption_factor !== ''
    ? Number(return_empty_consumption_factor) : null;

  const existing = await query(
    `SELECT id FROM tracking_fuel_regulation
     WHERE tenant_id = @tenantId AND (
       (@truckId IS NULL AND contractor_truck_id IS NULL) OR contractor_truck_id = @truckId
     )`,
    { tenantId, truckId: truckId || null }
  );

  if (existing.recordset?.[0]) {
    const regId = rowId(existing.recordset[0]);
    if (!regId) throw new Error('Fuel regulation id is required');
    await query(
      `UPDATE tracking_fuel_regulation SET
        fuel_price_per_litre = @price,
        fuel_litres_per_100km = @l100,
        fuel_litres_per_100km_empty = @l100e,
        return_empty_consumption_factor = @ef,
        notes = @notes,
        updated_at = SYSUTCDATETIME(),
        updated_by = @by
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId,
        id: regId,
        price,
        l100,
        l100e: l100Empty,
        ef: emptyFactor,
        notes: notes || null,
        by: updatedBy || null,
      }
    );
    return { updated: true };
  }

  await query(
    `INSERT INTO tracking_fuel_regulation (
      tenant_id, contractor_truck_id, fuel_price_per_litre, fuel_litres_per_100km,
      fuel_litres_per_100km_empty, return_empty_consumption_factor, notes, updated_by
    ) VALUES (@tenantId, @truckId, @price, @l100, @l100e, @ef, @notes, @by)`,
    {
      tenantId,
      truckId: truckId || null,
      price,
      l100,
      l100e: l100Empty,
      ef: emptyFactor,
      notes: notes || null,
      by: updatedBy,
    }
  );
  return { updated: false };
}

export async function suggestFuelRegulationAi(query, tenantId, { contractor_truck_id, route_id }) {
  const { isAiConfigured, getOpenAiClient, getAiModel } = await import('./ai.js');
  if (!isAiConfigured()) {
    return { ai_configured: false, suggestion: null, message: 'AI not configured (set OPENAI_API_KEY)' };
  }

  const truck = contractor_truck_id
    ? await resolveTruckProfile(query, tenantId, { contractorTruckId: contractor_truck_id })
    : null;
  let routeInfo = null;
  if (route_id) {
    const rr = await query(
      `SELECT r.name, COALESCE(reg.distance_km, r.distance_km) AS distance_km,
              reg.fuel_litres_per_100km, reg.fuel_price_per_litre, reg.rate_per_ton
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @tenantId
       WHERE r.id = @routeId AND r.tenant_id = @tenantId`,
      { tenantId, routeId: route_id }
    );
    routeInfo = rr.recordset?.[0] || null;
  }

  const current = await getFuelRegulation(query, tenantId, truck ? gid(get(truck, 'id')) : null);
  const client = getOpenAiClient();
  const prompt = `You are a fleet economist advising on fuel regulation for haulage trucks in South Africa.
Given truck and route context, suggest fuel_price_per_litre (ZAR), fuel_litres_per_100km (loaded), fuel_litres_per_100km_empty (empty return to loading point), and return_empty_consumption_factor (0-1, used when empty L/100km not set).
Respond ONLY with JSON: {"fuel_price_per_litre": number, "fuel_litres_per_100km": number, "fuel_litres_per_100km_empty": number|null, "return_empty_consumption_factor": number|null, "summary": "one paragraph"}

Truck: ${JSON.stringify(truck ? { make_model: get(truck, 'make_model'), year_model: get(truck, 'year_model'), fleet_consumption_l_per_100km: get(truck, 'fuel_consumption_litres_per_100km') } : null)}
Route: ${JSON.stringify(routeInfo ? { name: get(routeInfo, 'name'), distance_km: get(routeInfo, 'distance_km'), existing_fuel_price: get(routeInfo, 'fuel_price_per_litre'), existing_l_per_100km: get(routeInfo, 'fuel_litres_per_100km') } : null)}
Current regulation: ${JSON.stringify(current ? { fuel_price_per_litre: get(current, 'fuel_price_per_litre'), fuel_litres_per_100km: get(current, 'fuel_litres_per_100km') } : null)}`;

  const res = await client.chat.completions.create({
    model: getAiModel(),
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
  });
  const text = res.choices?.[0]?.message?.content || '';
  try {
    const json = JSON.parse(text.replace(/```json?\s*|\s*```/g, '').trim());
    return { ai_configured: true, suggestion: json };
  } catch {
    return { ai_configured: true, suggestion: null, raw: text };
  }
}
