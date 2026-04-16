import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { query, getPool, sql } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import {
  scheduleCreatedHtml,
  leaveAppliedHtml,
  leaveReviewedHtml,
  warningIssuedHtml,
  rewardIssuedHtml,
  shiftSwapRequestedHtml,
  shiftSwapPendingManagementHtml,
  shiftSwapApprovedHtml,
  shiftSwapPeerDeclinedHtml,
  shiftSwapManagementDeclinedHtml,
} from '../lib/emailTemplates.js';
import { getManagementEmailsForTenant } from '../lib/emailRecipients.js';
import {
  getAppTimeZone,
  toYmdInAppZone,
  toYmdFromDbOrString,
  wallMonthYearInAppZone,
  calendarMonthStartYmd,
  calendarMonthEndYmd,
  addCalendarDays,
} from '../lib/appTime.js';

const router = Router();
const uploadsBase = path.join(process.cwd(), 'uploads', 'profile-management');

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function canAccessTenant(req, tenantId) {
  if (req.user?.role === 'super_admin') return true;
  const tid = req.user?.tenant_id;
  if (!tid) return false;
  if (Array.isArray(req.user?.tenant_ids)) return req.user.tenant_ids.includes(tenantId);
  return tid === tenantId;
}

const leaveUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const leaveId = String(req.params?.id || 'new');
      const dir = path.join(uploadsBase, 'leave', tenantId, leaveId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).array('files', 10);

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const userId = String(req.user?.id || 'new');
      const dir = path.join(uploadsBase, 'documents', tenantId, userId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');

router.use(requireAuth);
router.use(loadUser);

// —— Work schedules: one schedule per employee (private). Profile sees only own; Management creates/edits for any employee. ——
router.get('/schedules', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.query.user_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sqlQuery = `SELECT s.id, s.user_id, s.title, s.period_start, s.period_end, s.created_at, u.full_name AS user_name, u.email AS user_email
       FROM work_schedules s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = @tenantId`;
    const params = { tenantId };
    if (userId) {
      sqlQuery += ' AND s.user_id = @userId';
      params.userId = userId;
    }
    sqlQuery += ' ORDER BY s.period_start DESC';
    const result = await query(sqlQuery, params);
    res.json({ schedules: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/schedules', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, title, period_start, period_end } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    if (!user_id || !title || !period_start || !period_end) return res.status(400).json({ error: 'user_id (employee), title, period_start, period_end required' });
    const ins = await query(
      `INSERT INTO work_schedules (tenant_id, user_id, title, period_start, period_end, created_by)
       OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.title, INSERTED.period_start, INSERTED.period_end, INSERTED.created_at
       VALUES (@tenantId, @userId, @title, @period_start, @period_end, @createdBy)`,
      { tenantId, userId: user_id, title: String(title).trim(), period_start, period_end, createdBy: req.user.id }
    );
    const row = ins.recordset[0];
    if (isEmailConfigured()) {
      const userRow = await query(`SELECT email FROM users WHERE id = @userId`, { userId: user_id });
      const email = userRow.recordset?.[0] && getRow(userRow.recordset[0], 'email');
      if (email && String(email).trim()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const html = scheduleCreatedHtml({
          scheduleTitle: getRow(row, 'title'),
          periodStart: getRow(row, 'period_start'),
          periodEnd: getRow(row, 'period_end'),
          createdByName: req.user.full_name || req.user.email || null,
          appUrl,
        });
        sendEmail({ to: email, subject: `Work schedule created: ${getRow(row, 'title')}`, body: html, html: true }).catch((e) => console.error('[profile-management] Schedule created email error:', e?.message));
      }
    }
    res.status(201).json({
      schedule: {
        id: getRow(row, 'id'),
        user_id: getRow(row, 'user_id'),
        title: getRow(row, 'title'),
        period_start: getRow(row, 'period_start'),
        period_end: getRow(row, 'period_end'),
        created_at: getRow(row, 'created_at'),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Bulk generate: one schedule for an employee over a time frame, with a repeating pattern (day/night/off).
const TIME_FRAME_MONTHS = [1, 3, 6, 12];
router.post('/schedules/bulk', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, start_date, time_frame_months, pattern } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    if (!user_id || !start_date || !pattern || !Array.isArray(pattern) || pattern.length === 0) {
      return res.status(400).json({ error: 'user_id, start_date, and pattern (non-empty array) required' });
    }
    const months = parseInt(time_frame_months, 10);
    if (!TIME_FRAME_MONTHS.includes(months)) {
      return res.status(400).json({ error: 'time_frame_months must be 1, 3, 6, or 12' });
    }
    const normalized = pattern.map((p) => (String(p).toLowerCase() === 'night' ? 'night' : String(p).toLowerCase() === 'off' ? 'off' : 'day'));
    const periodStart = String(start_date).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return res.status(400).json({ error: 'Invalid start_date' });
    const start = new Date(`${periodStart}T12:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Invalid start_date' });
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + months);
    end.setUTCDate(0);
    const periodEnd = toYmdInAppZone(end);
    const tz = getAppTimeZone();
    const title = months === 1
      ? `${start.toLocaleString('en-ZA', { month: 'short', timeZone: tz })} ${start.toLocaleString('en-ZA', { year: 'numeric', timeZone: tz })}`
      : `${start.toLocaleString('en-ZA', { month: 'short', timeZone: tz })} ${start.toLocaleString('en-ZA', { year: 'numeric', timeZone: tz })} – ${end.toLocaleString('en-ZA', { month: 'short', timeZone: tz })} ${end.toLocaleString('en-ZA', { year: 'numeric', timeZone: tz })}`;
    const ins = await query(
      `INSERT INTO work_schedules (tenant_id, user_id, title, period_start, period_end, created_by)
       OUTPUT INSERTED.id
       VALUES (@tenantId, @userId, @title, @periodStart, @periodEnd, @createdBy)`,
      { tenantId, userId: user_id, title, periodStart, periodEnd, createdBy: req.user.id }
    );
    const scheduleId = getRow(ins.recordset[0], 'id');
    if (!scheduleId) return res.status(500).json({ error: 'Failed to create schedule' });
    let dayIndex = 0;
    let inserted = 0;
    for (let cur = periodStart; cur <= periodEnd; cur = addCalendarDays(cur, 1)) {
      const dateStr = cur;
      const slot = normalized[dayIndex % normalized.length];
      if (slot === 'day' || slot === 'night') {
        await query(
          `INSERT INTO work_schedule_entries (work_schedule_id, work_date, shift_type, notes) VALUES (@scheduleId, @workDate, @shiftType, @notes)`,
          { scheduleId, workDate: dateStr, shiftType: slot, notes: null }
        );
        inserted++;
      }
      dayIndex++;
    }
    if (isEmailConfigured()) {
      const userRow = await query(`SELECT email FROM users WHERE id = @userId`, { userId: user_id });
      const email = userRow.recordset?.[0] && getRow(userRow.recordset[0], 'email');
      if (email && String(email).trim()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const html = scheduleCreatedHtml({
          scheduleTitle: title,
          periodStart,
          periodEnd,
          createdByName: req.user.full_name || req.user.email || null,
          appUrl,
        });
        sendEmail({ to: email, subject: `Work schedule created: ${title}`, body: html, html: true }).catch((e) => console.error('[profile-management] Schedule created email error:', e?.message));
      }
    }
    res.status(201).json({
      schedule: { id: scheduleId, user_id, title, period_start: periodStart, period_end: periodEnd },
      entries_created: inserted,
    });
  } catch (err) {
    next(err);
  }
});

/** Remove every work schedule (and shifts) for one employee in the tenant. Clears shift swaps and clock sessions that reference those shifts. */
router.delete('/schedules/by-user/:userId', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const targetUserId = req.params.userId;
    if (!targetUserId) return res.status(400).json({ error: 'user id required' });

    // Same membership rule as GET /users/tenant (user_tenants), not only users.tenant_id
    const u = await query(
      `SELECT u.id FROM users u
       WHERE u.id = @userId
       AND (
         u.tenant_id = @tenantId
         OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId)
       )`,
      { userId: targetUserId, tenantId }
    );
    if (!u.recordset?.length) return res.status(404).json({ error: 'User not found in this tenant' });

    const cntRow = await query(
      `SELECT COUNT(*) AS c FROM work_schedules WHERE tenant_id = @tenantId AND user_id = @userId`,
      { tenantId, userId: targetUserId }
    );
    const scheduleCount = parseInt(getRow(cntRow.recordset[0], 'c'), 10) || 0;
    if (scheduleCount === 0) {
      return res.json({ deleted: { schedules: 0 } });
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await execTx(
        transaction,
        `DELETE r FROM shift_swap_requests r
         WHERE r.tenant_id = @tenantId
         AND (
           EXISTS (
             SELECT 1 FROM work_schedule_entries e
             INNER JOIN work_schedules s ON s.id = e.work_schedule_id
             WHERE e.id = r.requester_entry_id AND s.tenant_id = @tenantId AND s.user_id = @userId
           )
           OR EXISTS (
             SELECT 1 FROM work_schedule_entries e
             INNER JOIN work_schedules s ON s.id = e.work_schedule_id
             WHERE e.id = r.counterparty_entry_id AND s.tenant_id = @tenantId AND s.user_id = @userId
           )
         )`,
        { tenantId, userId: targetUserId }
      );

      await execTx(
        transaction,
        `DELETE sc FROM shift_clock_sessions sc
         INNER JOIN work_schedule_entries e ON e.id = sc.schedule_entry_id
         INNER JOIN work_schedules s ON s.id = e.work_schedule_id
         WHERE s.tenant_id = @tenantId AND s.user_id = @userId`,
        { tenantId, userId: targetUserId }
      );

      await execTx(
        transaction,
        `DELETE FROM work_schedules WHERE tenant_id = @tenantId AND user_id = @userId`,
        { tenantId, userId: targetUserId }
      );

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    res.json({ deleted: { schedules: scheduleCount } });
  } catch (err) {
    next(err);
  }
});

router.post('/schedules/:id/entries', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { entries } = req.body || {};
    const sched = await query(`SELECT id, tenant_id, user_id FROM work_schedules WHERE id = @id`, { id });
    const row = sched.recordset[0];
    if (!row) return res.status(404).json({ error: 'Schedule not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const arr = Array.isArray(entries) ? entries : [];
    for (const e of arr) {
      const { work_date, shift_type, notes } = e || {};
      if (!work_date || !shift_type) continue;
      const st = shift_type === 'night' ? 'night' : 'day';
      await query(
        `INSERT INTO work_schedule_entries (work_schedule_id, work_date, shift_type, notes)
         VALUES (@scheduleId, @workDate, @shiftType, @notes)`,
        { scheduleId: id, workDate: work_date, shiftType: st, notes: notes || null }
      );
    }
    res.status(201).json({ added: arr.length });
  } catch (err) {
    next(err);
  }
});

router.get('/my-schedule', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const def = wallMonthYearInAppZone();
    const m = month != null ? parseInt(month, 10) : def.monthIndex0;
    const y = year != null ? parseInt(year, 10) : def.year;
    const start = calendarMonthStartYmd(y, m);
    const end = calendarMonthEndYmd(y, m);
    const result = await query(
      `SELECT e.id AS entry_id, e.work_date, e.shift_type, e.notes, s.title AS schedule_title
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId AND s.user_id = @userId
       WHERE e.work_date >= @start AND e.work_date <= @end
       ORDER BY e.work_date`,
      { tenantId, userId, start, end }
    );
    const entries = (result.recordset || []).map((r) => ({
      entry_id: getRow(r, 'entry_id'),
      work_date: getRow(r, 'work_date'),
      shift_type: getRow(r, 'shift_type'),
      notes: getRow(r, 'notes'),
      schedule_title: getRow(r, 'schedule_title'),
    }));
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

/** Month view: colleagues' shifts for selected tenant users (same org). Used on Profile work schedule overlay. */
const COLLEAGUE_OVERLAY_MAX = 40;
router.get('/my-schedule/colleagues', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { month, year, user_ids: userIdsRaw } = req.query;
    const tenantId = req.user.tenant_id;
    const me = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const def = wallMonthYearInAppZone();
    const m = month != null ? parseInt(month, 10) : def.monthIndex0;
    const y = year != null ? parseInt(year, 10) : def.year;
    const startStr = calendarMonthStartYmd(y, m);
    const endStr = calendarMonthEndYmd(y, m);

    const raw = typeof userIdsRaw === 'string' && userIdsRaw.trim()
      ? userIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const unique = [...new Set(raw)].filter((id) => String(id).toLowerCase() !== String(me).toLowerCase());
    const limited = unique.slice(0, COLLEAGUE_OVERLAY_MAX);
    if (limited.length === 0) {
      return res.json({ colleagues: [] });
    }

    const verify = await query(
      `SELECT ut.user_id FROM user_tenants ut WHERE ut.tenant_id = @tenantId AND ut.user_id IN (${limited.map((_, i) => `@c${i}`).join(', ')})`,
      { tenantId, ...Object.fromEntries(limited.map((id, i) => [`c${i}`, id])) }
    );
    const allowed = new Set((verify.recordset || []).map((row) => String(getRow(row, 'user_id'))));
    const ids = limited.filter((id) => allowed.has(String(id)));
    if (ids.length === 0) {
      return res.json({ colleagues: [] });
    }

    const placeholders = ids.map((_, i) => `@u${i}`).join(', ');
    const params = { tenantId, startStr, endStr, ...Object.fromEntries(ids.map((id, i) => [`u${i}`, id])) };
    const result = await query(
      `SELECT e.id AS entry_id, e.work_date, e.shift_type, s.user_id AS colleague_id, u.full_name AS full_name, u.email AS email
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.user_id IN (${placeholders})
         AND e.work_date >= @startStr AND e.work_date <= @endStr
       ORDER BY e.work_date, u.full_name`,
      params
    );

    const byUser = new Map();
    for (const row of result.recordset || []) {
      const uid = String(getRow(row, 'colleague_id'));
      if (!byUser.has(uid)) {
        byUser.set(uid, {
          user_id: uid,
          full_name: getRow(row, 'full_name'),
          email: getRow(row, 'email'),
          entries: [],
        });
      }
      byUser.get(uid).entries.push({
        entry_id: getRow(row, 'entry_id'),
        work_date: getRow(row, 'work_date'),
        shift_type: getRow(row, 'shift_type'),
      });
    }

    res.json({ colleagues: [...byUser.values()] });
  } catch (err) {
    next(err);
  }
});

async function execTx(transaction, text, params = {}) {
  const request = new sql.Request(transaction);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const k = key.startsWith('@') ? key.slice(1) : key;
    request.input(k, value);
  }
  return request.query(text);
}

/** Load schedule entry with owning user and tenant */
async function loadEntryWithSchedule(entryId) {
  const r = await query(
    `SELECT e.id, e.work_date, e.shift_type, e.work_schedule_id, s.user_id AS schedule_user_id, s.tenant_id
     FROM work_schedule_entries e
     INNER JOIN work_schedules s ON s.id = e.work_schedule_id
     WHERE e.id = @id`,
    { id: entryId }
  );
  return r.recordset?.[0] ? r.recordset[0] : null;
}

function mapSwapRow(r) {
  if (!r) return null;
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    requester_user_id: getRow(r, 'requester_user_id'),
    counterparty_user_id: getRow(r, 'counterparty_user_id'),
    requester_entry_id: getRow(r, 'requester_entry_id'),
    counterparty_entry_id: getRow(r, 'counterparty_entry_id'),
    message: getRow(r, 'message'),
    status: getRow(r, 'status'),
    peer_reviewed_at: getRow(r, 'peer_reviewed_at'),
    peer_review_notes: getRow(r, 'peer_review_notes'),
    management_reviewed_at: getRow(r, 'management_reviewed_at'),
    management_review_notes: getRow(r, 'management_review_notes'),
    management_reviewed_by: getRow(r, 'management_reviewed_by'),
    created_at: getRow(r, 'created_at'),
    updated_at: getRow(r, 'updated_at'),
    requester_name: getRow(r, 'requester_name'),
    counterparty_name: getRow(r, 'counterparty_name'),
    requester_work_date: getRow(r, 'requester_work_date'),
    requester_shift_type: getRow(r, 'requester_shift_type'),
    counterparty_work_date: getRow(r, 'counterparty_work_date'),
    counterparty_shift_type: getRow(r, 'counterparty_shift_type'),
  };
}

// Colleague's shifts for a month (same tenant) — pick counterparty entry when requesting a swap
router.get('/shift-swaps/colleague-entries', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const colleagueId = req.query.user_id;
    const def = wallMonthYearInAppZone();
    const m = req.query.month != null ? parseInt(req.query.month, 10) : def.monthIndex0;
    const y = req.query.year != null ? parseInt(req.query.year, 10) : def.year;
    if (!tenantId || !colleagueId) return res.status(400).json({ error: 'user_id required' });
    if (String(colleagueId).toLowerCase() === String(req.user.id).toLowerCase()) {
      return res.status(400).json({ error: 'Choose a colleague other than yourself' });
    }
    const ut = await query(
      `SELECT 1 AS ok FROM user_tenants WHERE user_id = @uid AND tenant_id = @tenantId`,
      { uid: colleagueId, tenantId }
    );
    if (!ut.recordset?.length) return res.status(403).json({ error: 'User not in your organization' });
    const start = calendarMonthStartYmd(y, m);
    const end = calendarMonthEndYmd(y, m);
    const result = await query(
      `SELECT e.id AS entry_id, e.work_date, e.shift_type
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId AND s.user_id = @userId
       WHERE e.work_date >= @start AND e.work_date <= @end
       ORDER BY e.work_date`,
      { tenantId, userId: colleagueId, start, end }
    );
    const entries = (result.recordset || []).map((row) => ({
      entry_id: getRow(row, 'entry_id'),
      work_date: getRow(row, 'work_date'),
      shift_type: getRow(row, 'shift_type'),
    }));
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// Swap requests involving the current user, overlapping the calendar month (for profile UI)
router.get('/shift-swaps/my', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.json({ requests: [] });
    const def = wallMonthYearInAppZone();
    const m = req.query.month != null ? parseInt(req.query.month, 10) : def.monthIndex0;
    const y = req.query.year != null ? parseInt(req.query.year, 10) : def.year;
    const start = calendarMonthStartYmd(y, m);
    const end = calendarMonthEndYmd(y, m);
    const result = await query(
      `SELECT r.*,
        ru.full_name AS requester_name, cu.full_name AS counterparty_name,
        re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
        ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
       FROM shift_swap_requests r
       INNER JOIN users ru ON ru.id = r.requester_user_id
       INNER JOIN users cu ON cu.id = r.counterparty_user_id
       INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
       INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
       WHERE r.tenant_id = @tenantId
         AND (r.requester_user_id = @userId OR r.counterparty_user_id = @userId)
         AND r.status NOT IN (N'cancelled')
         AND (
           (CONVERT(date, re.work_date) >= @start AND CONVERT(date, re.work_date) <= @end)
           OR (CONVERT(date, ce.work_date) >= @start AND CONVERT(date, ce.work_date) <= @end)
         )
       ORDER BY r.created_at DESC`,
      { tenantId, userId, start, end }
    );
    res.json({ requests: (result.recordset || []).map((row) => mapSwapRow(row)) });
  } catch (err) {
    next(err);
  }
});

router.post('/shift-swaps', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const requesterId = req.user.id;
    const { counterparty_user_id, requester_entry_id, counterparty_entry_id, message } = req.body || {};
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    if (!counterparty_user_id || !requester_entry_id || !counterparty_entry_id) {
      return res.status(400).json({ error: 'counterparty_user_id, requester_entry_id, and counterparty_entry_id required' });
    }
    if (String(counterparty_user_id).toLowerCase() === String(requesterId).toLowerCase()) {
      return res.status(400).json({ error: 'Cannot swap with yourself' });
    }
    const re = await loadEntryWithSchedule(requester_entry_id);
    const ce = await loadEntryWithSchedule(counterparty_entry_id);
    if (!re || !ce) return res.status(404).json({ error: 'One or both shifts not found' });
    if (String(getRow(re, 'tenant_id')).toLowerCase() !== String(tenantId).toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(ce, 'tenant_id')).toLowerCase() !== String(tenantId).toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(re, 'schedule_user_id')).toLowerCase() !== String(requesterId).toLowerCase()) {
      return res.status(403).json({ error: 'You can only offer your own scheduled shifts' });
    }
    if (String(getRow(ce, 'schedule_user_id')).toLowerCase() !== String(counterparty_user_id).toLowerCase()) {
      return res.status(400).json({ error: 'Counterparty shift must belong to the selected colleague' });
    }
    const dup = await query(
      `SELECT id FROM shift_swap_requests
       WHERE status IN (N'pending_peer', N'pending_management')
         AND (requester_entry_id = @re OR counterparty_entry_id = @re OR requester_entry_id = @ce OR counterparty_entry_id = @ce)`,
      { re: requester_entry_id, ce: counterparty_entry_id }
    );
    if (dup.recordset?.length) return res.status(409).json({ error: 'One of these shifts already has an open swap request' });
    const ins = await query(
      `INSERT INTO shift_swap_requests (tenant_id, requester_user_id, counterparty_user_id, requester_entry_id, counterparty_entry_id, message, status)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @requesterId, @counterpartyId, @re, @ce, @message, N'pending_peer')`,
      {
        tenantId,
        requesterId,
        counterpartyId: counterparty_user_id,
        re: requester_entry_id,
        ce: counterparty_entry_id,
        message: message != null && String(message).trim() ? String(message).trim().slice(0, 500) : null,
      }
    );
    const row = ins.recordset[0];
    const full = await query(
      `SELECT r.*,
        ru.full_name AS requester_name, cu.full_name AS counterparty_name,
        re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
        ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
       FROM shift_swap_requests r
       INNER JOIN users ru ON ru.id = r.requester_user_id
       INNER JOIN users cu ON cu.id = r.counterparty_user_id
       INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
       INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
       WHERE r.id = @id`,
      { id: getRow(row, 'id') }
    );
    if (isEmailConfigured()) {
      const swap = mapSwapRow(full.recordset[0]);
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      const cpUser = await query(`SELECT email FROM users WHERE id = @id`, { id: counterparty_user_id });
      const cpEmail = cpUser.recordset?.[0] && getRow(cpUser.recordset[0], 'email');
      if (cpEmail && String(cpEmail).trim()) {
        const html = shiftSwapRequestedHtml({
          requesterName: swap?.requester_name || req.user.full_name || req.user.email || 'Colleague',
          requesterDate: swap?.requester_work_date,
          requesterShift: swap?.requester_shift_type,
          yourDate: swap?.counterparty_work_date,
          yourShift: swap?.counterparty_shift_type,
          message: swap?.message || null,
          appUrl,
        });
        sendEmail({
          to: cpEmail,
          subject: `Shift swap request from ${swap?.requester_name || 'colleague'}`,
          body: html,
          html: true,
        }).catch((e) => console.error('[profile-management] Shift swap request email error:', e?.message));
      }
    }
    res.status(201).json({ request: mapSwapRow(full.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/shift-swaps/:id/cancel', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM shift_swap_requests WHERE id = @id`, { id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'tenant_id')).toLowerCase() !== String(tenantId).toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(row, 'requester_user_id')).toLowerCase() !== String(req.user.id).toLowerCase()) {
      return res.status(403).json({ error: 'Only the requester can cancel' });
    }
    if (getRow(row, 'status') !== 'pending_peer') return res.status(400).json({ error: 'Only pending peer requests can be cancelled' });
    await query(
      `UPDATE shift_swap_requests SET status = N'cancelled', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/shift-swaps/:id/peer', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approve, notes } = req.body || {};
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM shift_swap_requests WHERE id = @id`, { id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'tenant_id')).toLowerCase() !== String(tenantId).toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(row, 'counterparty_user_id')).toLowerCase() !== String(req.user.id).toLowerCase()) {
      return res.status(403).json({ error: 'Only the colleague can respond' });
    }
    if (getRow(row, 'status') !== 'pending_peer') return res.status(400).json({ error: 'This request is not awaiting your response' });
    if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve (boolean) required' });
    const note = notes != null && String(notes).trim() ? String(notes).trim().slice(0, 500) : null;
    if (approve === true) {
      await query(
        `UPDATE shift_swap_requests SET status = N'pending_management', peer_reviewed_at = SYSUTCDATETIME(), peer_review_notes = @notes, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id, notes: note }
      );
    } else {
      await query(
        `UPDATE shift_swap_requests SET status = N'peer_declined', peer_reviewed_at = SYSUTCDATETIME(), peer_review_notes = @notes, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id, notes: note }
      );
    }
    const full = await query(
      `SELECT r.*,
        ru.full_name AS requester_name, cu.full_name AS counterparty_name,
        re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
        ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
       FROM shift_swap_requests r
       INNER JOIN users ru ON ru.id = r.requester_user_id
       INNER JOIN users cu ON cu.id = r.counterparty_user_id
       INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
       INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
       WHERE r.id = @id`,
      { id }
    );
    if (isEmailConfigured()) {
      const swap = mapSwapRow(full.recordset[0]);
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      if (approve === true) {
        const managementEmails = await getManagementEmailsForTenant(query, tenantId);
        if (managementEmails.length > 0) {
          const html = shiftSwapPendingManagementHtml({
            requesterName: swap?.requester_name,
            counterpartyName: swap?.counterparty_name,
            requesterDate: swap?.requester_work_date,
            requesterShift: swap?.requester_shift_type,
            counterpartyDate: swap?.counterparty_work_date,
            counterpartyShift: swap?.counterparty_shift_type,
            appUrl,
          });
          for (const to of managementEmails) {
            sendEmail({
              to,
              subject: 'Shift swap pending management approval',
              body: html,
              html: true,
            }).catch((e) => console.error('[profile-management] Shift swap management notification email error:', e?.message));
          }
        }
      } else {
        const requesterId = getRow(row, 'requester_user_id');
        const reqUser = await query(`SELECT email FROM users WHERE id = @id`, { id: requesterId });
        const requesterEmail = reqUser.recordset?.[0] && getRow(reqUser.recordset[0], 'email');
        if (requesterEmail && String(requesterEmail).trim().includes('@')) {
          const html = shiftSwapPeerDeclinedHtml({
            counterpartyName: swap?.counterparty_name,
            requesterDate: swap?.requester_work_date,
            requesterShift: swap?.requester_shift_type,
            counterpartyDate: swap?.counterparty_work_date,
            counterpartyShift: swap?.counterparty_shift_type,
            peerNotes: note,
            appUrl,
          });
          sendEmail({
            to: requesterEmail,
            subject: `Shift swap declined by ${swap?.counterparty_name || 'colleague'}`,
            body: html,
            html: true,
          }).catch((e) => console.error('[profile-management] Shift swap peer declined email error:', e?.message));
        }
      }
    }
    res.json({ request: mapSwapRow(full.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.get('/shift-swaps/management-queue', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ requests: [] });
    const statusFilter = req.query.status;
    let sqlQuery = `SELECT r.*,
        ru.full_name AS requester_name, cu.full_name AS counterparty_name,
        re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
        ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
       FROM shift_swap_requests r
       INNER JOIN users ru ON ru.id = r.requester_user_id
       INNER JOIN users cu ON cu.id = r.counterparty_user_id
       INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
       INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
       WHERE r.tenant_id = @tenantId`;
    const params = { tenantId };
    if (statusFilter === 'pending') {
      sqlQuery += ` AND r.status = N'pending_management'`;
    } else if (statusFilter === 'history') {
      sqlQuery += ` AND r.status IN (N'management_approved', N'management_declined', N'peer_declined', N'cancelled')`;
    } else {
      sqlQuery += ` AND r.status IN (N'pending_management', N'management_approved', N'management_declined', N'peer_declined', N'cancelled')`;
    }
    sqlQuery += ' ORDER BY r.created_at DESC';
    const result = await query(sqlQuery, params);
    res.json({ requests: (result.recordset || []).map((row) => mapSwapRow(row)) });
  } catch (err) {
    next(err);
  }
});

router.patch('/shift-swaps/:id/management', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approve, notes } = req.body || {};
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM shift_swap_requests WHERE id = @id`, { id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'tenant_id')).toLowerCase() !== String(tenantId).toLowerCase()) return res.status(403).json({ error: 'Forbidden' });
    if (getRow(row, 'status') !== 'pending_management') return res.status(400).json({ error: 'This swap is not awaiting management approval' });
    if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve (boolean) required' });
    const note = notes != null && String(notes).trim() ? String(notes).trim().slice(0, 500) : null;
    if (approve !== true) {
      await query(
        `UPDATE shift_swap_requests SET status = N'management_declined', management_reviewed_at = SYSUTCDATETIME(), management_review_notes = @notes, management_reviewed_by = @by, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id, notes: note, by: req.user.id }
      );
      const full = await query(
        `SELECT r.*,
          ru.full_name AS requester_name, cu.full_name AS counterparty_name,
          re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
          ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
         FROM shift_swap_requests r
         INNER JOIN users ru ON ru.id = r.requester_user_id
         INNER JOIN users cu ON cu.id = r.counterparty_user_id
         INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
         INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
         WHERE r.id = @id`,
        { id }
      );
      const swapDeclined = mapSwapRow(full.recordset[0]);
      if (isEmailConfigured()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const requesterUserId = getRow(row, 'requester_user_id');
        const counterpartyUserId = getRow(row, 'counterparty_user_id');
        const usersResult = await query(
          `SELECT id, email FROM users WHERE id IN (@requesterId, @counterpartyId)`,
          { requesterId: requesterUserId, counterpartyId: counterpartyUserId }
        );
        const emailsById = new Map(
          (usersResult.recordset || []).map((u) => [String(getRow(u, 'id')), String(getRow(u, 'email') || '').trim()])
        );
        const requesterEmail = emailsById.get(String(requesterUserId));
        const counterpartyEmail = emailsById.get(String(counterpartyUserId));
        if (requesterEmail && requesterEmail.includes('@')) {
          const html = shiftSwapManagementDeclinedHtml({
            otherPartyName: swapDeclined?.counterparty_name,
            requesterDate: swapDeclined?.requester_work_date,
            requesterShift: swapDeclined?.requester_shift_type,
            counterpartyDate: swapDeclined?.counterparty_work_date,
            counterpartyShift: swapDeclined?.counterparty_shift_type,
            managementNotes: note,
            appUrl,
          });
          sendEmail({
            to: requesterEmail,
            subject: 'Shift swap not approved by management',
            body: html,
            html: true,
          }).catch((e) => console.error('[profile-management] Shift swap management declined requester email error:', e?.message));
        }
        if (counterpartyEmail && counterpartyEmail.includes('@')) {
          const html = shiftSwapManagementDeclinedHtml({
            otherPartyName: swapDeclined?.requester_name,
            requesterDate: swapDeclined?.requester_work_date,
            requesterShift: swapDeclined?.requester_shift_type,
            counterpartyDate: swapDeclined?.counterparty_work_date,
            counterpartyShift: swapDeclined?.counterparty_shift_type,
            managementNotes: note,
            appUrl,
          });
          sendEmail({
            to: counterpartyEmail,
            subject: 'Shift swap not approved by management',
            body: html,
            html: true,
          }).catch((e) => console.error('[profile-management] Shift swap management declined counterparty email error:', e?.message));
        }
      }
      return res.json({ request: swapDeclined });
    }
    const reId = getRow(row, 'requester_entry_id');
    const ceId = getRow(row, 'counterparty_entry_id');
    const requesterUserId = getRow(row, 'requester_user_id');
    const counterpartyUserId = getRow(row, 'counterparty_user_id');
    const e1 = await loadEntryWithSchedule(reId);
    const e2 = await loadEntryWithSchedule(ceId);
    if (!e1 || !e2) return res.status(400).json({ error: 'Schedule entries missing' });
    if (String(getRow(e1, 'schedule_user_id')).toLowerCase() !== String(requesterUserId).toLowerCase()
      || String(getRow(e2, 'schedule_user_id')).toLowerCase() !== String(counterpartyUserId).toLowerCase()) {
      return res.status(400).json({ error: 'Schedule data no longer matches this request' });
    }
    const d1 = getRow(e1, 'work_date');
    const s1 = getRow(e1, 'shift_type');
    const d2 = getRow(e2, 'work_date');
    const s2 = getRow(e2, 'shift_type');
    const d1s = toYmdFromDbOrString(d1);
    const d2s = toYmdFromDbOrString(d2);
    const clash1 = await query(
      `SELECT COUNT(*) AS c FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id
       WHERE s.tenant_id = @tenantId AND s.user_id = @uid AND CONVERT(date, e.work_date) = CONVERT(date, @targetDate)
         AND e.id != @excludeId`,
      { tenantId, uid: requesterUserId, targetDate: d2s, excludeId: reId }
    );
    const clash2 = await query(
      `SELECT COUNT(*) AS c FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id
       WHERE s.tenant_id = @tenantId AND s.user_id = @uid AND CONVERT(date, e.work_date) = CONVERT(date, @targetDate)
         AND e.id != @excludeId`,
      { tenantId, uid: counterpartyUserId, targetDate: d1s, excludeId: ceId }
    );
    const c1 = clash1.recordset?.[0] && parseInt(getRow(clash1.recordset[0], 'c'), 10);
    const c2 = clash2.recordset?.[0] && parseInt(getRow(clash2.recordset[0], 'c'), 10);
    if (c1 > 0 || c2 > 0) {
      return res.status(409).json({
        error: 'Cannot apply swap: one employee already has another shift on the target date. Adjust schedules manually, then retry.',
      });
    }
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await execTx(transaction, `UPDATE work_schedule_entries SET work_date = @d, shift_type = @s WHERE id = @id`, {
        d: d2s,
        s: s2,
        id: reId,
      });
      await execTx(transaction, `UPDATE work_schedule_entries SET work_date = @d, shift_type = @s WHERE id = @id`, {
        d: d1s,
        s: s1,
        id: ceId,
      });
      await execTx(
        transaction,
        `UPDATE shift_swap_requests SET status = N'management_approved', management_reviewed_at = SYSUTCDATETIME(), management_review_notes = @notes, management_reviewed_by = @by, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id, notes: note, by: req.user.id }
      );
      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
    const full = await query(
      `SELECT r.*,
        ru.full_name AS requester_name, cu.full_name AS counterparty_name,
        re.work_date AS requester_work_date, re.shift_type AS requester_shift_type,
        ce.work_date AS counterparty_work_date, ce.shift_type AS counterparty_shift_type
       FROM shift_swap_requests r
       INNER JOIN users ru ON ru.id = r.requester_user_id
       INNER JOIN users cu ON cu.id = r.counterparty_user_id
       INNER JOIN work_schedule_entries re ON re.id = r.requester_entry_id
       INNER JOIN work_schedule_entries ce ON ce.id = r.counterparty_entry_id
       WHERE r.id = @id`,
      { id }
    );
    if (isEmailConfigured()) {
      const swap = mapSwapRow(full.recordset[0]);
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      const usersResult = await query(
        `SELECT id, email FROM users WHERE id IN (@requesterId, @counterpartyId)`,
        { requesterId: requesterUserId, counterpartyId: counterpartyUserId }
      );
      const emailsById = new Map(
        (usersResult.recordset || []).map((u) => [String(getRow(u, 'id')), String(getRow(u, 'email') || '').trim()])
      );
      const requesterEmail = emailsById.get(String(requesterUserId));
      const counterpartyEmail = emailsById.get(String(counterpartyUserId));

      if (requesterEmail && requesterEmail.includes('@')) {
        const html = shiftSwapApprovedHtml({
          counterpartyName: swap?.counterparty_name,
          yourOldDate: d1s,
          yourOldShift: s1,
          yourNewDate: d2s,
          yourNewShift: s2,
          appUrl,
        });
        sendEmail({
          to: requesterEmail,
          subject: 'Shift swap approved by management',
          body: html,
          html: true,
        }).catch((e) => console.error('[profile-management] Shift swap approved requester email error:', e?.message));
      }
      if (counterpartyEmail && counterpartyEmail.includes('@')) {
        const html = shiftSwapApprovedHtml({
          counterpartyName: swap?.requester_name,
          yourOldDate: d2s,
          yourOldShift: s2,
          yourNewDate: d1s,
          yourNewShift: s1,
          appUrl,
        });
        sendEmail({
          to: counterpartyEmail,
          subject: 'Shift swap approved by management',
          body: html,
          html: true,
        }).catch((e) => console.error('[profile-management] Shift swap approved counterparty email error:', e?.message));
      }
    }
    res.json({ request: mapSwapRow(full.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.get('/schedules/:id/entries', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const sched = await query(`SELECT s.id, s.tenant_id, s.user_id, u.full_name AS user_name FROM work_schedules s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = @id`, { id });
    const row = sched.recordset[0];
    if (!row) return res.status(404).json({ error: 'Schedule not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    const result = await query(
      `SELECT e.id, e.work_date, e.shift_type, e.notes
       FROM work_schedule_entries e
       WHERE e.work_schedule_id = @id ORDER BY e.work_date`,
      { id }
    );
    const entries = (result.recordset || []).map((r) => ({
      id: getRow(r, 'id'),
      work_date: getRow(r, 'work_date'),
      shift_type: getRow(r, 'shift_type'),
      notes: getRow(r, 'notes'),
    }));
    res.json({ schedule_user_id: getRow(row, 'user_id'), schedule_user_name: getRow(row, 'user_name'), entries });
  } catch (err) {
    next(err);
  }
});

// —— Leave types (tenant-defined; profile lists, management CRUD) ——
router.get('/leave/types', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ types: [] });
    const result = await query(
      `SELECT id, name, default_days_per_year FROM leave_types WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId }
    );
    res.json({ types: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/leave/types', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { name, default_days_per_year } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !name) return res.status(400).json({ error: 'name required' });
    await query(
      `INSERT INTO leave_types (tenant_id, name, default_days_per_year) VALUES (@tenantId, @name, @defaultDays)`,
      { tenantId, name: String(name).trim(), defaultDays: default_days_per_year != null ? parseInt(default_days_per_year, 10) : null }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// —— Leave balance (Profile) ——
router.get('/leave/balance', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    const year = req.query.year != null ? parseInt(req.query.year, 10) : wallMonthYearInAppZone().year;
    const result = await query(
      `SELECT leave_type, total_days, used_days FROM leave_balance WHERE user_id = @userId AND tenant_id = @tenantId AND [year] = @year`,
      { userId, tenantId, year }
    );
    res.json({ balance: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// —— Leave applications ——
router.get('/leave/applications', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT id, leave_type, start_date, end_date, days_requested, reason, status, created_at, reviewed_at, review_notes
       FROM leave_applications WHERE user_id = @userId AND tenant_id = @tenantId ORDER BY created_at DESC`,
      { userId, tenantId }
    );
    res.json({ applications: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// Leave applications history (same as applications; for export label)
router.get('/leave/applications/history', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT id, leave_type, start_date, end_date, days_requested, reason, status, created_at, reviewed_at, review_notes
       FROM leave_applications WHERE user_id = @userId AND tenant_id = @tenantId ORDER BY created_at DESC`,
      { userId, tenantId }
    );
    res.json({ applications: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/leave/applications', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { leave_type, start_date, end_date, days_requested, reason } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    if (!leave_type || !start_date || !end_date) return res.status(400).json({ error: 'leave_type, start_date, end_date required' });
    const days = Math.max(1, parseInt(days_requested, 10) || 1);
    const ins = await query(
      `INSERT INTO leave_applications (tenant_id, user_id, leave_type, start_date, end_date, days_requested, reason)
       OUTPUT INSERTED.id, INSERTED.status, INSERTED.created_at
       VALUES (@tenantId, @userId, @leaveType, @startDate, @endDate, @days, @reason)`,
      { tenantId, userId: req.user.id, leaveType: String(leave_type).trim(), startDate: start_date, endDate: end_date, days, reason: reason || null }
    );
    const row = ins.recordset[0];
    if (isEmailConfigured()) {
      const managementEmails = await getManagementEmailsForTenant(query, tenantId);
      const applicantName = req.user.full_name || req.user.email || 'An employee';
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      const html = leaveAppliedHtml({
        applicantName,
        leaveType: String(leave_type).trim(),
        startDate: start_date,
        endDate: end_date,
        daysRequested: days,
        reason: reason || null,
        appUrl,
      });
      const subject = `Leave application: ${applicantName} – ${String(leave_type).trim()}`;
      for (const to of managementEmails) {
        sendEmail({ to, subject, body: html, html: true }).catch((e) => console.error('[profile-management] Leave applied email error:', e?.message));
      }
    }
    res.status(201).json({ application: { id: getRow(row, 'id'), status: getRow(row, 'status'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

router.post('/leave/applications/:id/attachments', leaveUpload, requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files || [];
    const app = await query(`SELECT id, tenant_id, user_id FROM leave_applications WHERE id = @id`, { id });
    const row = app.recordset[0];
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    if (getRow(row, 'user_id') !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const uploaded = [];
    for (const file of files) {
      const rel = path.relative(path.join(process.cwd(), 'uploads'), file.path).replace(/\\/g, '/');
      const ins = await query(
        `INSERT INTO leave_attachments (leave_application_id, file_name, file_path, uploaded_by)
         OUTPUT INSERTED.id, INSERTED.file_name, INSERTED.created_at
         VALUES (@leaveId, @fileName, @filePath, @userId)`,
        { leaveId: id, fileName: file.originalname || file.filename, filePath: rel, userId: req.user.id }
      );
      const r = ins.recordset[0];
      uploaded.push({ id: getRow(r, 'id'), file_name: getRow(r, 'file_name'), created_at: getRow(r, 'created_at') });
    }
    res.status(201).json({ attachments: uploaded });
  } catch (err) {
    next(err);
  }
});

router.get('/leave/pending', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.days_requested, l.reason, l.created_at, u.full_name AS user_name
       FROM leave_applications l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.tenant_id = @tenantId AND l.status = N'pending' ORDER BY l.created_at`,
      { tenantId }
    );
    res.json({ applications: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.patch('/leave/applications/:id/review', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, review_notes } = req.body || {};
    if (!status || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const app = await query(`SELECT id, tenant_id, user_id, leave_type, start_date, end_date, days_requested FROM leave_applications WHERE id = @id`, { id });
    const row = app.recordset[0];
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    await query(
      `UPDATE leave_applications SET status = @status, reviewed_by = @reviewedBy, reviewed_at = SYSUTCDATETIME(), review_notes = @reviewNotes WHERE id = @id`,
      { id, status, reviewedBy: req.user.id, reviewNotes: review_notes || null }
    );
    if (status === 'approved') {
      const startYmd = toYmdFromDbOrString(getRow(row, 'start_date'));
      const year = startYmd.length >= 4 ? parseInt(startYmd.slice(0, 4), 10) : wallMonthYearInAppZone().year;
      const leaveType = getRow(row, 'leave_type');
      const days = getRow(row, 'days_requested') || 0;
      const uid = getRow(row, 'user_id');
      const tid = getRow(row, 'tenant_id');
      await query(
        `UPDATE leave_balance SET used_days = used_days + @days
         WHERE user_id = @userId AND tenant_id = @tenantId AND [year] = @year AND leave_type = @leaveType`,
        { userId: uid, tenantId: tid, year, leaveType, days }
      );
      const upd = await query(`SELECT @@ROWCOUNT AS n`, {});
      if (getRow(upd.recordset[0], 'n') === 0) {
        await query(
          `INSERT INTO leave_balance (user_id, tenant_id, [year], leave_type, total_days, used_days)
           VALUES (@userId, @tenantId, @year, @leaveType, 0, @days)`,
          { userId: uid, tenantId: tid, year, leaveType, days }
        );
      }
    }
    if (isEmailConfigured()) {
      const applicantId = getRow(row, 'user_id');
      const applicantResult = await query(`SELECT email FROM users WHERE id = @id`, { id: applicantId });
      const applicantEmail = applicantResult.recordset?.[0] && getRow(applicantResult.recordset[0], 'email');
      if (applicantEmail && String(applicantEmail).trim()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const html = leaveReviewedHtml({
          status,
          leaveType: getRow(row, 'leave_type'),
          startDate: getRow(row, 'start_date'),
          endDate: getRow(row, 'end_date'),
          reviewedByName: req.user.full_name || req.user.email || null,
          reviewNotes: review_notes || null,
          appUrl,
        });
        const subject = status === 'approved' ? 'Leave application approved' : 'Leave application declined';
        sendEmail({ to: applicantEmail, subject, body: html, html: true }).catch((e) => console.error('[profile-management] Leave reviewed email error:', e?.message));
      }
    }
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

// —— Documents ——
router.get('/documents', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const userId = req.query.userId || req.user.id;
    if (userId !== req.user.id && !req.user.page_roles?.includes('management')) return res.status(403).json({ error: 'Forbidden' });
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT id, file_name, category, created_at FROM profile_documents WHERE user_id = @userId AND tenant_id = @tenantId ORDER BY created_at DESC`,
      { userId, tenantId }
    );
    res.json({ documents: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/documents', documentUpload, requirePageAccess('profile'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    const category = req.body?.category || null;
    const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
    const ins = await query(
      `INSERT INTO profile_documents (user_id, tenant_id, file_name, file_path, category, uploaded_by)
       OUTPUT INSERTED.id, INSERTED.file_name, INSERTED.created_at
       VALUES (@userId, @tenantId, @fileName, @filePath, @category, @uploadedBy)`,
      { userId, tenantId, fileName: req.file.originalname || req.file.filename, filePath: rel, category, uploadedBy: req.user.id }
    );
    const row = ins.recordset[0];
    res.status(201).json({ document: { id: getRow(row, 'id'), file_name: getRow(row, 'file_name'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id/download', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT d.file_path, d.file_name, d.user_id, d.tenant_id FROM profile_documents d WHERE d.id = @id`,
      { id }
    );
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    if (getRow(row, 'user_id') !== req.user.id && !req.user.page_roles?.includes('management')) return res.status(403).json({ error: 'Forbidden' });
    const fullPath = path.join(process.cwd(), 'uploads', getRow(row, 'file_path'));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.download(fullPath, getRow(row, 'file_name') || 'document');
  } catch (err) {
    next(err);
  }
});

router.get('/documents/library', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT d.id, d.user_id, d.file_name, d.category, d.created_at, u.full_name AS user_name
       FROM profile_documents d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.tenant_id = @tenantId ORDER BY d.created_at DESC`,
      { tenantId }
    );
    res.json({ documents: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// —— Warnings & rewards ——
router.get('/warnings', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT w.id, w.warning_type, w.description, w.created_at, u.full_name AS issued_by_name
       FROM disciplinary_warnings w LEFT JOIN users u ON u.id = w.issued_by
       WHERE w.user_id = @userId ORDER BY w.created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ warnings: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/rewards', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.reward_type, r.description, r.created_at, u.full_name AS issued_by_name
       FROM rewards r LEFT JOIN users u ON u.id = r.issued_by
       WHERE r.user_id = @userId ORDER BY r.created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ rewards: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/warnings', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, warning_type, description } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !user_id || !warning_type) return res.status(400).json({ error: 'user_id and warning_type required' });
    const ins = await query(
      `INSERT INTO disciplinary_warnings (tenant_id, user_id, issued_by, warning_type, description)
       OUTPUT INSERTED.id, INSERTED.created_at
       VALUES (@tenantId, @userId, @issuedBy, @warningType, @description)`,
      { tenantId, userId: user_id, issuedBy: req.user.id, warningType: String(warning_type).trim(), description: description || null }
    );
    const row = ins.recordset[0];
    if (isEmailConfigured()) {
      const userRow = await query(`SELECT email FROM users WHERE id = @id`, { id: user_id });
      const email = userRow.recordset?.[0] && getRow(userRow.recordset[0], 'email');
      if (email && String(email).trim()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const html = warningIssuedHtml({
          warningType: String(warning_type).trim(),
          description: description || null,
          issuedByName: req.user.full_name || req.user.email || null,
          appUrl,
        });
        sendEmail({ to: email, subject: `Disciplinary warning: ${String(warning_type).trim()}`, body: html, html: true }).catch((e) => console.error('[profile-management] Warning email error:', e?.message));
      }
    }
    res.status(201).json({ warning: { id: getRow(row, 'id'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

router.post('/rewards', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, reward_type, description } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !user_id || !reward_type) return res.status(400).json({ error: 'user_id and reward_type required' });
    const ins = await query(
      `INSERT INTO rewards (tenant_id, user_id, issued_by, reward_type, description)
       OUTPUT INSERTED.id, INSERTED.created_at
       VALUES (@tenantId, @userId, @issuedBy, @rewardType, @description)`,
      { tenantId, userId: user_id, issuedBy: req.user.id, rewardType: String(reward_type).trim(), description: description || null }
    );
    const row = ins.recordset[0];
    if (isEmailConfigured()) {
      const userRow = await query(`SELECT email FROM users WHERE id = @id`, { id: user_id });
      const email = userRow.recordset?.[0] && getRow(userRow.recordset[0], 'email');
      if (email && String(email).trim()) {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const html = rewardIssuedHtml({
          rewardType: String(reward_type).trim(),
          description: description || null,
          issuedByName: req.user.full_name || req.user.email || null,
          appUrl,
        });
        sendEmail({ to: email, subject: `Reward: ${String(reward_type).trim()}`, body: html, html: true }).catch((e) => console.error('[profile-management] Reward email error:', e?.message));
      }
    }
    res.status(201).json({ reward: { id: getRow(row, 'id'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

router.get('/warnings/all', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ warnings: [] });
    const result = await query(
      `SELECT w.id, w.user_id, w.warning_type, w.description, w.created_at,
              u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name
       FROM disciplinary_warnings w
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN users iss ON iss.id = w.issued_by
       WHERE w.tenant_id = @tenantId ORDER BY w.created_at DESC`,
      { tenantId }
    );
    res.json({ warnings: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/rewards/all', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ rewards: [] });
    const result = await query(
      `SELECT r.id, r.user_id, r.reward_type, r.description, r.created_at,
              u.full_name AS user_name, u.email AS user_email, iss.full_name AS issued_by_name
       FROM rewards r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN users iss ON iss.id = r.issued_by
       WHERE r.tenant_id = @tenantId ORDER BY r.created_at DESC`,
      { tenantId }
    );
    res.json({ rewards: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// —— Queries (grievances) ——
router.get('/queries', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, subject, body, status, created_at, responded_at, response_text FROM queries WHERE user_id = @userId ORDER BY created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ queries: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/queries', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const { subject, body } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !subject) return res.status(400).json({ error: 'subject required' });
    const ins = await query(
      `INSERT INTO queries (tenant_id, user_id, subject, body)
       OUTPUT INSERTED.id, INSERTED.status, INSERTED.created_at
       VALUES (@tenantId, @userId, @subject, @body)`,
      { tenantId, userId: req.user.id, subject: String(subject).trim(), body: body || null }
    );
    const row = ins.recordset[0];
    res.status(201).json({ query: { id: getRow(row, 'id'), status: getRow(row, 'status'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

router.get('/queries/all', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT q.id, q.user_id, q.subject, q.body, q.status, q.created_at, q.responded_at, u.full_name AS user_name
       FROM queries q LEFT JOIN users u ON u.id = q.user_id
       WHERE q.tenant_id = @tenantId ORDER BY q.created_at DESC`,
      { tenantId }
    );
    res.json({ queries: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.patch('/queries/:id/respond', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { response_text } = req.body || {};
    const q = await query(`SELECT id, tenant_id FROM queries WHERE id = @id`, { id });
    const row = q.recordset[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    await query(
      `UPDATE queries SET status = N'closed', response_text = @responseText, responded_at = SYSUTCDATETIME(), responded_by = @userId WHERE id = @id`,
      { id, responseText: response_text || null, userId: req.user.id }
    );
    res.json({ status: 'closed' });
  } catch (err) {
    next(err);
  }
});

// —— Evaluations ——
router.get('/evaluations', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT e.id, e.period, e.rating, e.notes, e.created_at, u.full_name AS evaluator_name
       FROM evaluations e LEFT JOIN users u ON u.id = e.evaluator_id
       WHERE e.user_id = @userId ORDER BY e.created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ evaluations: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/evaluations/all', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT e.id, e.user_id, e.period, e.rating, e.notes, e.file_path, e.created_at, u.full_name AS user_name, ev.full_name AS evaluator_name
       FROM evaluations e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users ev ON ev.id = e.evaluator_id
       WHERE e.tenant_id = @tenantId ORDER BY e.created_at DESC`,
      { tenantId }
    );
    res.json({ evaluations: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/evaluations', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, period, rating, notes } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !user_id || !period) return res.status(400).json({ error: 'user_id and period required' });
    const ins = await query(
      `INSERT INTO evaluations (tenant_id, user_id, evaluator_id, period, rating, notes)
       OUTPUT INSERTED.id, INSERTED.created_at
       VALUES (@tenantId, @userId, @evaluatorId, @period, @rating, @notes)`,
      { tenantId, userId: user_id, evaluatorId: req.user.id, period: String(period).trim(), rating: rating || null, notes: notes || null }
    );
    const row = ins.recordset[0];
    res.status(201).json({ evaluation: { id: getRow(row, 'id'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

/** GET controller (shift report) evaluations for Management → Evaluations tab */
router.get('/evaluations/controller-evaluations', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT e.id, e.shift_report_id, e.answers, e.overall_comment, e.created_at,
        r.route, r.report_date, r.controller1_name, r.controller2_name,
        ev.full_name AS evaluator_name
       FROM controller_evaluations e
       INNER JOIN command_centre_shift_reports r ON r.id = e.shift_report_id
       LEFT JOIN users ev ON ev.id = e.evaluator_user_id
       WHERE (@tenantId IS NULL OR e.tenant_id = @tenantId OR e.tenant_id IS NULL)
       ORDER BY e.created_at DESC`,
      { tenantId: tenantId || null }
    );
    const list = (result.recordset || []).map((row) => ({
      id: getRow(row, 'id'),
      shift_report_id: getRow(row, 'shift_report_id'),
      route: getRow(row, 'route'),
      report_date: getRow(row, 'report_date'),
      controller1_name: getRow(row, 'controller1_name'),
      controller2_name: getRow(row, 'controller2_name'),
      evaluator_name: getRow(row, 'evaluator_name'),
      overall_comment: getRow(row, 'overall_comment'),
      answers: getRow(row, 'answers'),
      created_at: getRow(row, 'created_at'),
    }));
    res.json({ evaluations: list });
  } catch (err) {
    if (err?.message && (err.message.includes('controller_evaluations') || err.message.includes('Invalid object'))) {
      console.warn('[profile-management] Controller evaluations table may be missing. Run: node scripts/run-command-centre-controller-evaluations.js');
      return res.json({ evaluations: [], migrationRequired: true });
    }
    next(err);
  }
});

/** GET one controller evaluation (full detail for Management) */
router.get('/evaluations/controller-evaluations/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT e.id, e.shift_report_id, e.answers, e.overall_comment, e.created_at,
        r.route, r.report_date, r.shift_date, r.controller1_name, r.controller2_name, r.controller1_email, r.controller2_email,
        ev.full_name AS evaluator_name, ev.email AS evaluator_email
       FROM controller_evaluations e
       INNER JOIN command_centre_shift_reports r ON r.id = e.shift_report_id
       LEFT JOIN users ev ON ev.id = e.evaluator_user_id
       WHERE e.id = @id AND (@tenantId IS NULL OR e.tenant_id = @tenantId)`,
      { id: req.params.id, tenantId: tenantId || null }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });
    const answers = (() => { try { return typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers; } catch (_) { return {}; } })();
    res.json({
      evaluation: {
        id: getRow(row, 'id'),
        shift_report_id: getRow(row, 'shift_report_id'),
        route: getRow(row, 'route'),
        report_date: getRow(row, 'report_date'),
        shift_date: getRow(row, 'shift_date'),
        controller1_name: getRow(row, 'controller1_name'),
        controller2_name: getRow(row, 'controller2_name'),
        controller1_email: getRow(row, 'controller1_email'),
        controller2_email: getRow(row, 'controller2_email'),
        evaluator_name: getRow(row, 'evaluator_name'),
        evaluator_email: getRow(row, 'evaluator_email'),
        answers,
        overall_comment: getRow(row, 'overall_comment'),
        created_at: getRow(row, 'created_at'),
      },
    });
  } catch (err) {
    next(err);
  }
});

// —— PIP ——
router.get('/pip', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, goals, status, start_date, end_date, created_at FROM performance_improvement_plans WHERE user_id = @userId ORDER BY created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ plans: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/pip/all', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT p.id, p.user_id, p.title, p.goals, p.status, p.start_date, p.end_date, p.created_at, u.full_name AS user_name
       FROM performance_improvement_plans p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = @tenantId ORDER BY p.created_at DESC`,
      { tenantId }
    );
    res.json({ plans: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/pip', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { user_id, title, goals, start_date, end_date } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !user_id || !title) return res.status(400).json({ error: 'user_id and title required' });
    const ins = await query(
      `INSERT INTO performance_improvement_plans (tenant_id, user_id, created_by, title, goals, start_date, end_date)
       OUTPUT INSERTED.id, INSERTED.created_at
       VALUES (@tenantId, @userId, @createdBy, @title, @goals, @startDate, @endDate)`,
      { tenantId, userId: user_id, createdBy: req.user.id, title: String(title).trim(), goals: goals || null, startDate: start_date || null, endDate: end_date || null }
    );
    const row = ins.recordset[0];
    res.status(201).json({ plan: { id: getRow(row, 'id'), created_at: getRow(row, 'created_at') } });
  } catch (err) {
    next(err);
  }
});

// PIP progress updates (profile: own PIPs; management: any)
router.get('/pip/:id/progress', async (req, res, next) => {
  try {
    const { id } = req.params;
    const pip = await query(`SELECT id, user_id, tenant_id FROM performance_improvement_plans WHERE id = @id`, { id });
    const row = pip.recordset[0];
    if (!row) return res.status(404).json({ error: 'PIP not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    if (getRow(row, 'user_id') !== req.user.id && !req.user.page_roles?.includes('management')) return res.status(403).json({ error: 'Forbidden' });
    const result = await query(
      `SELECT id, progress_date, notes, created_at FROM pip_progress_updates WHERE pip_id = @id ORDER BY progress_date DESC`,
      { id }
    );
    res.json({ progress: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/pip/:id/progress', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress_date, notes } = req.body || {};
    const pip = await query(`SELECT id, user_id, tenant_id FROM performance_improvement_plans WHERE id = @id`, { id });
    const row = pip.recordset[0];
    if (!row) return res.status(404).json({ error: 'PIP not found' });
    if (!canAccessTenant(req, getRow(row, 'tenant_id'))) return res.status(403).json({ error: 'Forbidden' });
    if (getRow(row, 'user_id') !== req.user.id && !req.user.page_roles?.includes('management')) return res.status(403).json({ error: 'Forbidden' });
    if (!progress_date) return res.status(400).json({ error: 'progress_date required' });
    await query(
      `INSERT INTO pip_progress_updates (pip_id, progress_date, notes, created_by) VALUES (@pipId, @progressDate, @notes, @userId)`,
      { pipId: id, progressDate: progress_date, notes: notes || null, userId: req.user.id }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Schedule events (tenant events; profile lists by month, management CRUD)
router.get('/schedule-events', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { month, year } = req.query;
    if (!tenantId) return res.json({ events: [] });
    const def = wallMonthYearInAppZone();
    const m = month != null ? parseInt(month, 10) : def.monthIndex0;
    const y = year != null ? parseInt(year, 10) : def.year;
    const start = calendarMonthStartYmd(y, m);
    const end = calendarMonthEndYmd(y, m);
    const result = await query(
      `SELECT id, title, event_date, description, created_at FROM schedule_events
       WHERE tenant_id = @tenantId AND event_date >= @start AND event_date <= @end ORDER BY event_date`,
      { tenantId, start, end }
    );
    res.json({ events: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/schedule-events', requirePageAccess('management'), async (req, res, next) => {
  try {
    const { title, event_date, description } = req.body || {};
    const tenantId = req.user.tenant_id;
    if (!tenantId || !title || !event_date) return res.status(400).json({ error: 'title and event_date required' });
    await query(
      `INSERT INTO schedule_events (tenant_id, title, event_date, description, created_by) VALUES (@tenantId, @title, @eventDate, @description, @userId)`,
      { tenantId, title: String(title).trim(), eventDate: event_date, description: description || null, userId: req.user.id }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Tenant users for dropdowns (management, evaluations, etc.) — tenant_id OR user_tenants membership
router.get('/users/tenant', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.json({ users: [] });
    const result = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM users u
       WHERE u.status = 'active'
         AND (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
       ORDER BY u.full_name`,
      { tenantId }
    );
    res.json({ users: (result.recordset || []).map((r) => ({ id: getRow(r, 'id'), full_name: getRow(r, 'full_name'), email: getRow(r, 'email') })) });
  } catch (err) {
    next(err);
  }
});

/** Users in the tenant with Command Centre page access or a CC tab grant (same rule as Shift activity team list). For Profile work schedule overlay. */
router.get('/users/command-centre-peers', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const viewerId = req.user.id;
    if (!tenantId) return res.json({ users: [] });
    const tenantClause = `(u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))`;
    const ccSqlWithGrants = `
      SELECT DISTINCT u.id, u.full_name, u.email FROM users u
      WHERE ${tenantClause}
      AND u.status = 'active'
      AND u.email IS NOT NULL
      AND u.id <> @viewerId
      AND (
        EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
        OR EXISTS (SELECT 1 FROM command_centre_grants g WHERE g.user_id = u.id)
      )
      ORDER BY u.full_name`;
    let result;
    try {
      result = await query(ccSqlWithGrants, { tenantId, viewerId });
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('command_centre_grants') || msg.includes('invalid object')) {
        result = await query(
          `SELECT DISTINCT u.id, u.full_name, u.email FROM users u
           WHERE ${tenantClause}
           AND u.status = 'active'
           AND u.email IS NOT NULL
           AND u.id <> @viewerId
           AND EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
           ORDER BY u.full_name`,
          { tenantId, viewerId }
        );
      } else {
        throw e;
      }
    }
    res.json({
      users: (result.recordset || []).map((r) => ({ id: getRow(r, 'id'), full_name: getRow(r, 'full_name'), email: getRow(r, 'email') })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
