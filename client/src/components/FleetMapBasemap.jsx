import { TileLayer } from 'react-leaflet';

const MAP_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

/** Free CARTO Voyager basemap for fleet and geofence maps. */
export default function FleetMapBasemap() {
  return <TileLayer attribution={MAP_TILES.attribution} url={MAP_TILES.url} />;
}
