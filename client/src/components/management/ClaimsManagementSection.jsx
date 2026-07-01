import { useState } from 'react';
import { claims as claimsApi } from '../../api';
import InfoHint from '../InfoHint.jsx';
import { OvertimeClaimDetail } from '../OvertimeClaimFields.jsx';
import {
  downloadClaimsExcel,
  downloadClaimsPdf,
  downloadSingleClaimExcel,
  downloadSingleClaimPdf,
} from '../../lib/claimsExport.js';

const CLAIM_TYPES_MAP = { fuel: 'Fuel', travel: 'Travel expense', accommodation: 'Accommodation', meals: 'Meals', equipment: 'Equipment', tools: 'Tools', training: 'Training', communication: 'Communication', service: 'Service rendered', overtime: 'Overtime', other: 'Other' };
const CLAIM_STATUS_STYLES = { draft: 'bg-surface-100 text-surface-700', pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', declined: 'bg-red-50 text-red-700 ring-1 ring-red-200', paid: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', cancelled: 'bg-surface-200 text-surface-500' };

/**
 * Shared claims & reimbursements review UI used by both Management and Operator Management.
 * Claims are tenant-wide, so operator-submitted claims are reviewable here too.
 */
export default function ClaimsManagementSection({ claims, loading, summary, onRefresh, user, title = 'Claims & reimbursements' }) {
  const [view, setView] = useState('dashboard');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSearch, setFilterSearch] = useState('');
  const [detailClaim, setDetailClaim] = useState(null);
  const [detailAttachments, setDetailAttachments] = useState([]);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(null);

  const fmtZar = (v) => { const n = Number(v); return isNaN(n) ? 'R 0.00' : 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const fmtDate = (d) => d ? String(d).slice(0, 10) : '—';

  const filtered = claims.filter((c) => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (filterSearch) { const q = filterSearch.toLowerCase(); return (c.reference_number || '').toLowerCase().includes(q) || (c.claimant_name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q); }
    return true;
  });

  const openDetail = (claim) => {
    setView('detail');
    setReviewNotes(claim.review_notes || '');
    setRejectionReason(claim.rejection_reason || '');
    claimsApi.get(claim.id).then((d) => {
      setDetailClaim(d.claim);
      setDetailAttachments(d.attachments || []);
      setReviewNotes(d.claim?.review_notes || '');
      setRejectionReason(d.claim?.rejection_reason || '');
    }).catch(() => {});
  };

  const handleReview = async (action) => {
    if (action === 'decline' && !rejectionReason.trim()) { alert('Please provide a reason for declining.'); return; }
    const status = detailClaim?.status;
    const flipping =
      (status === 'approved' && action === 'decline') ||
      (status === 'declined' && action === 'approve');
    if (flipping) {
      const label = action === 'approve' ? 'approved' : 'declined';
      if (!window.confirm(`Change this claim from ${status} to ${label}? The employee will be notified.`)) return;
    }
    setReviewing(true);
    try {
      const res = await claimsApi.review(detailClaim.id, { action, review_notes: reviewNotes, rejection_reason: rejectionReason });
      const updated = res?.claim;
      if (status === 'pending') {
        setView('dashboard');
        setDetailClaim(null);
      } else if (updated) {
        setDetailClaim(updated);
        setReviewNotes(updated.review_notes || '');
        setRejectionReason(updated.rejection_reason || '');
      }
      onRefresh();
    } catch (err) { alert(err?.message || 'Review failed'); }
    finally { setReviewing(false); }
  };

  const handleDeleteClaim = async () => {
    if (!detailClaim) return;
    if (detailClaim.status === 'paid') { alert('Paid claims cannot be deleted.'); return; }
    if (!window.confirm(`Permanently delete claim ${detailClaim.reference_number}? Deletion emails will be sent.`)) return;
    setReviewing(true);
    try {
      await claimsApi.delete(detailClaim.id);
      setView('dashboard');
      setDetailClaim(null);
      onRefresh();
    } catch (err) { alert(err?.message || 'Delete failed'); }
    finally { setReviewing(false); }
  };

  const runExport = async (kind) => {
    if (!filtered.length) {
      alert('No claims match the current filters to export.');
      return;
    }
    setExporting(kind);
    try {
      const meta = { filterStatus, filterSearch };
      if (kind === 'pdf') downloadClaimsPdf(filtered, meta);
      else await downloadClaimsExcel(filtered, meta);
    } catch (err) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const runSingleExport = async (claim, kind, attachments = []) => {
    const key = `one-${kind}-${claim.id}`;
    setExporting(key);
    try {
      if (kind === 'pdf') downloadSingleClaimPdf(claim, attachments);
      else await downloadSingleClaimExcel(claim, attachments);
    } catch (err) {
      alert(err?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const exportDisabled = !!exporting || loading || filtered.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-surface-900 tracking-tight">{title}</h1>
          <InfoHint
            title="Claims register"
            text="Review and approve employee reimbursement claims. Export the full register from the panel below, or download PDF/Excel for an individual claim from the list or claim detail."
          />
        </div>
        {view !== 'dashboard' && (
          <button type="button" onClick={() => { setView('dashboard'); setDetailClaim(null); }} className="text-sm text-brand-600 hover:underline font-medium">← Back to list</button>
        )}
      </div>

      {/* DASHBOARD */}
      {view === 'dashboard' && (
        <>
          <div className="app-glass-card p-4 shadow-sm border border-brand-100">
            <p className="text-sm font-semibold text-surface-900 mb-1">Export register</p>
            <p className="text-xs text-surface-600 mb-3 max-w-2xl">
              Downloads include every claim matching the status filter and search below ({filtered.length} row{filtered.length === 1 ? '' : 's'}).
              {filterStatus === 'pending' && filtered.length === 0 && claims.length > 0
                ? ' Try “All statuses” if you expected more claims.'
                : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={exportDisabled}
                onClick={() => runExport('excel')}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              >
                {exporting === 'excel' ? 'Preparing Excel…' : 'Download Excel'}
              </button>
              <button
                type="button"
                disabled={exportDisabled}
                onClick={() => runExport('pdf')}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50 shadow-sm"
              >
                {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              {exportDisabled && !loading && filtered.length === 0 && (
                <span className="text-xs text-amber-700">No rows to export — widen filters or add claims.</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200"><p className="text-xs text-amber-600 font-medium">Pending</p><p className="text-2xl font-bold text-amber-800 tabular-nums">{summary.pending_count || 0}</p><p className="text-xs text-amber-600">{fmtZar(summary.pending_amount)}</p></div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200"><p className="text-xs text-emerald-600 font-medium">Approved</p><p className="text-2xl font-bold text-emerald-800 tabular-nums">{summary.approved_count || 0}</p><p className="text-xs text-emerald-600">{fmtZar(summary.approved_amount)}</p></div>
            <div className="p-4 rounded-xl bg-red-50 border border-red-200"><p className="text-xs text-red-600 font-medium">Declined</p><p className="text-2xl font-bold text-red-800 tabular-nums">{summary.declined_count || 0}</p></div>
            <div className="p-4 rounded-xl bg-surface-50 border border-surface-200"><p className="text-xs text-surface-600 font-medium">Total</p><p className="text-2xl font-bold text-surface-800 tabular-nums">{summary.total || 0}</p></div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border border-surface-300 rounded-lg px-3 py-2 text-sm">
              <option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
            </select>
            <input type="text" placeholder="Search ref, name, description..." value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} className="border border-surface-300 rounded-lg px-3 py-2 text-sm w-60" />
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-surface-500"><p className="text-base font-medium">No claims match your filters</p></div>
          ) : (
            <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-surface-500 border-b border-surface-200 bg-surface-50">
                  <th className="px-4 py-2.5">Ref</th><th className="px-4 py-2.5">Claimant</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Type</th><th className="px-4 py-2.5">Description</th><th className="px-4 py-2.5 text-right">Amount</th>                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Actions</th>
                </tr></thead>
                <tbody>{filtered.map((c) => (
                  <tr key={c.id} className="border-b border-surface-50 hover:bg-surface-50 cursor-pointer" onClick={() => openDetail(c)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-brand-600 font-medium">{c.reference_number}</td>
                    <td className="px-4 py-2.5 font-medium">{c.claimant_name || '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtDate(c.claim_date)}</td>
                    <td className="px-4 py-2.5">{CLAIM_TYPES_MAP[c.claim_type] || c.claim_type}</td>
                    <td className="px-4 py-2.5 max-w-[200px] truncate">{c.description}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtZar(c.amount)}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLAIM_STATUS_STYLES[c.status] || ''}`}>{c.status}</span></td>
                    <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!!exporting}
                          title="Download this claim as Excel"
                          onClick={() => runSingleExport(c, 'excel')}
                          className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                        >
                          {exporting === `one-excel-${c.id}` ? '…' : 'Excel'}
                        </button>
                        <button
                          type="button"
                          disabled={!!exporting}
                          title="Download this claim as PDF"
                          onClick={() => runSingleExport(c, 'pdf')}
                          className="text-xs font-medium text-slate-700 hover:underline disabled:opacity-50"
                        >
                          {exporting === `one-pdf-${c.id}` ? '…' : 'PDF'}
                        </button>
                        {c.status !== 'paid' && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:underline"
                            onClick={async () => {
                              if (!window.confirm(`Delete claim ${c.reference_number}?`)) return;
                              try {
                                await claimsApi.delete(c.id);
                                onRefresh();
                              } catch (err) {
                                alert(err?.message || 'Delete failed');
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* DETAIL & REVIEW */}
      {view === 'detail' && detailClaim && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div><h3 className="text-lg font-semibold text-surface-900">{detailClaim.reference_number}</h3><p className="text-sm text-surface-500">{fmtDate(detailClaim.claim_date)} — {CLAIM_TYPES_MAP[detailClaim.claim_type] || detailClaim.claim_type}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${CLAIM_STATUS_STYLES[detailClaim.status] || ''}`}>{detailClaim.status}</span>
                <button
                  type="button"
                  disabled={!!exporting}
                  onClick={() => runSingleExport(detailClaim, 'excel', detailAttachments)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {exporting === `one-excel-${detailClaim.id}` ? 'Preparing…' : 'Excel'}
                </button>
                <button
                  type="button"
                  disabled={!!exporting}
                  onClick={() => runSingleExport(detailClaim, 'pdf', detailAttachments)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 disabled:opacity-50"
                >
                  {exporting === `one-pdf-${detailClaim.id}` ? 'Preparing…' : 'PDF'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-surface-500">Claimant</p><p className="font-semibold">{detailClaim.claimant_name || '—'}</p></div>
              <div><p className="text-xs text-surface-500">Amount</p><p className="font-semibold tabular-nums text-brand-700">{fmtZar(detailClaim.amount)}</p></div>
              <div><p className="text-xs text-surface-500">Department</p><p className="font-medium">{detailClaim.department_name || '—'}</p></div>
              <div><p className="text-xs text-surface-500">Category</p><p className="font-medium">{detailClaim.category || '—'}</p></div>
              {detailClaim.km_travelled && <div><p className="text-xs text-surface-500">KM Travelled</p><p className="font-medium">{detailClaim.km_travelled} km</p></div>}
              {detailClaim.start_location && <div><p className="text-xs text-surface-500">From</p><p className="font-medium">{detailClaim.start_location}</p></div>}
              {detailClaim.end_location && <div><p className="text-xs text-surface-500">To</p><p className="font-medium">{detailClaim.end_location}</p></div>}
              {detailClaim.vehicle_registration && <div><p className="text-xs text-surface-500">Vehicle</p><p className="font-medium">{detailClaim.vehicle_registration}</p></div>}
              {detailClaim.service_rendered && <div><p className="text-xs text-surface-500">Service</p><p className="font-medium">{detailClaim.service_rendered}</p></div>}
              {detailClaim.hours_spent && <div><p className="text-xs text-surface-500">Hours</p><p className="font-medium">{detailClaim.hours_spent}h</p></div>}
              {detailClaim.bank_name && <div><p className="text-xs text-surface-500">Bank</p><p className="font-medium">{detailClaim.bank_name}</p></div>}
              {detailClaim.account_holder && <div><p className="text-xs text-surface-500">Account holder</p><p className="font-medium">{detailClaim.account_holder}</p></div>}
              {detailClaim.account_number && <div><p className="text-xs text-surface-500">Account #</p><p className="font-medium">{detailClaim.account_number}</p></div>}
              {detailClaim.reviewed_by_name && <div><p className="text-xs text-surface-500">Reviewed by</p><p className="font-medium">{detailClaim.reviewed_by_name}</p></div>}
              {detailClaim.reviewed_at && <div><p className="text-xs text-surface-500">Reviewed at</p><p className="font-medium tabular-nums">{new Date(detailClaim.reviewed_at).toLocaleString()}</p></div>}
            </div>
            <OvertimeClaimDetail claim={detailClaim} fmtZar={fmtZar} />
            {detailClaim.description && <div><p className="text-xs text-surface-500 mb-1">Description</p><p className="text-sm whitespace-pre-wrap">{detailClaim.description}</p></div>}
            {detailClaim.review_notes && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg"><p className="text-xs text-blue-700 font-medium">Review notes:</p><p className="text-sm text-blue-600">{detailClaim.review_notes}</p></div>}
            {detailClaim.rejection_reason && <div className="p-3 bg-red-50 border border-red-200 rounded-lg"><p className="text-xs text-red-700 font-medium">Rejection reason:</p><p className="text-sm text-red-600">{detailClaim.rejection_reason}</p></div>}
          </div>

          {/* Attachments */}
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-sm font-semibold text-surface-900">Attachments</h4>
            {detailAttachments.length > 0 ? <div className="space-y-2">{detailAttachments.map((a) => (<div key={a.id} className="flex items-center gap-3 p-2 bg-surface-50 rounded-lg"><span className="text-sm text-surface-700 flex-1 truncate">{a.file_name}</span></div>))}</div> : <p className="text-sm text-surface-500">No attachments</p>}
          </div>

          {detailClaim.status !== 'paid' && (
            <div className="flex justify-end">
              <button type="button" disabled={reviewing} onClick={handleDeleteClaim} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                Delete claim
              </button>
            </div>
          )}

          {/* Review / change decision */}
          {(detailClaim.status === 'pending' || detailClaim.status === 'approved' || detailClaim.status === 'declined') && (
            <div className={`rounded-xl border p-5 space-y-4 ${detailClaim.status === 'pending' ? 'border-brand-200 bg-brand-50/30' : 'border-amber-200 bg-amber-50/40'}`}>
              <div>
                <h4 className="text-sm font-semibold text-surface-900">
                  {detailClaim.status === 'pending' ? 'Review this claim' : 'Change approval decision'}
                </h4>
                {detailClaim.status !== 'pending' && (
                  <p className="text-xs text-surface-600 mt-1">
                    Current decision: <span className="font-semibold capitalize">{detailClaim.status}</span>.
                    Choose Approve or Decline to change the outcome, or update notes on the same decision.
                    Paid claims cannot be changed here.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Review notes (optional)</label>
                <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" placeholder="Add any notes about this review..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Rejection reason (required if declining)</label>
                <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" placeholder="Reason for declining..." />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" disabled={reviewing} onClick={() => handleReview('approve')} className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {reviewing ? 'Processing…' : detailClaim.status === 'declined' ? 'Change to approve' : 'Approve'}
                </button>
                <button type="button" disabled={reviewing} onClick={() => handleReview('decline')} className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {reviewing ? 'Processing…' : detailClaim.status === 'approved' ? 'Change to decline' : 'Decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
