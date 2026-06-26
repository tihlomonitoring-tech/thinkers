import { useState, useEffect, useCallback } from 'react';
import { contractor as contractorApi } from '../api';
import { formatTruckRegistration } from '../lib/truckKey.js';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function RectorAcceptanceRequestsPanel({ routes = [] }) {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [routeFilter, setRouteFilter] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (routeFilter) params.routeId = routeFilter;
      const r = await contractorApi.rectorAcceptance.requests(params);
      setRequests(r.requests || []);
    } catch (e) {
      setError(e?.message || 'Failed to load requests');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, routeFilter]);

  useEffect(() => { load(); }, [load]);

  const accept = async (id) => {
    setBusyId(id);
    try {
      await contractorApi.rectorAcceptance.accept(id);
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to accept');
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    setBusyId(rejectFor);
    try {
      await contractorApi.rectorAcceptance.reject(rejectFor, rejectNote.trim() || undefined);
      setRejectFor(null);
      setRejectNote('');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to reject');
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-surface-900">Acceptance requests</h3>
        <p className="text-sm text-surface-500 mt-1 max-w-3xl">
          Contractors request your acceptance of trucks that are not yet on the accepted list for a route. Review the full
          truck details and accept (adds it to the route's accepted list) or reject with a reason.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-surface-200 rounded-lg p-0.5 bg-surface-50">
          {[
            { id: 'pending', label: 'Pending' },
            { id: 'accepted', label: 'Accepted' },
            { id: 'rejected', label: 'Rejected' },
            { id: '', label: 'All' },
          ].map((s) => (
            <button
              key={s.id || 'all'}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${statusFilter === s.id ? 'bg-white shadow-sm text-brand-700 font-medium' : 'text-surface-600 hover:text-surface-900'}`}
            >
              {s.label}{s.id === 'pending' && pendingCount ? ` (${pendingCount})` : ''}
            </button>
          ))}
        </div>
        <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm">
          <option value="">All routes</option>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.name || 'Unnamed route'}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-surface-500">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-surface-500">No {statusFilter || ''} requests.</p>
        ) : requests.map((r) => (
          <div key={r.id} className="app-glass-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-surface-900">{formatTruckRegistration(r.registration) || '—'}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[r.status] || 'bg-surface-100 text-surface-700'}`}>{r.status}</span>
                </div>
                <p className="text-xs text-surface-500 mt-0.5">
                  Route: <strong className="text-surface-700">{r.route_name || '—'}</strong> · Requested by {r.requested_by_name || '—'} · {fmtDate(r.requested_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="text-xs font-medium text-brand-600 hover:underline">
                  {expanded === r.id ? 'Hide details' : 'View details'}
                </button>
                {r.status === 'pending' && (
                  <>
                    <button type="button" disabled={busyId === r.id} onClick={() => accept(r.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                      {busyId === r.id ? '…' : 'Accept'}
                    </button>
                    <button type="button" disabled={busyId === r.id} onClick={() => { setRejectFor(r.id); setRejectNote(''); }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>

            {expanded === r.id && (
              <div className="mt-3 pt-3 border-t border-surface-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Detail label="Fleet number" value={r.fleet_no} />
                <Detail label="Trailer 1" value={formatTruckRegistration(r.trailer_1_reg_no)} />
                <Detail label="Trailer 2" value={formatTruckRegistration(r.trailer_2_reg_no)} />
                <Detail label="Make / model" value={r.make_model} />
                <Detail label="Year" value={r.year_model} />
                <Detail label="Main contractor" value={r.main_contractor} />
                <Detail label="Sub-contractor" value={r.sub_contractor} />
                <Detail label="Commodity" value={r.commodity_type} />
                <Detail label="Capacity (t)" value={r.capacity_tonnes} />
                <Detail label="Tracking" value={r.tracking_provider} />
                <Detail label="Facility access" value={r.facility_access ? 'Yes' : 'No'} />
                {r.note ? <div className="col-span-2 sm:col-span-4"><Detail label="Contractor message" value={r.note} /></div> : null}
                {r.review_note ? <div className="col-span-2 sm:col-span-4"><Detail label="Review note" value={r.review_note} /></div> : null}
                {r.reviewed_at ? <Detail label="Reviewed at" value={fmtDate(r.reviewed_at)} /> : null}
              </div>
            )}

            {rejectFor === r.id && (
              <div className="mt-3 pt-3 border-t border-surface-100 space-y-2">
                <label className="block text-xs text-surface-500">Reason (optional, shared with contractor)</label>
                <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" placeholder="Why is this truck rejected?" />
                <div className="flex gap-2">
                  <button type="button" disabled={busyId === r.id} onClick={submitReject} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Confirm reject</button>
                  <button type="button" onClick={() => { setRejectFor(null); setRejectNote(''); }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-surface-400">{label}</p>
      <p className="text-surface-800">{value != null && value !== '' ? value : '—'}</p>
    </div>
  );
}
