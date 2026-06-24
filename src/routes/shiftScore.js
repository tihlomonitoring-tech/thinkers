/**
 * Shift productivity score API — punctuality, evaluations, tasks, report hand-in timing.
 */
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { todayYmd, addCalendarDays } from '../lib/appTime.js';
import * as Sp from '../lib/shiftProductivityScore.js';
import { computeParticipationPoints, PE_SCORE_RULES } from '../lib/peParticipationScore.js';
import { parseGuid, sameGuid } from '../lib/guidUtils.js';

const router = Router();

function normalizeUserId(v) {
  return parseGuid(v) || '';
}

function findPerson(people, userId) {
  const target = normalizeUserId(userId);
  if (!target) return null;
  return people.find((p) => sameGuid(p.userId, target)) || null;
}

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function ensureBreakdown() {
  return Sp.emptyScoreBreakdown();
}

function addEvent(b, cat, ev) {
  if (!b[cat]) b[cat] = { points: 0, events: [] };
  b[cat].points += ev.points || 0;
  b[cat].events.push(ev);
}

/** Latest evaluation per report (by created_at). Keys may be shift_report_id or report_id. */
function dedupeEvaluations(rows, reportIdKey = 'shift_report_id') {
  const byReport = new Map();
  for (const row of rows) {
    const rid = String(getRow(row, reportIdKey) || getRow(row, 'shift_report_id') || getRow(row, 'report_id') || '');
    if (!rid) continue;
    const cur = getRow(row, 'created_at');
    const prev = byReport.get(rid);
    if (!prev || new Date(cur).getTime() > new Date(getRow(prev, 'created_at')).getTime()) {
      byReport.set(rid, row);
    }
  }
  return [...byReport.values()];
}

async function fetchStandardEvaluations(params) {
  const er = await query(
    `SELECT e.answers, e.created_at, e.shift_report_id, r.created_by_user_id, N'standard' AS report_kind
     FROM controller_evaluations e
     INNER JOIN command_centre_shift_reports r ON r.id = e.shift_report_id
     INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
     WHERE e.created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
    params
  );
  return er.recordset || [];
}

async function fetchSingleOpsEvaluations(params) {
  const er = await query(
    `SELECT e.answers, e.created_at, e.report_id AS shift_report_id, r.created_by_user_id, N'single_ops' AS report_kind
     FROM command_centre_single_ops_controller_evaluations e
     INNER JOIN command_centre_single_ops_shift_reports r ON r.id = e.report_id
     INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
     WHERE e.created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
    params
  );
  return er.recordset || [];
}

async function fetchStandardReportTiming(params) {
  const rr = await query(
    `SELECT r.id, r.created_by_user_id, r.submitted_at, r.shift_start, r.shift_end, r.shift_date, r.report_date, r.status, N'standard' AS report_kind
     FROM command_centre_shift_reports r
     INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
     WHERE r.submitted_at IS NOT NULL
       AND r.submitted_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
       AND LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) <> N'draft'`,
    params
  );
  return rr.recordset || [];
}

async function fetchSingleOpsReportTiming(params) {
  const rr = await query(
    `SELECT r.id, r.created_by_user_id, r.submitted_at, r.shift_start, r.shift_end, r.shift_date, r.report_date, r.status, N'single_ops' AS report_kind
     FROM command_centre_single_ops_shift_reports r
     INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
     WHERE r.submitted_at IS NOT NULL
       AND r.submitted_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
       AND LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) <> N'draft'`,
    params
  );
  return rr.recordset || [];
}

const SCORE_CATEGORY_IDS = [
  'punctuality',
  'evaluation',
  'tasks',
  'reportTiming',
  'teamProgress',
  'dailyPulse',
  'performanceEvaluation',
];

function ensureUserEntry(byUser, userId, patch = {}) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  if (!byUser.has(id)) {
    byUser.set(id, {
      userId: id,
      full_name: patch.full_name || '',
      email: patch.email || '',
      breakdown: ensureBreakdown(),
      total: 0,
    });
  }
  return byUser.get(id);
}

export async function computeTenantScores(tenantId, windowDays, options = {}) {
  const wd = Math.max(7, Math.min(90, parseInt(String(windowDays || Sp.SP.WINDOW_DAYS_DEFAULT), 10) || Sp.SP.WINDOW_DAYS_DEFAULT));
  const params = { tenantId, windowDays: wd };
  const focusUserId = options.focusUserId ? normalizeUserId(options.focusUserId) : null;

  /** Platform and tenant admins are managers — exclude from punctuality / task / CC productivity scoring. */
  const ccUsersR = await query(
    `SELECT DISTINCT u.id, u.full_name, u.email
     FROM users u
     WHERE u.tenant_id = @tenantId
       AND LOWER(LTRIM(RTRIM(ISNULL(u.role, N'')))) NOT IN (N'super_admin', N'tenant_admin')
       AND (
         EXISTS (SELECT 1 FROM command_centre_grants g WHERE g.user_id = u.id)
         OR EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
       )`,
    params
  );
  const ccUsers = ccUsersR.recordset || [];
  const ccUserIds = new Set(ccUsers.map((u) => normalizeUserId(getRow(u, 'id'))).filter(Boolean));

  const byUser = new Map();
  ccUsers.forEach((u) => {
    const id = normalizeUserId(getRow(u, 'id'));
    if (!id) return;
    byUser.set(id, {
      userId: id,
      full_name: getRow(u, 'full_name') || '',
      email: getRow(u, 'email') || '',
      breakdown: ensureBreakdown(),
      total: 0,
    });
  });

  let teamLeaderRows = [];
  try {
    const tlr = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_page_roles r ON r.user_id = u.id AND r.page_id = N'team_leader_admin'
       WHERE u.tenant_id = @tenantId`,
      params
    );
    teamLeaderRows = tlr.recordset || [];
  } catch (_) {
    teamLeaderRows = [];
  }
  const teamLeaderIds = new Set();
  for (const row of teamLeaderRows) {
    const id = normalizeUserId(getRow(row, 'id'));
    if (!id) continue;
    teamLeaderIds.add(id);
    if (!byUser.has(id)) {
      byUser.set(id, {
        userId: id,
        full_name: getRow(row, 'full_name') || '',
        email: getRow(row, 'email') || '',
        breakdown: ensureBreakdown(),
        total: 0,
      });
    }
  }

  if (focusUserId && !byUser.has(focusUserId)) {
    try {
      const fur = await query(
        `SELECT id, full_name, email FROM users WHERE id = @userId AND tenant_id = @tenantId`,
        { tenantId, userId: focusUserId }
      );
      const row = (fur.recordset || [])[0];
      if (row) {
        ensureUserEntry(byUser, getRow(row, 'id'), {
          full_name: getRow(row, 'full_name') || '',
          email: getRow(row, 'email') || '',
        });
      }
    } catch (_) {
      /* profile user may not exist in tenant */
    }
  }

  const rosterUserIds = new Set([...ccUserIds, ...teamLeaderIds]);
  const shouldScoreUser = (uid) => {
    const id = normalizeUserId(uid);
    if (!id) return false;
    if (rosterUserIds.has(id)) return true;
    return focusUserId != null && id === focusUserId;
  };

  let sessions = [];
  try {
    const sr = await query(
      `SELECT s.user_id, s.clock_in_at, s.work_date, s.shift_type, s.status
       FROM shift_clock_sessions s
       WHERE s.tenant_id = @tenantId
         AND s.clock_in_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
         AND ISNULL(s.status, N'') <> N'cancelled'`,
      params
    );
    sessions = sr.recordset || [];
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('shift_clock')) throw e;
  }

  for (const row of sessions) {
    const uid = normalizeUserId(getRow(row, 'user_id'));
    if (!shouldScoreUser(uid)) continue;
    const wdYmd = toYmdFromRow(getRow(row, 'work_date'));
    const cin = getRow(row, 'clock_in_at');
    const ms = cin ? new Date(cin).getTime() : NaN;
    const { points, detail } = Sp.punctualityPoints(ms, wdYmd, getRow(row, 'shift_type'));
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'punctuality', {
        points,
        detail,
        work_date: wdYmd,
        shift_type: getRow(row, 'shift_type'),
        at: cin,
      });
    }
  }

  const evalCandidates = [];
  try {
    evalCandidates.push(...(await fetchStandardEvaluations(params)));
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('controller_evaluations') && !m.includes('invalid object')) throw e;
  }
  try {
    evalCandidates.push(...(await fetchSingleOpsEvaluations(params)));
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('single_ops') && !m.includes('invalid object')) throw e;
  }
  const evalRows = dedupeEvaluations(evalCandidates);

  for (const row of evalRows) {
    const uid = normalizeUserId(getRow(row, 'created_by_user_id'));
    if (!shouldScoreUser(uid)) continue;
    const ev = Sp.evaluationPointsFromAnswers(getRow(row, 'answers'));
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'evaluation', {
        points: ev.points,
        detail: ev.detail,
        yes: ev.yes,
        total: ev.total,
        report_id: getRow(row, 'shift_report_id'),
        report_kind: getRow(row, 'report_kind') || 'standard',
        at: getRow(row, 'created_at'),
      });
    }
  }

  let taskRows = [];
  try {
    const tr = await query(
      `SELECT t.id, t.due_date, t.completed_at, t.status, t.created_at, a.user_id
       FROM tasks t
       INNER JOIN task_assignments a ON a.task_id = t.id
       INNER JOIN users u ON u.id = a.user_id AND u.tenant_id = @tenantId
       WHERE t.tenant_id = @tenantId
         AND (
           (t.completed_at IS NOT NULL AND t.completed_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME()))
           OR (
             t.due_date IS NOT NULL
             AND CAST(t.due_date AS DATE) < CAST(GETDATE() AS DATE)
             AND LOWER(LTRIM(RTRIM(ISNULL(t.status, N'')))) <> N'completed'
             AND t.created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
           )
         )`,
      params
    );
    taskRows = tr.recordset || [];
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('tasks') && !m.includes('task_assignments')) throw e;
  }

  const seenTaskUser = new Set();
  for (const row of taskRows) {
    const uid = normalizeUserId(getRow(row, 'user_id'));
    if (!shouldScoreUser(uid)) continue;
    const tid = String(getRow(row, 'id'));
    const key = `${tid}:${uid}`;
    if (seenTaskUser.has(key)) continue;
    seenTaskUser.add(key);
    const due = toYmdFromRow(getRow(row, 'due_date'));
    const cat = getRow(row, 'completed_at') ? new Date(getRow(row, 'completed_at')).getTime() : NaN;
    const { points, detail } = Sp.taskCompletionPoints(due, cat, getRow(row, 'status'));
    if (points === 0 && detail === 'not_completed') continue;
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'tasks', {
        points,
        detail,
        task_id: tid,
        due_date: due,
        completed_at: getRow(row, 'completed_at'),
        status: getRow(row, 'status'),
      });
    }
  }

  const reportRows = [];
  try {
    reportRows.push(...(await fetchStandardReportTiming(params)));
  } catch (_) {
    /* table may not exist on older DBs */
  }
  try {
    reportRows.push(...(await fetchSingleOpsReportTiming(params)));
  } catch (_) {
    /* single-ops schema optional until migrated */
  }

  for (const row of reportRows) {
    const uid = normalizeUserId(getRow(row, 'created_by_user_id'));
    if (!shouldScoreUser(uid)) continue;
    const sub = getRow(row, 'submitted_at');
    const ms = sub ? new Date(sub).getTime() : NaN;
    const { points, detail } = Sp.reportTimingPoints(ms, row);
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'reportTiming', {
        points,
        detail,
        report_id: getRow(row, 'id'),
        report_kind: getRow(row, 'report_kind') || 'standard',
        submitted_at: sub,
      });
    }
  }

  const parseMemberIds = (json) => {
    if (!json || typeof json !== 'string') return [];
    try {
      const a = JSON.parse(json);
      return Array.isArray(a) ? a.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  };

  let objectiveRows = [];
  try {
    const or = await query(
      `SELECT id, scope, status, title, leader_user_id, member_user_ids, created_by, updated_at
       FROM shift_team_objectives
       WHERE tenant_id = @tenantId
         AND LOWER(LTRIM(RTRIM(status))) = N'achieved'
         AND updated_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
      params
    );
    objectiveRows = or.recordset || [];
  } catch (_) {
    objectiveRows = [];
  }

  for (const row of objectiveRows) {
    const credited = new Set();
    const createdBy = normalizeUserId(getRow(row, 'created_by'));
    const scope = String(getRow(row, 'scope') || '').toLowerCase();
    if (createdBy) credited.add(createdBy);
    if (scope === 'team') {
      const lid = normalizeUserId(getRow(row, 'leader_user_id'));
      if (lid) credited.add(lid);
      parseMemberIds(getRow(row, 'member_user_ids')).forEach((x) => {
        const mid = normalizeUserId(x);
        if (mid) credited.add(mid);
      });
    }
    const otitle = getRow(row, 'title') || 'Objective';
    for (const uid of credited) {
      if (!shouldScoreUser(uid)) continue;
      const b = byUser.get(uid);
      if (b) {
        addEvent(b.breakdown, 'teamProgress', {
          points: Sp.SP.OBJECTIVE_ACHIEVED,
          detail: 'objective_achieved',
          title: String(otitle).slice(0, 200),
          objective_id: getRow(row, 'id'),
        });
      }
    }
  }

  let progRatingRows = [];
  try {
    const pr = await query(
      `SELECT member_user_id, rating, work_date, period, narrative, created_at
       FROM management_team_ratings
       WHERE tenant_id = @tenantId
         AND created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
      params
    );
    progRatingRows = pr.recordset || [];
  } catch (_) {
    progRatingRows = [];
  }

  for (const row of progRatingRows) {
    const uid = normalizeUserId(getRow(row, 'member_user_id'));
    if (!shouldScoreUser(uid)) continue;
    const rt = parseInt(String(getRow(row, 'rating') ?? '3'), 10);
    const rNum = Number.isFinite(rt) ? Math.min(5, Math.max(1, rt)) : 3;
    const ptsAdj = (rNum - 3) * Sp.SP.TEAM_RATING_MULTIPLIER;
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'teamProgress', {
        points: ptsAdj,
        detail: 'management_rating',
        rating: rNum,
        period: getRow(row, 'period'),
        work_date: getRow(row, 'work_date'),
        narrative: getRow(row, 'narrative') ? String(getRow(row, 'narrative')).slice(0, 160) : '',
      });
    }
  }

  const questionnaireByLeaderDate = new Map();
  try {
    const tq = await query(
      `SELECT leader_user_id, work_date, created_at
       FROM team_leader_questionnaires
       WHERE tenant_id = @tenantId
         AND work_date >= CAST(DATEADD(DAY, -@windowDays, SYSUTCDATETIME()) AS DATE)`,
      params
    );
    for (const row of tq.recordset || []) {
      const lid = normalizeUserId(getRow(row, 'leader_user_id'));
      const wd = toYmdFromRow(getRow(row, 'work_date'));
      if (!lid || !wd) continue;
      const key = `${lid}:${wd}`;
      const cur = getRow(row, 'created_at');
      const prev = questionnaireByLeaderDate.get(key);
      if (!prev || new Date(cur).getTime() > new Date(prev).getTime()) {
        questionnaireByLeaderDate.set(key, cur);
      }
    }
  } catch (_) {
    /* optional table */
  }

  let leaderScheduleRows = [];
  try {
    const sr = await query(
      `SELECT s.user_id, e.work_date, e.shift_type
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId
       INNER JOIN user_page_roles r ON r.user_id = s.user_id AND r.page_id = N'team_leader_admin'
       WHERE CAST(e.work_date AS DATE) >= CAST(DATEADD(DAY, -@windowDays, SYSUTCDATETIME()) AS DATE)`,
      params
    );
    leaderScheduleRows = sr.recordset || [];
  } catch (_) {
    leaderScheduleRows = [];
  }

  const seenPulseShift = new Set();
  for (const row of leaderScheduleRows) {
    const uid = normalizeUserId(getRow(row, 'user_id'));
    if (!teamLeaderIds.has(uid)) continue;
    const wdYmd = toYmdFromRow(getRow(row, 'work_date'));
    const shiftType = String(getRow(row, 'shift_type') || 'day').toLowerCase() === 'night' ? 'night' : 'day';
    const dedupeKey = `${uid}:${wdYmd}:${shiftType}`;
    if (seenPulseShift.has(dedupeKey)) continue;
    seenPulseShift.add(dedupeKey);
    const submittedRaw = questionnaireByLeaderDate.get(`${uid}:${wdYmd}`);
    const submittedMs = submittedRaw ? new Date(submittedRaw).getTime() : NaN;
    const { points, detail, deadline, shiftEnd } = Sp.teamLeaderPulsePoints({
      workDateYmd: wdYmd,
      shiftType,
      submittedAtMs: submittedMs,
    });
    if (points === 0 && detail === 'pending') continue;
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'dailyPulse', {
        points,
        detail,
        work_date: wdYmd,
        shift_type: shiftType,
        submitted_at: submittedRaw || null,
        shift_end_at: Number.isFinite(shiftEnd) ? new Date(shiftEnd).toISOString() : null,
        deadline_at: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
      });
    }
  }

  let peSubmissionRows = [];
  try {
    const pr = await query(
      `SELECT s.id, s.evaluator_user_id, s.evaluatee_user_id, s.evaluation_period_id, s.relationship_type, s.submitted_at,
              ep.title AS period_title, ep.opened_at AS period_opened_at
       FROM pe_submissions s
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       WHERE s.tenant_id = @tenantId
         AND s.submitted_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
      params
    );
    peSubmissionRows = pr.recordset || [];
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('pe_submissions') && !m.includes('pe_evaluation')) throw e;
  }

  const givenByUserPeriod = new Map();
  const receivedByUserPeriod = new Map();
  const periodMeta = new Map();
  for (const row of peSubmissionRows) {
    const evaluatorId = normalizeUserId(getRow(row, 'evaluator_user_id'));
    const evaluateeId = normalizeUserId(getRow(row, 'evaluatee_user_id'));
    const periodId = String(getRow(row, 'evaluation_period_id') || '');
    if (periodId && !periodMeta.has(periodId)) {
      periodMeta.set(periodId, {
        title: getRow(row, 'period_title') || 'Evaluation period',
        opened_at: getRow(row, 'period_opened_at'),
      });
    }
    if (evaluatorId && periodId) {
      const gk = `${evaluatorId}:${periodId}`;
      if (!givenByUserPeriod.has(gk)) givenByUserPeriod.set(gk, new Set());
      if (evaluateeId) givenByUserPeriod.get(gk).add(evaluateeId);
    }
    if (evaluateeId && periodId) {
      const rk = `${evaluateeId}:${periodId}`;
      receivedByUserPeriod.set(rk, (receivedByUserPeriod.get(rk) || 0) + 1);
    }
  }

  const peParticipationKeys = new Set([...givenByUserPeriod.keys(), ...receivedByUserPeriod.keys()]);
  for (const key of peParticipationKeys) {
    const [uid, periodId] = key.split(':');
    const b = ensureUserEntry(byUser, uid);
    if (!b) continue;
    const givenCount = givenByUserPeriod.get(key)?.size || 0;
    const receivedCount = receivedByUserPeriod.get(key) || 0;
    const part = computeParticipationPoints(givenCount, receivedCount);
    const meta = periodMeta.get(periodId) || { title: 'Evaluation period' };
    addEvent(b.breakdown, 'performanceEvaluation', {
      points: part.given_points,
      detail: part.given_met ? 'participation_given_met' : 'participation_given_incomplete',
      period_id: periodId,
      period_title: meta.title,
      evaluations_given: givenCount,
      evaluations_received: receivedCount,
      min_required: part.min_required,
      at: meta.opened_at,
    });
    addEvent(b.breakdown, 'performanceEvaluation', {
      points: part.received_points,
      detail: part.received_met ? 'participation_received_met' : 'participation_received_incomplete',
      period_id: periodId,
      period_title: meta.title,
      evaluations_given: givenCount,
      evaluations_received: receivedCount,
      min_required: part.min_required,
      at: meta.opened_at,
    });
  }

  let peQualityRows = [];
  try {
    const qr = await query(
      `SELECT s.id AS submission_id, s.evaluatee_user_id, s.relationship_type, s.submitted_at,
              ep.title AS period_title, AVG(CAST(a.score AS FLOAT)) AS avg_score
       FROM pe_submissions s
       INNER JOIN pe_evaluation_periods ep ON ep.id = s.evaluation_period_id
       INNER JOIN pe_answers a ON a.submission_id = s.id
       WHERE s.tenant_id = @tenantId
         AND s.submitted_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
       GROUP BY s.id, s.evaluatee_user_id, s.relationship_type, s.submitted_at, ep.title`,
      params
    );
    peQualityRows = qr.recordset || [];
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('pe_answers') && !m.includes('pe_submissions')) throw e;
  }

  for (const row of peQualityRows) {
    const uid = normalizeUserId(getRow(row, 'evaluatee_user_id'));
    const b = ensureUserEntry(byUser, uid);
    if (!b) continue;
    const { points, detail, avg } = Sp.peerEvaluationQualityPoints(getRow(row, 'avg_score'));
    if (points === 0 && detail === 'no_scores') continue;
    addEvent(b.breakdown, 'performanceEvaluation', {
      points,
      detail,
      avg_score: avg,
      submission_id: getRow(row, 'submission_id'),
      relationship_type: getRow(row, 'relationship_type'),
      period_title: getRow(row, 'period_title'),
      at: getRow(row, 'submitted_at'),
    });
  }

  let hrEvalRows = [];
  try {
    const hr = await query(
      `SELECT id, user_id, period, rating, created_at
       FROM evaluations
       WHERE tenant_id = @tenantId
         AND created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
      params
    );
    hrEvalRows = hr.recordset || [];
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('evaluations') && !m.includes('invalid object')) throw e;
  }

  for (const row of hrEvalRows) {
    const uid = normalizeUserId(getRow(row, 'user_id'));
    const b = ensureUserEntry(byUser, uid);
    if (!b) continue;
    const { points, detail } = Sp.hrEvaluationRatingPoints(getRow(row, 'rating'));
    addEvent(b.breakdown, 'performanceEvaluation', {
      points,
      detail,
      evaluation_id: getRow(row, 'id'),
      period: getRow(row, 'period'),
      rating: getRow(row, 'rating'),
      at: getRow(row, 'created_at'),
    });
  }

  const people = [];
  for (const [, v] of byUser) {
    v.total = Sp.sumBreakdown(v.breakdown);
    people.push(v);
  }

  const rosterPeople = people.filter((p) => rosterUserIds.has(normalizeUserId(p.userId)));
  const totals = rosterPeople.map((p) => p.total);
  const groupAverage = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

  const componentTotals = Object.fromEntries(SCORE_CATEGORY_IDS.map((k) => [k, 0]));
  for (const p of rosterPeople) {
    for (const k of SCORE_CATEGORY_IDS) {
      componentTotals[k] += p.breakdown[k]?.points || 0;
    }
  }
  const rosterN = Math.max(1, rosterPeople.length);
  const componentAverages = Object.fromEntries(
    SCORE_CATEGORY_IDS.map((k) => [k, Math.round((componentTotals[k] / rosterN) * 10) / 10])
  );

  return {
    windowDays: wd,
    fromYmd: addCalendarDays(todayYmd(), -wd),
    toYmd: todayYmd(),
    ccUserCount: ccUsers.length,
    rosterUserCount: rosterPeople.length,
    people,
    rosterPeople,
    componentAverages,
    groupAverage: Math.round(groupAverage * 10) / 10,
    focusUserRoles: focusUserId
      ? {
          isCommandCentreMember: ccUserIds.has(focusUserId),
          isTeamLeader: teamLeaderIds.has(focusUserId),
        }
      : null,
    scoring: {
      punctuality: { onTime: Sp.SP.PUNCTUALITY_ON, late: Sp.SP.PUNCTUALITY_LATE, graceMinutes: Sp.SP.CLOCK_GRACE_MINUTES },
      evaluation: { good: Sp.SP.EVAL_GOOD, bad: Sp.SP.EVAL_BAD, minYesOf: `${Sp.SP.EVAL_MIN_YES}/${Sp.SP.EVAL_QUESTIONS}` },
      tasks: { onTime: Sp.SP.TASK_ON, lateOrOverdue: Sp.SP.TASK_LATE },
      reportHandIn: {
        onTime: Sp.SP.REPORT_ON,
        late: Sp.SP.REPORT_LATE,
        by: `Shift end + ${Sp.SP.REPORT_HANDOFF_MINUTES} min (SAST)`,
        note: 'Standard and single-operations Command Centre shift reports.',
      },
      teamProgress: {
        objectiveAchieved: Sp.SP.OBJECTIVE_ACHIEVED,
        ratingNeutral: 3,
        ratingMultiplier: Sp.SP.TEAM_RATING_MULTIPLIER,
        note: 'Achieved measurable objectives and management 1–5 ratings (neutral at 3).',
      },
      dailyPulse: {
        onTime: Sp.SP.TEAM_LEADER_PULSE_ON,
        missed: Sp.SP.TEAM_LEADER_PULSE_MISSED,
        withinHoursAfterShiftEnd: Sp.SP.TEAM_LEADER_PULSE_HOURS_AFTER_SHIFT,
        note: 'Scheduled team leader shifts only: Daily pulse within 12h after shift end (+10), else after deadline (−30).',
      },
      performanceEvaluation: {
        receivedStrong: Sp.SP.PE_RECEIVED_STRONG,
        receivedOk: Sp.SP.PE_RECEIVED_OK,
        receivedWeak: Sp.SP.PE_RECEIVED_WEAK,
        hrExcellent: Sp.SP.HR_EVAL_EXCELLENT,
        hrGood: Sp.SP.HR_EVAL_GOOD,
        hrNeutral: Sp.SP.HR_EVAL_NEUTRAL,
        hrPoor: Sp.SP.HR_EVAL_POOR,
        participation: PE_SCORE_RULES,
        note: 'Colleague peer evaluations (participation + feedback quality) and management HR employee evaluations.',
      },
    },
  };
}

function toYmdFromRow(v) {
  if (v == null) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

function buildPersonalAnalytics(mine, rosterPeople, componentAverages, groupAverage) {
  if (!mine) {
    return {
      hasActivity: false,
      rank: null,
      teamSize: rosterPeople.length,
      vsTeamAverage: 0,
      eventCount: 0,
      positiveEvents: 0,
      negativeEvents: 0,
      categories: SCORE_CATEGORY_IDS.map((id) => ({
        id,
        points: 0,
        events: 0,
        teamAverage: componentAverages[id] ?? 0,
        delta: 0,
      })),
      strongestCategory: null,
      attentionCategory: null,
      percentile: null,
    };
  }

  const breakdown = mine.breakdown || ensureBreakdown();
  let eventCount = 0;
  let positiveEvents = 0;
  let negativeEvents = 0;
  const categories = SCORE_CATEGORY_IDS.map((id) => {
    const row = breakdown[id] || { points: 0, events: [] };
    const events = row.events || [];
    eventCount += events.length;
    for (const ev of events) {
      const pts = Number(ev.points) || 0;
      if (pts > 0) positiveEvents += 1;
      else if (pts < 0) negativeEvents += 1;
    }
    const teamAvg = componentAverages[id] ?? 0;
    return {
      id,
      points: row.points || 0,
      events: events.length,
      teamAverage: teamAvg,
      delta: Math.round(((row.points || 0) - teamAvg) * 10) / 10,
    };
  });

  const roster = [...rosterPeople].sort((a, b) => b.total - a.total);
  const rankIndex = roster.findIndex((p) => sameGuid(p.userId, mine.userId));
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const teamSize = roster.length;
  const vsTeamAverage = Math.round((mine.total - groupAverage) * 10) / 10;

  const withEvents = categories.filter((c) => c.events > 0);
  const strongest = [...withEvents].sort((a, b) => b.points - a.points)[0] || null;
  const attention = [...withEvents].sort((a, b) => a.points - b.points)[0] || null;
  const percentile =
    rank != null && teamSize > 1 ? Math.round(((teamSize - rank) / (teamSize - 1)) * 100) : null;

  return {
    hasActivity: eventCount > 0 || mine.total !== 0,
    rank,
    teamSize,
    vsTeamAverage,
    eventCount,
    positiveEvents,
    negativeEvents,
    categories,
    strongestCategory: strongest?.id || null,
    attentionCategory: attention?.id || null,
    percentile,
  };
}

router.use(requireAuth);
router.use(loadUser);

router.get('/me', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const windowDays = parseInt(String(req.query.days || Sp.SP.WINDOW_DAYS_DEFAULT), 10);
    const userId = normalizeUserId(req.user.id);
    if (!userId) return res.status(400).json({ error: 'Invalid user context' });
    const {
      people,
      rosterPeople,
      groupAverage,
      windowDays: wd,
      fromYmd,
      toYmd,
      scoring,
      componentAverages,
      rosterUserCount,
      ccUserCount,
      focusUserRoles,
    } = await computeTenantScores(tenantId, windowDays, { focusUserId: userId });
    const mine = findPerson(people, userId);
    const breakdown = mine?.breakdown || ensureBreakdown();
    const total = mine ? mine.total : 0;
    const analytics = buildPersonalAnalytics(mine, rosterPeople, componentAverages, groupAverage);
    res.json({
      userId: req.user.id,
      full_name: req.user.full_name,
      windowDays: wd,
      fromYmd,
      toYmd,
      total,
      groupAverage,
      rosterUserCount,
      ccUserCount,
      breakdown,
      scoring,
      componentAverages,
      analytics,
      roles: focusUserRoles || { isCommandCentreMember: false, isTeamLeader: false },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/command-centre-dashboard', requirePageAccess('command_centre'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const windowDays = parseInt(String(req.query.days || Sp.SP.WINDOW_DAYS_DEFAULT), 10);
    const { people, groupAverage, windowDays: wd, fromYmd, toYmd, scoring, ccUserCount } = await computeTenantScores(tenantId, windowDays);
    const mine = findPerson(people, req.user.id);
    res.json({
      windowDays: wd,
      fromYmd,
      toYmd,
      personalTotal: mine ? mine.total : 0,
      groupAverage,
      ccUserCount,
      components: mine
        ? {
            punctuality: { points: mine.breakdown.punctuality.points, n: mine.breakdown.punctuality.events.length },
            evaluation: { points: mine.breakdown.evaluation.points, n: mine.breakdown.evaluation.events.length },
            tasks: { points: mine.breakdown.tasks.points, n: mine.breakdown.tasks.events.length },
            reportTiming: { points: mine.breakdown.reportTiming.points, n: mine.breakdown.reportTiming.events.length },
            teamProgress: { points: mine.breakdown.teamProgress?.points || 0, n: mine.breakdown.teamProgress?.events?.length || 0 },
            dailyPulse: { points: mine.breakdown.dailyPulse?.points || 0, n: mine.breakdown.dailyPulse?.events?.length || 0 },
            performanceEvaluation: {
              points: mine.breakdown.performanceEvaluation?.points || 0,
              n: mine.breakdown.performanceEvaluation?.events?.length || 0,
            },
          }
        : null,
      scoring,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tenant', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const windowDays = parseInt(String(req.query.days || Sp.SP.WINDOW_DAYS_DEFAULT), 10);
    const { people, groupAverage, windowDays: wd, fromYmd, toYmd, scoring, ccUserCount } = await computeTenantScores(tenantId, windowDays);

    const nameById = new Map();
    const ur = await query(
      `SELECT id, full_name, email FROM users WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    for (const u of ur.recordset || []) {
      const id = normalizeUserId(getRow(u, 'id'));
      if (id) nameById.set(id, { full_name: getRow(u, 'full_name'), email: getRow(u, 'email') });
    }

    const enriched = people
      .map((p) => {
        const pid = normalizeUserId(p.userId);
        const meta = nameById.get(pid) || {};
        return {
          userId: p.userId,
          full_name: p.full_name || meta.full_name || '—',
          email: p.email || meta.email || '',
          total: p.total,
          breakdown: p.breakdown,
        };
      })
      .sort((a, b) => b.total - a.total);

    const totals = enriched.map((x) => x.total).sort((a, b) => a - b);
    const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;

    const componentTotals = {
      punctuality: 0,
      evaluation: 0,
      tasks: 0,
      reportTiming: 0,
      teamProgress: 0,
      dailyPulse: 0,
      performanceEvaluation: 0,
    };
    for (const p of enriched) {
      componentTotals.punctuality += p.breakdown.punctuality.points;
      componentTotals.evaluation += p.breakdown.evaluation.points;
      componentTotals.tasks += p.breakdown.tasks.points;
      componentTotals.reportTiming += p.breakdown.reportTiming.points;
      componentTotals.teamProgress += p.breakdown.teamProgress?.points || 0;
      componentTotals.dailyPulse += p.breakdown.dailyPulse?.points || 0;
      componentTotals.performanceEvaluation += p.breakdown.performanceEvaluation?.points || 0;
    }
    const n = Math.max(1, enriched.length);
    const componentAverages = {
      punctuality: Math.round((componentTotals.punctuality / n) * 10) / 10,
      evaluation: Math.round((componentTotals.evaluation / n) * 10) / 10,
      tasks: Math.round((componentTotals.tasks / n) * 10) / 10,
      reportTiming: Math.round((componentTotals.reportTiming / n) * 10) / 10,
      teamProgress: Math.round((componentTotals.teamProgress / n) * 10) / 10,
      dailyPulse: Math.round((componentTotals.dailyPulse / n) * 10) / 10,
      performanceEvaluation: Math.round((componentTotals.performanceEvaluation / n) * 10) / 10,
    };

    res.json({
      windowDays: wd,
      fromYmd,
      toYmd,
      ccUserCount,
      groupAverage,
      median,
      min: totals.length ? totals[0] : 0,
      max: totals.length ? totals[totals.length - 1] : 0,
      people: enriched,
      componentTotals,
      componentAverages,
      scoring,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
