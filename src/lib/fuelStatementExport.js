/**
 * Shared Excel/PDF statement layout for Fuel Data file export, auto-share, and internal vehicle fuel exports.
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function safeResolveUnderRoot(root, relative) {
  if (!relative || typeof relative !== 'string') return null;
  const norm = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..')) return null;
  const abs = path.resolve(path.join(root, norm));
  const rootR = path.resolve(root);
  if (!abs.startsWith(rootR + path.sep) && abs !== rootR) return null;
  return abs;
}

export function colLetter0(index0) {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function exportLogoExtension(absPath) {
  const l = (absPath || '').toLowerCase();
  if (l.endsWith('.png')) return 'png';
  if (l.endsWith('.gif')) return 'gif';
  return 'jpeg';
}

export function mapFuelSupplierRow(row) {
  if (!row) return null;
  const def = get(row, 'is_default');
  return {
    id: get(row, 'id'),
    name: get(row, 'name'),
    logo_file_path: get(row, 'logo_file_path') || null,
    address: get(row, 'address') || null,
    vat_number: get(row, 'vat_number') || null,
    price_per_litre: get(row, 'price_per_litre') != null ? Number(get(row, 'price_per_litre')) : null,
    vehicle_registration: get(row, 'vehicle_registration') || null,
    fuel_attendant_name: get(row, 'fuel_attendant_name') || null,
    is_default: def === true || def === 1 || def === '1',
  };
}

export function mapFuelCustomerRow(row) {
  if (!row) return null;
  return {
    id: get(row, 'id'),
    name: get(row, 'name'),
    vehicle_registration: get(row, 'vehicle_registration') || null,
    responsible_user_name: get(row, 'responsible_user_name') || null,
    authorizer_name: get(row, 'authorizer_name') || null,
  };
}

/** Default fuel supplier + logo for statement headers (matches File Export when unfiltered). */
export async function loadFuelExportParties(tenantId, queryFilters = {}) {
  let supplierId =
    queryFilters?.supplier_id != null && String(queryFilters.supplier_id).trim()
      ? String(queryFilters.supplier_id).trim()
      : null;
  let customerId =
    queryFilters?.customer_id != null && String(queryFilters.customer_id).trim()
      ? String(queryFilters.customer_id).trim()
      : null;

  if (!supplierId) {
    const d = await query(
      `SELECT TOP 1 id FROM fuel_data_suppliers WHERE tenant_id = @tid ORDER BY is_default DESC, name`,
      { tid: tenantId }
    );
    if (d.recordset?.[0]) supplierId = String(get(d.recordset[0], 'id'));
  }

  let supplierRow = null;
  let customerRow = null;
  let logoBuffer = null;
  let supplierLogoAbsPath = null;

  if (supplierId) {
    const s = await query(`SELECT * FROM fuel_data_suppliers WHERE id = @id AND tenant_id = @tid`, {
      id: supplierId,
      tid: tenantId,
    });
    supplierRow = s.recordset?.[0] ? mapFuelSupplierRow(s.recordset[0]) : null;
    if (supplierRow?.logo_file_path) {
      const abs = safeResolveUnderRoot(path.join(process.cwd(), 'uploads'), supplierRow.logo_file_path);
      if (abs && fs.existsSync(abs)) {
        supplierLogoAbsPath = abs;
        try {
          logoBuffer = fs.readFileSync(abs);
        } catch (_) {
          logoBuffer = null;
        }
      }
    }
  }
  if (customerId) {
    const c = await query(`SELECT * FROM fuel_data_customers WHERE id = @id AND tenant_id = @tid`, {
      id: customerId,
      tid: tenantId,
    });
    customerRow = c.recordset?.[0] ? mapFuelCustomerRow(c.recordset[0]) : null;
  }
  return { supplierRow, customerRow, logoBuffer, supplierLogoAbsPath };
}

export function formatExportPeriodLabel(queryFilters, rows, dateField = 'delivery_time') {
  const fmt = (d) =>
    d && !Number.isNaN(new Date(d).getTime())
      ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;
  const fromQ = queryFilters?.date_from || queryFilters?.from ? new Date(queryFilters.date_from || queryFilters.from) : null;
  const toQ = queryFilters?.date_to || queryFilters?.to ? new Date(queryFilters.date_to || queryFilters.to) : null;
  if ((fromQ && !Number.isNaN(fromQ.getTime())) || (toQ && !Number.isNaN(toQ.getTime()))) {
    const a = fromQ && !Number.isNaN(fromQ.getTime()) ? fmt(fromQ) : null;
    const b = toQ && !Number.isNaN(toQ.getTime()) ? fmt(toQ) : null;
    if (a && b) return `Report period (filters): ${a} – ${b}`;
    if (a) return `Report period (filters): from ${a}`;
    if (b) return `Report period (filters): to ${b}`;
  }
  let minT = null;
  let maxT = null;
  for (const m of rows || []) {
    const raw = m?.[dateField];
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) continue;
    if (minT == null || t < minT) minT = t;
    if (maxT == null || t > maxT) maxT = t;
  }
  if (minT != null && maxT != null) {
    return `Transaction dates in this export: ${fmt(new Date(minT))} – ${fmt(new Date(maxT))}`;
  }
  return '';
}

function supplierLines(supplierRow) {
  if (!supplierRow) return '';
  return [
    supplierRow.name,
    supplierRow.address,
    supplierRow.vat_number ? `VAT: ${supplierRow.vat_number}` : '',
    supplierRow.vehicle_registration ? `Vehicle registration: ${supplierRow.vehicle_registration}` : '',
    supplierRow.fuel_attendant_name ? `Fuel attendant: ${supplierRow.fuel_attendant_name}` : '',
    supplierRow.price_per_litre != null ? `Price / litre: R ${supplierRow.price_per_litre}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function pdfAutoFitColumns(doc, columnDefs, rows, getCellPdf, opts = {}) {
  const {
    innerW,
    M,
    contentRight,
    headerFont = 'Helvetica-Bold',
    bodyFont = 'Helvetica',
    headerSize = 7.5,
    bodySize = 7,
    cellPad = 3,
    minW = 26,
    maxW = 200,
    sampleLimit = 400,
  } = opts;
  const defs = columnDefs.filter(Boolean);
  if (!defs.length) return [];

  const sample = (rows || []).slice(0, sampleLimit);
  const desired = defs.map((d) => {
    doc.font(headerFont).fontSize(headerSize);
    let widest = doc.widthOfString(String(d.header || ''));
    doc.font(bodyFont).fontSize(bodySize);
    for (const r of sample) {
      const txt = String(getCellPdf(r, d.key) ?? '');
      if (!txt) continue;
      for (const ln of txt.split(/\n/)) {
        const w = doc.widthOfString(ln);
        if (w > widest) widest = w;
      }
    }
    return Math.min(maxW, Math.max(minW, Math.ceil(widest + cellPad * 2)));
  });

  const totalDesired = desired.reduce((s, w) => s + w, 0);
  let widths;
  if (totalDesired <= innerW) {
    const slack = innerW - totalDesired;
    widths = desired.map((w) => w + (totalDesired > 0 ? (w / totalDesired) * slack : 0));
  } else {
    const scale = innerW / totalDesired;
    widths = desired.map((w) => Math.max(minW, w * scale));
    const scaledTotal = widths.reduce((s, w) => s + w, 0);
    widths[widths.length - 1] += innerW - scaledTotal;
  }

  let x = M;
  const cols = defs.map((d, i) => {
    const w = Math.max(minW, Math.round(widths[i] * 100) / 100);
    const col = { key: d.key, header: d.header, x, w, numeric: !!d.numeric };
    x += col.w;
    return col;
  });
  const last = cols[cols.length - 1];
  last.w = Math.max(minW, contentRight - last.x);
  return cols;
}

/**
 * @param {object} opts
 * @param {Array} opts.rows
 * @param {object} opts.parties - supplierRow, customerRow, logoBuffer, supplierLogoAbsPath
 * @param {Array<{key,header,width,numeric}>} opts.columnDefs
 * @param {Function} opts.getCellRaw
 * @param {string} opts.title
 * @param {string} [opts.sheetName]
 * @param {string} [opts.periodLabel]
 * @param {Array<{key:string}>} [opts.sumKeys] - columns to total in footer
 * @param {string} [opts.dateNumFmtKey] - column key for excel date format
 */
export async function buildStatementExcelBuffer(opts) {
  const {
    rows,
    parties = {},
    columnDefs,
    getCellRaw,
    title,
    sheetName = 'Transactions',
    periodLabel = '',
    sumKeys = [],
    dateNumFmtKey = null,
  } = opts;
  const { supplierRow, customerRow, logoBuffer, supplierLogoAbsPath } = parties;
  const defs = (columnDefs || []).filter(Boolean);
  if (!defs.length) throw new Error('No export columns defined');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, { properties: { defaultRowHeight: 18 } });
  const mergeEndCol = colLetter0(Math.max(defs.length, 4) - 1);

  let logoRowsUsed = 0;
  const slines = supplierLines(supplierRow);
  if (logoBuffer && supplierLogoAbsPath && supplierRow) {
    try {
      const imgId = wb.addImage({ buffer: logoBuffer, extension: exportLogoExtension(supplierLogoAbsPath) });
      ws.mergeCells('A1:B3');
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 72 } });
      [1, 2, 3].forEach((r) => {
        ws.getRow(r).height = 24;
      });
      ws.mergeCells(`C1:${mergeEndCol}4`);
      const sc = ws.getCell('C1');
      sc.value = slines;
      sc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      sc.font = { size: 10, name: 'Calibri' };
      logoRowsUsed = 4;
    } catch (_) {
      logoRowsUsed = 0;
    }
  }
  if (!logoRowsUsed && supplierRow) {
    ws.mergeCells(`A1:${mergeEndCol}3`);
    const sc = ws.getCell('A1');
    sc.value = slines;
    sc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    sc.font = { size: 10, bold: true, name: 'Calibri' };
    logoRowsUsed = 3;
  } else if (logoBuffer && supplierLogoAbsPath && !supplierRow) {
    try {
      const imgId = wb.addImage({ buffer: logoBuffer, extension: exportLogoExtension(supplierLogoAbsPath) });
      ws.mergeCells('A1:B3');
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 72 } });
      [1, 2, 3].forEach((r) => {
        ws.getRow(r).height = 24;
      });
      logoRowsUsed = 3;
    } catch (_) {
      logoRowsUsed = 0;
    }
  }

  let nextRow = logoRowsUsed > 0 ? logoRowsUsed + 1 : 1;
  if (customerRow) {
    const custText = [
      customerRow.name,
      customerRow.vehicle_registration ? `Vehicle registration: ${customerRow.vehicle_registration}` : '',
      customerRow.responsible_user_name ? `Responsible user: ${customerRow.responsible_user_name}` : '',
      customerRow.authorizer_name ? `Authorizer: ${customerRow.authorizer_name}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    ws.mergeCells(`A${nextRow}:${mergeEndCol}${nextRow}`);
    const cc = ws.getCell(`A${nextRow}`);
    cc.value = `Customer: ${custText}`;
    cc.font = { size: 10, bold: true, color: { argb: 'FF14532D' }, name: 'Calibri' };
    cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
    cc.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(nextRow).height = 28;
    nextRow += 1;
  }

  if (logoRowsUsed > 0 || customerRow) nextRow += 1;
  const titleR = nextRow;
  ws.mergeCells(`A${titleR}:${mergeEndCol}${titleR}`);
  const tcell = ws.getCell(`A${titleR}`);
  tcell.value = title;
  tcell.font = { size: 16, bold: true, color: { argb: 'FF0F172A' }, name: 'Calibri' };
  tcell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(titleR).height = 26;
  nextRow += 1;
  if (periodLabel && String(periodLabel).trim()) {
    ws.mergeCells(`A${nextRow}:${mergeEndCol}${nextRow}`);
    const sub = ws.getCell(`A${nextRow}`);
    sub.value = String(periodLabel).trim();
    sub.font = { size: 10, color: { argb: 'FF64748B' }, name: 'Calibri' };
    sub.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(nextRow).height = 22;
    nextRow += 1;
  }
  nextRow += 1;

  const headerRowIndex = nextRow;
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const thinBorder = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.height = 22;
  defs.forEach((def, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = def.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: def.numeric ? 'right' : 'left', wrapText: true };
    cell.border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
    ws.getColumn(i + 1).width = def.width;
  });

  const totals = Object.fromEntries(sumKeys.map((k) => [k.key, 0]));
  let dataRowIndex = headerRowIndex + 1;
  for (const m of rows) {
    const excelRow = ws.getRow(dataRowIndex);
    excelRow.height = 18;
    const stripe = dataRowIndex % 2 === 0;
    defs.forEach((def, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = getCellRaw(m, def.key);
      cell.value = raw === '' || raw == null ? '' : raw;
      cell.font = { size: 10, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: def.numeric ? 'right' : 'left', wrapText: true };
      cell.border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
      if (stripe) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      if (dateNumFmtKey && def.key === dateNumFmtKey && raw instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
      if (def.numeric && raw !== '' && typeof raw === 'number') {
        if (def.key === 'liters_filled' || def.decimals === 3) cell.numFmt = '0.000';
        else if (def.decimals === 4) cell.numFmt = '0.0000';
        else cell.numFmt = '0.00';
      }
    });
    for (const sk of sumKeys) {
      const v = getCellRaw(m, sk.key);
      if (typeof v === 'number' && Number.isFinite(v)) totals[sk.key] += v;
    }
    dataRowIndex += 1;
  }

  const sumRow = ws.getRow(dataRowIndex);
  sumRow.height = 20;
  defs.forEach((def, i) => {
    const cell = sumRow.getCell(i + 1);
    cell.font = { bold: true, size: 10, name: 'Calibri' };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF94A3B8' } },
      left: thinBorder,
      bottom: thinBorder,
      right: thinBorder,
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (i === 0) cell.value = 'TOTALS';
    else if (totals[def.key] != null && sumKeys.some((sk) => sk.key === def.key)) {
      const sk = sumKeys.find((s) => s.key === def.key);
      const dec = sk?.decimals ?? 2;
      cell.value = Math.round(totals[def.key] * 10 ** dec) / 10 ** dec;
    } else cell.value = '';
    cell.alignment = { horizontal: def.numeric ? 'right' : 'left', vertical: 'middle' };
  });

  ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildStatementPdfBuffer(opts) {
  const {
    rows,
    parties = {},
    columnDefs,
    getCellPdf,
    title,
    periodLabel = '',
    sumKeys = [],
    transactionsHeading = 'Transactions',
  } = opts;
  const { supplierRow, customerRow, logoBuffer } = parties;
  const defs = (columnDefs || []).filter(Boolean);
  const activeKeys = defs.map((d) => d.key);
  const orientation = activeKeys.length > 8 ? 'landscape' : 'portrait';
  const docMargin = orientation === 'landscape' ? 28 : 36;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: orientation,
      margin: docMargin,
      info: { Title: title || 'Fuel statement' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = doc.page.margins.left;
    const R = doc.page.margins.right;
    const T = doc.page.margins.top;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentRight = pageW - R;
    const innerW = contentRight - M;
    const HEADER_FONT_SIZE = 7.5;
    const BODY_FONT_SIZE = orientation === 'landscape' ? 6.8 : 7;
    const CELL_PAD = 3;

    const layoutCols = pdfAutoFitColumns(doc, defs, rows, getCellPdf, {
      innerW,
      M,
      contentRight,
      headerSize: HEADER_FONT_SIZE,
      bodySize: BODY_FONT_SIZE,
      cellPad: CELL_PAD,
    });

    const LOGO_MAX_W = 120;
    const LOGO_MAX_H = 64;
    const GAP = 16;
    const LINE_GAP = 3;
    let y = T;

    if (supplierRow || logoBuffer) {
      const bandTop = y;
      let bandBottom = bandTop;
      if (logoBuffer && supplierRow) {
        try {
          doc.image(logoBuffer, M, bandTop, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
        } catch (_) {}
        const textLeft = M + LOGO_MAX_W + 16;
        const textW = Math.max(120, contentRight - textLeft);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Supplier', textLeft, bandTop, { width: textW });
        const ty = doc.y + 6;
        doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
        doc.text(supplierLines(supplierRow), textLeft, ty, { width: textW, lineGap: LINE_GAP });
        bandBottom = Math.max(bandTop + LOGO_MAX_H, doc.y) + 6;
      } else if (supplierRow) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Supplier', M, bandTop, { width: innerW });
        const ty = doc.y + 6;
        doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
        doc.text(supplierLines(supplierRow), M, ty, { width: innerW, lineGap: LINE_GAP });
        bandBottom = doc.y + 6;
      } else if (logoBuffer) {
        try {
          doc.image(logoBuffer, M, bandTop, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
          bandBottom = bandTop + LOGO_MAX_H + 6;
        } catch (_) {
          bandBottom = bandTop;
        }
      }
      y = bandBottom + 4;
    }

    if (customerRow) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Customer', M, y, { width: innerW });
      const ty = doc.y + 6;
      doc.font('Helvetica').fontSize(9).fillColor('#14532d');
      const cl = [
        customerRow.name,
        customerRow.vehicle_registration ? `Vehicle registration: ${customerRow.vehicle_registration}` : '',
        customerRow.responsible_user_name ? `Responsible user: ${customerRow.responsible_user_name}` : '',
        customerRow.authorizer_name ? `Authorizer: ${customerRow.authorizer_name}` : '',
      ].filter(Boolean);
      doc.text(cl.join('\n'), M, ty, { width: innerW, lineGap: LINE_GAP });
      y = doc.y + GAP;
      doc.fillColor('#000000');
    }

    y += 6;
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text(title || 'Statement', M, y, { width: innerW, align: 'center' });
    y = doc.y + 8;
    if (periodLabel && String(periodLabel).trim()) {
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      doc.text(String(periodLabel).trim(), M, y, { width: innerW, align: 'center', lineGap: 2 });
      y = doc.y + 10;
    } else {
      y += 4;
    }
    doc.fillColor('#000000');

    const pageBottom = pageH - R - 28;
    const cellPad = CELL_PAD;
    const rowVPad = 2;
    const rowMinH = 11;
    const lineGap = 0.5;

    const measureRowHeight = (m) => {
      doc.font('Helvetica').fontSize(BODY_FONT_SIZE);
      let h = rowMinH;
      for (const c of layoutCols) {
        const s = String(getCellPdf(m, c.key) || '');
        if (!s) continue;
        const ch = doc.heightOfString(s, { width: Math.max(10, c.w - cellPad * 2), lineGap });
        if (ch > h) h = ch;
      }
      return Math.ceil(h + rowVPad * 2);
    };

    const drawTableHeader = (yy) => {
      doc.font('Helvetica-Bold').fontSize(HEADER_FONT_SIZE).fillColor('#111111');
      let headerH = rowMinH;
      for (const c of layoutCols) {
        const ch = doc.heightOfString(String(c.header || ''), { width: Math.max(10, c.w - cellPad * 2), lineGap });
        if (ch > headerH) headerH = ch;
      }
      headerH = Math.ceil(headerH);
      layoutCols.forEach((c) => {
        doc.text(c.header, c.x + cellPad, yy, {
          width: Math.max(10, c.w - cellPad * 2),
          align: c.numeric ? 'right' : 'left',
          lineGap,
        });
      });
      const lineY = yy + headerH + 3;
      doc.moveTo(M, lineY).lineTo(contentRight, lineY).lineWidth(0.55).strokeColor('#64748b').stroke();
      doc.fillColor('#000000');
      return lineY + 5;
    };

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text(transactionsHeading, M, y);
    y = doc.y + 6;
    y = drawTableHeader(y);
    doc.font('Helvetica').fontSize(BODY_FONT_SIZE).fillColor('#0f172a');

    const totals = Object.fromEntries(sumKeys.map((k) => [k.key, 0]));
    for (const m of rows) {
      const rowH = measureRowHeight(m);
      if (y + rowH > pageBottom) {
        doc.addPage();
        y = T + 8;
        y = drawTableHeader(y);
        doc.font('Helvetica').fontSize(BODY_FONT_SIZE).fillColor('#0f172a');
      }
      layoutCols.forEach((c) => {
        doc.text(String(getCellPdf(m, c.key) || ''), c.x + cellPad, y + rowVPad, {
          width: Math.max(10, c.w - cellPad * 2),
          align: c.numeric ? 'right' : 'left',
          lineGap,
        });
      });
      const sepY = y + rowH - 0.5;
      doc.moveTo(M, sepY).lineTo(contentRight, sepY).lineWidth(0.25).strokeColor('#e2e8f0').stroke();
      y += rowH;
      for (const sk of sumKeys) {
        const raw = getCellPdf(m, sk.key);
        const n = Number(String(raw).replace(/[^\d.-]/g, ''));
        if (Number.isFinite(n)) totals[sk.key] += n;
      }
    }

    y += 8;
    if (y + 22 > pageBottom) {
      doc.addPage();
      y = T + 8;
    }
    doc.moveTo(M, y).lineTo(contentRight, y).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    y += 10;
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a');
    const firstCol = layoutCols[0];
    if (firstCol) doc.text('Totals', firstCol.x + cellPad, y, { width: Math.max(10, firstCol.w - cellPad * 2) });
    layoutCols.forEach((c) => {
      if (totals[c.key] != null && sumKeys.some((sk) => sk.key === c.key)) {
        const sk = sumKeys.find((s) => s.key === c.key);
        const dec = sk?.decimals ?? 2;
        doc.text(totals[c.key].toFixed(dec), c.x + cellPad, y, {
          width: Math.max(10, c.w - cellPad * 2),
          align: 'right',
        });
      }
    });
    doc.end();
  });
}
