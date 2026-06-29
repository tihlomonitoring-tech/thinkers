import { useMemo, useState } from 'react';

function facilityBadge(d) {
  if (d.compliance_blocked) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 font-semibold" title="Failed vehicle tracker compliance — a passing re-inspection (with motivation) is required.">Blocked</span>;
  }
  if (d.facility_access) return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Facility access</span>;
  if (d.last_decline_reason) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={d.last_decline_reason}>Declined</span>;
  const cas = d.contractor_approval_status ?? d.contractorApprovalStatus;
  if (cas === 'pending_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">Awaiting contractor</span>;
  if (cas === 'declined_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={d.contractor_decline_reason || d.contractorDeclineReason}>Contractor declined</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Pending CC</span>;
}

function driverName(d) {
  return d.full_name || [d.name, d.surname].filter(Boolean).join(' ') || '—';
}

export default function DriverAdvancedView({
  drivers,
  onSelectDriver,
  selectedDriverId,
  isSubcontractorUser,
  selectionMode = false,
  onSelectionModeChange,
  selectedIds = [],
  onSelectedIdsChange,
  onBulkEdit,
  bulkEditDisabled = false,
}) {
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const subOptions = useMemo(() => {
    const set = new Set();
    (drivers || []).forEach((d) => {
      const n = (d.subcontractor_company_name || '').trim();
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [drivers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (drivers || []).filter((d) => {
      if (subFilter) {
        const n = (d.subcontractor_company_name || '').trim();
        if (n !== subFilter) return false;
      }
      if (statusFilter === 'facility') return Boolean(d.facility_access);
      if (statusFilter === 'pending_cc') {
        return !d.facility_access && !d.last_decline_reason
          && (d.contractor_approval_status ?? d.contractorApprovalStatus) !== 'pending_contractor';
      }
      if (statusFilter === 'pending_contractor') {
        return (d.contractor_approval_status ?? d.contractorApprovalStatus) === 'pending_contractor';
      }
      if (statusFilter === 'declined') {
        return Boolean(d.last_decline_reason)
          || (d.contractor_approval_status ?? d.contractorApprovalStatus) === 'declined_contractor';
      }
      if (!q) return true;
      const name = driverName(d).toLowerCase();
      return (
        name.includes(q) ||
        String(d.id_number || '').toLowerCase().includes(q) ||
        String(d.license_number || '').toLowerCase().includes(q) ||
        String(d.linked_truck_registration || d.linkedTruckRegistration || '').toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      const pick = (row) => {
        if (sortCol === 'sub_contractor') return (row.subcontractor_company_name || '').toLowerCase();
        if (sortCol === 'license') return (row.license_number || '').toLowerCase();
        return driverName(row).toLowerCase();
      };
      const c = pick(a).localeCompare(pick(b));
      return sortDir === 'desc' ? -c : c;
    });
    return list;
  }, [drivers, search, subFilter, statusFilter, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortMark = (col) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const toggleRow = (id) => {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllFiltered = () => {
    if (!onSelectedIdsChange) return;
    const ids = filtered.map((d) => d.id);
    const allOn = ids.every((id) => selectedIds.includes(id));
    if (allOn) onSelectedIdsChange((prev) => prev.filter((id) => !ids.includes(id)));
    else onSelectedIdsChange((prev) => [...new Set([...prev, ...ids])]);
  };

  const exitSelectionMode = () => {
    onSelectionModeChange?.(false);
    onSelectedIdsChange?.([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs font-medium text-surface-600">Search drivers</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, ID, licence, linked truck…"
            className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-full"
          />
        </label>
        {!isSubcontractorUser && subOptions.length > 0 && (
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-medium text-surface-600">Sub-contractor</span>
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
              <option value="">All</option>
              {subOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 min-w-[140px]">
          <span className="text-xs font-medium text-surface-600">Access status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="facility">Facility access</option>
            <option value="pending_cc">Pending Command Centre</option>
            {!isSubcontractorUser && <option value="pending_contractor">Awaiting contractor</option>}
            <option value="declined">Declined</option>
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-surface-600 invisible sm:visible">Actions</span>
          {!selectionMode ? (
            <button
              type="button"
              disabled={bulkEditDisabled}
              onClick={() => onSelectionModeChange?.(true)}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 whitespace-nowrap"
            >
              Bulk edit
            </button>
          ) : (
            <button
              type="button"
              onClick={exitSelectionMode}
              className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50 whitespace-nowrap"
            >
              Cancel select
            </button>
          )}
        </div>
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-indigo-50 dark:from-violet-950/40 dark:via-surface-900 dark:to-indigo-950/30 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex w-8 h-8 items-center justify-center rounded-full bg-violet-600 text-white text-xs font-bold">
              {selectedIds.length}
            </span>
            <span className="font-medium text-surface-800 dark:text-surface-200">drivers selected</span>
          </div>
          <button type="button" onClick={selectAllFiltered} className="text-xs font-semibold text-violet-700 hover:underline">
            {filtered.every((d) => selectedIds.includes(d.id)) && filtered.length > 0 ? 'Deselect visible' : 'Select all visible'}
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => onBulkEdit?.(selectedIds)}
            className="ml-auto px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 shadow-md"
          >
            Edit {selectedIds.length || ''} driver{selectedIds.length !== 1 ? 's' : ''}…
          </button>
        </div>
      )}

      <p className="text-xs text-surface-500">
        {filtered.length} of {(drivers || []).length} driver{(drivers || []).length !== 1 ? 's' : ''}
        {!selectionMode && ' — click a row to view details'}
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-surface-500">No drivers match your filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-200">
                {selectionMode && (
                  <th className="w-10 p-2">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((d) => selectedIds.includes(d.id))}
                      onChange={selectAllFiltered}
                      className="rounded border-surface-300 text-violet-600"
                      aria-label="Select all visible"
                    />
                  </th>
                )}
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('name')} className="font-medium text-surface-700 hover:text-violet-700">
                    Name{sortMark('name')}
                  </button>
                </th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('sub_contractor')} className="font-medium text-surface-700 hover:text-violet-700">
                    Sub-contractor{sortMark('sub_contractor')}
                  </button>
                </th>
                <th className="text-left p-2 font-medium text-surface-700">ID number</th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('license')} className="font-medium text-surface-700 hover:text-violet-700">
                    Licence{sortMark('license')}
                  </button>
                </th>
                <th className="text-left p-2 font-medium text-surface-700">Linked truck</th>
                <th className="text-left p-2 font-medium text-surface-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const isSelected = selectedIds.includes(d.id);
                return (
                  <tr
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => (selectionMode ? toggleRow(d.id) : onSelectDriver?.(d))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') selectionMode ? toggleRow(d.id) : onSelectDriver?.(d);
                    }}
                    className={`border-b border-surface-100 cursor-pointer transition-colors ${
                      isSelected && selectionMode
                        ? 'bg-violet-50/90 ring-1 ring-inset ring-violet-300'
                        : selectedDriverId === d.id
                          ? 'bg-brand-50'
                          : 'hover:bg-surface-50/80'
                    }`}
                  >
                    {selectionMode && (
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(d.id)}
                          className="rounded border-surface-300 text-violet-600"
                          aria-label={`Select ${driverName(d)}`}
                        />
                      </td>
                    )}
                    <td className="p-2 font-medium">{driverName(d)}</td>
                    <td className="p-2 text-surface-600">{d.subcontractor_company_name || '—'}</td>
                    <td className="p-2 text-surface-600 font-mono text-xs">{d.id_number || '—'}</td>
                    <td className="p-2 text-surface-600">{d.license_number || '—'}</td>
                    <td className="p-2 text-surface-600">{d.linked_truck_registration || d.linkedTruckRegistration || '—'}</td>
                    <td className="p-2">{facilityBadge(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
