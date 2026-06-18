import { query } from '../db.js';
import { sendEmail, isEmailConfigured } from './emailService.js';
import {
  getContractorUserEmails,
  getCommandCentreAndAccessManagementEmails,
  getRectorEmailsForAlertTypeAndRoutes,
} from './emailRecipients.js';
import { vehicleTrackerComplianceAlertHtml, truckSuspendedToContractorHtml, truckSuspendedToRectorHtml } from './emailTemplates.js';

/** Compliant checks remain valid for this many hours before requiring re-inspection. */
export const COMPLIANCE_VALID_HOURS = 48;

export function complianceExpiresAt(checkedAt) {
  if (!checkedAt) return null;
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + COMPLIANCE_VALID_HOURS * 3600000);
}

export function isComplianceStillValid(checkedAt, status) {
  if (status === 'grace') return true;
  if (status === 'suspended' || status === 'failed') return false;
  if (!checkedAt) return false;
  const exp = complianceExpiresAt(checkedAt);
  return exp && exp > new Date();
}

export function getRow(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    const found = Object.keys(row).find((x) => x.toLowerCase() === String(k).toLowerCase());
    if (found && row[found] != null) return row[found];
  }
  return null;
}

export function evaluateCompliancePayload(body = {}) {
  const truckChecks = {
    has_camera: !!body.has_camera,
    load_camera_working: !!body.load_camera_working,
    cab_camera_working: !!body.cab_camera_working,
    road_camera_working: !!body.road_camera_working,
    tracking_updating: !!body.tracking_updating,
  };
  const truckCompliant = Object.values(truckChecks).every(Boolean);

  const driverSectionUsed = !!body.driver_section_used;
  const driverChecks = driverSectionUsed
    ? {
        driver_wearing_ppe: !!body.driver_wearing_ppe,
        driver_no_overspeeding_24h: !!body.driver_no_overspeeding_24h,
        driver_license_valid: !!body.driver_license_valid,
      }
    : null;

  const driverCompliant = !driverSectionUsed || (driverChecks && Object.values(driverChecks).every(Boolean));
  const isCompliant = truckCompliant && driverCompliant;

  const failReasons = [];
  if (!truckChecks.has_camera) failReasons.push('Camera not fitted');
  if (!truckChecks.load_camera_working) failReasons.push('Load camera not working');
  if (!truckChecks.cab_camera_working) failReasons.push('Cab camera not working');
  if (!truckChecks.road_camera_working) failReasons.push('Road camera not working');
  if (!truckChecks.tracking_updating) failReasons.push('Tracking not updating');
  if (driverSectionUsed) {
    if (!driverChecks.driver_wearing_ppe) failReasons.push('Driver not wearing PPE');
    if (!driverChecks.driver_no_overspeeding_24h) failReasons.push('Overspeeding alerts in past 24 hours');
    if (!driverChecks.driver_license_valid) failReasons.push('Driver license/permit not valid');
  }

  return {
    ...truckChecks,
    driver_section_used: driverSectionUsed,
    driver_wearing_ppe: driverSectionUsed ? driverChecks.driver_wearing_ppe : null,
    driver_no_overspeeding_24h: driverSectionUsed ? driverChecks.driver_no_overspeeding_24h : null,
    driver_license_valid: driverSectionUsed ? driverChecks.driver_license_valid : null,
    is_compliant: isCompliant,
    fail_reasons: failReasons,
    status: isCompliant ? 'passed' : 'failed',
  };
}

function mapCheckRow(row) {
  if (!row) return null;
  let failReasons = [];
  let notifiedEmails = [];
  let routesRemoved = [];
  let driverRoutesRemoved = [];
  try {
    failReasons = JSON.parse(getRow(row, 'fail_reasons_json') || '[]');
  } catch (_) {}
  try {
    notifiedEmails = JSON.parse(getRow(row, 'notified_emails_json') || '[]');
  } catch (_) {}
  try {
    routesRemoved = JSON.parse(getRow(row, 'routes_removed_json') || '[]');
  } catch (_) {}
  try {
    driverRoutesRemoved = JSON.parse(getRow(row, 'driver_routes_removed_json') || '[]');
  } catch (_) {}

  return {
    id: getRow(row, 'id'),
    tenant_id: getRow(row, 'tenant_id'),
    truck_id: getRow(row, 'truck_id'),
    driver_id: getRow(row, 'driver_id'),
    registration: getRow(row, 'registration'),
    fleet_no: getRow(row, 'fleet_no'),
    contractor_id: getRow(row, 'contractor_id'),
    contractor_name: getRow(row, 'contractor_name'),
    sub_contractor: getRow(row, 'sub_contractor'),
    driver_name: getRow(row, 'driver_name'),
    checked_by_user_id: getRow(row, 'checked_by_user_id'),
    checked_by_name: getRow(row, 'checked_by_name'),
    checked_at: getRow(row, 'checked_at'),
    is_compliant: !!getRow(row, 'is_compliant'),
    has_camera: !!getRow(row, 'has_camera'),
    load_camera_working: !!getRow(row, 'load_camera_working'),
    cab_camera_working: !!getRow(row, 'cab_camera_working'),
    road_camera_working: !!getRow(row, 'road_camera_working'),
    tracking_updating: !!getRow(row, 'tracking_updating'),
    driver_section_used: !!getRow(row, 'driver_section_used'),
    driver_wearing_ppe: getRow(row, 'driver_wearing_ppe'),
    driver_no_overspeeding_24h: getRow(row, 'driver_section_used')
      ? !getRow(row, 'driver_overspeeding_24h')
      : null,
    driver_license_valid: getRow(row, 'driver_license_valid'),
    fail_reasons: failReasons,
    notified_at: getRow(row, 'notified_at'),
    notified_emails: notifiedEmails,
    grace_period_reason: getRow(row, 'grace_period_reason'),
    grace_period_expires_at: getRow(row, 'grace_period_expires_at'),
    grace_period_granted_at: getRow(row, 'grace_period_granted_at'),
    truck_suspension_id: getRow(row, 'truck_suspension_id'),
    driver_suspension_id: getRow(row, 'driver_suspension_id'),
    routes_removed: routesRemoved,
    driver_routes_removed: driverRoutesRemoved,
    status: getRow(row, 'status'),
    notes: getRow(row, 'notes'),
    compliance_expires_at: getRow(row, 'compliance_expires_at'),
    tracking_provider: getRow(row, 'tracking_provider'),
    tracking_username: getRow(row, 'tracking_username'),
    tracking_password: getRow(row, 'tracking_password'),
    is_suspended: !!getRow(row, 'is_suspended'),
    current_status_label: getRow(row, 'current_status_label'),
    last_check_at: getRow(row, 'last_check_at'),
  };
}

export async function listEnrolledTrackerTrucks(
  q,
  {
    tenantId,
    contractorId,
    subContractor,
    search,
    complianceStatus,
    enrolledOnly = true,
    truckId,
  } = {}
) {
  let sql = `
    WITH LatestCheck AS (
      SELECT c.*,
        ROW_NUMBER() OVER (PARTITION BY c.truck_id ORDER BY c.checked_at DESC, c.created_at DESC) AS rn
      FROM vehicle_tracker_compliance_checks c
      WHERE c.tenant_id = @tenantId
    ),
    ActiveSusp AS (
      SELECT TRY_CAST(entity_id AS UNIQUEIDENTIFIER) AS truck_id
      FROM contractor_suspensions
      WHERE tenant_id = @tenantId AND entity_type = N'truck'
        AND [status] IN (N'suspended', N'under_appeal')
        AND (is_permanent = 1 OR suspension_ends_at IS NULL OR suspension_ends_at > SYSUTCDATETIME())
    )
    SELECT
      t.id AS truck_id,
      t.registration,
      t.fleet_no,
      t.sub_contractor,
      t.contractor_id,
      c.name AS contractor_name,
      t.tracking_provider,
      t.tracking_username,
      t.tracking_password,
      lc.checked_at AS last_check_at,
      lc.is_compliant AS last_is_compliant,
      lc.status AS last_check_status,
      lc.grace_period_expires_at,
      CASE WHEN s.truck_id IS NOT NULL THEN 1 ELSE 0 END AS is_suspended,
      CASE
        WHEN s.truck_id IS NOT NULL THEN N'Suspended'
        WHEN lc.id IS NULL THEN N'Not checked'
        WHEN lc.status = N'grace' AND lc.grace_period_expires_at > SYSUTCDATETIME() THEN N'Grace period'
        WHEN lc.is_compliant = 1 AND lc.status IN (N'passed', N'expired')
          AND lc.checked_at >= DATEADD(hour, -${COMPLIANCE_VALID_HOURS}, SYSUTCDATETIME()) THEN N'Compliant'
        WHEN lc.is_compliant = 1 AND lc.checked_at < DATEADD(hour, -${COMPLIANCE_VALID_HOURS}, SYSUTCDATETIME()) THEN N'Expired'
        ELSE N'Not compliant'
      END AS current_status_label,
      lc.id AS latest_check_id,
      CASE
        WHEN lc.checked_at IS NOT NULL THEN DATEADD(hour, ${COMPLIANCE_VALID_HOURS}, lc.checked_at)
        ELSE NULL
      END AS compliance_expires_at
    FROM contractor_trucks t
    INNER JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = t.tenant_id
    LEFT JOIN LatestCheck lc ON lc.truck_id = t.id AND lc.rn = 1
    LEFT JOIN ActiveSusp s ON s.truck_id = t.id
    WHERE t.tenant_id = @tenantId
  `;
  const params = { tenantId };

  if (enrolledOnly) {
    sql += ` AND EXISTS (
      SELECT 1 FROM contractor_route_trucks rt
      INNER JOIN contractor_routes r ON r.id = rt.route_id AND r.tenant_id = t.tenant_id
      WHERE rt.truck_id = t.id
    )`;
  }

  if (truckId) {
    sql += ` AND t.id = @truckId`;
    params.truckId = truckId;
  }

  if (contractorId) {
    sql += ` AND t.contractor_id = @contractorId`;
    params.contractorId = contractorId;
  }
  if (subContractor) {
    sql += ` AND LTRIM(RTRIM(ISNULL(t.sub_contractor, N''))) = @subContractor`;
    params.subContractor = subContractor;
  }
  if (search) {
    sql += ` AND (
      t.registration LIKE @search OR t.fleet_no LIKE @search OR c.name LIKE @search OR t.sub_contractor LIKE @search
    )`;
    params.search = `%${search}%`;
  }

  sql += ` ORDER BY c.name, t.sub_contractor, t.registration`;

  let rows;
  try {
    const r = await q(sql, params);
    rows = r.recordset || [];
  } catch (e) {
    if (String(e.message || '').includes('vehicle_tracker_compliance_checks')) {
      return { migrationRequired: true, trucks: [], subcontractors: [] };
    }
    throw e;
  }

  let trucks = rows.map((row) => ({
    truck_id: getRow(row, 'truck_id'),
    registration: getRow(row, 'registration'),
    fleet_no: getRow(row, 'fleet_no'),
    contractor_id: getRow(row, 'contractor_id'),
    contractor_name: getRow(row, 'contractor_name'),
    sub_contractor: getRow(row, 'sub_contractor'),
    tracking_provider: getRow(row, 'tracking_provider'),
    tracking_username: getRow(row, 'tracking_username'),
    tracking_password: getRow(row, 'tracking_password'),
    last_tracker_inspection_date: getRow(row, 'last_check_at'),
    compliance_expires_at: getRow(row, 'compliance_expires_at'),
    is_compliant:
      getRow(row, 'current_status_label') === 'Compliant' ||
      getRow(row, 'current_status_label') === 'Grace period',
    current_status_label: getRow(row, 'current_status_label'),
    is_suspended: !!getRow(row, 'is_suspended'),
    latest_check_id: getRow(row, 'latest_check_id'),
    grace_period_expires_at: getRow(row, 'grace_period_expires_at'),
  }));

  if (complianceStatus === 'compliant') {
    trucks = trucks.filter((t) => t.current_status_label === 'Compliant' || t.current_status_label === 'Grace period');
  } else if (complianceStatus === 'non_compliant') {
    trucks = trucks.filter((t) => t.current_status_label === 'Not compliant');
  } else if (complianceStatus === 'expired') {
    trucks = trucks.filter((t) => t.current_status_label === 'Expired');
  } else if (complianceStatus === 'not_checked') {
    trucks = trucks.filter((t) => t.current_status_label === 'Not checked');
  } else if (complianceStatus === 'suspended') {
    trucks = trucks.filter((t) => t.is_suspended);
  }

  const subcontractors = [...new Set(trucks.map((t) => t.sub_contractor).filter(Boolean))].sort();

  return { trucks, subcontractors, migrationRequired: false };
}

export async function getTruckTrackerDetail(q, { tenantId, truckId }) {
  const r = await q(
    `SELECT t.id AS truck_id, t.registration, t.fleet_no, t.sub_contractor, t.contractor_id,
            c.name AS contractor_name, t.tracking_provider, t.tracking_username, t.tracking_password
     FROM contractor_trucks t
     INNER JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = t.tenant_id
     WHERE t.id = @truckId AND t.tenant_id = @tenantId`,
    { truckId, tenantId }
  );
  const row = r.recordset?.[0];
  if (!row) return null;
  const routes = await q(
    `SELECT r.id, r.name FROM contractor_route_trucks rt
     INNER JOIN contractor_routes r ON r.id = rt.route_id
     WHERE rt.truck_id = @truckId AND r.tenant_id = @tenantId`,
    { truckId, tenantId }
  );
  return {
    truck_id: getRow(row, 'truck_id'),
    registration: getRow(row, 'registration'),
    fleet_no: getRow(row, 'fleet_no'),
    contractor_id: getRow(row, 'contractor_id'),
    contractor_name: getRow(row, 'contractor_name'),
    sub_contractor: getRow(row, 'sub_contractor'),
    tracking_provider: getRow(row, 'tracking_provider'),
    tracking_username: getRow(row, 'tracking_username'),
    tracking_password: getRow(row, 'tracking_password'),
    routes: (routes.recordset || []).map((rr) => ({ id: getRow(rr, 'id'), name: getRow(rr, 'name') })),
  };
}

export async function createTrackerComplianceCheck(q, { tenantId, userId, truckId, driverId, body }) {
  const evaluated = evaluateCompliancePayload(body);
  const ins = await q(
    `INSERT INTO vehicle_tracker_compliance_checks (
      tenant_id, truck_id, driver_id, checked_by_user_id, checked_at, is_compliant,
      has_camera, load_camera_working, cab_camera_working, road_camera_working, tracking_updating,
      driver_section_used, driver_wearing_ppe, driver_overspeeding_24h, driver_license_valid,
      fail_reasons_json, [status], notes, compliance_expires_at
    ) OUTPUT INSERTED.id
    VALUES (
      @tenantId, @truckId, @driverId, @userId, SYSUTCDATETIME(), @isCompliant,
      @has_camera, @load_camera_working, @cab_camera_working, @road_camera_working, @tracking_updating,
      @driver_section_used, @driver_wearing_ppe, @driver_overspeeding_24h, @driver_license_valid,
      @failReasonsJson, @status, @notes, DATEADD(hour, ${COMPLIANCE_VALID_HOURS}, SYSUTCDATETIME())
    )`,
    {
      tenantId,
      truckId,
      driverId: driverId || null,
      userId,
      isCompliant: evaluated.is_compliant ? 1 : 0,
      has_camera: evaluated.has_camera ? 1 : 0,
      load_camera_working: evaluated.load_camera_working ? 1 : 0,
      cab_camera_working: evaluated.cab_camera_working ? 1 : 0,
      road_camera_working: evaluated.road_camera_working ? 1 : 0,
      tracking_updating: evaluated.tracking_updating ? 1 : 0,
      driver_section_used: evaluated.driver_section_used ? 1 : 0,
      driver_wearing_ppe: evaluated.driver_wearing_ppe == null ? null : evaluated.driver_wearing_ppe ? 1 : 0,
      driver_overspeeding_24h: evaluated.driver_no_overspeeding_24h == null ? null : evaluated.driver_no_overspeeding_24h ? 0 : 1,
      driver_license_valid: evaluated.driver_license_valid == null ? null : evaluated.driver_license_valid ? 1 : 0,
      failReasonsJson: JSON.stringify(evaluated.fail_reasons),
      status: evaluated.status,
      notes: body.notes || null,
    }
  );
  const checkId = getRow(ins.recordset?.[0], 'id');
  return { id: checkId, ...evaluated };
}

async function loadCheck(q, { tenantId, checkId }) {
  const r = await q(
    `SELECT c.*, t.registration, t.fleet_no, t.sub_contractor, t.contractor_id, t.tracking_provider,
            t.tracking_username, t.tracking_password, co.name AS contractor_name,
            u.full_name AS checked_by_name, d.full_name AS driver_name
     FROM vehicle_tracker_compliance_checks c
     INNER JOIN contractor_trucks t ON t.id = c.truck_id
     INNER JOIN contractors co ON co.id = t.contractor_id
     LEFT JOIN users u ON u.id = c.checked_by_user_id
     LEFT JOIN contractor_drivers d ON d.id = c.driver_id
     WHERE c.id = @checkId AND c.tenant_id = @tenantId`,
    { checkId, tenantId }
  );
  return mapCheckRow(r.recordset?.[0]);
}

export async function listTrackerComplianceHistory(q, { tenantId, contractorId, subContractor, search, dateFrom, dateTo, limit = 200 }) {
  let sql = `
    SELECT c.*, t.registration, t.fleet_no, t.sub_contractor, t.contractor_id, t.tracking_provider,
           t.tracking_username, t.tracking_password, co.name AS contractor_name,
           u.full_name AS checked_by_name, d.full_name AS driver_name,
           CASE WHEN susp.truck_id IS NOT NULL THEN 1 ELSE 0 END AS is_suspended
    FROM vehicle_tracker_compliance_checks c
    INNER JOIN contractor_trucks t ON t.id = c.truck_id
    INNER JOIN contractors co ON co.id = t.contractor_id
    LEFT JOIN users u ON u.id = c.checked_by_user_id
    LEFT JOIN contractor_drivers d ON d.id = c.driver_id
    LEFT JOIN (
      SELECT TRY_CAST(entity_id AS UNIQUEIDENTIFIER) AS truck_id
      FROM contractor_suspensions
      WHERE tenant_id = @tenantId AND entity_type = N'truck'
        AND [status] IN (N'suspended', N'under_appeal')
    ) susp ON susp.truck_id = t.id
    WHERE c.tenant_id = @tenantId
  `;
  const params = { tenantId, limit: Math.min(Number(limit) || 200, 5000) };
  if (contractorId) {
    sql += ` AND t.contractor_id = @contractorId`;
    params.contractorId = contractorId;
  }
  if (subContractor) {
    sql += ` AND LTRIM(RTRIM(ISNULL(t.sub_contractor, N''))) = @subContractor`;
    params.subContractor = subContractor;
  }
  if (search) {
    sql += ` AND (t.registration LIKE @search OR t.fleet_no LIKE @search OR co.name LIKE @search)`;
    params.search = `%${search}%`;
  }
  if (dateFrom) {
    sql += ` AND c.checked_at >= @dateFrom`;
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    sql += ` AND c.checked_at <= @dateTo`;
    params.dateTo = dateTo;
  }
  sql += ` ORDER BY c.checked_at DESC OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`;
  const r = await q(sql, params);
  return (r.recordset || []).map(mapCheckRow);
}

export async function listTrackerSuspensions(q, { tenantId, contractorId, search, entityType }) {
  let sql = `
    SELECT s.*, t.registration, t.fleet_no, t.sub_contractor, co.name AS contractor_name,
           d.full_name AS driver_name, vc.id AS tracker_check_id
    FROM contractor_suspensions s
    LEFT JOIN contractor_trucks t ON s.entity_type = N'truck' AND TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) = t.id
    LEFT JOIN contractors co ON co.id = t.contractor_id
    LEFT JOIN contractor_drivers d ON s.entity_type = N'driver' AND TRY_CAST(s.entity_id AS UNIQUEIDENTIFIER) = d.id
    LEFT JOIN vehicle_tracker_compliance_checks vc ON vc.truck_suspension_id = s.id OR vc.driver_suspension_id = s.id
    WHERE s.tenant_id = @tenantId
      AND s.[status] IN (N'suspended', N'under_appeal')
      AND s.entity_type IN (N'truck', N'driver')
      AND (s.is_permanent = 1 OR s.suspension_ends_at IS NULL OR s.suspension_ends_at > SYSUTCDATETIME())
  `;
  const params = { tenantId };
  if (entityType === 'truck' || entityType === 'driver') {
    sql += ` AND s.entity_type = @entityType`;
    params.entityType = entityType;
  }
  if (contractorId) {
    sql += ` AND (t.contractor_id = @contractorId OR d.contractor_id = @contractorId)`;
    params.contractorId = contractorId;
  }
  if (search) {
    sql += ` AND (t.registration LIKE @search OR t.fleet_no LIKE @search OR co.name LIKE @search OR d.full_name LIKE @search)`;
    params.search = `%${search}%`;
  }
  sql += ` ORDER BY s.created_at DESC`;
  const r = await q(sql, params);
  return (r.recordset || []).map((row) => ({
    id: getRow(row, 'id'),
    entity_type: getRow(row, 'entity_type'),
    entity_id: getRow(row, 'entity_id'),
    reason: getRow(row, 'reason'),
    status: getRow(row, 'status'),
    created_at: getRow(row, 'created_at'),
    suspension_ends_at: getRow(row, 'suspension_ends_at'),
    is_permanent: !!getRow(row, 'is_permanent'),
    registration: getRow(row, 'registration'),
    fleet_no: getRow(row, 'fleet_no'),
    contractor_name: getRow(row, 'contractor_name'),
    sub_contractor: getRow(row, 'sub_contractor'),
    driver_name: getRow(row, 'driver_name'),
    tracker_compliance: !!getRow(row, 'tracker_check_id'),
  }));
}

export async function getTruckComplianceFullDetail(q, { tenantId, truckId }) {
  const truck = await getTruckTrackerDetail(q, { tenantId, truckId });
  if (!truck) return null;
  const checks = await q(
    `SELECT c.*, u.full_name AS checked_by_name, d.full_name AS driver_name
     FROM vehicle_tracker_compliance_checks c
     LEFT JOIN users u ON u.id = c.checked_by_user_id
     LEFT JOIN contractor_drivers d ON d.id = c.driver_id
     WHERE c.tenant_id = @tenantId AND c.truck_id = @truckId
     ORDER BY c.checked_at DESC`,
    { tenantId, truckId }
  );
  const latest = await listEnrolledTrackerTrucks(q, {
    tenantId,
    enrolledOnly: false,
    truckId,
  });
  const statusRow = (latest.trucks || [])[0] || null;
  return {
    truck,
    current_status: statusRow || null,
    checks: (checks.recordset || []).map(mapCheckRow),
  };
}

export async function runPassedCheckExpiry(q) {
  const r = await q(
    `UPDATE vehicle_tracker_compliance_checks
     SET [status] = N'expired', updated_at = SYSUTCDATETIME()
     WHERE [status] = N'passed' AND is_compliant = 1
       AND checked_at < DATEADD(hour, -@hours, SYSUTCDATETIME())`,
    { hours: COMPLIANCE_VALID_HOURS }
  );
  return { updated: r.rowsAffected?.[0] ?? 0 };
}

export async function listGracePeriods(q, { tenantId, activeOnly = false }) {
  let sql = `
    SELECT c.*, t.registration, t.fleet_no, t.sub_contractor, t.contractor_id, co.name AS contractor_name,
           u.full_name AS checked_by_name
    FROM vehicle_tracker_compliance_checks c
    INNER JOIN contractor_trucks t ON t.id = c.truck_id
    INNER JOIN contractors co ON co.id = t.contractor_id
    LEFT JOIN users u ON u.id = c.grace_period_granted_by
    WHERE c.tenant_id = @tenantId AND c.grace_period_expires_at IS NOT NULL
  `;
  if (activeOnly) {
    sql += ` AND c.status = N'grace' AND c.grace_period_expires_at > SYSUTCDATETIME()`;
  }
  sql += ` ORDER BY c.grace_period_expires_at ASC`;
  const r = await q(sql, { tenantId });
  return (r.recordset || []).map(mapCheckRow);
}

export async function notifyContractorForCheck(q, { tenantId, checkId, extraEmails = [], customMessage = '' }) {
  const check = await loadCheck(q, { tenantId, checkId });
  if (!check) return { error: 'Check not found', status: 404 };
  if (check.is_compliant) return { error: 'Check is compliant — notification not required', status: 400 };

  const contractorEmails = check.contractor_id
    ? await getContractorUserEmails(q, tenantId, check.contractor_id)
    : [];
  const manual = (Array.isArray(extraEmails) ? extraEmails : String(extraEmails || '').split(/[,;]/))
    .map((e) => e.trim())
    .filter(Boolean);
  const recipients = [...new Set([...contractorEmails, ...manual])];
  if (!recipients.length) return { error: 'No contractor email addresses available', status: 400 };

  const tenantRow = await q(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
  const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
  const html = vehicleTrackerComplianceAlertHtml({
    registration: check.registration,
    fleetNo: check.fleet_no,
    contractorName: check.contractor_name,
    tenantName,
    failReasons: check.fail_reasons,
    customMessage,
    checkedAt: check.checked_at,
  });

  if (isEmailConfigured()) {
    await sendEmail({
      to: recipients,
      subject: `Vehicle tracker compliance failure: ${check.registration}`,
      body: html,
      html: true,
    });
  }

  await q(
    `UPDATE vehicle_tracker_compliance_checks
     SET notified_at = SYSUTCDATETIME(), notified_emails_json = @emails, updated_at = SYSUTCDATETIME()
     WHERE id = @checkId AND tenant_id = @tenantId`,
    { checkId, tenantId, emails: JSON.stringify(recipients) }
  );

  return { ok: true, notified_emails: recipients };
}

export async function grantGracePeriod(q, { tenantId, userId, checkId, reason, expiresAt }) {
  const check = await loadCheck(q, { tenantId, checkId });
  if (!check) return { error: 'Check not found', status: 404 };
  if (check.is_compliant) return { error: 'Cannot grant grace on a compliant check', status: 400 };
  if (!reason?.trim()) return { error: 'Grace period reason is required', status: 400 };
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime()) || exp <= new Date()) {
    return { error: 'Grace period expiry must be in the future', status: 400 };
  }

  await q(
    `UPDATE vehicle_tracker_compliance_checks
     SET status = N'grace', grace_period_reason = @reason, grace_period_expires_at = @expiresAt,
         grace_period_granted_at = SYSUTCDATETIME(), grace_period_granted_by = @userId, updated_at = SYSUTCDATETIME()
     WHERE id = @checkId AND tenant_id = @tenantId`,
    { checkId, tenantId, userId, reason: reason.trim(), expiresAt: exp.toISOString() }
  );
  return { ok: true };
}

async function suspendTruckForTrackerCompliance(q, { tenantId, truckId, reason, routesRemoved }) {
  const existing = await q(
    `SELECT 1 FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'truck' AND entity_id = @entityId
     AND [status] IN (N'suspended', N'under_appeal')`,
    { tenantId, entityId: String(truckId) }
  );
  if (existing.recordset?.length) return { suspensionId: null, alreadySuspended: true };

  const ins = await q(
    `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], is_permanent, suspension_ends_at)
     OUTPUT INSERTED.id VALUES (@tenantId, N'truck', @entityId, @reason, N'suspended', 1, NULL)`,
    { tenantId, entityId: String(truckId), reason }
  );
  const suspensionId = getRow(ins.recordset?.[0], 'id');

  await q(
    `DELETE FROM contractor_route_trucks WHERE truck_id = @truckId
     AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
    { truckId, tenantId }
  );

  return { suspensionId, routesRemoved, alreadySuspended: false };
}

async function suspendDriverForTrackerCompliance(q, { tenantId, driverId, reason }) {
  if (!driverId) return { suspensionId: null };
  const existing = await q(
    `SELECT 1 FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'driver' AND entity_id = @entityId
     AND [status] IN (N'suspended', N'under_appeal')`,
    { tenantId, entityId: String(driverId) }
  );
  if (existing.recordset?.length) return { suspensionId: null, alreadySuspended: true };

  const routeRes = await q(`SELECT route_id FROM contractor_route_drivers WHERE driver_id = @driverId`, { driverId });
  const driverRoutes = (routeRes.recordset || []).map((r) => getRow(r, 'route_id')).filter(Boolean);

  const ins = await q(
    `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], is_permanent, suspension_ends_at)
     OUTPUT INSERTED.id VALUES (@tenantId, N'driver', @entityId, @reason, N'suspended', 1, NULL)`,
    { tenantId, entityId: String(driverId), reason }
  );
  const suspensionId = getRow(ins.recordset?.[0], 'id');

  await q(
    `DELETE FROM contractor_route_drivers WHERE driver_id = @driverId
     AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
    { driverId, tenantId }
  );

  return { suspensionId, driverRoutesRemoved: driverRoutes };
}

export async function suspendFromGraceExpiry(q, checkRow) {
  const tenantId = checkRow.tenant_id;
  const checkId = checkRow.id;
  const truckId = checkRow.truck_id;
  const driverId = checkRow.driver_id;
  const reason = `Vehicle tracker compliance grace period expired (${checkRow.registration || truckId})`;

  const routeRes = await q(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @truckId`, { truckId });
  const routesRemoved = (routeRes.recordset || []).map((r) => getRow(r, 'route_id')).filter(Boolean);

  const truckSusp = await suspendTruckForTrackerCompliance(q, { tenantId, truckId, reason, routesRemoved });
  let driverSusp = { suspensionId: null, driverRoutesRemoved: [] };
  if (checkRow.driver_section_used && !checkRow.is_compliant) {
    driverSusp = await suspendDriverForTrackerCompliance(q, { tenantId, driverId, reason });
  }

  await q(
    `UPDATE vehicle_tracker_compliance_checks
     SET status = N'suspended', truck_suspension_id = @truckSuspId, driver_suspension_id = @driverSuspId,
         routes_removed_json = @routesJson, driver_routes_removed_json = @driverRoutesJson, updated_at = SYSUTCDATETIME()
     WHERE id = @checkId`,
    {
      checkId,
      truckSuspId: truckSusp.suspensionId,
      driverSuspId: driverSusp.suspensionId,
      routesJson: JSON.stringify(routesRemoved),
      driverRoutesJson: JSON.stringify(driverSusp.driverRoutesRemoved || []),
    }
  );

  if (isEmailConfigured()) {
    try {
      const truckRow = await q(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @truckId`, { truckId });
      const tr = truckRow.recordset?.[0];
      const registration = getRow(tr, 'registration') || String(truckId);
      const contractorId = getRow(tr, 'contractor_id');
      const tenantRow = await q(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
      const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
      const contractorEmails = contractorId ? await getContractorUserEmails(q, tenantId, contractorId) : [];
      const ccAm = await getCommandCentreAndAccessManagementEmails(q);
      const rectorEmails = routesRemoved.length
        ? await getRectorEmailsForAlertTypeAndRoutes(q, 'suspension_alerts', routesRemoved)
        : [];
      const notifyRector = [...new Set([...ccAm, ...rectorEmails])];
      if (contractorEmails.length) {
        await sendEmail({
          to: contractorEmails,
          subject: `Truck suspended (tracker compliance): ${registration}`,
          body: truckSuspendedToContractorHtml({
            truckRegistration: registration,
            tenantName,
            reason,
            isPermanent: true,
            suspensionEndsAt: null,
            appUrl: process.env.APP_URL || '',
          }),
          html: true,
        });
      }
      if (notifyRector.length) {
        await sendEmail({
          to: notifyRector,
          subject: `Truck suspended (tracker compliance): ${registration} – ${tenantName}`,
          body: truckSuspendedToRectorHtml({
            truckRegistration: registration,
            tenantName,
            reason,
            isPermanent: true,
            suspensionEndsAt: null,
          }),
          html: true,
        });
      }
    } catch (e) {
      console.warn('[vehicleTrackerCompliance] grace expiry email failed:', e?.message || e);
    }
  }

  return { ok: true };
}

export async function restoreTrackerComplianceEnrollment(q, { tenantId, suspensionId }) {
  const r = await q(
    `SELECT TOP 1 * FROM vehicle_tracker_compliance_checks
     WHERE tenant_id = @tenantId AND (truck_suspension_id = @suspensionId OR driver_suspension_id = @suspensionId)`,
    { tenantId, suspensionId }
  );
  const check = r.recordset?.[0];
  if (!check) return { restored: 0 };

  let routesRemoved = [];
  let driverRoutesRemoved = [];
  try {
    routesRemoved = JSON.parse(getRow(check, 'routes_removed_json') || '[]');
  } catch (_) {}
  try {
    driverRoutesRemoved = JSON.parse(getRow(check, 'driver_routes_removed_json') || '[]');
  } catch (_) {}

  let restored = 0;
  const truckId = getRow(check, 'truck_id');
  const driverId = getRow(check, 'driver_id');

  for (const routeId of routesRemoved) {
    const exists = await q(
      `SELECT 1 FROM contractor_route_trucks WHERE route_id = @routeId AND truck_id = @truckId`,
      { routeId, truckId }
    );
    if (!exists.recordset?.length) {
      await q(
        `INSERT INTO contractor_route_trucks (route_id, truck_id) VALUES (@routeId, @truckId)`,
        { routeId, truckId }
      );
      restored += 1;
    }
  }

  for (const routeId of driverRoutesRemoved) {
    if (!driverId) continue;
    const exists = await q(
      `SELECT 1 FROM contractor_route_drivers WHERE route_id = @routeId AND driver_id = @driverId`,
      { routeId, driverId }
    );
    if (!exists.recordset?.length) {
      await q(
        `INSERT INTO contractor_route_drivers (route_id, driver_id) VALUES (@routeId, @driverId)`,
        { routeId, driverId }
      );
      restored += 1;
    }
  }

  if (getRow(check, 'truck_suspension_id') === suspensionId || getRow(check, 'driver_suspension_id') === suspensionId) {
    await q(
      `UPDATE vehicle_tracker_compliance_checks SET status = N'resolved', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: getRow(check, 'id') }
    );
  }

  return { restored };
}

export async function runTrackerComplianceGraceExpiry(q) {
  const r = await q(
    `SELECT c.*, t.registration
     FROM vehicle_tracker_compliance_checks c
     INNER JOIN contractor_trucks t ON t.id = c.truck_id
     WHERE c.status = N'grace' AND c.grace_period_expires_at IS NOT NULL
       AND c.grace_period_expires_at < SYSUTCDATETIME()`
  );
  const rows = r.recordset || [];
  let processed = 0;
  for (const row of rows) {
    try {
      await suspendFromGraceExpiry(q, mapCheckRow(row));
      processed += 1;
    } catch (e) {
      console.warn('[vehicleTrackerCompliance] grace expiry row failed:', e?.message || e);
    }
  }
  return { processed };
}

export { loadCheck, mapCheckRow };
