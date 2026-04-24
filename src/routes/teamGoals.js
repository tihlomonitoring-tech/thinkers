/**
 * Department strategy, shift/team objectives, team leader questionnaires, management ratings.
 */
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { computeTenantScores } from './shiftScore.js';

const router = Router();

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function rosterRegisteredFlag(row) {
  const v = getRow(row, 'roster_registered');
  return v === true || v === 1 || String(v) === '1';
}

/** Team leader workspace: page role `team_leader_admin` implies team leader — no separate roster row required. */
async function requireTeamLeaderActive(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'super_admin') return next();
  const roles = (req.user.page_roles || []).map((r) => String(r).toLowerCase());
  if (!roles.includes('team_leader_admin')) {
    return res.status(403).json({ error: 'Team leader admin access is required.' });
  }
  if (!req.user.tenant_id) return res.status(400).json({ error: 'No tenant context' });
  return next();
}

/** Create/update operational objectives: management or appointed team leader only. */
async function requireManagementOrActiveTeamLeader(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'super_admin') return next();
  const roles = (req.user.page_roles || []).map((r) => String(r).toLowerCase());
  if (roles.includes('management')) return next();
  if (!roles.includes('team_leader_admin')) {
    return res.status(403).json({ error: 'Only management or an appointed team leader can change shift or team objectives.' });
  }
  return requireTeamLeaderActive(req, res, next);
}

router.use(requireAuth);
router.use(loadUser);

/** Department vision / mission / measurable goals & objectives (JSON arrays). */
router.get('/department', requirePageAccess(['profile', 'management']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT vision, mission, goals_json, objectives_json, updated_at, updated_by
       FROM tenant_department_strategy WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const row = r.recordset?.[0];
    res.json({
      vision: row ? getRow(row, 'vision') : '',
      mission: row ? getRow(row, 'mission') : '',
      goals_json: row ? getRow(row, 'goals_json') : '[]',
      objectives_json: row ? getRow(row, 'objectives_json') : '[]',
      updated_at: row ? getRow(row, 'updated_at') : null,
      updated_by: row ? getRow(row, 'updated_by') : null,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/department', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const { vision, mission, goals_json, objectives_json } = req.body || {};
    const g = typeof goals_json === 'string' ? goals_json : JSON.stringify(goals_json ?? []);
    const o = typeof objectives_json === 'string' ? objectives_json : JSON.stringify(objectives_json ?? []);
    const ex = await query(`SELECT 1 AS x FROM tenant_department_strategy WHERE tenant_id = @tenantId`, { tenantId });
    if (ex.recordset?.length) {
      await query(
        `UPDATE tenant_department_strategy
         SET vision = @vision, mission = @mission, goals_json = @goals, objectives_json = @objectives,
             updated_at = SYSUTCDATETIME(), updated_by = @uid
         WHERE tenant_id = @tenantId`,
        {
          tenantId,
          vision: vision != null ? String(vision) : null,
          mission: mission != null ? String(mission) : null,
          goals: g,
          objectives: o,
          uid: req.user.id,
        }
      );
    } else {
      await query(
        `INSERT INTO tenant_department_strategy (tenant_id, vision, mission, goals_json, objectives_json, updated_by)
         VALUES (@tenantId, @vision, @mission, @goals, @objectives, @uid)`,
        {
          tenantId,
          vision: vision != null ? String(vision) : null,
          mission: mission != null ? String(mission) : null,
          goals: g,
          objectives: o,
          uid: req.user.id,
        }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Profile: read-only list of organisation team objectives (dashboard). */
router.get('/profile/team-objectives', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT id, tenant_id, scope, title, description, metric_name, target_value, current_value, unit, status,
              work_date, shift_type, team_name, leader_user_id, member_user_ids, created_by, created_at, updated_at
       FROM shift_team_objectives
       WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(scope))) = N'team'
       ORDER BY updated_at DESC`,
      { tenantId }
    );
    res.json({ objectives: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/objectives', requirePageAccess(['management', 'team_leader_admin']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    // management and team_leader_admin (page role) may list tenant objectives
    const r = await query(
      `SELECT id, tenant_id, scope, title, description, metric_name, target_value, current_value, unit, status,
              work_date, shift_type, team_name, leader_user_id, member_user_ids, created_by, created_at, updated_at
       FROM shift_team_objectives
       WHERE tenant_id = @tenantId
       ORDER BY updated_at DESC`,
      { tenantId }
    );
    res.json({ objectives: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/objectives', requireManagementOrActiveTeamLeader, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const b = req.body || {};
    const scope = String(b.scope || 'shift').toLowerCase() === 'team' ? 'team' : 'shift';
    const title = (b.title && String(b.title).trim()) || '';
    if (!title) return res.status(400).json({ error: 'title is required' });
    const members = Array.isArray(b.member_user_ids) ? JSON.stringify(b.member_user_ids) : String(b.member_user_ids || '[]');
    const ins = await query(
      `INSERT INTO shift_team_objectives (
         tenant_id, scope, title, description, metric_name, target_value, current_value, unit, status,
         work_date, shift_type, team_name, leader_user_id, member_user_ids, created_by
       )
       OUTPUT INSERTED.*
       VALUES (
         @tenantId, @scope, @title, @description, @metricName, @targetValue, @currentValue, @unit, @status,
         @workDate, @shiftType, @teamName, @leaderId, @members, @createdBy
       )`,
      {
        tenantId,
        scope,
        title,
        description: b.description != null ? String(b.description) : null,
        metricName: b.metric_name != null ? String(b.metric_name) : null,
        targetValue: b.target_value != null && b.target_value !== '' ? Number(b.target_value) : null,
        currentValue: b.current_value != null && b.current_value !== '' ? Number(b.current_value) : null,
        unit: b.unit != null ? String(b.unit) : null,
        status: ['active', 'achieved', 'paused'].includes(String(b.status || '').toLowerCase())
          ? String(b.status).toLowerCase()
          : 'active',
        workDate: b.work_date || null,
        shiftType: b.shift_type ? String(b.shift_type).toLowerCase().slice(0, 20) : null,
        teamName: b.team_name != null ? String(b.team_name) : null,
        leaderId: b.leader_user_id || null,
        members,
        createdBy: req.user.id,
      }
    );
    res.status(201).json({ objective: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/objectives/:id', requireManagementOrActiveTeamLeader, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const { id } = req.params;
    const b = req.body || {};
    const chk = await query(
      `SELECT id FROM shift_team_objectives WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    if (!chk.recordset?.length) return res.status(404).json({ error: 'Objective not found' });
    const sets = [];
    const params = { id, tenantId };
    if (b.title != null) {
      sets.push('title = @title');
      params.title = String(b.title);
    }
    if (b.description !== undefined) {
      sets.push('description = @description');
      params.description = b.description == null ? null : String(b.description);
    }
    if (b.metric_name !== undefined) {
      sets.push('metric_name = @metricName');
      params.metricName = b.metric_name == null ? null : String(b.metric_name);
    }
    if (b.target_value !== undefined) {
      sets.push('target_value = @targetValue');
      params.targetValue = b.target_value === '' || b.target_value == null ? null : Number(b.target_value);
    }
    if (b.current_value !== undefined) {
      sets.push('current_value = @currentValue');
      params.currentValue = b.current_value === '' || b.current_value == null ? null : Number(b.current_value);
    }
    if (b.unit !== undefined) {
      sets.push('unit = @unit');
      params.unit = b.unit == null ? null : String(b.unit);
    }
    if (b.status != null && ['active', 'achieved', 'paused'].includes(String(b.status).toLowerCase())) {
      sets.push('status = @status');
      params.status = String(b.status).toLowerCase();
    }
    if (b.member_user_ids != null) {
      sets.push('member_user_ids = @members');
      params.members = Array.isArray(b.member_user_ids) ? JSON.stringify(b.member_user_ids) : String(b.member_user_ids);
    }
    if (b.leader_user_id !== undefined) {
      sets.push('leader_user_id = @leaderId');
      params.leaderId = b.leader_user_id || null;
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(
      `UPDATE shift_team_objectives SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const out = await query(`SELECT * FROM shift_team_objectives WHERE id = @id`, { id });
    res.json({ objective: out.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/team-leaders', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT DISTINCT u.id AS user_id, u.full_name, u.email, a.appointed_at, a.appointed_by,
              CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS roster_registered
       FROM users u
       INNER JOIN user_page_roles r ON r.user_id = u.id AND r.page_id = N'team_leader_admin'
       LEFT JOIN team_leader_assignments a ON a.tenant_id = @tenantId AND a.user_id = u.id
       WHERE (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
       ORDER BY u.full_name`,
      { tenantId }
    );
    res.json({ leaders: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/team-leaders', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const userId = req.body?.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    await query(
      `IF NOT EXISTS (SELECT 1 FROM team_leader_assignments WHERE tenant_id = @tenantId AND user_id = @userId)
       INSERT INTO team_leader_assignments (tenant_id, user_id, appointed_by) VALUES (@tenantId, @userId, @by)`,
      { tenantId, userId, by: req.user.id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/team-leaders/:userId', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    await query(`DELETE FROM team_leader_assignments WHERE tenant_id = @tenantId AND user_id = @userId`, {
      tenantId,
      userId: req.params.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/team-leader/me', requirePageAccess('team_leader_admin'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.json({ isAssigned: true });
    }
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ isAssigned: false });
    // Page access to team leader admin implies team leader for the tenant.
    res.json({ isAssigned: true });
  } catch (err) {
    next(err);
  }
});

router.post('/team-leader/questionnaire', requirePageAccess('team_leader_admin'), requireTeamLeaderActive, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const b = req.body || {};
    const workDate = (b.work_date && String(b.work_date).slice(0, 10)) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: 'work_date (YYYY-MM-DD) required' });
    const morale = ['good', 'mixed', 'strained'].includes(String(b.team_morale || '').toLowerCase())
      ? String(b.team_morale).toLowerCase()
      : 'mixed';
    const onTrack = String(b.delivery_on_track || '').toLowerCase() === 'yes' ? 'yes' : 'no';
    const indiv = Array.isArray(b.individual_checks) ? JSON.stringify(b.individual_checks) : String(b.individual_checks || '[]');
    const exQ = await query(
      `SELECT id FROM team_leader_questionnaires WHERE leader_user_id = @leaderId AND work_date = @workDate`,
      { leaderId: req.user.id, workDate }
    );
    if (exQ.recordset?.length) {
      await query(
        `UPDATE team_leader_questionnaires SET
           team_morale = @morale, delivery_on_track = @onTrack, top_blocker = @blocker, team_went_well = @wentWell,
           individual_checks_json = @indiv, team_summary = @summary, created_at = SYSUTCDATETIME()
         WHERE id = @qid`,
        {
          qid: getRow(exQ.recordset[0], 'id'),
          morale,
          onTrack,
          blocker: b.top_blocker != null ? String(b.top_blocker) : null,
          wentWell: b.team_went_well != null ? String(b.team_went_well) : null,
          indiv,
          summary: b.team_summary != null ? String(b.team_summary) : null,
        }
      );
    } else {
      await query(
        `INSERT INTO team_leader_questionnaires (
           tenant_id, leader_user_id, work_date, team_morale, delivery_on_track, top_blocker, team_went_well, individual_checks_json, team_summary
         ) VALUES (@tenantId, @leaderId, @workDate, @morale, @onTrack, @blocker, @wentWell, @indiv, @summary)`,
        {
          tenantId,
          leaderId: req.user.id,
          workDate,
          morale,
          onTrack,
          blocker: b.top_blocker != null ? String(b.top_blocker) : null,
          wentWell: b.team_went_well != null ? String(b.team_went_well) : null,
          indiv,
          summary: b.team_summary != null ? String(b.team_summary) : null,
        }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/team-leader/questionnaires', requirePageAccess('team_leader_admin'), requireTeamLeaderActive, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT TOP 60 * FROM team_leader_questionnaires
       WHERE tenant_id = @tenantId AND leader_user_id = @uid
       ORDER BY work_date DESC`,
      { tenantId, uid: req.user.id }
    );
    res.json({ entries: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/**
 * Colleagues scheduled on the same calendar day and shift line as the questionnaire (excludes the leader).
 * shift_type=auto uses the leader's own schedule entry for that date when present; otherwise day.
 */
router.get('/team-leader/touchpoint-roster', requirePageAccess('team_leader_admin'), requireTeamLeaderActive, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const workDate = String(req.query.work_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: 'work_date query required (YYYY-MM-DD)' });
    const leaderId = req.user.id;
    let shiftType = String(req.query.shift_type || 'auto').toLowerCase();
    let shiftInferred = false;
    if (shiftType === 'auto' || shiftType === '') {
      shiftInferred = true;
      const me = await query(
        `SELECT TOP 1 LOWER(LTRIM(RTRIM(e.shift_type))) AS st
         FROM work_schedule_entries e
         INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId
         WHERE s.user_id = @leaderId AND CAST(e.work_date AS DATE) = @workDate`,
        { tenantId, leaderId, workDate }
      );
      const st = String(getRow(me.recordset?.[0] || {}, 'st') || '').toLowerCase();
      shiftType = st === 'night' ? 'night' : 'day';
    } else {
      shiftType = shiftType === 'night' ? 'night' : 'day';
    }
    const r = await query(
      `SELECT DISTINCT s.user_id, u.full_name, u.email, e.shift_type, e.work_date, e.id AS schedule_entry_id
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId
       INNER JOIN users u ON u.id = s.user_id AND u.tenant_id = @tenantId
       WHERE CAST(e.work_date AS DATE) = @workDate
         AND LOWER(LTRIM(RTRIM(e.shift_type))) = @shiftType
         AND s.user_id <> @leaderId
       ORDER BY u.full_name`,
      { tenantId, workDate, shiftType, leaderId }
    );
    res.json({
      members: r.recordset || [],
      shift_type_used: shiftType,
      shift_inferred: shiftInferred,
    });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('work_schedule')) return res.json({ members: [], shift_type_used: 'day', shift_inferred: true });
    next(err);
  }
});

/** Users on the same scheduled shift for a calendar day (work schedule entries). */
router.get('/schedule-cohort', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const workDate = String(req.query.work_date || '').slice(0, 10);
    const shiftType = String(req.query.shift_type || 'day').toLowerCase() === 'night' ? 'night' : 'day';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ error: 'work_date query required (YYYY-MM-DD)' });
    const r = await query(
      `SELECT DISTINCT s.user_id, u.full_name, u.email, e.shift_type, e.work_date, e.id AS schedule_entry_id
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId
       INNER JOIN users u ON u.id = s.user_id AND u.tenant_id = @tenantId
       WHERE CAST(e.work_date AS DATE) = @workDate
         AND LOWER(LTRIM(RTRIM(e.shift_type))) = @shiftType`,
      { tenantId, workDate, shiftType }
    );
    res.json({ members: r.recordset || [] });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('work_schedule')) return res.json({ members: [] });
    next(err);
  }
});

router.post('/management/ratings', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const b = req.body || {};
    const memberUserId = b.member_user_id;
    const workDate = String(b.work_date || '').slice(0, 10);
    const period = ['daily', 'weekly', 'monthly'].includes(String(b.period || '').toLowerCase())
      ? String(b.period).toLowerCase()
      : 'daily';
    const rating = parseInt(String(b.rating), 10);
    if (!memberUserId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return res.status(400).json({ error: 'member_user_id and work_date (YYYY-MM-DD) required' });
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating 1–5 required' });
    const ins = await query(
      `INSERT INTO management_team_ratings (tenant_id, manager_user_id, member_user_id, work_date, period, rating, narrative)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @mgr, @member, @workDate, @period, @rating, @narrative)`,
      {
        tenantId,
        mgr: req.user.id,
        member: memberUserId,
        workDate,
        period,
        rating,
        narrative: b.narrative != null ? String(b.narrative) : null,
      }
    );
    res.status(201).json({ rating: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/management/ratings', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const days = Math.min(120, Math.max(7, parseInt(String(req.query.days || '30'), 10) || 30));
    const r = await query(
      `SELECT TOP 500 * FROM management_team_ratings
       WHERE tenant_id = @tenantId AND created_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
       ORDER BY created_at DESC`,
      { tenantId, days }
    );
    res.json({ ratings: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

function parseMemberUserIdsJson(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * Team leader audit: per appointed leader — recent questionnaires, linked objectives,
 * team members’ productivity scores (Command Centre roster scoring), and management touchpoint ratings.
 */
router.get('/management/team-leader-audit', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const qDaysRaw = String(req.query.questionnaire_days ?? '60').trim().toLowerCase();
    const qDaysParsed = parseInt(String(req.query.questionnaire_days ?? '60'), 10);
    const questionnaireAllTime = qDaysRaw === 'all' || (Number.isFinite(qDaysParsed) && qDaysParsed === 0);
    const daysQ = questionnaireAllTime
      ? null
      : Math.min(3650, Math.max(14, Number.isFinite(qDaysParsed) ? qDaysParsed : 60));
    const daysScore = Math.min(90, Math.max(7, parseInt(String(req.query.score_days || '56'), 10) || 56));
    const daysRatings = Math.min(3650, Math.max(14, parseInt(String(req.query.ratings_days || '90'), 10) || 90));

    const tenantUsersR = await query(
      `SELECT id, full_name, email FROM users WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const tenantUserById = new Map(
      (tenantUsersR.recordset || []).map((u) => [
        String(getRow(u, 'id')),
        { full_name: getRow(u, 'full_name'), email: getRow(u, 'email') },
      ])
    );

    const leadersR = await query(
      `SELECT DISTINCT u.id AS user_id, u.full_name, u.email, a.appointed_at, a.appointed_by,
              CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS roster_registered
       FROM users u
       INNER JOIN user_page_roles r ON r.user_id = u.id AND r.page_id = N'team_leader_admin'
       LEFT JOIN team_leader_assignments a ON a.tenant_id = @tenantId AND a.user_id = u.id
       WHERE (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
       ORDER BY u.full_name`,
      { tenantId }
    );

    const qR = await query(
      questionnaireAllTime
        ? `SELECT q.*, u.full_name AS leader_name, u.email AS leader_email
           FROM team_leader_questionnaires q
           INNER JOIN users u ON u.id = q.leader_user_id
           WHERE q.tenant_id = @tenantId
           ORDER BY q.work_date DESC, q.created_at DESC`
        : `SELECT q.*, u.full_name AS leader_name, u.email AS leader_email
           FROM team_leader_questionnaires q
           INNER JOIN users u ON u.id = q.leader_user_id
           WHERE q.tenant_id = @tenantId AND q.work_date >= CAST(DATEADD(DAY, -@daysQ, SYSUTCDATETIME()) AS DATE)
           ORDER BY q.work_date DESC, q.created_at DESC`,
      questionnaireAllTime ? { tenantId } : { tenantId, daysQ }
    );
    const questionnaires = qR.recordset || [];

    const objR = await query(
      `SELECT o.id, o.tenant_id, o.scope, o.title, o.description, o.metric_name, o.target_value, o.current_value, o.unit, o.status,
              o.work_date, o.shift_type, o.team_name, o.leader_user_id, o.member_user_ids, o.created_by, o.created_at, o.updated_at,
              uc.full_name AS created_by_name
       FROM shift_team_objectives o
       LEFT JOIN users uc ON uc.id = o.created_by
       WHERE o.tenant_id = @tenantId
       ORDER BY o.updated_at DESC`,
      { tenantId }
    );
    const allObjectivesRaw = objR.recordset || [];
    const allObjectives = allObjectivesRaw.map((o) => {
      const ids = parseMemberUserIdsJson(getRow(o, 'member_user_ids'));
      const members_on_objective = ids.map((mid) => {
        const u = tenantUserById.get(String(mid));
        return { user_id: mid, full_name: u?.full_name || '—', email: u?.email || '' };
      });
      return { ...o, members_on_objective };
    });

    let ratings = [];
    try {
      const rt = await query(
        `SELECT TOP 800 m.id, m.tenant_id, m.manager_user_id, m.member_user_id, m.work_date, m.period, m.rating, m.narrative, m.created_at,
                um.full_name AS manager_full_name, um.email AS manager_email
         FROM management_team_ratings m
         LEFT JOIN users um ON um.id = m.manager_user_id
         WHERE m.tenant_id = @tenantId AND m.created_at >= DATEADD(DAY, -@daysRatings, SYSUTCDATETIME())
         ORDER BY m.created_at DESC`,
        { tenantId, daysRatings }
      );
      ratings = rt.recordset || [];
    } catch (_) {
      ratings = [];
    }

    let scoreData;
    try {
      scoreData = await computeTenantScores(tenantId, daysScore);
    } catch (e) {
      scoreData = {
        windowDays: daysScore,
        people: [],
        scoring: null,
      };
    }
    const scoreByUserId = new Map((scoreData.people || []).map((p) => [String(p.userId), p]));

    const assignedRows = leadersR.recordset || [];
    const assignedIds = new Set(assignedRows.map((r) => String(getRow(r, 'user_id'))));
    const submissionOnlyIds = new Set();
    for (const q of questionnaires) {
      const lid = String(getRow(q, 'leader_user_id') || '');
      if (lid && !assignedIds.has(lid)) submissionOnlyIds.add(lid);
    }
    const submissionOnlyRows = [...submissionOnlyIds].map((user_id) => {
      const u = tenantUserById.get(user_id);
      return {
        user_id,
        appointed_at: null,
        appointed_by: null,
        full_name: u?.full_name || getRow(questionnaires.find((x) => String(getRow(x, 'leader_user_id')) === user_id) || {}, 'leader_name') || '—',
        email: u?.email || '',
        roster_registered: false,
        leader_from_submissions_only: true,
      };
    });

    const combinedLeaderRows = [...assignedRows, ...submissionOnlyRows].sort((a, b) =>
      String(getRow(a, 'full_name') || '').localeCompare(String(getRow(b, 'full_name') || ''), undefined, { sensitivity: 'base' })
    );

    const leaders = combinedLeaderRows.map((row) => {
      const lid = String(getRow(row, 'user_id'));
      const qs = questionnaires.filter((q) => String(getRow(q, 'leader_user_id')) === lid);
      const objs = allObjectives.filter((o) => String(getRow(o, 'leader_user_id') || '') === lid);
      const memberIds = new Set();
      for (const o of objs) {
        parseMemberUserIdsJson(getRow(o, 'member_user_ids')).forEach((id) => memberIds.add(String(id)));
      }
      const team_members = [...memberIds].map((mid) => {
        const s = scoreByUserId.get(mid);
        const tu = tenantUserById.get(mid);
        return {
          user_id: mid,
          full_name: s?.full_name || tu?.full_name || '—',
          email: s?.email || tu?.email || '',
          productivity_total: s != null ? s.total : null,
          breakdown: s?.breakdown ?? null,
        };
      });
      const memberSet = new Set(team_members.map((m) => m.user_id));
      const member_ratings = ratings.filter((r) => memberSet.has(String(getRow(r, 'member_user_id'))));

      return {
        user_id: lid,
        full_name: getRow(row, 'full_name'),
        email: getRow(row, 'email'),
        appointed_at: getRow(row, 'appointed_at'),
        appointed_by: getRow(row, 'appointed_by'),
        roster_registered: rosterRegisteredFlag(row),
        leader_from_submissions_only: Boolean(getRow(row, 'leader_from_submissions_only')),
        questionnaires: qs,
        objectives: objs,
        team_members,
        management_ratings_for_team: member_ratings,
      };
    });

    res.json({
      questionnaire_all_time: questionnaireAllTime,
      window_questionnaire_days: daysQ,
      window_score_days: daysScore,
      window_ratings_days: daysRatings,
      leaders,
      scoring: scoreData.scoring || null,
    });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('invalid object') || m.includes('does not exist')) {
      return res.json({
        questionnaire_all_time: false,
        window_questionnaire_days: 60,
        window_score_days: 56,
        window_ratings_days: 90,
        leaders: [],
        scoring: null,
      });
    }
    next(err);
  }
});

/** All team-leader daily questionnaires (read-only for management). */
router.get('/management/team-leader-questionnaires', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const days = Math.min(120, Math.max(7, parseInt(String(req.query.days || '60'), 10) || 60));
    const r = await query(
      `SELECT TOP 400 q.*, u.full_name AS leader_name, u.email AS leader_email
       FROM team_leader_questionnaires q
       INNER JOIN users u ON u.id = q.leader_user_id
       WHERE q.tenant_id = @tenantId AND q.work_date >= CAST(DATEADD(DAY, -@days, SYSUTCDATETIME()) AS DATE)
       ORDER BY q.work_date DESC, q.created_at DESC`,
      { tenantId, days }
    );
    res.json({ entries: r.recordset || [] });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('invalid object') || m.includes('does not exist')) {
      return res.json({ entries: [] });
    }
    next(err);
  }
});

/** Aggregate team objective + questionnaire signal for management dashboards. */
router.get('/team-scores/summary', requirePageAccess(['profile', 'management', 'team_leader_admin']), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const leaderId = req.query.leader_id || null;
    let obj = await query(
      `SELECT scope, status, COUNT(*) AS n
       FROM shift_team_objectives
       WHERE tenant_id = @tenantId
       GROUP BY scope, status`,
      { tenantId }
    );
    let qCount = 0;
    try {
      const qParams = { tenantId };
      let qSql = `SELECT COUNT(*) AS n FROM team_leader_questionnaires WHERE tenant_id = @tenantId`;
      if (leaderId) {
        qSql += ` AND leader_user_id = @leaderId`;
        qParams.leaderId = leaderId;
      }
      const qn = await query(qSql, qParams);
      const row0 = qn.recordset?.[0];
      qCount = Number(getRow(row0, 'n') ?? 0);
    } catch (_) {
      /* optional */
    }
    res.json({
      objectivesByStatus: obj.recordset || [],
      questionnaireCount: qCount,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
