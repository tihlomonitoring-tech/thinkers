import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import { officeAdmin, users as usersApi } from './api';
import { OA_TABS, OA_TAB_IDS, REQUEST_TYPES } from './lib/officeAdminTabs.js';
import OfficeAdminAssetRegister from './components/officeAdmin/OfficeAdminAssetRegister.jsx';
import OfficeAdminConsumables from './components/officeAdmin/OfficeAdminConsumables.jsx';
import OfficeAdminMaintenance from './components/officeAdmin/OfficeAdminMaintenance.jsx';
import { MAINTENANCE_TAB_IDS } from './lib/officeAdminTabs.js';

const inputClass = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm';
const btnPrimary = 'px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 text-sm rounded-lg border border-surface-300 hover:bg-surface-50';

function TabIcon({ name, className = 'w-5 h-5' }) {
  const p = (d) => (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
  );
  const icons = {
    dashboard: p('M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z'),
    box: p('M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'),
    cup: p('M5 11h14M5 11l1-4h12l1 4M8 15h8M6 19h12'),
    wrench: p('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'),
    inbox: p('M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4'),
    manager: p('M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z'),
    calc: p('M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z'),
    settings: p('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'),
    history: p('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'),
    alert: p('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'),
  };
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {icons[name] || icons.dashboard}
    </svg>
  );
}

function ManageTabAccess({ isSuperAdmin, permissions, setPermissions, users, setUsers }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    Promise.all([officeAdmin.permissions(), usersApi.list({ limit: 200 })])
      .then(([p, u]) => {
        setPermissions(p.permissions || []);
        setUsers(u.users || []);
      })
      .finally(() => setLoading(false));
  }, [isSuperAdmin, setPermissions, setUsers]);

  if (!isSuperAdmin) {
    return <p className="text-sm text-surface-500">Only super admins can manage Office Admin tab access.</p>;
  }
  if (loading) return <p className="text-surface-500">Loading…</p>;

  const permByUser = (permissions || []).reduce((acc, p) => {
    acc[p.user_id] = p;
    return acc;
  }, {});

  return (
    <div className="overflow-x-auto app-glass-card">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b bg-surface-50">
            <th className="px-4 py-3 text-left">User</th>
            {OA_TAB_IDS.map((id) => (
              <th key={id} className="px-2 py-3 text-left text-xs whitespace-nowrap">
                {OA_TABS.find((t) => t.id === id)?.label || id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(users || []).map((u) => {
            const grants = permByUser[u.id]?.tabs || [];
            return (
              <tr key={u.id} className="border-b border-surface-100">
                <td className="px-4 py-2">
                  <div className="font-medium">{u.full_name || u.email}</div>
                  <div className="text-xs text-surface-500">{u.email}</div>
                </td>
                {OA_TAB_IDS.map((tabId) => {
                  const has = grants.includes(tabId);
                  const key = `${u.id}-${tabId}`;
                  return (
                    <td key={key} className="px-2 py-2">
                      <button
                        type="button"
                        disabled={saving === key}
                        className={`text-xs px-2 py-1 rounded ${has ? 'bg-brand-100 text-brand-800' : 'border border-surface-300'}`}
                        onClick={() => {
                          setSaving(key);
                          (has ? officeAdmin.revokePermission : officeAdmin.grantPermission)(u.id, tabId)
                            .then(() =>
                              setPermissions((prev) => {
                                const next = prev.map((p) =>
                                  p.user_id === u.id
                                    ? {
                                        ...p,
                                        tabs: has
                                          ? (p.tabs || []).filter((t) => t !== tabId)
                                          : [...(p.tabs || []), tabId],
                                      }
                                    : p
                                );
                                if (!has && !next.find((p) => p.user_id === u.id)) {
                                  next.push({ user_id: u.id, tabs: [tabId] });
                                }
                                return next;
                              })
                            )
                            .finally(() => setSaving(null));
                        }}
                      >
                        {has ? 'Revoke' : 'Grant'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OfficeAdmin() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [navHidden, setNavHidden] = useSecondaryNavHidden('office-admin');
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [assetCategories, setAssetCategories] = useState([]);
  const [assetSearch, setAssetSearch] = useState('');
  const [consumables, setConsumables] = useState([]);
  const [maintReports, setMaintReports] = useState([]);
  const [maintRecords, setMaintRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [inbox, setInbox] = useState(null);
  const [acctItems, setAcctItems] = useState([]);
  const [acctSuppliers, setAcctSuppliers] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [grantUsers, setGrantUsers] = useState([]);

  const [requestForm, setRequestForm] = useState({
    request_type: 'supplies',
    title: '',
    description: '',
    priority: 'medium',
  });
  const [managerNotes, setManagerNotes] = useState({});

  const sections = useMemo(() => [...new Set(OA_TABS.map((t) => t.section))], []);
  const navTabs = OA_TABS.filter((t) => allowedTabs.includes(t.id));
  const canSee = (id) => allowedTabs.includes(id);

  const loadCore = useCallback(async () => {
    setError('');
    const [dash, a, cats, c, mr, mrec, req, mgr] = await Promise.allSettled([
      officeAdmin.dashboard(),
      officeAdmin.assets.list(assetSearch || undefined),
      officeAdmin.assetCategories.list(),
      officeAdmin.consumables.list(),
      officeAdmin.maintenance.reports(),
      officeAdmin.maintenance.records(),
      officeAdmin.requests.list(),
      officeAdmin.manager.inbox(),
    ]);
    if (dash.status === 'fulfilled') setSummary(dash.value.summary);
    if (a.status === 'fulfilled') setAssets(a.value.assets || []);
    if (cats.status === 'fulfilled') setAssetCategories(cats.value.categories || []);
    if (c.status === 'fulfilled') setConsumables(c.value.consumables || []);
    if (mr.status === 'fulfilled') setMaintReports(mr.value.reports || []);
    if (mrec.status === 'fulfilled') setMaintRecords(mrec.value.records || []);
    if (req.status === 'fulfilled') setRequests(req.value.requests || []);
    if (mgr.status === 'fulfilled') setInbox(mgr.value);
  }, [assetSearch]);

  useEffect(() => {
    officeAdmin
      .myTabs()
      .then((r) => {
        const tabs = r.tabs?.length ? r.tabs : OA_TAB_IDS;
        setAllowedTabs(tabs);
        if (!tabs.includes(activeTab)) {
          if (activeTab === 'maintenance' && tabs.some((t) => MAINTENANCE_TAB_IDS.includes(t))) {
            setActiveTab('maintenance_reports');
          } else {
            setActiveTab(tabs[0] || 'dashboard');
          }
        }
      })
      .catch(() => setAllowedTabs(OA_TAB_IDS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading && allowedTabs.length) loadCore();
  }, [loading, allowedTabs, loadCore]);

  useEffect(() => {
    if (activeTab === 'accounting_link') {
      officeAdmin.accounting.items().then((r) => setAcctItems(r.items || [])).catch(() => setAcctItems([]));
      officeAdmin.accounting.suppliers().then((r) => setAcctSuppliers(r.suppliers || [])).catch(() => setAcctSuppliers([]));
    }
  }, [activeTab]);

  useAutoHideNavAfterTabChange(activeTab, setNavHidden);

  const flash = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 4000);
  };

  if (loading) {
    return <div className="p-8 text-surface-500">Loading Office Admin…</div>;
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <aside
        className={`${navHidden ? 'w-0 overflow-hidden' : 'w-56'} shrink-0 border-r border-surface-200 bg-white/80 dark:bg-surface-900/80 transition-all`}
      >
        <div className="p-4 border-b">
          <h1 className="font-bold text-surface-900">Office Admin</h1>
          <p className="text-xs text-surface-500 mt-1">Assets, supplies & requests</p>
        </div>
        <nav className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {sections.map((section) => {
            const items = navTabs.filter((t) => t.section === section);
            if (!items.length) return null;
            return (
              <div key={section}>
                <p className="px-2 text-xs font-semibold text-surface-400 uppercase mb-1">{section}</p>
                {items.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-0.5 ${
                      activeTab === tab.id ? 'bg-brand-100 text-brand-800 font-medium' : 'text-surface-700 hover:bg-surface-100'
                    }`}
                  >
                    <TabIcon name={tab.icon} className="w-4 h-4 shrink-0" />
                    {tab.label}
                    {tab.id === 'office_manager' && inbox && (
                      <span className="ml-auto text-xs bg-amber-500 text-white px-1.5 rounded-full">
                        {(inbox.maintenance_reports?.length || 0) + (inbox.office_requests?.length || 0)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>}
        {message && <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">{message}</div>}

        {activeTab === 'dashboard' && canSee('dashboard') && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Dashboard</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Assets', summary?.assets],
                ['Consumables', summary?.consumables],
                ['Low stock', summary?.consumables_low_stock],
                ['Open maintenance', summary?.maintenance_open],
                ['Pending requests', summary?.requests_pending],
              ].map(([label, val]) => (
                <div key={label} className="app-glass-card p-4">
                  <p className="text-xs text-surface-500 uppercase">{label}</p>
                  <p className="text-2xl font-semibold mt-1">{val ?? '—'}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-surface-600">
              Use the sidebar to manage the asset register, coffee/tea stock, report broken equipment, submit office
              requests, and respond as office manager.
            </p>
          </div>
        )}

        {activeTab === 'asset_register' && canSee('asset_register') && (
          <OfficeAdminAssetRegister
            assets={assets}
            assetCategories={assetCategories}
            assetSearch={assetSearch}
            setAssetSearch={setAssetSearch}
            onReload={loadCore}
            onError={setError}
            onFlash={flash}
          />
        )}

        {activeTab === 'consumables' && canSee('consumables') && (
          <OfficeAdminConsumables
            consumables={consumables}
            onReload={loadCore}
            onError={setError}
            onFlash={flash}
          />
        )}

        {MAINTENANCE_TAB_IDS.includes(activeTab) && canSee(activeTab) && (
          <OfficeAdminMaintenance
            view={activeTab}
            assets={assets}
            reports={maintReports}
            records={maintRecords}
            onReload={loadCore}
            onError={setError}
            onFlash={flash}
          />
        )}

        {activeTab === 'office_requests' && canSee('office_requests') && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Office requests</h2>
            <div className="app-glass-card p-4 grid gap-3 sm:grid-cols-2">
              <select className={inputClass} value={requestForm.request_type} onChange={(e) => setRequestForm((f) => ({ ...f, request_type: e.target.value }))}>
                {REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input className={inputClass} placeholder="Title" value={requestForm.title} onChange={(e) => setRequestForm((f) => ({ ...f, title: e.target.value }))} />
              <textarea className={`${inputClass} sm:col-span-2`} rows={3} placeholder="Details" value={requestForm.description} onChange={(e) => setRequestForm((f) => ({ ...f, description: e.target.value }))} />
              <button
                type="button"
                className={`${btnPrimary} sm:col-span-2`}
                onClick={() =>
                  officeAdmin.requests
                    .create(requestForm)
                    .then(() => {
                      flash('Request submitted.');
                      setRequestForm({ request_type: 'supplies', title: '', description: '', priority: 'medium' });
                      loadCore();
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Submit request
              </button>
            </div>
            <div className="app-glass-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-50 text-left">
                    <th className="p-3">Title</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">By</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-3">{r.title}</td>
                      <td className="p-3">{r.request_type}</td>
                      <td className="p-3">{r.status}</td>
                      <td className="p-3">{r.requested_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'office_manager' && canSee('office_manager') && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Office manager</h2>
            <p className="text-sm text-surface-600">Respond to maintenance reports, office requests, and low-stock alerts.</p>
            {inbox?.low_stock_consumables?.length > 0 && (
              <div className="app-glass-card p-4 border-l-4 border-amber-400">
                <h3 className="font-medium text-amber-900">Low stock</h3>
                <ul className="mt-2 text-sm">
                  {inbox.low_stock_consumables.map((c) => (
                    <li key={c.id}>
                      {c.name} — {c.quantity_on_hand} left (reorder at {c.reorder_level})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-medium">Maintenance reports</h3>
                {(inbox?.maintenance_reports || []).map((r) => (
                  <div key={r.id} className="app-glass-card p-4 text-sm space-y-2">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-surface-500">{r.description}</div>
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Manager notes"
                      value={managerNotes[`m-${r.id}`] || ''}
                      onChange={(e) => setManagerNotes((n) => ({ ...n, [`m-${r.id}`]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() =>
                          officeAdmin.maintenance
                            .updateReport(r.id, { status: 'in_progress', manager_notes: managerNotes[`m-${r.id}`] })
                            .then(() => {
                              flash('Updated.');
                              loadCore();
                            })
                            .catch((e) => setError(e.message))
                        }
                      >
                        In progress
                      </button>
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() =>
                          officeAdmin.maintenance
                            .updateReport(r.id, { status: 'resolved', manager_notes: managerNotes[`m-${r.id}`] })
                            .then(() => {
                              flash('Resolved.');
                              loadCore();
                            })
                            .catch((e) => setError(e.message))
                        }
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="font-medium">Office requests</h3>
                {(inbox?.office_requests || []).map((r) => (
                  <div key={r.id} className="app-glass-card p-4 text-sm space-y-2">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-surface-500">{r.description}</div>
                    <textarea
                      className={inputClass}
                      rows={2}
                      placeholder="Response to requester"
                      value={managerNotes[`r-${r.id}`] || ''}
                      onChange={(e) => setManagerNotes((n) => ({ ...n, [`r-${r.id}`]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() =>
                          officeAdmin.requests
                            .update(r.id, { status: 'manager_review', manager_response: managerNotes[`r-${r.id}`] })
                            .then(() => loadCore())
                            .catch((e) => setError(e.message))
                        }
                      >
                        Reviewing
                      </button>
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() =>
                          officeAdmin.requests
                            .update(r.id, { status: 'approved', manager_response: managerNotes[`r-${r.id}`] })
                            .then(() => {
                              flash('Approved.');
                              loadCore();
                            })
                            .catch((e) => setError(e.message))
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-700"
                        onClick={() =>
                          officeAdmin.requests
                            .update(r.id, { status: 'rejected', manager_response: managerNotes[`r-${r.id}`] })
                            .then(() => loadCore())
                            .catch((e) => setError(e.message))
                        }
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() =>
                          officeAdmin.requests
                            .update(r.id, { status: 'fulfilled', manager_response: managerNotes[`r-${r.id}`] })
                            .then(() => loadCore())
                            .catch((e) => setError(e.message))
                        }
                      >
                        Fulfilled
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'accounting_link' && canSee('accounting_link') && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Accounting link</h2>
            <p className="text-sm text-surface-600">
              Link office assets and consumables to Accounting Management items and suppliers. Open the full accounting
              module for purchase orders, invoices, and expenses.
            </p>
            <Link to="/accounting-management" className="inline-flex items-center gap-2 text-brand-600 font-medium hover:underline">
              Open Accounting Management →
            </Link>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="app-glass-card p-4">
                <h3 className="font-medium mb-2">Items library (sample)</h3>
                <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                  {acctItems.slice(0, 30).map((i) => (
                    <li key={i.id}>
                      {i.name} {i.sku ? `(${i.sku})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="app-glass-card p-4">
                <h3 className="font-medium mb-2">Suppliers (sample)</h3>
                <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                  {acctSuppliers.slice(0, 30).map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'manage_access' && canSee('manage_access') && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Manage tab access</h2>
            <ManageTabAccess
              isSuperAdmin={isSuperAdmin}
              permissions={permissions}
              setPermissions={setPermissions}
              users={grantUsers}
              setUsers={setGrantUsers}
            />
          </div>
        )}
      </main>
    </div>
  );
}
