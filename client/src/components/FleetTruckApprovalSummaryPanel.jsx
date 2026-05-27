import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { contractor as contractorApi, commandCentre as ccApi } from '../api';
import InfoHint from './InfoHint.jsx';

const CHECKLIST_ITEMS = [
  {
    key: 'consentLetterChecked',
    uploadType: 'consent_letter',
    label: 'Consent letter',
    hint: 'Confirm the consent letter is received and on file.',
    requiresUpload: true,
  },
  {
    key: 'credentialsChecked',
    uploadType: 'credentials',
    label: 'Credentials',
    hint: 'Confirm driver / fleet credentials are verified.',
    requiresUpload: true,
  },
  {
    key: 'trackingProviderChecked',
    uploadType: null,
    label: 'Tracking provider engagement',
    hint: 'Confirm tracking provider onboarding is complete.',
    requiresUpload: false,
  },
];

function computeProgress(checklist) {
  if (!checklist) {
    return {
      completedSteps: 0,
      totalSteps: 5,
      percent: 0,
      isComplete: false,
      bottlenecks: ['Consent letter', 'Consent letter upload', 'Credentials', 'Credentials upload', 'Tracking provider engagement'],
    };
  }
  const bottlenecks = [];
  let completed = 0;
  if (checklist.consentLetterChecked) completed += 1;
  else bottlenecks.push('Consent letter');
  if (Number(checklist.consentLetterUploadCount || 0) > 0) completed += 1;
  else bottlenecks.push('Consent letter upload');
  if (checklist.credentialsChecked) completed += 1;
  else bottlenecks.push('Credentials');
  if (Number(checklist.credentialsUploadCount || 0) > 0) completed += 1;
  else bottlenecks.push('Credentials upload');
  if (checklist.trackingProviderChecked) completed += 1;
  else bottlenecks.push('Tracking provider engagement');
  return {
    completedSteps: completed,
    totalSteps: 5,
    percent: Math.round((completed / 5) * 100),
    isComplete: completed === 5,
    bottlenecks,
  };
}

function rowKey(row) {
  return `${row.tenantId}|${row.contractorId}|${row.subcontractorScopeKey || row.subcontractorDisplay}`;
}

function ProgressBar({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const color = p >= 100 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-surface-200 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-xs tabular-nums text-surface-600 w-8 text-right">{p}%</span>
    </div>
  );
}

function ChecklistItemRow({ item, checked, uploads, saving, uploading, onToggle, onUpload, onRemove, downloadUrl }) {
  const uploadInputRef = useRef(null);
  return (
    <li className="rounded-lg border border-surface-200 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-[200px]">
          <input
            type="checkbox"
            checked={checked}
            disabled={saving}
            onChange={(e) => onToggle(item.key, e.target.checked)}
            className="mt-0.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="text-sm font-medium text-surface-900 block">{item.label}</span>
            <span className="text-xs text-surface-500">{item.hint}</span>
          </span>
        </label>
        {item.requiresUpload && (
          <div className="flex flex-col gap-2 items-start">
            <button
              type="button"
              disabled={!!uploading || saving}
              onClick={() => uploadInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
            >
              {uploading === item.uploadType ? 'Uploading…' : 'Upload file'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(item.uploadType, f);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
      {item.requiresUpload && uploads.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-surface-100 pt-2">
          {uploads.map((att) => (
            <li key={att.id} className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href={downloadUrl(att.id)}
                className="text-brand-700 hover:underline truncate max-w-[220px]"
                title={att.fileName}
              >
                {att.fileName}
              </a>
              <span className="text-surface-400">{att.uploadedByName ? `· ${att.uploadedByName}` : ''}</span>
              <button type="button" onClick={() => onRemove(att.id)} className="text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {item.requiresUpload && checked && uploads.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">Ticked but no file uploaded yet — bottleneck.</p>
      )}
    </li>
  );
}

function ChecklistRowPanel({ row, commandCentre, onUpdated }) {
  const api = commandCentre ? ccApi.fleetFacilityChecklists : null;
  const [checklistId, setChecklistId] = useState(row.checklist?.id || null);
  const [checks, setChecks] = useState({
    consentLetterChecked: Boolean(row.checklist?.consentLetterChecked),
    credentialsChecked: Boolean(row.checklist?.credentialsChecked),
    trackingProviderChecked: Boolean(row.checklist?.trackingProviderChecked),
  });
  const [attachments, setAttachments] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');

  const scopeBody = useMemo(
    () => ({
      tenantId: row.tenantId,
      contractorId: row.contractorId,
      subcontractorScopeKey: row.subcontractorScopeKey,
      subcontractorId: row.subcontractorId || null,
    }),
    [row]
  );

  const loadDetail = useCallback(async (id) => {
    if (!api || !id) return;
    setLoadingDetail(true);
    setError('');
    try {
      const [detail, commentsRes] = await Promise.all([api.get(id), api.getComments(id)]);
      setAttachments(detail.attachments || []);
      setComments(commentsRes.comments || []);
      if (detail.checklist) {
        setChecks({
          consentLetterChecked: Boolean(detail.checklist.consentLetterChecked),
          credentialsChecked: Boolean(detail.checklist.credentialsChecked),
          trackingProviderChecked: Boolean(detail.checklist.trackingProviderChecked),
        });
      }
    } catch (e) {
      setError(e?.message || 'Failed to load checklist detail');
    } finally {
      setLoadingDetail(false);
    }
  }, [api]);

  useEffect(() => {
    if (!commandCentre) return;
    if (row.checklist?.id) {
      setChecklistId(row.checklist.id);
      loadDetail(row.checklist.id);
    } else {
      setChecklistId(null);
      setAttachments([]);
      setComments([]);
    }
  }, [row.checklist?.id, commandCentre, loadDetail]);

  const ensureChecklist = async () => {
    if (!api) return null;
    if (checklistId) return checklistId;
    const r = await api.ensure(scopeBody);
    const id = r.checklist?.id;
    if (id) {
      setChecklistId(id);
      onUpdated?.(rowKey(row), r.checklist);
    }
    return id;
  };

  const handleToggle = async (field, value) => {
    if (!api) return;
    setSaving(true);
    setError('');
    try {
      const id = await ensureChecklist();
      const body = { ...scopeBody, [field]: value };
      const r = await api.updateScope(body);
      setChecks({
        consentLetterChecked: Boolean(r.checklist?.consentLetterChecked),
        credentialsChecked: Boolean(r.checklist?.credentialsChecked),
        trackingProviderChecked: Boolean(r.checklist?.trackingProviderChecked),
      });
      onUpdated?.(rowKey(row), r.checklist);
    } catch (e) {
      setError(e?.message || 'Failed to update checklist');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (itemType, file) => {
    if (!api || !file) return;
    setUploading(itemType);
    setError('');
    try {
      const id = await ensureChecklist();
      await api.uploadAttachment(id, file, itemType);
      await loadDetail(id);
      const refreshed = await api.get(id);
      onUpdated?.(rowKey(row), refreshed.checklist);
    } catch (e) {
      setError(e?.message || 'Failed to upload file');
    } finally {
      setUploading('');
    }
  };

  const handleRemoveAttachment = async (attachmentId) => {
    if (!api || !checklistId) return;
    if (!window.confirm('Remove this file?')) return;
    setSaving(true);
    try {
      await api.removeAttachment(attachmentId);
      await loadDetail(checklistId);
      const refreshed = await api.get(checklistId);
      onUpdated?.(rowKey(row), refreshed.checklist);
    } catch (e) {
      setError(e?.message || 'Failed to remove file');
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async () => {
    const body = commentBody.trim();
    if (!api || !body) return;
    setSaving(true);
    setError('');
    try {
      const id = await ensureChecklist();
      const r = await api.addComment(id, body);
      setComments(r.comments || []);
      setCommentBody('');
    } catch (e) {
      setError(e?.message || 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  };

  const filesForType = (type) => attachments.filter((a) => a.itemType === type);

  if (!commandCentre) return null;

  return (
    <div className="px-4 py-4 bg-surface-50/80 border-t border-surface-200 space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-surface-900 mb-1">Onboarding checklist</h3>
          <p className="text-xs text-surface-500 mb-4">
            Track consent, credentials, and tracking engagement to spot bottlenecks before granting facility access.
          </p>
          {loadingDetail && !checklistId ? (
            <p className="text-sm text-surface-500">Loading checklist…</p>
          ) : (
            <ul className="space-y-4">
              {CHECKLIST_ITEMS.map((item) => (
                <ChecklistItemRow
                  key={item.key}
                  item={item}
                  checked={checks[item.key]}
                  uploads={item.uploadType ? filesForType(item.uploadType) : []}
                  saving={saving}
                  uploading={uploading}
                  onToggle={handleToggle}
                  onUpload={handleUpload}
                  onRemove={handleRemoveAttachment}
                  downloadUrl={(id) => api.downloadAttachmentUrl(id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm flex flex-col min-h-[280px]">
          <h3 className="text-sm font-semibold text-surface-900 mb-1">Comments & notes</h3>
          <p className="text-xs text-surface-500 mb-3">Record follow-ups, missing documents, or internal notes for this contractor scope.</p>
          <div className="flex-1 overflow-y-auto max-h-48 space-y-2 mb-3">
            {comments.length === 0 ? (
              <p className="text-sm text-surface-400 italic">No comments yet.</p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-2">
                  <p className="text-sm text-surface-800 whitespace-pre-wrap">{c.body}</p>
                  <p className="text-xs text-surface-500 mt-1">
                    {c.authorName || 'User'} · {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2 mt-auto">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={2}
              placeholder="Add a comment…"
              className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm resize-none"
            />
            <button
              type="button"
              onClick={handleAddComment}
              disabled={saving || !commentBody.trim()}
              className="self-end px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Table of truck counts per main contractor and sub-contractor: facility_access (integrated) vs not.
 * Command Centre mode adds advanced filters and onboarding checklists to identify bottlenecks.
 */
export default function FleetTruckApprovalSummaryPanel({ commandCentre = false, fetchSummary: fetchSummaryProp }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [contractors, setContractors] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterMainContractor, setFilterMainContractor] = useState('');
  const [filterSubContractor, setFilterSubContractor] = useState('');
  const [filterIntegration, setFilterIntegration] = useState(''); // '' | pending | full | none
  const [filterChecklist, setFilterChecklist] = useState(''); // '' | complete | incomplete | consent | credentials | tracking
  const [filterSearch, setFilterSearch] = useState('');
  const [filterBottleneckOnly, setFilterBottleneckOnly] = useState(false);
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const [checklistOverrides, setChecklistOverrides] = useState({});

  useEffect(() => {
    if (!commandCentre) return;
    ccApi.contractorsDetails()
      .then((r) => setContractors(r.contractors || []))
      .catch(() => setContractors([]));
  }, [commandCentre]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let data;
      if (fetchSummaryProp) {
        data = await fetchSummaryProp();
      } else if (commandCentre) {
        data = await ccApi.fleetTruckApprovalSummary(tenantFilter ? { tenantId: tenantFilter } : {});
      } else {
        data = await contractorApi.fleetTruckApprovalSummary({});
      }
      setRows(data.rows || []);
      setTotals(data.totals || { totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
    } catch (e) {
      setError(e?.message || 'Failed to load summary');
      setRows([]);
      setTotals({ totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
    } finally {
      setLoading(false);
    }
  }, [fetchSummaryProp, commandCentre, tenantFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChecklistUpdated = useCallback((key, checklist) => {
    const withProgress = checklist ? { ...checklist, progress: computeProgress(checklist) } : null;
    setChecklistOverrides((prev) => ({ ...prev, [key]: withProgress }));
    setRows((prev) =>
      prev.map((row) => {
        if (rowKey(row) !== key) return row;
        const progress = computeProgress(withProgress);
        return { ...row, checklist: withProgress, progress };
      })
    );
  }, []);

  const mergedRows = useMemo(
    () =>
      rows.map((row) => {
        const key = rowKey(row);
        const checklist = checklistOverrides[key] || row.checklist;
        if (!checklist) return row;
        return { ...row, checklist, progress: checklist.progress || row.progress };
      }),
    [rows, checklistOverrides]
  );

  const mainContractorOptions = useMemo(() => {
    const set = new Set();
    mergedRows.forEach((r) => {
      if (r.contractorName) set.add(r.contractorName);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [mergedRows]);

  const subContractorOptions = useMemo(() => {
    const set = new Set();
    mergedRows.forEach((r) => {
      if (r.subcontractorDisplay) set.add(r.subcontractorDisplay);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [mergedRows]);

  const filteredRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return mergedRows.filter((row) => {
      if (filterMainContractor && row.contractorName !== filterMainContractor) return false;
      if (filterSubContractor && row.subcontractorDisplay !== filterSubContractor) return false;

      if (filterIntegration === 'pending' && row.notIntegratedTrucks <= 0) return false;
      if (filterIntegration === 'full' && row.notIntegratedTrucks > 0) return false;
      if (filterIntegration === 'none' && row.integratedTrucks > 0) return false;

      const progress = row.progress || {};
      const bottlenecks = progress.bottlenecks || [];
      if (filterBottleneckOnly && bottlenecks.length === 0) return false;

      if (filterChecklist === 'complete' && !progress.isComplete) return false;
      if (filterChecklist === 'incomplete' && progress.isComplete) return false;
      if (filterChecklist === 'consent' && !bottlenecks.some((b) => b.toLowerCase().includes('consent'))) return false;
      if (filterChecklist === 'credentials' && !bottlenecks.some((b) => b.toLowerCase().includes('credential'))) return false;
      if (filterChecklist === 'tracking' && !bottlenecks.some((b) => b.toLowerCase().includes('tracking'))) return false;

      if (q) {
        const hay = [row.tenantName, row.contractorName, row.subcontractorDisplay, ...(bottlenecks || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    mergedRows,
    filterMainContractor,
    filterSubContractor,
    filterIntegration,
    filterChecklist,
    filterSearch,
    filterBottleneckOnly,
  ]);

  const filteredTotals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => ({
          totalTrucks: acc.totalTrucks + row.totalTrucks,
          integratedTrucks: acc.integratedTrucks + row.integratedTrucks,
          notIntegratedTrucks: acc.notIntegratedTrucks + row.notIntegratedTrucks,
        }),
        { totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 }
      ),
    [filteredRows]
  );

  const activeFilterCount = [
    filterMainContractor,
    filterSubContractor,
    filterIntegration,
    filterChecklist,
    filterSearch.trim(),
    filterBottleneckOnly,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterMainContractor('');
    setFilterSubContractor('');
    setFilterIntegration('');
    setFilterChecklist('');
    setFilterSearch('');
    setFilterBottleneckOnly(false);
  };

  const showTenantColumn = commandCentre;
  const showChecklistColumns = commandCentre && !fetchSummaryProp;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900">Fleet facility access (trucks)</h2>
          <InfoHint
            title="Integrated vs not integrated"
            text="Integrated means facility access is approved for the truck. Not integrated counts trucks still awaiting approval. Use the onboarding checklist per contractor / sub-contractor to track consent letter, credentials, and tracking provider engagement — and spot bottlenecks quickly."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {commandCentre && (
            <>
              <label className="text-sm font-medium text-surface-700">Contractor</label>
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[180px]"
                aria-label="Filter by tenant or contractor"
              >
                <option value="">All contractors</option>
                {contractors.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.tenantName || c.tenantId}
                  </option>
                ))}
              </select>
            </>
          )}
          {showChecklistColumns && (
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((v) => !v)}
              className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                showAdvancedFilters || activeFilterCount > 0
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-surface-300 text-surface-700 hover:bg-surface-50'
              }`}
            >
              Advanced filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {showChecklistColumns && showAdvancedFilters && (
        <section className="app-glass-panel-2xl p-4 shadow-sm border border-surface-200 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-surface-900">Advanced filters</h3>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="text-xs text-brand-700 hover:underline">
                Clear all filters
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-surface-600">Main contractor</span>
              <select
                value={filterMainContractor}
                onChange={(e) => setFilterMainContractor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="">All main contractors</option>
                {mainContractorOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600">Sub-contractor</span>
              <select
                value={filterSubContractor}
                onChange={(e) => setFilterSubContractor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="">All sub-contractors</option>
                {subContractorOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600">Integration status</span>
              <select
                value={filterIntegration}
                onChange={(e) => setFilterIntegration(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="">Any integration mix</option>
                <option value="pending">Has trucks pending CC</option>
                <option value="full">Fully integrated</option>
                <option value="none">None integrated yet</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600">Checklist / bottleneck</span>
              <select
                value={filterChecklist}
                onChange={(e) => setFilterChecklist(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="">Any checklist status</option>
                <option value="complete">Checklist complete</option>
                <option value="incomplete">Checklist incomplete</option>
                <option value="consent">Missing consent letter</option>
                <option value="credentials">Missing credentials</option>
                <option value="tracking">Missing tracking engagement</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-surface-600">Search</span>
              <input
                type="search"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Contractor, sub-contractor, bottleneck…"
                className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={filterBottleneckOnly}
                onChange={(e) => setFilterBottleneckOnly(e.target.checked)}
                className="rounded border-surface-300 text-brand-600"
              />
              <span className="text-sm text-surface-700">Show rows with bottlenecks only</span>
            </label>
          </div>
          <p className="text-xs text-surface-500">
            Showing {filteredRows.length} of {mergedRows.length} contractor scope{mergedRows.length === 1 ? '' : 's'}
            {activeFilterCount > 0 ? ' (filtered)' : ''}.
          </p>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex justify-between items-center gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <section className="app-glass-panel-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-6 py-8 text-surface-500 text-sm">Loading…</p>
          ) : filteredRows.length === 0 ? (
            <p className="px-6 py-8 text-surface-500 text-center">No truck data matches this view.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  {showChecklistColumns && <th className="w-10 px-2 py-2" aria-label="Expand" />}
                  {showTenantColumn && (
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Tenant</th>
                  )}
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Main contractor</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Sub-contractor</th>
                  {showChecklistColumns && (
                    <>
                      <th className="text-left font-semibold text-surface-700 px-4 py-2 min-w-[140px]">Checklist</th>
                      <th className="text-left font-semibold text-surface-700 px-4 py-2 min-w-[160px]">Bottleneck</th>
                    </>
                  )}
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Integrated</th>
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Not integrated</th>
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Total trucks</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const key = rowKey(row);
                  const expanded = expandedRowKey === key;
                  const progress = row.progress || { percent: 0, bottlenecks: [], isComplete: false };
                  const colSpan =
                    (showChecklistColumns ? 1 : 0) +
                    (showTenantColumn ? 1 : 0) +
                    2 +
                    (showChecklistColumns ? 2 : 0) +
                    3;
                  return (
                    <Fragment key={key}>
                      <tr
                        key={`${key}-${idx}`}
                        className={`border-b border-surface-100 hover:bg-surface-50 ${expanded ? 'bg-brand-50/30' : ''}`}
                      >
                        {showChecklistColumns && (
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => setExpandedRowKey(expanded ? null : key)}
                              className="w-8 h-8 rounded-lg border border-surface-300 text-surface-600 hover:bg-white text-xs font-bold"
                              aria-expanded={expanded}
                              title={expanded ? 'Collapse checklist' : 'Expand checklist'}
                            >
                              {expanded ? '−' : '+'}
                            </button>
                          </td>
                        )}
                        {showTenantColumn && <td className="px-4 py-2 text-surface-700">{row.tenantName || '—'}</td>}
                        <td className="px-4 py-2 text-surface-900 font-medium">{row.contractorName || '—'}</td>
                        <td className="px-4 py-2 text-surface-700">{row.subcontractorDisplay || '—'}</td>
                        {showChecklistColumns && (
                          <>
                            <td className="px-4 py-2">
                              <ProgressBar percent={progress.percent} />
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {CHECKLIST_ITEMS.map((item) => {
                                  const ticked = Boolean(row.checklist?.[item.key]);
                                  const uploadCount =
                                    item.uploadType === 'consent_letter'
                                      ? Number(row.checklist?.consentLetterUploadCount || 0)
                                      : item.uploadType === 'credentials'
                                        ? Number(row.checklist?.credentialsUploadCount || 0)
                                        : 0;
                                  const ok = ticked && (!item.requiresUpload || uploadCount > 0);
                                  return (
                                    <span
                                      key={item.key}
                                      title={item.label}
                                      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                                        ok ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-200 text-surface-500'
                                      }`}
                                    >
                                      {ok ? '✓' : '·'}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-2">
                              {progress.isComplete ? (
                                <span className="text-xs text-emerald-700 font-medium">Ready</span>
                              ) : progress.bottlenecks?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {progress.bottlenecks.slice(0, 2).map((b) => (
                                    <span
                                      key={b}
                                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900"
                                    >
                                      {b}
                                    </span>
                                  ))}
                                  {progress.bottlenecks.length > 2 && (
                                    <span className="text-[10px] text-surface-500">+{progress.bottlenecks.length - 2}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-surface-400">Not started</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-800">{row.integratedTrucks}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-amber-800">{row.notIntegratedTrucks}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-surface-900">{row.totalTrucks}</td>
                      </tr>
                      {expanded && showChecklistColumns && (
                        <tr key={`${key}-detail`}>
                          <td colSpan={colSpan} className="p-0">
                            <ChecklistRowPanel
                              row={row}
                              commandCentre={commandCentre}
                              onUpdated={handleChecklistUpdated}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-100 border-t-2 border-surface-200 font-semibold">
                  <td
                    colSpan={
                      (showChecklistColumns ? 1 : 0) +
                      (showTenantColumn ? 1 : 0) +
                      2 +
                      (showChecklistColumns ? 2 : 0)
                    }
                    className="px-4 py-3 text-surface-800"
                  >
                    Totals{activeFilterCount > 0 ? ' (filtered)' : ''}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-900">{filteredTotals.integratedTrucks}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-900">{filteredTotals.notIntegratedTrucks}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-surface-900">{filteredTotals.totalTrucks}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
