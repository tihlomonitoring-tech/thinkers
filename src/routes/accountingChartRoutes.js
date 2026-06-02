import { Router } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import {
  ensureDefaultAccounts,
  getAccountDefaults,
  getLedgerBalances,
  getProfitAndLoss,
  getAccountLedger,
  postJournalEntry,
} from '../lib/accountingLedger.js';
import {
  renderGeneralLedgerPdf,
  pdfBuffer,
} from '../lib/accountingFinancialReportsPdf.js';
import {
  renderTrialBalancePdf,
  renderProfitLossPdf,
  renderAccountLedgerPdf,
} from '../lib/accountingFinancialReportsPdf.js';

const router = Router();
router.use(requireAuth, loadUser, requirePageAccess('accounting_management'));

function tid(req) {
  return req.user?.tenant_id || null;
}

async function companyRow(tenantId) {
  const r = await query(
    `SELECT company_name, address, vat_number, company_registration, email FROM accounting_company_settings WHERE tenant_id = @tid`,
    { tid: tenantId }
  );
  return r.recordset?.[0] || { company_name: 'Company' };
}

// ─── Account types ───────────────────────────────────────────────

router.get('/account-types', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    await ensureDefaultAccounts(t);
    const accounts = await query(
      `SELECT * FROM accounting_account_types WHERE tenant_id = @t ORDER BY account_code`,
      { t }
    );
    const defaults = await getAccountDefaults(t);
    res.json({ accounts: accounts.recordset || [], defaults });
  } catch (err) {
    if (String(err.message).includes('accounting_account_types')) {
      return res.status(503).json({ error: 'Run: npm run db:accounting-account-types' });
    }
    next(err);
  }
});

router.post('/account-types', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.account_code || !b.account_name || !b.account_class) {
      return res.status(400).json({ error: 'account_code, account_name, and account_class are required' });
    }
    const classes = ['asset', 'liability', 'equity', 'income', 'expense'];
    const r = await query(
      `INSERT INTO accounting_account_types (tenant_id, account_code, account_name, account_class, account_subtype, parent_id, description, normal_balance, sort_order)
       OUTPUT INSERTED.* VALUES (@t, @code, @name, @class, @subtype, @parent, @desc, @normal, @sort)`,
      {
        t,
        code: String(b.account_code).trim(),
        name: String(b.account_name).trim(),
        class: classes.includes(b.account_class) ? b.account_class : 'expense',
        subtype: b.account_subtype || null,
        parent: b.parent_id || null,
        desc: b.description || null,
        normal: ['debit', 'credit'].includes(b.normal_balance) ? b.normal_balance : (b.account_class === 'income' || b.account_class === 'liability' || b.account_class === 'equity' ? 'credit' : 'debit'),
        sort: Number(b.sort_order) || 0,
      }
    );
    res.status(201).json({ account: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/account-types/:id', async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, t };
    for (const k of ['account_code', 'account_name', 'account_class', 'account_subtype', 'parent_id', 'description', 'normal_balance', 'is_active', 'sort_order']) {
      if (b[k] !== undefined) {
        params[k] = b[k];
        sets.push(`[${k}] = @${k}`);
      }
    }
    if (sets.length < 2) return res.status(400).json({ error: 'Nothing to update' });
    await query(`UPDATE accounting_account_types SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
    const r = await query(`SELECT * FROM accounting_account_types WHERE id = @id AND tenant_id = @t`, params);
    res.json({ account: r.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/account-types/:id', async (req, res, next) => {
  try {
    const t = tid(req);
    const used = await query(
      `SELECT TOP 1 id FROM accounting_journal_lines l
       INNER JOIN accounting_journal_entries e ON e.id = l.journal_entry_id
       WHERE l.account_type_id = @id AND e.tenant_id = @t`,
      { id: req.params.id, t }
    );
    if (used.recordset?.[0]) {
      return res.status(400).json({ error: 'Account has journal activity. Deactivate instead of delete.' });
    }
    await query(`DELETE FROM accounting_account_types WHERE id = @id AND tenant_id = @t AND is_system = 0`, {
      id: req.params.id,
      t,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/account-types/defaults', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    await ensureDefaultAccounts(t);
    const fields = [
      'bank_account_id',
      'accounts_receivable_id',
      'sales_revenue_id',
      'accounts_payable_id',
      'default_expense_account_id',
      'default_income_account_id',
      'vat_output_account_id',
      'vat_input_account_id',
    ];
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { t };
    for (const k of fields) {
      if (b[k] !== undefined) {
        params[k] = b[k] || null;
        sets.push(`[${k}] = @${k}`);
      }
    }
    await query(
      `UPDATE accounting_account_defaults SET ${sets.join(', ')} WHERE tenant_id = @t`,
      params
    );
    const defaults = await getAccountDefaults(t);
    res.json({ defaults });
  } catch (err) {
    next(err);
  }
});

function journalFilterSql(req, params, alias = 'e') {
  const a = alias;
  let sql = '';
  if (req.query.from) {
    sql += ` AND ${a}.entry_date >= @from`;
    params.from = req.query.from;
  }
  if (req.query.to) {
    sql += ` AND ${a}.entry_date <= @to`;
    params.to = req.query.to;
  }
  if (req.query.source_type && req.query.source_type !== 'all') {
    sql += ` AND ${a}.source_type = @sourceType`;
    params.sourceType = req.query.source_type;
  }
  if (req.query.status && req.query.status !== 'all') {
    sql += ` AND ${a}.[status] = @status`;
    params.status = req.query.status;
  } else if (!req.query.status) {
    sql += ` AND ${a}.[status] = N'posted'`;
  }
  if (req.query.search) {
    sql += ` AND (${a}.description LIKE @q OR ${a}.journal_number LIKE @q)`;
    params.q = `%${req.query.search}%`;
  }
  if (req.query.account_id) {
    sql += ` AND EXISTS (
      SELECT 1 FROM accounting_journal_lines jl
      WHERE jl.journal_entry_id = ${a}.id AND jl.account_type_id = @accountId
    )`;
    params.accountId = req.query.account_id;
  }
  return sql;
}

router.get('/journal-entries/summary', async (req, res, next) => {
  try {
    const t = tid(req);
    const params = { t };
    const filter = journalFilterSql(req, params, 'e');
    const r = await query(
      `SELECT COUNT(DISTINCT e.id) AS entry_count,
              ISNULL(SUM(l.debit), 0) AS total_debit,
              ISNULL(SUM(l.credit), 0) AS total_credit
       FROM accounting_journal_entries e
       INNER JOIN accounting_journal_lines l ON l.journal_entry_id = e.id
       WHERE e.tenant_id = @t ${filter}`,
      params
    );
    res.json({ summary: r.recordset?.[0] || {} });
  } catch (err) {
    next(err);
  }
});

router.get('/journal-entries', async (req, res, next) => {
  try {
    const t = tid(req);
    const params = { t };
    const filter = journalFilterSql(req, params, 'e');
    const r = await query(
      `SELECT e.*, u.full_name AS created_by_name,
              (SELECT ISNULL(SUM(l.debit), 0) FROM accounting_journal_lines l WHERE l.journal_entry_id = e.id) AS total_debit,
              (SELECT ISNULL(SUM(l.credit), 0) FROM accounting_journal_lines l WHERE l.journal_entry_id = e.id) AS total_credit
       FROM accounting_journal_entries e
       LEFT JOIN users u ON u.id = e.created_by_user_id
       WHERE e.tenant_id = @t ${filter}
       ORDER BY e.entry_date DESC, e.journal_number DESC`,
      params
    );
    res.json({ entries: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/journal-lines', async (req, res, next) => {
  try {
    const t = tid(req);
    const params = { t };
    const filter = journalFilterSql(req, params, 'e');
    const r = await query(
      `SELECT e.id AS journal_entry_id, e.entry_date, e.journal_number, e.description AS journal_description,
              e.source_type, e.[status], e.source_id,
              l.id AS line_id, l.line_description, l.debit, l.credit, l.sort_order,
              a.id AS account_type_id, a.account_code, a.account_name, a.account_class
       FROM accounting_journal_lines l
       INNER JOIN accounting_journal_entries e ON e.id = l.journal_entry_id
       INNER JOIN accounting_account_types a ON a.id = l.account_type_id
       WHERE e.tenant_id = @t ${filter}
       ORDER BY e.entry_date DESC, e.journal_number DESC, l.sort_order`,
      params
    );
    res.json({ lines: r.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/journal-entries', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.entry_date || !b.description) {
      return res.status(400).json({ error: 'entry_date and description are required' });
    }
    const lines = (b.lines || []).map((l) => ({
      accountId: l.account_type_id || l.accountId,
      description: l.line_description || l.description,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    }));
    const entry = await postJournalEntry({
      tenantId: t,
      userId: req.user.id,
      entryDate: b.entry_date,
      description: b.description,
      sourceType: 'manual',
      sourceId: null,
      lines,
    });
    const detail = await query(
      `SELECT l.*, a.account_code, a.account_name FROM accounting_journal_lines l
       INNER JOIN accounting_account_types a ON a.id = l.account_type_id
       WHERE l.journal_entry_id = @id ORDER BY l.sort_order`,
      { id: entry.id }
    );
    res.status(201).json({ entry, lines: detail.recordset || [] });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not post journal' });
  }
});

async function fetchJournalLinesForExport(req) {
  const t = tid(req);
  const params = { t };
  const filter = journalFilterSql(req, params, 'e');
  const r = await query(
    `SELECT e.entry_date, e.journal_number, e.description AS journal_description, e.source_type,
            l.line_description, l.debit, l.credit, a.account_code, a.account_name
     FROM accounting_journal_lines l
     INNER JOIN accounting_journal_entries e ON e.id = l.journal_entry_id
     INNER JOIN accounting_account_types a ON a.id = l.account_type_id
     WHERE e.tenant_id = @t ${filter}
     ORDER BY e.entry_date, e.journal_number, l.sort_order`,
    params
  );
  return r.recordset || [];
}

router.get('/journal-entries/export/pdf', async (req, res, next) => {
  try {
    const t = tid(req);
    const company = await companyRow(t);
    const lines = await fetchJournalLinesForExport(req);
    const params = { t };
    const filter = journalFilterSql(req, params, 'e');
    const sum = await query(
      `SELECT ISNULL(SUM(l.debit), 0) AS total_debit, ISNULL(SUM(l.credit), 0) AS total_credit
       FROM accounting_journal_lines l
       INNER JOIN accounting_journal_entries e ON e.id = l.journal_entry_id
       WHERE e.tenant_id = @t ${filter}`,
      params
    );
    const buf = await pdfBuffer(renderGeneralLedgerPdf, {
      company,
      from: req.query.from,
      to: req.query.to,
      lines,
      summary: sum.recordset?.[0],
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="general-ledger.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.get('/journal-entries/export/excel', async (req, res, next) => {
  try {
    const lines = await fetchJournalLinesForExport(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('General ledger');
    ws.addRow(['General ledger', req.query.from || '', req.query.to || '']);
    ws.addRow([]);
    ws.addRow(['Date', 'Journal', 'Source', 'Account code', 'Account', 'Line description', 'Debit', 'Credit']);
    for (const row of lines) {
      ws.addRow([
        row.entry_date ? String(row.entry_date).slice(0, 10) : '',
        row.journal_number,
        row.source_type,
        row.account_code,
        row.account_name,
        row.line_description || row.journal_description,
        row.debit,
        row.credit,
      ]);
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="general-ledger.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/journal-entries/:id', async (req, res, next) => {
  try {
    const t = tid(req);
    const e = await query(
      `SELECT e.*, u.full_name AS created_by_name FROM accounting_journal_entries e
       LEFT JOIN users u ON u.id = e.created_by_user_id
       WHERE e.id = @id AND e.tenant_id = @t`,
      { id: req.params.id, t }
    );
    if (!e.recordset?.[0]) return res.status(404).json({ error: 'Not found' });
    const lines = await query(
      `SELECT l.*, a.account_code, a.account_name FROM accounting_journal_lines l
       INNER JOIN accounting_account_types a ON a.id = l.account_type_id
       WHERE l.journal_entry_id = @id ORDER BY l.sort_order`,
      { id: req.params.id }
    );
    res.json({ entry: e.recordset[0], lines: lines.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// ─── Financial reports (JSON) ────────────────────────────────────

router.get('/reports/trial-balance', async (req, res, next) => {
  try {
    const t = tid(req);
    const rows = await getLedgerBalances(t, req.query.from, req.query.to);
    res.json({ rows, from: req.query.from, to: req.query.to });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/profit-loss', async (req, res, next) => {
  try {
    const t = tid(req);
    const report = await getProfitAndLoss(t, req.query.from, req.query.to);
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/account-ledger/:accountId', async (req, res, next) => {
  try {
    const t = tid(req);
    const ledger = await getAccountLedger(t, req.params.accountId, req.query.from, req.query.to);
    res.json({ ledger, from: req.query.from, to: req.query.to });
  } catch (err) {
    next(err);
  }
});

// ─── PDF exports ─────────────────────────────────────────────────

router.get('/reports/trial-balance/pdf', async (req, res, next) => {
  try {
    const t = tid(req);
    const company = await companyRow(t);
    const rows = await getLedgerBalances(t, req.query.from, req.query.to);
    const buf = await pdfBuffer(renderTrialBalancePdf, {
      company,
      from: req.query.from,
      to: req.query.to,
      rows,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="trial-balance.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.get('/reports/profit-loss/pdf', async (req, res, next) => {
  try {
    const t = tid(req);
    const company = await companyRow(t);
    const report = await getProfitAndLoss(t, req.query.from, req.query.to);
    const buf = await pdfBuffer(renderProfitLossPdf, { company, from: req.query.from, to: req.query.to, report });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-and-loss.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.get('/reports/account-ledger/:accountId/pdf', async (req, res, next) => {
  try {
    const t = tid(req);
    const company = await companyRow(t);
    const ledger = await getAccountLedger(t, req.params.accountId, req.query.from, req.query.to);
    const buf = await pdfBuffer(renderAccountLedgerPdf, { company, from: req.query.from, to: req.query.to, ledger });
    const code = ledger.account?.account_code || 'account';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="account-statement-${code}.pdf"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ─── Excel exports ─────────────────────────────────────────────────

async function excelTrialBalance(rows, from, to) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Trial balance');
  ws.addRow(['Trial balance', from && to ? `${from} to ${to}` : '']);
  ws.addRow([]);
  ws.addRow(['Code', 'Account', 'Class', 'Debit', 'Credit', 'Balance']);
  for (const r of rows) {
    ws.addRow([r.account_code, r.account_name, r.account_class, r.total_debit, r.total_credit, r.balance]);
  }
  return wb.xlsx.writeBuffer();
}

router.get('/reports/trial-balance/excel', async (req, res, next) => {
  try {
    const t = tid(req);
    const rows = await getLedgerBalances(t, req.query.from, req.query.to);
    const buf = await excelTrialBalance(rows, req.query.from, req.query.to);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="trial-balance.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/reports/profit-loss/excel', async (req, res, next) => {
  try {
    const t = tid(req);
    const report = await getProfitAndLoss(t, req.query.from, req.query.to);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Profit and Loss');
    ws.addRow(['Profit and Loss', req.query.from, req.query.to]);
    ws.addRow([]);
    ws.addRow(['Income']);
    for (const r of report.income) ws.addRow([r.account_code, r.account_name, r.balance]);
    ws.addRow(['Total income', '', report.totalIncome]);
    ws.addRow([]);
    ws.addRow(['Expenses']);
    for (const r of report.expenses) ws.addRow([r.account_code, r.account_name, r.balance]);
    ws.addRow(['Total expenses', '', report.totalExpenses]);
    ws.addRow(['Net profit', '', report.netProfit]);
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-and-loss.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get('/reports/account-ledger/:accountId/excel', async (req, res, next) => {
  try {
    const t = tid(req);
    const ledger = await getAccountLedger(t, req.params.accountId, req.query.from, req.query.to);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Account statement');
    ws.addRow([`${ledger.account?.account_code} — ${ledger.account?.account_name}`]);
    ws.addRow(['Date', 'Journal', 'Description', 'Debit', 'Credit', 'Balance']);
    for (const row of ledger.lines) {
      ws.addRow([
        row.entry_date ? String(row.entry_date).slice(0, 10) : '',
        row.journal_number,
        row.line_description || row.journal_description,
        row.debit,
        row.credit,
        row.running_balance,
      ]);
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="account-statement.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

export default router;
