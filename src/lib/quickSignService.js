/**
 * Quick Sign business logic: multi-signer, on-document PDF stamping.
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { queryWithGuids } from './queryWithGuids.js';
import { sendEmail, isEmailConfigured } from './emailService.js';
import { quickSignInviteHtml, quickSignSignedCopyHtml } from './emailTemplates.js';
import { stampSignaturesOnPdf, getPdfPageCount, copyPdfFile } from './quickSignPdfStamp.js';

const qsQuery = queryWithGuids;

const BCRYPT_ROUNDS = 10;
const uploadsRoot = path.join(process.cwd(), 'uploads', 'quick-sign');

export function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

export function safeResolveStored(relPath) {
  if (!relPath) return null;
  const full = path.join(process.cwd(), String(relPath).replace(/^[/\\]+/, ''));
  const root = uploadsRoot;
  if (!full.startsWith(root)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function appBaseUrl(req) {
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

export async function logEvent(requestId, eventType, req, metadata = null, recipientId = null) {
  const meta = metadata != null ? JSON.stringify(metadata) : null;
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() || null;
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 500) || null;
  await qsQuery(
    `INSERT INTO quick_sign_events (request_id, event_type, ip_address, user_agent, metadata_json)
     VALUES (@requestId, @eventType, @ip, @ua, @meta)`,
    { requestId, eventType, ip, ua, meta }
  ).catch((e) => console.error('[quick-sign] audit', e?.message));
}

/** Resolve public token to recipient (v2) or legacy request row. */
export async function resolveByToken(token) {
  const t = (token || '').trim();
  if (!t) return null;

  const rec = await qsQuery(
    `SELECT r.*, req.id AS request_id, req.tenant_id, req.title, req.notes, req.status AS request_status,
            req.document_original_name, req.document_original_path, req.document_working_path, req.document_signed_path,
            req.document_mime, req.signing_mode, req.allow_sender_sign, req.page_count, req.link_expires_at,
            req.created_by_user_id, u.full_name AS sender_name, u.email AS sender_email
     FROM quick_sign_recipients r
     JOIN quick_sign_requests req ON req.id = r.request_id
     LEFT JOIN users u ON u.id = req.created_by_user_id
     WHERE r.access_token = @token`,
    { token: t }
  );
  if (rec.recordset?.[0]) {
    return { mode: 'recipient', recipient: rec.recordset[0], request: rec.recordset[0] };
  }

  const leg = await qsQuery(
    `SELECT r.*, u.full_name AS sender_name, u.email AS sender_email
     FROM quick_sign_requests r
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE r.access_token = @token`,
    { token: t }
  );
  if (leg.recordset?.[0]) {
    return { mode: 'legacy', request: leg.recordset[0], recipient: null };
  }
  return null;
}

export function isLinkExpired(row) {
  const exp = getRow(row, 'link_expires_at');
  if (!exp) return false;
  return new Date(exp).getTime() < Date.now();
}

export function isRecipientSessionValid(recipient, sessionToken) {
  const st = getRow(recipient, 'signer_session_token');
  const exp = getRow(recipient, 'signer_session_expires_at');
  if (!st || !sessionToken || st !== sessionToken) return false;
  if (!exp || new Date(exp).getTime() < Date.now()) return false;
  return true;
}

export function isLegacySessionValid(row, sessionToken) {
  const st = getRow(row, 'signer_session_token');
  const exp = getRow(row, 'signer_session_expires_at');
  if (!st || !sessionToken || st !== sessionToken) return false;
  if (!exp || new Date(exp).getTime() < Date.now()) return false;
  return true;
}

export function getWorkingDocumentRel(request) {
  return getRow(request, 'document_working_path') || getRow(request, 'document_original_path');
}

export async function ensureWorkingPdf(requestId, tenantId) {
  const r = await qsQuery(
    `SELECT document_original_path, document_working_path, document_mime FROM quick_sign_requests WHERE id = @id`,
    { id: requestId }
  );
  const row = r.recordset?.[0];
  if (!row) return null;
  const mime = (getRow(row, 'document_mime') || '').toLowerCase();
  if (mime !== 'application/pdf') return null;

  const orig = safeResolveStored(getRow(row, 'document_original_path'));
  if (!orig) return null;

  let workingRel = getRow(row, 'document_working_path');
  if (!workingRel) {
    const workingDir = path.join(uploadsRoot, String(tenantId), 'working');
    fs.mkdirSync(workingDir, { recursive: true });
    const workingFile = `${randomBytes(16).toString('hex')}.pdf`;
    const workingFull = path.join(workingDir, workingFile);
    await copyPdfFile(orig, workingFull);
    workingRel = path.relative(process.cwd(), workingFull).split(path.sep).join('/');
    const pageCount = await getPdfPageCount(workingFull);
    await qsQuery(
      `UPDATE quick_sign_requests SET document_working_path = @wp, page_count = @pc, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: requestId, wp: workingRel, pc: pageCount }
    );
  }
  return workingRel;
}

export async function loadRecipients(requestId) {
  const r = await qsQuery(
    `SELECT id, email, full_name, recipient_type, sign_order, status, signed_at, is_sender, access_token
     FROM quick_sign_recipients WHERE request_id = @id ORDER BY sign_order ASC, created_at ASC`,
    { id: requestId }
  );
  return r.recordset || [];
}

export async function refreshRequestStatus(requestId) {
  const recs = await loadRecipients(requestId);
  const req = await qsQuery(`SELECT allow_sender_sign, signing_mode FROM quick_sign_requests WHERE id = @id`, { id: requestId });
  const allowSender = !!getRow(req.recordset?.[0], 'allow_sender_sign');
  const allRequired = recs.filter((r) => !getRow(r, 'is_sender') || allowSender);
  const signedCount = allRequired.filter((r) => getRow(r, 'status') === 'signed').length;
  let status = 'in_progress';
  if (signedCount === 0) status = 'sent';
  else if (signedCount >= allRequired.length && allRequired.length > 0) status = 'completed';
  else status = 'in_progress';

  await qsQuery(
    `UPDATE quick_sign_requests SET status = @status, updated_at = SYSUTCDATETIME(),
       document_signed_path = CASE WHEN @status = N'completed' THEN document_working_path ELSE document_signed_path END
     WHERE id = @id`,
    { id: requestId, status }
  );
}

export async function saveSignatureImage(tenantId, dataUrl) {
  const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
  const sigDir = path.join(uploadsRoot, String(tenantId), 'signatures');
  fs.mkdirSync(sigDir, { recursive: true });
  const sigFile = `${randomBytes(16).toString('hex')}.png`;
  const sigFull = path.join(sigDir, sigFile);
  await fs.promises.writeFile(sigFull, Buffer.from(b64, 'base64'));
  return { full: sigFull, rel: path.relative(process.cwd(), sigFull).split(path.sep).join('/') };
}

/**
 * Apply placements for one signer onto working PDF.
 * @param placements [{ page_index, type, x_pct, y_pct, width_pct, height_pct }]
 */
export async function applySignerPlacements(requestId, recipientId, tenantId, signatureDataUrl, placements, meta) {
  const workingRel = await ensureWorkingPdf(requestId, tenantId);
  if (!workingRel) throw new Error('On-document signing requires a PDF document');

  const workingFull = safeResolveStored(workingRel);
  const { full: sigFull, rel: sigRel } = await saveSignatureImage(tenantId, signatureDataUrl);

  const stampList = [];
  for (const p of placements || []) {
    const placementId = randomBytes(16).toString('hex');
    await qsQuery(
      `INSERT INTO quick_sign_placements (request_id, recipient_id, placement_type, page_index, x_pct, y_pct, width_pct, height_pct, image_path)
       VALUES (@requestId, @recipientId, @type, @page, @x, @y, @w, @h, @img)`,
      {
        requestId,
        recipientId,
        type: p.type === 'initial' ? 'initial' : 'signature',
        page: Number(p.page_index) || 0,
        x: Number(p.x_pct) || 0,
        y: Number(p.y_pct) || 0,
        w: Number(p.width_pct) || 0.2,
        h: Number(p.height_pct) || 0.08,
        img: sigRel,
      }
    );
    stampList.push({
      pageIndex: Number(p.page_index) || 0,
      xPct: Number(p.x_pct) || 0,
      yPct: Number(p.y_pct) || 0,
      widthPct: Number(p.width_pct) || 0.2,
      heightPct: Number(p.height_pct) || 0.08,
      imagePath: sigFull,
    });
  }

  if (stampList.length === 0) {
    stampList.push({
      pageIndex: 0,
      xPct: 0.55,
      yPct: 0.85,
      widthPct: 0.25,
      heightPct: 0.08,
      imagePath: sigFull,
    });
  }

  const allPlacements = await qsQuery(
    `SELECT page_index, x_pct, y_pct, width_pct, height_pct, image_path
     FROM quick_sign_placements WHERE request_id = @id ORDER BY created_at`,
    { id: requestId }
  );
  const rebuildList = (allPlacements.recordset || []).map((row) => ({
    pageIndex: getRow(row, 'page_index'),
    xPct: getRow(row, 'x_pct'),
    yPct: getRow(row, 'y_pct'),
    widthPct: getRow(row, 'width_pct'),
    heightPct: getRow(row, 'height_pct'),
    imagePath: safeResolveStored(getRow(row, 'image_path')),
  })).filter((x) => x.imagePath);

  const origRel = (await qsQuery(`SELECT document_original_path FROM quick_sign_requests WHERE id = @id`, { id: requestId })).recordset?.[0];
  const origFull = safeResolveStored(getRow(origRel, 'document_original_path'));
  const tmpOut = path.join(uploadsRoot, String(tenantId), 'working', `${randomBytes(8).toString('hex')}.pdf`);
  await stampSignaturesOnPdf(origFull, tmpOut, rebuildList);
  await fs.promises.copyFile(tmpOut, workingFull);
  try { fs.unlinkSync(tmpOut); } catch (_) {}

  const signedAt = new Date();
  await qsQuery(
    `UPDATE quick_sign_recipients SET
       status = N'signed', signed_at = @signedAt,
       signer_id_number = @idNum,
       signer_latitude = @lat, signer_longitude = @lng,
       signer_location_accuracy = @acc,
       signer_location_captured_at = @signedAt,
       signer_session_token = NULL, signer_session_expires_at = NULL,
       updated_at = SYSUTCDATETIME()
     WHERE id = @recipientId`,
    {
      recipientId,
      signedAt: signedAt.toISOString(),
      idNum: meta.idNumber,
      lat: meta.latitude,
      lng: meta.longitude,
      acc: meta.accuracy,
    }
  );

  await refreshRequestStatus(requestId);
  return { workingFull, signedAt };
}

export async function emailSignedCopy(req, requestRow, recipientEmail, recipientName) {
  if (!isEmailConfigured() || !recipientEmail) return;
  const workingRel = getWorkingDocumentRel(requestRow);
  const full = safeResolveStored(workingRel);
  if (!full) return;
  const html = quickSignSignedCopyHtml({
    recipientName,
    documentTitle: getRow(requestRow, 'title'),
    appUrl: `${appBaseUrl(req)}/quick-sign`,
  });
  const buf = await fs.promises.readFile(full);
  await sendEmail({
    to: recipientEmail,
    subject: `Your signed copy: ${getRow(requestRow, 'title')}`,
    body: html,
    html: true,
    attachments: [{
      filename: `signed-${getRow(requestRow, 'document_original_name') || 'document.pdf'}`,
      content: buf.toString('base64'),
      encoding: 'base64',
    }],
  }).catch((e) => console.error('[quick-sign] signed copy email:', e?.message));
}

export async function sendRecipientInvites(req, requestId, requestRow, recipients) {
  if (!isEmailConfigured()) return;
  const linkExp = getRow(requestRow, 'link_expires_at');
  for (const rec of recipients) {
    if (getRow(rec, 'is_sender')) continue;
    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
    const otpExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await qsQuery(
      `UPDATE quick_sign_recipients SET otp_hash = @hash, otp_expires_at = @exp, status = N'sent', updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: getRow(rec, 'id'), hash: otpHash, exp: otpExp.toISOString() }
    );
    const signLink = `${appBaseUrl(req)}/quick-sign/${getRow(rec, 'access_token')}`;
    const html = quickSignInviteHtml({
      recipientName: getRow(rec, 'full_name'),
      documentTitle: getRow(requestRow, 'title'),
      signLink,
      otp,
      senderName: getRow(requestRow, 'sender_name') || req.user?.full_name,
      expiresAt: linkExp,
    });
    await sendEmail({
      to: getRow(rec, 'email'),
      subject: `Sign document: ${getRow(requestRow, 'title')} – Thinkers Quick Sign`,
      body: html,
      html: true,
    }).catch((e) => console.error('[quick-sign] invite email:', e?.message));
  }
}

export { BCRYPT_ROUNDS, uploadsRoot };
