import { addCalendarDays } from './appTime.js';

/**
 * Shift productivity score — rules (rolling window, e.g. 30 days):
 * - Punctuality: on-time clock-in vs scheduled day/night start → +15; late (beyond grace) → -15
 * - Controller evaluation (per approved report evaluated): ≥ threshold Yes → +20; else → -20
 * - Tasks (assignee): completed on/before due date → +30; completed after due or still overdue → -30
 * - Shift report submission by shift-end + 15 min (06:15 / 18:15 SAST anchor) → +50; else → -50
 *
 * Wall times use fixed SAST offset (+2, no DST) matching server app calendar defaults.
 */

export const SP = {
  WINDOW_DAYS_DEFAULT: 30,
  PUNCTUALITY_ON: 15,
  PUNCTUALITY_LATE: -15,
  CLOCK_GRACE_MINUTES: 5,
  EVAL_GOOD: 20,
  EVAL_BAD: -20,
  EVAL_MIN_YES: 9,
  EVAL_QUESTIONS: 11,
  TASK_ON: 30,
  TASK_LATE: -30,
  REPORT_ON: 50,
  REPORT_LATE: -50,
  /** Per management 1–5 rating: (rating − 3) × multiplier (neutral at 3). */
  TEAM_RATING_MULTIPLIER: 5,
  /** When a measurable shift/team objective is marked achieved (per credited CC user). */
  OBJECTIVE_ACHIEVED: 15,
  /** Minutes after nominal shift end (06:00 / 18:00) allowed for report hand-in */
  REPORT_HANDOFF_MINUTES: 15,
};

/** SAST = UTC+2 (Africa/Johannesburg, no DST) */
const OFFSET_MS = 2 * 60 * 60 * 1000;

export function zonedWallToUtcMs(ymd, hour, minute) {
  const s = String(ymd || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d, hour, minute, 0, 0) - OFFSET_MS;
}

export function utcMsToYmdInSast(ms) {
  const u = new Date(ms + OFFSET_MS);
  return u.toISOString().slice(0, 10);
}

export function expectedClockInUtcMs(workDateYmd, shiftType) {
  const night = String(shiftType || '').toLowerCase() === 'night';
  if (night) return zonedWallToUtcMs(workDateYmd, 18, 0);
  return zonedWallToUtcMs(workDateYmd, 6, 0);
}

export function punctualityPoints(clockInAtMs, workDateYmd, shiftType) {
  const expected = expectedClockInUtcMs(workDateYmd, shiftType);
  if (!Number.isFinite(expected) || !Number.isFinite(clockInAtMs)) return { points: 0, detail: 'no_data' };
  const grace = SP.CLOCK_GRACE_MINUTES * 60 * 1000;
  if (clockInAtMs <= expected + grace) return { points: SP.PUNCTUALITY_ON, detail: 'on_time' };
  return { points: SP.PUNCTUALITY_LATE, detail: 'late' };
}

export function inferReportShiftType(row) {
  const st = String(row?.shift_type || row?.shiftType || '').toLowerCase();
  if (st === 'night' || st === 'day') return st;
  const start = String(row?.shift_start || row?.shiftStart || '').toLowerCase();
  const end = String(row?.shift_end || row?.shiftEnd || '').toLowerCase();
  if (/18\s*:\s*|19\s*:\s*|20\s*:\s*|21\s*:\s*|22\s*:\s*|23\s*:\s*/.test(start)) return 'night';
  if ((/18\s*:\s*|19\s*:\s*/.test(start) || /06\s*:\s*|05\s*:\s*/.test(end)) && /06\s*:\s*/.test(end)) return 'night';
  return 'day';
}

/** Report must be submitted by shift end + REPORT_HANDOFF_MINUTES in SAST */
export function reportHandoffDeadlineUtcMs(row) {
  const anchor = String(row?.shift_date || row?.shiftDate || row?.report_date || row?.reportDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return NaN;
  const shiftType = inferReportShiftType(row);
  const extraMin = SP.REPORT_HANDOFF_MINUTES;
  if (shiftType === 'night') {
    const morningAfter = addCalendarDays(anchor, 1);
    return zonedWallToUtcMs(morningAfter, 6, 0) + extraMin * 60 * 1000;
  }
  const endDay = zonedWallToUtcMs(anchor, 18, 0);
  return endDay + extraMin * 60 * 1000;
}

export function reportTimingPoints(submittedAtMs, row) {
  const dl = reportHandoffDeadlineUtcMs(row);
  if (!Number.isFinite(submittedAtMs) || !Number.isFinite(dl)) return { points: 0, detail: 'no_data' };
  const slack = 2 * 60 * 1000;
  if (submittedAtMs <= dl + slack) return { points: SP.REPORT_ON, detail: 'on_time' };
  return { points: SP.REPORT_LATE, detail: 'late' };
}

export function evaluationPointsFromAnswers(answersRaw) {
  let obj = answersRaw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return { points: 0, yes: 0, total: 0, detail: 'parse_error' };
    }
  }
  if (!obj || typeof obj !== 'object') return { points: 0, yes: 0, total: 0, detail: 'empty' };
  let yes = 0;
  let total = 0;
  for (let i = 1; i <= SP.EVAL_QUESTIONS; i++) {
    const key = `q${i}`;
    const block = obj[key];
    if (!block || typeof block !== 'object') continue;
    total += 1;
    if (String(block.value || '').toLowerCase() === 'yes') yes += 1;
  }
  if (total === 0) return { points: 0, yes: 0, total: 0, detail: 'no_questions' };
  const good = yes >= SP.EVAL_MIN_YES;
  return {
    points: good ? SP.EVAL_GOOD : SP.EVAL_BAD,
    yes,
    total,
    detail: good ? 'strong' : 'needs_improvement',
  };
}

export function taskCompletionPoints(dueYmd, completedAtMs, status) {
  const st = String(status || '').toLowerCase();
  if (st !== 'completed' || !Number.isFinite(completedAtMs)) {
    if (st === 'completed') return { points: 0, detail: 'no_completed_at' };
    if (dueYmd && /^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
      const dueEnd = zonedWallToUtcMs(dueYmd, 23, 59) + 59 * 1000 + 999;
      const now = Date.now();
      if (now > dueEnd) return { points: SP.TASK_LATE, detail: 'overdue_open' };
    }
    return { points: 0, detail: 'not_completed' };
  }
  const doneYmd = utcMsToYmdInSast(completedAtMs);
  if (!dueYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) return { points: SP.TASK_ON, detail: 'completed_no_due' };
  if (doneYmd <= dueYmd) return { points: SP.TASK_ON, detail: 'on_time' };
  return { points: SP.TASK_LATE, detail: 'completed_late' };
}

export function emptyScoreBreakdown() {
  return {
    punctuality: { points: 0, events: [] },
    evaluation: { points: 0, events: [] },
    tasks: { points: 0, events: [] },
    reportTiming: { points: 0, events: [] },
    teamProgress: { points: 0, events: [] },
  };
}

export function sumBreakdown(b) {
  return (
    (b.punctuality?.points || 0) +
    (b.evaluation?.points || 0) +
    (b.tasks?.points || 0) +
    (b.reportTiming?.points || 0) +
    (b.teamProgress?.points || 0)
  );
}
