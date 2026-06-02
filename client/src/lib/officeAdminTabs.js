export const OA_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'asset_register', label: 'Asset register', icon: 'box', section: 'Operations' },
  { id: 'consumables', label: 'Coffee, tea & supplies', icon: 'cup', section: 'Operations' },
  { id: 'maintenance_reports', label: 'Maintenance reports', icon: 'inbox', section: 'Maintenance' },
  { id: 'maintenance_history', label: 'Maintenance history', icon: 'history', section: 'Maintenance' },
  { id: 'maintenance_report_broken', label: 'Report faulty item', icon: 'alert', section: 'Maintenance' },
  { id: 'maintenance_record', label: 'Record maintenance', icon: 'wrench', section: 'Maintenance' },
  { id: 'office_requests', label: 'Office requests', icon: 'inbox', section: 'Operations' },
  { id: 'office_manager', label: 'Office manager', icon: 'manager', section: 'Management' },
  { id: 'accounting_link', label: 'Accounting link', icon: 'calc', section: 'Finance' },
  { id: 'manage_access', label: 'Manage tab access', icon: 'settings', section: 'Settings' },
];

export const OA_TAB_IDS = OA_TABS.map((t) => t.id);

export const CONSUMABLE_CATEGORIES = [
  { value: 'coffee', label: 'Coffee' },
  { value: 'tea', label: 'Tea' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'other', label: 'Other' },
];

export const MAINTENANCE_TAB_IDS = [
  'maintenance_reports',
  'maintenance_history',
  'maintenance_report_broken',
  'maintenance_record',
];

export const FAULT_CATEGORIES = [
  { value: '', label: '—' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'it', label: 'IT / equipment' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
];

export const MAINTENANCE_TYPES = [
  { value: 'repair', label: 'Repair' },
  { value: 'preventive', label: 'Preventive' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'replacement', label: 'Replacement' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'other', label: 'Other' },
];

export const PROVIDER_TYPES = [
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'External contractor' },
];

export const REPORT_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const REPORT_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_parts', label: 'Waiting for parts' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export const REQUEST_TYPES = [
  { value: 'supplies', label: 'Supplies' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'it', label: 'IT / equipment' },
  { value: 'general', label: 'General' },
];
