import * as XLSX from 'xlsx';
import { toYmdInAppZone } from '../lib/appTime.js';
import ExcelJS from 'exceljs';
import { formatTruckRegistration } from './truckKey.js';

/** Normalize header for matching: lowercase, trim, collapse spaces */
function norm(s) {
  if (s == null) return '';
  return String(s).toLowerCase().trim().replace(/\s+/g, ' ');
}

/** First row as headers, rest as data; return array of objects keyed by header */
function sheetToJson(worksheet) {
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (data.length < 2) return [];
  const headers = data[0].map((h) => norm(h));
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, j) => {
      const v = row[j];
      if (v !== undefined && v !== null && v !== '') obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

/** Map Excel row to truck API payload. Headers match template. */
const TRUCK_HEADER_MAP = {
  'main contractor (e.g. abc logistics)': 'main_contractor',
  'main contractor': 'main_contractor',
  'if sub contractor (e.g. xyz logistics)': 'sub_contractor',
  'if sub contractor': 'sub_contractor',
  'sub contractor': 'sub_contractor',
  'make_model': 'make_model',
  'make/model': 'make_model',
  'year_model': 'year_model',
  'year/model': 'year_model',
  'ownership_desc': 'ownership_desc',
  'ownership description': 'ownership_desc',
  'fleet_no': 'fleet_no',
  'fleet number': 'fleet_no',
  'truck_reg_no': 'registration',
  'truck registration number': 'registration',
  'registration': 'registration',
  'trailer_1_reg_no': 'trailer_1_reg_no',
  'trailer 1 registration': 'trailer_1_reg_no',
  'trailer_2_reg_no': 'trailer_2_reg_no',
  'trailer 2 registration': 'trailer_2_reg_no',
  'tracking unit provider (fleetcam/cartrack/nest tar/other)': 'tracking_provider',
  'tracking unit provider (fleetcam/cartrack/nest tar)': 'tracking_provider',
  'tracking unit provider': 'tracking_provider',
  'tracking provider': 'tracking_provider',
  'other provider name (if other selected)': 'tracking_provider_other',
  'other tracking provider name': 'tracking_provider_other',
  'user name': 'tracking_username',
  'tracking user name': 'tracking_username',
  'password': 'tracking_password',
  'tracking password': 'tracking_password',
  'camera user name': 'camera_username',
  'camera username': 'camera_username',
  'camera password': 'camera_password',
  'camera tracking provider (fleetcam/cartrack/nest tar/other)': 'camera_provider',
  'camera tracking provider': 'camera_provider',
  'camera unit provider (fleetcam/cartrack/nest tar/other)': 'camera_provider',
  'other camera provider name (if other selected)': 'camera_provider_other',
  'other camera provider name': 'camera_provider_other',
  'commodity type': 'commodity_type',
  'capacity (tonnes)': 'capacity_tonnes',
  'capacity_tonnes': 'capacity_tonnes',
  'fuel tank capacity (litres)': 'fuel_tank_capacity_litres',
  'fuel_tank_capacity_litres': 'fuel_tank_capacity_litres',
  'fuel consumption (l/100 km)': 'fuel_consumption_litres_per_100km',
  'fuel consumption (l/100km)': 'fuel_consumption_litres_per_100km',
  'fuel_consumption_litres_per_100km': 'fuel_consumption_litres_per_100km',
};

function mapTruckRow(obj) {
  const out = { status: 'active' };
  for (const [header, value] of Object.entries(obj)) {
    const key = norm(header).replace(/\s+/g, ' ');
    const apiKey = TRUCK_HEADER_MAP[key] || TRUCK_HEADER_MAP[header];
    if (apiKey) {
      if (apiKey === 'capacity_tonnes' || apiKey === 'fuel_tank_capacity_litres' || apiKey === 'fuel_consumption_litres_per_100km') {
        const n = parseFloat(value);
        out[apiKey] = Number.isFinite(n) ? n : null;
      } else if (apiKey === 'tracking_provider_other' || apiKey === 'camera_provider_other') {
        out[apiKey] = value == null ? null : String(value).trim();
      } else {
        out[apiKey] = value == null ? null : String(value).trim();
      }
    }
  }
  if (out.tracking_provider === 'Other' && out.tracking_provider_other) {
    out.tracking_provider = out.tracking_provider_other;
  }
  if (out.camera_provider === 'Other' && out.camera_provider_other) {
    out.camera_provider = out.camera_provider_other;
  }
  delete out.tracking_provider_other;
  delete out.camera_provider_other;
  if (out.registration) out.registration = formatTruckRegistration(out.registration);
  if (out.trailer_1_reg_no) out.trailer_1_reg_no = formatTruckRegistration(out.trailer_1_reg_no);
  if (out.trailer_2_reg_no) out.trailer_2_reg_no = formatTruckRegistration(out.trailer_2_reg_no);
  return out;
}

/** Map Excel row to driver API payload */
const DRIVER_HEADER_MAP = {
  'name': 'name',
  'surname': 'surname',
  'id number': 'id_number',
  'id_number': 'id_number',
  'id': 'id_number',
  "driver's license number": 'license_number',
  'driver licence number': 'license_number',
  'license number': 'license_number',
  'license_number': 'license_number',
  'license expiry (yyyy-mm-dd)': 'license_expiry',
  'license expiry': 'license_expiry',
  'license_expiry': 'license_expiry',
  'cellphone number': 'phone',
  'cellphone': 'phone',
  'phone': 'phone',
  'email': 'email',
  'email address': 'email',
};

function mapDriverRow(obj) {
  const out = {};
  for (const [header, value] of Object.entries(obj)) {
    const key = norm(header);
    const apiKey = DRIVER_HEADER_MAP[key] || DRIVER_HEADER_MAP[header];
    if (apiKey && value !== undefined && value !== null && value !== '') {
      if (apiKey === 'license_expiry' && value) {
        try {
          if (typeof value === 'number' && value > 1000) {
            const date = new Date((value - 25569) * 86400 * 1000);
            out[apiKey] = toYmdInAppZone(date);
          } else {
            out[apiKey] = String(value).trim();
          }
        } catch {
          out[apiKey] = String(value).trim();
        }
      } else {
        out[apiKey] = String(value).trim();
      }
    }
  }
  return out;
}

/** Parse uploaded file and return { trucks } or { drivers } */
export function parseExcelFile(file, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheet];
        const rows = sheetToJson(ws);
        if (type === 'trucks') {
          const trucks = rows.map(mapTruckRow).filter((t) => t.registration);
          resolve({ trucks });
        } else {
          const drivers = rows.map(mapDriverRow).filter((d) => d.name || d.surname);
          resolve({ drivers });
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/** Truck template: headers + one example row */
const TRUCK_TEMPLATE_HEADERS = [
  'Main contractor (e.g. ABC Logistics)',
  'If Sub contractor (e.g. XYZ Logistics)',
  'Make_Model',
  'Year_Model',
  'Ownership_desc',
  'Fleet_no',
  'Truck_Reg_No',
  'Trailer_1_Reg_No',
  'Trailer_2_Reg_No',
  'Tracking unit provider (Fleetcam/Cartrack/Nest Tar/Other)',
  'Other provider name (if Other selected)',
  'User name',
  'Password',
  'Camera tracking provider (Fleetcam/Cartrack/Nest Tar/Other)',
  'Other camera provider name (if Other selected)',
  'Camera user name',
  'Camera password',
  'Commodity type',
  'Capacity (tonnes)',
  'Fuel tank capacity (litres)',
  'Fuel consumption (L/100 km)',
];

const DRIVER_TEMPLATE_HEADERS = [
  'Name',
  'Surname',
  'ID number',
  "Driver's license number",
  'License expiry (YYYY-MM-DD)',
  'Cellphone number',
  'Email address',
];

/** Styled header appearance for template sheets */
const HEADER_STYLE = {
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F5496' },
  },
  font: {
    bold: true,
    color: { argb: 'FFFFFFFF' },
    size: 11,
    name: 'Calibri',
  },
  alignment: {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  },
  border: {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  },
};

/** Apply header style to the first row of a worksheet */
function styleHeaderRow(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_STYLE.fill;
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });
}

/** Download workbook as file from browser */
async function downloadExcelJSWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadTruckTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Trucks', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  ws.addRow(TRUCK_TEMPLATE_HEADERS);
  ws.addRow([
    'ABC Logistics',
    '',
    'MAN TGX',
    '2022',
    'Owned',
    'F001',
    'ABC 123 GP',
    'TRL 001 GP',
    'TRL 002 GP',
    'Fleetcam',
    '',
    'fleetuser',
    'example',
    'Fleetcam',
    '',
    'camerauser',
    'cameraexample',
    'Grain',
    '30',
    '800',
    '42',
  ]);

  ws.columns = TRUCK_TEMPLATE_HEADERS.map((_, i) => ({
    width: Math.min(Math.max(TRUCK_TEMPLATE_HEADERS[i]?.length ?? 12, 12), 42),
  }));
  styleHeaderRow(ws);

  // Light grid for data row
  ws.getRow(2).eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      left: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      bottom: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      right: { style: 'thin', color: { argb: 'FFD6D6D6' } },
    };
  });

  await downloadExcelJSWorkbook(workbook, 'contractor-trucks-template.xlsx');
}

export async function downloadDriverTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Drivers', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  ws.addRow(DRIVER_TEMPLATE_HEADERS);
  ws.addRow([
    'John',
    'Doe',
    '8001015001087',
    'DL12345678',
    '2026-12-31',
    '0821234567',
    'john.doe@example.com',
  ]);

  ws.columns = DRIVER_TEMPLATE_HEADERS.map((_, i) => ({
    width: Math.min(Math.max(DRIVER_TEMPLATE_HEADERS[i]?.length ?? 14, 14), 28),
  }));
  styleHeaderRow(ws);

  ws.getRow(2).eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      left: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      bottom: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      right: { style: 'thin', color: { argb: 'FFD6D6D6' } },
    };
  });

  await downloadExcelJSWorkbook(workbook, 'contractor-drivers-template.xlsx');
}

/** Consolidated template: one workbook with Trucks and Drivers sheets */
export async function downloadConsolidatedTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  workbook.created = new Date();

  const wsTrucks = workbook.addWorksheet('Trucks', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  wsTrucks.addRow(TRUCK_TEMPLATE_HEADERS);
  wsTrucks.addRow([
    'ABC Logistics',
    '',
    'MAN TGX',
    '2022',
    'Owned',
    'F001',
    'ABC 123 GP',
    'TRL 001 GP',
    'TRL 002 GP',
    'Fleetcam',
    '',
    'fleetuser',
    'example',
    'Fleetcam',
    '',
    'camerauser',
    'cameraexample',
    'Grain',
    '30',
    '800',
    '42',
  ]);
  wsTrucks.columns = TRUCK_TEMPLATE_HEADERS.map((_, i) => ({
    width: Math.min(Math.max(TRUCK_TEMPLATE_HEADERS[i]?.length ?? 12, 12), 42),
  }));
  styleHeaderRow(wsTrucks);
  wsTrucks.getRow(2).eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      left: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      bottom: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      right: { style: 'thin', color: { argb: 'FFD6D6D6' } },
    };
  });

  const wsDrivers = workbook.addWorksheet('Drivers', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  wsDrivers.addRow(DRIVER_TEMPLATE_HEADERS);
  wsDrivers.addRow([
    'John',
    'Doe',
    '8001015001087',
    'DL12345678',
    '2026-12-31',
    '0821234567',
    'john.doe@example.com',
  ]);
  wsDrivers.columns = DRIVER_TEMPLATE_HEADERS.map((_, i) => ({
    width: Math.min(Math.max(DRIVER_TEMPLATE_HEADERS[i]?.length ?? 14, 14), 28),
  }));
  styleHeaderRow(wsDrivers);
  wsDrivers.getRow(2).eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      left: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      bottom: { style: 'thin', color: { argb: 'FFD6D6D6' } },
      right: { style: 'thin', color: { argb: 'FFD6D6D6' } },
    };
  });

  await downloadExcelJSWorkbook(workbook, 'contractor-consolidated-template.xlsx');
}

/** Parse consolidated file (Trucks + Drivers sheets) and return { trucks, drivers } */
export function parseConsolidatedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const names = wb.SheetNames;

        let trucks = [];
        let drivers = [];

        const trucksSheetName = names.find((n) => norm(n) === 'trucks') || names[0];
        const driversSheetName = names.find((n) => norm(n) === 'drivers') || (names.length > 1 ? names[1] : null);

        if (wb.Sheets[trucksSheetName]) {
          const rows = sheetToJson(wb.Sheets[trucksSheetName]);
          trucks = rows.map(mapTruckRow).filter((t) => t.registration);
        }
        if (driversSheetName && wb.Sheets[driversSheetName]) {
          const rows = sheetToJson(wb.Sheets[driversSheetName]);
          drivers = rows.map(mapDriverRow).filter((d) => d.name || d.surname);
        }

        resolve({ trucks, drivers });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
