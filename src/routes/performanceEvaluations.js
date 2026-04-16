/**
 * Performance evaluations (1–3 + comment), biweekly limits, improvement plans, auditor workflow.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

const router = Router();

export const PE_RELATIONSHIP_TYPES = [
  'employee_to_manager',
  'manager_to_employee',
  'manager_to_director',
  'director_to_manager',
  'employee_to_director',
  'colleague_to_colleague',
];

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function isMissingPeTableError(err) {
  const m = String(err?.message || '').toLowerCase();
  return m.includes('invalid object') || m.includes('does not exist');
}

const PE_MISSING_TABLES_MSG =
  'Performance evaluations tables are not installed or incomplete. Run: npm run db:performance-evaluations-schema, or npm run db:performance-evaluations-patch if core PE tables already exist.';

function handlePeRouteError(err, res, next) {
  if (isMissingPeTableError(err)) {
    return res.status(503).json({ error: PE_MISSING_TABLES_MSG });
  }
  next(err);
}

const DEFAULT_QUESTIONS = [
  { category: 'work_environment', text: 'How would you rate the work environment (safety, resources, clarity of expectations)?' },
  { category: 'culture', text: 'How well does this person contribute to a respectful, inclusive team culture?' },
  { category: 'work_ethic', text: 'How reliable and accountable is this person (attendance, follow-through, professionalism)?' },
  { category: 'work_competence', text: 'How would you rate their technical or role-specific competence?' },
  { category: 'leadership', text: 'How effectively does this person lead, guide, or support others when relevant?' },
  { category: 'communication', text: 'How clear and constructive is their communication?' },
  { category: 'collaboration', text: 'How well do they collaborate across roles and shifts?' },
];

async function ensureDefaultQuestions(tenantId) {
  const c = await query(`SELECT COUNT(*) AS n FROM pe_questions WHERE tenant_id = @tenantId`, { tenantId });
  const n = parseInt(String(getRow(c.recordset?.[0], 'n') ?? '0'), 10) || 0;
  if (n > 0) return;
  let order = 0;
  for (const q of DEFAULT_QUESTIONS) {
    await query(
      `INSERT INTO pe_questions (id, tenant_id, sort_order, category, question_text, is_active)
       VALUES (@id, @tenantId, @so, @cat, @txt, 1)`,
      { id: randomUUID(), tenantId, so: order++, cat: q.category, txt: q.text }
    );
  }
}

router.use(requireAuth);
router.use(loadUser);

/** Active tenant colleagues for the evaluatee dropdown (not only user_tenants — includes users.tenant_id). */
router.get('/evaluatee-options', requirePageAccess('performance_evaluations'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const selfId = req.user.id;
    if (!tenantId) return res.json({ users: [] });
    const r = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       WHERE u.status = 'active'
         AND (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
         AND u.id <> @selfId
       ORDER BY u.full_name`,
      { tenantId, selfId }
    );
    const users = (r.recordset || []).map((row) => ({
      id: getRow(row, 'id'),
      full_name: getRow(row, 'full_name') ?? getRow(row, 'Full_name'),
      email: getRow(row, 'email') ?? getRow(row, 'Email'),
    }));
    res.json({ users });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/questions', requirePageAccess(['performance_evaluations', 'management', 'auditor']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    await ensureDefaultQuestions(tenantId);
    const r = await query(
      `SELECT id, tenant_id, sort_order, category, question_text, is_active, created_at
       FROM pe_questions WHERE tenant_id = @tenantId ORDER BY sort_order, created_at`,
      { tenantId }
    );
    res.json({ questions: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.post('/questions', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const b = req.body || {};
    const id = randomUUID();
    const cat = String(b.category || 'general').slice(0, 80);
    const txt = String(b.question_text || '').trim();
    if (!txt) return res.status(400).json({ error: 'question_text required' });
    const mx = await query(`SELECT ISNULL(MAX(sort_order), -1) + 1 AS n FROM pe_questions WHERE tenant_id = @tenantId`, { tenantId });
    const so = parseInt(String(getRow(mx.recordset?.[0], 'n') ?? '0'), 10) || 0;
    await query(
      `INSERT INTO pe_questions (id, tenant_id, sort_order, category, question_text, is_active)
       VALUES (@id, @tenantId, @so, @cat, @txt, 1)`,
      { id, tenantId, so, cat, txt }
    );
    const row = await query(`SELECT * FROM pe_questions WHERE id = @id`, { id });
    res.status(201).json({ question: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.patch('/questions/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const b = req.body || {};
    const curR = await query(`SELECT * FROM pe_questions WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    const cur = curR.recordset?.[0];
    if (!cur) return res.status(404).json({ error: 'Question not found' });
    const txt = b.question_text !== undefined ? String(b.question_text) : String(getRow(cur, 'question_text') || '');
    const cat = b.category !== undefined ? String(b.category).slice(0, 80) : String(getRow(cur, 'category') || 'general');
    const so = b.sort_order !== undefined ? parseInt(String(b.sort_order), 10) : parseInt(String(getRow(cur, 'sort_order') ?? '0'), 10) || 0;
    const ia = b.is_active !== undefined ? (b.is_active ? 1 : 0) : getRow(cur, 'is_active') ? 1 : 0;
    await query(
      `UPDATE pe_questions SET question_text = @txt, category = @cat, sort_order = @so, is_active = @ia WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, txt, cat, so, ia }
    );
    const row = await query(`SELECT * FROM pe_questions WHERE id = @id`, { id });
    res.json({ question: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.delete('/questions/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const ex = await query(`SELECT id FROM pe_questions WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!ex.recordset?.length) return res.status(404).json({ error: 'Question not found' });
    await query(`UPDATE pe_questions SET is_active = 0 WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    res.json({ ok: true, deactivated: true });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

/** Current open evaluation period (submit allowed only when present). */
router.get('/evaluation-periods/current', requirePageAccess(['performance_evaluations', 'management', 'auditor']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ period: null });
    const r = await query(
      `SELECT TOP 1 id, tenant_id, title, is_open, opened_at, closed_at, created_at
       FROM pe_evaluation_periods
       WHERE tenant_id = @tenantId AND is_open = 1
       ORDER BY opened_at DESC`,
      { tenantId }
    );
    res.json({ period: r.recordset?.[0] || null });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

/** History of evaluation periods for the tenant. */
router.get('/evaluation-periods', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT TOP 80 ep.id, ep.tenant_id, ep.title, ep.is_open, ep.opened_at, ep.closed_at, ep.created_at,
              (SELECT COUNT(*) FROM pe_submissions s WHERE s.evaluation_period_id = ep.id) AS submission_count
       FROM pe_evaluation_periods ep
       WHERE ep.tenant_id = @tenantId
       ORDER BY ep.opened_at DESC`,
      { tenantId }
    );
    res.json({ periods: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

/** Close any open period, then start a new open period. */
router.post('/evaluation-periods/open', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const title = String((req.body || {}).title || '').trim() || null;
    await query(
      `UPDATE pe_evaluation_periods SET is_open = 0, closed_at = SYSUTCDATETIME()
       WHERE tenant_id = @tenantId AND is_open = 1`,
      { tenantId }
    );
    const id = randomUUID();
    await query(
      `INSERT INTO pe_evaluation_periods (id, tenant_id, title, is_open, opened_at, closed_at, created_by_user_id)
       VALUES (@id, @tenantId, @title, 1, SYSUTCDATETIME(), NULL, @uid)`,
      { id, tenantId, title, uid: req.user.id }
    );
    const row = await query(`SELECT * FROM pe_evaluation_periods WHERE id = @id`, { id });
    res.status(201).json({ period: row.recordset?.[0] });
  } catch (err) {
    const m = String(err?.message || '');
    if (m.includes('UQ_pe_evaluation_period_one_open') || m.includes('duplicate key')) {
      return res.status(409).json({ error: 'Could not open a period (conflict). Close the current period and try again.' });
    }
    handlePeRouteError(err, res, next);
  }
});

router.post('/evaluation-periods/:id/close', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const ex = await query(
      `SELECT id FROM pe_evaluation_periods WHERE id = @id AND tenant_id = @tenantId AND is_open = 1`,
      { id, tenantId }
    );
    if (!ex.recordset?.length) return res.status(404).json({ error: 'Open period not found' });
    await query(
      `UPDATE pe_evaluation_periods SET is_open = 0, closed_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = await query(`SELECT * FROM pe_evaluation_periods WHERE id = @id`, { id });
    res.json({ period: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/my-submissions', requirePageAccess('performance_evaluations'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT TOP 80 s.*, ev.full_name AS evaluatee_name,
              ep.title AS evaluation_period_title, ep.opened_at AS evaluation_period_opened_at
       FROM pe_submissions s
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       WHERE s.tenant_id = @tenantId AND s.evaluator_user_id = @uid
       ORDER BY s.submitted_at DESC`,
      { tenantId, uid: req.user.id }
    );
    res.json({ submissions: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

/** Evaluations where the current user was evaluated (for Profile + improvement plans). */
router.get('/about-me', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const uid = req.user.id;
    const r = await query(
      `SELECT TOP 80 s.*, ev.full_name AS evaluator_name, p.id AS improvement_plan_id,
              p.addressing_feedback AS plan_addressing_feedback, p.will_do_differently AS plan_will_do_differently,
              ep.title AS evaluation_period_title
       FROM pe_submissions s
       INNER JOIN users ev ON ev.id = s.evaluator_user_id
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       LEFT JOIN pe_evaluatee_improvement_plans p ON p.submission_id = s.id
       WHERE s.tenant_id = @tenantId AND s.evaluatee_user_id = @uid
       ORDER BY s.submitted_at DESC`,
      { tenantId, uid }
    );
    res.json({ evaluations: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/submissions/:id/detail', requirePageAccess(['performance_evaluations', 'management', 'auditor', 'profile']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const roles = (req.user.page_roles || []).map((x) => String(x).toLowerCase());
    const isMgmt = roles.includes('management') || req.user.role === 'super_admin';
    const isAud = roles.includes('auditor') || req.user.role === 'super_admin';
    const isPerf = roles.includes('performance_evaluations') || req.user.role === 'super_admin';
    const isProfile = roles.includes('profile') || req.user.role === 'super_admin';

    const srow = await query(
      `SELECT s.*, ev.full_name AS evaluatee_name, er.full_name AS evaluator_name,
              ep.title AS evaluation_period_title, ep.opened_at AS evaluation_period_opened_at, ep.closed_at AS evaluation_period_closed_at
       FROM pe_submissions s
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       INNER JOIN users er ON er.id = s.evaluator_user_id
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       WHERE s.id = @id AND s.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const sub = srow.recordset?.[0];
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const evId = getRow(sub, 'evaluator_user_id');
    const eeId = getRow(sub, 'evaluatee_user_id');
    const allowed =
      isMgmt ||
      isAud ||
      (isPerf && (String(evId) === String(req.user.id) || String(eeId) === String(req.user.id))) ||
      (isProfile && String(eeId) === String(req.user.id));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const ans = await query(
      `SELECT a.*, q.category, q.question_text
       FROM pe_answers a
       INNER JOIN pe_questions q ON q.id = a.question_id
       WHERE a.submission_id = @id
       ORDER BY q.sort_order`,
      { id }
    );
    const planR = await query(`SELECT TOP 1 * FROM pe_evaluatee_improvement_plans WHERE submission_id = @id`, { id });
    const plan = planR.recordset?.[0];
    res.json({
      submission: {
        ...sub,
        improvement_plan: plan || null,
        plan_addressing_feedback: plan ? getRow(plan, 'addressing_feedback') : null,
        plan_will_do_differently: plan ? getRow(plan, 'will_do_differently') : null,
      },
      answers: ans.recordset || [],
    });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.post('/submissions', requirePageAccess('performance_evaluations'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const b = req.body || {};
    const rt = String(b.relationship_type || '').toLowerCase();
    if (!PE_RELATIONSHIP_TYPES.includes(rt)) return res.status(400).json({ error: 'Invalid relationship_type' });
    const evaluateeId = String(b.evaluatee_user_id || '').trim();
    if (!evaluateeId || evaluateeId === String(req.user.id)) return res.status(400).json({ error: 'evaluatee_user_id required and must not be yourself' });

    const openPr = await query(
      `SELECT TOP 1 id FROM pe_evaluation_periods WHERE tenant_id = @tenantId AND is_open = 1 ORDER BY opened_at DESC`,
      { tenantId }
    );
    const periodId = getRow(openPr.recordset?.[0], 'id');
    if (!periodId) {
      return res.status(403).json({
        error: 'No evaluation period is open. Submissions are disabled until management opens a period.',
      });
    }

    const dup = await query(
      `SELECT TOP 1 id FROM pe_submissions
       WHERE tenant_id = @tenantId AND evaluation_period_id = @periodId
         AND evaluator_user_id = @eid AND evaluatee_user_id = @vid AND relationship_type = @rt`,
      { tenantId, periodId, eid: req.user.id, vid: evaluateeId, rt }
    );
    if (dup.recordset?.length) {
      return res.status(409).json({
        error: 'You already submitted this evaluation type for this person in the current evaluation period.',
      });
    }

    await ensureDefaultQuestions(tenantId);
    const qrows = await query(
      `SELECT id FROM pe_questions WHERE tenant_id = @tenantId AND is_active = 1 ORDER BY sort_order`,
      { tenantId }
    );
    const activeIds = new Set((qrows.recordset || []).map((r) => String(getRow(r, 'id'))));
    const answers = Array.isArray(b.answers) ? b.answers : [];
    if (answers.length !== activeIds.size) {
      return res.status(400).json({ error: `Each active question must have an answer (${activeIds.size} required).` });
    }
    for (const a of answers) {
      const qid = String(a.question_id || '');
      if (!activeIds.has(qid)) return res.status(400).json({ error: 'Invalid or inactive question_id in answers' });
      const sc = parseInt(String(a.score), 10);
      if (!Number.isFinite(sc) || sc < 1 || sc > 3) return res.status(400).json({ error: 'Each score must be 1–3' });
      const cm = String(a.comment || '').trim();
      if (!cm) return res.status(400).json({ error: 'Each question requires a comment.' });
    }

    const subId = randomUUID();
    await query(
      `INSERT INTO pe_submissions (id, tenant_id, evaluator_user_id, evaluatee_user_id, relationship_type, evaluation_period_id)
       VALUES (@id, @tenantId, @eid, @vid, @rt, @periodId)`,
      { id: subId, tenantId, eid: req.user.id, vid: evaluateeId, rt, periodId }
    );
    for (const a of answers) {
      await query(
        `INSERT INTO pe_answers (id, submission_id, question_id, score, comment)
         VALUES (@id, @sid, @qid, @sc, @cm)`,
        { id: randomUUID(), sid: subId, qid: a.question_id, sc: parseInt(String(a.score), 10), cm: String(a.comment).trim() }
      );
    }
    res.status(201).json({ id: subId, ok: true });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.post('/improvement/evaluatee', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const b = req.body || {};
    const submissionId = String(b.submission_id || '').trim();
    const addr = String(b.addressing_feedback || '').trim();
    const diff = String(b.will_do_differently || '').trim();
    if (!submissionId || !addr || !diff) return res.status(400).json({ error: 'submission_id, addressing_feedback, will_do_differently required' });

    const s = await query(
      `SELECT evaluatee_user_id FROM pe_submissions WHERE id = @id AND tenant_id = @tenantId`,
      { id: submissionId, tenantId }
    );
    const ee = getRow(s.recordset?.[0], 'evaluatee_user_id');
    if (!ee || String(ee) !== String(req.user.id)) return res.status(403).json({ error: 'You can only add a plan for evaluations about you.' });

    const ex = await query(`SELECT id FROM pe_evaluatee_improvement_plans WHERE submission_id = @sid`, { sid: submissionId });
    const id = randomUUID();
    if (ex.recordset?.length) {
      await query(
        `UPDATE pe_evaluatee_improvement_plans SET addressing_feedback = @a, will_do_differently = @d, updated_at = SYSUTCDATETIME()
         WHERE submission_id = @sid`,
        { sid: submissionId, a: addr, d: diff }
      );
    } else {
      await query(
        `INSERT INTO pe_evaluatee_improvement_plans (id, tenant_id, submission_id, evaluatee_user_id, addressing_feedback, will_do_differently)
         VALUES (@id, @tenantId, @sid, @uid, @a, @d)`,
        { id, tenantId, sid: submissionId, uid: req.user.id, a: addr, d: diff }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/trends', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const days = Math.min(180, Math.max(14, parseInt(String(req.query.days || '56'), 10) || 56));
    const avg = await query(
      `SELECT q.category, AVG(CAST(a.score AS FLOAT)) AS avg_score, COUNT(DISTINCT a.submission_id) AS submission_count
       FROM pe_answers a
       INNER JOIN pe_submissions s ON s.id = a.submission_id AND s.tenant_id = @tenantId
       INNER JOIN pe_questions q ON q.id = a.question_id
       WHERE s.submitted_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       GROUP BY q.category
       ORDER BY q.category`,
      { tenantId, days }
    );
    const recent = await query(
      `SELECT TOP 40 s.id, s.submitted_at, s.relationship_type, er.full_name AS evaluator_name, ev.full_name AS evaluatee_name,
              ep.title AS evaluation_period_title
       FROM pe_submissions s
       INNER JOIN users er ON er.id = s.evaluator_user_id
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       WHERE s.tenant_id = @tenantId AND s.submitted_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       ORDER BY s.submitted_at DESC`,
      { tenantId, days }
    );
    res.json({ by_category: avg.recordset || [], recent_submissions: recent.recordset || [], days });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/management/workspace', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM pe_management_eval_workspace WHERE tenant_id = @tenantId`, { tenantId });
    res.json({ workspace: r.recordset?.[0] || null });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.put('/management/workspace', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const b = req.body || {};
    const exR = await query(`SELECT * FROM pe_management_eval_workspace WHERE tenant_id = @tenantId`, { tenantId });
    const cur = exR.recordset?.[0];
    const trends = b.trends_notes !== undefined ? String(b.trends_notes) : String(getRow(cur, 'trends_notes') || '');
    const plan = b.improvement_plan !== undefined ? String(b.improvement_plan) : String(getRow(cur, 'improvement_plan') || '');
    const pr =
      b.progress_report_started !== undefined
        ? b.progress_report_started
          ? 1
          : 0
        : getRow(cur, 'progress_report_started')
          ? 1
          : 0;
    if (cur) {
      await query(
        `UPDATE pe_management_eval_workspace SET trends_notes = @trends, improvement_plan = @plan, progress_report_started = @pr, updated_by = @uid, updated_at = SYSUTCDATETIME()
         WHERE tenant_id = @tenantId`,
        { tenantId, trends, plan, pr, uid: req.user.id }
      );
    } else {
      await query(
        `INSERT INTO pe_management_eval_workspace (tenant_id, trends_notes, improvement_plan, progress_report_started, updated_by)
         VALUES (@tenantId, @trends, @plan, @pr, @uid)`,
        { tenantId, trends, plan, pr, uid: req.user.id }
      );
    }
    const row = await query(`SELECT * FROM pe_management_eval_workspace WHERE tenant_id = @tenantId`, { tenantId });
    res.json({ workspace: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/auditor/queue', requirePageAccess('auditor'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT TOP 100 s.*, er.full_name AS evaluator_name, ev.full_name AS evaluatee_name
       FROM pe_submissions s
       INNER JOIN users er ON er.id = s.evaluator_user_id
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       LEFT JOIN pe_auditor_reviews ar ON ar.submission_id = s.id
       WHERE s.tenant_id = @tenantId AND ar.id IS NULL
       ORDER BY s.submitted_at ASC`,
      { tenantId }
    );
    res.json({ queue: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.post('/auditor/reviews', requirePageAccess('auditor'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const b = req.body || {};
    const submissionId = String(b.submission_id || '').trim();
    if (!submissionId) return res.status(400).json({ error: 'submission_id required' });
    const fr = b.fairness_rating != null && b.fairness_rating !== '' ? parseInt(String(b.fairness_rating), 10) : null;
    if (fr != null && (!Number.isFinite(fr) || fr < 1 || fr > 5)) return res.status(400).json({ error: 'fairness_rating must be 1–5 or null' });

    const ex = await query(`SELECT id FROM pe_submissions WHERE id = @id AND tenant_id = @tenantId`, { id: submissionId, tenantId });
    if (!ex.recordset?.length) return res.status(404).json({ error: 'Submission not found' });
    const du = await query(`SELECT id FROM pe_auditor_reviews WHERE submission_id = @sid`, { sid: submissionId });
    if (du.recordset?.length) return res.status(409).json({ error: 'This submission already has an auditor review.' });

    const id = randomUUID();
    await query(
      `INSERT INTO pe_auditor_reviews (id, tenant_id, submission_id, auditor_user_id, fairness_rating, recommendations, audit_report)
       VALUES (@id, @tenantId, @sid, @aid, @fr, @rec, @rep)`,
      {
        id,
        tenantId,
        sid: submissionId,
        aid: req.user.id,
        fr,
        rec: b.recommendations != null ? String(b.recommendations) : null,
        rep: b.audit_report != null ? String(b.audit_report) : null,
      }
    );
    const row = await query(`SELECT * FROM pe_auditor_reviews WHERE id = @id`, { id });
    res.status(201).json({ review: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/auditor/reviews', requirePageAccess('auditor'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT ar.*, s.submitted_at, s.relationship_type, er.full_name AS evaluator_name, ev.full_name AS evaluatee_name
       FROM pe_auditor_reviews ar
       INNER JOIN pe_submissions s ON s.id = ar.submission_id
       INNER JOIN users er ON er.id = s.evaluator_user_id
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       WHERE ar.tenant_id = @tenantId AND ar.auditor_user_id = @uid
       ORDER BY ar.created_at DESC`,
      { tenantId, uid: req.user.id }
    );
    res.json({ reviews: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.patch('/auditor/reviews/:id/follow-up', requirePageAccess('auditor'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const b = req.body || {};
    const r = await query(
      `SELECT id, auditor_user_id FROM pe_auditor_reviews WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'auditor_user_id')) !== String(req.user.id) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the assigned auditor can comment.' });
    }
    await query(
      `UPDATE pe_auditor_reviews SET auditor_followup_comment = @c, auditor_followup_at = SYSUTCDATETIME() WHERE id = @id`,
      { id, c: String(b.auditor_followup_comment || '').trim() || null }
    );
    const out = await query(`SELECT * FROM pe_auditor_reviews WHERE id = @id`, { id });
    res.json({ review: out.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.get('/management/auditor-reviews', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT ar.*, s.submitted_at, s.relationship_type, er.full_name AS evaluator_name, ev.full_name AS evaluatee_name, au.full_name AS auditor_name
       FROM pe_auditor_reviews ar
       INNER JOIN pe_submissions s ON s.id = ar.submission_id
       INNER JOIN users er ON er.id = s.evaluator_user_id
       INNER JOIN users ev ON ev.id = s.evaluatee_user_id
       INNER JOIN users au ON au.id = ar.auditor_user_id
       WHERE ar.tenant_id = @tenantId
       ORDER BY ar.created_at DESC`,
      { tenantId }
    );
    res.json({ reviews: r.recordset || [] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

router.patch('/management/auditor-reviews/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const id = req.params.id;
    const b = req.body || {};
    const ex = await query(`SELECT id FROM pe_auditor_reviews WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!ex.recordset?.length) return res.status(404).json({ error: 'Not found' });
    await query(
      `UPDATE pe_auditor_reviews SET management_response = @txt, management_submitted_at = SYSUTCDATETIME() WHERE id = @id`,
      { id, txt: String(b.management_response || '').trim() || null }
    );
    const row = await query(`SELECT * FROM pe_auditor_reviews WHERE id = @id`, { id });
    res.json({ review: row.recordset?.[0] });
  } catch (err) {
    handlePeRouteError(err, res, next);
  }
});

export default router;
