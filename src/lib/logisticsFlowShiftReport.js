import { getOpenAiClient, getAiModel, isAiConfigured } from './ai.js';
import {
  refineRowsForWhatsApp,
  resolveRouteDestinationShort,
  resolveRouteOriginShort,
  parseWhatsAppExportSectionCounts,
  isOriginSiteName,
  extractAtLocation,
} from './logisticsFlowWhatsApp.js';

function getRow(r, key) {
  if (!r) return undefined;
  const lower = String(key).toLowerCase();
  const entry = Object.entries(r).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function normalizeRouteKey(route) {
  return String(route || '')
    .replace(/\*\*/g, '')
    .replace(/→|->|=>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function pluralCount(n, singular, pluralWord) {
  const word = n === 1 ? singular : pluralWord || `${singular}s`;
  return `${n} ${word}`;
}

const QUEUE_DELAY_THRESHOLD = 5;

function classifyShiftReportRow(row, { originLabel, destLabel }) {
  const status = String(row.displayStatus || row.status || row.rawStatus || '').toLowerCase();
  const comment = String(row.comment || '').toLowerCase();
  const combined = `${status} ${comment}`;
  const atLoc = extractAtLocation(row.displayStatus || row.status || row.rawStatus || '');

  if (!row.enrollmentFound) return { bucket: 'not_integrated' };
  if (/\bbreak\s*down\b|\bbreakdown\b|\bbroke\b/.test(combined)) return { bucket: 'breakdown' };
  if (/tracker|tracking|not updating|gps|telematics/.test(combined)) return { bucket: 'tracker' };

  const isOffload = /offload|unload/.test(combined);
  const isQueue = /queue|queuing|standing/.test(combined);
  const isLoad = /loading/.test(combined);
  const isEnroute = /enroute|en route|transit|on route/.test(combined);

  if (isOffload) {
    if (atLoc && isOriginSiteName(atLoc, originLabel, destLabel)) {
      return { bucket: 'loading', site: originLabel };
    }
    return { bucket: 'offloading_dest', site: destLabel };
  }
  if (isQueue) {
    if (atLoc && isOriginSiteName(atLoc, originLabel, destLabel)) {
      return { bucket: 'queuing_origin', site: originLabel };
    }
    if (/ntshovelo|manungu|colliery|origin|load\s*out/.test(combined) && !isOriginSiteName(destLabel, destLabel, originLabel)) {
      return { bucket: 'queuing_origin', site: originLabel };
    }
    return { bucket: 'queuing_dest', site: destLabel };
  }
  if (isEnroute) return { bucket: 'enroute', site: destLabel };
  if (isLoad) {
    const site = atLoc && isOriginSiteName(atLoc, originLabel, destLabel) ? atLoc : originLabel;
    return { bucket: 'loading', site };
  }
  return { bucket: 'other' };
}

/** Structured fleet counts from reviewed rows (+ optional WhatsApp export sections). */
export function analyzeFleetForShiftReport(rows, routeLabel, whatsappExport = '') {
  const originLabel = resolveRouteOriginShort(routeLabel);
  const destLabel = resolveRouteDestinationShort(routeLabel);
  const refined = refineRowsForWhatsApp(rows || [], routeLabel);

  const counts = {
    breakdown: 0,
    tracker: 0,
    not_integrated: 0,
    loading: 0,
    enroute: 0,
    queuing_origin: 0,
    queuing_dest: 0,
    offloading_dest: 0,
  };

  for (const row of refined) {
    const { bucket } = classifyShiftReportRow(row, { originLabel, destLabel });
    if (counts[bucket] != null) counts[bucket] += 1;
  }

  const fromExport = parseWhatsAppExportSectionCounts(whatsappExport, { originLabel, destLabel });
  counts.loading = Math.max(counts.loading, fromExport.loading_origin);
  counts.enroute = Math.max(counts.enroute, fromExport.enroute);
  counts.queuing_origin = Math.max(counts.queuing_origin, fromExport.queuing_origin);
  counts.queuing_dest = Math.max(counts.queuing_dest, fromExport.queuing_dest);
  counts.offloading_dest = Math.max(counts.offloading_dest, fromExport.offloading_dest);

  return { originLabel, destLabel, counts, refined, fromExport };
}

/** Prose summary for shift report truck_updates (origin = loading; PS = queue/offload/enroute). */
export function buildShiftReportSummaryFromRows(rows, routeLabel, whatsappExport = '') {
  const { originLabel, destLabel, counts } = analyzeFleetForShiftReport(rows, routeLabel, whatsappExport);

  const parts = [];
  if (counts.breakdown) parts.push(pluralCount(counts.breakdown, 'breakdown'));
  if (counts.tracker) {
    parts.push(`${pluralCount(counts.tracker, 'truck', 'trucks')} tracker not updating`);
  }
  if (counts.not_integrated) {
    parts.push(`${pluralCount(counts.not_integrated, 'truck', 'trucks')} not integrated`);
  }
  if (counts.loading) {
    parts.push(`${pluralCount(counts.loading, 'truck', 'trucks')} loading at ${originLabel}`);
  }
  if (counts.enroute) {
    parts.push(`${pluralCount(counts.enroute, 'truck', 'trucks')} enroute to ${destLabel}`);
  }
  if (counts.queuing_origin) {
    parts.push(`${pluralCount(counts.queuing_origin, 'truck', 'trucks')} queueing at ${originLabel}`);
  }
  if (counts.queuing_dest) {
    parts.push(`${pluralCount(counts.queuing_dest, 'truck', 'trucks')} queueing at ${destLabel}`);
  }
  if (counts.offloading_dest) {
    parts.push(`${pluralCount(counts.offloading_dest, 'truck', 'trucks')} offloading at ${destLabel}`);
  }

  if (!parts.length) {
    const total = (rows || []).filter((r) => r.registration).length;
    return total
      ? `${total} truck${total === 1 ? '' : 's'} on ${originLabel} to ${destLabel} corridor`
      : 'Fleet update captured';
  }

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function collectReviewContext({ rows, routeAnalysis, parseWarnings }) {
  const notes = [];
  for (const row of rows || []) {
    const reg = row.registration || 'Unknown';
    if (row.comment) notes.push({ type: 'review_comment', text: `${reg}: ${row.comment}` });
    if (!row.enrollmentFound) notes.push({ type: 'not_integrated', text: `${reg} not on register` });
    if (row.contractorMismatch) {
      notes.push({
        type: 'contractor_mismatch',
        text: `${reg}: pasted contractor "${row.entity || '?'}" vs system "${row.systemContractor || '?'}"`,
      });
    }
    if (row.notOnSelectedRoute) notes.push({ type: 'not_on_route', text: `${reg} not on selected route enrolment` });
    if (row.registrationCorrected) notes.push({ type: 'plate_corrected', text: `${reg} plate auto-corrected during review` });
  }
  if (routeAnalysis?.pasteRouteMismatch) {
    notes.push({ type: 'route_mismatch', text: 'Pasted route banner did not match the selected route' });
  }
  if (routeAnalysis?.notOnRegisterCount) {
    notes.push({ type: 'summary', text: `${routeAnalysis.notOnRegisterCount} truck(s) not on register` });
  }
  if (routeAnalysis?.notOnRouteCount) {
    notes.push({ type: 'summary', text: `${routeAnalysis.notOnRouteCount} truck(s) not on route enrolment` });
  }
  if (routeAnalysis?.contractorMismatchCount) {
    notes.push({ type: 'summary', text: `${routeAnalysis.contractorMismatchCount} contractor name mismatch(es)` });
  }
  if (routeAnalysis?.enrolledNotInPasteCount) {
    notes.push({
      type: 'summary',
      text: `${routeAnalysis.enrolledNotInPasteCount} enrolled truck(s) missing from this paste`,
    });
  }
  for (const w of parseWarnings || []) {
    notes.push({ type: 'parse_warning', text: typeof w === 'string' ? w : w.text || String(w) });
  }
  return notes;
}

export function scoreDraftReport(report, { routeLabel }) {
  let score = 0;
  const status = String(report.status || '').toLowerCase();
  if (status === 'draft') score += 50;
  else if (status === 'provisional' || status === 'rejected') score += 25;

  const reportRoute = normalizeRouteKey(report.route || (report.routes || []).join(' '));
  const targetRoute = normalizeRouteKey(routeLabel);
  if (reportRoute && targetRoute) {
    if (reportRoute === targetRoute) score += 40;
    else if (reportRoute.includes(targetRoute) || targetRoute.includes(reportRoute)) score += 28;
    else {
      for (const t of targetRoute.split(' ').filter((x) => x.length >= 4)) {
        if (reportRoute.includes(t)) score += 6;
      }
    }
  }

  const ts = report.updated_at || report.created_at;
  if (ts) {
    const hours = (Date.now() - new Date(ts).getTime()) / 3600000;
    if (hours < 8) score += 12;
    else if (hours < 24) score += 6;
  }
  return score;
}

/**
 * Delays at the offloading site (destination PS) based on queue pressure.
 * Coal haulage: loading happens at colliery (Manungu/Ntshovelo); delays are queuing at the PS.
 */
export function assessOffloadingSiteDelays({ analysis, reviewNotes = [] }) {
  const { counts, destLabel } = analysis;
  const queuingAtDest = counts.queuing_dest || 0;
  const offloadingAtDest = counts.offloading_dest || 0;

  const breakdownNotes = (reviewNotes || []).filter(
    (n) =>
      n.type === 'review_comment' &&
      /breakdown|broke|immobil|accident|tyre|puncture/i.test(String(n.text || ''))
  );

  if (queuingAtDest >= QUEUE_DELAY_THRESHOLD) {
    const site = destLabel || 'the offloading site';
    return `Delays at ${site} due to a high number of trucks queuing`;
  }

  if (breakdownNotes.length === 1) {
    return breakdownNotes[0].text.replace(/^[^:]+:\s*/, 'Operational delay — ');
  }
  if (breakdownNotes.length > 1) {
    return `Operational delays — ${breakdownNotes.length} breakdown(s) noted in review`;
  }

  if (queuingAtDest === 0 && offloadingAtDest > 0) {
    return 'No delays';
  }

  return 'No delays';
}

export async function composeDelaysInsight({
  analysis,
  reviewNotes,
  routeLabel,
  whatsappExport,
  previousEntries = [],
  useAi = true,
}) {
  const ruleBased = assessOffloadingSiteDelays({ analysis, reviewNotes });

  if (!useAi || !isAiConfigured()) {
    return { delays: ruleBased, aiUsed: false };
  }

  const { counts, destLabel, originLabel } = analysis;
  const noteLines = (reviewNotes || [])
    .map((n) => (typeof n === 'string' ? n : n.text))
    .filter(Boolean)
    .slice(0, 30);
  const prevLines = (previousEntries || [])
    .slice(-3)
    .map((e) => [e.time, e.summary, e.delays].filter(Boolean).join(' | '));

  const client = getOpenAiClient();
  const model = getAiModel();
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You write the Delays column for a South African coal haulage shift report. ' +
          'Loading happens at the colliery/origin (e.g. Manungu, Ntshovelo). Offloading and queuing delays apply ONLY at the power station / offloading site (destination). ' +
          'Never describe offloading or delay congestion at the colliery/origin. ' +
          'Read the WhatsApp fleet export sections carefully (truck counts per status header). ' +
          'Reply with EXACTLY one of these unless a single specific breakdown was noted in review comments:\n' +
          '1) No delays\n' +
          '2) Delays at [destination site name] due to a high number of trucks queuing\n' +
          'Use (2) only when queuing at the destination/offloading site is clearly high (typically 5+ trucks queuing). ' +
          'Plain text only, one sentence, no markdown.',
      },
      {
        role: 'user',
        content: [
          `Route: ${routeLabel || '—'} (${originLabel || 'origin'} → ${destLabel || 'destination'})`,
          `Structured counts: ${counts.queuing_dest} queuing at ${destLabel}, ${counts.offloading_dest} offloading at ${destLabel}, ${counts.enroute} enroute, ${counts.loading} loading at ${originLabel}`,
          whatsappExport
            ? `WhatsApp export (read section headers and truck counts):\n${String(whatsappExport).slice(0, 12000)}`
            : '',
          noteLines.length ? `Review notes:\n${noteLines.map((l) => `- ${l}`).join('\n')}` : '',
          prevLines.length ? `Earlier updates today:\n${prevLines.map((l) => `- ${l}`).join('\n')}` : '',
          `Rule-based assessment: ${ruleBased}`,
          'Write the Delays field.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    max_tokens: 120,
    temperature: 0.2,
  });

  let text = String(completion.choices?.[0]?.message?.content || '').trim();
  text = text.replace(/^["']|["']$/g, '').replace(/\.$/, '');
  if (/^no delays?$/i.test(text)) text = 'No delays';
  if (!text) text = ruleBased;
  return { delays: text, aiUsed: true };
}

export async function composeShiftReportEntry({
  rows,
  routeLabel,
  routeAnalysis,
  parseWarnings,
  whatsappExport = '',
  previousEntries = [],
  useAi = true,
}) {
  const analysis = analyzeFleetForShiftReport(rows, routeLabel, whatsappExport);
  const reviewNotes = collectReviewContext({ rows: analysis.refined, routeAnalysis, parseWarnings });
  const summary = buildShiftReportSummaryFromRows(rows, routeLabel, whatsappExport);
  const { delays, aiUsed } = await composeDelaysInsight({
    analysis,
    reviewNotes,
    routeLabel,
    whatsappExport,
    previousEntries,
    useAi,
  });
  const now = new Date();
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return {
    time,
    summary,
    delays,
    aiUsed,
    reviewNotes,
    fleetCounts: analysis.counts,
  };
}

function mapShiftReportRow(r, kind) {
  if (!r) return null;
  let truckUpdates = [];
  try {
    truckUpdates = JSON.parse(getRow(r, 'truck_updates') || '[]');
  } catch (_) {
    truckUpdates = [];
  }
  let routes = [];
  if (kind === 'single_ops') {
    try {
      routes = JSON.parse(getRow(r, 'routes_json') || '[]');
    } catch (_) {
      routes = [];
    }
  }
  return {
    id: getRow(r, 'id'),
    ref_number: getRow(r, 'ref_number'),
    route: getRow(r, 'route'),
    routes: Array.isArray(routes) ? routes : [],
    report_date: getRow(r, 'report_date'),
    shift_date: getRow(r, 'shift_date'),
    status: getRow(r, 'status'),
    created_by_user_id: getRow(r, 'created_by_user_id'),
    created_at: getRow(r, 'created_at'),
    updated_at: getRow(r, 'updated_at'),
    truck_updates: Array.isArray(truckUpdates) ? truckUpdates : [],
    report_kind: kind,
  };
}

export async function listEditableDraftReports(query, tenantId, userId, { routeLabel } = {}) {
  const params = { tenantId, userId };
  const std = await query(
    `SELECT id, ref_number, route, report_date, shift_date, status, created_by_user_id, created_at, updated_at, truck_updates
     FROM command_centre_shift_reports
     WHERE tenant_id = @tenantId AND created_by_user_id = @userId
       AND status IN (N'draft', N'provisional', N'rejected')
     ORDER BY updated_at DESC`,
    params
  );
  const single = await query(
    `SELECT id, ref_number, routes_json, report_date, shift_date, status, created_by_user_id, created_at, updated_at, truck_updates
     FROM command_centre_single_ops_shift_reports
     WHERE tenant_id = @tenantId AND created_by_user_id = @userId
       AND status IN (N'draft', N'provisional', N'rejected')
     ORDER BY updated_at DESC`,
    params
  ).catch(() => ({ recordset: [] }));

  const reports = [
    ...(std.recordset || []).map((r) => mapShiftReportRow(r, 'shift')),
    ...(single.recordset || []).map((r) => mapShiftReportRow(r, 'single_ops')),
  ]
    .map((r) => ({
      ...r,
      relevance_score: scoreDraftReport(r, { routeLabel }),
      route_display: r.report_kind === 'single_ops' ? (r.routes || []).join(' + ') : r.route,
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score || new Date(b.updated_at) - new Date(a.updated_at));

  return reports;
}

export async function appendTruckUpdateToShiftReport(
  query,
  { tenantId, userId, reportKind, reportId, entry }
) {
  const table =
    reportKind === 'single_ops' ? 'command_centre_single_ops_shift_reports' : 'command_centre_shift_reports';
  const res = await query(`SELECT * FROM ${table} WHERE id = @id AND tenant_id = @tenantId`, {
    id: reportId,
    tenantId,
  });
  const row = res.recordset?.[0];
  if (!row) {
    const err = new Error('Shift report not found');
    err.status = 404;
    throw err;
  }
  const creatorId = String(getRow(row, 'created_by_user_id') || '').toLowerCase();
  if (creatorId !== String(userId || '').toLowerCase()) {
    const err = new Error('You can only link updates to your own shift reports');
    err.status = 403;
    throw err;
  }
  const status = String(getRow(row, 'status') || '').toLowerCase();
  if (!['draft', 'provisional', 'rejected'].includes(status)) {
    const err = new Error('Shift report cannot be edited in its current status');
    err.status = 400;
    throw err;
  }

  let truckUpdates = [];
  try {
    truckUpdates = JSON.parse(getRow(row, 'truck_updates') || '[]');
  } catch (_) {
    truckUpdates = [];
  }
  if (!Array.isArray(truckUpdates)) truckUpdates = [];

  const nextEntry = {
    time: entry.time || '',
    summary: entry.summary || '',
    delays: entry.delays || 'No delays',
  };
  truckUpdates.push(nextEntry);

  await query(
    `UPDATE ${table} SET truck_updates = @json, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
    { id: reportId, tenantId, json: JSON.stringify(truckUpdates) }
  );

  return {
    ok: true,
    truck_updates: truckUpdates,
    entry: nextEntry,
    ref_number: getRow(row, 'ref_number'),
    report_kind: reportKind,
  };
}
