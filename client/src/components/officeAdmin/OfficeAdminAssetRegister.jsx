import { useState, useEffect } from 'react';
import { officeAdmin, downloadAttachmentWithAuth, openAttachmentWithAuth } from '../../api';
import {
  downloadAssetTemplate,
  exportAssetsExcel,
  exportAssetsPdf,
} from '../../lib/officeAdminExports.js';

const inputClass =
  'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900 dark:border-surface-600';
const btnPrimary = 'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
const btnSecondary =
  'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50 dark:border-surface-600 dark:hover:bg-surface-800';

const CONDITION_OPTIONS = [
  { value: '', label: '—' },
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'retired', label: 'Retired' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'disposed', label: 'Disposed' },
];

function dateInput(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return s.length === 10 ? s : '';
}

export function emptyAssetForm() {
  return {
    category_id: '',
    name: '',
    location: '',
    status: 'active',
    serial_number: '',
    purchase_date: '',
    purchase_value: '',
    manufacturer: '',
    model: '',
    supplier_name: '',
    commissioned_date: '',
    warranty_expiry_date: '',
    expected_life_years: '',
    useful_life_end_date: '',
    disposal_date: '',
    condition_status: 'good',
    residual_value: '',
    insurance_provider: '',
    insurance_policy_number: '',
    insurance_cover_type: '',
    insurance_start_date: '',
    insurance_expiry_date: '',
    insurance_premium_annual: '',
    insurance_contact: '',
    insurance_notes: '',
    notes: '',
  };
}

function assetToForm(a) {
  if (!a) return emptyAssetForm();
  return {
    category_id: a.category_id || '',
    name: a.name || '',
    location: a.location || '',
    status: a.status || 'active',
    serial_number: a.serial_number || '',
    purchase_date: dateInput(a.purchase_date),
    purchase_value: a.purchase_value != null ? String(a.purchase_value) : '',
    manufacturer: a.manufacturer || '',
    model: a.model || '',
    supplier_name: a.supplier_name || '',
    commissioned_date: dateInput(a.commissioned_date),
    warranty_expiry_date: dateInput(a.warranty_expiry_date),
    expected_life_years: a.expected_life_years != null ? String(a.expected_life_years) : '',
    useful_life_end_date: dateInput(a.useful_life_end_date),
    disposal_date: dateInput(a.disposal_date),
    condition_status: a.condition_status || '',
    residual_value: a.residual_value != null ? String(a.residual_value) : '',
    insurance_provider: a.insurance_provider || '',
    insurance_policy_number: a.insurance_policy_number || '',
    insurance_cover_type: a.insurance_cover_type || '',
    insurance_start_date: dateInput(a.insurance_start_date),
    insurance_expiry_date: dateInput(a.insurance_expiry_date),
    insurance_premium_annual:
      a.insurance_premium_annual != null ? String(a.insurance_premium_annual) : '',
    insurance_contact: a.insurance_contact || '',
    insurance_notes: a.insurance_notes || '',
    notes: a.notes || '',
  };
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`text-sm block ${className}`}>
      <span className="text-xs text-surface-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function buildPayload(form) {
  const p = { ...form };
  ['purchase_value', 'expected_life_years', 'residual_value', 'insurance_premium_annual'].forEach((k) => {
    if (p[k] === '') p[k] = null;
  });
  return p;
}

export default function OfficeAdminAssetRegister({ assets, assetCategories, assetSearch, setAssetSearch, onReload, onError, onFlash }) {
  const [categoryForm, setCategoryForm] = useState({ name: '', code_prefix: '', description: '' });
  const [assetForm, setAssetForm] = useState(emptyAssetForm);
  const [assetCodePreview, setAssetCodePreview] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailForm, setDetailForm] = useState(emptyAssetForm());
  const [attachments, setAttachments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadCaption, setUploadCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);

  useEffect(() => {
    if (!assetForm.category_id) {
      setAssetCodePreview('');
      return;
    }
    let cancelled = false;
    officeAdmin.assetCategories
      .nextCode(assetForm.category_id)
      .then((r) => {
        if (!cancelled) setAssetCodePreview(r.next_code || '');
      })
      .catch(() => {
        if (!cancelled) setAssetCodePreview('');
      });
    return () => {
      cancelled = true;
    };
  }, [assetForm.category_id]);

  const loadDetail = async (id) => {
    setSelectedId(id);
    setDetailLoading(true);
    onError('');
    try {
      const d = await officeAdmin.assets.get(id);
      setDetailForm(assetToForm(d.asset));
      setAttachments(d.attachments || []);
    } catch (e) {
      onError(e.message);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveDetail = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await officeAdmin.assets.update(selectedId, buildPayload(detailForm));
      onFlash('Asset updated.');
      onReload();
      await loadDetail(selectedId);
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadAttachments = async () => {
    if (!selectedId || !uploadFiles.length) return;
    setSaving(true);
    try {
      const r = await officeAdmin.assets.uploadAttachments(selectedId, uploadFiles, {
        caption: uploadCaption,
      });
      setAttachments(r.attachments || []);
      setUploadFiles([]);
      setUploadCaption('');
      onFlash(`${r.inserted_count || uploadFiles.length} file(s) uploaded.`);
      onReload();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Asset register</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => downloadAssetTemplate()}>
            Download template
          </button>
          <button type="button" className={btnSecondary} onClick={() => exportAssetsExcel(assets)}>
            Export Excel
          </button>
          <button type="button" className={btnSecondary} onClick={() => exportAssetsPdf(assets)}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder="Search assets…"
          value={assetSearch}
          onChange={(e) => setAssetSearch(e.target.value)}
        />
        <button type="button" className={btnSecondary} onClick={onReload}>
          Search
        </button>
        <button
          type="button"
          className={showCategoryForm ? btnPrimary : btnSecondary}
          onClick={() => {
            setShowRegisterForm(false);
            setShowCategoryForm((v) => !v);
          }}
        >
          {showCategoryForm ? 'Hide category form' : 'Add category'}
        </button>
        <button
          type="button"
          className={showRegisterForm ? btnPrimary : btnSecondary}
          onClick={() => {
            setShowCategoryForm(false);
            setShowRegisterForm((v) => !v);
          }}
        >
          {showRegisterForm ? 'Hide register form' : 'Register new asset'}
        </button>
      </div>

      {assetCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-surface-500 uppercase tracking-wide">Categories</span>
          {assetCategories.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
            >
              <span className="font-medium">{cat.name}</span>
              <span className="font-mono text-surface-500">{cat.code_prefix}</span>
            </span>
          ))}
        </div>
      )}

      {showCategoryForm && (
        <div className="app-glass-card p-4 space-y-4">
          <div className="flex flex-wrap justify-between gap-2 items-center">
            <h3 className="text-sm font-semibold">New asset category</h3>
            <button type="button" className={btnSecondary} onClick={() => setShowCategoryForm(false)}>
              Close
            </button>
          </div>
          <p className="text-xs text-surface-500">
            Categories define the code prefix used for auto-generated asset codes (e.g. IT-0001).
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Category name *">
              <input
                className={inputClass}
                placeholder="e.g. IT equipment"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Code prefix *">
              <input
                className={inputClass}
                placeholder="e.g. IT"
                value={categoryForm.code_prefix}
                onChange={(e) => setCategoryForm((f) => ({ ...f, code_prefix: e.target.value.toUpperCase() }))}
                maxLength={8}
              />
            </Field>
            <Field label="Description">
              <input
                className={inputClass}
                placeholder="Optional"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                className={btnPrimary}
                disabled={!categoryForm.name.trim() || !categoryForm.code_prefix.trim()}
                onClick={() =>
                  officeAdmin.assetCategories
                    .create(categoryForm)
                    .then(() => {
                      onFlash('Category added.');
                      setCategoryForm({ name: '', code_prefix: '', description: '' });
                      setShowCategoryForm(false);
                      onReload();
                    })
                    .catch((e) => onError(e.message))
                }
              >
                Save category
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegisterForm && (
      <div className="app-glass-card p-4 space-y-4">
        <div className="flex flex-wrap justify-between gap-2 items-center">
          <h3 className="text-sm font-semibold">Register new asset</h3>
          <button type="button" className={btnSecondary} onClick={() => setShowRegisterForm(false)}>
            Close
          </button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Category *">
            <select
              className={inputClass}
              value={assetForm.category_id}
              onChange={(e) => setAssetForm((f) => ({ ...f, category_id: e.target.value }))}
            >
              <option value="">Select…</option>
              {assetCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat.code_prefix})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Asset code (auto)">
            <p className="font-mono text-sm px-3 py-2 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700">
              {assetCodePreview || '—'}
            </p>
          </Field>
          <Field label="Name *">
            <input
              className={inputClass}
              value={assetForm.name}
              onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Location">
            <input
              className={inputClass}
              value={assetForm.location}
              onChange={(e) => setAssetForm((f) => ({ ...f, location: e.target.value }))}
            />
          </Field>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Identification & purchase</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Serial number">
            <input
              className={inputClass}
              value={assetForm.serial_number}
              onChange={(e) => setAssetForm((f) => ({ ...f, serial_number: e.target.value }))}
            />
          </Field>
          <Field label="Manufacturer">
            <input
              className={inputClass}
              value={assetForm.manufacturer}
              onChange={(e) => setAssetForm((f) => ({ ...f, manufacturer: e.target.value }))}
            />
          </Field>
          <Field label="Model">
            <input className={inputClass} value={assetForm.model} onChange={(e) => setAssetForm((f) => ({ ...f, model: e.target.value }))} />
          </Field>
          <Field label="Supplier">
            <input
              className={inputClass}
              value={assetForm.supplier_name}
              onChange={(e) => setAssetForm((f) => ({ ...f, supplier_name: e.target.value }))}
            />
          </Field>
          <Field label="Purchase date">
            <input
              type="date"
              className={inputClass}
              value={assetForm.purchase_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, purchase_date: e.target.value }))}
            />
          </Field>
          <Field label="Purchase value (ZAR)">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={assetForm.purchase_value}
              onChange={(e) => setAssetForm((f) => ({ ...f, purchase_value: e.target.value }))}
            />
          </Field>
          <Field label="Residual value (ZAR)">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={assetForm.residual_value}
              onChange={(e) => setAssetForm((f) => ({ ...f, residual_value: e.target.value }))}
            />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={assetForm.status} onChange={(e) => setAssetForm((f) => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Lifecycle</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Commissioned (in service)">
            <input
              type="date"
              className={inputClass}
              value={assetForm.commissioned_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, commissioned_date: e.target.value }))}
            />
          </Field>
          <Field label="Warranty expires">
            <input
              type="date"
              className={inputClass}
              value={assetForm.warranty_expiry_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, warranty_expiry_date: e.target.value }))}
            />
          </Field>
          <Field label="Expected life (years)">
            <input
              type="number"
              step="0.1"
              className={inputClass}
              value={assetForm.expected_life_years}
              onChange={(e) => setAssetForm((f) => ({ ...f, expected_life_years: e.target.value }))}
            />
          </Field>
          <Field label="Useful life end date">
            <input
              type="date"
              className={inputClass}
              value={assetForm.useful_life_end_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, useful_life_end_date: e.target.value }))}
            />
          </Field>
          <Field label="Disposal date">
            <input
              type="date"
              className={inputClass}
              value={assetForm.disposal_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, disposal_date: e.target.value }))}
            />
          </Field>
          <Field label="Condition">
            <select
              className={inputClass}
              value={assetForm.condition_status}
              onChange={(e) => setAssetForm((f) => ({ ...f, condition_status: e.target.value }))}
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value || 'x'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Insurance</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Insurer / broker">
            <input
              className={inputClass}
              value={assetForm.insurance_provider}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_provider: e.target.value }))}
            />
          </Field>
          <Field label="Policy number">
            <input
              className={inputClass}
              value={assetForm.insurance_policy_number}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_policy_number: e.target.value }))}
            />
          </Field>
          <Field label="Cover type">
            <input
              className={inputClass}
              placeholder="e.g. All risks"
              value={assetForm.insurance_cover_type}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_cover_type: e.target.value }))}
            />
          </Field>
          <Field label="Insurance contact">
            <input
              className={inputClass}
              value={assetForm.insurance_contact}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_contact: e.target.value }))}
            />
          </Field>
          <Field label="Cover start">
            <input
              type="date"
              className={inputClass}
              value={assetForm.insurance_start_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_start_date: e.target.value }))}
            />
          </Field>
          <Field label="Cover expires">
            <input
              type="date"
              className={inputClass}
              value={assetForm.insurance_expiry_date}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))}
            />
          </Field>
          <Field label="Annual premium (ZAR)">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={assetForm.insurance_premium_annual}
              onChange={(e) => setAssetForm((f) => ({ ...f, insurance_premium_annual: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Insurance notes">
          <textarea
            className={`${inputClass} min-h-[4rem]`}
            value={assetForm.insurance_notes}
            onChange={(e) => setAssetForm((f) => ({ ...f, insurance_notes: e.target.value }))}
          />
        </Field>
        <Field label="General notes">
          <textarea
            className={`${inputClass} min-h-[4rem]`}
            value={assetForm.notes}
            onChange={(e) => setAssetForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </Field>

        <button
          type="button"
          className={btnPrimary}
          disabled={!assetForm.category_id || !assetForm.name.trim()}
          onClick={() =>
            officeAdmin.assets
              .create(buildPayload(assetForm))
              .then((r) => {
                onFlash(`Asset added${r.asset?.asset_code ? ` — ${r.asset.asset_code}` : ''}. Open it below to attach photos or documents.`);
                setAssetForm(emptyAssetForm());
                setAssetCodePreview('');
                setShowRegisterForm(false);
                onReload();
                if (r.asset?.id) loadDetail(r.asset.id);
              })
              .catch((e) => onError(e.message))
          }
        >
          Register asset
        </button>
      </div>
      )}

      <div className="app-glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
              <th className="p-3">Code</th>
              <th className="p-3">Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Condition</th>
              <th className="p-3">Warranty</th>
              <th className="p-3">Insurance</th>
              <th className="p-3">Files</th>
              <th className="p-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr
                key={a.id}
                className={`border-b border-surface-100 cursor-pointer hover:bg-surface-50/80 dark:hover:bg-surface-900/40 ${selectedId === a.id ? 'bg-brand-50/50 dark:bg-brand-950/20' : ''}`}
                onClick={() => loadDetail(a.id)}
              >
                <td className="p-3 font-mono text-xs">{a.asset_code}</td>
                <td className="p-3 font-medium">{a.name}</td>
                <td className="p-3">{a.category_name || a.category || '—'}</td>
                <td className="p-3 capitalize">{a.condition_status || '—'}</td>
                <td className="p-3 whitespace-nowrap">{fmtDate(a.warranty_expiry_date)}</td>
                <td className="p-3 whitespace-nowrap">{fmtDate(a.insurance_expiry_date)}</td>
                <td className="p-3">{Number(a.attachment_count) || 0}</td>
                <td className="p-3">
                  <button
                    type="button"
                    className="text-xs text-brand-600 font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadDetail(a.id);
                    }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <div className="app-glass-card p-5 space-y-5 border-2 border-brand-200/60 dark:border-brand-800/50">
          <div className="flex flex-wrap justify-between gap-2 items-start">
            <div>
              <h3 className="text-lg font-semibold">Asset detail & attachments</h3>
              <p className="text-xs text-surface-500">Update lifecycle and insurance fields; upload multiple photos or documents.</p>
            </div>
            <button type="button" className={btnSecondary} onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          {detailLoading ? (
            <p className="text-sm text-surface-500">Loading…</p>
          ) : (
            <>
              <Field label="Category">
                <select
                  className={inputClass}
                  value={detailForm.category_id}
                  onChange={(e) => setDetailForm((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {assetCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({cat.code_prefix})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Name">
                  <input className={inputClass} value={detailForm.name} onChange={(e) => setDetailForm((f) => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label="Location">
                  <input className={inputClass} value={detailForm.location} onChange={(e) => setDetailForm((f) => ({ ...f, location: e.target.value }))} />
                </Field>
                <Field label="Serial">
                  <input className={inputClass} value={detailForm.serial_number} onChange={(e) => setDetailForm((f) => ({ ...f, serial_number: e.target.value }))} />
                </Field>
                <Field label="Manufacturer">
                  <input className={inputClass} value={detailForm.manufacturer} onChange={(e) => setDetailForm((f) => ({ ...f, manufacturer: e.target.value }))} />
                </Field>
                <Field label="Model">
                  <input className={inputClass} value={detailForm.model} onChange={(e) => setDetailForm((f) => ({ ...f, model: e.target.value }))} />
                </Field>
                <Field label="Purchase date">
                  <input type="date" className={inputClass} value={detailForm.purchase_date} onChange={(e) => setDetailForm((f) => ({ ...f, purchase_date: e.target.value }))} />
                </Field>
                <Field label="Purchase value">
                  <input type="number" step="0.01" className={inputClass} value={detailForm.purchase_value} onChange={(e) => setDetailForm((f) => ({ ...f, purchase_value: e.target.value }))} />
                </Field>
                <Field label="Condition">
                  <select className={inputClass} value={detailForm.condition_status} onChange={(e) => setDetailForm((f) => ({ ...f, condition_status: e.target.value }))}>
                    {CONDITION_OPTIONS.map((o) => (
                      <option key={o.value || 'x'} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Commissioned">
                  <input type="date" className={inputClass} value={detailForm.commissioned_date} onChange={(e) => setDetailForm((f) => ({ ...f, commissioned_date: e.target.value }))} />
                </Field>
                <Field label="Warranty expires">
                  <input type="date" className={inputClass} value={detailForm.warranty_expiry_date} onChange={(e) => setDetailForm((f) => ({ ...f, warranty_expiry_date: e.target.value }))} />
                </Field>
                <Field label="Expected life (yrs)">
                  <input type="number" step="0.1" className={inputClass} value={detailForm.expected_life_years} onChange={(e) => setDetailForm((f) => ({ ...f, expected_life_years: e.target.value }))} />
                </Field>
                <Field label="Useful life end">
                  <input type="date" className={inputClass} value={detailForm.useful_life_end_date} onChange={(e) => setDetailForm((f) => ({ ...f, useful_life_end_date: e.target.value }))} />
                </Field>
                <Field label="Disposal date">
                  <input type="date" className={inputClass} value={detailForm.disposal_date} onChange={(e) => setDetailForm((f) => ({ ...f, disposal_date: e.target.value }))} />
                </Field>
                <Field label="Insurer">
                  <input className={inputClass} value={detailForm.insurance_provider} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_provider: e.target.value }))} />
                </Field>
                <Field label="Policy number">
                  <input className={inputClass} value={detailForm.insurance_policy_number} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_policy_number: e.target.value }))} />
                </Field>
                <Field label="Cover type">
                  <input className={inputClass} value={detailForm.insurance_cover_type} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_cover_type: e.target.value }))} />
                </Field>
                <Field label="Insurance start">
                  <input type="date" className={inputClass} value={detailForm.insurance_start_date} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_start_date: e.target.value }))} />
                </Field>
                <Field label="Insurance expires">
                  <input type="date" className={inputClass} value={detailForm.insurance_expiry_date} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))} />
                </Field>
                <Field label="Annual premium">
                  <input type="number" step="0.01" className={inputClass} value={detailForm.insurance_premium_annual} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_premium_annual: e.target.value }))} />
                </Field>
              </div>
              <Field label="Insurance notes">
                <textarea className={`${inputClass} min-h-[3rem]`} value={detailForm.insurance_notes} onChange={(e) => setDetailForm((f) => ({ ...f, insurance_notes: e.target.value }))} />
              </Field>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={saving} onClick={saveDetail}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  className="text-sm text-red-600"
                  onClick={() => {
                    if (!window.confirm('Delete this asset and all attachments?')) return;
                    officeAdmin.assets
                      .delete(selectedId)
                      .then(() => {
                        onFlash('Asset deleted.');
                        setSelectedId(null);
                        onReload();
                      })
                      .catch((e) => onError(e.message));
                  }}
                >
                  Delete asset
                </button>
              </div>

              <div className="border-t border-surface-200 dark:border-surface-700 pt-4 space-y-3">
                <h4 className="text-sm font-semibold">Photos & documents</h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Upload files (multiple)">
                    <input
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.xlsx,.xls"
                      className="text-sm w-full"
                      onChange={(e) => setUploadFiles([...(e.target.files || [])])}
                    />
                  </Field>
                  <Field label="Caption (optional)">
                    <input
                      className={inputClass}
                      value={uploadCaption}
                      onChange={(e) => setUploadCaption(e.target.value)}
                      placeholder="e.g. Insurance certificate 2026"
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={saving || !uploadFiles.length}
                  onClick={uploadAttachments}
                >
                  Upload {uploadFiles.length ? `(${uploadFiles.length})` : ''}
                </button>

                {attachments.length > 0 ? (
                  <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {attachments.map((att) => {
                      const url = officeAdmin.assets.attachmentFileUrl(selectedId, att.id);
                      const isImage = att.file_kind === 'photo' || String(att.mime_type || '').startsWith('image/');
                      return (
                        <li
                          key={att.id}
                          className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2"
                        >
                          {isImage ? (
                            <button
                              type="button"
                              className="block w-full"
                              onClick={() => openAttachmentWithAuth(url).catch((e) => onError(e.message))}
                            >
                              <img
                                src={url}
                                alt={att.original_name}
                                className="w-full h-32 object-cover rounded-md border border-surface-100"
                              />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-sm text-brand-600 underline text-left"
                              onClick={() => downloadAttachmentWithAuth(url, att.original_name).catch((e) => onError(e.message))}
                            >
                              {att.original_name}
                            </button>
                          )}
                          <p className="text-xs text-surface-500 truncate" title={att.original_name}>
                            {att.original_name}
                          </p>
                          {att.caption ? <p className="text-xs">{att.caption}</p> : null}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs text-brand-600"
                              onClick={() =>
                                (isImage ? openAttachmentWithAuth : downloadAttachmentWithAuth)(url, att.original_name).catch(
                                  (e) => onError(e.message)
                                )
                              }
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="text-xs text-red-600"
                              onClick={() => {
                                if (!window.confirm('Remove this file?')) return;
                                officeAdmin.assets
                                  .deleteAttachment(selectedId, att.id)
                                  .then(() => {
                                    onFlash('Attachment removed.');
                                    loadDetail(selectedId);
                                    onReload();
                                  })
                                  .catch((e) => onError(e.message));
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-surface-500">No files attached yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
