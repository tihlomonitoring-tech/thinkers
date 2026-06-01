import { useState, useEffect, useCallback, useMemo } from 'react';
import { fuelVehicleExpenses as fveApi, downloadAttachmentWithAuth } from '../api';
const inputCls =
  'w-full px-2 py-1.5 rounded-lg border border-surface-300 text-sm dark:bg-surface-900 dark:border-surface-600';

function fmtZar(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const emptyEdit = {
  registration_number: '',
  transaction_at: '',
  litres: '',
  start_odometer: '',
  end_odometer: '',
  amount_rand: '',
  price_per_litre: '',
  source_type_name: '',
  input_source: '',
  truck_id: '',
  notes: '',
};

export default function FuelExpenditureTab({ onError, onInfo, refreshKey }) {
  const [expenses, setExpenses] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', registration: '', match_status: 'all' });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    onError?.('');
    const params = {};
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.registration) params.registration = filters.registration;
    if (filters.match_status !== 'all') params.match_status = filters.match_status;
    Promise.all([fveApi.list(params), fveApi.trucks()])
      .then(([e, t]) => {
        setExpenses(e.expenses || []);
        setTrucks(t.trucks || []);
      })
      .catch((err) => onError?.(err?.message || 'Could not load fuel expenditure'))
      .finally(() => setLoading(false));
  }, [filters, onError, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let litres = 0;
    let rand = 0;
    for (const e of expenses) {
      if (e.litres) litres += Number(e.litres);
      if (e.amount_rand) rand += Number(e.amount_rand);
    }
    return { litres, rand, count: expenses.length };
  }, [expenses]);

  const openEdit = (e) => {
    setEditId(e.id);
    setEditForm({
      registration_number: e.registration_number || '',
      transaction_at: e.transaction_at ? String(e.transaction_at).slice(0, 16) : '',
      litres: e.litres ?? '',
      start_odometer: e.start_odometer ?? '',
      end_odometer: e.end_odometer ?? '',
      amount_rand: e.amount_rand ?? '',
      price_per_litre: e.price_per_litre ?? '',
      source_type_name: e.source_type_name || '',
      input_source: e.input_source || '',
      truck_id: e.truck_id || '',
      notes: e.notes || '',
    });
  };

  const saveEdit = async () => {
    setBusy(true);
    onError?.('');
    try {
      await fveApi.patch(editId, {
        ...editForm,
        litres: editForm.litres === '' ? null : Number(editForm.litres),
        start_odometer: editForm.start_odometer === '' ? null : Number(editForm.start_odometer),
        end_odometer: editForm.end_odometer === '' ? null : Number(editForm.end_odometer),
        amount_rand: editForm.amount_rand === '' ? null : Number(editForm.amount_rand),
        price_per_litre: editForm.price_per_litre === '' ? null : Number(editForm.price_per_litre),
        truck_id: editForm.truck_id || null,
      });
      setEditId(null);
      onInfo?.('Transaction updated');
      load();
    } catch (err) {
      onError?.(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const exportQuery = useMemo(() => {
    const p = {};
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.registration) p.registration = filters.registration;
    if (filters.match_status !== 'all') p.match_status = filters.match_status;
    return p;
  }, [filters]);

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Fuel expenditure</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
            Imported internal-vehicle fuel transactions linked to contractor fleet registrations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600"
            onClick={() =>
              downloadAttachmentWithAuth(fveApi.exportExcelUrl(exportQuery), 'internal-vehicle-fuel-expenditure.xlsx').catch(
                (e) => onError?.(e?.message)
              )
            }
          >
            Download Excel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600"
            onClick={() =>
              downloadAttachmentWithAuth(fveApi.exportPdfUrl(exportQuery), 'internal-vehicle-fuel-expenditure.pdf').catch(
                (e) => onError?.(e?.message)
              )
            }
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="app-glass-card p-3">
          <p className="text-xs text-surface-500">Transactions</p>
          <p className="text-xl font-semibold tabular-nums">{totals.count}</p>
        </div>
        <div className="app-glass-card p-3">
          <p className="text-xs text-surface-500">Total litres</p>
          <p className="text-xl font-semibold tabular-nums">{totals.litres.toFixed(1)}</p>
        </div>
        <div className="app-glass-card p-3">
          <p className="text-xs text-surface-500">Total spend</p>
          <p className="text-xl font-semibold tabular-nums">{fmtZar(totals.rand)}</p>
        </div>
        <div className="app-glass-card p-3">
          <p className="text-xs text-surface-500">Matched</p>
          <p className="text-xl font-semibold tabular-nums">
            {expenses.filter((e) => e.match_status === 'matched').length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-surface-500">From</label>
          <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-surface-500">To</label>
          <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-surface-500">Registration</label>
          <input type="text" className={inputCls} placeholder="Search…" value={filters.registration} onChange={(e) => setFilters((f) => ({ ...f, registration: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-surface-500">Match</label>
          <select className={inputCls} value={filters.match_status} onChange={(e) => setFilters((f) => ({ ...f, match_status: e.target.value }))}>
            <option value="all">All</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white">
          Apply
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-surface-500 py-8 text-center">Loading…</p>
      ) : (
        <div className="rounded-xl border border-surface-200 overflow-x-auto dark:border-surface-700">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-surface-50 dark:bg-surface-800 text-xs text-surface-500">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Registration</th>
                <th className="text-left p-2">System truck</th>
                <th className="text-left p-2">Contractor</th>
                <th className="text-right p-2">Litres</th>
                <th className="text-right p-2">Odo start</th>
                <th className="text-right p-2">Odo end</th>
                <th className="text-right p-2">Rand</th>
                <th className="text-right p-2">R/L</th>
                <th className="text-left p-2">Source</th>
                <th className="p-2">Status</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50/50">
                  <td className="p-2 whitespace-nowrap tabular-nums">{fmtDate(e.transaction_at)}</td>
                  <td className="p-2 font-mono text-xs">{e.registration_number}</td>
                  <td className="p-2">{e.truck_registration || '—'}</td>
                  <td className="p-2 text-xs max-w-[120px] truncate">{e.contractor_company_name || e.main_contractor || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{e.litres ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{e.start_odometer ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{e.end_odometer ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{fmtZar(e.amount_rand)}</td>
                  <td className="p-2 text-right tabular-nums">{e.price_per_litre ?? '—'}</td>
                  <td className="p-2 text-xs max-w-[100px] truncate" title={e.source_type_name}>{e.source_type_name || '—'}</td>
                  <td className="p-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs ${
                        e.match_status === 'matched'
                          ? 'bg-emerald-100 text-emerald-800'
                          : e.match_status === 'unmatched'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-surface-100 text-surface-600'
                      }`}
                    >
                      {e.match_status}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="text-xs text-brand-600" onClick={() => openEdit(e)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs text-surface-600"
                        onClick={async () => {
                          await fveApi.rematch(e.id);
                          load();
                        }}
                      >
                        Rematch
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600"
                        onClick={async () => {
                          if (!window.confirm('Delete this transaction?')) return;
                          await fveApi.delete(e.id);
                          load();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!expenses.length && <p className="p-6 text-center text-surface-500 text-sm">No transactions. Import fuel expenses first.</p>}
        </div>
      )}

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditId(null)}>
          <div className="bg-white dark:bg-surface-900 rounded-xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl space-y-3" onClick={(ev) => ev.stopPropagation()}>
            <h4 className="font-semibold">Edit fuel transaction</h4>
            <input className={inputCls} value={editForm.registration_number} onChange={(ev) => setEditForm((f) => ({ ...f, registration_number: ev.target.value }))} placeholder="Registration" />
            <input type="datetime-local" className={inputCls} value={editForm.transaction_at} onChange={(ev) => setEditForm((f) => ({ ...f, transaction_at: ev.target.value }))} />
            <select className={inputCls} value={editForm.truck_id} onChange={(ev) => setEditForm((f) => ({ ...f, truck_id: ev.target.value }))}>
              <option value="">— Link to contractor truck —</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.registration} {t.fleet_no ? `· ${t.fleet_no}` : ''}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} value={editForm.litres} onChange={(ev) => setEditForm((f) => ({ ...f, litres: ev.target.value }))} placeholder="Litres" />
              <input className={inputCls} value={editForm.amount_rand} onChange={(ev) => setEditForm((f) => ({ ...f, amount_rand: ev.target.value }))} placeholder="Rand value" />
              <input className={inputCls} value={editForm.start_odometer} onChange={(ev) => setEditForm((f) => ({ ...f, start_odometer: ev.target.value }))} placeholder="Start odometer" />
              <input className={inputCls} value={editForm.end_odometer} onChange={(ev) => setEditForm((f) => ({ ...f, end_odometer: ev.target.value }))} placeholder="End odometer" />
              <input className={inputCls} value={editForm.price_per_litre} onChange={(ev) => setEditForm((f) => ({ ...f, price_per_litre: ev.target.value }))} placeholder="R/L" />
            </div>
            <input className={inputCls} value={editForm.source_type_name} onChange={(ev) => setEditForm((f) => ({ ...f, source_type_name: ev.target.value }))} placeholder="Source type name" />
            <input className={inputCls} value={editForm.input_source} onChange={(ev) => setEditForm((f) => ({ ...f, input_source: ev.target.value }))} placeholder="Input source" />
            <textarea className={inputCls} rows={2} value={editForm.notes} onChange={(ev) => setEditForm((f) => ({ ...f, notes: ev.target.value }))} placeholder="Notes" />
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-3 py-1.5 text-sm border rounded-lg" onClick={() => setEditId(null)}>
                Cancel
              </button>
              <button type="button" disabled={busy} className="px-4 py-1.5 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
