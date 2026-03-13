import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import Sidebar, { useSidebarState } from './components/Sidebar';
import { tenants as tenantsApi } from './api';
import { PATH_PAGE_IDS, canAccessPage, getFirstAllowedPath } from './lib/pageAccess.js';

function IconMenu({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export default function Layout() {
  const { user, logout, switchTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed, setCollapsed, hidden, setHidden, mobileOpen, setMobileOpen } = useSidebarState();
  const [tenantList, setTenantList] = useState([]);
  const [tenantSwitcherOpen, setTenantSwitcherOpen] = useState(false);

  useEffect(() => {
    if (user?.tenant_ids?.length > 1) {
      tenantsApi.list().then((d) => setTenantList(d.tenants || [])).catch(() => setTenantList([]));
    } else {
      setTenantList([]);
    }
  }, [user?.tenant_ids]);

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

  return (
    <div className="flex min-h-screen bg-surface-50">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        hidden={hidden}
        setHidden={setHidden}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-surface-200 bg-white/95 backdrop-blur px-4 lg:px-6">
          <button
            type="button"
            onClick={() => (hidden ? setHidden(false) : setMobileOpen(true))}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-100 transition-colors ${hidden ? 'lg:flex' : 'lg:hidden'}`}
            aria-label={hidden ? 'Show sidebar' : 'Open menu'}
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0" />
          {user?.tenant_ids?.length > 1 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTenantSwitcherOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-sm text-surface-700 hover:bg-surface-50"
              >
                <span className="max-w-[120px] truncate">{user?.tenant_name || 'Tenant'}</span>
                <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {tenantSwitcherOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTenantSwitcherOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-surface-200 bg-white shadow-lg py-1 max-h-60 overflow-y-auto">
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
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-50 ${isCurrent ? 'bg-brand-50 text-brand-800 font-medium' : 'text-surface-700'}`}
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
        </header>

        <main className="flex-1 min-h-0 p-4 sm:p-6 overflow-auto flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
