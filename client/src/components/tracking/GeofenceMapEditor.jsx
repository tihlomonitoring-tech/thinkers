import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Circle, Marker, Polygon, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import FleetMapBasemap from '../FleetMapBasemap.jsx';
import { parsePolygonJson } from '../../lib/routeCorridorGeofence.js';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

const vertexIcon = L.divIcon({
  className: 'geofence-vertex-handle',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions?.length) return;
    if (positions.length === 1) {
      map.setView(positions[0], 12);
      return;
    }
    map.fitBounds(L.latLngBounds(positions.map(([lat, lng]) => [lat, lng])), { padding: [40, 40], maxZoom: 13 });
  }, [map, positions]);
  return null;
}

function DraggableVertex({ position, index, onDrag }) {
  return (
    <Marker
      position={position}
      icon={vertexIcon}
      draggable
      eventHandlers={{
        dragend: (e) => {
          const { lat, lng } = e.target.getLatLng();
          onDrag?.(index, lat, lng);
        },
      }}
    />
  );
}

function legColor(leg) {
  if (leg === 'origin') return '#2563eb';
  if (leg === 'destination') return '#059669';
  if (leg === 'corridor') return '#7c3aed';
  return '#64748b';
}

export default function GeofenceMapEditor({
  geofences = [],
  preview = null,
  editRing = null,
  editCenter = null,
  editRadius = null,
  editLeg = null,
  onVertexDrag,
  onCenterDrag,
  fitKey = 0,
  className = '',
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const positions = useMemo(() => {
    const pts = [];
    if (preview?.route_polyline?.length) {
      preview.route_polyline.forEach((p) => pts.push([p.lat, p.lng]));
    }
    if (preview?.corridor_polygon?.length) {
      preview.corridor_polygon.forEach((p) => pts.push([p.lat, p.lng]));
    }
    if (preview?.origin) pts.push([preview.origin.lat, preview.origin.lng]);
    if (preview?.destination) pts.push([preview.destination.lat, preview.destination.lng]);
    geofences.forEach((g) => {
      if (g.center_lat != null && g.center_lng != null) pts.push([g.center_lat, g.center_lng]);
      const ring = parsePolygonJson(g.polygon_json);
      ring?.forEach((p) => pts.push([p.lat, p.lng]));
    });
    if (editRing?.length) editRing.forEach((p) => pts.push([p.lat, p.lng]));
    if (editCenter) pts.push([editCenter.lat, editCenter.lng]);
    return pts;
  }, [geofences, preview, editRing, editCenter, fitKey]);

  const center = positions[0] || [-26.15, 28.12];

  if (!mounted) {
    return <div className={`h-[32rem] rounded-xl bg-surface-100 flex items-center justify-center text-sm text-surface-500 ${className}`}>Loading map…</div>;
  }

  const showEditPolygon = editRing && editRing.length >= 3;

  return (
    <div className={`rounded-xl border border-surface-200 overflow-hidden h-[32rem] z-0 ${className}`}>
      <MapContainer center={center} zoom={9} className="h-full w-full" scrollWheelZoom>
        <FleetMapBasemap />
        <FitBounds positions={positions} />

        {geofences.map((g) => {
          const ring = parsePolygonJson(g.polygon_json);
          const color = legColor(g.leg);
          if (ring?.length >= 3) {
            return (
              <Polygon
                key={g.id}
                positions={ring.map((p) => [p.lat, p.lng])}
                pathOptions={{ color, weight: 2, fillOpacity: 0.12 }}
              />
            );
          }
          if (g.center_lat != null && g.center_lng != null && g.radius_m) {
            return (
              <Circle
                key={g.id}
                center={[g.center_lat, g.center_lng]}
                radius={Number(g.radius_m) || 500}
                pathOptions={{ color, fillOpacity: 0.15 }}
              />
            );
          }
          return null;
        })}

        {preview?.route_polyline?.length > 1 && (
          <Polyline
            positions={preview.route_polyline.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#0ea5e9', weight: 5, opacity: 0.85 }}
          />
        )}
        {preview?.corridor_polygon?.length >= 3 && (
          <Polygon
            positions={preview.corridor_polygon.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#7c3aed', weight: 2, dashArray: '6 4', fillOpacity: 0.18 }}
          />
        )}
        {preview?.origin && (
          <Circle center={[preview.origin.lat, preview.origin.lng]} radius={preview.endpoint_radius_m || 500} pathOptions={{ color: '#2563eb', fillOpacity: 0.2 }} />
        )}
        {preview?.destination && (
          <Circle center={[preview.destination.lat, preview.destination.lng]} radius={preview.endpoint_radius_m || 500} pathOptions={{ color: '#059669', fillOpacity: 0.2 }} />
        )}

        {showEditPolygon && (
          <>
            <Polygon
              positions={editRing.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: legColor(editLeg), weight: 3, fillOpacity: 0.2 }}
            />
            {editRing.map((p, i) => (
              <DraggableVertex key={`v-${i}`} position={[p.lat, p.lng]} index={i} onDrag={onVertexDrag} />
            ))}
          </>
        )}

        {editCenter && editRadius && (
          <>
            <Circle
              center={[editCenter.lat, editCenter.lng]}
              radius={Number(editRadius) || 500}
              pathOptions={{ color: legColor(editLeg), weight: 3, fillOpacity: 0.2 }}
            />
            <Marker
              position={[editCenter.lat, editCenter.lng]}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const { lat, lng } = e.target.getLatLng();
                  onCenterDrag?.(lat, lng);
                },
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
