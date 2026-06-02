/** Shared asset field lists for Office Admin asset register */

export const ASSET_WRITABLE_FIELDS = [
  'asset_code',
  'name',
  'category',
  'category_id',
  'location',
  'serial_number',
  'purchase_date',
  'purchase_value',
  'status',
  'manufacturer',
  'model',
  'supplier_name',
  'commissioned_date',
  'warranty_expiry_date',
  'expected_life_years',
  'useful_life_end_date',
  'disposal_date',
  'condition_status',
  'residual_value',
  'insurance_provider',
  'insurance_policy_number',
  'insurance_cover_type',
  'insurance_start_date',
  'insurance_expiry_date',
  'insurance_premium_annual',
  'insurance_contact',
  'insurance_notes',
  'accounting_item_id',
  'accounting_supplier_id',
  'notes',
];

export function pickAssetBody(b) {
  const out = {};
  for (const col of ASSET_WRITABLE_FIELDS) {
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (b[col] !== undefined) out[col] = b[col];
    else if (b[camel] !== undefined) out[col] = b[camel];
  }
  return out;
}

export function mapAttachmentRow(row, get) {
  if (!row) return null;
  const mime = String(get(row, 'mime_type') || '').toLowerCase();
  const kind = get(row, 'file_kind') || (mime.startsWith('image/') ? 'photo' : 'document');
  return {
    id: get(row, 'id'),
    asset_id: get(row, 'asset_id'),
    original_name: get(row, 'original_name'),
    mime_type: get(row, 'mime_type'),
    file_kind: kind,
    caption: get(row, 'caption'),
    uploaded_by_name: get(row, 'uploaded_by_name'),
    created_at: get(row, 'created_at'),
  };
}
