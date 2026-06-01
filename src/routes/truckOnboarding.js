/**
 * Fleet onboarding (trucks + drivers) — admin template map, progress updates, contractor board.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

const router = Router();

/** Public — use to confirm this API build includes onboarding routes (expect 200, not 404). */
router.get('/ping', (req, res) => res.json({ ok: true, feature: 'truck-onboarding' }));

router.use(requireAuth, loadUser);

const uploadsRoot = path.join(process.cwd(), 'uploads', 'truck-onboarding');

function get(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function pageRolesNorm(req) {
  return (req.user?.page_roles || []).map((p) => String(p || '').trim().toLowerCase()).filter(Boolean);
}

function canOnboardingAdmin(req) {
  if (req.user?.role === 'super_admin') return true;
  const pr = pageRolesNorm(req);
  return pr.includes('onboarding_admin') || pr.includes('command_centre') || pr.includes('management');
}

function requireOnboardingAdminAccess(req, res, next) {
  if (canOnboardingAdmin(req)) return next();
  return res.status(403).json({ error: 'No access to Onboarding Admin' });
}

async function getHaulierContractorIds(req, tid) {
  const result = await query(`SELECT contractor_id FROM user_contractors WHERE user_id = @userId`, {
    userId: req.user?.id,
  });
  const ids = [...new Set((result.recordset || []).map((r) => get(r, 'contractor_id')).filter(Boolean))];
  if (ids.length > 0) return ids;
  const countResult = await query(`SELECT id FROM contractors WHERE tenant_id = @tenantId`, { tenantId: tid });
  const list = countResult.recordset || [];
  if (list.length === 1) return [get(list[0], 'id')];
  if (list.length > 1) return [];
  return [];
}

async function getAllowedContractorIds(req) {
  const tid = tenantId(req);
  if (!tid) return null;
  if (req.user?.role === 'super_admin') return null;
  const pr = pageRolesNorm(req);
  const hasContractorPortal = pr.includes('contractor');
  if (
    pr.includes('command_centre') ||
    pr.includes('access_management') ||
    pr.includes('onboarding_admin') ||
    pr.includes('management') ||
    (pr.includes('rector') && !hasContractorPortal)
  ) {
    return null;
  }
  return getHaulierContractorIds(req, tid);
}

function contractorFilterSql(allowedIds, alias = 't') {
  if (allowedIds === null) return { sql: '', params: {} };
  if (!allowedIds.length) return { sql: ` AND 1=0`, params: {} };
  const keys = allowedIds.map((_, i) => `@cid${i}`);
  const params = Object.fromEntries(allowedIds.map((id, i) => [`cid${i}`, id]));
  return { sql: ` AND ${alias}.contractor_id IN (${keys.join(',')})`, params };
}

function entityTypeOf(ob) {
  const et = get(ob, 'entity_type');
  if (et === 'driver' || get(ob, 'driver_id')) return 'driver';
  return 'truck';
}

function driverDisplayName(ob) {
  const fn = get(ob, 'driver_full_name') || get(ob, 'full_name');
  const sn = get(ob, 'driver_surname') || get(ob, 'surname');
  const lic = get(ob, 'driver_license_number') || get(ob, 'license_number');
  const name = [fn, sn].filter(Boolean).join(' ').trim();
  return name || lic || 'Driver';
}

function onboardingDisplayLabel(ob) {
  if (entityTypeOf(ob) === 'driver') return driverDisplayName(ob);
  const reg = get(ob, 'registration');
  const fleet = get(ob, 'fleet_no');
  return [reg, fleet].filter(Boolean).join(' · ') || 'Truck';
}

function taskIsFullyComplete(task) {
  const a = task.assignee || 'admin';
  if (a === 'admin') return !!task.admin_completed;
  if (a === 'contractor') return !!task.contractor_completed;
  return !!task.contractor_completed && !!task.admin_completed;
}

function mapTaskFromRow(t) {
  const assignee = get(t, 'assignee') || 'admin';
  let contractor_completed = !!get(t, 'contractor_completed');
  let admin_completed = !!get(t, 'admin_completed');
  if (get(t, 'contractor_completed') === undefined && get(t, 'admin_completed') === undefined && get(t, 'is_completed')) {
    if (assignee === 'both') {
      contractor_completed = true;
      admin_completed = true;
    } else if (assignee === 'contractor') contractor_completed = true;
    else admin_completed = true;
  }
  const task = {
    id: get(t, 'id'),
    title: get(t, 'title'),
    sort_order: get(t, 'sort_order'),
    assignee,
    contractor_completed,
    admin_completed,
    admin_note: get(t, 'admin_note'),
    contractor_note: get(t, 'contractor_note'),
    completed_at: get(t, 'completed_at'),
  };
  task.is_completed = taskIsFullyComplete(task);
  return task;
}

async function syncTaskCompletedFlag(taskId, tid) {
  const r = await query(
    `SELECT assignee, contractor_completed, admin_completed FROM truck_onboarding_tasks WHERE id = @id AND tenant_id = @tid`,
    { id: taskId, tid }
  );
  const row = r.recordset?.[0];
  if (!row) return;
  const task = mapTaskFromRow(row);
  const done = taskIsFullyComplete(task) ? 1 : 0;
  await query(
    `UPDATE truck_onboarding_tasks SET is_completed = @done, completed_at = CASE WHEN @done = 1 THEN SYSUTCDATETIME() ELSE NULL END,
       updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tid`,
    { done, id: taskId, tid }
  );
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = tenantId(req) || 'unknown';
      const obId = req.params.onboardingId || req.params.id || 'misc';
      const dir = path.join(uploadsRoot, tid, obId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file');

async function getOrCreateActiveTemplate(tid, userId) {
  let r = await query(
    `SELECT TOP 1 * FROM truck_onboarding_templates WHERE tenant_id = @tid AND is_active = 1 ORDER BY updated_at DESC`,
    { tid }
  );
  if (r.recordset?.[0]) return r.recordset[0];
  const ins = await query(
    `INSERT INTO truck_onboarding_templates (tenant_id, name, description, is_active, created_by_user_id)
     OUTPUT INSERTED.* VALUES (@tid, N'Truck onboarding', NULL, 1, @uid)`,
    { tid, uid: userId }
  );
  return ins.recordset[0];
}

async function loadTemplateFullById(templateId, tid) {
  if (!templateId) return { id: null, name: '', description: '', stages: [] };
  const r = await query(
    `SELECT * FROM truck_onboarding_templates WHERE id = @id AND tenant_id = @tid`,
    { id: templateId, tid }
  );
  const tpl = r.recordset?.[0];
  if (!tpl) return null;
  return loadTemplateStages(get(tpl, 'id'), tpl);
}

async function loadTemplateStages(templateId, tplRow) {
  const tid = get(tplRow, 'tenant_id');
  const stagesR = await query(
    `SELECT * FROM truck_onboarding_template_stages WHERE template_id = @tpl ORDER BY sort_order, created_at`,
    { tpl: templateId }
  );
  const tasksR = await query(
    `SELECT * FROM truck_onboarding_template_tasks WHERE template_id = @tpl ORDER BY sort_order, created_at`,
    { tpl: templateId }
  );
  const tasksByStage = {};
  for (const task of tasksR.recordset || []) {
    const sid = String(get(task, 'stage_id'));
    if (!tasksByStage[sid]) tasksByStage[sid] = [];
    tasksByStage[sid].push({
      id: get(task, 'id'),
      title: get(task, 'title'),
      sort_order: get(task, 'sort_order'),
      assignee: get(task, 'assignee'),
    });
  }
  const stages = (stagesR.recordset || []).map((s) => ({
    id: get(s, 'id'),
    title: get(s, 'title'),
    description: get(s, 'description'),
    sort_order: get(s, 'sort_order'),
    tasks: tasksByStage[String(get(s, 'id'))] || [],
  }));
  return {
    id: templateId,
    name: get(tplRow, 'name'),
    description: get(tplRow, 'description'),
    stages,
  };
}

async function listTemplates(tid) {
  const r = await query(
    `SELECT t.id, t.name, t.description, t.is_active, t.updated_at,
            (SELECT COUNT(*) FROM truck_onboarding_template_stages s WHERE s.template_id = t.id) AS stage_count
     FROM truck_onboarding_templates t
     WHERE t.tenant_id = @tid AND t.is_active = 1
     ORDER BY t.name, t.updated_at DESC`,
    { tid }
  );
  return (r.recordset || []).map((row) => ({
    id: get(row, 'id'),
    name: get(row, 'name'),
    description: get(row, 'description'),
    stage_count: get(row, 'stage_count') || 0,
    updated_at: get(row, 'updated_at'),
  }));
}

async function saveTemplateById(tid, tplId, { name, description, stages }, userId) {
  await query(
    `UPDATE truck_onboarding_templates SET name = @name, description = @desc, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tid`,
    { id: tplId, tid, name: String(name || 'Onboarding map').trim(), desc: description || null }
  );
  await query(`DELETE FROM truck_onboarding_template_tasks WHERE template_id = @tpl`, { tpl: tplId });
  await query(`DELETE FROM truck_onboarding_template_stages WHERE template_id = @tpl`, { tpl: tplId });
  const stageList = Array.isArray(stages) ? stages : [];
  for (let i = 0; i < stageList.length; i++) {
    const s = stageList[i];
    const ins = await query(
      `INSERT INTO truck_onboarding_template_stages (template_id, tenant_id, title, description, sort_order)
       OUTPUT INSERTED.id VALUES (@tpl, @tid, @title, @desc, @ord)`,
      {
        tpl: tplId,
        tid,
        title: String(s.title || `Stage ${i + 1}`).trim(),
        desc: s.description || null,
        ord: i,
      }
    );
    const stageId = get(ins.recordset[0], 'id');
    const tasks = Array.isArray(s.tasks) ? s.tasks : [];
    for (let j = 0; j < tasks.length; j++) {
      const t = tasks[j];
      const asg = ['admin', 'contractor', 'both'].includes(t.assignee) ? t.assignee : 'admin';
      await query(
        `INSERT INTO truck_onboarding_template_tasks (stage_id, template_id, tenant_id, title, sort_order, assignee)
         VALUES (@sid, @tpl, @tid, @title, @ord, @asg)`,
        {
          sid: stageId,
          tpl: tplId,
          tid,
          title: String(t.title || `Action ${j + 1}`).trim(),
          ord: j,
          asg,
        }
      );
    }
  }
  return loadTemplateFullById(tplId, tid);
}

async function loadTemplateFull(tid, createIfMissing = false) {
  let r = await query(
    `SELECT TOP 1 * FROM truck_onboarding_templates WHERE tenant_id = @tid AND is_active = 1 ORDER BY updated_at DESC`,
    { tid }
  );
  let tpl = r.recordset?.[0];
  if (!tpl && createIfMissing) tpl = await getOrCreateActiveTemplate(tid, null);
  if (!tpl) {
    return { id: null, name: 'Truck onboarding', description: '', stages: [] };
  }
  const templateId = get(tpl, 'id');
  const stagesR = await query(
    `SELECT * FROM truck_onboarding_template_stages WHERE template_id = @tpl ORDER BY sort_order, created_at`,
    { tpl: templateId }
  );
  return loadTemplateStages(templateId, tpl);
}

async function snapshotOnboardingFromTemplate(onboardingId, tid, templateId) {
  const stagesR = await query(
    `SELECT * FROM truck_onboarding_template_stages WHERE template_id = @tpl ORDER BY sort_order`,
    { tpl: templateId }
  );
  const tasksR = await query(`SELECT * FROM truck_onboarding_template_tasks WHERE template_id = @tpl`, { tpl: templateId });
  const tasksByTplStage = {};
  for (const t of tasksR.recordset || []) {
    const sid = String(get(t, 'stage_id'));
    if (!tasksByTplStage[sid]) tasksByTplStage[sid] = [];
    tasksByTplStage[sid].push(t);
  }

  let firstStageId = null;
  let sortIdx = 0;
  for (const s of stagesR.recordset || []) {
    const status = sortIdx === 0 ? 'in_progress' : 'locked';
    const ins = await query(
      `INSERT INTO truck_onboarding_stages (onboarding_id, tenant_id, title, description, sort_order, stage_status)
       OUTPUT INSERTED.id VALUES (@ob, @tid, @title, @desc, @ord, @st)`,
      {
        ob: onboardingId,
        tid,
        title: get(s, 'title'),
        desc: get(s, 'description'),
        ord: get(s, 'sort_order') ?? sortIdx,
        st: status,
      }
    );
    const stageId = get(ins.recordset[0], 'id');
    if (sortIdx === 0) firstStageId = stageId;
    for (const t of tasksByTplStage[String(get(s, 'id'))] || []) {
      await query(
        `INSERT INTO truck_onboarding_tasks (onboarding_id, stage_id, tenant_id, title, sort_order, assignee)
         VALUES (@ob, @sid, @tid, @title, @ord, @asg)`,
        {
          ob: onboardingId,
          sid: stageId,
          tid,
          title: get(t, 'title'),
          ord: get(t, 'sort_order') ?? 0,
          asg: get(t, 'assignee') || 'admin',
        }
      );
    }
    sortIdx += 1;
  }
  if (firstStageId) {
    await query(
      `UPDATE truck_onboardings SET current_stage_id = @sid, status = N'in_progress', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { sid: firstStageId, id: onboardingId }
    );
  }
}

async function loadOnboardingDetail(obId, tid) {
  const obR = await query(
    `SELECT o.*, t.registration, t.fleet_no, t.make_model,
            d.full_name AS driver_full_name, d.surname AS driver_surname, d.license_number AS driver_license_number,
            c.name AS contractor_name, tpl.name AS template_name
     FROM truck_onboardings o
     LEFT JOIN contractor_trucks t ON t.id = o.truck_id
     LEFT JOIN contractor_drivers d ON d.id = o.driver_id
     LEFT JOIN contractors c ON c.id = o.contractor_id
     LEFT JOIN truck_onboarding_templates tpl ON tpl.id = o.template_id
     WHERE o.id = @id AND o.tenant_id = @tid`,
    { id: obId, tid }
  );
  const ob = obR.recordset?.[0];
  if (!ob) return null;
  const entityType = entityTypeOf(ob);

  const stagesR = await query(
    `SELECT * FROM truck_onboarding_stages WHERE onboarding_id = @id ORDER BY sort_order`,
    { id: obId }
  );
  const tasksR = await query(`SELECT * FROM truck_onboarding_tasks WHERE onboarding_id = @id ORDER BY sort_order`, { id: obId });
  const attR = await query(
    `SELECT id, stage_id, task_id, original_name, mime_type, uploader_role, created_at
     FROM truck_onboarding_attachments WHERE onboarding_id = @id ORDER BY created_at`,
    { id: obId }
  );
  const msgR = await query(
    `SELECT m.*, u.full_name AS author_name FROM truck_onboarding_messages m
     LEFT JOIN users u ON u.id = m.author_user_id
     WHERE m.onboarding_id = @id ORDER BY m.created_at`,
    { id: obId }
  );

  const tasksByStage = {};
  for (const t of tasksR.recordset || []) {
    const sid = String(get(t, 'stage_id'));
    if (!tasksByStage[sid]) tasksByStage[sid] = [];
    tasksByStage[sid].push(mapTaskFromRow(t));
  }

  const attachmentsByStage = {};
  const attachmentsByTask = {};
  const attMeta = (a) => ({
    id: get(a, 'id'),
    original_name: get(a, 'original_name'),
    mime_type: get(a, 'mime_type'),
    uploader_role: get(a, 'uploader_role'),
    created_at: get(a, 'created_at'),
  });
  for (const a of attR.recordset || []) {
    const tidAtt = get(a, 'task_id');
    if (tidAtt) {
      const key = String(tidAtt);
      if (!attachmentsByTask[key]) attachmentsByTask[key] = [];
      attachmentsByTask[key].push(attMeta(a));
    } else {
      const sid = String(get(a, 'stage_id'));
      if (!attachmentsByStage[sid]) attachmentsByStage[sid] = [];
      attachmentsByStage[sid].push(attMeta(a));
    }
  }
  for (const sid of Object.keys(tasksByStage)) {
    for (const task of tasksByStage[sid]) {
      task.attachments = attachmentsByTask[String(task.id)] || [];
    }
  }

  const stages = (stagesR.recordset || []).map((s) => ({
    id: get(s, 'id'),
    title: get(s, 'title'),
    description: get(s, 'description'),
    sort_order: get(s, 'sort_order'),
    stage_status: get(s, 'stage_status'),
    completed_at: get(s, 'completed_at'),
    is_current: String(get(s, 'id')) === String(get(ob, 'current_stage_id')),
    tasks: tasksByStage[String(get(s, 'id'))] || [],
    attachments: attachmentsByStage[String(get(s, 'id'))] || [],
  }));

  return {
    onboarding: {
      id: get(ob, 'id'),
      entity_type: entityType,
      truck_id: get(ob, 'truck_id'),
      driver_id: get(ob, 'driver_id'),
      contractor_id: get(ob, 'contractor_id'),
      status: get(ob, 'status'),
      current_stage_id: get(ob, 'current_stage_id'),
      progress_report_draft: get(ob, 'progress_report_draft'),
      registration: get(ob, 'registration'),
      fleet_no: get(ob, 'fleet_no'),
      make_model: get(ob, 'make_model'),
      driver_full_name: get(ob, 'driver_full_name'),
      driver_surname: get(ob, 'driver_surname'),
      driver_license_number: get(ob, 'driver_license_number'),
      display_label: onboardingDisplayLabel(ob),
      contractor_name: get(ob, 'contractor_name'),
      template_id: get(ob, 'template_id'),
      template_name: get(ob, 'template_name'),
      created_at: get(ob, 'created_at'),
      updated_at: get(ob, 'updated_at'),
    },
    stages,
    messages: (msgR.recordset || []).map((m) => ({
      id: get(m, 'id'),
      stage_id: get(m, 'stage_id'),
      body: get(m, 'body'),
      author_role: get(m, 'author_role'),
      author_name: get(m, 'author_name'),
      created_at: get(m, 'created_at'),
    })),
  };
}

function stageTasksComplete(tasks) {
  if (!tasks?.length) return true;
  return tasks.every((t) => taskIsFullyComplete(t));
}

/** Dashboard stats */
router.get('/dashboard', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const templates = await listTemplates(tid);
    const trucksR = await query(
      `SELECT COUNT(*) AS total FROM contractor_trucks WHERE tenant_id = @tid`,
      { tid }
    );
    const driversR = await query(
      `SELECT COUNT(*) AS total FROM contractor_drivers WHERE tenant_id = @tid`,
      { tid }
    );
    const obR = await query(
      `SELECT status, COUNT(*) AS cnt FROM truck_onboardings WHERE tenant_id = @tid GROUP BY status`,
      { tid }
    );
    const byStatus = Object.fromEntries((obR.recordset || []).map((r) => [get(r, 'status'), get(r, 'cnt')]));
    res.json({
      templates_count: templates.length,
      templates,
      trucks_total: get(trucksR.recordset[0], 'total') || 0,
      drivers_total: get(driversR.recordset[0], 'total') || 0,
      onboardings_in_progress: byStatus.in_progress || 0,
      onboardings_completed: byStatus.completed || 0,
      onboardings_total: Object.values(byStatus).reduce((a, b) => a + Number(b), 0),
    });
  } catch (e) {
    if (String(e.message).includes('truck_onboarding')) {
      return res.status(503).json({ error: 'Run npm run db:truck-onboarding' });
    }
    next(e);
  }
});

/** Onboarding maps (templates) */
router.get('/templates', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    let templates = await listTemplates(tid);
    if (!templates.length) {
      await getOrCreateActiveTemplate(tid, req.user.id);
      templates = await listTemplates(tid);
    }
    res.json({ templates });
  } catch (e) {
    next(e);
  }
});

router.post('/templates', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const name = String(req.body?.name || 'New onboarding map').trim();
    const ins = await query(
      `INSERT INTO truck_onboarding_templates (tenant_id, name, description, is_active, created_by_user_id)
       OUTPUT INSERTED.id VALUES (@tid, @name, @desc, 1, @uid)`,
      { tid, name, desc: req.body?.description || null, uid: req.user.id }
    );
    const tplId = get(ins.recordset[0], 'id');
    res.status(201).json({ template: await loadTemplateFullById(tplId, tid) });
  } catch (e) {
    next(e);
  }
});

router.get('/templates/:id', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tpl = await loadTemplateFullById(req.params.id, tenantId(req));
    if (!tpl) return res.status(404).json({ error: 'Map not found' });
    res.json({ template: tpl });
  } catch (e) {
    next(e);
  }
});

router.put('/templates/:id', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const tplId = req.params.id;
    const exists = await query(
      `SELECT id FROM truck_onboarding_templates WHERE id = @id AND tenant_id = @tid AND is_active = 1`,
      { id: tplId, tid }
    );
    if (!exists.recordset?.[0]) return res.status(404).json({ error: 'Map not found' });
    const updated = await saveTemplateById(tid, tplId, req.body || {}, req.user.id);
    res.json({ template: updated });
  } catch (e) {
    next(e);
  }
});

/** Legacy single-template endpoints */
router.get('/template', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const templates = await listTemplates(tid);
    if (templates[0]) {
      const tpl = await loadTemplateFullById(templates[0].id, tid);
      return res.json({ template: tpl });
    }
    const tpl = await loadTemplateFull(tid, true);
    res.json({ template: tpl });
  } catch (e) {
    next(e);
  }
});

router.put('/template', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const tplId = req.body?.id;
    let id = tplId;
    if (!id) {
      const tpl = await getOrCreateActiveTemplate(tid, req.user.id);
      id = get(tpl, 'id');
    }
    const updated = await saveTemplateById(tid, id, req.body || {}, req.user.id);
    res.json({ template: updated });
  } catch (e) {
    next(e);
  }
});

/** Trucks list with onboarding status */
router.get('/trucks', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const allowed = await getAllowedContractorIds(req);
    const cf = contractorFilterSql(allowed, 'tr');
    const r = await query(
      `SELECT tr.id, tr.registration, tr.fleet_no, tr.make_model, tr.contractor_id, c.name AS contractor_name,
              o.id AS onboarding_id, o.status AS onboarding_status, o.current_stage_id, o.template_id,
              tpl.name AS template_name,
              cs.title AS current_stage_title, cs.stage_status AS current_stage_status
       FROM contractor_trucks tr
       LEFT JOIN contractors c ON c.id = tr.contractor_id
       LEFT JOIN truck_onboardings o ON o.truck_id = tr.id AND o.tenant_id = tr.tenant_id
         AND (o.entity_type = N'truck' OR o.entity_type IS NULL)
       LEFT JOIN truck_onboarding_stages cs ON cs.id = o.current_stage_id
       LEFT JOIN truck_onboarding_templates tpl ON tpl.id = o.template_id
       WHERE tr.tenant_id = @tid ${cf.sql}
       ORDER BY tr.registration`,
      { tid, ...cf.params }
    );
    res.json({ trucks: r.recordset || [] });
  } catch (e) {
    next(e);
  }
});

/** Drivers list with onboarding status */
router.get('/drivers', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const allowed = await getAllowedContractorIds(req);
    const cf = contractorFilterSql(allowed, 'd');
    const r = await query(
      `SELECT d.id, d.full_name, d.surname, d.license_number, d.contractor_id, c.name AS contractor_name,
              o.id AS onboarding_id, o.status AS onboarding_status, o.current_stage_id, o.template_id,
              tpl.name AS template_name,
              cs.title AS current_stage_title, cs.stage_status AS current_stage_status
       FROM contractor_drivers d
       LEFT JOIN contractors c ON c.id = d.contractor_id
       LEFT JOIN truck_onboardings o ON o.driver_id = d.id AND o.tenant_id = d.tenant_id AND o.entity_type = N'driver'
       LEFT JOIN truck_onboarding_stages cs ON cs.id = o.current_stage_id
       LEFT JOIN truck_onboarding_templates tpl ON tpl.id = o.template_id
       WHERE d.tenant_id = @tid ${cf.sql}
       ORDER BY d.full_name, d.surname`,
      { tid, ...cf.params }
    );
    res.json({ drivers: r.recordset || [] });
  } catch (e) {
    next(e);
  }
});

async function startEntityOnboarding(req, res, { truckId, driverId, templateId }) {
  const tid = tenantId(req);
  if (!templateId) {
    return res.status(400).json({ error: 'template_id required — select an onboarding map' });
  }
  const tpl = await loadTemplateFullById(templateId, tid);
  if (!tpl?.id) return res.status(404).json({ error: 'Onboarding map not found' });
  if (!tpl.stages?.length) {
    return res.status(400).json({ error: 'This map has no stages. Add stages under Onboarding activities first.' });
  }

  if (truckId) {
    const tr = await query(`SELECT id, contractor_id FROM contractor_trucks WHERE id = @id AND tenant_id = @tid`, {
      id: truckId,
      tid,
    });
    if (!tr.recordset?.[0]) return res.status(404).json({ error: 'Truck not found' });
    const existing = await query(
      `SELECT id, status FROM truck_onboardings WHERE truck_id = @entityId AND tenant_id = @tid AND template_id = @tpl
         AND (entity_type = N'truck' OR entity_type IS NULL) AND status <> N'cancelled'`,
      { entityId: truckId, tid, tpl: templateId }
    );
    if (existing.recordset?.[0]) {
      return res.status(400).json({
        error: 'This truck already has onboarding for this map',
        onboarding_id: get(existing.recordset[0], 'id'),
      });
    }
    const ins = await query(
      `INSERT INTO truck_onboardings (tenant_id, entity_type, truck_id, contractor_id, template_id, status, started_by_user_id)
       OUTPUT INSERTED.id VALUES (@tid, N'truck', @truck, @cid, @tpl, N'in_progress', @uid)`,
      {
        tid,
        truck: truckId,
        cid: get(tr.recordset[0], 'contractor_id'),
        tpl: tpl.id,
        uid: req.user.id,
      }
    );
    const obId = get(ins.recordset[0], 'id');
    await snapshotOnboardingFromTemplate(obId, tid, tpl.id);
    return res.status(201).json(await loadOnboardingDetail(obId, tid));
  }

  const dr = await query(`SELECT id, contractor_id FROM contractor_drivers WHERE id = @id AND tenant_id = @tid`, {
    id: driverId,
    tid,
  });
  if (!dr.recordset?.[0]) return res.status(404).json({ error: 'Driver not found' });
  const existing = await query(
    `SELECT id, status FROM truck_onboardings WHERE driver_id = @entityId AND tenant_id = @tid AND template_id = @tpl
       AND entity_type = N'driver' AND status <> N'cancelled'`,
    { entityId: driverId, tid, tpl: templateId }
  );
  if (existing.recordset?.[0]) {
    return res.status(400).json({
      error: 'This driver already has onboarding for this map',
      onboarding_id: get(existing.recordset[0], 'id'),
    });
  }
  const ins = await query(
    `INSERT INTO truck_onboardings (tenant_id, entity_type, driver_id, contractor_id, template_id, status, started_by_user_id)
     OUTPUT INSERTED.id VALUES (@tid, N'driver', @driver, @cid, @tpl, N'in_progress', @uid)`,
    {
      tid,
      driver: driverId,
      cid: get(dr.recordset[0], 'contractor_id'),
      tpl: tpl.id,
      uid: req.user.id,
    }
  );
  const obId = get(ins.recordset[0], 'id');
  await snapshotOnboardingFromTemplate(obId, tid, tpl.id);
  return res.status(201).json(await loadOnboardingDetail(obId, tid));
}

router.post('/onboardings', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const truckId = req.body?.truck_id;
    const driverId = req.body?.driver_id;
    const templateId = req.body?.template_id;
    if (!truckId && !driverId) return res.status(400).json({ error: 'truck_id or driver_id required' });
    if (truckId && driverId) return res.status(400).json({ error: 'Provide truck_id or driver_id, not both' });
    await startEntityOnboarding(req, res, { truckId, driverId, templateId });
  } catch (e) {
    next(e);
  }
});

router.get('/onboardings/:id', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const detail = await loadOnboardingDetail(req.params.id, tenantId(req));
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

router.patch('/onboardings/:id', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { progress_report_draft } = req.body || {};
    await query(
      `UPDATE truck_onboardings SET progress_report_draft = @draft, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tid`,
      { id: req.params.id, tid, draft: progress_report_draft ?? null }
    );
    const detail = await loadOnboardingDetail(req.params.id, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

router.patch('/onboardings/:id/tasks/:taskId', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { admin_completed, is_completed, admin_note } = req.body || {};
    const detail = await loadOnboardingDetail(req.params.id, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    const task = detail.stages.flatMap((s) => s.tasks).find((t) => String(t.id) === String(req.params.taskId));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!['admin', 'both'].includes(task.assignee)) {
      return res.status(403).json({ error: 'Admin approval is not required for this action' });
    }
    let done;
    if (admin_completed !== undefined) done = admin_completed === true || admin_completed === 1 || admin_completed === '1';
    else done = is_completed === true || is_completed === 1 || is_completed === '1';
    await query(
      `UPDATE truck_onboarding_tasks SET
         admin_completed = @done,
         admin_note = COALESCE(@note, admin_note),
         updated_at = SYSUTCDATETIME()
       WHERE id = @taskId AND onboarding_id = @obId AND tenant_id = @tid`,
      {
        done: done ? 1 : 0,
        note: admin_note != null ? String(admin_note) : null,
        taskId: req.params.taskId,
        obId: req.params.id,
        tid,
      }
    );
    await syncTaskCompletedFlag(req.params.taskId, tid);
    res.json(await loadOnboardingDetail(req.params.id, tid));
  } catch (e) {
    next(e);
  }
});

router.post('/onboardings/:id/stages/:stageId/complete', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const obId = req.params.id;
    const stageId = req.params.stageId;
    const detail = await loadOnboardingDetail(obId, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    const stage = detail.stages.find((s) => String(s.id) === String(stageId));
    if (!stage) return res.status(404).json({ error: 'Stage not found' });
    if (stage.stage_status === 'locked') return res.status(400).json({ error: 'Stage is locked' });
    if (!stageTasksComplete(stage.tasks)) {
      return res.status(400).json({ error: 'Complete all actions in this stage before marking it done' });
    }
    await query(
      `UPDATE truck_onboarding_stages SET stage_status = N'completed', completed_at = SYSUTCDATETIME(), completed_by_user_id = @uid, updated_at = SYSUTCDATETIME()
       WHERE id = @sid AND onboarding_id = @ob`,
      { sid: stageId, ob: obId, uid: req.user.id }
    );
    const sorted = [...detail.stages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = sorted.findIndex((s) => String(s.id) === String(stageId));
    const nextStage = idx >= 0 && sorted[idx + 1]?.stage_status === 'locked' ? sorted[idx + 1] : null;
    if (nextStage) {
      await query(
        `UPDATE truck_onboarding_stages SET stage_status = N'in_progress', updated_at = SYSUTCDATETIME() WHERE id = @sid`,
        { sid: nextStage.id }
      );
      await query(
        `UPDATE truck_onboardings SET current_stage_id = @sid, updated_at = SYSUTCDATETIME() WHERE id = @ob`,
        { sid: nextStage.id, ob: obId }
      );
    } else {
      await query(
        `UPDATE truck_onboardings SET status = N'completed', completed_at = SYSUTCDATETIME(), current_stage_id = NULL, updated_at = SYSUTCDATETIME() WHERE id = @ob`,
        { ob: obId }
      );
    }
    res.json(await loadOnboardingDetail(obId, tid));
  } catch (e) {
    next(e);
  }
});

async function insertOnboardingAttachment({ obId, stageId, taskId, tid, file, userId, role }) {
  const rel = path.relative(path.join(process.cwd(), 'uploads'), file.path).replace(/\\/g, '/');
  await query(
    `INSERT INTO truck_onboarding_attachments (onboarding_id, stage_id, task_id, tenant_id, original_name, stored_path, mime_type, uploaded_by_user_id, uploader_role)
     VALUES (@ob, @sid, @taskId, @tid, @name, @path, @mime, @uid, @role)`,
    {
      ob: obId,
      sid: stageId,
      taskId: taskId || null,
      tid,
      name: file.originalname,
      path: rel,
      mime: file.mimetype,
      uid: userId,
      role,
    }
  );
}

router.post('/onboardings/:onboardingId/stages/:stageId/attachments', requireOnboardingAdminAccess, (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const tid = tenantId(req);
      await insertOnboardingAttachment({
        obId: req.params.onboardingId,
        stageId: req.params.stageId,
        taskId: null,
        tid,
        file: req.file,
        userId: req.user.id,
        role: 'admin',
      });
      res.json(await loadOnboardingDetail(req.params.onboardingId, tid));
    } catch (e) {
      next(e);
    }
  });
});

router.post('/onboardings/:onboardingId/tasks/:taskId/attachments', requireOnboardingAdminAccess, (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const tid = tenantId(req);
      const detail = await loadOnboardingDetail(req.params.onboardingId, tid);
      if (!detail) return res.status(404).json({ error: 'Not found' });
      const task = detail.stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage_id: s.id }))).find((t) => String(t.id) === String(req.params.taskId));
      if (!task) return res.status(404).json({ error: 'Action not found' });
      await insertOnboardingAttachment({
        obId: req.params.onboardingId,
        stageId: task.stage_id,
        taskId: req.params.taskId,
        tid,
        file: req.file,
        userId: req.user.id,
        role: 'admin',
      });
      res.json(await loadOnboardingDetail(req.params.onboardingId, tid));
    } catch (e) {
      next(e);
    }
  });
});

router.get('/attachments/:id/download', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const r = await query(`SELECT stored_path, tenant_id FROM truck_onboarding_attachments WHERE id = @id`, {
      id: req.params.id,
    });
    const row = r.recordset?.[0];
    if (!row || String(get(row, 'tenant_id')) !== tid) return res.status(404).json({ error: 'Not found' });
    const abs = path.join(process.cwd(), 'uploads', get(row, 'stored_path'));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    res.sendFile(abs);
  } catch (e) {
    next(e);
  }
});

router.post('/onboardings/:id/messages', requireOnboardingAdminAccess, async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message body required' });
    await query(
      `INSERT INTO truck_onboarding_messages (onboarding_id, stage_id, tenant_id, body, author_user_id, author_role)
       VALUES (@ob, @sid, @tid, @body, @uid, N'admin')`,
      {
        ob: req.params.id,
        sid: req.body.stage_id || null,
        tid,
        body,
        uid: req.user.id,
      }
    );
    res.json(await loadOnboardingDetail(req.params.id, tid));
  } catch (e) {
    next(e);
  }
});

/** Contractor portal — board + detail */
router.get('/contractor/board', requirePageAccess('contractor'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const allowed = await getAllowedContractorIds(req);
    const cf = contractorFilterSql(allowed, 'tr');
    const r = await query(
      `SELECT tr.id AS truck_id, tr.registration, tr.fleet_no, o.id AS onboarding_id, o.status,
              o.current_stage_id, s.title AS stage_title, s.stage_status, s.sort_order
       FROM contractor_trucks tr
       LEFT JOIN truck_onboardings o ON o.truck_id = tr.id AND o.tenant_id = tr.tenant_id
         AND (o.entity_type = N'truck' OR o.entity_type IS NULL)
       LEFT JOIN truck_onboarding_stages s ON s.id = o.current_stage_id
       WHERE tr.tenant_id = @tid ${cf.sql}
       ORDER BY tr.registration`,
      { tid, ...cf.params }
    );
    const cfDr = contractorFilterSql(allowed, 'd');
    const drR = await query(
      `SELECT d.id AS driver_id, d.full_name, d.surname, d.license_number, o.id AS onboarding_id, o.status,
              o.current_stage_id, s.title AS stage_title, s.stage_status, s.sort_order
       FROM contractor_drivers d
       LEFT JOIN truck_onboardings o ON o.driver_id = d.id AND o.tenant_id = d.tenant_id AND o.entity_type = N'driver'
       LEFT JOIN truck_onboarding_stages s ON s.id = o.current_stage_id
       WHERE d.tenant_id = @tid ${cfDr.sql}
       ORDER BY d.full_name, d.surname`,
      { tid, ...cfDr.params }
    );
    const onboardings = [];
    const seenOb = new Set();
    for (const row of [...(r.recordset || []), ...(drR.recordset || [])]) {
      const obId = get(row, 'onboarding_id');
      if (obId && !seenOb.has(String(obId))) {
        seenOb.add(String(obId));
        const d = await loadOnboardingDetail(obId, tid);
        if (d) onboardings.push(d);
      }
    }
    res.json({
      trucks: r.recordset || [],
      drivers: drR.recordset || [],
      onboardings,
    });
  } catch (e) {
    if (String(e.message).includes('truck_onboarding')) {
      return res.status(503).json({ error: 'Run npm run db:truck-onboarding' });
    }
    next(e);
  }
});

router.get('/contractor/onboardings/:id', requirePageAccess('contractor'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const detail = await loadOnboardingDetail(req.params.id, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    const allowed = await getAllowedContractorIds(req);
    if (allowed !== null) {
      const cid = detail.onboarding.contractor_id;
      if (!cid || !allowed.some((x) => String(x) === String(cid))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

router.patch('/contractor/onboardings/:id/tasks/:taskId', requirePageAccess('contractor'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const detail = await loadOnboardingDetail(req.params.id, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    const allowed = await getAllowedContractorIds(req);
    if (allowed !== null) {
      const cid = detail.onboarding.contractor_id;
      if (!cid || !allowed.some((x) => String(x) === String(cid))) return res.status(403).json({ error: 'Forbidden' });
    }
    const { contractor_completed, is_completed, contractor_note } = req.body || {};
    const task = detail.stages.flatMap((s) => s.tasks).find((t) => String(t.id) === String(req.params.taskId));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!['contractor', 'both'].includes(task.assignee)) {
      return res.status(403).json({ error: 'This action is assigned to onboarding admin' });
    }
    let done;
    if (contractor_completed !== undefined) {
      done = contractor_completed === true || contractor_completed === 1 || contractor_completed === '1';
    } else {
      done = is_completed === true || is_completed === 1 || is_completed === '1';
    }
    await query(
      `UPDATE truck_onboarding_tasks SET
         contractor_completed = @done,
         contractor_note = COALESCE(@note, contractor_note),
         updated_at = SYSUTCDATETIME()
       WHERE id = @taskId AND onboarding_id = @obId`,
      {
        done: done ? 1 : 0,
        note: contractor_note != null ? String(contractor_note) : null,
        taskId: req.params.taskId,
        obId: req.params.id,
      }
    );
    await syncTaskCompletedFlag(req.params.taskId, tid);
    res.json(await loadOnboardingDetail(req.params.id, tid));
  } catch (e) {
    next(e);
  }
});

router.post('/contractor/onboardings/:onboardingId/stages/:stageId/attachments', requirePageAccess('contractor'), (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const tid = tenantId(req);
      const detail = await loadOnboardingDetail(req.params.onboardingId, tid);
      if (!detail) return res.status(404).json({ error: 'Not found' });
      const allowed = await getAllowedContractorIds(req);
      if (allowed !== null) {
        const cid = detail.onboarding.contractor_id;
        if (!cid || !allowed.some((x) => String(x) === String(cid))) return res.status(403).json({ error: 'Forbidden' });
      }
      await insertOnboardingAttachment({
        obId: req.params.onboardingId,
        stageId: req.params.stageId,
        taskId: null,
        tid,
        file: req.file,
        userId: req.user.id,
        role: 'contractor',
      });
      res.json(await loadOnboardingDetail(req.params.onboardingId, tid));
    } catch (e) {
      next(e);
    }
  });
});

router.post('/contractor/onboardings/:onboardingId/tasks/:taskId/attachments', requirePageAccess('contractor'), (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const tid = tenantId(req);
      const detail = await loadOnboardingDetail(req.params.onboardingId, tid);
      if (!detail) return res.status(404).json({ error: 'Not found' });
      const allowed = await getAllowedContractorIds(req);
      if (allowed !== null) {
        const cid = detail.onboarding.contractor_id;
        if (!cid || !allowed.some((x) => String(x) === String(cid))) return res.status(403).json({ error: 'Forbidden' });
      }
      const task = detail.stages.flatMap((s) => s.tasks.map((t) => ({ ...t, stage_id: s.id }))).find((t) => String(t.id) === String(req.params.taskId));
      if (!task) return res.status(404).json({ error: 'Action not found' });
      if (!['contractor', 'both'].includes(task.assignee)) {
        return res.status(403).json({ error: 'You cannot upload for this action' });
      }
      await insertOnboardingAttachment({
        obId: req.params.onboardingId,
        stageId: task.stage_id,
        taskId: req.params.taskId,
        tid,
        file: req.file,
        userId: req.user.id,
        role: 'contractor',
      });
      res.json(await loadOnboardingDetail(req.params.onboardingId, tid));
    } catch (e) {
      next(e);
    }
  });
});

router.post('/contractor/onboardings/:id/messages', requirePageAccess('contractor'), async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const detail = await loadOnboardingDetail(req.params.id, tid);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    const allowed = await getAllowedContractorIds(req);
    if (allowed !== null) {
      const cid = detail.onboarding.contractor_id;
      if (!cid || !allowed.some((x) => String(x) === String(cid))) return res.status(403).json({ error: 'Forbidden' });
    }
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message body required' });
    await query(
      `INSERT INTO truck_onboarding_messages (onboarding_id, stage_id, tenant_id, body, author_user_id, author_role)
       VALUES (@ob, @sid, @tid, @body, @uid, N'contractor')`,
      {
        ob: req.params.id,
        sid: req.body.stage_id || null,
        tid,
        body,
        uid: req.user.id,
      }
    );
    res.json(await loadOnboardingDetail(req.params.id, tid));
  } catch (e) {
    next(e);
  }
});

export default router;
