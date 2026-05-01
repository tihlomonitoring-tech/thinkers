import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { profileManagement as pm, shiftClock, companyLibrary as lib, tenants as tenantsApi } from './api';
import TeamLeaderAuditSection from './components/TeamLeaderAuditSection.jsx';
import { calendarMonthStartYmd, wallMonthYearInAppZone } from './lib/appTime.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import InfoHint from './components/InfoHint.jsx';
import EmployeeProductivityScoreSection from './components/EmployeeProductivityScoreSection.jsx';
import TeamGoalsManagementSection from './components/TeamGoalsManagementSection.jsx';
import PerformanceEvaluationTrendsSection from './components/PerformanceEvaluationTrendsSection.jsx';
import PerformanceEvaluationQuestionsEditor from './components/PerformanceEvaluationQuestionsEditor.jsx';
import PerformanceEvaluationPeriodSection from './components/PerformanceEvaluationPeriodSection.jsx';
import PerformanceEvaluationAuditorResultsSection from './components/PerformanceEvaluationAuditorResultsSection.jsx';
import EmployeeDetailsManagementSection from './components/EmployeeDetailsManagementSection.jsx';

const SECTIONS = [
  { id: 'schedules', label: 'Work schedules' },
  { id: 'team_goals', label: 'Team goals & shift objectives' },
  { id: 'team_leader_audit', label: 'Team leader audit' },
  { id: 'employee_productivity_score', label: 'Employee productivity score' },
  { id: 'shift_activity', label: 'Shift activity' },
  { id: 'shift-swaps', label: 'Shift swap requests' },
  { id: 'schedule-events', label: 'Schedule events' },
  { id: 'leave', label: 'Leave applications' },
  { id: 'documents', label: 'Documents library' },
  { id: 'employee-details', label: 'Employee details' },
  { id: 'warnings-rewards', label: 'Warnings & rewards' },
  { id: 'queries', label: 'Queries (grievances)' },
  { id: 'evaluations', label: 'Evaluations' },
  { id: 'perf_eval_period', label: 'Evaluation period' },
  { id: 'perf_eval_trends', label: 'Evaluation trends' },
  { id: 'perf_eval_questions', label: 'Edit evaluation questionnaires' },
  { id: 'auditor_results', label: 'Auditor results' },
  { id: 'pip', label: 'Performance improvement' },
  { id: 'growth', label: 'Employee growth' },
  { id: 'company_library_policy', label: 'Company library (hours)' },
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function shiftLabel(st) {
  return st === 'night' ? 'Night' : 'Day';
}

function ShiftSwapsManagementSection({ requests, onRefresh, onError }) {
  const [sub, setSub] = useState('pending');
  const [notesById, setNotesById] = useState({});
  const [busyId, setBusyId] = useState(null);

  const pending = (requests || []).filter((r) => r.status === 'pending_management');
  const history = (requests || []).filter((r) => r.status !== 'pending_management');
  const show = sub === 'pending' ? pending : history;

  const act = async (id, approve) => {
    setBusyId(id);
    onError('');
    try {
      await pm.shiftSwaps.managementReview(id, {
        approve,
        notes: notesById[id]?.trim() || undefined,
      });
      onRefresh();
    } catch (e) {
      onError(e?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Shift swap requests</h1>
          <InfoHint
            title="Shift swap requests help"
            text="Employees propose swaps on their profile; the colleague must accept first. Requests listed here are ready for your decision. Approving updates both work schedules immediately by exchanging the two shifts (dates and day/night)."
          />
        </div>
      </div>
      <div className="flex gap-2 border-b border-surface-200">
        <button
          type="button"
          onClick={() => setSub('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            sub === 'pending' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600 hover:text-surface-900'
          }`}
        >
          Awaiting approval ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setSub('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            sub === 'history' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600 hover:text-surface-900'
          }`}
        >
          History ({history.length})
        </button>
      </div>
      {show.length === 0 ? (
        <p className="text-sm text-surface-500 bg-white rounded-xl border border-surface-200 p-6">
          {sub === 'pending' ? 'No swaps waiting for management right now.' : 'No completed or declined swaps yet.'}
        </p>
      ) : (
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Requester → colleague</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Exchange</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700 w-[280px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {show.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      <span className="font-medium text-surface-900">{r.requester_name}</span>
                      <span className="text-surface-500"> ↔ </span>
                      <span className="font-medium text-surface-900">{r.counterparty_name}</span>
                      {r.message && <p className="text-xs text-surface-600 mt-1 italic">&ldquo;{r.message}&rdquo;</p>}
                    </td>
                    <td className="px-4 py-3 text-surface-800">
                      <p>
                        <span className="text-surface-500">Gives:</span> {formatDate(r.requester_work_date)} · {shiftLabel(r.requester_shift_type)}
                      </p>
                      <p className="mt-0.5">
                        <span className="text-surface-500">Receives:</span> {formatDate(r.counterparty_work_date)} · {shiftLabel(r.counterparty_shift_type)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === 'pending_management'
                            ? 'bg-violet-100 text-violet-900'
                            : r.status === 'management_approved'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-surface-100 text-surface-700'
                        }`}
                      >
                        {r.status === 'pending_management' && 'Pending'}
                        {r.status === 'management_approved' && 'Approved'}
                        {r.status === 'management_declined' && 'Declined'}
                        {r.status === 'peer_declined' && 'Peer declined'}
                        {r.status === 'cancelled' && 'Cancelled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.status === 'pending_management' ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={notesById[r.id] || ''}
                            onChange={(e) => setNotesById((m) => ({ ...m, [r.id]: e.target.value }))}
                            placeholder="Note (optional)"
                            className="w-full px-2 py-1.5 rounded border border-surface-200 text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, true)}
                              className="flex-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Approve &amp; apply
                            </button>
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, false)}
                              className="flex-1 px-3 py-1.5 rounded-lg border border-surface-300 text-surface-800 text-xs hover:bg-surface-50 disabled:opacity-50"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-surface-500">
                          {formatDate(r.management_reviewed_at || r.peer_reviewed_at || r.created_at)}
                          {r.management_review_notes && <span className="block mt-1 text-surface-600">{r.management_review_notes}</span>}
                          {r.peer_review_notes && r.status === 'peer_declined' && (
                            <span className="block mt-1 text-surface-600">Peer: {r.peer_review_notes}</span>
                          )}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Management() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('management');
  const [activeSection, setActiveSection] = useState('schedules');
  const [schedules, setSchedules] = useState([]);
  const [pendingLeave, setPendingLeave] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [leaveTeamBalances, setLeaveTeamBalances] = useState([]);
  const [leaveBalanceYear, setLeaveBalanceYear] = useState(() => wallMonthYearInAppZone().year);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [warningsHistory, setWarningsHistory] = useState([]);
  const [rewardsHistory, setRewardsHistory] = useState([]);
  const [libraryDocs, setLibraryDocs] = useState([]);
  const [queries, setQueries] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [controllerEvaluations, setControllerEvaluations] = useState([]);
  const [controllerMigrationRequired, setControllerMigrationRequired] = useState(false);
  const [pipPlans, setPipPlans] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [shiftSwapRequests, setShiftSwapRequests] = useState([]);
  const [shiftMgmtSessions, setShiftMgmtSessions] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    pm.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => setTenantUsers([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeSection === 'schedules') pm.schedules.list().then((d) => setSchedules(d.schedules || [])).catch(() => setSchedules([]));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'leave') {
      pm.leave.pending().then((d) => setPendingLeave(d.applications || [])).catch(() => setPendingLeave([]));
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.applicationsAll().then((d) => setLeaveHistory(d.applications || [])).catch(() => setLeaveHistory([]));
      pm.leave
        .balancesTeam(leaveBalanceYear)
        .then((d) => setLeaveTeamBalances(d.balances || []))
        .catch(() => setLeaveTeamBalances([]));
    }
    if (activeSection === 'schedule-events') {
      const now = new Date();
      pm.scheduleEvents.list(now.getMonth(), now.getFullYear()).then((d) => setScheduleEvents(d.events || [])).catch(() => setScheduleEvents([]));
    }
    if (activeSection === 'warnings-rewards') {
      pm.warnings.listAll().then((d) => setWarningsHistory(d.warnings || [])).catch(() => setWarningsHistory([]));
      pm.rewards.listAll().then((d) => setRewardsHistory(d.rewards || [])).catch(() => setRewardsHistory([]));
    }
  }, [activeSection, leaveBalanceYear]);

  useEffect(() => {
    if (activeSection === 'documents') pm.documents.library().then((d) => setLibraryDocs(d.documents || [])).catch(() => setLibraryDocs([]));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'queries') pm.queries.listAll().then((d) => setQueries(d.queries || [])).catch(() => setQueries([]));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'evaluations') {
      pm.evaluations.listAll().then((d) => setEvaluations(d.evaluations || [])).catch(() => setEvaluations([]));
      pm.evaluations.controllerList()
        .then((d) => { setControllerEvaluations(d.evaluations || []); setControllerMigrationRequired(!!d.migrationRequired); })
        .catch(() => { setControllerEvaluations([]); setControllerMigrationRequired(false); });
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'pip') pm.pip.listAll().then((d) => setPipPlans(d.plans || [])).catch(() => setPipPlans([]));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'shift-swaps') {
      pm.shiftSwaps.managementQueue(null).then((d) => setShiftSwapRequests(d.requests || [])).catch(() => setShiftSwapRequests([]));
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'shift_activity') {
      shiftClock
        .managementSessions({})
        .then((d) => setShiftMgmtSessions(d.sessions || []))
        .catch(() => setShiftMgmtSessions([]));
    }
  }, [activeSection]);

  useAutoHideNavAfterTabChange(activeSection);

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold text-surface-900">Management</h2>
              <InfoHint
                title="Management overview"
                text="HR and people management: schedules, leave, documents, evaluations, growth tools, and related admin."
              />
            </div>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {SECTIONS.filter((sec) => sec.id !== 'company_library_policy' || user?.role === 'super_admin').map((sec) => (
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

          {activeSection === 'schedules' && (
            <SchedulesSection
              schedules={schedules}
              tenantUsers={tenantUsers}
              onRefresh={() => pm.schedules.list().then((d) => setSchedules(d.schedules || []))}
              onError={setError}
            />
          )}

          {activeSection === 'team_goals' && (
            <TeamGoalsManagementSection tenantUsers={tenantUsers} onError={setError} />
          )}

          {activeSection === 'team_leader_audit' && <TeamLeaderAuditSection onError={setError} />}

          {activeSection === 'employee_productivity_score' && <EmployeeProductivityScoreSection />}

          {activeSection === 'shift_activity' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Shift activity</h1>
                <InfoHint
                  title="Shift activity"
                  text="Monitor clock-ins, breaks, and overtime across the company. Alerts email staff and management when a break or shift exceeds policy (12 h on duty, break window)."
                />
              </div>
              <div className="bg-white rounded-xl border border-surface-200 overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex justify-between items-center">
                  <span className="text-sm font-semibold text-surface-900">Recent sessions</span>
                  <button
                    type="button"
                    onClick={() =>
                      shiftClock.managementSessions({}).then((d) => setShiftMgmtSessions(d.sessions || []))
                    }
                    className="text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    Refresh
                  </button>
                </div>
                <div className="overflow-x-auto p-4">
                  {shiftMgmtSessions.length === 0 ? (
                    <p className="text-sm text-surface-500">No sessions recorded yet.</p>
                  ) : (
                    <table className="w-full text-sm text-left min-w-[800px]">
                      <thead>
                        <tr className="text-xs uppercase text-surface-500 border-b border-surface-200">
                          <th className="pb-2 pr-3">Employee</th>
                          <th className="pb-2 pr-3">Date</th>
                          <th className="pb-2 pr-3">In</th>
                          <th className="pb-2 pr-3">Clock-in GPS</th>
                          <th className="pb-2 pr-3">Out</th>
                          <th className="pb-2 pr-3">OT (min)</th>
                          <th className="pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {shiftMgmtSessions.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3">
                              <span className="font-medium text-surface-900">{s.user_name || '—'}</span>
                              <span className="block text-xs text-surface-500">{s.user_email}</span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs">{String(s.work_date).slice(0, 10)}</td>
                            <td className="py-2 pr-3 text-xs">{s.clock_in_at ? new Date(s.clock_in_at).toLocaleString() : '—'}</td>
                            <td className="py-2 pr-3 text-xs font-mono text-surface-600">
                              {s.anchor_latitude != null && s.anchor_longitude != null
                                ? `${Number(s.anchor_latitude).toFixed(4)}, ${Number(s.anchor_longitude).toFixed(4)}`
                                : '—'}
                            </td>
                            <td className="py-2 pr-3 text-xs">{s.clock_out_at ? new Date(s.clock_out_at).toLocaleString() : '—'}</td>
                            <td className="py-2 pr-3">{s.overtime_minutes ?? 0}</td>
                            <td className="py-2 capitalize">{s.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'shift-swaps' && (
            <ShiftSwapsManagementSection
              requests={shiftSwapRequests}
              onRefresh={() => pm.shiftSwaps.managementQueue(null).then((d) => setShiftSwapRequests(d.requests || [])).catch(() => setShiftSwapRequests([]))}
              onError={setError}
            />
          )}

          {activeSection === 'schedule-events' && (
            <ScheduleEventsSection
              events={scheduleEvents}
              onRefresh={() => {
                const now = new Date();
                pm.scheduleEvents.list(now.getMonth(), now.getFullYear()).then((d) => setScheduleEvents(d.events || []));
              }}
              onError={setError}
            />
          )}
          {activeSection === 'leave' && (
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

          {activeSection === 'documents' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Documents library</h1>
                <InfoHint title="Documents library" text="View documents uploaded across all employee profiles in your organisation." />
              </div>
              {libraryDocs.length === 0 ? (
                <p className="text-surface-500 text-sm">No documents in library.</p>
              ) : (
                <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 border-b border-surface-200">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-surface-700">Employee</th>
                        <th className="px-4 py-2 text-left font-medium text-surface-700">File</th>
                        <th className="px-4 py-2 text-left font-medium text-surface-700">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {libraryDocs.map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2">{d.user_name || d.user_id}</td>
                          <td className="px-4 py-2">{d.file_name}</td>
                          <td className="px-4 py-2">{formatDate(d.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeSection === 'employee-details' && <EmployeeDetailsManagementSection onError={setError} />}

          {activeSection === 'warnings-rewards' && (
            <WarningsRewardsSection
              tenantUsers={tenantUsers}
              warnings={warningsHistory}
              rewards={rewardsHistory}
              onRefresh={() => {
                pm.warnings.listAll().then((d) => setWarningsHistory(d.warnings || []));
                pm.rewards.listAll().then((d) => setRewardsHistory(d.rewards || []));
              }}
              onError={setError}
            />
          )}

          {activeSection === 'evaluations' && (
            <EvaluationsSection
              evaluations={evaluations}
              controllerEvaluations={controllerEvaluations}
              controllerMigrationRequired={controllerMigrationRequired}
              onRefresh={() => {
                pm.evaluations.listAll().then((d) => setEvaluations(d.evaluations || []));
                pm.evaluations.controllerList()
                  .then((d) => { setControllerEvaluations(d.evaluations || []); setControllerMigrationRequired(!!d.migrationRequired); });
              }}
              onError={setError}
            />
          )}

          {activeSection === 'perf_eval_period' && <PerformanceEvaluationPeriodSection onError={setError} />}

          {activeSection === 'perf_eval_trends' && <PerformanceEvaluationTrendsSection onError={setError} />}

          {activeSection === 'perf_eval_questions' && <PerformanceEvaluationQuestionsEditor onError={setError} />}

          {activeSection === 'auditor_results' && <PerformanceEvaluationAuditorResultsSection onError={setError} />}

          {activeSection === 'pip' && (
            <PIPSection
              plans={pipPlans}
              tenantUsers={tenantUsers}
              onRefresh={() => pm.pip.listAll().then((d) => setPipPlans(d.plans || []))}
              onError={setError}
            />
          )}

          {activeSection === 'queries' && (
            <QueriesSection
              queries={queries}
              onRefresh={() => pm.queries.listAll().then((d) => setQueries(d.queries || []))}
              onError={setError}
            />
          )}

          {activeSection === 'growth' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Employee growth</h1>
                <InfoHint
                  title="Employee growth"
                  text="Structure career growth — goals, development paths, and inspiration. Use Configure growth structure to define career levels, development plans, and resources for employees."
                />
              </div>
              <div className="bg-white rounded-xl border border-surface-200 p-6">
                <p className="text-sm text-surface-700 mb-2">Configure growth structure</p>
                <button type="button" className="mt-3 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                  Edit growth structure
                </button>
              </div>
            </div>
          )}

          {activeSection === 'company_library_policy' && user?.role === 'super_admin' && (
            <CompanyLibraryPolicySection user={user} onError={setError} />
          )}
        </div>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

function minutesToHHmm(m) {
  const n = Math.max(0, Math.min(1439, Number(m) || 0));
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function hhmmToMinutes(s) {
  const [h, m] = String(s || '0:0').split(':').map((x) => parseInt(x, 10));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, Math.min(1439, hh * 60 + mm));
}

function CompanyLibraryPolicySection({ user, onError }) {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(() => user?.tenant_id || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [timezone, setTimezone] = useState('Africa/Johannesburg');
  const [weekdays, setWeekdays] = useState(() => new Set([1, 2, 3, 4, 5]));
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');

  useEffect(() => {
    if (user?.tenant_id) setTenantId((t) => t || user.tenant_id);
  }, [user?.tenant_id]);

  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    tenantsApi
      .list()
      .then((d) => setTenants(d.tenants || []))
      .catch(() => setTenants([]));
  }, [user?.role]);

  const loadPolicy = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    onError('');
    try {
      const data = await lib.adminPolicyGet(tenantId);
      const p = data.policy;
      setRestricted(!!p?.access_restricted);
      setTimezone(p?.access_timezone || 'Africa/Johannesburg');
      if (p?.access_weekdays) {
        const set = new Set(
          p.access_weekdays
            .split(',')
            .map((x) => parseInt(String(x).trim(), 10))
            .filter((n) => n >= 1 && n <= 7)
        );
        setWeekdays(set.size ? set : new Set([1, 2, 3, 4, 5]));
      } else {
        setWeekdays(new Set([1, 2, 3, 4, 5]));
      }
      const sm = p?.access_start_minutes != null ? Number(p.access_start_minutes) : 8 * 60;
      const em = p?.access_end_minutes != null ? Number(p.access_end_minutes) : 17 * 60;
      setStartTime(minutesToHHmm(sm));
      setEndTime(minutesToHHmm(em));
    } catch (e) {
      onError(e?.message || 'Failed to load library policy');
    } finally {
      setLoading(false);
    }
  }, [tenantId, onError]);

  useEffect(() => {
    if (tenantId) loadPolicy();
  }, [tenantId, loadPolicy]);

  const toggleWeekday = (iso) => {
    setWeekdays((prev) => {
      const n = new Set(prev);
      if (n.has(iso)) n.delete(iso);
      else n.add(iso);
      return n;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!tenantId) {
      onError('Select an organization');
      return;
    }
    if (restricted && weekdays.size === 0) {
      onError('Pick at least one weekday when access is restricted.');
      return;
    }
    const sm = hhmmToMinutes(startTime);
    const em = hhmmToMinutes(endTime);
    if (restricted && em <= sm) {
      onError('End time must be after start time (same calendar day).');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await lib.adminPolicyPut({
        tenant_id: tenantId,
        access_restricted: restricted,
        access_timezone: timezone.trim() || 'Africa/Johannesburg',
        access_weekdays: Array.from(weekdays)
          .sort((a, b) => a - b)
          .join(','),
        access_start_minutes: sm,
        access_end_minutes: em,
      });
      await loadPolicy();
    } catch (err) {
      onError(err?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Company library — access hours</h1>
        <InfoHint
          title="Company library access hours"
          text="When restrictions are on, users with the Company library page can only browse, search, upload, and email file copies during the days and times you set (in the timezone below). Super admins are not limited by this window."
        />
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-surface-200 p-6 space-y-5">
        {tenants.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-surface-800 mb-1">Organization</label>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
            >
              <option value="">Select organization…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {tenants.length === 0 && user?.tenant_id && (
          <p className="text-sm text-surface-600">Policy applies to your organization ({String(user.tenant_id).slice(0, 8)}…).</p>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={restricted}
            onChange={(e) => setRestricted(e.target.checked)}
            className="rounded border-surface-300"
          />
          <span className="text-sm font-medium text-surface-800">Restrict library use to specific days and times</span>
        </label>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-800 mb-1">IANA timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. Africa/Johannesburg"
              className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-surface-500 mt-1">Used to evaluate “current time” for the access window.</p>
          </div>

          <div>
            <span className="block text-sm font-medium text-surface-800 mb-2">Allowed weekdays</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map(({ iso, label }) => (
                <button
                  key={iso}
                  type="button"
                  onClick={() => toggleWeekday(iso)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    weekdays.has(iso)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-800 mb-1">Opens at</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-800 mb-1">Closes at</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || loading || !tenantId}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save policy'}
          </button>
          <button
            type="button"
            onClick={() => loadPolicy()}
            disabled={loading || !tenantId}
            className="px-4 py-2 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50 disabled:opacity-50"
          >
            Reload
          </button>
          {loading && <span className="text-sm text-surface-500">Loading…</span>}
        </div>
      </form>
    </div>
  );
}

function SchedulesSection({ schedules, tenantUsers, onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllUserId, setDeleteAllUserId] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [scheduleUserId, setScheduleUserId] = useState('');
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [entryDate, setEntryDate] = useState('');
  const [entryShift, setEntryShift] = useState('day');
  const [entryNotes, setEntryNotes] = useState('');
  const [addingEntry, setAddingEntry] = useState(false);
  const [filterUserId, setFilterUserId] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkUserId, setBulkUserId] = useState('');
  const [bulkStartDate, setBulkStartDate] = useState(() => {
    const w = wallMonthYearInAppZone();
    return calendarMonthStartYmd(w.year, w.monthIndex0);
  });
  const [bulkMonths, setBulkMonths] = useState(1);
  const [bulkPattern, setBulkPattern] = useState(['day', 'day', 'night', 'off']);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!scheduleUserId || !title || !periodStart || !periodEnd) {
      onError('Select employee and enter title and period dates');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.schedules.create({ user_id: scheduleUserId, title: title.trim(), period_start: periodStart, period_end: periodEnd });
      setShowForm(false);
      setScheduleUserId('');
      setTitle('');
      setPeriodStart('');
      setPeriodEnd('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllForUser = async (e) => {
    e.preventDefault();
    if (!deleteAllUserId) {
      onError('Select an employee');
      return;
    }
    const u = tenantUsers.find((x) => x.id === deleteAllUserId);
    const label = u?.full_name || u?.email || 'this employee';
    const n = schedules.filter((s) => s.user_id === deleteAllUserId).length;
    if (
      !window.confirm(
        `Delete ALL work schedules for ${label}? This removes ${n || 'all'} schedule record(s), every shift, related shift swap requests, and shift clock sessions tied to those shifts. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingAll(true);
    onError('');
    try {
      const res = await pm.schedules.deleteAllForUser(deleteAllUserId);
      const removed = res?.deleted?.schedules ?? 0;
      setShowDeleteAll(false);
      setDeleteAllUserId('');
      setSelectedSchedule(null);
      onRefresh();
      if (removed === 0) {
        onError('');
        alert('No schedules were on file for that employee.');
      } else {
        alert(`Removed ${removed} schedule(s) for ${label}.`);
      }
    } catch (err) {
      onError(err?.message || 'Failed to delete schedules');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!selectedSchedule || !entryDate) {
      onError('Select a schedule and enter date');
      return;
    }
    setAddingEntry(true);
    onError('');
    try {
      await pm.schedules.addEntries(selectedSchedule.id, [{ work_date: entryDate, shift_type: entryShift, notes: entryNotes.trim() || undefined }]);
      setEntryDate('');
      setEntryNotes('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to add entry');
    } finally {
      setAddingEntry(false);
    }
  };

  const handleBulkGenerate = async (e) => {
    e.preventDefault();
    if (!bulkUserId || !bulkStartDate || bulkPattern.length === 0) {
      onError('Select employee, start date, and add at least one pattern slot');
      return;
    }
    const hasWork = bulkPattern.some((p) => p === 'day' || p === 'night');
    if (!hasWork) {
      onError('Pattern must include at least one Day or Night');
      return;
    }
    setBulkGenerating(true);
    onError('');
    try {
      const res = await pm.schedules.generateBulk({
        user_id: bulkUserId,
        start_date: bulkStartDate,
        time_frame_months: bulkMonths,
        pattern: bulkPattern,
      });
      onRefresh();
      setShowBulk(false);
      setBulkUserId('');
      setBulkPattern(['day', 'day', 'night', 'off']);
      onError(''); // clear so success is visible
      alert(`Schedule created: ${res.schedule?.title}. ${res.entries_created ?? 0} shifts added.`);
    } catch (err) {
      onError(err?.message || 'Bulk generate failed');
    } finally {
      setBulkGenerating(false);
    }
  };

  const addPatternSlot = () => setBulkPattern((p) => [...p, 'day']);
  const removePatternSlot = (index) => setBulkPattern((p) => p.length > 1 ? p.filter((_, i) => i !== index) : p);
  const setPatternSlot = (index, value) => setBulkPattern((p) => p.map((v, i) => (i === index ? value : v)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Work schedules</h1>
        <InfoHint
          title="Work schedules help"
          text="Create and manage work schedules (6:00 – 6:00 shifts). Each employee has a private schedule. Create a schedule for an employee, then add their shifts. They only see their own schedule on Profile."
        />
      </div>

      {!showForm && !showDeleteAll ? (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => {
              setShowDeleteAll(false);
              setShowForm(true);
            }}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Create schedule for employee
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setShowDeleteAll(true);
            }}
            className="px-4 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-medium hover:bg-red-50"
          >
            Delete all schedules for an employee
          </button>
        </div>
      ) : showForm ? (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-surface-200 p-4 space-y-3 max-w-md">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
            <select value={scheduleUserId} onChange={(e) => setScheduleUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
              <option value="">Select employee</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. March 2025" required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Period start *</label>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Period end *</label>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleDeleteAllForUser} className="bg-white rounded-xl border border-red-100 p-4 space-y-3 max-w-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-surface-800">Delete all schedules for one employee</span>
            <InfoHint
              title="What gets deleted"
              text="Permanently removes every work schedule and shift for the selected employee. Shift swap requests and clock sessions linked to those shifts are removed too. This cannot be undone."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
            <select
              value={deleteAllUserId}
              onChange={(e) => setDeleteAllUserId(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select employee</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={deletingAll}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {deletingAll ? 'Deleting…' : 'Delete all schedules'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteAll(false);
                setDeleteAllUserId('');
              }}
              className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowBulk(!showBulk)}
          className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-medium text-surface-700 hover:bg-surface-50 transition-colors"
        >
          <span>Bulk schedule generator (robot)</span>
          <span className="text-surface-400">{showBulk ? '▼' : '▶'}</span>
        </button>
        {showBulk && (
          <form onSubmit={handleBulkGenerate} className="p-4 border-t border-surface-100 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-surface-700">Pattern guide</span>
              <InfoHint
                title="Bulk pattern help"
                text="Define a repeating pattern (e.g. day, day, night, off). The pattern repeats from the start date for the chosen time frame. Only Day and Night create shifts; Off is a rest day."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
                <select value={bulkUserId} onChange={(e) => setBulkUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                  <option value="">Select employee</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Start date *</label>
                <input type="date" value={bulkStartDate} onChange={(e) => setBulkStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Time frame *</label>
                <select value={bulkMonths} onChange={(e) => setBulkMonths(Number(e.target.value))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                  <option value={1}>1 month</option>
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-surface-700">Pattern (repeats daily)</label>
                <button type="button" onClick={addPatternSlot} className="text-xs text-brand-600 hover:underline">+ Add slot</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {bulkPattern.map((slot, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <select value={slot} onChange={(e) => setPatternSlot(i, e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm min-w-[90px]">
                      <option value="day">Day</option>
                      <option value="night">Night</option>
                      <option value="off">Off</option>
                    </select>
                    <button type="button" onClick={() => removePatternSlot(i)} className="p-1.5 rounded text-surface-500 hover:bg-surface-100 hover:text-red-600" title="Remove slot">×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={bulkGenerating} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                {bulkGenerating ? 'Generating…' : 'Generate schedule'}
              </button>
              <button type="button" onClick={() => setShowBulk(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-surface-100 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-surface-700">Schedules (per employee)</span>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1 text-sm">
            <option value="">All employees</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
        {schedules.length === 0 ? (
          <p className="p-4 text-sm text-surface-500">No schedules yet.</p>
        ) : (
          <ul className="divide-y divide-surface-100">
            {(filterUserId ? schedules.filter((s) => s.user_id === filterUserId) : schedules).map((s) => (
              <li key={s.id} className="px-4 py-3 flex justify-between items-center">
                <span><strong>{s.user_name || s.user_email || s.user_id}</strong> — {s.title} ({formatDate(s.period_start)} to {formatDate(s.period_end)})</span>
                <button
                  type="button"
                  onClick={() => setSelectedSchedule(selectedSchedule?.id === s.id ? null : s)}
                  className="text-sm text-brand-600 hover:underline"
                >
                  {selectedSchedule?.id === s.id ? 'Hide' : 'Add shifts'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedSchedule && (
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="font-medium text-surface-800 mb-2">Add shift to {selectedSchedule.user_name || selectedSchedule.user_email}&apos;s schedule: {selectedSchedule.title}</p>
          <form onSubmit={handleAddEntry} className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Date *</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Shift</label>
              <select value={entryShift} onChange={(e) => setEntryShift(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="day">Day (06:00 – 18:00)</option>
                <option value="night">Night (18:00 – 06:00)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Notes (optional)</label>
              <input type="text" value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Notes" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={addingEntry} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {addingEntry ? 'Adding…' : 'Add shift'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ScheduleEventsSection({ events, onRefresh, onError }) {
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!title || !eventDate) {
      onError('Title and date required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.scheduleEvents.create({ title: title.trim(), event_date: eventDate, description: description.trim() || undefined });
      setTitle('');
      setEventDate('');
      setDescription('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Schedule events</h1>
        <InfoHint
          title="Schedule events"
          text="Company events that appear on employee work schedules (e.g. training, meetings)."
        />
      </div>
      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-surface-200 p-4 max-w-md space-y-3">
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Title *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Event date *</label>
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create event'}
        </button>
      </form>
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <p className="px-4 py-2 text-sm font-medium text-surface-700 border-b border-surface-100">Events (this month)</p>
        {events.length === 0 ? (
          <p className="p-4 text-sm text-surface-500">No events.</p>
        ) : (
          <ul className="divide-y divide-surface-100">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-3 text-sm">
                <span className="font-medium">{e.title}</span>
                <span className="text-surface-500 ml-2">{formatDate(e.event_date)}</span>
                {e.description && <p className="text-surface-600 mt-0.5">{e.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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
        <h1 className="text-xl font-semibold text-surface-900">Leave</h1>
        <InfoHint
          title="Leave management"
          text="Configure leave types (including a South African starter set), approve requests, browse full history, and view recorded leave balances per employee for a calendar year."
        />
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4">
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
            <p className="text-surface-500 text-sm bg-white rounded-xl border border-surface-200 p-6">No pending applications.</p>
          ) : (
            <ul className="space-y-4">
              {pending.map((a) => (
                <li key={a.id} className="bg-white rounded-xl border border-surface-200 p-4">
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
            <p className="text-surface-500 text-sm bg-white rounded-xl border border-surface-200 p-6">No records match.</p>
          ) : (
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden overflow-x-auto">
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
            <p className="text-surface-500 text-sm bg-white rounded-xl border border-surface-200 p-6">No balance rows for this year.</p>
          ) : (
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden overflow-x-auto">
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

function WarningsRewardsSection({ tenantUsers, warnings = [], rewards = [], onRefresh, onError }) {
  const [warningUser, setWarningUser] = useState('');
  const [warningType, setWarningType] = useState('');
  const [warningDesc, setWarningDesc] = useState('');
  const [rewardUser, setRewardUser] = useState('');
  const [rewardType, setRewardType] = useState('');
  const [rewardDesc, setRewardDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const submitWarning = async (e) => {
    e.preventDefault();
    if (!warningUser || !warningType) {
      onError('Select employee and enter warning type');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.warnings.create({ user_id: warningUser, warning_type: warningType.trim(), description: warningDesc.trim() || undefined });
      setWarningUser('');
      setWarningType('');
      setWarningDesc('');
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const submitReward = async (e) => {
    e.preventDefault();
    if (!rewardUser || !rewardType) {
      onError('Select employee and enter reward type');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.rewards.create({ user_id: rewardUser, reward_type: rewardType.trim(), description: rewardDesc.trim() || undefined });
      setRewardUser('');
      setRewardType('');
      setRewardDesc('');
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Warnings & rewards</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Issue warning</p>
          <form onSubmit={submitWarning} className="space-y-2">
            <select value={warningUser} onChange={(e) => setWarningUser(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
              <option value="">Select employee</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
            <input type="text" value={warningType} onChange={(e) => setWarningType(e.target.value)} placeholder="Warning type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            <textarea value={warningDesc} onChange={(e) => setWarningDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50">
              Submit warning
            </button>
          </form>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Issue reward</p>
          <form onSubmit={submitReward} className="space-y-2">
            <select value={rewardUser} onChange={(e) => setRewardUser(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
              <option value="">Select employee</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
            <input type="text" value={rewardType} onChange={(e) => setRewardType(e.target.value)} placeholder="Reward type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            <textarea value={rewardDesc} onChange={(e) => setRewardDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-sm font-medium hover:bg-emerald-200 disabled:opacity-50">
              Submit reward
            </button>
          </form>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <p className="px-4 py-2 text-sm font-medium text-surface-700 border-b border-surface-100">Warnings & cases (history)</p>
          {warnings.length === 0 ? (
            <p className="p-4 text-sm text-surface-500">No warnings on record.</p>
          ) : (
            <ul className="divide-y divide-surface-100 max-h-80 overflow-y-auto">
              {warnings.map((w) => (
                <li key={w.id} className="px-4 py-3 text-sm">
                  <span className="font-medium">{w.user_name || w.user_email || w.user_id}</span>
                  <span className="text-amber-700 ml-1">— {w.warning_type}</span>
                  <span className="text-surface-400 text-xs ml-1">{formatDate(w.created_at)}</span>
                  {w.description && <p className="text-surface-600 mt-0.5">{w.description}</p>}
                  {w.issued_by_name && <p className="text-xs text-surface-400">Issued by {w.issued_by_name}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <p className="px-4 py-2 text-sm font-medium text-surface-700 border-b border-surface-100">Rewards (history)</p>
          {rewards.length === 0 ? (
            <p className="p-4 text-sm text-surface-500">No rewards on record.</p>
          ) : (
            <ul className="divide-y divide-surface-100 max-h-80 overflow-y-auto">
              {rewards.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <span className="font-medium">{r.user_name || r.user_email || r.user_id}</span>
                  <span className="text-emerald-700 ml-1">— {r.reward_type}</span>
                  <span className="text-surface-400 text-xs ml-1">{formatDate(r.created_at)}</span>
                  {r.description && <p className="text-surface-600 mt-0.5">{r.description}</p>}
                  {r.issued_by_name && <p className="text-xs text-surface-400">Issued by {r.issued_by_name}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function QueriesSection({ queries, onRefresh, onError }) {
  const [respondId, setRespondId] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRespond = async () => {
    if (!respondId) return;
    setSaving(true);
    onError('');
    try {
      await pm.queries.respond(respondId, { response_text: responseText });
      setRespondId(null);
      setResponseText('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Employee growth — Queries</h1>
        <InfoHint title="Queries" text="Respond to employee grievances and complaints submitted by employees." />
      </div>
      {queries.length === 0 ? (
        <p className="text-surface-500 text-sm">No queries.</p>
      ) : (
        <ul className="space-y-4">
          {queries.map((q) => (
            <li key={q.id} className="bg-white rounded-xl border border-surface-200 p-4">
              <p className="font-medium">{q.subject}</p>
              <p className="text-sm text-surface-600">{q.user_name} — {formatDate(q.created_at)}</p>
              {q.body && <p className="text-sm text-surface-500 mt-1">{q.body}</p>}
              <p className="text-xs mt-1"><span className={q.status === 'closed' ? 'text-emerald-600' : 'text-amber-600'}>{q.status}</span></p>
              {respondId !== q.id && q.status !== 'closed' && (
                <button type="button" onClick={() => { setRespondId(q.id); setResponseText(''); }} className="mt-2 text-sm text-brand-600 hover:underline">
                  Respond
                </button>
              )}
              {respondId === q.id && (
                <div className="mt-3 space-y-2">
                  <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} placeholder="Your response" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button type="button" onClick={handleRespond} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                      {saving ? 'Sending…' : 'Send & close'}
                    </button>
                    <button type="button" onClick={() => setRespondId(null)} className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CONTROLLER_EVAL_QUESTION_LABELS = {
  q1: 'Was the shift concluded by 6:00 AM / 6:00 PM as required?',
  q2: 'Was the shift report submitted for approval before 18:30?',
  q3: 'Was the shift report completed correctly and accurately?',
  q4: 'Are all report sections properly completed and accounted for?',
  q5: 'Did the controller go the extra mile to resolve and manage situations or issues?',
  q6: 'Was the controller able to answer all questions related to his/her shift?',
  q7: 'Did the controllers work effectively as a team?',
  q8: 'Did the controller apply critical thinking in resolving issues?',
  q9: 'Did the controller follow up on matters and outstanding issues?',
  q10: "Was the controller's shift report presentation detailed, insightful, and helpful?",
  q11: 'Was the office space left clean in accordance with company policy?',
};

function EvaluationsSection({ evaluations, controllerEvaluations, controllerMigrationRequired, tenantUsers, onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [userId, setUserId] = useState('');
  const [period, setPeriod] = useState('');
  const [rating, setRating] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedControllerEvalId, setSelectedControllerEvalId] = useState(null);
  const [controllerEvalDetail, setControllerEvalDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!selectedControllerEvalId) { setControllerEvalDetail(null); return; }
    setLoadingDetail(true);
    pm.evaluations.controllerGet(selectedControllerEvalId)
      .then((d) => { setControllerEvalDetail(d.evaluation); onError(''); })
      .catch((err) => { onError(err?.message || 'Failed to load evaluation'); setControllerEvalDetail(null); })
      .finally(() => setLoadingDetail(false));
  }, [selectedControllerEvalId, onError]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!userId || !period) {
      onError('Select employee and enter period');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.evaluations.create({ user_id: userId, period: period.trim(), rating: rating.trim() || undefined, notes: notes.trim() || undefined });
      setShowForm(false);
      setUserId('');
      setPeriod('');
      setRating('');
      setNotes('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Evaluations</h1>
        <InfoHint
          title="Evaluations"
          text="Create and view general employee evaluations. Shift report (controller) evaluations appear in the section below when approvers complete them in Command Centre."
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-surface-800 mb-3">General evaluations</h2>
        {!showForm ? (
          <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
            New evaluation
          </button>
        ) : (
          <form onSubmit={handleCreate} className="bg-white rounded-xl border border-surface-200 p-4 space-y-3 max-w-md">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                <option value="">Select</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Period *</label>
              <input type="text" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. 2025-Q1" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Rating (optional)</label>
              <input type="text" value={rating} onChange={(e) => setRating(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
            </div>
          </form>
        )}
        {evaluations.length > 0 && (
          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden mt-4">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Employee</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Period</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Rating</th>
                  <th className="px-4 py-2 text-left font-medium text-surface-700">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {evaluations.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2">{e.user_name}</td>
                    <td className="px-4 py-2">{e.period}</td>
                    <td className="px-4 py-2">{e.rating || '—'}</td>
                    <td className="px-4 py-2">{formatDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-surface-800">Shift report (controller) evaluations</h2>
          <InfoHint
            title="Controller evaluations"
            text="Full controller evaluations from Command Centre → Requests. Click a row to view the detailed evaluation."
          />
        </div>
        {controllerMigrationRequired && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 mb-4 text-amber-900">
            <p className="font-medium">Database migration required</p>
            <p className="text-sm mt-1">Controller evaluations are not available until the migration is run. From the project root, run:</p>
            <code className="block mt-2 p-2 bg-amber-100 rounded text-sm">node scripts/run-command-centre-controller-evaluations.js</code>
          </div>
        )}
        {controllerEvaluations.length === 0 && !controllerMigrationRequired && (
          <div className="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center text-surface-500">
            <p className="font-medium text-surface-600">No controller evaluations yet</p>
            <div className="flex justify-center mt-2">
              <InfoHint
                title="When evaluations appear"
                text="They appear here after approvers complete the evaluation form on a shift report in Command Centre → Requests."
              />
            </div>
          </div>
        )}
        {controllerEvaluations.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-50 border-b border-surface-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-surface-700">Route</th>
                    <th className="px-4 py-2 text-left font-medium text-surface-700">Date</th>
                    <th className="px-4 py-2 text-left font-medium text-surface-700">Evaluator</th>
                    <th className="px-4 py-2 text-left font-medium text-surface-700">Evaluated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {controllerEvaluations.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedControllerEvalId(selectedControllerEvalId === e.id ? null : e.id)}
                      className={`cursor-pointer hover:bg-surface-50 ${selectedControllerEvalId === e.id ? 'bg-brand-50' : ''}`}
                    >
                      <td className="px-4 py-2 font-medium">{e.route || '—'}</td>
                      <td className="px-4 py-2">{e.report_date ? formatDate(e.report_date) : '—'}</td>
                      <td className="px-4 py-2">{e.evaluator_name || '—'}</td>
                      <td className="px-4 py-2">{[e.controller1_name, e.controller2_name].filter(Boolean).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              {selectedControllerEvalId && (
                <div className="bg-white rounded-xl border-2 border-brand-200 overflow-hidden">
                  {loadingDetail ? (
                    <div className="p-8 text-center text-surface-500">Loading…</div>
                  ) : controllerEvalDetail ? (
                    <div className="p-6 space-y-6">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="font-semibold text-surface-900">Evaluation details</h3>
                        <button type="button" onClick={() => setSelectedControllerEvalId(null)} className="text-sm text-surface-500 hover:text-surface-700">Close</button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 text-sm">
                        <div><span className="text-surface-500">Route</span><p className="font-medium">{controllerEvalDetail.route || '—'}</p></div>
                        <div><span className="text-surface-500">Report date</span><p className="font-medium">{controllerEvalDetail.report_date ? formatDate(controllerEvalDetail.report_date) : '—'}</p></div>
                        <div><span className="text-surface-500">Controllers</span><p className="font-medium">{[controllerEvalDetail.controller1_name, controllerEvalDetail.controller2_name].filter(Boolean).join(', ') || '—'}</p></div>
                        <div><span className="text-surface-500">Evaluator</span><p className="font-medium">{controllerEvalDetail.evaluator_name || '—'}</p></div>
                        <div><span className="text-surface-500">Evaluated at</span><p className="font-medium">{controllerEvalDetail.created_at ? formatDate(controllerEvalDetail.created_at) : '—'}</p></div>
                      </div>
                      <div className="border-t border-surface-200 pt-4">
                        <h4 className="font-semibold text-surface-800 mb-3">Question-by-question</h4>
                        <div className="space-y-4">
                          {Object.entries(controllerEvalDetail.answers || {}).map(([key, a]) => (
                            <div key={key} className="rounded-lg border border-surface-200 p-3 bg-surface-50/50">
                              <p className="text-sm font-medium text-surface-800 mb-1">{CONTROLLER_EVAL_QUESTION_LABELS[key] || key}</p>
                              <p className="text-sm text-surface-600"><span className={`font-semibold ${a.value === 'yes' ? 'text-green-700' : 'text-red-700'}`}>{a.value === 'yes' ? 'Yes' : 'No'}</span> — {a.comment || '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="border-t border-surface-200 pt-4">
                        <h4 className="font-semibold text-surface-800 mb-2">Overall comment</h4>
                        <p className="text-sm text-surface-700 whitespace-pre-wrap">{controllerEvalDetail.overall_comment || '—'}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PIPSection({ plans, tenantUsers, onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!userId || !title) {
      onError('Select employee and enter title');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.pip.create({ user_id: userId, title: title.trim(), goals: goals.trim() || undefined, start_date: startDate || undefined, end_date: endDate || undefined });
      setShowForm(false);
      setUserId('');
      setTitle('');
      setGoals('');
      setStartDate('');
      setEndDate('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Performance improvement plan</h1>
        <InfoHint title="PIP" text="Draft and manage performance improvement plans (PIPs) for employees, including goals and date ranges." />
      </div>
      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Draft PIP
        </button>
      ) : (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-surface-200 p-4 space-y-3 max-w-md">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
              <option value="">Select</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Goals (optional)</label>
            <textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
          </div>
        </form>
      )}
      {plans.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-surface-700">Employee</th>
                <th className="px-4 py-2 text-left font-medium text-surface-700">Title</th>
                <th className="px-4 py-2 text-left font-medium text-surface-700">Status</th>
                <th className="px-4 py-2 text-left font-medium text-surface-700">Period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {plans.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">{p.user_name}</td>
                  <td className="px-4 py-2">{p.title}</td>
                  <td className="px-4 py-2">{p.status}</td>
                  <td className="px-4 py-2">{formatDate(p.start_date)} – {formatDate(p.end_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
