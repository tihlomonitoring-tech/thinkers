import { useMemo, useState } from 'react';

function facilityBadge(t) {
  if (t.facility_access) return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Facility access</span>;
  if (t.last_decline_reason) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={t.last_decline_reason}>Declined</span>;
  const cas = t.contractor_approval_status ?? t.contractorApprovalStatus;
  if (cas === 'pending_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">Awaiting contractor</span>;
  if (cas === 'declined_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800" title={t.contractor_decline_reason || t.contractorDeclineReason}>Contractor declined</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Pending CC</span>;
}

export default function FleetAdvancedView({ trucks, onSelectTruck, selectedTruckId, isSubcontractorUser }) {
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortCol, setSortCol] = useState('registration');
  const [sortDir, setSortDir] = useState('asc');

  const subOptions = useMemo(() => {
    const set = new Set();
    (trucks || []).forEach((t) => {
      const n = (t.subcontractor_company_name || t.sub_contractor || t.subContractor || '').trim();
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [trucks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (trucks || []).filter((t) => {
      if (subFilter) {
        const n = (t.subcontractor_company_name || t.sub_contractor || t.subContractor || '').trim();
        if (n !== subFilter) return false;
      }
      if (statusFilter === 'facility') return Boolean(t.facility_access);
      if (statusFilter === 'pending_cc') return !t.facility_access && !t.last_decline_reason && (t.contractor_approval_status ?? t.contractorApprovalStatus) !== 'pending_contractor';
      if (statusFilter === 'pending_contractor') return (t.contractor_approval_status ?? t.contractorApprovalStatus) === 'pending_contractor';
      if (statusFilter === 'declined') return Boolean(t.last_decline_reason) || (t.contractor_approval_status ?? t.contractorApprovalStatus) === 'declined_contractor';
      if (!q) return true;
      return (
        String(t.registration || '').toLowerCase().includes(q) ||
        String(t.make_model || t.makeModel || '').toLowerCase().includes(q) ||
        String(t.fleet_no || t.fleetNo || '').toLowerCase().includes(q) ||
        String(t.sub_contractor || t.subContractor || '').toLowerCase().includes(q) ||
        String(t.main_contractor || t.mainContractor || '').toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      const pick = (row) => {
        if (sortCol === 'sub_contractor') return (row.subcontractor_company_name || row.sub_contractor || row.subContractor || '').toLowerCase();
        if (sortCol === 'make_model') return (row.make_model || row.makeModel || '').toLowerCase();
        if (sortCol === 'fleet_no') return (row.fleet_no || row.fleetNo || '').toLowerCase();
        return (row.registration || '').toLowerCase();
      };
      const av = pick(a);
      const bv = pick(b);
      const c = av.localeCompare(bv);
      return sortDir === 'desc' ? -c : c;
    });
    return list;
  }, [trucks, search, subFilter, statusFilter, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortMark = (col) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
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
            <option value="all">All</option>
            <option value="facility">Facility access</option>
            <option value="pending_cc">Pending Command Centre</option>
            {!isSubcontractorUser && <option value="pending_contractor">Awaiting contractor</option>}
            <option value="declined">Declined</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-surface-500">{filtered.length} of {(trucks || []).length} truck{(trucks || []).length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <p className="text-sm text-surface-500">No trucks match your filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-200">
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('registration')} className="font-medium text-surface-700 hover:text-brand-700">
                    Registration{sortMark('registration')}
                  </button>
                </th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('sub_contractor')} className="font-medium text-surface-700 hover:text-brand-700">
                    Sub-contractor{sortMark('sub_contractor')}
                  </button>
                </th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('make_model')} className="font-medium text-surface-700 hover:text-brand-700">
                    Make / model{sortMark('make_model')}
                  </button>
                </th>
                <th className="text-left p-2">
                  <button type="button" onClick={() => toggleSort('fleet_no')} className="font-medium text-surface-700 hover:text-brand-700">
                    Fleet no{sortMark('fleet_no')}
                  </button>
                </th>
                <th className="text-left p-2 font-medium text-surface-700">Trailers</th>
                <th className="text-left p-2 font-medium text-surface-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTruck?.(t)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectTruck?.(t)}
                  className={`border-b border-surface-100 cursor-pointer transition-colors ${
                    selectedTruckId === t.id ? 'bg-brand-50' : 'hover:bg-surface-50/80'
                  }`}
                >
                  <td className="p-2 font-mono font-medium">{t.registration || '—'}</td>
                  <td className="p-2 text-surface-600">{t.subcontractor_company_name || t.sub_contractor || t.subContractor || '—'}</td>
                  <td className="p-2 text-surface-600">{t.make_model || t.makeModel || '—'}</td>
                  <td className="p-2 text-surface-600">{t.fleet_no || t.fleetNo || '—'}</td>
                  <td className="p-2 text-surface-500 text-xs">
                    {[t.trailer_1_reg_no || t.trailer1RegNo, t.trailer_2_reg_no || t.trailer2RegNo].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="p-2">{facilityBadge(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
