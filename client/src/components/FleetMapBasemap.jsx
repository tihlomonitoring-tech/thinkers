import { TileLayer } from 'react-leaflet';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

const BASEMAPS = {
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution:
      'Imagery &copy; Esri &mdash; Maxar, Earthstar Geographics',
  },
  labels: {
    places: {
      url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
      attribution: 'Labels &copy; Esri',
    },
    roads: {
      url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
      attribution: 'Roads &copy; Esri',
    },
  },
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

/** Fleet map basemap — satellite with optional place/road labels (FleetCam-style). */
export default function FleetMapBasemap({ variant = 'satellite', showLabels = true }) {
  if (variant === 'satellite') {
    return (
      <>
        <TileLayer attribution={BASEMAPS.satellite.attribution} url={BASEMAPS.satellite.url} />
        {showLabels && (
          <>
            <TileLayer
              url={BASEMAPS.labels.roads.url}
              attribution={BASEMAPS.labels.roads.attribution}
              opacity={0.85}
              maxNativeZoom={19}
            />
            <TileLayer
              url={BASEMAPS.labels.places.url}
              attribution={BASEMAPS.labels.places.attribution}
              opacity={0.92}
              maxNativeZoom={19}
            />
          </>
        )}
      </>
    );
  }
  const tiles = BASEMAPS[variant] || BASEMAPS.voyager;
  return <TileLayer attribution={tiles.attribution} url={tiles.url} />;
}

export { BASEMAPS };
