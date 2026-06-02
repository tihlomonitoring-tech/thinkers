import { query } from '../db.js';
import { requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { creditApplicationSubmittedHtml } from '../lib/emailTemplates.js';
import {
  normalizeTeamKey,
  ensureTeamPool,
  listTenantTeams,
  resolveApplicantLeaderId,
} from '../lib/teamLeaderCredits.js';

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function canAccessTenant(req, tenantId) {
  if (req.user?.role === 'super_admin') return true;
  const tid = req.user?.tenant_id;
  if (!tid) return false;
  if (Array.isArray(req.user?.tenant_ids)) return req.user.tenant_ids.includes(tenantId);
  return tid === tenantId;
}

async function userInTenant(tenantId, userId) {
  const r = await query(
    `SELECT 1 AS ok FROM user_tenants WHERE tenant_id = @tenantId AND user_id = @userId`,
    { tenantId, userId }
  );
  return (r.recordset?.length || 0) > 0;
}

const CREDIT_LIST_SQL = `
  SELECT g.id, g.points, g.justification, g.productivity_score_total, g.source, g.created_at,
         c.name AS category_name, c.kind AS category_kind,
         iss.full_name AS issued_by_name
  FROM employee_grace_credits g
  LEFT JOIN employee_credit_demerit_categories c ON c.id = g.category_id
  LEFT JOIN users iss ON iss.id = g.issued_by`;

const SANCTION_LIST_SQL = `
  SELECT s.id, s.points, s.justification, s.productivity_score_total, s.source, s.created_at,
         c.name AS category_name, c.kind AS category_kind,
         iss.full_name AS issued_by_name
  FROM employee_debtor_sanctions s
  LEFT JOIN employee_credit_demerit_categories c ON c.id = s.category_id
  LEFT JOIN users iss ON iss.id = s.issued_by`;

/** @param {import('express').Router} router */
export function registerEmployeeGraceCreditsRoutes(router) {
  router.get('/credits-ping', (_req, res) => {
    res.json({ ok: true, module: 'employee-grace-credits' });
  });

  // —— Categories ——
  router.get('/credit-demerit-categories', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ categories: [] });
      const kind = req.query.kind && String(req.query.kind);
      const params = { tenantId };
      let where = 'WHERE tenant_id = @tenantId AND is_active = 1';
      if (kind === 'credit' || kind === 'demerit') {
        where += ' AND kind = @kind';
        params.kind = kind;
      }
      const result = await query(
        `SELECT id, kind, name, description, default_points, sort_order
         FROM employee_credit_demerit_categories ${where}
         ORDER BY sort_order, name`,
        params
      );
      res.json({ categories: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.get('/credit-demerit-categories/all', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ categories: [] });
      const result = await query(
        `SELECT id, kind, name, description, default_points, sort_order, is_active, created_at, updated_at
         FROM employee_credit_demerit_categories
         WHERE tenant_id = @tenantId ORDER BY kind, sort_order, name`,
        { tenantId }
      );
      res.json({ categories: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.post('/credit-demerit-categories', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      if (!tenantId || !b.name || !['credit', 'demerit'].includes(b.kind)) {
        return res.status(400).json({ error: 'kind (credit|demerit) and name required' });
      }
      const ins = await query(
        `INSERT INTO employee_credit_demerit_categories (tenant_id, kind, name, description, default_points, sort_order)
         OUTPUT INSERTED.*
         VALUES (@tenantId, @kind, @name, @desc, @pts, @sort)`,
        {
          tenantId,
          kind: b.kind,
          name: String(b.name).trim(),
          desc: b.description || null,
          pts: Math.max(1, parseInt(b.default_points, 10) || 1),
          sort: parseInt(b.sort_order, 10) || 0,
        }
      );
      res.status(201).json({ category: ins.recordset?.[0] || null });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/credit-demerit-categories/:id', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      const sets = [];
      const params = { id: req.params.id, tenantId };
      for (const [k, col] of [
        ['name', 'name'],
        ['description', 'description'],
        ['default_points', 'default_points'],
        ['sort_order', 'sort_order'],
        ['is_active', 'is_active'],
      ]) {
        if (b[k] !== undefined) {
          sets.push(`${col} = @${k}`);
          params[k] = b[k];
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
      sets.push('updated_at = SYSUTCDATETIME()');
      await query(
        `UPDATE employee_credit_demerit_categories SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
        params
      );
      const r = await query(
        `SELECT * FROM employee_credit_demerit_categories WHERE id = @id AND tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      );
      res.json({ category: r.recordset?.[0] || null });
    } catch (err) {
      next(err);
    }
  });

  // —— Grace credits ——
  router.get('/grace-credits', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const result = await query(
        `${CREDIT_LIST_SQL} WHERE g.user_id = @userId ORDER BY g.created_at DESC`,
        { userId: req.user.id }
      );
      res.json({ credits: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.get('/grace-credits/summary', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const userId = req.user.id;
      const credits = await query(
        `SELECT ISNULL(SUM(points), 0) AS total FROM employee_grace_credits WHERE user_id = @userId`,
        { userId }
      );
      const sanctions = await query(
        `SELECT ISNULL(SUM(points), 0) AS total FROM employee_debtor_sanctions WHERE user_id = @userId`,
        { userId }
      );
      const creditTotal = Number(getRow(credits.recordset?.[0], 'total')) || 0;
      const sanctionTotal = Number(getRow(sanctions.recordset?.[0], 'total')) || 0;
      const monthly = await query(
        `SELECT FORMAT(created_at, 'yyyy-MM') AS ym, SUM(points) AS pts
         FROM employee_grace_credits WHERE user_id = @userId
         GROUP BY FORMAT(created_at, 'yyyy-MM')
         ORDER BY ym`,
        { userId }
      );
      const monthlySanctions = await query(
        `SELECT FORMAT(created_at, 'yyyy-MM') AS ym, SUM(points) AS pts
         FROM employee_debtor_sanctions WHERE user_id = @userId
         GROUP BY FORMAT(created_at, 'yyyy-MM')
         ORDER BY ym`,
        { userId }
      );
      res.json({
        graceCreditPoints: creditTotal,
        debtorSanctionPoints: sanctionTotal,
        netBalance: creditTotal - sanctionTotal,
        creditsByMonth: monthly.recordset || [],
        sanctionsByMonth: monthlySanctions.recordset || [],
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/grace-credits/all', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ credits: [] });
      const result = await query(
        `SELECT g.id, g.user_id, g.points, g.justification, g.productivity_score_total, g.source, g.created_at,
                c.name AS category_name, u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name
         FROM employee_grace_credits g
         LEFT JOIN employee_credit_demerit_categories c ON c.id = g.category_id
         LEFT JOIN users u ON u.id = g.user_id
         LEFT JOIN users iss ON iss.id = g.issued_by
         WHERE g.tenant_id = @tenantId ORDER BY g.created_at DESC`,
        { tenantId }
      );
      res.json({ credits: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  const individualMoved = {
    error: 'Individual credits/sanctions are no longer issued by management',
    hint:
      'Allocate points to teams: POST /api/profile-management/team-point-pools/allocate. Team leaders issue to members: POST /api/team-goals/team-leader/issue-credit or issue-demerit.',
  };

  router.post('/grace-credits', requirePageAccess('management'), (req, res) => {
    res.status(410).json(individualMoved);
  });

  router.post('/debtor-sanctions', requirePageAccess('management'), (req, res) => {
    res.status(410).json(individualMoved);
  });

  router.get('/team-point-pools', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ teams: [] });
      const teamNames = await listTenantTeams(tenantId);
      const pools = [];
      for (const name of teamNames) {
        const pool = await ensureTeamPool(tenantId, name);
        pools.push({
          team_key: getRow(pool, 'team_key') || name,
          grace_points_balance: getRow(pool, 'grace_points_balance') || 0,
          sanction_points_balance: getRow(pool, 'sanction_points_balance') || 0,
        });
      }
      res.json({ teams: pools });
    } catch (err) {
      next(err);
    }
  });

  router.post('/team-point-pools/allocate', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      const teamKey = normalizeTeamKey(b.team_key || b.team_name);
      const kind = b.kind === 'demerit' ? 'demerit' : 'credit';
      const points = Math.max(1, parseInt(b.points, 10) || 1);
      const justification = b.justification && String(b.justification).trim();
      if (!tenantId || !teamKey || !justification) {
        return res.status(400).json({ error: 'team_key, points, and justification required' });
      }
      await ensureTeamPool(tenantId, teamKey);
      if (kind === 'credit') {
        await query(
          `UPDATE team_point_pools SET grace_points_balance = grace_points_balance + @pts, updated_at = SYSUTCDATETIME()
           WHERE tenant_id = @tenantId AND team_key = @teamKey`,
          { pts: points, tenantId, teamKey }
        );
      } else {
        await query(
          `UPDATE team_point_pools SET sanction_points_balance = sanction_points_balance + @pts, updated_at = SYSUTCDATETIME()
           WHERE tenant_id = @tenantId AND team_key = @teamKey`,
          { pts: points, tenantId, teamKey }
        );
      }
      const pool = await ensureTeamPool(tenantId, teamKey);
      res.status(201).json({
        team_key: teamKey,
        kind,
        points_added: points,
        justification,
        grace_points_balance: getRow(pool, 'grace_points_balance') || 0,
        sanction_points_balance: getRow(pool, 'sanction_points_balance') || 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // —— Debtor sanctions (demerits) ——
  router.get('/debtor-sanctions', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const result = await query(
        `${SANCTION_LIST_SQL} WHERE s.user_id = @userId ORDER BY s.created_at DESC`,
        { userId: req.user.id }
      );
      res.json({ sanctions: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.get('/debtor-sanctions/all', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ sanctions: [] });
      const result = await query(
        `SELECT s.id, s.user_id, s.points, s.justification, s.productivity_score_total, s.source, s.created_at,
                c.name AS category_name, u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name
         FROM employee_debtor_sanctions s
         LEFT JOIN employee_credit_demerit_categories c ON c.id = s.category_id
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN users iss ON iss.id = s.issued_by
         WHERE s.tenant_id = @tenantId ORDER BY s.created_at DESC`,
        { tenantId }
      );
      res.json({ sanctions: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  // Management allocates demerit points to teams via POST /team-point-pools/allocate (kind=demerit), not to individuals.

  // —— Credit applications ——
  router.get('/credit-applications', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const result = await query(
        `SELECT a.id, a.requested_points, a.justification, a.status, a.review_notes, a.reviewed_at, a.created_at,
                c.name AS category_name, rev.full_name AS reviewed_by_name
         FROM employee_credit_applications a
         LEFT JOIN employee_credit_demerit_categories c ON c.id = a.category_id
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         WHERE a.user_id = @userId ORDER BY a.created_at DESC`,
        { userId: req.user.id }
      );
      res.json({ applications: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.post('/credit-applications', requirePageAccess('profile'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      const justification = b.justification && String(b.justification).trim();
      if (!tenantId || !justification) return res.status(400).json({ error: 'justification required' });
      const points = Math.max(1, parseInt(b.requested_points, 10) || 1);
      if (!b.category_id) return res.status(400).json({ error: 'category_id required' });
      const categoryId = b.category_id;
      const cat = await query(
        `SELECT id FROM employee_credit_demerit_categories WHERE id = @id AND tenant_id = @tenantId AND kind = N'credit' AND is_active = 1`,
        { id: categoryId, tenantId }
      );
      if (!cat.recordset?.length) return res.status(400).json({ error: 'Invalid category' });
      const leaderId = await resolveApplicantLeaderId(tenantId, req.user.id);
      if (!leaderId) {
        return res.status(400).json({
          error: 'No team leader assigned for your team. Ask management to link you on a team objective.',
        });
      }
      const ins = await query(
        `INSERT INTO employee_credit_applications (tenant_id, user_id, category_id, requested_points, justification, assigned_leader_id)
         OUTPUT INSERTED.id, INSERTED.status, INSERTED.created_at
         VALUES (@tenantId, @userId, @catId, @pts, @just, @leaderId)`,
        { tenantId, userId: req.user.id, catId: categoryId, pts: points, just: justification, leaderId }
      );
      const row = ins.recordset?.[0];
      if (isEmailConfigured()) {
        const leaderRow = await query(`SELECT email, full_name FROM users WHERE id = @id`, { id: leaderId });
        const email = getRow(leaderRow.recordset?.[0], 'email');
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const applicantName = req.user.full_name || req.user.email || 'Employee';
        const html = creditApplicationSubmittedHtml({
          applicantName,
          points,
          justification,
          appUrl,
        });
        if (email) {
          sendEmail({
            to: email,
            subject: `Credit application: ${applicantName}`,
            body: html,
            html: true,
          }).catch(() => {});
        }
      }
      res.status(201).json({ application: row });
    } catch (err) {
      next(err);
    }
  });

  router.get('/credit-applications/all', requirePageAccess('management'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ applications: [] });
      const status = req.query.status && String(req.query.status).trim();
      const params = { tenantId };
      let where = 'WHERE a.tenant_id = @tenantId';
      if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        where += ' AND a.status = @st';
        params.st = status;
      }
      const result = await query(
        `SELECT a.id, a.user_id, a.requested_points, a.justification, a.status, a.review_notes, a.reviewed_at, a.created_at,
                c.name AS category_name, u.full_name AS user_name, u.email AS user_email, rev.full_name AS reviewed_by_name
         FROM employee_credit_applications a
         LEFT JOIN employee_credit_demerit_categories c ON c.id = a.category_id
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN users rev ON rev.id = a.reviewed_by
         ${where}
         ORDER BY CASE WHEN a.status = N'pending' THEN 0 ELSE 1 END, a.created_at DESC`,
        params
      );
      res.json({ applications: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/credit-applications/:id/review', requirePageAccess('management'), async (req, res) => {
    res.status(403).json({
      error: 'Credit applications are reviewed by team leaders under Team leader admin → Members credit requests.',
    });
  });
}
