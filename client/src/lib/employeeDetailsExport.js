import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { accounting } from '../api.js';

const COLS = [
  { key: 'email', header: 'Email', width: 28 },
  { key: 'full_name', header: 'Full name', width: 22 },
  { key: 'updatedAt', header: 'Record updated', width: 18 },
  { key: 'legalFirstNames', header: 'First names (ID)', width: 20 },
  { key: 'legalSurname', header: 'Surname (ID)', width: 18 },
  { key: 'idDocumentNumber', header: 'ID / passport', width: 16 },
  { key: 'residentialAddress', header: 'Residential address', width: 36 },
  { key: 'nextOfKinName', header: 'Next of kin name', width: 20 },
  { key: 'nextOfKinRelationship', header: 'NOK relationship', width: 14 },
  { key: 'nextOfKinPhone', header: 'NOK phone', width: 14 },
  { key: 'nextOfKinEmail', header: 'NOK email', width: 24 },
  { key: 'medicalAidProvider', header: 'Medical aid provider', width: 22 },
  { key: 'medicalAidMemberNo', header: 'Medical member no.', width: 16 },
  { key: 'medicalAidPlan', header: 'Medical plan', width: 16 },
  { key: 'medicalAidNotes', header: 'Medical notes', width: 24 },
  { key: 'bankName', header: 'Bank', width: 16 },
  { key: 'bankAccountHolder', header: 'Account holder', width: 22 },
  { key: 'bankAccountNumber', header: 'Account number', width: 18 },
  { key: 'bankBranchCode', header: 'Branch code', width: 12 },
  { key: 'bankAccountType', header: 'Account type', width: 14 },
  { key: 'attachmentsSummary', header: 'Attachments (folder: file)', width: 40 },
];

const SLATE = [30, 41, 59];
const SLATE_MID = [51, 65, 85];
const MUTED = [71, 85, 105];
const BORDER = [226, 232, 240];
const STRIPE = [248, 250, 252];
const HEADER_GREY = [241, 245, 249];

function str(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s || '';
}

function formatUpdated(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function rowFromBundle(bundle) {
  const u = bundle.user || {};
  const det = bundle.details || {};
  const atts = bundle.attachments || [];
  const attachmentsSummary = atts.map((a) => `${str(a.folder_name)}: ${str(a.file_name)}`).join(' | ');
  return {
    email: str(u.email),
    full_name: str(u.full_name),
    updatedAt: formatUpdated(det.updatedAt),
    legalFirstNames: str(det.legalFirstNames),
    legalSurname: str(det.legalSurname),
    idDocumentNumber: str(det.idDocumentNumber),
    residentialAddress: str(det.residentialAddress),
    nextOfKinName: str(det.nextOfKinName),
    nextOfKinRelationship: str(det.nextOfKinRelationship),
    nextOfKinPhone: str(det.nextOfKinPhone),
    nextOfKinEmail: str(det.nextOfKinEmail),
    medicalAidProvider: str(det.medicalAidProvider),
    medicalAidMemberNo: str(det.medicalAidMemberNo),
    medicalAidPlan: str(det.medicalAidPlan),
    medicalAidNotes: str(det.medicalAidNotes),
    bankName: str(det.bankName),
    bankAccountHolder: str(det.bankAccountHolder),
    bankAccountNumber: str(det.bankAccountNumber),
    bankBranchCode: str(det.bankBranchCode),
    bankAccountType: str(det.bankAccountType),
    attachmentsSummary,
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function naturalImageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 120, h: img.naturalHeight || 40 });
    img.onerror = () => resolve({ w: 120, h: 40 });
    img.src = dataUrl;
  });
}

function guessPdfImageFormat(dataUrl) {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/gif')) return 'GIF';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

async function loadAccountingLetterhead() {
  const settings = await accounting.companySettings.get().catch(() => ({}));
  let logoDataUrl = null;
  if (settings.logo_url) {
    try {
      const res = await fetch(accounting.companySettings.logoUrl(), { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await blobToDataUrl(blob);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return {
    companyName: str(settings.company_name),
    address: str(settings.address),
    vatNumber: str(settings.vat_number),
    companyRegistration: str(settings.company_registration),
    website: str(settings.website),
    email: str(settings.email),
    logoDataUrl,
  };
}

async function drawAccountingLetterhead(doc, lh, margin, pageW, startY) {
  const contentW = pageW - 2 * margin;
  let y = startY;

  if (lh.logoDataUrl) {
    const fmt = guessPdfImageFormat(lh.logoDataUrl);
    const { w: nw, h: nh } = await naturalImageSize(lh.logoDataUrl);
    const maxH = 42;
    const maxW = 120;
    let dw = maxW;
    let dh = (nh / nw) * maxW;
    if (dh > maxH) {
      dh = maxH;
      dw = (nw / nh) * maxH;
    }
    const tryAdd = (f) => {
      try {
        doc.addImage(lh.logoDataUrl, f, margin, y, dw, dh);
        return true;
      } catch {
        return false;
      }
    };
    if (!tryAdd(fmt)) {
      if (!tryAdd('JPEG')) tryAdd('PNG');
    }
    y += dh + 10;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  const displayName = lh.companyName || 'Company';
  doc.text(displayName, margin, y);
  y += 22;

  doc.setDrawColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.setLineWidth(1);
  doc.line(margin, y, margin + Math.min(contentW * 0.42, 220), y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  if (lh.address) {
    const lines = doc.splitTextToSize(lh.address, contentW);
    doc.text(lines, margin, y);
    y += lines.length * 11 + 6;
  }
  const regVat = [lh.companyRegistration && `Co. registration: ${lh.companyRegistration}`, lh.vatNumber && `VAT: ${lh.vatNumber}`]
    .filter(Boolean)
    .join('     ');
  if (regVat) {
    doc.text(regVat, margin, y);
    y += 12;
  }
  const contact = [lh.email, lh.website].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.text(contact, margin, y);
    y += 14;
  }

  doc.setTextColor(0, 0, 0);
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('Employee details report', margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  const stamp = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  doc.text(`Generated ${stamp} · confidential HR extract`, margin, y);
  y += 20;
  doc.setTextColor(0, 0, 0);
  return y;
}

function drawLetterheadContinuation(doc, lh, margin, pageW, startY) {
  const contentW = pageW - 2 * margin;
  let y = startY;
  doc.setFillColor(HEADER_GREY[0], HEADER_GREY[1], HEADER_GREY[2]);
  doc.rect(margin, y, contentW, 36, 'F');
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.5);
  doc.rect(margin, y, contentW, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  const t = `${lh.companyName || 'Company'}  ·  Employee details (continued)`;
  doc.text(t, margin + 10, y + 16);
  doc.setTextColor(0, 0, 0);
  return y + 40;
}

function ensureVerticalSpace(doc, ctx, needed) {
  if (ctx.y + needed <= ctx.pageH - ctx.margin) return;
  doc.addPage();
  ctx.y = ctx.margin;
  ctx.y = drawLetterheadContinuation(doc, ctx.lh, ctx.margin, ctx.pageW, ctx.y);
}

function drawKeyValueTable(doc, ctx, sectionTitle, pairs) {
  const { margin, pageW } = ctx;
  const contentW = pageW - 2 * margin;
  const labelW = Math.floor(contentW * 0.30);
  const valueW = contentW - labelW;
  const pad = 6;
  const lineStep = 10.5;
  const headerBand = 22;

  ensureVerticalSpace(doc, ctx, headerBand + 28);
  doc.setFillColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.rect(margin, ctx.y, contentW, headerBand, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(sectionTitle, margin + pad, ctx.y + 15);
  ctx.y += headerBand;

  let rowIndex = 0;
  for (const [lab, val] of pairs) {
    const v = str(val) || '—';
    const labLines = doc.splitTextToSize(lab, labelW - 2 * pad);
    const valLines = doc.splitTextToSize(v, valueW - 2 * pad);
    const lines = Math.max(labLines.length, valLines.length);
    const rowH = Math.max(lines * lineStep + 2 * pad, 26);

    ensureVerticalSpace(doc, ctx, rowH + 4);
    if (rowIndex % 2 === 1) {
      doc.setFillColor(STRIPE[0], STRIPE[1], STRIPE[2]);
      doc.rect(margin, ctx.y, contentW, rowH, 'F');
    }
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.35);
    doc.rect(margin, ctx.y, contentW, rowH);
    doc.line(margin + labelW, ctx.y, margin + labelW, ctx.y + rowH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(SLATE_MID[0], SLATE_MID[1], SLATE_MID[2]);
    doc.text(labLines, margin + pad, ctx.y + pad + 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(valLines, margin + labelW + pad, ctx.y + pad + 10);
    ctx.y += rowH;
    rowIndex += 1;
  }
  ctx.y += 10;
}

function drawEmployeeTitleBar(doc, ctx, title) {
  const { margin, pageW } = ctx;
  const contentW = pageW - 2 * margin;
  const h = 24;
  ensureVerticalSpace(doc, ctx, h + 8);
  doc.setFillColor(SLATE_MID[0], SLATE_MID[1], SLATE_MID[2]);
  doc.rect(margin, ctx.y, contentW, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(str(title) || 'Employee', margin + 10, ctx.y + 16);
  ctx.y += h;
  doc.setTextColor(0, 0, 0);
  ctx.y += 6;
}

function drawTwoColumnGrid(doc, ctx, sectionTitle, colLeft, colRight, rows) {
  const { margin, pageW } = ctx;
  const contentW = pageW - 2 * margin;
  const leftW = Math.floor(contentW * 0.32);
  const rightW = contentW - leftW;
  const pad = 6;
  const lineStep = 10;
  const titleH = 20;

  ensureVerticalSpace(doc, ctx, titleH + 40);
  doc.setFillColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.rect(margin, ctx.y, contentW, titleH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(sectionTitle, margin + pad, ctx.y + 14);
  ctx.y += titleH;

  const headerRowH = 20;
  ensureVerticalSpace(doc, ctx, headerRowH);
  doc.setFillColor(226, 232, 240);
  doc.rect(margin, ctx.y, contentW, headerRowH, 'F');
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.rect(margin, ctx.y, contentW, headerRowH);
  doc.line(margin + leftW, ctx.y, margin + leftW, ctx.y + headerRowH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text(colLeft, margin + pad, ctx.y + 13);
  doc.text(colRight, margin + leftW + pad, ctx.y + 13);
  ctx.y += headerRowH;

  let ri = 0;
  for (const [left, right] of rows) {
    const l = str(left) || '—';
    const r = str(right) || '—';
    const lLines = doc.splitTextToSize(l, leftW - 2 * pad);
    const rLines = doc.splitTextToSize(r, rightW - 2 * pad);
    const n = Math.max(lLines.length, rLines.length);
    const rowH = Math.max(n * lineStep + 2 * pad, 22);

    ensureVerticalSpace(doc, ctx, rowH);
    if (ri % 2 === 1) {
      doc.setFillColor(STRIPE[0], STRIPE[1], STRIPE[2]);
      doc.rect(margin, ctx.y, contentW, rowH, 'F');
    }
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.35);
    doc.rect(margin, ctx.y, contentW, rowH);
    doc.line(margin + leftW, ctx.y, margin + leftW, ctx.y + rowH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(lLines, margin + pad, ctx.y + pad + 9);
    doc.text(rLines, margin + leftW + pad, ctx.y + pad + 9);
    ctx.y += rowH;
    ri += 1;
  }
  ctx.y += 12;
}

/** @param {Array<Record<string, unknown>>} bundles */
export async function downloadEmployeeDetailsExcel(bundles) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thinkers Management';
  const sheet = wb.addWorksheet('Employee details', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7EEF7' },
  };
  for (const b of bundles) {
    sheet.addRow(rowFromBundle(b));
  }
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `employee-details-${stamp}.xlsx`);
}

/** @param {Array<Record<string, unknown>>} bundles */
export async function downloadEmployeeDetailsPdf(bundles) {
  const lh = await loadAccountingLetterhead();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  let y = await drawAccountingLetterhead(doc, lh, margin, pageW, margin);
  const ctx = { doc, lh, y, pageH, pageW, margin };

  for (const bundle of bundles) {
    const u = bundle.user || {};
    const det = bundle.details || {};
    const atts = bundle.attachments || [];

    drawEmployeeTitleBar(doc, ctx, str(u.full_name) || 'Employee');

    drawKeyValueTable(doc, ctx, 'Contact & record', [
      ['Work email', u.email],
      ['Record last updated', formatUpdated(det.updatedAt)],
    ]);

    drawKeyValueTable(doc, ctx, 'Identity & address (as on ID)', [
      ['First name(s)', det.legalFirstNames],
      ['Surname', det.legalSurname],
      ['ID / passport number', det.idDocumentNumber],
      ['Residential address', det.residentialAddress],
    ]);

    drawKeyValueTable(doc, ctx, 'Next of kin', [
      ['Full name', det.nextOfKinName],
      ['Relationship', det.nextOfKinRelationship],
      ['Phone', det.nextOfKinPhone],
      ['NOK email', det.nextOfKinEmail],
    ]);

    drawKeyValueTable(doc, ctx, 'Medical aid', [
      ['Provider / scheme', det.medicalAidProvider],
      ['Member number', det.medicalAidMemberNo],
      ['Plan / option', det.medicalAidPlan],
      ['Notes', det.medicalAidNotes],
    ]);

    drawKeyValueTable(doc, ctx, 'Banking', [
      ['Bank', det.bankName],
      ['Account holder', det.bankAccountHolder],
      ['Account number', det.bankAccountNumber],
      ['Branch code', det.bankBranchCode],
      ['Account type', det.bankAccountType],
    ]);

    const attRows = atts.length ? atts.map((a) => [str(a.folder_name), str(a.file_name)]) : [['—', 'No attachments on file']];
    drawTwoColumnGrid(doc, ctx, 'Attachments', 'Folder', 'File name', attRows);

    ctx.y += 6;
  }

  doc.save(`employee-details-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
