/**
 * Audit trail for cc_fleet_applications (review history).
 */

function getRow(r, key) {
  if (!r) return undefined;
  const lower = String(key).toLowerCase();
  const entry = Object.entries(r).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

const ACTION_LABELS = {
  submitted: 'Application submitted',
  approved: 'Approved',
  declined: 'Declined',
  comment_added: 'Comment added',
  returned_to_pending: 'Returned to pending review',
  resubmitted: 'Resubmitted for review',
  approval_revoked: 'Approval revoked',
};

export function actionLabel(action) {
  return ACTION_LABELS[action] || String(action || 'Activity').replace(/_/g, ' ');
}

/**
 * @param {Function} queryFn
 * @param {{ applicationId: string, action: string, userId?: string|null, details?: string|null, fromStatus?: string|null, toStatus?: string|null }} opts
 */
export async function logFleetApplicationHistory(queryFn, opts) {
  const applicationId = opts.applicationId;
  const action = String(opts.action || '').trim();
  if (!applicationId || !action) return null;
  try {
    const result = await queryFn(
      `INSERT INTO cc_fleet_application_history (fleet_application_id, [action], from_status, to_status, details, performed_by_user_id)
       OUTPUT INSERTED.id, INSERTED.performed_at
       VALUES (@applicationId, @action, @fromStatus, @toStatus, @details, @userId)`,
      {
        applicationId,
        action,
        fromStatus: opts.fromStatus || null,
        toStatus: opts.toStatus || null,
        details: opts.details || null,
        userId: opts.userId || null,
      }
    );
    return result.recordset?.[0] || null;
  } catch (e) {
    if (e.message?.includes('cc_fleet_application_history')) {
      console.warn('[fleetApplicationHistory] Table missing — run npm run db:fleet-application-history');
      return null;
    }
    throw e;
  }
}

function mapHistoryRow(r) {
  return {
    id: getRow(r, 'id'),
    fleet_application_id: getRow(r, 'fleet_application_id'),
    action: getRow(r, 'action'),
    from_status: getRow(r, 'from_status'),
    to_status: getRow(r, 'to_status'),
    details: getRow(r, 'details'),
    performed_by_user_id: getRow(r, 'performed_by_user_id'),
    performed_at: getRow(r, 'performed_at'),
    performed_by_name: getRow(r, 'performed_by_name') || null,
    action_label: actionLabel(getRow(r, 'action')),
  };
}

/** Build timeline entries from legacy application fields when history table is empty. */
export function syntheticHistoryFromApplication(app, reviewerUserName = null) {
  const events = [];
  const createdAt = app.created_at || app.createdAt;
  if (createdAt) {
    events.push({
      id: `synthetic-submitted`,
      action: 'submitted',
      action_label: actionLabel('submitted'),
      from_status: null,
      to_status: 'pending',
      details: `Source: ${(app.source || 'manual') === 'import' ? 'Import' : 'Manual'}`,
      performed_by_user_id: null,
      performed_by_name: 'Contractor portal',
      performed_at: createdAt,
      synthetic: true,
    });
  }
  const status = app.status || app.Status;
  const reviewedAt = app.reviewed_at || app.reviewedAt;
  if (reviewedAt && (status === 'approved' || status === 'declined')) {
    events.push({
      id: `synthetic-review`,
      action: status,
      action_label: actionLabel(status),
      from_status: 'pending',
      to_status: status,
      details: status === 'declined' ? app.decline_reason || app.declineReason || null : 'Facility access granted',
      performed_by_user_id: app.reviewed_by_user_id || app.reviewedByUserId,
      performed_by_name: reviewerUserName || 'Command Centre',
      performed_at: reviewedAt,
      synthetic: true,
    });
  }
  return events;
}

/**
 * @param {Function} queryFn
 * @param {string} applicationId
 */
export async function getFleetApplicationHistory(queryFn, applicationId) {
  let rows = [];
  try {
    const result = await queryFn(
      `SELECT h.id, h.fleet_application_id, h.[action], h.from_status, h.to_status, h.details,
        h.performed_by_user_id, h.performed_at, u.full_name AS performed_by_name
       FROM cc_fleet_application_history h
       LEFT JOIN users u ON u.id = h.performed_by_user_id
       WHERE h.fleet_application_id = @applicationId
       ORDER BY h.performed_at ASC`,
      { applicationId }
    );
    rows = (result.recordset || []).map(mapHistoryRow);
  } catch (e) {
    if (!e.message?.includes('cc_fleet_application_history')) throw e;
  }

  if (rows.length === 0) {
    const appRes = await queryFn(
      `SELECT a.id, a.source, a.[status], a.reviewed_by_user_id, a.reviewed_at, a.decline_reason, a.created_at,
        u.full_name AS reviewer_name
       FROM cc_fleet_applications a
       LEFT JOIN users u ON u.id = a.reviewed_by_user_id
       WHERE a.id = @applicationId`,
      { applicationId }
    );
    const app = appRes.recordset?.[0];
    if (app) {
      rows = syntheticHistoryFromApplication(
        {
          source: getRow(app, 'source'),
          status: getRow(app, 'status'),
          reviewed_at: getRow(app, 'reviewed_at'),
          reviewed_by_user_id: getRow(app, 'reviewed_by_user_id'),
          decline_reason: getRow(app, 'decline_reason'),
          created_at: getRow(app, 'created_at'),
        },
        getRow(app, 'reviewer_name')
      );
    }
  }

  return rows;
}
