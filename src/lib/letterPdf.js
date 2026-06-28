/**
 * Server-side PDF generator for Letter composition.
 * PDFKit only (built-in fonts). Produces a professional, corporate letter with
 * a selectable template design, auto-aligned letterhead pulled from Accounting,
 * intelligent paragraph flow with automatic page breaks, drawn signature,
 * optional policy references, and a stamped footer (document reference +
 * "Page X of Y") on every page.
 */
import PDFDocument from 'pdfkit';
import { embedPdfLogo, stampCommercialPdfFooters } from './accountingPdfLayout.js';
import { letterTypeLabel, accentHexById } from './letterTypes.js';

const PAGE = { w: 595.28, h: 841.89, margin: 56 };
const STAMP_ZONE = 46;
const contentMaxY = () => PAGE.h - PAGE.margin - STAMP_ZONE;

const TEMPLATES = {
  executive: { accent: '#1e3a8a', serif: false, headerStyle: 'sidebar' },
  modern: { accent: '#0f766e', serif: false, headerStyle: 'band' },
  classic: { accent: '#7c2d12', serif: true, headerStyle: 'centered' },
  minimal: { accent: '#334155', serif: false, headerStyle: 'minimal' },
};

const INK = '#111827';
const INK_SOFT = '#374151';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

function safe(v) {
  return v == null ? '' : String(v);
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return safe(d);
    return dt.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return safe(d);
  }
}

/** Parse stored policy_refs (JSON array) safely. */
export function parsePolicyRefs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Parse stored sections (used when caller passes JSON instead of rows). */
export function parseSections(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function buildLetterPdfBuffer({
  letter = {},
  sections = [],
  company = {},
  logoBuffer = null,
  logoPath = null,
  watermark = null,
} = {}) {
  return new Promise((resolve, reject) => {
    try {
      const tpl = TEMPLATES[letter.template_key] || TEMPLATES.executive;
      // accent_color may be a hex string OR a named-accent id (e.g. "navy").
      const rawAccent = safe(letter.accent_color).trim();
      let accent = tpl.accent;
      if (/^#?[0-9a-f]{6}$/i.test(rawAccent)) {
        accent = rawAccent.startsWith('#') ? rawAccent : `#${rawAccent}`;
      } else if (rawAccent) {
        accent = accentHexById(rawAccent);
      }
      const bodyFont = tpl.serif ? 'Times-Roman' : 'Helvetica';
      const bodyBold = tpl.serif ? 'Times-Bold' : 'Helvetica-Bold';
      const bodyItalic = tpl.serif ? 'Times-Italic' : 'Helvetica-Oblique';
      const headFont = tpl.serif ? 'Times-Bold' : 'Helvetica-Bold';

      // Reserve the footer stamp zone in the bottom margin so PDFKit's automatic
      // pagination breaks BEFORE the "Page X of Y" band — preventing body text or
      // signatures from overlapping the page numbers.
      const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        margins: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + STAMP_ZONE },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const contentW = PAGE.w - PAGE.margin * 2;
      const leftEdge = PAGE.margin;
      let y = PAGE.margin;

      // For executive template we draw a vertical accent rule on every page.
      const drawSideRule = () => {
        if (tpl.headerStyle !== 'sidebar') return;
        doc.save();
        doc.rect(0, 0, 8, PAGE.h).fill(accent);
        doc.restore();
      };
      drawSideRule();
      doc.on('pageAdded', drawSideRule);

      const ensureSpace = (needed) => {
        if (y + needed > contentMaxY()) {
          doc.addPage();
          y = PAGE.margin;
        }
      };

      // --- Letterhead ---------------------------------------------------
      const companyName = safe(company.company_name) || 'Company';
      const addressLines = safe(company.address).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // Letterhead intentionally omits website and VAT number (per requirement).
      const contactBits = [];
      if (company.email) contactBits.push(safe(company.email));
      const regBits = [];
      if (company.company_registration) regBits.push(`Reg: ${safe(company.company_registration)}`);

      const headerStyle = tpl.headerStyle;
      const logoMaxH = 56;
      const logoSlotW = 150;

      if (headerStyle === 'band') {
        doc.save();
        doc.rect(0, 0, PAGE.w, 6).fill(accent);
        doc.restore();
        y = PAGE.margin;
      }

      const centered = headerStyle === 'centered';
      const headerAlign = centered ? 'center' : 'left';
      const headerX = leftEdge;
      const headerW = centered ? contentW : Math.max(160, contentW - logoSlotW - 16);

      // Logo (top-right for left-aligned headers, centered above name for classic)
      let logoBottom = y;
      const hasLogo = !!(logoPath || (logoBuffer && logoBuffer.length));
      if (hasLogo && centered) {
        const placed = embedPdfLogo(doc, { logoBuffer, logoPath }, (PAGE.w - logoMaxH * 2.2) / 2, y, logoMaxH * 2.2, logoMaxH);
        if (placed) y += logoMaxH + 8;
      } else if (hasLogo) {
        embedPdfLogo(doc, { logoBuffer, logoPath }, leftEdge + contentW - logoSlotW, y, logoSlotW, logoMaxH);
        logoBottom = y + logoMaxH;
      }

      const nameSize = headerStyle === 'minimal' ? 15 : 19;
      doc.font(headFont).fontSize(nameSize).fillColor(headerStyle === 'minimal' ? INK : accent);
      doc.text(companyName, headerX, y, { width: headerW, align: headerAlign });
      let headBottom = doc.y + 3;

      doc.font(bodyFont).fontSize(8.5).fillColor(MUTED);
      for (const ln of addressLines) {
        doc.text(ln, headerX, headBottom, { width: headerW, align: headerAlign });
        headBottom = doc.y + 1;
      }
      if (contactBits.length) {
        doc.text(contactBits.join('   ·   '), headerX, headBottom, { width: headerW, align: headerAlign });
        headBottom = doc.y + 1;
      }
      if (regBits.length) {
        doc.text(regBits.join('   ·   '), headerX, headBottom, { width: headerW, align: headerAlign });
        headBottom = doc.y + 1;
      }

      y = Math.max(headBottom, logoBottom) + 12;

      // Divider rule under the letterhead
      if (headerStyle !== 'minimal') {
        doc.moveTo(leftEdge, y).lineTo(leftEdge + contentW, y).strokeColor(headerStyle === 'centered' ? accent : LINE).lineWidth(headerStyle === 'centered' ? 1.2 : 0.6).stroke();
        y += 18;
      } else {
        y += 8;
      }

      // --- Date + reference line ---------------------------------------
      doc.font(bodyFont).fontSize(10).fillColor(INK_SOFT);
      const dateStr = fmtDate(letter.letter_date) || fmtDate(new Date());
      doc.text(dateStr, leftEdge, y, { width: contentW, align: centered ? 'left' : 'left' });
      y = doc.y + 6;

      const refLabel = safe(letter.reference_number);
      if (refLabel) {
        doc.font(bodyFont).fontSize(9).fillColor(MUTED).text(`Our ref: ${refLabel}`, leftEdge, y, { width: contentW });
        y = doc.y + 10;
      }

      // --- Recipient block ---------------------------------------------
      const recLines = [
        safe(letter.recipient_name),
        safe(letter.recipient_title),
        safe(letter.recipient_company),
        ...safe(letter.recipient_address).split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      ].filter(Boolean);
      if (recLines.length) {
        doc.font(bodyFont).fontSize(10).fillColor(INK);
        for (const ln of recLines) {
          ensureSpace(16);
          doc.text(ln, leftEdge, y, { width: contentW });
          y = doc.y + 1;
        }
        y += 12;
      }

      // --- Subject (Re:) ------------------------------------------------
      const subject = safe(letter.title);
      if (subject) {
        ensureSpace(24);
        doc.font(bodyBold).fontSize(11).fillColor(INK);
        const label = `RE: ${subject.toUpperCase()}`;
        doc.text(label, leftEdge, y, { width: contentW });
        // underline accent
        const lineY = doc.y + 2;
        doc.moveTo(leftEdge, lineY).lineTo(leftEdge + Math.min(contentW, doc.widthOfString(label) + 4), lineY).strokeColor(accent).lineWidth(1).stroke();
        y = lineY + 12;
      }

      // --- Helpers for flowing text ------------------------------------
      const paragraph = (text, opts = {}) => {
        const str = safe(text).trim();
        if (!str) return;
        const font = opts.bold ? bodyBold : opts.italic ? bodyItalic : bodyFont;
        const size = opts.size || 10.5;
        const align = opts.align || 'justify';
        const gap = opts.gap == null ? 12 : opts.gap;
        // Render paragraph-by-paragraph so blank lines create spacing and page breaks land cleanly.
        const blocks = str.split(/\n{2,}/);
        for (const block of blocks) {
          const piece = block.replace(/\n/g, ' ').trim();
          if (!piece) continue;
          doc.font(font).fontSize(size).fillColor(opts.color || INK_SOFT);
          const h = doc.heightOfString(piece, { width: contentW, align, lineGap: 2 });
          ensureSpace(Math.min(h, 80) + 4);
          doc.text(piece, leftEdge, y, { width: contentW, align, lineGap: 2 });
          y = doc.y + gap;
        }
      };

      const sectionHeading = (n, text) => {
        const str = safe(text).trim();
        if (!str) return;
        ensureSpace(30);
        doc.font(headFont).fontSize(10.5).fillColor(accent);
        const label = n ? `${n}.  ${str}` : str;
        doc.text(label, leftEdge, y, { width: contentW });
        y = doc.y + 5;
      };

      // --- Intro / opening ---------------------------------------------
      paragraph(letter.intro_body);

      // --- Custom sections ---------------------------------------------
      const cleanSections = (Array.isArray(sections) ? sections : [])
        .map((s, i) => ({ heading: safe(s.heading), body: safe(s.body), sort_order: s.sort_order ?? i }))
        .filter((s) => s.heading.trim() || s.body.trim())
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      cleanSections.forEach((s, idx) => {
        sectionHeading(cleanSections.length > 1 ? idx + 1 : '', s.heading);
        paragraph(s.body);
      });

      // --- Policy references (warnings etc.) ---------------------------
      const policyRefs = parsePolicyRefs(letter.policy_refs);
      if (policyRefs.length) {
        ensureSpace(40);
        sectionHeading('', 'Applicable company policies');
        doc.font(bodyFont).fontSize(9.5).fillColor(INK_SOFT);
        for (const p of policyRefs) {
          const bits = [safe(p.reference_number), safe(p.title)].filter(Boolean).join(' — ');
          if (!bits) continue;
          ensureSpace(16);
          doc.text(`•  ${bits}`, leftEdge + 6, y, { width: contentW - 6 });
          y = doc.y + 3;
        }
        y += 8;
      }

      // --- Closing ------------------------------------------------------
      paragraph(letter.closing_text || 'Yours faithfully,', { gap: 6 });

      // --- Signature ----------------------------------------------------
      const sig = safe(letter.signature_data_url);
      if (sig.startsWith('data:image')) {
        try {
          const base64 = sig.split(',')[1];
          if (base64) {
            const imgBuf = Buffer.from(base64, 'base64');
            ensureSpace(48);
            y += 6;
            doc.image(imgBuf, leftEdge, y, { fit: [150, 46] });
            y += 44;
          }
        } catch {
          /* ignore bad signature image */
        }
      } else {
        y += 24;
      }

      ensureSpace(36);
      doc.moveTo(leftEdge, y).lineTo(leftEdge + 180, y).strokeColor('#9ca3af').lineWidth(0.6).stroke();
      y += 4;
      if (letter.signatory_name) {
        doc.font(bodyBold).fontSize(10).fillColor(INK).text(safe(letter.signatory_name), leftEdge, y, { width: contentW });
        y = doc.y + 1;
      }
      if (letter.signatory_title) {
        doc.font(bodyFont).fontSize(9.5).fillColor(MUTED).text(safe(letter.signatory_title), leftEdge, y, { width: contentW });
        y = doc.y + 1;
      }
      if (companyName) {
        doc.font(bodyFont).fontSize(9.5).fillColor(MUTED).text(companyName, leftEdge, y, { width: contentW });
        y = doc.y + 1;
      }

      // --- Watermark (drafts) ------------------------------------------
      if (watermark) {
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(range.start + i);
          doc.save();
          doc.rotate(-45, { origin: [PAGE.w / 2, PAGE.h / 2] });
          doc.font('Helvetica-Bold').fontSize(96).fillColor('#000000').opacity(0.06);
          doc.text(String(watermark).toUpperCase(), 0, PAGE.h / 2 - 60, { width: PAGE.w, align: 'center' });
          doc.opacity(1).restore();
        }
      }

      // --- Footer: doc reference + page numbers ------------------------
      // The body uses an enlarged bottom margin (PAGE.margin + STAMP_ZONE) so text
      // auto-paginates ABOVE the footer. The footer itself is stamped inside that
      // reserved zone, so we drop each page's bottom margin to 0 first — otherwise
      // PDFKit treats the footer text as overflow and pushes it onto a new page.
      {
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(range.start + i);
          doc.page.margins.bottom = 0;
        }
      }
      stampCommercialPdfFooters(doc, {
        documentTitle: letterTypeLabel(letter.letter_type),
        documentNumber: letter.reference_number,
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Map a DB letters row + section rows to a normalized object for the PDF. */
export function mapLetterRow(row) {
  if (!row) return null;
  const get = (k) => {
    const lower = k.toLowerCase();
    const entry = Object.entries(row).find(([kk]) => kk && String(kk).toLowerCase() === lower);
    return entry ? entry[1] : undefined;
  };
  return {
    id: get('id'),
    tenant_id: get('tenant_id'),
    reference_number: get('reference_number'),
    letter_type: get('letter_type'),
    title: get('title'),
    status: get('status'),
    template_key: get('template_key'),
    accent_color: get('accent_color'),
    recipient_name: get('recipient_name'),
    recipient_title: get('recipient_title'),
    recipient_company: get('recipient_company'),
    recipient_address: get('recipient_address'),
    recipient_email: get('recipient_email'),
    letter_date: get('letter_date'),
    reference_line: get('reference_line'),
    intro_body: get('intro_body'),
    closing_text: get('closing_text'),
    signatory_name: get('signatory_name'),
    signatory_title: get('signatory_title'),
    signature_data_url: get('signature_data_url'),
    policy_refs: get('policy_refs'),
    created_by_user_id: get('created_by_user_id'),
    created_at: get('created_at'),
    updated_at: get('updated_at'),
  };
}
