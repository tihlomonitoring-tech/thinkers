import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { profileManagement as pm, downloadAttachmentWithAuth, tasks as tasksApi, claims as claimsApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import {
  isAutoHideNavDisabled,
  setAutoHideNavDisabled,
  AUTO_HIDE_NAV_PREF_CHANGED,
} from './lib/autoHideNav.js';
import InfoHint from './components/InfoHint.jsx';
import DisciplinaryRewardsProfile from './components/DisciplinaryRewardsProfile.jsx';
import OvertimeClaimFields, { OvertimeClaimDetail } from './components/OvertimeClaimFields.jsx';
import { calculateSaOvertimeClaim } from './lib/saOvertimeClaim.js';
import ShiftClockPanel from './components/ShiftClockPanel.jsx';
import ShiftActivityTab from './components/ShiftActivityTab.jsx';
import ProductivityScoreTab from './components/ProductivityScoreTab.jsx';
import DepartmentStrategyView from './components/DepartmentStrategyView.jsx';
import CareerDevelopmentHub from './components/CareerDevelopmentHub.jsx';
import ColleagueEvaluationResultsTab from './components/ColleagueEvaluationResultsTab.jsx';
import EmployeeDetailsTab from './components/EmployeeDetailsTab.jsx';
import EmployeeOnboardmentTab from './components/EmployeeOnboardmentTab.jsx';
import OrgStructureView from './components/OrgStructureView.jsx';
import CompanyPoliciesProfileTab from './components/CompanyPoliciesProfileTab.jsx';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import {
  addCalendarDays,
  calendarMonthStartYmd,
  calendarMonthEndYmd,
  daysInCalendarMonth,
  isWeekendYmd,
  startPadForCalendarMonth,
  todayYmd,
  toYmdFromDbOrString,
  wallMonthYearInAppZone,
} from './lib/appTime.js';
import { taskLegendDotClass, taskLegendSurfaceClass, taskLegendLabel } from './lib/taskProgressLegend.js';
import TaskColourLegend from './components/TaskColourLegend.jsx';

const TABS = [
  { id: 'schedule', label: 'Work schedule' },
  { id: 'productivity_score', label: 'Productivity score' },
  { id: 'department_strategy', label: 'Department strategy' },
  { id: 'career_development', label: 'Career & personal goals' },
  { id: 'shift_activity', label: 'Shift activity' },
  { id: 'leave', label: 'Leave application' },
  { id: 'employee_details', label: 'Employee details' },
  { id: 'employee_onboardment', label: 'Employee onboardment' },
  { id: 'documents', label: 'Employee documents' },
  { id: 'company_policies', label: 'Company policies' },
  { id: 'disciplinary', label: 'Disciplinary & rewards' },
  { id: 'queries', label: 'Queries' },
  { id: 'growth', label: 'Growth' },
  { id: 'evaluation_results', label: 'Colleagues evaluation results' },
  { id: 'claims', label: 'Claims & reimbursements' },
  { id: 'organisational_structure', label: 'Organisational structure' },
  { id: 'system_settings', label: 'System settings' },
];

const SHIFT_DAY = '06:00 – 18:00';
const SHIFT_NIGHT = '18:00 – 06:00';

const COLLEAGUE_FILTER_STORAGE_KEY = 'profile.workSchedule.colleagueFilter';
const COLLEAGUE_VIEW_MODE_KEY = 'profile.workSchedule.colleagueViewMode';
const CC_TEAM_PANEL_COLLAPSED_KEY = 'profile.workSchedule.ccTeamPanelCollapsed';
const DAY_DETAILS_RAIL_EXPANDED_KEY = 'profile.workSchedule.dayDetailsRailExpanded';

function shortFirstName(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  return p[0] || '—';
}

function getDaysInMonth(year, month) {
  return {
    startPad: startPadForCalendarMonth(year, month),
    days: daysInCalendarMonth(year, month),
    year,
    month,
  };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

/** Expand leave spans into per-day map for a calendar month (approved + pending). */
function leaveSpansToDaysMap(spans, monthStartYmd, monthEndYmd) {
  const m = {};
  for (const s of spans || []) {
    const a = toYmdFromDbOrString(s.start_date);
    const b = toYmdFromDbOrString(s.end_date);
    if (!a || !b || b < monthStartYmd || a > monthEndYmd) continue;
    let cur = a > monthStartYmd ? a : monthStartYmd;
    const end = b < monthEndYmd ? b : monthEndYmd;
    while (cur <= end) {
      if (!m[cur]) m[cur] = [];
      const list = m[cur];
      if (!list.some((x) => x.leave_type === s.leave_type && x.status === s.status)) {
        list.push({ leave_type: s.leave_type, status: s.status });
      }
      cur = addCalendarDays(cur, 1);
    }
  }
  return m;
}

function isoDate(d) {
  if (!d) return '';
  return toYmdFromDbOrString(d);
}

const CLAIM_TYPES = [
  { id: 'fuel', label: 'Fuel' },
  { id: 'travel', label: 'Travel expense' },
  { id: 'accommodation', label: 'Accommodation' },
  { id: 'meals', label: 'Meals' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'tools', label: 'Tools' },
  { id: 'training', label: 'Training' },
  { id: 'communication', label: 'Communication' },
  { id: 'service', label: 'Service rendered' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'other', label: 'Other' },
];

const CLAIM_STATUS_STYLES = {
  draft: 'bg-surface-100 text-surface-700',
  pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  declined: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  paid: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  cancelled: 'bg-surface-200 text-surface-500',
};

function ClaimsTab({ claims, loading, onRefresh, user }) {
  const [view, setView] = useState('list');
  const [saving, setSaving] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [detailClaim, setDetailClaim] = useState(null);
  const [detailAttachments, setDetailAttachments] = useState([]);

  const emptyForm = {
    claim_date: new Date().toISOString().slice(0, 10), claim_type: 'fuel', category: '', department_name: '',
    description: '', amount: '', km_travelled: '', start_location: '', end_location: '',
    vehicle_registration: '', rate_per_km: '4.64', service_rendered: '', hours_spent: '', hourly_rate: '',
    ot_period_end: '', ot_weekday_hours: '', ot_sunday_hours: '', ot_public_holiday_hours: '', ot_monthly_salary: '',
    bank_name: '', account_holder: user?.full_name || '', account_number: '', branch_code: '', account_type: 'savings',
    declaration_accepted: false,
  };
  const [form, setForm] = useState({ ...emptyForm });

  const fmtZar = (v) => { const n = Number(v); return isNaN(n) ? 'R 0.00' : 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const fmtDate = (d) => d ? String(d).slice(0, 10) : '—';

  useEffect(() => {
    if (form.claim_type === 'travel' && form.km_travelled && form.rate_per_km) {
      const calc = (Number(form.km_travelled) * Number(form.rate_per_km)).toFixed(2);
      if (calc !== form.amount) setForm((f) => ({ ...f, amount: calc }));
    }
  }, [form.km_travelled, form.rate_per_km, form.claim_type]);

  useEffect(() => {
    if (form.claim_type === 'service' && form.hours_spent && form.hourly_rate) {
      const calc = (Number(form.hours_spent) * Number(form.hourly_rate)).toFixed(2);
      if (calc !== form.amount) setForm((f) => ({ ...f, amount: calc }));
    }
  }, [form.hours_spent, form.hourly_rate, form.claim_type]);

  useEffect(() => {
    if (form.claim_type !== 'overtime') return;
    const { total } = calculateSaOvertimeClaim({
      ordinaryHourlyRate: form.hourly_rate,
      weekdayHours: form.ot_weekday_hours,
      sundayHours: form.ot_sunday_hours,
      publicHolidayHours: form.ot_public_holiday_hours,
    });
    const next = total > 0 ? total.toFixed(2) : '';
    if (next !== form.amount) setForm((f) => ({ ...f, amount: next }));
  }, [
    form.claim_type,
    form.hourly_rate,
    form.ot_weekday_hours,
    form.ot_sunday_hours,
    form.ot_public_holiday_hours,
    form.amount,
  ]);

  const openDetail = (claim) => {
    setSelectedClaim(claim);
    setView('detail');
    claimsApi.get(claim.id).then((d) => { setDetailClaim(d.claim); setDetailAttachments(d.attachments || []); }).catch(() => {});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.declaration_accepted) { alert('Please accept the declaration before submitting.'); return; }
    setSaving(true);
    try {
      await claimsApi.create(form);
      setForm({ ...emptyForm });
      setView('list');
      onRefresh();
    } catch (err) { alert(err?.message || 'Failed to submit claim'); }
    finally { setSaving(false); }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this claim?')) return;
    try { await claimsApi.cancel(id); onRefresh(); if (view === 'detail') setView('list'); } catch {}
  };

  const canDeleteClaim = (c) => ['draft', 'pending', 'cancelled', 'declined'].includes(c?.status);

  const handleDelete = async (id) => {
    if (!window.confirm('Permanently delete this claim? You and management will receive a deletion email.')) return;
    try {
      await claimsApi.delete(id);
      onRefresh();
      if (view === 'detail') setView('list');
    } catch (err) {
      alert(err?.message || 'Could not delete claim');
    }
  };

  const handleUpload = async (claimId, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try { await claimsApi.uploadAttachments(claimId, fd); claimsApi.get(claimId).then((d) => setDetailAttachments(d.attachments || [])); } catch {}
  };

  const handleDeleteAttachment = async (attId) => {
    if (!window.confirm('Remove this attachment?')) return;
    try { await claimsApi.removeAttachment(attId); if (detailClaim) claimsApi.get(detailClaim.id).then((d) => setDetailAttachments(d.attachments || [])); } catch {}
  };

  const declarationText = 'I declare that the information provided in this claim is true and accurate to the best of my knowledge. I understand that submitting false claims may result in disciplinary action. All expenses were incurred for legitimate business purposes.';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Claims & reimbursements</h2>
        {view === 'list' && (
          <button type="button" onClick={() => setView('new')} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">New claim</button>
        )}
        {(view === 'new' || view === 'detail') && (
          <button type="button" onClick={() => { setView('list'); setSelectedClaim(null); }} className="text-sm text-brand-600 hover:underline flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to claims
          </button>
        )}
      </div>

      {/* ═══════════════ LIST ═══════════════ */}
      {view === 'list' && (
        loading ? (
          <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>
        ) : claims.length === 0 ? (
          <div className="text-center py-12 text-surface-500">
            <p className="text-lg font-medium">No claims yet</p>
            <p className="text-sm mt-1">Submit your first claim for reimbursement</p>
          </div>
        ) : (
          <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-surface-500 border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-2.5">Ref #</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr></thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-surface-50 hover:bg-surface-50 cursor-pointer" onClick={() => openDetail(c)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-brand-600 font-medium">{c.reference_number}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtDate(c.claim_date)}</td>
                    <td className="px-4 py-2.5">{CLAIM_TYPES.find((t) => t.id === c.claim_type)?.label || c.claim_type}</td>
                    <td className="px-4 py-2.5 max-w-[200px] truncate">{c.description}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtZar(c.amount)}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLAIM_STATUS_STYLES[c.status] || ''}`}>{c.status}</span></td>
                    <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex flex-wrap gap-2">
                        {(c.status === 'pending' || c.status === 'draft') && (
                          <button type="button" onClick={() => handleCancel(c.id)} className="text-amber-700 hover:underline text-xs">
                            Cancel
                          </button>
                        )}
                        {canDeleteClaim(c) && (
                          <button type="button" onClick={() => handleDelete(c.id)} className="text-red-600 hover:underline text-xs font-medium">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ═══════════════ NEW CLAIM FORM ═══════════════ */}
      {view === 'new' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-surface-900">Submit new claim</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Claim date *</label>
                <input type="date" required value={form.claim_date} onChange={(e) => setForm((f) => ({ ...f, claim_date: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Claim type *</label>
                <select required value={form.claim_type} onChange={(e) => setForm((f) => ({ ...f, claim_type: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm">
                  {CLAIM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Department</label>
                <input type="text" value={form.department_name} onChange={(e) => setForm((f) => ({ ...f, department_name: e.target.value }))} placeholder="e.g. Operations" className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Description *</label>
              <textarea required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Describe the expense or service..." className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            {/* Travel / KM fields */}
            {(form.claim_type === 'travel' || form.claim_type === 'fuel') && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-blue-800 uppercase tracking-wider">Travel details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Start location</label>
                    <input type="text" value={form.start_location} onChange={(e) => setForm((f) => ({ ...f, start_location: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">End location</label>
                    <input type="text" value={form.end_location} onChange={(e) => setForm((f) => ({ ...f, end_location: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Vehicle registration</label>
                    <input type="text" value={form.vehicle_registration} onChange={(e) => setForm((f) => ({ ...f, vehicle_registration: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  {form.claim_type === 'travel' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">KM travelled</label>
                        <input type="number" step="0.1" value={form.km_travelled} onChange={(e) => setForm((f) => ({ ...f, km_travelled: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">Rate per KM (R)</label>
                        <input type="number" step="0.01" value={form.rate_per_km} onChange={(e) => setForm((f) => ({ ...f, rate_per_km: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Service fields */}
            {form.claim_type === 'overtime' && (
              <OvertimeClaimFields form={form} setForm={setForm} />
            )}

            {form.claim_type === 'service' && (
              <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-purple-800 uppercase tracking-wider">Service details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Service rendered</label>
                    <input type="text" value={form.service_rendered} onChange={(e) => setForm((f) => ({ ...f, service_rendered: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Hours spent</label>
                    <input type="number" step="0.5" value={form.hours_spent} onChange={(e) => setForm((f) => ({ ...f, hours_spent: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Hourly rate (R)</label>
                    <input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>
            )}

            {/* Amount */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Total amount (ZAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  readOnly={form.claim_type === 'overtime'}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className={`w-full border border-surface-300 rounded-lg px-3 py-2 text-sm font-semibold text-lg ${form.claim_type === 'overtime' ? 'bg-orange-50/80' : ''}`}
                />
                {(form.claim_type === 'travel' && form.km_travelled && form.rate_per_km) && <p className="text-xs text-surface-500 mt-1">Auto-calculated: {form.km_travelled} km × R{form.rate_per_km}/km</p>}
                {(form.claim_type === 'service' && form.hours_spent && form.hourly_rate) && <p className="text-xs text-surface-500 mt-1">Auto-calculated: {form.hours_spent}h × R{form.hourly_rate}/h</p>}
                {form.claim_type === 'overtime' && form.amount && (
                  <p className="text-xs text-orange-800 mt-1">Auto-calculated from BCEA overtime rates (see breakdown above).</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Category</label>
                <input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Site visit, Client meeting" className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {/* Banking details */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Banking details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Account holder</label>
                  <input type="text" value={form.account_holder} onChange={(e) => setForm((f) => ({ ...f, account_holder: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Bank name</label>
                  <input type="text" value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} placeholder="e.g. FNB, Standard Bank" className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Account number</label>
                  <input type="text" value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Branch code</label>
                  <input type="text" value={form.branch_code} onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Account type</label>
                  <select value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm">
                    <option value="savings">Savings</option>
                    <option value="cheque">Cheque</option>
                    <option value="current">Current</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Declaration */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Declaration</h4>
              <p className="text-sm text-surface-700">{declarationText}</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={form.declaration_accepted} onChange={(e) => setForm((f) => ({ ...f, declaration_accepted: e.target.checked, declaration_text: e.target.checked ? declarationText : '' }))} className="mt-0.5 rounded border-surface-300" />
                <span className="text-sm font-medium text-surface-700">I accept the above declaration</span>
              </label>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={saving || !form.declaration_accepted} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Submitting...' : 'Submit claim'}
              </button>
              <button type="button" onClick={() => setView('list')} className="px-4 py-2 border border-surface-300 rounded-lg text-sm text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </div>
        </form>
      )}

      {/* ═══════════════ DETAIL ═══════════════ */}
      {view === 'detail' && detailClaim && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-lg font-semibold text-surface-900">{detailClaim.reference_number}</h3>
                <p className="text-sm text-surface-500">{fmtDate(detailClaim.claim_date)} — {CLAIM_TYPES.find((t) => t.id === detailClaim.claim_type)?.label || detailClaim.claim_type}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${CLAIM_STATUS_STYLES[detailClaim.status] || ''}`}>{detailClaim.status}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-surface-500">Amount</p><p className="font-semibold tabular-nums text-brand-700">{fmtZar(detailClaim.amount)}</p></div>
              <div><p className="text-xs text-surface-500">Department</p><p className="font-medium">{detailClaim.department_name || '—'}</p></div>
              <div><p className="text-xs text-surface-500">Category</p><p className="font-medium">{detailClaim.category || '—'}</p></div>
              {detailClaim.km_travelled && <div><p className="text-xs text-surface-500">KM Travelled</p><p className="font-medium">{detailClaim.km_travelled} km</p></div>}
              {detailClaim.start_location && <div><p className="text-xs text-surface-500">From</p><p className="font-medium">{detailClaim.start_location}</p></div>}
              {detailClaim.end_location && <div><p className="text-xs text-surface-500">To</p><p className="font-medium">{detailClaim.end_location}</p></div>}
              {detailClaim.service_rendered && <div><p className="text-xs text-surface-500">Service</p><p className="font-medium">{detailClaim.service_rendered}</p></div>}
              {detailClaim.hours_spent && <div><p className="text-xs text-surface-500">Hours</p><p className="font-medium">{detailClaim.hours_spent}h</p></div>}
              {detailClaim.bank_name && <div><p className="text-xs text-surface-500">Bank</p><p className="font-medium">{detailClaim.bank_name}</p></div>}
              {detailClaim.reviewed_by_name && <div><p className="text-xs text-surface-500">Reviewed by</p><p className="font-medium">{detailClaim.reviewed_by_name}</p></div>}
            </div>

            <OvertimeClaimDetail claim={detailClaim} fmtZar={fmtZar} />
            {detailClaim.description && <div><p className="text-xs text-surface-500 mb-1">Description</p><p className="text-sm whitespace-pre-wrap">{detailClaim.description}</p></div>}
            {detailClaim.review_notes && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg"><p className="text-xs text-blue-700 font-medium">Review notes:</p><p className="text-sm text-blue-600">{detailClaim.review_notes}</p></div>}
            {detailClaim.rejection_reason && <div className="p-3 bg-red-50 border border-red-200 rounded-lg"><p className="text-xs text-red-700 font-medium">Rejection reason:</p><p className="text-sm text-red-600">{detailClaim.rejection_reason}</p></div>}
          </div>

          {/* Attachments */}
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-sm font-semibold text-surface-900">Attachments</h4>
            {detailAttachments.length > 0 ? (
              <div className="space-y-2">{detailAttachments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-2 bg-surface-50 rounded-lg">
                  <svg className="w-5 h-5 text-surface-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  <span className="text-sm text-surface-700 flex-1 truncate">{a.file_name}</span>
                  {detailClaim.status === 'pending' && <button type="button" onClick={() => handleDeleteAttachment(a.id)} className="text-xs text-red-600 hover:underline">Remove</button>}
                </div>
              ))}</div>
            ) : <p className="text-sm text-surface-500">No attachments</p>}
            {detailClaim.status === 'pending' && (
              <label className="inline-flex items-center gap-2 px-3 py-2 border border-surface-300 rounded-lg text-sm text-surface-700 hover:bg-surface-50 cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Upload receipt/files
                <input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) handleUpload(detailClaim.id, e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {detailClaim.status === 'pending' && (
              <button type="button" onClick={() => handleCancel(detailClaim.id)} className="px-4 py-2 border border-amber-300 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-50">
                Cancel claim
              </button>
            )}
            {canDeleteClaim(detailClaim) && (
              <button type="button" onClick={() => handleDelete(detailClaim.id)} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50">
                Delete permanently
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('profile');
  const [autoHideNavDisabled, setAutoHideNavDisabledState] = useState(() => isAutoHideNavDisabled());
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() =>
    TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'schedule'
  );
  const [calendarMonth, setCalendarMonth] = useState(() => wallMonthYearInAppZone().monthIndex0);
  const [calendarYear, setCalendarYear] = useState(() => wallMonthYearInAppZone().year);
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [myLeaveSpans, setMyLeaveSpans] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState([]);
  const [leaveApplications, setLeaveApplications] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [graceCredits, setGraceCredits] = useState([]);
  const [debtorSanctions, setDebtorSanctions] = useState([]);
  const [creditApplications, setCreditApplications] = useState([]);
  const [graceSummary, setGraceSummary] = useState(null);
  const [creditCategories, setCreditCategories] = useState([]);
  const [queries, setQueries] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [pipPlans, setPipPlans] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(null);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [commandCentrePeerUsers, setCommandCentrePeerUsers] = useState([]);
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapModal, setSwapModal] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [myClaims, setMyClaims] = useState([]);
  const [claimLoading, setClaimLoading] = useState(false);
  const [colleagueFilterIds, setColleagueFilterIds] = useState(() => {
    try {
      const s = localStorage.getItem(COLLEAGUE_FILTER_STORAGE_KEY);
      if (s) {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
      }
    } catch {
      /* ignore */
    }
    return [];
  });
  const [colleagueSchedules, setColleagueSchedules] = useState([]);
  const [colleagueFilterSearch, setColleagueFilterSearch] = useState('');
  const [colleagueViewMode, setColleagueViewMode] = useState(() => {
    try {
      const s = localStorage.getItem(COLLEAGUE_VIEW_MODE_KEY);
      if (s === 'all_shifts' || s === 'same_shift') return s;
    } catch {
      /* ignore */
    }
    return 'same_shift';
  });
  const [ccTeamPanelCollapsed, setCcTeamPanelCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(CC_TEAM_PANEL_COLLAPSED_KEY);
      if (v === '0') return false;
      return true;
    } catch {
      return true;
    }
  });
  /** Large screens: when false, the empty “Day details” column is hidden so the calendar is full width; pick a date to open details. */
  const [dayDetailsRailExpanded, setDayDetailsRailExpanded] = useState(() => {
    try {
      const v = localStorage.getItem(DAY_DETAILS_RAIL_EXPANDED_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
      return false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CC_TEAM_PANEL_COLLAPSED_KEY, ccTeamPanelCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [ccTeamPanelCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(DAY_DETAILS_RAIL_EXPANDED_KEY, dayDetailsRailExpanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [dayDetailsRailExpanded]);

  const collapseDayDetailsRail = useCallback(() => {
    setSelectedScheduleDate(null);
    setDayDetailsRailExpanded(false);
  }, []);

  const showDayDetailsColumn = selectedScheduleDate != null || dayDetailsRailExpanded;

  useEffect(() => {
    const raw = searchParams.get('tab');
    const legacy = { department_goals: 'department_strategy', shift_objectives: 'department_strategy' };
    const t = legacy[raw] || raw;
    if (t && TABS.some((x) => x.id === t)) setActiveTab(t);
  }, [searchParams]);

  useEffect(() => {
    const sync = () => setAutoHideNavDisabledState(isAutoHideNavDisabled());
    window.addEventListener(AUTO_HIDE_NAV_PREF_CHANGED, sync);
    return () => window.removeEventListener(AUTO_HIDE_NAV_PREF_CHANGED, sync);
  }, []);

  useAutoHideNavAfterTabChange(activeTab);

  const calendar = useMemo(() => getDaysInMonth(calendarYear, calendarMonth), [calendarYear, calendarMonth]);
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const scheduleByDate = useMemo(() => {
    const map = {};
    scheduleEntries.forEach((e) => {
      const d = e.work_date ? toYmdFromDbOrString(e.work_date) : null;
      if (d) map[d] = e;
    });
    return map;
  }, [scheduleEntries]);

  const myLeaveByDate = useMemo(() => {
    const monthStart = calendarMonthStartYmd(calendarYear, calendarMonth);
    const monthEnd = calendarMonthEndYmd(calendarYear, calendarMonth);
    return leaveSpansToDaysMap(myLeaveSpans, monthStart, monthEnd);
  }, [myLeaveSpans, calendarYear, calendarMonth]);

  const swapBadgesByDate = useMemo(() => {
    const m = {};
    (swapRequests || []).forEach((r) => {
      const rd = r.requester_work_date ? toYmdFromDbOrString(r.requester_work_date) : null;
      const cd = r.counterparty_work_date ? toYmdFromDbOrString(r.counterparty_work_date) : null;
      [rd, cd].filter(Boolean).forEach((d) => {
        if (!m[d]) m[d] = [];
        m[d].push(r);
      });
    });
    return m;
  }, [swapRequests]);

  /** Tasks I am assigned to, grouped by due date (for calendar dots). */
  const tasksByDueDate = useMemo(() => {
    const m = {};
    for (const t of myTasks || []) {
      if (!t?.due_date) continue;
      const d = isoDate(t.due_date);
      if (!d) continue;
      if (!m[d]) m[d] = [];
      m[d].push(t);
    }
    return m;
  }, [myTasks]);

  /** Per date: selected colleagues — same shift as you, other shift, or anyone (for days you are off). */
  const colleagueCalendarByDate = useMemo(() => {
    const map = {};
    for (const c of colleagueSchedules) {
      for (const ent of c.entries || []) {
        const d = isoDate(ent.work_date);
        if (!d) continue;
        const st = ent.shift_type === 'night' ? 'night' : 'day';
        const name = (c.full_name && String(c.full_name).trim()) || c.email || 'Colleague';
        const row = { user_id: c.user_id, name, shift_type: st };
        if (!map[d]) map[d] = { same: [], other: [], any: [] };
        if (!map[d].any.some((x) => String(x.user_id) === String(c.user_id))) {
          map[d].any.push(row);
        }
        const mine = scheduleByDate[d];
        if (mine) {
          const mySt = mine.shift_type === 'night' ? 'night' : 'day';
          if (st === mySt) {
            if (!map[d].same.some((x) => String(x.user_id) === String(c.user_id))) {
              map[d].same.push({ user_id: c.user_id, name });
            }
          } else if (!map[d].other.some((x) => String(x.user_id) === String(c.user_id))) {
            map[d].other.push(row);
          }
        }
      }
    }
    return map;
  }, [scheduleByDate, colleagueSchedules]);

  const colleagueLeaveByDate = useMemo(() => {
    const monthStart = calendarMonthStartYmd(calendarYear, calendarMonth);
    const monthEnd = calendarMonthEndYmd(calendarYear, calendarMonth);
    const map = {};
    const filterSet = new Set(colleagueFilterIds.map((id) => String(id)));
    for (const c of colleagueSchedules) {
      if (!filterSet.has(String(c.user_id))) continue;
      const name = (c.full_name && String(c.full_name).trim()) || c.email || 'Colleague';
      const byDay = leaveSpansToDaysMap(c.leave_spans, monthStart, monthEnd);
      for (const [d, spans] of Object.entries(byDay)) {
        if (!map[d]) map[d] = [];
        for (const s of spans) {
          map[d].push({
            user_id: c.user_id,
            name,
            leave_type: s.leave_type,
            status: s.status,
          });
        }
      }
    }
    return map;
  }, [colleagueSchedules, colleagueFilterIds, calendarYear, calendarMonth]);

  /** Lines to paint in each calendar cell (same typography as your Day/Night row). */
  const peerLinesByDate = useMemo(() => {
    const out = {};
    for (const [dateStr, ccDay] of Object.entries(colleagueCalendarByDate)) {
      const mine = scheduleByDate[dateStr];
      let lines = [];
      if (colleagueViewMode === 'all_shifts') {
        lines = (ccDay.any || []).map((row) => ({
          key: row.user_id,
          label: shortFirstName(row.name),
          shiftType: row.shift_type === 'night' ? 'night' : 'day',
        }));
      } else if (mine) {
        const st = mine.shift_type === 'night' ? 'night' : 'day';
        lines = (ccDay.same || []).map((row) => ({
          key: row.user_id,
          label: shortFirstName(row.name),
          shiftType: st,
        }));
      } else {
        lines = (ccDay.any || []).map((row) => ({
          key: row.user_id,
          label: shortFirstName(row.name),
          shiftType: row.shift_type === 'night' ? 'night' : 'day',
        }));
      }
      out[dateStr] = lines;
    }
    return out;
  }, [colleagueCalendarByDate, scheduleByDate, colleagueViewMode]);

  const commandCentrePeers = useMemo(
    () => (commandCentrePeerUsers || []).filter((u) => String(u.id) !== String(user?.id)),
    [commandCentrePeerUsers, user?.id]
  );

  const filteredPeersForPicker = useMemo(() => {
    const q = colleagueFilterSearch.trim().toLowerCase();
    if (!q) return commandCentrePeers;
    return commandCentrePeers.filter(
      (u) =>
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
    );
  }, [commandCentrePeers, colleagueFilterSearch]);

  const colleagueFilterKey = colleagueFilterIds.slice().sort().join('|');

  const activeTenantId = user?.tenant_id;

  const loadMySchedule = useCallback(() => {
    pm.mySchedule({ month: calendarMonth, year: calendarYear })
      .then((d) => {
        setScheduleEntries(d.entries || []);
        setMyLeaveSpans(d.leave_spans || []);
      })
      .catch(() => {
        setScheduleEntries([]);
        setMyLeaveSpans([]);
      });
  }, [calendarMonth, calendarYear, activeTenantId]);

  const refreshSwapRequests = useCallback(() => {
    pm.shiftSwaps.my(calendarMonth, calendarYear)
      .then((d) => setSwapRequests(d.requests || []))
      .catch(() => setSwapRequests([]));
  }, [calendarMonth, calendarYear, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'schedule') {
      loadMySchedule();
      refreshSwapRequests();
      pm.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => setTenantUsers([]));
      pm.commandCentreSchedulePeers().then((d) => setCommandCentrePeerUsers(d.users || [])).catch(() => setCommandCentrePeerUsers([]));
      pm.scheduleEvents.list(calendarMonth, calendarYear).then((d) => setScheduleEvents(d.events || [])).catch(() => setScheduleEvents([]));
      tasksApi.list({ assigned_to_me: 'true', limit: 100 }).then((d) => setMyTasks(d.tasks || [])).catch(() => setMyTasks([]));
    }
  }, [activeTab, loadMySchedule, refreshSwapRequests, calendarMonth, calendarYear, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'leave') {
      const y = wallMonthYearInAppZone().year;
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.balance(y).then((d) => setLeaveBalance(d.balance || [])).catch(() => setLeaveBalance([]));
      pm.leave.applications().then((d) => setLeaveApplications(d.applications || [])).catch(() => setLeaveApplications([]));
    }
  }, [activeTab, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'documents') pm.documents.list().then((d) => setDocuments(d.documents || [])).catch(() => setDocuments([]));
  }, [activeTab, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'disciplinary') {
      pm.warnings.list().then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]));
      pm.rewards.list().then((d) => setRewards(d.rewards || [])).catch(() => setRewards([]));
      pm.graceCredits.list().then((d) => setGraceCredits(d.credits || [])).catch(() => setGraceCredits([]));
      pm.debtorSanctions.list().then((d) => setDebtorSanctions(d.sanctions || [])).catch(() => setDebtorSanctions([]));
      pm.creditApplications.list().then((d) => setCreditApplications(d.applications || [])).catch(() => setCreditApplications([]));
      pm.graceCredits.summary().then(setGraceSummary).catch(() => setGraceSummary(null));
      pm.creditDemeritCategories.list('credit').then((d) => setCreditCategories(d.categories || [])).catch(() => setCreditCategories([]));
    }
  }, [activeTab, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'queries') pm.queries.list().then((d) => setQueries(d.queries || [])).catch(() => setQueries([]));
  }, [activeTab, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'growth') {
      pm.evaluations.list().then((d) => setEvaluations(d.evaluations || [])).catch(() => setEvaluations([]));
      pm.pip.list().then((d) => setPipPlans(d.plans || [])).catch(() => setPipPlans([]));
    }
  }, [activeTab, activeTenantId]);

  useEffect(() => {
    if (activeTab === 'claims') {
      setClaimLoading(true);
      claimsApi.myClaims().then((d) => setMyClaims(d.claims || [])).catch(() => setMyClaims([])).finally(() => setClaimLoading(false));
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLEAGUE_FILTER_STORAGE_KEY, JSON.stringify(colleagueFilterIds));
    } catch {
      /* ignore */
    }
  }, [colleagueFilterIds]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLEAGUE_VIEW_MODE_KEY, colleagueViewMode);
    } catch {
      /* ignore */
    }
  }, [colleagueViewMode]);

  useEffect(() => {
    if (activeTab !== 'schedule') return;
    if (colleagueFilterIds.length === 0) {
      setColleagueSchedules([]);
      return;
    }
    let cancelled = false;
    pm.myScheduleColleagues({
      month: calendarMonth,
      year: calendarYear,
      user_ids: colleagueFilterIds,
    })
      .then((d) => {
        if (!cancelled) setColleagueSchedules(d.colleagues || []);
      })
      .catch(() => {
        if (!cancelled) setColleagueSchedules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, calendarMonth, calendarYear, colleagueFilterKey]);

  useEffect(() => {
    if (commandCentrePeers.length === 0) return;
    setColleagueFilterIds((prev) => {
      const valid = new Set(commandCentrePeers.map((u) => String(u.id)));
      const next = prev.filter((id) => valid.has(String(id)));
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [commandCentrePeers]);

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 app-glass-secondary-nav flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Profile</h2>
              <InfoHint
                title="Profile help"
                text="Your HR hub: work schedule, shift activity, leave, employee details (ID, address, next of kin, medical aid, banking, attachments), documents, disciplinary and rewards, queries, and growth records."
              />
            </div>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'schedule') setSearchParams({});
                  else setSearchParams({ tab: tab.id });
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                  activeTab === tab.id
                    ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                    : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200/65 bg-white/50 backdrop-blur-md text-surface-700 hover:bg-white/70 text-sm font-medium shadow-sm" aria-label="Show navigation">
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

          {activeTab === 'schedule' && (
            <div className="flex flex-col lg:flex-row gap-4 flex-1 min-w-0 relative">
              <div className="flex-1 min-w-0 space-y-6 min-h-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900">Work schedule</h1>
                <InfoHint
                  title="Work schedule help"
                  text="The list below is limited to people in your organization who can access Command Centre (page or tab). Tick who to compare; their shifts appear in each day cell the same way as your Day or Night row. Same shift only lists people on your shift type when you are scheduled; All selected shifts shows everyone you selected, including the opposite shift. Your selection is saved on this device."
                  bullets={[
                    'Use Hide panel on Command Centre team to collapse the picker and show only your shifts on the calendar (and a clearer day detail panel). Show team picker restores teammate lines and settings.',
                    'On a phone or narrow screen, the day details panel (clock, tasks, swaps) stays hidden until you tap a date; it opens as a sheet from the bottom. Tap outside the sheet or × to close and return to the calendar.',
                    'On a wide screen, use Hide sidebar under Day details (or in the day header) to collapse the right column and use the full width for the calendar. Use Show day details sidebar to bring the empty panel back, or click any date to open shift and clock.',
                  ]}
                />
                {!selectedScheduleDate && !dayDetailsRailExpanded && (
                  <button
                    type="button"
                    onClick={() => setDayDetailsRailExpanded(true)}
                    className="ml-auto sm:ml-0 px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100"
                  >
                    Show day details sidebar
                  </button>
                )}
              </div>
              {!selectedScheduleDate && !dayDetailsRailExpanded && (
                <div className="rounded-xl border border-dashed border-surface-300/80 bg-white/35 backdrop-blur-md px-4 py-3 text-sm text-surface-700">
                  <strong className="font-medium text-surface-900">Day details hidden.</strong> The calendar uses the full width.{' '}
                  <button type="button" onClick={() => setDayDetailsRailExpanded(true)} className="text-brand-700 font-semibold hover:underline">
                    Show sidebar
                  </button>
                  {' · '}
                  or click any date for shift, clock-in, and tasks.
                </div>
              )}
              {ccTeamPanelCollapsed ? (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-dashed border-surface-300/80 bg-white/35 backdrop-blur-md px-4 py-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200 shrink-0">Command Centre team</p>
                    <InfoHint
                      title="Team picker hidden"
                      text="The teammate picker is hidden. The calendar shows your shifts only so the month grid and day details are easier to read. Show the team picker again to overlay colleagues on calendar days or change who is selected."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCcTeamPanelCollapsed(false)}
                    className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-white/55 backdrop-blur-md border border-surface-300/70 text-surface-800 hover:bg-white/75"
                  >
                    Show team picker
                  </button>
                </div>
              ) : (
                <div className="app-glass-card p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-50">Command Centre team on my calendar</p>
                      <InfoHint
                        title="Command Centre team on calendar"
                        text="Only people with Command Centre access appear here. Search, tick names, then their Day or Night shifts show inside each calendar day like yours."
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setCcTeamPanelCollapsed(true)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-50"
                        title="Hide this panel and show only your shifts on the calendar"
                      >
                        Hide panel
                      </button>
                      <button
                        type="button"
                        onClick={() => setColleagueFilterIds(commandCentrePeers.map((u) => u.id))}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-700 hover:bg-surface-50"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setColleagueFilterIds([])}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-surface-200 text-surface-700 hover:bg-surface-50"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 text-sm">
                    <span className="text-surface-600 font-medium shrink-0">Calendar shows:</span>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-surface-800">
                      <input
                        type="radio"
                        name="colleagueViewMode"
                        checked={colleagueViewMode === 'same_shift'}
                        onChange={() => setColleagueViewMode('same_shift')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      Same shift as me only
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-surface-800">
                      <input
                        type="radio"
                        name="colleagueViewMode"
                        checked={colleagueViewMode === 'all_shifts'}
                        onChange={() => setColleagueViewMode('all_shifts')}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      All selected colleagues (same + other shift)
                    </label>
                  </div>
                  <input
                    type="search"
                    value={colleagueFilterSearch}
                    onChange={(e) => setColleagueFilterSearch(e.target.value)}
                    placeholder="Search by name or email…"
                    className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-100 bg-surface-50/80 p-2 space-y-1">
                    {filteredPeersForPicker.length === 0 ? (
                      <p className="text-sm text-surface-500 px-1">
                        {commandCentrePeers.length === 0
                          ? 'No other Command Centre users in your tenant, or still loading.'
                          : 'No matches.'}
                      </p>
                    ) : (
                      filteredPeersForPicker.map((u) => {
                        const checked = colleagueFilterIds.some((id) => String(id) === String(u.id));
                        return (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/60 cursor-pointer text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setColleagueFilterIds((prev) => {
                                  const idStr = String(u.id);
                                  if (prev.some((id) => String(id) === idStr)) {
                                    return prev.filter((id) => String(id) !== idStr);
                                  }
                                  return [...prev, u.id];
                                });
                              }}
                              className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-surface-800">{u.full_name || u.email}</span>
                            {u.full_name && u.email && <span className="text-surface-500 text-xs truncate">{u.email}</span>}
                          </label>
                        );
                      })
                    )}
                  </div>
                  {colleagueFilterIds.length > 0 && (
                    <p className="text-xs text-surface-500">
                      Showing shifts for {colleagueFilterIds.length} selected user{colleagueFilterIds.length === 1 ? '' : 's'}.
                      {colleagueViewMode === 'same_shift'
                        ? ' Day cells list only people on the same shift type as you when you are scheduled; if you are off, everyone selected who is working that day is listed.'
                        : ' Day cells list each selected person’s Day or Night, same style as your row.'}
                    </p>
                  )}
                </div>
              )}
              <div className="app-glass-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100">
                  <button
                    type="button"
                    onClick={() => {
                      if (calendarMonth === 0) {
                        setCalendarMonth(11);
                        setCalendarYear((y) => y - 1);
                      } else setCalendarMonth((m) => m - 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50"
                  >
                    ← Previous
                  </button>
                  <span className="font-medium text-surface-900">
                    {new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (calendarMonth === 11) {
                        setCalendarMonth(0);
                        setCalendarYear((y) => y + 1);
                      } else setCalendarMonth((m) => m + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50"
                  >
                    Next →
                  </button>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-surface-500 mb-2">
                    {weekDays.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: calendar.startPad }, (_, i) => (
                      <div key={`pad-${i}`} className="min-h-[6.75rem] rounded-lg bg-surface-100/35 backdrop-blur-sm" />
                    ))}
                    {Array.from({ length: calendar.days }, (_, i) => {
                      const day = i + 1;
                      const monthStart = calendarMonthStartYmd(calendarYear, calendarMonth);
                      const dateStr = addCalendarDays(monthStart, day - 1);
                      const shift = scheduleByDate[dateStr];
                      const isToday = dateStr === todayYmd();
                      const isWeekend = isWeekendYmd(dateStr);
                      const isSelected = selectedScheduleDate === dateStr;
                      const daySwaps = swapBadgesByDate[dateStr] || [];
                      const hasSwap = daySwaps.length > 0;
                      const peerLines = ccTeamPanelCollapsed ? [] : peerLinesByDate[dateStr] || [];
                      const maxPeerLines = 5;
                      const peerLinesShown = peerLines.slice(0, maxPeerLines);
                      const peerOverflow = peerLines.length - peerLinesShown.length;
                      const tasksThisDay = tasksByDueDate[dateStr] || [];
                      const taskDots = tasksThisDay.slice(0, 5);
                      const taskDotOverflow = tasksThisDay.length - taskDots.length;
                      const myLeaveToday = myLeaveByDate[dateStr];
                      const peerLeaveToday = colleagueLeaveByDate[dateStr] || [];
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedScheduleDate((prev) => (prev === dateStr ? null : dateStr))}
                          className={`min-h-[6.75rem] rounded-lg border p-1 flex flex-col items-stretch justify-start text-left text-xs cursor-pointer transition-colors relative gap-0.5 overflow-hidden ${
                            isToday
                              ? 'border-brand-500 bg-brand-50/92 backdrop-blur-sm hover:bg-brand-100/88'
                              : isWeekend
                                ? 'border-surface-200/65 bg-surface-100/50 backdrop-blur-sm hover:bg-surface-100/70'
                                : 'app-glass-day-cell hover:bg-white/55 dark:hover:bg-white/[0.12]'
                          } ${isSelected ? 'ring-2 ring-brand-500 ring-offset-1' : ''} ${hasSwap ? 'border-violet-300' : ''}`}
                        >
                          {hasSwap && (
                            <span className="absolute top-0.5 right-0.5 flex gap-0.5" title="Shift swap activity">
                              {daySwaps.slice(0, 3).map((sw) => (
                                <span
                                  key={sw.id}
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    sw.status === 'pending_peer' ? 'bg-amber-500' : sw.status === 'pending_management' ? 'bg-violet-500' : 'bg-surface-400'
                                  }`}
                                />
                              ))}
                            </span>
                          )}
                          <span className="text-surface-700 font-medium text-center w-full shrink-0">{day}</span>
                          {shift && (
                            <span className={`text-[10px] leading-tight w-full truncate ${shift.shift_type === 'day' ? 'text-amber-700' : 'text-indigo-700'}`}>
                              {shift.shift_type === 'day' ? 'Day' : 'Night'}
                            </span>
                          )}
                          {peerLinesShown.map((pl) => (
                            <span
                              key={pl.key}
                              className={`text-[10px] leading-tight w-full truncate ${pl.shiftType === 'day' ? 'text-amber-700' : 'text-indigo-700'}`}
                              title={`${pl.label} · ${pl.shiftType === 'day' ? 'Day' : 'Night'}`}
                            >
                              {pl.label} · {pl.shiftType === 'day' ? 'Day' : 'Night'}
                            </span>
                          ))}
                          {peerOverflow > 0 && (
                            <span className="text-[9px] text-surface-500 leading-tight">+{peerOverflow} more</span>
                          )}
                          {myLeaveToday && myLeaveToday.length > 0 && (
                            <span className="text-[10px] leading-tight w-full truncate text-emerald-800 font-medium" title={myLeaveToday.map((x) => `${x.leave_type} (${x.status})`).join(', ')}>
                              Leave
                              {myLeaveToday.length === 1 && myLeaveToday[0]?.leave_type
                                ? `: ${myLeaveToday[0].leave_type}`
                                : myLeaveToday.length > 1
                                  ? ` (${myLeaveToday.length})`
                                  : ''}
                              {myLeaveToday.some((x) => x.status === 'pending') ? ' · pending' : ''}
                            </span>
                          )}
                          {peerLeaveToday.slice(0, 3).map((pl) => (
                            <span
                              key={`${pl.user_id}-${pl.leave_type}-${pl.status}`}
                              className="text-[10px] leading-tight w-full truncate text-teal-700"
                              title={`${pl.name} · ${pl.leave_type}${pl.status === 'pending' ? ' (pending)' : ''}`}
                            >
                              {shortFirstName(pl.name)} · leave
                            </span>
                          ))}
                          {peerLeaveToday.length > 3 && (
                            <span className="text-[9px] text-surface-500 leading-tight">+{peerLeaveToday.length - 3} on leave</span>
                          )}
                          {taskDots.length > 0 && (
                            <div className="mt-auto pt-0.5 w-full flex flex-wrap justify-center items-center gap-0.5 min-h-[0.5rem] border-t border-surface-100/80">
                              {taskDots.map((tk) => (
                                <span
                                  key={tk.id}
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${taskLegendDotClass(tk.progress_legend)}`}
                                  title={`${tk.title || 'Task'} · ${taskLegendLabel(tk.progress_legend)}`}
                                />
                              ))}
                              {taskDotOverflow > 0 && (
                                <span className="text-[8px] text-surface-500 leading-none">+{taskDotOverflow}</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-surface-100 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
                    <InfoHint
                      title="Calendar legend"
                      text="Shift colours, swap dots, and task progress dots (tasks assigned to you with a due date)."
                      bullets={[
                        `Day: ${SHIFT_DAY}; Night: ${SHIFT_NIGHT}.`,
                        !ccTeamPanelCollapsed
                          ? 'Extra lines under the day list selected Command Centre teammates (Name · Day/Night).'
                          : 'Teammate lines are hidden — use Show team picker to compare shifts on the calendar.',
                        'Amber dot: swap awaiting colleague. Violet dot: awaiting management.',
                        'Bottom row on a day: muted dots = your tasks due that day (colour = progress legend set on the task).',
                        'Green “Leave” lines: approved or pending leave from your applications; teal lines show selected teammates on leave.',
                      ]}
                    />
                    <span className="hidden sm:inline text-surface-300">|</span>
                    <span><span className="inline-block w-3 h-3 rounded bg-amber-200 align-middle mr-1" /> Day</span>
                    <span><span className="inline-block w-3 h-3 rounded bg-indigo-200 align-middle mr-1" /> Night</span>
                    <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-200 align-middle mr-1" /> Leave</span>
                    <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle mr-1" /> Swap peer</span>
                    <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 align-middle mr-1" /> Swap mgmt</span>
                  </div>
                  <TaskColourLegend className="text-[10px] gap-x-2 gap-y-1 text-surface-600" />
                </div>
              </div>
              </div>
              {showDayDetailsColumn && selectedScheduleDate && (
                <button
                  type="button"
                  className="fixed inset-0 z-[90] bg-slate-900/45 lg:hidden"
                  aria-label="Close day details"
                  onClick={() => setSelectedScheduleDate(null)}
                />
              )}
              {showDayDetailsColumn && (
              <div
                className={
                  selectedScheduleDate
                    ? 'w-full lg:w-96 shrink-0 fixed lg:static left-0 right-0 bottom-0 z-[100] lg:z-auto max-h-[min(92vh,760px)] lg:max-h-none flex flex-col justify-end lg:justify-start pointer-events-none lg:pointer-events-auto pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-0'
                    : 'hidden lg:flex w-full lg:w-96 shrink-0'
                }
              >
                {selectedScheduleDate ? (
                  <div className="pointer-events-auto w-full lg:w-96 min-h-0 max-h-[min(92vh,760px)] lg:max-h-none overflow-hidden rounded-t-2xl lg:rounded-xl border border-surface-200/70 bg-white/88 backdrop-blur-2xl shadow-2xl lg:shadow-none dark:border-white/12 dark:bg-surface-900/85">
                    <ScheduleSidePanel
                      selectedDate={selectedScheduleDate}
                      onClose={() => setSelectedScheduleDate(null)}
                      onHideDayDetailsRail={collapseDayDetailsRail}
                      scheduleEntries={scheduleEntries}
                      scheduleEvents={scheduleEvents}
                      myTasks={myTasks}
                      pipPlans={pipPlans}
                      swapRequests={swapRequests}
                      currentUserId={user?.id}
                      leaveForDay={selectedScheduleDate ? myLeaveByDate[selectedScheduleDate] || [] : []}
                      colleagueDay={
                        !ccTeamPanelCollapsed && selectedScheduleDate && colleagueFilterIds.length > 0
                          ? colleagueCalendarByDate[selectedScheduleDate]
                          : null
                      }
                      onOpenSwapModal={(shift) => setSwapModal({ shift })}
                      onSwapHandled={() => {
                        refreshSwapRequests();
                        loadMySchedule();
                      }}
                      onError={setError}
                    />
                  </div>
                ) : (
                  <ScheduleSidePanel
                    selectedDate={null}
                    onClose={() => setSelectedScheduleDate(null)}
                    onHideDayDetailsRail={() => setDayDetailsRailExpanded(false)}
                    scheduleEntries={scheduleEntries}
                    scheduleEvents={scheduleEvents}
                    myTasks={myTasks}
                    pipPlans={pipPlans}
                    swapRequests={swapRequests}
                    currentUserId={user?.id}
                    leaveForDay={[]}
                    colleagueDay={null}
                    onOpenSwapModal={(shift) => setSwapModal({ shift })}
                    onSwapHandled={() => {
                      refreshSwapRequests();
                      loadMySchedule();
                    }}
                    onError={setError}
                  />
                )}
              </div>
              )}
            </div>
          )}
          {activeTab === 'schedule' && swapModal && (
            <ShiftSwapRequestModal
              shift={swapModal.shift}
              calendarMonth={calendarMonth}
              calendarYear={calendarYear}
              tenantId={activeTenantId}
              tenantUsers={tenantUsers}
              currentUserId={user?.id}
              swapRequests={swapRequests}
              onClose={() => setSwapModal(null)}
              onSuccess={() => {
                setSwapModal(null);
                refreshSwapRequests();
                loadMySchedule();
              }}
              onError={setError}
            />
          )}

          {activeTab === 'productivity_score' && <ProductivityScoreTab />}

          {activeTab === 'department_strategy' && (
            <div className="p-0 sm:p-0">
              <DepartmentStrategyView />
            </div>
          )}

          {activeTab === 'career_development' && <CareerDevelopmentHub />}

          {activeTab === 'shift_activity' && <ShiftActivityTab />}

          {activeTab === 'leave' && (
            <LeaveTab
              balance={leaveBalance}
              applications={leaveApplications}
              leaveTypes={leaveTypes}
              onRefresh={() => {
                pm.leave.types().then((d) => setLeaveTypes(d.types || []));
                pm.leave.balance().then((d) => setLeaveBalance(d.balance || []));
                pm.leave.applications().then((d) => setLeaveApplications(d.applications || []));
              }}
              onError={setError}
            />
          )}

          {activeTab === 'employee_details' && <EmployeeDetailsTab onError={setError} />}

          {activeTab === 'employee_onboardment' && <EmployeeOnboardmentTab onError={setError} />}

          {activeTab === 'documents' && (
            <DocumentsTab
              documents={documents}
              onRefresh={() => pm.documents.list().then((d) => setDocuments(d.documents || []))}
              onError={setError}
            />
          )}

          {activeTab === 'company_policies' && (
            <CompanyPoliciesProfileTab user={user} onError={setError} />
          )}

          {activeTab === 'disciplinary' && (
            <DisciplinaryRewardsProfile
              user={user}
              warnings={warnings}
              rewards={rewards}
              graceCredits={graceCredits}
              sanctions={debtorSanctions}
              applications={creditApplications}
              summary={graceSummary}
              creditCategories={creditCategories}
              onRefresh={() => {
                pm.warnings.list().then((d) => setWarnings(d.warnings || []));
                pm.rewards.list().then((d) => setRewards(d.rewards || []));
                pm.graceCredits.list().then((d) => setGraceCredits(d.credits || []));
                pm.debtorSanctions.list().then((d) => setDebtorSanctions(d.sanctions || []));
                pm.creditApplications.list().then((d) => setCreditApplications(d.applications || []));
                pm.graceCredits.summary().then(setGraceSummary);
              }}
              onError={setError}
            />
          )}

          {activeTab === 'queries' && (
            <QueriesTab
              queries={queries}
              onRefresh={() => pm.queries.list().then((d) => setQueries(d.queries || []))}
              onError={setError}
            />
          )}

          {activeTab === 'growth' && (
            <GrowthTab
              evaluations={evaluations}
              pipPlans={pipPlans}
              onRefreshPip={() => pm.pip.list().then((d) => setPipPlans(d.plans || []))}
              onError={setError}
            />
          )}

          {activeTab === 'evaluation_results' && <ColleagueEvaluationResultsTab />}

          {activeTab === 'claims' && (
            <ClaimsTab claims={myClaims} loading={claimLoading} onRefresh={() => claimsApi.myClaims().then((d) => setMyClaims(d.claims || [])).catch(() => {})} user={user} />
          )}

          {activeTab === 'organisational_structure' && <OrgStructureView onError={setError} />}

          {activeTab === 'system_settings' && (
            <div className="space-y-6 max-w-xl">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">System settings</h1>
                <InfoHint
                  title="System settings"
                  text="Preferences stored on this device. They apply to this browser only unless you sign in on another device."
                />
              </div>
              <div className="app-glass-card p-4 shadow-sm">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                    checked={autoHideNavDisabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setAutoHideNavDisabled(v);
                      setAutoHideNavDisabledState(v);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-surface-900 dark:text-surface-100">Disable auto-hide navigation</span>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1 leading-relaxed">
                      When this is on, the main app sidebar stays visible after you change tabs inside a page. When it is off (default), that sidebar automatically hides after five seconds so content can use more horizontal space. In-page section navigation is not affected.
                    </p>
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GrowthTab({ evaluations, pipPlans, onRefreshPip, onError }) {
  const [pipProgress, setPipProgress] = useState({});
  const [pipFull, setPipFull] = useState({});
  const [addingProgress, setAddingProgress] = useState(null);
  const [progressDate, setProgressDate] = useState('');
  const [progressNotes, setProgressNotes] = useState('');
  const [weeklyReport, setWeeklyReport] = useState({ week_number: 1, objective_id: '', employee_response: '', progress_summary: '' });
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    (pipPlans || []).forEach((p) => {
      pm.pip.getProgress(p.id).then((d) => setPipProgress((prev) => ({ ...prev, [p.id]: d.progress || [] }))).catch(() => {});
      pm.pip.getFull(p.id).then((d) => setPipFull((prev) => ({ ...prev, [p.id]: d }))).catch(() => {});
    });
  }, [pipPlans]);

  const addProgress = async (pipId) => {
    if (!progressDate) return;
    setAddingProgress(pipId);
    onError('');
    try {
      await pm.pip.addProgress(pipId, { progress_date: progressDate, notes: progressNotes.trim() || undefined });
      setProgressDate('');
      setProgressNotes('');
      pm.pip.getProgress(pipId).then((d) => setPipProgress((prev) => ({ ...prev, [pipId]: d.progress || [] })));
      onRefreshPip();
    } catch (err) {
      onError(err?.message || 'Failed to add progress');
    } finally {
      setAddingProgress(null);
    }
  };

  const submitWeeklyReport = async (pipId) => {
    if (!weeklyReport.week_number) return;
    setAddingProgress(pipId);
    onError('');
    try {
      await pm.pip.addWeeklyReport(pipId, weeklyReport);
      setWeeklyReport({ week_number: weeklyReport.week_number + 1, objective_id: '', employee_response: '', progress_summary: '' });
      const d = await pm.pip.getFull(pipId);
      setPipFull((prev) => ({ ...prev, [pipId]: d }));
      onRefreshPip();
    } catch (err) {
      onError(err?.message || 'Failed to submit report');
    } finally {
      setAddingProgress(null);
    }
  };

  const downloadPipPdfServer = (p) => {
    setDownloading(`pdf-${p.id}`);
    downloadAttachmentWithAuth(pm.pip.pdfUrl(p.id), `pip-${(p.title || 'plan').replace(/[^a-z0-9]/gi, '-')}.pdf`)
      .catch((err) => onError(err?.message || 'PDF failed'))
      .finally(() => setDownloading(null));
  };

  const downloadPipPdf = (p) => {
    const progress = pipProgress[p.id] || [];
    setDownloading(`pdf-${p.id}`);
    try {
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(14);
      doc.text(p.title, 14, y);
      y += 8;
      doc.setFontSize(10);
      doc.text(`Status: ${p.status}  |  ${formatDate(p.start_date)} – ${formatDate(p.end_date)}`, 14, y);
      y += 8;
      if (p.goals) {
        doc.setFontSize(10);
        doc.text('Goals:', 14, y);
        y += 6;
        doc.setFontSize(9);
        const goalLines = doc.splitTextToSize(p.goals, 180);
        doc.text(goalLines, 14, y);
        y += goalLines.length * 5 + 4;
      }
      if (progress.length > 0) {
        y += 6;
        doc.setFontSize(10);
        doc.text('Progress updates', 14, y);
        y += 6;
        progress.forEach((pr) => {
          doc.setFontSize(9);
          doc.text(`${formatDate(pr.progress_date)}: ${(pr.notes || '—').slice(0, 80)}`, 14, y);
          y += 6;
        });
      }
      doc.save(`pip-${(p.title || 'plan').replace(/[^a-z0-9]/gi, '-')}.pdf`);
    } catch (err) {
      onError(err?.message || 'PDF failed');
    } finally {
      setDownloading(null);
    }
  };

  const downloadPipExcel = async (p) => {
    const progress = pipProgress[p.id] || [];
    setDownloading(`excel-${p.id}`);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('PIP');
      ws.columns = [
        { header: 'Field', key: 'field', width: 20 },
        { header: 'Value', key: 'value', width: 50 },
      ];
      ws.addRows([
        { field: 'Title', value: p.title },
        { field: 'Status', value: p.status },
        { field: 'Start date', value: formatDate(p.start_date) },
        { field: 'End date', value: formatDate(p.end_date) },
        { field: 'Goals', value: (p.goals || '').slice(0, 500) },
      ]);
      if (progress.length > 0) {
        const ws2 = wb.addWorksheet('Progress');
        ws2.columns = [
          { header: 'Date', key: 'progress_date', width: 12 },
          { header: 'Notes', key: 'notes', width: 50 },
        ];
        ws2.addRows(progress);
      }
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = `pip-${(p.title || 'plan').replace(/[^a-z0-9]/gi, '-')}-${todayYmd()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      onError(err?.message || 'Excel failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Growth</h1>
        <InfoHint
          title="Growth help"
          text="View evaluations and your performance improvement plan (PIP). Respond to weekly objectives set by management, submit progress reports, and download official PDFs."
        />
      </div>
      <div className="space-y-4">
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Employee evaluations</p>
          {evaluations.length === 0 ? (
            <p className="text-surface-500 text-sm">No evaluations yet.</p>
          ) : (
            <ul className="space-y-2">
              {evaluations.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.period}</span>
                  {e.rating && <span className="ml-2 text-surface-600">{e.rating}</span>}
                  <span className="text-surface-400 text-xs ml-1">{formatDate(e.created_at)}</span>
                  {e.notes && <p className="text-surface-600 mt-0.5">{e.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Performance improvement plan</p>
          {(!pipPlans || pipPlans.length === 0) ? (
            <p className="text-surface-500 text-sm">None assigned.</p>
          ) : (
            <ul className="space-y-4">
              {pipPlans.map((p) => (
                <li key={p.id} className="border-b border-surface-100 pb-4 last:border-0">
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-surface-500 text-xs">{p.status} · {formatDate(p.start_date)} – {formatDate(p.end_date)}</span>
                  </div>
                  {p.goals && <p className="text-surface-600 mt-1 text-sm whitespace-pre-wrap">{p.goals}</p>}
                  {(pipFull[p.id]?.plan?.approaches) && (
                    <div className="mt-2 text-xs text-surface-600">
                      <p className="font-medium text-surface-700">Approaches</p>
                      <p className="whitespace-pre-wrap">{pipFull[p.id].plan.approaches}</p>
                      <p className="font-medium text-surface-700 mt-1">Interventions</p>
                      <p className="whitespace-pre-wrap">{pipFull[p.id].plan.interventions}</p>
                    </div>
                  )}
                  {(pipFull[p.id]?.objectives || []).length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-surface-700 mb-1">Weekly objectives (management)</p>
                      <ul className="text-xs space-y-2">
                        {pipFull[p.id].objectives.map((o) => (
                          <li key={o.id} className="border-l-2 border-brand-200 pl-2">
                            <span className="font-medium">Week {o.week_number}: {o.title}</span>
                            {o.target_outcome && <p className="text-surface-500">Target: {o.target_outcome}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.status !== 'closed' && (
                    <div className="mt-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-900/30 space-y-2">
                      <p className="text-xs font-medium text-surface-700">Submit weekly progress report</p>
                      <input
                        type="number"
                        min={1}
                        value={weeklyReport.week_number}
                        onChange={(e) => setWeeklyReport((r) => ({ ...r, week_number: Number(e.target.value) }))}
                        className="w-20 rounded border px-2 py-1 text-xs"
                      />
                      <select
                        value={weeklyReport.objective_id}
                        onChange={(e) => setWeeklyReport((r) => ({ ...r, objective_id: e.target.value }))}
                        className="w-full rounded border px-2 py-1 text-xs"
                      >
                        <option value="">Link to objective (optional)</option>
                        {(pipFull[p.id]?.objectives || []).map((o) => (
                          <option key={o.id} value={o.id}>Week {o.week_number}: {o.title}</option>
                        ))}
                      </select>
                      <textarea
                        value={weeklyReport.progress_summary}
                        onChange={(e) => setWeeklyReport((r) => ({ ...r, progress_summary: e.target.value }))}
                        placeholder="Progress summary against objectives"
                        rows={2}
                        className="w-full rounded border px-2 py-1 text-xs"
                      />
                      <textarea
                        value={weeklyReport.employee_response}
                        onChange={(e) => setWeeklyReport((r) => ({ ...r, employee_response: e.target.value }))}
                        placeholder="Your response / actions taken"
                        rows={2}
                        className="w-full rounded border px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => submitWeeklyReport(p.id)}
                        disabled={addingProgress === p.id}
                        className="px-3 py-1 rounded bg-brand-600 text-white text-xs disabled:opacity-50"
                      >
                        Submit week report
                      </button>
                    </div>
                  )}
                  {(pipFull[p.id]?.reports || []).length > 0 && (
                    <ul className="text-xs mt-2 space-y-1">
                      {(pipFull[p.id].reports || []).map((r) => (
                        <li key={r.id} className="text-surface-600">
                          Week {r.week_number}: {r.progress_summary || r.employee_response || '—'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2">
                    <p className="text-xs font-medium text-surface-600 mb-1">Legacy progress notes</p>
                    {(pipProgress[p.id] || []).length === 0 ? (
                      <p className="text-surface-500 text-xs">No progress entries yet.</p>
                    ) : (
                      <ul className="text-xs space-y-1">
                        {(pipProgress[p.id] || []).map((pr) => (
                          <li key={pr.id}>{formatDate(pr.progress_date)} — {pr.notes || '—'}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2 items-end mt-2">
                      <input type="date" value={progressDate} onChange={(e) => setProgressDate(e.target.value)} className="rounded border border-surface-300 px-2 py-1 text-xs" />
                      <input type="text" value={progressNotes} onChange={(e) => setProgressNotes(e.target.value)} placeholder="Notes" className="rounded border border-surface-300 px-2 py-1 text-xs w-40" />
                      <button type="button" onClick={() => addProgress(p.id)} disabled={addingProgress === p.id || !progressDate} className="px-2 py-1 rounded bg-brand-600 text-white text-xs disabled:opacity-50">Add progress</button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button type="button" onClick={() => downloadPipPdfServer(p)} disabled={downloading === `pdf-${p.id}`} className="text-xs text-brand-600 hover:underline disabled:opacity-50 font-medium">Download official PDF</button>
                      <button type="button" onClick={() => downloadPipExcel(p)} disabled={downloading === `excel-${p.id}`} className="text-xs text-brand-600 hover:underline disabled:opacity-50">Download Excel</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function swapBlocksEntry(swapRequests, entryId) {
  if (!entryId || !swapRequests?.length) return false;
  return swapRequests.some(
    (r) =>
      ['pending_peer', 'pending_management'].includes(r.status) &&
      (r.requester_entry_id === entryId || r.counterparty_entry_id === entryId)
  );
}

function ScheduleSidePanel({
  selectedDate,
  onClose,
  /** Collapses the day-details rail and clears the selected date (full calendar width). */
  onHideDayDetailsRail,
  scheduleEntries,
  scheduleEvents,
  myTasks,
  pipPlans,
  swapRequests = [],
  currentUserId,
  /** Leave segments for this day: { leave_type, status }[] */
  leaveForDay = [],
  /** { same, other, any } from colleague overlay for this day */
  colleagueDay = null,
  onOpenSwapModal,
  onSwapHandled,
  onError,
}) {
  const [peerNotesById, setPeerNotesById] = useState({});
  const [peerBusy, setPeerBusy] = useState(null);
  if (!selectedDate) {
    return (
      <div className="w-full lg:w-80 shrink-0 bg-surface-50 dark:bg-surface-900/40 rounded-xl border border-surface-200 dark:border-surface-800 p-4 flex flex-col items-center justify-center text-center text-surface-500 dark:text-surface-400 text-sm min-h-[160px] gap-3">
        <div className="flex items-center justify-center gap-2">
          <span className="font-medium text-surface-700 dark:text-surface-300">Day details</span>
          <InfoHint
            title="Day details panel"
            text="Click a date on the calendar to see your shift, clock panel, tasks due, company events, performance items, and shift swaps for that day. On a small screen, tap any day to open this panel from the bottom. On a wide screen you can hide this column with the button below and restore it from the work schedule heading."
          />
        </div>
        {onHideDayDetailsRail && (
          <button
            type="button"
            onClick={onHideDayDetailsRail}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-surface-300 bg-white text-surface-800 hover:bg-surface-50"
          >
            Hide sidebar — calendar only
          </button>
        )}
      </div>
    );
  }
  const shift = (scheduleEntries || []).find((e) => e.work_date && isoDate(e.work_date) === selectedDate);
  const tasksOnDate = (myTasks || []).filter((t) => t.due_date && isoDate(t.due_date) === selectedDate);
  const eventsOnDate = (scheduleEvents || []).filter((e) => e.event_date && isoDate(e.event_date) === selectedDate);
  const dateLabel = formatDate(selectedDate);
  const swapsToday = (swapRequests || []).filter(
    (r) => isoDate(r.requester_work_date) === selectedDate || isoDate(r.counterparty_work_date) === selectedDate
  );
  const entryBlocked = shift?.entry_id && swapBlocksEntry(swapRequests, shift.entry_id);

  const runPeer = async (swapId, approve) => {
    setPeerBusy(swapId);
    onError('');
    try {
      await pm.shiftSwaps.peerReview(swapId, { approve, notes: peerNotesById[swapId]?.trim() || undefined });
      setPeerNotesById((m) => {
        const next = { ...m };
        delete next[swapId];
        return next;
      });
      onSwapHandled?.();
    } catch (err) {
      onError(err?.message || 'Could not update swap');
    } finally {
      setPeerBusy(null);
    }
  };

  const runCancel = async (swapId) => {
    onError('');
    try {
      await pm.shiftSwaps.cancel(swapId);
      onSwapHandled?.();
    } catch (err) {
      onError(err?.message || 'Could not cancel');
    }
  };

  return (
    <div className="w-full lg:w-96 shrink-0 bg-white rounded-none lg:rounded-xl border-0 lg:border border-surface-200 overflow-hidden flex flex-col h-full min-h-0 max-h-full lg:max-h-[calc(100vh-8rem)]">
      <div className="px-4 py-3 border-b border-surface-100 flex justify-between items-center gap-2 shrink-0">
        <span className="font-medium text-surface-900 truncate min-w-0">{dateLabel}</span>
        <div className="flex items-center gap-1 shrink-0">
          {onHideDayDetailsRail && (
            <button
              type="button"
              onClick={onHideDayDetailsRail}
              className="px-2 py-1 text-xs font-medium rounded-lg border border-surface-200 text-surface-700 hover:bg-surface-50 whitespace-nowrap max-sm:max-w-[7.5rem] max-sm:truncate"
              title="Close and hide the sidebar until you pick a date or show it again"
            >
              Hide sidebar
            </button>
          )}
          <button type="button" onClick={onClose} className="p-1.5 rounded text-surface-500 hover:bg-surface-100 text-lg leading-none" aria-label="Close day">
            ×
          </button>
        </div>
      </div>
      <div className="p-4 overflow-y-auto space-y-4 text-sm">
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Shift</p>
          {shift ? (
            <div className="space-y-2">
              <p className="text-surface-800">
                {shift.shift_type === 'night' ? 'Night' : 'Day'} ({shift.shift_type === 'night' ? SHIFT_NIGHT : SHIFT_DAY})
                {shift.notes && <span className="block text-surface-600 mt-0.5">{shift.notes}</span>}
              </p>
              {shift.entry_id && (
                <button
                  type="button"
                  disabled={entryBlocked}
                  onClick={() => onOpenSwapModal?.(shift)}
                  className="w-full px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {entryBlocked ? 'Swap already in progress for this shift' : 'Request shift swap'}
                </button>
              )}
              {!shift.entry_id && (
                <p className="text-xs text-amber-700">This shift has no entry id (refresh after an app update). Contact admin if this persists.</p>
              )}
            </div>
          ) : (
            <p className="text-surface-500">No shift this day</p>
          )}
        </div>

        {leaveForDay && leaveForDay.length > 0 && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 px-3 py-2">
            <p className="text-xs font-medium text-emerald-900 uppercase mb-1">Leave</p>
            <ul className="space-y-1 text-emerald-900">
              {leaveForDay.map((lv, i) => (
                <li key={`${lv.leave_type}-${lv.status}-${i}`} className="text-sm">
                  <span className="font-medium">{lv.leave_type}</span>
                  <span className="text-emerald-800"> · {lv.status === 'pending' ? 'Pending approval' : 'Approved'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {colleagueDay && colleagueDay.any?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-surface-500 uppercase mb-1">Command Centre team (selected)</p>
            <ul className="space-y-1.5 text-surface-800">
              {colleagueDay.any.map((row) => (
                <li key={row.user_id} className="text-sm flex flex-wrap gap-x-1">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-surface-600">
                    — {row.shift_type === 'night' ? 'Night' : 'Day'} ({row.shift_type === 'night' ? SHIFT_NIGHT : SHIFT_DAY})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shift?.entry_id && (
          <ShiftClockPanel shift={shift} selectedDate={selectedDate} onError={onError} />
        )}

        {swapsToday.length > 0 && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3 space-y-3">
            <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">Shift swaps</p>
            {swapsToday.map((r) => {
              const iAmRequester = String(r.requester_user_id) === String(currentUserId);
              const iAmCounterparty = String(r.counterparty_user_id) === String(currentUserId);
              const other = iAmRequester ? r.counterparty_name : r.requester_name;
              const myOfferDate = iAmRequester ? r.requester_work_date : r.counterparty_work_date;
              const myOfferShift = iAmRequester ? r.requester_shift_type : r.counterparty_shift_type;
              const theirOfferDate = iAmRequester ? r.counterparty_work_date : r.requester_work_date;
              const theirOfferShift = iAmRequester ? r.counterparty_shift_type : r.requester_shift_type;
              const onMyOfferDay = isoDate(myOfferDate) === selectedDate;
              const onTheirOfferDay = isoDate(theirOfferDate) === selectedDate;

              return (
                <div key={r.id} className="text-xs border border-violet-100 rounded-md bg-white p-2.5 space-y-2">
                  <div className="flex flex-wrap gap-1 items-center">
                    <span
                      className={`px-1.5 py-0.5 rounded font-medium ${
                        r.status === 'pending_peer'
                          ? 'bg-amber-100 text-amber-900'
                          : r.status === 'pending_management'
                            ? 'bg-violet-100 text-violet-900'
                            : r.status === 'management_approved'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-surface-100 text-surface-700'
                      }`}
                    >
                      {r.status === 'pending_peer' && 'Awaiting colleague'}
                      {r.status === 'pending_management' && 'Awaiting management'}
                      {r.status === 'peer_declined' && 'Declined by colleague'}
                      {r.status === 'management_declined' && 'Declined by management'}
                      {r.status === 'management_approved' && 'Approved — shifts updated'}
                      {r.status === 'cancelled' && 'Cancelled'}
                    </span>
                  </div>
                  <p className="text-surface-800 leading-relaxed">
                    {onMyOfferDay && (
                      <span>
                        <strong>Your shift:</strong> {formatDate(myOfferDate)} ({myOfferShift === 'night' ? 'Night' : 'Day'})
                      </span>
                    )}
                    {onTheirOfferDay && !onMyOfferDay && (
                      <span>
                        <strong>Their shift:</strong> {formatDate(theirOfferDate)} ({theirOfferShift === 'night' ? 'Night' : 'Day'})
                      </span>
                    )}
                    {onMyOfferDay && onTheirOfferDay && (
                      <span>
                        Same calendar day — <strong>you</strong> {myOfferShift}/{theirOfferShift} swap context with <strong>{other || 'colleague'}</strong>.
                      </span>
                    )}
                    {!onMyOfferDay && !onTheirOfferDay && (
                      <span>
                        Linked swap with <strong>{other || 'colleague'}</strong> (other date on this request).
                      </span>
                    )}
                  </p>
                  {r.message && <p className="text-surface-600 italic">&ldquo;{r.message}&rdquo;</p>}
                  {r.status === 'pending_peer' && iAmCounterparty && isoDate(r.counterparty_work_date) !== selectedDate && (
                    <p className="text-violet-800 text-[11px] pt-1">
                      Select <strong>{formatDate(r.counterparty_work_date)}</strong> on the calendar to approve or decline this swap.
                    </p>
                  )}
                  {r.status === 'pending_peer' && iAmCounterparty && isoDate(r.counterparty_work_date) === selectedDate && (
                    <div className="space-y-2 pt-1">
                      <p className="text-surface-700">
                        <strong>{r.requester_name}</strong> wants your <strong>{r.counterparty_shift_type === 'night' ? 'Night' : 'Day'}</strong> on{' '}
                        {formatDate(r.counterparty_work_date)} in exchange for their <strong>{r.requester_shift_type === 'night' ? 'Night' : 'Day'}</strong> on{' '}
                        {formatDate(r.requester_work_date)}.
                      </p>
                      <input
                        type="text"
                        value={peerNotesById[r.id] || ''}
                        onChange={(e) => setPeerNotesById((m) => ({ ...m, [r.id]: e.target.value }))}
                        placeholder="Optional note"
                        className="w-full px-2 py-1.5 rounded border border-surface-200 text-surface-800"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={peerBusy === r.id}
                          onClick={() => runPeer(r.id, true)}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve swap
                        </button>
                        <button
                          type="button"
                          disabled={peerBusy === r.id}
                          onClick={() => runPeer(r.id, false)}
                          className="flex-1 py-1.5 rounded-lg border border-surface-300 text-surface-800 hover:bg-surface-50 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  )}
                  {r.status === 'pending_peer' && iAmRequester && (
                    <button type="button" onClick={() => runCancel(r.id)} className="text-xs text-red-600 hover:underline">
                      Cancel request
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Tasks due</p>
          {tasksOnDate.length === 0 ? (
            <p className="text-surface-500">None</p>
          ) : (
            <ul className="space-y-1.5">
              {tasksOnDate.map((t) => (
                <li
                  key={t.id}
                  className={`text-surface-800 text-sm rounded-r-md border-y border-r border-surface-200/70 pl-2 py-1.5 pr-2 ${taskLegendSurfaceClass(t.progress_legend)}`}
                >
                  <span className="inline-flex items-start gap-2">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${taskLegendDotClass(t.progress_legend)}`} title={taskLegendLabel(t.progress_legend)} aria-hidden />
                    <span className="min-w-0">{t.title}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Company events</p>
          {eventsOnDate.length === 0 ? (
            <p className="text-surface-500">None</p>
          ) : (
            <ul className="space-y-1">
              {eventsOnDate.map((e) => (
                <li key={e.id}>
                  <span className="text-surface-800">{e.title}</span>
                  {e.description && <span className="block text-surface-600 text-xs">{e.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Performance improvement</p>
          {(!pipPlans || pipPlans.length === 0) ? (
            <p className="text-surface-500">None assigned</p>
          ) : (
            <ul className="space-y-1">
              {pipPlans.slice(0, 3).map((p) => (
                <li key={p.id} className="text-surface-800">{p.title} <span className="text-surface-500">— {p.status}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ShiftSwapRequestModal({
  shift,
  calendarMonth,
  calendarYear,
  tenantId,
  tenantUsers,
  currentUserId,
  swapRequests,
  onClose,
  onSuccess,
  onError,
}) {
  const [colleagueId, setColleagueId] = useState('');
  const [theirEntries, setTheirEntries] = useState([]);
  const [theirEntryId, setTheirEntryId] = useState('');
  const [message, setMessage] = useState('');
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const colleagues = (tenantUsers || []).filter((u) => String(u.id) !== String(currentUserId));

  useEffect(() => {
    if (!colleagueId) {
      setTheirEntries([]);
      setTheirEntryId('');
      return;
    }
    setLoadingEntries(true);
    pm.shiftSwaps
      .colleagueEntries(colleagueId, calendarMonth, calendarYear)
      .then((d) => {
        setTheirEntries(d.entries || []);
        setTheirEntryId('');
      })
      .catch(() => {
        setTheirEntries([]);
        onError?.('Could not load colleague schedule for this month');
      })
      .finally(() => setLoadingEntries(false));
  }, [colleagueId, calendarMonth, calendarYear, tenantId, onError]);

  const blocked = swapBlocksEntry(swapRequests, shift?.entry_id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!shift?.entry_id || !colleagueId || !theirEntryId) {
      onError?.('Choose a colleague and one of their shifts');
      return;
    }
    if (blocked) {
      onError?.('This shift already has an open swap request');
      return;
    }
    setSubmitting(true);
    onError?.('');
    try {
      await pm.shiftSwaps.create({
        counterparty_user_id: colleagueId,
        requester_entry_id: shift.entry_id,
        counterparty_entry_id: theirEntryId,
        message: message.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      onError?.(err?.message || 'Failed to create swap request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!shift) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="swap-modal-title">
      <div className="bg-white rounded-2xl border border-surface-200 shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-surface-100 flex justify-between items-start gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <h2 id="swap-modal-title" className="text-lg font-semibold text-surface-900">
              Request shift swap
            </h2>
            <InfoHint
              title="Shift swap help"
              text={`You offer ${shift.shift_type === 'night' ? 'Night' : 'Day'} on ${formatDate(shift.work_date)}. Pick a colleague and the shift you want in return. They must approve first, then management.`}
            />
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-surface-500 hover:bg-surface-100" aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Swap with</label>
            <select
              value={colleagueId}
              onChange={(e) => setColleagueId(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-900"
              required
            >
              <option value="">Select colleague…</option>
              {colleagues.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Their shift you want (same calendar month)</label>
            {loadingEntries ? (
              <p className="text-sm text-surface-500">Loading…</p>
            ) : colleagueId && theirEntries.length === 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                No shifts found for this person in {new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}. Try another month or ask management to add shifts.
              </p>
            ) : (
              <select
                value={theirEntryId}
                onChange={(e) => setTheirEntryId(e.target.value)}
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-900"
                required
                disabled={!colleagueId}
              >
                <option value="">Select date & shift…</option>
                {theirEntries.map((en) => (
                  <option key={en.entry_id} value={en.entry_id}>
                    {formatDate(en.work_date)} — {en.shift_type === 'night' ? 'Night' : 'Day'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Note to colleague (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-900"
              placeholder="e.g. Family event — happy to return favour another week."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-300 text-surface-800 hover:bg-surface-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || blocked || !theirEntryId}
              className="flex-1 py-2 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function leaveSectorLabel(s) {
  if (s === 'public') return 'Public sector';
  if (s === 'private') return 'Private sector';
  if (s === 'both') return 'Public & private';
  return '';
}

function LeaveTab({ balance, applications, leaveTypes = [], onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState('');
  const [leaveTypeOther, setLeaveTypeOther] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  const effectiveLeaveType = leaveType === '_other_' ? leaveTypeOther.trim() : leaveType;
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!effectiveLeaveType || !startDate || !endDate) {
      onError('Leave type, start date and end date are required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
      const res = await pm.leave.create({ leave_type: effectiveLeaveType, start_date: startDate, end_date: endDate, days_requested: days, reason: reason || undefined });
      if (res?.application?.id && files.length > 0) {
        await pm.leave.addAttachments(res.application.id, files);
      }
      setShowForm(false);
      setLeaveType('');
      setLeaveTypeOther('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setFiles([]);
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const year = wallMonthYearInAppZone().year;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Leave application</h1>
        <InfoHint
          title="Leave application help"
          text="Check your leave balance, submit new applications with optional attachments, and review history. Managers process approvals in Management."
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="app-glass-card p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Leave balance ({year})</p>
          {balance.length === 0 ? (
            <p className="mt-1 text-surface-500 text-sm">No balance on record</p>
          ) : (
            <ul className="mt-1 space-y-2 text-sm">
              {balance.map((b) => (
                <li key={`${b.leave_type}-${b.year ?? year}`}>
                  <span className="font-medium">{b.leave_type}</span>: {(b.total_days || 0) - (b.used_days || 0)} days remaining
                  <span className="block text-xs text-surface-500 mt-0.5">
                    Recorded {b.total_days ?? 0} allocated · {b.used_days ?? 0} used
                    {(b.type_default_days_per_year != null || b.type_sector) && (
                      <>
                        {' '}
                        · Typical: {b.type_default_days_per_year != null ? `${b.type_default_days_per_year} days/yr` : '—'}
                        {b.type_sector ? ` (${leaveSectorLabel(b.type_sector)})` : ''}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="md:col-span-2 app-glass-card p-4">
          {!showForm ? (
            <>
              <p className="text-sm font-medium text-surface-700 mb-2">Apply for leave</p>
              <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                New leave application
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Leave type *</label>
                <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                  <option value="">Select or type below</option>
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                  <option value="_other_">Other (type below)</option>
                </select>
                {leaveType === '_other_' && (
                  <input type="text" value={leaveTypeOther} onChange={(e) => setLeaveTypeOther(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Study leave" required />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Start date *</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">End date *</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Reason (optional)</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Attachments (optional)</label>
                <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="w-full text-sm text-surface-600 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border file:border-surface-300 file:bg-surface-50" />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
      {leaveTypes.length > 0 && (
        <div className="app-glass-card p-4 overflow-x-auto">
          <p className="text-sm font-medium text-surface-700 mb-1">Leave types &amp; typical day weights</p>
          <p className="text-xs text-surface-500 mb-3">
            Configured for your organisation (database). Management can add a South African starter set or custom types.
          </p>
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-left text-surface-500 border-b border-surface-200">
              <tr>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Typical days / year</th>
                <th className="py-2 pr-3 font-medium">Sector</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {leaveTypes.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="py-2 pr-3 font-medium text-surface-900">{t.name}</td>
                  <td className="py-2 pr-3">{t.default_days_per_year != null ? t.default_days_per_year : '—'}</td>
                  <td className="py-2 pr-3">{leaveSectorLabel(t.sector) || '—'}</td>
                  <td className="py-2 text-surface-600 text-xs max-w-md">{t.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="app-glass-card p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-medium text-surface-700">Leave application history</p>
          <button
            type="button"
            disabled={applications.length === 0 || downloadingExcel}
            onClick={async () => {
              setDownloadingExcel(true);
              try {
                const wb = new ExcelJS.Workbook();
                const ws = wb.addWorksheet('Leave history');
                ws.columns = [
                  { header: 'Leave type', key: 'leave_type', width: 18 },
                  { header: 'Start date', key: 'start_date', width: 12 },
                  { header: 'End date', key: 'end_date', width: 12 },
                  { header: 'Days', key: 'days_requested', width: 8 },
                  { header: 'Status', key: 'status', width: 12 },
                  { header: 'Applied', key: 'created_at', width: 14 },
                  { header: 'Reviewed', key: 'reviewed_at', width: 14 },
                ];
                ws.addRows(applications.map((a) => ({
                  leave_type: a.leave_type,
                  start_date: formatDate(a.start_date),
                  end_date: formatDate(a.end_date),
                  days_requested: a.days_requested,
                  status: a.status,
                  created_at: formatDate(a.created_at),
                  reviewed_at: formatDate(a.reviewed_at),
                })));
                const buf = await wb.xlsx.writeBuffer();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([buf]));
                a.download = `leave-history-${todayYmd()}.xlsx`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (err) {
                onError(err?.message || 'Export failed');
              } finally {
                setDownloadingExcel(false);
              }
            }}
            className="text-sm text-brand-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloadingExcel ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        {applications.length === 0 ? (
          <p className="text-sm text-surface-500">No applications yet.</p>
        ) : (
          <ul className="space-y-2">
            {applications.map((a) => (
              <li key={a.id} className="flex justify-between items-start text-sm border-b border-surface-100 pb-2">
                <span>{a.leave_type} — {formatDate(a.start_date)} to {formatDate(a.end_date)} ({a.days_requested} days)</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : a.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                }`}>{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DocumentsTab({ documents, onRefresh, onError }) {
  const [uploading, setUploading] = useState(false);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    onError('');
    pm.documents.upload(file)
      .then(() => { onRefresh(); e.target.value = ''; })
      .catch((err) => onError(err?.message || 'Upload failed'))
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Employee documents</h1>
        <InfoHint title="Employee documents help" text="Your personal document library. Upload files and download them when needed." />
      </div>
      <div className="app-glass-card p-4">
        <label className="inline-block">
          <span className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 cursor-pointer inline-block">
            {uploading ? 'Uploading…' : 'Upload document'}
          </span>
          <input type="file" className="sr-only" onChange={handleFile} disabled={uploading} />
        </label>
      </div>
      {documents.length === 0 ? (
        <p className="text-surface-500 text-sm">No documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span>{d.file_name}</span>
              <button
                type="button"
                onClick={() => downloadAttachmentWithAuth(pm.documents.downloadUrl(d.id), d.file_name).catch((err) => onError(err?.message))}
                className="text-brand-600 hover:underline"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueriesTab({ queries, onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) {
      onError('Subject is required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.queries.create({ subject: subject.trim(), body: body.trim() || undefined });
      setShowForm(false);
      setSubject('');
      setBody('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Queries</h1>
        <InfoHint
          title="Queries help"
          text="Submit grievances or complaints to management. Track status and read responses when they are added."
        />
      </div>
      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Submit a query
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="app-glass-card p-4 space-y-3 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Subject *</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Details</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
          </div>
        </form>
      )}
      <div className="app-glass-card p-4">
        <p className="text-sm font-medium text-surface-700 mb-2">My queries</p>
        {queries.length === 0 ? (
          <p className="text-sm text-surface-500">No queries submitted yet.</p>
        ) : (
          <ul className="space-y-3">
            {queries.map((q) => (
              <li key={q.id} className="border-b border-surface-100 pb-3">
                <p className="font-medium">{q.subject}</p>
                <p className="text-surface-600 text-sm mt-0.5">{q.body}</p>
                <p className="text-xs text-surface-500 mt-1">{formatDate(q.created_at)} — <span className={q.status === 'closed' ? 'text-emerald-600' : 'text-amber-600'}>{q.status}</span></p>
                {q.response_text && <p className="text-sm mt-2 p-2 bg-surface-50 rounded">Response: {q.response_text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
