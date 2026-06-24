import PDFDocument from 'pdfkit';

const PAGE = { w: 595.28, h: 841.89, margin: 40 };
const BG = '#0a0a0a';
const TABLE_BORDER = '#3a3a3a';
const TABLE_HEAD = '#1a1a1a';
const TEXT = '#ffffff';
const MUTED = '#b0b0b0';
const ACCENT = '#60a5fa';

function fmt(v) {
  if (v == null || v === '') return '—';
  const s = String(v).trim();
  if (!s || /^undef(ined)?$/i.test(s) || s === '-' || s.toLowerCase() === 'null') return '—';
  return s;
}

function statusLabel(status) {
  const map = {
    valid: 'Verified',
    mismatch: 'Mismatch',
    partial: 'Partial data',
    invalid: 'Not found',
    error: 'Error',
    unavailable: 'Not configured',
  };
  return map[status] || status || '—';
}

function drawPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, PAGE.w, PAGE.h).fill(BG);
  doc.restore();
}

function drawTitle(doc, y, title, subtitle) {
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(16).text(title, PAGE.margin, y);
  y = doc.y + 4;
  if (subtitle) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(subtitle, PAGE.margin, y);
    y = doc.y + 10;
  }
  return y + 6;
}

function drawTable(doc, startY, title, rows) {
  const tableW = PAGE.w - PAGE.margin * 2;
  const labelW = 170;
  const valueW = tableW - labelW;
  const rowH = 22;
  let y = startY;

  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text(title, PAGE.margin, y);
  y += 18;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const bg = i % 2 === 0 ? '#121212' : '#0f0f0f';
    doc.save();
    doc.rect(PAGE.margin, y, tableW, rowH).fill(bg);
    doc.rect(PAGE.margin, y, tableW, rowH).strokeColor(TABLE_BORDER).lineWidth(0.5).stroke();
    doc.rect(PAGE.margin + labelW, y, 0.5, rowH).fill(TABLE_BORDER);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(fmt(row[0]), PAGE.margin + 8, y + 7, { width: labelW - 12 });
    doc.fillColor(TEXT).font('Helvetica').fontSize(9).text(fmt(row[1]), PAGE.margin + labelW + 8, y + 7, { width: valueW - 12 });
    doc.restore();
    y += rowH;
  }
  return y + 14;
}

function providerDisplayName(provider) {
  if (provider === 'mie') return 'MIE';
  if (provider === 'nps') return 'NP Tracker';
  return provider || '—';
}

export function buildNpTrackerReportPdfBuffer({ application, verification, checkedAt, checkedByName }) {
  const v = verification?.verified || {};
  const app = application || {};
  const entity = app.entity || {};

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawPageBackground(doc);
    let y = PAGE.margin;
    const providerName = providerDisplayName(verification?.provider);
    y = drawTitle(
      doc,
      y,
      `${providerName} — SA Vehicle Register Check`,
      `Generated ${checkedAt ? new Date(checkedAt).toLocaleString() : new Date().toLocaleString()}${checkedByName ? ` · ${checkedByName}` : ''}`
    );

    y = drawTable(doc, y, 'Application on file', [
      ['Contractor', app.contractorName],
      ['Sub-contractor', app.subcontractorDisplay],
      ['Registration', entity.registration || verification?.registration],
      ['Make / model (application)', entity.make_model],
      ['Year model', entity.year_model],
      ['Fleet no.', entity.fleet_no],
      ['Ownership', entity.ownership_desc],
      ['Tracking provider', entity.tracking_provider],
      ['Application status', app.status],
    ]);

    y = drawTable(doc, y, 'Register check result', [
      ['Status', statusLabel(verification?.status)],
      ['Message', verification?.message],
      ['Provider', providerDisplayName(verification?.provider)],
      ['Checked at', verification?.checkedAt ? new Date(verification.checkedAt).toLocaleString() : '—'],
      ['Registration match', verification?.registrationMatch == null ? '—' : verification.registrationMatch ? 'Yes' : 'No'],
      ['Make/model match', verification?.makeModelMatch == null ? '—' : verification.makeModelMatch ? 'Yes' : 'No'],
      ['Suspect flag', v.suspectFlag ? 'Yes' : 'No'],
    ]);

    y = drawTable(doc, y, `Vehicle details (${providerName} register)`, [
      ['Plate', v.plate || verification?.registration],
      ['VIN', v.vin],
      ['Make', v.make],
      ['Model', v.model],
      ['Description', v.description],
      ['Colour', v.colour],
      ['Engine no.', v.engineNumber],
      ['Source ID', v.sourceId],
      ['Picture URL', v.pictureUrl],
    ]);

    if (y > PAGE.h - 80) {
      doc.addPage();
      drawPageBackground(doc);
      y = PAGE.margin;
    }

    const footerNote =
      verification?.provider === 'nps'
        ? 'NP Tracker may withhold part of the VIN for security. Re-run the check in Command Centre when register data changes.'
        : 'Re-run the MIE check in Command Centre when register data changes.';
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(footerNote,
      PAGE.margin,
      PAGE.h - PAGE.margin - 20,
      { width: PAGE.w - PAGE.margin * 2, align: 'center' }
    );

    doc.end();
  });
}
