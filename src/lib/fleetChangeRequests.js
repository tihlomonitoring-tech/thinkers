import { query } from '../db.js';

const TRUCK_PATCH_FIELDS = [
  'main_contractor', 'sub_contractor', 'make_model', 'year_model', 'ownership_desc', 'fleet_no',
  'registration', 'trailer_1_reg_no', 'trailer_2_reg_no', 'tracking_provider', 'tracking_username',
  'tracking_password', 'commodity_type', 'capacity_tonnes', 'status',
];

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function normReg(registration) {
  return String(registration || '').trim().toLowerCase();
}

export function truckSnapshot(row) {
  if (!row) return {};
  return {
    main_contractor: get(row, 'main_contractor') ?? null,
    sub_contractor: get(row, 'sub_contractor') ?? null,
    make_model: get(row, 'make_model') ?? null,
    year_model: get(row, 'year_model') ?? null,
    ownership_desc: get(row, 'ownership_desc') ?? null,
    fleet_no: get(row, 'fleet_no') ?? null,
    registration: get(row, 'registration') ?? '',
    trailer_1_reg_no: get(row, 'trailer_1_reg_no') ?? null,
    trailer_2_reg_no: get(row, 'trailer_2_reg_no') ?? null,
    tracking_provider: get(row, 'tracking_provider') ?? null,
    tracking_username: get(row, 'tracking_username') ?? null,
    tracking_password: get(row, 'tracking_password') ?? null,
    commodity_type: get(row, 'commodity_type') ?? null,
    capacity_tonnes: get(row, 'capacity_tonnes') ?? null,
    status: get(row, 'status') || 'active',
  };
}

export function buildTruckProposedFromBody(body, existingRow) {
  const snap = truckSnapshot(existingRow);
  const proposed = { ...snap };
  for (const key of TRUCK_PATCH_FIELDS) {
    if (body[key] !== undefined) {
      if (key === 'registration') proposed.registration = String(body[key] ?? '').trim();
      else if (key === 'capacity_tonnes') proposed.capacity_tonnes = body.capacity_tonnes != null ? body.capacity_tonnes : null;
      else if (key === 'tracking_password') {
        if (body.tracking_password !== undefined && body.tracking_password !== '') {
          proposed.tracking_password = body.tracking_password;
        }
      } else proposed[key] = body[key] ?? null;
    }
  }
  if (body.tracking_password === undefined || body.tracking_password === '') {
    proposed.tracking_password = snap.tracking_password;
  }
  return proposed;
}

function snapshotsEqual(a, b) {
  for (const key of TRUCK_PATCH_FIELDS) {
    const av = a[key] == null ? '' : String(a[key]);
    const bv = b[key] == null ? '' : String(b[key]);
    if (key === 'tracking_password' && !b[key] && !a[key]) continue;
    if (av !== bv) return false;
  }
  return true;
}

export async function ensureFleetChangeRequestsTable() {
  await query(`SELECT TOP 0 id FROM contractor_fleet_change_requests`);
}

export async function getActiveChangeRequest(entityType, entityId) {
  try {
    const result = await query(
      `SELECT TOP 1 * FROM contractor_fleet_change_requests
       WHERE entity_type = @entityType AND entity_id = @entityId AND cc_status = N'pending'
       ORDER BY created_at DESC`,
      { entityType, entityId }
    );
    return result.recordset?.[0] || null;
  } catch (e) {
    if (e.message?.includes('Invalid object name')) return null;
    throw e;
  }
}

export async function cancelPendingChangeRequests(entityType, entityId) {
  await query(
    `UPDATE contractor_fleet_change_requests
     SET cc_status = N'declined', cc_decline_reason = N'Superseded by a newer change request',
         cc_reviewed_at = SYSUTCDATETIME()
     WHERE entity_type = @entityType AND entity_id = @entityId AND cc_status = N'pending'`,
    { entityType, entityId }
  );
}

/**
 * Create or replace a pending truck change. Returns { changeRequestId, registrationChanged, hadFacilityAccess }.
 */
export async function submitTruckChangeRequest({
  tenantId,
  truckId,
  existingRow,
  body,
  userId,
  isSubcontractorUser,
  commentText,
}) {
  await ensureFleetChangeRequestsTable();
  const previous = truckSnapshot(existingRow);
  const proposed = buildTruckProposedFromBody(body, existingRow);
  const comment = commentText != null ? String(commentText).trim() : '';
  const hasFieldChanges = !snapshotsEqual(previous, proposed);
  if (!hasFieldChanges && !comment) {
    return { skipped: true, reason: 'no_changes' };
  }

  const hadFacilityAccess = !!get(existingRow, 'facility_access');
  const registrationChanged = normReg(proposed.registration) !== normReg(previous.registration);
  const contractorStatus = isSubcontractorUser ? 'pending_contractor' : 'not_required';
  const submitterRole = isSubcontractorUser ? 'subcontractor' : 'contractor';

  await cancelPendingChangeRequests('truck', truckId);

  const insert = await query(
    `INSERT INTO contractor_fleet_change_requests (
       tenant_id, entity_type, entity_id, submitted_by_user_id, submitter_role, comment_text,
       proposed_json, previous_json, registration_changed, had_facility_access,
       contractor_status, cc_status
     )
     OUTPUT INSERTED.id
     VALUES (
       @tenantId, N'truck', @entityId, @userId, @submitterRole, @comment,
       @proposedJson, @previousJson, @registrationChanged, @hadFacilityAccess,
       @contractorStatus, N'pending'
     )`,
    {
      tenantId,
      entityId: truckId,
      userId: userId || null,
      submitterRole,
      comment: comment || null,
      proposedJson: JSON.stringify(proposed),
      previousJson: JSON.stringify(previous),
      registrationChanged: registrationChanged ? 1 : 0,
      hadFacilityAccess: hadFacilityAccess ? 1 : 0,
      contractorStatus,
    }
  );
  const changeRequestId = insert.recordset?.[0]?.id ?? insert.recordset?.[0]?.Id;
  return {
    changeRequestId,
    registrationChanged,
    hadFacilityAccess,
    pendingContractor: contractorStatus === 'pending_contractor',
    pendingCc: true,
  };
}

export async function removeTruckFromRouteEnrollments(truckId, tenantId) {
  await query(
    `DELETE FROM contractor_route_trucks WHERE truck_id = @truckId
     AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
    { truckId, tenantId }
  );
}

export async function applyTruckChangeRequest(changeRequestId, ccUserId) {
  await ensureFleetChangeRequestsTable();
  const cr = await query(
    `SELECT * FROM contractor_fleet_change_requests WHERE id = @id AND cc_status = N'pending'`,
    { id: changeRequestId }
  );
  const row = cr.recordset?.[0];
  if (!row) return { error: { status: 404, message: 'Pending change request not found' } };

  const contractorStatus = get(row, 'contractor_status');
  if (contractorStatus === 'pending_contractor') {
    return { error: { status: 400, message: 'Awaiting main contractor approval before Command Centre can accept this change.' } };
  }
  if (contractorStatus === 'declined_contractor') {
    return { error: { status: 400, message: 'This change was declined by the contractor.' } };
  }

  const entityType = get(row, 'entity_type');
  const entityId = get(row, 'entity_id');
  const tenantId = get(row, 'tenant_id');
  if (entityType !== 'truck') {
    return { error: { status: 400, message: 'Only truck changes are supported in this release.' } };
  }

  let proposed;
  try {
    proposed = JSON.parse(get(row, 'proposed_json') || '{}');
  } catch (_) {
    return { error: { status: 400, message: 'Invalid proposed change data' } };
  }

  const registrationChanged = !!get(row, 'registration_changed');
  const hadFacilityAccess = !!get(row, 'had_facility_access');

  const upd = await query(
    `UPDATE contractor_trucks SET
        main_contractor = @main_contractor, sub_contractor = @sub_contractor, make_model = @make_model, year_model = @year_model,
        ownership_desc = @ownership_desc, fleet_no = @fleet_no, registration = @registration,
        trailer_1_reg_no = @trailer_1_reg_no, trailer_2_reg_no = @trailer_2_reg_no,
        tracking_provider = @tracking_provider, tracking_username = @tracking_username,
        tracking_password = CASE WHEN @tracking_password IS NULL OR @tracking_password = N'' THEN tracking_password ELSE @tracking_password END,
        commodity_type = @commodity_type, capacity_tonnes = @capacity_tonnes, [status] = @status,
        updated_at = SYSUTCDATETIME()
     OUTPUT INSERTED.*
     WHERE id = @entityId AND tenant_id = @tenantId`,
    {
      entityId,
      tenantId,
      main_contractor: proposed.main_contractor ?? null,
      sub_contractor: proposed.sub_contractor ?? null,
      make_model: proposed.make_model ?? null,
      year_model: proposed.year_model ?? null,
      ownership_desc: proposed.ownership_desc ?? null,
      fleet_no: proposed.fleet_no ?? null,
      registration: proposed.registration ?? '',
      trailer_1_reg_no: proposed.trailer_1_reg_no ?? null,
      trailer_2_reg_no: proposed.trailer_2_reg_no ?? null,
      tracking_provider: proposed.tracking_provider ?? null,
      tracking_username: proposed.tracking_username ?? null,
      tracking_password: proposed.tracking_password ?? null,
      commodity_type: proposed.commodity_type ?? null,
      capacity_tonnes: proposed.capacity_tonnes != null ? proposed.capacity_tonnes : null,
      status: proposed.status || 'active',
    }
  );
  const truck = upd.recordset?.[0];
  if (!truck) return { error: { status: 404, message: 'Truck not found' } };

  let requiresReenrollment = false;
  if (hadFacilityAccess) {
    await query(
      `UPDATE contractor_trucks SET facility_access = 0, last_decline_reason = NULL WHERE id = @entityId AND tenant_id = @tenantId`,
      { entityId, tenantId }
    );
    if (registrationChanged) {
      await removeTruckFromRouteEnrollments(entityId, tenantId);
      requiresReenrollment = true;
    }
    await query(
      `UPDATE cc_fleet_applications SET [status] = N'pending', reviewed_by_user_id = NULL, reviewed_at = NULL, decline_reason = NULL
       WHERE entity_type = N'truck' AND entity_id = @entityId AND tenant_id = @tenantId AND [status] = N'approved'`,
      { entityId, tenantId }
    );
    const pendingApp = await query(
      `SELECT id FROM cc_fleet_applications WHERE entity_type = N'truck' AND entity_id = @entityId AND tenant_id = @tenantId AND [status] = N'pending'`,
      { entityId, tenantId }
    );
    if (!pendingApp.recordset?.length) {
      await query(
        `INSERT INTO cc_fleet_applications (tenant_id, entity_type, entity_id, source, [status])
         VALUES (@tenantId, N'truck', @entityId, N'manual', N'pending')`,
        { tenantId, entityId }
      );
    }
  }

  await query(
    `UPDATE contractor_fleet_change_requests
     SET cc_status = N'approved', cc_reviewed_by_user_id = @userId, cc_reviewed_at = SYSUTCDATETIME()
     WHERE id = @id`,
    { id: changeRequestId, userId: ccUserId || null }
  );

  const refreshed = await query(`SELECT * FROM contractor_trucks WHERE id = @entityId`, { entityId });
  return {
    truck: refreshed.recordset?.[0] || truck,
    requiresReenrollment,
    facilityAccessReset: hadFacilityAccess,
  };
}

export function mapChangeRequestRow(r) {
  if (!r) return null;
  let proposed = null;
  let previous = null;
  try { proposed = JSON.parse(get(r, 'proposed_json') || '{}'); } catch (_) {}
  try { previous = JSON.parse(get(r, 'previous_json') || '{}'); } catch (_) {}
  return {
    id: get(r, 'id'),
    tenantId: get(r, 'tenant_id'),
    entityType: get(r, 'entity_type'),
    entityId: get(r, 'entity_id'),
    submitterRole: get(r, 'submitter_role'),
    commentText: get(r, 'comment_text'),
    proposed,
    previous,
    registrationChanged: !!get(r, 'registration_changed'),
    hadFacilityAccess: !!get(r, 'had_facility_access'),
    contractorStatus: get(r, 'contractor_status'),
    ccStatus: get(r, 'cc_status'),
    contractorDeclineReason: get(r, 'contractor_decline_reason'),
    ccDeclineReason: get(r, 'cc_decline_reason'),
    createdAt: get(r, 'created_at'),
  };
}

export function truckNeedsChangeApproval(existingRow, isSubcontractorUser) {
  if (!existingRow) return false;
  const cas = get(existingRow, 'contractor_approval_status');
  if (isSubcontractorUser && cas === 'pending_contractor') return false;
  if (get(existingRow, 'facility_access')) return true;
  if (cas === 'approved_contractor' || cas === 'declined_contractor') return true;
  return true;
}
