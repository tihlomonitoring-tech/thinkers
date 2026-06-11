import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { tracking as trackingApi } from '../../api';

const FleetLiveMap = lazy(() => import('../FleetLiveMap.jsx'));

function MapSkeleton() {
  return <div className="w-full aspect-[16/9] min-h-[280px] rounded-xl border border-surface-200 bg-surface-100 dark:bg-surface-900 animate-pulse" />;
}

function FleetMapPanel({ mapTrips, routes, geofences, className, resizeKey, onExpand }) {
  return (
    <div className={`relative group ${className}`}>
      <Suspense fallback={<MapSkeleton />}>
        <FleetLiveMap trips={mapTrips} routes={routes} geofences={geofences} className="h-full min-h-[inherit]" resizeKey={resizeKey} />
      </Suspense>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="absolute top-3 right-3 z-[1000] rounded-lg border border-surface-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-surface-700 shadow-sm dark:border-surface-600 dark:bg-surface-900/95 dark:text-surface-200"
        >
          Expand map
        </button>
      )}
    </div>
  );
}

/** Live fleet map only — route activity board lives under Logistics Activity tab. */
export default function FleetDistributionMonitor({ setError }) {
  const [mapTrips, setMapTrips] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [pollStatus, setPollStatus] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    setError('');
    try {
      const board = await trackingApi.monitor.fleetBoard();
      setMapTrips(board.map_trips || []);
      setRoutes(board.routes || []);
      setGeofences(board.geofences || []);
      setPollStatus(board.poll || null);
    } catch (e) {
      setError(e?.message || 'Failed to load monitor');
    } finally {
      setInitialLoad(false);
      setRefreshing(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!mapExpanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMapExpanded(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [mapExpanded]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await trackingApi.poll.run().catch(() => ({}));
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Refresh failed');
      setRefreshing(false);
    }
  };

  if (initialLoad && !mapTrips.length) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-surface-200 dark:bg-surface-800 rounded" />
        <MapSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Fleet monitor</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Live map — polls every {Math.round((pollStatus?.interval_ms || 60000) / 1000)}s
            {refreshing && <span className="text-brand-600"> · updating…</span>}
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm hover:bg-surface-50 dark:border-surface-700 disabled:opacity-50">
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {!mapExpanded && (
        <FleetMapPanel
          mapTrips={mapTrips}
          routes={routes}
          geofences={geofences}
          className="w-full aspect-[16/9] min-h-[280px] max-h-[min(72vh,640px)]"
          resizeKey={`inline-${mapTrips.length}-${geofences.length}`}
          onExpand={() => setMapExpanded(true)}
        />
      )}

      {mapExpanded && (
        <div className="fixed inset-0 z-[2000] flex flex-col bg-surface-950/95 p-3 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Fleet map</h2>
              <p className="text-xs text-surface-400">Press Esc or Close to exit</p>
            </div>
            <button type="button" onClick={() => setMapExpanded(false)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-surface-900">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <FleetMapPanel
              mapTrips={mapTrips}
              routes={routes}
              geofences={geofences}
              className="h-full"
              resizeKey={`fullscreen-${mapTrips.length}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
