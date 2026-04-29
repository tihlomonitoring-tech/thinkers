import { query } from '../db.js';

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function canAccessTenant(req, tenantId) {
  if (req.user?.role === 'super_admin') return true;
  if (!tenantId) return false;
  if (String(req.user?.tenant_id || '') === String(tenantId)) return true;
  if (Array.isArray(req.user?.tenant_ids)) return req.user.tenant_ids.some((t) => String(t) === String(tenantId));
  return false;
}

function canAccessTaskTenant(req, tenantId) {
  if (req.user?.role === 'super_admin') return true;
  const tid = req.user?.tenant_id;
  if (!tid) return false;
  if (Array.isArray(req.user?.tenant_ids)) return req.user.tenant_ids.includes(tenantId);
  return tid === tenantId;
}

export async function userInvolvedInCase(userId, caseId) {
  if (!userId || !caseId) return false;
  const r = await query(
    `SELECT 1 AS ok FROM case_management_cases c
     WHERE c.id = @caseId AND (c.lead_user_id = @userId OR c.opened_by_user_id = @userId)
     UNION ALL
     SELECT 1 FROM case_management_stages s
     WHERE s.case_id = @caseId AND s.assigned_user_id = @userId`,
    { caseId, userId }
  );
  return (r.recordset || []).length > 0;
}

export async function userInvolvedInTask(userId, taskId) {
  if (!userId || !taskId) return false;
  const r = await query(
    `SELECT 1 AS ok FROM tasks t
     WHERE t.id = @taskId
       AND (t.created_by = @userId OR t.task_leader_id = @userId OR t.task_reviewer_id = @userId)
     UNION ALL
     SELECT 1 FROM task_assignments a
     WHERE a.task_id = @taskId AND a.user_id = @userId`,
    { taskId, userId }
  );
  return (r.recordset || []).length > 0;
}

/**
 * User may link only if involved on both sides (or super_admin with tenant access to both).
 */
export async function assertCanManageLink(req, caseId, taskId) {
  const caseR = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @caseId`, { caseId });
  const taskR = await query(`SELECT id, tenant_id FROM tasks WHERE id = @taskId`, { taskId });
  const crow = caseR.recordset?.[0];
  const trow = taskR.recordset?.[0];
  if (!crow) return { ok: false, status: 404, error: 'Case not found' };
  if (!trow) return { ok: false, status: 404, error: 'Task not found' };
  const caseTenant = getRow(crow, 'tenant_id');
  const taskTenant = getRow(trow, 'tenant_id');
  if (String(caseTenant) !== String(taskTenant)) {
    return { ok: false, status: 400, error: 'Case and task must be in the same tenant' };
  }
  if (!canAccessTenant(req, caseTenant) || !canAccessTaskTenant(req, taskTenant)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const uid = req.user?.id;
  const isSuper = req.user?.role === 'super_admin';
  const inCase = await userInvolvedInCase(uid, caseId);
  const inTask = await userInvolvedInTask(uid, taskId);
  if (!isSuper && (!inCase || !inTask)) {
    return {
      ok: false,
      status: 403,
      error: 'You can only link cases and tasks you are involved in (case lead, opener, stage assignee, or task creator, leader, reviewer, or assignee).',
    };
  }
  return { ok: true, caseTenant, taskTenant };
}

export async function insertCaseTaskLink(req, caseId, taskId, linkNoteRaw) {
  const gate = await assertCanManageLink(req, caseId, taskId);
  if (!gate.ok) return gate;
  const note = linkNoteRaw != null ? String(linkNoteRaw).trim().slice(0, 500) : '';
  try {
    await query(
      `INSERT INTO case_management_task_links (tenant_id, case_id, task_id, link_note, linked_by_user_id)
       VALUES (@tenantId, @caseId, @taskId, @note, @userId)`,
      {
        tenantId: gate.caseTenant,
        caseId,
        taskId,
        note: note || null,
        userId: req.user.id,
      }
    );
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('UQ_case_management_task_links') || msg.includes('duplicate')) {
      return { ok: false, status: 409, error: 'This case and task are already linked' };
    }
    throw e;
  }
  return { ok: true };
}

export async function deleteCaseTaskLinkById(req, linkId, { caseId: scopeCaseId, taskId: scopeTaskId } = {}) {
  const lr = await query(
    `SELECT l.id, l.tenant_id, l.case_id, l.task_id
     FROM case_management_task_links l
     WHERE l.id = @linkId`,
    { linkId }
  );
  const link = lr.recordset?.[0];
  if (!link) return { ok: false, status: 404, error: 'Link not found' };
  const caseId = getRow(link, 'case_id');
  const taskId = getRow(link, 'task_id');
  if (scopeCaseId && String(caseId) !== String(scopeCaseId)) {
    return { ok: false, status: 404, error: 'Link not found' };
  }
  if (scopeTaskId && String(taskId) !== String(scopeTaskId)) {
    return { ok: false, status: 404, error: 'Link not found' };
  }
  const gate = await assertCanManageLink(req, caseId, taskId);
  if (!gate.ok) return gate;
  await query(`DELETE FROM case_management_task_links WHERE id = @linkId`, { linkId });
  return { ok: true };
}

export { getRow };
