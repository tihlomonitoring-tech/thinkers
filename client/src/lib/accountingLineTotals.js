/**
 * Client mirror of src/lib/accountingLineTotals.js — keep in sync.
 */

export function descriptionImpliesVatIncluded(description) {
  return /\b(vat|tax)\s*(included|incl\.?|inclusive)\b/i.test(String(description || ''));
}

export function computeLineItem(l) {
  const qty = Number(l.quantity) || 0;
  const up = Number(l.unit_price) || 0;
  const dPct = Number(l.discount_percent) || 0;
  const tPct = descriptionImpliesVatIncluded(l.description) ? 0 : Number(l.tax_percent) || 0;
  const lineSub = qty * up;
  const lineDisc = lineSub * (dPct / 100);
  const lineNet = lineSub - lineDisc;
  const lineTax = lineNet * (tPct / 100);
  const lineTotalInc = lineNet + lineTax;
  return { qty, up, dPct, tPct, lineNet, lineTax, lineTotalInc };
}

export function computeDocumentTotals(lines, documentDiscountPercent = 0, documentTaxPercent = 0) {
  const items = (lines || []).map(computeLineItem);
  const subtotalExVat = items.reduce((s, x) => s + x.lineNet, 0);
  const lineVatTotal = items.reduce((s, x) => s + x.lineTax, 0);
  const anyLineHasVat = items.some((x) => x.tPct > 0);

  const docDiscPct = Number(documentDiscountPercent) || 0;
  const docDiscAmt = subtotalExVat * (docDiscPct / 100);
  const afterDocDiscExVat = subtotalExVat - docDiscAmt;

  let vatAmount = 0;
  let vatLabel = 'VAT';
  if (anyLineHasVat) {
    vatAmount = lineVatTotal;
  } else {
    const docTaxPct = Number(documentTaxPercent) || 0;
    if (docTaxPct > 0) {
      vatAmount = afterDocDiscExVat * (docTaxPct / 100);
      vatLabel = `VAT (${docTaxPct}%)`;
    }
  }

  const total = afterDocDiscExVat + vatAmount;

  return {
    items,
    subtotalExVat,
    lineVatTotal,
    anyLineHasVat,
    documentDiscountPercent: docDiscPct,
    documentDiscountAmount: docDiscAmt,
    afterDocumentDiscountExVat: afterDocDiscExVat,
    vatAmount,
    vatLabel,
    total,
  };
}

export function formatZar(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 'R 0.00';
  const abs = Math.abs(x);
  const formatted = abs.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return x < 0 ? `−R ${formatted}` : `R ${formatted}`;
}

export function formatZarDisplay(raw) {
  if (raw == null || raw === '' || raw === '—') return raw === '—' ? '—' : '';
  const s = String(raw).replace(/,/g, '').trim();
  if (/^R\s/i.test(s)) return s;
  const n = Number(s);
  if (!Number.isNaN(n)) return formatZar(n);
  return String(raw);
}
