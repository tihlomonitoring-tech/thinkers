/**
 * Logistics finance management — load revenue imports, expense vs revenue, audit links.
 */
import { Router } from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import {
  parseLogisticsLoadBuffer,
  normRegistration,
  loadTransactionDuplicateKey,
} from '../lib/logisticsFinanceLoadImport.js';
import {
  buildLogisticsExportExcelBuffer,
  buildLogisticsExportPdfBuffer,
  formatExportPeriodLabel,
} from '../lib/logisticsFinanceExport.js';
import { computeLedgerDashboard } from '../lib/deliveryActivityLedger.js';
import deliveryActivityLedgerRoutes from './deliveryActivityLedger.js';
const router = Router();

/** Public — confirm deployment includes logistics finance routes (expect 200, not 404). */
router.get('/ping', (req, res) => res.json({ ok: true, feature: 'logistics-finance' }));

router.use(requireAuth, loadUser, requirePageAccess('logistics_finance_management'));
router.use('/ledger', deliveryActivityLedgerRoutes);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function mapTxRow(r, extras = {}) {
  if (!r) return null;
  const turnover = get(r, 'turnover') != null ? Number(get(r, 'turnover')) : null;
  const totalExpense = extras.total_expense != null ? Number(extras.total_expense) : 0;
  return {
    id: get(r, 'id'),
    import_id: get(r, 'import_id'),
    transaction_date: get(r, 'transaction_date'),
    vehicle_id: get(r, 'vehicle_id'),
    vehicle_desc: get(r, 'vehicle_desc'),
    vehicle_registration: get(r, 'vehicle_registration'),
    haulier: get(r, 'haulier'),
    completed: get(r, 'completed'),
    cancelled: get(r, 'cancelled'),
    avg_hours: get(r, 'avg_hours') != null ? Number(get(r, 'avg_hours')) : null,
    tons: get(r, 'tons') != null ? Number(get(r, 'tons')) : null,
    turnover,
    target_turnover: get(r, 'target_turnover') != null ? Number(get(r, 'target_turnover')) : null,
    variance: get(r, 'variance') != null ? Number(get(r, 'variance')) : null,
    turnover_points: get(r, 'turnover_points') != null ? Number(get(r, 'turnover_points')) : null,
    target_points: get(r, 'target_points') != null ? Number(get(r, 'target_points')) : null,
    variance_points: get(r, 'variance_points') != null ? Number(get(r, 'variance_points')) : null,
    comment: get(r, 'comment') || null,
    contractor_truck_id: get(r, 'contractor_truck_id'),
    contractor_id: get(r, 'contractor_id'),
    is_manual: get(r, 'is_manual') === true || get(r, 'is_manual') === 1,
    fuel_expense: extras.fuel_expense != null ? Number(extras.fuel_expense) : 0,
    accounting_expense: extras.accounting_expense != null ? Number(extras.accounting_expense) : 0,
    total_expense: totalExpense,
    net_margin: turnover != null ? Math.round((turnover - totalExpense) * 100) / 100 : null,
    created_at: get(r, 'created_at'),
    updated_at: get(r, 'updated_at'),
  };
}

function buildDateFilter(queryParams, alias = 't') {
  const parts = [];
  const params = {};
  if (queryParams.date_from) {
    parts.push(`${alias}.transaction_date >= @dateFrom`);
    params.dateFrom = queryParams.date_from;
  }
  if (queryParams.date_to) {
    parts.push(`${alias}.transaction_date <= @dateTo`);
    params.dateTo = queryParams.date_to;
  }
  if (queryParams.haulier) {
    parts.push(`${alias}.haulier LIKE @haulier`);
    params.haulier = `%${String(queryParams.haulier).trim()}%`;
  }
  if (queryParams.registration) {
    parts.push(`${alias}.vehicle_registration LIKE @reg`);
    params.reg = `%${String(queryParams.registration).trim()}%`;
  }
  if (queryParams.vehicle_id) {
    parts.push(`${alias}.vehicle_id = @vehicleId`);
    params.vehicleId = String(queryParams.vehicle_id).trim();
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

async function loadFuelExpenseMap(tenant, dateFrom, dateTo) {
  const map = new Map();
  try {
    const r = await query(
      `SELECT CAST(e.transaction_at AS DATE) AS tx_date,
              LOWER(REPLACE(REPLACE(REPLACE(ISNULL(e.registration_number, ''), ' ', ''), '-', ''), '(', '')) AS reg_norm,
              SUM(ISNULL(e.amount_rand, 0)) AS fuel_total
       FROM fuel_vehicle_expenses e
       WHERE e.tenant_id = @t
         AND (@df IS NULL OR CAST(e.transaction_at AS DATE) >= @df)
         AND (@dt IS NULL OR CAST(e.transaction_at AS DATE) <= @dt)
       GROUP BY CAST(e.transaction_at AS DATE),
                LOWER(REPLACE(REPLACE(REPLACE(ISNULL(e.registration_number, ''), ' ', ''), '-', ''), '(', ''))`,
      { t: tenant, df: dateFrom || null, dt: dateTo || null }
    );
    for (const row of r.recordset || []) {
      const key = `${String(row.tx_date).slice(0, 10)}|${row.reg_norm || ''}`;
      map.set(key, Number(row.fuel_total) || 0);
    }
  } catch (_) {
    /* fuel_vehicle_expenses may not exist */
  }
  return map;
}

async function loadAccountingExpenseMaps(tenant, dateFrom, dateTo) {
  const byDateHaulier = new Map();
  const byDate = new Map();
  try {
    const r = await query(
      `SELECT e.entry_date AS tx_date,
              LOWER(LTRIM(RTRIM(ISNULL(e.vendor_supplier, '')))) AS vendor_norm,
              SUM(ISNULL(e.amount, 0) + ISNULL(e.tax_amount, 0)) AS expense_total
       FROM expense_entries e
       WHERE e.tenant_id = @t
         AND e.entry_type = N'expense'
         AND (@df IS NULL OR e.entry_date >= @df)
         AND (@dt IS NULL OR e.entry_date <= @dt)
       GROUP BY e.entry_date, LOWER(LTRIM(RTRIM(ISNULL(e.vendor_supplier, ''))))`,
      { t: tenant, df: dateFrom || null, dt: dateTo || null }
    );
    for (const row of r.recordset || []) {
      const d = String(row.tx_date).slice(0, 10);
      const vendor = row.vendor_norm || '';
      const amt = Number(row.expense_total) || 0;
      byDateHaulier.set(`${d}|${vendor}`, amt);
      byDate.set(d, (byDate.get(d) || 0) + amt);
    }
  } catch (_) {
    /* expense_entries may not exist */
  }
  return { byDateHaulier, byDate };
}

function haulierNorm(h) {
  return String(h || '')
    .trim()
    .toLowerCase();
}

function matchAccountingForRow(row, byDateHaulier, haulierCounts) {
  const d = String(row.transaction_date).slice(0, 10);
  const haulier = haulierNorm(row.haulier);
  let amount = 0;
  if (haulier) {
    for (const [key, val] of byDateHaulier.entries()) {
      if (!key.startsWith(`${d}|`)) continue;
      const vendor = key.slice(d.length + 1);
      if (vendor.includes(haulier) || haulier.includes(vendor)) {
        const cnt = haulierCounts.get(`${d}|${haulier}`) || 1;
        amount += val / cnt;
      }
    }
  }
  return Math.round(amount * 100) / 100;
}

function enrichRowsWithExpenses(rows, fuelMap, acctMaps) {
  const haulierCounts = new Map();
  for (const row of rows) {
    const d = String(row.transaction_date).slice(0, 10);
    const h = haulierNorm(row.haulier);
    if (h) haulierCounts.set(`${d}|${h}`, (haulierCounts.get(`${d}|${h}`) || 0) + 1);
  }
  return rows.map((r) => {
    const d = String(r.transaction_date).slice(0, 10);
    const regNorm = normRegistration(r.vehicle_registration);
    const fuelKey = `${d}|${regNorm}`;
    const fuel = fuelMap.get(fuelKey) || 0;
    const accounting = matchAccountingForRow(r, acctMaps.byDateHaulier, haulierCounts);
    const total = Math.round((fuel + accounting) * 100) / 100;
    return mapTxRow(r, { fuel_expense: fuel, accounting_expense: accounting, total_expense: total });
  });
}

async function matchContractorTruck(tenant, registration) {
  const norm = normRegistration(registration);
  if (!norm) return { truck_id: null, contractor_id: null };
  try {
    const r = await query(
      `SELECT TOP 1 ct.id AS truck_id, ct.contractor_id
       FROM contractor_trucks ct
       INNER JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = @t
       WHERE LOWER(REPLACE(REPLACE(REPLACE(ISNULL(ct.registration, ''), ' ', ''), '-', ''), '(', '')) = @norm
          OR LOWER(REPLACE(REPLACE(REPLACE(ISNULL(ct.fleet_no, ''), ' ', ''), '-', ''), '(', '')) = @norm`,
      { t: tenant, norm }
    );
    const row = r.recordset?.[0];
    return row
      ? { truck_id: get(row, 'truck_id'), contractor_id: get(row, 'contractor_id') }
      : { truck_id: null, contractor_id: null };
  } catch {
    return { truck_id: null, contractor_id: null };
  }
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const data = await computeLedgerDashboard(query, t, req.query);
    res.json(data);
  } catch (e) {
    if (String(e.message).includes('logistics_delivery_ledger')) {
      return res.status(503).json({
        error: 'Delivery Activity Ledger tables not installed. Run: npm run db:delivery-activity-ledger',
      });
    }
    next(e);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const { sql: dateSql, params: dateParams } = buildDateFilter(req.query, 't');
    const r = await query(
      `SELECT t.* FROM logistics_finance_load_transactions t
       WHERE t.tenant_id = @t ${dateSql}
       ORDER BY t.transaction_date DESC, t.haulier, t.vehicle_registration`,
      { t, ...dateParams }
    );
    const fuelMap = await loadFuelExpenseMap(t, req.query.date_from, req.query.date_to);
    const acctMaps = await loadAccountingExpenseMaps(t, req.query.date_from, req.query.date_to);
    const enriched = enrichRowsWithExpenses(r.recordset || [], fuelMap, acctMaps);
    res.json({ transactions: enriched });
  } catch (e) {
    if (String(e.message).includes('logistics_finance_load_transactions')) {
      return res.status(503).json({ error: 'Run npm run db:logistics-finance' });
    }
    next(e);
  }
});

router.get('/transactions/:id/audit', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const r = await query(
      `SELECT * FROM logistics_finance_load_transactions WHERE id = @id AND tenant_id = @t`,
      { id: req.params.id, t }
    );
    const tx = r.recordset?.[0];
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const d = String(get(tx, 'transaction_date')).slice(0, 10);
    const regNorm = normRegistration(get(tx, 'vehicle_registration'));
    const haulier = get(tx, 'haulier');

    const fuel = [];
    try {
      const fr = await query(
        `SELECT e.id, e.transaction_at, e.registration_number, e.litres, e.amount_rand, e.match_status,
                ct.registration AS matched_truck
         FROM fuel_vehicle_expenses e
         LEFT JOIN contractor_trucks ct ON ct.id = e.truck_id
         WHERE e.tenant_id = @t AND CAST(e.transaction_at AS DATE) = @d
           AND LOWER(REPLACE(REPLACE(REPLACE(ISNULL(e.registration_number, ''), ' ', ''), '-', ''), '(', '')) = @regNorm
         ORDER BY e.transaction_at`,
        { t, d, regNorm }
      );
      fuel.push(...(fr.recordset || []));
    } catch (_) {}

    const accounting = [];
    try {
      const ar = await query(
        `SELECT e.id, e.entry_date, e.entry_number, e.description, e.amount, e.tax_amount,
                e.vendor_supplier, e.reference_number, e.department_name, c.name AS category_name
         FROM expense_entries e
         LEFT JOIN expense_categories c ON c.id = e.category_id
         WHERE e.tenant_id = @t AND e.entry_type = N'expense' AND e.entry_date = @d
         ORDER BY e.amount DESC`,
        { t, d }
      );
      const all = ar.recordset || [];
      const hLow = haulierNorm(haulier);
      for (const row of all) {
        const vendor = haulierNorm(get(row, 'vendor_supplier'));
        const linked =
          !hLow ||
          vendor.includes(hLow) ||
          hLow.includes(vendor) ||
          String(get(row, 'description') || '')
            .toLowerCase()
            .includes(hLow);
        accounting.push({ ...row, linked_to_haulier: linked });
      }
    } catch (_) {}

    const turnover = Number(get(tx, 'turnover')) || 0;
    const fuelTotal = fuel.reduce((s, x) => s + (Number(get(x, 'amount_rand')) || 0), 0);
    const acctLinked = accounting.filter((x) => x.linked_to_haulier);
    const acctTotal = acctLinked.reduce(
      (s, x) => s + (Number(get(x, 'amount')) || 0) + (Number(get(x, 'tax_amount')) || 0),
      0
    );

    res.json({
      transaction: mapTxRow(tx, {
        fuel_expense: fuelTotal,
        accounting_expense: acctTotal,
        total_expense: fuelTotal + acctTotal,
      }),
      fuel_expenses: fuel,
      accounting_expenses: accounting,
      summary: {
        revenue: turnover,
        fuel_expense: Math.round(fuelTotal * 100) / 100,
        accounting_expense_linked: Math.round(acctTotal * 100) / 100,
        net_margin: Math.round((turnover - fuelTotal - acctTotal) * 100) / 100,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Upload an Excel file (.xlsx)' });

    const parsed = await parseLogisticsLoadBuffer(req.file.buffer);
    if (!parsed.rows.length) {
      return res.status(400).json({ error: parsed.errors?.[0] || 'No valid rows found', parse_errors: parsed.errors });
    }

    const imp = await query(
      `INSERT INTO logistics_finance_imports (tenant_id, file_name, row_count, imported_by_user_id)
       OUTPUT INSERTED.id VALUES (@t, @fn, @rc, @uid)`,
      { t, fn: req.file.originalname || 'import.xlsx', rc: parsed.rows.length, uid: req.user.id }
    );
    const importId = get(imp.recordset?.[0], 'id');

    const existing = await query(
      `SELECT transaction_date, vehicle_id, vehicle_registration, haulier, completed, turnover
       FROM logistics_finance_load_transactions WHERE tenant_id = @t`,
      { t }
    );
    const dupSet = new Set(
      (existing.recordset || []).map((row) =>
        loadTransactionDuplicateKey({
          transaction_date: String(get(row, 'transaction_date')).slice(0, 10),
          vehicle_id: get(row, 'vehicle_id'),
          vehicle_registration: get(row, 'vehicle_registration'),
          haulier: get(row, 'haulier'),
          completed: get(row, 'completed'),
          turnover: get(row, 'turnover'),
        })
      )
    );

    let inserted = 0;
    let skipped = 0;
    const parse_errors = [...(parsed.errors || [])];

    for (const row of parsed.rows) {
      const key = loadTransactionDuplicateKey(row);
      if (dupSet.has(key)) {
        skipped += 1;
        continue;
      }
      dupSet.add(key);

      const match = await matchContractorTruck(t, row.vehicle_registration);
      await query(
        `INSERT INTO logistics_finance_load_transactions (
          tenant_id, import_id, transaction_date, vehicle_id, vehicle_desc, vehicle_registration,
          haulier, completed, cancelled, avg_hours, tons, turnover, target_turnover, variance,
          turnover_points, target_points, variance_points, contractor_truck_id, contractor_id,
          created_by_user_id, updated_by_user_id
        ) VALUES (
          @t, @importId, @transaction_date, @vehicle_id, @vehicle_desc, @vehicle_registration,
          @haulier, @completed, @cancelled, @avg_hours, @tons, @turnover, @target_turnover, @variance,
          @turnover_points, @target_points, @variance_points, @truckId, @contractorId,
          @uid, @uid
        )`,
        {
          t,
          importId,
          transaction_date: row.transaction_date,
          vehicle_id: row.vehicle_id,
          vehicle_desc: row.vehicle_desc,
          vehicle_registration: row.vehicle_registration,
          haulier: row.haulier,
          completed: row.completed,
          cancelled: row.cancelled,
          avg_hours: row.avg_hours,
          tons: row.tons,
          turnover: row.turnover,
          target_turnover: row.target_turnover,
          variance: row.variance,
          turnover_points: row.turnover_points,
          target_points: row.target_points,
          variance_points: row.variance_points,
          truckId: match.truck_id,
          contractorId: match.contractor_id,
          uid: req.user.id,
        }
      );
      inserted += 1;
    }

    await query(`UPDATE logistics_finance_imports SET row_count = @rc WHERE id = @id`, {
      id: importId,
      rc: inserted,
    });

    res.json({
      import_id: importId,
      inserted,
      skipped_duplicates: skipped,
      parse_errors: parse_errors.slice(0, 20),
      columns_detected: parsed.colMap || {},
    });
  } catch (e) {
    if (String(e.message).includes('logistics_finance')) {
      return res.status(503).json({ error: 'Run npm run db:logistics-finance' });
    }
    next(e);
  }
});

router.patch('/transactions/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const body = req.body || {};
    const allowed = [
      'transaction_date',
      'vehicle_id',
      'vehicle_desc',
      'vehicle_registration',
      'haulier',
      'completed',
      'cancelled',
      'avg_hours',
      'tons',
      'turnover',
      'target_turnover',
      'variance',
      'turnover_points',
      'target_points',
      'variance_points',
      'comment',
    ];
    const sets = [];
    const params = { id: req.params.id, t, uid: req.user.id };
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      sets.push(`${key} = @${key}`);
      params[key] = body[key];
    }
    if (body.turnover != null && body.target_turnover != null && body.variance === undefined) {
      sets.push('variance = @variance_calc');
      params.variance_calc =
        Math.round((Number(body.turnover) - Number(body.target_turnover)) * 100) / 100;
    }
    if (body.turnover_points != null && body.target_points != null && body.variance_points === undefined) {
      sets.push('variance_points = @variance_pts_calc');
      params.variance_pts_calc =
        Math.round((Number(body.turnover_points) - Number(body.target_points)) * 10000) / 10000;
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = SYSUTCDATETIME()', 'updated_by_user_id = @uid');
    await query(
      `UPDATE logistics_finance_load_transactions SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`,
      params
    );
    const r = await query(
      `SELECT * FROM logistics_finance_load_transactions WHERE id = @id AND tenant_id = @t`,
      { id: req.params.id, t }
    );
    res.json({ transaction: mapTxRow(r.recordset?.[0]) });
  } catch (e) {
    next(e);
  }
});

router.delete('/transactions/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    await query(`DELETE FROM logistics_finance_load_transactions WHERE id = @id AND tenant_id = @t`, {
      id: req.params.id,
      t,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/transactions', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const body = req.body || {};
    const txDate = body.transaction_date || new Date().toISOString().slice(0, 10);
    const match = await matchContractorTruck(t, body.vehicle_registration);
    const turnover = body.turnover != null ? Number(body.turnover) : null;
    const target = body.target_turnover != null ? Number(body.target_turnover) : null;
    const tPts = body.turnover_points != null ? Number(body.turnover_points) : null;
    const tgtPts = body.target_points != null ? Number(body.target_points) : null;
    const r = await query(
      `INSERT INTO logistics_finance_load_transactions (
        tenant_id, transaction_date, vehicle_id, vehicle_desc, vehicle_registration, haulier,
        completed, cancelled, avg_hours, tons, turnover, target_turnover, variance,
        turnover_points, target_points, variance_points, comment, is_manual,
        contractor_truck_id, contractor_id, created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.* VALUES (
        @t, @transaction_date, @vehicle_id, @vehicle_desc, @vehicle_registration, @haulier,
        @completed, @cancelled, @avg_hours, @tons, @turnover, @target_turnover, @variance,
        @turnover_points, @target_points, @variance_points, @comment, 1,
        @truckId, @contractorId, @uid, @uid
      )`,
      {
        t,
        transaction_date: txDate,
        vehicle_id: body.vehicle_id || null,
        vehicle_desc: body.vehicle_desc || null,
        vehicle_registration: body.vehicle_registration || null,
        haulier: body.haulier || null,
        completed: body.completed ?? null,
        cancelled: body.cancelled ?? null,
        avg_hours: body.avg_hours ?? null,
        tons: body.tons ?? null,
        turnover,
        target_turnover: target,
        variance:
          body.variance ??
          (turnover != null && target != null ? Math.round((turnover - target) * 100) / 100 : null),
        turnover_points: tPts,
        target_points: tgtPts,
        variance_points:
          body.variance_points ??
          (tPts != null && tgtPts != null ? Math.round((tPts - tgtPts) * 10000) / 10000 : null),
        comment: body.comment || null,
        truckId: match.truck_id,
        contractorId: match.contractor_id,
        uid: req.user.id,
      }
    );
    res.status(201).json({ transaction: mapTxRow(r.recordset?.[0]) });
  } catch (e) {
    next(e);
  }
});

async function fetchExportRows(req) {
  const t = tenantId(req);
  const { sql: dateSql, params: dateParams } = buildDateFilter(req.query, 't');
  const r = await query(
    `SELECT t.* FROM logistics_finance_load_transactions t WHERE t.tenant_id = @t ${dateSql} ORDER BY t.transaction_date, t.haulier`,
    { t, ...dateParams }
  );
  const fuelMap = await loadFuelExpenseMap(t, req.query.date_from, req.query.date_to);
  const acctMaps = await loadAccountingExpenseMaps(t, req.query.date_from, req.query.date_to);
  return enrichRowsWithExpenses(r.recordset || [], fuelMap, acctMaps);
}

router.get('/export/excel', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const rows = await fetchExportRows(req);
    const view = req.query.view === 'pnl' ? 'pnl' : 'load';
    const periodLabel = formatExportPeriodLabel(req.query, rows, 'transaction_date');
    const buf = await buildLogisticsExportExcelBuffer({ rows, view, periodLabel, tenantId: t });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="logistics-finance-${view}-${Date.now()}.xlsx"`
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

router.get('/export/pdf', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const rows = await fetchExportRows(req);
    const view = req.query.view === 'pnl' ? 'pnl' : 'load';
    const periodLabel = formatExportPeriodLabel(req.query, rows, 'transaction_date');
    const buf = await buildLogisticsExportPdfBuffer({ rows, view, periodLabel, tenantId: t });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="logistics-finance-${view}-${Date.now()}.pdf"`
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

export default router;
