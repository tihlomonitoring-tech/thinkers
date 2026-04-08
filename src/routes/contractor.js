import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { getCommandCentreAndRectorEmails, getCommandCentreAndRectorEmailsForRoute, getCommandCentreAndAccessManagementEmails, getAllRectorEmails, getRectorEmailsForAlertType, getRectorEmailsForAlertTypeAndRoutes, getTenantUserEmails, getContractorUserEmails, getAccessManagementEmails } from '../lib/emailRecipients.js';
import { newFleetDriverNotificationHtml, newFleetDriverConfirmationHtml, breakdownReportHtml, breakdownConfirmationToDriverHtml, breakdownResolvedHtml, trucksEnrolledOnRouteHtml, truckReinstatedToContractorHtml, truckReinstatedToRectorHtml, reinstatedToContractorHtml, reinstatedToRectorHtml, reinstatedToAccessManagementHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured, formatDateForEmail, formatDateForAppTz, nowForFilename, parseDateTimeInAppTz } from '../lib/emailService.js';

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
    res.json({ ok: true, tenantId, tenantName, contractors });
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
async function createFleetApplication(tenantId, entityType, entityId, source = 'manual') {
  await query(
    `INSERT INTO cc_fleet_applications (tenant_id, entity_type, entity_id, source, [status])
     VALUES (@tenantId, @entityType, @entityId, @source, N'pending')`,
    { tenantId, entityType, entityId, source }
  );
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
      if (senderEmail && (senderEmail || '').trim()) {
        const html = newFleetDriverConfirmationHtml({ type, list, action, contractorName });
        await sendEmail({ to: (senderEmail || '').trim(), subject: `${label} ${action} successfully`, body: html, html: true });
      }
    } catch (e) {
      console.error('[contractor] Fleet/driver email error:', e?.message || e);
    }
  })();
}

// Trucks (expanded: main/sub contractor, year, ownership, fleet, trailers, tracking)
router.get('/trucks', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'Contractor features require a tenant. Your account is not linked to a company.' });
    const allowed = await getAllowedContractorIds(req);
    let sql = `SELECT t.*, co.name AS contractor_company_name
       FROM contractor_trucks t
       LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = @tenantId
       WHERE t.tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ trucks: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND t.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await query(sql, params);
    res.json({ trucks: result.recordset });
  } catch (err) {
    next(err);
  }
});
router.post('/trucks', async (req, res, next) => {
  try {
    const {
      main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no,
      registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password,
      commodity_type, capacity_tonnes, status, contractor_id: bodyContractorId,
    } = req.body || {};
    const contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    const regTrim = registration != null ? String(registration).trim() : '';
    if (regTrim && (await truckRegistrationExists(req.user.tenant_id, regTrim, null, contractorId))) {
      return res.status(409).json({ error: 'A truck with this registration already exists.' });
    }
    const result = await query(
      `INSERT INTO contractor_trucks (tenant_id, contractor_id, main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no, registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password, commodity_type, capacity_tonnes, [status])
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @main_contractor, @sub_contractor, @make_model, @year_model, @ownership_desc, @fleet_no, @registration, @trailer_1_reg_no, @trailer_2_reg_no, @tracking_provider, @tracking_username, @tracking_password, @commodity_type, @capacity_tonnes, @status)`,
      {
        tenantId: req.user.tenant_id,
        contractorId: contractorId || null,
        main_contractor: main_contractor || null,
        sub_contractor: sub_contractor || null,
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
      }
    );
    const truck = result.recordset[0];
    if (truck?.id) await createFleetApplication(req.user.tenant_id, 'truck', truck.id, 'manual');
    const contractorName = await getContractorName(contractorId || truck?.contractor_id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'truck', [truck?.registration].filter(Boolean), req.user?.email);
    res.status(201).json({ truck });
  } catch (err) {
    next(err);
  }
});

router.patch('/trucks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const {
      main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no,
      registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password,
      commodity_type, capacity_tonnes, status,
    } = body;
    const regTrim = registration != null ? String(registration).trim() : null;
    if (regTrim !== null && regTrim !== '' && (await truckRegistrationExists(req.user.tenant_id, regTrim, id))) {
      return res.status(409).json({ error: 'Another truck with this registration already exists.' });
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
    const { trucks: items, contractor_id: bodyContractorId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request must include a non-empty trucks array' });
    }
    const contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
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
      const result = await query(
        `INSERT INTO contractor_trucks (tenant_id, contractor_id, main_contractor, sub_contractor, make_model, year_model, ownership_desc, fleet_no, registration, trailer_1_reg_no, trailer_2_reg_no, tracking_provider, tracking_username, tracking_password, commodity_type, capacity_tonnes, [status])
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @main_contractor, @sub_contractor, @make_model, @year_model, @ownership_desc, @fleet_no, @registration, @trailer_1_reg_no, @trailer_2_reg_no, @tracking_provider, @tracking_username, @tracking_password, @commodity_type, @capacity_tonnes, @status)`,
        {
          tenantId: req.user.tenant_id,
          contractorId: contractorId || null,
          main_contractor: main_contractor || null,
          sub_contractor: sub_contractor || null,
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
        }
      );
      const insertedRow = result.recordset[0];
      inserted.push(insertedRow);
      if (insertedRow?.id) await createFleetApplication(req.user.tenant_id, 'truck', insertedRow.id, 'import');
    }
    const regList = inserted.map((t) => t.registration || '').filter(Boolean);
    if (regList.length > 0) {
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
    let whereClause = ' WHERE d.tenant_id = @tenantId';
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ drivers: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      whereClause += ` AND d.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    let rows = [];
    try {
      const result = await query(
        `SELECT d.*, t.registration AS linked_truck_registration, t.make_model AS linked_truck_make_model, t.fleet_no AS linked_truck_fleet_no
         FROM contractor_drivers d
         LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
         ${whereClause} ORDER BY d.created_at DESC`,
        params
      );
      rows = result.recordset || [];
    } catch (colErr) {
      if (colErr.message && (colErr.message.includes('linked_truck_id') || colErr.message.includes('Invalid column') || colErr.message.includes('contractor_id'))) {
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
    const { full_name, name, surname, id_number, license_number, license_expiry, phone, email, contractor_id: bodyContractorId } = req.body || {};
    const contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
    const firstName = full_name || name || '';
    const lastName = surname || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || firstName || lastName || '';
    if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, null)) {
      return res.status(409).json({ error: 'A driver with this ID number or licence number already exists.' });
    }
    const result = await query(
      `INSERT INTO contractor_drivers (tenant_id, contractor_id, full_name, surname, id_number, license_number, license_expiry, phone, email)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @full_name, @surname, @id_number, @license_number, @license_expiry, @phone, @email)`,
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
      }
    );
    const driver = result.recordset[0];
    if (driver?.id) await createFleetApplication(req.user.tenant_id, 'driver', driver.id, 'manual');
    const driverLabel = [driver?.full_name, driver?.surname].filter(Boolean).join(' ').trim() || 'Driver';
    const contractorName = await getContractorName(contractorId || driver?.contractor_id);
    notifyFleetDriverEmails(req.user.tenant_name || null, contractorName || null, 'driver', [driverLabel], req.user?.email);
    res.status(201).json({ driver });
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
    const { drivers: items, contractor_id: bodyContractorId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request must include a non-empty drivers array' });
    }
    const contractorId = await resolveContractorIdForCreate(req, bodyContractorId);
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
        `INSERT INTO contractor_drivers (tenant_id, contractor_id, full_name, surname, id_number, license_number, license_expiry, phone, email)
         OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @full_name, @surname, @id_number, @license_number, @license_expiry, @phone, @email)`,
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
        }
      );
      const insertedRow = result.recordset[0];
      inserted.push(insertedRow);
      if (insertedRow?.id) await createFleetApplication(req.user.tenant_id, 'driver', insertedRow.id, 'import');
    }
    const driverList = inserted.map((d) => [d.full_name, d.surname].filter(Boolean).join(' ').trim() || 'Driver').filter(Boolean);
    if (driverList.length > 0) {
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
    let sql = `SELECT * FROM contractor_incidents WHERE tenant_id = @tenantId`;
    const params = { tenantId };
    if (allowed && allowed.length === 0) {
      return res.json({ incidents: [] });
    }
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      sql += ` AND contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
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
    const expStr = exp && !Number.isNaN(exp.getTime()) ? exp.toISOString().slice(0, 10) : null;
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
      params.route_expiration = exp && !Number.isNaN(exp.getTime()) ? exp.toISOString().slice(0, 10) : null;
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
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    let sql = `SELECT d.id, d.full_name, d.license_number, d.phone, d.facility_access
       FROM contractor_drivers d
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

/** GET fleet list CSV or Excel (approved trucks; optional ?routeId= or ?routeIds=id1,id2, ?format=excel). Scoped by company when user has contractor scope. */
router.get('/enrollment/fleet-list', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    const wantExcel = (req.query.format || '').toLowerCase() === 'excel';
    if (allowed && allowed.length === 0) {
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
    const routeId = req.query.routeId;
    const routeIdsRaw = req.query.routeIds;
    const routeIds = routeIdsRaw && typeof routeIdsRaw === 'string' ? routeIdsRaw.split(',').map((id) => id.trim()).filter(Boolean) : null;
    const useRoutes = routeId || (routeIds && routeIds.length > 0);
    const ids = routeId ? [routeId] : (routeIds || []);
    if (wantExcel) {
      const routeIdsForExcel = useRoutes && ids.length > 0 ? ids : null;
      const opts = allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {};
      const buf = await buildFleetListExcel(query, tenantId, routeIdsForExcel, null, opts);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.xlsx"');
      return res.send(Buffer.from(buf));
    }
    const params = { tenantId };
    let contractorClause = '';
    if (allowed && allowed.length > 0) {
      contractorClause = ' AND t.contractor_id IN (' + allowed.map((_, i) => `@fc${i}`).join(',') + ')';
      allowed.forEach((id, i) => { params[`fc${i}`] = id; });
    }
    let sql;
    if (useRoutes && ids.length > 0) {
      const placeholders = ids.map((_, i) => `@routeId${i}`).join(',');
      for (let i = 0; i < ids.length; i++) params[`routeId${i}`] = ids[i];
      sql = `SELECT t.registration, t.make_model, t.fleet_no, t.commodity_type, t.capacity_tonnes, r.name AS route_name
             FROM contractor_route_trucks rt
             JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId AND t.facility_access = 1
             JOIN contractor_routes r ON r.id = rt.route_id AND r.tenant_id = @tenantId
             WHERE rt.route_id IN (${placeholders})${contractorClause}
             ORDER BY r.[order], r.name, t.registration`;
    } else if (useRoutes && ids.length === 0) {
      sql = `SELECT t.registration, t.make_model, t.fleet_no, t.commodity_type, t.capacity_tonnes
             FROM contractor_trucks t
             WHERE t.tenant_id = @tenantId AND t.facility_access = 1
               AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))${contractorClause}
             ORDER BY t.registration`;
    } else {
      sql = `SELECT t.registration, t.make_model, t.fleet_no, t.commodity_type, t.capacity_tonnes
             FROM contractor_trucks t
             WHERE t.tenant_id = @tenantId AND t.facility_access = 1
               AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'truck' AND s.entity_id = CAST(t.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))${contractorClause}
             ORDER BY t.registration`;
    }
    const result = await query(sql, params);
    const rows = result.recordset || [];
    const withRoute = useRoutes && ids.length > 0;
    const headers = withRoute ? ['Registration', 'Make/Model', 'Fleet No', 'Commodity', 'Capacity (t)', 'Route'] : ['Registration', 'Make/Model', 'Fleet No', 'Commodity', 'Capacity (t)'];
    const csv = [headers.join(',')].concat(
      rows.map((r) =>
        [
          r.registration,
          r.make_model,
          r.fleet_no,
          r.commodity_type,
          r.capacity_tonnes,
          r.route_name,
        ]
          .filter((_, i) => (withRoute ? true : i < 5))
          .map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : ''))
          .join(',')
      )
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fleet-list.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
});

/** GET driver list CSV or Excel (approved drivers; optional ?routeId= or ?routeIds=id1,id2, ?format=excel). Scoped by company when user has contractor scope. */
router.get('/enrollment/driver-list', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const scope = await allowedContractorIdsWithOptionalNarrow(req);
    if (scope.error) return res.status(scope.error.status).json({ error: scope.error.message });
    const allowed = scope.allowed;
    const wantExcel = (req.query.format || '').toLowerCase() === 'excel';
    if (allowed && allowed.length === 0) {
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
    if (wantExcel) {
      const routeIdsForExcel = useRoutes && ids.length > 0 ? ids : null;
      const opts = allowed && allowed.length > 0 ? (allowed.length === 1 ? { contractorId: allowed[0] } : { contractorIds: allowed }) : {};
      const buf = await buildDriverListExcel(query, tenantId, routeIdsForExcel, null, opts);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="driver-list.xlsx"');
      return res.send(Buffer.from(buf));
    }
    const params = { tenantId };
    let contractorClause = '';
    if (allowed && allowed.length > 0) {
      contractorClause = ' AND d.contractor_id IN (' + allowed.map((_, i) => `@dc${i}`).join(',') + ')';
      allowed.forEach((id, i) => { params[`dc${i}`] = id; });
    }
    let sql;
    if (useRoutes && ids.length > 0) {
      const placeholders = ids.map((_, i) => `@routeId${i}`).join(',');
      for (let i = 0; i < ids.length; i++) params[`routeId${i}`] = ids[i];
      sql = `SELECT d.full_name, d.license_number, d.phone, d.email, r.name AS route_name
             FROM contractor_route_drivers rd
             JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId AND d.facility_access = 1
             JOIN contractor_routes r ON r.id = rd.route_id AND r.tenant_id = @tenantId
             WHERE rd.route_id IN (${placeholders})${contractorClause}
             ORDER BY r.[order], r.name, d.full_name`;
    } else if (useRoutes && ids.length === 0) {
      sql = `SELECT d.full_name, d.license_number, d.phone, d.email
             FROM contractor_drivers d
             WHERE d.tenant_id = @tenantId AND d.facility_access = 1
               AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))${contractorClause}
             ORDER BY d.full_name`;
    } else {
      sql = `SELECT d.full_name, d.license_number, d.phone, d.email
             FROM contractor_drivers d
             WHERE d.tenant_id = @tenantId AND d.facility_access = 1
               AND NOT EXISTS (SELECT 1 FROM contractor_suspensions s WHERE s.tenant_id = @tenantId AND s.entity_type = N'driver' AND s.entity_id = CAST(d.id AS NVARCHAR(50)) AND s.[status] IN (N'suspended', N'under_appeal'))${contractorClause}
             ORDER BY d.full_name`;
    }
    const result = await query(sql, params);
    const rows = result.recordset || [];
    const withRoute = useRoutes && ids.length > 0;
    const headers = withRoute ? ['Name', 'License', 'Phone', 'Email', 'Route'] : ['Name', 'License', 'Phone', 'Email'];
    const csv = [headers.join(',')].concat(
      rows.map((r) =>
        [
          r.full_name,
          r.license_number,
          r.phone,
          r.email,
          r.route_name,
        ]
          .filter((_, i) => (withRoute ? true : i < 4))
          .map((c) => (c != null ? `"${String(c).replace(/"/g, '""')}"` : ''))
          .join(',')
      )
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="driver-list.csv"');
    res.send('\uFEFF' + csv);
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
      params.dateTo = new Date(dateTo).toISOString().slice(0, 10);
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
  { key: 'registration', label: 'Registration' },
  { key: 'make_model', label: 'Make/Model' },
  { key: 'fleet_no', label: 'Fleet No' },
  { key: 'trailer_1_reg_no', label: 'Trailer 1 reg' },
  { key: 'trailer_2_reg_no', label: 'Trailer 2 reg' },
  { key: 'commodity_type', label: 'Commodity' },
  { key: 'capacity_tonnes', label: 'Capacity (t)' },
  { key: 'route_name', label: 'Route' },
];
const DRIVER_COLUMNS = [
  { key: 'full_name', label: 'Name' },
  { key: 'license_number', label: 'License' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'route_name', label: 'Route' },
];

/** Get fleet list data: { headers, keys, rows }. Optional columns = array of keys to include. contractorId = single company; contractorIds = array of company ids.
 *  queryOpts.includeRouteEnrollmentWithoutAccessFilter: when true and routeIds set, include all trucks enrolled on the route (not only facility_access=1). Used for email/pilot distribution so lists match route roster. */
async function getFleetListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null, queryOpts = {}) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
  const skipAccessOnRoute = queryOpts.includeRouteEnrollmentWithoutAccessFilter === true && useRoutes && ids.length > 0;
  const accessClause = skipAccessOnRoute ? '' : ' AND t.facility_access = 1';
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
    sql = `SELECT t.registration, t.make_model, t.fleet_no, t.trailer_1_reg_no, t.trailer_2_reg_no, t.commodity_type, t.capacity_tonnes, r.name AS route_name
           FROM contractor_route_trucks rt
           JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId${accessClause}${contractorClause}
           JOIN contractor_routes r ON r.id = rt.route_id AND r.tenant_id = @tenantId
           WHERE rt.route_id IN (${placeholders})
           ORDER BY r.[order], r.name, t.registration`;
  } else {
    sql = `SELECT t.registration, t.make_model, t.fleet_no, t.trailer_1_reg_no, t.trailer_2_reg_no, t.commodity_type, t.capacity_tonnes
           FROM contractor_trucks t
           WHERE t.tenant_id = @tenantId AND t.facility_access = 1${contractorClause}
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
  const allCols = withRoute ? FLEET_COLUMNS : FLEET_COLUMNS.filter((c) => c.key !== 'route_name');
  const colKeysLower = Array.isArray(columns) && columns.length > 0 ? columns.map((c) => String(c).toLowerCase()) : null;
  const selected = colKeysLower && colKeysLower.length > 0
    ? allCols.filter((c) => colKeysLower.includes(c.key.toLowerCase()))
    : allCols;
  const useCols = selected.length > 0 ? selected : allCols;
  return { headers: useCols.map((c) => c.label), keys: useCols.map((c) => c.key), rows };
}

/** queryOpts.includeRouteEnrollmentWithoutAccessFilter: when true and routeIds set, include all drivers on route enrollments (not only facility_access=1). */
async function getDriverListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null, queryOpts = {}) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
  const skipAccessOnRoute = queryOpts.includeRouteEnrollmentWithoutAccessFilter === true && useRoutes && ids.length > 0;
  const accessClause = skipAccessOnRoute ? '' : ' AND d.facility_access = 1';
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
    sql = `SELECT d.full_name, d.license_number, d.phone, d.email, r.name AS route_name
           FROM contractor_route_drivers rd
           JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId${accessClause}${contractorClause}
           JOIN contractor_routes r ON r.id = rd.route_id AND r.tenant_id = @tenantId
           WHERE rd.route_id IN (${placeholders})
           ORDER BY r.[order], r.name, d.full_name`;
  } else {
    sql = `SELECT d.full_name, d.license_number, d.phone, d.email
           FROM contractor_drivers d
           WHERE d.tenant_id = @tenantId AND d.facility_access = 1${contractorClause}
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
  const allCols = withRoute ? DRIVER_COLUMNS : DRIVER_COLUMNS.filter((c) => c.key !== 'route_name');
  const colKeysLower = Array.isArray(columns) && columns.length > 0 ? columns.map((c) => String(c).toLowerCase()) : null;
  const selected = colKeysLower && colKeysLower.length > 0
    ? allCols.filter((c) => colKeysLower.includes(c.key.toLowerCase()))
    : allCols;
  const useCols = selected.length > 0 ? selected : allCols;
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

/** Template constants for distribution Excel sheets */
const EXCEL_TEMPLATE = {
  titleFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e40af' } },
  titleFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 },
  subtitleFont: { size: 10, color: { argb: 'FF64748b' } },
  headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e40af' } },
  headerFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  borderThin: { style: 'thin', color: { argb: 'FFe2e8f0' } },
  footerFont: { size: 9, color: { argb: 'FF64748b' }, italic: true },
};

/** Apply professional template: only style header cells that have content (1..numCols), auto column width, data borders. */
function styleDistributionSheet(worksheet, numCols, headerLabels, opts = {}) {
  const headerRowIndex = opts.headerRowIndex ?? 1;
  const hasTitle = opts.hasTitle === true;
  const hasInfoBlock = opts.hasInfoBlock === true;
  const footerRowIndex = opts.footerRowIndex;
  const dataRowCount = opts.dataRowCount ?? 0;

  if (numCols >= 1) {
    const lastColLetter = worksheet.getColumn(numCols).letter;
    if (hasTitle && !hasInfoBlock) {
      worksheet.mergeCells(`A1:${lastColLetter}1`);
      const titleRow = worksheet.getRow(1);
      titleRow.height = 28;
      titleRow.getCell(1).font = EXCEL_TEMPLATE.titleFont;
      titleRow.getCell(1).fill = EXCEL_TEMPLATE.titleFill;
      titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      if (opts.subtitleRowIndex) {
        worksheet.mergeCells(`A${opts.subtitleRowIndex}:${lastColLetter}${opts.subtitleRowIndex}`);
        const subRow = worksheet.getRow(opts.subtitleRowIndex);
        subRow.getCell(1).font = EXCEL_TEMPLATE.subtitleFont;
        subRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      }
    }

    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.height = 22;
    for (let c = 1; c <= numCols; c++) {
      const cell = headerRow.getCell(c);
      cell.font = EXCEL_TEMPLATE.headerFont;
      cell.fill = EXCEL_TEMPLATE.headerFill;
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cell.border = { top: EXCEL_TEMPLATE.borderThin, left: EXCEL_TEMPLATE.borderThin, bottom: EXCEL_TEMPLATE.borderThin, right: EXCEL_TEMPLATE.borderThin };
    }
    for (let c = 1; c <= numCols; c++) {
      const label = (headerLabels && headerLabels[c - 1]) ? String(headerLabels[c - 1]) : '';
      let maxLen = label.length;
      if (dataRowCount > 0) {
        for (let r = headerRowIndex + 1; r <= headerRowIndex + dataRowCount; r++) {
          try {
            const cell = worksheet.getRow(r).getCell(c);
            const val = cell && cell.value != null ? String(cell.value) : '';
            if (val.length > maxLen) maxLen = val.length;
          } catch (_) { /* ignore */ }
        }
      }
      worksheet.getColumn(c).width = Math.min(40, Math.max(10, maxLen + 2));
    }
  }

  worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex, activeCell: `A${headerRowIndex + 1}` }];

  const borderStyle = EXCEL_TEMPLATE.borderThin;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex && rowNumber !== footerRowIndex) {
      row.alignment = { vertical: 'middle', wrapText: true };
      for (let c = 1; c <= numCols; c++) {
        const cell = row.getCell(c);
        if (cell) cell.border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
      }
    }
  });

  if (footerRowIndex) {
    const lastColLetter = worksheet.getColumn(numCols).letter;
    worksheet.mergeCells(`A${footerRowIndex}:${lastColLetter}${footerRowIndex}`);
    const footerRow = worksheet.getRow(footerRowIndex);
    footerRow.getCell(1).font = EXCEL_TEMPLATE.footerFont;
    footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  }
}

const EXCEL_INFO_FONT = { size: 11, color: { argb: 'FF334155' } };
const EXCEL_INFO_LABEL_FONT = { size: 11, color: { argb: 'FF64748b' }, bold: true };

/** Write Company, Route, Date & time block at top of sheet (rows 1–3). Returns header row index (5). */
function writeDistributionInfoBlock(sheet, opts) {
  const companyName = opts.companyName != null ? String(opts.companyName).trim() : '';
  const routeName = opts.routeName != null ? String(opts.routeName).trim() : '';
  const generated = opts.generated instanceof Date ? opts.generated : (opts.generated != null ? new Date(opts.generated) : new Date());
  const dateTimeStr = formatDateForAppTz(generated);
  sheet.getRow(1).getCell(1).value = 'Company:';
  sheet.getRow(1).getCell(1).font = EXCEL_INFO_LABEL_FONT;
  sheet.getRow(1).getCell(2).value = companyName || '—';
  sheet.getRow(1).getCell(2).font = EXCEL_INFO_FONT;
  sheet.getRow(2).getCell(1).value = 'Route:';
  sheet.getRow(2).getCell(1).font = EXCEL_INFO_LABEL_FONT;
  sheet.getRow(2).getCell(2).value = routeName || '—';
  sheet.getRow(2).getCell(2).font = EXCEL_INFO_FONT;
  sheet.getRow(3).getCell(1).value = 'Date & time:';
  sheet.getRow(3).getCell(1).font = EXCEL_INFO_LABEL_FONT;
  sheet.getRow(3).getCell(2).value = dateTimeStr;
  sheet.getRow(3).getCell(2).font = EXCEL_INFO_FONT;
  sheet.getRow(1).height = 20;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 20;
  return 5;
}

/** Build fleet list as Excel buffer. opts: { title, subtitle, contractorId, contractorIds, companyName, routeName, generated }. */
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
  rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: !hasInfoBlock,
    subtitleRowIndex: hasInfoBlock ? undefined : 2,
    hasInfoBlock,
    dataRowCount: rows.length,
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build driver list as Excel buffer. opts: { title, subtitle, contractorId, contractorIds, companyName, routeName, generated }. */
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
  rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: !hasInfoBlock,
    subtitleRowIndex: hasInfoBlock ? undefined : 2,
    hasInfoBlock,
    dataRowCount: rows.length,
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build one Excel workbook with Fleet list on sheet 1 and Driver list on sheet 2. opts: { companyName, routeName, generated, subtitle, contractorId }. */
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
    rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
    styleDistributionSheet(sheet, numCols, headers, {
      headerRowIndex: HEADER_ROW,
      hasTitle: false,
      hasInfoBlock: true,
      dataRowCount: rows.length,
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
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const MARGIN = 40;
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const TABLE_W = PAGE_W - MARGIN * 2;
    const ROW_H = 16;
    const HEADER_COLOR = '#1e40af';
    const FONT = 'Helvetica';

    let y = MARGIN;
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
  const listQ = opts.includeRouteEnrollmentWithoutAccessFilter ? { includeRouteEnrollmentWithoutAccessFilter: true } : {};
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds, listQ);
  const title = opts.title ?? 'Thinkers – Fleet list';
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
    } = body || {};
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

    const fleetCols = Array.isArray(fleet_columns) && fleet_columns.length > 0
      ? FLEET_COLUMNS.filter((c) => fleet_columns.some((k) => String(k).toLowerCase() === c.key.toLowerCase())).map((c) => c.key)
      : null;
    const driverCols = Array.isArray(driver_columns) && driver_columns.length > 0
      ? DRIVER_COLUMNS.filter((c) => driver_columns.some((k) => String(k).toLowerCase() === c.key.toLowerCase())).map((c) => c.key)
      : null;
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
        const baseOpts = { subtitle, contractorId: cid, companyName: contractorName, generated };
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
              p.list_type, p.attach_format, p.fleet_columns_json, p.driver_columns_json,
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
      frequency,
      time_hhmm: timeHhmm,
      weekday,
    } = req.body || {};
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
        list_type, attach_format, fleet_columns_json, driver_columns_json, frequency, time_hhmm, weekday, is_active)
       VALUES (@id, @tenantId, @userId, @name, @routeId, @contractorIds, @recipients, @cc, @lt, @fmt, @fleetJson, @driverJson, @freq, @tm, @wd, 1)`,
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
    if (dateTo) { sql += ` AND h.created_at < DATEADD(day, 1, CAST(@dateTo AS DATE))`; params.dateTo = new Date(dateTo).toISOString().slice(0, 10); }
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

// --- Subcontractors ---
router.get('/subcontractors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT * FROM contractor_subcontractors WHERE tenant_id = @tenantId ORDER BY [order_index] ASC, company_name ASC`,
      { tenantId }
    );
    res.json({ subcontractors: result.recordset || [] });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.json({ subcontractors: [] });
    next(err);
  }
});

router.post('/subcontractors', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const result = await query(
      `INSERT INTO contractor_subcontractors (tenant_id, company_name, contact_person, contact_phone, contact_email, control_room_contact, control_room_phone, mechanic_name, mechanic_phone, emergency_contact_name, emergency_contact_phone, [order_index])
       OUTPUT INSERTED.* VALUES (@tenantId, @company_name, @contact_person, @contact_phone, @contact_email, @control_room_contact, @control_room_phone, @mechanic_name, @mechanic_phone, @emergency_contact_name, @emergency_contact_phone, @order_index)`,
      {
        tenantId,
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

export default router;
