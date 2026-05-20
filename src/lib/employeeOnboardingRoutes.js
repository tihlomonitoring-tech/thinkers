/**
 * Employee onboarding (onboardment) API routes — mounted on profile-management router.
 */

import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { onboardingPhaseAdvancedHtml } from '../lib/emailTemplates.js';

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function appBaseUrl(req) {
  let appUrl = (process.env.FRONTEND_ORIGIN || process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (!appUrl) {
    const raw = req.get('origin') || req.get('referer') || '';
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const u = new URL(raw);
        appUrl = `${u.protocol}//${u.host}`;
      } catch (_) {}
    }
  }
  return appUrl || 'http://localhost:5173';
}

function safeResolveOnboardingFile(relPath, uploadsBase) {
  if (!relPath) return null;
  const root = path.join(uploadsBase, 'onboarding');
  const full = path.join(process.cwd(), String(relPath).replace(/^[/\\]+/, ''));
  if (!full.startsWith(root)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

async function getPlanForTenant(planId, tenantId) {
  const r = await query(
    `SELECT p.*, u.full_name AS employee_name, u.email AS employee_email
     FROM employee_onboarding_plans p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = @id AND p.tenant_id = @tenantId`,
    { id: planId, tenantId }
  );
  return r.recordset?.[0] || null;
}

async function getPhasesForPlan(planId) {
  const r = await query(
    `SELECT id, plan_id, title, description, sort_order, phase_status, completed_at, created_at, updated_at
     FROM employee_onboarding_phases WHERE plan_id = @planId ORDER BY sort_order ASC, created_at ASC`,
    { planId }
  );
  return r.recordset || [];
}

async function getAttachmentsForPhase(phaseId) {
  const r = await query(
    `SELECT id, phase_id, original_name, mime_type, created_at FROM employee_onboarding_phase_attachments WHERE phase_id = @phaseId ORDER BY created_at`,
    { phaseId }
  );
  return r.recordset || [];
}

async function sendPhaseAdvanceEmail(req, planRow, phaseRow) {
  const email = getRow(planRow, 'employee_email');
  if (!email || !isEmailConfigured()) return;
  const html = onboardingPhaseAdvancedHtml({
    employeeName: getRow(planRow, 'employee_name'),
    planTitle: getRow(planRow, 'title'),
    phaseTitle: getRow(phaseRow, 'title'),
    phaseDescription: getRow(phaseRow, 'description'),
    appUrl: `${appBaseUrl(req)}/profile?tab=employee_onboardment`,
  });
  await sendEmail({
    to: email,
    subject: `Onboardment: ${getRow(phaseRow, 'title')} — ${getRow(planRow, 'title')}`,
    body: html,
    html: true,
  }).catch((e) => console.error('[onboarding] phase email:', e?.message));
}

function canManageOnboarding(req) {
  return req.user?.role === 'super_admin' || (req.user?.page_roles || []).includes('management');
}

function canAccessPlanAsEmployee(req, planRow) {
  return getRow(planRow, 'user_id') === req.user.id;
}

export function registerEmployeeOnboardingRoutes(router, { uploadsBase, canAccessTenant }) {
  const onboardingUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const tenantId = req.user?.tenant_id || 'unknown';
        const phaseId = req.params.phaseId || 'misc';
        const dir = path.join(uploadsBase, 'onboarding', String(tenantId), String(phaseId));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
  }).single('file');

  /** Profile: my onboardment plan */
  router.get('/onboarding/my', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const result = await query(
        `SELECT TOP 1 p.id, p.title, p.plan_notes, p.status, p.current_phase_id, p.start_date, p.created_at, p.updated_at
         FROM employee_onboarding_plans p
         WHERE p.tenant_id = @tenantId AND p.user_id = @userId AND p.status = N'active'
         ORDER BY p.created_at DESC`,
        { tenantId, userId: req.user.id }
      );
      const plan = result.recordset?.[0];
      if (!plan) return res.json({ plan: null, phases: [] });
      const planId = getRow(plan, 'id');
      const phases = await getPhasesForPlan(planId);
      const phasesOut = [];
      for (const ph of phases) {
        const att = await getAttachmentsForPhase(getRow(ph, 'id'));
        phasesOut.push({
          id: getRow(ph, 'id'),
          title: getRow(ph, 'title'),
          description: getRow(ph, 'description'),
          sort_order: getRow(ph, 'sort_order'),
          phase_status: getRow(ph, 'phase_status'),
          completed_at: getRow(ph, 'completed_at'),
          is_current: getRow(ph, 'id') === getRow(plan, 'current_phase_id'),
          attachments: att.map((a) => ({
            id: getRow(a, 'id'),
            original_name: getRow(a, 'original_name'),
            mime_type: getRow(a, 'mime_type'),
            created_at: getRow(a, 'created_at'),
          })),
        });
      }
      res.json({
        plan: {
          id: planId,
          title: getRow(plan, 'title'),
          plan_notes: getRow(plan, 'plan_notes'),
          status: getRow(plan, 'status'),
          current_phase_id: getRow(plan, 'current_phase_id'),
          start_date: getRow(plan, 'start_date'),
          created_at: getRow(plan, 'created_at'),
        },
        phases: phasesOut,
      });
    } catch (err) {
      if (String(err?.message || '').includes('employee_onboarding')) {
        return res.status(503).json({ error: 'Onboardment tables are not installed. Run: npm run db:employee-onboardment' });
      }
      next(err);
    }
  });

  router.get('/onboarding/my/phases/:phaseId/journal', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const { phaseId } = req.params;
      const phaseR = await query(`SELECT plan_id, phase_status FROM employee_onboarding_phases WHERE id = @id`, { id: phaseId });
      const phase = phaseR.recordset?.[0];
      if (!phase) return res.status(404).json({ error: 'Phase not found' });
      const plan = await query(
        `SELECT id, user_id, tenant_id FROM employee_onboarding_plans WHERE id = @id`,
        { id: getRow(phase, 'plan_id') }
      );
      const planRow = plan.recordset?.[0];
      if (!planRow || getRow(planRow, 'user_id') !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      const entries = await query(
        `SELECT id, entry_status, body, created_at, updated_at, published_at
         FROM employee_onboarding_journal_entries
         WHERE phase_id = @phaseId AND user_id = @userId
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC`,
        { phaseId, userId: req.user.id }
      );
      res.json({ entries: entries.recordset || [], phase_status: getRow(phase, 'phase_status') });
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/my/phases/:phaseId/journal', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const { phaseId } = req.params;
      const { body, publish } = req.body || {};
      const text = String(body || '').trim();
      if (!text) return res.status(400).json({ error: 'Journal text is required' });
      const phaseR = await query(
        `SELECT ph.id, ph.plan_id, ph.phase_status, p.user_id, p.tenant_id, p.current_phase_id
         FROM employee_onboarding_phases ph
         JOIN employee_onboarding_plans p ON p.id = ph.plan_id
         WHERE ph.id = @id`,
        { id: phaseId }
      );
      const row = phaseR.recordset?.[0];
      if (!row || getRow(row, 'user_id') !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      const curId = getRow(row, 'current_phase_id');
      if (curId !== phaseId && getRow(row, 'phase_status') !== 'completed') {
        return res.status(400).json({ error: 'You can only add journal entries for your current or completed phases' });
      }
      const status = publish ? 'published' : 'draft';
      const ins = await query(
        `INSERT INTO employee_onboarding_journal_entries (plan_id, phase_id, tenant_id, user_id, entry_status, body, published_at)
         OUTPUT INSERTED.id, INSERTED.created_at, INSERTED.updated_at, INSERTED.published_at
         VALUES (@planId, @phaseId, @tenantId, @userId, @status, @body, @pubAt)`,
        {
          planId: getRow(row, 'plan_id'),
          phaseId,
          tenantId: getRow(row, 'tenant_id'),
          userId: req.user.id,
          status,
          body: text,
          pubAt: publish ? new Date().toISOString() : null,
        }
      );
      const created = ins.recordset?.[0];
      res.status(201).json({
        entry: {
          id: getRow(created, 'id'),
          entry_status: status,
          body: text,
          created_at: getRow(created, 'created_at'),
          updated_at: getRow(created, 'updated_at'),
          published_at: getRow(created, 'published_at'),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/onboarding/my/journal/:entryId', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const { entryId } = req.params;
      const { body, publish } = req.body || {};
      const existing = await query(
        `SELECT e.id, e.user_id, e.entry_status, e.phase_id FROM employee_onboarding_journal_entries e WHERE e.id = @id`,
        { id: entryId }
      );
      const row = existing.recordset?.[0];
      if (!row || getRow(row, 'user_id') !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      const text = body != null ? String(body).trim() : null;
      if (text !== null && !text) return res.status(400).json({ error: 'Journal text cannot be empty' });
      const newStatus = publish === true ? 'published' : publish === false ? 'draft' : getRow(row, 'entry_status');
      await query(
        `UPDATE employee_onboarding_journal_entries SET
           body = COALESCE(@body, body),
           entry_status = @status,
           published_at = CASE WHEN @status = N'published' AND published_at IS NULL THEN SYSUTCDATETIME() ELSE published_at END,
           updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        { id: entryId, body: text, status: newStatus }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /** Management: list plans */
  router.get('/onboarding/plans', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const result = await query(
        `SELECT p.id, p.user_id, p.title, p.status, p.start_date, p.current_phase_id, p.created_at,
                u.full_name AS employee_name, u.email AS employee_email,
                (SELECT COUNT(*) FROM employee_onboarding_phases ph WHERE ph.plan_id = p.id) AS phase_count
         FROM employee_onboarding_plans p
         JOIN users u ON u.id = p.user_id
         WHERE p.tenant_id = @tenantId
         ORDER BY p.created_at DESC`,
        { tenantId }
      );
      res.json({ plans: result.recordset || [] });
    } catch (err) {
      if (String(err?.message || '').includes('employee_onboarding')) {
        return res.status(503).json({ error: 'Onboardment tables are not installed. Run: npm run db:employee-onboardment' });
      }
      next(err);
    }
  });

  router.get('/onboarding/plans/:id', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const planRow = await getPlanForTenant(req.params.id, tenantId);
      if (!planRow) return res.status(404).json({ error: 'Plan not found' });
      const phases = await getPhasesForPlan(req.params.id);
      const phasesOut = [];
      for (const ph of phases) {
        const att = await getAttachmentsForPhase(getRow(ph, 'id'));
        phasesOut.push({
          id: getRow(ph, 'id'),
          title: getRow(ph, 'title'),
          description: getRow(ph, 'description'),
          sort_order: getRow(ph, 'sort_order'),
          phase_status: getRow(ph, 'phase_status'),
          completed_at: getRow(ph, 'completed_at'),
          attachments: att.map((a) => ({
            id: getRow(a, 'id'),
            original_name: getRow(a, 'original_name'),
            mime_type: getRow(a, 'mime_type'),
            created_at: getRow(a, 'created_at'),
          })),
        });
      }
      res.json({
        plan: {
          id: getRow(planRow, 'id'),
          user_id: getRow(planRow, 'user_id'),
          employee_name: getRow(planRow, 'employee_name'),
          employee_email: getRow(planRow, 'employee_email'),
          title: getRow(planRow, 'title'),
          plan_notes: getRow(planRow, 'plan_notes'),
          status: getRow(planRow, 'status'),
          current_phase_id: getRow(planRow, 'current_phase_id'),
          start_date: getRow(planRow, 'start_date'),
        },
        phases: phasesOut,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/onboarding/plans/:id/journals', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const planRow = await getPlanForTenant(req.params.id, tenantId);
      if (!planRow) return res.status(404).json({ error: 'Plan not found' });
      const result = await query(
        `SELECT j.id, j.phase_id, j.entry_status, j.body, j.created_at, j.updated_at, j.published_at,
                ph.title AS phase_title, u.full_name AS author_name
         FROM employee_onboarding_journal_entries j
         JOIN employee_onboarding_phases ph ON ph.id = j.phase_id
         JOIN users u ON u.id = j.user_id
         WHERE j.plan_id = @planId
         ORDER BY j.created_at DESC`,
        { planId: req.params.id }
      );
      res.json({ entries: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/plans', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const { user_id, title, plan_notes, start_date, phases } = req.body || {};
      if (!user_id || !title) return res.status(400).json({ error: 'Employee and plan title are required' });
      const phaseList = Array.isArray(phases) ? phases : [];
      if (phaseList.length === 0) return res.status(400).json({ error: 'Add at least one onboardment phase' });

      const ins = await query(
        `INSERT INTO employee_onboarding_plans (tenant_id, user_id, title, plan_notes, start_date, created_by_user_id, status)
         OUTPUT INSERTED.id VALUES (@tenantId, @userId, @title, @notes, @startDate, @createdBy, N'active')`,
        {
          tenantId,
          userId: user_id,
          title: String(title).trim(),
          notes: plan_notes ? String(plan_notes).trim() : null,
          startDate: start_date || null,
          createdBy: req.user.id,
        }
      );
      const planId = getRow(ins.recordset?.[0], 'id');
      let firstPhaseId = null;
      for (let i = 0; i < phaseList.length; i++) {
        const ph = phaseList[i];
        const pStatus = i === 0 ? 'in_progress' : 'pending';
        const pIns = await query(
          `INSERT INTO employee_onboarding_phases (plan_id, tenant_id, title, description, sort_order, phase_status)
           OUTPUT INSERTED.id VALUES (@planId, @tenantId, @title, @desc, @ord, @status)`,
          {
            planId,
            tenantId,
            title: String(ph.title || `Phase ${i + 1}`).trim(),
            desc: ph.description ? String(ph.description).trim() : null,
            ord: i,
            status: pStatus,
          }
        );
        const pid = getRow(pIns.recordset?.[0], 'id');
        if (i === 0) firstPhaseId = pid;
      }
      await query(
        `UPDATE employee_onboarding_plans SET current_phase_id = @phaseId, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: planId, phaseId: firstPhaseId }
      );

      const planRow = await getPlanForTenant(planId, tenantId);
      const firstPhase = (await getPhasesForPlan(planId))[0];
      if (planRow && firstPhase) await sendPhaseAdvanceEmail(req, planRow, firstPhase);

      res.status(201).json({ plan: { id: planId } });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/onboarding/phases/:phaseId', requirePageAccess('management'), async (req, res, next) => {
    try {
      const { phaseId } = req.params;
      const { title, description, phase_status } = req.body || {};
      const ph = await query(
        `SELECT ph.id, ph.plan_id, ph.tenant_id FROM employee_onboarding_phases ph WHERE ph.id = @id`,
        { id: phaseId }
      );
      const row = ph.recordset?.[0];
      if (!row || !canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(404).json({ error: 'Not found' });
      const updates = [];
      const params = { id: phaseId };
      if (title !== undefined) { updates.push('title = @title'); params.title = String(title).trim(); }
      if (description !== undefined) { updates.push('description = @description'); params.description = description ? String(description).trim() : null; }
      if (phase_status !== undefined) {
        updates.push('phase_status = @phase_status');
        params.phase_status = phase_status;
        if (phase_status === 'completed') updates.push('completed_at = SYSUTCDATETIME()');
      }
      if (updates.length === 0) return res.json({ ok: true });
      updates.push('updated_at = SYSUTCDATETIME()');
      await query(`UPDATE employee_onboarding_phases SET ${updates.join(', ')} WHERE id = @id`, params);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/plans/:id/advance', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const planId = req.params.id;
      const planRow = await getPlanForTenant(planId, tenantId);
      if (!planRow) return res.status(404).json({ error: 'Plan not found' });
      const phases = await getPhasesForPlan(planId);
      const currentId = getRow(planRow, 'current_phase_id');
      const currentIdx = phases.findIndex((p) => getRow(p, 'id') === currentId);
      if (currentIdx < 0) return res.status(400).json({ error: 'No current phase set' });

      await query(
        `UPDATE employee_onboarding_phases SET phase_status = N'completed', completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: currentId }
      );

      const nextPhase = phases[currentIdx + 1];
      if (!nextPhase) {
        await query(
          `UPDATE employee_onboarding_plans SET status = N'completed', current_phase_id = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
          { id: planId }
        );
        return res.json({ ok: true, completed: true, message: 'Onboardment plan completed' });
      }

      const nextId = getRow(nextPhase, 'id');
      await query(
        `UPDATE employee_onboarding_phases SET phase_status = N'in_progress', updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: nextId }
      );
      await query(
        `UPDATE employee_onboarding_plans SET current_phase_id = @phaseId, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: planId, phaseId: nextId }
      );

      const refreshed = await getPlanForTenant(planId, tenantId);
      const nextRow = (await getPhasesForPlan(planId)).find((p) => getRow(p, 'id') === nextId);
      if (refreshed && nextRow) await sendPhaseAdvanceEmail(req, refreshed, nextRow);

      res.json({ ok: true, next_phase_id: nextId });
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/phases/:phaseId/attachments', requirePageAccess('management'), onboardingUpload, async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'File required' });
      const { phaseId } = req.params;
      const ph = await query(`SELECT tenant_id, plan_id FROM employee_onboarding_phases WHERE id = @id`, { id: phaseId });
      const row = ph.recordset?.[0];
      if (!row || !canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(404).json({ error: 'Phase not found' });
      const rel = path.relative(process.cwd(), req.file.path).split(path.sep).join('/');
      const ins = await query(
        `INSERT INTO employee_onboarding_phase_attachments (phase_id, tenant_id, original_name, stored_path, mime_type, uploaded_by_user_id)
         OUTPUT INSERTED.id, INSERTED.original_name, INSERTED.created_at
         VALUES (@phaseId, @tenantId, @name, @path, @mime, @uid)`,
        {
          phaseId,
          tenantId: getRow(row, 'tenant_id'),
          name: req.file.originalname,
          path: rel,
          mime: req.file.mimetype,
          uid: req.user.id,
        }
      );
      res.status(201).json({ attachment: ins.recordset?.[0] });
    } catch (err) {
      next(err);
    }
  });

  router.get('/onboarding/attachments/:id/download', async (req, res, next) => {
    try {
      const att = await query(
        `SELECT a.stored_path, a.tenant_id, p.user_id AS plan_user_id
         FROM employee_onboarding_phase_attachments a
         JOIN employee_onboarding_phases ph ON ph.id = a.phase_id
         JOIN employee_onboarding_plans p ON p.id = ph.plan_id
         WHERE a.id = @id`,
        { id: req.params.id }
      );
      const row = att.recordset?.[0];
      if (!row || !canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(404).json({ error: 'Not found' });
      if (!canManageOnboarding(req) && getRow(row, 'plan_user_id') !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const full = safeResolveOnboardingFile(getRow(row, 'stored_path'), uploadsBase);
      if (!full) return res.status(404).json({ error: 'File missing' });
      res.sendFile(full);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/onboarding/attachments/:id', requirePageAccess('management'), async (req, res, next) => {
    try {
      const att = await query(
        `SELECT stored_path, tenant_id FROM employee_onboarding_phase_attachments WHERE id = @id`,
        { id: req.params.id }
      );
      const row = att.recordset?.[0];
      if (!row || !canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(404).json({ error: 'Not found' });
      const full = safeResolveOnboardingFile(getRow(row, 'stored_path'), uploadsBase);
      if (full) fs.unlinkSync(full);
      await query(`DELETE FROM employee_onboarding_phase_attachments WHERE id = @id`, { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}
