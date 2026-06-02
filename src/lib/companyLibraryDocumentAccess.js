import crypto from 'crypto';
import { query } from '../db.js';

const LIVE_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;

function get(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

export async function getLiveSession(tenantId, documentId, userId) {
  const th = null;
  try {
    const r = await query(
      `SELECT TOP 1 id, expires_at FROM company_library_attachment_sessions
       WHERE tenant_id = @t AND document_id = @did AND user_id = @uid AND expires_at > SYSUTCDATETIME()
       ORDER BY created_at DESC`,
      { t: tenantId, did: documentId, uid: userId }
    );
    return r.recordset?.[0] || null;
  } catch {
    return null;
  }
}

export async function createLiveSession(tenantId, documentId, userId) {
  await query(
    `DELETE FROM company_library_attachment_sessions WHERE document_id = @did AND user_id = @uid`,
    { did: documentId, uid: userId }
  ).catch(() => {});
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const th = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const exp = new Date(Date.now() + LIVE_ACCESS_TTL_MS);
  await query(
    `INSERT INTO company_library_attachment_sessions (tenant_id, document_id, user_id, token_hash, expires_at)
     VALUES (@t, @did, @uid, @th, @exp)`,
    { t: tenantId, did: documentId, uid: userId, th, exp }
  );
  return { sessionToken, expiresAt: exp.toISOString() };
}

export async function revokeAllLiveSessions(documentId) {
  await query(`DELETE FROM company_library_attachment_sessions WHERE document_id = @did`, { did: documentId }).catch(
    () => {}
  );
}

export async function verifySessionToken(tenantId, documentId, userId, token) {
  if (!token) return false;
  const th = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
  const r = await query(
    `SELECT TOP 1 id FROM company_library_attachment_sessions
     WHERE document_id = @did AND user_id = @uid AND tenant_id = @t AND token_hash = @th AND expires_at > SYSUTCDATETIME()`,
    { did: documentId, uid: userId, t: tenantId, th }
  );
  return !!r.recordset?.[0];
}

export function mapDocumentAccess(doc, ctx) {
  const isPrivate = !!get(doc, 'is_pin_protected');
  const isLocked = get(doc, 'is_access_locked') !== 0 && get(doc, 'is_access_locked') !== false;
  const isOwner = String(get(doc, 'uploaded_by')) === String(ctx.userId);
  const isSuper = ctx.role === 'super_admin';
  const hasLive = !!ctx.liveSession;
  const isPublic = !isPrivate;

  let canView = isSuper || isOwner || isPublic || (isPrivate && hasLive);
  let canEmail = canView;
  const canDownload = isSuper;

  return {
    is_private: isPrivate,
    is_public: isPublic,
    is_locked: isPrivate && isLocked,
    is_owner: isOwner,
    has_live_access: hasLive,
    can_view: canView,
    can_email: canEmail,
    can_download: canDownload,
    needs_access_request: isPrivate && !isOwner && !isSuper && !hasLive,
  };
}

export async function enrichDocumentAccess(doc, req) {
  const tenantId = req.user.tenant_id;
  const id = get(doc, 'id');
  const live = await getLiveSession(tenantId, id, req.user.id);
  const access = mapDocumentAccess(doc, {
    userId: req.user.id,
    role: req.user.role,
    liveSession: live,
  });
  return { ...doc, ...access, live_access_expires_at: live ? get(live, 'expires_at') : null };
}

export function scoreDocumentSearch(doc, q) {
  const terms = String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!terms.length) return 0;
  const hay = [
    get(doc, 'display_title'),
    get(doc, 'file_name'),
    get(doc, 'ai_summary'),
    get(doc, 'uploader_name'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (hay.includes(t)) score += 10;
    if (String(get(doc, 'display_title') || '').toLowerCase().includes(t)) score += 25;
    if (String(get(doc, 'ai_summary') || '').toLowerCase().includes(t)) score += 15;
  }
  return score;
}
