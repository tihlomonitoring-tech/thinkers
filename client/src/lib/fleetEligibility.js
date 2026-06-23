/** SQL bit / API JSON may expose facility_access as true, 1, or "1". */
export function hasFacilityAccess(entity) {
  const v = entity?.facility_access ?? entity?.facilityAccess;
  return v === true || v === 1 || v === '1';
}

export function contractorApprovalStatus(entity) {
  const raw = entity?.contractor_approval_status ?? entity?.contractorApprovalStatus;
  if (raw == null || raw === '') return 'approved_contractor';
  return String(raw);
}

/** Matches server TRUCK_APPROVED_SQL / DRIVER_APPROVED_SQL (distribution & approved picklists). */
export function isFleetDistributionEligible(entity) {
  if (!hasFacilityAccess(entity)) return false;
  const cas = contractorApprovalStatus(entity);
  return cas === 'approved_contractor' || cas === 'not_required';
}

export function sameEntityId(a, b) {
  if (a == null || b == null) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}
