import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import { fuelData, users as usersApi, downloadAttachmentWithAuth, openAttachmentWithAuth } from './api';
import { FD_TABS, GRANT_TAB_IDS } from './lib/fuelDataTabs.js';
import {
  FUEL_EXPORT_COLUMN_OPTIONS,
  DEFAULT_EXPORT_COLUMN_KEYS,
  orderExportColumnKeys,
} from './lib/fuelExportColumns.js';
import { formatDt, inputClass } from './lib/fuelSupplyUi.js';
import InfoHint from './components/InfoHint.jsx';
import FuelSlipAiCameraModal from './components/FuelSlipAiCameraModal.jsx';
import FuelAdvancedDashboard from './components/FuelAdvancedDashboard.jsx';

const FUEL_EXPORT_COLS_STORAGE_KEY = 'fuel-data-export-columns';

/** Shared transaction list filters (Fuel Admin + File Export tabs). */
function FuelDataTxFilterCard({
  filterDraft,
  setFilterDraft,
  showAdvFilters,
  setShowAdvFilters,
  suppliers,
  customers,
  applyListFilters,
  setTxFilters,
  onClearFilters,
}) {
  return (
    <section className="app-glass-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Search & filters</h3>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-surface-300"
          onClick={() => setShowAdvFilters((v) => !v)}
        >
          {showAdvFilters ? 'Hide advanced' : 'Advanced filters'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs text-surface-500 flex-1 min-w-[140px]">
          Search
          <input
            className={inputClass('mt-1')}
            placeholder="Supplier, customer, reg, names…"
            value={filterDraft.q}
            onChange={(e) => setFilterDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </label>
        <button type="button" onClick={applyListFilters} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm shrink-0">
          Apply filters
        </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-surface-300 text-sm"
                  onClick={() => {
                    setFilterDraft({ supplier_id: '', customer_id: '', date_from: '', date_to: '', source: '', q: '' });
                    setTxFilters({});
                    onClearFilters?.();
                  }}
                >
                  Clear
                </button>
      </div>
      {showAdvFilters ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-surface-100 dark:border-surface-800">
          <label className="text-xs text-surface-500">
            Supplier
            <select
              className={inputClass('mt-1')}
              value={filterDraft.supplier_id}
              onChange={(e) => setFilterDraft((d) => ({ ...d, supplier_id: e.target.value }))}
            >
              <option value="">All</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-surface-500">
            Customer
            <select
              className={inputClass('mt-1')}
              value={filterDraft.customer_id}
              onChange={(e) => setFilterDraft((d) => ({ ...d, customer_id: e.target.value }))}
            >
              <option value="">All</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-surface-500">
            Source
            <select
              className={inputClass('mt-1')}
              value={filterDraft.source}
              onChange={(e) => setFilterDraft((d) => ({ ...d, source: e.target.value }))}
            >
              <option value="">All</option>
              <option value="manual">manual</option>
              <option value="attendant_portal">attendant_portal</option>
            </select>
          </label>
          <label className="text-xs text-surface-500">
            From date
            <input
              type="date"
              className={inputClass('mt-1')}
              value={filterDraft.date_from}
              onChange={(e) => setFilterDraft((d) => ({ ...d, date_from: e.target.value }))}
            />
          </label>
          <label className="text-xs text-surface-500">
            To date
            <input
              type="date"
              className={inputClass('mt-1')}
              value={filterDraft.date_to}
              onChange={(e) => setFilterDraft((d) => ({ ...d, date_to: e.target.value }))}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

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
    case 'activity':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M13 10V3L4 14h7v7l9-11h-7z')}
        </svg>
      );
    case 'list':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M4 6h16M4 10h16M4 14h16M4 18h16')}
        </svg>
      );
    case 'doc':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z')}
        </svg>
      );
    case 'trend':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16')}
        </svg>
      );
    case 'truck':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z')}
        </svg>
      );
    case 'export':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4')}
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

function FuelDataManageTabs({ isSuperAdmin, permissions, setPermissions, users, setUsers, allTabIds }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    Promise.all([fuelData.permissions(), usersApi.list({ limit: 200 })])
      .then(([permRes, usersRes]) => {
        setPermissions(permRes.permissions || []);
        setUsers(usersRes.users || []);
      })
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [isSuperAdmin, setPermissions, setUsers]);

  const handleGrant = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    fuelData
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
    fuelData
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
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Manage tabs</h2>
        <InfoHint
          title="Fuel Data tab access"
          text="Grant users access to individual Fuel Data tabs. Users still need the Fuel Data page assigned under User management. Super admins always see all tabs."
        />
      </div>
      <div className="app-glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 dark:bg-surface-900/50">
                <th className="px-4 py-3 text-left font-medium text-surface-700 dark:text-surface-300">User</th>
                {allTabIds.map((tabId) => (
                  <th key={tabId} className="px-3 py-3 text-left font-medium text-surface-700 dark:text-surface-300 whitespace-nowrap">
                    {FD_TABS.find((t) => t.id === tabId)?.label || tabId}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => {
                const grants = permByUser[u.id]?.tabs || [];
                return (
                  <tr key={u.id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="px-4 py-2">
                      <span className="font-medium text-surface-900 dark:text-surface-50">{u.full_name || u.email}</span>
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

const FORM_COLLAPSE_KEY = 'fuel-data-record-form-collapsed';

const emptyTxForm = () => ({
  supplier_id: '',
  supplier_name: '',
  customer_id: '',
  customer_name: '',
  vehicle_tank: '',
  order_number: '',
  vehicle_registration: '',
  supplier_vehicle_registration: '',
  delivery_time: '',
  kilos: '',
  responsible_user_name: '',
  pump_start: '',
  pump_stop: '',
  liters_filled: '',
  fuel_attendant_name: '',
  authorizer_name: '',
  price_per_litre: '',
});

export default function FuelData() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('fuel-data');
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('fuel_admin');
  const [permissions, setPermissions] = useState(null);
  const [grantUsers, setGrantUsers] = useState([]);
  const isSuperAdmin = user?.role === 'super_admin';

  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [verifiedTx, setVerifiedTx] = useState([]);
  const [unverifiedTx, setUnverifiedTx] = useState([]);
  const [txForm, setTxForm] = useState(emptyTxForm());
  const [txSaving, setTxSaving] = useState(false);

  const [custName, setCustName] = useState('');
  const [selCustomer, setSelCustomer] = useState('');
  const [receipts, setReceipts] = useState([]);

  const [supForm, setSupForm] = useState({
    name: '',
    address: '',
    vat_number: '',
    price_per_litre: '',
    vehicle_registration: '',
    fuel_attendant_name: '',
    is_default: false,
  });
  const [selSupplierEdit, setSelSupplierEdit] = useState('');

  const [analytics, setAnalytics] = useState(null);
  const [insights, setInsights] = useState('');
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [attSlipPath, setAttSlipPath] = useState('');
  const [attForm, setAttForm] = useState(emptyTxForm());
  const [attParsing, setAttParsing] = useState(false);
  const [attSubmitting, setAttSubmitting] = useState(false);
  const [slipCameraOpen, setSlipCameraOpen] = useState(false);

  const [emailTo, setEmailTo] = useState(user?.email || '');
  const [emailSupplierId, setEmailSupplierId] = useState('');
  const [emailCustomerId, setEmailCustomerId] = useState('');
  const [emailAttachPdf, setEmailAttachPdf] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  const [recordFormHidden, setRecordFormHidden] = useState(() => {
    try {
      return localStorage.getItem(FORM_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [filterDraft, setFilterDraft] = useState({
    supplier_id: '',
    customer_id: '',
    date_from: '',
    date_to: '',
    source: '',
    q: '',
  });
  const [txFilters, setTxFilters] = useState({});
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [showExportColumnFilters, setShowExportColumnFilters] = useState(false);

  const [exportColumnKeys, setExportColumnKeys] = useState(() => {
    try {
      const raw = localStorage.getItem(FUEL_EXPORT_COLS_STORAGE_KEY);
      if (!raw) return [...DEFAULT_EXPORT_COLUMN_KEYS];
      const parsed = JSON.parse(raw);
      const ordered = orderExportColumnKeys(Array.isArray(parsed) ? parsed : []);
      return ordered.length ? ordered : [...DEFAULT_EXPORT_COLUMN_KEYS];
    } catch {
      return [...DEFAULT_EXPORT_COLUMN_KEYS];
    }
  });

  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editAttachments, setEditAttachments] = useState([]);
  /** Verified table: paperclip row menu + files viewer modal */
  const [txRowMenuOpenId, setTxRowMenuOpenId] = useState(null);
  const [attachViewerModal, setAttachViewerModal] = useState(null);

  /** Verified rows selected on Fuel Admin for bulk delete / export subset */
  const [selectedVerifiedIds, setSelectedVerifiedIds] = useState([]);

  const [dashData, setDashData] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);

  const attendantDefaultSupplier = useMemo(() => {
    const def = suppliers.find((s) => s.is_default);
    if (def) return def;
    if (suppliers.length === 1) return suppliers[0];
    return null;
  }, [suppliers]);

  useEffect(() => {
    if (activeTab !== 'attendant_portal') return;
    if (!attendantDefaultSupplier) return;
    setAttForm((f) => {
      if (f.supplier_id) return f;
      return {
        ...f,
        supplier_id: attendantDefaultSupplier.id,
        supplier_name: f.supplier_name || attendantDefaultSupplier.name || '',
        price_per_litre:
          f.price_per_litre !== ''
            ? f.price_per_litre
            : attendantDefaultSupplier.price_per_litre != null
              ? String(attendantDefaultSupplier.price_per_litre)
              : '',
      };
    });
  }, [activeTab, attendantDefaultSupplier]);

  useEffect(() => {
    try {
      localStorage.setItem(FORM_COLLAPSE_KEY, recordFormHidden ? '1' : '0');
    } catch (_) {}
  }, [recordFormHidden]);

  useEffect(() => {
    try {
      localStorage.setItem(FUEL_EXPORT_COLS_STORAGE_KEY, JSON.stringify(exportColumnKeys));
    } catch (_) {}
  }, [exportColumnKeys]);

  useEffect(() => {
    if (!txRowMenuOpenId) return undefined;
    const close = (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-tx-files-menu]')) return;
      setTxRowMenuOpenId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [txRowMenuOpenId]);

  const toggleExportColumn = (key) => {
    setExportColumnKeys((prev) => {
      const set = new Set(prev);
      if (set.has(key)) {
        if (set.size <= 1) return prev;
        set.delete(key);
      } else {
        set.add(key);
      }
      return orderExportColumnKeys([...set]);
    });
  };

  const litersPreview = useMemo(() => {
    const a = parseFloat(txForm.pump_start, 10);
    const b = parseFloat(txForm.pump_stop, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(0, b - a);
    return null;
  }, [txForm.pump_start, txForm.pump_stop]);

  const loadLists = useCallback(() => {
    const p = [];
    if (
      allowedTabs.includes('fuel_admin') ||
      allowedTabs.includes('file_export') ||
      allowedTabs.includes('supplier_details') ||
      allowedTabs.includes('advanced_dashboard')
    ) {
      p.push(fuelData.suppliers().then((r) => setSuppliers(r.suppliers || [])).catch(() => setSuppliers([])));
    }
    if (
      allowedTabs.includes('fuel_admin') ||
      allowedTabs.includes('file_export') ||
      allowedTabs.includes('customer_details') ||
      allowedTabs.includes('advanced_dashboard')
    ) {
      p.push(fuelData.customers().then((r) => setCustomers(r.customers || [])).catch(() => setCustomers([])));
    }
    if (allowedTabs.includes('fuel_admin')) {
      const fq = { ...txFilters };
      p.push(
        fuelData.transactions({ status: 'verified', ...fq }).then((r) => setVerifiedTx(r.transactions || [])),
        fuelData.transactions({ status: 'unverified', ...fq }).then((r) => setUnverifiedTx(r.transactions || []))
      );
    }
    return Promise.all(p);
  }, [allowedTabs, txFilters]);

  useEffect(() => {
    let cancelled = false;
    fuelData
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
    if (activeTab === 'manage_tabs') return;
    const tabOk =
      allowedTabs.includes(activeTab) || (activeTab === 'file_export' && allowedTabs.includes('fuel_admin'));
    if (!tabOk) setActiveTab(allowedTabs[0]);
  }, [allowedTabs, activeTab]);

  useEffect(() => {
    if (!allowedTabs.length) return;
    loadLists().catch(() => {});
  }, [allowedTabs, loadLists]);

  useEffect(() => {
    if (activeTab === 'analytics' && allowedTabs.includes('analytics')) {
      fuelData.analyticsSummary().then(setAnalytics).catch(() => setAnalytics(null));
    }
    if (activeTab === 'advanced_dashboard' && allowedTabs.includes('advanced_dashboard')) {
      setDashLoading(true);
      Promise.all([fuelData.analyticsSummary(), fuelData.suppliers().catch(() => ({ suppliers: [] }))])
        .then(([an, sup]) => setDashData({ analytics: an, suppliers: sup.suppliers || [] }))
        .catch(() => setDashData(null))
        .finally(() => setDashLoading(false));
    }
  }, [activeTab, allowedTabs]);

  useEffect(() => {
    if (!selCustomer || !allowedTabs.includes('customer_details')) return;
    fuelData
      .customerReceipts(selCustomer)
      .then((r) => setReceipts(r.receipts || []))
      .catch(() => setReceipts([]));
  }, [selCustomer, activeTab, allowedTabs]);

  const navTabs = FD_TABS.filter((t) => {
    if (allowedTabs.includes(t.id)) return true;
    if (t.id === 'file_export' && allowedTabs.includes('fuel_admin')) return true;
    return false;
  });
  const sections = [...new Set(navTabs.map((t) => t.section))];
  const hasAccess = isSuperAdmin || allowedTabs.length > 0;
  const activeTabOk =
    activeTab === 'manage_tabs' ||
    allowedTabs.includes(activeTab) ||
    (activeTab === 'file_export' && allowedTabs.includes('fuel_admin'));
  const navAutoHideReady =
    !loading && hasAccess && (activeTabOk || (isSuperAdmin && allowedTabs.length === 0));
  useAutoHideNavAfterTabChange(activeTab, { ready: navAutoHideReady });

  const onSupplierPick = (id) => {
    const s = suppliers.find((x) => x.id === id);
    if (!id || !s) {
      setTxForm((f) => ({ ...f, supplier_id: '', supplier_name: '', price_per_litre: '' }));
      return;
    }
    setTxForm((f) => ({
      ...f,
      supplier_id: id,
      supplier_name: s.name || '',
      price_per_litre: s.price_per_litre != null ? String(s.price_per_litre) : '',
      supplier_vehicle_registration: s.vehicle_registration || f.supplier_vehicle_registration || '',
      fuel_attendant_name: s.fuel_attendant_name || f.fuel_attendant_name || '',
    }));
  };

  const onCustomerPick = (id) => {
    const c = customers.find((x) => x.id === id);
    if (!id || !c) {
      setTxForm((f) => ({ ...f, customer_id: '', customer_name: '' }));
      return;
    }
    setTxForm((f) => ({
      ...f,
      customer_id: id,
      customer_name: c.name || '',
      responsible_user_name: c.responsible_user_name || f.responsible_user_name || '',
      authorizer_name: c.authorizer_name || f.authorizer_name || '',
      vehicle_registration: c.vehicle_registration || f.vehicle_registration || '',
    }));
  };

  const submitManualTransaction = (e) => {
    e.preventDefault();
    setTxSaving(true);
    const liters = litersPreview != null ? litersPreview : null;
    fuelData
      .createTransaction({
        supplier_id: txForm.supplier_id || null,
        supplier_name: txForm.supplier_name,
        customer_id: txForm.customer_id || null,
        customer_name: txForm.customer_name,
        vehicle_tank: txForm.vehicle_tank,
        order_number: txForm.order_number || null,
        vehicle_registration: txForm.vehicle_registration || null,
        supplier_vehicle_registration: txForm.supplier_vehicle_registration || null,
        delivery_time: txForm.delivery_time || null,
        kilos: txForm.kilos,
        responsible_user_name: txForm.responsible_user_name,
        pump_start: txForm.pump_start,
        pump_stop: txForm.pump_stop,
        liters_filled: liters,
        fuel_attendant_name: txForm.fuel_attendant_name,
        authorizer_name: txForm.authorizer_name,
        price_per_litre: txForm.price_per_litre,
        source: 'manual',
      })
      .then(() => {
        setTxForm(emptyTxForm());
        return loadLists();
      })
      .catch((err) => setError(err.message || 'Save failed'))
      .finally(() => setTxSaving(false));
  };

  const verifyOne = (id) => {
    fuelData.verifyTransaction(id).then(() => loadLists()).catch((err) => setError(err.message));
  };

  const deleteTransactionRow = (id, { verified = false } = {}) => {
    const msg = verified
      ? 'Permanently delete this verified transaction? This cannot be undone.'
      : 'Remove this unverified transaction?';
    if (!window.confirm(msg)) return;
    fuelData
      .deleteTransaction(id)
      .then(() => {
        setSelectedVerifiedIds((prev) => prev.filter((x) => x !== id));
        return loadLists();
      })
      .catch((err) => setError(err.message));
  };

  const deleteUnverified = (id) => deleteTransactionRow(id, { verified: false });

  const deleteVerifiedOne = (id) => deleteTransactionRow(id, { verified: true });

  const bulkDeleteVerified = () => {
    if (!selectedVerifiedIds.length) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedVerifiedIds.length} verified transaction(s)? This cannot be undone.`
      )
    )
      return;
    fuelData
      .bulkDeleteTransactions(selectedVerifiedIds)
      .then(() => {
        setSelectedVerifiedIds([]);
        return loadLists();
      })
      .catch((err) => setError(err.message));
  };

  const addCustomer = () => {
    if (!custName.trim()) return;
    fuelData
      .createCustomer({ name: custName.trim() })
      .then(() => {
        setCustName('');
        return fuelData.customers();
      })
      .then((r) => setCustomers(r.customers || []))
      .catch((err) => setError(err.message));
  };

  const saveSelectedCustomerProfile = () => {
    if (!selCustomer) return;
    const c = customers.find((x) => x.id === selCustomer);
    if (!c) return;
    fuelData
      .patchCustomer(selCustomer, {
        name: c.name,
        vehicle_registration: c.vehicle_registration,
        responsible_user_name: c.responsible_user_name,
        authorizer_name: c.authorizer_name,
      })
      .then(() => fuelData.customers())
      .then((r) => setCustomers(r.customers || []))
      .catch((err) => setError(err.message));
  };

  const uploadReceipt = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selCustomer) return;
    const fd = new FormData();
    fd.append('file', file);
    fuelData.uploadCustomerReceipt(selCustomer, fd).then(() => {
      e.target.value = '';
      return fuelData.customerReceipts(selCustomer);
    }).then((r) => setReceipts(r.receipts || [])).catch((err) => setError(err.message));
  };

  const addSupplier = (e) => {
    e.preventDefault();
    fuelData
      .createSupplier({
        name: supForm.name,
        address: supForm.address,
        vat_number: supForm.vat_number,
        price_per_litre: supForm.price_per_litre,
        vehicle_registration: supForm.vehicle_registration || null,
        fuel_attendant_name: supForm.fuel_attendant_name || null,
        is_default: !!supForm.is_default,
      })
      .then(() => {
        setSupForm({
          name: '',
          address: '',
          vat_number: '',
          price_per_litre: '',
          vehicle_registration: '',
          fuel_attendant_name: '',
          is_default: false,
        });
        return fuelData.suppliers();
      })
      .then((r) => setSuppliers(r.suppliers || []))
      .catch((err) => setError(err.message));
  };

  const saveSupplierEdit = () => {
    if (!selSupplierEdit) return;
    const s = suppliers.find((x) => x.id === selSupplierEdit);
    if (!s) return;
    fuelData
      .patchSupplier(selSupplierEdit, {
        name: s.name,
        address: s.address,
        vat_number: s.vat_number,
        price_per_litre: s.price_per_litre,
        vehicle_registration: s.vehicle_registration,
        fuel_attendant_name: s.fuel_attendant_name,
        is_default: !!s.is_default,
      })
      .then(() => fuelData.suppliers())
      .then((r) => setSuppliers(r.suppliers || []))
      .catch((err) => setError(err.message));
  };

  const uploadSupplierLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selSupplierEdit) return;
    const fd = new FormData();
    fd.append('logo', file);
    fuelData.uploadSupplierLogo(selSupplierEdit, fd).then((r) => {
      e.target.value = '';
      if (r.supplier) setSuppliers((prev) => prev.map((x) => (x.id === r.supplier.id ? r.supplier : x)));
    }).catch((err) => setError(err.message));
  };

  const runParseSlipFile = useCallback((file) => {
    if (!file) return Promise.resolve();
    const fd = new FormData();
    fd.append('slip', file);
    setAttParsing(true);
    setError('');
    return fuelData
      .parseAttendantSlip(fd)
      .then((r) => {
        setAttSlipPath(r.slip_image_path || '');
        const ex = r.extracted || {};
        const defaultSup = suppliers.find((s) => s.is_default) || (suppliers.length === 1 ? suppliers[0] : null);
        const slipLiters = ex.liters_filled != null && ex.liters_filled !== '' ? String(ex.liters_filled) : '';
        setAttForm((prev) => ({
          ...prev,
          supplier_id: defaultSup?.id || prev.supplier_id || '',
          supplier_name: ex.supplier_name || defaultSup?.name || prev.supplier_name || '',
          customer_id: '',
          customer_name: ex.customer_name || '',
          vehicle_tank: ex.vehicle_tank || '',
          order_number: ex.order_number != null ? String(ex.order_number) : '',
          vehicle_registration: ex.vehicle_registration || '',
          supplier_vehicle_registration: ex.supplier_vehicle_registration || '',
          delivery_time: ex.delivery_time || '',
          kilos: ex.kilos != null ? String(ex.kilos) : '',
          responsible_user_name: ex.responsible_user_name || '',
          pump_start: ex.pump_start != null ? String(ex.pump_start) : '',
          pump_stop: ex.pump_stop != null ? String(ex.pump_stop) : '',
          liters_filled: slipLiters,
          fuel_attendant_name: ex.fuel_attendant_name || prev.fuel_attendant_name || '',
          authorizer_name: ex.authorizer_name || '',
          price_per_litre:
            prev.price_per_litre !== ''
              ? prev.price_per_litre
              : defaultSup?.price_per_litre != null
                ? String(defaultSup.price_per_litre)
                : '',
        }));
      })
      .catch((err) => setError(err.message || 'Could not read slip'))
      .finally(() => setAttParsing(false));
  }, [suppliers]);

  const parseSlip = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    runParseSlipFile(file).finally(() => {
      if (e.target) e.target.value = '';
    });
  };

  const approveAttendantRow = () => {
    setAttSubmitting(true);
    const defaultSup = suppliers.find((s) => s.is_default) || (suppliers.length === 1 ? suppliers[0] : null);
    const ps = parseFloat(attForm.pump_start, 10);
    const pe = parseFloat(attForm.pump_stop, 10);
    let liters = null;
    if (Number.isFinite(ps) && Number.isFinite(pe)) liters = Math.max(0, pe - ps);
    const litFromSlip = parseFloat(attForm.liters_filled, 10);
    if (Number.isFinite(litFromSlip) && litFromSlip >= 0) liters = litFromSlip;
    const attendantLabel = [user?.full_name, user?.email].filter(Boolean).join(' · ') || user?.email || '';
    fuelData
      .createTransaction({
        supplier_id: attForm.supplier_id || defaultSup?.id || null,
        supplier_name: attForm.supplier_name || defaultSup?.name || 'Unknown',
        customer_id: attForm.customer_id || null,
        customer_name: attForm.customer_name || 'Unknown',
        vehicle_tank: attForm.vehicle_tank,
        order_number: attForm.order_number || null,
        vehicle_registration: attForm.vehicle_registration || null,
        supplier_vehicle_registration: attForm.supplier_vehicle_registration || null,
        delivery_time: attForm.delivery_time || null,
        kilos: attForm.kilos,
        responsible_user_name: attForm.responsible_user_name,
        pump_start: attForm.pump_start,
        pump_stop: attForm.pump_stop,
        liters_filled: liters,
        fuel_attendant_name: attendantLabel || attForm.fuel_attendant_name || null,
        authorizer_name: attForm.authorizer_name,
        price_per_litre: attForm.price_per_litre,
        source: 'attendant_portal',
        slip_image_path: attSlipPath || null,
      })
      .then(() => {
        setAttForm(emptyTxForm());
        setAttSlipPath('');
        return loadLists();
      })
      .catch((err) => setError(err.message))
      .finally(() => setAttSubmitting(false));
  };

  const runInsights = () => {
    setInsightsLoading(true);
    setInsights('');
    fuelData
      .analyticsInsights()
      .then((r) => setInsights(r.insights || ''))
      .catch((err) => setError(err.message))
      .finally(() => setInsightsLoading(false));
  };

  const sendEmailSheet = () => {
    setEmailBusy(true);
    const colStr = exportColumnKeys.join(',');
    const filters = {
      ...txFilters,
      ...(emailSupplierId ? { supplier_id: emailSupplierId } : {}),
      ...(emailCustomerId ? { customer_id: emailCustomerId } : {}),
      ...(selectedVerifiedIds.length ? { ids: selectedVerifiedIds.join(',') } : {}),
      columns: colStr,
    };
    fuelData
      .emailTransactions({
        to: emailTo,
        filters,
        attach_pdf: emailAttachPdf,
        columns: colStr,
      })
      .then(() => setError(''))
      .catch((err) => setError(err.message))
      .finally(() => setEmailBusy(false));
  };

  const applyListFilters = () => {
    setSelectedVerifiedIds([]);
    const next = Object.fromEntries(
      Object.entries(filterDraft).filter(([, v]) => v != null && String(v).trim() !== '')
    );
    setTxFilters(next);
  };

  const exportQuery = useMemo(() => {
    const o = { status: 'verified', ...txFilters, columns: exportColumnKeys.join(',') };
    if (selectedVerifiedIds.length) o.ids = selectedVerifiedIds.join(',');
    Object.keys(o).forEach((k) => {
      if (o[k] === '' || o[k] == null) delete o[k];
    });
    return o;
  }, [txFilters, exportColumnKeys, selectedVerifiedIds]);

  const openEditTransaction = (id) => {
    setEditId(id);
    fuelData
      .getTransaction(id)
      .then((r) => {
        const t = r.transaction;
        setEditAttachments(r.attachments || []);
        setEditForm({
          supplier_id: t.supplier_id || '',
          supplier_name: t.supplier_name || '',
          customer_id: t.customer_id || '',
          customer_name: t.customer_name || '',
          vehicle_tank: t.vehicle_tank || '',
          order_number: t.order_number || '',
          vehicle_registration: t.vehicle_registration || '',
          supplier_vehicle_registration: t.supplier_vehicle_registration || '',
          delivery_time: t.delivery_time ? new Date(t.delivery_time).toISOString().slice(0, 16) : '',
          kilos: t.kilos != null ? String(t.kilos) : '',
          responsible_user_name: t.responsible_user_name || '',
          pump_start: t.pump_start != null ? String(t.pump_start) : '',
          pump_stop: t.pump_stop != null ? String(t.pump_stop) : '',
          fuel_attendant_name: t.fuel_attendant_name || '',
          authorizer_name: t.authorizer_name || '',
          price_per_litre: t.price_per_litre != null ? String(t.price_per_litre) : '',
        });
      })
      .catch((err) => setError(err.message));
  };

  const saveEditTransaction = () => {
    if (!editId || !editForm) return;
    const ps = parseFloat(editForm.pump_start, 10);
    const pe = parseFloat(editForm.pump_stop, 10);
    let liters = null;
    if (Number.isFinite(ps) && Number.isFinite(pe)) liters = Math.max(0, pe - ps);
    fuelData
      .patchTransaction(editId, {
        supplier_id: editForm.supplier_id || null,
        supplier_name: editForm.supplier_name,
        customer_id: editForm.customer_id || null,
        customer_name: editForm.customer_name,
        vehicle_tank: editForm.vehicle_tank,
        order_number: editForm.order_number || null,
        vehicle_registration: editForm.vehicle_registration || null,
        supplier_vehicle_registration: editForm.supplier_vehicle_registration || null,
        delivery_time: editForm.delivery_time || null,
        kilos: editForm.kilos,
        responsible_user_name: editForm.responsible_user_name,
        pump_start: editForm.pump_start,
        pump_stop: editForm.pump_stop,
        liters_filled: liters,
        fuel_attendant_name: editForm.fuel_attendant_name,
        authorizer_name: editForm.authorizer_name,
        price_per_litre: editForm.price_per_litre,
      })
      .then(() => {
        setEditId(null);
        setEditForm(null);
        return loadLists();
      })
      .catch((err) => setError(err.message));
  };

  const uploadEditAttachment = (e) => {
    const file = e.target.files?.[0];
    if (!file || !editId) return;
    const fd = new FormData();
    fd.append('file', file);
    fuelData
      .uploadTransactionAttachment(editId, fd)
      .then(() => fuelData.getTransaction(editId))
      .then((r) => setEditAttachments(r.attachments || []))
      .catch((err) => setError(err.message))
      .finally(() => {
        e.target.value = '';
      });
  };

  const openTransactionFilesModal = (id) => {
    setTxRowMenuOpenId(null);
    setAttachViewerModal({ id, loading: true, transaction: null, attachments: [] });
    fuelData
      .getTransaction(id)
      .then((r) =>
        setAttachViewerModal({
          id,
          loading: false,
          transaction: r.transaction,
          attachments: r.attachments || [],
        })
      )
      .catch((err) => {
        setError(err.message);
        setAttachViewerModal(null);
      });
  };

  const removeTransactionAttachment = (fileId, txId) => {
    if (!window.confirm('Remove this file from the transaction?')) return;
    fuelData
      .deleteTransactionAttachment(fileId)
      .then(() => fuelData.getTransaction(txId))
      .then((r) => {
        setAttachViewerModal((m) => {
          if (!m || String(m.id) !== String(txId)) return m;
          return { id: txId, loading: false, transaction: r.transaction, attachments: r.attachments || [] };
        });
        if (editId && String(editId) === String(txId)) setEditAttachments(r.attachments || []);
        loadLists().catch(() => {});
      })
      .catch((err) => setError(err.message));
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-surface-500">Loading Fuel Data…</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 p-6 text-amber-900 dark:text-amber-100">
          <h2 className="font-semibold text-lg">Fuel Data</h2>
          <p className="mt-2 text-sm">
            You do not have access to any tabs. Ask a super admin to grant tab access under Manage tabs (and assign the Fuel Data page in User management).
          </p>
        </div>
      </div>
    );
  }

  const mobileTabOptions = [
    ...navTabs.map((t) => ({ value: t.id, label: t.label })),
    ...(isSuperAdmin ? [{ value: 'manage_tabs', label: 'Manage tabs' }] : []),
  ];

  const txTable = (rows, opts) => {
    const sel = opts?.verifiedSelection;
    const selSet = sel ? new Set(sel.selectedIds || []) : null;
    const allOnPageSelected =
      sel && rows?.length > 0 && rows.every((r) => selSet.has(String(r.id)));
    const someOnPageSelected = sel && rows?.some((r) => selSet.has(String(r.id)));
    const showFilesMenu = !!opts?.filesMenu;
    const showEditCol = !!opts?.edit && !showFilesMenu;
    const showDelCol = !!opts?.onDeleteVerified && !showFilesMenu;

    return (
    <div className="overflow-x-auto app-glass-card w-full">
      <table className="w-full text-sm min-w-[1200px]">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50 dark:bg-surface-900/50">
            {sel ? (
              <th className="px-2 py-2 w-10 text-center">
                <input
                  type="checkbox"
                  title="Select all on this page"
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                  }}
                  onChange={() => {
                    if (allOnPageSelected) sel.onClearPage(rows);
                    else sel.onSelectPage(rows);
                  }}
                  className="rounded border-surface-300"
                />
              </th>
            ) : null}
            <th className="px-2 py-2 text-left">Supplier</th>
            <th className="px-2 py-2 text-left">Customer</th>
            <th className="px-2 py-2 text-left">Vehicle / tank</th>
            <th className="px-2 py-2 text-left">Order</th>
            <th className="px-2 py-2 text-left">Customer fleet</th>
            <th className="px-2 py-2 text-left">Supplier vehicle</th>
            <th className="px-2 py-2 text-left">Delivery</th>
            <th className="px-2 py-2 text-right">Liters</th>
            <th className="px-2 py-2 text-right">ZAR</th>
            <th className="px-2 py-2 text-left">Source</th>
            {showFilesMenu ? (
              <th className="px-2 py-2 text-center w-14" scope="col" title="Attachments: view, download, edit row, delete row">
                <span className="sr-only">Attachments</span>
                <svg className="w-4 h-4 mx-auto text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.696 18.175a1.5 1.5 0 01-2.122-2.122l9.19-9.19"
                  />
                </svg>
              </th>
            ) : null}
            {showEditCol ? <th className="px-2 py-2 text-left">Edit</th> : null}
            {showDelCol ? <th className="px-2 py-2 text-left">Delete</th> : null}
            {opts?.actions ? <th className="px-2 py-2 text-left">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((t) => (
            <tr key={t.id} className="border-b border-surface-100 dark:border-surface-800">
              {sel ? (
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={selSet.has(String(t.id))}
                    onChange={() => sel.onToggle(String(t.id))}
                    className="rounded border-surface-300"
                  />
                </td>
              ) : null}
              <td className="px-2 py-1.5">{t.supplier_name}</td>
              <td className="px-2 py-1.5">{t.customer_name}</td>
              <td className="px-2 py-1.5">{t.vehicle_tank || '—'}</td>
              <td className="px-2 py-1.5">{t.order_number || '—'}</td>
              <td className="px-2 py-1.5">{t.vehicle_registration || '—'}</td>
              <td className="px-2 py-1.5">{t.supplier_vehicle_registration || '—'}</td>
              <td className="px-2 py-1.5">{formatDt(t.delivery_time)}</td>
              <td className="px-2 py-1.5 text-right">{t.liters_filled != null ? t.liters_filled : '—'}</td>
              <td className="px-2 py-1.5 text-right">{t.amount_rand != null ? t.amount_rand.toFixed(2) : '—'}</td>
              <td className="px-2 py-1.5">{t.source}</td>
              {showFilesMenu ? (
                <td className="px-2 py-1.5 text-center align-middle" data-tx-files-menu onClick={(e) => e.stopPropagation()}>
                  <div className="relative inline-flex">
                    <button
                      type="button"
                      className="p-1.5 rounded-lg border border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800"
                      aria-label="Transaction files and actions"
                      aria-haspopup="menu"
                      aria-expanded={txRowMenuOpenId === String(t.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTxRowMenuOpenId((prev) => (prev === String(t.id) ? null : String(t.id)));
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.696 18.175a1.5 1.5 0 01-2.122-2.122l9.19-9.19"
                        />
                      </svg>
                    </button>
                    {txRowMenuOpenId === String(t.id) ? (
                      <div
                        className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 shadow-lg py-1 text-left"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full px-3 py-2 text-left text-sm text-surface-800 dark:text-surface-100 hover:bg-surface-50 dark:hover:bg-surface-800"
                          onClick={() => openTransactionFilesModal(t.id)}
                        >
                          View / download
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full px-3 py-2 text-left text-sm text-surface-800 dark:text-surface-100 hover:bg-surface-50 dark:hover:bg-surface-800"
                          onClick={() => {
                            setTxRowMenuOpenId(null);
                            openEditTransaction(t.id);
                          }}
                        >
                          Edit
                        </button>
                        {opts.onDeleteVerified ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => {
                              setTxRowMenuOpenId(null);
                              opts.onDeleteVerified(t.id);
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </td>
              ) : null}
              {showEditCol ? (
                <td className="px-2 py-1.5">
                  <button type="button" className="text-xs text-brand-600 font-medium underline" onClick={() => openEditTransaction(t.id)}>
                    Edit
                  </button>
                </td>
              ) : null}
              {showDelCol ? (
                <td className="px-2 py-1.5">
                  <button type="button" className="text-xs text-red-600 font-medium" onClick={() => opts.onDeleteVerified(t.id)}>
                    Delete
                  </button>
                </td>
              ) : null}
              {opts?.actions ? (
                <td className="px-2 py-1.5 space-x-2">
                  {t.slip_image_path ? (
                    <button
                      type="button"
                      className="text-brand-600 text-xs underline"
                      onClick={() => openAttachmentWithAuth(fuelData.transactionSlipUrl(t.id)).catch((err) => setError(err.message))}
                    >
                      Slip
                    </button>
                  ) : null}
                  <button type="button" className="text-xs text-brand-700 font-medium" onClick={() => verifyOne(t.id)}>
                    Verify
                  </button>
                  <button type="button" className="text-xs text-red-600" onClick={() => deleteUnverified(t.id)}>
                    Remove
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    );
  };

  return (
    <div className="flex gap-0 w-full min-h-0 -m-4 sm:-m-6 flex-col md:flex-row">
      <nav
        className={`hidden md:flex shrink-0 flex-col app-glass-secondary-nav transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Fuel Data"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Fuel Data</h2>
              <InfoHint title="Fuel Data" text="Record diesel transactions, manage customers and suppliers, analytics, and attendant slip capture. Tab access is managed separately from the main app page role." />
            </div>
            {user?.tenant_name ? (
              <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mt-0.5">{user.tenant_name}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100"
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
                            ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium dark:bg-brand-950/50 dark:text-brand-200'
                            : 'text-surface-600 hover:bg-surface-50 border-l-2 border-l-transparent dark:hover:bg-surface-900/50'
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
              <ul>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveTab('manage_tabs')}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${
                      activeTab === 'manage_tabs'
                        ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                        : 'text-surface-600 hover:bg-surface-50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <TabIcon name="settings" className="w-5 h-5 shrink-0" />
                    Manage tabs
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 p-4 sm:p-6 space-y-4">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="hidden md:flex self-start items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-200 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}
        <div className="md:hidden flex items-center gap-2">
          <label className="text-xs text-surface-500 shrink-0">Tab</label>
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

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-200 flex justify-between gap-2">
            <span>{error}</span>
            <button type="button" className="shrink-0 underline" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        ) : null}

        {activeTab === 'manage_tabs' && isSuperAdmin ? (
          <FuelDataManageTabs
            isSuperAdmin={isSuperAdmin}
            permissions={permissions}
            setPermissions={setPermissions}
            users={grantUsers}
            setUsers={setGrantUsers}
            allTabIds={GRANT_TAB_IDS}
          />
        ) : null}

        {activeTab === 'fuel_admin' && allowedTabs.includes('fuel_admin') ? (
          <div className="space-y-8 w-full">
            <FuelDataTxFilterCard
              filterDraft={filterDraft}
              setFilterDraft={setFilterDraft}
              showAdvFilters={showAdvFilters}
              setShowAdvFilters={setShowAdvFilters}
              suppliers={suppliers}
              customers={customers}
              applyListFilters={applyListFilters}
              setTxFilters={setTxFilters}
              onClearFilters={() => setSelectedVerifiedIds([])}
            />

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Record a transaction</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 dark:text-surface-300"
                    onClick={() => setRecordFormHidden(true)}
                  >
                    Archive / hide form
                  </button>
                  {recordFormHidden ? (
                    <button
                      type="button"
                      className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white"
                      onClick={() => setRecordFormHidden(false)}
                    >
                      Show form
                    </button>
                  ) : null}
                </div>
              </div>
              {!recordFormHidden ? (
              <form onSubmit={submitManualTransaction} className="app-glass-card p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="block text-xs text-surface-500">
                  Supplier
                  <select className={inputClass('mt-1')} value={txForm.supplier_id} onChange={(e) => onSupplierPick(e.target.value)}>
                    <option value="">— Select —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (R{s.price_per_litre}/L){s.is_default ? ' · default' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-surface-500">
                  Supplier name
                  <input className={inputClass('mt-1')} value={txForm.supplier_name} onChange={(e) => setTxForm((f) => ({ ...f, supplier_name: e.target.value }))} required />
                </label>
                <label className="block text-xs text-surface-500">
                  Customer
                  <select className={inputClass('mt-1')} value={txForm.customer_id} onChange={(e) => onCustomerPick(e.target.value)}>
                    <option value="">— Select —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-surface-500">
                  Customer name
                  <input className={inputClass('mt-1')} value={txForm.customer_name} onChange={(e) => setTxForm((f) => ({ ...f, customer_name: e.target.value }))} required />
                </label>
                <label className="block text-xs text-surface-500">
                  Vehicle / tank
                  <input className={inputClass('mt-1')} value={txForm.vehicle_tank} onChange={(e) => setTxForm((f) => ({ ...f, vehicle_tank: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Order number
                  <input
                    className={inputClass('mt-1')}
                    value={txForm.order_number}
                    onChange={(e) => setTxForm((f) => ({ ...f, order_number: e.target.value }))}
                    placeholder="e.g. delivery order no."
                  />
                </label>
                <label className="block text-xs text-surface-500">
                  Customer vehicle (fleet / registration)
                  <input
                    className={inputClass('mt-1')}
                    value={txForm.vehicle_registration}
                    onChange={(e) => setTxForm((f) => ({ ...f, vehicle_registration: e.target.value }))}
                    placeholder="Vehicle receiving fuel"
                  />
                </label>
                <label className="block text-xs text-surface-500">
                  Supplier vehicle (tanker / truck registration)
                  <input
                    className={inputClass('mt-1')}
                    value={txForm.supplier_vehicle_registration}
                    onChange={(e) => setTxForm((f) => ({ ...f, supplier_vehicle_registration: e.target.value }))}
                    placeholder="Filled from supplier master when you pick supplier"
                  />
                </label>
                <label className="block text-xs text-surface-500">
                  Delivery time
                  <input type="datetime-local" className={inputClass('mt-1')} value={txForm.delivery_time} onChange={(e) => setTxForm((f) => ({ ...f, delivery_time: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Kilos
                  <input type="number" step="any" className={inputClass('mt-1')} value={txForm.kilos} onChange={(e) => setTxForm((f) => ({ ...f, kilos: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Responsible user
                  <input className={inputClass('mt-1')} value={txForm.responsible_user_name} onChange={(e) => setTxForm((f) => ({ ...f, responsible_user_name: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Pump start
                  <input type="number" step="any" className={inputClass('mt-1')} value={txForm.pump_start} onChange={(e) => setTxForm((f) => ({ ...f, pump_start: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Pump stop
                  <input type="number" step="any" className={inputClass('mt-1')} value={txForm.pump_stop} onChange={(e) => setTxForm((f) => ({ ...f, pump_stop: e.target.value }))} />
                </label>
                <div className="text-sm text-surface-600 dark:text-surface-400 flex items-end pb-1">
                  Liters filled (auto): <span className="ml-2 font-semibold text-surface-900 dark:text-surface-100">{litersPreview != null ? litersPreview.toFixed(3) : '—'}</span>
                </div>
                <label className="block text-xs text-surface-500">
                  Price / litre (R)
                  <input type="number" step="any" className={inputClass('mt-1')} value={txForm.price_per_litre} onChange={(e) => setTxForm((f) => ({ ...f, price_per_litre: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Fuel attendant name
                  <input className={inputClass('mt-1')} value={txForm.fuel_attendant_name} onChange={(e) => setTxForm((f) => ({ ...f, fuel_attendant_name: e.target.value }))} />
                </label>
                <label className="block text-xs text-surface-500">
                  Authorizer (received by)
                  <input className={inputClass('mt-1')} value={txForm.authorizer_name} onChange={(e) => setTxForm((f) => ({ ...f, authorizer_name: e.target.value }))} />
                </label>
                <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2 pt-2">
                  <button type="submit" disabled={txSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
                    {txSaving ? 'Saving…' : 'Save transaction'}
                  </button>
                </div>
              </form>
              ) : (
                <p className="text-sm text-surface-500">Form is hidden. Use &quot;Show form&quot; to record again.</p>
              )}
            </section>

            {unverifiedTx.length > 0 ? (
              <section>
                <h3 className="text-md font-semibold mb-2 text-amber-800 dark:text-amber-200">Unverified (attendant / pending)</h3>
                {txTable(unverifiedTx, { actions: true })}
              </section>
            ) : null}

            <section className="w-full">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Verified transactions</h3>
                <div className="flex flex-wrap gap-2 items-center">
                  {selectedVerifiedIds.length > 0 ? (
                    <>
                      <span className="text-xs text-surface-600 dark:text-surface-400">{selectedVerifiedIds.length} selected</span>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-lg border border-surface-300"
                        onClick={() => setSelectedVerifiedIds([])}
                      >
                        Clear selection
                      </button>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-surface-100"
                        onClick={() =>
                          downloadAttachmentWithAuth(fuelData.exportExcelUrl(exportQuery), 'fuel-data-selected.xlsx').catch((err) =>
                            setError(err.message)
                          )
                        }
                      >
                        Excel (selected)
                      </button>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-surface-100"
                        onClick={() =>
                          downloadAttachmentWithAuth(fuelData.exportPdfUrl(exportQuery), 'fuel-data-selected.pdf').catch((err) =>
                            setError(err.message)
                          )
                        }
                      >
                        PDF (selected)
                      </button>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white"
                        onClick={bulkDeleteVerified}
                      >
                        Delete selected
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-surface-500">Tick rows to export or delete multiple at once.</span>
                  )}
                </div>
              </div>
              {txTable(verifiedTx, {
                filesMenu: true,
                onDeleteVerified: deleteVerifiedOne,
                verifiedSelection: {
                  selectedIds: selectedVerifiedIds,
                  onToggle: (id) =>
                    setSelectedVerifiedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
                  onSelectPage: (rows) =>
                    setSelectedVerifiedIds((prev) => [...new Set([...prev, ...(rows || []).map((r) => String(r.id))])]),
                  onClearPage: (rows) => {
                    const drop = new Set((rows || []).map((r) => String(r.id)));
                    setSelectedVerifiedIds((prev) => prev.filter((id) => !drop.has(id)));
                  },
                },
              })}
            </section>

            {editId && editForm ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog">
                <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Edit transaction</h3>
                    <button type="button" className="text-surface-500" onClick={() => { setEditId(null); setEditForm(null); }}>
                      ✕
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-surface-500">
                      Supplier name
                      <input className={inputClass('mt-1')} value={editForm.supplier_name} onChange={(e) => setEditForm((f) => ({ ...f, supplier_name: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Customer name
                      <input className={inputClass('mt-1')} value={editForm.customer_name} onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Vehicle / tank
                      <input className={inputClass('mt-1')} value={editForm.vehicle_tank} onChange={(e) => setEditForm((f) => ({ ...f, vehicle_tank: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Order number
                      <input className={inputClass('mt-1')} value={editForm.order_number} onChange={(e) => setEditForm((f) => ({ ...f, order_number: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Customer vehicle (fleet)
                      <input
                        className={inputClass('mt-1')}
                        value={editForm.vehicle_registration}
                        onChange={(e) => setEditForm((f) => ({ ...f, vehicle_registration: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-surface-500">
                      Supplier vehicle
                      <input
                        className={inputClass('mt-1')}
                        value={editForm.supplier_vehicle_registration}
                        onChange={(e) => setEditForm((f) => ({ ...f, supplier_vehicle_registration: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-surface-500 sm:col-span-2">
                      Delivery time
                      <input
                        type="datetime-local"
                        className={inputClass('mt-1')}
                        value={editForm.delivery_time}
                        onChange={(e) => setEditForm((f) => ({ ...f, delivery_time: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-surface-500">
                      Pump start
                      <input className={inputClass('mt-1')} value={editForm.pump_start} onChange={(e) => setEditForm((f) => ({ ...f, pump_start: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Pump stop
                      <input className={inputClass('mt-1')} value={editForm.pump_stop} onChange={(e) => setEditForm((f) => ({ ...f, pump_stop: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Price / litre
                      <input className={inputClass('mt-1')} value={editForm.price_per_litre} onChange={(e) => setEditForm((f) => ({ ...f, price_per_litre: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Kilos
                      <input className={inputClass('mt-1')} value={editForm.kilos} onChange={(e) => setEditForm((f) => ({ ...f, kilos: e.target.value }))} />
                    </label>
                    <label className="text-xs text-surface-500">
                      Responsible user
                      <input
                        className={inputClass('mt-1')}
                        value={editForm.responsible_user_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, responsible_user_name: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-surface-500">
                      Fuel attendant
                      <input
                        className={inputClass('mt-1')}
                        value={editForm.fuel_attendant_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, fuel_attendant_name: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-surface-500 sm:col-span-2">
                      Authorizer (received by)
                      <input className={inputClass('mt-1')} value={editForm.authorizer_name} onChange={(e) => setEditForm((f) => ({ ...f, authorizer_name: e.target.value }))} />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-surface-500 mb-1">Attachments</p>
                    <ul className="text-sm space-y-2 mb-2">
                      {(editAttachments || []).map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2 gap-y-1">
                          <span className="text-surface-800 dark:text-surface-100 truncate max-w-[12rem]">{a.original_name || a.id}</span>
                          <button
                            type="button"
                            className="text-xs text-brand-600 font-medium underline"
                            onClick={() =>
                              openAttachmentWithAuth(fuelData.transactionAttachmentUrl(a.id)).catch((err) => setError(err.message))
                            }
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="text-xs text-brand-600 font-medium underline"
                            onClick={() =>
                              downloadAttachmentWithAuth(fuelData.transactionAttachmentUrl(a.id), a.original_name || 'file').catch((err) =>
                                setError(err.message)
                              )
                            }
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-600 font-medium"
                            onClick={() => removeTransactionAttachment(a.id, editId)}
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                    <input type="file" accept="image/*,.pdf" onChange={uploadEditAttachment} className="text-sm" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" className="px-3 py-2 rounded-lg border border-surface-300 text-sm" onClick={() => { setEditId(null); setEditForm(null); }}>
                      Cancel
                    </button>
                    <button type="button" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm" onClick={saveEditTransaction}>
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {attachViewerModal ? (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
                role="dialog"
                aria-modal="true"
                aria-labelledby="fuel-tx-files-title"
              >
                <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 border border-surface-200 dark:border-surface-700">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <h3 id="fuel-tx-files-title" className="text-lg font-semibold text-surface-900 dark:text-surface-50">
                        Transaction files
                      </h3>
                      {!attachViewerModal.loading && attachViewerModal.transaction ? (
                        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                          {attachViewerModal.transaction.supplier_name} · {formatDt(attachViewerModal.transaction.delivery_time)} ·{' '}
                          {attachViewerModal.transaction.liters_filled != null ? `${attachViewerModal.transaction.liters_filled} L` : '—'}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="text-surface-500 hover:text-surface-800 shrink-0"
                      onClick={() => setAttachViewerModal(null)}
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>
                  {attachViewerModal.loading ? (
                    <p className="text-sm text-surface-500">Loading…</p>
                  ) : (
                    <div className="space-y-4">
                      {attachViewerModal.transaction?.slip_image_path ? (
                        <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
                          <p className="text-xs font-medium text-surface-500 uppercase">Attendant slip</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
                              onClick={() =>
                                openAttachmentWithAuth(fuelData.transactionSlipUrl(attachViewerModal.id)).catch((err) =>
                                  setError(err.message)
                                )
                              }
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
                              onClick={() =>
                                downloadAttachmentWithAuth(
                                  fuelData.transactionSlipUrl(attachViewerModal.id),
                                  `slip-${String(attachViewerModal.id).slice(0, 8)}.jpg`
                                ).catch((err) => setError(err.message))
                              }
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-xs font-medium text-surface-500 uppercase mb-2">Uploaded attachments</p>
                        {(attachViewerModal.attachments || []).length === 0 ? (
                          <p className="text-sm text-surface-500">No extra files on this transaction.</p>
                        ) : (
                          <ul className="space-y-2">
                            {(attachViewerModal.attachments || []).map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-surface-100 dark:border-surface-800 p-3"
                              >
                                <span className="text-sm text-surface-800 dark:text-surface-100 break-all">{a.original_name || a.id}</span>
                                <div className="flex flex-wrap gap-2 shrink-0">
                                  <button
                                    type="button"
                                    className="text-xs px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
                                    onClick={() =>
                                      openAttachmentWithAuth(fuelData.transactionAttachmentUrl(a.id)).catch((err) => setError(err.message))
                                    }
                                  >
                                    View
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
                                    onClick={() =>
                                      downloadAttachmentWithAuth(
                                        fuelData.transactionAttachmentUrl(a.id),
                                        a.original_name || 'attachment'
                                      ).catch((err) => setError(err.message))
                                    }
                                  >
                                    Download
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs px-2.5 py-1 rounded-md text-red-600 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40"
                                    onClick={() => removeTransactionAttachment(a.id, attachViewerModal.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end pt-2 border-t border-surface-100 dark:border-surface-800">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border border-surface-300 text-sm"
                      onClick={() => setAttachViewerModal(null)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'file_export' && (allowedTabs.includes('file_export') || allowedTabs.includes('fuel_admin')) ? (
          <div className="space-y-8 w-full">
            <div>
              <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">File Export</h3>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Download Excel or PDF, configure columns, and email transaction sheets. Use the same filters as Fuel Admin — click{' '}
                <strong className="text-surface-800 dark:text-surface-100">Apply filters</strong> before exporting so files match the rows you need.
                If you selected specific rows on the <strong>Fuel Admin</strong> tab, exports and email here use that selection until you clear it.
              </p>
            </div>
            <FuelDataTxFilterCard
              filterDraft={filterDraft}
              setFilterDraft={setFilterDraft}
              showAdvFilters={showAdvFilters}
              setShowAdvFilters={setShowAdvFilters}
              suppliers={suppliers}
              customers={customers}
              applyListFilters={applyListFilters}
              setTxFilters={setTxFilters}
              onClearFilters={() => setSelectedVerifiedIds([])}
            />

            <section className="space-y-3">
              <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Exports (Excel &amp; PDF)</h3>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg border border-surface-300 text-sm"
                    onClick={() =>
                      downloadAttachmentWithAuth(fuelData.exportExcelUrl(exportQuery), 'fuel-data-transactions.xlsx').catch((err) =>
                        setError(err.message)
                      )
                    }
                  >
                    Download Excel (filtered)
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg border border-surface-300 text-sm"
                    onClick={() =>
                      downloadAttachmentWithAuth(fuelData.exportPdfUrl(exportQuery), 'fuel-data-statement.pdf').catch((err) =>
                        setError(err.message)
                      )
                    }
                  >
                    Download PDF statement
                  </button>
                </div>
                <button
                  type="button"
                  className="text-xs text-brand-600 dark:text-brand-400 underline underline-offset-2"
                  onClick={() => setShowExportColumnFilters((v) => !v)}
                >
                  {showExportColumnFilters ? 'Hide column layout' : 'Show column layout (advanced)'}
                </button>
              </div>
              {showExportColumnFilters ? (
                <div className="app-glass-card p-4 space-y-3 w-full">
                  <p className="text-xs text-surface-500">
                    These columns apply to Excel and PDF downloads and to emailed sheets (same as list filters). Your choices are saved in this browser.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border border-surface-300"
                      onClick={() => setExportColumnKeys([...DEFAULT_EXPORT_COLUMN_KEYS])}
                    >
                      Select all columns
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded border border-surface-300"
                      onClick={() =>
                        setExportColumnKeys(['supplier_name', 'customer_name', 'delivery_time', 'liters_filled', 'amount_rand'])
                      }
                    >
                      Minimal set
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                    {FUEL_EXPORT_COLUMN_OPTIONS.map((opt) => (
                      <label key={opt.key} className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exportColumnKeys.includes(opt.key)}
                          onChange={() => toggleExportColumn(opt.key)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-md font-semibold">Email transaction sheet</h3>
                <InfoHint
                  title="What is included in the email export"
                  text={
                    <div className="space-y-2">
                      <p>This send follows the same rules as manual Excel/PDF downloads on this tab.</p>
                      <ul className="list-disc pl-4 space-y-1.5">
                        <li>
                          <strong>Transaction filters:</strong> rows match the list after you click <strong>Apply filters</strong> (dates, supplier, customer,
                          source, search).
                        </li>
                        <li>
                          <strong>Optional overrides:</strong> the supplier and customer dropdowns below narrow the export further on top of those filters.
                        </li>
                        <li>
                          <strong>Columns:</strong> Excel and PDF attachments use the column layout from <strong>Show column layout (advanced)</strong> above.
                        </li>
                      </ul>
                    </div>
                  }
                />
              </div>
              <div className="app-glass-card p-4 flex flex-wrap gap-3 items-end">
                <label className="text-xs text-surface-500 block">
                  To
                  <input className={inputClass('mt-1 w-56')} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
                </label>
                <label className="text-xs text-surface-500 block">
                  Filter supplier (optional)
                  <select className={inputClass('mt-1 w-56')} value={emailSupplierId} onChange={(e) => setEmailSupplierId(e.target.value)}>
                    <option value="">All suppliers</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-surface-500 block">
                  Filter customer (optional)
                  <select className={inputClass('mt-1 w-56')} value={emailCustomerId} onChange={(e) => setEmailCustomerId(e.target.value)}>
                    <option value="">All customers</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-surface-600 mt-6 cursor-pointer">
                  <input type="checkbox" checked={emailAttachPdf} onChange={(e) => setEmailAttachPdf(e.target.checked)} />
                  Attach PDF statement
                </label>
                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={sendEmailSheet}
                  className="px-4 py-2 rounded-lg bg-surface-900 text-white text-sm dark:bg-surface-100 dark:text-surface-900 disabled:opacity-50"
                >
                  {emailBusy ? 'Sending…' : 'Send email (uses filters + options above)'}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'customer_details' && allowedTabs.includes('customer_details') ? (
          <div className="space-y-6 w-full">
            <h3 className="text-md font-semibold">Customers & receipts</h3>
            <div className="app-glass-card p-4 space-y-3">
              <div className="flex gap-2">
                <input className={inputClass()} placeholder="New customer name" value={custName} onChange={(e) => setCustName(e.target.value)} />
                <button type="button" onClick={addCustomer} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm shrink-0">
                  Add
                </button>
              </div>
              <label className="block text-xs text-surface-500">
                Select customer
                <select className={inputClass('mt-1')} value={selCustomer} onChange={(e) => setSelCustomer(e.target.value)}>
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <p className="text-xs text-surface-500 mb-1">Upload receipt / photo</p>
                <input type="file" accept="image/*,.pdf" disabled={!selCustomer} onChange={uploadReceipt} className="text-sm" />
              </div>
              {selCustomer ? (
                <div className="pt-3 border-t border-surface-100 dark:border-surface-800 space-y-2">
                  <p className="text-xs font-medium text-surface-600">Customer profile (saved to master data)</p>
                  {(() => {
                    const c = customers.find((x) => x.id === selCustomer);
                    if (!c) return null;
                    return (
                      <div className="grid gap-2">
                        <label className="text-xs text-surface-500">
                          Customer vehicle (fleet / registration)
                          <input
                            className={inputClass('mt-1')}
                            value={c.vehicle_registration || ''}
                            onChange={(e) =>
                              setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, vehicle_registration: e.target.value } : x)))
                            }
                          />
                        </label>
                        <label className="text-xs text-surface-500">
                          Responsible user
                          <input
                            className={inputClass('mt-1')}
                            value={c.responsible_user_name || ''}
                            onChange={(e) =>
                              setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, responsible_user_name: e.target.value } : x)))
                            }
                          />
                        </label>
                        <label className="text-xs text-surface-500">
                          Authorizer name
                          <input
                            className={inputClass('mt-1')}
                            value={c.authorizer_name || ''}
                            onChange={(e) =>
                              setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, authorizer_name: e.target.value } : x)))
                            }
                          />
                        </label>
                        <button type="button" onClick={saveSelectedCustomerProfile} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm w-fit">
                          Save customer details
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>
            {selCustomer ? (
              <ul className="text-sm space-y-2">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-brand-600 underline"
                      onClick={() => downloadAttachmentWithAuth(fuelData.receiptDownloadUrl(r.id), r.original_name || 'receipt').catch((err) => setError(err.message))}
                    >
                      {r.original_name || r.id}
                    </button>
                    <span className="text-surface-400">{formatDt(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'supplier_details' && allowedTabs.includes('supplier_details') ? (
          <div className="space-y-6 w-full">
            <h3 className="text-md font-semibold">Suppliers</h3>
            <form onSubmit={addSupplier} className="app-glass-card p-4 grid gap-3">
              <input className={inputClass()} placeholder="Supplier name *" value={supForm.name} onChange={(e) => setSupForm((s) => ({ ...s, name: e.target.value }))} required />
              <textarea className={inputClass()} placeholder="Address" rows={2} value={supForm.address} onChange={(e) => setSupForm((s) => ({ ...s, address: e.target.value }))} />
              <input className={inputClass()} placeholder="VAT number" value={supForm.vat_number} onChange={(e) => setSupForm((s) => ({ ...s, vat_number: e.target.value }))} />
              <input className={inputClass()} type="number" step="any" placeholder="Price per litre (ZAR)" value={supForm.price_per_litre} onChange={(e) => setSupForm((s) => ({ ...s, price_per_litre: e.target.value }))} />
              <input
                className={inputClass()}
                placeholder="Supplier vehicle (tanker / truck registration)"
                value={supForm.vehicle_registration}
                onChange={(e) => setSupForm((s) => ({ ...s, vehicle_registration: e.target.value }))}
              />
              <input
                className={inputClass()}
                placeholder="Default fuel attendant name (optional)"
                value={supForm.fuel_attendant_name}
                onChange={(e) => setSupForm((s) => ({ ...s, fuel_attendant_name: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                <input type="checkbox" checked={supForm.is_default} onChange={(e) => setSupForm((s) => ({ ...s, is_default: e.target.checked }))} />
                Set as default supplier (used on fuel attendant portal when not otherwise specified)
              </label>
              <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm w-fit">
                Add supplier
              </button>
            </form>
            <div className="app-glass-card p-4 space-y-3">
              <label className="text-xs text-surface-500 block">
                Edit supplier
                <select className={inputClass('mt-1')} value={selSupplierEdit} onChange={(e) => setSelSupplierEdit(e.target.value)}>
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.is_default ? ' · default' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {selSupplierEdit ? (
                <>
                  {(() => {
                    const s = suppliers.find((x) => x.id === selSupplierEdit);
                    if (!s) return null;
                    return (
                      <div className="grid gap-2">
                        {s.logo_file_path ? (
                          <img src={fuelData.supplierLogoUrl(s.id)} alt="" className="h-16 w-auto object-contain border border-surface-200 rounded" />
                        ) : null}
                        <input className={inputClass()} value={s.name} onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                        <textarea className={inputClass()} rows={2} value={s.address || ''} onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, address: e.target.value } : x)))} />
                        <input className={inputClass()} value={s.vat_number || ''} onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, vat_number: e.target.value } : x)))} />
                        <input className={inputClass()} type="number" step="any" value={s.price_per_litre} onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, price_per_litre: parseFloat(e.target.value, 10) || 0 } : x)))} />
                        <input
                          className={inputClass()}
                          placeholder="Supplier vehicle (tanker / truck registration)"
                          value={s.vehicle_registration || ''}
                          onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, vehicle_registration: e.target.value } : x)))}
                        />
                        <input
                          className={inputClass()}
                          placeholder="Default fuel attendant name (optional)"
                          value={s.fuel_attendant_name || ''}
                          onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, fuel_attendant_name: e.target.value } : x)))}
                        />
                        <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!s.is_default}
                            onChange={(e) => setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_default: e.target.checked } : x)))}
                          />
                          Default supplier for attendant capture (only one should be default per tenant)
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={saveSupplierEdit} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">
                            Save changes
                          </button>
                          <label className="text-sm px-3 py-2 rounded-lg border border-surface-300 cursor-pointer">
                            Upload logo
                            <input type="file" accept="image/*" className="hidden" onChange={uploadSupplierLogo} />
                          </label>
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'advanced_dashboard' && allowedTabs.includes('advanced_dashboard') ? (
          <FuelAdvancedDashboard
            analytics={dashData?.analytics}
            suppliers={dashData?.suppliers || []}
            loading={dashLoading}
            setActiveTab={setActiveTab}
            allowedTabs={allowedTabs}
          />
        ) : null}

        {activeTab === 'analytics' && allowedTabs.includes('analytics') ? (
          <div className="space-y-6 w-full">
            <h3 className="text-md font-semibold">Trends (verified data)</h3>
            {analytics ? (
              <div className="app-glass-card p-4 space-y-4">
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase mb-2">By supplier</p>
                  <ul className="text-sm space-y-1">
                    {(analytics.by_supplier || []).map((r) => (
                      <li key={r.supplier_name} className="flex justify-between border-b border-surface-100 dark:border-surface-800 py-1">
                        <span>{r.supplier_name}</span>
                        <span className="text-surface-600">
                          {r.transaction_count} tx · {r.total_liters?.toFixed?.(1) ?? r.total_liters} L · R {r.total_rand?.toFixed?.(2) ?? r.total_rand}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase mb-2">By month</p>
                  <ul className="text-sm space-y-1">
                    {(analytics.by_month || []).map((r) => (
                      <li key={r.month} className="flex justify-between border-b border-surface-100 py-1">
                        <span>{r.month}</span>
                        <span className="text-surface-600">
                          {r.transaction_count} tx · {r.total_liters?.toFixed?.(1) ?? r.total_liters} L
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-surface-500 text-sm">No summary yet.</p>
            )}
            <div>
              <button type="button" onClick={runInsights} disabled={insightsLoading} className="px-4 py-2 rounded-lg bg-surface-900 text-white text-sm dark:bg-surface-100 dark:text-surface-900 disabled:opacity-50">
                {insightsLoading ? 'Generating…' : 'Get AI insights (OpenAI, system data only)'}
              </button>
              {insights ? (
                <div className="mt-3 app-glass-card p-4 text-sm text-surface-800 dark:text-surface-200 whitespace-pre-wrap">{insights}</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'attendant_portal' && allowedTabs.includes('attendant_portal') ? (
          <div className="space-y-6 w-full">
            <h3 className="text-md font-semibold">Fuel attendant — slip capture (AI)</h3>
            <p className="text-sm text-surface-600 dark:text-surface-400">
              You are recording on behalf of the supplier. The slip &quot;Fleet&quot; line is the <strong className="text-surface-800 dark:text-surface-100">customer vehicle</strong> receiving fuel
              (not the tanker). &quot;Received by&quot; maps to the authorizer. When you submit, your login is stored as the fuel attendant.
            </p>
            {attendantDefaultSupplier ? (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
                <span className="font-medium">Supplier for this capture:</span> {attendantDefaultSupplier.name}
                {attendantDefaultSupplier.is_default ? ' (default)' : suppliers.length === 1 ? ' (only supplier on file)' : ''}
              </div>
            ) : suppliers.length > 1 ? (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                No default supplier is set and there are multiple suppliers. Ask a Fuel Admin user to open <strong>Supplier details</strong> and tick{' '}
                <em>Default supplier</em> for the correct one.
              </div>
            ) : null}
            <p className="text-xs text-surface-500">
              Logged in as attendant:{' '}
              <span className="font-medium text-surface-700 dark:text-surface-200">
                {[user?.full_name, user?.email].filter(Boolean).join(' · ') || user?.email || '—'}
              </span>
            </p>
            <FuelSlipAiCameraModal
              open={slipCameraOpen}
              onClose={() => setSlipCameraOpen(false)}
              onCapture={(file) => {
                setSlipCameraOpen(false);
                runParseSlipFile(file);
              }}
              busy={attParsing}
            />
            <div className="space-y-2">
              <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Add slip image</span>
              <p className="text-xs text-surface-500">
                The AI camera opens your device camera with tips for a sharp photo. The image is uploaded the same way as choosing a file — then we read the slip.
              </p>
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  disabled={attParsing}
                  onClick={() => setSlipCameraOpen(true)}
                  className="px-4 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium dark:bg-surface-100 dark:text-surface-900 disabled:opacity-50"
                >
                  Open AI camera
                </button>
                <label className="text-sm text-brand-600 dark:text-brand-400 cursor-pointer">
                  <span className="underline">Or upload / gallery</span>
                  <input type="file" accept="image/*" capture="environment" disabled={attParsing} onChange={parseSlip} className="hidden" />
                </label>
              </div>
            </div>
            {attParsing ? <p className="text-surface-500 text-sm">Reading slip…</p> : null}
            {attSlipPath || attForm.supplier_name ? (
              <div className="app-glass-card p-4 space-y-4">
                <p className="text-xs text-surface-500 uppercase tracking-wide">Review before submit</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Supplier name (from slip; default supplier is applied on save if set)
                    <input className={inputClass('mt-1')} value={attForm.supplier_name} onChange={(e) => setAttForm((f) => ({ ...f, supplier_name: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Customer name
                    <input className={inputClass('mt-1')} value={attForm.customer_name} onChange={(e) => setAttForm((f) => ({ ...f, customer_name: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Order number
                    <input className={inputClass('mt-1')} value={attForm.order_number} onChange={(e) => setAttForm((f) => ({ ...f, order_number: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Vehicle / tank (optional)
                    <input className={inputClass('mt-1')} value={attForm.vehicle_tank} onChange={(e) => setAttForm((f) => ({ ...f, vehicle_tank: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Customer vehicle (fleet / registration — from slip &quot;Fleet&quot;)
                    <input
                      className={inputClass('mt-1')}
                      value={attForm.vehicle_registration}
                      onChange={(e) => setAttForm((f) => ({ ...f, vehicle_registration: e.target.value }))}
                    />
                  </label>
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Supplier vehicle (only if shown on slip)
                    <input
                      className={inputClass('mt-1')}
                      value={attForm.supplier_vehicle_registration}
                      onChange={(e) => setAttForm((f) => ({ ...f, supplier_vehicle_registration: e.target.value }))}
                    />
                  </label>
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Delivery date &amp; time
                    <input type="datetime-local" className={inputClass('mt-1')} value={attForm.delivery_time} onChange={(e) => setAttForm((f) => ({ ...f, delivery_time: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Kilos / odometer
                    <input className={inputClass('mt-1')} value={attForm.kilos} onChange={(e) => setAttForm((f) => ({ ...f, kilos: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Driver (responsible user)
                    <input className={inputClass('mt-1')} value={attForm.responsible_user_name} onChange={(e) => setAttForm((f) => ({ ...f, responsible_user_name: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Pump start
                    <input className={inputClass('mt-1')} value={attForm.pump_start} onChange={(e) => setAttForm((f) => ({ ...f, pump_start: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Pump stop
                    <input className={inputClass('mt-1')} value={attForm.pump_stop} onChange={(e) => setAttForm((f) => ({ ...f, pump_stop: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Liters (from slip, if given)
                    <input className={inputClass('mt-1')} value={attForm.liters_filled} onChange={(e) => setAttForm((f) => ({ ...f, liters_filled: e.target.value }))} placeholder="Optional if pump diff used" />
                  </label>
                  <label className="block text-xs text-surface-500">
                    Price / litre (R) if known
                    <input className={inputClass('mt-1')} value={attForm.price_per_litre} onChange={(e) => setAttForm((f) => ({ ...f, price_per_litre: e.target.value }))} />
                  </label>
                  <label className="block text-xs text-surface-500 sm:col-span-2">
                    Authorizer (received by)
                    <input className={inputClass('mt-1')} value={attForm.authorizer_name} onChange={(e) => setAttForm((f) => ({ ...f, authorizer_name: e.target.value }))} />
                  </label>
                  <p className="text-xs text-surface-500 sm:col-span-2">
                    Attendant on slip (if any) is informational only — the saved attendant is always the signed-in user above.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={attSubmitting}
                  onClick={approveAttendantRow}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50"
                >
                  {attSubmitting ? 'Submitting…' : 'Approve & submit for verification'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
