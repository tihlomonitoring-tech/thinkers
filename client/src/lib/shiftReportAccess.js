/** Client-side shift report edit / submit rules (mirrors src/lib/shiftReportAccess.js). */

function normId(v) {
  return v != null ? String(v).toLowerCase().trim() : '';
}

function normEmail(v) {
  return v != null ? String(v).toLowerCase().trim() : '';
}

function emailMatches(userEmail, reportEmail) {
  const u = normEmail(userEmail);
  const r = normEmail(reportEmail);
  return !!(u && r && u === r);
}

export function isShiftReportCreator(report, user) {
  if (!report || !user) return false;
  const creatorId = normId(report.created_by_user_id);
  const userId = normId(user.id);
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

export function canEditShiftReport(report, user) {
  if (!report || !user) return false;
  if (user.role === 'super_admin') return true;
  return (
    isShiftReportCreator(report, user) ||
    isShiftReportController1(report, user) ||
    isShiftReportCollaborator(report, user)
  );
}

export function canSubmitShiftReport(report, user) {
  if (!report || !user) return false;
  if (user.role === 'super_admin') return true;
  return isShiftReportCreator(report, user) || isShiftReportController1(report, user);
}

export function getShiftReportAccess(report, user) {
  return {
    isCreator: isShiftReportCreator(report, user),
    isController1: isShiftReportController1(report, user),
    isCollaborator: isShiftReportCollaborator(report, user),
    canEdit: canEditShiftReport(report, user),
    canSubmit: canSubmitShiftReport(report, user),
  };
}
