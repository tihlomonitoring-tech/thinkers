import { useEffect, useRef } from 'react';
import { Circle, Marker } from 'react-leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

export const MIN_RADIUS_M = 30;
export const MAX_RADIUS_M = 50000;

export function clampRadius(m) {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(m)));
}

/** Bearing 0 = north, 90 = east. Returns { lat, lng }. */
export function pointAtDistance(lat, lng, distanceM, bearingDeg = 90) {
  const R = 6378137;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const d = distanceM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 =
    lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

function latLngFromEvent(map, e) {
  if (e.latlng) return e.latlng;
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  if (!touch) return null;
  return map.containerPointToLatLng(map.mouseEventToContainerPoint(touch));
}

/** Press / touch center, drag outward to set radius, release to finish. */
export function CircleDrawHandler({ active, onPreview, onComplete }) {
  const map = useMap();
  const drawing = useRef(false);
  const centerRef = useRef(null);

  const beginDraw = (latlng, originalEvent) => {
    if (!active || drawing.current || !latlng) return;
    L.DomEvent.stopPropagation(originalEvent);
    L.DomEvent.preventDefault(originalEvent);
    drawing.current = true;
    centerRef.current = latlng;
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';
    onPreview?.({ lat: latlng.lat, lng: latlng.lng, radius_m: MIN_RADIUS_M });
  };

  const moveDraw = (latlng) => {
    if (!active || !drawing.current || !centerRef.current || !latlng) return;
    const radius_m = clampRadius(centerRef.current.distanceTo(latlng));
    onPreview?.({
      lat: centerRef.current.lat,
      lng: centerRef.current.lng,
      radius_m,
    });
  };

  const finishDraw = (latlng, originalEvent) => {
    if (!active || !drawing.current || !centerRef.current) return;
    if (originalEvent) {
      L.DomEvent.stopPropagation(originalEvent);
      L.DomEvent.preventDefault(originalEvent);
    }
    const center = centerRef.current;
    const radius_m = clampRadius(center.distanceTo(latlng || center));
    drawing.current = false;
    centerRef.current = null;
    map.dragging.enable();
    map.getContainer().style.cursor = '';
    onPreview?.(null);
    onComplete?.({ lat: center.lat, lng: center.lng, radius_m });
  };

  useMapEvents({
    mousedown(e) {
      beginDraw(e.latlng, e.originalEvent);
    },
    mousemove(e) {
      moveDraw(e.latlng);
    },
    mouseup(e) {
      finishDraw(e.latlng, e.originalEvent);
    },
  });

  useEffect(() => {
    if (!active) return undefined;

    const onDocMove = (ev) => {
      if (!drawing.current) return;
      const rect = map.getContainer().getBoundingClientRect();
      const pt = map.containerPointToLatLng(L.point(ev.clientX - rect.left, ev.clientY - rect.top));
      moveDraw(pt);
    };
    const onDocUp = (ev) => {
      if (!drawing.current) return;
      const rect = map.getContainer().getBoundingClientRect();
      const pt = map.containerPointToLatLng(L.point(ev.clientX - rect.left, ev.clientY - rect.top));
      finishDraw(pt, ev);
    };

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);

    return () => {
      document.removeEventListener('mousemove', onDocMove);
      document.removeEventListener('mouseup', onDocUp);
    };
  }, [map, active]);

  useEffect(() => {
    if (!active) return undefined;
    const container = map.getContainer();

    const onTouchStart = (e) => {
      const latlng = latLngFromEvent(map, e);
      beginDraw(latlng, e);
    };
    const onTouchMove = (e) => {
      if (!drawing.current) return;
      e.preventDefault();
      moveDraw(latLngFromEvent(map, e));
    };
    const onTouchEnd = (e) => {
      if (!drawing.current) return;
      finishDraw(latLngFromEvent(map, e), e);
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    };
  }, [map, active, onPreview, onComplete]);

  return null;
}

const radiusHandleIcon = L.divIcon({
  className: 'geofence-radius-handle',
  html: '<div style="width:26px;height:26px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:grab"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const centerHandleIcon = L.divIcon({
  className: 'geofence-center-handle',
  html: '<div style="width:24px;height:24px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:grab"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** Editable draft circle: drag center or edge handles (N/E/S/S) to resize. */
export function CircleDraftEditor({ circle, color = '#f59e0b', onChange, onEditSnapshot }) {
  if (!circle?.lat || !circle?.lng || !circle?.radius_m) return null;

  const bearings = [
    { label: 'E', deg: 90 },
    { label: 'N', deg: 0 },
    { label: 'W', deg: 270 },
    { label: 'S', deg: 180 },
  ];

  return (
    <>
      <Circle
        center={[circle.lat, circle.lng]}
        radius={circle.radius_m}
        pathOptions={{ color, weight: 2, dashArray: '6 4', fillOpacity: 0.18 }}
      />
      <Marker
        position={[circle.lat, circle.lng]}
        icon={centerHandleIcon}
        draggable
        autoPan={false}
        zIndexOffset={900}
        eventHandlers={{
          dragstart: (e) => {
            L.DomEvent.stopPropagation(e.originalEvent);
            onEditSnapshot?.();
          },
          drag(e) {
            const { lat, lng } = e.target.getLatLng();
            onChange?.({ ...circle, lat, lng });
          },
        }}
      />
      {bearings.map(({ label, deg }) => {
        const edge = pointAtDistance(circle.lat, circle.lng, circle.radius_m, deg);
        return (
          <Marker
            key={label}
            position={[edge.lat, edge.lng]}
            icon={L.divIcon({
              className: 'geofence-radius-handle',
              html: `<div style="width:26px;height:26px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;cursor:grab">${label}</div>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            })}
            draggable
            autoPan={false}
            zIndexOffset={1000}
            eventHandlers={{
              dragstart: (e) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                onEditSnapshot?.();
              },
              drag(e) {
                const c = L.latLng(circle.lat, circle.lng);
                const { lat, lng } = e.target.getLatLng();
                const radius_m = clampRadius(c.distanceTo(L.latLng(lat, lng)));
                onChange?.({ ...circle, radius_m });
              },
            }}
          />
        );
      })}
    </>
  );
}

/** Live preview while drawing (before release). */
export function CircleDrawPreview({ circle, color = '#f59e0b', label }) {
  if (!circle?.lat || !circle?.lng) return null;
  return (
    <>
      <Circle
        center={[circle.lat, circle.lng]}
        radius={circle.radius_m || MIN_RADIUS_M}
        pathOptions={{ color, weight: 2, dashArray: '4 6', fillOpacity: 0.12 }}
      />
      {label && (
        <Marker
          position={[circle.lat, circle.lng]}
          icon={L.divIcon({
            className: 'geofence-draw-label',
            html: `<div style="white-space:nowrap;background:rgba(15,23,42,.85);color:#fff;font-size:10px;padding:3px 6px;border-radius:4px;font-weight:600">${label}</div>`,
            iconAnchor: [0, 20],
          })}
        />
      )}
    </>
  );
}
