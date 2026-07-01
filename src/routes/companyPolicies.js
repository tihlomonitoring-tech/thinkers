/**
 * Company policies — development (draft/publish) and employee acknowledgement.
 */
import { Router } from 'express';
import { query } from '../db.js';
import { loadAccountingCompanyBranding } from '../lib/accountingCompanyBranding.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import {
  buildCompanyPolicyPdfBuffer,
  mapPolicyRow,
  mapSectionRow,
} from '../lib/companyPolicyPdf.js';
import { seedGovernmentLabourPoliciesForTenant } from '../lib/governmentLabourPolicySeeds.js';

const router = Router();

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : null;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

async function nextReference(tenant) {
  const r = await query(
    `MERGE company_policy_ref_counter AS t
     USING (SELECT @t AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { t: tenant }
  );
  const n = r.recordset?.[0]?.last_number ?? r.recordset?.[0]?.Last_number ?? 1;
  const year = new Date().getFullYear();
  return `POL-${year}-${String(n).padStart(4, '0')}`;
}

async function loadPolicyFull(tenant, id) {
  const pr = await query(
    `SELECT p.*, pub.full_name AS published_by_name, cr.full_name AS created_by_name
     FROM company_policies p
     LEFT JOIN users pub ON pub.id = p.published_by_user_id
     LEFT JOIN users cr ON cr.id = p.created_by_user_id
     WHERE p.id = @id AND p.tenant_id = @t`,
    { id, t: tenant }
  );
  const policy = mapPolicyRow(pr.recordset?.[0]);
  if (!policy) return null;
  const sr = await query(
    `SELECT * FROM company_policy_sections WHERE policy_id = @id ORDER BY sort_order, section_number`,
    { id }
  );
  policy.sections = (sr.recordset || []).map(mapSectionRow);
  return policy;
}

async function streamPolicyPdf(res, policy, sections, tenantId, watermark) {
  let company = { company_name: 'Company' };
  let logoBuffer = null;
  let logoPath = null;
  const brandingTenant = policy?.tenant_id || tenantId;
  try {
    ({ company, logoBuffer, logoPath } = await loadAccountingCompanyBranding(query, brandingTenant));
  } catch {
    /* use defaults */
  }
  const buf = await buildCompanyPolicyPdfBuffer({
    policy,
    sections,
    company,
    logoBuffer,
    logoPath,
    watermark,
  });
  const safeRef = String(policy.reference_number || 'policy').replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeRef}-v${policy.version || 1}.pdf"`);
  res.send(buf);
}

// ——— Policy development (authors) ———
const devRouter = Router();
devRouter.use(requirePageAccess('policy_development'));

devRouter.post('/seed-government-labour', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const result = await seedGovernmentLabourPoliciesForTenant(t, req.user.id, query);
    res.json({
      message: 'Government labour policy drafts loaded. Open each bill to review, edit, and publish.',
      ...result,
    });
  } catch (e) {
    if (String(e.message).includes('company_policies')) {
      return res.status(503).json({ error: 'Run: npm run db:company-policies' });
    }
    next(e);
  }
});

devRouter.get('/policies', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const status = req.query.status ? String(req.query.status) : null;
    let sql = `SELECT p.*, pub.full_name AS published_by_name, cr.full_name AS created_by_name
               FROM company_policies p
               LEFT JOIN users pub ON pub.id = p.published_by_user_id
               LEFT JOIN users cr ON cr.id = p.created_by_user_id
               WHERE p.tenant_id = @t`;
    const params = { t };
    if (status) {
      sql += ` AND p.status = @status`;
      params.status = status;
    }
    sql += ` ORDER BY p.updated_at DESC`;
    const r = await query(sql, params);
    res.json({ policies: (r.recordset || []).map(mapPolicyRow) });
  } catch (e) {
    if (String(e.message).includes('company_policies')) {
      return res.status(503).json({ error: 'Run: npm run db:company-policies' });
    }
    next(e);
  }
});

devRouter.get('/policies/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    const ackCount = await query(
      `SELECT COUNT(*) AS cnt FROM company_policy_acknowledgements WHERE policy_id = @id AND policy_version = @v`,
      { id: req.params.id, v: policy.version }
    );
    policy.acknowledgement_count = Number(get(ackCount.recordset?.[0], 'cnt')) || 0;
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.post('/policies', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const act = String(body.act_or_section || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!act) return res.status(400).json({ error: 'Act or Section is required' });

    const ref = body.reference_number?.trim() || (await nextReference(t));
    const ins = await query(
      `INSERT INTO company_policies (
        tenant_id, reference_number, title, act_or_section, summary, policy_type, classification,
        department_name, status, version, effective_date, requires_acknowledgement,
        created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @t, @ref, @title, @act, @summary, @ptype, @class, @dept, N'draft', 0, @eff, @ack,
        @uid, @uid
      )`,
      {
        t,
        ref,
        title,
        act,
        summary: body.summary || null,
        ptype: body.policy_type || 'policy',
        class: body.classification || 'internal',
        dept: body.department_name || null,
        eff: body.effective_date || null,
        ack: body.requires_acknowledgement === false ? 0 : 1,
        uid: req.user.id,
      }
    );
    const id = get(ins.recordset?.[0], 'id');
    const policy = await loadPolicyFull(t, id);
    res.status(201).json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.patch('/policies/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const existing = await loadPolicyFull(t, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Policy not found' });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft policies can be edited. Duplicate to create a new draft.' });
    }
    const body = req.body || {};
    await query(
      `UPDATE company_policies SET
        title = COALESCE(@title, title),
        act_or_section = COALESCE(@act, act_or_section),
        summary = @summary,
        policy_type = COALESCE(@ptype, policy_type),
        classification = COALESCE(@class, classification),
        department_name = @dept,
        effective_date = @eff,
        requires_acknowledgement = @ack,
        updated_by_user_id = @uid,
        updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @t`,
      {
        id: req.params.id,
        t,
        title: body.title != null ? String(body.title).trim() : null,
        act: body.act_or_section != null ? String(body.act_or_section).trim() : null,
        summary: body.summary !== undefined ? body.summary : existing.summary,
        ptype: body.policy_type || null,
        class: body.classification || null,
        dept: body.department_name !== undefined ? body.department_name : existing.department_name,
        eff: body.effective_date !== undefined ? body.effective_date : existing.effective_date,
        ack: body.requires_acknowledgement === false ? 0 : body.requires_acknowledgement === true ? 1 : null,
        uid: req.user.id,
      }
    );
    const policy = await loadPolicyFull(t, req.params.id);
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.put('/policies/:id/sections', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const existing = await loadPolicyFull(t, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Policy not found' });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Sections can only be edited on draft policies' });
    }
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    await query(`DELETE FROM company_policy_sections WHERE policy_id = @id`, { id: req.params.id });
    let order = 0;
    for (const s of sections) {
      const title = String(s.title || '').trim();
      if (!title) continue;
      await query(
        `INSERT INTO company_policy_sections (policy_id, section_number, title, body, sort_order)
         VALUES (@pid, @num, @title, @body, @ord)`,
        {
          pid: req.params.id,
          num: String(s.section_number || order + 1).trim(),
          title,
          body: s.body || '',
          ord: s.sort_order != null ? Number(s.sort_order) : order,
        }
      );
      order += 1;
    }
    await query(
      `UPDATE company_policies SET updated_by_user_id = @uid, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, uid: req.user.id }
    );
    const policy = await loadPolicyFull(t, req.params.id);
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.post('/policies/:id/publish', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const existing = await loadPolicyFull(t, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Policy not found' });
    if (!existing.sections?.length) {
      return res.status(400).json({ error: 'Add at least one section before publishing' });
    }
    if (!existing.act_or_section?.trim()) {
      return res.status(400).json({ error: 'Act or Section is required' });
    }

    const newVersion = existing.status === 'published' ? (existing.version || 1) + 1 : Math.max(1, (existing.version || 0) + 1);
    const eff = req.body?.effective_date || existing.effective_date || new Date().toISOString().slice(0, 10);

    await query(
      `UPDATE company_policies SET
        status = N'published', version = @ver, effective_date = @eff,
        published_at = SYSUTCDATETIME(), published_by_user_id = @uid,
        updated_by_user_id = @uid, updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @t`,
      { id: req.params.id, t, ver: newVersion, eff, uid: req.user.id }
    );
    const policy = await loadPolicyFull(t, req.params.id);
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.post('/policies/:id/archive', async (req, res, next) => {
  try {
    const t = tenantId(req);
    await query(
      `UPDATE company_policies SET status = N'archived', updated_by_user_id = @uid, updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @t`,
      { id: req.params.id, t, uid: req.user.id }
    );
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.post('/policies/:id/duplicate', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const src = await loadPolicyFull(t, req.params.id);
    if (!src) return res.status(404).json({ error: 'Policy not found' });
    const ref = await nextReference(t);
    const ins = await query(
      `INSERT INTO company_policies (
        tenant_id, reference_number, title, act_or_section, summary, policy_type, classification,
        department_name, status, version, effective_date, requires_acknowledgement,
        created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @t, @ref, @title, @act, @summary, @ptype, @class, @dept, N'draft', 0, @eff, @ack, @uid, @uid
      )`,
      {
        t,
        ref,
        title: `${src.title} (copy)`,
        act: src.act_or_section,
        summary: src.summary,
        ptype: src.policy_type,
        class: src.classification,
        dept: src.department_name,
        eff: src.effective_date,
        ack: src.requires_acknowledgement ? 1 : 0,
        uid: req.user.id,
      }
    );
    const newId = get(ins.recordset?.[0], 'id');
    for (const s of src.sections || []) {
      await query(
        `INSERT INTO company_policy_sections (policy_id, section_number, title, body, sort_order)
         VALUES (@pid, @num, @title, @body, @ord)`,
        {
          pid: newId,
          num: s.section_number,
          title: s.title,
          body: s.body,
          ord: s.sort_order,
        }
      );
    }
    const policy = await loadPolicyFull(t, newId);
    res.status(201).json({ policy });
  } catch (e) {
    next(e);
  }
});

devRouter.delete('/policies/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const existing = await loadPolicyFull(t, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Policy not found' });
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft policies can be deleted. Archive published policies instead.' });
    }
    await query(`DELETE FROM company_policies WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

devRouter.get('/policies/:id/pdf', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    const watermark = policy.status === 'draft' ? 'DRAFT' : null;
    await streamPolicyPdf(res, policy, policy.sections, t, watermark);
  } catch (e) {
    next(e);
  }
});

// ——— Employee / profile ———
const employeeRouter = Router();
employeeRouter.use(requirePageAccess(['profile', 'operator_profile']));

employeeRouter.get('/published', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const uid = req.user.id;
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT p.*, pub.full_name AS published_by_name,
        CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS acknowledged,
        a.signed_at AS acknowledged_at
       FROM company_policies p
       LEFT JOIN users pub ON pub.id = p.published_by_user_id
       LEFT JOIN company_policy_acknowledgements a
         ON a.policy_id = p.id AND a.user_id = @uid AND a.policy_version = p.version
       WHERE p.tenant_id = @t AND p.status = N'published'
       ORDER BY p.published_at DESC`,
      { t, uid }
    );
    const policies = (r.recordset || []).map((row) => {
      const p = mapPolicyRow(row);
      p.acknowledged = get(row, 'acknowledged') === 1 || get(row, 'acknowledged') === true;
      p.acknowledged_at = get(row, 'acknowledged_at');
      const pub = p.published_at ? new Date(p.published_at) : null;
      p.is_new =
        !p.acknowledged &&
        pub &&
        Date.now() - pub.getTime() < 30 * 24 * 60 * 60 * 1000;
      return p;
    });
    const pending = policies.filter((p) => p.requires_acknowledgement && !p.acknowledged).length;
    res.json({ policies, pending_acknowledgements: pending });
  } catch (e) {
    if (String(e.message).includes('company_policies')) {
      return res.status(503).json({ error: 'Run: npm run db:company-policies' });
    }
    next(e);
  }
});

employeeRouter.get('/published/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const uid = req.user.id;
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy || policy.status !== 'published') {
      return res.status(404).json({ error: 'Published policy not found' });
    }
    const ar = await query(
      `SELECT * FROM company_policy_acknowledgements
       WHERE policy_id = @id AND user_id = @uid AND policy_version = @v`,
      { id: req.params.id, uid, v: policy.version }
    );
    const ack = ar.recordset?.[0];
    policy.acknowledged = !!ack;
    policy.acknowledged_at = ack ? get(ack, 'signed_at') : null;
    policy.signer_name = ack ? get(ack, 'signer_name') : null;
    res.json({ policy });
  } catch (e) {
    next(e);
  }
});

employeeRouter.get('/published/:id/pdf', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy || policy.status !== 'published') {
      return res.status(404).json({ error: 'Published policy not found' });
    }
    await streamPolicyPdf(res, policy, policy.sections, t, null);
  } catch (e) {
    next(e);
  }
});

employeeRouter.post('/published/:id/acknowledge', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const uid = req.user.id;
    const policy = await loadPolicyFull(t, req.params.id);
    if (!policy || policy.status !== 'published') {
      return res.status(404).json({ error: 'Published policy not found' });
    }
    if (!policy.requires_acknowledgement) {
      return res.status(400).json({ error: 'This policy does not require acknowledgement' });
    }
    const signature = String(req.body?.signature_data || '').trim();
    const signerName = String(req.body?.signer_name || req.user.full_name || '').trim();
    if (!signature.startsWith('data:image')) {
      return res.status(400).json({ error: 'Signature is required' });
    }
    if (!signerName) return res.status(400).json({ error: 'Signer name is required' });

    const existing = await query(
      `SELECT id FROM company_policy_acknowledgements
       WHERE policy_id = @id AND user_id = @uid AND policy_version = @v`,
      { id: req.params.id, uid, v: policy.version }
    );
    if (existing.recordset?.[0]) {
      return res.status(400).json({ error: 'You have already acknowledged this policy version' });
    }

    await query(
      `INSERT INTO company_policy_acknowledgements (tenant_id, policy_id, user_id, policy_version, signer_name, signature_data)
       VALUES (@t, @pid, @uid, @ver, @name, @sig)`,
      {
        t,
        pid: req.params.id,
        uid,
        ver: policy.version,
        name: signerName,
        sig: signature,
      }
    );
    res.json({ ok: true, acknowledged_at: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

router.get('/ping', (req, res) => res.json({ ok: true, feature: 'company-policies' }));

router.use(requireAuth, loadUser);
router.use('/development', devRouter);
router.use('/employee', employeeRouter);

export default router;
