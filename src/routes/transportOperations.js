import { Router } from 'express';
import { join } from 'path';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { buildTransportOpsPresentationPptx } from '../lib/transportOpsPresentationPptx.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('transport_operations'));

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

const tenantId = (req) => req.user?.tenant_id;

// ---- Tenant users with access to Transport Operations (for controllers and submit-to) ----
router.get('/tenant-users', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM users u
       LEFT JOIN user_tenants ut ON ut.user_id = u.id
       WHERE (u.tenant_id = @tenantId OR ut.tenant_id = @tenantId) AND u.status = 'active'
         AND (u.role = 'super_admin'
              OR NOT EXISTS (SELECT 1 FROM user_page_roles upr WHERE upr.user_id = u.id)
              OR EXISTS (SELECT 1 FROM user_page_roles upr WHERE upr.user_id = u.id AND upr.page_id = 'transport_operations'))
       ORDER BY u.full_name`,
      { tenantId: tid }
    );
    const users = (result.recordset || []).map((r) => ({
      id: get(r, 'id'),
      full_name: get(r, 'full_name'),
      email: get(r, 'email'),
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list tenant users' });
  }
});

// ---- Trucks ----
router.get('/trucks', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, tenant_id, registration, make_model, fleet_no, trailer_1_reg_no, trailer_2_reg_no, commodity_type, capacity_tonnes, year_model, notes, created_at, updated_at
       FROM to_trucks WHERE tenant_id = @tenantId ORDER BY registration, fleet_no`,
      { tenantId: tid }
    );
    const trucks = (result.recordset || []).map((r) => ({
      id: get(r, 'id'),
      tenant_id: get(r, 'tenant_id'),
      registration: get(r, 'registration'),
      make_model: get(r, 'make_model'),
      fleet_no: get(r, 'fleet_no'),
      trailer_1_reg_no: get(r, 'trailer_1_reg_no'),
      trailer_2_reg_no: get(r, 'trailer_2_reg_no'),
      commodity_type: get(r, 'commodity_type'),
      capacity_tonnes: get(r, 'capacity_tonnes'),
      year_model: get(r, 'year_model'),
      notes: get(r, 'notes'),
      created_at: get(r, 'created_at'),
      updated_at: get(r, 'updated_at'),
    }));
    res.json({ trucks });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list trucks' });
  }
});

router.post('/trucks', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    await query(
      `INSERT INTO to_trucks (tenant_id, registration, make_model, fleet_no, trailer_1_reg_no, trailer_2_reg_no, commodity_type, capacity_tonnes, year_model, notes)
       VALUES (@tenantId, @registration, @make_model, @fleet_no, @trailer_1_reg_no, @trailer_2_reg_no, @commodity_type, @capacity_tonnes, @year_model, @notes)`,
      {
        tenantId: tid,
        registration: body.registration ?? null,
        make_model: body.make_model ?? null,
        fleet_no: body.fleet_no ?? null,
        trailer_1_reg_no: body.trailer_1_reg_no ?? null,
        trailer_2_reg_no: body.trailer_2_reg_no ?? null,
        commodity_type: body.commodity_type ?? null,
        capacity_tonnes: body.capacity_tonnes ?? null,
        year_model: body.year_model ?? null,
        notes: body.notes ?? null,
      }
    );
    const r = await query(`SELECT TOP 1 id, registration, make_model, fleet_no, trailer_1_reg_no, trailer_2_reg_no, commodity_type, capacity_tonnes, year_model, notes, created_at, updated_at FROM to_trucks WHERE tenant_id = @tenantId ORDER BY created_at DESC`, { tenantId: tid });
    const row = r.recordset?.[0];
    res.status(201).json({ truck: row ? { id: get(row, 'id'), registration: get(row, 'registration'), make_model: get(row, 'make_model'), fleet_no: get(row, 'fleet_no'), trailer_1_reg_no: get(row, 'trailer_1_reg_no'), trailer_2_reg_no: get(row, 'trailer_2_reg_no'), commodity_type: get(row, 'commodity_type'), capacity_tonnes: get(row, 'capacity_tonnes'), year_model: get(row, 'year_model'), notes: get(row, 'notes'), created_at: get(row, 'created_at'), updated_at: get(row, 'updated_at') } : null });
  } catch (err) {
    if (err?.message?.includes('to_trucks')) {
      return res.status(500).json({ error: 'Transport operations schema not applied. Run: node scripts/run-transport-operations-schema.js' });
    }
    res.status(500).json({ error: err?.message || 'Failed to create truck' });
  }
});

router.patch('/trucks/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    const body = req.body || {};
    const updates = [];
    const params = { id, tenantId: tid };
    if (body.registration !== undefined) { updates.push('registration = @registration'); params.registration = body.registration; }
    if (body.make_model !== undefined) { updates.push('make_model = @make_model'); params.make_model = body.make_model; }
    if (body.fleet_no !== undefined) { updates.push('fleet_no = @fleet_no'); params.fleet_no = body.fleet_no; }
    if (body.trailer_1_reg_no !== undefined) { updates.push('trailer_1_reg_no = @trailer_1_reg_no'); params.trailer_1_reg_no = body.trailer_1_reg_no; }
    if (body.trailer_2_reg_no !== undefined) { updates.push('trailer_2_reg_no = @trailer_2_reg_no'); params.trailer_2_reg_no = body.trailer_2_reg_no; }
    if (body.commodity_type !== undefined) { updates.push('commodity_type = @commodity_type'); params.commodity_type = body.commodity_type; }
    if (body.capacity_tonnes !== undefined) { updates.push('capacity_tonnes = @capacity_tonnes'); params.capacity_tonnes = body.capacity_tonnes; }
    if (body.year_model !== undefined) { updates.push('year_model = @year_model'); params.year_model = body.year_model; }
    if (body.notes !== undefined) { updates.push('notes = @notes'); params.notes = body.notes; }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE to_trucks SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update truck' });
  }
});

router.delete('/trucks/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    await query(`DELETE FROM to_trucks WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: tid });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete truck' });
  }
});

// ---- Drivers ----
router.get('/drivers', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT d.id, d.tenant_id, d.full_name, d.license_number, d.license_expiry, d.phone, d.email, d.id_number, d.notes, d.user_id, d.created_at, d.updated_at, u.full_name AS linked_user_name
       FROM to_drivers d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.tenant_id = @tenantId ORDER BY d.full_name`,
      { tenantId: tid }
    );
    const drivers = (result.recordset || []).map((r) => ({
      id: get(r, 'id'),
      tenant_id: get(r, 'tenant_id'),
      full_name: get(r, 'full_name'),
      license_number: get(r, 'license_number'),
      license_expiry: get(r, 'license_expiry'),
      phone: get(r, 'phone'),
      email: get(r, 'email'),
      id_number: get(r, 'id_number'),
      notes: get(r, 'notes'),
      user_id: get(r, 'user_id'),
      linked_user_name: get(r, 'linked_user_name'),
      created_at: get(r, 'created_at'),
      updated_at: get(r, 'updated_at'),
    }));
    res.json({ drivers });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list drivers' });
  }
});

router.post('/drivers', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    await query(
      `INSERT INTO to_drivers (tenant_id, full_name, license_number, license_expiry, phone, email, id_number, notes, user_id)
       VALUES (@tenantId, @full_name, @license_number, @license_expiry, @phone, @email, @id_number, @notes, @user_id)`,
      {
        tenantId: tid,
        full_name: body.full_name ?? null,
        license_number: body.license_number ?? null,
        license_expiry: body.license_expiry ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        id_number: body.id_number ?? null,
        notes: body.notes ?? null,
        user_id: body.user_id ?? null,
      }
    );
    const r = await query(`SELECT TOP 1 id, full_name, license_number, license_expiry, phone, email, id_number, notes, created_at, updated_at FROM to_drivers WHERE tenant_id = @tenantId ORDER BY created_at DESC`, { tenantId: tid });
    const row = r.recordset?.[0];
    res.status(201).json({ driver: row ? { id: get(row, 'id'), full_name: get(row, 'full_name'), license_number: get(row, 'license_number'), license_expiry: get(row, 'license_expiry'), phone: get(row, 'phone'), email: get(row, 'email'), id_number: get(row, 'id_number'), notes: get(row, 'notes'), created_at: get(row, 'created_at'), updated_at: get(row, 'updated_at') } : null });
  } catch (err) {
    if (err?.message?.includes('to_drivers')) {
      return res.status(500).json({ error: 'Transport operations schema not applied. Run: node scripts/run-transport-operations-schema.js' });
    }
    res.status(500).json({ error: err?.message || 'Failed to create driver' });
  }
});

router.patch('/drivers/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    const body = req.body || {};
    const updates = [];
    const params = { id, tenantId: tid };
    if (body.full_name !== undefined) { updates.push('full_name = @full_name'); params.full_name = body.full_name; }
    if (body.license_number !== undefined) { updates.push('license_number = @license_number'); params.license_number = body.license_number; }
    if (body.license_expiry !== undefined) { updates.push('license_expiry = @license_expiry'); params.license_expiry = body.license_expiry; }
    if (body.phone !== undefined) { updates.push('phone = @phone'); params.phone = body.phone; }
    if (body.email !== undefined) { updates.push('email = @email'); params.email = body.email; }
    if (body.id_number !== undefined) { updates.push('id_number = @id_number'); params.id_number = body.id_number; }
    if (body.notes !== undefined) { updates.push('notes = @notes'); params.notes = body.notes; }
    if (body.user_id !== undefined) { updates.push('user_id = @user_id'); params.user_id = body.user_id || null; }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE to_drivers SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update driver' });
  }
});

router.delete('/drivers/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    await query(`DELETE FROM to_drivers WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: tid });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete driver' });
  }
});

// ---- Routes (accounting: collection point, destination, rate, targets) ----
router.get('/routes', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, tenant_id, name, collection_point, destination, rate, price_per_quantity, delivery_target, amount_target, created_at, updated_at
       FROM to_routes WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId: tid }
    );
    const routes = (result.recordset || []).map((r) => ({
      id: get(r, 'id'),
      tenant_id: get(r, 'tenant_id'),
      name: get(r, 'name'),
      collection_point: get(r, 'collection_point'),
      destination: get(r, 'destination'),
      rate: get(r, 'rate'),
      price_per_quantity: get(r, 'price_per_quantity'),
      delivery_target: get(r, 'delivery_target'),
      amount_target: get(r, 'amount_target'),
      created_at: get(r, 'created_at'),
      updated_at: get(r, 'updated_at'),
    }));
    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list routes' });
  }
});

router.post('/routes', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    const name = (body.name || '').trim() || (body.collection_point && body.destination ? `${body.collection_point} → ${body.destination}` : 'Route');
    await query(
      `INSERT INTO to_routes (tenant_id, name, collection_point, destination, rate, price_per_quantity, delivery_target, amount_target)
       VALUES (@tenantId, @name, @collection_point, @destination, @rate, @price_per_quantity, @delivery_target, @amount_target)`,
      {
        tenantId: tid,
        name,
        collection_point: body.collection_point ?? null,
        destination: body.destination ?? null,
        rate: body.rate ?? null,
        price_per_quantity: body.price_per_quantity ?? null,
        delivery_target: body.delivery_target ?? null,
        amount_target: body.amount_target ?? null,
      }
    );
    const r = await query(`SELECT TOP 1 id, name, collection_point, destination, rate, price_per_quantity, delivery_target, amount_target, created_at, updated_at FROM to_routes WHERE tenant_id = @tenantId ORDER BY created_at DESC`, { tenantId: tid });
    const row = r.recordset?.[0];
    res.status(201).json({ route: row ? { id: get(row, 'id'), name: get(row, 'name'), collection_point: get(row, 'collection_point'), destination: get(row, 'destination'), rate: get(row, 'rate'), price_per_quantity: get(row, 'price_per_quantity'), delivery_target: get(row, 'delivery_target'), amount_target: get(row, 'amount_target'), created_at: get(row, 'created_at'), updated_at: get(row, 'updated_at') } : null });
  } catch (err) {
    if (err?.message?.includes('to_routes')) {
      return res.status(500).json({ error: 'Transport operations schema not applied. Run: node scripts/run-transport-operations-schema.js' });
    }
    res.status(500).json({ error: err?.message || 'Failed to create route' });
  }
});

router.patch('/routes/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    const body = req.body || {};
    const updates = [];
    const params = { id, tenantId: tid };
    if (body.name !== undefined) { updates.push('name = @name'); params.name = body.name; }
    if (body.collection_point !== undefined) { updates.push('collection_point = @collection_point'); params.collection_point = body.collection_point; }
    if (body.destination !== undefined) { updates.push('destination = @destination'); params.destination = body.destination; }
    if (body.rate !== undefined) { updates.push('rate = @rate'); params.rate = body.rate; }
    if (body.delivery_target !== undefined) { updates.push('delivery_target = @delivery_target'); params.delivery_target = body.delivery_target; }
    if (body.amount_target !== undefined) { updates.push('amount_target = @amount_target'); params.amount_target = body.amount_target; }
    if (body.price_per_quantity !== undefined) { updates.push('price_per_quantity = @price_per_quantity'); params.price_per_quantity = body.price_per_quantity; }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE to_routes SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update route' });
  }
});

router.delete('/routes/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    await query(`DELETE FROM to_routes WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: tid });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to delete route' });
  }
});

// ---- Shift reports ----
router.get('/shift-reports', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    const pendingMyApproval = req.query.pending_my_approval === '1' || req.query.pending_my_approval === 'true';
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, tenant_id, created_by_user_id, controller_name, controller_user_ids, shift, report_date, notes_for_next_controller, created_at,
              submitted_to_user_ids, status, approved_by_user_id, approved_at
       FROM to_shift_reports WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
      { tenantId: tid }
    );
    let reports = (result.recordset || []).map((r) => {
      const submittedTo = get(r, 'submitted_to_user_ids');
      let submitted_to_user_ids = [];
      try { submitted_to_user_ids = submittedTo ? JSON.parse(submittedTo) : []; } catch (_) {}
      return {
        id: get(r, 'id'),
        controller_name: get(r, 'controller_name'),
        controller_user_ids: get(r, 'controller_user_ids'),
        shift: get(r, 'shift'),
        report_date: get(r, 'report_date'),
        notes_for_next_controller: get(r, 'notes_for_next_controller'),
        created_at: get(r, 'created_at'),
        submitted_to_user_ids,
        status: get(r, 'status') || 'draft',
        approved_by_user_id: get(r, 'approved_by_user_id'),
        approved_at: get(r, 'approved_at'),
      };
    });
    if (pendingMyApproval && userId) {
      const uid = String(userId);
      reports = reports.filter((r) => r.status === 'pending_approval' && Array.isArray(r.submitted_to_user_ids) && r.submitted_to_user_ids.some((id) => String(id) === uid));
    }
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list shift reports' });
  }
});

router.get('/shift-reports/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing tenant or id' });
    const result = await query(
      `SELECT id, tenant_id, created_by_user_id, controller_name, controller_user_ids, shift, report_date, available_route_ids, active_fleet_log, non_participating, notes_for_next_controller, created_at,
              submitted_to_user_ids, status, approved_by_user_id, approved_at, truck_updates, communication_log, shift_summary, incidents, non_compliance_calls, investigations
       FROM to_shift_reports WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: tid }
    );
    const r = result.recordset?.[0];
    if (!r) return res.status(404).json({ error: 'Report not found' });
    let submitted_to_user_ids = [];
    try { submitted_to_user_ids = get(r, 'submitted_to_user_ids') ? JSON.parse(get(r, 'submitted_to_user_ids')) : []; } catch (_) {}
    let active_fleet_log = [];
    try { active_fleet_log = get(r, 'active_fleet_log') ? JSON.parse(get(r, 'active_fleet_log')) : []; } catch (_) {}
    let non_participating = [];
    try { non_participating = get(r, 'non_participating') ? JSON.parse(get(r, 'non_participating')) : []; } catch (_) {}
    let truck_updates = [];
    try { truck_updates = get(r, 'truck_updates') ? JSON.parse(get(r, 'truck_updates')) : []; } catch (_) {}
    let communication_log = [];
    try { communication_log = get(r, 'communication_log') ? JSON.parse(get(r, 'communication_log')) : []; } catch (_) {}
    let shift_summary = null;
    try { shift_summary = get(r, 'shift_summary') ? JSON.parse(get(r, 'shift_summary')) : null; } catch (_) {}
    let incidents = [];
    try { incidents = get(r, 'incidents') ? JSON.parse(get(r, 'incidents')) : []; } catch (_) {}
    let non_compliance_calls = [];
    try { non_compliance_calls = get(r, 'non_compliance_calls') ? JSON.parse(get(r, 'non_compliance_calls')) : []; } catch (_) {}
    let investigations = [];
    try { investigations = get(r, 'investigations') ? JSON.parse(get(r, 'investigations')) : []; } catch (_) {}
    const report = {
      id: get(r, 'id'),
      tenant_id: get(r, 'tenant_id'),
      created_by_user_id: get(r, 'created_by_user_id'),
      controller_name: get(r, 'controller_name'),
      controller_user_ids: get(r, 'controller_user_ids'),
      shift: get(r, 'shift'),
      report_date: get(r, 'report_date'),
      available_route_ids: get(r, 'available_route_ids'),
      active_fleet_log,
      non_participating,
      notes_for_next_controller: get(r, 'notes_for_next_controller'),
      created_at: get(r, 'created_at'),
      submitted_to_user_ids,
      status: get(r, 'status') || 'draft',
      approved_by_user_id: get(r, 'approved_by_user_id'),
      approved_at: get(r, 'approved_at'),
      truck_updates: Array.isArray(truck_updates) ? truck_updates : [],
      communication_log: Array.isArray(communication_log) ? communication_log : [],
      shift_summary: shift_summary && typeof shift_summary === 'object' ? shift_summary : null,
      incidents: Array.isArray(incidents) ? incidents : [],
      non_compliance_calls: Array.isArray(non_compliance_calls) ? non_compliance_calls : [],
      investigations: Array.isArray(investigations) ? investigations : [],
    };
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to get report' });
  }
});

router.post('/shift-reports', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    const available_route_ids = Array.isArray(body.available_route_ids) ? JSON.stringify(body.available_route_ids) : (body.available_route_ids ?? null);
    const active_fleet_log = body.active_fleet_log != null ? JSON.stringify(body.active_fleet_log) : null;
    const non_participating = body.non_participating != null ? JSON.stringify(body.non_participating) : null;
    const truck_updates = body.truck_updates != null ? JSON.stringify(body.truck_updates) : null;
    const communication_log = body.communication_log != null ? JSON.stringify(body.communication_log) : null;
    const shift_summary = body.shift_summary != null ? JSON.stringify(body.shift_summary) : null;
    const incidents = body.incidents != null ? JSON.stringify(body.incidents) : null;
    const non_compliance_calls = body.non_compliance_calls != null ? JSON.stringify(body.non_compliance_calls) : null;
    const investigations = body.investigations != null ? JSON.stringify(body.investigations) : null;
    const controller_user_ids = Array.isArray(body.controller_user_ids) ? JSON.stringify(body.controller_user_ids) : (body.controller_user_ids ?? null);
    const submitted_to_user_ids = Array.isArray(body.submitted_to_user_ids) && body.submitted_to_user_ids.length > 0
      ? JSON.stringify(body.submitted_to_user_ids)
      : null;
    const status = submitted_to_user_ids ? 'pending_approval' : 'draft';
    await query(
      `INSERT INTO to_shift_reports (tenant_id, created_by_user_id, controller_name, controller_user_ids, shift, report_date, available_route_ids, active_fleet_log, non_participating, notes_for_next_controller, submitted_to_user_ids, status, truck_updates, communication_log, shift_summary, incidents, non_compliance_calls, investigations)
       VALUES (@tenantId, @created_by_user_id, @controller_name, @controller_user_ids, @shift, @report_date, @available_route_ids, @active_fleet_log, @non_participating, @notes_for_next_controller, @submitted_to_user_ids, @status, @truck_updates, @communication_log, @shift_summary, @incidents, @non_compliance_calls, @investigations)`,
      {
        tenantId: tid,
        created_by_user_id: userId ?? null,
        controller_name: body.controller_name ?? null,
        controller_user_ids,
        shift: body.shift ?? null,
        report_date: body.report_date ?? null,
        available_route_ids,
        active_fleet_log,
        non_participating,
        notes_for_next_controller: body.notes_for_next_controller ?? null,
        submitted_to_user_ids,
        status,
        truck_updates,
        communication_log,
        shift_summary,
        incidents,
        non_compliance_calls,
        investigations,
      }
    );
    const r = await query(`SELECT TOP 1 id, controller_name, shift, report_date, created_at, status FROM to_shift_reports WHERE tenant_id = @tenantId ORDER BY created_at DESC`, { tenantId: tid });
    const row = r.recordset?.[0];
    res.status(201).json({ report: row ? { id: get(row, 'id'), controller_name: get(row, 'controller_name'), shift: get(row, 'shift'), report_date: get(row, 'report_date'), created_at: get(row, 'created_at'), status: get(row, 'status') } : null });
  } catch (err) {
    if (err?.message?.includes('to_shift_reports')) {
      return res.status(500).json({ error: 'Transport operations schema not applied. Run: node scripts/run-transport-operations-schema.js' });
    }
    res.status(500).json({ error: err?.message || 'Failed to save shift report' });
  }
});

// Evaluation (required before approval)
const EVALUATION_QUESTIONS = [
  { id: 'quality', label: 'Quality of report', type: 'scale', min: 1, max: 5 },
  { id: 'completeness', label: 'Completeness of information', type: 'scale', min: 1, max: 5 },
  { id: 'accuracy', label: 'Accuracy of data', type: 'scale', min: 1, max: 5 },
  { id: 'timeliness', label: 'Timeliness of submission', type: 'scale', min: 1, max: 5 },
];

router.get('/shift-reports/:id/evaluation-questions', (req, res) => {
  res.json({ questions: EVALUATION_QUESTIONS });
});

router.get('/shift-reports/:id/evaluation', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    const { id } = req.params;
    if (!tid || !id || !userId) return res.status(400).json({ error: 'Missing params' });
    const result = await query(
      `SELECT e.id, e.answers, e.overall_comment, e.created_at
       FROM to_shift_report_evaluations e
       INNER JOIN to_shift_reports r ON r.id = e.shift_report_id AND r.tenant_id = @tenantId
       WHERE e.shift_report_id = @id AND e.evaluator_user_id = @userId`,
      { id, tenantId: tid, userId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.json({ evaluation: null });
    let answers = [];
    try { answers = get(row, 'answers') ? JSON.parse(get(row, 'answers')) : []; } catch (_) {}
    res.json({
      evaluation: {
        id: get(row, 'id'),
        answers,
        overall_comment: get(row, 'overall_comment'),
        created_at: get(row, 'created_at'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to get evaluation' });
  }
});

router.post('/shift-reports/:id/evaluation', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    const { id } = req.params;
    if (!tid || !id || !userId) return res.status(400).json({ error: 'Missing params' });
    const reportResult = await query(`SELECT id, status, submitted_to_user_ids FROM to_shift_reports WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: tid });
    const report = reportResult.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (get(report, 'status') !== 'pending_approval') return res.status(400).json({ error: 'Report is not pending approval' });
    let submittedTo = [];
    try { submittedTo = get(report, 'submitted_to_user_ids') ? JSON.parse(get(report, 'submitted_to_user_ids')) : []; } catch (_) {}
    const uid = String(userId);
    if (!submittedTo.some((id) => String(id) === uid)) return res.status(403).json({ error: 'You are not an approver for this report' });
    const body = req.body || {};
    const answers = Array.isArray(body.answers) ? JSON.stringify(body.answers) : null;
    const overall_comment = body.overall_comment ?? null;
    const existing = await query(`SELECT id FROM to_shift_report_evaluations WHERE shift_report_id = @id AND evaluator_user_id = @userId`, { id, tenantId: tid, userId });
    if (existing.recordset?.length > 0) {
      await query(`UPDATE to_shift_report_evaluations SET answers = @answers, overall_comment = @overall_comment WHERE shift_report_id = @id AND evaluator_user_id = @userId`, { id, userId, answers, overall_comment });
    } else {
      await query(
        `INSERT INTO to_shift_report_evaluations (shift_report_id, evaluator_user_id, answers, overall_comment) VALUES (@id, @userId, @answers, @overall_comment)`,
        { id, userId, answers, overall_comment }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to save evaluation' });
  }
});

router.patch('/shift-reports/:id/approve', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    const { id } = req.params;
    if (!tid || !id || !userId) return res.status(400).json({ error: 'Missing params' });
    const reportResult = await query(`SELECT id, status, submitted_to_user_ids FROM to_shift_reports WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: tid });
    const report = reportResult.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (get(report, 'status') !== 'pending_approval') return res.status(400).json({ error: 'Report is not pending approval' });
    let submittedTo = [];
    try { submittedTo = get(report, 'submitted_to_user_ids') ? JSON.parse(get(report, 'submitted_to_user_ids')) : []; } catch (_) {}
    if (!submittedTo.some((id) => String(id) === String(userId))) return res.status(403).json({ error: 'You are not an approver for this report' });
    const evalResult = await query(`SELECT id FROM to_shift_report_evaluations WHERE shift_report_id = @id AND evaluator_user_id = @userId`, { id, userId });
    if (!evalResult.recordset?.length) return res.status(400).json({ error: 'You must complete the evaluation before approving' });
    await query(
      `UPDATE to_shift_reports SET status = 'approved', approved_by_user_id = @userId, approved_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: tid, userId }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to approve' });
  }
});

// ---- Operations Insights (insights, recommendations, accountability) ----
function parseJson(r, key) {
  const v = get(r, key);
  if (v == null || v === '') return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; }
}
const toNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

router.get('/presentations/insights', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const dateFrom = (req.query.dateFrom || '').toString().trim();
    const dateTo = (req.query.dateTo || '').toString().trim();
    let sql = `
      SELECT id, report_date, shift, shift_summary, incidents, non_compliance_calls, investigations, active_fleet_log
      FROM to_shift_reports WHERE tenant_id = @tenantId AND status = N'approved'`;
    const params = { tenantId: tid };
    if (dateFrom) { sql += ` AND report_date >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND report_date <= @dateTo`; params.dateTo = dateTo; }
    sql += ` ORDER BY report_date ASC`;
    const result = await query(sql, params);
    const rows = result.recordset || [];

    let totalLoadsDelivered = 0;
    let totalIncidents = 0;
    let totalNonCompliance = 0;
    let totalInvestigations = 0;
    const dateMap = {};
    const reportCount = rows.length;

    for (const r of rows) {
      const dateKey = (get(r, 'report_date') || '').toString().slice(0, 10);
      const shiftSummary = parseJson(r, 'shift_summary');
      const incidents = parseJson(r, 'incidents');
      const nonCompliance = parseJson(r, 'non_compliance_calls');
      const investigations = parseJson(r, 'investigations');
      const activeFleet = parseJson(r, 'active_fleet_log');

      const delivered = shiftSummary && typeof shiftSummary === 'object' ? toNum(shiftSummary.total_loads_delivered) : null;
      const incCount = Array.isArray(incidents) ? incidents.length : 0;
      const ncCount = Array.isArray(nonCompliance) ? nonCompliance.length : 0;
      const invCount = Array.isArray(investigations) ? investigations.length : 0;

      totalLoadsDelivered += delivered || 0;
      totalIncidents += incCount;
      totalNonCompliance += ncCount;
      totalInvestigations += invCount;

      if (dateKey && !dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, report_count: 0, loads_delivered: 0, incidents: 0, non_compliance: 0 };
      if (dateKey) {
        dateMap[dateKey].report_count += 1;
        dateMap[dateKey].loads_delivered += (delivered || 0);
        dateMap[dateKey].incidents += incCount;
        dateMap[dateKey].non_compliance += ncCount;
      }
    }

    const timeSeries = Object.keys(dateMap).sort().map((k) => dateMap[k]);
    const avgDelivered = reportCount ? totalLoadsDelivered / reportCount : 0;

    const insights = [];
    if (reportCount === 0) {
      insights.push({ type: 'info', text: 'No approved shift reports in the selected period. Approve more reports to see AI insights and recommendations.' });
    } else {
      if (timeSeries.length >= 2) {
        const half = Math.floor(timeSeries.length / 2);
        const recent = timeSeries.slice(-half);
        const older = timeSeries.slice(0, half);
        const recentDelivered = recent.reduce((s, d) => s + (d.loads_delivered || 0), 0);
        const olderDelivered = older.reduce((s, d) => s + (d.loads_delivered || 0), 0);
        if (olderDelivered > 0) {
          const pct = Math.round(((recentDelivered - olderDelivered) / olderDelivered) * 100);
          if (pct > 5) insights.push({ type: 'positive', text: `Loads delivered in the recent period are ${pct}% higher than the earlier period.` });
          else if (pct < -5) insights.push({ type: 'attention', text: `Loads delivered in the recent period are ${Math.abs(pct)}% lower than the earlier period.` });
        }
      }
      if (totalIncidents > 0) {
        const avgInc = (totalIncidents / reportCount).toFixed(1);
        insights.push({ type: 'attention', text: `Across ${reportCount} approved report(s), ${totalIncidents} incident(s) were logged (avg ${avgInc} per report).` });
      }
      if (totalNonCompliance > 0) {
        insights.push({ type: 'attention', text: `${totalNonCompliance} non-compliance call(s) in the selected period. Review driver behaviour and follow-up actions.` });
      }
      if (totalInvestigations > 0) {
        insights.push({ type: 'info', text: `${totalInvestigations} investigation(s) (findings & action taken) recorded. Ensure follow-through.` });
      }
      if (avgDelivered > 0) {
        insights.push({ type: 'info', text: `Average loads delivered per shift report: ${avgDelivered.toFixed(1)}.` });
      }
      if (timeSeries.length > 0) {
        const maxDay = timeSeries.reduce((a, b) => ((b.loads_delivered || 0) > (a.loads_delivered || 0) ? b : a), timeSeries[0]);
        insights.push({ type: 'info', text: `Peak delivery day: ${maxDay.date} with ${maxDay.loads_delivered || 0} loads delivered.` });
      }
    }

    const recommendations = [];
    if (reportCount > 0) {
      if (totalIncidents > 0 && totalIncidents >= reportCount) {
        recommendations.push({ title: 'Reduce incidents and breakdowns', body: 'Incidents are occurring at or above one per report. Schedule preventive maintenance, review driver briefings, and track repeat issues by truck/driver.', priority: 'action', source: 'rule_based' });
      }
      if (totalNonCompliance > 0) {
        recommendations.push({ title: 'Address non-compliance systematically', body: 'Non-compliance calls were recorded. Assign owners to each case, document actions taken, and follow up on driver responses to prevent recurrence.', priority: 'action', source: 'rule_based' });
      }
      if (timeSeries.length >= 2) {
        const recent = timeSeries.slice(-Math.min(3, timeSeries.length));
        const older = timeSeries.slice(0, Math.max(0, timeSeries.length - recent.length));
        const recentDelivered = recent.reduce((s, d) => s + (d.loads_delivered || 0), 0);
        const olderDelivered = older.reduce((s, d) => s + (d.loads_delivered || 0), 0);
        if (olderDelivered > 0 && (recentDelivered - olderDelivered) / olderDelivered < -0.05) {
          recommendations.push({ title: 'Improve delivery performance', body: 'Delivery volumes have dropped compared to the earlier period. Review routes, loading times, and target-miss reasons in Active Fleet Log; assign accountability for corrective action.', priority: 'advice', source: 'rule_based' });
        }
      }
      recommendations.push({ title: 'Review handover notes regularly', body: 'Ensure controllers read and act on notes for next controller. Include handover items in shift briefings.', priority: 'advice', source: 'rule_based' });
      recommendations.push({ title: 'Use communication log for audit trail', body: 'Keep communication log up to date (calls, WhatsApp, escalations) so management can trace decisions and follow-ups.', priority: 'advice', source: 'rule_based' });
    }

    const summary = {
      report_count: reportCount,
      total_loads_delivered: totalLoadsDelivered,
      total_incidents: totalIncidents,
      total_non_compliance: totalNonCompliance,
      total_investigations: totalInvestigations,
      avg_loads_delivered_per_report: reportCount ? Math.round((totalLoadsDelivered / reportCount) * 10) / 10 : 0,
    };

    res.json({ insights, recommendations, summary, timeSeries });
  } catch (err) {
    console.error('Presentations insights error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate insights' });
  }
});

/** GET PowerPoint presentation of production data. Query: dateFrom, dateTo, shift (optional). */
router.get('/presentations/pptx', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const dateFrom = (req.query.dateFrom || '').toString().trim();
    const dateTo = (req.query.dateTo || '').toString().trim();
    const shiftFilter = (req.query.shift || '').toString().trim();

    let sql = `
      SELECT id, report_date, shift, shift_summary, incidents, non_compliance_calls, investigations, active_fleet_log, communication_log
      FROM to_shift_reports WHERE tenant_id = @tenantId AND status = N'approved'`;
    const params = { tenantId: tid };
    if (dateFrom) { sql += ` AND report_date >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND report_date <= @dateTo`; params.dateTo = dateTo; }
    if (shiftFilter) { sql += ` AND LTRIM(RTRIM(ISNULL(shift, N''))) = @shift`; params.shift = shiftFilter; }
    sql += ` ORDER BY report_date ASC, shift ASC`;
    const result = await query(sql, params);
    const rows = result.recordset || [];

    const routesResult = await query(`SELECT id, name FROM to_routes WHERE tenant_id = @tenantId`, { tenantId: tid });
    const routeNames = {};
    (routesResult.recordset || []).forEach((row) => { routeNames[get(row, 'id')] = get(row, 'name') || 'Unnamed route'; });

    let totalLoadsDelivered = 0;
    let totalIncidents = 0;
    let totalNonCompliance = 0;
    let totalInvestigations = 0;
    let totalComms = 0;
    const dateMap = {};
    const shiftMap = {};
    const routeMap = {};
    const incidentsList = [];
    const nonComplianceList = [];
    const investigationsList = [];

    for (const r of rows) {
      const dateKey = (get(r, 'report_date') || '').toString().slice(0, 10);
      const shiftName = (get(r, 'shift') || 'Unspecified').toString().trim() || 'Unspecified';
      const shiftSummary = parseJson(r, 'shift_summary');
      const incidents = parseJson(r, 'incidents');
      const nonCompliance = parseJson(r, 'non_compliance_calls');
      const investigations = parseJson(r, 'investigations');
      const activeFleet = parseJson(r, 'active_fleet_log');
      const comms = parseJson(r, 'communication_log');

      const delivered = shiftSummary && typeof shiftSummary === 'object' ? toNum(shiftSummary.total_loads_delivered) : null;
      const incCount = Array.isArray(incidents) ? incidents.length : 0;
      const ncCount = Array.isArray(nonCompliance) ? nonCompliance.length : 0;
      const invCount = Array.isArray(investigations) ? investigations.length : 0;
      const commCount = Array.isArray(comms) ? comms.length : 0;

      totalLoadsDelivered += delivered || 0;
      totalIncidents += incCount;
      totalNonCompliance += ncCount;
      totalInvestigations += invCount;
      totalComms += commCount;

      if (Array.isArray(incidents)) {
        incidents.forEach((i) => {
          incidentsList.push({
            report_date: dateKey,
            shift: shiftName,
            truck_reg: i.truck_reg || '—',
            driver_name: i.driver_name || '—',
            issue: i.issue || '—',
            status: i.status || '—',
            time_reported: i.time_reported || '—',
          });
        });
      }
      if (Array.isArray(nonCompliance)) {
        nonCompliance.forEach((n) => {
          nonComplianceList.push({
            report_date: dateKey,
            shift: shiftName,
            driver_name: n.driver_name || '—',
            truck_reg: n.truck_reg || '—',
            rule_violated: n.rule_violated || '—',
            time_of_call: n.time_of_call || '—',
            summary: (n.summary || '').toString().slice(0, 80),
          });
        });
      }
      if (Array.isArray(investigations)) {
        investigations.forEach((inv) => {
          investigationsList.push({
            report_date: dateKey,
            shift: shiftName,
            truck_reg: inv.truck_reg || '—',
            time: inv.time || '—',
            location: (inv.location || '—').toString().slice(0, 40),
            issue_identified: (inv.issue_identified || '—').toString().slice(0, 60),
            findings: (inv.findings || '').toString().slice(0, 100),
            action_taken: (inv.action_taken || '').toString().slice(0, 100),
          });
        });
      }
      if (Array.isArray(activeFleet)) {
        activeFleet.forEach((row) => {
          const routeId = row.route_id || row.route || '';
          const rName = routeId ? (routeNames[routeId] || `Route ${routeId}`) : 'Unspecified';
          if (!routeMap[rName]) routeMap[rName] = { route: rName, trip_count: 0, loads_delivered: 0 };
          routeMap[rName].trip_count += 1;
          const d = toNum(row.deliveries_completed) ?? toNum(row.quantity_loaded);
          routeMap[rName].loads_delivered += d || 0;
        });
      }

      if (dateKey && !dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, report_count: 0, loads_delivered: 0, incidents: 0, non_compliance: 0 };
      if (dateKey) {
        dateMap[dateKey].report_count += 1;
        dateMap[dateKey].loads_delivered += (delivered || 0);
        dateMap[dateKey].incidents += incCount;
        dateMap[dateKey].non_compliance += ncCount;
      }

      if (!shiftMap[shiftName]) shiftMap[shiftName] = { shift: shiftName, report_count: 0, loads_delivered: 0 };
      shiftMap[shiftName].report_count += 1;
      shiftMap[shiftName].loads_delivered += (delivered || 0);
    }

    const timeSeries = Object.keys(dateMap).sort().map((k) => dateMap[k]);
    const byShift = Object.values(shiftMap).sort((a, b) => (b.report_count - a.report_count));
    const byRoute = Object.values(routeMap).sort((a, b) => (b.trip_count - a.trip_count));
    const reportCount = rows.length;
    const summary = {
      report_count: reportCount,
      total_loads_delivered: totalLoadsDelivered,
      total_incidents: totalIncidents,
      total_non_compliance: totalNonCompliance,
      total_investigations: totalInvestigations,
      total_communications: totalComms,
    };

    const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tid`, { tid });
    const tenantName = tenantRow.recordset?.[0]?.name || '';

    const raw = await buildTransportOpsPresentationPptx({
      title: 'Production Report',
      tenantName,
      dateFrom,
      dateTo,
      summary,
      timeSeries,
      byShift,
      byRoute,
      incidentsList,
      nonComplianceList,
      investigationsList,
    });

    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    if (buffer.length === 0) {
      return res.status(500).json({ error: 'Failed to generate presentation' });
    }
    const filename = `production-report-${dateFrom || 'from'}-${dateTo || 'to'}.pptx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    console.error('Presentations PPTX error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate PowerPoint' });
  }
});

router.get('/presentations/recommendations', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const statusFilter = (req.query.status || '').toString().trim().toLowerCase();
    let sql = `
      SELECT r.id, r.tenant_id, r.title, r.body, r.priority, r.assigned_to_user_id, r.status, r.applied_at, r.applied_by_user_id, r.due_by, r.created_at, r.source,
             u.full_name AS assigned_to_name, u.email AS assigned_to_email,
             a.full_name AS applied_by_name
      FROM to_operation_recommendations r
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      LEFT JOIN users a ON a.id = r.applied_by_user_id
      WHERE r.tenant_id = @tenantId`;
    const params = { tenantId: tid };
    if (statusFilter && ['pending', 'applied', 'dismissed'].includes(statusFilter)) {
      sql += ` AND r.status = @status`;
      params.status = statusFilter;
    }
    sql += ` ORDER BY r.created_at DESC`;
    const result = await query(sql, params);
    const list = (result.recordset || []).map((row) => ({
      id: get(row, 'id'),
      tenant_id: get(row, 'tenant_id'),
      title: get(row, 'title'),
      body: get(row, 'body'),
      priority: get(row, 'priority') || 'advice',
      assigned_to_user_id: get(row, 'assigned_to_user_id'),
      assigned_to_name: get(row, 'assigned_to_name'),
      assigned_to_email: get(row, 'assigned_to_email'),
      status: get(row, 'status') || 'pending',
      applied_at: get(row, 'applied_at'),
      applied_by_user_id: get(row, 'applied_by_user_id'),
      applied_by_name: get(row, 'applied_by_name'),
      due_by: get(row, 'due_by'),
      created_at: get(row, 'created_at'),
      source: get(row, 'source') || 'rule_based',
    }));
    res.json({ recommendations: list });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list recommendations' });
  }
});

router.post('/presentations/recommendations', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    const title = (body.title || '').toString().trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const recBody = (body.body || '').toString().trim();
    const priority = ['info', 'advice', 'action'].includes((body.priority || '').toString().toLowerCase()) ? (body.priority || 'advice').toString().toLowerCase() : 'advice';
    const assignedTo = body.assigned_to_user_id || null;
    const dueBy = body.due_by || null;
    const source = (body.source || 'rule_based').toString().trim().slice(0, 50) || 'rule_based';

    await query(
      `INSERT INTO to_operation_recommendations (tenant_id, title, body, priority, assigned_to_user_id, due_by, source)
       VALUES (@tenantId, @title, @body, @priority, @assignedTo, @dueBy, @source)`,
      { tenantId: tid, title, body: recBody || null, priority, assignedTo: assignedTo || null, dueBy: dueBy || null, source }
    );
    const result = await query(
      `SELECT TOP 1 id, title, body, priority, assigned_to_user_id, status, due_by, created_at, source
       FROM to_operation_recommendations WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
      { tenantId: tid }
    );
    const row = result.recordset?.[0];
    const created = row ? {
      id: get(row, 'id'),
      title: get(row, 'title'),
      body: get(row, 'body'),
      priority: get(row, 'priority'),
      assigned_to_user_id: get(row, 'assigned_to_user_id'),
      status: get(row, 'status'),
      due_by: get(row, 'due_by'),
      created_at: get(row, 'created_at'),
      source: get(row, 'source'),
    } : null;
    res.status(201).json({ recommendation: created });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to create recommendation' });
  }
});

router.patch('/presentations/recommendations/:id', async (req, res) => {
  try {
    const tid = tenantId(req);
    const userId = req.user?.id;
    const { id } = req.params;
    if (!tid || !id) return res.status(400).json({ error: 'Missing params' });
    const body = req.body || {};
    const updates = [];
    const params = { id, tenantId: tid };

    if (body.status !== undefined) {
      const status = (body.status || '').toString().toLowerCase();
      if (['pending', 'applied', 'dismissed'].includes(status)) {
        updates.push('status = @status');
        params.status = status;
        if (status === 'applied') {
          updates.push('applied_at = SYSUTCDATETIME()');
          updates.push('applied_by_user_id = @appliedBy');
          params.appliedBy = userId;
        }
      }
    }
    if (body.assigned_to_user_id !== undefined) {
      updates.push('assigned_to_user_id = @assignedTo');
      params.assignedTo = body.assigned_to_user_id || null;
    }
    if (body.due_by !== undefined) {
      updates.push('due_by = @dueBy');
      params.dueBy = body.due_by || null;
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

    await query(
      `UPDATE to_operation_recommendations SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const result = await query(
      `SELECT r.id, r.title, r.body, r.priority, r.assigned_to_user_id, r.status, r.applied_at, r.applied_by_user_id, r.due_by, r.created_at, r.source,
              u.full_name AS assigned_to_name, a.full_name AS applied_by_name
       FROM to_operation_recommendations r
       LEFT JOIN users u ON u.id = r.assigned_to_user_id
       LEFT JOIN users a ON a.id = r.applied_by_user_id
       WHERE r.id = @id AND r.tenant_id = @tenantId`,
      { id, tenantId: tid }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Recommendation not found' });
    res.json({
      recommendation: {
        id: get(row, 'id'),
        title: get(row, 'title'),
        body: get(row, 'body'),
        priority: get(row, 'priority'),
        assigned_to_user_id: get(row, 'assigned_to_user_id'),
        assigned_to_name: get(row, 'assigned_to_name'),
        status: get(row, 'status'),
        applied_at: get(row, 'applied_at'),
        applied_by_user_id: get(row, 'applied_by_user_id'),
        applied_by_name: get(row, 'applied_by_name'),
        due_by: get(row, 'due_by'),
        created_at: get(row, 'created_at'),
        source: get(row, 'source'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to update recommendation' });
  }
});

/** Save generated recommendations from insights into DB so they can be assigned and tracked. */
router.post('/presentations/insights/save-recommendations', async (req, res) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant' });
    const list = Array.isArray(req.body?.recommendations) ? req.body.recommendations : [];
    const saved = [];
    for (const rec of list) {
      const title = (rec.title || '').toString().trim();
      if (!title) continue;
      const body = (rec.body || '').toString().trim();
      const priority = ['info', 'advice', 'action'].includes((rec.priority || '').toString().toLowerCase()) ? (rec.priority || 'advice').toString().toLowerCase() : 'advice';
      await query(
        `INSERT INTO to_operation_recommendations (tenant_id, title, body, priority, source) VALUES (@tenantId, @title, @body, @priority, @source)`,
        { tenantId: tid, title, body: body || null, priority, source: (rec.source || 'rule_based').toString().slice(0, 50) || 'rule_based' }
      );
      const result = await query(`SELECT TOP 1 id, title, created_at FROM to_operation_recommendations WHERE tenant_id = @tenantId ORDER BY created_at DESC`, { tenantId: tid });
      const row = result.recordset?.[0];
      if (row) saved.push({ id: get(row, 'id'), title: get(row, 'title'), created_at: get(row, 'created_at') });
    }
    res.json({ saved, count: saved.length });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to save recommendations' });
  }
});

export default router;
