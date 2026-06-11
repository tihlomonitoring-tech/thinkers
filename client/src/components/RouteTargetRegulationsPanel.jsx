import { useState, useMemo } from 'react';
import { contractor as contractorApi } from '../api';
import InfoHint from './InfoHint.jsx';
import {
  computeRouteEconomics,
  mapRegulationToEconomicsInput,
  ROUTE_ECONOMICS_DEFAULTS,
} from '../lib/routeEconomics.js';

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-surface-600 mb-1">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-surface-400 mt-0.5">{hint}</p> : null}
    </div>
  );
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function HealthBadge({ health }) {
  const styles = {
    healthy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-900 border-amber-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
    unknown: 'bg-surface-100 text-surface-600 border-surface-200',
  };
  const labels = { healthy: 'Healthy margin', warning: 'Review needed', critical: 'Loss risk', unknown: 'Incomplete data' };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[health] || styles.unknown}`}>
      {labels[health] || health}
    </span>
  );
}

function RsoPanel({ rso }) {
  if (!rso) return null;
  const { per_trip: pt, period: p, insights, corridor } = rso;
  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/80 to-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Route Smart Outlook (RSO)</p>
          <p className="text-sm text-surface-700 mt-1">
            {corridor.loading_site || 'Loading'} → {corridor.destination || 'Destination'}
            {corridor.distance_km ? ` · ${corridor.distance_km} km` : ''}
          </p>
        </div>
        <HealthBadge health={rso.health} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Revenue / trip</p>
          <p className="font-bold text-surface-900">{rso.formatted.revenue_per_trip}</p>
        </div>
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Cost / trip</p>
          <p className="font-bold text-surface-900">{rso.formatted.cost_per_trip}</p>
        </div>
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Margin / trip</p>
          <p className={`font-bold ${pt.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{rso.formatted.margin_per_trip}</p>
          {pt.margin_percent != null && <p className="text-[11px] text-surface-500">{pt.margin_percent}%</p>}
        </div>
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Projected revenue</p>
          <p className="font-bold text-surface-900">{rso.formatted.projected_revenue}</p>
          <p className="text-[11px] text-surface-500">{p.days}d · {p.enrolled_trucks} trucks</p>
        </div>
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Projected cost</p>
          <p className="font-bold text-surface-900">{rso.formatted.projected_cost}</p>
        </div>
        <div className="rounded-xl bg-white/90 border border-surface-200 p-3">
          <p className="text-[10px] uppercase text-surface-500">Revenue target</p>
          <p className="font-bold text-surface-900">{rso.formatted.revenue_target}</p>
          {p.revenue_target_pct != null && (
            <p className={`text-[11px] ${p.revenue_target_pct >= 100 ? 'text-emerald-600' : 'text-amber-700'}`}>
              {p.revenue_target_pct}% projected
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white/80 border border-surface-200 p-3 text-xs space-y-1.5">
        <p className="font-semibold text-surface-700 uppercase tracking-wide text-[10px]">Cost breakdown (per trip)</p>
        <div className="flex justify-between"><span className="text-surface-500">Fuel</span><span>{money(pt.fuel_cost)}</span></div>
        <div className="flex justify-between"><span className="text-surface-500">Driver</span><span>{money(pt.driver_cost)}</span></div>
        <div className="flex justify-between"><span className="text-surface-500">Maintenance</span><span>{money(pt.maintenance_cost)}</span></div>
        <div className="flex justify-between"><span className="text-surface-500">Tolls</span><span>{money(pt.toll_cost)}</span></div>
        <div className="flex justify-between"><span className="text-surface-500">Other + overhead</span><span>{money(pt.other_cost + pt.overhead_cost)}</span></div>
        <div className="flex justify-between border-t border-surface-200 pt-1.5 font-semibold">
          <span>Break-even rate</span>
          <span>{pt.break_even_rate_per_ton != null ? `R ${pt.break_even_rate_per_ton}/t` : '—'}</span>
        </div>
      </div>

      {insights?.length > 0 && (
        <ul className="space-y-1.5">
          {insights.map((ins, i) => (
            <li
              key={i}
              className={`text-xs rounded-lg px-3 py-2 border ${
                ins.level === 'critical' ? 'bg-red-50 border-red-200 text-red-900'
                  : ins.level === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : ins.level === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-surface-50 border-surface-200 text-surface-700'
              }`}
            >
              {ins.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROUTE_CORRIDOR_FIELD_KEYS = [
  'starting_point',
  'destination',
  'loading_address',
  'destination_address',
  'distance_km',
];

function getFieldValue(inputs, reg, route, key, routeId) {
  const k = `${key}:${routeId}`;
  if (inputs[k] !== undefined && inputs[k] !== '') return inputs[k];
  if (reg?.[key] != null && reg[key] !== '') return String(reg[key]);
  if (ROUTE_CORRIDOR_FIELD_KEYS.includes(key) && route?.[key] != null && route[key] !== '') {
    return String(route[key]);
  }
  if (key === 'avg_payload_tons' && (route?.min_tons != null || route?.max_tons != null)) {
    return String(route.min_tons ?? route.max_tons);
  }
  return ROUTE_ECONOMICS_DEFAULTS[key] ?? '';
}

function buildPayload(inputs, reg, route, routeId) {
  const num = (key) => {
    const v = getFieldValue(inputs, reg, route, key, routeId);
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const target = Number(getFieldValue(inputs, reg, route, 'deliveries_per_truck_target', routeId));
  const corridor = Object.fromEntries(
    ROUTE_CORRIDOR_FIELD_KEYS.map((key) => [key, key === 'distance_km' ? num('distance_km') : (getFieldValue(inputs, reg, route, key, routeId) || null)])
  );
  return {
    deliveries_per_truck_target: target,
    ...corridor,
    distance_km: corridor.distance_km,
    rate_per_ton: num('rate_per_ton'),
    revenue_target: num('revenue_target'),
    avg_payload_tons: num('avg_payload_tons'),
    fuel_litres_per_100km: num('fuel_litres_per_100km'),
    fuel_price_per_litre: num('fuel_price_per_litre'),
    driver_cost_per_trip: num('driver_cost_per_trip'),
    maintenance_cost_per_km: num('maintenance_cost_per_km'),
    toll_cost_per_trip: num('toll_cost_per_trip'),
    other_cost_per_trip: num('other_cost_per_trip'),
    overhead_percent: num('overhead_percent'),
    target_period_days: num('target_period_days') || 30,
    notes: getFieldValue(inputs, reg, route, 'notes', routeId) || null,
  };
}

function effectiveCorridorValue(reg, route, key) {
  if (reg?.[key] != null && reg[key] !== '') return reg[key];
  if (route?.[key] != null && route[key] !== '') return route[key];
  return null;
}

export default function RouteTargetRegulationsPanel({
  routes,
  regulations,
  setRegulations,
  routeEnrollments = {},
  onError,
  onRouteUpdated,
}) {
  const [expandedRouteId, setExpandedRouteId] = useState(null);
  const [inputs, setInputs] = useState({});
  const [savingRouteId, setSavingRouteId] = useState('');

  const regByRouteId = useMemo(
    () => Object.fromEntries((regulations || []).map((x) => [String(x.route_id), x])),
    [regulations]
  );

  const setField = (routeId, key, value) => {
    setInputs((prev) => ({ ...prev, [`${key}:${routeId}`]: value }));
  };

  const saveRoute = async (route) => {
    const routeId = route.id;
    const reg = regByRouteId[String(routeId)];
    const payload = buildPayload(inputs, reg, route, routeId);
    if (!Number.isFinite(payload.deliveries_per_truck_target) || payload.deliveries_per_truck_target <= 0) {
      onError?.('Enter a positive deliveries-per-truck target.');
      return;
    }
    setSavingRouteId(String(routeId));
    try {
      const resp = await contractorApi.routeTargetRegulations.upsert(routeId, payload);
      const saved = resp?.regulation;
      if (resp?.route) onRouteUpdated?.(resp.route);
      if (saved) {
        setRegulations((prev) => {
          const idx = prev.findIndex((x) => String(x.route_id) === String(routeId));
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = saved;
            return next;
          }
          return [...prev, saved];
        });
      }
    } catch (e) {
      onError?.(e?.message || 'Failed to save route targets');
    } finally {
      setSavingRouteId('');
    }
  };

  if (!routes?.length) {
    return <p className="text-sm text-surface-500 py-6">No routes available for your current scope.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-surface-900">Targets regulations per route</h3>
        <InfoHint
          title="Corridor economics & RSO"
          text="Corridor names, addresses, and distance sync with Access Management → Route management. Set rate per ton, revenue target, and trip costs; Route Smart Outlook (RSO) calculates margins and break-even."
        />
      </div>

      <div className="space-y-3">
        {routes.map((route) => {
          const routeId = String(route.id);
          const reg = regByRouteId[routeId];
          const expanded = expandedRouteId === route.id;
          const enrolledTrucks = Math.max(1, (routeEnrollments[route.id]?.trucks || []).length);
          const draftPayload = buildPayload(inputs, reg, route, route.id);
          const liveRso = computeRouteEconomics(mapRegulationToEconomicsInput(
            { ...reg, ...draftPayload },
            route,
            enrolledTrucks
          ));

          return (
            <div key={route.id} className="rounded-2xl border border-surface-200 bg-white shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedRouteId(expanded ? null : route.id)}
                className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-50"
              >
                <div>
                  <p className="font-semibold text-surface-900">{route.name || 'Unnamed route'}</p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {(effectiveCorridorValue(reg, route, 'starting_point') || 'Loading site')} → {(effectiveCorridorValue(reg, route, 'destination') || 'Destination')}
                    {effectiveCorridorValue(reg, route, 'distance_km') ? ` · ${effectiveCorridorValue(reg, route, 'distance_km')} km` : ''}
                    · {enrolledTrucks} truck(s) enrolled
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {reg?.rso?.health && <HealthBadge health={liveRso.health || reg.rso.health} />}
                  <span className="text-surface-400">{expanded ? '−' : '+'}</span>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-surface-100 p-4 lg:p-5 grid lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-surface-500">Corridor (shared with Access Management)</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Loading site (short name)">
                        <input type="text" value={getFieldValue(inputs, reg, route, 'starting_point', route.id)} onChange={(e) => setField(route.id, 'starting_point', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Mine A" />
                      </Field>
                      <Field label="Destination (short name)">
                        <input type="text" value={getFieldValue(inputs, reg, route, 'destination', route.id)} onChange={(e) => setField(route.id, 'destination', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Port B" />
                      </Field>
                      <Field label="Loading address" hint="Full address or GPS reference">
                        <textarea rows={2} value={getFieldValue(inputs, reg, route, 'loading_address', route.id)} onChange={(e) => setField(route.id, 'loading_address', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Destination address">
                        <textarea rows={2} value={getFieldValue(inputs, reg, route, 'destination_address', route.id)} onChange={(e) => setField(route.id, 'destination_address', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Distance (km)" hint="Synced with Route management">
                        <input type="number" min="0" step="0.1" value={getFieldValue(inputs, reg, route, 'distance_km', route.id)} onChange={(e) => setField(route.id, 'distance_km', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. 85" />
                      </Field>
                    </div>

                    <p className="text-xs font-bold uppercase tracking-wider text-surface-500 pt-2">Targets & economics</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Deliveries per truck *" hint="Target trips per truck in the period">
                        <input type="number" min="0" step="0.1" value={getFieldValue(inputs, reg, route, 'deliveries_per_truck_target', route.id)} onChange={(e) => setField(route.id, 'deliveries_per_truck_target', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. 12" />
                      </Field>
                      <Field label="Target period (days)">
                        <input type="number" min="1" value={getFieldValue(inputs, reg, route, 'target_period_days', route.id)} onChange={(e) => setField(route.id, 'target_period_days', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Avg payload (tons)">
                        <input type="number" min="0" step="0.1" value={getFieldValue(inputs, reg, route, 'avg_payload_tons', route.id)} onChange={(e) => setField(route.id, 'avg_payload_tons', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Rate per ton (R)">
                        <input type="number" min="0" step="0.01" value={getFieldValue(inputs, reg, route, 'rate_per_ton', route.id)} onChange={(e) => setField(route.id, 'rate_per_ton', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Revenue target (R)" hint="For the target period">
                        <input type="number" min="0" step="1" value={getFieldValue(inputs, reg, route, 'revenue_target', route.id)} onChange={(e) => setField(route.id, 'revenue_target', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                    </div>

                    <p className="text-xs font-bold uppercase tracking-wider text-surface-500 pt-2">Trip costs</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Fuel (L/100km)">
                        <input type="number" min="0" step="0.1" value={getFieldValue(inputs, reg, route, 'fuel_litres_per_100km', route.id)} onChange={(e) => setField(route.id, 'fuel_litres_per_100km', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Fuel price (R/L)">
                        <input type="number" min="0" step="0.01" value={getFieldValue(inputs, reg, route, 'fuel_price_per_litre', route.id)} onChange={(e) => setField(route.id, 'fuel_price_per_litre', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Driver cost / trip (R)">
                        <input type="number" min="0" step="1" value={getFieldValue(inputs, reg, route, 'driver_cost_per_trip', route.id)} onChange={(e) => setField(route.id, 'driver_cost_per_trip', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Maintenance (R/km)">
                        <input type="number" min="0" step="0.01" value={getFieldValue(inputs, reg, route, 'maintenance_cost_per_km', route.id)} onChange={(e) => setField(route.id, 'maintenance_cost_per_km', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Tolls / trip (R)">
                        <input type="number" min="0" step="1" value={getFieldValue(inputs, reg, route, 'toll_cost_per_trip', route.id)} onChange={(e) => setField(route.id, 'toll_cost_per_trip', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Other / trip (R)">
                        <input type="number" min="0" step="1" value={getFieldValue(inputs, reg, route, 'other_cost_per_trip', route.id)} onChange={(e) => setField(route.id, 'other_cost_per_trip', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Overhead %" hint="% on direct costs">
                        <input type="number" min="0" step="0.1" value={getFieldValue(inputs, reg, route, 'overhead_percent', route.id)} onChange={(e) => setField(route.id, 'overhead_percent', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </Field>
                      <Field label="Notes">
                        <input type="text" value={getFieldValue(inputs, reg, route, 'notes', route.id)} onChange={(e) => setField(route.id, 'notes', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Regulation notes" />
                      </Field>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button type="button" onClick={() => saveRoute(route)} disabled={savingRouteId === routeId} className="rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-60">
                        {savingRouteId === routeId ? 'Saving…' : 'Save route targets'}
                      </button>
                      {reg?.updated_at && (
                        <span className="text-xs text-surface-500">Last saved {fmtDateTime(reg.updated_at)}{reg.updated_by_name ? ` · ${reg.updated_by_name}` : ''}</span>
                      )}
                    </div>
                  </div>

                  <RsoPanel rso={liveRso} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
