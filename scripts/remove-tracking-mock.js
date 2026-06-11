#!/usr/bin/env node
/**
 * Remove demo/mock tracking data seeded by npm run db:tracking-mock.
 * Run: npm run db:tracking-mock:clean
 */
import 'dotenv/config';
import { query, getPool } from '../src/db.js';

function gid(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.replace(/[{}]/g, '').toLowerCase();
  return String(v);
}

async function main() {
  const tenantParam = process.env.TENANT_ID?.trim();
  let tenantId;
  if (tenantParam) {
    const t = await query(`SELECT id FROM tenants WHERE id = @id`, { id: tenantParam });
    if (!t.recordset?.[0]) {
      console.error('TENANT_ID not found:', tenantParam);
      process.exit(1);
    }
    tenantId = t.recordset[0].id;
  } else {
    const tenants = await query(`SELECT TOP 1 id FROM tenants WHERE [status] = N'active' ORDER BY created_at ASC`);
    if (!tenants.recordset?.length) {
      console.error('No active tenant.');
      process.exit(1);
    }
    tenantId = tenants.recordset[0].id;
  }

  const mockRegs = ['CA12XGGP', 'GP99ZZMP', 'NW55AAGP'];

  const delDeps = async (sql) => query(sql, { tenantId });

  await delDeps(`DELETE FROM tracking_alarm_record WHERE tenant_id = @tenantId AND trip_id IN (
    SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%')`);
  await delDeps(`DELETE FROM fleet_trip_deviation WHERE tenant_id = @tenantId AND trip_id IN (
    SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%')`);
  await delDeps(`DELETE FROM tracking_delivery_record WHERE tenant_id = @tenantId AND trip_id IN (
    SELECT id FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%')`);

  await delDeps(`DELETE FROM tracking_geofence_presence WHERE tenant_id = @tenantId AND truck_registration IN (N'CA12XGGP', N'GP99ZZMP', N'NW55AAGP')`);

  const tripDel = await delDeps(`DELETE FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%'`);
  const tripsRemoved = tripDel.rowsAffected?.[0] ?? 0;

  const wbDel = await delDeps(`DELETE FROM tracking_weighbridge WHERE tenant_id = @tenantId AND site_code = N'MOCK-WB'`);
  const routeDel = await delDeps(`DELETE FROM tracking_monitor_route WHERE tenant_id = @tenantId AND name = N'Demo — JHB ↔ PTA corridor'`);

  const provDel = await delDeps(`DELETE FROM tracking_integration_provider WHERE tenant_id = @tenantId AND display_name = N'Demo mock telematics'`);
  const providersRemoved = provDel.rowsAffected?.[0] ?? 0;

  console.log('Removed mock tracking data for tenant', gid(tenantId));
  console.log('  fleet trips (MOCK-*):', tripsRemoved);
  console.log('  demo provider(s):', providersRemoved);
  console.log('  demo weighbridge:', wbDel.rowsAffected?.[0] ?? 0);
  console.log('  demo monitor route:', routeDel.rowsAffected?.[0] ?? 0);

  const remaining = await query(
    `SELECT COUNT(*) AS c FROM fleet_trip WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%'`,
    { tenantId }
  );
  if (Number(remaining.recordset?.[0]?.c) > 0) {
    console.warn('Warning: some MOCK-* trips may remain (check FK constraints).');
    process.exit(1);
  }

  await (await getPool()).close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
