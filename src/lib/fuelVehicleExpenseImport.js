/**
 * Parse fleet fuel expense Excel rows into normalized records.
 * Uses ExcelJS when possible; falls back to SheetJS (xlsx) for exports ExcelJS cannot load.
 */
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const HEADER_ALIASES = {
  registration_number: [
    'registration_number',
    'registration',
    'reg_number',
    'reg_no',
    'vehicle_registration',
    'vehicleregistration',
    'reg',
    'number_plate',
    'license_plate',
  ],
  transaction_at: [
    'driver_capture_datetime',
    'driver_capture_date',
    'capture_datetime',
    'transaction_date',
    'transaction_datetime',
    'date',
    'datetime',
    'fuel_date',
  ],
  litres: ['litres', 'liters', 'litre', 'liter', 'volume', 'qty_litres'],
  start_odometer: ['start_odometer', 'start_odo', 'odometer_start', 'odo_start', 'start_odom'],
  end_odometer: ['end_odometer', 'end_odo', 'odometer_end', 'odo_end', 'end_odom'],
  amount_rand: ['rand_value', 'randvalue', 'amount_rand', 'amount', 'total_rand', 'value_rand', 'cost'],
  source_type_name: ['source_type_name', 'source_type', 'sourcetypename'],
  input_source: ['input_source', 'inputsource', 'source'],
  price_per_litre: [
    'rand_value_per_litre',
    'rand_per_litre',
    'price_per_litre',
    'price_per_liter',
    'rate_per_litre',
    'r_per_l',
    'unit_price',
  ],
};

function mapHeaders(headerRow) {
  const colMap = {};
  headerRow.forEach((cell, idx) => {
    const n = normHeader(cell);
    if (!n) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(n) || n.includes(field.replace(/_/g, ''))) {
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

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && v > 30000 && v < 60000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + v * 86400000);
  }
  const s = String(v).trim();
  const isoLike = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (isoLike) {
    return new Date(
      Number(isoLike[1]),
      Number(isoLike[2]) - 1,
      Number(isoLike[3]),
      Number(isoLike[4] || 0),
      Number(isoLike[5] || 0),
      Number(isoLike[6] || 0)
    );
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function extractRawRowsExcelJS(workbook) {
  const sheet = workbook.worksheets?.[0];
  if (!sheet) return null;
  const raw = [];
  sheet.eachRow((row, rowNumber) => {
    const vals = row.values;
    const cells = Array.isArray(vals) ? vals.slice(1) : [];
    raw.push({ rowNumber, cells });
  });
  return raw.length ? raw : null;
}

function extractRawRowsXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName || !wb.Sheets[sheetName]) return null;
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
  if (!data.length) return null;
  return data.map((cells, i) => ({
    rowNumber: i + 1,
    cells: (cells || []).map((c) => (c === '' ? null : c)),
  }));
}

export function parseFuelVehicleExpenseFromRaw(raw) {
  if (!raw?.length) return { rows: [], errors: ['No worksheet found'] };
  if (raw.length < 2) return { rows: [], errors: ['Sheet has no data rows'] };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const line = raw[i].cells.map((c) => normHeader(c)).join('|');
    if (line.includes('registration') || line.includes('driver_capture') || line.includes('litre')) {
      headerIdx = i;
      break;
    }
  }

  const colMap = mapHeaders(raw[headerIdx].cells);
  if (colMap.registration_number == null) {
    return {
      rows: [],
      errors: ['Could not find registration_number column. Expected headers like registration_number, registration, reg.'],
    };
  }

  const out = [];
  const errors = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const { rowNumber, cells } = raw[i];
    const reg = String(cellVal(cells, colMap.registration_number) || '').trim();
    if (!reg) continue;

    const txAt = parseDate(cellVal(cells, colMap.transaction_at));
    if (!txAt) {
      errors.push(`Row ${rowNumber}: missing or invalid date`);
      continue;
    }

    const litres = parseNumber(cellVal(cells, colMap.litres));
    const amountRand = parseNumber(cellVal(cells, colMap.amount_rand));
    let pricePerLitre = parseNumber(cellVal(cells, colMap.price_per_litre));
    if (pricePerLitre == null && litres > 0 && amountRand != null) {
      pricePerLitre = Math.round((amountRand / litres) * 10000) / 10000;
    }

    out.push({
      rowNumber,
      registration_number: reg,
      transaction_at: txAt.toISOString(),
      litres,
      start_odometer: parseNumber(cellVal(cells, colMap.start_odometer)),
      end_odometer: parseNumber(cellVal(cells, colMap.end_odometer)),
      amount_rand: amountRand,
      source_type_name: cellVal(cells, colMap.source_type_name)
        ? String(cellVal(cells, colMap.source_type_name)).trim()
        : null,
      input_source: cellVal(cells, colMap.input_source) ? String(cellVal(cells, colMap.input_source)).trim() : null,
      price_per_litre: pricePerLitre,
    });
  }

  return { rows: out, errors, colMap };
}

/** @deprecated Use parseFuelVehicleExpenseBuffer */
export function parseFuelVehicleExpenseWorkbook(workbook) {
  const raw = extractRawRowsExcelJS(workbook);
  return parseFuelVehicleExpenseFromRaw(raw);
}

/** Load buffer with ExcelJS, then SheetJS if needed; parse first worksheet. */
export async function parseFuelVehicleExpenseBuffer(buffer) {
  if (!buffer?.length) {
    return { rows: [], errors: ['The uploaded file is empty'] };
  }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  let loadError = null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    const raw = extractRawRowsExcelJS(workbook);
    if (raw?.length) return parseFuelVehicleExpenseFromRaw(raw);
  } catch (e) {
    loadError = e;
  }

  try {
    const raw = extractRawRowsXlsx(buf);
    if (raw?.length) return parseFuelVehicleExpenseFromRaw(raw);
  } catch (e) {
    const detail = e?.message || loadError?.message || 'invalid format';
    const friendly = /sheets/i.test(detail)
      ? 'Could not read the Excel file. Upload a valid .xlsx fleet fuel export.'
      : `Could not read the Excel file: ${detail}`;
    return { rows: [], errors: [friendly] };
  }

  const detail = loadError?.message || 'no worksheet';
  const friendly = /sheets/i.test(detail)
    ? 'Could not read the Excel file. Upload a valid .xlsx fleet fuel export.'
    : `Could not read the Excel file: ${detail}`;
  return { rows: [], errors: [friendly] };
}

export function normRegistration(reg) {
  return String(reg || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

/** Stable key for duplicate detection (same tenant transaction). */
export function fuelExpenseDuplicateKey({ registration_number, transaction_at, litres, amount_rand }) {
  const reg = normRegistration(registration_number);
  let dtKey = '';
  if (transaction_at) {
    const d = new Date(transaction_at);
    if (!Number.isNaN(d.getTime())) dtKey = d.toISOString().slice(0, 16);
  }
  const litresKey =
    litres != null && litres !== '' && Number.isFinite(Number(litres)) ? Number(litres).toFixed(2) : '';
  const amtKey =
    amount_rand != null && amount_rand !== '' && Number.isFinite(Number(amount_rand))
      ? Number(amount_rand).toFixed(2)
      : '';
  return `${reg}|${dtKey}|${litresKey}|${amtKey}`;
}
