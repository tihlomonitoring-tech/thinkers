import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Circle, Marker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
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

const previewVertexIcon = L.divIcon({
  className: 'geofence-preview-vertex-handle',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#7c3aed;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
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

function DraggableVertex({ position, index, onDrag, icon = vertexIcon }) {
  return (
    <Marker
      position={position}
      icon={icon}
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

function MapClickHandler({ enabled, onMapClick }) {
  useMapEvents({
    click(e) {
      if (enabled && onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function legColor(leg, fenceType) {
  const ft = String(fenceType || '').toLowerCase();
  if (leg === 'alert' || ft === 'hazard') return '#e11d48';
  if (leg === 'origin') return '#2563eb';
  if (leg === 'destination') return '#059669';
  if (leg === 'corridor') return '#7c3aed';
  return '#64748b';
}

const ALT_COLORS = ['#94a3b8', '#cbd5e1', '#e2e8f0'];

export default function GeofenceMapEditor({
  geofences = [],
  preview = null,
  editRing = null,
  editCenter = null,
  editRadius = null,
  editLeg = null,
  editFenceType = null,
  onVertexDrag,
  onCenterDrag,
  onPreviewVertexDrag,
  alertPreview = null,
  mapClickMode = false,
  onMapClick,
  fitKey = 0,
  className = '',
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selectedAltIndex = preview?.selected_route_index ?? 0;
  const previewCorridor = preview?.corridor_polygon;

  const positions = useMemo(() => {
    const pts = [];
    if (preview?.alternatives?.length) {
      preview.alternatives.forEach((alt) => {
        alt.polyline?.forEach((p) => pts.push([p.lat, p.lng]));
      });
    } else if (preview?.route_polyline?.length) {
      preview.route_polyline.forEach((p) => pts.push([p.lat, p.lng]));
    }
    if (previewCorridor?.length) {
      previewCorridor.forEach((p) => pts.push([p.lat, p.lng]));
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
    if (alertPreview?.lat != null && alertPreview?.lng != null) pts.push([alertPreview.lat, alertPreview.lng]);
    return pts;
  }, [geofences, preview, previewCorridor, editRing, editCenter, alertPreview, fitKey]);

  const center = positions[0] || [-26.15, 28.12];

  if (!mounted) {
    return (
      <div className={`h-[32rem] rounded-xl bg-surface-100 flex items-center justify-center text-sm text-surface-500 ${className}`}>
        Loading map…
      </div>
    );
  }

  const showEditPolygon = editRing && editRing.length >= 3;
  const showPreviewCorridor = !showEditPolygon && previewCorridor?.length >= 3;

  return (
    <div className={`rounded-xl border border-surface-200 overflow-hidden h-[32rem] z-0 relative ${className}`}>
      {mapClickMode && (
        <div className="absolute top-2 right-2 z-[1000] rounded-lg bg-rose-600 text-white px-2.5 py-1.5 text-[10px] font-medium shadow-sm">
          Click the map to set coordinates
        </div>
      )}
      {showPreviewCorridor && onPreviewVertexDrag && !mapClickMode && (
        <div className="absolute top-2 left-2 z-[1000] rounded-lg bg-white/95 dark:bg-surface-900/95 border border-surface-200 dark:border-surface-700 px-2.5 py-1.5 text-[10px] text-surface-600 dark:text-surface-300 shadow-sm max-w-[220px]">
          Drag purple handles to expand or reshape the corridor geofence
        </div>
      )}
      <MapContainer center={center} zoom={9} className="h-full w-full" scrollWheelZoom>
        <FleetMapBasemap />
        <MapClickHandler enabled={mapClickMode} onMapClick={onMapClick} />
        <FitBounds positions={positions} />

        {geofences.map((g) => {
          const ring = parsePolygonJson(g.polygon_json);
          const color = legColor(g.leg, g.fence_type);
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

        {preview?.alternatives?.map((alt, i) => {
          if (i === selectedAltIndex || !alt.polyline?.length) return null;
          return (
            <Polyline
              key={`alt-${i}`}
              positions={alt.polyline.map((p) => [p.lat, p.lng])}
              pathOptions={{
                color: ALT_COLORS[i] || '#cbd5e1',
                weight: 4,
                opacity: 0.55,
                dashArray: '8 6',
              }}
            />
          );
        })}

        {preview?.route_polyline?.length > 1 && (
          <Polyline
            positions={preview.route_polyline.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: '#0ea5e9', weight: 6, opacity: 0.95 }}
          />
        )}

        {showPreviewCorridor && (
          <>
            <Polygon
              positions={previewCorridor.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: '#7c3aed', weight: 2, dashArray: '6 4', fillOpacity: 0.2 }}
            />
            {onPreviewVertexDrag && !mapClickMode &&
              previewCorridor.map((p, i) => (
                <DraggableVertex
                  key={`pv-${i}`}
                  position={[p.lat, p.lng]}
                  index={i}
                  icon={previewVertexIcon}
                  onDrag={onPreviewVertexDrag}
                />
              ))}
          </>
        )}

        {preview?.origin && (
          <Circle
            center={[preview.origin.lat, preview.origin.lng]}
            radius={preview.endpoint_radius_m || 500}
            pathOptions={{ color: '#2563eb', fillOpacity: 0.2 }}
          />
        )}
        {preview?.destination && (
          <Circle
            center={[preview.destination.lat, preview.destination.lng]}
            radius={preview.endpoint_radius_m || 500}
            pathOptions={{ color: '#059669', fillOpacity: 0.2 }}
          />
        )}

        {alertPreview?.lat != null && alertPreview?.lng != null && (
          <>
            <Circle
              center={[alertPreview.lat, alertPreview.lng]}
              radius={Number(alertPreview.radius_m) || 150}
              pathOptions={{ color: '#e11d48', weight: 2, fillOpacity: 0.25, dashArray: '4 4' }}
            />
            <Marker position={[alertPreview.lat, alertPreview.lng]} />
          </>
        )}

        {showEditPolygon && (
          <>
            <Polygon
              positions={editRing.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: legColor(editLeg, editFenceType), weight: 3, fillOpacity: 0.2 }}
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
              pathOptions={{ color: legColor(editLeg, editFenceType), weight: 3, fillOpacity: 0.2 }}
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
