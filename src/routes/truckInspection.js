import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { formatDateForAppTz, nowForFilename } from '../lib/emailService.js';
import { SA_INSPECTION_CHECKLIST, flatChecklist, computeResult } from '../lib/saInspectionChecklist.js';
import { renderTruckInspectionPdf } from '../lib/truckInspectionPdf.js';
import { saveSignaturePng } from '../lib/signatureFile.js';

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
    let sql = `SELECT i.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name,
               d.full_name AS driver_first_name, d.surname AS driver_surname,
               c.name AS contractor_name
               FROM truck_inspections i
               LEFT JOIN contractor_trucks t ON t.id = i.truck_id
               LEFT JOIN users u ON u.id = i.created_by_user_id
               LEFT JOIN contractor_drivers d ON d.id = i.driver_id
               LEFT JOIN contractors c ON c.id = i.contractor_id
               WHERE i.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.source && req.query.source !== 'all') { sql += ` AND i.source = @source`; params.source = req.query.source; }
    if (req.query.truck_id) { sql += ` AND i.truck_id = @truckId`; params.truckId = req.query.truck_id; }
    if (req.query.result && req.query.result !== 'all') { sql += ` AND i.overall_result = @result`; params.result = req.query.result; }
    if (req.query.inspector_role && req.query.inspector_role !== 'all') { sql += ` AND i.inspector_role = @role`; params.role = req.query.inspector_role; }
    if (req.query.from) { sql += ` AND i.inspection_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND i.inspection_date <= @to`; params.to = req.query.to; }
    if (req.query.search) {
      sql += ` AND (i.fleet_registration LIKE @search OR i.inspector_name LIKE @search OR i.reference_number LIKE @search
                OR i.trailer_1_registration LIKE @search OR i.trailer_2_registration LIKE @search
                OR i.inspector_company LIKE @search OR c.name LIKE @search
                OR d.full_name LIKE @search OR d.surname LIKE @search)`;
      params.search = `%${req.query.search}%`;
    }
    sql += ` ORDER BY COALESCE(i.inspection_datetime, i.inspection_date) DESC, i.created_at DESC`;
    const r = await query(sql, params);
    const inspections = (r.recordset || []).map((row) => ({
      ...row,
      driver_name: [row.driver_first_name, row.driver_surname].filter(Boolean).join(' ').trim() || null,
    }));
    res.json({ inspections });
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

// ─── Inspector signature ───
router.post('/:id/sign/inspector', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { signature_data } = req.body || {};
    if (!signature_data) return res.status(400).json({ error: 'signature_data required' });

    const inspR = await query(
      `SELECT id, inspector_name FROM truck_inspections WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    const insp = inspR.recordset?.[0];
    if (!insp) return res.status(404).json({ error: 'Inspection not found' });

    const sigPath = saveSignaturePng(signature_data, {
      tenantId, inspectionId: insp.id, role: 'inspector',
    });

    const r = await query(
      `UPDATE truck_inspections SET
         inspector_signature_path = @sigPath,
         inspector_signed_at = SYSUTCDATETIME(),
         signed_off = 1,
         signed_off_at = COALESCE(signed_off_at, SYSUTCDATETIME()),
         updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId, sigPath }
    );
    res.json({ inspection: r.recordset?.[0] });
  } catch (err) { next(err); }
});

// ─── Supervisor / maintenance officer signature ───
router.post('/:id/sign/supervisor', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { signature_data, supervisor_name, supervisor_role } = req.body || {};
    if (!signature_data) return res.status(400).json({ error: 'signature_data required' });
    if (!supervisor_name?.trim()) return res.status(400).json({ error: 'supervisor_name required' });
    const role = ['supervisor', 'maintenance_officer'].includes(supervisor_role) ? supervisor_role : 'supervisor';

    const inspR = await query(
      `SELECT id FROM truck_inspections WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    if (!inspR.recordset?.[0]) return res.status(404).json({ error: 'Inspection not found' });

    const sigPath = saveSignaturePng(signature_data, {
      tenantId, inspectionId: req.params.id, role: 'supervisor',
    });

    const r = await query(
      `UPDATE truck_inspections SET
         supervisor_signature_path = @sigPath,
         supervisor_signed_at = SYSUTCDATETIME(),
         supervisor_name = @name,
         supervisor_role = @role,
         supervisor_user_id = @uid,
         updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        id: req.params.id, tenantId, sigPath,
        name: supervisor_name.trim(),
        role,
        uid: req.user?.id || null,
      }
    );
    res.json({ inspection: r.recordset?.[0] });
  } catch (err) { next(err); }
});

router.get('/:id/signature/:role/image', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const role = req.params.role;
    if (!['inspector', 'supervisor'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const r = role === 'supervisor'
      ? await query(
        `SELECT supervisor_signature_path AS sig_path FROM truck_inspections WHERE id = @id AND tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      )
      : await query(
        `SELECT inspector_signature_path AS sig_path FROM truck_inspections WHERE id = @id AND tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      );
    const sigPath = r.recordset?.[0]?.sig_path;
    if (!sigPath || !fs.existsSync(sigPath)) return res.status(404).json({ error: 'Signature not found' });
    res.set('Content-Type', 'image/png');
    res.sendFile(path.resolve(sigPath));
  } catch (err) { next(err); }
});

// ─── Export inspection PDF ───
router.get('/:id/export/pdf', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const [inspR, itemsR, attR] = await Promise.all([
      query(
        `SELECT i.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name,
                c.name AS contractor_name
         FROM truck_inspections i
         LEFT JOIN contractor_trucks t ON t.id = i.truck_id
         LEFT JOIN users u ON u.id = i.created_by_user_id
         LEFT JOIN contractors c ON c.id = i.contractor_id
         WHERE i.id = @id AND i.tenant_id = @tenantId`,
        { id: req.params.id, tenantId }
      ),
      query(`SELECT * FROM truck_inspection_items WHERE inspection_id = @id ORDER BY sort_order`, { id: req.params.id }),
      query(`SELECT * FROM truck_inspection_attachments WHERE inspection_id = @id ORDER BY created_at`, { id: req.params.id }),
    ]);
    if (!inspR.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const insp = inspR.recordset[0];
    const items = itemsR.recordset || [];
    const attachments = attR.recordset || [];

    const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const prefix = insp.source === 'external_driver' ? 'external-inspection' : 'inspection';
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${prefix}-${insp.fleet_registration || 'report'}-${nowForFilename()}.pdf"`,
      });
      res.send(Buffer.concat(chunks));
    });

    renderTruckInspectionPdf(doc, {
      inspection: insp,
      items,
      attachments,
      generatedAtLabel: formatDateForAppTz(new Date()),
    });

    const range = doc.bufferedPageRange();
    doc._pageBuffer.length = range.count;
    doc.end();
  } catch (err) { next(err); }
});

export default router;
