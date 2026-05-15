import { useMemo, useState } from 'react';

function facilityBadge(d) {
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

export default function DriverAdvancedView({ drivers, onSelectDriver, selectedDriverId, isSubcontractorUser }) {
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
      </div>

      <p className="text-xs text-surface-500">{filtered.length} of {(drivers || []).length} driver{(drivers || []).length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <p className="text-sm text-surface-500">No drivers match your filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-200">
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('name')} className="font-medium text-surface-700 hover:text-brand-700">
                    Name{sortMark('name')}
                  </button>
                </th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('sub_contractor')} className="font-medium text-surface-700 hover:text-brand-700">
                    Sub-contractor{sortMark('sub_contractor')}
                  </button>
                </th>
                <th className="text-left p-2 font-medium text-surface-700">ID number</th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('license')} className="font-medium text-surface-700 hover:text-brand-700">
                    Licence{sortMark('license')}
                  </button>
                </th>
                <th className="text-left p-2 font-medium text-surface-700">Linked truck</th>
                <th className="text-left p-2 font-medium text-surface-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDriver?.(d)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectDriver?.(d)}
                  className={`border-b border-surface-100 cursor-pointer transition-colors ${
                    selectedDriverId === d.id ? 'bg-brand-50' : 'hover:bg-surface-50/80'
                  }`}
                >
                  <td className="p-2 font-medium">{driverName(d)}</td>
                  <td className="p-2 text-surface-600">{d.subcontractor_company_name || '—'}</td>
                  <td className="p-2 text-surface-600 font-mono text-xs">{d.id_number || '—'}</td>
                  <td className="p-2 text-surface-600">{d.license_number || '—'}</td>
                  <td className="p-2 text-surface-600">{d.linked_truck_registration || d.linkedTruckRegistration || '—'}</td>
                  <td className="p-2">{facilityBadge(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}