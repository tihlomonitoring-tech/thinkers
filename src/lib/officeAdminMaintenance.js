export const MAINTENANCE_TAB_IDS = [
  'maintenance_reports',
  'maintenance_history',
  'maintenance_report_broken',
  'maintenance_record',
];

export const REPORT_WRITABLE_FIELDS = [
  'asset_id',
  'asset_name_snapshot',
  'title',
  'description',
  'priority',
  'status',
  'manager_notes',
  'location',
  'fault_category',
  'reporter_contact',
  'preferred_visit_date',
  'safety_risk',
  'external_reference',
  'assigned_to',
  'work_order_number',
  'provider_type',
];

export const RECORD_WRITABLE_FIELDS = [
  'asset_id',
  'report_id',
  'title',
  'maintenance_type',
  'description',
  'cost',
  'performed_by',
  'performed_at',
  'next_due_at',
  'accounting_reference',
  'provider_type',
  'vendor_name',
  'vendor_contact',
  'vendor_phone',
  'labor_hours',
  'parts_used',
  'invoice_reference',
  'work_order_number',
  'asset_location_snapshot',
];

export function pickBody(b, fields) {
  const out = {};
  for (const col of fields) {
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (b[col] !== undefined) out[col] = b[col];
    else if (b[camel] !== undefined) out[col] = b[camel];
  }
  if (out.safety_risk !== undefined) {
    out.safety_risk = out.safety_risk === true || out.safety_risk === 1 || out.safety_risk === '1';
  }
  return out;
}

export function mapMaintAttachmentRow(row, get) {
  if (!row) return null;
  const mime = String(get(row, 'mime_type') || '').toLowerCase();
  const kind = get(row, 'file_kind') || (mime.startsWith('image/') ? 'photo' : 'document');
  return {
    id: get(row, 'id'),
    original_name: get(row, 'original_name'),
    mime_type: get(row, 'mime_type'),
    file_kind: kind,
    caption: get(row, 'caption'),
    created_at: get(row, 'created_at'),
  };
}

export function normalizeOaTabs(tabs) {
  let list = [...(tabs || [])];
  if (list.includes('maintenance')) {
    list = list.filter((t) => t !== 'maintenance');
    for (const id of MAINTENANCE_TAB_IDS) {
      if (!list.includes(id)) list.push(id);
    }
  }
  return list;
}
