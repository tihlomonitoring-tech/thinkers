import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { operatorManagement as opMgmt, profileManagement as pm, claims as claimsApi } from './api';
import { wallMonthYearInAppZone } from './lib/appTime.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import InfoHint from './components/InfoHint.jsx';
import EmployeeDetailsManagementSection from './components/EmployeeDetailsManagementSection.jsx';
import ClaimsManagementSection from './components/management/ClaimsManagementSection.jsx';
import LeaveSection from './components/management/LeaveSection.jsx';
import WorkSchedulesSection from './components/WorkSchedulesSection.jsx';

const SECTIONS = [
  { id: 'operator_schedules', label: 'Operator work schedules' },
  { id: 'operator_productivity', label: 'Operator productivity' },
  { id: 'operator_wages', label: 'Salary & wages' },
  { id: 'operator_leave', label: 'Operator leave' },
  { id: 'operator_claims', label: 'Operator claims' },
  { id: 'employee_details', label: 'Employee details' },
];

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

  const [allClaims, setAllClaims] = useState([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsSummary, setClaimsSummary] = useState({});

  const fmtZAR = (v) => {
    const n = Number(v);
    if (isNaN(n)) return '—';
    return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const reloadOpSchedules = () => {
    pm.schedules.list().then((d) => setOpSchedules(d.schedules || [])).catch(() => setOpSchedules([]));
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

  const loadClaims = () => {
    setClaimsLoading(true);
    Promise.all([claimsApi.all({ scope: 'operator' }), claimsApi.summary({ scope: 'operator' })])
      .then(([d, s]) => { setAllClaims(d.claims || []); setClaimsSummary(s.summary || {}); })
      .catch(() => { setAllClaims([]); setClaimsSummary({}); })
      .finally(() => setClaimsLoading(false));
  };

  useEffect(() => {
    if (['operator_schedules', 'operator_productivity', 'operator_wages', 'operator_leave'].includes(activeSection)) {
      opMgmt.users().then((d) => setOpUsers(d.users || [])).catch(() => setOpUsers([]));
    }
    if (activeSection === 'operator_schedules') {
      pm.schedules.list().then((d) => setOpSchedules(d.schedules || [])).catch(() => setOpSchedules([]));
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
      pm.leave.pending({ scope: 'operator' }).then((d) => setPendingLeave(d.applications || [])).catch(() => setPendingLeave([]));
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.applicationsAll({ scope: 'operator' }).then((d) => setLeaveHistory(d.applications || [])).catch(() => setLeaveHistory([]));
      pm.leave
        .balancesTeam(leaveBalanceYear, 'operator')
        .then((d) => setLeaveTeamBalances(d.balances || []))
        .catch(() => setLeaveTeamBalances([]));
    }
    if (activeSection === 'operator_claims') {
      loadClaims();
    }
  }, [activeSection, opDeliveryFilterUser, opDeliveryFilterFrom, opDeliveryFilterTo, opPayFilterUser, opPayFilterStatus, leaveBalanceYear]);

  // Pattern-based work schedules are tenant-wide; restrict to operator-profile users only.
  const operatorUserIds = useMemo(() => new Set((opUsers || []).map((u) => String(u.id))), [opUsers]);
  const operatorSchedules = useMemo(
    () => (opSchedules || []).filter((s) => operatorUserIds.has(String(s.user_id))),
    [opSchedules, operatorUserIds]
  );

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
            <WorkSchedulesSection
              schedules={operatorSchedules}
              tenantUsers={opUsers}
              onRefresh={reloadOpSchedules}
              onError={setError}
            />
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
              title="Operator leave"
              pending={pendingLeave}
              leaveTypes={leaveTypes}
              history={leaveHistory}
              teamBalances={leaveTeamBalances}
              balanceYear={leaveBalanceYear}
              onBalanceYearChange={setLeaveBalanceYear}
              onRefresh={() => {
                pm.leave.pending({ scope: 'operator' }).then((d) => setPendingLeave(d.applications || []));
                pm.leave.types().then((d) => setLeaveTypes(d.types || []));
                pm.leave.applicationsAll({ scope: 'operator' }).then((d) => setLeaveHistory(d.applications || []));
                pm.leave.balancesTeam(leaveBalanceYear, 'operator').then((d) => setLeaveTeamBalances(d.balances || []));
              }}
              onError={setError}
            />
          )}

          {activeSection === 'operator_claims' && (
            <ClaimsManagementSection
              claims={allClaims}
              loading={claimsLoading}
              summary={claimsSummary}
              onRefresh={loadClaims}
              user={user}
              title="Operator claims & reimbursements"
            />
          )}

          {activeSection === 'employee_details' && <EmployeeDetailsManagementSection onError={setError} />}
        </div>
      </div>
    </div>
  );
}
