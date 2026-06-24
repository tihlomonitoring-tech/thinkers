const KEY_PREFIX = 'cc-shift-report-draft';

function draftKey(userId, reportKind, reportId) {
  const uid = userId != null ? String(userId) : 'anon';
  const kind = reportKind === 'single_ops' ? 'single_ops' : 'shift';
  const rid = reportId != null ? String(reportId) : 'new';
  return `${KEY_PREFIX}:${uid}:${kind}:${rid}`;
}

export function loadShiftReportLocalDraft(userId, reportKind, reportId) {
  try {
    const raw = localStorage.getItem(draftKey(userId, reportKind, reportId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.snapshot) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveShiftReportLocalDraft(userId, reportKind, reportId, snapshot) {
  try {
    const entry = {
      savedAt: new Date().toISOString(),
      reportKind: reportKind === 'single_ops' ? 'single_ops' : 'shift',
      reportId: reportId != null ? String(reportId) : null,
      snapshot,
    };
    localStorage.setItem(draftKey(userId, reportKind, reportId), JSON.stringify(entry));
    return entry.savedAt;
  } catch {
    return null;
  }
}

export function clearShiftReportLocalDraft(userId, reportKind, reportId) {
  try {
    localStorage.removeItem(draftKey(userId, reportKind, reportId));
  } catch {
    /* ignore */
  }
}

/** True when local draft is meaningfully newer than server row (if any). */
export function isLocalDraftNewer(localDraft, serverUpdatedAt) {
  if (!localDraft?.savedAt) return false;
  const localMs = Date.parse(localDraft.savedAt);
  if (Number.isNaN(localMs)) return false;
  if (!serverUpdatedAt) return true;
  const serverMs = Date.parse(String(serverUpdatedAt));
  if (Number.isNaN(serverMs)) return true;
  return localMs > serverMs + 2000;
}

export function isSessionAuthError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('unauthorized')
    || msg.includes('sign in')
    || msg.includes('session invalid')
    || msg.includes('session expired')
    || msg.includes('no page access')
    || msg.includes('forbidden')
  );
}
