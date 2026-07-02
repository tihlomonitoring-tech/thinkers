/**
 * Logistics Activity Watcher — reconciles fleet_trip.activity_stage with GPS, geofence presence,
 * and route progress so trucks land in the correct column automatically.
 */

import { isInsideGeofence, DESTINATION_DEPARTURE_COMPLETE_KM, maxDistanceOutsideRouteLegKm, shouldAutoCompleteAfterDestinationExit } from './trackingGeofence.js';
import {
  parseCorridorPolyline,
  parseMonitorWaypoints,
  polylineDistanceKm,
} from './routeCorridorGeofence.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : null;
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

function fenceInside(lat, lng, fence) {
  return isInsideGeofence(lat, lng, {
    center_lat: get(fence, 'center_lat'),
    center_lng: get(fence, 'center_lng'),
    radius_m: get(fence, 'radius_m'),
    polygon_json: get(fence, 'polygon_json'),
  });
}

function resolveRoutePolyline(routeId, corridorRows, monitorRows) {
  if (!routeId) return null;
  for (const row of corridorRows || []) {
    if (gid(get(row, 'contractor_route_id')) !== routeId) continue;
    const pl = parseCorridorPolyline(get(row, 'polygon_json'));
    if (pl?.length >= 2) return pl;
  }
  for (const row of monitorRows || []) {
    if (gid(get(row, 'contractor_route_id')) !== routeId) continue;
    const pl = parseMonitorWaypoints(get(row, 'waypoints_json'));
    if (pl?.length >= 2) return pl;
  }
  return null;
}

function routeGeofenceFlags(lat, lng, routeId, geofences) {
  let atOrigin = false;
  let atDestination = false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { atOrigin, atDestination };
  for (const fence of geofences || []) {
    const rid = gid(get(fence, 'contractor_route_id'));
    if (routeId && rid && rid !== routeId) continue;
    const leg = String(get(fence, 'leg') || '').toLowerCase();
    if (leg !== 'origin' && leg !== 'destination') continue;
    if (!fenceInside(lat, lng, fence)) continue;
    if (leg === 'origin') atOrigin = true;
    if (leg === 'destination') atDestination = true;
  }
  return { atOrigin, atDestination };
}

/**
 * Determine the stage a trip should be in based on live signals.
 */
export function inferExpectedActivityStage(trip, ctx) {
  const stored = String(get(trip, 'activity_stage') || 'scheduled').toLowerCase();
  const status = String(get(trip, 'status') || '').toLowerCase();
  const {
    atOrigin, atDestination, traveledKm, totalKm, remainingKm, workflow, kmOutsideDestination,
  } = ctx;

  if (String(get(trip, 'route_mismatch_status') || '').toLowerCase() === 'ignored') {
    return { stage: stored, reason: null };
  }

  if (stored === 'awaiting_reschedule' && atOrigin) {
    return { stage: 'at_loading', reason: 'Returned to origin geofence' };
  }

  if (atDestination) {
    if (stored !== 'at_destination' && stored !== 'awaiting_reschedule') {
      return { stage: 'at_destination', reason: 'Inside destination geofence' };
    }
    return { stage: stored, reason: null };
  }

  if (atOrigin && (stored === 'scheduled' || stored === 'awaiting_reschedule')) {
    return { stage: 'at_loading', reason: 'Inside loading geofence' };
  }

  const started = !!get(trip, 'started_at');
  const enrouteStatus = ['enroute', 'deviated', 'overdue'].includes(status);

  if (stored === 'at_loading' && !atOrigin && (started || enrouteStatus || (traveledKm != null && traveledKm > 1.5))) {
    return { stage: 'enroute', reason: 'Departed loading site' };
  }

  if ((stored === 'scheduled' || stored === 'at_loading') && !atOrigin && !atDestination) {
    if (enrouteStatus || started) {
      return { stage: 'enroute', reason: 'Trip status indicates en route' };
    }
    if (traveledKm != null && traveledKm > 2) {
      return { stage: 'enroute', reason: 'GPS shows distance traveled from origin' };
    }
    if (remainingKm != null && totalKm != null && totalKm > 0 && remainingKm < totalKm * 0.12) {
      return { stage: 'at_destination', reason: 'GPS near destination (within 12% of route)' };
    }
  }

  if (stored === 'enroute') {
    if (remainingKm != null && remainingKm <= 2) {
      return { stage: 'at_destination', reason: 'Within 2 km of destination' };
    }
    if (remainingKm != null && totalKm != null && totalKm > 0 && remainingKm < totalKm * 0.05) {
      return { stage: 'at_destination', reason: 'Within 5% of destination' };
    }
  }

  if (stored === 'at_destination' && get(trip, 'offloading_slip_no') && !workflow.require_offloading_slip_at_destination) {
    const outside = kmOutsideDestination != null ? kmOutsideDestination : 0;
    const exited = !!get(trip, 'destination_geofence_exited_at');
    if (shouldAutoCompleteAfterDestinationExit(trip, outside, exited)) {
      return {
        stage: 'awaiting_reschedule',
        reason: `Exited destination geofence and is ${DESTINATION_DEPARTURE_COMPLETE_KM}+ km away`,
      };
    }
    return { stage: stored, reason: null };
  }

  return { stage: stored, reason: null };
}

async function applyStageFix(query, tenantId, trip, targetStage, route, board, workflow) {
  const tripId = gid(get(trip, 'id'));
  const rid = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));

  if (targetStage === 'at_loading') {
    return board.allocateTripAtLoading(query, tenantId, tripId, trip, rid, route);
  }
  if (targetStage === 'enroute') {
    const defer = !board.tripHasLoadingSlip(trip) && workflow.require_loading_slip_before_enroute;
    return board.moveTripActivityStage(query, tenantId, tripId, 'enroute', { defer_slip: defer });
  }
  if (targetStage === 'at_destination') {
    return board.moveTripActivityStage(query, tenantId, tripId, 'at_destination');
  }
  if (targetStage === 'awaiting_reschedule') {
    if (board.tripHasLoadingSlip(trip) && !workflow.require_offloading_slip_at_destination) {
      return board.completeDestinationDelivery(query, tenantId, tripId, {
        offloading_slip_no: board.AUTO_OFFLOAD_SLIP,
        auto_complete: true,
      });
    }
    return board.moveTripActivityStage(query, tenantId, tripId, 'awaiting_reschedule');
  }
  return board.moveTripActivityStage(query, tenantId, tripId, targetStage);
}

/**
 * Scan active trips and auto-correct activity_stage when GPS/geofence signals disagree.
 */
export async function reconcileLogisticsActivityStages(query, tenantId) {
  const board = await import('./logisticsActivityBoard.js');
  const stats = { checked: 0, fixed: 0, fixes: [] };

  const [tripsR, geofencesR, routesR, corridorR, monitorR, settingsR, geofenceCoordsR] = await Promise.all([
    query(
      `SELECT t.* FROM fleet_trip t
       WHERE t.tenant_id = @tenantId
         AND t.status NOT IN (N'completed', N'cancelled')
         AND (
           t.activity_stage IS NOT NULL
           OR t.scheduled_at IS NOT NULL
           OR t.status IN (N'pending', N'enroute', N'deviated', N'overdue')
         )`,
      { tenantId }
    ),
    query(
      `SELECT id, contractor_route_id, leg, center_lat, center_lng, radius_m, polygon_json
       FROM tracking_geofence WHERE tenant_id = @tenantId AND leg IN (N'origin', N'destination')`,
      { tenantId }
    ),
    query(
      `SELECT id, name, loading_address, destination_address, distance_km
       FROM contractor_routes WHERE tenant_id = @tenantId`,
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
    query(
      `SELECT require_offloading_slip_at_destination, require_loading_slip_before_enroute
       FROM tracking_tenant_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    ),
    query(
      `SELECT contractor_route_id, leg, center_lat, center_lng FROM tracking_geofence
       WHERE tenant_id = @tenantId AND leg IN (N'origin', N'destination')
         AND contractor_route_id IS NOT NULL AND center_lat IS NOT NULL`,
      { tenantId }
    ),
  ]);

  const settingsRow = settingsR.recordset?.[0];
  const workflow = {
    require_offloading_slip_at_destination: settingsRow == null
      || (get(settingsRow, 'require_offloading_slip_at_destination') !== false
        && get(settingsRow, 'require_offloading_slip_at_destination') !== 0),
    require_loading_slip_before_enroute: settingsRow == null
      || (get(settingsRow, 'require_loading_slip_before_enroute') !== false
        && get(settingsRow, 'require_loading_slip_before_enroute') !== 0),
  };
  const routeById = new Map((routesR.recordset || []).map((r) => [gid(get(r, 'id')), r]));
  const destCoords = new Map();
  for (const g of geofenceCoordsR.recordset || []) {
    const rid = gid(get(g, 'contractor_route_id'));
    if (!rid) continue;
    if (String(get(g, 'leg') || '').toLowerCase() === 'destination' && !destCoords.has(rid)) {
      destCoords.set(rid, { lat: Number(get(g, 'center_lat')), lng: Number(get(g, 'center_lng')) });
    }
  }
  const geofences = geofencesR.recordset || [];

  for (const trip of tripsR.recordset || []) {
    stats.checked++;
    const lat = get(trip, 'last_lat') != null ? Number(get(trip, 'last_lat')) : null;
    const lng = get(trip, 'last_lng') != null ? Number(get(trip, 'last_lng')) : null;
    const rid = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));
    const route = rid ? routeById.get(rid) : null;
    const stored = String(get(trip, 'activity_stage') || 'scheduled').toLowerCase();
    if (String(get(trip, 'route_mismatch_status') || '').toLowerCase() === 'ignored') continue;

    const { atOrigin, atDestination } = routeGeofenceFlags(lat, lng, rid, geofences);
    const kmOutsideDestination = maxDistanceOutsideRouteLegKm(lat, lng, rid, geofences, 'destination');

    const polyline = resolveRoutePolyline(rid, corridorR.recordset, monitorR.recordset);
    const routeDistanceKm = polyline?.length >= 2
      ? polylineDistanceKm(polyline)
      : (route && Number(get(route, 'distance_km')) > 0 ? Number(get(route, 'distance_km')) : null);
    const dest = destCoords.get(rid);
    const dist = board.computeRouteDistances({
      activity_stage: 'enroute',
      last_lat: lat,
      last_lng: lng,
      destination_lat: dest?.lat,
      destination_lng: dest?.lng,
      route_polyline: polyline,
      route_distance_km: routeDistanceKm,
    });

    const { stage: expected, reason } = inferExpectedActivityStage(trip, {
      atOrigin,
      atDestination,
      traveledKm: dist.km_traveled,
      totalKm: dist.route_distance_km ?? routeDistanceKm,
      remainingKm: dist.km_remaining,
      workflow,
      kmOutsideDestination,
    });

    if (!reason || expected === stored) continue;

    try {
      await applyStageFix(query, tenantId, trip, expected, route, board, workflow);
      stats.fixed += 1;
      stats.fixes.push({
        trip_id: gid(get(trip, 'id')),
        truck_registration: get(trip, 'truck_registration'),
        from: stored,
        to: expected,
        reason,
      });
      await query(
        `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, detail)
         VALUES (@tenantId, @tripId, @reg, N'stage_reconcile', N'info', SYSUTCDATETIME(), @lat, @lng, @det)`,
        {
          tenantId,
          tripId: gid(get(trip, 'id')),
          reg: get(trip, 'truck_registration'),
          lat: lat ?? null,
          lng: lng ?? null,
          det: `Watcher moved ${get(trip, 'truck_registration')}: ${stored} → ${expected} (${reason})`,
        }
      );
    } catch (err) {
      console.warn('[logistics-watcher] fix failed', get(trip, 'truck_registration'), err?.message || err);
    }
  }

  return stats;
}
