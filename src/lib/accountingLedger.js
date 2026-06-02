import { query } from '../db.js';
import { computeDocumentTotals } from './accountingLineTotals.js';
import { toYmdFromDbOrString } from './appTime.js';

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Bank — Operating', class: 'asset', subtype: 'bank', normal: 'debit', sort: 10 },
  { code: '1100', name: 'Accounts receivable', class: 'asset', subtype: 'accounts_receivable', normal: 'debit', sort: 20 },
  { code: '2000', name: 'Accounts payable', class: 'liability', subtype: 'accounts_payable', normal: 'credit', sort: 30 },
  { code: '2100', name: 'VAT output (payable)', class: 'liability', subtype: 'vat_output', normal: 'credit', sort: 40 },
  { code: '2200', name: 'VAT input (recoverable)', class: 'asset', subtype: 'vat_input', normal: 'debit', sort: 50 },
  { code: '3000', name: 'Retained earnings', class: 'equity', subtype: 'retained_earnings', normal: 'credit', sort: 60 },
  { code: '4000', name: 'Sales revenue', class: 'income', subtype: 'sales_revenue', normal: 'credit', sort: 70 },
  { code: '4100', name: 'Other income', class: 'income', subtype: 'other_income', normal: 'credit', sort: 80 },
  { code: '5000', name: 'Operating expenses', class: 'expense', subtype: 'operating_expense', normal: 'debit', sort: 90 },
  { code: '5100', name: 'Cost of sales', class: 'expense', subtype: 'cost_of_sales', normal: 'debit', sort: 100 },
];

export async function nextJournalNumber(tenantId) {
  const r = await query(
    `MERGE accounting_journal_counter AS t USING (SELECT @tid AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { tid: tenantId }
  );
  const n = r.recordset?.[0]?.last_number || 1;
  return `JE-${String(n).padStart(5, '0')}`;
}

export async function ensureDefaultAccounts(tenantId) {
  const existing = await query(`SELECT COUNT(*) AS c FROM accounting_account_types WHERE tenant_id = @tid`, { tid: tenantId });
  if ((existing.recordset?.[0]?.c || 0) > 0) return;

  const ids = {};
  for (const a of DEFAULT_ACCOUNTS) {
    const ins = await query(
      `INSERT INTO accounting_account_types (tenant_id, account_code, account_name, account_class, account_subtype, normal_balance, is_system, sort_order)
       OUTPUT INSERTED.id VALUES (@tid, @code, @name, @class, @subtype, @normal, 1, @sort)`,
      {
        tid: tenantId,
        code: a.code,
        name: a.name,
        class: a.class,
        subtype: a.subtype,
        normal: a.normal,
        sort: a.sort,
      }
    );
    if (a.subtype) ids[a.subtype] = ins.recordset?.[0]?.id;
  }

  await query(
    `INSERT INTO accounting_account_defaults (tenant_id, bank_account_id, accounts_receivable_id, sales_revenue_id, accounts_payable_id, default_expense_account_id, default_income_account_id, vat_output_account_id, vat_input_account_id)
     VALUES (@tid, @bank, @ar, @rev, @ap, @exp, @inc, @vatOut, @vatIn)`,
    {
      tid: tenantId,
      bank: ids.bank || null,
      ar: ids.accounts_receivable || null,
      rev: ids.sales_revenue || null,
      ap: ids.accounts_payable || null,
      exp: ids.operating_expense || null,
      inc: ids.other_income || null,
      vatOut: ids.vat_output || null,
      vatIn: ids.vat_input || null,
    }
  );
}

export async function getAccountDefaults(tenantId) {
  await ensureDefaultAccounts(tenantId);
  const r = await query(`SELECT * FROM accounting_account_defaults WHERE tenant_id = @tid`, { tid: tenantId });
  return r.recordset?.[0] || {};
}

export async function getAccountById(tenantId, accountId) {
  const r = await query(
    `SELECT * FROM accounting_account_types WHERE id = @id AND tenant_id = @tid AND is_active = 1`,
    { id: accountId, tid: tenantId }
  );
  return r.recordset?.[0] || null;
}

export async function getAccountBySubtype(tenantId, subtype) {
  const r = await query(
    `SELECT TOP 1 * FROM accounting_account_types WHERE tenant_id = @tid AND account_subtype = @subtype AND is_active = 1 ORDER BY sort_order`,
    { tid: tenantId, subtype }
  );
  return r.recordset?.[0] || null;
}

function normDate(v) {
  const ymd = toYmdFromDbOrString(v);
  return ymd || null;
}

/** Post balanced journal entry; lines: [{ accountId, description, debit, credit }] */
export async function postJournalEntry({ tenantId, userId, entryDate, description, sourceType, sourceId, lines }) {
  const date = normDate(entryDate);
  if (!date) throw new Error('Invalid journal date');
  const validLines = (lines || []).filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  if (validLines.length < 2) throw new Error('Journal requires at least two lines');

  const totalDebit = validLines.reduce((s, l) => s + Number(l.debit) || 0, 0);
  const totalCredit = validLines.reduce((s, l) => s + Number(l.credit) || 0, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal out of balance (debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)})`);
  }

  const journalNumber = await nextJournalNumber(tenantId);
  const je = await query(
    `INSERT INTO accounting_journal_entries (tenant_id, journal_number, entry_date, description, source_type, source_id, [status], created_by_user_id)
     OUTPUT INSERTED.* VALUES (@tid, @num, @date, @desc, @srcType, @srcId, N'posted', @uid)`,
    {
      tid: tenantId,
      num: journalNumber,
      date,
      desc: description,
      srcType: sourceType,
      srcId: sourceId || null,
      uid: userId,
    }
  );
  const entry = je.recordset?.[0];
  if (!entry) throw new Error('Failed to create journal entry');

  let sort = 0;
  for (const line of validLines) {
    await query(
      `INSERT INTO accounting_journal_lines (journal_entry_id, account_type_id, line_description, debit, credit, sort_order)
       VALUES (@jeId, @acct, @lineDesc, @debit, @credit, @sort)`,
      {
        jeId: entry.id,
        acct: line.accountId,
        lineDesc: line.description || description,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        sort: sort++,
      }
    );
  }
  return entry;
}

export function invoiceTotals(invoice, lines) {
  const t = computeDocumentTotals(lines || [], invoice?.discount_percent, invoice?.tax_percent);
  return { grandTotal: Math.round(t.total * 100) / 100, taxAmount: Math.round(t.vatAmount * 100) / 100 };
}

/** Accrual: Dr AR, Cr Revenue (+ Cr VAT if applicable) */
export async function postInvoiceAccrualJournal({ tenantId, userId, invoice, lines }) {
  if (invoice.accrual_journal_entry_id) return { skipped: true, journalEntryId: invoice.accrual_journal_entry_id };

  const defaults = await getAccountDefaults(tenantId);
  const arId = defaults.accounts_receivable_id || (await getAccountBySubtype(tenantId, 'accounts_receivable'))?.id;
  const revId = defaults.sales_revenue_id || (await getAccountBySubtype(tenantId, 'sales_revenue'))?.id;
  const vatId = defaults.vat_output_account_id || (await getAccountBySubtype(tenantId, 'vat_output'))?.id;
  if (!arId || !revId) throw new Error('Configure Accounts Receivable and Sales Revenue in Account types → Defaults');

  const totals = await invoiceTotals(invoice, lines);
  const amount = totals.grandTotal;
  const taxAmt = totals.taxAmount || 0;
  const netRevenue = Math.max(amount - taxAmt, 0);

  const journalLines = [
    { accountId: arId, description: `Invoice ${invoice.number}`, debit: amount, credit: 0 },
    { accountId: revId, description: `Revenue — ${invoice.number}`, debit: 0, credit: netRevenue },
  ];
  if (taxAmt > 0.01 && vatId) {
    journalLines.push({ accountId: vatId, description: `VAT on ${invoice.number}`, debit: 0, credit: taxAmt });
  } else if (taxAmt > 0.01) {
    journalLines[1].credit = amount;
  }

  const entry = await postJournalEntry({
    tenantId,
    userId,
    entryDate: invoice.date || invoice.payment_date,
    description: `Invoice accrual — ${invoice.number}`,
    sourceType: 'invoice_accrual',
    sourceId: invoice.id,
    lines: journalLines,
  });

  await query(`UPDATE accounting_invoices SET accrual_journal_entry_id = @jeId WHERE id = @id`, {
    jeId: entry.id,
    id: invoice.id,
  });
  return { journalEntryId: entry.id, journalNumber: entry.journal_number };
}

/** Payment: Dr Bank, Cr AR */
export async function postInvoicePaymentJournal({ tenantId, userId, invoice, lines, paymentDate, paymentReference }) {
  if (invoice.payment_journal_entry_id) return { skipped: true, journalEntryId: invoice.payment_journal_entry_id };

  const defaults = await getAccountDefaults(tenantId);
  const bankId = defaults.bank_account_id || (await getAccountBySubtype(tenantId, 'bank'))?.id;
  const arId = defaults.accounts_receivable_id || (await getAccountBySubtype(tenantId, 'accounts_receivable'))?.id;
  if (!bankId || !arId) throw new Error('Configure Bank and Accounts Receivable in Account types → Defaults');

  const totals = await invoiceTotals(invoice, lines);
  const amount = totals.grandTotal;

  if (!invoice.accrual_journal_entry_id) {
    await postInvoiceAccrualJournal({ tenantId, userId, invoice, lines });
  }

  const entry = await postJournalEntry({
    tenantId,
    userId,
    entryDate: paymentDate,
    description: `Payment received — ${invoice.number}${paymentReference ? ` (${paymentReference})` : ''}`,
    sourceType: 'invoice_payment',
    sourceId: invoice.id,
    lines: [
      { accountId: bankId, description: `Receipt — ${invoice.number}`, debit: amount, credit: 0 },
      { accountId: arId, description: `Clear AR — ${invoice.number}`, debit: 0, credit: amount },
    ],
  });

  await query(`UPDATE accounting_invoices SET payment_journal_entry_id = @jeId WHERE id = @id`, {
    jeId: entry.id,
    id: invoice.id,
  });
  return { journalEntryId: entry.id, journalNumber: entry.journal_number };
}

async function resolveBudgetCategoryAccountId(budgetCategoryId) {
  if (!budgetCategoryId) return null;
  const r = await query(`SELECT account_type_id FROM budget_categories WHERE id = @id`, { id: budgetCategoryId });
  return r.recordset?.[0]?.account_type_id || null;
}

/** Expense: Dr Expense, Cr Bank */
export async function postExpenseJournal({ tenantId, userId, expenseEntry, categoryAccountId }) {
  if (expenseEntry.journal_entry_id) return { skipped: true, journalEntryId: expenseEntry.journal_entry_id };

  const defaults = await getAccountDefaults(tenantId);
  const bankId = expenseEntry.credit_account_id || defaults.bank_account_id || (await getAccountBySubtype(tenantId, 'bank'))?.id;
  const budgetCatAccountId =
    expenseEntry.budget_category_account_type_id ||
    (await resolveBudgetCategoryAccountId(expenseEntry.budget_category_id));
  let expenseId =
    expenseEntry.debit_account_id ||
    categoryAccountId ||
    budgetCatAccountId ||
    defaults.default_expense_account_id ||
    (await getAccountBySubtype(tenantId, 'operating_expense'))?.id;

  const entryType = String(expenseEntry.entry_type || 'expense').toLowerCase();
  if (entryType === 'income') {
    return postIncomeJournal({ tenantId, userId, expenseEntry });
  }

  if (!bankId || !expenseId) throw new Error('Configure Bank and Expense accounts in Account types → Defaults');

  const amount = Number(expenseEntry.total_amount ?? expenseEntry.amount) || 0;
  if (amount <= 0) return { skipped: true };

  const entry = await postJournalEntry({
    tenantId,
    userId,
    entryDate: expenseEntry.entry_date,
    description: `Expense — ${expenseEntry.description || expenseEntry.entry_number}`,
    sourceType: 'expense_entry',
    sourceId: expenseEntry.id,
    lines: [
      { accountId: expenseId, description: expenseEntry.description, debit: amount, credit: 0 },
      { accountId: bankId, description: `Payment — ${expenseEntry.entry_number}`, debit: 0, credit: amount },
    ],
  });

  await query(
    `UPDATE expense_entries SET journal_entry_id = @jeId, debit_account_id = @debit, credit_account_id = @credit WHERE id = @id`,
    { jeId: entry.id, debit: expenseId, credit: bankId, id: expenseEntry.id }
  );
  return { journalEntryId: entry.id, journalNumber: entry.journal_number };
}

/** Income: Dr Bank, Cr Income */
export async function postIncomeJournal({ tenantId, userId, expenseEntry }) {
  if (expenseEntry.journal_entry_id) return { skipped: true, journalEntryId: expenseEntry.journal_entry_id };

  const defaults = await getAccountDefaults(tenantId);
  const bankId = expenseEntry.debit_account_id || defaults.bank_account_id || (await getAccountBySubtype(tenantId, 'bank'))?.id;
  const incomeId =
    expenseEntry.credit_account_id ||
    defaults.default_income_account_id ||
    (await getAccountBySubtype(tenantId, 'other_income'))?.id;
  if (!bankId || !incomeId) throw new Error('Configure Bank and Income accounts in Account types → Defaults');

  const amount = Number(expenseEntry.total_amount ?? expenseEntry.amount) || 0;
  if (amount <= 0) return { skipped: true };

  const entry = await postJournalEntry({
    tenantId,
    userId,
    entryDate: expenseEntry.entry_date,
    description: `Income — ${expenseEntry.description || expenseEntry.entry_number}`,
    sourceType: 'income_entry',
    sourceId: expenseEntry.id,
    lines: [
      { accountId: bankId, description: expenseEntry.description, debit: amount, credit: 0 },
      { accountId: incomeId, description: `Income — ${expenseEntry.entry_number}`, debit: 0, credit: amount },
    ],
  });

  await query(
    `UPDATE expense_entries SET journal_entry_id = @jeId, debit_account_id = @debit, credit_account_id = @credit WHERE id = @id`,
    { jeId: entry.id, debit: bankId, credit: incomeId, id: expenseEntry.id }
  );
  return { journalEntryId: entry.id, journalNumber: entry.journal_number };
}

export async function getLedgerBalances(tenantId, from, to) {
  let sql = `
    SELECT a.id, a.account_code, a.account_name, a.account_class, a.normal_balance,
           ISNULL(SUM(l.debit), 0) AS total_debit,
           ISNULL(SUM(l.credit), 0) AS total_credit
    FROM accounting_account_types a
    LEFT JOIN accounting_journal_lines l ON l.account_type_id = a.id
    LEFT JOIN accounting_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = @tid AND e.[status] = N'posted'`;
  const params = { tid: tenantId };
  if (from) {
    sql += ` AND e.entry_date >= @from`;
    params.from = from;
  }
  if (to) {
    sql += ` AND e.entry_date <= @to`;
    params.to = to;
  }
  sql += ` WHERE a.tenant_id = @tid AND a.is_active = 1
    GROUP BY a.id, a.account_code, a.account_name, a.account_class, a.normal_balance, a.sort_order
    ORDER BY a.account_code`;
  const r = await query(sql, params);
  return (r.recordset || []).map((row) => {
    const debit = Number(row.total_debit) || 0;
    const credit = Number(row.total_credit) || 0;
    const nb = String(row.normal_balance).toLowerCase();
    const balance = nb === 'credit' ? credit - debit : debit - credit;
    return { ...row, balance, total_debit: debit, total_credit: credit };
  });
}

export async function getProfitAndLoss(tenantId, from, to) {
  const balances = await getLedgerBalances(tenantId, from, to);
  const income = balances.filter((b) => b.account_class === 'income');
  const expenses = balances.filter((b) => b.account_class === 'expense');
  const totalIncome = income.reduce((s, b) => s + b.balance, 0);
  const totalExpenses = expenses.reduce((s, b) => s + Math.abs(b.balance), 0);
  return {
    income,
    expenses,
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    from,
    to,
  };
}

export async function getAccountLedger(tenantId, accountId, from, to) {
  let sql = `
    SELECT e.journal_number, e.entry_date, e.description AS journal_description, e.source_type,
           l.line_description, l.debit, l.credit
    FROM accounting_journal_lines l
    INNER JOIN accounting_journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = @tid AND e.[status] = N'posted' AND l.account_type_id = @acctId`;
  const params = { tid: tenantId, acctId: accountId };
  if (from) {
    sql += ` AND e.entry_date >= @from`;
    params.from = from;
  }
  if (to) {
    sql += ` AND e.entry_date <= @to`;
    params.to = to;
  }
  sql += ` ORDER BY e.entry_date, e.journal_number, l.sort_order`;
  const r = await query(sql, params);
  const acct = await getAccountById(tenantId, accountId);
  let running = 0;
  const nb = String(acct?.normal_balance || 'debit').toLowerCase();
  const lines = (r.recordset || []).map((row) => {
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    running += nb === 'credit' ? credit - debit : debit - credit;
    return { ...row, running_balance: running };
  });
  return { account: acct, lines };
}
