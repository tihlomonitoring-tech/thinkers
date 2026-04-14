import { useState, useEffect } from 'react';
import { fuelSupply } from '../../api';
import { inputClass } from '../../lib/fuelSupplyUi';
import { exportProductionVsExpensesExcel, exportProductionVsExpensesPdf } from '../../lib/fuelSupplyExports';
import InfoHint from '../InfoHint.jsx';

const LS_KEY = 'fuel-assumed-price-per-liter';

export default function FuelProductionExpensesTab({ onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assumedPrice, setAssumedPrice] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) || '22.5';
    } catch {
      return '22.5';
    }
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fuelSupply
      .analyticsMonthly(18)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) onError(err?.message || 'Could not load analytics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, assumedPrice);
    } catch (_) {}
  }, [assumedPrice]);

  const series = data?.series || [];
  const forecast = data?.forecast_next_month;
  const price = Number(assumedPrice) || 0;
  const maxLiters = Math.max(1, ...series.map((s) => Number(s.liters) || 0));
  const maxCost = Math.max(1, ...series.map((s) => Number(s.cost) || 0));

  const download = async (kind) => {
    try {
      if (kind === 'xlsx') {
        await exportProductionVsExpensesExcel({ series, assumedPricePerLiter: price, forecast }, undefined);
      } else {
        exportProductionVsExpensesPdf({ series, assumedPricePerLiter: price, forecast });
      }
    } catch (err) {
      onError(err?.message || 'Export failed');
    }
  };

  if (loading) return <p className="text-surface-500">Loading analytics…</p>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Production vs expenses</h2>
          <InfoHint
            title="Production vs expenses help"
            text="Monthly liters delivered (production volume) compared to reconciliation cost (invoice + handling)."
            bullets={[
              'Optional assumed price per liter models implied income and margin for planning — stored in your browser only.',
              'The assumed rate field also drives trend charts and margin columns only.',
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => download('xlsx')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => download('pdf')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm lg:col-span-1">
          <label className="block text-xs font-medium text-surface-600 mb-1">Assumed income rate (R / L)</label>
          <input type="number" min="0" step="0.01" className={inputClass()} value={assumedPrice} onChange={(e) => setAssumedPrice(e.target.value)} />
        </div>
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 shadow-sm lg:col-span-2">
          <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">Trend forecast</p>
          <p className="text-sm text-surface-800 mt-2">
            Next month (linear trend on history):{' '}
            <strong>{forecast?.liters != null ? `${Math.round(forecast.liters)} L` : '—'}</strong> volume,{' '}
            <strong>{forecast?.cost != null ? `R ${forecast.cost.toFixed(2)}` : '—'}</strong> cost.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-6">
        <h3 className="text-sm font-semibold text-surface-900">Volume vs cost by month</h3>
        <div className="space-y-4">
          {series.length === 0 ? (
            <p className="text-surface-500 text-sm">No delivery or reconciliation data yet.</p>
          ) : (
            series.map((s) => {
              const liters = Number(s.liters) || 0;
              const cost = Number(s.cost) || 0;
              const income = price > 0 ? liters * price : 0;
              const margin = income - cost;
              return (
                <div key={s.ym} className="space-y-1">
                  <div className="flex justify-between text-xs text-surface-600">
                    <span className="font-medium text-surface-900">{s.ym}</span>
                    <span>
                      {liters.toFixed(0)} L · R {cost.toFixed(2)}
                      {price > 0 ? ` · margin R ${margin.toFixed(2)}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-surface-100">
                    <div
                      className="bg-emerald-500/90 h-full"
                      style={{ width: `${Math.min(100, (liters / maxLiters) * 100)}%` }}
                      title="Liters"
                    />
                    <div
                      className="bg-rose-400/90 h-full"
                      style={{ width: `${Math.min(100, (cost / maxCost) * 100)}%` }}
                      title="Cost"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto shadow-sm">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-surface-50 text-left text-surface-600">
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Liters</th>
              <th className="px-4 py-2 font-medium">Invoice R</th>
              <th className="px-4 py-2 font-medium">Fees R</th>
              <th className="px-4 py-2 font-medium">Total cost R</th>
              <th className="px-4 py-2 font-medium">R/L cost</th>
              {price > 0 ? <th className="px-4 py-2 font-medium">Margin @ price</th> : null}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const liters = Number(s.liters) || 0;
              const inv = Number(s.invoice_total) || 0;
              const fee = Number(s.fees_total) || 0;
              const cost = Number(s.cost) || inv + fee;
              const cpl = liters > 0 ? cost / liters : null;
              const margin = price > 0 ? liters * price - cost : null;
              return (
                <tr key={s.ym} className="border-t border-surface-100">
                  <td className="px-4 py-2 font-medium">{s.ym}</td>
                  <td className="px-4 py-2">{liters.toFixed(1)}</td>
                  <td className="px-4 py-2">{inv.toFixed(2)}</td>
                  <td className="px-4 py-2">{fee.toFixed(2)}</td>
                  <td className="px-4 py-2">{cost.toFixed(2)}</td>
                  <td className="px-4 py-2">{cpl != null ? cpl.toFixed(3) : '—'}</td>
                  {price > 0 ? <td className="px-4 py-2">{margin != null ? margin.toFixed(2) : '—'}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
