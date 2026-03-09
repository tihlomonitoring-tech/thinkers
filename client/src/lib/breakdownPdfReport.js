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

const BAR_HEIGHT = 6;
const ROW_HEIGHT = 5.5;
const CELL_PAD = 1.5;
const LINE_HEIGHT = 4;
const SECTION_GAP = 5;

function checkNewPage(doc, yRef, needSpace = 30) {
  const minY = PAGE_HEIGHT - FOOTER_MARGIN - (needSpace || 20);
  if (yRef.current > minY) {
    doc.addPage();
    yRef.current = MARGIN;
  }
}

function wrap(doc, text, maxW) {
  if (!text) return [];
  const w = Math.max(4, (maxW || CONTENT_WIDTH) - 1);
  return doc.splitTextToSize(String(text).trim(), w);
}

function setTableFont(doc, bold = false) {
  doc.setFont(FONT, bold ? 'bold' : 'normal');
  doc.setFontSize(FONT_SIZE_TABLE);
  doc.setTextColor(...(bold ? TEXT_DARK : TEXT_MUTED));
}

/** Full-width black bar with white uppercase text (shift report style) */
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

/** Two-column key-value table; full width, bordered rows (shift report style) */
function keyValueTable(doc, yRef, entries) {
  const labelW = 48;
  const valueW = CONTENT_WIDTH - labelW;
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.4);

  entries.forEach(([key, value]) => {
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

/**
 * Generate a breakdown/incident report PDF (shift report style: section bars + key-value tables).
 * @param {Object} options
 * @param {Object} options.incident - Incident record (type, title, description, reported_at, location, etc.)
 * @param {string} options.ref - e.g. INC-XXXX
 * @param {string} options.truckName - Truck registration or '—'
 * @param {string} options.driverName - Driver name or '—'
 * @param {string} options.typeLabel - Display type (e.g. "Breakdown")
 * @param {string} [options.routeName] - Route name if available
 * @param {string[]} options.attachmentLabels - e.g. ['Loading slip', 'Seal 1']
 * @param {{ label: string, dataUrl: string }[]} [options.attachmentImages] - Optional image attachments to embed
 * @param {function} options.formatDateTime - (d) => string
 * @param {function} options.formatDate - (d) => string
 * @param {string} [options.logoDataUrl] - Optional data URL for logo image (shown above title)
 */
export function generateBreakdownPdf({
  incident,
  ref,
  truckName,
  driverName,
  typeLabel,
  routeName,
  attachmentLabels = [],
  attachmentImages = [],
  formatDateTime,
  formatDate,
  logoDataUrl,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const yRef = { current: MARGIN };

  const get = (obj, ...keys) => {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj[k];
      if (v !== undefined && v !== null) return v;
    }
    const first = keys[0];
    if (!first) return null;
    const lower = String(first).toLowerCase().replace(/_/g, '');
    for (const [key, val] of Object.entries(obj)) {
      if (key && key.toLowerCase().replace(/_/g, '') === lower && val !== undefined && val !== null) return val;
    }
    return null;
  };

  // —— Header: logo (optional) then BREAKDOWN REPORT (shift report style) ——
  const logoFormat = logoDataUrl && /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG';
  const logoSize = 26;
  let headerY = 10;
  if (logoDataUrl) {
    try {
      const logoX = MARGIN + CONTENT_WIDTH / 2 - logoSize / 2;
      doc.addImage(logoDataUrl, logoFormat, logoX, 5, logoSize, logoSize, undefined, 'FAST');
      headerY = 5 + logoSize + 5;
    } catch (_) {}
  }
  checkNewPage(doc, yRef, headerY + 25);
  yRef.current = headerY;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BLACK);
  const titleText = 'BREAKDOWN REPORT';
  doc.text(titleText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(titleText) / 2, yRef.current);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_MUTED);
  const refText = `Reference: ${ref}`;
  doc.text(refText, MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth(refText) / 2, yRef.current + 6);
  doc.text('Breakdown / incident report · Thinkers', MARGIN + CONTENT_WIDTH / 2 - doc.getTextWidth('Breakdown / incident report · Thinkers') / 2, yRef.current + 11);
  yRef.current += 15;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, yRef.current, MARGIN + CONTENT_WIDTH, yRef.current);
  yRef.current += 10;

  // —— INCIDENT DETAILS (key-value table) ——
  sectionBar(doc, yRef, 'Incident details');
  const reportedAt = get(incident, 'reported_at', 'reportedAt');
  const location = get(incident, 'location');
  const incidentDetails = [
    ['Reference ID', ref],
    ['Type', typeLabel || get(incident, 'type') || '—'],
    ['Title', get(incident, 'title') || '—'],
    ['Severity', get(incident, 'severity') || '—'],
    ['Reported at', reportedAt ? formatDateTime(reportedAt) : '—'],
    ['Location', location || '—'],
    ['Route', routeName || '—'],
    ['Driver', driverName || '—'],
    ['Truck', truckName || '—'],
  ];
  keyValueTable(doc, yRef, incidentDetails);

  // —— DESCRIPTION & ACTIONS ——
  const description = get(incident, 'description');
  const actionsTaken = get(incident, 'actions_taken', 'actionsTaken');
  if (description || actionsTaken) {
    sectionBar(doc, yRef, 'Description & actions');
    const descActions = [
      ...(description ? [['Description', description]] : []),
      ...(actionsTaken ? [['Actions taken', actionsTaken]] : []),
    ];
    keyValueTable(doc, yRef, descActions);
  }

  // —— ATTACHMENTS ——
  if (attachmentLabels.length > 0 || attachmentImages.length > 0) {
    sectionBar(doc, yRef, 'Attachments');
    const listText = attachmentLabels.length > 0 ? attachmentLabels.join(', ') : '';
    if (listText) {
      keyValueTable(doc, yRef, [['Attachments', listText]]);
    }
    const imgMaxW = CONTENT_WIDTH;
    const imgMaxH = 45;
    for (const { label, dataUrl } of attachmentImages) {
      if (!dataUrl || !/^data:image\//i.test(dataUrl)) continue;
      checkNewPage(doc, yRef, imgMaxH + 18);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(FONT_SIZE_TABLE);
      doc.setTextColor(...TEXT_DARK);
      doc.text(label, MARGIN, yRef.current + 4);
      yRef.current += 6;
      try {
        const format = /data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';
        const dims = doc.getImageProperties(dataUrl);
        const pxToMm = 25.4 / 96;
        let wMm = dims.width * pxToMm;
        let hMm = dims.height * pxToMm;
        const scale = Math.min(imgMaxW / wMm, imgMaxH / hMm, 1);
        wMm *= scale;
        hMm *= scale;
        doc.addImage(dataUrl, format, MARGIN, yRef.current, wMm, hMm, undefined, 'FAST');
        yRef.current += hMm + 6;
      } catch (_) { /* skip broken image */ }
    }
    if (attachmentImages.length > 0) yRef.current += SECTION_GAP;
  }

  // —— RESOLUTION (if resolved) ——
  const resolvedAt = get(incident, 'resolved_at', 'resolvedAt');
  if (resolvedAt) {
    sectionBar(doc, yRef, 'Resolution');
    const resolutionNote = get(incident, 'resolution_note', 'resolutionNote');
    const resolutionEntries = [
      ['Resolved at', formatDate(resolvedAt)],
      ...(resolutionNote ? [['Resolution note', resolutionNote]] : []),
    ];
    if (get(incident, 'offloading_slip_path', 'offloadingSlipPath')) {
      resolutionEntries.push(['Offloading slip', 'Attached']);
    }
    keyValueTable(doc, yRef, resolutionEntries);
  }

  // —— Status line ——
  checkNewPage(doc, yRef, 15);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `Status: ${resolvedAt ? 'Resolved' : 'Open'}${resolvedAt ? ` · ${formatDate(resolvedAt)}` : ''}`,
    MARGIN,
    yRef.current
  );
  yRef.current += 8;

  // —— Footer on each page ——
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Generated ${formatDateTime(new Date())} · Page ${p} of ${totalPages}`,
      MARGIN,
      PAGE_HEIGHT - 10
    );
  }

  return doc;
}
