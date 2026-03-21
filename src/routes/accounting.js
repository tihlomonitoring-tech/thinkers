import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { query, sql, request as poolRequest } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { renderCommercialPdf, stampCommercialPdfFooters, formatDate } from '../lib/accountingPdfLayout.js';
import { renderStatementPdf } from '../lib/statementAccountPdf.js';
import { computeStatementLineBalances, invoiceGrandTotal } from '../lib/statementLineBalance.js';

const router = Router();

async function fetchStatementLines(statementId) {
  try {
    const r = await query(
      `SELECT id, statement_id, sort_order, txn_date, reference, description, debit, credit, balance_after FROM accounting_statement_lines WHERE statement_id = @statementId ORDER BY sort_order`,
      { statementId }
    );
    return r.recordset || [];
  } catch {
    return [];
  }
}

async function replaceStatementLines(statementId, linesWithBalances) {
  await query(`DELETE FROM accounting_statement_lines WHERE statement_id = @statementId`, { statementId });
  for (let i = 0; i < linesWithBalances.length; i++) {
    const l = linesWithBalances[i];
    const r = await poolRequest();
    r.input('statement_id', sql.UniqueIdentifier, statementId);
    r.input('sort_order', sql.Int, i);
    const ymd = l.txn_date || null;
    r.input('txn_date', sql.Date, ymd ? new Date(ymd) : null);
    r.input('reference', sql.NVarChar(200), (l.reference && String(l.reference).slice(0, 200)) || null);
    r.input('description', sql.NVarChar(1000), (l.description != null && String(l.description).slice(0, 1000)) || '');
    const d = l.debit != null && l.debit !== '' ? Number(l.debit) : null;
    const c = l.credit != null && l.credit !== '' ? Number(l.credit) : null;
    r.input('debit', sql.Decimal(18, 2), d != null && !Number.isNaN(d) ? d : null);
    r.input('credit', sql.Decimal(18, 2), c != null && !Number.isNaN(c) ? c : null);
    const b = l.balance_after != null ? Number(l.balance_after) : null;
    r.input('balance_after', sql.Decimal(18, 2), b != null && !Number.isNaN(b) ? b : null);
    await r.query(
      `INSERT INTO accounting_statement_lines (id, statement_id, sort_order, txn_date, reference, description, debit, credit, balance_after) VALUES (NEWID(), @statement_id, @sort_order, @txn_date, @reference, @description, @debit, @credit, @balance_after)`
    );
  }
}

async function getStatementFull(id, tenantId) {
  const result = await query(
    `SELECT s.*, c.name AS customer_name, c.address AS customer_address, c.email AS customer_email, c.phone AS customer_phone
     FROM accounting_statements s LEFT JOIN accounting_customers c ON c.id = s.customer_id WHERE s.id = @id AND s.tenant_id = @tenantId`,
    { id, tenantId }
  );
  const st = result.recordset?.[0];
  if (!st) return null;
  const lines = await fetchStatementLines(id);
  return { ...st, lines };
}

/** Debit per invoice + credit line when status is paid (uses payment_date / payment_reference when present). */
async function buildInvoiceLinesFromCustomerInvoices(tenantId, customerId, dateFrom, dateTo) {
  const params = { tenantId, customer_id: customerId, date_from: dateFrom, date_to: dateTo };
  let invoices;
  try {
    const invResult = await query(
      `SELECT i.id, i.number, i.date, i.discount_percent, i.tax_percent, i.status, i.payment_date, i.payment_reference
       FROM accounting_invoices i
       WHERE i.tenant_id = @tenantId AND i.customer_id = @customer_id AND i.date IS NOT NULL
         AND CAST(i.date AS DATE) >= CAST(@date_from AS DATE) AND CAST(i.date AS DATE) <= CAST(@date_to AS DATE)
       ORDER BY i.date, i.number`,
      params
    );
    invoices = invResult.recordset || [];
  } catch (err) {
    if (!String(err?.message || '').includes('Invalid column name')) throw err;
    const invResult = await query(
      `SELECT i.id, i.number, i.date, i.discount_percent, i.tax_percent, i.status
       FROM accounting_invoices i
       WHERE i.tenant_id = @tenantId AND i.customer_id = @customer_id AND i.date IS NOT NULL
         AND CAST(i.date AS DATE) >= CAST(@date_from AS DATE) AND CAST(i.date AS DATE) <= CAST(@date_to AS DATE)
       ORDER BY i.date, i.number`,
      params
    );
    invoices = (invResult.recordset || []).map((r) => ({ ...r, payment_date: null, payment_reference: null }));
  }

  const lines = [];
  let paymentLines = 0;
  for (const inv of invoices) {
    const linesResult = await query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`,
      { id: inv.id }
    );
    const total = invoiceGrandTotal(inv, linesResult.recordset || []);
    const isPaid = String(inv.status || '').toLowerCase() === 'paid';
    const statusLabel = isPaid ? 'Paid' : 'Outstanding';
    lines.push({
      txn_date: inv.date,
      reference: inv.number,
      description: `Invoice ${inv.number} · ${statusLabel}`,
      debit: total,
      credit: null,
    });
    if (isPaid && total > 0) {
      const payRef =
        inv.payment_reference != null && String(inv.payment_reference).trim() !== ''
          ? String(inv.payment_reference).trim().slice(0, 200)
          : `Payment · ${inv.number}`;
      const payDate = inv.payment_date || inv.date;
      lines.push({
        txn_date: payDate,
        reference: payRef,
        description: `Payment received · Invoice ${inv.number}`,
        debit: null,
        credit: total,
      });
      paymentLines += 1;
    }
  }
  return { lines, invoices_count: invoices.length, payment_lines: paymentLines };
}

const uploadsRoot = path.join(process.cwd(), 'uploads', 'accounting');

function get(row, key) {
  if (!row) return undefined;
  const k = key.toLowerCase();
  const entry = Object.entries(row).find(([x]) => x && String(x).toLowerCase() === k);
  return entry ? entry[1] : undefined;
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('accounting_management'));

/** GET company settings for current tenant */
router.get('/company-settings', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT tenant_id, logo_path, company_name, address, vat_number, company_registration, website, email, payment_terms, banking_details, updated_at
       FROM accounting_company_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) {
      return res.json({
        company_name: '',
        address: '',
        vat_number: '',
        company_registration: '',
        website: '',
        email: '',
        payment_terms: '',
        banking_details: '',
        logo_url: null,
        updated_at: null,
      });
    }
    const logo_url = row.logo_path
      ? `/api/accounting/company-settings/logo`
      : null;
    res.json({
      company_name: row.company_name ?? '',
      address: row.address ?? '',
      vat_number: row.vat_number ?? '',
      company_registration: row.company_registration ?? '',
      website: row.website ?? '',
      email: row.email ?? '',
      payment_terms: row.payment_terms ?? '',
      banking_details: row.banking_details ?? '',
      logo_url,
      updated_at: row.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH company settings */
router.patch('/company-settings', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const {
      company_name,
      address,
      vat_number,
      company_registration,
      website,
      email,
      payment_terms,
      banking_details,
    } = req.body || {};
    await query(
      `MERGE accounting_company_settings AS t
       USING (SELECT @tenantId AS tenant_id) AS s ON t.tenant_id = s.tenant_id
       WHEN MATCHED THEN
         UPDATE SET
           company_name = @company_name,
           address = @address,
           vat_number = @vat_number,
           company_registration = @company_registration,
           website = @website,
           email = @email,
           payment_terms = @payment_terms,
           banking_details = @banking_details,
           updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (tenant_id, company_name, address, vat_number, company_registration, website, email, payment_terms, banking_details)
         VALUES (@tenantId, @company_name, @address, @vat_number, @company_registration, @website, @email, @payment_terms, @banking_details);`,
      {
        tenantId,
        company_name: company_name ?? '',
        address: address ?? '',
        vat_number: vat_number ?? '',
        company_registration: company_registration ?? '',
        website: website ?? '',
        email: email ?? '',
        payment_terms: payment_terms ?? '',
        banking_details: banking_details ?? '',
      }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Serve company logo (no multer, just read from path in DB) */
router.get('/company-settings/logo', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const logo_path = result.recordset?.[0]?.logo_path;
    if (!logo_path) return res.status(404).json({ error: 'Logo not set' });
    const filePath = path.join(process.cwd(), logo_path.replace(/\//g, path.sep));
    if (!filePath.startsWith(uploadsRoot) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Logo file not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

/** Upload company logo (multipart) */
router.post('/company-settings/logo', async (req, res, next) => {
  try {
    const multer = (await import('multer')).default;
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const dir = path.join(uploadsRoot, String(tenantId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, dir),
        filename: (_req, file, cb) => {
          const ext = (path.extname(file.originalname) || '.png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          cb(null, `logo.${ext}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
        cb(null, !!ok);
      },
    }).single('logo');
    upload(req, res, async (err) => {
      if (err) return next(err);
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });
      const relativePath = path.relative(process.cwd(), file.path);
      await query(
        `MERGE accounting_company_settings AS t
         USING (SELECT @tenantId AS tenant_id) AS s ON t.tenant_id = s.tenant_id
         WHEN MATCHED THEN UPDATE SET logo_path = @logo_path, updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (tenant_id, logo_path) VALUES (@tenantId, @logo_path);`,
        { tenantId, logo_path: relativePath }
      );
      res.json({ ok: true, logo_url: '/api/accounting/company-settings/logo' });
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Customers (Customer book) ----------
router.get('/customers', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at
       FROM accounting_customers WHERE tenant_id = @tenantId ORDER BY name`,
      { tenantId }
    );
    res.json({ customers: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/customers', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { name, address, email, phone, vat_number, company_registration } = req.body || {};
    if (!(name && String(name).trim())) return res.status(400).json({ error: 'Name is required' });
    const result = await query(
      `INSERT INTO accounting_customers (tenant_id, name, address, email, phone, vat_number, company_registration)
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.address, INSERTED.email, INSERTED.phone, INSERTED.vat_number, INSERTED.company_registration, INSERTED.created_at, INSERTED.updated_at
       VALUES (@tenantId, @name, @address, @email, @phone, @vat_number, @company_registration)`,
      {
        tenantId,
        name: String(name).trim(),
        address: address ?? '',
        email: email ?? '',
        phone: phone ?? '',
        vat_number: vat_number ?? '',
        company_registration: company_registration ?? '',
      }
    );
    const row = result.recordset?.[0];
    res.status(201).json({ customer: row });
  } catch (err) {
    next(err);
  }
});

router.get('/customers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at
       FROM accounting_customers WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.patch('/customers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const existing = await query(`SELECT id, name, address, email, phone, vat_number, company_registration FROM accounting_customers WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    const row = existing.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    const { name, address, email, phone, vat_number, company_registration } = req.body || {};
    const updates = {
      name: name !== undefined ? String(name).trim() : row.name,
      address: address !== undefined ? (address ?? '') : row.address,
      email: email !== undefined ? (email ?? '') : row.email,
      phone: phone !== undefined ? (phone ?? '') : row.phone,
      vat_number: vat_number !== undefined ? (vat_number ?? '') : row.vat_number,
      company_registration: company_registration !== undefined ? (company_registration ?? '') : row.company_registration,
    };
    await query(
      `UPDATE accounting_customers SET name = @name, address = @address, email = @email, phone = @phone, vat_number = @vat_number, company_registration = @company_registration, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, ...updates }
    );
    const getResult = await query(`SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at FROM accounting_customers WHERE id = @id`, { id });
    res.json(getResult.recordset?.[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/customers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`DELETE FROM accounting_customers OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Suppliers (Supplier book) ----------
router.get('/suppliers', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await poolRequest();
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(
      `SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at FROM accounting_suppliers WHERE tenant_id = @tenantId ORDER BY name`
    );
    res.json({ suppliers: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/suppliers', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { name, address, email, phone, vat_number, company_registration } = req.body || {};
    if (!(name && String(name).trim())) return res.status(400).json({ error: 'Name is required' });
    const r = await poolRequest();
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    r.input('name', String(name).trim());
    r.input('address', address ?? '');
    r.input('email', email ?? '');
    r.input('phone', phone ?? '');
    r.input('vat_number', vat_number ?? '');
    r.input('company_registration', company_registration ?? '');
    const result = await r.query(
      `INSERT INTO accounting_suppliers (tenant_id, name, address, email, phone, vat_number, company_registration) OUTPUT INSERTED.id, INSERTED.name, INSERTED.address, INSERTED.email, INSERTED.phone, INSERTED.vat_number, INSERTED.company_registration, INSERTED.created_at, INSERTED.updated_at VALUES (@tenantId, @name, @address, @email, @phone, @vat_number, @company_registration)`
    );
    res.status(201).json({ supplier: result.recordset?.[0] });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('Invalid object name') && msg.includes('accounting_suppliers')) {
      return res.status(503).json({
        error: 'Supplier book is not set up yet. Run: npm run db:accounting-discount-tax-suppliers-po-statements',
      });
    }
    next(err);
  }
});

router.get('/suppliers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const r = await poolRequest();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(`SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at FROM accounting_suppliers WHERE id = @id AND tenant_id = @tenantId`);
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.patch('/suppliers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const rSel = await poolRequest();
    rSel.input('id', sql.UniqueIdentifier, id);
    rSel.input('tenantId', sql.UniqueIdentifier, tenantId);
    const existing = await rSel.query(`SELECT id, name, address, email, phone, vat_number, company_registration FROM accounting_suppliers WHERE id = @id AND tenant_id = @tenantId`);
    const row = existing.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    const { name, address, email, phone, vat_number, company_registration } = req.body || {};
    const updates = {
      name: name !== undefined ? String(name).trim() : get(row, 'name'),
      address: address !== undefined ? (address ?? '') : get(row, 'address'),
      email: email !== undefined ? (email ?? '') : get(row, 'email'),
      phone: phone !== undefined ? (phone ?? '') : get(row, 'phone'),
      vat_number: vat_number !== undefined ? (vat_number ?? '') : get(row, 'vat_number'),
      company_registration: company_registration !== undefined ? (company_registration ?? '') : get(row, 'company_registration'),
    };
    const rUp = await poolRequest();
    rUp.input('id', sql.UniqueIdentifier, id);
    rUp.input('tenantId', sql.UniqueIdentifier, tenantId);
    rUp.input('name', updates.name);
    rUp.input('address', updates.address);
    rUp.input('email', updates.email);
    rUp.input('phone', updates.phone);
    rUp.input('vat_number', updates.vat_number);
    rUp.input('company_registration', updates.company_registration);
    await rUp.query(`UPDATE accounting_suppliers SET name = @name, address = @address, email = @email, phone = @phone, vat_number = @vat_number, company_registration = @company_registration, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`);
    const rGet = await poolRequest();
    rGet.input('id', sql.UniqueIdentifier, id);
    const getResult = await rGet.query(`SELECT id, name, address, email, phone, vat_number, company_registration, created_at, updated_at FROM accounting_suppliers WHERE id = @id`);
    res.json(getResult.recordset?.[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const r = await poolRequest();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(`DELETE FROM accounting_suppliers OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`);
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Items library (reusable line items for quotations, invoices, POs) ----------
router.get('/items', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, description, default_quantity, default_unit_price, discount_percent, tax_percent, created_at, updated_at FROM accounting_items WHERE tenant_id = @tenantId ORDER BY description`,
      { tenantId }
    );
    res.json({ items: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/items', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { description, default_quantity, default_unit_price, discount_percent, tax_percent } = req.body || {};
    const result = await query(
      `INSERT INTO accounting_items (tenant_id, description, default_quantity, default_unit_price, discount_percent, tax_percent) OUTPUT INSERTED.id, INSERTED.description, INSERTED.default_quantity, INSERTED.default_unit_price, INSERTED.discount_percent, INSERTED.tax_percent, INSERTED.created_at, INSERTED.updated_at VALUES (@tenantId, @description, @default_quantity, @default_unit_price, @discount_percent, @tax_percent)`,
      { tenantId, description: description ?? '', default_quantity: Number(default_quantity) || 1, default_unit_price: Number(default_unit_price) || 0, discount_percent: Number(discount_percent) || 0, tax_percent: Number(tax_percent) || 0 }
    );
    res.status(201).json({ item: result.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`SELECT id, description, default_quantity, default_unit_price, discount_percent, tax_percent, created_at, updated_at FROM accounting_items WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { description, default_quantity, default_unit_price, discount_percent, tax_percent } = req.body || {};
    const existing = await query(`SELECT id FROM accounting_items WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Item not found' });
    const updates = [];
    const params = { id, tenantId };
    if (description !== undefined) { updates.push('description = @description'); params.description = description ?? ''; }
    if (default_quantity !== undefined) { updates.push('default_quantity = @default_quantity'); params.default_quantity = Number(default_quantity) ?? 1; }
    if (default_unit_price !== undefined) { updates.push('default_unit_price = @default_unit_price'); params.default_unit_price = Number(default_unit_price) ?? 0; }
    if (discount_percent !== undefined) { updates.push('discount_percent = @discount_percent'); params.discount_percent = Number(discount_percent) ?? 0; }
    if (tax_percent !== undefined) { updates.push('tax_percent = @tax_percent'); params.tax_percent = Number(tax_percent) ?? 0; }
    if (updates.length) {
      updates.push('updated_at = SYSUTCDATETIME()');
      await query(`UPDATE accounting_items SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    }
    const getResult = await query(`SELECT id, description, default_quantity, default_unit_price, discount_percent, tax_percent, created_at, updated_at FROM accounting_items WHERE id = @id`, { id });
    res.json(getResult.recordset?.[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`DELETE FROM accounting_items OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Quotations ----------
async function nextQuotationNumber(tenantId) {
  const y = new Date().getFullYear();
  const result = await query(
    `SELECT number FROM accounting_quotations WHERE tenant_id = @tenantId AND number LIKE @prefix ORDER BY number DESC`,
    { tenantId, prefix: `Q-${y}-%` }
  );
  const last = result.recordset?.[0]?.number;
  const n = last ? parseInt(last.split('-').pop(), 10) + 1 : 1;
  return `Q-${y}-${String(n).padStart(3, '0')}`;
}

router.get('/quotations', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT q.id, q.tenant_id, q.number, q.customer_id, q.customer_name, q.customer_address, q.customer_email, q.date, q.valid_until, q.status, q.notes, q.created_at, q.updated_at,
        c.name AS customer_name_from_book
       FROM accounting_quotations q
       LEFT JOIN accounting_customers c ON c.id = q.customer_id
       WHERE q.tenant_id = @tenantId ORDER BY q.created_at DESC`,
      { tenantId }
    );
    const list = (result.recordset || []).map((r) => ({
      ...r,
      customer_display_name: r.customer_name_from_book || r.customer_name || '—',
    }));
    res.json({ quotations: list });
  } catch (err) {
    next(err);
  }
});

router.post('/quotations', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const number = await nextQuotationNumber(tenantId);
    const { customer_id, customer_name, customer_address, customer_email, date, valid_until, status, notes, discount_percent, tax_percent, lines } = req.body || {};
    const result = await query(
      `INSERT INTO accounting_quotations (tenant_id, number, customer_id, customer_name, customer_address, customer_email, date, valid_until, status, notes, discount_percent, tax_percent)
       OUTPUT INSERTED.id VALUES (@tenantId, @number, @customer_id, @customer_name, @customer_address, @customer_email, @date, @valid_until, @status, @notes, @discount_percent, @tax_percent)`,
      {
        tenantId,
        number,
        customer_id: customer_id || null,
        customer_name: customer_name ?? '',
        customer_address: customer_address ?? '',
        customer_email: customer_email ?? '',
        date: date || null,
        valid_until: valid_until || null,
        status: status ?? 'draft',
        notes: notes ?? '',
        discount_percent: Number(discount_percent) || 0,
        tax_percent: Number(tax_percent) || 0,
      }
    );
    const id = result.recordset?.[0]?.id;
    if (!id) return res.status(500).json({ error: 'Insert failed' });
    const lineRows = Array.isArray(lines) ? lines : [];
    for (let i = 0; i < lineRows.length; i++) {
      const l = lineRows[i];
      await query(
        `INSERT INTO accounting_quotation_lines (quotation_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@quotation_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`,
        {
          quotation_id: id,
          description: l.description ?? '',
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          discount_percent: Number(l.discount_percent) || 0,
          tax_percent: Number(l.tax_percent) || 0,
          sort_order: i,
        }
      );
    }
    const getResult = await query(
      `SELECT q.*, c.name AS customer_name_from_book FROM accounting_quotations q LEFT JOIN accounting_customers c ON c.id = q.customer_id WHERE q.id = @id`,
      { id }
    );
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    res.status(201).json({
      quotation: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/quotations/recipients', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N'' ORDER BY full_name, email`,
      { tenantId }
    );
    res.json({ recipients: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/quotations/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT q.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration
       FROM accounting_quotations q LEFT JOIN accounting_customers c ON c.id = q.customer_id WHERE q.id = @id AND q.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const q = result.recordset?.[0];
    if (!q) return res.status(404).json({ error: 'Quotation not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    res.json({ quotation: { ...q, lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.patch('/quotations/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { customer_id, customer_name, customer_address, customer_email, date, valid_until, status, notes, discount_percent, tax_percent, lines } = req.body || {};
    const existing = await query(`SELECT id FROM accounting_quotations WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Quotation not found' });
    const updates = [];
    const params = { id, tenantId };
    if (customer_id !== undefined) { updates.push('customer_id = @customer_id'); params.customer_id = customer_id || null; }
    if (customer_name !== undefined) { updates.push('customer_name = @customer_name'); params.customer_name = customer_name ?? ''; }
    if (customer_address !== undefined) { updates.push('customer_address = @customer_address'); params.customer_address = customer_address ?? ''; }
    if (customer_email !== undefined) { updates.push('customer_email = @customer_email'); params.customer_email = customer_email ?? ''; }
    if (date !== undefined) { updates.push('date = @date'); params.date = date || null; }
    if (valid_until !== undefined) { updates.push('valid_until = @valid_until'); params.valid_until = valid_until || null; }
    if (status !== undefined) { updates.push('status = @status'); params.status = status ?? 'draft'; }
    if (notes !== undefined) { updates.push('notes = @notes'); params.notes = notes ?? ''; }
    if (discount_percent !== undefined) { updates.push('discount_percent = @discount_percent'); params.discount_percent = Number(discount_percent) || 0; }
    if (tax_percent !== undefined) { updates.push('tax_percent = @tax_percent'); params.tax_percent = Number(tax_percent) || 0; }
    if (updates.length) {
      updates.push('updated_at = SYSUTCDATETIME()');
      await query(`UPDATE accounting_quotations SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    }
    if (Array.isArray(lines)) {
      await query(`DELETE FROM accounting_quotation_lines WHERE quotation_id = @id`, { id });
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await query(
          `INSERT INTO accounting_quotation_lines (quotation_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@quotation_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`,
          { quotation_id: id, description: l.description ?? '', quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0, sort_order: i }
        );
      }
    }
    const getResult = await query(`SELECT q.*, c.name AS customer_name_from_book FROM accounting_quotations q LEFT JOIN accounting_customers c ON c.id = q.customer_id WHERE q.id = @id`, { id });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    res.json({ quotation: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.delete('/quotations/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`DELETE FROM accounting_quotations OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Quotation not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function buildQuotationPdf(_tenantId, quotation, lines, company, logoBuffer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Quotation ${quotation.number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const custName = quotation.customer_name_from_book || quotation.customer_name || '';
    const custAddr = quotation.customer_address_from_book || quotation.customer_address || '';
    const custEmail = quotation.customer_email_from_book || quotation.customer_email || '';
    const partyLines = [custName, custAddr, custEmail, quotation.customer_vat ? `VAT: ${quotation.customer_vat}` : '', quotation.customer_registration ? `Reg: ${quotation.customer_registration}` : ''].filter(Boolean);
    const metaRows = [
      { label: 'Issue date', value: formatDate(quotation.date) },
      { label: 'Valid until', value: formatDate(quotation.valid_until) },
      { label: 'Status', value: quotation.status ? String(quotation.status) : '' },
    ];
    renderCommercialPdf(doc, {
      documentTitle: 'Quotation',
      documentNumber: quotation.number,
      company,
      logoBuffer,
      metaRows,
      partyLabel: 'Bill to',
      partyLines,
      lines,
      discountPercent: quotation.discount_percent,
      taxPercent: quotation.tax_percent,
      notes: quotation.notes,
      totalLabel: 'Total',
    });
    stampCommercialPdfFooters(doc, { documentTitle: 'Quotation', documentNumber: quotation.number });
    doc.end();
  });
}

router.get('/quotations/:id/pdf', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const qResult = await query(
      `SELECT q.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration FROM accounting_quotations q LEFT JOIN accounting_customers c ON c.id = q.customer_id WHERE q.id = @id AND q.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const quotation = qResult.recordset?.[0];
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    const lines = linesResult.recordset || [];
    const settingsResult = await query(`SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`, { tenantId });
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) {
      const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep));
      if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp);
    }
    const pdf = await buildQuotationPdf(tenantId, quotation, lines, company, logoBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="quotation-${quotation.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/quotations/:id/send-email', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { to_emails = [], cc_emails = [], subject, message } = req.body || {};
    const toList = Array.isArray(to_emails) ? to_emails : [].concat(to_emails ? [to_emails] : []);
    const ccList = Array.isArray(cc_emails) ? cc_emails : [].concat(cc_emails ? [cc_emails] : []);
    if (toList.length === 0) return res.status(400).json({ error: 'At least one To recipient required' });
    const qResult = await query(`SELECT q.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration FROM accounting_quotations q LEFT JOIN accounting_customers c ON c.id = q.customer_id WHERE q.id = @id AND q.tenant_id = @tenantId`, { id, tenantId });
    const quotation = qResult.recordset?.[0];
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    const lines = linesResult.recordset || [];
    const settingsResult = await query(`SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`, { tenantId });
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) {
      const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep));
      if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp);
    }
    const pdf = await buildQuotationPdf(tenantId, quotation, lines, company, logoBuffer);
    const subj = subject || `Quotation ${quotation.number}`;
    const body = message || `Please find attached quotation ${quotation.number}.`;
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured' });
    await sendEmail({
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      subject: subj,
      body: body,
      html: false,
      attachments: [{ filename: `quotation-${quotation.number}.pdf`, content: pdf }],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/quotations/:id/create-invoice', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const qResult = await query(`SELECT * FROM accounting_quotations WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    const quotation = qResult.recordset?.[0];
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const invNumResult = await query(
      `SELECT number FROM accounting_invoices WHERE tenant_id = @tenantId AND number LIKE @prefix ORDER BY number DESC`,
      { tenantId, prefix: `INV-${new Date().getFullYear()}-%` }
    );
    const lastInv = invNumResult.recordset?.[0]?.number;
    const n = lastInv ? parseInt(lastInv.split('-').pop(), 10) + 1 : 1;
    const number = `INV-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const invResult = await query(
      `INSERT INTO accounting_invoices (tenant_id, quotation_id, number, customer_id, customer_name, customer_address, customer_email, date, due_date, status, notes, discount_percent, tax_percent)
       OUTPUT INSERTED.id VALUES (@tenantId, @quotation_id, @number, @customer_id, @customer_name, @customer_address, @customer_email, @date, @due_date, @status, @notes, @discount_percent, @tax_percent)`,
      {
        tenantId,
        quotation_id: id,
        number,
        customer_id: quotation.customer_id || null,
        customer_name: quotation.customer_name ?? '',
        customer_address: quotation.customer_address ?? '',
        customer_email: quotation.customer_email ?? '',
        date: new Date().toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        status: 'draft',
        notes: quotation.notes ?? '',
        discount_percent: Number(quotation.discount_percent) || 0,
        tax_percent: Number(quotation.tax_percent) || 0,
      }
    );
    const invoiceId = invResult.recordset?.[0]?.id;
    if (!invoiceId) return res.status(500).json({ error: 'Insert failed' });
    const linesResult = await query(`SELECT description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_quotation_lines WHERE quotation_id = @id ORDER BY sort_order`, { id });
    const lineRows = linesResult.recordset || [];
    for (let i = 0; i < lineRows.length; i++) {
      const l = lineRows[i];
      await query(
        `INSERT INTO accounting_invoice_lines (invoice_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@invoice_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`,
        { invoice_id: invoiceId, description: l.description ?? '', quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0, sort_order: i }
      );
    }
    const getInv = await query(`SELECT * FROM accounting_invoices WHERE id = @id`, { id: invoiceId });
    const getLines = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id: invoiceId });
    res.status(201).json({ invoice: { ...getInv.recordset?.[0], lines: getLines.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

// ---------- Invoices ----------
async function nextInvoiceNumber(tenantId) {
  const y = new Date().getFullYear();
  const result = await query(
    `SELECT number FROM accounting_invoices WHERE tenant_id = @tenantId AND number LIKE @prefix ORDER BY number DESC`,
    { tenantId, prefix: `INV-${y}-%` }
  );
  const last = result.recordset?.[0]?.number;
  const n = last ? parseInt(last.split('-').pop(), 10) + 1 : 1;
  return `INV-${y}-${String(n).padStart(3, '0')}`;
}

router.get('/invoices', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    // Use i.* so the list works even if optional columns (payment_*, is_recurring) are not migrated yet
    const result = await query(
      `SELECT i.*, c.name AS customer_name_from_book
       FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.tenant_id = @tenantId ORDER BY i.created_at DESC`,
      { tenantId }
    );
    const list = (result.recordset || []).map((r) => ({ ...r, customer_display_name: r.customer_name_from_book || r.customer_name || '—' }));
    res.json({ invoices: list });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices/recipients', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N'' ORDER BY full_name, email`,
      { tenantId }
    );
    res.json({ recipients: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/invoices', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const number = await nextInvoiceNumber(tenantId);
    const { quotation_id, customer_id, customer_name, customer_address, customer_email, date, due_date, status, notes, discount_percent, tax_percent, is_recurring, lines } = req.body || {};
    const result = await query(
      `INSERT INTO accounting_invoices (tenant_id, quotation_id, number, customer_id, customer_name, customer_address, customer_email, date, due_date, status, notes, discount_percent, tax_percent, is_recurring)
       OUTPUT INSERTED.id VALUES (@tenantId, @quotation_id, @number, @customer_id, @customer_name, @customer_address, @customer_email, @date, @due_date, @status, @notes, @discount_percent, @tax_percent, @is_recurring)`,
      {
        tenantId,
        quotation_id: quotation_id || null,
        number,
        customer_id: customer_id || null,
        customer_name: customer_name ?? '',
        customer_address: customer_address ?? '',
        customer_email: customer_email ?? '',
        date: date || null,
        due_date: due_date || null,
        status: status ?? 'draft',
        notes: notes ?? '',
        discount_percent: Number(discount_percent) || 0,
        tax_percent: Number(tax_percent) || 0,
        is_recurring: is_recurring ? 1 : 0,
      }
    );
    const id = result.recordset?.[0]?.id;
    if (!id) return res.status(500).json({ error: 'Insert failed' });
    const lineRows = Array.isArray(lines) ? lines : [];
    for (let i = 0; i < lineRows.length; i++) {
      const l = lineRows[i];
      await query(
        `INSERT INTO accounting_invoice_lines (invoice_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@invoice_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`,
        { invoice_id: id, description: l.description ?? '', quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0, sort_order: i }
      );
    }
    const getResult = await query(`SELECT i.*, c.name AS customer_name_from_book FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id`, { id });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    res.status(201).json({ invoice: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

/** Record payment: sets status to paid and stores payment date + reference */
router.post('/invoices/:id/mark-paid', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const { payment_date, payment_reference } = req.body || {};
    if (!payment_date || !String(payment_date).trim()) {
      return res.status(400).json({ error: 'Payment date is required' });
    }
    if (payment_reference == null || !String(payment_reference).trim()) {
      return res.status(400).json({ error: 'Payment reference is required' });
    }
    const existing = await query(`SELECT id FROM accounting_invoices WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Invoice not found' });
    await query(
      `UPDATE accounting_invoices SET status = N'paid', payment_date = @payment_date, payment_reference = @payment_reference, updated_at = SYSUTCDATETIME() WHERE id = @id AND tenant_id = @tenantId`,
      {
        id,
        tenantId,
        payment_date: String(payment_date).trim().slice(0, 10),
        payment_reference: String(payment_reference).trim().slice(0, 500),
      }
    );
    const getResult = await query(
      `SELECT i.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration
       FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id`,
      { id }
    );
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    res.json({ invoice: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(
      `SELECT i.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration
       FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id AND i.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const inv = result.recordset?.[0];
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    res.json({ invoice: { ...inv, lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.patch('/invoices/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { customer_id, customer_name, customer_address, customer_email, date, due_date, status, notes, discount_percent, tax_percent, is_recurring, lines } = req.body || {};
    const existing = await query(`SELECT id FROM accounting_invoices WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Invoice not found' });
    const updates = [];
    const params = { id, tenantId };
    if (customer_id !== undefined) { updates.push('customer_id = @customer_id'); params.customer_id = customer_id || null; }
    if (customer_name !== undefined) { updates.push('customer_name = @customer_name'); params.customer_name = customer_name ?? ''; }
    if (customer_address !== undefined) { updates.push('customer_address = @customer_address'); params.customer_address = customer_address ?? ''; }
    if (customer_email !== undefined) { updates.push('customer_email = @customer_email'); params.customer_email = customer_email ?? ''; }
    if (date !== undefined) { updates.push('date = @date'); params.date = date || null; }
    if (due_date !== undefined) { updates.push('due_date = @due_date'); params.due_date = due_date || null; }
    if (status !== undefined) {
      params.status = status ?? 'draft';
      updates.push('status = @status');
      if (String(params.status).toLowerCase() !== 'paid') {
        updates.push('payment_date = NULL');
        updates.push('payment_reference = NULL');
      }
    }
    if (notes !== undefined) { updates.push('notes = @notes'); params.notes = notes ?? ''; }
    if (discount_percent !== undefined) { updates.push('discount_percent = @discount_percent'); params.discount_percent = Number(discount_percent) || 0; }
    if (tax_percent !== undefined) { updates.push('tax_percent = @tax_percent'); params.tax_percent = Number(tax_percent) || 0; }
    if (is_recurring !== undefined) { updates.push('is_recurring = @is_recurring'); params.is_recurring = is_recurring ? 1 : 0; }
    if (updates.length) {
      updates.push('updated_at = SYSUTCDATETIME()');
      await query(`UPDATE accounting_invoices SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params);
    }
    if (Array.isArray(lines)) {
      await query(`DELETE FROM accounting_invoice_lines WHERE invoice_id = @id`, { id });
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await query(
          `INSERT INTO accounting_invoice_lines (invoice_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@invoice_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`,
          { invoice_id: id, description: l.description ?? '', quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0, sort_order: i }
        );
      }
    }
    const getResult = await query(`SELECT i.*, c.name AS customer_name_from_book FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id`, { id });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    res.json({ invoice: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.delete('/invoices/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`DELETE FROM accounting_invoices OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function buildInvoicePdf(_tenantId, invoice, lines, company, logoBuffer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Invoice ${invoice.number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const custName = invoice.customer_name_from_book || invoice.customer_name || '';
    const custAddr = invoice.customer_address_from_book || invoice.customer_address || '';
    const custEmail = invoice.customer_email_from_book || invoice.customer_email || '';
    const partyLines = [custName, custAddr, custEmail, invoice.customer_vat ? `VAT: ${invoice.customer_vat}` : '', invoice.customer_registration ? `Reg: ${invoice.customer_registration}` : ''].filter(Boolean);
    const metaRows = [
      { label: 'Issue date', value: formatDate(invoice.date) },
      { label: 'Due date', value: formatDate(invoice.due_date) },
      { label: 'Status', value: invoice.status ? String(invoice.status) : '' },
    ];
    if (String(invoice.status || '').toLowerCase() === 'paid') {
      if (invoice.payment_date) metaRows.push({ label: 'Paid on', value: formatDate(invoice.payment_date) });
      if (invoice.payment_reference) metaRows.push({ label: 'Payment ref.', value: String(invoice.payment_reference) });
    }
    renderCommercialPdf(doc, {
      documentTitle: 'Invoice',
      documentNumber: invoice.number,
      company,
      logoBuffer,
      metaRows,
      partyLabel: 'Bill to',
      partyLines,
      lines,
      discountPercent: invoice.discount_percent,
      taxPercent: invoice.tax_percent,
      notes: invoice.notes,
      totalLabel: 'Amount due',
    });
    stampCommercialPdfFooters(doc, { documentTitle: 'Invoice', documentNumber: invoice.number });
    doc.end();
  });
}

router.get('/invoices/:id/pdf', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const invResult = await query(
      `SELECT i.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id AND i.tenant_id = @tenantId`,
      { id, tenantId }
    );
    const invoice = invResult.recordset?.[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    const lines = linesResult.recordset || [];
    const settingsResult = await query(`SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`, { tenantId });
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) {
      const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep));
      if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp);
    }
    const pdf = await buildInvoicePdf(tenantId, invoice, lines, company, logoBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/invoices/:id/send-email', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { to_emails = [], cc_emails = [], subject, message } = req.body || {};
    const toList = Array.isArray(to_emails) ? to_emails : [].concat(to_emails ? [to_emails] : []);
    const ccList = Array.isArray(cc_emails) ? cc_emails : [].concat(cc_emails ? [cc_emails] : []);
    if (toList.length === 0) return res.status(400).json({ error: 'At least one To recipient required' });
    const invResult = await query(`SELECT i.*, c.name AS customer_name_from_book, c.address AS customer_address_from_book, c.email AS customer_email_from_book, c.vat_number AS customer_vat, c.company_registration AS customer_registration FROM accounting_invoices i LEFT JOIN accounting_customers c ON c.id = i.customer_id WHERE i.id = @id AND i.tenant_id = @tenantId`, { id, tenantId });
    const invoice = invResult.recordset?.[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const linesResult = await query(`SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_invoice_lines WHERE invoice_id = @id ORDER BY sort_order`, { id });
    const lines = linesResult.recordset || [];
    const settingsResult = await query(`SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`, { tenantId });
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) {
      const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep));
      if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp);
    }
    const pdf = await buildInvoicePdf(tenantId, invoice, lines, company, logoBuffer);
    const subj = subject || `Invoice ${invoice.number}`;
    const body = message || `Please find attached invoice ${invoice.number}.`;
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured' });
    await sendEmail({
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      subject: subj,
      body: body,
      html: false,
      attachments: [{ filename: `invoice-${invoice.number}.pdf`, content: pdf }],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Purchase orders ----------
async function nextPONumber(tenantId) {
  const y = new Date().getFullYear();
  const prefix = `PO-${y}-%`;
  const r = await poolRequest();
  r.input('tenantId', sql.UniqueIdentifier, tenantId);
  r.input('prefix', prefix);
  const result = await r.query(
    `SELECT TOP 1 number FROM accounting_purchase_orders WHERE tenant_id = @tenantId AND number LIKE @prefix ORDER BY number DESC`
  );
  const last = result.recordset?.[0]?.number;
  const n = last ? parseInt(String(last).split('-').pop(), 10) + 1 : 1;
  return `PO-${y}-${String(n).padStart(3, '0')}`;
}

router.get('/purchase-orders', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await poolRequest();
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(
      `SELECT p.id, p.tenant_id, p.number, p.supplier_id, p.supplier_name, p.supplier_address, p.supplier_email, p.date, p.due_date, p.status, p.notes, p.created_at, p.updated_at, s.name AS supplier_name_from_book
       FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.tenant_id = @tenantId ORDER BY p.created_at DESC`
    );
    const list = (result.recordset || []).map((row) => ({ ...row, supplier_display_name: row.supplier_name_from_book || row.supplier_name || '—' }));
    res.json({ purchase_orders: list });
  } catch (err) {
    next(err);
  }
});

router.get('/purchase-orders/recipients', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const r = await poolRequest();
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(
      `SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N'' ORDER BY full_name, email`
    );
    res.json({ recipients: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const number = await nextPONumber(tenantId);
    const { supplier_id, supplier_name, supplier_address, supplier_email, date, due_date, status, notes, discount_percent, tax_percent, lines } = req.body || {};
    const r = await poolRequest();
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    r.input('number', number);
    r.input('supplier_id', sql.UniqueIdentifier, supplier_id || null);
    r.input('supplier_name', supplier_name ?? '');
    r.input('supplier_address', supplier_address ?? '');
    r.input('supplier_email', supplier_email ?? '');
    r.input('date', sql.Date, date ? new Date(date) : null);
    r.input('due_date', sql.Date, due_date ? new Date(due_date) : null);
    r.input('status', status ?? 'draft');
    r.input('notes', notes ?? '');
    r.input('discount_percent', Number(discount_percent) || 0);
    r.input('tax_percent', Number(tax_percent) || 0);
    const result = await r.query(
      `INSERT INTO accounting_purchase_orders (tenant_id, number, supplier_id, supplier_name, supplier_address, supplier_email, date, due_date, status, notes, discount_percent, tax_percent) OUTPUT INSERTED.id VALUES (@tenantId, @number, @supplier_id, @supplier_name, @supplier_address, @supplier_email, @date, @due_date, @status, @notes, @discount_percent, @tax_percent)`
    );
    const id = get(result.recordset?.[0], 'id');
    if (!id) return res.status(500).json({ error: 'Insert failed' });
    const lineRows = Array.isArray(lines) ? lines : [];
    for (let i = 0; i < lineRows.length; i++) {
      const l = lineRows[i];
      const rLine = await poolRequest();
      rLine.input('po_id', sql.UniqueIdentifier, id);
      rLine.input('description', l.description ?? '');
      rLine.input('quantity', Number(l.quantity) || 1);
      rLine.input('unit_price', Number(l.unit_price) || 0);
      rLine.input('discount_percent', Number(l.discount_percent) || 0);
      rLine.input('tax_percent', Number(l.tax_percent) || 0);
      rLine.input('sort_order', i);
      await rLine.query(
        `INSERT INTO accounting_purchase_order_lines (purchase_order_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@po_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`
      );
    }
    const rGet = await poolRequest();
    rGet.input('id', sql.UniqueIdentifier, id);
    const getResult = await rGet.query(
      `SELECT p.*, s.name AS supplier_name_from_book FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.id = @id`
    );
    const rLines = await poolRequest();
    rLines.input('id', sql.UniqueIdentifier, id);
    const linesResult = await rLines.query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_purchase_order_lines WHERE purchase_order_id = @id ORDER BY sort_order`
    );
    res.status(201).json({ purchase_order: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('Invalid column name') && (msg.includes('discount_percent') || msg.includes('tax_percent'))) {
      return res.status(503).json({
        error:
          'Purchase order lines table is missing discount/tax columns. Run: npm run db:accounting-discount-tax-suppliers-po-statements',
      });
    }
    if (msg.includes('Invalid object name') && msg.includes('accounting_purchase')) {
      return res.status(503).json({
        error: 'Purchase orders are not set up yet. Run: npm run db:accounting-discount-tax-suppliers-po-statements',
      });
    }
    next(err);
  }
});

router.get('/purchase-orders/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const r = await poolRequest();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(
      `SELECT p.*, s.name AS supplier_name_from_book, s.address AS supplier_address_from_book, s.email AS supplier_email_from_book, s.vat_number AS supplier_vat, s.company_registration AS supplier_registration FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.id = @id AND p.tenant_id = @tenantId`
    );
    const po = result.recordset?.[0];
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const rLines = await poolRequest();
    rLines.input('id', sql.UniqueIdentifier, id);
    const linesResult = await rLines.query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_purchase_order_lines WHERE purchase_order_id = @id ORDER BY sort_order`
    );
    res.json({ purchase_order: { ...po, lines: linesResult.recordset || [] } });
  } catch (err) {
    next(err);
  }
});

router.patch('/purchase-orders/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const { supplier_id, supplier_name, supplier_address, supplier_email, date, due_date, status, notes, discount_percent, tax_percent, lines } = req.body || {};
    const rExist = await poolRequest();
    rExist.input('id', sql.UniqueIdentifier, id);
    rExist.input('tenantId', sql.UniqueIdentifier, tenantId);
    const existing = await rExist.query(`SELECT id FROM accounting_purchase_orders WHERE id = @id AND tenant_id = @tenantId`);
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Purchase order not found' });
    const updates = [];
    const rUp = await poolRequest();
    rUp.input('id', sql.UniqueIdentifier, id);
    rUp.input('tenantId', sql.UniqueIdentifier, tenantId);
    if (supplier_id !== undefined) {
      updates.push('supplier_id = @supplier_id');
      rUp.input('supplier_id', sql.UniqueIdentifier, supplier_id || null);
    }
    if (supplier_name !== undefined) {
      updates.push('supplier_name = @supplier_name');
      rUp.input('supplier_name', supplier_name ?? '');
    }
    if (supplier_address !== undefined) {
      updates.push('supplier_address = @supplier_address');
      rUp.input('supplier_address', supplier_address ?? '');
    }
    if (supplier_email !== undefined) {
      updates.push('supplier_email = @supplier_email');
      rUp.input('supplier_email', supplier_email ?? '');
    }
    if (date !== undefined) {
      updates.push('date = @date');
      rUp.input('date', sql.Date, date ? new Date(date) : null);
    }
    if (due_date !== undefined) {
      updates.push('due_date = @due_date');
      rUp.input('due_date', sql.Date, due_date ? new Date(due_date) : null);
    }
    if (status !== undefined) {
      updates.push('status = @status');
      rUp.input('status', status ?? 'draft');
    }
    if (notes !== undefined) {
      updates.push('notes = @notes');
      rUp.input('notes', notes ?? '');
    }
    if (discount_percent !== undefined) {
      updates.push('discount_percent = @discount_percent');
      rUp.input('discount_percent', Number(discount_percent) || 0);
    }
    if (tax_percent !== undefined) {
      updates.push('tax_percent = @tax_percent');
      rUp.input('tax_percent', Number(tax_percent) || 0);
    }
    if (updates.length) {
      updates.push('updated_at = SYSUTCDATETIME()');
      await rUp.query(`UPDATE accounting_purchase_orders SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`);
    }
    if (Array.isArray(lines)) {
      const rDel = await poolRequest();
      rDel.input('id', sql.UniqueIdentifier, id);
      await rDel.query(`DELETE FROM accounting_purchase_order_lines WHERE purchase_order_id = @id`);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const rLine = await poolRequest();
        rLine.input('po_id', sql.UniqueIdentifier, id);
        rLine.input('description', l.description ?? '');
        rLine.input('quantity', Number(l.quantity) || 1);
        rLine.input('unit_price', Number(l.unit_price) || 0);
        rLine.input('discount_percent', Number(l.discount_percent) || 0);
        rLine.input('tax_percent', Number(l.tax_percent) || 0);
        rLine.input('sort_order', i);
        await rLine.query(
          `INSERT INTO accounting_purchase_order_lines (purchase_order_id, description, quantity, unit_price, discount_percent, tax_percent, sort_order) VALUES (@po_id, @description, @quantity, @unit_price, @discount_percent, @tax_percent, @sort_order)`
        );
      }
    }
    const rGet = await poolRequest();
    rGet.input('id', sql.UniqueIdentifier, id);
    const getResult = await rGet.query(
      `SELECT p.*, s.name AS supplier_name_from_book FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.id = @id`
    );
    const rLines = await poolRequest();
    rLines.input('id', sql.UniqueIdentifier, id);
    const linesResult = await rLines.query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_purchase_order_lines WHERE purchase_order_id = @id ORDER BY sort_order`
    );
    res.json({ purchase_order: { ...getResult.recordset?.[0], lines: linesResult.recordset || [] } });
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('Invalid column name') && (msg.includes('discount_percent') || msg.includes('tax_percent'))) {
      return res.status(503).json({
        error:
          'Purchase order lines table is missing discount/tax columns. Run: npm run db:accounting-discount-tax-suppliers-po-statements',
      });
    }
    next(err);
  }
});

router.delete('/purchase-orders/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const r = await poolRequest();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('tenantId', sql.UniqueIdentifier, tenantId);
    const result = await r.query(`DELETE FROM accounting_purchase_orders OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`);
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function buildPurchaseOrderPdf(_tenantId, po, lines, company, logoBuffer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Purchase order ${po.number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const supName = po.supplier_name_from_book || po.supplier_name || '';
    const supAddr = po.supplier_address_from_book || po.supplier_address || '';
    const supEmail = po.supplier_email_from_book || po.supplier_email || '';
    const partyLines = [supName, supAddr, supEmail, po.supplier_vat ? `VAT: ${po.supplier_vat}` : '', po.supplier_registration ? `Reg: ${po.supplier_registration}` : ''].filter(Boolean);
    const metaRows = [
      { label: 'Order date', value: formatDate(po.date) },
      { label: 'Due date', value: formatDate(po.due_date) },
      { label: 'Status', value: po.status ? String(po.status) : '' },
    ];
    renderCommercialPdf(doc, {
      documentTitle: 'Purchase order',
      documentNumber: po.number,
      company,
      logoBuffer,
      metaRows,
      partyLabel: 'Supplier',
      partyLines,
      lines,
      discountPercent: po.discount_percent,
      taxPercent: po.tax_percent,
      notes: po.notes,
      totalLabel: 'Order total',
    });
    stampCommercialPdfFooters(doc, { documentTitle: 'Purchase order', documentNumber: po.number });
    doc.end();
  });
}

router.get('/purchase-orders/:id/pdf', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const rPo = await poolRequest();
    rPo.input('id', sql.UniqueIdentifier, id);
    rPo.input('tenantId', sql.UniqueIdentifier, tenantId);
    const poResult = await rPo.query(
      `SELECT p.*, s.name AS supplier_name_from_book, s.address AS supplier_address_from_book, s.email AS supplier_email_from_book, s.vat_number AS supplier_vat, s.company_registration AS supplier_registration FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.id = @id AND p.tenant_id = @tenantId`
    );
    const po = poResult.recordset?.[0];
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const rLines = await poolRequest();
    rLines.input('id', sql.UniqueIdentifier, id);
    const linesResult = await rLines.query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_purchase_order_lines WHERE purchase_order_id = @id ORDER BY sort_order`
    );
    const lines = linesResult.recordset || [];
    const rSet = await poolRequest();
    rSet.input('tenantId', sql.UniqueIdentifier, tenantId);
    const settingsResult = await rSet.query(
      `SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`
    );
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) { const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep)); if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp); }
    const pdf = await buildPurchaseOrderPdf(tenantId, po, lines, company, logoBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="purchase-order-${po.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/send-email', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const { to_emails = [], cc_emails = [], subject, message } = req.body || {};
    const toList = Array.isArray(to_emails) ? to_emails : [].concat(to_emails ? [to_emails] : []);
    const ccList = Array.isArray(cc_emails) ? cc_emails : [].concat(cc_emails ? [cc_emails] : []);
    if (toList.length === 0) return res.status(400).json({ error: 'At least one To recipient required' });
    const rPo = await poolRequest();
    rPo.input('id', sql.UniqueIdentifier, id);
    rPo.input('tenantId', sql.UniqueIdentifier, tenantId);
    const poResult = await rPo.query(
      `SELECT p.*, s.name AS supplier_name_from_book, s.address AS supplier_address_from_book, s.email AS supplier_email_from_book FROM accounting_purchase_orders p LEFT JOIN accounting_suppliers s ON s.id = p.supplier_id WHERE p.id = @id AND p.tenant_id = @tenantId`
    );
    const po = poResult.recordset?.[0];
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    const rLines = await poolRequest();
    rLines.input('id', sql.UniqueIdentifier, id);
    const linesResult = await rLines.query(
      `SELECT id, description, quantity, unit_price, discount_percent, tax_percent, sort_order FROM accounting_purchase_order_lines WHERE purchase_order_id = @id ORDER BY sort_order`
    );
    const lines = linesResult.recordset || [];
    const rSet = await poolRequest();
    rSet.input('tenantId', sql.UniqueIdentifier, tenantId);
    const settingsResult = await rSet.query(
      `SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`
    );
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) { const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep)); if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp); }
    const pdf = await buildPurchaseOrderPdf(tenantId, po, lines, company, logoBuffer);
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured' });
    await sendEmail({ to: toList.join(', '), cc: ccList.length ? ccList.join(', ') : undefined, subject: subject || `Purchase order ${po.number}`, body: message || `Please find attached purchase order ${po.number}.`, html: false, attachments: [{ filename: `purchase-order-${po.number}.pdf`, content: pdf }] });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Statements ----------
router.get('/statements', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(
      `SELECT s.*, c.name AS customer_name FROM accounting_statements s LEFT JOIN accounting_customers c ON c.id = s.customer_id WHERE s.tenant_id = @tenantId ORDER BY s.created_at DESC`,
      { tenantId }
    );
    res.json({ statements: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/statements/recipients', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const result = await query(`SELECT id, email, full_name FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N'' ORDER BY full_name, email`, { tenantId });
    res.json({ recipients: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/statements', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const body = req.body || {};
    const {
      type,
      customer_id,
      title,
      content,
      preamble,
      statement_date,
      date_from,
      date_to,
      opening_balance,
      currency,
      statement_ref,
      lines: linesIn,
    } = body;
    const linesRaw = Array.isArray(linesIn) ? linesIn : [];
    const opening = Number(opening_balance) || 0;
    const computed = computeStatementLineBalances(opening, linesRaw);
    const result = await query(
      `INSERT INTO accounting_statements (tenant_id, type, customer_id, title, content, preamble, statement_date, date_from, date_to, opening_balance, currency, statement_ref) OUTPUT INSERTED.id VALUES (@tenantId, @type, @customer_id, @title, @content, @preamble, @statement_date, @date_from, @date_to, @opening_balance, @currency, @statement_ref)`,
      {
        tenantId,
        type: type ?? 'customer',
        customer_id: customer_id || null,
        title: title ?? '',
        content: content ?? '',
        preamble: preamble ?? '',
        statement_date: statement_date || null,
        date_from: date_from || null,
        date_to: date_to || null,
        opening_balance: opening,
        currency: (currency && String(currency).slice(0, 10)) || 'ZAR',
        statement_ref: (statement_ref && String(statement_ref).slice(0, 100)) || null,
      }
    );
    const id = result.recordset?.[0]?.id;
    if (!id) return res.status(500).json({ error: 'Insert failed' });
    await replaceStatementLines(id, computed);
    const full = await getStatementFull(id, tenantId);
    res.status(201).json({ statement: full });
  } catch (err) {
    if (String(err?.message || '').includes('Invalid column name') || String(err?.message || '').includes('preamble')) {
      return res.status(503).json({
        error: 'Statements need the latest schema. Run: npm run db:accounting-statement-lines',
      });
    }
    next(err);
  }
});

router.get('/statements/preview/customer-invoices', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const customer_id = req.query.customer_id;
    const date_from = req.query.date_from;
    const date_to = req.query.date_to;
    if (!customer_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'customer_id, date_from, and date_to query params are required' });
    }
    const out = await buildInvoiceLinesFromCustomerInvoices(tenantId, customer_id, date_from, date_to);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/statements/:id/import-invoices', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { id } = req.params;
    const { date_from, date_to } = req.body || {};
    if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to are required' });
    const st = await getStatementFull(id, tenantId);
    if (!st) return res.status(404).json({ error: 'Statement not found' });
    if (!st.customer_id) return res.status(400).json({ error: 'Select a customer on this statement first' });
    const { replace_existing } = req.body || {};
    const built = await buildInvoiceLinesFromCustomerInvoices(tenantId, st.customer_id, date_from, date_to);
    const appended = built.lines;
    const existing = (st.lines || []).map((l) => ({
      txn_date: l.txn_date,
      reference: l.reference,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
    }));
    const merged = replace_existing ? appended : [...existing, ...appended];
    const computed = computeStatementLineBalances(Number(st.opening_balance) || 0, merged);
    await replaceStatementLines(id, computed);
    const full = await getStatementFull(id, tenantId);
    res.json({
      statement: full,
      imported_count: built.invoices_count,
      lines_added: appended.length,
      payment_lines: built.payment_lines,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/statements/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const full = await getStatementFull(id, tenantId);
    if (!full) return res.status(404).json({ error: 'Statement not found' });
    res.json({ statement: full });
  } catch (err) {
    next(err);
  }
});

router.patch('/statements/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const body = req.body || {};
    const {
      type,
      customer_id,
      title,
      content,
      preamble,
      statement_date,
      date_from,
      date_to,
      opening_balance,
      currency,
      statement_ref,
      lines: linesIn,
    } = body;
    const existing = await query(`SELECT id FROM accounting_statements WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!existing.recordset?.[0]) return res.status(404).json({ error: 'Statement not found' });
    const updates = [];
    const params = { id, tenantId };
    if (type !== undefined) { updates.push('type = @type'); params.type = type ?? 'customer'; }
    if (customer_id !== undefined) { updates.push('customer_id = @customer_id'); params.customer_id = customer_id || null; }
    if (title !== undefined) { updates.push('title = @title'); params.title = title ?? ''; }
    if (content !== undefined) { updates.push('content = @content'); params.content = content ?? ''; }
    if (preamble !== undefined) { updates.push('preamble = @preamble'); params.preamble = preamble ?? ''; }
    if (statement_date !== undefined) { updates.push('statement_date = @statement_date'); params.statement_date = statement_date || null; }
    if (date_from !== undefined) { updates.push('date_from = @date_from'); params.date_from = date_from || null; }
    if (date_to !== undefined) { updates.push('date_to = @date_to'); params.date_to = date_to || null; }
    if (opening_balance !== undefined) { updates.push('opening_balance = @opening_balance'); params.opening_balance = Number(opening_balance) || 0; }
    if (currency !== undefined) { updates.push('currency = @currency'); params.currency = (currency && String(currency).slice(0, 10)) || 'ZAR'; }
    if (statement_ref !== undefined) { updates.push('statement_ref = @statement_ref'); params.statement_ref = (statement_ref && String(statement_ref).slice(0, 100)) || null; }
    if (updates.length) { updates.push('updated_at = SYSUTCDATETIME()'); await query(`UPDATE accounting_statements SET ${updates.join(', ')} WHERE id = @id AND tenant_id = @tenantId`, params); }
    if (Array.isArray(linesIn)) {
      const row = await query(`SELECT opening_balance FROM accounting_statements WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
      const ob = Number(row.recordset?.[0]?.opening_balance) || 0;
      const computed = computeStatementLineBalances(ob, linesIn);
      await replaceStatementLines(id, computed);
    }
    const full = await getStatementFull(id, tenantId);
    res.json({ statement: full });
  } catch (err) {
    next(err);
  }
});

router.delete('/statements/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const result = await query(`DELETE FROM accounting_statements OUTPUT DELETED.id WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId });
    if (!result.recordset?.[0]) return res.status(404).json({ error: 'Statement not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function buildStatementPdf(statement, company, logoBuffer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: statement.title || 'Statement' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderStatementPdf(doc, statement, company, logoBuffer);
    doc.end();
  });
}

router.get('/statements/:id/pdf', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const statement = await getStatementFull(id, tenantId);
    if (!statement) return res.status(404).json({ error: 'Statement not found' });
    const settingsResult = await query(
      `SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) { const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep)); if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp); }
    const pdf = await buildStatementPdf(statement, company, logoBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    const safeTitle = String(statement.title || 'statement')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80);
    res.setHeader('Content-Disposition', `inline; filename="statement-${safeTitle || statement.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.get('/statements/:id/excel', async (req, res, next) => {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const statement = await getStatementFull(id, tenantId);
    if (!statement) return res.status(404).json({ error: 'Statement not found' });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Summary');
    sheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Statement date', key: 'statement_date', width: 14 },
      { header: 'Period from', key: 'date_from', width: 12 },
      { header: 'Period to', key: 'date_to', width: 12 },
      { header: 'Customer', key: 'customer_name', width: 28 },
      { header: 'Ref', key: 'statement_ref', width: 14 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Opening balance', key: 'opening_balance', width: 16 },
    ];
    sheet.addRow({
      title: statement.title,
      statement_date: statement.statement_date ? new Date(statement.statement_date).toISOString().slice(0, 10) : '',
      date_from: statement.date_from ? new Date(statement.date_from).toISOString().slice(0, 10) : '',
      date_to: statement.date_to ? new Date(statement.date_to).toISOString().slice(0, 10) : '',
      customer_name: statement.customer_name || '',
      statement_ref: statement.statement_ref || '',
      currency: statement.currency || 'ZAR',
      opening_balance: statement.opening_balance != null ? Number(statement.opening_balance) : '',
    });
    sheet.addRow({ title: 'Preamble / notes (above table)' });
    sheet.addRow({ title: (statement.preamble || '').slice(0, 32000) });
    sheet.addRow({ title: 'Banking / footer (content field)' });
    sheet.addRow({ title: (statement.content || '').slice(0, 32000) });
    const tx = workbook.addWorksheet('Transactions');
    tx.columns = [
      { header: 'Date', key: 'txn_date', width: 12 },
      { header: 'Reference', key: 'reference', width: 18 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Debit', key: 'debit', width: 14 },
      { header: 'Credit', key: 'credit', width: 14 },
      { header: 'Balance', key: 'balance_after', width: 14 },
    ];
    const lines = statement.lines || [];
    for (const l of lines) {
      tx.addRow({
        txn_date: l.txn_date ? new Date(l.txn_date).toISOString().slice(0, 10) : '',
        reference: l.reference || '',
        description: l.description || '',
        debit: l.debit != null ? Number(l.debit) : '',
        credit: l.credit != null ? Number(l.credit) : '',
        balance_after: l.balance_after != null ? Number(l.balance_after) : '',
      });
    }
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${statement.id}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.post('/statements/:id/send-email', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id } = req.params;
    const { to_emails = [], cc_emails = [], subject, message } = req.body || {};
    const toList = Array.isArray(to_emails) ? to_emails : [].concat(to_emails ? [to_emails] : []);
    const ccList = Array.isArray(cc_emails) ? cc_emails : [].concat(cc_emails ? [cc_emails] : []);
    if (toList.length === 0) return res.status(400).json({ error: 'At least one To recipient required' });
    const statement = await getStatementFull(id, tenantId);
    if (!statement) return res.status(404).json({ error: 'Statement not found' });
    const settingsResult = await query(
      `SELECT company_name, address, vat_number, company_registration, email, website, payment_terms, banking_details, logo_path FROM accounting_company_settings WHERE tenant_id = @tenantId`,
      { tenantId }
    );
    const company = settingsResult.recordset?.[0] || {};
    let logoBuffer = null;
    if (company.logo_path) { const fp = path.join(process.cwd(), (company.logo_path || '').replace(/\//g, path.sep)); if (fs.existsSync(fp) && fp.startsWith(uploadsRoot)) logoBuffer = fs.readFileSync(fp); }
    const pdf = await buildStatementPdf(statement, company, logoBuffer);
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured' });
    await sendEmail({ to: toList.join(', '), cc: ccList.length ? ccList.join(', ') : undefined, subject: subject || (statement.title || 'Statement'), body: message || 'Please find attached statement.', html: false, attachments: [{ filename: `statement-${statement.id}.pdf`, content: pdf }] });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Library: list documents in uploads/accounting/{tenantId}/library */
const LIBRARY_ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
function safeBasename(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '');
}

router.get('/library', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const dir = path.join(uploadsRoot, String(tenantId), 'library');
    const files = [];
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!fs.statSync(full).isFile()) continue;
        const ext = path.extname(name).toLowerCase();
        if (!LIBRARY_ALLOWED_EXT.has(ext)) continue;
        files.push({
          name,
          size: fs.statSync(full).size,
          updated_at: fs.statSync(full).mtime?.toISOString?.(),
        });
      }
    }
    files.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

/** Library: upload a file (multipart) */
router.post('/library', async (req, res, next) => {
  try {
    const multer = (await import('multer')).default;
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const dir = path.join(uploadsRoot, String(tenantId), 'library');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, dir),
        filename: (_req, file, cb) => {
          const base = safeBasename(path.basename(file.originalname)) || 'document';
          const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '';
          cb(null, `${base}${ext ? ext : ''}`);
        },
      }),
      limits: { fileSize: 25 * 1024 * 1024 },
    }).single('file');
    upload(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: 'No file' });
      res.json({ ok: true, name: req.file.filename });
    });
  } catch (err) {
    next(err);
  }
});

/** Library: serve file for view/download */
router.get('/library/:filename', (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const filename = safeBasename(req.params.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(uploadsRoot, String(tenantId), 'library', filename);
    if (!filePath.startsWith(path.join(uploadsRoot, String(tenantId))) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
});

export default router;
