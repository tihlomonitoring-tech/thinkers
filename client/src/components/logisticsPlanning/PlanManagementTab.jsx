import { useCallback, useEffect, useMemo, useState } from 'react';
import { logisticsPlanning as lpApi, contractor as contractorApi } from '../../api';
import { toYmdInAppZone } from '../../lib/appTime.js';
import InfoHint from '../InfoHint.jsx';

function fmtZar(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function TrendChart({ rows, valueKey, label, color }) {
  const sorted = [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const maxV = Math.max(1, ...sorted.map((r) => Number(r[valueKey]) || 0));
  if (!sorted.length) {
    return <p className="text-sm text-surface-500 py-6 text-center">No data for this period.</p>;
  }
  return (
    <div>
      <p className="text-xs font-medium text-surface-500 mb-2">{label}</p>
      <div className="h-40 flex gap-1 items-end overflow-x-auto">
        {sorted.map((r) => {
          const v = Number(r[valueKey]) || 0;
          const pct = (v / maxV) * 100;
          return (
            <div key={r.date} className="flex flex-col items-center min-w-[2rem] flex-1" title={`${r.date}: ${fmtZar(v)}`}>
              <div className={`w-full max-w-[1.25rem] rounded-t ${color}`} style={{ height: `${Math.max(pct, v > 0 ? 4 : 0)}%` }} />
              <p className="text-[9px] text-surface-500 mt-1">{String(r.date).slice(5)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PlanManagementTab({ onError }) {
  const today = toYmdInAppZone();
  const monthAgo = toYmdInAppZone(new Date(Date.now() - 30 * 86400000));
  const [filters, setFilters] = useState({ from: monthAgo, to: today, route_id: '' });
  const [routes, setRoutes] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    onError('');
    try {
      const [overview, routesRes] = await Promise.all([
        lpApi.getOverview(filters),
        contractorApi.routes.list().catch(() => ({ routes: [] })),
      ]);
      setData(overview);
      setRoutes(routesRes.routes || routesRes || []);
    } catch (e) {
      onError(e?.message || 'Could not load overview');
    } finally {
      setLoading(false);
    }
  }, [filters, onError]);

  useEffect(() => { load(); }, [load]);

  const marginRate = useMemo(() => {
    if (!data?.totals?.revenue) return null;
    return Math.round((data.totals.margin / data.totals.revenue) * 1000) / 10;
  }, [data]);

  return (
    <div className="space-y-4">
      <InfoHint
        title="Plan management & production overview"
        text="Revenue, costs, and margins from slip-verified completed deliveries in Tracking Management. Plan vs actual compares published plans to slip-verified loads. System Advise learns from variance, deviations, queue/travel, and loading slip compliance."
      />

      <div className="app-glass-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="text-xs text-surface-500 block mb-1">From</span>
          <input type="date" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-surface-500 block mb-1">To</span>
          <input type="date" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-surface-500 block mb-1">Route</span>
          <select className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.route_id} onChange={(e) => setFilters((f) => ({ ...f, route_id: e.target.value }))}>
            <option value="">All routes</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-surface-500 p-4">Loading performance data…</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {[
              { label: 'Loads', value: data?.totals?.loads },
              { label: 'Slip verified', value: data?.slip_kpis?.slip_verified_loads ?? '—' },
              { label: 'Slip capture %', value: data?.slip_kpis?.slip_capture_rate != null ? `${data.slip_kpis.slip_capture_rate}%` : '—' },
              { label: 'Revenue', value: fmtZar(data?.totals?.revenue) },
              { label: 'Margin', value: fmtZar(data?.totals?.margin) },
              { label: 'Margin %', value: marginRate != null ? `${marginRate}%` : '—' },
            ].map((k) => (
              <div key={k.label} className="app-glass-card p-4">
                <p className="text-[10px] uppercase font-bold text-surface-500">{k.label}</p>
                <p className="text-xl font-bold tabular-nums mt-1">{k.value ?? '—'}</p>
              </div>
            ))}
          </div>

          {data?.learning?.learning_note && (
            <div className="app-glass-card p-4 text-sm">
              <p className="text-xs font-bold uppercase text-surface-500 mb-1">System learning</p>
              <p className="text-surface-800 dark:text-surface-200">{data.learning.learning_note}</p>
              <p className="text-xs text-surface-500 mt-2">
                Weights — margin {data.learning.weight_margin} · queue {data.learning.weight_queue} · travel {data.learning.weight_travel} · deviation {data.learning.weight_deviation} · slip {data.learning.weight_slip} · targets {data.learning.weight_targets}
              </p>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="app-glass-card p-4">
              <TrendChart rows={data?.daily_trends} valueKey="revenue" label="Daily revenue" color="bg-emerald-500" />
            </div>
            <div className="app-glass-card p-4">
              <TrendChart rows={data?.daily_trends} valueKey="total_cost" label="Daily logistics cost" color="bg-rose-500" />
            </div>
            <div className="app-glass-card p-4">
              <TrendChart rows={data?.daily_trends} valueKey="margin" label="Daily margin" color="bg-brand-500" />
            </div>
            <div className="app-glass-card p-4">
              <TrendChart rows={data?.deviation_trends} valueKey="deviations" label="Off-plan schedule deviations" color="bg-amber-500" />
            </div>
            <div className="app-glass-card p-4">
              <TrendChart rows={data?.daily_trends} valueKey="slip_verified_loads" label="Daily slip-verified loads" color="bg-violet-500" />
            </div>
          </div>

          <div className="app-glass-card p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Plan vs actual (slip-verified loads)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 pr-4 text-right">Expected</th>
                  <th className="py-2 pr-4 text-right">Actual</th>
                  <th className="py-2 pr-4 text-right">Slip verified</th>
                  <th className="py-2 pr-4 text-right">Variance</th>
                  <th className="py-2 text-right">Met?</th>
                </tr>
              </thead>
              <tbody>
                {(data?.plan_vs_actual || []).map((p) => (
                  <tr key={`${p.plan_date}-${p.contractor_route_id}`} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2 pr-4">{String(p.plan_date).slice(0, 10)}</td>
                    <td className="py-2 pr-4 font-medium">{p.route_name || '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.expected_loads}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.actual_loads}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.slip_verified_loads}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.load_variance != null ? `${p.load_variance > 0 ? '+' : ''}${p.load_variance}%` : '—'}</td>
                    <td className="py-2 text-right">
                      {p.loads_met == null ? '—' : (
                        <span className={p.loads_met ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                          {p.loads_met ? 'Yes' : 'No'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="app-glass-card p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Route performance</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 pr-4 text-right">Loads</th>
                  <th className="py-2 pr-4 text-right">Slip %</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {(data?.route_performance || []).map((r) => (
                  <tr key={r.contractor_route_id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2 pr-4 font-medium">{r.route_name || '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.loads}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.slip_capture_rate != null ? `${r.slip_capture_rate}%` : '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtZar(r.revenue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtZar(r.total_cost)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold">{fmtZar(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="app-glass-card p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Plan history</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-surface-500 border-b border-surface-200 dark:border-surface-700">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Routes</th>
                  <th className="py-2 pr-4 text-right">Expected loads</th>
                  <th className="py-2 text-right">Expected revenue</th>
                </tr>
              </thead>
              <tbody>
                {(data?.plan_history || []).map((p) => (
                  <tr key={p.plan_date} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2 pr-4">{String(p.plan_date).slice(0, 10)}</td>
                    <td className="py-2 pr-4 uppercase text-xs font-semibold">{p.status}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.planned_routes}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.expected_loads}</td>
                    <td className="py-2 text-right tabular-nums">{fmtZar(p.expected_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
