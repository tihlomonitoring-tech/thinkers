/**
 * Customer / account statement PDF — layout inspired by professional statements of account
 * (two-party header, balance due, activity table, banking page).
 *
 * **Content tips** (statement `content` field):
 * - First line optional: `Balance due: 278,300.00` → shown in the dark banner.
 * - Activity lines: `11 Jul 2025 Invoice INV-24156 138,000.00 138,000.00` (day Mon YYYY, then text, then amounts).
 * - Opening row: `— Opening balance 0.00`
 * - Optional column header row: `Date Description Debit Credit Balance` (skipped when building the table).
 * - Second page: add a blank line then `Banking details` then bank text.
 */

import { PDF_THEME, formatDate, pdfPageWidth } from './accountingPdfLayout.js';
import { computeStatementLineBalances } from './statementLineBalance.js';

const PAGE = { w: 595.28, h: 841.89, margin: 48, footerTop: 62 };

function formatMoneyDisplay(raw) {
  if (raw == null || raw === '' || raw === '—') return raw === '—' ? '—' : '';
  const s = String(raw).replace(/,/g, '').trim();
  const n = Number(s);
  if (!Number.isNaN(n)) {
    return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(raw);
}

/** Remove "Balance due: …" lines and return display string for the banner */
export function extractBalanceDue(content) {
  const lines = String(content || '').split(/\r?\n/);
  const kept = [];
  let balanceDue = null;
  for (const line of lines) {
    const m = line.match(/^\s*Balance\s+due:?\s*(.+?)\s*$/i);
    if (m) {
      balanceDue = m[1].trim();
      continue;
    }
    kept.push(line);
  }
  return { body: kept.join('\n'), balanceDue };
}

export function splitBankingSection(text) {
  const parts = String(text).split(/\r?\n\s*Banking details\s*\r?\n/i);
  if (parts.length < 2) return { main: String(text).trimEnd(), banking: '' };
  return { main: parts[0].trimEnd(), banking: parts.slice(1).join('\n\n').trim() };
}

function parseTransactionLine(line) {
  const opening = line.match(/^\s*[—–\-]\s*Opening\s+balance\s+([\d,\.]+)\s*$/i);
  if (opening) {
    return { date: '—', description: 'Opening balance', debit: '', credit: '', balance: opening[1] };
  }
  const dm = line.match(/^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+)$/);
  if (!dm) return null;
  const rest = dm[2];
  const nums = rest.match(/[\d,]+\.\d{2}/g);
  const date = dm[1];
  if (!nums || nums.length === 0) {
    return { date, description: rest.trim(), debit: '', credit: '', balance: '' };
  }
  const balance = nums[nums.length - 1];
  let debit = '';
  let credit = '';
  let desc = rest;
  if (nums.length === 1) {
    debit = nums[0];
    const i = rest.lastIndexOf(nums[0]);
    desc = rest.slice(0, i).trim();
  } else if (nums.length === 2) {
    debit = nums[0];
    const iBal = rest.lastIndexOf(nums[1]);
    const beforeBal = rest.slice(0, iBal).trim();
    const iDeb = beforeBal.lastIndexOf(nums[0]);
    desc = beforeBal.slice(0, iDeb).trim();
  } else {
    debit = nums[nums.length - 3];
    credit = nums[nums.length - 2];
    let cut = rest;
    for (let k = 0; k < 3; k++) {
      const n = nums[nums.length - 1 - k];
      const ix = cut.lastIndexOf(n);
      cut = cut.slice(0, ix).trim();
    }
    desc = cut;
  }
  return { date, description: desc, debit, credit, balance };
}

export function extractPreambleAndTableRows(mainText) {
  const lines = mainText.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = String(lines[i]).trim();
    if (!L) continue;
    if (/^Date\s+Description\s+Debit/i.test(L)) {
      start = i + 1;
      break;
    }
    if (parseTransactionLine(L)) {
      start = i;
      break;
    }
  }
  if (start < 0) return { preamble: mainText.trim(), rows: [] };
  const preamble = lines.slice(0, start).join('\n').trim();
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const L = String(lines[i]).trim();
    if (!L) continue;
    if (/^Date\s+Description\s+Debit/i.test(L)) continue;
    const p = parseTransactionLine(L);
    if (p) rows.push(p);
    else if (rows.length > 0) break;
  }
  return { preamble, rows };
}

function drawStatementFooter(doc, company, pageLabel) {
  const w = pdfPageWidth();
  const y0 = PAGE.h - PAGE.footerTop;
  doc.font('Helvetica', 'normal').fontSize(7).fillColor('#64748b');
  let y = y0;
  if (company.website) {
    doc.fillColor(PDF_THEME.accentBar).text(String(company.website), PAGE.margin, y, { width: w, align: 'center' });
    y = doc.y + 3;
  }
  doc.fillColor('#64748b');
  if (company.vat_number) {
    doc.text(`Tax ID: ${company.vat_number}`, PAGE.margin, y, { width: w, align: 'center' });
    y = doc.y + 2;
  }
  if (company.company_registration) {
    doc.text(`Reg: ${company.company_registration}`, PAGE.margin, y, { width: w, align: 'center' });
    y = doc.y + 2;
  }
  doc.fillColor('#94a3b8').text(pageLabel, PAGE.margin, y, { width: w, align: 'center' });
}

function drawColumnBlock(doc, label, lines, x, y, colW) {
  const top = y;
  doc.font('Helvetica', 'bold').fontSize(7).fillColor(PDF_THEME.muted).text(label, x, y, { characterSpacing: 0.4 });
  y = doc.y + 6;
  doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.ink);
  for (const line of lines) {
    if (!line) continue;
    doc.text(String(line), x, y, { width: colW });
    y = doc.y + 3;
  }
  return Math.max(y, top + 22);
}

/**
 * @param {object} statement - DB row (+ customer_* from JOIN)
 * @param {object} company - company settings
 * @param {Buffer|null} logoBuffer
 */
export function renderStatementPdf(doc, statement, company, logoBuffer) {
  const w = pdfPageWidth();
  const gap = 24;
  const colW = (w - gap) / 2;
  let y = PAGE.margin;
  let pageIndex = 1;

  doc.save();
  doc.rect(0, 0, PAGE.w, 4).fill(PDF_THEME.accentBar);
  doc.restore();
  y += 8;

  if (logoBuffer && logoBuffer.length) {
    try {
      doc.image(logoBuffer, PAGE.margin, y, { height: 36, fit: [100, 36] });
      y += 42;
    } catch (_) {}
  }

  const exBal = extractBalanceDue(statement.content || '');
  const { main, banking } = splitBankingSection(exBal.body);
  const structured = Array.isArray(statement.lines) && statement.lines.length > 0;
  let preamble;
  let rows;
  let balanceDue = exBal.balanceDue;
  if (structured) {
    const opening = Number(statement.opening_balance) || 0;
    const comp = computeStatementLineBalances(opening, statement.lines);
    preamble = (statement.preamble || '').trim();
    rows = [];
    rows.push({ date: '—', description: 'Opening balance', debit: '', credit: '', balance: String(opening) });
    for (const l of comp) {
      rows.push({
        date: l.txn_date ? formatDate(l.txn_date) : '',
        description: [l.reference, l.description].filter(Boolean).join(' · ') || '—',
        debit: l.debit != null && Number(l.debit) !== 0 ? String(l.debit) : '',
        credit: l.credit != null && Number(l.credit) !== 0 ? String(l.credit) : '',
        balance: l.balance_after != null ? String(l.balance_after) : '',
      });
    }
    if (!balanceDue && comp.length) balanceDue = String(comp[comp.length - 1].balance_after);
    else if (!balanceDue) balanceDue = String(opening);
  } else {
    const parsed = extractPreambleAndTableRows(main);
    preamble = parsed.preamble;
    rows = parsed.rows;
  }

  const custLines = [];
  if (statement.customer_name) custLines.push(statement.customer_name);
  const ca = statement.customer_address || statement.Customer_Address;
  if (ca) {
    for (const part of String(ca).split(/\n/)) {
      if (part.trim()) custLines.push(part.trim());
    }
  }
  const ce = statement.customer_email || statement.Customer_Email;
  if (ce) custLines.push(String(ce));
  const cp = statement.customer_phone || statement.Customer_Phone;
  if (cp) custLines.push(`Tel: ${cp}`);

  const coLines = [];
  if (company.company_name) coLines.push(company.company_name);
  if (company.address) {
    for (const part of String(company.address).split(/\n/)) {
      if (part.trim()) coLines.push(part.trim());
    }
  }
  if (company.email) coLines.push(String(company.email));
  if (company.website) coLines.push(String(company.website));

  const leftEnd = drawColumnBlock(doc, 'Customer:', custLines.length ? custLines : ['—'], PAGE.margin, y, colW);
  const rightEnd = drawColumnBlock(doc, 'Company:', coLines.length ? coLines : ['—'], PAGE.margin + colW + gap, y, colW);
  y = Math.max(leftEnd, rightEnd) + 20;

  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + w, y).strokeColor(PDF_THEME.line).lineWidth(0.5).stroke();
  y += 14;

  const docTitle = (statement.title && String(statement.title).trim()) || 'Customer statement';
  doc.font('Helvetica', 'bold').fontSize(20).fillColor(PDF_THEME.ink);
  doc.text(docTitle, PAGE.margin, y, { width: w });
  y = doc.y + 10;

  if (balanceDue) {
    const bannerH = 36;
    doc.roundedRect(PAGE.margin, y, w, bannerH, 4);
    doc.fillColor(PDF_THEME.totalBar).fill();
    doc.font('Helvetica', 'bold').fontSize(10).fillColor('#e2e8f0').text('Balance due', PAGE.margin + 16, y + 8);
    doc.font('Helvetica', 'bold').fontSize(16).fillColor('#ffffff').text(formatMoneyDisplay(balanceDue), PAGE.margin + 16, y + 20, { width: w - 32, align: 'right' });
    y += bannerH + 12;
  }

  doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.inkSoft);
  const dateLine = statement.statement_date ? `Date: ${formatDate(statement.statement_date)}` : '';
  if (dateLine) {
    doc.text(dateLine, PAGE.margin, y);
    y = doc.y + 6;
  }
  if (statement.date_from && statement.date_to) {
    doc.text(`Period: ${formatDate(statement.date_from)} – ${formatDate(statement.date_to)}`, PAGE.margin, y);
    y = doc.y + 6;
  }
  if (statement.currency || statement.statement_ref) {
    const bits = [];
    if (statement.statement_ref) bits.push(`Ref: ${statement.statement_ref}`);
    if (statement.currency) bits.push(`Currency: ${statement.currency}`);
    doc.text(bits.join(' · '), PAGE.margin, y);
    y = doc.y + 6;
  }
  y += 4;

  doc.font('Helvetica', 'bold').fontSize(10).fillColor(PDF_THEME.ink).text('Statement of account', PAGE.margin, y);
  y = doc.y + 4;
  doc.font('Helvetica', 'normal').fontSize(8.5).fillColor(PDF_THEME.muted);
  doc.text('Charges (debit) and payments (credit) with running balance.', PAGE.margin, y, { width: w });
  y = doc.y + 12;

  if (preamble) {
    doc.font('Helvetica', 'normal').fontSize(9).fillColor(PDF_THEME.inkSoft).text(preamble, PAGE.margin, y, { width: w });
    y = doc.y + 10;
  }

  const bottomLimit = PAGE.h - PAGE.footerTop - 8;
  const drawTableHeader = (yy) => {
    const cw = [w * 0.13, w * 0.41, w * 0.14, w * 0.14, w * 0.14];
    const hdrH = 20;
    doc.rect(PAGE.margin, yy, w, hdrH).fill(PDF_THEME.tableHead);
    doc.fillColor('#ffffff').font('Helvetica', 'bold').fontSize(7.5);
    let x = PAGE.margin + 6;
    doc.text('Date', x, yy + 6, { width: cw[0] - 4 });
    x += cw[0];
    doc.text('Description', x, yy + 6, { width: cw[1] - 4 });
    x += cw[1];
    doc.text('Debit', x, yy + 6, { width: cw[2] - 6, align: 'right' });
    x += cw[2];
    doc.text('Credit', x, yy + 6, { width: cw[3] - 6, align: 'right' });
    x += cw[3];
    doc.text('Balance', x, yy + 6, { width: cw[4] - 8, align: 'right' });
    return yy + hdrH;
  };

  if (rows.length > 0) {
    y = drawTableHeader(y);
    doc.font('Helvetica', 'normal').fontSize(8).fillColor(PDF_THEME.ink);
    const cw = [w * 0.13, w * 0.41, w * 0.14, w * 0.14, w * 0.14];
    let rowIdx = 0;
    for (const r of rows) {
      const descH = Math.max(14, doc.heightOfString(r.description || '—', { width: cw[1] - 6 }) + 6);
      const rowH = Math.min(descH + 6, 72);
      if (y + rowH > bottomLimit) {
        drawStatementFooter(doc, company, `Page ${pageIndex}`);
        pageIndex += 1;
        doc.addPage();
        y = PAGE.margin;
        doc.font('Helvetica', 'bold').fontSize(9).fillColor(PDF_THEME.muted).text('Statement (continued)', PAGE.margin, y);
        y = doc.y + 10;
        y = drawTableHeader(y);
        doc.font('Helvetica', 'normal').fontSize(8).fillColor(PDF_THEME.ink);
      }
      const fill = rowIdx % 2 === 0 ? PDF_THEME.tableZebra : '#ffffff';
      doc.rect(PAGE.margin, y, w, rowH).fill(fill);
      doc.fillColor(PDF_THEME.ink);
      let rx = PAGE.margin + 6;
      doc.text(r.date || '', rx, y + 4, { width: cw[0] - 4 });
      rx += cw[0];
      doc.text(r.description || '—', rx, y + 4, { width: cw[1] - 6 });
      rx += cw[1];
      doc.text(r.debit ? formatMoneyDisplay(r.debit) : '—', rx, y + 4, { width: cw[2] - 6, align: 'right' });
      rx += cw[2];
      doc.text(r.credit ? formatMoneyDisplay(r.credit) : '—', rx, y + 4, { width: cw[3] - 6, align: 'right' });
      rx += cw[3];
      doc.font('Helvetica', 'bold').text(r.balance ? formatMoneyDisplay(r.balance) : '—', rx, y + 4, { width: cw[4] - 8, align: 'right' });
      doc.font('Helvetica', 'normal');
      doc.moveTo(PAGE.margin, y + rowH).lineTo(PAGE.margin + w, y + rowH).strokeColor(PDF_THEME.line).lineWidth(0.2).stroke();
      y += rowH;
      rowIdx += 1;
    }
  } else {
    doc.font('Helvetica', 'normal').fontSize(9.5).fillColor(PDF_THEME.ink).lineGap(2);
    const fallback = main.trim() || '—';
    doc.text(fallback, PAGE.margin, y, { width: w });
    y = doc.y + 8;
  }

  if (y > bottomLimit - 40 && banking) {
    drawStatementFooter(doc, company, `Page ${pageIndex}`);
    pageIndex += 1;
    doc.addPage();
    y = PAGE.margin;
  } else {
    y += 8;
  }

  if (banking) {
    if (y > PAGE.h - PAGE.footerTop - 120) {
      drawStatementFooter(doc, company, `Page ${pageIndex}`);
      pageIndex += 1;
      doc.addPage();
      y = PAGE.margin;
    }
    doc.font('Helvetica', 'bold').fontSize(11).fillColor(PDF_THEME.ink).text('Banking details', PAGE.margin, y);
    y = doc.y + 10;
    doc.font('Helvetica', 'normal').fontSize(9);
    const bankingH = Math.min(240, doc.heightOfString(banking, { width: w - 24 }) + 28);
    doc.roundedRect(PAGE.margin, y, w, bankingH, 4);
    doc.fillColor('#f8fafc').strokeColor(PDF_THEME.line).lineWidth(0.5).fillAndStroke();
    doc.fillColor(PDF_THEME.ink);
    doc.text(banking, PAGE.margin + 12, y + 12, { width: w - 24, lineGap: 3 });
    y = doc.y + 16;
  }

  drawStatementFooter(doc, company, `Page ${pageIndex}`);
}
