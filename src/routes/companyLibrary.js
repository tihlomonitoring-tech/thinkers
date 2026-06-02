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
  companyLibraryAccessApprovedToRequesterHtml,
  companyLibraryAccessRequestToUploaderHtml,
  companyLibraryAttachmentEmailedHtml,
  companyLibraryExpiryReminderHtml,
  companyLibrarySuperAdminDeleteCodeHtml,
  companyLibrarySystemPinToSuperAdminHtml,
  companyLibrarySystemPinToUploaderHtml,
} from '../lib/emailTemplates.js';
import {
  createLiveSession,
  enrichDocumentAccess,
  getLiveSession,
  mapDocumentAccess,
  revokeAllLiveSessions,
  scoreDocumentSearch,
} from '../lib/companyLibraryDocumentAccess.js';

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
      d.ai_summary, d.ai_status, d.is_pin_protected, d.is_access_locked, d.expires_at, d.uploaded_by,
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
    let r;
    try {
      r = await query(sqlText, params);
    } catch (err) {
      if (!String(err.message).includes('is_access_locked')) throw err;
      sqlText = sqlText.replace(', d.is_access_locked', '');
      r = await query(sqlText, params);
    }
    let docs = r.recordset || [];
    if (q) {
      docs = docs
        .map((row) => ({ row, score: scoreDocumentSearch(row, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => ({ ...x.row, relevance_score: x.score }));
    }
    const enriched = [];
    for (const row of docs) {
      try {
        enriched.push(await enrichDocumentAccess(row, req));
      } catch {
        enriched.push(row);
      }
    }
    res.json({ documents: enriched });
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
    const enriched = [];
    for (const row of documents || []) {
      try {
        enriched.push(await enrichDocumentAccess(row, req));
      } catch {
        enriched.push(row);
      }
    }
    res.json({ documents: enriched, fallback: !!fallback, message: message || null });
  } catch (err) {
    next(err);
  }
});

/** Must be registered before GET /documents/:id or Express treats "download" as :id. */
router.get('/documents/:id/download', requireSuperAdmin, requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const abs = safeResolveStoredPath(tenantId, getRow(doc, 'stored_rel_path'));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    const fn = getRow(doc, 'file_name') || 'document';
    if (getRow(doc, 'mime_type')) res.setHeader('Content-Type', getRow(doc, 'mime_type'));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fn)}"`);
    res.sendFile(abs);
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id/preview', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const access = mapDocumentAccess(doc, {
      userId: req.user.id,
      role: req.user.role,
      liveSession: await getLiveSession(tenantId, id, req.user.id),
    });
    if (!access.can_view) {
      return res.status(403).json({
        error: access.needs_access_request
          ? 'This is a private document. Request access from the owner first.'
          : 'You do not have permission to view this document.',
      });
    }
    const abs = safeResolveStoredPath(tenantId, getRow(doc, 'stored_rel_path'));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    const fn = getRow(doc, 'file_name') || 'document';
    if (getRow(doc, 'mime_type')) res.setHeader('Content-Type', getRow(doc, 'mime_type'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fn)}"`);
    res.sendFile(abs);
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
    try {
      const enriched = await enrichDocumentAccess(row, req);
      return res.json({ document: enriched });
    } catch {
      return res.json({ document: row });
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/documents/:id', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT * FROM company_library_documents WHERE id = @id AND tenant_id = @t`, { id, t: tenantId });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const isOwner = String(getRow(doc, 'uploaded_by')) === String(req.user.id);
    const isSuper = req.user.role === 'super_admin';
    if (!isOwner && !isSuper) return res.status(403).json({ error: 'Only the uploader can edit this document.' });

    const { display_title, folder_id, expires_at, is_secured, expiry_reminder_lead_days, reminder_user_ids } = req.body || {};
    const sets = [];
    const params = { id, t: tenantId };
    if (display_title != null) {
      sets.push('display_title = @title');
      params.title = String(display_title).trim().slice(0, 500) || getRow(doc, 'display_title');
    }
    if (folder_id !== undefined) {
      sets.push('folder_id = @fid');
      params.fid = folder_id && String(folder_id).trim() ? folder_id : null;
    }
    if (expires_at !== undefined) {
      sets.push('expires_at = @exp');
      params.exp = expires_at || null;
    }
    if (expiry_reminder_lead_days != null) {
      sets.push('expiry_reminder_lead_days = @lead');
      params.lead = parseInt(expiry_reminder_lead_days, 10) || 14;
    }
    if (reminder_user_ids !== undefined) {
      let reminderJson = null;
      if (reminder_user_ids) {
        const arr = Array.isArray(reminder_user_ids) ? reminder_user_ids : JSON.parse(String(reminder_user_ids));
        if (Array.isArray(arr)) reminderJson = JSON.stringify(arr.map((x) => String(x)).slice(0, 50));
      }
      sets.push('reminder_user_ids = @rem');
      params.rem = reminderJson;
    }
    if (is_secured !== undefined) {
      const secured =
        is_secured === true ||
        is_secured === 1 ||
        String(is_secured).trim().toLowerCase() === 'true' ||
        String(is_secured).trim() === '1';
      sets.push('is_pin_protected = @isPin', 'is_access_locked = @isLock');
      params.isPin = secured ? 1 : 0;
      params.isLock = secured ? 1 : 0;
      if (secured) await revokeAllLiveSessions(id);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = SYSUTCDATETIME()');
    try {
      await query(`UPDATE company_library_documents SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
    } catch (e) {
      if (String(e.message).includes('is_access_locked')) {
        const noLock = sets.filter((s) => !s.includes('is_access_locked'));
        if (noLock.length <= 1) return res.status(503).json({ error: 'Run: npm run db:company-library-access-v2' });
        await query(`UPDATE company_library_documents SET ${noLock.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
      } else throw e;
    }
    const out = await query(
      `SELECT d.id, d.folder_id, d.display_title, d.file_name, d.mime_type, d.size_bytes, d.created_at,
        d.ai_summary, d.ai_status, d.is_pin_protected, d.is_access_locked, d.expires_at, d.expiry_reminder_lead_days,
        d.reminder_user_ids, d.uploaded_by, u.full_name AS uploader_name
       FROM company_library_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = @id`,
      { id }
    );
    const row = out.recordset?.[0];
    const enriched = await enrichDocumentAccess(row, req).catch(() => row);
    res.json({ document: enriched });
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
      const folder_id = req.body?.folder_id;
      if (!folder_id || !String(folder_id).trim()) {
        try { fs.unlinkSync(file.path); } catch {}
        return res.status(400).json({ error: 'Select or create a folder before uploading.' });
      }
      const {
        display_title,
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
      const isAccessLocked = secured ? 1 : 0;
      let ins;
      try {
        ins = await query(
          `INSERT INTO company_library_documents (
            tenant_id, folder_id, display_title, file_name, stored_rel_path, mime_type, size_bytes, uploaded_by,
            is_pin_protected, is_access_locked, pin_hash, expires_at, expiry_reminder_lead_days, reminder_user_ids, ai_status
          ) OUTPUT INSERTED.id, INSERTED.display_title, INSERTED.created_at, INSERTED.ai_status, INSERTED.is_pin_protected
          VALUES (
            @t, @fid, @title, @fn, @rel, @mime, @size, @uid,
            @isPin, @isLock, @pinHash, @exp, @lead, @rem, N'processing'
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
            isLock: isAccessLocked,
            pinHash: null,
            exp: expires_at || null,
            lead: expiry_reminder_lead_days != null ? parseInt(expiry_reminder_lead_days, 10) : 14,
            rem: reminderJson,
          }
        );
      } catch (e) {
        if (!String(e.message).includes('is_access_locked')) throw e;
        ins = await query(
          `INSERT INTO company_library_documents (
            tenant_id, folder_id, display_title, file_name, stored_rel_path, mime_type, size_bytes, uploaded_by,
            is_pin_protected, pin_hash, expires_at, expiry_reminder_lead_days, reminder_user_ids, ai_status
          ) OUTPUT INSERTED.id, INSERTED.display_title, INSERTED.created_at, INSERTED.ai_status, INSERTED.is_pin_protected
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
      }
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

/** Private docs: request live access from the uploader (email notification). */
router.post('/documents/:id/request-access', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    if (!(await libraryTimeAllowed(req))) {
      return res.status(403).json({ error: 'Library is only available during scheduled hours.' });
    }
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const requesterNote = String(req.body?.note || req.body?.requester_note || '').trim().slice(0, 500);
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
      return res.status(400).json({ error: 'This document is public. Open it directly or email a copy to yourself.' });
    }
    if (String(getRow(doc, 'uploaded_by')) === String(req.user.id)) {
      return res.status(400).json({ error: 'You own this document.' });
    }
    const live = await getLiveSession(tenantId, id, req.user.id);
    if (live) {
      return res.json({ ok: true, message: 'You already have live access to this document.' });
    }
    const pending = await query(
      `SELECT TOP 1 id FROM company_library_access_requests
       WHERE document_id = @did AND requester_user_id = @rid AND status = N'pending'`,
      { did: id, rid: req.user.id }
    );
    if (pending.recordset?.[0]) {
      return res.json({ ok: true, message: 'Your access request is already pending. The uploader was notified by email.' });
    }
    let ins;
    try {
      ins = await query(
        `INSERT INTO company_library_access_requests (tenant_id, document_id, requester_user_id, status, requester_note)
         OUTPUT INSERTED.id VALUES (@t, @did, @rid, N'pending', @note)`,
        { t: tenantId, did: id, rid: req.user.id, note: requesterNote || null }
      );
    } catch (e) {
      ins = await query(
        `INSERT INTO company_library_access_requests (tenant_id, document_id, requester_user_id, status)
         OUTPUT INSERTED.id VALUES (@t, @did, @rid, N'pending')`,
        { t: tenantId, did: id, rid: req.user.id }
      );
    }
    const requestId = getRow(ins.recordset?.[0], 'id');
    const uploaderEmail = String(getRow(doc, 'uploader_email') || '').trim();
    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || '';
    const libUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/company-library` : '';
    const title = getRow(doc, 'display_title') || '—';
    if (uploaderEmail && isEmailConfigured()) {
      const html = companyLibraryAccessRequestToUploaderHtml({
        uploaderName: getRow(doc, 'uploader_name'),
        requesterName: req.user.full_name,
        requesterEmail: req.user.email,
        documentTitle: title,
        requesterNote,
        appUrl: libUrl,
      });
      await sendEmail({
        to: uploaderEmail,
        subject: `Company library: access request for “${title}”`,
        body: html,
        html: true,
      }).catch((e) => console.error('[company-library] access request email', e?.message));
    }
    res.json({
      ok: true,
      request_id: requestId,
      message: uploaderEmail
        ? 'Access request sent. The uploader will be notified by email to approve or deny.'
        : 'Access request recorded. Ask the uploader to check their inbox in the Company library.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/access-requests/inbox', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const r = await query(
      `SELECT ar.id, ar.document_id, ar.requester_user_id, ar.requester_note, ar.created_at,
        d.display_title AS document_title, d.is_pin_protected,
        u.full_name AS requester_name, u.email AS requester_email
       FROM company_library_access_requests ar
       INNER JOIN company_library_documents d ON d.id = ar.document_id AND d.tenant_id = @t
       INNER JOIN users u ON u.id = ar.requester_user_id
       WHERE ar.tenant_id = @t AND ar.status = N'pending' AND d.uploaded_by = @uid
       ORDER BY ar.created_at DESC`,
      { t: tenantId, uid: req.user.id }
    );
    res.json({ requests: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/access-requests/:requestId/approve', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const tenantId = req.user.tenant_id;
    const rq = await query(
      `SELECT ar.*, d.display_title, d.uploaded_by, d.is_pin_protected,
        ru.email AS requester_email, ru.full_name AS requester_name
       FROM company_library_access_requests ar
       INNER JOIN company_library_documents d ON d.id = ar.document_id
       INNER JOIN users ru ON ru.id = ar.requester_user_id
       WHERE ar.id = @rid AND ar.tenant_id = @t AND ar.status = N'pending'`,
      { rid: requestId, t: tenantId }
    );
    const row = rq.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Request not found or already handled' });
    if (String(getRow(row, 'uploaded_by')) !== String(req.user.id) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the document owner can approve access.' });
    }
    const docId = getRow(row, 'document_id');
    const requesterId = getRow(row, 'requester_user_id');
    const session = await createLiveSession(tenantId, docId, requesterId);
    await query(
      `UPDATE company_library_access_requests
       SET status = N'fulfilled', fulfilled_at = SYSUTCDATETIME(), responded_by = @by, responded_at = SYSUTCDATETIME()
       WHERE id = @rid`,
      { rid: requestId, by: req.user.id }
    );
    const title = getRow(row, 'display_title') || '—';
    const requesterEmail = String(getRow(row, 'requester_email') || '').trim();
    const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || '';
    const libUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/company-library` : '';
    if (requesterEmail && isEmailConfigured()) {
      const html = companyLibraryAccessApprovedToRequesterHtml({
        requesterName: getRow(row, 'requester_name'),
        documentTitle: title,
        uploaderName: req.user.full_name,
        appUrl: libUrl,
      });
      await sendEmail({
        to: requesterEmail,
        subject: `Company library: access approved for “${title}”`,
        body: html,
        html: true,
      }).catch(() => {});
    }
    res.json({
      ok: true,
      expires_at: session.expiresAt,
      message: 'Access approved. The requester has live access until you lock the document again.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/access-requests/:requestId/deny', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const tenantId = req.user.tenant_id;
    const rq = await query(
      `SELECT ar.id, d.uploaded_by FROM company_library_access_requests ar
       INNER JOIN company_library_documents d ON d.id = ar.document_id
       WHERE ar.id = @rid AND ar.tenant_id = @t AND ar.status = N'pending'`,
      { rid: requestId, t: tenantId }
    );
    const row = rq.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Request not found or already handled' });
    if (String(getRow(row, 'uploaded_by')) !== String(req.user.id) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the document owner can deny access.' });
    }
    await query(
      `UPDATE company_library_access_requests
       SET status = N'denied', denied_at = SYSUTCDATETIME(), responded_by = @by, responded_at = SYSUTCDATETIME()
       WHERE id = @rid`,
      { rid: requestId, by: req.user.id }
    );
    res.json({ ok: true, message: 'Access request denied.' });
  } catch (err) {
    next(err);
  }
});

router.post('/documents/:id/lock', requirePageAccess('company_library'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const r = await query(`SELECT uploaded_by, is_pin_protected FROM company_library_documents WHERE id = @id AND tenant_id = @t`, {
      id,
      t: tenantId,
    });
    const doc = r.recordset?.[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(doc, 'uploaded_by')) !== String(req.user.id) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the document owner can lock access.' });
    }
    await revokeAllLiveSessions(id);
    try {
      await query(
        `UPDATE company_library_documents SET is_access_locked = 1, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id }
      );
    } catch {
      /* column may be missing pre-migration */
    }
    res.json({ ok: true, message: 'Document locked. All live access sessions were ended.' });
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

    const live = await getLiveSession(tenantId, id, req.user.id);
    const access = mapDocumentAccess(doc, {
      userId: req.user.id,
      role: req.user.role,
      liveSession: live,
    });
    if (!access.can_email) {
      return res.status(403).json({
        error: access.needs_access_request
          ? 'Request access from the document owner before emailing a copy.'
          : 'You do not have permission to receive this document.',
      });
    }
    const secured = access.is_private;

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
        ? 'This copy was sent while your live access is active. The owner can lock the document again at any time.'
        : 'This document is public in the company library.',
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
