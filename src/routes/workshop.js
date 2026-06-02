import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { formatDateForAppTz, nowForFilename } from '../lib/emailService.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('contractor'));

const uploadDir = path.join(process.cwd(), 'uploads', 'workshop');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const dir = path.join(uploadDir, tenantId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).array('files', 10);

function getTenantId(req) { return req.user?.tenant_id || null; }

const ATTACHMENT_TYPES = new Set(['general', 'inspection', 'resolution_proof']);

function normalizeAttachmentType(raw) {
  const v = String(raw || 'general').trim().toLowerCase();
  return ATTACHMENT_TYPES.has(v) ? v : 'general';
}

async function countJobCardAttachments(jobCardId, attachmentType) {
  try {
    const r = await query(
      `SELECT COUNT(*) AS cnt FROM workshop_job_card_attachments WHERE job_card_id = @id AND attachment_type = @t`,
      { id: jobCardId, t: attachmentType }
    );
    const row = r.recordset?.[0];
    const key = row && Object.keys(row).find((k) => String(k).toLowerCase() === 'cnt');
    return Number(key ? row[key] : 0) || 0;
  } catch (e) {
    if (String(e?.message || '').includes('attachment_type')) return attachmentType === 'resolution_proof' ? 0 : 1;
    throw e;
  }
}

function nextJobCardNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JC-${y}${m}-${r}`;
}

// ─── Tenant users (for internal assignment) ───
router.get('/users', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(`SELECT id, full_name, email FROM users WHERE tenant_id = @tenantId AND [status] = N'active' ORDER BY full_name`, { tenantId });
    res.json({ users: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── List scheduled maintenance available for workshop ───
router.get('/maintenance-queue', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT s.*, t.registration AS truck_reg, t.make_model AS truck_model,
              jc.id AS job_card_id, jc.[status] AS job_card_status, jc.job_card_number
       FROM fleet_maintenance_schedules s
       LEFT JOIN contractor_trucks t ON t.id = s.truck_id
       LEFT JOIN workshop_job_cards jc ON jc.maintenance_schedule_id = s.id
       WHERE s.tenant_id = @tenantId AND s.[status] NOT IN (N'cancelled')
       ORDER BY s.due_date`,
      { tenantId }
    );
    res.json({ queue: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── Available inspections for linking ───
router.get('/inspections', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT id, reference_number, fleet_registration, trailer_registration,
              inspection_date, overall_result, inspector_name, failed_items
       FROM truck_inspections
       WHERE tenant_id = @tenantId AND reference_number IS NOT NULL
       ORDER BY created_at DESC`,
      { tenantId }
    );
    res.json({ inspections: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── List job cards ───
router.get('/job-cards', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT jc.*, t.registration AS truck_reg, t.make_model AS truck_model,
               u.full_name AS created_by_name, iu.full_name AS internal_user_name,
               ti.reference_number AS inspection_ref, ti.overall_result AS inspection_result,
               (SELECT COUNT(*) FROM workshop_job_card_items i WHERE i.job_card_id = jc.id) AS item_count,
               (SELECT ISNULL(SUM(i.quantity * ISNULL(i.unit_price, 0)), 0) FROM workshop_job_card_items i WHERE i.job_card_id = jc.id) AS items_total
               FROM workshop_job_cards jc
               LEFT JOIN contractor_trucks t ON t.id = jc.truck_id
               LEFT JOIN users u ON u.id = jc.created_by_user_id
               LEFT JOIN users iu ON iu.id = jc.internal_user_id
               LEFT JOIN truck_inspections ti ON ti.id = jc.linked_inspection_id
               WHERE jc.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.status && req.query.status !== 'all') { sql += ` AND jc.[status] = @status`; params.status = req.query.status; }
    if (req.query.provider_type && req.query.provider_type !== 'all') { sql += ` AND jc.provider_type = @ptype`; params.ptype = req.query.provider_type; }
    if (req.query.search) { sql += ` AND (jc.fleet_registration LIKE @search OR jc.job_card_number LIKE @search OR jc.provider_company_name LIKE @search OR jc.description LIKE @search)`; params.search = `%${req.query.search}%`; }
    sql += ` ORDER BY jc.created_at DESC`;
    const r = await query(sql, params);
    res.json({ jobCards: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── Get single job card with items, progress, attachments ───
router.get('/job-cards/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const [cardR, itemsR, progressR, attachR] = await Promise.all([
      query(
        `SELECT jc.*, t.registration AS truck_reg, t.make_model AS truck_model,
                u.full_name AS created_by_name, iu.full_name AS internal_user_name,
                ti.reference_number AS inspection_ref, ti.overall_result AS inspection_result
         FROM workshop_job_cards jc
         LEFT JOIN contractor_trucks t ON t.id = jc.truck_id
         LEFT JOIN users u ON u.id = jc.created_by_user_id
         LEFT JOIN users iu ON iu.id = jc.internal_user_id
         LEFT JOIN truck_inspections ti ON ti.id = jc.linked_inspection_id
         WHERE jc.id = @id AND jc.tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      ),
      query(`SELECT * FROM workshop_job_card_items WHERE job_card_id = @id ORDER BY sort_order, created_at`, { id: req.params.id }),
      query(
        `SELECT p.*, u.full_name AS user_name FROM workshop_job_card_progress p LEFT JOIN users u ON u.id = p.recorded_by_user_id WHERE p.job_card_id = @id ORDER BY p.created_at`,
        { id: req.params.id }
      ),
      query(`SELECT * FROM workshop_job_card_attachments WHERE job_card_id = @id ORDER BY created_at`, { id: req.params.id }),
    ]);
    if (!cardR.recordset?.length) return res.status(404).json({ error: 'Not found' });
    res.json({
      jobCard: cardR.recordset[0],
      items: itemsR.recordset || [],
      progress: progressR.recordset || [],
      attachments: attachR.recordset || [],
    });
  } catch (err) { next(err); }
});

// ─── Create job card (from maintenance schedule or standalone) ───
router.post('/job-cards', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    const jcNum = nextJobCardNumber();
    const r = await query(
      `INSERT INTO workshop_job_cards (
         tenant_id, maintenance_schedule_id, truck_id, fleet_registration, trailer_registration,
         maintenance_subject, job_card_number, [status], provider_type,
         provider_company_name, provider_contact_name, provider_contact_phone, provider_contact_email,
         internal_user_id, odometer_reading, description, started_at, created_by_user_id
       ) OUTPUT INSERTED.*
       VALUES (
         @tenantId, @schedId, @truckId, @fleetReg, @trailerReg,
         @subject, @jcNum, N'open', @providerType,
         @provCompany, @provContact, @provPhone, @provEmail,
         @internalUserId, @odo, @description, SYSUTCDATETIME(), @userId
       )`,
      {
        tenantId,
        schedId: b.maintenance_schedule_id || null,
        truckId: b.truck_id || null,
        fleetReg: b.fleet_registration || null,
        trailerReg: b.trailer_registration || null,
        subject: b.maintenance_subject || 'truck',
        jcNum,
        providerType: b.provider_type === 'external' ? 'external' : 'internal',
        provCompany: b.provider_company_name || null,
        provContact: b.provider_contact_name || null,
        provPhone: b.provider_contact_phone || null,
        provEmail: b.provider_contact_email || null,
        internalUserId: b.internal_user_id || null,
        odo: b.odometer_reading != null ? Number(b.odometer_reading) : null,
        description: b.description || null,
        userId: req.user.id,
      }
    );
    const card = r.recordset?.[0];
    if (card && b.maintenance_schedule_id) {
      await query(`UPDATE fleet_maintenance_schedules SET [status] = N'in_progress', updated_at = SYSUTCDATETIME() WHERE id = @id`, { id: b.maintenance_schedule_id });
    }
    await query(
      `INSERT INTO workshop_job_card_progress (job_card_id, entry_type, note, recorded_by_user_id, recorded_by_name) VALUES (@jcId, N'status', N'Job card created and work started.', @uid, @uname)`,
      { jcId: card.id, uid: req.user.id, uname: req.user.full_name || '' }
    );
    res.status(201).json({ jobCard: card });
  } catch (err) { next(err); }
});

// ─── Update job card (save progress, close, etc.) ───
router.patch('/job-cards/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id, tenantId };
    if (b.status === 'completed') {
      if (!b.linked_inspection_id) {
        return res.status(400).json({
          error: 'An inspection must be linked before closing this work order. Please complete an inspection and link it.',
        });
      }
      const resText = b.final_resolution != null ? String(b.final_resolution).trim() : '';
      if (!resText) {
        return res.status(400).json({ error: 'Final resolution is required before closing the job card.' });
      }
      const proofCount = await countJobCardAttachments(req.params.id, 'resolution_proof');
      if (proofCount < 1) {
        return res.status(400).json({
          error:
            'Upload the physical invoice or mechanic record (required) before closing. Use “Invoice / mechanic record” on the close form.',
        });
      }
    }
    const allowed = [
      'description', 'provider_type', 'provider_company_name', 'provider_contact_name',
      'provider_contact_phone', 'provider_contact_email', 'internal_user_id',
      'odometer_reading', 'final_resolution', 'next_maintenance_date', 'status',
      'linked_inspection_id',
    ];
    for (const k of allowed) {
      if (b[k] !== undefined) {
        const pk = k.replace(/[^a-zA-Z0-9_]/g, '');
        params[pk] = b[k];
        sets.push(`[${k}] = @${pk}`);
      }
    }
    if (b.status === 'completed' && !b.completed_at) {
      sets.push(`completed_at = SYSUTCDATETIME()`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(`UPDATE workshop_job_cards SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);

    if (b.status === 'completed') {
      const card = await query(`SELECT maintenance_schedule_id, next_maintenance_date FROM workshop_job_cards WHERE id = @id`, { id: req.params.id });
      const schedId = card.recordset?.[0]?.maintenance_schedule_id;
      if (schedId) {
        await query(`UPDATE fleet_maintenance_schedules SET [status] = N'completed', completed_at = SYSUTCDATETIME(), completed_by_user_id = @uid, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id: schedId, uid: req.user.id });
      }
      await query(
        `INSERT INTO workshop_job_card_progress (job_card_id, entry_type, note, recorded_by_user_id, recorded_by_name) VALUES (@jcId, N'status', N'Job card closed – work completed.', @uid, @uname)`,
        { jcId: req.params.id, uid: req.user.id, uname: req.user.full_name || '' }
      );
    }

    const updated = await query(
      `SELECT jc.*, t.registration AS truck_reg, ti.reference_number AS inspection_ref, ti.overall_result AS inspection_result FROM workshop_job_cards jc LEFT JOIN contractor_trucks t ON t.id = jc.truck_id LEFT JOIN truck_inspections ti ON ti.id = jc.linked_inspection_id WHERE jc.id = @id`,
      { id: req.params.id }
    );
    res.json({ jobCard: updated.recordset?.[0] || null });
  } catch (err) { next(err); }
});

// ─── Add item to job card ───
router.post('/job-cards/:id/items', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.description) return res.status(400).json({ error: 'description required' });
    const r = await query(
      `INSERT INTO workshop_job_card_items (job_card_id, item_type, description, part_number, quantity, unit_price, notes, sort_order)
       OUTPUT INSERTED.*
       VALUES (@jcId, @type, @desc, @partNum, @qty, @price, @notes, @sort)`,
      {
        jcId: req.params.id,
        type: ['part', 'labour', 'consumable', 'other'].includes(b.item_type) ? b.item_type : 'part',
        desc: b.description,
        partNum: b.part_number || null,
        qty: b.quantity != null ? Number(b.quantity) : 1,
        price: b.unit_price != null ? Number(b.unit_price) : null,
        notes: b.notes || null,
        sort: b.sort_order != null ? Number(b.sort_order) : 0,
      }
    );
    res.status(201).json({ item: r.recordset?.[0] });
  } catch (err) { next(err); }
});

// ─── Update item ───
router.patch('/job-cards/:cardId/items/:itemId', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = { itemId: req.params.itemId, cardId: req.params.cardId };
    for (const k of ['description', 'item_type', 'part_number', 'quantity', 'unit_price', 'notes', 'sort_order']) {
      if (b[k] !== undefined) { params[k] = b[k]; sets.push(`[${k}] = @${k}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await query(`UPDATE workshop_job_card_items SET ${sets.join(', ')} WHERE id = @itemId AND job_card_id = @cardId`, params);
    const r = await query(`SELECT * FROM workshop_job_card_items WHERE id = @itemId`, { itemId: req.params.itemId });
    res.json({ item: r.recordset?.[0] });
  } catch (err) { next(err); }
});

// ─── Delete item ───
router.delete('/job-cards/:cardId/items/:itemId', async (req, res, next) => {
  try {
    await query(`DELETE FROM workshop_job_card_attachments WHERE item_id = @itemId`, { itemId: req.params.itemId });
    await query(`DELETE FROM workshop_job_card_items WHERE id = @itemId AND job_card_id = @cardId`, { itemId: req.params.itemId, cardId: req.params.cardId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Add progress note ───
router.post('/job-cards/:id/progress', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.note) return res.status(400).json({ error: 'note required' });
    const r = await query(
      `INSERT INTO workshop_job_card_progress (job_card_id, entry_type, note, recorded_by_user_id, recorded_by_name)
       OUTPUT INSERTED.*
       VALUES (@jcId, @type, @note, @uid, @uname)`,
      {
        jcId: req.params.id,
        type: b.entry_type || 'note',
        note: b.note,
        uid: req.user?.id || null,
        uname: b.recorded_by_name || req.user?.full_name || '',
      }
    );
    res.status(201).json({ entry: r.recordset?.[0] });
  } catch (err) { next(err); }
});

// ─── Upload attachments ───
router.post('/job-cards/:id/attachments', upload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const itemId = req.body?.item_id || null;
    const attachmentType = normalizeAttachmentType(req.body?.attachment_type);
    const results = [];
    for (const f of files) {
      let r;
      try {
        r = await query(
          `INSERT INTO workshop_job_card_attachments (job_card_id, item_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id, attachment_type)
           OUTPUT INSERTED.*
           VALUES (@jcId, @itemId, @fileName, @filePath, @fileSize, @mime, @uid, @atype)`,
          {
            jcId: req.params.id,
            itemId,
            fileName: f.originalname,
            filePath: f.path,
            fileSize: f.size,
            mime: f.mimetype,
            uid: req.user?.id || null,
            atype: attachmentType,
          }
        );
      } catch (e) {
        if (!String(e?.message || '').includes('attachment_type')) throw e;
        r = await query(
          `INSERT INTO workshop_job_card_attachments (job_card_id, item_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id)
           OUTPUT INSERTED.*
           VALUES (@jcId, @itemId, @fileName, @filePath, @fileSize, @mime, @uid)`,
          {
            jcId: req.params.id,
            itemId,
            fileName: f.originalname,
            filePath: f.path,
            fileSize: f.size,
            mime: f.mimetype,
            uid: req.user?.id || null,
          }
        );
      }
      if (r.recordset?.[0]) results.push(r.recordset[0]);
    }
    res.status(201).json({ attachments: results });
  } catch (err) { next(err); }
});

// ─── Download attachment ───
router.get('/attachments/:id/download', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM workshop_job_card_attachments WHERE id = @id`, { id: req.params.id });
    const att = r.recordset?.[0];
    if (!att) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(att.file_path)) return res.status(404).json({ error: 'File missing' });
    res.download(att.file_path, att.file_name);
  } catch (err) { next(err); }
});

// ─── Delete attachment ───
router.delete('/attachments/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM workshop_job_card_attachments WHERE id = @id`, { id: req.params.id });
    const att = r.recordset?.[0];
    if (att?.file_path && fs.existsSync(att.file_path)) fs.unlinkSync(att.file_path);
    await query(`DELETE FROM workshop_job_card_attachments WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Helpers for export ───
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtDateTime(d) { if (!d) return '—'; return new Date(d).toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function loadFullJobCard(id, tenantId) {
  const [cardR, itemsR, progressR, attachR] = await Promise.all([
    query(
      `SELECT jc.*, t.registration AS truck_reg, t.make_model AS truck_model,
              u.full_name AS created_by_name, iu.full_name AS internal_user_name,
              ti.reference_number AS inspection_ref, ti.overall_result AS inspection_result
       FROM workshop_job_cards jc
       LEFT JOIN contractor_trucks t ON t.id = jc.truck_id
       LEFT JOIN users u ON u.id = jc.created_by_user_id
       LEFT JOIN users iu ON iu.id = jc.internal_user_id
       LEFT JOIN truck_inspections ti ON ti.id = jc.linked_inspection_id
       WHERE jc.id = @id AND jc.tenant_id = @tenantId`,
      { id, tenantId }
    ),
    query(`SELECT * FROM workshop_job_card_items WHERE job_card_id = @id ORDER BY sort_order, created_at`, { id }),
    query(`SELECT p.*, u.full_name AS user_name FROM workshop_job_card_progress p LEFT JOIN users u ON u.id = p.recorded_by_user_id WHERE p.job_card_id = @id ORDER BY p.created_at`, { id }),
    query(`SELECT * FROM workshop_job_card_attachments WHERE job_card_id = @id ORDER BY created_at`, { id }),
  ]);
  if (!cardR.recordset?.length) return null;
  return { jc: cardR.recordset[0], items: itemsR.recordset || [], progress: progressR.recordset || [], attachments: attachR.recordset || [] };
}

// ─── Export job card as PDF ───
router.get('/job-cards/:id/export/pdf', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const data = await loadFullJobCard(req.params.id, tenantId);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const { jc, items, progress, attachments } = data;
    const itemsTotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0);

    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="work-order-${jc.job_card_number || 'report'}-${nowForFilename()}.pdf"` });
      res.send(pdf);
    });

    const PW = doc.page.width;
    const M = 36;
    const CW = PW - M * 2;
    const BRAND = '#1E3A5F';
    const LIGHT = '#EFF6FF';
    const FONT = 'Helvetica';

    let y = 70;

    // ── Brand header ──
    doc.rect(0, 0, PW, 56).fill(BRAND);
    doc.font(FONT + '-Bold').fontSize(13).fillColor('#FFFFFF').text('THINKERS AFRIKA', M, 14);
    doc.font(FONT).fontSize(8).text('Workshop · Work order report', M, 30);
    doc.font(FONT + '-Bold').fontSize(11).text(jc.job_card_number || 'Work order', M, 42);
    doc.fontSize(8).font(FONT).fillColor('#FFFFFF').text(`Generated: ${formatDateForAppTz(new Date())}`, PW - 200, 14, { width: 164, align: 'right' });
    const statusLabel = (jc.status || 'open').replace(/_/g, ' ').toUpperCase();
    doc.roundedRect(PW - 200, 36, 164, 16, 3).fill(jc.status === 'completed' ? '#059669' : '#3B82F6');
    doc.font(FONT + '-Bold').fontSize(9).fillColor('#FFFFFF').text(statusLabel, PW - 196, 40, { width: 156, align: 'center' });
    y = 70;

    // ── Info grid ──
    const infoRows = [
      [['Fleet registration', jc.truck_reg || jc.fleet_registration || '—'], ['Trailer', jc.trailer_registration || '—'], ['Subject', (jc.maintenance_subject || 'truck').replace(/_/g, ' ')]],
      [['Provider', `${jc.provider_type === 'external' ? 'External' : 'Internal'} — ${jc.provider_company_name || '—'}`], ['Contact', jc.provider_type === 'external' ? [jc.provider_contact_name, jc.provider_contact_phone].filter(Boolean).join(' · ') || '—' : jc.internal_user_name || '—'], ['ODO (km)', jc.odometer_reading != null ? Number(jc.odometer_reading).toLocaleString() : '—']],
      [['Started', fmtDateTime(jc.started_at)], ['Completed', fmtDateTime(jc.completed_at)], ['Created by', jc.created_by_name || '—']],
    ];
    const colW = CW / 3;
    for (const row of infoRows) {
      doc.rect(M, y, CW, 22).fill(LIGHT);
      let x = M;
      for (const [label, value] of row) {
        doc.font(FONT).fontSize(6).fillColor('#6B7280').text(label.toUpperCase(), x + 4, y + 3, { width: colW - 8 });
        doc.font(FONT + '-Bold').fontSize(8).fillColor('#1a1a1a').text(String(value || '—').slice(0, 50), x + 4, y + 12, { width: colW - 8 });
        x += colW;
      }
      y += 26;
    }

    // ── Description ──
    if (jc.description) {
      y += 6;
      doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('DESCRIPTION', M, y);
      y += 10;
      doc.font(FONT).fontSize(8).fillColor('#1a1a1a');
      const descLines = doc.heightOfString(jc.description, { width: CW });
      doc.text(jc.description, M, y, { width: CW });
      y += descLines + 8;
    }

    // ── Parts & labour table ──
    y += 4;
    doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('PARTS & LABOUR', M, y);
    y += 12;
    if (items.length > 0) {
      const cols = [60, 160, 60, 50, 60, 60];
      const hdrs = ['Type', 'Description', 'Part #', 'Qty', 'Unit price', 'Total'];
      doc.rect(M, y, CW, 14).fill(BRAND);
      let x = M;
      doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFFFFF');
      hdrs.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: cols[i] - 6 }); x += cols[i]; });
      y += 14;
      doc.fillColor('#1a1a1a');
      for (let ri = 0; ri < items.length; ri++) {
        const it = items[ri];
        if (y > doc.page.height - 80) { doc.addPage(); y = M; }
        const bg = ri % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(M, y, CW, 14).fill(bg);
        x = M;
        const cells = [
          (it.item_type || '').replace(/_/g, ' '),
          String(it.description || '—').slice(0, 60),
          it.part_number || '—',
          String(it.quantity ?? 1),
          it.unit_price != null ? `R ${Number(it.unit_price).toFixed(2)}` : '—',
          `R ${Number(it.total_price || 0).toFixed(2)}`,
        ];
        doc.font(FONT).fontSize(7).fillColor('#1a1a1a');
        cells.forEach((c, i) => { doc.text(c, x + 3, y + 4, { width: cols[i] - 6, align: i >= 3 ? 'right' : 'left' }); x += cols[i]; });
        y += 14;
      }
      doc.rect(M, y, CW, 16).fill(BRAND);
      doc.font(FONT + '-Bold').fontSize(8).fillColor('#FFFFFF');
      doc.text('TOTAL', M + 3, y + 4, { width: cols[0] + cols[1] + cols[2] + cols[3] + cols[4] - 6 });
      doc.text(`R ${itemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, M + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + 3, y + 4, { width: cols[5] - 6, align: 'right' });
      y += 20;
    } else {
      doc.font(FONT).fontSize(8).fillColor('#6B7280').text('No items recorded.', M, y);
      y += 14;
    }

    // ── Final resolution ──
    if (jc.final_resolution) {
      y += 6;
      if (y > doc.page.height - 100) { doc.addPage(); y = M; }
      doc.rect(M, y, CW, 4).fill('#059669');
      y += 8;
      doc.font(FONT + '-Bold').fontSize(7).fillColor('#059669').text('FINAL RESOLUTION', M, y);
      y += 10;
      doc.font(FONT).fontSize(8).fillColor('#1a1a1a');
      const resH = doc.heightOfString(jc.final_resolution, { width: CW });
      doc.text(jc.final_resolution, M, y, { width: CW });
      y += resH + 4;
      if (jc.next_maintenance_date) {
        doc.font(FONT + '-Bold').fontSize(7).fillColor('#6B7280').text(`Next maintenance suggested: ${fmtDate(jc.next_maintenance_date)}`, M, y);
        y += 12;
      }
    }

    if (jc.inspection_ref) {
      y += 6;
      if (y > doc.page.height - 60) { doc.addPage(); y = M; }
      doc.rect(M, y, CW, 4).fill('#2563EB');
      y += 8;
      doc.font(FONT + '-Bold').fontSize(7).fillColor('#2563EB').text(`LINKED INSPECTION: ${jc.inspection_ref}`, M, y);
      y += 10;
      doc.font(FONT).fontSize(8).fillColor('#1a1a1a').text(`Result: ${(jc.inspection_result || 'N/A').toUpperCase()}`, M, y);
      y += 12;
    }

    // ── Progress log ──
    if (progress.length > 0) {
      y += 6;
      if (y > doc.page.height - 60) { doc.addPage(); y = M; }
      doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('PROGRESS LOG', M, y);
      y += 12;
      for (const p of progress) {
        if (y > doc.page.height - 50) { doc.addPage(); y = M; }
        doc.font(FONT + '-Bold').fontSize(6).fillColor('#6B7280').text(fmtDateTime(p.created_at), M, y, { continued: true }).text(`  ${p.user_name || p.recorded_by_name || 'System'}`, { continued: false });
        y += 8;
        if (p.entry_type === 'status') doc.rect(M, y - 1, 2, 10).fill('#3B82F6');
        const noteH = doc.heightOfString(p.note || '', { width: CW - 8 });
        doc.font(FONT).fontSize(7).fillColor('#1a1a1a').text(p.note || '', M + 6, y, { width: CW - 8 });
        y += noteH + 6;
      }
    }

    // ── Attachments list ──
    if (attachments.length > 0) {
      y += 6;
      if (y > doc.page.height - 50) { doc.addPage(); y = M; }
      doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text(`ATTACHMENTS (${attachments.length})`, M, y);
      y += 10;
      for (const att of attachments) {
        if (y > doc.page.height - 40) { doc.addPage(); y = M; }
        doc.font(FONT).fontSize(7).fillColor('#1a1a1a').text(`• ${att.file_name}`, M + 4, y, { continued: true });
        doc.fillColor('#6B7280').text(`   ${att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''} · ${fmtDateTime(att.created_at)}`, { continued: false });
        y += 10;
      }
    }

    const range = doc.bufferedPageRange();
    doc._pageBuffer.length = range.count;
    doc.end();
  } catch (err) { next(err); }
});

// ─── Export job card as Excel ───
router.get('/job-cards/:id/export/excel', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const data = await loadFullJobCard(req.params.id, tenantId);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const { jc, items, progress, attachments } = data;
    const itemsTotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Thinkers Afrika';
    const BRAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const LIGHT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    const GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
    const WHITE_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const BRAND_FONT = { bold: true, color: { argb: 'FF1E3A5F' }, size: 10 };
    const SMALL = { size: 9 };
    const MUTED = { size: 8, color: { argb: 'FF6B7280' } };

    // ── Summary sheet ──
    const ws = wb.addWorksheet('Work order', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 20 }, { width: 30 }, { width: 20 }, { width: 30 }, { width: 18 }, { width: 18 }];

    let r = 1;
    ws.mergeCells(r, 1, r, 6);
    const titleCell = ws.getRow(r).getCell(1);
    titleCell.value = 'THINKERS AFRIKA — WORK ORDER REPORT';
    titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
    titleCell.fill = BRAND_FILL;
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(r).height = 32;
    r++;
    ws.mergeCells(r, 1, r, 6);
    const subCell = ws.getRow(r).getCell(1);
    subCell.value = `Job card: ${jc.job_card_number || '—'} · Status: ${(jc.status || 'open').replace(/_/g, ' ').toUpperCase()} · Generated: ${formatDateForAppTz(new Date())}`;
    subCell.font = { italic: true, size: 9, color: { argb: 'FFFFFFFF' } };
    subCell.fill = BRAND_FILL;
    r += 2;

    const addInfoRow = (label, value) => {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true, ...SMALL };
      row.getCell(1).fill = LIGHT_FILL;
      ws.mergeCells(r, 2, r, 3);
      row.getCell(2).value = value || '—';
      row.getCell(2).font = SMALL;
      return r++;
    };

    addInfoRow('Fleet registration', jc.truck_reg || jc.fleet_registration);
    addInfoRow('Trailer registration', jc.trailer_registration);
    addInfoRow('Subject', (jc.maintenance_subject || 'truck').replace(/_/g, ' '));
    addInfoRow('Provider type', jc.provider_type === 'external' ? 'External' : 'Internal');
    addInfoRow('Company', jc.provider_company_name);
    if (jc.provider_type === 'external') {
      addInfoRow('Contact', [jc.provider_contact_name, jc.provider_contact_phone, jc.provider_contact_email].filter(Boolean).join(' · '));
    } else {
      addInfoRow('Assigned to', jc.internal_user_name);
    }
    addInfoRow('ODO reading (km)', jc.odometer_reading != null ? Number(jc.odometer_reading).toLocaleString() : '—');
    addInfoRow('Started', fmtDateTime(jc.started_at));
    addInfoRow('Completed', fmtDateTime(jc.completed_at));
    addInfoRow('Created by', jc.created_by_name);
    r++;

    if (jc.description) {
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = 'DESCRIPTION';
      ws.getRow(r).getCell(1).font = BRAND_FONT;
      r++;
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = jc.description;
      ws.getRow(r).getCell(1).font = SMALL;
      ws.getRow(r).getCell(1).alignment = { wrapText: true };
      r += 2;
    }

    // ── Items table ──
    ws.mergeCells(r, 1, r, 6);
    ws.getRow(r).getCell(1).value = 'PARTS & LABOUR';
    ws.getRow(r).getCell(1).font = BRAND_FONT;
    r++;
    const itemHeaders = ['Type', 'Description', 'Part #', 'Qty', 'Unit price (R)', 'Total (R)'];
    const headerRow = ws.getRow(r);
    itemHeaders.forEach((h, i) => {
      const c = headerRow.getCell(i + 1);
      c.value = h;
      c.font = WHITE_FONT;
      c.fill = BRAND_FILL;
      c.alignment = { vertical: 'middle' };
    });
    r++;
    for (const it of items) {
      const row = ws.getRow(r);
      row.getCell(1).value = (it.item_type || '').replace(/_/g, ' ');
      row.getCell(2).value = it.description;
      row.getCell(3).value = it.part_number || '—';
      row.getCell(4).value = Number(it.quantity ?? 1);
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).value = it.unit_price != null ? Number(it.unit_price) : null;
      row.getCell(5).numFmt = '#,##0.00';
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).value = Number(it.total_price || 0);
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(6).font = { bold: true, ...SMALL };
      row.getCell(6).alignment = { horizontal: 'right' };
      for (let c = 1; c <= 6; c++) row.getCell(c).font = SMALL;
      if (it.notes) { row.getCell(2).note = it.notes; }
      r++;
    }
    const totalRow = ws.getRow(r);
    ws.mergeCells(r, 1, r, 5);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(1).font = WHITE_FONT;
    totalRow.getCell(1).fill = BRAND_FILL;
    totalRow.getCell(1).alignment = { horizontal: 'right' };
    totalRow.getCell(6).value = itemsTotal;
    totalRow.getCell(6).numFmt = '#,##0.00';
    totalRow.getCell(6).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    totalRow.getCell(6).fill = BRAND_FILL;
    totalRow.getCell(6).alignment = { horizontal: 'right' };
    r += 2;

    // ── Final resolution ──
    if (jc.final_resolution) {
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = 'FINAL RESOLUTION';
      ws.getRow(r).getCell(1).font = { bold: true, color: { argb: 'FF059669' }, size: 10 };
      r++;
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = jc.final_resolution;
      ws.getRow(r).getCell(1).font = SMALL;
      ws.getRow(r).getCell(1).alignment = { wrapText: true };
      r++;
      if (jc.next_maintenance_date) {
        ws.mergeCells(r, 1, r, 6);
        ws.getRow(r).getCell(1).value = `Next maintenance suggested: ${fmtDate(jc.next_maintenance_date)}`;
        ws.getRow(r).getCell(1).font = MUTED;
        r++;
      }
      r++;
    }

    if (jc.inspection_ref) {
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = `LINKED INSPECTION: ${jc.inspection_ref}`;
      ws.getRow(r).getCell(1).font = { bold: true, color: { argb: 'FF2563EB' }, size: 10 };
      r++;
      ws.mergeCells(r, 1, r, 6);
      ws.getRow(r).getCell(1).value = `Result: ${(jc.inspection_result || 'N/A').toUpperCase()}`;
      ws.getRow(r).getCell(1).font = SMALL;
      r += 2;
    }

    // ── Progress log sheet ──
    if (progress.length > 0) {
      const ps = wb.addWorksheet('Progress log', { views: [{ showGridLines: true }] });
      ps.columns = [{ width: 22 }, { width: 22 }, { width: 14 }, { width: 60 }];
      const ph = ps.getRow(1);
      ['Timestamp', 'Recorded by', 'Type', 'Note'].forEach((h, i) => {
        const c = ph.getCell(i + 1);
        c.value = h;
        c.font = WHITE_FONT;
        c.fill = BRAND_FILL;
      });
      for (let i = 0; i < progress.length; i++) {
        const p = progress[i];
        const pr = ps.getRow(i + 2);
        pr.getCell(1).value = fmtDateTime(p.created_at);
        pr.getCell(1).font = MUTED;
        pr.getCell(2).value = p.user_name || p.recorded_by_name || 'System';
        pr.getCell(2).font = SMALL;
        pr.getCell(3).value = p.entry_type || 'note';
        pr.getCell(3).font = SMALL;
        pr.getCell(4).value = p.note;
        pr.getCell(4).font = SMALL;
        pr.getCell(4).alignment = { wrapText: true };
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="work-order-${jc.job_card_number || 'report'}-${nowForFilename()}.xlsx"`,
    });
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

// ─── Download blank work order template (Excel) ───
router.get('/templates/work-order-excel', async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Thinkers Afrika';
    const BRAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const LIGHT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    const WHITE_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const SMALL = { size: 9 };

    const ws = wb.addWorksheet('Work order template', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 24 }, { width: 30 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 18 }];
    let r = 1;
    ws.mergeCells(r, 1, r, 6);
    ws.getRow(r).getCell(1).value = 'THINKERS AFRIKA — WORK ORDER TEMPLATE';
    ws.getRow(r).getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
    ws.getRow(r).getCell(1).fill = BRAND_FILL;
    ws.getRow(r).getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(r).height = 32;
    r += 2;

    const fields = [
      'Job card number', 'Fleet registration', 'Trailer registration', 'Maintenance subject',
      'Provider type (Internal/External)', 'Company name', 'Contact person', 'Contact phone', 'Contact email',
      'ODO reading (km)', 'Description / scope', 'Started date', 'Completed date',
    ];
    for (const f of fields) {
      const row = ws.getRow(r);
      row.getCell(1).value = f;
      row.getCell(1).font = { bold: true, ...SMALL };
      row.getCell(1).fill = LIGHT_FILL;
      ws.mergeCells(r, 2, r, 4);
      row.getCell(2).font = SMALL;
      row.getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      r++;
    }
    r += 2;
    ws.mergeCells(r, 1, r, 6);
    ws.getRow(r).getCell(1).value = 'PARTS & LABOUR';
    ws.getRow(r).getCell(1).font = { bold: true, color: { argb: 'FF1E3A5F' }, size: 10 };
    r++;
    const headers = ['Type', 'Description', 'Part #', 'Qty', 'Unit price (R)', 'Total (R)'];
    const hRow = ws.getRow(r);
    headers.forEach((h, i) => {
      hRow.getCell(i + 1).value = h;
      hRow.getCell(i + 1).font = WHITE_FONT;
      hRow.getCell(i + 1).fill = BRAND_FILL;
    });
    r++;
    for (let i = 0; i < 15; i++) {
      const row = ws.getRow(r + i);
      for (let c = 1; c <= 6; c++) {
        row.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        row.getCell(c).font = SMALL;
      }
    }
    r += 16;
    ws.mergeCells(r, 1, r, 6);
    ws.getRow(r).getCell(1).value = 'FINAL RESOLUTION';
    ws.getRow(r).getCell(1).font = { bold: true, color: { argb: 'FF059669' }, size: 10 };
    r++;
    ws.mergeCells(r, 1, r + 2, 6);
    ws.getRow(r).getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    r += 4;
    const nmdRow = ws.getRow(r);
    nmdRow.getCell(1).value = 'Next maintenance date:';
    nmdRow.getCell(1).font = { bold: true, ...SMALL };
    nmdRow.getCell(1).fill = LIGHT_FILL;
    nmdRow.getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

    const buf = await wb.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="work-order-template.xlsx"`,
    });
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

// ─── Download blank work order template (PDF) ───
router.get('/templates/work-order-pdf', async (req, res, next) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="work-order-template.pdf"` });
    doc.pipe(res);
    const PW = 595.28;
    const M = 36;
    const CW = PW - M * 2;
    const BRAND = '#1E3A5F';
    const FONT = 'Helvetica';

    doc.rect(0, 0, PW, 50).fill(BRAND);
    doc.font(FONT + '-Bold').fontSize(14).fillColor('#FFFFFF').text('THINKERS AFRIKA — WORK ORDER TEMPLATE', M, 18, { width: CW, align: 'center' });
    let y = 64;

    const fields = [
      'Job card number', 'Fleet registration', 'Trailer registration', 'Maintenance subject',
      'Provider type', 'Company name', 'Contact person / Assigned user', 'Contact phone',
      'Contact email', 'ODO reading (km)', 'Started date', 'Completed date',
    ];
    for (const f of fields) {
      doc.font(FONT + '-Bold').fontSize(8).fillColor('#1E3A5F').text(f, M, y, { width: 150 });
      doc.moveTo(M + 155, y + 10).lineTo(M + CW, y + 10).strokeColor('#CBD5E1').lineWidth(0.5).stroke();
      y += 18;
    }
    y += 6;
    doc.font(FONT + '-Bold').fontSize(8).fillColor(BRAND).text('DESCRIPTION / SCOPE OF WORK', M, y);
    y += 12;
    doc.rect(M, y, CW, 50).strokeColor('#CBD5E1').lineWidth(0.5).stroke();
    y += 58;

    doc.font(FONT + '-Bold').fontSize(8).fillColor(BRAND).text('PARTS & LABOUR', M, y);
    y += 12;
    const cols = [60, 160, 60, 50, 60, 60];
    const headers = ['Type', 'Description', 'Part #', 'Qty', 'Unit price', 'Total'];
    doc.rect(M, y, CW, 14).fill(BRAND);
    let x = M;
    doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFFFFF');
    headers.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: cols[i] - 6 }); x += cols[i]; });
    y += 14;
    for (let i = 0; i < 12; i++) {
      doc.rect(M, y, CW, 14).strokeColor('#CBD5E1').lineWidth(0.3).stroke();
      x = M;
      for (let ci = 0; ci < cols.length - 1; ci++) { x += cols[ci]; doc.moveTo(x, y).lineTo(x, y + 14).stroke(); }
      y += 14;
    }
    doc.rect(M, y, CW, 16).fill(BRAND);
    doc.font(FONT + '-Bold').fontSize(8).fillColor('#FFFFFF').text('TOTAL', M + 3, y + 4);
    y += 22;

    doc.font(FONT + '-Bold').fontSize(8).fillColor('#059669').text('FINAL RESOLUTION', M, y);
    y += 12;
    doc.rect(M, y, CW, 50).strokeColor('#CBD5E1').lineWidth(0.5).stroke();
    y += 58;
    doc.font(FONT + '-Bold').fontSize(8).fillColor(BRAND).text('Next maintenance date:', M, y);
    doc.moveTo(M + 130, y + 10).lineTo(M + 300, y + 10).strokeColor('#CBD5E1').lineWidth(0.5).stroke();

    doc.font(FONT).fontSize(7).fillColor('#94a3b8').text('Thinkers Afrika · Work order template', M, 841.89 - 24, { width: CW, align: 'center', lineBreak: false });
    doc.end();
  } catch (err) { next(err); }
});

export default router;
