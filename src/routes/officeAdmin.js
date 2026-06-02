import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';
import {
  generateNextAssetCode,
  getCategoryById,
  normalizeCodePrefix,
} from '../lib/officeAdminAssetCodes.js';
import { ASSET_WRITABLE_FIELDS, mapAttachmentRow } from '../lib/officeAdminAssets.js';
import {
  MAINTENANCE_TAB_IDS,
  REPORT_WRITABLE_FIELDS,
  RECORD_WRITABLE_FIELDS,
  pickBody,
  mapMaintAttachmentRow,
  normalizeOaTabs,
} from '../lib/officeAdminMaintenance.js';
import { CONSUMABLE_WRITABLE_FIELDS, pickConsumableBody } from '../lib/officeAdminConsumables.js';
import { safeResolveUnderRoot } from '../lib/fuelStatementExport.js';

const router = Router();
const oaUploadsRoot = path.join(process.cwd(), 'uploads', 'office-admin');

function maintAttachUpload(folder) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const tid = resolveTenantId(req) || 'unknown';
        const dir = path.join(oaUploadsRoot, folder, String(tid), String(req.params.id || 'new'));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const safe = String(file.originalname || 'file').replace(/[^\w.\-()+ ]/g, '_');
        cb(null, `${randomUUID()}-${safe}`);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 12 },
  });
}

const reportAttachUpload = maintAttachUpload('maintenance-reports');
const recordAttachUpload = maintAttachUpload('maintenance-records');

const assetAttachUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const tid = resolveTenantId(req) || 'unknown';
      const dir = path.join(oaUploadsRoot, 'assets', String(tid), String(req.params.id || 'new'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function assetBodyParams(b, extras = {}) {
  return {
    location: b.location || null,
    serial: b.serial_number || b.serialNumber || null,
    purchaseDate: b.purchase_date || b.purchaseDate || null,
    purchaseValue: numOrNull(b.purchase_value ?? b.purchaseValue),
    status: b.status || 'active',
    manufacturer: b.manufacturer || null,
    model: b.model || null,
    supplierName: b.supplier_name || b.supplierName || null,
    commissionedDate: b.commissioned_date || b.commissionedDate || null,
    warrantyExpiry: b.warranty_expiry_date || b.warrantyExpiryDate || null,
    expectedLifeYears: numOrNull(b.expected_life_years ?? b.expectedLifeYears),
    usefulLifeEnd: b.useful_life_end_date || b.usefulLifeEndDate || null,
    disposalDate: b.disposal_date || b.disposalDate || null,
    conditionStatus: b.condition_status || b.conditionStatus || null,
    residualValue: numOrNull(b.residual_value ?? b.residualValue),
    insuranceProvider: b.insurance_provider || b.insuranceProvider || null,
    insurancePolicy: b.insurance_policy_number || b.insurancePolicyNumber || null,
    insuranceCover: b.insurance_cover_type || b.insuranceCoverType || null,
    insuranceStart: b.insurance_start_date || b.insuranceStartDate || null,
    insuranceExpiry: b.insurance_expiry_date || b.insuranceExpiryDate || null,
    insurancePremium: numOrNull(b.insurance_premium_annual ?? b.insurancePremiumAnnual),
    insuranceContact: b.insurance_contact || b.insuranceContact || null,
    insuranceNotes: b.insurance_notes || b.insuranceNotes || null,
    accountingItemId: b.accounting_item_id || b.accountingItemId || null,
    accountingSupplierId: b.accounting_supplier_id || b.accountingSupplierId || null,
    notes: b.notes || null,
    ...extras,
  };
}

async function fetchAssetDetail(tenantId, assetId) {
  const r = await query(
    `SELECT a.*, u.full_name AS created_by_name, c.name AS category_name, c.code_prefix AS category_code_prefix
     FROM office_admin_assets a
     LEFT JOIN users u ON u.id = a.created_by_user_id
     LEFT JOIN office_admin_asset_categories c ON c.id = a.category_id
     WHERE a.id = @id AND a.tenant_id = @tenantId`,
    { id: assetId, tenantId }
  );
  const asset = r.recordset?.[0];
  if (!asset) return null;
  let attachments = [];
  try {
    const ar = await query(
      `SELECT att.*, u.full_name AS uploaded_by_name
       FROM office_admin_asset_attachments att
       LEFT JOIN users u ON u.id = att.uploaded_by_user_id
       WHERE att.asset_id = @assetId AND att.tenant_id = @tenantId
       ORDER BY att.created_at DESC`,
      { assetId, tenantId }
    );
    attachments = (ar.recordset || []).map((row) => mapAttachmentRow(row, get));
  } catch (_) {
    /* attachments table may not exist yet */
  }
  return { asset, attachments };
}

export const OA_TAB_IDS = [
  'dashboard',
  'asset_register',
  'consumables',
  ...MAINTENANCE_TAB_IDS,
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
    let tabs = normalizeOaTabs((r.recordset || []).map((row) => get(row, 'tab_id')));
    tabs = tabs.filter((id) => OA_TAB_IDS.includes(id));
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

/** Asset categories */
router.get('/asset-categories', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM office_admin_assets a WHERE a.category_id = c.id) AS asset_count
       FROM office_admin_asset_categories c
       WHERE c.tenant_id = @tenantId
       ORDER BY c.sort_order, c.name`,
      { tenantId }
    );
    res.json({ categories: r.recordset || [] });
  } catch (err) {
    if (String(err.message).includes('office_admin_asset_categories')) {
      return res.status(503).json({
        error: 'Asset categories not installed. Run: npm run db:office-admin-asset-categories',
      });
    }
    next(err);
  }
});

router.get('/asset-categories/:id/next-code', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const cat = await getCategoryById(tenantId, req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found.' });
    const prefix = normalizeCodePrefix(get(cat, 'code_prefix'), get(cat, 'name'));
    const next_code = await generateNextAssetCode(tenantId, prefix);
    res.json({ next_code, code_prefix: prefix });
  } catch (err) {
    next(err);
  }
});

router.post('/asset-categories', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required.' });
    const codePrefix = normalizeCodePrefix(b.code_prefix || b.codePrefix, name);
    const ins = await query(
      `INSERT INTO office_admin_asset_categories (tenant_id, name, code_prefix, description, sort_order)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @name, @codePrefix, @description, @sortOrder)`,
      {
        tenantId,
        name,
        codePrefix,
        description: b.description || null,
        sortOrder: Number(b.sort_order ?? b.sortOrder ?? 0) || 0,
      }
    );
    res.status(201).json({ category: ins.recordset?.[0] });
  } catch (err) {
    if (String(err.message).includes('UX_oa_asset_cat')) {
      return res.status(409).json({ error: 'A category with that name or code prefix already exists.' });
    }
    next(err);
  }
});

router.patch('/asset-categories/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    if (b.name !== undefined) {
      sets.push('name = @name');
      params.name = String(b.name).trim();
    }
    if (b.code_prefix !== undefined || b.codePrefix !== undefined) {
      sets.push('code_prefix = @codePrefix');
      params.codePrefix = normalizeCodePrefix(b.code_prefix || b.codePrefix, params.name || '');
    }
    if (b.description !== undefined) {
      sets.push('description = @description');
      params.description = b.description;
    }
    if (b.sort_order !== undefined || b.sortOrder !== undefined) {
      sets.push('sort_order = @sortOrder');
      params.sortOrder = Number(b.sort_order ?? b.sortOrder) || 0;
    }
    if (sets.length === 1) return res.status(400).json({ error: 'No fields to update.' });
    await query(
      `UPDATE office_admin_asset_categories SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const r = await query(
      `SELECT * FROM office_admin_asset_categories WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    if (!r.recordset?.[0]) return res.status(404).json({ error: 'Category not found.' });
    res.json({ category: r.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/asset-categories/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const inUse = await query(
      `SELECT COUNT(*) AS c FROM office_admin_assets WHERE tenant_id = @tenantId AND category_id = @id`,
      { id: req.params.id, tenantId }
    );
    if (Number(get(inUse.recordset?.[0], 'c')) > 0) {
      return res.status(409).json({ error: 'Cannot delete — assets are still assigned to this category.' });
    }
    await query(`DELETE FROM office_admin_asset_categories WHERE id = @id AND tenant_id = @tenantId`, {
      id: req.params.id,
      tenantId,
    });
    res.json({ ok: true });
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
    let sql = `SELECT a.*, u.full_name AS created_by_name, c.name AS category_name, c.code_prefix AS category_code_prefix,
               (SELECT COUNT(*) FROM office_admin_asset_attachments att WHERE att.asset_id = a.id) AS attachment_count
               FROM office_admin_assets a
               LEFT JOIN users u ON u.id = a.created_by_user_id
               LEFT JOIN office_admin_asset_categories c ON c.id = a.category_id
               WHERE a.tenant_id = @tenantId`;
    const params = { tenantId };
    if (q) {
      sql += ` AND (a.name LIKE @q OR a.asset_code LIKE @q OR a.serial_number LIKE @q OR a.location LIKE @q)`;
      params.q = `%${q}%`;
    }
    sql += ` ORDER BY a.name`;
    let r;
    try {
      r = await query(sql, params);
    } catch (err) {
      if (!String(err.message).includes('office_admin_asset_attachments')) throw err;
      sql = sql.replace(
        /,\s*\(SELECT COUNT\(\*\) FROM office_admin_asset_attachments att WHERE att\.asset_id = a\.id\) AS attachment_count/,
        ''
      );
      r = await query(sql, params);
    }
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
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Asset name is required.' });

    const categoryId = b.category_id || b.categoryId || null;
    let categoryName = String(b.category || '').trim() || null;
    let codePrefix = null;

    if (categoryId) {
      const cat = await getCategoryById(tenantId, categoryId);
      if (!cat) return res.status(400).json({ error: 'Invalid category.' });
      categoryName = get(cat, 'name') || categoryName;
      codePrefix = get(cat, 'code_prefix');
    }

    let assetCode = String(b.asset_code || b.assetCode || '').trim();
    if (!assetCode) {
      if (!codePrefix && !categoryName) {
        return res.status(400).json({
          error: 'Select a category so the system can assign a short asset code, or enter a code manually.',
        });
      }
      assetCode = await generateNextAssetCode(tenantId, codePrefix || categoryName);
    }

    const insertAsset = async (code) => {
      const p = assetBodyParams(b, {
        tenantId,
        assetCode: code,
        name,
        category: categoryName,
        categoryId: categoryId || null,
        userId: req.user.id,
      });
      return query(
        `INSERT INTO office_admin_assets (
          tenant_id, asset_code, name, category, category_id, location, serial_number, purchase_date, purchase_value,
          status, manufacturer, model, supplier_name, commissioned_date, warranty_expiry_date, expected_life_years,
          useful_life_end_date, disposal_date, condition_status, residual_value,
          insurance_provider, insurance_policy_number, insurance_cover_type, insurance_start_date, insurance_expiry_date,
          insurance_premium_annual, insurance_contact, insurance_notes,
          accounting_item_id, accounting_supplier_id, notes, created_by_user_id
        )
        OUTPUT INSERTED.*
        VALUES (
          @tenantId, @assetCode, @name, @category, @categoryId, @location, @serial, @purchaseDate, @purchaseValue,
          @status, @manufacturer, @model, @supplierName, @commissionedDate, @warrantyExpiry, @expectedLifeYears,
          @usefulLifeEnd, @disposalDate, @conditionStatus, @residualValue,
          @insuranceProvider, @insurancePolicy, @insuranceCover, @insuranceStart, @insuranceExpiry,
          @insurancePremium, @insuranceContact, @insuranceNotes,
          @accountingItemId, @accountingSupplierId, @notes, @userId
        )`,
        p
      );
    };

    let ins;
    try {
      ins = await insertAsset(assetCode);
    } catch (err) {
      if (String(err.message).includes('UX_office_admin_assets_tenant_code') && !b.asset_code && !b.assetCode) {
        assetCode = await generateNextAssetCode(tenantId, codePrefix || categoryName);
        ins = await insertAsset(assetCode);
      } else {
        throw err;
      }
    }
    res.status(201).json({ asset: ins.recordset?.[0], asset_code_generated: !b.asset_code && !b.assetCode });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const detail = await fetchAssetDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Asset not found.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.patch('/assets/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = req.body || {};
    const fields = ASSET_WRITABLE_FIELDS;
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
    const newCategoryId = b.category_id ?? b.categoryId;
    if (newCategoryId !== undefined) {
      if (newCategoryId) {
        const cat = await getCategoryById(tenantId, newCategoryId);
        if (cat) {
          if (!sets.some((s) => s.startsWith('category '))) sets.push('category = @categoryName');
          params.categoryName = get(cat, 'name');
        }
      } else if (!sets.some((s) => s.startsWith('category '))) {
        sets.push('category = NULL');
      }
    }
    await query(
      `UPDATE office_admin_assets SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const detail = await fetchAssetDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Asset not found.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:id/attachments', assetAttachUpload.array('files', 12), async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const assetId = req.params.id;
    const exists = await query(`SELECT id FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`, {
      id: assetId,
      tenantId,
    });
    if (!exists.recordset?.[0]) return res.status(404).json({ error: 'Asset not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Upload at least one file.' });
    const caption = String(req.body?.caption || '').trim() || null;
    const inserted = [];
    for (const file of files) {
      const rel = path.relative(path.join(process.cwd(), 'uploads'), file.path).replace(/\\/g, '/');
      const mime = file.mimetype || null;
      const kind =
        String(req.body?.file_kind || '').toLowerCase() === 'photo' || (mime && mime.startsWith('image/'))
          ? 'photo'
          : 'document';
      const ins = await query(
        `INSERT INTO office_admin_asset_attachments (
          tenant_id, asset_id, original_name, stored_path, mime_type, file_kind, caption, uploaded_by_user_id
        ) OUTPUT INSERTED.id VALUES (
          @tenantId, @assetId, @originalName, @storedPath, @mime, @kind, @caption, @userId
        )`,
        {
          tenantId,
          assetId,
          originalName: file.originalname || 'file',
          storedPath: rel,
          mime,
          kind,
          caption,
          userId: req.user.id,
        }
      );
      inserted.push(ins.recordset?.[0]?.id);
    }
    const detail = await fetchAssetDetail(tenantId, assetId);
    res.status(201).json({ ok: true, inserted_count: inserted.length, ...detail });
  } catch (err) {
    if (String(err.message).includes('office_admin_asset_attachments')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-assets-expand' });
    }
    next(err);
  }
});

router.get('/assets/:assetId/attachments/:attachmentId/file', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path, original_name, mime_type FROM office_admin_asset_attachments
       WHERE id = @attachmentId AND asset_id = @assetId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, assetId: req.params.assetId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'File not found.' });
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on server.' });
    if (get(row, 'mime_type')) res.setHeader('Content-Type', get(row, 'mime_type'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(get(row, 'original_name') || 'file')}"`);
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

router.delete('/assets/:assetId/attachments/:attachmentId', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path FROM office_admin_asset_attachments
       WHERE id = @attachmentId AND asset_id = @assetId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, assetId: req.params.assetId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    await query(
      `DELETE FROM office_admin_asset_attachments WHERE id = @attachmentId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, tenantId }
    );
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (_) {}
    }
    res.json({ ok: true });
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

function consumableParams(tenantId, raw) {
  const b = pickConsumableBody(raw || {});
  return {
    tenantId,
    name: String(b.name || '').trim(),
    category: b.category || 'other',
    unit: b.unit || 'unit',
    quantity_on_hand: b.quantity_on_hand ?? 0,
    reorder_level: b.reorder_level ?? 0,
    unit_cost: b.unit_cost ?? null,
    accounting_item_id: b.accounting_item_id || null,
    notes: b.notes || null,
    brand: b.brand || null,
    sku: b.sku || null,
    storage_location: b.storage_location || null,
    purchase_location: b.purchase_location || null,
    supplier_name: b.supplier_name || null,
    capacity: b.capacity || null,
    capacity_amount: b.capacity_amount ?? null,
    capacity_unit: b.capacity_unit || null,
    last_purchase_date: b.last_purchase_date || null,
    last_purchase_price: b.last_purchase_price ?? null,
    restock_date: b.restock_date || null,
    expiry_date: b.expiry_date || null,
    opened_date: b.opened_date || null,
    max_stock_level: b.max_stock_level ?? null,
    is_perishable: b.is_perishable ? 1 : 0,
    batch_number: b.batch_number || null,
  };
}

router.post('/consumables', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const p = consumableParams(tenantId, req.body);
    if (!p.name) return res.status(400).json({ error: 'name is required.' });
    const ins = await query(
      `INSERT INTO office_admin_consumables (
        tenant_id, name, category, unit, quantity_on_hand, reorder_level, unit_cost, accounting_item_id, notes,
        brand, sku, storage_location, purchase_location, supplier_name, capacity, capacity_amount, capacity_unit,
        last_purchase_date, last_purchase_price, restock_date, expiry_date, opened_date, max_stock_level, is_perishable, batch_number
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @name, @category, @unit, @quantity_on_hand, @reorder_level, @unit_cost, @accounting_item_id, @notes,
        @brand, @sku, @storage_location, @purchase_location, @supplier_name, @capacity, @capacity_amount, @capacity_unit,
        @last_purchase_date, @last_purchase_price, @restock_date, @expiry_date, @opened_date, @max_stock_level, @is_perishable, @batch_number
      )`,
      p
    );
    res.status(201).json({ consumable: ins.recordset?.[0] });
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({
        error: 'Supplies database needs an update. Run: npm run db:office-admin-consumables-expand',
      });
    }
    next(err);
  }
});

router.patch('/consumables/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = pickConsumableBody(req.body || {});
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of CONSUMABLE_WRITABLE_FIELDS) {
      if (b[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = col === 'is_perishable' ? (b[col] ? 1 : 0) : b[col];
      }
    }
    if (sets.length < 2) return res.status(400).json({ error: 'No fields to update.' });
    await query(`UPDATE office_admin_consumables SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    const r = await query(`SELECT * FROM office_admin_consumables WHERE id = @id AND tenant_id = @tenantId`, {
      id: req.params.id,
      tenantId,
    });
    if (!r.recordset?.[0]) return res.status(404).json({ error: 'Item not found.' });
    res.json({ consumable: r.recordset[0] });
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({
        error: 'Supplies database needs an update. Run: npm run db:office-admin-consumables-expand',
      });
    }
    next(err);
  }
});

async function fetchReportDetail(tenantId, reportId) {
  const rr = await query(
    `SELECT r.*, u.full_name AS reported_by_name, a.name AS asset_name, a.asset_code
     FROM office_admin_maintenance_reports r
     LEFT JOIN users u ON u.id = r.reported_by_user_id
     LEFT JOIN office_admin_assets a ON a.id = r.asset_id
     WHERE r.id = @id AND r.tenant_id = @tenantId`,
    { id: reportId, tenantId }
  );
  const report = rr.recordset?.[0];
  if (!report) return null;
  let attachments = [];
  try {
    const ar = await query(
      `SELECT * FROM office_admin_maintenance_report_attachments
       WHERE report_id = @id AND tenant_id = @tenantId ORDER BY created_at`,
      { id: reportId, tenantId }
    );
    attachments = (ar.recordset || []).map((row) => mapMaintAttachmentRow(row, get));
  } catch (_) {}
  return { report, attachments };
}

async function fetchRecordDetail(tenantId, recordId) {
  const rr = await query(
    `SELECT m.*, a.name AS asset_name, a.asset_code, u.full_name AS created_by_name
     FROM office_admin_maintenance_records m
     INNER JOIN office_admin_assets a ON a.id = m.asset_id
     LEFT JOIN users u ON u.id = m.created_by_user_id
     WHERE m.id = @id AND m.tenant_id = @tenantId`,
    { id: recordId, tenantId }
  );
  const record = rr.recordset?.[0];
  if (!record) return null;
  let attachments = [];
  try {
    const ar = await query(
      `SELECT * FROM office_admin_maintenance_record_attachments
       WHERE record_id = @id AND tenant_id = @tenantId ORDER BY created_at`,
      { id: recordId, tenantId }
    );
    attachments = (ar.recordset || []).map((row) => mapMaintAttachmentRow(row, get));
  } catch (_) {}
  return { record, attachments };
}

async function insertMaintAttachments({ tenantId, entityId, files, userId, table, idCol }) {
  const inserted = [];
  for (const file of files) {
    const rel = path.relative(path.join(process.cwd(), 'uploads'), file.path).replace(/\\/g, '/');
    const mime = file.mimetype || null;
    const kind = mime && mime.startsWith('image/') ? 'photo' : 'document';
    const ins = await query(
      `INSERT INTO ${table} (
        tenant_id, ${idCol}, original_name, stored_path, mime_type, file_kind, uploaded_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @tenantId, @entityId, @originalName, @storedPath, @mime, @kind, @userId
      )`,
      {
        tenantId,
        entityId,
        originalName: file.originalname || 'file',
        storedPath: rel,
        mime,
        kind,
        userId,
      }
    );
    inserted.push(ins.recordset?.[0]?.id);
  }
  return inserted;
}

/** Maintenance reports */
router.get('/maintenance/reports', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const status = req.query.status;
    let sql = `SELECT r.*, u.full_name AS reported_by_name, a.name AS asset_name, a.asset_code,
               (SELECT COUNT(*) FROM office_admin_maintenance_report_attachments att WHERE att.report_id = r.id) AS attachment_count
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
    let r;
    try {
      r = await query(sql, params);
    } catch (err) {
      if (!String(err.message).includes('office_admin_maintenance_report_attachments')) throw err;
      sql = sql.replace(
        /,\s*\(SELECT COUNT\(\*\) FROM office_admin_maintenance_report_attachments att WHERE att\.report_id = r\.id\) AS attachment_count/,
        ''
      );
      r = await query(sql, params);
    }
    res.json({ reports: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/maintenance/reports/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const detail = await fetchReportDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Report not found.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance/reports', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = pickBody(req.body || {}, REPORT_WRITABLE_FIELDS);
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required.' });
    let assetName = b.asset_name_snapshot || null;
    const assetId = b.asset_id || null;
    if (assetId) {
      const ar = await query(
        `SELECT name, asset_code, location FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`,
        { id: assetId, tenantId }
      );
      const a = ar.recordset?.[0];
      if (a) {
        assetName = get(a, 'name') || assetName;
        if (!b.location) b.location = get(a, 'location');
      }
    }
    const ins = await query(
      `INSERT INTO office_admin_maintenance_reports (
        tenant_id, asset_id, asset_name_snapshot, reported_by_user_id, title, description, priority, status,
        location, fault_category, reporter_contact, preferred_visit_date, safety_risk, external_reference,
        assigned_to, work_order_number, provider_type
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @assetId, @assetName, @userId, @title, @description, @priority, N'open',
        @location, @faultCategory, @reporterContact, @preferredVisit, @safetyRisk, @externalRef,
        @assignedTo, @workOrder, @providerType
      )`,
      {
        tenantId,
        assetId,
        assetName,
        userId: req.user.id,
        title,
        description: b.description || null,
        priority: b.priority || 'medium',
        location: b.location || null,
        faultCategory: b.fault_category || null,
        reporterContact: b.reporter_contact || null,
        preferredVisit: b.preferred_visit_date || null,
        safetyRisk: b.safety_risk ? 1 : 0,
        externalRef: b.external_reference || null,
        assignedTo: b.assigned_to || null,
        workOrder: b.work_order_number || null,
        providerType: b.provider_type || null,
      }
    );
    res.status(201).json({ report: ins.recordset?.[0] });
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.patch('/maintenance/reports/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = pickBody(req.body || {}, REPORT_WRITABLE_FIELDS);
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of REPORT_WRITABLE_FIELDS) {
      if (b[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = col === 'safety_risk' ? (b[col] ? 1 : 0) : b[col];
      }
    }
    if (b.status === 'resolved' || b.status === 'closed') {
      sets.push('resolved_at = SYSUTCDATETIME()');
    }
    if (sets.length < 2) return res.status(400).json({ error: 'No fields to update.' });
    await query(
      `UPDATE office_admin_maintenance_reports SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const detail = await fetchReportDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Report not found.' });
    res.json(detail);
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.post('/maintenance/reports/:id/attachments', reportAttachUpload.array('files', 12), async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const reportId = req.params.id;
    const exists = await query(`SELECT id FROM office_admin_maintenance_reports WHERE id = @id AND tenant_id = @tenantId`, {
      id: reportId,
      tenantId,
    });
    if (!exists.recordset?.[0]) return res.status(404).json({ error: 'Report not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Upload at least one file.' });
    await insertMaintAttachments({
      tenantId,
      entityId: reportId,
      files,
      userId: req.user.id,
      table: 'office_admin_maintenance_report_attachments',
      idCol: 'report_id',
    });
    const detail = await fetchReportDetail(tenantId, reportId);
    res.status(201).json({ ok: true, inserted_count: files.length, ...detail });
  } catch (err) {
    if (String(err.message).includes('office_admin_maintenance_report_attachments')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.get('/maintenance/reports/:reportId/attachments/:attachmentId/file', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path, original_name, mime_type FROM office_admin_maintenance_report_attachments
       WHERE id = @attachmentId AND report_id = @reportId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, reportId: req.params.reportId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'File not found.' });
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on server.' });
    if (get(row, 'mime_type')) res.setHeader('Content-Type', get(row, 'mime_type'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(get(row, 'original_name') || 'file')}"`);
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

router.delete('/maintenance/reports/:reportId/attachments/:attachmentId', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path FROM office_admin_maintenance_report_attachments
       WHERE id = @attachmentId AND report_id = @reportId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, reportId: req.params.reportId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    await query(
      `DELETE FROM office_admin_maintenance_report_attachments WHERE id = @attachmentId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, tenantId }
    );
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (_) {}
    }
    res.json({ ok: true });
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
    let sql = `SELECT m.*, a.name AS asset_name, a.asset_code,
               (SELECT COUNT(*) FROM office_admin_maintenance_record_attachments att WHERE att.record_id = m.id) AS attachment_count
               FROM office_admin_maintenance_records m
               INNER JOIN office_admin_assets a ON a.id = m.asset_id
               WHERE m.tenant_id = @tenantId`;
    const params = { tenantId };
    if (assetId) {
      sql += ` AND m.asset_id = @assetId`;
      params.assetId = assetId;
    }
    sql += ` ORDER BY m.performed_at DESC`;
    let r;
    try {
      r = await query(sql, params);
    } catch (err) {
      if (!String(err.message).includes('office_admin_maintenance_record_attachments')) throw err;
      sql = sql.replace(
        /,\s*\(SELECT COUNT\(\*\) FROM office_admin_maintenance_record_attachments att WHERE att\.record_id = m\.id\) AS attachment_count/,
        ''
      );
      r = await query(sql, params);
    }
    res.json({ records: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/maintenance/records/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const detail = await fetchRecordDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Record not found.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance/records', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = pickBody(req.body || {}, RECORD_WRITABLE_FIELDS);
    const assetId = b.asset_id;
    const description = String(b.description || '').trim();
    if (!assetId || !description) return res.status(400).json({ error: 'asset_id and description are required.' });
    let locationSnap = b.asset_location_snapshot || null;
    const ar = await query(
      `SELECT name, location FROM office_admin_assets WHERE id = @id AND tenant_id = @tenantId`,
      { id: assetId, tenantId }
    );
    if (ar.recordset?.[0] && !locationSnap) locationSnap = get(ar.recordset[0], 'location');
    const ins = await query(
      `INSERT INTO office_admin_maintenance_records (
        tenant_id, asset_id, report_id, title, maintenance_type, description, cost, performed_by, performed_at,
        next_due_at, accounting_reference, created_by_user_id, provider_type, vendor_name, vendor_contact, vendor_phone,
        labor_hours, parts_used, invoice_reference, work_order_number, asset_location_snapshot
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @assetId, @reportId, @title, @type, @description, @cost, @performedBy, @performedAt,
        @nextDue, @acctRef, @userId, @providerType, @vendorName, @vendorContact, @vendorPhone,
        @laborHours, @partsUsed, @invoiceRef, @workOrder, @locationSnap
      )`,
      {
        tenantId,
        assetId,
        reportId: b.report_id || null,
        title: b.title || null,
        type: b.maintenance_type || 'repair',
        description,
        cost: numOrNull(b.cost),
        performedBy: b.performed_by || null,
        performedAt: b.performed_at || new Date(),
        nextDue: b.next_due_at || null,
        acctRef: b.accounting_reference || null,
        userId: req.user.id,
        providerType: b.provider_type || null,
        vendorName: b.vendor_name || null,
        vendorContact: b.vendor_contact || null,
        vendorPhone: b.vendor_phone || null,
        laborHours: numOrNull(b.labor_hours),
        partsUsed: b.parts_used || null,
        invoiceRef: b.invoice_reference || null,
        workOrder: b.work_order_number || null,
        locationSnap,
      }
    );
    if (b.report_id) {
      await query(
        `UPDATE office_admin_maintenance_reports SET status = N'resolved', resolved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
         WHERE id = @reportId AND tenant_id = @tenantId`,
        { reportId: b.report_id, tenantId }
      );
    }
    await query(
      `UPDATE office_admin_assets SET status = N'active', updated_at = SYSUTCDATETIME() WHERE id = @assetId AND tenant_id = @tenantId`,
      { assetId, tenantId }
    );
    res.status(201).json({ record: ins.recordset?.[0] });
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.patch('/maintenance/records/:id', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const b = pickBody(req.body || {}, RECORD_WRITABLE_FIELDS);
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, tenantId };
    for (const col of RECORD_WRITABLE_FIELDS) {
      if (b[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = b[col];
      }
    }
    if (sets.length < 2) return res.status(400).json({ error: 'No fields to update.' });
    await query(
      `UPDATE office_admin_maintenance_records SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const detail = await fetchRecordDetail(tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Record not found.' });
    res.json(detail);
  } catch (err) {
    if (String(err.message).includes('Invalid column name')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.post('/maintenance/records/:id/attachments', recordAttachUpload.array('files', 12), async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const recordId = req.params.id;
    const exists = await query(`SELECT id FROM office_admin_maintenance_records WHERE id = @id AND tenant_id = @tenantId`, {
      id: recordId,
      tenantId,
    });
    if (!exists.recordset?.[0]) return res.status(404).json({ error: 'Record not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Upload at least one file.' });
    await insertMaintAttachments({
      tenantId,
      entityId: recordId,
      files,
      userId: req.user.id,
      table: 'office_admin_maintenance_record_attachments',
      idCol: 'record_id',
    });
    const detail = await fetchRecordDetail(tenantId, recordId);
    res.status(201).json({ ok: true, inserted_count: files.length, ...detail });
  } catch (err) {
    if (String(err.message).includes('office_admin_maintenance_record_attachments')) {
      return res.status(503).json({ error: 'Run: npm run db:office-admin-maintenance-expand' });
    }
    next(err);
  }
});

router.get('/maintenance/records/:recordId/attachments/:attachmentId/file', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path, original_name, mime_type FROM office_admin_maintenance_record_attachments
       WHERE id = @attachmentId AND record_id = @recordId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, recordId: req.params.recordId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'File not found.' });
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on server.' });
    if (get(row, 'mime_type')) res.setHeader('Content-Type', get(row, 'mime_type'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(get(row, 'original_name') || 'file')}"`);
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

router.delete('/maintenance/records/:recordId/attachments/:attachmentId', async (req, res, next) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const r = await query(
      `SELECT stored_path FROM office_admin_maintenance_record_attachments
       WHERE id = @attachmentId AND record_id = @recordId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, recordId: req.params.recordId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    await query(
      `DELETE FROM office_admin_maintenance_record_attachments WHERE id = @attachmentId AND tenant_id = @tenantId`,
      { attachmentId: req.params.attachmentId, tenantId }
    );
    const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), get(row, 'stored_path'));
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (_) {}
    }
    res.json({ ok: true });
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
