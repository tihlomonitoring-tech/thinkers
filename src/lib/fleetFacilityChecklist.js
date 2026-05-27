/** Stable scope key for contractor + sub-contractor grouping (matches fleet-truck-approval-summary SQL). */
export function buildSubcontractorScopeKey(subcontractorId, subcontractorDisplay = '') {
  if (subcontractorId) return String(subcontractorId).toLowerCase();
  const raw = String(subcontractorDisplay || '').trim();
  if (!raw || raw.toLowerCase() === '(direct / unassigned)') return 'txt:';
  return `txt:${raw.toLowerCase()}`;
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
