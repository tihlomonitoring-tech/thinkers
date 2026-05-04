/** Keys must match server `FUEL_EXPORT_KEYS` in src/routes/fuelData.js */
export const FUEL_EXPORT_COLUMN_OPTIONS = [
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'vehicle_tank', label: 'Vehicle / tank' },
  { key: 'order_number', label: 'Order No.' },
  { key: 'vehicle_registration', label: 'Customer vehicle (fleet)' },
  { key: 'supplier_vehicle_registration', label: 'Supplier vehicle' },
  { key: 'delivery_time', label: 'Delivery time' },
  { key: 'kilos', label: 'Kilos' },
  { key: 'responsible_user_name', label: 'Responsible user' },
  { key: 'pump_start', label: 'Pump start' },
  { key: 'pump_stop', label: 'Pump stop' },
  { key: 'liters_filled', label: 'Liters' },
  { key: 'price_per_litre', label: 'R/L' },
  { key: 'amount_rand', label: 'Amount (ZAR)' },
  { key: 'fuel_attendant_name', label: 'Attendant' },
  { key: 'authorizer_name', label: 'Authorizer' },
  { key: 'source', label: 'Source' },
];

export const DEFAULT_EXPORT_COLUMN_KEYS = FUEL_EXPORT_COLUMN_OPTIONS.map((o) => o.key);

export function orderExportColumnKeys(keys) {
  const set = new Set(keys);
  return FUEL_EXPORT_COLUMN_OPTIONS.map((o) => o.key).filter((k) => set.has(k));
}
