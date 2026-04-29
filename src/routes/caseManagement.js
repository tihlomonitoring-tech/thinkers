import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { query, getPool, sql } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import {
  caseManagementCaseOpenedHtml,
  caseManagementLeadStageProgressHtml,
  caseManagementAllStagesCompleteHtml,
  caseManagementCaseClosedHtml,
} from '../lib/emailTemplates.js';
import { insertCaseTaskLink, deleteCaseTaskLinkById, userInvolvedInCase } from '../lib/caseTaskLinks.js';

const router = Router();

/** Alerts visible to a user: targeted to them or involved in the case (lead, opener, stage assignee). */
const ALERT_USER_INVOLVED_SQL = `(
  a.target_user_id = @userId
  OR (a.case_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM case_management_cases c
    WHERE c.id = a.case_id AND (c.lead_user_id = @userId OR c.opened_by_user_id = @userId)
  ))
  OR EXISTS (
    SELECT 1 FROM case_management_stages s
    WHERE s.case_id = a.case_id AND s.assigned_user_id = @userId
  )
)`;

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

const uploadsDir = path.join(process.cwd(), 'uploads', 'case-management');
const stageUpdateUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const caseId = String(req.params?.id || 'case');
      const stageId = String(req.params?.stageId || 'stage');
      const dir = path.join(uploadsDir, tenantId, caseId, stageId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).array('files', 10);

async function nextCaseNumber(tenantId) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `CASE-${ym}-`;
  const r = await query(
    `SELECT TOP 1 case_number
     FROM case_management_cases
     WHERE tenant_id = @tenantId AND case_number LIKE @prefix
     ORDER BY case_number DESC`,
    { tenantId, prefix: `${prefix}%` }
  );
  const last = getRow(r.recordset?.[0], 'case_number') || '';
  const suffix = parseInt(String(last).slice(-4), 10);
  const next = Number.isFinite(suffix) ? suffix + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function getUserEmailAndName(userId) {
  if (!userId) return null;
  const r = await query(
    `SELECT email, full_name FROM users WHERE id = @id AND status = N'active'`,
    { id: userId }
  );
  const row = r.recordset?.[0];
  const email = row ? getRow(row, 'email') : null;
  if (!email || !String(email).trim()) return null;
  return { email: String(email).trim(), name: getRow(row, 'full_name') || String(email).trim() };
}

async function sendNewCaseOpenedEmails({
  req,
  caseNumber,
  caseTitle,
  description,
  category,
  openedSource,
  externalName,
  externalEmail,
  normalizedStages,
  lead_user_id,
}) {
  if (!isEmailConfigured()) return;
  const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  const stagesForEmail = (Array.isArray(normalizedStages) ? normalizedStages : [])
    .map((s, idx) => ({
      order: idx + 1,
      title: String(s?.title || `Step ${idx + 1}`).trim(),
      assigned_user_id: s?.assigned_user_id ? String(s.assigned_user_id).trim() : null,
    }))
    .filter((s) => s.title);
  const assigneeIds = [...new Set(stagesForEmail.map((s) => s.assigned_user_id).filter(Boolean))];
  let usersById = {};
  if (assigneeIds.length > 0) {
    const pool = await getPool();
    const reqPool = pool.request();
    assigneeIds.forEach((id, i) => {
      reqPool.input(`id${i}`, sql.UniqueIdentifier, id);
    });
    const placeholders = assigneeIds.map((_, i) => `@id${i}`).join(',');
    const ur = await reqPool.query(
      `SELECT id, email, full_name FROM users
       WHERE id IN (${placeholders}) AND status = N'active'
         AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`
    );
    for (const row of ur.recordset || []) {
      const id = getRow(row, 'id');
      if (id) usersById[String(id).toLowerCase()] = row;
    }
  }
  /** @type {Map<string, { email: string, name: string, isOpener: boolean, isLead: boolean, stageLines: string[] }>} */
  const recipients = new Map();
  function touch(key, email, name) {
    if (!email || !String(email).trim()) return;
    const em = String(email).trim();
    const k = key || em.toLowerCase();
    if (!recipients.has(k)) {
      recipients.set(k, { email: em, name: name || '', isOpener: false, isLead: false, stageLines: [] });
    }
    return recipients.get(k);
  }
  if (openedSource === 'external') {
    const em = externalEmail ? String(externalEmail).trim() : '';
    if (em) {
      const r = touch(em.toLowerCase(), em, externalName || 'External requester');
      if (r) r.isOpener = true;
    }
  } else {
    const em = req.user?.email ? String(req.user.email).trim() : '';
    if (em) {
      const r = touch(em.toLowerCase(), em, req.user.full_name || req.user.email);
      if (r) r.isOpener = true;
    }
  }
  for (const st of stagesForEmail) {
    if (!st.assigned_user_id) continue;
    const row = usersById[String(st.assigned_user_id).toLowerCase()];
    if (!row) continue;
    const em = getRow(row, 'email');
    const nm = getRow(row, 'full_name') || em;
    const r = touch(em.toLowerCase(), em, nm);
    if (r) r.stageLines.push(`Step ${st.order}: ${st.title}`);
  }
  if (lead_user_id) {
    const lead = await getUserEmailAndName(lead_user_id);
    if (lead) {
      const r = touch(lead.email.toLowerCase(), lead.email, lead.name);
      if (r) r.isLead = true;
    }
  }
  const subject = `New case opened: ${caseNumber} — ${caseTitle}`;
  for (const rec of recipients.values()) {
    const html = caseManagementCaseOpenedHtml({
      caseNumber,
      title: caseTitle,
      description,
      category,
      openedSource,
      appUrl,
      recipientName: rec.name,
      isOpener: rec.isOpener,
      isLead: rec.isLead,
      assignedStageLines: [...new Set(rec.stageLines)],
    });
    sendEmail({ to: rec.email, subject, body: html, html: true }).catch((e) =>
      console.error('[case-management] New case email error:', e?.message || e)
    );
  }
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('case_management'));

router.get('/users/tenant', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.json({ users: [] });
    const r = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       WHERE u.status = N'active'
         AND (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
         AND (EXISTS (SELECT 1 FROM user_page_roles pr WHERE pr.user_id = u.id AND pr.page_id = N'case_management') OR u.role = N'super_admin')
       ORDER BY u.full_name`,
      { tenantId }
    );
    res.json({ users: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.json({ stats: { total: 0, open: 0, in_progress: 0, pending_internal: 0, closed: 0 }, recent: [] });
    const stats = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN [status] IN (N'open', N'pending_internal') THEN 1 ELSE 0 END) AS [open],
         SUM(CASE WHEN [status] = N'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN [status] = N'pending_internal' THEN 1 ELSE 0 END) AS pending_internal,
         SUM(CASE WHEN [status] = N'closed' THEN 1 ELSE 0 END) AS closed
       FROM case_management_cases
       WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const recent = await query(
      `SELECT TOP 8
         c.id,
         c.case_number,
         c.title,
         c.category,
         c.[status],
         c.opened_source,
         c.created_at,
         c.lead_user_id,
         u.full_name AS lead_name,
         (SELECT COUNT(*) FROM case_management_stages s WHERE s.case_id = c.id) AS stage_count,
         (SELECT COUNT(*) FROM case_management_stages s WHERE s.case_id = c.id AND s.[status] = N'completed') AS stages_completed
       FROM case_management_cases c
       LEFT JOIN users u ON u.id = c.lead_user_id
       WHERE c.tenant_id = @tenantId
       ORDER BY c.created_at DESC`,
      { tenantId }
    );
    res.json({ stats: stats.recordset?.[0] || {}, recent: recent.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.json({ alerts: [] });
    const scope = String(req.query.scope || 'involved').toLowerCase();
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const caseIdFilter = req.query.case_id ? String(req.query.case_id).trim() : '';
    let where = `WHERE a.tenant_id = @tenantId`;
    const params = { tenantId, userId: req.user.id };
    if (unreadOnly) where += ' AND a.is_read = 0';
    if (caseIdFilter) {
      where += ' AND a.case_id = @caseIdFilter';
      params.caseIdFilter = caseIdFilter;
    }
    if (scope === 'tenant' || scope === 'all') {
      /* all alerts in tenant */
    } else if (scope === 'directed' || scope === 'targeted') {
      where += ' AND a.target_user_id = @userId';
    } else {
      where += ` AND ${ALERT_USER_INVOLVED_SQL}`;
    }
    const r = await query(
      `SELECT TOP 100
         a.id, a.case_id, a.alert_type, a.title, a.message, a.is_read, a.created_at, a.target_user_id,
         c.case_number, c.title AS case_title, c.[status] AS case_status
       FROM case_management_alerts a
       LEFT JOIN case_management_cases c ON c.id = a.case_id
       ${where}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json({ alerts: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.patch('/alerts/:alertId/read', async (req, res, next) => {
  try {
    const { alertId } = req.params;
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const visibility =
      req.user?.role === 'super_admin'
        ? '1=1'
        : ALERT_USER_INVOLVED_SQL;
    await query(
      `UPDATE a
       SET a.is_read = 1, a.read_at = SYSUTCDATETIME()
       FROM case_management_alerts a
       WHERE a.id = @alertId AND a.tenant_id = @tenantId AND (${visibility})`,
      { alertId, tenantId, userId: req.user.id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.json({ cases: [] });
    const { status, category, search } = req.query || {};
    let where = 'WHERE c.tenant_id = @tenantId';
    const params = { tenantId };
    if (status && status !== 'all') {
      where += ' AND c.[status] = @status';
      params.status = String(status).trim();
    }
    if (category && category !== 'all') {
      where += ' AND c.category = @category';
      params.category = String(category).trim();
    }
    if (search && String(search).trim()) {
      where += ' AND (c.case_number LIKE @q OR c.title LIKE @q OR c.[description] LIKE @q)';
      params.q = `%${String(search).trim()}%`;
    }
    const r = await query(
      `SELECT c.id, c.case_number, c.title, c.[description], c.category, c.[status], c.opened_source,
              c.external_name, c.external_email, c.created_at, c.updated_at, u.full_name AS lead_name
       FROM case_management_cases c
       LEFT JOIN users u ON u.id = c.lead_user_id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json({ cases: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      title,
      description,
      category = 'departmental',
      tenant_id,
      opened_source = 'internal',
      external_name,
      external_email,
      lead_user_id,
      stages = [],
    } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Case title is required' });
    const tenantId = tenant_id || req.user?.tenant_id;
    if (!tenantId || !canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Invalid tenant allocation' });
    const caseNumber = await nextCaseNumber(tenantId);
    const status = opened_source === 'external' ? 'pending_internal' : 'open';
    const insert = await query(
      `INSERT INTO case_management_cases
         (tenant_id, case_number, title, [description], category, [status], opened_source, opened_by_user_id, external_name, external_email, lead_user_id)
       OUTPUT INSERTED.id, INSERTED.case_number, INSERTED.title, INSERTED.[status], INSERTED.created_at
       VALUES (@tenantId, @caseNumber, @title, @description, @category, @status, @openedSource, @openedByUserId, @externalName, @externalEmail, @leadUserId)`,
      {
        tenantId,
        caseNumber,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: String(category).trim() === 'external' ? 'external' : 'departmental',
        status,
        openedSource: opened_source === 'external' ? 'external' : 'internal',
        openedByUserId: req.user.id,
        externalName: external_name ? String(external_name).trim() : null,
        externalEmail: external_email ? String(external_email).trim() : null,
        leadUserId: lead_user_id || null,
      }
    );
    const created = insert.recordset?.[0];
    const caseId = getRow(created, 'id');
    const normalizedStages = Array.isArray(stages) ? stages : [];
    for (let i = 0; i < normalizedStages.length; i++) {
      const s = normalizedStages[i] || {};
      await query(
        `INSERT INTO case_management_stages
           (case_id, stage_order, title, instructions, assigned_user_id, [status])
         VALUES (@caseId, @stageOrder, @title, @instructions, @assignedUserId, N'pending')`,
        {
          caseId,
          stageOrder: i + 1,
          title: String(s.title || `Step ${i + 1}`).trim(),
          instructions: s.instructions ? String(s.instructions).trim() : null,
          assignedUserId: s.assigned_user_id || null,
        }
      );
    }
    await query(
      `INSERT INTO case_management_alerts (tenant_id, case_id, target_user_id, alert_type, title, message)
       VALUES (@tenantId, @caseId, @targetUserId, N'case_created', @title, @message)`,
      {
        tenantId,
        caseId,
        targetUserId: lead_user_id || null,
        title: `New case ${getRow(created, 'case_number')}`,
        message: `${String(title).trim()} was created and is awaiting action.`,
      }
    );
    sendNewCaseOpenedEmails({
      req,
      caseNumber: getRow(created, 'case_number'),
      caseTitle: String(title).trim(),
      description,
      category: String(category).trim() === 'external' ? 'external' : 'departmental',
      openedSource: opened_source === 'external' ? 'external' : 'internal',
      externalName: external_name ? String(external_name).trim() : null,
      externalEmail: external_email ? String(external_email).trim() : null,
      normalizedStages,
      lead_user_id: lead_user_id || null,
    }).catch((e) => console.error('[case-management] New case emails:', e?.message || e));
    res.status(201).json({ case: created });
  } catch (err) {
    next(err);
  }
});

/** Linked tasks (same tenant). Listing allowed with case tenant access; candidates & mutations require involvement. */
router.get('/:id/task-links', async (req, res, next) => {
  try {
    const { id } = req.params;
    const one = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @id`, { id });
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const r = await query(
      `SELECT l.id AS link_id, l.link_note, l.created_at,
              l.task_id, t.title AS task_title, t.[status] AS task_status, t.progress AS task_progress, t.due_date AS task_due_date,
              u.full_name AS linked_by_name
       FROM case_management_task_links l
       INNER JOIN tasks t ON t.id = l.task_id
       LEFT JOIN users u ON u.id = l.linked_by_user_id
       WHERE l.case_id = @caseId
       ORDER BY l.created_at DESC`,
      { caseId: id }
    );
    const links = (r.recordset || []).map((x) => ({
      id: getRow(x, 'link_id'),
      task_id: getRow(x, 'task_id'),
      link_note: getRow(x, 'link_note'),
      created_at: getRow(x, 'created_at'),
      linked_by_name: getRow(x, 'linked_by_name'),
      task: {
        title: getRow(x, 'task_title'),
        status: getRow(x, 'task_status'),
        progress: getRow(x, 'task_progress'),
        due_date: getRow(x, 'task_due_date'),
      },
    }));
    res.json({ links });
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('invalid object name') &&
        String(err?.message || '').toLowerCase().includes('case_management_task_links')) {
      return res.json({ links: [] });
    }
    next(err);
  }
});

router.get('/:id/link-candidates/tasks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const search = String(req.query.search || '').trim().slice(0, 200);
    const one = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @id`, { id });
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    const tenantId = getRow(row, 'tenant_id');
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden' });
    const uid = req.user?.id;
    if (!(await userInvolvedInCase(uid, id)) && req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'You must be involved in this case to browse linkable tasks' });
    }
    const params = { caseId: id, tenantId, userId: uid };
    let searchSql = '';
    if (search) {
      searchSql = ' AND (t.title LIKE @pat OR t.[description] LIKE @pat)';
      params.pat = `%${search.replace(/[%_]/g, '')}%`;
    }
    const r = await query(
      `SELECT TOP 40 t.id, t.title, t.[status], t.progress, t.due_date, t.task_leader_id
       FROM tasks t
       WHERE t.tenant_id = @tenantId
         AND NOT EXISTS (SELECT 1 FROM case_management_task_links l WHERE l.case_id = @caseId AND l.task_id = t.id)
         AND (
           t.created_by = @userId OR t.task_leader_id = @userId OR t.task_reviewer_id = @userId
           OR EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id = t.id AND a.user_id = @userId)
         )
         ${searchSql}
       ORDER BY t.updated_at DESC`,
      params
    );
    const tasks = (r.recordset || []).map((t) => ({
      id: getRow(t, 'id'),
      title: getRow(t, 'title'),
      status: getRow(t, 'status'),
      progress: getRow(t, 'progress'),
      due_date: getRow(t, 'due_date'),
    }));
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/task-links', async (req, res, next) => {
  try {
    const { id: caseId } = req.params;
    const { task_id, link_note } = req.body || {};
    const taskId = task_id ? String(task_id).trim() : '';
    if (!taskId) return res.status(400).json({ error: 'task_id is required' });
    const one = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @caseId`, { caseId });
    if (!one.recordset?.[0]) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(one.recordset[0], 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const result = await insertCaseTaskLink(req, caseId, taskId, link_note);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ ok: true });
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('invalid object name')) {
      return res.status(503).json({ error: 'Case–task links are not installed. Run npm run db:case-management-task-links' });
    }
    next(err);
  }
});

router.delete('/:id/task-links/:linkId', async (req, res, next) => {
  try {
    const { id: caseId, linkId } = req.params;
    const one = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @caseId`, { caseId });
    if (!one.recordset?.[0]) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(one.recordset[0], 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const result = await deleteCaseTaskLinkById(req, linkId, { caseId });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const one = await query(
      `SELECT c.*, u.full_name AS lead_name, o.full_name AS opened_by_name
       FROM case_management_cases c
       LEFT JOIN users u ON u.id = c.lead_user_id
       LEFT JOIN users o ON o.id = c.opened_by_user_id
       WHERE c.id = @id`,
      { id }
    );
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const stages = await query(
      `SELECT s.*, u.full_name AS assigned_user_name
       FROM case_management_stages s
       LEFT JOIN users u ON u.id = s.assigned_user_id
       WHERE s.case_id = @caseId
       ORDER BY s.stage_order ASC`,
      { caseId: id }
    );
    const updates = await query(
      `SELECT u.id, u.stage_id, u.[status], u.comment, u.notify_external, u.actor_type, u.actor_name, u.created_at
       FROM case_management_stage_updates u
       WHERE u.case_id = @caseId
       ORDER BY u.created_at DESC`,
      { caseId: id }
    );
    const attachments = await query(
      `SELECT a.id, a.update_id, a.file_name, a.file_path, a.created_at
       FROM case_management_stage_update_attachments a
       WHERE a.case_id = @caseId
       ORDER BY a.created_at DESC`,
      { caseId: id }
    );
    const attByUpdate = {};
    for (const a of attachments.recordset || []) {
      const uid = getRow(a, 'update_id');
      if (!attByUpdate[uid]) attByUpdate[uid] = [];
      attByUpdate[uid].push({
        id: getRow(a, 'id'),
        file_name: getRow(a, 'file_name'),
        created_at: getRow(a, 'created_at'),
        download_url: `/api/case-management/${id}/attachments/${getRow(a, 'id')}/download`,
      });
    }
    const mappedUpdates = (updates.recordset || []).map((u) => ({
      id: getRow(u, 'id'),
      stage_id: getRow(u, 'stage_id'),
      status: getRow(u, 'status'),
      comment: getRow(u, 'comment'),
      notify_external: !!getRow(u, 'notify_external'),
      actor_type: getRow(u, 'actor_type'),
      actor_name: getRow(u, 'actor_name'),
      created_at: getRow(u, 'created_at'),
      attachments: attByUpdate[getRow(u, 'id')] || [],
    }));
    let linked_tasks = [];
    try {
      const lr = await query(
        `SELECT l.id AS link_id, l.link_note, l.created_at, l.task_id,
                t.title AS task_title, t.[status] AS task_status, t.progress AS task_progress, t.due_date AS task_due_date,
                u.full_name AS linked_by_name
         FROM case_management_task_links l
         INNER JOIN tasks t ON t.id = l.task_id
         LEFT JOIN users u ON u.id = l.linked_by_user_id
         WHERE l.case_id = @caseId
         ORDER BY l.created_at DESC`,
        { caseId: id }
      );
      linked_tasks = (lr.recordset || []).map((x) => ({
        id: getRow(x, 'link_id'),
        task_id: getRow(x, 'task_id'),
        link_note: getRow(x, 'link_note'),
        created_at: getRow(x, 'created_at'),
        linked_by_name: getRow(x, 'linked_by_name'),
        task: {
          title: getRow(x, 'task_title'),
          status: getRow(x, 'task_status'),
          progress: getRow(x, 'task_progress'),
          due_date: getRow(x, 'task_due_date'),
        },
      }));
    } catch (_) {
      linked_tasks = [];
    }
    const uid = req.user?.id;
    const canManageTaskLinks =
      req.user?.role === 'super_admin' || (uid && (await userInvolvedInCase(uid, id)));
    res.json({
      case: row,
      stages: stages.recordset || [],
      updates: mappedUpdates,
      linked_tasks,
      meta: { can_manage_task_links: !!canManageTaskLinks },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/lead', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lead_user_id } = req.body || {};
    const one = await query(`SELECT id, tenant_id FROM case_management_cases WHERE id = @id`, { id });
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    await query(
      `UPDATE case_management_cases
       SET lead_user_id = @leadUserId,
           [status] = CASE WHEN [status] = N'pending_internal' AND @leadUserId IS NOT NULL THEN N'in_progress' ELSE [status] END,
           updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, leadUserId: lead_user_id || null }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/stages/:stageId/updates', stageUpdateUpload, async (req, res, next) => {
  try {
    const { id, stageId } = req.params;
    const { status, comment, notify_external } = req.body || {};
    const one = await query(
      `SELECT id, tenant_id, external_email, lead_user_id, case_number, title
       FROM case_management_cases WHERE id = @id`,
      { id }
    );
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const stage = await query(
      `SELECT id, case_id, title, stage_order FROM case_management_stages WHERE id = @stageId AND case_id = @caseId`,
      { stageId, caseId: id }
    );
    if (!stage.recordset?.[0]) return res.status(404).json({ error: 'Stage not found' });
    const stageMeta = stage.recordset[0];
    const stageTitle = getRow(stageMeta, 'title') || 'Stage';
    const stageOrder = getRow(stageMeta, 'stage_order') || 1;
    const normalizedStatus = ['pending', 'in_progress', 'completed'].includes(String(status || '')) ? String(status) : 'in_progress';
    await query(
      `UPDATE case_management_stages
       SET [status] = @status,
           completed_at = CASE WHEN @status = N'completed' THEN SYSUTCDATETIME() ELSE completed_at END,
           completed_by_user_id = CASE WHEN @status = N'completed' THEN @userId ELSE completed_by_user_id END,
           updated_at = SYSUTCDATETIME()
       WHERE id = @stageId`,
      { stageId, status: normalizedStatus, userId: req.user.id }
    );
    const ins = await query(
      `INSERT INTO case_management_stage_updates
         (case_id, stage_id, actor_user_id, actor_type, actor_name, [status], comment, notify_external)
       OUTPUT INSERTED.id, INSERTED.created_at
       VALUES (@caseId, @stageId, @actorUserId, N'internal', @actorName, @status, @comment, @notifyExternal)`,
      {
        caseId: id,
        stageId,
        actorUserId: req.user.id,
        actorName: req.user.full_name || req.user.email || 'Internal user',
        status: normalizedStatus,
        comment: comment ? String(comment).trim() : null,
        notifyExternal: notify_external === true || String(notify_external) === 'true' ? 1 : 0,
      }
    );
    const updateId = getRow(ins.recordset?.[0], 'id');
    const files = req.files || [];
    for (const file of files) {
      const relativePath = path.relative(path.join(process.cwd(), 'uploads'), file.path).replace(/\\/g, '/');
      await query(
        `INSERT INTO case_management_stage_update_attachments (case_id, update_id, file_name, file_path, uploaded_by_user_id)
         VALUES (@caseId, @updateId, @fileName, @filePath, @uploadedByUserId)`,
        {
          caseId: id,
          updateId,
          fileName: file.originalname || file.filename,
          filePath: relativePath,
          uploadedByUserId: req.user.id,
        }
      );
    }
    if (notify_external && getRow(row, 'external_email')) {
      await query(
        `INSERT INTO case_management_alerts (tenant_id, case_id, target_external_email, alert_type, title, message)
         VALUES (@tenantId, @caseId, @targetExternalEmail, N'external_progress', @title, @message)`,
        {
          tenantId: getRow(row, 'tenant_id'),
          caseId: id,
          targetExternalEmail: getRow(row, 'external_email'),
          title: 'Case progress updated',
          message: comment ? String(comment).trim() : 'A case stage has progressed.',
        }
      );
    }
    const pending = await query(`SELECT COUNT(*) AS remaining FROM case_management_stages WHERE case_id = @caseId AND [status] <> N'completed'`, { caseId: id });
    const remaining = Number(getRow(pending.recordset?.[0], 'remaining') || 0);
    if (remaining === 0) {
      await query(`UPDATE case_management_cases SET [status] = N'completed', updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
    } else {
      await query(`UPDATE case_management_cases SET [status] = N'in_progress', updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
    }

    const leadId = getRow(row, 'lead_user_id');
    const caseNumber = getRow(row, 'case_number');
    const caseTitle = getRow(row, 'title');
    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
    const actorName = req.user.full_name || req.user.email || 'User';
    if (leadId && isEmailConfigured()) {
      const leadInfo = await getUserEmailAndName(leadId);
      if (leadInfo) {
        if (remaining === 0) {
          const htmlAll = caseManagementAllStagesCompleteHtml({
            caseNumber,
            caseTitle,
            appUrl,
            recipientName: leadInfo.name,
          });
          sendEmail({
            to: leadInfo.email,
            subject: `All stages completed: ${caseNumber}`,
            body: htmlAll,
            html: true,
          }).catch((e) => console.error('[case-management] Lead all-stages email:', e?.message || e));
          await query(
            `INSERT INTO case_management_alerts (tenant_id, case_id, target_user_id, alert_type, title, message)
             VALUES (@tenantId, @caseId, @leadId, N'all_stages_complete', @title, @message)`,
            {
              tenantId: getRow(row, 'tenant_id'),
              caseId: id,
              leadId,
              title: `All steps done: ${caseNumber}`,
              message: 'Every stage is completed. Review and close the case when ready.',
            }
          );
        } else if (normalizedStatus === 'in_progress' || normalizedStatus === 'completed') {
          const htmlProg = caseManagementLeadStageProgressHtml({
            caseNumber,
            caseTitle,
            stageTitle,
            stageOrder,
            status: normalizedStatus,
            actorName,
            comment: comment ? String(comment).trim() : null,
            appUrl,
            recipientName: leadInfo.name,
          });
          sendEmail({
            to: leadInfo.email,
            subject: `Case progress: ${caseNumber} — ${stageTitle}`,
            body: htmlProg,
            html: true,
          }).catch((e) => console.error('[case-management] Lead progress email:', e?.message || e));
          await query(
            `INSERT INTO case_management_alerts (tenant_id, case_id, target_user_id, alert_type, title, message)
             VALUES (@tenantId, @caseId, @leadId, N'stage_progress', @title, @message)`,
            {
              tenantId: getRow(row, 'tenant_id'),
              caseId: id,
              leadId,
              title: `Stage update: ${caseNumber}`,
              message: `${actorName} set "${stageTitle}" to ${normalizedStatus.replace(/_/g, ' ')}.`,
            }
          );
        }
      }
    }

    res.status(201).json({ ok: true, update_id: updateId });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/finalize', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { final_remarks } = req.body || {};
    const one = await query(
      `SELECT id, tenant_id, lead_user_id, case_number, title
       FROM case_management_cases WHERE id = @id`,
      { id }
    );
    const row = one.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const pending = await query(`SELECT COUNT(*) AS remaining FROM case_management_stages WHERE case_id = @caseId AND [status] <> N'completed'`, { caseId: id });
    const remaining = Number(getRow(pending.recordset?.[0], 'remaining') || 0);
    if (remaining > 0) return res.status(400).json({ error: 'All stages must be completed before final closure.' });
    const finalRemarksStr = final_remarks ? String(final_remarks).trim() : null;
    await query(
      `UPDATE case_management_cases
       SET [status] = N'closed',
           final_remarks = @finalRemarks,
           finalised_by_user_id = @userId,
           finalised_at = SYSUTCDATETIME(),
           updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, finalRemarks: finalRemarksStr, userId: req.user.id }
    );
    const leadId = getRow(row, 'lead_user_id');
    const caseNumber = getRow(row, 'case_number');
    const caseTitle = getRow(row, 'title');
    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
    const closedByName = req.user.full_name || req.user.email || 'User';
    if (leadId && isEmailConfigured()) {
      const leadInfo = await getUserEmailAndName(leadId);
      if (leadInfo) {
        const html = caseManagementCaseClosedHtml({
          caseNumber,
          caseTitle,
          finalRemarks: finalRemarksStr,
          closedByName,
          appUrl,
          recipientName: leadInfo.name,
        });
        sendEmail({
          to: leadInfo.email,
          subject: `Case closed: ${caseNumber}`,
          body: html,
          html: true,
        }).catch((e) => console.error('[case-management] Case closed email:', e?.message || e));
      }
    }
    if (leadId) {
      await query(
        `INSERT INTO case_management_alerts (tenant_id, case_id, target_user_id, alert_type, title, message)
         VALUES (@tenantId, @caseId, @leadId, N'case_closed', @title, @message)`,
        {
          tenantId: getRow(row, 'tenant_id'),
          caseId: id,
          leadId,
          title: `Case closed: ${caseNumber}`,
          message: finalRemarksStr || 'The case has been closed with final completion remarks.',
        }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const { id, attachmentId } = req.params;
    const r = await query(
      `SELECT a.file_path, a.file_name, c.tenant_id
       FROM case_management_stage_update_attachments a
       JOIN case_management_cases c ON c.id = a.case_id
       WHERE a.id = @attachmentId AND a.case_id = @caseId`,
      { attachmentId, caseId: id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const fullPath = path.join(process.cwd(), 'uploads', getRow(row, 'file_path'));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.download(fullPath, getRow(row, 'file_name') || 'attachment');
  } catch (err) {
    next(err);
  }
});

export default router;
