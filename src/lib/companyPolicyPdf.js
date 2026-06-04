/**
 * Company policy / bill PDF — matches accounting commercial document styling.
 */
import PDFDocument from 'pdfkit';
import { PDF_THEME, stampCommercialPdfFooters, formatDate, embedPdfLogo } from './accountingPdfLayout.js';

const PAGE = { w: 595.28, h: 841.89, margin: 48 };
const STAMP_ZONE = 46;
const maxContentY = () => PAGE.h - PAGE.margin - STAMP_ZONE;
const contentW = () => PAGE.w - PAGE.margin * 2;

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function parseBillBody(body) {
  if (!body || !String(body).trim().startsWith('{')) return null;
  try {
    const j = JSON.parse(body);
    if (j.format === 'bill_v1') return j;
  } catch (_) {}
  return null;
}

export function stripPolicyHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function clauseHasContent(clause) {
  if (String(clause?.text || '').trim()) return true;
  return (clause?.children || []).some((ch) => String(ch?.text || '').trim());
}

function sectionHasContent(section) {
  const bill = parseBillBody(section.body);
  if (bill?.clauses?.some(clauseHasContent)) return true;
  const plain = stripPolicyHtml(section.body);
  if (plain) return true;
  const head = [section.section_number, section.title].filter(Boolean).join(' ').trim();
  if (['part', 'chapter', 'schedule'].includes(bill?.section_type)) return !!head;
  return !!head;
}

function newPage(doc) {
  doc.addPage();
  doc.y = PAGE.margin;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > maxContentY()) {
    newPage(doc);
    return true;
  }
  return false;
}

function atPageTop(doc) {
  return doc.y <= PAGE.margin + 28;
}

function drawAccentBar(doc) {
  doc.save();
  doc.rect(0, 0, PAGE.w, 5).fill(PDF_THEME.accentBar);
  doc.restore();
}

function drawRunningHeader(doc, company, policy, logo = null) {
  const logoBuffer = logo?.logoBuffer ?? logo;
  const logoPath = logo?.logoPath ?? null;
  const w = contentW();
  const logoW = 80;
  const logoH = 28;
  const headerTop = PAGE.margin + 6;
  let textRight = PAGE.margin + w;

  if (embedPdfLogo(doc, { logoBuffer, logoPath }, PAGE.margin + w - logoW, headerTop, logoW, logoH)) {
    textRight = PAGE.margin + w - logoW - 12;
  }

  const textY = headerTop + 8;
  doc.font('Helvetica', 'bold').fontSize(8).fillColor(PDF_THEME.muted);
  const left = company?.company_name || 'Company';
  const right = policy.reference_number || '';
  const mid = PAGE.margin + (textRight - PAGE.margin) * 0.55;
  doc.text(left, PAGE.margin, textY, { width: mid - PAGE.margin, lineBreak: false });
  doc.text(right, mid, textY, { width: textRight - mid, align: 'right', lineBreak: false });
  const ruleY = Math.max(headerTop + logoH, textY + 12) + 4;
  doc
    .moveTo(PAGE.margin, ruleY)
    .lineTo(PAGE.margin + w, ruleY)
    .strokeColor(PDF_THEME.line)
    .lineWidth(0.5)
    .stroke();
  doc.y = ruleY + 8;
}

function drawCompanyBlock(doc, company, logo, startY) {
  const logoBuffer = logo?.logoBuffer ?? logo;
  const logoPath = logo?.logoPath ?? null;
  const w = contentW();
  const gap = 16;
  const logoSlotW = 156;
  const logoMaxH = 54;
  const textW = Math.max(120, w - logoSlotW - gap);
  let y = startY;

  doc.font('Helvetica', 'bold').fontSize(13).fillColor(PDF_THEME.ink);
  doc.text(company?.company_name || 'Company', PAGE.margin, y, { width: textW });
  y = doc.y + 4;

  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.muted);
  const issuerBits = [];
  if (company?.address) issuerBits.push(String(company.address));
  if (company?.vat_number) issuerBits.push(`VAT: ${company.vat_number}`);
  if (company?.company_registration) issuerBits.push(`Reg: ${company.company_registration}`);
  if (company?.email) issuerBits.push(String(company.email));
  if (company?.website) issuerBits.push(String(company.website));
  for (const line of issuerBits) {
    doc.text(line, PAGE.margin, y, { width: textW });
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

function drawDocumentPanel(doc, policy, watermark, y) {
  const w = contentW();
  const panelH = 118;
  doc.roundedRect(PAGE.margin, y, w, panelH, 4).fillAndStroke(PDF_THEME.panelBg, PDF_THEME.line);

  const px = PAGE.margin + 14;
  let py = y + 12;
  doc.font('Helvetica', 'bold').fontSize(9).fillColor(PDF_THEME.accent);
  doc.text(watermark ? 'DRAFT — AS INTRODUCED' : 'OFFICIAL POLICY / BILL', px, py, { width: w - 28 });
  py = doc.y + 6;

  doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink);
  doc.text(`Ref: ${policy.reference_number || '—'}`, px, py, { width: w - 28 });
  py = doc.y + 4;

  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.inkSoft);
  const eff = policy.effective_date
    ? formatDate(policy.effective_date)
    : policy.published_at
      ? formatDate(policy.published_at)
      : '—';
  doc.text(`Version ${policy.version || 1}  ·  Commencement ${eff}`, px, py, { width: w - 28 });
  py = doc.y + 4;
  doc.text(`Authority: ${policy.act_or_section || '—'}`, px, py, { width: w - 28 });
  py = doc.y + 4;
  if (policy.department_name) {
    doc.text(`Portfolio: ${policy.department_name}`, px, py, { width: w - 28 });
    py = doc.y + 4;
  }
  doc.text(`Classification: ${String(policy.classification || 'internal')}`, px, py, { width: w - 28 });

  return y + panelH + 16;
}

function drawTitleBlock(doc, title, y) {
  const w = contentW();
  doc.font('Helvetica', 'bold').fontSize(16).fillColor(PDF_THEME.ink);
  doc.text(title || 'Untitled', PAGE.margin, y, { width: w, align: 'left' });
  return doc.y + 14;
}

function renderClauses(doc, body, sectionType) {
  const bill = parseBillBody(body);
  if (!bill) return false;
  const w = contentW();
  const type = sectionType || bill.section_type || 'section';
  let wrote = false;

  for (const c of bill.clauses || []) {
    const text = String(c.text || '').trim();
    if (text) {
      ensureSpace(doc, 40);
      const indent = type === 'paragraph' || type === 'subsection' ? PAGE.margin + 20 : PAGE.margin;
      const prefix = c.number ? `${c.number} ` : '';
      doc
        .font(type === 'preamble' ? 'Helvetica-Oblique' : 'Helvetica', 'normal')
        .fontSize(10)
        .fillColor(PDF_THEME.inkSoft);
      doc.text(`${prefix}${text}`, indent, doc.y, {
        width: PAGE.w - indent - PAGE.margin,
        align: type === 'preamble' ? 'left' : 'justify',
        lineGap: 3,
      });
      doc.moveDown(0.35);
      wrote = true;
    }
    for (const ch of c.children || []) {
      const ct = String(ch.text || '').trim();
      if (!ct) continue;
      ensureSpace(doc, 28);
      doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
      doc.text(`${ch.number || ''} ${ct}`.trim(), PAGE.margin + 28, doc.y, {
        width: w - 28,
        align: 'justify',
        lineGap: 2,
      });
      doc.moveDown(0.25);
      wrote = true;
    }
  }
  return wrote;
}

function renderSectionHeading(doc, section, bill) {
  const w = contentW();
  const st = bill?.section_type || 'section';
  const headParts = [section.section_number, section.title].filter(Boolean);
  if (!headParts.length) return;

  ensureSpace(doc, 48);

  if (st === 'part' || st === 'chapter' || st === 'schedule') {
    doc.font('Helvetica', 'bold').fontSize(13).fillColor(PDF_THEME.accent);
    doc.text(headParts.join('\n'), PAGE.margin, doc.y, { width: w, align: 'center' });
    doc.moveDown(0.6);
  } else if (st === 'preamble' || st === 'enacting') {
    doc.font('Helvetica', 'bold').fontSize(10).fillColor(PDF_THEME.ink);
    doc.text((section.title || st).toUpperCase(), PAGE.margin, doc.y, { width: w });
    doc.moveDown(0.35);
  } else {
    doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink);
    doc.text(headParts.join('  '), PAGE.margin, doc.y, { width: w });
    doc.moveDown(0.4);
  }
}

/**
 * @param {{ policy: object, sections: object[], company?: object, logoBuffer?: Buffer|null, logoPath?: string|null, watermark?: string }} opts
 */
export function buildCompanyPolicyPdfBuffer({
  policy,
  sections,
  company = {},
  logoBuffer = null,
  logoPath = null,
  watermark = null,
}) {
  const logo = { logoBuffer, logoPath };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sorted = [...(sections || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const displaySections = sorted.filter(sectionHasContent);
    const title = policy.title || 'Untitled policy';

    doc.y = PAGE.margin;
    drawAccentBar(doc);
    doc.y = PAGE.margin + 8;

    let y = drawCompanyBlock(doc, company, logo, doc.y);
    y = drawDocumentPanel(doc, policy, watermark, y);
    doc.y = y;
    doc.y = drawTitleBlock(doc, title, doc.y);

    if (policy.summary) {
      ensureSpace(doc, 60);
      doc.font('Helvetica', 'bold').fontSize(9).fillColor(PDF_THEME.muted);
      doc.text('Memorandum / objects', PAGE.margin, doc.y);
      doc.moveDown(0.25);
      doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
      doc.text(stripPolicyHtml(policy.summary), PAGE.margin, doc.y, { width: contentW(), align: 'justify' });
      doc.moveDown(0.8);
    }

    if (watermark) {
      doc.save();
      doc.opacity(0.08);
      doc.font('Helvetica', 'bold').fontSize(72).fillColor(PDF_THEME.accent);
      doc.rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] });
      doc.text('DRAFT', 60, PAGE.h / 2 - 20);
      doc.restore();
      doc.opacity(1);
    }

    // Table of contents — always on its own page(s); never mixed with cover or body
    if (displaySections.length > 0) {
      newPage(doc);
      drawRunningHeader(doc, company, policy, logo);

      doc.font('Helvetica', 'bold').fontSize(12).fillColor(PDF_THEME.ink);
      doc.text('Table of contents', PAGE.margin, doc.y);
      doc.moveDown(0.5);

      doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
      for (const s of displaySections) {
        const line = [s.section_number, s.title].filter(Boolean).join('  ') || 'Provision';
        const lineH = doc.heightOfString(line, { width: contentW() - 8 });
        if (doc.y + lineH + 6 > maxContentY()) {
          newPage(doc);
          drawRunningHeader(doc, company, policy, logo);
          doc.font('Helvetica', 'bold').fontSize(12).fillColor(PDF_THEME.ink);
          doc.text('Table of contents (continued)', PAGE.margin, doc.y);
          doc.moveDown(0.5);
          doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
        }
        doc.text(line, PAGE.margin + 4, doc.y, { width: contentW() - 8 });
        doc.y += lineH + 5;
      }
    }

    // Body — always starts on a new page after the table of contents
    if (displaySections.length > 0) {
      newPage(doc);
      drawRunningHeader(doc, company, policy, logo);

      for (const s of displaySections) {
        const bill = parseBillBody(s.body);
        const st = bill?.section_type || 'section';

        renderSectionHeading(doc, s, bill);

        const wroteClauses = renderClauses(doc, s.body, st);
        if (!wroteClauses) {
          const plain = stripPolicyHtml(s.body);
          if (plain) {
            ensureSpace(doc, 36);
            doc.font('Helvetica', 'normal').fontSize(10).fillColor(PDF_THEME.inkSoft);
            doc.text(plain, PAGE.margin, doc.y, { width: contentW(), align: 'justify', lineGap: 3 });
            doc.moveDown(0.4);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (policy.status === 'published' && policy.requires_acknowledgement !== false) {
      ensureSpace(doc, 100);
      if (atPageTop(doc)) drawRunningHeader(doc, company, policy, logo);
      doc.font('Helvetica', 'bold').fontSize(12).fillColor(PDF_THEME.ink);
      doc.text('Acknowledgement', PAGE.margin, doc.y);
      doc.moveDown(0.4);
      doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.inkSoft);
      doc.text(
        'This policy is effective upon publication. Employees must read and electronically acknowledge this document in the company profile portal. Your signature confirms that you have read, understood, and agree to comply with this policy.',
        PAGE.margin,
        doc.y,
        { width: contentW(), align: 'justify', lineGap: 3 }
      );
    }

    stampCommercialPdfFooters(doc, {
      documentTitle: policy.title || 'Policy',
      documentNumber: policy.reference_number || '',
    });

    doc.end();
  });
}

export function mapPolicyRow(row) {
  if (!row) return null;
  return {
    id: get(row, 'id'),
    tenant_id: get(row, 'tenant_id'),
    reference_number: get(row, 'reference_number'),
    title: get(row, 'title'),
    act_or_section: get(row, 'act_or_section'),
    summary: get(row, 'summary'),
    policy_type: get(row, 'policy_type'),
    classification: get(row, 'classification'),
    department_name: get(row, 'department_name'),
    status: get(row, 'status'),
    version: get(row, 'version') != null ? Number(get(row, 'version')) : 0,
    effective_date: get(row, 'effective_date'),
    requires_acknowledgement: get(row, 'requires_acknowledgement') !== false && get(row, 'requires_acknowledgement') !== 0,
    published_at: get(row, 'published_at'),
    published_by_user_id: get(row, 'published_by_user_id'),
    published_by_name: get(row, 'published_by_name'),
    created_by_user_id: get(row, 'created_by_user_id'),
    created_by_name: get(row, 'created_by_name'),
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

export function mapSectionRow(row) {
  if (!row) return null;
  return {
    id: get(row, 'id'),
    policy_id: get(row, 'policy_id'),
    section_number: get(row, 'section_number'),
    title: get(row, 'title'),
    body: get(row, 'body'),
    sort_order: get(row, 'sort_order') != null ? Number(get(row, 'sort_order')) : 0,
  };
}
