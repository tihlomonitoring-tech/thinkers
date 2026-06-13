export const TRACKING_TABS = [
  { id: 'geofence', label: 'Geofence routes', description: 'Map geofences on Access Management routes' },
  { id: 'integration', label: 'Fleet integration', description: 'Cartrack, FleetCam & unit links' },
  { id: 'activity', label: 'Logistics Activity', description: 'Schedule loads · slips · stage board' },
  { id: 'monitor', label: 'Monitor', description: 'Live fleet map' },
  { id: 'deliveries', label: 'Completed deliveries', description: 'Delivery notes for Command Centre' },
];

export const TRACKING_TAB_IDS = TRACKING_TABS.map((t) => t.id);

export const TRACKING_TAB_LABELS = Object.fromEntries(TRACKING_TABS.map((t) => [t.id, t.label]));
