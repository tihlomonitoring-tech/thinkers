import { useState, useEffect, useCallback, useMemo } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';
import { downloadEmployeeDetailsExcel, downloadEmployeeDetailsPdf } from '../lib/employeeDetailsExport.js';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function Field({ label, value }) {
  return (
    <div className="text-sm">
      <p className="text-surface-500 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="text-surface-900 mt-0.5 whitespace-pre-wrap break-words">{value && String(value).trim() ? value : '—'}</p>
    </div>
  );
}

export default function EmployeeDetailsManagementSection({ onError }) {
  const [loadingList, setLoadingList] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [advancedPick, setAdvancedPick] = useState(false);
  const [exportIds, setExportIds] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);

  const loadList = useCallback(() => {
    setLoadingList(true);
    onError('');
    pm.employeeDetails
      .directory()
      .then((d) => setEmployees(d.employees || []))
      .catch((e) => onError(e?.message || 'Could not load directory'))
      .finally(() => setLoadingList(false));
  }, [onError]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setExportIds((prev) => new Set([...prev].filter((id) => employees.some((e) => e.user_id === id))));
  }, [employees]);

  useEffect(() => {
    if (!selectedId) {
      setBundle(null);
      return;
    }
    setDetailLoading(true);
    onError('');
    pm.employeeDetails
      .getForUser(selectedId)
      .then((d) => setBundle(d))
      .catch((e) => onError(e?.message || 'Could not load employee'))
      .finally(() => setDetailLoading(false));
  }, [selectedId, onError]);

  const det = bundle?.details || {};

  const exportCountLabel = useMemo(() => {
    if (advancedPick) return `${exportIds.size} selected`;
    return `all ${employees.length}`;
  }, [advancedPick, exportIds.size, employees.length]);

  const toggleExportId = (id) => {
    setExportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllForExport = () => {
    setExportIds(new Set(employees.map((e) => e.user_id)));
  };

  const clearExportSelection = () => {
    setExportIds(new Set());
  };

  const setAdvancedPickWrapped = (on) => {
    setAdvancedPick(on);
    if (!on) setExportIds(new Set());
  };

  const runExport = async (kind) => {
    const ids = advancedPick ? [...exportIds] : employees.map((e) => e.user_id);
    if (!ids.length) {
      onError(advancedPick ? 'Select at least one employee for the export.' : 'No employees to export.');
      return;
    }
    setExporting(true);
    onError('');
    try {
      const bundles = await Promise.all(ids.map((userId) => pm.employeeDetails.getForUser(userId)));
      if (kind === 'excel') await downloadEmployeeDetailsExcel(bundles);
      else await downloadEmployeeDetailsPdf(bundles);
    } catch (e) {
      onError(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold text-surface-900">Employee details</h1>
        <InfoHint
          title="Employee details (management)"
          text="View HR records from Profile → Employee details. Export a spreadsheet or PDF for the whole team, or use Advanced to tick specific people first. Exports pull the latest saved data per employee."
        />
      </div>
      <p className="text-sm text-surface-600 max-w-3xl">Select an employee to review their submitted information. This view is read-only.</p>

      <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting || employees.length === 0 || (advancedPick && exportIds.size === 0)}
              onClick={() => runExport('excel')}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              {exporting ? 'Preparing…' : 'Download Excel'}
            </button>
            <button
              type="button"
              disabled={exporting || employees.length === 0 || (advancedPick && exportIds.size === 0)}
              onClick={() => runExport('pdf')}
              className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50 disabled:pointer-events-none"
            >
              {exporting ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
          <p className="text-xs text-surface-500 lg:text-right">
            Includes <span className="font-semibold text-surface-700">{exportCountLabel}</span> employee(s).
          </p>
        </div>

        <div className="border border-surface-100 rounded-lg p-3 bg-surface-50/80 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="mt-1 rounded border-surface-300"
              checked={advancedPick}
              onChange={(e) => setAdvancedPickWrapped(e.target.checked)}
            />
            <span>
              <span className="font-medium text-surface-900">Advanced: choose employees</span>
              <span className="block text-surface-600 text-xs mt-0.5">
                When enabled, tick people in the list below; Excel and PDF only include checked employees. When off, exports include everyone in the directory.
              </span>
            </span>
          </label>
          {advancedPick && employees.length > 0 && (
            <div className="flex flex-wrap gap-2 pl-7">
              <button type="button" onClick={selectAllForExport} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Select all
              </button>
              <span className="text-surface-300">|</span>
              <button type="button" onClick={clearExportSelection} className="text-xs font-medium text-surface-600 hover:text-surface-900">
                Clear selection
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white rounded-xl border border-surface-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex justify-between items-center">
            <span className="text-sm font-semibold text-surface-900">Employees</span>
            <button type="button" onClick={loadList} className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Refresh
            </button>
          </div>
          <div className="max-h-[min(70vh,560px)] overflow-y-auto">
            {loadingList ? (
              <p className="p-4 text-sm text-surface-500">Loading…</p>
            ) : employees.length === 0 ? (
              <p className="p-4 text-sm text-surface-500">No active employees in this tenant.</p>
            ) : (
              <ul className="divide-y divide-surface-100">
                {employees.map((e) => (
                  <li key={e.user_id} className="flex items-stretch">
                    {advancedPick && (
                      <label
                        className="flex items-center px-2.5 border-r border-surface-100 bg-surface-50/50 cursor-pointer shrink-0"
                        onClick={(ev) => ev.stopPropagation()}
                        onKeyDown={(ev) => ev.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={exportIds.has(e.user_id)}
                          onChange={() => toggleExportId(e.user_id)}
                          aria-label={`Include ${e.full_name || e.email} in export`}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.user_id)}
                      className={`flex-1 min-w-0 text-left px-4 py-3 text-sm transition-colors hover:bg-surface-50 ${
                        selectedId === e.user_id ? 'bg-brand-50 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'
                      }`}
                    >
                      <span className="font-medium text-surface-900 block truncate">{e.full_name || '—'}</span>
                      <span className="text-xs text-surface-500 block truncate">{e.email}</span>
                      <span className="text-[11px] text-surface-400 mt-1 block">Updated {formatDate(e.details_updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 min-w-0">
          {!selectedId && <p className="text-sm text-surface-500 bg-white rounded-xl border border-surface-200 p-6">Choose an employee from the list.</p>}
          {selectedId && detailLoading && <p className="text-sm text-surface-500">Loading record…</p>}
          {selectedId && !detailLoading && bundle && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6">
                <h2 className="text-lg font-semibold text-surface-900">{bundle.user?.full_name || 'Employee'}</h2>
                <p className="text-sm text-surface-500">{bundle.user?.email}</p>
                <p className="text-xs text-surface-400 mt-2">Record last updated {formatDate(det.updatedAt)}</p>
              </div>

              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 grid sm:grid-cols-2 gap-4">
                <Field label="First name(s) (ID)" value={det.legalFirstNames} />
                <Field label="Surname (ID)" value={det.legalSurname} />
                <Field label="ID / passport number" value={det.idDocumentNumber} />
                <Field label="Residential address" value={det.residentialAddress} />
              </div>

              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 grid sm:grid-cols-2 gap-4">
                <h3 className="sm:col-span-2 text-sm font-semibold text-surface-800">Next of kin</h3>
                <Field label="Name" value={det.nextOfKinName} />
                <Field label="Relationship" value={det.nextOfKinRelationship} />
                <Field label="Phone" value={det.nextOfKinPhone} />
                <Field label="Email" value={det.nextOfKinEmail} />
              </div>

              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 grid sm:grid-cols-2 gap-4">
                <h3 className="sm:col-span-2 text-sm font-semibold text-surface-800">Medical aid</h3>
                <Field label="Provider / scheme" value={det.medicalAidProvider} />
                <Field label="Member number" value={det.medicalAidMemberNo} />
                <Field label="Plan" value={det.medicalAidPlan} />
                <Field label="Notes" value={det.medicalAidNotes} />
              </div>

              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 grid sm:grid-cols-2 gap-4">
                <h3 className="sm:col-span-2 text-sm font-semibold text-surface-800">Banking</h3>
                <Field label="Bank" value={det.bankName} />
                <Field label="Account holder" value={det.bankAccountHolder} />
                <Field label="Account number" value={det.bankAccountNumber} />
                <Field label="Branch code" value={det.bankBranchCode} />
                <Field label="Account type" value={det.bankAccountType} />
              </div>

              <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6">
                <h3 className="text-sm font-semibold text-surface-800 mb-3">Attachments</h3>
                {(bundle.attachments || []).length === 0 ? (
                  <p className="text-sm text-surface-500">No attachments.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(bundle.attachments || []).map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-surface-100 last:border-0">
                        <span>
                          <span className="text-xs text-surface-500 uppercase">{a.folder_name}</span>
                          <span className="block font-medium text-surface-900">{a.file_name}</span>
                        </span>
                        <button
                          type="button"
                          className="text-brand-600 hover:underline text-xs shrink-0"
                          onClick={() => downloadAttachmentWithAuth(pm.employeeDetails.downloadUrl(a.id), a.file_name).catch((err) => onError(err?.message))}
                        >
                          Download
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
