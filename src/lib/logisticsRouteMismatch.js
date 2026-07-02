/**
 * Detect and resolve trucks scheduled on one route but present at another route's loading geofence.
 */

import { isInsideGeofence } from './trackingGeofence.js';
import { scheduleTruckForRoute } from './logisticsActivityBoard.js';
import { parseGuid } from './guidUtils.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function gid(v) {
  return parseGuid(v);
}

/** Truck at loading geofence for a route other than the one it is scheduled on. */
export function detectRouteMismatch(trip, geofences, lat, lng) {
  const scheduledRouteId = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));
  if (!scheduledRouteId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const stage = String(get(trip, 'activity_stage') || '').toLowerCase();
  if (!['scheduled', 'at_loading'].includes(stage)) return null;
  if (String(get(trip, 'route_mismatch_status') || '').toLowerCase() === 'ignored') return null;

  for (const fence of geofences || []) {
    if (String(get(fence, 'leg') || '').toLowerCase() !== 'origin') continue;
    const fenceRouteId = gid(get(fence, 'contractor_route_id'));
    if (!fenceRouteId || fenceRouteId === scheduledRouteId) continue;
    const inside = isInsideGeofence(lat, lng, {
      center_lat: get(fence, 'center_lat'),
      center_lng: get(fence, 'center_lng'),
      radius_m: get(fence, 'radius_m'),
      polygon_json: get(fence, 'polygon_json'),
    });
    if (inside) {
      return {
        scheduled_route_id: scheduledRouteId,
        detected_route_id: fenceRouteId,
        detected_route_name: get(fence, 'route_name') || get(fence, 'name'),
      };
    }
  }
  return null;
}

/** Sync mismatch flags on active trips and return pending items for the UI. */
export async function syncRouteMismatches(query, tenantId, trips, geofences, routeById) {
  const pending = [];

  for (const trip of trips || []) {
    const tripId = gid(get(trip, 'id'));
    if (!tripId) continue;
    const status = String(get(trip, 'route_mismatch_status') || '').toLowerCase();
    if (status === 'ignored') continue;

    const lat = get(trip, 'last_lat') != null ? Number(get(trip, 'last_lat')) : null;
    const lng = get(trip, 'last_lng') != null ? Number(get(trip, 'last_lng')) : null;
    const detected = detectRouteMismatch(trip, geofences, lat, lng);

    if (detected) {
      const existingDetected = gid(get(trip, 'route_mismatch_route_id'));
      if (status !== 'pending' || existingDetected !== detected.detected_route_id) {
        await query(
          `UPDATE fleet_trip SET route_mismatch_route_id = @detected, route_mismatch_status = N'pending', updated_at = SYSUTCDATETIME()
           WHERE id = @id AND tenant_id = @tenantId`,
          { tenantId, id: tripId, detected: detected.detected_route_id }
        );
      }
      const scheduledRoute = routeById?.get(detected.scheduled_route_id);
      const detectedRoute = routeById?.get(detected.detected_route_id);
      pending.push({
        trip_id: tripId,
        truck_registration: get(trip, 'truck_registration'),
        scheduled_route_id: detected.scheduled_route_id,
        scheduled_route_name: scheduledRoute ? get(scheduledRoute, 'name') : null,
        detected_route_id: detected.detected_route_id,
        detected_route_name: detectedRoute ? get(detectedRoute, 'name') : detected.detected_route_name,
      });
    } else if (status === 'pending') {
      await query(
        `UPDATE fleet_trip SET route_mismatch_route_id = NULL, route_mismatch_status = NULL, updated_at = SYSUTCDATETIME()
         WHERE id = @id AND tenant_id = @tenantId`,
        { tenantId, id: tripId }
      );
    }
  }

  return pending;
}

export async function resolveRouteMismatch(query, tenantId, tripId, action) {
  const id = gid(tripId);
  if (!id) throw Object.assign(new Error('Trip id is required'), { status: 400 });

  const r = await query(
    `SELECT id, truck_registration, contractor_truck_id, contractor_route_id, route_mismatch_route_id, route_mismatch_status
     FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId AND status NOT IN (N'completed', N'cancelled')`,
    { tenantId, id }
  );
  const trip = r.recordset?.[0];
  if (!trip) throw Object.assign(new Error('Trip not found'), { status: 404 });

  const detectedRouteId = gid(get(trip, 'route_mismatch_route_id'));
  const status = String(get(trip, 'route_mismatch_status') || '').toLowerCase();
  if (!detectedRouteId || status !== 'pending') {
    throw Object.assign(new Error('No pending route mismatch for this trip'), { status: 400 });
  }

  const act = String(action || '').toLowerCase();
  if (act === 'amend') {
    await scheduleTruckForRoute(query, tenantId, {
      truck_registration: get(trip, 'truck_registration'),
      contractor_truck_id: get(trip, 'contractor_truck_id'),
      contractor_route_id: detectedRouteId,
    });
    await query(
      `UPDATE fleet_trip SET route_mismatch_route_id = NULL, route_mismatch_status = NULL, updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id }
    );
    return { ok: true, action: 'amend', trip_id: id, contractor_route_id: detectedRouteId };
  }

  if (act === 'ignore') {
    await query(
      `UPDATE fleet_trip SET route_mismatch_status = N'ignored', updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id }
    );
    return { ok: true, action: 'ignore', trip_id: id };
  }

  throw Object.assign(new Error('action must be amend or ignore'), { status: 400 });
}
