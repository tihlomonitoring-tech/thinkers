import { isInsideGeofence } from './trackingGeofence.js';
import { sendGeofenceAlertEmail } from './trackingEmailAlerts.js';
import { todayYmd } from './appTime.js';
import {
  gid,
  openDestinationDeliveryRecord,
  allocateTripAtLoading,
} from './logisticsActivityBoard.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function isInsideRouteAltCorridor(fences, lat, lng, routeId) {
  if (!routeId) return false;
  for (const f of fences) {
    if (gid(get(f, 'contractor_route_id')) !== routeId) continue;
    if (String(get(f, 'leg') || '').toLowerCase() !== 'corridor_alt') continue;
    if (isInsideGeofence(lat, lng, {
      center_lat: get(f, 'center_lat'),
      center_lng: get(f, 'center_lng'),
      radius_m: get(f, 'radius_m'),
      polygon_json: get(f, 'polygon_json'),
    })) return true;
  }
  return false;
}

/**
 * Process vehicle positions against geofences: logistics activity stages, exit alerts.
 * @returns {{ processed: number, allocated: number, alerts: number, pending_notes: number }}
 */
export async function processGeofencePositions(query, tenantId) {
  const stats = { processed: 0, allocated: 0, alerts: 0, pending_notes: 0 };

  const tripsR = await query(
    `SELECT t.id, t.truck_registration, t.contractor_truck_id, t.route_id, t.contractor_route_id,
            t.status, t.activity_stage, t.driver_name, t.last_lat, t.last_lng,
            t.destination_name, t.collection_point_name, t.started_at
     FROM fleet_trip t
     WHERE t.tenant_id = @tenantId
       AND t.status NOT IN (N'completed', N'cancelled')
       AND t.last_lat IS NOT NULL AND t.last_lng IS NOT NULL`,
    { tenantId }
  );
  const trips = tripsR.recordset || [];

  const fencesR = await query(
    `SELECT g.*, cr.name AS route_name, cr.loading_address, cr.destination_address
     FROM tracking_geofence g
     LEFT JOIN contractor_routes cr ON cr.id = g.contractor_route_id AND cr.tenant_id = g.tenant_id
     WHERE g.tenant_id = @tenantId`,
    { tenantId }
  );
  const fences = fencesR.recordset || [];

  const routesR = await query(
    `SELECT id, name, loading_address, destination_address FROM contractor_routes WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const routeById = new Map((routesR.recordset || []).map((r) => [gid(get(r, 'id')), r]));

  for (const trip of trips) {
    const reg = String(get(trip, 'truck_registration') || '').trim();
    const lat = Number(get(trip, 'last_lat'));
    const lng = Number(get(trip, 'last_lng'));
    if (!reg || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    stats.processed++;

    const tripId = gid(get(trip, 'id'));
    const ctid = gid(get(trip, 'contractor_truck_id'));
    const currentRouteId = gid(get(trip, 'contractor_route_id')) || gid(get(trip, 'route_id'));
    const activityStage = String(get(trip, 'activity_stage') || '').toLowerCase();
    const tripStatus = String(get(trip, 'status') || '').toLowerCase();

    for (const fence of fences) {
      const fenceId = gid(get(fence, 'id'));
      const inside = isInsideGeofence(lat, lng, {
        center_lat: get(fence, 'center_lat'),
        center_lng: get(fence, 'center_lng'),
        radius_m: get(fence, 'radius_m'),
        polygon_json: get(fence, 'polygon_json'),
      });

      const presR = await query(
        `SELECT id, is_inside FROM tracking_geofence_presence
         WHERE tenant_id = @tenantId AND geofence_id = @fenceId AND truck_registration = @reg`,
        { tenantId, fenceId, reg }
      );
      const prev = presR.recordset?.[0];
      const wasInside = prev ? !!get(prev, 'is_inside') : false;

      if (prev) {
        await query(
          `UPDATE tracking_geofence_presence SET is_inside = @inside, last_lat = @lat, last_lng = @lng,
           last_changed_at = CASE WHEN is_inside <> @inside THEN SYSUTCDATETIME() ELSE last_changed_at END,
           updated_at = SYSUTCDATETIME()
           WHERE id = @id`,
          { id: gid(get(prev, 'id')), inside: inside ? 1 : 0, lat, lng }
        );
      } else {
        await query(
          `INSERT INTO tracking_geofence_presence (tenant_id, geofence_id, truck_registration, contractor_truck_id, is_inside, last_lat, last_lng)
           VALUES (@tenantId, @fenceId, @reg, @ctid, @inside, @lat, @lng)`,
          { tenantId, fenceId, reg, ctid: ctid || null, inside: inside ? 1 : 0, lat, lng }
        );
      }

      const leg = String(get(fence, 'leg') || '').toLowerCase();
      const contractorRouteId = gid(get(fence, 'contractor_route_id'));
      const routeName = get(fence, 'route_name') || (contractorRouteId && routeById.get(contractorRouteId) ? get(routeById.get(contractorRouteId), 'name') : null);
      const fenceName = get(fence, 'name');
      const route = contractorRouteId ? routeById.get(contractorRouteId) : null;

      if (!wasInside && inside) {
        if (get(fence, 'alert_on_entry')) {
          const fenceType = String(get(fence, 'fence_type') || '').toLowerCase();
          if (fenceType === 'hazard' || leg === 'alert') {
            await query(
              `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, detail)
               VALUES (@tenantId, @tripId, @reg, N'geofence', N'warning', SYSUTCDATETIME(), @lat, @lng, @det)`,
              {
                tenantId,
                tripId,
                reg,
                lat,
                lng,
                det: `Entered alert zone: ${fenceName}${routeName ? ` (${routeName})` : ''}`,
              }
            );
          }
          if (leg !== 'origin' && leg !== 'destination') {
            await sendGeofenceAlertEmail({
              query,
              tenantId,
              truckRegistration: reg,
              geofenceName: fenceName,
              eventType: 'entry',
              lat,
              lng,
              routeName,
              leg,
              fenceType: get(fence, 'fence_type'),
            });
            stats.alerts++;
          }
        }

        if (leg === 'origin' && contractorRouteId) {
          const routeMatch = !currentRouteId || currentRouteId === contractorRouteId;
          const isReturnAfterDelivery = activityStage === 'awaiting_reschedule';

          if (isReturnAfterDelivery && routeMatch) {
            await allocateTripAtLoading(query, tenantId, tripId, trip, contractorRouteId, route);
            await sendGeofenceAlertEmail({
              query,
              tenantId,
              truckRegistration: reg,
              geofenceName: fenceName || 'Loading point',
              eventType: 'entry',
              lat,
              lng,
              routeName,
              leg: 'origin',
              notificationType: 'loading',
            });
            stats.alerts++;
            stats.allocated++;
            stats.pending_notes++;
          } else if (routeMatch && !isReturnAfterDelivery) {
            await allocateTripAtLoading(query, tenantId, tripId, trip, contractorRouteId, route);
            await sendGeofenceAlertEmail({
              query,
              tenantId,
              truckRegistration: reg,
              geofenceName: fenceName || 'Loading point',
              eventType: 'entry',
              lat,
              lng,
              routeName,
              leg: 'origin',
              notificationType: 'loading',
            });
            stats.alerts++;
            stats.allocated++;
            stats.pending_notes++;
          }
        }

        if (leg === 'destination' && contractorRouteId) {
          const matchRoute = !currentRouteId || currentRouteId === contractorRouteId;
          const canArrive = matchRoute && (['enroute', 'deviated', 'overdue'].includes(tripStatus) || activityStage === 'enroute');
          if (canArrive) {
            await query(
              `UPDATE fleet_trip SET
                activity_stage = N'at_destination',
                at_destination_at = COALESCE(at_destination_at, SYSUTCDATETIME()),
                status = N'pending',
                updated_at = SYSUTCDATETIME()
               WHERE id = @id AND tenant_id = @tenantId`,
              { tenantId, id: tripId }
            );
            await openDestinationDeliveryRecord(query, tenantId, tripId, trip, contractorRouteId);
            await sendGeofenceAlertEmail({
              query,
              tenantId,
              truckRegistration: reg,
              geofenceName: fenceName || 'Destination',
              eventType: 'entry',
              lat,
              lng,
              routeName,
              leg: 'destination',
              notificationType: 'offloading',
            });
            stats.alerts++;
            stats.pending_notes++;
          }
        }
      }

      if (wasInside && !inside) {
        if (get(fence, 'alert_on_exit')) {
          const suppressCorridorExit = leg === 'corridor'
            && isInsideRouteAltCorridor(fences, lat, lng, contractorRouteId);
          if (!suppressCorridorExit) {
            await query(
              `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, detail)
               VALUES (@tenantId, @tripId, @reg, N'geofence', N'warning', SYSUTCDATETIME(), @lat, @lng, @det)`,
              {
                tenantId,
                tripId,
                reg,
                lat,
                lng,
                det: `Exited geofence: ${fenceName}${routeName ? ` (${routeName})` : ''}`,
              }
            );
            await sendGeofenceAlertEmail({
              query,
              tenantId,
              truckRegistration: reg,
              geofenceName: fenceName,
              eventType: 'exit',
              lat,
              lng,
              routeName,
              leg,
              fenceType: get(fence, 'fence_type'),
            });
            stats.alerts++;
          }
        }
      }
    }
  }

  return stats;
}

/** Import contractor trucks that have tracking_provider into vehicle links. */
export async function syncContractorFleetToTracking(query, tenantId) {
  const providerMap = {
    cartrack: 'cartrack',
    fleetcam: 'fleetcam',
    'nest tar': 'netstar',
    netstar: 'netstar',
  };
  const trucksR = await query(
    `SELECT t.id, t.registration, t.fleet_no, t.tracking_provider, t.tracking_username
     FROM contractor_trucks t
     WHERE t.tenant_id = @tenantId AND t.tracking_provider IS NOT NULL AND LTRIM(RTRIM(t.tracking_provider)) <> N''`,
    { tenantId }
  );
  let linked = 0;
  let providersCreated = 0;
  for (const row of trucksR.recordset || []) {
    const reg = String(get(row, 'registration') || '').trim();
    const providerLabel = String(get(row, 'tracking_provider') || '').trim();
    if (!reg || !providerLabel) continue;
    const pt = providerMap[providerLabel.toLowerCase()] || 'custom_rest';
    let provR = await query(
      `SELECT TOP 1 id FROM tracking_integration_provider WHERE tenant_id = @tenantId AND provider_type = @pt`,
      { tenantId, pt }
    );
    let providerId = gid(get(provR.recordset?.[0], 'id'));
    if (!providerId) {
      const ins = await query(
        `INSERT INTO tracking_integration_provider (tenant_id, display_name, provider_type, username, is_active)
         OUTPUT INSERTED.id VALUES (@tenantId, @dn, @pt, @un, 1)`,
        { tenantId, dn: providerLabel, pt, un: get(row, 'tracking_username') || null }
      );
      providerId = gid(get(ins.recordset?.[0], 'id'));
      providersCreated++;
    }
    const exists = await query(
      `SELECT id FROM tracking_vehicle_link WHERE tenant_id = @tenantId AND truck_registration = @reg`,
      { tenantId, reg }
    );
    if (exists.recordset?.[0]) continue;
    await query(
      `INSERT INTO tracking_vehicle_link (tenant_id, provider_id, truck_registration, fleet_no, contractor_truck_id)
       VALUES (@tenantId, @pid, @reg, @fn, @ctid)`,
      { tenantId, pid: providerId, reg, fn: get(row, 'fleet_no'), ctid: gid(get(row, 'id')) }
    );
    linked++;
    const tripExists = await query(
      `SELECT TOP 1 id FROM fleet_trip WHERE tenant_id = @tenantId AND truck_registration = @reg AND status NOT IN (N'completed', N'cancelled')`,
      { tenantId, reg }
    );
    if (!tripExists.recordset?.[0]) {
      const ref = `TRK-${todayYmd().replace(/-/g, '')}-${reg.replace(/\s+/g, '').slice(-6).toUpperCase()}`;
      await query(
        `INSERT INTO fleet_trip (tenant_id, trip_ref, truck_registration, contractor_truck_id, status)
         VALUES (@tenantId, @ref, @reg, @ctid, N'pending')`,
        { tenantId, ref, reg, ctid: gid(get(row, 'id')) }
      );
    }
  }
  return { linked, providersCreated };
}
