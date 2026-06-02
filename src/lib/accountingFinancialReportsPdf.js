import PDFDocument from 'pdfkit';
import { PDF_THEME, stampCommercialPdfFooters, formatZar, pdfPageWidth } from './accountingPdfLayout.js';

const PAGE = { margin: 48 };

function companyHeader(doc, company, title, periodLabel) {
  const w = pdfPageWidth();
  doc.font('Helvetica-Bold').fontSize(16).fillColor(PDF_THEME.accent).text(company?.company_name || 'Company', PAGE.margin, PAGE.margin);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(PDF_THEME.ink).text(title, PAGE.margin, PAGE.margin + 22);
  doc.font('Helvetica').fontSize(9).fillColor(PDF_THEME.muted).text(periodLabel || '', PAGE.margin, PAGE.margin + 40);
  doc.moveTo(PAGE.margin, PAGE.margin + 54).lineTo(PAGE.margin + w, PAGE.margin + 54).strokeColor(PDF_THEME.line).stroke();
  return PAGE.margin + 64;
}

function tableHeader(doc, y, cols) {
  const w = pdfPageWidth();
  doc.rect(PAGE.margin, y, w, 20).fill(PDF_THEME.tableHead);
  let x = PAGE.margin + 6;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  for (const c of cols) {
    doc.text(c.label, x, y + 6, { width: c.width, align: c.align || 'left' });
    x += c.width;
  }
  return y + 22;
}

export function renderTrialBalancePdf(doc, { company, from, to, rows }) {
  const period = from && to ? `Period: ${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : 'All dates';
  let y = companyHeader(doc, company, 'Trial balance', period);
  const cols = [
    { label: 'Code', width: 52 },
    { label: 'Account', width: 160 },
    { label: 'Class', width: 72 },
    { label: 'Debit', width: 80, align: 'right' },
    { label: 'Credit', width: 80, align: 'right' },
    { label: 'Balance', width: 80, align: 'right' },
  ];
  y = tableHeader(doc, y, cols);
  let tDebit = 0;
  let tCredit = 0;
  doc.font('Helvetica').fontSize(8).fillColor(PDF_THEME.ink);
  for (const row of rows || []) {
    if (y > 720) {
      doc.addPage();
      y = PAGE.margin;
    }
    const zebra = rows.indexOf(row) % 2 === 1;
    if (zebra) doc.rect(PAGE.margin, y, pdfPageWidth(), 16).fill(PDF_THEME.tableZebra);
    let x = PAGE.margin + 6;
    const cells = [
      row.account_code,
      row.account_name,
      row.account_class,
      formatZar(row.total_debit),
      formatZar(row.total_credit),
      formatZar(row.balance),
    ];
    cols.forEach((c, i) => {
      doc.fillColor(PDF_THEME.ink).text(String(cells[i] ?? ''), x, y + 4, { width: c.width, align: c.align || 'left' });
      x += c.width;
    });
    tDebit += Number(row.total_debit) || 0;
    tCredit += Number(row.total_credit) || 0;
    y += 16;
  }
  y += 8;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_THEME.ink);
  doc.text(`Totals — Debit: ${formatZar(tDebit)}   Credit: ${formatZar(tCredit)}`, PAGE.margin, y);
  stampCommercialPdfFooters(doc, { documentTitle: 'Trial balance', documentNumber: period });
}

export function renderProfitLossPdf(doc, { company, from, to, report }) {
  const period = from && to ? `Period: ${from} to ${to}` : 'All dates';
  let y = companyHeader(doc, company, 'Statement of comprehensive income (Profit & Loss)', period);
  const w = pdfPageWidth();

  const section = (title, items, totalLabel, totalVal) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_THEME.accent).text(title, PAGE.margin, y);
    y += 16;
    for (const row of items || []) {
      if (y > 720) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc.font('Helvetica').fontSize(9).fillColor(PDF_THEME.ink);
      doc.text(`${row.account_code} — ${row.account_name}`, PAGE.margin, y, { width: w * 0.65 });
      doc.text(formatZar(row.balance), PAGE.margin + w * 0.65, y, { width: w * 0.35, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_THEME.ink);
    doc.text(`${totalLabel}: ${formatZar(totalVal)}`, PAGE.margin, y, { width: w, align: 'right' });
    y += 22;
  };

  section('Income', report.income, 'Total income', report.totalIncome);
  section('Expenses', report.expenses, 'Total expenses', report.totalExpenses);
  doc.rect(PAGE.margin, y, w, 24).fill(PDF_THEME.totalBar);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff');
  doc.text(`Net profit / (loss): ${formatZar(report.netProfit)}`, PAGE.margin + 8, y + 7, { width: w - 16 });
  stampCommercialPdfFooters(doc, { documentTitle: 'Profit and Loss', documentNumber: period });
}

export function renderAccountLedgerPdf(doc, { company, from, to, ledger }) {
  const acct = ledger.account;
  const period = from && to ? `Period: ${from} to ${to}` : 'All dates';
  let y = companyHeader(doc, company, `Account statement — ${acct?.account_code} ${acct?.account_name}`, period);
  const cols = [
    { label: 'Date', width: 72 },
    { label: 'Journal', width: 64 },
    { label: 'Description', width: 180 },
    { label: 'Debit', width: 72, align: 'right' },
    { label: 'Credit', width: 72, align: 'right' },
    { label: 'Balance', width: 72, align: 'right' },
  ];
  y = tableHeader(doc, y, cols);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_THEME.ink);
  for (const row of ledger.lines || []) {
    if (y > 720) {
      doc.addPage();
      y = PAGE.margin;
    }
    let x = PAGE.margin + 6;
    const dateStr = row.entry_date ? String(row.entry_date).slice(0, 10) : '';
    const cells = [dateStr, row.journal_number, row.line_description || row.journal_description, formatZar(row.debit), formatZar(row.credit), formatZar(row.running_balance)];
    cols.forEach((c, i) => {
      doc.text(String(cells[i] ?? ''), x, y + 4, { width: c.width, align: c.align || 'left' });
      x += c.width;
    });
    y += 14;
  }
  stampCommercialPdfFooters(doc, { documentTitle: 'Account statement', documentNumber: acct?.account_code });
}

export function renderGeneralLedgerPdf(doc, { company, from, to, lines, summary }) {
  const period = from && to ? `Period: ${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : 'All dates';
  let y = companyHeader(doc, company, 'General ledger', period);
  const cols = [
    { label: 'Date', width: 58 },
    { label: 'Journal', width: 52 },
    { label: 'Account', width: 130 },
    { label: 'Description', width: 120 },
    { label: 'Debit', width: 68, align: 'right' },
    { label: 'Credit', width: 68, align: 'right' },
  ];
  y = tableHeader(doc, y, cols);
  doc.font('Helvetica').fontSize(7).fillColor(PDF_THEME.ink);
  for (const row of lines || []) {
    if (y > 720) {
      doc.addPage();
      y = PAGE.margin;
    }
    let x = PAGE.margin + 4;
    const dateStr = row.entry_date ? String(row.entry_date).slice(0, 10) : '';
    const acct = `${row.account_code || ''} ${row.account_name || ''}`.trim();
    const cells = [
      dateStr,
      row.journal_number,
      acct,
      row.line_description || row.journal_description,
      formatZar(row.debit),
      formatZar(row.credit),
    ];
    cols.forEach((c, i) => {
      doc.text(String(cells[i] ?? ''), x, y + 3, { width: c.width, align: c.align || 'left' });
      x += c.width;
    });
    y += 13;
  }
  y += 6;
  if (summary) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_THEME.ink);
    doc.text(
      `Period totals — Debit: ${formatZar(summary.total_debit)}   Credit: ${formatZar(summary.total_credit)}`,
      PAGE.margin,
      y
    );
  }
  stampCommercialPdfFooters(doc, { documentTitle: 'General ledger', documentNumber: period });
}

export function pdfBuffer(renderFn, options) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      renderFn(doc, options);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
