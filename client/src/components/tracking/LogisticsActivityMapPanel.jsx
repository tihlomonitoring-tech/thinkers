import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { tracking as trackingApi } from '../../api';

const FleetLiveMap = lazy(() => import('../FleetLiveMap.jsx'));

function MapSkeleton() {
  return <div className="w-full h-full min-h-[280px] bg-[#1a1d24] animate-pulse" />;
}

function formatSeen(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

/** Live map for a selected logistics activity truck. */
export default function LogisticsActivityMapPanel({
  tripId,
  trip,
  mapTrips = [],
  routes = [],
  geofences = [],
  onSelectTrip,
  onClose,
}) {
  const [travelTrail, setTravelTrail] = useState([]);
  const [trailKm, setTrailKm] = useState(null);
  const [trailSource, setTrailSource] = useState(null);

  const visibleTripIds = useMemo(
    () => new Set(mapTrips.filter((t) => t.last_lat != null && t.last_lng != null).map((t) => t.id)),
    [mapTrips]
  );

  const hasGps = trip?.last_lat != null && trip?.last_lng != null;

  useEffect(() => {
    if (!tripId) {
      setTravelTrail([]);
      setTrailKm(null);
      setTrailSource(null);
      return;
    }
    let cancelled = false;
    trackingApi.trips
      .trail(tripId, { km: 2 })
      .then((res) => {
        if (cancelled) return;
        setTravelTrail(res.trail?.points || []);
        setTrailKm(res.trail?.distance_km ?? null);
        setTrailSource(res.trail?.source ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setTravelTrail([]);
          setTrailKm(null);
          setTrailSource(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, trip?.last_seen_at, trip?.last_lat, trip?.last_lng]);

  const trailHint =
    travelTrail.length >= 2
      ? `Orange line = last ${trailKm != null && trailKm > 0 ? `${trailKm} km` : '2 km'} travelled${
          trailSource === 'route' || trailSource === 'heading' || trailSource === 'estimated'
            ? ' (estimated from route/direction until GPS history builds)'
            : ''
        }`
      : hasGps
        ? 'Loading travel path…'
        : null;

  return (
    <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden shadow-sm bg-surface-900">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-white/10 bg-slate-900/95">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Truck on map</h2>
          <p className="text-xs text-slate-300 mt-0.5">
            <span className="font-mono font-bold text-sky-300">{trip?.truck_registration || '—'}</span>
            {trip?.driver_name && <span className="text-slate-400"> · {trip.driver_name}</span>}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {hasGps ? (
              <>
                {Number.isFinite(Number(trip.last_speed_kmh)) && (
                  <span>{Math.round(Number(trip.last_speed_kmh))} km/h · </span>
                )}
                {formatSeen(trip.last_seen_at) ? `Last GPS ${formatSeen(trip.last_seen_at)}` : 'GPS position available'}
                {trailHint && <span> · {trailHint}</span>}
              </>
            ) : (
              'No GPS fix yet — refresh GPS or wait for the tracker to report.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
        >
          Close map
        </button>
      </div>
      <Suspense fallback={<MapSkeleton />}>
        <FleetLiveMap
          trips={mapTrips}
          routes={routes}
          geofences={geofences}
          className="h-[min(48vh,440px)] w-full"
          resizeKey={`la-map-${tripId}-${mapTrips.length}-${travelTrail.length}`}
          basemap="satellite"
          showMapLabels
          selectedTripId={tripId}
          visibleTripIds={visibleTripIds}
          onSelectTrip={onSelectTrip}
          showAllLabels={false}
          selectedZoom={19}
          travelTrail={travelTrail}
        />
      </Suspense>
    </section>
  );
}
