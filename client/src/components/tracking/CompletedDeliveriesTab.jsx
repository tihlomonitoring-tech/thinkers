import { useCallback, useEffect, useState } from 'react';
import { todayYmd } from '../../lib/appTime.js';
import { tracking as trackingApi } from '../../api';

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

function DeliveryEconomicsModal({ delivery, onClose, onSaved, setError }) {
  const [form, setForm] = useState({
    fuel_litres: delivery?.fuel_litres ?? '',
    fuel_cost: delivery?.fuel_cost ?? '',
    return_fuel_litres: delivery?.return_fuel_litres ?? '',
    return_fuel_cost: delivery?.return_fuel_cost ?? '',
    include_return_fuel_in_cost: !!delivery?.include_return_fuel_in_cost,
    revenue_amount: delivery?.revenue_amount ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [detail, setDetail] = useState(delivery);

  const recalc = async () => {
    setRecalcing(true);
    try {
      const r = await trackingApi.deliveries.snapshotFuel(delivery.id);
      setDetail(r.delivery);
      setForm({
        fuel_litres: r.delivery?.fuel_litres ?? '',
        fuel_cost: r.delivery?.fuel_cost ?? '',
        return_fuel_litres: r.delivery?.return_fuel_litres ?? '',
        return_fuel_cost: r.delivery?.return_fuel_cost ?? '',
        include_return_fuel_in_cost: !!r.delivery?.include_return_fuel_in_cost,
        revenue_amount: r.delivery?.revenue_amount ?? '',
      });
    } catch (err) {
      setError(err?.message || 'Could not calculate fuel');
    } finally {
      setRecalcing(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await trackingApi.deliveries.updateEconomics(delivery.id, {
        fuel_litres: form.fuel_litres !== '' ? Number(form.fuel_litres) : null,
        fuel_cost: form.fuel_cost !== '' ? Number(form.fuel_cost) : null,
        return_fuel_litres: form.return_fuel_litres !== '' ? Number(form.return_fuel_litres) : null,
        return_fuel_cost: form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : null,
        include_return_fuel_in_cost: form.include_return_fuel_in_cost,
        revenue_amount: form.revenue_amount !== '' ? Number(form.revenue_amount) : null,
      });
      onSaved();
      onClose();
      return r;
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const margin = detail?.margin_amount;
  const d = detail || delivery;
  const liveMargin = (() => {
    const rev = form.revenue_amount !== '' ? Number(form.revenue_amount) : null;
    const loaded = form.fuel_cost !== '' ? Number(form.fuel_cost) : null;
    const ret = form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : null;
    let cost = loaded;
    if (cost != null && form.include_return_fuel_in_cost && ret != null) cost += ret;
    if (rev != null && cost != null && Number.isFinite(rev) && Number.isFinite(cost)) {
      return Math.round((rev - cost) * 100) / 100;
    }
    return margin;
  })();

  const liveTotalFuel = (() => {
    const loaded = form.fuel_cost !== '' ? Number(form.fuel_cost) : null;
    const ret = form.return_fuel_cost !== '' ? Number(form.return_fuel_cost) : null;
    if (loaded == null) return null;
    const total = loaded + (form.include_return_fuel_in_cost && ret != null ? ret : 0);
    return Math.round(total * 100) / 100;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <form onSubmit={save} className="w-full max-w-lg rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl p-5 space-y-4 my-8">
        <h3 className="text-lg font-semibold">Delivery economics — {d.truck_registration}</h3>
        <p className="text-xs text-surface-500">
          {d.origin_name || 'Origin'} → {d.destination_name || 'Destination'}
          {d.distance_km != null && ` · ${d.distance_km} km`}
          {d.avg_speed_kmh != null && ` · avg ${d.avg_speed_kmh} km/h`}
        </p>
        {(d.truck_make_model || d.truck_year_model) && (
          <p className="text-xs text-surface-500">
            Vehicle: {[d.truck_make_model, d.truck_year_model].filter(Boolean).join(' · ')}
            {d.fuel_litres_per_100km != null && ` · ${d.fuel_litres_per_100km} L/100km (snapshot)`}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm rounded-lg bg-surface-50 dark:bg-surface-950 p-3">
          <div>
            <p className="text-xs text-surface-500">Loaded leg fuel (L)</p>
            <p className="font-semibold tabular-nums">{d.fuel_litres_estimated ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-surface-500">Loaded leg cost (R)</p>
            <p className="font-semibold tabular-nums">{d.fuel_cost_estimated ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-surface-500">Empty return (L)</p>
            <p className="font-semibold tabular-nums">{d.return_fuel_litres_estimated ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-surface-500">Empty return cost (R)</p>
            <p className="font-semibold tabular-nums">{d.return_fuel_cost_estimated ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-surface-500">Return distance</p>
            <p className="font-semibold tabular-nums">{d.return_distance_km != null ? `${d.return_distance_km} km` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-surface-500">Empty L/100km (snapshot)</p>
            <p className="font-semibold tabular-nums">{d.return_fuel_litres_per_100km ?? '—'}</p>
          </div>
        </div>

        <p className="text-xs font-medium text-surface-600 dark:text-surface-400">Loaded leg (to destination)</p>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Fuel used (litres)</span>
          <input type="number" min="0" step="0.001" value={form.fuel_litres} onChange={(e) => setForm((f) => ({ ...f, fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Fuel expense (R)</span>
          <input type="number" min="0" step="0.01" value={form.fuel_cost} onChange={(e) => setForm((f) => ({ ...f, fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>

        <p className="text-xs font-medium text-surface-600 dark:text-surface-400 pt-1">
          Empty return to logistics field
          {d.origin_name && ` (${d.destination_name || 'Destination'} → ${d.origin_name})`}
        </p>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Return fuel (litres)</span>
          <input type="number" min="0" step="0.001" value={form.return_fuel_litres} onChange={(e) => setForm((f) => ({ ...f, return_fuel_litres: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Return fuel expense (R)</span>
          <input type="number" min="0" step="0.01" value={form.return_fuel_cost} onChange={(e) => setForm((f) => ({ ...f, return_fuel_cost: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.include_return_fuel_in_cost}
            onChange={(e) => setForm((f) => ({ ...f, include_return_fuel_in_cost: e.target.checked }))}
            className="rounded border-surface-300"
          />
          <span>Include empty return fuel in total logistics cost</span>
        </label>

        {liveTotalFuel != null && (
          <p className="text-sm text-surface-600">
            Total logistics fuel: <strong className="tabular-nums">R {liveTotalFuel.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
            {!form.include_return_fuel_in_cost && form.return_fuel_cost !== '' && (
              <span className="text-xs text-surface-500"> (loaded only — return excluded)</span>
            )}
          </p>
        )}
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Revenue (R)</span>
          <input type="number" min="0" step="0.01" value={form.revenue_amount} onChange={(e) => setForm((f) => ({ ...f, revenue_amount: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>

        {liveMargin != null && (
          <p className={`text-sm font-semibold ${liveMargin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            Margin: R {liveMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          {!d.fuel_snapshot_at && (
            <button type="button" onClick={recalc} disabled={recalcing} className="px-3 py-2 text-sm rounded-lg border disabled:opacity-50">
              {recalcing ? 'Calculating…' : 'Calculate fuel'}
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

export default function CompletedDeliveriesTab({ setError, noteDeliveryId, onNoteDeliveryHandled }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [economicsModal, setEconomicsModal] = useState(null);
  const [view, setView] = useState('active');
  const [busyId, setBusyId] = useState(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayYmd());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await trackingApi.deliveries.list({
        from,
        to,
        deleted: view === 'deleted' ? 'true' : 'false',
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
      trackingApi.deliveries.list({ deleted: 'false' }).then((r) => {
        const pending = (r.deliveries || []).find((x) => x.pending_note && (x.trip_id === noteDeliveryId || x.truck_registration === noteDeliveryId));
        if (pending) setModal(pending);
      }).catch(() => {});
    }
    onNoteDeliveryHandled?.();
  }, [noteDeliveryId, deliveries, onNoteDeliveryHandled, view]);

  const deleteDelivery = async (delivery) => {
    if (!window.confirm(`Delete completed delivery for ${delivery.truck_registration}? It will move to Deleted completed deliveries.`)) return;
    setBusyId(delivery.id);
    setError('');
    try {
      await trackingApi.deliveries.remove(delivery.id);
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

  const pending = view === 'active' ? deliveries.filter((d) => d.pending_note) : [];
  const isDeletedView = view === 'deleted';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Completed deliveries</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">Delivery notes feed Command Centre. Fuel expense and revenue are snapshotted per delivery.</p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-surface-200 dark:border-surface-800 pb-2">
        <button
          type="button"
          onClick={() => setView('active')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'active' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
        >
          Completed deliveries
        </button>
        <button
          type="button"
          onClick={() => setView('deleted')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'deleted' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
        >
          Deleted completed deliveries
        </button>
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <strong>{pending.length}</strong> delivery note(s) awaiting capture.
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
        <button type="button" onClick={load} className="rounded-lg border px-3 py-1.5 text-sm">Apply</button>
      </div>

      <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-surface-500 bg-surface-50 dark:bg-surface-900">
            <tr>
              <th className="text-left px-4 py-2">{isDeletedView ? 'Deleted' : 'Date'}</th>
              <th className="text-left px-4 py-2">Truck</th>
              <th className="text-left px-4 py-2">Destination</th>
              <th className="text-left px-4 py-2">Note #</th>
              <th className="text-right px-4 py-2">Tons</th>
              {!isDeletedView && <th className="text-right px-4 py-2">Fuel (L)</th>}
              {!isDeletedView && <th className="text-right px-4 py-2">Fuel (R)</th>}
              {!isDeletedView && <th className="text-right px-4 py-2">Return (R)</th>}
              {!isDeletedView && <th className="text-right px-4 py-2">Total fuel</th>}
              {!isDeletedView && <th className="text-right px-4 py-2">Revenue</th>}
              <th className="text-left px-4 py-2">Status</th>
              {isDeletedView && <th className="text-left px-4 py-2">Deleted by</th>}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isDeletedView ? 8 : 12} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
            ) : deliveries.map((d) => (
              <tr key={d.id} className="border-t border-surface-100 dark:border-surface-800">
                <td className="px-4 py-2 whitespace-nowrap">
                  {String((isDeletedView ? d.deleted_at : d.delivered_at) || '').slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-4 py-2 font-medium">{d.truck_registration}</td>
                <td className="px-4 py-2 text-surface-600">{d.destination_name || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">{d.delivery_note_no || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.tons_loaded ?? '—'}</td>
                {!isDeletedView && <td className="px-4 py-2 text-right tabular-nums">{d.fuel_litres ?? '—'}</td>}
                {!isDeletedView && <td className="px-4 py-2 text-right tabular-nums">{d.fuel_cost != null ? d.fuel_cost.toFixed(2) : '—'}</td>}
                {!isDeletedView && <td className="px-4 py-2 text-right tabular-nums">{d.return_fuel_cost != null ? d.return_fuel_cost.toFixed(2) : '—'}</td>}
                {!isDeletedView && (
                  <td className="px-4 py-2 text-right tabular-nums">
                    {d.total_logistics_fuel_cost != null ? d.total_logistics_fuel_cost.toFixed(2) : '—'}
                    {d.include_return_fuel_in_cost && d.return_fuel_cost != null && (
                      <span className="block text-[10px] text-surface-400">incl. return</span>
                    )}
                  </td>
                )}
                {!isDeletedView && <td className="px-4 py-2 text-right tabular-nums">{d.revenue_amount != null ? d.revenue_amount.toFixed(2) : '—'}</td>}
                <td className="px-4 py-2">
                  {isDeletedView ? (
                    <span className="text-xs font-medium text-red-700 bg-red-100 dark:bg-red-950/40 dark:text-red-200 px-2 py-0.5 rounded">Deleted</span>
                  ) : d.pending_note ? (
                    <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Pending note</span>
                  ) : (
                    <span className="text-xs text-emerald-700">Completed</span>
                  )}
                </td>
                {isDeletedView && (
                  <td className="px-4 py-2 text-surface-600 text-xs">{d.deleted_by || '—'}</td>
                )}
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {!isDeletedView && d.pending_note && (
                    <button type="button" onClick={() => setModal(d)} className="text-xs text-brand-600 hover:underline mr-3">Enter note</button>
                  )}
                  {!isDeletedView && !d.pending_note && (
                    <>
                      <button type="button" onClick={() => setEconomicsModal(d)} className="text-xs text-brand-600 hover:underline mr-3">Economics</button>
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => deleteDelivery(d)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {busyId === d.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </>
                  )}
                  {isDeletedView && (
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => restoreDelivery(d)}
                      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {busyId === d.id ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && deliveries.length === 0 && (
              <tr>
                <td colSpan={isDeletedView ? 8 : 12} className="px-4 py-8 text-center text-surface-500">
                  {isDeletedView ? 'No deleted deliveries in this period.' : 'No deliveries in this period.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {modal && (
        <DeliveryNoteModal
          delivery={modal}
          onClose={() => setModal(null)}
          onSaved={load}
          setError={setError}
        />
      )}

      {economicsModal && (
        <DeliveryEconomicsModal
          delivery={economicsModal}
          onClose={() => setEconomicsModal(null)}
          onSaved={load}
          setError={setError}
        />
      )}
    </div>
  );
}
