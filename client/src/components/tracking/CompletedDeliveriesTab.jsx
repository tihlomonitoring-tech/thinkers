import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/appTime.js';
import { tracking as trackingApi } from '../../api';
import AdvancedColumnSearchBar from '../AdvancedColumnSearchBar.jsx';
import InfoHint from '../InfoHint.jsx';
import { emptyColumnValues, matchesColumnSearch } from '../../lib/advancedColumnSearch.js';
import {
  calcSourceLabel,
  deliveryMarginAmount,
  economicsComplete,
  formatCurrency,
  formatKm,
  formatLitres,
  formatTons,
  includeReturnFuelInCost,
  summarizeDeliveries,
  totalLogisticsFuelCost,
} from '../../lib/deliveryEconomics.js';

const DELIVERY_SEARCH_COLUMNS = [
  { key: 'truck', label: 'Truck', get: (d) => d.truck_registration },
  { key: 'destination', label: 'Destination', get: (d) => d.destination_name },
  { key: 'route', label: 'Route', get: (d) => d.route_name },
  { key: 'loading_slip', label: 'Loading slip Number', get: (d) => d.loading_slip_no || d.delivery_note_no },
  { key: 'driver', label: 'Driver', get: (d) => d.driver_name },
  { key: 'tons', label: 'Tons', get: (d) => d.tons_loaded },
  { key: 'fuel_litres', label: 'Fuel (L)', get: (d) => d.fuel_litres },
  { key: 'revenue', label: 'Revenue', get: (d) => d.revenue_amount },
  { key: 'deleted_by', label: 'Deleted by', get: (d) => d.deleted_by },
  { key: 'notes', label: 'Notes', get: (d) => d.notes },
];

function IconCalculator({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h10.5A1.75 1.75 0 0 1 17 4.75v10.5A1.75 1.75 0 0 1 15.25 17H4.75A1.75 1.75 0 0 1 3 15.25V4.75ZM5 5.5v1.25h1.25V5.5H5Zm2.5 0v1.25H8.75V5.5H7.5Zm2.5 0v1.25h1.25V5.5H10Zm2.5 0v1.25H14.25V5.5H12.5ZM5 8v1.25h1.25V8H5Zm2.5 0v1.25H8.75V8H7.5Zm2.5 0v1.25h1.25V8H10Zm2.5 0v1.25H14.25V8H12.5ZM5 10.5v1.25h1.25V10.5H5Zm2.5 0v1.25H8.75V10.5H7.5Zm5 0v1.25h1.25V10.5H12.5ZM5 13v3.25h10V13H5Z" />
    </svg>
  );
}

function IconTrash({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.508 0 .91.392.934.898l.066 1.102h2.5a.75.75 0 0 1 0 1.5H3.5a.75.75 0 0 1 0-1.5h2.5l.066-1.102A.934.934 0 0 1 10 4Zm-2.5 5.25a.75.75 0 0 0-1.5 0v5.5a.75.75 0 0 0 1.5 0v-5.5Zm5 0a.75.75 0 0 0-1.5 0v5.5a.75.75 0 0 0 1.5 0v-5.5Z" clipRule="evenodd" />
    </svg>
  );
}

function SummaryCard({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'border-surface-200 dark:border-surface-700 bg-white/80 dark:bg-surface-900/80',
    brand: 'border-brand-200 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-950/30',
    success: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20',
    danger: 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone] || tones.default}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-surface-900 dark:text-surface-100 mt-1">{value}</p>
      {sub && <p className="text-xs text-surface-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function DeleteDeliveryDialog({ delivery, busy, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div
        role="dialog"
        aria-labelledby="delete-delivery-title"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-surface-100 dark:border-surface-800">
          <h3 id="delete-delivery-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100">
            Delete completed delivery?
          </h3>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
            <span className="font-medium text-surface-800 dark:text-surface-200">{delivery.truck_registration}</span>
            {' · '}
            {delivery.route_name || delivery.destination_name || 'Destination'}
          </p>
        </div>
        <div className="px-5 py-4 text-sm text-surface-600 dark:text-surface-400">
          This delivery moves to <strong>Deleted completed deliveries</strong>. You can restore it later from that tab.
        </div>
        <div className="px-5 py-4 flex gap-2 justify-end bg-surface-50/80 dark:bg-surface-950/50">
          <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-white dark:hover:bg-surface-800 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            <IconTrash className="w-4 h-4" />
            {busy ? 'Deleting…' : 'Delete delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliveryRowActions({ busy, onCalculation, onDelete }) {
  return (
    <div className="inline-flex items-center gap-1.5 justify-end">
      <button
        type="button"
        title="Calculation"
        aria-label="Open calculation"
        disabled={busy}
        onClick={onCalculation}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 bg-brand-50/80 dark:bg-brand-950/30 hover:bg-brand-100 dark:hover:bg-brand-950/50 disabled:opacity-50 transition-colors"
      >
        <IconCalculator className="w-3.5 h-3.5" />
        Calculation
      </button>
      <button
        type="button"
        title="Delete delivery"
        aria-label="Delete delivery"
        disabled={busy}
        onClick={onDelete}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:border-red-900 disabled:opacity-50 transition-colors"
      >
        <IconTrash className="w-4 h-4" />
      </button>
    </div>
  );
}

function CalcBreakdownRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-surface-500 shrink-0">{label}</span>
      <span className={`text-right font-medium text-surface-800 dark:text-surface-100 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function DeliveryNoteModal({ delivery, onClose, onSaved, setError }) {
  const [form, setForm] = useState({
    delivery_note_no: delivery?.delivery_note_no || '',
    tons_loaded: delivery?.tons_loaded ?? '',
    driver_name: delivery?.driver_name || '',
    notes: delivery?.notes && delivery.notes !== 'Awaiting delivery note' ? delivery.notes : '',
  });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await trackingApi.deliveries.saveNote(delivery.id, {
        delivery_note_no: form.delivery_note_no,
        tons_loaded: form.tons_loaded !== '' ? Number(form.tons_loaded) : null,
        driver_name: form.driver_name,
        notes: form.notes,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <form onSubmit={save} className="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl p-5 space-y-3">
        <h3 className="text-lg font-semibold">Delivery note — {delivery.truck_registration}</h3>
        <p className="text-xs text-surface-500">Captured here for Command Centre shift reports.</p>
        <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Delivery note number" value={form.delivery_note_no} onChange={(e) => setForm((f) => ({ ...f, delivery_note_no: e.target.value }))} required />
        <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Tons loaded" type="number" step="0.001" value={form.tons_loaded} onChange={(e) => setForm((f) => ({ ...f, tons_loaded: e.target.value }))} />
        <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Driver name" value={form.driver_name} onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))} />
        <textarea className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" rows={3} placeholder="Remarks" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save delivery note'}</button>
        </div>
      </form>
    </div>
  );
}

function DeliveryCalculationModal({ delivery, onClose, onSaved, setError }) {
  const economicsIncomplete = (d) => !economicsComplete(d);
  const [form, setForm] = useState({
    fuel_litres: delivery?.fuel_litres ?? '',
    fuel_cost: delivery?.fuel_cost ?? '',
    return_fuel_litres: delivery?.return_fuel_litres ?? '',
    return_fuel_cost: delivery?.return_fuel_cost ?? '',
    include_return_fuel_in_cost: includeReturnFuelInCost(delivery),
    revenue_amount: delivery?.revenue_amount ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [detail, setDetail] = useState(delivery);

  const applySnapshot = (snapDelivery) => {
    setDetail(snapDelivery);
    setForm({
      fuel_litres: snapDelivery?.fuel_litres ?? '',
      fuel_cost: snapDelivery?.fuel_cost ?? '',
      return_fuel_litres: snapDelivery?.return_fuel_litres ?? '',
      return_fuel_cost: snapDelivery?.return_fuel_cost ?? '',
      include_return_fuel_in_cost: includeReturnFuelInCost(snapDelivery),
      revenue_amount: snapDelivery?.revenue_amount ?? '',
    });
  };

  const recalc = async (force = false) => {
    setRecalcing(true);
    try {
      const r = await trackingApi.deliveries.snapshotFuel(delivery.id, { force });
      applySnapshot(r.delivery);
    } catch (err) {
      setError(err?.message || 'Could not calculate fuel');
    } finally {
      setRecalcing(false);
    }
  };

  useEffect(() => {
    if (!delivery?.id || !economicsIncomplete(delivery)) return;
    let cancelled = false;
    (async () => {
      setRecalcing(true);
      try {
        const r = await trackingApi.deliveries.snapshotFuel(delivery.id, { force: true });
        if (!cancelled) applySnapshot(r.delivery);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not auto-calculate delivery figures');
      } finally {
        if (!cancelled) setRecalcing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [delivery?.id]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await trackingApi.deliveries.updateEconomics(delivery.id, {
        fuel_litres: form.fuel_litres !== '' ? Number(form.fuel_litres) : null,
        fuel_cost: form.fuel_cost !== '' ? Number(form.fuel_cost) : null,
        return_fuel_litres: form.return_fuel_litres !== '' ? Number(form.return_fuel_litres) : null,
        return_fuel_cost: form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : null,
        include_return_fuel_in_cost: form.include_return_fuel_in_cost,
        revenue_amount: form.revenue_amount !== '' ? Number(form.revenue_amount) : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const d = detail || delivery;
  const liveDraft = {
    ...d,
    fuel_cost: form.fuel_cost !== '' ? Number(form.fuel_cost) : d.fuel_cost,
    return_fuel_cost: form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : d.return_fuel_cost,
    revenue_amount: form.revenue_amount !== '' ? Number(form.revenue_amount) : d.revenue_amount,
    include_return_fuel_in_cost: form.include_return_fuel_in_cost,
  };
  const liveMargin = deliveryMarginAmount(liveDraft);
  const liveTotalFuel = totalLogisticsFuelCost(liveDraft);

  const loadedFormula = d.distance_km != null && d.fuel_litres_per_100km != null
    ? `${formatKm(d.distance_km)} × ${d.fuel_litres_per_100km} L/100km${d.avg_speed_kmh ? ` × speed factor` : ''}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 overflow-y-auto">
      <form onSubmit={save} className="w-full max-w-2xl rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-2xl my-8 overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-100 dark:border-surface-800 bg-gradient-to-r from-brand-50/80 to-white dark:from-brand-950/30 dark:to-surface-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-surface-900 dark:text-surface-100">Calculation</h3>
              <p className="text-sm font-semibold text-surface-700 dark:text-surface-300 mt-1">{d.truck_registration}</p>
              <p className="text-xs text-surface-500 mt-0.5">
                {d.route_name || [d.origin_name, d.destination_name].filter(Boolean).join(' → ') || 'Route'}
                {d.distance_km != null && ` · ${formatKm(d.distance_km)}`}
              </p>
            </div>
            {d.fuel_calc_source && (
              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-600">
                {calcSourceLabel(d.fuel_calc_source)}
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {recalcing && economicsIncomplete(d) && (
            <p className="text-sm text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/30 border border-brand-100 dark:border-brand-900 rounded-lg px-3 py-2">
              Calculating fuel, distance, and revenue from route regulations and haul-road data…
            </p>
          )}

          <section className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/70 dark:bg-surface-950/50 p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-surface-500">System calculation</p>
            <CalcBreakdownRow label="Haul distance" value={formatKm(d.distance_km)} />
            <CalcBreakdownRow label="Consumption" value={d.fuel_litres_per_100km != null ? `${d.fuel_litres_per_100km} L/100km` : '—'} />
            <CalcBreakdownRow label="Diesel price" value={d.fuel_price_per_litre != null ? formatCurrency(d.fuel_price_per_litre) + '/L' : '—'} />
            <CalcBreakdownRow label="Avg speed" value={d.avg_speed_kmh != null ? `${d.avg_speed_kmh} km/h` : '—'} />
            <CalcBreakdownRow label="Payload" value={d.tons_loaded != null ? `${formatTons(d.tons_loaded)} t` : '—'} />
            <CalcBreakdownRow label="Revenue rate" value={d.revenue_per_ton != null ? `${formatCurrency(d.revenue_per_ton)}/t` : '—'} />
            {loadedFormula && (
              <CalcBreakdownRow label="Loaded fuel formula" value={loadedFormula} mono />
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-surface-200 dark:border-surface-800">
              <div>
                <p className="text-[10px] uppercase text-surface-500">Est. loaded L</p>
                <p className="font-semibold tabular-nums">{formatLitres(d.fuel_litres_estimated)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-surface-500">Est. loaded R</p>
                <p className="font-semibold tabular-nums">{formatCurrency(d.fuel_cost_estimated)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-surface-500">Est. return L</p>
                <p className="font-semibold tabular-nums">{formatLitres(d.return_fuel_litres_estimated)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-surface-500">Est. return R</p>
                <p className="font-semibold tabular-nums">{formatCurrency(d.return_fuel_cost_estimated)}</p>
              </div>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-5">
            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-surface-500">Loaded leg</p>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Fuel used (litres)</span>
                <input type="number" min="0" step="0.001" value={form.fuel_litres} onChange={(e) => setForm((f) => ({ ...f, fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Fuel expense (R)</span>
                <input type="number" min="0" step="0.01" value={form.fuel_cost} onChange={(e) => setForm((f) => ({ ...f, fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-surface-500">
                Empty return{d.origin_name ? ` → ${d.origin_name}` : ''}
              </p>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Return fuel (litres)</span>
                <input type="number" min="0" step="0.001" value={form.return_fuel_litres} onChange={(e) => setForm((f) => ({ ...f, return_fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Return fuel expense (R)</span>
                <input type="number" min="0" step="0.01" value={form.return_fuel_cost} onChange={(e) => setForm((f) => ({ ...f, return_fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.include_return_fuel_in_cost} onChange={(e) => setForm((f) => ({ ...f, include_return_fuel_in_cost: e.target.checked }))} className="rounded border-surface-300" />
                <span>Include return fuel in total logistics cost</span>
              </label>
            </section>
          </div>

          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">Revenue (R)</span>
            <input type="number" min="0" step="0.01" value={form.revenue_amount} onChange={(e) => setForm((f) => ({ ...f, revenue_amount: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
          </label>

          <div className="grid grid-cols-3 gap-3 rounded-xl bg-surface-900 text-white p-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-surface-400">Total fuel</p>
              <p className="text-lg font-bold tabular-nums mt-1">{formatCurrency(liveTotalFuel)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-surface-400">Revenue</p>
              <p className="text-lg font-bold tabular-nums mt-1">{formatCurrency(liveDraft.revenue_amount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-surface-400">Margin</p>
              <p className={`text-lg font-bold tabular-nums mt-1 ${liveMargin != null && liveMargin < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                {formatCurrency(liveMargin)}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-surface-100 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-950/50 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => recalc(true)} disabled={recalcing} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border disabled:opacity-50">
            <IconCalculator className="w-4 h-4" />
            {recalcing ? 'Calculating…' : 'Recalculate from route data'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save calculation'}</button>
        </div>
      </form>
    </div>
  );
}

function MarginCell({ delivery }) {
  const margin = delivery.margin_amount ?? deliveryMarginAmount(delivery);
  if (margin == null) return <span className="text-surface-400">—</span>;
  const positive = margin >= 0;
  return (
    <span className={`font-semibold tabular-nums ${positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {formatCurrency(margin)}
    </span>
  );
}

export default function CompletedDeliveriesTab({ setError, noteDeliveryId, onNoteDeliveryHandled }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [calculationModal, setCalculationModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [view, setView] = useState('active');
  const [busyId, setBusyId] = useState(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayYmd());
  const [search, setSearch] = useState({ global: '', columns: emptyColumnValues(DELIVERY_SEARCH_COLUMNS), expanded: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await trackingApi.deliveries.list({
        from,
        to,
        deleted: view === 'deleted' ? 'true' : 'false',
        completed_only: 'true',
      });
      setDeliveries(r.deliveries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  }, [from, to, view, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!noteDeliveryId || view !== 'active') return;
    const d = deliveries.find((x) => x.trip_id === noteDeliveryId || x.id === noteDeliveryId);
    if (d) setModal(d);
    else {
      trackingApi.deliveries.list({ deleted: 'false', completed_only: 'false' }).then((r) => {
        const pending = (r.deliveries || []).find((x) => x.pending_note && (x.trip_id === noteDeliveryId || x.truck_registration === noteDeliveryId));
        if (pending) setModal(pending);
      }).catch(() => {});
    }
    onNoteDeliveryHandled?.();
  }, [noteDeliveryId, deliveries, onNoteDeliveryHandled, view]);

  const deleteDelivery = async (delivery) => {
    setBusyId(delivery.id);
    setError('');
    try {
      await trackingApi.deliveries.remove(delivery.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const restoreDelivery = async (delivery) => {
    setBusyId(delivery.id);
    setError('');
    try {
      await trackingApi.deliveries.restore(delivery.id);
      await load();
    } catch (err) {
      setError(err?.message || 'Restore failed');
    } finally {
      setBusyId(null);
    }
  };

  const isDeletedView = view === 'deleted';

  const filteredDeliveries = useMemo(
    () => deliveries.filter((d) => matchesColumnSearch(d, DELIVERY_SEARCH_COLUMNS, search.columns, search.global)),
    [deliveries, search]
  );

  const summary = useMemo(() => summarizeDeliveries(filteredDeliveries), [filteredDeliveries]);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Completed deliveries</h1>
          <InfoHint
            title="Completed deliveries"
            text="Deliveries captured with an offloading slip on Logistics Activity. Fuel, return fuel, and revenue are calculated from haul-road distance, route regulations, and payload — then snapshotted per delivery."
          />
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-surface-200 dark:border-surface-800 pb-2">
        <button type="button" onClick={() => setView('active')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'active' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}>
          Completed deliveries
        </button>
        <button type="button" onClick={() => setView('deleted')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'deleted' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}>
          Deleted completed deliveries
        </button>
      </div>

      {!isDeletedView && filteredDeliveries.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard label="Deliveries" value={summary.count} sub={`${summary.complete} with full calculations`} />
          <SummaryCard label="Total tons" value={formatTons(summary.totalTons)} />
          <SummaryCard label="Revenue" value={formatCurrency(summary.totalRevenue)} tone="brand" />
          <SummaryCard label="Total fuel" value={formatCurrency(summary.totalFuel)} />
          <SummaryCard
            label="Net margin"
            value={formatCurrency(summary.totalMargin)}
            tone={summary.totalMargin != null && summary.totalMargin < 0 ? 'danger' : 'success'}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="text-xs text-surface-500 block mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm">
          <span className="text-xs text-surface-500 block mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <button type="button" onClick={load} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-surface-50 dark:hover:bg-surface-800">Apply</button>
      </div>

      <AdvancedColumnSearchBar
        columns={DELIVERY_SEARCH_COLUMNS}
        columnValues={search.columns}
        onColumnChange={(key, val) => setSearch((s) => ({ ...s, columns: { ...s.columns, [key]: val } }))}
        globalQuery={search.global}
        onGlobalQueryChange={(v) => setSearch((s) => ({ ...s, global: v }))}
        expanded={search.expanded}
        onToggleExpanded={() => setSearch((s) => ({ ...s, expanded: !s.expanded }))}
        onClear={() => setSearch({ global: '', columns: emptyColumnValues(DELIVERY_SEARCH_COLUMNS), expanded: false })}
        resultCount={filteredDeliveries.length}
        totalCount={deliveries.length}
      />

      <section className="app-glass-panel-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-surface-200 dark:border-surface-800 flex flex-wrap items-center justify-between gap-2 bg-surface-50/80 dark:bg-surface-900/80">
          <p className="text-xs font-medium text-surface-500">
            {loading ? 'Loading deliveries…' : `${filteredDeliveries.length} delivery${filteredDeliveries.length === 1 ? '' : 'ies'}`}
          </p>
          {!isDeletedView && (
            <p className="text-[11px] text-surface-400">Fuel = loaded + return (when included) · Margin = revenue − total fuel</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-surface-500 bg-surface-50 dark:bg-surface-900 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">{isDeletedView ? 'Deleted' : 'Date'}</th>
                <th className="text-left px-4 py-3 font-semibold">Truck</th>
                <th className="text-left px-4 py-3 font-semibold min-w-[160px]">Route</th>
                <th className="text-left px-4 py-3 font-semibold">Loading slip Number</th>
                <th className="text-right px-4 py-3 font-semibold">Tons</th>
                {!isDeletedView && <th className="text-right px-4 py-3 font-semibold">Distance</th>}
                {!isDeletedView && <th className="text-right px-4 py-3 font-semibold">Fuel</th>}
                {!isDeletedView && <th className="text-right px-4 py-3 font-semibold">Total fuel</th>}
                {!isDeletedView && <th className="text-right px-4 py-3 font-semibold">Revenue</th>}
                {!isDeletedView && <th className="text-right px-4 py-3 font-semibold">Margin</th>}
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                {isDeletedView && <th className="text-left px-4 py-3 font-semibold">Deleted by</th>}
                <th className="text-right px-4 py-3 font-semibold min-w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800 bg-white/60 dark:bg-surface-950/40">
              {loading ? (
                <tr><td colSpan={isDeletedView ? 8 : 12} className="px-4 py-12 text-center text-surface-500">Loading…</td></tr>
              ) : filteredDeliveries.map((d) => {
                const complete = economicsComplete(d);
                const totalFuel = d.total_logistics_fuel_cost ?? totalLogisticsFuelCost(d);
                const routeLabel = d.route_name || '—';
                const loadingSlip = d.loading_slip_no || d.delivery_note_no;
                return (
                  <tr key={d.id} className="hover:bg-surface-50/80 dark:hover:bg-surface-900/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-surface-700 dark:text-surface-300">
                      {String((isDeletedView ? d.deleted_at : d.delivered_at) || '').slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-surface-900 dark:text-surface-100">{d.truck_registration}</span>
                      {d.driver_name && <span className="block text-[11px] text-surface-500">{d.driver_name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-surface-700 dark:text-surface-300 font-medium">{routeLabel}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-surface-600">{loadingSlip || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatTons(d.tons_loaded)}</td>
                    {!isDeletedView && (
                      <td className="px-4 py-3 text-right tabular-nums text-surface-600">{formatKm(d.distance_km)}</td>
                    )}
                    {!isDeletedView && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="block">{formatLitres(d.fuel_litres)}</span>
                        {d.return_fuel_litres != null && (
                          <span className="block text-[10px] text-surface-400">+ {formatLitres(d.return_fuel_litres)} ret.</span>
                        )}
                      </td>
                    )}
                    {!isDeletedView && (
                      <td className="px-4 py-3 text-right tabular-nums font-medium" title={includeReturnFuelInCost(d) ? 'Includes return fuel' : 'Loaded leg only'}>
                        {formatCurrency(totalFuel)}
                      </td>
                    )}
                    {!isDeletedView && (
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(d.revenue_amount)}</td>
                    )}
                    {!isDeletedView && (
                      <td className="px-4 py-3 text-right"><MarginCell delivery={d} /></td>
                    )}
                    <td className="px-4 py-3">
                      {isDeletedView ? (
                        <span className="inline-flex text-xs font-semibold text-red-700 bg-red-100 dark:bg-red-950/40 dark:text-red-200 px-2 py-0.5 rounded-full">Deleted</span>
                      ) : complete ? (
                        <span className="inline-flex text-xs font-semibold text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 rounded-full">Complete</span>
                      ) : (
                        <span className="inline-flex text-xs font-semibold text-amber-700 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5 rounded-full">Needs calculation</span>
                      )}
                    </td>
                    {isDeletedView && (
                      <td className="px-4 py-3 text-surface-600 text-xs">{d.deleted_by || '—'}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {!isDeletedView && (
                        <DeliveryRowActions
                          busy={busyId === d.id}
                          onCalculation={() => setCalculationModal(d)}
                          onDelete={() => setDeleteTarget(d)}
                        />
                      )}
                      {isDeletedView && (
                        <button
                          type="button"
                          disabled={busyId === d.id}
                          onClick={() => restoreDelivery(d)}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline disabled:opacity-50"
                        >
                          {busyId === d.id ? 'Restoring…' : 'Restore'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredDeliveries.length === 0 && (
                <tr>
                  <td colSpan={isDeletedView ? 8 : 12} className="px-4 py-12 text-center text-surface-500">
                    {deliveries.length === 0
                      ? (isDeletedView ? 'No deleted deliveries in this period.' : 'No completed deliveries with an offloading slip in this period.')
                      : 'No deliveries match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <DeliveryNoteModal
          delivery={modal}
          onClose={() => setModal(null)}
          onSaved={load}
          setError={setError}
        />
      )}

      {calculationModal && (
        <DeliveryCalculationModal
          delivery={calculationModal}
          onClose={() => setCalculationModal(null)}
          onSaved={load}
          setError={setError}
        />
      )}

      {deleteTarget && (
        <DeleteDeliveryDialog
          delivery={deleteTarget}
          busy={busyId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteDelivery(deleteTarget)}
        />
      )}
    </div>
  );
}