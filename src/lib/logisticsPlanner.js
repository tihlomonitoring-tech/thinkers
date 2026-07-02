import { todayYmd } from './appTime.js';
import { gid } from './logisticsActivityBoard.js';
import { sendPlanPublishedEmail } from './logisticsPlanningEmailAlerts.js';

const DEFAULT_WEIGHTS = {
  weight_margin: 1,
  weight_queue: 1,
  weight_travel: 1,
  weight_deviation: 1,
  weight_slip: 1.2,
  weight_targets: 1,
};

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parsePlanDate(input) {
  const d = input ? String(input).slice(0, 10) : todayYmd();
  return d;
}

export async function getPlannerSettings(query, tenantId) {
  const r = await query(
    `SELECT * FROM logistics_planner_settings WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const row = r.recordset?.[0];
  if (!row) return { ...DEFAULT_WEIGHTS, notify_email_plan_published: true, learning_note: null };
  return {
    notify_email_plan_published: get(row, 'notify_email_plan_published') !== false && get(row, 'notify_email_plan_published') !== 0,
    weight_margin: Number(get(row, 'weight_margin')) || DEFAULT_WEIGHTS.weight_margin,
    weight_queue: Number(get(row, 'weight_queue')) || DEFAULT_WEIGHTS.weight_queue,
    weight_travel: Number(get(row, 'weight_travel')) || DEFAULT_WEIGHTS.weight_travel,
    weight_deviation: Number(get(row, 'weight_deviation')) || DEFAULT_WEIGHTS.weight_deviation,
    weight_slip: Number(get(row, 'weight_slip')) || DEFAULT_WEIGHTS.weight_slip,
    weight_targets: Number(get(row, 'weight_targets')) || DEFAULT_WEIGHTS.weight_targets,
    learning_note: get(row, 'learning_note') || null,
    learning_updated_at: get(row, 'learning_updated_at'),
  };
}

/** Adjust scoring weights from plan-vs-actual variance and loading-slip reliability (30d). */
export async function refreshLearningWeights(query, tenantId) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromIso = fromDate.toISOString();

  const [varianceR, slipR, devR] = await Promise.all([
    query(
      `SELECT
         SUM(COALESCE(pr.expected_loads, 0)) AS expected_loads,
         SUM(COALESCE(actual.loads, 0)) AS actual_loads,
         SUM(COALESCE(pr.expected_margin, 0) * COALESCE(pr.expected_loads, 0)) AS expected_margin_total,
         SUM(COALESCE(actual.margin, 0)) AS actual_margin_total
       FROM logistics_daily_plan p
       INNER JOIN logistics_plan_route pr ON pr.plan_id = p.id AND pr.tenant_id = p.tenant_id
         AND pr.enabled = 1 AND pr.is_plan_b = 0
       OUTER APPLY (
         SELECT COUNT(*) AS loads,
                SUM(COALESCE(d.margin_amount, COALESCE(d.revenue_amount,0) - COALESCE(d.fuel_cost,0))) AS margin
         FROM tracking_delivery_record d
         INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
         LEFT JOIN tracking_delivery_record ld ON ld.trip_id = d.trip_id AND ld.tenant_id = d.tenant_id
           AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL
         WHERE d.tenant_id = p.tenant_id AND d.deleted_at IS NULL
           AND d.activity_phase = N'destination' AND d.status = N'completed'
           AND d.contractor_route_id = pr.contractor_route_id
           AND CAST(d.delivered_at AS DATE) = p.plan_date
           AND COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
       ) actual
       WHERE p.tenant_id = @tenantId AND p.status = N'published' AND p.plan_date >= CAST(@from AS DATE)`,
      { tenantId, from: fromIso }
    ),
    query(
      `SELECT COUNT(*) AS total_completed,
              SUM(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL THEN 1 ELSE 0 END) AS slip_verified
       FROM tracking_delivery_record d
       INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
       LEFT JOIN tracking_delivery_record ld ON ld.trip_id = d.trip_id AND ld.tenant_id = d.tenant_id
         AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         AND d.delivered_at >= @from`,
      { tenantId, from: fromIso }
    ),
    query(
      `SELECT COUNT(*) AS deviations FROM logistics_schedule_deviation
       WHERE tenant_id = @tenantId AND created_at >= @from`,
      { tenantId, from: fromIso }
    ),
  ]);

  const v = varianceR.recordset?.[0] || {};
  const expectedLoads = Number(get(v, 'expected_loads')) || 0;
  const actualLoads = Number(get(v, 'actual_loads')) || 0;
  const loadVariance = expectedLoads > 0 ? Math.abs(actualLoads - expectedLoads) / expectedLoads : 0;
  const expectedMargin = Number(get(v, 'expected_margin_total')) || 0;
  const actualMargin = Number(get(v, 'actual_margin_total')) || 0;
  const marginVariance = expectedMargin > 0 ? Math.abs(actualMargin - expectedMargin) / expectedMargin : 0;

  const slipRow = slipR.recordset?.[0] || {};
  const totalCompleted = Number(get(slipRow, 'total_completed')) || 0;
  const slipVerified = Number(get(slipRow, 'slip_verified')) || 0;
  const slipRate = totalCompleted > 0 ? slipVerified / totalCompleted : 1;
  const deviations = Number(get(devR.recordset?.[0], 'deviations')) || 0;

  const weights = { ...DEFAULT_WEIGHTS };
  if (loadVariance > 0.25 || marginVariance > 0.2) {
    weights.weight_targets = round2(Math.min(1.8, 1 + loadVariance));
    weights.weight_margin = round2(Math.min(1.6, 1 + marginVariance * 0.5));
  }
  if (slipRate < 0.85) {
    weights.weight_slip = round2(Math.min(2, 1.2 + (0.85 - slipRate) * 2));
  }
  if (deviations > 5) {
    weights.weight_deviation = round2(Math.min(1.8, 1 + deviations / 30));
  }

  const notes = [];
  if (loadVariance > 0.25) notes.push(`Load targets missed by ~${Math.round(loadVariance * 100)}% — targets weighted higher`);
  if (marginVariance > 0.2) notes.push(`Margin variance ~${Math.round(marginVariance * 100)}% — profitability weighted higher`);
  if (slipRate < 0.85) notes.push(`Loading slip capture ${Math.round(slipRate * 100)}% — slip compliance weighted higher`);
  if (deviations > 5) notes.push(`${deviations} off-plan schedules — adherence weighted higher`);
  const learning_note = notes.length
    ? notes.join('. ')
    : 'Stable performance — default weights. Verified loads require loading slips.';

  await query(
    `MERGE logistics_planner_settings AS t
     USING (SELECT @tenantId AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET
       weight_margin = @wMargin, weight_queue = @wQueue, weight_travel = @wTravel,
       weight_deviation = @wDev, weight_slip = @wSlip, weight_targets = @wTargets,
       learning_note = @note, learning_updated_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (
       tenant_id, weight_margin, weight_queue, weight_travel, weight_deviation, weight_slip, weight_targets, learning_note, learning_updated_at
     ) VALUES (
       @tenantId, @wMargin, @wQueue, @wTravel, @wDev, @wSlip, @wTargets, @note, SYSUTCDATETIME()
     );`,
    {
      tenantId,
      wMargin: weights.weight_margin,
      wQueue: weights.weight_queue,
      wTravel: weights.weight_travel,
      wDev: weights.weight_deviation,
      wSlip: weights.weight_slip,
      wTargets: weights.weight_targets,
      note: learning_note,
    }
  );

  return { ...weights, learning_note, slip_capture_rate: round2(slipRate * 100), load_variance_pct: round2(loadVariance * 100) };
}

function riskFromScore(score, marginDelta) {
  if (score >= 75 && marginDelta >= 0) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

export async function getOrCreateDailyPlan(query, tenantId, planDateInput, { userId = null, source = 'manual' } = {}) {
  const planDate = parsePlanDate(planDateInput);
  const existing = await query(
    `SELECT * FROM logistics_daily_plan WHERE tenant_id = @tenantId AND plan_date = @planDate`,
    { tenantId, planDate }
  );
  if (existing.recordset?.[0]) return mapPlanRow(existing.recordset[0]);

  const ins = await query(
    `INSERT INTO logistics_daily_plan (tenant_id, plan_date, status, source, title, created_by_user_id)
     OUTPUT INSERTED.*
     VALUES (@tenantId, @planDate, N'draft', @source, @title, @userId)`,
    {
      tenantId,
      planDate,
      source,
      title: `Logistics plan — ${planDate}`,
      userId: userId || null,
    }
  );
  return mapPlanRow(ins.recordset[0]);
}

function mapPlanRow(row) {
  return {
    id: gid(get(row, 'id')),
    tenant_id: gid(get(row, 'tenant_id')),
    plan_date: get(row, 'plan_date'),
    status: get(row, 'status'),
    source: get(row, 'source'),
    title: get(row, 'title'),
    execution_notes: get(row, 'execution_notes'),
    created_by_user_id: gid(get(row, 'created_by_user_id')),
    accepted_at: get(row, 'accepted_at'),
    published_at: get(row, 'published_at'),
    created_at: get(row, 'created_at'),
    updated_at: get(row, 'updated_at'),
  };
}

function mapPlanRouteRow(row) {
  return {
    id: gid(get(row, 'id')),
    plan_id: gid(get(row, 'plan_id')),
    contractor_route_id: gid(get(row, 'contractor_route_id')),
    route_name: get(row, 'route_name'),
    loading_address: get(row, 'loading_address'),
    destination_address: get(row, 'destination_address'),
    priority_rank: Number(get(row, 'priority_rank')) || 1,
    is_plan_b: !!get(row, 'is_plan_b'),
    plan_b_route_id: gid(get(row, 'plan_b_route_id')),
    plan_b_route_name: get(row, 'plan_b_route_name'),
    expected_loads: get(row, 'expected_loads') != null ? Number(get(row, 'expected_loads')) : null,
    expected_tons: get(row, 'expected_tons') != null ? Number(get(row, 'expected_tons')) : null,
    expected_revenue: get(row, 'expected_revenue') != null ? Number(get(row, 'expected_revenue')) : null,
    expected_margin: get(row, 'expected_margin') != null ? Number(get(row, 'expected_margin')) : null,
    risk_level: get(row, 'risk_level'),
    risk_mitigation: get(row, 'risk_mitigation'),
    execution_reason: get(row, 'execution_reason'),
    system_score: get(row, 'system_score') != null ? Number(get(row, 'system_score')) : null,
    system_advice: get(row, 'system_advice'),
    enabled: get(row, 'enabled') !== false && get(row, 'enabled') !== 0,
  };
}

export async function listPlanRoutes(query, tenantId, planId) {
  const r = await query(
    `SELECT pr.*, r.name AS route_name, r.loading_address, r.destination_address,
            pb.name AS plan_b_route_name
     FROM logistics_plan_route pr
     INNER JOIN contractor_routes r ON r.id = pr.contractor_route_id AND r.tenant_id = pr.tenant_id
     LEFT JOIN contractor_routes pb ON pb.id = pr.plan_b_route_id AND pb.tenant_id = pr.tenant_id
     WHERE pr.tenant_id = @tenantId AND pr.plan_id = @planId
     ORDER BY pr.is_plan_b ASC, pr.priority_rank ASC, r.name`,
    { tenantId, planId }
  );
  return (r.recordset || []).map(mapPlanRouteRow);
}

export async function getDailyPlanWithRoutes(query, tenantId, planDateInput) {
  const planDate = parsePlanDate(planDateInput);
  const r = await query(
    `SELECT * FROM logistics_daily_plan WHERE tenant_id = @tenantId AND plan_date = @planDate`,
    { tenantId, planDate }
  );
  const plan = r.recordset?.[0] ? mapPlanRow(r.recordset[0]) : null;
  if (!plan) return { plan: null, routes: [] };
  const routes = await listPlanRoutes(query, tenantId, plan.id);
  return { plan, routes };
}

export async function getPublishedPlan(query, tenantId, planDateInput) {
  const planDate = parsePlanDate(planDateInput);
  const r = await query(
    `SELECT * FROM logistics_daily_plan
     WHERE tenant_id = @tenantId AND plan_date = @planDate AND status = N'published'`,
    { tenantId, planDate }
  );
  const plan = r.recordset?.[0] ? mapPlanRow(r.recordset[0]) : null;
  if (!plan) return null;
  const routes = (await listPlanRoutes(query, tenantId, plan.id)).filter((x) => x.enabled && !x.is_plan_b);
  return { ...plan, routes };
}

async function loadRouteIntelligence(query, tenantId, weights = DEFAULT_WEIGHTS) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromIso = fromDate.toISOString();

  const [routesR, histR, timingR, deviationsR, slipR] = await Promise.all([
    query(
      `SELECT r.id, r.name, r.loading_address, r.destination_address,
              COALESCE(reg.distance_km, r.distance_km) AS distance_km,
              reg.rate_per_ton, reg.revenue_target, reg.avg_payload_tons,
              reg.fuel_litres_per_100km, reg.fuel_price_per_litre,
              reg.driver_cost_per_trip, reg.maintenance_cost_per_km, reg.toll_cost_per_trip,
              reg.other_cost_per_trip, reg.target_loads_per_day
       FROM contractor_routes r
       LEFT JOIN access_route_target_regulations reg ON reg.route_id = r.id AND reg.tenant_id = r.tenant_id
       WHERE r.tenant_id = @tenantId
       ORDER BY r.[order], r.name`,
      { tenantId }
    ),
    query(
      `SELECT d.contractor_route_id,
              COUNT(*) AS completed_loads,
              SUM(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL THEN 1 ELSE 0 END) AS slip_verified_loads,
              SUM(CASE WHEN ld.loading_slip_deferred = 1 OR t.loading_slip_deferred = 1 THEN 1 ELSE 0 END) AS deferred_slips,
              AVG(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
                THEN COALESCE(d.margin_amount, COALESCE(d.revenue_amount,0) - COALESCE(d.fuel_cost,0)) END) AS avg_margin,
              AVG(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
                THEN d.revenue_amount END) AS avg_revenue,
              AVG(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
                THEN d.fuel_cost END) AS avg_fuel_cost,
              AVG(CASE WHEN COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
                THEN d.tons_loaded END) AS avg_tons,
              AVG(d.distance_km) AS avg_distance_km
       FROM tracking_delivery_record d
       INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
       LEFT JOIN tracking_delivery_record ld ON ld.trip_id = d.trip_id AND ld.tenant_id = d.tenant_id
         AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         AND d.delivered_at >= @from
         AND d.contractor_route_id IS NOT NULL
       GROUP BY d.contractor_route_id`,
      { tenantId, from: fromIso }
    ),
    query(
      `SELECT contractor_route_id,
              AVG(CASE WHEN at_loading_at IS NOT NULL AND started_at IS NOT NULL
                THEN DATEDIFF(minute, at_loading_at, started_at) END) AS avg_queue_minutes,
              AVG(CASE WHEN started_at IS NOT NULL AND at_destination_at IS NOT NULL
                THEN DATEDIFF(minute, started_at, at_destination_at) END) AS avg_travel_minutes
       FROM fleet_trip
       WHERE tenant_id = @tenantId AND contractor_route_id IS NOT NULL
         AND scheduled_at >= @from
       GROUP BY contractor_route_id`,
      { tenantId, from: fromIso }
    ),
    query(
      `SELECT actual_route_id, COUNT(*) AS deviation_count
       FROM logistics_schedule_deviation
       WHERE tenant_id = @tenantId AND created_at >= @from
       GROUP BY actual_route_id`,
      { tenantId, from: fromIso }
    ),
    query(
      `SELECT d.contractor_route_id,
              AVG(CASE WHEN ld.delivered_at IS NOT NULL AND t.at_loading_at IS NOT NULL
                THEN DATEDIFF(minute, t.at_loading_at, ld.delivered_at) END) AS avg_slip_capture_minutes
       FROM tracking_delivery_record d
       INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
       INNER JOIN tracking_delivery_record ld ON ld.trip_id = d.trip_id AND ld.tenant_id = d.tenant_id
         AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         AND d.delivered_at >= @from
         AND COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL
       GROUP BY d.contractor_route_id`,
      { tenantId, from: fromIso }
    ),
  ]);

  const histMap = new Map((histR.recordset || []).map((row) => [gid(get(row, 'contractor_route_id')), row]));
  const timingMap = new Map((timingR.recordset || []).map((row) => [gid(get(row, 'contractor_route_id')), row]));
  const devMap = new Map((deviationsR.recordset || []).map((row) => [gid(get(row, 'actual_route_id')), row]));
  const slipMap = new Map((slipR.recordset || []).map((row) => [gid(get(row, 'contractor_route_id')), row]));

  const routes = (routesR.recordset || []).map((row) => {
    const id = gid(get(row, 'id'));
    const hist = histMap.get(id);
    const timing = timingMap.get(id);
    const dev = devMap.get(id);
    const slipTiming = slipMap.get(id);
    const completedLoads = Number(get(hist, 'completed_loads')) || 0;
    const slipVerified = Number(get(hist, 'slip_verified_loads')) || 0;
    const slipCaptureRate = completedLoads > 0 ? round2((slipVerified / completedLoads) * 100) : null;
    const distanceKm = Number(get(row, 'distance_km')) || 0;
    const ratePerTon = Number(get(row, 'rate_per_ton')) || 0;
    const payloadTons = Number(get(row, 'avg_payload_tons')) || Number(get(hist, 'avg_tons')) || 34;
    const lPer100 = Number(get(row, 'fuel_litres_per_100km')) || 42;
    const fuelPrice = Number(get(row, 'fuel_price_per_litre')) || 22;
    const fuelCostEst = distanceKm > 0 ? round2((distanceKm / 100) * lPer100 * fuelPrice) : null;
    const revenueEst = ratePerTon > 0 ? round2(ratePerTon * payloadTons) : (Number(get(hist, 'avg_revenue')) || null);
    const otherCosts = (Number(get(row, 'driver_cost_per_trip')) || 0)
      + (Number(get(row, 'toll_cost_per_trip')) || 0)
      + (Number(get(row, 'other_cost_per_trip')) || 0)
      + (Number(get(row, 'maintenance_cost_per_km')) || 0) * distanceKm;
    const marginEst = revenueEst != null && fuelCostEst != null
      ? round2(revenueEst - fuelCostEst - otherCosts)
      : (Number(get(hist, 'avg_margin')) || null);

    return {
      contractor_route_id: id,
      route_name: get(row, 'name'),
      loading_address: get(row, 'loading_address'),
      destination_address: get(row, 'destination_address'),
      distance_km: distanceKm || null,
      target_loads_per_day: Number(get(row, 'target_loads_per_day')) || null,
      avg_payload_tons: payloadTons,
      completed_loads_30d: slipVerified,
      total_completed_30d: completedLoads,
      slip_verified_loads_30d: slipVerified,
      slip_capture_rate: slipCaptureRate,
      deferred_slips_30d: Number(get(hist, 'deferred_slips')) || 0,
      avg_slip_capture_minutes: get(slipTiming, 'avg_slip_capture_minutes') != null
        ? round2(get(slipTiming, 'avg_slip_capture_minutes')) : null,
      avg_margin_30d: get(hist, 'avg_margin') != null ? round2(get(hist, 'avg_margin')) : null,
      avg_revenue_30d: get(hist, 'avg_revenue') != null ? round2(get(hist, 'avg_revenue')) : null,
      avg_queue_minutes: get(timing, 'avg_queue_minutes') != null ? round2(get(timing, 'avg_queue_minutes')) : null,
      avg_travel_minutes: get(timing, 'avg_travel_minutes') != null ? round2(get(timing, 'avg_travel_minutes')) : null,
      deviation_count_30d: Number(get(dev, 'deviation_count')) || 0,
      estimated_revenue: revenueEst,
      estimated_margin: marginEst,
      estimated_fuel_cost: fuelCostEst,
    };
  });

  const margins = routes.map((r) => r.estimated_margin).filter((v) => v != null && Number.isFinite(v));
  const fleetAvgMargin = margins.length
    ? round2(margins.reduce((a, b) => a + b, 0) / margins.length)
    : 0;

  return { routes, fleetAvgMargin, weights };
}

function buildDecisionTree(route, fleetAvgMargin) {
  const nodes = [];
  const margin = route.estimated_margin;
  const marginDelta = margin != null ? round2(margin - fleetAvgMargin) : null;

  nodes.push({
    id: 'loading_slip',
    label: 'Loading slip compliance',
    outcome: route.slip_capture_rate == null ? 'unknown'
      : (route.slip_capture_rate >= 95 ? 'excellent' : route.slip_capture_rate >= 80 ? 'acceptable' : 'poor'),
    detail: route.slip_capture_rate != null
      ? `${route.slip_verified_loads_30d}/${route.total_completed_30d} loads slip-verified (${route.slip_capture_rate}%) — margins based on verified slips only`
      : 'No completed loads — capture loading slips for reliable advise',
  });

  nodes.push({
    id: 'profitability',
    label: 'Profitability',
    outcome: margin == null ? 'unknown' : (marginDelta >= 0 ? 'above_average' : 'below_average'),
    detail: margin != null
      ? `Est. margin R ${margin.toLocaleString('en-ZA')} (${marginDelta >= 0 ? '+' : ''}${marginDelta ?? 0} vs fleet avg)`
      : 'Insufficient history — using route regulations only',
  });

  const queue = route.avg_queue_minutes;
  nodes.push({
    id: 'queuing',
    label: 'Loading queue',
    outcome: queue == null ? 'unknown' : (queue > 90 ? 'high' : queue > 45 ? 'medium' : 'low'),
    detail: queue != null ? `Avg ${Math.round(queue)} min at loading (30d)` : 'No queue data yet',
  });

  const travel = route.avg_travel_minutes;
  nodes.push({
    id: 'travel',
    label: 'Travel time',
    outcome: travel == null ? 'unknown' : (travel > 240 ? 'slow' : travel > 150 ? 'moderate' : 'efficient'),
    detail: travel != null ? `Avg ${Math.round(travel)} min en route (30d)` : 'No travel time data yet',
  });

  nodes.push({
    id: 'reliability',
    label: 'Plan adherence',
    outcome: route.deviation_count_30d > 3 ? 'unstable' : route.deviation_count_30d > 0 ? 'some_deviations' : 'stable',
    detail: `${route.deviation_count_30d} off-plan schedules in 30d · ${route.completed_loads_30d} completed loads`,
  });

  const targetLoads = route.target_loads_per_day;
  const actualLoads = route.completed_loads_30d;
  const missed = targetLoads && actualLoads < targetLoads * 20;
  nodes.push({
    id: 'targets',
    label: 'Target achievement',
    outcome: missed ? 'missed' : (route.completed_loads_30d > 0 ? 'on_track' : 'no_data'),
    detail: targetLoads
      ? `Target ~${targetLoads} loads/day · ${route.completed_loads_30d} loads in 30d`
      : `${route.completed_loads_30d} completed loads in 30d`,
  });

  return nodes;
}

function scoreRoute(route, fleetAvgMargin, weights = DEFAULT_WEIGHTS) {
  let score = 50;
  const wMargin = weights.weight_margin || 1;
  const wQueue = weights.weight_queue || 1;
  const wTravel = weights.weight_travel || 1;
  const wDev = weights.weight_deviation || 1;
  const wSlip = weights.weight_slip || 1.2;
  const wTargets = weights.weight_targets || 1;

  const margin = route.estimated_margin;
  if (margin != null && fleetAvgMargin) {
    score += Math.max(-25, Math.min(25, ((margin - fleetAvgMargin) / Math.max(fleetAvgMargin, 1)) * 40)) * wMargin;
  } else if (margin != null && margin > 0) {
    score += 10 * wMargin;
  }

  if (route.completed_loads_30d >= 10) score += 10 * wTargets;
  else if (route.completed_loads_30d >= 3) score += 5 * wTargets;
  else if (route.completed_loads_30d === 0) score -= 8 * wTargets;

  if (route.slip_capture_rate != null) {
    if (route.slip_capture_rate >= 95) score += 8 * wSlip;
    else if (route.slip_capture_rate >= 80) score += 2 * wSlip;
    else if (route.slip_capture_rate < 60) score -= 18 * wSlip;
    else score -= 10 * wSlip;
  }
  if (route.deferred_slips_30d > 2) score -= 6 * wSlip;
  if (route.avg_slip_capture_minutes != null && route.avg_slip_capture_minutes > 120) {
    score -= 5 * wSlip;
  }

  if (route.avg_queue_minutes != null) {
    if (route.avg_queue_minutes > 90) score -= 12 * wQueue;
    else if (route.avg_queue_minutes > 45) score -= 6 * wQueue;
    else score += 4 * wQueue;
  }

  if (route.avg_travel_minutes != null) {
    if (route.avg_travel_minutes > 240) score -= 10 * wTravel;
    else if (route.avg_travel_minutes > 150) score -= 4 * wTravel;
    else score += 4 * wTravel;
  }

  if (route.deviation_count_30d > 3) score -= 15 * wDev;
  else if (route.deviation_count_30d > 0) score -= 5 * wDev;

  return Math.max(0, Math.min(100, round2(score)));
}

function buildAdviceText(route, score, fleetAvgMargin) {
  const parts = [];
  if (route.slip_capture_rate != null && route.slip_capture_rate < 85) {
    parts.push(`Low loading slip capture (${route.slip_capture_rate}%) — enforce slip scan before en route; advise uses slip-verified loads only`);
  } else if (route.slip_capture_rate != null && route.slip_capture_rate >= 95) {
    parts.push(`Strong slip compliance (${route.slip_capture_rate}%) — reliable margin data`);
  }
  if (route.estimated_margin != null) {
    parts.push(`Expected margin ~R ${route.estimated_margin.toLocaleString('en-ZA')} per load`);
  }
  if (route.avg_queue_minutes != null && route.avg_queue_minutes > 60) {
    parts.push(`High loading queue (~${Math.round(route.avg_queue_minutes)} min) — stagger departures or pre-call loading site`);
  }
  if (route.avg_travel_minutes != null && route.avg_travel_minutes > 180) {
    parts.push(`Long travel leg (~${Math.round(route.avg_travel_minutes)} min) — watch overdue risk and driver hours`);
  }
  if (route.deviation_count_30d > 2) {
    parts.push(`Frequent off-plan scheduling (${route.deviation_count_30d}×) — review why operators avoid this route`);
  }
  if (score >= 75) parts.push('Recommend as primary route for today');
  else if (score >= 55) parts.push('Viable with monitoring — use as secondary priority');
  else parts.push('Use only if higher-priority routes are saturated');
  if (route.estimated_margin != null && fleetAvgMargin && route.estimated_margin < fleetAvgMargin) {
    parts.push(`Below fleet average margin (avg R ${fleetAvgMargin.toLocaleString('en-ZA')})`);
  }
  return parts.join('. ');
}

function buildRiskMitigation(route, riskLevel) {
  const items = [];
  if (riskLevel === 'high') {
    items.push('Assign experienced driver and confirm loading slot before dispatch');
    items.push('Prepare Plan B route if loading queue exceeds 90 minutes');
  } else if (riskLevel === 'medium') {
    items.push('Monitor GPS queue at loading geofence before committing extra trucks');
  } else {
    items.push('Standard monitoring — capture slips and track against target loads');
  }
  if (route.avg_travel_minutes > 180) {
    items.push('Set ETA alerts and corridor deviation watch on Tracking Management');
  }
  return items.join('\n');
}

export async function buildSystemAdvise(query, tenantId, planDateInput) {
  await refreshLearningWeights(query, tenantId).catch(() => null);
  const settings = await getPlannerSettings(query, tenantId);
  const weights = settings;
  const { routes, fleetAvgMargin } = await loadRouteIntelligence(query, tenantId, weights);
  const scored = routes.map((route) => {
    const score = scoreRoute(route, fleetAvgMargin, weights);
    const marginDelta = route.estimated_margin != null ? round2(route.estimated_margin - fleetAvgMargin) : 0;
    const risk_level = riskFromScore(score, marginDelta);
    const decision_tree = buildDecisionTree(route, fleetAvgMargin);
    return {
      ...route,
      system_score: score,
      risk_level,
      decision_tree,
      system_advice: buildAdviceText(route, score, fleetAvgMargin),
      risk_mitigation: buildRiskMitigation(route, risk_level),
      execution_reason: score >= 70
        ? 'High profitability and acceptable queue/travel profile'
        : score >= 50
          ? 'Balanced route — fill capacity after top priorities'
          : 'Contingency / Plan B only unless primary routes saturated',
    };
  }).sort((a, b) => b.system_score - a.system_score);

  const primary = scored.filter((r) => !r.is_plan_b && r.system_score >= 55);
  const planB = scored.filter((r) => r.system_score < 55 || r.risk_level === 'high');

  const destGroups = new Map();
  for (const r of scored) {
    const key = String(r.destination_address || r.route_name || '').toLowerCase();
    if (!destGroups.has(key)) destGroups.set(key, []);
    destGroups.get(key).push(r);
  }
  for (const r of scored) {
    const key = String(r.destination_address || r.route_name || '').toLowerCase();
    const alts = (destGroups.get(key) || []).filter((x) => x.contractor_route_id !== r.contractor_route_id);
    r.plan_b_route_id = alts[0]?.contractor_route_id || null;
    r.plan_b_route_name = alts[0]?.route_name || null;
  }

  return {
    plan_date: parsePlanDate(planDateInput),
    fleet_avg_margin: fleetAvgMargin,
    routes_analyzed: scored.length,
    recommendations: scored.map((r, idx) => ({
      contractor_route_id: r.contractor_route_id,
      route_name: r.route_name,
      priority_rank: idx + 1,
      is_plan_b: r.system_score < 55,
      plan_b_route_id: r.plan_b_route_id,
      plan_b_route_name: r.plan_b_route_name,
      expected_loads: r.target_loads_per_day || Math.max(1, Math.round(r.completed_loads_30d / 22)),
      expected_tons: r.avg_payload_tons || 34,
      expected_revenue: r.estimated_revenue,
      expected_margin: r.estimated_margin,
      risk_level: r.risk_level,
      risk_mitigation: r.risk_mitigation,
      execution_reason: r.execution_reason,
      system_score: r.system_score,
      system_advice: r.system_advice,
      decision_tree: r.decision_tree,
      enabled: r.system_score >= 45,
    })),
    summary: {
      primary_count: primary.length,
      plan_b_count: planB.length,
      top_route: scored[0]?.route_name || null,
      learning_note: settings.learning_note || 'Advise uses slip-verified loads, 30-day margins, queue/travel times, off-plan deviations, and route regulations.',
      learning_weights: {
        weight_margin: settings.weight_margin,
        weight_queue: settings.weight_queue,
        weight_travel: settings.weight_travel,
        weight_deviation: settings.weight_deviation,
        weight_slip: settings.weight_slip,
        weight_targets: settings.weight_targets,
      },
      slip_dependency: 'Only loads with captured loading slips count toward profitability and target achievement.',
    },
  };
}

export async function applyAdviseToPlan(query, tenantId, planDateInput, userId) {
  const advise = await buildSystemAdvise(query, tenantId, planDateInput);
  const plan = await getOrCreateDailyPlan(query, tenantId, advise.plan_date, { userId, source: 'system_advise' });
  await savePlanRoutes(query, tenantId, plan.id, advise.recommendations.map((r) => ({
    ...r,
    enabled: r.enabled !== false,
  })));
  await query(
    `UPDATE logistics_daily_plan SET status = N'advised', source = N'system_advise', updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    { id: plan.id, tenantId }
  );
  return getDailyPlanWithRoutes(query, tenantId, advise.plan_date);
}

export async function savePlanRoutes(query, tenantId, planId, routes = []) {
  await query(
    `DELETE FROM logistics_plan_route WHERE tenant_id = @tenantId AND plan_id = @planId`,
    { tenantId, planId }
  );
  for (const r of routes) {
    if (!r.contractor_route_id) continue;
    await query(
      `INSERT INTO logistics_plan_route (
        plan_id, tenant_id, contractor_route_id, priority_rank, is_plan_b, plan_b_route_id,
        expected_loads, expected_tons, expected_revenue, expected_margin,
        risk_level, risk_mitigation, execution_reason, system_score, system_advice, enabled
      ) VALUES (
        @planId, @tenantId, @rid, @rank, @planB, @planBRid,
        @loads, @tons, @rev, @margin,
        @risk, @mitigation, @reason, @score, @advice, @enabled
      )`,
      {
        tenantId,
        planId,
        rid: gid(r.contractor_route_id),
        rank: Number(r.priority_rank) || 1,
        planB: r.is_plan_b ? 1 : 0,
        planBRid: r.plan_b_route_id ? gid(r.plan_b_route_id) : null,
        loads: r.expected_loads != null ? Number(r.expected_loads) : null,
        tons: r.expected_tons != null ? Number(r.expected_tons) : null,
        rev: r.expected_revenue != null ? Number(r.expected_revenue) : null,
        margin: r.expected_margin != null ? Number(r.expected_margin) : null,
        risk: r.risk_level || null,
        mitigation: r.risk_mitigation || null,
        reason: r.execution_reason || null,
        score: r.system_score != null ? Number(r.system_score) : null,
        advice: r.system_advice || null,
        enabled: r.enabled === false ? 0 : 1,
      }
    );
  }
}

export async function acceptAndPublishPlan(query, tenantId, planId, userId, { execution_notes, publishedByName } = {}) {
  const now = new Date();
  await query(
    `UPDATE logistics_daily_plan SET
      status = N'published',
      accepted_at = @now,
      published_at = @now,
      execution_notes = COALESCE(@notes, execution_notes),
      updated_at = SYSUTCDATETIME()
     WHERE id = @id AND tenant_id = @tenantId`,
    {
      tenantId,
      id: planId,
      now,
      notes: execution_notes != null ? String(execution_notes).trim() : null,
    }
  );
  const planR = await query(
    `SELECT * FROM logistics_daily_plan WHERE id = @id AND tenant_id = @tenantId`,
    { id: planId, tenantId }
  );
  const plan = mapPlanRow(planR.recordset[0]);
  const routes = await listPlanRoutes(query, tenantId, planId);
  sendPlanPublishedEmail({
    query,
    tenantId,
    plan,
    routes,
    publishedBy: publishedByName || null,
  }).catch(() => null);
  return { plan, routes };
}

export async function validateScheduleAgainstPlan(query, tenantId, contractorRouteId, planDateInput) {
  const published = await getPublishedPlan(query, tenantId, planDateInput);
  if (!published?.routes?.length) {
    return { has_plan: false, in_plan: true, requires_justification: false, plan: null };
  }
  const rid = gid(contractorRouteId);
  const plannedIds = new Set(published.routes.map((r) => r.contractor_route_id));
  const planBIds = new Set(
    published.routes.map((r) => r.plan_b_route_id).filter(Boolean)
  );
  const inPlan = plannedIds.has(rid) || planBIds.has(rid);
  const matched = published.routes.find((r) => r.contractor_route_id === rid)
    || published.routes.find((r) => r.plan_b_route_id === rid);
  return {
    has_plan: true,
    in_plan: inPlan,
    requires_justification: !inPlan,
    plan: published,
    matched_route: matched || null,
  };
}

export async function recordScheduleDeviation(query, tenantId, {
  plan_id,
  trip_id,
  truck_registration,
  planned_route_id,
  actual_route_id,
  justification,
  user_id,
}) {
  const just = String(justification || '').trim();
  if (!just) throw Object.assign(new Error('Justification is required when scheduling off-plan'), { status: 400 });
  await query(
    `INSERT INTO logistics_schedule_deviation (
      tenant_id, plan_id, trip_id, truck_registration, planned_route_id, actual_route_id, justification, created_by_user_id
    ) VALUES (
      @tenantId, @planId, @tripId, @reg, @plannedId, @actualId, @just, @userId
    )`,
    {
      tenantId,
      planId: plan_id ? gid(plan_id) : null,
      tripId: trip_id ? gid(trip_id) : null,
      reg: String(truck_registration || '').trim(),
      plannedId: planned_route_id ? gid(planned_route_id) : null,
      actualId: gid(actual_route_id),
      just,
      userId: user_id || null,
    }
  );
}

export async function getPlanManagementOverview(query, tenantId, { from, to, route_id } = {}) {
  const params = { tenantId };
  let dateFilter = '';
  if (from) {
    dateFilter += ` AND d.delivered_at >= @from`;
    params.from = from;
  }
  if (to) {
    dateFilter += ` AND d.delivered_at < DATEADD(day, 1, CAST(@to AS DATE))`;
    params.to = to;
  }
  let routeFilter = '';
  if (route_id) {
    routeFilter = ` AND d.contractor_route_id = @routeId`;
    params.routeId = gid(route_id);
  }

  const slipVerifiedJoin = `
    INNER JOIN fleet_trip t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
    LEFT JOIN tracking_delivery_record ld ON ld.trip_id = d.trip_id AND ld.tenant_id = d.tenant_id
      AND ld.activity_phase = N'loading' AND ld.deleted_at IS NULL`;

  const slipVerifiedCond = `COALESCE(NULLIF(LTRIM(RTRIM(ld.loading_slip_no)), N''), NULLIF(LTRIM(RTRIM(t.loading_slip_no)), N'')) IS NOT NULL`;

  const [dailyR, routeR, deviationR, planPerfR, planVsActualR, slipKpiR, settings] = await Promise.all([
    query(
      `SELECT CAST(d.delivered_at AS DATE) AS day,
              COUNT(*) AS loads,
              SUM(CASE WHEN ${slipVerifiedCond} THEN 1 ELSE 0 END) AS slip_verified_loads,
              SUM(COALESCE(d.revenue_amount, 0)) AS revenue,
              SUM(COALESCE(d.fuel_cost, 0) + CASE WHEN d.include_return_fuel_in_cost = 1 THEN COALESCE(d.return_fuel_cost, 0) ELSE 0 END) AS total_cost,
              SUM(COALESCE(d.margin_amount, COALESCE(d.revenue_amount,0) - COALESCE(d.fuel_cost,0))) AS margin,
              SUM(COALESCE(d.tons_loaded, 0)) AS tons
       FROM tracking_delivery_record d
       ${slipVerifiedJoin}
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         ${dateFilter} ${routeFilter}
       GROUP BY CAST(d.delivered_at AS DATE)
       ORDER BY day`,
      params
    ),
    query(
      `SELECT d.contractor_route_id, r.name AS route_name,
              COUNT(*) AS loads,
              SUM(CASE WHEN ${slipVerifiedCond} THEN 1 ELSE 0 END) AS slip_verified_loads,
              SUM(COALESCE(d.revenue_amount, 0)) AS revenue,
              SUM(COALESCE(d.fuel_cost, 0) + CASE WHEN d.include_return_fuel_in_cost = 1 THEN COALESCE(d.return_fuel_cost, 0) ELSE 0 END) AS total_cost,
              SUM(COALESCE(d.margin_amount, COALESCE(d.revenue_amount,0) - COALESCE(d.fuel_cost,0))) AS margin,
              AVG(d.distance_km) AS avg_distance_km
       FROM tracking_delivery_record d
       ${slipVerifiedJoin}
       LEFT JOIN contractor_routes r ON r.id = d.contractor_route_id AND r.tenant_id = d.tenant_id
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         ${dateFilter} ${routeFilter}
       GROUP BY d.contractor_route_id, r.name
       ORDER BY margin DESC`,
      params
    ),
    query(
      `SELECT CAST(created_at AS DATE) AS day, COUNT(*) AS deviations
       FROM logistics_schedule_deviation
       WHERE tenant_id = @tenantId
         ${from ? ' AND created_at >= @from' : ''}
         ${to ? ' AND created_at < DATEADD(day, 1, CAST(@to AS DATE))' : ''}
       GROUP BY CAST(created_at AS DATE)
       ORDER BY day`,
      params
    ),
    query(
      `SELECT p.plan_date, p.status,
              COUNT(pr.id) AS planned_routes,
              SUM(COALESCE(pr.expected_loads, 0)) AS expected_loads,
              SUM(COALESCE(pr.expected_revenue, 0)) AS expected_revenue
       FROM logistics_daily_plan p
       LEFT JOIN logistics_plan_route pr ON pr.plan_id = p.id AND pr.tenant_id = p.tenant_id AND pr.enabled = 1 AND pr.is_plan_b = 0
       WHERE p.tenant_id = @tenantId
         ${from ? ' AND p.plan_date >= CAST(@from AS DATE)' : ''}
         ${to ? ' AND p.plan_date <= CAST(@to AS DATE)' : ''}
       GROUP BY p.plan_date, p.status
       ORDER BY p.plan_date DESC`,
      params
    ),
    query(
      `SELECT p.plan_date, pr.contractor_route_id, r.name AS route_name,
              pr.expected_loads, pr.expected_revenue, pr.expected_margin,
              COALESCE(actual.loads, 0) AS actual_loads,
              COALESCE(actual.revenue, 0) AS actual_revenue,
              COALESCE(actual.margin, 0) AS actual_margin,
              COALESCE(actual.slip_verified, 0) AS slip_verified_loads
       FROM logistics_daily_plan p
       INNER JOIN logistics_plan_route pr ON pr.plan_id = p.id AND pr.tenant_id = p.tenant_id
         AND pr.enabled = 1 AND pr.is_plan_b = 0
       LEFT JOIN contractor_routes r ON r.id = pr.contractor_route_id AND r.tenant_id = pr.tenant_id
       OUTER APPLY (
         SELECT COUNT(*) AS loads,
                SUM(COALESCE(d.revenue_amount, 0)) AS revenue,
                SUM(COALESCE(d.margin_amount, COALESCE(d.revenue_amount,0) - COALESCE(d.fuel_cost,0))) AS margin,
                SUM(CASE WHEN ${slipVerifiedCond} THEN 1 ELSE 0 END) AS slip_verified
         FROM tracking_delivery_record d
         ${slipVerifiedJoin}
         WHERE d.tenant_id = p.tenant_id AND d.deleted_at IS NULL
           AND d.activity_phase = N'destination' AND d.status = N'completed'
           AND d.contractor_route_id = pr.contractor_route_id
           AND CAST(d.delivered_at AS DATE) = p.plan_date
       ) actual
       WHERE p.tenant_id = @tenantId AND p.status = N'published'
         ${from ? ' AND p.plan_date >= CAST(@from AS DATE)' : ''}
         ${to ? ' AND p.plan_date <= CAST(@to AS DATE)' : ''}
         ${route_id ? ' AND pr.contractor_route_id = @routeId' : ''}
       ORDER BY p.plan_date DESC, pr.priority_rank`,
      params
    ),
    query(
      `SELECT COUNT(*) AS total_completed,
              SUM(CASE WHEN ${slipVerifiedCond} THEN 1 ELSE 0 END) AS slip_verified,
              SUM(CASE WHEN ld.loading_slip_deferred = 1 OR t.loading_slip_deferred = 1 THEN 1 ELSE 0 END) AS deferred_slips,
              SUM(CASE WHEN ${slipVerifiedCond} = 0 THEN 1 ELSE 0 END) AS missing_slips
       FROM tracking_delivery_record d
       ${slipVerifiedJoin}
       WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
         AND d.activity_phase = N'destination' AND d.status = N'completed'
         ${dateFilter} ${routeFilter}`,
      params
    ),
    refreshLearningWeights(query, tenantId).catch(() => getPlannerSettings(query, tenantId)),
  ]);

  const daily = (dailyR.recordset || []).map((row) => ({
    date: get(row, 'day'),
    loads: Number(get(row, 'loads')) || 0,
    slip_verified_loads: Number(get(row, 'slip_verified_loads')) || 0,
    revenue: round2(get(row, 'revenue')),
    total_cost: round2(get(row, 'total_cost')),
    margin: round2(get(row, 'margin')),
    tons: round2(get(row, 'tons')),
  }));

  const totals = daily.reduce((acc, d) => ({
    loads: acc.loads + d.loads,
    revenue: acc.revenue + (d.revenue || 0),
    total_cost: acc.total_cost + (d.total_cost || 0),
    margin: acc.margin + (d.margin || 0),
    tons: acc.tons + (d.tons || 0),
  }), { loads: 0, revenue: 0, total_cost: 0, margin: 0, tons: 0 });

  return {
    daily_trends: daily,
    route_performance: (routeR.recordset || []).map((row) => ({
      contractor_route_id: gid(get(row, 'contractor_route_id')),
      route_name: get(row, 'route_name'),
      loads: Number(get(row, 'loads')) || 0,
      slip_verified_loads: Number(get(row, 'slip_verified_loads')) || 0,
      slip_capture_rate: (Number(get(row, 'loads')) || 0) > 0
        ? round2((Number(get(row, 'slip_verified_loads')) / Number(get(row, 'loads'))) * 100) : null,
      revenue: round2(get(row, 'revenue')),
      total_cost: round2(get(row, 'total_cost')),
      margin: round2(get(row, 'margin')),
      avg_distance_km: get(row, 'avg_distance_km') != null ? round2(get(row, 'avg_distance_km')) : null,
    })),
    deviation_trends: (deviationR.recordset || []).map((row) => ({
      date: get(row, 'day'),
      deviations: Number(get(row, 'deviations')) || 0,
    })),
    plan_history: (planPerfR.recordset || []).map((row) => ({
      plan_date: get(row, 'plan_date'),
      status: get(row, 'status'),
      planned_routes: Number(get(row, 'planned_routes')) || 0,
      expected_loads: Number(get(row, 'expected_loads')) || 0,
      expected_revenue: round2(get(row, 'expected_revenue')),
    })),
    plan_vs_actual: (planVsActualR.recordset || []).map((row) => {
      const expectedLoads = Number(get(row, 'expected_loads')) || 0;
      const actualLoads = Number(get(row, 'actual_loads')) || 0;
      const expectedRev = Number(get(row, 'expected_revenue')) || 0;
      const actualRev = Number(get(row, 'actual_revenue')) || 0;
      const expectedMargin = Number(get(row, 'expected_margin')) || 0;
      const actualMargin = Number(get(row, 'actual_margin')) || 0;
      return {
        plan_date: get(row, 'plan_date'),
        contractor_route_id: gid(get(row, 'contractor_route_id')),
        route_name: get(row, 'route_name'),
        expected_loads: expectedLoads,
        actual_loads: actualLoads,
        slip_verified_loads: Number(get(row, 'slip_verified_loads')) || 0,
        load_variance: expectedLoads > 0 ? round2(((actualLoads - expectedLoads) / expectedLoads) * 100) : null,
        expected_revenue: round2(expectedRev),
        actual_revenue: round2(actualRev),
        expected_margin: round2(expectedMargin),
        actual_margin: round2(actualMargin),
        loads_met: expectedLoads > 0 ? actualLoads >= expectedLoads : null,
      };
    }),
    slip_kpis: (() => {
      const s = slipKpiR.recordset?.[0] || {};
      const total = Number(get(s, 'total_completed')) || 0;
      const verified = Number(get(s, 'slip_verified')) || 0;
      return {
        total_completed_loads: total,
        slip_verified_loads: verified,
        missing_slips: Number(get(s, 'missing_slips')) || 0,
        deferred_slips: Number(get(s, 'deferred_slips')) || 0,
        slip_capture_rate: total > 0 ? round2((verified / total) * 100) : null,
      };
    })(),
    learning: settings || DEFAULT_WEIGHTS,
    totals: {
      loads: totals.loads,
      revenue: round2(totals.revenue),
      total_cost: round2(totals.total_cost),
      margin: round2(totals.margin),
      tons: round2(totals.tons),
    },
  };
}
