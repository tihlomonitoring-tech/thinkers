import { useState, useEffect, useMemo, useCallback } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';

const emptyDetails = {
  legalFirstNames: '',
  legalSurname: '',
  idDocumentNumber: '',
  residentialAddress: '',
  nextOfKinName: '',
  nextOfKinRelationship: '',
  nextOfKinPhone: '',
  nextOfKinEmail: '',
  medicalAidProvider: '',
  medicalAidMemberNo: '',
  medicalAidPlan: '',
  medicalAidNotes: '',
  bankName: '',
  bankAccountHolder: '',
  bankAccountNumber: '',
  bankBranchCode: '',
  bankAccountType: '',
};

function inputCls() {
  return 'w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 text-sm dark:bg-surface-900 dark:border-surface-600 dark:text-surface-50';
}

export default function EmployeeDetailsTab({ onError }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(emptyDetails);
  const [attachments, setAttachments] = useState([]);
  const [uploadFolder, setUploadFolder] = useState('General');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkFolder, setBulkFolder] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    onError('');
    pm.employeeDetails
      .get()
      .then((d) => {
        setForm({ ...emptyDetails, ...(d.details || {}) });
        setAttachments(d.attachments || []);
      })
      .catch((e) => onError(e?.message || 'Could not load employee details'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const applyBundle = (d) => {
    if (d?.details) setForm({ ...emptyDetails, ...d.details });
    if (d?.attachments) setAttachments(d.attachments);
    setSelectedIds(new Set());
  };

  const grouped = useMemo(() => {
    const m = new Map();
    for (const a of attachments) {
      const key = a.folder_name || 'General';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [attachments]);

  const toggleSel = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    onError('');
    try {
      const d = await pm.employeeDetails.save(form);
      applyBundle(d);
    } catch (err) {
      onError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onUpload = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    onError('');
    pm.employeeDetails
      .uploadAttachments(files, uploadFolder.trim() || 'General')
      .then((d) => applyBundle(d))
      .catch((err) => onError(err?.message || 'Upload failed'))
      .finally(() => {
        setUploading(false);
        e.target.value = '';
      });
  };

  const moveSelectedToFolder = () => {
    const name = bulkFolder.trim();
    if (!name) {
      onError('Enter a folder name for the selected files');
      return;
    }
    if (!selectedIds.size) {
      onError('Select at least one attachment');
      return;
    }
    onError('');
    pm.employeeDetails
      .bulkAttachmentFolders([...selectedIds], name)
      .then((d) => applyBundle(d))
      .catch((e) => onError(e?.message || 'Could not update folders'));
  };

  const updateOneFolder = (id, folder_name) => {
    onError('');
    pm.employeeDetails
      .updateAttachmentFolder(id, folder_name)
      .then((d) => applyBundle(d))
      .catch((e) => onError(e?.message || 'Could not rename folder'));
  };

  const removeAttachment = (id) => {
    onError('');
    pm.employeeDetails
      .deleteAttachment(id)
      .then((d) => applyBundle(d))
      .catch((e) => onError(e?.message || 'Could not delete'));
  };

  if (loading) {
    return <p className="text-sm text-surface-500">Loading employee details…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Employee details</h1>
        <InfoHint
          title="Employee details"
          text="Complete your record as it appears on your ID, your full residential address, next of kin, medical aid, and banking details. Upload supporting documents and group them using folder names; you can rename a folder for one file or move several files to the same folder at once."
        />
      </div>

      <form onSubmit={save} className="space-y-8">
        <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Names (as on ID)</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">First name(s)</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.legalFirstNames}
                onChange={(e) => setForm((f) => ({ ...f, legalFirstNames: e.target.value }))}
                placeholder="Match your ID document"
              />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Surname</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.legalSurname}
                onChange={(e) => setForm((f) => ({ ...f, legalSurname: e.target.value }))}
                placeholder="Match your ID document"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">ID / passport number</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.idDocumentNumber}
                onChange={(e) => setForm((f) => ({ ...f, idDocumentNumber: e.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-3">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Residential address</h2>
          <textarea
            className={`min-h-[100px] ${inputCls()}`}
            value={form.residentialAddress}
            onChange={(e) => setForm((f) => ({ ...f, residentialAddress: e.target.value }))}
            placeholder="Full address including suburb, city, postal code"
          />
        </section>

        <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Next of kin</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Full name</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.nextOfKinName}
                onChange={(e) => setForm((f) => ({ ...f, nextOfKinName: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Relationship</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.nextOfKinRelationship}
                onChange={(e) => setForm((f) => ({ ...f, nextOfKinRelationship: e.target.value }))}
                placeholder="e.g. Spouse, parent"
              />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Phone</span>
              <input
                className={`mt-1 ${inputCls()}`}
                value={form.nextOfKinPhone}
                onChange={(e) => setForm((f) => ({ ...f, nextOfKinPhone: e.target.value }))}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Email</span>
              <input
                type="email"
                className={`mt-1 ${inputCls()}`}
                value={form.nextOfKinEmail}
                onChange={(e) => setForm((f) => ({ ...f, nextOfKinEmail: e.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Medical aid</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Provider / scheme</span>
              <input className={`mt-1 ${inputCls()}`} value={form.medicalAidProvider} onChange={(e) => setForm((f) => ({ ...f, medicalAidProvider: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Member number</span>
              <input className={`mt-1 ${inputCls()}`} value={form.medicalAidMemberNo} onChange={(e) => setForm((f) => ({ ...f, medicalAidMemberNo: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Plan / option</span>
              <input className={`mt-1 ${inputCls()}`} value={form.medicalAidPlan} onChange={(e) => setForm((f) => ({ ...f, medicalAidPlan: e.target.value }))} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Notes</span>
              <textarea className={`mt-1 min-h-[72px] ${inputCls()}`} value={form.medicalAidNotes} onChange={(e) => setForm((f) => ({ ...f, medicalAidNotes: e.target.value }))} placeholder="Dependants, gap cover, etc." />
            </label>
          </div>
        </section>

        <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Banking</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Bank</span>
              <input className={`mt-1 ${inputCls()}`} value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Account holder</span>
              <input className={`mt-1 ${inputCls()}`} value={form.bankAccountHolder} onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Account number</span>
              <input className={`mt-1 ${inputCls()}`} value={form.bankAccountNumber} onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} autoComplete="off" />
            </label>
            <label className="block text-sm">
              <span className="text-surface-600 dark:text-surface-400">Branch code</span>
              <input className={`mt-1 ${inputCls()}`} value={form.bankBranchCode} onChange={(e) => setForm((f) => ({ ...f, bankBranchCode: e.target.value }))} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Account type</span>
              <input className={`mt-1 ${inputCls()}`} value={form.bankAccountType} onChange={(e) => setForm((f) => ({ ...f, bankAccountType: e.target.value }))} placeholder="e.g. Cheque, savings" />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>

      <section className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-4 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Attachments</h2>
        <p className="text-sm text-surface-600 dark:text-surface-400">
          Upload multiple files. Set a folder name before uploading (e.g. &quot;ID copies&quot;, &quot;Medical aid card&quot;). Rename a file&apos;s folder inline, or select several files and move them to one folder.
        </p>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 items-start sm:items-end">
          <label className="block text-sm min-w-[180px]">
            <span className="text-surface-600 dark:text-surface-400">Folder for new uploads</span>
            <input className={`mt-1 ${inputCls()}`} value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} placeholder="General" />
          </label>
          <label className="inline-block">
            <span className="px-4 py-2 rounded-lg bg-surface-800 text-white text-sm font-medium hover:bg-surface-900 cursor-pointer inline-block dark:bg-surface-700">
              {uploading ? 'Uploading…' : 'Choose files'}
            </span>
            <input type="file" multiple className="sr-only" onChange={onUpload} disabled={uploading} />
          </label>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-600">
            <span className="text-sm text-surface-700 dark:text-surface-300">{selectedIds.size} selected</span>
            <input
              className={`flex-1 min-w-[140px] ${inputCls()}`}
              value={bulkFolder}
              onChange={(e) => setBulkFolder(e.target.value)}
              placeholder="New folder name for all selected"
            />
            <button type="button" onClick={moveSelectedToFolder} className="px-3 py-2 rounded-lg border border-surface-300 text-sm font-medium hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-800">
              Move to folder
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm text-brand-600 hover:underline">
              Clear selection
            </button>
          </div>
        )}

        {attachments.length === 0 ? (
          <p className="text-sm text-surface-500">No attachments yet.</p>
        ) : (
          <div className="space-y-6">
            {grouped.map(([folder, rows]) => (
              <div key={folder}>
                <p className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">{folder}</p>
                <ul className="space-y-2 border border-surface-100 dark:border-surface-800 rounded-lg divide-y divide-surface-100 dark:divide-surface-800">
                  {rows.map((a) => (
                    <li key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 text-sm">
                      <label className="inline-flex items-center gap-2 shrink-0">
                        <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSel(a.id)} />
                      </label>
                      <span className="flex-1 min-w-0 font-medium text-surface-900 dark:text-surface-100 truncate">{a.file_name}</span>
                      <label className="flex items-center gap-2 shrink-0 text-xs text-surface-500">
                        Folder
                        <input
                          defaultValue={a.folder_name}
                          key={`${a.id}-${a.folder_name}`}
                          className="w-36 px-2 py-1 rounded border border-surface-300 text-surface-900 text-xs dark:bg-surface-900 dark:border-surface-600"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || 'General';
                            if (v !== a.folder_name) updateOneFolder(a.id, v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.target.blur();
                          }}
                        />
                      </label>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          className="text-brand-600 hover:underline text-xs"
                          onClick={() => downloadAttachmentWithAuth(pm.employeeDetails.downloadUrl(a.id), a.file_name).catch((err) => onError(err?.message))}
                        >
                          Download
                        </button>
                        <button type="button" className="text-red-600 hover:underline text-xs" onClick={() => removeAttachment(a.id)}>
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
