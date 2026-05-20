/**
 * Running balance for customer statements (debit increases balance owed, credit decreases).
 */

export function computeStatementLineBalances(openingBalance, linesIn) {
  const lines = Array.isArray(linesIn) ? linesIn : [];
  let bal = Number(openingBalance) || 0;
  return lines.map((l, idx) => {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    bal += debit - credit;
    return {
      ...l,
      sort_order: idx,
      balance_after: Math.round(bal * 100) / 100,
    };
  });
}

import { computeDocumentTotals } from './accountingLineTotals.js';

/** Invoice grand total (per-line VAT; document VAT % only when no line has VAT %). */
export function invoiceGrandTotal(inv, lines) {
  const t = computeDocumentTotals(lines, inv?.discount_percent, inv?.tax_percent);
  return Math.round(t.total * 100) / 100;
}
