import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { fuelSupply, users as usersApi, openAttachmentWithAuth } from './api';
import { FS_TABS, GRANT_TAB_IDS } from './lib/fuelSupplyTabs.js';
import { pickRow, formatDt, inputClass } from './lib/fuelSupplyUi.js';
import FuelActivityLogTab from './components/fuel/FuelActivityLogTab.jsx';
import FuelVehicleLogBookTab from './components/fuel/FuelVehicleLogBookTab.jsx';
import FuelProductionExpensesTab from './components/fuel/FuelProductionExpensesTab.jsx';
import { exportFuelReconciliationsExcel, exportFuelReconciliationsPdf } from './lib/fuelSupplyExports.js';
import InfoHint from './components/InfoHint.jsx';

function TabIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  const path = (d) => <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />;
  switch (name) {
    case 'dashboard':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z')}
        </svg>
      );
    case 'doc':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z')}
        </svg>
      );
    case 'activity':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M13 10V3L4 14h7v7l9-11h-7z')}
        </svg>
      );
    case 'truck':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z')}
        </svg>
      );
    case 'calc':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z')}
        </svg>
      );
    case 'list':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M4 6h16M4 10h16M4 14h16M4 18h16')}
        </svg>
      );
    case 'book':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253')}
        </svg>
      );
    case 'trend':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16')}
        </svg>
      );
    case 'settings':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z')}
          {path('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

function FuelManageTabAccess({ isSuperAdmin, permissions, setPermissions, users, setUsers, allTabIds }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    Promise.all([fuelSupply.permissions(), usersApi.list({ limit: 200 })])
      .then(([permRes, usersRes]) => {
        setPermissions(permRes.permissions || []);
        setUsers(usersRes.users || []);
      })
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  const handleGrant = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    fuelSupply
      .grantPermission(userId, tabId)
      .then(() => {
        setPermissions((prev) => {
          const next = prev.map((p) => (p.user_id === userId ? { ...p, tabs: [...(p.tabs || []), tabId] } : p));
          if (!next.find((p) => p.user_id === userId)) next.push({ user_id: userId, full_name: '', email: '', tabs: [tabId] });
          return next;
        });
      })
      .finally(() => setSaving(null));
  };

  const handleRevoke = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    fuelSupply
      .revokePermission(userId, tabId)
      .then(() => {
        setPermissions((prev) =>
          prev.map((p) => (p.user_id === userId ? { ...p, tabs: (p.tabs || []).filter((t) => t !== tabId) } : p))
        );
      })
      .finally(() => setSaving(null));
  };

  if (!isSuperAdmin) return null;
  if (loading) return <p className="text-surface-500">Loading permissions…</p>;

  const permByUser = (permissions || []).reduce((acc, p) => {
    acc[p.user_id] = p;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Manage tab access</h2>
        <InfoHint
          title="Manage tab access help"
          text="Grant or revoke Fuel supply management tabs for users. Super admins always see all tabs. Other users need this page in their role and at least one tab granted."
        />
      </div>
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-3 text-left font-medium text-surface-700">User</th>
                {allTabIds.map((tabId) => (
                  <th key={tabId} className="px-3 py-3 text-left font-medium text-surface-700 whitespace-nowrap">
                    {FS_TABS.find((t) => t.id === tabId)?.label || tabId}
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
                      <span className="font-medium text-surface-900">{u.full_name || u.email}</span>
                      <span className="text-surface-500 block text-xs">{u.email}</span>
                    </td>
                    {allTabIds.map((tabId) => {
                      const has = grants.includes(tabId);
                      const key = `${u.id}-${tabId}`;
                      return (
                        <td key={key} className="px-3 py-2">
                          {has ? (
                            <button
                              type="button"
                              onClick={() => handleRevoke(u.id, tabId)}
                              disabled={saving === key}
                              className="text-xs px-2 py-1 rounded bg-brand-100 text-brand-800 hover:bg-brand-200 disabled:opacity-50"
                            >
                              {saving === key ? '…' : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleGrant(u.id, tabId)}
                              disabled={saving === key}
                              className="text-xs px-2 py-1 rounded border border-surface-300 text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                            >
                              {saving === key ? '…' : 'Grant'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(!users || users.length === 0) && <p className="p-4 text-surface-500 text-sm">No users found.</p>}
      </div>
    </div>
  );
}

export default function FuelSupplyManagement() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('fuel-supply-mgmt');
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [orders, setOrders] = useState([]);
  const [customerRequests, setCustomerRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [permissions, setPermissions] = useState(null);
  const [grantUsers, setGrantUsers] = useState([]);
  const isSuperAdmin = user?.role === 'super_admin';

  const loadOrders = useCallback(() => {
    fuelSupply
      .orders()
      .then((r) => setOrders(r.orders || []))
      .catch(() => setOrders([]));
    fuelSupply
      .customerRequests()
      .then((r) => setCustomerRequests(r.requests || []))
      .catch(() => setCustomerRequests([]));
  }, []);

  const loadEvents = useCallback(() => {
    fuelSupply
      .events(50)
      .then((r) => setEvents(r.events || []))
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fuelSupply
      .myTabs()
      .then((r) => {
        if (cancelled) return;
        let tabs = r.tabs || [];
        if (user?.role === 'super_admin' && tabs.length === 0) tabs = [...GRANT_TAB_IDS];
        setAllowedTabs(tabs);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load access');
          if (user?.role === 'super_admin') setAllowedTabs([...GRANT_TAB_IDS]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  useEffect(() => {
    if (allowedTabs.length === 0) return;
    if (activeTab !== 'manage_access' && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [allowedTabs, activeTab]);

  useEffect(() => {
    if (!allowedTabs.includes('dashboard')) return;
    loadOrders();
    loadEvents();
  }, [allowedTabs, loadOrders, loadEvents]);

  useEffect(() => {
    if (allowedTabs.includes('administration') || allowedTabs.includes('delivery_management') || allowedTabs.includes('reconciliations')) {
      loadOrders();
    }
  }, [allowedTabs, loadOrders]);

  const navTabs = FS_TABS.filter((t) => allowedTabs.includes(t.id));
  const sections = [...new Set(navTabs.map((t) => t.section))];
  const canSeeTab = (id) => allowedTabs.includes(id);
  const hasAccess = isSuperAdmin || allowedTabs.length > 0;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-surface-500">Loading Fuel supply management…</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-semibold text-lg">Fuel supply management</h2>
          <p className="mt-2 text-sm">
            You do not have access to any tabs on this page. Ask a super admin to grant tab access under Manage tab access.
          </p>
        </div>
      </div>
    );
  }

  const mobileTabOptions = [
    ...navTabs.map((t) => ({ value: t.id, label: t.label })),
    ...(isSuperAdmin ? [{ value: 'manage_access', label: 'Manage tab access' }] : []),
  ];

  return (
    <div className="flex gap-0 w-full min-h-0 -m-4 sm:-m-6 flex-col md:flex-row">
      <nav
        className={`hidden md:flex shrink-0 flex-col border-r border-surface-200 bg-white transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Fuel supply management"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Fuel supply management</h2>
              <InfoHint
                title="Fuel supply management help"
                text="Use the tabs for diesel collection, delivery, vehicle trips, activity history, reconciliations, and production vs expenses. Customer-submitted requests appear under Administration when that workflow is enabled."
              />
            </div>
            {user?.tenant_name ? (
              <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mt-0.5" title="Tenant context">
                {user.tenant_name}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700"
            aria-label="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          {sections.map((section) => (
            <div key={section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">{section}</p>
              <ul className="space-y-0.5">
                {navTabs
                  .filter((t) => t.section === section)
                  .map((tab) => (
                    <li key={tab.id}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                          activeTab === tab.id
                            ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                            : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                        }`}
                      >
                        <TabIcon name={tab.icon} className="w-5 h-5 shrink-0 opacity-90" />
                        <span className="min-w-0 break-words">{tab.label}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {isSuperAdmin && (
            <div className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">Admin</p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveTab('manage_access')}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                      activeTab === 'manage_access'
                        ? 'bg-amber-50 text-amber-800 border-l-2 border-l-amber-500 font-medium'
                        : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                    }`}
                  >
                    <TabIcon name="settings" className="w-5 h-5 shrink-0 opacity-90" />
                    <span className="min-w-0 break-words">Manage tab access</span>
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 flex flex-col">
        <div className="md:hidden mb-3 sticky top-0 z-10 bg-surface-50/95 backdrop-blur py-2 -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-surface-200">
          <label className="block text-xs font-medium text-surface-600 mb-1">Section</label>
          <select
            className={inputClass()}
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
          >
            {mobileTabOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="hidden md:flex self-start items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}

        <div className="w-full max-w-7xl mx-auto flex-1 space-y-6">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center gap-2">
              <span className="min-w-0">{error}</span>
              <button type="button" className="shrink-0 text-red-800" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'manage_access' && (
            <FuelManageTabAccess
              isSuperAdmin={isSuperAdmin}
              permissions={permissions}
              setPermissions={setPermissions}
              users={grantUsers}
              setUsers={setGrantUsers}
              allTabIds={GRANT_TAB_IDS}
            />
          )}

          {activeTab === 'dashboard' && canSeeTab('dashboard') && (
            <DashboardTab orders={orders} events={events} onRefresh={() => { loadOrders(); loadEvents(); }} />
          )}

          {activeTab === 'administration' && canSeeTab('administration') && (
            <AdministrationTab
              orders={orders}
              customerRequests={customerRequests}
              onCreated={loadOrders}
              onError={setError}
            />
          )}

          {activeTab === 'supply_activities' && canSeeTab('supply_activities') && (
            <SupplyActivitiesTab orders={orders} onLogged={() => { loadOrders(); loadEvents(); }} onError={setError} />
          )}

          {activeTab === 'activity_log' && canSeeTab('activity_log') && (
            <FuelActivityLogTab orders={orders} onError={setError} />
          )}

          {activeTab === 'delivery_vehicle_log_book' && canSeeTab('delivery_vehicle_log_book') && (
            <FuelVehicleLogBookTab orders={orders} onError={setError} />
          )}

          {activeTab === 'delivery_management' && canSeeTab('delivery_management') && (
            <DeliveryTab orders={orders} onDone={() => { loadOrders(); loadEvents(); }} onError={setError} />
          )}

          {activeTab === 'reconciliations' && canSeeTab('reconciliations') && (
            <ReconciliationsTab orders={orders} onRefresh={loadOrders} onError={setError} />
          )}

          {activeTab === 'production_vs_expenses' && canSeeTab('production_vs_expenses') && (
            <FuelProductionExpensesTab onError={setError} />
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardTab({ orders, events, onRefresh }) {
  const open = orders.filter((o) => !['delivered', 'reconciled'].includes(String(o.status || '').toLowerCase())).length;
  const delivered = orders.filter((o) => String(o.status || '').toLowerCase() === 'delivered').length;
  const reconciled = orders.filter((o) => String(o.status || '').toLowerCase() === 'reconciled').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Dashboard</h2>
          <InfoHint
            title="Fuel supply dashboard help"
            text="Diesel supply overview and alerts for collections and deliveries. Counters reflect order status; the feed lists recent events such as collections and customer requests."
            bullets={['In progress: orders not yet delivered or reconciled.', 'Alerts show collection and delivery notifications.', 'Recent orders lists the latest diesel orders for quick reference.']}
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50 self-start"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">In progress</p>
          <p className="text-2xl font-semibold text-surface-900 mt-1">{open}</p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">Delivered</p>
          <p className="text-2xl font-semibold text-surface-900 mt-1">{delivered}</p>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-surface-500 uppercase">Reconciled</p>
          <p className="text-2xl font-semibold text-surface-900 mt-1">{reconciled}</p>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Alerts &amp; events</h3>
          <InfoHint title="Alerts and events help" text="Collection and delivery notifications, plus other fuel supply events for your tenant." />
        </div>
        <ul className="divide-y divide-surface-100 max-h-[420px] overflow-y-auto">
          {events.length === 0 ? (
            <li className="px-4 py-8 text-center text-surface-500 text-sm">No events yet.</li>
          ) : (
            events.map((ev) => {
              const id = pickRow(ev, 'id', 'Id');
              const type = pickRow(ev, 'event_type', 'eventType', 'EVENT_TYPE');
              const title = pickRow(ev, 'title', 'Title');
              const message = pickRow(ev, 'message', 'Message');
              const created = pickRow(ev, 'created_at', 'createdAt', 'CREATED_AT');
              const isCollection = String(type || '').toLowerCase().includes('collection');
              return (
                <li key={id} className="px-4 py-3 flex gap-3">
                  <span
                    className={`shrink-0 mt-0.5 h-2 w-2 rounded-full ${isCollection ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    title={type}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-900">{title}</p>
                    {message ? <p className="text-xs text-surface-600 mt-0.5 break-words">{message}</p> : null}
                    <p className="text-xs text-surface-400 mt-1">{formatDt(created)}</p>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100">
          <h3 className="text-sm font-semibold text-surface-900">Recent diesel orders</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-surface-50 text-left text-surface-600">
                <th className="px-4 py-2 font-medium">Depot</th>
                <th className="px-4 py-2 font-medium">Site</th>
                <th className="px-4 py-2 font-medium">Driver</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Expected L</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 12).map((o) => (
                <tr key={o.id} className="border-t border-surface-100">
                  <td className="px-4 py-2 text-surface-900">{o.depot_name}</td>
                  <td className="px-4 py-2">{o.delivery_site_name}</td>
                  <td className="px-4 py-2">{o.driver_name}</td>
                  <td className="px-4 py-2 capitalize">{o.status}</td>
                  <td className="px-4 py-2">{o.expected_liters != null ? o.expected_liters : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No orders yet. Create one under Administration.</p>}
        </div>
      </div>
    </div>
  );
}

function CustomerDieselRequestsAdminPanel({ requests, onRefresh, onError }) {
  const pending = (requests || []).filter((r) => r.status === 'pending_admin');
  const [review, setReview] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveForm, setApproveForm] = useState({
    depot_name: '',
    depot_address: '',
    supplier_code: '',
    driver_name: '',
    driver_employee_number: '',
    expected_liters: '',
    site_responsible_name: '',
    site_responsible_phone: '',
    site_responsible_email: '',
    site_responsible_role: '',
    admin_notes: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  const openReview = (r) => {
    setReview(r);
    setRejectReason('');
    setApproveForm({
      depot_name: '',
      depot_address: '',
      supplier_code: '',
      driver_name: '',
      driver_employee_number: '',
      expected_liters: r.liters_required != null ? String(r.liters_required) : '',
      site_responsible_name: r.site_responsible_name || '',
      site_responsible_phone: r.site_responsible_phone || '',
      site_responsible_email: r.site_responsible_email || '',
      site_responsible_role: '',
      admin_notes: '',
      notes: '',
    });
  };

  const approve = (e) => {
    e.preventDefault();
    if (!review) return;
    setBusy(true);
    onError('');
    const liters = approveForm.expected_liters === '' ? undefined : Number(approveForm.expected_liters);
    fuelSupply
      .approveCustomerRequest(review.id, {
        depot_name: approveForm.depot_name,
        depot_address: approveForm.depot_address,
        supplier_code: approveForm.supplier_code,
        driver_name: approveForm.driver_name,
        driver_employee_number: approveForm.driver_employee_number,
        delivery_site_name: review.delivery_site_name,
        delivery_site_address: review.delivery_site_address,
        site_responsible_name: approveForm.site_responsible_name.trim() || review.site_responsible_name,
        site_responsible_phone: approveForm.site_responsible_phone.trim() || review.site_responsible_phone,
        site_responsible_email: approveForm.site_responsible_email.trim() || review.site_responsible_email,
        site_responsible_role: approveForm.site_responsible_role || undefined,
        expected_liters: liters,
        admin_notes: approveForm.admin_notes.trim() || undefined,
        notes: approveForm.notes.trim() || undefined,
      })
      .then(() => {
        setReview(null);
        onRefresh();
      })
      .catch((err) => onError(err?.message || 'Could not approve'))
      .finally(() => setBusy(false));
  };

  const reject = () => {
    if (!review) return;
    setBusy(true);
    onError('');
    fuelSupply
      .rejectCustomerRequest(review.id, { rejection_reason: rejectReason.trim() || undefined })
      .then(() => {
        setReview(null);
        onRefresh();
      })
      .catch((err) => onError(err?.message || 'Could not reject'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/80 flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-surface-900">Customer diesel requests</h3>
        <InfoHint
          title="Customer diesel requests help"
          text={`${pending.length} awaiting approval. Customers submit from Customer diesel orders. Approve to create a live diesel order linked to their request. Reject notifies the requester by email when mail is configured.`}
        />
      </div>
      <div className="overflow-x-auto bg-white">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-surface-50 text-left">
              <th className="px-4 py-2 font-medium text-surface-600">Submitted</th>
              <th className="px-4 py-2 font-medium text-surface-600">Customer</th>
              <th className="px-4 py-2 font-medium text-surface-600">Site / type</th>
              <th className="px-4 py-2 font-medium text-surface-600">L / priority / due</th>
              <th className="px-4 py-2 font-medium text-surface-600">Status</th>
              <th className="px-4 py-2 font-medium text-surface-600"> </th>
            </tr>
          </thead>
          <tbody>
            {(requests || []).map((r) => (
              <tr key={r.id} className="border-t border-surface-100">
                <td className="px-4 py-2 whitespace-nowrap text-surface-600">{formatDt(r.created_at)}</td>
                <td className="px-4 py-2">
                  <span className="font-medium text-surface-900">{r.requester_name || '—'}</span>
                  <span className="text-xs text-surface-500 block">{r.requester_email || ''}</span>
                </td>
                <td className="px-4 py-2">
                  {r.delivery_site_name}
                  <span className="text-xs text-surface-500 block capitalize">{String(r.request_type || '').replace(/_/g, ' ')}</span>
                </td>
                <td className="px-4 py-2">
                  {r.liters_required != null ? r.liters_required : '—'} L
                  <span className="text-xs text-surface-500 block">
                    {r.priority} · due {r.due_date ? new Date(r.due_date).toLocaleDateString(undefined, { dateStyle: 'short' }) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2 capitalize text-surface-700">{r.portal_status_label}</td>
                <td className="px-4 py-2">
                  {r.status === 'pending_admin' && (
                    <button type="button" className="text-xs font-medium text-brand-600 hover:text-brand-700" onClick={() => openReview(r)}>
                      Review
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(requests || []).length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No customer requests yet.</p>}
      </div>

      {review ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl border border-surface-200 shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h4 className="text-sm font-semibold text-surface-900">Review customer request</h4>
            <div className="text-xs text-surface-600 space-y-1">
              <p>
                <strong>{review.requester_name}</strong> · {review.liters_required} L · {review.priority} · due{' '}
                {review.due_date ? new Date(review.due_date).toLocaleDateString(undefined, { dateStyle: 'short' }) : '—'}
              </p>
              <p className="whitespace-pre-wrap">{review.delivery_site_address}</p>
              {review.customer_notes && <p className="text-surface-500">Notes: {review.customer_notes}</p>}
            </div>
            <form className="space-y-3" onSubmit={approve}>
              <p className="text-xs font-medium text-surface-700">Complete order details (creates diesel order)</p>
              <input
                required
                placeholder="Depot name"
                className={inputClass()}
                value={approveForm.depot_name}
                onChange={(e) => setApproveForm((f) => ({ ...f, depot_name: e.target.value }))}
              />
              <textarea
                required
                placeholder="Depot address"
                rows={2}
                className={inputClass()}
                value={approveForm.depot_address}
                onChange={(e) => setApproveForm((f) => ({ ...f, depot_address: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  placeholder="Supplier code"
                  className={inputClass()}
                  value={approveForm.supplier_code}
                  onChange={(e) => setApproveForm((f) => ({ ...f, supplier_code: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Expected liters"
                  className={inputClass()}
                  value={approveForm.expected_liters}
                  onChange={(e) => setApproveForm((f) => ({ ...f, expected_liters: e.target.value }))}
                />
              </div>
              <input
                required
                placeholder="Driver name"
                className={inputClass()}
                value={approveForm.driver_name}
                onChange={(e) => setApproveForm((f) => ({ ...f, driver_name: e.target.value }))}
              />
              <input
                required
                placeholder="Driver employee #"
                className={inputClass()}
                value={approveForm.driver_employee_number}
                onChange={(e) => setApproveForm((f) => ({ ...f, driver_employee_number: e.target.value }))}
              />
              <input
                required
                placeholder="Site responsible name (confirm or edit)"
                className={inputClass()}
                value={approveForm.site_responsible_name}
                onChange={(e) => setApproveForm((f) => ({ ...f, site_responsible_name: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="Site phone (optional)"
                  className={inputClass()}
                  value={approveForm.site_responsible_phone}
                  onChange={(e) => setApproveForm((f) => ({ ...f, site_responsible_phone: e.target.value }))}
                />
                <input
                  type="email"
                  placeholder="Site email (optional)"
                  className={inputClass()}
                  value={approveForm.site_responsible_email}
                  onChange={(e) => setApproveForm((f) => ({ ...f, site_responsible_email: e.target.value }))}
                />
              </div>
              <input
                placeholder="Site responsible role (optional)"
                className={inputClass()}
                value={approveForm.site_responsible_role}
                onChange={(e) => setApproveForm((f) => ({ ...f, site_responsible_role: e.target.value }))}
              />
              <textarea
                placeholder="Internal admin notes (optional)"
                rows={2}
                className={inputClass()}
                value={approveForm.admin_notes}
                onChange={(e) => setApproveForm((f) => ({ ...f, admin_notes: e.target.value }))}
              />
              <textarea
                placeholder="Extra order notes (optional)"
                rows={2}
                className={inputClass()}
                value={approveForm.notes}
                onChange={(e) => setApproveForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? '…' : 'Approve & create order'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
            <div className="border-t border-surface-100 pt-4 space-y-2">
              <label className="block text-xs font-medium text-surface-600">Reject reason (optional)</label>
              <textarea rows={2} className={inputClass()} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <button
                type="button"
                disabled={busy}
                className="text-sm text-red-700 hover:text-red-800 disabled:opacity-50"
                onClick={reject}
              >
                Reject request
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdministrationTab({ orders, customerRequests, onCreated, onError }) {
  const empty = {
    depot_name: '',
    depot_address: '',
    supplier_code: '',
    driver_name: '',
    driver_employee_number: '',
    delivery_site_name: '',
    delivery_site_address: '',
    site_responsible_name: '',
    site_responsible_phone: '',
    site_responsible_email: '',
    site_responsible_role: '',
    expected_liters: '',
    notes: '',
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [reorderFor, setReorderFor] = useState(null);
  const [reorderLiters, setReorderLiters] = useState('');
  const [reorderNotes, setReorderNotes] = useState('');
  const [reorderSaving, setReorderSaving] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setSaving(true);
    onError('');
    fuelSupply
      .createOrder({
        ...form,
        expected_liters: form.expected_liters === '' ? null : Number(form.expected_liters),
      })
      .then(() => {
        setForm(empty);
        onCreated();
      })
      .catch((err) => onError(err?.message || 'Could not create order'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-8">
      <CustomerDieselRequestsAdminPanel requests={customerRequests} onRefresh={onCreated} onError={onError} />

      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Administration</h2>
        <InfoHint
          title="Fuel administration help"
          text="Register a diesel order: depot (e.g. Sasol or garage), supplier code, driver, and mine / delivery site with responsible contacts."
          bullets={[
            'Use Reorder on an existing row when the supply route is unchanged and only the mine ordered volume changes — a new order copies depot, site, and driver.',
            'Customer diesel requests appear above; approving creates an order and notifies the customer when email is configured.',
            'Detailed activity history and filters are under the Activity log tab.',
          ]}
        />
      </div>

      <form onSubmit={submit} className="max-w-3xl space-y-4 bg-white rounded-xl border border-surface-200 p-4 sm:p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-800">New diesel order</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Depot name</label>
            <input required className={inputClass()} value={form.depot_name} onChange={(e) => setForm((f) => ({ ...f, depot_name: e.target.value }))} placeholder="e.g. Sasol Secunda" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Depot address</label>
            <textarea required className={inputClass()} rows={2} value={form.depot_address} onChange={(e) => setForm((f) => ({ ...f, depot_address: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Supplier code</label>
            <input required className={inputClass()} value={form.supplier_code} onChange={(e) => setForm((f) => ({ ...f, supplier_code: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Expected liters (optional)</label>
            <input type="number" min="0" step="0.01" className={inputClass()} value={form.expected_liters} onChange={(e) => setForm((f) => ({ ...f, expected_liters: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Driver name</label>
            <input required className={inputClass()} value={form.driver_name} onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Driver employee number</label>
            <input required className={inputClass()} value={form.driver_employee_number} onChange={(e) => setForm((f) => ({ ...f, driver_employee_number: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Delivery site name</label>
            <input required className={inputClass()} value={form.delivery_site_name} onChange={(e) => setForm((f) => ({ ...f, delivery_site_name: e.target.value }))} placeholder="Mine or plant" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Delivery site address</label>
            <textarea required className={inputClass()} rows={2} value={form.delivery_site_address} onChange={(e) => setForm((f) => ({ ...f, delivery_site_address: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Site responsible name</label>
            <input required className={inputClass()} value={form.site_responsible_name} onChange={(e) => setForm((f) => ({ ...f, site_responsible_name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Site responsible role</label>
            <input className={inputClass()} value={form.site_responsible_role} onChange={(e) => setForm((f) => ({ ...f, site_responsible_role: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Site responsible phone</label>
            <input className={inputClass()} value={form.site_responsible_phone} onChange={(e) => setForm((f) => ({ ...f, site_responsible_phone: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Site responsible email</label>
            <input type="email" className={inputClass()} value={form.site_responsible_email} onChange={(e) => setForm((f) => ({ ...f, site_responsible_email: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Notes</label>
            <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create diesel order'}
        </button>
      </form>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100">
          <h3 className="text-sm font-semibold text-surface-900">All orders</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-surface-50 text-left">
                <th className="px-4 py-2 font-medium text-surface-600">Depot</th>
                <th className="px-4 py-2 font-medium text-surface-600">Supplier</th>
                <th className="px-4 py-2 font-medium text-surface-600">Site</th>
                <th className="px-4 py-2 font-medium text-surface-600">Driver</th>
                <th className="px-4 py-2 font-medium text-surface-600">Expected L</th>
                <th className="px-4 py-2 font-medium text-surface-600">Status</th>
                <th className="px-4 py-2 font-medium text-surface-600"> </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-surface-100">
                  <td className="px-4 py-2">{o.depot_name}</td>
                  <td className="px-4 py-2">{o.supplier_code}</td>
                  <td className="px-4 py-2">{o.delivery_site_name}</td>
                  <td className="px-4 py-2">
                    {o.driver_name}
                    <span className="text-surface-500 text-xs block">#{o.driver_employee_number}</span>
                  </td>
                  <td className="px-4 py-2">{o.expected_liters != null ? o.expected_liters : '—'}</td>
                  <td className="px-4 py-2 capitalize">{o.status}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      onClick={() => {
                        setReorderFor(o);
                        setReorderLiters(o.expected_liters != null ? String(o.expected_liters) : '');
                        setReorderNotes('');
                      }}
                    >
                      Reorder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No orders yet.</p>}
        </div>
      </div>

      {reorderFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl border border-surface-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-surface-900">Reorder diesel (same supply)</h3>
              <InfoHint
                title="Reorder diesel help"
                text="New order copies depot, supplier, site, driver, and contacts from this row. Only the mine's ordered liters (and optional note) are new."
              />
            </div>
            <p className="text-xs text-surface-500">
              {reorderFor.depot_name} → {reorderFor.delivery_site_name} · {reorderFor.driver_name}
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setReorderSaving(true);
                onError('');
                fuelSupply
                  .reorderOrder(reorderFor.id, {
                    expected_liters: Number(reorderLiters),
                    notes: reorderNotes.trim() || undefined,
                  })
                  .then(() => {
                    setReorderFor(null);
                    onCreated();
                  })
                  .catch((err) => onError(err?.message || 'Reorder failed'))
                  .finally(() => setReorderSaving(false));
              }}
            >
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">New expected liters (mine order)</label>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputClass()}
                  value={reorderLiters}
                  onChange={(e) => setReorderLiters(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Note (optional)</label>
                <textarea className={inputClass()} rows={2} value={reorderNotes} onChange={(e) => setReorderNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-700"
                  onClick={() => setReorderFor(null)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={reorderSaving} className="px-3 py-2 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">
                  {reorderSaving ? 'Creating…' : 'Create reorder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SupplyActivitiesTab({ orders, onLogged, onError }) {
  const [orderId, setOrderId] = useState('');
  const [activityType, setActivityType] = useState('collected');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [liters, setLiters] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId && orders.length) setOrderId(orders[0].id);
  }, [orders, orderId]);

  const submit = (e) => {
    e.preventDefault();
    if (!orderId) return;
    setSaving(true);
    onError('');
    fuelSupply
      .addActivity(orderId, {
        activity_type: activityType,
        title,
        notes: notes || null,
        liters_related: liters === '' ? null : Number(liters),
        location_label: locationLabel.trim() || null,
        odometer_km: odometerKm === '' ? null : Number(odometerKm),
        duration_minutes: durationMin === '' ? null : parseInt(durationMin, 10),
        tags: tags.trim() || null,
      })
      .then(() => {
        setTitle('');
        setNotes('');
        setLiters('');
        setLocationLabel('');
        setOdometerKm('');
        setDurationMin('');
        setTags('');
        onLogged();
      })
      .catch((err) => onError(err?.message || 'Failed to log activity'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Supply activities</h2>
        <InfoHint
          title="Supply activities help"
          text="Quick log for collection, in transit, or other steps. Collection types raise dashboard alerts."
          bullets={['For search, filters, and exports use the Activity log tab.']}
        />
      </div>

      <form onSubmit={submit} className="max-w-2xl space-y-4 bg-white rounded-xl border border-surface-200 p-4 sm:p-6 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Order</label>
          <select className={inputClass()} value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
            {orders.length === 0 ? <option value="">No orders — create one first</option> : null}
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.depot_name} → {o.delivery_site_name} ({o.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Activity type</label>
          <select className={inputClass()} value={activityType} onChange={(e) => setActivityType(e.target.value)}>
            <option value="collected">Diesel collected (alert)</option>
            <option value="collection">Collection (alert)</option>
            <option value="in_transit">In transit</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Title</label>
          <input required className={inputClass()} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Collected 500 L at Sasol — slip #1234" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Liters (optional)</label>
            <input type="number" min="0" step="0.01" className={inputClass()} value={liters} onChange={(e) => setLiters(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Location label</label>
            <input className={inputClass()} value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="Depot / stop name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Odometer (km)</label>
            <input type="number" min="0" step="0.1" className={inputClass()} value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Duration (minutes)</label>
            <input type="number" min="0" className={inputClass()} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Tags (filtering)</label>
          <input className={inputClass()} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. sasol, slip-4421" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Notes</label>
          <textarea className={inputClass()} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="submit" disabled={saving || !orderId} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Log activity'}
        </button>
      </form>
    </div>
  );
}

function DeliveryTab({ orders, onDone, onError }) {
  const [orderId, setOrderId] = useState('');
  const [liters, setLiters] = useState('');
  const [acceptedBy, setAcceptedBy] = useState('');
  const [filledInto, setFilledInto] = useState('');
  const [vehicles, setVehicles] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId && orders.length) setOrderId(orders[0].id);
  }, [orders, orderId]);

  const submit = (e) => {
    e.preventDefault();
    if (!orderId || !file) return;
    setSaving(true);
    onError('');
    const fd = new FormData();
    fd.append('receipt', file);
    fd.append('liters_delivered', String(liters));
    fd.append('accepted_by_name', acceptedBy);
    fd.append('filled_into_description', filledInto);
    fd.append('vehicle_references', vehicles);
    fuelSupply
      .addDelivery(orderId, fd)
      .then(() => {
        setLiters('');
        setAcceptedBy('');
        setFilledInto('');
        setVehicles('');
        setFile(null);
        onDone();
      })
      .catch((err) => onError(err?.message || 'Delivery failed'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Delivery management</h2>
        <InfoHint
          title="Delivery management help"
          text="When diesel arrives at the mine, record liters, who accepted it, where it was filled, vehicle references, and upload the receipt photo. Completing delivery updates order status and may notify customers for orders created from customer requests."
        />
      </div>

      <form onSubmit={submit} className="max-w-xl space-y-4 bg-white rounded-xl border border-surface-200 p-4 sm:p-6 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Order</label>
          <select className={inputClass()} value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
            {orders.length === 0 ? <option value="">No orders</option> : null}
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.delivery_site_name} — {o.driver_name} ({o.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Liters delivered</label>
          <input required type="number" min="0.01" step="0.01" className={inputClass()} value={liters} onChange={(e) => setLiters(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Accepted by (name)</label>
          <input required className={inputClass()} value={acceptedBy} onChange={(e) => setAcceptedBy(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Filled into (tank / equipment / area)</label>
          <input required className={inputClass()} value={filledInto} onChange={(e) => setFilledInto(e.target.value)} placeholder="e.g. Day tank B, fleet yard" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Vehicle / equipment references</label>
          <textarea className={inputClass()} rows={2} value={vehicles} onChange={(e) => setVehicles(e.target.value)} placeholder="e.g. ABC123GP, XYZ789GP — one per line or comma-separated" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Receipt photo</label>
          <input required type="file" accept="image/*" className="text-sm text-surface-700" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button type="submit" disabled={saving || !orderId || !file} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
          {saving ? 'Uploading…' : 'Record delivery'}
        </button>
      </form>
    </div>
  );
}

function ReconciliationsTab({ orders, onRefresh, onError }) {
  const [orderId, setOrderId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    invoice_reference: '',
    invoice_amount: '',
    handling_fee: '',
    payment_status: 'pending',
    payment_date: '',
    payment_reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId && orders.length) setOrderId(orders[0].id);
  }, [orders, orderId]);

  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fuelSupply
      .order(orderId)
      .then((r) => {
        if (!cancelled) setDetail(r);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const submit = (e) => {
    e.preventDefault();
    if (!orderId) return;
    setSaving(true);
    onError('');
    fuelSupply
      .addReconciliation(orderId, {
        invoice_reference: form.invoice_reference,
        invoice_amount: Number(form.invoice_amount),
        handling_fee: form.handling_fee === '' ? null : Number(form.handling_fee),
        payment_status: form.payment_status,
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        notes: form.notes || null,
      })
      .then(() => {
        setForm({
          invoice_reference: '',
          invoice_amount: '',
          handling_fee: '',
          payment_status: 'pending',
          payment_date: '',
          payment_reference: '',
          notes: '',
        });
        return fuelSupply.order(orderId);
      })
      .then((r) => setDetail(r))
      .then(() => onRefresh())
      .catch((err) => onError(err?.message || 'Could not save reconciliation'))
      .finally(() => setSaving(false));
  };

  const deliveries = detail?.deliveries || [];
  const recons = detail?.reconciliations || [];

  const downloadRecons = async (kind) => {
    try {
      const r = await fuelSupply.reconciliationsList();
      const list = r.reconciliations || [];
      if (kind === 'xlsx') await exportFuelReconciliationsExcel(list);
      else exportFuelReconciliationsPdf(list);
    } catch (err) {
      onError(err?.message || 'Export failed');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Reconciliations</h2>
          <InfoHint
            title="Reconciliations help"
            text="Match supplier invoices, handling fees, and payment once the mine receives billing. Download Excel or PDF exports of reconciliation records across orders."
          />
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => downloadRecons('xlsx')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Download Excel
          </button>
          <button
            type="button"
            onClick={() => downloadRecons('pdf')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="max-w-3xl space-y-4">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Order</label>
          <select className={inputClass()} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.depot_name} → {o.delivery_site_name} ({o.status})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-surface-500 text-sm">Loading order…</p>
        ) : detail ? (
          <div className="rounded-xl border border-surface-200 bg-surface-50 p-4 text-sm space-y-1">
            <p>
              <span className="text-surface-500">Driver:</span> {detail.order?.driver_name} (#{detail.order?.driver_employee_number})
            </p>
            <p>
              <span className="text-surface-500">Site contact:</span> {detail.order?.site_responsible_name}
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-surface-900">Deliveries on this order</h3>
          {deliveries.length === 0 ? (
            <p className="text-surface-500 text-sm">No deliveries recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {deliveries.map((d) => {
                const id = pickRow(d, 'id', 'Id');
                const L = pickRow(d, 'liters_delivered', 'litersDelivered');
                const at = pickRow(d, 'delivered_at', 'deliveredAt');
                return (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm border border-surface-100 rounded-lg px-3 py-2">
                    <span>
                      {L} L · {formatDt(at)}
                    </span>
                    <button
                      type="button"
                      className="text-brand-600 text-xs font-medium"
                      onClick={() => openAttachmentWithAuth(fuelSupply.receiptUrl(id)).catch((err) => onError(err?.message))}
                    >
                      View receipt
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form onSubmit={submit} className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-surface-900">New reconciliation</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 mb-1">Invoice reference</label>
              <input required className={inputClass()} value={form.invoice_reference} onChange={(e) => setForm((f) => ({ ...f, invoice_reference: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Invoice amount</label>
              <input required type="number" step="0.01" className={inputClass()} value={form.invoice_amount} onChange={(e) => setForm((f) => ({ ...f, invoice_amount: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Handling fee (optional)</label>
              <input type="number" step="0.01" className={inputClass()} value={form.handling_fee} onChange={(e) => setForm((f) => ({ ...f, handling_fee: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Payment status</label>
              <select className={inputClass()} value={form.payment_status} onChange={(e) => setForm((f) => ({ ...f, payment_status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="disputed">Disputed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Payment date</label>
              <input type="date" className={inputClass()} value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 mb-1">Payment reference</label>
              <input className={inputClass()} value={form.payment_reference} onChange={(e) => setForm((f) => ({ ...f, payment_reference: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 mb-1">Notes</label>
              <textarea className={inputClass()} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <button type="submit" disabled={saving || !orderId} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save reconciliation'}
          </button>
        </form>

        <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-surface-100">
            <h3 className="text-sm font-semibold text-surface-900">Reconciliation records</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-surface-50 text-left">
                  <th className="px-4 py-2 font-medium text-surface-600">Invoice</th>
                  <th className="px-4 py-2 font-medium text-surface-600">Amount</th>
                  <th className="px-4 py-2 font-medium text-surface-600">Fee</th>
                  <th className="px-4 py-2 font-medium text-surface-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {recons.map((r) => {
                  const id = pickRow(r, 'id', 'Id');
                  const inv = pickRow(r, 'invoice_reference', 'invoiceReference');
                  const amt = pickRow(r, 'invoice_amount', 'invoiceAmount');
                  const fee = pickRow(r, 'handling_fee', 'handlingFee');
                  const st = pickRow(r, 'payment_status', 'paymentStatus');
                  return (
                    <tr key={id} className="border-t border-surface-100">
                      <td className="px-4 py-2">{inv}</td>
                      <td className="px-4 py-2">{amt}</td>
                      <td className="px-4 py-2">{fee != null ? fee : '—'}</td>
                      <td className="px-4 py-2 capitalize">{st}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recons.length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No reconciliations for this order.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
