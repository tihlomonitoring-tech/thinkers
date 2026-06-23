import { useEffect, useMemo, useState } from 'react';
import {
  dedupeFleetTrucks,
  fleetRowReactKey,
  truckRowKey,
  truckSubcontractorLabel,
  formatTruckRegistration,
} from '../lib/truckKey.js';

function pendingChangeBadge(t) {
  if (!t.has_pending_change && !t.pending_change?.id) return null;
  const pc = t.pending_change || {};
  if (pc.contractor_status === 'pending_contractor') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300">Awaiting contractor approval</span>;
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300" title={pc.comment || 'Pending change'}>
      Pending change — CC review
    </span>
  );
}

function facilityBadge(t) {
  if (t.has_pending_change || t.pending_change?.id) return pendingChangeBadge(t);
  if (t.facility_access) return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Facility access</span>;
  if (t.last_decline_reason) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={t.last_decline_reason}>Declined</span>;
  const cas = t.contractor_approval_status ?? t.contractorApprovalStatus;
  if (cas === 'pending_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">Awaiting contractor</span>;
  if (cas === 'declined_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={t.contractor_decline_reason || t.contractorDeclineReason}>Contractor declined</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Pending CC</span>;
}

function matchesStatusFilter(t, statusFilter) {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'facility') return Boolean(t.facility_access);
  if (statusFilter === 'pending_cc') {
    return !t.facility_access && !t.last_decline_reason
      && (t.contractor_approval_status ?? t.contractorApprovalStatus) !== 'pending_contractor';
  }
  if (statusFilter === 'pending_contractor') {
    return (t.contractor_approval_status ?? t.contractorApprovalStatus) === 'pending_contractor';
  }
  if (statusFilter === 'declined') {
    return Boolean(t.last_decline_reason)
      || (t.contractor_approval_status ?? t.contractorApprovalStatus) === 'declined_contractor';
  }
  if (statusFilter === 'pending_changes') return Boolean(t.has_pending_change || t.pending_change?.id);
  return true;
}

function matchesSearch(t, q) {
  if (!q) return true;
  const sub = truckSubcontractorLabel(t).toLowerCase();
  return (
    String(t.registration || '').toLowerCase().includes(q) ||
    String(t.make_model || t.makeModel || '').toLowerCase().includes(q) ||
    String(t.fleet_no || t.fleetNo || '').toLowerCase().includes(q) ||
    sub.includes(q) ||
    String(t.sub_contractor || t.subContractor || '').toLowerCase().includes(q) ||
    String(t.main_contractor || t.mainContractor || '').toLowerCase().includes(q)
  );
}

export default function FleetAdvancedView({
  trucks,
  onSelectTruck,
  selectedTruckRegistration,
  isSubcontractorUser,
  selectionMode = false,
  onSelectionModeChange,
  selectedRegistrations = [],
  onSelectedRegistrationsChange,
  onBulkEdit,
  bulkEditDisabled = false,
}) {
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortCol, setSortCol] = useState('registration');
  const [sortDir, setSortDir] = useState('asc');

  const fleetRows = useMemo(() => dedupeFleetTrucks(trucks), [trucks]);

  const subOptions = useMemo(() => {
    const set = new Set();
    fleetRows.forEach((t) => {
      const n = truckSubcontractorLabel(t);
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [fleetRows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const subNorm = subFilter.trim().toLowerCase();

    let list = fleetRows.filter((t) => {
      if (!truckRowKey(t)) return false;
      if (subNorm) {
        const n = truckSubcontractorLabel(t).toLowerCase();
        if (n !== subNorm) return false;
      }
      if (!matchesStatusFilter(t, statusFilter)) return false;
      return matchesSearch(t, q);
    });

    list = [...list].sort((a, b) => {
      const pick = (row) => {
        if (sortCol === 'sub_contractor') return truckSubcontractorLabel(row).toLowerCase();
        if (sortCol === 'make_model') return (row.make_model || row.makeModel || '').toLowerCase();
        if (sortCol === 'fleet_no') return (row.fleet_no || row.fleetNo || '').toLowerCase();
        return (row.registration || '').toLowerCase();
      };
      const c = pick(a).localeCompare(pick(b));
      return sortDir === 'desc' ? -c : c;
    });
    return list;
  }, [fleetRows, search, subFilter, statusFilter, sortCol, sortDir]);

  useEffect(() => {
    onSelectedRegistrationsChange?.([]);
  }, [search, subFilter, statusFilter, onSelectedRegistrationsChange]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortMark = (col) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const toggleRow = (regKey, e) => {
    e?.stopPropagation();
    if (!onSelectedRegistrationsChange || !regKey) return;
    onSelectedRegistrationsChange((prev) => (prev.includes(regKey) ? prev.filter((x) => x !== regKey) : [...prev, regKey]));
  };

  const selectAllVisible = () => {
    if (!onSelectedRegistrationsChange) return;
    const keys = visibleRows.map((t) => truckRowKey(t)).filter(Boolean);
    const allOn = keys.length > 0 && keys.every((k) => selectedRegistrations.includes(k));
    if (allOn) onSelectedRegistrationsChange((prev) => prev.filter((k) => !keys.includes(k)));
    else onSelectedRegistrationsChange((prev) => [...new Set([...prev, ...keys])]);
  };

  const exitSelectionMode = () => {
    onSelectionModeChange?.(false);
    onSelectedRegistrationsChange?.([]);
  };

  const colSpan = selectionMode ? 5 : 4;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs font-medium text-surface-600">Search fleet</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Registration, make/model, fleet no, sub-contractor…"
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
            <option value="all">All statuses</option>
            <option value="facility">Facility approved</option>
            <option value="pending_cc">Pending CC</option>
            {!isSubcontractorUser && <option value="pending_contractor">Pending contractor</option>}
            <option value="declined">Declined</option>
            <option value="pending_changes">Pending changes</option>
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-surface-600 invisible sm:visible">Actions</span>
          {selectionMode ? (
            <button type="button" onClick={exitSelectionMode} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50 whitespace-nowrap">
              Cancel selection
            </button>
          ) : (
            <button
              type="button"
              disabled={bulkEditDisabled}
              onClick={() => onSelectionModeChange?.(true)}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-brand-300 text-brand-700 hover:bg-brand-50 disabled:opacity-40 whitespace-nowrap"
            >
              Select for bulk edit
            </button>
          )}
        </div>
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/80 px-4 py-3">
          <button type="button" onClick={selectAllVisible} className="text-xs font-medium text-brand-700 hover:underline">
            {visibleRows.length > 0 && visibleRows.every((t) => selectedRegistrations.includes(truckRowKey(t)))
              ? 'Deselect visible'
              : 'Select all visible'}
          </button>
          <button
            type="button"
            disabled={selectedRegistrations.length === 0 || bulkEditDisabled}
            onClick={() => onBulkEdit?.(selectedRegistrations)}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
          >
            Bulk edit ({selectedRegistrations.length})
          </button>
        </div>
      )}

      <p className="text-xs text-surface-500">
        {visibleRows.length} of {fleetRows.length} truck{fleetRows.length !== 1 ? 's' : ''} shown
      </p>

      <div className="overflow-x-auto rounded-xl border border-surface-200 dark:border-surface-700">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-surface-50 dark:bg-surface-900 text-left text-xs uppercase tracking-wider text-surface-500">
            <tr>
              {selectionMode && (
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={visibleRows.length > 0 && visibleRows.every((t) => selectedRegistrations.includes(truckRowKey(t)))}
                    onChange={selectAllVisible}
                    aria-label="Select all visible"
                  />
                </th>
              )}
              <th className="px-3 py-2 cursor-pointer" onClick={() => toggleSort('registration')}>Registration{sortMark('registration')}</th>
              <th className="px-3 py-2 cursor-pointer" onClick={() => toggleSort('make_model')}>Make / model{sortMark('make_model')}</th>
              <th className="px-3 py-2 cursor-pointer" onClick={() => toggleSort('sub_contractor')}>Sub-contractor{sortMark('sub_contractor')}</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-surface-500">
                  No trucks match your filters
                </td>
              </tr>
            ) : visibleRows.map((t) => {
              const regKey = truckRowKey(t);
              const rowKey = fleetRowReactKey(t);
              const isSelected = selectedRegistrations.includes(regKey);
              return (
                <tr
                  key={rowKey}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => (selectionMode ? toggleRow(regKey, e) : onSelectTruck?.(t))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') selectionMode ? toggleRow(regKey, e) : onSelectTruck?.(t);
                  }}
                  className={`cursor-pointer transition-colors ${
                    selectionMode
                      ? isSelected ? 'bg-brand-50 dark:bg-brand-950/30' : 'hover:bg-surface-50 dark:hover:bg-surface-900/50'
                      : t.has_pending_change || t.pending_change?.id
                        ? 'bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50'
                        : selectedTruckRegistration && truckRowKey({ registration: selectedTruckRegistration }) === regKey
                          ? 'bg-brand-50 dark:bg-brand-950/40'
                          : 'hover:bg-surface-50 dark:hover:bg-surface-900/50'
                  }`}
                >
                  {selectionMode && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRow(regKey, e)}
                        aria-label={`Select ${t.registration}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono font-medium text-surface-900 dark:text-surface-100">{formatTruckRegistration(t.registration) || '—'}</td>
                  <td className="px-3 py-2 text-surface-600 dark:text-surface-400">{t.make_model || t.makeModel || '—'}</td>
                  <td className="px-3 py-2 text-surface-600 dark:text-surface-400 truncate max-w-[180px]">{truckSubcontractorLabel(t) || '—'}</td>
                  <td className="px-3 py-2">{facilityBadge(t)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
