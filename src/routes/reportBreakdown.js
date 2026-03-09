import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../db.js';
import { getCommandCentreAndRectorEmailsForRoute } from '../lib/emailRecipients.js';
import { breakdownReportHtml, breakdownConfirmationToDriverHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

const router = Router();
const uploadDir = path.join(process.cwd(), 'uploads', 'incidents');

const incidentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
}).fields([
  { name: 'loading_slip', maxCount: 1 },
  { name: 'seal_1', maxCount: 1 },
  { name: 'seal_2', maxCount: 1 },
  { name: 'picture_problem', maxCount: 1 },
]);

/** POST verify driver by ID number (public). Sets session.reportBreakdown for submit. */
router.post('/verify', async (req, res, next) => {
  try {
    const idNumber = (req.body?.id_number ?? req.body?.idNumber ?? '').toString().trim();
    if (!idNumber) {
      return res.status(400).json({ error: 'Please enter your ID number.' });
    }
    const result = await query(
      `SELECT TOP 1 id, tenant_id, full_name, surname
       FROM contractor_drivers
       WHERE id_number IS NOT NULL AND LOWER(LTRIM(RTRIM(id_number))) = LOWER(LTRIM(RTRIM(@idNumber)))`,
      { idNumber }
    );
    const row = result.recordset?.[0];
    if (!row) {
      return res.status(404).json({ error: 'No driver found with this ID number. Please check and try again.' });
    }
    const driverId = row.id;
    const tenantId = row.tenant_id;
    const driverName = [row.full_name, row.surname].filter(Boolean).join(' ').trim() || 'Driver';
    if (!req.session) req.session = {};
    req.session.reportBreakdown = {
      driverId,
      tenantId,
      idNumber: idNumber,
      driverName,
    };
    req.session.cookie.maxAge = 30 * 60 * 1000; // 30 minutes for this flow
    res.json({ ok: true, driverName });
  } catch (err) {
    next(err);
  }
});

/** GET trucks for the verified driver's tenant (for truck search/select). Requires session set by /verify. */
router.get('/trucks', async (req, res, next) => {
  try {
    const report = req.session?.reportBreakdown;
    if (!report?.driverId || !report?.tenantId) {
      return res.status(401).json({ error: 'Session expired. Enter your ID number again.' });
    }
    const { tenantId } = report;
    const result = await query(
      `SELECT id, registration, make_model, fleet_no
       FROM contractor_trucks
       WHERE tenant_id = @tenantId
       ORDER BY registration ASC`,
      { tenantId }
    );
    const trucks = (result.recordset || []).map((row) => ({
      id: row.id,
      registration: row.registration || '',
      make_model: row.make_model || '',
      fleet_no: row.fleet_no || '',
    }));
    res.json({ trucks });
  } catch (err) {
    next(err);
  }
});

/** GET routes for the verified driver (for route dropdown). Requires session set by /verify. */
router.get('/routes', async (req, res, next) => {
  try {
    const report = req.session?.reportBreakdown;
    if (!report?.driverId || !report?.tenantId) {
      return res.status(401).json({ error: 'Session expired. Enter your ID number again.' });
    }
    const { driverId, tenantId } = report;
    const result = await query(
      `SELECT r.id, r.name
       FROM contractor_routes r
       INNER JOIN contractor_route_drivers rd ON rd.route_id = r.id AND rd.driver_id = @driverId
       WHERE r.tenant_id = @tenantId
       ORDER BY r.[order] ASC, r.name ASC`,
      { driverId, tenantId }
    );
    const routes = (result.recordset || []).map((row) => ({ id: row.id, name: row.name || '' }));
    res.json({ routes });
  } catch (err) {
    next(err);
  }
});

/** POST submit breakdown (public). Requires session set by /verify. Same incident shape as contractor. */
router.post('/submit', incidentUpload, async (req, res, next) => {
  try {
    const report = req.session?.reportBreakdown;
    if (!report?.driverId || !report?.tenantId) {
      return res.status(401).json({ error: 'Session expired. Please enter your ID number again to report a breakdown.' });
    }
    const { driverId, tenantId } = report;

    const files = req.files || {};
    const loadingSlip = files.loading_slip?.[0];
    const seal1 = files.seal_1?.[0];
    const seal2 = files.seal_2?.[0];
    const pictureProblem = files.picture_problem?.[0];
    if (!loadingSlip || !seal1 || !seal2 || !pictureProblem) {
      return res.status(400).json({
        error: 'All four attachments are required: Loading slip, Seal 1, Seal 2, Picture of the problem.',
      });
    }

    let payload = {};
    const rawPayload = req.body?.payload ?? req.body?.data;
    if (rawPayload) {
      try {
        payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid payload JSON' });
      }
    }
    if (Object.keys(payload).length === 0 && req.body && typeof req.body === 'object') {
      payload = {
        truck_id: req.body.truck_id,
        type: req.body.type,
        title: req.body.title,
        description: req.body.description,
        severity: req.body.severity,
        actions_taken: req.body.actions_taken,
        reported_date: req.body.reported_date,
        reported_time: req.body.reported_time,
        location: req.body.location,
      };
    }

    const truck_id = (payload.truck_id && String(payload.truck_id).length > 10) ? String(payload.truck_id).trim() : null;
    const type = (payload.type && String(payload.type).trim()) || 'breakdown';
    const title = (payload.title && String(payload.title).trim()) || 'Breakdown';
    const description = (payload.description && String(payload.description).trim()) ? String(payload.description).trim() : null;
    const severity = (payload.severity && String(payload.severity).trim()) ? String(payload.severity).trim() : null;
    const actions_taken = (payload.actions_taken && String(payload.actions_taken).trim()) ? String(payload.actions_taken).trim() : null;
    const reported_date = payload.reported_date ? String(payload.reported_date).trim() : null;
    const reported_time = (payload.reported_time && String(payload.reported_time).trim()) ? String(payload.reported_time).trim() : '00:00';
    const location = (payload.location && String(payload.location).trim()) ? String(payload.location).trim() : null;
    const route_id = (payload.route_id && String(payload.route_id).trim().length > 10) ? String(payload.route_id).trim() : null;

    let reportedAt = new Date();
    if (reported_date) {
      const time = (reported_time || '00:00').toString().trim();
      reportedAt = new Date(`${reported_date}T${time}`);
      if (Number.isNaN(reportedAt.getTime())) reportedAt = new Date();
    }

    const result = await query(
      `INSERT INTO contractor_incidents (tenant_id, truck_id, driver_id, [type], title, description, severity, actions_taken, reported_at, location, route_id)
       OUTPUT INSERTED.* VALUES (@tenantId, @truck_id, @driver_id, @type, @title, @description, @severity, @actions_taken, @reported_at, @location, @route_id)`,
      {
        tenantId,
        truck_id: truck_id || null,
        driver_id: driverId,
        type: type || 'breakdown',
        title: title || 'Breakdown',
        description,
        severity,
        actions_taken,
        reported_at: reportedAt,
        location: location || null,
        route_id: route_id || null,
      }
    );
    const insertedRow = result.recordset[0];
    const incidentId = insertedRow.id;

    const dir = path.join(uploadDir, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = (name) => (path.extname(name) || '.bin').replace(/[^a-zA-Z0-9.]/g, '');
    const rel = (file, key) => `incidents/${tenantId}/${incidentId}_${key}${ext(file.originalname)}`;
    const full = (relative) => path.join(process.cwd(), 'uploads', relative);
    const write = (file, relative) => fs.writeFileSync(full(relative), file.buffer);

    const loadingSlipPath = rel(loadingSlip, 'loading_slip');
    const seal1Path = rel(seal1, 'seal_1');
    const seal2Path = rel(seal2, 'seal_2');
    const picturePath = rel(pictureProblem, 'picture_problem');
    write(loadingSlip, loadingSlipPath);
    write(seal1, seal1Path);
    write(seal2, seal2Path);
    write(pictureProblem, picturePath);

    await query(
      `UPDATE contractor_incidents SET loading_slip_path = @loading_slip_path, seal_1_path = @seal_1_path, seal_2_path = @seal_2_path, picture_problem_path = @picture_problem_path WHERE id = @id`,
      {
        loading_slip_path: loadingSlipPath,
        seal_1_path: seal1Path,
        seal_2_path: seal2Path,
        picture_problem_path: picturePath,
        id: incidentId,
      }
    );

    (async () => {
      try {
        if (!isEmailConfigured()) {
          console.warn('[reportBreakdown] Emails skipped: EMAIL_USER and/or EMAIL_PASS not set in .env. Restart the server after adding them.');
          return;
        }
        if (!getCommandCentreAndRectorEmailsForRoute) return;
        const detailResult = await query(
          `SELECT i.id, i.route_id, i.type, i.title, i.description, i.severity, i.actions_taken, i.reported_at, i.location,
            t.registration AS truck_reg, r.name AS route_name,
            d.full_name AS driver_name, d.surname AS driver_surname, d.email AS driver_email
           FROM contractor_incidents i
           LEFT JOIN contractor_trucks t ON t.id = i.truck_id
           LEFT JOIN contractor_routes r ON r.id = i.route_id
           LEFT JOIN contractor_drivers d ON d.id = i.driver_id
           WHERE i.id = @incidentId`,
          { incidentId }
        );
        const row = detailResult.recordset?.[0];
        const driverName = row ? [row.driver_name, row.driver_surname].filter(Boolean).join(' ').trim() || report.driverName : report.driverName;
        const reportedAtStr = row?.reported_at ? new Date(row.reported_at).toLocaleString() : new Date().toLocaleString();
        const routeId = row?.route_id ?? row?.route_Id ?? null;
        const ccRectorEmails = await getCommandCentreAndRectorEmailsForRoute(query, routeId);
        const driverEmail = (row?.driver_email || '').trim();
        const fallbackTo = (process.env.EMAIL_USER || '').trim();
        const notificationRecipients = ccRectorEmails.length > 0 ? ccRectorEmails : (fallbackTo && fallbackTo.includes('@') ? [fallbackTo] : []);
        const mask = (e) => (e && e.includes('@') ? e.slice(0, 2) + '***@' + e.split('@')[1] : e);
        console.log('[reportBreakdown] Email recipients: CC/Rector=', ccRectorEmails.length, 'list=', notificationRecipients.map(mask).join(', '), 'driver=', driverEmail ? 'yes' : 'no', notificationRecipients.length === 0 && fallbackTo ? 'fallback=' + mask(fallbackTo) : '');
        if (notificationRecipients.length > 0) {
          const html = breakdownReportHtml({
            driverName,
            truckRegistration: row?.truck_reg || '—',
            routeName: row?.route_name || '—',
            reportedAt: reportedAtStr,
            location: row?.location || '—',
            type: row?.type || type,
            title: row?.title || title,
            description: row?.description || description,
            severity: row?.severity || severity,
            actionsTaken: row?.actions_taken || actions_taken,
            incidentId,
          });
          const subject = `Breakdown reported: ${title} – ${driverName}`;
          for (const to of notificationRecipients) {
            try {
              await sendEmail({ to, subject, body: html, html: true });
              console.log('[reportBreakdown] CC/Rector notification sent to', mask(to));
            } catch (sendErr) {
              console.error('[reportBreakdown] Failed to send to', mask(to), sendErr?.message || sendErr);
            }
          }
        } else {
          console.warn('[reportBreakdown] No CC/Rector recipients and no EMAIL_USER fallback. No notification email sent.');
        }
        if (driverEmail) {
          const confirmHtml = breakdownConfirmationToDriverHtml(driverName);
          await sendEmail({ to: driverEmail, subject: 'Your breakdown was reported successfully', body: confirmHtml, html: true });
          console.log('[reportBreakdown] Driver confirmation sent to', driverEmail);
        } else {
          console.warn('[reportBreakdown] Driver has no email on file. No confirmation email sent.');
        }
      } catch (e) {
        console.error('[reportBreakdown] Email notification error:', e?.message || e);
        if (e?.stack) console.error(e.stack);
      }
    })();

    res.status(201).json({
      ok: true,
      message: 'Breakdown reported successfully.',
      incidentId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
