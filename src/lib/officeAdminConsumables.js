/** Shared consumable field lists for Office Admin supplies */

export const CONSUMABLE_WRITABLE_FIELDS = [
  'name',
  'category',
  'unit',
  'quantity_on_hand',
  'reorder_level',
  'unit_cost',
  'accounting_item_id',
  'notes',
  'brand',
  'sku',
  'storage_location',
  'purchase_location',
  'supplier_name',
  'capacity',
  'capacity_amount',
  'capacity_unit',
  'last_purchase_date',
  'last_purchase_price',
  'restock_date',
  'expiry_date',
  'opened_date',
  'max_stock_level',
  'is_perishable',
  'batch_number',
];

export function pickConsumableBody(b) {
  const out = {};
  for (const col of CONSUMABLE_WRITABLE_FIELDS) {
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (b[col] !== undefined) out[col] = b[col];
    else if (b[camel] !== undefined) out[col] = b[camel];
  }
  if (out.is_perishable !== undefined) {
    out.is_perishable = out.is_perishable === true || out.is_perishable === 1 || out.is_perishable === '1';
  }
  return out;
}
