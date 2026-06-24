import fs from 'fs';
import path from 'path';
import { verifySaVehicle } from './saVehicleVerification/index.js';
import { buildNpTrackerReportPdfBuffer } from './npTrackerReportPdf.js';

function getRow(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function npReportRelPath(tenantId, applicationId) {
  return `np-tracker-reports/${tenantId}/${applicationId}.pdf`;
}

export async function loadFleetApplicationDetail(query, applicationId) {
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
     WHERE a.id = @applicationId`,
    { applicationId }
  );
  const app = appResult.recordset?.[0];
  if (!app) return null;
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
  return {
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
}

export async function getFleetApplicationNpReport(query, applicationId) {
  try {
    const result = await query(
      `SELECT r.id, r.fleet_application_id, r.registration, r.verification_json, r.pdf_stored_path,
              r.checked_at, r.checked_by_user_id, u.full_name AS checked_by_name
       FROM cc_fleet_application_np_reports r
       LEFT JOIN users u ON u.id = r.checked_by_user_id
       WHERE r.fleet_application_id = @applicationId`,
      { applicationId }
    );
    const row = result.recordset?.[0];
    if (!row) return null;
    let verification = null;
    try {
      verification = JSON.parse(getRow(row, 'verification_json') || '{}');
    } catch {
      verification = null;
    }
    const pdfPath = getRow(row, 'pdf_stored_path');
    return {
      id: getRow(row, 'id'),
      fleetApplicationId: getRow(row, 'fleet_application_id'),
      registration: getRow(row, 'registration'),
      verification,
      pdfStoredPath: pdfPath,
      pdfAvailable: !!(pdfPath && fs.existsSync(path.join(process.cwd(), 'uploads', pdfPath))),
      checkedAt: getRow(row, 'checked_at'),
      checkedByUserId: getRow(row, 'checked_by_user_id'),
      checkedByName: getRow(row, 'checked_by_name'),
    };
  } catch (err) {
    if (String(err?.message || '').includes('cc_fleet_application_np_reports')) return null;
    throw err;
  }
}

export async function runAndSaveFleetApplicationNpReport(query, { applicationId, userId, applicationPayload }) {
  const app = applicationPayload;
  if (!app || app.entityType !== 'truck' || !app.entity) {
    const err = new Error('NP Tracker checks apply to truck applications only');
    err.status = 400;
    throw err;
  }
  const registration = String(app.entity.registration || '').trim();
  if (!registration) {
    const err = new Error('Truck registration is required');
    err.status = 400;
    throw err;
  }

  const verification = await verifySaVehicle({
    registration,
    makeModel: app.entity.make_model || app.entity.makeModel,
  });

  const tenantId = String(app.tenantId || app.tenant_id || '');
  const pdfBuffer = await buildNpTrackerReportPdfBuffer({
    application: app,
    verification,
    checkedAt: verification.checkedAt || new Date().toISOString(),
    checkedByName: null,
  });

  const relPdf = npReportRelPath(tenantId || 'unknown', applicationId);
  const absPdf = path.join(process.cwd(), 'uploads', relPdf);
  fs.mkdirSync(path.dirname(absPdf), { recursive: true });
  fs.writeFileSync(absPdf, pdfBuffer);

  const verificationJson = JSON.stringify(verification);
  await query(
    `MERGE cc_fleet_application_np_reports AS t
     USING (SELECT @applicationId AS fleet_application_id) AS s
     ON t.fleet_application_id = s.fleet_application_id
     WHEN MATCHED THEN
       UPDATE SET registration = @registration, verification_json = @verificationJson, pdf_stored_path = @pdfPath,
                  checked_at = SYSUTCDATETIME(), checked_by_user_id = @userId
     WHEN NOT MATCHED THEN
       INSERT (fleet_application_id, registration, verification_json, pdf_stored_path, checked_by_user_id)
       VALUES (@applicationId, @registration, @verificationJson, @pdfPath, @userId);`,
    {
      applicationId,
      registration,
      verificationJson,
      pdfPath: relPdf,
      userId: userId || null,
    }
  );

  return {
    registration,
    verification,
    pdfStoredPath: relPdf,
    pdfAvailable: true,
    checkedAt: verification.checkedAt || new Date().toISOString(),
  };
}

export function resolveNpReportPdfPath(storedPath) {
  if (!storedPath) return null;
  const full = path.join(process.cwd(), 'uploads', storedPath.split('/').join(path.sep));
  return fs.existsSync(full) ? full : null;
}
