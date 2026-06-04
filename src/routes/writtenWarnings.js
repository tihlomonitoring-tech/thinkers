/**
 * Written warnings (policy-linked) + enhanced PIP workflow.
 */
import { buildWrittenWarningPdfBuffer } from '../lib/writtenWarningPdf.js';
import { buildPipPlanPdfBuffer } from '../lib/pipPlanPdf.js';
import { loadAccountingCompanyBranding } from '../lib/accountingCompanyBranding.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

const DEFAULT_APPROACHES = `Evidence-based performance support framework:
• Collaborative SMART objectives aligned to role competencies and organisational standards
• Behaviour-specific feedback (observable conduct, not personality labelling)
• Psychological safety to surface barriers without fear of reprisal
• Progress tracked against agreed baselines with adjustable support intensity`;

const DEFAULT_INTERVENTIONS = `Recommended interventions (organisational / industrial psychology):
1. Weekly structured check-in with line management (minimum 30 minutes)
2. Targeted coaching or job aids for critical tasks where skill gaps were identified
3. Peer mentorship or buddy system for procedural adherence
4. Workload and resource review where capacity constraints affect performance
5. Referral to Employee Assistance Programme (EAP) if wellbeing factors are present
6. Formal review at weeks 4 and 8 if objectives are not achieved`;

const DEFAULT_TYPES = [
  { code: 'FIRST', title: 'First written warning', sort_order: 10 },
  { code: 'SECOND', title: 'Second written warning', sort_order: 20 },
  { code: 'FINAL', title: 'Final written warning', sort_order: 30 },
  { code: 'SERIOUS', title: 'Serious misconduct — written warning', sort_order: 40 },
];

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function mapWarning(row) {
  if (!row) return null;
  return {
    id: getRow(row, 'id'),
    tenant_id: getRow(row, 'tenant_id'),
    user_id: getRow(row, 'user_id'),
    warning_type_id: getRow(row, 'warning_type_id'),
    company_policy_id: getRow(row, 'company_policy_id'),
    reference_number: getRow(row, 'reference_number'),
    title: getRow(row, 'title'),
    incident_summary: getRow(row, 'incident_summary'),
    corrective_action: getRow(row, 'corrective_action'),
    status: getRow(row, 'status'),
    published_at: getRow(row, 'published_at'),
    published_by: getRow(row, 'published_by'),
    pip_id: getRow(row, 'pip_id'),
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
    user_name: getRow(row, 'user_name'),
    user_email: getRow(row, 'user_email'),
    issued_by_name: getRow(row, 'issued_by_name'),
    type_title: getRow(row, 'type_title'),
    policy_title: getRow(row, 'policy_title'),
    policy_reference: getRow(row, 'policy_reference'),
    signed: getRow(row, 'signed') === 1 || getRow(row, 'signed') === true,
    signed_at: getRow(row, 'signed_at'),
    signer_name: getRow(row, 'signer_name'),
  };
}

async function nextWarningRef(query, tenantId) {
  const r = await query(
    `MERGE written_warning_ref_counter AS t
     USING (SELECT @t AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { t: tenantId }
  );
  const n = r.recordset?.[0]?.last_number ?? 1;
  return `WW-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

async function ensureDefaultTypes(query, tenantId) {
  const c = await query(`SELECT COUNT(*) AS n FROM written_warning_types WHERE tenant_id = @t`, { t: tenantId });
  const n = getRow(c.recordset?.[0], 'n') ?? 0;
  if (n > 0) return;
  for (const t of DEFAULT_TYPES) {
    await query(
      `INSERT INTO written_warning_types (tenant_id, code, title, sort_order) VALUES (@t, @code, @title, @ord)`,
      { t: tenantId, code: t.code, title: t.title, ord: t.sort_order }
    );
  }
}

async function loadWarningFull(query, tenantId, id) {
  const r = await query(
    `SELECT w.*, u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name,
      wt.title AS type_title, p.title AS policy_title, p.reference_number AS policy_reference,
      CASE WHEN sig.id IS NOT NULL THEN 1 ELSE 0 END AS signed, sig.signed_at, sig.signer_name
     FROM written_warnings w
     LEFT JOIN users u ON u.id = w.user_id
     LEFT JOIN users iss ON iss.id = w.created_by
     LEFT JOIN written_warning_types wt ON wt.id = w.warning_type_id
     LEFT JOIN company_policies p ON p.id = w.company_policy_id
     LEFT JOIN written_warning_signatures sig ON sig.written_warning_id = w.id
     WHERE w.id = @id AND w.tenant_id = @t`,
    { id, t: tenantId }
  );
  return mapWarning(r.recordset?.[0]);
}

async function createAutoPip(query, warning, signedByUserId) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 56);
  const endYmd = end.toISOString().slice(0, 10);
  const startYmd = start.toISOString().slice(0, 10);
  const goals = `This Performance Improvement Plan (PIP) follows your acknowledgement of written warning ${warning.reference_number}. The purpose is rehabilitative: to restore full compliance with company policy and role standards through structured support, measurable weekly objectives, and documented progress.`;

  const ins = await query(
    `INSERT INTO performance_improvement_plans
       (tenant_id, user_id, created_by, title, goals, approaches, interventions, status, start_date, end_date, written_warning_id)
     OUTPUT INSERTED.id
     VALUES (@tenantId, @userId, @createdBy, @title, @goals, @approaches, @interventions, N'active', @startDate, @endDate, @wwId)`,
    {
      tenantId: warning.tenant_id,
      userId: warning.user_id,
      createdBy: warning.published_by || warning.created_by,
      title: `PIP — ${warning.reference_number}`,
      goals,
      approaches: DEFAULT_APPROACHES,
      interventions: DEFAULT_INTERVENTIONS,
      startDate: startYmd,
      endDate: endYmd,
      wwId: warning.id,
    }
  );
  const pipId = getRow(ins.recordset?.[0], 'id');
  await query(`UPDATE written_warnings SET pip_id = @pipId, updated_at = SYSUTCDATETIME() WHERE id = @id`, {
    pipId,
    id: warning.id,
  });
  return pipId;
}

export function registerWrittenWarningsRoutes(router, { query, canAccessTenant, requirePageAccess }) {
  // —— Warning types ——
  router.get('/written-warnings/types', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ types: [] });
      await ensureDefaultTypes(query, tenantId);
      const r = await query(
        `SELECT * FROM written_warning_types WHERE tenant_id = @t ORDER BY sort_order, title`,
        { t: tenantId }
      );
      res.json({ types: r.recordset || [] });
    } catch (e) {
      if (String(e.message).includes('written_warning')) {
        return res.status(503).json({ error: 'Run: npm run db:written-warnings-pip' });
      }
      next(e);
    }
  });

  router.post('/written-warnings/types', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const { code, title, body_template, sort_order } = req.body || {};
      if (!tenantId || !code || !title) return res.status(400).json({ error: 'code and title required' });
      await query(
        `INSERT INTO written_warning_types (tenant_id, code, title, body_template, sort_order)
         VALUES (@t, @code, @title, @body, @ord)`,
        {
          t: tenantId,
          code: String(code).trim().toUpperCase(),
          title: String(title).trim(),
          body: body_template || null,
          ord: Number(sort_order) || 100,
        }
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/written-warnings/types/:id', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const { title, body_template, sort_order, is_active } = req.body || {};
      await query(
        `UPDATE written_warning_types SET title = COALESCE(@title, title), body_template = COALESCE(@body, body_template),
         sort_order = COALESCE(@ord, sort_order), is_active = COALESCE(@active, is_active)
         WHERE id = @id AND tenant_id = @t`,
        {
          id: req.params.id,
          t: tenantId,
          title: title != null ? String(title).trim() : null,
          body: body_template,
          ord: sort_order != null ? Number(sort_order) : null,
          active: is_active != null ? (is_active ? 1 : 0) : null,
        }
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/written-warnings/policies', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const r = await query(
        `SELECT id, reference_number, title, act_or_section FROM company_policies
         WHERE tenant_id = @t AND status = N'published' ORDER BY title`,
        { t: tenantId }
      );
      res.json({ policies: r.recordset || [] });
    } catch (e) {
      if (String(e.message).includes('company_policies')) {
        return res.json({ policies: [] });
      }
      next(e);
    }
  });

  router.get('/written-warnings/all', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const r = await query(
        `SELECT w.*, u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name,
          wt.title AS type_title, p.title AS policy_title, p.reference_number AS policy_reference,
          CASE WHEN sig.id IS NOT NULL THEN 1 ELSE 0 END AS signed, sig.signed_at
         FROM written_warnings w
         LEFT JOIN users u ON u.id = w.user_id
         LEFT JOIN users iss ON iss.id = w.created_by
         LEFT JOIN written_warning_types wt ON wt.id = w.warning_type_id
         LEFT JOIN company_policies p ON p.id = w.company_policy_id
         LEFT JOIN written_warning_signatures sig ON sig.written_warning_id = w.id
         WHERE w.tenant_id = @t ORDER BY w.created_at DESC`,
        { t: tenantId }
      );
      res.json({ warnings: (r.recordset || []).map(mapWarning) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/written-warnings/mine', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const r = await query(
        `SELECT w.*, wt.title AS type_title, p.title AS policy_title, p.reference_number AS policy_reference,
          CASE WHEN sig.id IS NOT NULL THEN 1 ELSE 0 END AS signed, sig.signed_at, sig.signer_name
         FROM written_warnings w
         LEFT JOIN written_warning_types wt ON wt.id = w.warning_type_id
         LEFT JOIN company_policies p ON p.id = w.company_policy_id
         LEFT JOIN written_warning_signatures sig ON sig.written_warning_id = w.id
         WHERE w.user_id = @uid AND w.status IN (N'published', N'signed') ORDER BY w.published_at DESC`,
        { uid: req.user.id }
      );
      res.json({ warnings: (r.recordset || []).map(mapWarning) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/written-warnings/:id', async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const w = await loadWarningFull(query, tenantId, req.params.id);
      if (!w) return res.status(404).json({ error: 'Not found' });
      const isMgmt = req.user.page_roles?.includes('management') || req.user.role === 'super_admin';
      if (!isMgmt && w.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
      if (!isMgmt && w.status === 'draft') return res.status(404).json({ error: 'Not found' });
      res.json({ warning: w });
    } catch (e) {
      next(e);
    }
  });

  router.post('/written-warnings', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const { user_id, warning_type_id, company_policy_id, title, incident_summary, corrective_action } = req.body || {};
      if (!tenantId || !user_id || !company_policy_id) {
        return res.status(400).json({ error: 'user_id and company_policy_id required' });
      }
      const ref = await nextWarningRef(query, tenantId);
      const typeR = warning_type_id
        ? await query(`SELECT title FROM written_warning_types WHERE id = @id AND tenant_id = @t`, { id: warning_type_id, t: tenantId })
        : { recordset: [] };
      const typeTitle = getRow(typeR.recordset?.[0], 'title') || 'Written warning';
      const ins = await query(
        `INSERT INTO written_warnings (tenant_id, user_id, warning_type_id, company_policy_id, reference_number, title,
          incident_summary, corrective_action, status, created_by)
         OUTPUT INSERTED.id
         VALUES (@t, @uid, @wt, @pol, @ref, @title, @inc, @corr, N'draft', @by)`,
        {
          t: tenantId,
          uid: user_id,
          wt: warning_type_id || null,
          pol: company_policy_id,
          ref,
          title: (title || typeTitle).trim(),
          inc: incident_summary || null,
          corr: corrective_action || null,
          by: req.user.id,
        }
      );
      const id = getRow(ins.recordset?.[0], 'id');
      const w = await loadWarningFull(query, tenantId, id);
      res.status(201).json({ warning: w });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/written-warnings/:id', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const existing = await loadWarningFull(query, tenantId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft warnings can be edited' });
      const { warning_type_id, company_policy_id, title, incident_summary, corrective_action, user_id } = req.body || {};
      await query(
        `UPDATE written_warnings SET
          user_id = COALESCE(@uid, user_id),
          warning_type_id = COALESCE(@wt, warning_type_id),
          company_policy_id = COALESCE(@pol, company_policy_id),
          title = COALESCE(@title, title),
          incident_summary = COALESCE(@inc, incident_summary),
          corrective_action = COALESCE(@corr, corrective_action),
          updated_at = SYSUTCDATETIME()
         WHERE id = @id AND tenant_id = @t`,
        {
          id: req.params.id,
          t: tenantId,
          uid: user_id || null,
          wt: warning_type_id || null,
          pol: company_policy_id || null,
          title: title != null ? String(title).trim() : null,
          inc: incident_summary,
          corr: corrective_action,
        }
      );
      res.json({ warning: await loadWarningFull(query, tenantId, req.params.id) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/written-warnings/:id/publish', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const w = await loadWarningFull(query, tenantId, req.params.id);
      if (!w) return res.status(404).json({ error: 'Not found' });
      if (w.status !== 'draft') return res.status(400).json({ error: 'Already published' });
      await query(
        `UPDATE written_warnings SET status = N'published', published_at = SYSUTCDATETIME(), published_by = @by, updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        { id: req.params.id, by: req.user.id }
      );
      if (isEmailConfigured()) {
        const u = await query(`SELECT email, full_name FROM users WHERE id = @id`, { id: w.user_id });
        const email = getRow(u.recordset?.[0], 'email');
        if (email) {
          const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
          sendEmail({
            to: email,
            subject: `Written warning issued: ${w.reference_number}`,
            body: `<p>A formal written warning (${w.reference_number}) has been published. Sign in to Profile → Disciplinary & rewards → Written warnings to view and sign.</p><p><a href="${appUrl}/profile">Open profile</a></p>`,
            html: true,
          }).catch(() => {});
        }
      }
      res.json({ warning: await loadWarningFull(query, tenantId, req.params.id) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/written-warnings/:id/pdf', async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const w = await loadWarningFull(query, tenantId, req.params.id);
      if (!w) return res.status(404).json({ error: 'Not found' });
      const isMgmt = req.user.page_roles?.includes('management') || req.user.role === 'super_admin';
      if (!isMgmt && (w.user_id !== req.user.id || w.status === 'draft')) return res.status(403).json({ error: 'Forbidden' });

      const policyR = await query(`SELECT title, reference_number, act_or_section FROM company_policies WHERE id = @id`, {
        id: w.company_policy_id,
      });
      const policy = policyR.recordset?.[0] || {};
      const empR = await query(`SELECT full_name FROM users WHERE id = @id`, { id: w.user_id });
      const brandingTenant = w.tenant_id || tenantId;
      const { company, logoBuffer, logoPath } = await loadAccountingCompanyBranding(query, brandingTenant);
      const buf = await buildWrittenWarningPdfBuffer({
        warning: w,
        policy: {
          title: getRow(policy, 'title'),
          reference_number: getRow(policy, 'reference_number'),
          act_or_section: getRow(policy, 'act_or_section'),
        },
        company,
        logoBuffer,
        logoPath,
        typeTitle: w.type_title,
        employeeName: getRow(empR.recordset?.[0], 'full_name'),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${w.reference_number}.pdf"`);
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });

  router.post('/written-warnings/:id/sign', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const { signature_data, signer_name } = req.body || {};
      if (!signature_data) return res.status(400).json({ error: 'signature_data required' });
      const w = await loadWarningFull(query, tenantId, req.params.id);
      if (!w || w.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
      if (w.status !== 'published') return res.status(400).json({ error: 'Warning is not awaiting signature' });
      if (w.signed) return res.status(400).json({ error: 'Already signed' });

      await query(
        `INSERT INTO written_warning_signatures (written_warning_id, user_id, signature_data, signer_name)
         VALUES (@wid, @uid, @sig, @name)`,
        { wid: w.id, uid: req.user.id, sig: signature_data, name: String(signer_name || req.user.full_name || '').trim() }
      );
      await query(
        `UPDATE written_warnings SET status = N'signed', updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: w.id }
      );

      const full = { ...w, tenant_id: tenantId, status: 'signed' };
      let pipId = w.pip_id;
      if (!pipId) pipId = await createAutoPip(query, full, req.user.id);

      const pip = await query(`SELECT id, title, status FROM performance_improvement_plans WHERE id = @id`, { id: pipId });
      res.json({
        ok: true,
        pip_id: pipId,
        pip: pip.recordset?.[0],
        warning: await loadWarningFull(query, tenantId, w.id),
      });
    } catch (e) {
      next(e);
    }
  });

  // —— Enhanced PIP ——
  router.get('/pip/:id/full', async (req, res, next) => {
    try {
      const { id } = req.params;
      const pip = await query(
        `SELECT p.*, u.full_name AS user_name, w.reference_number AS written_warning_ref
         FROM performance_improvement_plans p
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN written_warnings w ON w.id = p.written_warning_id
         WHERE p.id = @id`,
        { id }
      );
      const row = pip.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'PIP not found' });
      if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      const isMgmt = req.user.page_roles?.includes('management') || req.user.role === 'super_admin';
      if (getRow(row, 'user_id') !== req.user.id && !isMgmt) return res.status(403).json({ error: 'Forbidden' });

      const objectives = await query(
        `SELECT * FROM pip_weekly_objectives WHERE pip_id = @id ORDER BY week_number, sort_order`,
        { id }
      );
      const reports = await query(
        `SELECT * FROM pip_weekly_reports WHERE pip_id = @id ORDER BY week_number DESC, created_at DESC`,
        { id }
      );
      res.json({
        plan: row,
        objectives: objectives.recordset || [],
        reports: reports.recordset || [],
      });
    } catch (e) {
      if (String(e.message).includes('pip_weekly')) {
        return res.status(503).json({ error: 'Run: npm run db:written-warnings-pip' });
      }
      next(e);
    }
  });

  router.post('/pip/:id/objectives', requirePageAccess('management'), async (req, res, next) => {
    try {
      const { week_number, week_start_date, title, description, target_outcome } = req.body || {};
      if (!week_number || !title) return res.status(400).json({ error: 'week_number and title required' });
      const pip = await query(`SELECT tenant_id FROM performance_improvement_plans WHERE id = @id`, { id: req.params.id });
      if (!pip.recordset?.[0]) return res.status(404).json({ error: 'PIP not found' });
      if (!canAccessTenant(req, getRow(pip.recordset[0], 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      await query(
        `INSERT INTO pip_weekly_objectives (pip_id, week_number, week_start_date, title, description, target_outcome, created_by)
         VALUES (@pipId, @wk, @ws, @title, @desc, @target, @by)`,
        {
          pipId: req.params.id,
          wk: Number(week_number),
          ws: week_start_date || null,
          title: String(title).trim(),
          desc: description || null,
          target: target_outcome || null,
          by: req.user.id,
        }
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/pip/:id/weekly-reports', async (req, res, next) => {
    try {
      const { week_number, objective_id, employee_response, progress_summary } = req.body || {};
      if (!week_number) return res.status(400).json({ error: 'week_number required' });
      const pip = await query(`SELECT id, user_id, tenant_id, status FROM performance_improvement_plans WHERE id = @id`, {
        id: req.params.id,
      });
      const row = pip.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'PIP not found' });
      if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      const isMgmt = req.user.page_roles?.includes('management') || req.user.role === 'super_admin';
      if (getRow(row, 'user_id') !== req.user.id && !isMgmt) return res.status(403).json({ error: 'Forbidden' });
      if (getRow(row, 'status') === 'closed' && !isMgmt) return res.status(400).json({ error: 'PIP is closed' });

      await query(
        `INSERT INTO pip_weekly_reports (pip_id, objective_id, week_number, employee_response, progress_summary, created_by)
         VALUES (@pipId, @oid, @wk, @resp, @sum, @by)`,
        {
          pipId: req.params.id,
          oid: objective_id || null,
          wk: Number(week_number),
          resp: employee_response || null,
          sum: progress_summary || null,
          by: req.user.id,
        }
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/pip/:id/management-sign', requirePageAccess('management'), async (req, res, next) => {
    try {
      const { signature_data, signer_name, approaches, interventions, goals } = req.body || {};
      const pip = await query(`SELECT tenant_id FROM performance_improvement_plans WHERE id = @id`, { id: req.params.id });
      if (!pip.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
      if (!canAccessTenant(req, getRow(pip.recordset[0], 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      await query(
        `UPDATE performance_improvement_plans SET
          management_signed_at = SYSUTCDATETIME(), management_signed_by = @by,
          management_signature_data = @sig,
          approaches = COALESCE(@app, approaches), interventions = COALESCE(@int, interventions),
          goals = COALESCE(@goals, goals)
         WHERE id = @id`,
        {
          id: req.params.id,
          by: req.user.id,
          sig: signature_data || null,
          app: approaches || null,
          int: interventions || null,
          goals: goals || null,
        }
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/pip/:id/close', requirePageAccess('management'), async (req, res, next) => {
    try {
      const pip = await query(`SELECT tenant_id, status FROM performance_improvement_plans WHERE id = @id`, { id: req.params.id });
      const row = pip.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      if (getRow(row, 'status') === 'closed') return res.status(400).json({ error: 'Already closed' });
      await query(
        `UPDATE performance_improvement_plans SET status = N'closed', closed_at = SYSUTCDATETIME(), closed_by = @by WHERE id = @id`,
        { id: req.params.id, by: req.user.id }
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/pip/:id/pdf', async (req, res, next) => {
    try {
      const { id } = req.params;
      const full = await query(
        `SELECT p.*, u.full_name AS user_name, w.reference_number AS written_warning_ref
         FROM performance_improvement_plans p
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN written_warnings w ON w.id = p.written_warning_id
         WHERE p.id = @id`,
        { id }
      );
      const plan = full.recordset?.[0];
      if (!plan) return res.status(404).json({ error: 'Not found' });
      if (!canAccessTenant(req, getRow(plan, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
      const isMgmt = req.user.page_roles?.includes('management') || req.user.role === 'super_admin';
      if (getRow(plan, 'user_id') !== req.user.id && !isMgmt) return res.status(403).json({ error: 'Forbidden' });

      const objectives = await query(`SELECT * FROM pip_weekly_objectives WHERE pip_id = @id ORDER BY week_number`, { id });
      const reports = await query(`SELECT * FROM pip_weekly_reports WHERE pip_id = @id ORDER BY week_number`, { id });
      const brandingTenant = getRow(plan, 'tenant_id') || req.user.tenant_id;
      const { company, logoBuffer, logoPath } = await loadAccountingCompanyBranding(query, brandingTenant);
      const buf = await buildPipPlanPdfBuffer({
        plan,
        objectives: objectives.recordset || [],
        reports: reports.recordset || [],
        company,
        logoBuffer,
        logoPath,
        employeeName: getRow(plan, 'user_name'),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="pip-${id}.pdf"`);
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });
}
