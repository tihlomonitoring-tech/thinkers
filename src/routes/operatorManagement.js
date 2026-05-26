import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, loadUser);

function getTenantId(req) { return req.user?.tenant_id || null; }

// ════════════════════════════════════════════════════════════════════
//  OPERATOR WORK SCHEDULES (time/hours based)
// ════════════════════════════════════════════════════════════════════

router.get('/schedules', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const userId = req.query.user_id || req.user.id;
    const from = req.query.from || null;
    const to = req.query.to || null;
    let sql = `SELECT s.*, u.full_name AS user_name, cu.full_name AS created_by_name
               FROM operator_work_schedules s
               LEFT JOIN users u ON u.id = s.user_id
               LEFT JOIN users cu ON cu.id = s.created_by_user_id
               WHERE s.tenant_id = @tenantId AND s.user_id = @userId`;
    const params = { tenantId, userId };
    if (from) { sql += ` AND s.work_date >= @from`; params.from = from; }
    if (to) { sql += ` AND s.work_date <= @to`; params.to = to; }
    sql += ` ORDER BY s.work_date DESC, s.start_time`;
    const r = await query(sql, params);
    res.json({ schedules: r.recordset || [] });
  } catch (err) { next(err); }
});

router.get('/schedules/all', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const from = req.query.from || null;
    const to = req.query.to || null;
    let sql = `SELECT s.*, u.full_name AS user_name, cu.full_name AS created_by_name
               FROM operator_work_schedules s
               LEFT JOIN users u ON u.id = s.user_id
               LEFT JOIN users cu ON cu.id = s.created_by_user_id
               WHERE s.tenant_id = @tenantId`;
    const params = { tenantId };
    if (from) { sql += ` AND s.work_date >= @from`; params.from = from; }
    if (to) { sql += ` AND s.work_date <= @to`; params.to = to; }
    if (req.query.user_id) { sql += ` AND s.user_id = @userId`; params.userId = req.query.user_id; }
    sql += ` ORDER BY s.work_date DESC, s.start_time`;
    const r = await query(sql, params);
    res.json({ schedules: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/schedules', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.user_id || !b.work_date || !b.start_time || !b.end_time) {
      return res.status(400).json({ error: 'user_id, work_date, start_time, and end_time are required' });
    }
    const r = await query(
      `INSERT INTO operator_work_schedules (tenant_id, user_id, work_date, start_time, end_time, break_minutes, schedule_type, notes, created_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @workDate, @startTime, @endTime, @breakMin, @schedType, @notes, @createdBy)`,
      {
        tenantId,
        userId: b.user_id,
        workDate: b.work_date,
        startTime: b.start_time,
        endTime: b.end_time,
        breakMin: b.break_minutes || 0,
        schedType: ['regular', 'overtime', 'public_holiday', 'weekend', 'standby'].includes(b.schedule_type) ? b.schedule_type : 'regular',
        notes: b.notes || null,
        createdBy: req.user.id,
      }
    );
    res.status(201).json({ schedule: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.post('/schedules/bulk', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const entries = req.body?.entries || [];
    if (!entries.length) return res.status(400).json({ error: 'No entries provided' });
    let created = 0;
    for (const b of entries) {
      if (!b.user_id || !b.work_date || !b.start_time || !b.end_time) continue;
      await query(
        `INSERT INTO operator_work_schedules (tenant_id, user_id, work_date, start_time, end_time, break_minutes, schedule_type, notes, created_by_user_id)
         VALUES (@tenantId, @userId, @workDate, @startTime, @endTime, @breakMin, @schedType, @notes, @createdBy)`,
        {
          tenantId,
          userId: b.user_id,
          workDate: b.work_date,
          startTime: b.start_time,
          endTime: b.end_time,
          breakMin: b.break_minutes || 0,
          schedType: ['regular', 'overtime', 'public_holiday', 'weekend', 'standby'].includes(b.schedule_type) ? b.schedule_type : 'regular',
          notes: b.notes || null,
          createdBy: req.user.id,
        }
      );
      created++;
    }
    res.status(201).json({ created });
  } catch (err) { next(err); }
});

router.delete('/schedules/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    await query(`DELETE FROM operator_work_schedules WHERE id = @id AND tenant_id = @tenantId`, { id: req.params.id, tenantId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  OPERATOR DELIVERY LOG
// ════════════════════════════════════════════════════════════════════

router.get('/deliveries', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const userId = req.query.user_id || req.user.id;
    let sql = `SELECT d.*, u.full_name AS user_name, ru.full_name AS recorded_by_name
               FROM operator_delivery_log d
               LEFT JOIN users u ON u.id = d.user_id
               LEFT JOIN users ru ON ru.id = d.recorded_by_user_id
               WHERE d.tenant_id = @tenantId AND d.user_id = @userId`;
    const params = { tenantId, userId };
    if (req.query.from) { sql += ` AND d.delivery_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND d.delivery_date <= @to`; params.to = req.query.to; }
    sql += ` ORDER BY d.delivery_date DESC, d.delivery_time DESC`;
    const r = await query(sql, params);
    res.json({ deliveries: r.recordset || [] });
  } catch (err) { next(err); }
});

router.get('/deliveries/all', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT d.*, u.full_name AS user_name
               FROM operator_delivery_log d
               LEFT JOIN users u ON u.id = d.user_id
               WHERE d.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.user_id) { sql += ` AND d.user_id = @userId`; params.userId = req.query.user_id; }
    if (req.query.from) { sql += ` AND d.delivery_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND d.delivery_date <= @to`; params.to = req.query.to; }
    sql += ` ORDER BY d.delivery_date DESC, d.delivery_time DESC`;
    const r = await query(sql, params);
    res.json({ deliveries: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/deliveries', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.user_id || !b.delivery_date) return res.status(400).json({ error: 'user_id and delivery_date required' });
    const r = await query(
      `INSERT INTO operator_delivery_log (tenant_id, user_id, delivery_date, delivery_time, origin, destination, load_description, weight_kg, truck_registration, trip_reference, [status], on_time, expected_delivery_time, notes, recorded_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @delDate, @delTime, @origin, @dest, @loadDesc, @weight, @truckReg, @tripRef, @status, @onTime, @expectedTime, @notes, @recordedBy)`,
      {
        tenantId,
        userId: b.user_id,
        delDate: b.delivery_date,
        delTime: b.delivery_time || new Date().toISOString(),
        origin: b.origin || null,
        dest: b.destination || null,
        loadDesc: b.load_description || null,
        weight: b.weight_kg != null ? Number(b.weight_kg) : null,
        truckReg: b.truck_registration || null,
        tripRef: b.trip_reference || null,
        status: ['completed', 'in_transit', 'delayed', 'cancelled'].includes(b.status) ? b.status : 'completed',
        onTime: b.on_time === false || b.on_time === 0 ? 0 : 1,
        expectedTime: b.expected_delivery_time || null,
        notes: b.notes || null,
        recordedBy: req.user.id,
      }
    );
    res.status(201).json({ delivery: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.delete('/deliveries/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    await query(`DELETE FROM operator_delivery_log WHERE id = @id AND tenant_id = @tenantId`, { id: req.params.id, tenantId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  OPERATOR PRODUCTIVITY SCORE
// ════════════════════════════════════════════════════════════════════

router.get('/productivity', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const userId = req.query.user_id || req.user.id;
    const days = Number(req.query.days) || 30;
    const from = req.query.from || null;
    const to = req.query.to || null;

    let deliverySql = `SELECT COUNT(*) AS total, SUM(CASE WHEN on_time = 1 THEN 1 ELSE 0 END) AS on_time,
                        SUM(CASE WHEN on_time = 0 THEN 1 ELSE 0 END) AS late,
                        SUM(CASE WHEN [status] = N'cancelled' THEN 1 ELSE 0 END) AS cancelled
                       FROM operator_delivery_log WHERE tenant_id = @tenantId AND user_id = @userId`;
    const params = { tenantId, userId };
    if (from && to) {
      deliverySql += ` AND delivery_date BETWEEN @from AND @to`;
      params.from = from;
      params.to = to;
    } else {
      deliverySql += ` AND delivery_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))`;
      params.days = days;
    }
    const delR = await query(deliverySql, params);
    const del = delR.recordset?.[0] || {};

    const schedSql = `SELECT ISNULL(SUM(DATEDIFF(MINUTE, start_time, end_time) / 60.0), 0) AS scheduled_hours
                      FROM operator_work_schedules WHERE tenant_id = @tenantId AND user_id = @userId`
      + (from && to ? ` AND work_date BETWEEN @from AND @to` : ` AND work_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))`);
    const schedR = await query(schedSql, params);

    const clockSql = `SELECT ISNULL(SUM(DATEDIFF(MINUTE, clock_in, ISNULL(clock_out, SYSUTCDATETIME())) / 60.0), 0) AS actual_hours
                      FROM operator_clock_records WHERE tenant_id = @tenantId AND user_id = @userId AND [status] != N'cancelled'`
      + (from && to ? ` AND work_date BETWEEN @from AND @to` : ` AND work_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))`);
    const clockR = await query(clockSql, params);

    const total = Number(del.total) || 0;
    const onTime = Number(del.on_time) || 0;
    const late = Number(del.late) || 0;
    const scheduledHours = Number(schedR.recordset?.[0]?.scheduled_hours) || 0;
    const actualHours = Number(clockR.recordset?.[0]?.actual_hours) || 0;

    const deliveryScore = total > 0 ? Math.round((onTime / total) * 100) : 0;
    const attendanceScore = scheduledHours > 0 ? Math.min(100, Math.round((actualHours / scheduledHours) * 100)) : 0;
    const punctualityScore = total > 0 ? Math.round(((total - late) / total) * 100) : 0;
    const overallScore = total > 0
      ? Math.round(deliveryScore * 0.5 + attendanceScore * 0.3 + punctualityScore * 0.2)
      : attendanceScore;

    res.json({
      productivity: {
        total_deliveries: total,
        on_time_deliveries: onTime,
        late_deliveries: late,
        cancelled_deliveries: Number(del.cancelled) || 0,
        scheduled_hours: scheduledHours,
        actual_hours: actualHours,
        delivery_score: deliveryScore,
        attendance_score: attendanceScore,
        punctuality_score: punctualityScore,
        overall_score: overallScore,
      },
    });
  } catch (err) { next(err); }
});

router.get('/productivity/team', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const days = Number(req.query.days) || 30;
    const r = await query(
      `SELECT u.id AS user_id, u.full_name,
              (SELECT COUNT(*) FROM operator_delivery_log d WHERE d.user_id = u.id AND d.tenant_id = @tenantId AND d.delivery_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))) AS total_deliveries,
              (SELECT SUM(CASE WHEN d2.on_time = 1 THEN 1 ELSE 0 END) FROM operator_delivery_log d2 WHERE d2.user_id = u.id AND d2.tenant_id = @tenantId AND d2.delivery_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))) AS on_time_deliveries,
              (SELECT ISNULL(SUM(DATEDIFF(MINUTE, s.start_time, s.end_time) / 60.0), 0) FROM operator_work_schedules s WHERE s.user_id = u.id AND s.tenant_id = @tenantId AND s.work_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))) AS scheduled_hours,
              (SELECT ISNULL(SUM(DATEDIFF(MINUTE, c.clock_in, ISNULL(c.clock_out, SYSUTCDATETIME())) / 60.0), 0) FROM operator_clock_records c WHERE c.user_id = u.id AND c.tenant_id = @tenantId AND c.[status] != N'cancelled' AND c.work_date >= DATEADD(DAY, -@days, CAST(SYSUTCDATETIME() AS DATE))) AS actual_hours
       FROM users u
       WHERE u.tenant_id = @tenantId AND u.[status] = N'active'
         AND EXISTS (SELECT 1 FROM operator_delivery_log od WHERE od.user_id = u.id AND od.tenant_id = @tenantId)
       ORDER BY total_deliveries DESC`,
      { tenantId, days }
    );
    res.json({ team: r.recordset || [] });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  WAGES & SALARY
// ════════════════════════════════════════════════════════════════════

router.get('/wages/config', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const userId = req.query.user_id || req.user.id;
    const r = await query(
      `SELECT wc.*, u.full_name AS user_name, cu.full_name AS created_by_name
       FROM operator_wage_config wc
       LEFT JOIN users u ON u.id = wc.user_id
       LEFT JOIN users cu ON cu.id = wc.created_by_user_id
       WHERE wc.tenant_id = @tenantId AND wc.user_id = @userId
       ORDER BY wc.effective_from DESC`,
      { tenantId, userId }
    );
    res.json({ configs: r.recordset || [] });
  } catch (err) { next(err); }
});

router.get('/wages/config/all', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT wc.*, u.full_name AS user_name
       FROM operator_wage_config wc
       LEFT JOIN users u ON u.id = wc.user_id
       WHERE wc.tenant_id = @tenantId AND (wc.effective_to IS NULL OR wc.effective_to >= CAST(SYSUTCDATETIME() AS DATE))
       ORDER BY u.full_name, wc.effective_from DESC`,
      { tenantId }
    );
    res.json({ configs: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/wages/config', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.user_id || !b.effective_from) return res.status(400).json({ error: 'user_id and effective_from required' });
    const r = await query(
      `INSERT INTO operator_wage_config (tenant_id, user_id, pay_type, base_rate, overtime_rate, weekend_rate, holiday_rate, currency, effective_from, effective_to, notes, created_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @payType, @baseRate, @overtimeRate, @weekendRate, @holidayRate, @currency, @effectiveFrom, @effectiveTo, @notes, @createdBy)`,
      {
        tenantId,
        userId: b.user_id,
        payType: ['hourly', 'daily', 'weekly', 'monthly'].includes(b.pay_type) ? b.pay_type : 'hourly',
        baseRate: Number(b.base_rate) || 0,
        overtimeRate: b.overtime_rate != null ? Number(b.overtime_rate) : null,
        weekendRate: b.weekend_rate != null ? Number(b.weekend_rate) : null,
        holidayRate: b.holiday_rate != null ? Number(b.holiday_rate) : null,
        currency: b.currency || 'ZAR',
        effectiveFrom: b.effective_from,
        effectiveTo: b.effective_to || null,
        notes: b.notes || null,
        createdBy: req.user.id,
      }
    );
    res.status(201).json({ config: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.get('/wages/pay-records', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const userId = req.query.user_id || req.user.id;
    const r = await query(
      `SELECT pr.*, u.full_name AS user_name, au.full_name AS approved_by_name, cu.full_name AS created_by_name
       FROM operator_pay_records pr
       LEFT JOIN users u ON u.id = pr.user_id
       LEFT JOIN users au ON au.id = pr.approved_by_user_id
       LEFT JOIN users cu ON cu.id = pr.created_by_user_id
       WHERE pr.tenant_id = @tenantId AND pr.user_id = @userId
       ORDER BY pr.pay_period_start DESC`,
      { tenantId, userId }
    );
    res.json({ payRecords: r.recordset || [] });
  } catch (err) { next(err); }
});

router.get('/wages/pay-records/all', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT pr.*, u.full_name AS user_name, au.full_name AS approved_by_name
               FROM operator_pay_records pr
               LEFT JOIN users u ON u.id = pr.user_id
               LEFT JOIN users au ON au.id = pr.approved_by_user_id
               WHERE pr.tenant_id = @tenantId`;
    const params = { tenantId };
    if (req.query.user_id) { sql += ` AND pr.user_id = @userId`; params.userId = req.query.user_id; }
    if (req.query.status && req.query.status !== 'all') { sql += ` AND pr.[status] = @status`; params.status = req.query.status; }
    sql += ` ORDER BY pr.pay_period_start DESC`;
    const r = await query(sql, params);
    res.json({ payRecords: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/wages/pay-records', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.user_id || !b.pay_period_start || !b.pay_period_end) {
      return res.status(400).json({ error: 'user_id, pay_period_start, and pay_period_end required' });
    }
    const r = await query(
      `INSERT INTO operator_pay_records (tenant_id, user_id, pay_period_start, pay_period_end,
         regular_hours, overtime_hours, weekend_hours, holiday_hours,
         base_amount, overtime_amount, weekend_amount, holiday_amount,
         deductions, deduction_notes, bonuses, bonus_notes, [status], notes, created_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@tenantId, @userId, @periodStart, @periodEnd,
         @regHours, @otHours, @weHours, @holHours,
         @baseAmt, @otAmt, @weAmt, @holAmt,
         @deductions, @deductionNotes, @bonuses, @bonusNotes, @status, @notes, @createdBy)`,
      {
        tenantId,
        userId: b.user_id,
        periodStart: b.pay_period_start,
        periodEnd: b.pay_period_end,
        regHours: Number(b.regular_hours) || 0,
        otHours: Number(b.overtime_hours) || 0,
        weHours: Number(b.weekend_hours) || 0,
        holHours: Number(b.holiday_hours) || 0,
        baseAmt: Number(b.base_amount) || 0,
        otAmt: Number(b.overtime_amount) || 0,
        weAmt: Number(b.weekend_amount) || 0,
        holAmt: Number(b.holiday_amount) || 0,
        deductions: Number(b.deductions) || 0,
        deductionNotes: b.deduction_notes || null,
        bonuses: Number(b.bonuses) || 0,
        bonusNotes: b.bonus_notes || null,
        status: ['draft', 'pending', 'approved', 'paid', 'cancelled'].includes(b.status) ? b.status : 'draft',
        notes: b.notes || null,
        createdBy: req.user.id,
      }
    );
    res.status(201).json({ payRecord: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.patch('/wages/pay-records/:id', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id, tenantId };
    const allowed = [
      'regular_hours', 'overtime_hours', 'weekend_hours', 'holiday_hours',
      'base_amount', 'overtime_amount', 'weekend_amount', 'holiday_amount',
      'deductions', 'deduction_notes', 'bonuses', 'bonus_notes', 'status', 'notes',
    ];
    for (const k of allowed) {
      if (b[k] !== undefined) {
        const pk = k.replace(/[^a-zA-Z0-9_]/g, '');
        params[pk] = b[k];
        sets.push(`[${k}] = @${pk}`);
      }
    }
    if (b.status === 'approved') {
      sets.push(`approved_by_user_id = @approvedBy`);
      sets.push(`approved_at = SYSUTCDATETIME()`);
      params.approvedBy = req.user.id;
    }
    if (b.status === 'paid') {
      sets.push(`paid_at = SYSUTCDATETIME()`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(`UPDATE operator_pay_records SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    const updated = await query(`SELECT pr.*, u.full_name AS user_name FROM operator_pay_records pr LEFT JOIN users u ON u.id = pr.user_id WHERE pr.id = @id`, { id: req.params.id });
    res.json({ payRecord: updated.recordset?.[0] || null });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  USERS LIST (for dropdowns)
// ════════════════════════════════════════════════════════════════════

router.get('/users', async (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT id, full_name, email FROM users WHERE tenant_id = @tenantId AND [status] = N'active' ORDER BY full_name`,
      { tenantId }
    );
    res.json({ users: r.recordset || [] });
  } catch (err) { next(err); }
});

export default router;
