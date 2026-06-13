/** Apply GPS telemetry to a fleet trip + optional overspeed / idle alarms. */

import { sendOverspeedAlertEmail, sendParkingAlertEmail } from './trackingEmailAlerts.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export async function applyTelemetryToTrip(query, tenantId, tripId, payload) {
  const { lat, lng, speed_kmh, heading_deg } = payload || {};
  const tripR = await query(
    `SELECT truck_registration, last_speed_kmh, stationary_since_at, status
     FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
    { tenantId, id: tripId }
  );
  const trip = tripR.recordset?.[0];
  const reg = get(trip, 'truck_registration');
  const lowSpeed = speed_kmh != null && Number(speed_kmh) < 5;

  await query(
    `UPDATE fleet_trip SET last_lat = @lat, last_lng = @lng, last_speed_kmh = @spd, last_heading_deg = @hdg,
     last_seen_at = SYSUTCDATETIME(),
     stationary_since_at = CASE
       WHEN @spd IS NOT NULL AND @spd < 5 THEN COALESCE(stationary_since_at, SYSUTCDATETIME())
       ELSE NULL
     END,
     updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    {
      tenantId,
      id: tripId,
      lat: lat ?? null,
      lng: lng ?? null,
      spd: speed_kmh ?? null,
      hdg: heading_deg ?? null,
    }
  );

  const settingsR = await query(
    `SELECT alarm_overspeed_kmh, alarm_idle_minutes FROM tracking_tenant_settings WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const settings = settingsR.recordset?.[0];
  const maxS = settings ? get(settings, 'alarm_overspeed_kmh') : 90;
  const idleMin = settings ? Number(get(settings, 'alarm_idle_minutes')) || 30 : 30;

  if (speed_kmh != null && maxS != null && Number(speed_kmh) > Number(maxS)) {
    const recent = await query(
      `SELECT TOP 1 id FROM tracking_alarm_record
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND alarm_type = N'overspeed'
         AND occurred_at > DATEADD(minute, -5, SYSUTCDATETIME())`,
      { tenantId, tripId }
    );
    if (!recent.recordset?.[0]) {
      await query(
        `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, speed_kmh, detail)
         VALUES (@tenantId, @tripId, @reg, N'overspeed', N'warning', SYSUTCDATETIME(), @lat, @lng, @spd, @det)`,
        {
          tenantId,
          tripId,
          reg,
          lat: lat ?? null,
          lng: lng ?? null,
          spd: speed_kmh,
          det: `Speed ${speed_kmh} km/h exceeds limit ${maxS} km/h`,
        }
      );
      if (reg) {
        await sendOverspeedAlertEmail({
          query,
          tenantId,
          truckRegistration: reg,
          lat,
          lng,
          speedKmh: speed_kmh,
          limitKmh: maxS,
        });
      }
    }
  }

  if (lowSpeed && reg && ['enroute', 'deviated', 'overdue'].includes(String(get(trip, 'status') || '').toLowerCase())) {
    const statR = await query(
      `SELECT stationary_since_at FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId, id: tripId }
    );
    const stationarySince = get(statR.recordset?.[0], 'stationary_since_at');
    if (stationarySince) {
      const elapsedMin = (Date.now() - new Date(stationarySince).getTime()) / 60000;
      if (elapsedMin >= idleMin) {
        const recentIdle = await query(
          `SELECT TOP 1 id FROM tracking_alarm_record
           WHERE tenant_id = @tenantId AND trip_id = @tripId AND alarm_type = N'idle'
             AND occurred_at > DATEADD(minute, -30, SYSUTCDATETIME())`,
          { tenantId, tripId }
        );
        if (!recentIdle.recordset?.[0]) {
          await query(
            `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, detail)
             VALUES (@tenantId, @tripId, @reg, N'idle', N'warning', SYSUTCDATETIME(), @lat, @lng, @det)`,
            {
              tenantId,
              tripId,
              reg,
              lat: lat ?? null,
              lng: lng ?? null,
              det: `Stationary for ${Math.round(elapsedMin)} minutes (threshold ${idleMin} min)`,
            }
          );
          await sendParkingAlertEmail({
            query,
            tenantId,
            truckRegistration: reg,
            lat,
            lng,
            idleMinutes: idleMin,
          });
        }
      }
    }
  }
}
