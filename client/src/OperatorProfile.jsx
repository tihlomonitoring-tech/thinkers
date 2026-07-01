import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { operatorManagement as opMgmt, profileManagement as pm, claims as claimsApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import InfoHint from './components/InfoHint.jsx';
import OvertimeClaimFields, { OvertimeClaimDetail } from './components/OvertimeClaimFields.jsx';
import { calculateSaOvertimeClaim } from './lib/saOvertimeClaim.js';
import EmployeeDetailsTab from './components/EmployeeDetailsTab.jsx';
import CompanyPoliciesProfileTab from './components/CompanyPoliciesProfileTab.jsx';
import LeaveTab from './components/profile/LeaveTab.jsx';
import OperatorLoadingSlipsTab from './components/operator/OperatorLoadingSlipsTab.jsx';
import OrgStructureView from './components/OrgStructureView.jsx';
import {
  wallMonthYearInAppZone,
  calendarMonthStartYmd,
  daysInCalendarMonth,
  startPadForCalendarMonth,
  addCalendarDays,
  isWeekendYmd,
  todayYmd,
  toYmdFromDbOrString,
} from './lib/appTime.js';
import { DEFAULT_SHIFT_SETTINGS, shiftLabel } from './lib/workScheduleShiftTimes.js';

const SHIFT_TYPE_BADGE = {
  day: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  night: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  fixed: 'bg-brand-100 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
};
const SHIFT_TYPE_TEXT = {
  day: 'text-amber-700 dark:text-amber-300',
  night: 'text-indigo-700 dark:text-indigo-300',
  fixed: 'text-brand-700 dark:text-brand-300',
};
const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TABS = [
  { id: 'schedule', label: 'Work schedule' },
  { id: 'loading_slips', label: 'Loading slips' },
  { id: 'productivity', label: 'Productivity score' },
  { id: 'wages', label: 'Wages & salary' },
  { id: 'leave', label: 'Leave application' },
  { id: 'claims', label: 'Claims & reimbursements' },
  { id: 'organisational_structure', label: 'Organisational structure' },
  { id: 'employee_details', label: 'Employee details' },
  { id: 'company_policies', label: 'Company policies' },
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

const CLAIM_TYPES = [
  { id: 'fuel', label: 'Fuel' }, { id: 'travel', label: 'Travel expense' }, { id: 'accommodation', label: 'Accommodation' },
  { id: 'meals', label: 'Meals' }, { id: 'equipment', label: 'Equipment' }, { id: 'tools', label: 'Tools' },
  { id: 'training', label: 'Training' }, { id: 'communication', label: 'Communication' }, { id: 'service', label: 'Service rendered' },
  { id: 'overtime', label: 'Overtime' }, { id: 'other', label: 'Other' },
];
const CLAIM_STATUS_STYLES = { draft: 'bg-surface-100 text-surface-700', pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', declined: 'bg-red-50 text-red-700 ring-1 ring-red-200', paid: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', cancelled: 'bg-surface-200 text-surface-500' };

function ClaimsTab({ claims, loading, onRefresh, user }) {
  const [view, setView] = useState('list');
  const [saving, setSaving] = useState(false);
  const [detailClaim, setDetailClaim] = useState(null);
  const [detailAttachments, setDetailAttachments] = useState([]);

  const emptyForm = {
    claim_date: new Date().toISOString().slice(0, 10), claim_type: 'fuel', category: '', department_name: '', description: '', amount: '',
    km_travelled: '', start_location: '', end_location: '', vehicle_registration: '', rate_per_km: '4.64',
    service_rendered: '', hours_spent: '', hourly_rate: '',
    ot_period_end: '', ot_weekday_hours: '', ot_sunday_hours: '', ot_public_holiday_hours: '', ot_monthly_salary: '',
    bank_name: '', account_holder: user?.full_name || '', account_number: '', branch_code: '', account_type: 'savings',
    declaration_accepted: false,
  };
  const [form, setForm] = useState({ ...emptyForm });

  const fmtZar = (v) => { const n = Number(v); return isNaN(n) ? 'R 0.00' : 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const fmtDate = (d) => d ? String(d).slice(0, 10) : '—';

  useEffect(() => { if (form.claim_type === 'travel' && form.km_travelled && form.rate_per_km) { const c = (Number(form.km_travelled) * Number(form.rate_per_km)).toFixed(2); if (c !== form.amount) setForm((f) => ({ ...f, amount: c })); } }, [form.km_travelled, form.rate_per_km, form.claim_type]);
  useEffect(() => { if (form.claim_type === 'service' && form.hours_spent && form.hourly_rate) { const c = (Number(form.hours_spent) * Number(form.hourly_rate)).toFixed(2); if (c !== form.amount) setForm((f) => ({ ...f, amount: c })); } }, [form.hours_spent, form.hourly_rate, form.claim_type]);
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
  }, [form.claim_type, form.hourly_rate, form.ot_weekday_hours, form.ot_sunday_hours, form.ot_public_holiday_hours, form.amount]);

  const openDetail = (claim) => { setView('detail'); claimsApi.get(claim.id).then((d) => { setDetailClaim(d.claim); setDetailAttachments(d.attachments || []); }).catch(() => {}); };
  const handleSubmit = async (e) => { e.preventDefault(); if (!form.declaration_accepted) { alert('Please accept the declaration.'); return; } setSaving(true); try { await claimsApi.create(form); setForm({ ...emptyForm }); setView('list'); onRefresh(); } catch (err) { alert(err?.message || 'Failed'); } finally { setSaving(false); } };
  const handleCancel = async (id) => { if (!window.confirm('Cancel this claim?')) return; try { await claimsApi.cancel(id); onRefresh(); if (view === 'detail') setView('list'); } catch {} };
  const canDeleteClaim = (c) => ['draft', 'pending', 'cancelled', 'declined'].includes(c?.status);
  const handleDelete = async (id) => {
    if (!window.confirm('Permanently delete this claim? A deletion email will be sent.')) return;
    try { await claimsApi.delete(id); onRefresh(); if (view === 'detail') setView('list'); } catch (err) { alert(err?.message || 'Could not delete'); }
  };
  const handleUpload = async (claimId, files) => { const fd = new FormData(); for (const f of files) fd.append('files', f); try { await claimsApi.uploadAttachments(claimId, fd); claimsApi.get(claimId).then((d) => setDetailAttachments(d.attachments || [])); } catch {} };
  const handleDeleteAtt = async (attId) => { if (!window.confirm('Remove?')) return; try { await claimsApi.removeAttachment(attId); if (detailClaim) claimsApi.get(detailClaim.id).then((d) => setDetailAttachments(d.attachments || [])); } catch {} };

  const declText = 'I declare that the information provided in this claim is true and accurate to the best of my knowledge. I understand that submitting false claims may result in disciplinary action. All expenses were incurred for legitimate business purposes.';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Claims & reimbursements</h2>
        {view === 'list' && <button type="button" onClick={() => setView('new')} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">New claim</button>}
        {view !== 'list' && <button type="button" onClick={() => { setView('list'); setDetailClaim(null); }} className="text-sm text-brand-600 hover:underline">Back to claims</button>}
      </div>

      {view === 'list' && (loading ? <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div> : claims.length === 0 ? <div className="text-center py-12 text-surface-500"><p className="text-lg font-medium">No claims yet</p></div> : (
        <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-surface-500 border-b border-surface-200 bg-surface-50"><th className="px-4 py-2.5">Ref</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Type</th><th className="px-4 py-2.5">Description</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Actions</th></tr></thead>
          <tbody>{claims.map((c) => (
            <tr key={c.id} className="border-b border-surface-50 hover:bg-surface-50 cursor-pointer" onClick={() => openDetail(c)}>
              <td className="px-4 py-2.5 font-mono text-xs text-brand-600 font-medium">{c.reference_number}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtDate(c.claim_date)}</td>
              <td className="px-4 py-2.5">{CLAIM_TYPES.find((t) => t.id === c.claim_type)?.label || c.claim_type}</td>
              <td className="px-4 py-2.5 max-w-[200px] truncate">{c.description}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtZar(c.amount)}</td>
              <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLAIM_STATUS_STYLES[c.status] || ''}`}>{c.status}</span></td>
              <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex flex-wrap gap-2">
                  {(c.status === 'pending' || c.status === 'draft') && <button type="button" onClick={() => handleCancel(c.id)} className="text-amber-700 hover:underline text-xs">Cancel</button>}
                  {canDeleteClaim(c) && <button type="button" onClick={() => handleDelete(c.id)} className="text-red-600 hover:underline text-xs font-medium">Delete</button>}
                </div>
              </td>
            </tr>
          ))}</tbody></table>
        </div>
      ))}

      {view === 'new' && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-surface-900">Submit new claim</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Date *</label><input type="date" required value={form.claim_date} onChange={(e) => setForm((f) => ({ ...f, claim_date: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Type *</label><select required value={form.claim_type} onChange={(e) => setForm((f) => ({ ...f, claim_type: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm">{CLAIM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Department</label><input type="text" value={form.department_name} onChange={(e) => setForm((f) => ({ ...f, department_name: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="block text-xs font-medium text-surface-600 mb-1">Description *</label><textarea required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
            {(form.claim_type === 'travel' || form.claim_type === 'fuel') && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3"><h4 className="text-xs font-semibold text-blue-800 uppercase">Travel details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium text-surface-600 mb-1">Start location</label><input type="text" value={form.start_location} onChange={(e) => setForm((f) => ({ ...f, start_location: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-surface-600 mb-1">End location</label><input type="text" value={form.end_location} onChange={(e) => setForm((f) => ({ ...f, end_location: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-surface-600 mb-1">Vehicle reg</label><input type="text" value={form.vehicle_registration} onChange={(e) => setForm((f) => ({ ...f, vehicle_registration: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
                {form.claim_type === 'travel' && <><div><label className="block text-xs font-medium text-surface-600 mb-1">KM travelled</label><input type="number" step="0.1" value={form.km_travelled} onChange={(e) => setForm((f) => ({ ...f, km_travelled: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div><div><label className="block text-xs font-medium text-surface-600 mb-1">Rate/KM</label><input type="number" step="0.01" value={form.rate_per_km} onChange={(e) => setForm((f) => ({ ...f, rate_per_km: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div></>}
              </div></div>
            )}
            {form.claim_type === 'overtime' && <OvertimeClaimFields form={form} setForm={setForm} />}
            {form.claim_type === 'service' && (
              <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4 space-y-3"><h4 className="text-xs font-semibold text-purple-800 uppercase">Service details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium text-surface-600 mb-1">Service</label><input type="text" value={form.service_rendered} onChange={(e) => setForm((f) => ({ ...f, service_rendered: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-surface-600 mb-1">Hours</label><input type="number" step="0.5" value={form.hours_spent} onChange={(e) => setForm((f) => ({ ...f, hours_spent: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-surface-600 mb-1">Rate/h</label><input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              </div></div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Amount (ZAR) *</label><input type="number" step="0.01" required readOnly={form.claim_type === 'overtime'} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={`w-full border border-surface-300 rounded-lg px-3 py-2 text-sm font-semibold text-lg ${form.claim_type === 'overtime' ? 'bg-orange-50/80' : ''}`} />{form.claim_type === 'overtime' && form.amount && <p className="text-xs text-orange-800 mt-1">BCEA auto-calculated</p>}</div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Category</label><input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3"><h4 className="text-xs font-semibold text-emerald-800 uppercase">Banking details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Account holder</label><input type="text" value={form.account_holder} onChange={(e) => setForm((f) => ({ ...f, account_holder: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Bank</label><input type="text" value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Account #</label><input type="text" value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Branch code</label><input type="text" value={form.branch_code} onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-surface-600 mb-1">Account type</label><select value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))} className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"><option value="savings">Savings</option><option value="cheque">Cheque</option><option value="current">Current</option></select></div>
            </div></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3"><h4 className="text-xs font-semibold text-amber-800 uppercase">Declaration</h4><p className="text-sm text-surface-700">{declText}</p>
            <label className="flex items-start gap-2"><input type="checkbox" checked={form.declaration_accepted} onChange={(e) => setForm((f) => ({ ...f, declaration_accepted: e.target.checked, declaration_text: e.target.checked ? declText : '' }))} className="mt-0.5 rounded border-surface-300" /><span className="text-sm font-medium text-surface-700">I accept the above declaration</span></label></div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={saving || !form.declaration_accepted} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Submitting...' : 'Submit claim'}</button>
              <button type="button" onClick={() => setView('list')} className="px-4 py-2 border border-surface-300 rounded-lg text-sm text-surface-700 hover:bg-surface-50">Cancel</button>
            </div>
          </div>
        </form>
      )}

      {view === 'detail' && detailClaim && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between"><div><h3 className="text-lg font-semibold text-surface-900">{detailClaim.reference_number}</h3><p className="text-sm text-surface-500">{fmtDate(detailClaim.claim_date)} — {CLAIM_TYPES.find((t) => t.id === detailClaim.claim_type)?.label || detailClaim.claim_type}</p></div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${CLAIM_STATUS_STYLES[detailClaim.status] || ''}`}>{detailClaim.status}</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-surface-500">Amount</p><p className="font-semibold tabular-nums text-brand-700">{fmtZar(detailClaim.amount)}</p></div>
              <div><p className="text-xs text-surface-500">Department</p><p className="font-medium">{detailClaim.department_name || '—'}</p></div>
              {detailClaim.km_travelled && <div><p className="text-xs text-surface-500">KM</p><p className="font-medium">{detailClaim.km_travelled} km</p></div>}
              {detailClaim.start_location && <div><p className="text-xs text-surface-500">From</p><p className="font-medium">{detailClaim.start_location}</p></div>}
              {detailClaim.end_location && <div><p className="text-xs text-surface-500">To</p><p className="font-medium">{detailClaim.end_location}</p></div>}
              {detailClaim.reviewed_by_name && <div><p className="text-xs text-surface-500">Reviewed by</p><p className="font-medium">{detailClaim.reviewed_by_name}</p></div>}
            </div>
            <OvertimeClaimDetail claim={detailClaim} fmtZar={fmtZar} />
            {detailClaim.description && <div><p className="text-xs text-surface-500 mb-1">Description</p><p className="text-sm whitespace-pre-wrap">{detailClaim.description}</p></div>}
            {detailClaim.review_notes && <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg"><p className="text-xs text-blue-700 font-medium">Review notes:</p><p className="text-sm text-blue-600">{detailClaim.review_notes}</p></div>}
            {detailClaim.rejection_reason && <div className="p-3 bg-red-50 border border-red-200 rounded-lg"><p className="text-xs text-red-700 font-medium">Reason:</p><p className="text-sm text-red-600">{detailClaim.rejection_reason}</p></div>}
          </div>
          <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-sm font-semibold text-surface-900">Attachments</h4>
            {detailAttachments.length > 0 ? <div className="space-y-2">{detailAttachments.map((a) => (<div key={a.id} className="flex items-center gap-3 p-2 bg-surface-50 rounded-lg"><span className="text-sm text-surface-700 flex-1 truncate">{a.file_name}</span>{detailClaim.status === 'pending' && <button type="button" onClick={() => handleDeleteAtt(a.id)} className="text-xs text-red-600 hover:underline">Remove</button>}</div>))}</div> : <p className="text-sm text-surface-500">No attachments</p>}
            {detailClaim.status === 'pending' && <label className="inline-flex items-center gap-2 px-3 py-2 border border-surface-300 rounded-lg text-sm cursor-pointer hover:bg-surface-50"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>Upload<input type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) handleUpload(detailClaim.id, e.target.files); e.target.value = ''; }} /></label>}
          </div>
          <div className="flex flex-wrap gap-2">
            {detailClaim.status === 'pending' && <button type="button" onClick={() => handleCancel(detailClaim.id)} className="px-4 py-2 border border-amber-300 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-50">Cancel claim</button>}
            {canDeleteClaim(detailClaim) && <button type="button" onClick={() => handleDelete(detailClaim.id)} className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50">Delete permanently</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OperatorProfile() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('operator-profile');
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() =>
    TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'schedule'
  );
  const [error, setError] = useState('');

  const [operatorSchedules, setOperatorSchedules] = useState([]);
  const [shiftSettings, setShiftSettings] = useState({ ...DEFAULT_SHIFT_SETTINGS });
  const [schedCalMonth, setSchedCalMonth] = useState(() => wallMonthYearInAppZone().monthIndex0);
  const [schedCalYear, setSchedCalYear] = useState(() => wallMonthYearInAppZone().year);
  const [selectedSchedDate, setSelectedSchedDate] = useState(null);

  const [operatorProductivity, setOperatorProductivity] = useState(null);
  const [operatorDeliveries, setOperatorDeliveries] = useState([]);
  const [opProdDays, setOpProdDays] = useState(30);

  const [wageConfig, setWageConfig] = useState([]);
  const [payRecords, setPayRecords] = useState([]);

  const [leaveBalance, setLeaveBalance] = useState([]);
  const [leaveApplications, setLeaveApplications] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);

  const [myClaims, setMyClaims] = useState([]);
  const [claimLoading, setClaimLoading] = useState(false);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId });
    setError('');
  };

  useAutoHideNavAfterTabChange(activeTab);

  useEffect(() => {
    if (activeTab === 'schedule') {
      pm.mySchedule({ month: schedCalMonth, year: schedCalYear })
        .then((d) => {
          setOperatorSchedules(d.entries || []);
          setShiftSettings({ ...DEFAULT_SHIFT_SETTINGS, ...(d.shift_settings || {}) });
        })
        .catch(() => setOperatorSchedules([]));
    }
  }, [activeTab, schedCalYear, schedCalMonth]);

  const schedulesByDate = useMemo(() => {
    const map = {};
    (operatorSchedules || []).forEach((s) => {
      const ymd = toYmdFromDbOrString(s.work_date);
      if (!ymd) return;
      if (!map[ymd]) map[ymd] = [];
      map[ymd].push(s);
    });
    return map;
  }, [operatorSchedules]);

  useEffect(() => {
    if (activeTab === 'productivity') {
      opMgmt.productivity.get(user?.id, opProdDays)
        .then((d) => setOperatorProductivity(d.productivity || null))
        .catch(() => setOperatorProductivity(null));
      opMgmt.deliveries.list(user?.id)
        .then((d) => setOperatorDeliveries(d.deliveries || []))
        .catch(() => setOperatorDeliveries([]));
    }
  }, [activeTab, user?.id, opProdDays]);

  useEffect(() => {
    if (activeTab === 'wages') {
      opMgmt.wages.config(user?.id)
        .then((d) => setWageConfig(d.configs || []))
        .catch(() => setWageConfig([]));
      opMgmt.wages.payRecords(user?.id)
        .then((d) => setPayRecords(d.payRecords || []))
        .catch(() => setPayRecords([]));
    }
  }, [activeTab, user?.id]);

  useEffect(() => {
    if (activeTab === 'leave') {
      const y = wallMonthYearInAppZone().year;
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.balance(y).then((d) => setLeaveBalance(d.balance || [])).catch(() => setLeaveBalance([]));
      pm.leave.applications().then((d) => setLeaveApplications(d.applications || [])).catch(() => setLeaveApplications([]));
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'claims') {
      setClaimLoading(true);
      claimsApi.myClaims().then((d) => setMyClaims(d.claims || [])).catch(() => setMyClaims([])).finally(() => setClaimLoading(false));
    }
  }, [activeTab]);

  const refreshLeave = () => {
    const y = wallMonthYearInAppZone().year;
    pm.leave.balance(y).then((d) => setLeaveBalance(d.balance || [])).catch(() => setLeaveBalance([]));
    pm.leave.applications().then((d) => setLeaveApplications(d.applications || [])).catch(() => setLeaveApplications([]));
  };

  const fmtZar = (v) => v != null ? `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 app-glass-secondary-nav flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Operator profile</h2>
              <InfoHint title="Operator profile" text="Your work schedule, delivery productivity, wages, and leave — all in one place." />
            </div>
            {user?.full_name && <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 truncate">{user.full_name}</p>}
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-200" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button type="button" onClick={() => handleTabChange(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                  activeTab === tab.id
                    ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 border-l-2 border-l-brand-500 font-medium'
                    : 'text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-100 border-l-2 border-l-transparent'
                }`}>{tab.label}</button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="mb-4 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 border border-surface-200 dark:border-surface-700" title="Show navigation">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
            Navigation
          </button>
        )}

        {error && <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm border border-red-200 dark:border-red-800">{error}</div>}

        {user && (
          <div className="mb-6 app-glass-card p-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-bold text-lg shrink-0">
              {(user.full_name || user.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-surface-900 dark:text-surface-100 truncate">{user.full_name || '—'}</p>
              <p className="text-sm text-surface-500 dark:text-surface-400 truncate">{user.email || '—'}</p>
            </div>
            {user.role && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300 capitalize">
                {user.role.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        )}

        <div className="max-w-6xl">
          {activeTab === 'schedule' && (() => {
            const startPad = startPadForCalendarMonth(schedCalYear, schedCalMonth);
            const numDays = daysInCalendarMonth(schedCalYear, schedCalMonth);
            const monthStart = calendarMonthStartYmd(schedCalYear, schedCalMonth);
            const dayCount = operatorSchedules.filter((s) => String(s.shift_type || 'day').toLowerCase() === 'day').length;
            const nightCount = operatorSchedules.filter((s) => String(s.shift_type || '').toLowerCase() === 'night').length;
            const selectedDay = selectedSchedDate ? (schedulesByDate[selectedSchedDate] || []) : null;
            const goPrev = () => {
              setSelectedSchedDate(null);
              if (schedCalMonth === 0) { setSchedCalMonth(11); setSchedCalYear((y) => y - 1); }
              else setSchedCalMonth((m) => m - 1);
            };
            const goNext = () => {
              setSelectedSchedDate(null);
              if (schedCalMonth === 11) { setSchedCalMonth(0); setSchedCalYear((y) => y + 1); }
              else setSchedCalMonth((m) => m + 1);
            };
            return (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Operator work schedule</h1>
                <InfoHint title="Operator work schedule" text="Your shift roster assigned in Operator Management, shown on a monthly calendar. Click a day to see the shift, hours window and notes." />
              </div>

              <div className="app-glass-card p-4 flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-sm text-surface-500 dark:text-surface-400">Day shifts</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{dayCount}</p>
                </div>
                <div>
                  <p className="text-sm text-surface-500 dark:text-surface-400">Night shifts</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{nightCount}</p>
                </div>
                <div className="ml-auto text-sm text-surface-500 dark:text-surface-400">{operatorSchedules.length} scheduled day{operatorSchedules.length === 1 ? '' : 's'}</div>
              </div>

              <div className="app-glass-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-700">
                  <button type="button" onClick={goPrev} className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 text-sm hover:bg-surface-50 dark:hover:bg-surface-800">← Previous</button>
                  <span className="font-medium text-surface-900 dark:text-surface-50">
                    {new Date(schedCalYear, schedCalMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </span>
                  <button type="button" onClick={goNext} className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 text-sm hover:bg-surface-50 dark:hover:bg-surface-800">Next →</button>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">
                    {WEEK_DAYS.map((d) => <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: startPad }, (_, i) => (
                      <div key={`pad-${i}`} className="min-h-[6.75rem] rounded-lg bg-surface-100/35 dark:bg-surface-800/30" />
                    ))}
                    {Array.from({ length: numDays }, (_, i) => {
                      const day = i + 1;
                      const dateStr = addCalendarDays(monthStart, day - 1);
                      const entries = schedulesByDate[dateStr] || [];
                      const isToday = dateStr === todayYmd();
                      const isWeekend = isWeekendYmd(dateStr);
                      const isSelected = selectedSchedDate === dateStr;
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedSchedDate((prev) => (prev === dateStr ? null : dateStr))}
                          className={`min-h-[6.75rem] rounded-lg border p-1 flex flex-col items-stretch justify-start text-left text-xs cursor-pointer transition-colors relative gap-0.5 overflow-hidden ${
                            isToday
                              ? 'border-brand-500 bg-brand-50/92 hover:bg-brand-100/88 dark:bg-brand-900/30 dark:hover:bg-brand-900/40'
                              : isWeekend
                                ? 'border-surface-200/65 bg-surface-100/50 hover:bg-surface-100/70 dark:border-surface-700 dark:bg-surface-800/40'
                                : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/40'
                          } ${isSelected ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-surface-900' : ''}`}
                        >
                          <span className="text-surface-700 dark:text-surface-300 font-medium text-center w-full shrink-0">{day}</span>
                          {entries.map((s, idx) => {
                            const st = String(s.shift_type || 'day').toLowerCase();
                            return (
                              <span
                                key={s.entry_id || s.id || idx}
                                className={`text-[10px] leading-tight w-full truncate font-medium ${SHIFT_TYPE_TEXT[st] || SHIFT_TYPE_TEXT.day}`}
                                title={shiftLabel(s, shiftSettings)}
                              >
                                {st === 'night' ? 'Night' : st === 'fixed' ? 'Fixed' : 'Day'}{s.start_time ? ` · ${s.start_time}` : ''}
                              </span>
                            );
                          })}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-surface-100 dark:border-surface-700 flex flex-wrap items-center gap-3 text-xs text-surface-500 dark:text-surface-400">
                  <span><span className="inline-block w-3 h-3 rounded bg-amber-200 dark:bg-amber-900/50 align-middle mr-1" /> Day shift</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-indigo-200 dark:bg-indigo-900/50 align-middle mr-1" /> Night shift</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-brand-200 dark:bg-brand-900/50 align-middle mr-1" /> Fixed</span>
                </div>
              </div>

              {selectedSchedDate && (
                <div className="app-glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-medium text-surface-900 dark:text-surface-50">{formatDate(selectedSchedDate)}</h2>
                    <button type="button" onClick={() => setSelectedSchedDate(null)} className="text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">Close</button>
                  </div>
                  {selectedDay && selectedDay.length > 0 ? (
                    <ul className="space-y-3">
                      {selectedDay.map((s, idx) => {
                        const st = String(s.shift_type || 'day').toLowerCase();
                        return (
                          <li key={s.entry_id || s.id || idx} className="rounded-lg border border-surface-200 dark:border-surface-700 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SHIFT_TYPE_BADGE[st] || SHIFT_TYPE_BADGE.day}`}>
                                {st === 'night' ? 'Night' : st === 'fixed' ? 'Fixed' : 'Day'}
                              </span>
                              {s.schedule_title && <span className="text-xs text-surface-500 dark:text-surface-400 truncate">{s.schedule_title}</span>}
                            </div>
                            <p className="mt-2 text-sm text-surface-700 dark:text-surface-300">{shiftLabel(s, shiftSettings)}</p>
                            {s.notes && <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">{s.notes}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-surface-500 dark:text-surface-400">No shift scheduled on this day.</p>
                  )}
                </div>
              )}
            </div>
            );
          })()}

          {activeTab === 'loading_slips' && (
            <OperatorLoadingSlipsTab user={user} onError={setError} />
          )}

          {activeTab === 'productivity' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Operator productivity score</h1>
                  <InfoHint title="Operator productivity" text="Delivery-based productivity metrics. Scores are calculated from on-time delivery rate, attendance, and overall performance." />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-surface-600 dark:text-surface-400">Period:</label>
                  <select value={opProdDays} onChange={(e) => setOpProdDays(Number(e.target.value))}
                    className="rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:ring-brand-500 focus:border-brand-500">
                    <option value={7}>Last 7 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={60}>Last 60 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                </div>
              </div>

              {(() => {
                const p = operatorProductivity || {};
                const scoreColor = (v) => {
                  const n = Number(v) || 0;
                  if (n >= 80) return 'text-emerald-600 dark:text-emerald-400';
                  if (n >= 60) return 'text-amber-600 dark:text-amber-400';
                  return 'text-red-600 dark:text-red-400';
                };
                const scoreBg = (v) => {
                  const n = Number(v) || 0;
                  if (n >= 80) return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
                  if (n >= 60) return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
                  return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                };
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="app-glass-card p-4 text-center">
                      <p className="text-sm text-surface-500 dark:text-surface-400 mb-1">Total deliveries</p>
                      <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{p.total_deliveries ?? 0}</p>
                    </div>
                    <div className={`rounded-xl border p-4 text-center ${scoreBg(p.delivery_score)}`}>
                      <p className="text-sm text-surface-500 dark:text-surface-400 mb-1">Delivery score</p>
                      <p className={`text-2xl font-bold ${scoreColor(p.delivery_score)}`}>{p.delivery_score != null ? `${p.delivery_score}%` : '—'}</p>
                    </div>
                    <div className={`rounded-xl border p-4 text-center ${scoreBg(p.attendance_score)}`}>
                      <p className="text-sm text-surface-500 dark:text-surface-400 mb-1">Attendance</p>
                      <p className={`text-2xl font-bold ${scoreColor(p.attendance_score)}`}>{p.attendance_score != null ? `${p.attendance_score}%` : '—'}</p>
                    </div>
                    <div className={`rounded-xl border p-4 text-center ${scoreBg(p.overall_score)}`}>
                      <p className="text-sm text-surface-500 dark:text-surface-400 mb-1">Overall score</p>
                      <p className={`text-2xl font-bold ${scoreColor(p.overall_score)}`}>{p.overall_score != null ? `${p.overall_score}%` : '—'}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="app-glass-card overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
                  <h2 className="font-medium text-surface-900 dark:text-surface-100">Deliveries</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Date</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Origin</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Destination</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Weight</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Truck</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Status</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">On-time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100 dark:divide-surface-700/50">
                      {operatorDeliveries.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-400 dark:text-surface-500">No deliveries found for this period.</td></tr>
                      ) : operatorDeliveries.map((d, i) => (
                        <tr key={d.id || i} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors">
                          <td className="px-4 py-3 text-surface-900 dark:text-surface-100">{formatDate(d.delivery_date)}</td>
                          <td className="px-4 py-3 text-surface-700 dark:text-surface-300">{d.origin || '—'}</td>
                          <td className="px-4 py-3 text-surface-700 dark:text-surface-300">{d.destination || '—'}</td>
                          <td className="px-4 py-3 text-surface-700 dark:text-surface-300">{d.weight_kg ? `${d.weight_kg} kg` : '—'}</td>
                          <td className="px-4 py-3 text-surface-700 dark:text-surface-300">{d.truck_registration || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              d.status === 'completed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : d.status === 'delayed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300'
                            }`}>{(d.status || 'pending').replace(/_/g, ' ')}</span>
                          </td>
                          <td className="px-4 py-3">
                            {d.on_time ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Yes
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                No
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'wages' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Wages & salary</h1>
                <InfoHint title="Wages & salary" text="View your pay configuration, records, and payment history. Contact HR or payroll for any discrepancies." />
              </div>

              {wageConfig.length > 0 && (() => {
                const cfg = wageConfig[0];
                return (
                  <div className="app-glass-card p-4">
                    <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-3">Current pay configuration</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Rate type</p>
                        <p className="font-medium text-surface-900 dark:text-surface-100 capitalize">{(cfg.pay_type || '—').replace(/_/g, ' ')}</p>
                      </div>
                      <div>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Base rate</p>
                        <p className="font-medium text-surface-900 dark:text-surface-100">{fmtZar(cfg.base_rate)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Currency</p>
                        <p className="font-medium text-surface-900 dark:text-surface-100">{cfg.currency || 'ZAR'}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="app-glass-card overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
                  <h2 className="font-medium text-surface-900 dark:text-surface-100">Pay records</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Period</th>
                        <th className="px-4 py-3 text-right font-medium text-surface-600 dark:text-surface-300">Regular hrs</th>
                        <th className="px-4 py-3 text-right font-medium text-surface-600 dark:text-surface-300">Overtime</th>
                        <th className="px-4 py-3 text-right font-medium text-surface-600 dark:text-surface-300">Gross</th>
                        <th className="px-4 py-3 text-right font-medium text-surface-600 dark:text-surface-300">Deductions</th>
                        <th className="px-4 py-3 text-right font-medium text-surface-600 dark:text-surface-300">Net</th>
                        <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-300">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100 dark:divide-surface-700/50">
                      {payRecords.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-400 dark:text-surface-500">No pay records found.</td></tr>
                      ) : payRecords.map((r, i) => {
                        const statusStyle = {
                          paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
                          approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
                          pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                          draft: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-400',
                        };
                        return (
                          <tr key={r.id || i} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors">
                            <td className="px-4 py-3 text-surface-900 dark:text-surface-100 whitespace-nowrap">{formatDate(r.pay_period_start)} – {formatDate(r.pay_period_end)}</td>
                            <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{r.regular_hours ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{r.overtime_hours ?? '—'}</td>
                            <td className="px-4 py-3 text-right font-medium text-surface-900 dark:text-surface-100">{fmtZar(r.gross_amount)}</td>
                            <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{r.deductions ? fmtZar(r.deductions) : '—'}</td>
                            <td className="px-4 py-3 text-right font-semibold text-surface-900 dark:text-surface-100">{fmtZar(r.net_amount)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle[r.status] || statusStyle.draft}`}>
                                {(r.status || 'draft').replace(/_/g, ' ')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'leave' && (
            <LeaveTab
              balance={leaveBalance}
              applications={leaveApplications}
              leaveTypes={leaveTypes}
              onRefresh={refreshLeave}
              onError={setError}
            />
          )}

          {activeTab === 'claims' && (
            <ClaimsTab claims={myClaims} loading={claimLoading} onRefresh={() => claimsApi.myClaims().then((d) => setMyClaims(d.claims || [])).catch(() => {})} user={user} />
          )}

          {activeTab === 'organisational_structure' && <OrgStructureView onError={setError} />}

          {activeTab === 'employee_details' && <EmployeeDetailsTab onError={setError} />}

          {activeTab === 'company_policies' && <CompanyPoliciesProfileTab user={user} onError={setError} />}
        </div>
      </div>
    </div>
  );
}
