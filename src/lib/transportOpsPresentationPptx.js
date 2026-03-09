import pptxgen from 'pptxgenjs';

// Slide size: 10" x 5.625" (standard 16:9 in pptxgenjs)
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.5;
const CONTENT_W = SLIDE_W - MARGIN * 2; // 9"
const HEADING_H = 1.2;

const COLORS = {
  primary: '0f172a',
  accent: '0369a1',
  text: '1e293b',
  textMuted: '64748b',
  border: 'cbd5e1',
  bgAlt: 'f1f5f9',
  white: 'ffffff',
};

/**
 * Build a PowerPoint presentation. Uses explicit slide size and consistent layout.
 */
export async function buildTransportOpsPresentationPptx(data) {
  const pres = new pptxgen();

  // Force slide size so layout is predictable (inches)
  pres.defineLayout({ name: 'OPS_16x9', width: SLIDE_W, height: SLIDE_H });
  pres.layout = 'OPS_16x9';

  const title = data.title || 'Production Report';
  const tenantName = data.tenantName || '';
  const dateFrom = data.dateFrom || '';
  const dateTo = data.dateTo || '';
  const dateRange = [dateFrom, dateTo].filter(Boolean).join('  →  ') || 'All dates';
  const summary = data.summary || {};
  const timeSeries = Array.isArray(data.timeSeries) ? data.timeSeries : [];
  const byShift = Array.isArray(data.byShift) ? data.byShift : [];
  const byRoute = Array.isArray(data.byRoute) ? data.byRoute : [];
  const incidentsList = Array.isArray(data.incidentsList) ? data.incidentsList : [];
  const nonComplianceList = Array.isArray(data.nonComplianceList) ? data.nonComplianceList : [];
  const investigationsList = Array.isArray(data.investigationsList) ? data.investigationsList : [];

  function addSectionBar(slide, y0, titleText) {
    const barH = 0.5;
    slide.addShape('rect', { x: 0, y: y0, w: SLIDE_W, h: barH, fill: { color: COLORS.primary }, line: { type: 'none' } });
    slide.addShape('rect', { x: 0, y: y0, w: 0.08, h: barH, fill: { color: COLORS.accent }, line: { type: 'none' } });
    slide.addText(titleText, { x: MARGIN, y: y0 + 0.12, w: SLIDE_W - MARGIN * 2, h: barH - 0.24, fontSize: 16, bold: true, color: COLORS.white, align: 'left' });
    return y0 + barH + 0.2;
  }

  function addTable(slide, y0, rows, colW, fontSize = 10) {
    slide.addTable(rows, {
      x: MARGIN,
      y: y0,
      w: CONTENT_W,
      colW,
      h: Math.min(3.8, 0.32 * rows.length),
      border: { pt: 0.25, color: COLORS.border },
      fill: { color: COLORS.bgAlt },
      fontSize,
      align: 'left',
      margin: 0.06,
      valign: 'middle',
    });
  }

  // —— Slide 1: Title ——
  const s1 = pres.addSlide();
  s1.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: HEADING_H, fill: { color: COLORS.primary }, line: { type: 'none' } });
  s1.addShape('rect', { x: 0, y: HEADING_H, w: SLIDE_W, h: 0.06, fill: { color: COLORS.accent }, line: { type: 'none' } });
  s1.addText(title, { x: MARGIN, y: 0.28, w: SLIDE_W - MARGIN * 2, h: 0.5, fontSize: 22, bold: true, color: COLORS.white, align: 'center' });
  if (tenantName) {
    s1.addText(tenantName, { x: MARGIN, y: 0.78, w: SLIDE_W - MARGIN * 2, h: 0.32, fontSize: 11, color: '94a3b8', align: 'center' });
  }
  s1.addText(dateRange, { x: MARGIN, y: HEADING_H + 0.25, w: SLIDE_W - MARGIN * 2, h: 0.3, fontSize: 10, color: COLORS.textMuted, align: 'center' });
  s1.addText('Transport Operations', { x: MARGIN, y: SLIDE_H - 0.35, w: SLIDE_W - MARGIN * 2, h: 0.28, fontSize: 8, color: '94a3b8', align: 'center' });

  // —— Slide 2: Summary ——
  const s2 = pres.addSlide();
  const y2 = addSectionBar(s2, 0, '  Executive summary');
  const summaryRows = [
    ['Metric', 'Value'],
    ['Approved shift reports', String(summary.report_count ?? 0)],
    ['Total loads delivered', String(summary.total_loads_delivered ?? 0)],
    ['Incidents', String(summary.total_incidents ?? 0)],
    ['Non-compliance calls', String(summary.total_non_compliance ?? 0)],
    ['Investigations', String(summary.total_investigations ?? 0)],
    ['Communications logged', String(summary.total_communications ?? 0)],
    ['Avg loads per report', summary.report_count ? (Number(summary.total_loads_delivered || 0) / summary.report_count).toFixed(1) : '—'],
  ];
  addTable(s2, y2, summaryRows, [5, 2.8], 10);

  // —— Slide 3: Production by day ——
  if (timeSeries.length > 0) {
    const s3 = pres.addSlide();
    const y3 = addSectionBar(s3, 0, '  Production by day');
    const maxRows = 9;
    const rows = timeSeries.slice(0, maxRows);
    const tableRows = [['Date', 'Reports', 'Loads', 'Incidents', 'Non-compl.'], ...rows.map((r) => [r.date || '—', String(r.report_count ?? 0), String(r.loads_delivered ?? 0), String(r.incidents ?? 0), String(r.non_compliance ?? 0)])];
    addTable(s3, y3, tableRows, [1.3, 0.9, 1.1, 1, 1.1], 9);
    if (timeSeries.length > maxRows) {
      s3.addText(`First ${maxRows} of ${timeSeries.length} days.`, { x: MARGIN, y: 4.85, w: CONTENT_W, h: 0.25, fontSize: 8, color: COLORS.textMuted });
    }
  }

  // —— Slide 4: By shift ——
  if (byShift.length > 0) {
    const s4 = pres.addSlide();
    const y4 = addSectionBar(s4, 0, '  Production by shift');
    const shiftRows = [['Shift', 'Reports', 'Loads delivered'], ...byShift.map((s) => [s.shift || '—', String(s.report_count ?? 0), String(s.loads_delivered ?? 0)])];
    addTable(s4, y4, shiftRows, [3, 2.5, 3.5], 10);
  }

  // —— Slide 5: By route ——
  if (byRoute.length > 0) {
    const s5 = pres.addSlide();
    const y5 = addSectionBar(s5, 0, '  Production by route');
    const routeRows = [['Route', 'Trips', 'Loads'], ...byRoute.slice(0, 9).map((r) => [r.route || '—', String(r.trip_count ?? 0), String(r.loads_delivered ?? 0)])];
    addTable(s5, y5, routeRows, [5, 1.8, 2.2], 10);
    if (byRoute.length > 9) {
      s5.addText(`${byRoute.length} routes; top 9 shown.`, { x: MARGIN, y: 4.85, w: CONTENT_W, h: 0.25, fontSize: 8, color: COLORS.textMuted });
    }
  }

  // —— Slide 6: Incidents ——
  if (incidentsList.length > 0) {
    const s6 = pres.addSlide();
    const y6 = addSectionBar(s6, 0, '  Incidents & breakdowns');
    const maxInc = 7;
    const incRows = [['Date', 'Shift', 'Truck', 'Driver', 'Issue', 'Status'], ...incidentsList.slice(0, maxInc).map((i) => [i.report_date || '—', i.shift || '—', (i.truck_reg || '—').toString().slice(0, 9), (i.driver_name || '—').toString().slice(0, 10), (i.issue || '—').toString().slice(0, 18), (i.status || '—').toString().slice(0, 8)])];
    addTable(s6, y6, incRows, [0.95, 0.7, 0.95, 1.1, 2.2, 0.95], 8);
    if (incidentsList.length > maxInc) {
      s6.addText(`${incidentsList.length} incidents; first ${maxInc} shown.`, { x: MARGIN, y: 4.85, w: CONTENT_W, h: 0.25, fontSize: 8, color: COLORS.textMuted });
    }
  } else {
    const s6 = pres.addSlide();
    const y6 = addSectionBar(s6, 0, '  Incidents & breakdowns');
    s6.addText('No incidents in the selected period.', { x: MARGIN, y: y6 + 0.35, w: CONTENT_W, h: 0.35, fontSize: 11, color: COLORS.textMuted });
  }

  // —— Slide 7: Non-compliance ——
  if (nonComplianceList.length > 0) {
    const s7 = pres.addSlide();
    const y7 = addSectionBar(s7, 0, '  Non-compliance calls');
    const maxNc = 7;
    const ncRows = [['Date', 'Shift', 'Driver', 'Truck', 'Rule', 'Summary'], ...nonComplianceList.slice(0, maxNc).map((n) => [n.report_date || '—', n.shift || '—', (n.driver_name || '—').toString().slice(0, 9), (n.truck_reg || '—').toString().slice(0, 7), (n.rule_violated || '—').toString().slice(0, 12), (n.summary || '—').toString().slice(0, 20)])];
    addTable(s7, y7, ncRows, [0.85, 0.7, 1, 0.85, 1.4, 2], 8);
    if (nonComplianceList.length > maxNc) {
      s7.addText(`${nonComplianceList.length} calls; first ${maxNc} shown.`, { x: MARGIN, y: 4.85, w: CONTENT_W, h: 0.25, fontSize: 8, color: COLORS.textMuted });
    }
  } else {
    const s7 = pres.addSlide();
    const y7 = addSectionBar(s7, 0, '  Non-compliance calls');
    s7.addText('No non-compliance calls in the selected period.', { x: MARGIN, y: y7 + 0.35, w: CONTENT_W, h: 0.35, fontSize: 11, color: COLORS.textMuted });
  }

  // —— Slide 8: Investigations ——
  if (investigationsList.length > 0) {
    const s8 = pres.addSlide();
    const y8 = addSectionBar(s8, 0, '  Investigations');
    const maxInv = 5;
    const invRows = [['Date', 'Truck', 'Issue', 'Findings', 'Action'], ...investigationsList.slice(0, maxInv).map((i) => [i.report_date || '—', (i.truck_reg || '—').toString().slice(0, 7), (i.issue_identified || '—').toString().slice(0, 16), (i.findings || '—').toString().slice(0, 20), (i.action_taken || '—').toString().slice(0, 20)])];
    addTable(s8, y8, invRows, [0.85, 0.9, 1.8, 2.2, 2.2], 8);
    if (investigationsList.length > maxInv) {
      s8.addText(`${investigationsList.length} investigations; first ${maxInv} shown.`, { x: MARGIN, y: 4.85, w: CONTENT_W, h: 0.25, fontSize: 8, color: COLORS.textMuted });
    }
  } else {
    const s8 = pres.addSlide();
    const y8 = addSectionBar(s8, 0, '  Investigations');
    s8.addText('No investigations in the selected period.', { x: MARGIN, y: y8 + 0.35, w: CONTENT_W, h: 0.35, fontSize: 11, color: COLORS.textMuted });
  }

  // —— Slide 9: Closing ——
  const sEnd = pres.addSlide();
  sEnd.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: HEADING_H, fill: { color: COLORS.primary }, line: { type: 'none' } });
  sEnd.addText('End of report', { x: MARGIN, y: 0.38, w: SLIDE_W - MARGIN * 2, h: 0.5, fontSize: 20, bold: true, color: COLORS.white, align: 'center' });
  sEnd.addText(`Generated from Transport Operations · ${dateRange}`, { x: MARGIN, y: HEADING_H + 0.45, w: SLIDE_W - MARGIN * 2, h: 0.3, fontSize: 10, align: 'center', color: COLORS.textMuted });
  sEnd.addShape('rect', { x: SLIDE_W / 2 - 1.1, y: 3, w: 2.2, h: 0.05, fill: { color: COLORS.accent }, line: { type: 'none' } });
  sEnd.addText('Thank you', { x: MARGIN, y: 3.4, w: SLIDE_W - MARGIN * 2, h: 0.35, fontSize: 12, align: 'center', color: COLORS.text });

  return pres.write({ outputType: 'nodebuffer' });
}
