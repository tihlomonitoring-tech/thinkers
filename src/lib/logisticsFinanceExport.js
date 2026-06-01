/**
 * Logistics finance — Excel/PDF export (Fuel Data statement layout).
 */
import {
  buildStatementExcelBuffer,
  buildStatementPdfBuffer,
  formatExportPeriodLabel,
  loadFuelExportParties,
} from './fuelStatementExport.js';

export const LOAD_EXPORT_TITLE = 'Logistics load transactions';
export const PNL_EXPORT_TITLE = 'Expense vs revenue';

export const LOAD_EXPORT_COLUMNS = [
  { key: 'transaction_date', header: 'Date', width: 12, numeric: false },
  { key: 'vehicle_id', header: 'Vehicle Id', width: 12, numeric: false },
  { key: 'vehicle_desc', header: 'Vehicle Desc', width: 22, numeric: false },
  { key: 'vehicle_registration', header: 'Vehicle Registration', width: 16, numeric: false },
  { key: 'haulier', header: 'Haulier', width: 18, numeric: false },
  { key: 'completed', header: 'Completed', width: 10, numeric: true, decimals: 0 },
  { key: 'cancelled', header: 'Cancelled', width: 10, numeric: true, decimals: 0 },
  { key: 'avg_hours', header: 'Avg Hours', width: 10, numeric: true, decimals: 2 },
  { key: 'tons', header: 'Tons', width: 10, numeric: true, decimals: 2 },
  { key: 'turnover', header: 'Turnover', width: 12, numeric: true, decimals: 2 },
  { key: 'target_turnover', header: 'Target', width: 12, numeric: true, decimals: 2 },
  { key: 'variance', header: 'Variance', width: 12, numeric: true, decimals: 2 },
  { key: 'turnover_points', header: 'Turnover Points', width: 14, numeric: true, decimals: 2 },
  { key: 'target_points', header: 'Target Points', width: 14, numeric: true, decimals: 2 },
  { key: 'variance_points', header: 'Variance Points', width: 14, numeric: true, decimals: 2 },
];

export const PNL_EXPORT_COLUMNS = [
  ...LOAD_EXPORT_COLUMNS,
  { key: 'fuel_expense', header: 'Fuel expense (ZAR)', width: 14, numeric: true, decimals: 2 },
  { key: 'accounting_expense', header: 'Accounting expense (ZAR)', width: 16, numeric: true, decimals: 2 },
  { key: 'total_expense', header: 'Total expense (ZAR)', width: 14, numeric: true, decimals: 2 },
  { key: 'net_margin', header: 'Net margin (ZAR)', width: 14, numeric: true, decimals: 2 },
  { key: 'comment', header: 'Comment', width: 24, numeric: false },
];

export const LOAD_SUM_KEYS = [
  { key: 'turnover', decimals: 2 },
  { key: 'variance', decimals: 2 },
  { key: 'turnover_points', decimals: 2 },
  { key: 'variance_points', decimals: 2 },
];

export const PNL_SUM_KEYS = [
  ...LOAD_SUM_KEYS,
  { key: 'fuel_expense', decimals: 2 },
  { key: 'accounting_expense', decimals: 2 },
  { key: 'total_expense', decimals: 2 },
  { key: 'net_margin', decimals: 2 },
];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function logisticsCellRaw(row, key) {
  if (!row) return '';
  switch (key) {
    case 'transaction_date':
      return row.transaction_date ? fmtDate(row.transaction_date) : '';
    case 'vehicle_id':
      return String(row.vehicle_id ?? '');
    case 'vehicle_desc':
      return String(row.vehicle_desc ?? '');
    case 'vehicle_registration':
      return String(row.vehicle_registration ?? '');
    case 'haulier':
      return String(row.haulier ?? '');
    case 'completed':
    case 'cancelled':
      return row[key] != null ? Number(row[key]) : '';
    case 'avg_hours':
    case 'tons':
    case 'turnover':
    case 'target_turnover':
    case 'variance':
    case 'turnover_points':
    case 'target_points':
    case 'variance_points':
    case 'fuel_expense':
    case 'accounting_expense':
    case 'total_expense':
    case 'net_margin':
      return row[key] != null ? Number(row[key]) : '';
    case 'comment':
      return String(row.comment ?? '');
    default:
      return row[key] ?? '';
  }
}

export function logisticsCellPdf(row, key) {
  const v = logisticsCellRaw(row, key);
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}

export async function buildLogisticsExportExcelBuffer({ rows, view = 'load', periodLabel, tenantId }) {
  const parties = await loadFuelExportParties(tenantId, {});
  const isPnl = view === 'pnl';
  return buildStatementExcelBuffer({
    rows,
    parties,
    columnDefs: isPnl ? PNL_EXPORT_COLUMNS : LOAD_EXPORT_COLUMNS,
    getCellRaw: logisticsCellRaw,
    title: isPnl ? PNL_EXPORT_TITLE : LOAD_EXPORT_TITLE,
    sheetName: isPnl ? 'Expense vs revenue' : 'Load transactions',
    periodLabel: periodLabel || '',
    sumKeys: isPnl ? PNL_SUM_KEYS : LOAD_SUM_KEYS,
    dateNumFmtKey: null,
  });
}

export async function buildLogisticsExportPdfBuffer({ rows, view = 'load', periodLabel, tenantId }) {
  const parties = await loadFuelExportParties(tenantId, {});
  const isPnl = view === 'pnl';
  return buildStatementPdfBuffer({
    rows,
    parties,
    columnDefs: isPnl ? PNL_EXPORT_COLUMNS : LOAD_EXPORT_COLUMNS,
    getCellPdf: logisticsCellPdf,
    title: isPnl ? PNL_EXPORT_TITLE : LOAD_EXPORT_TITLE,
    periodLabel: periodLabel || '',
    sumKeys: isPnl ? PNL_SUM_KEYS : LOAD_SUM_KEYS,
    transactionsHeading: isPnl ? 'Expense vs revenue' : 'Load transactions',
  });
}

export { formatExportPeriodLabel };
