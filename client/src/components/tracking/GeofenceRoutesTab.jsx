import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracking as trackingApi } from '../../api';
import GeofenceMapEditor from './GeofenceMapEditor.jsx';
import ManualGeofencePanel from './ManualGeofencePanel.jsx';
import AlternativeRoutesPanel from './AlternativeRoutesPanel.jsx';
import ManualRoutePlotPanel from './ManualRoutePlotPanel.jsx';
import GeofenceColorPicker from './GeofenceColorPicker.jsx';
import { geofenceDisplayColor, parseGeofenceMeta, colorMetaJson, mergeColorIntoPolygonJson } from '../../lib/geofenceStyle.js';
import {
  bufferPolylineToPolygon,
  expandPolygonRing,
  parsePolygonJson,
  parseCorridorPolyline,
  parseCorridorMeta,
  scalePolygonRing,
  polylineDistanceKm,
  formatRouteDistanceKm,
} from '../../lib/routeCorridorGeofence.js';
import { destinationFromRouteName, originFromRouteName } from '../../lib/rawExportToFleetUpdate.js';
import { hasValidCoords, parseLatLngPair } from '../../lib/geoCoords.js';
import { useUndoStack, cloneRing } from '../../lib/useUndoStack.js';
import PickedPointRow from './PickedPointRow.jsx';
import { clampRadius } from './geofenceCircleDraw.jsx';

const WORKFLOW_STEPS = [
  { id: 'land', label: '1. Land & site area', desc: 'Search a place, draw the boundary around your site or land parcel' },
  { id: 'road', label: '2. Haul road A → B', desc: 'Link to a system route, set loading & destination, draw the road corridor' },
  { id: 'manage', label: '3. Saved geofences', desc: 'Review, edit, and remove configured geofences' },
];

function routeOriginLabel(route) {
  if (!route) return '';
  return route.loading_address || route.starting_point || originFromRouteName(route.name) || '';
}

function routeDestinationLabel(route) {
  if (!route) return '';
  return route.destination_address || route.destination || destinationFromRouteName(route.name) || '';
}

function haulRoadSetupDistanceKm(setup, routes) {
  const corridorG = setup.geofences.find((g) => g.leg === 'corridor');
  const poly = parseCorridorPolyline(corridorG?.polygon_json);
  const fromPoly = poly?.length ? polylineDistanceKm(poly) : null;
  if (fromPoly != null && fromPoly > 0) return fromPoly;
  const route = routes.find((r) => r.id === setup.routeId);
  return route?.distance_km ?? null;
}

function buildPreviewFromSavedHaulRoad(savedGeofences, routes, routeId) {
  const saved = savedGeofences.filter((g) => g.contractor_route_id === routeId);
  const originG = saved.find((g) => g.leg === 'origin');
  const destG = saved.find((g) => g.leg === 'destination');
  const corridorG = saved.find((g) => g.leg === 'corridor');
  const altGs = saved.filter((g) => g.leg === 'corridor_alt');
  if (!corridorG && !originG && !destG) return null;

  const route = routes.find((r) => r.id === routeId);
  const corridorMeta = parseCorridorMeta(corridorG?.polygon_json);
  const primaryPoly = parseCorridorPolyline(corridorG?.polygon_json) || [];
  const corridorM = corridorMeta.corridor_m || 400;
  const endpointRadiusM = originG?.radius_m || destG?.radius_m || 500;
  const corridorRing = parsePolygonJson(corridorG?.polygon_json);

  const manuals = altGs.map((g, i) => buildManualAlternativeFromGeofence(g, i + 1)).filter(Boolean);
  const primaryAlt = {
    uid: corridorMeta.route_uid || 'saved-0',
    polyline: primaryPoly,
    distance_km: polylineDistanceKm(primaryPoly) || route?.distance_km,
  };
  const alternatives = primaryPoly.length || manuals.length
    ? [primaryAlt, ...manuals.filter((m) => m.uid !== primaryAlt.uid)]
    : [];

  const alt_corridors = {};
  alternatives.forEach((alt, i) => {
    const isPrimary = i === 0;
    if (isPrimary) {
      alt_corridors[i] = {
        enabled: true,
        corridor_polygon: corridorRing?.length ? corridorRing : bufferPolylineToPolygon(primaryPoly, corridorM),
        corridor_manual: !!corridorRing?.length,
      };
      return;
    }
    const savedMatch = findSavedAltForAlternative(alt, altGs);
    alt_corridors[i] = {
      enabled: !!savedMatch,
      corridor_polygon: savedMatch
        ? (parsePolygonJson(savedMatch.polygon_json) || bufferPolylineToPolygon(alt.polyline || [], corridorM))
        : bufferPolylineToPolygon(alt.polyline || [], corridorM),
      corridor_manual: !!savedMatch,
    };
  });

  const origin = originG?.center_lat != null
    ? { lat: Number(originG.center_lat), lng: Number(originG.center_lng), display_name: routeOriginLabel(route) }
    : null;
  const destination = destG?.center_lat != null
    ? { lat: Number(destG.center_lat), lng: Number(destG.center_lng), display_name: routeDestinationLabel(route) }
    : null;

  return {
    origin,
    destination,
    route_polyline: primaryPoly,
    corridor_polygon: alt_corridors[0]?.corridor_polygon,
    endpoint_radius_m: endpointRadiusM,
    selected_route_index: 0,
    alternatives,
    alt_corridors,
    driving: {
      distance_km: primaryAlt.distance_km,
      polyline: primaryPoly,
    },
    corridor_m: corridorM,
  };
}

function positionsFromGeofence(g) {
  const pts = [];
  const ring = parsePolygonJson(g?.polygon_json);
  ring?.forEach((p) => pts.push([p.lat, p.lng]));
  if (g?.center_lat != null) pts.push([g.center_lat, g.center_lng]);
  return pts;
}

function positionsFromGeofences(list) {
  return list.flatMap((g) => positionsFromGeofence(g));
}

function routeLetter(index) {
  return String.fromCharCode(65 + Number(index || 0));
}

function initAltCorridors(alternatives, corridorM, selectedIndex, enableAll = false) {
  const alt_corridors = {};
  (alternatives || []).forEach((alt, i) => {
    alt_corridors[i] = {
      enabled: enableAll || i === selectedIndex,
      corridor_polygon: bufferPolylineToPolygon(alt.polyline || [], corridorM),
      corridor_manual: false,
    };
  });
  return alt_corridors;
}

function enrichAlternatives(alternatives) {
  return (alternatives || []).map((alt, i) => {
    if (alt.is_manual && alt.polyline?.length) {
      return { ...alt, uid: alt.uid || `manual-${alt.manual_seq || i}` };
    }
    const geometryKm = polylineDistanceKm(alt.polyline);
    return {
      ...alt,
      uid: alt.uid || `osrm-${alt.index ?? i}`,
      distance_km: geometryKm ?? alt.distance_km,
      osrm_distance_km: alt.osrm_distance_km ?? alt.distance_km,
    };
  });
}

function polylineMatchScore(a, b) {
  if (!a?.length || !b?.length) return Infinity;
  const start = a[0];
  const end = a[a.length - 1];
  const bStart = b[0];
  const bEnd = b[b.length - 1];
  return Math.hypot(bStart.lat - start.lat, bStart.lng - start.lng)
    + Math.hypot(bEnd.lat - end.lat, bEnd.lng - end.lng);
}

function findSavedAltForAlternative(alt, altGs) {
  if (!altGs?.length) return null;
  if (alt.uid) {
    const byUid = altGs.find((g) => parseCorridorMeta(g.polygon_json).route_uid === alt.uid);
    if (byUid) return byUid;
  }
  let best = null;
  let bestScore = Infinity;
  const pl = alt.polyline || [];
  for (const g of altGs) {
    const savedPl = parseCorridorPolyline(g.polygon_json);
    if (!savedPl?.length) continue;
    const score = polylineMatchScore(pl, savedPl);
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore < 0.2 ? best : null;
}

function buildManualAlternativeFromGeofence(g, seq = 1) {
  const meta = parseCorridorMeta(g.polygon_json);
  const pl = parseCorridorPolyline(g.polygon_json);
  if (!pl?.length) return null;
  return {
    uid: meta.route_uid || `manual-saved-${g.id}`,
    is_manual: true,
    manual_seq: meta.manual_seq || seq,
    manual_label: meta.manual_label || g.name?.replace(/^.*—\s*/, '') || `Custom route ${seq}`,
    manual_waypoints: meta.manual_waypoints?.length >= 2 ? meta.manual_waypoints : pl,
    polyline: pl,
    distance_km: polylineDistanceKm(pl),
    duration_min: meta.duration_min,
    saved_geofence_id: g.id,
  };
}

function countManualRoutes(alternatives) {
  return (alternatives || []).filter((a) => a.is_manual).length;
}

function syncCurrentAltCorridor(preview, corridorPolygon, corridorManual) {
  if (!preview) return preview;
  const idx = preview.selected_route_index ?? 0;
  const alt_corridors = { ...(preview.alt_corridors || {}) };
  alt_corridors[idx] = {
    ...(alt_corridors[idx] || {}),
    enabled: alt_corridors[idx]?.enabled ?? true,
    corridor_polygon: corridorPolygon,
    corridor_manual: corridorManual,
  };
  return { ...preview, alt_corridors };
}

function matchAlternativeIndex(alternatives, polyline) {
  if (!polyline?.length || !alternatives?.length) return 0;
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  let best = 0;
  let bestScore = Infinity;
  alternatives.forEach((alt, i) => {
    const pl = alt.polyline;
    if (!pl?.length) return;
    const d0 = Math.hypot(pl[0].lat - start.lat, pl[0].lng - start.lng)
      + Math.hypot(pl[pl.length - 1].lat - end.lat, pl[pl.length - 1].lng - end.lng);
    if (d0 < bestScore) {
      bestScore = d0;
      best = i;
    }
  });
  return best;
}

function mergeSavedCorridorsIntoPreview(preview, savedGeofences, corridorM) {
  if (!preview?.alternatives?.length || !savedGeofences?.length) return preview;

  const corridorG = savedGeofences.find((g) => g.leg === 'corridor');
  const altGs = savedGeofences.filter((g) => g.leg === 'corridor_alt');
  const primaryPoly = parseCorridorPolyline(corridorG?.polygon_json);
  const primaryMeta = parseCorridorMeta(corridorG?.polygon_json);

  let alternatives = preview.alternatives.filter((a) => !a.is_manual);
  const manualsFromDb = altGs
    .filter((g) => parseCorridorMeta(g.polygon_json).is_manual)
    .map((g, i) => buildManualAlternativeFromGeofence(g, i + 1))
    .filter(Boolean);
  const sessionManuals = preview.alternatives.filter((a) => a.is_manual);
  const manualUids = new Set(sessionManuals.map((a) => a.uid));
  alternatives = [...alternatives, ...sessionManuals, ...manualsFromDb.filter((m) => !manualUids.has(m.uid))];

  let primaryIndex = preview.selected_route_index ?? 0;
  if (primaryPoly?.length) {
    primaryIndex = matchAlternativeIndex(alternatives, primaryPoly);
    if (alternatives[primaryIndex]) {
      alternatives[primaryIndex] = {
        ...alternatives[primaryIndex],
        uid: primaryMeta.route_uid || alternatives[primaryIndex].uid || `osrm-${primaryIndex}`,
        polyline: primaryPoly,
        distance_km: polylineDistanceKm(primaryPoly),
      };
    }
  }

  const alt_corridors = {};
  alternatives.forEach((alt, i) => {
    const isPrimary = i === primaryIndex;
    if (isPrimary) {
      const primaryRing = parsePolygonJson(corridorG?.polygon_json);
      alt_corridors[i] = {
        enabled: true,
        corridor_polygon: primaryRing?.length
          ? primaryRing
          : bufferPolylineToPolygon(alt.polyline || [], corridorM),
        corridor_manual: !!primaryRing?.length,
      };
      return;
    }
    const savedMatch = findSavedAltForAlternative(alt, altGs);
    alt_corridors[i] = {
      enabled: !!savedMatch,
      corridor_polygon: savedMatch
        ? (parsePolygonJson(savedMatch.polygon_json) || bufferPolylineToPolygon(alt.polyline || [], corridorM))
        : bufferPolylineToPolygon(alt.polyline || [], corridorM),
      corridor_manual: !!savedMatch,
    };
  });

  const selected = alternatives[primaryIndex] || alternatives[0];
  return {
    ...preview,
    alternatives,
    selected_route_index: primaryIndex,
    route_polyline: primaryPoly?.length ? primaryPoly : (selected?.polyline || preview.route_polyline),
    corridor_polygon: alt_corridors[primaryIndex]?.corridor_polygon || preview.corridor_polygon,
    alt_corridors,
    driving: {
      distance_km: selected?.distance_km,
      duration_min: selected?.duration_min,
      polyline: selected?.polyline,
    },
  };
}

const ALERT_ZONE_TYPES = [
  { value: 'hazard', label: 'High risk area', radius: 150, alert_on_entry: true, alert_on_exit: false },
  { value: 'hazard', label: 'Crime hotspot', radius: 200, alert_on_entry: true, alert_on_exit: false },
  { value: 'no_stop', label: 'No-stop zone', radius: 120, alert_on_entry: true, alert_on_exit: true },
  { value: 'hazard', label: 'Custom alert zone', radius: 150, alert_on_entry: true, alert_on_exit: false },
];

export default function GeofenceRoutesTab({ setError }) {
  const [routes, setRoutes] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [corridorManual, setCorridorManual] = useState(false);
  const [manualRoutePlotActive, setManualRoutePlotActive] = useState(false);
  const [manualWaypoints, setManualWaypoints] = useState([]);
  const [manualRouteSnapPreview, setManualRouteSnapPreview] = useState(null);
  const [manualRouteSnapping, setManualRouteSnapping] = useState(false);
  const [manualRouteLabel, setManualRouteLabel] = useState('');
  const [manualRouteFinalizing, setManualRouteFinalizing] = useState(false);
  const [manualRouteLockEndpoints, setManualRouteLockEndpoints] = useState(false);
  const [editingManualRouteIndex, setEditingManualRouteIndex] = useState(null);
  const manualSnapSeq = useRef(0);
  const [workflowStep, setWorkflowStep] = useState('land');
  const [mapTool, setMapTool] = useState('pan');
  const [fitRevision, setFitRevision] = useState(0);
  const [fitPositions, setFitPositions] = useState(null);
  const [flyRevision, setFlyRevision] = useState(0);
  const [flyTarget, setFlyTarget] = useState(null);

  const requestMapFit = useCallback((positions) => {
    if (!positions?.length) return;
    setFitPositions(positions);
    setFitRevision((r) => r + 1);
  }, []);

  const flyToPlace = useCallback((place) => {
    if (!place?.lat) return;
    setFlyTarget({ lat: place.lat, lng: place.lng, zoom: place.zoom || 15 });
    setFlyRevision((r) => r + 1);
  }, []);

  const [drawForm, setDrawForm] = useState({
    contractor_route_id: '',
    corridor_m: '400',
    endpoint_radius_m: '500',
    origin_query: '',
    destination_query: '',
    origin_lat: '',
    origin_lng: '',
    dest_lat: '',
    dest_lng: '',
    use_origin_coords: false,
    use_dest_coords: false,
  });

  const [alertForm, setAlertForm] = useState({
    name: '',
    zone_type: '0',
    contractor_route_id: '',
    center_lat: '',
    center_lng: '',
    radius_m: '150',
    alert_on_entry: true,
    alert_on_exit: false,
  });
  const [mapClickTarget, setMapClickTarget] = useState(null);
  const [savingAlert, setSavingAlert] = useState(false);

  const [manualDrawMode, setManualDrawMode] = useState(null);
  const [manualCircleDraft, setManualCircleDraft] = useState(null);
  const [circleDrawPreview, setCircleDrawPreview] = useState(null);
  const polygonPointsUndo = useUndoStack([]);
  const polygonDrawPoints = polygonPointsUndo.value;
  const [freehandPreview, setFreehandPreview] = useState(null);
  const [manualPolygonDraft, setManualPolygonDraft] = useState(null);
  const [geofenceColor, setGeofenceColor] = useState('#f59e0b');

  const [editing, setEditing] = useState(null);
  const [editRing, setEditRing] = useState(null);
  const [editCenter, setEditCenter] = useState(null);
  const [editRadius, setEditRadius] = useState('500');
  const [editColor, setEditColor] = useState('#2563eb');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editUndoStack, setEditUndoStack] = useState([]);
  const [draftUndoStack, setDraftUndoStack] = useState([]);
  const [haulRoadDirty, setHaulRoadDirty] = useState(false);

  const alertPreview = useMemo(() => {
    const coords = parseLatLngPair(alertForm.center_lat, alertForm.center_lng);
    if (!coords) return null;
    return { ...coords, radius_m: Number(alertForm.radius_m) || 150 };
  }, [alertForm.center_lat, alertForm.center_lng, alertForm.radius_m]);

  const pointACoords = useMemo(() => {
    if (hasValidCoords(drawForm.origin_lat, drawForm.origin_lng)) {
      return parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng);
    }
    return preview?.origin || null;
  }, [drawForm.origin_lat, drawForm.origin_lng, preview?.origin]);

  const pointBCoords = useMemo(() => {
    if (hasValidCoords(drawForm.dest_lat, drawForm.dest_lng)) {
      return parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng);
    }
    return preview?.destination || null;
  }, [drawForm.dest_lat, drawForm.dest_lng, preview?.destination]);

  const clearPointA = () => {
    setDrawForm((f) => ({ ...f, origin_lat: '', origin_lng: '', use_origin_coords: false }));
    setPreview((p) => (p ? { ...p, origin: undefined } : p));
    setHaulRoadDirty(true);
    setMapClickTarget('origin');
    setMapTool('pick');
  };

  const clearPointB = () => {
    setDrawForm((f) => ({ ...f, dest_lat: '', dest_lng: '', use_dest_coords: false }));
    setPreview((p) => (p ? { ...p, destination: undefined } : p));
    setHaulRoadDirty(true);
    setMapClickTarget('destination');
    setMapTool('pick');
  };

  const updateOriginCoords = (latStr, lngStr) => {
    const valid = hasValidCoords(latStr, lngStr);
    setDrawForm((f) => ({
      ...f,
      origin_lat: latStr,
      origin_lng: lngStr,
      use_origin_coords: valid,
    }));
    if (valid) {
      const coords = parseLatLngPair(latStr, lngStr);
      setPreview((p) => (p ? { ...p, origin: coords } : p));
    }
    setHaulRoadDirty(true);
  };

  const updateDestCoords = (latStr, lngStr) => {
    const valid = hasValidCoords(latStr, lngStr);
    setDrawForm((f) => ({
      ...f,
      dest_lat: latStr,
      dest_lng: lngStr,
      use_dest_coords: valid,
    }));
    if (valid) {
      const coords = parseLatLngPair(latStr, lngStr);
      setPreview((p) => (p ? { ...p, destination: coords } : p));
    }
    setHaulRoadDirty(true);
  };

  const clearHaulRoadPreview = () => {
    setPreview(null);
    setCorridorManual(false);
    setManualRoutePlotActive(false);
    setManualWaypoints([]);
    setManualRouteSnapPreview(null);
    setManualRouteLabel('');
    setManualRouteLockEndpoints(false);
    setHaulRoadDirty(false);
  };

  const clearAlertPick = () => {
    setAlertForm((f) => ({ ...f, center_lat: '', center_lng: '' }));
    setMapClickTarget(null);
    setMapTool('pan');
  };

  const pushEditUndo = useCallback(() => {
    setEditUndoStack((stack) => [
      ...stack,
      {
        ring: cloneRing(editRing),
        center: editCenter ? { ...editCenter } : null,
        radius: editRadius,
      },
    ].slice(-30));
  }, [editRing, editCenter, editRadius]);

  const undoEdit = useCallback(() => {
    setEditUndoStack((stack) => {
      if (!stack.length) return stack;
      const prev = stack[stack.length - 1];
      setEditRing(prev.ring);
      setEditCenter(prev.center);
      setEditRadius(prev.radius);
      return stack.slice(0, -1);
    });
  }, []);

  const pushDraftUndo = useCallback(() => {
    setDraftUndoStack((stack) => [
      ...stack,
      {
        circle: manualCircleDraft ? { ...manualCircleDraft } : null,
        polygon: manualPolygonDraft?.ring ? { ring: cloneRing(manualPolygonDraft.ring) } : null,
      },
    ].slice(-30));
  }, [manualCircleDraft, manualPolygonDraft]);

  const undoDraft = useCallback(() => {
    setDraftUndoStack((stack) => {
      if (!stack.length) return stack;
      const prev = stack[stack.length - 1];
      setManualCircleDraft(prev.circle);
      setManualPolygonDraft(prev.polygon);
      return stack.slice(0, -1);
    });
  }, []);

  const handleMapClick = (lat, lng) => {
    if (manualDrawMode || manualRoutePlotActive) return;
    const latStr = lat.toFixed(6);
    const lngStr = lng.toFixed(6);
    if (mapClickTarget === 'origin') {
      setDrawForm((f) => ({ ...f, origin_lat: latStr, origin_lng: lngStr, use_origin_coords: true }));
      setPreview((p) => (p ? { ...p, origin: { lat, lng } } : p));
      setHaulRoadDirty(true);
      setMapClickTarget('destination');
    } else if (mapClickTarget === 'destination') {
      setDrawForm((f) => ({ ...f, dest_lat: latStr, dest_lng: lngStr, use_dest_coords: true }));
      setPreview((p) => (p ? { ...p, destination: { lat, lng } } : p));
      setHaulRoadDirty(true);
      setMapClickTarget(null);
      // Stay in pick-ready state so user can re-pick either point via Re-pick buttons
    } else if (mapClickTarget === 'alert') {
      setAlertForm((f) => ({ ...f, center_lat: latStr, center_lng: lngStr }));
      setMapClickTarget(null);
      setMapTool('pan');
    }
  };

  const handleMapToolChange = (tool) => {
    setMapTool(tool);
    if (tool === 'pan') {
      setManualDrawMode(null);
      setMapClickTarget(null);
      return;
    }
    if (tool === 'draw') {
      setMapClickTarget(null);
      setEditing(null);
      setEditRing(null);
      setEditCenter(null);
      setWorkflowStep('land');
      if (!manualDrawMode) setManualDrawMode('polygon');
      return;
    }
    if (tool === 'pick') {
      setManualDrawMode(null);
      setWorkflowStep('road');
      setMapClickTarget((t) => t || 'origin');
    }
  };

  const handlePlaceSelect = (place) => {
    if (place.geofenceId) {
      flyToPlace({ ...place, zoom: place.zoom || 16 });
      if (workflowStep === 'manage') {
        const g = geofences.find((x) => x.id === place.geofenceId);
        if (g) startEdit(g);
      }
      return;
    }
    flyToPlace(place);
    if (workflowStep === 'road' && mapClickTarget === 'origin') {
      setDrawForm((f) => ({
        ...f,
        origin_lat: place.lat.toFixed(6),
        origin_lng: place.lng.toFixed(6),
        origin_query: place.label || f.origin_query,
        use_origin_coords: true,
      }));
      setPreview((p) => (p ? { ...p, origin: { lat: place.lat, lng: place.lng, display_name: place.label } } : p));
      setHaulRoadDirty(true);
      setMapClickTarget('destination');
    } else if (workflowStep === 'road' && mapClickTarget === 'destination') {
      setDrawForm((f) => ({
        ...f,
        dest_lat: place.lat.toFixed(6),
        dest_lng: place.lng.toFixed(6),
        destination_query: place.label || f.destination_query,
        use_dest_coords: true,
      }));
      setPreview((p) => (p ? { ...p, destination: { lat: place.lat, lng: place.lng, display_name: place.label } } : p));
      setHaulRoadDirty(true);
      setMapClickTarget(null);
      setMapTool('pan');
    }
  };

  const setDrawMode = (mode) => {
    if (mode) {
      setMapClickTarget(null);
      setEditing(null);
      setEditRing(null);
      setEditCenter(null);
      polygonPointsUndo.reset([]);
      setFreehandPreview(null);
      setCircleDrawPreview(null);
    }
    if (mode) setMapTool('draw');
    setManualDrawMode(mode);
  };

  const handleCircleDrawComplete = (circle) => {
    if (!circle) return;
    setManualCircleDraft(circle);
    setCircleDrawPreview(null);
    setManualDrawMode(null);
    setMapTool('pan');
  };

  const handlePolygonAddPoint = (pt, opts) => {
    if (opts?.undo) {
      polygonPointsUndo.undo();
      return;
    }
    if (opts?.clear) {
      polygonPointsUndo.reset([]);
      return;
    }
    if (pt) polygonPointsUndo.commit((cur) => [...cur, pt]);
  };

  const handlePolygonDrawComplete = (ring) => {
    if (!ring || ring.length < 3) {
      polygonPointsUndo.reset([]);
      return;
    }
    setManualPolygonDraft({ ring });
    polygonPointsUndo.reset([]);
    setManualDrawMode(null);
    setMapTool('pan');
  };

  const handleFreehandComplete = (ring) => {
    setFreehandPreview(null);
    if (!ring || ring.length < 3) return;
    setManualPolygonDraft({ ring });
    setManualDrawMode(null);
    setMapTool('pan');
  };

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === drawForm.contractor_route_id),
    [routes, drawForm.contractor_route_id]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [r, g] = await Promise.all([trackingApi.contractorRoutes.list(), trackingApi.geofences.list()]);
      setRoutes(r.routes || []);
      setGeofences(g.geofences || []);
      requestMapFit(positionsFromGeofences(g.geofences || []));
    } catch (e) {
      setError(e?.message || 'Failed to load routes');
    } finally {
      setLoading(false);
    }
  }, [setError, requestMapFit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (manualDrawMode === 'polygon' && !manualPolygonDraft) polygonPointsUndo.redo();
        return;
      }
      if (mod && e.key === 'z') {
        e.preventDefault();
        if (manualDrawMode === 'polygon' && !manualPolygonDraft) polygonPointsUndo.undo();
        else if (editing) undoEdit();
        else if (manualPolygonDraft || manualCircleDraft) undoDraft();
        return;
      }
      if (e.key === 'Backspace' && manualDrawMode === 'polygon' && !manualPolygonDraft && !mod) {
        e.preventDefault();
        polygonPointsUndo.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualDrawMode, manualPolygonDraft, manualCircleDraft, editing, undoEdit, undoDraft, polygonPointsUndo]);

  useEffect(() => {
    if (!selectedRoute) return;
    setDrawForm((f) => ({
      ...f,
      origin_query: f.origin_query || routeOriginLabel(selectedRoute),
      destination_query: f.destination_query || routeDestinationLabel(selectedRoute),
    }));
  }, [selectedRoute]);

  const applyPreviewRoute = (alt, index, corridorM, endpointRadiusM, extras = {}) => {
    const polyline = alt.polyline || [];
    const ring = bufferPolylineToPolygon(polyline, corridorM);
    const alt_corridors = extras.alt_corridors
      || (extras.alternatives ? initAltCorridors(extras.alternatives, corridorM, index, extras.enableAll !== false) : null);
    const activeCorridor = alt_corridors?.[index]?.corridor_polygon?.length >= 3
      ? alt_corridors[index].corridor_polygon
      : ring;

    const nextPreview = {
      route_polyline: polyline,
      corridor_polygon: activeCorridor,
      origin: extras.origin,
      destination: extras.destination,
      endpoint_radius_m: endpointRadiusM,
      driving: { distance_km: alt.distance_km, duration_min: alt.duration_min, polyline },
      alternatives: extras.alternatives,
      selected_route_index: index,
      alt_corridors: alt_corridors
        ? {
            ...alt_corridors,
            [index]: {
              ...(alt_corridors[index] || {}),
              enabled: true,
              corridor_polygon: activeCorridor,
            },
          }
        : undefined,
    };
    const finalPreview = extras.mergeSavedGeofences
      ? mergeSavedCorridorsIntoPreview(nextPreview, extras.mergeSavedGeofences, corridorM)
      : nextPreview;
    setPreview(finalPreview);
    setCorridorManual(!!finalPreview.alt_corridors?.[finalPreview.selected_route_index ?? index]?.corridor_manual);
    setHaulRoadDirty(false);
    const allPositions = (extras.alternatives || [])
      .flatMap((a) => (a.polyline || []).map((p) => [p.lat, p.lng]));
    requestMapFit(allPositions.length >= 2 ? allPositions : polyline.map((p) => [p.lat, p.lng]));
  };

  const positionsFromAlternatives = (alternatives) => (
    (alternatives || []).flatMap((a) => (a.polyline || []).map((p) => [p.lat, p.lng]))
  );

  const zoomAllRouteOptions = () => {
    if (!preview?.alternatives?.length) return;
    requestMapFit(positionsFromAlternatives(preview.alternatives));
  };

  const zoomRouteOption = useCallback((index) => {
    const polyline = preview?.alternatives?.[index]?.polyline;
    if (!polyline?.length) return;
    requestMapFit(polyline.map((p) => [p.lat, p.lng]));
  }, [preview?.alternatives, requestMapFit]);

  const selectedSystemRoute = useMemo(
    () => routes.find((r) => r.id === drawForm.contractor_route_id),
    [routes, drawForm.contractor_route_id]
  );

  useEffect(() => {
    if (!manualRoutePlotActive || manualWaypoints.length < 2) {
      setManualRouteSnapPreview(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const seq = manualSnapSeq.current + 1;
      manualSnapSeq.current = seq;
      setManualRouteSnapping(true);
      try {
        const r = await trackingApi.map.routeThroughWaypoints(manualWaypoints);
        if (manualSnapSeq.current !== seq) return;
        setManualRouteSnapPreview(r.route);
      } catch {
        if (manualSnapSeq.current === seq) setManualRouteSnapPreview(null);
      } finally {
        if (manualSnapSeq.current === seq) setManualRouteSnapping(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [manualRoutePlotActive, manualWaypoints]);

  const startManualRoutePlot = useCallback(() => {
    setEditingManualRouteIndex(null);
    setManualRoutePlotActive(true);
    setManualWaypoints([]);
    setManualRouteSnapPreview(null);
    setManualRouteLabel('');
    setManualRouteLockEndpoints(false);
    setMapTool('pan');
    setMapClickTarget(null);
    setManualDrawMode(null);
    setEditing(null);
  }, []);

  const cancelManualRoutePlot = useCallback(() => {
    setManualRoutePlotActive(false);
    setEditingManualRouteIndex(null);
    setManualWaypoints([]);
    setManualRouteSnapPreview(null);
    setManualRouteLabel('');
    setManualRouteLockEndpoints(false);
  }, []);

  const startEditManualRoute = useCallback((index) => {
    const alt = preview?.alternatives?.[index];
    if (!alt?.is_manual) return;
    setEditingManualRouteIndex(index);
    setManualRoutePlotActive(true);
    setManualWaypoints(
      alt.manual_waypoints?.length >= 2
        ? alt.manual_waypoints.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        : (alt.polyline || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    );
    setManualRouteLabel(alt.manual_label || '');
    setManualRouteLockEndpoints(false);
    setManualRouteSnapPreview(null);
    setMapTool('pan');
    setMapClickTarget(null);
    setManualDrawMode(null);
    setEditing(null);
    requestMapFit((alt.polyline || []).map((p) => [p.lat, p.lng]));
  }, [preview?.alternatives, requestMapFit]);

  const seedManualRouteFromAB = useCallback(() => {
    const pts = [];
    if (pointACoords) pts.push({ lat: pointACoords.lat, lng: pointACoords.lng });
    if (pointBCoords) pts.push({ lat: pointBCoords.lat, lng: pointBCoords.lng });
    if (pts.length < 2) return;
    setManualWaypoints(pts);
    setManualRouteLockEndpoints(true);
    requestMapFit(pts.map((p) => [p.lat, p.lng]));
  }, [pointACoords, pointBCoords, requestMapFit]);

  const addManualWaypoint = useCallback((pt) => {
    setManualWaypoints((w) => [...w, pt]);
  }, []);

  const moveManualWaypoint = useCallback((index, lat, lng) => {
    setManualWaypoints((w) => w.map((p, i) => (i === index ? { lat, lng } : p)));
  }, []);

  const undoManualWaypoint = useCallback((action) => {
    if (action === 'clear') {
      cancelManualRoutePlot();
      return;
    }
    setManualWaypoints((w) => w.slice(0, -1));
  }, [cancelManualRoutePlot]);

  const insertManualWaypointAfter = useCallback((afterIndex) => {
    setManualWaypoints((w) => {
      if (afterIndex < 0 || afterIndex >= w.length - 1) return w;
      const a = w[afterIndex];
      const b = w[afterIndex + 1];
      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const next = [...w];
      next.splice(afterIndex + 1, 0, mid);
      return next;
    });
  }, []);

  const insertManualWaypointAt = useCallback((index, pt) => {
    setManualWaypoints((w) => {
      const next = [...w];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, pt);
      return next;
    });
  }, []);

  const updateManualWaypointCoords = useCallback((index, lat, lng) => {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
    setManualWaypoints((w) => w.map((p, i) => (i === index ? { lat: latN, lng: lngN } : p)));
  }, []);

  const removeManualWaypointAt = useCallback((index) => {
    setManualWaypoints((w) => {
      if (manualRouteLockEndpoints && (index === 0 || index === w.length - 1)) return w;
      return w.filter((_, i) => i !== index);
    });
  }, [manualRouteLockEndpoints]);

  const updateManualAlternative = useCallback((index, snapped, waypoints, label) => {
    const corridorM = Number(drawForm.corridor_m) || 400;
    setPreview((p) => {
      if (!p?.alternatives?.[index]) return p;
      const alternatives = [...p.alternatives];
      const prev = alternatives[index];
      alternatives[index] = {
        ...prev,
        ...snapped,
        uid: prev.uid || `manual-${prev.manual_seq || index}`,
        is_manual: true,
        manual_waypoints: waypoints,
        manual_label: label.trim() || prev.manual_label,
      };
      const alt_corridors = { ...(p.alt_corridors || {}) };
      alt_corridors[index] = {
        ...(alt_corridors[index] || {}),
        enabled: alt_corridors[index]?.enabled ?? true,
        corridor_polygon: bufferPolylineToPolygon(snapped.polyline, corridorM),
        corridor_manual: false,
      };
      const isPrimary = (p.selected_route_index ?? 0) === index;
      return {
        ...p,
        alternatives,
        alt_corridors,
        ...(isPrimary
          ? {
              route_polyline: snapped.polyline,
              corridor_polygon: alt_corridors[index].corridor_polygon,
              driving: {
                distance_km: snapped.distance_km,
                duration_min: snapped.duration_min,
                polyline: snapped.polyline,
              },
            }
          : {}),
      };
    });
  }, [drawForm.corridor_m]);

  const appendManualAlternative = useCallback((snapped, waypoints, label) => {
    const corridorM = Number(drawForm.corridor_m) || 400;
    setPreview((p) => {
      if (!p) return p;
      const manualSeq = countManualRoutes(p.alternatives) + 1;
      const newAlt = {
        ...snapped,
        uid: `manual-${Date.now()}`,
        is_manual: true,
        manual_seq: manualSeq,
        manual_label: label.trim() || `Custom route ${manualSeq}`,
        manual_waypoints: waypoints,
      };
      const alternatives = [...(p.alternatives || []), newAlt];
      const idx = alternatives.length - 1;
      const alt_corridors = { ...(p.alt_corridors || {}) };
      alt_corridors[idx] = {
        enabled: true,
        corridor_polygon: bufferPolylineToPolygon(newAlt.polyline, corridorM),
        corridor_manual: false,
      };
      return { ...p, alternatives, alt_corridors };
    });
  }, [drawForm.corridor_m]);

  const finalizeManualRoute = async () => {
    if (manualWaypoints.length < 2) return;
    setManualRouteFinalizing(true);
    setError('');
    const waypoints = [...manualWaypoints];
    const label = manualRouteLabel;
    const editIndex = editingManualRouteIndex;
    try {
      const r = await trackingApi.map.routeThroughWaypoints(waypoints);
      const snapped = r.route;
      if (!snapped?.polyline?.length) throw new Error('Could not snap plotted path to roads');
      if (editIndex != null) {
        updateManualAlternative(editIndex, snapped, waypoints, label);
      } else {
        appendManualAlternative(snapped, waypoints, label);
      }
      cancelManualRoutePlot();
      requestMapFit(snapped.polyline.map((pt) => [pt.lat, pt.lng]));
    } catch (err) {
      setError(err?.message || 'Could not add custom route');
    } finally {
      setManualRouteFinalizing(false);
    }
  };

  const removeManualAlternative = (index) => {
    if (!preview?.alternatives?.[index]?.is_manual) return;
    const primaryIndex = preview.selected_route_index ?? 0;
    let newPrimary = primaryIndex;
    if (index === primaryIndex) newPrimary = 0;
    else if (index < primaryIndex) newPrimary = primaryIndex - 1;

    const alternatives = preview.alternatives.filter((_, i) => i !== index);
    const corridorM = Number(drawForm.corridor_m) || 400;
    const oldCorridors = preview.alt_corridors || {};
    const alt_corridors = {};
    alternatives.forEach((alt, newIdx) => {
      let oldIdx = newIdx;
      if (newIdx >= index) oldIdx = newIdx + 1;
      const old = oldCorridors[oldIdx];
      alt_corridors[newIdx] = old || {
        enabled: newIdx === newPrimary,
        corridor_polygon: bufferPolylineToPolygon(alt.polyline || [], corridorM),
        corridor_manual: false,
      };
    });

    const selected = alternatives[newPrimary] || alternatives[0];
    setPreview({
      ...preview,
      alternatives,
      selected_route_index: newPrimary,
      route_polyline: selected?.polyline || preview.route_polyline,
      corridor_polygon: alt_corridors[newPrimary]?.corridor_polygon || preview.corridor_polygon,
      alt_corridors,
      driving: selected
        ? { distance_km: selected.distance_km, duration_min: selected.duration_min, polyline: selected.polyline }
        : preview.driving,
    });
  };

  const includeAllRouteOptions = () => {
    if (!preview?.alternatives?.length) return;
    const corridorM = Number(drawForm.corridor_m) || 400;
    const synced = syncCurrentAltCorridor(preview, preview.corridor_polygon, corridorManual);
    const alt_corridors = { ...(synced.alt_corridors || {}) };
    preview.alternatives.forEach((alt, i) => {
      alt_corridors[i] = {
        ...(alt_corridors[i] || {}),
        enabled: true,
        corridor_polygon: alt_corridors[i]?.corridor_polygon?.length >= 3
          ? alt_corridors[i].corridor_polygon
          : bufferPolylineToPolygon(alt.polyline || [], corridorM),
        corridor_manual: false,
      };
    });
    setPreview((p) => (p ? { ...p, alt_corridors } : p));
    zoomAllRouteOptions();
  };

  const excludeAllRouteOptions = () => {
    if (!preview?.alternatives?.length) return;
    const primaryIndex = preview.selected_route_index ?? 0;
    const corridorM = Number(drawForm.corridor_m) || 400;
    const synced = syncCurrentAltCorridor(preview, preview.corridor_polygon, corridorManual);
    const alt_corridors = { ...(synced.alt_corridors || initAltCorridors(preview.alternatives, corridorM, primaryIndex)) };
    preview.alternatives.forEach((alt, i) => {
      alt_corridors[i] = {
        ...(alt_corridors[i] || {}),
        enabled: i === primaryIndex,
        corridor_polygon: i === primaryIndex
          ? (preview.corridor_polygon || bufferPolylineToPolygon(alt.polyline || [], corridorM))
          : alt_corridors[i]?.corridor_polygon,
      };
    });
    setPreview((p) => (p ? { ...p, alt_corridors } : p));
    zoomRouteOption(primaryIndex);
  };

  const drawRouteOnMap = async (opts = {}) => {
    if (!drawForm.contractor_route_id) {
      setError('Select a route first.');
      return;
    }
    setDrawing(true);
    setError('');
    setEditing(null);
    if (!opts.keepCorridorEdits) setCorridorManual(false);
    try {
      const payload = {
        contractor_route_id: drawForm.contractor_route_id,
        corridor_m: Number(drawForm.corridor_m) || 400,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        origin_query: drawForm.origin_query || undefined,
        destination_query: drawForm.destination_query || undefined,
        save: false,
      };
      if (drawForm.use_origin_coords && hasValidCoords(drawForm.origin_lat, drawForm.origin_lng)) {
        const o = parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng);
        payload.origin_lat = o.lat;
        payload.origin_lng = o.lng;
      }
      if (drawForm.use_dest_coords && hasValidCoords(drawForm.dest_lat, drawForm.dest_lng)) {
        const d = parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng);
        payload.dest_lat = d.lat;
        payload.dest_lng = d.lng;
      }
      const r = await trackingApi.geofences.drawRoute(payload);
      const existingManual = (preview?.alternatives || []).filter((a) => a.is_manual);
      const autoAlternatives = enrichAlternatives(r.alternatives?.length ? r.alternatives : [{
        index: 0,
        distance_km: r.driving?.distance_km,
        duration_min: r.driving?.duration_min,
        polyline: r.route_polyline,
      }]);
      const alternatives = [...autoAlternatives, ...existingManual];
      const selectedIndex = Math.min(r.selected_route_index ?? 0, autoAlternatives.length - 1);
      const selected = alternatives[selectedIndex] || alternatives[0];
      const corridorM = Number(drawForm.corridor_m) || 400;
      setDrawForm((f) => ({
        ...f,
        origin_lat: r.origin?.lat != null ? Number(r.origin.lat).toFixed(6) : f.origin_lat,
        origin_lng: r.origin?.lng != null ? Number(r.origin.lng).toFixed(6) : f.origin_lng,
        dest_lat: r.destination?.lat != null ? Number(r.destination.lat).toFixed(6) : f.dest_lat,
        dest_lng: r.destination?.lng != null ? Number(r.destination.lng).toFixed(6) : f.dest_lng,
        use_origin_coords: r.origin?.lat != null || f.use_origin_coords,
        use_dest_coords: r.destination?.lat != null || f.use_dest_coords,
        origin_query: f.origin_query || r.origin?.display_name || '',
        destination_query: f.destination_query || r.destination?.display_name || '',
      }));
      applyPreviewRoute(selected, selectedIndex, corridorM, Number(drawForm.endpoint_radius_m) || 500, {
        origin: r.origin,
        destination: r.destination,
        alternatives,
        enableAll: autoAlternatives.length > 1,
        mergeSavedGeofences: opts.mergeSavedGeofences || null,
      });
      if (existingManual.length) {
        setPreview((p) => {
          if (!p) return p;
          const alt_corridors = { ...(p.alt_corridors || {}) };
          p.alternatives.forEach((alt, i) => {
            if (alt.is_manual) {
              alt_corridors[i] = {
                enabled: true,
                corridor_polygon: bufferPolylineToPolygon(alt.polyline || [], corridorM),
                corridor_manual: false,
              };
            }
          });
          return { ...p, alt_corridors };
        });
      }
    } catch (err) {
      setError(err?.message || 'Could not draw route on map');
      setPreview(null);
    } finally {
      setDrawing(false);
    }
  };

  const loadHaulRoadFromSaved = async (routeId) => {
    const saved = geofences.filter((g) => g.contractor_route_id === routeId);
    const originG = saved.find((g) => g.leg === 'origin');
    const destG = saved.find((g) => g.leg === 'destination');
    const corridorG = saved.find((g) => g.leg === 'corridor');
    const route = routes.find((r) => r.id === routeId);
    const corridorMeta = parseCorridorMeta(corridorG?.polygon_json);

    setDrawForm({
      contractor_route_id: routeId,
      corridor_m: String(corridorMeta.corridor_m || 400),
      endpoint_radius_m: String(originG?.radius_m || destG?.radius_m || 500),
      origin_query: routeOriginLabel(route) || f.origin_query,
      destination_query: routeDestinationLabel(route) || f.destination_query,
      origin_lat: originG?.center_lat != null ? Number(originG.center_lat).toFixed(6) : '',
      origin_lng: originG?.center_lng != null ? Number(originG.center_lng).toFixed(6) : '',
      dest_lat: destG?.center_lat != null ? Number(destG.center_lat).toFixed(6) : '',
      dest_lng: destG?.center_lng != null ? Number(destG.center_lng).toFixed(6) : '',
      use_origin_coords: originG?.center_lat != null,
      use_dest_coords: destG?.center_lat != null,
    });
    setWorkflowStep('road');
    setEditing(null);
    setMapTool('pan');
    await drawRouteOnMap({ mergeSavedGeofences: saved });
  };

  const selectAlternativeRoute = (index) => {
    if (!preview?.alternatives?.[index]) return;
    const corridorM = Number(drawForm.corridor_m) || 400;
    const prevIndex = preview.selected_route_index ?? 0;
    let alt_corridors = preview.alt_corridors || initAltCorridors(preview.alternatives, corridorM, prevIndex);
    alt_corridors = {
      ...alt_corridors,
      [prevIndex]: {
        ...alt_corridors[prevIndex],
        corridor_polygon: preview.corridor_polygon,
        corridor_manual: corridorManual,
      },
    };
    const alt = preview.alternatives[index];
    applyPreviewRoute(alt, index, corridorM, preview.endpoint_radius_m || Number(drawForm.endpoint_radius_m) || 500, {
      origin: preview.origin,
      destination: preview.destination,
      alternatives: preview.alternatives,
      alt_corridors,
    });
  };

  const toggleAltGeofence = (index) => {
    if (!preview?.alternatives?.[index]) return;
    const primaryIndex = preview.selected_route_index ?? 0;
    if (index === primaryIndex) return;
    const corridorM = Number(drawForm.corridor_m) || 400;
    let alt_corridors = syncCurrentAltCorridor(preview, preview.corridor_polygon, corridorManual).alt_corridors
      || initAltCorridors(preview.alternatives, corridorM, primaryIndex);
    const entry = alt_corridors[index] || {};
    const enabled = !entry.enabled;
    alt_corridors = {
      ...alt_corridors,
      [index]: {
        ...entry,
        enabled,
        corridor_polygon: entry.corridor_polygon?.length >= 3
          ? entry.corridor_polygon
          : bufferPolylineToPolygon(preview.alternatives[index].polyline || [], corridorM),
        corridor_manual: entry.corridor_manual || false,
      },
    };
    setPreview((p) => (p ? { ...p, alt_corridors } : p));
    if (enabled) zoomRouteOption(index);
  };

  const setPrimaryAlternativeRoute = (index) => {
    selectAlternativeRoute(index);
    zoomRouteOption(index);
  };

  const saveDrawnRoute = async () => {
    if (!preview || !drawForm.contractor_route_id) return;
    setDrawing(true);
    setError('');
    try {
      const primaryIndex = preview.selected_route_index ?? 0;
      const synced = syncCurrentAltCorridor(preview, preview.corridor_polygon, corridorManual);
      const alt_corridors = synced.alt_corridors || initAltCorridors(preview.alternatives, Number(drawForm.corridor_m) || 400, primaryIndex);
      const alternative_corridors = Object.entries(alt_corridors)
        .filter(([i, c]) => c.enabled && Number(i) !== primaryIndex)
        .map(([i, c]) => {
          const alt = preview.alternatives?.[Number(i)] || {};
          return {
            index: Number(i),
            route_polyline: alt.polyline || [],
            corridor_polygon: c.corridor_polygon,
            is_manual: !!alt.is_manual,
            manual_label: alt.manual_label || null,
            manual_waypoints: alt.manual_waypoints || null,
            manual_seq: alt.manual_seq || null,
            route_uid: alt.uid || null,
            duration_min: alt.duration_min ?? null,
          };
        });
      const primaryAlt = preview.alternatives?.[primaryIndex] || {};

      await trackingApi.geofences.drawRoute({
        contractor_route_id: drawForm.contractor_route_id,
        corridor_m: Number(drawForm.corridor_m) || 400,
        endpoint_radius_m: Number(drawForm.endpoint_radius_m) || 500,
        origin_query: drawForm.origin_query || undefined,
        destination_query: drawForm.destination_query || undefined,
        origin_lat: drawForm.use_origin_coords ? parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng)?.lat : preview.origin?.lat,
        origin_lng: drawForm.use_origin_coords ? parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng)?.lng : preview.origin?.lng,
        dest_lat: drawForm.use_dest_coords ? parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng)?.lat : preview.destination?.lat,
        dest_lng: drawForm.use_dest_coords ? parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng)?.lng : preview.destination?.lng,
        route_polyline: preview.route_polyline,
        corridor_polygon: preview.corridor_polygon,
        selected_route_index: primaryIndex,
        route_uid: primaryAlt.uid || `osrm-${primaryIndex}`,
        alternative_corridors,
        save: true,
      });
      setPreview(null);
      setCorridorManual(false);
      await load();
      const altCount = alternative_corridors.length;
      alert(
        altCount
          ? `Route geofences saved: origin, destination, primary corridor, and ${altCount} alternative road${altCount === 1 ? '' : 's'}.`
          : 'Route geofences saved: origin, road corridor, and destination.'
      );
    } catch (err) {
      setError(err?.message || 'Save failed');
    } finally {
      setDrawing(false);
    }
  };

  const adjustCorridorWidth = (corridorM) => {
    if (!preview?.alternatives?.length) return;
    setDrawForm((f) => ({ ...f, corridor_m: String(corridorM) }));
    setPreview((p) => {
      if (!p) return p;
      const primaryIndex = p.selected_route_index ?? 0;
      const alt_corridors = { ...(p.alt_corridors || initAltCorridors(p.alternatives, corridorM, primaryIndex)) };
      p.alternatives.forEach((alt, i) => {
        if (!alt_corridors[i]?.enabled) return;
        if (alt_corridors[i]?.corridor_manual && i !== primaryIndex) return;
        alt_corridors[i] = {
          ...alt_corridors[i],
          corridor_polygon: bufferPolylineToPolygon(alt.polyline || [], corridorM),
          corridor_manual: i === primaryIndex ? false : alt_corridors[i]?.corridor_manual,
        };
      });
      const primaryRing = alt_corridors[primaryIndex]?.corridor_polygon;
      return {
        ...p,
        corridor_polygon: primaryRing,
        alt_corridors,
      };
    });
    setCorridorManual(false);
  };

  const expandCorridorOnMap = (extraM) => {
    if (!preview?.corridor_polygon?.length) return;
    const ring = expandPolygonRing(preview.corridor_polygon, extraM);
    setPreview((p) => {
      if (!p) return p;
      return syncCurrentAltCorridor({ ...p, corridor_polygon: ring }, ring, true);
    });
    setCorridorManual(true);
  };

  const resetCorridorShape = () => {
    if (!preview?.route_polyline?.length) return;
    const ring = bufferPolylineToPolygon(preview.route_polyline, Number(drawForm.corridor_m) || 400);
    setPreview((p) => {
      if (!p) return p;
      return syncCurrentAltCorridor({ ...p, corridor_polygon: ring }, ring, false);
    });
    setCorridorManual(false);
  };

  const loadHaulRoadPreviewForManage = useCallback((routeId) => {
    const route = routes.find((r) => r.id === routeId);
    const saved = geofences.filter((g) => g.contractor_route_id === routeId);
    const built = buildPreviewFromSavedHaulRoad(saved, routes, routeId);
    if (!built) return;
    const originG = saved.find((g) => g.leg === 'origin');
    const destG = saved.find((g) => g.leg === 'destination');
    setDrawForm((f) => ({
      ...f,
      contractor_route_id: routeId,
      corridor_m: String(built.corridor_m || f.corridor_m || 400),
      endpoint_radius_m: String(built.endpoint_radius_m || f.endpoint_radius_m || 500),
      origin_query: routeOriginLabel(route) || f.origin_query,
      destination_query: routeDestinationLabel(route) || f.destination_query,
      origin_lat: originG?.center_lat != null ? Number(originG.center_lat).toFixed(6) : f.origin_lat,
      origin_lng: originG?.center_lng != null ? Number(originG.center_lng).toFixed(6) : f.origin_lng,
      dest_lat: destG?.center_lat != null ? Number(destG.center_lat).toFixed(6) : f.dest_lat,
      dest_lng: destG?.center_lng != null ? Number(destG.center_lng).toFixed(6) : f.dest_lng,
      use_origin_coords: originG?.center_lat != null || f.use_origin_coords,
      use_dest_coords: destG?.center_lat != null || f.use_dest_coords,
    }));
    setPreview(built);
    setCorridorManual(!!built.alt_corridors?.[0]?.corridor_manual);
  }, [geofences, routes]);

  const startEdit = (g) => {
    setManualDrawMode(null);
    setManualCircleDraft(null);
    setManualPolygonDraft(null);
    setMapTool('pan');
    setWorkflowStep('manage');
    setEditColor(geofenceDisplayColor(g));
    setEditUndoStack([]);
    const isHaulRoadLeg = g.contractor_route_id && ['origin', 'destination', 'corridor', 'corridor_alt'].includes(g.leg);
    if (isHaulRoadLeg) {
      loadHaulRoadPreviewForManage(g.contractor_route_id);
    } else {
      setPreview(null);
    }
    const ring = parsePolygonJson(g.polygon_json);
    if (ring?.length >= 3) {
      setEditing(g);
      setEditRing(ring.map((p) => ({ ...p })));
      setEditCenter(null);
      setEditRadius(String(g.radius_m || 500));
      requestMapFit(positionsFromGeofence(g));
      return;
    }
    if (g.center_lat != null && g.center_lng != null) {
      setEditing(g);
      setEditRing(null);
      setEditCenter({ lat: g.center_lat, lng: g.center_lng });
      setEditRadius(String(g.radius_m || 500));
      requestMapFit(positionsFromGeofence(g));
    }
  };

  const expandEditGeofence = (extraM) => {
    pushEditUndo();
    if (editRing?.length >= 3) {
      setEditRing(expandPolygonRing(editRing, extraM));
      return;
    }
    if (editCenter) {
      setEditRadius(String(Math.round((Number(editRadius) || 500) + extraM)));
    }
  };

  const scaleEditGeofence = (factor) => {
    pushEditUndo();
    if (editRing?.length >= 3) {
      setEditRing(scalePolygonRing(editRing, factor));
    } else if (editCenter) {
      setEditRadius(String(clampRadius((Number(editRadius) || 500) * factor)));
    }
  };

  const scaleMapDraft = (factor) => {
    if (editing) {
      scaleEditGeofence(factor);
      return;
    }
    pushDraftUndo();
    if (manualPolygonDraft?.ring?.length >= 3) {
      setManualPolygonDraft({ ring: scalePolygonRing(manualPolygonDraft.ring, factor) });
      return;
    }
    if (manualCircleDraft) {
      setManualCircleDraft({
        ...manualCircleDraft,
        radius_m: clampRadius((manualCircleDraft.radius_m || 500) * factor),
      });
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditRing(null);
    setEditCenter(null);
    setEditUndoStack([]);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    setError('');
    try {
      const body = {
        alert_on_exit: editing.alert_on_exit,
        alert_on_entry: editing.alert_on_entry,
      };
      if (editRing?.length >= 3) {
        const meta = parseGeofenceMeta(editing.polygon_json);
        body.polygon_json = mergeColorIntoPolygonJson(editing.polygon_json, editRing, {
          color: editColor,
          type: meta.type === 'corridor' ? 'corridor' : 'polygon',
          corridor_m: meta.corridor_m,
          route_polyline: meta.route_polyline,
        });
        body.center_lat = null;
        body.center_lng = null;
        body.radius_m = null;
      } else if (editCenter) {
        body.center_lat = editCenter.lat;
        body.center_lng = editCenter.lng;
        body.radius_m = Number(editRadius) || 500;
        body.polygon_json = colorMetaJson(editColor);
      }
      await trackingApi.geofences.update(editing.id, body);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err?.message || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const removeGeofence = async (id) => {
    if (!window.confirm('Remove this geofence?')) return;
    try {
      await trackingApi.geofences.delete(id);
      if (editing?.id === id) cancelEdit();
      load();
    } catch (err) {
      setError(err?.message || 'Delete failed');
    }
  };

  const saveAlertZone = async (e) => {
    e.preventDefault();
    const coords = parseLatLngPair(alertForm.center_lat, alertForm.center_lng);
    if (!coords) {
      setError('Enter valid latitude and longitude, or click the map to place the zone.');
      return;
    }
    if (!alertForm.name.trim()) {
      setError('Name the alert zone (e.g. High risk bridge).');
      return;
    }
    const preset = ALERT_ZONE_TYPES[Number(alertForm.zone_type)] || ALERT_ZONE_TYPES[0];
    setSavingAlert(true);
    setError('');
    try {
      await trackingApi.geofences.create({
        name: alertForm.name.trim(),
        fence_type: preset.value,
        leg: 'alert',
        contractor_route_id: alertForm.contractor_route_id || null,
        center_lat: coords.lat,
        center_lng: coords.lng,
        radius_m: Number(alertForm.radius_m) || preset.radius,
        alert_on_entry: alertForm.alert_on_entry,
        alert_on_exit: alertForm.alert_on_exit,
      });
      setAlertForm({
        name: '',
        zone_type: '0',
        contractor_route_id: alertForm.contractor_route_id,
        center_lat: '',
        center_lng: '',
        radius_m: String(preset.radius),
        alert_on_entry: true,
        alert_on_exit: false,
      });
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to save alert zone');
    } finally {
      setSavingAlert(false);
    }
  };

  const applyAlertPreset = (idx) => {
    const preset = ALERT_ZONE_TYPES[idx] || ALERT_ZONE_TYPES[0];
    setAlertForm((f) => ({
      ...f,
      zone_type: String(idx),
      radius_m: String(preset.radius),
      alert_on_entry: preset.alert_on_entry,
      alert_on_exit: preset.alert_on_exit,
    }));
  };

  const routeMarkers = useMemo(() => {
    const endpointRadius = Number(drawForm.endpoint_radius_m) || 500;
    const pointA = hasValidCoords(drawForm.origin_lat, drawForm.origin_lng)
      ? parseLatLngPair(drawForm.origin_lat, drawForm.origin_lng)
      : preview?.origin || null;
    const pointB = hasValidCoords(drawForm.dest_lat, drawForm.dest_lng)
      ? parseLatLngPair(drawForm.dest_lat, drawForm.dest_lng)
      : preview?.destination || null;
    if (!pointA && !pointB) return null;
    return { pointA, pointB, endpointRadius };
  }, [drawForm.origin_lat, drawForm.origin_lng, drawForm.dest_lat, drawForm.dest_lng, drawForm.endpoint_radius_m, preview]);

  const haulRoadSetups = useMemo(() => {
    const byRoute = new Map();
    for (const g of geofences) {
      if (!g.contractor_route_id) continue;
      if (!['origin', 'destination', 'corridor', 'corridor_alt'].includes(g.leg)) continue;
      if (!byRoute.has(g.contractor_route_id)) {
        byRoute.set(g.contractor_route_id, {
          routeId: g.contractor_route_id,
          name: g.contractor_route_name || 'Route',
          geofences: [],
        });
      }
      byRoute.get(g.contractor_route_id).geofences.push(g);
    }
    return [...byRoute.values()].filter((s) => s.geofences.some((g) => g.leg === 'corridor'));
  }, [geofences]);

  const savedHaulRoadForForm = useMemo(
    () => haulRoadSetups.find((s) => s.routeId === drawForm.contractor_route_id),
    [haulRoadSetups, drawForm.contractor_route_id]
  );

  const mapGeofences = useMemo(() => {
    let list = geofences;
    if (editing) list = list.filter((g) => g.id !== editing.id);
    if (preview && drawForm.contractor_route_id) {
      list = list.filter(
        (g) => !(g.contractor_route_id === drawForm.contractor_route_id && ['origin', 'destination', 'corridor', 'corridor_alt'].includes(g.leg))
      );
    }
    return list;
  }, [geofences, editing, preview, drawForm.contractor_route_id]);

  const otherGeofences = mapGeofences;

  if (loading) return <p className="text-sm text-surface-500">Loading geofences…</p>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Geofencing studio</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          First <strong>search and draw your land or site boundary</strong>, then define the <strong>haul road from point A to point B</strong> and link it to a route from{' '}
          <Link to="/access-management" className="text-brand-600 hover:underline">Access Management</Link>.
          Use <strong>Full screen</strong> for a larger map. While picking points or plotting a custom route, <strong>pan and zoom freely</strong>, then click or use <strong>Place at crosshair</strong> for precision.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {WORKFLOW_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => {
              setWorkflowStep(step.id);
              if (step.id === 'land') {
                setMapTool('draw');
                if (!manualDrawMode && !manualPolygonDraft && !manualCircleDraft) setManualDrawMode('polygon');
              } else {
                setMapTool('pan');
                setManualDrawMode(null);
              }
            }}
            className={`text-left rounded-xl border px-4 py-3 transition-colors flex-1 min-w-[200px] ${
              workflowStep === step.id
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 shadow-sm'
                : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'
            }`}
          >
            <span className="text-sm font-semibold text-surface-900 dark:text-surface-100">{step.label}</span>
            <span className="block text-[11px] text-surface-500 mt-0.5">{step.desc}</span>
          </button>
        ))}
      </nav>

      <GeofenceMapEditor
        geofences={otherGeofences}
        labelGeofences={geofences}
        preview={preview}
        editRing={editRing}
        editCenter={editCenter}
        editRadius={editRadius}
        editColor={editColor}
        editLeg={editing?.leg}
        editFenceType={editing?.fence_type}
        fitRevision={fitRevision}
        fitPositions={fitPositions}
        flyRevision={flyRevision}
        flyTarget={flyTarget}
        mapTool={mapTool}
        onMapToolChange={handleMapToolChange}
        onPlaceSelect={handlePlaceSelect}
        routeMarkers={workflowStep === 'road' || (workflowStep === 'manage' && preview) ? routeMarkers : null}
        alertPreview={!manualDrawMode && (mapClickTarget === 'alert' || alertPreview) ? alertPreview : null}
        mapClickMode={!!mapClickTarget && !manualDrawMode}
        onMapClick={handleMapClick}
        manualDrawMode={manualDrawMode}
        circleDrawPreview={circleDrawPreview}
        onCircleDrawPreview={setCircleDrawPreview}
        onCircleDrawComplete={handleCircleDrawComplete}
        manualCircleDraft={manualCircleDraft}
        onManualCircleDraftChange={setManualCircleDraft}
        polygonDrawPoints={polygonDrawPoints}
        onPolygonAddPoint={handlePolygonAddPoint}
        onPolygonDrawComplete={handlePolygonDrawComplete}
        freehandPreview={freehandPreview}
        onFreehandPreview={setFreehandPreview}
        onFreehandComplete={handleFreehandComplete}
        manualPolygonDraft={manualPolygonDraft}
        onManualPolygonDraftChange={(ring) => setManualPolygonDraft({ ring })}
        draftColor={geofenceColor}
        selectedGeofenceId={editing?.id}
        onGeofenceSelect={startEdit}
        onEditRingChange={setEditRing}
        onEditRadiusChange={(r) => setEditRadius(String(r))}
        onVertexDrag={(index, lat, lng) => {
          setEditRing((ring) => ring.map((p, i) => (i === index ? { lat, lng } : p)));
        }}
        onCenterDrag={(lat, lng) => setEditCenter({ lat, lng })}
        onEditSnapshot={pushEditUndo}
        onScaleDraft={scaleMapDraft}
        onDraftSnapshot={pushDraftUndo}
        routeCorridorM={Number(drawForm.corridor_m) || 400}
        manualRoutePlotActive={manualRoutePlotActive}
        manualRouteWaypoints={manualWaypoints}
        manualRouteSnapPreview={manualRouteSnapPreview}
        manualRouteSnapping={manualRouteSnapping}
        manualRouteLockEndpoints={manualRouteLockEndpoints}
        onManualRouteAddWaypoint={addManualWaypoint}
        onManualRouteInsertWaypoint={insertManualWaypointAt}
        onManualRouteMoveWaypoint={moveManualWaypoint}
        onManualRouteUndo={undoManualWaypoint}
      />

      {workflowStep === 'land' && (
        <ManualGeofencePanel
          routes={routes}
          drawMode={manualDrawMode}
          onDrawModeChange={setDrawMode}
          circle={manualCircleDraft}
          onCircleChange={setManualCircleDraft}
          circlePreview={circleDrawPreview}
          polygonPoints={polygonDrawPoints}
          onPolygonPointsChange={(pts) => polygonPointsUndo.replace(pts)}
          onPolygonUndo={() => polygonPointsUndo.undo()}
          onPolygonRedo={() => polygonPointsUndo.redo()}
          onPolygonClear={() => polygonPointsUndo.reset([])}
          freehandPreview={freehandPreview}
          polygonDraft={manualPolygonDraft}
          onPolygonDraftChange={setManualPolygonDraft}
          color={geofenceColor}
          onColorChange={setGeofenceColor}
          setError={setError}
          onSaved={load}
        />
      )}

      {workflowStep === 'road' && (
        <section className="rounded-xl border border-surface-200 bg-white dark:bg-surface-900 dark:border-surface-800 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Haul road — point A to point B</h2>
              <p className="text-xs text-surface-500 mt-1 max-w-2xl">
                Edit every field below — addresses, coordinates, corridor width, and endpoints. Use <strong>Pick</strong> on the map or type lat/lng directly, then draw or redraw the road.
              </p>
            </div>
            {savedHaulRoadForForm && !preview && (
              <button
                type="button"
                onClick={() => loadHaulRoadFromSaved(drawForm.contractor_route_id)}
                disabled={drawing}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-400 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              >
                Load saved setup
              </button>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-surface-500">Link to system route</label>
              <select
                className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
                value={drawForm.contractor_route_id}
                onChange={(e) => {
                  setDrawForm((f) => ({ ...f, contractor_route_id: e.target.value }));
                  clearHaulRoadPreview();
                }}
              >
                <option value="">— Select route —</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {haulRoadSetups.length > 0 && (
                <p className="text-[10px] text-surface-400 mt-1">
                  {haulRoadSetups.length} route{haulRoadSetups.length === 1 ? '' : 's'} with saved haul-road geofences
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PickedPointRow
                label="Point A — loading"
                color="#2563eb"
                coords={pointACoords}
                active={mapClickTarget === 'origin'}
                onPick={() => { setMapTool('pick'); setMapClickTarget('origin'); }}
                onClear={clearPointA}
                onZoomTo={() => pointACoords && flyToPlace({ ...pointACoords, zoom: 18 })}
              />
              <PickedPointRow
                label="Point B — destination"
                color="#059669"
                coords={pointBCoords}
                active={mapClickTarget === 'destination'}
                onPick={() => { setMapTool('pick'); setMapClickTarget('destination'); }}
                onClear={clearPointB}
                onZoomTo={() => pointBCoords && flyToPlace({ ...pointBCoords, zoom: 18 })}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-surface-500">Point A — loading address</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
                placeholder="Loading address or site name"
                value={drawForm.origin_query}
                onChange={(e) => { setDrawForm((f) => ({ ...f, origin_query: e.target.value })); setHaulRoadDirty(true); }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-surface-500">Point B — destination address</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
                placeholder="Destination address or site name"
                value={drawForm.destination_query}
                onChange={(e) => { setDrawForm((f) => ({ ...f, destination_query: e.target.value })); setHaulRoadDirty(true); }}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <fieldset className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
              <legend className="text-xs font-semibold text-surface-600 px-1">Point A coordinates</legend>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-surface-500">Latitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full mt-0.5 rounded border px-2 py-1.5 text-sm font-mono dark:bg-surface-950"
                    placeholder="-26.123456"
                    value={drawForm.origin_lat}
                    onChange={(e) => updateOriginCoords(e.target.value, drawForm.origin_lng)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-surface-500">Longitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full mt-0.5 rounded border px-2 py-1.5 text-sm font-mono dark:bg-surface-950"
                    placeholder="28.123456"
                    value={drawForm.origin_lng}
                    onChange={(e) => updateOriginCoords(drawForm.origin_lat, e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2">
              <legend className="text-xs font-semibold text-surface-600 px-1">Point B coordinates</legend>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-surface-500">Latitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full mt-0.5 rounded border px-2 py-1.5 text-sm font-mono dark:bg-surface-950"
                    placeholder="-26.123456"
                    value={drawForm.dest_lat}
                    onChange={(e) => updateDestCoords(e.target.value, drawForm.dest_lng)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-surface-500">Longitude</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full mt-0.5 rounded border px-2 py-1.5 text-sm font-mono dark:bg-surface-950"
                    placeholder="28.123456"
                    value={drawForm.dest_lng}
                    onChange={(e) => updateDestCoords(drawForm.dest_lat, e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-surface-500">Corridor width (m)</label>
              <input
                type="range"
                min="150"
                max="1200"
                step="50"
                className="w-full mt-2"
                value={drawForm.corridor_m}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDrawForm((f) => ({ ...f, corridor_m: String(v) }));
                  if (preview) adjustCorridorWidth(v);
                }}
              />
              <p className="text-xs text-surface-500">{drawForm.corridor_m} m total width</p>
            </div>
            <div>
              <label className="text-xs text-surface-500">Endpoint radius at A &amp; B (m)</label>
              <input
                type="number"
                min="100"
                max="5000"
                step="50"
                className="w-full mt-1 rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
                value={drawForm.endpoint_radius_m}
                onChange={(e) => setDrawForm((f) => ({ ...f, endpoint_radius_m: e.target.value }))}
              />
            </div>
          </div>

          {haulRoadDirty && preview && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
              Points or addresses changed — click <strong>Redraw haul road</strong> to refresh routes and corridors on the map.
            </p>
          )}
          {preview && (
            <ManualRoutePlotPanel
              active={manualRoutePlotActive}
              editingRouteLabel={
                editingManualRouteIndex != null
                  ? (preview.alternatives?.[editingManualRouteIndex]?.manual_label || 'Custom route')
                  : null
              }
              waypoints={manualWaypoints}
              snapPreview={manualRouteSnapPreview}
              snapping={manualRouteSnapping}
              label={manualRouteLabel}
              onLabelChange={setManualRouteLabel}
              onStart={startManualRoutePlot}
              onCancel={cancelManualRoutePlot}
              onUndo={() => undoManualWaypoint()}
              onClear={() => setManualWaypoints([])}
              onSeedFromAB={seedManualRouteFromAB}
              onRemoveWaypoint={removeManualWaypointAt}
              onInsertWaypointAfter={insertManualWaypointAfter}
              onUpdateWaypointCoords={updateManualWaypointCoords}
              onFinalize={finalizeManualRoute}
              finalizing={manualRouteFinalizing}
              canSeedFromAB={!!pointACoords && !!pointBCoords}
            />
          )}
          {preview?.alternatives?.length >= 1 && (
            <AlternativeRoutesPanel
              preview={preview}
              onSetPrimary={setPrimaryAlternativeRoute}
              onToggleOption={toggleAltGeofence}
              onIncludeAll={includeAllRouteOptions}
              onExcludeAll={excludeAllRouteOptions}
              onZoomRoute={zoomRouteOption}
              onZoomAll={zoomAllRouteOptions}
              onRemoveManual={removeManualAlternative}
              onEditManual={startEditManualRoute}
              onStartPlotManual={startManualRoutePlot}
              systemRouteDistanceKm={selectedSystemRoute?.distance_km}
            />
          )}
          {preview?.corridor_polygon?.length >= 3 && (
            <div className="flex flex-wrap gap-2 text-xs items-center">
              <span className="text-surface-500">Primary corridor width:</span>
              <button type="button" onClick={() => expandCorridorOnMap(50)} className="px-2.5 py-1 rounded-md border">+50 m</button>
              <button type="button" onClick={() => expandCorridorOnMap(100)} className="px-2.5 py-1 rounded-md border">+100 m</button>
              <button type="button" onClick={resetCorridorShape} className="px-2.5 py-1 rounded-md border">Reset to road</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => drawRouteOnMap()} disabled={drawing} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
              {drawing ? 'Scanning roads…' : preview ? 'Rescan all routes A → B' : 'Find all routes A → B'}
            </button>
            {preview && (
              <button type="button" onClick={clearHaulRoadPreview} className="rounded-lg border px-4 py-2 text-sm">
                Clear preview
              </button>
            )}
            {preview && (() => {
              const primary = preview.selected_route_index ?? 0;
              const altCount = Object.entries(preview.alt_corridors || {}).filter(([i, c]) => c.enabled && Number(i) !== primary).length;
              return (
                <button type="button" onClick={saveDrawnRoute} disabled={drawing} className="rounded-lg border border-emerald-600 text-emerald-700 px-4 py-2 text-sm font-medium">
                  Save route geofences (A + corridor{altCount ? ` + ${altCount} alt road${altCount === 1 ? '' : 's'}` : ''} + B)
                </button>
              );
            })()}
          </div>
        </section>
      )}

      {workflowStep === 'manage' && !editing && (
        <div className="rounded-xl border border-surface-200 bg-white dark:bg-surface-900 dark:border-surface-800 overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-semibold">Saved geofences — click one on the map to edit</div>
          {haulRoadSetups.length > 0 && (
            <div className="px-4 py-3 border-b bg-surface-50/80 dark:bg-surface-900/40 space-y-2">
              <p className="text-xs font-semibold text-surface-600">Saved haul roads (A → B)</p>
              {haulRoadSetups.map((setup) => {
                const altCount = setup.geofences.filter((g) => g.leg === 'corridor_alt').length;
                const routeKm = haulRoadSetupDistanceKm(setup, routes);
                const originG = setup.geofences.find((g) => g.leg === 'origin');
                const destG = setup.geofences.find((g) => g.leg === 'destination');
                const route = routes.find((r) => r.id === setup.routeId);
                const pointA = routeOriginLabel(route) || originG?.name?.replace(/^.*—\s*/, '') || 'A';
                const pointB = routeDestinationLabel(route) || destG?.name?.replace(/^.*—\s*/, '') || 'B';
                return (
                  <div key={setup.routeId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {setup.name}
                      <span className="ml-2 text-xs text-surface-500">
                        {pointA} → {pointB}
                        {routeKm != null && ` · ${formatRouteDistanceKm(routeKm)}`}
                      </span>
                      {altCount > 0 && (
                        <span className="ml-2 text-xs text-cyan-700 dark:text-cyan-300">+ {altCount} alt road{altCount === 1 ? '' : 's'}</span>
                      )}
                    </span>
                    <div className="flex gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => loadHaulRoadPreviewForManage(setup.routeId)}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Show on map
                      </button>
                      <button
                        type="button"
                        onClick={() => loadHaulRoadFromSaved(setup.routeId)}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Edit A→B setup
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <ul className="divide-y max-h-[24rem] overflow-y-auto">
            {geofences.map((g) => {
              const isPoly = !!parsePolygonJson(g.polygon_json)?.length;
              return (
                <li key={g.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: geofenceDisplayColor(g) }} />
                        {g.name}
                      </p>
                      <p className="text-xs text-surface-500">
                        {g.contractor_route_name || '—'} · {g.leg === 'corridor_alt' ? 'alt road corridor' : (g.leg || g.fence_type)}
                        {isPoly ? ' · area/corridor' : ` · ${g.radius_m}m`}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => startEdit(g)} className="text-xs text-brand-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => removeGeofence(g.id)} className="text-xs text-rose-600 hover:underline">Remove</button>
                    </div>
                  </div>
                </li>
              );
            })}
            {geofences.length === 0 && <li className="px-4 py-6 text-surface-500 text-sm">No geofences yet. Start with step 1 to draw a land area.</li>}
          </ul>
        </div>
      )}

      {editing && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 dark:bg-brand-950/30 dark:border-brand-900 px-4 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                Editing <strong>{editing.name}</strong>
              </p>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
                {editRing
                  ? 'Drag the large corner handles on the map. Use Undo or expand/scale below — Pan map to move the view.'
                  : 'Drag the blue centre or orange edge handle. Undo restores the previous shape.'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {editUndoStack.length > 0 && (
                <button type="button" onClick={undoEdit} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300">
                  Undo
                </button>
              )}
              <button type="button" onClick={cancelEdit} className="px-3 py-1.5 text-sm rounded-lg border">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={savingEdit} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white disabled:opacity-50">
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <GeofenceColorPicker value={editColor} onChange={setEditColor} className="min-w-[200px]" />
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-surface-500 font-medium">Expand:</span>
              <button type="button" onClick={() => expandEditGeofence(50)} className="px-2.5 py-1 rounded-md border border-brand-300 text-brand-800 hover:bg-brand-100">+50 m</button>
              <button type="button" onClick={() => expandEditGeofence(100)} className="px-2.5 py-1 rounded-md border border-brand-300 text-brand-800 hover:bg-brand-100">+100 m</button>
              <button type="button" onClick={() => expandEditGeofence(250)} className="px-2.5 py-1 rounded-md border border-brand-300 text-brand-800 hover:bg-brand-100">+250 m</button>
              <span className="text-surface-500 font-medium ml-2">Scale:</span>
              <button type="button" onClick={() => scaleEditGeofence(1.1)} className="px-2.5 py-1 rounded-md border border-surface-300 hover:bg-white dark:hover:bg-surface-800">110%</button>
              <button type="button" onClick={() => scaleEditGeofence(0.9)} className="px-2.5 py-1 rounded-md border border-surface-300 hover:bg-white dark:hover:bg-surface-800">90%</button>
            </div>
            {!editRing && (
              <label className="text-sm flex items-center gap-2 ml-auto">
                Radius (m)
                <input
                  type="number"
                  min="30"
                  className="w-28 rounded border px-2 py-1 text-sm font-mono dark:bg-surface-950"
                  value={editRadius}
                  onChange={(e) => setEditRadius(e.target.value)}
                />
              </label>
            )}
          </div>
        </div>
      )}

      <section className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/10 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Alert zones</h2>
          <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
            Small geofences for high-risk areas, crime hotspots, or no-stop zones. Trucks entering trigger email alerts and alarm records.
            Optional route link — leave blank to monitor all trucks on the tenant.
          </p>
        </div>
        <PickedPointRow
          label="Alert zone centre"
          color="#e11d48"
          coords={alertPreview}
          active={mapClickTarget === 'alert'}
          onPick={() => { setMapTool('pick'); setMapClickTarget('alert'); }}
          onClear={clearAlertPick}
        />
        <form onSubmit={saveAlertZone} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            placeholder="Zone name (e.g. High risk N12)"
            value={alertForm.name}
            onChange={(e) => setAlertForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            value={alertForm.zone_type}
            onChange={(e) => applyAlertPreset(Number(e.target.value))}
          >
            {ALERT_ZONE_TYPES.map((t, i) => (
              <option key={`${t.label}-${i}`} value={i}>{t.label}</option>
            ))}
          </select>
          <select
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            value={alertForm.contractor_route_id}
            onChange={(e) => setAlertForm((f) => ({ ...f, contractor_route_id: e.target.value }))}
          >
            <option value="">All routes (tenant-wide)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <input
            className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950"
            placeholder="Latitude"
            value={alertForm.center_lat}
            onChange={(e) => setAlertForm((f) => ({ ...f, center_lat: e.target.value }))}
          />
          <input
            className="rounded-lg border px-3 py-2 text-sm font-mono dark:bg-surface-950"
            placeholder="Longitude"
            value={alertForm.center_lng}
            onChange={(e) => setAlertForm((f) => ({ ...f, center_lng: e.target.value }))}
          />
          <input
            type="number"
            min="50"
            max="2000"
            className="rounded-lg border px-3 py-2 text-sm dark:bg-surface-950"
            placeholder="Radius (m)"
            value={alertForm.radius_m}
            onChange={(e) => setAlertForm((f) => ({ ...f, radius_m: e.target.value }))}
          />
          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={alertForm.alert_on_entry} onChange={(e) => setAlertForm((f) => ({ ...f, alert_on_entry: e.target.checked }))} />
              Alert on entry
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={alertForm.alert_on_exit} onChange={(e) => setAlertForm((f) => ({ ...f, alert_on_exit: e.target.checked }))} />
              Alert on exit
            </label>
            <button
              type="submit"
              disabled={savingAlert}
              className="ml-auto rounded-lg bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
            >
              {savingAlert ? 'Saving…' : 'Save alert zone'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
