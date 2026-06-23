/** Shared shift report edit / submit rules (standard + single-ops). */

import { sameGuid } from './guidUtils.js';

export function shiftReportRowValue(row, key) {
  if (!row) return undefined;
  const lower = String(key).toLowerCase();
  for (const k of Object.keys(row)) {
    if (k && String(k).toLowerCase() === lower) return row[k];
  }
  return undefined;
}

export function isAssignedShiftReportApprover(report, user) {
  if (!report || !user) return false;
  if (user.role === 'super_admin') return true;
  return sameGuid(shiftReportRowValue(report, 'submitted_to_user_id'), user.id);
}

export function normShiftId(v) {
  return v != null ? String(v).toLowerCase().trim() : '';
}

export function normShiftEmail(v) {
  return v != null ? String(v).toLowerCase().trim() : '';
}

export function emailMatches(userEmail, reportEmail) {
  const u = normShiftEmail(userEmail);
  const r = normShiftEmail(reportEmail);
  return !!(u && r && u === r);
}

export function isShiftReportCreator(report, user) {
  if (!report || !user) return false;
  const creatorId = normShiftId(report.created_by_user_id);
  const userId = normShiftId(user.id);
  if (creatorId && userId && creatorId === userId) return true;
  return emailMatches(user.email, report.created_by_email || report.creator_email);
}

export function isShiftReportController1(report, user) {
  if (!report || !user) return false;
  return emailMatches(user.email, report.controller1_email);
}

export function isShiftReportCollaborator(report, user) {
  if (!report || !user) return false;
  return (
    emailMatches(user.email, report.controller2_email) ||
    emailMatches(user.email, report.controller3_email)
  );
}

/** Draft / provisional / rejected — creator, specialist 1, or collaborators 2 & 3. */
export function canEditShiftReport(report, user) {
  if (!report || !user) return false;
  if (user.role === 'super_admin') return true;
  return (
    isShiftReportCreator(report, user) ||
    isShiftReportController1(report, user) ||
    isShiftReportCollaborator(report, user)
  );
}

/** Draft or rejected only — report starter or telematics specialist 1. */
export function canSubmitShiftReport(report, user) {
  if (!report || !user) return false;
  if (user.role === 'super_admin') return true;
  return isShiftReportCreator(report, user) || isShiftReportController1(report, user);
}
