export const DEFAULT_SHIFT_SETTINGS = {
  day_start: '06:00',
  day_end: '17:00',
  night_start: '17:00',
  night_end: '06:00',
};

export function formatShiftWindow(start, end) {
  if (!start || !end) return '';
  return `${start} – ${end}`;
}

export function shiftLabel(entry, settings = DEFAULT_SHIFT_SETTINGS) {
  const st = String(entry?.shift_type || 'day').toLowerCase();
  const start = entry?.start_time || (st === 'night' ? settings.night_start : st === 'fixed' ? entry?.start_time : settings.day_start);
  const end = entry?.end_time || (st === 'night' ? settings.night_end : st === 'fixed' ? entry?.end_time : settings.day_end);
  if (st === 'fixed') {
    const s = entry?.start_time || start || '—';
    const e = entry?.end_time || end || '—';
    return `Fixed (${formatShiftWindow(s, e) || 'custom hours'})`;
  }
  if (st === 'night') {
    return `Night (${formatShiftWindow(entry?.start_time || settings.night_start, entry?.end_time || settings.night_end)})`;
  }
  return `Day (${formatShiftWindow(entry?.start_time || settings.day_start, entry?.end_time || settings.day_end)})`;
}

export function countWeekdayDates(startYmd, endYmd, weekdays) {
  const set = new Set((weekdays || [1, 2, 3, 4, 5]).map(Number));
  let n = 0;
  let cur = startYmd;
  while (cur <= endYmd) {
    const d = new Date(`${cur}T12:00:00.000Z`);
    const js = d.getUTCDay();
    const iso = js === 0 ? 7 : js;
    if (set.has(iso)) n += 1;
    const next = new Date(`${cur}T12:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
  }
  return n;
}
