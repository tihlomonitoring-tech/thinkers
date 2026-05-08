import { query } from '../db.js';
import { runFuelDataAutoShareSendInternal } from '../routes/fuelData.js';
import { APP_TIMEZONE } from './emailService.js';

function getAppTzClock(d) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value])
  );
  return {
    y: parts.year,
    mo: parts.month,
    da: parts.day,
    h: parseInt(parts.hour, 10),
    mi: parseInt(parts.minute, 10),
  };
}

function ymdInAppTz(d) {
  const c = getAppTzClock(d);
  return `${c.y}-${c.mo}-${c.da}`;
}

function parseHHMM(s) {
  const m = String(s || '08:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { th: 8, tm: 0 };
  return { th: Math.min(23, parseInt(m[1], 10)), tm: Math.min(59, parseInt(m[2], 10)) };
}

function daysBetweenYmd(a, b) {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/** Schedule is due when the minute-tick matches HH:MM in APP_TIMEZONE
 *  and the gap since last_run_at (or start_date) >= every_n_days. */
export function isFuelAutoShareDue(row, now = new Date()) {
  if (!row || row.is_active === false || row.is_active === 0) return false;
  const clock = getAppTzClock(now);
  const { th, tm } = parseHHMM(row.time_hhmm);
  if (clock.h !== th || clock.mi !== tm) return false;
  const today = `${clock.y}-${clock.mo}-${clock.da}`;
  const startDate = row.start_date ? ymdInAppTz(new Date(row.start_date)) : null;
  if (startDate && today < startDate) return false;
  const everyN = Math.max(1, Number(row.every_n_days) || 1);
  if (!row.last_run_at) return true;
  const lastYmd = ymdInAppTz(new Date(row.last_run_at));
  if (lastYmd === today) return false;
  return daysBetweenYmd(lastYmd, today) >= everyN;
}

export async function runFuelDataAutoShareDistributions() {
  let rows;
  try {
    const r = await query(
      `SELECT * FROM fuel_data_auto_share_schedules WHERE is_active = 1`
    );
    rows = r.recordset || [];
  } catch (e) {
    const msg = String(e?.message || '');
    if (/Invalid object name|fuel_data_auto_share_schedules/i.test(msg)) return;
    throw e;
  }

  const now = new Date();
  for (const row of rows) {
    if (!isFuelAutoShareDue(row, now)) continue;

    let status = 'ok';
    let detail = '';
    try {
      const result = await runFuelDataAutoShareSendInternal(row);
      if (!result.ok) {
        status = 'error';
        detail = String(result.error || 'Send failed').slice(0, 4000);
      } else {
        detail = `Sent ${result.sent} email(s); ${result.row_count} transaction(s).`;
      }
    } catch (err) {
      status = 'error';
      detail = String(err?.message || err).slice(0, 4000);
      console.error('[fuel-auto-share]', row.id, detail);
    }

    try {
      await query(
        `UPDATE fuel_data_auto_share_schedules
         SET last_run_at = SYSUTCDATETIME(),
             last_run_status = @status,
             last_run_detail = @detail,
             updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        { id: row.id, status, detail }
      );
    } catch (e) {
      console.error('[fuel-auto-share] Failed to update last_run:', e?.message);
    }
  }
}
