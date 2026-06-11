/** Client-side route economics (mirrors server src/lib/routeEconomics.js). */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `R ${round2(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function computeRouteEconomics(input = {}) {
  const distanceKm = num(input.distance_km);
  const ratePerTon = num(input.rate_per_ton);
  const avgPayload = num(input.avg_payload_tons) || num(input.min_tons) || num(input.max_tons) || 36;
  const deliveriesPerTruck = num(input.deliveries_per_truck_target);
  const enrolledTrucks = Math.max(1, num(input.enrolled_trucks) || 1);
  const revenueTarget = num(input.revenue_target);
  const targetPeriodDays = Math.max(1, num(input.target_period_days) || 30);

  const fuelL100 = num(input.fuel_litres_per_100km) || 42;
  const fuelPrice = num(input.fuel_price_per_litre);
  const driverCost = num(input.driver_cost_per_trip);
  const maintPerKm = num(input.maintenance_cost_per_km);
  const toll = num(input.toll_cost_per_trip);
  const other = num(input.other_cost_per_trip);
  const overheadPct = num(input.overhead_percent);

  const revenuePerTrip = round2(avgPayload * ratePerTon);
  const fuelCost = distanceKm > 0 ? round2((distanceKm * fuelL100 / 100) * fuelPrice) : 0;
  const maintenanceCost = round2(distanceKm * maintPerKm);
  const directCost = round2(fuelCost + driverCost + maintenanceCost + toll + other);
  const overheadCost = round2(directCost * (overheadPct / 100));
  const totalCostPerTrip = round2(directCost + overheadCost);
  const marginPerTrip = round2(revenuePerTrip - totalCostPerTrip);
  const marginPercent = revenuePerTrip > 0 ? round2((marginPerTrip / revenuePerTrip) * 100) : null;
  const costPerTon = avgPayload > 0 ? round2(totalCostPerTrip / avgPayload) : null;
  const breakEvenRatePerTon = avgPayload > 0 ? round2(totalCostPerTrip / avgPayload) : null;

  const totalTripsPeriod = round2(deliveriesPerTruck * enrolledTrucks);
  const projectedRevenuePeriod = round2(totalTripsPeriod * revenuePerTrip);
  const projectedCostPeriod = round2(totalTripsPeriod * totalCostPerTrip);
  const projectedMarginPeriod = round2(projectedRevenuePeriod - projectedCostPeriod);

  const revenueTargetGap = revenueTarget > 0 ? round2(revenueTarget - projectedRevenuePeriod) : null;
  const revenueTargetPct = revenueTarget > 0 ? round2((projectedRevenuePeriod / revenueTarget) * 100) : null;
  const tripsNeededForTarget = revenuePerTrip > 0 && revenueTarget > 0 ? Math.ceil(revenueTarget / revenuePerTrip) : null;
  const extraTripsNeeded = tripsNeededForTarget != null ? Math.max(0, tripsNeededForTarget - totalTripsPeriod) : null;
  const extraDeliveriesPerTruck = enrolledTrucks > 0 && extraTripsNeeded > 0 ? round2(extraTripsNeeded / enrolledTrucks) : 0;

  let health = 'unknown';
  if (ratePerTon > 0 && totalCostPerTrip > 0) {
    if (marginPercent == null) health = 'unknown';
    else if (marginPercent < 5) health = 'critical';
    else if (marginPercent < 12) health = 'warning';
    else if (revenueTarget > 0 && projectedRevenuePeriod < revenueTarget * 0.9) health = 'warning';
    else health = 'healthy';
  }

  const insights = [];
  const loading = input.loading_site || input.starting_point || 'Loading site';
  const dest = input.destination || 'Destination';

  if (!distanceKm) {
    insights.push({ level: 'info', text: 'Add corridor distance (km) to unlock per-trip fuel and maintenance costing.' });
  }
  if (ratePerTon > 0 && breakEvenRatePerTon > 0 && ratePerTon < breakEvenRatePerTon) {
    insights.push({
      level: 'critical',
      text: `Rate R${ratePerTon}/t is below break-even R${breakEvenRatePerTon}/t — each trip loses ${fmtMoney(Math.abs(marginPerTrip))}.`,
    });
  } else if (marginPercent != null && marginPercent >= 12) {
    insights.push({ level: 'ok', text: `Healthy margin of ${marginPercent}% per trip at current rate and costs.` });
  }
  if (revenueTarget > 0 && revenueTargetGap > 0) {
    insights.push({
      level: 'warning',
      text: `Projected revenue is ${fmtMoney(revenueTargetGap)} short of target — need ~${extraTripsNeeded} more trip(s) (~${extraDeliveriesPerTruck} per truck).`,
    });
  } else if (revenueTarget > 0 && revenueTargetGap <= 0) {
    insights.push({ level: 'ok', text: `Revenue target is on track (${revenueTargetPct}% of target with enrolled fleet).` });
  }
  if (deliveriesPerTruck > 0 && enrolledTrucks > 0) {
    insights.push({
      level: 'info',
      text: `${enrolledTrucks} truck(s) × ${deliveriesPerTruck} deliveries over ${targetPeriodDays} days → ${totalTripsPeriod} trips on ${loading} → ${dest}.`,
    });
  }

  return {
    corridor: { loading_site: loading, destination: dest, distance_km: distanceKm || null },
    per_trip: {
      revenue: revenuePerTrip,
      fuel_cost: fuelCost,
      driver_cost: driverCost,
      maintenance_cost: maintenanceCost,
      toll_cost: toll,
      other_cost: other,
      overhead_cost: overheadCost,
      total_cost: totalCostPerTrip,
      margin: marginPerTrip,
      margin_percent: marginPercent,
      cost_per_ton: costPerTon,
      break_even_rate_per_ton: breakEvenRatePerTon,
    },
    period: {
      days: targetPeriodDays,
      enrolled_trucks: enrolledTrucks,
      deliveries_per_truck: deliveriesPerTruck,
      total_trips: totalTripsPeriod,
      projected_revenue: projectedRevenuePeriod,
      projected_cost: projectedCostPeriod,
      projected_margin: projectedMarginPeriod,
      revenue_target: revenueTarget || null,
      revenue_target_gap: revenueTargetGap,
      revenue_target_pct: revenueTargetPct,
      trips_needed_for_target: tripsNeededForTarget,
      extra_trips_needed: extraTripsNeeded,
      extra_deliveries_per_truck: extraDeliveriesPerTruck,
    },
    health,
    insights,
    formatted: {
      revenue_per_trip: fmtMoney(revenuePerTrip),
      cost_per_trip: fmtMoney(totalCostPerTrip),
      margin_per_trip: fmtMoney(marginPerTrip),
      projected_revenue: fmtMoney(projectedRevenuePeriod),
      projected_cost: fmtMoney(projectedCostPeriod),
      projected_margin: fmtMoney(projectedMarginPeriod),
      revenue_target: revenueTarget > 0 ? fmtMoney(revenueTarget) : '—',
    },
  };
}

export function mapRegulationToEconomicsInput(reg, route, enrolledTrucks = 1) {
  return {
    ...reg,
    starting_point: reg?.starting_point ?? route?.starting_point,
    destination: reg?.destination ?? route?.destination,
    loading_site: reg?.starting_point ?? route?.starting_point,
    distance_km: reg?.distance_km ?? route?.distance_km,
    min_tons: route?.min_tons ?? route?.max_tons,
    max_tons: route?.min_tons ?? route?.max_tons,
    enrolled_trucks: enrolledTrucks,
  };
}

export const ROUTE_ECONOMICS_DEFAULTS = {
  avg_payload_tons: '34',
  fuel_litres_per_100km: '42',
  fuel_price_per_litre: '',
  driver_cost_per_trip: '',
  maintenance_cost_per_km: '',
  toll_cost_per_trip: '',
  other_cost_per_trip: '',
  overhead_percent: '8',
  target_period_days: '30',
};

export const ROUTE_ECONOMICS_FIELD_KEYS = [
  'deliveries_per_truck_target',
  'distance_km',
  'rate_per_ton',
  'revenue_target',
  'avg_payload_tons',
  'fuel_litres_per_100km',
  'fuel_price_per_litre',
  'driver_cost_per_trip',
  'maintenance_cost_per_km',
  'toll_cost_per_trip',
  'other_cost_per_trip',
  'overhead_percent',
  'target_period_days',
  'notes',
];
