import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { tracking as trackingApi, tabAccess as tabAccessApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import ManagePageTabAccess from './components/ManagePageTabAccess.jsx';
import TrackingNotificationSettings from './components/tracking/TrackingNotificationSettings.jsx';
import GeofenceRoutesTab from './components/tracking/GeofenceRoutesTab.jsx';
import FleetIntegrationTab from './components/tracking/FleetIntegrationTab.jsx';
import FleetDistributionMonitor from './components/tracking/FleetDistributionMonitor.jsx';
import LogisticsActivityTab from './components/tracking/LogisticsActivityTab.jsx';
import CompletedDeliveriesTab from './components/tracking/CompletedDeliveriesTab.jsx';
import FuelRegulationTab from './components/tracking/FuelRegulationTab.jsx';
import {
  TRACKING_TAB_IDS,
  TRACKING_TAB_LABELS,
  TRACKING_TABS,
} from './lib/trackingManagementTabs.js';

const MANAGE_TAB = {
  id: 'manage-tab-access',
  label: 'Manage tabs',
  description: 'Grant tab access per user (admin)',
};

export default function TrackingManagement() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const isTabAccessAdmin = isSuperAdmin || user?.role === 'tenant_admin';
  const [navHidden, setNavHidden] = useSecondaryNavHidden('tracking-management');
  const [tab, setTab] = useState('activity');
  const [error, setError] = useState('');
  const [migrationHint, setMigrationHint] = useState('');
  const [noteTripId, setNoteTripId] = useState(null);
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [permissions, setPermissions] = useState([]);
  const [tabAccessUsers, setTabAccessUsers] = useState([]);

  const navTabs = useMemo(() => {
    const visible = TRACKING_TABS.filter((t) => allowedTabs.includes(t.id));
    if (isTabAccessAdmin) return [...visible, MANAGE_TAB];
    return visible;
  }, [allowedTabs, isTabAccessAdmin]);

  useEffect(() => {
    tabAccessApi
      .myTabs('tracking_management')
      .then((d) => {
        let tabs = d.tabs || [];
        if (isTabAccessAdmin && !tabs.length) tabs = [...TRACKING_TAB_IDS];
        setAllowedTabs(tabs);
      })
      .catch(() => setAllowedTabs(isTabAccessAdmin ? [...TRACKING_TAB_IDS] : []))
      .finally(() => setTabsLoading(false));
  }, [isTabAccessAdmin]);

  useEffect(() => {
    if (tabsLoading) return;
    if (tab === 'manage-tab-access' && isTabAccessAdmin) return;
    if (allowedTabs.includes(tab)) return;
    if (allowedTabs.length > 0) {
      setTab(allowedTabs[0]);
    } else if (isTabAccessAdmin) {
      setTab('manage-tab-access');
    }
  }, [allowedTabs, tab, tabsLoading, isTabAccessAdmin]);

  const hasAccess = isTabAccessAdmin || allowedTabs.length > 0;
  const tabOk =
    tab === 'manage-tab-access' ||
    allowedTabs.includes(tab);
  useAutoHideNavAfterTabChange(tab, { ready: !tabsLoading && hasAccess && tabOk });

  useEffect(() => {
    trackingApi.dashboard().then((d) => {
      if (d.migration_required && d.migration_hint) setMigrationHint(d.migration_hint);
      else setMigrationHint('');
    }).catch(() => {
      setMigrationHint('Run: npm run db:tracking-setup (then restart the API).');
    });
  }, [tab]);

  if (tabsLoading) {
    return <p className="text-sm text-surface-500 py-12">Loading…</p>;
  }

  if (!hasAccess) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-100">
          <h2 className="font-semibold text-lg">No access to Tracking management</h2>
          <p className="mt-2 text-sm">
            Ask your administrator to assign the <strong>Tracking management</strong> page role under User management.
            Tenant admins can then restrict tabs under <strong>Manage tabs</strong> in Tracking management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      <nav
        className={`shrink-0 app-glass-secondary-nav flex flex-col transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Tracking management"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Tracking management</h2>
            <p className="text-xs text-surface-500 mt-0.5">Geofence · integrate · activity · map · deliver</p>
            <p className="text-xs text-surface-500 mt-1.5">
              Showing data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition-colors"
            aria-label="Hide navigation to see full content"
            title="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          <ul className="space-y-0.5">
            {navTabs.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`w-full flex flex-col items-start gap-0.5 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                    tab === t.id
                      ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                      : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                  }`}
                >
                  <span className="min-w-0 break-words">{t.label}</span>
                  <span className="text-[10px] font-normal text-surface-500">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}

        <div className="w-full max-w-7xl mx-auto flex-1">
          {migrationHint && tab !== 'manage-tab-access' && (
            <div className="mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-100">
              <p className="font-semibold">Tracking database not installed</p>
              <p className="text-xs mt-1">{migrationHint}</p>
            </div>
          )}
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between dark:bg-red-950/40 dark:border-red-900 dark:text-red-200">
              <span>{error}</span>
              <button type="button" className="hover:underline" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {tab === 'geofence' && allowedTabs.includes('geofence') && <GeofenceRoutesTab setError={setError} />}
          {tab === 'integration' && allowedTabs.includes('integration') && <FleetIntegrationTab setError={setError} />}
          {tab === 'activity' && allowedTabs.includes('activity') && <LogisticsActivityTab setError={setError} />}
          {tab === 'monitor' && allowedTabs.includes('monitor') && <FleetDistributionMonitor setError={setError} />}
          {tab === 'deliveries' && allowedTabs.includes('deliveries') && (
            <CompletedDeliveriesTab
              setError={setError}
              noteDeliveryId={noteTripId}
              onNoteDeliveryHandled={() => setNoteTripId(null)}
            />
          )}
          {tab === 'fuel_regulation' && allowedTabs.includes('fuel_regulation') && (
            <FuelRegulationTab setError={setError} />
          )}
          {tab === 'manage-tab-access' && isTabAccessAdmin && (
            <>
              <ManagePageTabAccess
                pageKey="tracking_management"
                pageLabel="Tracking management"
                allTabIds={TRACKING_TAB_IDS}
                tabLabels={TRACKING_TAB_LABELS}
                permissions={permissions}
                setPermissions={setPermissions}
                users={tabAccessUsers}
                setUsers={setTabAccessUsers}
                emptyMeansAll={true}
                onError={setError}
              />
              <TrackingNotificationSettings setError={setError} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
