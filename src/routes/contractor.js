import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { getCommandCentreAndRectorEmails, getCommandCentreAndRectorEmailsForRoute, getCommandCentreAndAccessManagementEmails, getAllRectorEmails, getRectorEmailsForAlertType, getRectorEmailsForAlertTypeAndRoutes, getTenantUserEmails, getContractorUserEmails, getAccessManagementEmails, isSubcontractorPortalEmail } from '../lib/emailRecipients.js';
import { newFleetDriverNotificationHtml, newFleetDriverConfirmationHtml, breakdownReportHtml, breakdownConfirmationToDriverHtml, breakdownResolvedHtml, trucksEnrolledOnRouteHtml, truckReinstatedToContractorHtml, truckReinstatedToRectorHtml, reinstatedToContractorHtml, reinstatedToRectorHtml, reinstatedToAccessManagementHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured, formatDateForEmail, formatDateForAppTz, nowForFilename, parseDateTimeInAppTz } from '../lib/emailService.js';
import { toYmdFromDbOrString } from '../lib/appTime.js';
import {
  EXCEL_TEMPLATE,
  EXCEL_INFO_FONT,
  EXCEL_INFO_LABEL_FONT,
  groupRowsByKey,
  groupRowsByContractorAndSubContractor,
  writeBannerRow,
  shouldGroupByKey,
  styleDistributionSheet,
  writeDistributionInfoBlock,
  writeListRows,
} from '../lib/distributionExcel.js';
import {
  getUserSubcontractorIds,
  getUserSubcontractorDetails,
  getSubcontractorScopeForUser,
  isSubcontractorPortalUser,
  buildTruckScopeClause,
  buildDriverSubcontractorClause,
  buildDriverMainContractorClause,
  rejectSubcontractorPortalUser,
} from '../lib/subcontractorFleet.js';
import { logFleetApplicationHistory } from '../lib/fleetApplicationHistory.js';
import {
  submitTruckChangeRequest,
  truckNeedsChangeApproval,
  mapChangeRequestRow,
  applyTruckChangeRequest,
  getActiveChangeRequest,
} from '../lib/fleetChangeRequests.js';
import logisticsFlowRouter from './logisticsFlow.js';

const router = Router();
const uploadDir = path.join(process.cwd(), 'uploads', 'incidents');
const complianceResponseUploadDir = path.join(process.cwd(), 'uploads', 'compliance-responses');
const incidentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
}).fields([
  { name: 'loading_slip', maxCount: 1 },
  { name: 'seal_1', maxCount: 1 },
  { name: 'seal_2', maxCount: 1 },
  { name: 'picture_problem', maxCount: 1 },
]);
const resolveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('offloading_slip');
const complianceRespondUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('attachments', 10);
const messageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).array('attachments', 10);

const contractorLibraryDir = path.join(process.cwd(), 'uploads', 'contractor-library');
const messageAttachmentsDir = path.join(process.cwd(), 'uploads', 'contractor-messages');
const contractorLibraryUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const dir = path.join(contractorLibraryDir, tenantId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function isCommandCentreUser(req) {
  const pageRoles = Array.isArray(req.user?.page_roles) ? req.user.page_roles : [];
  return req.user?.role === 'super_admin' || pageRoles.includes('command_centre');
}

async function listMessageAttachments(tenantId, messageIds = []) {
  if (!messageIds.length) return {};
  try {
    const placeholders = messageIds.map((_, i) => `@m${i}`).join(',');
    const params = { tenantId };
    messageIds.forEach((id, i) => { params[`m${i}`] = id; });
    const result = await query(
      `SELECT id, message_id, file_name, stored_path, file_size_bytes, mime_type, created_at
       FROM contractor_message_attachments
       WHERE tenant_id = @tenantId AND message_id IN (${placeholders})
       ORDER BY created_at ASC`,
      params
    );
    const grouped = {};
    for (const row of result.recordset || []) {
      const key = row.message_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    return grouped;
  } catch (err) {
    if (String(err?.message || '').includes('contractor_message_attachments')) return {};
    throw err;
  }
}

router.use(requireAuth);
router.use(loadUser);
// Command Centre users need read access to trucks/drivers for Report composition (shift reports)
router.use(requirePageAccess(['contractor', 'rector', 'access_management', 'command_centre']));

function requireTenant(req, res, next) {
  if (!getTenantId(req)) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });
  next();
}

router.use(requireTenant);

/** Tenant ID for current user (normalized from req.user) */
function getTenantId(req) {
  const u = req.user || {};
  return u.tenant_id ?? u.tenant_Id ?? (u.tenant_id !== undefined ? u.tenant_id : undefined);
}

async function ensureContractorRestrictionTable() {
  await query(
    `IF OBJECT_ID(N'contractor_page_restrictions', N'U') IS NULL
     BEGIN
       CREATE TABLE contractor_page_restrictions (
         tenant_id NVARCHAR(64) NOT NULL PRIMARY KEY,
         allow_truck_manual BIT NOT NULL CONSTRAINT DF_contractor_restrict_truck_manual DEFAULT (1),
         allow_truck_import BIT NOT NULL CONSTRAINT DF_contractor_restrict_truck_import DEFAULT (1),
         allow_driver_manual BIT NOT NULL CONSTRAINT DF_contractor_restrict_driver_manual DEFAULT (1),
         allow_driver_import BIT NOT NULL CONSTRAINT DF_contractor_restrict_driver_import DEFAULT (1),
         allow_enrollment BIT NOT NULL CONSTRAINT DF_contractor_restrict_enrollment DEFAULT (1),
         updated_by_user_id NVARCHAR(64) NULL,
         updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_contractor_restrict_updated_at DEFAULT (SYSUTCDATETIME())
       );
     END`
  );
}

async function getContractorPageRestrictionsForTenant(tenantId) {
  await ensureContractorRestrictionTable();
  const result = await query(
    `SELECT tenant_id, allow_truck_manual, allow_truck_import, allow_driver_manual, allow_driver_import, allow_enrollment, updated_by_user_id, updated_at
     FROM contractor_page_restrictions
     WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const row = result.recordset?.[0];
  if (!row) {
    return {
      tenant_id: tenantId,
      allow_truck_manual: true,
      allow_truck_import: true,
      allow_driver_manual: true,
      allow_driver_import: true,
      allow_enrollment: true,
      updated_by_user_id: null,
      updated_at: null,
    };
  }
  return {
    ...row,
    allow_truck_manual: !!row.allow_truck_manual,
    allow_truck_import: !!row.allow_truck_import,
    allow_driver_manual: !!row.allow_driver_manual,
    allow_driver_import: !!row.allow_driver_import,
    allow_enrollment: !!row.allow_enrollment,
  };
}

/** Normalise page_id values from DB (case / whitespace can vary). */
function pageRolesNorm(req) {
  return (req.user?.page_roles || []).map((p) => String(p || '').trim().toLowerCase()).filter(Boolean);
}

/**
 * Contractor companies explicitly linked to this user (User management → contractor checkboxes).
 * Fallback: single contractor row under tenant (legacy). If several companies exist and this is empty, [].
 */
async function getHaulierContractorIdsFromDb(req, tenantId) {
  const result = await query(
    `SELECT contractor_id FROM user_contractors WHERE user_id = @userId`,
    { userId: req.user?.id }
  );
  const rows = result.recordset || [];
  const ids = [...new Set(rows.map((r) => r.contractor_id ?? r.contractor_Id).filter(Boolean))];
  if (ids.length > 0) return ids;
  if (rows.length > 0) return [];

  const countResult = await query(
    `SELECT id FROM contractors WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const tenantContractors = countResult.recordset || [];
  if (tenantContractors.length === 0) return [];
  if (tenantContractors.length === 1) return [tenantContractors[0].id ?? tenantContractors[0].Id];
  return [];
}

/** Allowed contractor IDs for current user. Returns null = all contractors under tenant (no restriction); [] = none; [...] = only these. */
async function getAllowedContractorIds(req) {
  const tenantId = getTenantId(req);
  if (!tenantId) return null;
  try {
    // Super_admin, Command Centre, and Access Management see all contractors under the tenant.
    // Rector-only users see all (fleet per route / oversight). Users who also have the contractor page
    // role are hauliers: they must stay scoped to their company/companies via user_contractors so they
    // never see other hauliers' fleet or enrollment on the contractor portal.
    if (req.user?.role === 'super_admin') return null;
    const pr = pageRolesNorm(req);
    const hasContractorPortal = pr.includes('contractor');
    const canSeeAllContractors =
      pr.includes('command_centre') ||
      pr.includes('access_management') ||
      (pr.includes('rector') && !hasContractorPortal);
    if (canSeeAllContractors) return null;

    return getHaulierContractorIdsFromDb(req, tenantId);
  } catch (e) {
    if (e.message && (e.message.includes('user_contractors') || e.message.includes('Invalid object'))) return null;
    throw e;
  }
}

async function getRequestSubcontractorIds(req) {
  return getUserSubcontractorIds(req.user?.id);
}

async function getRequestSubcontractorScope(req) {
  return getSubcontractorScopeForUser(req.user?.id);
}

/** Resolve subcontractor company for a subcontractor-portal user creating a truck. */
async function resolveSubcontractorForCreate(req, bodySubcontractorId) {
  const subIds = await getRequestSubcontractorIds(req);
  if (!isSubcontractorPortalUser(subIds)) return null;
  const pickId = bodySubcontractorId && subIds.some((id) => String(id).toLowerCase() === String(bodySubcontractorId).toLowerCase())
    ? bodySubcontractorId
    : subIds[0];
  const r = await query(
    `SELECT id, company_name, contractor_id FROM contractor_subcontractors WHERE id = @id AND tenant_id = @tenantId`,
    { id: pickId, tenantId: getTenantId(req) }
  );
  const row = r.recordset?.[0];
  if (!row) return { error: { status: 400, message: 'Sub-contractor company not found for your account.' } };
  const id = row.id ?? row.Id;
  const companyName = row.company_name ?? row.Company_Name ?? '';
  const contractorId = row.contractor_id ?? row.Contractor_Id ?? null;
  return { subcontractorId: id, companyName: String(companyName).trim(), contractorId };
}

/**
 * enrollmentPortal=1: Contractor app “Fleet and driver enrollment” only — never tenant-wide for hauliers,
 * even if they also have Rector access. Rector UI keeps calling the same URLs without this flag.
 * Optionally narrowed by ?contractor_id= (staff may narrow when allowed === null).
 */
async function allowedContractorIdsWithOptionalNarrow(req) {
  const tenantId = getTenantId(req);
  const portalStrict = String(req.query.enrollmentPortal || '') === '1' || String(req.query.enrollmentPortal || '').toLowerCase() === 'true';
  let allowed;
  if (portalStrict) {
    if (req.user?.role === 'super_admin') {
      allowed = null;
    } else {
      const pr = pageRolesNorm(req);
      if (pr.includes('command_centre') || pr.includes('access_management')) {
        allowed = await getAllowedContractorIds(req);
      } else {
        allowed = await getHaulierContractorIdsFromDb(req, tenantId);
      }
    }
  } else {
    allowed = await getAllowedContractorIds(req);
  }
  const raw = req.query.contractor_id;
  const narrowId = raw != null && String(raw).trim() ? String(raw).trim() : null;
  if (!narrowId) return { allowed };
  const matches = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  if (allowed === null) {
    const chk = await query(`SELECT 1 AS ok FROM contractors WHERE id = @id AND tenant_id = @tenantId`, { id: narrowId, tenantId });
    if (!chk.recordset?.length) return { error: { status: 400, message: 'Invalid contractor' } };
    return { allowed: [narrowId] };
  }
  if (allowed.length === 0) return { allowed: [] };
  if (!allowed.some((id) => matches(id, narrowId))) return { error: { status: 403, message: 'Not permitted for this contractor' } };
  return { allowed: [narrowId] };
}

/** POST/DELETE route enrollment: use with ?enrollmentPortal=1 from contractor app (hauliers never get tenant-wide here). */
async function getAllowedForEnrollmentMutation(req) {
  const tenantId = getTenantId(req);
  const portalStrict = String(req.query.enrollmentPortal || '') === '1' || String(req.query.enrollmentPortal || '').toLowerCase() === 'true';
  if (!portalStrict) return getAllowedContractorIds(req);
  if (req.user?.role === 'super_admin') return null;
  const pr = pageRolesNorm(req);
  if (pr.includes('command_centre') || pr.includes('access_management')) {
    return getAllowedContractorIds(req);
  }
  return getHaulierContractorIdsFromDb(req, tenantId);
}

/** Get contractor company name by id (for emails). Returns null if not found. */
async function getContractorName(contractorId) {
  if (!contractorId) return null;
  try {
    const r = await query(`SELECT name FROM contractors WHERE id = @id`, { id: contractorId });
    const row = r.recordset?.[0];
    return row ? (row.name ?? row.Name) : null;
  } catch (_) {
    return null;
  }
}

/** Resolve effective contractor_id for create: body.contractor_id if allowed, else first allowed, else null. */
async function resolveContractorIdForCreate(req, bodyContractorId) {
  const allowed = await getAllowedContractorIds(req);
  if (allowed === null) return bodyContractorId || null;
  if (allowed.length === 0) return null;
  if (bodyContractorId && allowed.includes(bodyContractorId)) return bodyContractorId;
  if (allowed.length === 1) return allowed[0];
  return bodyContractorId && allowed.includes(bodyContractorId) ? bodyContractorId : allowed[0];
}

/** POST create a contractor (company) under current tenant. */
router.post('/contractors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const { name } = req.body || {};
    const nameTrim = name != null ? String(name).trim() : '';
    if (!nameTrim) return res.status(400).json({ error: 'Contractor name is required.' });
    const result = await query(
      `INSERT INTO contractors (tenant_id, name) OUTPUT INSERTED.id, INSERTED.tenant_id, INSERTED.name, INSERTED.created_at VALUES (@tenantId, @name)`,
      { tenantId, name: nameTrim }
    );
    const row = result.recordset[0];
    res.status(201).json({ contractor: row });
  } catch (err) {
    next(err);
  }
});

/** GET contractors list (for current tenant; scoped by user_contractors if set). */
router.get('/contractors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const allowed = await getAllowedContractorIds(req);
    let result;
    if (allowed === null) {
      result = await query(`SELECT id, tenant_id, name, created_at FROM contractors WHERE tenant_id = @tenantId ORDER BY name`, { tenantId });
    } else if (allowed.length === 0) {
      return res.json({ contractors: [] });
    } else {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      const params = { tenantId };
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
      result = await query(
        `SELECT id, tenant_id, name, created_at FROM contractors WHERE tenant_id = @tenantId AND id IN (${placeholders}) ORDER BY name`,
        params
      );
    }
    res.json({ contractors: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET contractor context: confirms session + tenant and returns company info + contractors list (for UI). */
router.get('/context', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const tenantName = req.user?.tenant_name ?? req.user?.tenant_name ?? null;
    let contractors = [];
    try {
      const allowed = await getAllowedContractorIds(req);
      if (allowed === null) {
        const r = await query(`SELECT id, name FROM contractors WHERE tenant_id = @tenantId ORDER BY name`, { tenantId });
        contractors = r.recordset || [];
      } else if (allowed.length > 0) {
        const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
        const params = { tenantId };
        allowed.forEach((id, i) => { params[`c${i}`] = id; });
        const r = await query(`SELECT id, name FROM contractors WHERE tenant_id = @tenantId AND id IN (${placeholders}) ORDER BY name`, params);
        contractors = r.recordset || [];
      }
    } catch (_) {}
    const subcontractorIds = await getRequestSubcontractorIds(req);
    const subcontractors = subcontractorIds.length > 0 ? await getUserSubcontractorDetails(req.user.id) : [];
    res.json({
      ok: true,
      tenantId,
      tenantName,
      contractors,
      isSubcontractorUser: subcontractorIds.length > 0,
      subcontractors,
    });
  } catch (err) {
    next(err);
  }
});

function canManageContractorRestrictions(req) {
  if (req.user?.role === 'super_admin') return true;
  const roles = Array.isArray(req.user?.page_roles) ? req.user.page_roles : [];
  return roles.includes('access_management');
}

function requireContractorRestrictionManager(req, res, next) {
  if (canManageContractorRestrictions(req)) return next();
  return res.status(403).json({ error: 'Contractor page restrictions can only be managed from Access Management.' });
}

router.get('/restrictions/page-controls', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const restrictions = await getContractorPageRestrictionsForTenant(tenantId);
    res.json({ restrictions });
  } catch (err) {
    next(err);
  }
});

router.patch('/restrictions/page-controls', requireContractorRestrictionManager, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const body = req.body || {};
    const allowTruckManual = body.allow_truck_manual !== false;
    const allowTruckImport = body.allow_truck_import !== false;
    const allowDriverManual = body.allow_driver_manual !== false;
    const allowDriverImport = body.allow_driver_import !== false;
    const allowEnrollment = body.allow_enrollment !== false;
    await ensureContractorRestrictionTable();
    await query(
      `MERGE contractor_page_restrictions AS target
       USING (SELECT @tenantId AS tenant_id) AS src
       ON target.tenant_id = src.tenant_id
       WHEN MATCHED THEN
         UPDATE SET
           allow_truck_manual = @allowTruckManual,
           allow_truck_import = @allowTruckImport,
           allow_driver_manual = @allowDriverManual,
           allow_driver_import = @allowDriverImport,
           allow_enrollment = @allowEnrollment,
           updated_by_user_id = @updatedBy,
           updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (tenant_id, allow_truck_manual, allow_truck_import, allow_driver_manual, allow_driver_import, allow_enrollment, updated_by_user_id)
         VALUES (@tenantId, @allowTruckManual, @allowTruckImport, @allowDriverManual, @allowDriverImport, @allowEnrollment, @updatedBy);`,
      {
        tenantId,
        allowTruckManual: allowTruckManual ? 1 : 0,
        allowTruckImport: allowTruckImport ? 1 : 0,
        allowDriverManual: allowDriverManual ? 1 : 0,
        allowDriverImport: allowDriverImport ? 1 : 0,
        allowEnrollment: allowEnrollment ? 1 : 0,
        updatedBy: req.user?.id || null,
      }
    );
    const restrictions = await getContractorPageRestrictionsForTenant(tenantId);
    res.json({ ok: true, restrictions });
  } catch (err) {
    next(err);
  }
});

function normReg(registration) {
  return String(registration || '').trim().toLowerCase();
}

// Trucks: duplicate = same tenant + same registration (and same contractor when scoped)
async function truckRegistrationExists(tenantId, registration, excludeId = null, contractorId = null) {
  const reg = normReg(registration);
  if (!reg) return false;
  const contractorClause = contractorId != null
    ? ' AND (contractor_id = @contractorId OR (contractor_id IS NULL AND @contractorId IS NULL))'
    : '';
  const result = await query(
    `SELECT 1 FROM contractor_trucks WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(registration))) = @regNorm ${excludeId ? 'AND id <> @excludeId' : ''}${contractorClause}`,
    { tenantId, regNorm: reg, ...(excludeId && { excludeId }), ...(contractorId !== undefined && { contractorId }) }
  );
  return (result.recordset?.length ?? 0) > 0;
}

// Drivers: id_number and license_number are unique per tenant (DB: UQ_ct_drivers_*), not per contractor.
async function driverDuplicateExists(tenantId, id_number, license_number, excludeId = null) {
  const idNum = id_number ? String(id_number).trim() : null;
  const licNum = license_number ? String(license_number).trim() : null;
  if (idNum) {
    const result = await query(
      `SELECT 1 FROM contractor_drivers WHERE tenant_id = @tenantId AND id_number IS NOT NULL AND LOWER(LTRIM(RTRIM(id_number))) = @idNumNorm ${excludeId ? 'AND id <> @excludeId' : ''}`,
      { tenantId, idNumNorm: idNum.toLowerCase(), ...(excludeId && { excludeId }) }
    );
    if (result.recordset?.length > 0) return true;
  }
  if (licNum) {
    const result = await query(
      `SELECT 1 FROM contractor_drivers WHERE tenant_id = @tenantId AND license_number IS NOT NULL AND LOWER(LTRIM(RTRIM(license_number))) = @licNumNorm ${excludeId ? 'AND id <> @excludeId' : ''}`,
      { tenantId, licNumNorm: licNum.toLowerCase(), ...(excludeId && { excludeId }) }
    );
    if (result.recordset?.length > 0) return true;
  }
  return false;
}

function listHandler(table, orderBy = 'created_at') {
  return async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });
      const allowed = await getAllowedContractorIds(req);
      let sql = `SELECT * FROM ${table} WHERE tenant_id = @tenantId`;
      const params = { tenantId };
      if (allowed && allowed.length === 0) {
        res.json({ [table.replace('contractor_', '')]: [] });
        return;
      }
      if (allowed && allowed.length > 0) {
        const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
        sql += ` AND contractor_id IN (${placeholders})`;
        allowed.forEach((id, i) => { params[`c${i}`] = id; });
      }
      sql += ` ORDER BY ${orderBy} DESC`;
      const result = await query(sql, params);
      const key = table.replace('contractor_', '');
      res.json({ [key]: result.recordset });
    } catch (err) {
      next(err);
    }
  };
}

/** Insert a fleet application (pending) when a truck or driver is added. */
async function createFleetApplication(tenantId, entityType, entityId, source = 'manual', submittedByUserId = null) {
  const ins = await query(
    `INSERT INTO cc_fleet_applications (tenant_id, entity_type, entity_id, source, [status])
     OUTPUT INSERTED.id
     VALUES (@tenantId, @entityType, @entityId, @source, N'pending')`,
    { tenantId, entityType, entityId, source }
  );
  const appId = ins.recordset?.[0]?.id;
  if (appId) {
    await logFleetApplicationHistory(query, {
      applicationId: appId,
      action: 'submitted',
      userId: submittedByUserId,
      toStatus: 'pending',
      details: source === 'import' ? 'Submitted via fleet import' : 'Submitted from contractor portal',
    });
  }
  return appId;
}

/** Fire-and-forget: notify Command Centre and Access Management only (never rectors) and sender when fleet/driver added or edited. contractorName = company (contractor) name. */
function notifyFleetDriverEmails(tenantName, contractorName, type, list, senderEmail, action = 'added') {
  (async () => {
    try {
      if (!sendEmail || !getCommandCentreAndAccessManagementEmails || !getAllRectorEmails) return;
      const ccAm = await getCommandCentreAndAccessManagementEmails(query);
      const rectorEmails = new Set(await getAllRectorEmails(query));
      const toList = ccAm.filter((e) => !rectorEmails.has(e));
      const label = type === 'truck' ? 'Fleet' : 'Driver';
      if (toList.length > 0) {
        const html = newFleetDriverNotificationHtml({ type, tenantName, contractorName, list, action });
        await sendEmail({ to: toList, subject: `${label} ${action}: ${Array.isArray(list) && list.length ? list.slice(0, 3).join(', ') + (list.length > 3 ? '…' : '') : type}`, body: html, html: true });
      }
      const sender = (senderEmail || '').trim();
      if (sender && !(await isSubcontractorPortalEmail(query, sender))) {
        const html = newFleetDriverConfirmationHtml({ type, list, action, contractorName });
        await sendEmail({ to: sender, subject: `${label} ${action} successfully`, body: html, html: true });
      }
    } catch (e) {
      console.error('[contractor] Fleet/driver email error:', e?.message || e);
    }
  })();
}

/**
 * Per main contractor / sub-contractor: truck totals and facility_access (integrated) counts.
 * Respects contractor allow-list and sub-contractor portal scope (?contractor_id= narrows when permitted).
 */
router.get('/fleet-truck-approval-summary', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });

    const narrow = await allowedContractorIdsWithOptionalNarrow(req);
    if (narrow.error) return res.status(narrow.error.status).json({ error: narrow.error.message });
    const allowed = narrow.allowed;
    if (allowed && allowed.length === 0) {
      return res.json({
        rows: [],
        totals: { totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 },
      });
    }

    const subScopeCtx = await getRequestSubcontractorScope(req);
    const subcontractorIds = subScopeCtx.ids;
    const subScope = buildTruckScopeClause(subScopeCtx, {
      fleetTabForMainContractor: !isSubcontractorPortalUser(subcontractorIds),
      alias: 't',
    });

    let sql = `SELECT
         t.tenant_id AS tenant_id,
         MAX(ten.name) AS tenant_name,
         c.id AS contractor_id,
         MAX(c.name) AS contractor_name,
         MAX(COALESCE(sc.company_name, NULLIF(LTRIM(RTRIM(t.sub_contractor)), ''), N'(Direct / unassigned)')) AS subcontractor_display,
         MAX(t.subcontractor_id) AS subcontractor_id,
         COUNT(*) AS total_trucks,
         SUM(CASE WHEN t.facility_access = 1 THEN 1 ELSE 0 END) AS integrated_trucks
       FROM contractor_trucks t
       INNER JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = t.tenant_id
       INNER JOIN tenants ten ON ten.id = t.tenant_id
       LEFT JOIN contractor_subcontractors sc ON sc.id = t.subcontractor_id AND sc.tenant_id = t.tenant_id
       WHERE t.tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => {
        params[`c${i}`] = id;
      });
    }
    sql += subScope.clause;
    Object.assign(params, subScope.params);
    sql += ` GROUP BY t.tenant_id, c.id,
         CASE WHEN t.subcontractor_id IS NOT NULL THEN CAST(t.subcontractor_id AS NVARCHAR(36))
              ELSE N'txt:' + LOWER(LTRIM(RTRIM(ISNULL(t.sub_contractor, N''))))
         END
       ORDER BY MAX(c.name),
         MAX(COALESCE(sc.company_name, NULLIF(LTRIM(RTRIM(t.sub_contractor)), ''), N'(Direct / unassigned)'))`;

    const result = await query(sql, params);
    const rows = (result.recordset || []).map((r) => {
      const total = Number(r.total_trucks ?? r.Total_Trucks ?? 0);
      const integrated = Number(r.integrated_trucks ?? r.Integrated_Trucks ?? 0);
      return {
        tenantId: r.tenant_id ?? r.Tenant_Id,
        tenantName: r.tenant_name ?? r.Tenant_Name ?? '',
        contractorId: r.contractor_id ?? r.Contractor_Id,
        contractorName: r.contractor_name ?? r.Contractor_Name ?? '',
        subcontractorId: r.subcontractor_id ?? r.Subcontractor_Id ?? null,
        subcontractorDisplay: r.subcontractor_display ?? r.Subcontractor_Display ?? '',
        totalTrucks: total,
        integratedTrucks: integrated,
        notIntegratedTrucks: Math.max(0, total - integrated),
      };
    });
    const totals = rows.reduce(
      (acc, row) => ({
        totalTrucks: acc.totalTrucks + row.totalTrucks,
        integratedTrucks: acc.integratedTrucks + row.integratedTrucks,
        notIntegratedTrucks: acc.notIntegratedTrucks + row.notIntegratedTrucks,
      }),
      { totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 }
    );
    res.json({ rows, totals });
  } catch (err) {
    next(err);
  }
});

// Trucks (expanded: main/sub contractor, year, ownership, fleet, trailers, tracking)
router.get('/trucks', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });
    const allowed = await getAllowedContractorIds(req);
    const subScopeCtx = await getRequestSubcontractorScope(req);
    const subcontractorIds = subScopeCtx.ids;
    const includePending = String(req.query.include_pending || '') === '1';
    let sql = `SELECT t.*, co.name AS contractor_company_name, sc.company_name AS subcontractor_company_name,
        u.full_name AS added_by_name,
        pcr.id AS pending_change_id, pcr.contractor_status AS pending_change_contractor_status,
        pcr.cc_status AS pending_change_cc_status, pcr.registration_changed AS pending_change_registration_changed,
        pcr.had_facility_access AS pending_change_had_facility_access, pcr.comment_text AS pending_change_comment,
        pcr.submitter_role AS pending_change_submitter_role, pcr.proposed_json AS pending_change_proposed_json,
        pcr.previous_json AS pending_change_previous_json
       FROM contractor_trucks t
       LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = @tenantId
       LEFT JOIN contractor_subcontractors sc ON sc.id = t.subcontractor_id
       LEFT JOIN users u ON u.id = t.added_by_user_id
       OUTER APPLY (
         SELECT TOP 1 cr.id, cr.contractor_status, cr.cc_status, cr.registration_changed, cr.had_facility_access,
           cr.comment_text, cr.submitter_role, cr.proposed_json, cr.previous_json
         FROM contractor_fleet_change_requests cr
         WHERE cr.entity_type = N'truck' AND cr.entity_id = t.id AND cr.cc_status = N'pending'
         ORDER BY cr.created_at DESC
       ) pcr
       WHERE t.tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length === 0 && !isSubcontractorPortalUser(subcontractorIds)) {
      return res.json({ trucks: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const subScope = buildTruckScopeClause(subScopeCtx, {
      fleetTabForMainContractor: !isSubcontractorPortalUser(subcontractorIds) && !includePending,
    });
    sql += subScope.clause;
    Object.assign(params, subScope.params);
    sql += ` ORDER BY t.created_at DESC`;
    let result;
    try {
      result = await query(sql, params);
    } catch (err) {
      if (err.message?.includes('contractor_fleet_change_requests')) {
        sql = sql.replace(/OUTER APPLY \([\s\S]*?\) pcr\s*/m, '');
        sql = sql.replace(/,\s*pcr\.[^\n]+/g, '');
        result = await query(sql, params);
      } else throw err;
    }
    const trucks = (result.recordset || []).map((row) => {
      const pendingChangeId = row.pending_change_id ?? row.Pending_Change_Id;
      if (!pendingChangeId) return row;
      let proposed = null;
      let previous = null;
      const proposedJson = row.pending_change_proposed_json ?? row.Pending_Change_Proposed_Json;
      const previousJson = row.pending_change_previous_json ?? row.Pending_Change_Previous_Json;
      try { proposed = JSON.parse(proposedJson || '{}'); } catch (_) {}
      try { previous = JSON.parse(previousJson || '{}'); } catch (_) {}
      return {
        ...row,
        has_pending_change: true,
        pending_change: {
          id: pendingChangeId,
          contractor_status: row.pending_change_contractor_status ?? row.Pending_Change_Contractor_Status,
          cc_status: row.pending_change_cc_status ?? row.Pending_Change_Cc_Status,
          registration_changed: !!(row.pending_change_registration_changed ?? row.Pending_Change_Registration_Changed),
          had_facility_access: !!(row.pending_change_had_facility_access ?? row.Pending_Change_Had_Facility_Access),
          comment: row.pending_change_comment ?? row.Pending_Change_Comment ?? null,
          submitter_role: row.pending_change_submitter_role ?? row.Pending_Change_Submitter_Role,
          proposed,
          previous,
        },
      };
    });
    res.json({ trucks });
  } catch (err) {
    next(err);
  }
});

router.get('/fleet-change-requests', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const subIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subIds)) {
      return res.status(403).json({ error: 'Sub-contractor users cannot list change requests.' });
    }
    const allowed = await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) return res.json({ changeRequests: [] });

    const scope = String(req.query.scope || 'contractor');
    let statusClause = `cr.cc_status = N'pending' AND cr.contractor_status = N'pending_contractor'`;
    if (scope === 'cc') statusClause = `cr.cc_status = N'pending' AND cr.contractor_status IN (N'approved_contractor', N'not_required')`;

    const params = { tenantId };
    let sql = `SELECT cr.*, t.registration AS truck_registration, sc.company_name AS subcontractor_company_name,
        c.name AS contractor_company_name
       FROM contractor_fleet_change_requests cr
       INNER JOIN contractor_trucks t ON t.id = cr.entity_id AND cr.entity_type = N'truck'
       LEFT JOIN contractors c ON c.id = t.contractor_id
       LEFT JOIN contractor_subcontractors sc ON sc.id = t.subcontractor_id
       WHERE cr.tenant_id = @tenantId AND ${statusClause}`;
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${ph})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    sql += ' ORDER BY cr.created_at DESC';
    const result = await query(sql, params);
    const changeRequests = (result.recordset || []).map((r) => ({
      ...mapChangeRequestRow(r),
      truckRegistration: r.truck_registration ?? r.Truck_Registration,
      contractorName: r.contractor_company_name ?? r.Contractor_Company_Name,
      subcontractorDisplay: r.subcontractor_company_name ?? r.Subcontractor_Company_Name,
    }));
    res.json({ changeRequests });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.json({ changeRequests: [], migrationRequired: true });
    next(err);
  }
});

router.patch('/fleet-change-requests/:id/approve-contractor', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const allowed = await getAllowedContractorIds(req);
    const chk = await query(
      `SELECT cr.*, t.contractor_id FROM contractor_fleet_change_requests cr
       INNER JOIN contractor_trucks t ON t.id = cr.entity_id
       WHERE cr.id = @id AND cr.tenant_id = @tenantId AND cr.cc_status = N'pending'`,
      { id, tenantId }
    );
    const row = chk.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Pending change not found' });
    if ((row.contractor_status ?? row.Contractor_Status) !== 'pending_contractor') {
      return res.status(400).json({ error: 'Not awaiting contractor approval' });
    }
    const cid = row.contractor_id ?? row.Contractor_Id;
    if (allowed && allowed.length > 0 && !allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    await query(
      `UPDATE contractor_fleet_change_requests
       SET contractor_status = N'approved_contractor', contractor_reviewed_by_user_id = @userId,
           contractor_reviewed_at = SYSUTCDATETIME(), contractor_decline_reason = NULL
       WHERE id = @id`,
      { id, userId: req.user?.id }
    );
    res.json({ ok: true, message: 'Change approved. It is now with Command Centre for final acceptance.' });
  } catch (err) {
    next(err);
  }
});

router.patch('/fleet-change-requests/:id/decline-contractor', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Decline reason is required' });
    if (await rejectSubcontractorPortalUser(req, res)) return;
    await query(
      `UPDATE contractor_fleet_change_requests
       SET contractor_status = N'declined_contractor', cc_status = N'declined',
           contractor_decline_reason = @reason, contractor_reviewed_by_user_id = @userId,
           contractor_reviewed_at = SYSUTCDATETIME(), cc_reviewed_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId AND contractor_status = N'pending_contractor'`,
      { id, tenantId, reason, userId: req.user?.id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/trucks', async (req, res, next) => {
  try {
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_truck_manual) {
      return res.status(403).json({ error: 'Truck manual add is restricted by Access Management.' });
    }
    const {
      main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no,
      registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password,
      commodity_type, capacity_tonnes, status, contractor_id: bodyContractorId,
    } = req.body || {};
    const subResolved = await resolveSubcontractorForCreate(req, req.body?.subcontractor_id);
    if (subResolved?.error) return res.status(subResolved.error.status).json({ error: subResolved.error.message });

    let contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    let subContractorName = sub_contractor || null;
    let subcontractorId = null;
    let contractorApprovalStatus = 'approved_contractor';
    let skipCcApplication = false;

    if (subResolved) {
      contractorId = subResolved.contractorId || contractorId;
      subContractorName = subResolved.companyName;
      subcontractorId = subResolved.subcontractorId;
      contractorApprovalStatus = 'pending_contractor';
      skipCcApplication = true;
    }

    const regTrim = registration != null ? String(registration).trim() : '';
    if (regTrim && (await truckRegistrationExists(req.user.tenant_id, regTrim, null, contractorId))) {
      return res.status(409).json({ error: 'A truck with this registration already exists under this contractor.' });
    }
    const result = await query(
      `INSERT INTO contractor_trucks (tenant_id, contractor_id, main_contractor, sub_contractor, subcontractor_id, make_model, year_model, ownership_desc, fleet_no, registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password, commodity_type, capacity_tonnes, [status], contractor_approval_status, added_by_user_id)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @main_contractor, @sub_contractor, @subcontractor_id, @make_model, @year_model, @ownership_desc, @fleet_no, @registration, @trailer_1_reg_no, @trailer_2_reg_no, @tracking_provider, @tracking_username, @tracking_password, @commodity_type, @capacity_tonnes, @status, @contractor_approval_status, @added_by_user_id)`,
      {
        tenantId: req.user.tenant_id,
        contractorId: contractorId || null,
        main_contractor: main_contractor || null,
        sub_contractor: subContractorName || null,
        subcontractor_id: subcontractorId,
        make_model: make_model || null,
        year_model: year_model || null,
        ownership_desc: ownership_desc || null,
        fleet_no: fleet_no || null,
        registration: regTrim || '',
        trailer_1_reg_no: trailer_1_reg_no || null,
        trailer_2_reg_no: trailer_2_reg_no || null,
        tracking_provider: tracking_provider || null,
        tracking_username: tracking_username || null,
        tracking_password: tracking_password || null,
        commodity_type: commodity_type || null,
        capacity_tonnes: capacity_tonnes != null ? capacity_tonnes : null,
        status: status || 'active',
        contractor_approval_status: contractorApprovalStatus,
        added_by_user_id: req.user?.id || null,
      }
    );
    const truck = result.recordset[0];
    if (truck?.id && !skipCcApplication) await createFleetApplication(req.user.tenant_id, 'truck', truck.id, 'manual', req.user?.id);
    const contractorName = await getContractorName(contractorId || truck?.contractor_id);
    if (!skipCcApplication) {
      notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'truck', [truck?.registration].filter(Boolean), req.user?.email);
    }
    res.status(201).json({ truck, pendingContractorApproval: skipCcApplication });
  } catch (err) {
    next(err);
  }
});

router.patch('/trucks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const tenantId = getTenantId(req);
    const {
      main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no,
      registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password,
      commodity_type, capacity_tonnes, status,
    } = body;
    const existingResult = await query(
      `SELECT t.* FROM contractor_trucks t WHERE t.id = @id AND t.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const existingRow = existingResult.recordset?.[0];
    if (!existingRow) return res.status(404).json({ error: 'Truck not found' });

    const subIds = await getRequestSubcontractorIds(req);
    const isSubUser = isSubcontractorPortalUser(subIds);
    if (isSubUser) {
      const scope = buildTruckScopeClause(await getRequestSubcontractorScope(req), { alias: 't' });
      const scopeCheck = await query(
        `SELECT 1 AS ok FROM contractor_trucks t WHERE t.id = @id AND t.tenant_id = @tenantId${scope.clause}`,
        { id, tenantId, ...scope.params }
      );
      if (!scopeCheck.recordset?.length) return res.status(403).json({ error: 'Not permitted for this truck' });
    }

    const regTrim = registration != null ? String(registration).trim() : null;
    if (regTrim !== null && regTrim !== '') {
      const existingContractorId = existingRow.contractor_id ?? existingRow.Contractor_Id ?? null;
      if (await truckRegistrationExists(tenantId, regTrim, id, existingContractorId)) {
        return res.status(409).json({ error: 'Another truck with this registration already exists under this contractor.' });
      }
    }

    const commentText = body.change_comment ?? body.comment ?? null;
    if (truckNeedsChangeApproval(existingRow, isSubUser)) {
      try {
        const submitted = await submitTruckChangeRequest({
          tenantId,
          truckId: id,
          existingRow,
          body,
          userId: req.user?.id,
          isSubcontractorUser: isSubUser,
          commentText,
        });
        if (submitted.skipped) {
          return res.json({ truck: existingRow, pendingChange: false });
        }
        const active = await getActiveChangeRequest('truck', id);
        return res.json({
          truck: existingRow,
          pendingChange: true,
          changeRequest: mapChangeRequestRow(active),
          message: isSubUser
            ? 'Changes submitted for contractor approval, then Command Centre review.'
            : 'Changes submitted for Command Centre approval. They stay highlighted until accepted.',
          registrationChanged: submitted.registrationChanged,
          requiresReenrollmentOnAccept: submitted.registrationChanged && submitted.hadFacilityAccess,
        });
      } catch (e) {
        if (e.message?.includes('Invalid object name')) {
          return res.status(503).json({ error: 'Change approval is not set up. Run: node scripts/run-fleet-change-requests-schema.js' });
        }
        throw e;
      }
    }

    const result = await query(
      `UPDATE contractor_trucks SET
        main_contractor = @main_contractor, sub_contractor = @sub_contractor, make_model = @make_model, year_model = @year_model,
        ownership_desc = @ownership_desc, fleet_no = @fleet_no, registration = @registration,
        trailer_1_reg_no = @trailer_1_reg_no, trailer_2_reg_no = @trailer_2_reg_no,
        tracking_provider = @tracking_provider, tracking_username = @tracking_username,
        tracking_password = CASE WHEN @tracking_password_keep = 1 THEN tracking_password ELSE @tracking_password END,
        commodity_type = @commodity_type, capacity_tonnes = @capacity_tonnes, [status] = @status,
        updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      {
        id,
        tenantId: req.user.tenant_id,
        main_contractor: main_contractor ?? null,
        sub_contractor: sub_contractor ?? null,
        make_model: make_model ?? null,
        year_model: year_model ?? null,
        ownership_desc: ownership_desc ?? null,
        fleet_no: fleet_no ?? null,
        registration: registration ?? '',
        trailer_1_reg_no: trailer_1_reg_no ?? null,
        trailer_2_reg_no: trailer_2_reg_no ?? null,
        tracking_provider: tracking_provider ?? null,
        tracking_username: tracking_username ?? null,
        tracking_password: tracking_password ?? null,
        tracking_password_keep: body.tracking_password === undefined || body.tracking_password === '' ? 1 : 0,
        commodity_type: commodity_type ?? null,
        capacity_tonnes: capacity_tonnes != null ? capacity_tonnes : null,
        status: status || 'active',
      }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Truck not found' });
    const truckRow = result.recordset[0];
    const contractorName = await getContractorName(truckRow.contractor_id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'truck', [truckRow.registration].filter(Boolean), req.user?.email, 'edited');
    res.json({ truck: truckRow });
  } catch (err) {
    next(err);
  }
});

router.post('/trucks/bulk', async (req, res, next) => {
  try {
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_truck_import) {
      return res.status(403).json({ error: 'Truck import is restricted by Access Management.' });
    }
    const { trucks: items, contractor_id: bodyContractorId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request must include a non-empty trucks array' });
    }
    const subResolved = await resolveSubcontractorForCreate(req, req.body?.subcontractor_id);
    if (subResolved?.error) return res.status(subResolved.error.status).json({ error: subResolved.error.message });

    let contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    const isSubCreate = Boolean(subResolved);
    if (subResolved?.contractorId) contractorId = subResolved.contractorId;

    const inserted = [];
    const skipped = []; // duplicate or empty registration
    for (const row of items) {
      const {
        main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no,
        registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password,
        commodity_type, capacity_tonnes, status,
      } = row;
      const regTrim = registration != null ? String(registration).trim() : '';
      if (!regTrim) continue;
      if (await truckRegistrationExists(req.user.tenant_id, regTrim, null, contractorId)) {
        skipped.push(regTrim);
        continue;
      }
      const subName = isSubCreate ? subResolved.companyName : (sub_contractor || null);
      const result = await query(
        `INSERT INTO contractor_trucks (tenant_id, contractor_id, main_contractor, sub_contractor, subcontractor_id, make_model, year_model, ownership_desc, fleet_no, registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password, commodity_type, capacity_tonnes, [status], contractor_approval_status, added_by_user_id)
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @main_contractor, @sub_contractor, @subcontractor_id, @make_model, @year_model, @ownership_desc, @fleet_no, @registration, @trailer_1_reg_no, @trailer_2_reg_no, @tracking_provider, @tracking_username, @tracking_password, @commodity_type, @capacity_tonnes, @status, @contractor_approval_status, @added_by_user_id)`,
        {
          tenantId: req.user.tenant_id,
          contractorId: contractorId || null,
          main_contractor: main_contractor || null,
          sub_contractor: subName || null,
          subcontractor_id: isSubCreate ? subResolved.subcontractorId : null,
          make_model: make_model || null,
          year_model: year_model || null,
          ownership_desc: ownership_desc || null,
          fleet_no: fleet_no || null,
          registration: regTrim,
          trailer_1_reg_no: trailer_1_reg_no || null,
          trailer_2_reg_no: trailer_2_reg_no || null,
          tracking_provider: tracking_provider || null,
          tracking_username: tracking_username || null,
          tracking_password: tracking_password || null,
          commodity_type: commodity_type || null,
          capacity_tonnes: capacity_tonnes != null ? capacity_tonnes : null,
          status: status || 'active',
          contractor_approval_status: isSubCreate ? 'pending_contractor' : 'approved_contractor',
          added_by_user_id: req.user?.id || null,
        }
      );
      const insertedRow = result.recordset[0];
      inserted.push(insertedRow);
      if (insertedRow?.id && !isSubCreate) await createFleetApplication(req.user.tenant_id, 'truck', insertedRow.id, 'import', req.user?.id);
    }
    const regList = inserted.map((t) => t.registration || '').filter(Boolean);
    if (regList.length > 0 && !isSubCreate) {
      const contractorName = await getContractorName(contractorId);
      notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'truck', regList, req.user?.email, 'added (import)');
    }
    res.status(201).json({ imported: inserted.length, skipped: skipped.length, skippedRegistrations: skipped, trucks: inserted });
  } catch (err) {
    next(err);
  }
});

// Drivers (name, surname, ID, license, cellphone, email, linked_truck_id if column exists)
router.get('/drivers', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });
    const allowed = await getAllowedContractorIds(req);
    const subScopeCtx = await getRequestSubcontractorScope(req);
    const subcontractorIds = subScopeCtx.ids;
    const includePending = String(req.query.include_pending || '') === '1';
    let whereClause = ' WHERE d.tenant_id = @tenantId';
    const params = { tenantId };
    if (allowed && allowed.length === 0 && !isSubcontractorPortalUser(subcontractorIds)) {
      return res.json({ drivers: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      whereClause += ` AND d.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const driverSubScope = buildDriverSubcontractorClause(subScopeCtx, { truckAlias: 't' });
    const driverMainScope = !isSubcontractorPortalUser(subcontractorIds) && !includePending
      ? buildDriverMainContractorClause('d')
      : { clause: '', params: {} };
    let rows = [];
    try {
      const result = await query(
        `SELECT d.*, t.registration AS linked_truck_registration, t.make_model AS linked_truck_make_model, t.fleet_no AS linked_truck_fleet_no, t.sub_contractor AS linked_truck_sub_contractor,
          sc.company_name AS subcontractor_company_name, u.full_name AS added_by_name
         FROM contractor_drivers d
         LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
         LEFT JOIN contractor_subcontractors sc ON sc.id = d.subcontractor_id
         LEFT JOIN users u ON u.id = d.added_by_user_id
         ${whereClause}${driverSubScope.clause}${driverMainScope.clause} ORDER BY d.created_at DESC`,
        { ...params, ...driverSubScope.params, ...driverMainScope.params }
      );
      rows = result.recordset || [];
    } catch (colErr) {
      const msg = colErr.message || '';
      if (msg.includes('linked_truck_id') || msg.includes('Invalid column') || msg.includes('contractor_id')
        || msg.includes('could not be bound') || msg.includes('subcontractor_id') || msg.includes('contractor_approval_status')) {
        const fallbackWhere = allowed && allowed.length > 0
          ? ` WHERE tenant_id = @tenantId AND contractor_id IN (${allowed.map((_, i) => `@c${i}`).join(',')})`
          : ' WHERE tenant_id = @tenantId';
        const fallback = await query(
          `SELECT * FROM contractor_drivers ${fallbackWhere} ORDER BY created_at DESC`,
          params
        );
        rows = fallback.recordset || [];
      } else {
        throw colErr;
      }
    }
    const drivers = rows.map((r) => ({
      ...r,
      linkedTruckId: r.linked_truck_id ?? null,
      linkedTruckRegistration: r.linked_truck_registration ?? null,
      linkedTruckMakeModel: r.linked_truck_make_model ?? null,
      linkedTruckFleetNo: r.linked_truck_fleet_no ?? null,
    }));
    res.json({ drivers });
  } catch (err) {
    next(err);
  }
});
router.post('/drivers', async (req, res, next) => {
  try {
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_driver_manual) {
      return res.status(403).json({ error: 'Driver manual add is restricted by Access Management.' });
    }
    const { full_name, name, surname, id_number, license_number, license_expiry, phone, email, contractor_id: bodyContractorId, linked_truck_id: linkedTruckId } = req.body || {};
    const subResolved = await resolveSubcontractorForCreate(req, req.body?.subcontractor_id);
    if (subResolved?.error) return res.status(subResolved.error.status).json({ error: subResolved.error.message });

    let contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    let subcontractorId = null;
    let contractorApprovalStatus = 'approved_contractor';
    let skipCcApplication = false;

    if (subResolved) {
      contractorId = subResolved.contractorId || contractorId;
      subcontractorId = subResolved.subcontractorId;
      contractorApprovalStatus = 'pending_contractor';
      skipCcApplication = true;
    }

    if (linkedTruckId) {
      const truckRow = await query(
        `SELECT id, contractor_id, subcontractor_id FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
        { id: linkedTruckId, tenantId: req.user.tenant_id }
      );
      const tr = truckRow.recordset?.[0];
      if (!tr) return res.status(400).json({ error: 'Selected truck not found.' });
      if (subResolved) {
        const tid = tr.subcontractor_id ?? tr.Subcontractor_Id;
        if (tid && String(tid).toLowerCase() !== String(subcontractorId).toLowerCase()) {
          return res.status(400).json({ error: 'Selected truck does not belong to your sub-contractor company.' });
        }
        if (!subcontractorId && tr.subcontractor_id) subcontractorId = tr.subcontractor_id;
      }
    }

    const firstName = full_name || name || '';
    const lastName = surname || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || firstName || lastName || '';
    if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, null)) {
      return res.status(409).json({ error: 'A driver with this ID number or licence number already exists.' });
    }
    const result = await query(
      `INSERT INTO contractor_drivers (tenant_id, contractor_id, full_name, surname, id_number, license_number, license_expiry, phone, email, linked_truck_id, subcontractor_id, contractor_approval_status, added_by_user_id)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @full_name, @surname, @id_number, @license_number, @license_expiry, @phone, @email, @linked_truck_id, @subcontractor_id, @contractor_approval_status, @added_by_user_id)`,
      {
        tenantId: req.user.tenant_id,
        contractorId: contractorId || null,
        full_name: fullName,
        surname: lastName || null,
        id_number: id_number || null,
        license_number: license_number || null,
        license_expiry: license_expiry || null,
        phone: phone || null,
        email: email || null,
        linked_truck_id: linkedTruckId || null,
        subcontractor_id: subcontractorId,
        contractor_approval_status: contractorApprovalStatus,
        added_by_user_id: req.user?.id || null,
      }
    );
    const driver = result.recordset[0];
    if (driver?.id && !skipCcApplication) await createFleetApplication(req.user.tenant_id, 'driver', driver.id, 'manual', req.user?.id);
    if (!skipCcApplication) {
      const driverLabel = [driver?.full_name, driver?.surname].filter(Boolean).join(' ').trim() || 'Driver';
      const contractorName = await getContractorName(contractorId || driver?.contractor_id);
      notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'driver', [driverLabel], req.user?.email);
    }
    res.status(201).json({ driver, pendingContractorApproval: skipCcApplication });
  } catch (err) {
    next(err);
  }
});

router.patch('/drivers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { full_name, name, surname, id_number, license_number, license_expiry, phone, email, linked_truck_id } = req.body || {};
    const existingDriver = await query(`SELECT contractor_id FROM contractor_drivers WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: req.user.tenant_id });
    const driverContractorId = existingDriver.recordset?.[0]?.contractor_id ?? existingDriver.recordset?.[0]?.contractor_Id;
    if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, id)) {
      return res.status(409).json({ error: 'Another driver with this ID number or licence number already exists.' });
    }
    if (linked_truck_id !== undefined && linked_truck_id !== null && linked_truck_id !== '') {
      const truckCheck = await query(
        `SELECT 1 FROM contractor_trucks WHERE id = @truckId AND tenant_id = @tenantId`,
        { truckId: linked_truck_id, tenantId: req.user.tenant_id }
      );
      if (!truckCheck.recordset?.length) {
        return res.status(400).json({ error: 'Selected truck not found or does not belong to your company.' });
      }
    }
    const existing = await query(
      `SELECT full_name FROM contractor_drivers WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: req.user.tenant_id }
    );
    const currentFullName = existing.recordset?.[0]?.full_name ?? '';
    const firstName = full_name ?? name ?? '';
    const lastName = surname ?? '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || firstName || lastName || '';
    const finalFullName = (fullName && fullName.trim()) ? fullName.trim() : currentFullName;
    const result = await query(
      `UPDATE contractor_drivers SET full_name = @full_name, surname = @surname, id_number = @id_number,
        license_number = @license_number, license_expiry = @license_expiry, phone = @phone, email = @email,
        linked_truck_id = @linked_truck_id
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      {
        id,
        tenantId: req.user.tenant_id,
        full_name: finalFullName,
        surname: lastName || null,
        id_number: id_number ?? null,
        license_number: license_number ?? null,
        license_expiry: license_expiry || null,
        phone: phone ?? null,
        email: email ?? null,
        linked_truck_id: linked_truck_id === undefined || linked_truck_id === null || linked_truck_id === '' ? null : linked_truck_id,
      }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Driver not found' });
    const driver = result.recordset[0];
    const linkedTruckResult = driver.linked_truck_id
      ? await query(
          `SELECT registration AS linked_truck_registration, make_model AS linked_truck_make_model, fleet_no AS linked_truck_fleet_no FROM contractor_trucks WHERE id = @truckId`,
          { truckId: driver.linked_truck_id }
        )
      : { recordset: [] };
    const tr = linkedTruckResult.recordset?.[0];
    const driverLabel = [driver.full_name, driver.surname].filter(Boolean).join(' ').trim() || 'Driver';
    const contractorName = await getContractorName(driver.contractor_id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'driver', [driverLabel], req.user?.email, 'edited');
    res.json({
      driver: {
        ...driver,
        linkedTruckId: driver.linked_truck_id ?? null,
        linkedTruckRegistration: tr?.linked_truck_registration ?? null,
        linkedTruckMakeModel: tr?.linked_truck_make_model ?? null,
        linkedTruckFleetNo: tr?.linked_truck_fleet_no ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/drivers/bulk', async (req, res, next) => {
  try {
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_driver_import) {
      return res.status(403).json({ error: 'Driver import is restricted by Access Management.' });
    }
    const { drivers: items, contractor_id: bodyContractorId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request must include a non-empty drivers array' });
    }
    const subResolved = await resolveSubcontractorForCreate(req, req.body?.subcontractor_id);
    if (subResolved?.error) return res.status(subResolved.error.status).json({ error: subResolved.error.message });

    let contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    const isSubCreate = Boolean(subResolved);
    if (subResolved?.contractorId) contractorId = subResolved.contractorId;

    const inserted = [];
    let skipped = 0;
    for (const row of items) {
      const { full_name, name, surname, id_number, license_number, license_expiry, phone, email } = row || {};
      const firstName = full_name || name || '';
      const lastName = surname || '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || firstName || lastName || '';
      if (!fullName.trim()) continue;
      if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, null)) {
        skipped += 1;
        continue;
      }
      const result = await query(
        `INSERT INTO contractor_drivers (tenant_id, contractor_id, full_name, surname, id_number, license_number, license_expiry, phone, email, subcontractor_id, contractor_approval_status, added_by_user_id)
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @full_name, @surname, @id_number, @license_number, @license_expiry, @phone, @email, @subcontractor_id, @contractor_approval_status, @added_by_user_id)`,
        {
          tenantId: req.user.tenant_id,
          contractorId: contractorId || null,
          full_name: fullName.trim(),
          surname: lastName || null,
          id_number: id_number || null,
          license_number: license_number || null,
          license_expiry: license_expiry || null,
          phone: phone || null,
          email: email || null,
          subcontractor_id: isSubCreate ? subResolved.subcontractorId : null,
          contractor_approval_status: isSubCreate ? 'pending_contractor' : 'approved_contractor',
          added_by_user_id: req.user?.id || null,
        }
      );
      const insertedRow = result.recordset[0];
      inserted.push(insertedRow);
      if (insertedRow?.id && !isSubCreate) await createFleetApplication(req.user.tenant_id, 'driver', insertedRow.id, 'import', req.user?.id);
    }
    const driverList = inserted.map((d) => [d.full_name, d.surname].filter(Boolean).join(' ').trim() || 'Driver').filter(Boolean);
    if (driverList.length > 0 && !isSubCreate) {
      const contractorName = await getContractorName(contractorId);
      notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'driver', driverList, req.user?.email, 'added (import)');
    }
    res.status(201).json({ imported: inserted.length, skipped, drivers: inserted });
  } catch (err) {
    next(err);
  }
});

// Incidents (breakdown/incidents) – list with normalized rows; optional filters: dateFrom, dateTo, type, resolved; scoped by contractor
router.get('/incidents', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { dateFrom, dateTo, type, resolved } = req.query || {};
    const allowed = await getAllowedContractorIds(req);
    const subScopeCtx = await getRequestSubcontractorScope(req);
    let sql = `SELECT i.* FROM contractor_incidents i WHERE i.tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length === 0 && !isSubcontractorPortalUser(subScopeCtx.ids)) {
      return res.json({ incidents: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND i.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    if (isSubcontractorPortalUser(subScopeCtx.ids)) {
      const truckScope = buildTruckScopeClause(subScopeCtx, { alias: 't' });
      const driverScope = buildDriverSubcontractorClause(subScopeCtx, { driverAlias: 'd', truckAlias: 'lt' });
      sql += ` AND (
        (i.truck_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM contractor_trucks t WHERE t.id = i.truck_id AND t.tenant_id = @tenantId${truckScope.clause}
        ))
        OR (i.driver_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM contractor_drivers d
          LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id AND lt.tenant_id = d.tenant_id
          WHERE d.id = i.driver_id AND d.tenant_id = @tenantId${driverScope.clause}
        ))
      )`;
      Object.assign(params, truckScope.params, driverScope.params);
    }
    if (dateFrom) { sql += ` AND reported_at >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND reported_at <= @dateTo`; params.dateTo = dateTo; }
    if (type && String(type).trim()) { sql += ` AND [type] = @type`; params.type = String(type).trim(); }
    if (resolved === '1' || resolved === 'true') sql += ` AND resolved_at IS NOT NULL`;
    else if (resolved === '0' || resolved === 'false') sql += ` AND resolved_at IS NULL`;
    sql += ` ORDER BY reported_at DESC`;
    const result = await query(sql, params);
    const incidents = (result.recordset || []).map(normalizeIncidentRow).filter(Boolean);
    res.json({ incidents });
  } catch (err) {
    next(err);
  }
});

// Helper: read from row with any common casing (SQL Server / driver may return different cases)
function pick(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (k && row[k] !== undefined && row[k] !== null) return row[k];
  }
  const first = keys[0];
  if (!first) return null;
  const lower = first.toLowerCase().replace(/_/g, '');
  for (const [key, val] of Object.entries(row)) {
    if (key && key.toLowerCase().replace(/_/g, '') === lower && val !== undefined && val !== null) return val;
  }
  return null;
}

function normalizeIncidentRow(row) {
  if (!row) return null;
  return {
    id: pick(row, 'id'),
    tenant_id: pick(row, 'tenant_id'),
    contractor_id: pick(row, 'contractor_id'),
    truck_id: pick(row, 'truck_id'),
    driver_id: pick(row, 'driver_id'),
    type: pick(row, 'type') != null ? String(pick(row, 'type')) : null,
    title: pick(row, 'title') != null ? String(pick(row, 'title')) : null,
    description: pick(row, 'description') != null ? String(pick(row, 'description')) : null,
    severity: pick(row, 'severity') != null ? String(pick(row, 'severity')) : null,
    actions_taken: pick(row, 'actions_taken') != null ? String(pick(row, 'actions_taken')) : null,
    reported_at: pick(row, 'reported_at'),
    resolved_at: pick(row, 'resolved_at'),
    created_at: pick(row, 'created_at'),
    location: pick(row, 'location') != null ? String(pick(row, 'location')) : null,
    route_id: pick(row, 'route_id') != null ? pick(row, 'route_id') : null,
    loading_slip_path: pick(row, 'loading_slip_path', 'loadingSlipPath') != null ? String(pick(row, 'loading_slip_path', 'loadingSlipPath')) : null,
    seal_1_path: pick(row, 'seal_1_path', 'seal_1Path', 'seal1Path') != null ? String(pick(row, 'seal_1_path', 'seal_1Path', 'seal1Path')) : null,
    seal_2_path: pick(row, 'seal_2_path', 'seal_2Path', 'seal2Path') != null ? String(pick(row, 'seal_2_path', 'seal_2Path', 'seal2Path')) : null,
    picture_problem_path: pick(row, 'picture_problem_path', 'pictureProblemPath') != null ? String(pick(row, 'picture_problem_path', 'pictureProblemPath')) : null,
    resolution_note: pick(row, 'resolution_note', 'resolutionNote') != null ? String(pick(row, 'resolution_note', 'resolutionNote')) : null,
    offloading_slip_path: pick(row, 'offloading_slip_path', 'offloadingSlipPath') != null ? String(pick(row, 'offloading_slip_path', 'offloadingSlipPath')) : null,
  };
}

router.get('/incidents/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM contractor_incidents WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: req.user.tenant_id }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Incident not found' });
    const incident = normalizeIncidentRow(result.recordset[0]);
    res.json({ incident });
  } catch (err) {
    next(err);
  }
});

router.post('/incidents', incidentUpload, async (req, res, next) => {
  try {
    const files = req.files || {};
    const loadingSlip = files.loading_slip?.[0];
    const seal1 = files.seal_1?.[0];
    const seal2 = files.seal_2?.[0];
    const pictureProblem = files.picture_problem?.[0];
    if (!loadingSlip || !seal1 || !seal2 || !pictureProblem) {
      return res.status(400).json({
        error: 'All four attachments are required: Loading slip, Seal 1, Seal 2, Picture of the problem.',
      });
    }
    let payload = {};
    const rawPayload = req.body?.payload ?? req.body?.data;
    if (rawPayload) {
      try {
        payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid payload JSON' });
      }
    }
    if (Object.keys(payload).length === 0 && req.body && typeof req.body === 'object') {
      payload = {
        truck_id: req.body.truck_id,
        driver_id: req.body.driver_id,
        type: req.body.type,
        title: req.body.title,
        description: req.body.description,
        severity: req.body.severity,
        actions_taken: req.body.actions_taken,
        reported_date: req.body.reported_date,
        reported_time: req.body.reported_time,
      };
    }
    const truck_id = (payload.truck_id && String(payload.truck_id).length > 10) ? String(payload.truck_id).trim() : null;
    const driver_id = (payload.driver_id && String(payload.driver_id).length > 10) ? String(payload.driver_id).trim() : null;
    let incidentContractorId = payload.contractor_id && String(payload.contractor_id).length > 10 ? String(payload.contractor_id).trim() : null;
    if (!incidentContractorId && truck_id) {
      const truckRow = await query(`SELECT contractor_id FROM contractor_trucks WHERE id = @truckId AND tenant_id = @tenantId`, { truckId: truck_id, tenantId: req.user.tenant_id });
      incidentContractorId = truckRow.recordset?.[0]?.contractor_id ?? truckRow.recordset?.[0]?.contractor_Id ?? null;
    }
    const type = (payload.type && String(payload.type).trim()) || 'incident';
    const title = (payload.title && String(payload.title).trim()) || 'Breakdown / Incident';
    const description = (payload.description && String(payload.description).trim()) ? String(payload.description).trim() : null;
    const severity = (payload.severity && String(payload.severity).trim()) ? String(payload.severity).trim() : null;
    const actions_taken = (payload.actions_taken && String(payload.actions_taken).trim()) ? String(payload.actions_taken).trim() : null;
    const reported_date = payload.reported_date ? String(payload.reported_date).trim() : null;
    const reported_time = (payload.reported_time && String(payload.reported_time).trim()) ? String(payload.reported_time).trim() : '00:00';
    const location = (payload.location && String(payload.location).trim()) ? String(payload.location).trim() : null;
    const route_id = (payload.route_id && String(payload.route_id).trim().length > 10) ? String(payload.route_id).trim() : null;
    let reportedAt = new Date();
    if (reported_date) {
      const parsed = parseDateTimeInAppTz(reported_date, reported_time);
      if (parsed) reportedAt = parsed;
    }
    const result = await query(
      `INSERT INTO contractor_incidents (tenant_id, contractor_id, truck_id, driver_id, [type], title, description, severity, actions_taken, reported_at, location, route_id)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractor_id, @truck_id, @driver_id, @type, @title, @description, @severity, @actions_taken, @reported_at, @location, @route_id)`,
      {
        tenantId: req.user.tenant_id,
        contractor_id: incidentContractorId || null,
        truck_id: truck_id || null,
        driver_id: driver_id || null,
        type: type || 'incident',
        title: title || 'Breakdown / Incident',
        description,
        severity,
        actions_taken,
        reported_at: reportedAt,
        location: location || null,
        route_id: route_id || null,
      }
    );
    const insertedRow = result.recordset[0];
    const incidentId = insertedRow.id;
    const tenantId = req.user.tenant_id;
    const dir = path.join(uploadDir, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = (name) => (path.extname(name) || '.bin').replace(/[^a-zA-Z0-9.]/g, '');
    const rel = (file, key) => `incidents/${tenantId}/${incidentId}_${key}${ext(file.originalname)}`;
    const full = (relative) => path.join(process.cwd(), 'uploads', relative);
    const write = (file, relative) => fs.writeFileSync(full(relative), file.buffer);
    const loadingSlipPath = rel(loadingSlip, 'loading_slip');
    const seal1Path = rel(seal1, 'seal_1');
    const seal2Path = rel(seal2, 'seal_2');
    const picturePath = rel(pictureProblem, 'picture_problem');
    write(loadingSlip, loadingSlipPath);
    write(seal1, seal1Path);
    write(seal2, seal2Path);
    write(pictureProblem, picturePath);
    await query(
      `UPDATE contractor_incidents SET loading_slip_path = @loading_slip_path, seal_1_path = @seal_1_path, seal_2_path = @seal_2_path, picture_problem_path = @picture_problem_path WHERE id = @id`,
      {
        loading_slip_path: loadingSlipPath,
        seal_1_path: seal1Path,
        seal_2_path: seal2Path,
        picture_problem_path: picturePath,
        id: incidentId,
      }
    );
    const updated = await query(
      `SELECT * FROM contractor_incidents WHERE id = @id`,
      { id: incidentId }
    );
    const incident = normalizeIncidentRow(updated.recordset?.[0]) || updated.recordset?.[0];

    // Notify Command Centre and Rector users (same as public report-breakdown flow). Ensure route rector gets email by deriving route_id from truck/driver when missing.
    (async () => {
      try {
        if (!isEmailConfigured() || !getCommandCentreAndRectorEmailsForRoute) return;
        const detailResult = await query(
          `SELECT i.id, i.route_id, i.truck_id, i.driver_id, i.type, i.title, i.description, i.severity, i.actions_taken, i.reported_at, i.location,
            tr.registration AS truck_reg, r.name AS route_name,
            d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email,
            c.name AS contractor_name, tn.name AS tenant_name
           FROM contractor_incidents i
           LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
           LEFT JOIN contractor_routes r ON r.id = i.route_id
           LEFT JOIN contractor_drivers d ON d.id = i.driver_id
           LEFT JOIN contractors c ON c.id = i.contractor_id
           LEFT JOIN tenants tn ON tn.id = i.tenant_id
           WHERE i.id = @incidentId`,
          { incidentId }
        );
        const row = detailResult.recordset?.[0];
        const driverName = row ? [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || 'Driver' : 'Driver';
        const reportedAtStr = row?.reported_at ? formatDateForEmail(row.reported_at) : formatDateForEmail(new Date());
        const contractorName = row?.contractor_name ?? row?.contractor_Name ?? null;
        const tenantName = row?.tenant_name ?? row?.tenant_name ?? null;
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
        const ccRectorEmails = await getCommandCentreAndRectorEmailsForRoute(query, routeId);
        const driverEmail = (row?.driver_email || '').trim();
        const fallbackTo = (process.env.EMAIL_USER || '').trim();
        const notificationRecipients = ccRectorEmails.length > 0 ? ccRectorEmails : (fallbackTo && fallbackTo.includes('@') ? [fallbackTo] : []);
        const mask = (e) => (e && e.includes('@') ? e.slice(0, 2) + '***@' + e.split('@')[1] : e);
        console.log('[contractor/incidents] Breakdown notification: CC/Rector=', ccRectorEmails.length, 'list=', notificationRecipients.map(mask).join(', '));
        if (notificationRecipients.length > 0) {
          const html = breakdownReportHtml({
            driverName,
            truckRegistration: row?.truck_reg || '—',
            routeName: row?.route_name || '—',
            reportedAt: reportedAtStr,
            location: row?.location || '—',
            type: row?.type || type,
            title: row?.title || title,
            description: row?.description || description,
            severity: row?.severity || severity,
            actionsTaken: row?.actions_taken || actions_taken,
            incidentId,
            contractorName: contractorName || null,
            tenantName: tenantName || null,
          });
          const subject = `Breakdown reported: ${title} – ${driverName}`;
          for (const to of notificationRecipients) {
            try {
              await sendEmail({ to, subject, body: html, html: true });
              console.log('[contractor/incidents] CC/Rector notification sent to', mask(to));
            } catch (sendErr) {
              console.error('[contractor/incidents] Failed to send to', mask(to), sendErr?.message || sendErr);
            }
          }
        }
        if (driverEmail) {
          const confirmHtml = breakdownConfirmationToDriverHtml(driverName);
          await sendEmail({ to: driverEmail, subject: 'Your breakdown was reported successfully', body: confirmHtml, html: true });
          console.log('[contractor/incidents] Driver confirmation sent to', mask(driverEmail));
        }
      } catch (e) {
        console.error('[contractor/incidents] Breakdown email error:', e?.message || e);
      }
    })();

    res.status(201).json({ incident });
  } catch (err) {
    next(err);
  }
});

// Resolve incident with resolution note; offloading slip optional (can submit later)
router.patch('/incidents/:id/resolve', resolveUpload, async (req, res, next) => {
  try {
    const { id } = req.params;
    const resolutionNote = (req.body?.resolution_note ?? '').toString().trim();
    const file = req.file;
    if (!resolutionNote) {
      return res.status(400).json({ error: 'Resolution note is required.' });
    }
    const tenantId = req.user.tenant_id;
    let offloadingSlipPath = null;
    if (file) {
      const dir = path.join(uploadDir, tenantId);
      fs.mkdirSync(dir, { recursive: true });
      const ext = (name) => (path.extname(name) || '.pdf').replace(/[^a-zA-Z0-9.]/g, '');
      offloadingSlipPath = `incidents/${tenantId}/${id}_offloading_slip${ext(file.originalname)}`;
      const fullPath = path.join(process.cwd(), 'uploads', offloadingSlipPath);
      fs.writeFileSync(fullPath, file.buffer);
    }
    const result = await query(
      `UPDATE contractor_incidents SET resolved_at = SYSUTCDATETIME(), resolution_note = @resolution_note, offloading_slip_path = @offloading_slip_path
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, resolution_note: resolutionNote || null, offloading_slip_path: offloadingSlipPath }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Incident not found' });
    const incident = normalizeIncidentRow(result.recordset[0]) || result.recordset[0];

    // Notify Command Centre, rectors, driver, and contractor (tenant users) that breakdown was resolved
    (async () => {
      try {
        if (!isEmailConfigured() || !getCommandCentreAndRectorEmailsForRoute) return;
        const detailResult = await query(
          `SELECT i.id, i.route_id, i.truck_id, i.driver_id, i.title, i.resolution_note, i.resolved_at, i.tenant_id, i.contractor_id,
                  tr.registration AS truck_registration, r.name AS route_name,
                  d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email,
                  c.name AS contractor_name
           FROM contractor_incidents i
           LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
           LEFT JOIN contractor_routes r ON r.id = i.route_id
           LEFT JOIN contractor_drivers d ON d.id = i.driver_id
           LEFT JOIN contractors c ON c.id = i.contractor_id
           WHERE i.id = @id`,
          { id }
        );
        const row = detailResult.recordset?.[0];
        if (!row) return;
        const driverName = [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || 'Driver';
        const resolvedAtStr = row.resolved_at ? formatDateForEmail(row.resolved_at) : formatDateForEmail(new Date());
        const contractorName = row.contractor_name ?? row.contractor_Name ?? null;
        let incidentContractorId = row.contractor_id ?? row.contractor_Id ?? null;
        if (!incidentContractorId && row.truck_id) {
          const tr = await query(`SELECT contractor_id FROM contractor_trucks WHERE id = @truckId`, { truckId: row.truck_id });
          const t0 = tr.recordset?.[0];
          incidentContractorId = t0?.contractor_id ?? t0?.contractor_Id ?? null;
        }
        let routeId = row.route_id ?? row.route_Id ?? null;
        if (!routeId && (row.truck_id || row.driver_id)) {
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
        const ccRectorEmails = await getCommandCentreAndRectorEmailsForRoute(query, routeId);
        const driverEmail = (row.driver_email || '').trim();
        const contractorEmails = row.tenant_id && incidentContractorId ? await getContractorUserEmails(query, row.tenant_id, incidentContractorId) : [];
        const allTo = [...new Set([...ccRectorEmails, ...(driverEmail ? [driverEmail] : []), ...contractorEmails])];
        const mask = (e) => (e && e.includes('@') ? e.slice(0, 2) + '***@' + e.split('@')[1] : e);
        console.log('[contractor/incidents] Breakdown resolved: CC/Rector=', ccRectorEmails.length, 'driver=', !!driverEmail, 'contractor=', contractorEmails.length, 'total=', allTo.length);
        if (allTo.length === 0) return;
        const html = breakdownResolvedHtml({
          ref: `INC-${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          title: row.title || 'Incident',
          driverName,
          truckRegistration: row.truck_registration || '—',
          routeName: row.route_name || '—',
          resolutionNote: row.resolution_note || resolutionNote,
          resolvedAt: resolvedAtStr,
          contractorName: contractorName || null,
        });
        const subject = `Breakdown resolved: ${row.title || 'Incident'} – ${driverName}`;
        for (const to of allTo) {
          try {
            await sendEmail({ to, subject, body: html, html: true });
            console.log('[contractor/incidents] Breakdown resolved notification sent to', mask(to));
          } catch (sendErr) {
            console.error('[contractor/incidents] Failed to send resolved notification to', mask(to), sendErr?.message || sendErr);
          }
        }
      } catch (e) {
        console.error('[contractor/incidents] Breakdown resolved email error:', e?.message || e);
      }
    })();

    res.json({ incident });
  } catch (err) {
    next(err);
  }
});

// Submit offloading slip later (incident must already be resolved)
router.patch('/incidents/:id/offloading-slip', resolveUpload, async (req, res, next) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Offloading slip file is required.' });
    }
    const tenantId = req.user.tenant_id;
    const existing = await query(
      `SELECT id, resolved_at FROM contractor_incidents WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Incident not found' });
    if (!existing.recordset[0].resolved_at) {
      return res.status(400).json({ error: 'Incident must be resolved before submitting offloading slip.' });
    }
    const dir = path.join(uploadDir, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = (name) => (path.extname(name) || '.pdf').replace(/[^a-zA-Z0-9.]/g, '');
    const relPath = `incidents/${tenantId}/${id}_offloading_slip${ext(file.originalname)}`;
    const fullPath = path.join(process.cwd(), 'uploads', relPath);
    fs.writeFileSync(fullPath, file.buffer);
    const result = await query(
      `UPDATE contractor_incidents SET offloading_slip_path = @offloading_slip_path OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, offloading_slip_path: relPath }
    );
    const incident = normalizeIncidentRow(result.recordset[0]) || result.recordset[0];
    res.json({ incident });
  } catch (err) {
    next(err);
  }
});

router.patch('/incidents/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolved } = req.body || {};
    const result = await query(
      `UPDATE contractor_incidents SET resolved_at = CASE WHEN @resolved = 1 THEN SYSUTCDATETIME() ELSE resolved_at END
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: req.user.tenant_id, resolved: resolved ? 1 : 0 }
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Incident not found' });
    res.json({ incident: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

const ATTACHMENT_TYPES = ['loading_slip', 'seal_1', 'seal_2', 'picture_problem', 'offloading_slip'];
const ATTACHMENT_COL = { loading_slip: 'loading_slip_path', seal_1: 'seal_1_path', seal_2: 'seal_2_path', picture_problem: 'picture_problem_path', offloading_slip: 'offloading_slip_path' };
router.get('/incidents/:id/attachments/:type', async (req, res, next) => {
  try {
    const { id, type } = req.params;
    if (!ATTACHMENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid attachment type' });
    const incident = await query(
      `SELECT tenant_id, loading_slip_path, seal_1_path, seal_2_path, picture_problem_path, offloading_slip_path FROM contractor_incidents WHERE id = @id`,
      { id }
    );
    if (!incident.recordset?.length || incident.recordset[0].tenant_id !== req.user.tenant_id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const filePath = incident.recordset[0][ATTACHMENT_COL[type]];
    if (!filePath) return res.status(404).json({ error: 'Attachment not found' });
    const fullPath = path.join(process.cwd(), 'uploads', filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(fullPath, { headers: { 'Content-Disposition': 'inline' } });
  } catch (err) {
    next(err);
  }
});

// Expiries
router.get('/expiries', listHandler('contractor_expiries', 'expiry_date'));
router.post('/expiries', async (req, res, next) => {
  try {
    const { item_type, item_ref, issued_date, expiry_date, description } = req.body || {};
    const result = await query(
      `INSERT INTO contractor_expiries (tenant_id, item_type, item_ref, issued_date, expiry_date, description)
       OUTPUT INSERTED.* VALUES (@tenantId, @item_type, @item_ref, @issued_date, @expiry_date, @description)`,
      {
        tenantId: req.user.tenant_id,
        item_type: item_type || 'license',
        item_ref: item_ref || null,
        issued_date: issued_date || null,
        expiry_date: expiry_date || null,
        description: description || null,
      }
    );
    res.status(201).json({ expiry: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

// --- Compliance records (inspections requiring contractor response; 8h then auto-suspend) ---
const COMPLIANCE_STATUS = { PENDING_RESPONSE: 'pending_response', RESPONDED: 'responded', AUTO_SUSPENDED: 'auto_suspended' };

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

router.get('/compliance-records', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const overdue = await query(
      `SELECT * FROM cc_compliance_inspections WHERE tenant_id = @tenantId AND [status] = @status AND response_due_at < SYSUTCDATETIME()`,
      { tenantId, status: COMPLIANCE_STATUS.PENDING_RESPONSE }
    );
    for (const row of overdue.recordset || []) {
      const rowId = getRow(row, 'id');
      await query(
        `UPDATE cc_compliance_inspections SET [status] = @status, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: rowId, status: COMPLIANCE_STATUS.AUTO_SUSPENDED }
      );
      const existing = await query(
        `SELECT 1 FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'compliance_inspection' AND entity_id = @entityId`,
        { tenantId, entityId: String(rowId) }
      );
      if (!(existing.recordset?.length > 0)) {
        const reason = `No response within 8 hours to compliance inspection. Truck: ${getRow(row, 'truck_registration') || getRow(row, 'truck_id')}. Driver: ${getRow(row, 'driver_name') || getRow(row, 'driver_id')}.`;
        await query(
          `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status]) VALUES (@tenantId, N'compliance_inspection', @entityId, @reason, N'suspended')`,
          { tenantId, entityId: String(rowId), reason }
        );
      }
    }
    const allowed = await getAllowedContractorIds(req);
    let listSql = `SELECT c.* FROM cc_compliance_inspections c WHERE c.tenant_id = @tenantId`;
    const listParams = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ records: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      listSql += ` AND (c.truck_id IN (SELECT id FROM contractor_trucks WHERE tenant_id = @tenantId AND contractor_id IN (${placeholders})) OR c.driver_id IN (SELECT id FROM contractor_drivers WHERE tenant_id = @tenantId AND contractor_id IN (${placeholders})))`;
      allowed.forEach((id, i) => { listParams[`c${i}`] = id; });
    }
    const statusFilter = req.query?.status || req.query?.statusFilter;
    if (statusFilter && String(statusFilter).trim()) {
      listSql += ` AND c.[status] = @statusFilter`;
      listParams.statusFilter = String(statusFilter).trim();
    }
    listSql += ` ORDER BY c.created_at DESC`;
    const result = await query(listSql, listParams);
    const list = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      truckId: getRow(r, 'truck_id'),
      driverId: getRow(r, 'driver_id'),
      truckRegistration: getRow(r, 'truck_registration'),
      truckMakeModel: getRow(r, 'truck_make_model'),
      driverName: getRow(r, 'driver_name'),
      driverIdNumber: getRow(r, 'driver_id_number'),
      licenseNumber: getRow(r, 'license_number'),
      recommendSuspendTruck: !!getRow(r, 'recommend_suspend_truck'),
      recommendSuspendDriver: !!getRow(r, 'recommend_suspend_driver'),
      responseDueAt: getRow(r, 'response_due_at'),
      status: getRow(r, 'status'),
      contractorRespondedAt: getRow(r, 'contractor_responded_at'),
      contractorResponseText: getRow(r, 'contractor_response_text'),
      inspectedAt: getRow(r, 'created_at'),
    }));
    const suspResult = await query(
      `SELECT id, entity_id, [status], appeal_notes FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'compliance_inspection'`,
      { tenantId }
    );
    const suspensionsByInspection = {};
    for (const s of suspResult.recordset || []) {
      const eid = getRow(s, 'entity_id');
      if (eid != null) suspensionsByInspection[String(eid)] = { id: getRow(s, 'id'), status: getRow(s, 'status'), appeal_notes: getRow(s, 'appeal_notes') };
    }
    const records = list.map((rec) => ({ ...rec, suspension: suspensionsByInspection[String(rec.id)] }));
    res.json({ records });
  } catch (err) {
    next(err);
  }
});

/** GET one compliance record (full details) for side panel */
router.get('/compliance-records/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM cc_compliance_inspections WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: req.user.tenant_id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    let driverItems = [];
    try {
      const raw = getRow(row, 'driver_items_json');
      if (raw) driverItems = JSON.parse(raw);
    } catch (_) {}
    const rowId = getRow(row, 'id');
    const suspensionResult = await query(
      `SELECT id, [status], appeal_notes FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'compliance_inspection' AND entity_id = @entityId`,
      { tenantId: req.user.tenant_id, entityId: String(rowId) }
    );
    const suspension = suspensionResult.recordset?.[0] ? { id: getRow(suspensionResult.recordset[0], 'id'), status: getRow(suspensionResult.recordset[0], 'status'), appeal_notes: getRow(suspensionResult.recordset[0], 'appeal_notes') } : null;
    const attResult = await query(
      `SELECT id, file_name, stored_path, created_at FROM compliance_response_attachments WHERE compliance_inspection_id = @id AND tenant_id = @tenantId ORDER BY created_at ASC`,
      { id: rowId, tenantId: req.user.tenant_id }
    );
    const responseAttachments = (attResult.recordset || []).map((a) => ({
      id: getRow(a, 'id'),
      fileName: getRow(a, 'file_name'),
      storedPath: getRow(a, 'stored_path'),
      createdAt: getRow(a, 'created_at'),
    }));
    res.json({
      record: {
        id: rowId,
        truckId: getRow(row, 'truck_id'),
        driverId: getRow(row, 'driver_id'),
        truckRegistration: getRow(row, 'truck_registration'),
        truckMakeModel: getRow(row, 'truck_make_model'),
        driverName: getRow(row, 'driver_name'),
        driverIdNumber: getRow(row, 'driver_id_number'),
        licenseNumber: getRow(row, 'license_number'),
        gpsStatus: getRow(row, 'gps_status'),
        gpsComment: getRow(row, 'gps_comment'),
        cameraStatus: getRow(row, 'camera_status'),
        cameraComment: getRow(row, 'camera_comment'),
        cameraVisibility: getRow(row, 'camera_visibility'),
        cameraVisibilityComment: getRow(row, 'camera_visibility_comment'),
        driverItems,
        recommendSuspendTruck: !!getRow(row, 'recommend_suspend_truck'),
        recommendSuspendDriver: !!getRow(row, 'recommend_suspend_driver'),
        responseDueAt: getRow(row, 'response_due_at'),
        status: getRow(row, 'status'),
        contractorRespondedAt: getRow(row, 'contractor_responded_at'),
        contractorResponseText: getRow(row, 'contractor_response_text'),
        responseAttachments,
        inspectorReplyText: getRow(row, 'inspector_reply_text'),
        inspectorRepliedAt: getRow(row, 'inspector_replied_at'),
        inspectedAt: getRow(row, 'created_at'),
        suspension,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/compliance-records/:id/respond', (req, res, next) => {
  if (req.is('multipart/form-data')) return complianceRespondUpload(req, res, next);
  next();
}, async (req, res, next) => {
  try {
    const { id } = req.params;
    const responseText = (req.body?.responseText != null ? String(req.body.responseText) : req.body?.responseText) ?? '';
    const result = await query(
      `UPDATE cc_compliance_inspections SET [status] = @status, contractor_responded_at = SYSUTCDATETIME(), contractor_response_text = @responseText, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId AND [status] = @pending`,
      { id, tenantId: req.user.tenant_id, status: COMPLIANCE_STATUS.RESPONDED, responseText, pending: COMPLIANCE_STATUS.PENDING_RESPONSE }
    );
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Record not found or already responded' });
    const files = req.files || [];
    const tenantId = req.user.tenant_id;
    if (files.length > 0) {
      const dir = path.join(complianceResponseUploadDir, tenantId, id);
      fs.mkdirSync(dir, { recursive: true });
      const ext = (name) => (path.extname(name) || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      const sanitize = (name) => (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base = sanitize(path.basename(file.originalname || 'file', path.extname(file.originalname || '')));
        const storedPath = `compliance-responses/${tenantId}/${id}/${base}_${Date.now()}_${i}${ext(file.originalname)}`;
        const fullPath = path.join(process.cwd(), 'uploads', storedPath.split('/').join(path.sep));
        fs.writeFileSync(fullPath, file.buffer);
        await query(
          `INSERT INTO compliance_response_attachments (compliance_inspection_id, tenant_id, file_name, stored_path) VALUES (@inspectionId, @tenantId, @fileName, @storedPath)`,
          { inspectionId: id, tenantId, fileName: file.originalname || storedPath, storedPath }
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET compliance response attachment file (for download/view) */
router.get('/compliance-records/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const { id, attachmentId } = req.params;
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT a.file_name, a.stored_path FROM compliance_response_attachments a
       WHERE a.id = @attachmentId AND a.compliance_inspection_id = @id AND a.tenant_id = @tenantId`,
      { attachmentId, id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const fullPath = path.join(process.cwd(), 'uploads', row.stored_path.split('/').join(path.sep));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `inline; filename="${(row.file_name || 'attachment').replace(/"/g, '%22')}"`);
    res.sendFile(fullPath);
  } catch (err) {
    next(err);
  }
});

// Suspensions and appeals; optional filters: entity_type, status; scoped by contractor
router.get('/suspensions', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { entity_type, status } = req.query || {};
    const allowed = await getAllowedContractorIds(req);
    let sql = `SELECT * FROM contractor_suspensions WHERE tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ suspensions: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    if (entity_type && String(entity_type).trim()) { sql += ` AND entity_type = @entity_type`; params.entity_type = String(entity_type).trim(); }
    if (status && String(status).trim()) { sql += ` AND [status] = @status`; params.status = String(status).trim(); }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, params);
    res.json({ suspensions: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET reinstatement requests (under_appeal suspensions with entity labels). For Access Management tab. */
router.get('/reinstatement-requests', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT s.id, s.tenant_id, s.entity_type, s.entity_id, s.reason, s.[status], s.appeal_notes, s.is_permanent, s.suspension_ends_at, s.created_at, s.updated_at,
        t.name AS tenant_name,
        tr.registration AS truck_registration,
        tr.make_model AS truck_make_model,
        dr.full_name AS driver_name,
        dr.license_number AS driver_license
       FROM contractor_suspensions s
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.tenant_id = s.tenant_id AND tr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'truck'
       LEFT JOIN contractor_drivers dr ON dr.tenant_id = s.tenant_id AND dr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'driver'
       WHERE s.[status] = N'under_appeal' AND s.tenant_id = @tenantId
       ORDER BY s.created_at DESC`,
      { tenantId }
    );
    const rows = (result.recordset || []).map((r) => ({
      ...r,
      entity_label: getRow(r, 'entity_type') === 'truck' ? (getRow(r, 'truck_registration') || `Truck #${getRow(r, 'entity_id')}`) : (getRow(r, 'driver_name') || `Driver #${getRow(r, 'entity_id')}`),
    }));
    res.json({ requests: rows });
  } catch (err) {
    next(err);
  }
});

/** GET reinstatement history (reinstated suspensions with entity labels). For Access Management – shows CC/auto/AM reinstatements. */
router.get('/reinstatement-history', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT s.id, s.tenant_id, s.entity_type, s.entity_id, s.reason, s.[status], s.appeal_notes, s.is_permanent, s.suspension_ends_at, s.created_at, s.updated_at,
        t.name AS tenant_name,
        tr.registration AS truck_registration,
        tr.make_model AS truck_make_model,
        dr.full_name AS driver_name,
        dr.license_number AS driver_license
       FROM contractor_suspensions s
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.tenant_id = s.tenant_id AND tr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'truck'
       LEFT JOIN contractor_drivers dr ON dr.tenant_id = s.tenant_id AND dr.id = TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) AND s.entity_type = N'driver'
       WHERE s.[status] = N'reinstated' AND s.tenant_id = @tenantId
       ORDER BY s.updated_at DESC`,
      { tenantId }
    );
    const rows = (result.recordset || []).map((r) => ({
      ...r,
      entity_label: getRow(r, 'entity_type') === 'truck' ? (getRow(r, 'truck_registration') || `Truck #${getRow(r, 'entity_id')}`) : (getRow(r, 'driver_name') || `Driver #${getRow(r, 'entity_id')}`),
    }));
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/suspensions', async (req, res, next) => {
  try {
    const { entity_type, entity_id, reason, status, appeal_notes, is_permanent, duration_days } = req.body || {};
    const contractorId = await resolveContractorIdForCreate(req, req.body?.contractor_id);
    const permanent = is_permanent !== false && is_permanent !== 'false';
    const durationDays = duration_days != null ? parseInt(duration_days, 10) : null;
    const effectivePermanent = permanent && (!durationDays || durationDays < 1);
    let result;
    if (effectivePermanent) {
      result = await query(
        `INSERT INTO contractor_suspensions (tenant_id, contractor_id, entity_type, entity_id, reason, [status], appeal_notes, is_permanent, suspension_ends_at)
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @entity_type, @entity_id, @reason, @status, @appeal_notes, 1, NULL)`,
        {
          tenantId: req.user.tenant_id,
          contractorId: contractorId ?? null,
          entity_type: entity_type || 'driver',
          entity_id: entity_id || null,
          reason: reason || '',
          status: status || 'suspended',
          appeal_notes: appeal_notes || null,
        }
      );
    } else {
      const days = Math.min(Math.max(1, durationDays || 7), 3650);
      result = await query(
        `INSERT INTO contractor_suspensions (tenant_id, contractor_id, entity_type, entity_id, reason, [status], appeal_notes, is_permanent, suspension_ends_at)
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @entity_type, @entity_id, @reason, @status, @appeal_notes, 0, DATEADD(day, @days, SYSUTCDATETIME()))`,
        {
          tenantId: req.user.tenant_id,
          contractorId: contractorId ?? null,
          entity_type: entity_type || 'driver',
          entity_id: entity_id || null,
          reason: reason || '',
          status: status || 'suspended',
          appeal_notes: appeal_notes || null,
          days,
        }
      );
    }
    res.status(201).json({ suspension: result.recordset[0] });
  } catch (err) {
    if (err.message && err.message.includes('contractor_id')) {
      const fallbackPayload = { tenantId: req.user.tenant_id, entity_type: req.body?.entity_type || 'driver', entity_id: req.body?.entity_id || null, reason: req.body?.reason || '', status: req.body?.status || 'suspended', appeal_notes: req.body?.appeal_notes || null };
      const permanent = req.body?.is_permanent !== false && req.body?.is_permanent !== 'false';
      const durationDays = req.body?.duration_days != null ? parseInt(req.body.duration_days, 10) : null;
      let fallbackResult;
      if (permanent && (!durationDays || durationDays < 1)) {
        fallbackResult = await query(
          `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], appeal_notes, is_permanent, suspension_ends_at)
           OUTPUT INSERTED.* VALUES (@tenantId, @entity_type, @entity_id, @reason, @status, @appeal_notes, 1, NULL)`,
          fallbackPayload
        );
      } else {
        const days = Math.min(Math.max(1, durationDays || 7), 3650);
        fallbackResult = await query(
          `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], appeal_notes, is_permanent, suspension_ends_at)
           OUTPUT INSERTED.* VALUES (@tenantId, @entity_type, @entity_id, @reason, @status, @appeal_notes, 0, DATEADD(day, @days, SYSUTCDATETIME()))`,
          { ...fallbackPayload, days }
        );
      }
      return res.status(201).json({ suspension: fallbackResult.recordset[0] });
    }
    next(err);
  }
});
router.patch('/suspensions/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { status, appeal_notes } = req.body || {};
    const updates = [];
    const params = { id, tenantId };
    if (status !== undefined) { updates.push('[status] = @status'); params.status = status; }
    if (appeal_notes !== undefined) { updates.push('appeal_notes = @appeal_notes'); params.appeal_notes = appeal_notes; }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    const statusNorm = status != null ? String(status).toLowerCase().trim() : '';
    const isReinstating = statusNorm === 'reinstated' || statusNorm === 'lifted';
    updates.push('updated_at = SYSUTCDATETIME()');
    const result = await query(
      `UPDATE contractor_suspensions SET ${updates.join(', ')} OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    if (!result.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const updated = result.recordset[0];
    const entityType = String(getRow(updated, 'entity_type') || '').toLowerCase();
    const entityId = getRow(updated, 'entity_id');
    if (isReinstating && (entityType === 'truck' || entityType === 'driver') && entityId && isEmailConfigured?.() && sendEmail && (getContractorUserEmails || getTenantUserEmails) && getCommandCentreAndAccessManagementEmails && getRectorEmailsForAlertTypeAndRoutes && getAccessManagementEmails) {
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
        const reinstatedBy = req.user?.full_name || req.user?.email || 'Access Management';
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
        console.warn('[contractor] reinstate email failed:', e?.message || e);
      }
    }
    res.json({ suspension: updated });
  } catch (err) {
    next(err);
  }
});

// --- Fleet and driver enrollment (routes; only approved, non-suspended) ---
/** GET routes for tenant (includes capacity, max_tons, route_expiration for Access management) */
router.get('/routes', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT id, tenant_id, name, [order], starting_point, destination, capacity, max_tons, route_expiration, created_at, updated_at FROM contractor_routes WHERE tenant_id = @tenantId ORDER BY [order] ASC, name ASC`,
      { tenantId }
    );
    res.json({ routes: result.recordset });
  } catch (err) {
    next(err);
  }
});

/** POST create route – only Access Management. Routes are created in Access Management and appear here for enrollment. */
router.post('/routes', async (req, res, next) => {
  try {
    const pageRoles = req.user?.page_roles || [];
    if (!pageRoles.includes('access_management')) {
      return res.status(403).json({ error: 'Only Access Management can create routes. Create routes in Access Management; they will appear here for enrollment.' });
    }
    const tenantId = getTenantId(req);
    const { name, starting_point, destination, capacity, max_tons, route_expiration } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Route name is required' });
    const maxOrder = await query(
      `SELECT ISNULL(MAX([order]), 0) + 1 AS nextOrder FROM contractor_routes WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const order = (maxOrder.recordset?.[0]?.nextOrder ?? 1);
    const startPt = starting_point ? String(starting_point).trim() : null;
    const dest = destination ? String(destination).trim() : null;
    const cap = capacity != null && Number.isInteger(Number(capacity)) ? Number(capacity) : null;
    const tons = max_tons != null && !Number.isNaN(Number(max_tons)) ? Number(max_tons) : null;
    const exp = route_expiration ? new Date(route_expiration) : null;
    const expStr = exp && !Number.isNaN(exp.getTime()) ? toYmdFromDbOrString(exp) : null;
    const result = await query(
      `INSERT INTO contractor_routes (tenant_id, name, [order], starting_point, destination, capacity, max_tons, route_expiration) OUTPUT INSERTED.* VALUES (@tenantId, @name, @order, @starting_point, @destination, @capacity, @max_tons, @route_expiration)`,
      { tenantId, name: String(name).trim(), order, starting_point: startPt, destination: dest, capacity: cap, max_tons: tons, route_expiration: expStr }
    );
    res.status(201).json({ route: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** PATCH route – only Access Management. */
router.patch('/routes/:id', async (req, res, next) => {
  try {
    const pageRoles = req.user?.page_roles || [];
    if (!pageRoles.includes('access_management')) {
      return res.status(403).json({ error: 'Only Access Management can update routes.' });
    }
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { name, order, starting_point, destination, capacity, max_tons, route_expiration } = req.body || {};
    const updates = [];
    const params = { id, tenantId };
    if (name !== undefined && String(name).trim()) {
      updates.push('name = @name');
      params.name = String(name).trim();
    }
    if (order !== undefined && Number.isInteger(Number(order))) {
      updates.push('[order] = @order');
      params.order = Number(order);
    }
    if (starting_point !== undefined) {
      updates.push('starting_point = @starting_point');
      params.starting_point = starting_point ? String(starting_point).trim() : null;
    }
    if (destination !== undefined) {
      updates.push('destination = @destination');
      params.destination = destination ? String(destination).trim() : null;
    }
    if (capacity !== undefined) {
      updates.push('capacity = @capacity');
      params.capacity = capacity != null && Number.isInteger(Number(capacity)) ? Number(capacity) : null;
    }
    if (max_tons !== undefined) {
      updates.push('max_tons = @max_tons');
      params.max_tons = max_tons != null && !Number.isNaN(Number(max_tons)) ? Number(max_tons) : null;
    }
    if (route_expiration !== undefined) {
      updates.push('route_expiration = @route_expiration');
      const exp = route_expiration ? new Date(route_expiration) : null;
      params.route_expiration = exp && !Number.isNaN(exp.getTime()) ? toYmdFromDbOrString(exp) : null;
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(
      `UPDATE contractor_routes SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const getResult = await query(`SELECT * FROM contractor_routes WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!getResult.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ route: getResult.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE route – only Access Management. */
router.delete('/routes/:id', async (req, res, next) => {
  try {
    const pageRoles = req.user?.page_roles || [];
    if (!pageRoles.includes('access_management')) {
      return res.status(403).json({ error: 'Only Access Management can delete routes.' });
    }
    const tenantId = getTenantId(req);
    const { id } = req.params;
    await query(`DELETE FROM contractor_routes WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Trucks that are approved (facility_access=1) and not currently suspended. Scoped by company (contractor_id) when user has contractor scope. */
router.get('/enrollment/approved-trucks', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    let sql = `SELECT t.id, t.registration, t.make_model, t.fleet_no, t.facility_access, t.created_at, t.updated_at
       FROM contractor_trucks t
       WHERE t.tenant_id = @tenantId AND t.facility_access = 1
         AND NOT EXISTS (
           SELECT 1 FROM contractor_suspensions s
           WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50))
             AND s.[status] IN (N'suspended', N'under_appeal')
         )`;
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ trucks: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const subScopeCtx = await getRequestSubcontractorScope(req);
    const truckScope = buildTruckScopeClause(subScopeCtx, {
      fleetTabForMainContractor: !isSubcontractorPortalUser(subScopeCtx.ids),
      alias: 't',
    });
    sql += truckScope.clause;
    Object.assign(params, truckScope.params);
    sql += ` ORDER BY t.registration ASC`;
    const result = await query(sql, params);
    res.json({ trucks: result.recordset });
  } catch (err) {
    next(err);
  }
});

/** Drivers that are approved and not suspended. Scoped by company (contractor_id) when user has contractor scope. */
router.get('/enrollment/approved-drivers', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    let sql = `SELECT d.id, d.full_name, d.license_number, d.phone, d.facility_access
       FROM contractor_drivers d
       LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId AND d.facility_access = 1
         AND NOT EXISTS (
           SELECT 1 FROM contractor_suspensions s
           WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50))
             AND s.[status] IN (N'suspended', N'under_appeal')
         )`;
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ drivers: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND d.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const subScopeCtx = await getRequestSubcontractorScope(req);
    const driverSub = buildDriverSubcontractorClause(subScopeCtx, { truckAlias: 't' });
    const driverMain = !isSubcontractorPortalUser(subScopeCtx.ids) ? buildDriverMainContractorClause('d') : { clause: '', params: {} };
    sql += driverSub.clause + driverMain.clause;
    Object.assign(params, driverSub.params, driverMain.params);
    sql += ` ORDER BY d.full_name ASC`;
    const result = await query(sql, params);
    res.json({ drivers: result.recordset });
  } catch (err) {
    next(err);
  }
});

/** GET routes that a truck is enrolled on (for incident form: auto-populate route when truck selected) */
router.get('/routes/enrolled-by-truck/:truckId', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { truckId } = req.params;
    const allowed = await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) {
      return res.json({ routes: [] });
    }
    const params = { truckId, tenantId };
    let truckScope = '';
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@eb${i}`).join(',');
      allowed.forEach((cid, i) => { params[`eb${i}`] = cid; });
      truckScope = ` AND EXISTS (
        SELECT 1 FROM contractor_trucks t
        WHERE t.id = @truckId AND t.tenant_id = @tenantId AND t.contractor_id IN (${ph})
      )`;
    }
    const result = await query(
      `SELECT r.id, r.name FROM contractor_routes r
       INNER JOIN contractor_route_trucks rt ON rt.route_id = r.id AND rt.truck_id = @truckId
       WHERE r.tenant_id = @tenantId${truckScope} ORDER BY r.name`,
      params
    );
    res.json({ routes: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET single route with enrolled trucks and drivers. Tenant-scoped; trucks/drivers filtered by company when user is contractor-scoped (not Access Management / Rector / Command Centre). */
router.get('/routes/:id', async (req, res, next) => {
  try {
    const portalStrict = String(req.query.enrollmentPortal || '') === '1' || String(req.query.enrollmentPortal || '').toLowerCase() === 'true';
    if (portalStrict && (await rejectSubcontractorPortalUser(req, res))) return;
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    const routeResult = await query(
      `SELECT * FROM contractor_routes WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    if (!routeResult.recordset?.[0]) return res.status(404).json({ error: 'Route not found' });
    const route = routeResult.recordset[0];
    if (allowed && allowed.length === 0) {
      return res.json({ route, trucks: [], drivers: [] });
    }
    const trucksParams = { id, tenantId };
    let trucksSql = `SELECT rt.truck_id, t.registration, t.make_model, t.fleet_no, t.contractor_id,
       t.main_contractor, t.sub_contractor,
       co.name AS contractor_company_name
       FROM contractor_route_trucks rt
       JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId
       LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = @tenantId
       WHERE rt.route_id = @id`;
    if (allowed && allowed.length > 0) {
      const tPlaceholders = allowed.map((_, i) => `@tc${i}`).join(',');
      trucksSql += ` AND t.contractor_id IN (${tPlaceholders})`;
      allowed.forEach((cid, i) => { trucksParams[`tc${i}`] = cid; });
    }
    trucksSql += ` ORDER BY t.registration`;
    const driversParams = { id, tenantId };
    let driversSql = `SELECT rd.driver_id, d.full_name, d.license_number, d.contractor_id
       FROM contractor_route_drivers rd
       JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId
       WHERE rd.route_id = @id`;
    if (allowed && allowed.length > 0) {
      const dPlaceholders = allowed.map((_, i) => `@dc${i}`).join(',');
      driversSql += ` AND d.contractor_id IN (${dPlaceholders})`;
      allowed.forEach((cid, i) => { driversParams[`dc${i}`] = cid; });
    }
    driversSql += ` ORDER BY d.full_name`;
    const trucksResult = await query(trucksSql, trucksParams);
    const driversResult = await query(driversSql, driversParams);
    res.json({
      route,
      trucks: trucksResult.recordset,
      drivers: driversResult.recordset,
    });
  } catch (err) {
    next(err);
  }
});

/** POST enroll trucks on route (body: { truckIds: [] }). Only trucks belonging to the user's company (when scoped) can be enrolled. */
router.post('/routes/:id/trucks', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_enrollment) {
      return res.status(403).json({ error: 'Enrollment actions are restricted by Access Management.' });
    }
    const tenantId = getTenantId(req);
    const { id: routeId } = req.params;
    const { truckIds } = req.body || {};
    const ids = Array.isArray(truckIds) ? truckIds.filter((x) => x) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'truckIds array is required' });
    const routeRow = await query(`SELECT id, name FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`, { routeId, tenantId });
    if (!routeRow.recordset?.length) return res.status(404).json({ error: 'Route not found' });
    const routeName = routeRow.recordset[0].name;
    const allowed = await getAllowedForEnrollmentMutation(req);
    const addedTruckIds = [];
    for (const truckId of ids) {
      let truckSql = `SELECT 1 FROM contractor_trucks t
         WHERE t.id = @truckId AND t.tenant_id = @tenantId AND t.facility_access = 1
           AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))`;
      const truckParams = { truckId, tenantId };
      if (allowed && allowed.length > 0) {
        const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
        truckSql += ` AND t.contractor_id IN (${placeholders})`;
        allowed.forEach((id, i) => { truckParams[`c${i}`] = id; });
      }
      const truckOk = await query(truckSql, truckParams);
      if (!truckOk.recordset?.length) continue;
      try {
        await query(
          `INSERT INTO contractor_route_trucks (route_id, truck_id) VALUES (@routeId, @truckId)`,
          { routeId, truckId }
        );
        addedTruckIds.push(truckId);
      } catch (e) {
        if (e.number !== 2627) throw e; // unique violation = already enrolled, ignore
      }
    }
    if (addedTruckIds.length > 0 && isEmailConfigured?.() && getAccessManagementEmails && trucksEnrolledOnRouteHtml) {
      try {
        const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
        const placeholders = addedTruckIds.map((_, i) => `@id${i}`).join(',');
        const regResult = await query(
          `SELECT registration FROM contractor_trucks WHERE id IN (${placeholders})`,
          Object.fromEntries(addedTruckIds.map((id, i) => [`id${i}`, id]))
        );
        const registrations = (regResult.recordset || []).map((r) => r.registration || '').filter(Boolean);
        const toList = await getAccessManagementEmails(query);
        if (toList.length) {
          const html = trucksEnrolledOnRouteHtml({
            tenantName,
            routeName,
            registrations: registrations.length ? registrations : addedTruckIds.map(String),
            appUrl: process.env.APP_URL || '',
          });
          await sendEmail({
            to: toList,
            subject: `Trucks enrolled on route: ${routeName} (${tenantName})`,
            body: html,
            html: true,
          });
        }
      } catch (e) {
        console.warn('[contractor] trucks-enrolled email failed:', e?.message || e);
      }
    }
    res.json({ ok: true, added: addedTruckIds.length });
  } catch (err) {
    next(err);
  }
});

/** DELETE unenroll truck from route */
router.delete('/routes/:id/trucks/:truckId', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_enrollment) {
      return res.status(403).json({ error: 'Enrollment actions are restricted by Access Management.' });
    }
    const tenantId = getTenantId(req);
    const { id: routeId, truckId } = req.params;
    const allowed = await getAllowedForEnrollmentMutation(req);
    if (allowed && allowed.length === 0) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    const params = { routeId, truckId, tenantId };
    let sql;
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@uc${i}`).join(',');
      allowed.forEach((cid, i) => { params[`uc${i}`] = cid; });
      sql = `DELETE rt FROM contractor_route_trucks rt
        INNER JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId
        WHERE rt.route_id = @routeId AND rt.truck_id = @truckId
          AND rt.route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)
          AND t.contractor_id IN (${ph})`;
    } else {
      sql = `DELETE FROM contractor_route_trucks WHERE route_id = @routeId AND truck_id = @truckId
        AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`;
    }
    const result = await query(sql, params);
    if (allowed && allowed.length > 0 && (result.rowsAffected?.[0] ?? 0) === 0) {
      return res.status(404).json({ error: 'Enrollment not found or not permitted' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST enroll drivers on route (body: { driverIds: [] }). Only drivers belonging to the user's company (when scoped) can be enrolled. */
router.post('/routes/:id/drivers', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_enrollment) {
      return res.status(403).json({ error: 'Enrollment actions are restricted by Access Management.' });
    }
    const tenantId = getTenantId(req);
    const { id: routeId } = req.params;
    const { driverIds } = req.body || {};
    const ids = Array.isArray(driverIds) ? driverIds.filter((x) => x) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'driverIds array is required' });
    const routeCheck = await query(`SELECT 1 FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`, { routeId, tenantId });
    if (!routeCheck.recordset?.length) return res.status(404).json({ error: 'Route not found' });
    const allowed = await getAllowedForEnrollmentMutation(req);
    let added = 0;
    for (const driverId of ids) {
      let driverSql = `SELECT 1 FROM contractor_drivers d
         WHERE d.id = @driverId AND d.tenant_id = @tenantId AND d.facility_access = 1
           AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))`;
      const driverParams = { driverId, tenantId };
      if (allowed && allowed.length > 0) {
        const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
        driverSql += ` AND d.contractor_id IN (${placeholders})`;
        allowed.forEach((id, i) => { driverParams[`c${i}`] = id; });
      }
      const driverOk = await query(driverSql, driverParams);
      if (!driverOk.recordset?.length) continue;
      try {
        await query(
          `INSERT INTO contractor_route_drivers (route_id, driver_id) VALUES (@routeId, @driverId)`,
          { routeId, driverId }
        );
        added++;
      } catch (e) {
        if (e.number !== 2627) throw e;
      }
    }
    res.json({ ok: true, added });
  } catch (err) {
    next(err);
  }
});

/** DELETE unenroll driver from route */
router.delete('/routes/:id/drivers/:driverId', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const restrictions = await getContractorPageRestrictionsForTenant(getTenantId(req));
    if (!restrictions.allow_enrollment) {
      return res.status(403).json({ error: 'Enrollment actions are restricted by Access Management.' });
    }
    const tenantId = getTenantId(req);
    const { id: routeId, driverId } = req.params;
    const allowed = await getAllowedForEnrollmentMutation(req);
    if (allowed && allowed.length === 0) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    const params = { routeId, driverId, tenantId };
    let sql;
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@ud${i}`).join(',');
      allowed.forEach((cid, i) => { params[`ud${i}`] = cid; });
      sql = `DELETE rd FROM contractor_route_drivers rd
        INNER JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId
        WHERE rd.route_id = @routeId AND rd.driver_id = @driverId
          AND rd.route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)
          AND d.contractor_id IN (${ph})`;
    } else {
      sql = `DELETE FROM contractor_route_drivers WHERE route_id = @routeId AND driver_id = @driverId
        AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`;
    }
    const result = await query(sql, params);
    if (allowed && allowed.length > 0 && (result.rowsAffected?.[0] ?? 0) === 0) {
      return res.status(404).json({ error: 'Enrollment not found or not permitted' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET fleet list CSV/Excel/PDF (approved trucks; optional ?routeId= or ?routeIds=id1,id2, ?format=excel|pdf). Scoped by company when user has contractor scope. */
router.get('/enrollment/fleet-list', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    const fmt = String(req.query.format || '').toLowerCase();
    const wantExcel = fmt === 'excel';
    const wantPdf = fmt === 'pdf';
    const selectedContractorId = req.query.contractor_id || null;
    let selectedContractorName = null;
    if (selectedContractorId) {
      const c = await query(`SELECT TOP 1 name FROM contractors WHERE id = @id`, { id: selectedContractorId });
      selectedContractorName = c.recordset?.[0]?.name || null;
    } else if (!selectedContractorId && allowed && allowed.length === 1) {
      const c = await query(`SELECT TOP 1 name FROM contractors WHERE id = @id`, { id: allowed[0] });
      selectedContractorName = c.recordset?.[0]?.name || null;
    }

    if (allowed && allowed.length === 0) {
      if (wantPdf) {
        const buf = await buildFleetListPdf(query, tenantId, null, null, { companyName: selectedContractorName || 'Contractor' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="fleet-list-not-official.pdf"');
        return res.send(Buffer.from(buf));
      }
      if (wantExcel) {
        const buf = await buildFleetListExcel(query, tenantId, null, null, {});
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.xlsx"');
        return res.send(Buffer.from(buf));
      }
      const result = await query(`SELECT t.registration, t.make_model, t.fleet_no, t.commodity_type, t.capacity_tonnes FROM contractor_trucks t WHERE 1=0`, { tenantId });
      const rows = result.recordset || [];
      const headers = ['Registration', 'Make/Model', 'Fleet No', 'Commodity', 'Capacity (t)'];
      const csv = [headers.join(',')].concat(rows.map((r) => [r.registration, r.make_model, r.fleet_no, r.commodity_type, r.capacity_tonnes].map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : '')).join(','))).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.csv"');
      return res.send('\uFEFF' + csv);
    }
    const includeAll = String(req.query.includeAll || req.query.include_all || '').trim() === '1';
    const routeId = req.query.routeId;
    const routeIdsRaw = req.query.routeIds;
    const routeIds = routeIdsRaw && typeof routeIdsRaw === 'string' ? routeIdsRaw.split(',').map((id) => id.trim()).filter(Boolean) : null;
    const useRoutes = routeId || (routeIds && routeIds.length > 0);
    const ids = routeId ? [routeId] : (routeIds || []);
    const columnsRaw = req.query.columns;
    const requestedCols = columnsRaw && typeof columnsRaw === 'string'
      ? columnsRaw.split(',').map((c) => c.trim()).filter(Boolean)
      : null;
    const groupByRaw = String(req.query.groupBy || req.query.group_by || '').trim().toLowerCase();
    const groupBy = groupByRaw === 'sub_contractor' ? 'sub_contractor' : null;
    let effectiveCols = requestedCols && requestedCols.length > 0 ? [...requestedCols] : null;
    if (groupBy === 'sub_contractor' && effectiveCols) {
      const rest = effectiveCols.filter((k) => k !== 'contractor' && k !== 'sub_contractor');
      effectiveCols = ['contractor', 'sub_contractor', ...rest];
    }
    if (wantPdf) {
      const routeIdsForPdf = useRoutes && ids.length > 0 ? ids : null;
      const opts = {
        ...(selectedContractorId
          ? { contractorId: selectedContractorId }
          : (allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {})),
        groupBy,
        companyName: selectedContractorName || 'Contractor',
      };
      const buf = await buildFleetListPdf(query, tenantId, routeIdsForPdf, effectiveCols, { ...opts, includeAll });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="fleet-list-not-official.pdf"');
      return res.send(Buffer.from(buf));
    }
    if (wantExcel) {
      const routeIdsForExcel = useRoutes && ids.length > 0 ? ids : null;
      const opts = {
        ...(allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {}),
        groupBy,
      };
      const buf = await buildFleetListExcel(query, tenantId, routeIdsForExcel, effectiveCols, opts);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.xlsx"');
      return res.send(Buffer.from(buf));
    }
    const routeIdsForCsv = useRoutes && ids.length > 0 ? ids : null;
    const csvOpts = allowed && allowed.length > 0
      ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed })
      : {};
    const csv = await buildFleetListCsv(query, tenantId, routeIdsForCsv, effectiveCols, csvOpts);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/** GET driver list CSV/Excel/PDF (approved drivers; optional ?routeId= or ?routeIds=id1,id2, ?format=excel|pdf). Scoped by company when user has contractor scope. */
router.get('/enrollment/driver-list', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    const fmt = String(req.query.format || '').toLowerCase();
    const wantExcel = fmt === 'excel';
    const wantPdf = fmt === 'pdf';
    if (allowed && allowed.length === 0) {
      if (wantPdf) {
        const buf = await buildDriverListPdf(query, tenantId, null, null, {});
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="driver-list-not-official.pdf"');
        return res.send(Buffer.from(buf));
      }
      if (wantExcel) {
        const buf = await buildDriverListExcel(query, tenantId, null, null, {});
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="driver-list.xlsx"');
        return res.send(Buffer.from(buf));
      }
      const result = await query(`SELECT d.full_name, d.license_number, d.phone, d.email FROM contractor_drivers d WHERE 1=0`, { tenantId });
      const rows = result.recordset || [];
      const headers = ['Name', 'License', 'Phone', 'Email'];
      const csv = [headers.join(',')].concat(rows.map((r) => [r.full_name, r.license_number, r.phone, r.email].map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : '')).join(','))).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="driver-list.csv"');
      return res.send('\uFEFF' + csv);
    }
    const routeId = req.query.routeId;
    const routeIdsRaw = req.query.routeIds;
    const routeIds = routeIdsRaw && typeof routeIdsRaw === 'string' ? routeIdsRaw.split(',').map((id) => id.trim()).filter(Boolean) : null;
    const useRoutes = routeId || (routeIds && routeIds.length > 0);
    const ids = routeId ? [routeId] : (routeIds || []);
    const columnsRaw = req.query.columns;
    const requestedCols = columnsRaw && typeof columnsRaw === 'string'
      ? columnsRaw.split(',').map((c) => c.trim()).filter(Boolean)
      : null;
    const groupByRaw = String(req.query.groupBy || req.query.group_by || '').trim().toLowerCase();
    const groupBy = groupByRaw === 'sub_contractor' ? 'sub_contractor' : null;
    let effectiveCols = requestedCols && requestedCols.length > 0 ? [...requestedCols] : null;
    if (groupBy === 'sub_contractor' && effectiveCols) {
      const rest = effectiveCols.filter((k) => k !== 'contractor' && k !== 'sub_contractor');
      effectiveCols = ['contractor', 'sub_contractor', ...rest];
    }
    if (wantPdf) {
      const routeIdsForPdf = useRoutes && ids.length > 0 ? ids : null;
      const opts = {
        ...(allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {}),
        groupBy,
      };
      const buf = await buildDriverListPdf(query, tenantId, routeIdsForPdf, effectiveCols, opts);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="driver-list-not-official.pdf"');
      return res.send(Buffer.from(buf));
    }
    if (wantExcel) {
      const routeIdsForExcel = useRoutes && ids.length > 0 ? ids : null;
      const opts = {
        ...(allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {}),
        groupBy,
      };
      const buf = await buildDriverListExcel(query, tenantId, routeIdsForExcel, effectiveCols, opts);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="driver-list.xlsx"');
      return res.send(Buffer.from(buf));
    }
    const routeIdsForCsv = useRoutes && ids.length > 0 ? ids : null;
    const csvOpts = allowed && allowed.length > 0
      ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed })
      : {};
    const csv = await buildDriverListCsv(query, tenantId, routeIdsForCsv, effectiveCols, csvOpts);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="driver-list.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// --- Rector: routes assigned to current user (for Rector page route-scoped view) ---
/** GET route IDs for which the current user is assigned as rector (access_route_factors.user_id = me) */
router.get('/rector-my-routes', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const tenantId = getTenantId(req);
    if (!userId || !tenantId) return res.json({ routeIds: [] });
    const result = await query(
      `SELECT f.route_id FROM access_route_factors f
       WHERE f.tenant_id = @tenantId AND f.user_id = @userId AND f.route_id IS NOT NULL`,
      { tenantId, userId }
    );
    const routeIds = (result.recordset || []).map((r) => r.route_id).filter(Boolean);
    res.json({ routeIds });
  } catch (err) {
    if (err.message?.includes('Invalid object name') || err.message?.includes('user_id')) return res.json({ routeIds: [] });
    next(err);
  }
});

async function ensureRouteTargetRegulationsTable() {
  await query(`
    IF OBJECT_ID(N'dbo.access_route_target_regulations', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.access_route_target_regulations (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        tenant_id UNIQUEIDENTIFIER NOT NULL,
        route_id UNIQUEIDENTIFIER NOT NULL,
        deliveries_per_truck_target DECIMAL(10,2) NOT NULL,
        notes NVARCHAR(500) NULL,
        created_by_user_id UNIQUEIDENTIFIER NULL,
        updated_by_user_id UNIQUEIDENTIFIER NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_access_route_target_reg_tenant_route UNIQUE (tenant_id, route_id)
      );
      CREATE INDEX IX_access_route_target_reg_tenant ON dbo.access_route_target_regulations(tenant_id);
      CREATE INDEX IX_access_route_target_reg_route ON dbo.access_route_target_regulations(route_id);
    END
  `);
}

/** GET route target regulations (Rector + Data presentation helper) */
router.get('/route-target-regulations', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    await ensureRouteTargetRegulationsTable();
    const result = await query(
      `SELECT t.*, r.name AS route_name, u.full_name AS updated_by_name
       FROM access_route_target_regulations t
       LEFT JOIN contractor_routes r ON r.id = t.route_id AND r.tenant_id = t.tenant_id
       LEFT JOIN users u ON u.id = t.updated_by_user_id
       WHERE t.tenant_id = @tenantId
       ORDER BY r.name ASC, t.created_at DESC`,
      { tenantId }
    );
    res.json({ regulations: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** PUT upsert route target regulation */
router.put('/route-target-regulations/:routeId', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = req.params.routeId;
    const targetRaw = req.body?.deliveries_per_truck_target;
    const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;
    const target = Number(targetRaw);
    if (!routeId) return res.status(400).json({ error: 'routeId required' });
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ error: 'deliveries_per_truck_target must be a positive number' });
    }

    await ensureRouteTargetRegulationsTable();
    const routeCheck = await query(
      `SELECT id FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
      { routeId, tenantId }
    );
    if (!routeCheck.recordset?.length) return res.status(404).json({ error: 'Route not found' });

    await query(
      `MERGE access_route_target_regulations AS tgt
       USING (SELECT @tenantId AS tenant_id, @routeId AS route_id) AS src
       ON tgt.tenant_id = src.tenant_id AND tgt.route_id = src.route_id
       WHEN MATCHED THEN
         UPDATE SET deliveries_per_truck_target = @target, notes = @notes, updated_by_user_id = @userId, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (tenant_id, route_id, deliveries_per_truck_target, notes, created_by_user_id, updated_by_user_id)
         VALUES (@tenantId, @routeId, @target, @notes, @userId, @userId);`,
      { tenantId, routeId, target, notes: notes || null, userId: req.user?.id || null }
    );

    const saved = await query(
      `SELECT t.*, r.name AS route_name, u.full_name AS updated_by_name
       FROM access_route_target_regulations t
       LEFT JOIN contractor_routes r ON r.id = t.route_id AND r.tenant_id = t.tenant_id
       LEFT JOIN users u ON u.id = t.updated_by_user_id
       WHERE t.tenant_id = @tenantId AND t.route_id = @routeId`,
      { tenantId, routeId }
    );
    res.json({ regulation: saved.recordset?.[0] || null });
  } catch (err) {
    next(err);
  }
});

// --- Route factors (Access management: contacts/stakeholders; user_id = link to user as rector) ---
/** GET route factors for tenant (optional ?routeId=); includes user full_name, email when user_id set */
router.get('/route-factors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = req.query.routeId;
    let sql = `SELECT f.*, r.name AS route_name, u.full_name AS user_full_name, u.email AS user_email
       FROM access_route_factors f
       LEFT JOIN contractor_routes r ON r.id = f.route_id AND r.tenant_id = f.tenant_id
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.tenant_id = @tenantId`;
    const params = { tenantId };
    if (routeId) {
      sql += ` AND f.route_id = @routeId`;
      params.routeId = routeId;
    }
    sql += ` ORDER BY COALESCE(u.full_name, f.name) ASC`;
    const result = await query(sql, params);
    res.json({ factors: result.recordset });
  } catch (err) {
    next(err);
  }
});

/** POST create route factor (rector) - when user_id is set, links existing user to route; else legacy name/email */
router.post('/route-factors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { route_id, user_id, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types } = req.body || {};
    const linkUser = user_id && String(user_id).trim();
    if (linkUser) {
      if (!route_id) return res.status(400).json({ error: 'Route is required when assigning a user' });
      const userCheck = await query(
        `SELECT 1 FROM users u INNER JOIN user_tenants ut ON ut.user_id = u.id WHERE u.id = @userId AND ut.tenant_id = @tenantId`,
        { userId: linkUser, tenantId }
      );
      if (!userCheck.recordset?.length) return res.status(400).json({ error: 'User not found or not in this tenant' });
      const alertStr = Array.isArray(alert_types) ? alert_types.filter(Boolean).join(',') : (typeof alert_types === 'string' && alert_types.trim() ? alert_types.trim() : null);
      const userRow = await query(`SELECT full_name, email FROM users WHERE id = @userId`, { userId: linkUser });
      const u = userRow.recordset?.[0];
      const result = await query(
        `INSERT INTO access_route_factors (tenant_id, route_id, user_id, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types)
         OUTPUT INSERTED.* VALUES (@tenantId, @route_id, @user_id, @name, @company, @email, @phone, @mobile_alt, @address, @role_or_type, @notes, @alert_types)`,
        {
          tenantId,
          route_id: route_id || null,
          user_id: linkUser,
          name: (u?.full_name || '').trim() || null,
          company: company ? String(company).trim() : null,
          email: (u?.email || '').trim() || null,
          phone: phone ? String(phone).trim() : null,
          mobile_alt: mobile_alt ? String(mobile_alt).trim() : null,
          address: address ? String(address).trim() : null,
          role_or_type: role_or_type ? String(role_or_type).trim() : null,
          notes: notes ? String(notes).trim() : null,
          alert_types: alertStr,
        }
      );
      return res.status(201).json({ factor: result.recordset[0] });
    }
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required, or assign an existing user (user_id)' });
    const alertStr = Array.isArray(alert_types) ? alert_types.filter(Boolean).join(',') : (typeof alert_types === 'string' && alert_types.trim() ? alert_types.trim() : null);
    const result = await query(
      `INSERT INTO access_route_factors (tenant_id, route_id, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types)
       OUTPUT INSERTED.* VALUES (@tenantId, @route_id, @name, @company, @email, @phone, @mobile_alt, @address, @role_or_type, @notes, @alert_types)`,
      {
        tenantId,
        route_id: route_id || null,
        name: String(name).trim(),
        company: company ? String(company).trim() : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        mobile_alt: mobile_alt ? String(mobile_alt).trim() : null,
        address: address ? String(address).trim() : null,
        role_or_type: role_or_type ? String(role_or_type).trim() : null,
        notes: notes ? String(notes).trim() : null,
        alert_types: alertStr,
      }
    );
    res.status(201).json({ factor: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** POST create route factors (rectors) for multiple routes at once - same user and alert_types per route. Skips routes where user is already rector. */
router.post('/route-factors/bulk', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { user_id, route_ids, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types } = req.body || {};
    const linkUser = user_id && String(user_id).trim();
    if (!linkUser) return res.status(400).json({ error: 'user_id is required' });
    const routeIds = Array.isArray(route_ids) ? route_ids.filter((id) => id != null && String(id).trim()) : [];
    if (routeIds.length === 0) return res.status(400).json({ error: 'route_ids (array with at least one route) is required' });
    const userCheck = await query(
      `SELECT 1 FROM users u INNER JOIN user_tenants ut ON ut.user_id = u.id WHERE u.id = @userId AND ut.tenant_id = @tenantId`,
      { userId: linkUser, tenantId }
    );
    if (!userCheck.recordset?.length) return res.status(400).json({ error: 'User not found or not in this tenant' });
    const userRow = await query(`SELECT full_name, email FROM users WHERE id = @userId`, { userId: linkUser });
    const u = userRow.recordset?.[0];
    const alertStr = Array.isArray(alert_types) ? alert_types.filter(Boolean).join(',') : (typeof alert_types === 'string' && alert_types.trim() ? alert_types.trim() : null);
    const created = [];
    for (const route_id of routeIds) {
      const existing = await query(
        `SELECT 1 FROM access_route_factors WHERE tenant_id = @tenantId AND route_id = @route_id AND user_id = @userId`,
        { tenantId, route_id, userId: linkUser }
      );
      if (existing.recordset?.length) continue;
      const result = await query(
        `INSERT INTO access_route_factors (tenant_id, route_id, user_id, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types)
         OUTPUT INSERTED.* VALUES (@tenantId, @route_id, @user_id, @name, @company, @email, @phone, @mobile_alt, @address, @role_or_type, @notes, @alert_types)`,
        {
          tenantId,
          route_id,
          user_id: linkUser,
          name: (u?.full_name || '').trim() || null,
          company: company ? String(company).trim() : null,
          email: (u?.email || '').trim() || null,
          phone: phone ? String(phone).trim() : null,
          mobile_alt: mobile_alt ? String(mobile_alt).trim() : null,
          address: address ? String(address).trim() : null,
          role_or_type: role_or_type ? String(role_or_type).trim() : null,
          notes: notes ? String(notes).trim() : null,
          alert_types: alertStr,
        }
      );
      if (result.recordset?.[0]) created.push(result.recordset[0]);
    }
    res.status(201).json({ factors: created, created: created.length });
  } catch (err) {
    next(err);
  }
});

/** PATCH route factor (rector) - includes user_id, alert_types, address, mobile_alt */
router.patch('/route-factors/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const { route_id, user_id, name, company, email, phone, mobile_alt, address, role_or_type, notes, alert_types } = req.body || {};
    const updates = [];
    const params = { id, tenantId };
    if (route_id !== undefined) { updates.push('route_id = @route_id'); params.route_id = route_id || null; }
    if (user_id !== undefined) {
      updates.push('user_id = @user_id');
      params.user_id = user_id && String(user_id).trim() ? user_id.trim() : null;
      if (params.user_id) {
        const userCheck = await query(`SELECT 1 FROM users u INNER JOIN user_tenants ut ON ut.user_id = u.id WHERE u.id = @uid AND ut.tenant_id = @tenantId`, { uid: params.user_id, tenantId });
        if (!userCheck.recordset?.length) return res.status(400).json({ error: 'User not found or not in this tenant' });
      }
    }
    if (name !== undefined && String(name).trim()) { updates.push('name = @name'); params.name = String(name).trim(); }
    if (company !== undefined) { updates.push('company = @company'); params.company = company ? String(company).trim() : null; }
    if (email !== undefined) { updates.push('email = @email'); params.email = email ? String(email).trim() : null; }
    if (phone !== undefined) { updates.push('phone = @phone'); params.phone = phone ? String(phone).trim() : null; }
    if (mobile_alt !== undefined) { updates.push('mobile_alt = @mobile_alt'); params.mobile_alt = mobile_alt ? String(mobile_alt).trim() : null; }
    if (address !== undefined) { updates.push('address = @address'); params.address = address ? String(address).trim() : null; }
    if (role_or_type !== undefined) { updates.push('role_or_type = @role_or_type'); params.role_or_type = role_or_type ? String(role_or_type).trim() : null; }
    if (notes !== undefined) { updates.push('notes = @notes'); params.notes = notes ? String(notes).trim() : null; }
    if (alert_types !== undefined) {
      const alertStr = Array.isArray(alert_types) ? alert_types.filter(Boolean).join(',') : (typeof alert_types === 'string' ? alert_types.trim() || null : null);
      updates.push('alert_types = @alert_types');
      params.alert_types = alertStr;
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(
      `UPDATE access_route_factors SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const getResult = await query(`SELECT * FROM access_route_factors WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!getResult.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ factor: getResult.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE route factor */
router.delete('/route-factors/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    await query(`DELETE FROM access_route_factors WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function mapRouteDistributionRecipientRow(r) {
  const email = String(r.recipient_email || r.user_email || '').trim().toLowerCase();
  return {
    id: r.id,
    routeId: r.route_id,
    userId: r.user_id || null,
    email,
    label: r.recipient_name || r.user_full_name || null,
    isCc: Boolean(r.is_cc),
  };
}

const VALID_FLEET_LIST_COLUMNS = new Set([
  'contractor', 'sub_contractor', 'registration', 'make_model', 'fleet_no',
  'trailer_1_reg_no', 'trailer_2_reg_no', 'commodity_type', 'capacity_tonnes', 'route_name',
]);
const VALID_DRIVER_LIST_COLUMNS = new Set([
  'contractor', 'sub_contractor', 'full_name', 'license_number', 'phone', 'email', 'route_name',
]);

function parseColumnKeys(raw, allowed) {
  if (!raw) return [];
  let keys = [];
  if (Array.isArray(raw)) keys = raw.map(String);
  else keys = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set(keys.filter((k) => allowed.has(k)))];
}

function serializeColumnKeys(keys) {
  const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
  return list.length ? list.join(',') : null;
}

function mapRouteDistributionSettingsRow(r) {
  if (!r) return null;
  return {
    routeId: r.route_id,
    includeFleet: r.include_fleet !== false && r.include_fleet !== 0,
    includeDrivers: r.include_drivers !== false && r.include_drivers !== 0,
    fleetColumns: parseColumnKeys(r.fleet_columns, VALID_FLEET_LIST_COLUMNS),
    driverColumns: parseColumnKeys(r.driver_columns, VALID_DRIVER_LIST_COLUMNS),
    groupBySubContractor: Boolean(r.group_by_sub_contractor),
    updatedAt: r.updated_at,
  };
}

function mergeRouteListSettings(rows) {
  const configured = (rows || []).filter(Boolean);
  if (!configured.length) return null;
  const fleetSet = new Set();
  const driverSet = new Set();
  let includeFleet = false;
  let includeDrivers = false;
  let groupBySubContractor = false;
  for (const row of configured) {
    const mapped = mapRouteDistributionSettingsRow(row);
    if (!mapped) continue;
    if (mapped.includeFleet) includeFleet = true;
    if (mapped.includeDrivers) includeDrivers = true;
    if (mapped.groupBySubContractor) groupBySubContractor = true;
    mapped.fleetColumns.forEach((k) => fleetSet.add(k));
    mapped.driverColumns.forEach((k) => driverSet.add(k));
  }
  return {
    includeFleet,
    includeDrivers,
    fleetColumns: [...fleetSet],
    driverColumns: [...driverSet],
    groupBySubContractor,
    configuredRouteCount: configured.length,
  };
}

async function loadRouteDistributionConfig(tenantId, routeId) {
  const recipientsResult = await query(
    `SELECT r.id, r.route_id, r.user_id, r.recipient_email, r.recipient_name, r.is_cc,
            u.full_name AS user_full_name, u.email AS user_email
     FROM access_route_distribution_recipients r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.tenant_id = @tenantId AND r.route_id = @routeId
     ORDER BY r.is_cc ASC, r.recipient_email ASC`,
    { tenantId, routeId }
  );
  let settings = null;
  try {
    const settingsResult = await query(
      `SELECT * FROM access_route_distribution_settings WHERE tenant_id = @tenantId AND route_id = @routeId`,
      { tenantId, routeId }
    );
    settings = mapRouteDistributionSettingsRow(settingsResult.recordset?.[0]);
  } catch (e) {
    if (!String(e?.message || '').includes('access_route_distribution_settings')) throw e;
  }
  return {
    recipients: (recipientsResult.recordset || []).map(mapRouteDistributionRecipientRow),
    settings,
  };
}

function requireAccessManagement(req, res, next) {
  if (req.user?.role === 'super_admin') return next();
  const roles = Array.isArray(req.user?.page_roles) ? req.user.page_roles : [];
  if (roles.includes('access_management')) return next();
  return res.status(403).json({ error: 'Only Access Management can manage route distribution recipients.' });
}

/** GET list-distribution config (recipients + column settings) for one route */
router.get('/routes/:id/distribution-config', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = String(req.params.id || '').trim();
    const config = await loadRouteDistributionConfig(tenantId, routeId);
    res.json(config);
  } catch (err) {
    if (
      err.message?.includes('access_route_distribution_recipients')
      || err.message?.includes('access_route_distribution_settings')
    ) {
      return res.json({ recipients: [], settings: null, migrationRequired: true });
    }
    next(err);
  }
});

/** PUT save list-distribution config for one route */
router.put('/routes/:id/distribution-config', requireAccessManagement, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = String(req.params.id || '').trim();
    const routeCheck = await query(
      `SELECT id FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
      { routeId, tenantId }
    );
    if (!routeCheck.recordset?.length) return res.status(404).json({ error: 'Route not found' });

    const rawRecipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const normalized = [];
    const seen = new Set();
    for (const item of rawRecipients) {
      let email = String(item?.email || item?.recipient_email || '').trim().toLowerCase();
      const userId = item?.user_id || item?.userId || null;
      if (userId && !email) {
        const u = await query(`SELECT email, full_name FROM users WHERE id = @userId`, { userId });
        email = String(u.recordset?.[0]?.email || '').trim().toLowerCase();
        if (!item?.label && !item?.recipient_name) {
          item.label = u.recordset?.[0]?.full_name || null;
        }
      }
      if (!email || !email.includes('@')) continue;
      const isCc = Boolean(item?.is_cc ?? item?.isCc);
      const key = `${email}|${isCc ? 'cc' : 'to'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ userId: userId || null, email, label: item?.label || item?.recipient_name || null, isCc });
    }

    await query(
      `DELETE FROM access_route_distribution_recipients WHERE tenant_id = @tenantId AND route_id = @routeId`,
      { tenantId, routeId }
    );
    for (const rec of normalized) {
      await query(
        `INSERT INTO access_route_distribution_recipients
           (tenant_id, route_id, user_id, recipient_email, recipient_name, is_cc)
         VALUES (@tenantId, @routeId, @userId, @email, @label, @isCc)`,
        {
          tenantId,
          routeId,
          userId: rec.userId,
          email: rec.email,
          label: rec.label,
          isCc: rec.isCc ? 1 : 0,
        }
      );
    }

    const settingsBody = req.body?.settings || req.body?.listSettings || {};
    const fleetColumns = parseColumnKeys(
      settingsBody.fleet_columns ?? settingsBody.fleetColumns,
      VALID_FLEET_LIST_COLUMNS
    );
    const driverColumns = parseColumnKeys(
      settingsBody.driver_columns ?? settingsBody.driverColumns,
      VALID_DRIVER_LIST_COLUMNS
    );
    const includeFleet = settingsBody.include_fleet ?? settingsBody.includeFleet;
    const includeDrivers = settingsBody.include_drivers ?? settingsBody.includeDrivers;
    const groupBySubContractor = settingsBody.group_by_sub_contractor ?? settingsBody.groupBySubContractor;

    const hasSettings =
      settingsBody
      && (
        includeFleet !== undefined
        || includeDrivers !== undefined
        || fleetColumns.length > 0
        || driverColumns.length > 0
        || groupBySubContractor !== undefined
      );

    if (hasSettings) {
      await query(
        `MERGE access_route_distribution_settings AS t
         USING (SELECT @tenantId AS tenant_id, @routeId AS route_id) AS s
           ON t.tenant_id = s.tenant_id AND t.route_id = s.route_id
         WHEN MATCHED THEN UPDATE SET
           include_fleet = @includeFleet,
           include_drivers = @includeDrivers,
           fleet_columns = @fleetColumns,
           driver_columns = @driverColumns,
           group_by_sub_contractor = @groupBySubContractor,
           updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT
           (tenant_id, route_id, include_fleet, include_drivers, fleet_columns, driver_columns, group_by_sub_contractor)
         VALUES (@tenantId, @routeId, @includeFleet, @includeDrivers, @fleetColumns, @driverColumns, @groupBySubContractor);`,
        {
          tenantId,
          routeId,
          includeFleet: includeFleet === false ? 0 : 1,
          includeDrivers: includeDrivers === false ? 0 : 1,
          fleetColumns: serializeColumnKeys(fleetColumns),
          driverColumns: serializeColumnKeys(driverColumns),
          groupBySubContractor: groupBySubContractor ? 1 : 0,
        }
      );
    }

    const config = await loadRouteDistributionConfig(tenantId, routeId);
    res.json(config);
  } catch (err) {
    if (
      err.message?.includes('access_route_distribution_recipients')
      || err.message?.includes('access_route_distribution_settings')
    ) {
      return res.status(503).json({ error: 'Run: npm run db:route-distribution-recipients and npm run db:route-distribution-settings' });
    }
    next(err);
  }
});

/** GET saved list-distribution recipients for one route */
router.get('/routes/:id/distribution-recipients', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = String(req.params.id || '').trim();
    const result = await query(
      `SELECT r.id, r.route_id, r.user_id, r.recipient_email, r.recipient_name, r.is_cc,
              u.full_name AS user_full_name, u.email AS user_email
       FROM access_route_distribution_recipients r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.tenant_id = @tenantId AND r.route_id = @routeId
       ORDER BY r.is_cc ASC, r.recipient_email ASC`,
      { tenantId, routeId }
    );
    res.json({ recipients: (result.recordset || []).map(mapRouteDistributionRecipientRow) });
  } catch (err) {
    if (err.message?.includes('access_route_distribution_recipients')) {
      return res.json({ recipients: [], migrationRequired: true });
    }
    next(err);
  }
});

/** PUT replace all list-distribution recipients for one route */
router.put('/routes/:id/distribution-recipients', requireAccessManagement, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const routeId = String(req.params.id || '').trim();
    const routeCheck = await query(
      `SELECT id FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
      { routeId, tenantId }
    );
    if (!routeCheck.recordset?.length) return res.status(404).json({ error: 'Route not found' });

    const raw = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const normalized = [];
    const seen = new Set();
    for (const item of raw) {
      let email = String(item?.email || item?.recipient_email || '').trim().toLowerCase();
      const userId = item?.user_id || item?.userId || null;
      if (userId && !email) {
        const u = await query(`SELECT email, full_name FROM users WHERE id = @userId`, { userId });
        email = String(u.recordset?.[0]?.email || '').trim().toLowerCase();
        if (!item?.label && !item?.recipient_name) {
          item.label = u.recordset?.[0]?.full_name || null;
        }
      }
      if (!email || !email.includes('@')) continue;
      const isCc = Boolean(item?.is_cc ?? item?.isCc);
      const key = `${email}|${isCc ? 'cc' : 'to'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        userId: userId || null,
        email,
        label: item?.label || item?.recipient_name || null,
        isCc,
      });
    }

    await query(
      `DELETE FROM access_route_distribution_recipients WHERE tenant_id = @tenantId AND route_id = @routeId`,
      { tenantId, routeId }
    );
    for (const rec of normalized) {
      await query(
        `INSERT INTO access_route_distribution_recipients
           (tenant_id, route_id, user_id, recipient_email, recipient_name, is_cc)
         VALUES (@tenantId, @routeId, @userId, @email, @label, @isCc)`,
        {
          tenantId,
          routeId,
          userId: rec.userId,
          email: rec.email,
          label: rec.label,
          isCc: rec.isCc ? 1 : 0,
        }
      );
    }

    const result = await query(
      `SELECT r.id, r.route_id, r.user_id, r.recipient_email, r.recipient_name, r.is_cc,
              u.full_name AS user_full_name, u.email AS user_email
       FROM access_route_distribution_recipients r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.tenant_id = @tenantId AND r.route_id = @routeId
       ORDER BY r.is_cc ASC, r.recipient_email ASC`,
      { tenantId, routeId }
    );
    res.json({ recipients: (result.recordset || []).map(mapRouteDistributionRecipientRow) });
  } catch (err) {
    if (err.message?.includes('access_route_distribution_recipients')) {
      return res.status(503).json({ error: 'Run: npm run db:route-distribution-recipients' });
    }
    next(err);
  }
});

/** GET merged recipients for selected routes (list distribution auto-fill) */
router.get('/distribution/route-recipients', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const rawIds = String(req.query.routeIds || req.query.route_ids || '').trim();
    const routeIds = rawIds
      ? rawIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    let sql = `SELECT r.id, r.route_id, r.user_id, r.recipient_email, r.recipient_name, r.is_cc,
                      u.full_name AS user_full_name, u.email AS user_email,
                      cr.name AS route_name
               FROM access_route_distribution_recipients r
               INNER JOIN contractor_routes cr ON cr.id = r.route_id AND cr.tenant_id = r.tenant_id
               LEFT JOIN users u ON u.id = r.user_id
               WHERE r.tenant_id = @tenantId`;
    const params = { tenantId };
    if (routeIds.length > 0) {
      const placeholders = routeIds.map((_, i) => `@r${i}`).join(',');
      sql += ` AND r.route_id IN (${placeholders})`;
      routeIds.forEach((id, i) => {
        params[`r${i}`] = id;
      });
    }
    sql += ` ORDER BY cr.name, r.is_cc ASC, r.recipient_email ASC`;

    const result = await query(sql, params);
    const rows = (result.recordset || []).map((row) => ({
      ...mapRouteDistributionRecipientRow(row),
      routeName: row.route_name || '',
    }));

    const toMap = new Map();
    const ccMap = new Map();
    const byRoute = {};
    for (const row of rows) {
      const rid = String(row.routeId);
      if (!byRoute[rid]) byRoute[rid] = { to: [], cc: [], count: 0 };
      const entry = { email: row.email, label: row.label, userId: row.userId };
      if (row.isCc) {
        ccMap.set(row.email, { email: row.email, label: row.label || row.email });
        byRoute[rid].cc.push(entry);
      } else {
        toMap.set(row.email, { email: row.email, label: row.label || row.email });
        byRoute[rid].to.push(entry);
      }
      byRoute[rid].count += 1;
    }

    let settingsRows = [];
    const settingsByRouteOut = {};
    try {
      let settingsSql = `SELECT s.*, cr.name AS route_name
                         FROM access_route_distribution_settings s
                         INNER JOIN contractor_routes cr ON cr.id = s.route_id AND cr.tenant_id = s.tenant_id
                         WHERE s.tenant_id = @tenantId`;
      const settingsParams = { tenantId };
      if (routeIds.length > 0) {
        const placeholders = routeIds.map((_, i) => `@s${i}`).join(',');
        settingsSql += ` AND s.route_id IN (${placeholders})`;
        routeIds.forEach((id, i) => {
          settingsParams[`s${i}`] = id;
        });
      }
      settingsSql += ` ORDER BY cr.name`;
      const settingsResult = await query(settingsSql, settingsParams);
      settingsRows = settingsResult.recordset || [];
      for (const row of settingsRows) {
        const mapped = mapRouteDistributionSettingsRow(row);
        if (mapped) settingsByRouteOut[String(mapped.routeId)] = mapped;
      }
    } catch (e) {
      if (!String(e?.message || '').includes('access_route_distribution_settings')) throw e;
    }

    res.json({
      to: [...toMap.values()],
      cc: [...ccMap.values()],
      byRoute,
      totalConfiguredRoutes: Object.keys(byRoute).length,
      listSettings: mergeRouteListSettings(settingsRows),
      settingsByRoute: settingsByRouteOut,
    });
  } catch (err) {
    if (err.message?.includes('access_route_distribution_recipients')) {
      return res.json({
        to: [],
        cc: [],
        byRoute: {},
        totalConfiguredRoutes: 0,
        listSettings: null,
        settingsByRoute: {},
        migrationRequired: true,
      });
    }
    next(err);
  }
});

// --- Distribution history (Access management: log downloads/sends) ---
/** GET distribution history with optional filters: dateFrom, dateTo, routeId, listType, channel */
router.get('/distribution-history', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { dateFrom, dateTo, routeId, listType, channel, search } = req.query;
    let sql = `SELECT h.* FROM access_distribution_history h WHERE h.tenant_id = @tenantId`;
    const params = { tenantId };
    if (dateFrom) {
      sql += ` AND h.created_at >= @dateFrom`;
      params.dateFrom = new Date(dateFrom).toISOString();
    }
    if (dateTo) {
      sql += ` AND h.created_at < DATEADD(day, 1, CAST(@dateTo AS DATE))`;
      params.dateTo = toYmdFromDbOrString(new Date(dateTo));
    }
    if (routeId) {
      sql += ` AND (h.route_ids = @routeId OR h.route_ids LIKE @routeIdPrefix OR h.route_ids LIKE @routeIdSuffix OR h.route_ids LIKE @routeIdMid)`;
      params.routeId = routeId;
      params.routeIdPrefix = routeId + ',%';
      params.routeIdSuffix = '%,' + routeId;
      params.routeIdMid = '%,' + routeId + ',%';
    }
    if (listType && ['fleet', 'driver', 'both'].includes(listType)) {
      sql += ` AND h.list_type = @listType`;
      params.listType = listType;
    }
    if (channel && ['download', 'email', 'whatsapp'].includes(channel)) {
      sql += ` AND h.channel = @channel`;
      params.channel = channel;
    }
    if (search && String(search).trim()) {
      sql += ` AND (h.recipient_email LIKE @search OR h.recipient_phone LIKE @search OR h.created_by_name LIKE @search)`;
      params.search = '%' + String(search).trim().replace(/%/g, '[%]') + '%';
    }
    sql += ` ORDER BY h.created_at DESC`;
    const result = await query(sql, params);
    res.json({ history: result.recordset });
  } catch (err) {
    next(err);
  }
});

/** POST record a distribution event */
router.post('/distribution-history', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id;
    const userName = req.user?.full_name || null;
    const { list_type, route_ids, format, channel, recipient_email, recipient_phone } = req.body || {};
    if (!list_type || !format || !channel) return res.status(400).json({ error: 'list_type, format, and channel are required' });
    if (!['fleet', 'driver', 'both'].includes(list_type)) return res.status(400).json({ error: 'Invalid list_type' });
    if (!['csv', 'excel', 'pdf'].includes(format)) return res.status(400).json({ error: 'Invalid format' });
    if (!['download', 'email', 'whatsapp'].includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
    const routeIdsStr = Array.isArray(route_ids) ? route_ids.join(',') : (typeof route_ids === 'string' ? route_ids : null);
    const result = await query(
      `INSERT INTO access_distribution_history (tenant_id, created_by_user_id, list_type, route_ids, format, channel, recipient_email, recipient_phone, created_by_name)
       OUTPUT INSERTED.* VALUES (@tenantId, @userId, @list_type, @route_ids, @format, @channel, @recipient_email, @recipient_phone, @created_by_name)`,
      {
        tenantId,
        userId: userId || null,
        list_type,
        route_ids: routeIdsStr || null,
        format,
        channel,
        recipient_email: recipient_email ? String(recipient_email).trim() : null,
        recipient_phone: recipient_phone ? String(recipient_phone).trim() : null,
        created_by_name: userName,
      }
    );
    res.status(201).json({ record: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** GET list of contractors (company names) for per-contractor distribution. Super_admin/enterprise see all; others see own tenant only. */
router.get('/distribution/contractors', async (req, res, next) => {
  try {
    const currentTenantId = getTenantId(req);
    const isEnterprise = String(req.user?.tenant_plan || '').toLowerCase() === 'enterprise';
    const canSeeAll = req.user?.role === 'super_admin' || isEnterprise;
    let result;
    if (canSeeAll) {
      result = await query(`SELECT c.id, c.name FROM contractors c ORDER BY c.name`);
    } else if (currentTenantId) {
      result = await query(`SELECT c.id, c.name FROM contractors c WHERE c.tenant_id = @tenantId ORDER BY c.name`, { tenantId: currentTenantId });
    } else {
      result = { recordset: [] };
    }
    res.json({ contractors: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

const FLEET_COLUMNS = [
  { key: 'contractor', label: 'Main contractor' },
  { key: 'sub_contractor', label: 'Sub-contractor' },
  { key: 'registration', label: 'Registration' },
  { key: 'make_model', label: 'Make/Model' },
  { key: 'fleet_no', label: 'Fleet No' },
  { key: 'trailer_1_reg_no', label: 'Trailer 1 reg' },
  { key: 'trailer_2_reg_no', label: 'Trailer 2 reg' },
  { key: 'integration_status', label: 'System status' },
  { key: 'commodity_type', label: 'Commodity' },
  { key: 'capacity_tonnes', label: 'Capacity (t)' },
  { key: 'route_name', label: 'Route' },
];
const DRIVER_COLUMNS = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'sub_contractor', label: 'Sub-contractor' },
  { key: 'full_name', label: 'Name' },
  { key: 'license_number', label: 'License' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'route_name', label: 'Route' },
];
// Keys that are opt-in (only included when explicitly listed in `columns`).
// Keeps existing /enrollment downloads backwards-compatible.
const OPTIONAL_LIST_COLUMN_KEYS = new Set(['contractor', 'sub_contractor']);

/** Get fleet list data: { headers, keys, rows }. Optional columns = array of keys to include. contractorId = single company; contractorIds = array of company ids.
 *  queryOpts.includeRouteEnrollmentWithoutAccessFilter: when true and routeIds set, include all trucks enrolled on the route (not only facility_access=1). Used for email/pilot distribution so lists match route roster. */
async function getFleetListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null, queryOpts = {}) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
  const includeAll = queryOpts.includeAll === true;
  const skipAccessOnRoute = (queryOpts.includeRouteEnrollmentWithoutAccessFilter === true || includeAll) && useRoutes && ids.length > 0;
  const accessClause = (skipAccessOnRoute || includeAll) ? '' : ' AND t.facility_access = 1';
  let sql;
  const params = { tenantId };
  let contractorClause = '';
  if (contractorId != null) {
    params.contractorId = contractorId;
    contractorClause = ' AND t.contractor_id = @contractorId';
  } else if (Array.isArray(contractorIds) && contractorIds.length > 0) {
    const placeholders = contractorIds.map((_, i) => `@cid${i}`).join(',');
    contractorClause = ` AND t.contractor_id IN (${placeholders})`;
    contractorIds.forEach((id, i) => { params[`cid${i}`] = id; });
  }
  if (useRoutes && ids.length > 0) {
    const placeholders = ids.map((_, i) => `@routeId${i}`).join(',');
    for (let i = 0; i < ids.length; i++) params[`routeId${i}`] = ids[i];
    sql = `SELECT t.registration, t.make_model, t.fleet_no, t.trailer_1_reg_no, t.trailer_2_reg_no, t.commodity_type, t.capacity_tonnes, r.name AS route_name,
                  CASE
                    WHEN t.facility_access = 1 THEN N'Facility access'
                    ELSE N'Pending CC'
                  END AS integration_status,
                  ISNULL(NULLIF(LTRIM(RTRIM(c.name)), N''), NULLIF(LTRIM(RTRIM(t.main_contractor)), N'')) AS contractor,
                  ISNULL(NULLIF(LTRIM(RTRIM(t.sub_contractor)), N''), NULLIF(LTRIM(RTRIM(sc.name)), N'')) AS sub_contractor
           FROM contractor_route_trucks rt
           JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId${accessClause}${contractorClause}
           JOIN contractor_routes r ON r.id = rt.route_id AND r.tenant_id = @tenantId
           LEFT JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = @tenantId
           LEFT JOIN contractors sc ON sc.id = t.subcontractor_id AND sc.tenant_id = @tenantId
           WHERE rt.route_id IN (${placeholders})
           ORDER BY r.[order], r.name, t.registration`;
  } else {
    sql = `SELECT t.registration, t.make_model, t.fleet_no, t.trailer_1_reg_no, t.trailer_2_reg_no, t.commodity_type, t.capacity_tonnes,
                  CASE
                    WHEN t.facility_access = 1 THEN N'Facility access'
                    ELSE N'Pending CC'
                  END AS integration_status,
                  ISNULL(NULLIF(LTRIM(RTRIM(c.name)), N''), NULLIF(LTRIM(RTRIM(t.main_contractor)), N'')) AS contractor,
                  ISNULL(NULLIF(LTRIM(RTRIM(t.sub_contractor)), N''), NULLIF(LTRIM(RTRIM(sc.name)), N'')) AS sub_contractor
           FROM contractor_trucks t
           LEFT JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = @tenantId
           LEFT JOIN contractors sc ON sc.id = t.subcontractor_id AND sc.tenant_id = @tenantId
           WHERE t.tenant_id = @tenantId${includeAll ? '' : ' AND t.facility_access = 1'}${contractorClause}
             AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))
           ORDER BY t.registration`;
  }
  const result = await query(sql, params);
  const rawRows = result.recordset || [];
  const rows = rawRows.map((r) => {
    const out = {};
    for (const k of Object.keys(r || {})) {
      const key = String(k).split('.').pop().toLowerCase();
      out[key] = r[k];
    }
    return out;
  });
  const withRoute = useRoutes && ids.length > 0;
  // Default column set: legacy columns only (no contractor / sub_contractor unless the caller asks for them).
  const baseCols = FLEET_COLUMNS.filter((c) => !OPTIONAL_LIST_COLUMN_KEYS.has(c.key));
  const allCols = withRoute ? baseCols : baseCols.filter((c) => c.key !== 'route_name');
  const colKeysLower = Array.isArray(columns) && columns.length > 0 ? columns.map((c) => String(c).toLowerCase()) : null;
  let useCols;
  if (colKeysLower && colKeysLower.length > 0) {
    const wanted = FLEET_COLUMNS.filter((c) => colKeysLower.includes(c.key.toLowerCase()));
    // Drop route_name when no route filter is in effect (matches legacy behaviour).
    const filtered = withRoute ? wanted : wanted.filter((c) => c.key !== 'route_name');
    useCols = filtered.length > 0 ? filtered : allCols;
  } else {
    useCols = allCols;
  }
  return { headers: useCols.map((c) => c.label), keys: useCols.map((c) => c.key), rows };
}

/** queryOpts.includeRouteEnrollmentWithoutAccessFilter: when true and routeIds set, include all drivers on route enrollments (not only facility_access=1). */
async function getDriverListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null, queryOpts = {}) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
  const includeAll = queryOpts.includeAll === true;
  const skipAccessOnRoute = (queryOpts.includeRouteEnrollmentWithoutAccessFilter === true || includeAll) && useRoutes && ids.length > 0;
  const accessClause = (skipAccessOnRoute || includeAll) ? '' : ' AND d.facility_access = 1';
  let sql;
  const params = { tenantId };
  let contractorClause = '';
  if (contractorId != null) {
    params.contractorId = contractorId;
    contractorClause = ' AND d.contractor_id = @contractorId';
  } else if (Array.isArray(contractorIds) && contractorIds.length > 0) {
    const placeholders = contractorIds.map((_, i) => `@cid${i}`).join(',');
    contractorClause = ` AND d.contractor_id IN (${placeholders})`;
    contractorIds.forEach((id, i) => { params[`cid${i}`] = id; });
  }
  if (useRoutes && ids.length > 0) {
    const placeholders = ids.map((_, i) => `@routeId${i}`).join(',');
    for (let i = 0; i < ids.length; i++) params[`routeId${i}`] = ids[i];
    sql = `SELECT d.full_name, d.license_number, d.phone, d.email, r.name AS route_name,
                  ISNULL(NULLIF(LTRIM(RTRIM(c.name)), N''), NULLIF(LTRIM(RTRIM(lt.main_contractor)), N'')) AS contractor,
                  NULLIF(LTRIM(RTRIM(lt.sub_contractor)), N'') AS sub_contractor
           FROM contractor_route_drivers rd
           JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId${accessClause}${contractorClause}
           JOIN contractor_routes r ON r.id = rd.route_id AND r.tenant_id = @tenantId
           LEFT JOIN contractors c ON c.id = d.contractor_id AND c.tenant_id = @tenantId
           LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id AND lt.tenant_id = @tenantId
           WHERE rd.route_id IN (${placeholders})
           ORDER BY r.[order], r.name, d.full_name`;
  } else {
    sql = `SELECT d.full_name, d.license_number, d.phone, d.email,
                  ISNULL(NULLIF(LTRIM(RTRIM(c.name)), N''), NULLIF(LTRIM(RTRIM(lt.main_contractor)), N'')) AS contractor,
                  NULLIF(LTRIM(RTRIM(lt.sub_contractor)), N'') AS sub_contractor
           FROM contractor_drivers d
           LEFT JOIN contractors c ON c.id = d.contractor_id AND c.tenant_id = @tenantId
           LEFT JOIN contractor_trucks lt ON lt.id = d.linked_truck_id AND lt.tenant_id = @tenantId
           WHERE d.tenant_id = @tenantId${includeAll ? '' : ' AND d.facility_access = 1'}${contractorClause}
             AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))
           ORDER BY d.full_name`;
  }
  const result = await query(sql, params);
  const rawRows = result.recordset || [];
  const rows = rawRows.map((r) => {
    const out = {};
    for (const k of Object.keys(r || {})) {
      const key = String(k).split('.').pop().toLowerCase();
      out[key] = r[k];
    }
    return out;
  });
  const withRoute = useRoutes && ids.length > 0;
  const baseCols = DRIVER_COLUMNS.filter((c) => !OPTIONAL_LIST_COLUMN_KEYS.has(c.key));
  const allCols = withRoute ? baseCols : baseCols.filter((c) => c.key !== 'route_name');
  const colKeysLower = Array.isArray(columns) && columns.length > 0 ? columns.map((c) => String(c).toLowerCase()) : null;
  let useCols;
  if (colKeysLower && colKeysLower.length > 0) {
    const wanted = DRIVER_COLUMNS.filter((c) => colKeysLower.includes(c.key.toLowerCase()));
    const filtered = withRoute ? wanted : wanted.filter((c) => c.key !== 'route_name');
    useCols = filtered.length > 0 ? filtered : allCols;
  } else {
    useCols = allCols;
  }
  return { headers: useCols.map((c) => c.label), keys: useCols.map((c) => c.key), rows };
}

/** Sanitize for use in filenames: route name, contractor name, date-time. */
function sanitizeFilename(s) {
  if (s == null) return '';
  return String(s)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .slice(0, 80) || 'list';
}

/** Filename for distribution attachments: Company name, Route name, Date and time (app timezone). Optional suffix (e.g. fleet, driver) when sending separate files. */
function distributionFilename(routeName, contractorName, ext, listKind = '') {
  const { datePart, timePart } = nowForFilename();
  const company = sanitizeFilename(contractorName);
  const route = sanitizeFilename(routeName);
  const base = `${company}_${route}_${datePart}_${timePart}`;
  const suffix = listKind && listKind !== 'lists' ? `_${listKind}` : '';
  return `${base}${suffix}.${ext}`;
}

/** Build fleet list CSV; optional columns = array of keys to include (default all). opts.contractorId / opts.contractorIds = filter by company. */
async function buildFleetListCsv(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  if (headers.length === 0) return '\uFEFF';
  const csv = [headers.join(',')].concat(
    rows.map((r) => keys.map((k) => r[k]).map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : '')).join(','))
  ).join('\n');
  return '\uFEFF' + csv;
}

/** Build driver list CSV; optional columns = array of keys to include (default all). opts.contractorId / opts.contractorIds = filter by company. */
async function buildDriverListCsv(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  if (headers.length === 0) return '\uFEFF';
  const csv = [headers.join(',')].concat(
    rows.map((r) => keys.map((k) => r[k]).map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : '')).join(','))
  ).join('\n');
  return '\uFEFF' + csv;
}

/** Build fleet list as Excel buffer. opts: { title, subtitle, contractorId, contractorIds, companyName, routeName, generated, groupBy }. */
async function buildFleetListExcel(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  const title = opts.title ?? 'Thinkers – Fleet list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${formatDateForAppTz(new Date())}`;
  const hasInfoBlock = opts.companyName != null || opts.routeName != null || opts.generated != null;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  const sheet = workbook.addWorksheet('Fleet list', { views: [{ showGridLines: true }] });
  const numCols = headers.length;
  let HEADER_ROW;
  if (numCols === 0) {
    if (hasInfoBlock) writeDistributionInfoBlock(sheet, opts);
    else sheet.getRow(1).getCell(1).value = title;
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
  if (hasInfoBlock) {
    HEADER_ROW = writeDistributionInfoBlock(sheet, opts);
    sheet.addRow([]);
  } else {
    HEADER_ROW = 4;
    sheet.getRow(1).getCell(1).value = title;
    sheet.getRow(2).getCell(1).value = subtitle;
    sheet.addRow([]);
  }
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((h, i) => headerRow.getCell(i + 1).value = h);
  const { dataRowCount, bannerRowIndexes } = writeListRows(sheet, HEADER_ROW, keys, rows, opts.groupBy);
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: !hasInfoBlock,
    subtitleRowIndex: hasInfoBlock ? undefined : 2,
    hasInfoBlock,
    dataRowCount,
    bannerRowIndexes,
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build driver list as Excel buffer. opts: { title, subtitle, contractorId, contractorIds, companyName, routeName, generated, groupBy }. */
async function buildDriverListExcel(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  const title = opts.title ?? 'Thinkers – Driver list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${formatDateForAppTz(new Date())}`;
  const hasInfoBlock = opts.companyName != null || opts.routeName != null || opts.generated != null;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  const sheet = workbook.addWorksheet('Driver list', { views: [{ showGridLines: true }] });
  const numCols = headers.length;
  let HEADER_ROW;
  if (numCols === 0) {
    if (hasInfoBlock) writeDistributionInfoBlock(sheet, opts);
    else sheet.getRow(1).getCell(1).value = title;
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
  if (hasInfoBlock) {
    HEADER_ROW = writeDistributionInfoBlock(sheet, opts);
    sheet.addRow([]);
  } else {
    HEADER_ROW = 4;
    sheet.getRow(1).getCell(1).value = title;
    sheet.getRow(2).getCell(1).value = subtitle;
    sheet.addRow([]);
  }
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((h, i) => headerRow.getCell(i + 1).value = h);
  const { dataRowCount, bannerRowIndexes } = writeListRows(sheet, HEADER_ROW, keys, rows, opts.groupBy);
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: !hasInfoBlock,
    subtitleRowIndex: hasInfoBlock ? undefined : 2,
    hasInfoBlock,
    dataRowCount,
    bannerRowIndexes,
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build one Excel workbook with Fleet list on sheet 1 and Driver list on sheet 2. opts: { companyName, routeName, generated, subtitle, contractorId, groupBy }. */
async function buildFleetAndDriverListExcel(query, tenantId, routeIds, fleetCols, driverCols, opts = {}) {
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const [fleetData, driverData] = await Promise.all([
    getFleetListData(query, tenantId, routeIds, fleetCols, opts.contractorId ?? null, opts.contractorIds ?? null, listQ),
    getDriverListData(query, tenantId, routeIds, driverCols, opts.contractorId ?? null, opts.contractorIds ?? null, listQ),
  ]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  const infoOpts = { companyName: opts.companyName, routeName: opts.routeName, generated: opts.generated };

  function addListSheet(sheetName, headers, keys, rows) {
    const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: true }] });
    const numCols = headers.length;
    if (numCols === 0) {
      writeDistributionInfoBlock(sheet, infoOpts);
      return;
    }
    const HEADER_ROW = writeDistributionInfoBlock(sheet, infoOpts);
    sheet.addRow([]);
    const headerRow = sheet.getRow(HEADER_ROW);
    headers.forEach((h, i) => headerRow.getCell(i + 1).value = h);
    const { dataRowCount, bannerRowIndexes } = writeListRows(sheet, HEADER_ROW, keys, rows, opts.groupBy);
    styleDistributionSheet(sheet, numCols, headers, {
      headerRowIndex: HEADER_ROW,
      hasTitle: false,
      hasInfoBlock: true,
      dataRowCount,
      bannerRowIndexes,
    });
  }

  addListSheet('Fleet list', fleetData.headers, fleetData.keys, fleetData.rows);
  addListSheet('Driver list', driverData.headers, driverData.keys, driverData.rows);
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build distribution list PDF (title, subtitle, table; no contact footer). */
function buildDistributionPdf(title, subtitle, headers, rows, keys) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const MARGIN = 30;
    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const TABLE_W = PAGE_W - MARGIN * 2;
    const ROW_H = 16;
    const HEADER_COLOR = '#1e40af';
    const FONT = 'Helvetica';

    const drawNotOfficialWatermark = () => {
      const centerX = PAGE_W / 2;
      const centerY = PAGE_H / 2;
      doc.save();
      doc.translate(centerX, centerY);
      doc.rotate(-32);
      doc.font(FONT, 'bold');
      doc.fontSize(56);
      doc.fillColor('#dc2626');
      doc.opacity(0.11);
      doc.text('NOT OFFICIAL', -220, -18, { width: 440, align: 'center' });
      doc.restore();
      doc.opacity(1);
    };

    let y = MARGIN;
    drawNotOfficialWatermark();
    doc.fontSize(16).font(FONT, 'bold').fillColor(HEADER_COLOR).text(title, MARGIN, y);
    y += 22;
    doc.fontSize(9).fillColor('#64748b').font(FONT, 'normal').text(subtitle, MARGIN, y);
    y += 28;

    if (headers.length === 0) {
      doc.end();
      return;
    }

    const numCols = headers.length;
    const colW = TABLE_W / numCols;
    doc.fillColor(HEADER_COLOR);
    doc.rect(MARGIN, y, TABLE_W, ROW_H).fill();
    doc.fillColor('#ffffff').font(FONT, 'bold').fontSize(9);
    headers.forEach((h, i) => {
      doc.text(String(h).slice(0, 20), MARGIN + i * colW + 4, y + 4, { width: colW - 6, ellipsis: true });
    });
    y += ROW_H;

    doc.fillColor('#000000').font(FONT, 'normal').fontSize(8);
    rows.forEach((row, rowIndex) => {
      if (y + ROW_H > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
        drawNotOfficialWatermark();
        doc.fillColor(HEADER_COLOR);
        doc.rect(MARGIN, y, TABLE_W, ROW_H).fill();
        doc.fillColor('#ffffff').font(FONT, 'bold').fontSize(9);
        headers.forEach((h, i) => {
          doc.text(String(h).slice(0, 20), MARGIN + i * colW + 4, y + 4, { width: colW - 6, ellipsis: true });
        });
        y += ROW_H;
        doc.fillColor('#000000').font(FONT, 'normal').fontSize(8);
      }
      keys.forEach((k, i) => {
        const val = row[k] != null ? String(row[k]) : '';
        doc.text(val.slice(0, 24), MARGIN + i * colW + 4, y + 3, { width: colW - 6, ellipsis: true });
      });
      doc.strokeColor('#e2e8f0').lineWidth(0.3).rect(MARGIN, y, TABLE_W, ROW_H).stroke();
      y += ROW_H;
    });

    doc.end();
  });
}

async function buildFleetListPdf(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = {
    ...(opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {}),
    ...(opts.includeAll ? { includeAll: true } : {}),
  };
  const defaultPdfColumns = ['contractor', 'sub_contractor', 'registration', 'make_model', 'fleet_no', 'trailer_1_reg_no', 'trailer_2_reg_no', 'integration_status', 'route_name'];
  const requestedColumns = Array.isArray(columns) && columns.length > 0
    ? columns.filter((c) => !['commodity_type', 'capacity_tonnes'].includes(String(c).toLowerCase()))
    : defaultPdfColumns;
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, requestedColumns, contractorId, contractorIds, listQ);
  const companyLabel = String(opts.companyName || '').trim() || 'Contractor';
  const title = opts.title ?? `${companyLabel} list – Fleet list`;
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${formatDateForAppTz(new Date())}`;
  return buildDistributionPdf(title, subtitle, headers, rows, keys);
}

async function buildDriverListPdf(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  const title = opts.title ?? 'Thinkers – Driver list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${formatDateForAppTz(new Date())}`;
  return buildDistributionPdf(title, subtitle, headers, rows, keys);
}

/** Plain-text body for distribution list email (same content as HTML template). */
function distributionListEmailText(listLabel, routeLabel) {
  return [
    'Thinkers',
    'Access management – List distribution',
    '',
    `Please find attached the ${listLabel}${routeLabel}.`,
    'Generated from Thinkers Access management.',
    '',
    'Monitoring Team',
    'For further inquiries please contact: vincent@thinkersafrika.co.za',
    '',
    'Thinkers Afrika Management System',
  ].join('\n');
}

/** Blue-themed HTML for distribution list email with Monitoring Team signature */
function distributionListEmailHtml(listLabel, routeLabel) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #e8f4fc;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #1e5a8e 0%, #2563eb 50%, #1d4ed8 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">Thinkers</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">Access management – List distribution</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
      <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">Please find attached the <strong>${escapeHtml(listLabel)}</strong>${escapeHtml(routeLabel)}.</p>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b;">Generated from Thinkers Access management.</p>
      <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #1e40af;">Monitoring Team</p>
        <p style="margin: 0; font-size: 13px; color: #475569;">For further inquiries please contact: <a href="mailto:vincent@thinkersafrika.co.za" style="color: #2563eb; text-decoration: none;">vincent@thinkersafrika.co.za</a></p>
      </div>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Thinkers Afrika Management System</p>
  </div>
</body>
</html>`;
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Email body for per-contractor distribution. titleOverride = route name (replaces "Thinkers" in header when provided). */
function distributionListEmailHtmlPerContractor(entries, titleOverride = null) {
  const title = titleOverride && String(titleOverride).trim() ? String(titleOverride).trim() : 'Thinkers';
  const listItems = entries.map((e) => `${escapeHtml(e.contractorName)} – ${escapeHtml(e.routeName)}`).join('</li><li>');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #e8f4fc;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #1e5a8e 0%, #2563eb 50%, #1d4ed8 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">${escapeHtml(title)}</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">List distribution (per company)</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
      <p style="margin: 0 0 12px 0; font-size: 15px; color: #334155; line-height: 1.5;">Please find attached the following lists (one per company enrolled on this route):</p>
      <ul style="margin: 0 0 24px 0; padding-left: 20px; font-size: 14px; color: #334155; line-height: 1.6;"><li>${listItems}</li></ul>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b;">File names: Route name, Company name, Date and time.</p>
      <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #1e40af;">Monitoring Team</p>
        <p style="margin: 0; font-size: 13px; color: #475569;">For further inquiries please contact: <a href="mailto:vincent@thinkersafrika.co.za" style="color: #2563eb; text-decoration: none;">vincent@thinkersafrika.co.za</a></p>
      </div>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Thinkers Afrika Management System</p>
  </div>
</body>
</html>`;
}

function distributionListEmailTextPerContractor(entries, titleOverride = null) {
  const title = titleOverride && String(titleOverride).trim() ? String(titleOverride).trim() : 'Thinkers';
  const lines = entries.map((e) => `• ${e.contractorName} – ${e.routeName}`);
  return [
    title,
    'List distribution (per company)',
    '',
    'Please find attached the following lists (one per company enrolled on this route):',
    ...lines,
    '',
    'File names: Route name, Company name, Date and time.',
    '',
    'Monitoring Team',
    'For further inquiries please contact: vincent@thinkersafrika.co.za',
    '',
    'Thinkers Afrika Management System',
  ].join('\n');
}

/** Same payload as POST /distribution/send-email. Used by HTTP handler and pilot scheduler. */
export async function distributionSendEmailInternal({ tenantId, userId, userName }, body) {
    const {
      recipients,
      cc: rawCc,
      list_type,
      route_ids,
      fleet_columns,
      driver_columns,
      format: attachFormat,
      send_per_contractor,
      contractor_ids: rawContractorIds,
      pilot_distribution: pilotDistributionBody,
      group_by: rawGroupBy,
    } = body || {};
    const groupByNorm = String(rawGroupBy || '').trim().toLowerCase();
    const groupBy = groupByNorm === 'sub_contractor' ? 'sub_contractor' : null;
    const pilotDist = pilotDistributionBody && typeof pilotDistributionBody === 'object' ? pilotDistributionBody : null;
    const uuidOk = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
    const pilotScheduleId = pilotDist?.schedule_id && uuidOk(pilotDist.schedule_id) ? String(pilotDist.schedule_id).trim().toLowerCase() : null;
    const pilotScheduleName = (pilotDist?.schedule_name || '').toString().trim().slice(0, 200) || null;
    if (!Array.isArray(recipients) || recipients.length === 0) return { ok: false, status: 400, error: 'recipients (array of emails) is required' };
    const listType = list_type === 'both' ? 'both' : list_type === 'driver' ? 'driver' : 'fleet';
    const routeIdsRaw = Array.isArray(route_ids) ? route_ids : (route_ids && typeof route_ids === 'string' ? route_ids.split(',').map((id) => id.trim()) : []);
    const routeIds = routeIdsRaw.map((id) => (id != null && typeof id !== 'object' ? String(id).trim() : '')).filter((id) => id.length > 0);
    const emails = [...new Set(recipients.map((e) => String(e).trim().toLowerCase()).filter((e) => e && e.includes('@')))];
    if (emails.length === 0) return { ok: false, status: 400, error: 'At least one valid recipient email is required' };
    const ccList = Array.isArray(rawCc) ? rawCc : (typeof rawCc === 'string' && rawCc.trim() ? rawCc.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e && e.includes('@')) : []);
    const ccEmails = ccList.length > 0 ? [...new Set(ccList.map((e) => String(e).trim().toLowerCase()).filter((e) => e && e.includes('@')))] : null;

    let fleetCols = Array.isArray(fleet_columns) && fleet_columns.length > 0
      ? FLEET_COLUMNS.filter((c) => fleet_columns.some((k) => String(k).toLowerCase() === c.key.toLowerCase())).map((c) => c.key)
      : null;
    let driverCols = Array.isArray(driver_columns) && driver_columns.length > 0
      ? DRIVER_COLUMNS.filter((c) => driver_columns.some((k) => String(k).toLowerCase() === c.key.toLowerCase())).map((c) => c.key)
      : null;
    // Grouping nests contractor -> sub_contractor banners, so both columns must be present in the dataset.
    // Auto-add them at the front of the chosen column list when the caller asked to group.
    if (groupBy === 'sub_contractor') {
      const ensureLeading = (list) => {
        const out = Array.isArray(list) ? list.filter((k) => k !== 'contractor' && k !== 'sub_contractor') : [];
        return ['contractor', 'sub_contractor', ...out];
      };
      if (Array.isArray(fleetCols)) fleetCols = ensureLeading(fleetCols);
      if (Array.isArray(driverCols)) driverCols = ensureLeading(driverCols);
    }
    const useExcel = attachFormat === 'excel';
    const usePdf = attachFormat === 'pdf';
    const ext = usePdf ? 'pdf' : useExcel ? 'xlsx' : 'csv';

    if (!isEmailConfigured()) return { ok: false, status: 503, error: 'Email is not configured. Set EMAIL_USER and EMAIL_PASS in .env.' };

    const perContractor = send_per_contractor === true && Array.isArray(rawContractorIds) && rawContractorIds.length > 0;
    const contractorIds = perContractor ? [...new Set(rawContractorIds.map((id) => String(id).trim()).filter(Boolean))] : [];

    let attachments = [];
    let bodyHtml;
    let bodyText;
    let subject;
    let routeIdsStr = routeIds.length > 0 ? routeIds.join(',') : null;
    const historyTenantId = tenantId;

    // When the user selected specific route(s): one attachment set per company that has fleet/drivers on that route; subject and title use route name.
    const hasSelectedRoutes = routeIds.length > 0;

    if (hasSelectedRoutes) {
      const placeholders = routeIds.map((_, i) => `@rid${i}`).join(',');
      const routeParams = Object.fromEntries(routeIds.map((id, i) => [`rid${i}`, id]));
      const routesResult = await query(
        `SELECT id, name FROM contractor_routes WHERE tenant_id = @tenantId AND id IN (${placeholders}) ORDER BY [order], name`,
        { tenantId, ...routeParams }
      );
      const routeRows = routesResult.recordset || [];
      const routeNameForSubject = routeRows.length === 1 ? (routeRows[0].name || 'Route') : (routeRows.length > 1 ? 'Selected routes' : 'Route');
      const routeNameForTitle = routeRows.length === 1 ? (routeRows[0].name || 'Route') : 'List distribution';

      const contractorsOnRouteResult = await query(
        `SELECT DISTINCT t.contractor_id AS cid FROM contractor_route_trucks rt
         INNER JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId
         WHERE rt.route_id IN (${placeholders})
         UNION
         SELECT DISTINCT d.contractor_id AS cid FROM contractor_route_drivers rd
         INNER JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId
         WHERE rd.route_id IN (${placeholders})`,
        { tenantId, ...routeParams }
      );
      let contractorIdsOnRoute = (contractorsOnRouteResult.recordset || []).map((r) => r.cid ?? r.contractor_id).filter(Boolean);
      if (contractorIdsOnRoute.length === 0) return { ok: false, status: 400, error: 'No companies have fleet or drivers enrolled on the selected route(s).' };

      // If user selected specific companies, only include those that are also on the selected route(s).
      if (contractorIds.length > 0) {
        const selectedSet = new Set(contractorIds.map((id) => String(id).trim()));
        contractorIdsOnRoute = contractorIdsOnRoute.filter((id) => selectedSet.has(String(id)));
        if (contractorIdsOnRoute.length === 0) return { ok: false, status: 400, error: 'None of the selected companies have fleet or drivers enrolled on the selected route(s).' };
      }

      const contractorsResult = await query(
        `SELECT id, name FROM contractors WHERE tenant_id = @tenantId AND id IN (${contractorIdsOnRoute.map((_, i) => `@c${i}`).join(',')}) ORDER BY name`,
        { tenantId, ...Object.fromEntries(contractorIdsOnRoute.map((id, i) => [`c${i}`, id])) }
      );
      const contractorsList = contractorsResult.recordset || [];
      const generated = new Date();
      const subtitle = `List distribution · Generated ${formatDateForAppTz(generated)}`;
      const entries = [];
      /** Full route roster for email/pilot (not restricted to facility_access=1 only). */
      const distListOpts = { includeRouteEnrollmentWithoutAccessFilter: true };

      for (const row of contractorsList) {
        const cid = row.id;
        const contractorName = row.name || 'Contractor';
        const listOpts = {
          title: `${contractorName} – ${routeNameForTitle}`,
          subtitle,
          contractorId: cid,
          companyName: contractorName,
          routeName: routeNameForTitle,
          generated,
          groupBy,
          ...distListOpts,
        };
        if (listType === 'both' && useExcel) {
          const buf = await buildFleetAndDriverListExcel(query, tenantId, routeIds, fleetCols, driverCols, listOpts);
          attachments.push({
            filename: distributionFilename(routeNameForTitle, contractorName, ext, 'lists'),
            content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
            encoding: 'base64',
          });
        } else {
          if (listType === 'fleet' || listType === 'both') {
            const buf = usePdf
              ? await buildFleetListPdf(query, tenantId, routeIds, fleetCols, listOpts)
              : useExcel
                ? await buildFleetListExcel(query, tenantId, routeIds, fleetCols, listOpts)
                : Buffer.from(await buildFleetListCsv(query, tenantId, routeIds, fleetCols, listOpts), 'utf8');
            attachments.push({
              filename: distributionFilename(routeNameForTitle, contractorName, ext, 'fleet'),
              content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
              encoding: 'base64',
            });
          }
          if (listType === 'driver' || listType === 'both') {
            const buf = usePdf
              ? await buildDriverListPdf(query, tenantId, routeIds, driverCols, listOpts)
              : useExcel
                ? await buildDriverListExcel(query, tenantId, routeIds, driverCols, listOpts)
                : Buffer.from(await buildDriverListCsv(query, tenantId, routeIds, driverCols, listOpts), 'utf8');
            attachments.push({
              filename: distributionFilename(routeNameForTitle, contractorName, ext, 'driver'),
              content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
              encoding: 'base64',
            });
          }
        }
        entries.push({ contractorName, routeName: routeNameForTitle });
      }

      subject = `${routeNameForSubject} lists publication`;
      bodyHtml = distributionListEmailHtmlPerContractor(entries, routeNameForTitle);
      bodyText = distributionListEmailTextPerContractor(entries, routeNameForTitle);
    } else if (perContractor && contractorIds.length > 0) {
      const contractorsResult = await query(
        `SELECT id, name, tenant_id FROM contractors WHERE id IN (${contractorIds.map((_, i) => `@cid${i}`).join(',')})`,
        Object.fromEntries(contractorIds.map((id, i) => [`cid${i}`, id]))
      );
      const contractorsList = contractorsResult.recordset || [];
      const entries = [];
      const generated = new Date();
      const subtitle = `Access management – List distribution · Generated ${formatDateForAppTz(generated)}`;

      for (const row of contractorsList) {
        const cid = row.id;
        const contractorName = row.name || 'Contractor';
        const tid = row.tenant_id;
        const routesResult = await query(
          `SELECT id, name FROM contractor_routes WHERE tenant_id = @tid ORDER BY [order], name`,
          { tid }
        );
        const routes = routesResult.recordset || [];
        const baseOpts = { subtitle, contractorId: cid, companyName: contractorName, generated, groupBy };
        if (routes.length === 0) {
          const routeLabel = 'All approved';
          const listOpts = { ...baseOpts, title: `${contractorName} – ${routeLabel}`, routeName: routeLabel };
          if (listType === 'both' && useExcel) {
            const buf = await buildFleetAndDriverListExcel(query, tid, null, fleetCols, driverCols, listOpts);
            attachments.push({
              filename: distributionFilename(routeLabel, contractorName, ext, 'lists'),
              content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
              encoding: 'base64',
            });
          } else {
            if (listType === 'fleet' || listType === 'both') {
              const buf = usePdf
                ? await buildFleetListPdf(query, tid, null, fleetCols, listOpts)
                : useExcel
                  ? await buildFleetListExcel(query, tid, null, fleetCols, listOpts)
                  : Buffer.from(await buildFleetListCsv(query, tid, null, fleetCols, listOpts), 'utf8');
              attachments.push({
                filename: distributionFilename(routeLabel, contractorName, ext, 'fleet'),
                content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
                encoding: 'base64',
              });
            }
            if (listType === 'driver' || listType === 'both') {
              const buf = usePdf
                ? await buildDriverListPdf(query, tid, null, driverCols, listOpts)
                : useExcel
                  ? await buildDriverListExcel(query, tid, null, driverCols, listOpts)
                  : Buffer.from(await buildDriverListCsv(query, tid, null, driverCols, listOpts), 'utf8');
              attachments.push({
                filename: distributionFilename(routeLabel, contractorName, ext, 'driver'),
                content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
                encoding: 'base64',
              });
            }
          }
          entries.push({ contractorName, routeName: routeLabel });
        } else {
          for (const r of routes) {
            const routeName = r.name || 'Route';
            const singleRoute = [r.id];
            const listOpts = {
              ...baseOpts,
              title: `${contractorName} – ${routeName}`,
              routeName,
              includeRouteEnrollmentWithoutAccessFilter: true,
            };
            if (listType === 'both' && useExcel) {
              const buf = await buildFleetAndDriverListExcel(query, tid, singleRoute, fleetCols, driverCols, listOpts);
              attachments.push({
                filename: distributionFilename(routeName, contractorName, ext, 'lists'),
                content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
                encoding: 'base64',
              });
            } else {
              if (listType === 'fleet' || listType === 'both') {
                const buf = usePdf
                  ? await buildFleetListPdf(query, tid, singleRoute, fleetCols, listOpts)
                  : useExcel
                    ? await buildFleetListExcel(query, tid, singleRoute, fleetCols, listOpts)
                    : Buffer.from(await buildFleetListCsv(query, tid, singleRoute, fleetCols, listOpts), 'utf8');
                attachments.push({
                  filename: distributionFilename(routeName, contractorName, ext, 'fleet'),
                  content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
                  encoding: 'base64',
                });
              }
              if (listType === 'driver' || listType === 'both') {
                const buf = usePdf
                  ? await buildDriverListPdf(query, tid, singleRoute, driverCols, listOpts)
                  : useExcel
                    ? await buildDriverListExcel(query, tid, singleRoute, driverCols, listOpts)
                    : Buffer.from(await buildDriverListCsv(query, tid, singleRoute, driverCols, listOpts), 'utf8');
                attachments.push({
                  filename: distributionFilename(routeName, contractorName, ext, 'driver'),
                  content: (typeof buf === 'object' && buf instanceof Buffer ? buf : Buffer.from(buf)).toString('base64'),
                  encoding: 'base64',
                });
              }
            }
            entries.push({ contractorName, routeName });
          }
        }
      }

      if (attachments.length === 0) return { ok: false, status: 400, error: 'No lists generated for selected contractors (no routes or data).' };
      subject = 'Lists per contractor – Thinkers';
      bodyHtml = distributionListEmailHtmlPerContractor(entries);
      bodyText = distributionListEmailTextPerContractor(entries);
    } else {
      const routeIdsForList = routeIds.length > 0 ? routeIds : null;
      const listOptsAll = {
        companyName: 'All companies',
        routeName: routeIdsForList ? (routeIds.length === 1 ? 'Selected route' : 'Selected routes') : 'All routes',
        generated: new Date(),
        groupBy,
      };
      if (listType === 'both' && useExcel) {
        const combinedBuffer = await buildFleetAndDriverListExcel(query, tenantId, routeIdsForList, fleetCols, driverCols, listOptsAll);
        attachments.push({
          filename: distributionFilename(listOptsAll.routeName, listOptsAll.companyName, ext),
          content: (typeof combinedBuffer === 'object' && combinedBuffer instanceof Buffer ? combinedBuffer : Buffer.from(combinedBuffer)).toString('base64'),
          encoding: 'base64',
        });
      } else {
        if (listType === 'fleet' || listType === 'both') {
          const fleetFilename = distributionFilename(listOptsAll.routeName, listOptsAll.companyName, ext, 'fleet');
          if (usePdf) {
            const fleetBuffer = await buildFleetListPdf(query, tenantId, routeIdsForList, fleetCols, listOptsAll);
            attachments.push({ filename: fleetFilename, content: fleetBuffer.toString('base64'), encoding: 'base64' });
          } else if (useExcel) {
            const fleetBuffer = await buildFleetListExcel(query, tenantId, routeIdsForList, fleetCols, listOptsAll);
            attachments.push({ filename: fleetFilename, content: fleetBuffer.toString('base64'), encoding: 'base64' });
          } else {
            const fleetCsv = await buildFleetListCsv(query, tenantId, routeIdsForList, fleetCols);
            attachments.push({ filename: fleetFilename, content: Buffer.from(fleetCsv, 'utf8').toString('base64'), encoding: 'base64' });
          }
        }
        if (listType === 'driver' || listType === 'both') {
          const driverFilename = distributionFilename(listOptsAll.routeName, listOptsAll.companyName, ext, 'driver');
          if (usePdf) {
            const driverBuffer = await buildDriverListPdf(query, tenantId, routeIdsForList, driverCols, listOptsAll);
            attachments.push({ filename: driverFilename, content: driverBuffer.toString('base64'), encoding: 'base64' });
          } else if (useExcel) {
            const driverBuffer = await buildDriverListExcel(query, tenantId, routeIdsForList, driverCols, listOptsAll);
            attachments.push({ filename: driverFilename, content: driverBuffer.toString('base64'), encoding: 'base64' });
          } else {
            const driverCsv = await buildDriverListCsv(query, tenantId, routeIdsForList, driverCols);
            attachments.push({ filename: driverFilename, content: Buffer.from(driverCsv, 'utf8').toString('base64'), encoding: 'base64' });
          }
        }
      }
      if (attachments.length === 0) return { ok: false, status: 400, error: 'list_type must be fleet, driver, or both' };

      const routeLabel = routeIds.length > 0 ? ` (${routeIds.length} route${routeIds.length !== 1 ? 's' : ''} selected)` : ' (all approved)';
      const listLabel = listType === 'both' ? 'Fleet and driver lists' : listType === 'fleet' ? 'Fleet list' : 'Driver list';
      subject = `${listLabel} – Thinkers`;
      bodyHtml = distributionListEmailHtml(listLabel.toLowerCase(), routeLabel);
      bodyText = distributionListEmailText(listLabel.toLowerCase(), routeLabel);
    }

    const formatForHistory = usePdf ? 'pdf' : useExcel ? 'excel' : 'csv';
    const emailBodyHtml = bodyHtml && bodyHtml.trim() ? bodyHtml : distributionListEmailHtml('list(s)', '');
    const emailBodyText = bodyText && bodyText.trim() ? bodyText : distributionListEmailText('list(s)', '');
    const sent = [];
    const failed = [];
    const histBase = {
      tenantId: historyTenantId,
      userId: userId || null,
      list_type: listType,
      route_ids: routeIdsStr,
      format: formatForHistory,
      created_by_name: userName,
    };
    for (const to of emails) {
      try {
        await sendEmail({ to, subject, body: emailBodyHtml, html: true, text: emailBodyText, attachments, cc: ccEmails });
        if (pilotScheduleId) {
          try {
            await query(
              `INSERT INTO access_distribution_history (tenant_id, created_by_user_id, list_type, route_ids, format, channel, recipient_email, recipient_phone, created_by_name, is_pilot_distribution, pilot_schedule_id, pilot_schedule_name)
               VALUES (@tenantId, @userId, @list_type, @route_ids, @format, 'email', @recipient_email, NULL, @created_by_name, 1, @pilotScheduleId, @pilotScheduleName)`,
              {
                ...histBase,
                recipient_email: to,
                pilotScheduleId,
                pilotScheduleName,
              }
            );
          } catch (histErr) {
            await query(
              `INSERT INTO access_distribution_history (tenant_id, created_by_user_id, list_type, route_ids, format, channel, recipient_email, recipient_phone, created_by_name)
               VALUES (@tenantId, @userId, @list_type, @route_ids, @format, 'email', @recipient_email, NULL, @created_by_name)`,
              { ...histBase, recipient_email: to }
            );
          }
        } else {
          await query(
            `INSERT INTO access_distribution_history (tenant_id, created_by_user_id, list_type, route_ids, format, channel, recipient_email, recipient_phone, created_by_name)
             VALUES (@tenantId, @userId, @list_type, @route_ids, @format, 'email', @recipient_email, NULL, @created_by_name)`,
            { ...histBase, recipient_email: to }
          );
        }
        sent.push(to);
      } catch (err) {
        console.error('[contractor/distribution] Send to', to, err?.message || err);
        failed.push({ email: to, error: err?.message || 'Send failed' });
      }
    }
    return { ok: true, sent: sent.length, failed: failed.length, sentTo: sent, failedTo: failed };
}

router.post('/distribution/send-email', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const r = await distributionSendEmailInternal(
      { tenantId, userId: req.user?.id, userName: req.user?.full_name || null },
      req.body
    );
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, sent: r.sent, failed: r.failed, sentTo: r.sentTo, failedTo: r.failedTo });
  } catch (err) {
    next(err);
  }
});

function requireAccessManagementPilot(req, res, next) {
  if (req.user?.role === 'super_admin') return next();
  const roles = Array.isArray(req.user?.page_roles) ? req.user.page_roles : [];
  if (roles.includes('access_management')) return next();
  return res.status(403).json({ error: 'Pilot distribution requires Access Management access.' });
}

router.get('/pilot-distribution', requireAccessManagementPilot, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const result = await query(
      `SELECT p.id, p.name, p.route_id, p.contractor_ids, p.recipient_emails, p.cc_emails,
              p.list_type, p.attach_format, p.fleet_columns_json, p.driver_columns_json, p.group_by,
              p.frequency, p.time_hhmm, p.weekday, p.is_active, p.last_run_at, p.last_run_status, p.last_run_detail,
              p.created_at, p.updated_at, r.name AS route_name
       FROM pilot_list_distribution p
       LEFT JOIN contractor_routes r ON CAST(r.id AS NVARCHAR(64)) = CAST(p.route_id AS NVARCHAR(64)) AND r.tenant_id = p.tenant_id
       WHERE p.tenant_id = @tenantId
       ORDER BY p.created_at DESC`,
      { tenantId }
    );
    res.json({ pilots: result.recordset || [] });
  } catch (err) {
    if (/Invalid object name|pilot_list_distribution/i.test(String(err.message || ''))) {
      return res.json({ pilots: [], migration_needed: true, migration_hint: 'npm run db:pilot-distribution' });
    }
    next(err);
  }
});

router.get('/pilot-distribution/history', requireAccessManagementPilot, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const result = await query(
      `SELECT TOP 400 id, created_at, recipient_email, list_type, format, route_ids, created_by_name,
              pilot_schedule_id, pilot_schedule_name
       FROM access_distribution_history
       WHERE tenant_id = @tenantId AND channel = N'email' AND ISNULL(is_pilot_distribution, 0) = 1
       ORDER BY created_at DESC`,
      { tenantId }
    );
    res.json({ history: result.recordset || [] });
  } catch (err) {
    const msg = String(err?.message || '');
    if (/is_pilot_distribution|pilot_schedule|Invalid column/i.test(msg)) {
      return res.json({
        history: [],
        migration_needed: true,
        migration_hint: 'npm run db:access-distribution-pilot',
      });
    }
    next(err);
  }
});

router.post('/pilot-distribution', requireAccessManagementPilot, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const userId = req.user?.id || null;
    const {
      name,
      route_id: routeId,
      contractor_ids: contractorIdsIn,
      recipient_emails: recipientsIn,
      cc_emails: ccIn,
      list_type,
      attach_format: attachFormat,
      fleet_columns,
      driver_columns,
      group_by: rawGroupBy,
      frequency,
      time_hhmm: timeHhmm,
      weekday,
    } = req.body || {};
    const groupByNorm = String(rawGroupBy || '').trim().toLowerCase();
    const groupBy = groupByNorm === 'sub_contractor' ? 'sub_contractor' : null;
    if (!routeId || !String(routeId).trim()) return res.status(400).json({ error: 'route_id is required' });
    const contractorIds = Array.isArray(contractorIdsIn)
      ? contractorIdsIn.map((x) => String(x).trim()).filter(Boolean)
      : String(contractorIdsIn || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
    if (contractorIds.length === 0) return res.status(400).json({ error: 'Select at least one company' });
    const recipients = String(recipientsIn || '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e.includes('@'));
    if (recipients.length === 0) return res.status(400).json({ error: 'At least one recipient email is required' });
    const freq = String(frequency || '').toLowerCase();
    if (!['hourly', 'daily', 'weekly'].includes(freq)) return res.status(400).json({ error: 'frequency must be hourly, daily, or weekly' });
    const lt = list_type === 'driver' ? 'driver' : list_type === 'fleet' ? 'fleet' : 'both';
    const fmt = attachFormat === 'pdf' ? 'pdf' : attachFormat === 'csv' ? 'csv' : 'excel';
    const tm = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(timeHhmm || '').trim()) ? String(timeHhmm).trim() : '09:00';
    let wd = null;
    if (freq === 'weekly') {
      const w = parseInt(String(weekday), 10);
      if (Number.isNaN(w) || w < 1 || w > 7) return res.status(400).json({ error: 'For weekly schedule, weekday is required (1=Mon … 7=Sun)' });
      wd = w;
    }
    const fleetJson = JSON.stringify(Array.isArray(fleet_columns) ? fleet_columns : []);
    const driverJson = JSON.stringify(Array.isArray(driver_columns) ? driver_columns : []);
    const ccStr = ccIn
      ? [...new Set(String(ccIn).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e && e.includes('@')))].join(', ')
      : null;
    const id = randomUUID();
    await query(
      `INSERT INTO pilot_list_distribution (id, tenant_id, created_by_user_id, name, route_id, contractor_ids, recipient_emails, cc_emails,
        list_type, attach_format, fleet_columns_json, driver_columns_json, group_by, frequency, time_hhmm, weekday, is_active)
       VALUES (@id, @tenantId, @userId, @name, @routeId, @contractorIds, @recipients, @cc, @lt, @fmt, @fleetJson, @driverJson, @groupBy, @freq, @tm, @wd, 1)`,
      {
        id,
        tenantId,
        userId,
        name: (name && String(name).trim().slice(0, 200)) || null,
        routeId: String(routeId).trim(),
        contractorIds: contractorIds.join(','),
        recipients: [...new Set(recipients)].join(','),
        cc: ccStr,
        lt,
        fmt,
        fleetJson,
        driverJson,
        groupBy,
        freq,
        tm,
        wd,
      }
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    if (/Invalid object name|pilot_list_distribution/i.test(String(err.message || ''))) {
      return res.status(503).json({ error: 'Run database migration: npm run db:pilot-distribution' });
    }
    next(err);
  }
});

router.patch('/pilot-distribution/:id', requireAccessManagementPilot, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    const { id } = req.params;
    const chk = await query(`SELECT id FROM pilot_list_distribution WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!chk.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const sets = [];
    const params = { id, tenantId };
    if (b.name !== undefined) {
      sets.push('name = @name');
      params.name = String(b.name || '').trim().slice(0, 200) || null;
    }
    if (b.is_active !== undefined) {
      sets.push('is_active = @active');
      params.active = b.is_active ? 1 : 0;
    }
    if (b.route_id !== undefined) {
      sets.push('route_id = @routeId');
      params.routeId = String(b.route_id).trim();
    }
    if (b.contractor_ids !== undefined) {
      const ids = Array.isArray(b.contractor_ids) ? b.contractor_ids : String(b.contractor_ids).split(',');
      const cj = ids.map((x) => String(x).trim()).filter(Boolean).join(',');
      sets.push('contractor_ids = @cids');
      params.cids = cj;
    }
    if (b.recipient_emails !== undefined) {
      sets.push('recipient_emails = @rec');
      params.rec = String(b.recipient_emails || '');
    }
    if (b.cc_emails !== undefined) {
      sets.push('cc_emails = @cc');
      params.cc = String(b.cc_emails || '').trim() || null;
    }
    if (b.list_type !== undefined) {
      sets.push('list_type = @lt');
      params.lt = b.list_type === 'driver' ? 'driver' : b.list_type === 'fleet' ? 'fleet' : 'both';
    }
    if (b.attach_format !== undefined) {
      sets.push('attach_format = @fmt');
      params.fmt = b.attach_format === 'pdf' ? 'pdf' : b.attach_format === 'csv' ? 'csv' : 'excel';
    }
    if (b.fleet_columns !== undefined) {
      sets.push('fleet_columns_json = @fj');
      params.fj = JSON.stringify(Array.isArray(b.fleet_columns) ? b.fleet_columns : []);
    }
    if (b.driver_columns !== undefined) {
      sets.push('driver_columns_json = @dj');
      params.dj = JSON.stringify(Array.isArray(b.driver_columns) ? b.driver_columns : []);
    }
    if (b.group_by !== undefined) {
      const g = String(b.group_by || '').trim().toLowerCase();
      sets.push('group_by = @gb');
      params.gb = g === 'sub_contractor' ? 'sub_contractor' : null;
    }
    if (b.frequency !== undefined) {
      const f = String(b.frequency).toLowerCase();
      if (!['hourly', 'daily', 'weekly'].includes(f)) return res.status(400).json({ error: 'Invalid frequency' });
      sets.push('frequency = @freq');
      params.freq = f;
    }
    if (b.time_hhmm !== undefined) {
      sets.push('time_hhmm = @tm');
      params.tm = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(b.time_hhmm).trim()) ? String(b.time_hhmm).trim() : '09:00';
    }
    if (b.weekday !== undefined) {
      sets.push('weekday = @wd');
      const w = parseInt(String(b.weekday), 10);
      params.wd = Number.isNaN(w) ? null : Math.min(7, Math.max(1, w));
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE pilot_list_distribution SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/pilot-distribution/:id', requireAccessManagementPilot, async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required.' });
    await query(`DELETE FROM pilot_list_distribution WHERE id = @id AND tenant_id = @tenantId`, { id: req.params.id, tenantId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET distribution history export CSV */
router.get('/distribution-history/export', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { dateFrom, dateTo, routeId, listType, channel } = req.query;
    let sql = `SELECT h.created_at, h.list_type, h.route_ids, h.format, h.channel, h.recipient_email, h.recipient_phone, h.created_by_name FROM access_distribution_history h WHERE h.tenant_id = @tenantId`;
    const params = { tenantId };
    if (dateFrom) { sql += ` AND h.created_at >= @dateFrom`; params.dateFrom = new Date(dateFrom).toISOString(); }
    if (dateTo) { sql += ` AND h.created_at < DATEADD(day, 1, CAST(@dateTo AS DATE))`; params.dateTo = toYmdFromDbOrString(new Date(dateTo)); }
    if (routeId) { sql += ` AND (h.route_ids = @routeId OR h.route_ids LIKE @routeIdPrefix OR h.route_ids LIKE @routeIdSuffix OR h.route_ids LIKE @routeIdMid)`; params.routeId = routeId; params.routeIdPrefix = routeId + ',%'; params.routeIdSuffix = '%,' + routeId; params.routeIdMid = '%,' + routeId + ',%'; }
    if (listType && ['fleet', 'driver', 'both'].includes(listType)) { sql += ` AND h.list_type = @listType`; params.listType = listType; }
    if (channel && ['download', 'email', 'whatsapp'].includes(channel)) { sql += ` AND h.channel = @channel`; params.channel = channel; }
    sql += ` ORDER BY h.created_at DESC`;
    const result = await query(sql, params);
    const rows = result.recordset || [];
    const headers = ['Date', 'List type', 'Routes', 'Format', 'Channel', 'Recipient email', 'Recipient phone', 'Created by'];
    const csv = [headers.join(',')].concat(
      rows.map((r) =>
        [
          r.created_at ? new Date(r.created_at).toISOString() : '',
          r.list_type || '',
          r.route_ids || '',
          r.format || '',
          r.channel || '',
          r.recipient_email || '',
          r.recipient_phone || '',
          (r.created_by_name || '').replace(/"/g, '""'),
        ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
      )
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="distribution-history.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
});

// --- Contractor information (company details, CIPC, admin, control room, mechanic, emergency) ---
router.get('/info', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT * FROM contractor_info WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) {
      return res.json({ info: null });
    }
    const toCamel = (r) => {
      if (!r) return null;
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        o[camel] = v;
      }
      return o;
    };
    res.json({ info: toCamel(row) });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.json({ info: null });
    next(err);
  }
});

router.patch('/info', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const fields = [
      'company_name', 'cipc_registration_number', 'cipc_registration_date',
      'admin_name', 'admin_email', 'admin_phone',
      'control_room_contact', 'control_room_phone', 'control_room_email',
      'mechanic_name', 'mechanic_phone', 'mechanic_email',
      'emergency_contact_1_name', 'emergency_contact_1_phone',
      'emergency_contact_2_name', 'emergency_contact_2_phone',
      'emergency_contact_3_name', 'emergency_contact_3_phone',
    ];
    const updates = [];
    const params = { tenantId };
    for (const f of fields) {
      if (b[f] !== undefined) {
        updates.push(`${f} = @${f}`);
        params[f] = b[f] === '' || b[f] == null ? null : b[f];
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    const exists = await query(`SELECT id FROM contractor_info WHERE tenant_id = @tenantId`, { tenantId });
    if (!exists.recordset?.length) {
      await query(
        `INSERT INTO contractor_info (tenant_id, ${fields.join(', ')}) VALUES (@tenantId, ${fields.map((f) => `@${f}`).join(', ')})`,
        { ...params, ...Object.fromEntries(fields.map((f) => [f, params[f] ?? null])) }
      );
    } else {
      await query(
        `UPDATE contractor_info SET ${updates.join(', ')}, updated_at = SYSUTCDATETIME() WHERE tenant_id = @tenantId`,
        params
      );
    }
    const getResult = await query(`SELECT * FROM contractor_info WHERE tenant_id = @tenantId`, { tenantId });
    const row = getResult.recordset?.[0];
    const toCamel = (r) => {
      if (!r) return null;
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
      }
      return o;
    };
    res.json({ info: toCamel(row) });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.status(503).json({ error: 'Contractor info table not set up. Run: npm run db:contractor-info-library' });
    next(err);
  }
});

// --- Subcontractor fleet (contractor reviews before Fleet tab + Command Centre) ---
router.get('/subcontractor-fleets', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required' });
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) {
      return res.status(403).json({ error: 'Only main contractor users can review subcontractor fleet submissions.' });
    }
    const allowed = await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) return res.json({ trucks: [], subcontractors: [] });

    const { status = 'pending_contractor', subcontractor_id: filterSubId, search = '', sort = 'created_at', order = 'desc' } = req.query || {};
    const params = { tenantId };
    let sql = `SELECT t.id, t.registration, t.make_model, t.fleet_no, t.sub_contractor, t.subcontractor_id,
        t.contractor_approval_status, t.contractor_reviewed_at, t.contractor_decline_reason, t.created_at,
        t.trailer_1_reg_no, t.trailer_2_reg_no, t.commodity_type,
        sc.company_name AS subcontractor_company_name, co.name AS contractor_company_name,
        u.full_name AS added_by_name
       FROM contractor_trucks t
       LEFT JOIN contractor_subcontractors sc ON sc.id = t.subcontractor_id
       LEFT JOIN contractors co ON co.id = t.contractor_id
       LEFT JOIN users u ON u.id = t.added_by_user_id
       WHERE t.tenant_id = @tenantId AND t.subcontractor_id IS NOT NULL`;

    if (status && status !== 'all') {
      sql += ` AND t.contractor_approval_status = @status`;
      params.status = status;
    }
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${ph})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    if (filterSubId) {
      sql += ` AND t.subcontractor_id = @filterSubId`;
      params.filterSubId = filterSubId;
    }
    const q = String(search || '').trim();
    if (q) {
      sql += ` AND (t.registration LIKE @search OR sc.company_name LIKE @search OR t.make_model LIKE @search OR t.fleet_no LIKE @search)`;
      params.search = `%${q}%`;
    }
    const validSort = ['created_at', 'registration', 'sub_contractor'].includes(sort) ? sort : 'created_at';
    const ord = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortCol = validSort === 'sub_contractor' ? 'sc.company_name' : `t.${validSort}`;
    sql += ` ORDER BY ${sortCol} ${ord}`;

    const trResult = await query(sql, params);
    let subList = [];
    try {
      let subSql = `SELECT DISTINCT s.id, s.company_name FROM contractor_subcontractors s
        INNER JOIN contractor_trucks t ON t.subcontractor_id = s.id AND t.tenant_id = @tenantId`;
      const subParams = { tenantId };
      if (allowed && allowed.length > 0) {
        const ph = allowed.map((_, i) => `@sc${i}`).join(',');
        subSql += ` WHERE s.contractor_id IN (${ph}) OR s.contractor_id IS NULL`;
        allowed.forEach((id, i) => { subParams[`sc${i}`] = id; });
      }
      subSql += ' ORDER BY s.company_name';
      const subResult = await query(subSql, subParams);
      subList = (subResult.recordset || []).map((r) => ({ id: r.id ?? r.Id, company_name: r.company_name ?? r.Company_Name }));
    } catch (_) {}

    res.json({ trucks: trResult.recordset || [], subcontractors: subList });
  } catch (err) {
    next(err);
  }
});

router.patch('/subcontractor-fleets/:id/approve', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    const allowed = await getAllowedContractorIds(req);
    const chk = await query(
      `SELECT t.id, t.registration, t.contractor_id, t.contractor_approval_status
       FROM contractor_trucks t WHERE t.id = @id AND t.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = chk.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Truck not found' });
    if (allowed && allowed.length > 0) {
      const cid = row.contractor_id ?? row.Contractor_Id;
      if (!allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return res.status(403).json({ error: 'Not permitted for this contractor' });
      }
    }
    const st = row.contractor_approval_status ?? row.Contractor_Approval_Status;
    if (st !== 'pending_contractor') {
      return res.status(400).json({ error: 'This truck is not awaiting contractor approval.' });
    }
    const upd = await query(
      `UPDATE contractor_trucks SET contractor_approval_status = N'approved_contractor',
        contractor_reviewed_at = SYSUTCDATETIME(), contractor_reviewed_by_user_id = @userId,
        contractor_decline_reason = NULL, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, userId: req.user.id }
    );
    const truck = upd.recordset?.[0];
    if (truck?.id) await createFleetApplication(tenantId, 'truck', truck.id, 'manual', req.user?.id);
    const contractorName = await getContractorName(truck.contractor_id ?? truck.Contractor_Id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'truck', [truck.registration || truck.Registration].filter(Boolean), req.user?.email);
    res.json({ truck, message: 'Approved. Truck is now on your Fleet tab and submitted for facility access review.' });
  } catch (err) {
    next(err);
  }
});

router.patch('/subcontractor-fleets/:id/decline', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Decline reason is required' });
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) return res.status(403).json({ error: 'Not permitted' });
    const allowed = await getAllowedContractorIds(req);
    const chk = await query(
      `SELECT t.id, t.contractor_id, t.contractor_approval_status FROM contractor_trucks t WHERE t.id = @id AND t.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = chk.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Truck not found' });
    if (allowed && allowed.length > 0) {
      const cid = row.contractor_id ?? row.Contractor_Id;
      if (!allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return res.status(403).json({ error: 'Not permitted' });
      }
    }
    const upd = await query(
      `UPDATE contractor_trucks SET contractor_approval_status = N'declined_contractor',
        contractor_reviewed_at = SYSUTCDATETIME(), contractor_reviewed_by_user_id = @userId,
        contractor_decline_reason = @reason, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, userId: req.user.id, reason }
    );
    res.json({ truck: upd.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

// --- Subcontractor drivers (contractor reviews before Driver register) ---
router.get('/subcontractor-drivers', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Tenant required' });
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) {
      return res.status(403).json({ error: 'Only main contractor users can review subcontractor driver submissions.' });
    }
    const allowed = await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) return res.json({ drivers: [], subcontractors: [] });

    const { status = 'pending_contractor', subcontractor_id: filterSubId, search = '', sort = 'created_at', order = 'desc' } = req.query || {};
    const params = { tenantId };
    let sql = `SELECT d.id, d.full_name, d.surname, d.id_number, d.license_number, d.license_expiry, d.phone, d.email,
        d.contractor_approval_status, d.contractor_reviewed_at, d.contractor_decline_reason, d.created_at,
        d.linked_truck_id, t.registration AS linked_truck_registration,
        sc.company_name AS subcontractor_company_name, co.name AS contractor_company_name,
        u.full_name AS added_by_name
       FROM contractor_drivers d
       LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
       LEFT JOIN contractor_subcontractors sc ON sc.id = d.subcontractor_id
       LEFT JOIN contractors co ON co.id = d.contractor_id
       LEFT JOIN users u ON u.id = d.added_by_user_id
       WHERE d.tenant_id = @tenantId AND d.subcontractor_id IS NOT NULL`;

    if (status && status !== 'all') {
      sql += ` AND d.contractor_approval_status = @status`;
      params.status = status;
    }
    if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND d.contractor_id IN (${ph})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    if (filterSubId) {
      sql += ` AND d.subcontractor_id = @filterSubId`;
      params.filterSubId = filterSubId;
    }
    const q = String(search || '').trim();
    if (q) {
      sql += ` AND (d.full_name LIKE @search OR d.surname LIKE @search OR d.id_number LIKE @search OR d.license_number LIKE @search OR sc.company_name LIKE @search)`;
      params.search = `%${q}%`;
    }
    const validSort = ['created_at', 'full_name'].includes(sort) ? sort : 'created_at';
    const ord = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortCol = validSort === 'full_name' ? 'd.full_name' : `d.${validSort}`;
    sql += ` ORDER BY ${sortCol} ${ord}`;

    const drResult = await query(sql, params);
    let subList = [];
    try {
      let subSql = `SELECT DISTINCT s.id, s.company_name FROM contractor_subcontractors s
        INNER JOIN contractor_drivers d ON d.subcontractor_id = s.id AND d.tenant_id = @tenantId`;
      const subParams = { tenantId };
      if (allowed && allowed.length > 0) {
        const ph = allowed.map((_, i) => `@sc${i}`).join(',');
        subSql += ` WHERE s.contractor_id IN (${ph}) OR s.contractor_id IS NULL`;
        allowed.forEach((id, i) => { subParams[`sc${i}`] = id; });
      }
      subSql += ' ORDER BY s.company_name';
      const subResult = await query(subSql, subParams);
      subList = (subResult.recordset || []).map((r) => ({ id: r.id ?? r.Id, company_name: r.company_name ?? r.Company_Name }));
    } catch (_) {}

    res.json({ drivers: drResult.recordset || [], subcontractors: subList });
  } catch (err) {
    next(err);
  }
});

router.patch('/subcontractor-drivers/:id/approve', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) return res.status(403).json({ error: 'Not permitted' });
    const allowed = await getAllowedContractorIds(req);
    const chk = await query(
      `SELECT d.id, d.full_name, d.surname, d.contractor_id, d.contractor_approval_status
       FROM contractor_drivers d WHERE d.id = @id AND d.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = chk.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Driver not found' });
    if (allowed && allowed.length > 0) {
      const cid = row.contractor_id ?? row.Contractor_Id;
      if (!allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return res.status(403).json({ error: 'Not permitted for this contractor' });
      }
    }
    const st = row.contractor_approval_status ?? row.Contractor_Approval_Status;
    if (st !== 'pending_contractor') {
      return res.status(400).json({ error: 'This driver is not awaiting contractor approval.' });
    }
    const upd = await query(
      `UPDATE contractor_drivers SET contractor_approval_status = N'approved_contractor',
        contractor_reviewed_at = SYSUTCDATETIME(), contractor_reviewed_by_user_id = @userId,
        contractor_decline_reason = NULL, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, userId: req.user.id }
    );
    const driver = upd.recordset?.[0];
    if (driver?.id) await createFleetApplication(tenantId, 'driver', driver.id, 'manual', req.user?.id);
    const driverLabel = [driver.full_name, driver.surname].filter(Boolean).join(' ').trim() || 'Driver';
    const contractorName = await getContractorName(driver.contractor_id ?? driver.Contractor_Id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'driver', [driverLabel], req.user?.email);
    res.json({ driver, message: 'Approved. Driver is now on your Driver register and submitted for facility access review.' });
  } catch (err) {
    next(err);
  }
});

router.patch('/subcontractor-drivers/:id/decline', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Decline reason is required' });
    const subcontractorIds = await getRequestSubcontractorIds(req);
    if (isSubcontractorPortalUser(subcontractorIds)) return res.status(403).json({ error: 'Not permitted' });
    const allowed = await getAllowedContractorIds(req);
    const chk = await query(
      `SELECT d.id, d.contractor_id, d.contractor_approval_status FROM contractor_drivers d WHERE d.id = @id AND d.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = chk.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Driver not found' });
    if (allowed && allowed.length > 0) {
      const cid = row.contractor_id ?? row.Contractor_Id;
      if (!allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return res.status(403).json({ error: 'Not permitted' });
      }
    }
    const upd = await query(
      `UPDATE contractor_drivers SET contractor_approval_status = N'declined_contractor',
        contractor_reviewed_at = SYSUTCDATETIME(), contractor_reviewed_by_user_id = @userId,
        contractor_decline_reason = @reason, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, userId: req.user.id, reason }
    );
    res.json({ driver: upd.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

// --- Subcontractors ---
router.get('/subcontractors', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const allowed = await getAllowedContractorIds(req);
    const filterContractorId = req.query.contractor_id ? String(req.query.contractor_id).trim() : null;
    let sql = `SELECT * FROM contractor_subcontractors WHERE tenant_id = @tenantId`;
    const params = { tenantId };
    if (filterContractorId) {
      sql += ` AND contractor_id = @contractorId`;
      params.contractorId = filterContractorId;
    } else if (allowed && allowed.length > 0) {
      const ph = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND (contractor_id IN (${ph}) OR contractor_id IS NULL)`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    sql += ` ORDER BY [order_index] ASC, company_name ASC`;
    const result = await query(sql, params);
    res.json({ subcontractors: result.recordset || [] });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.json({ subcontractors: [] });
    next(err);
  }
});

router.post('/subcontractors', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const contractorId = b.contractor_id ? await resolveContractorIdForCreate(req, b.contractor_id) : null;
    const result = await query(
      `INSERT INTO contractor_subcontractors (tenant_id, contractor_id, company_name, contact_person, contact_phone, contact_email, control_room_contact, control_room_phone, mechanic_name, mechanic_phone, emergency_contact_name, emergency_contact_phone, [order_index])
       OUTPUT INSERTED.* VALUES (@tenantId, @contractor_id, @company_name, @contact_person, @contact_phone, @contact_email, @control_room_contact, @control_room_phone, @mechanic_name, @mechanic_phone, @emergency_contact_name, @emergency_contact_phone, @order_index)`,
      {
        tenantId,
        contractor_id: contractorId || null,
        company_name: b.company_name ?? '',
        contact_person: b.contact_person ?? null,
        contact_phone: b.contact_phone ?? null,
        contact_email: b.contact_email ?? null,
        control_room_contact: b.control_room_contact ?? null,
        control_room_phone: b.control_room_phone ?? null,
        mechanic_name: b.mechanic_name ?? null,
        mechanic_phone: b.mechanic_phone ?? null,
        emergency_contact_name: b.emergency_contact_name ?? null,
        emergency_contact_phone: b.emergency_contact_phone ?? null,
        order_index: b.order_index != null ? parseInt(b.order_index, 10) : 0,
      }
    );
    res.status(201).json({ subcontractor: result.recordset[0] });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.status(503).json({ error: 'Run: npm run db:contractor-info-library' });
    next(err);
  }
});

router.patch('/subcontractors/:id', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const b = req.body || {};
    const fields = ['company_name', 'contact_person', 'contact_phone', 'contact_email', 'control_room_contact', 'control_room_phone', 'mechanic_name', 'mechanic_phone', 'emergency_contact_name', 'emergency_contact_phone', 'order_index'];
    const updates = [];
    const params = { id, tenantId };
    for (const f of fields) {
      if (b[f] !== undefined) {
        updates.push(`${f} = @${f}`);
        params[f] = f === 'order_index' ? (b[f] != null ? parseInt(b[f], 10) : 0) : (b[f] === '' || b[f] == null ? null : b[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    const result = await query(
      `UPDATE contractor_subcontractors SET ${updates.join(', ')}, updated_at = SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Subcontractor not found' });
    res.json({ subcontractor: result.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/subcontractors/:id', async (req, res, next) => {
  try {
    if (await rejectSubcontractorPortalUser(req, res)) return;
    const { id } = req.params;
    await query(`DELETE FROM contractor_subcontractors WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: getTenantId(req) });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Contractor library (document uploads by type) ---
const LIBRARY_DOCUMENT_TYPES = [
  'operating_licence', 'insurance', 'cipc_certificate', 'tax_clearance', 'safety_certificate',
  'vehicle_registrations', 'driver_licences', 'contracts', 'permits', 'other',
];

/** Validate optional link to truck/driver; returns { ok, linked_entity_type, linked_entity_id } or { error }. */
async function assertLibraryEntityLink(req, tenantId, entityTypeRaw, entityIdRaw) {
  const et = entityTypeRaw != null && String(entityTypeRaw).trim() ? String(entityTypeRaw).trim().toLowerCase() : '';
  const eid = entityIdRaw != null && String(entityIdRaw).trim() ? String(entityIdRaw).trim() : '';
  if (!et && !eid) return { ok: true, linked_entity_type: null, linked_entity_id: null };
  if (!et || !eid) return { error: 'Provide both linked_entity_type (truck or driver) and linked_entity_id, or leave both empty.' };
  if (et !== 'truck' && et !== 'driver') return { error: 'linked_entity_type must be truck or driver' };
  const allowed = await getAllowedContractorIds(req);
  if (et === 'truck') {
    const r = await query(
      `SELECT id, contractor_id FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
      { id: eid, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return { error: 'Truck not found for this tenant' };
    const cid = getRow(row, 'contractor_id');
    if (allowed && allowed.length > 0) {
      if (!cid || !allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return { error: 'You cannot link to this truck' };
      }
    }
  } else {
    const r = await query(
      `SELECT id, contractor_id FROM contractor_drivers WHERE id = @id AND tenant_id = @tenantId`,
      { id: eid, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return { error: 'Driver not found for this tenant' };
    const cid = getRow(row, 'contractor_id');
    if (allowed && allowed.length > 0) {
      if (!cid || !allowed.some((a) => String(a).toLowerCase() === String(cid).toLowerCase())) {
        return { error: 'You cannot link to this driver' };
      }
    }
  }
  return { ok: true, linked_entity_type: et, linked_entity_id: eid };
}

router.get('/library/document-types', (req, res) => {
  res.json({ documentTypes: LIBRARY_DOCUMENT_TYPES });
});

router.get('/library', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const filterType = req.query?.linked_entity_type ? String(req.query.linked_entity_type).trim().toLowerCase() : '';
    const filterId = req.query?.linked_entity_id ? String(req.query.linked_entity_id).trim() : '';
    let sql = `
      SELECT d.id, d.document_type, d.file_name, d.stored_path, d.file_size, d.mime_type, d.created_at,
        d.linked_entity_type, d.linked_entity_id,
        tr.registration AS linked_truck_registration,
        dr.full_name AS linked_driver_name, dr.surname AS linked_driver_surname
      FROM contractor_library_documents d
      LEFT JOIN contractor_trucks tr ON tr.id = d.linked_entity_id AND d.linked_entity_type = N'truck' AND tr.tenant_id = d.tenant_id
      LEFT JOIN contractor_drivers dr ON dr.id = d.linked_entity_id AND d.linked_entity_type = N'driver' AND dr.tenant_id = d.tenant_id
      WHERE d.tenant_id = @tenantId`;
    const params = { tenantId };
    if (filterType && filterId && (filterType === 'truck' || filterType === 'driver')) {
      sql += ` AND d.linked_entity_type = @filterType AND d.linked_entity_id = @filterId`;
      params.filterType = filterType;
      params.filterId = filterId;
    }
    sql += ` ORDER BY d.document_type ASC, d.created_at DESC`;
    const result = await query(sql, params);
    res.json({ documents: result.recordset || [] });
  } catch (err) {
    if (String(err.message || '').includes('linked_entity')) {
      try {
        const tenantId = getTenantId(req);
        const result = await query(
          `SELECT id, document_type, file_name, stored_path, file_size, mime_type, created_at FROM contractor_library_documents WHERE tenant_id = @tenantId ORDER BY document_type ASC, created_at DESC`,
          { tenantId }
        );
        return res.json({ documents: result.recordset || [], migrationRequired: true });
      } catch (e2) {
        /* fall through */
      }
    }
    if (err.message?.includes('Invalid object name')) return res.json({ documents: [] });
    next(err);
  }
});

router.post('/library', (req, res, next) => {
  contractorLibraryUpload(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "file" and optionally "document_type".' });
    const tenantId = getTenantId(req);
    const documentType = (req.body?.document_type || 'other').trim() || 'other';
    const linkCheck = await assertLibraryEntityLink(req, tenantId, req.body?.linked_entity_type, req.body?.linked_entity_id);
    if (linkCheck.error) return res.status(400).json({ error: linkCheck.error });
    const relativePath = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).split(path.sep).join('/');
    let insertSql = `INSERT INTO contractor_library_documents (tenant_id, document_type, file_name, stored_path, file_size, mime_type`;
    const insParams = {
      tenantId,
      document_type: documentType,
      file_name: req.file.originalname || req.file.filename,
      stored_path: relativePath,
      file_size: req.file.size || null,
      mime_type: req.file.mimetype || null,
    };
    if (linkCheck.linked_entity_type && linkCheck.linked_entity_id) {
      insertSql += `, linked_entity_type, linked_entity_id) VALUES (@tenantId, @document_type, @file_name, @stored_path, @file_size, @mime_type, @linked_entity_type, @linked_entity_id)`;
      insParams.linked_entity_type = linkCheck.linked_entity_type;
      insParams.linked_entity_id = linkCheck.linked_entity_id;
    } else {
      insertSql += `) VALUES (@tenantId, @document_type, @file_name, @stored_path, @file_size, @mime_type)`;
    }
    try {
      await query(insertSql, insParams);
    } catch (e) {
      if (String(e.message || '').includes('linked_entity')) {
        await query(
          `INSERT INTO contractor_library_documents (tenant_id, document_type, file_name, stored_path, file_size, mime_type) VALUES (@tenantId, @document_type, @file_name, @stored_path, @file_size, @mime_type)`,
          {
            tenantId: insParams.tenantId,
            document_type: insParams.document_type,
            file_name: insParams.file_name,
            stored_path: insParams.stored_path,
            file_size: insParams.file_size,
            mime_type: insParams.mime_type,
          }
        );
      } else {
        throw e;
      }
    }
    const getResult = await query(
      `SELECT TOP 1 d.id, d.document_type, d.file_name, d.stored_path, d.file_size, d.mime_type, d.created_at,
        d.linked_entity_type, d.linked_entity_id,
        tr.registration AS linked_truck_registration,
        dr.full_name AS linked_driver_name, dr.surname AS linked_driver_surname
       FROM contractor_library_documents d
       LEFT JOIN contractor_trucks tr ON tr.id = d.linked_entity_id AND d.linked_entity_type = N'truck' AND tr.tenant_id = d.tenant_id
       LEFT JOIN contractor_drivers dr ON dr.id = d.linked_entity_id AND d.linked_entity_type = N'driver' AND dr.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId ORDER BY d.created_at DESC`,
      { tenantId }
    );
    res.status(201).json({ document: getResult.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** PATCH link (or clear link) for an existing library document */
router.patch('/library/:id/link', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const existing = await query(`SELECT id FROM contractor_library_documents WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Document not found' });
    const clear = req.body?.clear === true || req.body?.linked_entity_type === '' || req.body?.linked_entity_type === null;
    let linkCheck;
    if (clear) {
      linkCheck = { ok: true, linked_entity_type: null, linked_entity_id: null };
    } else {
      linkCheck = await assertLibraryEntityLink(req, tenantId, req.body?.linked_entity_type, req.body?.linked_entity_id);
    }
    if (linkCheck.error) return res.status(400).json({ error: linkCheck.error });
    try {
      await query(
        `UPDATE contractor_library_documents SET linked_entity_type = @lt, linked_entity_id = @lid WHERE id = @id AND tenant_id = @tenantId`,
        {
          id,
          tenantId,
          lt: linkCheck.linked_entity_type || null,
          lid: linkCheck.linked_entity_id || null,
        }
      );
    } catch (e) {
      if (String(e.message || '').includes('linked_entity')) {
        return res.status(503).json({ error: 'Database migration required. Run: npm run db:contractor-library-entity-links' });
      }
      throw e;
    }
    const getResult = await query(
      `SELECT TOP 1 d.id, d.document_type, d.file_name, d.stored_path, d.file_size, d.mime_type, d.created_at,
        d.linked_entity_type, d.linked_entity_id,
        tr.registration AS linked_truck_registration,
        dr.full_name AS linked_driver_name, dr.surname AS linked_driver_surname
       FROM contractor_library_documents d
       LEFT JOIN contractor_trucks tr ON tr.id = d.linked_entity_id AND d.linked_entity_type = N'truck' AND tr.tenant_id = d.tenant_id
       LEFT JOIN contractor_drivers dr ON dr.id = d.linked_entity_id AND d.linked_entity_type = N'driver' AND dr.tenant_id = d.tenant_id
       WHERE d.id = @id AND d.tenant_id = @tenantId`,
      { id, tenantId }
    );
    res.json({ document: getResult.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/library/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const row = await query(
      `SELECT stored_path FROM contractor_library_documents WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const doc = row.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const fullPath = path.join(process.cwd(), 'uploads', doc.stored_path.split('/').join(path.sep));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    await query(`DELETE FROM contractor_library_documents WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/library/:id/download', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const row = await query(
      `SELECT file_name, stored_path FROM contractor_library_documents WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const doc = row.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const fullPath = path.join(process.cwd(), 'uploads', doc.stored_path.split('/').join(path.sep));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on server' });
    res.download(fullPath, doc.file_name || 'document');
  } catch (err) {
    next(err);
  }
});

// Messages; scoped by contractor (contractor users) or full tenant (command centre)
router.get('/messages', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const canSeeAll = isCommandCentreUser(req);
    const requestedContractorId = req.query?.contractor_id ? String(req.query.contractor_id) : '';
    const allowed = canSeeAll ? null : await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) {
      return res.json({ messages: [] });
    }
    let whereClause = ' WHERE m.tenant_id = @tenantId';
    const params = { tenantId };
    if (canSeeAll) {
      if (!requestedContractorId) {
        return res.status(400).json({ error: 'contractor_id is required for company-private chats.' });
      }
      whereClause += ' AND m.contractor_id = @contractorId';
      params.contractorId = requestedContractorId;
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      whereClause += ` AND m.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const result = await query(
      `SELECT m.*, u.full_name AS sender_name, c.name AS contractor_name
       FROM contractor_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN contractors c ON c.id = m.contractor_id AND c.tenant_id = m.tenant_id
       ${whereClause} ORDER BY m.created_at DESC`,
      params
    );
    const messages = result.recordset || [];
    const attachmentsByMessage = await listMessageAttachments(tenantId, messages.map((m) => m.id));
    res.json({
      messages: messages.map((m) => ({ ...m, attachments: attachmentsByMessage[m.id] || [] })),
    });
  } catch (err) {
    if (err.message && err.message.includes('contractor_id')) {
      const fallback = await query(
        `SELECT m.*, u.full_name AS sender_name FROM contractor_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.tenant_id = @tenantId ORDER BY m.created_at DESC`,
        { tenantId: req.user.tenant_id }
      );
      return res.json({ messages: fallback.recordset || [] });
    }
    next(err);
  }
});
router.post('/messages', messageUpload, async (req, res, next) => {
  try {
    const { subject, body } = req.body || {};
    const contractorId = await resolveContractorIdForCreate(req, req.body?.contractor_id);
    if (!contractorId) return res.status(400).json({ error: 'Please select a contractor company before sending a message.' });
    const senderScope = isCommandCentreUser(req) ? 'command_centre' : 'contractor';
    const result = await query(
      `INSERT INTO contractor_messages (tenant_id, contractor_id, sender_id, sender_scope, subject, body)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @senderId, @senderScope, @subject, @body)`,
      {
        tenantId: req.user.tenant_id,
        contractorId: contractorId ?? null,
        senderId: req.user.id,
        senderScope,
        subject: subject || '',
        body: body || null,
      }
    );
    const messageRow = result.recordset[0];
    const files = Array.isArray(req.files) ? req.files : [];
    let attachments = [];
    if (files.length > 0) {
      ensureDir(messageAttachmentsDir);
      const tenantDir = path.join(messageAttachmentsDir, String(req.user?.tenant_id || 'anon'));
      ensureDir(tenantDir);
      const messageDir = path.join(tenantDir, String(messageRow.id));
      ensureDir(messageDir);
      for (const file of files) {
        const ext = (path.extname(file.originalname || '') || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
        const diskName = `${randomUUID()}${ext}`;
        const absolutePath = path.join(messageDir, diskName);
        fs.writeFileSync(absolutePath, file.buffer);
        const storedPath = path.relative(path.join(process.cwd(), 'uploads'), absolutePath).split(path.sep).join('/');
        const inserted = await query(
          `INSERT INTO contractor_message_attachments (message_id, tenant_id, file_name, stored_path, file_size_bytes, mime_type)
           OUTPUT INSERTED.*
           VALUES (@messageId, @tenantId, @fileName, @storedPath, @size, @mimeType)`,
          {
            messageId: messageRow.id,
            tenantId: req.user.tenant_id,
            fileName: file.originalname || 'attachment',
            storedPath,
            size: file.size || null,
            mimeType: file.mimetype || null,
          }
        );
        const attachmentRow = inserted.recordset?.[0];
        if (attachmentRow) attachments.push(attachmentRow);
      }
    }
    res.status(201).json({ message: { ...messageRow, attachments } });
  } catch (err) {
    if (String(err.message || '').includes('sender_scope')) {
      return res.status(503).json({ error: 'Messages schema needs migration. Run: npm run db:contractor-messages-platform' });
    }
    next(err);
  }
});
router.patch('/messages/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    await query(
      `UPDATE contractor_messages SET read_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId: req.user.tenant_id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const canSeeAll = isCommandCentreUser(req);
    const allowed = canSeeAll ? null : await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) return res.status(404).json({ error: 'Attachment not found' });

    const params = { tenantId, id: req.params.id, attachmentId: req.params.attachmentId };
    let where = ' WHERE m.tenant_id = @tenantId AND m.id = @id AND a.id = @attachmentId';
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      where += ` AND m.contractor_id IN (${placeholders})`;
      allowed.forEach((v, i) => { params[`c${i}`] = v; });
    }
    const result = await query(
      `SELECT a.file_name, a.stored_path
       FROM contractor_message_attachments a
       JOIN contractor_messages m ON m.id = a.message_id
       ${where}`,
      params
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    const fullPath = path.join(process.cwd(), 'uploads', row.stored_path.split('/').join(path.sep));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found on server' });
    res.download(fullPath, row.file_name || 'attachment');
  } catch (err) {
    next(err);
  }
});

router.use('/logistics-flow', logisticsFlowRouter);

export default router;
