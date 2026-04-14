/** Sidebar tabs for Fuel supply management — ids must match server FS_TAB_IDS. */
export const FS_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'administration', label: 'Administration', icon: 'doc', section: 'Diesel supply' },
  { id: 'supply_activities', label: 'Supply activities', icon: 'activity', section: 'Diesel supply' },
  { id: 'activity_log', label: 'Activity log', icon: 'list', section: 'Diesel supply' },
  { id: 'delivery_vehicle_log_book', label: 'Delivery vehicle log book', icon: 'book', section: 'Fleet' },
  { id: 'delivery_management', label: 'Delivery management', icon: 'truck', section: 'Diesel supply' },
  { id: 'reconciliations', label: 'Reconciliations', icon: 'calc', section: 'Finance' },
  { id: 'production_vs_expenses', label: 'Production vs expenses', icon: 'trend', section: 'Finance' },
];

export const GRANT_TAB_IDS = FS_TABS.map((t) => t.id);
