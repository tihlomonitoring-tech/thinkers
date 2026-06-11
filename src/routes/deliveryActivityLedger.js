/**
 * Delivery Activity Ledger API — diesel, truck expenses, CC deliveries, trial balance.
 */
import { Router } from 'express';
import { query } from '../db.js';
import {
  buildLedgerDateFilter,
  computeLedgerDashboard,
  computeTrialBalance,
  estimateRevenuePerLoad,
  estimateAllocationRevenue,
  estimateDeliveryFuel,
  getRow,
  mapDeliveryRow,
  mapDieselRow,
  mapExpenseRow,
  matchTruckAndDriver,
  parseDecimal,
  parseIntSafe,
  resolveTruckRoute,
  round2,
} from '../lib/deliveryActivityLedger.js';

const router = Router();

function tenantId(req) {
  return req.user?.tenant_id ? String(req.user.tenant_id) : null;
}

function ledgerMissing(e, res) {
  if (String(e.message).includes('logistics_delivery_ledger')) {
    res.status(503).json({ error: 'Run npm run db:delivery-activity-ledger' });
    return true;
  }
  return false;
}

router.get('/context', async (req, res, next) => {
  try {
    const t = tenantId(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const [trucks, drivers, routes] = await Promise.all([
      query(
        `SELECT ct.id, ct.registration, ct.make_model, c.name AS contractor_name
         FROM contractor_trucks ct
         LEFT JOIN contractors c ON c.id = ct.contractor_id
         WHERE ct.tenant_id = @t
         ORDER BY ct.registration`,
        { t }
      ),
      query(
        `SELECT d.id, d.full_name, d.surname, d.phone
         FROM contractor_drivers d WHERE d.tenant_id = @t
         ORDER BY d.full_name`,
        { t }
      ),
      query(`SELECT id, name, starting_point, destination FROM contractor_routes WHERE tenant_id = @t ORDER BY name`, { t }),
    ]);
    res.json({
      trucks: (trucks.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        registration: getRow(r, 'registration'),
        make_model: getRow(r, 'make_model'),
        contractor_name: getRow(r, 'contractor_name'),
      })),
      drivers: (drivers.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        name: [getRow(r, 'full_name'), getRow(r, 'surname')].filter(Boolean).join(' ').trim(),
        phone: getRow(r, 'phone'),
      })),
      routes: (routes.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        name: getRow(r, 'name'),
        corridor: `${getRow(r, 'starting_point') || '—'} → ${getRow(r, 'destination') || '—'}`,
      })),
      expense_types: ['maintenance', 'toll', 'permit', 'tyre', 'repair', 'wash', 'parking', 'fine', 'other'],
    });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.get('/diesel', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const { sql, params } = buildLedgerDateFilter(req.query, 'x', 'transaction_at');
    const dateSql = sql.replace(/x\.transaction_at/g, 'CAST(x.transaction_at AS DATE)');
    const r = await query(
      `SELECT x.*, ct.registration AS truck_registration,
              CONCAT(d.full_name, CASE WHEN d.surname IS NOT NULL THEN ' ' + d.surname ELSE '' END) AS driver_name,
              cr.name AS route_name
       FROM logistics_delivery_ledger_diesel x
       LEFT JOIN contractor_trucks ct ON ct.id = x.truck_id
       LEFT JOIN contractor_drivers d ON d.id = x.driver_id
       LEFT JOIN contractor_routes cr ON cr.id = x.route_id
       WHERE x.tenant_id = @t ${dateSql}
       ORDER BY x.transaction_at DESC`,
      { t, ...params }
    );
    res.json({ entries: (r.recordset || []).map(mapDieselRow) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.post('/diesel', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    if (!b.truck_id) return res.status(400).json({ error: 'Truck is required' });
    if (!b.driver_id) return res.status(400).json({ error: 'Driver is required' });
    if (!b.location?.trim()) return res.status(400).json({ error: 'Location is required' });
    if (!b.transaction_at) return res.status(400).json({ error: 'Date and time are required' });
    const litres = parseDecimal(b.litres);
    if (!litres || litres <= 0) return res.status(400).json({ error: 'Litres must be a positive number' });
    const price = parseDecimal(b.price_per_litre);
    const amount = parseDecimal(b.amount_rand) ?? (price ? round2(litres * price) : null);
    if (amount == null || amount < 0) return res.status(400).json({ error: 'Amount or price per litre is required' });

    let routeId = b.route_id || null;
    if (!routeId) {
      const route = await resolveTruckRoute(query, t, b.truck_id);
      routeId = route.routeId;
    }

    const ins = await query(
      `INSERT INTO logistics_delivery_ledger_diesel (
        tenant_id, truck_id, driver_id, route_id, transaction_at, location, litres,
        price_per_litre, amount_rand, odometer_km, supplier, receipt_ref, notes,
        created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @t, @truckId, @driverId, @routeId, @transactionAt, @location, @litres,
        @price, @amount, @odo, @supplier, @receipt, @notes, @uid, @uid
      )`,
      {
        t,
        truckId: b.truck_id,
        driverId: b.driver_id,
        routeId,
        transactionAt: b.transaction_at,
        location: String(b.location).trim(),
        litres,
        price,
        amount,
        odo: parseDecimal(b.odometer_km),
        supplier: b.supplier?.trim() || null,
        receipt: b.receipt_ref?.trim() || null,
        notes: b.notes?.trim() || null,
        uid: req.user?.id,
      }
    );
    const id = getRow(ins.recordset?.[0], 'id');
    const row = await query(
      `SELECT x.*, ct.registration AS truck_registration,
              CONCAT(d.full_name, CASE WHEN d.surname IS NOT NULL THEN ' ' + d.surname ELSE '' END) AS driver_name,
              cr.name AS route_name
       FROM logistics_delivery_ledger_diesel x
       LEFT JOIN contractor_trucks ct ON ct.id = x.truck_id
       LEFT JOIN contractor_drivers d ON d.id = x.driver_id
       LEFT JOIN contractor_routes cr ON cr.id = x.route_id
       WHERE x.id = @id`,
      { id }
    );
    res.status(201).json({ entry: mapDieselRow(row.recordset?.[0]) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.patch('/diesel/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    const sets = [];
    const params = { id: req.params.id, t, uid: req.user?.id };
    const fields = {
      truck_id: 'truckId',
      driver_id: 'driverId',
      route_id: 'routeId',
      transaction_at: 'transactionAt',
      location: 'location',
      litres: 'litres',
      price_per_litre: 'price',
      amount_rand: 'amount',
      odometer_km: 'odo',
      supplier: 'supplier',
      receipt_ref: 'receipt',
      notes: 'notes',
    };
    for (const [col, p] of Object.entries(fields)) {
      if (b[col] === undefined) continue;
      sets.push(`${col} = @${p}`);
      params[p] = b[col];
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = SYSUTCDATETIME()', 'updated_by_user_id = @uid');
    await query(`UPDATE logistics_delivery_ledger_diesel SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
    const row = await query(
      `SELECT x.*, ct.registration AS truck_registration,
              CONCAT(d.full_name, CASE WHEN d.surname IS NOT NULL THEN ' ' + d.surname ELSE '' END) AS driver_name,
              cr.name AS route_name
       FROM logistics_delivery_ledger_diesel x
       LEFT JOIN contractor_trucks ct ON ct.id = x.truck_id
       LEFT JOIN contractor_drivers d ON d.id = x.driver_id
       LEFT JOIN contractor_routes cr ON cr.id = x.route_id
       WHERE x.id = @id AND x.tenant_id = @t`,
      { id: req.params.id, t }
    );
    res.json({ entry: mapDieselRow(row.recordset?.[0]) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.delete('/diesel/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    await query(`DELETE FROM logistics_delivery_ledger_diesel WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    res.json({ ok: true });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.get('/expenses', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const { sql, params } = buildLedgerDateFilter(req.query, 'e', 'expense_date');
    const r = await query(
      `SELECT e.*, ct.registration AS truck_registration,
              CONCAT(d.full_name, CASE WHEN d.surname IS NOT NULL THEN ' ' + d.surname ELSE '' END) AS driver_name,
              cr.name AS route_name
       FROM logistics_delivery_ledger_expenses e
       LEFT JOIN contractor_trucks ct ON ct.id = e.truck_id
       LEFT JOIN contractor_drivers d ON d.id = e.driver_id
       LEFT JOIN contractor_routes cr ON cr.id = e.route_id
       WHERE e.tenant_id = @t ${sql}
       ORDER BY e.expense_date DESC`,
      { t, ...params }
    );
    res.json({ entries: (r.recordset || []).map(mapExpenseRow) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    if (!b.truck_id) return res.status(400).json({ error: 'Truck is required' });
    if (!b.expense_date) return res.status(400).json({ error: 'Expense date is required' });
    const amount = parseDecimal(b.amount_rand);
    if (amount == null || amount < 0) return res.status(400).json({ error: 'Valid amount is required' });

    let routeId = b.route_id || null;
    if (!routeId) {
      const route = await resolveTruckRoute(query, t, b.truck_id);
      routeId = route.routeId;
    }

    const ins = await query(
      `INSERT INTO logistics_delivery_ledger_expenses (
        tenant_id, truck_id, driver_id, route_id, expense_type, expense_date, amount_rand,
        vendor, location, odometer_km, description, receipt_ref, created_by_user_id, updated_by_user_id
      ) OUTPUT INSERTED.id VALUES (
        @t, @truckId, @driverId, @routeId, @type, @expDate, @amount,
        @vendor, @location, @odo, @desc, @receipt, @uid, @uid
      )`,
      {
        t,
        truckId: b.truck_id,
        driverId: b.driver_id || null,
        routeId,
        type: String(b.expense_type || 'other').trim(),
        expDate: b.expense_date,
        amount,
        vendor: b.vendor?.trim() || null,
        location: b.location?.trim() || null,
        odo: parseDecimal(b.odometer_km),
        desc: b.description?.trim() || null,
        receipt: b.receipt_ref?.trim() || null,
        uid: req.user?.id,
      }
    );
    const id = getRow(ins.recordset?.[0], 'id');
    const row = await query(
      `SELECT e.*, ct.registration AS truck_registration,
              CONCAT(d.full_name, CASE WHEN d.surname IS NOT NULL THEN ' ' + d.surname ELSE '' END) AS driver_name,
              cr.name AS route_name
       FROM logistics_delivery_ledger_expenses e
       LEFT JOIN contractor_trucks ct ON ct.id = e.truck_id
       LEFT JOIN contractor_drivers d ON d.id = e.driver_id
       LEFT JOIN contractor_routes cr ON cr.id = e.route_id
       WHERE e.id = @id`,
      { id }
    );
    res.status(201).json({ entry: mapExpenseRow(row.recordset?.[0]) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const t = tenantId(req);
    await query(`DELETE FROM logistics_delivery_ledger_expenses WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    res.json({ ok: true });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.get('/deliveries', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const { sql, params } = buildLedgerDateFilter(req.query, 'd', 'delivery_date');
    const r = await query(
      `SELECT d.* FROM logistics_delivery_ledger_deliveries d
       WHERE d.tenant_id = @t ${sql}
       ORDER BY d.delivery_date DESC, d.truck_registration`,
      { t, ...params }
    );
    res.json({ deliveries: (r.recordset || []).map(mapDeliveryRow) });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

const CC_LEDGER_IMPORT_FROM = `
  FROM command_centre_single_ops_shift_reports r
  INNER JOIN users creator ON creator.id = r.created_by_user_id AND creator.tenant_id = @t
  INNER JOIN command_centre_single_ops_truck_deliveries td ON td.report_id = r.id
  INNER JOIN command_centre_single_ops_truck_delivery_routes tdr ON tdr.delivery_id = td.id
  LEFT JOIN contractor_trucks ct
    ON UPPER(LTRIM(RTRIM(ISNULL(ct.registration, N'')))) = UPPER(LTRIM(RTRIM(ISNULL(td.truck_registration, N''))))
    AND ct.tenant_id = @t
  LEFT JOIN contractors c ON c.id = ct.contractor_id
  LEFT JOIN contractor_routes cr ON cr.id = tdr.route_id AND cr.tenant_id = @t
`;

router.get('/command-centre/preview', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const df = req.query.date_from || null;
    const dt = req.query.date_to || null;
    const r = await query(
      `SELECT tdr.id AS source_delivery_id,
              r.id AS source_report_id,
              COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) AS delivery_date,
              r.shift_date,
              td.truck_registration,
              td.driver_name,
              td.remarks,
              c.name AS contractor_name,
              COALESCE(cr.id, tdr.route_id) AS route_id,
              COALESCE(cr.name, tdr.route_name) AS route_name,
              tdr.completed_deliveries,
              tdr.tons_loaded
       ${CC_LEDGER_IMPORT_FROM}
       WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
         AND (@df IS NULL OR COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= @df)
         AND (@dt IS NULL OR COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) <= @dt)
         AND NOT EXISTS (
           SELECT 1 FROM logistics_delivery_ledger_deliveries ld
           WHERE ld.tenant_id = @t AND ld.source_delivery_id = tdr.id
         )
       ORDER BY delivery_date DESC, td.truck_registration, route_name`,
      { t, df, dt }
    );
    const preview = await Promise.all(
      (r.recordset || []).map(async (row) => {
        const routeId = getRow(row, 'route_id');
        const completed = parseIntSafe(getRow(row, 'completed_deliveries'));
        const tonsLoaded = parseDecimal(getRow(row, 'tons_loaded'));
        const truckIdForFuel = getRow(row, 'truck_id');
        const [revEst, fuelEst] = await Promise.all([
          estimateAllocationRevenue(query, t, routeId, completed, tonsLoaded),
          estimateDeliveryFuel(query, t, {
            truckId: truckIdForFuel,
            routeId,
            completedDeliveries: completed,
          }),
        ]);
        return {
          source_delivery_id: getRow(row, 'source_delivery_id'),
          source_report_id: getRow(row, 'source_report_id'),
          delivery_date: getRow(row, 'delivery_date'),
          shift_date: getRow(row, 'shift_date'),
          truck_registration: getRow(row, 'truck_registration'),
          driver_name: getRow(row, 'driver_name'),
          completed_deliveries: completed,
          tons_loaded: tonsLoaded,
          estimated_revenue: revEst.revenue_amount,
          estimated_fuel_litres: fuelEst.estimated_fuel_litres,
          estimated_fuel_cost: fuelEst.estimated_fuel_cost,
          remarks: getRow(row, 'remarks'),
          contractor_name: getRow(row, 'contractor_name'),
          route_id: routeId,
          route_name: getRow(row, 'route_name'),
        };
      })
    );
    res.json({ preview });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.post('/deliveries/import-command-centre', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const b = req.body || {};
    const ids = Array.isArray(b.source_delivery_ids) ? b.source_delivery_ids.filter(Boolean) : [];
    const importAll = b.import_all === true;
    const df = b.date_from || null;
    const dt = b.date_to || null;

    let previewSql = `
      SELECT tdr.id AS source_delivery_id, r.id AS source_report_id,
             COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) AS delivery_date,
             r.shift_date, td.truck_registration, td.driver_name, td.remarks,
             c.name AS contractor_name, ct.id AS truck_id,
             COALESCE(cr.id, tdr.route_id) AS route_id,
             COALESCE(cr.name, tdr.route_name) AS route_name,
             tdr.completed_deliveries, tdr.tons_loaded
      ${CC_LEDGER_IMPORT_FROM}
      WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
        AND NOT EXISTS (
          SELECT 1 FROM logistics_delivery_ledger_deliveries ld
          WHERE ld.tenant_id = @t AND ld.source_delivery_id = tdr.id
        )`;

    const params = { t, df, dt, uid: req.user?.id };
    if (ids.length) {
      previewSql += ` AND tdr.id IN (${ids.map((_, i) => `@id${i}`).join(',')})`;
      ids.forEach((id, i) => {
        params[`id${i}`] = id;
      });
    } else if (!importAll) {
      return res.status(400).json({ error: 'Select deliveries to import or set import_all with a date range' });
    }
    if (df) previewSql += ' AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= @df';
    if (dt) previewSql += ' AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) <= @dt';

    const rows = await query(previewSql, params);
    const list = rows.recordset || [];
    if (!list.length) return res.json({ imported: 0, batch_id: null });

    const batch = await query(
      `INSERT INTO logistics_delivery_ledger_batches (tenant_id, date_from, date_to, report_count, delivery_count, imported_by_user_id)
       OUTPUT INSERTED.id VALUES (@t, @df, @dt, 0, 0, @uid)`,
      { t, df, dt, uid: req.user?.id }
    );
    const batchId = getRow(batch.recordset?.[0], 'id');
    const reportIds = new Set();
    let imported = 0;

    for (const row of list) {
      const completed = parseIntSafe(getRow(row, 'completed_deliveries'));
      const tons = parseDecimal(getRow(row, 'tons_loaded'));
      if (completed <= 0 && !(tons > 0)) continue;
      let truckId = getRow(row, 'truck_id');
      let driverId = null;
      let routeId = getRow(row, 'route_id');
      let routeName = getRow(row, 'route_name');
      if (!truckId) {
        const match = await matchTruckAndDriver(query, t, getRow(row, 'truck_registration'), getRow(row, 'driver_name'));
        truckId = match.truckId;
        driverId = match.driverId;
      }
      if (!routeId && routeName && truckId) {
        const rr = await query(
          `SELECT TOP 1 id, name FROM contractor_routes WHERE tenant_id = @t AND name = @name`,
          { t, name: routeName }
        );
        routeId = getRow(rr.recordset?.[0], 'id') || null;
      }
      const [{ revenue_amount: revenue, revenue_per_load: revPerLoad }, fuelEst] = await Promise.all([
        estimateAllocationRevenue(query, t, routeId, completed, tons),
        estimateDeliveryFuel(query, t, { truckId, routeId, completedDeliveries: completed }),
      ]);

      await query(
        `INSERT INTO logistics_delivery_ledger_deliveries (
          tenant_id, batch_id, source_type, source_report_id, source_delivery_id,
          delivery_date, shift_date, truck_id, truck_registration, driver_id, driver_name,
          route_id, route_name, contractor_name, completed_deliveries, tons, revenue_per_load, revenue_amount,
          estimated_fuel_litres, estimated_fuel_cost,
          remarks, created_by_user_id, updated_by_user_id
        ) VALUES (
          @t, @batchId, N'command_centre', @reportId, @deliveryId,
          @deliveryDate, @shiftDate, @truckId, @reg, @driverId, @driverName,
          @routeId, @routeName, @contractor, @completed, @tons, @revPerLoad, @revenue,
          @fuelLitres, @fuelCost,
          @remarks, @uid, @uid
        )`,
        {
          t,
          batchId,
          reportId: getRow(row, 'source_report_id'),
          deliveryId: getRow(row, 'source_delivery_id'),
          deliveryDate: String(getRow(row, 'delivery_date')).slice(0, 10),
          shiftDate: getRow(row, 'shift_date') ? String(getRow(row, 'shift_date')).slice(0, 10) : null,
          truckId,
          reg: getRow(row, 'truck_registration'),
          driverId,
          driverName: getRow(row, 'driver_name'),
          routeId,
          routeName,
          contractor: getRow(row, 'contractor_name'),
          completed,
          tons,
          revPerLoad,
          revenue,
          fuelLitres: fuelEst.estimated_fuel_litres,
          fuelCost: fuelEst.estimated_fuel_cost,
          remarks: getRow(row, 'remarks'),
          uid: req.user?.id,
        }
      );
      reportIds.add(String(getRow(row, 'source_report_id')));
      imported += 1;
    }

    await query(
      `UPDATE logistics_delivery_ledger_batches SET report_count = @rc, delivery_count = @dc WHERE id = @id`,
      { id: batchId, rc: reportIds.size, dc: imported }
    );

    res.json({ imported, batch_id: batchId, report_count: reportIds.size });
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.get('/trial-balance', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const data = await computeTrialBalance(query, t, req.query);
    res.json(data);
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const t = tenantId(req);
    const data = await computeLedgerDashboard(query, t, req.query);
    res.json(data);
  } catch (e) {
    if (ledgerMissing(e, res)) return;
    next(e);
  }
});

export default router;
