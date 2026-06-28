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
const STATUS_OTHER = [71, 85, 105];

const BAR_HEIGHT = 6;
const ROW_HEIGHT = 5.5;
const CELL_PAD = 1.5;
const LINE_HEIGHT = 4;
const SECTION_GAP = 5;

function paintBackground(doc) {
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
}

function checkNewPage(doc, yRef, needSpace = 24) {
  if (yRef.current > PAGE_HEIGHT - FOOTER_MARGIN - needSpace) {
    doc.addPage();
    paintBackground(doc);
    yRef.current = MARGIN;
  }
}

function wrap(doc, text, maxW) {
  if (text == null || text === '') return [];
  return doc.splitTextToSize(String(text).trim(), Math.max(4, maxW || CONTENT_WIDTH));
}

function statusMeta(status) {
  const norm = String(status || '').toLowerCase().trim();
  if (!norm) return { label: '—', color: STATUS_OTHER };
  if (norm === 'approved') return { label: 'Approved', color: STATUS_APPROVED };
  if (norm === 'draft') return { label: 'Draft', color: STATUS_DRAFT };
  return { label: norm.charAt(0).toUpperCase() + norm.slice(1), color: STATUS_OTHER };
}

/** Full-width black bar with white uppercase title (matches shift report styling). */
function sectionBar(doc, yRef, title) {
  checkNewPage(doc, yRef, BAR_HEIGHT + 14);
  const y = yRef.current;
  doc.setFillColor(...BLACK);
  doc.rect(MARGIN, y, CONTENT_WIDTH, BAR_HEIGHT, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(String(title).toUpperCase(), MARGIN + 2, y + 4.2);
  yRef.current = y + BAR_HEIGHT + 3;
}

/** Free-text block under a section bar. */
function textBlock(doc, yRef, body) {
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_MUTED);
  const lines = wrap(doc, body || '—', CONTENT_WIDTH);
  for (const line of lines) {
    checkNewPage(doc, yRef, 8);
    doc.text(line, MARGIN, yRef.current);
    yRef.current += 4.6;
  }
  yRef.current += SECTION_GAP - 2;
}

/**
 * Bordered 4-column label/value panel (two key/value pairs per row), mirroring
 * the shift report "Report information" panel so cell text never touches borders.
 */
function kvPanel(doc, yRef, rawEntries) {
  const entries = rawEntries.filter((e) => e && e.label);
  if (!entries.length) return;
  const labelW = 40;
  const valueW = (CONTENT_WIDTH - labelW * 2) / 2;
  const colWidths = [labelW, valueW, labelW, valueW];
  const colXs = [MARGIN, MARGIN + labelW, MARGIN + labelW + valueW, MARGIN + labelW * 2 + valueW];
  const cellPadX = 1.8;
  const cellPadY = 1.6;
  const lineH = 4.2;

  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.3);

  const measure = (text, w, bold) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal');
    doc.setFontSize(FONT_SIZE_TABLE);
    return wrap(doc, bold ? `${text}:` : text || '—', w - cellPadX * 2).length;
  };

  for (let r = 0; r < entries.length; r += 2) {
    const left = entries[r];
    const right = entries[r + 1] || null;
    const maxLines = Math.max(
      left ? measure(left.label, colWidths[0], true) : 0,
      left ? measure(left.value, colWidths[1], false) : 0,
      right ? measure(right.label, colWidths[2], true) : 0,
      right ? measure(right.value, colWidths[3], false) : 0,
      1
    );
    const rowH = cellPadY * 2 + maxLines * lineH;
    checkNewPage(doc, yRef, rowH + 4);
    const y = yRef.current;

    doc.rect(MARGIN, y, CONTENT_WIDTH, rowH, 'S');
    for (let i = 1; i < 4; i += 1) doc.line(colXs[i], y, colXs[i], y + rowH);

    const drawCell = (x, w, text, bold) => {
      doc.setFont(FONT, bold ? 'bold' : 'normal');
      doc.setFontSize(FONT_SIZE_TABLE);
      doc.setTextColor(...(bold ? TEXT_DARK : TEXT_MUTED));
      const lines = wrap(doc, bold ? `${text}:` : text || '—', w - cellPadX * 2);
      lines.forEach((line, i) => doc.text(line, x + cellPadX, y + cellPadY + (i + 1) * lineH - 0.6));
    };

    if (left) {
      drawCell(colXs[0], colWidths[0], left.label, true);
      drawCell(colXs[1], colWidths[1], left.value, false);
    }
    if (right) {
      drawCell(colXs[2], colWidths[2], right.label, true);
      drawCell(colXs[3], colWidths[3], right.value, false);
    }
    yRef.current = y + rowH;
  }
  yRef.current += SECTION_GAP;
}

/**
 * Bordered data table with a header row and grid lines, mirroring the shift
 * report data table. Cell text is padded by CELL_PAD so it never touches lines.
 */
function dataTable(doc, yRef, headers, rows, colWidths) {
  const startX = MARGIN;
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.4);

  const drawHeader = () => {
    checkNewPage(doc, yRef, ROW_HEIGHT * 3 + 12);
    const y = yRef.current;
    doc.setFillColor(244, 246, 249);
    doc.rect(startX, y, CONTENT_WIDTH, ROW_HEIGHT, 'FD');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_TABLE);
    doc.setTextColor(...TEXT_DARK);
    let x = startX;
    headers.forEach((h, i) => {
      if (i > 0) doc.line(x, y, x, y + ROW_HEIGHT);
      const lines = wrap(doc, h, colWidths[i] - CELL_PAD * 2);
      doc.text(lines[0] || h, x + CELL_PAD, y + 3.8);
      x += colWidths[i];
    });
    yRef.current = y + ROW_HEIGHT;
  };

  drawHeader();
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_TABLE);
  doc.setTextColor(...TEXT_MUTED);

  rows.forEach((row) => {
    const cellLines = row.map((cell, colIdx) =>
      wrap(doc, cell != null && cell !== '' ? String(cell) : '—', Math.max(6, colWidths[colIdx] - CELL_PAD * 2))
    );
    const maxLines = Math.max(1, ...cellLines.map((arr) => arr.length));
    const rowH = Math.max(ROW_HEIGHT, maxLines * LINE_HEIGHT + CELL_PAD * 2);
    if (yRef.current > PAGE_HEIGHT - FOOTER_MARGIN - (rowH + 4)) {
      doc.addPage();
      paintBackground(doc);
      yRef.current = MARGIN;
      drawHeader();
      doc.setFont(FONT, 'normal');
      doc.setFontSize(FONT_SIZE_TABLE);
      doc.setTextColor(...TEXT_MUTED);
    }
    const y = yRef.current;
    doc.rect(startX, y, CONTENT_WIDTH, rowH, 'S');
    let x = startX;
    cellLines.forEach((lines, colIdx) => {
      if (colIdx > 0) doc.line(x, y, x, y + rowH);
      lines.forEach((line, i) => doc.text(line, x + CELL_PAD, y + CELL_PAD + (i + 1) * LINE_HEIGHT - 0.4));
      x += colWidths[colIdx];
    });
    yRef.current = y + rowH;
  });
  yRef.current += SECTION_GAP;
}

/** Column widths that sum exactly to CONTENT_WIDTH (last column absorbs remainder). */
function cols(...widths) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const diff = CONTENT_WIDTH - sum;
  return widths.map((w, i) => (i === widths.length - 1 ? w + diff : w));
}

/**
 * Bordered full-width label/value rows (one pair per row), so narrative content
 * (description, findings, notes) is laid out as a clean table with padded cells.
 */
function kvStack(doc, yRef, rawEntries) {
  const entries = rawEntries.filter((e) => e && e.label);
  if (!entries.length) return;
  const labelW = 46;
  const valueW = CONTENT_WIDTH - labelW;
  const cellPadX = 1.8;
  const cellPadY = 1.8;
  const lineH = 4.2;

  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.3);

  entries.forEach((e) => {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_TABLE);
    const labelLines = wrap(doc, `${e.label}:`, labelW - cellPadX * 2);
    doc.setFont(FONT, 'normal');
    const valueLines = wrap(doc, e.value != null && e.value !== '' ? String(e.value) : '—', valueW - cellPadX * 2);
    const maxLines = Math.max(labelLines.length, valueLines.length, 1);
    const rowH = cellPadY * 2 + maxLines * lineH;
    checkNewPage(doc, yRef, rowH + 4);
    const y = yRef.current;

    doc.rect(MARGIN, y, CONTENT_WIDTH, rowH, 'S');
    doc.line(MARGIN + labelW, y, MARGIN + labelW, y + rowH);

    doc.setFont(FONT, 'bold');
    doc.setTextColor(...TEXT_DARK);
    labelLines.forEach((line, i) => doc.text(line, MARGIN + cellPadX, y + cellPadY + (i + 1) * lineH - 0.6));

    doc.setFont(FONT, 'normal');
    doc.setTextColor(...TEXT_MUTED);
    valueLines.forEach((line, i) => doc.text(line, MARGIN + labelW + cellPadX, y + cellPadY + (i + 1) * lineH - 0.6));

    yRef.current = y + rowH;
  });
  yRef.current += SECTION_GAP;
}

/**
 * Render attached images, each captioned, scaled to content width with a max
 * height, paginating as needed. `images` is [{ caption, dataUrl }].
 */
function drawImagesSection(doc, yRef, images) {
  const list = (images || []).filter((img) => img && typeof img.dataUrl === 'string' && /^data:image\//i.test(img.dataUrl));
  if (!list.length) return;
  sectionBar(doc, yRef, 'Images / photos');
  const imgMaxW = CONTENT_WIDTH;
  const imgMaxH = 80;
  const pxToMm = 25.4 / 96;
  list.forEach((img, idx) => {
    const caption = (img.caption || '').trim() || `Image ${idx + 1}`;
    let wMm = imgMaxW;
    let hMm = imgMaxH;
    try {
      const dims = doc.getImageProperties(img.dataUrl);
      wMm = dims.width * pxToMm;
      hMm = dims.height * pxToMm;
      const scale = Math.min(imgMaxW / wMm, imgMaxH / hMm, 1);
      wMm *= scale;
      hMm *= scale;
    } catch (_) {
      wMm = imgMaxW / 2;
      hMm = imgMaxH;
    }
    checkNewPage(doc, yRef, hMm + 12);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_TABLE);
    doc.setTextColor(...TEXT_DARK);
    doc.text(caption, MARGIN, yRef.current + 3);
    yRef.current += 5;
    try {
      const format = /data:image\/jpe?g/i.test(img.dataUrl) ? 'JPEG' : 'PNG';
      doc.addImage(img.dataUrl, format, MARGIN, yRef.current, wMm, hMm, undefined, 'FAST');
      yRef.current += hMm + SECTION_GAP;
    } catch (_) { /* skip broken image */ }
  });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Generate investigation report PDF with the same professional, logo-branded
 * header and bordered tables used by shift reports.
 * @param {Object} report - Investigation report from API
 * @param {Object} options - Optional: { logoDataUrl }
 */
export function generateInvestigationReportPdf(report, options = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const yRef = { current: MARGIN };
  const logoDataUrl = options.logoDataUrl;
  paintBackground(doc);

  const logoFormat = logoDataUrl && /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG';

  // —— Header: centered square logo above the title, then ref, subtitle, divider ——
  const logoSize = 26;
  let headerY = 12;
  if (logoDataUrl) {
    try {
      const logoX = MARGIN + CONTENT_WIDTH / 2 - logoSize / 2;
      doc.addImage(logoDataUrl, logoFormat, logoX, 5, logoSize, logoSize, undefined, 'FAST');
      headerY = 5 + logoSize + 5;
    } catch (_) {}
  }

  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BLACK);
  const titleText = 'INVESTIGATION REPORT';
  doc.text(titleText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(titleText) / 2, headerY);

  const rightLines = [];
  if (report.ref_number) rightLines.push(`REF ${report.ref_number}`);
  if (report.case_number) rightLines.push(`CASE #${report.case_number}`);
  if (rightLines.length) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    rightLines.forEach((t, i) => doc.text(t, MARGIN + CONTENT_WIDTH - doc.getTextWidth(t), headerY + i * 4.5));
  }

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  const meta = [report.type, statusMeta(report.status).label, report.date_occurred ? fmtDate(report.date_occurred) : null]
    .filter(Boolean)
    .join('  ·  ');
  let lineY = headerY + 5;
  if (meta) {
    doc.text(meta, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(meta) / 2, lineY);
    lineY += 4.5;
  }
  const subtitleText = "Thinkers Afrika's Official Command Centre Investigation Documentation";
  doc.text(subtitleText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(subtitleText) / 2, lineY + 1);
  yRef.current = lineY + 6;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, yRef.current, MARGIN + CONTENT_WIDTH, yRef.current);
  yRef.current += 9;

  // —— Sections ——
  sectionBar(doc, yRef, 'Case information');
  kvPanel(doc, yRef, [
    { label: 'Reference', value: report.ref_number || '—' },
    { label: 'Case number', value: report.case_number || '—' },
    { label: 'Type', value: report.type || '—' },
    { label: 'Status', value: statusMeta(report.status).label },
    { label: 'Priority', value: report.priority || '—' },
    { label: 'Date occurred', value: fmtDate(report.date_occurred) },
    { label: 'Date reported', value: fmtDate(report.date_reported) },
    { label: 'Location', value: report.location || '—' },
    { label: 'Compiled by', value: report.created_by_name || '—' },
  ]);

  sectionBar(doc, yRef, 'Investigator');
  kvPanel(doc, yRef, [
    { label: 'Name', value: report.investigator_name || '—' },
    {
      label: 'Reported by',
      value: report.reported_by_name
        ? `${report.reported_by_name}${report.reported_by_position ? ` (${report.reported_by_position})` : ''}`
        : '—',
    },
  ]);

  sectionBar(doc, yRef, 'Description');
  kvStack(doc, yRef, [{ label: 'Summary', value: report.description || '—' }]);

  const transactions = Array.isArray(report.transactions) ? report.transactions : [];
  if (transactions.length) {
    sectionBar(doc, yRef, 'Transaction details');
    dataTable(
      doc,
      yRef,
      ['Ref', 'Date', 'Location', 'Type', 'Truck reg', 'Tonnage'],
      transactions.map((t) => [t.ref, t.date, t.location, t.type, t.truck_reg, t.tonnage]),
      cols(24, 22, 38, 26, 30, 30)
    );
  }

  const parties = Array.isArray(report.parties) ? report.parties : [];
  if (parties.length) {
    sectionBar(doc, yRef, 'Involved parties');
    dataTable(
      doc,
      yRef,
      ['Name', 'Role', 'Contact', 'Statement'],
      parties.map((p) => [p.name, p.role, p.contact, p.statement]),
      cols(38, 30, 30, 72)
    );
  }

  sectionBar(doc, yRef, 'Evidence notes');
  kvStack(doc, yRef, [{ label: 'Evidence', value: report.evidence_notes || '—' }]);

  sectionBar(doc, yRef, 'Findings');
  kvStack(doc, yRef, [
    { label: 'Summary', value: report.finding_summary },
    { label: 'Operational trigger', value: report.finding_operational_trigger },
    { label: 'The incident', value: report.finding_incident },
    { label: 'The workaround', value: report.finding_workaround },
    { label: 'System integrity', value: report.finding_system_integrity },
    { label: 'Resolution', value: report.finding_resolution },
  ]);

  sectionBar(doc, yRef, 'Recommendations');
  const recs = Array.isArray(report.recommendations) ? report.recommendations.filter(Boolean) : [];
  if (recs.length) {
    dataTable(
      doc,
      yRef,
      ['#', 'Recommendation'],
      recs.map((rec, i) => [String(i + 1), rec]),
      cols(12, CONTENT_WIDTH - 12)
    );
  } else {
    kvStack(doc, yRef, [{ label: 'Recommendation', value: '—' }]);
  }

  sectionBar(doc, yRef, 'Additional notes');
  kvStack(doc, yRef, [{ label: 'Notes', value: report.additional_notes || '—' }]);

  drawImagesSection(doc, yRef, options.attachmentImages);

  // —— Footer on every page ——
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER_SOFT);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_HEIGHT - 13, MARGIN + CONTENT_WIDTH, PAGE_HEIGHT - 13);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_SUBTLE);
    doc.text(`Generated ${new Date().toLocaleString()}`, MARGIN, PAGE_HEIGHT - 9);
    const pageLabel = `Page ${p} of ${totalPages}`;
    doc.text(pageLabel, MARGIN + CONTENT_WIDTH - doc.getTextWidth(pageLabel), PAGE_HEIGHT - 9);
  }

  return doc;
}

/** Build a descriptive filename for an investigation report PDF download. */
export function buildInvestigationReportFilename(report) {
  const parts = ['Investigation Report'];
  if (report?.case_number) parts.push(String(report.case_number));
  if (report?.type) parts.push(String(report.type));
  const base = parts
    .join(' - ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'investigation-report'}.pdf`;
}
