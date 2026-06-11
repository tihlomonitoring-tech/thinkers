/** Delivery Activity Ledger — diesel, truck expenses, CC deliveries, trial balance. */

import { normRegistration } from './logisticsFinanceLoadImport.js';

export function getRow(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function parseIntSafe(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d.-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseDecimal(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildLedgerDateFilter(queryParams, alias, dateCol) {
  const parts = [];
  const params = {};
  if (queryParams.date_from) {
    parts.push(`${alias}.${dateCol} >= @dateFrom`);
    params.dateFrom = queryParams.date_from;
  }
  if (queryParams.date_to) {
    parts.push(`${alias}.${dateCol} <= @dateTo`);
    params.dateTo = queryParams.date_to;
  }
  if (queryParams.route_id) {
    parts.push(`${alias}.route_id = @routeId`);
    params.routeId = queryParams.route_id;
  }
  if (queryParams.truck_id) {
    parts.push(`${alias}.truck_id = @truckId`);
    params.truckId = queryParams.truck_id;
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

export async function matchTruckAndDriver(query, tenantId, registration, driverName) {
  const norm = normRegistration(registration);
  let truckId = null;
  let contractorId = null;
  let driverId = null;
  if (norm) {
    const tr = await query(
      `SELECT TOP 1 ct.id, ct.contractor_id
       FROM contractor_trucks ct
       INNER JOIN contractors c ON c.id = ct.contractor_id AND c.tenant_id = @t
       WHERE LOWER(REPLACE(REPLACE(REPLACE(ISNULL(ct.registration, ''), ' ', ''), '-', ''), '(', '')) = @norm`,
      { t: tenantId, norm }
    );
    const row = tr.recordset?.[0];
    if (row) {
      truckId = getRow(row, 'id');
      contractorId = getRow(row, 'contractor_id');
    }
  }
  const dName = String(driverName || '').trim();
  if (dName) {
    const dr = await query(
      `SELECT TOP 1 d.id FROM contractor_drivers d
       WHERE d.tenant_id = @t AND (
         LOWER(LTRIM(RTRIM(ISNULL(d.full_name, '')))) = LOWER(@n)
         OR LOWER(LTRIM(RTRIM(CONCAT(ISNULL(d.full_name, ''), ' ', ISNULL(d.surname, ''))))) = LOWER(@n)
       )`,
      { t: tenantId, n: dName }
    );
    driverId = getRow(dr.recordset?.[0], 'id') || null;
  }
  return { truckId, contractorId, driverId };
}

export async function resolveTruckRoute(query, tenantId, truckId) {
  if (!truckId) return { routeId: null, routeName: null };
  const r = await query(
    `SELECT TOP 1 cr.id AS route_id, cr.name AS route_name
     FROM contractor_route_trucks crt
     INNER JOIN contractor_routes cr ON cr.id = crt.route_id AND cr.tenant_id = @t
     WHERE crt.truck_id = @truckId
     ORDER BY cr.[order], cr.name`,
    { t: tenantId, truckId }
  );
  const row = r.recordset?.[0];
  return {
    routeId: getRow(row, 'route_id') || null,
    routeName: getRow(row, 'route_name') || null,
  };
}

export async function getRouteRatePerTon(query, tenantId, routeId) {
  if (!routeId) return null;
  try {
    const r = await query(
      `SELECT TOP 1 rate_per_ton FROM access_route_target_regulations
       WHERE tenant_id = @t AND route_id = @routeId AND rate_per_ton IS NOT NULL AND rate_per_ton > 0`,
      { t: tenantId, routeId }
    );
    const rate = Number(getRow(r.recordset?.[0], 'rate_per_ton'));
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

const DEFAULT_FUEL_LITRES_PER_100KM = 42;

export async function estimateDeliveryFuel(query, tenantId, { truckId, routeId, completedDeliveries }) {
  const completed = Math.max(0, Number(completedDeliveries) || 0);
  if (completed <= 0) {
    return { estimated_fuel_litres: null, estimated_fuel_cost: null };
  }

  let litresPer100 = null;
  let distanceKm = null;
  let fuelPrice = null;

  if (truckId) {
    try {
      const tr = await query(
        `SELECT fuel_consumption_litres_per_100km FROM contractor_trucks
         WHERE id = @id AND tenant_id = @t`,
        { id: truckId, t: tenantId }
      );
      litresPer100 = parseDecimal(getRow(tr.recordset?.[0], 'fuel_consumption_litres_per_100km'));
    } catch {
      litresPer100 = null;
    }
  }

  if (routeId) {
    try {
      const rr = await query(
        `SELECT COALESCE(reg.distance_km, r.distance_km) AS distance_km,
                reg.fuel_litres_per_100km, reg.fuel_price_per_litre
         FROM contractor_routes r
         LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = @t
         WHERE r.id = @routeId AND r.tenant_id = @t`,
        { routeId, t: tenantId }
      );
      const row = rr.recordset?.[0];
      distanceKm = Number(getRow(row, 'distance_km')) || null;
      if (litresPer100 == null) litresPer100 = parseDecimal(getRow(row, 'fuel_litres_per_100km'));
      fuelPrice = parseDecimal(getRow(row, 'fuel_price_per_litre'));
    } catch {
      // route / regulations table may be unavailable
    }
  }

  litresPer100 = litresPer100 || DEFAULT_FUEL_LITRES_PER_100KM;
  if (!distanceKm || distanceKm <= 0) {
    return { estimated_fuel_litres: null, estimated_fuel_cost: null };
  }

  const litresPerTrip = round2((distanceKm * litresPer100) / 100);
  const totalLitres = round2(litresPerTrip * completed);
  const cost = fuelPrice != null && fuelPrice > 0 ? round2(totalLitres * fuelPrice) : null;

  return {
    estimated_fuel_litres: totalLitres,
    estimated_fuel_cost: cost,
  };
}

export async function estimateAllocationRevenue(query, tenantId, routeId, completed, tons) {
  const completedNum = Number(completed) || 0;
  const tonsNum = Number(tons) || 0;
  const rate = await getRouteRatePerTon(query, tenantId, routeId);
  if (rate != null && tonsNum > 0) {
    const revenue = round2(rate * tonsNum);
    return {
      revenue_amount: revenue,
      revenue_per_load: completedNum > 0 ? round2(revenue / completedNum) : null,
    };
  }
  const revPerLoad = await estimateRevenuePerLoad(query, tenantId, routeId);
  if (revPerLoad != null && completedNum > 0) {
    return { revenue_amount: round2(revPerLoad * completedNum), revenue_per_load: revPerLoad };
  }
  return { revenue_amount: null, revenue_per_load: revPerLoad };
}

export async function estimateRevenuePerLoad(query, tenantId, routeId) {
  if (!routeId) return null;
  try {
    const r = await query(
      `SELECT TOP 1 t.rate_per_ton, t.avg_payload_tons, cr.min_tons, cr.max_tons
       FROM access_route_target_regulations t
       LEFT JOIN contractor_routes cr ON cr.id = t.route_id
       WHERE t.tenant_id = @t AND t.route_id = @routeId`,
      { t: tenantId, routeId }
    );
    const row = r.recordset?.[0];
    if (!row) return null;
    const rate = Number(getRow(row, 'rate_per_ton')) || 0;
    const payload = Number(getRow(row, 'avg_payload_tons'))
      || Number(getRow(row, 'min_tons'))
      || Number(getRow(row, 'max_tons'))
      || 36;
    if (rate <= 0) return null;
    return round2(rate * payload);
  } catch {
    return null;
  }
}

export function mapDieselRow(row) {
  if (!row) return null;
  return {
    id: getRow(row, 'id'),
    truck_id: getRow(row, 'truck_id'),
    truck_registration: getRow(row, 'truck_registration'),
    driver_id: getRow(row, 'driver_id'),
    driver_name: getRow(row, 'driver_name'),
    route_id: getRow(row, 'route_id'),
    route_name: getRow(row, 'route_name'),
    transaction_at: getRow(row, 'transaction_at'),
    location: getRow(row, 'location'),
    litres: getRow(row, 'litres') != null ? Number(getRow(row, 'litres')) : null,
    price_per_litre: getRow(row, 'price_per_litre') != null ? Number(getRow(row, 'price_per_litre')) : null,
    amount_rand: getRow(row, 'amount_rand') != null ? Number(getRow(row, 'amount_rand')) : null,
    odometer_km: getRow(row, 'odometer_km') != null ? Number(getRow(row, 'odometer_km')) : null,
    supplier: getRow(row, 'supplier') || null,
    receipt_ref: getRow(row, 'receipt_ref') || null,
    notes: getRow(row, 'notes') || null,
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
  };
}

export function mapExpenseRow(row) {
  if (!row) return null;
  return {
    id: getRow(row, 'id'),
    truck_id: getRow(row, 'truck_id'),
    truck_registration: getRow(row, 'truck_registration'),
    driver_id: getRow(row, 'driver_id'),
    driver_name: getRow(row, 'driver_name'),
    route_id: getRow(row, 'route_id'),
    route_name: getRow(row, 'route_name'),
    expense_type: getRow(row, 'expense_type'),
    expense_date: getRow(row, 'expense_date'),
    amount_rand: getRow(row, 'amount_rand') != null ? Number(getRow(row, 'amount_rand')) : null,
    vendor: getRow(row, 'vendor') || null,
    location: getRow(row, 'location') || null,
    odometer_km: getRow(row, 'odometer_km') != null ? Number(getRow(row, 'odometer_km')) : null,
    description: getRow(row, 'description') || null,
    receipt_ref: getRow(row, 'receipt_ref') || null,
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
  };
}

export function mapDeliveryRow(row) {
  if (!row) return null;
  return {
    id: getRow(row, 'id'),
    batch_id: getRow(row, 'batch_id'),
    source_type: getRow(row, 'source_type'),
    source_report_id: getRow(row, 'source_report_id'),
    source_delivery_id: getRow(row, 'source_delivery_id'),
    delivery_date: getRow(row, 'delivery_date'),
    shift_date: getRow(row, 'shift_date'),
    truck_id: getRow(row, 'truck_id'),
    truck_registration: getRow(row, 'truck_registration'),
    driver_id: getRow(row, 'driver_id'),
    driver_name: getRow(row, 'driver_name'),
    route_id: getRow(row, 'route_id'),
    route_name: getRow(row, 'route_name'),
    contractor_name: getRow(row, 'contractor_name'),
    completed_deliveries: Number(getRow(row, 'completed_deliveries')) || 0,
    tons: getRow(row, 'tons') != null ? Number(getRow(row, 'tons')) : null,
    revenue_per_load: getRow(row, 'revenue_per_load') != null ? Number(getRow(row, 'revenue_per_load')) : null,
    revenue_amount: getRow(row, 'revenue_amount') != null ? Number(getRow(row, 'revenue_amount')) : null,
    estimated_fuel_litres: getRow(row, 'estimated_fuel_litres') != null ? Number(getRow(row, 'estimated_fuel_litres')) : null,
    estimated_fuel_cost: getRow(row, 'estimated_fuel_cost') != null ? Number(getRow(row, 'estimated_fuel_cost')) : null,
    remarks: getRow(row, 'remarks') || null,
    created_at: getRow(row, 'created_at'),
    updated_at: getRow(row, 'updated_at'),
  };
}

export async function computeTrialBalance(query, tenantId, filters = {}) {
  const { sql: delSql, params: delParams } = buildLedgerDateFilter(filters, 'd', 'delivery_date');
  const { sql: dieselSql, params: dieselParams } = buildLedgerDateFilter(filters, 'x', 'transaction_at');
  const dieselDateSql = dieselSql.replace(/x\.transaction_at/g, 'CAST(x.transaction_at AS DATE)');
  const { sql: expSql, params: expParams } = buildLedgerDateFilter(filters, 'e', 'expense_date');

  const deliveries = await query(
    `SELECT d.route_id, d.route_name, d.truck_id, d.truck_registration,
            SUM(ISNULL(d.completed_deliveries, 0)) AS completed_deliveries,
            SUM(ISNULL(d.revenue_amount, 0)) AS revenue,
            SUM(ISNULL(d.tons, 0)) AS tons,
            SUM(ISNULL(d.estimated_fuel_litres, 0)) AS estimated_fuel_litres,
            SUM(ISNULL(d.estimated_fuel_cost, 0)) AS estimated_fuel_cost
     FROM logistics_delivery_ledger_deliveries d
     WHERE d.tenant_id = @t ${delSql}
     GROUP BY d.route_id, d.route_name, d.truck_id, d.truck_registration`,
    { t: tenantId, ...delParams }
  );

  const diesel = await query(
    `SELECT x.route_id, r.name AS route_name, x.truck_id, ct.registration AS truck_registration,
            SUM(ISNULL(x.litres, 0)) AS diesel_litres,
            SUM(ISNULL(x.amount_rand, 0)) AS diesel_cost
     FROM logistics_delivery_ledger_diesel x
     LEFT JOIN contractor_routes r ON r.id = x.route_id
     LEFT JOIN contractor_trucks ct ON ct.id = x.truck_id
     WHERE x.tenant_id = @t ${dieselDateSql}
     GROUP BY x.route_id, r.name, x.truck_id, ct.registration`,
    { t: tenantId, ...dieselParams }
  );

  const expenses = await query(
    `SELECT e.route_id, r.name AS route_name, e.truck_id, ct.registration AS truck_registration,
            SUM(ISNULL(e.amount_rand, 0)) AS other_expense
     FROM logistics_delivery_ledger_expenses e
     LEFT JOIN contractor_routes r ON r.id = e.route_id
     LEFT JOIN contractor_trucks ct ON ct.id = e.truck_id
     WHERE e.tenant_id = @t ${expSql}
     GROUP BY e.route_id, r.name, e.truck_id, ct.registration`,
    { t: tenantId, ...expParams }
  );

  const byRoute = new Map();
  const byTruck = new Map();

  const bump = (map, key, label, patch) => {
    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        route_id: patch.route_id || null,
        route_name: patch.route_name || null,
        truck_id: patch.truck_id || null,
        truck_registration: patch.truck_registration || null,
        completed_deliveries: 0,
        tons: 0,
        revenue: 0,
        diesel_litres: 0,
        diesel_cost: 0,
        other_expense: 0,
      });
    }
    const row = map.get(key);
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number') row[k] = (row[k] || 0) + v;
      else if (v != null && v !== '') row[k] = v;
    }
  };

  for (const row of deliveries.recordset || []) {
    const routeKey = String(getRow(row, 'route_id') || getRow(row, 'route_name') || 'unassigned');
    const truckKey = String(getRow(row, 'truck_id') || getRow(row, 'truck_registration') || 'unknown');
    const patch = {
      route_id: getRow(row, 'route_id'),
      route_name: getRow(row, 'route_name') || 'Unassigned route',
      truck_id: getRow(row, 'truck_id'),
      truck_registration: getRow(row, 'truck_registration'),
      completed_deliveries: Number(getRow(row, 'completed_deliveries')) || 0,
      tons: Number(getRow(row, 'tons')) || 0,
      revenue: Number(getRow(row, 'revenue')) || 0,
      diesel_litres: Number(getRow(row, 'estimated_fuel_litres')) || 0,
      diesel_cost: Number(getRow(row, 'estimated_fuel_cost')) || 0,
    };
    bump(byRoute, routeKey, patch.route_name, patch);
    bump(byTruck, truckKey, patch.truck_registration || truckKey, patch);
  }

  for (const row of diesel.recordset || []) {
    const routeKey = String(getRow(row, 'route_id') || getRow(row, 'route_name') || 'unassigned');
    const truckKey = String(getRow(row, 'truck_id') || getRow(row, 'truck_registration') || 'unknown');
    const patch = {
      route_id: getRow(row, 'route_id'),
      route_name: getRow(row, 'route_name') || 'Unassigned route',
      truck_id: getRow(row, 'truck_id'),
      truck_registration: getRow(row, 'truck_registration'),
      diesel_litres: Number(getRow(row, 'diesel_litres')) || 0,
      diesel_cost: Number(getRow(row, 'diesel_cost')) || 0,
    };
    bump(byRoute, routeKey, patch.route_name, patch);
    bump(byTruck, truckKey, patch.truck_registration || truckKey, patch);
  }

  for (const row of expenses.recordset || []) {
    const routeKey = String(getRow(row, 'route_id') || getRow(row, 'route_name') || 'unassigned');
    const truckKey = String(getRow(row, 'truck_id') || getRow(row, 'truck_registration') || 'unknown');
    const patch = {
      route_id: getRow(row, 'route_id'),
      route_name: getRow(row, 'route_name') || 'Unassigned route',
      truck_id: getRow(row, 'truck_id'),
      truck_registration: getRow(row, 'truck_registration'),
      other_expense: Number(getRow(row, 'other_expense')) || 0,
    };
    bump(byRoute, routeKey, patch.route_name, patch);
    bump(byTruck, truckKey, patch.truck_registration || truckKey, patch);
  }

  const finalize = (rows) =>
    rows
      .map((r) => {
        const totalExpense = round2((r.diesel_cost || 0) + (r.other_expense || 0));
        const net = round2((r.revenue || 0) - totalExpense);
        const litresPerDelivery =
          r.completed_deliveries > 0 ? round2((r.diesel_litres || 0) / r.completed_deliveries) : null;
        const costPerDelivery =
          r.completed_deliveries > 0 ? round2(totalExpense / r.completed_deliveries) : null;
        return {
          ...r,
          total_expense: totalExpense,
          net_margin: net,
          litres_per_delivery: litresPerDelivery,
          cost_per_delivery: costPerDelivery,
          margin_percent: r.revenue > 0 ? round2((net / r.revenue) * 100) : null,
        };
      })
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  const by_route = finalize([...byRoute.values()]);
  const by_truck = finalize([...byTruck.values()]);

  const totals = by_route.reduce(
    (acc, r) => ({
      completed_deliveries: acc.completed_deliveries + (r.completed_deliveries || 0),
      revenue: acc.revenue + (r.revenue || 0),
      diesel_litres: acc.diesel_litres + (r.diesel_litres || 0),
      diesel_cost: acc.diesel_cost + (r.diesel_cost || 0),
      other_expense: acc.other_expense + (r.other_expense || 0),
      total_expense: acc.total_expense + (r.total_expense || 0),
      net_margin: acc.net_margin + (r.net_margin || 0),
    }),
    {
      completed_deliveries: 0,
      revenue: 0,
      diesel_litres: 0,
      diesel_cost: 0,
      other_expense: 0,
      total_expense: 0,
      net_margin: 0,
    }
  );
  Object.keys(totals).forEach((k) => {
    totals[k] = round2(totals[k]);
  });

  return { totals, by_route, by_truck };
}

export async function computeLedgerDashboard(query, tenantId, filters = {}) {
  const trial = await computeTrialBalance(query, tenantId, filters);
  const { sql: delSql, params: delParams } = buildLedgerDateFilter(filters, 'd', 'delivery_date');

  const byDayRes = await query(
    `SELECT d.delivery_date AS date,
            SUM(ISNULL(d.completed_deliveries, 0)) AS completed_deliveries,
            SUM(ISNULL(d.revenue_amount, 0)) AS revenue
     FROM logistics_delivery_ledger_deliveries d
     WHERE d.tenant_id = @t ${delSql}
     GROUP BY d.delivery_date
     ORDER BY d.delivery_date`,
    { t: tenantId, ...delParams }
  );

  const dieselByDay = await query(
    `SELECT CAST(x.transaction_at AS DATE) AS date,
            SUM(ISNULL(x.amount_rand, 0)) AS diesel_cost,
            SUM(ISNULL(x.litres, 0)) AS diesel_litres
     FROM logistics_delivery_ledger_diesel x
     WHERE x.tenant_id = @t
       ${filters.date_from ? 'AND CAST(x.transaction_at AS DATE) >= @dateFrom' : ''}
       ${filters.date_to ? 'AND CAST(x.transaction_at AS DATE) <= @dateTo' : ''}
     GROUP BY CAST(x.transaction_at AS DATE)`,
    { t: tenantId, ...delParams }
  );

  const expByDay = await query(
    `SELECT e.expense_date AS date, SUM(ISNULL(e.amount_rand, 0)) AS other_expense
     FROM logistics_delivery_ledger_expenses e
     WHERE e.tenant_id = @t
       ${filters.date_from ? 'AND e.expense_date >= @dateFrom' : ''}
       ${filters.date_to ? 'AND e.expense_date <= @dateTo' : ''}
     GROUP BY e.expense_date`,
    { t: tenantId, ...delParams }
  );

  const dayMap = new Map();
  for (const row of byDayRes.recordset || []) {
    const d = String(getRow(row, 'date')).slice(0, 10);
    dayMap.set(d, {
      date: d,
      completed_deliveries: Number(getRow(row, 'completed_deliveries')) || 0,
      revenue: Number(getRow(row, 'revenue')) || 0,
      diesel_cost: 0,
      diesel_litres: 0,
      other_expense: 0,
    });
  }
  for (const row of dieselByDay.recordset || []) {
    const d = String(getRow(row, 'date')).slice(0, 10);
    if (!dayMap.has(d)) dayMap.set(d, { date: d, completed_deliveries: 0, revenue: 0, diesel_cost: 0, diesel_litres: 0, other_expense: 0 });
    const day = dayMap.get(d);
    day.diesel_cost += Number(getRow(row, 'diesel_cost')) || 0;
    day.diesel_litres += Number(getRow(row, 'diesel_litres')) || 0;
  }
  for (const row of expByDay.recordset || []) {
    const d = String(getRow(row, 'date')).slice(0, 10);
    if (!dayMap.has(d)) dayMap.set(d, { date: d, completed_deliveries: 0, revenue: 0, diesel_cost: 0, diesel_litres: 0, other_expense: 0 });
    dayMap.get(d).other_expense += Number(getRow(row, 'other_expense')) || 0;
  }

  const by_day = [...dayMap.values()]
    .map((d) => ({
      ...d,
      total_expense: round2((d.diesel_cost || 0) + (d.other_expense || 0)),
      net: round2((d.revenue || 0) - (d.diesel_cost || 0) - (d.other_expense || 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const routes = await query(
    `SELECT DISTINCT route_id, route_name FROM logistics_delivery_ledger_deliveries
     WHERE tenant_id = @t AND route_name IS NOT NULL ORDER BY route_name`,
    { t: tenantId }
  );
  const trucks = await query(
    `SELECT DISTINCT id, registration FROM contractor_trucks WHERE tenant_id = @t ORDER BY registration`,
    { t: tenantId }
  );

  return {
    kpis: {
      completed_deliveries: trial.totals.completed_deliveries,
      total_revenue: trial.totals.revenue,
      diesel_litres: trial.totals.diesel_litres,
      diesel_expense: trial.totals.diesel_cost,
      truck_expense: trial.totals.other_expense,
      total_expense: trial.totals.total_expense,
      net_margin: trial.totals.net_margin,
      delivery_rows: byDayRes.recordset?.length || 0,
    },
    by_day,
    by_route: trial.by_route.slice(0, 20),
    by_truck: trial.by_truck.slice(0, 20),
    filters: {
      routes: (routes.recordset || []).map((r) => ({
        id: getRow(r, 'route_id'),
        name: getRow(r, 'route_name'),
      })).filter((r) => r.name),
      trucks: (trucks.recordset || []).map((r) => ({
        id: getRow(r, 'id'),
        registration: getRow(r, 'registration'),
      })).filter((r) => r.registration),
    },
  };
}
