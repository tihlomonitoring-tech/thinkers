import { useState, useEffect, useMemo, useCallback } from 'react';
import { vehicleCompliance as vcApi, tenants as tenantsApi } from '../../api';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function RiskBadge({ level }) {
  const styles = {
    low: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    medium: 'bg-amber-100 text-amber-900 border-amber-200',
    high: 'bg-orange-100 text-orange-900 border-orange-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${styles[level] || 'bg-surface-100 text-surface-600 border-surface-200'}`}>
      {level || '—'}
    </span>
  );
}

function TrendBadge({ trend }) {
  if (trend === 'increasing') return <span className="text-xs font-semibold text-red-600">↑ Increasing</span>;
  if (trend === 'decreasing') return <span className="text-xs font-semibold text-emerald-600">↓ Decreasing</span>;
  return <span className="text-xs text-surface-500">Stable</span>;
}

function KpiCard({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'border-surface-200 bg-white',
    warn: 'border-amber-200 bg-amber-50/60',
    danger: 'border-red-200 bg-red-50/60',
    ok: 'border-emerald-200 bg-emerald-50/60',
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone] || tones.default}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-surface-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-surface-900 tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-surface-500">{sub}</p> : null}
    </div>
  );
}

function TruckDetailModal({ truck, readOnly, onClose, onNotify, onSuspend, actionLoading }) {
  if (!truck) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-xl border border-surface-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-surface-200 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-surface-900">{truck.registration}</p>
            <p className="text-sm text-surface-500">{truck.contractor_name}{truck.make_model ? ` · ${truck.make_model}` : ''}</p>
          </div>
          <RiskBadge level={truck.risk_level} />
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Inspection score</p><p className="font-semibold">{truck.inspection_score != null ? `${truck.inspection_score}%` : '—'} <span className="text-surface-500 font-normal">({truck.inspection_rating})</span></p></div>
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Last inspection</p><p className="font-semibold">{fmtDate(truck.last_inspection_date)}</p></div>
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Result</p><p className="font-semibold uppercase">{truck.last_inspection_result || '—'}</p></div>
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Days since</p><p className="font-semibold">{truck.days_since_inspection != null ? truck.days_since_inspection : 'Never'}</p></div>
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Breakdowns (90d)</p><p className="font-semibold">{truck.breakdown_count_90d} <TrendBadge trend={truck.breakdown_trend} /></p></div>
            <div className="rounded-xl bg-surface-50 p-3"><p className="text-xs text-surface-500">Status</p><p className="font-semibold">{truck.is_suspended ? 'Suspended' : 'Active'}</p></div>
          </div>
          {(truck.recommendations || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">Recommendations</p>
              <ul className="space-y-2">
                {truck.recommendations.map((r, i) => (
                  <li key={i} className={`rounded-lg px-3 py-2 text-sm border ${r.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-900' : r.severity === 'high' ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-surface-50 border-surface-200 text-surface-700'}`}>
                    {r.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!readOnly && !truck.is_suspended && (
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button type="button" disabled={actionLoading} onClick={() => onNotify(truck)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-brand-300 text-brand-800 bg-brand-50 hover:bg-brand-100 disabled:opacity-50">
                Notify haulier
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => onSuspend(truck)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${truck.force_suspend ? 'bg-red-600 hover:bg-red-700 ring-2 ring-red-300' : 'bg-surface-800 hover:bg-surface-900'}`}
              >
                {truck.force_suspend ? 'Suspend (required)' : 'Suspend truck'}
              </button>
            </div>
          )}
          {readOnly && (
            <p className="text-xs text-surface-500 italic">View only — contact Access Management or Command Centre to action suspensions.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-surface-200">
          <button type="button" onClick={onClose} className="w-full py-2 rounded-xl text-sm font-medium border border-surface-300">Close</button>
        </div>
      </div>
    </div>
  );
}

function TrucksTable({ trucks, readOnly, onSelect, compact = false }) {
  if (!trucks.length) {
    return <p className="text-sm text-surface-500 py-8 text-center">No trucks match the current filters.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-surface-200">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-50 text-left text-xs uppercase tracking-wider text-surface-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Registration</th>
            {!compact && <th className="px-4 py-3 font-semibold">Haulier</th>}
            <th className="px-4 py-3 font-semibold">Last inspection</th>
            <th className="px-4 py-3 font-semibold">Score</th>
            <th className="px-4 py-3 font-semibold">Breakdowns</th>
            <th className="px-4 py-3 font-semibold">Risk</th>
            {!readOnly && <th className="px-4 py-3 font-semibold">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100 bg-white">
          {trucks.map((t) => (
            <tr key={t.truck_id} className={`hover:bg-surface-50/80 ${t.force_suspend && !t.is_suspended ? 'bg-red-50/40' : ''}`}>
              <td className="px-4 py-3">
                <button type="button" onClick={() => onSelect(t)} className="font-semibold text-brand-700 hover:underline text-left">
                  {t.registration}
                </button>
                {t.is_suspended && <span className="ml-2 text-[10px] font-bold uppercase text-red-600">Suspended</span>}
              </td>
              {!compact && <td className="px-4 py-3 text-surface-600">{t.contractor_name}</td>}
              <td className="px-4 py-3">
                <span className="block">{fmtDate(t.last_inspection_date)}</span>
                {t.overdue && <span className="text-[11px] text-amber-700 font-medium">Overdue</span>}
              </td>
              <td className="px-4 py-3 tabular-nums">
                {t.inspection_score != null ? `${t.inspection_score}%` : '—'}
                {t.failed_inspection && <span className="block text-[11px] text-red-600 font-medium">Failed</span>}
              </td>
              <td className="px-4 py-3">
                <span className="tabular-nums">{t.breakdown_count_90d}</span>
                <span className="block"><TrendBadge trend={t.breakdown_trend} /></span>
              </td>
              <td className="px-4 py-3"><RiskBadge level={t.risk_level} /></td>
              {!readOnly && (
                <td className="px-4 py-3">
                  <button type="button" onClick={() => onSelect(t)} className="text-xs font-semibold text-brand-600 hover:text-brand-800">Review</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param {'dashboard'|'results'|'compliance'} mode
 * @param {boolean} readOnly - Rector view (no suspend/notify)
 * @param {boolean} showTenantFilter - CC multi-tenant
 */
export default function VehicleCompliancePanel({ mode = 'compliance', readOnly = false, showTenantFilter = false, title, subtitle }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [hauliers, setHauliers] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyForceSuspend, setOnlyForceSuspend] = useState(false);
  const [expandedHaulier, setExpandedHaulier] = useState(null);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (tenantId) params.tenantId = tenantId;
    if (contractorId) params.contractorId = contractorId;
    if (riskFilter !== 'all') params.riskLevel = riskFilter;
    if (onlyOverdue) params.overdue = true;
    if (onlyForceSuspend) params.forceSuspend = true;

    const apiCall = mode === 'dashboard'
      ? vcApi.dashboard(params)
      : vcApi.trucks(params);

    apiCall
      .then((r) => {
        setSummary(r.summary || null);
        setHauliers(r.hauliers || []);
        setTrucks(r.trucks || []);
      })
      .catch((e) => setError(e?.message || 'Failed to load vehicle compliance data'))
      .finally(() => setLoading(false));
  }, [mode, tenantId, contractorId, riskFilter, onlyOverdue, onlyForceSuspend]);

  useEffect(() => {
    if (showTenantFilter) {
      tenantsApi.list().then((r) => setTenants(r.tenants || [])).catch(() => setTenants([]));
    }
  }, [showTenantFilter]);

  useEffect(() => { load(); }, [load]);

  const contractorOptions = useMemo(() => {
    const map = new Map();
    trucks.forEach((t) => {
      if (t.contractor_id) map.set(t.contractor_id, t.contractor_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [trucks]);

  const filteredTrucks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trucks;
    return trucks.filter((t) =>
      (t.registration || '').toLowerCase().includes(q)
      || (t.contractor_name || '').toLowerCase().includes(q)
      || (t.fleet_no || '').toLowerCase().includes(q)
    );
  }, [trucks, search]);

  const haulierTrucks = useMemo(() => {
    if (!expandedHaulier) return [];
    return filteredTrucks.filter((t) => String(t.contractor_id) === String(expandedHaulier));
  }, [filteredTrucks, expandedHaulier]);

  const handleNotify = async (truck) => {
    const note = window.prompt('Optional note to include in the email to the haulier:', '');
    if (note === null) return;
    setActionLoading(true);
    try {
      await vcApi.notify(truck.truck_id, { note, reasons: truck.recommendations });
      window.alert('Notification sent to haulier with rectors CC\'d.');
      load();
    } catch (e) {
      window.alert(e?.message || 'Failed to send notification');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async (truck) => {
    const msg = truck.force_suspend
      ? `This truck requires suspension (${truck.registration}). It will be removed from all route lists until reinstated. Continue?`
      : `Suspend ${truck.registration}? It will be removed from route lists until reinstated.`;
    if (!window.confirm(msg)) return;
    const reason = window.prompt('Suspension reason (optional):', truck.recommendations?.[0]?.message || '') ?? '';
    setActionLoading(true);
    try {
      await vcApi.suspend(truck.truck_id, reason || undefined);
      setSelectedTruck(null);
      load();
    } catch (e) {
      window.alert(e?.message || 'Failed to suspend truck');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-900">{title || 'Vehicle compliance'}</h2>
        {subtitle && <p className="text-sm text-surface-500 mt-1">{subtitle}</p>}
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}

      <div className="flex flex-wrap gap-3 items-end">
        {showTenantFilter && (
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Tenant</label>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[160px]">
              <option value="">All tenants</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {mode !== 'dashboard' && (
          <>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Haulier</label>
              <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[160px]">
                <option value="">All hauliers</option>
                {contractorOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Risk</label>
              <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="all">All levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-surface-700 pb-2">
              <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="rounded" />
              Overdue only
            </label>
            {!readOnly && (
              <label className="flex items-center gap-2 text-sm text-surface-700 pb-2">
                <input type="checkbox" checked={onlyForceSuspend} onChange={(e) => setOnlyForceSuspend(e.target.checked)} className="rounded" />
                Mandatory suspension
              </label>
            )}
          </>
        )}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-surface-500 mb-1">Search</label>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Registration, haulier…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-surface-500 animate-pulse">Loading compliance data…</div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiCard label="Total trucks" value={summary.total_trucks} />
              <KpiCard label="Inspected" value={summary.inspected} sub={`${summary.total_trucks ? Math.round((summary.inspected / summary.total_trucks) * 100) : 0}% coverage`} tone="ok" />
              <KpiCard label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? 'warn' : 'default'} />
              <KpiCard label="Failed last" value={summary.failed} tone={summary.failed > 0 ? 'danger' : 'default'} />
              <KpiCard label="High / critical" value={(summary.high_risk || 0) + (summary.critical_risk || 0)} tone="warn" />
              <KpiCard label="Avg score" value={summary.avg_score != null ? `${summary.avg_score}%` : '—'} />
              {!readOnly && summary.force_suspend > 0 && (
                <KpiCard label="Must suspend" value={summary.force_suspend} tone="danger" sub="Failed score or rising breakdowns" />
              )}
            </div>
          )}

          {mode === 'dashboard' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-500">By haulier</h3>
              {hauliers.length === 0 ? (
                <p className="text-sm text-surface-500">No haulier data available.</p>
              ) : (
                hauliers.map((h) => (
                  <div key={h.contractor_id || h.contractor_name} className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedHaulier((c) => (c === h.contractor_id ? null : h.contractor_id))}
                      className="w-full px-5 py-4 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-surface-50"
                    >
                      <div>
                        <p className="font-semibold text-surface-900">{h.contractor_name}</p>
                        <p className="text-xs text-surface-500 mt-0.5">{h.truck_count} trucks · avg score {h.avg_score != null ? `${h.avg_score}%` : '—'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {h.overdue_count > 0 && <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-1 font-medium">{h.overdue_count} overdue</span>}
                        {h.failed_count > 0 && <span className="rounded-full bg-red-100 text-red-800 px-2 py-1 font-medium">{h.failed_count} failed</span>}
                        {h.critical_risk_count > 0 && <span className="rounded-full bg-red-600 text-white px-2 py-1 font-medium">{h.critical_risk_count} critical</span>}
                        {h.suspended_count > 0 && <span className="rounded-full bg-surface-800 text-white px-2 py-1 font-medium">{h.suspended_count} suspended</span>}
                      </div>
                    </button>
                    {expandedHaulier === h.contractor_id && (
                      <div className="border-t border-surface-100 px-2 pb-2">
                        <TrucksTable trucks={haulierTrucks} readOnly={readOnly} onSelect={setSelectedTruck} compact />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {(mode === 'results' || mode === 'compliance') && (
            <TrucksTable trucks={filteredTrucks} readOnly={readOnly} onSelect={setSelectedTruck} />
          )}
        </>
      )}

      <TruckDetailModal
        truck={selectedTruck}
        readOnly={readOnly}
        onClose={() => setSelectedTruck(null)}
        onNotify={handleNotify}
        onSuspend={handleSuspend}
        actionLoading={actionLoading}
      />
    </div>
  );
}
