import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { requireAuth, loadUser } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, loadUser);

function tid(req) { return req.user?.tenant_id || null; }

const uploadsDir = path.join(process.cwd(), 'uploads', 'expense-attachments');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
}), limits: { fileSize: 10 * 1024 * 1024 } });

// ════════════════════════════════════════════════════════════════════
//  EXPENSE CATEGORIES
// ════════════════════════════════════════════════════════════════════

router.get('/categories', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT c.*, u.full_name AS created_by_name, p.name AS parent_name
       FROM expense_categories c
       LEFT JOIN users u ON u.id = c.created_by_user_id
       LEFT JOIN expense_categories p ON p.id = c.parent_id
       WHERE c.tenant_id = @t ORDER BY c.sort_order, c.name`,
      { t }
    );
    res.json({ categories: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const types = ['expense', 'income', 'overhead', 'capital', 'operational', 'payroll', 'travel', 'utilities', 'maintenance', 'other'];
    const r = await query(
      `INSERT INTO expense_categories (tenant_id, name, parent_id, code, description, category_type, sort_order, created_by_user_id)
       OUTPUT INSERTED.* VALUES (@t, @name, @parentId, @code, @desc, @type, @sort, @createdBy)`,
      { t, name: b.name, parentId: b.parent_id || null, code: b.code || null, desc: b.description || null, type: types.includes(b.category_type) ? b.category_type : 'expense', sort: Number(b.sort_order) || 0, createdBy: req.user.id }
    );
    res.status(201).json({ category: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.patch('/categories/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = []; const params = { id: req.params.id };
    for (const k of ['name', 'parent_id', 'code', 'description', 'category_type', 'is_active', 'sort_order']) {
      if (b[k] !== undefined) { params[k] = b[k]; sets.push(`[${k}] = @${k}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await query(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = @id`, params);
    const r = await query(`SELECT * FROM expense_categories WHERE id = @id`, { id: req.params.id });
    res.json({ category: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM expense_categories WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  EXPENSE ENTRIES (JOURNAL)
// ════════════════════════════════════════════════════════════════════

async function nextEntryNumber(tenantId) {
  const r = await query(
    `MERGE expense_entry_counter AS t USING (SELECT @tid AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { tid: tenantId }
  );
  const n = r.recordset?.[0]?.last_number || 1;
  return `EXP-${String(n).padStart(5, '0')}`;
}

router.get('/entries', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT e.*, c.name AS category_name, c.code AS category_code, u.full_name AS recorded_by_name, au.full_name AS approved_by_name,
                      b.department_name AS budget_department, b.fiscal_year AS budget_year
               FROM expense_entries e
               LEFT JOIN expense_categories c ON c.id = e.category_id
               LEFT JOIN users u ON u.id = e.recorded_by_user_id
               LEFT JOIN users au ON au.id = e.approved_by_user_id
               LEFT JOIN department_budgets b ON b.id = e.budget_id
               WHERE e.tenant_id = @t`;
    const params = { t };
    if (req.query.from) { sql += ` AND e.entry_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND e.entry_date <= @to`; params.to = req.query.to; }
    if (req.query.category_id) { sql += ` AND e.category_id = @catId`; params.catId = req.query.category_id; }
    if (req.query.budget_id) { sql += ` AND e.budget_id = @budgetId`; params.budgetId = req.query.budget_id; }
    if (req.query.department) { sql += ` AND e.department_name = @dept`; params.dept = req.query.department; }
    if (req.query.status && req.query.status !== 'all') { sql += ` AND e.[status] = @status`; params.status = req.query.status; }
    if (req.query.entry_type && req.query.entry_type !== 'all') { sql += ` AND e.entry_type = @entryType`; params.entryType = req.query.entry_type; }
    if (req.query.is_budgeted === '1') { sql += ` AND e.is_budgeted = 1`; }
    if (req.query.is_budgeted === '0') { sql += ` AND e.is_budgeted = 0`; }
    if (req.query.search) { sql += ` AND (e.description LIKE @q OR e.vendor_supplier LIKE @q OR e.reference_number LIKE @q)`; params.q = `%${req.query.search}%`; }
    sql += ` ORDER BY e.entry_date DESC, e.created_at DESC`;
    const r = await query(sql, params);
    res.json({ entries: r.recordset || [] });
  } catch (err) { next(err); }
});

router.get('/entries/:id', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT e.*, c.name AS category_name, u.full_name AS recorded_by_name, au.full_name AS approved_by_name,
              b.department_name AS budget_department, b.fiscal_year AS budget_year
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN users u ON u.id = e.recorded_by_user_id
       LEFT JOIN users au ON au.id = e.approved_by_user_id
       LEFT JOIN department_budgets b ON b.id = e.budget_id
       WHERE e.id = @id`,
      { id: req.params.id }
    );
    const entry = r.recordset?.[0];
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    const attachments = await query(`SELECT * FROM expense_attachments WHERE expense_id = @id ORDER BY created_at`, { id: req.params.id });
    res.json({ entry, attachments: attachments.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/entries', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.description || !b.amount || !b.entry_date) return res.status(400).json({ error: 'description, amount, and entry_date are required' });
    const entryNumber = await nextEntryNumber(t);
    const r = await query(
      `INSERT INTO expense_entries (tenant_id, entry_number, entry_date, category_id, department_name, budget_id, budget_category_id, budget_line_item_id, is_budgeted, entry_type, description, amount, tax_amount, currency, payment_method, reference_number, vendor_supplier, receipt_number, [status], notes, tags, is_recurring, recurring_frequency, recorded_by_user_id)
       OUTPUT INSERTED.*
       VALUES (@t, @entryNum, @date, @catId, @dept, @budgetId, @budgetCatId, @budgetLineId, @isBudgeted, @entryType, @desc, @amount, @tax, @currency, @payMethod, @refNum, @vendor, @receiptNum, @status, @notes, @tags, @isRecurring, @recurFreq, @recordedBy)`,
      {
        t, entryNum: entryNumber, date: b.entry_date,
        catId: b.category_id || null, dept: b.department_name || null,
        budgetId: b.budget_id || null, budgetCatId: b.budget_category_id || null, budgetLineId: b.budget_line_item_id || null,
        isBudgeted: b.budget_id ? 1 : (b.is_budgeted ? 1 : 0),
        entryType: ['expense', 'income', 'refund', 'adjustment', 'reimbursement'].includes(b.entry_type) ? b.entry_type : 'expense',
        desc: b.description, amount: Number(b.amount),
        tax: Number(b.tax_amount) || 0, currency: b.currency || 'ZAR',
        payMethod: b.payment_method || null, refNum: b.reference_number || null,
        vendor: b.vendor_supplier || null, receiptNum: b.receipt_number || null,
        status: 'draft', notes: b.notes || null, tags: b.tags || null,
        isRecurring: b.is_recurring ? 1 : 0, recurFreq: b.recurring_frequency || null,
        recordedBy: req.user.id,
      }
    );
    if (b.budget_id && r.recordset?.[0]) {
      await query(
        `INSERT INTO budget_transactions (budget_id, category_id, line_item_id, transaction_date, amount, transaction_type, reference, description, recorded_by_user_id)
         VALUES (@budgetId, @catId, @lineId, @date, @amount, N'expense', @ref, @desc, @userId)`,
        { budgetId: b.budget_id, catId: b.budget_category_id || null, lineId: b.budget_line_item_id || null, date: b.entry_date, amount: Number(b.amount), ref: entryNumber, desc: b.description, userId: req.user.id }
      );
    }
    res.status(201).json({ entry: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.patch('/entries/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = []; const params = { id: req.params.id };
    const allowed = ['entry_date', 'category_id', 'department_name', 'budget_id', 'budget_category_id', 'budget_line_item_id', 'is_budgeted', 'entry_type', 'description', 'amount', 'tax_amount', 'currency', 'payment_method', 'reference_number', 'vendor_supplier', 'receipt_number', 'status', 'notes', 'tags', 'rejection_reason'];
    for (const k of allowed) {
      if (b[k] !== undefined) { params[k] = b[k]; sets.push(`[${k}] = @${k}`); }
    }
    if (b.status === 'approved') {
      sets.push(`approved_by_user_id = @approvedBy`); sets.push(`approved_at = SYSUTCDATETIME()`); params.approvedBy = req.user.id;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(`UPDATE expense_entries SET ${sets.join(', ')} WHERE id = @id`, params);
    const r = await query(
      `SELECT e.*, c.name AS category_name, c.account_type_id AS category_account_type_id,
              bc.account_type_id AS budget_category_account_type_id
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN budget_categories bc ON bc.id = e.budget_category_id
       WHERE e.id = @id`,
      { id: req.params.id }
    );
    const entry = r.recordset?.[0] || null;
    let journal = null;
    if (entry && ['approved', 'paid'].includes(String(b.status || entry.status)) && !entry.journal_entry_id) {
      try {
        const { postExpenseJournal } = await import('../lib/accountingLedger.js');
        journal = await postExpenseJournal({
          tenantId: entry.tenant_id,
          userId: req.user.id,
          expenseEntry: entry,
          categoryAccountId: entry.category_account_type_id,
        });
      } catch (je) {
        journal = { error: je.message };
      }
    }
    res.json({ entry, journal });
  } catch (err) { next(err); }
});

router.delete('/entries/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM expense_entries WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Attachments
router.post('/entries/:id/attachments', upload.array('files', 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    const results = [];
    for (const f of files) {
      const r = await query(
        `INSERT INTO expense_attachments (expense_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id) OUTPUT INSERTED.* VALUES (@eid, @name, @path, @size, @mime, @uid)`,
        { eid: req.params.id, name: f.originalname, path: f.path, size: f.size, mime: f.mimetype, uid: req.user.id }
      );
      if (r.recordset?.[0]) results.push(r.recordset[0]);
    }
    res.status(201).json({ attachments: results });
  } catch (err) { next(err); }
});

router.delete('/attachments/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT file_path FROM expense_attachments WHERE id = @id`, { id: req.params.id });
    const fp = r.recordset?.[0]?.file_path;
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    await query(`DELETE FROM expense_attachments WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  BUDGET ITEM REQUESTS
// ════════════════════════════════════════════════════════════════════

router.get('/budget-requests', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT r.*, u.full_name AS requested_by_name, au.full_name AS approved_by_name, c.name AS category_name
               FROM budget_item_requests r
               LEFT JOIN users u ON u.id = r.requested_by_user_id
               LEFT JOIN users au ON au.id = r.approved_by_user_id
               LEFT JOIN expense_categories c ON c.id = r.category_id
               WHERE r.tenant_id = @t`;
    const params = { t };
    if (req.query.department) { sql += ` AND r.department_name = @dept`; params.dept = req.query.department; }
    if (req.query.budget_id) { sql += ` AND r.budget_id = @budgetId`; params.budgetId = req.query.budget_id; }
    if (req.query.status && req.query.status !== 'all') { sql += ` AND r.[status] = @status`; params.status = req.query.status; }
    sql += ` ORDER BY r.created_at DESC`;
    const r = await query(sql, params);
    res.json({ requests: r.recordset || [] });
  } catch (err) { next(err); }
});

router.post('/budget-requests', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.item_name || !b.department_name) return res.status(400).json({ error: 'item_name and department_name required' });
    const r = await query(
      `INSERT INTO budget_item_requests (tenant_id, budget_id, department_name, item_name, description, estimated_cost, quantity, priority, category_id, justification, requested_by_user_id)
       OUTPUT INSERTED.* VALUES (@t, @budgetId, @dept, @name, @desc, @cost, @qty, @priority, @catId, @justification, @userId)`,
      { t, budgetId: b.budget_id || null, dept: b.department_name, name: b.item_name, desc: b.description || null, cost: Number(b.estimated_cost) || 0, qty: Number(b.quantity) || 1, priority: ['low', 'medium', 'high', 'critical'].includes(b.priority) ? b.priority : 'medium', catId: b.category_id || null, justification: b.justification || null, userId: req.user.id }
    );
    res.status(201).json({ request: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.patch('/budget-requests/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = []; const params = { id: req.params.id };
    for (const k of ['item_name', 'description', 'estimated_cost', 'quantity', 'priority', 'category_id', 'justification', 'status', 'rejection_reason', 'budget_id']) {
      if (b[k] !== undefined) { params[k] = b[k]; sets.push(`[${k}] = @${k}`); }
    }
    if (b.status === 'approved') {
      sets.push(`approved_by_user_id = @approvedBy`); sets.push(`approved_at = SYSUTCDATETIME()`); params.approvedBy = req.user.id;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(`UPDATE budget_item_requests SET ${sets.join(', ')} WHERE id = @id`, params);
    const r = await query(`SELECT * FROM budget_item_requests WHERE id = @id`, { id: req.params.id });
    res.json({ request: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

router.delete('/budget-requests/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM budget_item_requests WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  REPORTS: PDF & EXCEL EXPORT
// ════════════════════════════════════════════════════════════════════

function fmtZar(v) {
  const n = Number(v);
  if (isNaN(n)) return 'R 0.00';
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

router.get('/entries/export/pdf', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT e.*, c.name AS category_name, u.full_name AS recorded_by_name
               FROM expense_entries e
               LEFT JOIN expense_categories c ON c.id = e.category_id
               LEFT JOIN users u ON u.id = e.recorded_by_user_id
               WHERE e.tenant_id = @t`;
    const params = { t };
    if (req.query.from) { sql += ` AND e.entry_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND e.entry_date <= @to`; params.to = req.query.to; }
    if (req.query.category_id) { sql += ` AND e.category_id = @catId`; params.catId = req.query.category_id; }
    if (req.query.department) { sql += ` AND e.department_name = @dept`; params.dept = req.query.department; }
    if (req.query.status && req.query.status !== 'all') { sql += ` AND e.[status] = @status`; params.status = req.query.status; }
    sql += ` ORDER BY e.entry_date DESC`;
    const r = await query(sql, params);
    const entries = r.recordset || [];

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Expense-Journal-Statement.pdf"');
      res.send(buf);
    });

    doc.fontSize(16).font('Helvetica-Bold').text('Expense Journal Statement', { align: 'center' });
    doc.moveDown(0.3);
    const fromLabel = req.query.from || 'All';
    const toLabel = req.query.to || 'Present';
    doc.fontSize(9).font('Helvetica').text(`Period: ${fromLabel} to ${toLabel}`, { align: 'center' });
    doc.moveDown(1);

    const cols = [
      { label: 'Date', width: 60 },
      { label: 'Ref #', width: 55 },
      { label: 'Description', width: 130 },
      { label: 'Category', width: 75 },
      { label: 'Department', width: 65 },
      { label: 'Amount', width: 65 },
      { label: 'Status', width: 50 },
    ];
    const tableLeft = 40;
    let y = doc.y;
    doc.fontSize(7).font('Helvetica-Bold');
    let x = tableLeft;
    for (const col of cols) { doc.text(col.label, x, y, { width: col.width }); x += col.width; }
    y += 14;
    doc.moveTo(tableLeft, y).lineTo(tableLeft + cols.reduce((s, c) => s + c.width, 0), y).stroke();
    y += 4;

    doc.font('Helvetica').fontSize(7);
    let totalAmount = 0;
    for (const e of entries) {
      if (y > 760) { doc.addPage(); y = 40; }
      x = tableLeft;
      doc.text(String(e.entry_date).slice(0, 10), x, y, { width: cols[0].width }); x += cols[0].width;
      doc.text(e.entry_number || '', x, y, { width: cols[1].width }); x += cols[1].width;
      doc.text((e.description || '').slice(0, 40), x, y, { width: cols[2].width }); x += cols[2].width;
      doc.text((e.category_name || '—').slice(0, 20), x, y, { width: cols[3].width }); x += cols[3].width;
      doc.text((e.department_name || '—').slice(0, 18), x, y, { width: cols[4].width }); x += cols[4].width;
      doc.text(fmtZar(e.total_amount || e.amount), x, y, { width: cols[5].width, align: 'right' }); x += cols[5].width;
      doc.text(e.status || '', x, y, { width: cols[6].width }); 
      totalAmount += Number(e.total_amount || e.amount) || 0;
      y += 12;
    }

    y += 6;
    doc.moveTo(tableLeft, y).lineTo(tableLeft + cols.reduce((s, c) => s + c.width, 0), y).stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(`Total: ${fmtZar(totalAmount)}`, tableLeft, y, { width: cols.reduce((s, c) => s + c.width, 0), align: 'right' });

    const range = doc.bufferedPageRange();
    doc._pageBuffer.length = range.count;
    doc.end();
  } catch (err) { next(err); }
});

router.get('/entries/export/excel', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT e.*, c.name AS category_name, u.full_name AS recorded_by_name
               FROM expense_entries e
               LEFT JOIN expense_categories c ON c.id = e.category_id
               LEFT JOIN users u ON u.id = e.recorded_by_user_id
               WHERE e.tenant_id = @t`;
    const params = { t };
    if (req.query.from) { sql += ` AND e.entry_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND e.entry_date <= @to`; params.to = req.query.to; }
    if (req.query.category_id) { sql += ` AND e.category_id = @catId`; params.catId = req.query.category_id; }
    if (req.query.department) { sql += ` AND e.department_name = @dept`; params.dept = req.query.department; }
    if (req.query.status && req.query.status !== 'all') { sql += ` AND e.[status] = @status`; params.status = req.query.status; }
    sql += ` ORDER BY e.entry_date DESC`;
    const r = await query(sql, params);
    const entries = r.recordset || [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Expense Journal');
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Entry #', key: 'entry_number', width: 14 },
      { header: 'Type', key: 'entry_type', width: 12 },
      { header: 'Description', key: 'description', width: 35 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Vendor/Supplier', key: 'vendor', width: 20 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Tax', key: 'tax', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Payment Method', key: 'payment', width: 14 },
      { header: 'Reference', key: 'reference', width: 14 },
      { header: 'Budgeted', key: 'budgeted', width: 10 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Recorded By', key: 'recorded_by', width: 18 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const e of entries) {
      ws.addRow({
        date: String(e.entry_date).slice(0, 10),
        entry_number: e.entry_number || '',
        entry_type: e.entry_type || '',
        description: e.description || '',
        category: e.category_name || '',
        department: e.department_name || '',
        vendor: e.vendor_supplier || '',
        amount: Number(e.amount) || 0,
        tax: Number(e.tax_amount) || 0,
        total: Number(e.total_amount || e.amount) || 0,
        payment: e.payment_method || '',
        reference: e.reference_number || '',
        budgeted: e.is_budgeted ? 'Yes' : 'No',
        status: e.status || '',
        recorded_by: e.recorded_by_name || '',
        notes: e.notes || '',
      });
    }
    const lastRow = ws.lastRow?.number || 1;
    ws.addRow({});
    const totalRow = ws.addRow({ description: 'TOTAL', amount: { formula: `SUM(H2:H${lastRow})` }, tax: { formula: `SUM(I2:I${lastRow})` }, total: { formula: `SUM(J2:J${lastRow})` } });
    totalRow.font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Expense-Journal.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  SUMMARY / DASHBOARD
// ════════════════════════════════════════════════════════════════════

router.get('/summary', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const params = { t };
    let dateFilter = '';
    if (req.query.from) { dateFilter += ` AND e.entry_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { dateFilter += ` AND e.entry_date <= @to`; params.to = req.query.to; }

    const totals = await query(
      `SELECT COUNT(*) AS total_entries,
              SUM(CASE WHEN entry_type = N'expense' THEN total_amount ELSE 0 END) AS total_expenses,
              SUM(CASE WHEN entry_type = N'income' THEN total_amount ELSE 0 END) AS total_income,
              SUM(CASE WHEN is_budgeted = 1 THEN total_amount ELSE 0 END) AS budgeted_total,
              SUM(CASE WHEN is_budgeted = 0 THEN total_amount ELSE 0 END) AS unbudgeted_total
       FROM expense_entries e WHERE e.tenant_id = @t${dateFilter}`,
      params
    );

    const byCat = await query(
      `SELECT c.name AS category_name, c.category_type, COUNT(*) AS count, SUM(e.total_amount) AS total
       FROM expense_entries e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.tenant_id = @t${dateFilter}
       GROUP BY c.name, c.category_type ORDER BY total DESC`,
      params
    );

    const byMonth = await query(
      `SELECT YEAR(e.entry_date) AS [year], MONTH(e.entry_date) AS [month],
              SUM(CASE WHEN e.entry_type = N'expense' THEN e.total_amount ELSE 0 END) AS expenses,
              SUM(CASE WHEN e.entry_type = N'income' THEN e.total_amount ELSE 0 END) AS income
       FROM expense_entries e WHERE e.tenant_id = @t${dateFilter}
       GROUP BY YEAR(e.entry_date), MONTH(e.entry_date) ORDER BY [year], [month]`,
      params
    );

    const byDept = await query(
      `SELECT ISNULL(e.department_name, N'Unassigned') AS department, COUNT(*) AS count, SUM(e.total_amount) AS total
       FROM expense_entries e WHERE e.tenant_id = @t AND e.entry_type = N'expense'${dateFilter}
       GROUP BY e.department_name ORDER BY total DESC`,
      params
    );

    res.json({
      totals: totals.recordset?.[0] || {},
      byCategory: byCat.recordset || [],
      byMonth: byMonth.recordset || [],
      byDepartment: byDept.recordset || [],
    });
  } catch (err) { next(err); }
});

// Departments list (for dropdowns)
router.get('/departments', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT DISTINCT department_name FROM department_budgets WHERE tenant_id = @t AND department_name IS NOT NULL
       UNION SELECT DISTINCT department_name FROM expense_entries WHERE tenant_id = @t AND department_name IS NOT NULL
       ORDER BY department_name`,
      { t }
    );
    res.json({ departments: (r.recordset || []).map((x) => x.department_name) });
  } catch (err) { next(err); }
});

// Budgets list for linking (minimal)
router.get('/budgets-for-linking', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT b.id, b.department_name, b.fiscal_year, b.total_budget, b.[status],
              (SELECT ISNULL(SUM(bt.amount), 0) FROM budget_transactions bt WHERE bt.budget_id = b.id AND bt.transaction_type = N'expense') AS spent
       FROM department_budgets b WHERE b.tenant_id = @t AND b.[status] NOT IN (N'closed', N'cancelled')
       ORDER BY b.fiscal_year DESC, b.department_name`,
      { t }
    );
    res.json({ budgets: r.recordset || [] });
  } catch (err) { next(err); }
});

export default router;
