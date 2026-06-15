import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { escapeHtml, landGeofencePlaces } from '../../lib/geofenceLabels.js';
import { geofenceDisplayColor } from '../../lib/geofenceStyle.js';

function labelIcon(name, color) {
  return L.divIcon({
    className: 'geofence-place-label',
    html: `<div style="pointer-events:none;transform:translate(-50%,-50%);max-width:200px"><div style="background:rgba(15,23,42,.9);color:#fff;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid ${color || '#f59e0b'}">${escapeHtml(name)}</div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** Permanent name labels for saved land / site geofences. */
export default function GeofencePlaceLabels({ geofences = [] }) {
  const places = landGeofencePlaces(geofences);

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
