import { useEffect, useRef } from 'react';
import { Circle, Marker, Polyline } from 'react-leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const MIN_VERTEX_DIST_M = 12;
const SEGMENT_INSERT_MAX_M = 120;

function distM(a, b) {
  return L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
}

function distancePointToSegmentM(a, b, pt) {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = pt.lng;
  const py = pt.lat;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return distM(a, pt);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const proj = { lat: ay + t * dy, lng: ax + t * dx };
  return distM(proj, pt);
}

function nearestSegmentIndex(waypoints, pt) {
  let bestSeg = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = distancePointToSegmentM(waypoints[i], waypoints[i + 1], pt);
    if (d < bestDist) {
      bestDist = d;
      bestSeg = i;
    }
  }
  return { segIndex: bestSeg, distM: bestDist };
}

const waypointIcon = (num, locked = false) =>
  L.divIcon({
    className: 'manual-route-waypoint',
    html: `<div style="transform:translate(-50%,-50%);background:${locked ? '#2563eb' : '#d97706'};color:#fff;font-size:11px;font-weight:800;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:${locked ? 'default' : 'grab'}">${num}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

/** Click map to place route waypoints; click near a segment to insert between points; drag to adjust. */
export function RouteWaypointDrawHandler({
  active,
  waypoints = [],
  onAddWaypoint,
  onInsertWaypoint,
  onMoveWaypoint,
  onUndo,
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!active) return;
      L.DomEvent.stopPropagation(e.originalEvent);
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (waypoints.length >= 2) {
        const { segIndex, distM: segDist } = nearestSegmentIndex(waypoints, pt);
        if (segDist <= SEGMENT_INSERT_MAX_M) {
          onInsertWaypoint?.(segIndex + 1, pt);
          return;
        }
      }
      if (waypoints.length) {
        const last = waypoints[waypoints.length - 1];
        if (last && distM(last, pt) < MIN_VERTEX_DIST_M) return;
      }
      onAddWaypoint?.(pt);
    },
  });

  useEffect(() => {
    if (!active) return undefined;
    map.getContainer().style.cursor = 'crosshair';
    const onKey = (ev) => {
      if (ev.key === 'Backspace' || ((ev.metaKey || ev.ctrlKey) && ev.key === 'z' && !ev.shiftKey)) {
        ev.preventDefault();
        onUndo?.();
      }
      if (ev.key === 'Escape') onUndo?.('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      map.getContainer().style.cursor = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [map, active, onUndo]);

  return null;
}

/** Sketch line, draggable waypoints, segment highlights, and live road-snapped preview. */
export function ManualRoutePlotLayers({
  waypoints = [],
  snapPreview = null,
  snapping = false,
  onMoveWaypoint,
  lockEndpoints = false,
}) {
  if (!waypoints?.length && !snapPreview?.polyline?.length) return null;

  return (
    <>
      {waypoints.length >= 2 && (
        <Polyline
          positions={waypoints.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: '#f59e0b',
            weight: 3,
            opacity: 0.85,
            dashArray: '10 8',
            lineCap: 'round',
          }}
        />
      )}
      {waypoints.length >= 2 && snapPreview?.legs?.map((seg, si) => (
        <Polyline
          key={`leg-preview-${si}`}
          positions={seg.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: snapping ? '#94a3b8' : '#ea580c',
            weight: 6,
            opacity: snapping ? 0.45 : 0.9,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ))}
      {waypoints.length >= 2 && !snapPreview?.legs?.length && snapPreview?.polyline?.length >= 2 && (
        <Polyline
          positions={snapPreview.polyline.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: snapping ? '#94a3b8' : '#ea580c',
            weight: 7,
            opacity: snapping ? 0.5 : 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      )}
      {waypoints.map((pt, i) => {
        const locked = lockEndpoints && (i === 0 || i === waypoints.length - 1);
        return (
          <Marker
            key={`mwp-${i}-${pt.lat.toFixed(5)}`}
            position={[pt.lat, pt.lng]}
            icon={waypointIcon(i + 1, locked)}
            draggable={!locked}
            autoPan={false}
            zIndexOffset={800 + i}
            eventHandlers={{
              drag(e) {
                if (locked) return;
                const { lat, lng } = e.target.getLatLng();
                onMoveWaypoint?.(i, lat, lng);
              },
            }}
          />
        );
      })}
      {waypoints[0] && (
        <Circle
          center={[waypoints[0].lat, waypoints[0].lng]}
          radius={40}
          pathOptions={{ color: '#2563eb', weight: 2, fillOpacity: 0.15, dashArray: '4 4' }}
        />
      )}
      {waypoints.length > 1 && waypoints[waypoints.length - 1] && (
        <Circle
          center={[waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng]}
          radius={40}
          pathOptions={{ color: '#059669', weight: 2, fillOpacity: 0.15, dashArray: '4 4' }}
        />
      )}
    </>
  );
}

export function useDebouncedManualRouteSnap(waypoints, onSnap, delayMs = 450) {
  const timerRef = useRef(null);
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!waypoints || waypoints.length < 2) {
      onSnapRef.current?.(null);
      return undefined;
    }
    timerRef.current = setTimeout(() => {
      onSnapRef.current?.(waypoints);
    }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [waypoints, delayMs]);
}
