/**
 * Letter composition — draft corporate letters with custom sections, signatures,
 * selectable PDF templates, policy references, email delivery (with arbitrary CC),
 * and export to Quick Sign.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID, randomBytes } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { loadAccountingCompanyBranding } from '../lib/accountingCompanyBranding.js';
import { buildLetterPdfBuffer, mapLetterRow } from '../lib/letterPdf.js';
import { LETTER_TYPE_IDS, LETTER_TEMPLATE_IDS, letterTypeLabel } from '../lib/letterTypes.js';
import { getPdfPageCount } from '../lib/quickSignPdfStamp.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

const router = Router();
router.use(requireAuth, loadUser, requirePageAccess('letters'));

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : null;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function isSuperAdmin(req) {
  return req.user?.role === 'super_admin';
}

async function nextReference(tenant) {
  const r = await query(
    `MERGE letter_ref_counter AS t
     USING (SELECT @t AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { t: tenant }
  );
  const n = r.recordset?.[0]?.last_number ?? r.recordset?.[0]?.Last_number ?? 1;
  const year = new Date().getFullYear();
  return `LET-${year}-${String(n).padStart(4, '0')}`;
}

async function loadLetterFull(tenant, id) {
  const lr = await query(
    `SELECT l.*, cr.full_name AS created_by_name
     FROM letters l LEFT JOIN users cr ON cr.id = l.created_by_user_id
     WHERE l.id = @id AND l.tenant_id = @t`,
    { id, t: tenant }
  );
  const row = lr.recordset?.[0];
  if (!row) return null;
  const letter = mapLetterRow(row);
  letter.created_by_name = get(row, 'created_by_name');
  const sr = await query(`SELECT * FROM letter_sections WHERE letter_id = @id ORDER BY sort_order`, { id });
  letter.sections = (sr.recordset || []).map((s) => ({
    id: get(s, 'id'),
    heading: get(s, 'heading') || '',
    body: get(s, 'body') || '',
    sort_order: get(s, 'sort_order') ?? 0,
  }));
  return letter;
}

function normType(t) {
  return LETTER_TYPE_IDS.includes(String(t)) ? String(t) : 'generic';
}
function normTemplate(t) {
  return LETTER_TEMPLATE_IDS.includes(String(t)) ? String(t) : 'executive';
}

/** Letters are private to their creator; super admins see all letters in the tenant. */
function canSeeLetter(req, creatorId) {
  return isSuperAdmin(req) || String(creatorId) === String(req.user.id);
}

// ——— List ———
router.get('/', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const type = req.query.type ? normType(req.query.type) : null;
    const mineOnly = !isSuperAdmin(req);
    const params = { t };
    if (type) params.type = type;
    if (mineOnly) params.uid = req.user.id;
    const rows = await query(
      `SELECT l.id, l.reference_number, l.letter_type, l.title, l.status, l.template_key,
              l.recipient_name, l.recipient_company, l.letter_date, l.created_by_user_id,
              l.created_at, l.updated_at, cr.full_name AS created_by_name
       FROM letters l LEFT JOIN users cr ON cr.id = l.created_by_user_id
       WHERE l.tenant_id = @t ${type ? 'AND l.letter_type = @type' : ''}${mineOnly ? ' AND l.created_by_user_id = @uid' : ''}
       ORDER BY l.updated_at DESC`,
      params
    );
    res.json({ letters: (rows.recordset || []).map((r) => ({
      id: get(r, 'id'),
      reference_number: get(r, 'reference_number'),
      letter_type: get(r, 'letter_type'),
      title: get(r, 'title'),
      status: get(r, 'status'),
      template_key: get(r, 'template_key'),
      recipient_name: get(r, 'recipient_name'),
      recipient_company: get(r, 'recipient_company'),
      letter_date: get(r, 'letter_date'),
      created_by_user_id: get(r, 'created_by_user_id'),
      created_by_name: get(r, 'created_by_name'),
      created_at: get(r, 'created_at'),
      updated_at: get(r, 'updated_at'),
    })) });
  } catch (err) {
    next(err);
  }
});

// ——— Published policies (for warning letter referencing) ———
router.get('/meta/policies', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const rows = await query(
      `SELECT id, reference_number, title FROM company_policies
       WHERE tenant_id = @t AND status = N'published' ORDER BY updated_at DESC`,
      { t }
    );
    res.json({ policies: (rows.recordset || []).map((r) => ({
      id: get(r, 'id'),
      reference_number: get(r, 'reference_number'),
      title: get(r, 'title'),
    })) });
  } catch (err) {
    next(err);
  }
});

// ——— Starter templates ———
router.get('/templates', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const type = req.query.type ? normType(req.query.type) : null;
    const rows = await query(
      `SELECT id, tenant_id, letter_type, template_name, description, intro_body, sections_json, closing_text, is_system, sort_order
       FROM letter_templates
       WHERE (tenant_id IS NULL OR tenant_id = @t) ${type ? 'AND letter_type = @type' : ''}
       ORDER BY letter_type, sort_order, template_name`,
      type ? { t, type } : { t }
    );
    res.json({ templates: (rows.recordset || []).map((r) => ({
      id: get(r, 'id'),
      letter_type: get(r, 'letter_type'),
      template_name: get(r, 'template_name'),
      description: get(r, 'description'),
      intro_body: get(r, 'intro_body'),
      sections: (() => { try { return JSON.parse(get(r, 'sections_json') || '[]'); } catch { return []; } })(),
      closing_text: get(r, 'closing_text'),
      is_system: !!get(r, 'is_system'),
    })) });
  } catch (err) {
    next(err);
  }
});

// ——— Get one ———
router.get('/:id', async (req, res, next) => {
  try {
    const letter = await loadLetterFull(tenantId(req), req.params.id);
    if (!letter || !canSeeLetter(req, letter.created_by_user_id)) {
      return res.status(404).json({ error: 'Letter not found' });
    }
    res.json({ letter });
  } catch (err) {
    next(err);
  }
});

// ——— Create ———
router.post('/', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    const id = randomUUID();
    const reference = await nextReference(t);
    await query(
      `INSERT INTO letters (
         id, tenant_id, reference_number, letter_type, title, status, template_key, accent_color,
         recipient_name, recipient_title, recipient_company, recipient_address, recipient_email,
         letter_date, reference_line, intro_body, closing_text, signatory_name, signatory_title,
         signature_data_url, policy_refs, created_by_user_id, updated_by_user_id
       ) VALUES (
         @id, @t, @ref, @type, @title, N'draft', @tpl, @accent,
         @rn, @rt, @rc, @ra, @re,
         @date, @refline, @intro, @closing, @sn, @st,
         @sig, @prefs, @uid, @uid
       )`,
      {
        id,
        t,
        ref: reference,
        type: normType(b.letter_type),
        title: String(b.title || 'Untitled letter').slice(0, 500),
        tpl: normTemplate(b.template_key),
        accent: b.accent_color || null,
        rn: b.recipient_name || null,
        rt: b.recipient_title || null,
        rc: b.recipient_company || null,
        ra: b.recipient_address || null,
        re: b.recipient_email || null,
        date: b.letter_date || null,
        refline: b.reference_line || null,
        intro: b.intro_body || null,
        closing: b.closing_text || null,
        sn: b.signatory_name || req.user.full_name || null,
        st: b.signatory_title || null,
        sig: b.signature_data_url || null,
        prefs: b.policy_refs ? JSON.stringify(b.policy_refs) : null,
        uid: req.user.id,
      }
    );
    if (Array.isArray(b.sections) && b.sections.length) {
      await replaceSections(id, b.sections);
    }
    const letter = await loadLetterFull(t, id);
    res.status(201).json({ letter });
  } catch (err) {
    next(err);
  }
});

const UPDATABLE = {
  title: 'title', letter_type: 'letter_type', template_key: 'template_key', accent_color: 'accent_color',
  recipient_name: 'recipient_name', recipient_title: 'recipient_title', recipient_company: 'recipient_company',
  recipient_address: 'recipient_address', recipient_email: 'recipient_email', letter_date: 'letter_date',
  reference_line: 'reference_line', intro_body: 'intro_body', closing_text: 'closing_text',
  signatory_name: 'signatory_name', signatory_title: 'signatory_title', signature_data_url: 'signature_data_url',
};

async function assertEditable(req, id) {
  const t = tenantId(req);
  const r = await query(`SELECT created_by_user_id, status FROM letters WHERE id = @id AND tenant_id = @t`, { id, t });
  const row = r.recordset?.[0];
  if (!row) return { ok: false, code: 404, error: 'Letter not found' };
  if (get(row, 'status') === 'archived') return { ok: false, code: 409, error: 'Archived letters cannot be edited' };
  const creator = get(row, 'created_by_user_id');
  if (!canSeeLetter(req, creator)) {
    return { ok: false, code: 403, error: 'You can only edit letters you created' };
  }
  return { ok: true };
}

// ——— Update (autosave-friendly) ———
router.patch('/:id', async (req, res, next) => {
  try {
    const guard = await assertEditable(req, req.params.id);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.error });
    const t = tenantId(req);
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id, t, uid: req.user.id };
    for (const [key, col] of Object.entries(UPDATABLE)) {
      if (b[key] === undefined) continue;
      let v = b[key];
      if (key === 'letter_type') v = normType(v);
      if (key === 'template_key') v = normTemplate(v);
      const pname = `p_${col}`;
      params[pname] = v === '' ? null : v;
      sets.push(`${col} = @${pname}`);
    }
    if (b.policy_refs !== undefined) {
      params.p_policy_refs = b.policy_refs ? JSON.stringify(b.policy_refs) : null;
      sets.push(`policy_refs = @p_policy_refs`);
    }
    if (sets.length) {
      sets.push('updated_by_user_id = @uid', 'updated_at = SYSUTCDATETIME()');
      await query(`UPDATE letters SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
    }
    if (Array.isArray(b.sections)) {
      await replaceSections(req.params.id, b.sections);
    }
    const letter = await loadLetterFull(t, req.params.id);
    res.json({ letter });
  } catch (err) {
    next(err);
  }
});

async function replaceSections(letterId, sections) {
  await query(`DELETE FROM letter_sections WHERE letter_id = @id`, { id: letterId });
  let order = 0;
  for (const s of sections) {
    const heading = s.heading != null ? String(s.heading) : '';
    const body = s.body != null ? String(s.body) : '';
    if (!heading.trim() && !body.trim()) continue;
    await query(
      `INSERT INTO letter_sections (id, letter_id, heading, body, sort_order)
       VALUES (@id, @lid, @h, @b, @o)`,
      { id: randomUUID(), lid: letterId, h: heading.slice(0, 500), b: body, o: order }
    );
    order += 1;
  }
}

// ——— Replace sections only ———
router.put('/:id/sections', async (req, res, next) => {
  try {
    const guard = await assertEditable(req, req.params.id);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.error });
    await replaceSections(req.params.id, Array.isArray(req.body?.sections) ? req.body.sections : []);
    const letter = await loadLetterFull(tenantId(req), req.params.id);
    res.json({ letter });
  } catch (err) {
    next(err);
  }
});

// ——— Delete ———
router.delete('/:id', async (req, res, next) => {
  try {
    const guard = await assertEditable(req, req.params.id);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.error });
    await query(`DELETE FROM letters WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t: tenantId(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function buildPdfFor(req, id) {
  const letter = await loadLetterFull(tenantId(req), id);
  if (!letter || !canSeeLetter(req, letter.created_by_user_id)) return null;
  let company = { company_name: 'Company' };
  let logoBuffer = null;
  let logoPath = null;
  try {
    ({ company, logoBuffer, logoPath } = await loadAccountingCompanyBranding(query, letter.tenant_id || tenantId(req), { accountingLogoOnly: true }));
  } catch {
    /* defaults */
  }
  const buf = await buildLetterPdfBuffer({
    letter,
    sections: letter.sections,
    company,
    logoBuffer,
    logoPath,
    watermark: letter.status === 'draft' ? 'DRAFT' : null,
  });
  return { letter, buf };
}

// ——— PDF (preview / download) ———
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const result = await buildPdfFor(req, req.params.id);
    if (!result) return res.status(404).json({ error: 'Letter not found' });
    const safeRef = String(result.letter.reference_number || 'letter').replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeRef}.pdf"`);
    res.send(result.buf);
  } catch (err) {
    next(err);
  }
});

// ——— Email the letter PDF (with arbitrary CC) ———
router.post('/:id/email', async (req, res, next) => {
  try {
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured on the server.' });
    const result = await buildPdfFor(req, req.params.id);
    if (!result) return res.status(404).json({ error: 'Letter not found' });
    const { letter, buf } = result;
    const b = req.body || {};
    const to = b.to || letter.recipient_email;
    if (!to) return res.status(400).json({ error: 'A recipient email is required' });
    const cc = Array.isArray(b.cc) ? b.cc.filter(Boolean) : (b.cc ? String(b.cc).split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : []);
    const subject = String(b.subject || `${letterTypeLabel(letter.letter_type)} — ${letter.title || letter.reference_number}`);
    const message = String(b.message || 'Please find the attached letter.');
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:14px;line-height:1.6">`
      + `<p>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`
      + `<p style="color:#6b7280;font-size:12px">Reference: ${letter.reference_number || ''}</p>`
      + `</body></html>`;
    const safeRef = String(letter.reference_number || 'letter').replace(/[^\w.-]+/g, '_');
    await sendEmail({
      to,
      cc,
      subject,
      body: html,
      html: true,
      attachments: [{ filename: `${safeRef}.pdf`, content: buf.toString('base64'), encoding: 'base64' }],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ——— Export to Quick Sign ("Exported PDFs" tab) ———
router.post('/:id/export-quick-sign', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const result = await buildPdfFor(req, req.params.id);
    if (!result) return res.status(404).json({ error: 'Letter not found' });
    const { letter, buf } = result;

    const dir = path.join(process.cwd(), 'uploads', 'quick-sign', String(t), 'originals');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${randomBytes(16).toString('hex')}.pdf`;
    const absPath = path.join(dir, fileName);
    fs.writeFileSync(absPath, buf);
    const rel = path.relative(process.cwd(), absPath).split(path.sep).join('/');
    let pageCount = 1;
    try { pageCount = await getPdfPageCount(absPath); } catch { /* default 1 */ }

    const origName = `${String(letter.reference_number || 'letter').replace(/[^\w.-]+/g, '_')}.pdf`;
    const accessToken = randomBytes(32).toString('hex');
    const ins = await query(
      `INSERT INTO quick_sign_requests (
         tenant_id, title, notes, status, signing_mode, allow_sender_sign, page_count,
         document_original_name, document_original_path, document_mime, access_token, created_by_user_id,
         recipient_email, recipient_name, source, source_letter_id
       ) OUTPUT INSERTED.id VALUES (
         @t, @title, @notes, N'draft', N'on_document', 1, @pc,
         @origName, @path, N'application/pdf', @token, @uid,
         @re, @rn, N'letter', @lid
       )`,
      {
        t,
        title: `${letterTypeLabel(letter.letter_type)} — ${letter.title || letter.reference_number}`.slice(0, 250),
        notes: `Exported from Letter composition (${letter.reference_number || ''})`,
        pc: pageCount,
        origName,
        path: rel,
        token: accessToken,
        uid: req.user.id,
        re: letter.recipient_email || '',
        rn: letter.recipient_name || '',
        lid: letter.id,
      }
    );
    const requestId = get(ins.recordset?.[0], 'id');
    res.status(201).json({ ok: true, quick_sign_request_id: requestId });
  } catch (err) {
    next(err);
  }
});

export default router;
