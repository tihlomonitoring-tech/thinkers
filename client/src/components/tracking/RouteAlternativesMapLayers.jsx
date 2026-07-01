import { Marker, Polygon, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { routeOptionStyle, polylineMidpoint } from '../../lib/routeOptionColors.js';
import { bufferPolylineToPolygon } from '../../lib/routeCorridorGeofence.js';

function routeLabelIcon(letter, color, isPrimary) {
  return L.divIcon({
    className: 'route-option-label',
    html: `<div style="transform:translate(-50%,-50%);background:${isPrimary ? '#7c3aed' : color};color:#fff;font-size:12px;font-weight:800;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 10px rgba(0,0,0,.45)">${letter}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Renders allowed route corridors and centerlines — disallowed routes are hidden from the geofence map. */
export default function RouteAlternativesMapLayers({ preview, corridorM = 400 }) {
  if (!preview?.alternatives?.length) return null;

  const primaryIndex = preview.selected_route_index ?? 0;
  const altCorridors = preview.alt_corridors || {};

  return (
    <>
      {preview.alternatives.map((alt, i) => {
        const polyline = alt.polyline || [];
        if (polyline.length < 2) return null;

        const style = routeOptionStyle(i, alt);
        const isPrimary = i === primaryIndex;
        const included = !!altCorridors[i]?.enabled;
        if (!isPrimary && !included) return null;

        const storedCorridor = isPrimary
          ? preview.corridor_polygon
          : altCorridors[i]?.corridor_polygon;
        const corridor = storedCorridor?.length >= 3
          ? storedCorridor
          : bufferPolylineToPolygon(polyline, corridorM);
        const mid = polylineMidpoint(polyline);
        const labelText = alt.is_manual ? '✦' : style.letter;

        return (
          <span key={alt.uid || `route-opt-${i}`}>
            {corridor?.length >= 3 && (
              <Polygon
                positions={corridor.map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: isPrimary ? style.corridor : style.line,
                  weight: isPrimary ? 3 : 2,
                  dashArray: alt.is_manual ? '2 6' : isPrimary ? undefined : '4 6',
                  fillOpacity: isPrimary ? 0.28 : 0.18,
                  fillColor: isPrimary ? style.corridor : style.line,
                  opacity: 0.95,
                }}
              />
            )}
            <Polyline
              positions={polyline.map((p) => [p.lat, p.lng])}
              pathOptions={{
                color: style.line,
                weight: isPrimary ? 8 : alt.is_manual ? 7 : 6,
                opacity: isPrimary ? 1 : 0.92,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray: alt.is_manual && !isPrimary ? '12 6' : undefined,
              }}
            />
            {mid && (
              <Marker
                position={[mid.lat, mid.lng]}
                icon={routeLabelIcon(labelText, style.line, isPrimary)}
                interactive={false}
                zIndexOffset={500 + i}
              />
            )}
          </span>
        );
      })}
    </>
  );
}
