import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/** Disables map pan only — scroll/pinch zoom always stay on the map (stops page scroll). */
export function MapPanLock({ locked, disableDoubleClickZoom = false }) {
  const map = useMap();
  useEffect(() => {
    if (locked) {
      map.dragging.disable();
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    }
    if (disableDoubleClickZoom) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    map.scrollWheelZoom.enable();
    map.touchZoom.enable();
    map.boxZoom.enable();

    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = '';
    };
  }, [map, locked, disableDoubleClickZoom]);
  return null;
}

/** Keep wheel events on the map so the page does not scroll when zooming. */
export function MapWheelGuard() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const stop = (e) => e.stopPropagation();
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    return () => {
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchmove', stop);
    };
  }, [map]);
  return null;
}

/** Fit map only when revision changes — never on vertex drag or zoom. */
export function FitBoundsOnce({ revision, positions, maxZoom = 14 }) {
  const map = useMap();
  const lastRevision = useRef(0);

  useEffect(() => {
    if (!revision || revision === lastRevision.current || !positions?.length) return;
    lastRevision.current = revision;
    if (positions.length === 1) {
      map.flyTo(positions[0], Math.min(maxZoom, 15), { duration: 0.6 });
      return;
    }
    map.flyToBounds(
      L.latLngBounds(positions.map(([lat, lng]) => [lat, lng])),
      { padding: [48, 48], maxZoom, duration: 0.6 }
    );
  }, [map, revision, positions, maxZoom]);
  return null;
}

export function FlyToPoint({ point, revision }) {
  const map = useMap();
  const lastRevision = useRef(0);
  useEffect(() => {
    if (!revision || revision === lastRevision.current || !point) return;
    lastRevision.current = revision;
    map.flyTo([point.lat, point.lng], point.zoom || 15, { duration: 0.7 });
  }, [map, point, revision]);
  return null;
}
