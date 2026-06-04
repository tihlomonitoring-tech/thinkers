/**
 * Performance improvement plan PDF — industrial psychology structured layout.
 */
import PDFDocument from 'pdfkit';
import { PDF_THEME, stampCommercialPdfFooters, formatDate, embedPdfLogo } from './accountingPdfLayout.js';

const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const STAMP_ZONE = 46;
const maxContentY = () => PAGE.h - PAGE.margin - STAMP_ZONE;
const contentW = () => PAGE.w - PAGE.margin * 2;

function newPage(doc) {
  doc.addPage();
  doc.y = PAGE.margin + 8;
}

function ensureSpace(doc, h) {
  if (doc.y + h > maxContentY()) {
    newPage(doc);
    return true;
  }
  return false;
}

function drawAccentBar(doc) {
  doc.save();
  doc.rect(0, 0, PAGE.w, 5).fill(PDF_THEME.accentBar);
  doc.restore();
}

function drawCompanyBlock(doc, company, logo, startY) {
  const logoBuffer = logo?.logoBuffer ?? logo;
  const logoPath = logo?.logoPath ?? null;
  const w = contentW();
  const logoSlotW = 156;
  const logoMaxH = 54;
  const textW = Math.max(120, w - logoSlotW - 16);
  let y = startY;
  doc.font('Helvetica', 'bold').fontSize(13).fillColor(PDF_THEME.ink);
  doc.text(company?.company_name || 'Company', PAGE.margin, y, { width: textW });
  y = doc.y + 4;
  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.muted);
  if (company?.address) {
    doc.text(String(company.address), PAGE.margin, y, { width: textW });
    y = doc.y + 2;
  }
  let logoBottom = startY;
  if (embedPdfLogo(doc, { logoBuffer, logoPath }, PAGE.margin + w - logoSlotW, startY, logoSlotW, logoMaxH)) {
    logoBottom = startY + logoMaxH;
  }
  y = Math.max(y, logoBottom) + 12;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + w, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  return y + 14;
}

function block(doc, title, text, y) {
  ensureSpace(doc, 60);
  const w = contentW();
  doc.font('Helvetica', 'bold').fontSize(10).fillColor(PDF_THEME.accent);
  doc.text(title, PAGE.margin, y);
  y = doc.y + 5;
  doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
  doc.text(text || '—', PAGE.margin, y, { width: w, align: 'justify', lineGap: 3 });
  return doc.y + 12;
}

export function buildPipPlanPdfBuffer({ plan, objectives = [], reports = [], company, logoBuffer, logoPath, employeeName }) {
  const logo = { logoBuffer, logoPath };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawAccentBar(doc);
    let y = drawCompanyBlock(doc, company, logo, PAGE.margin + 8);

    doc.font('Helvetica', 'bold').fontSize(9).fillColor(PDF_THEME.accent);
    doc.text('PERFORMANCE IMPROVEMENT PLAN', PAGE.margin, y);
    y = doc.y + 6;
    doc.font('Helvetica', 'bold').fontSize(13).fillColor(PDF_THEME.ink);
    doc.text(plan.title || 'Performance improvement plan', PAGE.margin, y, { width: contentW() });
    y = doc.y + 8;
    doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.muted);
    doc.text(
      `Employee: ${employeeName || '—'}  ·  Status: ${plan.status || 'active'}  ·  Period: ${formatDate(plan.start_date)} – ${formatDate(plan.end_date) || 'ongoing'}`,
      PAGE.margin,
      y,
      { width: contentW() }
    );
    y = doc.y + 14;

    y = block(doc, '1. Purpose & psychological framework', plan.goals, y);
    y = block(doc, '2. Evidence-based approaches', plan.approaches, y);
    y = block(doc, '3. Interventions & support', plan.interventions, y);

    ensureSpace(doc, 40);
    doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink);
    doc.text('4. Weekly objectives (management)', PAGE.margin, y);
    y = doc.y + 8;

    if (!objectives.length) {
      doc.font('Helvetica', 'Oblique').fontSize(9.5).fillColor(PDF_THEME.muted);
      doc.text('Objectives will be set by management each review week.', PAGE.margin, y);
      y = doc.y + 12;
    } else {
      for (const o of objectives) {
        ensureSpace(doc, 50);
        doc.font('Helvetica', 'bold').fontSize(9.5).fillColor(PDF_THEME.ink);
        doc.text(`Week ${o.week_number}: ${o.title}`, PAGE.margin, y, { width: contentW() });
        y = doc.y + 4;
        doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.inkSoft);
        const bits = [o.description, o.target_outcome ? `Target: ${o.target_outcome}` : null, `Status: ${o.status}`].filter(Boolean).join('\n');
        doc.text(bits, PAGE.margin + 8, y, { width: contentW() - 8 });
        y = doc.y + 10;
      }
    }

    ensureSpace(doc, 40);
    doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink);
    doc.text('5. Employee weekly progress reports', PAGE.margin, y);
    y = doc.y + 8;

    if (!reports.length) {
      doc.font('Helvetica', 'Oblique').fontSize(9.5).fillColor(PDF_THEME.muted);
      doc.text('No employee submissions recorded yet.', PAGE.margin, y);
    } else {
      for (const r of reports) {
        ensureSpace(doc, 55);
        doc.font('Helvetica', 'bold').fontSize(9.5).fillColor(PDF_THEME.ink);
        doc.text(`Week ${r.week_number} progress report`, PAGE.margin, y);
        y = doc.y + 4;
        doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.inkSoft);
        const body = [r.progress_summary, r.employee_response ? `Employee: ${r.employee_response}` : null].filter(Boolean).join('\n\n');
        doc.text(body || '—', PAGE.margin + 8, y, { width: contentW() - 8 });
        y = doc.y + 10;
      }
    }

    stampCommercialPdfFooters(doc, {
      documentTitle: plan.title || 'PIP',
      documentNumber: plan.written_warning_ref || '',
    });
    doc.end();
  });
}
