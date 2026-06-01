/**
 * Parse logistics load / turnover Excel (15 columns as per fleet performance export).
 */
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';

export function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function normRegistration(reg) {
  return String(reg || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/-/g, '');
}

const HEADER_ALIASES = {
  transaction_date: ['date', 'transaction_date', 'load_date', 'day'],
  vehicle_id: ['vehicle_id', 'vehicleid', 'veh_id', 'id'],
  vehicle_desc: ['vehicle_desc', 'vehicledesc', 'vehicle_description', 'description'],
  vehicle_registration: [
    'vehicle_registration',
    'vehicleregistration',
    'registration',
    'reg_no',
    'reg',
    'number_plate',
  ],
  haulier: ['haulier', 'hauler', 'contractor', 'carrier', 'transporter'],
  completed: ['completed', 'complete', 'loads_completed'],
  cancelled: ['cancelled', 'canceled', 'cancelled_loads'],
  avg_hours: ['avg_hours', 'avghours', 'average_hours', 'avg_hrs'],
  tons: ['tons', 'tonnage', 'tonnes'],
  turnover: ['turnover', 'revenue', 'turn_over'],
  target_turnover: ['target', 'target_turnover', 'revenue_target'],
  variance: ['variance', 'turnover_variance', 'var'],
  turnover_points: ['turnover_points', 'turnoverpoints', 'points', 'turnover_pts'],
  target_points: ['target_points', 'targetpoints', 'points_target'],
  variance_points: ['variance_points', 'variancepoints', 'points_variance', 'var_pts'],
};

function mapHeaders(headerRow) {
  const colMap = {};
  headerRow.forEach((cell, idx) => {
    const n = normHeader(cell);
    if (!n) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(n)) {
        if (colMap[field] == null) colMap[field] = idx;
      }
    }
  });
  return colMap;
}

function cellVal(row, idx) {
  if (idx == null || idx < 0) return null;
  const v = row[idx];
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.text != null) return v.text;
  if (typeof v === 'object' && v.result != null) return v.result;
  return v;
}

function parseNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseIntVal(v) {
  const n = parseNumber(v);
  return n == null ? null : Math.round(n);
}

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && v > 30000 && v < 120000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + v * 86400000);
  }
  const s = String(v).trim();
  const mon = s.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/);
  if (mon) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const m = months[mon[2].toLowerCase().slice(0, 3)];
    if (m != null) {
      let y = Number(mon[3]);
      if (y < 100) y += 2000;
      return new Date(y, m, Number(mon[1]));
    }
  }
  const isoLike = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) return new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function extractRegFromDesc(desc) {
  const s = String(desc || '');
  const paren = s.match(/\(([A-Za-z0-9]{4,12})\)/);
  if (paren) return paren[1];
  const tokens = s.split(/\s+/).filter((t) => /^[A-Za-z]{2,3}\d{2,3}[A-Za-z]{0,3}$/i.test(t));
  return tokens.length ? tokens[tokens.length - 1] : null;
}

function enrichVariance(row) {
  const out = { ...row };
  if (out.turnover != null && out.target_turnover != null && out.variance == null) {
    out.variance = Math.round((out.turnover - out.target_turnover) * 100) / 100;
  }
  if (out.turnover_points != null && out.target_points != null && out.variance_points == null) {
    out.variance_points = Math.round((out.turnover_points - out.target_points) * 10000) / 10000;
  }
  return out;
}

function extractRawRowsExcelJS(workbook) {
  const sheet = workbook.worksheets?.[0];
  if (!sheet) return null;
  const raw = [];
  sheet.eachRow((row) => {
    const vals = row.values;
    const cells = Array.isArray(vals) ? vals.slice(1) : [];
    raw.push({ cells });
  });
  return raw.length ? raw : null;
}

function extractRawRowsXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName || !wb.Sheets[sheetName]) return null;
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
  if (!data.length) return null;
  return data.map((cells) => ({
    cells: (cells || []).map((c) => (c === '' ? null : c)),
  }));
}

export function parseLogisticsLoadFromRaw(raw) {
  if (!raw?.length) return { rows: [], errors: ['No worksheet found'] };
  if (raw.length < 2) return { rows: [], errors: ['Sheet has no data rows'] };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(20, raw.length); i++) {
    const line = raw[i].cells.map((c) => normHeader(c)).join('|');
    if (line.includes('vehicle') && (line.includes('turnover') || line.includes('haulier'))) {
      headerIdx = i;
      break;
    }
  }

  const colMap = mapHeaders(raw[headerIdx].cells);
  const required = ['transaction_date', 'turnover'];
  const missing = required.filter((f) => colMap[f] == null);
  if (missing.length) {
    return {
      rows: [],
      errors: [
        `Missing required column(s): ${missing.join(', ')}. Expected headers like Date, Vehicle Id, Turnover, Turnover Points, Target Points, Variance Points.`,
      ],
      colMap,
    };
  }

  const out = [];
  const errors = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const { cells } = raw[i];
    const txDate = parseDate(cellVal(cells, colMap.transaction_date));
    if (!txDate) {
      const hasAny = cells.some((c) => c != null && String(c).trim() !== '');
      if (hasAny) errors.push(`Row ${i + 1}: missing or invalid date`);
      continue;
    }

    let reg = cellVal(cells, colMap.vehicle_registration);
    reg = reg ? String(reg).trim() : '';
    const desc = cellVal(cells, colMap.vehicle_desc);
    if (!reg && desc) reg = extractRegFromDesc(desc) || '';

    const row = enrichVariance({
      rowNumber: i + 1,
      transaction_date: txDate.toISOString().slice(0, 10),
      vehicle_id: cellVal(cells, colMap.vehicle_id) != null ? String(cellVal(cells, colMap.vehicle_id)).trim() : null,
      vehicle_desc: desc != null ? String(desc).trim() : null,
      vehicle_registration: reg || null,
      haulier: cellVal(cells, colMap.haulier) != null ? String(cellVal(cells, colMap.haulier)).trim() : null,
      completed: parseIntVal(cellVal(cells, colMap.completed)),
      cancelled: parseIntVal(cellVal(cells, colMap.cancelled)),
      avg_hours: parseNumber(cellVal(cells, colMap.avg_hours)),
      tons: parseNumber(cellVal(cells, colMap.tons)),
      turnover: parseNumber(cellVal(cells, colMap.turnover)),
      target_turnover: parseNumber(cellVal(cells, colMap.target_turnover)),
      variance: parseNumber(cellVal(cells, colMap.variance)),
      turnover_points: parseNumber(cellVal(cells, colMap.turnover_points)),
      target_points: parseNumber(cellVal(cells, colMap.target_points)),
      variance_points: parseNumber(cellVal(cells, colMap.variance_points)),
    });

    if (row.turnover == null && row.turnover_points == null && !row.vehicle_id && !reg) continue;
    out.push(row);
  }

  return { rows: out, errors, colMap };
}

export async function parseLogisticsLoadBuffer(buffer) {
  if (!buffer?.length) return { rows: [], errors: ['The uploaded file is empty'] };
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  let loadError = null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    const raw = extractRawRowsExcelJS(workbook);
    if (raw?.length) return parseLogisticsLoadFromRaw(raw);
  } catch (e) {
    loadError = e;
  }

  try {
    const raw = extractRawRowsXlsx(buf);
    if (raw?.length) return parseLogisticsLoadFromRaw(raw);
  } catch (e) {
    const detail = e?.message || loadError?.message || 'invalid format';
    return { rows: [], errors: [`Could not read the Excel file: ${detail}`] };
  }

  return { rows: [], errors: [loadError?.message || 'Could not read worksheet'] };
}

export function loadTransactionDuplicateKey(row) {
  return [
    row.transaction_date,
    row.vehicle_id || '',
    normRegistration(row.vehicle_registration),
    String(row.haulier || '').toLowerCase(),
    row.completed ?? '',
    row.turnover ?? '',
  ].join('|');
}
