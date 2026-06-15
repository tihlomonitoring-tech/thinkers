import { useEffect, useRef } from 'react';
import { Marker, Polygon, Polyline } from 'react-leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { polygonCentroid, scalePolygonRing } from '../../lib/routeCorridorGeofence.js';
import { pointAtDistance } from './geofenceCircleDraw.jsx';

const MIN_VERTEX_DIST_M = 8;
const MIN_FREEHAND_POINTS = 8;

function distM(a, b) {
  return L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
}

function latLngFromEvent(map, e) {
  if (e.latlng) return e.latlng;
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  if (!touch) return null;
  return map.containerPointToLatLng(map.mouseEventToContainerPoint(touch));
}

/** Douglas–Peucker simplification for freehand paths. */
export function simplifyRing(points, toleranceM = 12) {
  if (points.length <= 2) return points;

  const sqTol = toleranceM * toleranceM;

  const sqSegDist = (p, a, b) => {
    let x = a.lat;
    let y = a.lng;
    let dx = b.lat - x;
    let dy = b.lng - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.lat - x) * dx + (p.lng - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.lat; y = b.lng; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.lat - x;
    dy = p.lng - y;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
    const mx = dx * mPerDegLat;
    const my = dy * mPerDegLng;
    return mx * mx + my * my;
  };

  const rdp = (pts, start, end, out) => {
    let maxSq = 0;
    let idx = 0;
    for (let i = start + 1; i < end; i += 1) {
      const sq = sqSegDist(pts[i], pts[start], pts[end]);
      if (sq > maxSq) { maxSq = sq; idx = i; }
    }
    if (maxSq > sqTol) {
      rdp(pts, start, idx, out);
      out.push(pts[idx]);
      rdp(pts, idx, end, out);
    }
  };

  const out = [points[0]];
  rdp(points, 0, points.length - 1, out);
  out.push(points[points.length - 1]);
  return out;
}

const vertexIcon = (color = '#7c3aed') =>
  L.divIcon({
    className: 'geofence-poly-vertex',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:grab"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

/** Click map to place precise vertices; double-click or Enter finishes. */
export function PolygonClickDrawHandler({ active, points, onAddPoint, onComplete }) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (!active) return;
      L.DomEvent.stopPropagation(e.originalEvent);
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (points.length >= 3) {
        const first = points[0];
        if (distM(first, pt) < 25) {
          onComplete?.(points);
          return;
        }
      }
      if (points.length) {
        const last = points[points.length - 1];
        if (distM(last, pt) < MIN_VERTEX_DIST_M) return;
      }
      onAddPoint?.(pt);
    },
    dblclick(e) {
      if (!active || points.length < 3) return;
      L.DomEvent.stopPropagation(e.originalEvent);
      L.DomEvent.preventDefault(e.originalEvent);
      onComplete?.(points);
    },
  });

  useEffect(() => {
    if (!active) return undefined;
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';
    const onKey = (ev) => {
      if (ev.key === 'Enter' && points.length >= 3) onComplete?.(points);
      if (ev.key === 'Escape') onComplete?.(null);
      if (ev.key === 'Backspace' && points.length) onAddPoint?.(null, { undo: true });
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'z' && !ev.shiftKey && points.length) {
        ev.preventDefault();
        onAddPoint?.(null, { undo: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [map, active, points, onAddPoint, onComplete]);

  return null;
}

/** Drag mouse to sketch a shape; simplified on release. */
export function FreehandDrawHandler({ active, onPreview, onComplete }) {
  const map = useMap();
  const drawing = useRef(false);
  const pathRef = useRef([]);

  const begin = (latlng, ev) => {
    if (!active || !latlng) return;
    L.DomEvent.stopPropagation(ev);
    L.DomEvent.preventDefault(ev);
    drawing.current = true;
    pathRef.current = [{ lat: latlng.lat, lng: latlng.lng }];
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';
    onPreview?.(pathRef.current);
  };

  const move = (latlng) => {
    if (!drawing.current || !latlng) return;
    const pts = pathRef.current;
    const last = pts[pts.length - 1];
    if (last && distM(last, latlng) < MIN_VERTEX_DIST_M) return;
    pts.push({ lat: latlng.lat, lng: latlng.lng });
    onPreview?.([...pts]);
  };

  const finish = (ev) => {
    if (!drawing.current) return;
    if (ev) { L.DomEvent.stopPropagation(ev); L.DomEvent.preventDefault(ev); }
    drawing.current = false;
    map.dragging.enable();
    map.getContainer().style.cursor = '';
    const raw = pathRef.current;
    pathRef.current = [];
    onPreview?.(null);
    if (raw.length < MIN_FREEHAND_POINTS) {
      onComplete?.(null);
      return;
    }
    const simplified = simplifyRing(raw, 15);
    if (simplified.length < 3) { onComplete?.(null); return; }
    onComplete?.(simplified);
  };

  useMapEvents({
    mousedown(e) { begin(e.latlng, e.originalEvent); },
    mousemove(e) { move(e.latlng); },
    mouseup(e) { finish(e.originalEvent); },
  });

  useEffect(() => {
    if (!active) return undefined;
    const container = map.getContainer();
    const onTouchStart = (e) => begin(latLngFromEvent(map, e), e);
    const onTouchMove = (e) => { if (drawing.current) { e.preventDefault(); move(latLngFromEvent(map, e)); } };
    const onTouchEnd = (e) => finish(e);
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      map.dragging.enable();
    };
  }, [map, active, onPreview, onComplete]);

  return null;
}

export function PolygonDrawPreview({ points, color = '#7c3aed', closed = false }) {
  if (!points?.length) return null;
  const positions = points.map((p) => [p.lat, p.lng]);
  return (
    <>
      {closed && points.length >= 3 ? (
        <Polygon positions={positions} pathOptions={{ color, weight: 2, dashArray: '5 5', fillOpacity: 0.15 }} />
      ) : (
        <Polyline positions={positions} pathOptions={{ color, weight: 2, dashArray: '5 5' }} />
      )}
      {points.map((p, i) => (
        <Marker key={`pv-${i}-${p.lat}`} position={[p.lat, p.lng]} icon={vertexIcon(color)} />
      ))}
    </>
  );
}

const resizeHandleIcon = (label, bg = '#0ea5e9') =>
  L.divIcon({
    className: 'geofence-resize-handle',
    html: `<div style="width:26px;height:26px;border-radius:6px;background:${bg};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:10px;color:white;font-weight:700;cursor:grab">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function scaleRingFromCentroid(ring, centroid, factor) {
  return ring.map((p) => ({
    lat: centroid.lat + (p.lat - centroid.lat) * factor,
    lng: centroid.lng + (p.lng - centroid.lng) * factor,
  }));
}

/** Draggable vertices + edge resize handles for editing polygons. */
export function PolygonDraftEditor({ ring, color = '#7c3aed', onChange, onVertexDrag, onEditSnapshot }) {
  const scaleBase = useRef(null);

  if (!ring?.length) return null;

  const centroid = polygonCentroid(ring) || ring.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat / ring.length, lng: acc.lng + p.lng / ring.length }),
    { lat: 0, lng: 0 }
  );
  const maxDist = Math.max(...ring.map((p) => distM(centroid, p)), 1);

  const edgeHandles = [
    { label: 'N', bearing: 0 },
    { label: 'E', bearing: 90 },
    { label: 'S', bearing: 180 },
    { label: 'W', bearing: 270 },
  ].map(({ label, bearing }) => ({
    label,
    ...pointAtDistance(centroid.lat, centroid.lng, maxDist * 0.85, bearing),
  }));

  const applyScaleFactor = (factor, baseRing, baseCentroid, baseMaxDist) => {
    const f = Math.min(5, Math.max(0.2, factor));
    const scaled = scaleRingFromCentroid(baseRing, baseCentroid, f);
    onChange?.(scaled);
  };

  return (
    <>
      <Polygon
        positions={ring.map((p) => [p.lat, p.lng])}
        pathOptions={{ color, weight: 3, fillOpacity: 0.2 }}
      />
      {ring.map((p, i) => (
        <Marker
          key={`ev-${i}-${p.lat.toFixed(5)}`}
          position={[p.lat, p.lng]}
          icon={vertexIcon(color)}
          draggable
          autoPan={false}
          eventHandlers={{
            dragstart: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent);
              onEditSnapshot?.();
            },
            drag(e) {
              const { lat, lng } = e.target.getLatLng();
              const next = ring.map((pt, idx) => (idx === i ? { lat, lng } : pt));
              onVertexDrag?.(i, lat, lng);
              onChange?.(next);
            },
          }}
        />
      ))}
      {edgeHandles.map((h) => (
        <Marker
          key={`resize-${h.label}`}
          position={[h.lat, h.lng]}
          icon={resizeHandleIcon(h.label)}
          draggable
          autoPan={false}
          zIndexOffset={1000}
          eventHandlers={{
            dragstart: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent);
              onEditSnapshot?.();
              scaleBase.current = {
                ring: ring.map((p) => ({ ...p })),
                centroid: { ...centroid },
                maxDist,
              };
            },
            drag(e) {
              const base = scaleBase.current;
              if (!base) return;
              const { lat, lng } = e.target.getLatLng();
              const newDist = distM(base.centroid, { lat, lng });
              const factor = base.maxDist > 0 ? newDist / base.maxDist : 1;
              applyScaleFactor(factor, base.ring, base.centroid, base.maxDist);
            },
            dragend: () => {
              scaleBase.current = null;
            },
          }}
        />
      ))}
    </>
  );
}

export function scalePolygonDraft(ring, factor) {
  if (!ring?.length) return ring;
  return scalePolygonRing(ring, factor);
}
