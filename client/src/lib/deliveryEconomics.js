/** Shared delivery economics formatting and margin math (mirrors server mapDeliveryRow). */

export function round2(n) {
  if (n == null || n === '') return null;
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

export function round3(n) {
  if (n == null || n === '') return null;
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
}

export function includeReturnFuelInCost(delivery) {
  if (!delivery) return true;
  return delivery.include_return_fuel_in_cost !== false;
}

export function totalLogisticsFuelCost(delivery) {
  if (!delivery) return null;
  const fuelCost = delivery.fuel_cost != null ? Number(delivery.fuel_cost) : null;
  const returnFuelCost = delivery.return_fuel_cost != null ? Number(delivery.return_fuel_cost) : null;
  if (fuelCost == null) return null;
  const addReturn = includeReturnFuelInCost(delivery) && returnFuelCost != null;
  return round2(fuelCost + (addReturn ? returnFuelCost : 0));
}

export function deliveryMarginAmount(delivery) {
  if (!delivery) return null;
  const revenue = delivery.revenue_amount != null ? Number(delivery.revenue_amount) : null;
  const totalFuel = totalLogisticsFuelCost(delivery);
  if (revenue == null || totalFuel == null) return null;
  return round2(revenue - totalFuel);
}

export function economicsComplete(delivery) {
  if (!delivery) return false;
  return delivery.fuel_litres != null
    && delivery.fuel_cost != null
    && delivery.revenue_amount != null;
}

export function formatCurrency(value, { dash = '—' } = {}) {
  if (value == null || value === '') return dash;
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return `R ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatLitres(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
}

export function formatTons(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatKm(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export function calcSourceLabel(source) {
  const map = {
    gps_trail: 'GPS trail',
    corridor_polyline: 'Haul road corridor',
    monitor_route: 'Monitor route',
    route_distance: 'Route distance',
    regulation: 'Regulation default',
    gps_trail_return: 'GPS return',
    route_distance_return: 'Route return',
    none: 'Not available',
  };
  return map[source] || source || '—';
}

export function summarizeDeliveries(deliveries) {
  const rows = deliveries || [];
  let totalTons = 0;
  let totalRevenue = 0;
  let totalFuel = 0;
  let totalMargin = 0;
  let complete = 0;

  for (const d of rows) {
    if (d.tons_loaded != null) totalTons += Number(d.tons_loaded) || 0;
    if (d.revenue_amount != null) totalRevenue += Number(d.revenue_amount) || 0;
    const fuel = totalLogisticsFuelCost(d);
    if (fuel != null) totalFuel += fuel;
    const margin = deliveryMarginAmount(d);
    if (margin != null) totalMargin += margin;
    if (economicsComplete(d)) complete += 1;
  }

  return {
    count: rows.length,
    complete,
    totalTons: round2(totalTons),
    totalRevenue: round2(totalRevenue),
    totalFuel: round2(totalFuel),
    totalMargin: round2(totalMargin),
  };
}
