/**
 * Shared styling for accounting PDFs (quotation, invoice, PO, statement).
 * Uses PDFKit built-in fonts only (Helvetica).
 */

export const PDF_THEME = {
  accent: '#7F1D1D', // dark red (brand)
  accentBar: '#991B1B',
  ink: '#111827',
  inkSoft: '#374151',
  muted: '#6b7280',
  line: '#e5e7eb',
  tableHead: '#7F1D1D',
  tableZebra: '#f8fafc',
  panelBg: '#fafafa',
  totalBar: '#7F1D1D',
};

const PAGE = { w: 595.28, h: 841.89, margin: 48 };
/** Keep body content above this Y so stamped footer (doc ref + page numbers) is visible */
const STAMP_ZONE = 46;
const contentMaxY = () => PAGE.h - PAGE.margin - STAMP_ZONE;

export function pdfPageWidth() {
  return PAGE.w - PAGE.margin * 2;
}

export function formatMoney(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '0.00';
  return x.toFixed(2);
}

export function formatDate(d) {
  if (d == null || d === '') return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function lineItemCalc(l) {
  const qty = Number(l.quantity) || 0;
  const up = Number(l.unit_price) || 0;
  const dPct = Number(l.discount_percent) || 0;
  const tPct = Number(l.tax_percent) || 0;
  const lineSub = qty * up;
  const lineDisc = lineSub * (dPct / 100);
  const lineAfterDisc = lineSub - lineDisc;
  const lineTax = lineAfterDisc * (tPct / 100);
  const lineTotal = lineAfterDisc + lineTax;
  return { qty, up, dPct, tPct, lineTotal };
}

function sumLinesSubtotal(lines) {
  let s = 0;
  for (const l of lines || []) s += lineItemCalc(l).lineTotal;
  return s;
}

/** Call after all content, before doc.end(), when doc was created with bufferPages: true */
export function stampCommercialPdfFooters(doc, { documentTitle, documentNumber }) {
  if (!doc.options?.bufferPages) return;
  const { start, count } = doc.bufferedPageRange();
  if (count < 1) return;
  const ref = [String(documentTitle || '').trim(), String(documentNumber || '').trim()].filter(Boolean).join(' ');
  const w = pdfPageWidth();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    const yRef = PAGE.h - PAGE.margin - 22;
    const yPg = PAGE.h - PAGE.margin - 10;
    doc.font('Helvetica', 'normal').fontSize(8).fillColor(PDF_THEME.muted);
    doc.text(ref || 'Document', PAGE.margin, yRef, { width: w, align: 'center' });
    doc.text(`Page ${i + 1} of ${count}`, PAGE.margin, yPg, { width: w, align: 'center' });
  }
  doc.switchToPage(start + count - 1);
}

function defaultClosingMessage(documentTitle) {
  const t = String(documentTitle || '').toLowerCase();
  if (t.includes('purchase')) return 'Thank you for your supply and partnership.';
  if (t.includes('invoice')) return 'Thank you for your business.';
  if (t.includes('quotation')) return 'We appreciate the opportunity to quote.';
  return 'Thank you.';
}

/**
 * Commercial document: quotation / invoice / purchase order
 */
export function renderCommercialPdf(doc, options) {
  const {
    documentTitle,
    documentNumber,
    company,
    logoBuffer,
    metaRows = [],
    partyLabel = 'Bill to',
    partyLines = [],
    lines = [],
    discountPercent = 0,
    taxPercent = 0,
    notes = '',
    totalLabel = 'Total',
    closingMessage,
  } = options;

  const contentW = pdfPageWidth();
  let y = PAGE.margin;

  // Top accent bar
  doc.save();
  doc.rect(0, 0, PAGE.w, 5).fill(PDF_THEME.accentBar);
  doc.restore();
  y = PAGE.margin + 4;

  const colGap = 16;
  const logoSlotW = 156;
  const logoMaxH = 54;
  const issuerTextW = Math.max(120, contentW - logoSlotW - colGap);
  const startHeaderY = y;

  // Top row: company details (left) — logo (far right)
  let issuerY = startHeaderY;
  doc.font('Helvetica', 'bold').fontSize(13).fillColor(PDF_THEME.ink);
  doc.text(company.company_name || 'Company', PAGE.margin, issuerY, { width: issuerTextW });
  issuerY = doc.y + 4;

  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.muted);
  const issuerBits = [];
  if (company.address) issuerBits.push(String(company.address));
  if (company.vat_number) issuerBits.push(`VAT: ${company.vat_number}`);
  if (company.company_registration) issuerBits.push(`Reg: ${company.company_registration}`);
  if (company.email) issuerBits.push(String(company.email));
  if (company.website) issuerBits.push(String(company.website));
  for (const bit of issuerBits) {
    doc.text(bit, PAGE.margin, issuerY, { width: issuerTextW });
    issuerY = doc.y + 2;
  }

  let logoBottom = startHeaderY;
  if (logoBuffer && logoBuffer.length) {
    try {
      const logoX = PAGE.margin + contentW - logoSlotW;
      doc.image(logoBuffer, logoX, startHeaderY, { height: logoMaxH, fit: [logoSlotW, logoMaxH] });
      logoBottom = startHeaderY + logoMaxH;
    } catch (_) {
      /* skip */
    }
  }

  y = Math.max(issuerY, logoBottom) + colGap;

  // Divider under company / logo row
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + contentW, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  y += 14;

  // Second row: Bill to (left) + document panel (right), same baseline
  const partyW = contentW * 0.52;
  const panelW = contentW - partyW - colGap;
  const panelX = PAGE.margin + partyW + colGap;
  const partyTop = y;

  let partyH = 72;
  {
    let simY = partyTop + 24;
    doc.font('Helvetica', 'normal').fontSize(9.5);
    for (const pl of partyLines) {
      if (!pl) continue;
      const h = doc.heightOfString(String(pl), { width: partyW - 20 });
      simY += h + 4;
    }
    partyH = Math.max(72, simY - partyTop + 16);
  }

  let panelInnerH = 12 + 12 + 6 + 14 + 8; // padding + title + gap + number + gap
  doc.font('Helvetica', 'normal').fontSize(8).fillColor(PDF_THEME.inkSoft);
  for (const row of metaRows) {
    if (!row || !row.value) continue;
    const label = String(row.label || '');
    const val = String(row.value || '');
    const line = `${label}: ${val}`;
    panelInnerH += doc.heightOfString(line, { width: panelW - 24 }) + 3;
  }
  panelInnerH += 12;
  const panelContentMinH = Math.max(88, panelInnerH);
  const parallelRowH = Math.max(partyH, panelContentMinH);

  doc.roundedRect(PAGE.margin, partyTop, partyW, parallelRowH, 3);
  doc.fillColor('#fafafa').strokeColor(PDF_THEME.line).lineWidth(0.5).fillAndStroke();
  doc.font('Helvetica', 'bold').fontSize(7).fillColor(PDF_THEME.muted);
  doc.text(String(partyLabel).toUpperCase(), PAGE.margin + 10, partyTop + 10, { characterSpacing: 0.6 });
  let py = partyTop + 24;
  doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.ink);
  for (const pl of partyLines) {
    if (!pl) continue;
    doc.text(String(pl), PAGE.margin + 10, py, { width: partyW - 20 });
    py = doc.y + 2;
  }

  doc.roundedRect(panelX, partyTop, panelW, parallelRowH, 4);
  doc.fillColor(PDF_THEME.panelBg).strokeColor(PDF_THEME.line).lineWidth(0.5).fillAndStroke();
  let panelY = partyTop + 12;
  doc.font('Helvetica', 'bold').fontSize(9).fillColor(PDF_THEME.accent);
  doc.text(String(documentTitle).toUpperCase(), panelX + 12, panelY, { width: panelW - 24 });
  panelY = doc.y + 6;
  doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink);
  doc.text(String(documentNumber != null ? documentNumber : '').trim(), panelX + 12, panelY, { width: panelW - 24 });
  panelY = doc.y + 8;
  const metaStartX = panelX + 12;
  const metaW = panelW - 24;
  for (const row of metaRows) {
    if (!row || !row.value) continue;
    const label = String(row.label || '');
    const val = String(row.value || '');
    const valueInk = label === 'Due date' ? PDF_THEME.ink : PDF_THEME.inkSoft;
    doc.font('Helvetica', 'normal').fontSize(8);
    doc.fillColor(PDF_THEME.muted).text(`${label}: `, metaStartX, panelY, { continued: true, lineBreak: false });
    const remW = Math.max(24, metaStartX + metaW - doc.x);
    doc.fillColor(valueInk).text(val, { width: remW });
    panelY = doc.y + 3;
  }

  y = partyTop + parallelRowH + 16;

  if (notes && String(notes).trim()) {
    doc.font('Helvetica', 'bold').fontSize(8).fillColor(PDF_THEME.muted).text('Notes', PAGE.margin, y);
    y = doc.y + 4;
    doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.inkSoft).text(String(notes).trim(), PAGE.margin, y, {
      width: contentW,
    });
    y = doc.y + 12;
  }

  // Line items table
  const colW = [
    contentW * 0.38,
    contentW * 0.09,
    contentW * 0.13,
    contentW * 0.08,
    contentW * 0.08,
    contentW * 0.14,
  ];
  const headers = ['Description', 'Qty', 'Unit price', 'Disc %', 'VAT %', 'Amount'];

  const tableTop = y;
  const headH = 22;
  doc.rect(PAGE.margin, y, contentW, headH).fill(PDF_THEME.tableHead);
  doc.fillColor('#ffffff').font('Helvetica', 'bold').fontSize(8);
  let hx = PAGE.margin + 8;
  for (let i = 0; i < headers.length; i++) {
    const w = colW[i] - (i === 0 ? 8 : 4);
    const opts = i >= 1 ? { width: w, align: i >= 1 ? 'right' : 'left' } : { width: w };
    doc.text(headers[i], hx, y + 7, opts);
    hx += colW[i];
  }
  y += headH;

  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.ink);
  let rowIdx = 0;
  for (const l of lines || []) {
    const { qty, up, dPct, tPct, lineTotal } = lineItemCalc(l);
    const desc = String(l.description ?? '').trim();
    const textH = Math.max(18, doc.heightOfString(desc || ' ', { width: colW[0] - 12 }) + 8);
    const rowH = Math.min(textH + 4, 120);

    if (y + rowH > contentMaxY()) {
      doc.addPage();
      y = PAGE.margin;
      doc.rect(PAGE.margin, y, contentW, headH).fill(PDF_THEME.tableHead);
      doc.fillColor('#ffffff').font('Helvetica', 'bold').fontSize(8);
      hx = PAGE.margin + 8;
      for (let i = 0; i < headers.length; i++) {
        const w = colW[i] - (i === 0 ? 8 : 4);
        const opts = i >= 1 ? { width: w, align: i >= 1 ? 'right' : 'left' } : { width: w };
        doc.text(headers[i], hx, y + 7, opts);
        hx += colW[i];
      }
      y += headH;
      doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.ink);
    }

    const fill = rowIdx % 2 === 0 ? PDF_THEME.tableZebra : '#ffffff';
    doc.rect(PAGE.margin, y, contentW, rowH).fill(fill);
    doc.fillColor(PDF_THEME.ink);
    doc.text(desc, PAGE.margin + 8, y + 6, { width: colW[0] - 12 });
    const numY = y + 6;
    doc.text(String(qty), PAGE.margin + colW[0] + 4, numY, { width: colW[1] - 8, align: 'right' });
    doc.text(formatMoney(up), PAGE.margin + colW[0] + colW[1] + 4, numY, { width: colW[2] - 8, align: 'right' });
    doc.text(dPct > 0 ? `${dPct}%` : '', PAGE.margin + colW[0] + colW[1] + colW[2] + 4, numY, {
      width: colW[3] - 8,
      align: 'right',
    });
    doc.text(tPct > 0 ? `${tPct}%` : '', PAGE.margin + colW[0] + colW[1] + colW[2] + colW[3] + 4, numY, {
      width: colW[4] - 8,
      align: 'right',
    });
    doc.font('Helvetica', 'bold').text(formatMoney(lineTotal), PAGE.margin + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + 4, numY, {
      width: colW[5] - 12,
      align: 'right',
    });
    doc.font('Helvetica', 'normal');
    doc.moveTo(PAGE.margin, y + rowH).lineTo(PAGE.margin + contentW, y + rowH).strokeColor(PDF_THEME.line).lineWidth(0.25).stroke();
    y += rowH;
    rowIdx += 1;
  }

  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + contentW, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  doc.moveTo(PAGE.margin, tableTop).lineTo(PAGE.margin + contentW, tableTop).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  doc.moveTo(PAGE.margin + contentW, tableTop).lineTo(PAGE.margin + contentW, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  doc.moveTo(PAGE.margin, tableTop).lineTo(PAGE.margin, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();

  y += 16;

  const documentSubtotal = sumLinesSubtotal(lines);
  const discountPct = Number(discountPercent) || 0;
  const taxPct = Number(taxPercent) || 0;
  const discountAmt = documentSubtotal * (discountPct / 100);
  const afterDiscount = documentSubtotal - discountAmt;
  const taxAmt = afterDiscount * (taxPct / 100);
  const total = afterDiscount + taxAmt;

  const totalsW = 200;
  const totalsX = PAGE.margin + contentW - totalsW;

  function totalsRow(label, value, bold = false) {
    doc.font('Helvetica', bold ? 'bold' : 'normal')
      .fontSize(9)
      .fillColor(PDF_THEME.inkSoft);
    doc.text(label, totalsX, y, { width: totalsW * 0.55 });
    doc.text(value, totalsX + totalsW * 0.5, y, { width: totalsW * 0.45, align: 'right' });
    y += 14;
  }

  totalsRow('Subtotal', formatMoney(documentSubtotal));
  if (discountPct > 0) totalsRow(`Document discount (${discountPct}%)`, `−${formatMoney(discountAmt)}`);
  if (taxPct > 0) totalsRow(`VAT (${taxPct}%)`, formatMoney(taxAmt));

  y += 4;
  doc.roundedRect(totalsX - 8, y - 4, totalsW + 16, 26, 3).fill(PDF_THEME.totalBar);
  doc.font('Helvetica', 'bold').fontSize(11).fillColor('#ffffff');
  doc.text(totalLabel, totalsX, y + 4, { width: totalsW * 0.55 });
  doc.text(formatMoney(total), totalsX + totalsW * 0.5, y + 4, { width: totalsW * 0.45, align: 'right' });
  y += 32;

  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.inkSoft);
  const thanks = closingMessage != null && String(closingMessage).trim() !== '' ? String(closingMessage).trim() : defaultClosingMessage(documentTitle);
  const pt = company.payment_terms != null ? String(company.payment_terms).trim() : '';
  const bk = company.banking_details != null ? String(company.banking_details).trim() : '';

  const estClosing =
    (pt ? 28 + doc.heightOfString(pt, { width: contentW }) : 0) +
    (bk ? 28 + doc.heightOfString(bk, { width: contentW }) : 0) +
    28;
  if (y + estClosing > contentMaxY()) {
    doc.addPage();
    y = PAGE.margin;
  }

  if (pt) {
    doc.font('Helvetica', 'bold').fontSize(8).fillColor(PDF_THEME.muted).text('Payment terms', PAGE.margin, y);
    y = doc.y + 4;
    doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.inkSoft).text(pt, PAGE.margin, y, { width: contentW, lineGap: 2 });
    y = doc.y + 12;
  }
  if (bk) {
    doc.font('Helvetica', 'bold').fontSize(8).fillColor(PDF_THEME.muted).text('Banking details', PAGE.margin, y);
    y = doc.y + 4;
    doc.font('Helvetica', 'normal').fontSize(8.5);
    const bankingBoxH = Math.min(200, doc.heightOfString(bk, { width: contentW - 16 }) + 20);
    const boxTop = y;
    doc.roundedRect(PAGE.margin, boxTop, contentW, bankingBoxH, 3);
    doc.fillColor('#f8fafc').strokeColor(PDF_THEME.line).lineWidth(0.4).fillAndStroke();
    doc.fillColor(PDF_THEME.inkSoft);
    doc.text(bk, PAGE.margin + 8, boxTop + 8, { width: contentW - 16, lineGap: 2 });
    y = boxTop + bankingBoxH + 12;
  }

  if (y + 24 > contentMaxY()) {
    doc.addPage();
    y = PAGE.margin;
  }
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(PDF_THEME.accent).text(thanks, PAGE.margin, y, { width: contentW, align: 'center' });
}
