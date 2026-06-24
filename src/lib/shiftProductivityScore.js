import { addCalendarDays } from './appTime.js';

/**
 * Shift productivity score — rules (rolling window, e.g. 30 days):
 * - Punctuality: on-time clock-in vs scheduled day/night start → +15; late (beyond grace) → -15
 * - Controller evaluation (per approved report evaluated): ≥ threshold Yes → +20; else → -20
 * - Tasks (assignee): completed on/before due date → +30; completed after due or still overdue → -30
 * - Shift report submission (standard + single-ops CC reports) by shift-end + 15 min (06:15 / 18:15 SAST) → +50; else → -50
 * - Team leader Daily pulse on scheduled shift: submitted within 12h after shift end → +10; else after deadline → -30
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
  /** Team leader admin (Daily pulse) due within this many hours after shift end */
  TEAM_LEADER_PULSE_HOURS_AFTER_SHIFT: 12,
  TEAM_LEADER_PULSE_ON: 10,
  TEAM_LEADER_PULSE_MISSED: -30,
  /** Colleague performance evaluation — avg answer score (1–3) on feedback received. */
  PE_RECEIVED_STRONG: 15,
  PE_RECEIVED_OK: 5,
  PE_RECEIVED_WEAK: -10,
  /** Management employee evaluation (HR evaluations table) — free-text rating. */
  HR_EVAL_EXCELLENT: 20,
  HR_EVAL_GOOD: 10,
  HR_EVAL_NEUTRAL: 0,
  HR_EVAL_POOR: -20,
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
/** Nominal shift end in SAST: day → 18:00 same date; night → 06:00 next calendar day */
export function shiftEndUtcMs(workDateYmd, shiftType) {
  const anchor = String(workDateYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return NaN;
  const st = String(shiftType || '').toLowerCase();
  if (st === 'night') {
    const morningAfter = addCalendarDays(anchor, 1);
    return zonedWallToUtcMs(morningAfter, 6, 0);
  }
  return zonedWallToUtcMs(anchor, 18, 0);
}

/** Daily pulse must be submitted by shift end + TEAM_LEADER_PULSE_HOURS_AFTER_SHIFT */
export function teamLeaderPulseDeadlineUtcMs(workDateYmd, shiftType) {
  const end = shiftEndUtcMs(workDateYmd, shiftType);
  if (!Number.isFinite(end)) return NaN;
  return end + SP.TEAM_LEADER_PULSE_HOURS_AFTER_SHIFT * 60 * 60 * 1000;
}

/**
 * @param {{ workDateYmd: string, shiftType: string, submittedAtMs?: number, nowMs?: number }} opts
 */
export function teamLeaderPulsePoints(opts) {
  const { workDateYmd, shiftType, submittedAtMs, nowMs = Date.now() } = opts;
  const deadline = teamLeaderPulseDeadlineUtcMs(workDateYmd, shiftType);
  const shiftEnd = shiftEndUtcMs(workDateYmd, shiftType);
  if (!Number.isFinite(deadline)) return { points: 0, detail: 'no_schedule', deadline, shiftEnd };
  const slack = 60 * 1000;
  if (Number.isFinite(submittedAtMs) && submittedAtMs <= deadline + slack) {
    return { points: SP.TEAM_LEADER_PULSE_ON, detail: 'pulse_on_time', deadline, shiftEnd };
  }
  if (nowMs >= deadline) {
    return { points: SP.TEAM_LEADER_PULSE_MISSED, detail: 'pulse_missed', deadline, shiftEnd };
  }
  return { points: 0, detail: 'pending', deadline, shiftEnd };
}

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

export function hrEvaluationRatingPoints(ratingRaw) {
  const s = String(ratingRaw || '').toLowerCase().trim();
  if (!s) return { points: 0, detail: 'no_rating' };
  if (/exceed|outstanding|excellent|exceptional|^5$|^4$/.test(s)) {
    return { points: SP.HR_EVAL_EXCELLENT, detail: 'hr_excellent' };
  }
  if (/below|unsatisf|poor|need|under|^1$|^2$/.test(s)) {
    return { points: SP.HR_EVAL_POOR, detail: 'hr_poor' };
  }
  if (/meet|satisf|good|^3$/.test(s)) {
    return { points: SP.HR_EVAL_GOOD, detail: 'hr_good' };
  }
  return { points: SP.HR_EVAL_NEUTRAL, detail: 'hr_neutral' };
}

export function peerEvaluationQualityPoints(avgScore) {
  const avg = Number(avgScore);
  if (!Number.isFinite(avg)) return { points: 0, detail: 'no_scores', avg: null };
  if (avg >= 2.5) return { points: SP.PE_RECEIVED_STRONG, detail: 'strong_peer_feedback', avg };
  if (avg >= 2.0) return { points: SP.PE_RECEIVED_OK, detail: 'satisfactory_peer_feedback', avg };
  return { points: SP.PE_RECEIVED_WEAK, detail: 'weak_peer_feedback', avg };
}

export function emptyScoreBreakdown() {
  return {
    punctuality: { points: 0, events: [] },
    evaluation: { points: 0, events: [] },
    tasks: { points: 0, events: [] },
    reportTiming: { points: 0, events: [] },
    teamProgress: { points: 0, events: [] },
    dailyPulse: { points: 0, events: [] },
    performanceEvaluation: { points: 0, events: [] },
  };
}

export function sumBreakdown(b) {
  return (
    (b.punctuality?.points || 0) +
    (b.evaluation?.points || 0) +
    (b.tasks?.points || 0) +
    (b.reportTiming?.points || 0) +
    (b.teamProgress?.points || 0) +
    (b.dailyPulse?.points || 0) +
    (b.performanceEvaluation?.points || 0)
  );
}
