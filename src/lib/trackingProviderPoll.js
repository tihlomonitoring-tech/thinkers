import { query } from '../db.js';
import { applyTelemetryToTrip } from './trackingTelemetry.js';
import { fetchProviderPositions, matchPositionToVehicle } from './trackingConnectors.js';
import { processGeofencePositions } from './trackingGeofenceEngine.js';

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

function normReg(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

let pollRunning = false;
let lastPollAt = null;
let lastPollStats = null;

export function getTrackingPollStatus() {
  return {
    enabled: isTrackingPollEnabled(),
    interval_ms: pollIntervalMs(),
    last_poll_at: lastPollAt,
    last_stats: lastPollStats,
    running: pollRunning,
  };
}

export function isTrackingPollEnabled() {
  const v = String(process.env.TRACKING_POLL_ENABLED ?? 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function pollIntervalMs() {
  const n = parseInt(String(process.env.TRACKING_POLL_INTERVAL_MS || '60000'), 10);
  return Number.isFinite(n) && n >= 15000 ? n : 60000;
}

async function schemaReady() {
  try {
    const r = await query(
      `SELECT CASE WHEN OBJECT_ID(N'fleet_trip', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_integration_provider', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_vehicle_link', N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`,
      {}
    );
    return !!get(r.recordset?.[0], 'ok');
  } catch {
    return false;
  }
}

async function ensureTripForVehicle(tenantId, vehicle, position) {
  const reg = normReg(vehicle.truck_registration);
  const active = await query(
    `SELECT TOP 1 id, truck_registration, last_lat, last_lng, status FROM fleet_trip
     WHERE tenant_id = @tenantId AND truck_registration = @reg AND status NOT IN (N'completed', N'cancelled')
     ORDER BY updated_at DESC`,
    { tenantId, reg }
  );
  if (active.recordset?.[0]) return active.recordset[0];

  const ref = `TRK-POLL-${reg.slice(-6)}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const ins = await query(
    `INSERT INTO fleet_trip (tenant_id, trip_ref, truck_registration, contractor_truck_id, status, last_lat, last_lng, last_seen_at)
     OUTPUT INSERTED.id, INSERTED.truck_registration, INSERTED.last_lat, INSERTED.last_lng, INSERTED.status
     VALUES (@tenantId, @ref, @reg, @ctid, N'pending', @lat, @lng, SYSUTCDATETIME())`,
    {
      tenantId,
      ref,
      reg,
      ctid: vehicle.contractor_truck_id || null,
      lat: position.lat,
      lng: position.lng,
    }
  );
  return ins.recordset?.[0];
}

/** Poll all active telematics providers and push GPS into fleet trips. */
export async function runTrackingProviderPoll() {
  if (!isTrackingPollEnabled()) return { skipped: true, reason: 'disabled' };
  if (pollRunning) return { skipped: true, reason: 'already_running' };
  if (!(await schemaReady())) return { skipped: true, reason: 'schema_missing' };

  pollRunning = true;
  const stats = {
    providers: 0,
    vehicles: 0,
    positions: 0,
    trips_updated: 0,
    tenants_geofenced: 0,
    errors: 0,
  };

  try {
    const providersR = await query(
      `SELECT p.id, p.tenant_id, p.display_name, p.provider_type, p.api_base_url, p.api_key, p.api_secret, p.username, p.extra_json
       FROM tracking_integration_provider p WHERE p.is_active = 1`,
      {}
    );
    const providers = providersR.recordset || [];
    stats.providers = providers.length;

    const tenantsTouched = new Set();

    for (const prow of providers) {
      const tenantId = gid(get(prow, 'tenant_id'));
      const providerId = gid(get(prow, 'id'));
      const provider = {
        id: providerId,
        display_name: get(prow, 'display_name'),
        provider_type: get(prow, 'provider_type'),
        api_base_url: get(prow, 'api_base_url'),
        api_key: get(prow, 'api_key'),
        api_secret: get(prow, 'api_secret'),
        username: get(prow, 'username'),
        extra_json: get(prow, 'extra_json'),
      };

      const vehiclesR = await query(
        `SELECT id, truck_registration, external_vehicle_id, contractor_truck_id
         FROM tracking_vehicle_link
         WHERE tenant_id = @tenantId
           AND provider_id = @pid
           AND monitor_enabled = 1`,
        { tenantId, pid: providerId }
      );
      const vehicles = (vehiclesR.recordset || []).map((v) => ({
        id: gid(get(v, 'id')),
        truck_registration: get(v, 'truck_registration'),
        external_vehicle_id: get(v, 'external_vehicle_id'),
        contractor_truck_id: gid(get(v, 'contractor_truck_id')),
      }));
      if (!vehicles.length) continue;
      stats.vehicles += vehicles.length;

      const tripByReg = new Map();
      for (const v of vehicles) {
        const reg = normReg(v.truck_registration);
        const tr = await query(
          `SELECT TOP 1 id, truck_registration, last_lat, last_lng, status FROM fleet_trip
           WHERE tenant_id = @tenantId AND truck_registration = @reg AND status NOT IN (N'completed', N'cancelled')
           ORDER BY updated_at DESC`,
          { tenantId, reg }
        );
        if (tr.recordset?.[0]) tripByReg.set(reg, tr.recordset[0]);
      }

      let positions = [];
      try {
        positions = await fetchProviderPositions(provider, vehicles, { tripByReg, allowSimulate: true });
      } catch (err) {
        stats.errors++;
        console.warn('[trackingPoll] provider', provider.display_name, err?.message || err);
        continue;
      }

      stats.positions += positions.length;

      for (const pos of positions) {
        try {
          const vehicle = matchPositionToVehicle(pos, vehicles);
          const reg = normReg(pos.registration || vehicle?.truck_registration);
          if (!reg) continue;

          let trip = tripByReg.get(reg);
          if (!trip && vehicle) {
            trip = await ensureTripForVehicle(tenantId, vehicle, pos);
            if (trip) tripByReg.set(reg, trip);
          }
          if (!trip) {
            const tr = await query(
              `SELECT TOP 1 id FROM fleet_trip WHERE tenant_id = @tenantId AND truck_registration = @reg AND status NOT IN (N'completed', N'cancelled')`,
              { tenantId, reg }
            );
            trip = tr.recordset?.[0];
          }
          if (!trip) continue;

          await applyTelemetryToTrip(query, tenantId, gid(get(trip, 'id')), {
            lat: pos.lat,
            lng: pos.lng,
            speed_kmh: pos.speed_kmh,
            heading_deg: pos.heading_deg,
          });
          stats.trips_updated++;
          tenantsTouched.add(tenantId);
        } catch (err) {
          stats.errors++;
          console.warn('[trackingPoll] telemetry', err?.message || err);
        }
      }
    }

    const mockTenants = await query(
      `SELECT DISTINCT tenant_id FROM fleet_trip WHERE trip_ref LIKE N'MOCK-%' AND status IN (N'enroute', N'deviated', N'pending')`,
      {}
    );
    for (const row of mockTenants.recordset || []) {
      const tenantId = gid(get(row, 'tenant_id'));
      const mockR = await query(
        `SELECT id, truck_registration, last_lat, last_lng FROM fleet_trip
         WHERE tenant_id = @tenantId AND trip_ref LIKE N'MOCK-%' AND status IN (N'enroute', N'deviated', N'pending')`,
        { tenantId }
      );
      for (const mt of mockR.recordset || []) {
        const tripId = gid(get(mt, 'id'));
        let lat = Number(get(mt, 'last_lat'));
        let lng = Number(get(mt, 'last_lng'));
        if (!Number.isFinite(lat)) lat = -26.2;
        if (!Number.isFinite(lng)) lng = 28.05;
        const idStr = tripId || '';
        let phase = 0;
        for (let i = 0; i < idStr.length; i++) phase += idStr.charCodeAt(i);
        const rad = Date.now() / 9000 + (phase % 100) * 0.01;
        lat += Math.sin(rad) * 0.003;
        lng += Math.cos(rad * 1.27) * 0.003;
        const spd = 52 + Math.round((Math.sin(rad * 2) + 1) * 15);
        await applyTelemetryToTrip(query, tenantId, tripId, { lat, lng, speed_kmh: spd, heading_deg: 35 });
        stats.trips_updated++;
        tenantsTouched.add(tenantId);
      }
    }

    for (const tenantId of tenantsTouched) {
      try {
        await processGeofencePositions(query, tenantId);
        stats.tenants_geofenced++;
      } catch (err) {
        stats.errors++;
        console.warn('[trackingPoll] geofence', tenantId, err?.message || err);
      }
    }

    lastPollAt = new Date().toISOString();
    lastPollStats = stats;
    if (stats.trips_updated > 0 || stats.errors > 0) {
      console.log('[trackingPoll]', JSON.stringify(stats));
    }
    return stats;
  } finally {
    pollRunning = false;
  }
}
