/** Apply GPS telemetry to a fleet trip + optional overspeed alarm. */

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export async function applyTelemetryToTrip(query, tenantId, tripId, payload) {
  const { lat, lng, speed_kmh, heading_deg } = payload || {};
  await query(
    `UPDATE fleet_trip SET last_lat = @lat, last_lng = @lng, last_speed_kmh = @spd, last_heading_deg = @hdg,
     last_seen_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
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

  const settings = await query(`SELECT alarm_overspeed_kmh FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId });
  const maxS = settings.recordset?.[0] ? get(settings.recordset[0], 'alarm_overspeed_kmh') : 90;
  if (speed_kmh != null && maxS != null && Number(speed_kmh) > Number(maxS)) {
    const trip = await query(`SELECT truck_registration FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId, id: tripId });
    const reg = get(trip.recordset?.[0], 'truck_registration');
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
    }
  }
}
