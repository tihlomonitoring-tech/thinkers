import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Bundler-safe default marker (Leaflet image paths break under Vite without this). */
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions?.length) return;
    if (positions.length === 1) {
      map.setView(positions[0], 11);
      return;
    }
    const b = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]));
    map.fitBounds(b, { padding: [36, 36], maxZoom: 11 });
  }, [map, positions]);
  return null;
}

/**
 * @param {object} props
 * @param {Array<{ id: string, truck_registration: string, last_lat?: number|null, last_lng?: number|null, route_id?: string|null, status?: string }>} props.trips
 * @param {Array<{ id: string, origin_lat?: number|null, origin_lng?: number|null, dest_lat?: number|null, dest_lng?: number|null, name?: string }>} props.routes
 */
export default function FleetLiveMap({ trips, routes, className = '' }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { withPos, positions, linePoints, center } = useMemo(() => {
    const withPos = (trips || []).filter(
      (t) => t.last_lat != null && t.last_lng != null && Number.isFinite(Number(t.last_lat)) && Number.isFinite(Number(t.last_lng))
    );
    const positions = withPos.map((t) => [Number(t.last_lat), Number(t.last_lng)]);
    let linePoints = [];
    const routeById = new Map((routes || []).map((r) => [r.id, r]));
    const firstRid = withPos.find((t) => t.route_id)?.route_id;
    if (firstRid && routeById.has(firstRid)) {
      const r = routeById.get(firstRid);
      const oLat = r.origin_lat != null ? Number(r.origin_lat) : null;
      const oLng = r.origin_lng != null ? Number(r.origin_lng) : null;
      const dLat = r.dest_lat != null ? Number(r.dest_lat) : null;
      const dLng = r.dest_lng != null ? Number(r.dest_lng) : null;
      if (oLat != null && oLng != null && dLat != null && dLng != null) {
        linePoints = [
          [oLat, oLng],
          [dLat, dLng],
        ];
      }
    }
    const center =
      positions.length > 0
        ? [positions.reduce((s, p) => s + p[0], 0) / positions.length, positions.reduce((s, p) => s + p[1], 0) / positions.length]
        : [-26.15, 28.12];
    return { withPos, positions, linePoints, center };
  }, [trips, routes]);

  if (!mounted) {
    return (
      <div className={`rounded-xl border border-surface-200 bg-surface-100 h-80 flex items-center justify-center text-surface-500 text-sm ${className}`}>
        Loading map…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-surface-200 overflow-hidden shadow-sm z-0 ${className}`}>
      <MapContainer center={center} zoom={10} className="h-80 w-full z-0" scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {linePoints.length === 2 && <Polyline positions={linePoints} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.75 }} />}
        {withPos.map((trip) => (
          <Marker key={trip.id} position={[Number(trip.last_lat), Number(trip.last_lng)]}>
            <Popup>
              <span className="font-semibold">{trip.truck_registration || 'Truck'}</span>
              <br />
              <span className="text-xs text-surface-600">{trip.status || '—'}</span>
              {trip.last_speed_kmh != null && (
                <>
                  <br />
                  <span className="text-xs">{Math.round(Number(trip.last_speed_kmh))} km/h</span>
                </>
              )}
            </Popup>
          </Marker>
        ))}
        {positions.length > 0 && <FitBounds positions={positions} />}
      </MapContainer>
      {positions.length === 0 && (
        <p className="text-xs text-surface-500 px-3 py-2 bg-surface-50 border-t border-surface-100">
          No GPS positions yet. Create trips, activate delivery, or run <code className="text-[10px]">npm run db:tracking-mock</code> for demo trucks.
        </p>
      )}
    </div>
  );
}
