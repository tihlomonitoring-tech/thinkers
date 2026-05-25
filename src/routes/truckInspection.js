import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { formatDateForAppTz, nowForFilename } from '../lib/emailService.js';
import { SA_INSPECTION_CHECKLIST, flatChecklist, computeResult } from '../lib/saInspectionChecklist.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('contractor'));

const uploadDir = path.join(process.cwd(), 'uploads', 'inspections');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tid = String(req.user?.tenant_id || 'anon');
      const dir = path.join(uploadDir, tid);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).array('files', 20);

function getTenantId(req) { return req.user?.tenant_id || null; }

function genInspRef() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INS-${y}${m}-${r}`;
}

router.get('/checklist', (req, res) => { res.json({ checklist: SA_INSPECTION_CHECKLIST }); });

router.get('/users', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(`SELECT id, full_name, email FROM users WHERE tenant_id = @tenantId AND [status] = N'active' ORDER BY full_name`, { tenantId });
    res.json({ users: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── List inspections ───
router.get('/', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT i.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name
               FROM truck_inspections i
               LEFT JOIN contractor_trucks t ON t.id = i.truck_id
               LEFT JOIN users u ON u.id = i.created_by_user_id
               WHERE i.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.truck_id) { sql += ` AND i.truck_id = @truckId`; params.truckId = req.query.truck_id; }
    if (req.query.result && req.query.result !== 'all') { sql += ` AND i.overall_result = @result`; params.result = req.query.result; }
    if (req.query.inspector_role && req.query.inspector_role !== 'all') { sql += ` AND i.inspector_role = @role`; params.role = req.query.inspector_role; }
    if (req.query.from) { sql += ` AND i.inspection_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND i.inspection_date <= @to`; params.to = req.query.to; }
    if (req.query.search) { sql += ` AND (i.fleet_registration LIKE @search OR i.inspector_name LIKE @search)`; params.search = `%${req.query.search}%`; }
    sql += ` ORDER BY i.inspection_date DESC, i.created_at DESC`;
    const r = await query(sql, params);
    res.json({ inspections: r.recordset || [] });
  } catch (err) { next(err); }
});

// ─── Get single inspection with items + attachments ───
router.get('/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const [inspR, itemsR, attR] = await Promise.all([
      query(
        `SELECT i.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name
         FROM truck_inspections i LEFT JOIN contractor_trucks t ON t.id = i.truck_id LEFT JOIN users u ON u.id = i.created_by_user_id
         WHERE i.id = @id AND i.tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      ),
      query(`SELECT * FROM truck_inspection_items WHERE inspection_id = @id ORDER BY sort_order`, { id: req.params.id }),
      query(`SELECT * FROM truck_inspection_attachments WHERE inspection_id = @id ORDER BY created_at`, { id: req.params.id }),
    ]);
    if (!inspR.recordset?.length) return res.status(404).json({ error: 'Not found' });
    res.json({ inspection: inspR.recordset[0], items: itemsR.recordset || [], attachments: attR.recordset || [] });
  } catch (err) { next(err); }
});

// ─── Submit inspection ───
router.post('/', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.inspector_name) return res.status(400).json({ error: 'inspector_name required' });
    if (!b.inspection_date) return res.status(400).json({ error: 'inspection_date required' });

    const checkItems = b.items || [];
    const { total, passed, failed, na, overall } = computeResult(checkItems);
    const failedLabels = checkItems.filter((x) => String(x.result).toLowerCase() === 'fail').map((x) => `${x.item_code}: ${x.item_label}`);
    const failureSummary = failedLabels.length > 0 ? failedLabels.join('\n') : null;

    const refNum = genInspRef();
    const r = await query(
      `INSERT INTO truck_inspections (
         tenant_id, truck_id, fleet_registration, trailer_registration, odometer_reading,
         inspection_date, inspection_type, inspector_role, inspector_user_id, inspector_name, inspector_company,
         overall_result, total_items, passed_items, failed_items, na_items,
         failure_summary, general_comments, next_inspection_date,
         signed_off, signed_off_at, created_by_user_id, reference_number
       ) OUTPUT INSERTED.*
       VALUES (
         @tenantId, @truckId, @fleetReg, @trailerReg, @odo,
         @inspDate, @inspType, @inspRole, @inspUserId, @inspName, @inspCompany,
         @overall, @total, @passed, @failed, @na,
         @failureSummary, @comments, @nextDate,
         @signedOff, @signedAt, @userId, @refNum
       )`,
      {
        tenantId,
        truckId: b.truck_id || null,
        fleetReg: b.fleet_registration || null,
        trailerReg: b.trailer_registration || null,
        odo: b.odometer_reading != null ? Number(b.odometer_reading) : null,
        inspDate: b.inspection_date,
        inspType: b.inspection_type || 'pre_trip',
        inspRole: ['driver', 'supervisor', 'mechanic', 'manager'].includes(b.inspector_role) ? b.inspector_role : 'driver',
        inspUserId: b.inspector_user_id || null,
        inspName: b.inspector_name,
        inspCompany: b.inspector_company || null,
        overall, total, passed, failed, na,
        failureSummary,
        comments: b.general_comments || null,
        nextDate: b.next_inspection_date || null,
        signedOff: b.signed_off ? 1 : 0,
        signedAt: b.signed_off ? new Date() : null,
        userId: req.user.id,
        refNum,
      }
    );
    const insp = r.recordset?.[0];
    if (insp && checkItems.length > 0) {
      const validResults = ['pass', 'fail', 'n/a', 'na', 'not_checked'];
      const itemsJson = JSON.stringify(checkItems.map((it, idx) => ({
        category: it.category || '',
        item_code: it.item_code || '',
        item_label: it.item_label || '',
        result: validResults.includes(String(it.result || '').toLowerCase()) ? it.result.toLowerCase() : 'not_checked',
        severity: String(it.result || '').toLowerCase() === 'fail' ? (it.severity || 'minor') : null,
        comment: it.comment || null,
        sort_order: it.sort_order ?? idx,
      })));
      await query(
        `INSERT INTO truck_inspection_items (inspection_id, category, item_code, item_label, result, severity, comment, sort_order)
         SELECT @inspId, j.category, j.item_code, j.item_label, j.result, j.severity, j.comment, j.sort_order
         FROM OPENJSON(@itemsJson) WITH (
           category NVARCHAR(100), item_code NVARCHAR(20), item_label NVARCHAR(255),
           result NVARCHAR(20), severity NVARCHAR(20), comment NVARCHAR(MAX), sort_order INT
         ) j`,
        { inspId: insp.id, itemsJson }
      );
    }

    // Auto-create urgent maintenance schedule when inspection fails
    let autoSchedule = null;
    if (insp && overall === 'fail') {
      const schedR = await query(
        `INSERT INTO fleet_maintenance_schedules (
           tenant_id, truck_id, fleet_registration, trailer_registration,
           schedule_type, maintenance_subject, description, driver_name,
           action_date, scope_of_work, due_date, odometer_reading,
           priority, [status], linked_inspection_id, created_by_user_id
         ) OUTPUT INSERTED.*
         VALUES (
           @tenantId, @truckId, @fleetReg, @trailerReg,
           N'corrective', N'truck',
           @desc, @driver,
           CAST(SYSUTCDATETIME() AS DATE), @scope, CAST(SYSUTCDATETIME() AS DATE),
           @odo, N'critical', N'scheduled', @inspId, @userId
         )`,
        {
          tenantId,
          truckId: b.truck_id || null,
          fleetReg: b.fleet_registration || null,
          trailerReg: b.trailer_registration || null,
          desc: `URGENT — Auto-created from failed inspection ${refNum}. ${failed} item(s) failed.`,
          driver: b.inspector_name || null,
          scope: failureSummary ? failureSummary.slice(0, 2000) : 'Inspection failures require immediate attention.',
          odo: b.odometer_reading != null ? Number(b.odometer_reading) : null,
          inspId: insp.id,
          userId: req.user.id,
        }
      );
      autoSchedule = schedR.recordset?.[0] || null;
    }

    res.status(201).json({ inspection: insp, autoSchedule });
  } catch (err) { next(err); }
});

// ─── Upload attachments ───
router.post('/:id/attachments', upload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const itemId = req.body?.item_id || null;
    const results = [];
    for (const f of files) {
      const r = await query(
        `INSERT INTO truck_inspection_attachments (inspection_id, item_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id)
         OUTPUT INSERTED.* VALUES (@iid, @itemId, @fn, @fp, @fs, @mime, @uid)`,
        { iid: req.params.id, itemId, fn: f.originalname, fp: f.path, fs: f.size, mime: f.mimetype, uid: req.user?.id || null }
      );
      if (r.recordset?.[0]) results.push(r.recordset[0]);
    }
    res.status(201).json({ attachments: results });
  } catch (err) { next(err); }
});

router.get('/attachments/:id/download', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM truck_inspection_attachments WHERE id = @id`, { id: req.params.id });
    const att = r.recordset?.[0];
    if (!att) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(att.file_path)) return res.status(404).json({ error: 'File missing' });
    res.download(att.file_path, att.file_name);
  } catch (err) { next(err); }
});

router.delete('/attachments/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM truck_inspection_attachments WHERE id = @id`, { id: req.params.id });
    const att = r.recordset?.[0];
    if (att?.file_path && fs.existsSync(att.file_path)) fs.unlinkSync(att.file_path);
    await query(`DELETE FROM truck_inspection_attachments WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Export inspection PDF ───
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtDateTime(d) { if (!d) return '—'; return new Date(d).toLocaleString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

router.get('/:id/export/pdf', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const [inspR, itemsR] = await Promise.all([
      query(`SELECT i.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name FROM truck_inspections i LEFT JOIN contractor_trucks t ON t.id = i.truck_id LEFT JOIN users u ON u.id = i.created_by_user_id WHERE i.id = @id AND i.tenant_id = @tenantId`, { id: req.params.id, tenantId }),
      query(`SELECT * FROM truck_inspection_items WHERE inspection_id = @id ORDER BY sort_order`, { id: req.params.id }),
    ]);
    if (!inspR.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const insp = inspR.recordset[0];
    const items = itemsR.recordset || [];

    const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="inspection-${insp.fleet_registration || 'report'}-${nowForFilename()}.pdf"` });
      res.send(Buffer.concat(chunks));
    });

    const PW = doc.page.width;
    const M = 30;
    const CW = PW - M * 2;
    const BRAND = '#1E3A5F';
    const PASS_CLR = '#059669';
    const FAIL_CLR = '#DC2626';
    const WARN_CLR = '#D97706';
    const FONT = 'Helvetica';

    // Header
    doc.rect(0, 0, PW, 58).fill(BRAND);
    doc.font(FONT + '-Bold').fontSize(13).fillColor('#FFF').text('THINKERS AFRIKA', M, 10);
    doc.font(FONT).fontSize(8).text(`Truck inspection report — SA standard (side tipper coal)${insp.reference_number ? `  |  Ref: ${insp.reference_number}` : ''}`, M, 26);
    doc.font(FONT + '-Bold').fontSize(10).text(insp.fleet_registration || insp.truck_reg || '—', M, 40);
    const resultColor = insp.overall_result === 'pass' ? PASS_CLR : insp.overall_result === 'fail' ? FAIL_CLR : WARN_CLR;
    doc.roundedRect(PW - 170, 36, 140, 18, 3).fill(resultColor);
    doc.font(FONT + '-Bold').fontSize(10).fillColor('#FFF').text((insp.overall_result || 'PENDING').toUpperCase(), PW - 166, 40, { width: 132, align: 'center' });
    doc.fontSize(7).font(FONT).fillColor('#FFF').text(`Generated: ${formatDateForAppTz(new Date())}`, PW - 170, 14, { width: 140, align: 'right' });

    let y = 68;

    // Info grid
    const infoRows = [
      [['Fleet reg', insp.truck_reg || insp.fleet_registration || '—'], ['Trailer', insp.trailer_registration || '—'], ['ODO (km)', insp.odometer_reading != null ? Number(insp.odometer_reading).toLocaleString() : '—']],
      [['Date', fmtDate(insp.inspection_date)], ['Type', (insp.inspection_type || '').replace(/_/g, ' ')], ['Inspector', `${insp.inspector_name} (${(insp.inspector_role || '').replace(/_/g, ' ')})`]],
      [['Company', insp.inspector_company || '—'], ['Items', `${insp.total_items} total · ${insp.passed_items} pass · ${insp.failed_items} fail · ${insp.na_items} N/A`], ['Created by', insp.created_by_name || '—']],
    ];
    const colW = CW / 3;
    for (const row of infoRows) {
      doc.rect(M, y, CW, 20).fill('#EFF6FF');
      let x = M;
      for (const [label, value] of row) {
        doc.font(FONT).fontSize(5.5).fillColor('#6B7280').text(label.toUpperCase(), x + 3, y + 2.5, { width: colW - 6 });
        doc.font(FONT + '-Bold').fontSize(7.5).fillColor('#1a1a1a').text(String(value).slice(0, 55), x + 3, y + 10, { width: colW - 6 });
        x += colW;
      }
      y += 23;
    }
    y += 4;

    // Score summary bar
    const passW = insp.total_items > 0 ? (insp.passed_items / insp.total_items) * CW : 0;
    const failW = insp.total_items > 0 ? (insp.failed_items / insp.total_items) * CW : 0;
    const naW = insp.total_items > 0 ? (insp.na_items / insp.total_items) * CW : 0;
    doc.rect(M, y, CW, 8).fill('#E2E8F0');
    if (passW > 0) doc.rect(M, y, passW, 8).fill(PASS_CLR);
    if (failW > 0) doc.rect(M + passW, y, failW, 8).fill(FAIL_CLR);
    if (naW > 0) doc.rect(M + passW + failW, y, naW, 8).fill('#94A3B8');
    y += 12;
    doc.font(FONT).fontSize(6).fillColor('#6B7280');
    doc.rect(M, y, 6, 6).fill(PASS_CLR); doc.text(`Pass (${insp.passed_items})`, M + 8, y, { continued: false });
    doc.rect(M + 70, y, 6, 6).fill(FAIL_CLR); doc.fillColor('#6B7280').text(`Fail (${insp.failed_items})`, M + 78, y);
    doc.rect(M + 140, y, 6, 6).fill('#94A3B8'); doc.fillColor('#6B7280').text(`N/A (${insp.na_items})`, M + 148, y);
    y += 14;

    // Checklist items by category
    let currentCat = '';
    for (const it of items) {
      if (y > doc.page.height - 50) { doc.addPage(); y = M; }
      if (it.category !== currentCat) {
        currentCat = it.category;
        y += 4;
        if (y + 26 > doc.page.height - 50) { doc.addPage(); y = M; }
        doc.rect(M, y, CW, 12).fill(BRAND);
        doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFF').text(currentCat.toUpperCase(), M + 4, y + 3, { width: CW - 8 });
        y += 14;
      }
      const rv = String(it.result || 'not_checked').toLowerCase();
      const resClr = rv === 'pass' ? PASS_CLR : rv === 'fail' ? FAIL_CLR : '#6B7280';
      const resLabel = rv === 'pass' ? 'PASS' : rv === 'fail' ? 'FAIL' : rv === 'n/a' || rv === 'na' ? 'N/A' : '—';
      const rowH = it.comment ? 18 : 12;
      if (y + rowH > doc.page.height - 40) { doc.addPage(); y = M; }
      const bg = rv === 'fail' ? '#FEF2F2' : '#FFFFFF';
      doc.rect(M, y, CW, rowH).fill(bg).strokeColor('#E2E8F0').lineWidth(0.3).stroke();
      doc.font(FONT).fontSize(6.5).fillColor('#6B7280').text(it.item_code, M + 3, y + 3, { width: 40 });
      doc.font(FONT).fontSize(6.5).fillColor('#1a1a1a').text(it.item_label, M + 42, y + 3, { width: CW - 110 });
      doc.roundedRect(M + CW - 50, y + 2, 44, 9, 2).fill(resClr);
      doc.font(FONT + '-Bold').fontSize(6).fillColor('#FFF').text(resLabel, M + CW - 48, y + 4, { width: 40, align: 'center' });
      if (it.comment) {
        doc.font(FONT + '-Oblique').fontSize(5.5).fillColor('#6B7280').text(`Note: ${it.comment}`, M + 42, y + 12, { width: CW - 110 });
      }
      y += rowH;
    }

    // General comments
    if (insp.general_comments) {
      y += 8;
      if (y > doc.page.height - 60) { doc.addPage(); y = M; }
      doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('GENERAL COMMENTS', M, y);
      y += 10;
      doc.font(FONT).fontSize(7).fillColor('#1a1a1a').text(insp.general_comments, M, y, { width: CW });
      y += doc.heightOfString(insp.general_comments, { width: CW }) + 6;
    }

    // Failure summary
    if (insp.failure_summary) {
      y += 4;
      if (y > doc.page.height - 60) { doc.addPage(); y = M; }
      doc.rect(M, y, CW, 3).fill(FAIL_CLR);
      y += 6;
      doc.font(FONT + '-Bold').fontSize(7).fillColor(FAIL_CLR).text('AUTOMATIC FAILURE DETECTION SUMMARY', M, y);
      y += 10;
      doc.font(FONT).fontSize(6.5).fillColor('#1a1a1a').text(insp.failure_summary, M, y, { width: CW });
      y += doc.heightOfString(insp.failure_summary, { width: CW }) + 6;
    }

    // Sign-off
    y += 8;
    if (y + 28 > doc.page.height - 50) { doc.addPage(); y = M; }
    doc.rect(M, y, CW, 28).fill('#F8FAFC').strokeColor('#E2E8F0').lineWidth(0.3).stroke();
    doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('SIGN-OFF', M + 4, y + 4);
    doc.font(FONT).fontSize(7).fillColor('#1a1a1a').text(`Inspector: ${insp.inspector_name}`, M + 4, y + 14);
    doc.text(`Signed: ${insp.signed_off ? 'Yes' : 'No'} ${insp.signed_off_at ? `at ${fmtDateTime(insp.signed_off_at)}` : ''}`, M + CW / 2, y + 14);
    if (insp.next_inspection_date) doc.text(`Next inspection: ${fmtDate(insp.next_inspection_date)}`, M + 4, y + 22);

    // Trim any extra buffered pages and end — no switchToPage footer loop
    const range = doc.bufferedPageRange();
    doc._pageBuffer.length = range.count;
    doc.end();
  } catch (err) { next(err); }
});

export default router;
