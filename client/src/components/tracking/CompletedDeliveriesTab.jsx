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

export default function CompletedDeliveriesTab({ setError, noteDeliveryId, onNoteDeliveryHandled }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
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
      const r = await trackingApi.deliveries.list({ from, to });
      setDeliveries(r.deliveries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  }, [from, to, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!noteDeliveryId) return;
    const d = deliveries.find((x) => x.trip_id === noteDeliveryId || x.id === noteDeliveryId);
    if (d) setModal(d);
    else {
      trackingApi.deliveries.list({}).then((r) => {
        const pending = (r.deliveries || []).find((x) => x.pending_note && (x.trip_id === noteDeliveryId || x.truck_registration === noteDeliveryId));
        if (pending) setModal(pending);
      }).catch(() => {});
    }
    onNoteDeliveryHandled?.();
  }, [noteDeliveryId, deliveries, onNoteDeliveryHandled]);

  const pending = deliveries.filter((d) => d.pending_note);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Completed deliveries</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">Delivery notes feed into Command Centre shift reports.</p>
      </header>

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
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Truck</th>
              <th className="text-left px-4 py-2">Destination</th>
              <th className="text-left px-4 py-2">Note #</th>
              <th className="text-right px-4 py-2">Tons</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
            ) : deliveries.map((d) => (
              <tr key={d.id} className="border-t border-surface-100 dark:border-surface-800">
                <td className="px-4 py-2 whitespace-nowrap">{String(d.delivered_at || '').slice(0, 16).replace('T', ' ')}</td>
                <td className="px-4 py-2 font-medium">{d.truck_registration}</td>
                <td className="px-4 py-2 text-surface-600">{d.destination_name || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">{d.delivery_note_no || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.tons_loaded ?? '—'}</td>
                <td className="px-4 py-2">
                  {d.pending_note ? (
                    <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Pending note</span>
                  ) : (
                    <span className="text-xs text-emerald-700">Completed</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {d.pending_note && (
                    <button type="button" onClick={() => setModal(d)} className="text-xs text-brand-600 hover:underline">Enter note</button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && deliveries.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">No deliveries in this period.</td></tr>
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
    </div>
  );
}
