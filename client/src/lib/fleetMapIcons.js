import L from 'leaflet';

export const FLEET_STATUS_COLORS = {
  enroute: '#10b981',
  overdue: '#ef4444',
  deviated: '#f59e0b',
  pending: '#0ea5e9',
  default: '#6366f1',
};

export function fleetStatusColor(status) {
  return FLEET_STATUS_COLORS[String(status || '').toLowerCase()] || FLEET_STATUS_COLORS.default;
}

/** Top-down fleet truck marker; rotates with GPS heading (0° = north). */
export function fleetTruckIcon(status, headingDeg) {
  const color = fleetStatusColor(status);
  const heading = Number.isFinite(Number(headingDeg)) ? Number(headingDeg) : 0;
  const label = String(status || 'fleet').slice(0, 3).toUpperCase();

  const html = `
    <div class="fleet-truck-marker__shell">
      <div class="fleet-truck-marker__wrap" style="transform: rotate(${heading}deg);">
        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="${color}" stroke-width="2.5" opacity="0.96"/>
          <path fill="${color}" d="M14 10h12c1.1 0 2 .9 2 2v1.5h3c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-1.1a3.2 3.2 0 01-6.1 0h-5.6a3.2 3.2 0 01-6.1 0H13c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5h1V12c0-1.1.9-2 2-2zm2 3.5v4h8v-4h-8zm-1 8.5a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zm14 0a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z"/>
          <rect x="16" y="12.5" width="8" height="3.5" rx="0.75" fill="#ffffff" opacity="0.9"/>
          <path fill="${color}" opacity="0.35" d="M14 18h12v5H14z"/>
        </svg>
      </div>
      <span class="fleet-truck-marker__badge" style="background:${color}">${label}</span>
    </div>
  `;

  return L.divIcon({
    className: 'fleet-truck-marker',
    html,
    iconSize: [44, 52],
    iconAnchor: [22, 26],
    popupAnchor: [0, -24],
  });
}
