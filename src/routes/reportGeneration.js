import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { toYmdFromDbOrString } from '../lib/appTime.js';
import { buildProductionReportDataBundle } from '../lib/reportGenerationData.js';
import { generateProductionReportWithAi } from '../lib/reportGenerationAi.js';

function normalizeYmdParam(v) {
  const ymd = toYmdFromDbOrString(v);
  return ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function normalizeOptionalDate(v) {
  if (v == null || v === '') return null;
  return normalizeYmdParam(v);
}

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('report_generation'));

const uploadsDir = path.join(process.cwd(), 'uploads', 'command-centre', 'production-reports');
const chartUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.png').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
      cb(null, `${req.params.id || 'new'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype));
  },
}).single('file');

function getRow(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
    const lower = String(k).toLowerCase();
    for (const rk of Object.keys(row)) {
      if (String(rk).toLowerCase() === lower) return row[rk];
    }
  }
  return undefined;
}

function rowToReport(row, attachments = []) {
  if (!row) return null;
  let content = null;
  let dataBundle = null;
  try {
    content = row.content_json ? JSON.parse(row.content_json) : null;
  } catch (_) {}
  try {
    dataBundle = row.data_bundle_json ? JSON.parse(row.data_bundle_json) : null;
  } catch (_) {}
  return {
    id: getRow(row, 'id'),
    tenant_id: getRow(row, 'tenant_id'),
    title: getRow(row, 'title'),
    route_id: getRow(row, 'route_id'),
    route_name: getRow(row, 'route_name'),
    date_from: getRow(row, 'date_from'),
    date_to: getRow(row, 'date_to'),
    prepared_by: getRow(row, 'prepared_by'),
    submitted_date: getRow(row, 'submitted_date'),
    status: getRow(row, 'status'),
    content,
    data_bundle: dataBundle,
    ai_model: getRow(row, 'ai_model'),
    generated_at: getRow(row, 'generated_at'),
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
    attachments,
  };
}

async function loadAttachments(reportId) {
  const r = await query(
    `SELECT id, slot_key, label, file_name, stored_path, mime_type, sort_order, created_at
     FROM cc_production_report_attachments WHERE report_id = @reportId ORDER BY sort_order ASC, created_at ASC`,
    { reportId }
  );
  return (r.recordset || []).map((a) => ({
    id: getRow(a, 'id'),
    slot_key: getRow(a, 'slot_key'),
    label: getRow(a, 'label'),
    file_name: getRow(a, 'file_name'),
    mime_type: getRow(a, 'mime_type'),
    sort_order: getRow(a, 'sort_order'),
    created_at: getRow(a, 'created_at'),
  }));
}

/** GET list production reports */
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;
    const r = await query(
      `SELECT id, title, route_name, date_from, date_to, status, prepared_by, generated_at, created_at, updated_at
       FROM cc_production_reports
       WHERE (@tenantId IS NULL OR tenant_id = @tenantId)
       ORDER BY created_at DESC`,
      { tenantId }
    );
    res.json({ reports: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** POST create draft */
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const dateFrom = normalizeYmdParam(body.date_from || body.dateFrom);
    const dateTo = normalizeYmdParam(body.date_to || body.dateTo);
    if (!title || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'title, date_from, and date_to are required (YYYY-MM-DD).' });
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
    const ins = await query(
      `INSERT INTO cc_production_reports (
        tenant_id, created_by_user_id, title, route_id, route_name, date_from, date_to,
        prepared_by, submitted_date, status
      )
      OUTPUT INSERTED.*
      VALUES (
        @tenantId, @userId, @title, @routeId, @routeName, @dateFrom, @dateTo,
        @preparedBy, @submittedDate, N'draft'
      )`,
      {
        tenantId: req.user?.tenant_id ?? null,
        userId,
        title,
        routeId: String(body.route_id || body.routeId || '').trim() || null,
        routeName: String(body.route_name || body.routeName || '').trim() || null,
        dateFrom,
        dateTo,
        preparedBy: String(body.prepared_by || body.preparedBy || 'Tihlo (Thinkers Afrika)').trim(),
        submittedDate: normalizeOptionalDate(body.submitted_date ?? body.submittedDate),
      }
    );
    const row = ins.recordset?.[0];
    res.status(201).json({ report: rowToReport(row, []) });
  } catch (err) {
    next(err);
  }
});

/** GET one */
router.get('/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    const attachments = await loadAttachments(req.params.id);
    res.json({ report: rowToReport(row, attachments) });
  } catch (err) {
    next(err);
  }
});

/** PATCH update metadata or content */
router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const existing = await query(`SELECT id FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Report not found.' });

    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id };
    const fields = [
      ['title', 'title'],
      ['route_id', 'routeId'],
      ['route_name', 'routeName'],
      ['date_from', 'dateFrom'],
      ['date_to', 'dateTo'],
      ['prepared_by', 'preparedBy'],
      ['submitted_date', 'submittedDate'],
      ['status', 'status'],
    ];
    for (const [col, key] of fields) {
      const val = body[col] ?? body[key];
      if (val !== undefined) {
        sets.push(`${col} = @${col}`);
        if (col === 'date_from' || col === 'date_to') {
          const ymd = normalizeYmdParam(val);
          if (!ymd) return res.status(400).json({ error: `Invalid ${col}; use YYYY-MM-DD.` });
          params[col] = ymd;
        } else if (col === 'submitted_date') {
          params[col] = normalizeOptionalDate(val);
        } else {
          params[col] = val;
        }
      }
    }
    if (body.content !== undefined || body.content_json !== undefined) {
      sets.push('content_json = @content_json');
      params.content_json = JSON.stringify(body.content ?? body.content_json);
    }
    if (body.data_bundle !== undefined || body.data_bundle_json !== undefined) {
      sets.push('data_bundle_json = @data_bundle_json');
      params.data_bundle_json = JSON.stringify(body.data_bundle ?? body.data_bundle_json);
    }

    await query(`UPDATE cc_production_reports SET ${sets.join(', ')} WHERE id = @id`, params);
    const r = await query(`SELECT * FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    const attachments = await loadAttachments(req.params.id);
    res.json({ report: rowToReport(r.recordset?.[0], attachments) });
  } catch (err) {
    next(err);
  }
});

/** DELETE report */
router.delete('/:id', async (req, res, next) => {
  try {
    const attRows = await query(
      `SELECT stored_path FROM cc_production_report_attachments WHERE report_id = @id`,
      { id: req.params.id }
    );
    await query(`DELETE FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    for (const a of attRows.recordset || []) {
      const stored = getRow(a, 'stored_path');
      if (stored && fs.existsSync(stored)) {
        try {
          fs.unlinkSync(stored);
        } catch (_) {}
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST build data bundle preview */
router.post('/:id/data-bundle', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });

    const bundle = await buildProductionReportDataBundle({
      tenantId: req.user?.tenant_id ?? null,
      dateFrom: normalizeYmdParam(getRow(row, 'date_from')),
      dateTo: normalizeYmdParam(getRow(row, 'date_to')),
      routeId: getRow(row, 'route_id') || null,
      routeName: getRow(row, 'route_name'),
    });

    await query(
      `UPDATE cc_production_reports SET data_bundle_json = @json, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, json: JSON.stringify(bundle) }
    );

    res.json({ data_bundle: bundle });
  } catch (err) {
    next(err);
  }
});

/** POST AI generate report content */
router.post('/:id/generate', async (req, res, next) => {
  try {
    const r = await query(`SELECT * FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });

    let bundle;
    try {
      bundle = row.data_bundle_json ? JSON.parse(row.data_bundle_json) : null;
    } catch (_) {}
    if (!bundle) {
      bundle = await buildProductionReportDataBundle({
        tenantId: req.user?.tenant_id ?? null,
        dateFrom: normalizeYmdParam(getRow(row, 'date_from')),
        dateTo: normalizeYmdParam(getRow(row, 'date_to')),
        routeId: getRow(row, 'route_id') || null,
        routeName: getRow(row, 'route_name'),
      });
    }

    const aiResult = await generateProductionReportWithAi({
      dataBundle: bundle,
      title: getRow(row, 'title'),
      preparedBy: getRow(row, 'prepared_by'),
      dateFrom: getRow(row, 'date_from'),
      dateTo: getRow(row, 'date_to'),
      submittedDate: getRow(row, 'submitted_date'),
      routeName: getRow(row, 'route_name'),
      extraInstructions: String(req.body?.instructions || '').trim(),
    });

    if (aiResult.error) {
      return res.status(aiResult.raw ? 502 : 503).json({ error: aiResult.error, raw: aiResult.raw });
    }

    const content = aiResult.content;
    await query(
      `UPDATE cc_production_reports SET
        content_json = @content,
        data_bundle_json = @bundle,
        ai_model = @model,
        generated_at = SYSUTCDATETIME(),
        status = N'generated',
        updated_at = SYSUTCDATETIME()
       WHERE id = @id`,
      {
        id: req.params.id,
        content: JSON.stringify(content),
        bundle: JSON.stringify(bundle),
        model: aiResult.model,
      }
    );

    const updated = await query(`SELECT * FROM cc_production_reports WHERE id = @id`, { id: req.params.id });
    const attachments = await loadAttachments(req.params.id);
    res.json({ report: rowToReport(updated.recordset?.[0], attachments), content });
  } catch (err) {
    next(err);
  }
});

/** POST upload chart image */
router.post('/:id/attachments', (req, res, next) => {
  chartUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
      const slotKey = String(req.body?.slot_key || req.body?.slotKey || 'custom_chart').trim().slice(0, 100);
      const label = String(req.body?.label || '').trim().slice(0, 255) || null;
      const sortOrder = parseInt(req.body?.sort_order || req.body?.sortOrder || '0', 10) || 0;

      const ins = await query(
        `INSERT INTO cc_production_report_attachments (
          report_id, slot_key, label, file_name, stored_path, mime_type, sort_order
        )
        OUTPUT INSERTED.*
        VALUES (@reportId, @slotKey, @label, @fileName, @storedPath, @mimeType, @sortOrder)`,
        {
          reportId: req.params.id,
          slotKey,
          label,
          fileName: req.file.originalname,
          storedPath: req.file.path,
          mimeType: req.file.mimetype,
          sortOrder,
        }
      );
      const a = ins.recordset?.[0];
      res.status(201).json({
        attachment: {
          id: getRow(a, 'id'),
          slot_key: getRow(a, 'slot_key'),
          label: getRow(a, 'label'),
          file_name: getRow(a, 'file_name'),
          mime_type: getRow(a, 'mime_type'),
        },
      });
    } catch (e) {
      next(e);
    }
  });
});

/** DELETE attachment */
router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT stored_path FROM cc_production_report_attachments WHERE id = @attachmentId AND report_id = @reportId`,
      { attachmentId: req.params.attachmentId, reportId: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    await query(`DELETE FROM cc_production_report_attachments WHERE id = @attachmentId`, {
      attachmentId: req.params.attachmentId,
    });
    const stored = getRow(row, 'stored_path');
    if (stored && fs.existsSync(stored)) {
      try {
        fs.unlinkSync(stored);
      } catch (_) {}
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET attachment file */
router.get('/:id/attachments/:attachmentId/file', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT file_name, stored_path, mime_type FROM cc_production_report_attachments WHERE id = @attachmentId AND report_id = @reportId`,
      { attachmentId: req.params.attachmentId, reportId: req.params.id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    const stored = getRow(row, 'stored_path');
    if (!stored || !fs.existsSync(stored)) return res.status(404).json({ error: 'File missing on server.' });
    res.setHeader('Content-Type', getRow(row, 'mime_type') || 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(getRow(row, 'file_name') || 'chart.png')}"`);
    fs.createReadStream(stored).pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
