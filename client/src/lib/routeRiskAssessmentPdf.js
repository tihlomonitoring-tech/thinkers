import { jsPDF } from 'jspdf';
import { RISK_FACTOR_DEFS, SCORE_LABELS, computeRiskAssessment } from './routeRiskAssessment.js';

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER = 18;
const FONT = 'helvetica';

function wrap(doc, text, maxW) {
  if (!text) return [];
  return doc.splitTextToSize(String(text).trim(), Math.max(4, maxW - 1));
}

function checkPage(doc, yRef, need = 25) {
  if (yRef.current > PAGE_H - FOOTER - need) {
    doc.addPage();
    yRef.current = MARGIN;
  }
}

function sectionBar(doc, yRef, title) {
  checkPage(doc, yRef, 14);
  const y = yRef.current;
  doc.setFillColor(0, 0, 0);
  doc.rect(MARGIN, y, CONTENT_W, 6, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(String(title).toUpperCase(), MARGIN + 2, y + 4.2);
  yRef.current = y + 10;
  doc.setTextColor(33, 33, 33);
}

function bodyText(doc, yRef, text, maxW = CONTENT_W) {
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  const lines = wrap(doc, text, maxW);
  lines.forEach((line) => {
    checkPage(doc, yRef, 8);
    doc.text(line, MARGIN, yRef.current);
    yRef.current += 4.5;
  });
  yRef.current += 2;
}

function kvRow(doc, yRef, label, value) {
  checkPage(doc, yRef, 8);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.text(`${label}:`, MARGIN, yRef.current);
  doc.setFont(FONT, 'normal');
  const lines = wrap(doc, value || '—', CONTENT_W - 42);
  lines.forEach((line, i) => {
    if (i > 0) { yRef.current += 4; checkPage(doc, yRef, 8); }
    doc.text(line, MARGIN + 40, yRef.current);
  });
  yRef.current += 5;
}

export function generateRouteRiskAssessmentPdf({ route, tenantName, assessment, logoDataUrl }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const yRef = { current: MARGIN };
  const a = assessment || route?.risk_assessment;
  const summary = computeRiskAssessment(a);

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', MARGIN, yRef.current, 28, 14); yRef.current += 18; } catch { /* ignore */ }
  }

  doc.setFont(FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(180, 50, 50);
  doc.text('Route Risk Assessment', MARGIN, yRef.current);
  yRef.current += 8;
  doc.setFontSize(11);
  doc.setTextColor(33, 33, 33);
  doc.text(route?.name || 'Route', MARGIN, yRef.current);
  yRef.current += 6;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`${tenantName || 'Organisation'} · Generated ${new Date().toLocaleString('en-ZA')}`, MARGIN, yRef.current);
  yRef.current += 8;

  sectionBar(doc, yRef, 'Corridor overview');
  kvRow(doc, yRef, 'Loading site', route?.starting_point);
  kvRow(doc, yRef, 'Loading address', route?.loading_address);
  kvRow(doc, yRef, 'Destination', route?.destination);
  kvRow(doc, yRef, 'Destination address', route?.destination_address);
  kvRow(doc, yRef, 'Distance', route?.distance_km != null ? `${route.distance_km} km` : '—');
  kvRow(doc, yRef, 'Overall risk', `${summary.level_label} (${summary.average_score ?? '—'}/5 avg)`);
  kvRow(doc, yRef, 'Assessor', [a?.assessor_name, a?.assessor_role].filter(Boolean).join(' · ') || route?.risk_assessed_by_name || '—');
  kvRow(doc, yRef, 'Review due', a?.review_due_date || '—');
  kvRow(doc, yRef, 'Max speed', a?.recommended_max_speed_kmh != null ? `${a.recommended_max_speed_kmh} km/h` : '—');
  kvRow(doc, yRef, 'Night travel', a?.night_travel_allowed === false ? 'Not permitted' : 'Permitted with controls');
  kvRow(doc, yRef, 'Escort', a?.escort_required ? 'Required' : 'Not required');

  if (a?.corridor_summary) {
    sectionBar(doc, yRef, 'Corridor summary');
    bodyText(doc, yRef, a.corridor_summary);
  }
  if (a?.hazards_identified) {
    sectionBar(doc, yRef, 'Hazards identified');
    bodyText(doc, yRef, a.hazards_identified);
  }

  sectionBar(doc, yRef, 'Risk factor matrix');
  for (const sec of RISK_FACTOR_DEFS) {
    checkPage(doc, yRef, 20);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.text(sec.section, MARGIN, yRef.current);
    yRef.current += 5;
    for (const item of sec.items) {
      const score = a?.scores?.[item.id] ?? '—';
      const label = SCORE_LABELS[score] || '';
      checkPage(doc, yRef, 12);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.text(`${item.label}`, MARGIN + 2, yRef.current);
      doc.setFont(FONT, 'bold');
      doc.text(`${score}/5 ${label}`, MARGIN + 2, yRef.current + 4);
      doc.setFont(FONT, 'normal');
      const mit = a?.mitigations?.[item.id];
      const note = a?.notes?.[item.id];
      if (mit) {
        bodyText(doc, { current: yRef.current + 8 }, `Mitigation: ${mit}`, CONTENT_W - 4);
        yRef.current += 2;
      } else {
        yRef.current += 8;
      }
      if (note) bodyText(doc, yRef, `Notes: ${note}`, CONTENT_W - 4);
      yRef.current += 2;
    }
    yRef.current += 2;
  }

  if (a?.control_measures) {
    sectionBar(doc, yRef, 'Control measures');
    bodyText(doc, yRef, a.control_measures);
  }
  if (a?.emergency_plan) {
    sectionBar(doc, yRef, 'Emergency response plan');
    bodyText(doc, yRef, a.emergency_plan);
  }

  if (summary.recommendations?.length) {
    sectionBar(doc, yRef, 'Management recommendations');
    summary.recommendations.forEach((rec, i) => bodyText(doc, yRef, `${i + 1}. ${rec}`));
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Route Risk Assessment · ${route?.name || ''} · Page ${p} of ${pages}`, MARGIN, PAGE_H - 8);
  }

  return doc;
}

export function downloadRouteRiskAssessmentPdf(opts, filename) {
  const doc = generateRouteRiskAssessmentPdf(opts);
  const safe = (filename || opts?.route?.name || 'route-risk-assessment').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60);
  doc.save(`${safe}.pdf`);
}
