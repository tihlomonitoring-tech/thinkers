import { useState, useMemo, useEffect, useCallback } from 'react';
import { officeAdmin } from '../../api';
import { CONSUMABLE_CATEGORIES } from '../../lib/officeAdminTabs.js';
import {
  downloadConsumableTemplate,
  exportConsumablesExcel,
  exportConsumablesPdf,
} from '../../lib/officeAdminExports.js';

const inputClass =
  'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900 dark:border-surface-600';
const btnPrimary =
  'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
const btnSecondary =
  'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50 dark:border-surface-600 dark:hover:bg-surface-800';

const UNIT_OPTIONS = ['unit', 'bag', 'box', 'pack', 'bottle', 'carton', 'kg', 'g', 'litre', 'ml', 'sachet', 'roll'];

const CAPACITY_UNITS = ['', 'g', 'kg', 'ml', 'L', 'unit', 'pack', 'sachet'];

function dateInput(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return s.length === 10 ? s : '';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function categoryLabel(value) {
  return CONSUMABLE_CATEGORIES.find((c) => c.value === value)?.label || value || '—';
}

export function emptyConsumableForm() {
  return {
    name: '',
    category: 'coffee',
    unit: 'unit',
    quantity_on_hand: '',
    reorder_level: '5',
    max_stock_level: '',
    unit_cost: '',
    brand: '',
    sku: '',
    storage_location: '',
    purchase_location: '',
    supplier_name: '',
    capacity: '',
    capacity_amount: '',
    capacity_unit: '',
    last_purchase_date: '',
    last_purchase_price: '',
    restock_date: '',
    expiry_date: '',
    opened_date: '',
    is_perishable: false,
    batch_number: '',
    notes: '',
    budget_id: '',
    budget_category_id: '',
    budget_line_item_id: '',
    post_purchase_to_journal: true,
  };
}

function itemToForm(c) {
  if (!c) return emptyConsumableForm();
  return {
    name: c.name || '',
    category: c.category || 'other',
    unit: c.unit || 'unit',
    quantity_on_hand: c.quantity_on_hand != null ? String(c.quantity_on_hand) : '',
    reorder_level: c.reorder_level != null ? String(c.reorder_level) : '',
    max_stock_level: c.max_stock_level != null ? String(c.max_stock_level) : '',
    unit_cost: c.unit_cost != null ? String(c.unit_cost) : '',
    brand: c.brand || '',
    sku: c.sku || '',
    storage_location: c.storage_location || '',
    purchase_location: c.purchase_location || '',
    supplier_name: c.supplier_name || '',
    capacity: c.capacity || '',
    capacity_amount: c.capacity_amount != null ? String(c.capacity_amount) : '',
    capacity_unit: c.capacity_unit || '',
    last_purchase_date: dateInput(c.last_purchase_date),
    last_purchase_price: c.last_purchase_price != null ? String(c.last_purchase_price) : '',
    restock_date: dateInput(c.restock_date),
    expiry_date: dateInput(c.expiry_date),
    opened_date: dateInput(c.opened_date),
    is_perishable: Boolean(c.is_perishable),
    batch_number: c.batch_number || '',
    notes: c.notes || '',
    budget_id: c.budget_id != null ? String(c.budget_id) : '',
    budget_category_id: c.budget_category_id != null ? String(c.budget_category_id) : '',
    budget_line_item_id: c.budget_line_item_id != null ? String(c.budget_line_item_id) : '',
    post_purchase_to_journal: true,
  };
}

function buildPayload(form) {
  const p = { ...form };
  ['quantity_on_hand', 'reorder_level', 'max_stock_level', 'unit_cost', 'capacity_amount', 'last_purchase_price'].forEach(
    (k) => {
      if (p[k] === '') p[k] = null;
    }
  );
  ['last_purchase_date', 'restock_date', 'expiry_date', 'opened_date'].forEach((k) => {
    if (!p[k]) p[k] = null;
  });
  ['budget_id', 'budget_category_id', 'budget_line_item_id', 'accounting_item_id'].forEach((k) => {
    if (!p[k]) p[k] = null;
  });
  p.is_perishable = Boolean(p.is_perishable);
  if (!p.capacity && p.capacity_amount && p.capacity_unit) {
    p.capacity = `${p.capacity_amount} ${p.capacity_unit}`.trim();
  }
  p.post_purchase_to_journal = Boolean(p.post_purchase_to_journal);
  return p;
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`text-sm block ${className}`}>
      <span className="text-xs text-surface-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function isLowStock(c) {
  return Number(c.quantity_on_hand) <= Number(c.reorder_level);
}

function isExpirySoon(c) {
  if (!c.expiry_date) return false;
  const exp = new Date(c.expiry_date);
  const now = new Date();
  const days = (exp - now) / (1000 * 60 * 60 * 24);
  return days <= 30;
}

function isExpired(c) {
  if (!c.expiry_date) return false;
  return new Date(c.expiry_date) < new Date(new Date().toDateString());
}

export default function OfficeAdminConsumables({ consumables, onReload, onError, onFlash }) {
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyConsumableForm());
  const [selectedId, setSelectedId] = useState(null);
  const [detailForm, setDetailForm] = useState(emptyConsumableForm());
  const [saving, setSaving] = useState(false);
  const [budgets, setBudgets] = useState([]);
  const [budgetCategories, setBudgetCategories] = useState([]);
  const [budgetLineItems, setBudgetLineItems] = useState([]);
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [budgetsError, setBudgetsError] = useState('');

  const loadBudgets = useCallback(() => {
    setBudgetsLoading(true);
    setBudgetsError('');
    return officeAdmin.accounting
      .budgetsForLinking()
      .then((d) => {
        const list = (d.budgets || []).map((b) => ({
          ...b,
          id: b.id != null ? String(b.id) : '',
          department_name: b.department_name ?? b.Department_name ?? '',
          fiscal_year: b.fiscal_year ?? b.Fiscal_year,
          status: b.status ?? b.Status ?? '',
        }));
        setBudgets(list);
        return list;
      })
      .catch((e) => {
        setBudgets([]);
        setBudgetsError(e.message || 'Could not load department budgets.');
        onError(e.message || 'Could not load department budgets.');
        return [];
      })
      .finally(() => setBudgetsLoading(false));
  }, [onError]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  useEffect(() => {
    if (showAddForm) loadBudgets();
  }, [showAddForm, loadBudgets]);

  const loadBudgetDetails = useCallback(async (budgetId) => {
    if (!budgetId) {
      setBudgetCategories([]);
      setBudgetLineItems([]);
      return;
    }
    try {
      const det = await officeAdmin.accounting.getBudget(budgetId);
      setBudgetCategories(
        (det.categories || []).map((c) => ({
          ...c,
          id: c.id != null ? String(c.id) : '',
          category_name: c.category_name ?? c.Category_name ?? '',
        }))
      );
      setBudgetLineItems(
        (det.lineItems || []).map((l) => ({
          ...l,
          id: l.id != null ? String(l.id) : '',
          category_id: l.category_id != null ? String(l.category_id) : '',
          description: l.description ?? l.Description ?? '',
        }))
      );
    } catch {
      setBudgetCategories([]);
      setBudgetLineItems([]);
    }
  }, []);

  const handleBudgetChange = (budgetId, setValues) => {
    setValues((f) => ({
      ...f,
      budget_id: budgetId,
      budget_category_id: '',
      budget_line_item_id: '',
    }));
    loadBudgetDetails(budgetId);
  };

  useEffect(() => {
    const budgetId = selectedId ? detailForm.budget_id : showAddForm ? form.budget_id : '';
    if (budgetId) loadBudgetDetails(budgetId);
  }, [selectedId, detailForm.budget_id, showAddForm, form.budget_id, loadBudgetDetails]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return consumables;
    return consumables.filter((c) => {
      const hay = [
        c.name,
        c.brand,
        c.category,
        c.sku,
        c.storage_location,
        c.purchase_location,
        c.supplier_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [consumables, search]);

  const openDetail = (c) => {
    setSelectedId(c.id);
    setDetailForm(itemToForm(c));
    onError('');
  };

  const saveDetail = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const r = await officeAdmin.consumables.update(selectedId, buildPayload(detailForm));
      if (r.consumable) setDetailForm(itemToForm(r.consumable));
      onFlash(
        r.journal?.journalPosted
          ? 'Item updated and purchase posted to expense journal.'
          : 'Item updated.'
      );
      onReload();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const r = await officeAdmin.consumables.create(buildPayload(form));
      onFlash(
        r.journal?.journalPosted
          ? `Added ${r.consumable?.name || 'item'} and posted purchase to expense journal.`
          : `Added ${r.consumable?.name || 'item'}.`
      );
      setForm(emptyConsumableForm());
      setShowAddForm(false);
      onReload();
      if (r.consumable?.id) openDetail(r.consumable);
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const renderFormFields = (values, setValues) => (
  <>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="Item name *">
        <input className={inputClass} value={values.name} onChange={(e) => setValues((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Category">
        <select className={inputClass} value={values.category} onChange={(e) => setValues((f) => ({ ...f, category: e.target.value }))}>
          {CONSUMABLE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Brand">
        <input className={inputClass} value={values.brand} onChange={(e) => setValues((f) => ({ ...f, brand: e.target.value }))} />
      </Field>
      <Field label="SKU / product code">
        <input className={inputClass} value={values.sku} onChange={(e) => setValues((f) => ({ ...f, sku: e.target.value }))} />
      </Field>
      <Field label="Unit of measure">
        <select className={inputClass} value={values.unit} onChange={(e) => setValues((f) => ({ ...f, unit: e.target.value }))}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pack size (label)">
        <input
          className={inputClass}
          placeholder="e.g. 1 kg bag"
          value={values.capacity}
          onChange={(e) => setValues((f) => ({ ...f, capacity: e.target.value }))}
        />
      </Field>
      <Field label="Capacity amount">
        <input
          type="number"
          step="0.001"
          className={inputClass}
          value={values.capacity_amount}
          onChange={(e) => setValues((f) => ({ ...f, capacity_amount: e.target.value }))}
        />
      </Field>
      <Field label="Capacity unit">
        <select
          className={inputClass}
          value={values.capacity_unit}
          onChange={(e) => setValues((f) => ({ ...f, capacity_unit: e.target.value }))}
        >
          {CAPACITY_UNITS.map((u) => (
            <option key={u || 'none'} value={u}>
              {u || '—'}
            </option>
          ))}
        </select>
      </Field>
    </div>

    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide pt-2">Stock levels</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="Quantity on hand">
        <input
          type="number"
          step="0.001"
          className={inputClass}
          value={values.quantity_on_hand}
          onChange={(e) => setValues((f) => ({ ...f, quantity_on_hand: e.target.value }))}
        />
      </Field>
      <Field label="Reorder at">
        <input
          type="number"
          step="0.001"
          className={inputClass}
          value={values.reorder_level}
          onChange={(e) => setValues((f) => ({ ...f, reorder_level: e.target.value }))}
        />
      </Field>
      <Field label="Max stock (par level)">
        <input
          type="number"
          step="0.001"
          className={inputClass}
          value={values.max_stock_level}
          onChange={(e) => setValues((f) => ({ ...f, max_stock_level: e.target.value }))}
        />
      </Field>
      <Field label="Storage location">
        <input
          className={inputClass}
          placeholder="e.g. Kitchen cupboard A"
          value={values.storage_location}
          onChange={(e) => setValues((f) => ({ ...f, storage_location: e.target.value }))}
        />
      </Field>
    </div>

    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide pt-2">Purchasing & pricing</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="Unit cost (ZAR)">
        <input
          type="number"
          step="0.01"
          className={inputClass}
          value={values.unit_cost}
          onChange={(e) => setValues((f) => ({ ...f, unit_cost: e.target.value }))}
        />
      </Field>
      <Field label="Last purchase price">
        <input
          type="number"
          step="0.01"
          className={inputClass}
          value={values.last_purchase_price}
          onChange={(e) => setValues((f) => ({ ...f, last_purchase_price: e.target.value }))}
        />
      </Field>
      <Field label="Last purchase date">
        <input
          type="date"
          className={inputClass}
          value={values.last_purchase_date}
          onChange={(e) => setValues((f) => ({ ...f, last_purchase_date: e.target.value }))}
        />
      </Field>
      <Field label="Purchased at / store">
        <input
          className={inputClass}
          placeholder="Shop or supplier branch"
          value={values.purchase_location}
          onChange={(e) => setValues((f) => ({ ...f, purchase_location: e.target.value }))}
        />
      </Field>
      <Field label="Supplier">
        <input
          className={inputClass}
          value={values.supplier_name}
          onChange={(e) => setValues((f) => ({ ...f, supplier_name: e.target.value }))}
        />
      </Field>
    </div>

    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide pt-2">Dates & batch</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="Restock date">
        <input
          type="date"
          className={inputClass}
          value={values.restock_date}
          onChange={(e) => setValues((f) => ({ ...f, restock_date: e.target.value }))}
        />
      </Field>
      <Field label="Expiry date">
        <input
          type="date"
          className={inputClass}
          value={values.expiry_date}
          onChange={(e) => setValues((f) => ({ ...f, expiry_date: e.target.value }))}
        />
      </Field>
      <Field label="Opened date">
        <input
          type="date"
          className={inputClass}
          value={values.opened_date}
          onChange={(e) => setValues((f) => ({ ...f, opened_date: e.target.value }))}
        />
      </Field>
      <Field label="Batch / lot number">
        <input
          className={inputClass}
          value={values.batch_number}
          onChange={(e) => setValues((f) => ({ ...f, batch_number: e.target.value }))}
        />
      </Field>
      <Field label="Perishable item">
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input
            type="checkbox"
            checked={values.is_perishable}
            onChange={(e) => setValues((f) => ({ ...f, is_perishable: e.target.checked }))}
          />
          Track expiry / spoilage
        </label>
      </Field>
    </div>

    <Field label="Notes">
      <textarea
        className={`${inputClass} min-h-[4rem]`}
        value={values.notes}
        onChange={(e) => setValues((f) => ({ ...f, notes: e.target.value }))}
      />
    </Field>

    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide pt-2">Department budget & journal</p>
    <p className="text-xs text-surface-500 -mt-1">
      Link this item to a department budget from Accounting Management. When you record a purchase date and amount, it can
      appear on the expense journal against that budget and category.
    </p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="Department budget">
        <select
          className={inputClass}
          value={values.budget_id}
          onChange={(e) => handleBudgetChange(e.target.value, setValues)}
          disabled={budgetsLoading}
        >
          <option value="">{budgetsLoading ? 'Loading budgets…' : '— Not linked —'}</option>
          {budgets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.department_name} ({b.fiscal_year}{b.status ? ` · ${b.status}` : ''})
            </option>
          ))}
        </select>
        {budgetsError ? <span className="text-xs text-red-600 mt-1 block">{budgetsError}</span> : null}
        {!budgetsLoading && !budgetsError && budgets.length === 0 ? (
          <span className="text-xs text-amber-700 mt-1 block">
            No department budgets found. Create one under Accounting Management → Department budget, then refresh this
            page.
          </span>
        ) : null}
      </Field>
      {values.budget_id && budgetCategories.length > 0 && (
        <Field label="Budget category">
          <select
            className={inputClass}
            value={values.budget_category_id}
            onChange={(e) => setValues((f) => ({ ...f, budget_category_id: e.target.value, budget_line_item_id: '' }))}
          >
            <option value="">— Select category —</option>
            {budgetCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.category_name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {values.budget_id && budgetLineItems.length > 0 && (
        <Field label="Budget line item (optional)">
          <select
            className={inputClass}
            value={values.budget_line_item_id}
            onChange={(e) => setValues((f) => ({ ...f, budget_line_item_id: e.target.value }))}
          >
            <option value="">— None —</option>
            {budgetLineItems
              .filter((l) => !values.budget_category_id || l.category_id === values.budget_category_id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.description}
                </option>
              ))}
          </select>
        </Field>
      )}
      {values.budget_id && (
        <Field label="Post purchase to journal">
          <label className="flex items-center gap-2 mt-2 text-sm">
            <input
              type="checkbox"
              checked={values.post_purchase_to_journal !== false}
              onChange={(e) => setValues((f) => ({ ...f, post_purchase_to_journal: e.target.checked }))}
            />
            Auto-post when purchase date &amp; price are saved
          </label>
        </Field>
      )}
    </div>
  </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-2 items-center">
        <h2 className="text-xl font-semibold">Coffee, tea & supplies</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => downloadConsumableTemplate()}>
            Template
          </button>
          <button type="button" className={btnSecondary} onClick={() => exportConsumablesExcel(consumables)}>
            Excel
          </button>
          <button type="button" className={btnSecondary} onClick={() => exportConsumablesPdf(consumables)}>
            PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder="Search name, brand, SKU, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={showAddForm ? btnPrimary : btnSecondary}
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? 'Hide add form' : 'Add supply item'}
        </button>
      </div>

      {showAddForm && (
        <div className="app-glass-card p-4 space-y-4">
          <div className="flex flex-wrap justify-between gap-2 items-center">
            <h3 className="text-sm font-semibold">New supply item</h3>
            <button type="button" className={btnSecondary} onClick={() => setShowAddForm(false)}>
              Close
            </button>
          </div>
          {renderFormFields(form, setForm)}
          <button type="button" className={btnPrimary} disabled={saving || !form.name.trim()} onClick={addItem}>
            {saving ? 'Saving…' : 'Save item'}
          </button>
        </div>
      )}

      <div className="app-glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="border-b bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
              <th className="p-3">Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Capacity</th>
              <th className="p-3">On hand</th>
              <th className="p-3">Reorder</th>
              <th className="p-3">Unit cost</th>
              <th className="p-3">Purchased at</th>
              <th className="p-3">Budget</th>
              <th className="p-3">Restock</th>
              <th className="p-3">Expiry</th>
              <th className="p-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const low = isLowStock(c);
              const expSoon = isExpirySoon(c);
              const expired = isExpired(c);
              return (
                <tr
                  key={c.id}
                  className={`border-b cursor-pointer hover:bg-surface-50/80 dark:hover:bg-surface-900/40 ${
                    selectedId === c.id ? 'bg-brand-50/50 dark:bg-brand-950/20' : ''
                  } ${low ? 'bg-amber-50/80 dark:bg-amber-950/20' : ''} ${expired ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}
                  onClick={() => openDetail(c)}
                >
                  <td className="p-3">
                    <span className="font-medium">{c.name}</span>
                    {c.brand ? <span className="block text-xs text-surface-500">{c.brand}</span> : null}
                  </td>
                  <td className="p-3">{categoryLabel(c.category)}</td>
                  <td className="p-3">{c.capacity || (c.capacity_amount ? `${c.capacity_amount} ${c.capacity_unit || ''}`.trim() : '—')}</td>
                  <td className="p-3 tabular-nums">{c.quantity_on_hand}</td>
                  <td className="p-3 tabular-nums">{c.reorder_level}</td>
                  <td className="p-3 tabular-nums">{c.unit_cost != null ? `R ${Number(c.unit_cost).toFixed(2)}` : '—'}</td>
                  <td className="p-3 text-xs max-w-[8rem] truncate" title={c.purchase_location || ''}>
                    {c.purchase_location || '—'}
                  </td>
                  <td className="p-3 text-xs max-w-[10rem]">
                    {c.budget_department ? (
                      <>
                        <span className="block truncate" title={c.budget_department}>
                          {c.budget_department}
                        </span>
                        {c.budget_category_name ? (
                          <span className="block text-surface-500 truncate" title={c.budget_category_name}>
                            {c.budget_category_name}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">{fmtDate(c.restock_date)}</td>
                  <td className={`p-3 whitespace-nowrap ${expSoon || expired ? 'text-red-700 font-medium' : ''}`}>
                    {fmtDate(c.expiry_date)}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="text-xs text-brand-600 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(c);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-surface-500">
                  No items found. Click &quot;Add supply item&quot; to register stock.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <div className="app-glass-card p-5 space-y-4 border-2 border-brand-200/60 dark:border-brand-800/50">
          <div className="flex flex-wrap justify-between gap-2 items-center">
            <h3 className="text-lg font-semibold">Edit supply item</h3>
            <button type="button" className={btnSecondary} onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          {renderFormFields(detailForm, setDetailForm)}
          <button type="button" className={btnPrimary} disabled={saving || !detailForm.name.trim()} onClick={saveDetail}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}
