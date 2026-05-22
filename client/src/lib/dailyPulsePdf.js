import { jsPDF } from 'jspdf';

const MARGIN = 16;
const FOOTER_Y = 282;
const FONT = 'helvetica';
const BRAND = [30, 58, 95];
const BRAND_LIGHT = [239, 246, 255];
const TEXT_DARK = [23, 23, 23];
const TEXT_MUTED = [82, 82, 82];
const BORDER = [203, 213, 225];
const WHITE = [255, 255, 255];
const CONCERN = [180, 83, 9];
const OK = [22, 101, 52];

function contentWidth(doc) {
  return doc.internal.pageSize.getWidth() - MARGIN * 2;
}

function pageHeight(doc) {
  return doc.internal.pageSize.getHeight();
}

function wrap(doc, text, maxW) {
  if (text == null || text === '') return [];
  return doc.splitTextToSize(String(text).trim(), Math.max(8, maxW - 1));
}

function qField(en, name) {
  if (!en || typeof en !== 'object') return undefined;
  const k = Object.keys(en).find((x) => x && String(x).toLowerCase() === String(name).toLowerCase());
  return k !== undefined ? en[k] : undefined;
}

export function parseIndividualChecks(raw) {
  const v = qField(raw, 'individual_checks_json') ?? qField(raw, 'individual_checks');
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function moraleLabel(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'good') return 'Good';
  if (s === 'strained') return 'Strained';
  if (s === 'mixed') return 'Mixed';
  return v || '—';
}

function onTrackLabel(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'yes') return 'Yes';
  if (s === 'no') return 'No';
  return v || '—';
}

export function questionnaireReportKey(q) {
  const id = qField(q, 'id');
  if (id != null && String(id).trim()) return String(id);
  const wd = qField(q, 'work_date');
  return wd ? `date-${String(wd).slice(0, 10)}` : `row-${Math.random()}`;
}

export function questionnaireToPayload(q, leader = {}) {
  return {
    leaderName: leader.full_name || leader.fullName || 'Team leader',
    leaderEmail: leader.email || '',
    workDate: qField(q, 'work_date'),
    submittedAt: qField(q, 'created_at'),
    teamMorale: moraleLabel(qField(q, 'team_morale')),
    deliveryOnTrack: onTrackLabel(qField(q, 'delivery_on_track')),
    topBlocker: qField(q, 'top_blocker') || '',
    wentWell: qField(q, 'team_went_well') || '',
    teamSummary: qField(q, 'team_summary') || '',
    touchpoints: parseIndividualChecks(q).map((row) => ({
      name: row.member_label || '—',
      status: row.status === 'concern' ? 'Concern' : 'On track',
      note: row.note ? String(row.note).trim() : '',
    })),
  };
}

function drawFooter(doc, page, total, subtitle) {
  const cw = contentWidth(doc);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(subtitle, MARGIN, FOOTER_Y);
  const right = `Page ${page} of ${total}`;
  doc.text(right, MARGIN + cw - doc.getTextWidth(right), FOOTER_Y);
  const brand = 'Thinkers Afrika · Daily Pulse';
  doc.text(brand, MARGIN + (cw - doc.getTextWidth(brand)) / 2, FOOTER_Y);
}

function ensureSpace(doc, yRef, need) {
  if (yRef.current + need > FOOTER_Y - 8) {
    doc.addPage();
    yRef.current = MARGIN + 4;
  }
}

function drawBrandHeader(doc, yRef, title, subtitle) {
  const cw = contentWidth(doc);
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, w, 28, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text('THINKERS AFRIKA', MARGIN, 11);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.text('Team leader · Daily pulse', MARGIN, 17);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(14);
  doc.text(title, MARGIN, 24);
  yRef.current = 36;
  if (subtitle) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    const lines = wrap(doc, subtitle, cw);
    lines.forEach((line, i) => {
      doc.text(line, MARGIN, yRef.current + i * 4.5);
    });
    yRef.current += lines.length * 4.5 + 4;
  }
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, yRef.current, MARGIN + cw, yRef.current);
  yRef.current += 8;
}

function drawMetaRow(doc, yRef, items) {
  const cw = contentWidth(doc);
  ensureSpace(doc, yRef, 22);
  const colW = cw / Math.max(1, items.length);
  let x = MARGIN;
  items.forEach(({ label, value }) => {
    doc.setFillColor(...BRAND_LIGHT);
    doc.roundedRect(x, yRef.current, colW - 3, 16, 2, 2, 'F');
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label.toUpperCase(), x + 3, yRef.current + 5);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    const vlines = wrap(doc, value, colW - 6);
    doc.text(vlines[0] || '—', x + 3, yRef.current + 11);
    x += colW;
  });
  yRef.current += 20;
}

function drawSection(doc, yRef, title, body) {
  const cw = contentWidth(doc);
  const lines = wrap(doc, body || '—', cw);
  const h = 10 + Math.max(1, lines.length) * 4.2 + 6;
  ensureSpace(doc, yRef, h);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text(title.toUpperCase(), MARGIN, yRef.current);
  yRef.current += 5;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  lines.forEach((line) => {
    ensureSpace(doc, yRef, 6);
    doc.text(line, MARGIN, yRef.current);
    yRef.current += 4.2;
  });
  yRef.current += 6;
}

function drawTouchpointsTable(doc, yRef, rows) {
  const cw = contentWidth(doc);
  const cols = [52, 28, cw - 80];
  const headers = ['Team member', 'Status', 'Notes'];
  ensureSpace(doc, yRef, 24);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text('INDIVIDUAL TOUCHPOINTS', MARGIN, yRef.current);
  yRef.current += 6;

  if (!rows.length) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('None recorded.', MARGIN, yRef.current);
    yRef.current += 8;
    return;
  }

  const headerH = 8;
  let x = MARGIN;
  doc.setFillColor(...BRAND);
  doc.rect(MARGIN, yRef.current, cw, headerH, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  headers.forEach((h, i) => {
    doc.text(h, x + 2, yRef.current + 5.5);
    x += cols[i];
  });
  yRef.current += headerH;

  rows.forEach((row) => {
    const cellLines = [
      wrap(doc, row.name, cols[0] - 4),
      [row.status],
      wrap(doc, row.note || '—', cols[2] - 4),
    ];
    const rowH = Math.max(8, ...cellLines.map((c) => c.length * 4.2 + 3));
    ensureSpace(doc, yRef, rowH + 2);
    x = MARGIN;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN, yRef.current, cw, rowH, 'S');
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    cellLines.forEach((lines, i) => {
      if (i === 1) {
        doc.setTextColor(...(row.status === 'Concern' ? CONCERN : OK));
        doc.setFont(FONT, 'bold');
      } else {
        doc.setTextColor(...TEXT_DARK);
        doc.setFont(FONT, 'normal');
      }
      lines.forEach((line, li) => {
        doc.text(line, x + 2, yRef.current + 4 + li * 4.2);
      });
      x += cols[i];
      if (i < 2) doc.line(x, yRef.current, x, yRef.current + rowH);
    });
    yRef.current += rowH;
  });
  yRef.current += 6;
}

function renderOneReport(doc, payload, { packMode = false } = {}) {
  const yRef = { current: MARGIN };
  const title = packMode ? `Report · ${formatDate(payload.workDate)}` : 'Daily Pulse Report';
  const subtitle = [
    payload.leaderName,
    payload.leaderEmail ? `(${payload.leaderEmail})` : '',
    packMode ? '' : `Work date: ${formatDate(payload.workDate)}`,
  ]
    .filter(Boolean)
    .join(' ');

  drawBrandHeader(doc, yRef, title, subtitle);

  drawMetaRow(doc, yRef, [
    { label: 'Work date', value: formatDate(payload.workDate) },
    { label: 'Submitted', value: formatDateTime(payload.submittedAt) },
    { label: 'Team morale', value: payload.teamMorale },
    { label: 'Delivery on track', value: payload.deliveryOnTrack },
  ]);

  drawSection(doc, yRef, 'Top blocker', payload.topBlocker || '—');
  drawSection(doc, yRef, 'What went well', payload.wentWell || '—');
  drawSection(doc, yRef, 'Whole-team summary', payload.teamSummary || '—');
  drawTouchpointsTable(doc, yRef, payload.touchpoints);

  doc.setFont(FONT, 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  const conf =
    'Confidential — for internal management use. Property of Thinkers Afrika (Pty) Ltd. Do not distribute without authorisation.';
  const cl = wrap(doc, conf, contentWidth(doc));
  ensureSpace(doc, yRef, cl.length * 3.5 + 4);
  cl.forEach((line) => {
    doc.text(line, MARGIN, yRef.current);
    yRef.current += 3.5;
  });
}

/**
 * @param {object} payload — from questionnaireToPayload
 * @returns {jsPDF}
 */
export function generateDailyPulsePdf(payload) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  renderOneReport(doc, payload);
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(
      doc,
      p,
      total,
      `Daily pulse · ${formatDate(payload.workDate)} · ${payload.leaderName}`
    );
  }
  return doc;
}

/**
 * Combined PDF for all questionnaires of one leader (newest first).
 * @param {{ leaderName: string, leaderEmail?: string, reports: object[] }} opts
 */
export function generateDailyPulsePackPdf({ leaderName, leaderEmail, reports }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const yRef = { current: MARGIN };
  const sorted = [...reports].sort((a, b) => {
    const da = new Date(qField(a, 'work_date') || 0).getTime();
    const db = new Date(qField(b, 'work_date') || 0).getTime();
    return db - da;
  });

  drawBrandHeader(
    doc,
    yRef,
    'Daily Pulse — Complete history',
    [leaderName, leaderEmail, `${sorted.length} report(s)`].filter(Boolean).join(' · ')
  );

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Reports included (newest first):', MARGIN, yRef.current);
  yRef.current += 6;
  sorted.forEach((q, i) => {
    ensureSpace(doc, yRef, 6);
    doc.text(
      `${i + 1}. ${formatDate(qField(q, 'work_date'))} — submitted ${formatDateTime(qField(q, 'created_at'))}`,
      MARGIN + 2,
      yRef.current
    );
    yRef.current += 5;
  });
  yRef.current += 6;

  sorted.forEach((q, idx) => {
    if (idx > 0) doc.addPage();
    const payload = questionnaireToPayload(q, { full_name: leaderName, email: leaderEmail });
    renderOneReport(doc, payload, { packMode: true });
  });

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, p, total, `Daily pulse pack · ${leaderName}`);
  }
  return doc;
}

export function downloadDailyPulsePdf(doc, filename) {
  doc.save(filename);
}

export function safePdfFilename(base) {
  return String(base || 'daily-pulse')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'daily-pulse';
}
