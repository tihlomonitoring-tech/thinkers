import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { getCommandCentreAndRectorEmails, getCommandCentreAndRectorEmailsForRoute, getCommandCentreAndAccessManagementEmails, getAllRectorEmails, getRectorEmailsForAlertType, getRectorEmailsForAlertTypeAndRoutes, getTenantUserEmails, getContractorUserEmails, getAccessManagementEmails } from '../lib/emailRecipients.js';
import { newFleetDriverNotificationHtml, newFleetDriverConfirmationHtml, breakdownReportHtml, breakdownConfirmationToDriverHtml, breakdownResolvedHtml, trucksEnrolledOnRouteHtml, truckReinstatedToContractorHtml, truckReinstatedToRectorHtml, reinstatedToContractorHtml, reinstatedToRectorHtml, reinstatedToAccessManagementHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

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

const contractorLibraryDir = path.join(process.cwd(), 'uploads', 'contractor-library');
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

/** Allowed contractor IDs for current user. Returns null = all contractors under tenant (no restriction); [] = none; [...] = only these. */
async function getAllowedContractorIds(req) {
  const tenantId = getTenantId(req);
  if (!tenantId) return null;
  try {
    const result = await query(
      `SELECT contractor_id FROM user_contractors WHERE user_id = @userId`,
      { userId: req.user?.id }
    );
    const rows = result.recordset || [];
    const ids = rows.map((r) => r.contractor_id ?? r.contractor_Id).filter(Boolean);
    if (ids.length > 0) return ids;
    if (rows.length > 0) return [];

    // No user_contractors rows: user might be tenant-wide (CC/AM/Rector) or a contractor user not yet assigned
    const pageRoles = req.user?.page_roles || [];
    const canSeeAllContractors = ['command_centre', 'access_management', 'rector'].some((p) => pageRoles.includes(p));
    if (canSeeAllContractors) return null;

    // Contractor-only user with no assignment: restrict so they never see other contractors' data
    const countResult = await query(
      `SELECT id FROM contractors WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const tenantContractors = countResult.recordset || [];
    if (tenantContractors.length === 0) return null;
    if (tenantContractors.length === 1) return [tenantContractors[0].id ?? tenantContractors[0].Id];
    return [];
  } catch (e) {
    if (e.message && (e.message.includes('user_contractors') || e.message.includes('Invalid object'))) return null;
    throw e;
  }
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

// Drivers: duplicate = same tenant (and same contractor when scoped) + same id_number or license_number
async function driverDuplicateExists(tenantId, id_number, license_number, excludeId = null, contractorId = null) {
  const idNum = id_number ? String(id_number).trim() : null;
  const licNum = license_number ? String(license_number).trim() : null;
  const contractorClause = contractorId != null
    ? ' AND (contractor_id = @contractorId OR (contractor_id IS NULL AND @contractorId IS NULL))'
    : '';
  if (idNum) {
    const result = await query(
      `SELECT 1 FROM contractor_drivers WHERE tenant_id = @tenantId AND id_number IS NOT NULL AND LOWER(LTRIM(RTRIM(id_number))) = @idNumNorm ${excludeId ? 'AND id <> @excludeId' : ''}${contractorClause}`,
      { tenantId, idNumNorm: idNum.toLowerCase(), ...(excludeId && { excludeId }), ...(contractorId !== undefined && { contractorId }) }
    );
    if (result.recordset?.length > 0) return true;
  }
  if (licNum) {
    const result = await query(
      `SELECT 1 FROM contractor_drivers WHERE tenant_id = @tenantId AND license_number IS NOT NULL AND LOWER(LTRIM(RTRIM(license_number))) = @licNumNorm ${excludeId ? 'AND id <> @excludeId' : ''}${contractorClause}`,
      { tenantId, licNumNorm: licNum.toLowerCase(), ...(excludeId && { excludeId }), ...(contractorId !== undefined && { contractorId }) }
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
router.get('/trucks', listHandler('contractor_trucks'));
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
    if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, null, contractorId)) {
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
    if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, id, driverContractorId)) {
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
      if (await driverDuplicateExists(req.user.tenant_id, id_number, license_number, null, contractorId)) {
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
      const time = (reported_time || '00:00').toString().trim();
      reportedAt = new Date(`${reported_date}T${time}`);
      if (Number.isNaN(reportedAt.getTime())) reportedAt = new Date();
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

    // Notify Command Centre and Rector users (same as public report-breakdown flow)
    (async () => {
      try {
        if (!isEmailConfigured() || !getCommandCentreAndRectorEmails) return;
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
           WHERE i.id = @incidentId`,
          { incidentId }
        );
        const row = detailResult.recordset?.[0];
        const driverName = row ? [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || 'Driver' : 'Driver';
        const reportedAtStr = row?.reported_at ? new Date(row.reported_at).toLocaleString() : new Date().toLocaleString();
        const contractorName = row?.contractor_name ?? row?.contractor_Name ?? null;
        const tenantName = row?.tenant_name ?? row?.tenant_name ?? null;
        const routeId = row?.route_id ?? row?.route_Id ?? null;
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
        if (!isEmailConfigured() || !getCommandCentreAndRectorEmailsForRoute || !getTenantUserEmails) return;
        const detailResult = await query(
          `SELECT i.id, i.route_id, i.title, i.resolution_note, i.resolved_at, i.tenant_id, i.contractor_id,
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
        const resolvedAtStr = row.resolved_at ? new Date(row.resolved_at).toLocaleString() : new Date().toLocaleString();
        const contractorName = row.contractor_name ?? row.contractor_Name ?? null;
        const incidentContractorId = row.contractor_id ?? row.contractor_Id ?? null;
        const routeId = row.route_id ?? row.route_Id ?? null;
        const ccRectorEmails = await getCommandCentreAndRectorEmailsForRoute(query, routeId);
        const driverEmail = (row.driver_email || '').trim();
        const contractorEmails = row.tenant_id ? (incidentContractorId ? await getContractorUserEmails(query, row.tenant_id, incidentContractorId) : await getTenantUserEmails(query, row.tenant_id)) : [];
        const allTo = [...new Set([...ccRectorEmails, ...(driverEmail ? [driverEmail] : []), ...contractorEmails])];
        const mask = (e) => (e && e.includes('@') ? e.slice(0, 2) + '***@' + e.split('@')[1] : e);
        console.log('[contractor/incidents] Breakdown resolved: CC/Rector=', ccRectorEmails.length, 'driver=', !!driverEmail, 'contractor(tenant)=', contractorEmails.length, 'total=', allTo.length);
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
    const allowed = await getAllowedContractorIds(req);
    let sql = `SELECT t.id, t.registration, t.make_model, t.fleet_no, t.facility_access
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
    const allowed = await getAllowedContractorIds(req);
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
    const result = await query(
      `SELECT r.id, r.name FROM contractor_routes r
       INNER JOIN contractor_route_trucks rt ON rt.route_id = r.id AND rt.truck_id = @truckId
       WHERE r.tenant_id = @tenantId ORDER BY r.name`,
      { truckId, tenantId }
    );
    res.json({ routes: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** GET single route with enrolled trucks and drivers. When user has contractor scope, only trucks/drivers for that company are returned. */
router.get('/routes/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const allowed = await getAllowedContractorIds(req);
    const routeResult = await query(
      `SELECT * FROM contractor_routes WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    if (!routeResult.recordset?.[0]) return res.status(404).json({ error: 'Route not found' });
    const route = routeResult.recordset[0];
    let trucksSql = `SELECT rt.truck_id, t.registration, t.make_model, t.fleet_no
       FROM contractor_route_trucks rt
       JOIN contractor_trucks t ON t.id = rt.truck_id
       WHERE rt.route_id = @id`;
    let driversSql = `SELECT rd.driver_id, d.full_name, d.license_number
       FROM contractor_route_drivers rd
       JOIN contractor_drivers d ON d.id = rd.driver_id
       WHERE rd.route_id = @id`;
    const trucksParams = { id };
    const driversParams = { id };
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      trucksSql += ` AND t.contractor_id IN (${placeholders})`;
      driversSql += ` AND d.contractor_id IN (${placeholders})`;
      allowed.forEach((cid, i) => { trucksParams[`c${i}`] = cid; driversParams[`c${i}`] = cid; });
    }
    trucksSql += ` ORDER BY t.registration`;
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
    const allowed = await getAllowedContractorIds(req);
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
    await query(
      `DELETE FROM contractor_route_trucks WHERE route_id = @routeId AND truck_id = @truckId
       AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
      { routeId, truckId, tenantId }
    );
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
    const allowed = await getAllowedContractorIds(req);
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
    await query(
      `DELETE FROM contractor_route_drivers WHERE route_id = @routeId AND driver_id = @driverId
       AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
      { routeId, driverId, tenantId }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET fleet list CSV or Excel (approved trucks; optional ?routeId= or ?routeIds=id1,id2, ?format=excel). Scoped by company when user has contractor scope. */
router.get('/enrollment/fleet-list', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const allowed = await getAllowedContractorIds(req);
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
    const allowed = await getAllowedContractorIds(req);
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

/** Get fleet list data: { headers, keys, rows }. Optional columns = array of keys to include. contractorId = single company; contractorIds = array of company ids. */
async function getFleetListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
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
           JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId AND t.facility_access = 1${contractorClause}
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

/** Get driver list data: { headers, keys, rows }. Optional columns = array of keys to include. contractorId = single company; contractorIds = array of company ids. */
async function getDriverListData(query, tenantId, routeIds, columns = null, contractorId = null, contractorIds = null) {
  const useRoutes = routeIds && routeIds.length > 0;
  const ids = routeIds || [];
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
           JOIN contractor_drivers d ON d.id = rd.driver_id AND d.tenant_id = @tenantId AND d.facility_access = 1${contractorClause}
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

function distributionFilename(routeName, contractorName, ext, listKind = '') {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const timePart = now.toTimeString().slice(0, 5).replace(':', '-');
  const route = sanitizeFilename(routeName);
  const contractor = sanitizeFilename(contractorName);
  const prefix = listKind ? `${listKind}-` : '';
  return `${prefix}${route}_${contractor}_${datePart}_${timePart}.${ext}`;
}

/** Build fleet list CSV; optional columns = array of keys to include (default all). opts.contractorId / opts.contractorIds = filter by company. */
async function buildFleetListCsv(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
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
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
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

/** Apply professional template to distribution sheet: title, header row, data borders, footer. */
function styleDistributionSheet(worksheet, numCols, headerLabels, opts = {}) {
  const headerRowIndex = opts.headerRowIndex ?? 1;
  const hasTitle = opts.hasTitle === true;
  const footerRowIndex = opts.footerRowIndex;

  if (numCols >= 1) {
    const lastColLetter = worksheet.getColumn(numCols).letter;
    if (hasTitle) {
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
    headerRow.font = EXCEL_TEMPLATE.headerFont;
    headerRow.fill = EXCEL_TEMPLATE.headerFill;
    headerRow.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    headerRow.border = { top: EXCEL_TEMPLATE.borderThin, left: EXCEL_TEMPLATE.borderThin, bottom: EXCEL_TEMPLATE.borderThin, right: EXCEL_TEMPLATE.borderThin };
    headerRow.height = 22;

    for (let c = 1; c <= numCols; c++) {
      const label = (headerLabels && headerLabels[c - 1]) ? String(headerLabels[c - 1]) : '';
      worksheet.getColumn(c).width = Math.min(28, Math.max(12, label.length + 2));
    }
  }

  worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex, activeCell: `A${headerRowIndex + 1}` }];

  const borderStyle = EXCEL_TEMPLATE.borderThin;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex && rowNumber !== footerRowIndex) {
      row.alignment = { vertical: 'middle', wrapText: false };
      row.eachCell((cell) => { cell.border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle }; });
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

/** Build fleet list as Excel buffer (template: title, subtitle, header, data). opts: { title, subtitle, contractorId, contractorIds }. */
async function buildFleetListExcel(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
  const title = opts.title ?? 'Thinkers – Fleet list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  const sheet = workbook.addWorksheet('Fleet list', { views: [{ showGridLines: true }] });
  const numCols = headers.length;
  const TITLE_ROW = 1;
  const SUBTITLE_ROW = 2;
  const HEADER_ROW = 4;
  if (numCols === 0) {
    sheet.getRow(1).getCell(1).value = title;
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
  sheet.getRow(TITLE_ROW).getCell(1).value = title;
  sheet.getRow(SUBTITLE_ROW).getCell(1).value = subtitle;
  sheet.addRow([]);
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((h, i) => headerRow.getCell(i + 1).value = h);
  rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: true,
    subtitleRowIndex: SUBTITLE_ROW,
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build driver list as Excel buffer (template: title, subtitle, header, data). opts: { title, subtitle, contractorId, contractorIds }. */
async function buildDriverListExcel(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
  const title = opts.title ?? 'Thinkers – Driver list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  const sheet = workbook.addWorksheet('Driver list', { views: [{ showGridLines: true }] });
  const numCols = headers.length;
  const TITLE_ROW = 1;
  const SUBTITLE_ROW = 2;
  const HEADER_ROW = 4;
  if (numCols === 0) {
    sheet.getRow(1).getCell(1).value = title;
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
  sheet.getRow(TITLE_ROW).getCell(1).value = title;
  sheet.getRow(SUBTITLE_ROW).getCell(1).value = subtitle;
  sheet.addRow([]);
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((h, i) => headerRow.getCell(i + 1).value = h);
  rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex: HEADER_ROW,
    hasTitle: true,
    subtitleRowIndex: SUBTITLE_ROW,
  });
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
  const { headers, keys, rows } = await getFleetListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
  const title = opts.title ?? 'Thinkers – Fleet list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
  return buildDistributionPdf(title, subtitle, headers, rows, keys);
}

async function buildDriverListPdf(query, tenantId, routeIds, columns = null, opts = {}) {
  const contractorId = opts.contractorId ?? null;
  const contractorIds = opts.contractorIds ?? null;
  const { headers, keys, rows } = await getDriverListData(query, tenantId, routeIds, columns, contractorId, contractorIds);
  const title = opts.title ?? 'Thinkers – Driver list';
  const subtitle = opts.subtitle ?? `Access management – List distribution · Generated ${new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
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

/** Email body for per-contractor distribution: list which contractors and routes are attached. */
function distributionListEmailHtmlPerContractor(entries) {
  const listItems = entries.map((e) => `${escapeHtml(e.contractorName)} – ${escapeHtml(e.routeName)}`).join('</li><li>');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #e8f4fc;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #1e5a8e 0%, #2563eb 50%, #1d4ed8 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">Thinkers</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">Access management – List distribution (per contractor)</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
      <p style="margin: 0 0 12px 0; font-size: 15px; color: #334155; line-height: 1.5;">Please find attached the following lists (one per contractor and route):</p>
      <ul style="margin: 0 0 24px 0; padding-left: 20px; font-size: 14px; color: #334155; line-height: 1.6;"><li>${listItems}</li></ul>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b;">Generated from Thinkers Access management. File names: Route name, Contractor name, Date and time.</p>
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

function distributionListEmailTextPerContractor(entries) {
  const lines = entries.map((e) => `• ${e.contractorName} – ${e.routeName}`);
  return [
    'Thinkers',
    'Access management – List distribution (per contractor)',
    '',
    'Please find attached the following lists (one per contractor and route):',
    ...lines,
    '',
    'File names: Route name, Contractor name, Date and time.',
    '',
    'Monitoring Team',
    'For further inquiries please contact: vincent@thinkersafrika.co.za',
    '',
    'Thinkers Afrika Management System',
  ].join('\n');
}

/** POST send fleet/driver list by email from the system (actual list attached). Optional: send_per_contractor + contractor_ids = one list per contractor/route. */
router.post('/distribution/send-email', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id;
    const userName = req.user?.full_name || null;
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
    } = req.body || {};
    if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'recipients (array of emails) is required' });
    const listType = list_type === 'both' ? 'both' : list_type === 'driver' ? 'driver' : 'fleet';
    const routeIds = Array.isArray(route_ids) ? route_ids.filter(Boolean) : (route_ids && typeof route_ids === 'string' ? route_ids.split(',').map((id) => id.trim()).filter(Boolean) : []);
    const emails = [...new Set(recipients.map((e) => String(e).trim().toLowerCase()).filter((e) => e && e.includes('@')))];
    if (emails.length === 0) return res.status(400).json({ error: 'At least one valid recipient email is required' });
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

    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured. Set EMAIL_USER and EMAIL_PASS in .env.' });

    const perContractor = send_per_contractor === true && Array.isArray(rawContractorIds) && rawContractorIds.length > 0;
    const contractorIds = perContractor ? [...new Set(rawContractorIds.map((id) => String(id).trim()).filter(Boolean))] : [];

    let attachments = [];
    let bodyHtml;
    let bodyText;
    let subject;
    let routeIdsStr = routeIds.length > 0 ? routeIds.join(',') : null;
    const historyTenantId = tenantId;

    if (perContractor && contractorIds.length > 0) {
      const contractorsResult = await query(
        `SELECT id, name, tenant_id FROM contractors WHERE id IN (${contractorIds.map((_, i) => `@cid${i}`).join(',')})`,
        Object.fromEntries(contractorIds.map((id, i) => [`cid${i}`, id]))
      );
      const contractorsList = contractorsResult.recordset || [];
      const entries = [];
      const generated = new Date();
      const subtitle = `Access management – List distribution · Generated ${generated.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;

      for (const row of contractorsList) {
        const cid = row.id;
        const contractorName = row.name || 'Contractor';
        const tid = row.tenant_id;
        const routesResult = await query(
          `SELECT id, name FROM contractor_routes WHERE tenant_id = @tid ORDER BY [order], name`,
          { tid }
        );
        const routes = routesResult.recordset || [];
        const listOpts = { title: '', subtitle, contractorId: cid };
        if (routes.length === 0) {
          const routeLabel = 'All approved';
          listOpts.title = `${contractorName} – ${routeLabel}`;
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
          entries.push({ contractorName, routeName: routeLabel });
        } else {
          for (const r of routes) {
            const routeName = r.name || 'Route';
            listOpts.title = `${contractorName} – ${routeName}`;
            const singleRoute = [r.id];
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
            entries.push({ contractorName, routeName });
          }
        }
      }

      if (attachments.length === 0) return res.status(400).json({ error: 'No lists generated for selected contractors (no routes or data).' });
      subject = 'Lists per contractor – Thinkers';
      bodyHtml = distributionListEmailHtmlPerContractor(entries);
      bodyText = distributionListEmailTextPerContractor(entries);
    } else {
      if (listType === 'fleet' || listType === 'both') {
        if (usePdf) {
          const fleetBuffer = await buildFleetListPdf(query, tenantId, routeIds.length > 0 ? routeIds : null, fleetCols);
          attachments.push({ filename: 'fleet-list.pdf', content: fleetBuffer.toString('base64'), encoding: 'base64' });
        } else if (useExcel) {
          const fleetBuffer = await buildFleetListExcel(query, tenantId, routeIds.length > 0 ? routeIds : null, fleetCols);
          attachments.push({ filename: 'fleet-list.xlsx', content: fleetBuffer.toString('base64'), encoding: 'base64' });
        } else {
          const fleetCsv = await buildFleetListCsv(query, tenantId, routeIds.length > 0 ? routeIds : null, fleetCols);
          attachments.push({ filename: 'fleet-list.csv', content: Buffer.from(fleetCsv, 'utf8').toString('base64'), encoding: 'base64' });
        }
      }
      if (listType === 'driver' || listType === 'both') {
        if (usePdf) {
          const driverBuffer = await buildDriverListPdf(query, tenantId, routeIds.length > 0 ? routeIds : null, driverCols);
          attachments.push({ filename: 'driver-list.pdf', content: driverBuffer.toString('base64'), encoding: 'base64' });
        } else if (useExcel) {
          const driverBuffer = await buildDriverListExcel(query, tenantId, routeIds.length > 0 ? routeIds : null, driverCols);
          attachments.push({ filename: 'driver-list.xlsx', content: driverBuffer.toString('base64'), encoding: 'base64' });
        } else {
          const driverCsv = await buildDriverListCsv(query, tenantId, routeIds.length > 0 ? routeIds : null, driverCols);
          attachments.push({ filename: 'driver-list.csv', content: Buffer.from(driverCsv, 'utf8').toString('base64'), encoding: 'base64' });
        }
      }
      if (attachments.length === 0) return res.status(400).json({ error: 'list_type must be fleet, driver, or both' });

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
    for (const to of emails) {
      try {
        await sendEmail({ to, subject, body: emailBodyHtml, html: true, text: emailBodyText, attachments, cc: ccEmails });
        await query(
          `INSERT INTO access_distribution_history (tenant_id, created_by_user_id, list_type, route_ids, format, channel, recipient_email, recipient_phone, created_by_name)
           VALUES (@tenantId, @userId, @list_type, @route_ids, @format, 'email', @recipient_email, NULL, @created_by_name)`,
          { tenantId: historyTenantId, userId: userId || null, list_type: listType, route_ids: routeIdsStr, format: formatForHistory, recipient_email: to, created_by_name: userName }
        );
        sent.push(to);
      } catch (err) {
        console.error('[contractor/distribution] Send to', to, err?.message || err);
        failed.push({ email: to, error: err?.message || 'Send failed' });
      }
    }
    res.json({ ok: true, sent: sent.length, failed: failed.length, sentTo: sent, failedTo: failed });
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

router.get('/library/document-types', (req, res) => {
  res.json({ documentTypes: LIBRARY_DOCUMENT_TYPES });
});

router.get('/library', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = await query(
      `SELECT id, document_type, file_name, stored_path, file_size, mime_type, created_at FROM contractor_library_documents WHERE tenant_id = @tenantId ORDER BY document_type ASC, created_at DESC`,
      { tenantId }
    );
    res.json({ documents: result.recordset || [] });
  } catch (err) {
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
    const relativePath = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).split(path.sep).join('/');
    await query(
      `INSERT INTO contractor_library_documents (tenant_id, document_type, file_name, stored_path, file_size, mime_type) VALUES (@tenantId, @document_type, @file_name, @stored_path, @file_size, @mime_type)`,
      {
        tenantId,
        document_type: documentType,
        file_name: req.file.originalname || req.file.filename,
        stored_path: relativePath,
        file_size: req.file.size || null,
        mime_type: req.file.mimetype || null,
      }
    );
    const getResult = await query(
      `SELECT TOP 1 id, document_type, file_name, stored_path, file_size, mime_type, created_at FROM contractor_library_documents WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
      { tenantId }
    );
    res.status(201).json({ document: getResult.recordset?.[0] });
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

// Messages; scoped by contractor
router.get('/messages', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const allowed = await getAllowedContractorIds(req);
    if (allowed && allowed.length === 0) {
      return res.json({ messages: [] });
    }
    let whereClause = ' WHERE m.tenant_id = @tenantId';
    const params = { tenantId };
    if (allowed && allowed.length > 0) {
      const placeholders = allowed.map((_, i) => `@c${i}`).join(',');
      whereClause += ` AND m.contractor_id IN (${placeholders})`;
      allowed.forEach((id, i) => { params[`c${i}`] = id; });
    }
    const result = await query(
      `SELECT m.*, u.full_name AS sender_name FROM contractor_messages m
       JOIN users u ON u.id = m.sender_id
       ${whereClause} ORDER BY m.created_at DESC`,
      params
    );
    res.json({ messages: result.recordset || [] });
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
router.post('/messages', async (req, res, next) => {
  try {
    const { subject, body } = req.body || {};
    const contractorId = await resolveContractorIdForCreate(req, req.body?.contractor_id);
    const result = await query(
      `INSERT INTO contractor_messages (tenant_id, contractor_id, sender_id, subject, body)
       OUTPUT INSERTED.* VALUES (@tenantId, @contractorId, @senderId, @subject, @body)`,
      {
        tenantId: req.user.tenant_id,
        contractorId: contractorId ?? null,
        senderId: req.user.id,
        subject: subject || '',
        body: body || null,
      }
    );
    res.status(201).json({ message: result.recordset[0] });
  } catch (err) {
    if (err.message && err.message.includes('contractor_id')) {
      const fallback = await query(
        `INSERT INTO contractor_messages (tenant_id, sender_id, subject, body)
         OUTPUT INSERTED.* VALUES (@tenantId, @senderId, @subject, @body)`,
        { tenantId: req.user.tenant_id, senderId: req.user.id, subject: (req.body?.subject || ''), body: req.body?.body ?? null }
      );
      return res.status(201).json({ message: fallback.recordset[0] });
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

export default router;
