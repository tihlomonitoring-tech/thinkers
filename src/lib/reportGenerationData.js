import { query } from '../db.js';
import { addCalendarDays, toYmdFromDbOrString } from './appTime.js';

const TONNES_PER_LOAD_ESTIMATE = 35.03;

function getRow(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
    const lower = String(k).toLowerCase();
    for (const rk of Object.keys(row)) {
      if (String(rk).toLowerCase() === lower) return row[rk];
    }
  }
  return undefined;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

/** Always YYYY-MM-DD for SQL date parameters (handles Date objects from mssql). */
function normalizeYmd(v) {
  const ymd = toYmdFromDbOrString(v);
  return ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : todayYmd();
}

function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function routeMatches(filterRoute, name) {
  const f = String(filterRoute || '').trim().toLowerCase();
  if (!f) return true;
  const n = String(name || '').trim().toLowerCase();
  return n.includes(f) || f.includes(n);
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Build a compact data bundle for AI production report generation.
 */
export async function buildProductionReportDataBundle({
  tenantId = null,
  dateFrom,
  dateTo,
  routeId = null,
  routeName = null,
}) {
  const dateToFinal = normalizeYmd(dateTo);
  const dateFromFinal = dateFrom ? normalizeYmd(dateFrom) : addCalendarDays(dateToFinal, -29);
  const dateToExclusive = addCalendarDays(dateToFinal, 1);
  const routeFilter = String(routeName || '').trim();

  let sql = `
    SELECT
      r.id AS report_id,
      r.routes_json,
      r.report_date,
      r.shift_date,
      r.shift_start,
      r.approved_at,
      r.created_at,
      r.total_loads_delivered,
      r.incidents,
      r.non_compliance_calls,
      r.investigations,
      r.overall_performance,
      r.key_highlights,
      td.truck_registration,
      td.driver_name,
      td.completed_deliveries,
      rt.route_name,
      rt.total_loads_delivered AS route_loads_delivered,
      c.id AS contractor_id,
      c.name AS contractor_name
    FROM command_centre_single_ops_shift_reports r
    LEFT JOIN users creator ON creator.id = r.created_by_user_id
    LEFT JOIN command_centre_single_ops_truck_deliveries td ON td.report_id = r.id
    LEFT JOIN command_centre_single_ops_route_load_totals rt ON rt.report_id = r.id
    LEFT JOIN contractor_trucks ct
      ON UPPER(LTRIM(RTRIM(ISNULL(ct.registration, N'')))) = UPPER(LTRIM(RTRIM(ISNULL(td.truck_registration, N''))))
      AND (@tenantId IS NULL OR ct.tenant_id = @tenantId)
    LEFT JOIN contractors c ON c.id = ct.contractor_id
    WHERE LOWER(LTRIM(RTRIM(ISNULL(r.status, N'')))) = N'approved'
      AND (@tenantId IS NULL OR creator.tenant_id = @tenantId)
      AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) >= CAST(@dateFrom AS DATE)
      AND COALESCE(CONVERT(date, r.approved_at), r.report_date, r.shift_date, CONVERT(date, r.created_at)) < CAST(@dateToExclusive AS DATE)`;
  const params = { tenantId, dateFrom: dateFromFinal, dateToExclusive };
  const result = await query(sql, params);
  const rows = result.recordset || [];

  const truckDeliveryMap = new Map();
  const routeDeliveryMap = new Map();
  const reportHeaderDelivered = {};
  const reportDayById = {};
  const highlights = [];
  const shiftIncidents = [];
  const nonCompliance = [];
  const investigations = [];
  const parsedReportMeta = new Set();

  rows.forEach((row, rowIdx) => {
    const reportId = getRow(row, 'report_id');
    const reportKey = reportId ? String(reportId) : `row-${rowIdx}`;
    const routeNameRow = String(getRow(row, 'route_name') || '').trim();
    const truck = String(getRow(row, 'truck_registration') || '').trim();
    const completed = toNum(getRow(row, 'completed_deliveries'));
    const routeLoads = toNum(getRow(row, 'route_loads_delivered'));
    const contractorName = String(getRow(row, 'contractor_name') || 'Unmapped contractor').trim() || 'Unmapped contractor';
    const contractorId = getRow(row, 'contractor_id') || null;
    const day = toYmdFromDbOrString(
      getRow(row, 'approved_at') || getRow(row, 'report_date') || getRow(row, 'shift_date') || getRow(row, 'created_at')
    ) || '';

    if (routeFilter && routeNameRow && !routeMatches(routeFilter, routeNameRow)) {
      if (truck || routeNameRow) return;
    }

    const reportDelivered = Math.max(toNum(getRow(row, 'total_loads_delivered')), 0);
    reportHeaderDelivered[reportKey] = Math.max(Number(reportHeaderDelivered[reportKey] || 0), reportDelivered);
    if (day && !reportDayById[reportKey]) reportDayById[reportKey] = day;

    if (truck && reportId) {
      const tk = `${String(reportId)}|${truck.toUpperCase()}`;
      const prev = truckDeliveryMap.get(tk);
      if (!routeFilter || !routeNameRow || routeMatches(routeFilter, routeNameRow)) {
        truckDeliveryMap.set(tk, {
          report_id: String(reportId),
          truck_registration: truck,
          completed_deliveries: Math.max(prev?.completed_deliveries || 0, completed),
          contractor_id: contractorId ?? prev?.contractor_id ?? null,
          contractor_name: contractorName || prev?.contractor_name || 'Unmapped contractor',
          day,
          route_name: routeNameRow || prev?.route_name || '',
        });
      }
    }

    if (routeNameRow && reportId && routeMatches(routeFilter, routeNameRow)) {
      const rk = `${String(reportId)}|${routeNameRow.toLowerCase()}`;
      const prev = routeDeliveryMap.get(rk);
      routeDeliveryMap.set(rk, {
        report_id: String(reportId),
        route_name: routeNameRow,
        loads: Math.max(prev?.loads || 0, routeLoads),
        day: day || prev?.day || '',
      });
    }

    if (!parsedReportMeta.has(reportKey)) {
      parsedReportMeta.add(reportKey);
      const kh = String(getRow(row, 'key_highlights') || '').trim();
      const op = String(getRow(row, 'overall_performance') || '').trim();
      if (kh || op) {
        highlights.push({ report_id: reportKey, day, key_highlights: kh.slice(0, 500), overall_performance: op.slice(0, 500) });
      }
      for (const item of parseJsonArray(getRow(row, 'incidents'))) {
        shiftIncidents.push({
          report_id: reportKey,
          day,
          ...item,
          summary: String(item?.description || item?.title || item?.summary || JSON.stringify(item)).slice(0, 300),
        });
      }
      for (const item of parseJsonArray(getRow(row, 'non_compliance_calls'))) {
        nonCompliance.push({
          report_id: reportKey,
          day,
          ...item,
          summary: String(item?.description || item?.rule || item?.summary || JSON.stringify(item)).slice(0, 300),
        });
      }
      for (const item of parseJsonArray(getRow(row, 'investigations'))) {
        investigations.push({
          report_id: reportKey,
          day,
          ...item,
          summary: String(item?.description || item?.title || item?.summary || JSON.stringify(item)).slice(0, 300),
        });
      }
    }
  });

  const contractors = {};
  const trucks = {};
  const truckHaulier = {};
  const daily = {};
  for (const tv of truckDeliveryMap.values()) {
    if (routeFilter && tv.route_name && !routeMatches(routeFilter, tv.route_name)) continue;
    const ck = String(tv.contractor_id || tv.contractor_name);
    if (!contractors[ck]) {
      contractors[ck] = { contractor_name: tv.contractor_name, loads: 0, trucks: new Set() };
    }
    contractors[ck].loads += tv.completed_deliveries;
    contractors[ck].trucks.add(tv.truck_registration);
    trucks[tv.truck_registration] = (trucks[tv.truck_registration] || 0) + tv.completed_deliveries;
    truckHaulier[tv.truck_registration] = tv.contractor_name;
    if (tv.day) daily[tv.day] = (daily[tv.day] || 0) + tv.completed_deliveries;
  }

  const totalLoads = Math.round(Object.values(daily).reduce((s, v) => s + v, 0) * 100) / 100;
  const activeDays = Object.keys(daily).filter((d) => daily[d] > 0).length;
  const dailySeries = Object.keys(daily)
    .sort()
    .map((date) => ({ date, loads: Math.round(daily[date] * 100) / 100, trips: Math.round(daily[date]) }));
  const peakDay = dailySeries.reduce((best, d) => (d.loads > (best?.loads || 0) ? d : best), null);
  const lowDay = dailySeries.filter((d) => d.loads > 0).reduce((best, d) => (d.loads < (best?.loads ?? Infinity) ? d : best), null);

  const contractorPerformance = Object.entries(contractors)
    .map(([id, c]) => ({
      contractor_id: id,
      contractor_name: c.contractor_name,
      loads: Math.round(c.loads * 100) / 100,
      trips: Math.round(c.loads),
      trucks_active: c.trucks.size,
      pct_of_loads: totalLoads > 0 ? Math.round((c.loads / totalLoads) * 10000) / 100 : 0,
      estimated_tonnage: Math.round(c.loads * TONNES_PER_LOAD_ESTIMATE * 100) / 100,
    }))
    .sort((a, b) => b.loads - a.loads);

  const topTrucks = Object.entries(trucks)
    .map(([truck_registration, loads]) => ({
      truck_registration,
      haulier: truckHaulier[truck_registration] || '',
      trips: Math.round(loads),
      loads: Math.round(loads * 100) / 100,
      estimated_tonnage: Math.round(loads * TONNES_PER_LOAD_ESTIMATE * 100) / 100,
      avg_t_per_trip: loads > 0 ? Math.round(TONNES_PER_LOAD_ESTIMATE * 100) / 100 : 0,
    }))
    .sort((a, b) => b.loads - a.loads)
    .slice(0, 15);

  let breakdownSql = `
    SELECT i.id, i.reported_at, i.title, i.description, i.severity, i.type, i.location,
           tr.registration AS truck_registration, r.name AS route_name, t.name AS tenant_name
    FROM contractor_incidents i
    LEFT JOIN contractor_trucks tr ON tr.id = i.truck_id
    LEFT JOIN contractor_routes r ON r.id = i.route_id
    LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.reported_at >= CAST(@dateFrom AS DATE) AND i.reported_at < CAST(@dateToExclusive AS DATE)`;
  const bdParams = { dateFrom: dateFromFinal, dateToExclusive };
  if (routeId) {
    breakdownSql += ` AND i.route_id = @routeId`;
    bdParams.routeId = routeId;
  } else if (routeFilter) {
    breakdownSql += ` AND LOWER(LTRIM(RTRIM(ISNULL(r.name, N'')))) LIKE @routeLike`;
    bdParams.routeLike = `%${routeFilter.toLowerCase()}%`;
  }
  breakdownSql += ` ORDER BY i.reported_at DESC`;
  const bdResult = await query(breakdownSql, bdParams);
  const breakdowns = (bdResult.recordset || []).slice(0, 40).map((row) => ({
    id: getRow(row, 'id'),
    reported_at: getRow(row, 'reported_at'),
    truck_registration: getRow(row, 'truck_registration'),
    route_name: getRow(row, 'route_name'),
    tenant_name: getRow(row, 'tenant_name'),
    title: getRow(row, 'title'),
    description: String(getRow(row, 'description') || '').slice(0, 400),
    severity: getRow(row, 'severity'),
    type: getRow(row, 'type'),
    location: getRow(row, 'location'),
  }));

  const compResult = await query(
    `SELECT c.id, c.created_at, c.truck_registration, c.driver_name, c.route_name, c.status,
            c.gps_status, c.camera_status, c.recommend_suspend_truck, c.recommend_suspend_driver,
            t.name AS contractor_name,
            u.full_name AS inspector_name
     FROM cc_compliance_inspections c
     LEFT JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN users u ON u.id = c.inspector_user_id
     WHERE c.created_at >= CAST(@dateFrom AS DATE) AND c.created_at < CAST(@dateToExclusive AS DATE)
     ORDER BY c.created_at DESC`,
    { dateFrom: dateFromFinal, dateToExclusive }
  );
  let complianceInspections = (compResult.recordset || []).map((row) => ({
    id: getRow(row, 'id'),
    created_at: getRow(row, 'created_at'),
    truck_registration: getRow(row, 'truck_registration'),
    driver_name: getRow(row, 'driver_name'),
    route_name: getRow(row, 'route_name'),
    contractor_name: getRow(row, 'contractor_name'),
    inspector_name: getRow(row, 'inspector_name'),
    gps_status: getRow(row, 'gps_status'),
    camera_status: getRow(row, 'camera_status'),
    recommend_suspend_truck: !!getRow(row, 'recommend_suspend_truck'),
    recommend_suspend_driver: !!getRow(row, 'recommend_suspend_driver'),
    status: getRow(row, 'status'),
  }));
  if (routeFilter) {
    complianceInspections = complianceInspections.filter((c) => routeMatches(routeFilter, c.route_name));
  }

  const uniqueTrucks = new Set(Object.keys(trucks));
  const estimatedTonnage = Math.round(totalLoads * TONNES_PER_LOAD_ESTIMATE * 100) / 100;

  return {
    meta: {
      date_from: dateFromFinal,
      date_to: dateToFinal,
      route_id: routeId || null,
      route_name: routeFilter || routeName || 'All routes',
      tonnes_per_load_estimate: TONNES_PER_LOAD_ESTIMATE,
      generated_at: new Date().toISOString(),
    },
    summary: {
      total_loads: totalLoads,
      estimated_total_tonnage: estimatedTonnage,
      active_production_days: activeDays,
      avg_loads_per_day: activeDays > 0 ? Math.round((totalLoads / activeDays) * 100) / 100 : 0,
      avg_tons_per_load: TONNES_PER_LOAD_ESTIMATE,
      unique_trucks: uniqueTrucks.size,
      unique_hauliers: contractorPerformance.length,
      peak_day: peakDay,
      lowest_day: lowDay,
    },
    daily_series: dailySeries,
    contractor_performance: contractorPerformance,
    top_trucks: topTrucks,
    breakdowns,
    compliance_inspections: complianceInspections.slice(0, 30),
    shift_highlights: highlights.slice(0, 20),
    shift_incidents: shiftIncidents.slice(0, 30),
    non_compliance_calls: nonCompliance.slice(0, 40),
    investigations: investigations.slice(0, 40),
  };
}
