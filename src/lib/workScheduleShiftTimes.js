/** Default tenant shift windows (matches work-schedule-shift-settings.sql). */
export const DEFAULT_SHIFT_SETTINGS = {
  day_start: '06:00',
  day_end: '17:00',
  night_start: '17:00',
  night_end: '06:00',
};

/** @param {string|null|undefined} v */
export function normalizeTimeHm(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** @param {object} row */
export function shiftSettingsFromRow(row, getRow) {
  if (!row) return { ...DEFAULT_SHIFT_SETTINGS };
  return {
    day_start: normalizeTimeHm(getRow(row, 'day_start')) || DEFAULT_SHIFT_SETTINGS.day_start,
    day_end: normalizeTimeHm(getRow(row, 'day_end')) || DEFAULT_SHIFT_SETTINGS.day_end,
    night_start: normalizeTimeHm(getRow(row, 'night_start')) || DEFAULT_SHIFT_SETTINGS.night_start,
    night_end: normalizeTimeHm(getRow(row, 'night_end')) || DEFAULT_SHIFT_SETTINGS.night_end,
  };
}

/**
 * @param {'day'|'night'|'fixed'|string} shiftType
 * @param {typeof DEFAULT_SHIFT_SETTINGS} settings
 * @param {{ start_time?: string, end_time?: string }} [overrides]
 */
export function resolveEntryTimes(shiftType, settings = DEFAULT_SHIFT_SETTINGS, overrides = {}) {
  const st = String(shiftType || 'day').toLowerCase();
  const ovStart = normalizeTimeHm(overrides.start_time);
  const ovEnd = normalizeTimeHm(overrides.end_time);
  if (st === 'fixed') {
    return {
      start_time: ovStart || normalizeTimeHm(settings.day_start) || '09:00',
      end_time: ovEnd || normalizeTimeHm(settings.day_end) || '17:00',
    };
  }
  if (st === 'night') {
    return {
      start_time: ovStart || normalizeTimeHm(settings.night_start) || DEFAULT_SHIFT_SETTINGS.night_start,
      end_time: ovEnd || normalizeTimeHm(settings.night_end) || DEFAULT_SHIFT_SETTINGS.night_end,
    };
  }
  return {
    start_time: ovStart || normalizeTimeHm(settings.day_start) || DEFAULT_SHIFT_SETTINGS.day_start,
    end_time: ovEnd || normalizeTimeHm(settings.day_end) || DEFAULT_SHIFT_SETTINGS.day_end,
  };
}

export function formatShiftWindow(start, end) {
  if (!start || !end) return '';
  return `${start} – ${end}`;
}

/** ISO weekday 1=Mon … 7=Sun from YYYY-MM-DD */
export function isoWeekdayFromYmd(ymd) {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}
