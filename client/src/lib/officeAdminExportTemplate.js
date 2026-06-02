import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';

/** Office Admin export branding */
export const OA_BRAND = {
  name: 'Thinkers',
  module: 'Office Administration',
  primary: 'FF1E40AF',
  primaryDark: 'FF1E3A8A',
  headerText: 'FFFFFFFF',
  slate: 'FF0F172A',
  muted: 'FF64748B',
  border: 'FFE2E8F0',
  stripe: 'FFF8FAFC',
};

const EXCEL_HEADER_STYLE = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: OA_BRAND.primary } },
  font: { bold: true, color: { argb: OA_BRAND.headerText }, size: 11, name: 'Calibri' },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { argb: OA_BRAND.primaryDark } },
    left: { style: 'thin', color: { argb: OA_BRAND.primaryDark } },
    bottom: { style: 'thin', color: { argb: OA_BRAND.primaryDark } },
    right: { style: 'thin', color: { argb: OA_BRAND.primaryDark } },
  },
};

const EXCEL_TITLE_STYLE = {
  font: { bold: true, size: 16, name: 'Calibri', color: { argb: OA_BRAND.slate } },
};
const EXCEL_SUBTITLE_STYLE = {
  font: { size: 10, name: 'Calibri', color: { argb: OA_BRAND.muted } },
};

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function formatGeneratedAt() {
  return new Date().toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sliceDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  return s.length === 10 ? s : '';
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {object} opts
 * @param {string} opts.sheetName
 * @param {string} opts.reportTitle
 * @param {string} [opts.reportSubtitle]
 * @param {{ header: string, key?: string, width?: number }[]} opts.columns
 * @param {object[]} opts.rows - row objects keyed by column key, or use values array via mapRow
 * @param {(row: object) => unknown[]} [opts.mapRow]
 * @param {string} opts.filename
 */
export async function exportOfficeAdminExcel({
  sheetName,
  reportTitle,
  reportSubtitle,
  columns,
  rows,
  mapRow,
  filename,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${OA_BRAND.name} · ${OA_BRAND.module}`;
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5' }],
    properties: { defaultRowHeight: 18 },
  });

  const colCount = columns.length;
  const lastCol = colLetter(colCount);

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = reportTitle;
  titleCell.font = EXCEL_TITLE_STYLE.font;
  titleCell.alignment = { vertical: 'middle' };

  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value =
    reportSubtitle ||
    `${OA_BRAND.module} · Generated ${formatGeneratedAt()} · ${(rows || []).length} record(s)`;
  subCell.font = EXCEL_SUBTITLE_STYLE.font;

  ws.getRow(3).height = 6;

  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
  });
  styleExcelHeaderRow(ws, headerRowNum, colCount);

  const dataStart = headerRowNum + 1;
  (rows || []).forEach((row, idx) => {
    const values = mapRow ? mapRow(row) : columns.map((c) => (c.key ? row[c.key] : ''));
    const r = ws.getRow(dataStart + idx);
    values.forEach((val, i) => {
      const cell = r.getCell(i + 1);
      cell.value = val ?? '';
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: OA_BRAND.border } },
        left: { style: 'thin', color: { argb: OA_BRAND.border } },
        bottom: { style: 'thin', color: { argb: OA_BRAND.border } },
        right: { style: 'thin', color: { argb: OA_BRAND.border } },
      };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OA_BRAND.stripe } };
      }
    });
  });

  columns.forEach((col, i) => {
    const headerLen = String(col.header || '').length;
    ws.getColumn(i + 1).width = Math.min(Math.max(col.width || headerLen + 4, 10), 48);
  });

  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: colCount },
  };

  const footerRow = dataStart + (rows || []).length + 1;
  ws.mergeCells(`A${footerRow}:${lastCol}${footerRow}`);
  const foot = ws.getCell(`A${footerRow}`);
  foot.value = `Confidential — ${OA_BRAND.name} ${OA_BRAND.module} · ${formatGeneratedAt()}`;
  foot.font = { size: 9, italic: true, color: { argb: OA_BRAND.muted }, name: 'Calibri' };

  await downloadWorkbook(wb, filename);
}

function colLetter(n) {
  let s = '';
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function styleExcelHeaderRow(ws, rowNum, colCount) {
  const row = ws.getRow(rowNum);
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = EXCEL_HEADER_STYLE.fill;
    cell.font = EXCEL_HEADER_STYLE.font;
    cell.alignment = EXCEL_HEADER_STYLE.alignment;
    cell.border = EXCEL_HEADER_STYLE.border;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {{ header: string, width: number, get: (row: object) => string }[]} opts.columns
 * @param {object[]} opts.rows
 * @param {string} opts.filename
 * @param {'portrait'|'landscape'} [opts.orientation]
 */
export function exportOfficeAdminPdf({ title, subtitle, columns, rows, filename, orientation = 'portrait' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation });
  const margin = 12;
  const pageW = orientation === 'landscape' ? 297 : 210;
  const pageH = orientation === 'landscape' ? 210 : 297;
  const contentW = pageW - 2 * margin;
  const rowH = 7;
  const headerBandH = 22;
  const tableHeaderH = 8;

  const drawPageHeader = (yStart, continued = false) => {
    let y = yStart;
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageW, headerBandH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(continued ? 11 : 14);
    doc.text(continued ? `${title} (continued)` : title, margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const brand = `${OA_BRAND.name} · ${OA_BRAND.module}`;
    doc.text(brand, pageW - margin - doc.getTextWidth(brand), 10);
    doc.setFontSize(7);
    doc.text(
      subtitle || `Generated ${formatGeneratedAt()} · ${(rows || []).length} record(s)`,
      margin,
      17
    );
    y = headerBandH + 6;
    doc.setTextColor(15, 23, 42);
    return y;
  };

  const totalColW = columns.reduce((s, c) => s + c.width, 0);
  const scale = contentW / totalColW;
  const colWidths = columns.map((c) => c.width * scale);

  const drawTableHeader = (y) => {
    doc.setFillColor(30, 64, 175);
    doc.rect(margin, y, contentW, tableHeaderH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    let x = margin + 2;
    columns.forEach((col, i) => {
      const lines = doc.splitTextToSize(col.header, colWidths[i] - 4);
      doc.text(lines[0] || col.header, x, y + 5.5);
      x += colWidths[i];
    });
    doc.setTextColor(15, 23, 42);
    return y + tableHeaderH;
  };

  let y = drawPageHeader(0);
  y = drawTableHeader(y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);

  (rows || []).forEach((row, rowIdx) => {
    if (y + rowH > pageH - 14) {
      const pageNum = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Page ${pageNum}`, pageW / 2 - 8, pageH - 8);
      doc.addPage();
      y = drawPageHeader(0, true);
      y = drawTableHeader(y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(15, 23, 42);
    }

    if (rowIdx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentW, rowH, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.1);
    doc.line(margin, y + rowH, margin + contentW, y + rowH);

    let x = margin + 2;
    columns.forEach((col, i) => {
      const raw = col.get(row);
      const text = String(raw ?? '—').slice(0, 80);
      doc.text(text, x, y + 4.8);
      x += colWidths[i];
    });
    y += rowH;
  });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Page ${p} of ${totalPages} · Confidential · ${OA_BRAND.name} ${OA_BRAND.module}`,
      margin,
      pageH - 8
    );
  }

  doc.save(filename);
}

/** Template download: instructions + styled headers + example row */
export async function exportOfficeAdminTemplate({
  sheetName,
  reportTitle,
  headers,
  exampleRows,
  filename,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${OA_BRAND.name} · ${OA_BRAND.module}`;
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 5 }],
    properties: { defaultRowHeight: 18 },
  });
  const colCount = headers.length;
  const lastCol = colLetter(colCount);

  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = reportTitle;
  ws.getCell('A1').font = EXCEL_TITLE_STYLE.font;

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = `Import template · ${OA_BRAND.module} · Do not rename header row`;
  ws.getCell('A2').font = EXCEL_SUBTITLE_STYLE.font;

  ws.getRow(3).height = 6;

  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleExcelHeaderRow(ws, headerRowNum, colCount);

  (exampleRows || []).forEach((vals, i) => {
    const r = ws.getRow(headerRowNum + 1 + i);
    vals.forEach((v, j) => {
      r.getCell(j + 1).value = v;
    });
  });

  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(String(h).length + 4, 12), 36);
  });

  await downloadWorkbook(wb, filename);
}
