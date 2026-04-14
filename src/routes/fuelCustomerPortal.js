import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const REQUEST_TYPES = new Set(['normal', 'top_up', 'emergency']);

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

async function insertFuelEvent({ tenantId, eventType, orderId, title, message }) {
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
    /* table may not exist */
  }
}

function mapCustomerRequest(row, orderStatus) {
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
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('fuel_customer_orders'));

router.post('/requests', async (req, res, next) => {
  try {
    const b = req.body || {};
    const liters = Number(b.liters_required);
    if (Number.isNaN(liters) || liters <= 0) {
      return res.status(400).json({ error: 'liters_required must be a positive number' });
    }
    const priority = String(b.priority || '').trim().toLowerCase();
    if (!PRIORITIES.has(priority)) {
      return res.status(400).json({ error: 'priority must be one of: low, normal, high, urgent' });
    }
    const request_type = String(b.request_type || b.requestType || '').trim().toLowerCase();
    if (!REQUEST_TYPES.has(request_type)) {
      return res.status(400).json({ error: 'request_type must be one of: normal, top_up, emergency' });
    }
    const dueRaw = b.due_date || b.dueDate;
    if (!dueRaw) return res.status(400).json({ error: 'due_date required' });
    const dueDate = new Date(dueRaw);
    if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ error: 'due_date invalid' });
    const dueStr = dueDate.toISOString().slice(0, 10);
    const delivery_site_name = String(b.delivery_site_name || '').trim();
    const delivery_site_address = String(b.delivery_site_address || '').trim();
    if (!delivery_site_name || !delivery_site_address) {
      return res.status(400).json({ error: 'delivery_site_name and delivery_site_address required' });
    }
    const site_responsible_name = b.site_responsible_name ? String(b.site_responsible_name).trim() : null;
    const site_responsible_phone = b.site_responsible_phone ? String(b.site_responsible_phone).trim() : null;
    const site_responsible_email = b.site_responsible_email ? String(b.site_responsible_email).trim() : null;
    const customer_notes = b.customer_notes || b.notes ? String(b.customer_notes || b.notes) : null;
    const tenantId = req.user.tenant_id || null;
    const id = randomUUID();
    await query(
      `INSERT INTO fuel_customer_diesel_requests (
        id, tenant_id, requesting_user_id, liters_required, priority, due_date, request_type,
        delivery_site_name, delivery_site_address, site_responsible_name, site_responsible_phone, site_responsible_email,
        customer_notes, status
      ) VALUES (
        @id, @tenantId, @uid, @liters, @priority, @dueDate, @requestType,
        @siteName, @siteAddr, @respName, @respPhone, @respEmail,
        @custNotes, N'pending_admin'
      )`,
      {
        id,
        tenantId,
        uid: req.user.id,
        liters,
        priority,
        dueDate: dueStr,
        requestType: request_type,
        siteName: delivery_site_name,
        siteAddr: delivery_site_address,
        respName: site_responsible_name,
        respPhone: site_responsible_phone,
        respEmail: site_responsible_email,
        custNotes: customer_notes,
      }
    );
    const r = await query(`SELECT * FROM fuel_customer_diesel_requests WHERE id = @id`, { id });
    const row = r.recordset[0];
    await insertFuelEvent({
      tenantId,
      eventType: 'customer_request',
      orderId: null,
      title: `New customer diesel request — ${liters} L (${request_type})`,
      message: `${delivery_site_name} · due ${dueStr} · ${priority} priority`,
    });
    res.status(201).json({ request: mapCustomerRequest(row, null) });
  } catch (err) {
    next(err);
  }
});

router.get('/requests', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, o.status AS order_status_join
       FROM fuel_customer_diesel_requests r
       LEFT JOIN fuel_diesel_orders o ON o.id = r.diesel_order_id
       WHERE r.requesting_user_id = @uid
       ORDER BY r.created_at DESC`,
      { uid: req.user.id }
    );
    const mapped = (result.recordset || []).map((row) => {
      const os = get(row, 'order_status_join');
      return mapCustomerRequest(row, os);
    });
    res.json({ requests: mapped });
  } catch (err) {
    next(err);
  }
});

export default router;
