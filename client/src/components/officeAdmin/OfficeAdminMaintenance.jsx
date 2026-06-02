import { useState, useMemo } from 'react';
import { officeAdmin, downloadAttachmentWithAuth, openAttachmentWithAuth } from '../../api';
import {
  FAULT_CATEGORIES,
  MAINTENANCE_TYPES,
  PROVIDER_TYPES,
  REPORT_PRIORITIES,
  REPORT_STATUSES,
} from '../../lib/officeAdminTabs.js';
import {
  exportMaintenanceReportsExcel,
  exportMaintenanceReportsPdf,
  exportMaintenanceHistoryExcel,
  exportMaintenanceHistoryPdf,
} from '../../lib/officeAdminExports.js';

const inputClass =
  'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900 dark:border-surface-600';
const btnPrimary =
  'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
const btnSecondary =
  'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50 dark:border-surface-600 dark:hover:bg-surface-800';

function dateInput(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return s.length === 10 ? s : '';
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

function emptyReportForm() {
  return {
    asset_id: '',
    title: '',
    description: '',
    priority: 'medium',
    location: '',
    fault_category: '',
    reporter_contact: '',
    preferred_visit_date: '',
    safety_risk: false,
    external_reference: '',
    assigned_to: '',
    work_order_number: '',
    provider_type: 'external',
  };
}

function emptyRecordForm() {
  return {
    asset_id: '',
    report_id: '',
    title: '',
    maintenance_type: 'repair',
    description: '',
    cost: '',
    performed_by: '',
    performed_at: dateInput(new Date()),
    next_due_at: '',
    provider_type: 'external',
    vendor_name: '',
    vendor_contact: '',
    vendor_phone: '',
    labor_hours: '',
    parts_used: '',
    invoice_reference: '',
    work_order_number: '',
    accounting_reference: '',
  };
}

function reportToForm(r) {
  if (!r) return emptyReportForm();
  return {
    asset_id: r.asset_id || '',
    title: r.title || '',
    description: r.description || '',
    priority: r.priority || 'medium',
    status: r.status || 'open',
    location: r.location || '',
    fault_category: r.fault_category || '',
    reporter_contact: r.reporter_contact || '',
    preferred_visit_date: dateInput(r.preferred_visit_date),
    safety_risk: Boolean(r.safety_risk),
    external_reference: r.external_reference || '',
    assigned_to: r.assigned_to || '',
    work_order_number: r.work_order_number || '',
    provider_type: r.provider_type || '',
    manager_notes: r.manager_notes || '',
  };
}

function recordToForm(m) {
  if (!m) return emptyRecordForm();
  return {
    asset_id: m.asset_id || '',
    report_id: m.report_id || '',
    title: m.title || '',
    maintenance_type: m.maintenance_type || 'repair',
    description: m.description || '',
    cost: m.cost != null ? String(m.cost) : '',
    performed_by: m.performed_by || '',
    performed_at: dateInput(m.performed_at),
    next_due_at: dateInput(m.next_due_at),
    provider_type: m.provider_type || 'external',
    vendor_name: m.vendor_name || '',
    vendor_contact: m.vendor_contact || '',
    vendor_phone: m.vendor_phone || '',
    labor_hours: m.labor_hours != null ? String(m.labor_hours) : '',
    parts_used: m.parts_used || '',
    invoice_reference: m.invoice_reference || '',
    work_order_number: m.work_order_number || '',
    accounting_reference: m.accounting_reference || '',
  };
}

function buildReportPayload(form) {
  const p = { ...form };
  if (!p.asset_id) p.asset_id = null;
  if (!p.preferred_visit_date) p.preferred_visit_date = null;
  return p;
}

function buildRecordPayload(form) {
  const p = { ...form };
  ['cost', 'labor_hours'].forEach((k) => {
    if (p[k] === '') p[k] = null;
  });
  if (!p.report_id) p.report_id = null;
  if (!p.next_due_at) p.next_due_at = null;
  if (!p.performed_at) p.performed_at = new Date().toISOString();
  return p;
}

function AssetSearchSelect({ assets, value, onChange, required }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assets.slice(0, 80);
    return assets.filter((a) => `${a.asset_code} ${a.name} ${a.location || ''}`.toLowerCase().includes(s)).slice(0, 80);
  }, [assets, q]);

  return (
    <div className="space-y-2">
      <input
        className={inputClass}
        placeholder="Search asset code or name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select className={inputClass} value={value} required={required} onChange={(e) => onChange(e.target.value)}>
        <option value="">{required ? 'Select asset…' : 'No linked asset'}</option>
        {filtered.map((a) => (
          <option key={a.id} value={a.id}>
            {a.asset_code} — {a.name}
            {a.location ? ` (${a.location})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function AttachmentsPanel({ kind, entityId, attachments, onRefresh, onError, onFlash }) {
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const api = kind === 'report' ? officeAdmin.maintenance : officeAdmin.maintenance;
  const urlFn = kind === 'report' ? api.reportAttachmentUrl : api.recordAttachmentUrl;
  const uploadFn = kind === 'report' ? api.uploadReportAttachments : api.uploadRecordAttachments;
  const deleteFn = kind === 'report' ? api.deleteReportAttachment : api.deleteRecordAttachment;

  const upload = async () => {
    if (!entityId || !files.length) return;
    setSaving(true);
    try {
      await uploadFn(entityId, files);
      setFiles([]);
      onFlash(`${files.length} file(s) uploaded.`);
      onRefresh();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-surface-200 dark:border-surface-700 pt-4 space-y-3">
      <h4 className="text-sm font-semibold">Photos & documents</h4>
      <input
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xlsx,.xls"
        className="text-sm w-full"
        onChange={(e) => setFiles([...(e.target.files || [])])}
      />
      <button type="button" className={btnSecondary} disabled={saving || !files.length} onClick={upload}>
        Upload {files.length ? `(${files.length})` : ''}
      </button>
      {attachments?.length > 0 ? (
        <ul className="space-y-2">
          {attachments.map((att) => {
            const url = urlFn(entityId, att.id);
            const isImage = att.file_kind === 'photo' || String(att.mime_type || '').startsWith('image/');
            return (
              <li key={att.id} className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-brand-600 underline"
                  onClick={() =>
                    (isImage ? openAttachmentWithAuth : downloadAttachmentWithAuth)(url, att.original_name).catch(
                      (e) => onError(e.message)
                    )
                  }
                >
                  {att.original_name}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => {
                    if (!window.confirm('Remove this file?')) return;
                    deleteFn(entityId, att.id)
                      .then(() => {
                        onFlash('Attachment removed.');
                        onRefresh();
                      })
                      .catch((e) => onError(e.message));
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-surface-500">No attachments yet.</p>
      )}
    </div>
  );
}

const VIEW_META = {
  maintenance_reports: {
    title: 'Maintenance reports',
    subtitle: 'All fault reports and their status. Grant this tab to external maintenance providers.',
  },
  maintenance_history: {
    title: 'Maintenance history',
    subtitle: 'Completed work records with costs, vendors, and attachments.',
  },
  maintenance_report_broken: {
    title: 'Report faulty item',
    subtitle: 'Log a new fault or broken asset for the maintenance team or external contractor.',
  },
  maintenance_record: {
    title: 'Record maintenance',
    subtitle: 'Log work performed on an asset (internal or external). Link to an open report if applicable.',
  },
};

export default function OfficeAdminMaintenance({
  view,
  assets,
  reports,
  records,
  onReload,
  onError,
  onFlash,
}) {
  const meta = VIEW_META[view] || VIEW_META.maintenance_reports;
  const [showForm, setShowForm] = useState(false);
  const [reportForm, setReportForm] = useState(emptyReportForm);
  const [recordForm, setRecordForm] = useState(emptyRecordForm);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [detailForm, setDetailForm] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);

  const openReports = useMemo(
    () => reports.filter((r) => !['resolved', 'closed'].includes(r.status)),
    [reports]
  );

  const filteredReports = useMemo(() => {
    let list = reports;
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.title, r.asset_code, r.asset_name, r.asset_name_snapshot, r.location, r.assigned_to]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [reports, statusFilter, search]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((m) =>
      [m.title, m.asset_code, m.asset_name, m.vendor_name, m.performed_by, m.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [records, search]);

  const loadReportDetail = async (id) => {
    setSelectedReportId(id);
    setSelectedRecordId(null);
    onError('');
    try {
      const d = await officeAdmin.maintenance.getReport(id);
      setDetailForm(reportToForm(d.report));
      setAttachments(d.attachments || []);
    } catch (e) {
      onError(e.message);
      setSelectedReportId(null);
    }
  };

  const loadRecordDetail = async (id) => {
    setSelectedRecordId(id);
    setSelectedReportId(null);
    onError('');
    try {
      const d = await officeAdmin.maintenance.getRecord(id);
      setDetailForm(recordToForm(d.record));
      setAttachments(d.attachments || []);
    } catch (e) {
      onError(e.message);
      setSelectedRecordId(null);
    }
  };

  const submitReport = async () => {
    if (!reportForm.title.trim()) return;
    setSaving(true);
    try {
      const r = await officeAdmin.maintenance.createReport(buildReportPayload(reportForm));
      const id = r.report?.id;
      if (id && pendingFiles.length) {
        await officeAdmin.maintenance.uploadReportAttachments(id, pendingFiles);
      }
      onFlash('Fault report submitted.');
      setReportForm(emptyReportForm());
      setPendingFiles([]);
      setShowForm(false);
      onReload();
      if (id) loadReportDetail(id);
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitRecord = async () => {
    if (!recordForm.asset_id || !recordForm.description.trim()) return;
    setSaving(true);
    try {
      const r = await officeAdmin.maintenance.createRecord(buildRecordPayload(recordForm));
      const id = r.record?.id;
      if (id && pendingFiles.length) {
        await officeAdmin.maintenance.uploadRecordAttachments(id, pendingFiles);
      }
      onFlash('Maintenance record saved.');
      setRecordForm(emptyRecordForm());
      setPendingFiles([]);
      setShowForm(false);
      onReload();
      if (id) loadRecordDetail(id);
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveReportDetail = async () => {
    if (!selectedReportId) return;
    setSaving(true);
    try {
      const d = await officeAdmin.maintenance.updateReport(selectedReportId, buildReportPayload(detailForm));
      setDetailForm(reportToForm(d.report));
      setAttachments(d.attachments || []);
      onFlash('Report updated.');
      onReload();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveRecordDetail = async () => {
    if (!selectedRecordId) return;
    setSaving(true);
    try {
      const d = await officeAdmin.maintenance.updateRecord(selectedRecordId, buildRecordPayload(detailForm));
      setDetailForm(recordToForm(d.record));
      setAttachments(d.attachments || []);
      onFlash('Record updated.');
      onReload();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const renderReportFormFields = (values, setValues, { includeStatus, includeManagerNotes } = {}) => (
    <>
      <Field label="Asset (optional)">
        <AssetSearchSelect assets={assets} value={values.asset_id} onChange={(id) => setValues((f) => ({ ...f, asset_id: id }))} />
      </Field>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Issue title *">
          <input className={inputClass} value={values.title} onChange={(e) => setValues((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Priority">
          <select className={inputClass} value={values.priority} onChange={(e) => setValues((f) => ({ ...f, priority: e.target.value }))}>
            {REPORT_PRIORITIES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Fault category">
          <select className={inputClass} value={values.fault_category} onChange={(e) => setValues((f) => ({ ...f, fault_category: e.target.value }))}>
            {FAULT_CATEGORIES.map((o) => (
              <option key={o.value || 'x'} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input className={inputClass} value={values.location} onChange={(e) => setValues((f) => ({ ...f, location: e.target.value }))} />
        </Field>
        <Field label="Your contact">
          <input className={inputClass} value={values.reporter_contact} onChange={(e) => setValues((f) => ({ ...f, reporter_contact: e.target.value }))} />
        </Field>
        <Field label="Preferred visit date">
          <input type="date" className={inputClass} value={values.preferred_visit_date} onChange={(e) => setValues((f) => ({ ...f, preferred_visit_date: e.target.value }))} />
        </Field>
        <Field label="Assigned to">
          <input className={inputClass} value={values.assigned_to} onChange={(e) => setValues((f) => ({ ...f, assigned_to: e.target.value }))} placeholder="Technician or company" />
        </Field>
        <Field label="Provider">
          <select className={inputClass} value={values.provider_type} onChange={(e) => setValues((f) => ({ ...f, provider_type: e.target.value }))}>
            <option value="">—</option>
            {PROVIDER_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Work order #">
          <input className={inputClass} value={values.work_order_number} onChange={(e) => setValues((f) => ({ ...f, work_order_number: e.target.value }))} />
        </Field>
        <Field label="External reference">
          <input className={inputClass} value={values.external_reference} onChange={(e) => setValues((f) => ({ ...f, external_reference: e.target.value }))} />
        </Field>
        {includeStatus && (
          <Field label="Status">
            <select className={inputClass} value={values.status} onChange={(e) => setValues((f) => ({ ...f, status: e.target.value }))}>
              {REPORT_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Description *">
        <textarea className={`${inputClass} min-h-[5rem]`} value={values.description} onChange={(e) => setValues((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.safety_risk} onChange={(e) => setValues((f) => ({ ...f, safety_risk: e.target.checked }))} />
        Safety risk — requires urgent attention
      </label>
      {includeManagerNotes && (
        <Field label="Manager notes">
          <textarea className={`${inputClass} min-h-[3rem]`} value={values.manager_notes || ''} onChange={(e) => setValues((f) => ({ ...f, manager_notes: e.target.value }))} />
        </Field>
      )}
    </>
  );

  const renderRecordFormFields = (values, setValues) => (
    <>
      <Field label="Asset *">
        <AssetSearchSelect assets={assets} value={values.asset_id} required onChange={(id) => setValues((f) => ({ ...f, asset_id: id }))} />
      </Field>
      <Field label="Link to open report (optional)">
        <select className={inputClass} value={values.report_id} onChange={(e) => setValues((f) => ({ ...f, report_id: e.target.value }))}>
          <option value="">—</option>
          {openReports.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} ({r.status})
            </option>
          ))}
        </select>
      </Field>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Work title">
          <input className={inputClass} value={values.title} onChange={(e) => setValues((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Maintenance type">
          <select className={inputClass} value={values.maintenance_type} onChange={(e) => setValues((f) => ({ ...f, maintenance_type: e.target.value }))}>
            {MAINTENANCE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Provider">
          <select className={inputClass} value={values.provider_type} onChange={(e) => setValues((f) => ({ ...f, provider_type: e.target.value }))}>
            {PROVIDER_TYPES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Performed at">
          <input type="date" className={inputClass} value={values.performed_at} onChange={(e) => setValues((f) => ({ ...f, performed_at: e.target.value }))} />
        </Field>
        <Field label="Performed by">
          <input className={inputClass} value={values.performed_by} onChange={(e) => setValues((f) => ({ ...f, performed_by: e.target.value }))} />
        </Field>
        <Field label="Cost (ZAR)">
          <input type="number" step="0.01" className={inputClass} value={values.cost} onChange={(e) => setValues((f) => ({ ...f, cost: e.target.value }))} />
        </Field>
        <Field label="Labor hours">
          <input type="number" step="0.1" className={inputClass} value={values.labor_hours} onChange={(e) => setValues((f) => ({ ...f, labor_hours: e.target.value }))} />
        </Field>
        <Field label="Next due">
          <input type="date" className={inputClass} value={values.next_due_at} onChange={(e) => setValues((f) => ({ ...f, next_due_at: e.target.value }))} />
        </Field>
        <Field label="Vendor / contractor">
          <input className={inputClass} value={values.vendor_name} onChange={(e) => setValues((f) => ({ ...f, vendor_name: e.target.value }))} />
        </Field>
        <Field label="Vendor contact">
          <input className={inputClass} value={values.vendor_contact} onChange={(e) => setValues((f) => ({ ...f, vendor_contact: e.target.value }))} />
        </Field>
        <Field label="Vendor phone">
          <input className={inputClass} value={values.vendor_phone} onChange={(e) => setValues((f) => ({ ...f, vendor_phone: e.target.value }))} />
        </Field>
        <Field label="Work order #">
          <input className={inputClass} value={values.work_order_number} onChange={(e) => setValues((f) => ({ ...f, work_order_number: e.target.value }))} />
        </Field>
        <Field label="Invoice reference">
          <input className={inputClass} value={values.invoice_reference} onChange={(e) => setValues((f) => ({ ...f, invoice_reference: e.target.value }))} />
        </Field>
        <Field label="Accounting reference">
          <input className={inputClass} value={values.accounting_reference} onChange={(e) => setValues((f) => ({ ...f, accounting_reference: e.target.value }))} />
        </Field>
      </div>
      <Field label="Work performed *">
        <textarea className={`${inputClass} min-h-[5rem]`} value={values.description} onChange={(e) => setValues((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <Field label="Parts / materials used">
        <textarea className={`${inputClass} min-h-[3rem]`} value={values.parts_used} onChange={(e) => setValues((f) => ({ ...f, parts_used: e.target.value }))} />
      </Field>
    </>
  );

  const exportButtons = (() => {
    if (view === 'maintenance_reports' || view === 'maintenance_report_broken') {
      return (
        <>
          <button type="button" className={btnSecondary} onClick={() => exportMaintenanceReportsExcel(reports)}>Excel</button>
          <button type="button" className={btnSecondary} onClick={() => exportMaintenanceReportsPdf(reports)}>PDF</button>
        </>
      );
    }
    if (view === 'maintenance_history' || view === 'maintenance_record') {
      return (
        <>
          <button type="button" className={btnSecondary} onClick={() => exportMaintenanceHistoryExcel(records)}>Excel</button>
          <button type="button" className={btnSecondary} onClick={() => exportMaintenanceHistoryPdf(records)}>PDF</button>
        </>
      );
    }
    return null;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-2 items-start">
        <div>
          <h2 className="text-xl font-semibold">{meta.title}</h2>
          <p className="text-sm text-surface-500 mt-1">{meta.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">{exportButtons}</div>
      </div>

      {(view === 'maintenance_reports' || view === 'maintenance_history') && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className={`${inputClass} flex-1 min-w-[12rem]`}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {view === 'maintenance_reports' && (
            <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {REPORT_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {(view === 'maintenance_report_broken' || view === 'maintenance_record') && (
        <button
          type="button"
          className={showForm ? btnPrimary : btnSecondary}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm
            ? 'Hide form'
            : view === 'maintenance_report_broken'
              ? 'Report faulty item'
              : 'Record maintenance'}
        </button>
      )}

      {view === 'maintenance_report_broken' && showForm && (
        <div className="app-glass-card p-4 space-y-4">
          {renderReportFormFields(reportForm, setReportForm)}
          <Field label="Attachments (optional)">
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx" className="text-sm w-full" onChange={(e) => setPendingFiles([...(e.target.files || [])])} />
          </Field>
          <button type="button" className={btnPrimary} disabled={saving || !reportForm.title.trim()} onClick={submitReport}>
            {saving ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      )}

      {view === 'maintenance_record' && showForm && (
        <div className="app-glass-card p-4 space-y-4">
          {renderRecordFormFields(recordForm, setRecordForm)}
          <Field label="Attachments (photos, invoice, job card)">
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx" className="text-sm w-full" onChange={(e) => setPendingFiles([...(e.target.files || [])])} />
          </Field>
          <button
            type="button"
            className={btnPrimary}
            disabled={saving || !recordForm.asset_id || !recordForm.description.trim()}
            onClick={submitRecord}
          >
            {saving ? 'Saving…' : 'Save maintenance record'}
          </button>
        </div>
      )}

      {view === 'maintenance_reports' && (
        <div className="app-glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
                <th className="p-3">Title</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Asset</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Created</th>
                <th className="p-3">Files</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b cursor-pointer hover:bg-surface-50/80 ${selectedReportId === r.id ? 'bg-brand-50/50' : ''} ${r.safety_risk ? 'bg-red-50/40' : ''}`}
                  onClick={() => loadReportDetail(r.id)}
                >
                  <td className="p-3 font-medium">{r.title}</td>
                  <td className="p-3 capitalize">{r.status?.replace(/_/g, ' ')}</td>
                  <td className="p-3 capitalize">{r.priority}</td>
                  <td className="p-3">{r.asset_code || r.asset_name_snapshot || '—'}</td>
                  <td className="p-3">{r.assigned_to || '—'}</td>
                  <td className="p-3 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-3">{Number(r.attachment_count) || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'maintenance_history' && (
        <div className="app-glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
                <th className="p-3">Asset</th>
                <th className="p-3">Title</th>
                <th className="p-3">Type</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Cost</th>
                <th className="p-3">Performed</th>
                <th className="p-3">Files</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((m) => (
                <tr
                  key={m.id}
                  className={`border-b cursor-pointer hover:bg-surface-50/80 ${selectedRecordId === m.id ? 'bg-brand-50/50' : ''}`}
                  onClick={() => loadRecordDetail(m.id)}
                >
                  <td className="p-3 font-mono text-xs">{m.asset_code}</td>
                  <td className="p-3">{m.title || m.description?.slice(0, 40) || '—'}</td>
                  <td className="p-3 capitalize">{m.maintenance_type}</td>
                  <td className="p-3">{m.vendor_name || m.performed_by || '—'}</td>
                  <td className="p-3">{m.cost != null ? `R ${Number(m.cost).toFixed(2)}` : '—'}</td>
                  <td className="p-3 whitespace-nowrap">{fmtDate(m.performed_at)}</td>
                  <td className="p-3">{Number(m.attachment_count) || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedReportId && detailForm && view === 'maintenance_reports' && (
        <div className="app-glass-card p-5 space-y-4 border-2 border-brand-200/60">
          <div className="flex justify-between gap-2">
            <h3 className="text-lg font-semibold">Report detail</h3>
            <button type="button" className={btnSecondary} onClick={() => setSelectedReportId(null)}>Close</button>
          </div>
          {renderReportFormFields(detailForm, setDetailForm, { includeStatus: true, includeManagerNotes: true })}
          <button type="button" className={btnPrimary} disabled={saving} onClick={saveReportDetail}>Save changes</button>
          <AttachmentsPanel
            kind="report"
            entityId={selectedReportId}
            attachments={attachments}
            onRefresh={() => loadReportDetail(selectedReportId)}
            onError={onError}
            onFlash={onFlash}
          />
        </div>
      )}

      {selectedRecordId && detailForm && view === 'maintenance_history' && (
        <div className="app-glass-card p-5 space-y-4 border-2 border-brand-200/60">
          <div className="flex justify-between gap-2">
            <h3 className="text-lg font-semibold">Maintenance record</h3>
            <button type="button" className={btnSecondary} onClick={() => setSelectedRecordId(null)}>Close</button>
          </div>
          {renderRecordFormFields(detailForm, setDetailForm)}
          <button type="button" className={btnPrimary} disabled={saving} onClick={saveRecordDetail}>Save changes</button>
          <AttachmentsPanel
            kind="record"
            entityId={selectedRecordId}
            attachments={attachments}
            onRefresh={() => loadRecordDetail(selectedRecordId)}
            onError={onError}
            onFlash={onFlash}
          />
        </div>
      )}
    </div>
  );
}
