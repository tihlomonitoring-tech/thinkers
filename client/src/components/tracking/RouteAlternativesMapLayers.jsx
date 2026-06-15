import { Marker, Polygon, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { routeOptionStyle, polylineMidpoint } from '../../lib/routeOptionColors.js';

function routeLabelIcon(letter, color, isPrimary) {
  return L.divIcon({
    className: 'route-option-label',
    html: `<div style="transform:translate(-50%,-50%);background:${isPrimary ? '#7c3aed' : color};color:#fff;font-size:11px;font-weight:800;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4)">${letter}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Renders every OSRM alternative route, included corridors, and letter labels. */
export default function RouteAlternativesMapLayers({ preview }) {
  if (!preview?.alternatives?.length) return null;

  const primaryIndex = preview.selected_route_index ?? 0;
  const altCorridors = preview.alt_corridors || {};

  return (
    <>
      {preview.alternatives.map((alt, i) => {
        const polyline = alt.polyline || [];
        if (polyline.length < 2) return null;

        const style = routeOptionStyle(i);
        const isPrimary = i === primaryIndex;
        const included = !!altCorridors[i]?.enabled;
        const corridor = isPrimary
          ? preview.corridor_polygon
          : altCorridors[i]?.corridor_polygon;
        const showCorridor = included && corridor?.length >= 3;
        const mid = polylineMidpoint(polyline);

        return (
          <span key={`route-opt-${i}`}>
            {showCorridor && (
              <Polygon
                positions={corridor.map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: isPrimary ? style.corridor : style.line,
                  weight: isPrimary ? 3 : 2,
                  dashArray: isPrimary ? '6 4' : '5 5',
                  fillOpacity: isPrimary ? 0.22 : 0.14,
                  fillColor: isPrimary ? style.corridor : style.line,
                }}
              />
            )}
            <Polyline
              positions={polyline.map((p) => [p.lat, p.lng])}
              pathOptions={{
                color: style.line,
                weight: isPrimary ? 7 : included ? 5 : 4,
                opacity: isPrimary ? 0.98 : included ? 0.88 : 0.55,
                dashArray: isPrimary ? undefined : included ? '6 4' : '10 8',
              }}
            />
            {mid && (
              <Marker
                position={[mid.lat, mid.lng]}
                icon={routeLabelIcon(style.letter, style.line, isPrimary)}
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
