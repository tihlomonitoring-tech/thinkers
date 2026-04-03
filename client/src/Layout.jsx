import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import Sidebar, { useSidebarState } from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';
import { tenants as tenantsApi, commandCentre as ccApi } from './api';
import { PATH_PAGE_IDS, canAccessPage, getFirstAllowedPath } from './lib/pageAccess.js';

function IconMenu({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconRefresh({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

export default function Layout() {
  const { user, logout, switchTenant } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed, setCollapsed, hidden, setHidden, mobileOpen, setMobileOpen } = useSidebarState();
  const [tenantList, setTenantList] = useState([]);
  const [tenantSwitcherOpen, setTenantSwitcherOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchIndex, setGlobalSearchIndex] = useState(0);
  const [ccAllowedTabs, setCcAllowedTabs] = useState([]);
  const globalSearchRef = useCallback((node) => { if (!node) return; }, []);
  /** Bumps when the user clicks refresh so the active page remounts and reloads data. */
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const bumpDataRefresh = useCallback(() => setDataRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (user?.tenant_ids?.length > 1) {
      tenantsApi.list().then((d) => setTenantList(d.tenants || [])).catch(() => setTenantList([]));
    } else {
      setTenantList([]);
    }
  }, [user?.tenant_ids]);

  useEffect(() => {
    if (!canAccessPage(user, 'command_centre')) {
      setCcAllowedTabs([]);
      return;
    }
    let cancelled = false;
    ccApi.myTabs()
      .then((r) => { if (!cancelled) setCcAllowedTabs(r.tabs || []); })
      .catch(() => { if (!cancelled) setCcAllowedTabs([]); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const pathname = location.pathname || '';
    const pageId = PATH_PAGE_IDS[pathname];
    if (pageId && user && !canAccessPage(user, pageId)) {
      const firstAllowed = getFirstAllowedPath(user);
      navigate(firstAllowed, { replace: true });
    }
  }, [location.pathname, user, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const commandCentreTabTargets = canAccessPage(user, 'command_centre') ? [
    { id: 'cc:dashboard', label: 'Command Centre · Main dashboard', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'dashboard', keywords: ['overview', 'home'] },
    { id: 'cc:reports', label: 'Command Centre · Report composition', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'reports', keywords: ['shift', 'create report', 'compose'] },
    { id: 'cc:saved_reports', label: 'Command Centre · View saved shift reports', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'saved_reports', keywords: ['saved', 'history', 'approved report'] },
    { id: 'cc:trends', label: 'Command Centre · Trends', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'trends', keywords: ['analytics', 'graph', 'insights'] },
    { id: 'cc:requests', label: 'Command Centre · Requests', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'requests', keywords: ['pending', 'approval request'] },
    { id: 'cc:messages', label: 'Command Centre · Messages platform', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'messages', keywords: ['chat', 'communication'] },
    { id: 'cc:delivery', label: 'Command Centre · Delivery management', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'delivery', keywords: ['deliveries', 'loads'] },
    { id: 'cc:breakdowns', label: 'Command Centre · Reported breakdowns', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'breakdowns', keywords: ['incidents', 'downtime'] },
    { id: 'cc:applications', label: 'Command Centre · Fleet & driver applications', path: '/command-centre', section: 'Command Centre', commandCentreTab: 'applications', keywords: ['fleet', 'driver', 'truck', 'application', 'enrollment'] },
  ].filter((t) => ccAllowedTabs.includes(t.commandCentreTab)) : [];
  const contractorTabTargets = canAccessPage(user, 'contractor') ? [
    { id: 'ct:dashboard', label: 'Contractor · Dashboard', path: '/contractor', section: 'Contractor', tab: 'dashboard', key: 'contractor-global-target-tab', keywords: ['overview', 'home'] },
    { id: 'ct:trucks', label: 'Contractor · Add truck', path: '/contractor', section: 'Contractor', tab: 'trucks', key: 'contractor-global-target-tab', keywords: ['fleet', 'truck', 'vehicle'] },
    { id: 'ct:fleet', label: 'Contractor · Fleet', path: '/contractor', section: 'Contractor', tab: 'fleet', key: 'contractor-global-target-tab', keywords: ['truck', 'vehicle', 'fleet list'] },
    { id: 'ct:drivers', label: 'Contractor · Add driver', path: '/contractor', section: 'Contractor', tab: 'drivers', key: 'contractor-global-target-tab', keywords: ['driver', 'operator'] },
    { id: 'ct:driver-register', label: 'Contractor · Driver register', path: '/contractor', section: 'Contractor', tab: 'driver-register', key: 'contractor-global-target-tab', keywords: ['driver', 'register', 'license'] },
    { id: 'ct:import-all', label: 'Contractor · Import all', path: '/contractor', section: 'Contractor', tab: 'import-all', key: 'contractor-global-target-tab' },
    { id: 'ct:enrollment', label: 'Contractor · Fleet and driver enrollment', path: '/contractor', section: 'Contractor', tab: 'enrollment', key: 'contractor-global-target-tab' },
    { id: 'ct:incidents', label: 'Contractor · Report breakdown / incidents', path: '/contractor', section: 'Contractor', tab: 'incidents', key: 'contractor-global-target-tab' },
    { id: 'ct:expiries', label: 'Contractor · Expiries', path: '/contractor', section: 'Contractor', tab: 'expiries', key: 'contractor-global-target-tab' },
    { id: 'ct:suspensions', label: 'Contractor · Suspensions and appeals', path: '/contractor', section: 'Contractor', tab: 'suspensions', key: 'contractor-global-target-tab' },
    { id: 'ct:messages', label: 'Contractor · Messages', path: '/contractor', section: 'Contractor', tab: 'messages', key: 'contractor-global-target-tab' },
  ] : [];
  const accessManagementTabTargets = canAccessPage(user, 'access_management') ? [
    { id: 'am:dashboard', label: 'Access Management · Dashboard', path: '/access-management', section: 'Access Management', tab: 'dashboard', key: 'access-management-global-target-tab' },
    { id: 'am:routes', label: 'Access Management · Route management', path: '/access-management', section: 'Access Management', tab: 'routes', key: 'access-management-global-target-tab' },
    { id: 'am:rectors', label: 'Access Management · Route rectors', path: '/access-management', section: 'Access Management', tab: 'rectors', key: 'access-management-global-target-tab' },
    { id: 'am:distribution', label: 'Access Management · List distribution', path: '/access-management', section: 'Access Management', tab: 'distribution', key: 'access-management-global-target-tab' },
    { id: 'am:pilot', label: 'Access Management · Pilot distribution', path: '/access-management', section: 'Access Management', tab: 'pilot-distribution', key: 'access-management-global-target-tab' },
    { id: 'am:history', label: 'Access Management · Distribution history', path: '/access-management', section: 'Access Management', tab: 'distribution-history', key: 'access-management-global-target-tab' },
  ] : [];
  const rectorTabTargets = canAccessPage(user, 'rector') ? [
    { id: 'rt:fleet', label: 'Rector · Approved fleet & drivers', path: '/rector', section: 'Rector', tab: 'fleet', key: 'rector-global-target-tab' },
    { id: 'rt:incidents', label: 'Rector · Breakdowns & incidents', path: '/rector', section: 'Rector', tab: 'incidents', key: 'rector-global-target-tab' },
    { id: 'rt:suspensions', label: 'Rector · Suspensions', path: '/rector', section: 'Rector', tab: 'suspensions', key: 'rector-global-target-tab' },
    { id: 'rt:compliance', label: 'Rector · Compliance inspections', path: '/rector', section: 'Rector', tab: 'compliance', key: 'rector-global-target-tab' },
    { id: 'rt:shift-reports', label: 'Rector · Shift reports', path: '/rector', section: 'Rector', tab: 'shift-reports', key: 'rector-global-target-tab' },
  ] : [];

  const routePath = location.pathname || '';
  const globalTargets =
    routePath.startsWith('/command-centre') ? commandCentreTabTargets :
      routePath.startsWith('/contractor') ? contractorTabTargets :
        routePath.startsWith('/access-management') ? accessManagementTabTargets :
          routePath.startsWith('/rector') ? rectorTabTargets :
            [...commandCentreTabTargets, ...contractorTabTargets, ...accessManagementTabTargets, ...rectorTabTargets];
  const q = globalSearch.trim().toLowerCase();
  const scoreTarget = (target, query) => {
    if (!query) return 1;
    const hay = `${target.label} ${target.section} ${(target.keywords || []).join(' ')}`.toLowerCase();
    if (!hay.includes(query)) return 0;
    let score = 10;
    if (target.label.toLowerCase().startsWith(query)) score += 50;
    if (target.label.toLowerCase().includes(query)) score += 20;
    for (const kw of target.keywords || []) {
      const k = String(kw).toLowerCase();
      if (k === query) score += 60;
      else if (k.startsWith(query)) score += 35;
      else if (k.includes(query)) score += 15;
    }
    if (routePath.startsWith(target.path)) score += 12;
    return score;
  };
  const filteredTargets = (q
    ? globalTargets
      .map((t) => ({ target: t, score: scoreTarget(t, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.target.label.localeCompare(b.target.label))
      .map((x) => x.target)
    : globalTargets).slice(0, 12);

  const goToTarget = (target) => {
    if (!target) return;
    if (target.commandCentreTab) {
      try { sessionStorage.setItem('cc-global-target-tab', target.commandCentreTab); } catch (_) {}
    }
    if (target.tab && target.key) {
      try { sessionStorage.setItem(target.key, target.tab); } catch (_) {}
    }
    navigate(target.path);
    setGlobalSearchOpen(false);
    setGlobalSearch('');
    setGlobalSearchIndex(0);
  };

  useEffect(() => {
    const onDocClick = (e) => {
      const el = document.getElementById('global-app-search-wrap');
      if (!el) return;
      if (!el.contains(e.target)) setGlobalSearchOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className={`flex min-h-screen ${isDark ? 'bg-surface-950' : 'bg-surface-50'}`}>
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        hidden={hidden}
        setHidden={setHidden}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        onLogout={handleLogout}
      />

      <div className={`flex-1 flex flex-col min-w-0 ${isDark ? 'bg-surface-950' : 'bg-surface-50'}`}>
        <header
          className={`sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b backdrop-blur px-4 lg:px-6 ${
            isDark ? 'border-surface-800 bg-surface-900/95' : 'border-surface-200 bg-white/95'
          }`}
        >
          <button
            type="button"
            onClick={() => (hidden ? setHidden(false) : setMobileOpen(true))}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              isDark ? 'text-surface-400 hover:bg-surface-800' : 'text-surface-600 hover:bg-surface-100'
            } ${hidden ? 'lg:flex' : 'lg:hidden'}`}
            aria-label={hidden ? 'Show sidebar' : 'Open menu'}
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0 flex items-center justify-center">
            <div id="global-app-search-wrap" ref={globalSearchRef} className="w-full max-w-xl relative">
              <input
                value={globalSearch}
                onChange={(e) => { setGlobalSearch(e.target.value); setGlobalSearchOpen(true); setGlobalSearchIndex(0); }}
                onFocus={() => setGlobalSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setGlobalSearchOpen(false); return; }
                  if (e.key === 'ArrowDown') { e.preventDefault(); setGlobalSearchIndex((i) => Math.min(i + 1, Math.max(0, filteredTargets.length - 1))); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setGlobalSearchIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === 'Enter') { e.preventDefault(); goToTarget(filteredTargets[globalSearchIndex] || filteredTargets[0]); }
                }}
                placeholder="Search pages and tabs..."
                className={`w-full h-9 rounded-lg border px-3 text-sm ${
                  isDark ? 'border-surface-700 bg-surface-800 text-surface-100 placeholder:text-surface-500' : 'border-surface-200 bg-white text-surface-700 placeholder:text-surface-400'
                }`}
              />
              {globalSearchOpen && (
                <div className={`absolute top-full mt-1 w-full rounded-lg border shadow-lg max-h-72 overflow-auto z-50 ${isDark ? 'border-surface-700 bg-surface-900' : 'border-surface-200 bg-white'}`}>
                  {filteredTargets.length === 0 ? (
                    <div className={`px-3 py-2 text-sm ${isDark ? 'text-surface-400' : 'text-surface-500'}`}>No accessible result</div>
                  ) : (
                    filteredTargets.slice(0, 12).map((t, i) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => goToTarget(t)}
                        className={`w-full text-left px-3 py-2 ${i === globalSearchIndex ? (isDark ? 'bg-surface-800' : 'bg-surface-50') : ''} ${isDark ? 'hover:bg-surface-800 text-surface-100' : 'hover:bg-surface-50 text-surface-800'}`}
                      >
                        <div className="text-sm font-medium">{t.label}</div>
                        <div className={`text-xs ${isDark ? 'text-surface-400' : 'text-surface-500'}`}>{t.section}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={bumpDataRefresh}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                isDark
                  ? 'border-surface-700 bg-surface-800 text-surface-300 hover:bg-surface-700'
                  : 'border-surface-200 bg-white text-surface-600 hover:bg-surface-50'
              }`}
              title="Refresh page data"
              aria-label="Refresh page data"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
            {user?.tenant_ids?.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTenantSwitcherOpen((o) => !o)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    isDark
                      ? 'border-surface-700 bg-surface-800 text-surface-200 hover:bg-surface-700'
                      : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-50'
                  }`}
                >
                  <span className="max-w-[120px] truncate">{user?.tenant_name || 'Tenant'}</span>
                  <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {tenantSwitcherOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTenantSwitcherOpen(false)} aria-hidden="true" />
                    <div
                      className={`absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border shadow-lg py-1 max-h-60 overflow-y-auto ${
                        isDark ? 'border-surface-700 bg-surface-900' : 'border-surface-200 bg-white'
                      }`}
                    >
                      {(user.tenant_ids || []).map((tid) => {
                        const t = tenantList.find((x) => x.id === tid);
                        const name = t?.name || tid;
                        const isCurrent = tid === user.tenant_id;
                        return (
                          <button
                            key={tid}
                            type="button"
                            onClick={() => {
                              switchTenant(tid).then(() => setTenantSwitcherOpen(false));
                            }}
                            className={`w-full text-left px-3 py-2 text-sm ${
                              isDark ? 'hover:bg-surface-800' : 'hover:bg-surface-50'
                            } ${
                              isCurrent
                                ? isDark
                                  ? 'bg-brand-950/50 text-brand-200 font-medium'
                                  : 'bg-brand-50 text-brand-800 font-medium'
                                : isDark
                                  ? 'text-surface-200'
                                  : 'text-surface-700'
                            }`}
                          >
                            {name} {isCurrent && '✓'}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main
          className={`app-main flex-1 min-h-0 p-4 sm:p-6 overflow-auto flex flex-col ${
            isDark ? 'bg-surface-950' : 'bg-surface-50'
          }`}
        >
          <Outlet key={dataRefreshKey} />
        </main>
        <AppAttributionFooter
          className={
            isDark
              ? 'text-surface-500 border-t border-surface-800 bg-surface-950'
              : 'text-surface-400 border-t border-surface-200 bg-surface-50'
          }
        />
      </div>
    </div>
  );
}
