#!/usr/bin/env node
/**
 * Inserts demo tracking data: 1 provider, weighbridge, monitor route, 3 en-route trips with GPS (Gauteng corridor).
 * Safe to re-run: removes previous MOCK-DEMO-* trips for the tenant, then re-seeds.
 *
 * Prerequisites: npm run db:tracking-setup
 * Run: npm run db:tracking-mock
 * Optional env: TENANT_ID=<uuid> (defaults to first active tenant)
 */
import 'dotenv/config';
import { query, getPool } from '../src/db.js';

function gid(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.replace(/[{}]/g, '').toLowerCase();
  if (Buffer.isBuffer(v)) {
    const h = v.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toLowerCase();
  }
  return String(v);
}

async function main() {
  const tenantParam = process.env.TENANT_ID?.trim();
  let tenantId;
  let tenantName;
  if (tenantParam) {
    const t = await query(`SELECT id, name FROM tenants WHERE id = @id`, { id: tenantParam });
    if (!t.recordset?.[0]) {
      console.error('TENANT_ID not found:', tenantParam);
      process.exit(1);
    }
    tenantId = t.recordset[0].id;
    tenantName = t.recordset[0].name;
  } else {
    const tenants = await query(`SELECT TOP 1 id, name FROM tenants WHERE [status] = N'active' ORDER BY created_at ASC`);
    if (!tenants.recordset?.length) {
      console.error('No active tenant. Run npm run seed first or set TENANT_ID.');
      process.exit(1);
    }
    tenantId = tenants.recordset[0].id;
    tenantName = tenants.recordset[0].name;
  }

  console.log('Tenant:', tenantName, gid(tenantId));

  const chk = await query(
    `SELECT CASE WHEN OBJECT_ID(N'fleet_trip', N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`,
    {}
  );
  if (!chk.recordset?.[0]?.ok) {
    console.error('Tracking tables missing. Run: npm run db:tracking-setup');
    process.exit(1);
  }

  // Remove previous mock trips (dependents first)
  await query(
    `DELETE FROM tracking_alarm_record WHERE tenant_id = @tenantId AND trip_id IN (
       SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-DEMO-%')`,
    { tenantId }
  );
  await query(
    `DELETE FROM fleet_trip_deviation WHERE tenant_id = @tenantId AND trip_id IN (
       SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-DEMO-%')`,
    { tenantId }
  );
  await query(
    `DELETE FROM tracking_delivery_record WHERE tenant_id = @tenantId AND trip_id IN (
       SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-DEMO-%')`,
    { tenantId }
  );
  await query(`DELETE FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-DEMO-%'`, { tenantId });

  let providerId;
  const existingP = await query(
    `SELECT TOP 1 id FROM tracking_integration_provider WHERE tenant_id = @tenantId AND display_name = N'Demo mock telematics'`,
    { tenantId }
  );
  if (existingP.recordset?.[0]) {
    providerId = gid(existingP.recordset[0].id);
    console.log('Reusing provider:', providerId);
  } else {
    const ins = await query(
      `INSERT INTO tracking_integration_provider (tenant_id, display_name, provider_type, api_base_url, is_active)
       OUTPUT INSERTED.id
       VALUES (@tenantId, N'Demo mock telematics', N'custom_rest', N'https://demo.example.invalid/api', 1)`,
      { tenantId }
    );
    providerId = gid(ins.recordset[0].id);
    console.log('Created provider:', providerId);
  }

  let wbId;
  const existingWb = await query(
    `SELECT TOP 1 id FROM tracking_weighbridge WHERE tenant_id = @tenantId AND site_code = N'MOCK-WB'`,
    { tenantId }
  );
  if (existingWb.recordset?.[0]) {
    wbId = gid(existingWb.recordset[0].id);
    console.log('Reusing weighbridge:', wbId);
  } else {
    const ins = await query(
      `INSERT INTO tracking_weighbridge (tenant_id, colliery_name, site_code, api_endpoint, auth_type, is_active)
       OUTPUT INSERTED.id
       VALUES (@tenantId, N'Demo colliery weighbridge', N'MOCK-WB', N'https://demo.example.invalid/weigh', N'api_key', 1)`,
      { tenantId }
    );
    wbId = gid(ins.recordset[0].id);
    console.log('Created weighbridge:', wbId);
  }

  let routeId;
  const existingR = await query(
    `SELECT TOP 1 id FROM tracking_monitor_route WHERE tenant_id = @tenantId AND name = N'Demo — JHB ↔ PTA corridor'`,
    { tenantId }
  );
  /** Johannesburg CBD → Pretoria CBD (rough corridor) */
  const oLat = -26.2041;
  const oLng = 28.0473;
  const dLat = -25.7479;
  const dLng = 28.2293;
  if (existingR.recordset?.[0]) {
    routeId = gid(existingR.recordset[0].id);
    console.log('Reusing route:', routeId);
  } else {
    const ins = await query(
      `INSERT INTO tracking_monitor_route (tenant_id, name, collection_point_name, destination_name, origin_lat, origin_lng, dest_lat, dest_lng, is_active)
       OUTPUT INSERTED.id
       VALUES (@tenantId, N'Demo — JHB ↔ PTA corridor', N'Johannesburg load', N'Pretoria plant', @olat, @olng, @dlat, @dlng, 1)`,
      { tenantId, olat: oLat, olng: oLng, dlat: dLat, dlng: dLng }
    );
    routeId = gid(ins.recordset[0].id);
    console.log('Created route:', routeId);
  }

  await query(
    `IF NOT EXISTS (SELECT 1 FROM tracking_tenant_settings WHERE tenant_id = @tenantId)
       INSERT INTO tracking_tenant_settings (tenant_id) VALUES (@tenantId)`,
    { tenantId }
  );

  const trucks = [
    { ref: 'MOCK-DEMO-1', reg: 'CA12XGGP', t: 0.12, spd: 62 },
    { ref: 'MOCK-DEMO-2', reg: 'GP99ZZMP', t: 0.48, spd: 58 },
    { ref: 'MOCK-DEMO-3', reg: 'NW55AAGP', t: 0.78, spd: 71 },
  ];

  for (const tr of trucks) {
    const lat = oLat + (dLat - oLat) * tr.t;
    const lng = oLng + (dLng - oLng) * tr.t;
    await query(
      `INSERT INTO fleet_trip (
         tenant_id, trip_ref, truck_registration, weighbridge_id, route_id,
         collection_point_name, destination_name, status,
         declared_destination_at, started_at, eta_due_at,
         last_lat, last_lng, last_speed_kmh, last_heading_deg, last_seen_at,
         notes
       ) VALUES (
         @tenantId, @ref, @reg, @wb, @rid,
         N'Johannesburg load', N'Pretoria plant', N'enroute',
         SYSUTCDATETIME(), SYSUTCDATETIME(), DATEADD(hour, 3, SYSUTCDATETIME()),
         @lat, @lng, @spd, 35, SYSUTCDATETIME(),
         N'Demo mock trip — use Live map + demo tick (MOCK-* only).'
       )`,
      {
        tenantId,
        ref: tr.ref,
        reg: tr.reg,
        wb: wbId,
        rid: routeId,
        lat,
        lng,
        spd: tr.spd,
      }
    );
    console.log('Created trip', tr.ref, tr.reg, lat.toFixed(4), lng.toFixed(4));
  }

  console.log('\nDone. Open Tracking → Fleet movement, enable Live updates, or call POST /tracking/demo/tick while logged in.');
  const pool = await getPool();
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
