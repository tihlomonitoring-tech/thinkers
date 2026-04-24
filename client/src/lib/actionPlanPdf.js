import { jsPDF } from 'jspdf';

const MARGIN = 18;
const FOOTER_MARGIN = 20;
const FONT = 'helvetica';
const FONT_SIZE_BODY = 9;
const FONT_SIZE_TABLE = 8;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SUBTITLE = 11;

const BLACK = [0, 0, 0];
const TABLE_BORDER = [60, 60, 60];
const TEXT_DARK = [33, 33, 33];
const TEXT_MUTED = [80, 80, 80];

const BAR_HEIGHT = 6;
const ROW_HEIGHT_MIN = 6;
const CELL_PAD = 1.5;
const LINE_HEIGHT = 4.2;
const SECTION_GAP = 6;

function contentWidth(doc) {
  return doc.internal.pageSize.getWidth() - MARGIN * 2;
}

function pageHeight(doc) {
  return doc.internal.pageSize.getHeight();
}

function checkNewPage(doc, yRef, needSpace = 35) {
  const ph = pageHeight(doc);
  const minY = ph - FOOTER_MARGIN - (needSpace || 25);
  if (yRef.current > minY) {
    doc.addPage();
    yRef.current = MARGIN;
  }
}

function wrap(doc, text, maxW) {
  if (!text) return [];
  const w = Math.max(4, (maxW || contentWidth(doc)) - 1);
  return doc.splitTextToSize(String(text).trim(), w);
}

function setTableFont(doc, bold = false) {
  doc.setFont(FONT, bold ? 'bold' : 'normal');
  doc.setFontSize(FONT_SIZE_TABLE);
  doc.setTextColor(...(bold ? BLACK : TEXT_DARK));
}

function sectionBar(doc, yRef, title) {
  const cw = contentWidth(doc);
  checkNewPage(doc, yRef, BAR_HEIGHT + 14);
  const y = yRef.current;
  doc.setFillColor(...BLACK);
  doc.rect(MARGIN, y, cw, BAR_HEIGHT, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), MARGIN + 2, y + 4.2);
  yRef.current = y + BAR_HEIGHT + 4;
}

/** Last column absorbs rounding so widths sum to totalW */
function cols(totalW, ...widths) {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (widths.length === 0) return [totalW];
  const diff = totalW - sum;
  return widths.map((w, i) => (i === widths.length - 1 ? w + diff : w));
}

function drawTable(doc, yRef, headers, rows, colWidths) {
  const tableWidth = contentWidth(doc);
  const startX = MARGIN;
  let y = yRef.current;

  setTableFont(doc, true);
  const headerCellLines = headers.map((h, i) =>
    wrap(doc, h != null ? String(h) : '', Math.max(6, colWidths[i] - CELL_PAD * 2))
  );
  const headerMaxLines = Math.max(1, ...headerCellLines.map((arr) => arr.length));
  const headerH = Math.max(ROW_HEIGHT_MIN, headerMaxLines * LINE_HEIGHT + CELL_PAD * 2);

  checkNewPage(doc, yRef, headerH + 18);
  y = yRef.current;

  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.4);
  doc.rect(startX, y, tableWidth, headerH, 'S');
  let x = startX;
  headers.forEach((_, i) => {
    if (i > 0) doc.line(x, y, x, y + headerH);
    const lines = headerCellLines[i];
    lines.forEach((line, li) => {
      doc.text(line, x + CELL_PAD, y + CELL_PAD + (li + 1) * LINE_HEIGHT);
    });
    x += colWidths[i];
  });
  doc.line(startX + tableWidth, y, startX + tableWidth, y + headerH);
  y += headerH;

  setTableFont(doc, false);

  rows.forEach((row) => {
    const cellLines = row.map((cell, colIdx) => {
      const cellW = Math.max(6, colWidths[colIdx] - CELL_PAD * 2);
      return wrap(doc, cell != null ? String(cell) : '—', cellW);
    });
    const maxLines = Math.max(1, ...cellLines.map((arr) => arr.length));
    const rowH = Math.max(ROW_HEIGHT_MIN, maxLines * LINE_HEIGHT + CELL_PAD * 2);
    yRef.current = y;
    checkNewPage(doc, yRef, rowH + 5);
    y = yRef.current;
    doc.rect(startX, y, tableWidth, rowH, 'S');
    x = startX;
    row.forEach((_, colIdx) => {
      if (colIdx > 0) doc.line(x, y, x, y + rowH);
      const lines = cellLines[colIdx] || [];
      lines.forEach((line, i) => doc.text(line, x + CELL_PAD, y + CELL_PAD + (i + 1) * LINE_HEIGHT));
      x += colWidths[colIdx];
    });
    doc.line(startX + tableWidth, y, startX + tableWidth, y + rowH);
    y += rowH;
  });

  yRef.current = y + SECTION_GAP;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * Generate action plan / project timelines PDF.
 * Logo at top, "Thinkers Afrika Progress Report Document" under logo, then title, project name, date, document ID, confidentiality, action plan table.
 * @param {Object} plan - Action plan from API { title, project_name, document_date, document_id, items: [{ phase, start_date, action_description, participants, due_date, status }] }
 * @param {Object} options - Optional: { logoDataUrl }
 */
export function generateActionPlanPdf(plan, options = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const yRef = { current: MARGIN };
  const cw = contentWidth(doc);
  const logoDataUrl = options.logoDataUrl;
  const logoFormat = logoDataUrl && /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG';

  const logoSize = 26;
  let headerY = 8;
  if (logoDataUrl) {
    try {
      const logoX = MARGIN + cw / 2 - logoSize / 2;
      doc.addImage(logoDataUrl, logoFormat, logoX, 6, logoSize, logoSize, undefined, 'FAST');
      headerY = 6 + logoSize + 5;
    } catch (_) {}
  }

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  const docTypeText = 'Thinkers Afrika Progress Report Document';
  doc.text(docTypeText, MARGIN + cw / 2 - doc.getTextWidth(docTypeText) / 2, headerY);
  headerY += 7;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(FONT_SIZE_TITLE);
  doc.setTextColor(...BLACK);
  const titleText = plan.title || 'Action Plan';
  const titleLines = wrap(doc, titleText, cw);
  titleLines.forEach((line, i) => {
    doc.text(line, MARGIN + cw / 2 - doc.getTextWidth(line) / 2, headerY + i * 5);
  });
  let y = headerY + titleLines.length * 5 + 3;

  if (plan.project_name) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_SUBTITLE);
    doc.setTextColor(...TEXT_DARK);
    const projLines = wrap(doc, String(plan.project_name), cw);
    projLines.forEach((line, i) => {
      doc.text(line, MARGIN + cw / 2 - doc.getTextWidth(line) / 2, y + i * 5);
    });
    y += projLines.length * 5 + 2;
  }

  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_MUTED);
  const dateStr = formatDate(plan.document_date);
  doc.text(dateStr, MARGIN + cw / 2 - doc.getTextWidth(dateStr) / 2, y);
  y += 4;
  if (plan.document_id) {
    const did = `Document ID: ${plan.document_id}`;
    doc.text(did, MARGIN + cw / 2 - doc.getTextWidth(did) / 2, y);
    y += 5;
  }
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + cw, y);
  yRef.current = y + 8;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const confidential =
    'This document is the exclusive property of Thinkers Afrika (Pty) Ltd. and contains confidential information. It may not be reproduced, shared, or disclosed without express written consent.';
  const confLines = wrap(doc, confidential, cw);
  confLines.forEach((line) => {
    doc.text(line, MARGIN, yRef.current);
    yRef.current += 4;
  });
  yRef.current += 6;

  const items = Array.isArray(plan.items) ? plan.items : [];
  if (items.length > 0) {
    sectionBar(doc, yRef, 'Action plan structure');
    const headers = ['Phase', 'Start date', 'Action type/description', 'Participants', 'Due date', 'Action status'];
    const rows = items.map((it) => [
      (it.phase ?? '—').toString(),
      it.start_date ? formatDate(it.start_date) : '—',
      (it.action_description ?? '—').toString().trim(),
      (it.participants ?? '—').toString().trim(),
      it.due_date ? formatDate(it.due_date) : '—',
      (it.status ?? 'not started').toString(),
    ]);
    const tw = contentWidth(doc);
    const cwCols = cols(
      tw,
      16,
      26,
      92,
      48,
      26,
      28
    );
    drawTable(doc, yRef, headers, rows, cwCols);
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    const ph = pageHeight(doc);
    const footerW = contentWidth(doc);
    doc.text(
      `Action Plan · ${formatDate(plan.document_date)} · Page ${p} of ${pageCount}`,
      MARGIN,
      ph - 8
    );
    const footerRight = 'Thinkers Afrika';
    doc.text(footerRight, MARGIN + footerW - doc.getTextWidth(footerRight), ph - 8);
  }

  return doc;
}
