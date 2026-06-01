/**
 * Internal vehicle fuel expenditure — Excel/PDF export (same layout as Fuel Data File Export).
 */
import {
  buildStatementExcelBuffer,
  buildStatementPdfBuffer,
  formatExportPeriodLabel,
  loadFuelExportParties,
} from './fuelStatementExport.js';

export const VEHICLE_FUEL_EXPORT_TITLE = 'Internal vehicle fuel expenditure';
export const VEHICLE_FUEL_SHEET_NAME = 'Vehicle fuel expenditure';

export const VEHICLE_FUEL_EXPORT_COLUMNS = [
  { key: 'transaction_at', header: 'Date / time', width: 20, numeric: false },
  { key: 'registration_number', header: 'Registration', width: 14, numeric: false },
  { key: 'truck_registration', header: 'Matched truck', width: 14, numeric: false },
  { key: 'fleet_no', header: 'Fleet no.', width: 11, numeric: false },
  { key: 'contractor', header: 'Contractor', width: 22, numeric: false },
  { key: 'litres', header: 'Litres', width: 11, numeric: true, decimals: 3 },
  { key: 'start_odometer', header: 'Start odometer', width: 14, numeric: true, decimals: 0 },
  { key: 'end_odometer', header: 'End odometer', width: 14, numeric: true, decimals: 0 },
  { key: 'amount_rand', header: 'Amount (ZAR)', width: 14, numeric: true, decimals: 2 },
  { key: 'price_per_litre', header: 'R/L', width: 10, numeric: true, decimals: 2 },
  { key: 'source_type_name', header: 'Source type', width: 14, numeric: false },
  { key: 'input_source', header: 'Input source', width: 12, numeric: false },
  { key: 'match_status', header: 'Match', width: 10, numeric: false },
  { key: 'notes', header: 'Notes', width: 18, numeric: false },
];

export const VEHICLE_FUEL_SUM_KEYS = [
  { key: 'litres', decimals: 2 },
  { key: 'amount_rand', decimals: 2 },
];

function contractorLabel(row) {
  return row?.contractor_company_name || row?.main_contractor || '';
}

export function vehicleFuelCellRaw(row, key) {
  if (!row) return '';
  switch (key) {
    case 'transaction_at':
      return row.transaction_at ? new Date(row.transaction_at) : '';
    case 'registration_number':
      return String(row.registration_number || '');
    case 'truck_registration':
      return String(row.truck_registration || '');
    case 'fleet_no':
      return String(row.fleet_no || '');
    case 'contractor':
      return contractorLabel(row);
    case 'litres':
      return row.litres != null ? Number(row.litres) : '';
    case 'start_odometer':
      return row.start_odometer != null ? Number(row.start_odometer) : '';
    case 'end_odometer':
      return row.end_odometer != null ? Number(row.end_odometer) : '';
    case 'amount_rand':
      return row.amount_rand != null ? Number(row.amount_rand) : '';
    case 'price_per_litre':
      return row.price_per_litre != null ? Number(row.price_per_litre) : '';
    case 'source_type_name':
      return String(row.source_type_name || '');
    case 'input_source':
      return String(row.input_source || '');
    case 'match_status':
      return String(row.match_status || '');
    case 'notes':
      return String(row.notes || '');
    default:
      return '';
  }
}

export function vehicleFuelCellPdf(row, key) {
  const v = vehicleFuelCellRaw(row, key);
  if (v === '' || v == null) return '';
  if (key === 'transaction_at' && row.transaction_at) {
    return new Date(row.transaction_at).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (key === 'litres' && typeof v === 'number') return v.toFixed(2);
  if (key === 'amount_rand' && typeof v === 'number') return v.toFixed(2);
  if (key === 'price_per_litre' && typeof v === 'number') return String(v);
  if ((key === 'start_odometer' || key === 'end_odometer') && typeof v === 'number') return String(Math.round(v));
  return String(v);
}

export async function buildVehicleFuelExportExcelBuffer(rows, tenantId, queryFilters = {}) {
  const parties = await loadFuelExportParties(tenantId, queryFilters);
  const periodLabel = formatExportPeriodLabel(queryFilters, rows, 'transaction_at');
  return buildStatementExcelBuffer({
    rows,
    parties,
    columnDefs: VEHICLE_FUEL_EXPORT_COLUMNS,
    getCellRaw: vehicleFuelCellRaw,
    title: VEHICLE_FUEL_EXPORT_TITLE,
    sheetName: VEHICLE_FUEL_SHEET_NAME,
    periodLabel,
    sumKeys: VEHICLE_FUEL_SUM_KEYS,
    dateNumFmtKey: 'transaction_at',
  });
}

export async function buildVehicleFuelExportPdfBuffer(rows, tenantId, queryFilters = {}) {
  const parties = await loadFuelExportParties(tenantId, queryFilters);
  const periodLabel = formatExportPeriodLabel(queryFilters, rows, 'transaction_at');
  return buildStatementPdfBuffer({
    rows,
    parties,
    columnDefs: VEHICLE_FUEL_EXPORT_COLUMNS,
    getCellPdf: vehicleFuelCellPdf,
    title: VEHICLE_FUEL_EXPORT_TITLE,
    periodLabel,
    sumKeys: VEHICLE_FUEL_SUM_KEYS,
    transactionsHeading: 'Vehicle fuel transactions',
  });
}
