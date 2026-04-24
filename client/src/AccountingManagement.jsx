import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { todayYmd, toYmdFromDbOrString } from './lib/appTime.js';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import { accounting as accountingApi, openAttachmentWithAuth, downloadAttachmentWithAuth } from './api';
import { getApiBase } from './lib/apiBase.js';
import { buildAccountingPdfFilename } from './lib/accountingDocumentPdfFilename.js';
import InfoHint from './components/InfoHint.jsx';

const NAV_SECTIONS = [
  {
    section: 'Accounting',
    items: [
      { id: 'company-settings', label: 'Company settings', icon: 'settings' },
      { id: 'customer-book', label: 'Customer book', icon: 'users' },
      { id: 'supplier-book', label: 'Supplier book', icon: 'users' },
      { id: 'items-library', label: 'Items library', icon: 'folder' },
      { id: 'quotations', label: 'Quotations', icon: 'document' },
      { id: 'invoices', label: 'Invoices', icon: 'document' },
      { id: 'purchase-orders', label: 'Purchase orders', icon: 'document' },
      { id: 'statements', label: 'Customer statements & other statements', icon: 'statement' },
      { id: 'library', label: 'Library', icon: 'folder' },
    ],
  },
];

function TabIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  switch (name) {
    case 'settings':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'document':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'statement':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'folder':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case 'users':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

async function downloadAccountingCommercialPdf(url, { partyName, reference, issueDate, companyName: companyNameOpt }) {
  let companyName = companyNameOpt;
  if (!companyName) {
    try {
      const c = await accountingApi.companySettings.get();
      companyName = c?.company_name;
    } catch (_) {
      companyName = '';
    }
  }
  const filename = buildAccountingPdfFilename({ partyName, reference, companyName, issueDate });
  await downloadAttachmentWithAuth(url, filename);
}

function CompanySettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    address: '',
    vat_number: '',
    company_registration: '',
    website: '',
    email: '',
    payment_terms: '',
    banking_details: '',
  });
  const [logoUrl, setLogoUrl] = useState(null);
  const logoInputRef = useRef(null);

  useEffect(() => {
    accountingApi.companySettings.get()
      .then((data) => {
        setForm({
          company_name: data.company_name ?? '',
          address: data.address ?? '',
          vat_number: data.vat_number ?? '',
          company_registration: data.company_registration ?? '',
          website: data.website ?? '',
          email: data.email ?? '',
          payment_terms: data.payment_terms ?? '',
          banking_details: data.banking_details ?? '',
        });
        setLogoUrl(data.logo_url ? accountingApi.companySettings.logoUrl() + '?t=' + Date.now() : null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    accountingApi.companySettings.update(form)
      .then(() => {})
      .finally(() => setSaving(false));
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    accountingApi.companySettings.uploadLogo(file)
      .then(() => setLogoUrl(accountingApi.companySettings.logoUrl() + '?t=' + Date.now()))
      .finally(() => {
        setUploadingLogo(false);
        if (logoInputRef.current) logoInputRef.current.value = '';
      });
  };

  if (loading) return <div className="p-4 text-surface-500">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Company settings</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Logo</label>
          <div className="flex items-center gap-4">
            {logoUrl && (
              <img src={logoUrl} alt="Company logo" className="h-16 w-auto object-contain rounded border border-surface-200" />
            )}
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleLogoChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className="px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-700 text-sm hover:bg-surface-50 disabled:opacity-50"
              >
                {uploadingLogo ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
              </button>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Company name</label>
          <input name="company_name" value={form.company_name} onChange={handleChange} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="Company name" />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Address</label>
          <textarea name="address" value={form.address} onChange={handleChange} rows={3} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="Address" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">VAT number</label>
            <input name="vat_number" value={form.vat_number} onChange={handleChange} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="VAT number" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Company registration</label>
            <input name="company_registration" value={form.company_registration} onChange={handleChange} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="Company registration" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Website</label>
            <input name="website" value={form.website} onChange={handleChange} type="url" className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="https://..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Email</label>
            <input name="email" value={form.email} onChange={handleChange} type="email" className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="email@company.com" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Payment terms</label>
          <p className="text-xs text-surface-500 mb-1">Shown on quotation, invoice and purchase order PDFs (e.g. Net 30, due on receipt).</p>
          <textarea name="payment_terms" value={form.payment_terms} onChange={handleChange} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500" placeholder="e.g. Payment due within 30 days of invoice date." />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Banking details</label>
          <p className="text-xs text-surface-500 mb-1">Shown on PDFs — bank name, account number, branch code, etc.</p>
          <textarea name="banking_details" value={form.banking_details} onChange={handleChange} rows={5} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500 font-mono text-sm" placeholder={'Bank: …\nAccount: …\nBranch code: …'} />
        </div>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}

function PlaceholderTab({ title, description }) {
  return (
    <div className="max-w-xl p-6 rounded-xl bg-white border border-surface-200 shadow-sm">
      <h2 className="text-lg font-semibold text-surface-900 mb-2">{title}</h2>
      <p className="text-surface-600">{description}</p>
      <p className="text-surface-500 text-sm mt-4">PDF download, view, email with To/CC from system, and styled documents will be added here.</p>
    </div>
  );
}

function CustomerBookTab() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '', vat_number: '', company_registration: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    accountingApi.customers.list()
      .then((d) => setCustomers(d.customers || []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  const openNew = () => {
    setEditingId(null);
    setForm({ name: '', address: '', email: '', phone: '', vat_number: '', company_registration: '' });
    setFormOpen(true);
  };
  const openEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name ?? '',
      address: c.address ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      vat_number: c.vat_number ?? '',
      company_registration: c.company_registration ?? '',
    });
    setFormOpen(true);
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!(form.name && form.name.trim())) return;
    setSaving(true);
    const payload = { name: form.name.trim(), address: form.address || '', email: form.email || '', phone: form.phone || '', vat_number: form.vat_number || '', company_registration: form.company_registration || '' };
    (editingId
      ? accountingApi.customers.update(editingId, payload)
      : accountingApi.customers.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .finally(() => setSaving(false));
  };
  const handleDelete = (id) => {
    if (!window.confirm('Delete this customer?')) return;
    accountingApi.customers.delete(id).then(load).catch((err) => alert(err?.message || 'Delete failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Customer book</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Add customer</button>
      </div>
      <p className="text-surface-600 text-sm">Create and manage customers with full details, address, VAT number and company registration for use on quotations and invoices.</p>
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit customer' : 'New customer'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Address</label>
              <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">VAT number</label>
                <input value={form.vat_number} onChange={(e) => setForm((f) => ({ ...f, vat_number: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Company registration</label>
                <input value={form.company_registration} onChange={(e) => setForm((f) => ({ ...f, company_registration: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No customers yet. Add a customer to use in quotations and invoices.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Name</th>
                <th className="text-left p-3 font-medium text-surface-700">Email</th>
                <th className="text-left p-3 font-medium text-surface-700">VAT / Reg</th>
                <th className="w-24 p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">{c.name}</td>
                  <td className="p-3 text-surface-600">{c.email || '—'}</td>
                  <td className="p-3 text-surface-600">{(c.vat_number || c.company_registration) ? [c.vat_number, c.company_registration].filter(Boolean).join(' / ') : '—'}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => openEdit(c)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button type="button" onClick={() => handleDelete(c.id)} className="text-red-600 hover:text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function supplierRowId(s) {
  if (!s) return '';
  const v = s.id ?? s.Id ?? s.ID;
  return v != null ? String(v) : '';
}

function SupplierBookTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '', vat_number: '', company_registration: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError('');
    accountingApi.suppliers.list()
      .then((d) => setSuppliers(d.suppliers || []))
      .catch((err) => {
        setSuppliers([]);
        setLoadError(err?.message || 'Could not load suppliers');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  const openNew = () => {
    setEditingId(null);
    setForm({ name: '', address: '', email: '', phone: '', vat_number: '', company_registration: '' });
    setFormOpen(true);
  };
  const openEdit = (s) => {
    const sid = supplierRowId(s);
    if (!sid) {
      alert('This supplier has no valid id. Refresh the page or run the supplier book database migration.');
      return;
    }
    setEditingId(sid);
    setForm({
      name: s.name ?? s.Name ?? '',
      address: s.address ?? s.Address ?? '',
      email: s.email ?? s.Email ?? '',
      phone: s.phone ?? s.Phone ?? '',
      vat_number: s.vat_number ?? s.Vat_number ?? '',
      company_registration: s.company_registration ?? s.Company_registration ?? '',
    });
    setFormOpen(true);
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!(form.name && form.name.trim())) return;
    setSaving(true);
    const payload = { name: form.name.trim(), address: form.address || '', email: form.email || '', phone: form.phone || '', vat_number: form.vat_number || '', company_registration: form.company_registration || '' };
    (editingId
      ? accountingApi.suppliers.update(editingId, payload)
      : accountingApi.suppliers.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .catch((err) => alert(err?.message || 'Save failed'))
      .finally(() => setSaving(false));
  };
  const handleDelete = (id) => {
    if (!window.confirm('Delete this supplier?')) return;
    accountingApi.suppliers.delete(id).then(load).catch((err) => alert(err?.message || 'Delete failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Supplier book</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Add supplier</button>
      </div>
      <p className="text-surface-600 text-sm">Create and manage suppliers with full details, address, VAT number and company registration for use on purchase orders.</p>
      {loadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {loadError}. If you have not run the supplier migration yet: <code className="bg-amber-100 px-1 rounded">npm run db:accounting-discount-tax-suppliers-po-statements</code>
        </div>
      )}
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit supplier' : 'New supplier'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Address</label>
              <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">VAT number</label>
                <input value={form.vat_number} onChange={(e) => setForm((f) => ({ ...f, vat_number: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Company registration</label>
                <input value={form.company_registration} onChange={(e) => setForm((f) => ({ ...f, company_registration: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No suppliers yet. Add a supplier to use in purchase orders.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Name</th>
                <th className="text-left p-3 font-medium text-surface-700">Email</th>
                <th className="text-left p-3 font-medium text-surface-700">VAT / Reg</th>
                <th className="w-24 p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {suppliers.map((s, idx) => (
                <tr key={supplierRowId(s) || `supplier-${idx}`} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">{s.name ?? s.Name}</td>
                  <td className="p-3 text-surface-600">{(s.email ?? s.Email) || '—'}</td>
                  <td className="p-3 text-surface-600">{((s.vat_number ?? s.Vat_number) || (s.company_registration ?? s.Company_registration)) ? [s.vat_number ?? s.Vat_number, s.company_registration ?? s.Company_registration].filter(Boolean).join(' / ') : '—'}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => openEdit(s)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button type="button" onClick={() => handleDelete(supplierRowId(s))} className="text-red-600 hover:text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemsLibraryTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ description: '', default_quantity: 1, default_unit_price: 0, discount_percent: 0, tax_percent: 0 });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    accountingApi.items.list()
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  const openNew = () => {
    setEditingId(null);
    setForm({ description: '', default_quantity: 1, default_unit_price: 0, discount_percent: 0, tax_percent: 0 });
    setFormOpen(true);
  };
  const openEdit = (it) => {
    setEditingId(it.id);
    setForm({
      description: it.description ?? '',
      default_quantity: it.default_quantity ?? 1,
      default_unit_price: it.default_unit_price ?? 0,
      discount_percent: it.discount_percent ?? 0,
      tax_percent: it.tax_percent ?? 0,
    });
    setFormOpen(true);
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { description: form.description.trim(), default_quantity: Number(form.default_quantity) || 1, default_unit_price: Number(form.default_unit_price) || 0, discount_percent: Number(form.discount_percent) || 0, tax_percent: Number(form.tax_percent) || 0 };
    (editingId ? accountingApi.items.update(editingId, payload) : accountingApi.items.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .finally(() => setSaving(false));
  };
  const handleDelete = (id) => {
    if (!window.confirm('Delete this item from the library?')) return;
    accountingApi.items.delete(id).then(load).catch((err) => alert(err?.message || 'Delete failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Items library</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Add item</button>
      </div>
      <p className="text-surface-600 text-sm">Reusable line items for quotations, invoices and purchase orders. Use &quot;Add from library&quot; when editing a document to insert an item.</p>
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm w-full max-w-xl">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit item' : 'New item'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Description</label><input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" placeholder="Item description" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Default quantity</label><input type="number" min="0" step="any" value={form.default_quantity} onChange={(e) => setForm((f) => ({ ...f, default_quantity: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Default unit price</label><input type="number" min="0" step="0.01" value={form.default_unit_price} onChange={(e) => setForm((f) => ({ ...f, default_unit_price: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Discount %</label><input type="number" min="0" max="100" step="0.01" value={form.discount_percent} onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Tax %</label><input type="number" min="0" max="100" step="0.01" value={form.tax_percent} onChange={(e) => setForm((f) => ({ ...f, tax_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No items yet. Add items to use in quotations, invoices and purchase orders.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Description</th>
                <th className="text-right p-3 font-medium text-surface-700">Qty</th>
                <th className="text-right p-3 font-medium text-surface-700">Unit price</th>
                <th className="text-right p-3 font-medium text-surface-700">Disc %</th>
                <th className="text-right p-3 font-medium text-surface-700">Tax %</th>
                <th className="w-24 p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">{it.description || '—'}</td>
                  <td className="p-3 text-right text-surface-600">{it.default_quantity}</td>
                  <td className="p-3 text-right text-surface-600">{Number(it.default_unit_price).toFixed(2)}</td>
                  <td className="p-3 text-right text-surface-600">{Number(it.discount_percent) || 0}%</td>
                  <td className="p-3 text-right text-surface-600">{Number(it.tax_percent) || 0}%</td>
                  <td className="p-3">
                    <button type="button" onClick={() => openEdit(it)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button type="button" onClick={() => handleDelete(it.id)} className="text-red-600 hover:text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocumentLinesEditor({ lines, setLines, itemsLibrary = [], vatColumnLabel = 'Tax %' }) {
  const lineList = Array.isArray(lines) ? lines : [];
  const addLine = () => setLines((prev) => [...(Array.isArray(prev) ? prev : []), { description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }]);
  const removeLine = (i) => setLines((prev) => (Array.isArray(prev) ? prev : []).filter((_, idx) => idx !== i));
  const updateLine = (i, field, value) => setLines((prev) => (Array.isArray(prev) ? prev : []).map((l, idx) => idx !== i ? l : { ...l, [field]: value }));

  const addFromLibrary = (item) => {
    setLines((prev) => [...(Array.isArray(prev) ? prev : []), {
      description: item.description ?? '',
      quantity: Number(item.default_quantity) ?? 1,
      unit_price: Number(item.default_unit_price) ?? 0,
      discount_percent: Number(item.discount_percent) ?? 0,
      tax_percent: Number(item.tax_percent) ?? 0,
    }]);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <span className="text-sm font-medium text-surface-700">Line items</span>
        <div className="flex gap-2">
          {itemsLibrary.length > 0 && (
            <select
              className="text-sm rounded border border-surface-200 px-2 py-1.5 bg-white text-surface-700"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const item = itemsLibrary.find((x) => x.id === id);
                if (item) addFromLibrary(item);
                e.target.value = '';
              }}
              aria-label="Add from items library"
            >
              <option value="">— Add from library —</option>
              {itemsLibrary.map((it) => (
                <option key={it.id} value={it.id}>{it.description || '(No description)'} — {Number(it.default_unit_price) || 0}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={addLine} className="text-sm text-brand-600 hover:text-brand-700">+ Add line</button>
        </div>
      </div>
      <div className="border border-surface-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface-50">
            <tr>
              <th className="text-left p-2 font-medium text-surface-600">Description</th>
              <th className="text-right p-2 w-16 font-medium text-surface-600">Qty</th>
              <th className="text-right p-2 w-24 font-medium text-surface-600">Unit price</th>
              <th className="text-right p-2 w-16 font-medium text-surface-600">Disc %</th>
              <th className="text-right p-2 w-16 font-medium text-surface-600">{vatColumnLabel}</th>
              <th className="w-10 p-2" />
            </tr>
          </thead>
          <tbody>
            {lineList.map((line, i) => (
              <tr key={i} className="border-t border-surface-100">
                <td className="p-2"><input value={line.description || ''} onChange={(e) => updateLine(i, 'description', e.target.value)} className="w-full min-w-[120px] px-2 py-1 rounded border border-surface-200" placeholder="" /></td>
                <td className="p-2"><input type="number" min="0" step="any" value={line.quantity ?? 1} onChange={(e) => updateLine(i, 'quantity', e.target.value)} className="w-full px-2 py-1 text-right rounded border border-surface-200" /></td>
                <td className="p-2"><input type="number" min="0" step="0.01" value={line.unit_price ?? 0} onChange={(e) => updateLine(i, 'unit_price', e.target.value)} className="w-full px-2 py-1 text-right rounded border border-surface-200" /></td>
                <td className="p-2"><input type="number" min="0" max="100" step="0.01" value={line.discount_percent ?? 0} onChange={(e) => updateLine(i, 'discount_percent', e.target.value)} className="w-full px-2 py-1 text-right rounded border border-surface-200" /></td>
                <td className="p-2"><input type="number" min="0" max="100" step="0.01" value={line.tax_percent ?? 0} onChange={(e) => updateLine(i, 'tax_percent', e.target.value)} className="w-full px-2 py-1 text-right rounded border border-surface-200" /></td>
                <td className="p-2"><button type="button" onClick={() => removeLine(i)} className="text-red-600 hover:text-red-700">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const QUOTATION_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

function quotationStatusSelectOptions(current) {
  const known = new Set(QUOTATION_STATUSES.map((o) => o.value));
  const out = [];
  if (current && !known.has(String(current))) out.push({ value: current, label: String(current) });
  out.push(...QUOTATION_STATUSES);
  return out;
}

function QuotationsTab() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [itemsLibrary, setItemsLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [viewQuotation, setViewQuotation] = useState(null);
  const [viewMeta, setViewMeta] = useState({ number: '', status: 'draft', date: '' });
  const [viewMetaSaving, setViewMetaSaving] = useState(false);
  const [emailModal, setEmailModal] = useState(null);
  const [form, setForm] = useState({
    number: '',
    customer_id: '',
    customer_name: '',
    customer_address: '',
    customer_email: '',
    date: todayYmd(),
    valid_until: '',
    status: 'draft',
    notes: '',
    discount_percent: 0,
    tax_percent: 0,
    lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
  });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([accountingApi.quotations.list(), accountingApi.customers.list(), accountingApi.quotations.recipients(), accountingApi.items.list()])
      .then(([q, c, r, items]) => {
        setList(q.quotations || []);
        setCustomers(c.customers || []);
        setRecipients(r.recipients || []);
        setItemsLibrary(items.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  useEffect(() => {
    if (!viewId) { setViewQuotation(null); return; }
    accountingApi.quotations.get(viewId).then((d) => setViewQuotation(d.quotation)).catch(() => setViewQuotation(null));
  }, [viewId]);

  useEffect(() => {
    if (!viewQuotation) return;
    setViewMeta({
      number: viewQuotation.number ?? '',
      status: viewQuotation.status ?? 'draft',
      date: viewQuotation.date ? toYmdFromDbOrString(viewQuotation.date) : '',
    });
  }, [viewQuotation]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      number: '',
      customer_id: '',
      customer_name: '',
      customer_address: '',
      customer_email: '',
      date: todayYmd(),
      valid_until: '',
      status: 'draft',
      notes: '',
      discount_percent: 0,
      tax_percent: 0,
      lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
    });
    setFormOpen(true);
  };
  const selectCustomer = (customerId) => {
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setForm((f) => ({ ...f, customer_id: c.id, customer_name: c.name, customer_address: c.address || '', customer_email: c.email || '' }));
  };
  const openEdit = (q) => {
    setEditingId(q.id);
    accountingApi.quotations.get(q.id).then((d) => {
      const qq = d.quotation;
      setForm({
        number: qq.number ?? '',
        customer_id: qq.customer_id || '',
        customer_name: qq.customer_name ?? '',
        customer_address: qq.customer_address ?? '',
        customer_email: qq.customer_email ?? '',
        date: qq.date ? toYmdFromDbOrString(qq.date) : '',
        valid_until: qq.valid_until ? toYmdFromDbOrString(qq.valid_until) : '',
        status: qq.status ?? 'draft',
        notes: qq.notes ?? '',
        discount_percent: qq.discount_percent ?? 0,
        tax_percent: qq.tax_percent ?? 0,
        lines: (qq.lines && qq.lines.length) ? qq.lines.map((l) => ({ description: l.description ?? '', quantity: l.quantity ?? 1, unit_price: l.unit_price ?? 0, discount_percent: l.discount_percent ?? 0, tax_percent: l.tax_percent ?? 0 })) : [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
      });
      setFormOpen(true);
    }).catch(() => {});
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      const ref = String(form.number || '').trim();
      if (!ref) {
        alert('Reference number is required.');
        return;
      }
    }
    setSaving(true);
    const payload = {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      customer_address: form.customer_address,
      customer_email: form.customer_email,
      date: form.date || null,
      valid_until: form.valid_until || null,
      status: form.status,
      notes: form.notes,
      discount_percent: Number(form.discount_percent) || 0,
      tax_percent: Number(form.tax_percent) || 0,
      lines: form.lines.map((l) => ({ ...l, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0 })),
    };
    if (editingId) payload.number = String(form.number || '').trim();
    (editingId ? accountingApi.quotations.update(editingId, payload) : accountingApi.quotations.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .finally(() => setSaving(false));
  };

  const saveViewQuotationMeta = () => {
    if (!viewId) return;
    const ref = String(viewMeta.number || '').trim();
    if (!ref) {
      alert('Reference number cannot be empty.');
      return;
    }
    setViewMetaSaving(true);
    accountingApi.quotations
      .update(viewId, {
        number: ref,
        status: viewMeta.status,
        date: viewMeta.date || null,
      })
      .then((d) => {
        setViewQuotation(d.quotation);
        load();
      })
      .catch((err) => alert(err?.message || 'Failed to update quotation'))
      .finally(() => setViewMetaSaving(false));
  };
  const createInvoiceFromQuotation = (quotationId) => {
    accountingApi.quotations.createInvoice(quotationId)
      .then((d) => { alert(`Invoice ${d.invoice?.number} created.`); load(); })
      .catch((err) => alert(err?.message || 'Failed to create invoice'));
  };
  const openEmailModal = (q) => setEmailModal({ quotation: q, to_emails: [], cc_emails: [], subject: `Quotation ${q.number}`, message: '' });
  const sendQuotationEmail = () => {
    if (!emailModal || emailModal.to_emails.length === 0) return;
    accountingApi.quotations.sendEmail(emailModal.quotation.id, {
      to_emails: emailModal.to_emails,
      cc_emails: emailModal.cc_emails,
      subject: emailModal.subject,
      message: emailModal.message,
    }).then(() => { setEmailModal(null); }).catch((err) => alert(err?.message || 'Send failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Quotations</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">New quotation</button>
      </div>
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm w-full max-w-full">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit quotation' : 'New quotation'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-6xl">
            {editingId && (
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Reference number</label>
                <input
                  value={form.number}
                  onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900"
                  placeholder="e.g. Q-2025-001"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Customer</label>
              <select value={form.customer_id || ''} onChange={(e) => selectCustomer(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                <option value="">— Select from customer book —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Customer name</label>
              <input value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Address</label><textarea value={form.customer_address} onChange={(e) => setForm((f) => ({ ...f, customer_address: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Email</label><input type="email" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Issue date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Valid until</label>
                <input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900"
                >
                  {quotationStatusSelectOptions(form.status).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Discount %</label><input type="number" min="0" max="100" step="0.01" value={form.discount_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Tax %</label><input type="number" min="0" max="100" step="0.01" value={form.tax_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, tax_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <DocumentLinesEditor lines={form.lines} setLines={(linesOrUpdater) => setForm((f) => ({ ...f, lines: typeof linesOrUpdater === 'function' ? linesOrUpdater(Array.isArray(f.lines) ? f.lines : []) : (Array.isArray(linesOrUpdater) ? linesOrUpdater : []) }))} itemsLibrary={itemsLibrary} />
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Email quotation</h3>
            <p className="text-sm text-surface-600 mb-2">To (select from system):</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.to_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, to_emails: e.target.checked ? [...m.to_emails, r.email] : m.to_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-surface-600 mb-2">CC:</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.cc_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, cc_emails: e.target.checked ? [...m.cc_emails, r.email] : m.cc_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={sendQuotationEmail} className="px-4 py-2 rounded-lg bg-brand-600 text-white">Send</button>
              <button type="button" onClick={() => setEmailModal(null)} className="px-4 py-2 rounded-lg border border-surface-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {viewId && viewQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-auto p-6">
            <h3 className="font-semibold text-surface-900 mb-2">Quotation</h3>
            <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-4 mb-4 space-y-3">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wide">Header (save changes)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Reference number</label>
                  <input
                    value={viewMeta.number}
                    onChange={(e) => setViewMeta((m) => ({ ...m, number: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-sm text-surface-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Issue date</label>
                  <input
                    type="date"
                    value={viewMeta.date}
                    onChange={(e) => setViewMeta((m) => ({ ...m, date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-sm text-surface-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Status</label>
                  <select
                    value={viewMeta.status}
                    onChange={(e) => setViewMeta((m) => ({ ...m, status: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-sm text-surface-900"
                  >
                    {quotationStatusSelectOptions(viewMeta.status).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                disabled={viewMetaSaving}
                onClick={saveViewQuotationMeta}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {viewMetaSaving ? 'Saving…' : 'Save reference, date & status'}
              </button>
            </div>
            <p className="text-sm text-surface-600">Customer: {viewQuotation.customer_name_from_book || viewQuotation.customer_name || '—'}</p>
            {viewQuotation.valid_until && (
              <p className="text-sm text-surface-600">Valid until: {formatDate(viewQuotation.valid_until)}</p>
            )}
            <div className="mt-4 border rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-surface-50"><tr><th className="text-left p-2">Description</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Unit price</th><th className="text-right p-2">Disc %</th><th className="text-right p-2">Tax %</th><th className="text-right p-2">Line total</th></tr></thead>
                <tbody>
                  {(viewQuotation.lines || []).map((l, i) => {
                    const qty = Number(l.quantity) || 0;
                    const up = Number(l.unit_price) || 0;
                    const dPct = Number(l.discount_percent) || 0;
                    const tPct = Number(l.tax_percent) || 0;
                    const lineSub = qty * up;
                    const lineDisc = lineSub * (dPct / 100);
                    const lineAfterDisc = lineSub - lineDisc;
                    const lineTax = lineAfterDisc * (tPct / 100);
                    const lineTotal = lineAfterDisc + lineTax;
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2">{l.description}</td>
                        <td className="p-2 text-right">{l.quantity}</td>
                        <td className="p-2 text-right">{l.unit_price}</td>
                        <td className="p-2 text-right">{dPct > 0 ? dPct + '%' : '—'}</td>
                        <td className="p-2 text-right">{tPct > 0 ? tPct + '%' : '—'}</td>
                        <td className="p-2 text-right">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const documentSubtotal = (viewQuotation.lines || []).reduce((s, l) => {
                const qty = Number(l.quantity) || 0;
                const up = Number(l.unit_price) || 0;
                const dPct = Number(l.discount_percent) || 0;
                const tPct = Number(l.tax_percent) || 0;
                const lineSub = qty * up;
                const lineDisc = lineSub * (dPct / 100);
                const lineAfterDisc = lineSub - lineDisc;
                const lineTax = lineAfterDisc * (tPct / 100);
                return s + (lineAfterDisc + lineTax);
              }, 0);
              const dPct = Number(viewQuotation.discount_percent) || 0;
              const tPct = Number(viewQuotation.tax_percent) || 0;
              const discountAmt = documentSubtotal * (dPct / 100);
              const afterDiscount = documentSubtotal - discountAmt;
              const taxAmt = afterDiscount * (tPct / 100);
              const total = afterDiscount + taxAmt;
              return (
                <div className="mt-2 text-sm text-surface-600 space-y-1">
                  <p>Subtotal: {documentSubtotal.toFixed(2)}</p>
                  {dPct > 0 && <p>Discount ({dPct}%): -{discountAmt.toFixed(2)}</p>}
                  {tPct > 0 && <p>Tax ({tPct}%): {taxAmt.toFixed(2)}</p>}
                  <p className="font-semibold text-surface-900">Total: {total.toFixed(2)}</p>
                </div>
              );
            })()}
            <div className="mt-4 flex gap-2 flex-wrap">
              <button type="button" onClick={() => openAttachmentWithAuth(accountingApi.quotations.pdfUrl(viewId))} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">View PDF</button>
              <button
                type="button"
                onClick={() =>
                  downloadAccountingCommercialPdf(accountingApi.quotations.pdfUrl(viewId), {
                    partyName: viewQuotation.customer_name_from_book || viewQuotation.customer_name,
                    reference: viewQuotation.number,
                    issueDate: viewQuotation.date,
                  }).catch((e) => alert(e?.message || 'Download failed'))
                }
                className="px-4 py-2 rounded-lg border border-surface-300 text-sm font-medium text-surface-800 hover:bg-surface-50"
              >
                Download PDF
              </button>
              <button type="button" onClick={() => openEmailModal(viewQuotation)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Email</button>
              <button type="button" onClick={() => createInvoiceFromQuotation(viewQuotation.id)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Create invoice</button>
              <button type="button" onClick={() => setViewId(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No quotations yet. Create one or add customers first from Customer book.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Number</th>
                <th className="text-left p-3 font-medium text-surface-700">Customer</th>
                <th className="text-left p-3 font-medium text-surface-700">Issue date</th>
                <th className="text-left p-3 font-medium text-surface-700">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {list.map((q) => (
                <tr key={q.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">{q.number}</td>
                  <td className="p-3 text-surface-600">{q.customer_display_name}</td>
                  <td className="p-3 text-surface-600">{formatDate(q.date)}</td>
                  <td className="p-3 text-surface-600">{q.status}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setViewId(q.id)} className="text-brand-600 hover:text-brand-700 mr-2">View</button>
                    <button type="button" onClick={() => openEdit(q)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAccountingCommercialPdf(accountingApi.quotations.pdfUrl(q.id), {
                          partyName: q.customer_display_name || q.customer_name,
                          reference: q.number,
                          issueDate: q.date,
                        }).catch((e) => alert(e?.message || 'Download failed'))
                      }
                      className="text-surface-600 hover:text-surface-800 mr-2"
                    >
                      Download PDF
                    </button>
                    <button type="button" onClick={() => createInvoiceFromQuotation(q.id)} className="text-surface-600 hover:text-surface-700 mr-2">Create invoice</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoicesTab() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [itemsLibrary, setItemsLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [form, setForm] = useState({
    number: '',
    customer_id: '',
    customer_name: '',
    customer_address: '',
    customer_email: '',
    date: todayYmd(),
    due_date: '',
    status: 'draft',
    notes: '',
    discount_percent: 0,
    tax_percent: 0,
    is_recurring: false,
    show_issue_date_on_pdf: true,
    lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
  });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [markPaidModal, setMarkPaidModal] = useState(null);
  const [markPaidForm, setMarkPaidForm] = useState({ payment_date: '', payment_reference: '' });
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const pInv = accountingApi.invoices.list().then((inv) => {
      setList(inv.invoices || []);
    });
    const pCust = accountingApi.customers.list().then((c) => {
      setCustomers(c.customers || []);
    });
    const pRec = accountingApi.invoices.recipients().then((r) => {
      setRecipients(r.recipients || []);
    });
    const pItems = accountingApi.items
      .list()
      .then((items) => {
        setItemsLibrary(items.items || []);
      })
      .catch(() => {
        setItemsLibrary([]);
      });
    Promise.all([pInv, pCust, pRec, pItems])
      .catch((err) => {
        console.error(err);
        alert(err?.message || 'Could not load invoices. Check the network tab or restart the API.');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  useEffect(() => {
    if (!viewId) { setViewInvoice(null); return; }
    accountingApi.invoices.get(viewId).then((d) => setViewInvoice(d.invoice)).catch(() => setViewInvoice(null));
  }, [viewId]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      number: '',
      customer_id: '',
      customer_name: '',
      customer_address: '',
      customer_email: '',
      date: todayYmd(),
      due_date: '',
      status: 'draft',
      notes: '',
      discount_percent: 0,
      tax_percent: 0,
      is_recurring: false,
      show_issue_date_on_pdf: true,
      lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
    });
    setFormOpen(true);
    accountingApi.invoices.nextNumber().then((d) => {
      const n = d?.number != null ? String(d.number) : '';
      if (n) setForm((f) => ({ ...f, number: n }));
    }).catch(() => {});
  };
  const selectCustomer = (customerId) => {
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setForm((f) => ({ ...f, customer_id: c.id, customer_name: c.name, customer_address: c.address || '', customer_email: c.email || '' }));
  };
  const openEdit = (inv) => {
    setEditingId(inv.id);
    accountingApi.invoices.get(inv.id).then((d) => {
      const ii = d.invoice;
      setForm({
        number: ii.number != null ? String(ii.number) : '',
        customer_id: ii.customer_id || '',
        customer_name: ii.customer_name ?? '',
        customer_address: ii.customer_address ?? '',
        customer_email: ii.customer_email ?? '',
        date: ii.date ? toYmdFromDbOrString(ii.date) : '',
        due_date: ii.due_date ? toYmdFromDbOrString(ii.due_date) : '',
        status: ii.status ?? 'draft',
        notes: ii.notes ?? '',
        discount_percent: ii.discount_percent ?? 0,
        tax_percent: ii.tax_percent ?? 0,
        is_recurring: !!(ii.is_recurring === true || ii.is_recurring === 1),
        show_issue_date_on_pdf: !(ii.show_issue_date_on_pdf === 0 || ii.show_issue_date_on_pdf === false),
        lines: (ii.lines && ii.lines.length) ? ii.lines.map((l) => ({ description: l.description ?? '', quantity: l.quantity ?? 1, unit_price: l.unit_price ?? 0, discount_percent: l.discount_percent ?? 0, tax_percent: l.tax_percent ?? 0 })) : [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
      });
      setFormOpen(true);
    }).catch(() => {});
  };
  const openMarkPaid = (inv) => {
    setMarkPaidForm({
      payment_date: todayYmd(),
      payment_reference: '',
    });
    setMarkPaidModal(inv);
  };
  const submitMarkPaid = () => {
    if (!markPaidModal) return;
    if (!markPaidForm.payment_date || !String(markPaidForm.payment_reference).trim()) {
      alert('Payment date and reference are required.');
      return;
    }
    setMarkPaidSaving(true);
    const paidInvoiceId = markPaidModal.id;
    accountingApi.invoices
      .markPaid(paidInvoiceId, {
        payment_date: markPaidForm.payment_date,
        payment_reference: markPaidForm.payment_reference.trim(),
      })
      .then(() => {
        setMarkPaidModal(null);
        load();
        if (viewId === paidInvoiceId) {
          accountingApi.invoices.get(viewId).then((d) => setViewInvoice(d.invoice)).catch(() => {});
        }
      })
      .catch((err) => alert(err?.message || 'Could not record payment'))
      .finally(() => setMarkPaidSaving(false));
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      customer_address: form.customer_address,
      customer_email: form.customer_email,
      date: form.date || null,
      due_date: form.due_date || null,
      status: form.status,
      notes: form.notes,
      discount_percent: Number(form.discount_percent) || 0,
      tax_percent: Number(form.tax_percent) || 0,
      is_recurring: !!form.is_recurring,
      show_issue_date_on_pdf: !!form.show_issue_date_on_pdf,
      lines: form.lines.map((l) => ({ ...l, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0 })),
    };
    const numTrim = String(form.number ?? '').trim();
    if (editingId) {
      payload.number = numTrim;
    } else if (numTrim) {
      payload.number = numTrim;
    }
    (editingId ? accountingApi.invoices.update(editingId, payload) : accountingApi.invoices.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .catch((err) => alert(err?.message || 'Could not save invoice'))
      .finally(() => setSaving(false));
  };
  const openEmailModal = (inv) => setEmailModal({ invoice: inv, to_emails: [], cc_emails: [], subject: `Tax invoice ${inv.number}`, message: '' });
  const sendInvoiceEmail = () => {
    if (!emailModal || emailModal.to_emails.length === 0) return;
    accountingApi.invoices.sendEmail(emailModal.invoice.id, {
      to_emails: emailModal.to_emails,
      cc_emails: emailModal.cc_emails,
      subject: emailModal.subject,
      message: emailModal.message,
    }).then(() => { setEmailModal(null); }).catch((err) => alert(err?.message || 'Send failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Invoices</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">New invoice</button>
      </div>
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm w-full max-w-full">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit invoice' : 'New invoice'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-6xl">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Invoice number</label>
              <input
                value={form.number ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900"
                placeholder={editingId ? '' : 'Suggested number — edit if needed'}
                maxLength={50}
              />
              {!editingId && <p className="text-xs text-surface-500 mt-1">Clear the field to let the system assign the next number on save.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Customer</label>
              <select value={form.customer_id || ''} onChange={(e) => selectCustomer(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                <option value="">— Select from customer book —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Customer name</label><input value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Address</label><textarea value={form.customer_address} onChange={(e) => setForm((f) => ({ ...f, customer_address: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Email</label><input type="email" value={form.customer_email} onChange={(e) => setForm((f) => ({ ...f, customer_email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Issue date</label><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Due date</label><input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 text-sm text-surface-800 cursor-pointer">
                <input type="checkbox" checked={!!form.show_issue_date_on_pdf} onChange={(e) => setForm((f) => ({ ...f, show_issue_date_on_pdf: e.target.checked }))} className="rounded border-surface-300" />
                Show issue date on PDF
              </label>
            </div>
            {form.status === 'paid' ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <p className="font-medium">This invoice is marked paid.</p>
                <p className="text-emerald-800 mt-1">Changing status below away from <strong>Paid</strong> will clear the payment date and reference.</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                  {form.status === 'paid' ? <option value="paid">Paid</option> : null}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-sm text-surface-800 cursor-pointer">
                  <input type="checkbox" checked={!!form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} className="rounded border-surface-300" />
                  Recurring invoice
                </label>
              </div>
            </div>
            <p className="text-xs text-surface-500 -mt-2">Use <strong>Mark paid</strong> on the list to record payment (date + reference). Recurring invoices use that short form by design.</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Discount %</label><input type="number" min="0" max="100" step="0.01" value={form.discount_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">VAT %</label><input type="number" min="0" max="100" step="0.01" value={form.tax_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, tax_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <DocumentLinesEditor lines={form.lines} setLines={(linesOrUpdater) => setForm((f) => ({ ...f, lines: typeof linesOrUpdater === 'function' ? linesOrUpdater(Array.isArray(f.lines) ? f.lines : []) : (Array.isArray(linesOrUpdater) ? linesOrUpdater : []) }))} itemsLibrary={itemsLibrary} vatColumnLabel="VAT %" />
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {markPaidModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-1">Record payment</h3>
            <p className="text-sm text-surface-600 mb-4">
              {markPaidModal.is_recurring === true || markPaidModal.is_recurring === 1
                ? 'Recurring invoice — enter payment date and reference only.'
                : 'Enter the date the payment was received and your reference (e.g. bank ref, cheque no.).'}
            </p>
            <p className="text-sm font-medium text-surface-800 mb-2">{markPaidModal.number}</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Payment date</label>
                <input type="date" value={markPaidForm.payment_date} onChange={(e) => setMarkPaidForm((f) => ({ ...f, payment_date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Payment reference</label>
                <input value={markPaidForm.payment_reference} onChange={(e) => setMarkPaidForm((f) => ({ ...f, payment_reference: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" placeholder="e.g. EFT ref, deposit ID" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={markPaidSaving} onClick={submitMarkPaid} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
                {markPaidSaving ? 'Saving…' : 'Mark paid'}
              </button>
              <button type="button" onClick={() => setMarkPaidModal(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Email invoice</h3>
            <p className="text-sm text-surface-600 mb-2">To:</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.to_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, to_emails: e.target.checked ? [...m.to_emails, r.email] : m.to_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-surface-600 mb-2">CC:</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.cc_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, cc_emails: e.target.checked ? [...m.cc_emails, r.email] : m.cc_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={sendInvoiceEmail} className="px-4 py-2 rounded-lg bg-brand-600 text-white">Send</button>
              <button type="button" onClick={() => setEmailModal(null)} className="px-4 py-2 rounded-lg border border-surface-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {viewId && viewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-auto p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Tax invoice {viewInvoice.number}</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {viewInvoice.is_recurring === true || viewInvoice.is_recurring === 1 ? (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">Recurring</span>
              ) : null}
              {String(viewInvoice.status || '').toLowerCase() === 'paid' ? (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Paid</span>
              ) : null}
            </div>
            <p className="text-sm text-surface-600">Customer: {viewInvoice.customer_name_from_book || viewInvoice.customer_name || '—'}</p>
            <p className="text-sm text-surface-600">
              Issue: {formatDate(viewInvoice.date)} · Due: {formatDate(viewInvoice.due_date)}
              {viewInvoice.show_issue_date_on_pdf === 0 || viewInvoice.show_issue_date_on_pdf === false ? (
                <span className="text-surface-500"> · Issue date hidden on PDF</span>
              ) : null}
            </p>
            {String(viewInvoice.status || '').toLowerCase() === 'paid' && (viewInvoice.payment_date || viewInvoice.payment_reference) ? (
              <p className="text-sm text-surface-600 mt-1">
                Paid: {viewInvoice.payment_date ? formatDate(viewInvoice.payment_date) : '—'}
                {viewInvoice.payment_reference ? ` · Ref: ${viewInvoice.payment_reference}` : ''}
              </p>
            ) : null}
            <div className="mt-4 border rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-surface-50"><tr><th className="text-left p-2">Description</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Unit price</th><th className="text-right p-2">Disc %</th><th className="text-right p-2">VAT %</th><th className="text-right p-2">Line total</th></tr></thead>
                <tbody>
                  {(viewInvoice.lines || []).map((l, i) => {
                    const qty = Number(l.quantity) || 0;
                    const up = Number(l.unit_price) || 0;
                    const dPct = Number(l.discount_percent) || 0;
                    const tPct = Number(l.tax_percent) || 0;
                    const lineSub = qty * up;
                    const lineDisc = lineSub * (dPct / 100);
                    const lineAfterDisc = lineSub - lineDisc;
                    const lineTax = lineAfterDisc * (tPct / 100);
                    const lineTotal = lineAfterDisc + lineTax;
                    const desc = (l.description != null ? String(l.description) : '').trim();
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2">{desc}</td>
                        <td className="p-2 text-right">{l.quantity}</td>
                        <td className="p-2 text-right">{l.unit_price}</td>
                        <td className="p-2 text-right">{dPct > 0 ? `${dPct}%` : ''}</td>
                        <td className="p-2 text-right">{tPct > 0 ? `${tPct}%` : ''}</td>
                        <td className="p-2 text-right">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const documentSubtotal = (viewInvoice.lines || []).reduce((s, l) => {
                const qty = Number(l.quantity) || 0;
                const up = Number(l.unit_price) || 0;
                const dPct = Number(l.discount_percent) || 0;
                const tPct = Number(l.tax_percent) || 0;
                const lineSub = qty * up;
                const lineDisc = lineSub * (dPct / 100);
                const lineAfterDisc = lineSub - lineDisc;
                const lineTax = lineAfterDisc * (tPct / 100);
                return s + (lineAfterDisc + lineTax);
              }, 0);
              const dPct = Number(viewInvoice.discount_percent) || 0;
              const tPct = Number(viewInvoice.tax_percent) || 0;
              const discountAmt = documentSubtotal * (dPct / 100);
              const afterDiscount = documentSubtotal - discountAmt;
              const taxAmt = afterDiscount * (tPct / 100);
              const total = afterDiscount + taxAmt;
              return (
                <div className="mt-2 text-sm text-surface-600 space-y-1">
                  <p>Subtotal: {documentSubtotal.toFixed(2)}</p>
                  {dPct > 0 && <p>Discount ({dPct}%): -{discountAmt.toFixed(2)}</p>}
                  {tPct > 0 && <p>VAT ({tPct}%): {taxAmt.toFixed(2)}</p>}
                  <p className="font-semibold text-surface-900">Total: {total.toFixed(2)}</p>
                </div>
              );
            })()}
            <div className="mt-4 flex gap-2 flex-wrap">
              {String(viewInvoice.status || '').toLowerCase() !== 'paid' ? (
                <button type="button" onClick={() => openMarkPaid(viewInvoice)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">Mark paid</button>
              ) : null}
              <button type="button" onClick={() => openAttachmentWithAuth(accountingApi.invoices.pdfUrl(viewId))} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">View PDF</button>
              <button
                type="button"
                onClick={() =>
                  downloadAccountingCommercialPdf(accountingApi.invoices.pdfUrl(viewId), {
                    partyName: viewInvoice.customer_name_from_book || viewInvoice.customer_name,
                    reference: viewInvoice.number,
                    issueDate: viewInvoice.date,
                  }).catch((e) => alert(e?.message || 'Download failed'))
                }
                className="px-4 py-2 rounded-lg border border-surface-300 text-sm font-medium text-surface-800 hover:bg-surface-50"
              >
                Download PDF
              </button>
              <button type="button" onClick={() => openEmailModal(viewInvoice)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Email</button>
              <button type="button" onClick={() => setViewId(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No invoices yet. Create one or create an invoice from a quotation.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Number</th>
                <th className="text-left p-3 font-medium text-surface-700">Customer</th>
                <th className="text-left p-3 font-medium text-surface-700">Date</th>
                <th className="text-left p-3 font-medium text-surface-700">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {list.map((inv) => (
                <tr key={inv.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">
                    <span className="font-medium">{inv.number}</span>
                    {inv.is_recurring === true || inv.is_recurring === 1 ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">Recurring</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-surface-600">{inv.customer_display_name}</td>
                  <td className="p-3 text-surface-600">{formatDate(inv.date)}</td>
                  <td className="p-3 text-surface-600">
                    <span className={String(inv.status || '').toLowerCase() === 'paid' ? 'text-emerald-700 font-medium' : ''}>{inv.status}</span>
                  </td>
                  <td className="p-3">
                    {String(inv.status || '').toLowerCase() !== 'paid' ? (
                      <button type="button" onClick={() => openMarkPaid(inv)} className="text-emerald-700 hover:text-emerald-800 mr-2 font-medium">Mark paid</button>
                    ) : null}
                    <button type="button" onClick={() => setViewId(inv.id)} className="text-brand-600 hover:text-brand-700 mr-2">View</button>
                    <button type="button" onClick={() => openEdit(inv)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAccountingCommercialPdf(accountingApi.invoices.pdfUrl(inv.id), {
                          partyName: inv.customer_display_name || inv.customer_name,
                          reference: inv.number,
                          issueDate: inv.date,
                        }).catch((e) => alert(e?.message || 'Download failed'))
                      }
                      className="text-surface-600 hover:text-surface-800"
                    >
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PurchaseOrdersTab() {
  const [list, setList] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [itemsLibrary, setItemsLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [viewPO, setViewPO] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [form, setForm] = useState({
    supplier_id: '',
    supplier_name: '',
    supplier_address: '',
    supplier_email: '',
    date: todayYmd(),
    due_date: '',
    status: 'draft',
    notes: '',
    discount_percent: 0,
    tax_percent: 0,
    lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
  });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([accountingApi.purchaseOrders.list(), accountingApi.suppliers.list(), accountingApi.purchaseOrders.recipients(), accountingApi.items.list()])
      .then(([po, s, r, items]) => {
        setList(po.purchase_orders || []);
        setSuppliers(s.suppliers || []);
        setRecipients(r.recipients || []);
        setItemsLibrary(items.items || []);
      })
      .catch((err) => {
        setLoadError(err?.message || 'Failed to load purchase orders');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  useEffect(() => {
    if (!viewId) { setViewPO(null); return; }
    accountingApi.purchaseOrders.get(viewId).then((d) => setViewPO(d.purchase_order)).catch(() => setViewPO(null));
  }, [viewId]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      supplier_id: '',
      supplier_name: '',
      supplier_address: '',
      supplier_email: '',
      date: todayYmd(),
      due_date: '',
      status: 'draft',
      notes: '',
      discount_percent: 0,
      tax_percent: 0,
      lines: [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
    });
    setFormOpen(true);
  };
  const selectSupplier = (supplierId) => {
    const s = suppliers.find((x) => x.id === supplierId);
    if (!s) return;
    setForm((f) => ({ ...f, supplier_id: s.id, supplier_name: s.name, supplier_address: s.address || '', supplier_email: s.email || '' }));
  };
  const openEdit = (po) => {
    setEditingId(po.id);
    accountingApi.purchaseOrders.get(po.id).then((d) => {
      const pp = d.purchase_order;
      setForm({
        supplier_id: pp.supplier_id || '',
        supplier_name: pp.supplier_name ?? '',
        supplier_address: pp.supplier_address ?? '',
        supplier_email: pp.supplier_email ?? '',
        date: pp.date ? toYmdFromDbOrString(pp.date) : '',
        due_date: pp.due_date ? toYmdFromDbOrString(pp.due_date) : '',
        status: pp.status ?? 'draft',
        notes: pp.notes ?? '',
        discount_percent: pp.discount_percent ?? 0,
        tax_percent: pp.tax_percent ?? 0,
        lines: (pp.lines && pp.lines.length) ? pp.lines.map((l) => ({ description: l.description ?? '', quantity: l.quantity ?? 1, unit_price: l.unit_price ?? 0, discount_percent: l.discount_percent ?? 0, tax_percent: l.tax_percent ?? 0 })) : [{ description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 0 }],
      });
      setFormOpen(true);
    }).catch(() => {});
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    const lineRows = Array.isArray(form.lines) ? form.lines : [];
    const payload = {
      supplier_id: form.supplier_id || null,
      supplier_name: form.supplier_name,
      supplier_address: form.supplier_address,
      supplier_email: form.supplier_email,
      date: form.date || null,
      due_date: form.due_date || null,
      status: form.status,
      notes: form.notes,
      discount_percent: Number(form.discount_percent) || 0,
      tax_percent: Number(form.tax_percent) || 0,
      lines: lineRows.map((l) => ({ ...l, discount_percent: Number(l.discount_percent) || 0, tax_percent: Number(l.tax_percent) || 0 })),
    };
    (editingId ? accountingApi.purchaseOrders.update(editingId, payload) : accountingApi.purchaseOrders.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .catch((err) => alert(err?.message || 'Could not save purchase order'))
      .finally(() => setSaving(false));
  };
  const openEmailModal = (po) => setEmailModal({ purchaseOrder: po, to_emails: [], cc_emails: [], subject: `Purchase order ${po.number}`, message: '' });
  const sendPOEmail = () => {
    if (!emailModal || emailModal.to_emails.length === 0) return;
    accountingApi.purchaseOrders.sendEmail(emailModal.purchaseOrder.id, {
      to_emails: emailModal.to_emails,
      cc_emails: emailModal.cc_emails,
      subject: emailModal.subject,
      message: emailModal.message,
    }).then(() => { setEmailModal(null); }).catch((err) => alert(err?.message || 'Send failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Purchase orders</h2>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">New purchase order</button>
      </div>
      {loadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>{loadError}</p>
          <p className="mt-2 text-xs text-amber-800">If the database is missing tables or columns, run: <code className="bg-amber-100 px-1 rounded">npm run db:accounting-discount-tax-suppliers-po-statements</code></p>
        </div>
      )}
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm w-full max-w-full">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit purchase order' : 'New purchase order'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-6xl">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Supplier</label>
              <select value={form.supplier_id || ''} onChange={(e) => selectSupplier(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                <option value="">— Select from supplier book —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Supplier name</label><input value={form.supplier_name} onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Address</label><textarea value={form.supplier_address} onChange={(e) => setForm((f) => ({ ...f, supplier_address: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Email</label><input type="email" value={form.supplier_email} onChange={(e) => setForm((f) => ({ ...f, supplier_email: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Due date</label><input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Discount %</label><input type="number" min="0" max="100" step="0.01" value={form.discount_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Tax %</label><input type="number" min="0" max="100" step="0.01" value={form.tax_percent ?? 0} onChange={(e) => setForm((f) => ({ ...f, tax_percent: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div><label className="block text-sm font-medium text-surface-700 mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            <DocumentLinesEditor lines={form.lines} setLines={(linesOrUpdater) => setForm((f) => ({ ...f, lines: typeof linesOrUpdater === 'function' ? linesOrUpdater(Array.isArray(f.lines) ? f.lines : []) : (Array.isArray(linesOrUpdater) ? linesOrUpdater : []) }))} itemsLibrary={itemsLibrary} />
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Email purchase order</h3>
            <p className="text-sm text-surface-600 mb-2">To (select from system):</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.to_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, to_emails: e.target.checked ? [...m.to_emails, r.email] : m.to_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-surface-600 mb-2">CC:</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.cc_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, cc_emails: e.target.checked ? [...m.cc_emails, r.email] : m.cc_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={sendPOEmail} className="px-4 py-2 rounded-lg bg-brand-600 text-white">Send</button>
              <button type="button" onClick={() => setEmailModal(null)} className="px-4 py-2 rounded-lg border border-surface-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {viewId && viewPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-auto p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Purchase order {viewPO.number}</h3>
            <p className="text-sm text-surface-600">Supplier: {viewPO.supplier_name_from_book || viewPO.supplier_name || '—'}</p>
            <p className="text-sm text-surface-600">Date: {formatDate(viewPO.date)} · Due: {formatDate(viewPO.due_date)}</p>
            <div className="mt-4 border rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-surface-50"><tr><th className="text-left p-2">Description</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Unit price</th><th className="text-right p-2">Disc %</th><th className="text-right p-2">Tax %</th><th className="text-right p-2">Line total</th></tr></thead>
                <tbody>
                  {(viewPO.lines || []).map((l, i) => {
                    const qty = Number(l.quantity) || 0;
                    const up = Number(l.unit_price) || 0;
                    const dPct = Number(l.discount_percent) || 0;
                    const tPct = Number(l.tax_percent) || 0;
                    const lineSub = qty * up;
                    const lineDisc = lineSub * (dPct / 100);
                    const lineAfterDisc = lineSub - lineDisc;
                    const lineTax = lineAfterDisc * (tPct / 100);
                    const lineTotal = lineAfterDisc + lineTax;
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2">{l.description}</td>
                        <td className="p-2 text-right">{l.quantity}</td>
                        <td className="p-2 text-right">{l.unit_price}</td>
                        <td className="p-2 text-right">{dPct > 0 ? dPct + '%' : '—'}</td>
                        <td className="p-2 text-right">{tPct > 0 ? tPct + '%' : '—'}</td>
                        <td className="p-2 text-right">{lineTotal.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const documentSubtotal = (viewPO.lines || []).reduce((s, l) => {
                const qty = Number(l.quantity) || 0;
                const up = Number(l.unit_price) || 0;
                const dPct = Number(l.discount_percent) || 0;
                const tPct = Number(l.tax_percent) || 0;
                const lineSub = qty * up;
                const lineDisc = lineSub * (dPct / 100);
                const lineAfterDisc = lineSub - lineDisc;
                const lineTax = lineAfterDisc * (tPct / 100);
                return s + (lineAfterDisc + lineTax);
              }, 0);
              const dPct = Number(viewPO.discount_percent) || 0;
              const tPct = Number(viewPO.tax_percent) || 0;
              const discountAmt = documentSubtotal * (dPct / 100);
              const afterDiscount = documentSubtotal - discountAmt;
              const taxAmt = afterDiscount * (tPct / 100);
              const total = afterDiscount + taxAmt;
              return (
                <div className="mt-2 text-sm text-surface-600 space-y-1">
                  <p>Subtotal: {documentSubtotal.toFixed(2)}</p>
                  {dPct > 0 && <p>Discount ({dPct}%): -{discountAmt.toFixed(2)}</p>}
                  {tPct > 0 && <p>Tax ({tPct}%): {taxAmt.toFixed(2)}</p>}
                  <p className="font-semibold text-surface-900">Total: {total.toFixed(2)}</p>
                </div>
              );
            })()}
            <div className="mt-4 flex gap-2 flex-wrap">
              <button type="button" onClick={() => openAttachmentWithAuth(accountingApi.purchaseOrders.pdfUrl(viewId))} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">View PDF</button>
              <button
                type="button"
                onClick={() =>
                  downloadAccountingCommercialPdf(accountingApi.purchaseOrders.pdfUrl(viewId), {
                    partyName: viewPO.supplier_name_from_book || viewPO.supplier_name,
                    reference: viewPO.number,
                    issueDate: viewPO.date,
                  }).catch((e) => alert(e?.message || 'Download failed'))
                }
                className="px-4 py-2 rounded-lg border border-surface-300 text-sm font-medium text-surface-800 hover:bg-surface-50"
              >
                Download PDF
              </button>
              <button type="button" onClick={() => openEmailModal(viewPO)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Email</button>
              <button type="button" onClick={() => setViewId(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No purchase orders yet. Add suppliers from Supplier book, then create a purchase order.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Number</th>
                <th className="text-left p-3 font-medium text-surface-700">Supplier</th>
                <th className="text-left p-3 font-medium text-surface-700">Date</th>
                <th className="text-left p-3 font-medium text-surface-700">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {list.map((po) => (
                <tr key={po.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-900">{po.number}</td>
                  <td className="p-3 text-surface-600">{po.supplier_display_name}</td>
                  <td className="p-3 text-surface-600">{formatDate(po.date)}</td>
                  <td className="p-3 text-surface-600">{po.status}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setViewId(po.id)} className="text-brand-600 hover:text-brand-700 mr-2">View</button>
                    <button type="button" onClick={() => openEdit(po)} className="text-brand-600 hover:text-brand-700 mr-2">Edit</button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAccountingCommercialPdf(accountingApi.purchaseOrders.pdfUrl(po.id), {
                          partyName: po.supplier_display_name || po.supplier_name,
                          reference: po.number,
                          issueDate: po.date,
                        }).catch((e) => alert(e?.message || 'Download failed'))
                      }
                      className="text-surface-600 hover:text-surface-800"
                    >
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function recomputeStatementBalances(opening, lines) {
  let bal = Number(opening) || 0;
  return (lines || []).map((l) => {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    bal += debit - credit;
    return { ...l, balance_after: Math.round(bal * 100) / 100 };
  });
}

function mapStatementLinesFromApi(lines) {
  return (lines || []).map((l) => ({
    txn_date: l.txn_date ? toYmdFromDbOrString(l.txn_date) : '',
    reference: l.reference ?? '',
    description: l.description ?? '',
    debit: l.debit != null && Number(l.debit) !== 0 ? String(l.debit) : '',
    credit: l.credit != null && Number(l.credit) !== 0 ? String(l.credit) : '',
  }));
}

function StatementsTab() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [viewStatement, setViewStatement] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [importModal, setImportModal] = useState(null);
  const [importSaving, setImportSaving] = useState(false);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [form, setForm] = useState({
    type: 'customer',
    customer_id: '',
    title: '',
    preamble: '',
    content: '',
    statement_ref: '',
    currency: 'ZAR',
    opening_balance: '0',
    statement_date: todayYmd(),
    date_from: '',
    date_to: '',
    lines: [{ txn_date: '', reference: '', description: '', debit: '', credit: '' }],
  });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    accountingApi.customers.list().then((c) => setCustomers(c.customers || [])).catch(() => setCustomers([]));
    accountingApi.statements.recipients().then((r) => setRecipients(r.recipients || [])).catch(() => setRecipients([]));
    accountingApi.statements
      .list()
      .then((st) => setList(st.statements || []))
      .catch((err) => {
        console.error(err);
        alert(
          err?.message ||
            'Could not load statements. Run: npm run db:accounting-discount-tax-suppliers-po-statements then npm run db:accounting-statement-lines'
        );
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  useEffect(() => {
    if (!viewId) { setViewStatement(null); return; }
    accountingApi.statements.get(viewId).then((data) => setViewStatement(data?.statement ?? data)).catch(() => setViewStatement(null));
  }, [viewId]);

  const computedFormLines = recomputeStatementBalances(form.opening_balance, form.lines);
  const closingPreview = computedFormLines.length ? computedFormLines[computedFormLines.length - 1].balance_after : Number(form.opening_balance) || 0;

  const openNew = () => {
    setEditingId(null);
    setForm({
      type: 'customer',
      customer_id: '',
      title: '',
      preamble: '',
      content: '',
      statement_ref: '',
      currency: 'ZAR',
      opening_balance: '0',
      statement_date: todayYmd(),
      date_from: '',
      date_to: '',
      lines: [{ txn_date: '', reference: '', description: '', debit: '', credit: '' }],
    });
    setFormOpen(true);
  };
  const openEdit = (st) => {
    setEditingId(st.id);
    accountingApi.statements.get(st.id).then((data) => {
      const s = data?.statement ?? data;
      setForm({
        type: s.type ?? 'customer',
        customer_id: s.customer_id || '',
        title: s.title ?? '',
        preamble: s.preamble ?? '',
        content: s.content ?? '',
        statement_ref: s.statement_ref ?? '',
        currency: s.currency || 'ZAR',
        opening_balance: s.opening_balance != null ? String(s.opening_balance) : '0',
        statement_date: s.statement_date ? toYmdFromDbOrString(s.statement_date) : '',
        date_from: s.date_from ? toYmdFromDbOrString(s.date_from) : '',
        date_to: s.date_to ? toYmdFromDbOrString(s.date_to) : '',
        lines: (s.lines && s.lines.length)
          ? s.lines.map((l) => ({
            txn_date: l.txn_date ? toYmdFromDbOrString(l.txn_date) : '',
            reference: l.reference ?? '',
            description: l.description ?? '',
            debit: l.debit != null && Number(l.debit) !== 0 ? String(l.debit) : '',
            credit: l.credit != null && Number(l.credit) !== 0 ? String(l.credit) : '',
          }))
          : [{ txn_date: '', reference: '', description: '', debit: '', credit: '' }],
      });
      setFormOpen(true);
    }).catch(() => {});
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    const linesPayload = (form.lines || []).map((l) => ({
      txn_date: l.txn_date || null,
      reference: (l.reference && String(l.reference).trim()) || null,
      description: l.description != null ? String(l.description) : '',
      debit: l.debit !== '' && l.debit != null ? Number(l.debit) : null,
      credit: l.credit !== '' && l.credit != null ? Number(l.credit) : null,
    }));
    const payload = {
      type: form.type,
      customer_id: form.customer_id || null,
      title: form.title,
      preamble: form.preamble,
      content: form.content,
      statement_ref: form.statement_ref || null,
      currency: form.currency || 'ZAR',
      opening_balance: Number(form.opening_balance) || 0,
      statement_date: form.statement_date || null,
      date_from: form.date_from || null,
      date_to: form.date_to || null,
      lines: linesPayload,
    };
    (editingId ? accountingApi.statements.update(editingId, payload) : accountingApi.statements.create(payload))
      .then(() => { setFormOpen(false); load(); })
      .catch((err) => alert(err?.message || 'Save failed'))
      .finally(() => setSaving(false));
  };
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { txn_date: '', reference: '', description: '', debit: '', credit: '' }] }));
  const removeLine = (idx) => setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  const updateLine = (idx, field, val) => setForm((f) => {
    const next = f.lines.map((row, i) => (i === idx ? { ...row, [field]: val } : row));
    return { ...f, lines: next };
  });
  const openEmailModal = (st) => setEmailModal({ statement: st, to_emails: [], cc_emails: [], subject: `Statement: ${st.title || 'Statement'}`, message: '' });
  const sendStatementEmail = () => {
    if (!emailModal || emailModal.to_emails.length === 0) return;
    accountingApi.statements.sendEmail(emailModal.statement.id, {
      to_emails: emailModal.to_emails,
      cc_emails: emailModal.cc_emails,
      subject: emailModal.subject,
      message: emailModal.message,
    }).then(() => { setEmailModal(null); }).catch((err) => alert(err?.message || 'Send failed'));
  };
  const loadCustomerInvoicesFromPeriod = () => {
    if (!form.customer_id || !form.date_from || !form.date_to) {
      alert('Select a customer and set period from / to first.');
      return;
    }
    setInvoicePreviewLoading(true);
    accountingApi.statements
      .previewCustomerInvoices({ customer_id: form.customer_id, date_from: form.date_from, date_to: form.date_to })
      .then((res) => {
        const mapped = mapStatementLinesFromApi(res.lines);
        setForm((f) => ({
          ...f,
          lines: mapped.length ? mapped : [{ txn_date: '', reference: '', description: '', debit: '', credit: '' }],
        }));
        const inv = res.invoices_count ?? 0;
        const pay = res.payment_lines ?? 0;
        alert(
          inv
            ? `Loaded ${inv} invoice(s). ${pay} payment line(s) for paid invoices. Unpaid: charge only · Paid: charge + matching payment credit.`
            : 'No invoices in this period for the selected customer.'
        );
      })
      .catch((err) => alert(err?.message || 'Could not load invoices'))
      .finally(() => setInvoicePreviewLoading(false));
  };
  const runImportInvoices = () => {
    if (!importModal || !editingId) return;
    setImportSaving(true);
    accountingApi.statements
      .importInvoices(editingId, {
        date_from: importModal.date_from,
        date_to: importModal.date_to,
        replace_existing: !!importModal.replace_existing,
      })
      .then((res) => {
        const s = res?.statement;
        if (s && s.lines) {
          setForm((f) => ({
            ...f,
            lines: mapStatementLinesFromApi(s.lines),
            opening_balance: s.opening_balance != null ? String(s.opening_balance) : f.opening_balance,
          }));
        }
        setImportModal(null);
        const inv = res?.imported_count;
        const pay = res?.payment_lines;
        alert(
          inv != null
            ? `${importModal.replace_existing ? 'Replaced lines with' : 'Appended'} ${inv} invoice(s) (${pay ?? 0} payment line(s)).`
            : 'Imported.'
        );
      })
      .catch((err) => alert(err?.message || 'Import failed'))
      .finally(() => setImportSaving(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900">Customer statements & other statements</h2>
          <InfoHint
            title="Statements help"
            text="Build a bank-style statement of account: opening balance, dated lines with reference, debit/credit, and running balance. For customer statements, load invoices and payments from period to populate Paid/Outstanding and payment credits."
          />
        </div>
        <button type="button" onClick={openNew} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">New statement</button>
      </div>
      
      {formOpen && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm w-full max-w-6xl">
          <h3 className="font-medium text-surface-900 mb-4">{editingId ? 'Edit statement' : 'New statement'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                  <option value="customer">Customer statement</option>
                  <option value="other">Other statement</option>
                </select>
              </div>
              {form.type === 'customer' && (
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Customer</label>
                  <select value={form.customer_id || ''} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900">
                    <option value="">— Select customer —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Title</label><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" placeholder="e.g. Statement of account" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-sm font-medium text-surface-700 mb-1">Statement ref.</label><input value={form.statement_ref} onChange={(e) => setForm((f) => ({ ...f, statement_ref: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" placeholder="SOA-2025-001" /></div>
                <div><label className="block text-sm font-medium text-surface-700 mb-1">Currency</label><input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" placeholder="ZAR" /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Opening balance</label><input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Statement date</label><input type="date" value={form.statement_date} onChange={(e) => setForm((f) => ({ ...f, statement_date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Period from</label><input type="date" value={form.date_from} onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
              <div><label className="block text-sm font-medium text-surface-700 mb-1">Period to</label><input type="date" value={form.date_to} onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900" /></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Notes above the transaction table (optional)</label>
              <textarea value={form.preamble} onChange={(e) => setForm((f) => ({ ...f, preamble: e.target.value }))} rows={3} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 text-sm" placeholder="Short note to the customer, shown above the bank-style table on PDF." />
            </div>
            <div className="rounded-lg border border-surface-200 overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-surface-50 border-b border-surface-200">
                <span className="text-sm font-medium text-surface-800">Transactions (debit = charges, credit = payments)</span>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={addLine} className="text-sm px-2 py-1 rounded border border-surface-300 hover:bg-white">+ Add line</button>
                  {form.type === 'customer' && form.customer_id && form.date_from && form.date_to ? (
                    <button
                      type="button"
                      disabled={invoicePreviewLoading}
                      onClick={loadCustomerInvoicesFromPeriod}
                      className="text-sm px-2 py-1 rounded border border-brand-500 bg-brand-50 text-brand-900 hover:bg-brand-100 disabled:opacity-50"
                    >
                      {invoicePreviewLoading ? 'Loading…' : 'Load invoices & payments from period'}
                    </button>
                  ) : null}
                  {editingId && form.type === 'customer' && form.customer_id ? (
                    <button
                      type="button"
                      onClick={() => setImportModal({ date_from: form.date_from || '', date_to: form.date_to || '', replace_existing: false })}
                      className="text-sm px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    >
                      Merge on server…
                    </button>
                  ) : null}
                </div>
              </div>
              <table className="w-full text-xs md:text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-surface-100 text-left text-surface-600">
                    <th className="p-2 w-28">Date</th>
                    <th className="p-2 w-24">Ref</th>
                    <th className="p-2 min-w-[140px]">Description</th>
                    <th className="p-2 w-24 text-right">Debit</th>
                    <th className="p-2 w-24 text-right">Credit</th>
                    <th className="p-2 w-28 text-right">Balance</th>
                    <th className="p-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-emerald-50/80 font-medium text-surface-800">
                    <td className="p-2">—</td>
                    <td className="p-2" colSpan={2}>Opening balance</td>
                    <td className="p-2 text-right">—</td>
                    <td className="p-2 text-right">—</td>
                    <td className="p-2 text-right">{Number(form.opening_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="p-2" />
                  </tr>
                  {computedFormLines.map((row, idx) => (
                    <tr key={idx} className="border-t border-surface-100">
                      <td className="p-1"><input type="date" value={row.txn_date} onChange={(e) => updateLine(idx, 'txn_date', e.target.value)} className="w-full min-w-0 px-1 py-1 border border-surface-200 rounded text-xs" /></td>
                      <td className="p-1"><input value={row.reference} onChange={(e) => updateLine(idx, 'reference', e.target.value)} className="w-full min-w-0 px-1 py-1 border border-surface-200 rounded text-xs" placeholder="Ref" /></td>
                      <td className="p-1"><input value={row.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="w-full min-w-0 px-1 py-1 border border-surface-200 rounded text-xs" placeholder="Description" /></td>
                      <td className="p-1"><input type="number" step="0.01" value={row.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} className="w-full min-w-0 px-1 py-1 border border-surface-200 rounded text-xs text-right" placeholder="0" /></td>
                      <td className="p-1"><input type="number" step="0.01" value={row.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} className="w-full min-w-0 px-1 py-1 border border-surface-200 rounded text-xs text-right" placeholder="0" /></td>
                      <td className="p-2 text-right font-medium text-surface-800">{row.balance_after != null ? row.balance_after.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                      <td className="p-1"><button type="button" onClick={() => removeLine(idx)} className="text-red-600 text-xs hover:underline">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 text-sm text-surface-700 bg-surface-50 border-t border-surface-200">
                <strong>Closing balance (preview):</strong>{' '}
                {closingPreview.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {form.currency || 'ZAR'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Banking details & footer (optional)</label>
              <p className="text-xs text-surface-500 mb-1">Shown after the table on PDF. Start a new line with <code className="bg-surface-100 px-0.5">Banking details</code> to match the legacy layout, or paste your bank text.</p>
              <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={5} className="w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 font-mono text-sm" placeholder={'Banking details\nAccount: …\nBranch: …'} />
            </div>
            <p className="text-xs text-surface-500">Tip: put <code className="bg-surface-100 px-0.5">Balance due: 0.00</code> as the first line in <strong>Banking / footer</strong> to override the PDF banner amount.</p>
            <div className="flex gap-2 flex-wrap">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save statement'}</button>
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </form>
        </div>
      )}
      {importModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-2">Merge invoices on server</h3>
            <p className="text-sm text-surface-600 mb-4">
              Appends invoice lines (debit) and, for <strong>paid</strong> invoices, payment credits with your recorded payment date and reference. Or replace all saved lines with only this period’s activity.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className="block text-xs font-medium text-surface-700 mb-1">From</label><input type="date" value={importModal.date_from} onChange={(e) => setImportModal((m) => ({ ...m, date_from: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300" /></div>
              <div><label className="block text-xs font-medium text-surface-700 mb-1">To</label><input type="date" value={importModal.date_to} onChange={(e) => setImportModal((m) => ({ ...m, date_to: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-surface-300" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-surface-800 mb-4 cursor-pointer">
              <input type="checkbox" checked={!!importModal.replace_existing} onChange={(e) => setImportModal((m) => ({ ...m, replace_existing: e.target.checked }))} className="rounded border-surface-300" />
              Replace all existing lines (do not append)
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={importSaving} onClick={runImportInvoices} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-50">{importSaving ? 'Importing…' : 'Import'}</button>
              <button type="button" onClick={() => setImportModal(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-surface-900 mb-4">Email statement</h3>
            <p className="text-sm text-surface-600 mb-2">To (select from system):</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.to_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, to_emails: e.target.checked ? [...m.to_emails, r.email] : m.to_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-surface-600 mb-2">CC:</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {recipients.map((r) => (
                <label key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.cc_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, cc_emails: e.target.checked ? [...m.cc_emails, r.email] : m.cc_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={sendStatementEmail} className="px-4 py-2 rounded-lg bg-brand-600 text-white">Send</button>
              <button type="button" onClick={() => setEmailModal(null)} className="px-4 py-2 rounded-lg border border-surface-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {viewId && viewStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto p-6">
            <h3 className="font-semibold text-surface-900 mb-4">{viewStatement.title || 'Statement'}</h3>
            <p className="text-sm text-surface-600">Type: {viewStatement.type} · Customer: {viewStatement.customer_name || '—'}</p>
            <p className="text-sm text-surface-600">
              Ref: {viewStatement.statement_ref || '—'} · Currency: {viewStatement.currency || 'ZAR'} · Opening: {viewStatement.opening_balance != null ? Number(viewStatement.opening_balance).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
            </p>
            <p className="text-sm text-surface-600">Statement date: {formatDate(viewStatement.statement_date)} · Period: {formatDate(viewStatement.date_from)} – {formatDate(viewStatement.date_to)}</p>
            {viewStatement.preamble ? <div className="mt-3 p-3 rounded-lg bg-surface-50 text-surface-800 whitespace-pre-wrap text-sm border border-surface-100"><span className="text-xs font-semibold text-surface-500 uppercase">Notes</span><br />{viewStatement.preamble}</div> : null}
            {viewStatement.lines && viewStatement.lines.length > 0 ? (
              <div className="mt-4 border border-surface-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs md:text-sm min-w-[600px]">
                  <thead className="bg-surface-100"><tr><th className="text-left p-2">Date</th><th className="text-left p-2">Ref</th><th className="text-left p-2">Description</th><th className="text-right p-2">Debit</th><th className="text-right p-2">Credit</th><th className="text-right p-2">Balance</th></tr></thead>
                  <tbody>
                    {viewStatement.lines.map((l) => (
                      <tr key={l.id || `${l.sort_order}-${l.description}`} className="border-t border-surface-100">
                        <td className="p-2">{l.txn_date ? formatDate(l.txn_date) : '—'}</td>
                        <td className="p-2">{l.reference || '—'}</td>
                        <td className="p-2">{l.description || '—'}</td>
                        <td className="p-2 text-right">{l.debit != null ? Number(l.debit).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                        <td className="p-2 text-right">{l.credit != null ? Number(l.credit).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                        <td className="p-2 text-right font-medium">{l.balance_after != null ? Number(l.balance_after).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {viewStatement.content ? <div className="mt-4 p-4 rounded-lg bg-surface-50 text-surface-800 whitespace-pre-wrap text-sm"><span className="text-xs font-semibold text-surface-500 uppercase">Banking / footer</span><br />{viewStatement.content}</div> : null}
            <div className="mt-4 flex gap-2 flex-wrap">
              <button type="button" onClick={() => openAttachmentWithAuth(accountingApi.statements.pdfUrl(viewId))} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">View PDF</button>
              <button type="button" onClick={() => openAttachmentWithAuth(accountingApi.statements.excelUrl(viewId))} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Download Excel</button>
              <button type="button" onClick={() => openEmailModal(viewStatement)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Email</button>
              <button type="button" onClick={() => setViewId(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No statements yet. Create a customer or other statement with title, content draft, and dates.</div>
      ) : (
        <div className="border border-surface-200 rounded-lg overflow-hidden bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Type</th>
                <th className="text-left p-3 font-medium text-surface-700">Title</th>
                <th className="text-left p-3 font-medium text-surface-700">Customer</th>
                <th className="text-left p-3 font-medium text-surface-700">Statement date</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {list.map((st) => (
                <tr key={st.id} className="hover:bg-surface-50/50">
                  <td className="p-3 text-surface-600">{st.type}</td>
                  <td className="p-3 text-surface-900">{st.title || '—'}</td>
                  <td className="p-3 text-surface-600">{st.customer_name || '—'}</td>
                  <td className="p-3 text-surface-600">{formatDate(st.statement_date)}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setViewId(st.id)} className="text-brand-600 hover:text-brand-700 mr-2">View</button>
                    <button type="button" onClick={() => openEdit(st)} className="text-brand-600 hover:text-brand-700">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const DOC_TEMPLATE_DEFS = [
  { id: 'company_employment_contract', label: 'Company employment contract' },
  { id: 'normal_contract', label: 'Normal contract' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'termination_letter', label: 'Termination letter' },
  { id: 'nda', label: 'NDA' },
  { id: 'letter_of_intent', label: 'Letter of intent' },
  { id: 'generic_report', label: 'Generic report' },
  { id: 'generic_letter', label: 'Generic letter' },
];

const EMPLOYMENT_CONTRACT_TEMPLATE = `
<h1>EMPLOYMENT CONTRACT</h1>
<p><strong>Between:</strong> [Company Name] ("Employer") and <strong>[Employee Name]</strong> ("Employee").</p>
<h2>1. Appointment</h2>
<p>The Employer appoints the Employee as <strong>[Job Title]</strong> effective from <strong>[Start Date]</strong>.</p>
<h2>2. Duties and Reporting</h2>
<p>The Employee reports to <strong>[Manager Name]</strong> and performs duties assigned from time to time.</p>
<h2>3. Place of Work</h2>
<p>Primary place of work: <strong>[Location]</strong>. Reasonable travel may be required.</p>
<h2>4. Working Hours</h2>
<p>Standard hours: <strong>[Hours]</strong> per week. Overtime applies in line with policy and law.</p>
<h2>5. Remuneration and Benefits</h2>
<p>Salary: <strong>[Amount]</strong> per month before deductions. Benefits: <strong>[Benefits]</strong>.</p>
<h2>6. Leave</h2>
<p>Annual, sick, and family responsibility leave apply according to policy and applicable legislation.</p>
<h2>7. Confidentiality and IP</h2>
<p>The Employee will maintain confidentiality and all work product remains property of the Employer.</p>
<h2>8. Termination</h2>
<p>Either party may terminate with notice per policy and law. Serious misconduct may lead to summary dismissal.</p>
<h2>9. Governing Law</h2>
<p>This contract is governed by the laws of South Africa.</p>
<p>Signed at [City] on [Date].</p>
<p>Employer: ____________________ &nbsp;&nbsp;&nbsp; Employee: ____________________</p>
`;

const SECTION_SNIPPETS = [
  { id: 'scope', label: 'Scope of services', html: '<h2>Scope of Services</h2><p>[Describe deliverables, responsibilities, and limits.]</p>' },
  { id: 'payment', label: 'Payment terms', html: '<h2>Payment Terms</h2><p>[State amount, invoicing cycle, due dates, penalties.]</p>' },
  { id: 'termination', label: 'Termination clause', html: '<h2>Termination</h2><p>[Notice period, breach handling, obligations after termination.]</p>' },
  { id: 'confidentiality', label: 'Confidentiality clause', html: '<h2>Confidentiality</h2><p>[Define confidential information and allowed disclosures.]</p>' },
  { id: 'signoff', label: 'Signature block', html: '<p>Signed at [City] on [Date].</p><p>Employer: ____________________ &nbsp;&nbsp;&nbsp; Employee/Counterparty: ____________________</p>' },
];

const PAGE_BREAK_MARKER_HTML = '<div data-page-break="true" class="doc-page-break-marker"><span>Page break</span></div><p><br /></p>';

function DocumentationTab() {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const chartCanvasRef = useRef(null);
  const paginationMeasureRef = useRef(null);
  const [list, setList] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [emailModal, setEmailModal] = useState(null);
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [chartType, setChartType] = useState('bar');
  const [chartPalette, setChartPalette] = useState('corporate');
  const [chartLabels, setChartLabels] = useState('Q1,Q2,Q3,Q4');
  const [chartValues, setChartValues] = useState('120,180,160,240');
  const [printLayout, setPrintLayout] = useState(false);
  const [layout, setLayout] = useState({
    marginMm: 20,
    fontSizePt: 11,
    letterheadStyle: 'executive',
    brandTheme: 'executive_red',
    showDocTitle: true,
    showDocDate: true,
    showDocRecipient: true,
    showDocSubject: true,
  });
  const [diffState, setDiffState] = useState({ leftVersionId: '', rightVersionId: '', leftHtml: '', rightHtml: '' });
  const [companyDetails, setCompanyDetails] = useState({ company_name: '', address: '', website: '', email: '', phone: '' });
  const [form, setForm] = useState({
    title: 'Employment contract',
    document_type: 'company_employment_contract',
    status: 'draft',
    tags: 'employment,hr',
    subject: 'Employment contract',
    recipient_name: '',
    recipient_email: '',
    cc_emails: '',
    is_template: true,
    content_html: EMPLOYMENT_CONTRACT_TEMPLATE,
    metadata_json: JSON.stringify({ headerTheme: 'world-class', letterhead: true }, null, 2),
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      accountingApi.documentation.list({ q: query || undefined }),
      accountingApi.documentation.recipients(),
      accountingApi.companySettings.get().catch(() => ({})),
    ])
      .then(([d, r, c]) => {
        setList(d.documents || []);
        setRecipients(r.recipients || []);
        setCompanyDetails({
          company_name: c?.company_name || '',
          address: c?.address || '',
          website: c?.website || '',
          email: c?.email || '',
          phone: c?.phone || '',
        });
      })
      .catch(() => {
        setList([]);
        setRecipients([]);
        setCompanyDetails({ company_name: '', address: '', website: '', email: '', phone: '' });
      })
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => load(), [load]);

  const applyHtmlToEditor = (html) => {
    if (editorRef.current) editorRef.current.innerHTML = html || '';
  };

  useEffect(() => {
    // Prevent cursor jumps while typing: sync editor only when content actually differs
    // and the editor is not the active element.
    if (!editorRef.current) return;
    const incoming = form.content_html || '';
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== incoming) applyHtmlToEditor(incoming);
  }, [form.content_html]);

  const command = (cmd, value = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, value);
    setForm((f) => ({ ...f, content_html: editorRef.current.innerHTML }));
  };

  const insertSection = (snippet) => {
    command('insertHTML', `${snippet.html}<p><br /></p>`);
  };

  const moveBlock = (direction) => {
    if (!editorRef.current) return;
    const blocks = Array.from(editorRef.current.querySelectorAll('h1,h2,h3,p,table,ul,ol,img,hr'));
    if (blocks.length < 2) return;
    const target = blocks[blocks.length - 1];
    if (!target?.parentNode) return;
    if (direction === 'up' && target.previousElementSibling) {
      target.parentNode.insertBefore(target, target.previousElementSibling);
    } else if (direction === 'down' && target.nextElementSibling) {
      target.parentNode.insertBefore(target.nextElementSibling, target);
    }
    onEditorInput();
  };

  const renderChartFigure = () => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = chartLabels.split(',').map((s) => s.trim()).filter(Boolean);
    const values = chartValues.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    if (!labels.length || !values.length) return;
    canvas.width = 900;
    canvas.height = 420;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 20px serif';
    ctx.fillText('Business Figure', 24, 32);
    const chartX = 70;
    const chartY = 60;
    const chartW = 780;
    const chartH = 280;
    const max = Math.max(...values, 1);
    ctx.strokeStyle = '#d1d5db';
    ctx.strokeRect(chartX, chartY, chartW, chartH);
    const paletteMap = {
      corporate: ['#1d4ed8', '#0f766e', '#b45309', '#7c3aed', '#dc2626'],
      mono: ['#111827', '#374151', '#4b5563', '#6b7280', '#9ca3af'],
      vibrant: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'],
    };
    const palette = paletteMap[chartPalette] || paletteMap.corporate;
    if (chartType === 'bar') {
      const bw = chartW / values.length * 0.6;
      values.forEach((v, i) => {
        const h = (v / max) * (chartH - 20);
        const x = chartX + i * (chartW / values.length) + (chartW / values.length - bw) / 2;
        const y = chartY + chartH - h;
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillRect(x, y, bw, h);
        ctx.fillStyle = '#374151';
        ctx.font = '12px sans-serif';
        ctx.fillText(labels[i] || `#${i + 1}`, x, chartY + chartH + 16);
      });
    } else if (chartType === 'line') {
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = chartX + (i * chartW) / Math.max(values.length - 1, 1);
        const y = chartY + chartH - (v / max) * (chartH - 20);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else {
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const cx = chartX + chartW / 2;
      const cy = chartY + chartH / 2;
      const r = Math.min(chartW, chartH) / 2 - 16;
      let a = -Math.PI / 2;
      values.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a, a + sweep);
        ctx.closePath();
        ctx.fillStyle = palette[i % palette.length];
        ctx.fill();
        a += sweep;
      });
    }
    const dataUrl = canvas.toDataURL('image/png');
    command('insertImage', dataUrl);
  };

  const insertTemplate = (id) => {
    const templateMap = {
      company_employment_contract: EMPLOYMENT_CONTRACT_TEMPLATE,
      normal_contract: '<h1>SERVICE CONTRACT</h1><p>Parties: [Party A] and [Party B] ...</p>',
      agreement: '<h1>AGREEMENT</h1><p>This agreement is entered into by ...</p>',
      termination_letter: '<h1>NOTICE OF TERMINATION</h1><p>This letter confirms termination effective [Date] ...</p>',
      nda: '<h1>NON-DISCLOSURE AGREEMENT</h1><p>The receiving party agrees to keep confidential information private ...</p>',
      letter_of_intent: '<h1>LETTER OF INTENT</h1><p>This letter confirms intention to ...</p>',
      generic_report: '<h1>REPORT TITLE</h1><p>Executive summary...</p><h2>Findings</h2><p>...</p>',
      generic_letter: '<h1>LETTER</h1><p>Dear [Name],</p><p>...</p>',
    };
    const html = templateMap[id] || '<p></p>';
    setForm((f) => ({ ...f, document_type: id, content_html: html }));
    applyHtmlToEditor(html);
  };

  const onEditorInput = () => {
    if (!editorRef.current) return;
    setForm((f) => ({ ...f, content_html: editorRef.current.innerHTML }));
  };

  const onEditorPaste = (e) => {
    // Keep copied rich formatting (bold headings/lists/underline) when pasting.
    const html = e.clipboardData?.getData('text/html');
    if (!html) return;
    e.preventDefault();
    if (editorRef.current) editorRef.current.focus();
    document.execCommand('insertHTML', false, html);
    onEditorInput();
  };

  const onEditorKeyDown = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'b') { e.preventDefault(); command('bold'); return; }
    if (k === 'u') { e.preventDefault(); command('underline'); return; }
    if (k === 'i') { e.preventDefault(); command('italic'); return; }
    if (k === '7') { e.preventDefault(); command('insertOrderedList'); return; }
    if (k === '8') { e.preventDefault(); command('insertUnorderedList'); }
  };

  const saveDoc = () => {
    setSaving(true);
    const mergedMetadata = (() => {
      try {
        const parsed = JSON.parse(form.metadata_json || '{}');
        return JSON.stringify({ ...parsed, pageLayout: layout }, null, 2);
      } catch {
        return JSON.stringify({ pageLayout: layout }, null, 2);
      }
    })();
    const payload = { ...form, content_html: editorRef.current?.innerHTML || form.content_html, metadata_json: mergedMetadata };
    const req = selectedId ? accountingApi.documentation.update(selectedId, payload) : accountingApi.documentation.create(payload);
    req
      .then((res) => {
        if (!selectedId && res?.id) setSelectedId(res.id);
        load();
      })
      .catch((err) => alert(err?.message || 'Save failed'))
      .finally(() => setSaving(false));
  };

  const openDoc = (id) => {
    accountingApi.documentation.get(id).then((d) => {
      const doc = d.document || d;
      setSelectedId(doc.id);
      setForm({
        title: doc.title || '',
        document_type: doc.document_type || 'generic_letter',
        status: doc.status || 'draft',
        tags: doc.tags || '',
        subject: doc.subject || '',
        recipient_name: doc.recipient_name || '',
        recipient_email: doc.recipient_email || '',
        cc_emails: doc.cc_emails || '',
        is_template: !!doc.is_template,
        content_html: doc.content_html || '',
        metadata_json: doc.metadata_json || '{}',
      });
      try {
        const p = JSON.parse(doc.metadata_json || '{}');
        if (p?.pageLayout) setLayout((prev) => ({ ...prev, ...p.pageLayout }));
      } catch {}
      applyHtmlToEditor(doc.content_html || '');
    }).catch((err) => alert(err?.message || 'Open failed'));
  };

  const removeDoc = (id) => {
    if (!window.confirm('Delete this document?')) return;
    accountingApi.documentation.delete(id).then(() => {
      if (selectedId === id) setSelectedId(null);
      load();
    }).catch((err) => alert(err?.message || 'Delete failed'));
  };

  const uploadFigure = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    accountingApi.documentation.uploadFigure(file)
      .then((r) => command('insertImage', r.url))
      .catch((err) => alert(err?.message || 'Upload failed'))
      .finally(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
  };

  const sendEmail = () => {
    if (!emailModal || !selectedId) return;
    const splitEmails = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const payload = {
      ...emailModal,
      to_emails: [...(emailModal.to_emails || []), ...splitEmails(emailModal.manual_to)],
      cc_emails: [...(emailModal.cc_emails || []), ...splitEmails(emailModal.manual_cc)],
    };
    accountingApi.documentation.sendEmail(selectedId, payload)
      .then(() => setEmailModal(null))
      .catch((err) => alert(err?.message || 'Send failed'));
  };

  const openVersions = () => {
    if (!selectedId) return;
    accountingApi.documentation.versions(selectedId)
      .then((r) => { setVersions(r.versions || []); setShowVersions(true); })
      .catch((err) => alert(err?.message || 'Could not load versions'));
  };

  const loadDiffSide = (side, versionId) => {
    if (!selectedId || !versionId) return;
    accountingApi.documentation.getVersion(selectedId, versionId)
      .then((r) => {
        const html = r?.version?.content_html || '';
        setDiffState((d) => (side === 'left'
          ? { ...d, leftVersionId: versionId, leftHtml: html }
          : { ...d, rightVersionId: versionId, rightHtml: html }));
      })
      .catch((err) => alert(err?.message || 'Could not load version content'));
  };

  const stripHtml = (html) => String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const diffRows = useMemo(() => {
    const left = stripHtml(diffState.leftHtml).split('\n');
    const right = stripHtml(diffState.rightHtml).split('\n');
    const max = Math.max(left.length, right.length);
    const out = [];
    for (let i = 0; i < max; i++) {
      const l = left[i] || '';
      const r = right[i] || '';
      let kind = 'same';
      if (l && !r) kind = 'removed';
      else if (!l && r) kind = 'added';
      else if (l !== r) kind = 'changed';
      out.push({ i, l, r, kind });
    }
    return out;
  }, [diffState.leftHtml, diffState.rightHtml]);

  const plainEditorText = useMemo(() => stripHtml(form.content_html || ''), [form.content_html]);
  const [pagedHtmlMeasured, setPagedHtmlMeasured] = useState(['']);

  const paginateHtmlFallback = useCallback((html, opts) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return [''];
    const blocks = Array.from(root.children);
    if (!blocks.length) return [root.innerHTML || ''];
    const margin = Number(opts.marginMm || 20);
    const fontPt = Number(opts.fontSizePt || 11);
    const capacity = Math.max(2200, Math.round((9200 - margin * 120) * (11 / fontPt)));
    const pages = [];
    let current = '';
    let used = 0;
    for (const el of blocks) {
      if (el.nodeType === 1 && el.hasAttribute('data-page-break')) {
        if (current.trim()) pages.push(current);
        current = '';
        used = 0;
        continue;
      }
      const chunk = el.outerHTML || '';
      const text = (el.textContent || '').trim();
      const weight = Math.max(120, chunk.length + text.length * 0.6);
      if (used > 0 && used + weight > capacity) {
        pages.push(current);
        current = '';
        used = 0;
      }
      current += chunk;
      used += weight;
    }
    if (current.trim()) pages.push(current);
    return pages.length ? pages : [root.innerHTML || ''];
  }, []);

  const measurePaginateHtml = useCallback((html, opts) => {
    const host = paginationMeasureRef.current;
    if (!host) return paginateHtmlFallback(html, opts);
    const mm = Number(opts.marginMm || 20);
    const fsPt = Number(opts.fontSizePt || 11);
    const pageWidth = 794; // A4 at ~96dpi
    const pageHeight = 1123;
    const pad = Math.round(mm * 3.78);
    const maxContentHeight = Math.max(280, pageHeight - pad * 2);

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const sourceNodes = root ? Array.from(root.childNodes) : [];
    if (!sourceNodes.length) return ['<p><br /></p>'];

    const createMeasurePage = () => {
      const page = document.createElement('div');
      page.style.width = `${pageWidth}px`;
      page.style.boxSizing = 'border-box';
      page.style.padding = `${pad}px`;
      page.style.fontFamily = '"Times New Roman", Georgia, serif';
      page.style.fontSize = `${fsPt}pt`;
      page.style.lineHeight = '1.5';
      page.style.position = 'absolute';
      page.style.left = '-20000px';
      page.style.top = '0';
      page.style.visibility = 'hidden';
      page.style.background = '#fff';
      return page;
    };

    const makeEmptyPageHtml = () => '<p><br /></p>';
    const pages = [];
    let page = createMeasurePage();
    host.appendChild(page);

    const fits = () => page.scrollHeight <= maxContentHeight;
    const commit = () => {
      const htmlOut = page.innerHTML.trim() || makeEmptyPageHtml();
      pages.push(htmlOut);
      host.removeChild(page);
      page = createMeasurePage();
      host.appendChild(page);
    };

    const splitParagraphByWords = (node) => {
      const text = (node.textContent || '').trim();
      if (!text) return [node.cloneNode(true)];
      const tag = (node.nodeType === 1 ? node.nodeName.toLowerCase() : 'p');
      const words = text.split(/\s+/);
      const chunks = [];
      let idx = 0;
      while (idx < words.length) {
        const chunkEl = document.createElement(tag);
        if (node.nodeType === 1 && node.attributes) {
          for (const attr of node.attributes) chunkEl.setAttribute(attr.name, attr.value);
        }
        chunkEl.textContent = '';
        while (idx < words.length) {
          const next = chunkEl.textContent ? `${chunkEl.textContent} ${words[idx]}` : words[idx];
          chunkEl.textContent = next;
          page.appendChild(chunkEl);
          const ok = fits();
          page.removeChild(chunkEl);
          if (!ok && chunkEl.textContent !== words[idx]) break;
          if (!ok) return chunks.length ? chunks : [node.cloneNode(true)];
          idx += 1;
        }
        chunks.push(chunkEl.cloneNode(true));
      }
      return chunks.length ? chunks : [node.cloneNode(true)];
    };

    const appendNodeWithTableSplit = (node) => {
      const isElement = node.nodeType === 1;
      const tag = isElement ? node.nodeName.toLowerCase() : '';

      if (isElement && tag === 'table') {
        if (page.childNodes.length > 0) {
          const fullTry = node.cloneNode(true);
          page.appendChild(fullTry);
          const ok = fits();
          page.removeChild(fullTry);
          if (!ok) commit();
        }

        const table = node;
        const thead = table.querySelector('thead');
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const looseRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).filter((r) => !r.closest('thead'));
        const headerHtml = thead ? thead.outerHTML : '';
        const openAttrs = Array.from(table.attributes || []).map((a) => `${a.name}="${a.value}"`).join(' ');
        let idx = 0;
        while (idx < looseRows.length) {
          const tempTable = document.createElement('table');
          if (openAttrs) {
            for (const a of table.attributes) tempTable.setAttribute(a.name, a.value);
          }
          if (thead) tempTable.appendChild(thead.cloneNode(true));
          const tb = document.createElement('tbody');
          tempTable.appendChild(tb);
          let startIdx = idx;
          while (idx < looseRows.length) {
            tb.appendChild(looseRows[idx].cloneNode(true));
            page.appendChild(tempTable);
            const ok = fits();
            page.removeChild(tempTable);
            if (!ok) {
              tb.removeChild(tb.lastChild);
              if (idx === startIdx) {
                // Single row too large; force it
                tb.appendChild(looseRows[idx].cloneNode(true));
                idx += 1;
              }
              break;
            }
            idx += 1;
          }
          page.appendChild(tempTable.cloneNode(true));
          if (idx < looseRows.length) commit();
        }
        return;
      }

      const clone = node.cloneNode(true);
      page.appendChild(clone);
      if (fits()) return;
      page.removeChild(clone);
      if (page.childNodes.length > 0) {
        commit();
        page.appendChild(clone.cloneNode(true));
        if (fits()) return;
        page.removeChild(page.lastChild);
      }

      if (isElement && ['p', 'li', 'div', 'span'].includes(tag)) {
        const chunks = splitParagraphByWords(node);
        for (const c of chunks) {
          page.appendChild(c.cloneNode(true));
          if (!fits()) {
            page.removeChild(page.lastChild);
            commit();
            page.appendChild(c.cloneNode(true));
          }
        }
        return;
      }

      // Large image/other block: place on its own page and constrain visual overflow in render CSS.
      page.appendChild(clone);
      commit();
    };

    for (const n of sourceNodes) {
      if (n.nodeType === 3 && !String(n.textContent || '').trim()) continue;
      if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-page-break')) {
        if (page.innerHTML.trim()) commit();
        continue;
      }
      if (n.nodeType === 3) {
        const p = document.createElement('p');
        p.textContent = String(n.textContent || '').trim();
        appendNodeWithTableSplit(p);
      } else {
        appendNodeWithTableSplit(n);
      }
    }
    const tail = page.innerHTML.trim();
    if (tail) pages.push(tail);
    host.removeChild(page);
    return pages.length ? pages : [makeEmptyPageHtml()];
  }, [paginateHtmlFallback]);

  useLayoutEffect(() => {
    const html = form.content_html || '';
    try {
      const next = measurePaginateHtml(html, layout);
      setPagedHtmlMeasured(next);
    } catch {
      setPagedHtmlMeasured(paginateHtmlFallback(html, layout));
    }
  }, [form.content_html, layout, measurePaginateHtml, paginateHtmlFallback]);

  const pagedHtml = pagedHtmlMeasured;

  const estimatedPages = Math.max(1, pagedHtml.length || Math.ceil((plainEditorText.length || 0) / 3200));

  const renderPrintLetterheadOverlay = () => {
    const theme = { dark: '#7F1D1D', mid: '#991B1B' };
    return (
      <>
        <div className="absolute inset-x-0 top-0 h-[86px] bg-white" />
        <div className="absolute right-[12px] top-[18px] w-[34px] bottom-[110px]" style={{ background: theme.dark }} />
        <div className="absolute right-[46px] top-[170px] w-[2px] bottom-[20px]" style={{ background: theme.mid }} />
        <div className="absolute left-[20px] bottom-[20px] w-[34px] h-[112px]" style={{ background: theme.mid }} />
        <div className="absolute left-[20px] top-[20px] w-[156px] h-[96px] border border-slate-200/50 bg-white/70" />
        <div className="absolute left-[20px] top-[20px] w-[156px] h-[96px] flex items-center justify-center text-[11px] font-bold text-black">LOGO</div>
        <div
          className="absolute text-[10px] font-semibold text-white"
          style={{ right: '24px', top: '50%', transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center' }}
        >
          Think differently
        </div>
      </>
    );
  };

  const restoreVersion = (versionId) => {
    if (!selectedId) return;
    if (!window.confirm('Restore this version? Current draft will be replaced.')) return;
    accountingApi.documentation.restoreVersion(selectedId, versionId)
      .then(() => { setShowVersions(false); openDoc(selectedId); load(); })
      .catch((err) => alert(err?.message || 'Restore failed'));
  };

  const previewAddressLines = String(companyDetails.address || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const previewLeftBlockLines = [
    ...previewAddressLines,
    companyDetails.phone ? `TEL: ${companyDetails.phone}` : '',
    companyDetails.email ? `Email: ${companyDetails.email}` : '',
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-surface-900">Documentation</h2>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => { setSelectedId(null); insertTemplate('company_employment_contract'); setForm((f) => ({ ...f, title: 'Employment contract draft', is_template: true })); }} className="px-3 py-2 rounded-lg border border-surface-300 text-sm">New from employment template</button>
          <button type="button" onClick={saveDoc} disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => selectedId && openAttachmentWithAuth(accountingApi.documentation.pdfUrl(selectedId))} disabled={!selectedId} className="px-4 py-2 rounded-lg border border-surface-300 text-sm disabled:opacity-50">View PDF</button>
          <button type="button" onClick={() => selectedId && openAttachmentWithAuth(accountingApi.documentation.pdfDownloadUrl(selectedId))} disabled={!selectedId} className="px-4 py-2 rounded-lg border border-surface-300 text-sm disabled:opacity-50">Download PDF</button>
          <button type="button" onClick={() => selectedId && downloadAttachmentWithAuth(accountingApi.documentation.wordTemplateDownloadUrl(selectedId), `${(form.title || 'document-template').replace(/[^a-z0-9_-]/gi, '-')}.doc`)} disabled={!selectedId} className="px-4 py-2 rounded-lg border border-surface-300 text-sm disabled:opacity-50">Download Word Template</button>
          <button type="button" onClick={openVersions} disabled={!selectedId} className="px-4 py-2 rounded-lg border border-surface-300 text-sm disabled:opacity-50">History</button>
          <button type="button" onClick={() => setPrintLayout((v) => !v)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">{printLayout ? 'Exit print layout' : 'Print layout'}</button>
          <button type="button" onClick={() => setEmailModal({ to_emails: [], cc_emails: [], subject: form.subject || form.title, message: 'Please find attached document.' })} disabled={!selectedId} className="px-4 py-2 rounded-lg border border-surface-300 text-sm disabled:opacity-50">Email</button>
        </div>
      </div>

      <p className="text-sm text-surface-600">Create world-class contracts, agreements, NDAs, termination letters, letters of intent, and reports. Includes reusable templates, rich editing, figures/tables, PDF view, and email with CC.</p>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-1 rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents..." className="w-full px-3 py-2 rounded-lg border border-surface-300 text-sm" />
          <button type="button" onClick={load} className="w-full px-3 py-2 rounded-lg bg-surface-900 text-white text-sm">Refresh</button>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {loading ? <p className="text-sm text-surface-500">Loading...</p> : list.map((d) => (
              <div key={d.id} className={`rounded-lg border p-2 ${selectedId === d.id ? 'border-brand-400 bg-brand-50' : 'border-surface-200'}`}>
                <button type="button" onClick={() => openDoc(d.id)} className="w-full text-left">
                  <p className="text-sm font-medium text-surface-900 truncate">{d.title}</p>
                  <p className="text-xs text-surface-500">{d.document_type} · {d.is_template ? 'Template' : 'Document'}</p>
                </button>
                <div className="mt-1 flex gap-2">
                  <button type="button" onClick={() => openDoc(d.id)} className="text-xs text-brand-700">Open</button>
                  <button type="button" onClick={() => removeDoc(d.id)} className="text-xs text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-3 rounded-xl border border-surface-200 bg-white shadow-sm">
          <div className="p-3 border-b border-surface-200 flex flex-wrap gap-2 items-center">
            <select value={form.document_type} onChange={(e) => insertTemplate(e.target.value)} className="px-2 py-1.5 rounded border border-surface-300 text-sm">
              {DOC_TEMPLATE_DEFS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <button type="button" onClick={() => command('bold')} className="px-2 py-1 border rounded text-sm">Bold</button>
            <button type="button" onClick={() => command('italic')} className="px-2 py-1 border rounded text-sm">Italic</button>
            <button type="button" onClick={() => command('underline')} className="px-2 py-1 border rounded text-sm">Underline</button>
            <button type="button" onClick={() => command('justifyLeft')} className="px-2 py-1 border rounded text-sm">Left</button>
            <button type="button" onClick={() => command('justifyCenter')} className="px-2 py-1 border rounded text-sm">Center</button>
            <button type="button" onClick={() => command('justifyRight')} className="px-2 py-1 border rounded text-sm">Right</button>
            <button type="button" onClick={() => command('insertUnorderedList')} className="px-2 py-1 border rounded text-sm">Bullets</button>
            <button type="button" onClick={() => command('insertOrderedList')} className="px-2 py-1 border rounded text-sm">Numbered</button>
            <button type="button" onClick={() => command('formatBlock', '<h2>')} className="px-2 py-1 border rounded text-sm">H2</button>
            <button type="button" onClick={() => command('insertHTML', PAGE_BREAK_MARKER_HTML)} className="px-2 py-1 border rounded text-sm">Page break</button>
            <button type="button" onClick={() => command('insertHTML', '<table border=\"1\" style=\"border-collapse:collapse;width:100%\"><tr><th>Item</th><th>Value</th></tr><tr><td>...</td><td>...</td></tr></table><p></p>')} className="px-2 py-1 border rounded text-sm">Table</button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={uploadFigure} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-2 py-1 border rounded text-sm">Insert image/figure</button>
            <button type="button" onClick={() => moveBlock('up')} className="px-2 py-1 border rounded text-sm">Move block up</button>
            <button type="button" onClick={() => moveBlock('down')} className="px-2 py-1 border rounded text-sm">Move block down</button>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Document title" className="px-3 py-2 rounded border border-surface-300 text-sm" />
              <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Subject" className="px-3 py-2 rounded border border-surface-300 text-sm" />
              <input value={form.recipient_name} onChange={(e) => setForm((f) => ({ ...f, recipient_name: e.target.value }))} placeholder="Recipient name" className="px-3 py-2 rounded border border-surface-300 text-sm" />
              <input value={form.recipient_email} onChange={(e) => setForm((f) => ({ ...f, recipient_email: e.target.value }))} placeholder="Recipient email" className="px-3 py-2 rounded border border-surface-300 text-sm" />
            </div>
            <div className="rounded-lg border border-surface-200 p-3 bg-surface-50">
              <p className="text-sm font-medium text-surface-800 mb-2">Page setup / letterhead polish</p>
              <div className="grid md:grid-cols-4 gap-3">
                <label className="text-xs text-surface-700">Margin (mm)
                  <input type="number" min="8" max="40" value={layout.marginMm} onChange={(e) => setLayout((l) => ({ ...l, marginMm: Number(e.target.value || 20) }))} className="mt-1 w-full px-2 py-1 rounded border border-surface-300 text-sm" />
                </label>
                <label className="text-xs text-surface-700">Font size (pt)
                  <input type="number" min="9" max="14" value={layout.fontSizePt} onChange={(e) => setLayout((l) => ({ ...l, fontSizePt: Number(e.target.value || 11) }))} className="mt-1 w-full px-2 py-1 rounded border border-surface-300 text-sm" />
                </label>
                <label className="text-xs text-surface-700">Letterhead style
                  <select value={layout.letterheadStyle} onChange={(e) => setLayout((l) => ({ ...l, letterheadStyle: e.target.value }))} className="mt-1 w-full px-2 py-1 rounded border border-surface-300 text-sm">
                    <option value="executive">Executive</option>
                    <option value="clean">Clean</option>
                    <option value="classic">Classic</option>
                  </select>
                </label>
                <label className="text-xs text-surface-700">Brand theme
                  <select value={layout.brandTheme || 'executive_red'} onChange={(e) => setLayout((l) => ({ ...l, brandTheme: e.target.value }))} className="mt-1 w-full px-2 py-1 rounded border border-surface-300 text-sm">
                    <option value="executive_red">Executive Red</option>
                    <option value="midnight_blue">Midnight Blue</option>
                    <option value="monochrome_luxury">Monochrome Luxury</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 grid md:grid-cols-4 gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-surface-700">
                  <input type="checkbox" checked={layout.showDocTitle !== false} onChange={(e) => setLayout((l) => ({ ...l, showDocTitle: e.target.checked }))} />
                  Show document title
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-surface-700">
                  <input type="checkbox" checked={layout.showDocDate !== false} onChange={(e) => setLayout((l) => ({ ...l, showDocDate: e.target.checked }))} />
                  Show date
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-surface-700">
                  <input type="checkbox" checked={layout.showDocRecipient !== false} onChange={(e) => setLayout((l) => ({ ...l, showDocRecipient: e.target.checked }))} />
                  Show recipient
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-surface-700">
                  <input type="checkbox" checked={layout.showDocSubject !== false} onChange={(e) => setLayout((l) => ({ ...l, showDocSubject: e.target.checked }))} />
                  Show subject
                </label>
              </div>
            </div>
            <div className="rounded-lg border border-surface-200 p-3 bg-surface-50">
              <p className="text-sm font-medium text-surface-800 mb-2">Section builder</p>
              <div className="flex flex-wrap gap-2">
                {SECTION_SNIPPETS.map((s) => (
                  <button key={s.id} type="button" onClick={() => insertSection(s)} className="px-2 py-1 border border-surface-300 rounded text-xs bg-white">{s.label}</button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-surface-200 p-3 bg-surface-50">
              <p className="text-sm font-medium text-surface-800 mb-2">Embed chart / graph as figure</p>
              <div className="grid md:grid-cols-4 gap-2">
                <select value={chartType} onChange={(e) => setChartType(e.target.value)} className="px-2 py-1 border border-surface-300 rounded text-sm">
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="pie">Pie</option>
                </select>
                <select value={chartPalette} onChange={(e) => setChartPalette(e.target.value)} className="px-2 py-1 border border-surface-300 rounded text-sm">
                  <option value="corporate">Corporate palette</option>
                  <option value="mono">Monochrome</option>
                  <option value="vibrant">Vibrant</option>
                </select>
                <input value={chartLabels} onChange={(e) => setChartLabels(e.target.value)} placeholder="Labels csv" className="px-2 py-1 border border-surface-300 rounded text-sm md:col-span-2" />
                <input value={chartValues} onChange={(e) => setChartValues(e.target.value)} placeholder="Values csv" className="px-2 py-1 border border-surface-300 rounded text-sm md:col-span-4" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={renderChartFigure} className="px-3 py-1.5 rounded border border-surface-300 bg-white text-sm">Insert chart figure</button>
                <span className="text-xs text-surface-500">Creates a chart image and inserts it into the document.</span>
              </div>
              <canvas ref={chartCanvasRef} className="hidden" />
            </div>
            <div className="rounded-xl border border-surface-200 overflow-hidden">
              <div className="px-3 py-2 bg-surface-50 border-b border-surface-200 text-xs text-surface-600 flex items-center justify-between">
                <span>World-class letterhead editor (WYSIWYG)</span>
                <span>Estimated pages: {estimatedPages}</span>
              </div>
              {printLayout && (
                <div className="h-6 border-b border-surface-200 bg-white relative overflow-hidden">
                  <div className="absolute left-2 top-1 text-[10px] text-surface-500">mm ruler</div>
                </div>
              )}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={onEditorInput}
                onPaste={onEditorPaste}
                onKeyDown={onEditorKeyDown}
                className="min-h-[460px] focus:outline-none prose max-w-none"
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  padding: `${layout.marginMm}px`,
                  fontSize: `${layout.fontSizePt}pt`,
                  lineHeight: 1.55,
                  color: '#000000',
                  background: '#ffffff',
                }}
              />
            </div>
            {printLayout && (
              <div className="rounded-xl border border-surface-200 p-3 bg-surface-50">
                <style>{`
                  .documentation-page-content img { max-width: 100%; height: auto; max-height: 980px; object-fit: contain; }
                  .documentation-page-content table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                  .documentation-page-content table th,
                  .documentation-page-content table td { word-break: break-word; }
                  .documentation-page-content .doc-page-break-marker { display: none !important; }
                  [contenteditable="true"] .doc-page-break-marker {
                    display: block;
                    border-top: 2px dashed #fb7185;
                    border-bottom: 2px dashed #fb7185;
                    padding: 6px 0;
                    margin: 12px 0;
                    text-align: center;
                    color: #be123c;
                    font-size: 11px;
                    font-weight: 600;
                    background: #fff1f2;
                  }
                `}</style>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-surface-900">Paginated WYSIWYG canvas (A4)</p>
                  <p className="text-xs text-surface-500">{pagedHtml.length} page(s)</p>
                </div>
                <div className="space-y-4 max-h-[900px] overflow-auto pr-1">
                  {pagedHtml.map((pageHtml, idx) => (
                    <div key={`page-${idx}`} className="mx-auto bg-white border border-surface-200 relative overflow-hidden" style={{ width: '794px', minHeight: '1123px', boxShadow: '0 18px 50px rgba(15,23,42,0.10), 0 3px 10px rgba(15,23,42,0.06)' }}>
                      {renderPrintLetterheadOverlay()}
                      <div className="absolute left-[64px] bottom-[20px] text-[9.2px] leading-[1.35] text-black text-left whitespace-pre-line">
                        {previewLeftBlockLines.join('\n')}
                      </div>
                      <div className="absolute right-[18px] bottom-[68px] text-[9px] text-black">{idx + 1}</div>
                      <div
                        className="prose max-w-none documentation-page-content"
                        style={{
                          paddingLeft: `${layout.marginMm * 3.78}px`,
                          paddingRight: `${layout.marginMm * 3.78}px`,
                          paddingBottom: `${layout.marginMm * 3.78}px`,
                          paddingTop: `${Math.max(layout.marginMm * 3.78, 72)}px`,
                          fontSize: `${layout.fontSizePt}pt`,
                          fontFamily: '"Times New Roman", Times, serif',
                          color: '#000000',
                          lineHeight: 1.55,
                        }}
                        dangerouslySetInnerHTML={{ __html: pageHtml }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma-separated)" className="px-3 py-2 rounded border border-surface-300 text-sm" />
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.is_template} onChange={(e) => setForm((f) => ({ ...f, is_template: e.target.checked }))} /> Save as reusable template</label>
            </div>
            <textarea value={form.metadata_json} onChange={(e) => setForm((f) => ({ ...f, metadata_json: e.target.value }))} rows={3} className="w-full px-3 py-2 rounded border border-surface-300 text-xs font-mono" placeholder="Metadata JSON" />
          </div>
        </div>
      </div>

      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 space-y-3">
            <h3 className="font-semibold text-surface-900">Email document</h3>
            <p className="text-sm text-surface-600">To:</p>
            <div className="flex flex-wrap gap-2">
              {recipients.map((r) => (
                <label key={r.email} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.to_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, to_emails: e.target.checked ? [...m.to_emails, r.email] : m.to_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-surface-600">CC:</p>
            <div className="flex flex-wrap gap-2">
              {recipients.map((r) => (
                <label key={`cc-${r.email}`} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-200">
                  <input type="checkbox" checked={emailModal.cc_emails.includes(r.email)} onChange={(e) => setEmailModal((m) => ({ ...m, cc_emails: e.target.checked ? [...m.cc_emails, r.email] : m.cc_emails.filter((x) => x !== r.email) }))} />
                  <span className="text-sm">{r.full_name || r.email}</span>
                </label>
              ))}
            </div>
            <input value={emailModal.subject} onChange={(e) => setEmailModal((m) => ({ ...m, subject: e.target.value }))} className="w-full px-3 py-2 rounded border border-surface-300 text-sm" placeholder="Subject" />
            <input
              value={emailModal.manual_to || ''}
              onChange={(e) => setEmailModal((m) => ({ ...m, manual_to: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-surface-300 text-sm"
              placeholder="Manual To emails (comma-separated)"
            />
            <input
              value={emailModal.manual_cc || ''}
              onChange={(e) => setEmailModal((m) => ({ ...m, manual_cc: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-surface-300 text-sm"
              placeholder="Manual CC emails (comma-separated)"
            />
            <textarea value={emailModal.message} onChange={(e) => setEmailModal((m) => ({ ...m, message: e.target.value }))} rows={4} className="w-full px-3 py-2 rounded border border-surface-300 text-sm" placeholder="Email body" />
            <div className="flex gap-2">
              <button type="button" onClick={sendEmail} className="px-4 py-2 rounded-lg bg-brand-600 text-white">Send</button>
              <button type="button" onClick={() => setEmailModal(null)} className="px-4 py-2 rounded-lg border border-surface-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showVersions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full p-6 space-y-3 max-h-[85vh] overflow-auto">
            <h3 className="font-semibold text-surface-900">Version history</h3>
            {versions.length === 0 ? <p className="text-sm text-surface-500">No versions available yet.</p> : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="space-y-2 lg:col-span-1">
                  {versions.map((v) => (
                    <div key={v.id} className="border border-surface-200 rounded-lg p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-surface-900">v{v.version_no} · {v.title || 'Untitled'}</p>
                        <p className="text-xs text-surface-500">{v.document_type} · {v.changed_by || 'user'} · {formatDate(v.created_at)}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button type="button" onClick={() => loadDiffSide('left', v.id)} className="px-2 py-1 rounded border border-surface-300 text-xs">Left</button>
                        <button type="button" onClick={() => loadDiffSide('right', v.id)} className="px-2 py-1 rounded border border-surface-300 text-xs">Right</button>
                        <button type="button" onClick={() => restoreVersion(v.id)} className="px-2 py-1 rounded border border-surface-300 text-xs">Restore</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="lg:col-span-2 border border-surface-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-surface-50 border-b border-surface-200 text-xs text-surface-600">
                    Side-by-side version diff
                  </div>
                  <div className="max-h-[60vh] overflow-auto divide-y divide-surface-100">
                    {diffRows.map((r) => (
                      <div key={r.i} className={`grid grid-cols-2 gap-0 text-xs ${r.kind === 'added' ? 'bg-emerald-50' : r.kind === 'removed' ? 'bg-red-50' : r.kind === 'changed' ? 'bg-amber-50' : ''}`}>
                        <pre className="p-2 whitespace-pre-wrap border-r border-surface-100">{r.l || ' '}</pre>
                        <pre className="p-2 whitespace-pre-wrap">{r.r || ' '}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="pt-2">
              <button type="button" onClick={() => setShowVersions(false)} className="px-4 py-2 rounded-lg border border-surface-300">Close</button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={paginationMeasureRef}
        style={{ position: 'fixed', left: '-30000px', top: 0, width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
        aria-hidden
      />
    </div>
  );
}

function LibraryTab() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    accountingApi.library.list()
      .then((data) => setFiles(data.files || []))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    accountingApi.library.upload(file)
      .then(load)
      .finally(() => {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      });
  };

  const viewUrl = (name) => `${getApiBase()}/accounting/library/${encodeURIComponent(name)}`;

  const handleView = (name) => openAttachmentWithAuth(viewUrl(name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Library</h2>
        <div>
          <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      </div>
      <p className="text-surface-600 text-sm">Documents are stored in the accounting library folder. You can view them below.</p>
      {loading ? (
        <div className="text-surface-500">Loading…</div>
      ) : files.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">No documents yet. Upload a file to get started.</div>
      ) : (
        <ul className="border border-surface-200 rounded-lg divide-y divide-surface-200 bg-white shadow-sm overflow-hidden">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-50">
              <span className="text-surface-800 truncate">{f.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-surface-500 text-sm">{(f.size / 1024).toFixed(1)} KB</span>
                <button
                  type="button"
                  onClick={() => handleView(f.name)}
                  className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                >
                  View
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AccountingManagement() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('accounting-mgmt');
  const [activeTab, setActiveTab] = useState(NAV_SECTIONS[0].items[0].id);
  useAutoHideNavAfterTabChange(activeTab);

  return (
    <div className="flex gap-0 w-full min-h-0 -m-4 sm:-m-6">
      {/* Side nav */}
      <nav
        className={`shrink-0 flex flex-col border-r border-surface-200 bg-white transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Accounting management"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Accounting management</h2>
            {user?.tenant_name ? <p className="text-sm font-medium text-surface-700 mt-0.5" title="Data for this company">{user.tenant_name}</p> : null}
            <p className="text-xs text-surface-500 mt-0.5">Company settings, documents & library</p>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700"
            aria-label="Hide navigation"
            title="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          {NAV_SECTIONS.map((group) => (
            <div key={group.section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">
                {group.section}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                        activeTab === item.id
                          ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                          : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                      }`}
                    >
                      <TabIcon name={item.icon} className="w-5 h-5 shrink-0 text-inherit opacity-90" />
                      <span className="min-w-0 break-words">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1">
          {activeTab === 'company-settings' && <CompanySettingsTab />}
          {activeTab === 'customer-book' && <CustomerBookTab />}
          {activeTab === 'supplier-book' && <SupplierBookTab />}
          {activeTab === 'items-library' && <ItemsLibraryTab />}
          {activeTab === 'quotations' && <QuotationsTab />}
          {activeTab === 'invoices' && <InvoicesTab />}
          {activeTab === 'purchase-orders' && <PurchaseOrdersTab />}
          {activeTab === 'statements' && <StatementsTab />}
          {activeTab === 'library' && <LibraryTab />}
          {activeTab === 'documentation' && <DocumentationTab />}
        </div>
      </div>
    </div>
  );
}
