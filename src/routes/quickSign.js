import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { quickSignInviteHtml } from '../lib/emailTemplates.js';
import { buildSignedRecordPdf } from '../lib/quickSignPdf.js';

const router = Router();
const BCRYPT_ROUNDS = 10;
const OTP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 8;

const uploadsRoot = path.join(process.cwd(), 'uploads', 'quick-sign');

function getRow(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  const lower = (keys[0] || '').toString().toLowerCase();
  const entry = Object.entries(row).find(([key]) => key && String(key).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() || null;
}

function clientUa(req) {
  return (req.headers['user-agent'] || '').toString().slice(0, 500) || null;
}

async function logEvent(requestId, eventType, req, metadata = null) {
  const meta = metadata != null ? JSON.stringify(metadata) : null;
  await query(
    `INSERT INTO quick_sign_events (request_id, event_type, ip_address, user_agent, metadata_json)
     VALUES (@requestId, @eventType, @ip, @ua, @meta)`,
    { requestId, eventType, ip: clientIp(req), ua: clientUa(req), meta }
  ).catch((e) => console.error('[quick-sign] audit', e?.message));
}

function appBaseUrl(req) {
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
  return appUrl || 'http://localhost:5173';
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function safeResolveStored(relPath) {
  if (!relPath) return null;
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(process.cwd(), normalized);
  const root = path.join(process.cwd(), 'uploads', 'quick-sign');
  if (!full.startsWith(root)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

const docUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = req.user?.tenant_id || 'pending';
      const dir = path.join(uploadsRoot, String(tenantId), 'originals');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      cb(null, `${randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ok =
      mime === 'application/pdf' ||
      mime.startsWith('image/') ||
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    cb(ok ? null : new Error('Only PDF, images, or Word documents are allowed'), ok);
  },
}).single('document');

async function getRequestByToken(token) {
  const result = await query(
    `SELECT r.*, u.full_name AS sender_name, u.email AS sender_email
     FROM quick_sign_requests r
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE r.access_token = @token`,
    { token: (token || '').trim() }
  );
  return result.recordset?.[0] || null;
}

function mapRequest(row) {
  if (!row) return null;
  return {
    id: getRow(row, 'id'),
    tenant_id: getRow(row, 'tenant_id'),
    title: getRow(row, 'title'),
    notes: getRow(row, 'notes'),
    status: getRow(row, 'status'),
    recipient_email: getRow(row, 'recipient_email'),
    recipient_name: getRow(row, 'recipient_name'),
    recipient_type: getRow(row, 'recipient_type'),
    document_original_name: getRow(row, 'document_original_name'),
    document_mime: getRow(row, 'document_mime'),
    has_signed_document: !!getRow(row, 'document_signed_path'),
    first_accessed_at: getRow(row, 'first_accessed_at'),
    last_accessed_at: getRow(row, 'last_accessed_at'),
    signed_at: getRow(row, 'signed_at'),
    signer_id_number: getRow(row, 'signer_id_number') ? '***' + String(getRow(row, 'signer_id_number')).slice(-4) : null,
    signer_latitude: getRow(row, 'signer_latitude'),
    signer_longitude: getRow(row, 'signer_longitude'),
    signer_location_accuracy: getRow(row, 'signer_location_accuracy'),
    signer_location_captured_at: getRow(row, 'signer_location_captured_at'),
    sent_at: getRow(row, 'sent_at'),
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
    sender_name: getRow(row, 'sender_name'),
    sender_email: getRow(row, 'sender_email'),
    link_expires_at: getRow(row, 'link_expires_at'),
  };
}

function isLinkExpired(row) {
  const exp = getRow(row, 'link_expires_at');
  if (!exp) return false;
  return new Date(exp).getTime() < Date.now();
}

function isSessionValid(row, sessionToken) {
  const st = getRow(row, 'signer_session_token');
  const exp = getRow(row, 'signer_session_expires_at');
  if (!st || !sessionToken || st !== sessionToken) return false;
  if (!exp || new Date(exp).getTime() < Date.now()) return false;
  return true;
}

async function countRecentOtpFailures(requestId) {
  const r = await query(
    `SELECT COUNT(*) AS c FROM quick_sign_events
     WHERE request_id = @id AND event_type = N'otp_failed'
       AND created_at > DATEADD(hour, -2, SYSUTCDATETIME())`,
    { id: requestId }
  );
  return Number(r.recordset?.[0]?.c ?? r.recordset?.[0]?.C ?? 0);
}

// --- Public routes (no session auth) ---

router.get('/public/:token', async (req, res, next) => {
  try {
    const row = await getRequestByToken(req.params.token);
    if (!row) return res.status(404).json({ error: 'Invalid or expired signing link' });
    if (getRow(row, 'status') === 'cancelled') return res.status(410).json({ error: 'This signing request was cancelled' });
    if (isLinkExpired(row)) return res.status(410).json({ error: 'This signing link has expired' });
    if (getRow(row, 'status') === 'signed') {
      return res.json({
        title: getRow(row, 'title'),
        recipientName: getRow(row, 'recipient_name'),
        status: 'signed',
        alreadySigned: true,
      });
    }
    res.json({
      title: getRow(row, 'title'),
      recipientName: getRow(row, 'recipient_name'),
      recipientEmail: getRow(row, 'recipient_email'),
      status: getRow(row, 'status'),
      otpRequired: true,
      alreadySigned: false,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/public/:token/verify-otp', async (req, res, next) => {
  try {
    const token = (req.params.token || '').trim();
    const code = String(req.body?.code || req.body?.otp || '').trim();
    if (!code || code.length < 4) return res.status(400).json({ error: 'Enter the one-time PIN from your email' });

    const row = await getRequestByToken(token);
    if (!row) return res.status(404).json({ error: 'Invalid or expired signing link' });
    if (isLinkExpired(row)) return res.status(410).json({ error: 'This signing link has expired' });
    if (getRow(row, 'status') === 'signed') return res.status(400).json({ error: 'This document has already been signed' });
    if (getRow(row, 'status') === 'cancelled') return res.status(410).json({ error: 'This signing request was cancelled' });

    const requestId = getRow(row, 'id');
    if (await countRecentOtpFailures(requestId) >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many incorrect PIN attempts. Contact the sender for a new link.' });
    }

    const hash = getRow(row, 'otp_hash');
    const otpExp = getRow(row, 'otp_expires_at');
    if (!hash) return res.status(400).json({ error: 'Signing is not ready yet. Contact the sender.' });
    if (otpExp && new Date(otpExp).getTime() < Date.now()) {
      return res.status(410).json({ error: 'The one-time PIN has expired. Contact the sender.' });
    }

    const match = await bcrypt.compare(code, hash);
    if (!match) {
      await logEvent(requestId, 'otp_failed', req);
      return res.status(401).json({ error: 'Incorrect PIN. Check the code in your email.' });
    }

    const sessionToken = randomBytes(32).toString('hex');
    const sessionExp = new Date(Date.now() + SESSION_TTL_MS);
    const now = new Date();
    const firstAccess = getRow(row, 'first_accessed_at');

    await query(
      `UPDATE quick_sign_requests SET
         signer_session_token = @sessionToken,
         signer_session_expires_at = @sessionExp,
         otp_verified_at = @now,
         first_accessed_at = COALESCE(first_accessed_at, @now),
         last_accessed_at = @now,
         status = CASE WHEN status = N'sent' THEN N'accessed' ELSE status END,
         updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id: requestId, sessionToken, sessionExp: sessionExp.toISOString(), now: now.toISOString() }
    );

    await logEvent(requestId, 'otp_verified', req, { first_access: !firstAccess });
    await logEvent(requestId, 'link_opened', req);

    res.json({
      sessionToken,
      sessionExpiresAt: sessionExp.toISOString(),
      documentMime: getRow(row, 'document_mime'),
      documentName: getRow(row, 'document_original_name'),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/public/:token/document', async (req, res, next) => {
  try {
    const sessionToken = (req.query.session || req.headers['x-sign-session'] || '').toString().trim();
    const row = await getRequestByToken(req.params.token);
    if (!row || !isSessionValid(row, sessionToken)) {
      return res.status(401).json({ error: 'Session expired. Enter your PIN again.' });
    }
    const full = safeResolveStored(getRow(row, 'document_original_path'));
    if (!full) return res.status(404).json({ error: 'Document not found' });

    await query(
      `UPDATE quick_sign_requests SET last_accessed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: getRow(row, 'id') }
    );
    await logEvent(getRow(row, 'id'), 'document_viewed', req);

    res.setHeader('Content-Type', getRow(row, 'document_mime') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(getRow(row, 'document_original_name') || 'document')}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.post('/public/:token/complete', async (req, res, next) => {
  try {
    const sessionToken = (req.body?.sessionToken || req.headers['x-sign-session'] || '').toString().trim();
    const {
      signatureDataUrl,
      id_number: idNumber,
      latitude,
      longitude,
      accuracy,
    } = req.body || {};

    const row = await getRequestByToken(req.params.token);
    if (!row || !isSessionValid(row, sessionToken)) {
      return res.status(401).json({ error: 'Session expired. Enter your PIN again.' });
    }
    if (getRow(row, 'status') === 'signed') return res.status(400).json({ error: 'Already signed' });
    if (isLinkExpired(row)) return res.status(410).json({ error: 'Link expired' });

    const idStr = String(idNumber || '').trim().replace(/\s/g, '');
    if (!idStr || idStr.length < 6) return res.status(400).json({ error: 'A valid ID number is required' });
    if (!signatureDataUrl || !String(signatureDataUrl).startsWith('data:image/')) {
      return res.status(400).json({ error: 'Signature is required' });
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Location must be enabled to sign. Allow location access and try again.' });
    }

    const requestId = getRow(row, 'id');
    const tenantId = getRow(row, 'tenant_id');
    const sigDir = path.join(uploadsRoot, String(tenantId), 'signatures');
    fs.mkdirSync(sigDir, { recursive: true });
    const sigFile = `${randomBytes(16).toString('hex')}.png`;
    const sigFull = path.join(sigDir, sigFile);
    const b64 = String(signatureDataUrl).replace(/^data:image\/\w+;base64,/, '');
    await fs.promises.writeFile(sigFull, Buffer.from(b64, 'base64'));
    const sigRel = path.relative(process.cwd(), sigFull).split(path.sep).join('/');

    const signedDir = path.join(uploadsRoot, String(tenantId), 'signed');
    fs.mkdirSync(signedDir, { recursive: true });
    const signedFile = `${randomBytes(16).toString('hex')}.pdf`;
    const signedFull = path.join(signedDir, signedFile);
    const signedRel = path.relative(process.cwd(), signedFull).split(path.sep).join('/');

    const signedAt = new Date();
    await buildSignedRecordPdf(signedFull, {
      title: getRow(row, 'title'),
      originalFileName: getRow(row, 'document_original_name'),
      recipientName: getRow(row, 'recipient_name'),
      recipientEmail: getRow(row, 'recipient_email'),
      signerIdNumber: idStr,
      signedAt,
      latitude: lat,
      longitude: lng,
      locationAccuracy: Number(accuracy) || null,
      signatureImagePath: sigFull,
    });

    await query(
      `UPDATE quick_sign_requests SET
         status = N'signed',
         signed_at = @signedAt,
         signer_id_number = @idNumber,
         signer_latitude = @lat,
         signer_longitude = @lng,
         signer_location_accuracy = @acc,
         signer_location_captured_at = @signedAt,
         signature_image_path = @sigPath,
         document_signed_path = @signedPath,
         signer_session_token = NULL,
         signer_session_expires_at = NULL,
         updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      {
        id: requestId,
        signedAt: signedAt.toISOString(),
        idNumber: idStr,
        lat,
        lng,
        acc: Number(accuracy) || null,
        sigPath: sigRel,
        signedPath: signedRel,
      }
    );

    await logEvent(requestId, 'signed', req, { latitude: lat, longitude: lng, accuracy: Number(accuracy) || null });

    res.json({ ok: true, message: 'Document signed successfully. The sender has been notified.' });
  } catch (err) {
    next(err);
  }
});

// --- Authenticated routes ---

const authRouter = Router();
authRouter.use(requireAuth);
authRouter.use(loadUser);
authRouter.use(requirePageAccess('quick_sign'));

authRouter.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT r.id, r.title, r.status, r.recipient_email, r.recipient_name, r.recipient_type,
              r.document_original_name, r.sent_at, r.signed_at, r.first_accessed_at, r.last_accessed_at,
              r.created_at, u.full_name AS sender_name
       FROM quick_sign_requests r
       LEFT JOIN users u ON u.id = r.created_by_user_id
       WHERE r.tenant_id = @tenantId
       ORDER BY r.created_at DESC`,
      { tenantId }
    );
    res.json({ requests: (result.recordset || []).map(mapRequest) });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/tenant-users', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND status = N'active' ORDER BY full_name`,
      { tenantId }
    );
    res.json({ users: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT r.*, u.full_name AS sender_name, u.email AS sender_email
       FROM quick_sign_requests r
       LEFT JOIN users u ON u.id = r.created_by_user_id
       WHERE r.id = @id AND r.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });

    const events = await query(
      `SELECT id, event_type, ip_address, user_agent, metadata_json, created_at
       FROM quick_sign_events WHERE request_id = @id ORDER BY created_at ASC`,
      { id }
    );

    const detail = mapRequest(row);
    detail.signer_id_number_full = getRow(row, 'signer_id_number') || null;
    detail.events = (events.recordset || []).map((e) => ({
      id: getRow(e, 'id'),
      event_type: getRow(e, 'event_type'),
      ip_address: getRow(e, 'ip_address'),
      created_at: getRow(e, 'created_at'),
      metadata_json: getRow(e, 'metadata_json'),
    }));

    res.json({ request: detail });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/', (req, res, next) => {
  docUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'Document file is required' });

      const tenantId = req.user.tenant_id;
      const userId = req.user.id;
      const {
        title,
        notes,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        recipient_type: recipientType,
      } = req.body || {};

      const titleStr = String(title || req.file.originalname || 'Document').trim();
      const emailStr = String(recipientEmail || '').trim().toLowerCase();
      if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
        return res.status(400).json({ error: 'Valid recipient email is required' });
      }

      const rel = path.relative(process.cwd(), req.file.path).split(path.sep).join('/');
      const accessToken = randomBytes(32).toString('hex');
      const rType = recipientType === 'internal' ? 'internal' : 'external';

      const ins = await query(
        `INSERT INTO quick_sign_requests (
           tenant_id, title, notes, status, recipient_email, recipient_name, recipient_type,
           document_original_name, document_original_path, document_mime, access_token, created_by_user_id
         ) OUTPUT INSERTED.id
         VALUES (
           @tenantId, @title, @notes, N'draft', @email, @rname, @rtype,
           @origName, @path, @mime, @token, @userId
         )`,
        {
          tenantId,
          title: titleStr,
          notes: notes ? String(notes).trim() : null,
          email: emailStr,
          rname: recipientName ? String(recipientName).trim() : null,
          rtype: rType,
          origName: req.file.originalname,
          path: rel,
          mime: req.file.mimetype,
          token: accessToken,
          userId,
        }
      );
      const newId = ins.recordset?.[0]?.id ?? ins.recordset?.[0]?.Id;
      await logEvent(newId, 'created', req, { title: titleStr });

      const get = await query(`SELECT * FROM quick_sign_requests WHERE id = @id`, { id: newId });
      res.status(201).json({ request: mapRequest(get.recordset?.[0]) });
    } catch (err) {
      next(err);
    }
  });
});

authRouter.post('/:id/send', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (getRow(row, 'status') !== 'draft') return res.status(400).json({ error: 'Only draft requests can be sent' });

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Cannot send signing invitation.' });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
    const otpExp = new Date(Date.now() + OTP_TTL_MS);
    const linkExp = new Date(Date.now() + LINK_TTL_MS);
    const signLink = `${appBaseUrl(req)}/quick-sign/${getRow(row, 'access_token')}`;

    await query(
      `UPDATE quick_sign_requests SET
         status = N'sent',
         otp_hash = @otpHash,
         otp_expires_at = @otpExp,
         link_expires_at = @linkExp,
         sent_at = SYSUTCDATETIME(),
         updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      { id, otpHash, otpExp: otpExp.toISOString(), linkExp: linkExp.toISOString() }
    );

    const html = quickSignInviteHtml({
      recipientName: getRow(row, 'recipient_name'),
      documentTitle: getRow(row, 'title'),
      signLink,
      otp,
      senderName: req.user.full_name || req.user.email,
      expiresAt: linkExp,
    });

    await sendEmail({
      to: getRow(row, 'recipient_email'),
      subject: `Sign document: ${getRow(row, 'title')} – Thinkers Quick Sign`,
      body: html,
      html: true,
    });

    await logEvent(id, 'sent', req, { recipient: getRow(row, 'recipient_email') });

    const updated = await query(`SELECT * FROM quick_sign_requests WHERE id = @id`, { id });
    res.json({ request: mapRequest(updated.recordset?.[0]), message: 'Signing invitation sent' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT status FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (getRow(row, 'status') === 'signed') return res.status(400).json({ error: 'Cannot cancel a signed request' });

    await query(
      `UPDATE quick_sign_requests SET status = N'cancelled', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id }
    );
    await logEvent(id, 'cancelled', req);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id/document', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const kind = (req.query.kind || 'original').toString();
    const result = await query(
      `SELECT document_original_path, document_signed_path, document_original_name, document_mime
       FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });

    const rel = kind === 'signed' ? getRow(row, 'document_signed_path') : getRow(row, 'document_original_path');
    const full = safeResolveStored(rel);
    if (!full) return res.status(404).json({ error: 'File not found' });

    const name = kind === 'signed' ? `signed-${getRow(row, 'document_original_name') || 'record'}.pdf` : getRow(row, 'document_original_name');
    res.setHeader('Content-Type', kind === 'signed' ? 'application/pdf' : (getRow(row, 'document_mime') || 'application/octet-stream'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id/signature-image', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT signature_image_path FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId AND status = N'signed'`,
      { id: req.params.id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const full = safeResolveStored(getRow(row, 'signature_image_path'));
    if (!full) return res.status(404).json({ error: 'Signature not found' });
    res.setHeader('Content-Type', 'image/png');
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.use(authRouter);

export default router;
