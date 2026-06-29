import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import { fleetMotionColor } from '../../lib/fleetMapIcons.js';

const FleetLiveMap = lazy(() => import('../FleetLiveMap.jsx'));

function MapSkeleton() {
  return <div className="w-full h-full min-h-[280px] bg-[#1a1d24] animate-pulse" />;
}

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function motionLabel(trip) {
  const speed = Number(trip?.last_speed_kmh);
  if (Number.isFinite(speed)) {
    if (speed >= 5) return 'Driving';
    if (speed > 0) return 'Slow';
    return 'Stopped';
  }
  const status = String(trip?.status || '').toLowerCase();
  if (status === 'enroute') return 'Driving';
  if (status === 'pending') return 'Idle';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

function groupTrips(trips) {
  const groups = new Map();
  for (const trip of trips) {
    const key = trip.contractor_name?.trim() || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trip);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({
      name,
      items: items.sort((a, b) => String(a.truck_registration).localeCompare(String(b.truck_registration))),
    }));
}

function locKey(trip) {
  if (trip?.last_lat == null || trip?.last_lng == null) return null;
  return `${Number(trip.last_lat).toFixed(4)},${Number(trip.last_lng).toFixed(4)}`;
}

function shortPlace(ctx) {
  if (!ctx) return null;
  const parts = [ctx.street, ctx.suburb, ctx.town || ctx.city].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.slice(0, 2).join(', ') || ctx.road_name || null;
}

function ObjectRow({ trip, selected, visible, onSelect, onToggleVisible, placeHint }) {
  const color = fleetMotionColor(trip);
  const speed = Number.isFinite(Number(trip.last_speed_kmh)) ? `${Math.round(Number(trip.last_speed_kmh))} KM/H` : '—';

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors ${
        selected
          ? 'bg-sky-500/15 border-sky-400'
          : 'border-transparent hover:bg-white/5'
      }`}
      onClick={() => onSelect(trip.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(trip.id)}
      role="button"
      tabIndex={0}
    >
      <input
        type="checkbox"
        checked={visible}
        onChange={(e) => {
          e.stopPropagation();
          onToggleVisible(trip.id);
        }}
        onClick={(e) => e.stopPropagation()}
        className="rounded border-white/20 bg-transparent text-sky-500 focus:ring-sky-500/40"
        aria-label={`Show ${trip.truck_registration} on map`}
      />
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{trip.truck_registration}</p>
        <p className="truncate text-[11px] text-slate-400">
          {placeHint || formatTime(trip.last_seen_at)}
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-slate-300">{speed}</span>
    </div>
  );
}

function DetailPanel({ trip, locationContext, locationLoading }) {
  if (!trip) return null;
  const color = fleetMotionColor(trip);
  const speedNum = Number(trip.last_speed_kmh);
  const speed = Number.isFinite(speedNum) ? `${Math.round(speedNum)} KM/H` : '—';
  const limit = locationContext?.speed_limit_kmh;
  const limitLabel = limit != null ? `${limit} KM/H` : locationContext?.speed_limit_raw || '—';
  const overLimit = limit != null && Number.isFinite(speedNum) && speedNum > limit;

  const streetLine = [locationContext?.house_number, locationContext?.street].filter(Boolean).join(' ') || locationContext?.street;
  const locality = [locationContext?.suburb, locationContext?.town || locationContext?.city, locationContext?.state]
    .filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .join(', ');

  const stats = [
    { label: 'Status', value: motionLabel(trip), accent: color },
    { label: 'Speed', value: speed, accent: overLimit ? '#ef4444' : undefined },
    { label: 'Road limit', value: limitLabel, accent: limit != null ? '#38bdf8' : undefined },
    { label: 'Heading', value: trip.last_heading_deg != null ? `${Math.round(Number(trip.last_heading_deg))}°` : '—' },
    { label: 'Driver', value: trip.driver_name || '—' },
    { label: 'Contractor', value: trip.contractor_name || '—' },
    { label: 'Road', value: locationContext?.road_name || locationContext?.road_ref || '—' },
    { label: 'Last update', value: formatTime(trip.last_seen_at) },
  ];

  return (
    <div className="border-t border-white/10 bg-[#23262e] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h3 className="text-base font-bold text-white">{trip.truck_registration}</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: `${color}33`, color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {motionLabel(trip)}
        </span>
        {overLimit && (
          <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">
            Over road limit
          </span>
        )}
      </div>

      <div className="mb-3 rounded-lg border border-white/8 bg-[#1a1d24] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Address</p>
        {locationLoading ? (
          <p className="text-sm text-slate-400">Looking up street and place names…</p>
        ) : locationContext?.address_line ? (
          <>
            {streetLine && <p className="text-sm font-semibold text-white">{streetLine}</p>}
            {locality && <p className="text-sm text-slate-300">{locality}</p>}
            {locationContext.postcode && <p className="text-xs text-slate-500 mt-0.5">{locationContext.postcode}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-400">
            {trip.last_lat != null && trip.last_lng != null
              ? `${Number(trip.last_lat).toFixed(5)}, ${Number(trip.last_lng).toFixed(5)}`
              : 'No GPS position'}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {stats.map(({ label, value, accent }) => (
          <div key={label} className="rounded-lg border border-white/8 bg-[#1a1d24] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-0.5 text-sm font-semibold truncate" style={accent ? { color: accent } : { color: '#e2e8f0' }}>
              {value}
            </p>
          </div>
        ))}
      </div>
      {(trip.collection_point_name || trip.destination_name) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-400">
          {trip.collection_point_name && (
            <p><span className="text-slate-500">Loading:</span> {trip.collection_point_name}</p>
          )}
          {trip.destination_name && (
            <p><span className="text-slate-500">Destination:</span> {trip.destination_name}</p>
          )}
        </div>
      )}
    </div>
  );
}

function FleetCamShell({
  mapTrips,
  routes,
  geofences,
  pollStatus,
  refreshing,
  onRefresh,
  className,
  resizeKey,
  fullscreen,
  onClose,
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [visibleIds, setVisibleIds] = useState(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [locationByKey, setLocationByKey] = useState({});
  const [locationLoadingKey, setLocationLoadingKey] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('fleetMonitor.objectsHidden') !== '1';
    } catch {
      return true;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('fleetMonitor.objectsHidden', next ? '0' : '1');
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      for (const trip of mapTrips) {
        if (trip.id) next.add(trip.id);
      }
      return next;
    });
  }, [mapTrips]);

  const selectedTrip = mapTrips.find((t) => t.id === selectedId) || null;
  const selectedLocKey = locKey(selectedTrip);

  useEffect(() => {
    if (!selectedTrip || selectedLocKey == null) return undefined;
    if (locationByKey[selectedLocKey]) return undefined;

    let cancelled = false;
    setLocationLoadingKey(selectedLocKey);
    trackingApi.map
      .locationContext(selectedTrip.last_lat, selectedTrip.last_lng)
      .then((res) => {
        if (cancelled || !res?.context) return;
        setLocationByKey((prev) => ({ ...prev, [selectedLocKey]: res.context }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLocationLoadingKey(null);
      });

    return () => { cancelled = true; };
  }, [selectedTrip, selectedLocKey, locationByKey]);

  // Prefetch place names for sidebar (throttled, max 6 per board load)
  useEffect(() => {
    const queue = mapTrips
      .filter((t) => {
        const key = locKey(t);
        return key && !locationByKey[key];
      })
      .slice(0, 6);
    if (!queue.length) return undefined;

    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled || i >= queue.length) return;
      const trip = queue[i];
      const key = locKey(trip);
      i += 1;
      if (!key || locationByKey[key]) {
        tick();
        return;
      }
      trackingApi.map
        .locationContext(trip.last_lat, trip.last_lng)
        .then((res) => {
          if (cancelled || !res?.context) return;
          setLocationByKey((prev) => (prev[key] ? prev : { ...prev, [key]: res.context }));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setTimeout(tick, 1200);
        });
    };
    const start = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [mapTrips]);

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mapTrips;
    return mapTrips.filter(
      (t) =>
        String(t.truck_registration || '').toLowerCase().includes(q) ||
        String(t.driver_name || '').toLowerCase().includes(q) ||
        String(t.contractor_name || '').toLowerCase().includes(q)
    );
  }, [mapTrips, search]);

  const groups = useMemo(() => groupTrips(filteredTrips), [filteredTrips]);
  const visibleSet = visibleIds;
  const selectedLocation = selectedLocKey ? locationByKey[selectedLocKey] : null;

  const locationByTripId = useMemo(() => {
    const out = {};
    for (const trip of mapTrips) {
      const key = locKey(trip);
      if (key && locationByKey[key]) out[trip.id] = locationByKey[key];
    }
    return out;
  }, [mapTrips, locationByKey]);

  const toggleVisible = (id) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`flex flex-col bg-[#1a1d24] text-slate-200 overflow-hidden ${className}`}>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-[#23262e] lg:w-80">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex gap-1">
              <span className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white">Objects</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                {refreshing ? '…' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/5"
                title="Hide objects panel"
                aria-label="Hide objects panel"
              >
                ◀ Hide
              </button>
            </div>
          </div>

          <div className="border-b border-white/10 p-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search registration, driver…"
              className="w-full rounded-lg border border-white/10 bg-[#1a1d24] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
            />
            <p className="mt-2 text-[11px] text-slate-500">
              {filteredTrips.length} object{filteredTrips.length === 1 ? '' : 's'}
              {pollStatus?.interval_ms ? ` · poll ${Math.round(pollStatus.interval_ms / 1000)}s` : ''}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-sm text-slate-500">No vehicles with GPS yet.</p>
            ) : (
              groups.map(({ name, items }) => {
                const collapsed = collapsedGroups[name];
                return (
                  <div key={name} className="border-b border-white/5">
                    <button
                      type="button"
                      onClick={() => setCollapsedGroups((g) => ({ ...g, [name]: !g[name] }))}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 hover:bg-white/5"
                    >
                      <span>{name} ({items.length})</span>
                      <span>{collapsed ? '▸' : '▾'}</span>
                    </button>
                    {!collapsed &&
                      items.map((trip) => (
                        <ObjectRow
                          key={trip.id}
                          trip={trip}
                          selected={trip.id === selectedId}
                          visible={visibleSet.has(trip.id)}
                          onSelect={setSelectedId}
                          onToggleVisible={toggleVisible}
                          placeHint={shortPlace(locationByKey[locKey(trip)])}
                        />
                      ))}
                  </div>
                );
              })
            )}
          </div>
        </aside>
        )}

        <div className="relative min-w-0 flex-1">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="absolute top-3 left-3 z-[1000] inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-sky-500"
              title="Show objects panel"
              aria-label="Show objects panel"
            >
              ▶ Objects
            </button>
          )}
          {fullscreen && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 z-[1000] rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow"
            >
              Close
            </button>
          )}
          <Suspense fallback={<MapSkeleton />}>
            <FleetLiveMap
              trips={mapTrips}
              routes={routes}
              geofences={geofences}
              className="h-full min-h-[inherit]"
              resizeKey={`${resizeKey}-${sidebarOpen ? 'open' : 'hidden'}`}
              basemap="satellite"
              showMapLabels
              selectedTripId={selectedId}
              visibleTripIds={visibleSet}
              onSelectTrip={setSelectedId}
              showAllLabels={false}
              locationByTripId={locationByTripId}
              showLabelControl
            />
          </Suspense>
        </div>
      </div>

      <DetailPanel
        trip={selectedTrip}
        locationContext={selectedLocation}
        locationLoading={!!selectedTrip && selectedLocKey === locationLoadingKey}
      />
    </div>
  );
}

/** Live fleet monitor — FleetCam-style objects sidebar, satellite map, and detail panel. */
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
      <div className="rounded-xl border border-white/10 overflow-hidden animate-pulse">
        <div className="h-10 bg-[#23262e]" />
        <MapSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Fleet monitor</h1>
          <p className="text-sm text-surface-500 mt-0.5">FleetCam-style live tracking with directional vehicle icons</p>
        </div>
        {!mapExpanded && (
          <button
            type="button"
            onClick={() => setMapExpanded(true)}
            className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm hover:bg-surface-50 dark:border-surface-700 dark:hover:bg-surface-800"
          >
            Expand map
          </button>
        )}
      </header>

      {!mapExpanded && (
        <div className="rounded-xl border border-white/10 overflow-hidden h-[min(72vh,720px)] min-h-[480px]">
          <FleetCamShell
            mapTrips={mapTrips}
            routes={routes}
            geofences={geofences}
            pollStatus={pollStatus}
            refreshing={refreshing}
            onRefresh={refresh}
            className="h-full"
            resizeKey={`inline-${mapTrips.length}-${geofences.length}`}
          />
        </div>
      )}

      {mapExpanded && (
        <div className="fixed inset-0 z-[2000] bg-[#0f1419]">
          <FleetCamShell
            mapTrips={mapTrips}
            routes={routes}
            geofences={geofences}
            pollStatus={pollStatus}
            refreshing={refreshing}
            onRefresh={refresh}
            className="h-full"
            resizeKey={`fullscreen-${mapTrips.length}`}
            fullscreen
            onClose={() => setMapExpanded(false)}
          />
        </div>
      )}
    </div>
  );
}
