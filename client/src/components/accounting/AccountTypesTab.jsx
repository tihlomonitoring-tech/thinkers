import { useState, useEffect, useCallback } from 'react';
import { accounting as accountingApi } from '../../api';
import { formatZarDisplay } from '../../lib/accountingLineTotals.js';
import InfoHint from '../InfoHint.jsx';

const ACCOUNT_CLASSES = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

const SUBTYPES = [
  { value: '', label: '—' },
  { value: 'bank', label: 'Bank' },
  { value: 'accounts_receivable', label: 'Accounts receivable' },
  { value: 'accounts_payable', label: 'Accounts payable' },
  { value: 'sales_revenue', label: 'Sales revenue' },
  { value: 'operating_expense', label: 'Operating expense' },
  { value: 'other_income', label: 'Other income' },
  { value: 'vat_output', label: 'VAT output' },
  { value: 'vat_input', label: 'VAT input' },
  { value: 'cost_of_sales', label: 'Cost of sales' },
  { value: 'retained_earnings', label: 'Retained earnings' },
];

const inputClass = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm';
const btnPrimary = 'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50';

const DEFAULT_FIELDS = [
  { key: 'bank_account_id', label: 'Bank (receipts & payments)' },
  { key: 'accounts_receivable_id', label: 'Accounts receivable' },
  { key: 'sales_revenue_id', label: 'Sales revenue' },
  { key: 'accounts_payable_id', label: 'Accounts payable' },
  { key: 'default_expense_account_id', label: 'Default expense' },
  { key: 'default_income_account_id', label: 'Default income' },
  { key: 'vat_output_account_id', label: 'VAT output (payable)' },
  { key: 'vat_input_account_id', label: 'VAT input (recoverable)' },
];

export default function AccountTypesTab() {
  const [accounts, setAccounts] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('chart');
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    account_code: '',
    account_name: '',
    account_class: 'expense',
    account_subtype: '',
    description: '',
    normal_balance: 'debit',
    sort_order: 0,
  });
  const load = useCallback(() => {
    setLoading(true);
    accountingApi.accountTypes
      .list()
      .then((a) => {
        setAccounts(a.accounts || []);
        setDefaults(a.defaults || {});
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditId(null);
    setForm({
      account_code: '',
      account_name: '',
      account_class: 'expense',
      account_subtype: '',
      description: '',
      normal_balance: 'debit',
      sort_order: accounts.length * 10,
    });
    setFormOpen(true);
  };

  const openEdit = (a) => {
    setEditId(a.id);
    setForm({
      account_code: a.account_code || '',
      account_name: a.account_name || '',
      account_class: a.account_class || 'expense',
      account_subtype: a.account_subtype || '',
      description: a.description || '',
      normal_balance: a.normal_balance || 'debit',
      sort_order: a.sort_order ?? 0,
    });
    setFormOpen(true);
  };

  const saveAccount = async () => {
    setSaving(true);
    try {
      if (editId) await accountingApi.accountTypes.update(editId, form);
      else await accountingApi.accountTypes.create(form);
      setFormOpen(false);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaults = async () => {
    setSaving(true);
    try {
      const r = await accountingApi.accountTypes.updateDefaults(defaults);
      setDefaults(r.defaults || defaults);
      alert('Default accounts saved.');
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const accountOptions = accounts.filter((a) => a.is_active !== false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h2 className="text-xl font-semibold text-surface-900">Account types</h2>
          <p className="text-sm text-surface-600 mt-1 max-w-2xl">
            Chart of accounts for double-entry bookkeeping. Invoice payments, expenses, and income post to these accounts
            automatically using your defaults below.
          </p>
        </div>
        <InfoHint text="Standard accounts are created on first visit. Map defaults so paid invoices debit Bank and credit Accounts Receivable, and expenses debit Expense and credit Bank." />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-surface-200 pb-2">
        {[
          { id: 'chart', label: 'Chart of accounts' },
          { id: 'defaults', label: 'Posting defaults' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${subTab === t.id ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-surface-600 hover:bg-surface-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : subTab === 'chart' ? (
        <>
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={openNew}>
              Add account
            </button>
          </div>
          {formOpen && (
            <div className="app-glass-card p-4 space-y-3">
              <h3 className="font-semibold text-sm">{editId ? 'Edit account' : 'New account'}</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="text-sm block">
                  <span className="text-xs text-surface-500">Code *</span>
                  <input className={inputClass} value={form.account_code} onChange={(e) => setForm((f) => ({ ...f, account_code: e.target.value }))} />
                </label>
                <label className="text-sm block sm:col-span-2">
                  <span className="text-xs text-surface-500">Name *</span>
                  <input className={inputClass} value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
                </label>
                <label className="text-sm block">
                  <span className="text-xs text-surface-500">Class</span>
                  <select className={inputClass} value={form.account_class} onChange={(e) => setForm((f) => ({ ...f, account_class: e.target.value }))}>
                    {ACCOUNT_CLASSES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm block">
                  <span className="text-xs text-surface-500">Subtype</span>
                  <select className={inputClass} value={form.account_subtype} onChange={(e) => setForm((f) => ({ ...f, account_subtype: e.target.value }))}>
                    {SUBTYPES.map((s) => (
                      <option key={s.value || 'x'} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm block">
                  <span className="text-xs text-surface-500">Normal balance</span>
                  <select className={inputClass} value={form.normal_balance} onChange={(e) => setForm((f) => ({ ...f, normal_balance: e.target.value }))}>
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={saving} onClick={saveAccount}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="app-glass-card overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b bg-surface-50 text-left text-xs uppercase text-surface-500">
                  <th className="p-3">Code</th>
                  <th className="p-3">Account name</th>
                  <th className="p-3">Class</th>
                  <th className="p-3">Subtype</th>
                  <th className="p-3">Normal</th>
                  <th className="p-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b hover:bg-surface-50/80">
                    <td className="p-3 font-mono text-xs">{a.account_code}</td>
                    <td className="p-3 font-medium">{a.account_name}</td>
                    <td className="p-3 capitalize">{a.account_class}</td>
                    <td className="p-3 text-xs text-surface-600">{a.account_subtype || '—'}</td>
                    <td className="p-3 capitalize">{a.normal_balance}</td>
                    <td className="p-3">
                      <button type="button" className="text-xs text-brand-600" onClick={() => openEdit(a)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : subTab === 'defaults' ? (
        <div className="app-glass-card p-5 space-y-4 max-w-2xl">
          <h3 className="font-semibold text-surface-900">Automatic posting defaults</h3>
          <p className="text-sm text-surface-600">
            When an invoice is marked paid, the system posts: Debit Bank, Credit Accounts Receivable. Expenses (when approved):
            Debit Expense, Credit Bank. Income: Debit Bank, Credit Income.
          </p>
          {DEFAULT_FIELDS.map((f) => (
            <label key={f.key} className="text-sm block">
              <span className="text-xs text-surface-500 block mb-1">{f.label}</span>
              <select
                className={inputClass}
                value={defaults[f.key] || ''}
                onChange={(e) => setDefaults((d) => ({ ...d, [f.key]: e.target.value || null }))}
              >
                <option value="">— Select account —</option>
                {accountOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button type="button" className={btnPrimary} disabled={saving} onClick={saveDefaults}>
            {saving ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
