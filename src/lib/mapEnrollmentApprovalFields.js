/** Normalize facility approval date/approver on enrollment API rows. */

function pickRow(row, ...keys) {
  if (!row) return undefined;
  for (const key of keys) {
    const hit = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === key.toLowerCase());
    if (hit && hit[1] != null && hit[1] !== '') return hit[1];
  }
  return undefined;
}

function toIsoDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function mapEnrollmentApprovalFields(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const at = pickRow(row, 'facility_approved_at', 'facilityApprovedAt', 'reviewed_at', 'reviewedAt');
  const by = pickRow(row, 'facility_approved_by_name', 'facilityApprovedByName', 'reviewer_name', 'reviewerName');
  const iso = toIsoDateTime(at);
  const name = by != null ? String(by) : null;
  return {
    ...row,
    facility_approved_at: iso,
    facilityApprovedAt: iso,
    facility_approved_by_name: name,
    facilityApprovedByName: name,
  };
}

export function mapEnrollmentApprovalFieldsList(rows) {
  return (rows || []).map(mapEnrollmentApprovalFields);
}
