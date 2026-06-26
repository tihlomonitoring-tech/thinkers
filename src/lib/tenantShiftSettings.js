import { query } from '../db.js';

export const DEFAULT_SHIFT_SETTINGS = {
  day_start: '06:00',
  day_end: '17:00',
  night_start: '17:00',
  night_end: '06:00',
};

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

/** Normalize HH:MM from input (accepts H:MM, HH:MM:SS). */
export function normalizeTimeHHMM(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parseTimeParts(hhmm) {
  const n = normalizeTimeHHMM(hhmm);
  if (!n) return null;
  const [h, m] = n.split(':').map(Number);
  return { hour: h, minute: m };
}

export function formatShiftWindowLabel(start, end) {
  const a = normalizeTimeHHMM(start) || '—';
  const b = normalizeTimeHHMM(end) || '—';
  return `${a} – ${b}`;
}

export function shiftSettingsFromBody(body) {
  const out = { ...DEFAULT_SHIFT_SETTINGS };
  for (const key of ['day_start', 'day_end', 'night_start', 'night_end']) {
    if (body?.[key] != null && String(body[key]).trim() !== '') {
      const t = normalizeTimeHHMM(body[key]);
      if (!t) throw new Error(`Invalid ${key.replace('_', ' ')}`);
      out[key] = t;
    }
  }
  return out;
}

export async function getTenantShiftSettings(tenantId) {
  if (!tenantId) return { ...DEFAULT_SHIFT_SETTINGS };
  try {
    const r = await query(
      `SELECT day_start, day_end, night_start, night_end, updated_at
       FROM tenant_shift_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return { ...DEFAULT_SHIFT_SETTINGS };
    return {
      day_start: normalizeTimeHHMM(getRow(row, 'day_start')) || DEFAULT_SHIFT_SETTINGS.day_start,
      day_end: normalizeTimeHHMM(getRow(row, 'day_end')) || DEFAULT_SHIFT_SETTINGS.day_end,
      night_start: normalizeTimeHHMM(getRow(row, 'night_start')) || DEFAULT_SHIFT_SETTINGS.night_start,
      night_end: normalizeTimeHHMM(getRow(row, 'night_end')) || DEFAULT_SHIFT_SETTINGS.night_end,
      updated_at: getRow(row, 'updated_at') || null,
    };
  } catch (err) {
    if (String(err?.message || '').includes('tenant_shift_settings')) return { ...DEFAULT_SHIFT_SETTINGS };
    throw err;
  }
}

export async function upsertTenantShiftSettings(tenantId, settings, updatedByUserId) {
  const s = shiftSettingsFromBody(settings);
  await query(
    `MERGE tenant_shift_settings AS t
     USING (SELECT @tenantId AS tenant_id) AS src ON t.tenant_id = src.tenant_id
     WHEN MATCHED THEN UPDATE SET
       day_start = @dayStart, day_end = @dayEnd, night_start = @nightStart, night_end = @nightEnd,
       updated_at = SYSUTCDATETIME(), updated_by = @updatedBy
     WHEN NOT MATCHED THEN INSERT (tenant_id, day_start, day_end, night_start, night_end, updated_by)
       VALUES (@tenantId, @dayStart, @dayEnd, @nightStart, @nightEnd, @updatedBy);`,
    {
      tenantId,
      dayStart: s.day_start,
      dayEnd: s.day_end,
      nightStart: s.night_start,
      nightEnd: s.night_end,
      updatedBy: updatedByUserId || null,
    }
  );
  return getTenantShiftSettings(tenantId);
}

/** SAST wall clock → UTC ms (matches shiftProductivityScore). */
const OFFSET_MS = 2 * 60 * 60 * 1000;

function zonedWallToUtcMs(ymd, hour, minute) {
  const s = String(ymd || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d, hour, minute, 0, 0) - OFFSET_MS;
}

export function expectedClockInUtcMs(workDateYmd, shiftType, settings = DEFAULT_SHIFT_SETTINGS) {
  const st = String(shiftType || '').toLowerCase();
  if (st === 'fixed') return NaN;
  const cfg = settings || DEFAULT_SHIFT_SETTINGS;
  if (st === 'night') {
    const p = parseTimeParts(cfg.night_start);
    if (!p) return NaN;
    return zonedWallToUtcMs(workDateYmd, p.hour, p.minute);
  }
  const p = parseTimeParts(cfg.day_start);
  if (!p) return NaN;
  return zonedWallToUtcMs(workDateYmd, p.hour, p.minute);
}

export function expectedClockInLabel(shiftType, settings = DEFAULT_SHIFT_SETTINGS) {
  const st = String(shiftType || '').toLowerCase();
  const cfg = settings || DEFAULT_SHIFT_SETTINGS;
  if (st === 'night') return normalizeTimeHHMM(cfg.night_start) || '17:00';
  if (st === 'fixed') return '—';
  return normalizeTimeHHMM(cfg.day_start) || '06:00';
}

export function shiftEndUtcMs(workDateYmd, shiftType, settings = DEFAULT_SHIFT_SETTINGS) {
  const anchor = String(workDateYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return NaN;
  const st = String(shiftType || '').toLowerCase();
  const cfg = settings || DEFAULT_SHIFT_SETTINGS;
  if (st === 'night') {
    const p = parseTimeParts(cfg.night_end);
    if (!p) return NaN;
    const { addCalendarDays } = await import('./appTime.js');
    const morningAfter = addCalendarDays(anchor, 1);
    return zonedWallToUtcMs(morningAfter, p.hour, p.minute);
  }
  const p = parseTimeParts(cfg.day_end);
  if (!p) return NaN;
  return zonedWallToUtcMs(anchor, p.hour, p.minute);
}
