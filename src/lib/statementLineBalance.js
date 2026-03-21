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

/** Invoice total (line totals + document discount % + tax % on document). */
export function invoiceGrandTotal(inv, lines) {
  let s = 0;
  for (const l of lines || []) {
    const qty = Number(l.quantity) || 0;
    const up = Number(l.unit_price) || 0;
    const dPct = Number(l.discount_percent) || 0;
    const tPct = Number(l.tax_percent) || 0;
    const lineSub = qty * up;
    const lineDisc = lineSub * (dPct / 100);
    const lineAfterDisc = lineSub - lineDisc;
    const lineTax = lineAfterDisc * (tPct / 100);
    s += lineAfterDisc + lineTax;
  }
  const discountPct = Number(inv.discount_percent) || 0;
  const taxPct = Number(inv.tax_percent) || 0;
  const discountAmt = s * (discountPct / 100);
  const afterDiscount = s - discountAmt;
  const taxAmt = afterDiscount * (taxPct / 100);
  return Math.round((afterDiscount + taxAmt) * 100) / 100;
}
