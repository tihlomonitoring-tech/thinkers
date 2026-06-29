import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { escapeHtml, landGeofencePlaces } from '../../lib/geofenceLabels.js';
import { geofenceDisplayColor } from '../../lib/geofenceStyle.js';

function labelIcon(name, color) {
  // Outer wrapper uses width:max-content so the label sizes to its text even
  // though Leaflet renders the marker element at 0×0; inner box wraps long
  // names onto multiple centred lines instead of clipping to a single letter.
  return L.divIcon({
    className: 'geofence-place-label',
    html: `<div style="pointer-events:none;transform:translate(-50%,-50%);width:max-content;max-width:180px;text-align:center"><div style="display:inline-block;background:rgba(15,23,42,.92);color:#fff;font-size:11px;line-height:1.25;font-weight:600;padding:3px 9px;border-radius:7px;white-space:normal;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.4);border:1.5px solid ${color || '#f59e0b'}">${escapeHtml(name)}</div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/**
 * Permanent name labels for saved land / site geofences.
 * mode: 'all' (every site), 'loading' (origin/loading points only), 'off' (none).
 */
export default function GeofencePlaceLabels({ geofences = [], mode = 'all' }) {
  if (mode === 'off') return null;
  const places = landGeofencePlaces(geofences).filter(
    (p) => (mode === 'loading' ? p.leg === 'origin' : true)
  );

  return places.map((place) => {
    const g = geofences.find((x) => x.id === place.id);
    const color = geofenceDisplayColor(g || {});
    return (
      <Marker
        key={`gf-label-${place.id}`}
        position={[place.lat, place.lng]}
        icon={labelIcon(place.name, color)}
        interactive={false}
        zIndexOffset={400}
      />
    );
  });
}
