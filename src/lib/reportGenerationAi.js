import { getAiModel, getOpenAiClient, isAiConfigured } from './ai.js';

const REPORT_SCHEMA = `{
  "title": "string — performance report title including route/site",
  "prepared_by": "string",
  "reporting_period_start": "YYYY-MM-DD",
  "reporting_period_end": "YYYY-MM-DD",
  "submitted_date": "YYYY-MM-DD or null",
  "disclaimer": "short disclaimer paragraph for cover page",
  "executive_summary": "2-4 paragraph executive summary with specific numbers from data",
  "key_insights": [{ "title": "bold insight heading", "body": "analytical paragraph" }],
  "key_metrics": [{ "metric": "string", "value": "string", "commentary": "analytical context column" }],
  "sections": [{
    "heading": "section title without number",
    "subsections": [{
      "subheading": "optional e.g. 2.1 Baseline Metrics",
      "blocks": [
        { "type": "text", "text": "narrative paragraph or bullet list using • for bullets" },
        { "type": "table", "rows": [["Col1","Col2","Col3"], ["...","...","..."]] }
      ]
    }]
  }],
  "conclusion": { "summary": "strategic conclusion in bordered box style", "bullets": ["point"] },
  "recommendations": [{ "title": "numbered recommendation title", "issue": "issue bullet", "action": "action bullet" }]
}`;

/**
 * Generate structured monthly production report content from a data bundle.
 */
export async function generateProductionReportWithAi({
  dataBundle,
  title,
  preparedBy,
  dateFrom,
  dateTo,
  submittedDate,
  routeName,
  extraInstructions = '',
}) {
  if (!isAiConfigured()) {
    return { error: 'AI is not configured. Set OPENAI_API_KEY on the server.' };
  }

  const client = getOpenAiClient();
  const model = getAiModel();
  const bundleStr = JSON.stringify(dataBundle, null, 0).slice(0, 90000);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a senior transport operations analyst writing formal monthly circuit performance reports for South African coal logistics (hauliers, control room, power stations). Write in UK English, professional tone like a consulting report.

Return ONLY valid JSON (no markdown fences) matching this schema:
${REPORT_SCHEMA}

Rules:
- Use ONLY facts from the provided data bundle; do not invent truck registrations, dates, or incidents not present in the data.
- When tonnage is needed, use estimated_total_tonnage and tonnes_per_load_estimate from summary; label as estimated where appropriate.
- Include sections covering: Key Performance Metrics (table Metric|Value|Analytical Context), Performance Observations (daily volatility/phases), Haulier Breakdowns & Reliability, Non-Compliance Analysis, Investigations & Security, Fleet Performance by haulier, Top performers table if data allows.
- Use specific numbers: loads, days, haulier names, truck regs from breakdowns/investigations.
- key_metrics: 6-10 rows with meaningful analytical context.
- sections: 5-8 major thematic sections with subsections and blocks.
- recommendations: 4-6 items with Issue and Action format.
- For chart placeholders add a text block: "[Chart: production_chart — upload graph in Report Generation if needed]"
- Do not claim weather/strikes unless mentioned in shift_highlights or breakdown descriptions.`,
      },
      {
        role: 'user',
        content: `Report parameters:
Title: ${title || 'Monthly Performance Report'}
Route/circuit: ${routeName || dataBundle?.meta?.route_name || 'All routes'}
Period: ${dateFrom} to ${dateTo}
Prepared by: ${preparedBy || 'Tihlo (Thinkers Afrika)'}
Submitted: ${submittedDate || 'today'}
${extraInstructions ? `Additional instructions: ${extraInstructions}` : ''}

Data bundle:
${bundleStr}`,
      },
    ],
    max_tokens: 12000,
    temperature: 0.35,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || '';
  let parsed;
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { error: 'AI response was not valid JSON. Try again or shorten the date range.', raw: raw.slice(0, 500) };
  }

  return { content: parsed, model };
}
