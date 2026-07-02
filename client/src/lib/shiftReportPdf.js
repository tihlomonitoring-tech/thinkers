import { jsPDF } from 'jspdf';

const MARGIN = 18;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_MARGIN = 18;
const FONT = 'helvetica';
const FONT_SIZE_BODY = 9;
const FONT_SIZE_TABLE = 8;

const BLACK = [0, 0, 0];
const TABLE_BORDER = [60, 60, 60];
const TEXT_DARK = [33, 33, 33];
const TEXT_MUTED = [80, 80, 80];
const TEXT_SUBTLE = [110, 116, 130];
const BORDER_SOFT = [218, 223, 232];
const STATUS_APPROVED = [22, 163, 74];
const STATUS_DRAFT = [217, 119, 6];
const STATUS_REJECTED = [220, 38, 38];
const STATUS_OTHER = [71, 85, 105];

const BAR_HEIGHT = 6;
const ROW_HEIGHT = 5.5;
const TABLE_ROW_HEIGHT = 4.2;
const TABLE_LINE_HEIGHT = 3.4;
const TABLE_CELL_PAD = 1;
const CELL_PAD = 1.5;
const LINE_HEIGHT = 4;
const SECTION_GAP = 5;

function paintShiftReportPageBackground(doc) {
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
}

function checkNewPage(doc, yRef, needSpace = 30) {
  const minY = PAGE_HEIGHT - FOOTER_MARGIN - (needSpace || 20);
  if (yRef.current > minY) {
    doc.addPage();
    paintShiftReportPageBackground(doc);
    yRef.current = MARGIN;
  }
}

function wrap(doc, text, maxW) {
  if (!text) return [];
  const w = Math.max(4, (maxW || CONTENT_WIDTH) - 1);
  return doc.splitTextToSize(String(text).trim(), w);
}

/** Return column widths that sum exactly to CONTENT_WIDTH (last column absorbs remainder). */
function cols(...widths) {
  if (widths.length === 0) return [CONTENT_WIDTH];
  let sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [CONTENT_WIDTH];
  if (sum > CONTENT_WIDTH) {
    const scale = CONTENT_WIDTH / sum;
    const scaled = widths.map((w) => Math.max(10, w * scale));
    const scaledSum = scaled.reduce((a, b) => a + b, 0);
    scaled[scaled.length - 1] += CONTENT_WIDTH - scaledSum;
    return scaled;
  }
  const diff = CONTENT_WIDTH - sum;
  return widths.map((w, i) => (i === widths.length - 1 ? w + diff : w));
}

function setBodyFont(doc) {
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_MUTED);
}

function setTableFont(doc, bold = false) {
  doc.setFont(FONT, bold ? 'bold' : 'normal');
  doc.setFontSize(FONT_SIZE_TABLE);
  doc.setTextColor(...(bold ? BLACK : TEXT_DARK));
}

/** Full-width black bar with white uppercase text */
function sectionBar(doc, yRef, title) {
  checkNewPage(doc, yRef, BAR_HEIGHT + 12);
  const y = yRef.current;
  doc.setFillColor(...BLACK);
  doc.rect(MARGIN, y, CONTENT_WIDTH, BAR_HEIGHT, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), MARGIN + 2, y + 4.2);
  yRef.current = y + BAR_HEIGHT + 3;
}

/** Map a report status string to a display label and pill color. */
function statusBadgeMeta(status) {
  const raw = String(status || '').trim();
  const norm = raw.toLowerCase();
  if (!raw) return { label: '—', color: STATUS_OTHER };
  if (norm === 'approved' || norm === 'accepted') return { label: 'Approved', color: STATUS_APPROVED };
  if (norm === 'draft' || norm === 'pending' || norm === 'submitted' || norm === 'in_review' || norm === 'in review') {
    return { label: raw.charAt(0).toUpperCase() + raw.slice(1), color: STATUS_DRAFT };
  }
  if (norm === 'rejected' || norm === 'declined') return { label: raw.charAt(0).toUpperCase() + raw.slice(1), color: STATUS_REJECTED };
  return { label: raw.charAt(0).toUpperCase() + raw.slice(1), color: STATUS_OTHER };
}

/**
 * Minimal "Report information" panel — 4 columns of label/value cells.
 * Each cell stacks a tiny grey label above its value; thin dividers between rows.
 */
function drawReportInformationPanel(doc, yRef, report, isSingleOps) {
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  const routeText = isSingleOps
    ? (report.routes && report.routes.length ? report.routes.join(', ') : '—')
    : (report.route || '—');
  const shiftTimeText = [report.shift_start, report.shift_end].filter(Boolean).join(' – ') || '—';

  const entries = [];
  entries.push({ label: isSingleOps ? 'Routes' : 'Route', value: routeText });
  if (report.report_date) entries.push({ label: 'Report date', value: fmtDate(report.report_date) });
  if (report.shift_date) entries.push({ label: 'Shift date', value: fmtDate(report.shift_date) });
  if (shiftTimeText !== '—') entries.push({ label: 'Shift time', value: shiftTimeText });
  if (report.status) entries.push({ label: 'Status', value: statusBadgeMeta(report.status).label });
  if (report.controller1_name) entries.push({ label: 'Tel. specialist 1', value: report.controller1_name });
  if (report.controller2_name) entries.push({ label: 'Tel. specialist 2', value: report.controller2_name });
  if (report.controller1_email) entries.push({ label: 'Tel. specialist 1 email', value: report.controller1_email });
  if (report.controller2_email) entries.push({ label: 'Tel. specialist 2 email', value: report.controller2_email });
  if (report.created_by_name) entries.push({ label: 'Created by', value: report.created_by_name });
  if (report.created_at) entries.push({ label: 'Created at', value: fmtDateTime(report.created_at) });

  // 4 columns: [Label] [Value] [Label] [Value] — two key/value pairs side by side per row.
  const labelW = 44;
  const valueW = (CONTENT_WIDTH - labelW * 2) / 2;
  const colWidths = [labelW, valueW, labelW, valueW];
  const colXs = [MARGIN, MARGIN + labelW, MARGIN + labelW + valueW, MARGIN + labelW * 2 + valueW];
  const cellPadX = 1.8;
  const cellPadY = 1.6;
  const lineH = 4.2;

  const measureValue = (text, w) => {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(FONT_SIZE_TABLE);
    return wrap(doc, text || '—', w - cellPadX * 2).length;
  };
  const measureLabel = (text, w) => {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_TABLE);
    return wrap(doc, `${text}:`, w - cellPadX * 2).length;
  };

  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.3);

  for (let r = 0; r < entries.length; r += 2) {
    const left = entries[r];
    const right = entries[r + 1] || null;

    const linesLeftLabel = left ? measureLabel(left.label, colWidths[0]) : 0;
    const linesLeftValue = left ? measureValue(left.value, colWidths[1]) : 0;
    const linesRightLabel = right ? measureLabel(right.label, colWidths[2]) : 0;
    const linesRightValue = right ? measureValue(right.value, colWidths[3]) : 0;
    const maxLines = Math.max(linesLeftLabel, linesLeftValue, linesRightLabel, linesRightValue, 1);
    const rowH = cellPadY * 2 + maxLines * lineH;

    checkNewPage(doc, yRef, rowH + 4);
    const y = yRef.current;

    // Outer + vertical separators
    doc.rect(MARGIN, y, CONTENT_WIDTH, rowH, 'S');
    for (let i = 1; i < 4; i += 1) {
      const x = colXs[i];
      doc.line(x, y, x, y + rowH);
    }

    const drawLabelCell = (x, w, text) => {
      doc.setFont(FONT, 'bold');
      doc.setFontSize(FONT_SIZE_TABLE);
      doc.setTextColor(...TEXT_DARK);
      const lines = wrap(doc, `${text}:`, w - cellPadX * 2);
      lines.forEach((line, i) => {
        doc.text(line, x + cellPadX, y + cellPadY + (i + 1) * lineH - 0.4);
      });
    };
    const drawValueCell = (x, w, text) => {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(FONT_SIZE_TABLE);
      doc.setTextColor(...TEXT_MUTED);
      const lines = wrap(doc, text || '—', w - cellPadX * 2);
      lines.forEach((line, i) => {
        doc.text(line, x + cellPadX, y + cellPadY + (i + 1) * lineH - 0.4);
      });
    };

    if (left) {
      drawLabelCell(colXs[0], colWidths[0], left.label);
      drawValueCell(colXs[1], colWidths[1], left.value);
    }
    if (right) {
      drawLabelCell(colXs[2], colWidths[2], right.label);
      drawValueCell(colXs[3], colWidths[3], right.value);
    }

    yRef.current = y + rowH;
  }

  yRef.current += SECTION_GAP;
}

/** Two-column key-value table; full width CONTENT_WIDTH, compact rows */
function keyValueTable(doc, yRef, entries) {
  const labelW = 48;
  const valueW = CONTENT_WIDTH - labelW;
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.4);

  entries.forEach(([key, value]) => {
    setTableFont(doc, false);
    const lines = wrap(doc, value ?? '—', valueW - CELL_PAD * 2);
    const rowH = Math.max(ROW_HEIGHT, lines.length * LINE_HEIGHT + CELL_PAD * 2);
    checkNewPage(doc, yRef, rowH + 4);
    const y = yRef.current;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_TABLE);
    doc.setTextColor(...TEXT_DARK);
    doc.text(`${key}:`, MARGIN + CELL_PAD, y + CELL_PAD + LINE_HEIGHT);
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...TEXT_MUTED);
    doc.setFontSize(FONT_SIZE_TABLE);
    lines.forEach((line, i) => doc.text(line, MARGIN + labelW + CELL_PAD, y + CELL_PAD + (i + 1) * LINE_HEIGHT));
    doc.rect(MARGIN, y, CONTENT_WIDTH, rowH, 'S');
    doc.line(MARGIN + labelW, y, MARGIN + labelW, y + rowH);
    yRef.current = y + rowH;
  });
  yRef.current += SECTION_GAP;
}

/** Data table: full width CONTENT_WIDTH, compact grid, text wrapped in cells */
function drawTable(doc, yRef, headers, rows, colWidths) {
  const tableWidth = CONTENT_WIDTH;
  const startX = MARGIN;
  let y = yRef.current;

  checkNewPage(doc, yRef, TABLE_ROW_HEIGHT * 3 + 12);
  y = yRef.current;
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.35);
  setTableFont(doc, true);
  doc.rect(startX, y, tableWidth, TABLE_ROW_HEIGHT, 'S');
  let x = startX;
  headers.forEach((h, i) => {
    if (i > 0) doc.line(x, y, x, y + TABLE_ROW_HEIGHT);
    const lines = wrap(doc, h, colWidths[i] - TABLE_CELL_PAD * 2);
    doc.text(lines[0] || h, x + TABLE_CELL_PAD, y + 3.2);
    x += colWidths[i];
  });
  doc.line(startX + tableWidth, y, startX + tableWidth, y + TABLE_ROW_HEIGHT);
  y += TABLE_ROW_HEIGHT;

  setTableFont(doc, false);

  rows.forEach((row) => {
    const cellLines = row.map((cell, colIdx) => {
      const cellW = Math.max(6, colWidths[colIdx] - TABLE_CELL_PAD * 2);
      return wrap(doc, cell != null ? String(cell) : '—', cellW);
    });
    const maxLines = Math.max(1, ...cellLines.map((arr) => arr.length));
    const rowH = Math.max(TABLE_ROW_HEIGHT, maxLines * TABLE_LINE_HEIGHT + TABLE_CELL_PAD * 2);
    yRef.current = y;
    checkNewPage(doc, yRef, rowH + 4);
    y = yRef.current;
    doc.rect(startX, y, tableWidth, rowH, 'S');
    x = startX;
    row.forEach((cell, colIdx) => {
      if (colIdx > 0) doc.line(x, y, x, y + rowH);
      const lines = cellLines[colIdx] || [];
      lines.forEach((line, i) => doc.text(line, x + TABLE_CELL_PAD, y + TABLE_CELL_PAD + (i + 1) * TABLE_LINE_HEIGHT));
      x += colWidths[colIdx];
    });
    doc.line(startX + tableWidth, y, startX + tableWidth, y + rowH);
    y += rowH;
  });

  yRef.current = y + SECTION_GAP;
}

/** Build auto declaration from controller names */
function buildDeclaration(report) {
  const c1 = (report.controller1_name || '').trim();
  const c2 = (report.controller2_name || '').trim();
  if (c1 && c2) {
    return `As the telematics specialists on duty, ${c1} and ${c2}, we certify that the information contained in this shift report is accurate and complete to the best of our knowledge.`;
  }
  if (c1) {
    return `As the telematics specialist on duty, ${c1}, I certify that the information contained in this shift report is accurate and complete to the best of my knowledge.`;
  }
  return 'As the telematics specialist(s) on duty, we certify that the information contained in this shift report is accurate and complete to the best of our knowledge.';
}

/** Strip characters that are invalid in file names on common OSes. */
function sanitizeFilenamePart(s, fallback = '') {
  const t = String(s ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || fallback;
}

/** Parse hour 0–23 from shift_start / shift_end strings (e.g. 06:00, 18:30, 6pm). */
function parseHourFromShiftTime(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim();
  const lower = s.toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(a\.?m\.?|p\.?m\.?))?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const suf = m[3] ? m[3].replace(/\./g, '').toLowerCase() : '';
  const isPm = suf.startsWith('p') || (!suf && lower.includes('pm') && !lower.includes('am'));
  const isAm = suf.startsWith('a') || (!suf && lower.includes('am'));
  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;
  if (!isPm && !isAm && lower.includes('pm') && h < 12) h += 12;
  if (!isPm && !isAm && lower.includes('am') && h === 12) h = 0;
  return ((h % 24) + 24) % 24;
}

function inferDayOrNightShift(report) {
  const h = parseHourFromShiftTime(report.shift_start);
  if (h != null) {
    if (h >= 18 || h < 6) return 'Night';
    return 'Day';
  }
  const h2 = parseHourFromShiftTime(report.shift_end);
  if (h2 != null) {
    if (h2 >= 18 || h2 < 6) return 'Night';
    return 'Day';
  }
  return 'Day';
}

function formatShiftReportFileDate(report) {
  const raw = report.report_date || report.shift_date || report.created_at;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format a numeric ref into a 3-digit reference string, prefixed with "S" for
 * single-operations reports (e.g. 7 → "007", or "S007" when isSingleOps).
 * Accepts either (refNumber, { isSingleOps }) or a report-like object.
 */
export function formatShiftReportRef(refNumberOrReport, options = {}) {
  let refNumber = refNumberOrReport;
  let isSingleOps = !!options.isSingleOps;
  if (refNumberOrReport && typeof refNumberOrReport === 'object') {
    refNumber = refNumberOrReport.ref_number;
    isSingleOps = refNumberOrReport.report_kind === 'single_ops'
      || (Array.isArray(refNumberOrReport.routes) && refNumberOrReport.routes.length > 0)
      || isSingleOps;
  }
  if (refNumber == null || refNumber === '') return '';
  const n = Number(refNumber);
  if (!Number.isFinite(n) || n <= 0) return '';
  const padded = String(Math.trunc(n)).padStart(3, '0');
  return isSingleOps ? `S${padded}` : padded;
}

/**
 * Download filename for shift report PDFs, e.g.
 * "001 Tihlo Day Shift Report 27 Mar 2026 - Anthra Siding.pdf"
 * @param {Object} report
 * @param {Object} [options]
 * @param {string} [options.tenantName] - Company name (defaults to report.tenant_name or "Tihlo")
 */
export function buildShiftReportDownloadFilename(report, options = {}) {
  const tenant = sanitizeFilenamePart(options.tenantName || report.tenant_name, 'Tihlo');
  const dayNight = inferDayOrNightShift(report);
  const dateStr = formatShiftReportFileDate(report);
  const isSo = report.report_kind === 'single_ops' || (Array.isArray(report.routes) && report.routes.length);
  const routeLabel = isSo
    ? sanitizeFilenamePart((report.routes || []).join(' + ') || 'Multi-route', 'Routes')
    : sanitizeFilenamePart(report.route, 'Route');
  const kindLabel = isSo ? 'Single operation shift report' : 'Shift Report';
  const ref = formatShiftReportRef(report.ref_number, { isSingleOps: isSo });
  const refPrefix = ref ? `${ref} ` : '';
  const base = `${refPrefix}${tenant} ${dayNight} ${kindLabel} ${dateStr} - ${routeLabel}`;
  return `${base}.pdf`;
}

/**
 * Generate shift report PDF.
 * @param {Object} report - Shift report from API
 * @param {Object} options - Optional: { logoDataUrl }
 */
export function generateShiftReportPdf(report, options = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const yRef = { current: MARGIN };
  const logoDataUrl = options.logoDataUrl;
  paintShiftReportPageBackground(doc);

  const logoFormat = logoDataUrl && /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG';

  // —— Header: logo centered above title (square to avoid squashing), then SHIFT REPORT, route, subtitle, line ——
  const logoSize = 26;
  let headerY = 10;
  if (logoDataUrl) {
    try {
      const logoX = MARGIN + CONTENT_WIDTH / 2 - logoSize / 2;
      doc.addImage(logoDataUrl, logoFormat, logoX, 5, logoSize, logoSize, undefined, 'FAST');
      headerY = 5 + logoSize + 5;
    } catch (_) {}
  }
  const isSingleOps = report.report_kind === 'single_ops' || (Array.isArray(report.routes) && report.routes.length > 0);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BLACK);
  const titleText = isSingleOps ? 'SINGLE OPERATION SHIFT REPORT' : 'SHIFT REPORT';
  doc.text(titleText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(titleText) / 2, headerY);
  const refStr = formatShiftReportRef(report.ref_number, { isSingleOps });
  if (refStr) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    const refLabel = `REF #${refStr}`;
    doc.text(refLabel, MARGIN + CONTENT_WIDTH - doc.getTextWidth(refLabel), headerY);
  }
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_MUTED);
  const routeLineMaxW = CONTENT_WIDTH - 4;
  const routeLineH = 4.5;
  const routeText = isSingleOps
    ? report.routes && report.routes.length
      ? `Routes: ${report.routes.join(', ')}`
      : 'Routes: —'
    : report.route
      ? `Route: ${report.route}`
      : 'Route: —';
  const routeLines = doc.splitTextToSize(routeText, routeLineMaxW);
  let routeY = headerY + 5;
  routeLines.forEach((line) => {
    doc.text(line, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(line) / 2, routeY);
    routeY += routeLineH;
  });
  const subtitleText = "Thinkers Afrika's Official Telematics Specialist Shift Documentation";
  doc.text(subtitleText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(subtitleText) / 2, routeY + 1);
  yRef.current = routeY + 6;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, yRef.current, MARGIN + CONTENT_WIDTH, yRef.current);
  yRef.current += 10;

  // —— REPORT INFORMATION ——
  sectionBar(doc, yRef, 'Report information');
  drawReportInformationPanel(doc, yRef, report, isSingleOps);

  // —— SHIFT SUMMARY & OVERVIEW: single table including metrics, Overall Performance, Key highlights ——
  sectionBar(doc, yRef, 'Shift summary & overview');
  const summaryEntries = [
    ['Total Trucks Scheduled', report.total_trucks_scheduled],
    ['Balance Brought Down', report.balance_brought_down],
    ['Total Loads Dispatched', report.total_loads_dispatched],
    ['Total Pending Deliveries', report.total_pending_deliveries],
    ['Total Loads Delivered', report.total_loads_delivered],
  ].filter(([, v]) => v != null && v !== '' && v !== undefined);
  if ((report.overall_performance || '').trim()) summaryEntries.push(['Overall Performance', report.overall_performance]);
  if ((report.key_highlights || '').trim()) summaryEntries.push(['Key Highlights', report.key_highlights]);
  if (summaryEntries.length) keyValueTable(doc, yRef, summaryEntries);

  const routeLoadTotals = Array.isArray(report.route_load_totals) ? report.route_load_totals : [];
  if (isSingleOps && routeLoadTotals.length) {
    sectionBar(doc, yRef, 'Total loads delivered per route');
    drawTable(
      doc,
      yRef,
      ['Route', 'Total loads delivered'],
      routeLoadTotals.map((row) => [row.route_name || '—', row.total_loads_delivered != null && row.total_loads_delivered !== '' ? String(row.total_loads_delivered) : '—']),
      cols(72, CONTENT_WIDTH - 72)
    );
  }

  const truckDel = Array.isArray(report.truck_deliveries) ? report.truck_deliveries : [];
  if (isSingleOps && truckDel.length) {
    sectionBar(doc, yRef, 'Deliveries per truck (performance account)');
    drawTable(
      doc,
      yRef,
      ['Truck registration', 'Driver', 'Route', 'Loads Delivered', 'Remarks'],
      truckDel.map((row) => [
        row.truck_registration || '—',
        row.driver_name || '—',
        row.route_name || '—',
        row.completed_deliveries != null && row.completed_deliveries !== '' ? String(row.completed_deliveries) : '—',
        row.remarks || '—',
      ]),
      cols(34, 40, 46, 24, 30)
    );
  }

  const truckUpdates = Array.isArray(report.truck_updates) ? report.truck_updates : [];
  if (truckUpdates.length) {
    sectionBar(doc, yRef, 'Truck updates & logistics flow');
    drawTable(doc, yRef, ['Time', 'Summary', 'Delays'], truckUpdates.map((u) => [u.time || '—', u.summary || '—', u.delays || '—']), cols(18, CONTENT_WIDTH - 18 - 42, 42));
  }

  const incidents = Array.isArray(report.incidents) ? report.incidents : [];
  const nonComp = Array.isArray(report.non_compliance_calls) ? report.non_compliance_calls : [];
  const invs = Array.isArray(report.investigations) ? report.investigations : [];

  if (incidents.length) {
    sectionBar(doc, yRef, 'Incidents/breakdowns');
    drawTable(doc, yRef, ['Truck', 'Time', 'Driver', 'Issue', 'Status'], incidents.map((i) => [i.truck_reg, i.time_reported, i.driver_name, i.issue, i.status]), cols(22, 18, 28, 60, 22));
  }
  if (nonComp.length) {
    sectionBar(doc, yRef, 'Non-compliance calls');
    drawTable(doc, yRef, ['Driver', 'Truck', 'Rule violated', 'Time', 'Summary', 'Response'], nonComp.map((n) => [n.driver_name, n.truck_reg, n.rule_violated, n.time_of_call, n.summary, n.driver_response]), cols(22, 22, 26, 16, 52, 30));
  }
  if (invs.length) {
    sectionBar(doc, yRef, 'Investigations (findings & action taken)');
    drawTable(doc, yRef, ['Truck', 'Time', 'Location', 'Issue / Findings'], invs.map((inv) => [inv.truck_reg, inv.time, inv.location, [inv.issue_identified, inv.findings].filter(Boolean).join(' — ') || '—']), cols(22, 18, 38, 88));
  }

  const comms = Array.isArray(report.communication_log) ? report.communication_log : [];
  if (comms.length) {
    sectionBar(doc, yRef, 'Communication log');
    drawTable(doc, yRef, ['Time', 'Recipient', 'Subject', 'Method', 'Action required'], comms.map((c) => [c.time || '—', c.recipient || '—', c.subject || '—', c.method || '—', c.action_required || '—']), cols(16, 34, 48, 26, 42));
  }

  sectionBar(doc, yRef, 'Handover information for incoming telematics specialist');
  keyValueTable(doc, yRef, [
    ['Outstanding issues', report.outstanding_issues],
    ['Key information', report.handover_key_info],
  ].filter(([, v]) => v != null && v !== ''));

  sectionBar(doc, yRef, 'Telematics specialist declaration');
  const declarationText = buildDeclaration(report);
  keyValueTable(doc, yRef, [
    ['Declaration', declarationText],
    ['Shift conclusion time', report.shift_conclusion_time],
  ].filter(([, v]) => v != null && v !== ''));

  // —— APPROVERS INFORMATION (table at end) ——
  sectionBar(doc, yRef, 'Approvers / Approval information');
  const approverRows = [];
  const subTo = (report.submitted_to_name || report.submitted_to_email) && (report.status === 'pending_approval' || report.status === 'provisional' || report.status === 'approved');
  if (subTo) {
    approverRows.push(['Submitted to', report.submitted_to_name || '—', report.submitted_to_email || '—', report.submitted_at ? new Date(report.submitted_at).toLocaleString() : '—']);
  }
  if (report.approved_by_name || report.approved_at) {
    approverRows.push(['Approved by', report.approved_by_name || '—', '—', report.approved_at ? new Date(report.approved_at).toLocaleString() : '—']);
  }
  if (approverRows.length) {
    drawTable(doc, yRef, ['Role', 'Name', 'Email', 'Date'], approverRows.map((r) => [r[0], r[1], r[2], r[3]]), cols(28, 48, 58, 32));
  } else {
    setBodyFont(doc);
    checkNewPage(doc, yRef, 12);
    doc.text('No approval information recorded.', MARGIN, yRef.current + 5);
    yRef.current += 12;
  }

  // —— Footer: keep clear of content ——
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generated ${new Date().toLocaleString()} · Page ${p} of ${totalPages}`, MARGIN, PAGE_HEIGHT - 10);
  }

  return doc;
}
