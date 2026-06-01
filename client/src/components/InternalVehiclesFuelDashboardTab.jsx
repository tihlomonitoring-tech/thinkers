import { useState, useEffect, useMemo } from 'react';
import { fuelVehicleExpenses as fveApi } from '../api';

function fmtZar(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'R 0';
}

export default function InternalVehiclesFuelDashboardTab({ onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [metric, setMetric] = useState('rand');

  const load = () => {
    setLoading(true);
    onError?.('');
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    fveApi
      .dashboard(params)
      .then(setData)
      .catch((e) => onError?.(e?.message || 'Dashboard load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const byTruck = data?.by_truck || [];
  const maxVal = useMemo(() => {
    const key = metric === 'litres' ? 'total_litres' : 'total_rand';
    return Math.max(...byTruck.map((r) => Number(r[key]) || 0), 1);
  }, [byTruck, metric]);

  return (
    <div className="space-y-4 w-full">
      <div>
        <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Internal vehicles fuel expenditure</h3>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
          Fuel consumption and spend per truck (matched to contractor fleet).
        </p>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="app-glass-card p-3">
            <p className="text-xs text-surface-500">Transactions</p>
            <p className="text-xl font-bold tabular-nums">{data.summary.total_rows ?? 0}</p>
          </div>
          <div className="app-glass-card p-3">
            <p className="text-xs text-surface-500">Matched</p>
            <p className="text-xl font-bold tabular-nums">{data.summary.matched_rows ?? 0}</p>
          </div>
          <div className="app-glass-card p-3">
            <p className="text-xs text-surface-500">Total litres</p>
            <p className="text-xl font-bold tabular-nums">{Number(data.summary.total_litres || 0).toFixed(0)}</p>
          </div>
          <div className="app-glass-card p-3">
            <p className="text-xs text-surface-500">Total spend</p>
            <p className="text-xl font-bold tabular-nums">{fmtZar(data.summary.total_rand)}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <input type="date" className="px-2 py-1.5 border rounded-lg text-sm dark:bg-surface-900" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="px-2 py-1.5 border rounded-lg text-sm dark:bg-surface-900" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="px-2 py-1.5 border rounded-lg text-sm dark:bg-surface-900" value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value="rand">Chart: Rand spend</option>
          <option value="litres">Chart: Litres</option>
        </select>
        <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white">
          Apply
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-surface-500 py-12 text-center">Loading dashboard…</p>
      ) : byTruck.length === 0 ? (
        <p className="text-sm text-surface-500 py-12 text-center">No matched truck data yet. Import fuel expenses first.</p>
      ) : (
        <div className="app-glass-card p-4 space-y-4">
          <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Fuel by vehicle</p>
          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
            {byTruck.map((row) => {
              const label = row.label || row.Label || 'Unknown';
              const litres = Number(row.total_litres ?? row.Total_Litres ?? 0);
              const rand = Number(row.total_rand ?? row.Total_Rand ?? 0);
              const val = metric === 'litres' ? litres : rand;
              const pct = Math.round((val / maxVal) * 100);
              return (
                <div key={label + (row.truck_id || '')}>
                  <div className="flex justify-between text-xs mb-1 gap-2">
                    <span className="font-medium truncate" title={label}>
                      {label}
                      {row.fleet_no ? ` · ${row.fleet_no}` : ''}
                    </span>
                    <span className="text-surface-500 shrink-0 tabular-nums">
                      {metric === 'litres' ? `${litres.toFixed(1)} L` : fmtZar(rand)}
                    </span>
                  </div>
                  <div className="h-6 rounded-md bg-surface-100 dark:bg-surface-800 overflow-hidden">
                    <div
                      className={`h-full rounded-md transition-all ${metric === 'litres' ? 'bg-blue-500' : 'bg-brand-600'}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-surface-400 mt-0.5">
                    {row.transaction_count ?? 0} transactions
                    {row.main_contractor ? ` · ${row.main_contractor}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(data?.by_month || []).length > 0 && (
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium mb-3">By month</p>
          <ul className="text-sm space-y-1">
            {data.by_month.map((m) => (
              <li key={m.month} className="flex justify-between border-b border-surface-100 py-1 dark:border-surface-800">
                <span>{m.month}</span>
                <span className="text-surface-600 tabular-nums">
                  {Number(m.total_litres || 0).toFixed(0)} L · {fmtZar(m.total_rand)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
