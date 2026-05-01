import { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { canAccessPage, PATH_PAGE_IDS } from '../lib/pageAccess.js';

const SIDEBAR_KEY = 'thinkers-sidebar-collapsed';
const SIDEBAR_HIDDEN_KEY = 'thinkers-sidebar-hidden';

function IconUsers({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function IconTenants({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

function IconContractor({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}

function IconCommandCentre({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function IconAccess({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}

function IconRector({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function IconTasks({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function IconCaseManagement({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h3m6-9H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2zm-9-3h6a1 1 0 011 1v2H8V5a1 1 0 011-1z" />
    </svg>
  );
}

function IconProfile({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function IconTeamLeader({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  );
}

function IconEvaluations({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function IconAuditor({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function IconManagement({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconLibrary({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function IconRecruitment({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function IconLetters({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconAccounting({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function IconFuel({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}


function IconChevronLeft({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconPanelClose({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    </svg>
  );
}

function IconChevronRight({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function IconX({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconLogout({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

const navSections = [
  {
    label: 'My profile & HR',
    items: [
      { to: '/profile', label: 'Profile', icon: IconProfile, shortcut: '⌘P', pageId: 'profile' },
      { to: '/team-leader-admin', label: 'Team leader admin', icon: IconTeamLeader, shortcut: '', pageId: 'team_leader_admin' },
      { to: '/performance-evaluations', label: 'Performance evaluations', icon: IconEvaluations, shortcut: '', pageId: 'performance_evaluations' },
      { to: '/auditor', label: 'Auditor', icon: IconAuditor, shortcut: '', pageId: 'auditor' },
      { to: '/management', label: 'Management', icon: IconManagement, shortcut: '⌘M', pageId: 'management' },
    ],
  },
  {
    label: 'Management',
    items: [
      { to: '/users', label: 'Users', icon: IconUsers, shortcut: '⌘1', pageId: 'users' },
      { to: '/tenants', label: 'Tenants', icon: IconTenants, shortcut: '⌘2', pageId: 'tenants' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/contractor', label: 'Contractor', icon: IconContractor, shortcut: '⌘3', pageId: 'contractor' },
      { to: '/command-centre', label: 'Command Centre', icon: IconCommandCentre, shortcut: '⌘4', pageId: 'command_centre' },
      { to: '/fuel-supply-management', label: 'Fuel supply', icon: IconFuel, shortcut: '⌘8', pageId: 'fuel_supply_management' },
      { to: '/fuel-customer-orders', label: 'Customer diesel orders', icon: IconFuel, shortcut: '', pageId: 'fuel_customer_orders' },
      { to: '/access-management', label: 'Access management', icon: IconAccess, shortcut: '⌘5', pageId: 'access_management' },
      { to: '/rector', label: 'Rector', icon: IconRector, shortcut: '⌘6', pageId: 'rector' },
      { to: '/tasks', label: 'Tasks', icon: IconTasks, shortcut: '⌘7', pageId: 'tasks' },
      { to: '/case-management', label: 'Case management', icon: IconCaseManagement, shortcut: '', pageId: 'case_management' },
      { to: '/company-library', label: 'Company library', icon: IconLibrary, shortcut: '', pageId: 'company_library' },
    ],
  },
  {
    label: 'HR',
    items: [
      { to: '/recruitment', label: 'Recruitment', icon: IconRecruitment, shortcut: '⌘9', pageId: 'recruitment' },
      { to: '/letters', label: 'Letters', icon: IconLetters, shortcut: '⌘0', pageId: 'letters' },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { to: '/accounting-management', label: 'Accounting management', icon: IconAccounting, shortcut: '⌘A', pageId: 'accounting_management' },
    ],
  },
];

export default function Sidebar({ onLogout, collapsed, setCollapsed, hidden, setHidden, mobileOpen, setMobileOpen }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tooltipItem, setTooltipItem] = useState(null);

  /** Only show pages the user can access. If user has page_roles set, hide pages they don't have. */
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessPage(user, item.pageId)),
    }))
    .filter((section) => section.items.length > 0);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.metaKey || e.ctrlKey) {
        const map = { '1': '/users', '2': '/tenants', '3': '/contractor', '4': '/command-centre', '8': '/fuel-supply-management', '5': '/access-management', '6': '/rector', '7': '/tasks', '9': '/recruitment', '0': '/letters', 'a': '/accounting-management', 'A': '/accounting-management', 'p': '/profile', 'P': '/profile', 'm': '/management', 'M': '/management' };
        const path = map[e.key];
        const pageId = path && PATH_PAGE_IDS[path];
        if (path && pageId && canAccessPage(user, pageId)) {
          e.preventDefault();
          navigate(path);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, user]);

  const isCollapsed = collapsed;
  const isHidden = hidden;

  const NavItem = ({ to, label, icon: Icon, shortcut }) => (
    <li className="relative">
      <NavLink
        to={to}
        onMouseEnter={() => isCollapsed && setTooltipItem(label)}
        onMouseLeave={() => setTooltipItem(null)}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-[rgb(2_6_23)] ${
            isActive
              ? 'bg-brand-500/30 text-brand-200 border-l-2 border-brand-300 -ml-[2px] pl-[14px] shadow-sm shadow-black/20'
              : 'text-surface-200 hover:bg-white/10 hover:text-white border-l-2 border-transparent'
          }`
        }
      >
        <Icon className="h-5 w-5 shrink-0 text-inherit" />
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {shortcut && (
              <kbd className="hidden xl:inline-flex h-5 items-center rounded border border-white/20 bg-black/35 px-1.5 font-mono text-[10px] font-medium text-surface-200 shadow-sm">
                {shortcut}
              </kbd>
            )}
          </>
        )}
        {isCollapsed && tooltipItem === label && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-[100] rounded-md border border-white/15 bg-surface-900 px-3 py-2 text-sm text-surface-100 shadow-xl whitespace-nowrap pointer-events-none">
            {label}
            {shortcut && <span className="ml-2 text-surface-400">{shortcut}</span>}
          </div>
        )}
      </NavLink>
    </li>
  );

  const sidebarContent = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-3">
        {!isCollapsed && (
          <span className="font-semibold tracking-tight text-white truncate">
            {user?.tenant_name || import.meta.env.VITE_APP_NAME || 'Portal'}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-surface-200 hover:bg-white/12 hover:text-white transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight className="h-5 w-5" /> : <IconChevronLeft className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-surface-200 hover:bg-white/12 hover:text-white transition-colors"
            aria-label="Hide sidebar to see full content"
            title="Hide sidebar"
          >
            <IconPanelClose className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden h-8 w-8 flex items-center justify-center rounded-lg text-surface-200 hover:bg-white/12 hover:text-white"
            aria-label="Close menu"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto scrollbar-thin py-4" aria-label="Main">
        {visibleSections.map((section) => (
          <div key={section.label}>
            {!isCollapsed && (
              <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-surface-400">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="h-9 w-9 shrink-0 rounded-full bg-brand-500/35 flex items-center justify-center text-brand-100 font-semibold text-sm ring-2 ring-brand-400/40">
            {user?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.full_name}</p>
              {user?.tenant_name && (
                <p className="truncate text-xs text-surface-300">{user.tenant_name}</p>
              )}
            </div>
          )}
        </div>
        {!isCollapsed && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 w-full rounded-lg px-3 py-2 text-left text-sm text-surface-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            Sign out
          </button>
        )}
        {isCollapsed && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-surface-200 hover:bg-white/12 hover:text-white"
            aria-label="Sign out"
          >
            <IconLogout className="h-4 w-4" />
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-full flex-col text-surface-100
          app-glass-main-sidebar
          transition-[width] duration-300 ease-in-out
          lg:translate-x-0
          ${isHidden ? 'lg:w-0 lg:overflow-hidden lg:pointer-events-none' : collapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'}
          w-[260px]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        aria-label="Main navigation"
        aria-hidden={isHidden}
      >
        {sidebarContent}
      </aside>
      <div
        className="hidden lg:block shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: hidden ? 0 : (collapsed ? 72 : 260) }}
        aria-hidden
      />
    </>
  );
}

export function useSidebarState() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'false');
    } catch {
      return false;
    }
  });
  const [hidden, setHidden] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SIDEBAR_HIDDEN_KEY) ?? 'false');
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, JSON.stringify(hidden));
  }, [hidden]);

  return { collapsed, setCollapsed, hidden, setHidden, mobileOpen, setMobileOpen };
}
