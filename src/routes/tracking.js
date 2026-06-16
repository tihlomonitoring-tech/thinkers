import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { todayYmd } from '../lib/appTime.js';
import { processGeofencePositions, syncContractorFleetToTracking } from '../lib/trackingGeofenceEngine.js';
import { geocodeAddress, drivingRouteAlternatives, locationContextAt, reverseGeocode, parseCoordinateQuery } from '../lib/mapRouting.js';
import { bufferPolylineToPolygon } from '../lib/routeCorridorGeofence.js';
import { applyTelemetryToTrip } from '../lib/trackingTelemetry.js';
import { getTripTrailLastKm } from '../lib/tripPositionTrail.js';
import { sendDeviationAlertEmail } from '../lib/trackingEmailAlerts.js';
import { getTrackingPollStatus, runTrackingProviderPoll } from '../lib/trackingProviderPoll.js';
import { testFleetcamConnection, listFleetcamDevices } from '../lib/fleetcamConnector.js';
import {
  buildLogisticsActivityBoard,
  scheduleTruckForRoute,
  moveTripActivityStage,
} from '../lib/logisticsActivityBoard.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('tracking_integration'));

/** Hint shown when SQL tables are missing (run migrations from project root). */
export const TRACKING_MIGRATION_HINT =
  'From the project root run: npm run db:tracking-setup   (then restart the API). Optional: assign page role "Tracking & integration" in User management.';

router.use(async (req, res, next) => {
  try {
    const r = await query(
      `SELECT CASE WHEN OBJECT_ID(N'tracking_weighbridge', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_vehicle_link', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_tenant_settings', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_delivery_record', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_alarm_record', N'U') IS NOT NULL
        AND OBJECT_ID(N'fleet_trip', N'U') IS NOT NULL
        AND OBJECT_ID(N'fleet_trip_deviation', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_integration_provider', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_monitor_route', N'U') IS NOT NULL
        AND OBJECT_ID(N'tracking_geofence', N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS ok`,
      {}
    );
    req.trackingSchemaReady = !!get(r.recordset?.[0], 'ok');
  } catch {
    req.trackingSchemaReady = false;
  }
  next();
});

/** @returns {boolean} false = response already sent (missing schema). */
function ensureSchema(req, res, emptyPayload) {
  if (req.trackingSchemaReady) return true;
  if (req.method === 'GET') {
    res.json({ ...emptyPayload, migration_required: true, migration_hint: TRACKING_MIGRATION_HINT });
    return false;
  }
  res.status(503).json({
    error: 'Tracking database tables are not installed.',
    migration_required: true,
    migration_hint: TRACKING_MIGRATION_HINT,
  });
  return false;
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

function mask(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  if (t.length <= 4) return '••••';
  return `••••••••${t.slice(-4)}`;
}

const tenantId = (req) => req.user?.tenant_id;

// ---- Contractor fleet (for linking — uses contractor tables only) ----
router.get('/contractor-trucks', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT t.id, t.registration, t.fleet_no, t.make_model, c.name AS contractor_name
       FROM contractor_trucks t
       LEFT JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = t.tenant_id
       WHERE t.tenant_id = @tenantId
       ORDER BY c.name, t.registration`,
      { tenantId: tid }
    );
    const trucks = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      registration: get(row, 'registration'),
      fleet_no: get(row, 'fleet_no'),
      make_model: get(row, 'make_model'),
      contractor_name: get(row, 'contractor_name'),
    }));
    res.json({ trucks });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list contractor trucks' });
  }
});

router.get('/contractor-drivers', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const truckReg = String(req.query.truck_registration || '').trim();
    const r = await query(
      `SELECT d.id, d.full_name, d.name, d.surname, d.phone, d.license_number,
              t.registration AS linked_truck_registration, t.id AS linked_truck_id,
              c.name AS contractor_name
       FROM contractor_drivers d
       LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
       LEFT JOIN contractors c ON c.id = d.contractor_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId
       ORDER BY
         CASE WHEN @reg <> N'' AND UPPER(REPLACE(t.registration, N' ', N'')) = UPPER(REPLACE(@reg, N' ', N'')) THEN 0 ELSE 1 END,
         d.full_name, d.name, d.surname`,
      { tenantId: tid, reg: truckReg }
    );
    const drivers = (r.recordset || []).map((row) => {
      const fullName = String(get(row, 'full_name') || '').trim()
        || [get(row, 'name'), get(row, 'surname')].filter(Boolean).join(' ').trim();
      const linkedReg = String(get(row, 'linked_truck_registration') || '').trim();
      const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
      return {
        id: gid(get(row, 'id')),
        full_name: fullName || null,
        phone: get(row, 'phone') || null,
        license_number: get(row, 'license_number') || null,
        linked_truck_id: gid(get(row, 'linked_truck_id')),
        linked_truck_registration: linkedReg || null,
        contractor_name: get(row, 'contractor_name') || null,
        linked_to_truck: !!(truckReg && linkedReg && norm(linkedReg) === norm(truckReg)),
      };
    });
    res.json({ drivers });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list contractor drivers' });
  }
});

// ---- Providers ----
router.get('/providers', async (req, res) => {
  if (!ensureSchema(req, res, { providers: [] })) return;
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT id, tenant_id, display_name, provider_type, api_base_url, api_key, api_secret, username, extra_json, is_active, created_at, updated_at
       FROM tracking_integration_provider WHERE tenant_id = @tenantId ORDER BY display_name`,
      { tenantId: tid }
    );
    const providers = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      display_name: get(row, 'display_name'),
      provider_type: get(row, 'provider_type'),
      api_base_url: get(row, 'api_base_url'),
      api_key_masked: mask(get(row, 'api_key')),
      api_key_set: !!(get(row, 'api_key') && String(get(row, 'api_key')).length),
      api_secret_masked: mask(get(row, 'api_secret')),
      api_secret_set: !!(get(row, 'api_secret') && String(get(row, 'api_secret')).length),
      username: get(row, 'username'),
      extra_json: get(row, 'extra_json'),
      is_active: !!get(row, 'is_active'),
      created_at: get(row, 'created_at'),
      updated_at: get(row, 'updated_at'),
    }));
    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list providers' });
  }
});

router.post('/providers', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const { display_name, provider_type, api_base_url, api_key, api_secret, username, extra_json, is_active } = req.body || {};
    if (!display_name || !provider_type) return res.status(400).json({ error: 'display_name and provider_type required' });
    const ins = await query(
      `INSERT INTO tracking_integration_provider (tenant_id, display_name, provider_type, api_base_url, api_key, api_secret, username, extra_json, is_active)
       OUTPUT INSERTED.id
       VALUES (@tenantId, @dn, @pt, @url, @ak, @as, @un, @ej, @ia)`,
      {
        tenantId: tid,
        dn: display_name,
        pt: provider_type,
        url: api_base_url || null,
        ak: api_key || null,
        as: api_secret || null,
        un: username || null,
        ej: extra_json || null,
        ia: is_active !== false ? 1 : 0,
      }
    );
    const id = gid(ins.recordset?.[0]?.id);
    res.status(201).json({ id, ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create provider' });
  }
});

router.patch('/providers/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const id = req.params.id;
    const { display_name, provider_type, api_base_url, api_key, api_secret, username, extra_json, is_active } = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id };
    if (display_name !== undefined) { updates.push('display_name = @dn'); params.dn = display_name; }
    if (provider_type !== undefined) { updates.push('provider_type = @pt'); params.pt = provider_type; }
    if (api_base_url !== undefined) { updates.push('api_base_url = @url'); params.url = api_base_url; }
    if (api_key !== undefined && api_key !== '') { updates.push('api_key = @ak'); params.ak = api_key; }
    if (api_secret !== undefined && api_secret !== '') { updates.push('api_secret = @as'); params.as = api_secret; }
    if (username !== undefined) { updates.push('username = @un'); params.un = username; }
    if (extra_json !== undefined) { updates.push('extra_json = @ej'); params.ej = extra_json; }
    if (is_active !== undefined) { updates.push('is_active = @ia'); params.ia = is_active ? 1 : 0; }
    updates.push('updated_at = SYSUTCDATETIME()');
    if (updates.length === 1) return res.status(400).json({ error: 'No fields to update' });
    await query(
      `UPDATE tracking_integration_provider SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update provider' });
  }
});

router.delete('/providers/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    await query(`DELETE FROM tracking_integration_provider WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
});

router.post('/providers/:id/fleetcam/test', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT id, display_name, provider_type, api_base_url, api_key, api_secret, username, extra_json
       FROM tracking_integration_provider WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Provider not found' });
    if (String(get(row, 'provider_type') || '').toLowerCase() !== 'fleetcam') {
      return res.status(400).json({ error: 'Provider is not FleetCam type' });
    }
    const provider = {
      id: gid(get(row, 'id')),
      api_base_url: get(row, 'api_base_url'),
      api_key: get(row, 'api_key'),
      api_secret: get(row, 'api_secret'),
      username: get(row, 'username'),
      extra_json: get(row, 'extra_json'),
    };
    const result = await testFleetcamConnection(provider);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Connection test failed' });
  }
});

router.get('/providers/:id/fleetcam/devices', async (req, res) => {
  if (!ensureSchema(req, res, { devices: [] })) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT id, provider_type, api_base_url, api_key, api_secret, username, extra_json
       FROM tracking_integration_provider WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Provider not found' });
    if (String(get(row, 'provider_type') || '').toLowerCase() !== 'fleetcam') {
      return res.status(400).json({ error: 'Provider is not FleetCam type' });
    }
    const provider = {
      id: gid(get(row, 'id')),
      api_base_url: get(row, 'api_base_url'),
      api_key: get(row, 'api_key'),
      api_secret: get(row, 'api_secret'),
      username: get(row, 'username'),
      extra_json: get(row, 'extra_json'),
    };
    const result = await listFleetcamDevices(provider);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list FleetCam devices' });
  }
});

router.post('/providers/:id/fleetcam/auto-link', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const providerId = req.params.id;
    const prow = await query(
      `SELECT id, provider_type, api_base_url, api_key, api_secret, username, extra_json
       FROM tracking_integration_provider WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: providerId }
    );
    const row = prow.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Provider not found' });
    if (String(get(row, 'provider_type') || '').toLowerCase() !== 'fleetcam') {
      return res.status(400).json({ error: 'Provider is not FleetCam type' });
    }
    const provider = {
      id: gid(get(row, 'id')),
      api_base_url: get(row, 'api_base_url'),
      api_key: get(row, 'api_key'),
      api_secret: get(row, 'api_secret'),
      username: get(row, 'username'),
      extra_json: get(row, 'extra_json'),
    };
    const { devices } = await listFleetcamDevices(provider);
    const trucksR = await query(
      `SELECT id, registration FROM contractor_trucks WHERE tenant_id = @tenantId AND registration IS NOT NULL`,
      { tenantId: tid }
    );
    const regToTruck = new Map();
    for (const t of trucksR.recordset || []) {
      const reg = String(get(t, 'registration') || '').trim().toUpperCase().replace(/\s+/g, '');
      if (reg) regToTruck.set(reg, gid(get(t, 'id')));
    }
    let linked = 0;
    let skipped = 0;
    for (const d of devices || []) {
      const reg = String(d.registration || d.plate_number || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!reg) { skipped++; continue; }
      const ctid = regToTruck.get(reg);
      if (!ctid) { skipped++; continue; }
      const exists = await query(
        `SELECT id FROM tracking_vehicle_link WHERE tenant_id = @tenantId AND truck_registration = @reg`,
        { tenantId: tid, reg: String(d.plate_number || d.registration || reg).trim() }
      );
      if (exists.recordset?.[0]) { skipped++; continue; }
      await query(
        `INSERT INTO tracking_vehicle_link (tenant_id, provider_id, truck_registration, external_vehicle_id, contractor_truck_id)
         VALUES (@tenantId, @pid, @reg, @ev, @ctid)`,
        {
          tenantId: tid,
          pid: providerId,
          reg: String(d.plate_number || reg).trim(),
          ev: String(d.id),
          ctid,
        }
      );
      linked++;
    }
    res.json({ ok: true, linked, skipped, fleetcam_devices: devices?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Auto-link failed' });
  }
});

// ---- Vehicle links ----
router.get('/vehicles', async (req, res) => {
  if (!ensureSchema(req, res, { vehicles: [] })) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT v.id, v.tenant_id, v.provider_id, v.truck_registration, v.external_vehicle_id, v.fleet_no, v.notes, v.created_at,
              v.contractor_truck_id,
              p.display_name AS provider_name,
              c.name AS contractor_company_name
       FROM tracking_vehicle_link v
       INNER JOIN tracking_integration_provider p ON p.id = v.provider_id
       LEFT JOIN contractor_trucks ct ON ct.id = v.contractor_truck_id AND ct.tenant_id = v.tenant_id
       LEFT JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = v.tenant_id
       WHERE v.tenant_id = @tenantId ORDER BY v.truck_registration`,
      { tenantId: tid }
    );
    const vehicles = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      provider_id: gid(get(row, 'provider_id')),
      provider_name: get(row, 'provider_name'),
      truck_registration: get(row, 'truck_registration'),
      external_vehicle_id: get(row, 'external_vehicle_id'),
      fleet_no: get(row, 'fleet_no'),
      contractor_truck_id: gid(get(row, 'contractor_truck_id')),
      contractor_company_name: get(row, 'contractor_company_name'),
      notes: get(row, 'notes'),
      created_at: get(row, 'created_at'),
    }));
    res.json({ vehicles });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list vehicles' });
  }
});

router.post('/vehicles', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const { provider_id, truck_registration, external_vehicle_id, fleet_no, notes, contractor_truck_id } = req.body || {};
    if (!provider_id) return res.status(400).json({ error: 'provider_id required' });
    let reg = truck_registration != null ? String(truck_registration).trim() : '';
    let fn = fleet_no || null;
    if (contractor_truck_id) {
      const tr = await query(
        `SELECT registration, fleet_no FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
        { id: contractor_truck_id, tenantId: tid }
      );
      const row = tr.recordset?.[0];
      if (!row) return res.status(400).json({ error: 'Contractor truck not found for this tenant' });
      reg = String(get(row, 'registration') || '').trim();
      fn = fn || get(row, 'fleet_no') || null;
    }
    if (!reg) return res.status(400).json({ error: 'Enter registration or select a contractor fleet truck' });
    const ctid = contractor_truck_id && String(contractor_truck_id).trim() ? String(contractor_truck_id).trim() : null;
    const ins = await query(
      `INSERT INTO tracking_vehicle_link (tenant_id, provider_id, truck_registration, external_vehicle_id, fleet_no, notes, contractor_truck_id)
       OUTPUT INSERTED.id VALUES (@tenantId, @pid, @reg, @ev, @fn, @n, @ctid)`,
      { tenantId: tid, pid: provider_id, reg, ev: external_vehicle_id || null, fn, n: notes || null, ctid: ctid || null }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create vehicle link' });
  }
});

router.patch('/vehicles/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const { truck_registration, external_vehicle_id, fleet_no, notes } = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id: req.params.id };
    if (truck_registration !== undefined) { updates.push('truck_registration = @reg'); params.reg = truck_registration; }
    if (external_vehicle_id !== undefined) { updates.push('external_vehicle_id = @ev'); params.ev = external_vehicle_id; }
    if (fleet_no !== undefined) { updates.push('fleet_no = @fn'); params.fn = fleet_no; }
    if (notes !== undefined) { updates.push('notes = @n'); params.n = notes; }
    if (!updates.length) return res.status(400).json({ error: 'No fields' });
    await query(`UPDATE tracking_vehicle_link SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update' });
  }
});

router.delete('/vehicles/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    await query(`DELETE FROM tracking_vehicle_link WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tenantId(req), id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
});

// ---- Weighbridges ----
router.get('/weighbridges', async (req, res) => {
  if (!ensureSchema(req, res, { weighbridges: [] })) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT id, tenant_id, colliery_name, site_code, api_endpoint, api_key, auth_type, extra_json, is_active, created_at, updated_at
       FROM tracking_weighbridge WHERE tenant_id = @tenantId ORDER BY colliery_name`,
      { tenantId: tid }
    );
    const weighbridges = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      colliery_name: get(row, 'colliery_name'),
      site_code: get(row, 'site_code'),
      api_endpoint: get(row, 'api_endpoint'),
      api_key_masked: mask(get(row, 'api_key')),
      api_key_set: !!(get(row, 'api_key') && String(get(row, 'api_key')).length),
      auth_type: get(row, 'auth_type'),
      extra_json: get(row, 'extra_json'),
      is_active: !!get(row, 'is_active'),
      created_at: get(row, 'created_at'),
      updated_at: get(row, 'updated_at'),
    }));
    res.json({ weighbridges });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list weighbridges' });
  }
});

router.post('/weighbridges', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const { colliery_name, site_code, api_endpoint, api_key, auth_type, extra_json, is_active } = req.body || {};
    if (!colliery_name || !api_endpoint) return res.status(400).json({ error: 'colliery_name and api_endpoint required' });
    const ins = await query(
      `INSERT INTO tracking_weighbridge (tenant_id, colliery_name, site_code, api_endpoint, api_key, auth_type, extra_json, is_active)
       OUTPUT INSERTED.id VALUES (@tenantId, @cn, @sc, @ep, @ak, @at, @ej, @ia)`,
      {
        tenantId: tid,
        cn: colliery_name,
        sc: site_code || null,
        ep: api_endpoint,
        ak: api_key || null,
        at: auth_type || 'api_key',
        ej: extra_json || null,
        ia: is_active !== false ? 1 : 0,
      }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create weighbridge' });
  }
});

router.patch('/weighbridges/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const { colliery_name, site_code, api_endpoint, api_key, auth_type, extra_json, is_active } = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id: req.params.id };
    if (colliery_name !== undefined) { updates.push('colliery_name = @cn'); params.cn = colliery_name; }
    if (site_code !== undefined) { updates.push('site_code = @sc'); params.sc = site_code; }
    if (api_endpoint !== undefined) { updates.push('api_endpoint = @ep'); params.ep = api_endpoint; }
    if (api_key !== undefined && api_key !== '') { updates.push('api_key = @ak'); params.ak = api_key; }
    if (auth_type !== undefined) { updates.push('auth_type = @at'); params.at = auth_type; }
    if (extra_json !== undefined) { updates.push('extra_json = @ej'); params.ej = extra_json; }
    if (is_active !== undefined) { updates.push('is_active = @ia'); params.ia = is_active ? 1 : 0; }
    updates.push('updated_at = SYSUTCDATETIME()');
    if (updates.length === 1) return res.status(400).json({ error: 'No fields' });
    await query(`UPDATE tracking_weighbridge SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update' });
  }
});

router.delete('/weighbridges/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    await query(`DELETE FROM tracking_weighbridge WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tenantId(req), id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
});

// ---- Monitor routes ----
router.get('/routes', async (req, res) => {
  if (!ensureSchema(req, res, { routes: [] })) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT id, tenant_id, name, collection_point_name, destination_name, origin_lat, origin_lng, dest_lat, dest_lng, waypoints_json, contractor_route_id, is_active, created_at
       FROM tracking_monitor_route WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId: tid }
    );
    const routes = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      contractor_route_id: gid(get(row, 'contractor_route_id')),
      name: get(row, 'name'),
      collection_point_name: get(row, 'collection_point_name'),
      destination_name: get(row, 'destination_name'),
      origin_lat: get(row, 'origin_lat') != null ? Number(get(row, 'origin_lat')) : null,
      origin_lng: get(row, 'origin_lng') != null ? Number(get(row, 'origin_lng')) : null,
      dest_lat: get(row, 'dest_lat') != null ? Number(get(row, 'dest_lat')) : null,
      dest_lng: get(row, 'dest_lng') != null ? Number(get(row, 'dest_lng')) : null,
      waypoints_json: get(row, 'waypoints_json'),
      is_active: !!get(row, 'is_active'),
      created_at: get(row, 'created_at'),
    }));
    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list routes' });
  }
});

router.post('/routes', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const ins = await query(
      `INSERT INTO tracking_monitor_route (tenant_id, name, collection_point_name, destination_name, origin_lat, origin_lng, dest_lat, dest_lng, waypoints_json, is_active)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, @cp, @dn, @olat, @olng, @dlat, @dlng, @wj, @ia)`,
      {
        tenantId: tid,
        n: b.name,
        cp: b.collection_point_name || null,
        dn: b.destination_name || null,
        olat: b.origin_lat ?? null,
        olng: b.origin_lng ?? null,
        dlat: b.dest_lat ?? null,
        dlng: b.dest_lng ?? null,
        wj: b.waypoints_json || null,
        ia: b.is_active !== false ? 1 : 0,
      }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create route' });
  }
});

router.patch('/routes/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id: req.params.id };
    const map = [
      ['name', 'name', 'n'],
      ['collection_point_name', 'collection_point_name', 'cp'],
      ['destination_name', 'destination_name', 'dn'],
      ['origin_lat', 'origin_lat', 'olat'],
      ['origin_lng', 'origin_lng', 'olng'],
      ['dest_lat', 'dest_lat', 'dlat'],
      ['dest_lng', 'dest_lng', 'dlng'],
      ['waypoints_json', 'waypoints_json', 'wj'],
    ];
    for (const [k, col, p] of map) {
      if (b[k] !== undefined) {
        updates.push(`${col} = @${p}`);
        params[p] = b[k];
      }
    }
    if (b.is_active !== undefined) { updates.push('is_active = @ia'); params.ia = b.is_active ? 1 : 0; }
    if (!updates.length) return res.status(400).json({ error: 'No fields' });
    await query(`UPDATE tracking_monitor_route SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update' });
  }
});

router.delete('/routes/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    await query(`DELETE FROM tracking_monitor_route WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tenantId(req), id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
});

// ---- Geofences ----
router.get('/geofences', async (req, res) => {
  if (!ensureSchema(req, res, { geofences: [] })) return;
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT g.id, g.tenant_id, g.name, g.fence_type, g.center_lat, g.center_lng, g.radius_m, g.polygon_json,
              g.alert_on_exit, g.alert_on_entry, g.created_at, g.contractor_route_id, g.leg,
              cr.name AS contractor_route_name, cr.loading_address, cr.destination_address
       FROM tracking_geofence g
       LEFT JOIN contractor_routes cr ON cr.id = g.contractor_route_id AND cr.tenant_id = g.tenant_id
       WHERE g.tenant_id = @tenantId ORDER BY g.name`,
      { tenantId: tid }
    );
    const geofences = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      name: get(row, 'name'),
      fence_type: get(row, 'fence_type'),
      center_lat: get(row, 'center_lat') != null ? Number(get(row, 'center_lat')) : null,
      center_lng: get(row, 'center_lng') != null ? Number(get(row, 'center_lng')) : null,
      radius_m: get(row, 'radius_m'),
      polygon_json: get(row, 'polygon_json'),
      alert_on_exit: !!get(row, 'alert_on_exit'),
      alert_on_entry: !!get(row, 'alert_on_entry'),
      contractor_route_id: gid(get(row, 'contractor_route_id')),
      leg: get(row, 'leg'),
      contractor_route_name: get(row, 'contractor_route_name'),
      loading_address: get(row, 'loading_address'),
      destination_address: get(row, 'destination_address'),
      created_at: get(row, 'created_at'),
    }));
    res.json({ geofences });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list geofences' });
  }
});

router.post('/geofences', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    if (!b.name || !b.fence_type) return res.status(400).json({ error: 'name and fence_type required' });
    const ins = await query(
      `INSERT INTO tracking_geofence (tenant_id, name, fence_type, center_lat, center_lng, radius_m, polygon_json, alert_on_exit, alert_on_entry, contractor_route_id, leg)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, @ft, @clat, @clng, @rm, @pj, @ae, @ai, @crid, @leg)`,
      {
        tenantId: tid,
        n: b.name,
        ft: b.fence_type || 'destination',
        clat: b.center_lat ?? null,
        clng: b.center_lng ?? null,
        rm: b.radius_m ?? 500,
        pj: b.polygon_json || null,
        ae: b.alert_on_exit !== false ? 1 : 0,
        ai: b.alert_on_entry ? 1 : 0,
        crid: b.contractor_route_id || null,
        leg: b.leg || null,
      }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create geofence' });
  }
});

router.patch('/geofences/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id: req.params.id };
    const map = [
      ['name', 'name', 'n'],
      ['fence_type', 'fence_type', 'ft'],
      ['center_lat', 'center_lat', 'clat'],
      ['center_lng', 'center_lng', 'clng'],
      ['radius_m', 'radius_m', 'rm'],
      ['polygon_json', 'polygon_json', 'pj'],
      ['contractor_route_id', 'contractor_route_id', 'crid'],
      ['leg', 'leg', 'leg'],
    ];
    for (const [k, col, p] of map) {
      if (b[k] !== undefined) {
        updates.push(`${col} = @${p}`);
        params[p] = b[k];
      }
    }
    if (b.alert_on_exit !== undefined) { updates.push('alert_on_exit = @ae'); params.ae = b.alert_on_exit ? 1 : 0; }
    if (b.alert_on_entry !== undefined) { updates.push('alert_on_entry = @ai'); params.ai = b.alert_on_entry ? 1 : 0; }
    if (!updates.length) return res.status(400).json({ error: 'No fields' });
    await query(`UPDATE tracking_geofence SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update geofence' });
  }
});

router.delete('/geofences/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    await query(`DELETE FROM tracking_geofence WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tenantId(req), id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
});

// ---- Tenant settings ----
router.get('/settings', async (req, res) => {
  if (!ensureSchema(req, res, { settings: mapSettings(null) })) return;
  try {
    const tid = tenantId(req);
    const r = await query(`SELECT * FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId: tid });
    const row = r.recordset?.[0];
    if (!row) {
      await query(
        `INSERT INTO tracking_tenant_settings (tenant_id) VALUES (@tenantId)`,
        { tenantId: tid }
      );
      const r2 = await query(`SELECT * FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId: tid });
      return res.json({ settings: mapSettings(r2.recordset?.[0]) });
    }
    res.json({ settings: mapSettings(row) });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load settings' });
  }
});

function mapSettings(row) {
  if (!row) return {};
  return {
    max_enroute_minutes: get(row, 'max_enroute_minutes'),
    alarm_overspeed_kmh: get(row, 'alarm_overspeed_kmh'),
    alarm_harsh_braking: !!get(row, 'alarm_harsh_braking'),
    alarm_harsh_accel: !!get(row, 'alarm_harsh_accel'),
    alarm_seatbelt: !!get(row, 'alarm_seatbelt'),
    alarm_idle_minutes: get(row, 'alarm_idle_minutes'),
    notify_email_deviation: get(row, 'notify_email_deviation') !== false && get(row, 'notify_email_deviation') !== 0,
    notify_email_overspeed: get(row, 'notify_email_overspeed') !== false && get(row, 'notify_email_overspeed') !== 0,
    notify_email_parking: get(row, 'notify_email_parking') !== false && get(row, 'notify_email_parking') !== 0,
    notify_email_loading: get(row, 'notify_email_loading') !== false && get(row, 'notify_email_loading') !== 0,
    notify_email_offloading: get(row, 'notify_email_offloading') !== false && get(row, 'notify_email_offloading') !== 0,
    updated_at: get(row, 'updated_at'),
  };
}

router.patch('/settings', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const updates = [];
    const params = { tenantId: tid };
    if (b.max_enroute_minutes != null) { updates.push('max_enroute_minutes = @mem'); params.mem = Number(b.max_enroute_minutes); }
    if (b.alarm_overspeed_kmh != null) { updates.push('alarm_overspeed_kmh = @aos'); params.aos = Number(b.alarm_overspeed_kmh); }
    if (b.alarm_harsh_braking !== undefined) { updates.push('alarm_harsh_braking = @ahb'); params.ahb = b.alarm_harsh_braking ? 1 : 0; }
    if (b.alarm_harsh_accel !== undefined) { updates.push('alarm_harsh_accel = @aha'); params.aha = b.alarm_harsh_accel ? 1 : 0; }
    if (b.alarm_seatbelt !== undefined) { updates.push('alarm_seatbelt = @asb'); params.asb = b.alarm_seatbelt ? 1 : 0; }
    if (b.alarm_idle_minutes != null) { updates.push('alarm_idle_minutes = @aim'); params.aim = Number(b.alarm_idle_minutes); }
    if (b.notify_email_deviation !== undefined) { updates.push('notify_email_deviation = @ned'); params.ned = b.notify_email_deviation ? 1 : 0; }
    if (b.notify_email_overspeed !== undefined) { updates.push('notify_email_overspeed = @neo'); params.neo = b.notify_email_overspeed ? 1 : 0; }
    if (b.notify_email_parking !== undefined) { updates.push('notify_email_parking = @nep'); params.nep = b.notify_email_parking ? 1 : 0; }
    if (b.notify_email_loading !== undefined) { updates.push('notify_email_loading = @nel'); params.nel = b.notify_email_loading ? 1 : 0; }
    if (b.notify_email_offloading !== undefined) { updates.push('notify_email_offloading = @nef'); params.nef = b.notify_email_offloading ? 1 : 0; }
    updates.push('updated_at = SYSUTCDATETIME()');
    if (updates.length === 1) return res.status(400).json({ error: 'No fields' });
    await query(
      `IF NOT EXISTS (SELECT 1 FROM tracking_tenant_settings WHERE tenant_id = @tenantId) INSERT INTO tracking_tenant_settings (tenant_id) VALUES (@tenantId)`,
      params
    );
    await query(`UPDATE tracking_tenant_settings SET ${updates.join(', ')} WHERE tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to save settings' });
  }
});

// ---- Trips ----
async function refreshOverdue(tenant) {
  await query(
    `UPDATE fleet_trip SET status = N'overdue', is_overdue = 1, updated_at = SYSUTCDATETIME()
     WHERE tenant_id = @tenantId AND status = N'enroute' AND eta_due_at IS NOT NULL AND eta_due_at < SYSUTCDATETIME() AND is_overdue = 0`,
    { tenantId: tenant }
  );
}

router.get('/trips', async (req, res) => {
  if (!ensureSchema(req, res, { trips: [] })) return;
  try {
    const tid = tenantId(req);
    await refreshOverdue(tid);
    const status = req.query.status;
    let sql = `SELECT t.*, c.name AS contractor_company_name
       FROM fleet_trip t
       LEFT JOIN contractor_trucks ct ON ct.id = t.contractor_truck_id AND ct.tenant_id = t.tenant_id
       LEFT JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = t.tenant_id
       WHERE t.tenant_id = @tenantId`;
    const params = { tenantId: tid };
    if (status && status !== 'all') {
      sql += ` AND t.status = @st`;
      params.st = status;
    }
    sql += ` ORDER BY t.updated_at DESC`;
    const r = await query(sql, params);
    const trips = (r.recordset || []).map(mapTrip);
    res.json({ trips });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list trips' });
  }
});

function mapTrip(row) {
  return {
    id: gid(get(row, 'id')),
    trip_ref: get(row, 'trip_ref'),
    truck_registration: get(row, 'truck_registration'),
    contractor_truck_id: gid(get(row, 'contractor_truck_id')),
    contractor_company_name: get(row, 'contractor_company_name'),
    weighbridge_id: gid(get(row, 'weighbridge_id')),
    route_id: gid(get(row, 'route_id')),
    contractor_route_id: gid(get(row, 'contractor_route_id')),
    driver_name: get(row, 'driver_name'),
    collection_point_name: get(row, 'collection_point_name'),
    destination_name: get(row, 'destination_name'),
    status: get(row, 'status'),
    declared_destination_at: get(row, 'declared_destination_at'),
    started_at: get(row, 'started_at'),
    completed_at: get(row, 'completed_at'),
    eta_due_at: get(row, 'eta_due_at'),
    deviation_count: get(row, 'deviation_count'),
    is_overdue: !!get(row, 'is_overdue'),
    trip_leg_index: get(row, 'trip_leg_index'),
    last_lat: get(row, 'last_lat') != null ? Number(get(row, 'last_lat')) : null,
    last_lng: get(row, 'last_lng') != null ? Number(get(row, 'last_lng')) : null,
    last_speed_kmh: get(row, 'last_speed_kmh') != null ? Number(get(row, 'last_speed_kmh')) : null,
    last_seen_at: get(row, 'last_seen_at'),
    gross_weight_kg: get(row, 'gross_weight_kg') != null ? Number(get(row, 'gross_weight_kg')) : null,
    notes: get(row, 'notes'),
    activity_stage: get(row, 'activity_stage'),
    scheduled_at: get(row, 'scheduled_at'),
    at_loading_at: get(row, 'at_loading_at'),
    at_destination_at: get(row, 'at_destination_at'),
    loading_slip_no: get(row, 'loading_slip_no'),
    loading_slip_deferred: !!get(row, 'loading_slip_deferred'),
    offloading_slip_no: get(row, 'offloading_slip_no'),
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

router.post('/trips', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    let reg = b.truck_registration != null ? String(b.truck_registration).trim() : '';
    let ctid = b.contractor_truck_id && String(b.contractor_truck_id).trim() ? String(b.contractor_truck_id).trim() : null;
    if (!reg && ctid) {
      const tr = await query(
        `SELECT registration FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
        { id: ctid, tenantId: tid }
      );
      reg = String(get(tr.recordset?.[0], 'registration') || '').trim();
    }
    if (!reg) return res.status(400).json({ error: 'Enter truck registration or select a vehicle from Contractor fleet' });
    const ref = b.trip_ref || `TRIP-${todayYmd().replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const ins = await query(
      `INSERT INTO fleet_trip (tenant_id, trip_ref, truck_registration, contractor_truck_id, weighbridge_id, route_id, collection_point_name, destination_name, status)
       OUTPUT INSERTED.id VALUES (@tenantId, @ref, @reg, @ctid, @wb, @rid, @cp, @dn, N'pending')`,
      {
        tenantId: tid,
        ref,
        reg,
        ctid: ctid || null,
        wb: b.weighbridge_id || null,
        rid: b.route_id || null,
        cp: b.collection_point_name || null,
        dn: b.destination_name || null,
      }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), trip_ref: ref, ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create trip' });
  }
});

router.patch('/trips/:id', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const updates = [];
    const params = { tenantId: tid, id: req.params.id };
    const fields = [
      ['contractor_truck_id', 'contractor_truck_id', 'ctid'],
      ['weighbridge_id', 'weighbridge_id', 'wb'],
      ['route_id', 'route_id', 'rid'],
      ['collection_point_name', 'collection_point_name', 'cp'],
      ['destination_name', 'destination_name', 'dn'],
      ['notes', 'notes', 'n'],
      ['gross_weight_kg', 'gross_weight_kg', 'gw'],
    ];
    for (const [k, col, p] of fields) {
      if (b[k] !== undefined) {
        updates.push(`${col} = @${p}`);
        params[p] = b[k];
      }
    }
    updates.push('updated_at = SYSUTCDATETIME()');
    if (updates.length === 1) return res.status(400).json({ error: 'No fields' });
    await query(`UPDATE fleet_trip SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update trip' });
  }
});

/** Start tracking & ETA when weighbridge + route + destination are set and destination is declared. */
router.post('/trips/:id/activate-delivery', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const tripId = req.params.id;
    const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: tripId });
    const trip = tr.recordset?.[0];
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    const wb = get(trip, 'weighbridge_id');
    const rid = get(trip, 'route_id');
    const dest = get(trip, 'destination_name');
    if (!wb || !rid || !dest) {
      return res.status(400).json({
        error: 'Set weighbridge, monitor route, and destination before activating delivery.',
      });
    }
    const st = await query(`SELECT max_enroute_minutes FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId: tid });
    let maxM = st.recordset?.[0] ? get(st.recordset[0], 'max_enroute_minutes') : 240;
    if (maxM == null || maxM < 1) maxM = 240;
    await query(
      `UPDATE fleet_trip SET
        declared_destination_at = SYSUTCDATETIME(),
        started_at = COALESCE(started_at, SYSUTCDATETIME()),
        eta_due_at = DATEADD(minute, @maxM, COALESCE(started_at, SYSUTCDATETIME())),
        status = N'enroute',
        trip_leg_index = trip_leg_index + 1,
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: tripId, maxM }
    );
    res.json({ ok: true, message: 'Delivery activated; trip is en route. ETA set from tenant max en-route time.' });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to activate' });
  }
});

router.post('/trips/:id/telemetry', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const { lat, lng, speed_kmh, heading_deg } = req.body || {};
    await applyTelemetryToTrip(query, tid, req.params.id, { lat, lng, speed_kmh, heading_deg });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to record telemetry' });
  }
});

router.get('/trips/:id/trail', async (req, res) => {
  if (!ensureSchema(req, res, { trail: { points: [], distance_km: 0 } })) return;
  try {
    const tid = tenantId(req);
    const km = req.query.km != null ? Number(req.query.km) : 2;
    const tripR = await query(
      `SELECT id FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id }
    );
    if (!tripR.recordset?.[0]) return res.status(404).json({ error: 'Trip not found' });
    const trail = await getTripTrailLastKm(query, tid, req.params.id, km);
    res.json({ trail });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load trail' });
  }
});

/** Background poll status (live telematics ingestion). */
router.get('/poll/status', async (req, res) => {
  res.json(getTrackingPollStatus());
});

/** Manual poll trigger (same job as server background interval). */
router.post('/poll/run', async (req, res) => {
  if (!ensureSchema(req, res, { ok: false })) return;
  try {
    const stats = await runTrackingProviderPoll();
    res.json({ ok: true, ...stats, status: getTrackingPollStatus() });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Poll failed' });
  }
});

router.post('/trips/:id/complete', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    await query(
      `UPDATE fleet_trip SET status = N'completed', completed_at = SYSUTCDATETIME(), is_overdue = 0, updated_at = SYSUTCDATETIME(), notes = COALESCE(@notes, notes)
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id, notes: b.notes || null }
    );
    const tripR = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: req.params.id });
    const t = tripR.recordset?.[0];
    if (t) {
      await query(
        `INSERT INTO tracking_delivery_record (tenant_id, trip_id, truck_registration, delivered_at, net_weight_kg, destination_name, status, notes)
         VALUES (@tenantId, @tid, @reg, SYSUTCDATETIME(), @nw, @dn, N'completed', @n)`,
        {
          tenantId: tid,
          tid: req.params.id,
          reg: get(t, 'truck_registration'),
          nw: b.net_weight_kg ?? null,
          dn: get(t, 'destination_name'),
          n: b.notes || null,
        }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to complete trip' });
  }
});

router.post('/trips/:id/deviation', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    await query(
      `INSERT INTO fleet_trip_deviation (tenant_id, trip_id, occurred_at, deviation_type, lat, lng, detail) VALUES (@tenantId, @tid, SYSUTCDATETIME(), @dt, @lat, @lng, @det)`,
      { tenantId: tid, tid: req.params.id, dt: b.deviation_type || 'route', lat: b.lat ?? null, lng: b.lng ?? null, det: b.detail || null }
    );
    await query(
      `UPDATE fleet_trip SET deviation_count = deviation_count + 1, status = CASE WHEN status = N'enroute' THEN N'deviated' ELSE status END, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id }
    );
    const tr2 = await query(`SELECT truck_registration FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: req.params.id });
    const trReg = get(tr2.recordset?.[0], 'truck_registration');
    await query(
      `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, detail)
       VALUES (@tenantId, @tripId, @reg, N'deviation', N'warning', SYSUTCDATETIME(), @lat, @lng, @det)`,
      { tenantId: tid, tripId: req.params.id, reg: trReg, lat: b.lat ?? null, lng: b.lng ?? null, det: b.detail || 'Route deviation' }
    );
    if (trReg) {
      await sendDeviationAlertEmail({
        query,
        tenantId: tid,
        truckRegistration: trReg,
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        detail: b.detail || 'Route deviation',
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to record deviation' });
  }
});

// ---- Deliveries history ----
router.get('/deliveries', async (req, res) => {
  if (!ensureSchema(req, res, { deliveries: [] })) return;
  try {
    const tid = tenantId(req);
    const from = req.query.from;
    const to = req.query.to;
    const reg = req.query.registration;
    let sql = `SELECT d.*, t.trip_ref FROM tracking_delivery_record d LEFT JOIN fleet_trip t ON t.id = d.trip_id WHERE d.tenant_id = @tenantId`;
    const params = { tenantId: tid };
    if (from) {
      sql += ` AND d.delivered_at >= @from`;
      params.from = from;
    }
    if (to) {
      sql += ` AND d.delivered_at < DATEADD(day, 1, CAST(@to AS DATE))`;
      params.to = to;
    }
    if (reg) {
      sql += ` AND d.truck_registration LIKE @reg`;
      params.reg = `%${reg}%`;
    }
    sql += ` ORDER BY d.delivered_at DESC`;
    const r = await query(sql, params);
    const deliveries = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      trip_id: gid(get(row, 'trip_id')),
      trip_ref: get(row, 'trip_ref'),
      truck_registration: get(row, 'truck_registration'),
      delivered_at: get(row, 'delivered_at'),
      net_weight_kg: get(row, 'net_weight_kg') != null ? Number(get(row, 'net_weight_kg')) : null,
      tons_loaded: get(row, 'tons_loaded') != null ? Number(get(row, 'tons_loaded')) : null,
      destination_name: get(row, 'destination_name'),
      contractor_route_id: gid(get(row, 'contractor_route_id')),
      driver_name: get(row, 'driver_name'),
      delivery_note_no: get(row, 'delivery_note_no'),
      pending_note: !!get(row, 'pending_note'),
      status: get(row, 'status'),
      notes: get(row, 'notes'),
    }));
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list deliveries' });
  }
});

// ---- Alarms ----
router.get('/alarms', async (req, res) => {
  if (!ensureSchema(req, res, { alarms: [] })) return;
  try {
    const tid = tenantId(req);
    const from = req.query.from;
    const to = req.query.to;
    const type = req.query.type;
    const sev = req.query.severity;
    const reg = req.query.registration;
    const ack = req.query.acknowledged;
    let sql = `SELECT * FROM tracking_alarm_record WHERE tenant_id = @tenantId`;
    const params = { tenantId: tid };
    if (from) { sql += ` AND occurred_at >= @from`; params.from = from; }
    if (to) { sql += ` AND occurred_at < DATEADD(day, 1, CAST(@to AS DATE))`; params.to = to; }
    if (type && type !== 'all') { sql += ` AND alarm_type = @atype`; params.atype = type; }
    if (sev && sev !== 'all') { sql += ` AND severity = @sev`; params.sev = sev; }
    if (reg) { sql += ` AND truck_registration LIKE @reg`; params.reg = `%${reg}%`; }
    if (ack === 'true') sql += ` AND acknowledged = 1`;
    if (ack === 'false') sql += ` AND acknowledged = 0`;
    sql += ` ORDER BY occurred_at DESC`;
    const r = await query(sql, params);
    const alarms = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      trip_id: gid(get(row, 'trip_id')),
      truck_registration: get(row, 'truck_registration'),
      alarm_type: get(row, 'alarm_type'),
      severity: get(row, 'severity'),
      occurred_at: get(row, 'occurred_at'),
      lat: get(row, 'lat') != null ? Number(get(row, 'lat')) : null,
      lng: get(row, 'lng') != null ? Number(get(row, 'lng')) : null,
      speed_kmh: get(row, 'speed_kmh') != null ? Number(get(row, 'speed_kmh')) : null,
      detail: get(row, 'detail'),
      acknowledged: !!get(row, 'acknowledged'),
      acknowledged_at: get(row, 'acknowledged_at'),
    }));
    res.json({ alarms });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list alarms' });
  }
});

router.patch('/alarms/:id/ack', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const name = req.user?.full_name || req.user?.email || 'operator';
    await query(
      `UPDATE tracking_alarm_record SET acknowledged = 1, acknowledged_at = SYSUTCDATETIME(), acknowledged_by = @by WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id, by: name }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to acknowledge' });
  }
});

/**
 * Nudge GPS for MOCK-* trips only (demo / live simulation). Does not touch real trips.
 */
router.post('/demo/tick', async (req, res) => {
  if (!ensureSchema(req, res, { ok: false, updated: 0 })) return;
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT id, last_lat, last_lng, trip_ref FROM fleet_trip
       WHERE tenant_id = @tenantId AND status IN (N'enroute', N'deviated') AND trip_ref LIKE N'MOCK-%'`,
      { tenantId: tid }
    );
    const rows = r.recordset || [];
    const t0 = Date.now() / 9000;
    let updated = 0;
    for (const row of rows) {
      const id = gid(get(row, 'id'));
      let lat = Number(get(row, 'last_lat'));
      let lng = Number(get(row, 'last_lng'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        lat = -26.2;
        lng = 28.05;
      }
      const idStr = String(id);
      let phase = 0;
      for (let i = 0; i < idStr.length; i++) phase += idStr.charCodeAt(i);
      const rad = t0 + (phase % 100) * 0.01;
      lat += Math.sin(rad) * 0.003;
      lng += Math.cos(rad * 1.27) * 0.003;
      const spd = 52 + Math.round((Math.sin(rad * 2) + 1) * 15);
      const hdg = ((Math.atan2(Math.cos(rad * 1.3), Math.sin(rad)) * 180) / Math.PI + 360) % 360;
      await applyTelemetryToTrip(query, tid, id, { lat, lng, speed_kmh: spd, heading_deg: hdg });
      updated++;
    }
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'demo tick failed' });
  }
});

router.get('/map/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });

    const coords = parseCoordinateQuery(q);
    if (coords) {
      const hit = await reverseGeocode(coords.lat, coords.lng);
      if (hit) {
        return res.json({
          result: {
            ...hit,
            lat: coords.lat,
            lng: coords.lng,
            query: q,
            from_coordinates: true,
          },
        });
      }
      return res.json({
        result: {
          lat: coords.lat,
          lng: coords.lng,
          display_name: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
          query: q,
          from_coordinates: true,
        },
      });
    }

    const hit = await geocodeAddress(q);
    if (!hit) return res.status(404).json({ error: 'Address not found on map' });
    res.json({ result: hit });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Geocode failed' });
  }
});

router.get('/map/location-context', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    const context = await locationContextAt(lat, lng);
    if (!context) return res.status(404).json({ error: 'Location not found' });
    res.json({ context });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Location lookup failed' });
  }
});

router.get('/map/route', async (req, res) => {
  try {
    const fromLat = Number(req.query.from_lat);
    const fromLng = Number(req.query.from_lng);
    const toLat = Number(req.query.to_lat);
    const toLng = Number(req.query.to_lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
      return res.status(400).json({ error: 'from_lat, from_lng, to_lat, to_lng required' });
    }
    const route = await drivingRouteAlternatives(fromLat, fromLng, toLat, toLng);
    res.json({ route: route[0], alternatives: route });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Route lookup failed' });
  }
});

/** Geocode route addresses, snap to roads, return corridor polygon + endpoint circles. */
router.post('/geofences/draw-route', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const routeId = b.contractor_route_id;
    if (!routeId) return res.status(400).json({ error: 'contractor_route_id required' });

    const rr = await query(
      `SELECT id, name, starting_point, destination, loading_address, destination_address
       FROM contractor_routes WHERE id = @id AND tenant_id = @tenantId`,
      { id: routeId, tenantId: tid }
    );
    const route = rr.recordset?.[0];
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const originQuery = b.origin_query || get(route, 'loading_address') || get(route, 'starting_point') || '';
    const destQuery = b.destination_query || get(route, 'destination_address') || get(route, 'destination') || '';

    const originFromCoords = Number.isFinite(Number(b.origin_lat)) && Number.isFinite(Number(b.origin_lng));
    const destFromCoords = Number.isFinite(Number(b.dest_lat)) && Number.isFinite(Number(b.dest_lng));

    if (!originFromCoords && !String(originQuery).trim()) {
      return res.status(400).json({ error: 'Provide a loading address or origin latitude/longitude coordinates' });
    }
    if (!destFromCoords && !String(destQuery).trim()) {
      return res.status(400).json({ error: 'Provide a destination address or destination latitude/longitude coordinates' });
    }

    const corridorM = Math.max(100, Number(b.corridor_m) || 400);
    const endpointRadiusM = Math.max(100, Number(b.endpoint_radius_m) || 500);

    let origin;
    if (originFromCoords) {
      origin = {
        lat: Number(b.origin_lat),
        lng: Number(b.origin_lng),
        display_name: String(originQuery).trim() || `${Number(b.origin_lat)}, ${Number(b.origin_lng)}`,
      };
    } else {
      origin = await geocodeAddress(originQuery);
    }

    let dest;
    if (destFromCoords) {
      dest = {
        lat: Number(b.dest_lat),
        lng: Number(b.dest_lng),
        display_name: String(destQuery).trim() || `${Number(b.dest_lat)}, ${Number(b.dest_lng)}`,
      };
    } else {
      dest = await geocodeAddress(destQuery);
    }

    if (!origin) return res.status(404).json({ error: `Could not locate origin: ${originQuery || 'invalid coordinates'}` });
    if (!dest) return res.status(404).json({ error: `Could not locate destination: ${destQuery || 'invalid coordinates'}` });

    const alternatives = await drivingRouteAlternatives(origin.lat, origin.lng, dest.lat, dest.lng);
    const selectedIndex = Math.min(
      Math.max(0, Number(b.selected_route_index) || 0),
      alternatives.length - 1
    );
    const selected = alternatives[selectedIndex] || alternatives[0];
    const polyline = Array.isArray(b.route_polyline) && b.route_polyline.length >= 2
      ? b.route_polyline
      : (selected.polyline || []);
    const driving = {
      distance_km: selected.distance_km,
      duration_min: selected.duration_min,
      polyline,
    };

    const ring = Array.isArray(b.corridor_polygon) && b.corridor_polygon.length >= 3
      ? b.corridor_polygon
      : bufferPolylineToPolygon(polyline, corridorM);
    const corridorJson = JSON.stringify({
      type: 'corridor',
      corridor_m: corridorM,
      route_polyline: polyline,
      ring,
    });

    const routeName = get(route, 'name');
    const save = b.save === true;

    if (!save) {
      return res.json({
        preview: true,
        route_id: gid(get(route, 'id')),
        route_name: routeName,
        origin,
        destination: dest,
        driving,
        alternatives,
        selected_route_index: selectedIndex,
        corridor_m: corridorM,
        endpoint_radius_m: endpointRadiusM,
        corridor_polygon: ring,
        route_polyline: polyline,
      });
    }

    const created = [];
    const insOrigin = await query(
      `INSERT INTO tracking_geofence (tenant_id, name, fence_type, center_lat, center_lng, radius_m, alert_on_exit, alert_on_entry, contractor_route_id, leg)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, N'destination', @lat, @lng, @rm, 0, 1, @rid, N'origin')`,
      { tenantId: tid, n: `${routeName} — Origin`, lat: origin.lat, lng: origin.lng, rm: endpointRadiusM, rid: routeId }
    );
    created.push({ id: gid(insOrigin.recordset?.[0]?.id), leg: 'origin' });

    const insCorridor = await query(
      `INSERT INTO tracking_geofence (tenant_id, name, fence_type, polygon_json, alert_on_exit, alert_on_entry, contractor_route_id, leg)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, N'deviation', @pj, 1, 0, @rid, N'corridor')`,
      { tenantId: tid, n: `${routeName} — Road corridor`, pj: corridorJson, rid: routeId }
    );
    created.push({ id: gid(insCorridor.recordset?.[0]?.id), leg: 'corridor' });

    const altInputs = Array.isArray(b.alternative_corridors) ? b.alternative_corridors : [];
    for (const alt of altInputs) {
      const altIndex = Number(alt.index);
      if (!Number.isFinite(altIndex) || altIndex === selectedIndex) continue;
      const altRoute = alternatives[altIndex];
      const altPoly = Array.isArray(alt.route_polyline) && alt.route_polyline.length >= 2
        ? alt.route_polyline
        : (altRoute?.polyline || []);
      if (altPoly.length < 2) continue;
      const altRing = Array.isArray(alt.corridor_polygon) && alt.corridor_polygon.length >= 3
        ? alt.corridor_polygon
        : bufferPolylineToPolygon(altPoly, corridorM);
      const altLetter = String.fromCharCode(65 + altIndex);
      const altJson = JSON.stringify({
        type: 'corridor',
        corridor_m: corridorM,
        route_polyline: altPoly,
        ring: altRing,
        route_index: altIndex,
        is_alternative: true,
      });
      const insAlt = await query(
        `INSERT INTO tracking_geofence (tenant_id, name, fence_type, polygon_json, alert_on_exit, alert_on_entry, contractor_route_id, leg)
         OUTPUT INSERTED.id VALUES (@tenantId, @n, N'deviation', @pj, 0, 0, @rid, N'corridor_alt')`,
        { tenantId: tid, n: `${routeName} — Alt ${altLetter} corridor`, pj: altJson, rid: routeId }
      );
      created.push({ id: gid(insAlt.recordset?.[0]?.id), leg: 'corridor_alt', route_index: altIndex });
    }

    const insDest = await query(
      `INSERT INTO tracking_geofence (tenant_id, name, fence_type, center_lat, center_lng, radius_m, alert_on_exit, alert_on_entry, contractor_route_id, leg)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, N'destination', @lat, @lng, @rm, 0, 1, @rid, N'destination')`,
      { tenantId: tid, n: `${routeName} — Destination`, lat: dest.lat, lng: dest.lng, rm: endpointRadiusM, rid: routeId }
    );
    created.push({ id: gid(insDest.recordset?.[0]?.id), leg: 'destination' });

    await query(
      `UPDATE tracking_monitor_route SET
        name = @n, collection_point_name = @cp, destination_name = @dn,
        origin_lat = @olat, origin_lng = @olng, dest_lat = @dlat, dest_lng = @dlng,
        waypoints_json = @wj, is_active = 1
       WHERE tenant_id = @tenantId AND contractor_route_id = @rid;
       IF @@ROWCOUNT = 0
         INSERT INTO tracking_monitor_route (tenant_id, name, collection_point_name, destination_name, origin_lat, origin_lng, dest_lat, dest_lng, waypoints_json, contractor_route_id, is_active)
         VALUES (@tenantId, @n, @cp, @dn, @olat, @olng, @dlat, @dlng, @wj, @rid, 1)`,
      {
        tenantId: tid,
        rid: routeId,
        n: routeName,
        cp: originQuery,
        dn: destQuery,
        olat: origin.lat,
        olng: origin.lng,
        dlat: dest.lat,
        dlng: dest.lng,
        wj: JSON.stringify(polyline),
      }
    );

    res.status(201).json({
      ok: true,
      created,
      origin,
      destination: dest,
      driving,
      corridor_m: corridorM,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Draw route failed' });
  }
});

/** Access Management routes with geofence coverage for tracking management. */
router.get('/contractor-routes', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT cr.id, cr.name, cr.starting_point, cr.destination, cr.loading_address, cr.destination_address, cr.distance_km,
              (SELECT COUNT(*) FROM tracking_geofence g WHERE g.tenant_id = cr.tenant_id AND g.contractor_route_id = cr.id) AS geofence_count
       FROM contractor_routes cr
       WHERE cr.tenant_id = @tenantId
       ORDER BY cr.[order], cr.name`,
      { tenantId: tid }
    );
    const routes = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      name: get(row, 'name'),
      starting_point: get(row, 'starting_point'),
      destination: get(row, 'destination'),
      loading_address: get(row, 'loading_address'),
      destination_address: get(row, 'destination_address'),
      distance_km: get(row, 'distance_km') != null ? Number(get(row, 'distance_km')) : null,
      geofence_count: Number(get(row, 'geofence_count') || 0),
    }));
    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list contractor routes' });
  }
});

/** Kanban-style fleet distribution grouped by route column. */
async function buildFleetDistribution(tenantId) {
  await refreshOverdue(tenantId);
  const [routesR, tripsR] = await Promise.all([
    query(
      `SELECT id, name, loading_address, destination_address FROM contractor_routes WHERE tenant_id = @tenantId ORDER BY [order], name`,
      { tenantId }
    ),
    query(
      `SELECT t.id, t.trip_ref, t.truck_registration, t.contractor_truck_id, t.contractor_route_id, t.route_id,
              t.status, t.driver_name, t.last_lat, t.last_lng, t.last_speed_kmh, t.last_heading_deg, t.last_seen_at, t.started_at,
              t.deviation_count, t.is_overdue, t.collection_point_name, t.destination_name,
              c.name AS contractor_name,
              (SELECT TOP 1 d.full_name FROM contractor_drivers d
               WHERE d.linked_truck_id = ct.id AND d.tenant_id = t.tenant_id) AS linked_driver_name
       FROM fleet_trip t
       LEFT JOIN contractor_trucks ct ON ct.id = t.contractor_truck_id AND ct.tenant_id = t.tenant_id
       LEFT JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = t.tenant_id
       WHERE t.tenant_id = @tenantId AND t.status IN (N'pending', N'enroute', N'deviated', N'overdue')
       ORDER BY t.updated_at DESC`,
      { tenantId }
    ),
  ]);

  const mapVehicle = (row) => {
    const started = get(row, 'started_at');
    const hours = started ? (Date.now() - new Date(started).getTime()) / 3600000 : null;
    return {
      trip_id: gid(get(row, 'id')),
      trip_ref: get(row, 'trip_ref'),
      truck_registration: get(row, 'truck_registration'),
      contractor_name: get(row, 'contractor_name'),
      driver_name: get(row, 'driver_name') || get(row, 'linked_driver_name'),
      status: get(row, 'status'),
      last_lat: get(row, 'last_lat') != null ? Number(get(row, 'last_lat')) : null,
      last_lng: get(row, 'last_lng') != null ? Number(get(row, 'last_lng')) : null,
      last_speed_kmh: get(row, 'last_speed_kmh') != null ? Number(get(row, 'last_speed_kmh')) : null,
      last_seen_at: get(row, 'last_seen_at'),
      hours_on_route: hours != null ? Math.round(hours * 100) / 100 : null,
      deviation_count: get(row, 'deviation_count') || 0,
      is_overdue: !!get(row, 'is_overdue'),
      collection_point_name: get(row, 'collection_point_name'),
      destination_name: get(row, 'destination_name'),
    };
  };

  const tripRows = tripsR.recordset || [];
  const byRoute = new Map();
  const unassigned = [];
  const mapTrips = [];

  for (const row of tripRows) {
    const vehicle = mapVehicle(row);
    const rid = gid(get(row, 'contractor_route_id')) || gid(get(row, 'route_id'));
    if (rid) {
      if (!byRoute.has(rid)) byRoute.set(rid, []);
      byRoute.get(rid).push(vehicle);
    } else {
      unassigned.push(vehicle);
    }
    if (vehicle.last_lat != null && vehicle.last_lng != null) {
      mapTrips.push({
        id: vehicle.trip_id,
        truck_registration: vehicle.truck_registration,
        trip_ref: vehicle.trip_ref,
        contractor_name: vehicle.contractor_name,
        driver_name: vehicle.driver_name,
        last_lat: vehicle.last_lat,
        last_lng: vehicle.last_lng,
        status: vehicle.status,
        last_speed_kmh: vehicle.last_speed_kmh,
        last_heading_deg: get(row, 'last_heading_deg') != null ? Number(get(row, 'last_heading_deg')) : null,
        last_seen_at: vehicle.last_seen_at,
        collection_point_name: vehicle.collection_point_name,
        destination_name: vehicle.destination_name,
      });
    }
  }

  const columns = (routesR.recordset || []).map((row) => {
    const id = gid(get(row, 'id'));
    const vehicles = byRoute.get(id) || [];
    return {
      route_id: id,
      route_name: get(row, 'name'),
      loading_address: get(row, 'loading_address'),
      destination_address: get(row, 'destination_address'),
      count: vehicles.length,
      vehicles,
    };
  });

  return { columns, unassigned, map_trips: mapTrips, updated_at: new Date().toISOString() };
}

function slimGeofencePolygon(polygonJson) {
  if (!polygonJson) return null;
  try {
    const p = typeof polygonJson === 'string' ? JSON.parse(polygonJson) : polygonJson;
    if (p?.ring) return JSON.stringify({ type: 'corridor', ring: p.ring });
    if (Array.isArray(p)) return JSON.stringify(p);
    return typeof polygonJson === 'string' ? polygonJson : JSON.stringify(p);
  } catch {
    return typeof polygonJson === 'string' ? polygonJson : null;
  }
}

router.get('/monitor/distribution', async (req, res) => {
  if (!ensureSchema(req, res, { columns: [], unassigned: [] })) return;
  try {
    const tid = tenantId(req);
    const board = await buildFleetDistribution(tid);
    res.json({ columns: board.columns, unassigned: board.unassigned, updated_at: board.updated_at });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Distribution failed' });
  }
});

/** Single fast payload for Fleet distribution tab (board + map overlays + poll status). */
router.get('/monitor/fleet-board', async (req, res) => {
  if (!ensureSchema(req, res, { columns: [], unassigned: [], map_trips: [], geofences: [], routes: [] })) return;
  try {
    const tid = tenantId(req);
    const board = await buildFleetDistribution(tid);
    const [geofencesR, routesR] = await Promise.all([
      query(
        `SELECT id, name, leg, fence_type, center_lat, center_lng, radius_m, polygon_json, contractor_route_id
         FROM tracking_geofence WHERE tenant_id = @tenantId`,
        { tenantId: tid }
      ),
      query(
        `SELECT id, contractor_route_id, name, origin_lat, origin_lng, dest_lat, dest_lng, waypoints_json
         FROM tracking_monitor_route WHERE tenant_id = @tenantId AND is_active = 1`,
        { tenantId: tid }
      ),
    ]);
    const geofences = (geofencesR.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      name: get(row, 'name'),
      leg: get(row, 'leg'),
      fence_type: get(row, 'fence_type'),
      center_lat: get(row, 'center_lat') != null ? Number(get(row, 'center_lat')) : null,
      center_lng: get(row, 'center_lng') != null ? Number(get(row, 'center_lng')) : null,
      radius_m: get(row, 'radius_m'),
      polygon_json: slimGeofencePolygon(get(row, 'polygon_json')),
      contractor_route_id: gid(get(row, 'contractor_route_id')),
    }));
    const routes = (routesR.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
      contractor_route_id: gid(get(row, 'contractor_route_id')),
      name: get(row, 'name'),
      origin_lat: get(row, 'origin_lat') != null ? Number(get(row, 'origin_lat')) : null,
      origin_lng: get(row, 'origin_lng') != null ? Number(get(row, 'origin_lng')) : null,
      dest_lat: get(row, 'dest_lat') != null ? Number(get(row, 'dest_lat')) : null,
      dest_lng: get(row, 'dest_lng') != null ? Number(get(row, 'dest_lng')) : null,
      waypoints_json: get(row, 'waypoints_json'),
    }));
    res.json({
      ...board,
      geofences,
      routes,
      poll: getTrackingPollStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Fleet board failed' });
  }
});

/** Logistics Activity — aviation-style stage board. */
router.get('/logistics-activity/ping', (req, res) => {
  res.json({ ok: true, feature: 'logistics-activity' });
});

router.get('/logistics-activity/board', async (req, res) => {
  if (!ensureSchema(req, res, { stages: [], routes: [], total_active: 0 })) return;
  try {
    const tid = tenantId(req);
    const board = await buildLogisticsActivityBoard(query, tid);
    res.json({ ...board, poll: getTrackingPollStatus() });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Logistics activity board failed' });
  }
});

router.post('/logistics-activity/schedule', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const result = await scheduleTruckForRoute(query, tid, req.body || {});
    res.status(result.updated ? 200 : 201).json({ ok: true, ...result });
  } catch (err) {
    res.status(err.message?.includes('required') || err.message?.includes('not found') ? 400 : 500).json({ error: err?.message || 'Schedule failed' });
  }
});

router.post('/logistics-activity/trips/:id/loading-slip', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const tripId = req.params.id;
    const b = req.body || {};
    const defer = !!b.defer_slip;
    const slipNo = b.loading_slip_no ? String(b.loading_slip_no).trim() : '';
    if (!defer && !slipNo) return res.status(400).json({ error: 'Loading slip number required (or use proceed without slip)' });

    const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: tripId });
    const trip = tr.recordset?.[0];
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const st = await query(`SELECT max_enroute_minutes FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId: tid });
    let maxM = st.recordset?.[0] ? get(st.recordset[0], 'max_enroute_minutes') : 240;
    if (maxM == null || maxM < 1) maxM = 240;

    await query(
      `UPDATE fleet_trip SET
        loading_slip_no = @slip,
        loading_slip_deferred = @defer,
        driver_name = COALESCE(@driver, driver_name),
        activity_stage = N'enroute',
        status = N'enroute',
        started_at = COALESCE(started_at, SYSUTCDATETIME()),
        eta_due_at = DATEADD(minute, @maxM, COALESCE(started_at, SYSUTCDATETIME())),
        is_overdue = 0,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId: tid,
        id: tripId,
        slip: slipNo || null,
        defer: defer ? 1 : 0,
        driver: b.driver_name || null,
        maxM,
      }
    );

    await query(
      `UPDATE tracking_delivery_record SET
        loading_slip_no = @slip,
        loading_slip_deferred = @defer,
        driver_name = COALESCE(@driver, driver_name),
        tons_loaded = COALESCE(@tons, tons_loaded),
        notes = COALESCE(@notes, notes),
        pending_note = 0,
        status = N'loading_complete'
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'loading'`,
      {
        tenantId: tid,
        tripId,
        slip: slipNo || null,
        defer: defer ? 1 : 0,
        driver: b.driver_name || null,
        tons: b.tons_loaded != null ? Number(b.tons_loaded) : null,
        notes: b.notes || null,
      }
    );

    res.json({ ok: true, activity_stage: 'enroute' });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Loading slip failed' });
  }
});

router.post('/logistics-activity/trips/:id/offloading-slip', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const tripId = req.params.id;
    const b = req.body || {};
    const slipNo = b.offloading_slip_no ? String(b.offloading_slip_no).trim() : '';
    const noteNo = b.delivery_note_no ? String(b.delivery_note_no).trim() : '';
    if (!slipNo && !noteNo) return res.status(400).json({ error: 'Offloading slip or delivery note number required' });

    const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: tripId });
    if (!tr.recordset?.[0]) return res.status(404).json({ error: 'Trip not found' });

    await query(
      `UPDATE fleet_trip SET
        offloading_slip_no = @slip,
        activity_stage = N'awaiting_reschedule',
        status = N'pending',
        is_overdue = 0,
        updated_at = SYSUTCDATETIME(),
        notes = COALESCE(@notes, notes)
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: tripId, slip: slipNo || noteNo, notes: b.notes || null }
    );

    await query(
      `UPDATE tracking_delivery_record SET
        offloading_slip_no = @slip,
        delivery_note_no = COALESCE(@note, delivery_note_no),
        tons_loaded = COALESCE(@tons, tons_loaded),
        net_weight_kg = COALESCE(@nw, net_weight_kg),
        notes = COALESCE(@notes, notes),
        pending_note = 0,
        status = N'completed'
       WHERE tenant_id = @tenantId AND trip_id = @tripId AND activity_phase = N'destination'`,
      {
        tenantId: tid,
        tripId,
        slip: slipNo || null,
        note: noteNo || null,
        tons: b.tons_loaded != null ? Number(b.tons_loaded) : null,
        nw: b.tons_loaded != null ? Number(b.tons_loaded) * 1000 : null,
        notes: b.notes || null,
      }
    );

    res.json({ ok: true, activity_stage: 'awaiting_reschedule' });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Offloading slip failed' });
  }
});

router.post('/logistics-activity/trips/:id/redirect', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const tripId = req.params.id;
    const rid = req.body?.contractor_route_id;
    if (!rid) return res.status(400).json({ error: 'contractor_route_id required' });

    const tr = await query(`SELECT * FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: tripId });
    const trip = tr.recordset?.[0];
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const stage = String(get(trip, 'activity_stage') || '').toLowerCase();
    if (stage === 'awaiting_reschedule') {
      const result = await scheduleTruckForRoute(query, tid, {
        truck_registration: get(trip, 'truck_registration'),
        contractor_truck_id: gid(get(trip, 'contractor_truck_id')),
        contractor_route_id: rid,
      });
      return res.json({ ok: true, ...result });
    }

    await query(
      `UPDATE fleet_trip SET status = N'completed', activity_stage = N'completed', completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: tripId }
    );

    const result = await scheduleTruckForRoute(query, tid, {
      truck_registration: get(trip, 'truck_registration'),
      contractor_truck_id: gid(get(trip, 'contractor_truck_id')),
      contractor_route_id: rid,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Redirect failed' });
  }
});

router.post('/logistics-activity/trips/:id/cancel', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    await query(
      `UPDATE fleet_trip SET status = N'cancelled', activity_stage = NULL, updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Cancel failed' });
  }
});

router.post('/logistics-activity/trips/:id/stage', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const stage = b.activity_stage;
    if (!stage) return res.status(400).json({ error: 'activity_stage required' });
    const result = await moveTripActivityStage(query, tid, req.params.id, stage, {
      contractor_route_id: b.contractor_route_id,
      defer_slip: b.defer_slip,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err?.message || 'Stage move failed';
    const code = msg.includes('required') || msg.includes('must be') || msg.includes('not found') ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

router.post('/monitor/process-positions', async (req, res) => {
  if (!ensureSchema(req, res, { ok: false })) return;
  try {
    const tid = tenantId(req);
    const stats = await processGeofencePositions(query, tid);
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Process positions failed' });
  }
});

router.post('/sync/contractor-fleet', async (req, res) => {
  if (!ensureSchema(req, res, { ok: false })) return;
  try {
    const tid = tenantId(req);
    const result = await syncContractorFleetToTracking(query, tid);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Sync failed' });
  }
});

router.patch('/deliveries/:id/note', async (req, res) => {
  if (!ensureSchema(req, res, {})) return;
  try {
    const tid = tenantId(req);
    const b = req.body || {};
    const { delivery_note_no, tons_loaded, driver_name, notes, net_weight_kg } = b;
    if (!delivery_note_no && tons_loaded == null) {
      return res.status(400).json({ error: 'delivery_note_no or tons_loaded required' });
    }
    await query(
      `UPDATE tracking_delivery_record SET
        delivery_note_no = COALESCE(@dnn, delivery_note_no),
        tons_loaded = COALESCE(@tons, tons_loaded),
        driver_name = COALESCE(@driver, driver_name),
        notes = COALESCE(@notes, notes),
        net_weight_kg = COALESCE(@nw, net_weight_kg),
        pending_note = 0,
        status = N'completed'
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        tenantId: tid,
        id: req.params.id,
        dnn: delivery_note_no || null,
        tons: tons_loaded != null ? Number(tons_loaded) : null,
        driver: driver_name || null,
        notes: notes || null,
        nw: net_weight_kg != null ? Number(net_weight_kg) : (tons_loaded != null ? Number(tons_loaded) * 1000 : null),
      }
    );
    const dr = await query(`SELECT trip_id FROM tracking_delivery_record WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: req.params.id });
    const tripId = gid(get(dr.recordset?.[0], 'trip_id'));
    if (tripId) {
      await query(
        `UPDATE fleet_trip SET status = N'completed', completed_at = SYSUTCDATETIME(), notes = COALESCE(@notes, notes), updated_at = SYSUTCDATETIME()
         WHERE id = @tripId AND tenant_id = @tenantId`,
        { tenantId: tid, tripId, notes: notes || null }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to save delivery note' });
  }
});

router.get('/dashboard', async (req, res) => {
  if (!ensureSchema(req, res, { counts: { enroute: 0, overdue: 0, pending: 0, unacked_alarms_24h: 0 } })) return;
  try {
    const tid = tenantId(req);
    await refreshOverdue(tid);
    const enroute = await query(`SELECT COUNT(*) AS c FROM fleet_trip WHERE tenant_id = @tenantId AND status = N'enroute'`, { tenantId: tid });
    const overdue = await query(`SELECT COUNT(*) AS c FROM fleet_trip WHERE tenant_id = @tenantId AND status = N'overdue'`, { tenantId: tid });
    const pending = await query(`SELECT COUNT(*) AS c FROM fleet_trip WHERE tenant_id = @tenantId AND status = N'pending'`, { tenantId: tid });
    const alarms = await query(
      `SELECT COUNT(*) AS c FROM tracking_alarm_record WHERE tenant_id = @tenantId AND acknowledged = 0 AND occurred_at > DATEADD(hour, -24, SYSUTCDATETIME())`,
      { tenantId: tid }
    );
    const n = (r) => {
      const row = r?.recordset?.[0];
      if (!row) return 0;
      return get(row, 'c') ?? get(row, 'C') ?? Object.values(row)[0] ?? 0;
    };
    res.json({
      counts: {
        enroute: n(enroute),
        overdue: n(overdue),
        pending: n(pending),
        unacked_alarms_24h: n(alarms),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Dashboard failed' });
  }
});

export default router;
