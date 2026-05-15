import { query } from '../db.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

/** Subcontractor directory rows linked to this user (empty = main contractor user). */
export async function getUserSubcontractorIds(userId) {
  if (!userId) return [];
  try {
    const result = await query(
      `SELECT subcontractor_id FROM user_subcontractors WHERE user_id = @userId`,
      { userId }
    );
    return [...new Set((result.recordset || []).map((r) => get(r, 'subcontractor_id')).filter(Boolean))];
  } catch (e) {
    if (e.message?.includes('Invalid object name')) return [];
    throw e;
  }
}

export async function getUserSubcontractorDetails(userId) {
  if (!userId) return [];
  try {
    const result = await query(
      `SELECT s.id, s.company_name, s.contractor_id
       FROM user_subcontractors us
       INNER JOIN contractor_subcontractors s ON s.id = us.subcontractor_id
       WHERE us.user_id = @userId
       ORDER BY s.company_name`,
      { userId }
    );
    return (result.recordset || []).map((r) => ({
      id: get(r, 'id'),
      companyName: get(r, 'company_name'),
      contractorId: get(r, 'contractor_id'),
    }));
  } catch (e) {
    if (e.message?.includes('Invalid object name')) return [];
    throw e;
  }
}

export async function getSubcontractorScopeForUser(userId) {
  const ids = await getUserSubcontractorIds(userId);
  if (!ids.length) return { ids: [], names: [] };
  const details = await getUserSubcontractorDetails(userId);
  const names = [...new Set(details.map((d) => (d.companyName || '').trim()).filter(Boolean))];
  return { ids, names };
}

export function isSubcontractorPortalUser(subcontractorIds) {
  return Array.isArray(subcontractorIds) && subcontractorIds.length > 0;
}

/** Responds 403 when the user is a subcontractor-portal account. Returns true if blocked. */
export async function rejectSubcontractorPortalUser(req, res) {
  const ids = await getUserSubcontractorIds(req.user?.id);
  if (isSubcontractorPortalUser(ids)) {
    res.status(403).json({ error: 'Only main contractor users can access this.' });
    return true;
  }
  return false;
}

function buildNameInClause(names, prefix) {
  const params = {};
  const ph = names.map((_, i) => `@${prefix}n${i}`).join(',');
  names.forEach((n, i) => { params[`${prefix}n${i}`] = n; });
  return { ph, params };
}

/** SQL fragment + params for truck list scope (FK or legacy sub_contractor text). */
export function buildTruckScopeClause(scope, { fleetTabForMainContractor = false, alias = 't' } = {}) {
  const ids = scope?.ids || [];
  const names = scope?.names || [];
  const a = alias;
  if (isSubcontractorPortalUser(ids)) {
    const parts = [];
    const params = {};
    if (ids.length) {
      const ph = ids.map((_, i) => `@sub${i}`).join(',');
      ids.forEach((id, i) => { params[`sub${i}`] = id; });
      parts.push(`${a}.subcontractor_id IN (${ph})`);
    }
    if (names.length) {
      const { ph, params: np } = buildNameInClause(names, 'sub');
      Object.assign(params, np);
      parts.push(`(LTRIM(RTRIM(${a}.sub_contractor)) IN (${ph}))`);
    }
    if (parts.length === 0) return { clause: ' AND 1=0', params: {} };
    return { clause: ` AND (${parts.join(' OR ')})`, params };
  }
  if (fleetTabForMainContractor) {
    return {
      clause: ` AND (${a}.contractor_approval_status IS NULL OR ${a}.contractor_approval_status = N'approved_contractor')`,
      params: {},
    };
  }
  return { clause: '', params: {} };
}

/** Drivers: own subcontractor_id, linked truck match, or legacy sub_contractor on truck. */
export function buildDriverSubcontractorClause(scope, { driverAlias = 'd', truckAlias = 't' } = {}) {
  const ids = scope?.ids || [];
  const names = scope?.names || [];
  if (!isSubcontractorPortalUser(ids)) return { clause: '', params: {} };

  const parts = [];
  const params = {};
  if (ids.length) {
    const ph = ids.map((_, i) => `@dsub${i}`).join(',');
    ids.forEach((id, i) => { params[`dsub${i}`] = id; });
    parts.push(`${driverAlias}.subcontractor_id IN (${ph})`);
    parts.push(`${truckAlias}.subcontractor_id IN (${ph})`);
  }
  if (names.length) {
    const { ph, params: np } = buildNameInClause(names, 'ds');
    Object.assign(params, np);
    parts.push(`LTRIM(RTRIM(${truckAlias}.sub_contractor)) IN (${ph})`);
  }
  if (parts.length === 0) return { clause: ' AND 1=0', params: {} };
  return { clause: ` AND (${parts.join(' OR ')})`, params };
}

export function buildDriverMainContractorClause(driverAlias = 'd') {
  return {
    clause: ` AND (${driverAlias}.contractor_approval_status IS NULL OR ${driverAlias}.contractor_approval_status = N'approved_contractor')`,
    params: {},
  };
}

export function mapTruckRow(r, getRow = get) {
  return {
    id: getRow(r, 'id'),
    tenantId: getRow(r, 'tenant_id'),
    contractorId: getRow(r, 'contractor_id'),
    registration: getRow(r, 'registration'),
    makeModel: getRow(r, 'make_model'),
    mainContractor: getRow(r, 'main_contractor'),
    subContractor: getRow(r, 'sub_contractor'),
    subcontractorId: getRow(r, 'subcontractor_id'),
    subcontractorCompanyName: getRow(r, 'subcontractor_company_name'),
    yearModel: getRow(r, 'year_model'),
    ownershipDesc: getRow(r, 'ownership_desc'),
    fleetNo: getRow(r, 'fleet_no'),
    trailer1RegNo: getRow(r, 'trailer_1_reg_no'),
    trailer2RegNo: getRow(r, 'trailer_2_reg_no'),
    trackingProvider: getRow(r, 'tracking_provider'),
    commodityType: getRow(r, 'commodity_type'),
    capacityTonnes: getRow(r, 'capacity_tonnes'),
    status: getRow(r, 'status'),
    facilityAccess: getRow(r, 'facility_access'),
    lastDeclineReason: getRow(r, 'last_decline_reason'),
    contractorApprovalStatus: getRow(r, 'contractor_approval_status'),
    contractorReviewedAt: getRow(r, 'contractor_reviewed_at'),
    contractorDeclineReason: getRow(r, 'contractor_decline_reason'),
    createdAt: getRow(r, 'created_at'),
    updatedAt: getRow(r, 'updated_at'),
    contractorCompanyName: getRow(r, 'contractor_company_name'),
    addedByUserId: getRow(r, 'added_by_user_id'),
    addedByName: getRow(r, 'added_by_name'),
  };
}
