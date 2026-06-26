import { jsPDF } from 'jspdf';
import { loadExcelJS } from './lazyExceljs.js';
import { formatTruckRegistration } from './truckKey.js';

/* ----------------------------- shared helpers ----------------------------- */

const RED = 'FFB91C1C';
const RED_TINT = 'FFFEE2E2';
const SLATE = 'FF334155';
const INK = 'FF0F172A';
const ZEBRA = 'FFF8FAFC';
const GRID = 'FFE2E8F0';
const GREEN = 'FF15803D';

// PDF RGB equivalents
const C_RED = [185, 28, 28];
const C_SLATE = [51, 65, 85];
const C_INK = [15, 23, 42];
const C_ZEBRA = [248, 250, 252];
const C_GRID = [226, 232, 240];
const C_GREEN = [21, 128, 61];
const C_MUTED = [100, 116, 139];

function reg(v) {
  return formatTruckRegistration(v) || (v ? String(v) : '—');
}
function txt(v) {
  return v != null && String(v).trim() !== '' ? String(v) : '—';
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* --------------------------------- PDF ------------------------------------ */

function drawPageHeader(doc, pageW, margin, title, subtitle, tenantName) {
  doc.setFillColor(...C_RED);
  doc.rect(0, 0, pageW, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title, margin, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const right = `Thinkers · ${tenantName || ''}`.trim();
  doc.text(right, pageW - margin - doc.getTextWidth(right), 11);
  let y = 24;
  doc.setTextColor(...C_MUTED);
  doc.setFontSize(8.5);
  const meta = `Generated ${new Date().toLocaleString()}${subtitle ? `  ·  ${subtitle}` : ''}`;
  doc.text(doc.splitTextToSize(meta, pageW - margin * 2), margin, y);
  return y + 6;
}

function drawSectionTitle(doc, margin, y, title) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...C_INK);
  doc.text(title, margin, y);
  return y + 3;
}

/** Advanced table renderer: header band, wrapped cells, zebra rows, borders, page breaks. */
function drawTable(doc, { startY, margin, pageW, pageH, columns, rows, statusKey }) {
  const contentW = pageW - margin * 2;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = totalW > contentW ? contentW / totalW : 1;
  const cols = columns.map((c) => ({ ...c, w: c.width * scale }));
  const pad = 1.8;
  const lineH = 3.9;
  const fontSize = 8;
  const headerH = 8;

  const drawHeaderRow = (y) => {
    let x = margin;
    doc.setFillColor(...C_SLATE);
    doc.rect(margin, y, cols.reduce((s, c) => s + c.w, 0), headerH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    cols.forEach((c) => {
      const align = c.align || 'left';
      const tx = align === 'right' ? x + c.w - pad : align === 'center' ? x + c.w / 2 : x + pad;
      doc.text(c.header, tx, y + headerH - 2.6, { align });
      x += c.w;
    });
    return y + headerH;
  };

  let y = startY;
  y = drawHeaderRow(y);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C_INK);

  if (rows.length === 0) {
    doc.setTextColor(...C_MUTED);
    doc.text('No records.', margin + pad, y + 5);
    return y + 8;
  }

  rows.forEach((row, idx) => {
    // Pre-compute wrapped lines + row height
    const cellLines = cols.map((c) => {
      const raw = c.value(row);
      return doc.splitTextToSize(raw == null ? '—' : String(raw), c.w - pad * 2);
    });
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = maxLines * lineH + pad * 2;

    if (y + rowH > pageH - 12) {
      doc.addPage();
      y = 16;
      y = drawHeaderRow(y);
      doc.setFont('helvetica', 'normal');
    }

    if (idx % 2 === 1) {
      doc.setFillColor(...C_ZEBRA);
      doc.rect(margin, y, cols.reduce((s, c) => s + c.w, 0), rowH, 'F');
    }

    let x = margin;
    cols.forEach((c, ci) => {
      const align = c.align || 'left';
      const tx = align === 'right' ? x + c.w - pad : align === 'center' ? x + c.w / 2 : x + pad;
      const isStatus = statusKey && c.key === statusKey;
      if (isStatus) {
        const val = String(c.value(row) || '').toLowerCase();
        doc.setTextColor(...(val.includes('suspend') ? C_RED : C_GREEN));
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setTextColor(...C_INK);
        doc.setFont('helvetica', 'normal');
      }
      doc.text(cellLines[ci], tx, y + pad + lineH - 0.8, { align });
      x += c.w;
    });

    // bottom border
    doc.setDrawColor(...C_GRID);
    doc.setLineWidth(0.1);
    doc.line(margin, y + rowH, margin + cols.reduce((s, c) => s + c.w, 0), y + rowH);
    y += rowH;
  });
  return y + 4;
}

export function exportFleetPdf({ trucks = [], drivers = [], tenantName = '', subtitle = '', scope = 'both' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const includeTrucks = scope === 'both' || scope === 'trucks';
  const includeDrivers = scope === 'both' || scope === 'drivers';
  const docTitle = includeTrucks && includeDrivers ? 'Approved Fleet & Drivers' : includeTrucks ? 'Approved Trucks' : 'Approved Drivers';

  let first = true;
  const startSection = () => {
    if (!first) doc.addPage();
    first = false;
    return drawPageHeader(doc, pageW, margin, docTitle, subtitle, tenantName);
  };

  if (includeTrucks) {
    let y = startSection();
    y = drawSectionTitle(doc, margin, y, `Trucks (${trucks.length})`);
    drawTable(doc, {
      startY: y, margin, pageW, pageH, statusKey: 'status',
      columns: [
        { key: 'registration', header: 'Registration', width: 34, value: (t) => reg(t.registration) },
        { key: 'fleet_no', header: 'Fleet no', width: 26, value: (t) => txt(t.fleet_no) },
        { key: 'trailer_1_reg_no', header: 'Trailer 1', width: 32, value: (t) => reg(t.trailer_1_reg_no) },
        { key: 'trailer_2_reg_no', header: 'Trailer 2', width: 32, value: (t) => reg(t.trailer_2_reg_no) },
        { key: 'main_contractor', header: 'Main contractor', width: 52, value: (t) => txt(t.main_contractor) },
        { key: 'status', header: 'Status', width: 26, align: 'center', value: (t) => (t.status === 'suspended' ? 'Suspended' : 'Active') },
      ],
      rows: trucks,
    });
  }

  if (includeDrivers) {
    let y = startSection();
    y = drawSectionTitle(doc, margin, y, `Drivers (${drivers.length})`);
    drawTable(doc, {
      startY: y, margin, pageW, pageH, statusKey: 'status',
      columns: [
        { key: 'full_name', header: 'Name', width: 50, value: (d) => txt(d.full_name) },
        { key: 'license_number', header: 'Licence', width: 36, value: (d) => txt(d.license_number) },
        { key: 'phone', header: 'Phone', width: 32, value: (d) => txt(d.phone) },
        { key: 'id_number', header: 'ID number', width: 40, value: (d) => txt(d.id_number) },
        { key: 'main_contractor', header: 'Main contractor', width: 58, value: (d) => txt(d.main_contractor) },
        { key: 'status', header: 'Status', width: 26, align: 'center', value: (d) => (d.status === 'suspended' ? 'Suspended' : 'Active') },
      ],
      rows: drivers,
    });
  }

  // Footer page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...C_MUTED);
    doc.text(`Page ${i} of ${pages}`, pageW - margin - 18, pageH - 6);
  }

  doc.save(`approved-fleet-drivers-${stamp()}.pdf`);
}

/* -------------------------------- Excel ----------------------------------- */

function writeHeaderBand(ws, { title, subtitle, lastCol }) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
  ws.getRow(1).height = 34;
  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell('A2');
  s.value = subtitle;
  s.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: INK } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_TINT } };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;
  return 4;
}

function styleHeaderRow(ws, rowIndex, labels) {
  const row = ws.getRow(rowIndex);
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: INK } } };
  });
  row.height = 22;
  ws.autoFilter = { from: { row: rowIndex, column: 1 }, to: { row: rowIndex, column: labels.length } };
}

function styleBodyRow(ws, rowIndex, values, { zebra, statusCol }) {
  const row = ws.getRow(rowIndex);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    cell.value = v == null || v === '' ? '—' : v;
    cell.font = { name: 'Calibri', size: 10.5, color: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
    cell.border = { bottom: { style: 'hair', color: { argb: GRID } } };
    if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    if (statusCol != null && i === statusCol) {
      const suspended = String(v).toLowerCase().includes('suspend');
      cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: suspended ? RED : GREEN } };
    }
  });
}

export async function exportFleetExcel({ trucks = [], drivers = [], tenantName = '', subtitle = '', scope = 'both' }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thinkers';
  wb.created = new Date();
  const sub = `${tenantName ? tenantName + '  ·  ' : ''}Generated ${new Date().toLocaleString()}${subtitle ? '  ·  ' + subtitle : ''}`;
  const includeTrucks = scope === 'both' || scope === 'trucks';
  const includeDrivers = scope === 'both' || scope === 'drivers';

  if (includeTrucks) {
    const wt = wb.addWorksheet('Trucks', {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const tCols = ['Registration', 'Fleet no', 'Trailer 1', 'Trailer 2', 'Main contractor', 'Sub-contractor', 'Status'];
    wt.columns = [{ width: 18 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 26 }, { width: 24 }, { width: 12 }];
    let r = writeHeaderBand(wt, { title: 'Approved Trucks', subtitle: sub, lastCol: 'G' });
    styleHeaderRow(wt, r, tCols);
    trucks.forEach((t, i) => {
      r += 1;
      styleBodyRow(wt, r, [
        reg(t.registration), t.fleet_no, reg(t.trailer_1_reg_no), reg(t.trailer_2_reg_no),
        t.main_contractor, t.sub_contractor,
        t.status === 'suspended' ? 'Suspended' : 'Active',
      ], { zebra: i % 2 === 1, statusCol: 6 });
    });
  }

  if (includeDrivers) {
    const wd = wb.addWorksheet('Drivers', {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const dCols = ['Name', 'Licence', 'Phone', 'ID number', 'Main contractor', 'Sub-contractor', 'Status'];
    wd.columns = [{ width: 26 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 26 }, { width: 24 }, { width: 12 }];
    let r2 = writeHeaderBand(wd, { title: 'Approved Drivers', subtitle: sub, lastCol: 'G' });
    styleHeaderRow(wd, r2, dCols);
    drivers.forEach((d, i) => {
      r2 += 1;
      styleBodyRow(wd, r2, [
        d.full_name, d.license_number, d.phone, d.id_number, d.main_contractor, d.sub_contractor,
        d.status === 'suspended' ? 'Suspended' : 'Active',
      ], { zebra: i % 2 === 1, statusCol: 6 });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `approved-fleet-drivers-${stamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
