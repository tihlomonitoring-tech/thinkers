/**
 * Internal vehicle fuel expenses — Excel import, contractor truck matching, dashboard, export.
 */
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { requireAuth, loadUser } from '../middleware/auth.js';
import {
  parseFuelVehicleExpenseBuffer,
  normRegistration,
  fuelExpenseDuplicateKey,
} from '../lib/fuelVehicleExpenseImport.js';
import {
  buildVehicleFuelExportExcelBuffer,
  buildVehicleFuelExportPdfBuffer,
} from '../lib/fuelVehicleExpenseExport.js';
const router = Router();
router.use(requireAuth, loadUser);

const VEHICLE_TABS = ['import_fuel_expenses', 'fuel_expenditure', 'internal_vehicles_fuel', 'file_export'];

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function requireVehicleFuelTab(tabId) {
  return async (req, res, next) => {
    try {
      if (!VEHICLE_TABS.includes(tabId) && tabId !== 'any') return res.status(500).json({ error: 'Invalid tab guard' });
      if (req.user?.role === 'super_admin') return next();
      const tabs = tabId === 'any' ? VEHICLE_TABS : [tabId];
      for (const tid of tabs) {
        if (!VEHICLE_TABS.includes(tid)) continue;
        const r = await query(`SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id = @tabId`, {
          uid: req.user.id,
          tabId: tid,
        });
        if (r.recordset?.length) return next();
      }
      return res.status(403).json({ error: 'No access to this Fuel Data tab.' });
    } catch (e) {
      next(e);
    }
  };
}

function requireVehicleFuelAnyTab(tabIds) {
  const ids = tabIds.filter((t) => VEHICLE_TABS.includes(t));
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'super_admin') return next();
      for (const tid of ids) {
        const r = await query(`SELECT 1 AS ok FROM fuel_data_tab_grants WHERE user_id = @uid AND tab_id = @tabId`, {
          uid: req.user.id,
          tabId: tid,
        });
        if (r.recordset?.length) return next();
      }
      return res.status(403).json({ error: 'No access to this Fuel Data tab.' });
    } catch (e) {
      next(e);
    }
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function mapExpenseRow(r) {
  return {
    id: get(r, 'id'),
    tenant_id: get(r, 'tenant_id'),
    import_id: get(r, 'import_id'),
    registration_number: get(r, 'registration_number'),
    transaction_at: get(r, 'transaction_at'),
    litres: get(r, 'litres'),
    start_odometer: get(r, 'start_odometer'),
    end_odometer: get(r, 'end_odometer'),
    amount_rand: get(r, 'amount_rand'),
    source_type_name: get(r, 'source_type_name'),
    input_source: get(r, 'input_source'),
    price_per_litre: get(r, 'price_per_litre'),
    truck_id: get(r, 'truck_id'),
    contractor_id: get(r, 'contractor_id'),
    match_status: get(r, 'match_status'),
    notes: get(r, 'notes'),
    truck_registration: get(r, 'truck_registration'),
    fleet_no: get(r, 'fleet_no'),
    make_model: get(r, 'make_model'),
    main_contractor: get(r, 'main_contractor'),
    contractor_company_name: get(r, 'contractor_company_name'),
    created_at: get(r, 'created_at'),
    updated_at: get(r, 'updated_at'),
  };
}

async function loadTruckMap(tenantId) {
  const r = await query(
    `SELECT t.id, t.registration, t.contractor_id, t.fleet_no, t.make_model, t.main_contractor,
            co.name AS contractor_company_name
     FROM contractor_trucks t
     LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = t.tenant_id
     WHERE t.tenant_id = @t`,
    { t: tenantId }
  );
  const map = new Map();
  for (const row of r.recordset || []) {
    const reg = get(row, 'registration');
    const key = normRegistration(reg);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function matchTruck(truckMap, registration) {
  const key = normRegistration(registration);
  const t = truckMap.get(key);
  if (!t) return { truck_id: null, contractor_id: null, match_status: 'unmatched' };
  return {
    truck_id: get(t, 'id'),
    contractor_id: get(t, 'contractor_id'),
    match_status: 'matched',
    truck_registration: get(t, 'registration'),
    fleet_no: get(t, 'fleet_no'),
    make_model: get(t, 'make_model'),
    main_contractor: get(t, 'main_contractor'),
    contractor_company_name: get(t, 'contractor_company_name'),
  };
}

async function loadExistingExpenseDuplicateKeys(tenantId, candidateRows) {
  if (!candidateRows?.length) return new Set();
  let minT = null;
  let maxT = null;
  for (const row of candidateRows) {
    const t = new Date(row.transaction_at).getTime();
    if (Number.isNaN(t)) continue;
    if (minT == null || t < minT) minT = t;
    if (maxT == null || t > maxT) maxT = t;
  }
  if (minT == null) return new Set();

  const from = new Date(minT - 86400000).toISOString();
  const to = new Date(maxT + 86400000).toISOString();
  const r = await query(
    `SELECT registration_number, transaction_at, litres, amount_rand
     FROM fuel_vehicle_expenses
     WHERE tenant_id = @t AND transaction_at >= @from AND transaction_at <= @to`,
    { t: tenantId, from, to }
  );
  const keys = new Set();
  for (const row of r.recordset || []) {
    keys.add(
      fuelExpenseDuplicateKey({
        registration_number: get(row, 'registration_number'),
        transaction_at: get(row, 'transaction_at'),
        litres: get(row, 'litres'),
        amount_rand: get(row, 'amount_rand'),
      })
    );
  }
  return keys;
}

async function listExpenses(tid, queryParams) {
  let sql = `SELECT e.*, t.registration AS truck_registration, t.fleet_no, t.make_model, t.main_contractor,
                    co.name AS contractor_company_name
             FROM fuel_vehicle_expenses e
             LEFT JOIN contractor_trucks t ON t.id = e.truck_id
             LEFT JOIN contractors co ON co.id = e.contractor_id
             WHERE e.tenant_id = @t`;
  const params = { t: tid };
  if (queryParams.from) {
    sql += ` AND e.transaction_at >= @from`;
    params.from = queryParams.from;
  }
  if (queryParams.to) {
    sql += ` AND e.transaction_at < DATEADD(day, 1, CAST(@to AS DATE))`;
    params.to = queryParams.to;
  }
  if (queryParams.registration) {
    sql += ` AND e.registration_number LIKE @reg`;
    params.reg = `%${queryParams.registration}%`;
  }
  if (queryParams.match_status && queryParams.match_status !== 'all') {
    sql += ` AND e.match_status = @ms`;
    params.ms = queryParams.match_status;
  }
  if (queryParams.truck_id) {
    sql += ` AND e.truck_id = @truckId`;
    params.truckId = queryParams.truck_id;
  }
  sql += ` ORDER BY e.transaction_at DESC, e.created_at DESC`;
  const r = await query(sql, params);
  return (r.recordset || []).map(mapExpenseRow);
}

router.get('/trucks', requireVehicleFuelAnyTab(['import_fuel_expenses', 'fuel_expenditure', 'internal_vehicles_fuel']), async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT t.id, t.registration, t.fleet_no, t.make_model, t.main_contractor, t.contractor_id,
              co.name AS contractor_company_name
       FROM contractor_trucks t
       LEFT JOIN contractors co ON co.id = t.contractor_id
       WHERE t.tenant_id = @t
       ORDER BY t.registration`,
      { t }
    );
    res.json({ trucks: r.recordset || [] });
  } catch (e) {
    next(e);
  }
});

router.get('/expenses', requireVehicleFuelAnyTab(['fuel_expenditure', 'internal_vehicles_fuel', 'file_export']), async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const expenses = await listExpenses(t, req.query);
    res.json({ expenses });
  } catch (e) {
    if (String(e.message).includes('fuel_vehicle_expenses')) {
      return res.status(503).json({ error: 'Run npm run db:fuel-vehicle-expenses on the database' });
    }
    next(e);
  }
});

router.get('/dashboard', requireVehicleFuelTab('internal_vehicles_fuel'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const params = { t };
    let dateFilter = '';
    if (req.query.from) {
      dateFilter += ` AND e.transaction_at >= @from`;
      params.from = req.query.from;
    }
    if (req.query.to) {
      dateFilter += ` AND e.transaction_at < DATEADD(day, 1, CAST(@to AS DATE))`;
      params.to = req.query.to;
    }
    const byTruck = await query(
      `SELECT e.truck_id, COALESCE(t.registration, e.registration_number) AS label,
              t.fleet_no, t.make_model, t.main_contractor,
              SUM(ISNULL(e.litres, 0)) AS total_litres,
              SUM(ISNULL(e.amount_rand, 0)) AS total_rand,
              COUNT(*) AS transaction_count,
              AVG(NULLIF(e.price_per_litre, 0)) AS avg_price_per_litre
       FROM fuel_vehicle_expenses e
       LEFT JOIN contractor_trucks t ON t.id = e.truck_id
       WHERE e.tenant_id = @t ${dateFilter}
       GROUP BY e.truck_id, COALESCE(t.registration, e.registration_number), t.fleet_no, t.make_model, t.main_contractor
       ORDER BY total_rand DESC`,
      params
    );
    const byMonth = await query(
      `SELECT FORMAT(e.transaction_at, 'yyyy-MM') AS month,
              SUM(ISNULL(e.litres, 0)) AS total_litres,
              SUM(ISNULL(e.amount_rand, 0)) AS total_rand,
              COUNT(*) AS transaction_count
       FROM fuel_vehicle_expenses e
       WHERE e.tenant_id = @t ${dateFilter}
       GROUP BY FORMAT(e.transaction_at, 'yyyy-MM')
       ORDER BY month`,
      params
    );
    const summary = await query(
      `SELECT COUNT(*) AS total_rows,
              SUM(CASE WHEN match_status = N'matched' THEN 1 ELSE 0 END) AS matched_rows,
              SUM(ISNULL(litres, 0)) AS total_litres,
              SUM(ISNULL(amount_rand, 0)) AS total_rand
       FROM fuel_vehicle_expenses e WHERE e.tenant_id = @t ${dateFilter}`,
      params
    );
    res.json({
      by_truck: byTruck.recordset || [],
      by_month: byMonth.recordset || [],
      summary: summary.recordset?.[0] || {},
    });
  } catch (e) {
    if (String(e.message).includes('fuel_vehicle_expenses')) {
      return res.status(503).json({ error: 'Run npm run db:fuel-vehicle-expenses' });
    }
    next(e);
  }
});

router.post('/import', requireVehicleFuelTab('import_fuel_expenses'), upload.single('file'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'Upload an Excel file (.xlsx)' });

    const { rows, errors: parseErrors } = await parseFuelVehicleExpenseBuffer(req.file.buffer);
    if (!rows.length) {
      return res.status(400).json({ error: parseErrors[0] || 'No valid rows found', parse_errors: parseErrors });
    }

    const truckMap = await loadTruckMap(t);
    const existingKeys = await loadExistingExpenseDuplicateKeys(t, rows);
    const seenInFile = new Set();
    const duplicateErrors = [];
    const rowsToInsert = [];

    for (const row of rows) {
      const key = fuelExpenseDuplicateKey(row);
      if (seenInFile.has(key)) {
        duplicateErrors.push(`Row ${row.rowNumber}: duplicate row in this file`);
        continue;
      }
      if (existingKeys.has(key)) {
        duplicateErrors.push(`Row ${row.rowNumber}: already imported (same registration, date, litres, and amount)`);
        continue;
      }
      seenInFile.add(key);
      existingKeys.add(key);
      rowsToInsert.push(row);
    }

    if (!rowsToInsert.length) {
      return res.status(400).json({
        error:
          duplicateErrors.length > 0
            ? 'No new rows to import — all transactions are duplicates.'
            : 'No valid rows found',
        skipped_duplicates: duplicateErrors.length,
        duplicate_errors: duplicateErrors.slice(0, 50),
        parse_errors: parseErrors,
      });
    }

    const imp = await query(
      `INSERT INTO fuel_vehicle_expense_imports (tenant_id, file_name, row_count, matched_count, imported_by_user_id)
       OUTPUT INSERTED.id VALUES (@t, @fn, 0, 0, @uid)`,
      { t, fn: req.file.originalname || 'import.xlsx', uid: req.user.id }
    );
    const importId = get(imp.recordset[0], 'id');
    let matched = 0;
    let inserted = 0;

    for (const row of rowsToInsert) {
      const m = matchTruck(truckMap, row.registration_number);
      if (m.match_status === 'matched') matched += 1;
      await query(
        `INSERT INTO fuel_vehicle_expenses (
          tenant_id, import_id, registration_number, transaction_at, litres, start_odometer, end_odometer,
          amount_rand, source_type_name, input_source, price_per_litre, truck_id, contractor_id, match_status, created_by_user_id
        ) VALUES (@t, @imp, @reg, @dt, @lit, @so, @eo, @amt, @stn, @ins, @ppl, @tid, @cid, @ms, @uid)`,
        {
          t,
          imp: importId,
          reg: row.registration_number,
          dt: row.transaction_at,
          lit: row.litres,
          so: row.start_odometer,
          eo: row.end_odometer,
          amt: row.amount_rand,
          stn: row.source_type_name,
          ins: row.input_source,
          ppl: row.price_per_litre,
          tid: m.truck_id,
          cid: m.contractor_id,
          ms: m.match_status,
          uid: req.user.id,
        }
      );
      inserted += 1;
    }

    await query(
      `UPDATE fuel_vehicle_expense_imports SET row_count = @n, matched_count = @m WHERE id = @id`,
      { id: importId, n: inserted, m: matched }
    );

    res.status(201).json({
      import_id: importId,
      inserted,
      matched,
      unmatched: inserted - matched,
      skipped_duplicates: duplicateErrors.length,
      duplicate_errors: duplicateErrors.slice(0, 50),
      parse_errors: parseErrors,
    });
  } catch (e) {
    if (String(e.message).includes('fuel_vehicle_expenses')) {
      return res.status(503).json({ error: 'Run npm run db:fuel-vehicle-expenses' });
    }
    next(e);
  }
});

router.patch('/expenses/:id', requireVehicleFuelTab('fuel_expenditure'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    const existing = await query(`SELECT * FROM fuel_vehicle_expenses WHERE id = @id AND tenant_id = @t`, {
      id: req.params.id,
      t,
    });
    if (!existing.recordset?.length) return res.status(404).json({ error: 'Not found' });

    let truckId = b.truck_id !== undefined ? b.truck_id || null : get(existing.recordset[0], 'truck_id');
    let contractorId = b.contractor_id !== undefined ? b.contractor_id || null : get(existing.recordset[0], 'contractor_id');
    let matchStatus = get(existing.recordset[0], 'match_status');
    const reg = b.registration_number !== undefined ? b.registration_number : get(existing.recordset[0], 'registration_number');

    if (b.truck_id !== undefined && truckId) {
      const tr = await query(`SELECT id, contractor_id FROM contractor_trucks WHERE id = @id AND tenant_id = @t`, {
        id: truckId,
        t,
      });
      if (!tr.recordset?.length) return res.status(400).json({ error: 'Invalid truck' });
      contractorId = get(tr.recordset[0], 'contractor_id');
      matchStatus = 'matched';
    } else if (b.registration_number !== undefined && !truckId) {
      const truckMap = await loadTruckMap(t);
      const m = matchTruck(truckMap, reg);
      truckId = m.truck_id;
      contractorId = m.contractor_id;
      matchStatus = m.match_status;
    } else if (b.truck_id === null) {
      matchStatus = 'manual';
    }

    const sets = ['updated_at = SYSUTCDATETIME()', 'updated_by_user_id = @uid'];
    const params = { id: req.params.id, t, uid: req.user.id, tid: truckId, cid: contractorId, ms: matchStatus };
    if (b.registration_number !== undefined) {
      sets.push('registration_number = @reg');
      params.reg = b.registration_number.trim();
    }
    if (b.transaction_at !== undefined) {
      sets.push('transaction_at = @dt');
      params.dt = b.transaction_at;
    }
    if (b.litres !== undefined) {
      sets.push('litres = @lit');
      params.lit = b.litres;
    }
    if (b.start_odometer !== undefined) {
      sets.push('start_odometer = @so');
      params.so = b.start_odometer;
    }
    if (b.end_odometer !== undefined) {
      sets.push('end_odometer = @eo');
      params.eo = b.end_odometer;
    }
    if (b.amount_rand !== undefined) {
      sets.push('amount_rand = @amt');
      params.amt = b.amount_rand;
    }
    if (b.source_type_name !== undefined) {
      sets.push('source_type_name = @stn');
      params.stn = b.source_type_name;
    }
    if (b.input_source !== undefined) {
      sets.push('input_source = @ins');
      params.ins = b.input_source;
    }
    if (b.price_per_litre !== undefined) {
      sets.push('price_per_litre = @ppl');
      params.ppl = b.price_per_litre;
    }
    if (b.notes !== undefined) {
      sets.push('notes = @notes');
      params.notes = b.notes;
    }
    sets.push('truck_id = @tid', 'contractor_id = @cid', 'match_status = @ms');
    await query(`UPDATE fuel_vehicle_expenses SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);

    const rows = await listExpenses(t, {});
    const updated = rows.find((x) => String(x.id) === String(req.params.id));
    res.json({ expense: updated || null });
  } catch (e) {
    next(e);
  }
});

router.delete('/expenses/:id', requireVehicleFuelTab('fuel_expenditure'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    await query(`DELETE FROM fuel_vehicle_expenses WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/expenses/:id/rematch', requireVehicleFuelTab('fuel_expenditure'), async (req, res, next) => {
  try {
    const t = tenantId(req);
    const r = await query(`SELECT * FROM fuel_vehicle_expenses WHERE id = @id AND tenant_id = @t`, {
      id: req.params.id,
      t,
    });
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const truckMap = await loadTruckMap(t);
    const m = matchTruck(truckMap, get(row, 'registration_number'));
    await query(
      `UPDATE fuel_vehicle_expenses SET truck_id = @tid, contractor_id = @cid, match_status = @ms, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, tid: m.truck_id, cid: m.contractor_id, ms: m.match_status }
    );
    res.json({ ok: true, match_status: m.match_status });
  } catch (e) {
    next(e);
  }
});

async function buildExportRows(tid, q) {
  return listExpenses(tid, q);
}

router.get('/export/excel', requireVehicleFuelAnyTab(['fuel_expenditure', 'file_export']), async (req, res, next) => {
  try {
    const t = tenantId(req);
    const rows = await buildExportRows(t, req.query);
    const buf = await buildVehicleFuelExportExcelBuffer(rows, t, req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="internal-vehicle-fuel-expenditure.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

router.get('/export/pdf', requireVehicleFuelAnyTab(['fuel_expenditure', 'file_export']), async (req, res, next) => {
  try {
    const t = tenantId(req);
    const rows = await buildExportRows(t, req.query);
    const buf = await buildVehicleFuelExportPdfBuffer(rows, t, req.query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="internal-vehicle-fuel-expenditure.pdf"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

export default router;
