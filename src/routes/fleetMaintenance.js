import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { formatDateForAppTz, nowForFilename } from '../lib/emailService.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('contractor'));

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function getTenantId(req) {
  return req.user?.tenant_id || null;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const [statusR, overdueR, upcomingR, recentR, costR] = await Promise.all([
      query(
        `SELECT [status], COUNT(*) AS n FROM fleet_maintenance_schedules WHERE tenant_id = @tenantId GROUP BY [status]`,
        { tenantId }
      ),
      query(
        `SELECT COUNT(*) AS n FROM fleet_maintenance_schedules WHERE tenant_id = @tenantId AND due_date < CAST(SYSUTCDATETIME() AS DATE) AND [status] NOT IN (N'completed', N'cancelled')`,
        { tenantId }
      ),
      query(
        `SELECT TOP 10 s.*, t.registration AS truck_reg FROM fleet_maintenance_schedules s
         LEFT JOIN contractor_trucks t ON t.id = s.truck_id
         WHERE s.tenant_id = @tenantId AND s.due_date >= CAST(SYSUTCDATETIME() AS DATE) AND s.[status] NOT IN (N'completed', N'cancelled')
         ORDER BY s.due_date`,
        { tenantId }
      ),
      query(
        `SELECT TOP 10 s.*, t.registration AS truck_reg FROM fleet_maintenance_schedules s
         LEFT JOIN contractor_trucks t ON t.id = s.truck_id
         WHERE s.tenant_id = @tenantId AND s.[status] = N'completed'
         ORDER BY s.completed_at DESC`,
        { tenantId }
      ),
      query(
        `SELECT ISNULL(SUM(ISNULL(actual_cost, estimated_cost)), 0) AS total_cost,
                ISNULL(SUM(actual_cost), 0) AS actual,
                ISNULL(SUM(estimated_cost), 0) AS estimated
         FROM fleet_maintenance_schedules WHERE tenant_id = @tenantId AND [status] = N'completed'
           AND completed_at >= DATEADD(DAY, -90, SYSUTCDATETIME())`,
        { tenantId }
      ),
    ]);
    const byStatus = {};
    for (const r of statusR.recordset || []) byStatus[getRow(r, 'status')] = getRow(r, 'n');
    res.json({
      byStatus,
      overdue: getRow(overdueR.recordset?.[0], 'n') || 0,
      upcoming: upcomingR.recordset || [],
      recentlyCompleted: recentR.recordset || [],
      cost90d: {
        total: getRow(costR.recordset?.[0], 'total_cost') || 0,
        actual: getRow(costR.recordset?.[0], 'actual') || 0,
        estimated: getRow(costR.recordset?.[0], 'estimated') || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT s.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name,
               cu.full_name AS completed_by_name,
               ti.reference_number AS inspection_ref, ti.overall_result AS inspection_result
               FROM fleet_maintenance_schedules s
               LEFT JOIN contractor_trucks t ON t.id = s.truck_id
               LEFT JOIN users u ON u.id = s.created_by_user_id
               LEFT JOIN users cu ON cu.id = s.completed_by_user_id
               LEFT JOIN truck_inspections ti ON ti.id = s.linked_inspection_id
               WHERE s.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.status && req.query.status !== 'all') {
      sql += ` AND s.[status] = @status`;
      params.status = req.query.status;
    }
    if (req.query.priority && req.query.priority !== 'all') {
      sql += ` AND s.priority = @priority`;
      params.priority = req.query.priority;
    }
    if (req.query.type && req.query.type !== 'all') {
      sql += ` AND s.schedule_type = @type`;
      params.type = req.query.type;
    }
    if (req.query.truck_id) {
      sql += ` AND s.truck_id = @truckId`;
      params.truckId = req.query.truck_id;
    }
    if (req.query.due_from) {
      sql += ` AND s.due_date >= @dueFrom`;
      params.dueFrom = req.query.due_from;
    }
    if (req.query.due_to) {
      sql += ` AND s.due_date <= @dueTo`;
      params.dueTo = req.query.due_to;
    }
    if (req.query.search) {
      sql += ` AND (s.fleet_registration LIKE @search OR s.trailer_registration LIKE @search OR s.driver_name LIKE @search OR s.responsible_mechanic LIKE @search OR s.description LIKE @search)`;
      params.search = `%${req.query.search}%`;
    }
    sql += ` ORDER BY s.due_date DESC`;
    const r = await query(sql, params);
    res.json({ schedules: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const r = await query(
      `SELECT s.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name,
              cu.full_name AS completed_by_name
       FROM fleet_maintenance_schedules s
       LEFT JOIN contractor_trucks t ON t.id = s.truck_id
       LEFT JOIN users u ON u.id = s.created_by_user_id
       LEFT JOIN users cu ON cu.id = s.completed_by_user_id
       WHERE s.id = @id AND s.tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    if (!r.recordset?.length) return res.status(404).json({ error: 'Not found' });
    res.json({ schedule: r.recordset[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.due_date) return res.status(400).json({ error: 'due_date is required' });
    const r = await query(
      `INSERT INTO fleet_maintenance_schedules (
         tenant_id, truck_id, fleet_registration, trailer_registration, schedule_type,
         maintenance_subject, linked_truck_id, description, driver_name, driver_id,
         responsible_mechanic, responsible_company, action_date, scope_of_work,
         due_date, odometer_reading, estimated_cost, priority, [status], created_by_user_id
       ) OUTPUT INSERTED.*
       VALUES (
         @tenantId, @truckId, @fleetReg, @trailerReg, @scheduleType,
         @maintenanceSubject, @linkedTruckId, @description, @driverName, @driverId,
         @mechanic, @company, @actionDate, @scopeOfWork,
         @dueDate, @odometerReading, @estimatedCost, @priority, @status, @userId
       )`,
      {
        tenantId,
        truckId: b.truck_id || null,
        fleetReg: b.fleet_registration || null,
        trailerReg: b.trailer_registration || null,
        scheduleType: b.schedule_type || 'preventive',
        maintenanceSubject: b.maintenance_subject || 'truck',
        linkedTruckId: b.linked_truck_id || null,
        description: b.description || null,
        driverName: b.driver_name || null,
        driverId: b.driver_id || null,
        mechanic: b.responsible_mechanic || null,
        company: b.responsible_company || null,
        actionDate: b.action_date || null,
        scopeOfWork: b.scope_of_work || null,
        dueDate: b.due_date,
        odometerReading: b.odometer_reading != null ? Number(b.odometer_reading) : null,
        estimatedCost: b.estimated_cost != null ? Number(b.estimated_cost) : null,
        priority: ['low', 'medium', 'high', 'critical'].includes(String(b.priority || '').toLowerCase()) ? b.priority.toLowerCase() : 'medium',
        status: 'scheduled',
        userId: req.user.id,
      }
    );
    res.status(201).json({ schedule: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id, tenantId };
    const allowed = [
      'fleet_registration', 'trailer_registration', 'schedule_type', 'maintenance_subject', 'truck_id', 'linked_truck_id',
      'description', 'driver_name', 'driver_id', 'responsible_mechanic', 'responsible_company',
      'action_date', 'scope_of_work', 'due_date', 'odometer_reading', 'estimated_cost', 'actual_cost', 'priority',
      'status', 'completion_notes',
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
      sets.push(`completed_by_user_id = @completedBy`);
      params.completedBy = req.user.id;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(
      `UPDATE fleet_maintenance_schedules SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`,
      params
    );
    const updated = await query(
      `SELECT s.*, t.registration AS truck_reg FROM fleet_maintenance_schedules s LEFT JOIN contractor_trucks t ON t.id = s.truck_id WHERE s.id = @id`,
      { id: req.params.id }
    );
    res.json({ schedule: updated.recordset?.[0] || null });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const existing = await query(
      `SELECT id, [status] FROM fleet_maintenance_schedules WHERE id = @id AND tenant_id = @tenantId`,
      { id: req.params.id, tenantId }
    );
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Not found' });
    await query(`DELETE FROM fleet_maintenance_schedules WHERE id = @id AND tenant_id = @tenantId`, { id: req.params.id, tenantId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/export/excel', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT s.*, t.registration AS truck_reg, t.make_model AS truck_model, u.full_name AS created_by_name
               FROM fleet_maintenance_schedules s
               LEFT JOIN contractor_trucks t ON t.id = s.truck_id
               LEFT JOIN users u ON u.id = s.created_by_user_id
               WHERE s.tenant_id = @tenantId ORDER BY s.due_date DESC`;
    const r = await query(sql, { tenantId });
    const rows = r.recordset || [];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Thinkers Afrika';
    const sheet = workbook.addWorksheet('Maintenance schedule', { views: [{ showGridLines: true }] });
    const titleRow = sheet.getRow(1);
    titleRow.getCell(1).value = 'Fleet Maintenance Schedule';
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells(1, 1, 1, 12);
    const dateRow = sheet.getRow(2);
    dateRow.getCell(1).value = `Generated: ${formatDateForAppTz(new Date())}`;
    dateRow.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
    const headers = ['Fleet/Trailer Reg', 'Type', 'Description', 'Driver', 'Mechanic/Company', 'Action date', 'Due date', 'ODO (km)', 'Priority', 'Status', 'Est. cost', 'Actual cost', 'Created by'];
    const headerRow = sheet.getRow(4);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    for (const row of rows) {
      const reg = getRow(row, 'truck_reg') || getRow(row, 'fleet_registration') || '—';
      const trailer = getRow(row, 'trailer_registration');
      sheet.addRow([
        trailer ? `${reg} / ${trailer}` : reg,
        getRow(row, 'schedule_type'),
        getRow(row, 'description') || '—',
        getRow(row, 'driver_name') || '—',
        [getRow(row, 'responsible_mechanic'), getRow(row, 'responsible_company')].filter(Boolean).join(' — ') || '—',
        formatDate(getRow(row, 'action_date')),
        formatDate(getRow(row, 'due_date')),
        getRow(row, 'odometer_reading') ?? '',
        getRow(row, 'priority'),
        getRow(row, 'status'),
        getRow(row, 'estimated_cost') ?? '',
        getRow(row, 'actual_cost') ?? '',
        getRow(row, 'created_by_name') || '—',
      ]);
    }
    [18, 16, 30, 18, 28, 14, 14, 12, 12, 14, 14, 14, 18].forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
    const buf = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="fleet-maintenance-${nowForFilename()}.xlsx"`,
    });
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/export/pdf', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT s.*, t.registration AS truck_reg, t.make_model AS truck_model
               FROM fleet_maintenance_schedules s
               LEFT JOIN contractor_trucks t ON t.id = s.truck_id
               WHERE s.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.status && req.query.status !== 'all') { sql += ` AND s.[status] = @status`; params.status = req.query.status; }
    sql += ` ORDER BY s.due_date DESC`;
    const r = await query(sql, params);
    const rows = r.recordset || [];
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="fleet-maintenance-${nowForFilename()}.pdf"` });
      res.send(Buffer.concat(chunks));
    });

    doc.rect(0, 0, doc.page.width, 50).fill('#1E3A5F');
    doc.fontSize(16).fillColor('#FFFFFF').text('THINKERS AFRIKA', 30, 14);
    doc.fontSize(9).text('Fleet Maintenance Schedule', 30, 33);
    doc.fontSize(8).fillColor('#FFFFFF').text(`Generated: ${formatDateForAppTz(new Date())}`, doc.page.width - 200, 14, { width: 170, align: 'right' });

    const tableTop = 65;
    const colWidths = [120, 70, 160, 90, 90, 65, 65, 55];
    const headers = ['Fleet / Trailer Reg', 'Type', 'Description', 'Driver', 'Mechanic', 'Due date', 'Priority', 'Status'];

    let y = tableTop;
    doc.rect(30, y, doc.page.width - 60, 18).fill('#1E3A5F');
    let x = 30;
    doc.fontSize(7).fillColor('#FFFFFF');
    headers.forEach((h, i) => { doc.text(h, x + 3, y + 5, { width: colWidths[i] - 6 }); x += colWidths[i]; });
    y += 18;

    doc.fillColor('#1a1a1a');
    for (const row of rows) {
      if (y > doc.page.height - 50) {
        doc.addPage();
        y = 30;
        doc.rect(30, y, doc.page.width - 60, 18).fill('#1E3A5F');
        x = 30;
        doc.fontSize(7).fillColor('#FFFFFF');
        headers.forEach((h, i) => { doc.text(h, x + 3, y + 5, { width: colWidths[i] - 6 }); x += colWidths[i]; });
        y += 18;
        doc.fillColor('#1a1a1a');
      }
      const reg = getRow(row, 'truck_reg') || getRow(row, 'fleet_registration') || '—';
      const trailer = getRow(row, 'trailer_registration');
      const cells = [
        trailer ? `${reg} / ${trailer}` : reg,
        getRow(row, 'schedule_type') || '—',
        String(getRow(row, 'description') || '—').slice(0, 80),
        getRow(row, 'driver_name') || '—',
        getRow(row, 'responsible_mechanic') || '—',
        formatDate(getRow(row, 'due_date')),
        getRow(row, 'priority') || '—',
        getRow(row, 'status') || '—',
      ];
      const rowH = 16;
      const bgFill = (y - tableTop) % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      doc.rect(30, y, doc.page.width - 60, rowH).fill(bgFill);
      x = 30;
      doc.fontSize(7).fillColor('#1a1a1a');
      cells.forEach((c, i) => { doc.text(c, x + 3, y + 4, { width: colWidths[i] - 6 }); x += colWidths[i]; });
      y += rowH;
    }

    const range = doc.bufferedPageRange();
    doc._pageBuffer.length = range.count;
    doc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
