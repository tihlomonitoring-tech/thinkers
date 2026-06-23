/** Display label for a truck row's sub-contractor (matches fleet-truck-approval-summary SQL). */
export const SQL_SUBCONTRACTOR_DISPLAY = `COALESCE(sc.company_name, NULLIF(LTRIM(RTRIM(t.sub_contractor)), ''), N'(Direct / unassigned)')`;

/** GROUP BY key: one row per exact sub-contractor name (case-insensitive, trimmed). */
export const SQL_SUBCONTRACTOR_NAME_GROUP = `LOWER(LTRIM(RTRIM(${SQL_SUBCONTRACTOR_DISPLAY})))`;

export function normalizeSubcontractorDisplayName(name) {
  return String(name || '').trim().replace(/[\s\u00a0\t\r\n]+/g, ' ').toLowerCase();
}

/** Stable scope key per contractor + sub-contractor display name (merges id-linked and text-only rows). */
export function buildSubcontractorScopeKey(_subcontractorId, subcontractorDisplay = '') {
  const raw = String(subcontractorDisplay || '').trim();
  if (!raw || normalizeSubcontractorDisplayName(raw) === '(direct / unassigned)') return 'txt:';
  return `txt:${normalizeSubcontractorDisplayName(raw)}`;
}

export function scopeKeyForRow(row) {
  return `${row.tenantId}|${row.contractorId}|${buildSubcontractorScopeKey(row.subcontractorId, row.subcontractorDisplay)}`;
}

export function computeChecklistProgress(checklist) {
  if (!checklist) {
    return {
      completedSteps: 0,
      totalSteps: 5,
      percent: 0,
      isComplete: false,
      bottlenecks: ['Consent letter', 'Consent letter upload', 'Credentials', 'Credentials upload', 'Tracking provider engagement'],
    };
  }
  const bottlenecks = [];
  const consentUploads = Number(checklist.consentLetterUploadCount || 0);
  const credentialsUploads = Number(checklist.credentialsUploadCount || 0);
  let completed = 0;
  const total = 5;

  if (checklist.consentLetterChecked) completed += 1;
  else bottlenecks.push('Consent letter');

  if (consentUploads > 0) completed += 1;
  else bottlenecks.push('Consent letter upload');

  if (checklist.credentialsChecked) completed += 1;
  else bottlenecks.push('Credentials');

  if (credentialsUploads > 0) completed += 1;
  else bottlenecks.push('Credentials upload');

  if (checklist.trackingProviderChecked) completed += 1;
  else bottlenecks.push('Tracking provider engagement');

  return {
    completedSteps: completed,
    totalSteps: total,
    percent: Math.round((completed / total) * 100),
    isComplete: completed === total,
    bottlenecks,
  };
}

export function mapChecklistRow(r, getRow) {
  if (!r) return null;
  const checklist = {
    id: getRow(r, 'id'),
    tenantId: getRow(r, 'tenant_id'),
    contractorId: getRow(r, 'contractor_id'),
    subcontractorScopeKey: getRow(r, 'subcontractor_scope_key'),
    subcontractorId: getRow(r, 'subcontractor_id') || null,
    consentLetterChecked: Boolean(getRow(r, 'consent_letter_checked')),
    credentialsChecked: Boolean(getRow(r, 'credentials_checked')),
    trackingProviderChecked: Boolean(getRow(r, 'tracking_provider_checked')),
    updatedAt: getRow(r, 'updated_at'),
    updatedByName: getRow(r, 'updated_by_name') || null,
    consentLetterUploadCount: Number(getRow(r, 'consent_letter_upload_count') || 0),
    credentialsUploadCount: Number(getRow(r, 'credentials_upload_count') || 0),
    generalUploadCount: Number(getRow(r, 'general_upload_count') || 0),
    commentCount: Number(getRow(r, 'comment_count') || 0),
  };
  checklist.progress = computeChecklistProgress(checklist);
  return checklist;
}

function resolveChecklistDisplayName(mapped, getRow, rawRow) {
  const fromJoin = getRow(rawRow, 'subcontractor_company_name');
  if (fromJoin) return fromJoin;
  const scopeKey = mapped.subcontractorScopeKey || '';
  if (scopeKey.startsWith('txt:')) {
    const slug = scopeKey.slice(4).trim();
    return slug || '(Direct / unassigned)';
  }
  return '(Direct / unassigned)';
}

/** Index checklists by tenant + contractor + normalized sub-contractor name (merges legacy UUID scope keys). */
export function indexFleetFacilityChecklistsByDisplay(rows, getRow) {
  const byDisplayScope = {};
  for (const rawRow of rows || []) {
    const mapped = mapChecklistRow(rawRow, getRow);
    if (!mapped) continue;
    const display = resolveChecklistDisplayName(mapped, getRow, rawRow);
    const displayScopeKey = buildSubcontractorScopeKey(null, display);
    const key = `${mapped.tenantId}|${mapped.contractorId}|${displayScopeKey}`;
    const existing = byDisplayScope[key];
    const mappedWithKey = { ...mapped, subcontractorScopeKey: displayScopeKey };
    if (!existing || (mappedWithKey.progress?.completedSteps || 0) > (existing.progress?.completedSteps || 0)) {
      byDisplayScope[key] = mappedWithKey;
    }
  }
  return byDisplayScope;
}
