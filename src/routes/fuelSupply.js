import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';
import { sendEmail } from '../lib/emailService.js';

const router = Router();

export const FS_TAB_IDS = [
  'dashboard',
  'administration',
  'supply_activities',
  'activity_log',
  'delivery_vehicle_log_book',
  'delivery_management',
  'reconciliations',
  'production_vs_expenses',
];

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

const uploadsRoot = path.join(process.cwd(), 'uploads', 'fuel-supply');
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(uploadsRoot, String(req.user?.id || 'anon'));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.jpg';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('receipt');

const tripStopUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(uploadsRoot, 'trips', String(req.user?.id || 'anon'));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.jpg';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).fields([
  { name: 'gauge_photo', maxCount: 1 },
  { name: 'slip_photo', maxCount: 1 },
]);

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('fuel_supply_management'));

async function insertEvent({ tenantId, eventType, orderId, title, message }) {
  try {
    await query(
      `INSERT INTO fuel_supply_events (tenant_id, event_type, order_id, title, message)
       VALUES (@tenantId, @eventType, @orderId, @title, @message)`,
      {
        tenantId: tenantId || null,
        eventType,
        orderId: orderId || null,
        title: title || '',
        message: message || null,
      }
    );
  } catch (_) {
    /* table may not exist yet */
  }
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    created_by_user_id: get(row, 'created_by_user_id'),
    status: get(row, 'status'),
    depot_name: get(row, 'depot_name'),
    depot_address: get(row, 'depot_address'),
    supplier_code: get(row, 'supplier_code'),
    driver_name: get(row, 'driver_name'),
    driver_employee_number: get(row, 'driver_employee_number'),
    delivery_site_name: get(row, 'delivery_site_name'),
    delivery_site_address: get(row, 'delivery_site_address'),
    site_responsible_name: get(row, 'site_responsible_name'),
    site_responsible_phone: get(row, 'site_responsible_phone'),
    site_responsible_email: get(row, 'site_responsible_email'),
    site_responsible_role: get(row, 'site_responsible_role'),
    expected_liters: get(row, 'expected_liters') != null ? Number(get(row, 'expected_liters')) : null,
    notes: get(row, 'notes'),
    prior_order_id: get(row, 'prior_order_id') || null,
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getUserEmailById(userId) {
  const r = await query(`SELECT email, full_name FROM users WHERE id = @id`, { id: userId });
  const row = r.recordset?.[0];
  if (!row) return null;
  return { email: get(row, 'email'), full_name: get(row, 'full_name') };
}

async function notifyCustomerDieselEmail(to, subject, messageHtml) {
  if (!to) return;
  try {
    await sendEmail({ to, subject, body: messageHtml, html: true });
  } catch (e) {
    console.warn('Customer diesel email failed:', e.message);
  }
}

function mapCustomerRequestAdmin(row) {
  const orderStatus = get(row, 'order_status_join');
  const st = get(row, 'status');
  let portal_code = 'pending_admin';
  let portal_label = 'Awaiting administration';
  if (st === 'rejected') {
    portal_code = 'rejected';
    portal_label = 'Rejected';
  } else if (st === 'approved' && orderStatus === 'delivered') {
    portal_code = 'delivered';
    portal_label = 'Delivered';
  } else if (st === 'approved' && orderStatus === 'reconciled') {
    portal_code = 'reconciled';
    portal_label = 'Delivered (reconciled)';
  } else if (st === 'approved') {
    portal_code = 'in_progress';
    portal_label = 'Approved — in progress';
  }
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    requesting_user_id: get(row, 'requesting_user_id'),
    requester_name: get(row, 'requester_name') || null,
    requester_email: get(row, 'requester_email') || null,
    liters_required: get(row, 'liters_required') != null ? Number(get(row, 'liters_required')) : null,
    priority: get(row, 'priority'),
    due_date: get(row, 'due_date'),
    request_type: get(row, 'request_type'),
    delivery_site_name: get(row, 'delivery_site_name'),
    delivery_site_address: get(row, 'delivery_site_address'),
    site_responsible_name: get(row, 'site_responsible_name'),
    site_responsible_phone: get(row, 'site_responsible_phone'),
    site_responsible_email: get(row, 'site_responsible_email'),
    customer_notes: get(row, 'customer_notes'),
    status: st,
    diesel_order_id: get(row, 'diesel_order_id'),
    order_status: orderStatus ?? null,
    portal_status: portal_code,
    portal_status_label: portal_label,
    rejection_reason: get(row, 'rejection_reason'),
    admin_notes: get(row, 'admin_notes'),
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

/** GET my allowed tabs */
router.get('/my-tabs', async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.json({ tabs: FS_TAB_IDS });
    }
    const result = await query(
      `SELECT tab_id FROM fuel_supply_grants WHERE user_id = @userId`,
      { userId: req.user.id }
    );
    const tabs = (result.recordset || []).map((r) => r.tab_id).filter((id) => FS_TAB_IDS.includes(id));
    res.json({ tabs });
  } catch (err) {
    next(err);
  }
});

/** Permissions (super_admin) */
router.get('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.user_id, g.tab_id, g.granted_at, u.full_name, u.email
       FROM fuel_supply_grants g
       JOIN users u ON u.id = g.user_id
       ORDER BY u.full_name, g.tab_id`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      if (!byUser[row.user_id]) {
        byUser[row.user_id] = { user_id: row.user_id, full_name: row.full_name, email: row.email, tabs: [] };
      }
      byUser[row.user_id].tabs.push(row.tab_id);
    }
    res.json({ permissions: Object.values(byUser), allTabIds: FS_TAB_IDS });
  } catch (err) {
    next(err);
  }
});

router.post('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.body || {};
    if (!user_id || !tab_id || !FS_TAB_IDS.includes(tab_id)) {
      return res.status(400).json({ error: 'user_id and valid tab_id required' });
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM fuel_supply_grants WHERE user_id = @userId AND tab_id = @tabId)
       INSERT INTO fuel_supply_grants (user_id, tab_id, granted_by_user_id) VALUES (@userId, @tabId, @grantedBy)`,
      { userId: user_id, tabId: tab_id, grantedBy: req.user.id }
    );
    res.status(201).json({ granted: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.query;
    if (!user_id || !tab_id) return res.status(400).json({ error: 'user_id and tab_id required' });
    await query(`DELETE FROM fuel_supply_grants WHERE user_id = @userId AND tab_id = @tabId`, {
      userId: user_id,
      tabId: tab_id,
    });
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

/** Recent alerts / events */
router.get('/events', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenant_id;
    let sql = `SELECT TOP (@limit) * FROM fuel_supply_events WHERE 1=1`;
    const params = { limit };
    if (tenantId) {
      sql += ` AND (tenant_id = @tenantId OR tenant_id IS NULL)`;
      params.tenantId = tenantId;
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, params);
    res.json({ events: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** List orders */
router.get('/orders', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    let sql = `SELECT * FROM fuel_diesel_orders WHERE 1=1`;
    const params = {};
    if (tenantId) {
      sql += ` AND tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, params);
    res.json({ orders: (result.recordset || []).map(mapOrder) });
  } catch (err) {
    next(err);
  }
});

/** Single order with related */
router.get('/orders/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    const order = r.recordset?.[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const mapped = mapOrder(order);
    if (req.user.role !== 'super_admin' && mapped.tenant_id && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [acts, dels, recons] = await Promise.all([
      query(`SELECT * FROM fuel_supply_activities WHERE order_id = @id ORDER BY created_at DESC`, { id: req.params.id }),
      query(`SELECT * FROM fuel_deliveries WHERE order_id = @id ORDER BY delivered_at DESC`, { id: req.params.id }),
      query(`SELECT * FROM fuel_reconciliations WHERE order_id = @id ORDER BY created_at DESC`, { id: req.params.id }),
    ]);
    res.json({
      order: mapped,
      activities: acts.recordset || [],
      deliveries: dels.recordset || [],
      reconciliations: recons.recordset || [],
    });
  } catch (err) {
    next(err);
  }
});

/** Create order */
router.post('/orders', async (req, res, next) => {
  try {
    const b = req.body || {};
    const tenantId = req.user.tenant_id || null;
    const required = ['depot_name', 'depot_address', 'supplier_code', 'driver_name', 'driver_employee_number', 'delivery_site_name', 'delivery_site_address', 'site_responsible_name'];
    for (const k of required) {
      if (!String(b[k] || '').trim()) return res.status(400).json({ error: `${k} required` });
    }
    const id = randomUUID();
    await query(
      `INSERT INTO fuel_diesel_orders (
        id, tenant_id, created_by_user_id, status,
        depot_name, depot_address, supplier_code,
        driver_name, driver_employee_number,
        delivery_site_name, delivery_site_address,
        site_responsible_name, site_responsible_phone, site_responsible_email, site_responsible_role,
        expected_liters, notes
      ) VALUES (
        @id, @tenantId, @uid, @status,
        @depot_name, @depot_address, @supplier_code,
        @driver_name, @driver_employee_number,
        @delivery_site_name, @delivery_site_address,
        @site_responsible_name, @site_responsible_phone, @site_responsible_email, @site_responsible_role,
        @expected_liters, @notes
      )`,
      {
        id,
        tenantId,
        uid: req.user.id,
        status: b.status && String(b.status).trim() ? String(b.status).trim() : 'active',
        depot_name: String(b.depot_name).trim(),
        depot_address: String(b.depot_address).trim(),
        supplier_code: String(b.supplier_code).trim(),
        driver_name: String(b.driver_name).trim(),
        driver_employee_number: String(b.driver_employee_number).trim(),
        delivery_site_name: String(b.delivery_site_name).trim(),
        delivery_site_address: String(b.delivery_site_address).trim(),
        site_responsible_name: String(b.site_responsible_name).trim(),
        site_responsible_phone: b.site_responsible_phone ? String(b.site_responsible_phone).trim() : null,
        site_responsible_email: b.site_responsible_email ? String(b.site_responsible_email).trim() : null,
        site_responsible_role: b.site_responsible_role ? String(b.site_responsible_role).trim() : null,
        expected_liters: b.expected_liters != null && b.expected_liters !== '' ? Number(b.expected_liters) : null,
        notes: b.notes ? String(b.notes) : null,
      }
    );
    const get = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id });
    res.status(201).json({ order: mapOrder(get.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/orders/:id', async (req, res, next) => {
  try {
    const cur = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const mapped = mapOrder(row);
    if (req.user.role !== 'super_admin' && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id };
    const fields = [
      'status', 'depot_name', 'depot_address', 'supplier_code', 'driver_name', 'driver_employee_number',
      'delivery_site_name', 'delivery_site_address', 'site_responsible_name', 'site_responsible_phone',
      'site_responsible_email', 'site_responsible_role', 'expected_liters', 'notes',
    ];
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f} = @${f}`);
        if (f === 'expected_liters') params[f] = b[f] === null || b[f] === '' ? null : Number(b[f]);
        else params[f] = b[f] == null ? null : String(b[f]);
      }
    }
    if (sets.length === 0) return res.json({ order: mapped });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE fuel_diesel_orders SET ${sets.join(', ')} WHERE id = @id`, params);
    const again = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    res.json({ order: mapOrder(again.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

/** Reorder: same depot/site/supplier/driver — new mine order quantity only */
router.post('/orders/:id/reorder', async (req, res, next) => {
  try {
    const cur = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Order not found' });
    const mapped = mapOrder(row);
    if (req.user.role !== 'super_admin' && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const liters = b.expected_liters != null && b.expected_liters !== '' ? Number(b.expected_liters) : NaN;
    if (Number.isNaN(liters) || liters <= 0) return res.status(400).json({ error: 'expected_liters required' });
    const newId = randomUUID();
    const noteExtra = b.notes != null && String(b.notes).trim() ? String(b.notes).trim() : null;
    const mergedNotes = [mapped.notes, noteExtra ? `Reorder note: ${noteExtra}` : null].filter(Boolean).join('\n') || null;
    await query(
      `INSERT INTO fuel_diesel_orders (
        id, tenant_id, created_by_user_id, status, prior_order_id,
        depot_name, depot_address, supplier_code,
        driver_name, driver_employee_number,
        delivery_site_name, delivery_site_address,
        site_responsible_name, site_responsible_phone, site_responsible_email, site_responsible_role,
        expected_liters, notes
      ) VALUES (
        @id, @tenantId, @uid, N'active', @priorId,
        @depot_name, @depot_address, @supplier_code,
        @driver_name, @driver_employee_number,
        @delivery_site_name, @delivery_site_address,
        @site_responsible_name, @site_responsible_phone, @site_responsible_email, @site_responsible_role,
        @expected_liters, @notes
      )`,
      {
        id: newId,
        tenantId: mapped.tenant_id,
        uid: req.user.id,
        priorId: req.params.id,
        depot_name: mapped.depot_name,
        depot_address: mapped.depot_address,
        supplier_code: mapped.supplier_code,
        driver_name: mapped.driver_name,
        driver_employee_number: mapped.driver_employee_number,
        delivery_site_name: mapped.delivery_site_name,
        delivery_site_address: mapped.delivery_site_address,
        site_responsible_name: mapped.site_responsible_name,
        site_responsible_phone: mapped.site_responsible_phone || null,
        site_responsible_email: mapped.site_responsible_email || null,
        site_responsible_role: mapped.site_responsible_role || null,
        expected_liters: liters,
        notes: mergedNotes,
      }
    );
    const get = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: newId });
    res.status(201).json({ order: mapOrder(get.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

/** Activity */
router.post('/orders/:id/activities', async (req, res, next) => {
  try {
    const orderR = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    const order = orderR.recordset?.[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const mapped = mapOrder(order);
    if (req.user.role !== 'super_admin' && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const activityType = String(b.activity_type || b.activityType || 'other').trim();
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = randomUUID();
    const loc = b.location_label ? String(b.location_label).trim() : null;
    const odo = b.odometer_km != null && b.odometer_km !== '' ? Number(b.odometer_km) : null;
    const dur = b.duration_minutes != null && b.duration_minutes !== '' ? parseInt(b.duration_minutes, 10) : null;
    const tags = b.tags ? String(b.tags).trim() : null;
    await query(
      `INSERT INTO fuel_supply_activities (
        id, order_id, activity_type, title, notes, liters_related, created_by_user_id,
        location_label, odometer_km, duration_minutes, tags
      ) VALUES (
        @id, @orderId, @activityType, @title, @notes, @liters, @uid,
        @loc, @odo, @dur, @tags
      )`,
      {
        id,
        orderId: req.params.id,
        activityType,
        title,
        notes: b.notes ? String(b.notes) : null,
        liters: b.liters_related != null ? Number(b.liters_related) : null,
        uid: req.user.id,
        loc,
        odo: Number.isNaN(odo) ? null : odo,
        dur: Number.isNaN(dur) ? null : dur,
        tags,
      }
    );
    const label = `${mapped.depot_name || 'Depot'} → ${mapped.delivery_site_name || 'Site'}`;
    if (activityType === 'collected' || activityType === 'collection') {
      await insertEvent({
        tenantId: mapped.tenant_id,
        eventType: 'collection',
        orderId: req.params.id,
        title: `Diesel collected — ${label}`,
        message: title,
      });
    }
    const get = await query(`SELECT * FROM fuel_supply_activities WHERE id = @id`, { id });
    res.status(201).json({ activity: get.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** Delivery with receipt */
router.post('/orders/:id/deliveries', (req, res, next) => {
  receiptUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const orderR = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
      const order = orderR.recordset?.[0];
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const mapped = mapOrder(order);
      if (req.user.role !== 'super_admin' && mapped.tenant_id !== req.user.tenant_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!req.file) return res.status(400).json({ error: 'receipt file required' });
      const liters = Number(req.body.liters_delivered || req.body.litersDelivered);
      if (Number.isNaN(liters) || liters <= 0) return res.status(400).json({ error: 'liters_delivered required' });
      const acceptedBy = String(req.body.accepted_by_name || req.body.acceptedByName || '').trim();
      const filledInto = String(req.body.filled_into_description || req.body.filledIntoDescription || '').trim();
      if (!acceptedBy || !filledInto) return res.status(400).json({ error: 'accepted_by_name and filled_into_description required' });
      const deliveredAt = req.body.delivered_at || req.body.deliveredAt || new Date().toISOString();
      const vehicleRefs = req.body.vehicle_references || req.body.vehicleReferences || '';
      const relPath = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
      const id = randomUUID();
      await query(
        `INSERT INTO fuel_deliveries (
          id, order_id, liters_delivered, receipt_stored_path, receipt_original_name,
          accepted_by_name, filled_into_description, vehicle_references, delivered_at, created_by_user_id
        ) VALUES (
          @id, @orderId, @liters, @path, @orig,
          @acceptedBy, @filledInto, @vehicles, @deliveredAt, @uid
        )`,
        {
          id,
          orderId: req.params.id,
          liters,
          path: relPath,
          orig: req.file.originalname || null,
          acceptedBy,
          filledInto,
          vehicles: typeof vehicleRefs === 'string' ? vehicleRefs : JSON.stringify(vehicleRefs),
          deliveredAt: new Date(deliveredAt).toISOString(),
          uid: req.user.id,
        }
      );
      await query(`UPDATE fuel_diesel_orders SET status = N'delivered', updated_at = SYSUTCDATETIME() WHERE id = @id`, {
        id: req.params.id,
      });
      await insertEvent({
        tenantId: mapped.tenant_id,
        eventType: 'delivery',
        orderId: req.params.id,
        title: `Diesel delivered — ${liters} L — ${mapped.delivery_site_name || 'site'}`,
        message: `Accepted by ${acceptedBy}. ${filledInto}`,
      });
      try {
        const custReqQ = await query(
          `SELECT requesting_user_id, delivery_site_name FROM fuel_customer_diesel_requests WHERE diesel_order_id = @oid`,
          { oid: req.params.id }
        );
        const crd = custReqQ.recordset?.[0];
        if (crd) {
          const uid = get(crd, 'requesting_user_id');
          const u = await getUserEmailById(uid);
          if (u?.email) {
            const site = mapped.delivery_site_name || get(crd, 'delivery_site_name') || 'your site';
            await notifyCustomerDieselEmail(
              u.email,
              'Your diesel delivery was completed',
              `<p>Hello ${escapeHtml(u.full_name || 'there')},</p>
              <p>Your diesel order for <strong>${escapeHtml(site)}</strong> has been marked as <strong>delivered</strong>.</p>
              <p>Delivered volume: <strong>${escapeHtml(String(liters))} L</strong>.</p>`
            );
          }
        }
      } catch (_) {
        /* optional notify */
      }
      const get = await query(`SELECT * FROM fuel_deliveries WHERE id = @id`, { id });
      res.status(201).json({ delivery: get.recordset[0] });
    } catch (e) {
      next(e);
    }
  });
});

/** Receipt file */
router.get('/deliveries/:id/receipt', async (req, res, next) => {
  try {
    const r = await query(`SELECT d.*, o.tenant_id AS order_tenant FROM fuel_deliveries d JOIN fuel_diesel_orders o ON o.id = d.order_id WHERE d.id = @id`, {
      id: req.params.id,
    });
    const d = r.recordset?.[0];
    if (!d) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'super_admin' && d.order_tenant && d.order_tenant !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const abs = path.resolve(process.cwd(), d.receipt_stored_path);
    const rootResolved = path.resolve(uploadsRoot);
    if (!abs.startsWith(rootResolved)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

/** Reconciliation */
router.post('/orders/:id/reconciliations', async (req, res, next) => {
  try {
    const orderR = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: req.params.id });
    const order = orderR.recordset?.[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const mapped = mapOrder(order);
    if (req.user.role !== 'super_admin' && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const invRef = String(b.invoice_reference || b.invoiceReference || '').trim();
    const amount = Number(b.invoice_amount ?? b.invoiceAmount);
    if (!invRef || Number.isNaN(amount)) return res.status(400).json({ error: 'invoice_reference and invoice_amount required' });
    const id = randomUUID();
    await query(
      `INSERT INTO fuel_reconciliations (
        id, order_id, invoice_reference, invoice_amount, handling_fee, payment_status, payment_date, payment_reference, notes, created_by_user_id
      ) VALUES (
        @id, @orderId, @invRef, @amount, @fee, @payStatus, @payDate, @payRef, @notes, @uid
      )`,
      {
        id,
        orderId: req.params.id,
        invRef,
        amount,
        fee: b.handling_fee != null && b.handling_fee !== '' ? Number(b.handling_fee) : null,
        payStatus: String(b.payment_status || b.paymentStatus || 'pending').trim(),
        payDate: b.payment_date || b.paymentDate || null,
        payRef: b.payment_reference || b.paymentReference || null,
        notes: b.notes ? String(b.notes) : null,
        uid: req.user.id,
      }
    );
    await query(`UPDATE fuel_diesel_orders SET status = N'reconciled', updated_at = SYSUTCDATETIME() WHERE id = @id`, {
      id: req.params.id,
    });
    const get = await query(`SELECT * FROM fuel_reconciliations WHERE id = @id`, { id });
    res.status(201).json({ reconciliation: get.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/reconciliations/:id', async (req, res, next) => {
  try {
    const cur = await query(
      `SELECT r.*, o.tenant_id AS order_tenant FROM fuel_reconciliations r JOIN fuel_diesel_orders o ON o.id = r.order_id WHERE r.id = @id`,
      { id: req.params.id }
    );
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const orderTenant = get(row, 'order_tenant');
    if (req.user.role !== 'super_admin' && orderTenant !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id };
    if (b.invoice_reference !== undefined) {
      sets.push('invoice_reference = @invoice_reference');
      params.invoice_reference = String(b.invoice_reference);
    }
    if (b.invoice_amount !== undefined) {
      sets.push('invoice_amount = @invoice_amount');
      params.invoice_amount = Number(b.invoice_amount);
    }
    if (b.handling_fee !== undefined) {
      sets.push('handling_fee = @handling_fee');
      params.handling_fee = b.handling_fee === null || b.handling_fee === '' ? null : Number(b.handling_fee);
    }
    if (b.payment_status !== undefined) {
      sets.push('payment_status = @payment_status');
      params.payment_status = String(b.payment_status);
    }
    if (b.payment_date !== undefined) {
      sets.push('payment_date = @payment_date');
      params.payment_date = b.payment_date || null;
    }
    if (b.payment_reference !== undefined) {
      sets.push('payment_reference = @payment_reference');
      params.payment_reference = b.payment_reference || null;
    }
    if (b.notes !== undefined) {
      sets.push('notes = @notes');
      params.notes = b.notes || null;
    }
    if (sets.length === 0) return res.json({ reconciliation: row });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE fuel_reconciliations SET ${sets.join(', ')} WHERE id = @id`, params);
    const again = await query(`SELECT * FROM fuel_reconciliations WHERE id = @id`, { id: req.params.id });
    res.json({ reconciliation: again.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** Activities with filters (tenant-scoped) */
router.get('/activities', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    const top = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 250));
    let sql = `
      SELECT TOP (@top) a.*, o.depot_name, o.delivery_site_name, o.driver_name, o.driver_employee_number, o.supplier_code
      FROM fuel_supply_activities a
      INNER JOIN fuel_diesel_orders o ON o.id = a.order_id
      WHERE 1=1`;
    const params = { top };
    if (tenantId) {
      sql += ` AND o.tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    if (req.query.from) {
      sql += ` AND a.created_at >= @fromDt`;
      params.fromDt = new Date(req.query.from);
    }
    if (req.query.to) {
      sql += ` AND a.created_at < DATEADD(day, 1, @toDt)`;
      params.toDt = new Date(req.query.to);
    }
    if (req.query.activity_type) {
      sql += ` AND a.activity_type = @actType`;
      params.actType = String(req.query.activity_type).trim();
    }
    if (req.query.order_id) {
      sql += ` AND a.order_id = @orderId`;
      params.orderId = req.query.order_id;
    }
    if (req.query.search) {
      sql += ` AND (
        a.title LIKE @q OR a.notes LIKE @q OR a.tags LIKE @q OR a.location_label LIKE @q
        OR o.depot_name LIKE @q OR o.delivery_site_name LIKE @q OR o.driver_name LIKE @q
      )`;
      params.q = `%${String(req.query.search).trim()}%`;
    }
    sql += ` ORDER BY a.created_at DESC`;
    const result = await query(sql, params);
    res.json({ activities: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** All reconciliations (flat list for exports) */
router.get('/reconciliations', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    let sql = `
      SELECT r.*, o.depot_name, o.delivery_site_name, o.driver_name, o.status AS order_status
      FROM fuel_reconciliations r
      INNER JOIN fuel_diesel_orders o ON o.id = r.order_id
      WHERE 1=1`;
    const params = {};
    if (tenantId) {
      sql += ` AND o.tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    sql += ` ORDER BY r.created_at DESC`;
    const result = await query(sql, params);
    res.json({ reconciliations: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Monthly production (liters) vs reconciliation spend */
router.get('/analytics/monthly', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    const params = {};
    let delSql = `
      SELECT FORMAT(d.delivered_at, 'yyyy-MM') AS ym, SUM(d.liters_delivered) AS liters
      FROM fuel_deliveries d
      INNER JOIN fuel_diesel_orders o ON o.id = d.order_id
      WHERE 1=1`;
    if (tenantId) {
      delSql += ` AND o.tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    delSql += ` GROUP BY FORMAT(d.delivered_at, 'yyyy-MM')`;
    let recSql = `
      SELECT FORMAT(r.created_at, 'yyyy-MM') AS ym,
        SUM(r.invoice_amount) AS invoice_total,
        SUM(ISNULL(r.handling_fee, 0)) AS fees_total
      FROM fuel_reconciliations r
      INNER JOIN fuel_diesel_orders o ON o.id = r.order_id
      WHERE 1=1`;
    if (tenantId) {
      recSql += ` AND o.tenant_id = @tenantId`;
    }
    recSql += ` GROUP BY FORMAT(r.created_at, 'yyyy-MM')`;
    const [delRes, recRes] = await Promise.all([query(delSql, params), query(recSql, params)]);
    const byMonth = {};
    for (const row of delRes.recordset || []) {
      const ym = get(row, 'ym');
      if (!byMonth[ym]) byMonth[ym] = { ym, liters: 0, cost: 0, invoice_total: 0, fees_total: 0 };
      byMonth[ym].liters = Number(get(row, 'liters')) || 0;
    }
    for (const row of recRes.recordset || []) {
      const ym = get(row, 'ym');
      if (!byMonth[ym]) byMonth[ym] = { ym, liters: 0, cost: 0, invoice_total: 0, fees_total: 0 };
      const inv = Number(get(row, 'invoice_total')) || 0;
      const fee = Number(get(row, 'fees_total')) || 0;
      byMonth[ym].invoice_total = inv;
      byMonth[ym].fees_total = fee;
      byMonth[ym].cost = inv + fee;
    }
    const months = Object.keys(byMonth).sort();
    const series = months.map((m) => byMonth[m]);
    const litersArr = series.map((s) => s.liters);
    const costArr = series.map((s) => s.cost);
    const n = litersArr.length;
    const avgLiters = n ? litersArr.reduce((a, b) => a + b, 0) / n : 0;
    const avgCost = n ? costArr.reduce((a, b) => a + b, 0) / n : 0;
    let forecastLiters = null;
    let forecastCost = null;
    if (n >= 2) {
      const xMean = (n - 1) / 2;
      let numL = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        numL += (i - xMean) * (litersArr[i] - avgLiters);
        den += (i - xMean) ** 2;
      }
      const slopeL = den !== 0 ? numL / den : 0;
      forecastLiters = Math.max(0, avgLiters + slopeL * (n - xMean + 1));
      let numC = 0;
      for (let i = 0; i < n; i++) {
        numC += (i - xMean) * (costArr[i] - avgCost);
      }
      const slopeC = den !== 0 ? numC / den : 0;
      forecastCost = Math.max(0, avgCost + slopeC * (n - xMean + 1));
    }
    res.json({ series, forecast_next_month: { liters: forecastLiters, cost: forecastCost } });
  } catch (err) {
    next(err);
  }
});

function sendFuelFile(storedPath, res) {
  const abs = path.resolve(process.cwd(), storedPath);
  const rootResolved = path.resolve(uploadsRoot);
  if (!abs.startsWith(rootResolved)) return false;
  if (!fs.existsSync(abs)) return false;
  res.sendFile(abs);
  return true;
}

/** Delivery vehicles */
router.get('/vehicles', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    let sql = `SELECT * FROM fuel_delivery_vehicles WHERE 1=1`;
    const params = {};
    if (tenantId) {
      sql += ` AND tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    sql += ` ORDER BY name`;
    const result = await query(sql, params);
    res.json({ vehicles: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/vehicles', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const tenantId = req.user.role === 'super_admin' ? (b.tenant_id || null) : req.user.tenant_id;
    const id = randomUUID();
    await query(
      `INSERT INTO fuel_delivery_vehicles (
        id, tenant_id, name, registration, tank_capacity_liters, current_liters_estimate, created_by_user_id
      ) VALUES (@id, @tid, @name, @reg, @cap, @cur, @uid)`,
      {
        id,
        tid: tenantId,
        name,
        reg: b.registration ? String(b.registration).trim() : null,
        cap: b.tank_capacity_liters != null && b.tank_capacity_liters !== '' ? Number(b.tank_capacity_liters) : null,
        cur: b.current_liters_estimate != null && b.current_liters_estimate !== '' ? Number(b.current_liters_estimate) : 0,
        uid: req.user.id,
      }
    );
    const get = await query(`SELECT * FROM fuel_delivery_vehicles WHERE id = @id`, { id });
    res.status(201).json({ vehicle: get.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/vehicles/:id', async (req, res, next) => {
  try {
    const cur = await query(`SELECT * FROM fuel_delivery_vehicles WHERE id = @id`, { id: req.params.id });
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const vTenant = get(row, 'tenant_id');
    if (req.user.role !== 'super_admin' && vTenant !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id };
    if (b.name !== undefined) {
      sets.push('name = @name');
      params.name = String(b.name);
    }
    if (b.registration !== undefined) {
      sets.push('registration = @registration');
      params.registration = b.registration || null;
    }
    if (b.tank_capacity_liters !== undefined) {
      sets.push('tank_capacity_liters = @tank_capacity_liters');
      params.tank_capacity_liters = b.tank_capacity_liters === null || b.tank_capacity_liters === '' ? null : Number(b.tank_capacity_liters);
    }
    if (b.current_liters_estimate !== undefined) {
      sets.push('current_liters_estimate = @current_liters_estimate');
      params.current_liters_estimate = Number(b.current_liters_estimate);
    }
    if (sets.length === 0) return res.json({ vehicle: row });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE fuel_delivery_vehicles SET ${sets.join(', ')} WHERE id = @id`, params);
    const again = await query(`SELECT * FROM fuel_delivery_vehicles WHERE id = @id`, { id: req.params.id });
    res.json({ vehicle: again.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** Trips */
router.get('/trips/summary', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    const params = {};
    let scope = '';
    if (tenantId) {
      scope = ' AND t.tenant_id = @tenantId';
      params.tenantId = tenantId;
    }
    const tripStats = await query(
      `SELECT
        COUNT(*) AS trip_count,
        SUM(CASE WHEN t.status = N'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN t.status = N'in_progress' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN t.status = N'completed' AND t.odometer_end_km IS NOT NULL AND t.odometer_start_km IS NOT NULL
          THEN t.odometer_end_km - t.odometer_start_km ELSE 0 END) AS total_km
      FROM fuel_vehicle_trips t WHERE 1=1 ${scope}`,
      params
    );
    const refuel = await query(
      `SELECT ISNULL(SUM(s.refuel_liters), 0) AS refuel_liters
       FROM fuel_trip_stops s
       INNER JOIN fuel_vehicle_trips t ON t.id = s.trip_id
       WHERE s.is_refuel = 1 ${scope.replace(/t\./g, 't.')}`,
      params
    );
    res.json({
      trips: tripStats.recordset?.[0] || {},
      refuel_liters: get(refuel.recordset?.[0], 'refuel_liters') || 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/trips', async (req, res, next) => {
  try {
    const tenantId = req.user.role === 'super_admin' ? (req.query.tenant_id || null) : req.user.tenant_id;
    let sql = `
      SELECT t.*, v.name AS vehicle_name, v.registration AS vehicle_registration
      FROM fuel_vehicle_trips t
      INNER JOIN fuel_delivery_vehicles v ON v.id = t.vehicle_id
      WHERE 1=1`;
    const params = {};
    if (tenantId) {
      sql += ` AND t.tenant_id = @tenantId`;
      params.tenantId = tenantId;
    }
    if (req.query.status) {
      sql += ` AND t.status = @st`;
      params.st = String(req.query.status);
    }
    if (req.query.vehicle_id) {
      sql += ` AND t.vehicle_id = @vid`;
      params.vid = req.query.vehicle_id;
    }
    sql += ` ORDER BY t.created_at DESC`;
    const result = await query(sql, params);
    res.json({ trips: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/trips/:id', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT t.*, v.name AS vehicle_name, v.registration AS vehicle_registration, v.tank_capacity_liters
       FROM fuel_vehicle_trips t
       INNER JOIN fuel_delivery_vehicles v ON v.id = t.vehicle_id
       WHERE t.id = @id`,
      { id: req.params.id }
    );
    const trip = r.recordset?.[0];
    if (!trip) return res.status(404).json({ error: 'Not found' });
    const tid = get(trip, 'tenant_id');
    if (req.user.role !== 'super_admin' && tid && tid !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const stops = await query(`SELECT * FROM fuel_trip_stops WHERE trip_id = @id ORDER BY sequence_no`, {
      id: req.params.id,
    });
    res.json({ trip, stops: stops.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/trips', async (req, res, next) => {
  try {
    const b = req.body || {};
    const vehicleId = b.vehicle_id || b.vehicleId;
    if (!vehicleId) return res.status(400).json({ error: 'vehicle_id required' });
    const vr = await query(`SELECT * FROM fuel_delivery_vehicles WHERE id = @id`, { id: vehicleId });
    const veh = vr.recordset?.[0];
    if (!veh) return res.status(404).json({ error: 'Vehicle not found' });
    const vTenant = get(veh, 'tenant_id');
    if (req.user.role !== 'super_admin' && vTenant !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const driverName = String(b.driver_name || b.driverName || '').trim();
    const driverNo = String(b.driver_employee_number || b.driverEmployeeNumber || '').trim();
    if (!driverName || !driverNo) return res.status(400).json({ error: 'driver_name and driver_employee_number required' });
    const startNow = b.start_now === true || b.startNow === true;
    const id = randomUUID();
    const tenantId = vTenant;
    const dieselOrderId = b.diesel_order_id || b.dieselOrderId || null;
    const odoStart = b.odometer_start_km != null ? Number(b.odometer_start_km) : null;
    const openLit = b.opening_liters_estimate != null ? Number(b.opening_liters_estimate) : null;
    await query(
      `INSERT INTO fuel_vehicle_trips (
        id, tenant_id, vehicle_id, diesel_order_id, driver_name, driver_employee_number,
        status, started_at, odometer_start_km, opening_liters_estimate, notes, created_by_user_id
      ) VALUES (
        @id, @tid, @vid, @oid, @dname, @dno,
        @status, @started, @odo, @olit, @notes, @uid
      )`,
      {
        id,
        tid: tenantId,
        vid: vehicleId,
        oid: dieselOrderId,
        dname: driverName,
        dno: driverNo,
        status: startNow ? 'in_progress' : 'planned',
        started: startNow ? new Date() : null,
        odo: Number.isNaN(odoStart) ? null : odoStart,
        olit: Number.isNaN(openLit) ? null : openLit,
        notes: b.notes ? String(b.notes) : null,
        uid: req.user.id,
      }
    );
    const tripRow = await query(`SELECT * FROM fuel_vehicle_trips WHERE id = @id`, { id });
    res.status(201).json({ trip: tripRow.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/trips/:id', async (req, res, next) => {
  try {
    const cur = await query(`SELECT t.*, v.tenant_id AS vehicle_tenant FROM fuel_vehicle_trips t
      INNER JOIN fuel_delivery_vehicles v ON v.id = t.vehicle_id WHERE t.id = @id`, { id: req.params.id });
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const tid = get(row, 'tenant_id') || get(row, 'vehicle_tenant');
    if (req.user.role !== 'super_admin' && tid !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};
    const action = String(b.action || '').toLowerCase();
    if (action === 'start') {
      const odo = b.odometer_start_km != null ? Number(b.odometer_start_km) : null;
      const olit = b.opening_liters_estimate != null ? Number(b.opening_liters_estimate) : null;
      await query(
        `UPDATE fuel_vehicle_trips SET status = N'in_progress', started_at = SYSUTCDATETIME(),
 odometer_start_km = @odo, opening_liters_estimate = @olit, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: req.params.id, odo: Number.isNaN(odo) ? null : odo, olit: Number.isNaN(olit) ? null : olit }
      );
    } else if (action === 'complete') {
      const odoEnd = b.odometer_end_km != null ? Number(b.odometer_end_km) : null;
      const closeLit = b.closing_liters_estimate != null ? Number(b.closing_liters_estimate) : null;
      await query(
        `UPDATE fuel_vehicle_trips SET status = N'completed', completed_at = SYSUTCDATETIME(),
         odometer_end_km = @odo, closing_liters_estimate = @clit, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: req.params.id, odo: Number.isNaN(odoEnd) ? null : odoEnd, clit: Number.isNaN(closeLit) ? null : closeLit }
      );
      const vehId = get(row, 'vehicle_id');
      if (closeLit != null && !Number.isNaN(closeLit)) {
        await query(
          `UPDATE fuel_delivery_vehicles SET current_liters_estimate = @lit, updated_at = SYSUTCDATETIME() WHERE id = @vid`,
          { lit: closeLit, vid: vehId }
        );
      }
    } else {
      return res.status(400).json({ error: 'action start|complete required' });
    }
    const again = await query(`SELECT * FROM fuel_vehicle_trips WHERE id = @id`, { id: req.params.id });
    res.json({ trip: again.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/trips/:id/stops', (req, res, next) => {
  tripStopUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const cur = await query(
        `SELECT t.*, v.tenant_id AS vehicle_tenant, v.tank_capacity_liters, v.current_liters_estimate
         FROM fuel_vehicle_trips t
         INNER JOIN fuel_delivery_vehicles v ON v.id = t.vehicle_id
         WHERE t.id = @id`,
        { id: req.params.id }
      );
      const trip = cur.recordset?.[0];
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      const tid = get(trip, 'tenant_id') || get(trip, 'vehicle_tenant');
      if (req.user.role !== 'super_admin' && tid !== req.user.tenant_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const arrivedAt = req.body.arrived_at || req.body.arrivedAt;
      if (!arrivedAt) return res.status(400).json({ error: 'arrived_at required' });
      const seqR = await query(`SELECT ISNULL(MAX(sequence_no), 0) + 1 AS nx FROM fuel_trip_stops WHERE trip_id = @tid`, {
        tid: req.params.id,
      });
      const seq = seqR.recordset?.[0]?.nx ?? 1;
      const gaugeFile = req.files?.gauge_photo?.[0];
      const slipFile = req.files?.slip_photo?.[0];
      const gaugePath = gaugeFile ? path.relative(process.cwd(), gaugeFile.path).replace(/\\/g, '/') : null;
      const slipPath = slipFile ? path.relative(process.cwd(), slipFile.path).replace(/\\/g, '/') : null;
      const isRefuel = req.body.is_refuel === true || req.body.is_refuel === 'true' || req.body.isRefuel === true || req.body.isRefuel === 'true';
      const refuelLiters = req.body.refuel_liters != null ? Number(req.body.refuel_liters) : null;
      const litersGauge = req.body.liters_on_gauge != null ? Number(req.body.liters_on_gauge) : null;
      const id = randomUUID();
      await query(
        `INSERT INTO fuel_trip_stops (
          id, trip_id, sequence_no, place_label, arrived_at, departed_at, odometer_km,
          liters_on_gauge, gauge_photo_path, gauge_original_name, is_refuel, refuel_liters,
          slip_photo_path, slip_original_name, notes
        ) VALUES (
          @id, @tripId, @seq, @place, @arr, @dep, @odo,
          @lg, @gp, @go, @ir, @rl,
          @sp, @so, @notes
        )`,
        {
          id,
          tripId: req.params.id,
          seq,
          place: req.body.place_label || req.body.placeLabel ? String(req.body.place_label || req.body.placeLabel) : null,
          arr: new Date(arrivedAt),
          dep: req.body.departed_at || req.body.departedAt ? new Date(req.body.departed_at || req.body.departedAt) : null,
          odo: req.body.odometer_km != null ? Number(req.body.odometer_km) : null,
          lg: Number.isNaN(litersGauge) ? null : litersGauge,
          gp: gaugePath,
          go: gaugeFile?.originalname || null,
          ir: isRefuel,
          rl: refuelLiters != null && !Number.isNaN(refuelLiters) ? refuelLiters : null,
          sp: slipPath,
          so: slipFile?.originalname || null,
          notes: req.body.notes ? String(req.body.notes) : null,
        }
      );
      const vehId = get(trip, 'vehicle_id');
      const vehFresh = await query(
        `SELECT current_liters_estimate, tank_capacity_liters FROM fuel_delivery_vehicles WHERE id = @vid`,
        { vid: vehId }
      );
      const vrow = vehFresh.recordset?.[0] || {};
      let cap = get(vrow, 'tank_capacity_liters');
      cap = cap != null ? Number(cap) : null;
      let current = Number(get(vrow, 'current_liters_estimate')) || 0;
      let nextLit = current;
      if (isRefuel && refuelLiters != null && !Number.isNaN(refuelLiters) && refuelLiters > 0) {
        nextLit = current + refuelLiters;
        if (cap != null && !Number.isNaN(cap)) nextLit = Math.min(nextLit, cap);
      }
      if (litersGauge != null && !Number.isNaN(litersGauge)) nextLit = litersGauge;
      await query(
        `UPDATE fuel_delivery_vehicles SET current_liters_estimate = @lit, updated_at = SYSUTCDATETIME() WHERE id = @vid`,
        { lit: nextLit, vid: vehId }
      );
      const stopRow = await query(`SELECT * FROM fuel_trip_stops WHERE id = @id`, { id });
      res.status(201).json({ stop: stopRow.recordset[0] });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/trip-stops/:id/gauge', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT s.gauge_photo_path, t.tenant_id FROM fuel_trip_stops s
       INNER JOIN fuel_vehicle_trips t ON t.id = s.trip_id WHERE s.id = @id`,
      { id: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row || !get(row, 'gauge_photo_path')) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'super_admin' && get(row, 'tenant_id') !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!sendFuelFile(get(row, 'gauge_photo_path'), res)) return res.status(404).json({ error: 'File missing' });
  } catch (err) {
    next(err);
  }
});

router.get('/trip-stops/:id/slip', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT s.slip_photo_path, t.tenant_id FROM fuel_trip_stops s
       INNER JOIN fuel_vehicle_trips t ON t.id = s.trip_id WHERE s.id = @id`,
      { id: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row || !get(row, 'slip_photo_path')) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'super_admin' && get(row, 'tenant_id') !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!sendFuelFile(get(row, 'slip_photo_path'), res)) return res.status(404).json({ error: 'File missing' });
  } catch (err) {
    next(err);
  }
});

/** Customer-submitted diesel requests (Fuel supply → Administration workflow) */
router.get('/customer-requests', async (req, res, next) => {
  try {
    const params = {};
    let sql = `
      SELECT r.*, u.full_name AS requester_name, u.email AS requester_email, o.status AS order_status_join
      FROM fuel_customer_diesel_requests r
      LEFT JOIN users u ON u.id = r.requesting_user_id
      LEFT JOIN fuel_diesel_orders o ON o.id = r.diesel_order_id
      WHERE 1=1`;
    if (req.user.role !== 'super_admin') {
      sql += ' AND r.tenant_id = @tenantId';
      params.tenantId = req.user.tenant_id;
    }
    const statusFilter = req.query.status ? String(req.query.status).trim() : '';
    if (statusFilter) {
      sql += ' AND r.status = @rstatus';
      params.rstatus = statusFilter;
    }
    sql += ' ORDER BY r.created_at DESC';
    const result = await query(sql, params);
    res.json({ requests: (result.recordset || []).map(mapCustomerRequestAdmin) });
  } catch (err) {
    next(err);
  }
});

router.get('/customer-requests/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, u.full_name AS requester_name, u.email AS requester_email, o.status AS order_status_join
       FROM fuel_customer_diesel_requests r
       LEFT JOIN users u ON u.id = r.requesting_user_id
       LEFT JOIN fuel_diesel_orders o ON o.id = r.diesel_order_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const mapped = mapCustomerRequestAdmin(row);
    if (req.user.role !== 'super_admin' && mapped.tenant_id && mapped.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ request: mapped });
  } catch (err) {
    next(err);
  }
});

router.post('/customer-requests/:id/approve', async (req, res, next) => {
  try {
    const cr = await query(`SELECT * FROM fuel_customer_diesel_requests WHERE id = @id`, { id: req.params.id });
    const reqRow = cr.recordset?.[0];
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    const rowTenant = get(reqRow, 'tenant_id');
    if (req.user.role !== 'super_admin' && rowTenant && rowTenant !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (String(get(reqRow, 'status')) !== 'pending_admin') {
      return res.status(409).json({ error: 'Request is not pending approval' });
    }
    const b = req.body || {};
    const required = ['depot_name', 'depot_address', 'supplier_code', 'driver_name', 'driver_employee_number'];
    for (const k of required) {
      if (!String(b[k] || '').trim()) return res.status(400).json({ error: `${k} required` });
    }
    const delivery_site_name = String(b.delivery_site_name || get(reqRow, 'delivery_site_name') || '').trim();
    const delivery_site_address = String(b.delivery_site_address || get(reqRow, 'delivery_site_address') || '').trim();
    const site_responsible_name = String(b.site_responsible_name || get(reqRow, 'site_responsible_name') || '').trim();
    if (!delivery_site_name || !delivery_site_address || !site_responsible_name) {
      return res.status(400).json({
        error: 'delivery_site_name, delivery_site_address, and site_responsible_name are required (from the request or in the approval form)',
      });
    }
    const site_responsible_phone =
      b.site_responsible_phone != null && b.site_responsible_phone !== ''
        ? String(b.site_responsible_phone).trim()
        : get(reqRow, 'site_responsible_phone') || null;
    const site_responsible_email =
      b.site_responsible_email != null && b.site_responsible_email !== ''
        ? String(b.site_responsible_email).trim()
        : get(reqRow, 'site_responsible_email') || null;
    const site_responsible_role = b.site_responsible_role ? String(b.site_responsible_role).trim() : null;
    const expectedLiters =
      b.expected_liters != null && b.expected_liters !== ''
        ? Number(b.expected_liters)
        : Number(get(reqRow, 'liters_required'));
    if (Number.isNaN(expectedLiters) || expectedLiters <= 0) {
      return res.status(400).json({ error: 'expected_liters invalid' });
    }
    const dueRaw = get(reqRow, 'due_date');
    const dueStr =
      dueRaw instanceof Date
        ? dueRaw.toISOString().slice(0, 10)
        : dueRaw
          ? String(dueRaw).slice(0, 10)
          : '—';
    const meta = [
      `Customer request: type=${get(reqRow, 'request_type')}, priority=${get(reqRow, 'priority')}, due=${dueStr}.`,
      get(reqRow, 'customer_notes') ? `Customer notes: ${get(reqRow, 'customer_notes')}` : null,
      b.notes ? `Admin: ${String(b.notes)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const orderId = randomUUID();
    await query(
      `INSERT INTO fuel_diesel_orders (
        id, tenant_id, created_by_user_id, status,
        depot_name, depot_address, supplier_code,
        driver_name, driver_employee_number,
        delivery_site_name, delivery_site_address,
        site_responsible_name, site_responsible_phone, site_responsible_email, site_responsible_role,
        expected_liters, notes
      ) VALUES (
        @id, @tenantId, @uid, N'active',
        @depot_name, @depot_address, @supplier_code,
        @driver_name, @driver_employee_number,
        @delivery_site_name, @delivery_site_address,
        @site_responsible_name, @site_responsible_phone, @site_responsible_email, @site_responsible_role,
        @expected_liters, @notes
      )`,
      {
        id: orderId,
        tenantId: rowTenant,
        uid: req.user.id,
        depot_name: String(b.depot_name).trim(),
        depot_address: String(b.depot_address).trim(),
        supplier_code: String(b.supplier_code).trim(),
        driver_name: String(b.driver_name).trim(),
        driver_employee_number: String(b.driver_employee_number).trim(),
        delivery_site_name,
        delivery_site_address,
        site_responsible_name,
        site_responsible_phone,
        site_responsible_email,
        site_responsible_role,
        expected_liters: expectedLiters,
        notes: meta || null,
      }
    );
    await query(
      `UPDATE fuel_customer_diesel_requests SET
        status = N'approved',
        diesel_order_id = @oid,
        reviewed_by_user_id = @rid,
        reviewed_at = SYSUTCDATETIME(),
        admin_notes = @anotes,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND status = N'pending_admin'`,
      {
        oid: orderId,
        rid: req.user.id,
        anotes: b.admin_notes ? String(b.admin_notes) : null,
        id: req.params.id,
      }
    );
    const verify = await query(`SELECT * FROM fuel_customer_diesel_requests WHERE id = @id`, { id: req.params.id });
    const updatedReq = verify.recordset?.[0];
    if (!updatedReq || String(get(updatedReq, 'status')) !== 'approved' || get(updatedReq, 'diesel_order_id') !== orderId) {
      return res.status(409).json({ error: 'Could not finalize approval; please retry' });
    }
    const orderGet = await query(`SELECT * FROM fuel_diesel_orders WHERE id = @id`, { id: orderId });
    const mappedOrder = mapOrder(orderGet.recordset[0]);
    await insertEvent({
      tenantId: rowTenant,
      eventType: 'customer_request',
      orderId,
      title: `Customer request approved — ${expectedLiters} L`,
      message: delivery_site_name,
    });
    const requesterId = get(reqRow, 'requesting_user_id');
    const u = await getUserEmailById(requesterId);
    if (u?.email) {
      const originRaw = process.env.FRONTEND_ORIGIN || '';
      const link = originRaw.split(',')[0].trim().replace(/\/$/, '');
      const portalHint = link
        ? `<p>You can track status on your <a href="${escapeHtml(link)}/fuel-customer-orders">customer diesel orders</a> page.</p>`
        : '<p>You can track status in the app under Customer diesel orders.</p>';
      await notifyCustomerDieselEmail(
        u.email,
        'Your diesel order request was approved',
        `<p>Hello ${escapeHtml(u.full_name || 'there')},</p>
        <p>Your diesel delivery request for <strong>${escapeHtml(String(expectedLiters))} L</strong> has been approved and registered.</p>
        ${portalHint}
        <p style="color:#555;font-size:13px">Site: ${escapeHtml(delivery_site_name)}</p>`
      );
    }
    const full = await query(
      `SELECT r.*, u.full_name AS requester_name, u.email AS requester_email, o.status AS order_status_join
       FROM fuel_customer_diesel_requests r
       LEFT JOIN users u ON u.id = r.requesting_user_id
       LEFT JOIN fuel_diesel_orders o ON o.id = r.diesel_order_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.status(201).json({ order: mappedOrder, request: mapCustomerRequestAdmin(full.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.post('/customer-requests/:id/reject', async (req, res, next) => {
  try {
    const cr = await query(`SELECT * FROM fuel_customer_diesel_requests WHERE id = @id`, { id: req.params.id });
    const reqRow = cr.recordset?.[0];
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'super_admin' && get(reqRow, 'tenant_id') !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (String(get(reqRow, 'status')) !== 'pending_admin') {
      return res.status(409).json({ error: 'Request is not pending approval' });
    }
    const b = req.body || {};
    const rejection_reason = b.rejection_reason ? String(b.rejection_reason).trim().slice(0, 500) : null;
    await query(
      `UPDATE fuel_customer_diesel_requests SET
        status = N'rejected',
        rejection_reason = @reason,
        reviewed_by_user_id = @rid,
        reviewed_at = SYSUTCDATETIME(),
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND status = N'pending_admin'`,
      { reason: rejection_reason, rid: req.user.id, id: req.params.id }
    );
    const u = await getUserEmailById(get(reqRow, 'requesting_user_id'));
    if (u?.email) {
      await notifyCustomerDieselEmail(
        u.email,
        'Diesel order request update',
        `<p>Hello ${escapeHtml(u.full_name || 'there')},</p>
        <p>Your diesel delivery request could not be approved at this time.</p>
        ${rejection_reason ? `<p>Reason: ${escapeHtml(rejection_reason)}</p>` : ''}`
      );
    }
    const again = await query(
      `SELECT r.*, u.full_name AS requester_name, u.email AS requester_email, o.status AS order_status_join
       FROM fuel_customer_diesel_requests r
       LEFT JOIN users u ON u.id = r.requesting_user_id
       LEFT JOIN fuel_diesel_orders o ON o.id = r.diesel_order_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ request: mapCustomerRequestAdmin(again.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

export default router;
