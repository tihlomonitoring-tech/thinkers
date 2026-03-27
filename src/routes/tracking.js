import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

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
      `SELECT id, tenant_id, name, collection_point_name, destination_name, origin_lat, origin_lng, dest_lat, dest_lng, waypoints_json, is_active, created_at
       FROM tracking_monitor_route WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId: tid }
    );
    const routes = (r.recordset || []).map((row) => ({
      id: gid(get(row, 'id')),
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
      `SELECT id, tenant_id, name, fence_type, center_lat, center_lng, radius_m, polygon_json, alert_on_exit, alert_on_entry, created_at
       FROM tracking_geofence WHERE tenant_id = @tenantId ORDER BY name`,
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
      `INSERT INTO tracking_geofence (tenant_id, name, fence_type, center_lat, center_lng, radius_m, polygon_json, alert_on_exit, alert_on_entry)
       OUTPUT INSERTED.id VALUES (@tenantId, @n, @ft, @clat, @clng, @rm, @pj, @ae, @ai)`,
      {
        tenantId: tid,
        n: b.name,
        ft: b.fence_type,
        clat: b.center_lat ?? null,
        clng: b.center_lng ?? null,
        rm: b.radius_m ?? null,
        pj: b.polygon_json || null,
        ae: b.alert_on_exit !== false ? 1 : 0,
        ai: b.alert_on_entry ? 1 : 0,
      }
    );
    res.status(201).json({ id: gid(ins.recordset?.[0]?.id), ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create geofence' });
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
    const ref = b.trip_ref || `TRIP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
    await query(
      `UPDATE fleet_trip SET last_lat = @lat, last_lng = @lng, last_speed_kmh = @spd, last_heading_deg = @hdg, last_seen_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { tenantId: tid, id: req.params.id, lat: lat ?? null, lng: lng ?? null, spd: speed_kmh ?? null, hdg: heading_deg ?? null }
    );
    const settings = await query(`SELECT alarm_overspeed_kmh FROM tracking_tenant_settings WHERE tenant_id = @tenantId`, { tenantId: tid });
    const maxS = settings.recordset?.[0] ? get(settings.recordset[0], 'alarm_overspeed_kmh') : 90;
    if (speed_kmh != null && maxS != null && Number(speed_kmh) > Number(maxS)) {
      const trip = await query(`SELECT truck_registration FROM fleet_trip WHERE id = @id AND tenant_id = @tenantId`, { tenantId: tid, id: req.params.id });
      const reg = get(trip.recordset?.[0], 'truck_registration');
      await query(
        `INSERT INTO tracking_alarm_record (tenant_id, trip_id, truck_registration, alarm_type, severity, occurred_at, lat, lng, speed_kmh, detail)
         VALUES (@tenantId, @tripId, @reg, N'overspeed', N'warning', SYSUTCDATETIME(), @lat, @lng, @spd, @det)`,
        {
          tenantId: tid,
          tripId: req.params.id,
          reg,
          lat: lat ?? null,
          lng: lng ?? null,
          spd: speed_kmh,
          det: `Speed ${speed_kmh} km/h exceeds limit ${maxS} km/h`,
        }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to record telemetry' });
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
      destination_name: get(row, 'destination_name'),
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
      await query(
        `UPDATE fleet_trip SET last_lat = @lat, last_lng = @lng, last_speed_kmh = @spd, last_heading_deg = @hdg,
            last_seen_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
         WHERE id = @id AND tenant_id = @tenantId`,
        { tenantId: tid, id, lat, lng, spd, hdg }
      );
      updated++;
    }
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'demo tick failed' });
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
