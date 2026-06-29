import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, Polyline, Polygon, Circle, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './FleetLiveMap.css';
import FleetMapBasemap from './FleetMapBasemap.jsx';
import { parsePolygonJson } from '../lib/routeCorridorGeofence.js';
import { fleetCamVehicleIcon } from '../lib/fleetMapIcons.js';
import GeofencePlaceLabels from './tracking/GeofencePlaceLabels.jsx';
import GeofenceLabelControl, { useGeofenceLabelMode } from './tracking/GeofenceLabelControl.jsx';
import { landGeofencePlaces } from '../lib/geofenceLabels.js';

function parseWaypoints(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) return [];
    return data
      .map((p) => ({ lat: Number(p.lat ?? p[0]), lng: Number(p.lng ?? p[1]) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch {
    return [];
  }
}

function routePolylineFromGeofence(g) {
  if (!g?.polygon_json) return [];
  try {
    const parsed = typeof g.polygon_json === 'string' ? JSON.parse(g.polygon_json) : g.polygon_json;
    if (parsed?.route_polyline?.length) {
      return parsed.route_polyline.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
    }
  } catch {
    /* ignore */
  }
  return [];
}

function legColor(leg) {
  if (leg === 'origin') return '#2563eb';
  if (leg === 'destination') return '#059669';
  if (leg === 'corridor') return '#7c3aed';
  if (leg === 'corridor_alt') return '#0891b2';
  return '#64748b';
}

function FitBounds({ positions, selectedPosition, selectedTripId, selectedZoom = 13 }) {
  const map = useMap();
  const lastFocusedTripRef = useRef(null);

  useEffect(() => {
    if (selectedPosition) {
      const tripChanged =
        selectedTripId != null ? selectedTripId !== lastFocusedTripRef.current : lastFocusedTripRef.current !== 'position';
      if (tripChanged) {
        lastFocusedTripRef.current = selectedTripId ?? 'position';
        map.flyTo(selectedPosition, selectedZoom, { duration: 0.65 });
      } else {
        map.panTo(selectedPosition, { animate: true, duration: 0.35 });
      }
      return;
    }
    lastFocusedTripRef.current = null;
    if (!positions?.length) return;
    if (positions.length === 1) {
      map.setView(positions[0], 12);
      return;
    }
    map.fitBounds(L.latLngBounds(positions.map(([lat, lng]) => [lat, lng])), { padding: [48, 48], maxZoom: 12 });
  }, [map, positions, selectedPosition, selectedTripId, selectedZoom]);
  return null;
}

function MapResizeWatcher({ resizeKey }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(id);
  }, [map, resizeKey]);
  return null;
}

function TravelTrailPane() {
  const map = useMap();
  useEffect(() => {
    if (!map.getPane('travelTrailPane')) {
      const pane = map.createPane('travelTrailPane');
      pane.style.zIndex = '520';
    }
  }, [map]);
  return null;
}

/**
 * Live fleet map with geofenced routes, satellite basemap, and directional vehicle markers.
 */
export default function FleetLiveMap({
  trips = [],
  routes = [],
  geofences = [],
  className = '',
  resizeKey = '',
  basemap = 'satellite',
  showMapLabels = true,
  selectedTripId = null,
  visibleTripIds = null,
  onSelectTrip = null,
  showAllLabels = false,
  locationByTripId = {},
  selectedZoom = 13,
  travelTrail = [],
  showLabelControl = false,
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [labelMode, setLabelMode] = useGeofenceLabelMode();
  const labelPlaceCount = useMemo(() => landGeofencePlaces(geofences).length, [geofences]);
  const effectiveLabelMode = showLabelControl ? labelMode : 'all';

  const { withPos, positions, routeLines, center, selectedPosition } = useMemo(() => {
    const visibleSet = visibleTripIds instanceof Set ? visibleTripIds : null;
    const withPos = (trips || []).filter(
      (t) =>
        t.last_lat != null &&
        t.last_lng != null &&
        Number.isFinite(Number(t.last_lat)) &&
        Number.isFinite(Number(t.last_lng)) &&
        (!visibleSet || visibleSet.has(t.id))
    );
    const positions = [];

    withPos.forEach((t) => positions.push([Number(t.last_lat), Number(t.last_lng)]));

    const routeLines = [];
    const seenRouteKeys = new Set();

    for (const g of geofences || []) {
      const polyline = routePolylineFromGeofence(g);
      if (polyline.length > 1) {
        const key = `gf-${g.contractor_route_id || g.id}-line`;
        if (!seenRouteKeys.has(key)) {
          seenRouteKeys.add(key);
          routeLines.push({ key, points: polyline.map((p) => [p.lat, p.lng]), color: '#38bdf8', weight: 3, opacity: 0.75 });
          polyline.forEach((p) => positions.push([p.lat, p.lng]));
        }
      }
      const ring = parsePolygonJson(g.polygon_json);
      ring?.forEach((p) => positions.push([p.lat, p.lng]));
      if (g.center_lat != null && g.center_lng != null) {
        positions.push([Number(g.center_lat), Number(g.center_lng)]);
      }
    }

    for (const r of routes || []) {
      const wp = parseWaypoints(r.waypoints_json);
      if (wp.length > 1) {
        const key = `mr-${r.contractor_route_id || r.id}`;
        if (!seenRouteKeys.has(key)) {
          seenRouteKeys.add(key);
          routeLines.push({ key, points: wp.map((p) => [p.lat, p.lng]), color: '#38bdf8', weight: 3, opacity: 0.75 });
          wp.forEach((p) => positions.push([p.lat, p.lng]));
        }
      } else if (r.origin_lat != null && r.origin_lng != null && r.dest_lat != null && r.dest_lng != null) {
        const key = `mr-line-${r.id}`;
        if (!seenRouteKeys.has(key)) {
          seenRouteKeys.add(key);
          routeLines.push({
            key,
            points: [
              [Number(r.origin_lat), Number(r.origin_lng)],
              [Number(r.dest_lat), Number(r.dest_lng)],
            ],
            color: '#64748b',
            weight: 2,
            dashArray: '6 4',
            opacity: 0.6,
          });
          positions.push([Number(r.origin_lat), Number(r.origin_lng)], [Number(r.dest_lat), Number(r.dest_lng)]);
        }
      }
    }

    const center =
      positions.length > 0
        ? [
            positions.reduce((s, p) => s + p[0], 0) / positions.length,
            positions.reduce((s, p) => s + p[1], 0) / positions.length,
          ]
        : [-26.15, 28.12];

    const selected = withPos.find((t) => t.id === selectedTripId);
    const selectedPosition = selected ? [Number(selected.last_lat), Number(selected.last_lng)] : null;

    return { withPos, positions, routeLines, center, selectedPosition };
  }, [trips, routes, geofences, selectedTripId, visibleTripIds]);

  const shellClass = className || 'h-80';
  const mapTheme = basemap === 'satellite' ? 'fleet-live-map--satellite' : '';
  const trailPositions = useMemo(
    () =>
      (travelTrail || [])
        .map((p) => [Number(p.lat), Number(p.lng)])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)),
    [travelTrail]
  );

  if (!mounted) {
    return (
      <div className={`fleet-live-map ${mapTheme} rounded-xl border border-surface-200 bg-surface-100 flex items-center justify-center text-surface-500 text-sm ${shellClass}`}>
        Loading map…
      </div>
    );
  }

  const hasGeofences = (geofences || []).length > 0;
  const hasOverlay = hasGeofences || routeLines.length > 0;

  return (
    <div className={`fleet-live-map ${mapTheme} relative overflow-hidden z-0 ${shellClass}`}>
      <MapContainer center={center} zoom={11} maxZoom={19} className="absolute inset-0 h-full w-full z-0" scrollWheelZoom zoomControl={false}>
        <ZoomControl position="bottomright" />
        <FleetMapBasemap variant={basemap} showLabels={showMapLabels} />
        <TravelTrailPane />

        {(geofences || []).map((g) => {
          const ring = parsePolygonJson(g.polygon_json);
          const color = legColor(g.leg);
          if (ring?.length >= 3) {
            return (
              <Polygon
                key={`poly-${g.id}`}
                positions={ring.map((p) => [p.lat, p.lng])}
                pathOptions={{ color, weight: 2, fillOpacity: 0.08 }}
              />
            );
          }
          if (g.center_lat != null && g.center_lng != null && g.radius_m) {
            return (
              <Circle
                key={`circle-${g.id}`}
                center={[Number(g.center_lat), Number(g.center_lng)]}
                radius={Number(g.radius_m) || 500}
                pathOptions={{ color, fillOpacity: 0.08 }}
              />
            );
          }
          return null;
        })}

        <GeofencePlaceLabels geofences={geofences} mode={effectiveLabelMode} />

        {routeLines.map((line) => (
          <Polyline
            key={line.key}
            positions={line.points}
            pathOptions={{
              color: line.color,
              weight: line.weight || 4,
              opacity: line.opacity ?? 0.85,
              dashArray: line.dashArray,
            }}
          />
        ))}

        {trailPositions.length >= 2 && (
          <>
            <Polyline
              pane="travelTrailPane"
              positions={trailPositions}
              pathOptions={{
                color: '#ffffff',
                weight: 14,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Polyline
              pane="travelTrailPane"
              positions={trailPositions}
              pathOptions={{
                color: '#ff9500',
                weight: 7,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Circle
              pane="travelTrailPane"
              center={trailPositions[0]}
              radius={18}
              pathOptions={{
                color: '#ffffff',
                weight: 3,
                fillColor: '#ff9500',
                fillOpacity: 1,
              }}
            />
          </>
        )}

        {withPos.map((trip) => {
          const selected = trip.id === selectedTripId;
          const showLabel = showAllLabels || selected;
          const loc = locationByTripId?.[trip.id];
          const tripForIcon = loc
            ? {
                ...trip,
                _labelExtra: loc.speed_limit_kmh != null ? ` · limit ${loc.speed_limit_kmh}` : '',
              }
            : trip;
          return (
            <Marker
              key={trip.id || trip.truck_registration}
              position={[Number(trip.last_lat), Number(trip.last_lng)]}
              icon={fleetCamVehicleIcon(tripForIcon, { selected, showLabel })}
              eventHandlers={{
                click: () => onSelectTrip?.(trip.id),
              }}
              zIndexOffset={selected ? 1000 : 0}
            >
              <Popup className="fleet-truck-popup" minWidth={220}>
                <div className="space-y-1 text-sm">
                  <p className="font-bold text-surface-900">{trip.truck_registration || 'Truck'}</p>
                  {loc?.address_line && (
                    <p className="text-xs text-surface-700 leading-snug">{loc.address_line}</p>
                  )}
                  {loc?.road_name && (
                    <p className="text-xs text-surface-600">
                      Road: {loc.road_name}
                      {loc.speed_limit_kmh != null ? ` · limit ${loc.speed_limit_kmh} km/h` : ''}
                    </p>
                  )}
                  {trip.driver_name && <p className="text-xs text-surface-600">Driver: {trip.driver_name}</p>}
                  <p className="text-xs capitalize text-surface-600">{trip.status || '—'}</p>
                  {trip.last_speed_kmh != null && (
                    <p className="text-xs text-surface-600">{Math.round(Number(trip.last_speed_kmh))} km/h</p>
                  )}
                  {trip.last_heading_deg != null && (
                    <p className="text-xs text-surface-500">Heading {Math.round(Number(trip.last_heading_deg))}°</p>
                  )}
                  {trip.last_seen_at && (
                    <p className="text-xs text-surface-500">Last seen {new Date(trip.last_seen_at).toLocaleString()}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        <FitBounds
          positions={positions}
          selectedPosition={selectedPosition}
          selectedTripId={selectedTripId}
          selectedZoom={selectedZoom}
        />
        <MapResizeWatcher resizeKey={resizeKey || className} />
      </MapContainer>

      {showLabelControl && labelPlaceCount > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000]">
          <GeofenceLabelControl
            mode={labelMode}
            onChange={setLabelMode}
            count={labelPlaceCount}
            menuPlacement="up"
          />
        </div>
      )}

      {positions.length === 0 && !hasOverlay && (
        <p className="absolute bottom-3 left-3 right-3 text-xs text-slate-300 px-3 py-2 bg-slate-900/85 border border-white/10 rounded-lg">
          No GPS or geofences yet. Link FleetCam units under Fleet integration.
        </p>
      )}
      {hasOverlay && withPos.length === 0 && (
        <p className="absolute bottom-3 left-3 right-3 text-xs text-slate-300 px-3 py-2 bg-slate-900/85 border border-white/10 rounded-lg">
          Geofenced route shown. Vehicle icons appear when trucks report GPS.
        </p>
      )}
      {trailPositions.length >= 2 && (
        <div className="fleet-travel-trail-legend absolute bottom-3 left-3 text-[10px] text-slate-200 px-2.5 py-1.5 bg-slate-900/88 border border-white/10 rounded-md flex items-center gap-2">
          <span className="inline-block w-8 h-1.5 rounded-full bg-[#ff9500] ring-2 ring-white/90" />
          Last 2 km travelled
        </div>
      )}
    </div>
  );
}