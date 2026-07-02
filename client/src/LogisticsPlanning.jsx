import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { tabAccess as tabAccessApi } from './api';
import { toYmdInAppZone } from './lib/appTime.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import ManagePageTabAccess from './components/ManagePageTabAccess.jsx';
import PlannerTab from './components/logisticsPlanning/PlannerTab.jsx';
import SystemAdviseTab from './components/logisticsPlanning/SystemAdviseTab.jsx';
import PlanManagementTab from './components/logisticsPlanning/PlanManagementTab.jsx';

export const LOGISTICS_PLANNING_TAB_IDS = ['planner', 'advise', 'management'];

const TABS = [
  { id: 'planner', label: 'Planner' },
  { id: 'advise', label: 'System advise' },
  { id: 'management', label: 'Plan management' },
];

const TAB_LABELS = {
  planner: 'Planner',
  advise: 'System advise',
  management: 'Plan management',
};

const MANAGE_TAB = { id: 'manage-tab-access', label: 'Manage tabs' };

export default function LogisticsPlanning() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isTabAccessAdmin = isSuperAdmin || user?.role === 'tenant_admin';
  const [tab, setTab] = useState('planner');
  const [planDate, setPlanDate] = useState(() => toYmdInAppZone());
  const [error, setError] = useState('');
  const [planSnapshot, setPlanSnapshot] = useState(null);
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [permissions, setPermissions] = useState([]);
  const [tabAccessUsers, setTabAccessUsers] = useState([]);
  useSecondaryNavHidden(false);

  const visibleTabs = useMemo(() => {
    const base = TABS.filter((t) => allowedTabs.includes(t.id));
    if (isTabAccessAdmin) return [...base, MANAGE_TAB];
    return base;
  }, [allowedTabs, isTabAccessAdmin]);

  useEffect(() => {
    tabAccessApi
      .myTabs('logistics_planning')
      .then((d) => {
        let tabs = d.tabs || [];
        if (isTabAccessAdmin && !tabs.length) tabs = [...LOGISTICS_PLANNING_TAB_IDS];
        setAllowedTabs(tabs);
      })
      .catch(() => setAllowedTabs(isTabAccessAdmin ? [...LOGISTICS_PLANNING_TAB_IDS] : []))
      .finally(() => setTabsLoading(false));
  }, [isTabAccessAdmin]);

  useEffect(() => {
    if (tabsLoading) return;
    if (tab === 'manage-tab-access' && isTabAccessAdmin) return;
    if (allowedTabs.includes(tab)) return;
    if (allowedTabs.length > 0) setTab(allowedTabs[0]);
    else if (isTabAccessAdmin) setTab('manage-tab-access');
  }, [allowedTabs, tab, tabsLoading, isTabAccessAdmin]);

  if (tabsLoading) {
    return <p className="text-sm text-surface-500 py-12 px-4">Loading…</p>;
  }

  const hasAccess = isTabAccessAdmin || allowedTabs.length > 0;
  if (!hasAccess) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-100">
          <h2 className="font-semibold text-lg">No access to Logistics Planning tabs</h2>
          <p className="mt-2 text-sm">
            Ask your administrator to assign the <strong>Logistics Planning</strong> page role, then grant tabs under <strong>Manage tabs</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Logistics Planning</h1>
          <p className="text-sm text-surface-500 mt-1">
            Plan routes, accept system advise, and track production — verified via loading slips. Published plans flow to Tracking Management.
          </p>
        </div>
        {tab !== 'management' && (
          <label className="text-sm">
            <span className="text-xs font-medium text-surface-500 block mb-1">Plan date</span>
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              className="rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            />
          </label>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {planSnapshot?.plan?.status === 'published' && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
          Plan published for {planDate} — {(planSnapshot.routes || []).filter((r) => r.enabled && !r.is_plan_b).length} primary routes active on Tracking Management schedule load. Team notified by email.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-surface-200 dark:border-surface-800 pb-px">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id
                ? 'bg-white dark:bg-surface-900 border border-b-0 border-surface-200 dark:border-surface-700 text-brand-700 dark:text-brand-300'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'planner' && allowedTabs.includes('planner') && (
        <PlannerTab planDate={planDate} onPlanChange={setPlanSnapshot} onError={setError} />
      )}
      {tab === 'advise' && allowedTabs.includes('advise') && (
        <SystemAdviseTab planDate={planDate} onPlanChange={setPlanSnapshot} onError={setError} />
      )}
      {tab === 'management' && allowedTabs.includes('management') && (
        <PlanManagementTab onError={setError} />
      )}
      {tab === 'manage-tab-access' && isTabAccessAdmin && (
        <ManagePageTabAccess
          pageKey="logistics_planning"
          pageLabel="Logistics Planning"
          allTabIds={LOGISTICS_PLANNING_TAB_IDS}
          tabLabels={TAB_LABELS}
          permissions={permissions}
          setPermissions={setPermissions}
          users={tabAccessUsers}
          setUsers={setTabAccessUsers}
          onError={setError}
        />
      )}
    </div>
  );
}
