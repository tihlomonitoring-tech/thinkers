import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, Circle, Marker, Polygon, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import FleetMapBasemap from '../FleetMapBasemap.jsx';
import { parsePolygonJson, parseCorridorPolyline } from '../../lib/routeCorridorGeofence.js';
import { geofenceDisplayColor } from '../../lib/geofenceStyle.js';
import { MapPanLock, MapWheelGuard, FitBoundsOnce, FlyToPoint } from './geofenceMapControls.jsx';
import { MapCenterRegistry, MapInvalidateSize } from './mapCenterPick.jsx';
import MapPlaceSearch from './MapPlaceSearch.jsx';
import GeofencePlaceLabels from './GeofencePlaceLabels.jsx';
import GeofenceLabelControl, { useGeofenceLabelMode } from './GeofenceLabelControl.jsx';
import RouteAlternativesMapLayers from './RouteAlternativesMapLayers.jsx';
import { RouteWaypointDrawHandler, ManualRoutePlotLayers } from './manualRoutePlot.jsx';
import { landGeofencePlaces } from '../../lib/geofenceLabels.js';
import {
  CircleDrawHandler,
  CircleDrawPreview,
  CircleDraftEditor,
} from './geofenceCircleDraw.jsx';
import {
  PolygonClickDrawHandler,
  FreehandDrawHandler,
  PolygonDrawPreview,
  PolygonDraftEditor,
} from './geofencePolygonDraw.jsx';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

function MapClickHandler({ enabled, onMapClick }) {
  useMapEvents({
    click(e) {
      if (enabled && onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function InteractiveGeofence({ geofence, selected, selectionEnabled, onSelect }) {
  const ring = parsePolygonJson(geofence.polygon_json);
  const color = geofenceDisplayColor(geofence);
  const weight = selected ? 4 : 2;
  const fillOpacity = selected ? 0.25 : 0.12;
  const leg = String(geofence.leg || '').toLowerCase();
  const isCorridor = leg === 'corridor' || leg === 'corridor_alt';
  const polyline = isCorridor ? parseCorridorPolyline(geofence.polygon_json) : null;
  const lineWeight = leg === 'corridor_alt' ? 5 : 6;
  const lineOpacity = leg === 'corridor_alt' ? 0.85 : 0.95;
  const lineDash = leg === 'corridor_alt' ? '6 4' : undefined;

  const clickHandler = selectionEnabled
    ? {
        click: (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          onSelect?.(geofence);
        },
      }
    : {};

  return (
    <>
      {polyline?.length > 1 && (
        <Polyline
          positions={polyline.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color,
            weight: lineWeight,
            opacity: lineOpacity,
            dashArray: lineDash,
          }}
          eventHandlers={clickHandler}
        />
      )}
      {ring?.length >= 3 && (
        <Polygon
          positions={ring.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color,
            weight,
            fillOpacity,
            fillColor: color,
            dashArray: leg === 'corridor_alt' ? '5 5' : undefined,
          }}
          eventHandlers={clickHandler}
        />
      )}
      {!ring?.length && geofence.center_lat != null && geofence.center_lng != null && geofence.radius_m && (
        <Circle
          center={[geofence.center_lat, geofence.center_lng]}
          radius={Number(geofence.radius_m) || 500}
          pathOptions={{ color, weight, fillOpacity, fillColor: color }}
          eventHandlers={clickHandler}
        />
      )}
    </>
  );
}

function ToolBtn({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        active
          ? 'bg-brand-600 text-white border-brand-600'
          : 'bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-200 border-surface-200 dark:border-surface-600 hover:bg-surface-50'
      }`}
    >
      {children}
    </button>
  );
}

export default function GeofenceMapEditor({
  geofences = [],
  preview = null,
  editRing = null,
  editCenter = null,
  editRadius = null,
  editColor = null,
  editLeg = null,
  editFenceType = null,
  onVertexDrag,
  onCenterDrag,
  onEditRingChange,
  onEditRadiusChange,
  onEditSnapshot,
  onPreviewVertexDrag,
  alertPreview = null,
  mapClickMode = false,
  onMapClick,
  manualDrawMode = null,
  circleDrawPreview = null,
  onCircleDrawPreview,
  onCircleDrawComplete,
  manualCircleDraft = null,
  onManualCircleDraftChange,
  polygonDrawPoints = [],
  onPolygonAddPoint,
  onPolygonDrawComplete,
  freehandPreview = null,
  onFreehandPreview,
  onFreehandComplete,
  manualPolygonDraft = null,
  onManualPolygonDraftChange,
  draftColor = '#f59e0b',
  selectedGeofenceId = null,
  onGeofenceSelect,
  mapTool = 'pan',
  onMapToolChange,
  fitRevision = 0,
  fitPositions = null,
  flyRevision = 0,
  flyTarget = null,
  onPlaceSelect,
  routeMarkers = null,
  labelGeofences = null,
  routeCorridorM = 400,
  manualRoutePlotActive = false,
  manualRouteWaypoints = [],
  manualRouteSnapPreview = null,
  manualRouteSnapping = false,
  manualRouteLockEndpoints = false,
  onManualRouteAddWaypoint,
  onManualRouteInsertWaypoint,
  onManualRouteMoveWaypoint,
  onManualRouteUndo,
  onScaleDraft,
  onDraftSnapshot,
  className = '',
}) {
  const [mounted, setMounted] = useState(false);
  const [basemapVariant, setBasemapVariant] = useState('satellite');
  const [labelMode, setLabelMode] = useGeofenceLabelMode();
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);
  const mapCenterRef = useRef(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* fullscreen may be blocked */
    }
  }, []);

  const resolveEditColor = editColor || geofenceDisplayColor({ leg: editLeg, fence_type: editFenceType });

  const defaultCenter = useMemo(() => {
    const g = geofences[0];
    if (g?.center_lat != null) return [g.center_lat, g.center_lng];
    const ring = parsePolygonJson(g?.polygon_json);
    if (ring?.[0]) return [ring[0].lat, ring[0].lng];
    return [-26.15, 28.12];
  }, [geofences]);

  const drawingActive = !!manualDrawMode || manualRoutePlotActive;
  const editingActive = !!(editRing || editCenter);
  // Only circle drag-draw and freehand sketch lock pan. Pick, polygon clicks, and route plot allow pan+zoom.
  const panLocked = manualDrawMode === 'circle' || manualDrawMode === 'freehand';
  const precisionPickActive = mapClickMode || manualRoutePlotActive;
  const hasResizableDraft = !!(manualCircleDraft || manualPolygonDraft?.ring?.length || editingActive);

  const selectionEnabled = mapTool === 'pan' && !drawingActive && !mapClickMode && !editingActive;

  const placeAtMapCenter = useCallback(() => {
    const pt = mapCenterRef.current?.();
    if (!pt) return;
    if (manualRoutePlotActive) onManualRouteAddWaypoint?.(pt);
    else if (mapClickMode) onMapClick?.(pt.lat, pt.lng);
  }, [manualRoutePlotActive, mapClickMode, onManualRouteAddWaypoint, onMapClick]);

  const statusLine = panLocked
    ? manualDrawMode === 'freehand'
      ? 'Freehand draw — drag on the map to sketch your boundary'
      : 'Circle draw — click and drag to set radius'
    : precisionPickActive
      ? manualRoutePlotActive
        ? 'Plot route — pan & zoom freely, then click or use “Place at crosshair” for each waypoint'
        : 'Precision pick — pan & zoom to the spot, then click or “Place at crosshair”'
      : drawingActive
        ? 'Polygon draw — pan between clicks; double-click or Enter to finish'
        : editingActive
          ? 'Edit mode — drag corner dots to reshape, N/E/S/W handles to resize'
          : 'Pan mode — drag to move, scroll to zoom; click a geofence to edit';

  const showEditPolygon = editRing && editRing.length >= 3;
  const placeLabels = useMemo(
    () => landGeofencePlaces(labelGeofences ?? geofences),
    [labelGeofences, geofences]
  );

  if (!mounted) {
    return (
      <div className={`h-[44rem] rounded-xl bg-surface-100 flex items-center justify-center text-sm text-surface-500 ${className}`}>
        Loading map…
      </div>
    );
  }

  const mapHeightClass = fullscreen ? 'h-[calc(100vh-0px)]' : 'h-[44rem]';

  return (
    <div
      ref={containerRef}
      className={`rounded-xl border border-surface-200 overflow-hidden z-0 relative overscroll-contain bg-surface-900 ${fullscreen ? 'fixed inset-0 z-[2000] rounded-none border-0' : ''} ${className}`}
    >
      <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none flex justify-center">
        <MapPlaceSearch onSelect={onPlaceSelect} savedPlaces={placeLabels} className="w-full max-w-lg pointer-events-auto shadow-lg" />
      </div>

      <div className="absolute top-14 right-3 z-[1000] flex gap-1 pointer-events-auto shadow-sm">
        <ToolBtn
          active={basemapVariant === 'satellite'}
          onClick={() => setBasemapVariant('satellite')}
          title="Satellite imagery with roads"
        >
          Satellite
        </ToolBtn>
        <ToolBtn
          active={basemapVariant === 'voyager'}
          onClick={() => setBasemapVariant('voyager')}
          title="Street map"
        >
          Street
        </ToolBtn>
        <ToolBtn
          active={fullscreen}
          onClick={toggleFullscreen}
          title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen map'}
        >
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </ToolBtn>
      </div>

      <div className="absolute top-24 right-3 z-[1000] flex justify-end">
        <GeofenceLabelControl
          mode={labelMode}
          onChange={setLabelMode}
          count={placeLabels.length}
          menuPlacement="down"
        />
      </div>

      <div className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-2 pointer-events-none max-w-[calc(100%-1.5rem)]">
        <div className="flex flex-wrap gap-1.5 pointer-events-auto shadow-sm">
          <ToolBtn active={mapTool === 'pan' && !mapClickMode && !manualRoutePlotActive} onClick={() => onMapToolChange?.('pan')} title="Pan the map (drag to move)">
            Pan
          </ToolBtn>
          <ToolBtn active={mapTool === 'draw'} onClick={() => onMapToolChange?.('draw')} title="Draw land boundary">
            Draw
          </ToolBtn>
          <ToolBtn active={mapClickMode} onClick={() => onMapToolChange?.('pick')} title="Pick a point — pan & zoom first for precision">
            Pick
          </ToolBtn>
        </div>
        <div className="rounded-lg bg-slate-900/88 text-white px-3 py-2 text-[11px] shadow-lg pointer-events-auto max-w-md">
          {statusLine}
        </div>
        {precisionPickActive && (
          <button
            type="button"
            onClick={placeAtMapCenter}
            className="pointer-events-auto self-start text-xs font-semibold px-3 py-2 rounded-lg bg-brand-600 text-white shadow-lg hover:bg-brand-700"
          >
            Place at crosshair
          </button>
        )}
      </div>

      {precisionPickActive && (
        <div className="absolute inset-0 z-[400] pointer-events-none flex items-center justify-center">
          <div className="relative w-10 h-10" aria-hidden>
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,.8)]" />
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white -translate-x-1/2 shadow-[0_0_2px_rgba(0,0,0,.8)]" />
            <div className="absolute inset-2 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.45)]" />
          </div>
        </div>
      )}

      {hasResizableDraft && onScaleDraft && (
        <div className="absolute bottom-3 right-3 z-[1000] flex flex-col gap-1.5 pointer-events-auto">
          <span className="text-[10px] font-semibold text-white bg-slate-900/80 px-2 py-1 rounded-md text-center">Resize</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => onScaleDraft(0.9)} className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white dark:bg-surface-800 border shadow-sm hover:bg-surface-50">−10%</button>
            <button type="button" onClick={() => onScaleDraft(1.1)} className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white dark:bg-surface-800 border shadow-sm hover:bg-surface-50">+10%</button>
          </div>
        </div>
      )}

      {fullscreen && manualRoutePlotActive && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] flex flex-wrap items-center gap-2 pointer-events-auto px-4 py-2 rounded-xl bg-slate-900/92 text-white text-xs shadow-xl border border-white/10">
          <span className="font-semibold">{manualRouteWaypoints?.length || 0} waypoint{(manualRouteWaypoints?.length || 0) === 1 ? '' : 's'}</span>
          <button type="button" onClick={placeAtMapCenter} className="px-2.5 py-1 rounded-md bg-brand-600 hover:bg-brand-500 font-medium">
            Place at crosshair
          </button>
          <button type="button" onClick={() => onManualRouteUndo?.()} className="px-2.5 py-1 rounded-md border border-white/30 hover:bg-white/10">
            Undo
          </button>
          <span className="text-white/70 hidden sm:inline">Pan · scroll zoom · click map</span>
        </div>
      )}

      <MapContainer
        center={defaultCenter}
        zoom={9}
        className={`${mapHeightClass} w-full`}
        scrollWheelZoom="center"
        doubleClickZoom={!drawingActive || manualDrawMode !== 'polygon'}
        zoomControl
      >
        <FleetMapBasemap variant={basemapVariant} showLabels={basemapVariant === 'satellite'} />
        <MapWheelGuard />
        <MapPanLock locked={panLocked} disableDoubleClickZoom={manualDrawMode === 'polygon'} />
        <MapInvalidateSize trigger={fullscreen} />
        <MapCenterRegistry registerRef={mapCenterRef} />
        <FitBoundsOnce revision={fitRevision} positions={fitPositions} />
        <FlyToPoint point={flyTarget} revision={flyRevision} />

        <MapClickHandler enabled={mapClickMode && !drawingActive} onMapClick={onMapClick} />

        <CircleDrawHandler
          active={manualDrawMode === 'circle' && !manualCircleDraft}
          onPreview={onCircleDrawPreview}
          onComplete={onCircleDrawComplete}
        />
        <PolygonClickDrawHandler
          active={manualDrawMode === 'polygon' && !manualPolygonDraft}
          points={polygonDrawPoints}
          onAddPoint={(pt, opts) => onPolygonAddPoint?.(pt, opts)}
          onComplete={onPolygonDrawComplete}
        />
        <FreehandDrawHandler
          active={manualDrawMode === 'freehand' && !manualPolygonDraft}
          onPreview={onFreehandPreview}
          onComplete={onFreehandComplete}
        />
        <RouteWaypointDrawHandler
          active={manualRoutePlotActive}
          waypoints={manualRouteWaypoints}
          onAddWaypoint={onManualRouteAddWaypoint}
          onInsertWaypoint={onManualRouteInsertWaypoint}
          onMoveWaypoint={onManualRouteMoveWaypoint}
          onUndo={onManualRouteUndo}
        />

        {circleDrawPreview && (
          <CircleDrawPreview
            circle={circleDrawPreview}
            color={draftColor}
            label={`${(circleDrawPreview.radius_m || 0).toLocaleString()} m`}
          />
        )}
        {polygonDrawPoints?.length > 0 && manualDrawMode === 'polygon' && (
          <PolygonDrawPreview points={polygonDrawPoints} color={draftColor} />
        )}
        {freehandPreview?.length > 0 && (
          <PolygonDrawPreview points={freehandPreview} color={draftColor} />
        )}
        {manualCircleDraft && (
          <CircleDraftEditor
            circle={manualCircleDraft}
            color={draftColor}
            onChange={onManualCircleDraftChange}
            onEditSnapshot={onDraftSnapshot}
          />
        )}
        {manualPolygonDraft?.ring?.length >= 3 && (
          <PolygonDraftEditor
            ring={manualPolygonDraft.ring}
            color={draftColor}
            onChange={onManualPolygonDraftChange}
            onEditSnapshot={onDraftSnapshot}
          />
        )}

        {geofences.map((g) => (
          <InteractiveGeofence
            key={g.id}
            geofence={g}
            selected={g.id === selectedGeofenceId}
            selectionEnabled={selectionEnabled}
            onSelect={onGeofenceSelect}
          />
        ))}

        <GeofencePlaceLabels geofences={labelGeofences ?? geofences} mode={labelMode} />

        <RouteAlternativesMapLayers preview={preview} corridorM={routeCorridorM} />

        <ManualRoutePlotLayers
          waypoints={manualRouteWaypoints}
          snapPreview={manualRouteSnapPreview}
          snapping={manualRouteSnapping}
          lockEndpoints={manualRouteLockEndpoints}
          onMoveWaypoint={onManualRouteMoveWaypoint}
        />

        {routeMarkers?.pointA && (
          <>
            <Circle center={[routeMarkers.pointA.lat, routeMarkers.pointA.lng]} radius={routeMarkers.endpointRadius || 500} pathOptions={{ color: '#2563eb', fillOpacity: 0.2 }} />
            <Marker position={[routeMarkers.pointA.lat, routeMarkers.pointA.lng]} />
          </>
        )}
        {routeMarkers?.pointB && (
          <>
            <Circle center={[routeMarkers.pointB.lat, routeMarkers.pointB.lng]} radius={routeMarkers.endpointRadius || 500} pathOptions={{ color: '#059669', fillOpacity: 0.2 }} />
            <Marker position={[routeMarkers.pointB.lat, routeMarkers.pointB.lng]} />
          </>
        )}

        {preview?.origin && !routeMarkers?.pointA && (
          <Circle center={[preview.origin.lat, preview.origin.lng]} radius={preview.endpoint_radius_m || 500} pathOptions={{ color: '#2563eb', fillOpacity: 0.2 }} />
        )}
        {preview?.destination && !routeMarkers?.pointB && (
          <Circle center={[preview.destination.lat, preview.destination.lng]} radius={preview.endpoint_radius_m || 500} pathOptions={{ color: '#059669', fillOpacity: 0.2 }} />
        )}

        {alertPreview?.lat != null && alertPreview?.lng != null && (
          <>
            <Circle center={[alertPreview.lat, alertPreview.lng]} radius={Number(alertPreview.radius_m) || 150} pathOptions={{ color: '#e11d48', weight: 2, fillOpacity: 0.25, dashArray: '4 4' }} />
            <Marker position={[alertPreview.lat, alertPreview.lng]} />
          </>
        )}

        {showEditPolygon && (
          <PolygonDraftEditor
            ring={editRing}
            color={resolveEditColor}
            onChange={onEditRingChange}
            onVertexDrag={onVertexDrag}
            onEditSnapshot={onEditSnapshot}
          />
        )}

        {editCenter && editRadius && !editRing && (
          <CircleDraftEditor
            circle={{ lat: editCenter.lat, lng: editCenter.lng, radius_m: Number(editRadius) || 500 }}
            color={resolveEditColor}
            onEditSnapshot={onEditSnapshot}
            onChange={({ lat, lng, radius_m }) => {
              onCenterDrag?.(lat, lng);
              onEditRadiusChange?.(radius_m);
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
