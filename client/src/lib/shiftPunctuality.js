/** Client helpers for clock-in punctuality (SAST wall times, matches server shiftProductivityScore). */

const OFFSET_MS = 2 * 60 * 60 * 1000;
const GRACE_MS = 5 * 60 * 1000;

function zonedWallToUtcMs(ymd, hour, minute) {
  const s = String(ymd || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d, hour, minute, 0, 0) - OFFSET_MS;
}

export function expectedClockInUtcMs(workDateYmd, shiftType) {
  const night = String(shiftType || '').toLowerCase() === 'night';
  if (night) return zonedWallToUtcMs(workDateYmd, 18, 0);
  return zonedWallToUtcMs(workDateYmd, 6, 0);
}

export function expectedClockInLabel(shiftType) {
  return String(shiftType || '').toLowerCase() === 'night' ? '18:00' : '06:00';
}

/** @returns {{ detail: 'on_time'|'late'|'no_clock'|'no_schedule', label: string }} */
export function punctualityStatus(row, workDateYmd, shiftTypeUsed) {
  const entries = row?.entries || [];
  const session = row?.session;
  if (!entries.length) {
    return { detail: 'no_schedule', label: 'Not scheduled' };
  }
  if (!session?.clock_in_at) {
    return { detail: 'no_clock', label: 'Not clocked in' };
  }
  const st =
    String(shiftTypeUsed || entries[0]?.shift_type || 'day').toLowerCase() === 'night' ? 'night' : 'day';
  const expected = expectedClockInUtcMs(workDateYmd, st);
  const clockIn = new Date(session.clock_in_at).getTime();
  if (!Number.isFinite(expected) || !Number.isFinite(clockIn)) {
    return { detail: 'no_clock', label: 'Clocked in' };
  }
  if (clockIn <= expected + GRACE_MS) {
    return { detail: 'on_time', label: 'On time' };
  }
  const lateMin = Math.round((clockIn - expected - GRACE_MS) / 60000);
  return { detail: 'late', label: `Late (${lateMin} min)` };
}
