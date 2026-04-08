import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { query } from '../db.js';
import { hasRequiredPageAssignments } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { passwordResetHtml } from '../lib/emailTemplates.js';
import { parseClientCoords } from '../lib/geo.js';
import { getClientIp } from '../lib/clientIp.js';
import { insertUserLoginActivity } from '../lib/userLoginActivity.js';

const router = Router();
const SALT_ROUNDS = 10;
const RESET_EXPIRY_HOURS = 1;
const CODE_LENGTH = 6;
const MAX_LOGIN_FAILED_ATTEMPTS = 3;

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const loc = parseClientCoords(req.body || {});
    if (!loc) {
      return res.status(400).json({
        error:
          'Location is required to sign in. Allow location access in your browser and try again. Coordinates are stored with your account audit trail only.',
        code: 'LOCATION_REQUIRED',
      });
    }
    let result;
    try {
      result = await query(
        `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.full_name, u.role, u.status,
                u.login_failed_attempts, u.login_locked_at,
                t.name AS tenant_name, t.[plan] AS tenant_plan
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE u.email = @email`,
        { email: email.trim().toLowerCase() }
      );
    } catch (dbErr) {
      console.error('Login: database error', dbErr.message || dbErr);
      const msg = (dbErr.message || '').toLowerCase();
      if (msg.includes('invalid object name') || msg.includes('does not exist')) {
        return res.status(503).json({
          error: 'Database not set up. Run: npm run db:schema && npm run seed',
        });
      }
      throw dbErr;
    }
    let user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    const lockedAt = user.login_locked_at ?? user.login_Locked_At;
    if (lockedAt) {
      return res.status(403).json({
        error:
          'This account is locked after too many failed sign-in attempts. A super administrator must unlock it under User management → Block requests.',
        code: 'account_locked',
      });
    }
    let tenant_ids = [];
    try {
      const ut = await query(`SELECT tenant_id FROM user_tenants WHERE user_id = @id`, { id: user.id });
      tenant_ids = (ut.recordset || []).map((r) => r.tenant_id ?? r.tenant_Id).filter(Boolean);
    } catch (_) {}
    if (tenant_ids.length === 0 && user.tenant_id) tenant_ids = [user.tenant_id];
    const hash = user.password_hash;
    if (!hash || typeof hash !== 'string') {
      console.error('Login: invalid password_hash for user', user.id);
      return res.status(500).json({ error: 'Account configuration error. Contact support.' });
    }
    let match = false;
    try {
      match = await bcrypt.compare(password, hash);
    } catch (bcryptErr) {
      console.error('Login: bcrypt compare failed', bcryptErr);
      return res.status(500).json({ error: 'Account configuration error. Contact support.' });
    }
    if (!match) {
      try {
        const failUpd = await query(
          `UPDATE users SET
             login_failed_attempts = login_failed_attempts + 1,
             login_locked_at = CASE WHEN login_failed_attempts + 1 >= @maxFail THEN SYSUTCDATETIME() ELSE login_locked_at END,
             updated_at = SYSUTCDATETIME()
           OUTPUT INSERTED.login_failed_attempts AS attempts, INSERTED.login_locked_at AS locked_at
           WHERE id = @id`,
          { id: user.id, maxFail: MAX_LOGIN_FAILED_ATTEMPTS }
        );
        const fr = failUpd.recordset?.[0];
        const nowLocked = fr?.locked_at ?? fr?.Locked_At;
        if (nowLocked) {
          await auditLog({
            tenantId: user.tenant_id,
            userId: user.id,
            action: 'login.locked',
            entityType: 'user',
            entityId: user.id,
            details: { reason: 'max_failed_password_attempts', attempts: fr?.attempts ?? fr?.Attempts },
            ip: req.ip || req.connection?.remoteAddress,
          });
          return res.status(403).json({
            error:
              'Too many failed sign-in attempts. This account is now locked. A super administrator can unlock it under User management → Block requests.',
            code: 'account_locked',
          });
        }
      } catch (failErr) {
        console.error('Login: failed-attempt update error', failErr?.message || failErr);
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    let page_roles = [];
    try {
      const pr = await query(`SELECT page_id FROM user_page_roles WHERE user_id = @id`, { id: user.id });
      page_roles = (pr.recordset || []).map((r) => r.page_id ?? r.page_Id).filter(Boolean);
    } catch (_) {}
    if (user.role === 'super_admin') {
      const { PAGE_IDS } = await import('./users.js');
      page_roles = PAGE_IDS.slice();
    }
    const sessionTenantId = user.tenant_id || tenant_ids[0] || null;
    let tenantPlanForAccess = user.tenant_plan;
    if (sessionTenantId && String(sessionTenantId) !== String(user.tenant_id ?? '')) {
      try {
        const tp = await query(`SELECT [plan] AS p FROM tenants WHERE id = @id`, { id: sessionTenantId });
        const row = tp.recordset?.[0];
        tenantPlanForAccess = row?.p ?? row?.P ?? tenantPlanForAccess;
      } catch (_) {}
    }
    if (
      !hasRequiredPageAssignments({
        role: user.role,
        tenant_plan: tenantPlanForAccess,
        page_roles,
      })
    ) {
      return res.status(403).json({
        error:
          'No page access has been assigned to this account. You cannot sign in until an administrator assigns at least one page.',
      });
    }
    try {
      await query(
        `UPDATE users SET login_failed_attempts = 0, login_locked_at = NULL, last_login_at = SYSUTCDATETIME(), login_count = login_count + 1, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: user.id }
      );
    } catch (updateErr) {
      console.error('Login: update last_login failed', updateErr);
      // continue anyway; login can succeed
    }
    req.session.userId = user.id;
    req.session.tenantId = sessionTenantId;
    try {
      await auditLog({
        tenantId: req.session.tenantId,
        userId: user.id,
        action: 'login',
        entityType: 'user',
        entityId: user.id,
        ip: getClientIp(req),
      });
    } catch (auditErr) {
      console.error('Login: audit log failed', auditErr);
    }
    try {
      const tid = sessionTenantId || user.tenant_id;
      if (tid) {
        await insertUserLoginActivity(query, {
          tenantId: tid,
          userId: user.id,
          ip: getClientIp(req),
          latitude: loc.lat,
          longitude: loc.lng,
          accuracyMeters: loc.accuracy,
          userAgent: req.headers['user-agent'],
          source: 'login',
        });
      }
    } catch (logErr) {
      console.error('Login: user_login_activity insert failed', logErr?.message || logErr);
    }
    res.json({
      user: {
        id: user.id,
        tenant_id: req.session.tenantId,
        tenant_ids: tenant_ids,
        tenant_name: user.tenant_name,
        tenant_plan: tenantPlanForAccess,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        page_roles,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

/** Switch current tenant (user must belong to that tenant). */
router.post('/switch-tenant', async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { tenant_id } = req.body || {};
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id required' });
    const check = await query(
      `SELECT 1 FROM user_tenants WHERE user_id = @userId AND tenant_id = @tenantId`,
      { userId: req.session.userId, tenantId: tenant_id }
    );
    if (!check.recordset?.length) {
      const primary = await query(`SELECT tenant_id FROM users WHERE id = @id`, { id: req.session.userId });
      const primaryId = primary.recordset?.[0]?.tenant_id;
      if (primaryId !== tenant_id) return res.status(403).json({ error: 'You do not have access to this tenant' });
    }
    req.session.tenantId = tenant_id;
    const trow = await query(`SELECT name, [plan] FROM tenants WHERE id = @id`, { id: tenant_id });
    const tenantName = trow.recordset?.[0]?.name ?? null;
    const tenantPlan = trow.recordset?.[0]?.plan ?? null;
    res.json({ ok: true, tenant_id, tenant_name: tenantName, tenant_plan: tenantPlan });
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(200).json({ user: null });
  }
  try {
    const result = await query(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.status, u.avatar_url, u.last_login_at, u.login_count, u.created_at, u.login_locked_at,
              t.name AS tenant_name, t.[plan] AS tenant_plan
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = @id`,
      { id: req.session.userId }
    );
    const row = result.recordset[0];
    if (!row) return res.status(401).json({ error: 'User not found' });
    const get = (r, k) => { if (!r) return undefined; const l = k.toLowerCase(); const e = Object.entries(r).find(([key]) => key && String(key).toLowerCase() === l); return e ? e[1] : undefined; };
    if (get(row, 'login_locked_at')) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
      return res.status(200).json({ user: null });
    }
    const role = get(row, 'role');
    let page_roles = [];
    try {
      const pr = await query(`SELECT page_id FROM user_page_roles WHERE user_id = @id`, { id: req.session.userId });
      page_roles = (pr.recordset || []).map((r) => r.page_id ?? r.page_Id).filter(Boolean);
    } catch (_) {
      // table may not exist yet
    }
    if (role === 'super_admin') {
      const { PAGE_IDS } = await import('./users.js');
      page_roles = PAGE_IDS.slice();
    }
    let tenant_ids = [];
    try {
      const ut = await query(`SELECT tenant_id FROM user_tenants WHERE user_id = @id`, { id: req.session.userId });
      tenant_ids = (ut.recordset || []).map((r) => r.tenant_id ?? r.tenant_Id).filter(Boolean);
    } catch (_) {}
    if (tenant_ids.length === 0 && get(row, 'tenant_id')) tenant_ids = [get(row, 'tenant_id')];
    const primaryTenantId = get(row, 'tenant_id');
    const currentTenantId = req.session.tenantId && tenant_ids.includes(req.session.tenantId) ? req.session.tenantId : (primaryTenantId || tenant_ids[0] || null);
    let tenantName = get(row, 'tenant_name');
    let tenantPlan = get(row, 'tenant_plan');
    if (currentTenantId && currentTenantId !== primaryTenantId) {
      try {
        const trow = await query(`SELECT name, [plan] FROM tenants WHERE id = @id`, { id: currentTenantId });
        if (trow.recordset?.[0]) {
          tenantName = trow.recordset[0].name ?? trow.recordset[0].name;
          tenantPlan = trow.recordset[0].plan ?? trow.recordset[0].plan;
        }
      } catch (_) {}
    }
    if (!hasRequiredPageAssignments({ role, tenant_plan: tenantPlan, page_roles })) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
      return res.status(200).json({ user: null });
    }
    res.json({
      user: {
        id: get(row, 'id'),
        tenant_id: currentTenantId,
        tenant_ids,
        tenant_name: tenantName,
        tenant_plan: tenantPlan,
        email: get(row, 'email'),
        full_name: get(row, 'full_name'),
        role,
        status: get(row, 'status'),
        avatar_url: get(row, 'avatar_url'),
        last_login_at: get(row, 'last_login_at'),
        login_count: get(row, 'login_count'),
        created_at: get(row, 'created_at'),
        page_roles,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/sign-up: submit sign-up request (full_name, id_number, email, cellphone). No auth. */
router.post('/sign-up', async (req, res, next) => {
  try {
    const { full_name, id_number, email, cellphone } = req.body || {};
    const emailStr = (email && String(email).trim()) || '';
    if (!emailStr || !emailStr.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    const fullNameStr = (full_name != null && String(full_name).trim()) || '';
    if (!fullNameStr) return res.status(400).json({ error: 'Full name is required' });

    const emailLower = emailStr.toLowerCase();
    const existingUser = await query(
      `SELECT id FROM users WHERE email = @email`,
      { email: emailLower }
    );
    if (existingUser.recordset?.length) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const existingPending = await query(
      `SELECT id FROM sign_up_requests WHERE email = @email AND [status] = N'pending'`,
      { email: emailLower }
    );
    if (existingPending.recordset?.length) {
      return res.status(409).json({ error: 'A sign-up request with this email is already pending' });
    }

    const idNumberVal = id_number != null && String(id_number).trim() ? String(id_number).trim() : null;
    const cellphoneVal = cellphone != null && String(cellphone).trim() ? String(cellphone).trim() : null;
    await query(
      `INSERT INTO sign_up_requests (email, full_name, id_number, cellphone, [status])
       VALUES (@email, @fullName, @idNumber, @cellphone, N'pending')`,
      { email: emailLower, fullName: fullNameStr, idNumber: idNumberVal, cellphone: cellphoneVal }
    );
    res.status(201).json({ ok: true, message: 'Your request has been submitted for approval. You will receive an email once approved.' });
  } catch (err) {
    next(err);
  }
});

/** Normalize SA ID for comparison: strip spaces and dashes, lowercase */
function normalizeIdNumber(s) {
  return (s || '').trim().replace(/[\s-]/g, '').toLowerCase();
}

/** POST /auth/forgot-password: email, id_number (SA ID). If user exists and id_number matches, create reset token and send email. */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email, id_number } = req.body || {};
    const emailStr = (email && String(email).trim()) || '';
    if (!emailStr || !emailStr.includes('@')) {
      return res.status(400).json({ error: 'Valid email (username) is required' });
    }
    const idNumberStr = (id_number != null && String(id_number).trim()) || '';
    if (!idNumberStr) {
      return res.status(400).json({ error: 'SA ID number is required' });
    }

    let result;
    try {
      result = await query(
        `SELECT id, email, full_name, id_number FROM users WHERE email = @email AND [status] = N'active'`,
        { email: emailStr.toLowerCase() }
      );
    } catch (e) {
      if (e.message && e.message.includes('id_number')) {
        return res.status(503).json({ error: 'Password reset is not configured. Contact support.' });
      }
      throw e;
    }
    const user = result.recordset?.[0];
    if (!user) {
      return res.json({ ok: true, message: 'If an account exists with this email, you will receive reset instructions.' });
    }

    const dbIdNumber = normalizeIdNumber(user.id_number);
    const reqIdNumber = normalizeIdNumber(idNumberStr);
    if (dbIdNumber && reqIdNumber && dbIdNumber !== reqIdNumber) {
      return res.json({ ok: true, message: 'If an account exists with this email, you will receive reset instructions.' });
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Contact support to reset your password.' });
    }

    const token = randomBytes(32).toString('hex');
    const code = String(Math.floor(100000 + Math.random() * 900000)).slice(0, CODE_LENGTH);
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);

    await query(
      `DELETE FROM password_reset_tokens WHERE user_id = @userId`,
      { userId: user.id }
    );
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, code, expires_at) VALUES (@userId, @token, @code, @expiresAt)`,
      { userId: user.id, token, code, expiresAt: expiresAt.toISOString() }
    );

    // Use FRONTEND_ORIGIN / APP_URL so reset link points to your deployed app, not localhost
    let appUrl = (process.env.FRONTEND_ORIGIN || process.env.APP_URL || '').trim().replace(/\/$/, '');
    if (!appUrl) {
      const raw = req.get('origin') || req.get('referer') || '';
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
          const u = new URL(raw);
          appUrl = `${u.protocol}//${u.host}`;
        } catch (_) {}
      }
    }
    if (!appUrl) appUrl = 'http://localhost:5173';
    const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const html = passwordResetHtml({ resetLink, code, appUrl });

    let emailResult;
    try {
      emailResult = await sendEmail({
        to: user.email,
        subject: 'Reset your password – Thinkers',
        body: html,
        html: true,
      });
    } catch (emailErr) {
      console.error('[auth] Forgot password: failed to send email to', user.email, emailErr?.message || emailErr);
      return res.status(503).json({ error: 'Unable to send reset email. Please try again later or contact support.' });
    }
    if (emailResult == null && isEmailConfigured()) {
      console.error('[auth] Forgot password: sendEmail returned null (skipped) for', user.email);
      return res.status(503).json({ error: 'Unable to send reset email. Please try again later or contact support.' });
    }

    res.json({ ok: true, message: 'If an account exists with this email, you will receive reset instructions.' });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/reset-password: token, code, new_password, confirm_password. Validates token/code and updates password. */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, code, new_password, confirm_password } = req.body || {};
    const tokenStr = (token && String(token).trim()) || '';
    const codeStr = (code && String(code).trim()) || '';
    if (!tokenStr || !codeStr) {
      return res.status(400).json({ error: 'Token and code are required' });
    }
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const row = await query(
      `SELECT id, user_id, code, expires_at FROM password_reset_tokens WHERE token = @token`,
      { token: tokenStr }
    );
    const reset = row.recordset?.[0];
    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Request a new one from the forgot password page.' });
    }
    const userId = reset.user_id ?? reset.user_Id;
    const expiresAt = reset.expires_at;
    if (new Date(expiresAt) < new Date()) {
      await query(`DELETE FROM password_reset_tokens WHERE id = @id`, { id: reset.id });
      return res.status(400).json({ error: 'This reset link has expired. Request a new one from the forgot password page.' });
    }
    const storedCode = (reset.code || '').trim();
    if (storedCode !== codeStr) {
      return res.status(400).json({ error: 'Invalid code. Check the code in your email and try again.' });
    }

    const passwordHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await query(
      `UPDATE users SET password_hash = @passwordHash, login_failed_attempts = 0, login_locked_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: userId, passwordHash }
    );
    await query(`DELETE FROM password_reset_tokens WHERE user_id = @userId`, { userId });

    res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
  } catch (err) {
    next(err);
  }
});

export default router;
