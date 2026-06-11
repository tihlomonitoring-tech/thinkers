import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { tracking as trackingApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import GeofenceRoutesTab from './components/tracking/GeofenceRoutesTab.jsx';
import FleetIntegrationTab from './components/tracking/FleetIntegrationTab.jsx';
import FleetDistributionMonitor from './components/tracking/FleetDistributionMonitor.jsx';
import LogisticsActivityTab from './components/tracking/LogisticsActivityTab.jsx';
import CompletedDeliveriesTab from './components/tracking/CompletedDeliveriesTab.jsx';

const TABS = [
  { id: 'geofence', label: 'Geofence routes', description: 'Map geofences on Access Management routes' },
  { id: 'integration', label: 'Fleet integration', description: 'Cartrack, FleetCam & unit links' },
  { id: 'activity', label: 'Logistics Activity', description: 'Schedule loads · slips · stage board' },
  { id: 'monitor', label: 'Monitor', description: 'Live fleet map' },
  { id: 'deliveries', label: 'Completed deliveries', description: 'Delivery notes for Command Centre' },
];

export default function TrackingManagement() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('tracking-management');
  const [tab, setTab] = useState('activity');
  const [error, setError] = useState('');
  const [migrationHint, setMigrationHint] = useState('');
  const [noteTripId, setNoteTripId] = useState(null);

  useAutoHideNavAfterTabChange(tab);

  useEffect(() => {
    trackingApi.dashboard().then((d) => {
      if (d.migration_required && d.migration_hint) setMigrationHint(d.migration_hint);
      else setMigrationHint('');
    }).catch(() => {
      setMigrationHint('Run: npm run db:tracking-setup (then restart the API).');
    });
  }, [tab]);

  const openDeliveryNote = (vehicle) => {
    setNoteTripId(vehicle.trip_id || vehicle.truck_registration);
    setTab('deliveries');
  };

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
            {TABS.map((t) => (
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
          {migrationHint && (
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

          {tab === 'geofence' && <GeofenceRoutesTab setError={setError} />}
          {tab === 'integration' && <FleetIntegrationTab setError={setError} />}
          {tab === 'activity' && <LogisticsActivityTab setError={setError} />}
          {tab === 'monitor' && <FleetDistributionMonitor setError={setError} />}
          {tab === 'deliveries' && (
            <CompletedDeliveriesTab
              setError={setError}
              noteDeliveryId={noteTripId}
              onNoteDeliveryHandled={() => setNoteTripId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
