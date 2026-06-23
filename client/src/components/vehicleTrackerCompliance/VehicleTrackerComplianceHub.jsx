import { useCallback, useEffect, useMemo, useState } from 'react';
import { vehicleTrackerCompliance as vtcApi } from '../../api';
import { downloadTrackerComplianceHistoryExcel } from '../../lib/vehicleTrackerComplianceExport.js';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDateInput(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function StatusBadge({ label }) {
  const l = String(label || '');
  const styles = {
    Compliant: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'Not compliant': 'bg-red-100 text-red-800 border-red-200',
    'Grace period': 'bg-amber-100 text-amber-900 border-amber-200',
    Expired: 'bg-slate-200 text-slate-800 border-slate-300',
    Suspended: 'bg-red-200 text-red-950 border-red-300',
    'Not checked': 'bg-surface-100 text-surface-600 border-surface-200',
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[l] || styles['Not checked']}`}>
      {l || '—'}
    </span>
  );
}

const TRUCK_CHECKS = [
  { key: 'has_camera', label: 'Has camera' },
  { key: 'load_camera_working', label: 'Load camera working' },
  { key: 'cab_camera_working', label: 'Cab camera working' },
  { key: 'road_camera_working', label: 'Road camera working' },
  { key: 'tracking_updating', label: 'Tracking updating' },
];

const DRIVER_CHECKS = [
  { key: 'driver_wearing_ppe', label: 'Wearing PPE' },
  { key: 'driver_no_overspeeding_24h', label: 'No overspeeding alerts in past 24 hours' },
  { key: 'driver_license_valid', label: 'License and permit valid' },
];

const CC_SUB_TABS = [
  { id: 'checks', label: 'Fleet status' },
  { id: 'grace', label: 'Grace periods' },
  { id: 'suspensions', label: 'Suspensions' },
  { id: 'history', label: 'Check history' },
];

const emptyForm = () => ({
  has_camera: false,
  load_camera_working: false,
  cab_camera_working: false,
  road_camera_working: false,
  tracking_updating: false,
  driver_section_used: false,
  driver_wearing_ppe: false,
  driver_no_overspeeding_24h: false,
  driver_license_valid: false,
  notes: '',
});

function LoginDetailsPanel({ title, provider, username, password }) {
  return (
    <div className="rounded-xl bg-surface-50 border border-surface-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 mb-2">{title}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div><dt className="text-surface-500">Provider</dt><dd className="font-medium">{provider || '—'}</dd></div>
        <div><dt className="text-surface-500">Username</dt><dd className="font-medium break-all">{username || '—'}</dd></div>
        <div><dt className="text-surface-500">Password</dt><dd className="font-medium break-all">{password || '—'}</dd></div>
      </dl>
    </div>
  );
}

function ChecklistReadonly({ checks, form }) {
  return (
    <div className="space-y-1">
      {checks.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${form?.[key] ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-surface-300 text-surface-400'}`}>
            {form?.[key] ? '✓' : ''}
          </span>
          <span className={form?.[key] ? 'text-surface-800' : 'text-surface-500'}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function TruckDetailModal({ truckId, onClose, readOnly }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!truckId) return;
    setLoading(true);
    vtcApi
      .truck(truckId, { full: true })
      .then(setDetail)
      .catch((e) => setError(e?.message || 'Could not load truck'))
      .finally(() => setLoading(false));
  }, [truckId]);

  if (!truckId) return null;

  const truck = detail?.truck;
  const status = detail?.current_status;
  const checks = detail?.checks || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-surface-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-surface-200 sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-surface-900">{truck?.registration || 'Truck details'}</h3>
          <p className="text-sm text-surface-500">
            {truck?.contractor_name}{truck?.sub_contractor ? ` · ${truck.sub_contractor}` : ''}
            {truck?.fleet_no ? ` · Fleet ${truck.fleet_no}` : ''}
          </p>
        </div>
        <div className="p-5 space-y-5">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {loading ? (
            <p className="text-sm text-surface-500">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                  <p className="text-xs text-surface-500">Current status</p>
                  <div className="mt-1"><StatusBadge label={status?.current_status_label} /></div>
                </div>
                <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                  <p className="text-xs text-surface-500">Last inspection</p>
                  <p className="text-sm font-medium mt-1">{fmtDate(status?.last_tracker_inspection_date)}</p>
                </div>
                <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                  <p className="text-xs text-surface-500">Compliance expires</p>
                  <p className="text-sm font-medium mt-1">{fmtDate(status?.compliance_expires_at)}</p>
                </div>
                <div className="rounded-xl bg-surface-50 border border-surface-200 p-3">
                  <p className="text-xs text-surface-500">Grace expires</p>
                  <p className="text-sm font-medium mt-1">{fmtDate(status?.grace_period_expires_at)}</p>
                </div>
              </div>

              {!readOnly && (
                <div className="space-y-3">
                  <LoginDetailsPanel
                    title="Tracker login"
                    provider={truck?.tracking_provider}
                    username={truck?.tracking_username}
                    password={truck?.tracking_password}
                  />
                  <LoginDetailsPanel
                    title="Camera login"
                    provider={truck?.camera_provider}
                    username={truck?.camera_username}
                    password={truck?.camera_password}
                  />
                </div>
              )}

              {truck?.routes?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 mb-2">Enrolled routes</p>
                  <p className="text-sm text-surface-700">{truck.routes.map((r) => r.name).join(', ')}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 mb-3">Compliance check history</p>
                {!checks.length ? (
                  <p className="text-sm text-surface-500">No checks recorded for this truck.</p>
                ) : (
                  <div className="space-y-3">
                    {checks.map((c) => (
                      <div key={c.id} className="rounded-xl border border-surface-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div>
                            <p className="text-sm font-semibold text-surface-900">{fmtDate(c.checked_at)}</p>
                            <p className="text-xs text-surface-500">By {c.checked_by_name || '—'}{c.driver_name ? ` · Driver: ${c.driver_name}` : ''}</p>
                          </div>
                          <StatusBadge label={c.status === 'grace' ? 'Grace period' : c.status === 'expired' ? 'Expired' : c.is_compliant ? 'Compliant' : 'Not compliant'} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium text-surface-500 mb-1">Vehicle checks</p>
                            <ChecklistReadonly checks={TRUCK_CHECKS} form={c} />
                          </div>
                          {c.driver_section_used && (
                            <div>
                              <p className="text-xs font-medium text-surface-500 mb-1">Driver checks</p>
                              <ChecklistReadonly checks={DRIVER_CHECKS} form={c} />
                            </div>
                          )}
                        </div>
                        {c.fail_reasons?.length > 0 && (
                          <p className="text-xs text-red-700 mt-2">Failures: {c.fail_reasons.join('; ')}</p>
                        )}
                        {c.grace_period_expires_at && (
                          <p className="text-xs text-amber-800 mt-2">Grace until {fmtDate(c.grace_period_expires_at)} — {c.grace_period_reason}</p>
                        )}
                        {c.compliance_expires_at && c.is_compliant && (
                          <p className="text-xs text-surface-500 mt-1">Compliance valid until {fmtDate(c.compliance_expires_at)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-surface-200 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-300">Close</button>
        </div>
      </div>
    </div>
  );
}

function ComplianceCheckModal({ truck, onClose, onSubmitted }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!truck?.truck_id) return;
    setLoading(true);
    vtcApi
      .truck(truck.truck_id)
      .then((r) => setDetail(r.truck))
      .catch((e) => setError(e?.message || 'Could not load truck'))
      .finally(() => setLoading(false));
  }, [truck?.truck_id]);

  const toggle = (key) => setForm((f) => ({ ...f, [key]: !f[key] }));

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await vtcApi.submitCheck({
        truck_id: truck.truck_id,
        ...form,
      });
      onSubmitted?.(res.check);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  if (!truck) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-surface-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-surface-200">
          <h3 className="text-lg font-bold text-surface-900">Tracker compliance check</h3>
          <p className="text-sm text-surface-500">{truck.registration} · {truck.contractor_name}{truck.sub_contractor ? ` · ${truck.sub_contractor}` : ''}</p>
        </div>
        <div className="p-5 space-y-5">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {loading ? (
            <p className="text-sm text-surface-500">Loading login details…</p>
          ) : (
            <>
              <div className="space-y-3">
                <LoginDetailsPanel
                  title="Tracker login details"
                  provider={detail?.tracking_provider}
                  username={detail?.tracking_username}
                  password={detail?.tracking_password}
                />
                <LoginDetailsPanel
                  title="Camera login details"
                  provider={detail?.camera_provider}
                  username={detail?.camera_username}
                  password={detail?.camera_password}
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 mb-2">Vehicle tracker checks</p>
                <div className="space-y-2">
                  {TRUCK_CHECKS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 rounded-lg border border-surface-200 px-3 py-2 cursor-pointer hover:bg-surface-50">
                      <input type="checkbox" checked={!!form[key]} onChange={() => toggle(key)} className="rounded border-surface-300" />
                      <span className="text-sm text-surface-800">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={form.driver_section_used} onChange={() => toggle('driver_section_used')} className="rounded border-surface-300" />
                  <span className="text-sm font-medium text-surface-800">Include driver section (optional)</span>
                </label>
                {form.driver_section_used && (
                  <div className="space-y-2 ml-1">
                    {DRIVER_CHECKS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-3 rounded-lg border border-surface-200 px-3 py-2 cursor-pointer hover:bg-surface-50">
                        <input type="checkbox" checked={!!form[key]} onChange={() => toggle(key)} className="rounded border-surface-300" />
                        <span className="text-sm text-surface-800">{label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <label className="block text-sm">
                <span className="text-xs font-medium text-surface-500">Notes (optional)</span>
                <textarea className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-surface-200 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-300">Cancel</button>
          <button type="button" disabled={saving || loading} onClick={submit} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-medium disabled:opacity-50">
            {saving ? 'Submitting…' : 'Submit compliance check'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryActionsModal({ check, onClose, onUpdated }) {
  const [extraEmails, setExtraEmails] = useState('');
  const [message, setMessage] = useState('');
  const [graceReason, setGraceReason] = useState('');
  const [graceUntil, setGraceUntil] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!check) return null;

  const notify = async () => {
    setBusy('notify');
    setError('');
    try {
      await vtcApi.notify(check.id, {
        emails: extraEmails.split(/[,;]/).map((e) => e.trim()).filter(Boolean),
        message,
      });
      onUpdated?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Notify failed');
    } finally {
      setBusy('');
    }
  };

  const grantGrace = async () => {
    setBusy('grace');
    setError('');
    try {
      await vtcApi.grantGrace(check.id, { reason: graceReason, expires_at: graceUntil });
      onUpdated?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Grace period failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-surface-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b"><h3 className="font-bold">{check.registration} — actions</h3></div>
        <div className="p-5 space-y-4 text-sm">
          {error && <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {!check.is_compliant && (
            <>
              <div>
                <p className="font-medium mb-1">Notify contractor</p>
                {check.notified_at && <p className="text-xs text-emerald-700 mb-2">Notified contractor on {fmtDate(check.notified_at)}</p>}
                <input className="w-full rounded-lg border border-surface-300 px-3 py-2 mb-2" placeholder="Extra emails (comma separated)" value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} />
                <textarea className="w-full rounded-lg border border-surface-300 px-3 py-2 mb-2" rows={2} placeholder="Optional message" value={message} onChange={(e) => setMessage(e.target.value)} />
                <button type="button" disabled={!!busy} onClick={notify} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">{busy === 'notify' ? 'Sending…' : 'Send email'}</button>
              </div>
              <div className="border-t pt-4">
                <p className="font-medium mb-1">Grant grace period</p>
                <textarea className="w-full rounded-lg border border-surface-300 px-3 py-2 mb-2" rows={2} placeholder="Reason for grace period *" value={graceReason} onChange={(e) => setGraceReason(e.target.value)} />
                <input type="datetime-local" className="w-full rounded-lg border border-surface-300 px-3 py-2 mb-2" value={graceUntil} onChange={(e) => setGraceUntil(e.target.value)} />
                <button type="button" disabled={!!busy} onClick={grantGrace} className="px-3 py-2 rounded-lg border border-amber-400 text-amber-900 bg-amber-50 text-sm disabled:opacity-50">{busy === 'grace' ? 'Saving…' : 'Grant grace period'}</button>
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t"><button type="button" onClick={onClose} className="w-full py-2 rounded-lg border border-surface-300 text-sm">Close</button></div>
      </div>
    </div>
  );
}

function FilterBar({ filters, setFilters, contractors, subcontractors, mode, showDateRange, onExport, exportBusy }) {
  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input
          className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
          placeholder="Search registration, fleet no…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <select className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.contractorId} onChange={(e) => setFilters((f) => ({ ...f, contractorId: e.target.value, subContractor: '' }))}>
          <option value="">All contractors</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {mode !== 'suspensions' && (
          <select className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.subContractor} onChange={(e) => setFilters((f) => ({ ...f, subContractor: e.target.value }))}>
            <option value="">All sub-contractors</option>
            {subcontractors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {mode === 'checks' && (
          <select className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.complianceStatus} onChange={(e) => setFilters((f) => ({ ...f, complianceStatus: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="compliant">Compliant</option>
            <option value="expired">Expired</option>
            <option value="non_compliant">Not compliant</option>
            <option value="not_checked">Not checked</option>
            <option value="suspended">Suspended</option>
          </select>
        )}
        {mode === 'suspensions' && (
          <select className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.entityType} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}>
            <option value="">Trucks & drivers</option>
            <option value="truck">Trucks only</option>
            <option value="driver">Drivers only</option>
          </select>
        )}
        {mode === 'history' && (
          <select className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.historyResult} onChange={(e) => setFilters((f) => ({ ...f, historyResult: e.target.value }))}>
            <option value="">All results</option>
            <option value="compliant">Compliant</option>
            <option value="failed">Not compliant</option>
            <option value="grace">Grace period</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
          </select>
        )}
      </div>
      {showDateRange && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-surface-500 mb-1">From</span>
            <input type="date" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-surface-500 mb-1">To</span>
            <input type="date" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          </label>
          {onExport && (
            <button type="button" disabled={exportBusy} onClick={onExport} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-medium disabled:opacity-50">
              {exportBusy ? 'Exporting…' : 'Download Excel'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function VehicleTrackerComplianceHub({
  mode = 'checks',
  title,
  subtitle,
  readOnly = false,
  allowExport = false,
  enrolledOnly = true,
  tenantName = '',
  portalSubNav = false,
}) {
  const [activeMode, setActiveMode] = useState(mode);
  const [filters, setFilters] = useState({
    search: '',
    contractorId: '',
    subContractor: '',
    complianceStatus: '',
    entityType: '',
    historyResult: '',
    dateFrom: fmtDateInput(new Date(Date.now() - 30 * 86400000)),
    dateTo: fmtDateInput(new Date()),
  });
  const [contractors, setContractors] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [history, setHistory] = useState([]);
  const [gracePeriods, setGracePeriods] = useState([]);
  const [suspensions, setSuspensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [detailTruckId, setDetailTruckId] = useState(null);
  const [historyAction, setHistoryAction] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);

  const effectiveMode = portalSubNav ? activeMode : mode;

  const loadContractors = useCallback(() => {
    vtcApi.contractors().then((r) => setContractors(r.contractors || [])).catch(() => {});
  }, []);

  const loadChecks = useCallback(() => {
    setLoading(true);
    setError('');
    vtcApi
      .trucks({
        search: filters.search || undefined,
        contractorId: filters.contractorId || undefined,
        subContractor: filters.subContractor || undefined,
        complianceStatus: filters.complianceStatus || undefined,
        enrolledOnly: enrolledOnly ? undefined : false,
      })
      .then((r) => {
        if (r.migrationRequired) setMigrationRequired(true);
        setTrucks(r.trucks || []);
        setSubcontractors(r.subcontractors || []);
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [filters, enrolledOnly]);

  const loadHistory = useCallback(() => {
    setLoading(true);
    const dateFrom = filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined;
    const dateTo = filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined;
    vtcApi
      .history({
        search: filters.search || undefined,
        contractorId: filters.contractorId || undefined,
        subContractor: filters.subContractor || undefined,
        dateFrom,
        dateTo,
        limit: 5000,
      })
      .then((r) => {
        let checks = r.checks || [];
        if (filters.historyResult === 'compliant') checks = checks.filter((c) => c.is_compliant && c.status === 'passed');
        else if (filters.historyResult === 'failed') checks = checks.filter((c) => !c.is_compliant && !['grace', 'suspended', 'expired'].includes(c.status));
        else if (filters.historyResult === 'grace') checks = checks.filter((c) => c.status === 'grace');
        else if (filters.historyResult === 'expired') checks = checks.filter((c) => c.status === 'expired');
        else if (filters.historyResult === 'suspended') checks = checks.filter((c) => c.status === 'suspended');
        setHistory(checks);
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [filters]);

  const loadGrace = useCallback(() => {
    setLoading(true);
    vtcApi
      .gracePeriods({ active: effectiveMode === 'grace' && !readOnly ? '1' : undefined })
      .then((r) => setGracePeriods(r.gracePeriods || []))
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [effectiveMode, readOnly]);

  const loadSuspensions = useCallback(() => {
    setLoading(true);
    vtcApi
      .suspensions({
        search: filters.search || undefined,
        contractorId: filters.contractorId || undefined,
        entityType: filters.entityType || undefined,
      })
      .then((r) => setSuspensions(r.suspensions || []))
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    loadContractors();
  }, [loadContractors]);

  useEffect(() => {
    if (effectiveMode === 'checks') loadChecks();
    else if (effectiveMode === 'history') loadHistory();
    else if (effectiveMode === 'suspensions') loadSuspensions();
    else loadGrace();
  }, [effectiveMode, loadChecks, loadHistory, loadGrace, loadSuspensions]);

  const filteredSubcontractors = useMemo(() => {
    if (!filters.contractorId) return subcontractors;
    return [...new Set(trucks.map((t) => t.sub_contractor).filter(Boolean))].sort();
  }, [filters.contractorId, subcontractors, trucks]);

  const handleTruckClick = (t) => {
    if (readOnly) setDetailTruckId(t.truck_id);
    else setSelectedTruck(t);
  };

  const handleHistoryRowClick = (c) => {
    if (c.truck_id) setDetailTruckId(c.truck_id);
  };

  const handleExport = async () => {
    setExportBusy(true);
    try {
      const dateFrom = filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : undefined;
      const dateTo = filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : undefined;
      const r = await vtcApi.history({
        search: filters.search || undefined,
        contractorId: filters.contractorId || undefined,
        subContractor: filters.subContractor || undefined,
        dateFrom,
        dateTo,
        limit: 5000,
      });
      let checks = r.checks || [];
      if (filters.historyResult === 'compliant') checks = checks.filter((c) => c.is_compliant && c.status === 'passed');
      else if (filters.historyResult === 'failed') checks = checks.filter((c) => !c.is_compliant && !['grace', 'suspended', 'expired'].includes(c.status));
      else if (filters.historyResult === 'grace') checks = checks.filter((c) => c.status === 'grace');
      else if (filters.historyResult === 'expired') checks = checks.filter((c) => c.status === 'expired');
      else if (filters.historyResult === 'suspended') checks = checks.filter((c) => c.status === 'suspended');
      await downloadTrackerComplianceHistoryExcel(checks, {
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
        tenantName,
      });
    } catch (e) {
      setError(e?.message || 'Export failed');
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-surface-900">{title}</h2>
        {subtitle && <p className="text-sm text-surface-500 mt-1">{subtitle}</p>}
      </div>

      {portalSubNav && (
        <div className="flex flex-wrap gap-2 border-b border-surface-200 pb-2">
          {CC_SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveMode(t.id)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                activeMode === t.id ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {migrationRequired && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Database migration required. Run: <code className="font-mono">npm run db:vehicle-tracker-compliance</code>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {effectiveMode !== 'grace' || portalSubNav ? (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          contractors={contractors}
          subcontractors={filteredSubcontractors}
          mode={effectiveMode}
          showDateRange={effectiveMode === 'history'}
          onExport={allowExport && effectiveMode === 'history' ? handleExport : null}
          exportBusy={exportBusy}
        />
      ) : null}

      {loading ? (
        <p className="text-surface-500 text-sm">Loading…</p>
      ) : effectiveMode === 'checks' ? (
        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-4 py-3">Registration</th>
                <th className="px-4 py-3">Fleet no</th>
                <th className="px-4 py-3">Contractor</th>
                <th className="px-4 py-3">Sub-contractor</th>
                <th className="px-4 py-3">Last inspection</th>
                <th className="px-4 py-3">Compliance expires</th>
                <th className="px-4 py-3">Grace expires</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {trucks.map((t) => (
                <tr key={t.truck_id} className="border-t border-surface-100 hover:bg-brand-50/40 cursor-pointer" onClick={() => handleTruckClick(t)}>
                  <td className="px-4 py-3 font-medium">{t.registration}</td>
                  <td className="px-4 py-3">{t.fleet_no || '—'}</td>
                  <td className="px-4 py-3">{t.contractor_name}</td>
                  <td className="px-4 py-3">{t.sub_contractor || '—'}</td>
                  <td className="px-4 py-3">{fmtDate(t.last_tracker_inspection_date)}</td>
                  <td className="px-4 py-3">{fmtDate(t.compliance_expires_at)}</td>
                  <td className="px-4 py-3">{t.grace_period_expires_at ? fmtDate(t.grace_period_expires_at) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge label={t.current_status_label} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!trucks.length && <p className="text-center text-surface-500 py-8">No trucks match your filters.</p>}
        </div>
      ) : effectiveMode === 'history' ? (
        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-50 text-xs uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-4 py-3 text-left">Checked</th>
                <th className="px-4 py-3 text-left">Truck</th>
                <th className="px-4 py-3 text-left">Contractor</th>
                <th className="px-4 py-3 text-left">Result</th>
                <th className="px-4 py-3 text-left">Compliance expires</th>
                <th className="px-4 py-3 text-left">Notified</th>
                <th className="px-4 py-3 text-left">Grace</th>
                {!readOnly && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id} className="border-t border-surface-100 hover:bg-brand-50/40 cursor-pointer" onClick={() => handleHistoryRowClick(c)}>
                  <td className="px-4 py-3">{fmtDate(c.checked_at)}</td>
                  <td className="px-4 py-3 font-medium">{c.registration}{c.fleet_no ? ` · ${c.fleet_no}` : ''}</td>
                  <td className="px-4 py-3">{c.contractor_name}{c.sub_contractor ? ` / ${c.sub_contractor}` : ''}</td>
                  <td className="px-4 py-3">
                    {c.status === 'expired' ? <span className="text-slate-700 font-medium">Expired</span>
                      : c.status === 'grace' ? <StatusBadge label="Grace period" />
                      : c.is_compliant ? <span className="text-emerald-700 font-medium">Compliant</span>
                      : <span className="text-red-700 font-medium">Not compliant</span>}
                  </td>
                  <td className="px-4 py-3">{fmtDate(c.compliance_expires_at)}</td>
                  <td className="px-4 py-3">{c.notified_at ? fmtDate(c.notified_at) : '—'}</td>
                  <td className="px-4 py-3">{c.grace_period_expires_at ? fmtDate(c.grace_period_expires_at) : '—'}</td>
                  {!readOnly && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {!c.is_compliant && c.status !== 'suspended' && c.status !== 'expired' && (
                        <button type="button" className="text-brand-700 text-xs font-medium hover:underline" onClick={() => setHistoryAction(c)}>Actions</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length && <p className="text-center text-surface-500 py-8">No compliance checks in this date range.</p>}
        </div>
      ) : effectiveMode === 'suspensions' ? (
        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-50 text-xs uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Entity</th>
                <th className="px-4 py-3 text-left">Contractor</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Suspended</th>
                <th className="px-4 py-3 text-left">Ends</th>
                <th className="px-4 py-3 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {suspensions.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-surface-100 ${s.entity_type === 'truck' ? 'hover:bg-brand-50/40 cursor-pointer' : ''}`}
                  onClick={() => s.entity_type === 'truck' && s.entity_id && setDetailTruckId(s.entity_id)}
                >
                  <td className="px-4 py-3 capitalize">{s.entity_type}</td>
                  <td className="px-4 py-3 font-medium">
                    {s.entity_type === 'truck' ? `${s.registration || '—'}${s.fleet_no ? ` · ${s.fleet_no}` : ''}` : s.driver_name || '—'}
                  </td>
                  <td className="px-4 py-3">{s.contractor_name || '—'}{s.sub_contractor ? ` / ${s.sub_contractor}` : ''}</td>
                  <td className="px-4 py-3 max-w-xs truncate" title={s.reason}>{s.reason || '—'}</td>
                  <td className="px-4 py-3">{fmtDate(s.created_at)}</td>
                  <td className="px-4 py-3">{s.is_permanent ? 'Permanent' : fmtDate(s.suspension_ends_at)}</td>
                  <td className="px-4 py-3">{s.tracker_compliance ? <span className="text-amber-800 text-xs font-medium">Tracker compliance</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!suspensions.length && <p className="text-center text-surface-500 py-8">No active suspensions match your filters.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-50 text-xs uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-4 py-3 text-left">Truck</th>
                <th className="px-4 py-3 text-left">Contractor</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Grace expires</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {gracePeriods.map((g) => {
                const expired = g.grace_period_expires_at && new Date(g.grace_period_expires_at) < new Date();
                return (
                  <tr key={g.id} className="border-t border-surface-100 hover:bg-brand-50/40 cursor-pointer" onClick={() => g.truck_id && setDetailTruckId(g.truck_id)}>
                    <td className="px-4 py-3 font-medium">{g.registration}</td>
                    <td className="px-4 py-3">{g.contractor_name}</td>
                    <td className="px-4 py-3">{g.grace_period_reason || '—'}</td>
                    <td className="px-4 py-3">{fmtDate(g.grace_period_expires_at)}</td>
                    <td className="px-4 py-3">
                      {g.status === 'suspended' ? <StatusBadge label="Suspended" /> : expired ? <span className="text-red-700 font-medium">Expired</span> : <StatusBadge label="Grace period" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!gracePeriods.length && <p className="text-center text-surface-500 py-8">No grace periods on record.</p>}
        </div>
      )}

      {selectedTruck && !readOnly && (
        <ComplianceCheckModal
          truck={selectedTruck}
          onClose={() => setSelectedTruck(null)}
          onSubmitted={() => {
            loadChecks();
            loadHistory();
          }}
        />
      )}

      {detailTruckId && (
        <TruckDetailModal
          truckId={detailTruckId}
          readOnly={readOnly}
          onClose={() => setDetailTruckId(null)}
        />
      )}

      {historyAction && !readOnly && (
        <HistoryActionsModal
          check={historyAction}
          onClose={() => setHistoryAction(null)}
          onUpdated={() => {
            loadHistory();
            loadGrace();
          }}
        />
      )}
    </div>
  );
}
