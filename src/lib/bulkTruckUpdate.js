import { query } from '../db.js';
import { queryWithGuids } from './queryWithGuids.js';
import { parseGuid, mapRowGuids } from './guidUtils.js';
import { isGuidSqlParam } from './sqlGuidParams.js';
import { normTruckRegistration, sqlRegNormExpr } from './truckRegistration.js';
import {
  getActiveChangeRequest,
  mapChangeRequestRow,
  submitTruckChangeRequest,
  truckNeedsChangeApproval,
} from './fleetChangeRequests.js';
import {
  buildTruckScopeClause,
  getSubcontractorScopeForUser,
  getUserSubcontractorIds,
  isSubcontractorPortalUser,
} from './subcontractorFleet.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function normalizeScopeParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const k = key.toLowerCase();
    if (isGuidSqlParam(k)) {
      const g = parseGuid(value);
      if (g) out[key] = g;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const BULK_TRUCK_UPDATE_FIELDS = [
  'main_contractor',
  'sub_contractor',
  'make_model',
  'tracking_provider',
  'tracking_username',
  'tracking_password',
  'camera_username',
  'camera_password',
  'camera_provider',
];

function buildPatchBody(updates, fields) {
  const body = {};
  for (const key of fields || []) {
    if (!BULK_TRUCK_UPDATE_FIELDS.includes(key)) continue;
    if (updates[key] !== undefined) body[key] = updates[key];
  }
  return body;
}

/**
 * Resolve a truck row by registration or id within tenant (+ optional contractor scope).
 */
export async function findContractorTruckForUpdate({
  tenantId,
  registration,
  truckId,
  allowedContractorIds,
  isSubUser,
  subScopeCtx,
}) {
  const normalizedTenantId = parseGuid(tenantId);
  if (!normalizedTenantId) return null;

  let sql = `SELECT TOP 1 t.* FROM contractor_trucks t WHERE t.tenant_id = @tenantId`;
  const params = { tenantId: normalizedTenantId };

  const normalizedId = truckId ? parseGuid(truckId) : null;
  const regNorm = registration ? normTruckRegistration(registration) : null;

  if (normalizedId) {
    sql += ' AND t.id = @id';
    params.id = normalizedId;
  } else if (regNorm) {
    sql += ` AND ${sqlRegNormExpr('t.registration')} = @regNorm`;
    params.regNorm = regNorm;
  } else {
    return null;
  }

  if (allowedContractorIds && allowedContractorIds.length > 0) {
    const ph = allowedContractorIds.map((_, i) => `@c${i}`).join(',');
    sql += ` AND t.contractor_id IN (${ph})`;
    allowedContractorIds.forEach((id, i) => {
      params[`c${i}`] = parseGuid(id) ?? id;
    });
  }

  if (isSubUser) {
    const scope = buildTruckScopeClause(subScopeCtx, { alias: 't' });
    sql += scope.clause;
    Object.assign(params, scope.params);
  }

  const result = await queryWithGuids(sql, params);
  return result.recordset?.[0] || null;
}

/**
 * Apply a partial truck update (bulk-safe fields only).
 */
export async function applyTruckBulkPatch({
  tenantId,
  existingRow,
  updates,
  fields,
  userId,
  isSubUser,
  changeComment,
  getContractorName,
  notifyFleetDriverEmails,
  tenantName,
  userEmail,
}) {
  const normalizedTenantId = parseGuid(tenantId);
  const truckId = parseGuid(get(existingRow, 'id'));
  const registration = get(existingRow, 'registration');

  if (!normalizedTenantId || !truckId) {
    return {
      registration,
      status: 'error',
      error: 'Invalid truck record',
    };
  }

  const body = buildPatchBody(updates, fields);
  if (!Object.keys(body).length) {
    return { registration, status: 'skipped', reason: 'No applicable fields' };
  }

  const commentText = changeComment ?? null;

  if (truckNeedsChangeApproval(existingRow, isSubUser)) {
    try {
      const submitted = await submitTruckChangeRequest({
        tenantId: normalizedTenantId,
        truckId,
        existingRow,
        body,
        userId,
        isSubcontractorUser: isSubUser,
        commentText,
      });
      if (submitted.skipped) {
        return { registration, status: 'skipped', reason: 'No changes' };
      }
      const active = await getActiveChangeRequest('truck', truckId);
      return {
        registration,
        id: truckId,
        status: 'pending_change',
        changeRequest: mapChangeRequestRow(active),
      };
    } catch (e) {
      if (e.message?.includes('Invalid object name')) {
        return { registration, status: 'error', error: 'Change approval is not set up' };
      }
      throw e;
    }
  }

  const setParts = ['updated_at = SYSUTCDATETIME()'];
  const params = { id: truckId, tenantId: normalizedTenantId };

  if (body.main_contractor !== undefined) {
    setParts.push('main_contractor = @main_contractor');
    params.main_contractor = body.main_contractor ?? null;
  }
  if (body.sub_contractor !== undefined) {
    setParts.push('sub_contractor = @sub_contractor');
    params.sub_contractor = body.sub_contractor ?? null;
  }
  if (body.make_model !== undefined) {
    setParts.push('make_model = @make_model');
    params.make_model = body.make_model ?? null;
  }
  if (body.tracking_provider !== undefined) {
    setParts.push('tracking_provider = @tracking_provider');
    params.tracking_provider = body.tracking_provider ?? null;
  }
  if (body.tracking_username !== undefined) {
    setParts.push('tracking_username = @tracking_username');
    params.tracking_username = body.tracking_username ?? null;
  }
  if (body.tracking_password !== undefined && body.tracking_password !== '') {
    setParts.push('tracking_password = @tracking_password');
    params.tracking_password = body.tracking_password;
  }
  if (body.camera_username !== undefined) {
    setParts.push('camera_username = @camera_username');
    params.camera_username = body.camera_username ?? null;
  }
  if (body.camera_provider !== undefined) {
    setParts.push('camera_provider = @camera_provider');
    params.camera_provider = body.camera_provider ?? null;
  }
  if (body.camera_password !== undefined && body.camera_password !== '') {
    setParts.push('camera_password = @camera_password');
    params.camera_password = body.camera_password;
  }

  const result = await queryWithGuids(
    `UPDATE contractor_trucks SET ${setParts.join(', ')}
     OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
    params
  );

  if (!result.recordset?.length) {
    return { registration, status: 'error', error: 'Update failed' };
  }

  const truckRow = mapRowGuids(result.recordset[0]);
  if (notifyFleetDriverEmails && getContractorName) {
    const contractorName = await getContractorName(truckRow.contractor_id);
    notifyFleetDriverEmails(
      tenantName || null,
      contractorName || null,
      'truck',
      [truckRow.registration].filter(Boolean),
      userEmail,
      'edited'
    );
  }

  return {
    registration: truckRow.registration,
    id: truckId,
    status: 'updated',
    truck: truckRow,
  };
}

function uniqueRegistrations(regs) {
  const seen = new Set();
  const out = [];
  for (const r of regs || []) {
    const k = normTruckRegistration(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(r).trim());
  }
  return out;
}

export async function bulkUpdateContractorTrucks({
  req,
  ids,
  registrations,
  updates,
  fields,
  changeComment,
  allowedContractorIds,
  getContractorName,
  notifyFleetDriverEmails,
}) {
  const tenantId = parseGuid(req.user?.tenant_id) ?? req.user?.tenant_id;
  if (!tenantId) {
    const err = new Error('Tenant required for bulk update');
    err.status = 403;
    throw err;
  }

  const regList = uniqueRegistrations(registrations);
  const idList = [...new Set((ids || []).map((id) => parseGuid(id)).filter(Boolean))];

  if (!regList.length && !idList.length) {
    const err = new Error('Select at least one truck (by registration)');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(fields) || !fields.length) {
    const err = new Error('Select at least one field to update');
    err.status = 400;
    throw err;
  }

  const subIds = await getUserSubcontractorIds(req.user?.id);
  const isSubUser = isSubcontractorPortalUser(subIds);
  const subScopeCtx = await getSubcontractorScopeForUser(req.user?.id);

  const targets = [];
  for (const reg of regList) {
    targets.push({ registration: reg });
  }
  for (const id of idList) {
    if (!targets.some((t) => t.truckId === id)) {
      targets.push({ truckId: id });
    }
  }

  const results = [];
  for (const target of targets) {
    const label = target.registration || target.truckId;
    try {
      const existingRow = await findContractorTruckForUpdate({
        tenantId,
        registration: target.registration,
        truckId: target.truckId,
        allowedContractorIds,
        isSubUser,
        subScopeCtx,
      });

      if (!existingRow) {
        results.push({
          registration: target.registration || null,
          id: target.truckId || null,
          label,
          status: 'error',
          error: 'Truck not found',
        });
        continue;
      }

      const r = await applyTruckBulkPatch({
        tenantId,
        existingRow,
        updates: updates || {},
        fields,
        userId: parseGuid(req.user?.id),
        isSubUser,
        changeComment,
        getContractorName,
        notifyFleetDriverEmails,
        tenantName: req.user.tenant_name,
        userEmail: req.user?.email,
      });
      results.push({ ...r, label: r.registration || label });
    } catch (e) {
      const msg = e?.message || String(e);
      results.push({
        registration: target.registration || null,
        id: target.truckId || null,
        label,
        status: 'error',
        error: msg.includes('uniqueidentifier') || msg.includes('Conversion failed')
          ? 'Database id error — refresh and try again'
          : msg,
      });
    }
  }

  const summary = {
    total: targets.length,
    updated: results.filter((r) => r.status === 'updated').length,
    pending_change: results.filter((r) => r.status === 'pending_change').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };

  return summary;
}
