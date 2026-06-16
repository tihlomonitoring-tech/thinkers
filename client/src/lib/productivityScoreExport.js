import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import {
  SCORE_CATEGORIES,
  CAT_LABELS,
  CAT_LABELS_SHORT,
  describeScoreEvent,
} from './productivityScoreDisplay.jsx';
import { downloadWorkbook, formatGeneratedAt, todayStamp } from './officeAdminExportTemplate.js';

const BRAND = {
  name: 'Thinkers',
  module: 'Management · Employee productivity score',
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
const BRAND_RGB = [30, 64, 175];

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

const SUMMARY_COLUMNS = [
  { header: 'Employee', key: 'full_name', width: 24 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Total score', key: 'total', width: 12 },
  ...SCORE_CATEGORIES.map((id) => ({
    header: CAT_LABELS_SHORT[id],
    key: id,
    width: 14,
  })),
  { header: 'Events', key: 'event_count', width: 10 },
];

const EVENT_COLUMNS = [
  { header: 'Employee', key: 'employee', width: 22 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Points', key: 'points', width: 10 },
  { header: 'Detail', key: 'detail', width: 16 },
  { header: 'Event description', key: 'description', width: 48 },
];

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

function str(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s || '';
}

function safeSheetName(name, used = new Set()) {
  let base = String(name || 'Employee')
    .replace(/[\\/?*[\]:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || 'Employee';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, Math.max(1, 28 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function safeFilenamePart(name) {
  return String(name || 'employee')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'employee';
}

export function buildPeriodLabel(data) {
  if (!data) return '';
  const from = data.fromYmd || '';
  const to = data.toYmd || '';
  const days = data.windowDays ?? '';
  return `${from} → ${to} · ${days} day window · ${data.ccUserCount ?? 0} CC team`;
}

export function buildExportSubtitle(data) {
  const parts = [buildPeriodLabel(data)];
  if (data?.groupAverage != null) parts.push(`Team avg ${data.groupAverage}`);
  if (data?.median != null) parts.push(`Median ${data.median}`);
  parts.push(`Generated ${formatGeneratedAt()}`);
  return parts.join(' · ');
}

function buildScoringRulesPairs(scoring) {
  const sc = scoring || {};
  return [
    ['Punctuality — on time', `${sc.punctuality?.onTime ?? 15} points`],
    ['Punctuality — late (after grace)', `${sc.punctuality?.late ?? -15} points (${sc.punctuality?.graceMinutes ?? 5} min grace)`],
    ['Evaluation — strong (≥ threshold)', `${sc.evaluation?.good ?? 20} points (${sc.evaluation?.minYesOf || '9/11'} Yes)`],
    ['Evaluation — below threshold', `${sc.evaluation?.bad ?? -20} points`],
    ['Tasks — on/before due', `${sc.tasks?.onTime ?? 30} points`],
    ['Tasks — late or still overdue', `${sc.tasks?.lateOrOverdue ?? -30} points`],
    ['Report hand-in — on time', `${sc.reportHandIn?.onTime ?? 50} points by ${sc.reportHandIn?.by || 'shift end + 15 min'}`],
    ['Report hand-in — late', `${sc.reportHandIn?.late ?? -50} points`],
    ['Team progress — objective achieved', `+${sc.teamProgress?.objectiveAchieved ?? 15} points each`],
    ['Team progress — management rating', `(rating − ${sc.teamProgress?.ratingNeutral ?? 3}) × ${sc.teamProgress?.ratingMultiplier ?? 5}`],
    ['Daily pulse — on time', `+${sc.dailyPulse?.onTime ?? 10} within ${sc.dailyPulse?.withinHoursAfterShiftEnd ?? 12}h after shift end`],
    ['Daily pulse — missed', `${sc.dailyPulse?.missed ?? -30} points`],
  ];
}

function eventCountForPerson(person) {
  return SCORE_CATEGORIES.reduce((n, id) => n + (person.breakdown?.[id]?.events?.length || 0), 0);
}

function summaryRowFromPerson(person) {
  const row = {
    full_name: str(person.full_name),
    email: str(person.email),
    total: Number(person.total) || 0,
    event_count: eventCountForPerson(person),
  };
  for (const id of SCORE_CATEGORIES) {
    row[id] = person.breakdown?.[id]?.points ?? 0;
  }
  return row;
}

export function collectAllEvents(people) {
  const rows = [];
  for (const person of people || []) {
    for (const catId of SCORE_CATEGORIES) {
      const events = person.breakdown?.[catId]?.events || [];
      for (const ev of events) {
        rows.push({
          employee: str(person.full_name),
          email: str(person.email),
          category: CAT_LABELS[catId],
          points: ev.points ?? 0,
          detail: str(ev.detail),
          description: describeScoreEvent(ev, catId),
        });
      }
    }
  }
  return rows;
}

function buildBaseFilename(data, { selectedPerson } = {}) {
  const from = data?.fromYmd || todayStamp();
  const to = data?.toYmd || todayStamp();
  const suffix = selectedPerson ? `-${safeFilenamePart(selectedPerson.full_name)}` : '';
  return `productivity-score-${from}-to-${to}${suffix}-${todayStamp()}`;
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

function writeSheetTitle(ws, lastCol, title, subtitle) {
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 16, name: 'Calibri', color: { argb: BRAND.slate } };
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = subtitle;
  ws.getCell('A2').font = { size: 10, name: 'Calibri', color: { argb: BRAND.muted } };
  ws.getRow(3).height = 6;
}

function writeDataTable(ws, startRow, columns, rows, { pointsKeys = [] } = {}) {
  const colCount = columns.length;
  const headerRowNum = startRow;
  const headerRow = ws.getRow(headerRowNum);
  columns.forEach((col, i) => {
    headerRow.getCell(i + 1).value = col.header;
  });
  styleHeaderRow(ws, headerRowNum, colCount);

  const dataStart = headerRowNum + 1;
  rows.forEach((row, idx) => {
    const r = ws.getRow(dataStart + idx);
    columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      cell.value = row[col.key] ?? '';
      cell.alignment = {
        vertical: 'top',
        wrapText: col.key === 'description' || col.key === 'email',
        horizontal: pointsKeys.includes(col.key) ? 'right' : 'left',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: BRAND.border } },
        left: { style: 'thin', color: { argb: BRAND.border } },
        bottom: { style: 'thin', color: { argb: BRAND.border } },
        right: { style: 'thin', color: { argb: BRAND.border } },
      };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
      }
      if (pointsKeys.includes(col.key) && typeof cell.value === 'number') {
        cell.numFmt = '+0;-0;0';
      }
    });
  });

  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  if (rows.length) {
    ws.autoFilter = {
      from: { row: headerRowNum, column: 1 },
      to: { row: headerRowNum, column: colCount },
    };
  }

  return dataStart + rows.length;
}

function writeOverviewSheet(ws, data, people) {
  const lastCol = 'B';
  writeSheetTitle(ws, lastCol, 'Team overview', buildExportSubtitle(data));

  const stats = [
    ['Reporting period', `${data.fromYmd} → ${data.toYmd}`],
    ['Window', `${data.windowDays} days`],
    ['Command Centre team size', data.ccUserCount ?? people.length],
    ['Team average score', data.groupAverage ?? 0],
    ['Median score', data.median ?? 0],
    ['Score range', `${data.min ?? 0} to ${data.max ?? 0}`],
    ['Employees in report', people.length],
    ['Total scoring events', collectAllEvents(people).length],
  ];

  let rowNum = 5;
  stats.forEach(([label, value], idx) => {
    const r = ws.getRow(rowNum + idx);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    r.getCell(1).font = { bold: true, name: 'Calibri', color: { argb: BRAND.slate } };
    if (idx % 2 === 1) {
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
      r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.stripe } };
    }
  });

  rowNum += stats.length + 2;
  ws.mergeCells(`A${rowNum}:B${rowNum}`);
  ws.getCell(`A${rowNum}`).value = 'Average points per category';
  ws.getCell(`A${rowNum}`).font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.slate } };
  rowNum += 1;

  for (const id of SCORE_CATEGORIES) {
    const r = ws.getRow(rowNum);
    r.getCell(1).value = CAT_LABELS[id];
    r.getCell(2).value = data.componentAverages?.[id] ?? 0;
    rowNum += 1;
  }

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 28;
}

function writeRulesSheet(ws, data) {
  const pairs = buildScoringRulesPairs(data.scoring);
  const lastCol = 'B';
  writeSheetTitle(ws, lastCol, 'Scoring rules', buildExportSubtitle(data));

  let rowNum = 5;
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

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 40;
}

function writeEmployeeDetailSheet(ws, person, data) {
  const lastCol = 'D';
  writeSheetTitle(
    ws,
    lastCol,
    `${person.full_name || 'Employee'} — score breakdown`,
    buildExportSubtitle(data)
  );

  ws.mergeCells('A5:D5');
  ws.getCell('A5').value = str(person.email);
  ws.getCell('A5').font = { size: 10, name: 'Calibri', color: { argb: BRAND.muted } };

  const catRows = SCORE_CATEGORIES.map((id) => {
    const row = person.breakdown?.[id] || { points: 0, events: [] };
    const share = person.total !== 0 ? Math.round((row.points / person.total) * 1000) / 10 : 0;
    return {
      category: CAT_LABELS[id],
      points: row.points ?? 0,
      events: row.events?.length || 0,
      share: person.total !== 0 ? `${share}%` : '—',
    };
  });

  let nextRow = writeDataTable(
    ws,
    7,
    [
      { header: 'Category', key: 'category', width: 28 },
      { header: 'Points', key: 'points', width: 12 },
      { header: 'Events', key: 'events', width: 10 },
      { header: 'Share of total', key: 'share', width: 14 },
    ],
    catRows,
    { pointsKeys: ['points'] }
  );

  nextRow += 2;
  ws.mergeCells(`A${nextRow}:D${nextRow}`);
  ws.getCell(`A${nextRow}`).value = 'Contributing events';
  ws.getCell(`A${nextRow}`).font = { bold: true, size: 11, name: 'Calibri', color: { argb: BRAND.slate } };
  nextRow += 1;

  const events = collectAllEvents([person]);
  writeDataTable(
    ws,
    nextRow,
    [
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Points', key: 'points', width: 10 },
      { header: 'Detail', key: 'detail', width: 16 },
      { header: 'Event description', key: 'description', width: 48 },
    ],
    events,
    { pointsKeys: ['points'] }
  );

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 48;
}

/**
 * @param {object} data - shiftScore.tenant response
 * @param {{ selectedPerson?: object, includeAllEmployeeSheets?: boolean }} [options]
 */
export async function downloadProductivityScoreExcel(data, options = {}) {
  const people = data?.people || [];
  if (!people.length) throw new Error('No productivity score data to export');

  const { selectedPerson, includeAllEmployeeSheets = !selectedPerson } = options;
  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} · ${BRAND.module}`;
  wb.created = new Date();
  wb.modified = new Date();

  const overviewWs = wb.addWorksheet('Overview', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeOverviewSheet(overviewWs, data, people);

  const summaryWs = wb.addWorksheet('Roster summary', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
  });
  const summaryRows = people.map(summaryRowFromPerson);
  const summaryLastCol = colLetter(SUMMARY_COLUMNS.length);
  writeSheetTitle(summaryWs, summaryLastCol, 'Employee productivity — roster summary', buildExportSubtitle(data));
  const summaryEnd = writeDataTable(summaryWs, 4, SUMMARY_COLUMNS, summaryRows, {
    pointsKeys: ['total', ...SCORE_CATEGORIES],
  });
  summaryWs.mergeCells(`A${summaryEnd + 1}:${colLetter(Math.max(1, SUMMARY_COLUMNS.length - 1))}${summaryEnd + 1}`);
  summaryWs.getCell(`A${summaryEnd + 1}`).value = 'Confidential management report';
  summaryWs.getCell(`A${summaryEnd + 1}`).font = { italic: true, size: 9, color: { argb: BRAND.muted }, name: 'Calibri' };

  const eventsWs = wb.addWorksheet('Event detail', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
  });
  const eventRows = selectedPerson ? collectAllEvents([selectedPerson]) : collectAllEvents(people);
  const eventsLastCol = colLetter(EVENT_COLUMNS.length);
  const eventsTitle = selectedPerson
    ? `Event detail — ${selectedPerson.full_name}`
    : 'Event detail — all employees';
  writeSheetTitle(eventsWs, eventsLastCol, eventsTitle, buildExportSubtitle(data));
  writeDataTable(eventsWs, 4, EVENT_COLUMNS, eventRows, { pointsKeys: ['points'] });

  const rulesWs = wb.addWorksheet('Scoring rules', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRulesSheet(rulesWs, data);

  const detailPeople = selectedPerson
    ? [selectedPerson]
    : includeAllEmployeeSheets
      ? people.slice(0, 15)
      : [];

  const usedSheetNames = new Set(['overview', 'roster summary', 'event detail', 'scoring rules']);

  for (const person of detailPeople) {
    const sheetName = safeSheetName(person.full_name, usedSheetNames);
    writeEmployeeDetailSheet(
      wb.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 4 }],
      }),
      person,
      data
    );
  }

  const filename = `${buildBaseFilename(data, { selectedPerson })}.xlsx`;
  await downloadWorkbook(wb, filename);
}

function drawPdfPageHeader(doc, pageW, margin, title, subtitle, continued = false) {
  const headerBandH = 22;
  doc.setFillColor(...BRAND_RGB);
  doc.rect(0, 0, pageW, headerBandH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(continued ? 11 : 14);
  doc.text(continued ? `${title} (continued)` : title, margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const brand = `${BRAND.name} · Management`;
  doc.text(brand, pageW - margin - doc.getTextWidth(brand), 10);
  const contentW = pageW - 2 * margin;
  const subLines = doc.splitTextToSize(subtitle, contentW);
  doc.text(subLines, margin, 17);
  doc.setTextColor(...SLATE);
  return headerBandH +  (subLines.length > 1 ? 6 + (subLines.length - 1) * 3 : 6);
}

function drawSummaryStats(doc, margin, pageW, y, data, people) {
  const contentW = pageW - 2 * margin;
  const boxW = contentW / 4 - 3;
  const boxH = 16;
  const stats = [
    ['Team average', String(data.groupAverage ?? 0)],
    ['Median', String(data.median ?? 0)],
    ['Range', `${data.min ?? 0} – ${data.max ?? 0}`],
    ['CC team', String(data.ccUserCount ?? people.length)],
  ];

  stats.forEach(([label, value], i) => {
    const x = margin + i * (boxW + 4);
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.rect(x, y, boxW, boxH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 3, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...SLATE);
    doc.text(value, x + 3, y + 13);
  });

  doc.setTextColor(...SLATE);
  return y + boxH + 8;
}

function drawPdfTable(doc, margin, pageW, pageH, y, columns, rows, { rowH = 6.5, fontSize = 6.5, continuedTitle, continuedSubtitle } = {}) {
  const contentW = pageW - 2 * margin;
  const tableHeaderH = 7;
  const totalColW = columns.reduce((s, c) => s + c.width, 0);
  const colWidths = columns.map((c) => (c.width / totalColW) * contentW);

  const drawHeader = (startY) => {
    doc.setFillColor(...BRAND_RGB);
    doc.rect(margin, startY, contentW, tableHeaderH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(255, 255, 255);
    let x = margin + 2;
    columns.forEach((col, i) => {
      doc.text(col.header, x, startY + 5);
      x += colWidths[i];
    });
    doc.setTextColor(...SLATE);
    return startY + tableHeaderH;
  };

  let cy = drawHeader(y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);

  rows.forEach((row, rowIdx) => {
    if (cy + rowH > pageH - 12) {
      doc.addPage();
      cy = drawPdfPageHeader(
        doc,
        pageW,
        margin,
        continuedTitle || 'Employee productivity score',
        continuedSubtitle || '',
        true
      );
      cy = drawHeader(cy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize);
    }

    if (rowIdx % 2 === 1) {
      doc.setFillColor(...STRIPE);
      doc.rect(margin, cy, contentW, rowH, 'F');
    }
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.1);
    doc.line(margin, cy + rowH, margin + contentW, cy + rowH);

    let x = margin + 2;
    columns.forEach((col, i) => {
      const raw = typeof col.get === 'function' ? col.get(row) : row[col.key];
      const text = String(raw ?? '—').slice(0, col.maxLen || 80);
      doc.text(text, x, cy + 4.5);
      x += colWidths[i];
    });
    cy += rowH;
  });

  return cy + 4;
}

function drawEmployeeDetailSection(doc, margin, pageW, pageH, y, person, data) {
  const contentW = pageW - 2 * margin;
  const sectionH = 8;

  if (y + 30 > pageH - 12) {
    doc.addPage();
    y = drawPdfPageHeader(doc, pageW, margin, 'Employee productivity score', buildExportSubtitle(data), true);
  }

  doc.setFillColor(...SLATE);
  doc.rect(margin, y, contentW, sectionH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  const title = `${person.full_name || 'Employee'} · Total ${person.total ?? 0} pts`;
  doc.text(title, margin + 3, y + 5.5);
  if (person.email) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(person.email, pageW - margin - 3 - doc.getTextWidth(person.email), y + 5.5);
  }
  y += sectionH + 3;
  doc.setTextColor(...SLATE);

  const catRows = SCORE_CATEGORIES.map((id) => {
    const row = person.breakdown?.[id] || { points: 0, events: [] };
    return {
      category: CAT_LABELS_SHORT[id],
      points: row.points ?? 0,
      events: row.events?.length || 0,
    };
  });

  y = drawPdfTable(
    doc,
    margin,
    pageW,
    pageH,
    y,
    [
      { header: 'Category', width: 40, get: (r) => r.category },
      { header: 'Points', width: 15, get: (r) => (r.points > 0 ? `+${r.points}` : String(r.points)) },
      { header: 'Events', width: 12, get: (r) => String(r.events) },
    ],
    catRows,
    {
      rowH: 6,
      fontSize: 7,
      continuedTitle: 'Employee productivity score',
      continuedSubtitle: buildExportSubtitle(data),
    }
  );

  const events = collectAllEvents([person]);
  if (!events.length) return y + 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Contributing events', margin, y);
  y += 5;

  return drawPdfTable(
    doc,
    margin,
    pageW,
    pageH,
    y,
    [
      { header: 'Category', width: 22, get: (r) => r.category, maxLen: 28 },
      { header: 'Pts', width: 8, get: (r) => (r.points > 0 ? `+${r.points}` : String(r.points)) },
      { header: 'Description', width: 70, get: (r) => r.description, maxLen: 120 },
    ],
    events,
    {
      rowH: 7,
      fontSize: 6.5,
      continuedTitle: 'Employee productivity score',
      continuedSubtitle: buildExportSubtitle(data),
    }
  ) + 6;
}

function drawScoringRulesSection(doc, margin, pageW, pageH, y, data) {
  const contentW = pageW - 2 * margin;
  if (y + 40 > pageH - 12) {
    doc.addPage();
    y = drawPdfPageHeader(doc, pageW, margin, 'Employee productivity score', buildExportSubtitle(data), true);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Scoring rules (this period)', margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);

  for (const [label, value] of buildScoringRulesPairs(data.scoring)) {
    if (y + 5 > pageH - 12) {
      doc.addPage();
      y = drawPdfPageHeader(doc, pageW, margin, 'Employee productivity score', buildExportSubtitle(data), true);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
    }
    const line = `${label}: ${value}`;
    const lines = doc.splitTextToSize(line, contentW);
    doc.text(lines, margin + 2, y);
    y += lines.length * 3.5 + 1;
  }

  doc.setTextColor(...SLATE);
  return y + 4;
}

/**
 * @param {object} data - shiftScore.tenant response
 * @param {{ selectedPerson?: object }} [options]
 */
export function downloadProductivityScorePdf(data, options = {}) {
  const people = data?.people || [];
  if (!people.length) throw new Error('No productivity score data to export');

  const { selectedPerson } = options;
  const title = selectedPerson
    ? `Productivity score — ${selectedPerson.full_name}`
    : 'Employee productivity score report';
  const subtitle = buildExportSubtitle(data);
  const exportPeople = selectedPerson ? [selectedPerson] : people;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const margin = 12;
  const pageW = 297;
  const pageH = 210;

  let y = drawPdfPageHeader(doc, pageW, margin, title, subtitle);
  y = drawSummaryStats(doc, margin, pageW, y, data, people);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(selectedPerson ? 'Category summary' : 'Roster summary', margin, y);
  y += 5;

  if (selectedPerson) {
    y = drawEmployeeDetailSection(doc, margin, pageW, pageH, y, selectedPerson, data);
  } else {
    y = drawPdfTable(
      doc,
      margin,
      pageW,
      pageH,
      y,
      [
        { header: 'Employee', width: 28, get: (r) => r.full_name, maxLen: 32 },
        { header: 'Email', width: 32, get: (r) => r.email, maxLen: 36 },
        { header: 'Total', width: 10, get: (r) => String(r.total) },
        ...SCORE_CATEGORIES.map((id) => ({
          header: CAT_LABELS_SHORT[id],
          width: 12,
          get: (r) => {
            const pts = r.breakdown?.[id]?.points ?? 0;
            return pts > 0 ? `+${pts}` : String(pts);
          },
        })),
      ],
      people,
      {
        rowH: 6.5,
        fontSize: 6.5,
        continuedTitle: title,
        continuedSubtitle: subtitle,
      }
    );

    doc.addPage();
    y = drawPdfPageHeader(doc, pageW, margin, title, 'Detailed breakdown by employee', true);

    for (const person of exportPeople) {
      y = drawEmployeeDetailSection(doc, margin, pageW, pageH, y, person, data);
    }
  }

  y = drawScoringRulesSection(doc, margin, pageW, pageH, y, data);

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Page ${p} of ${totalPages} · Confidential · ${BRAND.name} · ${BRAND.module}`,
      margin,
      pageH - 6
    );
  }

  doc.save(`${buildBaseFilename(data, { selectedPerson })}.pdf`);
}
