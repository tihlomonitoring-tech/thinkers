import { jsPDF } from 'jspdf';

const MARGIN = 18;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_MARGIN = 20;
const FONT = 'helvetica';
const FONT_SIZE_BODY = 10;
const FONT_SIZE_TABLE = 9;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SUBTITLE = 11;
const FONT_SIZE_SECTION = 11;
const LINE_HEIGHT = 4.5;
const CELL_PAD = 1.5;
const ROW_HEIGHT = 6;
const SECTION_GAP = 6;
const BAR_HEIGHT = 5;
const MAX_IMAGE_HEIGHT = 50;
const MAX_IMAGE_WIDTH = CONTENT_WIDTH;

const BLACK = [0, 0, 0];
const TABLE_BORDER = [60, 60, 60];
const TEXT_DARK = [33, 33, 33];
const TEXT_MUTED = [80, 80, 80];

function checkNewPage(doc, yRef, needSpace = 40) {
  const minY = PAGE_HEIGHT - FOOTER_MARGIN - (needSpace || 25);
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

/** Draw a paragraph with justified alignment (last line left-aligned). Updates yRef. */
function drawJustifiedParagraph(doc, yRef, text) {
  if (!text) return;
  setBodyFont(doc);
  const lines = wrap(doc, text, CONTENT_WIDTH);
  lines.forEach((line, i) => {
    checkNewPage(doc, yRef, LINE_HEIGHT + 2);
    const isLastLine = i === lines.length - 1;
    doc.text(line, MARGIN, yRef.current, {
      align: isLastLine ? 'left' : 'justify',
      maxWidth: CONTENT_WIDTH,
    });
    yRef.current += LINE_HEIGHT;
  });
  yRef.current += 3;
}

function setBodyFont(doc) {
  doc.setFont(FONT, 'normal');
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(...TEXT_DARK);
}

function setTableFont(doc, bold = false) {
  doc.setFont(FONT, bold ? 'bold' : 'normal');
  doc.setFontSize(FONT_SIZE_TABLE);
  doc.setTextColor(...(bold ? BLACK : TEXT_DARK));
}

function sectionBar(doc, yRef, title) {
  checkNewPage(doc, yRef, BAR_HEIGHT + 12);
  const y = yRef.current;
  doc.setFillColor(...BLACK);
  doc.rect(MARGIN, y, CONTENT_WIDTH, BAR_HEIGHT, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), MARGIN + 2, y + 3.5);
  yRef.current = y + BAR_HEIGHT + 4;
}

function drawGenericTable(doc, yRef, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const numCols = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
  const colWidth = CONTENT_WIDTH / numCols;
  const colWidths = Array(numCols).fill(colWidth);
  const startX = MARGIN;
  let y = yRef.current;
  checkNewPage(doc, yRef, ROW_HEIGHT * 2 + 15);
  y = yRef.current;
  doc.setDrawColor(...TABLE_BORDER);
  doc.setLineWidth(0.3);
  rows.forEach((row, rowIdx) => {
    const cells = Array.isArray(row) && row.length ? row : [''];
    const padded = [...cells];
    while (padded.length < numCols) padded.push('');
    const cellLines = colWidths.map((_, colIdx) => wrap(doc, padded[colIdx] != null ? String(padded[colIdx]) : '', colWidth - CELL_PAD * 2));
    const maxLines = Math.max(1, ...cellLines.map((arr) => arr.length));
    const rowH = Math.max(ROW_HEIGHT, maxLines * (LINE_HEIGHT - 0.5) + CELL_PAD * 2);
    yRef.current = y;
    checkNewPage(doc, yRef, rowH + 5);
    y = yRef.current;
    setTableFont(doc, rowIdx === 0);
    doc.rect(startX, y, CONTENT_WIDTH, rowH, 'S');
    let x = startX;
    colWidths.forEach((w, colIdx) => {
      if (colIdx > 0) doc.line(x, y, x, y + rowH);
      const lines = cellLines[colIdx] || [];
      lines.forEach((line, i) => doc.text(line, x + CELL_PAD, y + CELL_PAD + (i + 1) * (LINE_HEIGHT - 0.5)));
      x += w;
    });
    doc.line(startX + CONTENT_WIDTH, y, startX + CONTENT_WIDTH, y + rowH);
    y += rowH;
  });
  setTableFont(doc, false);
  yRef.current = y + SECTION_GAP;
}

function drawBlocks(doc, yRef, blocks) {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (b.type === 'text' && b.text) {
      drawJustifiedParagraph(doc, yRef, b.text);
    } else if (b.type === 'image' && b.base64) {
      try {
        const dataUrl = b.base64.startsWith('data:') ? b.base64 : `data:image/png;base64,${b.base64}`;
        const format = /data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';
        checkNewPage(doc, yRef, MAX_IMAGE_HEIGHT + 10);
        doc.addImage(dataUrl, format, MARGIN, yRef.current, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, undefined, 'FAST');
        yRef.current += MAX_IMAGE_HEIGHT + 5;
      } catch (_) {
        doc.setFontSize(8);
        doc.setTextColor(...TEXT_MUTED);
        doc.text('[Image]', MARGIN, yRef.current);
        yRef.current += 6;
      }
    } else if (b.type === 'table' && Array.isArray(b.rows) && b.rows.length > 0) {
      drawGenericTable(doc, yRef, b.rows);
    }
  }
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * Generate monthly performance report PDF with a cover page; all body content starts on page 2.
 * @param {Object} report - Report from API (title, prepared_by, reporting_period_start/end, submitted_date, executive_summary, key_metrics, sections, breakdowns, fleet_performance)
 * @param {Object} options - { logoDataUrl }
 */
export function generateMonthlyPerformanceReportPdf(report, options = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const yRef = { current: MARGIN };
  const logoDataUrl = options.logoDataUrl;
  const logoFormat = logoDataUrl && /data:image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG';

  // ——— Cover page (page 1) ———
  const centerX = PAGE_WIDTH / 2;
  const coverStartY = 50;
  let coverY = coverStartY;

  if (logoDataUrl) {
    try {
      const logoSize = 32;
      doc.addImage(logoDataUrl, logoFormat, centerX - logoSize / 2, coverY, logoSize, logoSize, undefined, 'FAST');
      coverY += logoSize + 12;
    } catch (_) {}
  }

  doc.setFont(FONT, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  const titleText = (report.title || 'Monthly Performance Report').slice(0, 80);
  const titleLines = wrap(doc, titleText, CONTENT_WIDTH);
  titleLines.forEach((line) => {
    doc.text(line, centerX - doc.getTextWidth(line) / 2, coverY);
    coverY += 8;
  });
  coverY += 6;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  if (report.prepared_by) {
    doc.text(`Prepared by: ${report.prepared_by}`, centerX - doc.getTextWidth(`Prepared by: ${report.prepared_by}`) / 2, coverY);
    coverY += 8;
  }
  if (report.reporting_period_start && report.reporting_period_end) {
    const periodStr = `Reporting Period: ${formatDate(report.reporting_period_start)} – ${formatDate(report.reporting_period_end)}`;
    doc.text(periodStr, centerX - doc.getTextWidth(periodStr) / 2, coverY);
    coverY += 7;
  }
  if (report.submitted_date) {
    const subStr = `Submitted: ${formatDate(report.submitted_date)}`;
    doc.text(subStr, centerX - doc.getTextWidth(subStr) / 2, coverY);
    coverY += 10;
  }

  const disclaimer =
    report.disclaimer ||
    'Disclaimer: Report Accuracy and Continuous Improvement — These circuit performance reports are being formalised. Absolute data accuracy is not guaranteed. Please review operational data and report any inaccuracies for continuous improvement.';
  const discLines = wrap(doc, disclaimer, CONTENT_WIDTH - 8);
  const boxH = discLines.length * 4.5 + 8;
  const boxY = Math.min(coverY + 8, PAGE_HEIGHT - FOOTER_MARGIN - boxH - 28);
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.3);
  doc.rect(centerX - (CONTENT_WIDTH - 8) / 2, boxY, CONTENT_WIDTH - 8, boxH, 'S');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  discLines.forEach((line, i) => {
    doc.text(line, centerX - doc.getTextWidth(line) / 2, boxY + 6 + i * 4.5);
  });

  // Confidentiality notice at bottom of cover page (above footer)
  const conf = 'This report contains proprietary and confidential information intended solely for use by Tihlo and parties duly authorised by Thinkers Afrika. Unauthorised distribution or disclosure is strictly prohibited.';
  const confLineHeight = 4;
  const confLines = wrap(doc, conf, CONTENT_WIDTH);
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const confStartY = PAGE_HEIGHT - FOOTER_MARGIN - confLines.length * confLineHeight - 2;
  confLines.forEach((line, i) => {
    doc.text(line, centerX - doc.getTextWidth(line) / 2, confStartY + i * confLineHeight);
  });

  // ——— Body content starts on page 2 ———
  doc.addPage();
  yRef.current = MARGIN;

  if (report.executive_summary) {
    sectionBar(doc, yRef, '1. Executive Summary');
    drawJustifiedParagraph(doc, yRef, report.executive_summary);
    yRef.current += SECTION_GAP - 3;
  }

  const keyInsights = Array.isArray(report.key_insights) ? report.key_insights : [];
  if (keyInsights.length > 0) {
    checkNewPage(doc, yRef, 12);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(FONT_SIZE_SECTION);
    doc.setTextColor(...TEXT_DARK);
    doc.text('1.1 Key Operational Insights', MARGIN, yRef.current);
    yRef.current += 6;
    setBodyFont(doc);
    keyInsights.forEach((ins) => {
      const head = ins.title ? `• ${ins.title}: ` : '• ';
      drawJustifiedParagraph(doc, yRef, `${head}${ins.body || ''}`);
    });
    yRef.current += SECTION_GAP - 3;
  }

  const keyMetrics = Array.isArray(report.key_metrics) ? report.key_metrics : [];
  if (keyMetrics.length > 0) {
    sectionBar(doc, yRef, '2. Key Performance Metrics');
    const headers = ['Metric', 'Value', 'Analytical Context'];
    const rows = keyMetrics.map((m) => [m.metric || '—', m.value ?? '—', (m.commentary || '—').toString().slice(0, 80)]);
    const cw = [45, 25, CONTENT_WIDTH - 70];
    const tableWidth = CONTENT_WIDTH;
    let ty = yRef.current;
    checkNewPage(doc, yRef, ROW_HEIGHT * (keyMetrics.length + 1) + 10);
    ty = yRef.current;
    doc.setDrawColor(...TABLE_BORDER);
    doc.setLineWidth(0.4);
    setTableFont(doc, true);
    doc.rect(MARGIN, ty, tableWidth, ROW_HEIGHT, 'S');
    let x = MARGIN;
    headers.forEach((h, i) => { if (i > 0) doc.line(x, ty, x, ty + ROW_HEIGHT); doc.text(h, x + CELL_PAD, ty + 3.8); x += cw[i]; });
    doc.line(MARGIN + tableWidth, ty, MARGIN + tableWidth, ty + ROW_HEIGHT);
    ty += ROW_HEIGHT;
    setTableFont(doc, false);
    rows.forEach((row) => {
      const cellLines = row.map((cell, colIdx) => wrap(doc, cell, cw[colIdx] - CELL_PAD * 2));
      const rowH = Math.max(ROW_HEIGHT, Math.max(...cellLines.map((a) => a.length)) * (LINE_HEIGHT - 0.5) + CELL_PAD * 2);
      yRef.current = ty;
      checkNewPage(doc, yRef, rowH + 5);
      ty = yRef.current;
      doc.rect(MARGIN, ty, tableWidth, rowH, 'S');
      x = MARGIN;
      row.forEach((cell, colIdx) => {
        if (colIdx > 0) doc.line(x, ty, x, ty + rowH);
        (cellLines[colIdx] || []).forEach((line, i) => doc.text(line, x + CELL_PAD, ty + CELL_PAD + (i + 1) * (LINE_HEIGHT - 0.5)));
        x += cw[colIdx];
      });
      doc.line(MARGIN + tableWidth, ty, MARGIN + tableWidth, ty + rowH);
      ty += rowH;
    });
    yRef.current = ty + SECTION_GAP;
  }

  const sections = Array.isArray(report.sections) ? report.sections : [];
  let sectionNum = 3;
  sections.forEach((sec) => {
    const hasSubsections = Array.isArray(sec.subsections) && sec.subsections.length > 0;
    const legacyBody = !hasSubsections && (sec.body || sec.heading);
    if (legacyBody) {
      sectionBar(doc, yRef, `${sectionNum}. ${sec.heading || 'Section'}`);
      drawJustifiedParagraph(doc, yRef, sec.body || '');
      yRef.current += SECTION_GAP - 3;
      sectionNum++;
      return;
    }
    if (!hasSubsections) return;
    sectionBar(doc, yRef, `${sectionNum}. ${sec.heading || 'Section'}`);
    sec.subsections.forEach((sub) => {
      if (sub.subheading) {
        checkNewPage(doc, yRef, 8);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(FONT_SIZE_SECTION);
        doc.setTextColor(...TEXT_DARK);
        doc.text(sub.subheading, MARGIN, yRef.current);
        yRef.current += 5;
      }
      drawBlocks(doc, yRef, sub.blocks || []);
    });
    yRef.current += SECTION_GAP;
    sectionNum++;
  });

  const breakdowns = Array.isArray(report.breakdowns) ? report.breakdowns : [];
  if (breakdowns.length > 0) {
    sectionBar(doc, yRef, 'Breakdowns (incidents)');
    const rows = [['Date', 'Time', 'Route', 'Truck reg', 'Description', 'Company'], ...breakdowns.map((b) => [formatDate(b.date), b.time || '—', (b.route || '—').slice(0, 25), (b.truck_reg || '—').slice(0, 12), (b.description || '—').slice(0, 30), (b.company || '—').slice(0, 15)])];
    drawGenericTable(doc, yRef, rows);
  }

  const fleetPerf = Array.isArray(report.fleet_performance) ? report.fleet_performance : [];
  if (fleetPerf.length > 0) {
    sectionBar(doc, yRef, 'Fleet performance by haulier');
    const rows = [['Haulier', 'Trips', '% Trips', 'Tonnage', '% Tonnage', 'Avg t/Trip', 'Trucks'], ...fleetPerf.map((f) => [f.haulier || '—', f.trips ?? '—', f.pct_trips ?? '—', f.tonnage ?? '—', f.pct_tonnage ?? '—', f.avg_t_per_trip ?? '—', f.trucks_deployed ?? '—'])];
    drawGenericTable(doc, yRef, rows);
  }

  const conclusion = report.conclusion;
  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  if (conclusion?.summary || (conclusion?.bullets || []).length || recommendations.length) {
    sectionBar(doc, yRef, '8. Conclusion and Recommendations');
    if (conclusion?.summary) {
      checkNewPage(doc, yRef, 20);
      doc.setDrawColor(...TABLE_BORDER);
      doc.setLineWidth(0.3);
      const sumLines = wrap(doc, conclusion.summary, CONTENT_WIDTH - 6);
      const boxH = sumLines.length * LINE_HEIGHT + 6;
      doc.rect(MARGIN, yRef.current, CONTENT_WIDTH, boxH, 'S');
      setBodyFont(doc);
      sumLines.forEach((line, i) => doc.text(line, MARGIN + 3, yRef.current + 5 + i * LINE_HEIGHT));
      yRef.current += boxH + 6;
    }
    if ((conclusion?.bullets || []).length) {
      doc.setFont(FONT, 'bold');
      doc.setFontSize(FONT_SIZE_SECTION);
      doc.text('8.1 Conclusion', MARGIN, yRef.current);
      yRef.current += 5;
      setBodyFont(doc);
      conclusion.bullets.forEach((b) => drawJustifiedParagraph(doc, yRef, `• ${b}`));
    }
    if (recommendations.length) {
      sectionBar(doc, yRef, '8.2 Recommendations');
      recommendations.forEach((rec, idx) => {
        checkNewPage(doc, yRef, 20);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(FONT_SIZE_BODY);
        doc.text(`${idx + 1}. ${rec.title || 'Recommendation'}`, MARGIN, yRef.current);
        yRef.current += 5;
        setBodyFont(doc);
        if (rec.issue) drawJustifiedParagraph(doc, yRef, `Issue: ${rec.issue}`);
        if (rec.action) drawJustifiedParagraph(doc, yRef, `Action: ${rec.action}`);
        yRef.current += 2;
      });
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    const pageLabel = `Page ${p} of ${pageCount}`;
    doc.text(pageLabel, centerX - doc.getTextWidth(pageLabel) / 2, PAGE_HEIGHT - 8);
    const footerBrand = 'Tihlo';
    doc.text(footerBrand, centerX - doc.getTextWidth(footerBrand) / 2, PAGE_HEIGHT - 4);
  }
  return doc;
}
