import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess, requireSuperAdmin } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { isWithinLibraryAccessWindow, parsePolicyRow } from '../lib/companyLibraryAccess.js';
import { extractTextSample, summarizeForLibrary, matchDocumentsByIntent } from '../lib/companyLibraryAi.js';
import {
  companyLibraryAttachmentEmailedHtml,
  companyLibraryExpiryReminderHtml,
  companyLibrarySuperAdminDeleteCodeHtml,
  companyLibrarySystemPinToSuperAdminHtml,
  companyLibrarySystemPinToUploaderHtml,
} from '../lib/emailTemplates.js';

const router = Router();
const uploadsLib = path.join(process.cwd(), 'uploads', 'company-library');
const BCRYPT_ROUNDS = 10;
const PIN_CHALLENGE_TTL_MS = 30 * 60 * 1000;
const ATTACH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_OTP_TTL_MS = 15 * 60 * 1000;

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;
}

function getDeleteAuthorizationPin() {
  return String(process.env.COMPANY_LIBRARY_DELETE_AUTHORIZATION_PIN || '').trim();
}

async function verifyDeleteAuthorization(req, documentId, submittedCode) {
  const code = String(submittedCode ?? '').trim();
  if (!code) return { ok: false, reason: 'missing' };

  const r = await query(
    `SELECT TOP 1 * FROM company_library_delete_otp
     WHERE tenant_id = @t AND user_id = @uid AND document_id = @did
       AND consumed_at IS NULL AND expires_at > SYSUTCDATETIME()
     ORDER BY created_at DESC`,
    { t: req.user.tenant_id, uid: req.user.id, did: documentId }
  );
  const row = r.recordset?.[0];
  if (row) {
    const match = await bcrypt.compare(code, String(getRow(row, 'code_hash') || ''));
    if (match) return { ok: true, otpId: getRow(row, 'id') };
  }

  const expected = getDeleteAuthorizationPin();
  if (expected) {
    const a = code;
    if (a.length === expected.length) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(expected, 'utf8')))
          return { ok: true, otpId: null };
      } catch {
        /* length mismatch in timingSafeEqual */
      }
    }
  }

  return { ok: false, reason: 'invalid' };
}

/** SQL filter: library access audit (email delivery, PIN flow, legacy HTTP attempts, deletes). */
const AUDIT_DOWNLOADS_ONLY_SQL = `(
  a.action IN (
    N'download', N'download_super_admin', N'download_denied_no_grant', N'download_denied_http_disabled',
    N'download_invalid_grant', N'document_delete',
    N'library_pin_issued_uploader', N'library_pin_issued_super_admin', N'library_pin_verify_fail', N'library_pin_verified',
    N'library_email_attachment_unsecured', N'library_email_attachment_secured', N'library_email_attachment_denied'
  )
)`;

async function audit(req, { documentId, action, detail }) {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return;
  try {
    await query(
      `INSERT INTO company_library_audit (tenant_id, user_id, document_id, action, detail, ip_address, user_agent)
       VALUES (@tenantId, @userId, @documentId, @action, @detail, @ip, @ua)`,
      {
        tenantId,
        userId: req.user?.id || null,
        documentId: documentId || null,
        action: String(action).slice(0, 64),
        detail: detail != null ? String(detail).slice(0, 4000) : null,
        ip: clientIp(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 512),
      }
    );
  } catch (e) {
    console.error('[company-library] audit failed', e?.message);
  }
}

async function ensurePolicy(tenantId) {
  await query(
    `IF NOT EXISTS (SELECT 1 FROM company_library_policy WHERE tenant_id = @t)
     INSERT INTO company_library_policy (tenant_id) VALUES (@t)`,
    { t: tenantId }
  );
  const r = await query(`SELECT * FROM company_library_policy WHERE tenant_id = @t`, { t: tenantId });
  return r.recordset?.[0] || null;
}

async function libraryTimeAllowed(req) {
  if (req.user?.role === 'super_admin') return true;
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return false;
  const row = await ensurePolicy(tenantId);
  const { ok } = isWithinLibraryAccessWindow(parsePolicyRow(row));
  return ok;
}

/**
 * Resolve on-disk path for a library file.
 * `stored_rel_path` is either `tenantId/file.ext` (legacy) or `file.ext` only (new uploads) — both relative to `uploads/company-library`.
 * Never join tenant twice (that produced .../tenant/tenant/file and broke downloads).
 */
function safeResolveStoredPath(tenantId, rel) {
  const root = path.resolve(uploadsLib);
  const relNorm = String(rel || '').replace(/\\/g, '/').replace(/^[/\\]+/, '');
  if (!relNorm) throw new Error('Invalid storage path');
  const tenantSeg = String(tenantId || '').trim();

  const absFromRoot = path.resolve(root, relNorm);
  if (!(absFromRoot.startsWith(root + path.sep) || absFromRoot === root)) {
    throw new Error('Invalid storage path');
  }

  if (tenantSeg) {
    const tenantRoot = path.resolve(root, tenantSeg);
    if (absFromRoot === tenantRoot || absFromRoot.startsWith(tenantRoot + path.sep)) {
      return absFromRoot;
    }
    const underTenant = path.resolve(tenantRoot, relNorm);
    if (underTenant === tenantRoot || underTenant.startsWith(tenantRoot + path.sep)) {
      return underTenant;
    }
    throw new Error('Invalid storage path');
  }

  return absFromRoot;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const dir = path.join(uploadsLib, tenantId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${crypto.randomUUID()}-${safe}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
}).single('file');

router.use(requireAuth, loadUser);

router.get('/me/access', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const row = await ensurePolicy(tenantId);
    const policy = parsePolicyRow(row);
    const { ok, reason } = isWithinLibraryAccessWindow(policy);
    const superAdmin = req.user.role === 'super_admin';
    res.json({
      allowed_now: superAdmin || ok,
      message: superAdmin ? null : reason,
      restricted: !!policy?.access_restricted,
      super_admin_bypass: superAdmin,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/policy', requireSuperAdmin, async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id || req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required (query for platform admin)' });
    const row = await ensurePolicy(tenantId);
    res.json({ policy: parsePolicyRow(row) });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/policy', requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      tenant_id: tenantIdRaw,
      access_restricted,
      access_timezone,
      access_weekdays,
      access_start_minutes,
      access_end_minutes,
    } = req.body || {};
    const tenantId = tenantIdRaw || req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required' });
    await ensurePolicy(tenantId);
    const pr = await query(`SELECT * FROM company_library_policy WHERE tenant_id = @tid`, { tid: tenantId });
    const cur = pr.recordset?.[0] || {};
    const ar =
      access_restricted !== undefined ? (access_restricted ? 1 : 0) : getRow(cur, 'access_restricted') ? 1 : 0;
    const tz =
      access_timezone != null
        ? String(access_timezone).slice(0, 64)
        : String(getRow(cur, 'access_timezone') || 'Africa/Johannesburg').slice(0, 64);
    const wd =
      access_weekdays !== undefined
        ? access_weekdays != null
          ? String(access_weekdays).slice(0, 32)
          : null
        : getRow(cur, 'access_weekdays');
    const sm =
      access_start_minutes !== undefined
        ? access_start_minutes != null
          ? parseInt(access_start_minutes, 10)
          : null
        : getRow(cur, 'access_start_minutes');
    const em =
      access_end_minutes !== undefined
        ? access_end_minutes != null
          ? parseInt(access_end_minutes, 10)
          : null
        : getRow(cur, 'access_end_minutes');
    await query(
      `UPDATE company_library_policy SET
        access_restricted = @ar,
        access_timezone = @tz,
        access_weekdays = @wd,
        access_start_minutes = @sm,
        access_end_minutes = @em,
        updated_at = SYSUTCDATETIME(),
        updated_by = @uid
       WHERE tenant_id = @tid`,
      { tid: tenantId, ar, tz, wd, sm, em, uid: req.user.id }
    );
    const r = await query(`SELECT * FROM company_library_policy WHERE tenant_id = @t`, { t: tenantId });
    res.json({ policy: parsePolicyRow(r.recordset?.[0]) });
  } catch (err) {
    next(err);
  }
});

/** Email a one-time delete authorization code to the signed-in super admin. */
router.post('/admin/request-document-delete-code', requireSuperAdmin, requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({
        error:
          'Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS to receive delete codes, or use COMPANY_LIBRARY_DELETE_AUTHORIZATION_PIN as a fallback.',
      });
    }
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const email = req.user.email;
    if (!email) return res.status(400).json({ error: 'Your account has no email address.' });
    const { document_id: docId } = req.body || {};
    if (!docId) return res.status(400).json({ error: 'document_id required' });

    const dq = await query(
      `SELECT display_title FROM company_library_documents WHERE id = @id AND tenant_id = @t`,
      { id: docId, t: tenantId }
    );
    const doc = dq.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await query(
      `UPDATE company_library_delete_otp SET consumed_at = SYSUTCDATETIME()
       WHERE tenant_id = @t AND user_id = @uid AND document_id = @did AND consumed_at IS NULL`,
      { t: tenantId, uid: req.user.id, did: docId }
    );

    const plain = String(crypto.randomInt(10_000_000, 99_999_999));
    const codeHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
    const exp = new Date(Date.now() + DELETE_OTP_TTL_MS);
    const ins = await query(
      `INSERT INTO company_library_delete_otp (tenant_id, user_id, document_id, code_hash, expires_at)
       OUTPUT INSERTED.id
       VALUES (@t, @uid, @did, @h, @exp)`,
      { t: tenantId, uid: req.user.id, did: docId, h: codeHash, exp }
    );
    const otpRow = ins.recordset?.[0];
    const otpId = otpRow && getRow(otpRow, 'id');

    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || '';
    const title = getRow(doc, 'display_title') || '—';
    const html = companyLibrarySuperAdminDeleteCodeHtml({
      adminName: req.user.full_name,
      documentTitle: title,
      code: plain,
      expiresMinutes: Math.round(DELETE_OTP_TTL_MS / 60000),
      appUrl: appUrl ? `${appUrl.replace(/\/$/, '')}/company-library` : '',
    });
    try {
      await sendEmail({
        to: email,
        subject: `Company library: delete authorization for “${title}”`,
        body: html,
        html: true,
      });
    } catch (e) {
      console.error('[company-library] delete OTP email', e?.message);
      if (otpId) await query(`DELETE FROM company_library_delete_otp WHERE id = @id`, { id: otpId }).catch(() => {});
      return res.status(502).json({
        error: 'Could not send the authorization email. Check EMAIL_USER, EMAIL_PASS, and SMTP settings on the server.',
      });
    }

    res.json({
      ok: true,
      message: `A delete authorization code was sent to ${email}. It expires in about ${Math.round(DELETE_OTP_TTL_MS / 60000)} minutes.`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/folders', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT id, parent_folder_id, name, created_at FROM company_library_folders WHERE tenant_id = @t ORDER BY name`,
      { t: tenantId }
    );
    res.json({ folders: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/folders', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const tenantId = req.user.tenant_id;
    const { name, parent_folder_id } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const ins = await query(
      `INSERT INTO company_library_folders (tenant_id, parent_folder_id, name, created_by)
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.parent_folder_id, INSERTED.created_at
       VALUES (@t, @parent, @name, @uid)`,
      {
        t: tenantId,
        parent: parent_folder_id || null,
        name: String(name).trim().slice(0, 255),
        uid: req.user.id,
      }
    );
    const row = ins.recordset[0];
    res.status(201).json({ folder: row });
  } catch (err) {
    next(err);
  }
});

router.get('/documents', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const tenantId = req.user.tenant_id;
    const q = (req.query.q && String(req.query.q).trim()) || '';
    const folderId = req.query.folder_id || null;
    let sqlText = `SELECT d.id, d.folder_id, d.display_title, d.file_name, d.mime_type, d.size_bytes, d.created_at,
      d.ai_summary, d.ai_status, d.is_pin_protected, d.expires_at, d.uploaded_by,
      u.full_name AS uploader_name
      FROM company_library_documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.tenant_id = @t`;
    const params = { t: tenantId };
    if (folderId) {
      sqlText += ' AND d.folder_id = @fid';
      params.fid = folderId;
    }
    if (q) {
      sqlText += ` AND (
        d.display_title LIKE @like OR d.file_name LIKE @like OR d.ai_summary LIKE @like
      )`;
      params.like = `%${q.replace(/[%_]/g, '').slice(0, 200)}%`;
    }
    sqlText += ' ORDER BY d.display_title';
    const r = await query(sqlText, params);
    res.json({ documents: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Natural-language / AI-assisted discovery — body: { intent, folder_id? } */
router.post('/documents/intent-search', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const tenantId = req.user.tenant_id;
    const intent = String(req.body?.intent || '').trim();
    if (!intent) {
      return res.status(400).json({ error: 'Describe what you need the document for.' });
    }
    if (intent.length > 2000) {
      return res.status(400).json({ error: 'Please keep your request under 2000 characters.' });
    }
    const rawFolder = req.body?.folder_id;
    const folderId = rawFolder && String(rawFolder).trim() ? String(rawFolder).trim() : null;
    let sqlText = `SELECT d.id, d.folder_id, d.display_title, d.file_name, d.mime_type, d.size_bytes, d.created_at,
      d.ai_summary, d.ai_status, d.is_pin_protected, d.expires_at, d.uploaded_by,
      u.full_name AS uploader_name
      FROM company_library_documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.tenant_id = @t`;
    const params = { t: tenantId };
    if (folderId) {
      sqlText += ' AND d.folder_id = @fid';
      params.fid = folderId;
    }
    sqlText += ' ORDER BY d.display_title';
    const r = await query(sqlText, params);
    const rows = r.recordset || [];
    const { documents, fallback, message } = await matchDocumentsByIntent({ intent, documents: rows });
    res.json({ documents, fallback: !!fallback, message: message || null });
  } catch (err) {
    next(err);
  }
});

/** Must be registered before GET /documents/:id or Express treats "download" as :id. */
router.get('/documents/:id/download', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { id } = req.params;
    await audit(req, {
      documentId: id,
      action: 'download_denied_http_disabled',
      detail: JSON.stringify({
        reason: 'Library files are delivered by email only.',
        query_keys: Object.keys(req.query || {}),
      }).slice(0, 4000),
    });
    return res.status(410).json({
      error:
        'Direct download is disabled. Use Company library → “Email copy to me” to receive the file as an attachment.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id/preview', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { id } = req.params;
    await audit(req, {
      documentId: id,
      action: 'download_denied_http_disabled',
      detail: JSON.stringify({ reason: 'Inline preview disabled; email delivery only.' }).slice(0, 4000),
    });
    return res.status(410).json({
      error:
        'In-browser preview is disabled. Use “Email copy to me” to receive the file and open it from your inbox.',
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/documents/:id', requireSuperAdmin, requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { authorization_pin: authPin } = req.body || {};
    const auth = await verifyDeleteAuthorization(req, id, authPin);
    if (!auth.ok) {
      if (auth.reason === 'missing') {
        return res.status(400).json({
          error:
            'Enter the delete authorization code from your email, or the server fallback PIN if your organisation uses one.',
        });
      }
      return res.status(403).json({
        error: 'Invalid or expired code. Tap “Email me a code” again for a new one, or check the fallback PIN.',
      });
    }
    const r = await query(`SELECT * FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const title = getRow(doc, 'display_title') || '';
    const rel = getRow(doc, 'stored_rel_path');
    await query(`DELETE FROM company_library_access_requests WHERE document_id = @id`, { id });
    await query(`DELETE FROM company_library_download_grants WHERE document_id = @id`, { id });
    await query(`DELETE FROM company_library_pin_challenges WHERE document_id = @id`, { id }).catch(() => {});
    await query(`DELETE FROM company_library_attachment_sessions WHERE document_id = @id`, { id }).catch(() => {});
    await query(`DELETE FROM company_library_delete_otp WHERE document_id = @id`, { id });
    await query(`DELETE FROM company_library_audit WHERE document_id = @id`, { id });
    try {
      const abs = safeResolveStoredPath(tenantId, rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e) {
      console.error('[company-library] delete file', e?.message);
    }
    await query(`DELETE FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    await audit(req, {
      documentId: null,
      action: 'document_delete',
      detail: JSON.stringify({ document_id: id, display_title: title }),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT d.id, d.folder_id, d.display_title, d.file_name, d.mime_type, d.size_bytes, d.created_at,
        d.ai_summary, d.ai_status, d.is_pin_protected, d.expires_at, d.expiry_reminder_lead_days, d.reminder_user_ids, d.uploaded_by,
        u.full_name AS uploader_name, u.email AS uploader_email
       FROM company_library_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = @id AND d.tenant_id = @t`,
      { id, t: tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ document: row });
  } catch (err) {
    next(err);
  }
});

router.post('/documents', requirePageAccess('company_library'), (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!(await libraryTimeAllowed(req))) {
        if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
      }
      const tenantId = req.user.tenant_id;
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'file required' });
      const {
        display_title,
        folder_id,
        is_secured,
        expires_at,
        reminder_user_ids,
        expiry_reminder_lead_days,
      } = req.body || {};
      const title = (display_title && String(display_title).trim()) || file.originalname || 'Untitled';
      const tenantDir = path.join(uploadsLib, String(tenantId));
      const rel = path.relative(tenantDir, file.path).replace(/\\/g, '/');
      const secured =
        is_secured === true ||
        is_secured === 1 ||
        String(is_secured ?? '')
          .trim()
          .toLowerCase() === 'true' ||
        String(is_secured ?? '')
          .trim() === '1';
      const isPin = secured ? 1 : 0;
      const pinHash = null;
      let reminderJson = null;
      if (reminder_user_ids) {
        try {
          const arr = typeof reminder_user_ids === 'string' ? JSON.parse(reminder_user_ids) : reminder_user_ids;
          if (Array.isArray(arr)) reminderJson = JSON.stringify(arr.map((x) => String(x)).slice(0, 50));
        } catch {
          reminderJson = null;
        }
      }
      const ins = await query(
        `INSERT INTO company_library_documents (
          tenant_id, folder_id, display_title, file_name, stored_rel_path, mime_type, size_bytes, uploaded_by,
          is_pin_protected, pin_hash, expires_at, expiry_reminder_lead_days, reminder_user_ids, ai_status
        ) OUTPUT INSERTED.id, INSERTED.display_title, INSERTED.created_at, INSERTED.ai_status
        VALUES (
          @t, @fid, @title, @fn, @rel, @mime, @size, @uid,
          @isPin, @pinHash, @exp, @lead, @rem, N'processing'
        )`,
        {
          t: tenantId,
          fid: folder_id || null,
          title: title.slice(0, 500),
          fn: (file.originalname || 'file').slice(0, 500),
          rel,
          mime: file.mimetype || null,
          size: file.size || null,
          uid: req.user.id,
          isPin,
          pinHash: null,
          exp: expires_at || null,
          lead: expiry_reminder_lead_days != null ? parseInt(expiry_reminder_lead_days, 10) : 14,
          rem: reminderJson,
        }
      );
      const docRow = ins.recordset[0];
      const docId = getRow(docRow, 'id');

      const absPath = file.path;
      setImmediate(async () => {
        try {
          const text = await extractTextSample(absPath, file.mimetype, file.originalname);
          const { summary, status } = await summarizeForLibrary({
            displayTitle: title,
            fileName: file.originalname,
            textSample: text,
          });
          await query(
            `UPDATE company_library_documents SET ai_summary = @s, ai_status = @st, updated_at = SYSUTCDATETIME() WHERE id = @id`,
            { id: docId, s: summary || null, st: String(status).slice(0, 40) }
          );
        } catch (e) {
          await query(
            `UPDATE company_library_documents SET ai_status = N'failed', updated_at = SYSUTCDATETIME() WHERE id = @id`,
            { id: docId }
          ).catch(() => {});
        }
      });

      res.status(201).json({ document: docRow });
    } catch (e) {
      next(e);
    }
  });
});

/** Secured docs only: email a system-generated PIN to the uploader (or to super admin’s own email). */
router.post('/documents/:id/request-access', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT d.*, u.email AS uploader_email, u.full_name AS uploader_name
       FROM company_library_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = @id AND d.tenant_id = @t`,
      { id, t: tenantId }
    );
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!getRow(doc, 'is_pin_protected')) {
      return res.status(400).json({
        error:
          'This document is not secured. Use “Email copy to me” to receive it as an attachment — no PIN is required.',
      });
    }

    const isSuper = req.user.role === 'super_admin';
    const plainPin = String(crypto.randomInt(10_000_000, 99_999_999));
    const pinHash = await bcrypt.hash(plainPin, BCRYPT_ROUNDS);
    const pinExp = new Date(Date.now() + PIN_CHALLENGE_TTL_MS);

    await query(
      `DELETE FROM company_library_pin_challenges
       WHERE document_id = @did AND requester_user_id = @rid AND verified_at IS NULL`,
      { did: id, rid: req.user.id }
    ).catch(() => {});

    const pinMode = isSuper ? 'super_admin' : 'uploader';
    try {
      await query(
        `INSERT INTO company_library_pin_challenges (
          tenant_id, document_id, requester_user_id, pin_hash, pin_sent_mode, expires_at
        ) VALUES (@t, @did, @rid, @h, @mode, @exp)`,
        { t: tenantId, did: id, rid: req.user.id, h: pinHash, mode: pinMode, exp: pinExp }
      );
    } catch (e) {
      if (String(e?.message || '').includes('company_library_pin_challenges')) {
        return res.status(503).json({
          error:
            'This server needs a one-time database update. Run: node scripts/run-company-library-email-flow-migration.js',
        });
      }
      throw e;
    }

    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || '';
    const libUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/company-library` : '';
    const emailReady = isEmailConfigured();
    const recipientEmail = isSuper
      ? String(req.user.email || '').trim()
      : String(getRow(doc, 'uploader_email') || '').trim();

    if (!recipientEmail) {
      if (isSuper) {
        return res.status(400).json({ error: 'Your account has no email address; the system PIN cannot be sent.' });
      }
      return res.status(400).json({
        error:
          'This document has no uploader email on file. Ask an administrator to fix the uploader account or re-upload.',
      });
    }

    if (!emailReady) {
      await audit(req, {
        documentId: id,
        action: isSuper ? 'library_pin_issued_super_admin' : 'library_pin_issued_uploader',
        detail: JSON.stringify({
          outcome: 'email_not_configured',
          pin_mode: pinMode,
          recipient_email: recipientEmail,
          requester_id: req.user.id,
        }).slice(0, 4000),
      });
      return res.status(503).json({
        error:
          'Email is not configured on this server. Set EMAIL_USER and EMAIL_PASS — the PIN must be delivered by email.',
      });
    }

    const title = getRow(doc, 'display_title') || '—';
    const expMin = Math.round(PIN_CHALLENGE_TTL_MS / 60000);
    let html;
    let subject;
    if (isSuper) {
      html = companyLibrarySystemPinToSuperAdminHtml({
        adminName: req.user.full_name,
        documentTitle: title,
        pin: plainPin,
        appUrl: libUrl,
        expiresMinutes: expMin,
      });
      subject = `Company library: your PIN for secured document “${title}”`;
    } else {
      html = companyLibrarySystemPinToUploaderHtml({
        uploaderName: getRow(doc, 'uploader_name'),
        requesterName: req.user.full_name,
        requesterEmail: req.user.email,
        documentTitle: title,
        pin: plainPin,
        appUrl: libUrl,
        expiresMinutes: expMin,
      });
      subject = `Company library: system PIN for “${title}” — share with ${req.user.full_name || 'requester'}`;
    }

    try {
      const info = await sendEmail({ to: recipientEmail, subject, body: html, html: true });
      if (!info) {
        return res.status(502).json({
          error: 'Email was not sent — check EMAIL_USER, EMAIL_PASS, and EMAIL_ENABLED.',
        });
      }
    } catch (e) {
      console.error('[company-library] PIN email', e?.message);
      return res.status(502).json({
        error: e?.message || 'Could not send PIN email. Check SMTP settings.',
      });
    }

    await audit(req, {
      documentId: id,
      action: isSuper ? 'library_pin_issued_super_admin' : 'library_pin_issued_uploader',
      detail: JSON.stringify({
        pin_mode: pinMode,
        recipient_email: recipientEmail,
        requester_id: req.user.id,
        requester_email: req.user.email,
        requester_name: req.user.full_name,
        document_title: title,
        file_name: getRow(doc, 'file_name'),
        pin_expires_at: pinExp.toISOString(),
        uploader_id: getRow(doc, 'uploaded_by') || null,
      }).slice(0, 4000),
    });

    res.json({
      ok: true,
      email_sent: true,
      pin_sent_to: isSuper ? 'your_email' : 'uploader',
      message: isSuper
        ? `A system-generated PIN was emailed to you. Enter it below, then use “Email copy to me” (you can send multiple copies while the session lasts).`
        : `A system-generated PIN was emailed to the uploader. They should share it with you. Enter it below, then use “Email copy to me”.`,
    });
  } catch (err) {
    next(err);
  }
});

/** Verify system PIN → reusable session for emailing the attachment (secured docs). */
router.post('/documents/:id/verify-code', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const rawPin = req.body?.pin ?? req.body?.code;
    const pin = String(rawPin ?? '').trim();
    if (!pin) return res.status(400).json({ error: 'PIN required' });
    const tenantId = req.user.tenant_id;

    const docR = await query(
      `SELECT id, is_pin_protected, display_title FROM company_library_documents WHERE id = @id AND tenant_id = @t`,
      { id, t: tenantId }
    );
    const docMeta = docR.recordset?.[0];
    if (!docMeta) return res.status(404).json({ error: 'Not found' });
    if (!getRow(docMeta, 'is_pin_protected')) {
      return res.status(400).json({
        error: 'This document is not secured — no PIN to verify. Use “Email copy to me” directly.',
      });
    }

    let cq;
    try {
      cq = await query(
        `SELECT TOP 1 * FROM company_library_pin_challenges
         WHERE document_id = @id AND requester_user_id = @uid AND tenant_id = @t
           AND verified_at IS NULL AND expires_at > SYSUTCDATETIME()
         ORDER BY created_at DESC`,
        { id, uid: req.user.id, t: tenantId }
      );
    } catch (e) {
      return res.status(503).json({
        error:
          'This server needs a one-time database update. Run: node scripts/run-company-library-email-flow-migration.js',
      });
    }
    const ch = cq.recordset?.[0];
    if (!ch) {
      return res.status(400).json({ error: 'No active PIN. Use “Email system PIN” first.' });
    }
    const chHash = getRow(ch, 'pin_hash');
    if (!(await bcrypt.compare(pin, String(chHash || '')))) {
      await audit(req, {
        documentId: id,
        action: 'library_pin_verify_fail',
        detail: JSON.stringify({
          document_title: getRow(docMeta, 'display_title'),
          requester_id: req.user.id,
        }).slice(0, 4000),
      });
      return res.status(403).json({ error: 'Incorrect PIN.' });
    }

    await query(`DELETE FROM company_library_pin_challenges WHERE id = @cid`, { cid: getRow(ch, 'id') }).catch(() => {});
    await query(`DELETE FROM company_library_attachment_sessions WHERE document_id = @id AND user_id = @uid`, {
      id,
      uid: req.user.id,
    }).catch(() => {});

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const th = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const sessExp = new Date(Date.now() + ATTACH_SESSION_TTL_MS);
    try {
      await query(
        `INSERT INTO company_library_attachment_sessions (tenant_id, document_id, user_id, token_hash, expires_at)
         VALUES (@t, @id, @uid, @th, @exp)`,
        { t: tenantId, id, uid: req.user.id, th, exp: sessExp }
      );
    } catch (e) {
      return res.status(503).json({
        error:
          'This server needs a one-time database update. Run: node scripts/run-company-library-email-flow-migration.js',
      });
    }

    await audit(req, {
      documentId: id,
      action: 'library_pin_verified',
      detail: JSON.stringify({
        document_title: getRow(docMeta, 'display_title'),
        session_expires_at: sessExp.toISOString(),
      }).slice(0, 4000),
    });

    res.json({
      session_token: sessionToken,
      grant_token: sessionToken,
      expires_at: sessExp.toISOString(),
      message: 'PIN verified. Use “Email copy to me” — you can send multiple emails until the session expires.',
    });
  } catch (err) {
    next(err);
  }
});

/** Deliver file only as an email attachment to the signed-in user (never HTTP download). */
router.post('/documents/:id/email-attachment', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const requesterEmail = String(req.user.email || '').trim();
    if (!requesterEmail) {
      return res.status(400).json({
        error: 'Your account has no email address — the library cannot send the file to you.',
      });
    }

    const r = await query(`SELECT * FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const secured = !!getRow(doc, 'is_pin_protected');
    const tokenIn = String(req.body?.session_token ?? req.body?.grant_token ?? '').trim();

    if (secured) {
      if (!tokenIn) {
        await audit(req, {
          documentId: id,
          action: 'library_email_attachment_denied',
          detail: JSON.stringify({
            reason: 'missing_session_token',
            secured: true,
            recipient_email: requesterEmail,
          }).slice(0, 4000),
        });
        return res.status(403).json({
          error: 'Verify the system PIN first — then use “Email copy to me” (secured document).',
        });
      }
      const th = crypto.createHash('sha256').update(tokenIn).digest('hex');
      let sq;
      try {
        sq = await query(
          `SELECT TOP 1 * FROM company_library_attachment_sessions
           WHERE document_id = @id AND user_id = @uid AND tenant_id = @t AND token_hash = @th AND expires_at > SYSUTCDATETIME()
           ORDER BY created_at DESC`,
          { id, uid: req.user.id, t: tenantId, th }
        );
      } catch (e) {
        return res.status(503).json({
          error:
            'This server needs a one-time database update. Run: node scripts/run-company-library-email-flow-migration.js',
        });
      }
      if (!sq.recordset?.[0]) {
        await audit(req, {
          documentId: id,
          action: 'library_email_attachment_denied',
          detail: JSON.stringify({
            reason: 'invalid_or_expired_session',
            secured: true,
            recipient_email: requesterEmail,
          }).slice(0, 4000),
        });
        return res.status(403).json({
          error: 'Session expired or invalid. Request a new system PIN and verify again.',
        });
      }
    }

    const abs = safeResolveStoredPath(tenantId, getRow(doc, 'stored_rel_path'));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });

    if (!isEmailConfigured()) {
      return res.status(503).json({
        error: 'Email is not configured. Set EMAIL_USER and EMAIL_PASS to receive attachments.',
      });
    }

    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch (e) {
      return res.status(500).json({ error: 'Could not read file from storage.' });
    }

    const fn = getRow(doc, 'file_name') || 'document';
    const title = getRow(doc, 'display_title') || fn;
    const html = companyLibraryAttachmentEmailedHtml({
      recipientName: req.user.full_name,
      documentTitle: title,
      fileName: fn,
      secured,
      note: secured
        ? 'This copy was sent after PIN verification. You may request additional copies from the library while your access session is valid.'
        : 'This document is not secured; no PIN was required.',
    });

    try {
      const info = await sendEmail({
        to: requesterEmail,
        subject: `Company library: “${title}” (attached)`,
        body: html,
        html: true,
        attachments: [{ filename: fn, content: buf.toString('base64'), encoding: 'base64' }],
      });
      if (!info) {
        return res.status(502).json({ error: 'Email was not sent — check server email configuration.' });
      }
    } catch (e) {
      console.error('[company-library] attachment email', e?.message);
      return res.status(502).json({ error: e?.message || 'Failed to send email with attachment.' });
    }

    const auditAction = secured ? 'library_email_attachment_secured' : 'library_email_attachment_unsecured';
    await audit(req, {
      documentId: id,
      action: auditAction,
      detail: JSON.stringify({
        recipient_email: requesterEmail,
        recipient_user_id: req.user.id,
        recipient_name: req.user.full_name,
        document_title: title,
        file_name: fn,
        mime_type: getRow(doc, 'mime_type'),
        size_bytes: buf.length,
        secured,
        ip_address: clientIp(req),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 256),
      }).slice(0, 4000),
    });

    res.json({
      ok: true,
      email_sent: true,
      to: requesterEmail,
      message: `The file was emailed to ${requesterEmail}.`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/recent', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const roles = req.user.page_roles || [];
    const isMgmt = req.user.role === 'super_admin' || roles.some((x) => String(x).toLowerCase() === 'management');
    if (!isMgmt) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const tenantId = req.user.tenant_id;
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const r = await query(
      `SELECT TOP ${lim} a.*, u.full_name AS user_name, d.display_title AS document_title
       FROM company_library_audit a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN company_library_documents d ON d.id = a.document_id
       WHERE a.tenant_id = @t AND ${AUDIT_DOWNLOADS_ONLY_SQL}
       ORDER BY a.created_at DESC`,
      { t: tenantId }
    );
    res.json({ entries: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

export async function runCompanyLibraryExpiryReminders() {
  if (!isEmailConfigured()) return;
  const r = await query(
    `SELECT d.id, d.tenant_id, d.display_title, d.expires_at, d.reminder_user_ids, d.last_expiry_reminder_sent_at, d.expiry_reminder_lead_days
     FROM company_library_documents d
     WHERE d.expires_at IS NOT NULL
       AND d.reminder_user_ids IS NOT NULL
       AND LTRIM(RTRIM(d.reminder_user_ids)) <> N''
       AND d.expires_at >= CAST(GETUTCDATE() AS DATE)`,
    {}
  );
  const rows = r.recordset || [];
  const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || '';
  for (const row of rows) {
    const id = getRow(row, 'id');
    const lead = getRow(row, 'expiry_reminder_lead_days') ?? 14;
    const exp = getRow(row, 'expires_at');
    if (!exp) continue;
    const expDate = new Date(exp);
    const now = new Date();
    const daysLeft = Math.ceil((expDate - now) / (24 * 60 * 60 * 1000));
    if (daysLeft > lead || daysLeft < 0) continue;
    const last = getRow(row, 'last_expiry_reminder_sent_at');
    if (last) {
      const lastD = new Date(last);
      if (now - lastD < 6 * 24 * 60 * 60 * 1000) continue;
    }
    let ids = [];
    try {
      ids = JSON.parse(getRow(row, 'reminder_user_ids') || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(ids) || ids.length === 0) continue;
    const title = getRow(row, 'display_title');
    const expStr = expDate.toLocaleDateString('en-ZA', { dateStyle: 'medium' });
    for (const uid of ids.slice(0, 30)) {
      const uq = await query(`SELECT email, full_name FROM users WHERE id = @id`, { id: uid }).catch(() => ({ recordset: [] }));
      const u = uq.recordset?.[0];
      const email = u && getRow(u, 'email');
      if (!email) continue;
      const html = companyLibraryExpiryReminderHtml({
        recipientName: getRow(u, 'full_name'),
        documentTitle: title,
        expiresAt: expStr,
        appUrl: appUrl ? `${appUrl.replace(/\/$/, '')}/company-library` : '',
      });
      await sendEmail({
        to: email,
        subject: `Company library reminder: “${title}” expires ${expStr}`,
        body: html,
        html: true,
      }).catch(() => {});
    }
    await query(
      `UPDATE company_library_documents SET last_expiry_reminder_sent_at = SYSUTCDATETIME() WHERE id = @id`,
      { id }
    ).catch(() => {});
  }
}

export default router;
