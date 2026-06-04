/**
 * Written warning letter PDF — accounting commercial styling.
 */
import PDFDocument from 'pdfkit';
import { PDF_THEME, stampCommercialPdfFooters, formatDate, embedPdfLogo } from './accountingPdfLayout.js';

const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const STAMP_ZONE = 46;
const maxContentY = () => PAGE.h - PAGE.margin - STAMP_ZONE;
const contentW = () => PAGE.w - PAGE.margin * 2;

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
  for (const line of [company?.address, company?.vat_number ? `VAT: ${company.vat_number}` : null, company?.company_registration ? `Reg: ${company.company_registration}` : null, company?.email].filter(Boolean)) {
    doc.text(String(line), PAGE.margin, y, { width: textW });
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

function section(doc, heading, body, y) {
  const w = contentW();
  doc.font('Helvetica', 'bold').fontSize(10).fillColor(PDF_THEME.ink);
  doc.text(heading, PAGE.margin, y, { width: w });
  y = doc.y + 6;
  doc.font('Helvetica', 'normal').fontSize(10).fillColor(PDF_THEME.inkSoft);
  doc.text(body || '—', PAGE.margin, y, { width: w, align: 'justify', lineGap: 3 });
  return doc.y + 14;
}

export function buildWrittenWarningPdfBuffer({ warning, policy, company, logoBuffer, logoPath, typeTitle, employeeName }) {
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
    doc.text('FORMAL WRITTEN WARNING', PAGE.margin, y);
    y = doc.y + 8;

    doc.font('Helvetica', 'bold').fontSize(14).fillColor(PDF_THEME.ink);
    doc.text(warning.title || typeTitle || 'Written warning', PAGE.margin, y, { width: contentW() });
    y = doc.y + 10;

    doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.muted);
    doc.text(`Ref: ${warning.reference_number || '—'}  ·  Date: ${formatDate(warning.published_at || warning.created_at)}`, PAGE.margin, y);
    y = doc.y + 12;

    doc.font('Helvetica', 'normal').fontSize(10).fillColor(PDF_THEME.ink);
    doc.text(`To: ${employeeName || 'Employee'}`, PAGE.margin, y);
    y = doc.y + 14;

    y = section(doc, 'Warning category', typeTitle || 'Written warning', y);
    y = section(
      doc,
      'Company policy contravened',
      `${policy?.title || 'Policy'} (${policy?.reference_number || '—'})${policy?.act_or_section ? ` — ${policy.act_or_section}` : ''}`,
      y
    );
    y = section(doc, 'Summary of incident / conduct', warning.incident_summary || warning.description, y);
    y = section(doc, 'Required corrective action', warning.corrective_action, y);

    doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
    doc.text(
      'You are required to acknowledge this written warning electronically in the employee profile portal. Your signature confirms that you have received, read, and understood this notice. A performance improvement plan will be issued upon acknowledgement to support your return to full compliance.',
      PAGE.margin,
      y,
      { width: contentW(), align: 'justify', lineGap: 3 }
    );

    stampCommercialPdfFooters(doc, {
      documentTitle: warning.title || 'Written warning',
      documentNumber: warning.reference_number || '',
    });
    doc.end();
  });
}
