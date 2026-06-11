import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, Polyline, Polygon, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './FleetLiveMap.css';
import FleetMapBasemap from './FleetMapBasemap.jsx';
import { parsePolygonJson } from '../lib/routeCorridorGeofence.js';
import { fleetTruckIcon, FLEET_STATUS_COLORS } from '../lib/fleetMapIcons.js';

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
  return '#64748b';
}

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions?.length) return;
    if (positions.length === 1) {
      map.setView(positions[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(positions.map(([lat, lng]) => [lat, lng])), { padding: [48, 48], maxZoom: 11 });
  }, [map, positions]);
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

function MapLegend({ vehicleCount }) {
  const items = [
    { key: 'enroute', label: 'En route' },
    { key: 'pending', label: 'Pending' },
    { key: 'deviated', label: 'Deviated' },
    { key: 'overdue', label: 'Overdue' },
  ];
  return (
    <div className="fleet-map-legend absolute bottom-3 left-3 z-[1000] rounded-lg border border-surface-200/90 bg-white/95 px-3 py-2 shadow-md dark:border-surface-700 dark:bg-surface-900/95">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 mb-1.5">
        Fleet live · {vehicleCount} unit{vehicleCount === 1 ? '' : 's'}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map(({ key, label }) => (
          <span key={key} className="inline-flex items-center gap-1 text-[10px] text-surface-600 dark:text-surface-300">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FLEET_STATUS_COLORS[key] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Live fleet map with geofenced routes, road polylines, and truck markers.
 */
export default function FleetLiveMap({ trips = [], routes = [], geofences = [], className = '', resizeKey = '' }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { withPos, positions, routeLines, center } = useMemo(() => {
    const withPos = (trips || []).filter(
      (t) => t.last_lat != null && t.last_lng != null && Number.isFinite(Number(t.last_lat)) && Number.isFinite(Number(t.last_lng))
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
          routeLines.push({ key, points: polyline.map((p) => [p.lat, p.lng]), color: '#0ea5e9', weight: 4 });
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
          routeLines.push({ key, points: wp.map((p) => [p.lat, p.lng]), color: '#0ea5e9', weight: 4 });
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
            color: '#94a3b8',
            weight: 2,
            dashArray: '6 4',
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

    return { withPos, positions, routeLines, center };
  }, [trips, routes, geofences]);

  const shellClass = className || 'h-80';

  if (!mounted) {
    return (
      <div className={`fleet-live-map rounded-xl border border-surface-200 bg-surface-100 flex items-center justify-center text-surface-500 text-sm ${shellClass}`}>
        Loading map…
      </div>
    );
  }

  const hasGeofences = (geofences || []).length > 0;
  const hasOverlay = hasGeofences || routeLines.length > 0;

  return (
    <div className={`fleet-live-map relative rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden shadow-sm z-0 ${shellClass}`}>
      <MapContainer center={center} zoom={10} className="absolute inset-0 h-full w-full z-0" scrollWheelZoom>
        <FleetMapBasemap />

        {(geofences || []).map((g) => {
          const ring = parsePolygonJson(g.polygon_json);
          const color = legColor(g.leg);
          if (ring?.length >= 3) {
            return (
              <Polygon
                key={`poly-${g.id}`}
                positions={ring.map((p) => [p.lat, p.lng])}
                pathOptions={{ color, weight: 2, fillOpacity: 0.1 }}
              />
            );
          }
          if (g.center_lat != null && g.center_lng != null && g.radius_m) {
            return (
              <Circle
                key={`circle-${g.id}`}
                center={[Number(g.center_lat), Number(g.center_lng)]}
                radius={Number(g.radius_m) || 500}
                pathOptions={{ color, fillOpacity: 0.12 }}
              />
            );
          }
          return null;
        })}

        {routeLines.map((line) => (
          <Polyline
            key={line.key}
            positions={line.points}
            pathOptions={{
              color: line.color,
              weight: line.weight || 4,
              opacity: 0.85,
              dashArray: line.dashArray,
            }}
          />
        ))}

        {withPos.map((trip) => (
          <Marker
            key={trip.id || trip.truck_registration}
            position={[Number(trip.last_lat), Number(trip.last_lng)]}
            icon={fleetTruckIcon(trip.status, trip.last_heading_deg)}
          >
            <Popup className="fleet-truck-popup" minWidth={180}>
              <div className="space-y-1">
                <p className="font-bold text-surface-900">{trip.truck_registration || 'Truck'}</p>
                <p className="text-xs capitalize text-surface-600">{trip.status || '—'}</p>
                {trip.last_speed_kmh != null && (
                  <p className="text-xs text-surface-600">{Math.round(Number(trip.last_speed_kmh))} km/h</p>
                )}
                {trip.last_heading_deg != null && (
                  <p className="text-xs text-surface-500">Heading {Math.round(Number(trip.last_heading_deg))}°</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {positions.length > 0 && <FitBounds positions={positions} />}
        <MapResizeWatcher resizeKey={resizeKey || className} />
      </MapContainer>

      {withPos.length > 0 && <MapLegend vehicleCount={withPos.length} />}

      {positions.length === 0 && !hasOverlay && (
        <p className="absolute bottom-0 inset-x-0 text-xs text-surface-500 px-3 py-2 bg-surface-50/95 border-t border-surface-100 dark:bg-surface-900/95 dark:border-surface-800">
          No GPS or geofences yet. Link FleetCam units under Fleet integration.
        </p>
      )}
      {hasOverlay && withPos.length === 0 && (
        <p className="absolute bottom-0 inset-x-0 text-xs text-surface-500 px-3 py-2 bg-surface-50/95 border-t border-surface-100 dark:bg-surface-900/95 dark:border-surface-800">
          Geofenced route shown. Fleet icons appear when trucks report GPS.
        </p>
      )}
    </div>
  );
}
