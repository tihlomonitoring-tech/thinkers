import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { calculateSaOvertimeClaim } from './saOvertimeClaim.js';
import { downloadWorkbook, formatGeneratedAt, todayStamp } from './officeAdminExportTemplate.js';

const BRAND = {
  name: 'Thinkers',
  module: 'Management · Claims & reimbursements',
  primary: 'FF1E40AF',
  primaryDark: 'FF1E3A8A',
  headerText: 'FFFFFFFF',
  slate: 'FF0F172A',
  muted: 'FF64748B',
  border: 'FFE2E8F0',
  stripe: 'FFF8FAFC',
};

const SLATE = [15, 23, 42];
const MUTED = [100, 116, 139];
const BORDER = [226, 232, 240];
const STRIPE = [248, 250, 252];

const HEADER_STYLE = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.primary } },
  font: { bold: true, color: { argb: BRAND.headerText }, size: 11, name: 'Calibri' },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { argb: BRAND.primaryDark } },
    left: { style: 'thin', color: { argb: BRAND.primaryDark } },
    bottom: { style: 'thin', color: { argb: BRAND.primaryDark } },
    right: { style: 'thin', color: { argb: BRAND.primaryDark } },
  },
};

const CLAIM_TYPES_MAP = {
  fuel: 'Fuel',
  travel: 'Travel expense',
  accommodation: 'Accommodation',
  meals: 'Meals',
  equipment: 'Equipment',
  tools: 'Tools',
  training: 'Training',
  communication: 'Communication',
  service: 'Service rendered',
  overtime: 'Overtime',
  other: 'Other',
};

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const EXCEL_COLUMNS = [
  { header: 'Reference', key: 'reference_number', width: 14 },
  { header: 'Claimant', key: 'claimant_name', width: 22 },
  { header: 'Email', key: 'claimant_email', width: 26 },
  { header: 'Claim date', key: 'claim_date', width: 12 },
  { header: 'Type', key: 'claim_type_label', width: 16 },
  { header: 'Category', key: 'category', width: 14 },
  { header: 'Department', key: 'department_name', width: 18 },
  { header: 'Description', key: 'description', width: 36 },
  { header: 'Amount (ZAR)', key: 'amount', width: 14 },
  { header: 'Status', key: 'status_label', width: 12 },
  { header: 'KM travelled', key: 'km_travelled', width: 10 },
  { header: 'Route', key: 'route', width: 22 },
  { header: 'Vehicle', key: 'vehicle_registration', width: 12 },
  { header: 'Hours', key: 'hours_spent', width: 8 },
  { header: 'Service', key: 'service_rendered', width: 18 },
  { header: 'Bank', key: 'bank_name', width: 16 },
  { header: 'Account holder', key: 'account_holder', width: 20 },
  { header: 'Account number', key: 'account_number', width: 18 },
  { header: 'Branch code', key: 'branch_code', width: 12 },
  { header: 'Account type', key: 'account_type', width: 12 },
  { header: 'Reviewed by', key: 'reviewed_by_name', width: 18 },
  { header: 'Reviewed at', key: 'reviewed_at', width: 18 },
  { header: 'Review notes', key: 'review_notes', width: 24 },
  { header: 'Rejection reason', key: 'rejection_reason', width: 24 },
  { header: 'Submitted', key: 'created_at', width: 18 },
];

function formatBankingLine(c) {
  const parts = [
    c.bank_name,
    c.account_holder,
    c.account_number,
    c.branch_code ? `Branch ${c.branch_code}` : '',
    c.account_type,
  ].map((p) => str(p)).filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

const PDF_COLUMNS = [
  { header: 'Reference', width: 22, get: (r) => r.reference_number },
  { header: 'Claimant', width: 28, get: (r) => r.claimant_name },
  { header: 'Date', width: 16, get: (r) => sliceDate(r.claim_date) },
  { header: 'Type', width: 22, get: (r) => r.claim_type_label },
  { header: 'Amount', width: 20, get: (r) => fmtZar(r.amount) },
  { header: 'Status', width: 16, get: (r) => r.status_label },
  { header: 'Banking', width: 48, get: (r) => formatBankingLine(r) },
  { header: 'Description', width: 36, get: (r) => r.description },
  { header: 'Reviewed by', width: 24, get: (r) => r.reviewed_by_name },
];

function str(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s || '';
}

function sliceDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  return s.length === 10 ? s : '';
}

function fmtZar(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 'R 0.00';
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function claimRoute(c) {
  if (!c?.start_location && !c?.end_location) return '';
  return [c.start_location, c.end_location].filter(Boolean).join(' → ');
}

function safeFilenameRef(ref) {
  return String(ref || 'claim').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'claim';
}

function normalizeClaim(c) {
  return {
    ...c,
    claim_type_label: CLAIM_TYPES_MAP[c.claim_type] || c.claim_type || '',
    status_label: STATUS_LABELS[c.status] || c.status || '',
    route: claimRoute(c),
    reviewed_at: fmtDateTime(c.reviewed_at),
    created_at: fmtDateTime(c.created_at),
  };
}

const BANKING_FIELD_LABELS = new Set([
  'Bank',
  'Account holder',
  'Account number',
  'Branch code',
  'Account type',
]);

/** Always include all banking fields (— when not captured on the claim). */
function bankingDetailPairs(c) {
  const dash = (v) => str(v) || '—';
  return [
    ['Bank', dash(c.bank_name)],
    ['Account holder', dash(c.account_holder)],
    ['Account number', dash(c.account_number)],
    ['Branch code', dash(c.branch_code)],
    ['Account type', dash(c.account_type)],
  ];
}

function overtimeDetailLines(claim) {
  if (claim?.claim_type !== 'overtime') return [];
  const calc = calculateSaOvertimeClaim({
    ordinaryHourlyRate: claim.hourly_rate,
    weekdayHours: claim.ot_weekday_hours,
    sundayHours: claim.ot_sunday_hours,
    publicHolidayHours: claim.ot_public_holiday_hours,
  });
  const lines = [];
  if (claim.hourly_rate != null) lines.push(['Ordinary hourly rate', fmtZar(claim.hourly_rate)]);
  if (claim.ot_period_end) lines.push(['Overtime period end', sliceDate(claim.ot_period_end)]);
  for (const l of calc.lines) {
    lines.push([l.label, `${l.hours}h × ${fmtZar(l.rate)} × ${l.multiplier} = ${fmtZar(l.subtotal)}`]);
  }
  if (calc.total > 0) lines.push(['Calculated overtime total', fmtZar(calc.total)]);
  return lines;
}

/** Label/value pairs for a single claim (PDF + Excel detail sheet). */
export function buildClaimDetailPairs(claim, attachments = []) {
  const c = normalizeClaim(claim);
  const pairs = [
    ['Reference', c.reference_number],
    ['Status', c.status_label],
    ['Claimant', c.claimant_name],
    ['Email', c.claimant_email],
    ['Claim date', sliceDate(c.claim_date)],
    ['Type', c.claim_type_label],
    ['Category', c.category],
    ['Department', c.department_name],
    ['Amount', fmtZar(c.amount)],
    ['Currency', c.currency || 'ZAR'],
    ['Description', c.description],
  ];

  if (c.km_travelled != null && c.km_travelled !== '') {
    pairs.push(['KM travelled', `${c.km_travelled} km`]);
  }
  if (c.route) pairs.push(['Route', c.route]);
  if (c.vehicle_registration) pairs.push(['Vehicle registration', c.vehicle_registration]);
  if (c.rate_per_km != null) pairs.push(['Rate per km', fmtZar(c.rate_per_km)]);
  if (c.service_rendered) pairs.push(['Service rendered', c.service_rendered]);
  if (c.hours_spent != null) pairs.push(['Hours spent', `${c.hours_spent} h`]);
  if (c.hourly_rate != null && c.claim_type !== 'overtime') {
    pairs.push(['Hourly rate', fmtZar(c.hourly_rate)]);
  }

  pairs.push(...overtimeDetailLines(c));

  const banking = bankingDetailPairs(c);
  const tail = [];
  if (c.reviewed_by_name) tail.push(['Reviewed by', c.reviewed_by_name]);
  if (c.reviewed_at) tail.push(['Reviewed at', c.reviewed_at]);
  if (c.review_notes) tail.push(['Review notes', c.review_notes]);
  if (c.rejection_reason) tail.push(['Rejection reason', c.rejection_reason]);
  tail.push(['Submitted', c.created_at]);
  if (attachments?.length) {
    tail.push(['Attachments', attachments.map((a) => a.file_name || 'file').join(', ')]);
  }

  return [
    ...pairs.filter(([label, v]) => !BANKING_FIELD_LABELS.has(label) && str(v) !== ''),
    ...banking,
    ...tail.filter(([label, v]) => !BANKING_FIELD_LABELS.has(label) && str(v) !== ''),
  ];
}

/** Split pairs for single-claim PDF sections. */
export function buildClaimDetailSections(claim, attachments = []) {
  const all = buildClaimDetailPairs(claim, attachments);
  const banking = all.filter(([label]) => BANKING_FIELD_LABELS.has(label));
  const rest = all.filter(([label]) => !BANKING_FIELD_LABELS.has(label));
  return { claim: rest, banking };
}

export function buildClaimsExportSubtitle({ filterStatus, filterSearch, claims }) {
  const parts = [];
  if (filterStatus && filterStatus !== 'all') {
    parts.push(`Status filter: ${STATUS_LABELS[filterStatus] || filterStatus}`);
  }
  if (filterSearch?.trim()) parts.push(`Search: "${filterSearch.trim()}"`);
  const rows = claims || [];
  const totalAmt = rows.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  parts.push(`${rows.length} claim(s)`);
  parts.push(`Listed total ${fmtZar(totalAmt)}`);
  parts.push(`Generated ${formatGeneratedAt()}`);
  return parts.join(' · ');
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

function styleHeaderRow(ws, rowNum, colCount) {
  const row = ws.getRow(rowNum);
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_STYLE.fill;
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  }
}

function rowToExcelObject(c) {
  const n = normalizeClaim(c);
  return {
    reference_number: str(n.reference_number),
    claimant_name: str(n.claimant_name),
    claimant_email: str(n.claimant_email),
    claim_date: sliceDate(n.claim_date),
    claim_type_label: str(n.claim_type_label),
    category: str(n.category),
    department_name: str(n.department_name),
    description: str(n.description),
    amount: Number(n.amount) || 0,
    status_label: str(n.status_label),
    km_travelled: n.km_travelled != null ? Number(n.km_travelled) : '',
    route: str(n.route),
    vehicle_registration: str(n.vehicle_registration),
    hours_spent: n.hours_spent != null ? Number(n.hours_spent) : '',
    service_rendered: str(n.service_rendered),
    bank_name: str(n.bank_name),
    account_holder: str(n.account_holder),
    account_number: str(n.account_number),
    branch_code: str(n.branch_code),
    account_type: str(n.account_type),
    reviewed_by_name: str(n.reviewed_by_name),
    reviewed_at: str(n.reviewed_at),
    review_notes: str(n.review_notes),
    rejection_reason: str(n.rejection_reason),
    created_at: str(n.created_at),
  };
}

async function writeBulkClaimsSheet(ws, claims, { filterStatus, filterSearch, title }) {
  const rows = (claims || []).map(rowToExcelObject);
  const colCount = EXCEL_COLUMNS.length;
  const lastCol = colLetter(colCount);
  const subtitle = buildClaimsExportSubtitle({ filterStatus, filterSearch, claims });

  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = title || 'Claims & reimbursements register';
  ws.getCell('A1').font = { bold: true, size: 16, name: 'Calibri', color: { argb: BRAND.slate } };

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = subtitle;
  ws.getCell('A2').font = { size: 10, name: 'Calibri', color: { argb: BRAND.muted } };
  ws.getRow(3).height = 6;

  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  EXCEL_COLUMNS.forEach((col, i) => {
    headerRow.getCell(i + 1).value = col.header;
  });
  styleHeaderRow(ws, headerRowNum, colCount);

  const amountColIdx = EXCEL_COLUMNS.findIndex((c) => c.key === 'amount') + 1;
  const dataStart = headerRowNum + 1;

  rows.forEach((row, idx) => {
    const r = ws.getRow(dataStart + idx);
    EXCEL_COLUMNS.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      cell.value = row[col.key] ?? '';
      cell.alignment = { vertical: 'top', wrapText: col.key === 'description' || col.key === 'route' };
      cell.border = {
        top: { style: 'thin', color: { argb: BRAND.border } },
        left: { style: 'thin', color: { argb: BRAND.border } },
        bottom: { style: 'thin', color: { argb: BRAND.border } },
        right: { style: 'thin', color: { argb: BRAND.border } },
      };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
      }
      if (i + 1 === amountColIdx && typeof cell.value === 'number') {
        cell.numFmt = '"R "#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'top' };
      }
    });
  });

  EXCEL_COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  if (rows.length) {
    ws.autoFilter = {
      from: { row: headerRowNum, column: 1 },
      to: { row: headerRowNum, column: colCount },
    };
  }

  const totalRow = dataStart + rows.length + 1;
  const totalAmt = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  ws.mergeCells(`A${totalRow}:${colLetter(Math.max(1, amountColIdx - 1))}${totalRow}`);
  ws.getCell(`A${totalRow}`).value = 'Total (listed claims)';
  ws.getCell(`A${totalRow}`).font = { bold: true, name: 'Calibri', color: { argb: BRAND.slate } };
  const totalCell = ws.getCell(totalRow, amountColIdx);
  totalCell.value = totalAmt;
  totalCell.numFmt = '"R "#,##0.00';
  totalCell.font = { bold: true, name: 'Calibri' };
  totalCell.alignment = { horizontal: 'right' };

  const footerRow = totalRow + 2;
  ws.mergeCells(`A${footerRow}:${lastCol}${footerRow}`);
  ws.getCell(`A${footerRow}`).value = `Confidential — ${BRAND.name} ${BRAND.module} · ${formatGeneratedAt()}`;
  ws.getCell(`A${footerRow}`).font = { size: 9, italic: true, color: { argb: BRAND.muted }, name: 'Calibri' };
}

function writeDetailPairsToSheet(ws, startRow, pairs, { sectionTitle } = {}) {
  let rowNum = startRow;
  if (sectionTitle) {
    ws.mergeCells(`A${rowNum}:B${rowNum}`);
    const cell = ws.getCell(`A${rowNum}`);
    cell.value = sectionTitle;
    cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.slate } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    rowNum += 1;
  }
  pairs.forEach(([label, value], idx) => {
    const r = ws.getRow(rowNum + idx);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    r.getCell(1).font = { bold: true, name: 'Calibri', color: { argb: BRAND.slate } };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    if (idx % 2 === 1) {
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
      r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
    }
  });
  return rowNum + pairs.length;
}

function writeClaimDetailSheet(ws, claim, attachments = []) {
  const ref = safeFilenameRef(claim.reference_number);
  const { claim: claimPairs, banking } = buildClaimDetailSections(claim, attachments);
  const lastCol = 'B';

  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = `Reimbursement claim — ${claim.reference_number || ref}`;
  ws.getCell('A1').font = { bold: true, size: 16, name: 'Calibri', color: { argb: BRAND.slate } };

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = `${BRAND.name} · ${BRAND.module} · Generated ${formatGeneratedAt()}`;
  ws.getCell('A2').font = { size: 10, name: 'Calibri', color: { argb: BRAND.muted } };
  ws.getRow(3).height = 6;

  const headerRowNum = 4;
  ws.getRow(headerRowNum).getCell(1).value = 'Field';
  ws.getRow(headerRowNum).getCell(2).value = 'Value';
  styleHeaderRow(ws, headerRowNum, 2);
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 52;

  let nextRow = headerRowNum + 1;
  nextRow = writeDetailPairsToSheet(ws, nextRow, claimPairs);
  nextRow += 1;
  nextRow = writeDetailPairsToSheet(ws, nextRow, banking, { sectionTitle: 'Banking details (for reimbursement)' });
}

export async function downloadClaimsExcel(claims, { filterStatus, filterSearch } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} · ${BRAND.module}`;
  wb.created = new Date();
  const ws = wb.addWorksheet('Claims', {
    views: [{ state: 'frozen', ySplit: 4, activeCell: 'A5' }],
    properties: { defaultRowHeight: 18 },
  });
  await writeBulkClaimsSheet(ws, claims, { filterStatus, filterSearch });
  const statusPart = filterStatus && filterStatus !== 'all' ? filterStatus : 'all';
  await downloadWorkbook(wb, `claims-reimbursements-${statusPart}-${todayStamp()}.xlsx`);
}

export async function downloadSingleClaimExcel(claim, attachments = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} · ${BRAND.module}`;
  const ref = safeFilenameRef(claim.reference_number);
  const ws = wb.addWorksheet(ref.slice(0, 31) || 'Claim', { properties: { defaultRowHeight: 20 } });
  writeClaimDetailSheet(ws, claim, attachments);
  if (attachments?.length) {
    const attWs = wb.addWorksheet('Attachments');
    attWs.getRow(1).values = ['File name', 'Uploaded'];
    styleHeaderRow(attWs, 1, 2);
    attachments.forEach((a, i) => {
      const r = attWs.getRow(i + 2);
      r.getCell(1).value = a.file_name || '';
      r.getCell(2).value = fmtDateTime(a.created_at);
    });
    attWs.getColumn(1).width = 40;
    attWs.getColumn(2).width = 22;
  }
  await downloadWorkbook(wb, `claim-${ref}-${todayStamp()}.xlsx`);
}

function drawPdfPageHeader(doc, pageW, margin, title, subtitle, continued = false) {
  const headerBandH = 22;
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, headerBandH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(continued ? 11 : 14);
  doc.text(continued ? `${title} (continued)` : title, margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const brand = `${BRAND.name} · ${BRAND.module}`;
  doc.text(brand, pageW - margin - doc.getTextWidth(brand), 10);
  const contentW = pageW - 2 * margin;
  const subLines = doc.splitTextToSize(subtitle, contentW);
  doc.text(subLines, margin, 17);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  return headerBandH + 6 + (subLines.length > 1 ? (subLines.length - 1) * 3 : 0);
}

function buildCompactClaimBlocks(claim, attachments = []) {
  const c = normalizeClaim(claim);
  const claimInfo = [
    ['Claimant', c.claimant_name],
    ['Email', c.claimant_email],
    ['Claim date', sliceDate(c.claim_date)],
    ['Type', c.claim_type_label],
    ['Category', c.category],
    ['Department', c.department_name],
    ['Currency', c.currency || 'ZAR'],
  ].filter(([, v]) => str(v));

  const extras = [];
  if (c.km_travelled != null && c.km_travelled !== '') extras.push(['KM travelled', `${c.km_travelled} km`]);
  if (c.route) extras.push(['Route', c.route]);
  if (c.vehicle_registration) extras.push(['Vehicle', c.vehicle_registration]);
  if (c.rate_per_km != null) extras.push(['Rate per km', fmtZar(c.rate_per_km)]);
  if (c.service_rendered) extras.push(['Service', c.service_rendered]);
  if (c.hours_spent != null) extras.push(['Hours', `${c.hours_spent} h`]);
  if (c.hourly_rate != null && c.claim_type !== 'overtime') extras.push(['Hourly rate', fmtZar(c.hourly_rate)]);
  extras.push(...overtimeDetailLines(c));

  const review = [];
  if (c.reviewed_by_name) review.push(['Reviewed by', c.reviewed_by_name]);
  if (c.reviewed_at) review.push(['Reviewed at', c.reviewed_at]);
  if (c.review_notes) review.push(['Review notes', c.review_notes]);
  if (c.rejection_reason) review.push(['Rejection reason', c.rejection_reason]);
  review.push(['Submitted', c.created_at || '—']);

  const attachmentLine =
    attachments?.length > 0
      ? attachments.map((a) => a.file_name || 'file').join(', ')
      : '';

  return {
    c,
    claimInfo,
    banking: bankingDetailPairs(c),
    extras: extras.filter(([, v]) => str(v)),
    description: str(c.description),
    review: review.filter(([, v]) => str(v)),
    attachmentLine,
  };
}

/** Compact label/value lines (multi-line values wrap). Returns bottom Y. */
function drawCompactFields(doc, x, y, width, pairs, { lineGap = 4.2, fontSize = 8.5 } = {}) {
  let cy = y;
  for (const [lab, val] of pairs) {
    const v = str(val) || '—';
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    const prefix = `${lab}: `;
    const prefixW = doc.getTextWidth(prefix);
    doc.text(prefix, x, cy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    const valLines = doc.splitTextToSize(v, Math.max(width - prefixW, 20));
    doc.text(valLines, x + prefixW, cy);
    cy += Math.max(lineGap, valLines.length * lineGap) + 1.5;
  }
  return cy;
}

function drawCompactSectionBar(doc, x, y, w, title) {
  const h = 9;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text(title, x + 3, y + 6.2);
  return y + h + 3;
}

function drawCompactClaimHeader(doc, margin, pageW, c) {
  const bandH = 30;
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, bandH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const ref = c.reference_number || 'Claim';
  doc.text(ref, margin, 12);
  const amt = fmtZar(c.amount);
  doc.setFontSize(13);
  doc.text(amt, pageW - margin - doc.getTextWidth(amt), 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const meta = [c.claimant_name, c.status_label, sliceDate(c.claim_date)].filter((p) => str(p)).join('  ·  ');
  doc.text(meta, margin, 20);
  doc.setFontSize(7);
  const stamp = `${BRAND.name} · ${BRAND.module} · ${formatGeneratedAt()}`;
  doc.text(stamp, margin, 26);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  return bandH + 6;
}

function drawCompactSingleClaimBody(doc, margin, pageW, pageH, blocks) {
  const contentW = pageW - 2 * margin;
  const gap = 6;
  const colW = (contentW - gap) / 2;
  const leftX = margin;
  const rightX = margin + colW + gap;

  let y = drawCompactClaimHeader(doc, margin, pageW, blocks.c);

  let yLeft = drawCompactSectionBar(doc, leftX, y, colW, 'Claim information');
  yLeft = drawCompactFields(doc, leftX + 2, yLeft, colW - 4, blocks.claimInfo);

  let yRight = drawCompactSectionBar(doc, rightX, y, colW, 'Banking (reimbursement)');
  yRight = drawCompactFields(doc, rightX + 2, yRight, colW - 4, blocks.banking, { lineGap: 5 });

  y = Math.max(yLeft, yRight) + 4;

  if (blocks.description) {
    y = drawCompactSectionBar(doc, margin, y, contentW, 'Description');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    const descLines = doc.splitTextToSize(blocks.description, contentW - 8);
    const boxH = descLines.length * 4 + 6;
    if (y + boxH > pageH - 16) {
      doc.addPage();
      y = margin + 4;
    }
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, contentW, boxH);
    doc.text(descLines, margin + 4, y + 5);
    y += boxH + 4;
  }

  if (blocks.extras.length) {
    y = drawCompactSectionBar(doc, margin, y, contentW, 'Additional details');
    y = drawCompactFields(doc, margin + 2, y, contentW - 4, blocks.extras, { lineGap: 4 }) + 2;
  }

  if (blocks.review.length || blocks.attachmentLine) {
    if (y + 20 > pageH - 16) {
      doc.addPage();
      y = margin + 4;
    }
    y = drawCompactSectionBar(doc, margin, y, contentW, 'Review & attachments');
    const reviewPairs = [...blocks.review];
    if (blocks.attachmentLine) reviewPairs.push(['Attachments', blocks.attachmentLine]);
    drawCompactFields(doc, margin + 2, y, contentW - 4, reviewPairs, { lineGap: 4, fontSize: 8 });
  }
}

export function downloadSingleClaimPdf(claim, attachments = []) {
  const ref = safeFilenameRef(claim.reference_number);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margin = 14;
  const pageW = 210;
  const pageH = 297;
  const blocks = buildCompactClaimBlocks(claim, attachments);

  drawCompactSingleClaimBody(doc, margin, pageW, pageH, blocks);

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(
      `Page ${p} of ${totalPages} · Confidential · ${BRAND.name}`,
      margin,
      pageH - 8
    );
  }

  doc.save(`claim-${ref}-${todayStamp()}.pdf`);
}

export function downloadClaimsPdf(claims, { filterStatus, filterSearch } = {}) {
  const rows = (claims || []).map(normalizeClaim);
  const subtitle = buildClaimsExportSubtitle({ filterStatus, filterSearch, claims });
  const title = 'Claims & reimbursements register';
  const filename = `claims-reimbursements-${filterStatus && filterStatus !== 'all' ? filterStatus : 'all'}-${todayStamp()}.pdf`;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const margin = 12;
  const pageW = 297;
  const pageH = 210;
  const contentW = pageW - 2 * margin;
  const rowH = 7;
  const tableHeaderH = 8;

  const drawTableHeader = (y) => {
    doc.setFillColor(30, 64, 175);
    doc.rect(margin, y, contentW, tableHeaderH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    let x = margin + 2;
    const totalColW = PDF_COLUMNS.reduce((s, c) => s + c.width, 0);
    const scale = contentW / totalColW;
    const colWidths = PDF_COLUMNS.map((c) => c.width * scale);
    PDF_COLUMNS.forEach((col, i) => {
      const lines = doc.splitTextToSize(col.header, colWidths[i] - 4);
      doc.text(lines[0] || col.header, x, y + 5.5);
      x += colWidths[i];
    });
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    return { y: y + tableHeaderH, colWidths, scale, totalColW };
  };

  let y = drawPdfPageHeader(doc, pageW, margin, title, subtitle);
  let tableHdr = drawTableHeader(y);
  y = tableHdr.y;
  let colWidths = tableHdr.colWidths;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);

  rows.forEach((row, rowIdx) => {
    if (y + rowH > pageH - 14) {
      doc.setFontSize(7);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageW / 2 - 8, pageH - 8);
      doc.addPage();
      y = drawPdfPageHeader(doc, pageW, margin, title, subtitle, true);
      tableHdr = drawTableHeader(y);
      y = tableHdr.y;
      colWidths = tableHdr.colWidths;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    }

    if (rowIdx % 2 === 1) {
      doc.setFillColor(STRIPE[0], STRIPE[1], STRIPE[2]);
      doc.rect(margin, y, contentW, rowH, 'F');
    }
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.1);
    doc.line(margin, y + rowH, margin + contentW, y + rowH);

    let x = margin + 2;
    PDF_COLUMNS.forEach((col, i) => {
      doc.text(String(col.get(row) ?? '—').slice(0, 120), x, y + 4.8);
      x += colWidths[i];
    });
    y += rowH;
  });

  const totalAmt = rows.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  if (y + 10 > pageH - 14) {
    doc.addPage();
    y = drawPdfPageHeader(doc, pageW, margin, title, subtitle, true) + 4;
  }
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`Total (${rows.length} claim(s)): ${fmtZar(totalAmt)}`, margin, y);

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(
      `Page ${p} of ${totalPages} · Confidential · ${BRAND.name} ${BRAND.module}`,
      margin,
      pageH - 8
    );
  }

  doc.save(filename);
}
