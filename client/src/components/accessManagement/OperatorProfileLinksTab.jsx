import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contractor as contractorApi, operatorManagement as opMgmtApi } from '../../api';
import InfoHint from '../InfoHint.jsx';

function driverDisplayName(d) {
  return d.full_name || [d.full_name, d.surname].filter(Boolean).join(' ') || '—';
}

/**
 * Access Management → Operator profile links.
 * Links approved & enrolled contractor drivers to their operator-profile user account.
 * Access Management users have authority to link directly (no approval workflow).
 */
export default function OperatorProfileLinksTab({ hasTenant }) {
  const [drivers, setDrivers] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | linked | unlinked

  const [pickerDriverId, setPickerDriverId] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const pickerRef = useRef(null);

  const [perfDriverId, setPerfDriverId] = useState(null);
  const [perfCache, setPerfCache] = useState({}); // userId -> { loading, productivity }

  const load = useCallback(() => {
    if (!hasTenant) return;
    setLoading(true);
    setError('');
    Promise.all([contractorApi.operatorLinks.eligibleDrivers(), contractorApi.operatorLinks.linkableUsers()])
      .then(([d, u]) => {
        setDrivers(d.drivers || []);
        setUsers(u.users || []);
      })
      .catch((err) => setError(err?.message || 'Failed to load drivers'))
      .finally(() => setLoading(false));
  }, [hasTenant]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onClick = (e) => {
      if (pickerRef.current?.contains(e.target)) return;
      setPickerDriverId(null);
      setUserSearch('');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const stats = useMemo(() => {
    const total = drivers.length;
    const linked = drivers.filter((d) => d.linked_user_id).length;
    return { total, linked, unlinked: total - linked };
  }, [drivers]);

  const linkedUserIds = useMemo(
    () => new Set(drivers.filter((d) => d.linked_user_id).map((d) => String(d.linked_user_id).toLowerCase())),
    [drivers]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers.filter((d) => {
      if (filter === 'linked' && !d.linked_user_id) return false;
      if (filter === 'unlinked' && d.linked_user_id) return false;
      if (!q) return true;
      return (
        driverDisplayName(d).toLowerCase().includes(q) ||
        String(d.id_number || '').toLowerCase().includes(q) ||
        String(d.license_number || '').toLowerCase().includes(q) ||
        String(d.linked_truck_registration || '').toLowerCase().includes(q) ||
        String(d.contractor_name || '').toLowerCase().includes(q) ||
        String(d.subcontractor_company_name || '').toLowerCase().includes(q) ||
        String(d.linked_user_name || '').toLowerCase().includes(q)
      );
    });
  }, [drivers, search, filter]);

  const usersForPicker = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users
      .filter((u) => !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [users, userSearch]);

  const applyLink = (driver, userId) => {
    setSavingId(driver.id);
    setError('');
    setInfo('');
    contractorApi.operatorLinks
      .setLink(driver.id, userId)
      .then((res) => {
        const updated = res.driver || {};
        setDrivers((prev) =>
          prev.map((d) =>
            String(d.id) === String(driver.id)
              ? { ...d, linked_user_id: updated.linked_user_id ?? null, linked_user_name: updated.linked_user_name ?? null, linked_user_email: updated.linked_user_email ?? null }
              : d
          )
        );
        setInfo(userId ? `Linked ${driverDisplayName(driver)} to ${updated.linked_user_name || 'operator'}.` : `Unlinked ${driverDisplayName(driver)}.`);
        setPickerDriverId(null);
        setUserSearch('');
      })
      .catch((err) => setError(err?.message || 'Failed to update link'))
      .finally(() => setSavingId(null));
  };

  const togglePerf = (driver) => {
    if (perfDriverId === driver.id) {
      setPerfDriverId(null);
      return;
    }
    setPerfDriverId(driver.id);
    const uid = driver.linked_user_id;
    if (!uid || perfCache[uid]) return;
    setPerfCache((p) => ({ ...p, [uid]: { loading: true } }));
    opMgmtApi.productivity
      .get(uid, 90)
      .then((r) => setPerfCache((p) => ({ ...p, [uid]: { loading: false, productivity: r.productivity || null } })))
      .catch(() => setPerfCache((p) => ({ ...p, [uid]: { loading: false, productivity: null } })));
  };

  if (!hasTenant) return <p className="text-sm text-surface-500">Operator profile links require a tenant.</p>;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Operator profile links</h1>
          <InfoHint
            title="Operator profile links"
            text="Link an approved & enrolled driver to their operator-profile user account. This surfaces the driver's productivity score and logistics/tracker activity against their operator profile. Access Management users can link directly — no approval is required."
          />
        </div>
        <p className="text-sm text-surface-500 mt-1">Only approved &amp; enrolled drivers appear here. Each operator can be linked to one driver.</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {info && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-2 flex justify-between items-center">
          <span>{info}</span>
          <button type="button" onClick={() => setInfo('')}>Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 max-w-xl">
        {[
          { label: 'Eligible drivers', value: stats.total, tone: 'text-surface-900' },
          { label: 'Linked', value: stats.linked, tone: 'text-green-700' },
          { label: 'Unlinked', value: stats.unlinked, tone: 'text-amber-700' },
        ].map((c) => (
          <div key={c.label} className="app-glass-card p-3 text-center">
            <p className={`text-2xl font-bold ${c.tone}`}>{c.value}</p>
            <p className="text-xs text-surface-500 uppercase tracking-wide">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs font-medium text-surface-600">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Driver, ID, licence, truck, contractor, operator…"
            className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-full"
          />
        </label>
        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-xs font-medium text-surface-600">Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="linked">Linked only</option>
            <option value="unlinked">Unlinked only</option>
          </select>
        </label>
        <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-surface-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-surface-500">No approved &amp; enrolled drivers match your filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-200 text-left">
                <th className="p-2 font-medium text-surface-700">Driver</th>
                <th className="p-2 font-medium text-surface-700">ID number</th>
                <th className="p-2 font-medium text-surface-700">Linked truck</th>
                <th className="p-2 font-medium text-surface-700">Contractor</th>
                <th className="p-2 font-medium text-surface-700">Operator profile</th>
                <th className="p-2 font-medium text-surface-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const isPicker = pickerDriverId === d.id;
                const isPerf = perfDriverId === d.id;
                const perf = d.linked_user_id ? perfCache[d.linked_user_id] : null;
                return (
                  <Fragment key={d.id}>
                    <tr className="border-b border-surface-100 align-top">
                      <td className="p-2">
                        <div className="font-medium text-surface-900">{driverDisplayName(d)}</div>
                        {d.compliance_blocked && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800">Compliance blocked</span>
                        )}
                      </td>
                      <td className="p-2 text-surface-600 font-mono text-xs">{d.id_number || '—'}</td>
                      <td className="p-2 text-surface-600">{d.linked_truck_registration || '—'}</td>
                      <td className="p-2 text-surface-600">
                        {d.contractor_name || '—'}
                        {d.subcontractor_company_name && <span className="block text-xs text-surface-400">{d.subcontractor_company_name}</span>}
                      </td>
                      <td className="p-2">
                        {d.linked_user_id ? (
                          <span className="inline-flex flex-col">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 w-fit">
                              {d.linked_user_name || 'Linked operator'}
                            </span>
                            {d.linked_user_email && <span className="text-xs text-surface-400 mt-0.5">{d.linked_user_email}</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-surface-400">Not linked</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center justify-end gap-2 relative">
                          {d.linked_user_id && (
                            <button
                              type="button"
                              onClick={() => togglePerf(d)}
                              className="text-xs font-medium text-brand-700 hover:underline whitespace-nowrap"
                            >
                              {isPerf ? 'Hide' : 'Performance'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={savingId === d.id}
                            onClick={(e) => { e.stopPropagation(); setPickerDriverId(isPicker ? null : d.id); setUserSearch(''); }}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 whitespace-nowrap"
                          >
                            {d.linked_user_id ? 'Change' : 'Link'}
                          </button>
                          {d.linked_user_id && (
                            <button
                              type="button"
                              disabled={savingId === d.id}
                              onClick={() => applyLink(d, null)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-surface-300 text-red-600 hover:bg-red-50 disabled:opacity-40 whitespace-nowrap"
                            >
                              Unlink
                            </button>
                          )}
                          {isPicker && (
                            <div ref={pickerRef} className="absolute right-0 top-8 z-30 w-72 rounded-lg border border-surface-200 bg-white shadow-xl p-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                autoFocus
                                value={userSearch}
                                onChange={(e) => setUserSearch(e.target.value)}
                                placeholder="Search operator by name or email…"
                                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-1"
                              />
                              <ul className="max-h-56 overflow-auto text-sm">
                                {usersForPicker.length === 0 ? (
                                  <li className="px-3 py-2 text-surface-500">No users match</li>
                                ) : (
                                  usersForPicker.map((u) => {
                                    const takenElsewhere = linkedUserIds.has(String(u.id).toLowerCase()) && String(d.linked_user_id || '').toLowerCase() !== String(u.id).toLowerCase();
                                    return (
                                      <li key={u.id}>
                                        <button
                                          type="button"
                                          disabled={takenElsewhere}
                                          onClick={() => applyLink(d, u.id)}
                                          className="w-full text-left px-3 py-2 rounded hover:bg-surface-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                          title={takenElsewhere ? 'Already linked to another driver' : ''}
                                        >
                                          <span className="font-medium text-surface-900">{u.full_name || '—'}</span>
                                          {u.email && <span className="text-surface-500"> · {u.email}</span>}
                                          {takenElsewhere && <span className="block text-[11px] text-amber-600">Already linked</span>}
                                        </button>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isPerf && d.linked_user_id && (
                      <tr className="bg-surface-50/60 border-b border-surface-100">
                        <td colSpan={6} className="p-3">
                          {perf?.loading ? (
                            <p className="text-xs text-surface-500">Loading performance…</p>
                          ) : perf?.productivity ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
                              {[
                                { label: 'Overall', value: `${perf.productivity.overall_score ?? 0}%`, tone: 'text-violet-700' },
                                { label: 'Deliveries', value: perf.productivity.total_deliveries ?? 0, tone: 'text-surface-900' },
                                { label: 'On-time', value: `${perf.productivity.delivery_score ?? 0}%`, tone: 'text-green-700' },
                                { label: 'Attendance', value: `${perf.productivity.attendance_score ?? 0}%`, tone: 'text-blue-700' },
                              ].map((c) => (
                                <div key={c.label} className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-center">
                                  <p className={`text-lg font-bold ${c.tone}`}>{c.value}</p>
                                  <p className="text-[11px] text-surface-500 uppercase tracking-wide">{c.label}</p>
                                </div>
                              ))}
                              <p className="col-span-2 sm:col-span-4 text-[11px] text-surface-400">Last 90 days — from the operator profile's logged deliveries, schedules and clock records.</p>
                            </div>
                          ) : (
                            <p className="text-xs text-surface-500">No productivity data recorded for this operator yet.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
