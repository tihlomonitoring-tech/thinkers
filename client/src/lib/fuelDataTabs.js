/** Fuel Data page tabs — ids must match server FD_TAB_IDS. */
export const FD_TABS = [
  { id: 'advanced_dashboard', label: 'Advanced dashboard', icon: 'dashboard', section: 'Operations' },
  { id: 'fuel_admin', label: 'Fuel Admin', icon: 'activity', section: 'Operations' },
  { id: 'file_export', label: 'File Export', icon: 'export', section: 'Operations' },
  { id: 'customer_details', label: 'Customer details', icon: 'list', section: 'Records' },
  { id: 'supplier_details', label: 'Supplier details', icon: 'doc', section: 'Records' },
  { id: 'analytics', label: 'Analytics', icon: 'trend', section: 'Insights' },
  { id: 'attendant_portal', label: 'Fuel Attendant portal', icon: 'truck', section: 'Field' },
];

export const GRANT_TAB_IDS = FD_TABS.map((t) => t.id);
