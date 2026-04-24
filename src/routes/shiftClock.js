/**
 * Shift clock-in, breaks (30 min / 1 h), overtime cap, CC access gate, management visibility.
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { getManagementEmailsForTenant } from '../lib/emailRecipients.js';
import { shiftClockAlertHtml, shiftLocationAuthRequestHtml } from '../lib/emailTemplates.js';
import { parseClientCoords, haversineMeters, allowedLocationRadiusMeters } from '../lib/geo.js';
import {
  todayYmd,
  yesterdayYmd,
  isEarlyMorningInAppZone,
  toYmdFromDbOrString,
} from '../lib/appTime.js';

const router = Router();

function requireProfileOrManagement(req, res, next) {
  if (req.user?.role === 'super_admin') return next();
  const pr = req.user?.page_roles || [];
  if (pr.includes('profile') || pr.includes('management')) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

const TWO_H_MS = 2 * 60 * 60 * 1000;
const MAX_SHIFT_MS = 12 * 60 * 60 * 1000;
const MAX_OT_MIN = 360;

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

async function findExpectedScheduleEntries(userId, tenantId) {
  const t = todayYmd();
  const y = yesterdayYmd();
  const r = await query(
    `SELECT e.id AS entry_id, e.work_date, e.shift_type, e.notes
     FROM work_schedule_entries e
     INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId AND s.user_id = @userId
     WHERE (e.work_date = @t OR (e.work_date = @y AND e.shift_type = N'night'))`,
    { userId, tenantId, t, y }
  );
  const rows = r.recordset || [];
  const early = isEarlyMorningInAppZone();
  return rows.filter((row) => {
    const ds = toYmdFromDbOrString(getRow(row, 'work_date'));
    const st = getRow(row, 'shift_type');
    if (early) {
      if (ds === t) return true;
      if (st === 'night' && ds === y) return true;
      return false;
    }
    return ds === t;
  });
}

async function getActiveSession(userId, tenantId) {
  const r = await query(
    `SELECT TOP 1 * FROM shift_clock_sessions
     WHERE tenant_id = @tenantId AND user_id = @userId AND status = N'active' AND clock_out_at IS NULL
     ORDER BY clock_in_at DESC`,
    { userId, tenantId }
  );
  return r.recordset?.[0] || null;
}

async function getBreaks(sessionId) {
  const r = await query(
    `SELECT * FROM shift_clock_breaks WHERE session_id = @sessionId ORDER BY started_at`,
    { sessionId }
  );
  return r.recordset || [];
}

async function lastResumeTime(session, breaks) {
  const cin = getRow(session, 'clock_in_at');
  let t = new Date(cin).getTime();
  for (const b of breaks) {
    const end = getRow(b, 'ended_at');
    if (end) t = Math.max(t, new Date(end).getTime());
  }
  return t;
}

async function breakOverlap(tenantId, excludeUserId, windowStart, windowEnd) {
  const r = await query(
    `SELECT b.started_at, b.ended_at, s.user_id, u.full_name AS user_name
     FROM shift_clock_breaks b
     INNER JOIN shift_clock_sessions s ON s.id = b.session_id AND s.tenant_id = @tenantId
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.user_id <> @excludeUserId AND s.clock_out_at IS NULL AND b.started_at IS NOT NULL`,
    { tenantId, excludeUserId }
  );
  const now = Date.now();
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  for (const row of r.recordset || []) {
    const a = new Date(getRow(row, 'started_at')).getTime();
    const e = getRow(row, 'ended_at') ? new Date(getRow(row, 'ended_at')).getTime() : now;
    if (ws < e && we > a) {
      return { conflict: true, user_name: getRow(row, 'user_name') || 'Colleague' };
    }
  }
  return { conflict: false };
}

const AUTH_CODE_ROUNDS = 8;

async function tryConsumeLocationAuthCode({ sessionId, userId, tenantId, actionType, plainCode }) {
  const code = String(plainCode || '').trim().replace(/\s/g, '');
  if (code.length < 4 || code.length > 12) return false;
  const r = await query(
    `SELECT id, code_hash, expires_at FROM shift_location_auth_requests
     WHERE session_id = @sid AND user_id = @uid AND tenant_id = @tid AND action_type = @at AND used_at IS NULL
     ORDER BY created_at DESC`,
    { sid: sessionId, uid: userId, tid: tenantId, at: actionType }
  );
  const now = Date.now();
  for (const row of r.recordset || []) {
    const exp = getRow(row, 'expires_at');
    if (exp && new Date(exp).getTime() < now) continue;
    const hash = getRow(row, 'code_hash');
    if (!hash) continue;
    try {
      if (await bcrypt.compare(code, hash)) {
        await query(`UPDATE shift_location_auth_requests SET used_at = SYSUTCDATETIME() WHERE id = @id`, {
          id: getRow(row, 'id'),
        });
        return true;
      }
    } catch (_) {}
  }
  return false;
}

/**
 * Enforces same work-site as clock-in (browser GPS only — no paid APIs).
 * Optional authorization_code from management email overrides one action after validation.
 */
async function assertShiftActionLocation(req, session, actionType) {
  const coords = parseClientCoords(req.body || {});
  if (!coords) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Current location (latitude and longitude) is required. Allow location in your browser for shift actions.',
        code: 'LOCATION_REQUIRED',
      },
    };
  }
  const alat = getRow(session, 'anchor_latitude');
  const alng = getRow(session, 'anchor_longitude');
  if (alat == null || alng == null) {
    return { ok: true };
  }
  const dist = haversineMeters(Number(alat), Number(alng), coords.lat, coords.lng);
  const slack = allowedLocationRadiusMeters(Number(getRow(session, 'anchor_accuracy_m')), coords.accuracy);
  if (dist <= slack) return { ok: true };

  const authRaw = (req.body && req.body.authorization_code) || '';
  if (authRaw && (await tryConsumeLocationAuthCode({
    sessionId: getRow(session, 'id'),
    userId: req.user.id,
    tenantId: req.user.tenant_id,
    actionType,
    plainCode: authRaw,
  }))) {
    return { ok: true };
  }
  if (authRaw) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Invalid or expired authorization code. Request a new code from management.',
        code: 'AUTH_CODE_INVALID',
      },
    };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: `Your position is about ${Math.round(dist)} m from your clock-in location (allowed radius about ${Math.round(slack)} m). Move to your work site, or request an authorization code from management with a motivation.`,
      code: 'LOCATION_MISMATCH',
      distanceMeters: Math.round(dist),
      allowedRadiusMeters: Math.round(slack),
    },
  };
}

router.use(requireAuth);
router.use(loadUser);

/** Command Centre gate: must clock in when a shift is expected today. */
router.get('/cc-access', async (req, res, next) => {
  try {
    if (req.user?.role === 'super_admin') {
      return res.json({ allowed: true, requiresClockIn: false, reason: 'super_admin' });
    }
    const tenantId = req.user?.tenant_id;
    const userId = req.user?.id;
    if (!tenantId || !userId) return res.json({ allowed: true, requiresClockIn: false, reason: 'no_tenant' });
    const expected = await findExpectedScheduleEntries(userId, tenantId);
    if (expected.length === 0) {
      return res.json({ allowed: true, requiresClockIn: false, reason: 'no_shift_today' });
    }
    const sess = await getActiveSession(userId, tenantId);
    if (sess) {
      return res.json({ allowed: true, requiresClockIn: false, sessionId: sess.id, clockedIn: true });
    }
    return res.json({
      allowed: false,
      requiresClockIn: true,
      reason: 'clock_in_required',
      message: 'Clock in for your scheduled shift on Profile → Work schedule before opening Command Centre.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/my-status', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const session = await getActiveSession(userId, tenantId);
    let breaks = [];
    if (session) breaks = await getBreaks(session.id);
    const entries = await findExpectedScheduleEntries(userId, tenantId);
    res.json({ session: session || null, breaks, expectedEntries: entries });
  } catch (err) {
    next(err);
  }
});

router.post('/session', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { schedule_entry_id, work_date } = req.body || {};
    if (!schedule_entry_id || !work_date) return res.status(400).json({ error: 'schedule_entry_id and work_date required' });
    const wd = String(work_date).slice(0, 10);
    const er = await query(
      `SELECT e.id, e.work_date, e.shift_type, s.user_id, s.tenant_id
       FROM work_schedule_entries e
       INNER JOIN work_schedules s ON s.id = e.work_schedule_id
       WHERE e.id = @eid AND s.tenant_id = @tenantId AND s.user_id = @userId`,
      { eid: schedule_entry_id, tenantId, userId }
    );
    const entry = er.recordset?.[0];
    if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
    const existing = await query(
      `SELECT id FROM shift_clock_sessions WHERE schedule_entry_id = @eid AND work_date = @wd`,
      { eid: schedule_entry_id, wd }
    );
    if (existing.recordset?.length) return res.status(400).json({ error: 'Already clocked in for this shift day' });
    const activeOther = await getActiveSession(userId, tenantId);
    if (activeOther) return res.status(400).json({ error: 'End your current shift before starting another' });

    const coords = parseClientCoords(req.body || {});
    if (!coords) {
      return res.status(400).json({
        error:
          'Clock-in requires your current GPS position (latitude and longitude). Allow location access and try again.',
        code: 'LOCATION_REQUIRED',
      });
    }

    const ins = await query(
      `INSERT INTO shift_clock_sessions (tenant_id, user_id, schedule_entry_id, work_date, shift_type, clock_in_at, status, anchor_latitude, anchor_longitude, anchor_accuracy_m)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @eid, @wd, @st, SYSUTCDATETIME(), N'active', @alat, @alng, @aacc)`,
      {
        tenantId,
        userId,
        eid: schedule_entry_id,
        wd,
        st: getRow(entry, 'shift_type') || 'day',
        alat: coords.lat,
        alng: coords.lng,
        aacc: coords.accuracy,
      }
    );
    res.status(201).json({ session: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/session/:id/clock-out', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    let { overtime_minutes = 0 } = req.body || {};
    overtime_minutes = Math.min(MAX_OT_MIN, Math.max(0, parseInt(overtime_minutes, 10) || 0));
    const sr = await query(
      `SELECT * FROM shift_clock_sessions WHERE id = @id AND tenant_id = @tenantId AND user_id = @userId AND status = N'active'`,
      { id, tenantId, userId }
    );
    const session = sr.recordset?.[0];
    if (!session) return res.status(404).json({ error: 'Active session not found' });
    const breaks = await getBreaks(id);
    const openBreak = breaks.find((b) => !getRow(b, 'ended_at'));
    if (openBreak) return res.status(400).json({ error: 'End your break before clocking out' });
    const loc = await assertShiftActionLocation(req, session, 'clock_out');
    if (!loc.ok) return res.status(loc.status).json(loc.body);
    await query(
      `UPDATE shift_clock_sessions SET clock_out_at = SYSUTCDATETIME(), overtime_minutes = @ot, status = N'completed', updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, ot: overtime_minutes }
    );
    const out = await query(`SELECT * FROM shift_clock_sessions WHERE id = @id`, { id });
    res.json({ session: out.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Void mistaken clock-in: removes active session (and breaks) so the user can clock in again. No location check. */
router.delete('/session/:id', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    const sr = await query(
      `SELECT id FROM shift_clock_sessions
       WHERE id = @id AND tenant_id = @tenantId AND user_id = @userId AND status = N'active' AND clock_out_at IS NULL`,
      { id, tenantId, userId }
    );
    if (!sr.recordset?.[0]) {
      return res.status(404).json({ error: 'No active duty to cancel. Clock out instead if your shift has ended.' });
    }
    await query(`DELETE FROM shift_clock_alert_sent WHERE session_id = @id`, { id });
    await query(
      `DELETE FROM shift_clock_alert_sent WHERE break_id IN (SELECT id FROM shift_clock_breaks WHERE session_id = @id)`,
      { id }
    );
    try {
      await query(`DELETE FROM shift_location_auth_requests WHERE session_id = @id`, { id });
    } catch (e) {
      const m = (e.message || '').toLowerCase();
      if (!m.includes('shift_location_auth') && !m.includes('invalid object')) throw e;
    }
    await query(`DELETE FROM shift_clock_breaks WHERE session_id = @id`, { id });
    await query(`DELETE FROM shift_clock_sessions WHERE id = @id`, { id });
    res.json({ ok: true, message: 'Clock-in cancelled. You can clock in again for this shift when ready.' });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/break/start', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    const { break_type } = req.body || {};
    if (break_type !== 'minor_30' && break_type !== 'major_60') {
      return res.status(400).json({ error: 'break_type must be minor_30 or major_60' });
    }
    const expected = break_type === 'minor_30' ? 30 : 60;
    const sr = await query(
      `SELECT * FROM shift_clock_sessions WHERE id = @id AND tenant_id = @tenantId AND user_id = @userId AND status = N'active'`,
      { id, tenantId, userId }
    );
    const session = sr.recordset?.[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const breaks = await getBreaks(id);
    const openBreak = breaks.find((b) => !getRow(b, 'ended_at'));
    if (openBreak) return res.status(400).json({ error: 'Already on a break — declare back first' });
    const lastT = await lastResumeTime(session, breaks);
    if (Date.now() - lastT < TWO_H_MS) {
      return res.status(400).json({ error: 'You must wait 2 hours after clock-in or after your last break before another break' });
    }
    const loc = await assertShiftActionLocation(req, session, 'break_start');
    if (!loc.ok) return res.status(loc.status).json(loc.body);
    const start = new Date();
    const end = new Date(start.getTime() + expected * 60 * 1000);
    const ov = await breakOverlap(tenantId, userId, start, end);
    if (ov.conflict) {
      return res.status(400).json({ error: `Another colleague is on break at this time (${ov.user_name}). Stagger breaks.` });
    }
    const ins = await query(
      `INSERT INTO shift_clock_breaks (session_id, break_type, expected_minutes, started_at)
       OUTPUT INSERTED.* VALUES (@sid, @bt, @em, SYSUTCDATETIME())`,
      { sid: id, bt: break_type, em: expected }
    );
    res.status(201).json({ break: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/break/:breakId/end', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { sessionId, breakId } = req.params;
    const sr = await query(
      `SELECT s.* FROM shift_clock_sessions s WHERE s.id = @sid AND s.tenant_id = @tenantId AND s.user_id = @userId`,
      { sid: sessionId, tenantId, userId }
    );
    const session = sr.recordset?.[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const br = await query(
      `SELECT * FROM shift_clock_breaks WHERE id = @bid AND session_id = @sid AND ended_at IS NULL`,
      { bid: breakId, sid: sessionId }
    );
    if (!br.recordset?.[0]) return res.status(404).json({ error: 'Open break not found' });
    const loc = await assertShiftActionLocation(req, session, 'break_end');
    if (!loc.ok) return res.status(loc.status).json(loc.body);
    await query(`UPDATE shift_clock_breaks SET ended_at = SYSUTCDATETIME() WHERE id = @bid`, { bid: breakId });
    const out = await query(`SELECT * FROM shift_clock_breaks WHERE id = @bid`, { bid: breakId });
    res.json({ break: out.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** Request one-time email code to management when GPS is away from clock-in anchor (cost: one email batch per request). */
router.post('/session/:id/location-auth-request', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    const { motivation, action_type } = req.body || {};
    const allowed = ['break_start', 'break_end', 'clock_out'];
    if (!allowed.includes(action_type)) {
      return res.status(400).json({ error: 'action_type must be break_start, break_end, or clock_out' });
    }
    const mot = String(motivation || '').trim();
    if (mot.length < 10) return res.status(400).json({ error: 'Enter a motivation (at least 10 characters).' });
    if (mot.length > 2000) return res.status(400).json({ error: 'Motivation is too long.' });

    const sr = await query(
      `SELECT * FROM shift_clock_sessions WHERE id = @id AND tenant_id = @tenantId AND user_id = @userId AND status = N'active' AND clock_out_at IS NULL`,
      { id, tenantId, userId }
    );
    const session = sr.recordset?.[0];
    if (!session) return res.status(404).json({ error: 'Active session not found' });

    const rate = await query(
      `SELECT COUNT(*) AS c FROM shift_location_auth_requests WHERE user_id = @uid AND created_at > DATEADD(HOUR, -1, SYSUTCDATETIME())`,
      { uid: userId }
    );
    const rowC = rate.recordset?.[0];
    const c = Number(rowC?.c ?? rowC?.C ?? 0);
    if (c >= 8) return res.status(429).json({ error: 'Too many authorization requests. Try again in a little while.' });

    await query(
      `DELETE FROM shift_location_auth_requests WHERE session_id = @sid AND action_type = @at AND used_at IS NULL`,
      { sid: id, at: action_type }
    );

    const plainCode = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(plainCode, AUTH_CODE_ROUNDS);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO shift_location_auth_requests (tenant_id, user_id, session_id, action_type, motivation, code_hash, expires_at)
       VALUES (@tid, @uid, @sid, @at, @mot, @hash, @exp)`,
      { tid: tenantId, uid: userId, sid: id, at: action_type, mot, hash: codeHash, exp: expiresAt }
    );

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured on the server. Management cannot receive codes yet.' });
    }
    const mgmt = await getManagementEmailsForTenant(query, tenantId);
    if (!mgmt.length) {
      return res.status(503).json({ error: 'No management contacts with the Management page role were found to receive the code.' });
    }
    const empName = (req.user.full_name || req.user.email || 'Employee').trim();
    const actionLabel =
      action_type === 'break_start' ? 'Start break' : action_type === 'break_end' ? 'Declare back from break' : 'Clock out';
    const html = shiftLocationAuthRequestHtml({
      employeeName: empName,
      motivation: mot,
      actionLabel,
      code: plainCode,
      expiresMinutes: 30,
    });
    for (const to of mgmt) {
      await sendEmail({
        to,
        subject: `Location override code for ${empName} (${actionLabel})`,
        html: true,
        body: html,
      });
    }
    res.json({ ok: true, message: 'Management has been emailed a one-time code (valid 30 minutes).' });
  } catch (err) {
    next(err);
  }
});

router.get('/my-history', requirePageAccess('profile'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { from, to } = req.query;
    let sql = `SELECT TOP 200 * FROM shift_clock_sessions WHERE tenant_id = @tenantId AND user_id = @userId`;
    const params = { tenantId, userId };
    if (from) {
      sql += ` AND work_date >= @from`;
      params.from = String(from).slice(0, 10);
    }
    if (to) {
      sql += ` AND work_date <= @to`;
      params.to = String(to).slice(0, 10);
    }
    sql += ` ORDER BY work_date DESC, clock_in_at DESC`;
    const r = await query(sql, params);
    res.json({ sessions: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Team schedules + clock status for a calendar day (tenant). Default: users with Command Centre page or CC tab grants. */
router.get('/team-day', requireProfileOrManagement, async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const viewerId = req.user.id;
    const date = String(req.query.date || todayYmd()).slice(0, 10);
    const scopeRaw = String(req.query.scope || 'command_centre').toLowerCase();
    const pageRoles = req.user?.page_roles || [];
    const isMgmt = req.user?.role === 'super_admin' || pageRoles.includes('management');
    let scope = scopeRaw === 'all' && isMgmt ? 'all' : 'command_centre';

    const tenantClause = `(u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))`;

    let usersR;
    if (scope === 'all') {
      usersR = await query(
        `SELECT u.id, u.full_name, u.email FROM users u
         WHERE ${tenantClause}
         AND u.email IS NOT NULL`,
        { tenantId }
      );
    } else {
      const ccSqlWithGrants = `
        SELECT DISTINCT u.id, u.full_name, u.email FROM users u
        WHERE ${tenantClause}
        AND u.email IS NOT NULL
        AND (
          u.id = @viewerId
          OR EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
          OR EXISTS (SELECT 1 FROM command_centre_grants g WHERE g.user_id = u.id)
        )`;
      try {
        usersR = await query(ccSqlWithGrants, { tenantId, viewerId });
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('command_centre_grants') || msg.includes('invalid object')) {
          usersR = await query(
            `SELECT DISTINCT u.id, u.full_name, u.email FROM users u
             WHERE ${tenantClause}
             AND u.email IS NOT NULL
             AND (
               u.id = @viewerId
               OR EXISTS (SELECT 1 FROM user_page_roles r WHERE r.user_id = u.id AND r.page_id = N'command_centre')
             )`,
            { tenantId, viewerId }
          );
        } else {
          throw e;
        }
      }
    }

    const users = usersR.recordset || [];
    const out = [];
    for (const u of users) {
      const uid = getRow(u, 'id');
      const er = await query(
        `SELECT e.id AS entry_id, e.work_date, e.shift_type, e.notes
         FROM work_schedule_entries e
         INNER JOIN work_schedules s ON s.id = e.work_schedule_id AND s.tenant_id = @tenantId AND s.user_id = @uid
         WHERE e.work_date = @date`,
        { tenantId, uid, date }
      );
      const entries = er.recordset || [];
      const sr = await query(
        `SELECT TOP 1 s.*, (SELECT COUNT(*) FROM shift_clock_breaks b WHERE b.session_id = s.id) AS break_count
         FROM shift_clock_sessions s WHERE s.tenant_id = @tenantId AND s.user_id = @uid AND s.work_date = @date
         ORDER BY s.clock_in_at DESC`,
        { tenantId, uid, date }
      );
      const session = sr.recordset?.[0] || null;
      let breaks = [];
      if (session) {
        const sid = getRow(session, 'id');
        if (sid) breaks = await getBreaks(sid);
      }
      out.push({
        user: { id: uid, full_name: getRow(u, 'full_name'), email: getRow(u, 'email') },
        entries,
        session,
        breaks,
      });
    }
    out.sort((a, b) =>
      String(a.user?.full_name || a.user?.email || '').localeCompare(String(b.user?.full_name || b.user?.email || ''), undefined, {
        sensitivity: 'base',
      })
    );
    res.json({ date, team: out, scope });
  } catch (err) {
    next(err);
  }
});

router.get('/management/sessions', requirePageAccess('management'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { from, to } = req.query;
    let sql = `SELECT TOP 500 s.*, u.full_name AS user_name, u.email AS user_email
     FROM shift_clock_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.tenant_id = @tenantId`;
    const params = { tenantId };
    if (from) {
      sql += ` AND s.work_date >= @from`;
      params.from = String(from).slice(0, 10);
    }
    if (to) {
      sql += ` AND s.work_date <= @to`;
      params.to = String(to).slice(0, 10);
    }
    sql += ` ORDER BY s.work_date DESC, s.clock_in_at DESC`;
    const r = await query(sql, params);
    res.json({ sessions: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

export async function runShiftClockAlerts() {
  if (!isEmailConfigured()) return;
  try {
    const r = await query(
      `SELECT s.*, u.full_name, u.email
       FROM shift_clock_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.status = N'active' AND s.clock_out_at IS NULL
         AND LOWER(LTRIM(RTRIM(ISNULL(u.role, N'')))) NOT IN (N'super_admin', N'tenant_admin')`
    );
    const sessions = r.recordset || [];
    const mgmtCache = new Map();
    for (const s of sessions) {
      const tenantId = getRow(s, 'tenant_id');
      const sid = getRow(s, 'id');
      const clockIn = new Date(getRow(s, 'clock_in_at')).getTime();
      if (Date.now() - clockIn > MAX_SHIFT_MS) {
        const key = `shift_12h_${sid}`;
        const ex = await query(`SELECT id FROM shift_clock_alert_sent WHERE session_id = @sid AND alert_type = @at`, {
          sid,
          at: key,
        });
        if (ex.recordset?.length) continue;
        const userEmail = (getRow(s, 'email') || '').trim();
        const name = getRow(s, 'full_name') || 'User';
        let mgmt = mgmtCache.get(tenantId);
        if (!mgmt) {
          mgmt = await getManagementEmailsForTenant(query, tenantId);
          mgmtCache.set(tenantId, mgmt);
        }
        const html = shiftClockAlertHtml({
          title: 'Shift duration exceeds 12 hours',
          body: `${name} has been clocked in for more than 12 hours without clock-out. Please ensure they clock out and record overtime (max 6 hours).`,
        });
        const toList = [userEmail, ...mgmt].filter(Boolean);
        const uniq = [...new Set(toList)];
        for (const to of uniq) {
          await sendEmail({ to, subject: 'Shift clock: 12-hour threshold', html: true, body: html });
        }
        await query(`INSERT INTO shift_clock_alert_sent (tenant_id, session_id, alert_type) VALUES (@tid, @sid, @at)`, {
          tid: tenantId,
          sid,
          at: key,
        });
      }
    }
    const br = await query(
      `SELECT b.*, s.user_id, s.tenant_id, u.full_name, u.email
       FROM shift_clock_breaks b
       INNER JOIN shift_clock_sessions s ON s.id = b.session_id
       INNER JOIN users u ON u.id = s.user_id
       WHERE b.ended_at IS NULL AND b.started_at IS NOT NULL
         AND LOWER(LTRIM(RTRIM(ISNULL(u.role, N'')))) NOT IN (N'super_admin', N'tenant_admin')`
    );
    for (const b of br.recordset || []) {
      const started = new Date(getRow(b, 'started_at')).getTime();
      const expMin = getRow(b, 'expected_minutes') || 30;
      const limitMs = expMin * 60 * 1000 + 60 * 1000;
      if (Date.now() - started <= limitMs) continue;
      const bid = getRow(b, 'id');
      const sid = getRow(b, 'session_id');
      const tenantId = getRow(b, 'tenant_id');
      const at = `break_over_${bid}`;
      const ex = await query(`SELECT id FROM shift_clock_alert_sent WHERE session_id = @sid AND alert_type = @at`, { sid, at });
      if (ex.recordset?.length) continue;
      const name = getRow(b, 'full_name') || 'User';
      const userEmail = (getRow(b, 'email') || '').trim();
      let mgmt = mgmtCache.get(tenantId);
      if (!mgmt) {
        mgmt = await getManagementEmailsForTenant(query, tenantId);
        mgmtCache.set(tenantId, mgmt);
      }
      const html = shiftClockAlertHtml({
        title: 'Break time exceeded',
        body: `${name} has exceeded the allowed ${expMin} minute break. They should declare back from break or adjust in the shift clock.`,
      });
      const uniq = [...new Set([userEmail, ...mgmt].filter(Boolean))];
      for (const to of uniq) {
        await sendEmail({ to, subject: 'Shift clock: break threshold', html: true, body: html });
      }
      await query(`INSERT INTO shift_clock_alert_sent (tenant_id, session_id, break_id, alert_type) VALUES (@tid, @sid, @bid, @at)`, {
        tid: tenantId,
        sid,
        bid,
        at,
      });
    }
  } catch (e) {
    console.warn('[shiftClock] runShiftClockAlerts:', e?.message || e);
  }
}

export default router;
