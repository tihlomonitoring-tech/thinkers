import { useState, useEffect, useCallback } from 'react';
import { contractor as contractorApi } from '../api';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function approvalBadge(status) {
  const s = status || 'pending_contractor';
  if (s === 'approved_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Approved</span>;
  if (s === 'declined_contractor') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">Declined</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Pending review</span>;
}

function driverLabel(d) {
  return d.full_name || [d.name, d.surname].filter(Boolean).join(' ') || '—';
}

export default function SubcontractorFleetsTab({ onChanged, setError: setParentError }) {
  const [section, setSection] = useState('fleet');
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending_contractor');
  const [subFilter, setSubFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [actingId, setActingId] = useState(null);
  const [declineTarget, setDeclineTarget] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineKind, setDeclineKind] = useState('fleet');

  const load = useCallback(() => {
    setLoading(true);
    const params = { status: statusFilter, search: search.trim(), sort, order };
    if (subFilter) params.subcontractor_id = subFilter;
    const api = section === 'fleet' ? contractorApi.subcontractorFleets : contractorApi.subcontractorDrivers;
    return api
      .list(params)
      .then((r) => {
        if (section === 'fleet') {
          setTrucks(r.trucks || []);
        } else {
          setDrivers(r.drivers || []);
        }
        setSubcontractors(r.subcontractors || []);
      })
      .catch((e) => {
        if (section === 'fleet') setTrucks([]);
        else setDrivers([]);
        if (setParentError) {
          setParentError(e?.message || `Failed to load subcontractor ${section === 'fleet' ? 'fleet' : 'drivers'}`);
        }
      })
      .finally(() => setLoading(false));
  }, [section, statusFilter, subFilter, search, sort, order, setParentError]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    setSort(section === 'fleet' ? 'created_at' : 'created_at');
    setSearch('');
    setSubFilter('');
  }, [section]);

  const approveFleet = async (id) => {
    if (!window.confirm('Approve this truck? It will appear on your Fleet tab and be sent for facility access review.')) return;
    setActingId(id);
    if (setParentError) setParentError('');
    try {
      await contractorApi.subcontractorFleets.approve(id);
      await load();
      onChanged?.();
    } catch (e) {
      if (setParentError) setParentError(e?.message || 'Approve failed');
    } finally {
      setActingId(null);
    }
  };

  const approveDriver = async (id) => {
    if (!window.confirm('Approve this driver? They will appear on your Driver register and be sent for facility access review.')) return;
    setActingId(id);
    if (setParentError) setParentError('');
    try {
      await contractorApi.subcontractorDrivers.approve(id);
      await load();
      onChanged?.();
    } catch (e) {
      if (setParentError) setParentError(e?.message || 'Approve failed');
    } finally {
      setActingId(null);
    }
  };

  const submitDecline = async () => {
    if (!declineTarget?.id) return;
    const reason = declineReason.trim();
    if (!reason) {
      if (setParentError) setParentError('Decline reason is required');
      return;
    }
    setActingId(declineTarget.id);
    if (setParentError) setParentError('');
    try {
      const api = declineKind === 'fleet' ? contractorApi.subcontractorFleets : contractorApi.subcontractorDrivers;
      await api.decline(declineTarget.id, { reason });
      setDeclineTarget(null);
      setDeclineReason('');
      await load();
    } catch (e) {
      if (setParentError) setParentError(e?.message || 'Decline failed');
    } finally {
      setActingId(null);
    }
  };

  const pendingFleet = trucks.filter((t) => (t.contractor_approval_status || t.contractorApprovalStatus) === 'pending_contractor').length;
  const pendingDrivers = drivers.filter((d) => (d.contractor_approval_status || d.contractorApprovalStatus) === 'pending_contractor').length;
  const pendingCount = section === 'fleet' ? pendingFleet : pendingDrivers;
  const rows = section === 'fleet' ? trucks : drivers;

  return (
    <div className="w-full space-y-4">
      <div className="app-glass-card p-6">
        <h2 className="font-medium text-surface-900 mb-1">Subcontractor submissions</h2>
        <p className="text-sm text-surface-600 mb-4">
          Review trucks and drivers added by sub-contractors before they appear on your Fleet and Driver register tabs.
        </p>

        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-surface-100 w-fit">
          <button
            type="button"
            onClick={() => setSection('fleet')}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${section === 'fleet' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-600 hover:text-surface-900'}`}
          >
            Fleet
            {pendingFleet > 0 && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">{pendingFleet}</span>}
          </button>
          <button
            type="button"
            onClick={() => setSection('drivers')}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${section === 'drivers' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-600 hover:text-surface-900'}`}
          >
            Drivers
            {pendingDrivers > 0 && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">{pendingDrivers}</span>}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 items-end mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-600">Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm min-w-[140px]">
              <option value="pending_contractor">Pending review</option>
              <option value="approved_contractor">Approved</option>
              <option value="declined_contractor">Declined</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-600">Sub-contractor</span>
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm min-w-[180px]">
              <option value="">All companies</option>
              {subcontractors.map((s) => (
                <option key={s.id} value={s.id}>{s.company_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-xs font-medium text-surface-600">Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={section === 'fleet' ? 'Registration, make/model, fleet no…' : 'Name, ID, licence…'}
              className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-600">Sort</span>
            <select
              value={`${sort}-${order}`}
              onChange={(e) => {
                const [s, o] = e.target.value.split('-');
                setSort(s);
                setOrder(o);
              }}
              className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm"
            >
              <option value="created_at-desc">Newest first</option>
              <option value="created_at-asc">Oldest first</option>
              {section === 'fleet' ? (
                <>
                  <option value="registration-asc">Registration A–Z</option>
                  <option value="sub_contractor-asc">Sub-contractor A–Z</option>
                </>
              ) : (
                <option value="full_name-asc">Name A–Z</option>
              )}
            </select>
          </label>
          <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded-lg bg-surface-200 text-surface-800 hover:bg-surface-300">Refresh</button>
        </div>

        {statusFilter === 'pending_contractor' && pendingCount > 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            {pendingCount} {section === 'fleet' ? 'truck' : 'driver'}{pendingCount !== 1 ? 's' : ''} awaiting your review.
          </p>
        )}

        {loading ? (
          <p className="text-sm text-surface-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-surface-500">No {section === 'fleet' ? 'trucks' : 'drivers'} match these filters.</p>
        ) : section === 'fleet' ? (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  <th className="text-left p-2 font-medium text-surface-700">Registration</th>
                  <th className="text-left p-2 font-medium text-surface-700">Sub-contractor</th>
                  <th className="text-left p-2 font-medium text-surface-700">Make / model</th>
                  <th className="text-left p-2 font-medium text-surface-700">Fleet no</th>
                  <th className="text-left p-2 font-medium text-surface-700">Submitted</th>
                  <th className="text-left p-2 font-medium text-surface-700">Added by</th>
                  <th className="text-left p-2 font-medium text-surface-700">Status</th>
                  <th className="p-2 w-40" />
                </tr>
              </thead>
              <tbody>
                {trucks.map((t) => {
                  const st = t.contractor_approval_status ?? t.contractorApprovalStatus;
                  const isPending = st === 'pending_contractor';
                  return (
                    <tr key={t.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-2 font-mono font-medium">{t.registration || '—'}</td>
                      <td className="p-2 text-surface-600">{t.subcontractor_company_name || t.sub_contractor || '—'}</td>
                      <td className="p-2 text-surface-600">{t.make_model || '—'}</td>
                      <td className="p-2 text-surface-600">{t.fleet_no || '—'}</td>
                      <td className="p-2 text-surface-600 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                      <td className="p-2 text-surface-600">{t.added_by_name || '—'}</td>
                      <td className="p-2">{approvalBadge(st)}</td>
                      <td className="p-2">
                        {isPending ? (
                          <div className="flex gap-1">
                            <button type="button" disabled={actingId === t.id} onClick={() => approveFleet(t.id)} className="px-2 py-1 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                              {actingId === t.id ? '…' : 'Approve'}
                            </button>
                            <button type="button" disabled={actingId === t.id} onClick={() => { setDeclineKind('fleet'); setDeclineTarget(t); setDeclineReason(''); }} className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                              Decline
                            </button>
                          </div>
                        ) : st === 'declined_contractor' && (t.contractor_decline_reason || t.contractorDeclineReason) ? (
                          <span className="text-xs text-red-700" title={t.contractor_decline_reason || t.contractorDeclineReason}>View reason</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  <th className="text-left p-2 font-medium text-surface-700">Name</th>
                  <th className="text-left p-2 font-medium text-surface-700">Sub-contractor</th>
                  <th className="text-left p-2 font-medium text-surface-700">ID / licence</th>
                  <th className="text-left p-2 font-medium text-surface-700">Linked truck</th>
                  <th className="text-left p-2 font-medium text-surface-700">Submitted</th>
                  <th className="text-left p-2 font-medium text-surface-700">Added by</th>
                  <th className="text-left p-2 font-medium text-surface-700">Status</th>
                  <th className="p-2 w-40" />
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => {
                  const st = d.contractor_approval_status ?? d.contractorApprovalStatus;
                  const isPending = st === 'pending_contractor';
                  return (
                    <tr key={d.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-2 font-medium">{driverLabel(d)}</td>
                      <td className="p-2 text-surface-600">{d.subcontractor_company_name || '—'}</td>
                      <td className="p-2 text-surface-600 text-xs">
                        {[d.id_number, d.license_number].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="p-2 text-surface-600">{d.linked_truck_registration || '—'}</td>
                      <td className="p-2 text-surface-600 whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                      <td className="p-2 text-surface-600">{d.added_by_name || '—'}</td>
                      <td className="p-2">{approvalBadge(st)}</td>
                      <td className="p-2">
                        {isPending ? (
                          <div className="flex gap-1">
                            <button type="button" disabled={actingId === d.id} onClick={() => approveDriver(d.id)} className="px-2 py-1 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                              {actingId === d.id ? '…' : 'Approve'}
                            </button>
                            <button type="button" disabled={actingId === d.id} onClick={() => { setDeclineKind('driver'); setDeclineTarget(d); setDeclineReason(''); }} className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                              Decline
                            </button>
                          </div>
                        ) : st === 'declined_contractor' && (d.contractor_decline_reason || d.contractorDeclineReason) ? (
                          <span className="text-xs text-red-700" title={d.contractor_decline_reason || d.contractorDeclineReason}>View reason</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {declineTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setDeclineTarget(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-surface-900 mb-2">Decline {declineKind === 'fleet' ? 'truck' : 'driver'}</h3>
            <p className="text-sm text-surface-600 mb-3">
              {declineKind === 'fleet'
                ? `${declineTarget.registration} — ${declineTarget.subcontractor_company_name || declineTarget.sub_contractor}`
                : `${driverLabel(declineTarget)} — ${declineTarget.subcontractor_company_name || ''}`}
            </p>
            <label className="block text-sm font-medium text-surface-700 mb-1">Reason (required)</label>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4"
              placeholder={declineKind === 'fleet' ? 'Explain why this truck cannot be accepted…' : 'Explain why this driver cannot be accepted…'}
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setDeclineTarget(null)} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300">Cancel</button>
              <button type="button" onClick={submitDecline} disabled={actingId === declineTarget.id} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {actingId === declineTarget.id ? 'Declining…' : `Decline ${declineKind === 'fleet' ? 'truck' : 'driver'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
