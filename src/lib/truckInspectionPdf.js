import fs from 'fs';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function isExternal(insp) {
  return String(insp?.source || '').toLowerCase() === 'external_driver';
}

function trailerLabel(insp) {
  const t1 = insp.trailer_1_registration;
  const t2 = insp.trailer_2_registration;
  if (t1 && t2) return `${t1} / ${t2}`;
  return t1 || t2 || insp.trailer_registration || '—';
}

function drawInfoGrid(doc, yRef, M, CW, FONT, insp, external) {
  const inspWhen = insp.inspection_datetime || insp.inspection_date;
  const infoRows = external
    ? [
        [['Fleet registration', insp.truck_reg || insp.fleet_registration || '—'], ['Trailer 1', insp.trailer_1_registration || '—'], ['Trailer 2', insp.trailer_2_registration || '—']],
        [['Date / time', fmtDateTime(inspWhen)], ['Inspection type', (insp.inspection_type || 'side_tipper_national').replace(/_/g, ' ')], ['Inspector', `${insp.inspector_name} (driver)`]],
        [['Contractor', insp.inspector_company || insp.contractor_name || '—'], ['Checklist score', `${insp.passed_items} pass · ${insp.failed_items} fail · ${insp.na_items} N/A`], ['Source', 'External driver portal']],
      ]
    : [
        [['Fleet registration', insp.truck_reg || insp.fleet_registration || '—'], ['Trailer', trailerLabel(insp)], ['ODO (km)', insp.odometer_reading != null ? Number(insp.odometer_reading).toLocaleString() : '—']],
        [['Date', fmtDate(insp.inspection_date)], ['Inspection type', (insp.inspection_type || '').replace(/_/g, ' ')], ['Inspector', `${insp.inspector_name} (${(insp.inspector_role || '').replace(/_/g, ' ')})`]],
        [['Company / contractor', insp.inspector_company || '—'], ['Checklist score', `${insp.passed_items} pass · ${insp.failed_items} fail · ${insp.na_items} N/A`], ['Recorded by', insp.created_by_name || '—']],
      ];

  doc.rect(M, yRef.current, CW, 8).fill('#1E3A5F');
  doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFF').text('INSPECTION DETAILS', M + 6, yRef.current + 2.5);
  yRef.current += 10;

  const colW = CW / 3;
  for (const row of infoRows) {
    doc.rect(M, yRef.current, CW, 22).fill('#EFF6FF').strokeColor('#BFDBFE').lineWidth(0.3).stroke();
    let x = M;
    for (const [label, value] of row) {
      doc.font(FONT).fontSize(5.5).fillColor('#64748B').text(label.toUpperCase(), x + 4, yRef.current + 3, { width: colW - 8 });
      doc.font(FONT + '-Bold').fontSize(7.5).fillColor('#0F172A').text(String(value).slice(0, 60), x + 4, yRef.current + 11, { width: colW - 8 });
      if (x > M) {
        doc.moveTo(x, yRef.current).lineTo(x, yRef.current + 22).stroke();
      }
      x += colW;
    }
    yRef.current += 24;
  }
  yRef.current += 6;
}

function drawScoreSummary(doc, yRef, M, CW, FONT, insp, PASS_CLR, FAIL_CLR) {
  const barY = yRef.current;
  const passW = insp.total_items > 0 ? (insp.passed_items / insp.total_items) * CW : 0;
  const failW = insp.total_items > 0 ? (insp.failed_items / insp.total_items) * CW : 0;
  const naW = insp.total_items > 0 ? (insp.na_items / insp.total_items) * CW : 0;

  doc.rect(M, barY, CW, 8).fill('#E2E8F0');
  if (passW > 0) doc.rect(M, barY, passW, 8).fill(PASS_CLR);
  if (failW > 0) doc.rect(M + passW, barY, failW, 8).fill(FAIL_CLR);
  if (naW > 0) doc.rect(M + passW + failW, barY, naW, 8).fill('#94A3B8');

  const legendY = barY + 12;
  doc.font(FONT).fontSize(6).fillColor('#6B7280');
  doc.rect(M, legendY, 6, 6).fill(PASS_CLR);
  doc.text(`Pass (${insp.passed_items})`, M + 10, legendY + 0.5, { lineBreak: false, width: 50 });
  doc.rect(M + 62, legendY, 6, 6).fill(FAIL_CLR);
  doc.text(`Fail (${insp.failed_items})`, M + 72, legendY + 0.5, { lineBreak: false, width: 50 });
  doc.rect(M + 124, legendY, 6, 6).fill('#94A3B8');
  doc.text(`N/A (${insp.na_items})`, M + 134, legendY + 0.5, { lineBreak: false, width: 50 });

  yRef.current = legendY + 14;
}

function drawChecklistHeader(doc, yRef, M, CW, BRAND, FONT) {
  const headerY = yRef.current;
  doc.rect(M, headerY, CW, 10).fill(BRAND);
  doc.font(FONT + '-Bold').fontSize(7.5).fillColor('#FFFFFF');
  doc.text('INSPECTION CHECKLIST', M + 6, headerY + 3, { width: CW - 12, lineBreak: false });
  yRef.current = headerY + 14;
}

function drawSignatures(doc, yRef, M, CW, BRAND, FONT, pageH, insp) {
  if (yRef.current + 70 > pageH - 30) { doc.addPage(); yRef.current = M; }

  doc.rect(M, yRef.current, CW, 8).fill(BRAND);
  doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFF').text('SIGNATURES & AUTHORISATION', M + 6, yRef.current + 2.5);
  yRef.current += 12;

  const boxW = (CW - 8) / 2;
  const boxH = 58;
  const y = yRef.current;

  // Inspector box
  doc.rect(M, y, boxW, boxH).fill('#FFFFFF').strokeColor('#CBD5E1').lineWidth(0.5).stroke();
  doc.font(FONT + '-Bold').fontSize(6.5).fillColor(BRAND).text('INSPECTOR SIGNATURE', M + 6, y + 5);
  doc.font(FONT).fontSize(6).fillColor('#475569').text(insp.inspector_name || '—', M + 6, y + 12);
  if (insp.inspector_signature_path && fs.existsSync(insp.inspector_signature_path)) {
    try {
      doc.image(insp.inspector_signature_path, M + 6, y + 18, { fit: [boxW - 12, 28] });
    } catch { /* skip */ }
  } else {
    doc.rect(M + 6, y + 18, boxW - 12, 28).dash(2, { space: 2 }).strokeColor('#CBD5E1').stroke().undash();
    doc.font(FONT).fontSize(5.5).fillColor('#94A3B8').text('Not signed', M + 6, y + 30, { width: boxW - 12, align: 'center' });
  }
  doc.font(FONT).fontSize(5.5).fillColor('#64748B');
  const inspWhen = insp.inspector_signed_at ? fmtDateTime(insp.inspector_signed_at) : 'Pending';
  doc.text(`Signed: ${inspWhen}`, M + 6, y + boxH - 8);

  // Supervisor box
  const sx = M + boxW + 8;
  doc.rect(sx, y, boxW, boxH).fill('#FFFFFF').strokeColor('#CBD5E1').lineWidth(0.5).stroke();
  const supTitle = insp.supervisor_role === 'maintenance_officer'
    ? 'MAINTENANCE OFFICER SIGNATURE'
    : 'SUPERVISOR SIGNATURE';
  doc.font(FONT + '-Bold').fontSize(6.5).fillColor(BRAND).text(supTitle, sx + 6, y + 5);
  doc.font(FONT).fontSize(6).fillColor('#475569').text(insp.supervisor_name || '—', sx + 6, y + 12);
  if (insp.supervisor_signature_path && fs.existsSync(insp.supervisor_signature_path)) {
    try {
      doc.image(insp.supervisor_signature_path, sx + 6, y + 18, { fit: [boxW - 12, 28] });
    } catch { /* skip */ }
  } else {
    doc.rect(sx + 6, y + 18, boxW - 12, 28).dash(2, { space: 2 }).strokeColor('#CBD5E1').stroke().undash();
    doc.font(FONT).fontSize(5.5).fillColor('#94A3B8').text('Awaiting review signature', sx + 6, y + 30, { width: boxW - 12, align: 'center' });
  }
  const supWhen = insp.supervisor_signed_at ? fmtDateTime(insp.supervisor_signed_at) : 'Pending';
  doc.font(FONT).fontSize(5.5).fillColor('#64748B').text(`Signed: ${supWhen}`, sx + 6, y + boxH - 8);

  yRef.current = y + boxH + 10;
}

/**
 * Render truck inspection PDF (contractor + external driver) into an existing PDFKit document.
 */
export function renderTruckInspectionPdf(doc, { inspection: insp, items = [], attachments = [], generatedAtLabel }) {
  const PW = doc.page.width;
  const M = 30;
  const CW = PW - M * 2;
  const pageH = doc.page.height;
  const BRAND = '#1E3A5F';
  const PASS_CLR = '#059669';
  const FAIL_CLR = '#DC2626';
  const WARN_CLR = '#D97706';
  const FONT = 'Helvetica';
  const external = isExternal(insp);
  const headerH = 64;

  const attByItem = {};
  for (const att of attachments || []) {
    if (!att.item_id) continue;
    if (!attByItem[att.item_id]) attByItem[att.item_id] = [];
    attByItem[att.item_id].push(att);
  }

  // ── Header ──
  doc.rect(0, 0, PW, headerH).fill(BRAND);
  doc.font(FONT + '-Bold').fontSize(14).fillColor('#FFF').text('THINKERS AFRIKA', M, 12);

  const subtitle = external
    ? 'External Driver Inspection — National Road Safety Standard (Side Tipper)'
    : 'Truck Inspection Report — SA National Road Safety Standard (Side Tipper Coal)';
  doc.font(FONT).fontSize(8).fillColor('#E2E8F0').text(subtitle, M, 28, { width: CW - 150 });

  if (insp.reference_number) {
    doc.font(FONT + '-Bold').fontSize(7.5).fillColor('#BFDBFE').text(`Reference: ${insp.reference_number}`, M, 38);
  }

  doc.font(FONT + '-Bold').fontSize(11).fillColor('#FFF').text(insp.fleet_registration || insp.truck_reg || '—', M, 48);

  const resultColor = insp.overall_result === 'pass' ? PASS_CLR : insp.overall_result === 'fail' ? FAIL_CLR : WARN_CLR;
  doc.roundedRect(PW - 170, 44, 140, 18, 3).fill(resultColor);
  doc.font(FONT + '-Bold').fontSize(10).fillColor('#FFF').text(
    (insp.overall_result || 'PENDING').toUpperCase(),
    PW - 166, 48,
    { width: 132, align: 'center' }
  );
  doc.fontSize(7).font(FONT).fillColor('#BFDBFE').text(
    `Generated: ${generatedAtLabel || fmtDateTime(new Date())}`,
    PW - 170, 14,
    { width: 140, align: 'right' }
  );

  const yRef = { current: headerH + 8 };

  drawInfoGrid(doc, yRef, M, CW, FONT, insp, external);
  drawScoreSummary(doc, yRef, M, CW, FONT, insp, PASS_CLR, FAIL_CLR);
  drawChecklistHeader(doc, yRef, M, CW, BRAND, FONT);

  let currentCat = '';
  for (const it of items) {
    if (yRef.current > pageH - 50) { doc.addPage(); yRef.current = M; }
    if (it.category !== currentCat) {
      currentCat = it.category;
      yRef.current += 2;
      if (yRef.current + 26 > pageH - 50) { doc.addPage(); yRef.current = M; }
      const catY = yRef.current;
      doc.rect(M, catY, CW, 12).fill('#334155');
      doc.font(FONT + '-Bold').fontSize(7).fillColor('#FFF').text(currentCat.toUpperCase(), M + 6, catY + 3, { width: CW - 12, lineBreak: false });
      yRef.current = catY + 14;
    }
    const rv = String(it.result || 'not_checked').toLowerCase();
    const resClr = rv === 'pass' ? PASS_CLR : rv === 'fail' ? FAIL_CLR : '#6B7280';
    const resLabel = rv === 'pass' ? 'PASS' : rv === 'fail' ? 'FAIL' : rv === 'n/a' || rv === 'na' ? 'N/A' : '—';
    const itemAtts = attByItem[it.id] || [];
    const hasPhoto = itemAtts.some((a) => fs.existsSync(a.file_path) && (a.mime_type || '').startsWith('image/'));
    let rowH = it.comment ? 18 : 12;
    if (hasPhoto) rowH += 4;
    if (yRef.current + rowH > pageH - 40) { doc.addPage(); yRef.current = M; }
    const rowY = yRef.current;
    const bg = rv === 'fail' ? '#FEF2F2' : '#FFFFFF';
    doc.rect(M, rowY, CW, rowH).fill(bg).strokeColor('#E2E8F0').lineWidth(0.3).stroke();
    doc.font(FONT).fontSize(6.5).fillColor('#6B7280').text(it.item_code, M + 6, rowY + 3, { width: 40, lineBreak: false });
    doc.font(FONT).fontSize(6.5).fillColor('#1a1a1a').text(it.item_label, M + 48, rowY + 3, { width: CW - 108, lineBreak: false });
    doc.roundedRect(M + CW - 48, rowY + 2, 42, 9, 2).fill(resClr);
    doc.font(FONT + '-Bold').fontSize(6).fillColor('#FFF').text(resLabel, M + CW - 46, rowY + 4, { width: 38, align: 'center', lineBreak: false });
    if (it.comment) {
      doc.font(FONT + '-Oblique').fontSize(5.5).fillColor('#6B7280').text(`Note: ${it.comment}`, M + 48, rowY + 12, { width: CW - 108 });
    }
    if (hasPhoto) {
      doc.font(FONT).fontSize(5).fillColor('#059669').text('Photo evidence attached below', M + 48, rowY + (it.comment ? 16 : 10), { width: CW - 108 });
    }
    yRef.current = rowY + rowH;

    for (const att of itemAtts) {
      if (!fs.existsSync(att.file_path)) continue;
      if (!(att.mime_type || '').startsWith('image/')) continue;
      const imgBlockH = 62;
      if (yRef.current + imgBlockH > pageH - 40) { doc.addPage(); yRef.current = M; }
      doc.font(FONT + '-Bold').fontSize(5.5).fillColor('#6B7280').text(`Evidence photo — ${it.item_code}`, M + 48, yRef.current + 2);
      yRef.current += 7;
      try {
        doc.image(att.file_path, M + 48, yRef.current, { fit: [CW - 56, 52], align: 'left', valign: 'top' });
        yRef.current += 54;
      } catch {
        doc.font(FONT).fontSize(5.5).fillColor('#DC2626').text('(Image could not be embedded)', M + 42, yRef.current + 2);
        yRef.current += 10;
      }
    }
  }

  if (insp.general_comments) {
    yRef.current += 8;
    if (yRef.current > pageH - 60) { doc.addPage(); yRef.current = M; }
    doc.font(FONT + '-Bold').fontSize(7).fillColor(BRAND).text('GENERAL COMMENTS', M, yRef.current);
    yRef.current += 10;
    doc.font(FONT).fontSize(7).fillColor('#1a1a1a').text(insp.general_comments, M, yRef.current, { width: CW });
    yRef.current += doc.heightOfString(insp.general_comments, { width: CW }) + 6;
  }

  if (insp.failure_summary) {
    yRef.current += 4;
    if (yRef.current > pageH - 60) { doc.addPage(); yRef.current = M; }
    doc.rect(M, yRef.current, CW, 3).fill(FAIL_CLR);
    yRef.current += 6;
    doc.font(FONT + '-Bold').fontSize(7).fillColor(FAIL_CLR).text('AUTOMATIC FAILURE DETECTION SUMMARY', M, yRef.current);
    yRef.current += 10;
    doc.font(FONT).fontSize(6.5).fillColor('#1a1a1a').text(insp.failure_summary, M, yRef.current, { width: CW });
    yRef.current += doc.heightOfString(insp.failure_summary, { width: CW }) + 6;
  }

  drawSignatures(doc, yRef, M, CW, BRAND, FONT, pageH, insp);
}

export { fmtDate, fmtDateTime };
