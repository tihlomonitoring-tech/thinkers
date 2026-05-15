import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { commandCentre as ccApi, tenants as tenantsApi, downloadAttachmentWithAuth } from '../api';
import InfoHint from '../components/InfoHint.jsx';

export default function TabAtomicFleetVerification() {
  const { user } = useAuth();
  const [tenantOptions, setTenantOptions] = useState([]);
  const [tenantId, setTenantId] = useState(user?.tenant_id || '');
  const [contractorOptions, setContractorOptions] = useState([]);
  const [contractorId, setContractorId] = useState('all');
  const [contractorsLoading, setContractorsLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [viewSheet, setViewSheet] = useState('atomic');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    const allowed = new Set([...(user?.tenant_ids || []), user?.tenant_id].filter(Boolean));
    tenantsApi
      .list()
      .then((d) => {
        const rows = (d?.tenants || []).filter((t) => allowed.has(t.id));
        setTenantOptions(rows);
        if (!tenantId && rows[0]?.id) setTenantId(rows[0].id);
      })
      .catch(() => setTenantOptions([]));
  }, [user?.tenant_id, user?.tenant_ids, tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setContractorOptions([]);
      return;
    }
    setContractorsLoading(true);
    ccApi.atomicFleetVerification
      .contractors(tenantId)
      .then((d) => setContractorOptions(Array.isArray(d?.contractors) ? d.contractors : []))
      .catch(() => setContractorOptions([]))
      .finally(() => setContractorsLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (!loading) return undefined;
    const stages = [
      'Uploading Atomic fleet workbook…',
      'Detecting Atomic export columns…',
      'AI is mapping headers…',
      'Matching trucks against Thinkers fleet…',
      'Finding gaps (on system only)…',
      'Building verified workbook…',
    ];
    let i = 0;
    setStatusText(stages[0]);
    const t = setInterval(() => {
      i = Math.min(stages.length - 1, i + 1);
      setStatusText(stages[i]);
    }, 700);
    return () => clearInterval(t);
  }, [loading]);

  const onVerify = async (e) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await ccApi.atomicFleetVerification.verify(
        file,
        tenantId || undefined,
        contractorId && contractorId !== 'all' ? contractorId : 'all'
      );
      setResult(data);
      setStatusText(`Done in ${data.elapsed_ms || 0} ms`);
      setViewSheet('atomic');
      setStatusFilter('all');
      setSearchText('');
    } catch (err) {
      setError(err?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const selectedRows = useMemo(() => {
    if (!result) return [];
    return viewSheet === 'system_only'
      ? (result.results?.on_system_only || [])
      : (result.results?.atomic || []);
  }, [result, viewSheet]);

  const filteredRows = useMemo(() => selectedRows.filter((r) => {
    if (statusFilter === 'on_system' && r.system_status !== 'On our system') return false;
    if (statusFilter === 'not_on_system' && r.system_status !== 'Not on our system' && r.system_status !== 'On our system only') return false;
    if (statusFilter === 'atomic_integrated' && r.atomic_status !== 'Integrated on Atomic') return false;
    if (statusFilter === 'atomic_not_integrated' && r.atomic_status !== 'Not integrated on Atomic') return false;
    if (!searchText.trim()) return true;
    const needle = searchText.trim().toLowerCase();
    const hay = [
      r.contractor, r.sub_contractor, r.fleet_no, r.registration,
      r.trailer_1_reg, r.trailer_2_reg, r.atomic_status, r.system_status, r.notes,
      r.last_location_atomic,
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase())
      .join(' ');
    return hay.includes(needle);
  }), [selectedRows, statusFilter, searchText]);

  const sortedFilteredRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      const c1 = String(a.contractor || '').toLowerCase();
      const c2 = String(b.contractor || '').toLowerCase();
      if (c1 !== c2) return c1.localeCompare(c2);
      const s1 = String(a.sub_contractor || '').toLowerCase();
      const s2 = String(b.sub_contractor || '').toLowerCase();
      if (s1 !== s2) return s1.localeCompare(s2);
      return String(a.registration || a.fleet_no || '').localeCompare(String(b.registration || b.fleet_no || ''), undefined, { sensitivity: 'base' });
    });
    return rows;
  }, [filteredRows]);

  const groupedByContractor = useMemo(() => {
    const map = new Map();
    for (const r of sortedFilteredRows) {
      const key = (r.contractor || '').trim() || 'Unassigned contractor';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    const groupNames = [...map.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return groupNames.map((name) => ({ name, rows: map.get(name) }));
  }, [sortedFilteredRows]);

  const summary = result?.summary || {};
  const isAllContractors = result?.haulier?.check_all;
  const haulierLabel = result?.haulier?.label || 'Selected contractor';

  const statusBadge = (r) => {
    const sys = r.system_status || '';
    if (sys === 'On our system') return 'bg-emerald-100 text-emerald-800';
    if (sys === 'On our system only') return 'bg-red-100 text-red-800';
    return 'bg-amber-100 text-amber-800';
  };

  const atomicBadge = (r) => {
    if (r.atomic_status === 'Integrated on Atomic') return 'bg-emerald-100 text-emerald-800';
    if (r.atomic_status === 'Not integrated on Atomic') return 'bg-amber-100 text-amber-800';
    if (r.atomic_status === 'Not on Atomic export') return 'bg-red-100 text-red-800';
    return 'bg-slate-100 text-slate-700';
  };

  const renderRow = (r, key) => (
    <tr key={key} className="border-b border-surface-100 hover:bg-surface-50">
      <td className="px-3 py-2 text-surface-700">{r.contractor || '—'}</td>
      <td className="px-3 py-2 text-surface-700">{r.sub_contractor || '—'}</td>
      <td className="px-3 py-2 font-medium text-surface-900">{r.fleet_no || '—'}</td>
      <td className="px-3 py-2 font-medium text-surface-900">{r.registration || '—'}</td>
      <td className="px-3 py-2 text-surface-700">{r.trailer_1_reg || '—'}</td>
      <td className="px-3 py-2 text-surface-700">{r.trailer_2_reg || '—'}</td>
      {viewSheet === 'atomic' ? (
        <td className="px-3 py-2 text-surface-600 text-xs">{r.last_location_atomic || '—'}</td>
      ) : null}
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${atomicBadge(r)}`}>
          {r.atomic_status || '—'}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(r)}`}>
          {r.system_status || '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-surface-600 text-xs">{r.notes || '—'}</td>
    </tr>
  );

  const colSpan = viewSheet === 'atomic' ? 10 : 9;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-surface-900">Atomic fleet verification (AI)</h2>
        <InfoHint
          title="Atomic fleet verification"
          text="Upload the Atomic fleet Excel export. A truck is integrated on Atomic only when LastLocationDatetimeString has a value — if that cell is blank, it is not integrated on Atomic. We also match each row to your Thinkers fleet for system enrollment."
        />
      </div>

      <form onSubmit={onVerify} className="app-glass-card p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Tenant scope</label>
            <select
              value={tenantId}
              onChange={(e) => { setTenantId(e.target.value); setContractorId('all'); }}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            >
              <option value="">My default tenant</option>
              {tenantOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Contractor filter (Thinkers match)</label>
            <select
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              disabled={contractorsLoading}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="all">All contractors</option>
              {contractorOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{Number.isFinite(c.truck_count) ? ` · ${c.truck_count} trucks` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Atomic fleet Excel (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-surface-500">
          Template columns: VehicleDescr, RegistrationNumber, Trailer1RegistrationNumber, Trailer2RegistrationNumber, ParentOwnership, Ownership, LastLocationDatetimeString.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!file || loading}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify Atomic fleet'}
          </button>
          {loading ? (
            <div className="flex-1 min-w-[240px]">
              <div className="h-2 rounded-full bg-surface-100 overflow-hidden">
                <div className="h-full w-1/2 bg-brand-500 animate-pulse" />
              </div>
              <p className="text-xs text-surface-600 mt-1">{statusText}</p>
            </div>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>

      {result ? (
        <div className="space-y-4">
          {Array.isArray(result.warnings) && result.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
              <p className="font-semibold">Heads up</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="app-glass-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-surface-900">Verification complete</p>
                <p className="text-xs text-surface-600 mt-1">
                  Atomic sheet: <span className="font-semibold">{result.detected?.sheet || result.detected?.sheets?.atomic || '—'}</span>
                  {result.detected?.header_row != null ? ` (header row ${result.detected.header_row})` : null}
                  {' · '}Matched against <span className="font-semibold">{haulierLabel}</span>
                </p>
                {(result.detected?.all_sheets?.length || result.detected?.sheets?.all_sheets?.length) ? (
                  <p className="text-xs text-surface-500 mt-1">
                    Workbook tabs: {(result.detected?.all_sheets || result.detected?.sheets?.all_sheets || []).join(', ')}
                  </p>
                ) : null}
                {result.detected?.columns ? (
                  <details className="mt-2 text-xs text-surface-600">
                    <summary className="cursor-pointer select-none">Detected columns</summary>
                    <div className="mt-2 rounded-md border border-surface-200 bg-white px-3 py-2 space-y-0.5">
                      {Object.entries(result.detected.columns).map(([k, v]) => (
                        <p key={k}>
                          {k.replace(/_/g, ' ')}: <span className="font-medium text-surface-900">{v || '—'}</span>
                        </p>
                      ))}
                    </div>
                  </details>
                ) : null}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs">
                  <div className="rounded-md border border-surface-200 bg-white px-3 py-2">
                    <div className="text-surface-500">Atomic rows</div>
                    <div className="font-semibold text-base text-surface-900">{summary.total_atomic_rows ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <div className="text-emerald-700">Integrated on Atomic</div>
                    <div className="font-semibold text-base text-emerald-900">{summary.integrated_on_atomic ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="text-amber-700">Not integrated on Atomic</div>
                    <div className="font-semibold text-base text-amber-900">{summary.not_integrated_on_atomic ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                    <div className="text-sky-700">On our system</div>
                    <div className="font-semibold text-base text-sky-900">{summary.on_system ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="text-amber-700">Not on our system</div>
                    <div className="font-semibold text-base text-amber-900">{summary.not_on_system ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <div className="text-red-700">On Thinkers only</div>
                    <div className="font-semibold text-base text-red-900">{summary.on_system_only ?? 0}</div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => downloadAttachmentWithAuth(
                  ccApi.atomicFleetVerification.downloadUrl(result.token),
                  result.file_name || 'atomic-fleet-verified.xlsx'
                )}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                Download verified workbook
              </button>
            </div>
            <p className="text-[11px] text-surface-500 mt-2">
              AI mapping: {result.ai?.used ? `enabled (${result.ai?.model || 'model'})` : 'rule-based header detection'}.
            </p>
          </div>

          <div className="app-glass-card p-0 overflow-hidden">
            <div className="px-4 pt-4 flex flex-wrap items-center gap-2 border-b border-surface-100 pb-3">
              <div className="inline-flex rounded-lg border border-surface-200 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => { setViewSheet('atomic'); setStatusFilter('all'); }}
                  className={`px-3 py-1.5 ${viewSheet === 'atomic' ? 'bg-brand-600 text-white' : 'bg-white text-surface-700'}`}
                >
                  Atomic fleet ({summary.total_atomic_rows ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => { setViewSheet('system_only'); setStatusFilter('all'); }}
                  className={`px-3 py-1.5 border-l border-surface-200 ${viewSheet === 'system_only' ? 'bg-brand-600 text-white' : 'bg-white text-surface-700'}`}
                >
                  On Thinkers only ({summary.on_system_only ?? 0})
                </button>
              </div>
              <div className="inline-flex rounded-lg border border-surface-200 overflow-hidden text-xs">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'on_system', label: 'On system' },
                  { id: 'not_on_system', label: 'Not on system' },
                  { id: 'atomic_integrated', label: 'Integrated (Atomic)' },
                  { id: 'atomic_not_integrated', label: 'Not integrated (Atomic)' },
                ].map((opt, i) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusFilter(opt.id)}
                    className={`px-3 py-1.5 ${i > 0 ? 'border-l border-surface-200' : ''} ${statusFilter === opt.id ? 'bg-surface-900 text-white' : 'bg-white text-surface-700'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search registration, contractor, fleet no…"
                className="ml-auto rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-full max-w-xs"
              />
            </div>

            <div className="overflow-auto max-h-[60vh]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#1e40af] text-white sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Contractor</th>
                    <th className="text-left px-3 py-2 font-semibold">Sub-contractor</th>
                    <th className="text-left px-3 py-2 font-semibold">Fleet no / vehicle</th>
                    <th className="text-left px-3 py-2 font-semibold">Registration</th>
                    <th className="text-left px-3 py-2 font-semibold">Trailer 1</th>
                    <th className="text-left px-3 py-2 font-semibold">Trailer 2</th>
                    {viewSheet === 'atomic' ? (
                      <th className="text-left px-3 py-2 font-semibold">Last location</th>
                    ) : null}
                    <th className="text-left px-3 py-2 font-semibold">Atomic integration</th>
                    <th className="text-left px-3 py-2 font-semibold">On our system</th>
                    <th className="text-left px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {isAllContractors && viewSheet === 'atomic' ? (
                    groupedByContractor.length === 0 ? (
                      <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-surface-500">No rows match filters.</td></tr>
                    ) : (
                      groupedByContractor.map((g) => (
                        <Fragment key={g.name}>
                          <tr>
                            <td colSpan={colSpan} className="px-3 py-2 text-center font-semibold uppercase tracking-wide" style={{ background: '#948A54', color: 'white' }}>
                              {g.name}
                            </td>
                          </tr>
                          {g.rows.map((r, idx) => renderRow(r, `${g.name}-${idx}`))}
                        </Fragment>
                      ))
                    )
                  ) : sortedFilteredRows.length === 0 ? (
                    <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-surface-500">No rows match filters.</td></tr>
                  ) : (
                    sortedFilteredRows.map((r, idx) => renderRow(r, idx))
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-surface-100 text-xs text-surface-500">
              Showing {filteredRows.length} of {selectedRows.length} rows
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
