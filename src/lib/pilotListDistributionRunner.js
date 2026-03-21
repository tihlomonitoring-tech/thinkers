import { query } from '../db.js';
import { distributionSendEmailInternal } from '../routes/contractor.js';
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
      weekday: 'short',
    })
      .formatToParts(d)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value])
  );
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    y: parts.year,
    mo: parts.month,
    da: parts.day,
    h: parseInt(parts.hour, 10),
    mi: parseInt(parts.minute, 10),
    dow: dowMap[parts.weekday] || 1,
  };
}

function ymdInAppTz(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(d)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function parseHHMM(s) {
  const m = String(s || '09:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { th: 9, tm: 0 };
  return { th: Math.min(23, parseInt(m[1], 10)), tm: Math.min(59, parseInt(m[2], 10)) };
}

/** True when this minute is the scheduled run (server checks once per minute). */
export function isPilotScheduleDue(row, now = new Date()) {
  const clock = getAppTzClock(now);
  const { th, tm } = parseHHMM(row.time_hhmm);
  const freq = String(row.frequency || '').toLowerCase();
  const last = row.last_run_at ? new Date(row.last_run_at) : null;

  if (freq === 'hourly') {
    if (clock.mi !== tm) return false;
    if (!last) return true;
    const lastC = getAppTzClock(last);
    return lastC.h !== clock.h || lastC.da !== clock.da || lastC.mo !== clock.mo || lastC.y !== clock.y;
  }

  if (clock.h !== th || clock.mi !== tm) return false;

  if (freq === 'daily') {
    if (!last) return true;
    return ymdInAppTz(last) !== ymdInAppTz(now);
  }

  if (freq === 'weekly') {
    const want = row.weekday != null ? Number(row.weekday) : 1;
    if (clock.dow !== want) return false;
    if (!last) return true;
    return ymdInAppTz(last) !== ymdInAppTz(now);
  }

  return false;
}

function splitEmails(s) {
  if (!s || !String(s).trim()) return [];
  return [...new Set(String(s).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e && e.includes('@')))];
}

function sqlGuidToUuidString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.replace(/[{}]/g, '').toLowerCase();
  if (Buffer.isBuffer(v)) {
    const h = v.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toLowerCase();
  }
  return String(v).replace(/[{}]/g, '').toLowerCase();
}

export async function runPilotListDistributions() {
  let rows;
  try {
    const r = await query(`SELECT * FROM pilot_list_distribution WHERE is_active = 1`);
    rows = r.recordset || [];
  } catch (e) {
    const msg = String(e?.message || '');
    if (/Invalid object name|pilot_list_distribution/i.test(msg)) return;
    throw e;
  }

  const now = new Date();
  for (const row of rows) {
    if (!isPilotScheduleDue(row, now)) continue;

    const tenantId = row.tenant_id;
    const userId = row.created_by_user_id || null;
    let userName = 'Pilot distribution';
    if (userId) {
      try {
        const ur = await query(`SELECT full_name FROM users WHERE id = @userId`, { userId });
        const fn = ur.recordset?.[0]?.full_name;
        if (fn) userName = fn;
      } catch (_) {
        /* ignore */
      }
    }

    let fleetCols = [];
    let driverCols = [];
    try {
      if (row.fleet_columns_json) fleetCols = JSON.parse(row.fleet_columns_json);
    } catch (_) {
      fleetCols = [];
    }
    try {
      if (row.driver_columns_json) driverCols = JSON.parse(row.driver_columns_json);
    } catch (_) {
      driverCols = [];
    }

    const contractorIds = String(row.contractor_ids || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const recipients = splitEmails(row.recipient_emails);
    const cc = splitEmails(row.cc_emails);

    const scheduleIdStr = sqlGuidToUuidString(row.id);
    const body = {
      recipients,
      cc,
      list_type: row.list_type || 'both',
      route_ids: [String(row.route_id).trim()],
      fleet_columns: Array.isArray(fleetCols) ? fleetCols : [],
      driver_columns: Array.isArray(driverCols) ? driverCols : [],
      format: row.attach_format || 'excel',
      send_per_contractor: true,
      contractor_ids: contractorIds,
      pilot_distribution:
        scheduleIdStr && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scheduleIdStr)
          ? { schedule_id: scheduleIdStr, schedule_name: row.name || null }
          : undefined,
    };

    const id = row.id;
    let detail = '';
    let status = 'ok';

    try {
      if (recipients.length === 0) {
        status = 'skipped';
        detail = 'No recipient emails';
      } else if (contractorIds.length === 0) {
        status = 'skipped';
        detail = 'No companies selected';
      } else {
        const result = await distributionSendEmailInternal({ tenantId, userId, userName }, body);
        if (!result.ok) {
          status = 'error';
          detail = result.error || 'Send failed';
        } else {
          detail = `Sent ${result.sent}, failed ${result.failed}`;
          if (result.failed > 0 && result.failedTo?.length) {
            detail += `: ${result.failedTo.map((f) => f.email).join(', ')}`;
          }
        }
      }
    } catch (err) {
      status = 'error';
      detail = String(err?.message || err).slice(0, 2000);
      console.error('[pilot-distribution]', id, detail);
    }

    try {
      await query(
        `UPDATE pilot_list_distribution SET last_run_at = SYSUTCDATETIME(), last_run_status = @status, last_run_detail = @detail, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id, status, detail: detail.slice(0, 4000) }
      );
    } catch (e) {
      console.error('[pilot-distribution] Failed to update last_run:', e?.message);
    }
  }
}
