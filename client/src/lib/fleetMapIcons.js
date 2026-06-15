import L from 'leaflet';

export const FLEET_STATUS_COLORS = {
  enroute: '#22c55e',
  overdue: '#ef4444',
  deviated: '#f59e0b',
  pending: '#38bdf8',
  default: '#6366f1',
};

export function fleetStatusColor(status) {
  return FLEET_STATUS_COLORS[String(status || '').toLowerCase()] || FLEET_STATUS_COLORS.default;
}

/** Green when moving, amber when slow/stopped — similar to FleetCam object list dots. */
export function fleetMotionColor(trip) {
  const speed = Number(trip?.last_speed_kmh);
  if (Number.isFinite(speed)) {
    if (speed >= 5) return '#22c55e';
    if (speed > 0) return '#eab308';
    return '#ef4444';
  }
  const status = String(trip?.status || '').toLowerCase();
  if (status === 'enroute') return '#22c55e';
  if (status === 'overdue' || status === 'deviated') return fleetStatusColor(status);
  return '#94a3b8';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * FleetCam-style directional vehicle marker.
 * Arrow points north at 0° and rotates with GPS course/heading.
 */
export function fleetCamVehicleIcon(trip, { selected = false, showLabel = true } = {}) {
  const color = fleetMotionColor(trip);
  const heading = Number.isFinite(Number(trip?.last_heading_deg)) ? Number(trip.last_heading_deg) : 0;
  const reg = escapeHtml(trip?.truck_registration || 'Unit');
  const speed = Number(trip?.last_speed_kmh);
  const speedLabel = Number.isFinite(speed) ? `${Math.round(speed)} KM/H` : '— KM/H';
  const extra = trip?._labelExtra ? escapeHtml(trip._labelExtra) : '';
  const label = showLabel ? `${reg} (${speedLabel})${extra}` : '';
  const selectedRing = selected
    ? `<circle cx="20" cy="20" r="19" fill="none" stroke="#38bdf8" stroke-width="2.5" opacity="0.95"/>`
    : '';

  const html = `
    <div class="fleet-cam-marker${selected ? ' fleet-cam-marker--selected' : ''}">
      <div class="fleet-cam-marker__arrow-wrap" style="transform: rotate(${heading}deg);">
        <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
          ${selectedRing}
          <circle cx="20" cy="20" r="16" fill="rgba(15,23,42,0.55)" stroke="${color}" stroke-width="2"/>
          <path fill="${color}" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round"
            d="M20 6 L30 28 L24 28 L24 34 L16 34 L16 28 L10 28 Z"/>
        </svg>
      </div>
      ${label ? `<span class="fleet-cam-marker__label">${label}</span>` : ''}
    </div>
  `;

  return L.divIcon({
    className: 'fleet-cam-marker-icon',
    html,
    iconSize: [label ? 160 : 40, label ? 56 : 40],
    iconAnchor: [label ? 80 : 18, label ? 28 : 18],
    popupAnchor: [0, -20],
  });
}

/** @deprecated Use fleetCamVehicleIcon — kept for geofence editor compatibility */
export function fleetTruckIcon(status, headingDeg) {
  return fleetCamVehicleIcon(
    { status, last_heading_deg: headingDeg, last_speed_kmh: status === 'enroute' ? 60 : 0, truck_registration: '' },
    { showLabel: false }
  );
}
