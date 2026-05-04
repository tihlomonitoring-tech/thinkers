import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';
import { sendEmail } from '../lib/emailService.js';
import { getOpenAiClient, getAiModel, isAiConfigured } from '../lib/ai.js';

const router = Router();

export const FD_TAB_IDS = [
  'advanced_dashboard',
  'fuel_admin',
  'file_export',
  'customer_details',
  'supplier_details',
  'analytics',
  'attendant_portal',
];

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const uploadsRoot = path.join(process.cwd(), 'uploads', 'fuel-data');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = tenantId(req) || 'unknown';
      const dir = path.join(uploadsRoot, 'customer-receipts', tid);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file');

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = tenantId(req) || 'unknown';
      const dir = path.join(uploadsRoot, 'supplier-logos', tid);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.png';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single('logo');

const slipUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = tenantId(req) || 'unknown';
      const dir = path.join(uploadsRoot, 'slips', tid);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.jpg';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('slip');

const txAttachUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = tenantId(req) || 'unknown';
      const txId = req.params?.id || 'unknown';
      const dir = path.join(uploadsRoot, 'tx-attachments', tid, String(txId));
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

function requireFuelDataTab(tabId) {
  return async (req, res, next) => {
    try {
      if (!FD_TAB_IDS.includes(tabId)) return res.status(400).json({ error: 'Invalid tab' });
      if (req.user?.role === 'super_admin') return next();
      const r = await query(
        `SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id = @tid`,
        { uid: req.user.id, tid: tabId }
      );
      if (!r.recordset?.length) return res.status(403).json({ error: 'No access to this Fuel Data tab.' });
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireFuelDataAnyTab(tabIds) {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'super_admin') return next();
      for (const tabId of ids) {
        if (!FD_TAB_IDS.includes(tabId)) continue;
        const r = await query(`SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id = @tid`, {
          uid: req.user.id,
          tid: tabId,
        });
        if (r.recordset?.length) return next();
      }
      return res.status(403).json({ error: 'No access to this Fuel Data tab.' });
    } catch (e) {
      next(e);
    }
  };
}

/** Match SQL Server / client GUID strings (not strict RFC — e.g. legacy MS third segments like D011). */
function isGuidString(p) {
  if (!p || typeof p !== 'string') return false;
  const s = p.trim();
  // Hyphenated 8-4-4-4-12 hex (case-insensitive)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  // 32 hex chars without hyphens
  if (/^[0-9a-f]{32}$/i.test(s)) return true;
  return false;
}

/** Normalize to hyphenated lowercase GUID for SQL UNIQUEIDENTIFIER params. */
function normalizeGuidForSql(p) {
  const s = String(p).trim();
  if (/^[0-9a-f]{32}$/i.test(s)) {
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`.toLowerCase();
  }
  return s.toLowerCase();
}

/** Parse comma-separated GUIDs for id IN (...) — max 300, validated. */
function parseTransactionIdsParam(raw) {
  if (raw == null) return [];
  const s = Array.isArray(raw) ? raw.join(',') : String(raw);
  if (!String(s).trim()) return [];
  const seen = new Set();
  const out = [];
  for (const part of String(s).split(',')) {
    const p = part.trim();
    if (!isGuidString(p)) continue;
    const norm = normalizeGuidForSql(p);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 300) break;
  }
  return out;
}

/** Build WHERE for tenant + optional filters (querystring or body-like object). */
function buildTxWhereClause(qs, tid, opts = {}) {
  const params = { tid };
  const cond = ['tenant_id = @tid'];
  const idList = parseTransactionIdsParam(qs?.ids);

  if (idList.length) {
    idList.forEach((id, i) => {
      params[`eid${i}`] = id;
    });
    cond.push(`id IN (${idList.map((_, i) => `@eid${i}`).join(', ')})`);
    const statusRaw = (qs?.status ?? qs?.verification ?? opts.defaultVerification ?? 'all').toString().toLowerCase();
    if (statusRaw === 'verified') cond.push(`verification_status = N'verified'`);
    else if (statusRaw === 'unverified') cond.push(`verification_status = N'unverified'`);
    return { whereSql: `WHERE ${cond.join(' AND ')}`, params };
  }

  const statusRaw = (qs?.status ?? qs?.verification ?? opts.defaultVerification ?? 'all').toString().toLowerCase();
  if (statusRaw === 'verified') cond.push(`verification_status = N'verified'`);
  else if (statusRaw === 'unverified') cond.push(`verification_status = N'unverified'`);

  if (qs?.supplier_id) {
    cond.push('supplier_id = @supplierId');
    params.supplierId = qs.supplier_id;
  }
  if (qs?.customer_id) {
    cond.push('customer_id = @customerId');
    params.customerId = qs.customer_id;
  }
  if (qs?.source) {
    cond.push('source = @txsource');
    params.txsource = String(qs.source);
  }
  if (qs?.date_from) {
    cond.push('(delivery_time IS NULL OR delivery_time >= @dateFrom)');
    params.dateFrom = new Date(qs.date_from);
  }
  if (qs?.date_to) {
    const end = new Date(qs.date_to);
    end.setHours(23, 59, 59, 999);
    cond.push('(delivery_time IS NULL OR delivery_time <= @dateTo)');
    params.dateTo = end;
  }
  if (qs?.q && String(qs.q).trim()) {
    const esc = String(qs.q).trim().replace(/%/g, '').replace(/_/g, '').replace(/\[/g, '');
    cond.push(
      `(supplier_name LIKE @search OR customer_name LIKE @search OR ISNULL(vehicle_tank,'') LIKE @search OR ISNULL(vehicle_registration,'') LIKE @search OR ISNULL(supplier_vehicle_registration,'') LIKE @search OR ISNULL(order_number,'') LIKE @search OR ISNULL(responsible_user_name,'') LIKE @search OR ISNULL(fuel_attendant_name,'') LIKE @search OR ISNULL(authorizer_name,'') LIKE @search)`
    );
    params.search = `%${esc}%`;
  }
  return { whereSql: `WHERE ${cond.join(' AND ')}`, params };
}

function safeResolveUnderRoot(root, relative) {
  if (!relative || typeof relative !== 'string') return null;
  const norm = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..')) return null;
  const abs = path.resolve(path.join(root, norm));
  const rootR = path.resolve(root);
  if (!abs.startsWith(rootR + path.sep) && abs !== rootR) return null;
  return abs;
}

function mapSupplier(row) {
  if (!row) return null;
  const def = get(row, 'is_default');
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    name: get(row, 'name'),
    logo_file_path: get(row, 'logo_file_path') || null,
    address: get(row, 'address') || null,
    vat_number: get(row, 'vat_number') || null,
    price_per_litre: get(row, 'price_per_litre') != null ? Number(get(row, 'price_per_litre')) : null,
    vehicle_registration: get(row, 'vehicle_registration') || null,
    fuel_attendant_name: get(row, 'fuel_attendant_name') || null,
    is_default: def === true || def === 1 || def === '1',
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

async function resolveDefaultSupplierIdForTenant(tid) {
  if (!tid) return null;
  const d = await query(`SELECT TOP 1 id FROM fuel_data_suppliers WHERE tenant_id = @tid AND is_default = 1`, { tid });
  if (d.recordset?.[0]) return String(get(d.recordset[0], 'id'));
  const all = await query(`SELECT id FROM fuel_data_suppliers WHERE tenant_id = @tid`, { tid });
  const list = all.recordset || [];
  if (list.length === 1) return String(get(list[0], 'id'));
  return null;
}

async function clearOtherSupplierDefaults(tid, keepId) {
  await query(`UPDATE fuel_data_suppliers SET is_default = 0, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tid AND id <> @kid`, {
    tid,
    kid: keepId,
  });
}

function mapCustomer(row) {
  if (!row) return null;
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    name: get(row, 'name'),
    vehicle_registration: get(row, 'vehicle_registration') || null,
    responsible_user_name: get(row, 'responsible_user_name') || null,
    authorizer_name: get(row, 'authorizer_name') || null,
    created_at: get(row, 'created_at'),
  };
}

function mapTransaction(row) {
  if (!row) return null;
  const rawId = get(row, 'id');
  let idStr = rawId;
  if (Buffer.isBuffer(rawId) && rawId.length === 16) {
    idStr = normalizeGuidForSql(rawId.toString('hex'));
  } else if (rawId != null && isGuidString(String(rawId))) {
    idStr = normalizeGuidForSql(String(rawId));
  } else if (rawId != null) {
    idStr = String(rawId);
  }
  return {
    id: idStr,
    tenant_id: get(row, 'tenant_id'),
    supplier_id: get(row, 'supplier_id') || null,
    supplier_name: get(row, 'supplier_name'),
    customer_id: get(row, 'customer_id') || null,
    customer_name: get(row, 'customer_name'),
    vehicle_tank: get(row, 'vehicle_tank') || null,
    vehicle_registration: get(row, 'vehicle_registration') || null,
    delivery_time: get(row, 'delivery_time'),
    kilos: get(row, 'kilos') != null ? Number(get(row, 'kilos')) : null,
    responsible_user_name: get(row, 'responsible_user_name') || null,
    pump_start: get(row, 'pump_start') != null ? Number(get(row, 'pump_start')) : null,
    pump_stop: get(row, 'pump_stop') != null ? Number(get(row, 'pump_stop')) : null,
    liters_filled: get(row, 'liters_filled') != null ? Number(get(row, 'liters_filled')) : null,
    fuel_attendant_name: get(row, 'fuel_attendant_name') || null,
    authorizer_name: get(row, 'authorizer_name') || null,
    price_per_litre: get(row, 'price_per_litre') != null ? Number(get(row, 'price_per_litre')) : null,
    amount_rand: get(row, 'amount_rand') != null ? Number(get(row, 'amount_rand')) : null,
    verification_status: get(row, 'verification_status'),
    source: get(row, 'source'),
    slip_image_path: get(row, 'slip_image_path') || null,
    order_number: get(row, 'order_number') || null,
    supplier_vehicle_registration: get(row, 'supplier_vehicle_registration') || null,
    created_by_user_id: get(row, 'created_by_user_id') || null,
    verified_by_user_id: get(row, 'verified_by_user_id') || null,
    verified_at: get(row, 'verified_at'),
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

async function computeLitersAndAmount(body, supplierPrice) {
  const ps = body.pump_start != null && body.pump_start !== '' ? Number(body.pump_start) : null;
  const pe = body.pump_stop != null && body.pump_stop !== '' ? Number(body.pump_stop) : null;
  let liters = body.liters_filled != null && body.liters_filled !== '' ? Number(body.liters_filled) : null;
  if (liters == null && ps != null && pe != null && !Number.isNaN(ps) && !Number.isNaN(pe)) {
    liters = Math.max(0, pe - ps);
  }
  const price = supplierPrice != null ? Number(supplierPrice) : body.price_per_litre != null ? Number(body.price_per_litre) : null;
  let amount = null;
  if (liters != null && !Number.isNaN(liters) && price != null && !Number.isNaN(price)) {
    amount = Math.round(liters * price * 100) / 100;
  }
  return { liters, price, amount };
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('fuel_data'));

router.get('/my-tabs', async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') return res.json({ tabs: FD_TAB_IDS });
    const r = await query(`SELECT tab_id FROM fuel_data_tab_grants WHERE user_id = @uid`, { uid: req.user.id });
    const tabs = (r.recordset || []).map((row) => get(row, 'tab_id')).filter((id) => FD_TAB_IDS.includes(id));
    res.json({ tabs });
  } catch (e) {
    next(e);
  }
});

router.get('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.user_id, g.tab_id, g.granted_at, u.full_name, u.email
       FROM fuel_data_tab_grants g
       JOIN users u ON u.id = g.user_id
       ORDER BY u.full_name, g.tab_id`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      const uid = get(row, 'user_id');
      if (!byUser[uid]) {
        byUser[uid] = {
          user_id: uid,
          full_name: get(row, 'full_name'),
          email: get(row, 'email'),
          tabs: [],
        };
      }
      byUser[uid].tabs.push(get(row, 'tab_id'));
    }
    res.json({ permissions: Object.values(byUser), allTabIds: FD_TAB_IDS });
  } catch (e) {
    next(e);
  }
});

router.post('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.body || {};
    if (!user_id || !tab_id || !FD_TAB_IDS.includes(tab_id)) {
      return res.status(400).json({ error: 'user_id and valid tab_id required' });
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM fuel_data_tab_grants WHERE user_id = @userId AND tab_id = @tabId)
       INSERT INTO fuel_data_tab_grants (user_id, tab_id, granted_by_user_id) VALUES (@userId, @tabId, @grantedBy)`,
      { userId: user_id, tabId: tab_id, grantedBy: req.user.id }
    );
    res.status(201).json({ granted: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.query;
    if (!user_id || !tab_id) return res.status(400).json({ error: 'user_id and tab_id required' });
    await query(`DELETE FROM fuel_data_tab_grants WHERE user_id = @userId AND tab_id = @tabId`, {
      userId: user_id,
      tabId: tab_id,
    });
    res.json({ revoked: true });
  } catch (e) {
    next(e);
  }
});

/** Suppliers (readable on supplier tab or fuel admin for form pickers) */
router.get('/suppliers', async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      const gr = await query(
        `SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id IN (N'supplier_details', N'fuel_admin', N'advanced_dashboard')`,
        { uid: req.user.id }
      );
      if (!gr.recordset?.length) {
        return res.status(403).json({ error: 'No access to supplier list.' });
      }
    }
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(`SELECT * FROM fuel_data_suppliers WHERE tenant_id = @tid ORDER BY is_default DESC, name`, { tid });
    res.json({ suppliers: (r.recordset || []).map(mapSupplier) });
  } catch (e) {
    next(e);
  }
});

router.post('/suppliers', requireFuelDataTab('supplier_details'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant context' });
    const { name, address, vat_number, price_per_litre, vehicle_registration, fuel_attendant_name, is_default } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Supplier name required' });
    const price = price_per_litre != null && price_per_litre !== '' ? Number(price_per_litre) : 0;
    const def0 = is_default === true || is_default === 1 || is_default === '1' ? 1 : 0;
    const ins = await query(
      `INSERT INTO fuel_data_suppliers (tenant_id, name, address, vat_number, price_per_litre, vehicle_registration, fuel_attendant_name, is_default, created_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@tid, @name, @addr, @vat, @price, @vreg, @fan, @isdef, @uid)`,
      {
        tid,
        name: String(name).trim(),
        addr: address != null ? String(address) : null,
        vat: vat_number != null ? String(vat_number) : null,
        price: Number.isFinite(price) ? price : 0,
        vreg: vehicle_registration != null ? String(vehicle_registration) : null,
        fan: fuel_attendant_name != null ? String(fuel_attendant_name) : null,
        isdef: def0,
        uid: req.user.id,
      }
    );
    const row = ins.recordset?.[0];
    let outRow = row;
    if (def0 && row) {
      const newId = get(row, 'id');
      await clearOtherSupplierDefaults(tid, newId);
      await query(`UPDATE fuel_data_suppliers SET is_default = 1, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tid`, {
        id: newId,
        tid,
      });
      const again = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id: newId, tid });
      outRow = again.recordset?.[0] || row;
    }
    res.status(201).json({ supplier: mapSupplier(outRow) });
  } catch (e) {
    next(e);
  }
});

router.patch('/suppliers/:id', requireFuelDataTab('supplier_details'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id, tid });
    if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Supplier not found' });
    const { name, address, vat_number, price_per_litre, vehicle_registration, fuel_attendant_name, is_default } = req.body || {};
    const sets = [];
    const params = { id, tid };
    if (name != null) {
      sets.push('name = @name');
      params.name = String(name).trim();
    }
    if (address !== undefined) {
      sets.push('address = @address');
      params.address = address;
    }
    if (vat_number !== undefined) {
      sets.push('vat_number = @vat');
      params.vat = vat_number;
    }
    if (vehicle_registration !== undefined) {
      sets.push('vehicle_registration = @vreg');
      params.vreg = vehicle_registration;
    }
    if (fuel_attendant_name !== undefined) {
      sets.push('fuel_attendant_name = @fan');
      params.fan = fuel_attendant_name;
    }
    if (price_per_litre != null && price_per_litre !== '') {
      sets.push('price_per_litre = @price');
      params.price = Number(price_per_litre);
    }
    if (is_default !== undefined) {
      if (is_default === true || is_default === 1 || is_default === '1') {
        await clearOtherSupplierDefaults(tid, id);
        sets.push('is_default = 1');
      } else {
        sets.push('is_default = 0');
      }
    }
    if (!sets.length) return res.json({ supplier: mapSupplier(cur.recordset[0]) });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE fuel_data_suppliers SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tid`, params);
    const again = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id, tid });
    res.json({ supplier: mapSupplier(again.recordset[0]) });
  } catch (e) {
    next(e);
  }
});

router.post('/suppliers/:id/logo', requireFuelDataTab('supplier_details'), (req, res, next) => {
  logoUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const tid = tenantId(req);
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ error: 'logo file required' });
      const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
      const cur = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id, tid });
      if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Supplier not found' });
      const old = get(cur.recordset[0], 'logo_file_path');
      if (old) {
        const oldAbs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), old);
        if (oldAbs && fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      }
      await query(`UPDATE fuel_data_suppliers SET logo_file_path = @p, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tid`, {
        p: rel,
        id,
        tid,
      });
      const again = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id, tid });
      res.json({ supplier: mapSupplier(again.recordset[0]) });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/suppliers/:id/logo', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const r = await query(`SELECT logo_file_path FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id, tid });
    const row = r.recordset?.[0];
    const rel = row ? get(row, 'logo_file_path') : null;
    if (!rel) return res.status(404).json({ error: 'No logo' });
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.sendFile(abs);
  } catch (e) {
    next(e);
  }
});

/** Customers (customer tab or fuel admin for pickers) */
router.get('/customers', async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      const gr = await query(
        `SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id IN (N'customer_details', N'fuel_admin', N'advanced_dashboard')`,
        { uid: req.user.id }
      );
      if (!gr.recordset?.length) {
        return res.status(403).json({ error: 'No access to customer list.' });
      }
    }
    const tid = tenantId(req);
    if (!tid) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(`SELECT * FROM fuel_data_customers WHERE tenant_id = @tid ORDER BY name`, { tid });
    res.json({ customers: (r.recordset || []).map(mapCustomer) });
  } catch (e) {
    next(e);
  }
});

router.post('/customers', requireFuelDataTab('customer_details'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { name, vehicle_registration, responsible_user_name, authorizer_name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Customer name required' });
    await query(
      `INSERT INTO fuel_data_customers (tenant_id, name, vehicle_registration, responsible_user_name, authorizer_name)
       OUTPUT INSERTED.* VALUES (@tid, @name, @vreg, @run, @authn)`,
      {
        tid,
        name: String(name).trim(),
        vreg: vehicle_registration != null ? String(vehicle_registration) : null,
        run: responsible_user_name != null ? String(responsible_user_name) : null,
        authn: authorizer_name != null ? String(authorizer_name) : null,
      }
    );
    const row = (await query(`SELECT TOP 1 * FROM fuel_data_customers WHERE tenant_id = @tid ORDER BY created_at DESC`, { tid }))
      .recordset?.[0];
    res.status(201).json({ customer: mapCustomer(row) });
  } catch (e) {
    next(e);
  }
});

router.patch('/customers/:id', requireFuelDataTab('customer_details'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT * FROM fuel_data_customers WHERE id = @id AND tenant_id = @tid`, { id, tid });
    if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Customer not found' });
    const { name, vehicle_registration, responsible_user_name, authorizer_name } = req.body || {};
    const sets = [];
    const params = { id, tid };
    if (name != null) {
      sets.push('name = @name');
      params.name = String(name).trim();
    }
    if (vehicle_registration !== undefined) {
      sets.push('vehicle_registration = @vreg');
      params.vreg = vehicle_registration;
    }
    if (responsible_user_name !== undefined) {
      sets.push('responsible_user_name = @run');
      params.run = responsible_user_name;
    }
    if (authorizer_name !== undefined) {
      sets.push('authorizer_name = @authn');
      params.authn = authorizer_name;
    }
    if (!sets.length) return res.json({ customer: mapCustomer(cur.recordset[0]) });
    await query(`UPDATE fuel_data_customers SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tid`, params);
    const again = await query(`SELECT * FROM fuel_data_customers WHERE id = @id AND tenant_id = @tid`, { id, tid });
    res.json({ customer: mapCustomer(again.recordset[0]) });
  } catch (e) {
    next(e);
  }
});

router.get('/customers/:customerId/receipts', requireFuelDataTab('customer_details'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { customerId } = req.params;
    const r = await query(
      `SELECT r.* FROM fuel_data_customer_receipts r
       INNER JOIN fuel_data_customers c ON c.id = r.customer_id
       WHERE r.customer_id = @cid AND r.tenant_id = @tid AND c.tenant_id = @tid`,
      { cid: customerId, tid }
    );
    res.json({
      receipts: (r.recordset || []).map((row) => ({
        id: get(row, 'id'),
        customer_id: get(row, 'customer_id'),
        file_path: get(row, 'file_path'),
        original_name: get(row, 'original_name'),
        created_at: get(row, 'created_at'),
        download_url: `/api/fuel-data/files/${get(row, 'id')}/download`,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/customers/:customerId/receipts', requireFuelDataTab('customer_details'), (req, res, next) => {
  receiptUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const tid = tenantId(req);
      const { customerId } = req.params;
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const chk = await query(`SELECT id FROM fuel_data_customers WHERE id = @cid AND tenant_id = @tid`, { cid: customerId, tid });
      if (!chk.recordset?.length) return res.status(404).json({ error: 'Customer not found' });
      const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
      await query(
        `INSERT INTO fuel_data_customer_receipts (tenant_id, customer_id, file_path, original_name, uploaded_by_user_id)
         OUTPUT INSERTED.* VALUES (@tid, @cid, @fp, @on, @uid)`,
        {
          tid,
          cid: customerId,
          fp: rel,
          on: req.file.originalname || null,
          uid: req.user.id,
        }
      );
      const row = (
        await query(
          `SELECT TOP 1 * FROM fuel_data_customer_receipts WHERE customer_id = @cid ORDER BY created_at DESC`,
          { cid: customerId }
        )
      ).recordset?.[0];
      res.status(201).json({
        receipt: {
          id: get(row, 'id'),
          file_path: get(row, 'file_path'),
          original_name: get(row, 'original_name'),
          created_at: get(row, 'created_at'),
          download_url: `/api/fuel-data/files/${get(row, 'id')}/download`,
        },
      });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/files/:fileId/download', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { fileId } = req.params;
    const r = await query(
      `SELECT r.file_path, r.original_name FROM fuel_data_customer_receipts r
       WHERE r.id = @fid AND r.tenant_id = @tid`,
      { fid: fileId, tid }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const rel = get(row, 'file_path');
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.download(abs, get(row, 'original_name') || 'receipt');
  } catch (e) {
    next(e);
  }
});

/** Transactions (filters: status, supplier_id, customer_id, date_from, date_to, source, q) */
router.get('/transactions', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const w = buildTxWhereClause(req.query, tid, {});
    const r = await query(
      `SELECT * FROM fuel_data_transactions ${w.whereSql} ORDER BY delivery_time DESC, created_at DESC`,
      w.params
    );
    res.json({ transactions: (r.recordset || []).map(mapTransaction) });
  } catch (e) {
    next(e);
  }
});

router.get('/transactions/:id', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const r = await query(`SELECT * FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const att = await query(
      `SELECT id, file_path, original_name, created_at FROM fuel_data_transaction_attachments WHERE transaction_id = @id AND tenant_id = @tid ORDER BY created_at`,
      { id, tid }
    );
    res.json({
      transaction: mapTransaction(row),
      attachments: (att.recordset || []).map((a) => ({
        id: get(a, 'id'),
        original_name: get(a, 'original_name'),
        created_at: get(a, 'created_at'),
        download_url: `/api/fuel-data/transaction-files/${get(a, 'id')}/download`,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/transactions/:id', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT * FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    let supplierPrice = body.price_per_litre;
    if (body.supplier_id) {
      const s = await query(`SELECT price_per_litre FROM fuel_data_suppliers WHERE id = @sid AND tenant_id = @tid`, {
        sid: body.supplier_id,
        tid,
      });
      const sr = s.recordset?.[0];
      if (sr) supplierPrice = get(sr, 'price_per_litre');
    }
    const merged = {
      supplier_id: body.supplier_id !== undefined ? body.supplier_id : get(cur.recordset[0], 'supplier_id'),
      supplier_name: body.supplier_name !== undefined ? body.supplier_name : get(cur.recordset[0], 'supplier_name'),
      customer_id: body.customer_id !== undefined ? body.customer_id : get(cur.recordset[0], 'customer_id'),
      customer_name: body.customer_name !== undefined ? body.customer_name : get(cur.recordset[0], 'customer_name'),
      vehicle_tank: body.vehicle_tank !== undefined ? body.vehicle_tank : get(cur.recordset[0], 'vehicle_tank'),
      vehicle_registration: body.vehicle_registration !== undefined ? body.vehicle_registration : get(cur.recordset[0], 'vehicle_registration'),
      supplier_vehicle_registration:
        body.supplier_vehicle_registration !== undefined
          ? body.supplier_vehicle_registration
          : get(cur.recordset[0], 'supplier_vehicle_registration'),
      order_number: body.order_number !== undefined ? body.order_number : get(cur.recordset[0], 'order_number'),
      delivery_time: body.delivery_time !== undefined ? body.delivery_time : get(cur.recordset[0], 'delivery_time'),
      kilos: body.kilos !== undefined ? body.kilos : get(cur.recordset[0], 'kilos'),
      responsible_user_name: body.responsible_user_name !== undefined ? body.responsible_user_name : get(cur.recordset[0], 'responsible_user_name'),
      pump_start: body.pump_start !== undefined ? body.pump_start : get(cur.recordset[0], 'pump_start'),
      pump_stop: body.pump_stop !== undefined ? body.pump_stop : get(cur.recordset[0], 'pump_stop'),
      liters_filled: body.liters_filled !== undefined ? body.liters_filled : get(cur.recordset[0], 'liters_filled'),
      fuel_attendant_name: body.fuel_attendant_name !== undefined ? body.fuel_attendant_name : get(cur.recordset[0], 'fuel_attendant_name'),
      authorizer_name: body.authorizer_name !== undefined ? body.authorizer_name : get(cur.recordset[0], 'authorizer_name'),
      price_per_litre: body.price_per_litre !== undefined ? body.price_per_litre : get(cur.recordset[0], 'price_per_litre'),
    };
    const { liters, price, amount } = await computeLitersAndAmount(
      {
        pump_start: merged.pump_start,
        pump_stop: merged.pump_stop,
        liters_filled: merged.liters_filled,
        price_per_litre: merged.price_per_litre,
      },
      supplierPrice
    );
    await query(
      `UPDATE fuel_data_transactions SET
        supplier_id = @sid, supplier_name = @sname, customer_id = @cid, customer_name = @cname,
        vehicle_tank = @vt, vehicle_registration = @vreg, supplier_vehicle_registration = @svreg, order_number = @ord, delivery_time = @dt, kilos = @kilos,
        responsible_user_name = @run, pump_start = @pstart, pump_stop = @pstop, liters_filled = @liters,
        fuel_attendant_name = @fan, authorizer_name = @authn, price_per_litre = @price, amount_rand = @amt,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tid`,
      {
        id,
        tid,
        sid: merged.supplier_id || null,
        sname: String(merged.supplier_name || '').trim() || 'Unknown',
        cid: merged.customer_id || null,
        cname: String(merged.customer_name || '').trim() || 'Unknown',
        vt: merged.vehicle_tank != null ? String(merged.vehicle_tank) : null,
        vreg: merged.vehicle_registration != null ? String(merged.vehicle_registration) : null,
        svreg: merged.supplier_vehicle_registration != null ? String(merged.supplier_vehicle_registration) : null,
        ord: merged.order_number != null && String(merged.order_number).trim() !== '' ? String(merged.order_number).trim() : null,
        dt: merged.delivery_time ? new Date(merged.delivery_time) : null,
        kilos: merged.kilos != null && merged.kilos !== '' ? Number(merged.kilos) : null,
        run: merged.responsible_user_name != null ? String(merged.responsible_user_name) : null,
        pstart: merged.pump_start != null && merged.pump_start !== '' ? Number(merged.pump_start) : null,
        pstop: merged.pump_stop != null && merged.pump_stop !== '' ? Number(merged.pump_stop) : null,
        liters: liters != null ? liters : merged.liters_filled != null ? Number(merged.liters_filled) : null,
        fan: merged.fuel_attendant_name != null ? String(merged.fuel_attendant_name) : null,
        authn: merged.authorizer_name != null ? String(merged.authorizer_name) : null,
        price: price != null ? price : null,
        amt: amount != null ? amount : null,
      }
    );
    const again = await query(`SELECT * FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    res.json({ transaction: mapTransaction(again.recordset[0]) });
  } catch (e) {
    next(e);
  }
});

router.post('/transactions/:id/attachments', requireFuelDataTab('fuel_admin'), (req, res, next) => {
  txAttachUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const tid = tenantId(req);
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const chk = await query(`SELECT id FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
      if (!chk.recordset?.length) return res.status(404).json({ error: 'Transaction not found' });
      const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
      await query(
        `INSERT INTO fuel_data_transaction_attachments (tenant_id, transaction_id, file_path, original_name, uploaded_by_user_id)
         OUTPUT INSERTED.* VALUES (@tid, @txid, @fp, @on, @uid)`,
        { tid, txid: id, fp: rel, on: req.file.originalname || null, uid: req.user.id }
      );
      const row = (
        await query(
          `SELECT TOP 1 * FROM fuel_data_transaction_attachments WHERE transaction_id = @id ORDER BY created_at DESC`,
          { id }
        )
      ).recordset?.[0];
      res.status(201).json({
        attachment: {
          id: get(row, 'id'),
          download_url: `/api/fuel-data/transaction-files/${get(row, 'id')}/download`,
          original_name: get(row, 'original_name'),
        },
      });
    } catch (e) {
      next(e);
    }
  });
});

router.get('/transaction-files/:fileId/download', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { fileId } = req.params;
    const r = await query(
      `SELECT a.file_path, a.original_name, a.transaction_id FROM fuel_data_transaction_attachments a
       WHERE a.id = @fid AND a.tenant_id = @tid`,
      { fid: fileId, tid }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const rel = get(row, 'file_path');
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.download(abs, get(row, 'original_name') || 'attachment');
  } catch (e) {
    next(e);
  }
});

router.delete('/transaction-files/:fileId', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { fileId } = req.params;
    const r = await query(
      `SELECT id, file_path FROM fuel_data_transaction_attachments WHERE id = @fid AND tenant_id = @tid`,
      { fid: fileId, tid }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const rel = get(row, 'file_path');
    const abs = rel ? safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), rel) : null;
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (_) {
        /* ignore unlink errors */
      }
    }
    await query(`DELETE FROM fuel_data_transaction_attachments WHERE id = @fid AND tenant_id = @tid`, { fid: fileId, tid });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/transactions', async (req, res, next) => {
  try {
    const body = req.body || {};
    const tabNeeded = body.source === 'attendant_portal' ? 'attendant_portal' : 'fuel_admin';
    if (req.user.role !== 'super_admin') {
      const gr = await query(`SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id = @tid`, {
        uid: req.user.id,
        tid: tabNeeded,
      });
      if (!gr.recordset?.length) {
        return res.status(403).json({ error: 'No access to create this transaction (tab permission).' });
      }
    }
    const tid = tenantId(req);
    const source = body.source === 'attendant_portal' ? 'attendant_portal' : 'manual';
    const verification_status = source === 'attendant_portal' ? 'unverified' : 'verified';
    if (source === 'attendant_portal' && (!body.supplier_id || String(body.supplier_id).trim() === '')) {
      const rid = await resolveDefaultSupplierIdForTenant(tid);
      if (rid) body.supplier_id = rid;
    }
    let supplierPrice = body.price_per_litre;
    if (body.supplier_id) {
      const s = await query(
        `SELECT price_per_litre, name, vehicle_registration, fuel_attendant_name FROM fuel_data_suppliers WHERE id = @sid AND tenant_id = @tid`,
        {
          sid: body.supplier_id,
          tid,
        }
      );
      const sr = s.recordset?.[0];
      if (sr) {
        supplierPrice = get(sr, 'price_per_litre');
        if (!body.supplier_name) body.supplier_name = get(sr, 'name');
        if (source !== 'attendant_portal' && (body.vehicle_registration == null || body.vehicle_registration === '')) {
          body.vehicle_registration = get(sr, 'vehicle_registration');
        }
        if (body.supplier_vehicle_registration == null || body.supplier_vehicle_registration === '') {
          const sreg = get(sr, 'vehicle_registration');
          if (sreg != null && String(sreg).trim() !== '') body.supplier_vehicle_registration = String(sreg).trim();
        }
        if (body.fuel_attendant_name == null || body.fuel_attendant_name === '') {
          body.fuel_attendant_name = get(sr, 'fuel_attendant_name');
        }
      }
    }
    if (body.customer_id) {
      const c = await query(
        `SELECT responsible_user_name, authorizer_name, vehicle_registration FROM fuel_data_customers WHERE id = @cid AND tenant_id = @tid`,
        { cid: body.customer_id, tid }
      );
      const cr = c.recordset?.[0];
      if (cr) {
        if (body.responsible_user_name == null || body.responsible_user_name === '') {
          body.responsible_user_name = get(cr, 'responsible_user_name');
        }
        if (body.authorizer_name == null || body.authorizer_name === '') {
          body.authorizer_name = get(cr, 'authorizer_name');
        }
        if (body.vehicle_registration == null || body.vehicle_registration === '') {
          body.vehicle_registration = get(cr, 'vehicle_registration');
        }
      }
    }
    const { liters, price, amount } = await computeLitersAndAmount(body, supplierPrice);
    const slipRel = body.slip_image_path ? String(body.slip_image_path).trim() : null;
    if (slipRel) {
      const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), slipRel);
      if (!abs || !fs.existsSync(abs)) return res.status(400).json({ error: 'Invalid slip path' });
    }
    const ins = await query(
      `INSERT INTO fuel_data_transactions (
        tenant_id, supplier_id, supplier_name, customer_id, customer_name, vehicle_tank, vehicle_registration, supplier_vehicle_registration, delivery_time,
        kilos, responsible_user_name, pump_start, pump_stop, liters_filled, fuel_attendant_name, authorizer_name,
        price_per_litre, amount_rand, verification_status, source, slip_image_path, order_number, created_by_user_id,
        verified_by_user_id, verified_at
      )
      OUTPUT INSERTED.*
      VALUES (
        @tid, @sid, @sname, @cid, @cname, @vt, @vreg, @svreg, @dt,
        @kilos, @run, @pstart, @pstop, @liters, @fan, @authn,
        @price, @amt, @vstat, @src, @slip, @ord, @uid,
        @vby, @vat
      )`,
      {
        tid,
        sid: body.supplier_id || null,
        sname: String(body.supplier_name || '').trim() || 'Unknown',
        cid: body.customer_id || null,
        cname: String(body.customer_name || '').trim() || 'Unknown',
        vt: body.vehicle_tank != null ? String(body.vehicle_tank) : null,
        vreg: body.vehicle_registration != null ? String(body.vehicle_registration) : null,
        svreg: body.supplier_vehicle_registration != null ? String(body.supplier_vehicle_registration) : null,
        dt: body.delivery_time ? new Date(body.delivery_time) : null,
        kilos: body.kilos != null && body.kilos !== '' ? Number(body.kilos) : null,
        run: body.responsible_user_name != null ? String(body.responsible_user_name) : null,
        pstart: body.pump_start != null && body.pump_start !== '' ? Number(body.pump_start) : null,
        pstop: body.pump_stop != null && body.pump_stop !== '' ? Number(body.pump_stop) : null,
        liters: liters != null ? liters : null,
        fan: body.fuel_attendant_name != null ? String(body.fuel_attendant_name) : null,
        authn: body.authorizer_name != null ? String(body.authorizer_name) : null,
        price: price != null ? price : null,
        amt: amount != null ? amount : null,
        vstat: verification_status,
        src: source,
        slip: slipRel,
        ord: body.order_number != null && String(body.order_number).trim() !== '' ? String(body.order_number).trim() : null,
        uid: req.user.id,
        vby: verification_status === 'verified' ? req.user.id : null,
        vat: verification_status === 'verified' ? new Date() : null,
      }
    );
    const row = ins.recordset?.[0];
    res.status(201).json({ transaction: mapTransaction(row) });
  } catch (e) {
    next(e);
  }
});

router.get('/transactions/:id/slip-image', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT slip_image_path FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    const rel = get(cur.recordset?.[0], 'slip_image_path');
    if (!rel) return res.status(404).json({ error: 'No slip' });
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), rel);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.sendFile(abs);
  } catch (e) {
    next(e);
  }
});

router.post('/transactions/:id/verify', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT * FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    await query(
      `UPDATE fuel_data_transactions SET verification_status = N'verified', verified_by_user_id = @uid, verified_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tid`,
      { id, tid, uid: req.user.id }
    );
    const again = await query(`SELECT * FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    res.json({ transaction: mapTransaction(again.recordset[0]) });
  } catch (e) {
    next(e);
  }
});

router.delete('/transactions/:id', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const cur = await query(`SELECT id FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    if (!cur.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    await query(`DELETE FROM fuel_data_transactions WHERE id = @id AND tenant_id = @tid`, { id, tid });
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

router.post('/transactions/bulk-delete', requireFuelDataTab('fuel_admin'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const raw = req.body?.ids;
    const idList = Array.isArray(raw) ? parseTransactionIdsParam(raw.join(',')) : parseTransactionIdsParam(raw);
    if (!idList.length) return res.status(400).json({ error: 'Provide ids: array of transaction GUIDs' });
    const params = { tid };
    idList.forEach((id, i) => {
      params[`eid${i}`] = id;
    });
    const inList = idList.map((_, i) => `@eid${i}`).join(', ');
    await query(`DELETE FROM fuel_data_transactions WHERE tenant_id = @tid AND id IN (${inList})`, params);
    res.json({ deleted: idList.length });
  } catch (e) {
    next(e);
  }
});

async function rowsForExport(tid, queryLike, defaultVerification = 'verified') {
  const w = buildTxWhereClause(queryLike, tid, { defaultVerification });
  const r = await query(
    `SELECT * FROM fuel_data_transactions ${w.whereSql} ORDER BY delivery_time DESC, created_at DESC`,
    w.params
  );
  return (r.recordset || []).map(mapTransaction);
}

/** Whitelist for Excel/PDF column selection (order = default column order). */
const FUEL_EXPORT_COLUMN_DEFS = [
  { key: 'supplier_name', header: 'Supplier', width: 22, pdfWeight: 1.15, numeric: false },
  { key: 'customer_name', header: 'Customer', width: 22, pdfWeight: 1.15, numeric: false },
  { key: 'vehicle_tank', header: 'Vehicle / tank', width: 18, pdfWeight: 0.95, numeric: false },
  { key: 'order_number', header: 'Order No.', width: 12, pdfWeight: 0.55, numeric: false },
  { key: 'vehicle_registration', header: 'Customer vehicle (fleet)', width: 16, pdfWeight: 0.8, numeric: false },
  { key: 'supplier_vehicle_registration', header: 'Supplier vehicle', width: 16, pdfWeight: 0.65, numeric: false },
  { key: 'delivery_time', header: 'Delivery time', width: 20, pdfWeight: 1.1, numeric: false },
  { key: 'kilos', header: 'Kilos', width: 10, pdfWeight: 0.55, numeric: true },
  { key: 'responsible_user_name', header: 'Responsible user', width: 18, pdfWeight: 0.95, numeric: false },
  { key: 'pump_start', header: 'Pump start', width: 11, pdfWeight: 0.6, numeric: true },
  { key: 'pump_stop', header: 'Pump stop', width: 11, pdfWeight: 0.6, numeric: true },
  { key: 'liters_filled', header: 'Liters', width: 11, pdfWeight: 0.65, numeric: true },
  { key: 'price_per_litre', header: 'R/L', width: 10, pdfWeight: 0.55, numeric: true },
  { key: 'amount_rand', header: 'Amount (ZAR)', width: 14, pdfWeight: 0.75, numeric: true },
  { key: 'fuel_attendant_name', header: 'Attendant', width: 16, pdfWeight: 0.85, numeric: false },
  { key: 'authorizer_name', header: 'Authorizer', width: 16, pdfWeight: 0.85, numeric: false },
  { key: 'source', header: 'Source', width: 12, pdfWeight: 0.65, numeric: false },
];
const FUEL_EXPORT_KEYS = FUEL_EXPORT_COLUMN_DEFS.map((d) => d.key);
const FUEL_EXPORT_COLUMN_MAP = Object.fromEntries(FUEL_EXPORT_COLUMN_DEFS.map((d) => [d.key, d]));

function colLetter0(index0) {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseExportColumns(raw) {
  const allowed = new Set(FUEL_EXPORT_KEYS);
  let list = [];
  if (Array.isArray(raw)) list = raw.map((x) => String(x).trim()).filter(Boolean);
  else if (raw != null && String(raw).trim()) list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return [...FUEL_EXPORT_KEYS];
  const seen = new Set();
  const out = [];
  for (const k of list) {
    if (allowed.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out.length ? out : [...FUEL_EXPORT_KEYS];
}

function exportLogoExtension(absPath) {
  const l = (absPath || '').toLowerCase();
  if (l.endsWith('.png')) return 'png';
  if (l.endsWith('.gif')) return 'gif';
  return 'jpeg';
}

/** Raw cell value for Excel (numbers stay numbers where useful). */
function transactionExportCellRaw(m, key) {
  if (!m) return '';
  switch (key) {
    case 'supplier_name':
      return String(m.supplier_name || '');
    case 'customer_name':
      return String(m.customer_name || '');
    case 'vehicle_tank':
      return String(m.vehicle_tank || '');
    case 'order_number':
      return String(m.order_number || '');
    case 'vehicle_registration':
      return String(m.vehicle_registration || '');
    case 'supplier_vehicle_registration':
      return String(m.supplier_vehicle_registration || '');
    case 'delivery_time':
      return m.delivery_time ? new Date(m.delivery_time) : '';
    case 'kilos':
      return m.kilos != null ? Number(m.kilos) : '';
    case 'responsible_user_name':
      return String(m.responsible_user_name || '');
    case 'pump_start':
      return m.pump_start != null ? Number(m.pump_start) : '';
    case 'pump_stop':
      return m.pump_stop != null ? Number(m.pump_stop) : '';
    case 'liters_filled':
      return m.liters_filled != null ? Number(m.liters_filled) : '';
    case 'price_per_litre':
      return m.price_per_litre != null ? Number(m.price_per_litre) : '';
    case 'amount_rand':
      return m.amount_rand != null ? Number(m.amount_rand) : '';
    case 'fuel_attendant_name':
      return String(m.fuel_attendant_name || '');
    case 'authorizer_name':
      return String(m.authorizer_name || '');
    case 'source':
      return String(m.source || '');
    default:
      return '';
  }
}

/** Display string for PDF table cells. */
function transactionExportCellPdf(m, key) {
  const v = transactionExportCellRaw(m, key);
  if (v === '' || v == null) return '';
  if (key === 'delivery_time' && m.delivery_time)
    return new Date(m.delivery_time).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  if (key === 'liters_filled' && m.liters_filled != null) return m.liters_filled.toFixed(2);
  if (key === 'amount_rand' && m.amount_rand != null) return m.amount_rand.toFixed(2);
  if (key === 'price_per_litre' && m.price_per_litre != null) return String(m.price_per_litre);
  if ((key === 'kilos' || key === 'pump_start' || key === 'pump_stop') && v !== '' && typeof v === 'number') return String(v);
  return String(v);
}

async function buildFuelExportExcelBuffer(rows, parties, columns, periodLabel = '') {
  const { supplierRow, customerRow, logoBuffer, supplierLogoAbsPath } = parties;
  let defs = columns.map((k) => FUEL_EXPORT_COLUMN_MAP[k]).filter(Boolean);
  if (!defs.length) defs = [...FUEL_EXPORT_COLUMN_DEFS];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Diesel transactions', {
    properties: { defaultRowHeight: 18 },
  });

  const nCols = defs.length;
  const endCol = colLetter0(nCols - 1);
  const mergeEndCol = colLetter0(Math.max(nCols, 4) - 1);

  let logoRowsUsed = 0;
  if (logoBuffer && supplierLogoAbsPath && supplierRow) {
    try {
      const imgId = wb.addImage({
        buffer: logoBuffer,
        extension: exportLogoExtension(supplierLogoAbsPath),
      });
      ws.mergeCells(`A1:B3`);
      ws.addImage(imgId, {
        tl: { col: 0, row: 0 },
        ext: { width: 150, height: 72 },
      });
      [1, 2, 3].forEach((r) => {
        ws.getRow(r).height = 24;
      });
      const supplierLines = [
        supplierRow.name,
        supplierRow.address,
        supplierRow.vat_number ? `VAT: ${supplierRow.vat_number}` : '',
        supplierRow.vehicle_registration ? `Vehicle registration: ${supplierRow.vehicle_registration}` : '',
        supplierRow.fuel_attendant_name ? `Fuel attendant: ${supplierRow.fuel_attendant_name}` : '',
        supplierRow.price_per_litre != null ? `Price / litre: R ${supplierRow.price_per_litre}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      ws.mergeCells(`C1:${mergeEndCol}4`);
      const sc = ws.getCell('C1');
      sc.value = supplierLines;
      sc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      sc.font = { size: 10, name: 'Calibri' };
      logoRowsUsed = 4;
    } catch (_) {
      logoRowsUsed = 0;
    }
  }
  if (!logoRowsUsed && supplierRow) {
    const supplierLines = [
      supplierRow.name,
      supplierRow.address,
      supplierRow.vat_number ? `VAT: ${supplierRow.vat_number}` : '',
      supplierRow.vehicle_registration ? `Vehicle registration: ${supplierRow.vehicle_registration}` : '',
      supplierRow.fuel_attendant_name ? `Fuel attendant: ${supplierRow.fuel_attendant_name}` : '',
      supplierRow.price_per_litre != null ? `Price / litre: R ${supplierRow.price_per_litre}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    ws.mergeCells(`A1:${mergeEndCol}3`);
    const sc = ws.getCell('A1');
    sc.value = supplierLines;
    sc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    sc.font = { size: 10, bold: true, name: 'Calibri' };
    logoRowsUsed = 3;
  } else if (logoBuffer && supplierLogoAbsPath && !supplierRow) {
    try {
      const imgId = wb.addImage({
        buffer: logoBuffer,
        extension: exportLogoExtension(supplierLogoAbsPath),
      });
      ws.mergeCells(`A1:B3`);
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 72 } });
      [1, 2, 3].forEach((r) => {
        ws.getRow(r).height = 24;
      });
      logoRowsUsed = 3;
    } catch (_) {
      logoRowsUsed = 0;
    }
  }

  let nextRow = logoRowsUsed > 0 ? logoRowsUsed + 1 : 1;
  if (customerRow) {
    const custText = [
      customerRow.name,
      customerRow.vehicle_registration ? `Vehicle registration: ${customerRow.vehicle_registration}` : '',
      customerRow.responsible_user_name ? `Responsible user: ${customerRow.responsible_user_name}` : '',
      customerRow.authorizer_name ? `Authorizer: ${customerRow.authorizer_name}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    ws.mergeCells(`A${nextRow}:${mergeEndCol}${nextRow}`);
    const cc = ws.getCell(`A${nextRow}`);
    cc.value = `Customer: ${custText}`;
    cc.font = { size: 10, bold: true, color: { argb: 'FF14532D' }, name: 'Calibri' };
    cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
    cc.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(nextRow).height = 28;
    nextRow += 1;
  }

  if (logoRowsUsed > 0 || customerRow) nextRow += 1;
  const titleR = nextRow;
  ws.mergeCells(`A${titleR}:${mergeEndCol}${titleR}`);
  const tcell = ws.getCell(`A${titleR}`);
  tcell.value = 'Diesel transaction statement';
  tcell.font = { size: 16, bold: true, color: { argb: 'FF0F172A' }, name: 'Calibri' };
  tcell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(titleR).height = 26;
  nextRow += 1;
  if (periodLabel && String(periodLabel).trim()) {
    ws.mergeCells(`A${nextRow}:${mergeEndCol}${nextRow}`);
    const sub = ws.getCell(`A${nextRow}`);
    sub.value = String(periodLabel).trim();
    sub.font = { size: 10, color: { argb: 'FF64748B' }, name: 'Calibri' };
    sub.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(nextRow).height = 22;
    nextRow += 1;
  }
  nextRow += 1;
  const headerRowIndex = nextRow;
  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' },
  };
  const thinBorder = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.height = 22;
  defs.forEach((def, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = def.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: def.numeric ? 'right' : 'left', wrapText: true };
    cell.border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
    ws.getColumn(i + 1).width = def.width;
  });

  let totalLiters = 0;
  let totalRand = 0;
  let dataRowIndex = headerRowIndex + 1;
  for (const m of rows) {
    const excelRow = ws.getRow(dataRowIndex);
    excelRow.height = 18;
    const stripe = dataRowIndex % 2 === 0;
    defs.forEach((def, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = transactionExportCellRaw(m, def.key);
      cell.value = raw === '' ? '' : raw;
      cell.font = { size: 10, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: def.numeric ? 'right' : 'left', wrapText: true };
      cell.border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
      if (stripe) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      if (def.key === 'delivery_time' && raw instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
      if (def.numeric && raw !== '' && typeof raw === 'number') {
        if (def.key === 'liters_filled') cell.numFmt = '0.000';
        if (def.key === 'amount_rand' || def.key === 'price_per_litre') cell.numFmt = '0.00';
      }
    });
    if (m.liters_filled != null) totalLiters += m.liters_filled;
    if (m.amount_rand != null) totalRand += m.amount_rand;
    dataRowIndex += 1;
  }

  const sumRow = ws.getRow(dataRowIndex);
  sumRow.height = 20;
  defs.forEach((def, i) => {
    const cell = sumRow.getCell(i + 1);
    cell.font = { bold: true, size: 10, name: 'Calibri' };
    cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } }, left: thinBorder, bottom: thinBorder, right: thinBorder };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (i === 0) cell.value = 'TOTALS';
    else if (def.key === 'liters_filled') cell.value = Math.round(totalLiters * 1000) / 1000;
    else if (def.key === 'amount_rand') cell.value = Math.round(totalRand * 100) / 100;
    else cell.value = '';
    cell.alignment = { horizontal: def.numeric ? 'right' : 'left', vertical: 'middle' };
  });

  ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function mergeExportFilters(body = {}) {
  const base = typeof body.filters === 'object' && body.filters ? { ...body.filters } : {};
  delete base.columns;
  const f = {
    status: 'verified',
    ...base,
  };
  for (const k of ['supplier_id', 'customer_id', 'date_from', 'date_to', 'source', 'q', 'ids']) {
    if (body[k] != null && body[k] !== '') f[k] = body[k];
  }
  if (body.status || body.verification) f.status = body.status || body.verification;
  Object.keys(f).forEach((k) => {
    if (f[k] === '' || f[k] == null) delete f[k];
  });
  return f;
}

function uniqueIdsFromRows(rows, field) {
  const set = new Set();
  for (const m of rows || []) {
    const v = m?.[field];
    if (v != null && String(v).trim() !== '') set.add(String(v).trim());
  }
  return [...set];
}

/** Resolve supplier/customer + logo for statements: uses query filters, or a single id inferred from row set */
async function loadFuelStatementParties(tid, queryFilters, rows) {
  let supplierId =
    queryFilters?.supplier_id != null && String(queryFilters.supplier_id).trim() ? String(queryFilters.supplier_id).trim() : null;
  let customerId =
    queryFilters?.customer_id != null && String(queryFilters.customer_id).trim() ? String(queryFilters.customer_id).trim() : null;
  const sList = uniqueIdsFromRows(rows, 'supplier_id');
  const cList = uniqueIdsFromRows(rows, 'customer_id');
  if (!supplierId && sList.length === 1) supplierId = sList[0];
  if (!customerId && cList.length === 1) customerId = cList[0];

  let supplierRow = null;
  let customerRow = null;
  let logoBuffer = null;
  let supplierLogoAbsPath = null;

  if (supplierId) {
    const s = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, { id: supplierId, tid });
    supplierRow = s.recordset?.[0] ? mapSupplier(s.recordset[0]) : null;
    if (supplierRow?.logo_file_path) {
      const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), supplierRow.logo_file_path);
      if (abs && fs.existsSync(abs)) {
        supplierLogoAbsPath = abs;
        try {
          logoBuffer = fs.readFileSync(abs);
        } catch (_) {
          logoBuffer = null;
        }
      }
    }
  }
  if (customerId) {
    const c = await query(`SELECT * FROM fuel_data_customers WHERE id = @id AND tenant_id = @tid`, { id: customerId, tid });
    customerRow = c.recordset?.[0] ? mapCustomer(c.recordset[0]) : null;
  }
  return { supplierRow, customerRow, logoBuffer, supplierLogoAbsPath };
}

function formatFuelExportPeriodLabel(queryFilters, rows) {
  const fmt = (d) =>
    d && !Number.isNaN(new Date(d).getTime())
      ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;
  const fromQ = queryFilters?.date_from ? new Date(queryFilters.date_from) : null;
  const toQ = queryFilters?.date_to ? new Date(queryFilters.date_to) : null;
  if ((fromQ && !Number.isNaN(fromQ.getTime())) || (toQ && !Number.isNaN(toQ.getTime()))) {
    const a = fromQ && !Number.isNaN(fromQ.getTime()) ? fmt(fromQ) : null;
    const b = toQ && !Number.isNaN(toQ.getTime()) ? fmt(toQ) : null;
    if (a && b) return `Report period (filters): ${a} – ${b}`;
    if (a) return `Report period (filters): from ${a}`;
    if (b) return `Report period (filters): to ${b}`;
  }
  let minT = null;
  let maxT = null;
  for (const m of rows || []) {
    if (!m?.delivery_time) continue;
    const t = new Date(m.delivery_time).getTime();
    if (Number.isNaN(t)) continue;
    if (minT == null || t < minT) minT = t;
    if (maxT == null || t > maxT) maxT = t;
  }
  if (minT != null && maxT != null) {
    return `Transaction dates in this export: ${fmt(new Date(minT))} – ${fmt(new Date(maxT))}`;
  }
  return '';
}

function pdfColumnLayout(columnKeys, innerW, M, contentRight) {
  const defs = columnKeys.map((k) => FUEL_EXPORT_COLUMN_MAP[k]).filter(Boolean);
  if (!defs.length) return [];
  const totalW = defs.reduce((s, d) => s + (d.pdfWeight || 1), 0);
  let x = M;
  const cols = defs.map((d) => {
    const w = Math.max(26, ((d.pdfWeight || 1) / totalW) * innerW);
    const col = { key: d.key, header: d.header, x, w: Math.floor(w * 100) / 100, numeric: !!d.numeric };
    x += col.w;
    return col;
  });
  const last = cols[cols.length - 1];
  last.w = Math.max(28, contentRight - last.x);
  return cols;
}

async function buildFuelDataPdfBuffer(rows, { supplierRow, customerRow, logoBuffer, title, columns, periodLabel }) {
  const activeKeys =
    Array.isArray(columns) && columns.length ? columns.filter((k) => FUEL_EXPORT_COLUMN_MAP[k]) : [...FUEL_EXPORT_KEYS];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title || 'Fuel statement' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = doc.page.margins.left;
    const R = doc.page.margins.right;
    const T = doc.page.margins.top;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentRight = pageW - R;
    const innerW = contentRight - M;

    const layoutCols = pdfColumnLayout(activeKeys, innerW, M, contentRight);

    const LOGO_MAX_W = 120;
    const LOGO_MAX_H = 64;
    const GAP = 16;
    const LINE_GAP = 3;

    let y = T;

    // 1) Logo + supplier first (top of page)
    if (supplierRow || logoBuffer) {
      const bandTop = y;
      let bandBottom = bandTop;

      if (logoBuffer && supplierRow) {
        try {
          doc.image(logoBuffer, M, bandTop, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
        } catch (_) {
          /* ignore */
        }
        const textLeft = M + LOGO_MAX_W + 16;
        const textW = Math.max(120, contentRight - textLeft);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Supplier', textLeft, bandTop, { width: textW });
        const ty = doc.y + 6;
        doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
        const sl = [
          supplierRow.name,
          supplierRow.address,
          supplierRow.vat_number ? `VAT: ${supplierRow.vat_number}` : '',
          supplierRow.vehicle_registration ? `Vehicle registration: ${supplierRow.vehicle_registration}` : '',
          supplierRow.fuel_attendant_name ? `Fuel attendant: ${supplierRow.fuel_attendant_name}` : '',
          supplierRow.price_per_litre != null ? `Price / litre: R ${supplierRow.price_per_litre}` : '',
        ].filter(Boolean);
        doc.text(sl.join('\n'), textLeft, ty, { width: textW, lineGap: LINE_GAP });
        bandBottom = Math.max(bandTop + LOGO_MAX_H, doc.y) + 6;
      } else if (supplierRow) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Supplier', M, bandTop, { width: innerW });
        const ty = doc.y + 6;
        doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
        const sl = [
          supplierRow.name,
          supplierRow.address,
          supplierRow.vat_number ? `VAT: ${supplierRow.vat_number}` : '',
          supplierRow.vehicle_registration ? `Vehicle registration: ${supplierRow.vehicle_registration}` : '',
          supplierRow.fuel_attendant_name ? `Fuel attendant: ${supplierRow.fuel_attendant_name}` : '',
          supplierRow.price_per_litre != null ? `Price / litre: R ${supplierRow.price_per_litre}` : '',
        ].filter(Boolean);
        doc.text(sl.join('\n'), M, ty, { width: innerW, lineGap: LINE_GAP });
        bandBottom = doc.y + 6;
      } else if (logoBuffer) {
        try {
          doc.image(logoBuffer, M, bandTop, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
          bandBottom = bandTop + LOGO_MAX_H + 6;
        } catch (_) {
          bandBottom = bandTop;
        }
      }
      y = bandBottom + 4;
    }

    // 2) Customer block
    if (customerRow) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Customer', M, y, { width: innerW });
      const ty = doc.y + 6;
      doc.font('Helvetica').fontSize(9).fillColor('#14532d');
      const cl = [
        customerRow.name,
        customerRow.vehicle_registration ? `Vehicle registration: ${customerRow.vehicle_registration}` : '',
        customerRow.responsible_user_name ? `Responsible user: ${customerRow.responsible_user_name}` : '',
        customerRow.authorizer_name ? `Authorizer: ${customerRow.authorizer_name}` : '',
      ].filter(Boolean);
      doc.text(cl.join('\n'), M, ty, { width: innerW, lineGap: LINE_GAP });
      y = doc.y + GAP;
      doc.fillColor('#000000');
    }

    // 3) Document title + optional period (below branding; no “Fuel Data…” strapline)
    y += 6;
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(title || 'Diesel transaction statement', M, y, { width: innerW, align: 'center' });
    y = doc.y + 8;
    if (periodLabel && String(periodLabel).trim()) {
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      doc.text(String(periodLabel).trim(), M, y, { width: innerW, align: 'center', lineGap: 2 });
      y = doc.y + 10;
    } else {
      y += 4;
    }
    doc.fillColor('#000000');

    const pageBottom = pageH - R - 36;
    const rowH = 15;
    const cellPad = 2;

    const drawTableHeader = (yy) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111');
      layoutCols.forEach((c) => {
        doc.text(c.header, c.x + cellPad, yy, {
          width: Math.max(10, c.w - cellPad * 2),
          align: c.numeric ? 'right' : 'left',
        });
      });
      const lineY = yy + 11;
      doc.moveTo(M, lineY).lineTo(contentRight, lineY).lineWidth(0.55).strokeColor('#64748b').stroke();
      doc.fillColor('#000000');
      return lineY + 7;
    };

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Transactions', M, y);
    y = doc.y + 6;
    y = drawTableHeader(y);
    doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');

    let totL = 0;
    let totZ = 0;

    for (const m of rows) {
      if (y + rowH > pageBottom) {
        doc.addPage();
        y = T + 12;
        y = drawTableHeader(y);
        doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
      }
      layoutCols.forEach((c) => {
        const txt = transactionExportCellPdf(m, c.key);
        doc.text(String(txt || ''), c.x + cellPad, y + 1, {
          width: Math.max(10, c.w - cellPad * 2),
          height: rowH - 2,
          ellipsis: true,
          align: c.numeric ? 'right' : 'left',
          lineGap: 0.5,
        });
      });
      y += rowH;
      if (m.liters_filled != null) totL += m.liters_filled;
      if (m.amount_rand != null) totZ += m.amount_rand;
    }

    y += 8;
    if (y + 22 > pageBottom) {
      doc.addPage();
      y = T + 12;
    }
    doc.moveTo(M, y).lineTo(contentRight, y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    y += 10;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a');
    const firstCol = layoutCols[0];
    if (firstCol) doc.text('Totals', firstCol.x, y, { width: firstCol.w });
    layoutCols.forEach((c) => {
      if (c.key === 'liters_filled') doc.text(totL.toFixed(2), c.x + 2, y, { width: c.w - 4, align: 'right' });
      if (c.key === 'amount_rand') doc.text(totZ.toFixed(2), c.x + 2, y, { width: c.w - 4, align: 'right' });
    });

    doc.end();
  });
}

/** Excel export — filters + optional columns= comma-separated keys (see FUEL_EXPORT_KEYS). */
router.get('/export/excel', requireFuelDataAnyTab(['fuel_admin', 'file_export']), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const exportCols = parseExportColumns(req.query.columns);
    const rows = await rowsForExport(tid, req.query);
    const parties = await loadFuelStatementParties(tid, req.query, rows);
    const periodLabel = formatFuelExportPeriodLabel(req.query, rows);
    const buf = await buildFuelExportExcelBuffer(rows, parties, exportCols, periodLabel);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fuel-data-transactions.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

/** PDF statement — same filters as Excel; includes supplier/customer blocks + logo when filtered */
router.get('/export/pdf', requireFuelDataAnyTab(['fuel_admin', 'file_export']), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const exportCols = parseExportColumns(req.query.columns);
    const rows = await rowsForExport(tid, req.query);
    const { supplierRow, customerRow, logoBuffer } = await loadFuelStatementParties(tid, req.query, rows);
    const periodLabel = formatFuelExportPeriodLabel(req.query, rows);
    const buf = await buildFuelDataPdfBuffer(rows, {
      supplierRow,
      customerRow,
      logoBuffer,
      title: 'Diesel transaction statement',
      columns: exportCols,
      periodLabel,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="fuel-data-statement.pdf"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

/** Email summary + optional Excel attachment */
router.post('/export/email', requireFuelDataAnyTab(['fuel_admin', 'file_export']), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const body = req.body || {};
    const filterQs = mergeExportFilters(body);
    const emailTo = (body.to || req.user.email || '').trim();
    if (!emailTo) return res.status(400).json({ error: 'Recipient email (to) required' });

    const rawCols =
      body.columns != null && body.columns !== ''
        ? body.columns
        : typeof body.filters === 'object' && body.filters && body.filters.columns != null && body.filters.columns !== ''
          ? body.filters.columns
          : undefined;
    const exportCols = parseExportColumns(rawCols);
    const rows = await rowsForExport(tid, filterQs);
    const { supplierRow: supplier, customerRow: customer, logoBuffer: logoBufPdf, supplierLogoAbsPath } = await loadFuelStatementParties(
      tid,
      filterQs,
      rows
    );
    let totalLiters = 0;
    let totalRand = 0;
    for (const m of rows) {
      if (m.liters_filled != null) totalLiters += m.liters_filled;
      if (m.amount_rand != null) totalRand += m.amount_rand;
    }

    const parties = {
      supplierRow: supplier,
      customerRow: customer,
      logoBuffer: logoBufPdf,
      supplierLogoAbsPath,
    };
    const periodLabel = formatFuelExportPeriodLabel(filterQs, rows);
    const xlsxBuf = await buildFuelExportExcelBuffer(rows, parties, exportCols, periodLabel);

    let logoCid = null;
    const attachments = [
      {
        filename: 'fuel-data-transactions.xlsx',
        content: Buffer.from(xlsxBuf),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ];
    if (supplierLogoAbsPath) {
      logoCid = 'supplierlogo';
      attachments.push({
        filename: 'logo',
        path: supplierLogoAbsPath,
        cid: logoCid,
      });
    }

    if (body.attach_pdf) {
      const pdfBuf = await buildFuelDataPdfBuffer(rows, {
        supplierRow: supplier,
        customerRow: customer,
        logoBuffer: logoBufPdf,
        title: 'Diesel transaction statement',
        columns: exportCols,
        periodLabel,
      });
      attachments.push({
        filename: 'fuel-data-statement.pdf',
        content: pdfBuf,
        contentType: 'application/pdf',
      });
    }

    const logoHtml = logoCid
      ? `<img src="cid:${logoCid}" alt="Supplier" style="max-height:64px;margin-bottom:12px;" />`
      : '';
    const supplierBlock = supplier
      ? `<div style="margin:16px 0;padding:12px;border-radius:8px;background:#f4f6f8;">
           ${logoHtml}
           <div style="font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(supplier.name)}</div>
           <div style="color:#334155;font-size:13px;margin-top:6px;white-space:pre-wrap;">${escapeHtml(supplier.address || '')}</div>
           <div style="color:#334155;font-size:13px;">VAT: ${escapeHtml(supplier.vat_number || '—')}</div>
           <div style="color:#334155;font-size:13px;">Price / litre: R ${supplier.price_per_litre != null ? escapeHtml(String(supplier.price_per_litre)) : '—'}</div>
           ${supplier.vehicle_registration ? `<div style="color:#334155;font-size:13px;">Vehicle registration: ${escapeHtml(supplier.vehicle_registration)}</div>` : ''}
           ${supplier.fuel_attendant_name ? `<div style="color:#334155;font-size:13px;">Fuel attendant: ${escapeHtml(supplier.fuel_attendant_name)}</div>` : ''}
         </div>`
      : '';
    const customerBlock = customer
      ? `<div style="margin:16px 0;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;">
           <div style="font-size:15px;font-weight:700;color:#14532d;">Customer</div>
           <div style="color:#166534;font-size:13px;margin-top:4px;">${escapeHtml(customer.name)}</div>
           ${customer.vehicle_registration ? `<div style="color:#166534;font-size:13px;">Vehicle registration: ${escapeHtml(customer.vehicle_registration)}</div>` : ''}
           ${customer.responsible_user_name ? `<div style="color:#166534;font-size:13px;">Responsible user: ${escapeHtml(customer.responsible_user_name)}</div>` : ''}
           ${customer.authorizer_name ? `<div style="color:#166534;font-size:13px;">Authorizer: ${escapeHtml(customer.authorizer_name)}</div>` : ''}
         </div>`
      : '';

    const tableRows = rows
      .slice(0, 50)
      .map(
        (m) =>
          `<tr><td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(m.supplier_name)}</td>` +
          `<td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(m.customer_name)}</td>` +
          `<td style="padding:6px;border:1px solid #e2e8f0;text-align:right;">${m.liters_filled ?? ''}</td>` +
          `<td style="padding:6px;border:1px solid #e2e8f0;text-align:right;">${m.amount_rand != null ? escapeHtml(String(m.amount_rand)) : ''}</td></tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Fuel data report</title></head>
<body style="font-family:Segoe UI,system-ui,sans-serif;background:#f8fafc;padding:24px;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 24px rgba(15,23,42,.08);">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;">Thinkers — Fuel Data</div>
    <h1 style="margin:8px 0 4px;font-size:22px;color:#0f172a;">Diesel transaction sheet</h1>
    <p style="color:#64748b;font-size:14px;">Transactions in this send match your filters (default: verified). See attached Excel${body.attach_pdf ? ' and PDF statement' : ''}.</p>
    ${supplierBlock}
    ${customerBlock}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
      <thead><tr style="background:#0f172a;color:#fff;">
        <th style="padding:8px;text-align:left;">Supplier</th>
        <th style="padding:8px;text-align:left;">Customer</th>
        <th style="padding:8px;text-align:right;">Liters</th>
        <th style="padding:8px;text-align:right;">Amount (ZAR)</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin-top:16px;font-size:15px;font-weight:600;color:#0f172a;">Totals: ${Math.round(totalLiters * 1000) / 1000} L · R ${Math.round(totalRand * 100) / 100}</p>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px;">Generated from your organisation's Fuel Data records.</p>
  </div>
</body></html>`;

    await sendEmail({
      to: emailTo,
      subject: `Fuel Data — diesel transactions (${rows.length} verified)`,
      body: html,
      html: true,
      attachments,
    });
    res.json({ sent: true, to: emailTo, row_count: rows.length });
  } catch (e) {
    next(e);
  }
});

/** Analytics aggregates + OpenAI insights (system data only) */
router.get('/analytics/summary', requireFuelDataAnyTab(['analytics', 'advanced_dashboard']), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const r = await query(
      `SELECT
         supplier_name,
         COUNT(*) AS tx_count,
         SUM(CASE WHEN liters_filled IS NOT NULL THEN liters_filled ELSE 0 END) AS total_liters,
         SUM(CASE WHEN amount_rand IS NOT NULL THEN amount_rand ELSE 0 END) AS total_rand
       FROM fuel_data_transactions
       WHERE tenant_id = @tid AND verification_status = N'verified'
       GROUP BY supplier_name
       ORDER BY supplier_name`,
      { tid }
    );
    const bySupplier = (r.recordset || []).map((row) => ({
      supplier_name: get(row, 'supplier_name'),
      transaction_count: Number(get(row, 'tx_count')) || 0,
      total_liters: Number(get(row, 'total_liters')) || 0,
      total_rand: Number(get(row, 'total_rand')) || 0,
    }));
    const monthly = await query(
      `SELECT FORMAT(delivery_time, 'yyyy-MM') AS ym,
              COUNT(*) AS tx_count,
              SUM(CASE WHEN liters_filled IS NOT NULL THEN liters_filled ELSE 0 END) AS total_liters,
              SUM(CASE WHEN amount_rand IS NOT NULL THEN amount_rand ELSE 0 END) AS total_rand
       FROM fuel_data_transactions
       WHERE tenant_id = @tid AND verification_status = N'verified' AND delivery_time IS NOT NULL
       GROUP BY FORMAT(delivery_time, 'yyyy-MM')
       ORDER BY ym`,
      { tid }
    );
    res.json({
      by_supplier: bySupplier,
      by_month: (monthly.recordset || []).map((row) => ({
        month: get(row, 'ym'),
        transaction_count: Number(get(row, 'tx_count')) || 0,
        total_liters: Number(get(row, 'total_liters')) || 0,
        total_rand: Number(get(row, 'total_rand')) || 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/analytics/insights', requireFuelDataAnyTab(['analytics', 'advanced_dashboard']), async (req, res, next) => {
  try {
    if (!isAiConfigured()) {
      return res.status(503).json({ error: 'OpenAI is not configured (set OPENAI_API_KEY on the server).' });
    }
    const tid = tenantId(req);
    const summaryRes = await query(
      `SELECT
         supplier_name,
         COUNT(*) AS tx_count,
         SUM(CASE WHEN liters_filled IS NOT NULL THEN liters_filled ELSE 0 END) AS total_liters,
         SUM(CASE WHEN amount_rand IS NOT NULL THEN amount_rand ELSE 0 END) AS total_rand
       FROM fuel_data_transactions
       WHERE tenant_id = @tid AND verification_status = N'verified'
       GROUP BY supplier_name`,
      { tid }
    );
    const monthly = await query(
      `SELECT FORMAT(delivery_time, 'yyyy-MM') AS ym,
              COUNT(*) AS tx_count,
              SUM(CASE WHEN liters_filled IS NOT NULL THEN liters_filled ELSE 0 END) AS total_liters
       FROM fuel_data_transactions
       WHERE tenant_id = @tid AND verification_status = N'verified' AND delivery_time IS NOT NULL
       GROUP BY FORMAT(delivery_time, 'yyyy-MM')
       ORDER BY ym`,
      { tid }
    );
    const payload = {
      by_supplier: summaryRes.recordset || [],
      by_month: monthly.recordset || [],
    };
    const client = getOpenAiClient();
    const model = getAiModel();
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an analyst for diesel fuel transactions. You MUST only interpret the JSON data provided by the user. Do not invent numbers, suppliers, or dates. If the data is empty, say there is not enough verified data yet. Keep the answer concise with bullet points: trends, risks, and operational suggestions grounded strictly in the figures.',
        },
        {
          role: 'user',
          content: `Here is the only data you may use (verified transactions for one tenant):\n${JSON.stringify(payload)}`,
        },
      ],
      max_tokens: 900,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    res.json({ insights: text, data: payload });
  } catch (e) {
    next(e);
  }
});

/** Map delivery-slip labels to API transaction fields; fleet = customer vehicle only. */
function normalizeSlipExtracted(extracted) {
  if (!extracted || typeof extracted !== 'object' || extracted.parse_error) return extracted;
  const o = { ...extracted };
  const fleetKeys = ['customer_vehicle_registration', 'fleet', 'fleet_number', 'fleet_no', 'customer_fleet'];
  for (const k of fleetKeys) {
    const v = o[k];
    if (v != null && String(v).trim() !== '') {
      o.vehicle_registration = String(v).replace(/\s+/g, ' ').trim();
      break;
    }
  }
  if (o.vehicle_registration != null && String(o.vehicle_registration).trim() !== '') {
    o.vehicle_registration = String(o.vehicle_registration).replace(/\s+/g, ' ').trim();
  }
  const authFrom = o.received_by ?? o.received_by_name ?? o.receiver_name;
  if (authFrom != null && String(authFrom).trim() !== '') {
    if (!o.authorizer_name || String(o.authorizer_name).trim() === '') {
      o.authorizer_name = String(authFrom).replace(/\s+/g, ' ').trim();
    }
  }
  const driverFrom = o.driver ?? o.driver_name;
  if (driverFrom != null && String(driverFrom).trim() !== '') {
    if (!o.responsible_user_name || String(o.responsible_user_name).trim() === '') {
      o.responsible_user_name = String(driverFrom).replace(/\s+/g, ' ').trim();
    }
  }
  if (o.order_number != null && o.order_number !== '') {
    o.order_number = String(o.order_number).trim();
  }
  if ((o.liters_filled == null || o.liters_filled === '') && o.liters != null && String(o.liters).trim() !== '') {
    o.liters_filled = Number(o.liters);
  }
  if (o.liters != null) delete o.liters;
  const srv = o.supplier_vehicle_registration ?? o.supplier_registration ?? o.supplier_truck_reg;
  if (srv != null && String(srv).trim() !== '') {
    o.supplier_vehicle_registration = String(srv).replace(/\s+/g, ' ').trim();
  }
  for (const k of [
    ...fleetKeys,
    'received_by',
    'received_by_name',
    'receiver_name',
    'driver',
    'driver_name',
    'supplier_registration',
    'supplier_truck_reg',
  ]) {
    delete o[k];
  }
  return o;
}

/** Attendant: parse slip with vision */
router.post('/attendant/parse-slip', requireFuelDataTab('attendant_portal'), (req, res, next) => {
  slipUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!isAiConfigured()) return res.status(503).json({ error: 'OPENAI_API_KEY not set — AI slip reading unavailable.' });
      if (!req.file) return res.status(400).json({ error: 'slip image required' });
      const tid = tenantId(req);
      const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
      const buf = fs.readFileSync(req.file.path);
      const b64 = buf.toString('base64');
      const ext = (path.extname(req.file.path) || '.jpg').toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

      const client = getOpenAiClient();
      const model = getAiModel();
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You read handwritten or printed fuel DELIVERY / pump slips. Reply with ONE JSON object only, no markdown.\n' +
              'Field meanings (South African slips often label Fleet / vehicle reg for the CUSTOMER vehicle receiving fuel — not the supplier tanker):\n' +
              '- vehicle_registration: ONLY the customer / fleet vehicle registration or fleet number (e.g. label Fleet, Reg, Vehicle).\n' +
              '- supplier_vehicle_registration: ONLY if the slip clearly shows the supplier tanker/truck registration (otherwise null).\n' +
              '- order_number: text from ORDER No. / order number box (string, or null).\n' +
              '- authorizer_name: person who received / signed — labels like RECEIVED BY, Received by (NOT the pump attendant).\n' +
              '- responsible_user_name: driver name if labeled Driver / chauffeur.\n' +
              '- fuel_attendant_name: pump attendant if labeled Attended by / attendant.\n' +
              '- delivery_time: combine printed date and time into ISO 8601 in local slip context, or empty string if unknown.\n' +
              '- kilos: odometer reading if labeled Km / Odo / Mileage (number or null).\n' +
              '- pump_start, pump_stop: pump meter readings (numbers or null). liters_filled: total liters if shown (number or null).\n' +
              'Also include when visible: supplier_name, customer_name, vehicle_tank. Use null for missing numbers; empty string for missing text.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this fuel slip image and return the JSON object.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
            ],
          },
        ],
        max_tokens: 900,
      });
      let raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
      if (raw.startsWith('```')) raw = raw.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
      let extracted = {};
      try {
        extracted = JSON.parse(raw);
      } catch {
        extracted = { parse_error: true, raw };
      }
      if (!extracted.parse_error) extracted = normalizeSlipExtracted(extracted);
      res.json({ slip_image_path: rel, extracted });
    } catch (e) {
      next(e);
    }
  });
});

export default router;
