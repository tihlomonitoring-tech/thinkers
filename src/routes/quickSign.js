import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { isEmailConfigured } from '../lib/emailService.js';
import { buildSignedRecordPdf } from '../lib/quickSignPdf.js';
import {
  getRow,
  safeResolveStored,
  generateOtp,
  appBaseUrl,
  logEvent,
  resolveByToken,
  isLinkExpired,
  isRecipientSessionValid,
  isLegacySessionValid,
  getWorkingDocumentRel,
  ensureWorkingPdf,
  loadRecipients,
  applySignerPlacements,
  emailSignedCopy,
  sendRecipientInvites,
  refreshRequestStatus,
  BCRYPT_ROUNDS,
  uploadsRoot,
} from '../lib/quickSignService.js';
import { quickSignInviteHtml } from '../lib/emailTemplates.js';
import { sendEmail } from '../lib/emailService.js';
import { getPdfPageCount } from '../lib/quickSignPdfStamp.js';

const router = Router();
const OTP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 8;

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
    const ok = mime === 'application/pdf' || mime.startsWith('image/');
    cb(ok ? null : new Error('Upload PDF or image files for on-document signing'), ok);
  },
}).single('document');

function mapRequest(row, recipients = []) {
  if (!row) return null;
  const signed = recipients.filter((r) => getRow(r, 'status') === 'signed').length;
  return {
    id: getRow(row, 'id'),
    title: getRow(row, 'title'),
    notes: getRow(row, 'notes'),
    status: getRow(row, 'status'),
    signing_mode: getRow(row, 'signing_mode') || 'legacy',
    allow_sender_sign: !!getRow(row, 'allow_sender_sign'),
    page_count: getRow(row, 'page_count'),
    document_original_name: getRow(row, 'document_original_name'),
    document_mime: getRow(row, 'document_mime'),
    has_working_document: !!getRow(row, 'document_working_path'),
    has_signed_document: !!(getRow(row, 'document_signed_path') || getRow(row, 'document_working_path')),
    recipients_signed: signed,
    recipients_total: recipients.length,
    sent_at: getRow(row, 'sent_at'),
    created_at: getRow(row, 'created_at'),
    sender_name: getRow(row, 'sender_name'),
  };
}

async function countOtpFailures(requestId, recipientId = null) {
  const r = await query(
    `SELECT COUNT(*) AS c FROM quick_sign_events
     WHERE request_id = @id AND event_type = N'otp_failed'
       AND created_at > DATEADD(hour, -2, SYSUTCDATETIME())`,
    { id: requestId }
  );
  return Number(r.recordset?.[0]?.c ?? 0);
}

function parseRecipientsBody(body) {
  const raw = body?.recipients;
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// --- Public routes ---

router.get('/public/:token', async (req, res, next) => {
  try {
    const resolved = await resolveByToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'Invalid or expired signing link' });
    const { mode, request, recipient } = resolved;
    const reqRow = mode === 'recipient' ? request : request;
    if (isLinkExpired(reqRow)) return res.status(410).json({ error: 'This signing link has expired' });
    if (getRow(reqRow, 'request_status') === 'cancelled' || getRow(reqRow, 'status') === 'cancelled') {
      return res.status(410).json({ error: 'This signing request was cancelled' });
    }

    if (mode === 'recipient') {
      const already = getRow(recipient, 'status') === 'signed';
      return res.json({
        title: getRow(reqRow, 'title'),
        recipientName: getRow(recipient, 'full_name'),
        signingMode: getRow(reqRow, 'signing_mode') || 'on_document',
        pageCount: getRow(reqRow, 'page_count') || 1,
        documentMime: getRow(reqRow, 'document_mime'),
        alreadySigned: already,
        otpRequired: !already,
      });
    }

    if (getRow(request, 'status') === 'signed') {
      return res.json({ title: getRow(request, 'title'), alreadySigned: true, signingMode: 'legacy' });
    }
    res.json({
      title: getRow(request, 'title'),
      recipientName: getRow(request, 'recipient_name'),
      signingMode: 'legacy',
      alreadySigned: false,
      otpRequired: true,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/public/:token/verify-otp', async (req, res, next) => {
  try {
    const code = String(req.body?.code || req.body?.otp || '').trim();
    if (!code) return res.status(400).json({ error: 'Enter the one-time PIN from your email' });

    const resolved = await resolveByToken(req.params.token);
    if (!resolved) return res.status(404).json({ error: 'Invalid or expired signing link' });

    if (resolved.mode === 'recipient') {
      const { recipient, request } = resolved;
      const requestId = getRow(request, 'request_id') || getRow(request, 'id');
      if (isLinkExpired(request)) return res.status(410).json({ error: 'Link expired' });
      if (getRow(recipient, 'status') === 'signed') return res.status(400).json({ error: 'You have already signed' });
      if (await countOtpFailures(requestId) >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many incorrect PIN attempts.' });
      }
      const hash = getRow(recipient, 'otp_hash');
      if (!hash || !(await bcrypt.compare(code, hash))) {
        await logEvent(requestId, 'otp_failed', req, null, getRow(recipient, 'id'));
        return res.status(401).json({ error: 'Incorrect PIN' });
      }
      const sessionToken = randomBytes(32).toString('hex');
      const sessionExp = new Date(Date.now() + SESSION_TTL_MS);
      await query(
        `UPDATE quick_sign_recipients SET signer_session_token = @st, signer_session_expires_at = @exp,
           status = CASE WHEN status = N'sent' THEN N'accessed' ELSE status END, updated_at = SYSUTCDATETIME()
         WHERE id = @id`,
        { id: getRow(recipient, 'id'), st: sessionToken, exp: sessionExp.toISOString() }
      );
      await query(
        `UPDATE quick_sign_requests SET last_accessed_at = SYSUTCDATETIME(), first_accessed_at = COALESCE(first_accessed_at, SYSUTCDATETIME()),
           status = CASE WHEN status = N'sent' THEN N'in_progress' ELSE status END WHERE id = @id`,
        { id: requestId }
      );
      await logEvent(requestId, 'otp_verified', req, null, getRow(recipient, 'id'));
      return res.json({
        sessionToken,
        signingMode: getRow(request, 'signing_mode') || 'on_document',
        pageCount: getRow(request, 'page_count') || 1,
        documentMime: getRow(request, 'document_mime'),
        documentName: getRow(request, 'document_original_name'),
      });
    }

    // Legacy single-recipient
    const row = resolved.request;
    const requestId = getRow(row, 'id');
    if (getRow(row, 'status') === 'signed') return res.status(400).json({ error: 'Already signed' });
    const hash = getRow(row, 'otp_hash');
    if (!hash || !(await bcrypt.compare(code, hash))) {
      await logEvent(requestId, 'otp_failed', req);
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    const sessionToken = randomBytes(32).toString('hex');
    const sessionExp = new Date(Date.now() + SESSION_TTL_MS);
    await query(
      `UPDATE quick_sign_requests SET signer_session_token = @st, signer_session_expires_at = @exp,
         otp_verified_at = SYSUTCDATETIME(), status = N'accessed', last_accessed_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: requestId, st: sessionToken, exp: sessionExp.toISOString() }
    );
    res.json({ sessionToken, signingMode: 'legacy', documentMime: getRow(row, 'document_mime') });
  } catch (err) {
    next(err);
  }
});

router.get('/public/:token/document', async (req, res, next) => {
  try {
    const sessionToken = (req.query.session || '').toString().trim();
    const resolved = await resolveByToken(req.params.token);
    if (!resolved) return res.status(401).json({ error: 'Invalid session' });

    let rel;
    let mime;
    let name;
    let requestId;

    if (resolved.mode === 'recipient') {
      const { recipient, request } = resolved;
      if (!isRecipientSessionValid(recipient, sessionToken)) {
        return res.status(401).json({ error: 'Session expired. Enter your PIN again.' });
      }
      requestId = getRow(request, 'request_id') || getRow(request, 'id');
      rel = getWorkingDocumentRel(request);
      mime = getRow(request, 'document_mime');
      name = getRow(request, 'document_original_name');
      await logEvent(requestId, 'document_viewed', req, null, getRow(recipient, 'id'));
    } else {
      const row = resolved.request;
      if (!isLegacySessionValid(row, sessionToken)) return res.status(401).json({ error: 'Session expired' });
      requestId = getRow(row, 'id');
      rel = getRow(row, 'document_original_path');
      mime = getRow(row, 'document_mime');
      name = getRow(row, 'document_original_name');
    }

    const full = safeResolveStored(rel);
    if (!full) return res.status(404).json({ error: 'Document not found' });
    await query(`UPDATE quick_sign_requests SET last_accessed_at = SYSUTCDATETIME() WHERE id = @id`, { id: requestId });
    res.setHeader('Content-Type', mime || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name || 'document')}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/public/:token/placements', async (req, res, next) => {
  try {
    const sessionToken = (req.query.session || '').toString().trim();
    const resolved = await resolveByToken(req.params.token);
    if (!resolved || resolved.mode !== 'recipient') return res.json({ placements: [] });
    const { recipient, request } = resolved;
    if (!isRecipientSessionValid(recipient, sessionToken)) return res.status(401).json({ error: 'Session expired' });
    const requestId = getRow(request, 'request_id') || getRow(request, 'id');
    const all = await query(
      `SELECT p.page_index, p.x_pct, p.y_pct, p.width_pct, p.height_pct, p.placement_type, r.full_name AS signer_name
       FROM quick_sign_placements p
       JOIN quick_sign_recipients r ON r.id = p.recipient_id
       WHERE p.request_id = @id ORDER BY p.created_at`,
      { id: requestId }
    );
    res.json({ placements: all.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/public/:token/complete', async (req, res, next) => {
  try {
    const sessionToken = (req.body?.sessionToken || '').toString().trim();
    const { id_number: idNumber, latitude, longitude, accuracy, signatureDataUrl, placements } = req.body || {};
    const resolved = await resolveByToken(req.params.token);
    if (!resolved) return res.status(401).json({ error: 'Invalid session' });

    const idStr = String(idNumber || '').trim().replace(/\s/g, '');
    if (idStr.length < 6) return res.status(400).json({ error: 'A valid ID number is required' });
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Location must be enabled to sign' });
    }
    if (!signatureDataUrl?.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Draw your signature first' });
    }

    if (resolved.mode === 'recipient') {
      const { recipient, request } = resolved;
      if (!isRecipientSessionValid(recipient, sessionToken)) return res.status(401).json({ error: 'Session expired' });
      if (getRow(recipient, 'status') === 'signed') return res.status(400).json({ error: 'Already signed' });

      const requestId = getRow(request, 'request_id') || getRow(request, 'id');
      const tenantId = getRow(request, 'tenant_id');
      const placementList = Array.isArray(placements) ? placements : [];
      if (placementList.length === 0) {
        return res.status(400).json({ error: 'Place at least one signature or initial on the document' });
      }

      await applySignerPlacements(requestId, getRow(recipient, 'id'), tenantId, signatureDataUrl, placementList, {
        idNumber: idStr,
        latitude: lat,
        longitude: lng,
        accuracy: Number(accuracy) || null,
      });

      await logEvent(requestId, 'signed', req, { placements: placementList.length }, getRow(recipient, 'id'));
      await emailSignedCopy(req, request, getRow(recipient, 'email'), getRow(recipient, 'full_name'));

      return res.json({ ok: true, message: 'Your signature has been applied to the document. A copy was sent to your email.' });
    }

    // Legacy single-recipient complete
    const row = resolved.request;
    if (!isLegacySessionValid(row, sessionToken)) return res.status(401).json({ error: 'Session expired' });
    if (getRow(row, 'status') === 'signed') return res.status(400).json({ error: 'Already signed' });

    const requestId = getRow(row, 'id');
    const tenantId = getRow(row, 'tenant_id');
    const { full: sigFull, rel: sigRel } = await (async () => {
      const sigDir = path.join(uploadsRoot, String(tenantId), 'signatures');
      fs.mkdirSync(sigDir, { recursive: true });
      const sigFile = `${randomBytes(16).toString('hex')}.png`;
      const sigFullPath = path.join(sigDir, sigFile);
      const b64 = String(signatureDataUrl).replace(/^data:image\/\w+;base64,/, '');
      await fs.promises.writeFile(sigFullPath, Buffer.from(b64, 'base64'));
      return { full: sigFullPath, rel: path.relative(process.cwd(), sigFullPath).split(path.sep).join('/') };
    })();

    const signedDir = path.join(uploadsRoot, String(tenantId), 'signed');
    fs.mkdirSync(signedDir, { recursive: true });
    const signedFull = path.join(signedDir, `${randomBytes(16).toString('hex')}.pdf`);
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
      `UPDATE quick_sign_requests SET status = N'signed', signed_at = @signedAt,
         signer_id_number = @idNum, signer_latitude = @lat, signer_longitude = @lng,
         signer_location_accuracy = @acc, signer_location_captured_at = @signedAt,
         signature_image_path = @sigPath, document_signed_path = @signedPath,
         signer_session_token = NULL, signer_session_expires_at = NULL, updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      {
        id: requestId,
        signedAt: signedAt.toISOString(),
        idNum: idStr,
        lat,
        lng,
        acc: Number(accuracy) || null,
        sigPath: sigRel,
        signedPath: signedRel,
      }
    );
    await logEvent(requestId, 'signed', req);
    return res.json({ ok: true, message: 'Document signed successfully.' });
  } catch (err) {
    next(err);
  }
});

// --- Authenticated ---

const authRouter = Router();
authRouter.use(requireAuth);
authRouter.use(loadUser);
authRouter.use(requirePageAccess('quick_sign'));

authRouter.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT r.*, u.full_name AS sender_name FROM quick_sign_requests r
       LEFT JOIN users u ON u.id = r.created_by_user_id
       WHERE r.tenant_id = @tenantId ORDER BY r.created_at DESC`,
      { tenantId }
    );
    const out = [];
    for (const row of result.recordset || []) {
      const recs = await loadRecipients(getRow(row, 'id'));
      out.push(mapRequest(row, recs));
    }
    res.json({ requests: out });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const result = await query(
      `SELECT r.*, u.full_name AS sender_name, u.email AS sender_email
       FROM quick_sign_requests r LEFT JOIN users u ON u.id = r.created_by_user_id
       WHERE r.id = @id AND r.tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const recipients = await loadRecipients(req.params.id);
    const events = await query(
      `SELECT id, event_type, metadata_json, created_at FROM quick_sign_events WHERE request_id = @id ORDER BY created_at ASC`,
      { id: req.params.id }
    );
    const placements = await query(
      `SELECT p.*, r.full_name AS signer_name, r.email AS signer_email
       FROM quick_sign_placements p JOIN quick_sign_recipients r ON r.id = p.recipient_id
       WHERE p.request_id = @id ORDER BY p.page_index, p.created_at`,
      { id: req.params.id }
    );
    res.json({
      request: { ...mapRequest(row, recipients), notes: getRow(row, 'notes'), allow_sender_sign: !!getRow(row, 'allow_sender_sign') },
      recipients: recipients.map((r) => ({
        id: getRow(r, 'id'),
        email: getRow(r, 'email'),
        full_name: getRow(r, 'full_name'),
        status: getRow(r, 'status'),
        signed_at: getRow(r, 'signed_at'),
        sign_order: getRow(r, 'sign_order'),
        is_sender: !!getRow(r, 'is_sender'),
        access_token: getRow(r, 'access_token'),
      })),
      placements: placements.recordset || [],
      events: events.recordset || [],
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/', (req, res, next) => {
  docUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      if (!req.file) return res.status(400).json({ error: 'Document required' });
      const tenantId = req.user.tenant_id;
      const title = String(req.body?.title || req.file.originalname).trim();
      const notes = req.body?.notes ? String(req.body.notes).trim() : null;
      const allowSenderSign = req.body?.allow_sender_sign === 'true' || req.body?.allow_sender_sign === true;
      const recipientList = parseRecipientsBody(req.body);
      const mime = (req.file.mimetype || '').toLowerCase();
      const isPdf = mime === 'application/pdf';

      if (recipientList.length === 0) {
        return res.status(400).json({ error: 'Add at least one signer email' });
      }
      if (!isPdf) {
        return res.status(400).json({ error: 'On-document signing requires a PDF file' });
      }

      const rel = path.relative(process.cwd(), req.file.path).split(path.sep).join('/');
      const pageCount = await getPdfPageCount(req.file.path);
      const accessToken = randomBytes(32).toString('hex');

      const ins = await query(
        `INSERT INTO quick_sign_requests (
           tenant_id, title, notes, status, signing_mode, allow_sender_sign, page_count,
           document_original_name, document_original_path, document_mime, access_token, created_by_user_id,
           recipient_email, recipient_name
         ) OUTPUT INSERTED.id VALUES (
           @tenantId, @title, @notes, N'draft', N'on_document', @allowSender, @pc,
           @origName, @path, @mime, @token, @userId, @e1, @n1
         )`,
        {
          tenantId,
          title,
          notes,
          allowSender: allowSenderSign ? 1 : 0,
          pc: pageCount,
          origName: req.file.originalname,
          path: rel,
          mime: req.file.mimetype,
          token: accessToken,
          userId: req.user.id,
          e1: recipientList[0]?.email || '',
          n1: recipientList[0]?.name || '',
        }
      );
      const requestId = getRow(ins.recordset?.[0], 'id');
      let order = 0;
      for (const rec of recipientList) {
        const email = String(rec.email || '').trim().toLowerCase();
        if (!email) continue;
        await query(
          `INSERT INTO quick_sign_recipients (request_id, tenant_id, email, full_name, recipient_type, sign_order, access_token, status)
           VALUES (@requestId, @tenantId, @email, @name, N'external', @ord, @tok, N'pending')`,
          {
            requestId,
            tenantId,
            email,
            name: rec.name ? String(rec.name).trim() : null,
            ord: order++,
            tok: randomBytes(32).toString('hex'),
          }
        );
      }
      if (allowSenderSign) {
        await query(
          `INSERT INTO quick_sign_recipients (request_id, tenant_id, email, full_name, recipient_type, sign_order, access_token, status, is_sender)
           VALUES (@requestId, @tenantId, @email, @name, N'internal', @ord, @tok, N'pending', 1)`,
          {
            requestId,
            tenantId,
            email: req.user.email,
            name: req.user.full_name,
            ord: order++,
            tok: randomBytes(32).toString('hex'),
          }
        );
      }
      await logEvent(requestId, 'created', req, { signers: recipientList.length });
      const recs = await loadRecipients(requestId);
      res.status(201).json({ request: mapRequest({ id: requestId, title, status: 'draft', signing_mode: 'on_document' }, recs) });
    } catch (err) {
      next(err);
    }
  });
});

authRouter.post('/:id/send', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const row = (await query(`SELECT * FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId })).recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (getRow(row, 'status') !== 'draft') return res.status(400).json({ error: 'Only drafts can be sent' });
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email not configured' });

    await ensureWorkingPdf(id, tenantId);
    const linkExp = new Date(Date.now() + LINK_TTL_MS);
    await query(
      `UPDATE quick_sign_requests SET status = N'sent', link_expires_at = @exp, sent_at = SYSUTCDATETIME() WHERE id = @id`,
      { id, exp: linkExp.toISOString() }
    );
    const recipients = await loadRecipients(id);
    row.link_expires_at = linkExp;
    row.sender_name = req.user.full_name;
    await sendRecipientInvites(req, id, row, recipients);
    await logEvent(id, 'sent', req, { count: recipients.length });
    res.json({ ok: true, message: 'Invitations sent' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id/document', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const kind = (req.query.kind || 'working').toString();
    const row = (await query(
      `SELECT document_original_path, document_working_path, document_signed_path, document_original_name, document_mime
       FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    )).recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    let rel = getRow(row, 'document_working_path') || getRow(row, 'document_original_path');
    if (kind === 'original') rel = getRow(row, 'document_original_path');
    if (kind === 'signed') rel = getRow(row, 'document_signed_path') || getRow(row, 'document_working_path');
    const full = safeResolveStored(rel);
    if (!full) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', getRow(row, 'document_mime') || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(getRow(row, 'document_original_name') || 'doc.pdf')}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id/placements', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const all = await query(
      `SELECT p.page_index, p.x_pct, p.y_pct, p.width_pct, p.height_pct, p.placement_type, r.full_name AS signer_name, r.email
       FROM quick_sign_placements p JOIN quick_sign_recipients r ON r.id = p.recipient_id
       WHERE p.request_id = @id AND EXISTS (SELECT 1 FROM quick_sign_requests req WHERE req.id = @id AND req.tenant_id = @tenantId)`,
      { id: req.params.id, tenantId }
    );
    res.json({ placements: all.recordset || [] });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/:id/sender-sign', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;
    const { id_number, latitude, longitude, accuracy, signatureDataUrl, placements } = req.body || {};
    const row = (await query(`SELECT * FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId })).recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!getRow(row, 'allow_sender_sign')) return res.status(400).json({ error: 'Sender signing not enabled' });

    let senderRec = (await query(
      `SELECT id FROM quick_sign_recipients WHERE request_id = @id AND is_sender = 1`,
      { id }
    )).recordset?.[0];
    if (!senderRec) {
      const ins = await query(
        `INSERT INTO quick_sign_recipients (request_id, tenant_id, email, full_name, access_token, status, is_sender, sign_order)
         OUTPUT INSERTED.id VALUES (@id, @tenantId, @email, @name, @tok, N'pending', 1, 999)`,
        { id, tenantId, email: req.user.email, name: req.user.full_name, tok: randomBytes(32).toString('hex') }
      );
      senderRec = ins.recordset?.[0];
    }
    const recipientId = getRow(senderRec, 'id');
    const placementList = Array.isArray(placements) ? placements : [];
    if (placementList.length === 0) return res.status(400).json({ error: 'Place signature on document' });

    await applySignerPlacements(id, recipientId, tenantId, signatureDataUrl, placementList, {
      idNumber: String(id_number || '').trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: Number(accuracy) || null,
    });
    await logEvent(id, 'sender_signed', req);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/tenant-users', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND status = N'active' ORDER BY full_name`,
      { tenantId: req.user.tenant_id }
    );
    res.json({ users: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/:id/signature-image', async (req, res, next) => {
  try {
    const row = (await query(
      `SELECT signature_image_path FROM quick_sign_requests WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId: req.user.tenant_id }
    )).recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const full = safeResolveStored(getRow(row, 'signature_image_path'));
    if (!full) return res.status(404).json({ error: 'Signature not found' });
    res.setHeader('Content-Type', 'image/png');
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    await query(
      `UPDATE quick_sign_requests SET status = N'cancelled', updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId: req.user.tenant_id }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.use(authRouter);
export default router;
