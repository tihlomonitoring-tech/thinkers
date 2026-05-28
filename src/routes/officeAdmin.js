import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';

const router = Router();

export const OA_TAB_IDS = [
  'dashboard',
  'asset_register',
  'consumables',
  'maintenance',
  'office_requests',
  'office_manager',
  'accounting_link',
  'manage_access',
];

function get(row, key) {
  if (!row) return undefined;
  const lower = String(key).toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (String(k).toLowerCase() === lower) return v;
  }
  return undefined;
}

function resolveTenantId(req) {
  if (req.user?.role === 'super_admin') {
    return req.query.tenant_id || req.body?.tenant_id || req.user.tenant_id || null;
  }
  return req.user?.tenant_id || null;
}

function requireTenant(req, res) {
  const tid = resolveTenantId(req);
  if (!tid) {
    res.status(400).json({ error: 'Tenant context required. Super admins may pass tenant_id.' });
    return null;
  }
  return tid;
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('office_admin'));

/** Tab access */
router.get('/my-tabs', async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') return res.json({ tabs: OA_TAB_IDS });
    const r = await query(`SELECT tab_id FROM office_admin_grants WHERE user_id = @userId`, { userId: req.user.id });
    let tabs = (r.recordset || []).map((row) => get(row, 'tab_id')).filter((id) => OA_TAB_IDS.includes(id));
    if (tabs.length === 0) tabs = [...OA_TAB_IDS];
    res.json({ tabs });
  } catch (err) {
    next(err);
  }
});

router.get('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT g.user_id, g.tab_id, u.full_name, u.email
       FROM office_admin_grants g JOIN users u ON u.id = g.user_id ORDER BY u.full_name, g.tab_id`
    );
    const byUser = {};
    for (const row of r.recordset || []) {
      const uid = get(row, 'user_id');
      if (!byUser[uid]) byUser[uid] = { user_id: uid, full_name: get(row, 'full_name'), email: get(row, 'email'), tabs: [] };
      byUser[uid].tabs.push(get(row, 'tab_id'));
    }
    res.json({ permissions: Object.values(byUser), allTabIds: OA_TAB_IDS });
  } catch (err) {
    next(err);
  }
});

router.post('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.body || {};
    if (!user_id || !tab_id || !OA_TAB_IDS.includes(tab_id)) {
      return res.status(400).json({ error: 'user_id and valid tab_id required' });
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM office_admin_grants WHERE user_id = @userId AND tab_id = @tabId)
       INSERT INTO office_admin_grants (user_id, tab_id, granted_by_user_id) VALUES (@userId, @tabId, @grantedBy)`,
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
    await query(`DELETE FROM office_admin_grants WHERE user_id = @userId AND tab_id = @tabId`, {
      userId: user_id,
      tabId: tab_id,
    });
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

/** Dashboard summary */
router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const [assets, consumables, reports, requests] = await Promise.all([
      query(`SELECT COUNT(*) AS c FROM office_admin_assets WHERE tenant_id = @tenantId`, { tenantId }),
      query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN quantity_on_hand <= reorder_level THEN 1 ELSE 0 END) AS low_stock
         FROM office_admin_consumables WHERE tenant_id = @tenantId`,
        { tenantId }
      ),
      query(
        `SELECT COUNT(*) AS open_count FROM office_admin_maintenance_reports
         WHERE tenant_id = @tenantId AND status IN (N'open', N'assigned', N'in_progress')`,
        { tenantId }
      ),
      query(
        `SELECT COUNT(*) AS pending_count FROM office_admin_requests
         WHERE tenant_id = @tenantId AND status IN (N'pending', N'manager_review')`,
        { tenantId }
      ),
    ]);
    res.json({
      summary: {
        assets: get(assets.recordset?.[0], 'c') || 0,
        consumables: get(consumables.recordset?.[0], 'total') || 0,
        consumables_low_stock: get(consumables.recordset?.[0], 'low_stock') || 0,
        maintenance_open: get(reports.recordset?.[0], 'open_count') || 0,
        requests_pending: get(requests.recordset?.[0], 'pending_count') || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Accounting link helpers (read-only) */
router.get('/accounting/items', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT TOP 200 id, name, sku, unit_price FROM accounting_items WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId }
    ).catch(() => ({ recordset: [] }));
    res.json({ items: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/accounting/suppliers', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT TOP 200 id, name FROM accounting_suppliers WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId }
    ).catch(() => ({ recordset: [] }));
    res.json({ suppliers: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Assets */
router.get('/assets', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const q = String(req.query.q || '').trim();
    let sql = `SELECT a.*, u.full_name AS created_by_name
               FROM office_admin_assets a
               LEFT JOIN users u ON u.id = a.created_by_user_id
               WHERE a.tenant_id = @tenantId`;
    const params = { tenantId };
    if (q) {
      sql += ` AND (a.name LIKE @q OR a.asset_code LIKE @q OR a.serial_number LIKE @q OR a.location LIKE @q)`;
      params.q = `%${q}%`;
    }
    sql += ` ORDER BY a.name`;
    const r = await query(sql, params);
    res.json({ assets: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/assets', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const assetCode = String(b.asset_code || b.assetCode || '').trim();
    const name = String(b.name || '').trim();
    if (!assetCode || !name) return res.status(400).json({ error: 'asset_code and name are required.' });
    const ins = await query(
      `INSERT INTO office_admin_assets (
        tenant_id, asset_code, name, category, location, serial_number, purchase_date, purchase_value,
        status, accounting_item_id, accounting_supplier_id, notes, created_by_user_id
      )
      OUTPUT INSERTED.*
      VALUES (
        @tenantId, @assetCode, @name, @category, @location, @serial, @purchaseDate, @purchaseValue,
        @status, @accountingItemId, @accountingSupplierId, @notes, @userId
      )`,
      {
        tenantId,
        assetCode,
        name,
        category: b.category || null,
        location: b.location || null,
        serial: b.serial_number || b.serialNumber || null,
        purchaseDate: b.purchase_date || b.purchaseDate || null,
        purchaseValue: b.purchase_value ?? b.purchaseValue ?? null,
        status: b.status || 'active',
        accountingItemId: b.accounting_item_id || b.accountingItemId || null,
        accountingSupplierId: b.accounting_supplier_id || b.accountingSupplierId || null,
        notes: b.notes || null,
        userId: req.user.id,
      }
    );
    res.status(201).json({ asset: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/assets/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const fields = [
      'asset_code', 'name', 'category', 'location', 'serial_number', 'purchase_date', 'purchase_value',
      'status', 'accounting_item_id', 'accounting_supplier_id', 'notes',
    ];
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of fields) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val = b[col] ?? b[camel];
      if (val !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = val;
      }
    }
    await query(
      `UPDATE office_admin_assets SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const r = await query(`SELECT * FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`, {
      id: req.params.id,
      tenantId,
    });
    if (!r.recordset?.[0]) return res.status(404).json({ error: 'Asset not found.' });
    res.json({ asset: r.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    await query(`DELETE FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`, {
      id: req.params.id,
      tenantId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Consumables */
router.get('/consumables', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT * FROM office_admin_consumables WHERE tenant_id = @tenantId ORDER BY category, name`,
      { tenantId }
    );
    res.json({ consumables: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/consumables', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required.' });
    const ins = await query(
      `INSERT INTO office_admin_consumables (
        tenant_id, name, category, unit, quantity_on_hand, reorder_level, unit_cost, accounting_item_id, notes
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @name, @category, @unit, @qty, @reorder, @cost, @itemId, @notes
      )`,
      {
        tenantId,
        name,
        category: b.category || 'other',
        unit: b.unit || 'unit',
        qty: b.quantity_on_hand ?? b.quantityOnHand ?? 0,
        reorder: b.reorder_level ?? b.reorderLevel ?? 0,
        cost: b.unit_cost ?? b.unitCost ?? null,
        itemId: b.accounting_item_id || b.accountingItemId || null,
        notes: b.notes || null,
      }
    );
    res.status(201).json({ consumable: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/consumables/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of ['name', 'category', 'unit', 'quantity_on_hand', 'reorder_level', 'unit_cost', 'accounting_item_id', 'notes']) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (b[col] !== undefined || b[camel] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = b[col] ?? b[camel];
      }
    }
    await query(`UPDATE office_admin_consumables SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    const r = await query(`SELECT * FROM office_admin_consumables WHERE id = @id`, { id: req.params.id });
    res.json({ consumable: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Maintenance reports */
router.get('/maintenance/reports', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const status = req.query.status;
    let sql = `SELECT r.*, u.full_name AS reported_by_name, a.name AS asset_name, a.asset_code
               FROM office_admin_maintenance_reports r
               LEFT JOIN users u ON u.id = r.reported_by_user_id
               LEFT JOIN office_admin_assets a ON a.id = r.asset_id
               WHERE r.tenant_id = @tenantId`;
    const params = { tenantId };
    if (status) {
      sql += ` AND r.status = @status`;
      params.status = status;
    }
    sql += ` ORDER BY r.created_at DESC`;
    const r = await query(sql, params);
    res.json({ reports: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance/reports', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required.' });
    let assetName = b.asset_name_snapshot || b.assetNameSnapshot || null;
    if (b.asset_id || b.assetId) {
      const ar = await query(`SELECT name, asset_code FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`, {
        id: b.asset_id || b.assetId,
        tenantId,
      });
      const a = ar.recordset?.[0];
      if (a) assetName = get(a, 'name') || assetName;
    }
    const ins = await query(
      `INSERT INTO office_admin_maintenance_reports (
        tenant_id, asset_id, asset_name_snapshot, reported_by_user_id, title, description, priority, status
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @assetId, @assetName, @userId, @title, @description, @priority, N'open'
      )`,
      {
        tenantId,
        assetId: b.asset_id || b.assetId || null,
        assetName,
        userId: req.user.id,
        title,
        description: b.description || null,
        priority: b.priority || 'medium',
      }
    );
    res.status(201).json({ report: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/maintenance/reports/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of ['status', 'priority', 'manager_notes', 'asset_id']) {
      if (b[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = b[col];
      }
    }
    if (b.status === 'resolved' || b.status === 'closed') {
      sets.push('resolved_at = SYSUTCDATETIME()');
    }
    await query(
      `UPDATE office_admin_maintenance_reports SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const r = await query(`SELECT * FROM office_admin_maintenance_reports WHERE id = @id`, { id: req.params.id });
    res.json({ report: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Maintenance records */
router.get('/maintenance/records', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const assetId = req.query.asset_id || req.query.assetId;
    let sql = `SELECT m.*, a.name AS asset_name, a.asset_code
               FROM office_admin_maintenance_records m
               INNER JOIN office_admin_assets a ON a.id = m.asset_id
               WHERE m.tenant_id = @tenantId`;
    const params = { tenantId };
    if (assetId) {
      sql += ` AND m.asset_id = @assetId`;
      params.assetId = assetId;
    }
    sql += ` ORDER BY m.performed_at DESC`;
    const r = await query(sql, params);
    res.json({ records: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance/records', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const assetId = b.asset_id || b.assetId;
    const description = String(b.description || '').trim();
    if (!assetId || !description) return res.status(400).json({ error: 'asset_id and description are required.' });
    const ins = await query(
      `INSERT INTO office_admin_maintenance_records (
        tenant_id, asset_id, report_id, maintenance_type, description, cost, performed_by, performed_at, next_due_at, accounting_reference, created_by_user_id
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @assetId, @reportId, @type, @description, @cost, @performedBy, @performedAt, @nextDue, @acctRef, @userId
      )`,
      {
        tenantId,
        assetId,
        reportId: b.report_id || b.reportId || null,
        type: b.maintenance_type || b.maintenanceType || 'repair',
        description,
        cost: b.cost ?? null,
        performedBy: b.performed_by || b.performedBy || null,
        performedAt: b.performed_at || b.performedAt || new Date(),
        nextDue: b.next_due_at || b.nextDueAt || null,
        acctRef: b.accounting_reference || b.accountingReference || null,
        userId: req.user.id,
      }
    );
    if (b.report_id || b.reportId) {
      await query(
        `UPDATE office_admin_maintenance_reports SET status = N'resolved', resolved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
         WHERE id = @reportId AND tenant_id = @tenantId`,
        { reportId: b.report_id || b.reportId, tenantId }
      );
    }
    await query(
      `UPDATE office_admin_assets SET status = N'active', updated_at = SYSUTCDATETIME() WHERE id = @assetId AND tenant_id = @tenantId`,
      { assetId, tenantId }
    );
    res.status(201).json({ record: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Office requests */
router.get('/requests', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    let sql = `SELECT r.*, u.full_name AS requested_by_name
               FROM office_admin_requests r
               LEFT JOIN users u ON u.id = r.requested_by_user_id
               WHERE r.tenant_id = @tenantId`;
    const params = { tenantId };
    if (mine) {
      sql += ` AND r.requested_by_user_id = @userId`;
      params.userId = req.user.id;
    }
    sql += ` ORDER BY r.created_at DESC`;
    const r = await query(sql, params);
    res.json({ requests: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required.' });
    const ins = await query(
      `INSERT INTO office_admin_requests (
        tenant_id, request_type, title, description, priority, status, requested_by_user_id, due_date
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @type, @title, @description, @priority, N'pending', @userId, @dueDate
      )`,
      {
        tenantId,
        type: b.request_type || b.requestType || 'general',
        title,
        description: b.description || null,
        priority: b.priority || 'medium',
        userId: req.user.id,
        dueDate: b.due_date || b.dueDate || null,
      }
    );
    res.status(201).json({ request: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/requests/:id/messages', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT m.*, u.full_name AS user_name FROM office_admin_request_messages m
       LEFT JOIN users u ON u.id = m.user_id WHERE m.request_id = @id ORDER BY m.created_at ASC`,
      { id: req.params.id }
    );
    res.json({ messages: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/messages', async (req, res, next) => {
  try {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required.' });
    const ins = await query(
      `INSERT INTO office_admin_request_messages (request_id, user_id, message, message_type)
       OUTPUT INSERTED.* VALUES (@requestId, @userId, @message, @type)`,
      {
        requestId: req.params.id,
        userId: req.user.id,
        message,
        type: b.message_type || b.messageType || 'comment',
      }
    );
    res.status(201).json({ message: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/requests/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of ['status', 'priority', 'manager_response', 'assigned_to_user_id']) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (b[col] !== undefined || b[camel] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = b[col] ?? b[camel];
      }
    }
    if (b.status === 'fulfilled') sets.push('fulfilled_at = SYSUTCDATETIME()');
    await query(`UPDATE office_admin_requests SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    if (b.manager_response || b.managerResponse) {
      await query(
        `INSERT INTO office_admin_request_messages (request_id, user_id, message, message_type)
         VALUES (@requestId, @userId, @message, N'manager')`,
        {
          requestId: req.params.id,
          userId: req.user.id,
          message: b.manager_response || b.managerResponse,
        }
      );
    }
    const r = await query(`SELECT * FROM office_admin_requests WHERE id = @id`, { id: req.params.id });
    res.json({ request: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Office manager inbox */
router.get('/manager/inbox', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const [reports, requests, lowStock] = await Promise.all([
      query(
        `SELECT r.*, u.full_name AS reported_by_name, a.asset_code
         FROM office_admin_maintenance_reports r
         LEFT JOIN users u ON u.id = r.reported_by_user_id
         LEFT JOIN office_admin_assets a ON a.id = r.asset_id
         WHERE r.tenant_id = @tenantId AND r.status IN (N'open', N'assigned', N'in_progress')
         ORDER BY r.created_at DESC`,
        { tenantId }
      ),
      query(
        `SELECT r.*, u.full_name AS requested_by_name
         FROM office_admin_requests r
         LEFT JOIN users u ON u.id = r.requested_by_user_id
         WHERE r.tenant_id = @tenantId AND r.status IN (N'pending', N'manager_review')
         ORDER BY r.created_at DESC`,
        { tenantId }
      ),
      query(
        `SELECT * FROM office_admin_consumables
         WHERE tenant_id = @tenantId AND quantity_on_hand <= reorder_level ORDER BY name`,
        { tenantId }
      ),
    ]);
    res.json({
      maintenance_reports: reports.recordset || [],
      office_requests: requests.recordset || [],
      low_stock_consumables: lowStock.recordset || [],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
