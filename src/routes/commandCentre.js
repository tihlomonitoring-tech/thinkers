import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin, requirePageAccess } from '../middleware/auth.js';
import { getTenantUserEmails, getContractorUserEmails, getCommandCentreAndRectorEmails, getAccessManagementEmails } from '../lib/emailRecipients.js';
import { applicationApprovedHtml, applicationBulkApprovedHtml, breakdownResolvedHtml, truckSuspendedToContractorHtml, truckSuspendedToRectorHtml, truckReinstatedToContractorHtml, truckReinstatedToRectorHtml, reinstatedToContractorHtml, reinstatedToRectorHtml, reinstatedToAccessManagementHtml, shiftReportOverrideRequestHtml, shiftReportOverrideCodeToRequesterHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

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

const router = Router();

/** Tab IDs that exist in Command Centre (must match client CC_TABS) */
export const CC_TAB_IDS = [
  'dashboard',
  'reports',
  'saved_reports',
  'trends',
  'shift_items',
  'shift_report_exports',
  'requests',
  'library',
  'compliance',
  'inspected',
  'inspection_records',
  'contractor_block',
  'applications',
  'delivery',
  'contractors_details',
  'breakdowns',
  'delete_fleet_drivers',
];

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('command_centre'));

/** GET my allowed tabs. Super_admin gets all; others get from grants. Breakdowns tab is included for everyone who has any CC tab. */
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
    if (tabs.length > 0 && !tabs.includes('breakdowns') && CC_TAB_IDS.includes('breakdowns')) {
      tabs = [...tabs, 'breakdowns'];
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
    const result = await query(
      `INSERT INTO cc_compliance_inspections (
        tenant_id, truck_id, driver_id, inspector_user_id,
        truck_registration, truck_make_model, driver_name, driver_id_number, license_number,
        gps_status, gps_comment, camera_status, camera_comment, camera_visibility, camera_visibility_comment,
        driver_items_json, recommend_suspend_truck, recommend_suspend_driver, response_due_at, [status]
      ) OUTPUT INSERTED.* VALUES (
        @tenantId, @truckId, @driverId, @inspectorUserId,
        @truckRegistration, @truckMakeModel, @driverName, @driverIdNumber, @licenseNumber,
        @gpsStatus, @gpsComment, @cameraStatus, @cameraComment, @cameraVisibility, @cameraVisibilityComment,
        @driverItemsJson, @recommendSuspendTruck, @recommendSuspendDriver, @responseDueAt, @status
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

function rowToComplianceInspection(r, responseAttachments = []) {
  if (!r) return null;
  let driverItems = [];
  try {
    const raw = getRow(r, 'driver_items_json');
    if (raw) driverItems = JSON.parse(raw);
  } catch (_) {}
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    truckId: getRow(r, 'truck_id'),
    driverId: getRow(r, 'driver_id'),
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
    // Remove truck from all route enrollments so it is not on list distribution
    await query(
      `DELETE FROM contractor_route_trucks WHERE truck_id = @truckId
       AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
      { truckId, tenantId }
    );
    // Email contractor and rector (grey templates)
    if (isEmailConfigured?.() && sendEmail && getCommandCentreAndRectorEmails) {
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
          if (endsAt) suspensionEndsAt = typeof endsAt === 'string' ? endsAt : (endsAt.toISOString ? endsAt.toISOString().slice(0, 10) : String(endsAt));
        }
        const contractorEmails = truckContractorId ? await getContractorUserEmails(query, tenantId, truckContractorId) : await getTenantUserEmails(query, tenantId);
        const rectorEmails = await getCommandCentreAndRectorEmails(query);
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
    if (tenantId && entityId && isEmailConfigured?.() && sendEmail && getCommandCentreAndRectorEmails && getAccessManagementEmails) {
      try {
        const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
        let entityLabel = '';
        let entityContractorId = null;
        if (entityType === 'truck') {
          const truckInfo = await query(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const tr = truckInfo.recordset?.[0];
          entityLabel = tr?.registration || `Truck #${entityId}`;
          entityContractorId = tr?.contractor_id ?? tr?.contractor_Id ?? null;
        } else {
          const driverInfo = await query(`SELECT full_name, contractor_id FROM contractor_drivers WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const dr = driverInfo.recordset?.[0];
          entityLabel = dr?.full_name || `Driver #${entityId}`;
          entityContractorId = dr?.contractor_id ?? dr?.contractor_Id ?? null;
        }
        const appUrl = process.env.APP_URL || '';
        const reinstatedBy = req.user?.full_name || req.user?.email || 'Command Centre';
        const contractorEmails = entityContractorId ? await getContractorUserEmails(query, tenantId, entityContractorId) : await getTenantUserEmails(query, tenantId);
        const rectorEmails = await getCommandCentreAndRectorEmails(query);
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
/** GET list fleet applications (all contract additions including imports). Optional ?status=pending */
router.get('/fleet-applications', async (req, res, next) => {
  try {
    const statusFilter = req.query.status === 'pending' ? "AND a.[status] = N'pending'" : '';
    const result = await query(
      `SELECT a.id, a.tenant_id, a.entity_type, a.entity_id, a.source, a.[status], a.reviewed_by_user_id, a.reviewed_at, a.decline_reason, a.created_at,
        COALESCE(c.name, t.name) AS contractor_name,
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
       WHERE 1=1 ${statusFilter}
       ORDER BY a.created_at DESC`
    );
    const rows = result.recordset || [];
    const list = rows.map((r) => ({
      id: getRow(r, 'id'),
      tenantId: getRow(r, 'tenant_id'),
      contractorName: getRow(r, 'contractor_name'),
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

/** GET list for Delete contractors fleets/drivers tab. Query: tenant_id, contractor_id, type=truck|driver|breakdown|all. Returns trucks, drivers, breakdowns, tenants, contractors. */
router.get('/delete-fleet-drivers/list', async (req, res, next) => {
  try {
    const { tenant_id: tenantId, contractor_id: contractorId, type = 'all' } = req.query || {};
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
    const tenantFilter = tenantId ? ' AND tr.tenant_id = @tenantId' : '';
    const contractorFilter = contractorId ? ' AND tr.contractor_id = @contractorId' : '';
    const params = {};
    if (tenantId) params.tenantId = tenantId;
    if (contractorId) params.contractorId = contractorId;

    let trucks = [];
    if (type === 'all' || type === 'truck') {
      const trResult = await query(
        `SELECT tr.id, tr.tenant_id, tr.contractor_id, tr.registration, tr.make_model, tr.[status],
          t.name AS tenant_name, c.name AS contractor_name
         FROM contractor_trucks tr
         LEFT JOIN tenants t ON t.id = tr.tenant_id
         LEFT JOIN contractors c ON c.id = tr.contractor_id
         WHERE 1=1 ${tenantFilter} ${contractorFilter}
         ORDER BY t.name, c.name, tr.registration`,
        params
      );
      trucks = (trResult.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        tenantId: getRow(r, 'tenant_id'),
        contractorId: getRow(r, 'contractor_id'),
        registration: getRow(r, 'registration'),
        makeModel: getRow(r, 'make_model'),
        status: getRow(r, 'status'),
        tenantName: getRow(r, 'tenant_name'),
        contractorName: getRow(r, 'contractor_name'),
      }));
    }

    let drivers = [];
    if (type === 'all' || type === 'driver') {
      const drFilter = tenantId ? ' AND d.tenant_id = @tenantId' : '';
      const drContractorFilter = contractorId ? ' AND d.contractor_id = @contractorId' : '';
      const drResult = await query(
        `SELECT d.id, d.tenant_id, d.contractor_id, d.full_name, d.surname, d.id_number, d.license_number,
          t.name AS tenant_name, c.name AS contractor_name
         FROM contractor_drivers d
         LEFT JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN contractors c ON c.id = d.contractor_id
         WHERE 1=1 ${drFilter} ${drContractorFilter}
         ORDER BY t.name, c.name, d.full_name, d.surname`,
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

    res.json({ trucks, drivers, breakdowns, tenants, contractors });
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

/** GET one breakdown (full detail for view / PDF) */
router.get('/breakdowns/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT i.*, t.name AS tenant_name, tr.registration AS truck_registration, r.name AS route_name,
              d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email
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
      `SELECT i.id, i.tenant_id, i.contractor_id, i.title, i.resolution_note, i.resolved_at, t.name AS tenant_name,
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
    const resolvedAtStr = row?.resolved_at ? new Date(row.resolved_at).toLocaleString() : new Date().toLocaleString();
    const contractorName = row?.contractor_name ?? row?.contractor_Name ?? null;
    const incidentContractorId = row?.contractor_id ?? row?.contractor_Id ?? null;
    (async () => {
      try {
        if (!isEmailConfigured() || !sendEmail || !getCommandCentreAndRectorEmails) return;
        const ccRectorEmails = await getCommandCentreAndRectorEmails(query);
        const driverEmail = (row?.driver_email || '').trim();
        const tenantId = row?.tenant_id || updated.tenant_id;
        const contractorEmails = tenantId ? (incidentContractorId ? await getContractorUserEmails(query, tenantId, incidentContractorId) : await getTenantUserEmails(query, tenantId)) : [];
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

const BREAKDOWN_ATTACHMENT_TYPES = ['loading_slip', 'seal_1', 'seal_2', 'picture_problem', 'offloading_slip'];
const BREAKDOWN_ATTACHMENT_COL = { loading_slip: 'loading_slip_path', seal_1: 'seal_1_path', seal_2: 'seal_2_path', picture_problem: 'picture_problem_path', offloading_slip: 'offloading_slip_path' };
/** GET breakdown attachment file (for PDF generation) */
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
    const filePath = row[BREAKDOWN_ATTACHMENT_COL[type]];
    if (!filePath) return res.status(404).json({ error: 'Attachment not found' });
    const fullPath = path.join(process.cwd(), 'uploads', filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
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
        COALESCE(c.name, t.name) AS contractor_name
       FROM cc_fleet_applications a
       JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN contractor_trucks tr ON tr.id = a.entity_id AND a.entity_type = N'truck'
       LEFT JOIN contractor_drivers d ON d.id = a.entity_id AND a.entity_type = N'driver'
       LEFT JOIN contractors c ON c.id = COALESCE(tr.contractor_id, d.contractor_id)
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

/** PATCH approve: grant facility access */
router.patch('/fleet-applications/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
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
        const toEmails = contractorId ? await getContractorUserEmails(query, tenantId, contractorId) : await getTenantUserEmails(query, tenantId);
        if (toEmails.length > 0) {
          const html = applicationApprovedHtml({ entityType, entityLabel, tenantName, contractorName });
          await sendEmail({ to: toEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} approved – you can now enroll on the route`, body: html, html: true });
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

/** POST bulk-approve: approve multiple fleet applications in one request; send one email listing all with contractor names. */
router.post('/fleet-applications/bulk-approve', async (req, res, next) => {
  try {
    const { ids } = req.body || {};
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
          const key = `${tid}:${cid || 'tenant'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = cid ? await getContractorUserEmails(query, tid, cid) : await getTenantUserEmails(query, tid);
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
  'id', 'created_by_user_id', 'route', 'report_date', 'shift_date', 'shift_start', 'shift_end',
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

/** GET shift reports: created by me, or assigned to me for approval. Query ?requests=1 for only assigned to me. ?decidedByMe=1 for reports you approved/rejected (for override flow). Super_admin sees all requests and all reports. */
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
    } else {
      if (!isSuperAdmin) {
        sql += ` AND (r.created_by_user_id = @userId OR r.submitted_to_user_id = @userId)`;
        params.userId = req.user.id;
      }
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

    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    const dateToStr = dateTo.toISOString().slice(0, 10);

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
    if (req.user?.role !== 'super_admin') {
      params.userId = req.user.id;
      sql = sql.replace('WHERE 1=1', `WHERE (r.created_by_user_id = @userId OR r.submitted_to_user_id = @userId)`);
    }
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
    if (req.user?.role !== 'super_admin') {
      sql = sql.replace('WHERE 1=1', 'WHERE (r.created_by_user_id = @userId OR r.submitted_to_user_id = @userId)');
      params.userId = req.user.id;
    }
    if (dateFrom) { sql += ` AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) >= @dateFrom`; params.dateFrom = dateFrom; }
    if (dateTo) { sql += ` AND COALESCE(r.report_date, r.shift_date, CAST(r.created_at AS DATE)) <= @dateTo`; params.dateTo = dateTo; }
    if (routeFilter) { sql += ` AND LOWER(LTRIM(RTRIM(ISNULL(r.route, N'')))) = LOWER(LTRIM(RTRIM(@routeFilter)))`; params.routeFilter = routeFilter; }
    sql += ` ORDER BY r.report_date DESC, r.shift_date DESC, r.created_at DESC`;
    const result = await query(sql, params);
    const reports = (result.recordset || []).map(rowToShiftReport);

    const reportDateStr = (r) => (r.report_date || r.shift_date || r.created_at) ? new Date(r.report_date || r.shift_date || r.created_at).toISOString().slice(0, 10) : '';
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
    if (req.user?.role !== 'super_admin') {
      sql = sql.replace('WHERE r.status', 'WHERE (r.created_by_user_id = @userId OR r.submitted_to_user_id = @userId) AND r.status');
      params.userId = req.user.id;
    }
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
      const evalResult = await query(
        `SELECT id, answers, overall_comment, created_at FROM controller_evaluations WHERE shift_report_id = @reportId AND evaluator_user_id = @userId`,
        { reportId: req.params.id, userId: req.user.id }
      );
      evaluation = evalResult.recordset?.[0] ? { id: evalResult.recordset[0].id, answers: evalResult.recordset[0].answers, overall_comment: evalResult.recordset[0].overall_comment, created_at: evalResult.recordset[0].created_at } : null;
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
router.post('/shift-reports', async (req, res, next) => {
  try {
    const b = req.body || {};
    const payload = {
      created_by_user_id: req.user.id,
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
        created_by_user_id, route, report_date, shift_date, shift_start, shift_end,
        controller1_name, controller1_email, controller2_name, controller2_email,
        total_trucks_scheduled, balance_brought_down, total_loads_dispatched, total_pending_deliveries, total_loads_delivered,
        overall_performance, key_highlights, truck_updates, incidents, non_compliance_calls, investigations, communication_log,
        outstanding_issues, handover_key_info, declaration, shift_conclusion_time, status
      ) OUTPUT INSERTED.*
      VALUES (
        @created_by_user_id, @route, @report_date, @shift_date, @shift_start, @shift_end,
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

/** Helper: require evaluation for report by user, or valid override when report already in final state */
async function requireEvaluationOrOverride(query, reportId, userId, status, overrideCode) {
  const needsOverride = status === 'approved' || status === 'rejected';
  if (needsOverride && overrideCode) {
    const ov = await query(
      `SELECT id FROM shift_report_override_requests WHERE shift_report_id = @reportId AND requested_by_user_id = @userId AND code = @code AND used_at IS NULL`,
      { reportId, userId, code: String(overrideCode).trim() }
    );
    if (!ov.recordset?.length) return { error: 'Invalid or already used override code' };
    await query(`UPDATE shift_report_override_requests SET used_at = SYSUTCDATETIME() WHERE id = @id`, { id: ov.recordset[0].id });
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
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode);
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
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode);
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
    const check = await requireEvaluationOrOverride(query, req.params.id, req.user.id, existing.status, overrideCode);
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

export default router;
