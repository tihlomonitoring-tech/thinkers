// Shared Excel template + helpers used by:
//   - Access management list distribution (src/routes/contractor.js)
//   - Command centre fleet verification (src/routes/commandCentre.js)
//
// Goal: every Excel attachment we generate uses one consistent look – professional blue header,
// tan contractor / sub-contractor banners, and a clean info block at the top of the sheet.

function formatExportDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const EXCEL_TEMPLATE = {
  titleFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e40af' } },
  titleFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 },
  subtitleFont: { size: 10, color: { argb: 'FF64748b' } },
  headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e40af' } },
  headerFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  borderThin: { style: 'thin', color: { argb: 'FFe2e8f0' } },
  footerFont: { size: 9, color: { argb: 'FF64748b' }, italic: true },
  // Office theme "Tan, Background 2, Darker 25%".
  groupBannerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC4BD97' } },
  groupBannerFont: { bold: true, color: { argb: 'FF1F2937' }, size: 11 },
  groupBannerBorder: { style: 'thin', color: { argb: 'FF8A8261' } },
  // "Tan, Background 2, Darker 50%" – contractor (outer) banner.
  contractorBannerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF948A54' } },
  contractorBannerFont: { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 },
  contractorBannerBorder: { style: 'medium', color: { argb: 'FF5C5638' } },
};

export const EXCEL_INFO_FONT = { size: 11, color: { argb: 'FF334155' } };
export const EXCEL_INFO_LABEL_FONT = { size: 11, color: { argb: 'FF64748b' }, bold: true };

/** Group rows by a key (preserving the existing relative order). Empty / null keys go to the "Unassigned" bucket. */
export function groupRowsByKey(rows, key, unassignedLabel = 'Unassigned') {
  const groups = new Map();
  for (const r of rows) {
    const raw = r ? r[key] : null;
    const label = raw != null ? String(raw).trim() : '';
    const bucket = label || unassignedLabel;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(r);
  }
  const names = [...groups.keys()].sort((a, b) => {
    if (a === unassignedLabel && b !== unassignedLabel) return 1;
    if (b === unassignedLabel && a !== unassignedLabel) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return names.map((name) => ({ name, rows: groups.get(name) }));
}

/** Build a 2-level grouping: contractor -> sub-contractor -> rows. Either level falls back to "Unassigned". */
export function groupRowsByContractorAndSubContractor(rows) {
  const contractorGroups = groupRowsByKey(rows, 'contractor');
  return contractorGroups.map((cg) => ({
    name: cg.name,
    subGroups: groupRowsByKey(cg.rows, 'sub_contractor'),
  }));
}

/** Write a centred banner row spanning all columns. `kind` switches between contractor vs sub-contractor styling. */
export function writeBannerRow(sheet, rowIndex, numCols, label, kind = 'sub_contractor') {
  if (numCols < 1) return rowIndex + 1;
  const lastColLetter = sheet.getColumn(numCols).letter;
  sheet.mergeCells(`A${rowIndex}:${lastColLetter}${rowIndex}`);
  const row = sheet.getRow(rowIndex);
  const isContractor = kind === 'contractor';
  row.height = isContractor ? 26 : 22;
  const cell = row.getCell(1);
  cell.value = (label || '').toString().toUpperCase();
  cell.font = isContractor ? EXCEL_TEMPLATE.contractorBannerFont : EXCEL_TEMPLATE.groupBannerFont;
  cell.fill = isContractor ? EXCEL_TEMPLATE.contractorBannerFill : EXCEL_TEMPLATE.groupBannerFill;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const b = isContractor ? EXCEL_TEMPLATE.contractorBannerBorder : EXCEL_TEMPLATE.groupBannerBorder;
  cell.border = { top: b, left: b, bottom: b, right: b };
  return rowIndex + 1;
}

/** True when groupBy is requested AND the resulting columns contain the grouping key. */
export function shouldGroupByKey(groupBy, keys) {
  if (!groupBy) return false;
  const norm = String(groupBy).toLowerCase();
  if (norm !== 'sub_contractor') return false;
  return Array.isArray(keys) && keys.some((k) => String(k).toLowerCase() === 'sub_contractor');
}

/** Apply professional template: header row styling, data borders, frozen header, auto column widths. */
export function styleDistributionSheet(worksheet, numCols, headerLabels, opts = {}) {
  const headerRowIndex = opts.headerRowIndex ?? 1;
  const hasTitle = opts.hasTitle === true;
  const hasInfoBlock = opts.hasInfoBlock === true;
  const footerRowIndex = opts.footerRowIndex;
  const dataRowCount = opts.dataRowCount ?? 0;

  if (numCols >= 1) {
    const lastColLetter = worksheet.getColumn(numCols).letter;
    if (hasTitle && !hasInfoBlock) {
      worksheet.mergeCells(`A1:${lastColLetter}1`);
      const titleRow = worksheet.getRow(1);
      titleRow.height = 28;
      titleRow.getCell(1).font = EXCEL_TEMPLATE.titleFont;
      titleRow.getCell(1).fill = EXCEL_TEMPLATE.titleFill;
      titleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      if (opts.subtitleRowIndex) {
        worksheet.mergeCells(`A${opts.subtitleRowIndex}:${lastColLetter}${opts.subtitleRowIndex}`);
        const subRow = worksheet.getRow(opts.subtitleRowIndex);
        subRow.getCell(1).font = EXCEL_TEMPLATE.subtitleFont;
        subRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      }
    }

    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.height = 24;
    for (let c = 1; c <= numCols; c++) {
      const cell = headerRow.getCell(c);
      cell.font = EXCEL_TEMPLATE.headerFont;
      cell.fill = EXCEL_TEMPLATE.headerFill;
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cell.border = { top: EXCEL_TEMPLATE.borderThin, left: EXCEL_TEMPLATE.borderThin, bottom: EXCEL_TEMPLATE.borderThin, right: EXCEL_TEMPLATE.borderThin };
    }
    const bannerRowSetForWidth = new Set(Array.isArray(opts.bannerRowIndexes) ? opts.bannerRowIndexes : []);
    const minWidth = opts.minColumnWidth ?? 12;
    const maxWidth = opts.maxColumnWidth ?? 40;
    for (let c = 1; c <= numCols; c++) {
      const label = (headerLabels && headerLabels[c - 1]) ? String(headerLabels[c - 1]) : '';
      let maxLen = label.length;
      if (dataRowCount > 0) {
        for (let r = headerRowIndex + 1; r <= headerRowIndex + dataRowCount; r++) {
          if (bannerRowSetForWidth.has(r)) continue;
          try {
            const cell = worksheet.getRow(r).getCell(c);
            const val = cell && cell.value != null ? String(cell.value) : '';
            if (val.length > maxLen) maxLen = val.length;
          } catch (_) { /* ignore */ }
        }
      }
      worksheet.getColumn(c).width = Math.min(maxWidth, Math.max(minWidth, maxLen + 4));
    }
  }

  worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex, activeCell: `A${headerRowIndex + 1}` }];

  const borderStyle = EXCEL_TEMPLATE.borderThin;
  const bannerRowSet = new Set(Array.isArray(opts.bannerRowIndexes) ? opts.bannerRowIndexes : []);
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex && rowNumber !== footerRowIndex && !bannerRowSet.has(rowNumber)) {
      row.alignment = { vertical: 'middle', wrapText: true };
      for (let c = 1; c <= numCols; c++) {
        const cell = row.getCell(c);
        if (cell) cell.border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
      }
    }
  });

  if (footerRowIndex) {
    const lastColLetter = worksheet.getColumn(numCols).letter;
    worksheet.mergeCells(`A${footerRowIndex}:${lastColLetter}${footerRowIndex}`);
    const footerRow = worksheet.getRow(footerRowIndex);
    footerRow.getCell(1).font = EXCEL_TEMPLATE.footerFont;
    footerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  }
}

/** Generic info block at the top of a sheet. Accepts an array of [label, value] tuples.
 *  Returns the index of the first row available for the column header (one row gap after the block). */
export function writeInfoBlock(sheet, infoRows) {
  const rows = Array.isArray(infoRows) ? infoRows.filter((row) => Array.isArray(row) && row.length >= 2) : [];
  if (rows.length === 0) {
    sheet.addRow([]);
    return 2;
  }
  rows.forEach(([label, value], i) => {
    const r = sheet.getRow(i + 1);
    r.height = 20;
    r.getCell(1).value = label;
    r.getCell(1).font = EXCEL_INFO_LABEL_FONT;
    r.getCell(1).alignment = { vertical: 'middle' };
    r.getCell(2).value = value == null || value === '' ? '—' : value;
    r.getCell(2).font = EXCEL_INFO_FONT;
    r.getCell(2).alignment = { vertical: 'middle', wrapText: true };
  });
  // One spacer row after the block, then header.
  return rows.length + 2;
}

/** Backwards-compatible wrapper: Company / Route / Date & time block used by list distribution. */
export function writeDistributionInfoBlock(sheet, opts) {
  const companyName = opts.companyName != null ? String(opts.companyName).trim() : '';
  const routeName = opts.routeName != null ? String(opts.routeName).trim() : '';
  const generated = opts.generated instanceof Date ? opts.generated : (opts.generated != null ? new Date(opts.generated) : new Date());
  const dateTimeStr = formatExportDateTime(generated);
  return writeInfoBlock(sheet, [
    ['Company:', companyName || '—'],
    ['Route:', routeName || '—'],
    ['Date & time:', dateTimeStr],
  ]);
}

/** Write data rows below the header. When groupBy is on, inserts a contractor banner and a
 *  sub-contractor banner before each block of rows. Rows missing a sub-contractor go directly under
 *  their main contractor (no "Unassigned" sub-band).
 *  Returns { dataRowCount, bannerRowIndexes }. */
export function writeListRows(sheet, headerRowIndex, keys, rows, groupBy) {
  const banners = [];
  const useGrouping = shouldGroupByKey(groupBy, keys);
  if (!useGrouping) {
    rows.forEach((r) => sheet.addRow(keys.map((k) => r[k] ?? '')));
    return { dataRowCount: rows.length, bannerRowIndexes: banners };
  }
  const groups = groupRowsByContractorAndSubContractor(rows);
  let written = 0;
  for (const contractorGroup of groups) {
    const totalRowsForContractor = contractorGroup.subGroups.reduce((n, sg) => n + sg.rows.length, 0);
    if (totalRowsForContractor === 0) continue;
    const contractorBannerIndex = headerRowIndex + 1 + written;
    sheet.addRow([]);
    writeBannerRow(sheet, contractorBannerIndex, keys.length, contractorGroup.name, 'contractor');
    banners.push(contractorBannerIndex);
    written += 1;
    const namedSubGroups = [];
    const unassignedRows = [];
    for (const sg of contractorGroup.subGroups) {
      if (sg.rows.length === 0) continue;
      if (sg.name === 'Unassigned') unassignedRows.push(...sg.rows);
      else namedSubGroups.push(sg);
    }
    for (const r of unassignedRows) {
      sheet.addRow(keys.map((k) => r[k] ?? ''));
      written += 1;
    }
    for (const sg of namedSubGroups) {
      const subBannerIndex = headerRowIndex + 1 + written;
      sheet.addRow([]);
      writeBannerRow(sheet, subBannerIndex, keys.length, sg.name, 'sub_contractor');
      banners.push(subBannerIndex);
      written += 1;
      for (const r of sg.rows) {
        sheet.addRow(keys.map((k) => r[k] ?? ''));
        written += 1;
      }
    }
  }
  return { dataRowCount: written, bannerRowIndexes: banners };
}

/** Generic helper to write a styled list sheet (info block + blue header + data rows).
 *  opts:
 *    sheetName       string (default 'Sheet')
 *    headers         string[] (column labels)
 *    keys            string[] (matching row property keys)
 *    rows            object[]
 *    info            [label, value][] tuples for the info block (optional; renders before the header)
 *    groupBy         optional 'sub_contractor' to bucket rows under contractor/sub-contractor banners
 *    minColumnWidth  number (default 12)
 *    maxColumnWidth  number (default 40)
 *    columnWidths    optional Record<key, number> to force a specific width per column (px)
 *    autoFilter      boolean – when true, attaches column filters to the header row
 *    valueStyles     optional Record<key, Record<value, { fill?: argb, font?: object }>> –
 *                    per-cell styling when the cell's text equals `value`. */
export function buildStyledListSheet(workbook, opts) {
  const sheetName = opts.sheetName || 'Sheet';
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const keys = Array.isArray(opts.keys) ? opts.keys : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const info = Array.isArray(opts.info) ? opts.info : null;
  const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: true }] });

  const numCols = headers.length;
  if (numCols === 0) {
    if (info && info.length > 0) writeInfoBlock(sheet, info);
    return sheet;
  }

  let headerRowIndex;
  if (info && info.length > 0) {
    headerRowIndex = writeInfoBlock(sheet, info);
  } else {
    headerRowIndex = 1;
  }

  const headerRow = sheet.getRow(headerRowIndex);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });

  const { dataRowCount, bannerRowIndexes } = writeListRows(sheet, headerRowIndex, keys, rows, opts.groupBy);

  styleDistributionSheet(sheet, numCols, headers, {
    headerRowIndex,
    hasTitle: false,
    hasInfoBlock: info && info.length > 0,
    dataRowCount,
    bannerRowIndexes,
    minColumnWidth: opts.minColumnWidth,
    maxColumnWidth: opts.maxColumnWidth,
  });

  if (opts.columnWidths && typeof opts.columnWidths === 'object') {
    keys.forEach((key, i) => {
      const w = opts.columnWidths[key];
      if (typeof w === 'number' && w > 0) sheet.getColumn(i + 1).width = w;
    });
  }

  // Apply value-based cell styles (e.g., highlight integrated rows with olive green).
  if (opts.valueStyles && typeof opts.valueStyles === 'object' && dataRowCount > 0) {
    const bannerSet = new Set(bannerRowIndexes);
    for (let r = headerRowIndex + 1; r <= headerRowIndex + dataRowCount; r++) {
      if (bannerSet.has(r)) continue;
      keys.forEach((key, i) => {
        const rules = opts.valueStyles[key];
        if (!rules) return;
        const cell = sheet.getRow(r).getCell(i + 1);
        const text = cell && cell.value != null ? String(cell.value) : '';
        const rule = rules[text];
        if (!rule) return;
        if (rule.fill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rule.fill } };
        }
        if (rule.font) {
          cell.font = { ...(cell.font || {}), ...rule.font };
        }
      });
    }
  }

  if (opts.autoFilter && dataRowCount >= 0) {
    sheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + Math.max(0, dataRowCount), column: numCols },
    };
  }

  return sheet;
}
