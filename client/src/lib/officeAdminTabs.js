export const OA_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'asset_register', label: 'Asset register', icon: 'box', section: 'Operations' },
  { id: 'consumables', label: 'Coffee, tea & supplies', icon: 'cup', section: 'Operations' },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench', section: 'Operations' },
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

export const REQUEST_TYPES = [
  { value: 'supplies', label: 'Supplies' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'it', label: 'IT / equipment' },
  { value: 'general', label: 'General' },
];
