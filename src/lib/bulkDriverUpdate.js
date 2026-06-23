import { queryWithGuids } from './queryWithGuids.js';
import { parseGuid } from './guidUtils.js';
import { isGuidSqlParam } from './sqlGuidParams.js';
import {
  buildDriverSubcontractorClause,
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

export const BULK_DRIVER_UPDATE_FIELDS = [
  'full_name',
  'surname',
  'id_number',
  'license_number',
  'license_expiry',
  'phone',
  'email',
  'linked_truck_id',
];

function buildPatchBody(updates, fields) {
  const body = {};
  for (const key of fields || []) {
    if (!BULK_DRIVER_UPDATE_FIELDS.includes(key)) continue;
    if (updates[key] !== undefined) body[key] = updates[key];
  }
  return body;
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

function normalizeLinkedTruckId(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === '__CLEAR__') return null;
  return parseGuid(value);
}

function driverLabel(row) {
  const fn = get(row, 'full_name') || '';
  const sn = get(row, 'surname') || '';
  return [fn, sn].filter(Boolean).join(' ').trim() || 'Driver';
}

/**
 * Apply a partial driver update. Mirrors PATCH /contractor/drivers/:id with field-level control.
 */
export async function applyDriverBulkPatch({
  tenantId,
  driverId,
  updates,
  fields,
  isSubUser,
  subScopeCtx,
  driverDuplicateExists,
  getContractorName,
  notifyFleetDriverEmails,
  tenantName,
  userEmail,
}) {
  const normalizedDriverId = parseGuid(driverId);
  const normalizedTenantId = parseGuid(tenantId);
  if (!normalizedDriverId || !normalizedTenantId) {
    return { id: driverId, status: 'error', error: 'Invalid driver or tenant id' };
  }

  const body = buildPatchBody(updates, fields);
  if (body.linked_truck_id !== undefined) {
    const rawLink = updates?.linked_truck_id;
    body.linked_truck_id = normalizeLinkedTruckId(rawLink);
    if (rawLink != null && rawLink !== '' && rawLink !== '__CLEAR__' && !body.linked_truck_id) {
      return { id: driverId, status: 'error', error: 'Invalid linked truck id' };
    }
  }

  if (!Object.keys(body).length) {
    return { id: driverId, status: 'skipped', reason: 'No applicable fields' };
  }

  const existingResult = await queryWithGuids(
    `SELECT d.* FROM contractor_drivers d WHERE d.id = @id AND d.tenant_id = @tenantId`,
    { id: normalizedDriverId, tenantId: normalizedTenantId }
  );
  const existingRow = existingResult.recordset?.[0];
  if (!existingRow) return { id: driverId, status: 'error', error: 'Driver not found' };

  if (isSubUser) {
    const scope = buildDriverSubcontractorClause(subScopeCtx, { driverAlias: 'd', truckAlias: 't' });
    const scopeCheck = await queryWithGuids(
      `SELECT 1 AS ok FROM contractor_drivers d
       LEFT JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
       WHERE d.id = @id AND d.tenant_id = @tenantId${scope.clause}`,
      { id: normalizedDriverId, tenantId: normalizedTenantId, ...normalizeScopeParams(scope.params) }
    );
    if (!scopeCheck.recordset?.length) {
      return { id: driverId, status: 'error', error: 'Not permitted for this driver', label: driverLabel(existingRow) };
    }
  }

  const nextIdNumber = body.id_number !== undefined ? body.id_number : get(existingRow, 'id_number');
  const nextLicense = body.license_number !== undefined ? body.license_number : get(existingRow, 'license_number');
  if (driverDuplicateExists && await driverDuplicateExists(normalizedTenantId, nextIdNumber, nextLicense, normalizedDriverId)) {
    return {
      id: driverId,
      status: 'error',
      error: 'Duplicate ID or licence number',
      label: driverLabel(existingRow),
    };
  }

  if (body.linked_truck_id !== undefined && body.linked_truck_id !== null) {
    const truckCheck = await queryWithGuids(
      `SELECT 1 FROM contractor_trucks WHERE id = @truckId AND tenant_id = @tenantId`,
      { truckId: body.linked_truck_id, tenantId: normalizedTenantId }
    );
    if (!truckCheck.recordset?.length) {
      return { id: driverId, status: 'error', error: 'Linked truck not found', label: driverLabel(existingRow) };
    }
  }

  const setParts = [];
  const params = { id: normalizedDriverId, tenantId: normalizedTenantId };

  if (body.full_name !== undefined) {
    const surname = body.surname !== undefined ? body.surname : get(existingRow, 'surname');
    const firstName = String(body.full_name ?? '').trim();
    const lastName = surname != null ? String(surname).trim() : '';
    const combined = [firstName, lastName].filter(Boolean).join(' ') || firstName || get(existingRow, 'full_name');
    setParts.push('full_name = @full_name');
    params.full_name = combined;
  }

  if (body.surname !== undefined) {
    setParts.push('surname = @surname');
    params.surname = body.surname ?? null;
  }

  if (body.id_number !== undefined) {
    setParts.push('id_number = @id_number');
    params.id_number = body.id_number ?? null;
  }
  if (body.license_number !== undefined) {
    setParts.push('license_number = @license_number');
    params.license_number = body.license_number ?? null;
  }
  if (body.license_expiry !== undefined) {
    setParts.push('license_expiry = @license_expiry');
    params.license_expiry = body.license_expiry || null;
  }
  if (body.phone !== undefined) {
    setParts.push('phone = @phone');
    params.phone = body.phone ?? null;
  }
  if (body.email !== undefined) {
    setParts.push('email = @email');
    params.email = body.email ?? null;
  }
  if (body.linked_truck_id !== undefined) {
    setParts.push('linked_truck_id = @linked_truck_id');
    params.linked_truck_id = body.linked_truck_id === '' || body.linked_truck_id === null ? null : body.linked_truck_id;
  }

  if (!setParts.length) {
    return { id: driverId, status: 'skipped', reason: 'No applicable fields', label: driverLabel(existingRow) };
  }

  const result = await queryWithGuids(
    `UPDATE contractor_drivers SET ${setParts.join(', ')}
     OUTPUT INSERTED.* WHERE id = @id AND tenant_id = @tenantId`,
    params
  );

  if (!result.recordset?.length) {
    return { id: driverId, status: 'error', error: 'Update failed', label: driverLabel(existingRow) };
  }

  const driver = result.recordset[0];
  const label = driverLabel(driver);

  if (notifyFleetDriverEmails && getContractorName) {
    const contractorName = await getContractorName(driver.contractor_id);
    notifyFleetDriverEmails(tenantName || null, contractorName || null, 'driver', [label], userEmail, 'edited');
  }

  return { id: normalizedDriverId, status: 'updated', label, driver };
}

export async function bulkUpdateContractorDrivers({
  req,
  ids,
  updates,
  fields,
  driverDuplicateExists,
  getContractorName,
  notifyFleetDriverEmails,
}) {
  const tenantId = parseGuid(req.user?.tenant_id) ?? req.user?.tenant_id;
  if (!tenantId) {
    const err = new Error('Tenant required for bulk update');
    err.status = 403;
    throw err;
  }
  const uniqueIds = [...new Set(
    (ids || []).map((id) => parseGuid(id)).filter(Boolean)
  )];
  if (!uniqueIds.length) {
    const err = new Error('At least one driver id is required');
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

  const results = [];
  for (const id of uniqueIds) {
    try {
      const r = await applyDriverBulkPatch({
      tenantId,
      driverId: id,
      updates: updates || {},
      fields,
      isSubUser,
      subScopeCtx,
      driverDuplicateExists,
      getContractorName,
      notifyFleetDriverEmails,
      tenantName: req.user.tenant_name,
      userEmail: req.user?.email,
    });
    results.push(r);
    } catch (e) {
      const msg = e?.message || String(e);
      results.push({
        id,
        status: 'error',
        error: msg.includes('uniqueidentifier') || msg.includes('Conversion failed')
          ? 'Invalid id format'
          : msg,
      });
    }
  }

  const summary = {
    total: uniqueIds.length,
    updated: results.filter((r) => r.status === 'updated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };

  if (summary.errors > 0 && summary.updated === 0) {
    const err = new Error(results.find((r) => r.error)?.error || 'Bulk update failed');
    err.status = 400;
    err.summary = summary;
    throw err;
  }

  return summary;
}
