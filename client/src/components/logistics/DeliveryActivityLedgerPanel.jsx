import { useState, useEffect, useCallback, useMemo } from 'react';
import { logisticsFinance as lfApi } from '../../api';
import InfoHint from '../InfoHint.jsx';

const LEDGER_SECTIONS = [
  { id: 'diesel', label: 'Diesel captures', description: 'Location, date/time, litres, driver & truck' },
  { id: 'expenses', label: 'Truck expenses', description: 'Maintenance, tolls, permits & other costs' },
  { id: 'deliveries', label: 'Completed deliveries', description: 'Import approved Command Centre shift data' },
  { id: 'trial', label: 'Trial balance', description: 'Deliveries vs revenue vs diesel per route & truck' },
];

const EMPTY_DIESEL = {
  truck_id: '',
  driver_id: '',
  route_id: '',
  transaction_at: '',
  location: '',
  litres: '',
  price_per_litre: '',
  amount_rand: '',
  odometer_km: '',
  supplier: '',
  receipt_ref: '',
  notes: '',
};

function fmtZar(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-surface-600">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="text-[11px] text-surface-400 mt-0.5">{hint}</p> : null}
    </label>
  );
}

function FormModal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-surface-900 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 border border-surface-200 dark:border-surface-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3 mb-4">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-50">{title}</h3>
          <button type="button" onClick={onClose} className="text-surface-500 hover:text-surface-800 text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LedgerFilterBar({ filters, onChange, routes, trucks }) {
  return (
    <div className="app-glass-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">From</span>
        <input type="date" value={filters.date_from || ''} onChange={(e) => onChange({ ...filters, date_from: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600" />
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">To</span>
        <input type="date" value={filters.date_to || ''} onChange={(e) => onChange({ ...filters, date_to: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600" />
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Route</span>
        <select value={filters.route_id || ''} onChange={(e) => onChange({ ...filters, route_id: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All routes</option>
          {(routes || []).map((r) => (
            <option key={r.id || r.name} value={r.id || ''}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Truck</span>
        <select value={filters.truck_id || ''} onChange={(e) => onChange({ ...filters, truck_id: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All trucks</option>
          {(trucks || []).map((r) => (
            <option key={r.id} value={r.id}>{r.registration}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button type="button" onClick={() => onChange({ date_from: '', date_to: '', route_id: '', truck_id: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          Clear filters
        </button>
      </div>
    </div>
  );
}

function SectionNav({ section, setSection }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LEDGER_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setSection(s.id)}
          className={`rounded-xl px-3 py-2 text-left border transition-colors ${
            section === s.id
              ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/40'
              : 'border-surface-200 bg-white hover:bg-surface-50 dark:bg-surface-900 dark:border-surface-700'
          }`}
        >
          <span className="block text-xs font-semibold">{s.label}</span>
          <span className="block text-[10px] text-surface-500 mt-0.5">{s.description}</span>
        </button>
      ))}
    </div>
  );
}

function DieselSection({ context, filters, onError, onSuccess }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_DIESEL);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lfApi.ledger.listDiesel(filters);
      setEntries(r.entries || []);
    } catch (e) {
      onError?.(e?.message || 'Failed to load diesel entries');
    } finally {
      setLoading(false);
    }
  }, [filters, onError]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    if ((k === 'litres' || k === 'price_per_litre') && next.litres && next.price_per_litre) {
      const amt = Number(next.litres) * Number(next.price_per_litre);
      if (Number.isFinite(amt)) next.amount_rand = String(Math.round(amt * 100) / 100);
    }
    return next;
  });

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await lfApi.ledger.createDiesel({
        ...form,
        litres: Number(form.litres),
        price_per_litre: form.price_per_litre ? Number(form.price_per_litre) : null,
        amount_rand: Number(form.amount_rand),
        odometer_km: form.odometer_km ? Number(form.odometer_km) : null,
        route_id: form.route_id || null,
      });
      onSuccess?.('Diesel capture saved');
      setForm(EMPTY_DIESEL);
      setFormOpen(false);
      load();
    } catch (err) {
      onError?.(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this diesel capture?')) return;
    try {
      await lfApi.ledger.deleteDiesel(id);
      onSuccess?.('Diesel entry removed');
      load();
    } catch (err) {
      onError?.(err?.message || 'Delete failed');
    }
  };

  const dieselForm = (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center gap-2">
        <InfoHint text="Tie each fill to truck, driver, location, date/time and litres. Amount auto-calculates from price per litre." />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Truck" required>
          <select required value={form.truck_id} onChange={(e) => set('truck_id', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900">
            <option value="">Select truck</option>
            {(context?.trucks || []).map((t) => (
              <option key={t.id} value={t.id}>{t.registration}{t.contractor_name ? ` · ${t.contractor_name}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Driver" required>
          <select required value={form.driver_id} onChange={(e) => set('driver_id', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900">
            <option value="">Select driver</option>
            {(context?.drivers || []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date & time" required>
          <input required type="datetime-local" value={form.transaction_at} onChange={(e) => set('transaction_at', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Location" required hint="Depot, filling station, route km marker">
          <input required value={form.location} onChange={(e) => set('location', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" placeholder="e.g. N1 Ultra City, Harrismith" />
        </Field>
        <Field label="Litres" required>
          <input required type="number" min="0" step="0.01" value={form.litres} onChange={(e) => set('litres', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Price / litre (R)">
          <input type="number" min="0" step="0.01" value={form.price_per_litre} onChange={(e) => set('price_per_litre', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Amount (R)" required>
          <input required type="number" min="0" step="0.01" value={form.amount_rand} onChange={(e) => set('amount_rand', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Route (optional)">
          <select value={form.route_id} onChange={(e) => set('route_id', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900">
            <option value="">Auto from truck enrollment</option>
            {(context?.routes || []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Odometer (km)">
          <input type="number" min="0" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Supplier / station">
          <input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Receipt ref">
          <input value={form.receipt_ref} onChange={(e) => set('receipt_ref', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
      </Field>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save capture'}
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-4 min-h-[min(28rem,65vh)]">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50">Diesel register</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setFormOpen(true)} className="px-4 py-2 text-sm rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700">
            Capture diesel
          </button>
          <button type="button" onClick={load} className="px-3 py-2 text-sm rounded-lg border border-surface-300 hover:bg-surface-50">Refresh</button>
        </div>
      </div>

      <FormModal open={formOpen} title="Capture diesel fill-up" onClose={() => setFormOpen(false)}>
        {dieselForm}
      </FormModal>

      <div className="app-glass-card overflow-hidden flex flex-col flex-1 min-h-0">
        {loading ? <p className="p-4 text-sm text-surface-500">Loading…</p> : (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-surface-50 dark:bg-surface-900/50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wide text-surface-500">
                  <th className="p-3">When</th>
                  <th className="p-3">Truck</th>
                  <th className="p-3">Driver</th>
                  <th className="p-3">Route</th>
                  <th className="p-3">Location</th>
                  <th className="p-3 text-right">Litres</th>
                  <th className="p-3 text-right">R/L</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-surface-100 hover:bg-surface-50/50">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(e.transaction_at)}</td>
                    <td className="p-3 font-medium">{e.truck_registration || '—'}</td>
                    <td className="p-3">{e.driver_name || '—'}</td>
                    <td className="p-3">{e.route_name || '—'}</td>
                    <td className="p-3 max-w-[180px] truncate" title={e.location}>{e.location}</td>
                    <td className="p-3 text-right tabular-nums">{e.litres}</td>
                    <td className="p-3 text-right tabular-nums">{e.price_per_litre ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{fmtZar(e.amount_rand)}</td>
                    <td className="p-3"><button type="button" onClick={() => remove(e.id)} className="text-xs text-red-600 font-medium">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!entries.length && <p className="p-10 text-center text-surface-500">No diesel captures yet. Click <strong>Capture diesel</strong> to log a fill-up.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpensesSection({ context, filters, onError, onSuccess }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    truck_id: '', driver_id: '', route_id: '', expense_type: 'maintenance',
    expense_date: new Date().toISOString().slice(0, 10), amount_rand: '', vendor: '', location: '', description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lfApi.ledger.listExpenses(filters);
      setEntries(r.entries || []);
    } catch (e) {
      onError?.(e?.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [filters, onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await lfApi.ledger.createExpense({ ...form, amount_rand: Number(form.amount_rand), route_id: form.route_id || null, driver_id: form.driver_id || null });
      onSuccess?.('Expense saved');
      setForm((f) => ({ ...f, amount_rand: '', vendor: '', location: '', description: '' }));
      setFormOpen(false);
      load();
    } catch (err) {
      onError?.(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const expenseForm = (
    <form onSubmit={save} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Truck" required>
          <select required value={form.truck_id} onChange={(e) => setForm((f) => ({ ...f, truck_id: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900">
            <option value="">Select truck</option>
            {(context?.trucks || []).map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
          </select>
        </Field>
        <Field label="Expense type" required>
          <select value={form.expense_type} onChange={(e) => setForm((f) => ({ ...f, expense_type: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900">
            {(context?.expense_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input required type="date" value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Amount (R)" required>
          <input required type="number" min="0" step="0.01" value={form.amount_rand} onChange={(e) => setForm((f) => ({ ...f, amount_rand: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Vendor">
          <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
        <Field label="Location">
          <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
        </Field>
      </div>
      <Field label="Description">
        <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900" />
      </Field>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save expense'}
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-4 min-h-[min(28rem,65vh)]">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50">Truck expense register</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setFormOpen(true)} className="px-4 py-2 text-sm rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700">
            Add truck expense
          </button>
          <button type="button" onClick={load} className="px-3 py-2 text-sm rounded-lg border border-surface-300 hover:bg-surface-50">Refresh</button>
        </div>
      </div>

      <FormModal open={formOpen} title="Truck operating expense" onClose={() => setFormOpen(false)}>
        {expenseForm}
      </FormModal>

      <div className="app-glass-card overflow-hidden flex flex-col flex-1 min-h-0">
        {loading ? <p className="p-4 text-sm text-surface-500">Loading…</p> : (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-surface-50 dark:bg-surface-900/50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wide text-surface-500">
                  <th className="p-3">Date</th>
                  <th className="p-3">Truck</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-surface-100 hover:bg-surface-50/50">
                    <td className="p-3 whitespace-nowrap">{fmtDate(e.expense_date)}</td>
                    <td className="p-3 font-medium">{e.truck_registration}</td>
                    <td className="p-3 capitalize">{e.expense_type}</td>
                    <td className="p-3">{e.vendor || '—'}</td>
                    <td className="p-3 max-w-[140px] truncate" title={e.location}>{e.location || '—'}</td>
                    <td className="p-3 max-w-[160px] truncate" title={e.description}>{e.description || '—'}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{fmtZar(e.amount_rand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!entries.length && <p className="p-10 text-center text-surface-500">No truck expenses recorded. Click <strong>Add truck expense</strong> to log a cost.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveriesSection({ filters, onError, onSuccess }) {
  const [preview, setPreview] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ledger, setLedger] = useState([]);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        lfApi.ledger.previewCommandCentre(filters),
        lfApi.ledger.listDeliveries(filters),
      ]);
      setPreview(p.preview || []);
      setLedger(d.deliveries || []);
      setSelected(new Set());
    } catch (e) {
      onError?.(e?.message || 'Failed to load Command Centre deliveries');
    } finally {
      setLoading(false);
    }
  }, [filters, onError]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = async () => {
    setImporting(true);
    try {
      const ids = [...selected];
      const r = await lfApi.ledger.importCommandCentre(
        ids.length ? { source_delivery_ids: ids } : { import_all: true, ...filters }
      );
      onSuccess?.(`Imported ${r.imported} completed delivery row(s) from Command Centre`);
      loadPreview();
    } catch (e) {
      onError?.(e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Load completed deliveries from Command Centre</h3>
            <p className="text-sm text-surface-500 mt-1">
              Approved single-ops shift reports with per-truck route breakdown (loads and tons captured on the shift report form — not on the PDF). One ledger row per route line; revenue is estimated from tons × route rate; diesel is estimated from fleet fuel consumption × route distance (km).
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadPreview} className="text-sm px-3 py-1.5 rounded-lg border border-surface-300">Refresh</button>
            <button type="button" disabled={importing || (!selected.size && !preview.length)} onClick={importSelected} className="text-sm px-4 py-1.5 rounded-lg bg-brand-600 text-white font-medium disabled:opacity-50">
              {importing ? 'Importing…' : selected.size ? `Import ${selected.size} selected` : 'Import all in range'}
            </button>
          </div>
        </div>
        {loading ? <p className="text-sm text-surface-500">Loading…</p> : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-surface-50 sticky top-0">
                <tr className="text-left text-surface-500">
                  <th className="p-2 w-8" />
                  <th className="p-2">Date</th>
                  <th className="p-2">Truck</th>
                  <th className="p-2">Driver</th>
                  <th className="p-2">Route</th>
                  <th className="p-2 text-right">Loads</th>
                  <th className="p-2 text-right">Tons</th>
                  <th className="p-2 text-right">Est. revenue</th>
                  <th className="p-2 text-right">Est. diesel (L)</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.source_delivery_id} className="border-t border-surface-100 hover:bg-surface-50/50">
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(row.source_delivery_id)} onChange={() => toggle(row.source_delivery_id)} />
                    </td>
                    <td className="p-2">{fmtDate(row.delivery_date)}</td>
                    <td className="p-2 font-medium">{row.truck_registration}</td>
                    <td className="p-2">{row.driver_name || '—'}</td>
                    <td className="p-2">{row.route_name || '—'}</td>
                    <td className="p-2 text-right tabular-nums font-semibold">{row.completed_deliveries}</td>
                    <td className="p-2 text-right tabular-nums">{row.tons_loaded != null ? Number(row.tons_loaded).toFixed(2) : '—'}</td>
                    <td className="p-2 text-right tabular-nums text-emerald-700">{row.estimated_revenue != null ? fmtZar(row.estimated_revenue) : '—'}</td>
                    <td className="p-2 text-right tabular-nums text-rose-700">{row.estimated_fuel_litres != null ? Number(row.estimated_fuel_litres).toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!preview.length && <p className="py-8 text-center text-surface-500">No new approved Command Centre deliveries in this period.</p>}
          </div>
        )}
      </div>

      <div className="app-glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-200 font-semibold text-sm">Ledger — imported deliveries ({ledger.length})</div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-xs">
            <thead className="bg-surface-50 sticky top-0">
              <tr className="text-left text-surface-500">
                <th className="p-2">Date</th>
                <th className="p-2">Truck</th>
                <th className="p-2">Route</th>
                <th className="p-2 text-right">Loads</th>
                <th className="p-2 text-right">Tons</th>
                <th className="p-2 text-right">Revenue</th>
                <th className="p-2 text-right">Est. diesel (L)</th>
                <th className="p-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((d) => (
                <tr key={d.id} className="border-t border-surface-100">
                  <td className="p-2">{fmtDate(d.delivery_date)}</td>
                  <td className="p-2 font-medium">{d.truck_registration}</td>
                  <td className="p-2">{d.route_name || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{d.completed_deliveries}</td>
                  <td className="p-2 text-right tabular-nums">{d.tons != null ? Number(d.tons).toFixed(2) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{fmtZar(d.revenue_amount)}</td>
                  <td className="p-2 text-right tabular-nums text-rose-700">{d.estimated_fuel_litres != null ? Number(d.estimated_fuel_litres).toFixed(1) : '—'}</td>
                  <td className="p-2 text-surface-500">{d.source_type === 'command_centre' ? 'Command Centre' : d.source_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TrialBalanceSection({ filters, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('route');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lfApi.ledger.trialBalance(filters);
      setData(r);
    } catch (e) {
      onError?.(e?.message || 'Failed to load trial balance');
    } finally {
      setLoading(false);
    }
  }, [filters, onError]);

  useEffect(() => { load(); }, [load]);

  const rows = view === 'route' ? data?.by_route : data?.by_truck;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Completed deliveries', value: data?.totals?.completed_deliveries ?? '—' },
          { label: 'Revenue', value: fmtZar(data?.totals?.revenue) },
          { label: 'Diesel cost', value: fmtZar(data?.totals?.diesel_cost) },
          { label: 'Net margin', value: fmtZar(data?.totals?.net_margin) },
        ].map((k) => (
          <div key={k.label} className="app-glass-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-surface-500">{k.label}</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setView('route')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${view === 'route' ? 'bg-brand-600 text-white' : 'border border-surface-300'}`}>By route</button>
        <button type="button" onClick={() => setView('truck')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${view === 'truck' ? 'bg-brand-600 text-white' : 'border border-surface-300'}`}>By truck</button>
        <button type="button" onClick={load} className="text-sm text-brand-600 font-medium ml-auto">Refresh</button>
      </div>

      <div className="app-glass-card overflow-x-auto">
        {loading ? <p className="p-6 text-sm text-surface-500">Calculating trial balance…</p> : (
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-surface-50">
              <tr className="text-left text-surface-500 uppercase tracking-wide">
                <th className="p-2">{view === 'route' ? 'Route' : 'Truck'}</th>
                <th className="p-2 text-right">Deliveries</th>
                <th className="p-2 text-right">Revenue</th>
                <th className="p-2 text-right">Diesel L</th>
                <th className="p-2 text-right">Diesel R</th>
                <th className="p-2 text-right">Other exp.</th>
                <th className="p-2 text-right">L / delivery</th>
                <th className="p-2 text-right">Net</th>
                <th className="p-2 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.key} className="border-t border-surface-100">
                  <td className="p-2 font-medium">{view === 'route' ? (r.route_name || r.label) : (r.truck_registration || r.label)}</td>
                  <td className="p-2 text-right tabular-nums">{r.completed_deliveries}</td>
                  <td className="p-2 text-right tabular-nums text-emerald-700">{fmtZar(r.revenue)}</td>
                  <td className="p-2 text-right tabular-nums">{r.diesel_litres?.toFixed?.(1) ?? r.diesel_litres}</td>
                  <td className="p-2 text-right tabular-nums text-rose-600">{fmtZar(r.diesel_cost)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtZar(r.other_expense)}</td>
                  <td className="p-2 text-right tabular-nums">{r.litres_per_delivery ?? '—'}</td>
                  <td className={`p-2 text-right tabular-nums font-semibold ${(r.net_margin ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtZar(r.net_margin)}</td>
                  <td className="p-2 text-right tabular-nums">{r.margin_percent != null ? `${r.margin_percent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function DeliveryActivityLedgerPanel({
  filters,
  onFiltersChange,
  routes,
  trucks,
  onError,
  onSuccess,
  onDataChange,
}) {
  const [section, setSection] = useState('diesel');
  const [context, setContext] = useState(null);

  useEffect(() => {
    lfApi.ledger.context().then(setContext).catch(() => {});
  }, []);

  const notifyChange = useMemo(() => () => onDataChange?.(), [onDataChange]);

  const wrapSuccess = (msg) => {
    onSuccess?.(msg);
    notifyChange();
  };

  return (
    <div className="space-y-4 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Delivery Activity Ledger</h2>
        <InfoHint title="Logistics accounting" text="Capture diesel and truck expenses against fleet units, import completed deliveries from Command Centre, and run a trial balance of revenue vs diesel usage per route." />
      </div>
      <SectionNav section={section} setSection={setSection} />
      {onFiltersChange && (
        <LedgerFilterBar filters={filters} onChange={onFiltersChange} routes={routes} trucks={trucks} />
      )}
      <div className="flex-1 min-h-0">
        {section === 'diesel' && <DieselSection context={context} filters={filters} onError={onError} onSuccess={wrapSuccess} />}
        {section === 'expenses' && <ExpensesSection context={context} filters={filters} onError={onError} onSuccess={wrapSuccess} />}
        {section === 'deliveries' && <DeliveriesSection filters={filters} onError={onError} onSuccess={wrapSuccess} />}
        {section === 'trial' && <TrialBalanceSection filters={filters} onError={onError} />}
      </div>
    </div>
  );
}
