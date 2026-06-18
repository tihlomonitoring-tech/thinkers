import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { parseLogisticsFlowText, normReg } from '../lib/logisticsFlowParse.js';
import { parseLogisticsFlowWithAi } from '../lib/logisticsFlowAi.js';
import { isAiConfigured } from '../lib/ai.js';
import { refineRowsForWhatsApp } from '../lib/logisticsFlowWhatsApp.js';
import {
  loadRouteEnrollmentDetail,
  enrichRowsWithRoute,
} from '../lib/logisticsFlowRouteEnrich.js';
import {
  appendTruckUpdateToShiftReport,
  composeShiftReportEntry,
  listEditableDraftReports,
} from '../lib/logisticsFlowShiftReport.js';

const router = Router();

function getRow(r, key) {
  if (!r) return undefined;
  const lower = String(key).toLowerCase();
  const entry = Object.entries(r).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function tenantId(req) {
  return req.user?.tenant_id || null;
}

async function loadTruckEnrollmentMap(tenantIdVal) {
  const result = await query(
    `SELECT t.id, t.registration,
      COALESCE(c.name, t.main_contractor, t.sub_contractor) AS contractor_label,
      t.main_contractor, t.sub_contractor, t.facility_access
     FROM contractor_trucks t
     LEFT JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = @tenantId
     WHERE t.tenant_id = @tenantId`,
    { tenantId: tenantIdVal }
  );
  const map = new Map();
  for (const row of result.recordset || []) {
    const reg = normReg(getRow(row, 'registration'));
    if (!reg) continue;
    const label = String(getRow(row, 'contractor_label') || '').trim();
    map.set(reg, {
      truckId: getRow(row, 'id'),
      systemContractor: label,
      facilityAccess: !!getRow(row, 'facility_access'),
    });
  }
  return map;
}

async function finalizeRowsForRoute(tenantIdVal, { rows, enrollmentMap, routeId, routeLabel, pasteRoute }) {
  const routeEnrollment = routeId
    ? await loadRouteEnrollmentDetail(query, tenantIdVal, routeId)
    : { routeLabel: null, byRegistration: new Map(), registrations: [] };

  return enrichRowsWithRoute(rows, enrollmentMap, routeEnrollment, {
    routeId,
    routeLabel: routeLabel || routeEnrollment.routeLabel,
    pasteRoute,
  });
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function runParsePipeline({ text, useAi, tenantIdVal, routeId, routeLabel, onProgress }) {
  const progress = (p) => onProgress?.(p);

  progress({ phase: 'received', percent: 8, message: 'Reading pasted update…' });
  let parsed = { ...parseLogisticsFlowText(text), parseMethod: 'regex' };
  progress({
    phase: 'regex',
    percent: 28,
    message: `Rule-based scan found ${parsed.rows.length} truck line${parsed.rows.length === 1 ? '' : 's'}`,
  });

  progress({ phase: 'enrollment', percent: 42, message: 'Matching trucks on your register…' });
  const enrollmentMap = await loadTruckEnrollmentMap(tenantIdVal);

  let routeEnrollmentPreview = null;
  if (routeId) {
    routeEnrollmentPreview = await loadRouteEnrollmentDetail(query, tenantIdVal, routeId);
    progress({
      phase: 'enrollment',
      percent: 48,
      message: `Route enrolment: ${routeEnrollmentPreview.registrations.length} truck(s) on ${routeLabel || routeEnrollmentPreview.routeLabel || 'selected route'}`,
    });
  }

  if (useAi) {
    if (!isAiConfigured()) {
      return { error: 'AI is not configured. Use rule-based parse or set OPENAI_API_KEY.' };
    }
    progress({ phase: 'ai', percent: 55, message: 'Sending to AI for extraction (this may take a minute)…' });
    let aiPercent = 55;
    const heartbeat = setInterval(() => {
      aiPercent = Math.min(aiPercent + 4, 88);
      progress({
        phase: 'ai',
        percent: aiPercent,
        message: 'AI is still processing your update…',
      });
    }, 2500);
    try {
      const aiParsed = await parseLogisticsFlowWithAi(text, {
        routeLabel: routeLabel || parsed.meta?.route,
        routeRegistrations: routeEnrollmentPreview?.registrations || [],
      });
      if (aiParsed.error) return { error: aiParsed.error };
      parsed = aiParsed;
    } finally {
      clearInterval(heartbeat);
    }
    progress({ phase: 'ai', percent: 90, message: 'AI extraction finished — verifying rows…' });
  }

  const pasteRoute = parsed.meta?.route || null;
  const { rows: enrichedRows, routeAnalysis, enrolledNotInPaste } = await finalizeRowsForRoute(
    tenantIdVal,
    {
      rows: parsed.rows,
      enrollmentMap,
      routeId,
      routeLabel,
      pasteRoute,
    }
  );
  const labelForStatus = routeLabel || routeAnalysis?.routeLabel || pasteRoute || null;
  let rows = refineRowsForWhatsApp(enrichedRows, labelForStatus);
  progress({
    phase: 'finalize',
    percent: 96,
    message: routeId
      ? `Prepared ${rows.length} truck(s) — ${routeAnalysis.onRouteCount ?? 0} matched route enrolment`
      : `Prepared ${rows.length} truck row(s) for review`,
  });

  const warnings = [...(parsed.warnings || [])];
  if (routeAnalysis?.pasteRouteMismatch) {
    warnings.push({
      line: 0,
      text: `Pasted route "${pasteRoute}" does not closely match selected route "${routeAnalysis.routeLabel}". Status text uses the selected route destination.`,
    });
  }

  return {
    rows,
    warnings,
    comments: parsed.comments,
    meta: {
      ...parsed.meta,
      route_id: routeId || null,
      route_label: routeAnalysis?.routeLabel || routeLabel || null,
    },
    parseMethod: parsed.parseMethod || 'regex',
    aiError: parsed.aiError || null,
    aiAvailable: isAiConfigured(),
    routeTruckCount: routeAnalysis?.enrolledCount ?? routeEnrollmentPreview?.registrations?.length ?? null,
    routeAnalysis,
    enrolledNotInPaste: enrolledNotInPaste?.slice(0, 500) || [],
  };
}

function mapShift(row) {
  if (!row) return null;
  let summary = null;
  let confirmations = {};
  try { summary = JSON.parse(getRow(row, 'summary_json') || 'null'); } catch (_) {}
  try { confirmations = JSON.parse(getRow(row, 'confirmations_json') || '{}'); } catch (_) {}
  return {
    id: getRow(row, 'id'),
    tenantId: getRow(row, 'tenant_id'),
    routeId: getRow(row, 'route_id'),
    routeLabel: getRow(row, 'route_label'),
    shiftDate: getRow(row, 'shift_date'),
    status: getRow(row, 'status'),
    startedAt: getRow(row, 'started_at'),
    completedAt: getRow(row, 'completed_at'),
    summary,
    confirmations,
    portal: getRow(row, 'portal'),
    createdAt: getRow(row, 'created_at'),
  };
}

function mapUpdate(row) {
  if (!row) return null;
  let rows = [];
  let meta = {};
  try { rows = JSON.parse(getRow(row, 'rows_json') || '[]'); } catch (_) {}
  try { meta = JSON.parse(getRow(row, 'meta_json') || '{}'); } catch (_) {}
  return {
    id: getRow(row, 'id'),
    shiftId: getRow(row, 'shift_id'),
    columnIndex: getRow(row, 'column_index'),
    label: getRow(row, 'label'),
    pastedAt: getRow(row, 'pasted_at'),
    meta,
    rows,
  };
}

function computeShiftSummary(updates, confirmations) {
  const conf = confirmations || {};
  const closed = conf.closedDeliveries && typeof conf.closedDeliveries === 'object' ? conf.closedDeliveries : {};
  let deliveriesConfirmed = 0;
  let deliveriesNotCompleted = 0;
  let deliveriesPending = 0;
  let totalTons = 0;
  let totalHours = 0;
  let tonHourSamples = 0;
  const statusCounts = { complete: 0, queue: 0, transit: 0, other: 0 };

  for (const v of Object.values(closed)) {
    if (v?.status === 'completed') deliveriesConfirmed += 1;
    else if (v?.status === 'not_completed') deliveriesNotCompleted += 1;
  }

  for (const u of updates) {
    for (const r of u.rows || []) {
      const reg = normReg(r.registration);
      const key = `${reg}|${u.id}`;
      const c = conf[key];
      if (c === 'completed') deliveriesConfirmed += 1;
      else if (c === 'not_completed') deliveriesNotCompleted += 1;
      if (r.tons != null && !Number.isNaN(r.tons)) {
        totalTons += Number(r.tons);
        tonHourSamples += 1;
      }
      if (r.hours != null && !Number.isNaN(r.hours)) totalHours += Number(r.hours);
      const st = String(r.status || '').toLowerCase();
      if (/offload|complet|delivered/.test(st)) statusCounts.complete += 1;
      else if (/queue/.test(st)) statusCounts.queue += 1;
      else if (/enroute|en route|transit/.test(st)) statusCounts.transit += 1;
      else statusCounts.other += 1;
    }
  }

  const n = tonHourSamples || 1;
  return {
    deliveriesConfirmed,
    deliveriesNotCompleted,
    deliveriesPending,
    closedDeliveryCount: Object.keys(closed).length,
    totalTons: Math.round(totalTons * 100) / 100,
    totalHours: Math.round(totalHours * 100) / 100,
    averageTons: Math.round((totalTons / n) * 100) / 100,
    averageHours: Math.round((totalHours / n) * 100) / 100,
    statusCounts,
    updateCount: updates.length,
    truckTouchpoints: Object.keys(conf).length,
  };
}

/** Re-run route enrolment matching on already-parsed rows (e.g. user changed route dropdown). */
router.post('/enrich-rows', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const rows = req.body?.rows;
    const routeId = req.body?.route_id || req.body?.routeId || null;
    const routeLabel = String(req.body?.route_label || req.body?.routeLabel || '').trim() || null;
    const pasteRoute = String(req.body?.paste_route || req.body?.pasteRoute || req.body?.meta?.route || '').trim() || null;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array required' });
    }
    if (!routeId) {
      return res.status(400).json({ error: 'Select a route to verify against route enrolment.' });
    }
    const enrollmentMap = await loadTruckEnrollmentMap(tid);
    const { rows: enriched, routeAnalysis, enrolledNotInPaste } = await finalizeRowsForRoute(tid, {
      rows,
      enrollmentMap,
      routeId,
      routeLabel,
      pasteRoute,
    });
    const labelForStatus = routeLabel || routeAnalysis?.routeLabel || pasteRoute;
    const refined = refineRowsForWhatsApp(enriched, labelForStatus);
    res.json({
      rows: refined,
      routeAnalysis,
      enrolledNotInPaste: enrolledNotInPaste?.slice(0, 500) || [],
      routeTruckCount: routeAnalysis?.enrolledCount ?? null,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/parse', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const text = String(req.body?.text || '');
    const useAi = !!req.body?.useAi;
    const routeId = req.body?.route_id || req.body?.routeId || null;
    const routeLabel = String(req.body?.route_label || req.body?.routeLabel || '').trim() || null;
    if (!text.trim()) return res.status(400).json({ error: 'Paste fleet update text first.' });

    const result = await runParsePipeline({ text, useAi, tenantIdVal: tid, routeId, routeLabel });
    if (result.error) return res.status(503).json({ error: result.error });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** Server-sent events: real parse phases + AI heartbeat while waiting. */
router.post('/parse-stream', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const text = String(req.body?.text || '');
    const useAi = !!req.body?.useAi;
    const routeId = req.body?.route_id || req.body?.routeId || null;
    const routeLabel = String(req.body?.route_label || req.body?.routeLabel || '').trim() || null;
    if (!text.trim()) return res.status(400).json({ error: 'Paste fleet update text first.' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const result = await runParsePipeline({
      text,
      useAi,
      tenantIdVal: tid,
      routeId,
      routeLabel,
      onProgress: (p) => sseWrite(res, { type: 'progress', ...p }),
    });

    if (result.error) {
      sseWrite(res, { type: 'error', message: result.error });
    } else {
      sseWrite(res, { type: 'done', percent: 100, message: 'Complete', result });
    }
    res.end();
  } catch (e) {
    try {
      sseWrite(res, { type: 'error', message: e?.message || 'Parse failed' });
      res.end();
    } catch (_) {
      next(e);
    }
  }
});

router.get('/shifts/active', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const result = await query(
      `SELECT TOP 1 * FROM logistics_flow_shifts
       WHERE tenant_id = @tid AND status = N'active'
       ORDER BY started_at DESC`,
      { tid }
    );
    const shift = mapShift(result.recordset?.[0]);
    if (!shift) return res.json({ shift: null, updates: [] });
    const upd = await query(
      `SELECT * FROM logistics_flow_updates WHERE shift_id = @shiftId ORDER BY column_index`,
      { shiftId: shift.id }
    );
    res.json({ shift, updates: (upd.recordset || []).map(mapUpdate) });
  } catch (e) {
    if (e.message?.includes('Invalid object name')) {
      return res.json({ shift: null, updates: [], migrationRequired: true });
    }
    next(e);
  }
});

router.post('/shifts', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const routeId = req.body?.route_id || req.body?.routeId || null;
    const routeLabel = String(req.body?.route_label || req.body?.routeLabel || '').trim() || null;
    const shiftDate = req.body?.shift_date || req.body?.shiftDate || null;
    const portal = String(req.body?.portal || 'command_centre').slice(0, 40);

    await query(
      `UPDATE logistics_flow_shifts SET status = N'completed', completed_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
       WHERE tenant_id = @tid AND status = N'active'`,
      { tid }
    );

    const ins = await query(
      `INSERT INTO logistics_flow_shifts (tenant_id, route_id, route_label, shift_date, portal, created_by_user_id, confirmations_json)
       OUTPUT INSERTED.*
       VALUES (@tid, @routeId, @routeLabel, @shiftDate, @portal, @userId, N'{}')`,
      {
        tid,
        routeId,
        routeLabel,
        shiftDate: shiftDate || null,
        portal,
        userId: req.user?.id || null,
      }
    );
    res.json({ shift: mapShift(ins.recordset?.[0]) });
  } catch (e) {
    if (e.message?.includes('Invalid object name')) {
      return res.status(503).json({ error: 'Run npm run db:logistics-flow on the database.' });
    }
    next(e);
  }
});

router.get('/shifts', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const status = req.query.status === 'active' ? 'active' : 'completed';
    const result = await query(
      `SELECT TOP 50 * FROM logistics_flow_shifts
       WHERE tenant_id = @tid AND status = @status
       ORDER BY COALESCE(completed_at, started_at) DESC`,
      { tid, status }
    );
    res.json({ shifts: (result.recordset || []).map(mapShift) });
  } catch (e) {
    if (e.message?.includes('Invalid object name')) return res.json({ shifts: [], migrationRequired: true });
    next(e);
  }
});

router.get('/shifts/:id', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM logistics_flow_shifts WHERE id = @id AND tenant_id = @tid`,
      { id, tid }
    );
    const shift = mapShift(result.recordset?.[0]);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    const upd = await query(
      `SELECT * FROM logistics_flow_updates WHERE shift_id = @id ORDER BY column_index`,
      { id }
    );
    res.json({ shift, updates: (upd.recordset || []).map(mapUpdate) });
  } catch (e) {
    next(e);
  }
});

router.post('/shifts/:id/updates', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id: shiftId } = req.params;
    const rows = req.body?.rows;
    const rawText = String(req.body?.raw_text || req.body?.rawText || '');
    const meta = req.body?.meta || {};
    const label = String(req.body?.label || '').trim() || `Update ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No truck rows to save.' });
    }

    const shiftRes = await query(
      `SELECT * FROM logistics_flow_shifts WHERE id = @shiftId AND tenant_id = @tid AND status = N'active'`,
      { shiftId, tid }
    );
    if (!shiftRes.recordset?.[0]) return res.status(404).json({ error: 'Active shift not found' });

    const maxIdx = await query(
      `SELECT ISNULL(MAX(column_index), 0) AS mx FROM logistics_flow_updates WHERE shift_id = @shiftId`,
      { shiftId }
    );
    const columnIndex = (getRow(maxIdx.recordset?.[0], 'mx') || 0) + 1;

    const ins = await query(
      `INSERT INTO logistics_flow_updates (shift_id, tenant_id, column_index, label, raw_text, meta_json, rows_json, created_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@shiftId, @tid, @columnIndex, @label, @rawText, @metaJson, @rowsJson, @userId)`,
      {
        shiftId,
        tid,
        columnIndex,
        label,
        rawText: rawText || null,
        metaJson: JSON.stringify(meta),
        rowsJson: JSON.stringify(rows),
        userId: req.user?.id || null,
      }
    );

    if (meta?.route && !getRow(shiftRes.recordset[0], 'route_label')) {
      await query(
        `UPDATE logistics_flow_shifts SET route_label = @routeLabel, shift_date = COALESCE(shift_date, @shiftDate), updated_at = SYSUTCDATETIME() WHERE id = @shiftId`,
        {
          shiftId,
          routeLabel: meta.route,
          shiftDate: meta.date || null,
        }
      );
    }

    res.json({ update: mapUpdate(ins.recordset?.[0]) });
  } catch (e) {
    next(e);
  }
});

router.patch('/shifts/:id/confirmations', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id: shiftId } = req.params;
    const confirmations = req.body?.confirmations;
    if (!confirmations || typeof confirmations !== 'object') {
      return res.status(400).json({ error: 'confirmations object required' });
    }
    await query(
      `UPDATE logistics_flow_shifts SET confirmations_json = @json, updated_at = SYSUTCDATETIME()
       WHERE id = @shiftId AND tenant_id = @tid`,
      { shiftId, tid, json: JSON.stringify(confirmations) }
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/shift-report-drafts', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const routeLabel = String(req.query.route_label || req.query.routeLabel || '').trim() || null;
    const reports = await listEditableDraftReports(query, tid, req.user?.id, { routeLabel });
    res.json({ reports, suggested: reports[0] || null, aiAvailable: isAiConfigured() });
  } catch (e) {
    next(e);
  }
});

router.post('/compose-shift-report-entry', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const b = req.body || {};
    const rows = b.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'rows array required' });
    }
    const routeLabel = String(b.route_label || b.routeLabel || b.meta?.route_label || b.meta?.route || '').trim();
    const previousEntries = Array.isArray(b.previous_truck_updates) ? b.previous_truck_updates : [];
    const entry = await composeShiftReportEntry({
      rows,
      routeLabel,
      routeAnalysis: b.route_analysis || b.routeAnalysis || null,
      parseWarnings: b.parse_warnings || b.parseWarnings || [],
      whatsappExport: b.whatsapp_export || b.whatsappExport || '',
      previousEntries,
      useAi: b.useAi !== false,
    });
    res.json({ entry, aiAvailable: isAiConfigured() });
  } catch (e) {
    next(e);
  }
});

router.post('/shifts/:id/updates/:updateId/link-shift-report', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const { id: shiftId, updateId } = req.params;
    const b = req.body || {};
    const reportId = b.report_id || b.reportId;
    const reportKind = b.report_kind || b.reportKind || 'shift';
    if (!reportId) return res.status(400).json({ error: 'report_id required' });
    if (!b.entry?.summary) return res.status(400).json({ error: 'entry with summary required' });

    const updCheck = await query(
      `SELECT id, meta_json FROM logistics_flow_updates
       WHERE id = @updateId AND shift_id = @shiftId AND tenant_id = @tid`,
      { updateId, shiftId, tid }
    );
    if (!updCheck.recordset?.[0]) return res.status(404).json({ error: 'Logistics update not found' });

    const linkResult = await appendTruckUpdateToShiftReport(query, {
      tenantId: tid,
      userId: req.user?.id,
      reportKind,
      reportId,
      entry: b.entry,
    });

    let meta = {};
    try {
      meta = JSON.parse(getRow(updCheck.recordset[0], 'meta_json') || '{}');
    } catch (_) {}
    meta.shift_report = {
      report_id: reportId,
      report_kind: reportKind,
      ref_number: linkResult.ref_number,
      entry: linkResult.entry,
      linked_at: new Date().toISOString(),
    };

    await query(
      `UPDATE logistics_flow_updates SET meta_json = @meta WHERE id = @updateId`,
      { updateId, meta: JSON.stringify(meta) }
    );

    res.json({ ok: true, ...linkResult });
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: e.message });
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.status === 400) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.post('/shifts/:id/complete', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const { id: shiftId } = req.params;
    const shiftRes = await query(
      `SELECT * FROM logistics_flow_shifts WHERE id = @shiftId AND tenant_id = @tid`,
      { shiftId, tid }
    );
    const shiftRow = shiftRes.recordset?.[0];
    if (!shiftRow) return res.status(404).json({ error: 'Shift not found' });

    const upd = await query(
      `SELECT * FROM logistics_flow_updates WHERE shift_id = @shiftId ORDER BY column_index`,
      { shiftId }
    );
    const updates = (upd.recordset || []).map(mapUpdate);
    let confirmations = {};
    try { confirmations = JSON.parse(getRow(shiftRow, 'confirmations_json') || '{}'); } catch (_) {}

    const summary = computeShiftSummary(updates, confirmations);
    await query(
      `UPDATE logistics_flow_shifts
       SET status = N'completed', completed_at = SYSUTCDATETIME(), summary_json = @summary, updated_at = SYSUTCDATETIME()
       WHERE id = @shiftId`,
      { shiftId, summary: JSON.stringify(summary) }
    );
    res.json({ ok: true, summary });
  } catch (e) {
    next(e);
  }
});

router.get('/trucks/lookup', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    const reg = normReg(req.query.registration || '');
    if (!reg) return res.json({ found: false });
    const map = await loadTruckEnrollmentMap(tid);
    const sys = map.get(reg);
    res.json({
      found: !!sys,
      registration: reg,
      truckId: sys?.truckId || null,
      systemContractor: sys?.systemContractor || '',
      facilityAccess: !!sys?.facilityAccess,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
