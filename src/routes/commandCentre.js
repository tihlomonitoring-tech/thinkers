import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';
import { getTenantUserEmails, getContractorUserEmails, getContractorOnlyUserEmails, getCommandCentreAndRectorEmails, getCommandCentreAndRectorEmailsForRoute, getCommandCentreAndAccessManagementEmails, getRectorEmailsForAlertTypeAndRoutes, getAccessManagementEmails } from '../lib/emailRecipients.js';
import {
  applicationApprovedHtml,
  applicationBulkApprovedHtml,
  applicationApprovedToRectorHtml,
  applicationBulkApprovedToRectorHtml,
  breakdownReportHtml,
  breakdownResolvedHtml,
  truckSuspendedToContractorHtml,
  truckSuspendedToRectorHtml,
  truckReinstatedToContractorHtml,
  truckReinstatedToRectorHtml,
  reinstatedToContractorHtml,
  reinstatedToRectorHtml,
  reinstatedToAccessManagementHtml,
  shiftReportOverrideRequestHtml,
  shiftReportOverrideCodeToRequesterHtml,
  commandCentreReminderHtml,
} from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured, formatDateForEmail, formatDateForAppTz } from '../lib/emailService.js';
import { todayYmd, addCalendarDays, toYmdFromDbOrString } from '../lib/appTime.js';
import { getAiModel, getOpenAiClient, isAiConfigured } from '../lib/ai.js';
import { registerCommandCentreSingleOpsShiftReports } from './commandCentreSingleOpsShiftReports.js';
import { buildStyledListSheet } from '../lib/distributionExcel.js';

const libraryUploadsDir = path.join(process.cwd(), 'uploads', 'library');
const libraryUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(libraryUploadsDir, String(req.user?.id || 'anon'));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

const fleetVerificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

const commandCentreLogoDir = path.join(process.cwd(), 'uploads', 'command-centre', 'logos');
const commandCentreLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(commandCentreLogoDir)) fs.mkdirSync(commandCentreLogoDir, { recursive: true });
      cb(null, commandCentreLogoDir);
    },
    filename: (req, file, cb) => {
      const tenantId = req.user?.tenant_id || 'unknown';
      const ext = (path.extname(file.originalname) || '.png').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
      cb(null, `${tenantId}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(file.mimetype);
    cb(null, !!ok);
  },
}).single('logo');

const router = Router();

/** Tab IDs that exist in Command Centre (must match client CC_TABS) */
export const CC_TAB_IDS = [
  'dashboard',
  'single_operations_dashboard',
  'data_presentation',
  'reports',
  'saved_reports',
  'trends',
  'truck_update_records',
  'shift_items',
  'shift_report_exports',
  'messages',
  'requests',
  'library',
  'compliance',
  'inspected',
  'inspection_records',
  'contractor_block',
  'applications',
  'delivery',
  'contractors_details',
  'contractor_expiries',
  'breakdowns',
  'delete_fleet_drivers',
  'handed_over_analysis',
  'fleet_verification',
  'atomic_fleet_verification',
  'command_centre_settings',
];

const FLEET_VERIFICATION_CACHE_TTL_MS = 15 * 60 * 1000;
const fleetVerificationCache = new Map();
function pruneFleetVerificationCache() {
  const now = Date.now();
  for (const [k, v] of fleetVerificationCache.entries()) {
    if (!v?.createdAt || now - v.createdAt > FLEET_VERIFICATION_CACHE_TTL_MS) {
      fleetVerificationCache.delete(k);
    }
  }
}

const atomicFleetVerificationCache = new Map();
function pruneAtomicFleetVerificationCache() {
  const now = Date.now();
  for (const [k, v] of atomicFleetVerificationCache.entries()) {
    if (!v?.createdAt || now - v.createdAt > FLEET_VERIFICATION_CACHE_TTL_MS) {
      atomicFleetVerificationCache.delete(k);
    }
  }
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('command_centre'));
registerCommandCentreSingleOpsShiftReports(router);

/** Authorize Command Centre settings management: super_admin or tenant_admin in tenant. */
function canManageCcSettings(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.role === 'tenant_admin') return true;
  return false;
}

const CC_LOGO_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** GET command centre settings for the current tenant (logo presence + URL). */
router.get('/settings', async (req, res, next) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: 'No tenant context.' });
    const r = await query(
      `SELECT cc_logo_url, cc_logo_updated_at FROM tenants WHERE id = @tid`,
      { tid }
    );
    const row = r.recordset?.[0] || {};
    res.json({
      cc_logo_url: row.cc_logo_url || null,
      cc_logo_updated_at: row.cc_logo_updated_at || null,
      can_manage: canManageCcSettings(req.user),
    });
  } catch (err) {
    next(err);
  }
});

/** GET the Command Centre logo bytes for the current tenant. */
router.get('/logo', async (req, res, next) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(404).json({ error: 'No tenant context.' });
    const r = await query(`SELECT cc_logo_url FROM tenants WHERE id = @tid`, { tid });
    const rel = r.recordset?.[0]?.cc_logo_url;
    if (!rel) return res.status(404).json({ error: 'No Command Centre logo set.' });
    const filePath = path.join(process.cwd(), 'uploads', String(rel).replace(/\//g, path.sep));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Logo file missing.' });
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', CC_LOGO_MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

/** POST a new Command Centre logo (replaces the existing one). */
router.post('/logo', (req, res, next) => {
  if (!canManageCcSettings(req.user)) return res.status(403).json({ error: 'Tenant admin or super admin required.' });
  commandCentreLogoUpload(req, res, async (err) => {
    if (err) {
      const msg = /File too large/i.test(err.message || '') ? 'Logo file is too large (max 4MB).' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No logo file. Use field name "logo" (PNG, JPEG, WebP, GIF, SVG; max 4MB).' });
      const tid = req.user.tenant_id;
      if (!tid) return res.status(400).json({ error: 'No tenant context.' });

      const cur = await query(`SELECT cc_logo_url FROM tenants WHERE id = @tid`, { tid });
      const prev = cur.recordset?.[0]?.cc_logo_url || null;
      if (prev) {
        try {
          const prevAbs = path.join(process.cwd(), 'uploads', String(prev).replace(/\//g, path.sep));
          const newAbs = req.file.path;
          if (prevAbs && fs.existsSync(prevAbs) && path.resolve(prevAbs) !== path.resolve(newAbs)) {
            fs.unlinkSync(prevAbs);
          }
        } catch (_) {}
      }

      const relativePath = `command-centre/logos/${req.file.filename}`;
      await query(
        `UPDATE tenants SET cc_logo_url = @rel, cc_logo_updated_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @tid`,
        { tid, rel: relativePath }
      );
      const after = await query(
        `SELECT cc_logo_url, cc_logo_updated_at FROM tenants WHERE id = @tid`,
        { tid }
      );
      const row = after.recordset?.[0] || {};
      res.json({
        cc_logo_url: row.cc_logo_url || null,
        cc_logo_updated_at: row.cc_logo_updated_at || null,
      });
    } catch (e) {
      next(e);
    }
  });
});

/** DELETE the Command Centre logo (revert to default). */
router.delete('/logo', async (req, res, next) => {
  try {
    if (!canManageCcSettings(req.user)) return res.status(403).json({ error: 'Tenant admin or super admin required.' });
    const tid = req.user.tenant_id;
    if (!tid) return res.status(400).json({ error: 'No tenant context.' });
    const r = await query(`SELECT cc_logo_url FROM tenants WHERE id = @tid`, { tid });
    const rel = r.recordset?.[0]?.cc_logo_url;
    if (rel) {
      try {
        const abs = path.join(process.cwd(), 'uploads', String(rel).replace(/\//g, path.sep));
        if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (_) {}
    }
    await query(
      `UPDATE tenants SET cc_logo_url = NULL, cc_logo_updated_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @tid`,
      { tid }
    );
    res.json({ cc_logo_url: null, cc_logo_updated_at: null });
  } catch (err) {
    next(err);
  }
});

/** GET my allowed tabs. Super_admin gets all; others get from grants. */
router.get('/my-tabs', async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.json({ tabs: CC_TAB_IDS });
    }
    const result = await query(
      `SELECT tab_id FROM command_centre_grants WHERE user_id = @userId`,
      { userId: req.user.id }
    );
    let tabs = (result.recordset || []).map((r) => r.tab_id).filter((id) => CC_TAB_IDS.includes(id));
    if (tabs.length > 0) {
      if (!tabs.includes('breakdowns') && CC_TAB_IDS.includes('breakdowns')) {
        tabs = [...tabs, 'breakdowns'];
      }
      if (!tabs.includes('command_centre_settings') && CC_TAB_IDS.includes('command_centre_settings')) {
        tabs = [...tabs, 'command_centre_settings'];
      }
    }
    res.json({ tabs });
  } catch (err) {
    next(err);
  }
});

/** GET list users and their granted tabs (super_admin only) */
router.get('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.user_id, g.tab_id, g.granted_at, u.full_name, u.email
       FROM command_centre_grants g
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
    res.json({ permissions: Object.values(byUser), allTabIds: CC_TAB_IDS });
  } catch (err) {
    next(err);
  }
});

/** POST grant tab to user (super_admin only) */
router.post('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.body || {};
    if (!user_id || !tab_id || !CC_TAB_IDS.includes(tab_id)) {
      return res.status(400).json({ error: 'user_id and tab_id (valid tab) required' });
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM command_centre_grants WHERE user_id = @userId AND tab_id = @tabId)
       INSERT INTO command_centre_grants (user_id, tab_id, granted_by_user_id) VALUES (@userId, @tabId, @grantedBy)`,
      { userId: user_id, tabId: tab_id, grantedBy: req.user.id }
    );
    res.status(201).json({ granted: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE revoke tab from user (super_admin only) */
router.delete('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.query;
    if (!user_id || !tab_id) {
      return res.status(400).json({ error: 'user_id and tab_id query params required' });
    }
    const result = await query(
      `DELETE FROM command_centre_grants WHERE user_id = @userId AND tab_id = @tabId`,
      { userId: user_id, tabId: tab_id }
    );
    res.json({ revoked: (result.rowsAffected?.[0] ?? 0) > 0 });
  } catch (err) {
    next(err);
  }
});

// --- Compliance inspections (8h response window; auto-suspend if no response) ---
const COMPLIANCE_STATUS = { PENDING_RESPONSE: 'pending_response', RESPONDED: 'responded', AUTO_SUSPENDED: 'auto_suspended' };
const RESPONSE_DUE_HOURS = 8;

/** POST create compliance inspection. Tenant is resolved from truck (contractor_trucks.tenant_id). */
router.post('/compliance-inspections', async (req, res, next) => {
  try {
    const body = req.body || {};
    const truckId = body.truckId || body.truck_id;
    const driverId = body.driverId || body.driver_id;
    if (!truckId || !driverId) return res.status(400).json({ error: 'truckId and driverId required' });
    const tenantResult = await query(
      `SELECT tenant_id FROM contractor_trucks WHERE id = @truckId`,
      { truckId }
    );
    const tenantId = tenantResult.recordset?.[0]?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'Truck not found' });
    const now = new Date();
    const responseDueAt = new Date(now.getTime() + RESPONSE_DUE_HOURS * 60 * 60 * 1000);
    const driverItemsJson = typeof body.driverItems === 'string' ? body.driverItems : JSON.stringify(body.driverItems || []);
    const contractorId = body.contractorId ?? body.contractor_id ?? null;
    const routeId = body.routeId ?? body.route_id ?? null;
    const routeName = body.routeName ?? body.route_name ?? null;
    let contractorNameSnapshot = body.contractorName ?? body.contractor_name ?? null;
    if (contractorId && !contractorNameSnapshot) {
      try {
        const cRow = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid: contractorId });
        contractorNameSnapshot = cRow.recordset?.[0]?.name ?? null;
      } catch (_) {}
    }
    let resolvedRouteName = routeName;
    if (routeId && !resolvedRouteName) {
      try {
        const rRow = await query(`SELECT name FROM contractor_routes WHERE id = @rid`, { rid: routeId });
        resolvedRouteName = rRow.recordset?.[0]?.name ?? null;
      } catch (_) {}
    }
    const shiftStartedAtRaw = body.shiftStartedAt ?? body.shift_started_at ?? null;
    let shiftStartedAt = null;
    if (shiftStartedAtRaw) {
      const d = new Date(shiftStartedAtRaw);
      if (!Number.isNaN(d.getTime())) shiftStartedAt = d;
    }
    const result = await query(
      `INSERT INTO cc_compliance_inspections (
        tenant_id, truck_id, driver_id, inspector_user_id,
        truck_registration, truck_make_model, driver_name, driver_id_number, license_number,
        gps_status, gps_comment, camera_status, camera_comment, camera_visibility, camera_visibility_comment,
        driver_items_json, recommend_suspend_truck, recommend_suspend_driver, response_due_at, [status],
        contractor_id, contractor_name_snapshot, route_id, route_name, shift_started_at
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @truckId, @driverId, @inspectorUserId,
        @truckRegistration, @truckMakeModel, @driverName, @driverIdNumber, @licenseNumber,
        @gpsStatus, @gpsComment, @cameraStatus, @cameraComment, @cameraVisibility, @cameraVisibilityComment,
        @driverItemsJson, @recommendSuspendTruck, @recommendSuspendDriver, @responseDueAt, @status,
        @contractorId, @contractorNameSnapshot, @routeId, @routeName, @shiftStartedAt
      )`,
      {
        tenantId,
        truckId,
        driverId,
        inspectorUserId: req.user?.id ?? null,
        truckRegistration: body.truckRegistration ?? body.truck_registration ?? null,
        truckMakeModel: body.truckMakeModel ?? body.truck_make_model ?? null,
        driverName: body.driverName ?? body.driver_name ?? null,
        driverIdNumber: body.driverIdNumber ?? body.driver_id_number ?? null,
        licenseNumber: body.licenseNumber ?? body.license_number ?? null,
        gpsStatus: body.gpsStatus ?? body.gps_status ?? null,
        gpsComment: body.gpsComment ?? body.gps_comment ?? null,
        cameraStatus: body.cameraStatus ?? body.camera_status ?? null,
        cameraComment: body.cameraComment ?? body.camera_comment ?? null,
        cameraVisibility: body.cameraVisibility ?? body.camera_visibility ?? null,
        cameraVisibilityComment: body.cameraVisibilityComment ?? body.camera_visibility_comment ?? null,
        driverItemsJson,
        recommendSuspendTruck: body.recommendSuspendTruck === true || body.recommend_suspend_truck === true ? 1 : 0,
        recommendSuspendDriver: body.recommendSuspendDriver === true || body.recommend_suspend_driver === true ? 1 : 0,
        responseDueAt,
        status: COMPLIANCE_STATUS.PENDING_RESPONSE,
        contractorId,
        contractorNameSnapshot,
        routeId,
        routeName: resolvedRouteName,
        shiftStartedAt,
      }
    );
    const row = result.recordset[0];
    const inspection = rowToComplianceInspection(row);
    res.status(201).json({ inspection });
  } catch (err) {
    next(err);
  }
});

/** Get value from row with case-insensitive key (SQL Server / driver may return different casing) */
function getRow(row, ...keys) {
  if (!row) return undefined;
  const lower = {};
  for (const k of Object.keys(row)) {
    if (k && typeof k === 'string') lower[k.toLowerCase()] = row[k];
  }
  for (const key of keys) {
    const val = lower[String(key).toLowerCase()];
    if (val !== undefined) return val;
  }
  return undefined;
}

function normalizeFleetKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function rowText(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** Read LastLocationDatetimeString from an Excel cell (text or date). */
function atomicLastLocationFromCell(cell) {
  if (!cell) return '';
  let v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) v = v.result;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    try {
      return formatDateForAppTz(v);
    } catch (_) {
      return v.toISOString();
    }
  }
  return rowText(v);
}

function isIntegratedOnAtomic(lastLocationText) {
  return !!String(lastLocationText || '').trim();
}

/** Load an uploaded .xlsx buffer; friendly errors when the file is corrupt or not Excel. */
async function loadUploadedExcelWorkbook(buffer) {
  if (!buffer || !(buffer.length > 0)) {
    const err = new Error('The uploaded file is empty.');
    err.statusCode = 400;
    throw err;
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (loadErr) {
    const detail = loadErr?.message || 'invalid format';
    const err = new Error(
      /sheets/i.test(detail)
        ? 'Could not read the Excel file. Upload a valid Atomic fleet .xlsx export (not .xls, CSV, or a renamed file).'
        : `Could not read the Excel file: ${detail}`
    );
    err.statusCode = 400;
    throw err;
  }
  const worksheets = workbook.worksheets || [];
  if (!worksheets.length) {
    const err = new Error('The workbook has no worksheets.');
    err.statusCode = 400;
    throw err;
  }
  return workbook;
}

function pickFirstHeaderIndex(headersNorm, candidates) {
  for (let i = 0; i < headersNorm.length; i++) {
    if (candidates.includes(headersNorm[i])) return i + 1;
  }
  return null;
}

/** Read header cells on one row (trim trailing empties, cap width). */
function readSheetHeaderRowRaw(sheet, rowIndex, maxCols = 80) {
  const out = [];
  for (let c = 1; c <= maxCols; c++) {
    out.push(rowText(sheet.getRow(rowIndex).getCell(c).value));
  }
  let end = out.length;
  while (end > 0 && !out[end - 1]) end -= 1;
  return out.slice(0, Math.max(end, 0));
}

function scoreTruckImportHeaderNorms(headersNorm) {
  if (!headersNorm || !headersNorm.length) return 0;
  const list = headersNorm.filter(Boolean);
  let s = 0;
  if (list.includes('contractor')) s += 8;
  if (list.some((h) => h.includes('subcontract') || h === 'subcontractor')) s += 8;
  if (list.some((h) => h.includes('truckreg') || h === 'truckregno' || (h.includes('truck') && h.includes('reg')))) s += 10;
  if (list.some((h) => h.includes('fleetno') || h === 'fleetnumber' || h === 'fleetcode')) s += 5;
  if (list.some((h) => h.includes('trailer'))) s += 4;
  if (list.some((h) => h.includes('track'))) s += 3;
  if (list.some((h) => h.includes('make') || h.includes('model') || h.includes('year'))) s += 2;
  return s;
}

function scoreDriverImportHeaderNorms(headersNorm) {
  if (!headersNorm || !headersNorm.length) return 0;
  const list = headersNorm.filter(Boolean);
  let s = 0;
  if (list.includes('contractor')) s += 6;
  if (list.some((h) => h.includes('subcontract') || h === 'subcontractor')) s += 6;
  if (list.includes('surname') || list.some((h) => h.includes('lastname'))) s += 5;
  if (list.some((h) => h === 'name' || h === 'firstname' || h.includes('fullname') || h.includes('drivername'))) s += 4;
  if (list.some((h) => h.includes('idnumber') || h === 'id' || h.includes('rsa'))) s += 7;
  if (list.some((h) => h.includes('licen'))) s += 4;
  return s;
}

function bestHeaderRowForFleetSheet(sheet, scoreFn, maxProbeRows = 12) {
  const last = Math.min(sheet.rowCount || maxProbeRows, maxProbeRows);
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= last; r++) {
    const raw = readSheetHeaderRowRaw(sheet, r);
    if (!raw.some(Boolean)) continue;
    const norms = raw.map((h) => normalizeFleetKey(h));
    const score = scoreFn(norms);
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return { headerRow: bestRow, score: bestScore };
}

function pickBestTrucksWorksheet(workbook) {
  const worksheets = workbook?.worksheets || [];
  let best = { sheet: worksheets[0] || null, headerRow: 1, score: -1 };
  for (const ws of worksheets) {
    const { headerRow, score } = bestHeaderRowForFleetSheet(ws, scoreTruckImportHeaderNorms);
    const nameBonus = /truck|fleet|vehicle|haul|transport/i.test(String(ws.name || '')) ? 6 : 0;
    const total = score + nameBonus;
    if (total > best.score) best = { sheet: ws, headerRow, score: total };
  }
  return best;
}

/** Pick a drivers sheet by name and header shape; avoid re-using the trucks sheet. */
function pickBestDriversWorksheet(workbook, trucksSheet) {
  let best = null;
  const worksheets = workbook?.worksheets || [];
  for (const ws of worksheets) {
    if (trucksSheet && ws === trucksSheet) continue;
    const { headerRow, score } = bestHeaderRowForFleetSheet(ws, scoreDriverImportHeaderNorms);
    const nameBonus = /driver|personnel|employee|staff/i.test(String(ws.name || '')) ? 6 : 0;
    const total = score + nameBonus;
    if (!best || total > best.score) best = { sheet: ws, headerRow, score: total };
  }
  if (!best || best.score < 4) return null;
  return best;
}

/** Prefer exact header tokens; never treat "Fleet_no" as contractor (avoid loose "fleet" on contractor). */
function pickContractorColumnIndex(headersNorm) {
  const exactPriority = [
    'contractor',
    'maincontractor',
    'haulier',
    'companyname',
    'transportcompany',
    'operator',
    'transporter',
    'ownername',
    'owner',
    'customer',
    'company',
    'carrier',
  ];
  for (const p of exactPriority) {
    const i = headersNorm.findIndex((h) => h === p);
    if (i >= 0) return i + 1;
  }
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    if (!h) continue;
    if (h.includes('subcontract') || h === 'subcontractor') continue;
    if (h.includes('contractor') && !h.includes('sub')) return i + 1;
  }
  return null;
}

function pickSubContractorColumnIndex(headersNorm) {
  const exact = ['subcontractor', 'sub_contractor', 'subcontractorname', 'subcontract', 'secondarycontractor', 'subcompany', 'subhaulier', 'subcarrier'];
  for (const p of exact) {
    const i = headersNorm.findIndex((h) => h === p);
    if (i >= 0) return i + 1;
  }
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    if (h && h.includes('sub') && h.includes('contract')) return i + 1;
  }
  return null;
}

function sortFleetVerificationRows(rows, regKey = 'registration') {
  return rows.slice().sort((a, b) => {
    const c1 = String(a.contractor || '').toLowerCase();
    const c2 = String(b.contractor || '').toLowerCase();
    if (c1 !== c2) return c1.localeCompare(c2);
    const s1 = String(a.sub_contractor || '').toLowerCase();
    const s2 = String(b.sub_contractor || '').toLowerCase();
    if (s1 !== s2) return s1.localeCompare(s2);
    const k1 = String(a[regKey] || a.full_name || a.id_number || '');
    const k2 = String(b[regKey] || b.full_name || b.id_number || '');
    return k1.localeCompare(k2, undefined, { sensitivity: 'base' });
  });
}

function scoreAtomicFleetHeaderNorms(headersNorm) {
  if (!headersNorm?.length) return 0;
  const list = headersNorm.filter(Boolean);
  let s = 0;
  if (list.some((h) => h === 'vehicledescr' || h.includes('vehicledesc'))) s += 10;
  if (list.some((h) => h === 'registrationnumber' || (h.includes('registration') && h.includes('number')))) s += 10;
  if (list.some((h) => h.includes('trailer1'))) s += 8;
  if (list.some((h) => h.includes('trailer2'))) s += 8;
  if (list.some((h) => h === 'parentownership' || (h.includes('parent') && h.includes('ownership')))) s += 8;
  if (list.includes('ownership') || list.some((h) => h === 'ownership' || (h.includes('ownership') && !h.includes('parent')))) s += 8;
  if (list.some((h) => h.includes('lastlocation'))) s += 6;
  return s;
}

function pickBestAtomicFleetWorksheet(workbook) {
  const worksheets = workbook?.worksheets || [];
  let best = { sheet: worksheets[0] || null, headerRow: 1, score: -1 };
  for (const ws of worksheets) {
    const { headerRow, score } = bestHeaderRowForFleetSheet(ws, scoreAtomicFleetHeaderNorms);
    const nameBonus = /atomic|fleet|vehicle|truck|transport/i.test(String(ws.name || '')) ? 6 : 0;
    const total = score + nameBonus;
    if (total > best.score) best = { sheet: ws, headerRow, score: total };
  }
  return best;
}

function pickParentOwnershipColumnIndex(headersNorm) {
  const exact = ['parentownership', 'parentowner', 'maincontractor', 'haulier', 'contractor', 'company'];
  for (const p of exact) {
    const i = headersNorm.findIndex((h) => h === p);
    if (i >= 0) return i + 1;
  }
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    if (h && h.includes('parent') && h.includes('own')) return i + 1;
  }
  return pickContractorColumnIndex(headersNorm);
}

function pickAtomicOwnershipColumnIndex(headersNorm) {
  for (let i = 0; i < headersNorm.length; i++) {
    if (headersNorm[i] === 'ownership') return i + 1;
  }
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    if (h && h.includes('ownership') && !h.includes('parent')) return i + 1;
  }
  return pickSubContractorColumnIndex(headersNorm);
}

async function inferAtomicFleetColumnsWithAi(sheetHeaders) {
  if (!isAiConfigured()) return null;
  try {
    const client = getOpenAiClient();
    const model = getAiModel();
    const prompt = [
      'You map Excel headers for Atomic Fleet export verification.',
      'Return strict JSON only: ',
      '{"vehicleDescr":"","registrationNumber":"","trailer1RegistrationNumber":"","trailer2RegistrationNumber":"","parentOwnership":"","ownership":"","lastLocationDatetimeString":""}',
      'Pick EXACT header names from the array (preserve spelling/case) or empty string if missing.',
      'parentOwnership = main contractor / haulier. ownership = sub-contractor / operator.',
      `Headers: ${JSON.stringify(sheetHeaders || [])}`,
    ].join('\n');
    const response = await Promise.race([
      client.responses.create({
        model,
        input: [{ role: 'user', content: prompt }],
        max_output_tokens: 320,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 3500)),
    ]);
    const out = String(response?.output_text || '').trim();
    if (!out) return null;
    const cleaned = out
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function inferVerificationColumnsWithAi(sheetHeaders) {
  if (!isAiConfigured()) return null;
  try {
    const client = getOpenAiClient();
    const model = getAiModel();
    const prompt = [
      'You map Excel headers for contractor import verification.',
      'Return strict JSON only with this exact shape: ',
      '{"trucks":{"registration":"","contractor":"","subContractor":"","fleetNo":"","trailer1Reg":"","trailer2Reg":"","trackingNo":"","trackingUsername":"","trackingPassword":""},',
      ' "drivers":{"idNumber":"","licenseNumber":"","fullName":"","surname":"","contractor":"","subContractor":""}}',
      'For each field, pick the EXACT header name from the supplied arrays (preserve original spelling/case),',
      'or return an empty string when none of the headers refers to that concept.',
      'A "sub contractor" / "sub-contractor" header maps to subContractor.',
      'A "main contractor" / "haulier" / "carrier" / "company" header maps to contractor.',
      `Trucks headers: ${JSON.stringify(sheetHeaders.trucks || [])}`,
      `Drivers headers: ${JSON.stringify(sheetHeaders.drivers || [])}`,
    ].join('\n');
    const response = await Promise.race([
      client.responses.create({
        model,
        input: [{ role: 'user', content: prompt }],
        max_output_tokens: 480,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 3500)),
    ]);
    const out = String(response?.output_text || '').trim();
    if (!out) return null;
    const cleaned = out
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function rowToComplianceInspection(r, responseAttachments = []) {
  if (!r) return null;
  let driverItems = [];
  try {
    const raw = getRow(r, 'driver_items_json');
    if (raw) driverItems = JSON.parse(raw);
  } catch (_) {}
  const graceExpiresAt = getRow(r, 'grace_period_expires_at');
  const graceResolvedAt = getRow(r, 'grace_period_resolved_at');
  let gracePeriodStatus = null; // null | 'active' | 'expired' | 'resolved'
  if (graceExpiresAt) {
    if (graceResolvedAt) gracePeriodStatus = 'resolved';
    else if (new Date(graceExpiresAt).getTime() < Date.now()) gracePeriodStatus = 'expired';
    else gracePeriodStatus = 'active';
  }
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    truckId: getRow(r, 'truck_id'),
    driverId: getRow(r, 'driver_id'),
    contractorId: getRow(r, 'contractor_id') || null,
    contractorNameSnapshot: getRow(r, 'contractor_name_snapshot') || null,
    routeId: getRow(r, 'route_id') || null,
    routeName: getRow(r, 'route_name') || null,
    gracePeriodGrantedAt: getRow(r, 'grace_period_granted_at') || null,
    gracePeriodDays: getRow(r, 'grace_period_days') ?? null,
    gracePeriodExpiresAt: graceExpiresAt || null,
    gracePeriodReason: getRow(r, 'grace_period_reason') || null,
    gracePeriodResolvedAt: graceResolvedAt || null,
    gracePeriodStatus,
    pendingSuspension: gracePeriodStatus === 'expired' && !graceResolvedAt,
    shiftStartedAt: getRow(r, 'shift_started_at') || null,
    truckRegistration: getRow(r, 'truck_registration'),
    truckMakeModel: getRow(r, 'truck_make_model'),
    driverName: getRow(r, 'driver_name'),
    driverIdNumber: getRow(r, 'driver_id_number'),
    licenseNumber: getRow(r, 'license_number'),
    gpsStatus: getRow(r, 'gps_status'),
    gpsComment: getRow(r, 'gps_comment'),
    cameraStatus: getRow(r, 'camera_status'),
    cameraComment: getRow(r, 'camera_comment'),
    cameraVisibility: getRow(r, 'camera_visibility'),
    cameraVisibilityComment: getRow(r, 'camera_visibility_comment'),
    driverItems,
    recommendSuspendTruck: !!getRow(r, 'recommend_suspend_truck'),
    recommendSuspendDriver: !!getRow(r, 'recommend_suspend_driver'),
    responseDueAt: getRow(r, 'response_due_at'),
    status: getRow(r, 'status'),
    contractorRespondedAt: getRow(r, 'contractor_responded_at'),
    contractorResponseText: getRow(r, 'contractor_response_text'),
    responseAttachments: Array.isArray(responseAttachments) ? responseAttachments : [],
    inspectorReplyText: getRow(r, 'inspector_reply_text'),
    inspectorRepliedAt: getRow(r, 'inspector_replied_at'),
    inspectedAt: getRow(r, 'created_at'),
    createdAt: getRow(r, 'created_at'),
    contractorName: getRow(r, 'contractor_name'),
  };
}

function mapNoteReminder(r) {
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    user_id: getRow(r, 'user_id'),
    user_name: getRow(r, 'user_name'),
    note_text: getRow(r, 'note_text'),
    is_private: !!getRow(r, 'is_private'),
    reminder_at: getRow(r, 'reminder_at'),
    reminder_sent_at: getRow(r, 'reminder_sent_at'),
    is_done: !!getRow(r, 'is_done'),
    created_at: getRow(r, 'created_at'),
    updated_at: getRow(r, 'updated_at'),
  };
}

// Notes & reminders: own private + public notes (tenant-wide) in Command Centre.
router.get('/notes-reminders', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.json({ items: [] });
    const onlyMine = String(req.query.only_mine || '').trim() === '1';
    let sqlQuery = `SELECT n.*, u.full_name AS user_name
      FROM cc_notes_reminders n
      INNER JOIN users u ON u.id = n.user_id
      WHERE n.tenant_id = @tenantId`;
    const params = { tenantId, userId: req.user.id };
    if (onlyMine) {
      sqlQuery += ` AND n.user_id = @userId`;
    } else {
      sqlQuery += ` AND (n.user_id = @userId OR n.is_private = 0)`;
    }
    sqlQuery += ` ORDER BY n.created_at DESC`;
    const result = await query(sqlQuery, params);
    res.json({ items: (result.recordset || []).map((r) => mapNoteReminder(r)) });
  } catch (err) {
    next(err);
  }
});

router.post('/notes-reminders', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const noteText = String(req.body?.note_text || '').trim();
    const isPrivate = req.body?.is_private !== false;
    const reminderAtRaw = req.body?.reminder_at;
    if (!noteText) return res.status(400).json({ error: 'note_text is required' });
    if (noteText.length > 4000) return res.status(400).json({ error: 'note_text is too long (max 4000)' });
    let reminderAt = null;
    if (reminderAtRaw != null && String(reminderAtRaw).trim()) {
      const parsed = new Date(reminderAtRaw);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid reminder_at' });
      reminderAt = parsed.toISOString();
    }
    const created = await query(
      `INSERT INTO cc_notes_reminders (tenant_id, user_id, note_text, is_private, reminder_at, is_done, updated_at)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @noteText, @isPrivate, @reminderAt, 0, SYSUTCDATETIME())`,
      { tenantId, userId: req.user.id, noteText, isPrivate: isPrivate ? 1 : 0, reminderAt }
    );
    const row = created.recordset?.[0];
    const detail = await query(
      `SELECT n.*, u.full_name AS user_name
       FROM cc_notes_reminders n
       INNER JOIN users u ON u.id = n.user_id
       WHERE n.id = @id`,
      { id: getRow(row, 'id') }
    );
    res.status(201).json({ item: mapNoteReminder(detail.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/notes-reminders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const existing = await query(`SELECT * FROM cc_notes_reminders WHERE id = @id`, { id });
    const row = existing.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'tenant_id')) !== String(tenantId)) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(row, 'user_id')) !== String(req.user.id)) return res.status(403).json({ error: 'Only the note owner can update this item' });

    const hasNoteText = Object.prototype.hasOwnProperty.call(req.body || {}, 'note_text');
    const hasPrivate = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_private');
    const hasReminder = Object.prototype.hasOwnProperty.call(req.body || {}, 'reminder_at');
    const hasDone = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_done');
    if (!hasNoteText && !hasPrivate && !hasReminder && !hasDone) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const noteText = hasNoteText ? String(req.body.note_text || '').trim() : String(getRow(row, 'note_text') || '');
    if (!noteText) return res.status(400).json({ error: 'note_text is required' });
    if (noteText.length > 4000) return res.status(400).json({ error: 'note_text is too long (max 4000)' });
    const isPrivate = hasPrivate ? !!req.body.is_private : !!getRow(row, 'is_private');
    let reminderAt = hasReminder ? req.body.reminder_at : getRow(row, 'reminder_at');
    if (hasReminder) {
      if (reminderAt == null || String(reminderAt).trim() === '') reminderAt = null;
      else {
        const parsed = new Date(reminderAt);
        if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid reminder_at' });
        reminderAt = parsed.toISOString();
      }
    }
    const isDone = hasDone ? !!req.body.is_done : !!getRow(row, 'is_done');
    const reminderSentAt = hasReminder ? null : getRow(row, 'reminder_sent_at');
    await query(
      `UPDATE cc_notes_reminders
       SET note_text = @noteText,
           is_private = @isPrivate,
           reminder_at = @reminderAt,
           reminder_sent_at = @reminderSentAt,
           is_done = @isDone,
           updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, noteText, isPrivate: isPrivate ? 1 : 0, reminderAt, reminderSentAt, isDone: isDone ? 1 : 0 }
    );
    const detail = await query(
      `SELECT n.*, u.full_name AS user_name
       FROM cc_notes_reminders n
       INNER JOIN users u ON u.id = n.user_id
       WHERE n.id = @id`,
      { id }
    );
    res.json({ item: mapNoteReminder(detail.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/notes-reminders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenant_id;
    const existing = await query(`SELECT id, tenant_id, user_id FROM cc_notes_reminders WHERE id = @id`, { id });
    const row = existing.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'tenant_id')) !== String(tenantId)) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(row, 'user_id')) !== String(req.user.id)) return res.status(403).json({ error: 'Only the note owner can delete this item' });
    await query(`DELETE FROM cc_notes_reminders WHERE id = @id`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET list compliance inspections (Command Centre: all; for Inspected / Inspection records tabs) */
router.get('/compliance-inspections', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, t.name AS contractor_name
       FROM cc_compliance_inspections c
       LEFT JOIN tenants t ON t.id = c.tenant_id
       ORDER BY c.created_at DESC`
    );
    const rows = result.recordset || [];
    const ids = rows.map((r) => getRow(r, 'id')).filter(Boolean);
    let attachmentsByInspection = {};
    if (ids.length > 0) {
      const attResult = await query(
        `SELECT compliance_inspection_id, id, file_name, stored_path, created_at FROM compliance_response_attachments ORDER BY created_at ASC`
      );
      for (const a of attResult.recordset || []) {
        const inspectionId = getRow(a, 'compliance_inspection_id');
        const key = inspectionId != null ? String(inspectionId) : '';
        if (!ids.some((id) => String(id) === key)) continue;
        if (!attachmentsByInspection[key]) attachmentsByInspection[key] = [];
        attachmentsByInspection[key].push({
          id: getRow(a, 'id'),
          fileName: getRow(a, 'file_name'),
          storedPath: getRow(a, 'stored_path'),
          createdAt: getRow(a, 'created_at'),
        });
      }
    }
    let inspections = rows.map((r) => rowToComplianceInspection(r, attachmentsByInspection[String(getRow(r, 'id'))] || []));
    const truckSuspResult = await query(
      `SELECT entity_id, is_permanent, suspension_ends_at FROM contractor_suspensions
       WHERE entity_type = N'truck' AND [status] IN (N'suspended', N'under_appeal')
       AND (is_permanent = 1 OR suspension_ends_at IS NULL OR suspension_ends_at > SYSUTCDATETIME())`
    );
    const now = new Date();
    const truckSuspensionByEntity = {};
    for (const s of truckSuspResult.recordset || []) {
      const eid = String(getRow(s, 'entity_id') || '');
      if (!eid) continue;
      const permanent = !!getRow(s, 'is_permanent');
      const endsAt = getRow(s, 'suspension_ends_at');
      if (permanent || !endsAt || new Date(endsAt) > now) {
        truckSuspensionByEntity[eid] = { permanent, endsAt: endsAt || null };
      }
    }
    inspections = inspections.map((inv) => {
      const key = String(inv.truckId || '');
      const susp = truckSuspensionByEntity[key];
      return {
        ...inv,
        truckSuspended: !!susp,
        truckSuspensionPermanent: susp?.permanent ?? false,
        truckSuspensionEndsAt: susp?.endsAt ?? null,
      };
    });
    res.json({ inspections });
  } catch (err) {
    next(err);
  }
});

/** POST suspend a truck immediately (Command Centre). Inspection does not expire until reinstatement. Body: truck_id, reason?, permanent? (default true), duration_days? (if not permanent). */
router.post('/suspend-truck', async (req, res, next) => {
  try {
    const truckId = req.body?.truck_id;
    const reason = (req.body?.reason != null ? String(req.body.reason) : req.body?.reason) ?? 'Suspended from Command Centre (Fleet and driver compliance).';
    const permanent = req.body?.permanent !== false && req.body?.permanent !== 'false';
    const durationDays = req.body?.duration_days != null ? parseInt(req.body.duration_days, 10) : null;
    if (!truckId) return res.status(400).json({ error: 'truck_id is required' });
    const truckRow = await query(
      `SELECT tenant_id FROM contractor_trucks WHERE id = @truckId`,
      { truckId }
    );
    const truck = truckRow.recordset?.[0];
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    const tenantId = getRow(truck, 'tenant_id');
    const existing = await query(
      `SELECT 1 FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'truck' AND entity_id = @entityId AND [status] IN (N'suspended', N'under_appeal')
       AND (is_permanent = 1 OR suspension_ends_at IS NULL OR suspension_ends_at > SYSUTCDATETIME())`,
      { tenantId, entityId: String(truckId) }
    );
    if (existing.recordset?.length) return res.status(409).json({ error: 'Truck is already suspended' });
    const isPermanent = permanent && (!durationDays || durationDays < 1);
    if (isPermanent) {
      await query(
        `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], is_permanent, suspension_ends_at)
         VALUES (@tenantId, N'truck', @entityId, @reason, N'suspended', 1, NULL)`,
        { tenantId, entityId: String(truckId), reason }
      );
    } else {
      const days = Math.min(Math.max(1, durationDays || 7), 3650);
      await query(
        `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], is_permanent, suspension_ends_at)
         VALUES (@tenantId, N'truck', @entityId, @reason, N'suspended', 0, DATEADD(day, @days, SYSUTCDATETIME()))`,
        { tenantId, entityId: String(truckId), reason, days }
      );
    }
    // Get truck's route IDs before removing from routes (for route-strict rector notifications)
    const truckRoutesResult = await query(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @truckId`, { truckId });
    const suspensionRouteIds = (truckRoutesResult.recordset || []).map((r) => r.route_id ?? r.route_Id).filter(Boolean);
    // Remove truck from all route enrollments so it is not on list distribution
    await query(
      `DELETE FROM contractor_route_trucks WHERE truck_id = @truckId
       AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
      { truckId, tenantId }
    );
    // Email contractor and rector (grey templates); rectors only for routes the truck was on
    if (isEmailConfigured?.() && sendEmail && getCommandCentreAndAccessManagementEmails && getRectorEmailsForAlertTypeAndRoutes) {
      try {
        const truckInfo = await query(
          `SELECT t.registration, t.contractor_id FROM contractor_trucks t WHERE t.id = @truckId`,
          { truckId }
        );
        const truckRow = truckInfo.recordset?.[0];
        const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        const truckRegistration = truckRow?.registration || `Truck #${truckId}`;
        const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
        const truckContractorId = truckRow?.contractor_id ?? truckRow?.contractor_Id ?? null;
        let suspensionEndsAt = null;
        if (!isPermanent && durationDays) {
          const endRow = await query(
            `SELECT suspension_ends_at FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'truck' AND entity_id = @entityId ORDER BY id DESC`,
            { tenantId, entityId: String(truckId) }
          );
          const endsAt = endRow.recordset?.[0]?.suspension_ends_at;
          if (endsAt) suspensionEndsAt = toYmdFromDbOrString(endsAt) || (typeof endsAt === 'string' ? endsAt : String(endsAt));
        }
        const contractorEmails = truckContractorId ? await getContractorUserEmails(query, tenantId, truckContractorId) : await getTenantUserEmails(query, tenantId);
        const ccAm = await getCommandCentreAndAccessManagementEmails(query);
        const rectorSusp = suspensionRouteIds.length > 0 ? await getRectorEmailsForAlertTypeAndRoutes(query, 'suspension_alerts', suspensionRouteIds) : [];
        const rectorEmails = [...new Set([...ccAm, ...rectorSusp])];
        const appUrl = process.env.APP_URL || '';
        if (contractorEmails.length) {
          const html = truckSuspendedToContractorHtml({
            truckRegistration,
            tenantName,
            reason,
            isPermanent,
            suspensionEndsAt,
            appUrl,
          });
          await sendEmail({ to: contractorEmails, subject: `Truck suspended: ${truckRegistration}`, body: html, html: true });
        }
        if (rectorEmails.length) {
          const html = truckSuspendedToRectorHtml({ truckRegistration, tenantName, reason, isPermanent, suspensionEndsAt });
          await sendEmail({ to: rectorEmails, subject: `Truck suspended (for your awareness): ${truckRegistration} – ${tenantName}`, body: html, html: true });
        }
      } catch (e) {
        console.warn('[commandCentre] suspend-truck email failed:', e?.message || e);
      }
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET suspensions for Command Centre (under_appeal and suspended, with entity labels). Optional ?status=under_appeal|suspended. */
router.get('/suspensions', async (req, res, next) => {
  try {
    const statusFilter = req.query.status === 'under_appeal' || req.query.status === 'suspended' ? req.query.status : null;
    let sql = `
      SELECT s.id, s.tenant_id, s.entity_type, s.entity_id, s.reason, s.[status], s.appeal_notes, s.is_permanent, s.suspension_ends_at, s.created_at, s.updated_at,
        t.name AS tenant_name,
        tr.registration AS truck_registration,
        tr.make_model AS truck_make_model,
        dr.full_name AS driver_name,
        dr.license_number AS driver_license
      FROM contractor_suspensions s
      LEFT JOIN tenants t ON t.id = s.tenant_id
      LEFT JOIN contractor_trucks tr ON tr.tenant_id = s.tenant_id AND tr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'truck'
      LEFT JOIN contractor_drivers dr ON dr.tenant_id = s.tenant_id AND dr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'driver'
      WHERE s.[status] IN (N'suspended', N'under_appeal')
    `;
    const params = {};
    if (statusFilter) { sql += ` AND s.[status] = @status`; params.status = statusFilter; }
    sql += ` ORDER BY s.created_at DESC`;
    const result = await query(sql, params);
    const rows = (result.recordset || []).map((r) => ({
      ...r,
      entity_label: getRow(r, 'entity_type') === 'truck' ? (getRow(r, 'truck_registration') || `Truck #${getRow(r, 'entity_id')}`) : (getRow(r, 'driver_name') || `Driver #${getRow(r, 'entity_id')}`),
    }));
    res.json({ suspensions: rows });
  } catch (err) {
    next(err);
  }
});

/** POST reinstate a suspension (Command Centre unblock). Body: { suspensionId }. Updates status to reinstated, sends contractor + rector + AM emails. */
router.post('/reinstate-suspension', async (req, res, next) => {
  try {
    const suspensionId = req.body?.suspensionId ?? req.body?.suspension_id;
    if (!suspensionId) return res.status(400).json({ error: 'suspensionId is required' });
    const existing = await query(
      `SELECT id, tenant_id, entity_type, entity_id, [status] FROM contractor_suspensions WHERE id = @id`,
      { id: suspensionId }
    );
    const row = existing.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Suspension not found' });
    const status = getRow(row, 'status');
    if (String(status).toLowerCase() === 'reinstated') return res.status(400).json({ error: 'Already reinstated' });
    const tenantId = getRow(row, 'tenant_id');
    const entityType = String(getRow(row, 'entity_type') || '').toLowerCase();
    const entityId = getRow(row, 'entity_id');
    if (entityType !== 'truck' && entityType !== 'driver') return res.status(400).json({ error: 'Only truck or driver suspensions can be reinstated' });
    await query(
      `UPDATE contractor_suspensions SET [status] = N'reinstated', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: suspensionId }
    );
    if (tenantId && entityId && isEmailConfigured?.() && sendEmail && getCommandCentreAndAccessManagementEmails && getRectorEmailsForAlertTypeAndRoutes && getAccessManagementEmails) {
      try {
        const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
        let entityLabel = '';
        let entityContractorId = null;
        let routeIds = [];
        if (entityType === 'truck') {
          const truckInfo = await query(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const tr = truckInfo.recordset?.[0];
          entityLabel = tr?.registration || `Truck #${entityId}`;
          entityContractorId = tr?.contractor_id ?? tr?.contractor_Id ?? null;
          const trRoutes = await query(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @entityId`, { entityId });
          routeIds = (trRoutes.recordset || []).map((r) => r.route_id ?? r.route_Id).filter(Boolean);
        } else {
          const driverInfo = await query(`SELECT full_name, contractor_id FROM contractor_drivers WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const dr = driverInfo.recordset?.[0];
          entityLabel = dr?.full_name || `Driver #${entityId}`;
          entityContractorId = dr?.contractor_id ?? dr?.contractor_Id ?? null;
          const drRoutes = await query(`SELECT route_id FROM contractor_route_drivers WHERE driver_id = @entityId`, { entityId });
          routeIds = (drRoutes.recordset || []).map((r) => r.route_id ?? r.route_Id).filter(Boolean);
        }
        const appUrl = process.env.APP_URL || '';
        const reinstatedBy = req.user?.full_name || req.user?.email || 'Command Centre';
        const contractorEmails = entityContractorId ? await getContractorUserEmails(query, tenantId, entityContractorId) : await getTenantUserEmails(query, tenantId);
        const ccAm = await getCommandCentreAndAccessManagementEmails(query);
        const rectorReinst = routeIds.length > 0 ? await getRectorEmailsForAlertTypeAndRoutes(query, 'reinstatement_alerts', routeIds) : [];
        const rectorEmails = [...new Set([...ccAm, ...rectorReinst])];
        const accessManagementEmails = await getAccessManagementEmails(query);
        if (contractorEmails.length) {
          const html = reinstatedToContractorHtml({ entityType, entityLabel, tenantName, appUrl });
          await sendEmail({ to: contractorEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} reinstated: ${entityLabel}`, body: html, html: true });
        }
        if (rectorEmails.length) {
          const html = reinstatedToRectorHtml({ entityType, entityLabel, tenantName });
          await sendEmail({ to: rectorEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} reinstated (for your awareness): ${entityLabel} – ${tenantName}`, body: html, html: true });
        }
        if (accessManagementEmails.length) {
          const html = reinstatedToAccessManagementHtml({ entityType, entityLabel, tenantName, reinstatedBy });
          await sendEmail({ to: accessManagementEmails, subject: `Reinstatement approved: ${entityLabel} (${tenantName})`, body: html, html: true });
        }
      } catch (e) {
        console.warn('[commandCentre] reinstate email failed:', e?.message || e);
      }
    }
    res.json({ ok: true, reinstated: true });
  } catch (err) {
    next(err);
  }
});

/** PATCH reply to contractor feedback (Command Centre) */
router.patch('/compliance-inspections/:id/reply', async (req, res, next) => {
  try {
    const { id } = req.params;
    const replyText = (req.body?.replyText != null ? String(req.body.replyText) : req.body?.replyText) ?? '';
    const result = await query(
      `UPDATE cc_compliance_inspections SET inspector_reply_text = @replyText, inspector_replied_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.id WHERE id = @id`,
      { id, replyText }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Inspection not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** PATCH compliance inspection meta: contractor / route / shift_started_at */
router.patch('/compliance-inspections/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const existing = await query(`SELECT id FROM cc_compliance_inspections WHERE id = @id`, { id });
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const sets = [];
    const params = { id };
    if (Object.prototype.hasOwnProperty.call(body, 'contractor_id') || Object.prototype.hasOwnProperty.call(body, 'contractorId')) {
      const cid = body.contractor_id ?? body.contractorId ?? null;
      sets.push('contractor_id = @contractorId');
      params.contractorId = cid;
      if (cid) {
        try {
          const c = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid });
          sets.push('contractor_name_snapshot = @contractorName');
          params.contractorName = c.recordset?.[0]?.name ?? null;
        } catch (_) {
          sets.push('contractor_name_snapshot = @contractorName');
          params.contractorName = body.contractor_name ?? body.contractorName ?? null;
        }
      } else {
        sets.push('contractor_name_snapshot = @contractorName');
        params.contractorName = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'route_id') || Object.prototype.hasOwnProperty.call(body, 'routeId')) {
      const rid = body.route_id ?? body.routeId ?? null;
      sets.push('route_id = @routeId');
      params.routeId = rid;
      if (rid) {
        try {
          const r = await query(`SELECT name FROM contractor_routes WHERE id = @rid`, { rid });
          sets.push('route_name = @routeName');
          params.routeName = r.recordset?.[0]?.name ?? null;
        } catch (_) {
          sets.push('route_name = @routeName');
          params.routeName = body.route_name ?? body.routeName ?? null;
        }
      } else {
        sets.push('route_name = @routeName');
        params.routeName = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'shift_started_at') || Object.prototype.hasOwnProperty.call(body, 'shiftStartedAt')) {
      const raw = body.shift_started_at ?? body.shiftStartedAt;
      let dt = null;
      if (raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) dt = d;
      }
      sets.push('shift_started_at = @shiftStartedAt');
      params.shiftStartedAt = dt;
    }
    if (sets.length === 0) return res.json({ ok: true, changed: false });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE cc_compliance_inspections SET ${sets.join(', ')} WHERE id = @id`, params);
    const refreshed = await query(
      `SELECT c.*, t.name AS contractor_name FROM cc_compliance_inspections c LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.id = @id`,
      { id }
    );
    res.json({ inspection: rowToComplianceInspection(refreshed.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** POST award / update grace period for a compliance inspection */
router.post('/compliance-inspections/:id/grace-period', async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days <= 0 || days > 365) return res.status(400).json({ error: 'days must be 1-365' });
    const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
    const existing = await query(`SELECT id FROM cc_compliance_inspections WHERE id = @id`, { id });
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + days * 24 * 60 * 60 * 1000);
    await query(
      `UPDATE cc_compliance_inspections
         SET grace_period_granted_at = @grantedAt,
             grace_period_days = @days,
             grace_period_expires_at = @expiresAt,
             grace_period_reason = @reason,
             grace_period_resolved_at = NULL,
             updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, grantedAt, days, expiresAt, reason: reason || null }
    );
    const refreshed = await query(
      `SELECT c.*, t.name AS contractor_name FROM cc_compliance_inspections c LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.id = @id`,
      { id }
    );
    res.json({ inspection: rowToComplianceInspection(refreshed.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** POST mark grace period as resolved (compliance corrected) */
router.post('/compliance-inspections/:id/grace-period/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await query(`SELECT id FROM cc_compliance_inspections WHERE id = @id`, { id });
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Not found' });
    await query(
      `UPDATE cc_compliance_inspections
         SET grace_period_resolved_at = SYSUTCDATETIME(),
             updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id }
    );
    const refreshed = await query(
      `SELECT c.*, t.name AS contractor_name FROM cc_compliance_inspections c LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.id = @id`,
      { id }
    );
    res.json({ inspection: rowToComplianceInspection(refreshed.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** GET compliance communication logs for an inspection */
router.get('/compliance-inspections/:id/comm-logs', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM cc_compliance_comm_logs WHERE inspection_id = @id ORDER BY created_at ASC`,
      { id }
    );
    const logs = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      tenantId: getRow(r, 'tenant_id'),
      inspectionId: getRow(r, 'inspection_id'),
      controllerUserId: getRow(r, 'controller_user_id'),
      controllerName: getRow(r, 'controller_name'),
      shiftStartedAt: getRow(r, 'shift_started_at'),
      time: getRow(r, 'log_time'),
      recipient: getRow(r, 'recipient'),
      subject: getRow(r, 'subject'),
      method: getRow(r, 'method'),
      actionRequired: getRow(r, 'action_required'),
      notes: getRow(r, 'notes'),
      createdAt: getRow(r, 'created_at'),
    }));
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

/** POST add a compliance communication log entry */
router.post('/compliance-inspections/:id/comm-logs', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const insp = await query(
      `SELECT tenant_id, shift_started_at FROM cc_compliance_inspections WHERE id = @id`,
      { id }
    );
    const inspRow = insp.recordset?.[0];
    if (!inspRow) return res.status(404).json({ error: 'Inspection not found' });
    const tenantId = getRow(inspRow, 'tenant_id');
    const shiftStartedAt = getRow(inspRow, 'shift_started_at') || null;
    const result = await query(
      `INSERT INTO cc_compliance_comm_logs (
         tenant_id, inspection_id, controller_user_id, controller_name, shift_started_at,
         log_time, recipient, subject, method, action_required, notes
       ) OUTPUT INSERTED.* VALUES (
         @tenantId, @id, @controllerUserId, @controllerName, @shiftStartedAt,
         @logTime, @recipient, @subject, @method, @actionRequired, @notes
       )`,
      {
        id,
        tenantId,
        controllerUserId: req.user?.id ?? null,
        controllerName: req.user?.full_name ?? null,
        shiftStartedAt,
        logTime: body.time ?? body.log_time ?? null,
        recipient: body.recipient ?? null,
        subject: body.subject ?? null,
        method: body.method ?? null,
        actionRequired: body.action_required ?? body.actionRequired ?? null,
        notes: body.notes ?? null,
      }
    );
    const r = result.recordset?.[0];
    res.status(201).json({
      log: {
        id: getRow(r, 'id'),
        tenantId: getRow(r, 'tenant_id'),
        inspectionId: getRow(r, 'inspection_id'),
        controllerUserId: getRow(r, 'controller_user_id'),
        controllerName: getRow(r, 'controller_name'),
        shiftStartedAt: getRow(r, 'shift_started_at'),
        time: getRow(r, 'log_time'),
        recipient: getRow(r, 'recipient'),
        subject: getRow(r, 'subject'),
        method: getRow(r, 'method'),
        actionRequired: getRow(r, 'action_required'),
        notes: getRow(r, 'notes'),
        createdAt: getRow(r, 'created_at'),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE a compliance communication log entry */
router.delete('/compliance-inspections/:id/comm-logs/:logId', async (req, res, next) => {
  try {
    const { id, logId } = req.params;
    await query(`DELETE FROM cc_compliance_comm_logs WHERE id = @logId AND inspection_id = @id`, { id, logId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET non-compliance entries for an inspection */
router.get('/compliance-inspections/:id/non-compliance', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM cc_compliance_non_compliance WHERE inspection_id = @id ORDER BY created_at ASC`,
      { id }
    );
    const items = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      tenantId: getRow(r, 'tenant_id'),
      inspectionId: getRow(r, 'inspection_id'),
      controllerUserId: getRow(r, 'controller_user_id'),
      controllerName: getRow(r, 'controller_name'),
      shiftStartedAt: getRow(r, 'shift_started_at'),
      driverName: getRow(r, 'driver_name'),
      truckReg: getRow(r, 'truck_reg'),
      ruleViolated: getRow(r, 'rule_violated'),
      timeOfCall: getRow(r, 'time_of_call'),
      summary: getRow(r, 'summary'),
      driverResponse: getRow(r, 'driver_response'),
      severity: getRow(r, 'severity'),
      createdAt: getRow(r, 'created_at'),
    }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** POST add a non-compliance entry to an inspection */
router.post('/compliance-inspections/:id/non-compliance', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const insp = await query(
      `SELECT tenant_id, shift_started_at, truck_registration, driver_name FROM cc_compliance_inspections WHERE id = @id`,
      { id }
    );
    const inspRow = insp.recordset?.[0];
    if (!inspRow) return res.status(404).json({ error: 'Inspection not found' });
    const tenantId = getRow(inspRow, 'tenant_id');
    const shiftStartedAt = getRow(inspRow, 'shift_started_at') || null;
    const truckReg = body.truck_reg ?? body.truckReg ?? getRow(inspRow, 'truck_registration') ?? null;
    const driverName = body.driver_name ?? body.driverName ?? getRow(inspRow, 'driver_name') ?? null;
    const result = await query(
      `INSERT INTO cc_compliance_non_compliance (
         tenant_id, inspection_id, controller_user_id, controller_name, shift_started_at,
         driver_name, truck_reg, rule_violated, time_of_call, summary, driver_response, severity
       ) OUTPUT INSERTED.* VALUES (
         @tenantId, @id, @controllerUserId, @controllerName, @shiftStartedAt,
         @driverName, @truckReg, @ruleViolated, @timeOfCall, @summary, @driverResponse, @severity
       )`,
      {
        id,
        tenantId,
        controllerUserId: req.user?.id ?? null,
        controllerName: req.user?.full_name ?? null,
        shiftStartedAt,
        driverName,
        truckReg,
        ruleViolated: body.rule_violated ?? body.ruleViolated ?? null,
        timeOfCall: body.time_of_call ?? body.timeOfCall ?? null,
        summary: body.summary ?? null,
        driverResponse: body.driver_response ?? body.driverResponse ?? null,
        severity: body.severity ?? null,
      }
    );
    const r = result.recordset?.[0];
    res.status(201).json({
      item: {
        id: getRow(r, 'id'),
        tenantId: getRow(r, 'tenant_id'),
        inspectionId: getRow(r, 'inspection_id'),
        controllerUserId: getRow(r, 'controller_user_id'),
        controllerName: getRow(r, 'controller_name'),
        shiftStartedAt: getRow(r, 'shift_started_at'),
        driverName: getRow(r, 'driver_name'),
        truckReg: getRow(r, 'truck_reg'),
        ruleViolated: getRow(r, 'rule_violated'),
        timeOfCall: getRow(r, 'time_of_call'),
        summary: getRow(r, 'summary'),
        driverResponse: getRow(r, 'driver_response'),
        severity: getRow(r, 'severity'),
        createdAt: getRow(r, 'created_at'),
      },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE non-compliance entry */
router.delete('/compliance-inspections/:id/non-compliance/:itemId', async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    await query(
      `DELETE FROM cc_compliance_non_compliance WHERE id = @itemId AND inspection_id = @id`,
      { id, itemId }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET compliance entries created during a controller's shift, scoped to that controller only.
 * Used by the shift report "Export from system" feature.
 * Query params:
 *   - shift_started_at (ISO datetime, required) — start of the controller's shift
 *   - shift_ended_at (ISO datetime, optional) — end of shift, defaults to now
 *   - controller_user_id (optional, defaults to current user)
 */
router.get('/compliance-shift-export', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const startRaw = req.query.shift_started_at || req.query.shiftStartedAt;
    if (!startRaw) return res.status(400).json({ error: 'shift_started_at is required' });
    const startDate = new Date(startRaw);
    if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'invalid shift_started_at' });
    const endRaw = req.query.shift_ended_at || req.query.shiftEndedAt;
    let endDate = endRaw ? new Date(endRaw) : new Date();
    if (Number.isNaN(endDate.getTime())) endDate = new Date();
    const controllerUserId = req.query.controller_user_id || req.query.controllerUserId || req.user?.id || null;
    const params = { tenantId, startDate, endDate, controllerUserId };
    const commsResult = await query(
      `SELECT * FROM cc_compliance_comm_logs
         WHERE tenant_id = @tenantId
           AND created_at >= @startDate
           AND created_at <= @endDate
           AND (@controllerUserId IS NULL OR controller_user_id = @controllerUserId)
         ORDER BY created_at ASC`,
      params
    );
    const noncompResult = await query(
      `SELECT n.*, i.contractor_name_snapshot, i.route_name
         FROM cc_compliance_non_compliance n
         LEFT JOIN cc_compliance_inspections i ON i.id = n.inspection_id
         WHERE n.tenant_id = @tenantId
           AND n.created_at >= @startDate
           AND n.created_at <= @endDate
           AND (@controllerUserId IS NULL OR n.controller_user_id = @controllerUserId)
         ORDER BY n.created_at ASC`,
      params
    );
    const communicationLog = (commsResult.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      time: getRow(r, 'log_time') || '',
      recipient: getRow(r, 'recipient') || '',
      subject: getRow(r, 'subject') || '',
      method: getRow(r, 'method') || '',
      action_required: getRow(r, 'action_required') || '',
      source: 'compliance_inspection',
      controller_name: getRow(r, 'controller_name') || '',
      created_at: getRow(r, 'created_at'),
    }));
    const nonCompliance = (noncompResult.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      driver_name: getRow(r, 'driver_name') || '',
      truck_reg: getRow(r, 'truck_reg') || '',
      rule_violated: getRow(r, 'rule_violated') || '',
      time_of_call: getRow(r, 'time_of_call') || '',
      summary: getRow(r, 'summary') || '',
      driver_response: getRow(r, 'driver_response') || '',
      contractor_name: getRow(r, 'contractor_name_snapshot') || '',
      route: getRow(r, 'route_name') || '',
      source: 'compliance_inspection',
      controller_name: getRow(r, 'controller_name') || '',
      created_at: getRow(r, 'created_at'),
    }));
    res.json({
      shift_started_at: startDate.toISOString(),
      shift_ended_at: endDate.toISOString(),
      controller_user_id: controllerUserId,
      communication_log: communicationLog,
      non_compliance: nonCompliance,
    });
  } catch (err) {
    next(err);
  }
});

/** GET compliance response attachment file (Command Centre view) */
router.get('/compliance-inspections/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const { id, attachmentId } = req.params;
    const insp = await query(
      `SELECT 1 FROM cc_compliance_inspections WHERE id = @id`,
      { id }
    );
    if (!insp.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const att = await query(
      `SELECT file_name, stored_path FROM compliance_response_attachments WHERE id = @attachmentId AND compliance_inspection_id = @id`,
      { attachmentId, id }
    );
    const row = att.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const fullPath = path.join(process.cwd(), 'uploads', row.stored_path.split('/').join(path.sep));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `inline; filename="${(row.file_name || 'attachment').replace(/"/g, '%22')}"`);
    res.sendFile(fullPath);
  } catch (err) {
    next(err);
  }
});

// --- Fleet & driver applications (contract additions: approve/decline for facility access) ---
/** GET list rectors (users linked in access_route_factors) for "Notify rectors" selection when approving applications */
router.get('/rectors', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM access_route_factors f
       INNER JOIN users u ON u.id = f.user_id
       WHERE f.user_id IS NOT NULL AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''
       ORDER BY u.full_name ASC`
    );
    const list = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      full_name: getRow(r, 'full_name'),
      email: getRow(r, 'email'),
    }));
    res.json({ rectors: list });
  } catch (err) {
    next(err);
  }
});

/** GET rectors with their route (for breakdown "Notify rector" – show all rectors by route so CC can select the correct one). */
router.get('/rectors-with-routes', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email, f.route_id, r.name AS route_name
       FROM access_route_factors f
       INNER JOIN users u ON u.id = f.user_id
       LEFT JOIN contractor_routes r ON r.id = f.route_id
       WHERE f.user_id IS NOT NULL AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''
       ORDER BY r.name ASC, u.full_name ASC`
    );
    const list = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      full_name: getRow(r, 'full_name'),
      email: getRow(r, 'email'),
      route_id: getRow(r, 'route_id'),
      route_name: getRow(r, 'route_name') || '—',
    }));
    res.json({ rectors: list });
  } catch (err) {
    next(err);
  }
});

/** GET list fleet applications (all contract additions including imports). Optional ?status=pending */
router.get('/fleet-applications', async (req, res, next) => {
  try {
    const statusFilter = req.query.status === 'pending' ? "AND a.[status] = N'pending'" : '';
    const result = await query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.source, a.[status], a.reviewed_by_user_id, a.reviewed_at, a.decline_reason, a.created_at,
        COALESCE(c.name, t.name) AS contractor_name,
        CASE
          WHEN a.entity_type = N'truck' THEN
            COALESCE(sc_tr.company_name, NULLIF(LTRIM(RTRIM(tr.sub_contractor)), N''))
          ELSE
            COALESCE(sc_d.company_name, sc_lt.company_name, NULLIF(LTRIM(RTRIM(lt.sub_contractor)), N''))
        END AS subcontractor_display,
        tr.registration AS truck_registration, tr.make_model AS truck_make_model, tr.main_contractor AS truck_main_contractor, tr.sub_contractor AS truck_sub_contractor,
        tr.year_model AS truck_year_model, tr.ownership_desc AS truck_ownership_desc, tr.fleet_no AS truck_fleet_no,
        tr.trailer_1_reg_no AS truck_trailer_1_reg_no, tr.trailer_2_reg_no AS truck_trailer_2_reg_no,
        tr.tracking_provider AS truck_tracking_provider, tr.tracking_username AS truck_tracking_username, tr.tracking_password AS truck_tracking_password,
        tr.commodity_type AS truck_commodity_type, tr.capacity_tonnes AS truck_capacity_tonnes, tr.[status] AS truck_status,
        d.full_name AS driver_name, d.surname AS driver_surname, d.id_number AS driver_id_number, d.license_number AS driver_license_number,
        d.license_expiry AS driver_license_expiry, d.phone AS driver_phone, d.email AS driver_email
       FROM cc_fleet_applications a
       JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = a.entity_id AND a.entity_type = N'truck'
       LEFT JOIN contractor_drivers d ON d.id = a.entity_id AND a.entity_type = N'driver'
       LEFT JOIN contractors c ON c.id = COALESCE(tr.contractor_id, d.contractor_id)
       LEFT JOIN contractor_subcontractors sc_tr ON sc_tr.id = tr.subcontractor_id AND sc_tr.tenant_id = a.tenant_id
       LEFT JOIN contractor_subcontractors sc_d ON sc_d.id = d.subcontractor_id AND sc_d.tenant_id = a.tenant_id
       LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id AND lt.tenant_id = d.tenant_id AND a.entity_type = N'driver'
       LEFT JOIN contractor_subcontractors sc_lt ON sc_lt.id = lt.subcontractor_id AND sc_lt.tenant_id = a.tenant_id
       WHERE 1=1 ${statusFilter}
       ORDER BY a.created_at DESC`
    );
    const rows = result.recordset || [];
    const list = rows.map((r) => ({
      id: getRow(r, 'id'),
      tenantId: getRow(r, 'tenant_id'),
      contractorName: getRow(r, 'contractor_name'),
      subcontractorDisplay: getRow(r, 'subcontractor_display'),
      entityType: getRow(r, 'entity_type'),
      entityId: getRow(r, 'entity_id'),
      source: getRow(r, 'source'),
      status: getRow(r, 'status'),
      reviewedByUserId: getRow(r, 'reviewed_by_user_id'),
      reviewedAt: getRow(r, 'reviewed_at'),
      declineReason: getRow(r, 'decline_reason'),
      createdAt: getRow(r, 'created_at'),
      truckRegistration: getRow(r, 'truck_registration'),
      truckMakeModel: getRow(r, 'truck_make_model'),
      truckMainContractor: getRow(r, 'truck_main_contractor'),
      truckSubContractor: getRow(r, 'truck_sub_contractor'),
      truckYearModel: getRow(r, 'truck_year_model'),
      truckOwnershipDesc: getRow(r, 'truck_ownership_desc'),
      truckFleetNo: getRow(r, 'truck_fleet_no'),
      truckTrailer1RegNo: getRow(r, 'truck_trailer_1_reg_no'),
      truckTrailer2RegNo: getRow(r, 'truck_trailer_2_reg_no'),
      truckTrackingProvider: getRow(r, 'truck_tracking_provider'),
      truckTrackingUsername: getRow(r, 'truck_tracking_username'),
      truckTrackingPassword: getRow(r, 'truck_tracking_password'),
      truckCommodityType: getRow(r, 'truck_commodity_type'),
      truckCapacityTonnes: getRow(r, 'truck_capacity_tonnes'),
      truckStatus: getRow(r, 'truck_status'),
      driverName: getRow(r, 'driver_name'),
      driverSurname: getRow(r, 'driver_surname'),
      driverIdNumber: getRow(r, 'driver_id_number'),
      driverLicenseNumber: getRow(r, 'driver_license_number'),
      driverLicenseExpiry: getRow(r, 'driver_license_expiry'),
      driverPhone: getRow(r, 'driver_phone'),
      driverEmail: getRow(r, 'driver_email'),
    }));
    res.json({ applications: list });
  } catch (err) {
    next(err);
  }
});

/** GET fleet with linked drivers for Integration tab (one row per truck, optional linked driver columns). Optional ?tenantId= */
router.get('/fleet-integration', async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId || '';
    const tenantFilter = tenantId ? 'AND tr.tenant_id = @tenantId' : '';
    const params = tenantId ? { tenantId } : {};
    const result = await query(
      `SELECT tr.id AS truck_id, t.name AS contractor_name, tr.registration AS truck_registration,
        tr.make_model AS truck_make_model, tr.year_model AS truck_year_model, tr.main_contractor AS truck_main_contractor,
        tr.sub_contractor AS truck_sub_contractor, tr.ownership_desc AS truck_ownership_desc, tr.fleet_no AS truck_fleet_no,
        tr.trailer_1_reg_no AS truck_trailer_1_reg_no, tr.trailer_2_reg_no AS truck_trailer_2_reg_no,
        tr.tracking_provider AS truck_tracking_provider, tr.tracking_username AS truck_tracking_username,
        tr.tracking_password AS truck_tracking_password, tr.commodity_type AS truck_commodity_type,
        tr.capacity_tonnes AS truck_capacity_tonnes, tr.[status] AS truck_status,
        dr.driver_full_name, dr.driver_surname, dr.driver_id_number, dr.driver_license_number,
        dr.driver_license_expiry, dr.driver_phone, dr.driver_email
       FROM contractor_trucks tr
       JOIN tenants t ON t.id = tr.tenant_id
       OUTER APPLY (
         SELECT TOP 1
           d.full_name AS driver_full_name, d.surname AS driver_surname, d.id_number AS driver_id_number,
           d.license_number AS driver_license_number, d.license_expiry AS driver_license_expiry,
           d.phone AS driver_phone, d.email AS driver_email
         FROM contractor_drivers d
         WHERE d.linked_truck_id = tr.id AND d.tenant_id = tr.tenant_id
         ORDER BY d.full_name
       ) dr
       WHERE 1=1 ${tenantFilter}
       ORDER BY t.name, tr.registration`,
      params
    );
    const rows = result.recordset || [];
    const list = rows.map((r) => ({
      truckId: getRow(r, 'truck_id'),
      contractorName: getRow(r, 'contractor_name'),
      truckRegistration: getRow(r, 'truck_registration'),
      nameOrRegistration: getRow(r, 'truck_registration'),
      truckMakeModel: getRow(r, 'truck_make_model'),
      truckYearModel: getRow(r, 'truck_year_model'),
      truckMainContractor: getRow(r, 'truck_main_contractor'),
      truckSubContractor: getRow(r, 'truck_sub_contractor'),
      truckOwnershipDesc: getRow(r, 'truck_ownership_desc'),
      truckFleetNo: getRow(r, 'truck_fleet_no'),
      truckTrailer1RegNo: getRow(r, 'truck_trailer_1_reg_no'),
      truckTrailer2RegNo: getRow(r, 'truck_trailer_2_reg_no'),
      truckTrackingProvider: getRow(r, 'truck_tracking_provider'),
      truckTrackingUsername: getRow(r, 'truck_tracking_username'),
      truckTrackingPassword: getRow(r, 'truck_tracking_password'),
      truckCommodityType: getRow(r, 'truck_commodity_type'),
      truckCapacityTonnes: getRow(r, 'truck_capacity_tonnes'),
      truckStatus: getRow(r, 'truck_status'),
      driverFullName: getRow(r, 'driver_full_name'),
      driverSurname: getRow(r, 'driver_surname'),
      driverIdNumber: getRow(r, 'driver_id_number'),
      driverLicenseNumber: getRow(r, 'driver_license_number'),
      driverLicenseExpiry: getRow(r, 'driver_license_expiry'),
      driverPhone: getRow(r, 'driver_phone'),
      driverEmail: getRow(r, 'driver_email'),
    }));
    res.json({ rows: list });
  } catch (err) {
    next(err);
  }
});

/** List contractors for fleet-verification haulier selector. Returns [{ id, name, truck_count }]. */
router.get('/fleet-verification/contractors', async (req, res, next) => {
  try {
    const tenantId = String(req.query?.tenant_id || '').trim() || null;
    if (!tenantId) return res.json({ contractors: [] });
    const result = await query(
      `SELECT c.id, c.name,
              (SELECT COUNT(1) FROM contractor_trucks t WHERE t.tenant_id = @tenantId AND t.contractor_id = c.id) AS truck_count
       FROM contractors c
       WHERE c.tenant_id = @tenantId
       ORDER BY c.name`,
      { tenantId }
    );
    const contractors = (result.recordset || []).map((r) => ({
      id: r.id,
      name: r.name || '',
      truck_count: Number(r.truck_count || 0),
    }));
    res.json({ contractors });
  } catch (err) {
    next(err);
  }
});

router.post('/fleet-verification/verify', fleetVerificationUpload, async (req, res, next) => {
  try {
    pruneFleetVerificationCache();
    if (!req.file?.buffer) return res.status(400).json({ error: 'Upload an Excel file (.xlsx)' });
    const tenantId = String(req.body?.tenant_id || '').trim() || null;
    const rawContractorScope = String(req.body?.contractor_id || '').trim();
    const checkAllContractors = !rawContractorScope || rawContractorScope.toLowerCase() === 'all';
    const contractorId = checkAllContractors ? null : rawContractorScope;
    const startedAt = Date.now();

    const workbook = await loadUploadedExcelWorkbook(req.file.buffer);

    const truckPick = pickBestTrucksWorksheet(workbook);
    const trucksSheet = truckPick.sheet;
    const truckHeaderRow = truckPick.headerRow || 1;
    const driverPick = pickBestDriversWorksheet(workbook, trucksSheet);
    const driversSheet = driverPick ? driverPick.sheet : null;
    const driverHeaderRow = driverPick ? driverPick.headerRow : 1;
    if (!trucksSheet && !driversSheet) {
      return res.status(400).json({ error: 'Workbook must contain Trucks and/or Drivers sheets' });
    }
    const detectedSheets = {
      trucks: trucksSheet ? trucksSheet.name : null,
      trucks_header_row: truckHeaderRow,
      drivers: driversSheet ? driversSheet.name : null,
      drivers_header_row: driversSheet ? driverHeaderRow : null,
      all_sheets: workbook.worksheets.map((ws) => ws.name),
    };

    const truckHeadersRaw = trucksSheet ? readSheetHeaderRowRaw(trucksSheet, truckHeaderRow) : [];
    const driverHeadersRaw = driversSheet ? readSheetHeaderRowRaw(driversSheet, driverHeaderRow) : [];
    const truckHeadersNorm = truckHeadersRaw.map((h) => normalizeFleetKey(h));
    const driverHeadersNorm = driverHeadersRaw.map((h) => normalizeFleetKey(h));

    const aiColumns = await inferVerificationColumnsWithAi({ trucks: truckHeadersRaw, drivers: driverHeadersRaw });
    const findHeaderIdx = (headersRaw, headerName) => {
      const target = normalizeFleetKey(headerName);
      if (!target) return 0;
      const idx = headersRaw.findIndex((h) => normalizeFleetKey(h) === target);
      return idx >= 0 ? idx + 1 : 0;
    };
    const aiTruckRegIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.registration);
    const aiTruckContractorIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.contractor);
    const aiTruckSubContractorIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.subContractor);
    const aiTruckFleetNoIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.fleetNo);
    const aiDriverIdIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.idNumber);
    const aiDriverLicenseIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.licenseNumber);
    const aiDriverFullNameIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.fullName);
    const aiDriverContractorIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.contractor);
    const aiDriverSubContractorIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.subContractor);

    const aiTruckTrailer1Idx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.trailer1Reg);
    const aiTruckTrailer2Idx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.trailer2Reg);
    const aiTruckTrackingNoIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.trackingNo);
    const aiTruckTrackingUserIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.trackingUsername);
    const aiTruckTrackingPassIdx = findHeaderIdx(truckHeadersRaw, aiColumns?.trucks?.trackingPassword);
    const aiDriverSurnameIdx = findHeaderIdx(driverHeadersRaw, aiColumns?.drivers?.surname);

    const truckRegCol = (aiTruckRegIdx > 0 ? aiTruckRegIdx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'truckregno', 'truckreg', 'registration', 'truckregistrationnumber', 'horseregistration', 'horsereg', 'vehicleregistration', 'vehiclereg', 'reg', 'plate', 'numberplate',
    ]);
    const driverIdCol = (aiDriverIdIdx > 0 ? aiDriverIdIdx : null) || pickFirstHeaderIndex(driverHeadersNorm, [
      'idnumber', 'id', 'identitynumber', 'driveridnumber', 'driverid', 'rsaid', 'nationalid', 'identitydocument',
    ]);
    const driverLicenseCol = (aiDriverLicenseIdx > 0 ? aiDriverLicenseIdx : null) || pickFirstHeaderIndex(driverHeadersNorm, [
      'driverslicensenumber', 'licensenumber', 'licence', 'licencenumber', 'driverslicence', 'driverlicense', 'driverslicenseno', 'driverslicense',
    ]);
    const driverGivenNameCol = (aiDriverFullNameIdx > 0 ? aiDriverFullNameIdx : null) || pickFirstHeaderIndex(driverHeadersNorm, [
      'name', 'firstname', 'forename', 'givenname', 'fullname', 'drivername', 'driverfullname', 'first_name',
    ]);
    const driverSurnameCol = (aiDriverSurnameIdx > 0 ? aiDriverSurnameIdx : null) || pickFirstHeaderIndex(driverHeadersNorm, [
      'surname', 'lastname', 'familyname', 'last_name',
    ]);

    const truckContractorCol = (aiTruckContractorIdx > 0 ? aiTruckContractorIdx : null) || pickContractorColumnIndex(truckHeadersNorm);
    const truckSubContractorCol = (aiTruckSubContractorIdx > 0 ? aiTruckSubContractorIdx : null) || pickSubContractorColumnIndex(truckHeadersNorm);
    const driverContractorCol = (aiDriverContractorIdx > 0 ? aiDriverContractorIdx : null) || pickContractorColumnIndex(driverHeadersNorm);
    const driverSubContractorCol = (aiDriverSubContractorIdx > 0 ? aiDriverSubContractorIdx : null) || pickSubContractorColumnIndex(driverHeadersNorm);
    const truckFleetNoCol = (aiTruckFleetNoIdx > 0 ? aiTruckFleetNoIdx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'fleetno', 'fleetnumber', 'fleetcode', 'truckno', 'trucknumber', 'vehicleno', 'vehiclenumber',
    ]);

    const truckTrailer1Col = (aiTruckTrailer1Idx > 0 ? aiTruckTrailer1Idx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'trailer1regno', 'trailer1reg', 'trailer_1_reg_no', 'trailer1', 'trailer1registration', 'trailerreg1', 'trail1regno', 'traileronereg', 'trailer_1',
    ]);
    const truckTrailer2Col = (aiTruckTrailer2Idx > 0 ? aiTruckTrailer2Idx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'trailer2regno', 'trailer2reg', 'trailer_2_reg_no', 'trailer2', 'trailer2registration', 'trailerreg2', 'trail2regno', 'trailer_2',
    ]);
    const truckTrackingNoCol = (aiTruckTrackingNoIdx > 0 ? aiTruckTrackingNoIdx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'trackingno', 'trackingnumber', 'tracking_id', 'trackingid', 'gpsno', 'gpsnumber', 'deviceno', 'trackerno', 'fleettracking',
    ]);
    const truckTrackingUserCol = (aiTruckTrackingUserIdx > 0 ? aiTruckTrackingUserIdx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'trackingusername', 'trackusername', 'username', 'login', 'userid', 'user', 'portalusername', 'webusername',
    ]);
    const truckTrackingPassCol = (aiTruckTrackingPassIdx > 0 ? aiTruckTrackingPassIdx : null) || pickFirstHeaderIndex(truckHeadersNorm, [
      'trackingpassword', 'trackpassword', 'password', 'pwd', 'pass', 'portalpassword', 'webpassword',
    ]);

    // Capture detected column information so the API response (and UI) can surface it clearly.
    const detectedColumns = {
      trucks: {
        header_row: truckHeaderRow,
        registration: truckRegCol ? truckHeadersRaw[truckRegCol - 1] : null,
        contractor: truckContractorCol ? truckHeadersRaw[truckContractorCol - 1] : null,
        sub_contractor: truckSubContractorCol ? truckHeadersRaw[truckSubContractorCol - 1] : null,
        fleet_no: truckFleetNoCol ? truckHeadersRaw[truckFleetNoCol - 1] : null,
        trailer_1_reg: truckTrailer1Col ? truckHeadersRaw[truckTrailer1Col - 1] : null,
        trailer_2_reg: truckTrailer2Col ? truckHeadersRaw[truckTrailer2Col - 1] : null,
        tracking_no: truckTrackingNoCol ? truckHeadersRaw[truckTrackingNoCol - 1] : null,
        tracking_username: truckTrackingUserCol ? truckHeadersRaw[truckTrackingUserCol - 1] : null,
        tracking_password: truckTrackingPassCol ? truckHeadersRaw[truckTrackingPassCol - 1] : null,
      },
      drivers: {
        header_row: driversSheet ? driverHeaderRow : null,
        id_number: driverIdCol ? driverHeadersRaw[driverIdCol - 1] : null,
        license_number: driverLicenseCol ? driverHeadersRaw[driverLicenseCol - 1] : null,
        given_name: driverGivenNameCol ? driverHeadersRaw[driverGivenNameCol - 1] : null,
        surname: driverSurnameCol ? driverHeadersRaw[driverSurnameCol - 1] : null,
        contractor: driverContractorCol ? driverHeadersRaw[driverContractorCol - 1] : null,
        sub_contractor: driverSubContractorCol ? driverHeadersRaw[driverSubContractorCol - 1] : null,
      },
    };

    // Resolve haulier label.
    let hauliierLabel = checkAllContractors ? 'All contractors' : '';
    if (contractorId) {
      try {
        const params = { contractorId };
        let whereSql = '';
        if (tenantId) {
          whereSql = 'AND tenant_id = @tenantId';
          params.tenantId = tenantId;
        }
        const cnameRes = await query(
          `SELECT name FROM contractors WHERE id = @contractorId ${whereSql}`,
          params
        );
        hauliierLabel = rowText(cnameRes.recordset?.[0]?.name) || 'Selected contractor';
      } catch (_) { hauliierLabel = 'Selected contractor'; }
    }
    let tenantLabel = '';
    if (tenantId) {
      try {
        const tnameRes = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        tenantLabel = rowText(tnameRes.recordset?.[0]?.name) || '';
      } catch (_) { /* ignore */ }
    }

    // Pull enrolled trucks/drivers scoped to tenant + (optionally) contractor.
    const truckParams = {};
    const truckWhere = [];
    if (tenantId) { truckWhere.push('tr.tenant_id = @tenantId'); truckParams.tenantId = tenantId; }
    if (contractorId) { truckWhere.push('tr.contractor_id = @contractorId'); truckParams.contractorId = contractorId; }
    const truckWhereSql = truckWhere.length ? `WHERE ${truckWhere.join(' AND ')}` : '';
    const truckRows = await query(
      `SELECT tr.registration, tr.fleet_no, tr.main_contractor, tr.sub_contractor,
              c.name AS contractor_name, c.id AS contractor_id
       FROM contractor_trucks tr
       LEFT JOIN contractors c ON c.id = tr.contractor_id
       ${truckWhereSql}`,
      truckParams
    );
    const driverParams = {};
    const driverWhere = [];
    if (tenantId) { driverWhere.push('d.tenant_id = @tenantId'); driverParams.tenantId = tenantId; }
    if (contractorId) { driverWhere.push('d.contractor_id = @contractorId'); driverParams.contractorId = contractorId; }
    const driverWhereSql = driverWhere.length ? `WHERE ${driverWhere.join(' AND ')}` : '';
    const driverRows = await query(
      `SELECT d.id_number, d.license_number, d.full_name, d.surname,
              c.name AS contractor_name, c.id AS contractor_id
       FROM contractor_drivers d
       LEFT JOIN contractors c ON c.id = d.contractor_id
       ${driverWhereSql}`,
      driverParams
    );
    const truckByReg = new Map();
    for (const r of truckRows.recordset || []) {
      const key = normalizeFleetKey(getRow(r, 'registration'));
      if (key && !truckByReg.has(key)) truckByReg.set(key, r);
    }
    const driverById = new Map();
    const driverByLicense = new Map();
    for (const r of driverRows.recordset || []) {
      const idKey = normalizeFleetKey(getRow(r, 'id_number'));
      const licKey = normalizeFleetKey(getRow(r, 'license_number'));
      if (idKey && !driverById.has(idKey)) driverById.set(idKey, r);
      if (licKey && !driverByLicense.has(licKey)) driverByLicense.set(licKey, r);
    }

    // Walk every uploaded row and build a clean result list.
    const truckResults = [];
    const driverResults = [];
    let matchedTrucks = 0;
    let matchedDrivers = 0;

    if (trucksSheet) {
      const maxColScan = Math.max(truckHeadersRaw.length, 60, trucksSheet.columnCount || 0);
      const dataStart = truckHeaderRow + 1;
      for (let r = dataStart; r <= trucksSheet.rowCount; r++) {
        const row = trucksSheet.getRow(r);
        const regRaw = truckRegCol ? rowText(row.getCell(truckRegCol).value) : '';
        let hasAnyVal = false;
        for (let c = 1; c <= maxColScan; c++) {
          if (rowText(row.getCell(c).value)) { hasAnyVal = true; break; }
        }
        if (!hasAnyVal) continue;

        const sourceContractor = truckContractorCol ? rowText(row.getCell(truckContractorCol).value) : '';
        const sourceSubContractor = truckSubContractorCol ? rowText(row.getCell(truckSubContractorCol).value) : '';
        const sourceFleetNo = truckFleetNoCol ? rowText(row.getCell(truckFleetNoCol).value) : '';
        const trailer1 = truckTrailer1Col ? rowText(row.getCell(truckTrailer1Col).value) : '';
        const trailer2 = truckTrailer2Col ? rowText(row.getCell(truckTrailer2Col).value) : '';
        const trackingNo = truckTrackingNoCol ? rowText(row.getCell(truckTrackingNoCol).value) : '';
        const trackingUser = truckTrackingUserCol ? rowText(row.getCell(truckTrackingUserCol).value) : '';
        const trackingPass = truckTrackingPassCol ? rowText(row.getCell(truckTrackingPassCol).value) : '';

        const regNorm = normalizeFleetKey(regRaw);
        const hit = regNorm ? truckByReg.get(regNorm) : null;
        const integrated = !!hit;
        if (integrated) matchedTrucks++;
        const matchedContractor = rowText(getRow(hit, 'contractor_name') || getRow(hit, 'main_contractor') || getRow(hit, 'sub_contractor'));
        const matchedSubContractor = rowText(getRow(hit, 'sub_contractor'));
        const contractorOut = sourceContractor || (integrated ? matchedContractor : '');
        const subContractorOut = sourceSubContractor || (integrated ? matchedSubContractor : '');
        const fleetNoOut = sourceFleetNo || (integrated ? rowText(getRow(hit, 'fleet_no')) : '');
        truckResults.push({
          source_row: r,
          registration: regRaw,
          integration_status: integrated ? 'Integrated' : 'Not integrated',
          contractor: contractorOut,
          sub_contractor: subContractorOut,
          fleet_no: fleetNoOut,
          trailer_1_reg: trailer1,
          trailer_2_reg: trailer2,
          tracking_no: trackingNo,
          tracking_username: trackingUser,
          tracking_password: trackingPass,
          notes: integrated
            ? `Matched on truck registration${regRaw ? `: ${regRaw}` : ''}`
            : regRaw ? 'Not enrolled on the system' : 'Missing registration value',
        });
      }
    }

    if (driversSheet) {
      const maxColScan = Math.max(driverHeadersRaw.length, 60, driversSheet.columnCount || 0);
      const dataStart = driverHeaderRow + 1;
      for (let r = dataStart; r <= driversSheet.rowCount; r++) {
        const row = driversSheet.getRow(r);
        const idRaw = driverIdCol ? rowText(row.getCell(driverIdCol).value) : '';
        const licRaw = driverLicenseCol ? rowText(row.getCell(driverLicenseCol).value) : '';
        const given = driverGivenNameCol ? rowText(row.getCell(driverGivenNameCol).value) : '';
        const surname = driverSurnameCol ? rowText(row.getCell(driverSurnameCol).value) : '';
        const stitchedName = [given, surname].filter(Boolean).join(' ').trim();

        let hasAnyVal = false;
        for (let c = 1; c <= maxColScan; c++) {
          if (rowText(row.getCell(c).value)) { hasAnyVal = true; break; }
        }
        if (!hasAnyVal) continue;

        const sourceContractor = driverContractorCol ? rowText(row.getCell(driverContractorCol).value) : '';
        const sourceSubContractor = driverSubContractorCol ? rowText(row.getCell(driverSubContractorCol).value) : '';

        const idNorm = normalizeFleetKey(idRaw);
        const licNorm = normalizeFleetKey(licRaw);
        const hitById = idNorm ? driverById.get(idNorm) : null;
        const hitByLic = licNorm ? driverByLicense.get(licNorm) : null;
        const hit = hitById || hitByLic || null;
        const integrated = !!hit;
        if (integrated) matchedDrivers++;
        const matchedFullName = hit
          ? [rowText(getRow(hit, 'full_name')), rowText(getRow(hit, 'surname'))].filter(Boolean).join(' ')
          : '';
        const matchedContractor = rowText(getRow(hit, 'contractor_name'));
        const contractorOut = sourceContractor || (integrated ? matchedContractor : '');
        const fullNameOut = stitchedName || matchedFullName;
        driverResults.push({
          source_row: r,
          id_number: idRaw,
          license_number: licRaw,
          full_name: fullNameOut,
          integration_status: integrated ? 'Integrated' : 'Not integrated',
          contractor: contractorOut,
          sub_contractor: sourceSubContractor || '',
          notes: integrated
            ? hitById ? `Matched on driver ID number${idRaw ? `: ${idRaw}` : ''}`
              : `Matched on driver licence number${licRaw ? `: ${licRaw}` : ''}`
            : (idRaw || licRaw || stitchedName) ? 'Not enrolled on the system' : 'Missing ID, licence or name',
        });
      }
    }

    // Build the verified workbook in the list-distribution style.
    const outWorkbook = new ExcelJS.Workbook();
    outWorkbook.creator = 'Thinkers';
    const generatedAt = new Date();

    // Office theme "Olive Green, Accent 3, Lighter 60%" – used to highlight integrated rows.
    const INTEGRATED_FILL = 'FFD8E4BC';
    const integrationValueStyles = {
      integration_status: {
        Integrated: { fill: INTEGRATED_FILL, font: { color: { argb: 'FF1F3D0A' }, bold: true } },
      },
    };

    const truckHeaders = [
      'Contractor', 'Sub-contractor', 'Truck registration', 'Fleet no',
      'Trailer 1 reg', 'Trailer 2 reg', 'Tracking no', 'Tracking username', 'Tracking password',
      'Integration status', 'Notes',
    ];
    const truckKeys = [
      'contractor', 'sub_contractor', 'registration', 'fleet_no',
      'trailer_1_reg', 'trailer_2_reg', 'tracking_no', 'tracking_username', 'tracking_password',
      'integration_status', 'notes',
    ];
    const truckGroupBy = 'sub_contractor';
    buildStyledListSheet(outWorkbook, {
      sheetName: 'Trucks (verified)',
      headers: truckHeaders,
      keys: truckKeys,
      rows: sortFleetVerificationRows(truckResults, 'registration'),
      info: [
        ['Tenant:', tenantLabel || '—'],
        ['Haulier checked:', hauliierLabel],
        ['Source sheet:', 'Trucks'],
        ['Date & time:', formatDateForAppTz(generatedAt)],
        ['Total rows:', String(truckResults.length)],
        ['Integrated:', String(matchedTrucks)],
        ['Not integrated:', String(truckResults.length - matchedTrucks)],
      ],
      groupBy: truckGroupBy,
      minColumnWidth: 12,
      maxColumnWidth: 44,
      columnWidths: {
        notes: 36,
        registration: 16,
        fleet_no: 12,
        trailer_1_reg: 14,
        trailer_2_reg: 14,
        tracking_no: 14,
        tracking_username: 18,
        tracking_password: 18,
        integration_status: 16,
      },
      autoFilter: true,
      valueStyles: integrationValueStyles,
    });

    const driverHeaders = [
      'Contractor', 'Sub-contractor', 'Full name', 'ID number', 'Licence number', 'Integration status', 'Notes',
    ];
    const driverKeys = ['contractor', 'sub_contractor', 'full_name', 'id_number', 'license_number', 'integration_status', 'notes'];
    const driverGroupBy = 'sub_contractor';
    buildStyledListSheet(outWorkbook, {
      sheetName: 'Drivers (verified)',
      headers: driverHeaders,
      keys: driverKeys,
      rows: sortFleetVerificationRows(driverResults, 'full_name'),
      info: [
        ['Tenant:', tenantLabel || '—'],
        ['Haulier checked:', hauliierLabel],
        ['Source sheet:', 'Drivers'],
        ['Date & time:', formatDateForAppTz(generatedAt)],
        ['Total rows:', String(driverResults.length)],
        ['Integrated:', String(matchedDrivers)],
        ['Not integrated:', String(driverResults.length - matchedDrivers)],
      ],
      groupBy: driverGroupBy,
      minColumnWidth: 14,
      maxColumnWidth: 44,
      columnWidths: { notes: 38, integration_status: 18 },
      autoFilter: true,
      valueStyles: integrationValueStyles,
    });

    const outBuffer = await outWorkbook.xlsx.writeBuffer();
    const token = randomUUID();
    const inName = rowText(req.file.originalname) || 'fleet-import.xlsx';
    const baseName = inName.toLowerCase().endsWith('.xlsx') ? inName.replace(/\.xlsx$/i, '') : inName;
    const safeHaulier = (checkAllContractors ? 'All contractors' : hauliierLabel || 'Contractor').replace(/[^A-Za-z0-9 _-]+/g, '').trim();
    const filename = `${baseName} - Fleet verification (${safeHaulier}).xlsx`;
    fleetVerificationCache.set(token, {
      createdAt: Date.now(),
      filename,
      buffer: Buffer.from(outBuffer),
    });

    res.json({
      ok: true,
      token,
      download_url: `/api/command-centre/fleet-verification/download/${token}`,
      file_name: filename,
      haulier: { id: contractorId, label: hauliierLabel, check_all: checkAllContractors },
      tenant: { id: tenantId, label: tenantLabel },
      summary: {
        total_truck_rows: truckResults.length,
        total_driver_rows: driverResults.length,
        matched_trucks: matchedTrucks,
        matched_drivers: matchedDrivers,
        not_integrated_trucks: truckResults.length - matchedTrucks,
        not_integrated_drivers: driverResults.length - matchedDrivers,
      },
      results: {
        trucks: truckResults,
        drivers: driverResults,
      },
      ai: {
        used: !!aiColumns,
        model: aiColumns ? getAiModel() : null,
        mapped_headers: detectedColumns,
      },
      detected: {
        sheets: detectedSheets,
        columns: detectedColumns,
      },
      warnings: [
        ...(driversSheet ? [] : [`No drivers sheet was auto-detected. We look for a tab whose name suggests drivers (e.g. "Drivers") and whose first rows look like a driver list (Name, Surname, ID number). Sheets in this file: ${detectedSheets.all_sheets.join(', ') || 'none'}.`]),
        ...(!detectedColumns.trucks.contractor && trucksSheet ? ['No contractor column detected in the Trucks sheet. Headers expected include "Contractor", "Main contractor", "Haulier", "Company".'] : []),
        ...(!detectedColumns.trucks.sub_contractor && trucksSheet ? ['No sub-contractor column detected in the Trucks sheet. Expected headers include "Sub-contractor", "Sub contractor".'] : []),
      ],
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/fleet-verification/download/:token', async (req, res, next) => {
  try {
    pruneFleetVerificationCache();
    const token = String(req.params.token || '');
    const item = fleetVerificationCache.get(token);
    if (!item) return res.status(404).json({ error: 'Verification file expired or not found' });
    if (Date.now() - item.createdAt > FLEET_VERIFICATION_CACHE_TTL_MS) {
      fleetVerificationCache.delete(token);
      return res.status(410).json({ error: 'Verification file expired. Please run verification again.' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${item.filename}"`);
    res.send(item.buffer);
  } catch (err) {
    next(err);
  }
});

/** List contractors for Atomic fleet verification haulier filter. */
router.get('/atomic-fleet-verification/contractors', async (req, res, next) => {
  try {
    const tenantId = String(req.query?.tenant_id || '').trim() || null;
    if (!tenantId) return res.json({ contractors: [] });
    const result = await query(
      `SELECT c.id, c.name,
              (SELECT COUNT(1) FROM contractor_trucks t WHERE t.tenant_id = @tenantId AND t.contractor_id = c.id) AS truck_count
       FROM contractors c
       WHERE c.tenant_id = @tenantId
       ORDER BY c.name`,
      { tenantId }
    );
    const contractors = (result.recordset || []).map((r) => ({
      id: r.id,
      name: r.name || '',
      truck_count: Number(r.truck_count || 0),
    }));
    res.json({ contractors });
  } catch (err) {
    next(err);
  }
});

router.post('/atomic-fleet-verification/verify', fleetVerificationUpload, async (req, res, next) => {
  try {
    pruneAtomicFleetVerificationCache();
    if (!req.file?.buffer) return res.status(400).json({ error: 'Upload an Atomic fleet Excel file (.xlsx)' });
    const tenantId = String(req.body?.tenant_id || '').trim() || null;
    const rawContractorScope = String(req.body?.contractor_id || '').trim();
    const checkAllContractors = !rawContractorScope || rawContractorScope.toLowerCase() === 'all';
    const contractorId = checkAllContractors ? null : rawContractorScope;
    const startedAt = Date.now();

    const workbook = await loadUploadedExcelWorkbook(req.file.buffer);

    const atomicPick = pickBestAtomicFleetWorksheet(workbook);
    const atomicSheet = atomicPick.sheet;
    const headerRow = atomicPick.headerRow || 1;
    if (!atomicSheet || atomicPick.score < 4) {
      return res.status(400).json({
        error: 'Could not find an Atomic fleet sheet. Expected columns such as VehicleDescr, RegistrationNumber, ParentOwnership, Ownership, Trailer1RegistrationNumber.',
        detected_sheets: workbook.worksheets.map((ws) => ws.name),
      });
    }

    const headersRaw = readSheetHeaderRowRaw(atomicSheet, headerRow);
    const headersNorm = headersRaw.map((h) => normalizeFleetKey(h));
    const aiColumns = await inferAtomicFleetColumnsWithAi(headersRaw);
    const findHeaderIdx = (headerName) => {
      const target = normalizeFleetKey(headerName);
      if (!target) return 0;
      const idx = headersRaw.findIndex((h) => normalizeFleetKey(h) === target);
      return idx >= 0 ? idx + 1 : 0;
    };

    const vehicleDescrCol = findHeaderIdx(aiColumns?.vehicleDescr) || pickFirstHeaderIndex(headersNorm, [
      'vehicledescr', 'vehicledescription', 'vehicleid', 'fleetno', 'fleetnumber', 'fleetcode', 'unitno',
    ]);
    const regCol = findHeaderIdx(aiColumns?.registrationNumber) || pickFirstHeaderIndex(headersNorm, [
      'registrationnumber', 'registration', 'truckregno', 'truckregistration', 'regno', 'vehicleregistration',
    ]);
    const trailer1Col = findHeaderIdx(aiColumns?.trailer1RegistrationNumber) || pickFirstHeaderIndex(headersNorm, [
      'trailer1registrationnumber', 'trailer1regno', 'trailer1reg', 'trailer1', 'trailer_1',
    ]);
    const trailer2Col = findHeaderIdx(aiColumns?.trailer2RegistrationNumber) || pickFirstHeaderIndex(headersNorm, [
      'trailer2registrationnumber', 'trailer2regno', 'trailer2reg', 'trailer2', 'trailer_2',
    ]);
    const parentOwnershipCol = findHeaderIdx(aiColumns?.parentOwnership) || pickParentOwnershipColumnIndex(headersNorm);
    const ownershipCol = findHeaderIdx(aiColumns?.ownership) || pickAtomicOwnershipColumnIndex(headersNorm);
    const lastLocationCol = findHeaderIdx(aiColumns?.lastLocationDatetimeString) || pickFirstHeaderIndex(headersNorm, [
      'lastlocationdatetimestring', 'lastlocationdatetime', 'lastlocation', 'lastreported', 'lastposition', 'lastgps',
    ]);

    const detectedColumns = {
      header_row: headerRow,
      vehicle_descr: vehicleDescrCol ? headersRaw[vehicleDescrCol - 1] : null,
      registration: regCol ? headersRaw[regCol - 1] : null,
      trailer_1_reg: trailer1Col ? headersRaw[trailer1Col - 1] : null,
      trailer_2_reg: trailer2Col ? headersRaw[trailer2Col - 1] : null,
      parent_ownership: parentOwnershipCol ? headersRaw[parentOwnershipCol - 1] : null,
      ownership: ownershipCol ? headersRaw[ownershipCol - 1] : null,
      last_location: lastLocationCol ? headersRaw[lastLocationCol - 1] : null,
    };

    let hauliierLabel = checkAllContractors ? 'All contractors' : '';
    if (contractorId) {
      try {
        const params = { contractorId };
        let whereSql = '';
        if (tenantId) {
          whereSql = 'AND tenant_id = @tenantId';
          params.tenantId = tenantId;
        }
        const cnameRes = await query(
          `SELECT name FROM contractors WHERE id = @contractorId ${whereSql}`,
          params
        );
        hauliierLabel = rowText(cnameRes.recordset?.[0]?.name) || 'Selected contractor';
      } catch (_) {
        hauliierLabel = 'Selected contractor';
      }
    }
    let tenantLabel = '';
    if (tenantId) {
      try {
        const tnameRes = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        tenantLabel = rowText(tnameRes.recordset?.[0]?.name) || '';
      } catch (_) { /* ignore */ }
    }

    const truckParams = {};
    const truckWhere = [];
    if (tenantId) { truckWhere.push('tr.tenant_id = @tenantId'); truckParams.tenantId = tenantId; }
    if (contractorId) { truckWhere.push('tr.contractor_id = @contractorId'); truckParams.contractorId = contractorId; }
    const truckWhereSql = truckWhere.length ? `WHERE ${truckWhere.join(' AND ')}` : '';
    const truckRows = await query(
      `SELECT tr.id, tr.registration, tr.fleet_no, tr.main_contractor, tr.sub_contractor,
              tr.trailer_1_reg_no, tr.trailer_2_reg_no, tr.tracking_provider, tr.[status],
              c.name AS contractor_name, c.id AS contractor_id
       FROM contractor_trucks tr
       LEFT JOIN contractors c ON c.id = tr.contractor_id
       ${truckWhereSql}`,
      truckParams
    );

    const truckByReg = new Map();
    const truckByFleetNo = new Map();
    const systemTruckKeys = new Set();
    for (const r of truckRows.recordset || []) {
      const regKey = normalizeFleetKey(getRow(r, 'registration'));
      const fleetKey = normalizeFleetKey(getRow(r, 'fleet_no'));
      if (regKey) {
        truckByReg.set(regKey, r);
        systemTruckKeys.add(regKey);
      }
      if (fleetKey && !truckByFleetNo.has(fleetKey)) truckByFleetNo.set(fleetKey, r);
    }

    const atomicRegKeysSeen = new Set();
    const results = [];
    let matchedOnSystem = 0;
    let integratedOnAtomic = 0;

    const maxColScan = Math.max(headersRaw.length, 60, atomicSheet.columnCount || 0);
    const dataStart = headerRow + 1;
    for (let r = dataStart; r <= atomicSheet.rowCount; r++) {
      const row = atomicSheet.getRow(r);
      let hasAnyVal = false;
      for (let c = 1; c <= maxColScan; c++) {
        if (rowText(row.getCell(c).value)) { hasAnyVal = true; break; }
      }
      if (!hasAnyVal) continue;

      const vehicleDescr = vehicleDescrCol ? rowText(row.getCell(vehicleDescrCol).value) : '';
      const registration = regCol ? rowText(row.getCell(regCol).value) : '';
      const trailer1 = trailer1Col ? rowText(row.getCell(trailer1Col).value) : '';
      const trailer2 = trailer2Col ? rowText(row.getCell(trailer2Col).value) : '';
      const contractor = parentOwnershipCol ? rowText(row.getCell(parentOwnershipCol).value) : '';
      const subContractor = ownershipCol ? rowText(row.getCell(ownershipCol).value) : '';
      const lastLocation = lastLocationCol ? atomicLastLocationFromCell(row.getCell(lastLocationCol)) : '';

      const regNorm = normalizeFleetKey(registration);
      const descrNorm = normalizeFleetKey(vehicleDescr);
      if (regNorm) atomicRegKeysSeen.add(regNorm);
      if (descrNorm && !regNorm) atomicRegKeysSeen.add(descrNorm);

      const hit = (regNorm && truckByReg.get(regNorm))
        || (descrNorm && truckByFleetNo.get(descrNorm))
        || (descrNorm && truckByReg.get(descrNorm))
        || null;
      const onSystem = !!hit;
      if (onSystem) matchedOnSystem++;

      const integratedAtomic = isIntegratedOnAtomic(lastLocation);
      if (integratedAtomic) integratedOnAtomic++;
      const atomicStatus = integratedAtomic ? 'Integrated on Atomic' : 'Not integrated on Atomic';
      const systemStatus = onSystem ? 'On our system' : 'Not on our system';

      const sysReg = onSystem ? rowText(getRow(hit, 'registration')) : '';
      const sysFleet = onSystem ? rowText(getRow(hit, 'fleet_no')) : '';
      const sysContractor = onSystem ? rowText(getRow(hit, 'contractor_name') || getRow(hit, 'main_contractor')) : '';
      const sysSub = onSystem ? rowText(getRow(hit, 'sub_contractor')) : '';
      const sysTrailer1 = onSystem ? rowText(getRow(hit, 'trailer_1_reg_no')) : '';
      const sysTrailer2 = onSystem ? rowText(getRow(hit, 'trailer_2_reg_no')) : '';

      const notes = [];
      if (!integratedAtomic) notes.push('Not integrated on Atomic — LastLocationDatetimeString is blank');
      if (!registration && !vehicleDescr) notes.push('Missing registration and vehicle description');
      else if (!onSystem) notes.push('Truck is on Atomic export but not enrolled in Thinkers');
      else {
        if (sysReg && registration && normalizeFleetKey(sysReg) !== regNorm) notes.push(`System registration ${sysReg}`);
        if (sysTrailer1 && trailer1 && normalizeFleetKey(sysTrailer1) !== normalizeFleetKey(trailer1)) {
          notes.push('Trailer 1 differs on system');
        }
        if (sysTrailer2 && trailer2 && normalizeFleetKey(sysTrailer2) !== normalizeFleetKey(trailer2)) {
          notes.push('Trailer 2 differs on system');
        }
        if (!notes.length) notes.push(onSystem ? `Matched on Thinkers${sysReg ? `: ${sysReg}` : ''}` : '');
      }

      const fleetNoOut = vehicleDescr || sysFleet;
      results.push({
        source_row: r,
        contractor: contractor || sysContractor,
        sub_contractor: subContractor || sysSub,
        fleet_no: fleetNoOut,
        registration: registration || sysReg,
        trailer_1_reg: trailer1 || sysTrailer1,
        trailer_2_reg: trailer2 || sysTrailer2,
        last_location_atomic: lastLocation,
        atomic_status: atomicStatus,
        system_status: systemStatus,
        system_contractor: sysContractor,
        system_sub_contractor: sysSub,
        system_registration: sysReg,
        system_fleet_no: sysFleet,
        notes: notes.filter(Boolean).join('; ') || (onSystem ? 'Aligned with Thinkers fleet' : ''),
      });
    }

    const onSystemOnly = [];
    for (const r of truckRows.recordset || []) {
      const regKey = normalizeFleetKey(getRow(r, 'registration'));
      if (!regKey || atomicRegKeysSeen.has(regKey)) continue;
      const fleetKey = normalizeFleetKey(getRow(r, 'fleet_no'));
      if (fleetKey && atomicRegKeysSeen.has(fleetKey)) continue;
      onSystemOnly.push({
        contractor: rowText(getRow(r, 'contractor_name') || getRow(r, 'main_contractor')),
        sub_contractor: rowText(getRow(r, 'sub_contractor')),
        fleet_no: rowText(getRow(r, 'fleet_no')),
        registration: rowText(getRow(r, 'registration')),
        trailer_1_reg: rowText(getRow(r, 'trailer_1_reg_no')),
        trailer_2_reg: rowText(getRow(r, 'trailer_2_reg_no')),
        atomic_status: 'Not on Atomic export',
        system_status: 'On our system only',
        notes: 'Enrolled in Thinkers but absent from uploaded Atomic fleet file',
      });
    }

    const sortAtomicRows = (rows) => rows.slice().sort((a, b) => {
      const c1 = String(a.contractor || '').toLowerCase();
      const c2 = String(b.contractor || '').toLowerCase();
      if (c1 !== c2) return c1.localeCompare(c2);
      const s1 = String(a.sub_contractor || '').toLowerCase();
      const s2 = String(b.sub_contractor || '').toLowerCase();
      if (s1 !== s2) return s1.localeCompare(s2);
      return String(a.registration || a.fleet_no || '').localeCompare(String(b.registration || b.fleet_no || ''), undefined, { sensitivity: 'base' });
    });

    const INTEGRATED_FILL = 'FFD8E4BC';
    const ATOMIC_ONLY_FILL = 'FFFEF3C7';
    const SYSTEM_ONLY_FILL = 'FFFEE2E2';
    const valueStyles = {
      system_status: {
        'On our system': { fill: INTEGRATED_FILL, font: { color: { argb: 'FF1F3D0A' }, bold: true } },
        'Not on our system': { fill: ATOMIC_ONLY_FILL, font: { color: { argb: 'FF92400E' }, bold: true } },
      },
      atomic_status: {
        'Integrated on Atomic': { fill: INTEGRATED_FILL, font: { color: { argb: 'FF1F3D0A' }, bold: true } },
        'Not integrated on Atomic': { fill: ATOMIC_ONLY_FILL, font: { color: { argb: 'FF92400E' }, bold: true } },
      },
    };

    const outWorkbook = new ExcelJS.Workbook();
    outWorkbook.creator = 'Thinkers';
    const generatedAt = new Date();

    const atomicHeaders = [
      'Contractor', 'Sub-contractor (ownership)', 'Fleet no / vehicle', 'Truck registration',
      'Trailer 1', 'Trailer 2', 'Last location (Atomic)', 'Atomic fleet status', 'On our system', 'Notes',
    ];
    const atomicKeys = [
      'contractor', 'sub_contractor', 'fleet_no', 'registration',
      'trailer_1_reg', 'trailer_2_reg', 'last_location_atomic', 'atomic_status', 'system_status', 'notes',
    ];
    buildStyledListSheet(outWorkbook, {
      sheetName: 'Atomic fleet (verified)',
      headers: atomicHeaders,
      keys: atomicKeys,
      rows: sortAtomicRows(results),
      info: [
        ['Tenant:', tenantLabel || '—'],
        ['Contractor filter:', hauliierLabel],
        ['Source sheet:', atomicSheet.name],
        ['Date & time:', formatDateForAppTz(generatedAt)],
        ['Rows from Atomic file:', String(results.length)],
        ['Integrated on Atomic:', String(integratedOnAtomic)],
        ['Not integrated on Atomic:', String(results.length - integratedOnAtomic)],
        ['On our system:', String(matchedOnSystem)],
        ['Not on our system:', String(results.length - matchedOnSystem)],
        ['On system only (not in file):', String(onSystemOnly.length)],
      ],
      groupBy: 'sub_contractor',
      minColumnWidth: 12,
      maxColumnWidth: 44,
      columnWidths: {
        notes: 40,
        last_location_atomic: 22,
        atomic_status: 18,
        system_status: 16,
        registration: 16,
        fleet_no: 14,
      },
      autoFilter: true,
      valueStyles,
    });

    if (onSystemOnly.length) {
      const sysHeaders = [
        'Contractor', 'Sub-contractor', 'Fleet no', 'Truck registration', 'Trailer 1', 'Trailer 2',
        'Atomic fleet status', 'On our system', 'Notes',
      ];
      const sysKeys = [
        'contractor', 'sub_contractor', 'fleet_no', 'registration', 'trailer_1_reg', 'trailer_2_reg',
        'atomic_status', 'system_status', 'notes',
      ];
      buildStyledListSheet(outWorkbook, {
        sheetName: 'On Thinkers only',
        headers: sysHeaders,
        keys: sysKeys,
        rows: sortAtomicRows(onSystemOnly),
        info: [
          ['Tenant:', tenantLabel || '—'],
          ['Contractor filter:', hauliierLabel],
          ['Date & time:', formatDateForAppTz(generatedAt)],
          ['Trucks on Thinkers not in Atomic file:', String(onSystemOnly.length)],
        ],
        groupBy: 'sub_contractor',
        minColumnWidth: 12,
        maxColumnWidth: 40,
        autoFilter: true,
        valueStyles: {
          system_status: {
            'On our system only': { fill: SYSTEM_ONLY_FILL, font: { color: { argb: 'FF991B1B' }, bold: true } },
          },
        },
      });
    }

    const outBuffer = await outWorkbook.xlsx.writeBuffer();
    const token = randomUUID();
    const inName = rowText(req.file.originalname) || 'atomic-fleet.xlsx';
    const baseName = inName.toLowerCase().endsWith('.xlsx') ? inName.replace(/\.xlsx$/i, '') : inName;
    const safeHaulier = (checkAllContractors ? 'All contractors' : hauliierLabel || 'Contractor').replace(/[^A-Za-z0-9 _-]+/g, '').trim();
    const filename = `${baseName} - Atomic fleet verification (${safeHaulier}).xlsx`;
    atomicFleetVerificationCache.set(token, {
      createdAt: Date.now(),
      filename,
      buffer: Buffer.from(outBuffer),
    });

    res.json({
      ok: true,
      token,
      download_url: `/api/command-centre/atomic-fleet-verification/download/${token}`,
      file_name: filename,
      haulier: { id: contractorId, label: hauliierLabel, check_all: checkAllContractors },
      tenant: { id: tenantId, label: tenantLabel },
      summary: {
        total_atomic_rows: results.length,
        integrated_on_atomic: integratedOnAtomic,
        not_integrated_on_atomic: results.length - integratedOnAtomic,
        on_system: matchedOnSystem,
        not_on_system: results.length - matchedOnSystem,
        on_system_only: onSystemOnly.length,
      },
      results: {
        atomic: results,
        on_system_only: onSystemOnly,
      },
      ai: {
        used: !!aiColumns,
        model: aiColumns ? getAiModel() : null,
        mapped_headers: detectedColumns,
      },
      detected: {
        sheet: atomicSheet.name,
        header_row: headerRow,
        columns: detectedColumns,
        all_sheets: (workbook.worksheets || []).map((ws) => ws.name),
        sheets: {
          atomic: atomicSheet.name,
          header_row: headerRow,
          all_sheets: (workbook.worksheets || []).map((ws) => ws.name),
        },
      },
      warnings: [
        ...(!detectedColumns.registration ? ['No registration column detected. Expected RegistrationNumber or similar.'] : []),
        ...(!detectedColumns.parent_ownership ? ['No ParentOwnership (contractor) column detected.'] : []),
        ...(!detectedColumns.ownership ? ['No Ownership (sub-contractor) column detected.'] : []),
        ...(!detectedColumns.last_location ? ['No LastLocationDatetimeString column detected. Atomic integration requires this column — blank means not integrated.'] : []),
      ],
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/atomic-fleet-verification/download/:token', async (req, res, next) => {
  try {
    pruneAtomicFleetVerificationCache();
    const token = String(req.params.token || '');
    const item = atomicFleetVerificationCache.get(token);
    if (!item) return res.status(404).json({ error: 'Verification file expired or not found' });
    if (Date.now() - item.createdAt > FLEET_VERIFICATION_CACHE_TTL_MS) {
      atomicFleetVerificationCache.delete(token);
      return res.status(410).json({ error: 'Verification file expired. Please run verification again.' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${item.filename}"`);
    res.send(item.buffer);
  } catch (err) {
    next(err);
  }
});

/** GET list for Delete contractors fleets/drivers tab. Query: tenant_id, contractor_id, sub_contractor, type=truck|driver|breakdown|all. */
router.get('/delete-fleet-drivers/list', async (req, res, next) => {
  try {
    const { tenant_id: tenantId, contractor_id: contractorId, sub_contractor: subContractor, type = 'all' } = req.query || {};
    const subContractorFilter = String(subContractor || '').trim() || null;
    let tenants = [];
    try {
      const tenantsResult = await query(
        `SELECT DISTINCT t.id, t.name FROM tenants t
         INNER JOIN (SELECT tenant_id FROM contractor_trucks UNION SELECT tenant_id FROM contractor_incidents) u ON u.tenant_id = t.id
         ORDER BY t.name`
      );
      tenants = (tenantsResult.recordset || []).map((r) => ({ id: r.id, name: r.name || '' }));
    } catch (_) {
      const trOnly = await query(
        `SELECT DISTINCT t.id, t.name FROM tenants t INNER JOIN contractor_trucks tr ON tr.tenant_id = t.id ORDER BY t.name`
      );
      tenants = (trOnly.recordset || []).map((r) => ({ id: r.id, name: r.name || '' }));
    }
    let contractors = [];
    if (tenantId) {
      const cResult = await query(
        `SELECT id, name FROM contractors WHERE tenant_id = @tenantId ORDER BY name`,
        { tenantId }
      );
      contractors = (cResult.recordset || []).map((r) => ({ id: r.id, name: r.name || '' }));
    }

    let subcontractors = [];
    if (tenantId && contractorId) {
      try {
        const subResult = await query(
          `SELECT DISTINCT LTRIM(RTRIM(sub_contractor)) AS name
           FROM contractor_trucks
           WHERE tenant_id = @tenantId AND contractor_id = @contractorId
             AND sub_contractor IS NOT NULL AND LTRIM(RTRIM(sub_contractor)) <> ''
           ORDER BY name`,
          { tenantId, contractorId }
        );
        subcontractors = (subResult.recordset || [])
          .map((r) => rowText(getRow(r, 'name')))
          .filter(Boolean);
      } catch (_) {
        subcontractors = [];
      }
    }

    const tenantFilter = tenantId ? ' AND tr.tenant_id = @tenantId' : '';
    const contractorFilter = contractorId ? ' AND tr.contractor_id = @contractorId' : '';
    const subContractorTruckFilter = subContractorFilter ? ' AND LTRIM(RTRIM(tr.sub_contractor)) = @subContractor' : '';
    const params = {};
    if (tenantId) params.tenantId = tenantId;
    if (contractorId) params.contractorId = contractorId;
    if (subContractorFilter) params.subContractor = subContractorFilter;

    let trucks = [];
    if (type === 'all' || type === 'truck') {
      const trResult = await query(
        `SELECT tr.id, tr.tenant_id, tr.contractor_id, tr.registration, tr.make_model, tr.[status],
          tr.sub_contractor, tr.created_at AS enrolled_at,
          t.name AS tenant_name, c.name AS contractor_name
         FROM contractor_trucks tr
         LEFT JOIN tenants t ON t.id = tr.tenant_id
         LEFT JOIN contractors c ON c.id = tr.contractor_id
         WHERE 1=1 ${tenantFilter} ${contractorFilter} ${subContractorTruckFilter}
         ORDER BY t.name, c.name, tr.sub_contractor, tr.registration`,
        params
      );
      trucks = (trResult.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        tenantId: getRow(r, 'tenant_id'),
        contractorId: getRow(r, 'contractor_id'),
        registration: getRow(r, 'registration'),
        makeModel: getRow(r, 'make_model'),
        status: getRow(r, 'status'),
        subContractor: getRow(r, 'sub_contractor'),
        enrolledAt: getRow(r, 'enrolled_at'),
        tenantName: getRow(r, 'tenant_name'),
        contractorName: getRow(r, 'contractor_name'),
      }));
    }

    let drivers = [];
    if (type === 'all' || type === 'driver') {
      const drFilter = tenantId ? ' AND d.tenant_id = @tenantId' : '';
      const drContractorFilter = contractorId ? ' AND d.contractor_id = @contractorId' : '';
      const subContractorDriverFilter = subContractorFilter
        ? ' AND LTRIM(RTRIM(lt.sub_contractor)) = @subContractor'
        : '';
      const drResult = await query(
        `SELECT d.id, d.tenant_id, d.contractor_id, d.full_name, d.surname, d.id_number, d.license_number,
          d.created_at AS enrolled_at, lt.sub_contractor,
          t.name AS tenant_name, c.name AS contractor_name
         FROM contractor_drivers d
         LEFT JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN contractors c ON c.id = d.contractor_id
         LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id
         WHERE 1=1 ${drFilter} ${drContractorFilter} ${subContractorDriverFilter}
         ORDER BY t.name, c.name, lt.sub_contractor, d.full_name, d.surname`,
        params
      );
      drivers = (drResult.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        tenantId: getRow(r, 'tenant_id'),
        contractorId: getRow(r, 'contractor_id'),
        fullName: getRow(r, 'full_name'),
        surname: getRow(r, 'surname'),
        idNumber: getRow(r, 'id_number'),
        licenseNumber: getRow(r, 'license_number'),
        subContractor: getRow(r, 'sub_contractor'),
        enrolledAt: getRow(r, 'enrolled_at'),
        tenantName: getRow(r, 'tenant_name'),
        contractorName: getRow(r, 'contractor_name'),
      }));
    }

    let breakdowns = [];
    if (type === 'all' || type === 'breakdown') {
      const incParams = {};
      if (tenantId) incParams.tenantId = tenantId;
      if (contractorId) incParams.contractorId = contractorId;
      try {
        const incFilter = tenantId ? ' AND i.tenant_id = @tenantId' : '';
        const incContractorFilter = contractorId ? ' AND i.contractor_id = @contractorId' : '';
        const incResult = await query(
          `SELECT i.id, i.tenant_id, i.contractor_id, i.type, i.title, i.reported_at, i.resolved_at,
            t.name AS tenant_name, c.name AS contractor_name
           FROM contractor_incidents i
           LEFT JOIN tenants t ON t.id = i.tenant_id
           LEFT JOIN contractors c ON c.id = i.contractor_id
           WHERE 1=1 ${incFilter} ${incContractorFilter}
           ORDER BY i.reported_at DESC`,
          incParams
        );
        breakdowns = (incResult.recordset || []).map((r) => ({
          id: getRow(r, 'id'),
          tenantId: getRow(r, 'tenant_id'),
          contractorId: getRow(r, 'contractor_id'),
          type: getRow(r, 'type'),
          title: getRow(r, 'title'),
          reportedAt: getRow(r, 'reported_at'),
          resolvedAt: getRow(r, 'resolved_at'),
          tenantName: getRow(r, 'tenant_name'),
          contractorName: getRow(r, 'contractor_name'),
        }));
      } catch (incErr) {
        try {
          const incFilter = tenantId ? ' AND i.tenant_id = @tenantId' : '';
          const fallbackParams = tenantId ? { tenantId } : {};
          const fallbackResult = await query(
            `SELECT i.id, i.tenant_id, i.type, i.title, i.reported_at, i.resolved_at, t.name AS tenant_name
             FROM contractor_incidents i
             LEFT JOIN tenants t ON t.id = i.tenant_id
             WHERE 1=1 ${incFilter}
             ORDER BY i.reported_at DESC`,
            fallbackParams
          );
          breakdowns = (fallbackResult.recordset || []).map((r) => ({
            id: getRow(r, 'id'),
            tenantId: getRow(r, 'tenant_id'),
            contractorId: null,
            type: getRow(r, 'type'),
            title: getRow(r, 'title'),
            reportedAt: getRow(r, 'reported_at'),
            resolvedAt: getRow(r, 'resolved_at'),
            tenantName: getRow(r, 'tenant_name'),
            contractorName: null,
          }));
        } catch (fallbackErr) {
          throw incErr;
        }
      }
    }

    res.json({ trucks, drivers, breakdowns, tenants, contractors, subcontractors });
  } catch (err) {
    next(err);
  }
});

/** DELETE a truck (contractor fleet). Removes from contractor_trucks and related data. Any status. */
router.delete('/delete-fleet-drivers/truck/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const truckCheck = await query(`SELECT id, tenant_id FROM contractor_trucks WHERE id = @id`, { id });
    if (!truckCheck.recordset?.length) return res.status(404).json({ error: 'Truck not found' });
    await query(`UPDATE contractor_drivers SET linked_truck_id = NULL WHERE linked_truck_id = @id`, { id });
    await query(`DELETE FROM contractor_route_trucks WHERE truck_id = @id`, { id });
    await query(`DELETE FROM cc_fleet_applications WHERE entity_type = N'truck' AND entity_id = @id`, { id });
    await query(`UPDATE contractor_incidents SET truck_id = NULL WHERE truck_id = @id`, { id });
    await query(`DELETE FROM contractor_trucks WHERE id = @id`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE a driver. Removes from contractor_drivers and related data. Any status. */
router.delete('/delete-fleet-drivers/driver/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const driverCheck = await query(`SELECT id, tenant_id FROM contractor_drivers WHERE id = @id`, { id });
    if (!driverCheck.recordset?.length) return res.status(404).json({ error: 'Driver not found' });
    await query(`UPDATE contractor_incidents SET driver_id = NULL WHERE driver_id = @id`, { id });
    await query(`DELETE FROM contractor_route_drivers WHERE driver_id = @id`, { id });
    await query(`DELETE FROM cc_fleet_applications WHERE entity_type = N'driver' AND entity_id = @id`, { id });
    await query(`DELETE FROM contractor_drivers WHERE id = @id`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE a reported breakdown (incident). Permanently removes from contractor_incidents. */
router.delete('/delete-fleet-drivers/breakdown/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const check = await query(`SELECT id, tenant_id FROM contractor_incidents WHERE id = @id`, { id });
    if (!check.recordset?.length) return res.status(404).json({ error: 'Breakdown not found' });
    await query(`DELETE FROM contractor_incidents WHERE id = @id`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET all contractors with full details (info + subcontractors) for Command Centre */
function toCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

router.get('/contractors-details', async (req, res, next) => {
  try {
    let tenantIds = [];
    try {
      const tr = await query(`SELECT DISTINCT tenant_id FROM contractor_trucks`);
      tenantIds = (tr.recordset || []).map((r) => r.tenant_id).filter(Boolean);
    } catch (_) { /* table may not exist */ }
    try {
      const ci = await query(`SELECT DISTINCT tenant_id FROM contractor_info`);
      const fromInfo = (ci.recordset || []).map((r) => r.tenant_id).filter(Boolean);
      tenantIds = [...new Set([...tenantIds, ...fromInfo])];
    } catch (_) { /* table may not exist */ }
    if (tenantIds.length === 0) {
      return res.json({ contractors: [] });
    }
    const tenantsResult = await query(
      `SELECT id, name FROM tenants WHERE id IN (${tenantIds.map((_, i) => `@id${i}`).join(',')})`,
      Object.fromEntries(tenantIds.map((id, i) => [`id${i}`, id]))
    );
    const tenantNames = {};
    for (const r of tenantsResult.recordset || []) {
      tenantNames[r.id] = r.name || '';
    }
    let infoByTenant = {};
    try {
      const infoResult = await query(
        `SELECT * FROM contractor_info WHERE tenant_id IN (${tenantIds.map((_, i) => `@id${i}`).join(',')})`,
        Object.fromEntries(tenantIds.map((id, i) => [`id${i}`, id]))
      );
      for (const r of infoResult.recordset || []) {
        infoByTenant[r.tenant_id] = toCamel(r);
      }
    } catch (_) { /* table may not exist */ }
    let subsByTenant = {};
    try {
      const subResult = await query(
        `SELECT * FROM contractor_subcontractors WHERE tenant_id IN (${tenantIds.map((_, i) => `@id${i}`).join(',')}) ORDER BY [order_index] ASC, company_name ASC`,
        Object.fromEntries(tenantIds.map((id, i) => [`id${i}`, id]))
      );
      for (const r of subResult.recordset || []) {
        if (!subsByTenant[r.tenant_id]) subsByTenant[r.tenant_id] = [];
        subsByTenant[r.tenant_id].push(r);
      }
    } catch (_) { /* table may not exist */ }
    const contractors = tenantIds.map((tid) => ({
      tenantId: tid,
      tenantName: tenantNames[tid] || '',
      info: infoByTenant[tid] || null,
      subcontractors: subsByTenant[tid] || [],
    }));
    res.json({ contractors });
  } catch (err) {
    next(err);
  }
});

// --- Reported breakdowns (all incidents; CC can view, resolve, download PDF) ---
function normIncident(row) {
  if (!row) return null;
  const get = (r, ...keys) => {
    for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
    const l = (keys[0] || '').toString().toLowerCase().replace(/_/g, '');
    for (const [key, val] of Object.entries(r)) if (key && key.toLowerCase().replace(/_/g, '') === l && val != null) return val;
    return null;
  };
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    truck_id: get(row, 'truck_id'),
    driver_id: get(row, 'driver_id'),
    route_id: get(row, 'route_id'),
    type: get(row, 'type'),
    title: get(row, 'title'),
    description: get(row, 'description'),
    severity: get(row, 'severity'),
    actions_taken: get(row, 'actions_taken'),
    reported_at: get(row, 'reported_at'),
    resolved_at: get(row, 'resolved_at'),
    resolution_note: get(row, 'resolution_note', 'resolutionNote'),
    location: get(row, 'location'),
    loading_slip_path: get(row, 'loading_slip_path'),
    seal_1_path: get(row, 'seal_1_path'),
    seal_2_path: get(row, 'seal_2_path'),
    picture_problem_path: get(row, 'picture_problem_path'),
    offloading_slip_path: get(row, 'offloading_slip_path'),
    created_at: get(row, 'created_at'),
    tenant_name: get(row, 'tenant_name'),
    truck_registration: get(row, 'truck_registration'),
    driver_name: get(row, 'driver_name'),
    route_name: get(row, 'route_name'),
    driver_email: get(row, 'driver_email'),
    rector_manual_notified_at: get(row, 'rector_manual_notified_at'),
    rector_was_notified: row ? (() => {
      const manual = get(row, 'rector_manual_notified_at');
      if (manual != null) return true;
      const routeId = get(row, 'route_id');
      if (!routeId) return false;
      const count = row.route_rector_count;
      return typeof count === 'number' && count > 0;
    })() : false,
  };
}

/** GET distinct tenants that have breakdowns (for filter dropdown) */
router.get('/breakdowns/tenants', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT t.id, t.name FROM contractor_incidents i
       INNER JOIN tenants t ON t.id = i.tenant_id
       ORDER BY t.name`
    );
    const tenants = (result.recordset || []).map((r) => ({ id: r.id, name: r.name || '' }));
    res.json({ tenants });
  } catch (err) {
    next(err);
  }
});

/** GET list all reported breakdowns (incidents) for Command Centre. Query: resolved, dateFrom, dateTo, type, severity, tenantId */
router.get('/breakdowns', async (req, res, next) => {
  try {
    const { resolved, dateFrom, dateTo, type, severity, tenantId } = req.query || {};
    let sql = `
      SELECT i.id, i.tenant_id, i.truck_id, i.driver_id, i.route_id, i.type, i.title, i.description, i.severity,
             i.actions_taken, i.reported_at, i.resolved_at, i.resolution_note, i.location, i.created_at,
             i.loading_slip_path, i.seal_1_path, i.seal_2_path, i.picture_problem_path, i.offloading_slip_path,
             t.name AS tenant_name,
             tr.registration AS truck_registration,
             r.name AS route_name,
             LTRIM(RTRIM(ISNULL(d.full_name, '') + ' ' + ISNULL(d.surname, ''))) AS driver_name,
             d.email AS driver_email
      FROM contractor_incidents i
      LEFT JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
      LEFT JOIN contractor_routes r ON r.id = i.route_id
      LEFT JOIN contractor_drivers d ON d.id = i.driver_id
      WHERE 1=1`;
    const params = {};
    if (resolved === '1' || resolved === 'true') { sql += ` AND i.resolved_at IS NOT NULL`; }
    else if (resolved === '0' || resolved === 'false') { sql += ` AND i.resolved_at IS NULL`; }
    if (dateFrom) { sql += ` AND i.reported_at >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND i.reported_at <= @dateTo`; params.dateTo = dateTo; }
    if (type && String(type).trim()) { sql += ` AND LOWER(REPLACE(LTRIM(RTRIM(CAST(i.[type] AS NVARCHAR(100)))), ' ', '_')) = LOWER(REPLACE(LTRIM(RTRIM(@type)), ' ', '_'))`; params.type = String(type).trim(); }
    if (severity && String(severity).trim()) { sql += ` AND LOWER(LTRIM(RTRIM(CAST(i.severity AS NVARCHAR(50))))) = LOWER(LTRIM(RTRIM(@severity)))`; params.severity = String(severity).trim(); }
    if (tenantId && String(tenantId).trim()) { sql += ` AND i.tenant_id = @tenantId`; params.tenantId = String(tenantId).trim(); }
    sql += ` ORDER BY i.reported_at DESC`;
    const result = await query(sql, params);
    const breakdowns = (result.recordset || []).map(normIncident).filter(Boolean);
    res.json({ breakdowns });
  } catch (err) {
    next(err);
  }
});

/** GET one breakdown (full detail for view / PDF). Includes rector_was_notified so CC can show "Notify rector" when rector was not notified. */
router.get('/breakdowns/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT i.*, t.name AS tenant_name, tr.registration AS truck_registration, r.name AS route_name,
              d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email,
              (SELECT COUNT(*) FROM access_route_factors f WHERE f.route_id = i.route_id AND f.user_id IS NOT NULL) AS route_rector_count
       FROM contractor_incidents i
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
       LEFT JOIN contractor_routes r ON r.id = i.route_id
       LEFT JOIN contractor_drivers d ON d.id = i.driver_id
       WHERE i.id = @id`,
      { id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Breakdown not found' });
    const incident = normIncident(row);
    if (row.driver_name || row.driver_surname) {
      incident.driver_name = [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || null;
    }
    res.json({ breakdown: incident });
  } catch (err) {
    next(err);
  }
});

/** PATCH resolve breakdown: set resolution_note, resolved_at; notify rector, driver, contractor */
router.patch('/breakdowns/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const resolutionNote = (req.body?.resolution_note ?? req.body?.resolutionNote ?? '').toString().trim();
    if (!resolutionNote) return res.status(400).json({ error: 'Resolution note is required.' });
    const updateResult = await query(
      `UPDATE contractor_incidents SET resolved_at = SYSUTCDATETIME(), resolution_note = @resolution_note
       OUTPUT INSERTED.id, INSERTED.tenant_id, INSERTED.title, INSERTED.resolution_note, INSERTED.resolved_at
       WHERE id = @id`,
      { id, resolution_note: resolutionNote }
    );
    const updated = updateResult.recordset?.[0];
    if (!updated) return res.status(404).json({ error: 'Breakdown not found' });
    const detailResult = await query(
      `SELECT i.id, i.route_id, i.truck_id, i.driver_id, i.tenant_id, i.contractor_id, i.title, i.resolution_note, i.resolved_at, t.name AS tenant_name,
              tr.registration AS truck_registration, r.name AS route_name,
              d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email,
              c.name AS contractor_name
       FROM contractor_incidents i
       LEFT JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
       LEFT JOIN contractor_routes r ON r.id = i.route_id
       LEFT JOIN contractor_drivers d ON d.id = i.driver_id
       LEFT JOIN contractors c ON c.id = i.contractor_id
       WHERE i.id = @id`,
      { id }
    );
    const row = detailResult.recordset?.[0];
    const driverName = row ? [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || 'Driver' : 'Driver';
    const resolvedAtStr = row?.resolved_at ? formatDateForEmail(row.resolved_at) : formatDateForEmail(new Date());
    const contractorName = row?.contractor_name ?? row?.contractor_Name ?? null;
    let incidentContractorId = row?.contractor_id ?? row?.contractor_Id ?? null;
    if (!incidentContractorId && row?.truck_id) {
      const tr = await query(`SELECT contractor_id FROM contractor_trucks WHERE id = @truckId`, { truckId: row.truck_id });
      const t0 = tr.recordset?.[0];
      incidentContractorId = t0?.contractor_id ?? t0?.contractor_Id ?? null;
    }
    let routeId = row?.route_id ?? row?.route_Id ?? null;
    if (!routeId && (row?.truck_id || row?.driver_id)) {
      if (row.truck_id) {
        const trRoutes = await query(`SELECT TOP 1 route_id FROM contractor_route_trucks WHERE truck_id = @truckId`, { truckId: row.truck_id });
        const r0 = trRoutes.recordset?.[0];
        routeId = r0?.route_id ?? r0?.route_Id ?? null;
      }
      if (!routeId && row.driver_id) {
        const drRoutes = await query(`SELECT TOP 1 route_id FROM contractor_route_drivers WHERE driver_id = @driverId`, { driverId: row.driver_id });
        const r0 = drRoutes.recordset?.[0];
        routeId = r0?.route_id ?? r0?.route_Id ?? null;
      }
    }
    (async () => {
      try {
        if (!isEmailConfigured() || !sendEmail || !getCommandCentreAndRectorEmailsForRoute) return;
        const ccRectorEmails = await getCommandCentreAndRectorEmailsForRoute(query, routeId);
        const driverEmail = (row?.driver_email || '').trim();
        const tenantId = row?.tenant_id || updated.tenant_id;
        const contractorEmails = tenantId && incidentContractorId ? await getContractorUserEmails(query, tenantId, incidentContractorId) : [];
        const allTo = [...new Set([...ccRectorEmails, ...(driverEmail ? [driverEmail] : []), ...contractorEmails])];
        const mask = (e) => (e && e.includes('@') ? e.slice(0, 2) + '***@' + e.split('@')[1] : e);
        console.log('[commandCentre] Breakdown resolved: CC/Rector=', ccRectorEmails.length, 'driver=', !!driverEmail, 'contractor=', contractorEmails.length, 'total=', allTo.length);
        if (allTo.length === 0) return;
        const html = breakdownResolvedHtml({
          ref: `INC-${String(updated.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          title: row?.title || updated.title,
          driverName,
          truckRegistration: row?.truck_registration || '—',
          routeName: row?.route_name || '—',
          resolutionNote: row?.resolution_note || resolutionNote,
          resolvedAt: resolvedAtStr,
          contractorName: contractorName || null,
        });
        const subject = `Breakdown resolved: ${row?.title || 'Incident'} – ${driverName}`;
        for (const to of allTo) {
          try {
            await sendEmail({ to, subject, body: html, html: true });
            console.log('[commandCentre] Breakdown resolved notification sent to', mask(to));
          } catch (sendErr) {
            console.error('[commandCentre] Failed to send resolved notification to', mask(to), sendErr?.message || sendErr);
          }
        }
      } catch (e) {
        console.error('[commandCentre] Breakdown resolved email error:', e?.message || e);
      }
    })();
    res.json({ breakdown: { id: updated.id, resolved_at: updated.resolved_at, resolution_note: updated.resolution_note } });
  } catch (err) {
    next(err);
  }
});

/** POST notify selected rector(s) about a breakdown (when rector was not notified at report time). Sends same breakdown email. Body: { rector_user_ids: [uuid, ...] }. */
router.post('/breakdowns/:id/notify-rector', async (req, res, next) => {
  try {
    const { id } = req.params;
    const rectorIds = Array.isArray(req.body?.rector_user_ids) ? req.body.rector_user_ids.filter((uid) => uid) : [];
    if (rectorIds.length === 0) return res.status(400).json({ error: 'At least one rector must be selected (rector_user_ids).' });
    const detailResult = await query(
      `SELECT i.id, i.route_id, i.type, i.title, i.description, i.severity, i.actions_taken, i.reported_at, i.location,
              tr.registration AS truck_reg, r.name AS route_name,
              d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email,
              c.name AS contractor_name, tn.name AS tenant_name
       FROM contractor_incidents i
       LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
       LEFT JOIN contractor_routes r ON r.id = i.route_id
       LEFT JOIN contractor_drivers d ON d.id = i.driver_id
       LEFT JOIN contractors c ON c.id = i.contractor_id
       LEFT JOIN tenants tn ON tn.id = i.tenant_id
       WHERE i.id = @id`,
      { id }
    );
    const row = detailResult.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Breakdown not found' });
    const placeholders = rectorIds.map((_, i) => `@uid${i}`).join(',');
    const params = rectorIds.reduce((o, uid, i) => ({ ...o, [`uid${i}`]: uid }), {});
    const userRows = await query(
      `SELECT id, email FROM users WHERE id IN (${placeholders}) AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`,
      params
    );
    const toEmails = (userRows.recordset || []).map((r) => (r.email || r.Email || '').trim()).filter((e) => e && e.includes('@'));
    if (toEmails.length === 0) return res.status(400).json({ error: 'No valid rector emails found for the selected users.' });
    const driverName = row ? [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || 'Driver' : 'Driver';
    const reportedAtStr = row?.reported_at ? formatDateForEmail(row.reported_at) : formatDateForEmail(new Date());
    const html = breakdownReportHtml({
      driverName,
      truckRegistration: row?.truck_reg || '—',
      routeName: row?.route_name || '—',
      reportedAt: reportedAtStr,
      location: row?.location || '—',
      type: row?.type || 'breakdown',
      title: row?.title || 'Breakdown',
      description: row?.description || '',
      severity: row?.severity || '',
      actionsTaken: row?.actions_taken || '',
      incidentId: id,
      contractorName: row?.contractor_name ?? row?.contractor_Name ?? null,
      tenantName: row?.tenant_name ?? row?.tenant_name ?? null,
    });
    const subject = `Breakdown reported: ${row?.title || 'Breakdown'} – ${driverName}`;
    if (isEmailConfigured() && sendEmail) {
      for (const to of toEmails) {
        try {
          await sendEmail({ to, subject, body: html, html: true });
        } catch (sendErr) {
          console.error('[commandCentre] notify-rector failed to send to', to, sendErr?.message || sendErr);
        }
      }
    }
    await query(
      `UPDATE contractor_incidents SET rector_manual_notified_at = SYSUTCDATETIME() WHERE id = @id`,
      { id }
    );
    const updated = await query(`SELECT id, rector_manual_notified_at FROM contractor_incidents WHERE id = @id`, { id });
    const updatedRow = updated.recordset?.[0];
    res.json({
      ok: true,
      rector_manual_notified_at: updatedRow?.rector_manual_notified_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

const BREAKDOWN_ATTACHMENT_TYPES = ['loading_slip', 'seal_1', 'seal_2', 'picture_problem', 'offloading_slip'];
const BREAKDOWN_ATTACHMENT_COL = { loading_slip: 'loading_slip_path', seal_1: 'seal_1_path', seal_2: 'seal_2_path', picture_problem: 'picture_problem_path', offloading_slip: 'offloading_slip_path' };

function getBreakdownAttachmentPath(row, type) {
  if (!row || !BREAKDOWN_ATTACHMENT_COL[type]) return null;
  const col = BREAKDOWN_ATTACHMENT_COL[type];
  let val = row[col];
  if (val != null && val !== '') return val;
  const colLower = col.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k && k.toLowerCase() === colLower && v != null && v !== '') return v;
  }
  return null;
}

/** GET breakdown attachment file (view in browser / PDF generation). Works for open and resolved breakdowns. */
router.get('/breakdowns/:id/attachments/:type', async (req, res, next) => {
  try {
    const { id, type } = req.params;
    if (!BREAKDOWN_ATTACHMENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid attachment type' });
    const result = await query(
      `SELECT tenant_id, loading_slip_path, seal_1_path, seal_2_path, picture_problem_path, offloading_slip_path FROM contractor_incidents WHERE id = @id`,
      { id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const filePath = getBreakdownAttachmentPath(row, type);
    if (!filePath || typeof filePath !== 'string') return res.status(404).json({ error: 'Attachment not found' });
    const relativePath = String(filePath).replace(/^[/\\]+/, '').replace(/\\/g, path.sep);
    const fullPath = path.join(process.cwd(), 'uploads', relativePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on server', code: 'FILE_NOT_ON_SERVER' });
    res.sendFile(fullPath, { headers: { 'Content-Disposition': 'inline' } });
  } catch (err) {
    next(err);
  }
});

/** GET one fleet application with full truck or driver details */
router.get('/fleet-applications/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const appResult = await query(
      `SELECT a.*, t.name AS tenant_name,
        COALESCE(c.name, t.name) AS contractor_name,
        CASE
          WHEN a.entity_type = N'truck' THEN
            COALESCE(sc_tr.company_name, NULLIF(LTRIM(RTRIM(tr.sub_contractor)), N''))
          ELSE
            COALESCE(sc_d.company_name, sc_lt.company_name, NULLIF(LTRIM(RTRIM(lt.sub_contractor)), N''))
        END AS subcontractor_display
       FROM cc_fleet_applications a
       JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = a.entity_id AND a.entity_type = N'truck'
       LEFT JOIN contractor_drivers d ON d.id = a.entity_id AND a.entity_type = N'driver'
       LEFT JOIN contractors c ON c.id = COALESCE(tr.contractor_id, d.contractor_id)
       LEFT JOIN contractor_subcontractors sc_tr ON sc_tr.id = tr.subcontractor_id AND sc_tr.tenant_id = a.tenant_id
       LEFT JOIN contractor_subcontractors sc_d ON sc_d.id = d.subcontractor_id AND sc_d.tenant_id = a.tenant_id
       LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id AND lt.tenant_id = d.tenant_id AND a.entity_type = N'driver'
       LEFT JOIN contractor_subcontractors sc_lt ON sc_lt.id = lt.subcontractor_id AND sc_lt.tenant_id = a.tenant_id
       WHERE a.id = @id`,
      { id }
    );
    const app = appResult.recordset?.[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const entityType = getRow(app, 'entity_type');
    const entityId = getRow(app, 'entity_id');
    let entity = null;
    if (entityType === 'truck') {
      const tr = await query(`SELECT * FROM contractor_trucks WHERE id = @entityId`, { entityId });
      entity = tr.recordset?.[0] || null;
    } else if (entityType === 'driver') {
      const dr = await query(`SELECT * FROM contractor_drivers WHERE id = @entityId`, { entityId });
      entity = dr.recordset?.[0] || null;
    }
    const application = {
      id: getRow(app, 'id'),
      tenantId: getRow(app, 'tenant_id'),
      contractorName: getRow(app, 'contractor_name'),
      subcontractorDisplay: getRow(app, 'subcontractor_display'),
      entityType,
      entityId,
      source: getRow(app, 'source'),
      status: getRow(app, 'status'),
      reviewedByUserId: getRow(app, 'reviewed_by_user_id'),
      reviewedAt: getRow(app, 'reviewed_at'),
      declineReason: getRow(app, 'decline_reason'),
      createdAt: getRow(app, 'created_at'),
      entity,
    };
    res.json({ application });
  } catch (err) {
    next(err);
  }
});

/** GET fleet application comments */
router.get('/fleet-applications/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params;
    const appCheck = await query(`SELECT id FROM cc_fleet_applications WHERE id = @id`, { id });
    if (!appCheck.recordset?.[0]) return res.status(404).json({ error: 'Application not found' });
    const result = await query(
      `SELECT c.id, c.fleet_application_id, c.user_id, c.body, c.created_at, u.full_name AS author_name
       FROM cc_fleet_application_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.fleet_application_id = @id
       ORDER BY c.created_at ASC`,
      { id }
    );
    const comments = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      fleet_application_id: getRow(r, 'fleet_application_id'),
      user_id: getRow(r, 'user_id'),
      body: getRow(r, 'body'),
      created_at: getRow(r, 'created_at'),
      author_name: getRow(r, 'author_name'),
    }));
    res.json({ comments });
  } catch (err) {
    if (err.message?.includes('cc_fleet_application_comments')) return res.json({ comments: [], migrationRequired: true });
    next(err);
  }
});

/** POST fleet application comment */
router.post('/fleet-applications/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body?.body != null ? String(req.body.body).trim() : '';
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    const appCheck = await query(`SELECT id FROM cc_fleet_applications WHERE id = @id`, { id });
    if (!appCheck.recordset?.[0]) return res.status(404).json({ error: 'Application not found' });
    const result = await query(
      `INSERT INTO cc_fleet_application_comments (fleet_application_id, user_id, body)
       OUTPUT INSERTED.id, INSERTED.fleet_application_id, INSERTED.user_id, INSERTED.body, INSERTED.created_at
       VALUES (@id, @userId, @body)`,
      { id, userId: req.user.id, body }
    );
    const row = result.recordset?.[0];
    const authorResult = row ? await query(`SELECT full_name FROM users WHERE id = @userId`, { userId: req.user.id }) : null;
    const authorName = authorResult?.recordset?.[0] ? getRow(authorResult.recordset[0], 'full_name') : null;
    res.status(201).json({
      comment: row ? {
        id: getRow(row, 'id'),
        fleet_application_id: getRow(row, 'fleet_application_id'),
        user_id: getRow(row, 'user_id'),
        body: getRow(row, 'body'),
        created_at: getRow(row, 'created_at'),
        author_name: authorName,
      } : null,
    });
  } catch (err) {
    if (err.message?.includes('cc_fleet_application_comments')) return res.status(503).json({ error: 'Comments not set up. Run: node scripts/run-fleet-application-comments.js' });
    next(err);
  }
});

/** PATCH approve: grant facility access. Body: optional { notify_rectors: true, rector_user_ids: [uuid,...] } – only those rectors get an email (no automatic rector notification). */
router.patch('/fleet-applications/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notify_rectors, rector_user_ids } = req.body || {};
    const appResult = await query(`SELECT id, entity_type, entity_id, [status] FROM cc_fleet_applications WHERE id = @id`, { id });
    const app = appResult.recordset?.[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (getRow(app, 'status') !== 'pending') return res.status(400).json({ error: 'Application is not pending' });
    const entityType = getRow(app, 'entity_type');
    const entityId = getRow(app, 'entity_id');
    const table = entityType === 'truck' ? 'contractor_trucks' : 'contractor_drivers';
    await query(
      `UPDATE cc_fleet_applications SET [status] = N'approved', reviewed_by_user_id = @userId, reviewed_at = SYSUTCDATETIME(), decline_reason = NULL WHERE id = @id`,
      { id, userId: req.user.id }
    );
    await query(
      `UPDATE ${table} SET facility_access = 1, last_decline_reason = NULL WHERE id = @entityId`,
      { entityId }
    );
    const updated = await query(
      `SELECT a.*, t.name AS tenant_name FROM cc_fleet_applications a JOIN tenants t ON t.id = a.tenant_id WHERE a.id = @id`,
      { id }
    );
    const row = updated.recordset?.[0];
    const tenantId = getRow(row, 'tenant_id');
    const tenantName = getRow(row, 'tenant_name');
    let entityLabel = entityType === 'truck' ? 'Truck' : 'Driver';
    let contractorName = null;
    if (entityType === 'truck') {
      const tr = await query(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @entityId`, { entityId });
      const trRow = tr.recordset?.[0];
      entityLabel = trRow?.registration || entityLabel;
      if (trRow?.contractor_id) {
        const cn = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid: trRow.contractor_id });
        contractorName = cn.recordset?.[0]?.name ?? null;
      }
    } else {
      const dr = await query(`SELECT full_name, surname, contractor_id FROM contractor_drivers WHERE id = @entityId`, { entityId });
      const d = dr.recordset?.[0];
      entityLabel = [d?.full_name, d?.surname].filter(Boolean).join(' ').trim() || entityLabel;
      if (d?.contractor_id) {
        const cn = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid: d.contractor_id });
        contractorName = cn.recordset?.[0]?.name ?? null;
      }
    }

    (async () => {
      try {
        if (!sendEmail || !tenantId) return;
        const contractorId = entityType === 'truck' ? (await query(`SELECT contractor_id FROM contractor_trucks WHERE id = @entityId`, { entityId })).recordset?.[0]?.contractor_id : (await query(`SELECT contractor_id FROM contractor_drivers WHERE id = @entityId`, { entityId })).recordset?.[0]?.contractor_id;
        const toEmails = contractorId ? await getContractorOnlyUserEmails(query, tenantId, contractorId) : [];
        if (toEmails.length > 0) {
          const html = applicationApprovedHtml({ entityType, entityLabel, tenantName, contractorName });
          await sendEmail({ to: toEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} approved – you can now enroll on the route`, body: html, html: true });
        }
        const rectorIds = Array.isArray(rector_user_ids) && notify_rectors ? rector_user_ids.filter((uid) => uid) : [];
        if (rectorIds.length > 0) {
          const placeholders = rectorIds.map((_, i) => `@uid${i}`).join(',');
          const params = rectorIds.reduce((o, uid, i) => ({ ...o, [`uid${i}`]: uid }), {});
          const rectorRows = await query(`SELECT email FROM users WHERE id IN (${placeholders}) AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`, params);
          const rectorEmails = (rectorRows.recordset || []).map((r) => (r.email || r.Email || '').trim()).filter((e) => e && e.includes('@'));
          if (rectorEmails.length > 0) {
            const html = applicationApprovedToRectorHtml({ entityType, entityLabel, tenantName, contractorName });
            await sendEmail({ to: rectorEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} approved (for your awareness): ${entityLabel} – ${tenantName}`, body: html, html: true });
          }
        }
      } catch (e) {
        console.error('[commandCentre] Approval email error:', e?.message || e);
      }
    })();

    res.json({
      application: {
        id: getRow(row, 'id'),
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        contractorName: contractorName || tenantName,
        entityType,
        entityId,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST bulk-approve: approve multiple fleet applications in one request; send one email listing all with contractor names. Body: { ids }, optional { notify_rectors: true, rector_user_ids: [uuid,...] } – only those rectors get one email (no automatic rector notification). */
router.post('/fleet-applications/bulk-approve', async (req, res, next) => {
  try {
    const { ids, notify_rectors, rector_user_ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const approved = [];
    const items = [];
    const recipientScopes = []; // { tenantId, contractorId } per approved item for contractor-scoped emails
    for (const id of ids) {
      const appResult = await query(`SELECT id, entity_type, entity_id, tenant_id, [status] FROM cc_fleet_applications WHERE id = @id`, { id });
      const app = appResult.recordset?.[0];
      if (!app || getRow(app, 'status') !== 'pending') continue;
      const entityType = getRow(app, 'entity_type');
      const entityId = getRow(app, 'entity_id');
      const table = entityType === 'truck' ? 'contractor_trucks' : 'contractor_drivers';
      await query(
        `UPDATE cc_fleet_applications SET [status] = N'approved', reviewed_by_user_id = @userId, reviewed_at = SYSUTCDATETIME(), decline_reason = NULL WHERE id = @id`,
        { id, userId: req.user.id }
      );
      await query(`UPDATE ${table} SET facility_access = 1, last_decline_reason = NULL WHERE id = @entityId`, { entityId });
      let entityLabel = entityType === 'truck' ? 'Truck' : 'Driver';
      let contractorName = null;
      let contractorId = null;
      if (entityType === 'truck') {
        const tr = await query(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @entityId`, { entityId });
        const trRow = tr.recordset?.[0];
        entityLabel = trRow?.registration || entityLabel;
        contractorId = trRow?.contractor_id ?? trRow?.contractor_Id ?? null;
        if (contractorId) {
          const cn = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid: contractorId });
          contractorName = cn.recordset?.[0]?.name ?? null;
        }
      } else {
        const dr = await query(`SELECT full_name, surname, contractor_id FROM contractor_drivers WHERE id = @entityId`, { entityId });
        const d = dr.recordset?.[0];
        entityLabel = [d?.full_name, d?.surname].filter(Boolean).join(' ').trim() || entityLabel;
        contractorId = d?.contractor_id ?? d?.contractor_Id ?? null;
        if (contractorId) {
          const cn = await query(`SELECT name FROM contractors WHERE id = @cid`, { cid: contractorId });
          contractorName = cn.recordset?.[0]?.name ?? null;
        }
      }
      approved.push({ id, entityType, entityId });
      items.push({ entityType, entityLabel, contractorName });
      const tid = getRow(app, 'tenant_id');
      if (tid) recipientScopes.push({ tenantId: tid, contractorId });
    }
    if (approved.length > 0 && sendEmail) {
      try {
        const allEmails = new Set();
        const seen = new Set();
        for (const { tenantId: tid, contractorId: cid } of recipientScopes) {
          const key = `${tid}:${cid || 'none'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = cid ? await getContractorOnlyUserEmails(query, tid, cid) : [];
          list.forEach((e) => allEmails.add(e));
        }
        if (allEmails.size > 0) {
          const html = applicationBulkApprovedHtml({ items });
          await sendEmail({
            to: [...allEmails],
            subject: `Applications approved (${approved.length}) – you can now enroll on the route`,
            body: html,
            html: true,
          });
        }
        const rectorIds = Array.isArray(rector_user_ids) && notify_rectors ? rector_user_ids.filter((uid) => uid) : [];
        if (rectorIds.length > 0) {
          const placeholders = rectorIds.map((_, i) => `@ruid${i}`).join(',');
          const params = rectorIds.reduce((o, uid, i) => ({ ...o, [`ruid${i}`]: uid }), {});
          const rectorRows = await query(`SELECT email FROM users WHERE id IN (${placeholders}) AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`, params);
          const rectorEmails = (rectorRows.recordset || []).map((r) => (r.email || r.Email || '').trim()).filter((e) => e && e.includes('@'));
          if (rectorEmails.length > 0) {
            const html = applicationBulkApprovedToRectorHtml({ items });
            await sendEmail({
              to: rectorEmails,
              subject: `Applications approved (${approved.length}) (for your awareness)`,
              body: html,
              html: true,
            });
          }
        }
      } catch (e) {
        console.error('[commandCentre] Bulk approval email error:', e?.message || e);
      }
    }
    res.json({ approved: approved.length, applications: approved });
  } catch (err) {
    next(err);
  }
});

/** PATCH decline: require decline_reason in body, store and set on entity */
router.patch('/fleet-applications/:id/decline', async (req, res, next) => {
  try {
    const { id } = req.params;
    const declineReason = req.body?.decline_reason != null ? String(req.body.decline_reason).trim() : '';
    if (!declineReason) return res.status(400).json({ error: 'A reason for declining is required' });
    const appResult = await query(`SELECT id, entity_type, entity_id, [status] FROM cc_fleet_applications WHERE id = @id`, { id });
    const app = appResult.recordset?.[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (getRow(app, 'status') !== 'pending') return res.status(400).json({ error: 'Application is not pending' });
    const entityType = getRow(app, 'entity_type');
    const entityId = getRow(app, 'entity_id');
    const table = entityType === 'truck' ? 'contractor_trucks' : 'contractor_drivers';
    await query(
      `UPDATE cc_fleet_applications SET [status] = N'declined', reviewed_by_user_id = @userId, reviewed_at = SYSUTCDATETIME(), decline_reason = @declineReason WHERE id = @id`,
      { id, userId: req.user.id, declineReason }
    );
    await query(
      `UPDATE ${table} SET last_decline_reason = @declineReason WHERE id = @entityId`,
      { entityId, declineReason }
    );
    const updated = await query(
      `SELECT a.*, t.name AS tenant_name, COALESCE(c.name, t.name) AS contractor_name
       FROM cc_fleet_applications a
       JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = a.entity_id AND a.entity_type = N'truck'
       LEFT JOIN contractor_drivers d ON d.id = a.entity_id AND a.entity_type = N'driver'
       LEFT JOIN contractors c ON c.id = COALESCE(tr.contractor_id, d.contractor_id)
       WHERE a.id = @id`,
      { id }
    );
    const row = updated.recordset?.[0];
    res.json({
      application: {
        id: getRow(row, 'id'),
        status: 'declined',
        declineReason,
        reviewedAt: new Date().toISOString(),
        contractorName: getRow(row, 'contractor_name'),
        entityType,
        entityId,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- Shift reports ---
const SHIFT_REPORT_STATUSES = ['draft', 'pending_approval', 'provisional', 'approved', 'rejected'];

const SHIFT_REPORT_SCALAR_KEYS = [
  'id', 'created_by_user_id', 'ref_number', 'route', 'report_date', 'shift_date', 'shift_start', 'shift_end',
  'controller1_name', 'controller1_email', 'controller2_name', 'controller2_email',
  'total_trucks_scheduled', 'balance_brought_down', 'total_loads_dispatched', 'total_pending_deliveries', 'total_loads_delivered',
  'overall_performance', 'key_highlights', 'outstanding_issues', 'handover_key_info', 'declaration', 'shift_conclusion_time',
  'status', 'submitted_at', 'submitted_to_user_id', 'approved_by_user_id', 'approved_at', 'created_at', 'updated_at'
];
function rowToShiftReport(r) {
  if (!r) return null;
  const jsonFields = ['truck_updates', 'incidents', 'non_compliance_calls', 'investigations', 'communication_log'];
  const out = {};
  const lowerKeys = Object.keys(r).reduce((acc, k) => { acc[k.toLowerCase()] = k; return acc; }, {});
  for (const key of SHIFT_REPORT_SCALAR_KEYS) {
    const rawKey = lowerKeys[key] || key;
    if (r[rawKey] !== undefined) out[key] = r[rawKey];
  }
  for (const key of ['created_by_name', 'created_by_email', 'submitted_to_name', 'submitted_to_email', 'approved_by_name']) {
    const rawKey = lowerKeys[key] || key;
    if (r[rawKey] !== undefined) out[key] = r[rawKey];
  }
  for (const f of jsonFields) {
    const rawKey = lowerKeys[f] || f;
    let val = r[rawKey];
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch (_) { val = []; }
    }
    out[f] = Array.isArray(val) ? val : [];
  }
  return out;
}

/** GET users who can approve (have at least one CC tab grant) - for submit dropdown */
router.get('/approvers', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM command_centre_grants g
       JOIN users u ON u.id = g.user_id
       WHERE u.id != @userId
       ORDER BY u.full_name`,
      { userId: req.user.id }
    );
    res.json({ users: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET shift reports: full list for all Command Centre users (same scope as breakdowns). Query ?requests=1 = assigned to me for approval. ?decidedByMe=1 = reports you approved/rejected (override flow). */
router.get('/shift-reports', async (req, res, next) => {
  try {
    const isSuperAdmin = req.user?.role === 'super_admin';
    const requestsOnly = req.query.requests === '1';
    const decidedByMe = req.query.decidedByMe === '1';
    let sql = `
      SELECT r.*,
        creator.full_name AS created_by_name, creator.email AS created_by_email,
        approver.full_name AS submitted_to_name, approver.email AS submitted_to_email,
        approvedBy.full_name AS approved_by_name
      FROM command_centre_shift_reports r
      LEFT JOIN users creator ON creator.id = r.created_by_user_id
      LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
      LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
      WHERE 1=1`;
    const params = {};
    if (decidedByMe) {
      if (!isSuperAdmin) sql += ` AND r.submitted_to_user_id = @userId AND r.status IN ('approved', 'rejected')`;
      else sql += ` AND r.status IN ('approved', 'rejected')`;
      if (!isSuperAdmin) params.userId = req.user.id;
      sql += ` ORDER BY r.updated_at DESC`;
      const result = await query(sql, params);
      const list = (result.recordset || []).slice(0, 20).map(rowToShiftReport);
      return res.json({ reports: list });
    }
    if (requestsOnly) {
      if (!isSuperAdmin) sql += ` AND r.submitted_to_user_id = @userId AND r.status IN ('pending_approval', 'provisional')`;
      else sql += ` AND r.status IN ('pending_approval', 'provisional')`;
      if (!isSuperAdmin) params.userId = req.user.id;
    }
    sql += ` ORDER BY r.updated_at DESC`;
    const result = await query(sql, params);
    const list = (result.recordset || []).map(rowToShiftReport);
    res.json({ reports: list });
  } catch (err) {
    next(err);
  }
});

/** GET shift items: shift reports per route for the past 1–30 days. For "Shift by route" tab. */
router.get('/shift-items', async (req, res, next) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (Number.isNaN(days) || days < 1) days = 7;
    if (days > 30) days = 30;
    const routeFilter = (req.query.route || '').toString().trim();

    const dateToStr = todayYmd();
    const dateFromStr = addCalendarDays(dateToStr, -days);

    let sql = `
      SELECT r.*,
        creator.full_name AS created_by_name, creator.email AS created_by_email,
        approver.full_name AS submitted_to_name, approver.email AS submitted_to_email,
        approvedBy.full_name AS approved_by_name
      FROM command_centre_shift_reports r
      LEFT JOIN users creator ON creator.id = r.created_by_user_id
      LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
      LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
      WHERE 1=1
        AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) >= @dateFrom
        AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) <= @dateTo`;
    const params = { dateFrom: dateFromStr, dateTo: dateToStr };
    if (routeFilter) {
      sql += ` AND LOWER(LTRIM(RTRIM(ISNULL(r.route, N'')))) = LOWER(LTRIM(RTRIM(@routeFilter)))`;
      params.routeFilter = routeFilter;
    }
    sql += ` ORDER BY r.report_date DESC, r.shift_date DESC, r.created_at DESC`;
    const result = await query(sql, params);
    const reports = (result.recordset || []).map(rowToShiftReport);

    const byRoute = {};
    const byDate = {};
    for (const r of reports) {
      const routeName = (r.route || 'Unspecified').trim() || 'Unspecified';
      const dateKey = (r.report_date || r.shift_date || r.created_at || '').toString().slice(0, 10);
      if (!byRoute[routeName]) byRoute[routeName] = [];
      byRoute[routeName].push(r);
      if (dateKey) {
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(r);
      }
    }
    const routeList = Object.entries(byRoute).map(([route, items]) => ({ route, reports: items, report_count: items.length }));
    routeList.sort((a, b) => b.report_count - a.report_count);
    const dateList = Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => ({ date, reports: items, report_count: items.length }));

    res.json({
      reports,
      byRoute: routeList,
      byDate: dateList,
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      days,
      summary: {
        report_count: reports.length,
        route_count: routeList.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

const SHIFT_EXPORT_SECTIONS = ['incidents_non_compliance', 'investigations', 'truck_updates', 'communication_log', 'report_summary', 'handover', 'all'];

/** GET shift report export: flattened data for selected section(s) for Excel. */
router.get('/shift-report-export', async (req, res, next) => {
  try {
    const section = (req.query.section || '').toString().trim().toLowerCase();
    if (!SHIFT_EXPORT_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section must be one of: ${SHIFT_EXPORT_SECTIONS.join(', ')}` });
    }
    const dateFrom = (req.query.dateFrom || '').toString().trim();
    const dateTo = (req.query.dateTo || '').toString().trim();
    const routeFilter = (req.query.route || '').toString().trim();

    let sql = `
      SELECT r.*
      FROM command_centre_shift_reports r
      WHERE 1=1`;
    const params = {};
    if (dateFrom) { sql += ` AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) <= @dateTo`; params.dateTo = dateTo; }
    if (routeFilter) { sql += ` AND LOWER(LTRIM(RTRIM(ISNULL(r.route, N'')))) = LOWER(LTRIM(RTRIM(@routeFilter)))`; params.routeFilter = routeFilter; }
    sql += ` ORDER BY r.report_date DESC, r.shift_date DESC, r.created_at DESC`;
    const result = await query(sql, params);
    const reports = (result.recordset || []).map(rowToShiftReport);

    const reportDateStr = (r) => ((r.report_date || r.shift_date || r.created_at) ? toYmdFromDbOrString(r.report_date || r.shift_date || r.created_at) : '');
    const routeStr = (r) => (r.route || '').trim() || '—';
    const statusStr = (r) => r.status || '—';
    const str = (v) => (v != null && v !== '') ? String(v).trim() : '—';

    const out = { section, dateFrom: dateFrom || null, dateTo: dateTo || null, route: routeFilter || null, exports: {} };
    const doAll = section === 'all';

    if (doAll || section === 'report_summary') {
      const headers = ['Report date', 'Route', 'Status', 'Shift start', 'Shift end', 'Controller 1', 'Controller 2', 'Total trucks scheduled', 'Balance brought down', 'Total loads dispatched', 'Total pending', 'Total loads delivered', 'Overall performance', 'Key highlights', 'Shift conclusion time'];
      const rows = reports.map((r) => [
        reportDateStr(r),
        routeStr(r),
        statusStr(r),
        str(r.shift_start),
        str(r.shift_end),
        str(r.controller1_name),
        str(r.controller2_name),
        str(r.total_trucks_scheduled),
        str(r.balance_brought_down),
        str(r.total_loads_dispatched),
        str(r.total_pending_deliveries),
        str(r.total_loads_delivered),
        str(r.overall_performance),
        str(r.key_highlights),
        str(r.shift_conclusion_time),
      ]);
      out.exports.report_summary = { sheetName: 'Report summary', headers, rows };
    }

    if (doAll || section === 'truck_updates') {
      const headers = ['Report date', 'Route', 'Report status', 'Time', 'Summary', 'Delays'];
      const rows = [];
      for (const r of reports) {
        const updates = Array.isArray(r.truck_updates) ? r.truck_updates : [];
        for (const u of updates) {
          if (!u || (u.time == null && u.summary == null && u.delays == null)) continue;
          rows.push([
            reportDateStr(r),
            routeStr(r),
            statusStr(r),
            str(u.time),
            str(u.summary),
            str(u.delays),
          ]);
        }
      }
      out.exports.truck_updates = { sheetName: 'Truck updates', headers, rows };
    }

    if (doAll || section === 'incidents_non_compliance') {
      const incidentHeaders = ['Report date', 'Route', 'Report status', 'Truck reg', 'Time reported', 'Driver name', 'Issue', 'Status'];
      const incidentRows = [];
      const ncHeaders = ['Report date', 'Route', 'Report status', 'Driver name', 'Truck reg', 'Rule violated', 'Time of call', 'Summary', 'Driver response'];
      const ncRows = [];
      for (const r of reports) {
        const rDate = reportDateStr(r);
        const route = routeStr(r);
        const status = statusStr(r);
        const incidents = Array.isArray(r.incidents) ? r.incidents : [];
        for (const i of incidents) {
          if (!i || (i.truck_reg == null && i.driver_name == null && i.issue == null)) continue;
          incidentRows.push([
            rDate,
            route,
            status,
            (i.truck_reg || '').toString().trim() || '—',
            (i.time_reported || '').toString().trim() || '—',
            (i.driver_name || '').toString().trim() || '—',
            (i.issue || '').toString().trim() || '—',
            (i.status || '').toString().trim() || '—',
          ]);
        }
        const nonComp = Array.isArray(r.non_compliance_calls) ? r.non_compliance_calls : [];
        for (const n of nonComp) {
          if (!n || (n.driver_name == null && n.truck_reg == null && n.rule_violated == null)) continue;
          ncRows.push([
            rDate,
            route,
            status,
            (n.driver_name || '').toString().trim() || '—',
            (n.truck_reg || '').toString().trim() || '—',
            (n.rule_violated || '').toString().trim() || '—',
            (n.time_of_call || '').toString().trim() || '—',
            (n.summary || '').toString().trim() || '—',
            (n.driver_response || '').toString().trim() || '—',
          ]);
        }
      }
      out.exports.incidents = { sheetName: 'Incidents', headers: incidentHeaders, rows: incidentRows };
      out.exports.non_compliance = { sheetName: 'Non-compliance', headers: ncHeaders, rows: ncRows };
    }

    if (doAll || section === 'investigations') {
      const invHeaders = ['Report date', 'Route', 'Report status', 'Truck reg', 'Time', 'Location', 'Issue identified', 'Findings', 'Action taken'];
      const invRows = [];
      for (const r of reports) {
        const rDate = reportDateStr(r);
        const route = routeStr(r);
        const status = statusStr(r);
        const invs = Array.isArray(r.investigations) ? r.investigations : [];
        for (const inv of invs) {
          if (!inv || (inv.truck_reg == null && inv.issue_identified == null && inv.findings == null)) continue;
          invRows.push([
            rDate,
            route,
            status,
            (inv.truck_reg || '').toString().trim() || '—',
            (inv.time || '').toString().trim() || '—',
            (inv.location || '').toString().trim() || '—',
            (inv.issue_identified || '').toString().trim() || '—',
            (inv.findings || '').toString().trim() || '—',
            (inv.action_taken || '').toString().trim() || '—',
          ]);
        }
      }
      out.exports.investigations = { sheetName: 'Investigations', headers: invHeaders, rows: invRows };
    }

    if (doAll || section === 'communication_log') {
      const headers = ['Report date', 'Route', 'Report status', 'Time', 'Recipient', 'Subject', 'Method', 'Action required'];
      const rows = [];
      for (const r of reports) {
        const comms = Array.isArray(r.communication_log) ? r.communication_log : [];
        for (const c of comms) {
          if (!c || (c.recipient == null && c.subject == null)) continue;
          rows.push([
            reportDateStr(r),
            routeStr(r),
            statusStr(r),
            str(c.time),
            str(c.recipient),
            str(c.subject),
            str(c.method),
            str(c.action_required),
          ]);
        }
      }
      out.exports.communication_log = { sheetName: 'Communication log', headers, rows };
    }

    if (doAll || section === 'handover') {
      const headers = ['Report date', 'Route', 'Report status', 'Outstanding issues', 'Handover key info'];
      const rows = reports.map((r) => [
        reportDateStr(r),
        routeStr(r),
        statusStr(r),
        str(r.outstanding_issues),
        str(r.handover_key_info),
      ]);
      out.exports.handover = { sheetName: 'Handover', headers, rows };
    }

    res.json(out);
  } catch (err) {
    next(err);
  }
});

/** GET trends: aggregated shift report data for analytics & insights. Uses approved reports only. */
router.get('/trends', async (req, res, next) => {
  try {
    const dateFrom = (req.query.dateFrom || '').toString().trim();
    const dateTo = (req.query.dateTo || '').toString().trim();
    const routeFilter = (req.query.route || '').toString().trim();
    let sql = `
      SELECT r.*
      FROM command_centre_shift_reports r
      WHERE r.status = N'approved'`;
    const params = {};
    if (dateFrom) { sql += ` AND (r.report_date >= @dateFrom OR r.shift_date >= @dateFrom)`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND (r.report_date <= @dateTo OR r.shift_date <= @dateTo)`; params.dateTo = dateTo; }
    if (routeFilter) { sql += ` AND LOWER(LTRIM(RTRIM(ISNULL(r.route, N'')))) = LOWER(LTRIM(RTRIM(@routeFilter)))`; params.routeFilter = routeFilter; }
    sql += ` ORDER BY r.report_date ASC, r.shift_date ASC, r.created_at ASC`;
    const result = await query(sql, params);
    const reports = (result.recordset || []).map(rowToShiftReport);

    const toNum = (v) => {
      if (v == null || v === '') return null;
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''), 10);
      return Number.isNaN(n) ? null : n;
    };

    const timeSeriesMap = {};
    const routeMap = {};
    let totalLoadsDispatched = 0;
    let totalLoadsDelivered = 0;
    let totalPending = 0;
    let totalIncidents = 0;
    let totalNonCompliance = 0;

    for (const r of reports) {
      const dateKey = (r.report_date || r.shift_date || r.created_at || '').toString().slice(0, 10);
      if (!dateKey) continue;
      const routeName = (r.route || 'Unspecified').trim() || 'Unspecified';
      const dispatched = toNum(r.total_loads_dispatched);
      const delivered = toNum(r.total_loads_delivered);
      const pending = toNum(r.total_pending_deliveries);
      const incidents = Array.isArray(r.incidents) ? r.incidents.length : 0;
      const nonCompliance = Array.isArray(r.non_compliance_calls) ? r.non_compliance_calls.length : 0;

      if (!timeSeriesMap[dateKey]) {
        timeSeriesMap[dateKey] = { date: dateKey, report_count: 0, loads_dispatched: 0, loads_delivered: 0, pending_deliveries: 0, incidents: 0, non_compliance: 0 };
      }
      timeSeriesMap[dateKey].report_count += 1;
      timeSeriesMap[dateKey].loads_dispatched += (dispatched || 0);
      timeSeriesMap[dateKey].loads_delivered += (delivered || 0);
      timeSeriesMap[dateKey].pending_deliveries += (pending || 0);
      timeSeriesMap[dateKey].incidents += incidents;
      timeSeriesMap[dateKey].non_compliance += nonCompliance;

      if (!routeMap[routeName]) {
        routeMap[routeName] = { route: routeName, report_count: 0, loads_dispatched: 0, loads_delivered: 0, incidents: 0 };
      }
      routeMap[routeName].report_count += 1;
      routeMap[routeName].loads_dispatched += (dispatched || 0);
      routeMap[routeName].loads_delivered += (delivered || 0);
      routeMap[routeName].incidents += incidents;

      totalLoadsDispatched += (dispatched || 0);
      totalLoadsDelivered += (delivered || 0);
      totalPending += (pending || 0);
      totalIncidents += incidents;
      totalNonCompliance += nonCompliance;
    }

    const timeSeries = Object.keys(timeSeriesMap).sort().map((k) => timeSeriesMap[k]);
    const byRoute = Object.values(routeMap).sort((a, b) => (b.report_count - a.report_count));

    const insights = [];
    const n = reports.length;
    const avgDelivered = n ? totalLoadsDelivered / n : 0;
    const avgIncidents = n ? totalIncidents / n : 0;
    if (timeSeries.length >= 2) {
      const recent = timeSeries.slice(-Math.min(7, Math.floor(timeSeries.length / 2)));
      const older = timeSeries.slice(0, Math.max(0, timeSeries.length - recent.length));
      const recentDelivered = recent.reduce((s, d) => s + (d.loads_delivered || 0), 0);
      const olderDelivered = older.reduce((s, d) => s + (d.loads_delivered || 0), 0);
      if (olderDelivered > 0) {
        const pct = Math.round(((recentDelivered - olderDelivered) / olderDelivered) * 100);
        if (pct > 5) insights.push({ type: 'positive', text: `Loads delivered in the recent period are ${pct}% higher than the earlier period.` });
        else if (pct < -5) insights.push({ type: 'attention', text: `Loads delivered in the recent period are ${Math.abs(pct)}% lower than the earlier period.` });
      }
    }
    if (byRoute.length > 0) {
      const top = byRoute[0];
      insights.push({ type: 'info', text: `Most reported route: "${top.route}" with ${top.report_count} shift report(s) and ${top.loads_delivered || 0} loads delivered.` });
    }
    if (totalIncidents > 0 && n > 0) {
      insights.push({ type: 'attention', text: `Across ${n} shift report(s), ${totalIncidents} incident(s) were logged (avg ${avgIncidents.toFixed(1)} per report).` });
    }
    if (totalNonCompliance > 0) {
      insights.push({ type: 'attention', text: `${totalNonCompliance} non-compliance call(s) recorded in the selected period.` });
    }
    if (avgDelivered > 0) {
      insights.push({ type: 'info', text: `Average loads delivered per shift report: ${avgDelivered.toFixed(1)}.` });
    }
    if (timeSeries.length > 0) {
      const maxDay = timeSeries.reduce((a, b) => ((b.loads_delivered || 0) > (a.loads_delivered || 0) ? b : a), timeSeries[0]);
      insights.push({ type: 'info', text: `Peak delivery day in range: ${maxDay.date} with ${maxDay.loads_delivered || 0} loads delivered.` });
    }

    res.json({
      timeSeries,
      byRoute,
      summary: {
        report_count: n,
        total_loads_dispatched: totalLoadsDispatched,
        total_loads_delivered: totalLoadsDelivered,
        total_pending_deliveries: totalPending,
        total_incidents: totalIncidents,
        total_non_compliance: totalNonCompliance,
        avg_loads_delivered_per_report: n ? Math.round((totalLoadsDelivered / n) * 10) / 10 : 0,
      },
      insights,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * AI sometimes returns overview/prediction as objects or array items as objects.
 * Coerce to strings so the client never prints raw JSON in Data presentation.
 */
function normalizeDataPresentationNarrative(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const narrativeToText = (val) => {
    if (val == null) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(narrativeToText).filter(Boolean).join(' ');
    if (typeof val === 'object') {
      if (val.trend_analysis != null || val.projected_weekly_loads != null) {
        const bits = [];
        if (val.projected_weekly_loads != null) bits.push(`Projected weekly loads: ${val.projected_weekly_loads}.`);
        if (val.trend_analysis != null) bits.push(String(val.trend_analysis));
        return bits.join(' ');
      }
      if (val.total_loads_delivered != null && val.approved_reports != null) {
        const parts = [
          `${val.approved_reports} approved reports`,
          `${val.total_loads_delivered} delivered loads`,
        ];
        if (val.avg_daily_deliveries != null) parts.push(`avg daily ${val.avg_daily_deliveries}`);
        if (val.contractors_covered != null) parts.push(`${val.contractors_covered} contractors`);
        if (val.trucks_covered != null) parts.push(`${val.trucks_covered} trucks`);
        if (val.drivers_covered != null) parts.push(`${val.drivers_covered} drivers`);
        return `${parts.join(', ')}.`;
      }
      if (typeof val.summary === 'string') return val.summary;
      if (typeof val.text === 'string') return val.text;
    }
    return '';
  };

  const out = { ...raw };
  if (out.overview != null && typeof out.overview !== 'string') {
    const t = narrativeToText(out.overview);
    out.overview = t || JSON.stringify(out.overview);
  }
  if (out.prediction != null && typeof out.prediction !== 'string') {
    const t = narrativeToText(out.prediction);
    out.prediction = t || JSON.stringify(out.prediction);
  }
  for (const key of ['operations_findings', 'contractor_findings', 'driver_truck_findings', 'recommendations']) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((item) => {
      if (item == null) return '';
      if (typeof item === 'string') return item;
      const t = narrativeToText(item);
      return t || (typeof item === 'object' ? JSON.stringify(item) : String(item));
    });
  }
  return out;
}

/** GET data-presentation/shift-analysis: single-ops performance view for live presentations. */
router.get('/data-presentation/shift-analysis', async (req, res, next) => {
  try {
    const inputDateFrom = (req.query.dateFrom || '').toString().trim();
    const inputDateTo = (req.query.dateTo || '').toString().trim();
    const contractorId = (req.query.contractorId || '').toString().trim();
    const shiftType = (req.query.shiftType || 'all').toString().trim().toLowerCase();
    const tenantId = req.user?.tenant_id ?? null;
    const dateTo = inputDateTo || todayYmd();
    const dateFrom = inputDateFrom || addCalendarDays(dateTo, -29);

    let sql = `
      SELECT
        r.id AS report_id,
        r.routes_json,
        r.report_date,
        r.shift_date,
        r.shift_start,
        r.approved_at,
        r.created_at,
        r.total_loads_delivered,
        r.total_loads_dispatched,
        r.total_pending_deliveries,
        td.truck_registration,
        td.driver_name,
        td.completed_deliveries,
        rt.route_name,
        rt.total_loads_delivered AS route_loads_delivered,
        c.id AS contractor_id,
        c.name AS contractor_name
      FROM command_centre_single_ops_shift_reports r
      LEFT JOIN users creator ON creator.id = r.created_by_user_id
      LEFT JOIN command_centre_single_ops_truck_deliveries td ON td.report_id = r.id
      LEFT JOIN command_centre_single_ops_route_load_totals rt ON rt.report_id = r.id
      LEFT JOIN contractor_trucks ct
        ON UPPER(LTRIM(RTRIM(ISNULL(ct.registration, N'')))) = UPPER(LTRIM(RTRIM(ISNULL(td.truck_registration, N''))))
        AND (@tenantId IS NULL OR ct.tenant_id = @tenantId)
      LEFT JOIN contractors c ON c.id = ct.contractor_id
      WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
        AND (@tenantId IS NULL OR creator.tenant_id = @tenantId)`;
    const params = { tenantId };
    sql += ` AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= @dateFrom`;
    sql += ` AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) <= @dateTo`;
    params.dateFrom = dateFrom;
    params.dateTo = dateTo;
    if (contractorId) {
      sql += ` AND c.id = @contractorId`;
      params.contractorId = contractorId;
    }
    if (shiftType === 'day') {
      sql += ` AND TRY_CONVERT(time, r.shift_start) >= '06:00' AND TRY_CONVERT(time, r.shift_start) < '18:00'`;
    } else if (shiftType === 'night') {
      sql += ` AND (TRY_CONVERT(time, r.shift_start) >= '18:00' OR TRY_CONVERT(time, r.shift_start) < '06:00')`;
    }
    sql += ` ORDER BY COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) ASC`;

    const result = await query(sql, params);
    const rows = result.recordset || [];

    const toNum = (v) => {
      const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    const reportsSet = new Set();
    /** Dedupe truck rows: SQL joins truck_deliveries × route_totals creates a cross-product — never sum `delivered` per raw row. */
    const truckDeliveryMap = new Map();
    const routeDeliveryMap = new Map();
    const reportHeaderDelivered = {};
    const reportDayById = {};
    const reportShiftById = {};
    const parsedRoutesTotalByReport = {};
    const inferShiftBucket = (rawShiftStart) => {
      const text = String(rawShiftStart || '').trim();
      if (!text) return 'unknown';
      const hh = parseInt(text.slice(0, 2), 10);
      if (!Number.isFinite(hh)) return 'unknown';
      return hh >= 6 && hh < 18 ? 'day' : 'night';
    };
    const parseRoutesJsonDelivered = (rawValue) => {
      if (!rawValue) return 0;
      try {
        const payload = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        const toDelivered = (item) => Math.max(
          toNum(item?.total_loads_delivered),
          toNum(item?.loads_delivered),
          toNum(item?.delivered),
          toNum(item?.completed_deliveries),
          0
        );
        if (Array.isArray(payload)) {
          return payload.reduce((sum, item) => sum + toDelivered(item), 0);
        }
        if (payload && typeof payload === 'object') {
          if (Array.isArray(payload.routes)) {
            return payload.routes.reduce((sum, item) => sum + toDelivered(item), 0);
          }
          return toDelivered(payload);
        }
      } catch (_) {
        return 0;
      }
      return 0;
    };

    rows.forEach((row, rowIdx) => {
      const reportId = getRow(row, 'report_id');
      const reportKey = reportId ? String(reportId) : `row-${rowIdx}`;
      if (reportId) reportsSet.add(String(reportId));

      const contractorName = String(getRow(row, 'contractor_name') || 'Unmapped contractor').trim() || 'Unmapped contractor';
      const contractorId = getRow(row, 'contractor_id') || null;
      const truck = String(getRow(row, 'truck_registration') || '').trim();
      const driver = String(getRow(row, 'driver_name') || '').trim();
      const completed = toNum(getRow(row, 'completed_deliveries'));
      const routeLoads = toNum(getRow(row, 'route_loads_delivered'));
      const routeName = String(getRow(row, 'route_name') || '').trim();
      const reportDeliveredFromMain = Math.max(
        toNum(getRow(row, 'total_loads_delivered')),
        toNum(getRow(row, 'total_loads_dispatched')) - toNum(getRow(row, 'total_pending_deliveries')),
        0
      );
      const day = toYmdFromDbOrString(
        getRow(row, 'approved_at')
        || getRow(row, 'report_date')
        || getRow(row, 'shift_date')
        || getRow(row, 'created_at')
      ) || '';
      const shiftStart = getRow(row, 'shift_start');

      if (!Object.prototype.hasOwnProperty.call(parsedRoutesTotalByReport, reportKey)) {
        parsedRoutesTotalByReport[reportKey] = parseRoutesJsonDelivered(getRow(row, 'routes_json'));
      }
      reportHeaderDelivered[reportKey] = Math.max(Number(reportHeaderDelivered[reportKey] || 0), reportDeliveredFromMain);

      if (day && !reportDayById[reportKey]) reportDayById[reportKey] = day;
      if (!reportShiftById[reportKey]) reportShiftById[reportKey] = inferShiftBucket(shiftStart);

      if (truck && reportId) {
        const tk = `${String(reportId)}|${truck.toUpperCase()}`;
        const prev = truckDeliveryMap.get(tk);
        const nextCompleted = Math.max(prev?.completed_deliveries || 0, completed);
        truckDeliveryMap.set(tk, {
          report_id: String(reportId),
          truck_registration: truck,
          completed_deliveries: nextCompleted,
          driver_name: (nextCompleted > (prev?.completed_deliveries || 0) ? driver : prev?.driver_name) || driver || prev?.driver_name || '',
          contractor_id: contractorId ?? prev?.contractor_id ?? null,
          contractor_name: contractorName || prev?.contractor_name || 'Unmapped contractor',
          day,
          shift_start: shiftStart,
        });
      }

      if (routeName && reportId) {
        const rk = `${String(reportId)}|${routeName.toLowerCase()}`;
        const prev = routeDeliveryMap.get(rk);
        routeDeliveryMap.set(rk, {
          report_id: String(reportId),
          route_name: routeName,
          loads: Math.max(prev?.loads || 0, routeLoads),
          day: day || prev?.day || '',
        });
      }
    });

    const sumTrucksForReport = (rid) => {
      let s = 0;
      for (const v of truckDeliveryMap.values()) {
        if (v.report_id === String(rid)) s += v.completed_deliveries;
      }
      return s;
    };
    const sumRoutesForReport = (rid) => {
      let s = 0;
      for (const v of routeDeliveryMap.values()) {
        if (v.report_id === String(rid)) s += v.loads;
      }
      return s;
    };

    const reportDailyDelivered = {};
    reportsSet.forEach((rid) => {
      const truckSum = sumTrucksForReport(rid);
      const routeSum = sumRoutesForReport(rid);
      const header = reportHeaderDelivered[rid] || 0;
      const pj = parsedRoutesTotalByReport[rid] || 0;
      reportDailyDelivered[rid] = truckSum > 0 ? truckSum : Math.max(header, pj, routeSum);
    });

    const contractors = {};
    const contractorReportSets = {};
    const trucks = {};
    const drivers = {};
    for (const tv of truckDeliveryMap.values()) {
      const contractorKey = String(tv.contractor_id || tv.contractor_name || 'Unmapped contractor');
      if (!contractors[contractorKey]) {
        contractors[contractorKey] = {
          contractor_id: tv.contractor_id,
          contractor_name: tv.contractor_name || 'Unmapped contractor',
          loads_delivered: 0,
          trucks: new Set(),
          drivers: new Set(),
        };
        contractorReportSets[contractorKey] = new Set();
      }
      contractors[contractorKey].loads_delivered += tv.completed_deliveries;
      contractorReportSets[contractorKey].add(tv.report_id);
      if (tv.truck_registration) contractors[contractorKey].trucks.add(tv.truck_registration);
      if (tv.driver_name) contractors[contractorKey].drivers.add(tv.driver_name);
      const tr = tv.truck_registration;
      if (tr) trucks[tr] = (trucks[tr] || 0) + tv.completed_deliveries;
      const dr = tv.driver_name;
      if (dr) drivers[dr] = (drivers[dr] || 0) + tv.completed_deliveries;
    }

    const routePerf = {};
    for (const rv of routeDeliveryMap.values()) {
      const rn = rv.route_name;
      if (!routePerf[rn]) {
        routePerf[rn] = { route_name: rn, loads_delivered: 0, trucks: new Set(), samples: 0, _reportIds: new Set() };
      }
      routePerf[rn].loads_delivered += rv.loads;
      routePerf[rn].samples += 1;
      routePerf[rn]._reportIds.add(rv.report_id);
    }
    for (const rn of Object.keys(routePerf)) {
      const rSet = routePerf[rn]._reportIds;
      for (const tv of truckDeliveryMap.values()) {
        if (rSet.has(tv.report_id) && tv.truck_registration) routePerf[rn].trucks.add(tv.truck_registration);
      }
      delete routePerf[rn]._reportIds;
    }

    const daily = {};
    const dailyShift = {};
    Object.keys(reportDailyDelivered).forEach((reportKey) => {
      const day = reportDayById[reportKey];
      if (!day) return;
      const delivered = Number(reportDailyDelivered[reportKey] || 0);
      const shiftBucket = reportShiftById[reportKey] || 'unknown';
      daily[day] = (daily[day] || 0) + delivered;
      if (!dailyShift[day]) dailyShift[day] = { day_delivered: 0, night_delivered: 0, total_delivered: 0 };
      if (shiftBucket === 'day') dailyShift[day].day_delivered += delivered;
      else if (shiftBucket === 'night') dailyShift[day].night_delivered += delivered;
      dailyShift[day].total_delivered += delivered;
    });

    const contractorPerformance = Object.keys(contractors)
      .map((k) => ({
        contractor_id: contractors[k].contractor_id,
        contractor_name: contractors[k].contractor_name,
        loads_delivered: Math.round(contractors[k].loads_delivered * 10) / 10,
        report_rows: contractorReportSets[k]?.size || 0,
        trucks_involved: contractors[k].trucks.size,
        drivers_involved: contractors[k].drivers.size,
      }))
      .sort((a, b) => b.loads_delivered - a.loads_delivered);

    const topTrucks = Object.entries(trucks)
      .map(([truck_registration, loads_delivered]) => ({ truck_registration, loads_delivered: Math.round(loads_delivered * 10) / 10 }))
      .sort((a, b) => b.loads_delivered - a.loads_delivered)
      .slice(0, 10);
    const topDrivers = Object.entries(drivers)
      .map(([driver_name, loads_delivered]) => ({ driver_name, loads_delivered: Math.round(loads_delivered * 10) / 10 }))
      .sort((a, b) => b.loads_delivered - a.loads_delivered)
      .slice(0, 10);

    const rangeDays = [];
    let cursor = dateFrom;
    while (cursor <= dateTo) {
      rangeDays.push(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    const dailySeries = rangeDays.map((date) => ({ date, delivered: Math.round((daily[date] || 0) * 10) / 10 }));
    const dailyShiftSeries = rangeDays.map((date) => {
      const row = dailyShift[date] || { day_delivered: 0, night_delivered: 0, total_delivered: 0 };
      return {
        date,
        day_delivered: Math.round((row.day_delivered || 0) * 10) / 10,
        night_delivered: Math.round((row.night_delivered || 0) * 10) / 10,
        total_delivered: Math.round((row.total_delivered || 0) * 10) / 10,
      };
    });
    const avgDaily = dailySeries.length ? dailySeries.reduce((s, d) => s + d.delivered, 0) / dailySeries.length : 0;
    const recent = dailySeries.slice(-Math.min(7, dailySeries.length));
    const prior = dailySeries.slice(Math.max(0, dailySeries.length - 14), Math.max(0, dailySeries.length - 7));
    const recentAvg = recent.length ? recent.reduce((s, d) => s + d.delivered, 0) / recent.length : 0;
    const priorAvg = prior.length ? prior.reduce((s, d) => s + d.delivered, 0) / prior.length : recentAvg;
    const projectedWeeklyLoads = Math.max(0, Math.round(recentAvg * 7 * 10) / 10);
    const trendPct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0;

    const summary = {
      approved_reports: reportsSet.size,
      total_loads_delivered: Math.round(dailySeries.reduce((s, d) => s + d.delivered, 0) * 10) / 10,
      avg_daily_deliveries: Math.round(avgDaily * 10) / 10,
      contractors_covered: contractorPerformance.length,
      trucks_covered: Object.keys(trucks).length,
      drivers_covered: Object.keys(drivers).length,
    };

    let targetRegRows = [];
    try {
      const targetResult = await query(
        `SELECT t.route_id, r.name AS route_name, t.deliveries_per_truck_target
         FROM access_route_target_regulations t
         INNER JOIN contractor_routes r ON r.id = t.route_id AND r.tenant_id = t.tenant_id
         WHERE t.tenant_id = @tenantId`,
        { tenantId }
      );
      targetRegRows = targetResult.recordset || [];
    } catch (_) {
      targetRegRows = [];
    }
    const targetByRouteName = Object.fromEntries(
      targetRegRows.map((r) => [String(getRow(r, 'route_name') || '').trim().toLowerCase(), toNum(getRow(r, 'deliveries_per_truck_target'))]).filter(([k]) => k)
    );
    const routePerformance = Object.values(routePerf)
      .map((r) => {
        const trucksCount = Math.max(1, r.trucks.size);
        const deliveriesPerTruck = r.loads_delivered / trucksCount;
        const target = targetByRouteName[String(r.route_name || '').toLowerCase()];
        const achieved = target > 0 ? deliveriesPerTruck >= target : null;
        return {
          route_name: r.route_name,
          loads_delivered: Math.round(r.loads_delivered * 10) / 10,
          trucks_involved: r.trucks.size,
          deliveries_per_truck: Math.round(deliveriesPerTruck * 100) / 100,
          deliveries_per_truck_target: target || null,
          target_achieved: achieved,
          target_gap: target > 0 ? Math.round((deliveriesPerTruck - target) * 100) / 100 : null,
        };
      })
      .sort((a, b) => (b.loads_delivered - a.loads_delivered));
    const missedTargets = routePerformance.filter((r) => r.target_achieved === false);
    const targetMissReason =
      missedTargets.length > 0
        ? `Target not achieved mainly due to lower deliveries per truck on ${missedTargets.length} route(s). Typical gaps are ${missedTargets.slice(0, 3).map((r) => `${r.route_name} (${Math.abs(r.target_gap)} below target)`).join(', ')}.`
        : (routePerformance.some((r) => r.target_achieved === true)
            ? 'Configured route targets are currently being met on the measured routes.'
            : 'No route target regulations are configured yet; set per-route targets in Rector -> Targets regulations per route.');

    let aiForecastDaily = [];
    if (dailySeries.length > 0) {
      if (isAiConfigured()) {
        try {
          const client = getOpenAiClient();
          const model = getAiModel();
          const prompt = [
            'You are forecasting delivered loads for the next 7 days.',
            'Use only the provided daily delivered loads history and return strict JSON:',
            '{"forecast":[{"date":"YYYY-MM-DD","delivered_loads":number}]}',
            `History: ${JSON.stringify(dailySeries.slice(-45))}`,
          ].join('\n');
          const response = await client.responses.create({
            model,
            input: [{ role: 'user', content: prompt }],
            max_output_tokens: 450,
          });
          const raw = String(response?.output_text || '').trim();
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
          const list = Array.isArray(parsed?.forecast) ? parsed.forecast : [];
          aiForecastDaily = list
            .map((x, i) => {
              const d = String(x?.date || '').slice(0, 10) || addCalendarDays(todayYmd(), i + 1);
              const v = toNum(x?.delivered_loads);
              return { date: d, delivered_loads: Math.max(0, Math.round(v * 10) / 10) };
            })
            .slice(0, 7);
        } catch (_) {
          aiForecastDaily = [];
        }
      }
      if (aiForecastDaily.length === 0) {
        const hist = dailySeries.slice(-14);
        const avg = hist.length ? hist.reduce((s, d) => s + d.delivered, 0) / hist.length : 0;
        aiForecastDaily = Array.from({ length: 7 }).map((_, i) => ({
          date: addCalendarDays(todayYmd(), i + 1),
          delivered_loads: Math.max(0, Math.round(avg * 10) / 10),
        }));
      }
    }

    const routesByReport = new Map();
    for (const rv of routeDeliveryMap.values()) {
      if (!routesByReport.has(rv.report_id)) routesByReport.set(rv.report_id, new Set());
      routesByReport.get(rv.report_id).add(rv.route_name);
    }

    const contractorTruckMap = {};
    const contractorTruckShiftMap = {};
    for (const tv of truckDeliveryMap.values()) {
      const contractorName = tv.contractor_name || 'Unmapped contractor';
      const contractorKey = String(tv.contractor_id || contractorName);
      const truck = tv.truck_registration || 'Unknown truck';
      const reportKey = tv.report_id;
      const shiftDate = tv.day || '';
      const shiftBucket = inferShiftBucket(tv.shift_start);
      const shiftLabel = shiftBucket === 'day' ? 'Day shift' : (shiftBucket === 'night' ? 'Night shift' : 'Unclassified');
      const completed = tv.completed_deliveries;
      let routeTarget = 0;
      const routeNames = routesByReport.get(String(reportKey));
      if (routeNames) {
        for (const name of routeNames) {
          routeTarget = Math.max(routeTarget, targetByRouteName[String(name).toLowerCase()] || 0);
        }
      }
      if (!contractorTruckMap[contractorKey]) {
        contractorTruckMap[contractorKey] = {
          contractor_id: tv.contractor_id || null,
          contractor_name: contractorName,
          trucks: {},
        };
      }
      if (!contractorTruckShiftMap[contractorKey]) contractorTruckShiftMap[contractorKey] = {};
      const shiftKey = `${truck}|${reportKey}|${shiftDate}|${shiftBucket}`;
      if (!contractorTruckShiftMap[contractorKey][shiftKey]) {
        contractorTruckShiftMap[contractorKey][shiftKey] = {
          truck_registration: truck,
          shift_date: shiftDate || null,
          shift_label: shiftLabel,
          completed_loads: 0,
          actual_target: 0,
        };
      }
      contractorTruckShiftMap[contractorKey][shiftKey].completed_loads = Math.max(
        contractorTruckShiftMap[contractorKey][shiftKey].completed_loads,
        completed
      );
      contractorTruckShiftMap[contractorKey][shiftKey].actual_target = Math.max(
        contractorTruckShiftMap[contractorKey][shiftKey].actual_target,
        routeTarget
      );
    }

    const aiTruckRemark = (completedLoads, actualTarget) => {
      if (!actualTarget || actualTarget <= 0) return 'No route target configured yet; add target regulation for clearer performance tracking.';
      const ratio = completedLoads / actualTarget;
      if (ratio >= 1.1) return 'Above target. Sustain this rhythm and replicate route discipline across lower-performing shifts.';
      if (ratio >= 0.95) return 'Near target. Small dispatch improvements and tighter turnaround can close the remaining gap.';
      if (ratio >= 0.8) return 'Below target. Improve loading/offloading cycle time and reduce non-productive waiting periods.';
      return 'Significantly below target. Immediate intervention needed: route planning, shift execution, and truck readiness review.';
    };

    const contractorPresentationPages = Object.values(contractorTruckMap)
      .map((c) => {
        const trucksList = Object.values(contractorTruckShiftMap[String(c.contractor_id || c.contractor_name)] || {})
          .map((t) => {
            const completedLoads = Math.round(t.completed_loads * 10) / 10;
            const actualTarget = Math.round(t.actual_target * 10) / 10;
            return {
              truck_registration: t.truck_registration,
              shift_date: t.shift_date,
              shift_label: t.shift_label,
              completed_loads: completedLoads,
              actual_target: actualTarget,
              ai_remarks: aiTruckRemark(completedLoads, actualTarget),
            };
          })
          .sort((a, b) => {
            const ad = String(a.shift_date || '');
            const bd = String(b.shift_date || '');
            if (ad !== bd) return bd.localeCompare(ad);
            return b.completed_loads - a.completed_loads;
          });
        return {
          contractor_id: c.contractor_id,
          contractor_name: c.contractor_name,
          trucks: trucksList,
        };
      })
      .sort((a, b) => a.contractor_name.localeCompare(b.contractor_name));

    let aiNarrative = null;
    if (isAiConfigured()) {
      try {
        const client = getOpenAiClient();
        const model = getAiModel();
        const prompt = [
          'You are generating a live presentation briefing for transport operations leadership.',
          'Audience: Thinkers Africa operations team. Be direct, advanced, and highly informative.',
          'Focus ONLY on the provided single-operations shift report data.',
          'Return STRICT JSON with keys: overview, operations_findings[], contractor_findings[], driver_truck_findings[], recommendations[], prediction.',
          'overview and prediction MUST be single plain-text strings (never nested JSON objects).',
          'Each array should have 3-6 concise but specific bullets.',
          `Data summary: ${JSON.stringify(summary)}`,
          `Top contractors: ${JSON.stringify(contractorPerformance.slice(0, 8))}`,
          `Top trucks: ${JSON.stringify(topTrucks.slice(0, 8))}`,
          `Top drivers: ${JSON.stringify(topDrivers.slice(0, 8))}`,
          `Route performance vs targets: ${JSON.stringify(routePerformance.slice(0, 12))}`,
          `Daily deliveries: ${JSON.stringify(dailySeries.slice(-30))}`,
          `Trend context: ${JSON.stringify({ recentAvg: Math.round(recentAvg * 10) / 10, priorAvg: Math.round(priorAvg * 10) / 10, trendPct, projectedWeeklyLoads })}`,
        ].join('\n');
        const response = await client.responses.create({
          model,
          input: [{ role: 'user', content: prompt }],
          max_output_tokens: 1200,
        });
        const raw = String(response?.output_text || '').trim();
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
        aiNarrative = normalizeDataPresentationNarrative(parsed);
      } catch (_) {
        aiNarrative = null;
      }
    }

    if (!aiNarrative) {
      aiNarrative = {
        overview: `Single-operations performance shows ${summary.total_loads_delivered} delivered loads across ${summary.approved_reports} approved reports. Current momentum is ${trendPct >= 0 ? 'upward' : 'downward'} (${trendPct}%).`,
        operations_findings: [
          `Average daily delivered loads are ${summary.avg_daily_deliveries}.`,
          `Projected delivered loads next 7 days: ${projectedWeeklyLoads}.`,
          `Coverage spans ${summary.contractors_covered} contractors with ${summary.trucks_covered} trucks and ${summary.drivers_covered} drivers.`,
        ],
        contractor_findings: contractorPerformance.slice(0, 4).map((c) => `${c.contractor_name}: ${c.loads_delivered} delivered loads, ${c.trucks_involved} trucks, ${c.drivers_involved} drivers.`),
        driver_truck_findings: [
          ...topTrucks.slice(0, 3).map((t) => `Truck ${t.truck_registration}: ${t.loads_delivered} delivered loads.`),
          ...topDrivers.slice(0, 3).map((d) => `Driver ${d.driver_name}: ${d.loads_delivered} delivered loads.`),
        ],
        recommendations: [
          'Reallocate route capacity from underperforming contractor/truck clusters to top-performing clusters.',
          'Prioritize coaching and shift handovers for routes where daily delivered loads are below period average.',
          'Use contractor-level scorecards weekly to enforce accountability on delivery throughput.',
        ],
        prediction: `If current pace holds, expected delivered loads for the next week are approximately ${projectedWeeklyLoads}, with trend change of ${trendPct}% vs prior week.`,
        target_reason: targetMissReason,
      };
    }

    aiNarrative = normalizeDataPresentationNarrative(aiNarrative);

    res.json({
      generated_at: new Date().toISOString(),
      filters: { dateFrom, dateTo, contractorId: contractorId || null, shiftType },
      summary,
      daily_series: dailySeries,
      daily_shift_series: dailyShiftSeries,
      contractor_performance: contractorPerformance,
      top_trucks: topTrucks,
      top_drivers: topDrivers,
      route_performance: routePerformance,
      target_reason: aiNarrative?.target_reason || targetMissReason,
      contractor_presentation_pages: contractorPresentationPages,
      ai_forecast_daily: aiForecastDaily,
      predictions: {
        projected_weekly_loads: projectedWeeklyLoads,
        trend_percent_vs_prior_week: trendPct,
      },
      narrative: aiNarrative,
    });
  } catch (err) {
    next(err);
  }
});

/** GET delivery timeline: completed deliveries by route for recent N days (default 30). */
router.get('/delivery-timeline', async (req, res, next) => {
  try {
    const daysRaw = parseInt(String(req.query?.days || '30'), 10);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, daysRaw)) : 30;

    const baseSelectWithApprovedAt = `
      SELECT
        r.route,
        r.report_date,
        r.shift_date,
        r.created_at,
        r.approved_at,
        r.total_loads_delivered,
        r.total_loads_dispatched,
        r.total_pending_deliveries,
        COALESCE(
          TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_loads_delivered)), N'')),
          TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_loads_dispatched)), N'')) - TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_pending_deliveries)), N'')),
          0
        ) AS completed_per_shift
      FROM command_centre_shift_reports r
      WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
        AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= DATEADD(day, -(@days - 1), CONVERT(date, GETUTCDATE()))
    `;
    const baseSelectWithoutApprovedAt = `
      SELECT
        r.route,
        r.report_date,
        r.shift_date,
        r.created_at,
        NULL AS approved_at,
        r.total_loads_delivered,
        r.total_loads_dispatched,
        r.total_pending_deliveries,
        COALESCE(
          TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_loads_delivered)), N'')),
          TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_loads_dispatched)), N'')) - TRY_CONVERT(FLOAT, NULLIF(LTRIM(RTRIM(r.total_pending_deliveries)), N'')),
          0
        ) AS completed_per_shift
      FROM command_centre_shift_reports r
      WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
        AND COALESCE(r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= DATEADD(day, -(@days - 1), CONVERT(date, GETUTCDATE()))
    `;
    const params = { days };
    let sql = `${baseSelectWithApprovedAt} ORDER BY COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) ASC, r.route ASC`;
    let result;
    try {
      result = await query(sql, params);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('approved_at') || msg.includes('invalid column name')) {
        sql = `${baseSelectWithoutApprovedAt} ORDER BY COALESCE(r.report_date, r.shift_date, CONVERT(date, r.created_at)) ASC, r.route ASC`;
        result = await query(sql, params);
      } else {
        throw e;
      }
    }
    const rows = result.recordset || [];

    const endYmd = todayYmd();
    const dayKeys = [];
    for (let i = days - 1; i >= 0; i--) {
      dayKeys.push(addCalendarDays(endYmd, -i));
    }
    const daySet = new Set(dayKeys);
    const byRoute = {};
    const totalsByDay = Object.fromEntries(dayKeys.map((k) => [k, 0]));

    const toNum = (v) => {
      const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    for (const row of rows) {
      const route = String(row.route || 'Unspecified').trim() || 'Unspecified';
      const day = String((row.approved_at || row.report_date || row.shift_date || row.created_at || '')).slice(0, 10);
      if (!daySet.has(day)) continue;
      const delivered = Math.max(0, toNum(row.completed_per_shift));
      if (!byRoute[route]) byRoute[route] = Object.fromEntries(dayKeys.map((k) => [k, 0]));
      byRoute[route][day] += delivered;
      totalsByDay[day] += delivered;
    }

    const routes = Object.keys(byRoute)
      .map((route) => ({
        route,
        points: dayKeys.map((d) => ({ date: d, delivered: byRoute[route][d] || 0 })),
        total: dayKeys.reduce((s, d) => s + (byRoute[route][d] || 0), 0),
      }))
      .sort((a, b) => b.total - a.total);

    const totalCompleted = routes.reduce((s, r) => s + r.total, 0);

    res.json({
      days,
      dates: dayKeys,
      routes,
      totals: dayKeys.map((d) => ({ date: d, delivered: totalsByDay[d] || 0 })),
      summary: {
        total_completed_deliveries: totalCompleted,
        routes_count: routes.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET one shift report with comments */
router.get('/shift-reports/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*,
        creator.full_name AS created_by_name, creator.email AS created_by_email,
        approver.full_name AS submitted_to_name, approver.email AS submitted_to_email,
        approvedBy.full_name AS approved_by_name
      FROM command_centre_shift_reports r
      LEFT JOIN users creator ON creator.id = r.created_by_user_id
      LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
      LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
      WHERE r.id = @id`,
      { id: req.params.id }
    );
    const report = result.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const commentsResult = await query(
      `SELECT c.*, u.full_name AS user_name FROM command_centre_shift_report_comments c
       JOIN users u ON u.id = c.user_id WHERE c.report_id = @reportId ORDER BY c.created_at`,
      { reportId: req.params.id }
    );
    const comments = commentsResult.recordset || [];
    let evaluation = null;
    if (req.user?.id) {
      try {
        const evalResult = await query(
          `SELECT id, answers, overall_comment, created_at FROM controller_evaluations WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
          { reportId: req.params.id, userId: req.user.id }
        );
        evaluation = evalResult.recordset?.[0]
          ? { id: evalResult.recordset[0].id, answers: evalResult.recordset[0].answers, overall_comment: evalResult.recordset[0].overall_comment, created_at: evalResult.recordset[0].created_at }
          : null;
      } catch (e) {
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('invalid object name') && msg.includes('controller_evaluations')) {
          console.warn('[command-centre] controller_evaluations missing; run: npm run db:command-centre-controller-evaluations');
        } else {
          throw e;
        }
      }
    }
    res.json({ report: rowToShiftReport(report), comments, evaluation });
  } catch (err) {
    next(err);
  }
});

/** GET controller evaluation for this shift report (by current user) */
router.get('/shift-reports/:id/evaluation', async (req, res, next) => {
  try {
    const evalResult = await query(
      `SELECT e.id, e.answers, e.overall_comment, e.created_at, u.full_name AS evaluator_name
       FROM controller_evaluations e
       JOIN users u ON u.id = e.evaluator_user_id
       WHERE e.shift_report_id = @id AND e.evaluator_user_id = @userId`,
      { id: req.params.id, userId: req.user.id }
    );
    const row = evalResult.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'No evaluation found' });
    res.json({ evaluation: { id: row.id, answers: row.answers, overall_comment: row.overall_comment, created_at: row.created_at, evaluator_name: row.evaluator_name } });
  } catch (err) {
    next(err);
  }
});

/** POST submit controller evaluation (required before approve/reject/provisional). One per report per evaluator. */
router.post('/shift-reports/:id/evaluation', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { answers, overall_comment } = req.body || {};
    const reportResult = await query(
      `SELECT id, status, submitted_to_user_id, created_by_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id }
    );
    const report = reportResult.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const isApproverOrSuperAdmin = report.submitted_to_user_id === req.user.id || req.user?.role === 'super_admin';
    if (!isApproverOrSuperAdmin) return res.status(403).json({ error: 'Only the assigned approver can submit an evaluation' });
    if (!report.status || !['pending_approval', 'provisional'].includes(report.status)) return res.status(400).json({ error: 'Report is not awaiting your review' });
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'answers object required' });
    if (!overall_comment || typeof overall_comment !== 'string' || !String(overall_comment).trim()) return res.status(400).json({ error: 'overall_comment is required' });

    let tenantId = (await query(`SELECT tenant_id FROM users WHERE id = @uid`, { uid: report.created_by_user_id })).recordset?.[0]?.tenant_id ?? null;
    if (tenantId == null && req.user?.tenant_id) tenantId = req.user.tenant_id;
    const existing = await query(
      `SELECT id FROM controller_evaluations WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
      { reportId: id, userId: req.user.id }
    );
    const answersJson = JSON.stringify(answers);
    if (existing.recordset?.length > 0) {
      await query(
        `UPDATE controller_evaluations SET answers = @answers, overall_comment = @overall_comment WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
        { reportId: id, userId: req.user.id, answers: answersJson, overall_comment: String(overall_comment).trim() }
      );
    } else {
      await query(
        `INSERT INTO controller_evaluations (tenant_id, shift_report_id, evaluator_user_id, answers, overall_comment) VALUES (@tenantId, @reportId, @userId, @answers, @overall_comment)`,
        { tenantId, reportId: id, userId: req.user.id, answers: answersJson, overall_comment: String(overall_comment).trim() }
      );
    }
    const getEval = await query(
      `SELECT id, answers, overall_comment, created_at FROM controller_evaluations WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
      { reportId: id, userId: req.user.id }
    );
    const row = getEval.recordset?.[0];
    res.status(existing.recordset?.length > 0 ? 200 : 201).json({ evaluation: { id: row?.id, answers: row?.answers, overall_comment: row?.overall_comment, created_at: row?.created_at } });
  } catch (err) {
    next(err);
  }
});

/** POST request override code (when user already evaluated and wants to change decision). Emails Access Management with code. */
router.post('/shift-reports/:id/request-override', async (req, res, next) => {
  try {
    const { id } = req.params;
    const reportResult = await query(
      `SELECT r.id, r.route, r.report_date, r.submitted_to_user_id, creator.tenant_id
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       WHERE r.id = @id`,
      { id }
    );
    const report = reportResult.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.submitted_to_user_id !== req.user.id && req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the assigned approver can request an override' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await query(
      `INSERT INTO shift_report_override_requests (shift_report_id, requested_by_user_id, code) VALUES (@reportId, @userId, @code)`,
      { reportId: id, userId: req.user.id, code }
    );
    const accessManagementEmails = await getAccessManagementEmails(query);
    const requesterName = req.user.full_name || req.user.email || 'Approver';
    const requesterEmail = req.user.email || '';
    const reportDate = report.report_date ? new Date(report.report_date + 'T12:00:00').toLocaleDateString() : '';
    const appUrl = process.env.APP_URL || '';
    if (sendEmail && isEmailConfigured?.()) {
      if (accessManagementEmails?.length) {
        const htmlAm = shiftReportOverrideRequestHtml({ requesterName, requesterEmail, reportRoute: report.route, reportDate, code, appUrl });
        await sendEmail({ to: accessManagementEmails, subject: 'Shift report override code requested – Command Centre', body: htmlAm, html: true }).catch((e) => console.error('[command-centre] Override request email to AM error:', e?.message));
      }
      if (requesterEmail && requesterEmail.includes('@')) {
        const htmlRequester = shiftReportOverrideCodeToRequesterHtml({ reportRoute: report.route, reportDate, code, appUrl });
        await sendEmail({ to: requesterEmail, subject: 'Your shift report override code – Command Centre', body: htmlRequester, html: true }).catch((e) => console.error('[command-centre] Override code email to requester error:', e?.message));
      }
    }
    res.status(201).json({ message: 'Override requested. Check your email for the code (and Access Management has been notified).' });
  } catch (err) {
    next(err);
  }
});

/** PATCH approve */
/**
 * Compute the next per-tenant reference number for a given shift report kind.
 * Returns 1 if no rows exist yet for this tenant.
 */
async function nextShiftReportRefNumber(tenantId, kind) {
  if (!tenantId) return 1;
  const table = kind === 'single_ops'
    ? 'command_centre_single_ops_shift_reports'
    : 'command_centre_shift_reports';
  const r = await query(
    `SELECT ISNULL(MAX(r.ref_number), 0) + 1 AS next_ref
     FROM ${table} r
     JOIN users u ON u.id = r.created_by_user_id
     WHERE u.tenant_id = @tenantId`,
    { tenantId }
  );
  const next = Number(r.recordset?.[0]?.next_ref || 1);
  return Number.isFinite(next) && next > 0 ? next : 1;
}

router.post('/shift-reports', async (req, res, next) => {
  try {
    const b = req.body || {};
    const refNumber = await nextShiftReportRefNumber(req.user?.tenant_id, 'shift');
    const payload = {
      created_by_user_id: req.user.id,
      ref_number: refNumber,
      route: b.route ?? null,
      report_date: b.report_date || null,
      shift_date: b.shift_date || null,
      shift_start: b.shift_start ?? null,
      shift_end: b.shift_end ?? null,
      controller1_name: b.controller1_name ?? null,
      controller1_email: b.controller1_email ?? null,
      controller2_name: b.controller2_name ?? null,
      controller2_email: b.controller2_email ?? null,
      total_trucks_scheduled: b.total_trucks_scheduled ?? null,
      balance_brought_down: b.balance_brought_down ?? null,
      total_loads_dispatched: b.total_loads_dispatched ?? null,
      total_pending_deliveries: b.total_pending_deliveries ?? null,
      total_loads_delivered: b.total_loads_delivered ?? null,
      overall_performance: b.overall_performance ?? null,
      key_highlights: b.key_highlights ?? null,
      truck_updates: typeof b.truck_updates === 'string' ? b.truck_updates : JSON.stringify(b.truck_updates || []),
      incidents: typeof b.incidents === 'string' ? b.incidents : JSON.stringify(b.incidents || []),
      non_compliance_calls: typeof b.non_compliance_calls === 'string' ? b.non_compliance_calls : JSON.stringify(b.non_compliance_calls || []),
      investigations: typeof b.investigations === 'string' ? b.investigations : JSON.stringify(b.investigations || []),
      communication_log: typeof b.communication_log === 'string' ? b.communication_log : JSON.stringify(b.communication_log || []),
      outstanding_issues: b.outstanding_issues ?? null,
      handover_key_info: b.handover_key_info ?? null,
      declaration: b.declaration ?? null,
      shift_conclusion_time: b.shift_conclusion_time ?? null,
      status: 'draft',
    };
    const result = await query(
      `INSERT INTO command_centre_shift_reports (
        created_by_user_id, ref_number, route, report_date, shift_date, shift_start, shift_end,
        controller1_name, controller1_email, controller2_name, controller2_email,
        total_trucks_scheduled, balance_brought_down, total_loads_dispatched, total_pending_deliveries, total_loads_delivered,
        overall_performance, key_highlights, truck_updates, incidents, non_compliance_calls, investigations, communication_log,
        outstanding_issues, handover_key_info, declaration, shift_conclusion_time, status
      ) OUTPUT INSERTED.*
      VALUES (
        @created_by_user_id, @ref_number, @route, @report_date, @shift_date, @shift_start, @shift_end,
        @controller1_name, @controller1_email, @controller2_name, @controller2_email,
        @total_trucks_scheduled, @balance_brought_down, @total_loads_dispatched, @total_pending_deliveries, @total_loads_delivered,
        @overall_performance, @key_highlights, @truck_updates, @incidents, @non_compliance_calls, @investigations, @communication_log,
        @outstanding_issues, @handover_key_info, @declaration, @shift_conclusion_time, @status
      )`,
      payload
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(500).json({ error: 'Insert failed' });
    res.status(201).json({ report: rowToShiftReport(row) });
  } catch (err) {
    next(err);
  }
});

/** PATCH update shift report (only draft or provisional when creator) */
router.patch('/shift-reports/:id', async (req, res, next) => {
  try {
    const getResult = await query(
      `SELECT r.id, r.status, r.created_by_user_id, creator.email AS creator_email
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const status = existing.status != null ? String(existing.status).toLowerCase().trim() : '';
    if (!['draft', 'provisional', 'rejected'].includes(status)) return res.status(400).json({ error: 'Report cannot be edited in current status' });
    const norm = (v) => (v != null ? String(v).toLowerCase().trim() : '');
    const creatorId = norm(existing.created_by_user_id);
    const userId = norm(req.user?.id);
    const creatorEmail = norm(existing.creator_email);
    const userEmail = norm(req.user?.email);
    const isCreator = (creatorId && userId && creatorId === userId) || (creatorEmail && userEmail && creatorEmail === userEmail);
    if (!isCreator) return res.status(403).json({ error: 'Not allowed to edit this report' });

    const b = req.body || {};
    const payload = {
      id: req.params.id,
      route: b.route,
      report_date: b.report_date,
      shift_date: b.shift_date,
      shift_start: b.shift_start,
      shift_end: b.shift_end,
      controller1_name: b.controller1_name,
      controller1_email: b.controller1_email,
      controller2_name: b.controller2_name,
      controller2_email: b.controller2_email,
      total_trucks_scheduled: b.total_trucks_scheduled,
      balance_brought_down: b.balance_brought_down,
      total_loads_dispatched: b.total_loads_dispatched,
      total_pending_deliveries: b.total_pending_deliveries,
      total_loads_delivered: b.total_loads_delivered,
      overall_performance: b.overall_performance,
      key_highlights: b.key_highlights,
      truck_updates: b.truck_updates !== undefined ? (typeof b.truck_updates === 'string' ? b.truck_updates : JSON.stringify(b.truck_updates)) : undefined,
      incidents: b.incidents !== undefined ? (typeof b.incidents === 'string' ? b.incidents : JSON.stringify(b.incidents)) : undefined,
      non_compliance_calls: b.non_compliance_calls !== undefined ? (typeof b.non_compliance_calls === 'string' ? b.non_compliance_calls : JSON.stringify(b.non_compliance_calls)) : undefined,
      investigations: b.investigations !== undefined ? (typeof b.investigations === 'string' ? b.investigations : JSON.stringify(b.investigations)) : undefined,
      communication_log: b.communication_log !== undefined ? (typeof b.communication_log === 'string' ? b.communication_log : JSON.stringify(b.communication_log)) : undefined,
      outstanding_issues: b.outstanding_issues,
      handover_key_info: b.handover_key_info,
      declaration: b.declaration,
      shift_conclusion_time: b.shift_conclusion_time,
    };
    const setClause = [];
    const params = { id: req.params.id };
    const fields = [
      'route', 'report_date', 'shift_date', 'shift_start', 'shift_end',
      'controller1_name', 'controller1_email', 'controller2_name', 'controller2_email',
      'total_trucks_scheduled', 'balance_brought_down', 'total_loads_dispatched', 'total_pending_deliveries', 'total_loads_delivered',
      'overall_performance', 'key_highlights', 'truck_updates', 'incidents', 'non_compliance_calls', 'investigations', 'communication_log',
      'outstanding_issues', 'handover_key_info', 'declaration', 'shift_conclusion_time'
    ];
    for (const f of fields) {
      if (payload[f] !== undefined) {
        setClause.push(`r.${f} = @${f}`);
        params[f] = payload[f];
      }
    }
    if (setClause.length === 0) {
      const one = await query(
        `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name, approvedBy.full_name AS approved_by_name
         FROM command_centre_shift_reports r
         LEFT JOIN users creator ON creator.id = r.created_by_user_id
         LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
         LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
         WHERE r.id = @id`,
        { id: req.params.id }
      );
      return res.json({ report: rowToShiftReport(one.recordset?.[0]) });
    }
    params.updated_at = new Date().toISOString();
    await query(
      `UPDATE command_centre_shift_reports SET ${setClause.map((s) => s.replace('r.', '')).join(', ')}, updated_at = @updated_at WHERE id = @id`,
      params
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name, approvedBy.full_name AS approved_by_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** DELETE draft shift report (super_admin only). Cascades comments, evaluations, override requests. */
router.delete('/shift-reports/:id', async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a system administrator can delete draft shift reports.' });
    }
    const getResult = await query(
      `SELECT id, status FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const status = existing.status != null ? String(existing.status).toLowerCase().trim() : '';
    if (status !== 'draft') {
      return res.status(400).json({ error: 'Only draft reports can be deleted.' });
    }
    await query(`DELETE FROM command_centre_shift_reports WHERE id = @id`, { id: req.params.id });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

/** POST submit for approval */
router.post('/shift-reports/:id/submit', async (req, res, next) => {
  try {
    const { submitted_to_user_id } = req.body || {};
    if (!submitted_to_user_id) return res.status(400).json({ error: 'submitted_to_user_id required' });
    const getResult = await query(
      `SELECT id, status, created_by_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (existing.created_by_user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
    if (existing.status !== 'draft' && existing.status !== 'rejected') return res.status(400).json({ error: 'Only draft or rejected reports can be submitted' });

    await query(
      `UPDATE command_centre_shift_reports SET status = 'pending_approval', submitted_to_user_id = @submittedTo, submitted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, submittedTo: submitted_to_user_id }
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** POST add comment */
router.post('/shift-reports/:id/comments', async (req, res, next) => {
  try {
    const { comment_text } = req.body || {};
    if (!comment_text || !String(comment_text).trim()) return res.status(400).json({ error: 'comment_text required' });
    const getResult = await query(
      `SELECT id, created_by_user_id, submitted_to_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const report = getResult.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const isApprover = report.submitted_to_user_id === req.user.id;
    const isCreator = report.created_by_user_id === req.user.id;
    const isSuperAdmin = req.user?.role === 'super_admin';
    if (!isApprover && !isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Not allowed to comment' });

    const result = await query(
      `INSERT INTO command_centre_shift_report_comments (report_id, user_id, comment_text) OUTPUT INSERTED.*
       SELECT @reportId, @userId, @commentText`,
      { reportId: req.params.id, userId: req.user.id, commentText: String(comment_text).trim() }
    );
    const comment = result.recordset?.[0];
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

/** PATCH mark comment addressed (only report creator when status = provisional) */
router.patch('/shift-reports/:reportId/comments/:commentId/addressed', async (req, res, next) => {
  try {
    const { reportId, commentId } = req.params;
    const getReport = await query(
      `SELECT id, status, created_by_user_id, submitted_to_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: reportId }
    );
    const report = getReport.recordset?.[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.created_by_user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
    if (report.status !== 'provisional') return res.status(400).json({ error: 'Only provisional reports allow marking comments addressed' });

    await query(
      `UPDATE command_centre_shift_report_comments SET addressed = 1, addressed_at = SYSUTCDATETIME() WHERE id = @commentId AND report_id = @reportId`,
      { commentId, reportId }
    );
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM command_centre_shift_report_comments WHERE report_id = @reportId`,
      { reportId }
    );
    const total = countResult.recordset?.[0]?.total ?? 0;
    const addressedResult = await query(
      `SELECT COUNT(*) AS addressed FROM command_centre_shift_report_comments WHERE report_id = @reportId AND addressed = 1`,
      { reportId }
    );
    const addressed = addressedResult.recordset?.[0]?.addressed ?? 0;
    if (total > 0 && addressed >= total) {
      await query(
        `UPDATE command_centre_shift_reports SET status = 'approved', approved_by_user_id = @approvedBy, approved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @reportId`,
        { reportId, approvedBy: report.submitted_to_user_id }
      );
    }
    const commentsResult = await query(
      `SELECT c.*, u.full_name AS user_name FROM command_centre_shift_report_comments c JOIN users u ON u.id = c.user_id WHERE c.report_id = @reportId ORDER BY c.created_at`,
      { reportId }
    );
    res.json({ comments: commentsResult.recordset || [], autoApproved: total > 0 && addressed >= total });
  } catch (err) {
    next(err);
  }
});

/** Strip non-digits so pasted codes match DB even when email HTML adds spaces (letter-spacing) or separators. */
function normalizeOverrideCodeInput(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Helper: require evaluation for report by user, or valid override when report already in final state */
async function requireEvaluationOrOverride(query, reportId, userId, status, overrideCode, ctx = {}) {
  const { isSuperAdmin = false, submittedToUserId = null } = ctx;
  const st = String(status ?? '').toLowerCase().trim();
  const needsOverride = st === 'approved' || st === 'rejected';
  const hasCode = overrideCode != null && String(overrideCode).trim() !== '';
  if (needsOverride && hasCode) {
    const codeNorm = normalizeOverrideCodeInput(overrideCode);
    if (!codeNorm) return { error: 'Invalid or already used override code' };
    const result = await query(
      `SELECT id, code, requested_by_user_id FROM shift_report_override_requests WHERE shift_report_id = @reportId AND used_at IS NULL`,
      { reportId }
    );
    const rows = result.recordset || [];
    const uid = String(userId ?? '').toLowerCase();
    const subTo = submittedToUserId != null ? String(submittedToUserId).toLowerCase() : '';
    const match = rows.find((r) => {
      const dbNorm = normalizeOverrideCodeInput(r.code);
      if (dbNorm !== codeNorm) return false;
      const reqBy = String(r.requested_by_user_id ?? '').toLowerCase();
      if (reqBy === uid) return true;
      if (isSuperAdmin && subTo && reqBy === subTo) return true;
      return false;
    });
    if (!match) return { error: 'Invalid or already used override code' };
    await query(`UPDATE shift_report_override_requests SET used_at = SYSUTCDATETIME() WHERE id = @id`, { id: match.id });
    return {};
  }
  if (needsOverride) return { error: 'Override code required. Request one from Access Management.' };
  const evalResult = await query(
    `SELECT id FROM controller_evaluations WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
    { reportId, userId }
  );
  if (!evalResult.recordset?.length) return { error: 'Complete the controller evaluation before approving, rejecting, or granting provisional approval.' };
  return {};
}

/** PATCH approve */
router.patch('/shift-reports/:id/approve', async (req, res, next) => {
  try {
    const getResult = await query(
      `SELECT id, status, submitted_to_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (existing.submitted_to_user_id !== req.user.id && req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the assigned approver can approve' });
    const overrideCode = req.body?.override_code;
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode, {
      isSuperAdmin: req.user?.role === 'super_admin',
      submittedToUserId: existing.submitted_to_user_id,
    });
    if (check.error) return res.status(400).json({ error: check.error });
    if (existing.status !== 'pending_approval' && existing.status !== 'provisional' && existing.status !== 'approved' && existing.status !== 'rejected') return res.status(400).json({ error: 'Report not in approvable state' });

    await query(
      `UPDATE command_centre_shift_reports SET status = 'approved', approved_by_user_id = @userId, approved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, userId: req.user.id }
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name, approvedBy.full_name AS approved_by_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** PATCH reject */
router.patch('/shift-reports/:id/reject', async (req, res, next) => {
  try {
    const getResult = await query(
      `SELECT id, status, submitted_to_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (existing.submitted_to_user_id !== req.user.id && req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the assigned approver can reject' });
    const overrideCode = req.body?.override_code;
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode, {
      isSuperAdmin: req.user?.role === 'super_admin',
      submittedToUserId: existing.submitted_to_user_id,
    });
    if (check.error) return res.status(400).json({ error: check.error });
    if (existing.status !== 'pending_approval' && existing.status !== 'provisional' && existing.status !== 'approved' && existing.status !== 'rejected') return res.status(400).json({ error: 'Report not in rejectable state' });

    await query(
      `UPDATE command_centre_shift_reports SET status = 'rejected', approved_by_user_id = NULL, approved_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id }
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** PATCH provisional approval */
router.patch('/shift-reports/:id/provisional', async (req, res, next) => {
  try {
    const getResult = await query(
      `SELECT id, status, submitted_to_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (existing.submitted_to_user_id !== req.user.id && req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the assigned approver can give provisional approval' });
    const overrideCode = req.body?.override_code;
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode, {
      isSuperAdmin: req.user?.role === 'super_admin',
      submittedToUserId: existing.submitted_to_user_id,
    });
    if (check.error) return res.status(400).json({ error: check.error });
    if (existing.status !== 'pending_approval' && existing.status !== 'provisional' && existing.status !== 'approved' && existing.status !== 'rejected') return res.status(400).json({ error: 'Report not in correct state' });

    await query(
      `UPDATE command_centre_shift_reports SET status = 'provisional', approved_by_user_id = NULL, approved_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id }
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** PATCH revoke approval: set report back to draft so controllers can edit and resubmit. Only the approver can revoke. */
router.patch('/shift-reports/:id/revoke-approval', async (req, res, next) => {
  try {
    const getResult = await query(
      `SELECT id, status, approved_by_user_id FROM command_centre_shift_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const existing = getResult.recordset?.[0];
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (String(existing.status).toLowerCase().trim() !== 'approved') return res.status(400).json({ error: 'Only approved reports can have approval revoked' });
    const approvedBy = existing.approved_by_user_id != null ? String(existing.approved_by_user_id).toLowerCase().trim() : '';
    const userId = req.user?.id != null ? String(req.user.id).toLowerCase().trim() : '';
    if (approvedBy !== userId && req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Only the user who approved this report can revoke approval' });

    await query(
      `UPDATE command_centre_shift_reports SET status = 'draft', approved_by_user_id = NULL, approved_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id }
    );
    const updated = await query(
      `SELECT r.*, creator.full_name AS created_by_name, approver.full_name AS submitted_to_name, approvedBy.full_name AS approved_by_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
       WHERE r.id = @id`,
      { id: req.params.id }
    );
    res.json({ report: rowToShiftReport(updated.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

// --- Library: all approved reports and uploads (shared by company/tenant) ---
/** GET library: all approved shift reports, investigation reports, and uploads for the user's company. Every user in the same tenant sees the same library. */
router.get('/library', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenant_id ?? null;

    // All approved shift reports where creator OR approver is in same tenant (so all company users see them)
    const shiftResult = await query(
      `SELECT r.*,
        creator.full_name AS created_by_name, creator.email AS created_by_email,
        approver.full_name AS submitted_to_name, approvedBy.full_name AS approved_by_name
       FROM command_centre_shift_reports r
       LEFT JOIN users creator ON creator.id = r.created_by_user_id
       LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
       LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
       WHERE r.status = 'approved'
         AND (@tenantId IS NULL OR creator.tenant_id = @tenantId OR approvedBy.tenant_id = @tenantId)
       ORDER BY r.approved_at DESC, r.updated_at DESC`,
      { tenantId }
    );
    const shiftReports = (shiftResult.recordset || []).map(rowToShiftReport);

    let investigationReports = [];
    try {
      const invResult = await query(
        `SELECT inv.*, creator.full_name AS created_by_name, approvedBy.full_name AS approved_by_name
         FROM command_centre_investigation_reports inv
         LEFT JOIN users creator ON creator.id = inv.created_by_user_id
         LEFT JOIN users approvedBy ON approvedBy.id = inv.approved_by_user_id
         WHERE inv.status = 'approved'
           AND (@tenantId IS NULL OR creator.tenant_id = @tenantId OR approvedBy.tenant_id = @tenantId)
         ORDER BY inv.approved_at DESC, inv.updated_at DESC`,
        { tenantId }
      );
      investigationReports = (invResult.recordset || []).map(rowToInvReport);
    } catch (_) {
      // Table may not exist yet
    }

    // All uploads from users in same tenant (everyone in company sees all uploads)
    let documents = [];
    try {
      const docResult = await query(
        `SELECT d.id, d.file_name, d.stored_path, d.mime_type, d.file_size, d.created_at, d.user_id, u.full_name AS uploaded_by_name
         FROM command_centre_library_documents d
         JOIN users u ON u.id = d.user_id
         WHERE (@tenantId IS NULL AND d.user_id = @userId) OR (@tenantId IS NOT NULL AND u.tenant_id = @tenantId)
         ORDER BY d.created_at DESC`,
        { userId, tenantId }
      );
      documents = (docResult.recordset || []).map((r) => ({
        id: r.id,
        file_name: r.file_name,
        stored_path: r.stored_path,
        mime_type: r.mime_type,
        file_size: r.file_size,
        created_at: r.created_at,
        uploaded_by_name: r.uploaded_by_name,
      }));
    } catch (_) {
      // Table may not exist yet
    }

    res.json({ shiftReports, investigationReports, documents });
  } catch (err) {
    next(err);
  }
});

// --- Investigation reports ---
function rowToInvReport(r) {
  if (!r) return null;
  const jsonFields = ['transactions', 'parties', 'recommendations'];
  const out = { ...r };
  for (const f of jsonFields) {
    if (typeof out[f] === 'string') {
      try {
        const parsed = JSON.parse(out[f]);
        out[f] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      } catch (_) {
        out[f] = [];
      }
    }
  }
  if (!Array.isArray(out.recommendations)) out.recommendations = [];
  return out;
}

/** POST create investigation report (draft) */
router.post('/investigation-reports', async (req, res, next) => {
  try {
    const b = req.body || {};
    const id = b.id || randomUUID();
    const payload = {
      id,
      created_by_user_id: req.user.id,
      case_number: b.case_number ?? null,
      type: b.type ?? 'DEVIATION',
      status: 'draft',
      priority: b.priority ?? null,
      date_occurred: b.date_occurred || null,
      date_reported: b.date_reported || null,
      location: b.location ?? null,
      investigator_name: b.investigator_name ?? null,
      badge_number: b.badge_number ?? null,
      rank: b.rank ?? null,
      reported_by_name: b.reported_by_name ?? null,
      reported_by_position: b.reported_by_position ?? null,
      description: b.description ?? null,
      transactions: typeof b.transactions === 'string' ? b.transactions : JSON.stringify(b.transactions || []),
      parties: typeof b.parties === 'string' ? b.parties : JSON.stringify(b.parties || []),
      evidence_notes: b.evidence_notes ?? null,
      finding_summary: b.finding_summary ?? null,
      finding_operational_trigger: b.finding_operational_trigger ?? null,
      finding_incident: b.finding_incident ?? null,
      finding_workaround: b.finding_workaround ?? null,
      finding_system_integrity: b.finding_system_integrity ?? null,
      finding_resolution: b.finding_resolution ?? null,
      recommendations: typeof b.recommendations === 'string' ? b.recommendations : JSON.stringify(b.recommendations || []),
      additional_notes: b.additional_notes ?? null,
    };
    await query(
      `INSERT INTO command_centre_investigation_reports (
        id, created_by_user_id, case_number, [type], [status], priority, date_occurred, date_reported, [location],
        investigator_name, badge_number, [rank], reported_by_name, reported_by_position, [description],
        transactions, parties, evidence_notes, finding_summary, finding_operational_trigger, finding_incident,
        finding_workaround, finding_system_integrity, finding_resolution, recommendations, additional_notes
      ) VALUES (
        @id, @created_by_user_id, @case_number, @type, @status, @priority, @date_occurred, @date_reported, @location,
        @investigator_name, @badge_number, @rank, @reported_by_name, @reported_by_position, @description,
        @transactions, @parties, @evidence_notes, @finding_summary, @finding_operational_trigger, @finding_incident,
        @finding_workaround, @finding_system_integrity, @finding_resolution, @recommendations, @additional_notes
      )`,
      payload
    );
    const row = (await query(
      `SELECT inv.*, creator.full_name AS created_by_name FROM command_centre_investigation_reports inv
       LEFT JOIN users creator ON creator.id = inv.created_by_user_id WHERE inv.id = @id`,
      { id: payload.id }
    )).recordset?.[0];
    res.status(201).json({ report: rowToInvReport(row) });
  } catch (err) {
    next(err);
  }
});

/** PATCH approve investigation report (creator only) -> appears in library */
router.patch('/investigation-reports/:id/approve', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, status, created_by_user_id FROM command_centre_investigation_reports WHERE id = @id`,
      { id: req.params.id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Report not found' });
    if (String(row.created_by_user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Not allowed to approve this report' });
    if (row.status === 'approved') return res.json({ report: rowToInvReport(row) });

    await query(
      `UPDATE command_centre_investigation_reports SET status = 'approved', approved_by_user_id = @userId, approved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, userId: req.user.id }
    );
    const updated = (await query(
      `SELECT inv.*, creator.full_name AS created_by_name, approvedBy.full_name AS approved_by_name
       FROM command_centre_investigation_reports inv
       LEFT JOIN users creator ON creator.id = inv.created_by_user_id
       LEFT JOIN users approvedBy ON approvedBy.id = inv.approved_by_user_id
       WHERE inv.id = @id`,
      { id: req.params.id }
    )).recordset?.[0];
    res.json({ report: rowToInvReport(updated) });
  } catch (err) {
    next(err);
  }
});

/** GET my investigation reports (for "saved" list; optional ?approved=1 for approved only) */
router.get('/investigation-reports', async (req, res, next) => {
  try {
    const approvedOnly = req.query.approved === '1';
    let sql = `SELECT inv.*, creator.full_name AS created_by_name FROM command_centre_investigation_reports inv
      LEFT JOIN users creator ON creator.id = inv.created_by_user_id WHERE inv.created_by_user_id = @userId`;
    if (approvedOnly) sql += ` AND inv.status = 'approved'`;
    sql += ` ORDER BY inv.updated_at DESC`;
    const result = await query(sql, { userId: req.user.id });
    const list = (result.recordset || []).map(rowToInvReport);
    res.json({ reports: list });
  } catch (err) {
    next(err);
  }
});

// --- Library documents (uploaded files) - shared by tenant ---
/** GET list uploaded documents: all users in same company (tenant) see all uploads */
router.get('/library/documents', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    const result = await query(
      `SELECT d.id, d.file_name, d.stored_path, d.mime_type, d.file_size, d.created_at, d.user_id, u.full_name AS uploaded_by_name
       FROM command_centre_library_documents d
       JOIN users u ON u.id = d.user_id
       WHERE (@tenantId IS NULL AND d.user_id = @userId) OR (@tenantId IS NOT NULL AND u.tenant_id = @tenantId)
       ORDER BY d.created_at DESC`,
      { userId: req.user.id, tenantId }
    );
    const list = (result.recordset || []).map((r) => ({
      id: r.id,
      file_name: r.file_name,
      stored_path: r.stored_path,
      mime_type: r.mime_type,
      file_size: r.file_size,
      created_at: r.created_at,
      uploaded_by_name: r.uploaded_by_name,
    }));
    res.json({ documents: list });
  } catch (err) {
    next(err);
  }
});

/** POST upload a file to library */
router.post('/library/documents', libraryUpload, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const userId = req.user.id;
    const relativePath = path.join('library', String(userId), path.basename(req.file.filename));
    const storedPath = relativePath.split(path.sep).join('/');
    await query(
      `INSERT INTO command_centre_library_documents (user_id, file_name, stored_path, mime_type, file_size) VALUES (@userId, @file_name, @stored_path, @mime_type, @file_size)`,
      {
        userId,
        file_name: req.file.originalname || req.file.filename,
        stored_path: storedPath,
        mime_type: req.file.mimetype || null,
        file_size: req.file.size || null,
      }
    );
    const row = (await query(
      `SELECT id, file_name, stored_path, mime_type, file_size, created_at FROM command_centre_library_documents WHERE user_id = @userId AND stored_path = @stored_path`,
      { userId, stored_path: storedPath }
    )).recordset?.[0];
    const document = row ? { ...row, uploaded_by_name: req.user?.full_name || null } : row;
    res.status(201).json({ document });
  } catch (err) {
    next(err);
  }
});

/** GET download a library document (owner or same tenant) */
router.get('/library/documents/:id/download', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    const result = await query(
      `SELECT d.id, d.file_name, d.stored_path, d.mime_type FROM command_centre_library_documents d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.id = @id AND (d.user_id = @userId OR (@tenantId IS NOT NULL AND u.tenant_id = @tenantId))`,
      { id: req.params.id, userId: req.user.id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Document not found' });
    const filePath = path.join(process.cwd(), 'uploads', row.stored_path.split('/').join(path.sep));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.file_name)}"`);
    if (row.mime_type) res.setHeader('Content-Type', row.mime_type);
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

/* --- Truck update analysis: server save, handover, resume (12h idle prune of payload) --- */

const TRUCK_ANALYSIS_REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomTruckAnalysisRef() {
  let s = 'TA';
  for (let i = 0; i < 6; i += 1) {
    s += TRUCK_ANALYSIS_REF_CHARS[Math.floor(Math.random() * TRUCK_ANALYSIS_REF_CHARS.length)];
  }
  return s;
}

async function pruneStaleTruckAnalysisSessions(tenantId) {
  if (!tenantId) return;
  await query(
    `UPDATE truck_analysis_handovers
     SET status = 'pruned', payload_json = NULL, pruned_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
     WHERE tenant_id = @tenantId AND status <> N'pruned'
       AND last_referenced_at < DATEADD(HOUR, -12, SYSUTCDATETIME())`,
    { tenantId }
  );
}

/** GET users who can use Command Centre (for truck analysis controller picker). */
router.get('/truck-analysis/controllers', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId && req.user?.role !== 'super_admin') {
      return res.status(400).json({ error: 'No tenant context' });
    }
    const result = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       WHERE (
         EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId)
         OR u.tenant_id = @tenantId
       )
       AND (
         EXISTS (SELECT 1 FROM command_centre_grants g WHERE g.user_id = u.id)
         OR EXISTS (
           SELECT 1 FROM user_page_roles pr
           WHERE pr.user_id = u.id AND LOWER(LTRIM(RTRIM(pr.page_id))) = N'command_centre'
         )
         OR u.role IN (N'tenant_admin', N'super_admin')
       )
       ORDER BY u.full_name`,
      { tenantId }
    );
    res.json({ controllers: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET list analysis sessions for tenant (prunes idle payloads first). */
router.get('/truck-analysis/sessions', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    await pruneStaleTruckAnalysisSessions(tenantId);
    const result = await query(
      `SELECT id, reference_code, status, summary_json, last_referenced_at, handed_over_at, pruned_at, created_at, updated_at
       FROM truck_analysis_handovers
       WHERE tenant_id = @tenantId
       ORDER BY updated_at DESC`,
      { tenantId }
    );
    const sessions = (result.recordset || []).map((row) => {
      let summary = null;
      try {
        summary = row.summary_json ? JSON.parse(row.summary_json) : null;
      } catch (_) {}
      return {
        id: row.id,
        reference_code: row.reference_code,
        status: row.status,
        summary,
        last_referenced_at: row.last_referenced_at,
        handed_over_at: row.handed_over_at,
        pruned_at: row.pruned_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

/** POST create new server-backed session (reference assigned). */
router.post('/truck-analysis/sessions', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    await pruneStaleTruckAnalysisSessions(tenantId);
    const payload = req.body?.payload;
    if (payload == null || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload object required' });
    }
    let ref = randomTruckAnalysisRef();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const id = randomUUID();
        await query(
          `INSERT INTO truck_analysis_handovers (id, tenant_id, reference_code, status, payload_json, created_by_user_id)
           VALUES (@id, @tenantId, @ref, N'active', @payload, @uid)`,
          {
            id,
            tenantId,
            ref,
            payload: JSON.stringify(payload),
            uid: req.user.id,
          }
        );
        return res.status(201).json({ id, reference_code: ref });
      } catch (e) {
        if (String(e?.message || e).includes('UQ_truck_analysis_tenant_ref') || String(e?.number) === '2627') {
          ref = randomTruckAnalysisRef();
        } else throw e;
      }
    }
    return res.status(500).json({ error: 'Could not allocate reference' });
  } catch (err) {
    next(err);
  }
});

/** GET session by id (full payload; touches last_referenced_at). */
router.get('/truck-analysis/sessions/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    await pruneStaleTruckAnalysisSessions(tenantId);
    const { id } = req.params;
    await query(
      `UPDATE truck_analysis_handovers SET last_referenced_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const result = await query(
      `SELECT id, reference_code, status, payload_json, summary_json, handed_over_at, pruned_at, last_referenced_at, created_at, updated_at
       FROM truck_analysis_handovers WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Session not found' });
    let payload = null;
    let summary = null;
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : null;
    } catch (_) {}
    try {
      summary = row.summary_json ? JSON.parse(row.summary_json) : null;
    } catch (_) {}
    if (row.status === 'pruned' || !payload) {
      return res.status(200).json({
        session: {
          id: row.id,
          reference_code: row.reference_code,
          status: row.status,
          summary,
          payload: null,
          pruned: true,
          handed_over_at: row.handed_over_at,
          last_referenced_at: row.last_referenced_at,
        },
      });
    }
    res.json({
      session: {
        id: row.id,
        reference_code: row.reference_code,
        status: row.status,
        summary,
        payload,
        pruned: false,
        handed_over_at: row.handed_over_at,
        last_referenced_at: row.last_referenced_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH save working payload */
router.patch('/truck-analysis/sessions/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const { id } = req.params;
    const payload = req.body?.payload;
    if (payload == null || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload object required' });
    }
    const existing = await query(
      `SELECT id, status FROM truck_analysis_handovers WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const ex = existing.recordset?.[0];
    if (!ex) return res.status(404).json({ error: 'Session not found' });
    if (String(ex.status).toLowerCase() === 'pruned') {
      return res.status(400).json({ error: 'Session pruned — start a new analysis' });
    }
    await query(
      `UPDATE truck_analysis_handovers
       SET payload_json = @payload, last_referenced_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, payload: JSON.stringify(payload) }
    );
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

/** POST handover: keep payload + summary for record; mark handed_over */
router.post('/truck-analysis/sessions/:id/handover', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const { id } = req.params;
    const summary = req.body?.summary;
    if (summary == null || typeof summary !== 'object') {
      return res.status(400).json({ error: 'summary object required' });
    }
    const cur = await query(
      `SELECT payload_json FROM truck_analysis_handovers WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = cur.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Session not found' });
    await query(
      `UPDATE truck_analysis_handovers
       SET summary_json = @summary,
           status = N'handed_over',
           handed_over_at = SYSUTCDATETIME(),
           last_referenced_at = SYSUTCDATETIME(),
           updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, summary: JSON.stringify(summary) }
    );
    const refRow = (
      await query(`SELECT reference_code FROM truck_analysis_handovers WHERE id = @id`, { id })
    ).recordset?.[0];
    res.json({ handed_over: true, reference_code: refRow?.reference_code });
  } catch (err) {
    next(err);
  }
});

/** Reminder sender for Command Centre notes/reminders (called periodically from server startup). */
export async function runCommandCentreReminderNotifications() {
  if (!isEmailConfigured()) return { reminders: 0, sent: 0 };
  const due = await query(
    `SELECT TOP 100 n.id, n.note_text, n.reminder_at, u.email
     FROM cc_notes_reminders n
     INNER JOIN users u ON u.id = n.user_id
     WHERE n.reminder_at IS NOT NULL
       AND n.reminder_sent_at IS NULL
       AND ISNULL(n.is_done, 0) = 0
       AND n.reminder_at <= SYSUTCDATETIME()
       AND u.email IS NOT NULL
       AND LTRIM(RTRIM(u.email)) <> N''
     ORDER BY n.reminder_at ASC`
  );
  const rows = due.recordset || [];
  const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  let sent = 0;
  for (const row of rows) {
    const id = getRow(row, 'id');
    const to = String(getRow(row, 'email') || '').trim();
    if (!id || !to || !to.includes('@')) continue;
    const html = commandCentreReminderHtml({
      noteText: getRow(row, 'note_text'),
      reminderAt: getRow(row, 'reminder_at'),
      appUrl,
    });
    try {
      await sendEmail({ to, subject: 'Reminder: Notes & reminders', body: html, html: true });
      sent += 1;
      await query(
        `UPDATE cc_notes_reminders
         SET reminder_sent_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        { id }
      );
    } catch (err) {
      console.error('[command-centre] notes reminder email error:', err?.message || err);
    }
  }
  return { reminders: rows.length, sent };
}

export default router;
