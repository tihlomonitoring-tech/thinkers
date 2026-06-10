import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../db.js';
import { SA_INSPECTION_CHECKLIST, computeResult } from '../lib/saInspectionChecklist.js';
import { saveSignaturePng } from '../lib/signatureFile.js';

const router = Router();
const uploadRoot = path.join(process.cwd(), 'uploads', 'inspections');

const submitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 120 },
}).any();

function sessionReport(req, res) {
  const report = req.session?.reportBreakdown;
  if (!report?.driverId || !report?.tenantId) {
    res.status(401).json({ error: 'Session expired. Enter your ID number again.' });
    return null;
  }
  return report;
}

function genInspRef() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EXT-${y}${m}-${r}`;
}

function normReg(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** GET checklist (public driver session). */
router.get('/checklist', (req, res) => {
  if (!sessionReport(req, res)) return;
  res.json({ checklist: SA_INSPECTION_CHECKLIST });
});

/** GET trucks list for search (same tenant as verified driver). */
router.get('/trucks', async (req, res, next) => {
  try {
    const report = sessionReport(req, res);
    if (!report) return;
    const result = await query(
      `SELECT id, registration, make_model, fleet_no, contractor_id, trailer_1_reg_no, trailer_2_reg_no
       FROM contractor_trucks
       WHERE tenant_id = @tenantId
       ORDER BY registration ASC`,
      { tenantId: report.tenantId }
    );
    res.json({
      trucks: (result.recordset || []).map((row) => ({
        id: row.id,
        registration: row.registration || '',
        make_model: row.make_model || '',
        fleet_no: row.fleet_no || '',
        contractor_id: row.contractor_id || null,
        trailer_1_reg_no: row.trailer_1_reg_no || '',
        trailer_2_reg_no: row.trailer_2_reg_no || '',
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET lookup truck by registration in tenant fleet. */
router.get('/trucks/lookup', async (req, res, next) => {
  try {
    const report = sessionReport(req, res);
    if (!report) return;
    const registration = normReg(req.query.registration);
    if (!registration) return res.status(400).json({ error: 'registration required' });
    const result = await query(
      `SELECT TOP 1 id, registration, make_model, fleet_no, contractor_id, trailer_1_reg_no, trailer_2_reg_no
       FROM contractor_trucks
       WHERE tenant_id = @tenantId
         AND UPPER(REPLACE(LTRIM(RTRIM(registration)), ' ', '')) = @registration`,
      { tenantId: report.tenantId, registration }
    );
    const row = result.recordset?.[0];
    if (!row) return res.json({ truck: null });
    res.json({
      truck: {
        id: row.id,
        registration: row.registration || '',
        make_model: row.make_model || '',
        fleet_no: row.fleet_no || '',
        contractor_id: row.contractor_id || null,
        trailer_1_reg_no: row.trailer_1_reg_no || '',
        trailer_2_reg_no: row.trailer_2_reg_no || '',
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST submit external driver inspection (multipart: payload JSON + photo_{item_code} files). */
router.post('/submit', submitUpload, async (req, res, next) => {
  try {
    const report = sessionReport(req, res);
    if (!report) return;
    const { driverId, tenantId, driverName } = report;

    let payload = {};
    try {
      payload = JSON.parse(req.body?.payload || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid payload.' });
    }

    const fleetReg = String(payload.fleet_registration || '').trim();
    const contractorName = String(payload.contractor_name || '').trim();
    const inspectionDate = String(payload.inspection_date || '').trim();
    const inspectionTime = String(payload.inspection_time || '00:00').trim();
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (!fleetReg) return res.status(400).json({ error: 'Truck registration is required.' });
    if (!contractorName) return res.status(400).json({ error: 'Contractor name is required.' });
    if (!inspectionDate) return res.status(400).json({ error: 'Inspection date is required.' });
    if (items.length === 0) return res.status(400).json({ error: 'Inspection checklist is required.' });

    const truckId = payload.truck_id || null;
    let contractorId = payload.contractor_id || null;

    if (truckId && !contractorId) {
      const tr = await query(
        `SELECT contractor_id FROM contractor_trucks WHERE id = @id AND tenant_id = @tenantId`,
        { id: truckId, tenantId }
      );
      contractorId = tr.recordset?.[0]?.contractor_id || null;
    }
    if (!contractorId) {
      const dr = await query(
        `SELECT contractor_id FROM contractor_drivers WHERE id = @id AND tenant_id = @tenantId`,
        { id: driverId, tenantId }
      );
      contractorId = dr.recordset?.[0]?.contractor_id || null;
    }

    const inspectionDatetime = `${inspectionDate}T${inspectionTime || '00:00'}:00`;
    const trailer1 = String(payload.trailer_1_registration || '').trim() || null;
    const trailer2 = String(payload.trailer_2_registration || '').trim() || null;
    const trailerCombined = [trailer1, trailer2].filter(Boolean).join(' / ') || null;

    const { total, passed, failed, na, overall } = computeResult(items);
    const failedLabels = items
      .filter((x) => String(x.result).toLowerCase() === 'fail')
      .map((x) => `${x.item_code}: ${x.item_label}`);
    const failureSummary = failedLabels.length > 0 ? failedLabels.join('\n') : null;
    const refNum = genInspRef();

    const inspR = await query(
      `INSERT INTO truck_inspections (
         tenant_id, truck_id, fleet_registration, trailer_registration,
         trailer_1_registration, trailer_2_registration,
         inspection_date, inspection_datetime, inspection_type,
         inspector_role, inspector_name, inspector_company,
         overall_result, total_items, passed_items, failed_items, na_items,
         failure_summary, general_comments, signed_off, signed_off_at,
         created_by_user_id, reference_number,
         source, driver_id, contractor_id
       ) OUTPUT INSERTED.*
       VALUES (
         @tenantId, @truckId, @fleetReg, @trailerReg,
         @trailer1, @trailer2,
         @inspDate, @inspDatetime, N'side_tipper_national',
         N'driver', @inspName, @inspCompany,
         @overall, @total, @passed, @failed, @na,
         @failureSummary, @comments, 1, SYSUTCDATETIME(),
         NULL, @refNum,
         N'external_driver', @driverId, @contractorId
       )`,
      {
        tenantId,
        truckId,
        fleetReg,
        trailerReg: trailerCombined,
        trailer1,
        trailer2,
        inspDate: inspectionDate,
        inspDatetime: inspectionDatetime,
        inspName: driverName || 'Driver',
        inspCompany: contractorName,
        overall,
        total,
        passed,
        failed,
        na,
        failureSummary,
        comments: payload.general_comments || null,
        refNum,
        driverId,
        contractorId,
      }
    );
    const insp = inspR.recordset?.[0];
    if (!insp) return res.status(500).json({ error: 'Failed to save inspection.' });

    const validResults = ['pass', 'fail', 'n/a', 'na', 'not_checked'];
    const itemsJson = JSON.stringify(
      items.map((it, idx) => ({
        category: it.category || '',
        item_code: it.item_code || '',
        item_label: it.item_label || '',
        result: validResults.includes(String(it.result || '').toLowerCase()) ? String(it.result).toLowerCase() : 'not_checked',
        severity: String(it.result || '').toLowerCase() === 'fail' ? (it.severity || 'minor') : null,
        comment: it.comment || null,
        sort_order: it.sort_order ?? idx,
      }))
    );
    await query(
      `INSERT INTO truck_inspection_items (inspection_id, category, item_code, item_label, result, severity, comment, sort_order)
       SELECT @inspId, j.category, j.item_code, j.item_label, j.result, j.severity, j.comment, j.sort_order
       FROM OPENJSON(@itemsJson) WITH (
         category NVARCHAR(100), item_code NVARCHAR(20), item_label NVARCHAR(255),
         result NVARCHAR(20), severity NVARCHAR(20), comment NVARCHAR(MAX), sort_order INT
       ) j`,
      { inspId: insp.id, itemsJson }
    );

    const itemRows = await query(
      `SELECT id, item_code FROM truck_inspection_items WHERE inspection_id = @inspId`,
      { inspId: insp.id }
    );
    const codeToItemId = Object.fromEntries((itemRows.recordset || []).map((r) => [r.item_code, r.id]));

    const files = req.files || [];
    const tenantDir = path.join(uploadRoot, String(tenantId));
    if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true });

    for (const f of files) {
      const field = f.fieldname || '';
      const match = field.match(/^photo_(.+)$/i);
      if (!match) continue;
      const itemCode = match[1];
      const itemId = codeToItemId[itemCode];
      if (!itemId) continue;
      const ext = path.extname(f.originalname) || (f.mimetype?.includes('png') ? '.png' : '.jpg');
      const fileName = `${insp.id}_${itemCode}${ext}`;
      const absPath = path.join(process.cwd(), 'uploads', 'inspections', String(tenantId), fileName);
      fs.writeFileSync(absPath, f.buffer);
      await query(
        `INSERT INTO truck_inspection_attachments (inspection_id, item_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id)
         VALUES (@inspId, @itemId, @fn, @fp, @fs, @mime, NULL)`,
        {
          inspId: insp.id,
          itemId,
          fn: fileName,
          fp: absPath,
          fs: f.size,
          mime: f.mimetype || 'image/jpeg',
        }
      );
    }

    if (payload.inspector_signature) {
      try {
        const sigPath = saveSignaturePng(payload.inspector_signature, {
          tenantId, inspectionId: insp.id, role: 'inspector',
        });
        await query(
          `UPDATE truck_inspections SET inspector_signature_path = @sigPath, inspector_signed_at = SYSUTCDATETIME(),
           signed_off = 1, signed_off_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
          { id: insp.id, sigPath }
        );
      } catch { /* signature optional fallback */ }
    }

    res.status(201).json({ ok: true, inspection: insp, reference_number: refNum });
  } catch (err) {
    next(err);
  }
});

export default router;
