/**
 * Single operations shift reports — parallel to standard shift reports, own tables for future dashboards.
 * Registered on the Command Centre router (same auth / page access as parent).
 */
import { query } from '../db.js';
import { getAccessManagementEmails } from '../lib/emailRecipients.js';
import { shiftReportOverrideRequestHtml, shiftReportOverrideCodeToRequesterHtml } from '../lib/emailTemplates.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';

function getR(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const e = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return e ? e[1] : undefined;
}

const JSON_FIELDS = ['truck_updates', 'incidents', 'non_compliance_calls', 'investigations', 'communication_log'];
const SCALAR_KEYS = [
  'id',
  'created_by_user_id',
  'report_date',
  'shift_date',
  'shift_start',
  'shift_end',
  'controller1_name',
  'controller1_email',
  'controller2_name',
  'controller2_email',
  'total_trucks_scheduled',
  'balance_brought_down',
  'total_loads_dispatched',
  'total_pending_deliveries',
  'total_loads_delivered',
  'overall_performance',
  'key_highlights',
  'outstanding_issues',
  'handover_key_info',
  'declaration',
  'shift_conclusion_time',
  'status',
  'submitted_at',
  'submitted_to_user_id',
  'approved_by_user_id',
  'approved_at',
  'created_at',
  'updated_at',
];

function parseRoutesJson(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  try {
    const j = JSON.parse(String(raw));
    return Array.isArray(j) ? j.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rowToSingleOpsReport(mainRow, deliveries = [], routeTotals = []) {
  if (!mainRow) return null;
  const lowerKeys = Object.keys(mainRow).reduce((acc, k) => {
    acc[k.toLowerCase()] = k;
    return acc;
  }, {});
  const out = { report_kind: 'single_ops' };
  for (const key of SCALAR_KEYS) {
    const rawKey = lowerKeys[key] || key;
    if (mainRow[rawKey] !== undefined) out[key] = mainRow[rawKey];
  }
  for (const name of ['created_by_name', 'created_by_email', 'submitted_to_name', 'submitted_to_email', 'approved_by_name']) {
    const rawKey = lowerKeys[name] || name;
    if (mainRow[rawKey] !== undefined) out[name] = mainRow[rawKey];
  }
  for (const f of JSON_FIELDS) {
    const rawKey = lowerKeys[f] || f;
    let val = mainRow[rawKey];
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {
        val = [];
      }
    }
    out[f] = Array.isArray(val) ? val : [];
  }
  const routes = parseRoutesJson(getR(mainRow, 'routes_json'));
  out.routes = routes;
  out.route = routes.length ? routes.join(', ') : '';
  out.truck_deliveries = (deliveries || []).map((d) => ({
    id: getR(d, 'id'),
    truck_registration: getR(d, 'truck_registration') ?? '',
    driver_name: getR(d, 'driver_name') ?? '',
    completed_deliveries: getR(d, 'completed_deliveries') ?? '',
    remarks: getR(d, 'remarks') ?? '',
    sort_order: getR(d, 'sort_order') ?? 0,
  }));
  out.route_load_totals = (routeTotals || []).map((t) => ({
    id: getR(t, 'id'),
    route_name: getR(t, 'route_name') ?? '',
    total_loads_delivered: getR(t, 'total_loads_delivered') ?? '',
    sort_order: getR(t, 'sort_order') ?? 0,
  }));
  return out;
}

function stringifyJsonField(v) {
  if (v == null) return '[]';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function bodyToMainPayload(b, userId, isUpdate) {
  const routes = Array.isArray(b.routes) ? b.routes.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    created_by_user_id: userId,
    routes_json: JSON.stringify(routes),
    report_date: b.report_date || null,
    shift_date: b.shift_date || null,
    shift_start: b.shift_start ?? null,
    shift_end: b.shift_end ?? null,
    controller1_name: b.controller1_name ?? null,
    controller1_email: b.controller1_email ?? null,
    controller2_name: b.controller2_name ?? null,
    controller2_email: b.controller2_email ?? null,
    total_trucks_scheduled: b.total_trucks_scheduled ?? null,
    balance_brought_down: b.balance_brought_down ?? null,
    total_loads_dispatched: b.total_loads_dispatched ?? null,
    total_pending_deliveries: b.total_pending_deliveries ?? null,
    total_loads_delivered: b.total_loads_delivered ?? null,
    overall_performance: b.overall_performance ?? null,
    key_highlights: b.key_highlights ?? null,
    truck_updates: stringifyJsonField(b.truck_updates),
    incidents: stringifyJsonField(b.incidents),
    non_compliance_calls: stringifyJsonField(b.non_compliance_calls),
    investigations: stringifyJsonField(b.investigations),
    communication_log: stringifyJsonField(b.communication_log),
    outstanding_issues: b.outstanding_issues ?? null,
    handover_key_info: b.handover_key_info ?? null,
    declaration: b.declaration ?? null,
    shift_conclusion_time: b.shift_conclusion_time ?? null,
    status: isUpdate ? undefined : 'draft',
  };
}

async function replaceChildren(reportId, truckDeliveries, routeLoadTotals) {
  await query(`DELETE FROM command_centre_single_ops_truck_deliveries WHERE report_id = @rid`, { rid: reportId });
  await query(`DELETE FROM command_centre_single_ops_route_load_totals WHERE report_id = @rid`, { rid: reportId });
  const td = Array.isArray(truckDeliveries) ? truckDeliveries : [];
  let si = 0;
  for (const row of td) {
    const tr = String(row.truck_registration || '').trim();
    const dr = String(row.driver_name || '').trim();
    const cd = String(row.completed_deliveries ?? '').trim();
    const rm = String(row.remarks || '').trim();
    if (!tr && !dr && !cd && !rm) continue;
    await query(
      `INSERT INTO command_centre_single_ops_truck_deliveries (report_id, sort_order, truck_registration, driver_name, completed_deliveries, remarks)
       VALUES (@rid, @so, @tr, @dr, @cd, @rm)`,
      { rid: reportId, so: si++, tr: tr || null, dr: dr || null, cd: cd || null, rm: rm || null }
    );
  }
  const rt = Array.isArray(routeLoadTotals) ? routeLoadTotals : [];
  let ti = 0;
  for (const row of rt) {
    const rn = String(row.route_name || '').trim();
    const tl = String(row.total_loads_delivered ?? '').trim();
    if (!rn && !tl) continue;
    await query(
      `INSERT INTO command_centre_single_ops_route_load_totals (report_id, sort_order, route_name, total_loads_delivered)
       VALUES (@rid, @so, @rn, @tl)`,
      { rid: reportId, so: ti++, rn: rn || null, tl: tl || null }
    );
  }
}

async function loadChildren(reportId) {
  const d = await query(
    `SELECT id, sort_order, truck_registration, driver_name, completed_deliveries, remarks
     FROM command_centre_single_ops_truck_deliveries WHERE report_id = @rid ORDER BY sort_order`,
    { rid: reportId }
  );
  const t = await query(
    `SELECT id, sort_order, route_name, total_loads_delivered FROM command_centre_single_ops_route_load_totals WHERE report_id = @rid ORDER BY sort_order`,
    { rid: reportId }
  );
  return { deliveries: d.recordset || [], routeTotals: t.recordset || [] };
}

async function fetchReportBundle(id, userId) {
  const result = await query(
    `SELECT r.*,
      creator.full_name AS created_by_name, creator.email AS created_by_email,
      approver.full_name AS submitted_to_name, approver.email AS submitted_to_email,
      approvedBy.full_name AS approved_by_name
     FROM command_centre_single_ops_shift_reports r
     LEFT JOIN users creator ON creator.id = r.created_by_user_id
     LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
     LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
     WHERE r.id = @id`,
    { id }
  );
  const row = result.recordset?.[0];
  if (!row) return null;
  const { deliveries, routeTotals } = await loadChildren(id);
  let evaluation = null;
  if (userId) {
    try {
      const ev = await query(
        `SELECT id, answers, overall_comment, created_at FROM command_centre_single_ops_controller_evaluations
         WHERE report_id = @rid AND evaluator_user_id = @uid`,
        { rid: id, uid: userId }
      );
      const er = ev.recordset?.[0];
      if (er) {
        evaluation = {
          id: getR(er, 'id'),
          answers: getR(er, 'answers'),
          overall_comment: getR(er, 'overall_comment'),
          created_at: getR(er, 'created_at'),
        };
      }
    } catch (_) {
      /* table missing until migration */
    }
  }
  return { report: rowToSingleOpsReport(row, deliveries, routeTotals), evaluation };
}

function normalizeOverrideCodeInput(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

async function requireSingleOpsEvaluationOrOverride(reportId, userId, status, overrideCode, ctx = {}) {
  const { isSuperAdmin = false, submittedToUserId = null } = ctx;
  const st = String(status ?? '').toLowerCase().trim();
  const needsOverride = st === 'approved' || st === 'rejected';
  const hasCode = overrideCode != null && String(overrideCode).trim() !== '';
  if (needsOverride && hasCode) {
    const codeNorm = normalizeOverrideCodeInput(overrideCode);
    if (!codeNorm) return { error: 'Invalid or already used override code' };
    const result = await query(
      `SELECT id, code, requested_by_user_id FROM command_centre_single_ops_override_requests
       WHERE report_id = @reportId AND used_at IS NULL`,
      { reportId }
    );
    const rows = result.recordset || [];
    const uid = String(userId ?? '').toLowerCase();
    const subTo = submittedToUserId != null ? String(submittedToUserId).toLowerCase() : '';
    const match = rows.find((r) => {
      const dbNorm = normalizeOverrideCodeInput(getR(r, 'code'));
      if (dbNorm !== codeNorm) return false;
      const reqBy = String(getR(r, 'requested_by_user_id') ?? '').toLowerCase();
      if (reqBy === uid) return true;
      if (isSuperAdmin && subTo && reqBy === subTo) return true;
      return false;
    });
    if (!match) return { error: 'Invalid or already used override code' };
    await query(`UPDATE command_centre_single_ops_override_requests SET used_at = SYSUTCDATETIME() WHERE id = @id`, { id: getR(match, 'id') });
    return {};
  }
  if (needsOverride) return { error: 'Override code required. Request one from Access Management.' };
  const evalResult = await query(
    `SELECT id FROM command_centre_single_ops_controller_evaluations WHERE report_id = @reportId AND evaluator_user_id = @userId`,
    { reportId, userId }
  );
  if (!evalResult.recordset?.length) {
    return { error: 'Complete the controller evaluation before approving, rejecting, or granting provisional approval.' };
  }
  return {};
}

/** @param {import('express').Router} router */
export function registerCommandCentreSingleOpsShiftReports(router) {
  router.get('/single-ops-shift-reports', async (req, res, next) => {
    try {
      const isSuperAdmin = req.user?.role === 'super_admin';
      const requestsOnly = req.query.requests === '1';
      const decidedByMe = req.query.decidedByMe === '1';
      let sql = `
        SELECT r.*,
          creator.full_name AS created_by_name, creator.email AS created_by_email,
          approver.full_name AS submitted_to_name, approver.email AS submitted_to_email,
          approvedBy.full_name AS approved_by_name
        FROM command_centre_single_ops_shift_reports r
        LEFT JOIN users creator ON creator.id = r.created_by_user_id
        LEFT JOIN users approver ON approver.id = r.submitted_to_user_id
        LEFT JOIN users approvedBy ON approvedBy.id = r.approved_by_user_id
        WHERE 1=1`;
      const params = {};
      if (decidedByMe) {
        if (!isSuperAdmin) sql += ` AND r.submitted_to_user_id = @userId AND r.status IN ('approved', 'rejected')`;
        else sql += ` AND r.status IN ('approved', 'rejected')`;
        if (!isSuperAdmin) params.userId = req.user.id;
        sql += ` ORDER BY r.updated_at DESC`;
        const result = await query(sql, params);
        const list = (result.recordset || []).slice(0, 20).map((row) => rowToSingleOpsReport(row, [], []));
        return res.json({ reports: list });
      }
      if (requestsOnly) {
        if (!isSuperAdmin) sql += ` AND r.submitted_to_user_id = @userId AND r.status IN ('pending_approval', 'provisional')`;
        else sql += ` AND r.status IN ('pending_approval', 'provisional')`;
        if (!isSuperAdmin) params.userId = req.user.id;
      }
      sql += ` ORDER BY r.updated_at DESC`;
      const result = await query(sql, params);
      const list = (result.recordset || []).map((row) => rowToSingleOpsReport(row, [], []));
      res.json({ reports: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/single-ops-shift-reports/:id', async (req, res, next) => {
    try {
      const bundle = await fetchReportBundle(req.params.id, req.user?.id);
      if (!bundle) return res.status(404).json({ error: 'Report not found' });
      const commentsResult = await query(
        `SELECT c.*, u.full_name AS user_name FROM command_centre_single_ops_shift_report_comments c
         JOIN users u ON u.id = c.user_id WHERE c.report_id = @reportId ORDER BY c.created_at`,
        { reportId: req.params.id }
      );
      res.json({ report: bundle.report, comments: commentsResult.recordset || [], evaluation: bundle.evaluation });
    } catch (err) {
      next(err);
    }
  });

  router.post('/single-ops-shift-reports', async (req, res, next) => {
    try {
      const b = req.body || {};
      const payload = bodyToMainPayload(b, req.user.id, false);
      delete payload.status;
      const result = await query(
        `INSERT INTO command_centre_single_ops_shift_reports (
          created_by_user_id, routes_json, report_date, shift_date, shift_start, shift_end,
          controller1_name, controller1_email, controller2_name, controller2_email,
          total_trucks_scheduled, balance_brought_down, total_loads_dispatched, total_pending_deliveries, total_loads_delivered,
          overall_performance, key_highlights, truck_updates, incidents, non_compliance_calls, investigations, communication_log,
          outstanding_issues, handover_key_info, declaration, shift_conclusion_time, status
        ) OUTPUT INSERTED.*
        VALUES (
          @created_by_user_id, @routes_json, @report_date, @shift_date, @shift_start, @shift_end,
          @controller1_name, @controller1_email, @controller2_name, @controller2_email,
          @total_trucks_scheduled, @balance_brought_down, @total_loads_dispatched, @total_pending_deliveries, @total_loads_delivered,
          @overall_performance, @key_highlights, @truck_updates, @incidents, @non_compliance_calls, @investigations, @communication_log,
          @outstanding_issues, @handover_key_info, @declaration, @shift_conclusion_time, N'draft'
        )`,
        payload
      );
      const row = result.recordset?.[0];
      if (!row) return res.status(500).json({ error: 'Insert failed' });
      const id = getR(row, 'id');
      await replaceChildren(id, b.truck_deliveries, b.route_load_totals);
      const full = await fetchReportBundle(id, req.user.id);
      res.status(201).json({ report: full.report });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/single-ops-shift-reports/:id', async (req, res, next) => {
    try {
      const getResult = await query(
        `SELECT r.id, r.status, r.created_by_user_id, creator.email AS creator_email
         FROM command_centre_single_ops_shift_reports r
         LEFT JOIN users creator ON creator.id = r.created_by_user_id
         WHERE r.id = @id`,
        { id: req.params.id }
      );
      const existing = getResult.recordset?.[0];
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      const status = String(getR(existing, 'status') ?? '').toLowerCase().trim();
      if (!['draft', 'provisional', 'rejected'].includes(status)) return res.status(400).json({ error: 'Report cannot be edited in current status' });
      const norm = (v) => (v != null ? String(v).toLowerCase().trim() : '');
      const creatorId = norm(getR(existing, 'created_by_user_id'));
      const userId = norm(req.user?.id);
      const creatorEmail = norm(getR(existing, 'creator_email'));
      const userEmail = norm(req.user?.email);
      const isCreator = (creatorId && userId && creatorId === userId) || (creatorEmail && userEmail && creatorEmail === userEmail);
      if (!isCreator) return res.status(403).json({ error: 'Not allowed to edit this report' });

      const b = req.body || {};
      const routesArr = Array.isArray(b.routes) ? b.routes.map((x) => String(x).trim()).filter(Boolean) : [];
      const merged = {
        routes_json: JSON.stringify(routesArr),
        report_date: b.report_date,
        shift_date: b.shift_date,
        shift_start: b.shift_start,
        shift_end: b.shift_end,
        controller1_name: b.controller1_name,
        controller1_email: b.controller1_email,
        controller2_name: b.controller2_name,
        controller2_email: b.controller2_email,
        total_trucks_scheduled: b.total_trucks_scheduled,
        balance_brought_down: b.balance_brought_down,
        total_loads_dispatched: b.total_loads_dispatched,
        total_pending_deliveries: b.total_pending_deliveries,
        total_loads_delivered: b.total_loads_delivered,
        overall_performance: b.overall_performance,
        key_highlights: b.key_highlights,
        truck_updates: b.truck_updates !== undefined ? stringifyJsonField(b.truck_updates) : undefined,
        incidents: b.incidents !== undefined ? stringifyJsonField(b.incidents) : undefined,
        non_compliance_calls: b.non_compliance_calls !== undefined ? stringifyJsonField(b.non_compliance_calls) : undefined,
        investigations: b.investigations !== undefined ? stringifyJsonField(b.investigations) : undefined,
        communication_log: b.communication_log !== undefined ? stringifyJsonField(b.communication_log) : undefined,
        outstanding_issues: b.outstanding_issues,
        handover_key_info: b.handover_key_info,
        declaration: b.declaration,
        shift_conclusion_time: b.shift_conclusion_time,
      };
      const setParts = [];
      const params = { id: req.params.id };
      const fields = Object.keys(merged);
      for (const f of fields) {
        if (merged[f] !== undefined) {
          setParts.push(`${f} = @${f}`);
          params[f] = merged[f];
        }
      }
      if (setParts.length) {
        params.updated_at = new Date().toISOString();
        await query(
          `UPDATE command_centre_single_ops_shift_reports SET ${setParts.join(', ')}, updated_at = @updated_at WHERE id = @id`,
          params
        );
      }
      await replaceChildren(req.params.id, b.truck_deliveries, b.route_load_totals);
      const full = await fetchReportBundle(req.params.id, req.user.id);
      res.json({ report: full.report });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/single-ops-shift-reports/:id', async (req, res, next) => {
    try {
      if (req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only a system administrator can delete draft single-ops shift reports.' });
      }
      const getResult = await query(`SELECT id, status FROM command_centre_single_ops_shift_reports WHERE id = @id`, { id: req.params.id });
      const existing = getResult.recordset?.[0];
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      if (String(getR(existing, 'status')).toLowerCase().trim() !== 'draft') {
        return res.status(400).json({ error: 'Only draft reports can be deleted.' });
      }
      await query(`DELETE FROM command_centre_single_ops_shift_reports WHERE id = @id`, { id: req.params.id });
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  router.post('/single-ops-shift-reports/:id/submit', async (req, res, next) => {
    try {
      const { submitted_to_user_id } = req.body || {};
      if (!submitted_to_user_id) return res.status(400).json({ error: 'submitted_to_user_id required' });
      const getResult = await query(
        `SELECT id, status, created_by_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`,
        { id: req.params.id }
      );
      const existing = getResult.recordset?.[0];
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      if (getR(existing, 'created_by_user_id') !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
      const st = String(getR(existing, 'status'));
      if (st !== 'draft' && st !== 'rejected') return res.status(400).json({ error: 'Only draft or rejected reports can be submitted' });
      await query(
        `UPDATE command_centre_single_ops_shift_reports SET status = N'pending_approval', submitted_to_user_id = @submittedTo, submitted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: req.params.id, submittedTo: submitted_to_user_id }
      );
      const full = await fetchReportBundle(req.params.id, req.user.id);
      res.json({ report: full.report });
    } catch (err) {
      next(err);
    }
  });

  router.post('/single-ops-shift-reports/:id/comments', async (req, res, next) => {
    try {
      const { comment_text } = req.body || {};
      if (!comment_text || !String(comment_text).trim()) return res.status(400).json({ error: 'comment_text required' });
      const getResult = await query(
        `SELECT id, created_by_user_id, submitted_to_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`,
        { id: req.params.id }
      );
      const report = getResult.recordset?.[0];
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const isApprover = getR(report, 'submitted_to_user_id') === req.user.id;
      const isCreator = getR(report, 'created_by_user_id') === req.user.id;
      const isSuperAdmin = req.user?.role === 'super_admin';
      if (!isApprover && !isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Not allowed to comment' });
      const result = await query(
        `INSERT INTO command_centre_single_ops_shift_report_comments (report_id, user_id, comment_text) OUTPUT INSERTED.*
         VALUES (@reportId, @userId, @commentText)`,
        { reportId: req.params.id, userId: req.user.id, commentText: String(comment_text).trim() }
      );
      res.status(201).json({ comment: result.recordset?.[0] });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/single-ops-shift-reports/:reportId/comments/:commentId/addressed', async (req, res, next) => {
    try {
      const { reportId, commentId } = req.params;
      const getReport = await query(
        `SELECT id, status, created_by_user_id, submitted_to_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`,
        { id: reportId }
      );
      const report = getReport.recordset?.[0];
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (getR(report, 'created_by_user_id') !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
      if (String(getR(report, 'status')) !== 'provisional') return res.status(400).json({ error: 'Only provisional reports allow marking comments addressed' });
      await query(
        `UPDATE command_centre_single_ops_shift_report_comments SET addressed = 1, addressed_at = SYSUTCDATETIME() WHERE id = @commentId AND report_id = @reportId`,
        { commentId, reportId }
      );
      const countResult = await query(
        `SELECT COUNT(*) AS total FROM command_centre_single_ops_shift_report_comments WHERE report_id = @reportId`,
        { reportId }
      );
      const total = countResult.recordset?.[0]?.total ?? 0;
      const addressedResult = await query(
        `SELECT COUNT(*) AS addressed FROM command_centre_single_ops_shift_report_comments WHERE report_id = @reportId AND addressed = 1`,
        { reportId }
      );
      const addressed = addressedResult.recordset?.[0]?.addressed ?? 0;
      if (total > 0 && addressed >= total) {
        await query(
          `UPDATE command_centre_single_ops_shift_reports SET status = N'approved', approved_by_user_id = @approvedBy, approved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @reportId`,
          { reportId, approvedBy: getR(report, 'submitted_to_user_id') }
        );
      }
      const commentsResult = await query(
        `SELECT c.*, u.full_name AS user_name FROM command_centre_single_ops_shift_report_comments c JOIN users u ON u.id = c.user_id WHERE c.report_id = @reportId ORDER BY c.created_at`,
        { reportId }
      );
      res.json({ comments: commentsResult.recordset || [], autoApproved: total > 0 && addressed >= total });
    } catch (err) {
      next(err);
    }
  });

  router.get('/single-ops-shift-reports/:id/evaluation', async (req, res, next) => {
    try {
      const evalResult = await query(
        `SELECT e.id, e.answers, e.overall_comment, e.created_at, u.full_name AS evaluator_name
         FROM command_centre_single_ops_controller_evaluations e
         JOIN users u ON u.id = e.evaluator_user_id
         WHERE e.report_id = @id AND e.evaluator_user_id = @userId`,
        { id: req.params.id, userId: req.user.id }
      );
      const row = evalResult.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'No evaluation found' });
      res.json({
        evaluation: {
          id: getR(row, 'id'),
          answers: getR(row, 'answers'),
          overall_comment: getR(row, 'overall_comment'),
          created_at: getR(row, 'created_at'),
          evaluator_name: getR(row, 'evaluator_name'),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/single-ops-shift-reports/:id/evaluation', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { answers, overall_comment } = req.body || {};
      const reportResult = await query(
        `SELECT id, status, submitted_to_user_id, created_by_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`,
        { id }
      );
      const report = reportResult.recordset?.[0];
      if (!report) return res.status(404).json({ error: 'Report not found' });
      const isApproverOrSuperAdmin = getR(report, 'submitted_to_user_id') === req.user.id || req.user?.role === 'super_admin';
      if (!isApproverOrSuperAdmin) return res.status(403).json({ error: 'Only the assigned approver can submit an evaluation' });
      const st = String(getR(report, 'status'));
      if (!['pending_approval', 'provisional'].includes(st)) return res.status(400).json({ error: 'Report is not awaiting your review' });
      if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'answers object required' });
      if (!overall_comment || typeof overall_comment !== 'string' || !String(overall_comment).trim()) {
        return res.status(400).json({ error: 'overall_comment is required' });
      }
      let tenantId = (await query(`SELECT tenant_id FROM users WHERE id = @uid`, { uid: getR(report, 'created_by_user_id') })).recordset?.[0]?.tenant_id ?? null;
      if (tenantId == null && req.user?.tenant_id) tenantId = req.user.tenant_id;
      const existing = await query(
        `SELECT id FROM command_centre_single_ops_controller_evaluations WHERE report_id = @reportId AND evaluator_user_id = @userId`,
        { reportId: id, userId: req.user.id }
      );
      const answersJson = JSON.stringify(answers);
      if (existing.recordset?.length > 0) {
        await query(
          `UPDATE command_centre_single_ops_controller_evaluations SET answers = @answers, overall_comment = @overall_comment WHERE report_id = @reportId AND evaluator_user_id = @userId`,
          { reportId: id, userId: req.user.id, answers: answersJson, overall_comment: String(overall_comment).trim() }
        );
      } else {
        await query(
          `INSERT INTO command_centre_single_ops_controller_evaluations (tenant_id, report_id, evaluator_user_id, answers, overall_comment)
           VALUES (@tenantId, @reportId, @userId, @answers, @overall_comment)`,
          { tenantId, reportId: id, userId: req.user.id, answers: answersJson, overall_comment: String(overall_comment).trim() }
        );
      }
      const getEval = await query(
        `SELECT id, answers, overall_comment, created_at FROM command_centre_single_ops_controller_evaluations WHERE report_id = @reportId AND evaluator_user_id = @userId`,
        { reportId: id, userId: req.user.id }
      );
      const row = getEval.recordset?.[0];
      res.status(existing.recordset?.length > 0 ? 200 : 201).json({
        evaluation: { id: getR(row, 'id'), answers: getR(row, 'answers'), overall_comment: getR(row, 'overall_comment'), created_at: getR(row, 'created_at') },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/single-ops-shift-reports/:id/request-override', async (req, res, next) => {
    try {
      const { id } = req.params;
      const reportResult = await query(
        `SELECT r.id, r.routes_json, r.report_date, r.submitted_to_user_id, creator.tenant_id
         FROM command_centre_single_ops_shift_reports r
         LEFT JOIN users creator ON creator.id = r.created_by_user_id
         WHERE r.id = @id`,
        { id }
      );
      const report = reportResult.recordset?.[0];
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (getR(report, 'submitted_to_user_id') !== req.user.id && req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only the assigned approver can request an override' });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await query(
        `INSERT INTO command_centre_single_ops_override_requests (report_id, requested_by_user_id, code) VALUES (@reportId, @userId, @code)`,
        { reportId: id, userId: req.user.id, code }
      );
      const accessManagementEmails = await getAccessManagementEmails(query);
      const requesterName = req.user.full_name || req.user.email || 'Approver';
      const requesterEmail = req.user.email || '';
      const reportDate = getR(report, 'report_date') ? new Date(`${getR(report, 'report_date')}T12:00:00`).toLocaleDateString() : '';
      const appUrl = process.env.APP_URL || '';
      const routeLabel = parseRoutesJson(getR(report, 'routes_json')).join(', ') || '—';
      if (sendEmail && isEmailConfigured()) {
        if (accessManagementEmails?.length) {
          const htmlAm = shiftReportOverrideRequestHtml({
            requesterName,
            requesterEmail,
            reportRoute: routeLabel,
            reportDate,
            code,
            appUrl,
          });
          await sendEmail({
            to: accessManagementEmails,
            subject: 'Single-ops shift report override code requested – Command Centre',
            body: htmlAm,
            html: true,
          }).catch((e) => console.error('[command-centre] single-ops override email AM:', e?.message));
        }
        if (requesterEmail && requesterEmail.includes('@')) {
          const htmlRequester = shiftReportOverrideCodeToRequesterHtml({
            reportRoute: routeLabel,
            reportDate,
            code,
            appUrl,
          });
          await sendEmail({
            to: requesterEmail,
            subject: 'Your single-ops shift report override code – Command Centre',
            body: htmlRequester,
            html: true,
          }).catch((e) => console.error('[command-centre] single-ops override email requester:', e?.message));
        }
      }
      res.status(201).json({ message: 'Override requested. Check your email for the code (and Access Management has been notified).' });
    } catch (err) {
      next(err);
    }
  });

  const patchDecision = (newStatus, clearApproval) => async (req, res, next) => {
    try {
      const getResult = await query(`SELECT id, status, submitted_to_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`, {
        id: req.params.id,
      });
      const existing = getResult.recordset?.[0];
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      if (getR(existing, 'submitted_to_user_id') !== req.user.id && req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Not allowed' });
      }
      const overrideCode = req.body?.override_code;
      const check = await requireSingleOpsEvaluationOrOverride(req.params.id, req.user.id, getR(existing, 'status'), overrideCode, {
        isSuperAdmin: req.user?.role === 'super_admin',
        submittedToUserId: getR(existing, 'submitted_to_user_id'),
      });
      if (check.error) return res.status(400).json({ error: check.error });
      const st = String(getR(existing, 'status'));
      if (!['pending_approval', 'provisional', 'approved', 'rejected'].includes(st)) {
        return res.status(400).json({ error: 'Report not in correct state' });
      }
      if (clearApproval) {
        await query(
          `UPDATE command_centre_single_ops_shift_reports SET status = @st, approved_by_user_id = NULL, approved_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
          { id: req.params.id, st: newStatus }
        );
      } else {
        await query(
          `UPDATE command_centre_single_ops_shift_reports SET status = @st, approved_by_user_id = @userId, approved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`,
          { id: req.params.id, st: newStatus, userId: req.user.id }
        );
      }
      const full = await fetchReportBundle(req.params.id, req.user.id);
      res.json({ report: full.report, evaluation: full.evaluation });
    } catch (err) {
      next(err);
    }
  };

  router.patch('/single-ops-shift-reports/:id/approve', patchDecision('approved', false));
  router.patch('/single-ops-shift-reports/:id/reject', patchDecision('rejected', true));
  router.patch('/single-ops-shift-reports/:id/provisional', patchDecision('provisional', true));

  router.patch('/single-ops-shift-reports/:id/revoke-approval', async (req, res, next) => {
    try {
      const getResult = await query(
        `SELECT id, status, approved_by_user_id FROM command_centre_single_ops_shift_reports WHERE id = @id`,
        { id: req.params.id }
      );
      const existing = getResult.recordset?.[0];
      if (!existing) return res.status(404).json({ error: 'Report not found' });
      if (String(getR(existing, 'status')).toLowerCase().trim() !== 'approved') {
        return res.status(400).json({ error: 'Only approved reports can have approval revoked' });
      }
      const approvedBy = getR(existing, 'approved_by_user_id') != null ? String(getR(existing, 'approved_by_user_id')).toLowerCase().trim() : '';
      const userId = req.user?.id != null ? String(req.user.id).toLowerCase().trim() : '';
      if (approvedBy !== userId && req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only the user who approved this report can revoke approval' });
      }
      await query(
        `UPDATE command_centre_single_ops_shift_reports SET status = N'draft', approved_by_user_id = NULL, approved_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`,
        { id: req.params.id }
      );
      const full = await fetchReportBundle(req.params.id, req.user.id);
      res.json({ report: full.report });
    } catch (err) {
      next(err);
    }
  });
}
