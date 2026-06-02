import {
  exportOfficeAdminExcel,
  exportOfficeAdminPdf,
  exportOfficeAdminTemplate,
  sliceDate,
  todayStamp,
} from './officeAdminExportTemplate.js';

export async function downloadAssetTemplate() {
  await exportOfficeAdminTemplate({
    sheetName: 'Assets',
    reportTitle: 'Office Admin — Asset register import template',
    headers: [
      'asset_code',
      'name',
      'category',
      'location',
      'serial_number',
      'purchase_date',
      'purchase_value',
      'status',
      'notes',
    ],
    exampleRows: [
      ['OFF-001', 'HP LaserJet Pro', 'IT', 'Reception', 'SN12345', '2024-01-15', '8500', 'active', ''],
    ],
    filename: 'office-assets-template.xlsx',
  });
}

export async function downloadConsumableTemplate() {
  await exportOfficeAdminTemplate({
    sheetName: 'Consumables',
    reportTitle: 'Office Admin — Coffee, tea & supplies import template',
    headers: [
      'name',
      'category',
      'unit',
      'quantity_on_hand',
      'reorder_level',
      'max_stock_level',
      'unit_cost',
      'brand',
      'sku',
      'capacity',
      'storage_location',
      'purchase_location',
      'supplier_name',
      'last_purchase_date',
      'last_purchase_price',
      'restock_date',
      'expiry_date',
      'opened_date',
      'is_perishable',
      'batch_number',
      'notes',
    ],
    exampleRows: [
      [
        'Arabica beans 1kg',
        'coffee',
        'bag',
        '10',
        '5',
        '20',
        '250',
        'House blend',
        'COF-001',
        '1 kg',
        'Kitchen cupboard',
        'Makro',
        'Makro',
        '2026-01-15',
        '249.99',
        '2026-01-15',
        '2027-01-15',
        '',
        '1',
        'LOT-A1',
        '',
      ],
    ],
    filename: 'office-consumables-template.xlsx',
  });
}

const ASSET_COLUMNS = [
  { header: 'Asset code', width: 14 },
  { header: 'Name', width: 22 },
  { header: 'Category', width: 14 },
  { header: 'Location', width: 16 },
  { header: 'Serial', width: 14 },
  { header: 'Manufacturer', width: 14 },
  { header: 'Model', width: 14 },
  { header: 'Purchase date', width: 12 },
  { header: 'Value (ZAR)', width: 12 },
  { header: 'Condition', width: 10 },
  { header: 'Commissioned', width: 12 },
  { header: 'Warranty expires', width: 12 },
  { header: 'Expected life (yrs)', width: 10 },
  { header: 'Useful life end', width: 12 },
  { header: 'Disposal date', width: 12 },
  { header: 'Insurer', width: 16 },
  { header: 'Policy number', width: 14 },
  { header: 'Cover type', width: 12 },
  { header: 'Insurance start', width: 12 },
  { header: 'Insurance expires', width: 12 },
  { header: 'Annual premium', width: 12 },
  { header: 'Status', width: 10 },
  { header: 'Notes', width: 24 },
];

export async function exportAssetsExcel(assets) {
  await exportOfficeAdminExcel({
    sheetName: 'Asset register',
    reportTitle: 'Office Admin — Asset register',
    reportSubtitle: `Fixed assets, lifecycle & insurance · Generated ${new Date().toLocaleString('en-ZA')} · ${(assets || []).length} asset(s)`,
    columns: ASSET_COLUMNS,
    rows: assets || [],
    mapRow: (a) => [
      a.asset_code,
      a.name,
      a.category_name || a.category,
      a.location,
      a.serial_number,
      sliceDate(a.purchase_date),
      a.purchase_value,
      a.condition_status,
      sliceDate(a.commissioned_date),
      sliceDate(a.warranty_expiry_date),
      a.expected_life_years,
      sliceDate(a.useful_life_end_date),
      sliceDate(a.disposal_date),
      a.insurance_provider,
      a.insurance_policy_number,
      a.insurance_cover_type,
      sliceDate(a.insurance_start_date),
      sliceDate(a.insurance_expiry_date),
      a.insurance_premium_annual,
      a.status,
      a.notes,
    ],
    filename: `office-assets-${todayStamp()}.xlsx`,
  });
}

const ASSET_PDF_COLUMNS = [
  { header: 'Code', width: 22, get: (a) => a.asset_code || '—' },
  { header: 'Name', width: 38, get: (a) => a.name || '—' },
  { header: 'Category', width: 24, get: (a) => a.category_name || a.category || '—' },
  { header: 'Location', width: 28, get: (a) => a.location || '—' },
  { header: 'Status', width: 18, get: (a) => a.status || '—' },
  { header: 'Warranty', width: 22, get: (a) => sliceDate(a.warranty_expiry_date) || '—' },
  { header: 'Insurance', width: 22, get: (a) => sliceDate(a.insurance_expiry_date) || '—' },
  { header: 'Value', width: 20, get: (a) => (a.purchase_value != null ? `R ${Number(a.purchase_value).toFixed(2)}` : '—') },
];

export function exportAssetsPdf(assets, title = 'Office Admin — Asset register') {
  exportOfficeAdminPdf({
    title,
    subtitle: `Summary register · ${(assets || []).length} asset(s) · Full detail in Excel export`,
    columns: ASSET_PDF_COLUMNS,
    rows: assets || [],
    filename: `office-assets-${todayStamp()}.pdf`,
    orientation: 'landscape',
  });
}

const CONSUMABLE_COLUMNS = [
  { header: 'Name', width: 22 },
  { header: 'Category', width: 12 },
  { header: 'Brand', width: 14 },
  { header: 'Unit', width: 8 },
  { header: 'Capacity', width: 12 },
  { header: 'Qty on hand', width: 10 },
  { header: 'Reorder', width: 10 },
  { header: 'Max stock', width: 10 },
  { header: 'Unit cost', width: 10 },
  { header: 'Storage', width: 16 },
  { header: 'Purchased at', width: 16 },
  { header: 'Supplier', width: 16 },
  { header: 'Last purchase', width: 12 },
  { header: 'Last price', width: 10 },
  { header: 'Restock', width: 12 },
  { header: 'Expiry', width: 12 },
  { header: 'Opened', width: 12 },
  { header: 'Perishable', width: 10 },
  { header: 'Batch', width: 12 },
  { header: 'Notes', width: 24 },
];

export async function exportConsumablesExcel(items) {
  await exportOfficeAdminExcel({
    sheetName: 'Supplies',
    reportTitle: 'Office Admin — Coffee, tea & supplies',
    reportSubtitle: `Consumables inventory · ${(items || []).length} item(s)`,
    columns: CONSUMABLE_COLUMNS,
    rows: items || [],
    mapRow: (c) => [
      c.name,
      c.category,
      c.brand,
      c.unit,
      c.capacity,
      c.quantity_on_hand,
      c.reorder_level,
      c.max_stock_level,
      c.unit_cost,
      c.storage_location,
      c.purchase_location,
      c.supplier_name,
      sliceDate(c.last_purchase_date),
      c.last_purchase_price,
      sliceDate(c.restock_date),
      sliceDate(c.expiry_date),
      sliceDate(c.opened_date),
      c.is_perishable ? 'Yes' : 'No',
      c.batch_number,
      c.notes,
    ],
    filename: `office-consumables-${todayStamp()}.xlsx`,
  });
}

const CONSUMABLE_PDF_COLUMNS = [
  { header: 'Name', width: 36, get: (c) => c.name || '—' },
  { header: 'Category', width: 20, get: (c) => c.category || '—' },
  { header: 'On hand', width: 16, get: (c) => String(c.quantity_on_hand ?? '—') },
  { header: 'Reorder', width: 16, get: (c) => String(c.reorder_level ?? '—') },
  { header: 'Expiry', width: 22, get: (c) => sliceDate(c.expiry_date) || '—' },
  { header: 'Storage', width: 28, get: (c) => c.storage_location || '—' },
  { header: 'Supplier', width: 28, get: (c) => c.supplier_name || c.purchase_location || '—' },
];

export function exportConsumablesPdf(items, title = 'Office Admin — Coffee, tea & supplies') {
  exportOfficeAdminPdf({
    title,
    columns: CONSUMABLE_PDF_COLUMNS,
    rows: items || [],
    filename: `office-consumables-${todayStamp()}.pdf`,
    orientation: 'landscape',
  });
}

const REPORT_COLUMNS = [
  { header: 'Title', width: 28 },
  { header: 'Status', width: 14 },
  { header: 'Priority', width: 10 },
  { header: 'Asset', width: 22 },
  { header: 'Location', width: 16 },
  { header: 'Fault category', width: 14 },
  { header: 'Provider', width: 12 },
  { header: 'Assigned to', width: 16 },
  { header: 'Work order', width: 12 },
  { header: 'Safety risk', width: 10 },
  { header: 'Reported by', width: 16 },
  { header: 'Created', width: 12 },
  { header: 'Resolved', width: 12 },
];

export async function exportMaintenanceReportsExcel(reports) {
  await exportOfficeAdminExcel({
    sheetName: 'Reports',
    reportTitle: 'Office Admin — Maintenance reports',
    columns: REPORT_COLUMNS,
    rows: reports || [],
    mapRow: (r) => [
      r.title,
      r.status,
      r.priority,
      r.asset_code ? `${r.asset_code} ${r.asset_name || r.asset_name_snapshot || ''}`.trim() : r.asset_name_snapshot,
      r.location,
      r.fault_category,
      r.provider_type,
      r.assigned_to,
      r.work_order_number,
      r.safety_risk ? 'Yes' : 'No',
      r.reported_by_name,
      sliceDate(r.created_at),
      sliceDate(r.resolved_at),
    ],
    filename: `office-maintenance-reports-${todayStamp()}.xlsx`,
  });
}

const REPORT_PDF_COLUMNS = [
  { header: 'Title', width: 42, get: (r) => r.title || '—' },
  { header: 'Status', width: 22, get: (r) => (r.status || '—').replace(/_/g, ' ') },
  { header: 'Priority', width: 18, get: (r) => r.priority || '—' },
  { header: 'Asset', width: 28, get: (r) => r.asset_code || r.asset_name_snapshot || '—' },
  { header: 'Assigned', width: 28, get: (r) => r.assigned_to || '—' },
  { header: 'Created', width: 22, get: (r) => sliceDate(r.created_at) || '—' },
];

export function exportMaintenanceReportsPdf(reports, title = 'Office Admin — Maintenance reports') {
  exportOfficeAdminPdf({
    title,
    columns: REPORT_PDF_COLUMNS,
    rows: reports || [],
    filename: `office-maintenance-reports-${todayStamp()}.pdf`,
    orientation: 'landscape',
  });
}

const HISTORY_COLUMNS = [
  { header: 'Asset', width: 20 },
  { header: 'Title', width: 22 },
  { header: 'Type', width: 12 },
  { header: 'Provider', width: 12 },
  { header: 'Vendor', width: 16 },
  { header: 'Performed by', width: 16 },
  { header: 'Performed at', width: 12 },
  { header: 'Cost (ZAR)', width: 10 },
  { header: 'Labor hrs', width: 10 },
  { header: 'Next due', width: 12 },
  { header: 'Work order', width: 12 },
  { header: 'Invoice', width: 12 },
  { header: 'Description', width: 32 },
];

export async function exportMaintenanceHistoryExcel(records) {
  await exportOfficeAdminExcel({
    sheetName: 'History',
    reportTitle: 'Office Admin — Maintenance history',
    columns: HISTORY_COLUMNS,
    rows: records || [],
    mapRow: (m) => [
      m.asset_code ? `${m.asset_code} — ${m.asset_name || ''}`.trim() : m.asset_name,
      m.title,
      m.maintenance_type,
      m.provider_type,
      m.vendor_name,
      m.performed_by,
      sliceDate(m.performed_at),
      m.cost,
      m.labor_hours,
      sliceDate(m.next_due_at),
      m.work_order_number,
      m.invoice_reference,
      m.description,
    ],
    filename: `office-maintenance-history-${todayStamp()}.xlsx`,
  });
}

const HISTORY_PDF_COLUMNS = [
  { header: 'Asset', width: 24, get: (m) => m.asset_code || '—' },
  { header: 'Title / work', width: 40, get: (m) => m.title || String(m.description || '').slice(0, 50) || '—' },
  { header: 'Type', width: 18, get: (m) => m.maintenance_type || '—' },
  { header: 'Vendor', width: 28, get: (m) => m.vendor_name || m.performed_by || '—' },
  { header: 'Cost', width: 18, get: (m) => (m.cost != null ? `R ${Number(m.cost).toFixed(2)}` : '—') },
  { header: 'Performed', width: 22, get: (m) => sliceDate(m.performed_at) || '—' },
];

export function exportMaintenanceHistoryPdf(records, title = 'Office Admin — Maintenance history') {
  exportOfficeAdminPdf({
    title,
    columns: HISTORY_PDF_COLUMNS,
    rows: records || [],
    filename: `office-maintenance-history-${todayStamp()}.pdf`,
    orientation: 'landscape',
  });
}

/** @deprecated use exportMaintenanceReportsPdf + exportMaintenanceHistoryPdf */
export function exportMaintenancePdf(reports, records) {
  exportMaintenanceReportsPdf(reports);
  if (records?.length) exportMaintenanceHistoryPdf(records);
}
