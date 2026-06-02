/** Shared consumable field lists for Office Admin supplies */

import { toYmdFromDbOrString } from './appTime.js';

export const CONSUMABLE_DATE_FIELDS = [
  'last_purchase_date',
  'restock_date',
  'expiry_date',
  'opened_date',
];

export const CONSUMABLE_UUID_FIELDS = [
  'accounting_item_id',
  'budget_id',
  'budget_category_id',
  'budget_line_item_id',
];

export const CONSUMABLE_WRITABLE_FIELDS = [
  'name',
  'category',
  'unit',
  'quantity_on_hand',
  'reorder_level',
  'unit_cost',
  'accounting_item_id',
  'budget_id',
  'budget_category_id',
  'budget_line_item_id',
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

export function normalizeConsumableDate(v) {
  if (v == null || v === '') return null;
  const ymd = toYmdFromDbOrString(v);
  return ymd || null;
}

export function normalizeConsumableUuid(v) {
  if (v == null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

export function normalizeConsumableField(col, value) {
  if (CONSUMABLE_DATE_FIELDS.includes(col)) return normalizeConsumableDate(value);
  if (CONSUMABLE_UUID_FIELDS.includes(col)) return normalizeConsumableUuid(value);
  return value;
}

export function pickConsumableBody(b) {
  const out = {};
  for (const col of CONSUMABLE_WRITABLE_FIELDS) {
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let val;
    if (b[col] !== undefined) val = b[col];
    else if (b[camel] !== undefined) val = b[camel];
    else continue;
    out[col] = normalizeConsumableField(col, val);
  }
  if (out.is_perishable !== undefined) {
    out.is_perishable = out.is_perishable === true || out.is_perishable === 1 || out.is_perishable === '1';
  }
  return out;
}
