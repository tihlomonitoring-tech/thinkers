/**
 * Tenant library access time windows (local policy timezone).
 * access_weekdays: comma-separated ISO weekday 1=Mon … 7=Sun
 * access_start_minutes / access_end_minutes: minutes from midnight (0–1440), end > start (same day).
 */

const SHORT_TO_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function parsePolicyRow(row) {
  if (!row) return null;
  const get = (k) => {
    const key = Object.keys(row).find((x) => x && String(x).toLowerCase() === k.toLowerCase());
    return key != null ? row[key] : undefined;
  };
  return {
    access_restricted: !!get('access_restricted'),
    access_timezone: String(get('access_timezone') || 'Africa/Johannesburg'),
    access_weekdays: get('access_weekdays') != null ? String(get('access_weekdays')) : null,
    access_start_minutes: get('access_start_minutes') != null ? Number(get('access_start_minutes')) : null,
    access_end_minutes: get('access_end_minutes') != null ? Number(get('access_end_minutes')) : null,
  };
}

export function isWithinLibraryAccessWindow(policy, now = new Date()) {
  if (!policy || !policy.access_restricted) return { ok: true, reason: null };
  const tz = policy.access_timezone || 'UTC';
  const wdCsv = policy.access_weekdays;
  const startM = policy.access_start_minutes;
  const endM = policy.access_end_minutes;
  if (wdCsv == null || startM == null || endM == null) return { ok: true, reason: null };

  const allowedDays = new Set(
    wdCsv
      .split(',')
      .map((s) => parseInt(String(s).trim(), 10))
      .filter((n) => n >= 1 && n <= 7)
  );
  if (allowedDays.size === 0) return { ok: true, reason: null };

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const wk = parts.find((p) => p.type === 'weekday')?.value;
  const isoDow = SHORT_TO_ISO[wk];
  if (!isoDow || !allowedDays.has(isoDow)) {
    return { ok: false, reason: 'Library access is limited to scheduled days.' };
  }

  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const mins = h * 60 + m;
  if (mins < startM || mins > endM) {
    return { ok: false, reason: 'Library access is outside the allowed time window.' };
  }
  return { ok: true, reason: null };
}
