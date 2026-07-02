import { useCallback, useEffect, useMemo, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import {
  calcSourceLabel,
  formatCurrency,
  formatKm,
  formatLitres,
  totalLogisticsFuelCost,
} from '../../lib/deliveryEconomics.js';

function ModeCard({ active, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all ${
        active
          ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/30 ring-2 ring-brand-500/30'
          : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 bg-white/70 dark:bg-surface-950/40'
      }`}
    >
      <p className="text-sm font-bold text-surface-900 dark:text-surface-100">{title}</p>
      <p className="text-xs text-surface-500 mt-1 leading-relaxed">{description}</p>
    </button>
  );
}

function PreviewRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-surface-500 shrink-0">{label}</span>
      <span className="text-right font-medium text-surface-800 dark:text-surface-100 tabular-nums">{value}</span>
    </div>
  );
}

export default function ManualDeliveryImportModal({ onClose, onSaved, setError }) {
  const [routes, setRoutes] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({
    truck_registration: '',
    contractor_route_id: '',
    delivered_at: '',
    loading_slip_no: '',
    offloading_slip_no: '',
    delivery_note_no: '',
    tons_loaded: '',
    driver_name: '',
    notes: '',
    economics_mode: 'system',
    fuel_litres: '',
    fuel_cost: '',
    return_fuel_litres: '',
    return_fuel_cost: '',
    include_return_fuel_in_cost: true,
    revenue_amount: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingRoutes(true);
      try {
        const r = await trackingApi.contractorRoutes.list();
        if (!cancelled) setRoutes(r.routes || []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load routes');
      } finally {
        if (!cancelled) setLoadingRoutes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setError]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === form.contractor_route_id),
    [routes, form.contractor_route_id]
  );

  const canPreview = form.truck_registration.trim()
    && form.contractor_route_id
    && form.delivered_at
    && form.tons_loaded;

  const loadPreview = useCallback(async () => {
    if (!canPreview) return;
    setPreviewing(true);
    setError('');
    try {
      const r = await trackingApi.deliveries.previewManual({
        truck_registration: form.truck_registration.trim(),
        contractor_route_id: form.contractor_route_id,
        delivered_at: form.delivered_at,
        tons_loaded: Number(form.tons_loaded),
      });
      setPreview(r);
      if (form.economics_mode === 'system' && r?.economics) {
        const e = r.economics;
        setForm((f) => ({
          ...f,
          fuel_litres: e.fuel_litres ?? e.fuel_litres_estimated ?? f.fuel_litres,
          fuel_cost: e.fuel_cost ?? e.fuel_cost_estimated ?? f.fuel_cost,
          return_fuel_litres: e.return_fuel_litres ?? e.return_fuel_litres_estimated ?? f.return_fuel_litres,
          return_fuel_cost: e.return_fuel_cost ?? e.return_fuel_cost_estimated ?? f.return_fuel_cost,
          include_return_fuel_in_cost: e.include_return_fuel_in_cost !== false,
          revenue_amount: e.revenue_amount ?? f.revenue_amount,
        }));
      }
    } catch (err) {
      setPreview(null);
      setError(err?.message || 'Could not preview system calculation');
    } finally {
      setPreviewing(false);
    }
  }, [canPreview, form, setError]);

  useEffect(() => {
    if (form.economics_mode !== 'system' || !canPreview) {
      setPreview(null);
      return undefined;
    }
    const timer = setTimeout(() => { loadPreview(); }, 450);
    return () => clearTimeout(timer);
  }, [form.economics_mode, form.truck_registration, form.contractor_route_id, form.delivered_at, form.tons_loaded, canPreview, loadPreview]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        truck_registration: form.truck_registration.trim(),
        contractor_route_id: form.contractor_route_id,
        delivered_at: form.delivered_at,
        loading_slip_no: form.loading_slip_no.trim() || null,
        offloading_slip_no: form.offloading_slip_no.trim(),
        delivery_note_no: form.delivery_note_no.trim() || null,
        tons_loaded: Number(form.tons_loaded),
        driver_name: form.driver_name.trim() || null,
        notes: form.notes.trim() || null,
        economics_mode: form.economics_mode,
        trip_id: preview?.trip_id || null,
      };
      if (form.economics_mode === 'manual') {
        Object.assign(body, {
          fuel_litres: form.fuel_litres !== '' ? Number(form.fuel_litres) : null,
          fuel_cost: form.fuel_cost !== '' ? Number(form.fuel_cost) : null,
          return_fuel_litres: form.return_fuel_litres !== '' ? Number(form.return_fuel_litres) : null,
          return_fuel_cost: form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : null,
          include_return_fuel_in_cost: form.include_return_fuel_in_cost,
          revenue_amount: form.revenue_amount !== '' ? Number(form.revenue_amount) : null,
        });
      }
      await trackingApi.deliveries.importManual(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err?.message || 'Import failed');
    } finally {
      setSaving(false);
    }
  };

  const econ = preview?.economics;
  const draftEconomics = {
    fuel_cost: form.fuel_cost !== '' ? Number(form.fuel_cost) : econ?.fuel_cost,
    return_fuel_cost: form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : econ?.return_fuel_cost,
    revenue_amount: form.revenue_amount !== '' ? Number(form.revenue_amount) : econ?.revenue_amount,
    include_return_fuel_in_cost: form.include_return_fuel_in_cost,
  };
  const previewTotalFuel = totalLogisticsFuelCost(draftEconomics);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <form onSubmit={submit} className="w-full max-w-3xl rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-2xl my-8 overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-100 dark:border-surface-800 bg-gradient-to-r from-indigo-50/80 to-white dark:from-indigo-950/30 dark:to-surface-900">
          <h3 className="text-xl font-bold text-surface-900 dark:text-surface-100">Manual delivery import</h3>
          <p className="text-sm text-surface-500 mt-1">
            Add a previously completed delivery. Choose system estimation from tracked haul data or enter costs manually.
          </p>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
          <section className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-surface-500">Delivery details</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm block sm:col-span-2">
                <span className="text-xs text-surface-500 block mb-1">Truck registration *</span>
                <input required value={form.truck_registration} onChange={(e) => setForm((f) => ({ ...f, truck_registration: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 uppercase" placeholder="ABC 123 GP" />
              </label>
              <label className="text-sm block sm:col-span-2">
                <span className="text-xs text-surface-500 block mb-1">Route *</span>
                <select required value={form.contractor_route_id} onChange={(e) => setForm((f) => ({ ...f, contractor_route_id: e.target.value }))} disabled={loadingRoutes} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950">
                  <option value="">{loadingRoutes ? 'Loading routes…' : 'Select route'}</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name || [r.starting_point, r.destination].filter(Boolean).join(' → ')}</option>
                  ))}
                </select>
                {selectedRoute?.distance_km != null && (
                  <span className="text-[11px] text-surface-400 mt-1 block">Planned distance: {formatKm(selectedRoute.distance_km)}</span>
                )}
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Delivered at *</span>
                <input required type="datetime-local" value={form.delivered_at} onChange={(e) => setForm((f) => ({ ...f, delivered_at: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Tons loaded *</span>
                <input required type="number" min="0.001" step="0.001" value={form.tons_loaded} onChange={(e) => setForm((f) => ({ ...f, tons_loaded: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Loading slip number</span>
                <input value={form.loading_slip_no} onChange={(e) => setForm((f) => ({ ...f, loading_slip_no: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 font-mono" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Offloading slip number *</span>
                <input required value={form.offloading_slip_no} onChange={(e) => setForm((f) => ({ ...f, offloading_slip_no: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 font-mono" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Driver</span>
                <input value={form.driver_name} onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
              </label>
              <label className="text-sm block sm:col-span-2">
                <span className="text-xs text-surface-500 block mb-1">Notes</span>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Optional context for this historical delivery" />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-surface-500">Calculation method</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ModeCard
                active={form.economics_mode === 'system'}
                title="System estimation"
                description="Uses scheduled/tracked trip GPS, haul-road corridor, speed factors, and route regulations when a matching trip is found."
                onClick={() => setForm((f) => ({ ...f, economics_mode: 'system' }))}
              />
              <ModeCard
                active={form.economics_mode === 'manual'}
                title="Manual entry"
                description="Enter fuel, return fuel, and revenue yourself. The system will not overwrite these figures."
                onClick={() => setForm((f) => ({ ...f, economics_mode: 'manual' }))}
              />
            </div>
          </section>

          {form.economics_mode === 'system' && (
            <section className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/70 dark:bg-surface-950/50 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-surface-500">System preview</p>
                {previewing && <span className="text-[11px] text-brand-600">Calculating…</span>}
              </div>
              {!canPreview ? (
                <p className="text-sm text-surface-500">Enter truck, route, delivery time, and tons to preview the system estimate.</p>
              ) : preview ? (
                <>
                  <div className={`rounded-lg px-3 py-2 text-xs font-medium ${preview.trip_linked ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                    {preview.trip_linked
                      ? `Linked to tracked trip ${preview.trip_ref || preview.trip_id} — distance and speed from actual haul.`
                      : 'No matching tracked trip found — estimate uses route distance and regulations.'}
                  </div>
                  <PreviewRow label="Haul distance" value={formatKm(econ?.distance_km)} />
                  <PreviewRow label="Avg speed" value={econ?.avg_speed_kmh != null ? `${econ.avg_speed_kmh} km/h` : '—'} />
                  <PreviewRow label="Distance source" value={calcSourceLabel(econ?.fuel_calc_source)} />
                  <PreviewRow label="Loaded fuel" value={`${formatLitres(econ?.fuel_litres ?? econ?.fuel_litres_estimated)} · ${formatCurrency(econ?.fuel_cost ?? econ?.fuel_cost_estimated)}`} />
                  <PreviewRow label="Return fuel" value={`${formatLitres(econ?.return_fuel_litres ?? econ?.return_fuel_litres_estimated)} · ${formatCurrency(econ?.return_fuel_cost ?? econ?.return_fuel_cost_estimated)}`} />
                  <PreviewRow label="Revenue" value={formatCurrency(econ?.revenue_amount)} />
                  <PreviewRow label="Total fuel cost" value={formatCurrency(previewTotalFuel)} />
                </>
              ) : (
                <p className="text-sm text-surface-500">Preview unavailable — check truck and delivery time, or switch to manual entry.</p>
              )}
            </section>
          )}

          {form.economics_mode === 'manual' && (
            <section className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Fuel used (litres)</span>
                <input type="number" min="0" step="0.001" value={form.fuel_litres} onChange={(e) => setForm((f) => ({ ...f, fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Fuel expense (R)</span>
                <input type="number" min="0" step="0.01" value={form.fuel_cost} onChange={(e) => setForm((f) => ({ ...f, fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Return fuel (litres)</span>
                <input type="number" min="0" step="0.001" value={form.return_fuel_litres} onChange={(e) => setForm((f) => ({ ...f, return_fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block">
                <span className="text-xs text-surface-500 block mb-1">Return fuel expense (R)</span>
                <input type="number" min="0" step="0.01" value={form.return_fuel_cost} onChange={(e) => setForm((f) => ({ ...f, return_fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="text-sm block sm:col-span-2">
                <span className="text-xs text-surface-500 block mb-1">Revenue (R)</span>
                <input type="number" min="0" step="0.01" value={form.revenue_amount} onChange={(e) => setForm((f) => ({ ...f, revenue_amount: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 tabular-nums" />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
                <input type="checkbox" checked={form.include_return_fuel_in_cost} onChange={(e) => setForm((f) => ({ ...f, include_return_fuel_in_cost: e.target.checked }))} className="rounded border-surface-300" />
                <span>Include return fuel in total logistics cost</span>
              </label>
            </section>
          )}
        </div>

        <div className="px-6 py-4 border-t border-surface-100 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-950/50 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">
            {saving ? 'Importing…' : 'Import delivery'}
          </button>
        </div>
      </form>
    </div>
  );
}
