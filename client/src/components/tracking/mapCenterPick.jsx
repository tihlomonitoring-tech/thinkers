import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/** Registers a function that returns the current map center (for precision crosshair placement). */
export function MapCenterRegistry({ registerRef }) {
  const map = useMap();

  useEffect(() => {
    if (!registerRef) return undefined;
    registerRef.current = () => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    };
    return () => {
      registerRef.current = null;
    };
  }, [map, registerRef]);

  return null;
}

/** Re-run Leaflet layout when container size changes (e.g. fullscreen). */
export function MapInvalidateSize({ trigger }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 80);
    return () => clearTimeout(t);
  }, [map, trigger]);
  return null;
}
