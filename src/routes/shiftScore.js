/**
 * Shift productivity score API — punctuality, evaluations, tasks, report hand-in timing.
 */
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { todayYmd, addCalendarDays } from '../lib/appTime.js';
import * as Sp from '../lib/shiftProductivityScore.js';

const router = Router();

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

/** Latest evaluation per shift report (by created_at). */
function dedupeEvaluations(rows) {
  const byReport = new Map();
  for (const row of rows) {
    const rid = String(getRow(row, 'shift_report_id') || '');
    if (!rid) continue;
    const cur = getRow(row, 'created_at');
    const prev = byReport.get(rid);
    if (!prev || new Date(cur).getTime() > new Date(getRow(prev, 'created_at')).getTime()) {
      byReport.set(rid, row);
    }
  }
  return [...byReport.values()];
}

async function computeTenantScores(tenantId, windowDays) {
  const wd = Math.max(7, Math.min(90, parseInt(String(windowDays || Sp.SP.WINDOW_DAYS_DEFAULT), 10) || Sp.SP.WINDOW_DAYS_DEFAULT));
  const params = { tenantId, windowDays: wd };

  const ccUsersR = await query(
    `SELECT DISTINCT u.id, u.full_name, u.email
     FROM users u
     WHERE u.tenant_id = @tenantId
       AND (
         EXISTS (SELECT 1 FROM command_centre_grants g WHERE g.user_id = u.id)
         OR EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
       )`,
    params
  );
  const ccUsers = ccUsersR.recordset || [];
  const ccUserIds = new Set(ccUsers.map((u) => String(getRow(u, 'id'))));

  const byUser = new Map();
  ccUsers.forEach((u) => {
    const id = String(getRow(u, 'id'));
    if (!id) return;
    byUser.set(id, {
      userId: id,
      full_name: getRow(u, 'full_name') || '',
      email: getRow(u, 'email') || '',
      breakdown: ensureBreakdown(),
      total: 0,
    });
  });

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
    const uid = String(getRow(row, 'user_id') || '');
    if (!ccUserIds.has(uid)) continue;
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

  let evalRows = [];
  try {
    const er = await query(
      `SELECT e.answers, e.created_at, e.shift_report_id, r.created_by_user_id
       FROM controller_evaluations e
       INNER JOIN command_centre_shift_reports r ON r.id = e.shift_report_id
       INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
       WHERE e.created_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())`,
      params
    );
    evalRows = dedupeEvaluations(er.recordset || []);
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('controller_evaluations') && !m.includes('invalid object')) throw e;
  }

  for (const row of evalRows) {
    const uid = String(getRow(row, 'created_by_user_id') || '');
    if (!ccUserIds.has(uid)) continue;
    const ev = Sp.evaluationPointsFromAnswers(getRow(row, 'answers'));
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'evaluation', {
        points: ev.points,
        detail: ev.detail,
        yes: ev.yes,
        total: ev.total,
        report_id: getRow(row, 'shift_report_id'),
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
    const uid = String(getRow(row, 'user_id') || '');
    if (!ccUserIds.has(uid)) continue;
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

  let reportRows = [];
  try {
    const rr = await query(
      `SELECT r.id, r.created_by_user_id, r.submitted_at, r.shift_start, r.shift_end, r.shift_date, r.report_date, r.status
       FROM command_centre_shift_reports r
       INNER JOIN users u ON u.id = r.created_by_user_id AND u.tenant_id = @tenantId
       WHERE r.submitted_at IS NOT NULL
         AND r.submitted_at >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
         AND LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) <> N'draft'`,
      params
    );
    reportRows = rr.recordset || [];
  } catch (_) {
    reportRows = [];
  }

  for (const row of reportRows) {
    const uid = String(getRow(row, 'created_by_user_id') || '');
    if (!ccUserIds.has(uid)) continue;
    const sub = getRow(row, 'submitted_at');
    const ms = sub ? new Date(sub).getTime() : NaN;
    const { points, detail } = Sp.reportTimingPoints(ms, row);
    const b = byUser.get(uid);
    if (b) {
      addEvent(b.breakdown, 'reportTiming', {
        points,
        detail,
        report_id: getRow(row, 'id'),
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
    const createdBy = String(getRow(row, 'created_by') || '');
    const scope = String(getRow(row, 'scope') || '').toLowerCase();
    if (createdBy) credited.add(createdBy);
    if (scope === 'team') {
      const lid = String(getRow(row, 'leader_user_id') || '');
      if (lid) credited.add(lid);
      parseMemberIds(getRow(row, 'member_user_ids')).forEach((x) => credited.add(x));
    }
    const otitle = getRow(row, 'title') || 'Objective';
    for (const uid of credited) {
      if (!ccUserIds.has(uid)) continue;
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
    const uid = String(getRow(row, 'member_user_id') || '');
    if (!ccUserIds.has(uid)) continue;
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

  const people = [];
  for (const [, v] of byUser) {
    v.total = Sp.sumBreakdown(v.breakdown);
    people.push(v);
  }

  const totals = people.map((p) => p.total);
  const groupAverage = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

  return {
    windowDays: wd,
    fromYmd: addCalendarDays(todayYmd(), -wd),
    toYmd: todayYmd(),
    ccUserCount: ccUsers.length,
    people,
    groupAverage: Math.round(groupAverage * 10) / 10,
    scoring: {
      punctuality: { onTime: Sp.SP.PUNCTUALITY_ON, late: Sp.SP.PUNCTUALITY_LATE, graceMinutes: Sp.SP.CLOCK_GRACE_MINUTES },
      evaluation: { good: Sp.SP.EVAL_GOOD, bad: Sp.SP.EVAL_BAD, minYesOf: `${Sp.SP.EVAL_MIN_YES}/${Sp.SP.EVAL_QUESTIONS}` },
      tasks: { onTime: Sp.SP.TASK_ON, lateOrOverdue: Sp.SP.TASK_LATE },
      reportHandIn: { onTime: Sp.SP.REPORT_ON, late: Sp.SP.REPORT_LATE, by: `Shift end + ${Sp.SP.REPORT_HANDOFF_MINUTES} min (SAST)` },
      teamProgress: {
        objectiveAchieved: Sp.SP.OBJECTIVE_ACHIEVED,
        ratingNeutral: 3,
        ratingMultiplier: Sp.SP.TEAM_RATING_MULTIPLIER,
        note: 'Achieved measurable objectives and management 1–5 ratings (neutral at 3).',
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

router.use(requireAuth);
router.use(loadUser);

router.get('/me', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const windowDays = parseInt(String(req.query.days || Sp.SP.WINDOW_DAYS_DEFAULT), 10);
    const { people, groupAverage, windowDays: wd, fromYmd, toYmd, scoring } = await computeTenantScores(tenantId, windowDays);
    const mine = people.find((p) => String(p.userId) === String(req.user.id));
    const breakdown = mine?.breakdown || ensureBreakdown();
    const total = mine ? mine.total : 0;
    res.json({
      userId: req.user.id,
      full_name: req.user.full_name,
      windowDays: wd,
      fromYmd,
      toYmd,
      total,
      groupAverage,
      breakdown,
      scoring,
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
    const mine = people.find((p) => String(p.userId) === String(req.user.id));
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
      nameById.set(String(getRow(u, 'id')), { full_name: getRow(u, 'full_name'), email: getRow(u, 'email') });
    }

    const enriched = people
      .map((p) => {
        const meta = nameById.get(String(p.userId)) || {};
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

    const componentTotals = { punctuality: 0, evaluation: 0, tasks: 0, reportTiming: 0, teamProgress: 0 };
    for (const p of enriched) {
      componentTotals.punctuality += p.breakdown.punctuality.points;
      componentTotals.evaluation += p.breakdown.evaluation.points;
      componentTotals.tasks += p.breakdown.tasks.points;
      componentTotals.reportTiming += p.breakdown.reportTiming.points;
      componentTotals.teamProgress += p.breakdown.teamProgress?.points || 0;
    }
    const n = Math.max(1, enriched.length);
    const componentAverages = {
      punctuality: Math.round((componentTotals.punctuality / n) * 10) / 10,
      evaluation: Math.round((componentTotals.evaluation / n) * 10) / 10,
      tasks: Math.round((componentTotals.tasks / n) * 10) / 10,
      reportTiming: Math.round((componentTotals.reportTiming / n) * 10) / 10,
      teamProgress: Math.round((componentTotals.teamProgress / n) * 10) / 10,
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
