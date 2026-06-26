import { loadExcelJS } from './lazyExceljs.js';

const RED = 'FFB91C1C';
const RED_TINT = 'FFFEE2E2';
const SLATE = 'FF334155';
const INK = 'FF0F172A';
const ZEBRA = 'FFF8FAFC';
const GRID = 'FFE2E8F0';

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function prettyDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

function sectorLabel(s) {
  if (s === 'public') return 'Public sector';
  if (s === 'private') return 'Private sector';
  if (s === 'both') return 'Public & private';
  return '';
}

function triggerDownload(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Shared title + meta band. Returns the row index of the header row to write next. */
function writeHeaderBand(ws, { title, subtitle, lastCol, columnCount }) {
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
  ws.getRow(1).height = 34;

  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value = subtitle;
  subCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED_TINT } };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 6;
  return 4;
}

function styleHeaderRow(ws, rowIndex, labels) {
  const headerRow = ws.getRow(rowIndex);
  labels.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: INK } } };
  });
  headerRow.height = 22;
  ws.autoFilter = { from: { row: rowIndex, column: 1 }, to: { row: rowIndex, column: labels.length } };
}

/** Professional leave application history export (management). */
export async function exportLeaveHistoryExcel(applications = []) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thinkers';
  wb.created = new Date();
  const ws = wb.addWorksheet('Leave history', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { key: 'employee', width: 26 },
    { key: 'leave_type', width: 22 },
    { key: 'start', width: 14 },
    { key: 'end', width: 14 },
    { key: 'days', width: 8 },
    { key: 'status', width: 14 },
    { key: 'applied', width: 16 },
    { key: 'reviewed', width: 16 },
    { key: 'notes', width: 32 },
  ];
  const labels = ['Employee', 'Leave type', 'Start date', 'End date', 'Days', 'Status', 'Applied', 'Reviewed', 'Review notes'];
  writeHeaderBand(ws, { title: 'Leave Application History', subtitle: `Generated ${prettyDate(new Date())}    ·    ${applications.length} record(s)`, lastCol: 'I' });
  styleHeaderRow(ws, 5, labels);

  const thin = { style: 'thin', color: { argb: GRID } };
  applications.forEach((a, idx) => {
    const row = ws.addRow({
      employee: a.user_name || a.user_email || '—',
      leave_type: a.leave_type,
      start: prettyDate(a.start_date),
      end: prettyDate(a.end_date),
      days: a.days_requested ?? '',
      status: a.status ? String(a.status).charAt(0).toUpperCase() + String(a.status).slice(1) : '',
      applied: prettyDate(a.created_at),
      reviewed: a.reviewed_at ? prettyDate(a.reviewed_at) : '—',
      notes: a.review_notes || '',
    });
    row.height = 18;
    row.eachCell((cell, col) => {
      cell.border = { bottom: thin };
      cell.alignment = { vertical: 'middle', horizontal: col === 1 || col === 9 ? 'left' : 'center', wrapText: col === 9 };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
    const statusCell = row.getCell(6);
    const st = String(a.status || '').toLowerCase();
    statusCell.font = { bold: true, color: { argb: st === 'approved' ? 'FF15803D' : st === 'rejected' ? RED : 'FFB45309' } };
  });

  if (applications.length === 0) {
    const row = ws.addRow({ employee: 'No leave applications' });
    ws.mergeCells(`A${row.number}:I${row.number}`);
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(buf, `leave-history-${ymd()}.xlsx`);
}

/** Professional team leave balances export (management). */
export async function exportTeamBalancesExcel(rows = [], { year } = {}) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thinkers';
  wb.created = new Date();
  const ws = wb.addWorksheet('Team leave balances', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { key: 'employee', width: 26 },
    { key: 'email', width: 28 },
    { key: 'leave_type', width: 22 },
    { key: 'allocated', width: 14 },
    { key: 'used', width: 12 },
    { key: 'remaining', width: 14 },
    { key: 'typical', width: 16 },
    { key: 'sector', width: 18 },
  ];
  const labels = ['Employee', 'Email', 'Leave type', 'Allocated', 'Used', 'Remaining', 'Typical / yr', 'Sector'];
  writeHeaderBand(ws, { title: 'Team Leave Balances', subtitle: `Leave year ${year ?? new Date().getFullYear()}    ·    Generated ${prettyDate(new Date())}`, lastCol: 'H' });
  styleHeaderRow(ws, 5, labels);

  const thin = { style: 'thin', color: { argb: GRID } };
  let totAllocated = 0;
  let totUsed = 0;
  // Keep rows grouped by employee for readability.
  const sorted = [...rows].sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));
  sorted.forEach((b, idx) => {
    const allocated = b.total_days ?? 0;
    const used = b.used_days ?? 0;
    const remaining = allocated - used;
    totAllocated += allocated;
    totUsed += used;
    const row = ws.addRow({
      employee: b.full_name || b.email || b.user_id,
      email: b.email || '',
      leave_type: b.leave_type,
      allocated,
      used,
      remaining,
      typical: b.type_default_days_per_year != null ? b.type_default_days_per_year : '—',
      sector: sectorLabel(b.type_sector) || '—',
    });
    row.height = 18;
    row.eachCell((cell, col) => {
      cell.border = { bottom: thin };
      cell.alignment = { vertical: 'middle', horizontal: col === 1 || col === 2 ? 'left' : 'center' };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
    const remCell = row.getCell(6);
    remCell.font = { bold: true, color: { argb: remaining <= 0 ? RED : 'FF15803D' } };
  });

  if (sorted.length === 0) {
    const row = ws.addRow({ employee: 'No balances for this year' });
    ws.mergeCells(`A${row.number}:H${row.number}`);
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
  } else {
    const totalRow = ws.addRow({
      employee: 'TOTAL',
      email: '',
      leave_type: '',
      allocated: totAllocated,
      used: totUsed,
      remaining: totAllocated - totUsed,
      typical: '',
      sector: '',
    });
    totalRow.height = 22;
    totalRow.eachCell((cell, col) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(buf, `team-leave-balances-${year ?? new Date().getFullYear()}-${ymd()}.xlsx`);
}
