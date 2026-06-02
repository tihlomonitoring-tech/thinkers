import { query } from '../db.js';
import { requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { graceCreditIssuedHtml, debtorSanctionIssuedHtml, creditApplicationReviewedHtml } from '../lib/emailTemplates.js';
import {
  normalizeTeamKey,
  ensureLeaderWallet,
  getLeaderTeams,
  memberBelongsToLeader,
  maybeGrantWeeklyLeaderCredits,
  countLeaderPulsesInWeek,
  PULSES_FOR_WEEKLY_GRANT,
  WEEKLY_LEADER_CREDIT_GRANT,
  deductLeaderCreditsForIssue,
  deductTeamSanctionPool,
  recordMemberGraceCredit,
  grantLeaderSelfBonus,
  isoWeekKeyFromDate,
} from '../lib/teamLeaderCredits.js';

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

async function resolveCategory(tenantId, categoryId, kind) {
  if (!categoryId) return { id: null, points: null };
  const cat = await query(
    `SELECT id, default_points FROM employee_credit_demerit_categories
     WHERE id = @id AND tenant_id = @tenantId AND kind = @kind AND is_active = 1`,
    { id: categoryId, tenantId, kind }
  );
  if (!cat.recordset?.length) throw new Error(`Invalid ${kind} category`);
  return { id: categoryId, points: getRow(cat.recordset[0], 'default_points') || 1 };
}

/** @param {import('express').Router} router */
export function registerTeamLeaderCreditsRoutes(router) {
  router.get('/team-leader/credits-ping', (_req, res) => {
    res.json({ ok: true, module: 'team-leader-credits' });
  });

  router.get('/team-leader/credit-wallet', requirePageAccess('team_leader_admin'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.status(400).json({ error: 'No tenant' });
      const refYmd = String(req.query.work_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      await maybeGrantWeeklyLeaderCredits(tenantId, req.user.id, refYmd);
      const wallet = await ensureLeaderWallet(tenantId, req.user.id);
      const teams = await getLeaderTeams(tenantId, req.user.id);
      const pulseCount = await countLeaderPulsesInWeek(tenantId, req.user.id, refYmd);
      res.json({
        available_credits: getRow(wallet, 'available_credits') || 0,
        pulse_count_this_week: pulseCount,
        pulses_required_for_weekly_grant: PULSES_FOR_WEEKLY_GRANT,
        weekly_grant_amount: WEEKLY_LEADER_CREDIT_GRANT,
        week_key: isoWeekKeyFromDate(refYmd),
        teams,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/team-leader/issue-credit', requirePageAccess('team_leader_admin'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      const memberId = b.user_id;
      const justification = b.justification && String(b.justification).trim();
      if (!tenantId || !memberId || !justification) {
        return res.status(400).json({ error: 'user_id and justification required' });
      }
      if (String(memberId) === String(req.user.id)) {
        return res.status(400).json({ error: 'You cannot grant credits to yourself' });
      }
      if (!(await memberBelongsToLeader(tenantId, req.user.id, memberId))) {
        return res.status(403).json({ error: 'Employee is not on your team roster' });
      }
      const cat = await resolveCategory(tenantId, b.category_id, 'credit');
      if (!b.category_id) return res.status(400).json({ error: 'category_id required' });
      const points = Math.max(1, parseInt(b.points, 10) || cat.points || 1);
      const teamKey = b.team_key ? normalizeTeamKey(b.team_key) : (await getLeaderTeams(tenantId, req.user.id))[0]?.team_key;
      await deductLeaderCreditsForIssue(tenantId, req.user.id, teamKey, points);
      const creditId = await recordMemberGraceCredit({
        tenantId,
        memberUserId: memberId,
        leaderUserId: req.user.id,
        categoryId: cat.id,
        points,
        justification,
        teamKey,
        source: 'team_leader_to_member',
      });
      await grantLeaderSelfBonus(tenantId, req.user.id, justification);
      if (isEmailConfigured()) {
        const userRow = await query(`SELECT email FROM users WHERE id = @id`, { id: memberId });
        const email = getRow(userRow.recordset?.[0], 'email');
        if (email) {
          const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
          sendEmail({
            to: email,
            subject: `Grace credit (+${points} points)`,
            body: graceCreditIssuedHtml({
              points,
              justification,
              issuedByName: req.user.full_name || req.user.email,
              appUrl,
            }),
            html: true,
          }).catch(() => {});
        }
      }
      const wallet = await ensureLeaderWallet(tenantId, req.user.id);
      res.status(201).json({
        credit_id: creditId,
        leader_self_bonus: 15,
        available_credits: getRow(wallet, 'available_credits') || 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/team-leader/issue-demerit', requirePageAccess('team_leader_admin'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      const b = req.body || {};
      const memberId = b.user_id;
      const justification = b.justification && String(b.justification).trim();
      if (!tenantId || !memberId || !justification) {
        return res.status(400).json({ error: 'user_id and justification required' });
      }
      if (String(memberId) === String(req.user.id)) {
        return res.status(400).json({ error: 'You cannot issue a demerit to yourself' });
      }
      if (!(await memberBelongsToLeader(tenantId, req.user.id, memberId))) {
        return res.status(403).json({ error: 'Employee is not on your team roster' });
      }
      if (!b.category_id) return res.status(400).json({ error: 'category_id required' });
      const cat = await resolveCategory(tenantId, b.category_id, 'demerit');
      const points = Math.max(1, parseInt(b.points, 10) || cat.points || 1);
      const teams = await getLeaderTeams(tenantId, req.user.id);
      const teamKey = b.team_key ? normalizeTeamKey(b.team_key) : teams[0]?.team_key;
      if (!teamKey) return res.status(400).json({ error: 'No team linked — set team on shift objectives' });
      await deductTeamSanctionPool(tenantId, teamKey, points);
      const ins = await query(
        `INSERT INTO employee_debtor_sanctions (tenant_id, user_id, category_id, points, justification, source, issued_by, team_key)
         OUTPUT INSERTED.id
         VALUES (@tenantId, @memberId, @catId, @pts, @just, N'team_leader_to_member', @leaderId, @teamKey)`,
        {
          tenantId,
          memberId,
          catId: cat.id,
          pts: points,
          just: justification,
          leaderId: req.user.id,
          teamKey,
        }
      );
      if (isEmailConfigured()) {
        const userRow = await query(`SELECT email FROM users WHERE id = @id`, { id: memberId });
        const email = getRow(userRow.recordset?.[0], 'email');
        if (email) {
          const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
          sendEmail({
            to: email,
            subject: `Debtor sanction (${points} points)`,
            body: debtorSanctionIssuedHtml({
              points,
              justification,
              issuedByName: req.user.full_name || req.user.email,
              appUrl,
            }),
            html: true,
          }).catch(() => {});
        }
      }
      res.status(201).json({ sanction_id: getRow(ins.recordset?.[0], 'id') });
    } catch (err) {
      next(err);
    }
  });

  router.get('/team-leader/member-credit-applications', requirePageAccess('team_leader_admin'), async (req, res, next) => {
    try {
      const tenantId = req.user.tenant_id;
      if (!tenantId) return res.json({ applications: [] });
      const status = req.query.status && String(req.query.status);
      const params = { tenantId, leaderId: req.user.id };
      let where = 'WHERE a.tenant_id = @tenantId AND a.assigned_leader_id = @leaderId';
      if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        where += ' AND a.status = @st';
        params.st = status;
      }
      const result = await query(
        `SELECT a.id, a.user_id, a.requested_points, a.justification, a.status, a.review_notes, a.reviewed_at, a.created_at,
                c.name AS category_name, u.full_name AS user_name, u.email AS user_email
         FROM employee_credit_applications a
         LEFT JOIN employee_credit_demerit_categories c ON c.id = a.category_id
         LEFT JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY CASE WHEN a.status = N'pending' THEN 0 ELSE 1 END, a.created_at DESC`,
        params
      );
      res.json({ applications: result.recordset || [] });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/team-leader/member-credit-applications/:id/review', requirePageAccess('team_leader_admin'), async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, review_notes } = req.body || {};
      if (!status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status must be approved or rejected' });
      }
      const app = await query(`SELECT * FROM employee_credit_applications WHERE id = @id`, { id });
      const row = app.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'Application not found' });
      if (String(getRow(row, 'assigned_leader_id')) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Not assigned to you' });
      }
      if (getRow(row, 'status') !== 'pending') {
        return res.status(400).json({ error: 'Already reviewed' });
      }
      const tenantId = getRow(row, 'tenant_id');
      const memberId = getRow(row, 'user_id');
      let graceCreditId = null;
      if (status === 'approved') {
        const points = getRow(row, 'requested_points') || 1;
        const justification = `[Approved application] ${getRow(row, 'justification') || ''}`.trim();
        const teams = await getLeaderTeams(tenantId, req.user.id);
        const teamKey = teams[0]?.team_key;
        if (!getRow(row, 'category_id')) {
          return res.status(400).json({ error: 'Application missing category' });
        }
        await deductLeaderCreditsForIssue(tenantId, req.user.id, teamKey, points);
        graceCreditId = await recordMemberGraceCredit({
          tenantId,
          memberUserId: memberId,
          leaderUserId: req.user.id,
          categoryId: getRow(row, 'category_id'),
          points,
          justification,
          teamKey,
          source: 'credit_application',
        });
        await grantLeaderSelfBonus(tenantId, req.user.id, justification);
      }
      await query(
        `UPDATE employee_credit_applications
         SET status = @status, reviewed_by = @reviewedBy, reviewed_at = SYSUTCDATETIME(),
             review_notes = @notes, grace_credit_id = @graceId, updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        {
          id,
          status,
          reviewedBy: req.user.id,
          notes: review_notes || null,
          graceId: graceCreditId,
        }
      );
      if (isEmailConfigured()) {
        const userRow = await query(`SELECT email FROM users WHERE id = @id`, { id: memberId });
        const email = getRow(userRow.recordset?.[0], 'email');
        if (email) {
          const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
          sendEmail({
            to: email,
            subject: `Credit application ${status}`,
            body: creditApplicationReviewedHtml({ status, reviewNotes: review_notes || null, appUrl }),
            html: true,
          }).catch(() => {});
        }
      }
      res.json({ ok: true, grace_credit_id: graceCreditId });
    } catch (err) {
      next(err);
    }
  });
}
