import { useState, useMemo } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../../api';
import InfoHint from '../InfoHint.jsx';
import { exportLeaveHistoryExcel, exportTeamBalancesExcel } from '../../lib/leaveManagementExports.js';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function sectorLabel(s) {
  if (s === 'public') return 'Public sector';
  if (s === 'private') return 'Private sector';
  if (s === 'both') return 'Public & private';
  return '—';
}

function LeaveAttachments({ applicationId, count = 0, onError }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  if (!count) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      setLoading(true);
      try {
        const d = await pm.leave.attachments(applicationId);
        setItems(d.attachments || []);
      } catch (err) {
        onError?.(err?.message || 'Could not load attachments');
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const download = async (att) => {
    setDownloadingId(att.id);
    try {
      await downloadAttachmentWithAuth(pm.leave.attachmentDownloadUrl(att.id), att.file_name);
    } catch (err) {
      onError?.(err?.message || 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1">
        <span aria-hidden>📎</span>
        {open ? 'Hide attachments' : `View attachments (${count})`}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-surface-200 bg-surface-50 p-2">
          {loading ? (
            <p className="text-xs text-surface-500">Loading…</p>
          ) : items && items.length > 0 ? (
            <ul className="space-y-1">
              {items.map((att) => (
                <li key={att.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-surface-700">{att.file_name}</span>
                  <button
                    type="button"
                    disabled={downloadingId === att.id}
                    onClick={() => download(att)}
                    className="shrink-0 text-brand-600 hover:underline disabled:opacity-50"
                  >
                    {downloadingId === att.id ? 'Downloading…' : 'Download'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-surface-500">No attachments found.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Shared leave management UI used by both Management and Operator Management.
 * Tabs: Pending review, History (with Excel export), Team balances (allocate /
 * edit / export / by-employee / by-type / full table) and Leave types (with
 * auto-approve toggle). Leave is tenant-wide, so operator applications appear
 * here too.
 */
export default function LeaveSection({
  pending,
  leaveTypes = [],
  history = [],
  teamBalances = [],
  balanceYear,
  onBalanceYearChange,
  onRefresh,
  onError,
  title = 'Leave',
}) {
  const [sub, setSub] = useState('pending');
  const [historyFilter, setHistoryFilter] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewId, setReviewId] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newLeaveTypeName, setNewLeaveTypeName] = useState('');
  const [newLeaveTypeDays, setNewLeaveTypeDays] = useState('');
  const [newLeaveTypeSector, setNewLeaveTypeSector] = useState('');
  const [savingType, setSavingType] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [togglingTypeId, setTogglingTypeId] = useState(null);
  const [allocating, setAllocating] = useState(false);
  const [editBalanceKey, setEditBalanceKey] = useState(null);
  const [editBalanceValue, setEditBalanceValue] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);
  const [downloadingHistory, setDownloadingHistory] = useState(false);
  const [downloadingBalances, setDownloadingBalances] = useState(false);
  const [balanceView, setBalanceView] = useState('employee');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [balanceTypeFilter, setBalanceTypeFilter] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const handleDownloadHistory = async () => {
    setDownloadingHistory(true);
    onError('');
    try {
      await exportLeaveHistoryExcel(filteredHistory);
    } catch (err) {
      onError(err?.message || 'Export failed');
    } finally {
      setDownloadingHistory(false);
    }
  };

  const handleDownloadBalances = async () => {
    setDownloadingBalances(true);
    onError('');
    try {
      await exportTeamBalancesExcel(filteredBalances, { year: balanceYear });
    } catch (err) {
      onError(err?.message || 'Export failed');
    } finally {
      setDownloadingBalances(false);
    }
  };

  const handleToggleAutoApprove = async (t) => {
    setTogglingTypeId(t.id);
    onError('');
    try {
      await pm.leave.updateType(t.id, { auto_approve: !t.auto_approve });
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Could not update auto-approve');
    } finally {
      setTogglingTypeId(null);
    }
  };

  const handleAllocateBalances = async () => {
    setAllocating(true);
    onError('');
    try {
      const res = await pm.leave.allocateBalances(balanceYear);
      onRefresh();
      alert(`Leave balances allocated for ${balanceYear} from leave-type defaults. ${res.created ?? 0} new row(s) created. Existing used-day counts were preserved.`);
    } catch (err) {
      onError(err?.message || 'Allocation failed');
    } finally {
      setAllocating(false);
    }
  };

  const handleSaveBalance = async (b) => {
    const total = parseInt(editBalanceValue, 10);
    if (!Number.isFinite(total) || total < 0) {
      onError('Enter a valid number of allocated days');
      return;
    }
    setSavingBalance(true);
    onError('');
    try {
      await pm.leave.updateBalanceEntry({
        user_id: b.user_id,
        year: b.year ?? balanceYear,
        leave_type: b.leave_type,
        total_days: total,
      });
      setEditBalanceKey(null);
      setEditBalanceValue('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Could not save allocation');
    } finally {
      setSavingBalance(false);
    }
  };

  const handleReview = async () => {
    if (!reviewId || !status) return;
    setSaving(true);
    onError('');
    try {
      await pm.leave.review(reviewId, { status, review_notes: reviewNotes || undefined });
      setReviewId(null);
      setReviewNotes('');
      setStatus(null);
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLeaveType = async (e) => {
    e.preventDefault();
    if (!newLeaveTypeName.trim()) return;
    setSavingType(true);
    onError('');
    try {
      await pm.leave.createType({
        name: newLeaveTypeName.trim(),
        default_days_per_year: newLeaveTypeDays ? parseInt(newLeaveTypeDays, 10) : undefined,
        sector: newLeaveTypeSector && ['public', 'private', 'both'].includes(newLeaveTypeSector) ? newLeaveTypeSector : undefined,
      });
      setNewLeaveTypeName('');
      setNewLeaveTypeDays('');
      setNewLeaveTypeSector('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to create leave type');
    } finally {
      setSavingType(false);
    }
  };

  const handleSeedSa = async () => {
    setSeeding(true);
    onError('');
    try {
      const res = await pm.leave.seedSaTypes();
      onRefresh();
      onError('');
      alert(`Added ${res.inserted ?? 0} South African leave type(s) (${res.total_definitions ?? ''} definitions in catalog). Existing names were skipped.`);
    } catch (err) {
      onError(err?.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  const filteredHistory = (history || []).filter((a) => {
    if (!historyFilter) return true;
    const q = historyFilter.toLowerCase();
    return (
      String(a.user_name || '').toLowerCase().includes(q) ||
      String(a.leave_type || '').toLowerCase().includes(q) ||
      String(a.status || '').toLowerCase().includes(q)
    );
  });

  const balanceTypeOptions = useMemo(() => {
    const set = new Set();
    (teamBalances || []).forEach((b) => b.leave_type && set.add(b.leave_type));
    return Array.from(set).sort();
  }, [teamBalances]);

  const filteredBalances = useMemo(() => {
    const q = balanceSearch.trim().toLowerCase();
    return (teamBalances || []).filter((b) => {
      if (balanceTypeFilter && b.leave_type !== balanceTypeFilter) return false;
      if (q) {
        const hay = `${b.full_name || ''} ${b.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (lowOnly) {
        const remaining = (b.total_days ?? 0) - (b.used_days ?? 0);
        const allocated = b.total_days ?? 0;
        if (!(remaining <= 0 || (allocated > 0 && remaining / allocated < 0.25))) return false;
      }
      return true;
    });
  }, [teamBalances, balanceSearch, balanceTypeFilter, lowOnly]);

  const balanceSummary = useMemo(() => {
    const employees = new Set();
    let allocated = 0;
    let used = 0;
    let low = 0;
    filteredBalances.forEach((b) => {
      employees.add(b.user_id);
      const a = b.total_days ?? 0;
      const u = b.used_days ?? 0;
      allocated += a;
      used += u;
      const rem = a - u;
      if (rem <= 0 || (a > 0 && rem / a < 0.25)) low += 1;
    });
    return { employees: employees.size, allocated, used, remaining: allocated - used, low };
  }, [filteredBalances]);

  const balancesByEmployee = useMemo(() => {
    const map = new Map();
    filteredBalances.forEach((b) => {
      const key = b.user_id;
      if (!map.has(key)) map.set(key, { user_id: b.user_id, name: b.full_name || b.email || b.user_id, email: b.email, rows: [] });
      map.get(key).rows.push(b);
    });
    return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [filteredBalances]);

  const balancesByType = useMemo(() => {
    const map = new Map();
    filteredBalances.forEach((b) => {
      const key = b.leave_type;
      if (!map.has(key)) map.set(key, { leave_type: b.leave_type, sector: b.type_sector, typical: b.type_default_days_per_year, rows: [] });
      map.get(key).rows.push(b);
    });
    return Array.from(map.values()).sort((a, b) => String(a.leave_type).localeCompare(String(b.leave_type)));
  }, [filteredBalances]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">{title}</h1>
        <InfoHint
          title="Leave management"
          text="Configure leave types (including a South African starter set), approve requests, browse full history, and view recorded leave balances per employee for a calendar year."
        />
      </div>

      <div className="flex gap-2 border-b border-surface-200 flex-wrap">
        {[
          { id: 'pending', label: `Pending (${pending.length})` },
          { id: 'history', label: `History (${history.length})` },
          { id: 'balances', label: 'Team balances' },
          { id: 'types', label: `Leave types (${leaveTypes.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              sub === t.id ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'types' && (
      <div className="app-glass-card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <p className="text-sm font-medium text-surface-700">Leave types (database)</p>
          <InfoHint
            title="Leave types & auto-approve"
            text="Types are stored per organisation. Use the SA starter set for BCEA-oriented names and typical day weights. Turn on Auto-approve for a type to have the system approve those applications instantly on submission and email management to confirm."
          />
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedSa}
            className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50"
          >
            {seeding ? 'Adding…' : 'Add South African leave types (missing only)'}
          </button>
        </div>
        <form onSubmit={handleCreateLeaveType} className="flex flex-wrap gap-2 items-end">
          <input type="text" value={newLeaveTypeName} onChange={(e) => setNewLeaveTypeName(e.target.value)} placeholder="Name" className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-48" />
          <input type="number" value={newLeaveTypeDays} onChange={(e) => setNewLeaveTypeDays(e.target.value)} placeholder="Days/year" min={0} className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-24" />
          <select value={newLeaveTypeSector} onChange={(e) => setNewLeaveTypeSector(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
            <option value="">Sector (optional)</option>
            <option value="both">Public &amp; private</option>
            <option value="public">Public sector</option>
            <option value="private">Private sector</option>
          </select>
          <button type="submit" disabled={savingType} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {savingType ? 'Adding…' : 'Add type'}
          </button>
        </form>
        {leaveTypes.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="text-left text-surface-500 border-b border-surface-200">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Typical days / year</th>
                  <th className="py-2 pr-3 font-medium">Sector</th>
                  <th className="py-2 pr-3 font-medium">Auto-approve</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {leaveTypes.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="py-2 pr-3 font-medium text-surface-900">{t.name}</td>
                    <td className="py-2 pr-3">{t.default_days_per_year != null ? `${t.default_days_per_year}` : '—'}</td>
                    <td className="py-2 pr-3">{sectorLabel(t.sector)}</td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!t.auto_approve}
                        disabled={togglingTypeId === t.id}
                        onClick={() => handleToggleAutoApprove(t)}
                        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                          t.auto_approve ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                        }`}
                        title={t.auto_approve ? 'Applications of this type are approved automatically. Click to turn off.' : 'Click to approve this leave type automatically on submission.'}
                      >
                        <span className={`h-2 w-2 rounded-full ${t.auto_approve ? 'bg-emerald-500' : 'bg-surface-400'}`} />
                        {togglingTypeId === t.id ? 'Saving…' : t.auto_approve ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="py-2 text-surface-600 text-xs max-w-md">{t.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-surface-500">No types yet — seed SA types or add manually.</p>
        )}
      </div>
      )}

      {sub === 'pending' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-surface-700">Pending applications</span>
            <InfoHint title="Reviewing leave" text="Approve or reject pending applications. Optional review notes are saved with the decision." />
          </div>
          {pending.length === 0 ? (
            <p className="text-surface-500 text-sm app-glass-card p-6">No pending applications.</p>
          ) : (
            <ul className="space-y-4">
              {pending.map((a) => (
                <li key={a.id} className="app-glass-card p-4">
                  <p className="font-medium">{a.user_name} — {a.leave_type}</p>
                  <p className="text-sm text-surface-600">{formatDate(a.start_date)} to {formatDate(a.end_date)} ({a.days_requested} days)</p>
                  {a.reason && <p className="text-sm text-surface-500 mt-1">{a.reason}</p>}
                  <LeaveAttachments applicationId={a.id} count={a.attachment_count} onError={onError} />
                  {reviewId !== a.id ? (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => { setReviewId(a.id); setStatus('approved'); setReviewNotes(''); }} className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-sm font-medium hover:bg-emerald-200">
                        Approve
                      </button>
                      <button type="button" onClick={() => { setReviewId(a.id); setStatus('rejected'); setReviewNotes(''); }} className="px-3 py-1.5 rounded-lg bg-red-100 text-red-800 text-sm font-medium hover:bg-red-200">
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Review notes (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      <div className="flex gap-2">
                        <button type="button" onClick={handleReview} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                          {saving ? 'Saving…' : `Confirm ${status}`}
                        </button>
                        <button type="button" onClick={() => { setReviewId(null); setStatus(null); }} className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {sub === 'history' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="search"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              placeholder="Filter by employee, type, or status"
              className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-500">{filteredHistory.length} of {history.length}</span>
              <button
                type="button"
                disabled={downloadingHistory || filteredHistory.length === 0}
                onClick={handleDownloadHistory}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              >
                <span aria-hidden>⬇</span>
                {downloadingHistory ? 'Preparing…' : 'Download Excel'}
              </button>
            </div>
          </div>
          {filteredHistory.length === 0 ? (
            <p className="text-surface-500 text-sm app-glass-card p-6">No records match.</p>
          ) : (
            <div className="app-glass-card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-surface-50 border-b border-surface-200 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-surface-700">Employee</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Type</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Dates</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Days</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Status</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Applied</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Reviewed</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Attachments</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredHistory.map((a) => (
                    <tr key={a.id} className="align-top">
                      <td className="px-4 py-2">{a.user_name || '—'}</td>
                      <td className="px-4 py-2">{a.leave_type}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(a.start_date)} – {formatDate(a.end_date)}</td>
                      <td className="px-4 py-2">{a.days_requested}</td>
                      <td className="px-4 py-2 capitalize">{a.status}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(a.created_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(a.reviewed_at)}</td>
                      <td className="px-4 py-2">
                        {a.attachment_count ? (
                          <LeaveAttachments applicationId={a.id} count={a.attachment_count} onError={onError} />
                        ) : (
                          <span className="text-surface-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sub === 'balances' && (
        <div className="space-y-4">
          <div className="app-glass-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-surface-700">Leave year</label>
              <input
                type="number"
                value={balanceYear}
                onChange={(e) => {
                  const y = parseInt(e.target.value, 10);
                  if (Number.isFinite(y)) onBalanceYearChange(y);
                }}
                className="w-24 rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={allocating}
                onClick={handleAllocateBalances}
                className="px-3 py-2 rounded-lg border border-brand-200 bg-brand-50 text-brand-800 text-sm font-medium hover:bg-brand-100 disabled:opacity-50"
              >
                {allocating ? 'Allocating…' : 'Allocate from defaults'}
              </button>
              <button
                type="button"
                disabled={downloadingBalances || filteredBalances.length === 0}
                onClick={handleDownloadBalances}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              >
                <span aria-hidden>⬇</span>
                {downloadingBalances ? 'Preparing…' : 'Download Excel'}
              </button>
              <InfoHint
                title="Leave balances"
                text="Every active employee is shown for each leave type. Remaining = allocated − used. Allocated falls back to the leave type's typical days until you allocate or edit it. 'Allocate from defaults' sets each employee's allocation to the type default for the year (used days are preserved). In the Full table view, click a person's allocated value to edit it."
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={balanceSearch}
                onChange={(e) => setBalanceSearch(e.target.value)}
                placeholder="Search employee"
                className="flex-1 min-w-[180px] max-w-xs rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
              <select
                value={balanceTypeFilter}
                onChange={(e) => setBalanceTypeFilter(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="">All leave types</option>
                {balanceTypeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-sm text-surface-600">
                <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="rounded border-surface-300" />
                Low balance only
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'Employees', value: balanceSummary.employees, accent: 'text-surface-900' },
              { label: 'Allocated', value: balanceSummary.allocated, accent: 'text-surface-900' },
              { label: 'Used', value: balanceSummary.used, accent: 'text-amber-600' },
              { label: 'Remaining', value: balanceSummary.remaining, accent: balanceSummary.remaining <= 0 ? 'text-red-600' : 'text-emerald-600' },
              { label: 'Low balance', value: balanceSummary.low, accent: balanceSummary.low > 0 ? 'text-red-600' : 'text-surface-900' },
            ].map((s) => (
              <div key={s.label} className="app-glass-card px-4 py-3 text-center">
                <p className="text-[11px] uppercase tracking-wide text-surface-500">{s.label}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${s.accent}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'employee', label: 'By employee' },
              { id: 'type', label: 'By leave type' },
              { id: 'table', label: 'Full table' },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setBalanceView(v.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  balanceView === v.id ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {filteredBalances.length === 0 ? (
            <p className="text-surface-500 text-sm app-glass-card p-6">No balances match. Add leave types above, then allocate, or clear the filters.</p>
          ) : balanceView === 'employee' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {balancesByEmployee.map((emp) => (
                <div key={emp.user_id} className="app-glass-card p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-surface-900 truncate">{emp.name}</p>
                      {emp.email && <p className="text-xs text-surface-500 truncate">{emp.email}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-surface-500">{emp.rows.length} type{emp.rows.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-2.5">
                    {emp.rows.map((b) => {
                      const allocated = b.total_days ?? 0;
                      const used = b.used_days ?? 0;
                      const remaining = allocated - used;
                      const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : (used > 0 ? 100 : 0);
                      const lowRatio = allocated > 0 ? remaining / allocated : 1;
                      const barColor = remaining <= 0 ? 'bg-red-500' : lowRatio < 0.25 ? 'bg-amber-500' : 'bg-emerald-500';
                      const remColor = remaining <= 0 ? 'text-red-600' : 'text-emerald-700';
                      return (
                        <div key={`${emp.user_id}-${b.leave_type}`}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-surface-700 truncate pr-2">{b.leave_type}</span>
                            <span className={`font-semibold tabular-nums ${remColor}`}>{remaining} left</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-surface-100 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-surface-400">{used} used of {allocated}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : balanceView === 'type' ? (
            <div className="space-y-3">
              {balancesByType.map((grp) => {
                const totAlloc = grp.rows.reduce((s, r) => s + (r.total_days ?? 0), 0);
                const totUsed = grp.rows.reduce((s, r) => s + (r.used_days ?? 0), 0);
                return (
                  <div key={grp.leave_type} className="app-glass-card p-4 overflow-x-auto">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="font-semibold text-surface-900">{grp.leave_type}</p>
                      <p className="text-xs text-surface-500">
                        {grp.typical != null ? `Typical ${grp.typical}/yr` : ''}{grp.typical != null && sectorLabel(grp.sector) ? ' · ' : ''}{sectorLabel(grp.sector)}
                        {' · '}{totUsed}/{totAlloc} days used
                      </p>
                    </div>
                    <table className="w-full text-sm min-w-[480px]">
                      <thead className="text-left text-surface-500 border-b border-surface-200">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">Employee</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Allocated</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Used</th>
                          <th className="py-1.5 font-medium text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {grp.rows.map((b) => {
                          const allocated = b.total_days ?? 0;
                          const used = b.used_days ?? 0;
                          const remaining = allocated - used;
                          return (
                            <tr key={`${grp.leave_type}-${b.user_id}`}>
                              <td className="py-1.5 pr-3">{b.full_name || b.email || b.user_id}</td>
                              <td className="py-1.5 pr-3 text-right">{allocated}</td>
                              <td className="py-1.5 pr-3 text-right">{used}</td>
                              <td className={`py-1.5 text-right font-semibold ${remaining <= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{remaining}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="app-glass-card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-surface-50 border-b border-surface-200 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-surface-700">Employee</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Leave type</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Allocated</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Used</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Remaining</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Typical (type)</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Sector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredBalances.map((b, idx) => {
                    const rowKey = `${b.user_id}-${b.leave_type}-${b.year ?? balanceYear}`;
                    const allocated = b.total_days ?? 0;
                    const used = b.used_days ?? 0;
                    const remaining = allocated - used;
                    const editing = editBalanceKey === rowKey;
                    return (
                      <tr key={`${rowKey}-${idx}`}>
                        <td className="px-4 py-2">{b.full_name || b.email || b.user_id}</td>
                        <td className="px-4 py-2">{b.leave_type}</td>
                        <td className="px-4 py-2">
                          {editing ? (
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={editBalanceValue}
                                onChange={(e) => setEditBalanceValue(e.target.value)}
                                className="w-20 rounded border border-surface-300 px-2 py-1 text-sm"
                                autoFocus
                              />
                              <button type="button" disabled={savingBalance} onClick={() => handleSaveBalance(b)} className="text-brand-600 hover:underline text-xs disabled:opacity-50">
                                {savingBalance ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" onClick={() => { setEditBalanceKey(null); setEditBalanceValue(''); }} className="text-surface-500 hover:underline text-xs">Cancel</button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setEditBalanceKey(rowKey); setEditBalanceValue(String(allocated)); }}
                              className="rounded px-2 py-0.5 hover:bg-surface-100 hover:underline decoration-dotted"
                              title="Click to edit this person's allocation"
                            >
                              {allocated}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2">{used}</td>
                        <td className={`px-4 py-2 font-semibold ${remaining <= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{remaining}</td>
                        <td className="px-4 py-2">{b.type_default_days_per_year != null ? b.type_default_days_per_year : '—'}</td>
                        <td className="px-4 py-2">{sectorLabel(b.type_sector)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
