import { useState } from 'react';
import FleetChangeDiffTable from './FleetChangeDiffTable.jsx';
import InfoHint from './InfoHint.jsx';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function FleetPendingChangesTab({
  changeRequests = [],
  loading = false,
  acting = false,
  onRefresh,
  onApprove,
  onBulkApprove,
  onDecline,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [declineTarget, setDeclineTarget] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const selected = changeRequests.find((c) => c.id === selectedId) || null;
  const selectedCount = changeRequests.reduce((n, c) => (selectedIds.has(c.id) ? n + 1 : n), 0);
  const allSelected = changeRequests.length > 0 && selectedCount === changeRequests.length;

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(changeRequests.map((c) => c.id)));
  };

  const handleBulkApprove = async () => {
    const ids = changeRequests.filter((c) => selectedIds.has(c.id)).map((c) => c.id);
    if (!ids.length) return;
    const facilityCount = changeRequests.filter((c) => selectedIds.has(c.id) && c.hadFacilityAccess).length;
    const msg = facilityCount
      ? `Accept ${ids.length} selected change${ids.length === 1 ? '' : 's'}? ${facilityCount} truck${facilityCount === 1 ? '' : 's'} had facility access and will return to pending facility approval with the new details (re-enrollment required where registration changed).`
      : `Accept and apply ${ids.length} selected change${ids.length === 1 ? '' : 's'} to the system?`;
    if (!window.confirm(msg)) return;
    await onBulkApprove?.(ids);
    setSelectedIds(new Set());
    setSelectedId(null);
  };

  const handleApprove = async (cr) => {
    const msg = cr.hadFacilityAccess
      ? 'Accept these changes? The truck had facility access — it will return to pending facility approval with the new details applied (re-enrollment required if registration changed).'
      : 'Accept and apply these changes to the system?';
    if (!window.confirm(msg)) return;
    await onApprove?.(cr.id);
    setSelectedId(null);
  };

  const submitDecline = async () => {
    const reason = declineReason.trim();
    if (!reason || !declineTarget) return;
    await onDecline?.(declineTarget.id, reason);
    setDeclineTarget(null);
    setDeclineReason('');
    setSelectedId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-surface-900">Pending fleet changes</h2>
          <p className="text-sm text-surface-600 mt-1">
            Review requested edits before they take effect. Trucks that previously had facility access return to pending approval with the updated details once you accept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={acting || selectedCount === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {acting ? 'Applying…' : `Approve selected${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-0 min-h-[420px]">
        <section className="flex-1 min-w-0 app-glass-panel-2xl overflow-hidden shadow-sm border border-surface-200">
          <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex items-center gap-2">
            <span className="font-semibold text-surface-900">Queue</span>
            <InfoHint
              title="Pending changes"
              text="Select a row to see every field the contractor or sub-contractor wants to change. Accept applies the requested values; trucks that had facility access go back to pending facility approval."
            />
            <span className="text-xs text-surface-500 ml-auto">{changeRequests.length} pending</span>
          </div>
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-sm text-surface-500">Loading…</p>
            ) : changeRequests.length === 0 ? (
              <p className="px-4 py-8 text-sm text-surface-500 text-center">No fleet changes awaiting Command Centre acceptance.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-50 z-10">
                  <tr className="border-b border-surface-200">
                    <th className="px-3 py-2 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        title="Select all"
                        className="h-4 w-4 rounded border-surface-300 text-green-600 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-3 py-2 font-semibold text-surface-700">Contractor</th>
                    <th className="text-left px-3 py-2 font-semibold text-surface-700">Sub-contractor</th>
                    <th className="text-left px-3 py-2 font-semibold text-surface-700">Truck</th>
                    <th className="text-left px-3 py-2 font-semibold text-surface-700">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {changeRequests.map((cr) => (
                    <tr
                      key={cr.id}
                      onClick={() => setSelectedId(cr.id)}
                      className={`border-b border-surface-100 cursor-pointer hover:bg-red-50/50 ${
                        selectedId === cr.id ? 'bg-red-50 border-l-4 border-l-red-500' : 'bg-white'
                      }`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(cr.id)}
                          onChange={() => toggleOne(cr.id)}
                          className="h-4 w-4 rounded border-surface-300 text-green-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2">{cr.contractorName || '—'}</td>
                      <td className="px-3 py-2 max-w-[140px] truncate" title={cr.subcontractorDisplay || ''}>
                        {cr.subcontractorDisplay || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium">{cr.truckRegistration || cr.proposed?.registration || '—'}</td>
                      <td className="px-3 py-2 text-surface-600 whitespace-nowrap">{formatDate(cr.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {selected && (
          <section className="w-full max-w-xl shrink-0 border-l border-surface-200 bg-white flex flex-col max-h-[560px] overflow-hidden shadow-lg">
            <div className="px-4 py-3 border-b border-surface-200 bg-red-50">
              <h3 className="font-semibold text-red-900">Requested changes</h3>
              <p className="text-sm text-red-800 mt-0.5 font-mono">{selected.truckRegistration || selected.proposed?.registration}</p>
              <p className="text-xs text-surface-600 mt-1">
                {selected.contractorName}
                {selected.subcontractorDisplay ? ` · ${selected.subcontractorDisplay}` : ''}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selected.submitterRole === 'subcontractor' && (
                <p className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                  Sub-contractor edit (approved by main contractor).
                </p>
              )}
              {selected.hadFacilityAccess && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  This truck had facility access. After you accept, it returns to <strong>pending facility approval</strong> with the new details applied
                  {selected.registrationChanged ? ' and must be re-enrolled on routes.' : '.'}
                </p>
              )}
              {selected.commentText && (
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Comment</p>
                  <p className="text-sm text-surface-800 whitespace-pre-wrap rounded-lg border border-surface-200 bg-surface-50 p-3">
                    {selected.commentText}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Field changes</p>
                <FleetChangeDiffTable previous={selected.previous} proposed={selected.proposed} />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-surface-200 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={acting}
                onClick={() => handleApprove(selected)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {acting ? 'Applying…' : 'Accept changes'}
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => setDeclineTarget(selected)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50 ml-auto"
              >
                Close
              </button>
            </div>
          </section>
        )}
      </div>

      {declineTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Decline change request</h3>
            <p className="text-sm text-surface-600 mb-3 font-mono">{declineTarget.truckRegistration || '—'}</p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4"
              placeholder="Reason for declining this change…"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setDeclineTarget(null)} className="px-3 py-2 text-sm rounded-lg border border-surface-300">
                Cancel
              </button>
              <button
                type="button"
                disabled={acting || !declineReason.trim()}
                onClick={submitDecline}
                className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-50"
              >
                Submit decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
