import { generateMonthlyPerformanceReportPdf } from './monthlyPerformanceReportPdf.js';

/**
 * Build PDF payload from AI report content + optional chart images by slot.
 */
export function buildProductionReportPdfPayload(report, content, options = {}) {
  const c = content || {};
  const chartImages = options.chartImages || {};

  const injectCharts = (sections) => {
    if (!Array.isArray(sections)) return [];
    return sections.map((sec) => ({
      ...sec,
      subsections: (sec.subsections || []).map((sub) => {
        const blocks = [...(sub.blocks || [])];
        for (const [slot, dataUrl] of Object.entries(chartImages)) {
          if (!dataUrl) continue;
          const marker = `[Chart: ${slot}`;
          const hasMarker = blocks.some((b) => b.type === 'text' && String(b.text || '').includes(marker));
          if (hasMarker) blocks.push({ type: 'image', base64: dataUrl });
        }
        return { ...sub, blocks };
      }),
    }));
  };

  const fleetPerf = (report?.data_bundle?.contractor_performance || []).map((h) => ({
    haulier: h.contractor_name,
    trips: h.trips ?? h.loads,
    pct_trips: h.pct_of_loads != null ? `${h.pct_of_loads}%` : '—',
    tonnage: h.estimated_tonnage ?? '—',
    pct_tonnage: h.pct_of_loads != null ? `${h.pct_of_loads}%` : '—',
    avg_t_per_trip: '35.03',
    trucks_deployed: h.trucks_active ?? '—',
  }));

  const breakdowns = (report?.data_bundle?.breakdowns || []).map((b) => ({
    date: b.reported_at,
    time: b.reported_at
      ? new Date(b.reported_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : '—',
    route: b.route_name,
    truck_reg: b.truck_registration,
    description: b.title || b.description,
    company: b.tenant_name,
  }));

  return {
    title: c.title || report?.title || 'Performance Report',
    prepared_by: c.prepared_by || report?.prepared_by || 'Tihlo (Thinkers Afrika)',
    reporting_period_start: c.reporting_period_start || report?.date_from,
    reporting_period_end: c.reporting_period_end || report?.date_to,
    submitted_date: c.submitted_date || report?.submitted_date,
    disclaimer: c.disclaimer,
    executive_summary: c.executive_summary,
    key_insights: c.key_insights,
    key_metrics: (c.key_metrics || []).map((m) => ({
      metric: m.metric,
      value: m.value,
      commentary: m.commentary || m.analytical_context,
    })),
    sections: injectCharts(c.sections),
    conclusion: c.conclusion,
    recommendations: c.recommendations,
    breakdowns,
    fleet_performance: fleetPerf.length ? fleetPerf : undefined,
  };
}

export function generateProductionReportPdf(report, content, options = {}) {
  const payload = buildProductionReportPdfPayload(report, content, options);
  return generateMonthlyPerformanceReportPdf(payload, options);
}
