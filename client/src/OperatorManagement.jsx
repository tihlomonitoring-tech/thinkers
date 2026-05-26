import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { operatorManagement as opMgmt, profileManagement as pm } from './api';
import { wallMonthYearInAppZone } from './lib/appTime.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import InfoHint from './components/InfoHint.jsx';
import EmployeeDetailsManagementSection from './components/EmployeeDetailsManagementSection.jsx';

const SECTIONS = [
  { id: 'operator_schedules', label: 'Operator work schedules' },
  { id: 'operator_productivity', label: 'Operator productivity' },
  { id: 'operator_wages', label: 'Salary & wages' },
  { id: 'operator_leave', label: 'Operator leave' },
  { id: 'employee_details', label: 'Employee details' },
];

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

function LeaveSection({
  pending,
  leaveTypes = [],
  history = [],
  teamBalances = [],
  balanceYear,
  onBalanceYearChange,
  onRefresh,
  onError,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Operator leave</h1>
        <InfoHint
          title="Leave management"
          text="Configure leave types (including a South African starter set), approve requests, browse full history, and view recorded leave balances per employee for a calendar year."
        />
      </div>

      <div className="app-glass-card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <p className="text-sm font-medium text-surface-700">Leave types (database)</p>
          <InfoHint
            title="Leave types"
            text="Types are stored per organisation. Use the SA starter set for BCEA-oriented names and typical day weights; adjust in your HR policy as needed."
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
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {leaveTypes.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="py-2 pr-3 font-medium text-surface-900">{t.name}</td>
                    <td className="py-2 pr-3">{t.default_days_per_year != null ? `${t.default_days_per_year}` : '—'}</td>
                    <td className="py-2 pr-3">{sectorLabel(t.sector)}</td>
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

      <div className="flex gap-2 border-b border-surface-200 flex-wrap">
        {[
          { id: 'pending', label: `Pending (${pending.length})` },
          { id: 'history', label: `History (${history.length})` },
          { id: 'balances', label: 'Team balances' },
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
          <input
            type="search"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Filter by employee, type, or status"
            className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sub === 'balances' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-surface-700">Year</label>
            <input
              type="number"
              value={balanceYear}
              onChange={(e) => {
                const y = parseInt(e.target.value, 10);
                if (Number.isFinite(y)) onBalanceYearChange(y);
              }}
              className="w-24 rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
            <InfoHint
              title="Leave balances"
              text="Days remaining = total_days − used_days (per leave type row). Rows appear after balances are recorded (e.g. when leave is approved)."
            />
          </div>
          {teamBalances.length === 0 ? (
            <p className="text-surface-500 text-sm app-glass-card p-6">No balance rows for this year.</p>
          ) : (
            <div className="app-glass-card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-surface-50 border-b border-surface-200 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-surface-700">Employee</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Leave type</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Total days</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Used</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Remaining</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Typical (type)</th>
                    <th className="px-4 py-2 font-medium text-surface-700">Sector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {teamBalances.map((b, idx) => (
                    <tr key={`${b.user_id}-${b.leave_type}-${idx}`}>
                      <td className="px-4 py-2">{b.full_name || b.email || b.user_id}</td>
                      <td className="px-4 py-2">{b.leave_type}</td>
                      <td className="px-4 py-2">{b.total_days ?? 0}</td>
                      <td className="px-4 py-2">{b.used_days ?? 0}</td>
                      <td className="px-4 py-2">{(b.total_days ?? 0) - (b.used_days ?? 0)}</td>
                      <td className="px-4 py-2">{b.type_default_days_per_year != null ? b.type_default_days_per_year : '—'}</td>
                      <td className="px-4 py-2">{sectorLabel(b.type_sector)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OperatorManagement() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('operator-management');
  const [activeSection, setActiveSection] = useState('operator_schedules');
  const [error, setError] = useState('');

  const [opSchedules, setOpSchedules] = useState([]);
  const [opUsers, setOpUsers] = useState([]);
  const [opDeliveries, setOpDeliveries] = useState([]);
  const [opTeamProductivity, setOpTeamProductivity] = useState([]);
  const [opWageConfigs, setOpWageConfigs] = useState([]);
  const [opPayRecords, setOpPayRecords] = useState([]);

  const [opSchedForm, setOpSchedForm] = useState({ user_id: '', work_date: '', start_time: '07:00', end_time: '17:00', break_minutes: 30, schedule_type: 'regular', notes: '' });
  const [opSchedFilterUser, setOpSchedFilterUser] = useState('');
  const [opSchedFilterFrom, setOpSchedFilterFrom] = useState('');
  const [opSchedFilterTo, setOpSchedFilterTo] = useState('');
  const [opSchedBulkDates, setOpSchedBulkDates] = useState('');

  const [opDeliveryForm, setOpDeliveryForm] = useState({ user_id: '', delivery_date: '', delivery_time: '', origin: '', destination: '', weight_kg: '', truck_reg: '', trip_reference: '', status: 'completed', on_time: true, expected_delivery_time: '', notes: '' });
  const [opDeliveryFilterUser, setOpDeliveryFilterUser] = useState('');
  const [opDeliveryFilterFrom, setOpDeliveryFilterFrom] = useState('');
  const [opDeliveryFilterTo, setOpDeliveryFilterTo] = useState('');

  const [opWageConfigForm, setOpWageConfigForm] = useState({ user_id: '', pay_type: 'hourly', base_rate: '', overtime_rate: '', weekend_rate: '', holiday_rate: '', currency: 'ZAR', effective_from: '', effective_to: '' });
  const [opPayRecordForm, setOpPayRecordForm] = useState({ user_id: '', period_start: '', period_end: '', regular_hours: '', overtime_hours: '', base_amount: '', overtime_amount: '', deductions: '', bonuses: '', notes: '' });
  const [opPayFilterUser, setOpPayFilterUser] = useState('');
  const [opPayFilterStatus, setOpPayFilterStatus] = useState('');

  const [pendingLeave, setPendingLeave] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [leaveTeamBalances, setLeaveTeamBalances] = useState([]);
  const [leaveBalanceYear, setLeaveBalanceYear] = useState(() => wallMonthYearInAppZone().year);

  const fmtZAR = (v) => {
    const n = Number(v);
    if (isNaN(n)) return '—';
    return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const reloadOpSchedules = () => {
    const params = {};
    if (opSchedFilterUser) params.user_id = opSchedFilterUser;
    if (opSchedFilterFrom) params.from = opSchedFilterFrom;
    if (opSchedFilterTo) params.to = opSchedFilterTo;
    opMgmt.schedules.listAll(params).then((d) => setOpSchedules(d.schedules || [])).catch(() => setOpSchedules([]));
  };

  const reloadOpDeliveries = () => {
    const params = {};
    if (opDeliveryFilterUser) params.user_id = opDeliveryFilterUser;
    if (opDeliveryFilterFrom) params.from = opDeliveryFilterFrom;
    if (opDeliveryFilterTo) params.to = opDeliveryFilterTo;
    opMgmt.deliveries.listAll(params).then((d) => setOpDeliveries(d.deliveries || [])).catch(() => setOpDeliveries([]));
  };

  const reloadOpPayRecords = () => {
    const params = {};
    if (opPayFilterUser) params.user_id = opPayFilterUser;
    if (opPayFilterStatus) params.status = opPayFilterStatus;
    opMgmt.wages.payRecordsAll(params).then((d) => setOpPayRecords(d.payRecords || [])).catch(() => setOpPayRecords([]));
  };

  const reloadOpWageConfigs = () => {
    opMgmt.wages.configAll().then((d) => setOpWageConfigs(d.configs || [])).catch(() => setOpWageConfigs([]));
  };

  useEffect(() => {
    if (['operator_schedules', 'operator_productivity', 'operator_wages', 'operator_leave'].includes(activeSection)) {
      opMgmt.users().then((d) => setOpUsers(d.users || [])).catch(() => setOpUsers([]));
    }
    if (activeSection === 'operator_schedules') {
      const params = {};
      if (opSchedFilterUser) params.user_id = opSchedFilterUser;
      if (opSchedFilterFrom) params.from = opSchedFilterFrom;
      if (opSchedFilterTo) params.to = opSchedFilterTo;
      opMgmt.schedules.listAll(params).then((d) => setOpSchedules(d.schedules || [])).catch(() => setOpSchedules([]));
    }
    if (activeSection === 'operator_productivity') {
      opMgmt.productivity.team(30).then((d) => setOpTeamProductivity(d.team || [])).catch(() => setOpTeamProductivity([]));
      const params = {};
      if (opDeliveryFilterUser) params.user_id = opDeliveryFilterUser;
      if (opDeliveryFilterFrom) params.from = opDeliveryFilterFrom;
      if (opDeliveryFilterTo) params.to = opDeliveryFilterTo;
      opMgmt.deliveries.listAll(params).then((d) => setOpDeliveries(d.deliveries || [])).catch(() => setOpDeliveries([]));
    }
    if (activeSection === 'operator_wages') {
      opMgmt.wages.configAll().then((d) => setOpWageConfigs(d.configs || [])).catch(() => setOpWageConfigs([]));
      const params = {};
      if (opPayFilterUser) params.user_id = opPayFilterUser;
      if (opPayFilterStatus) params.status = opPayFilterStatus;
      opMgmt.wages.payRecordsAll(params).then((d) => setOpPayRecords(d.payRecords || [])).catch(() => setOpPayRecords([]));
    }
    if (activeSection === 'operator_leave') {
      pm.leave.pending().then((d) => setPendingLeave(d.applications || [])).catch(() => setPendingLeave([]));
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.applicationsAll().then((d) => setLeaveHistory(d.applications || [])).catch(() => setLeaveHistory([]));
      pm.leave
        .balancesTeam(leaveBalanceYear)
        .then((d) => setLeaveTeamBalances(d.balances || []))
        .catch(() => setLeaveTeamBalances([]));
    }
  }, [activeSection, opSchedFilterUser, opSchedFilterFrom, opSchedFilterTo, opDeliveryFilterUser, opDeliveryFilterFrom, opDeliveryFilterTo, opPayFilterUser, opPayFilterStatus, leaveBalanceYear]);

  useAutoHideNavAfterTabChange(activeSection);

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 app-glass-secondary-nav flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold text-surface-900">Operator management</h2>
              <InfoHint
                title="Operator management overview"
                text="Manage operator schedules, productivity, wages, and leave in one place."
              />
            </div>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {SECTIONS.map((sec) => (
            <li key={sec.id}>
              <button
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                  activeSection === sec.id
                    ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                    : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                }`}
              >
                {sec.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {/* ── Operator Work Schedules ── */}
          {activeSection === 'operator_schedules' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Operator work schedules</h1>
                <InfoHint title="Operator schedules" text="Create and manage work schedules for truck drivers and operators. You can add individual or bulk schedules, filter by operator, and track total scheduled hours." />
              </div>

              <div className="app-glass-card p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Operator
                    <select value={opSchedFilterUser} onChange={(e) => setOpSchedFilterUser(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900 min-w-[180px]">
                      <option value="">All operators</option>
                      {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    From
                    <input type="date" value={opSchedFilterFrom} onChange={(e) => setOpSchedFilterFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    To
                    <input type="date" value={opSchedFilterTo} onChange={(e) => setOpSchedFilterTo(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                  </label>
                  <button type="button" onClick={reloadOpSchedules} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Filter</button>
                </div>
              </div>

              <details className="app-glass-card">
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-surface-900 select-none">Add schedule</summary>
                <form className="p-4 border-t border-surface-100 space-y-4" onSubmit={(e) => {
                  e.preventDefault();
                  if (!opSchedForm.user_id || !opSchedForm.work_date) { setError('Operator and date are required'); return; }
                  opMgmt.schedules.create(opSchedForm)
                    .then(() => { reloadOpSchedules(); setOpSchedForm((f) => ({ ...f, work_date: '', notes: '' })); })
                    .catch((err) => setError(err?.message || 'Failed to create schedule'));
                }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Operator *
                      <select required value={opSchedForm.user_id} onChange={(e) => setOpSchedForm((f) => ({ ...f, user_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                        <option value="">Select operator</option>
                        {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Work date *
                      <input required type="date" value={opSchedForm.work_date} onChange={(e) => setOpSchedForm((f) => ({ ...f, work_date: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Start time
                      <input type="time" value={opSchedForm.start_time} onChange={(e) => setOpSchedForm((f) => ({ ...f, start_time: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      End time
                      <input type="time" value={opSchedForm.end_time} onChange={(e) => setOpSchedForm((f) => ({ ...f, end_time: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Break (min)
                      <input type="number" min="0" value={opSchedForm.break_minutes} onChange={(e) => setOpSchedForm((f) => ({ ...f, break_minutes: Number(e.target.value) }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Type
                      <select value={opSchedForm.schedule_type} onChange={(e) => setOpSchedForm((f) => ({ ...f, schedule_type: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                        <option value="regular">Regular</option>
                        <option value="overtime">Overtime</option>
                        <option value="public_holiday">Public holiday</option>
                        <option value="weekend">Weekend</option>
                        <option value="standby">Standby</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Notes
                    <input type="text" value={opSchedForm.notes} onChange={(e) => setOpSchedForm((f) => ({ ...f, notes: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Optional notes" />
                  </label>
                  <div className="flex gap-3">
                    <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Add schedule</button>
                  </div>
                </form>
              </details>

              <details className="app-glass-card">
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-surface-900 select-none">Bulk add schedules</summary>
                <form className="p-4 border-t border-surface-100 space-y-4" onSubmit={(e) => {
                  e.preventDefault();
                  if (!opSchedForm.user_id || !opSchedBulkDates.trim()) { setError('Operator and at least one date are required'); return; }
                  const dates = opSchedBulkDates.split(/[,\n]+/).map((d) => d.trim()).filter(Boolean);
                  const entries = dates.map((d) => ({ ...opSchedForm, work_date: d }));
                  opMgmt.schedules.bulkCreate(entries)
                    .then(() => { reloadOpSchedules(); setOpSchedBulkDates(''); })
                    .catch((err) => setError(err?.message || 'Bulk create failed'));
                }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Operator *
                      <select required value={opSchedForm.user_id} onChange={(e) => setOpSchedForm((f) => ({ ...f, user_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                        <option value="">Select operator</option>
                        {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Dates (comma or newline separated, YYYY-MM-DD) *
                      <textarea required rows={3} value={opSchedBulkDates} onChange={(e) => setOpSchedBulkDates(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="2026-06-01, 2026-06-02, 2026-06-03" />
                    </label>
                  </div>
                  <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Bulk add</button>
                </form>
              </details>

              {opSchedules.length === 0 ? (
                <p className="text-surface-500 text-sm">No schedules found.</p>
              ) : (
                <div className="app-glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[800px]">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Date</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Operator</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Start</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">End</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Hours</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Type</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Notes</th>
                          <th className="px-4 py-2 text-right font-medium text-surface-700"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {opSchedules.map((s) => {
                          const hrs = s.scheduled_hours != null ? Number(s.scheduled_hours).toFixed(1) : '—';
                          return (
                            <tr key={s.id}>
                              <td className="px-4 py-2 font-mono text-xs">{String(s.work_date).slice(0, 10)}</td>
                              <td className="px-4 py-2">{s.user_name || s.user_id}</td>
                              <td className="px-4 py-2 text-xs">{s.start_time || '—'}</td>
                              <td className="px-4 py-2 text-xs">{s.end_time || '—'}</td>
                              <td className="px-4 py-2">{hrs}</td>
                              <td className="px-4 py-2 capitalize">{(s.schedule_type || '').replace(/_/g, ' ')}</td>
                              <td className="px-4 py-2 text-surface-500 text-xs max-w-[200px] truncate">{s.notes || ''}</td>
                              <td className="px-4 py-2 text-right">
                                <button type="button" onClick={() => { if (confirm('Delete this schedule?')) opMgmt.schedules.remove(s.id).then(reloadOpSchedules).catch((err) => setError(err?.message || 'Delete failed')); }} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-surface-50 border-t border-surface-200">
                        <tr>
                          <td colSpan={4} className="px-4 py-2 text-right font-semibold text-surface-700 text-sm">Total hours</td>
                          <td className="px-4 py-2 font-semibold text-surface-900">{opSchedules.reduce((sum, s) => sum + (Number(s.scheduled_hours) || 0), 0).toFixed(1)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Operator Productivity ── */}
          {activeSection === 'operator_productivity' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Operator productivity</h1>
                <InfoHint title="Operator productivity" text="View delivery performance and productivity metrics per operator. Log deliveries and track on-time rates, hours worked, and overall efficiency." />
              </div>

              <div className="app-glass-card p-4">
                <h2 className="text-sm font-semibold text-surface-900 mb-3">Team overview (last 30 days)</h2>
                {opTeamProductivity.length === 0 ? (
                  <p className="text-surface-500 text-sm">No productivity data available.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Operator</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Total deliveries</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">On-time</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Delivery %</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Scheduled hrs</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Actual hrs</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {opTeamProductivity.map((op) => {
                          const pct = op.total_deliveries > 0 ? Math.round((op.on_time_deliveries / op.total_deliveries) * 100) : 0;
                          const badge = pct >= 80 ? 'bg-green-100 text-green-800' : pct >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                          return (
                            <tr key={op.user_id}>
                              <td className="px-4 py-2 font-medium">{op.full_name}</td>
                              <td className="px-4 py-2">{op.total_deliveries}</td>
                              <td className="px-4 py-2">{op.on_time_deliveries}</td>
                              <td className="px-4 py-2">{pct}%</td>
                              <td className="px-4 py-2">{Number(op.scheduled_hours || 0).toFixed(1)}</td>
                              <td className="px-4 py-2">{Number(op.actual_hours || 0).toFixed(1)}</td>
                              <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge}`}>{pct}%</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <details className="app-glass-card">
                <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-surface-900 select-none">Log delivery</summary>
                <form className="p-4 border-t border-surface-100 space-y-4" onSubmit={(e) => {
                  e.preventDefault();
                  if (!opDeliveryForm.user_id || !opDeliveryForm.delivery_date) { setError('Operator and delivery date are required'); return; }
                  opMgmt.deliveries.create(opDeliveryForm)
                    .then(() => {
                      reloadOpDeliveries();
                      opMgmt.productivity.team(30).then((d) => setOpTeamProductivity(d.team || []));
                      setOpDeliveryForm((f) => ({ ...f, delivery_date: '', delivery_time: '', origin: '', destination: '', weight_kg: '', truck_reg: '', trip_reference: '', notes: '' }));
                    })
                    .catch((err) => setError(err?.message || 'Failed to log delivery'));
                }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Operator *
                      <select required value={opDeliveryForm.user_id} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, user_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                        <option value="">Select operator</option>
                        {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Delivery date *
                      <input required type="date" value={opDeliveryForm.delivery_date} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, delivery_date: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Delivery time
                      <input type="time" value={opDeliveryForm.delivery_time} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, delivery_time: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Origin
                      <input type="text" value={opDeliveryForm.origin} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, origin: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Pickup location" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Destination
                      <input type="text" value={opDeliveryForm.destination} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, destination: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Drop-off location" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Weight (kg)
                      <input type="number" min="0" step="0.1" value={opDeliveryForm.weight_kg} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, weight_kg: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Truck registration
                      <input type="text" value={opDeliveryForm.truck_reg} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, truck_reg: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="e.g. GP 123-456" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Trip reference
                      <input type="text" value={opDeliveryForm.trip_reference} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, trip_reference: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Trip/waybill number" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Status
                      <select value={opDeliveryForm.status} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, status: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                        <option value="completed">Completed</option>
                        <option value="in_transit">In transit</option>
                        <option value="delayed">Delayed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Expected delivery time
                      <input type="time" value={opDeliveryForm.expected_delivery_time} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, expected_delivery_time: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-surface-600 self-end pb-2">
                      <input type="checkbox" checked={opDeliveryForm.on_time} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, on_time: e.target.checked }))} className="rounded border-surface-300" />
                      On time
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Notes
                    <input type="text" value={opDeliveryForm.notes} onChange={(e) => setOpDeliveryForm((f) => ({ ...f, notes: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Optional notes" />
                  </label>
                  <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Log delivery</button>
                </form>
              </details>

              <div className="app-glass-card p-4">
                <div className="flex flex-wrap items-end gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-surface-900 mr-auto">Deliveries</h2>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Operator
                    <select value={opDeliveryFilterUser} onChange={(e) => setOpDeliveryFilterUser(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900 min-w-[160px]">
                      <option value="">All</option>
                      {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    From
                    <input type="date" value={opDeliveryFilterFrom} onChange={(e) => setOpDeliveryFilterFrom(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    To
                    <input type="date" value={opDeliveryFilterTo} onChange={(e) => setOpDeliveryFilterTo(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                  </label>
                  <button type="button" onClick={reloadOpDeliveries} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Filter</button>
                </div>
                {opDeliveries.length === 0 ? (
                  <p className="text-surface-500 text-sm">No deliveries found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Date</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Operator</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Origin</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Destination</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Truck</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Ref</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Status</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">On time</th>
                          <th className="px-4 py-2 text-right font-medium text-surface-700"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {opDeliveries.map((d) => (
                          <tr key={d.id}>
                            <td className="px-4 py-2 font-mono text-xs">{String(d.delivery_date).slice(0, 10)}</td>
                            <td className="px-4 py-2">{d.user_name || d.user_id}</td>
                            <td className="px-4 py-2 text-xs">{d.origin || '—'}</td>
                            <td className="px-4 py-2 text-xs">{d.destination || '—'}</td>
                            <td className="px-4 py-2 text-xs">{d.truck_reg || '—'}</td>
                            <td className="px-4 py-2 text-xs">{d.trip_reference || '—'}</td>
                            <td className="px-4 py-2 capitalize text-xs">{(d.status || '').replace(/_/g, ' ')}</td>
                            <td className="px-4 py-2">{d.on_time ? <span className="text-green-600 font-medium text-xs">Yes</span> : <span className="text-red-600 font-medium text-xs">No</span>}</td>
                            <td className="px-4 py-2 text-right">
                              <button type="button" onClick={() => { if (confirm('Delete this delivery?')) opMgmt.deliveries.remove(d.id).then(() => { reloadOpDeliveries(); opMgmt.productivity.team(30).then((r) => setOpTeamProductivity(r.team || [])); }).catch((err) => setError(err?.message || 'Delete failed')); }} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Salary & Wages ── */}
          {activeSection === 'operator_wages' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Salary & wages</h1>
                <InfoHint title="Salary & wages" text="Configure pay rates per operator and manage pay records. Set base, overtime, weekend, and holiday rates. Create, approve, and track pay records through the full payment lifecycle." />
              </div>

              <div className="app-glass-card p-4 space-y-4">
                <h2 className="text-sm font-semibold text-surface-900">Wage configurations</h2>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700 select-none">Add wage config</summary>
                  <form className="mt-3 space-y-4" onSubmit={(e) => {
                    e.preventDefault();
                    if (!opWageConfigForm.user_id || !opWageConfigForm.base_rate) { setError('Operator and base rate are required'); return; }
                    opMgmt.wages.createConfig(opWageConfigForm)
                      .then(() => { reloadOpWageConfigs(); setOpWageConfigForm((f) => ({ ...f, base_rate: '', overtime_rate: '', weekend_rate: '', holiday_rate: '', effective_from: '', effective_to: '' })); })
                      .catch((err) => setError(err?.message || 'Failed to create wage config'));
                  }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Operator *
                        <select required value={opWageConfigForm.user_id} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, user_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                          <option value="">Select operator</option>
                          {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Pay type
                        <select value={opWageConfigForm.pay_type} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, pay_type: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                          <option value="hourly">Hourly</option>
                          <option value="daily">Daily</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Base rate (ZAR) *
                        <input required type="number" min="0" step="0.01" value={opWageConfigForm.base_rate} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, base_rate: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Overtime rate (ZAR)
                        <input type="number" min="0" step="0.01" value={opWageConfigForm.overtime_rate} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, overtime_rate: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Weekend rate (ZAR)
                        <input type="number" min="0" step="0.01" value={opWageConfigForm.weekend_rate} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, weekend_rate: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Holiday rate (ZAR)
                        <input type="number" min="0" step="0.01" value={opWageConfigForm.holiday_rate} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, holiday_rate: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Effective from
                        <input type="date" value={opWageConfigForm.effective_from} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, effective_from: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Effective to
                        <input type="date" value={opWageConfigForm.effective_to} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, effective_to: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Currency
                        <input type="text" value={opWageConfigForm.currency} onChange={(e) => setOpWageConfigForm((f) => ({ ...f, currency: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                    </div>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Save config</button>
                  </form>
                </details>
                {opWageConfigs.length === 0 ? (
                  <p className="text-surface-500 text-sm">No wage configurations.</p>
                ) : (
                  <div className="overflow-x-auto mt-3">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Operator</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Pay type</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Base rate</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">OT rate</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Weekend</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Holiday</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Effective</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {opWageConfigs.map((c) => (
                          <tr key={c.id}>
                            <td className="px-4 py-2">{c.user_name || c.user_id}</td>
                            <td className="px-4 py-2 capitalize">{c.pay_type}</td>
                            <td className="px-4 py-2">{fmtZAR(c.base_rate)}</td>
                            <td className="px-4 py-2">{c.overtime_rate ? fmtZAR(c.overtime_rate) : '—'}</td>
                            <td className="px-4 py-2">{c.weekend_rate ? fmtZAR(c.weekend_rate) : '—'}</td>
                            <td className="px-4 py-2">{c.holiday_rate ? fmtZAR(c.holiday_rate) : '—'}</td>
                            <td className="px-4 py-2 text-xs">{c.effective_from ? String(c.effective_from).slice(0, 10) : '—'} – {c.effective_to ? String(c.effective_to).slice(0, 10) : 'ongoing'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="app-glass-card p-4 space-y-4">
                <h2 className="text-sm font-semibold text-surface-900">Pay records</h2>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700 select-none">Create pay record</summary>
                  <form className="mt-3 space-y-4" onSubmit={(e) => {
                    e.preventDefault();
                    if (!opPayRecordForm.user_id || !opPayRecordForm.period_start || !opPayRecordForm.period_end) { setError('Operator and period dates are required'); return; }
                    opMgmt.wages.createPayRecord(opPayRecordForm)
                      .then(() => { reloadOpPayRecords(); setOpPayRecordForm((f) => ({ ...f, regular_hours: '', overtime_hours: '', base_amount: '', overtime_amount: '', deductions: '', bonuses: '', notes: '' })); })
                      .catch((err) => setError(err?.message || 'Failed to create pay record'));
                  }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Operator *
                        <select required value={opPayRecordForm.user_id} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, user_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900">
                          <option value="">Select operator</option>
                          {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Period start *
                        <input required type="date" value={opPayRecordForm.period_start} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, period_start: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Period end *
                        <input required type="date" value={opPayRecordForm.period_end} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, period_end: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Regular hours
                        <input type="number" min="0" step="0.5" value={opPayRecordForm.regular_hours} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, regular_hours: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Overtime hours
                        <input type="number" min="0" step="0.5" value={opPayRecordForm.overtime_hours} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, overtime_hours: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Base amount (ZAR)
                        <input type="number" min="0" step="0.01" value={opPayRecordForm.base_amount} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, base_amount: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Overtime amount (ZAR)
                        <input type="number" min="0" step="0.01" value={opPayRecordForm.overtime_amount} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, overtime_amount: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Deductions (ZAR)
                        <input type="number" min="0" step="0.01" value={opPayRecordForm.deductions} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, deductions: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                        Bonuses (ZAR)
                        <input type="number" min="0" step="0.01" value={opPayRecordForm.bonuses} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, bonuses: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                      Notes
                      <input type="text" value={opPayRecordForm.notes} onChange={(e) => setOpPayRecordForm((f) => ({ ...f, notes: e.target.value }))} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900" placeholder="Optional notes" />
                    </label>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Create pay record</button>
                  </form>
                </details>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Operator
                    <select value={opPayFilterUser} onChange={(e) => setOpPayFilterUser(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900 min-w-[160px]">
                      <option value="">All</option>
                      {opUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-surface-600">
                    Status
                    <select value={opPayFilterStatus} onChange={(e) => setOpPayFilterStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm text-surface-900 min-w-[120px]">
                      <option value="">All</option>
                      <option value="draft">Draft</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="paid">Paid</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <button type="button" onClick={reloadOpPayRecords} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Filter</button>
                </div>

                {opPayRecords.length === 0 ? (
                  <p className="text-surface-500 text-sm">No pay records found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Operator</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Period</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Reg hrs</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">OT hrs</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Base</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">OT amt</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Deductions</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Bonuses</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Net</th>
                          <th className="px-4 py-2 text-left font-medium text-surface-700">Status</th>
                          <th className="px-4 py-2 text-right font-medium text-surface-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {opPayRecords.map((pr) => {
                          const net = (Number(pr.base_amount) || 0) + (Number(pr.overtime_amount) || 0) + (Number(pr.bonuses) || 0) - (Number(pr.deductions) || 0);
                          const statusColors = { draft: 'bg-surface-100 text-surface-600', pending: 'bg-yellow-100 text-yellow-800', approved: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800' };
                          const badge = statusColors[pr.status] || 'bg-surface-100 text-surface-600';
                          return (
                            <tr key={pr.id}>
                              <td className="px-4 py-2">{pr.user_name || pr.user_id}</td>
                              <td className="px-4 py-2 text-xs">{String(pr.period_start).slice(0, 10)} – {String(pr.period_end).slice(0, 10)}</td>
                              <td className="px-4 py-2">{pr.regular_hours ?? '—'}</td>
                              <td className="px-4 py-2">{pr.overtime_hours ?? '—'}</td>
                              <td className="px-4 py-2">{fmtZAR(pr.base_amount)}</td>
                              <td className="px-4 py-2">{pr.overtime_amount ? fmtZAR(pr.overtime_amount) : '—'}</td>
                              <td className="px-4 py-2">{pr.deductions ? fmtZAR(pr.deductions) : '—'}</td>
                              <td className="px-4 py-2">{pr.bonuses ? fmtZAR(pr.bonuses) : '—'}</td>
                              <td className="px-4 py-2 font-semibold">{fmtZAR(net)}</td>
                              <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${badge}`}>{pr.status}</span></td>
                              <td className="px-4 py-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {(pr.status === 'draft' || pr.status === 'pending') && (
                                    <button type="button" onClick={() => opMgmt.wages.updatePayRecord(pr.id, { status: 'approved' }).then(reloadOpPayRecords).catch((err) => setError(err?.message || 'Update failed'))} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Approve</button>
                                  )}
                                  {pr.status === 'approved' && (
                                    <button type="button" onClick={() => opMgmt.wages.updatePayRecord(pr.id, { status: 'paid' }).then(reloadOpPayRecords).catch((err) => setError(err?.message || 'Update failed'))} className="text-xs text-green-600 hover:text-green-800 font-medium">Mark paid</button>
                                  )}
                                  {pr.status !== 'cancelled' && pr.status !== 'paid' && (
                                    <button type="button" onClick={() => { if (confirm('Cancel this pay record?')) opMgmt.wages.updatePayRecord(pr.id, { status: 'cancelled' }).then(reloadOpPayRecords).catch((err) => setError(err?.message || 'Update failed')); }} className="text-xs text-red-600 hover:text-red-800 font-medium">Cancel</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Operator Leave ── */}
          {activeSection === 'operator_leave' && (
            <LeaveSection
              pending={pendingLeave}
              leaveTypes={leaveTypes}
              history={leaveHistory}
              teamBalances={leaveTeamBalances}
              balanceYear={leaveBalanceYear}
              onBalanceYearChange={setLeaveBalanceYear}
              onRefresh={() => {
                pm.leave.pending().then((d) => setPendingLeave(d.applications || []));
                pm.leave.types().then((d) => setLeaveTypes(d.types || []));
                pm.leave.applicationsAll().then((d) => setLeaveHistory(d.applications || []));
                pm.leave.balancesTeam(leaveBalanceYear).then((d) => setLeaveTeamBalances(d.balances || []));
              }}
              onError={setError}
            />
          )}

          {activeSection === 'employee_details' && <EmployeeDetailsManagementSection onError={setError} />}
        </div>
      </div>
    </div>
  );
}
