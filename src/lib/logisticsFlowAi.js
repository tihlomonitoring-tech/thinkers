import { getAiModel, getOpenAiClient, isAiConfigured } from './ai.js';
import { parseLogisticsFlowText } from './logisticsFlowParse.js';

const ROW_SCHEMA = `{
  "rows": [
    {
      "registration": "string plate without spaces",
      "entity": "contractor name from paste if present",
      "status": "status text",
      "tons": number,
      "hours": number
    }
  ],
  "meta": { "date": "YYYY-MM-DD or null", "route": "route string or null" }
}`;

function routeContextBlock(opts = {}) {
  const label = String(opts.routeLabel || '').trim();
  const regs = opts.routeRegistrations || [];
  if (!label && !regs.length) return '';
  const sample = regs.slice(0, 200).join(', ');
  const more = regs.length > 200 ? ` … and ${regs.length - 200} more` : '';
  return `\nRoute context (use for validation — pasted trucks should be on this route):\n- Selected route: ${label || 'unknown'}\n- Enrolled registrations (${regs.length}): ${sample || 'none'}${more}\nPrefer registrations from this enrolment list when OCR is ambiguous.`;
}

/**
 * AI parse only when regex yields few rows; merges with regex when both succeed.
 * @param {string} text
 * @param {{ routeLabel?: string, routeRegistrations?: string[] }} [routeOpts]
 */
export async function parseLogisticsFlowWithAi(text, routeOpts = {}) {
  if (!isAiConfigured()) {
    return { error: 'OPENAI_API_KEY not configured' };
  }
  const regexResult = parseLogisticsFlowText(text);
  const client = getOpenAiClient();
  const model = getAiModel();
  const routeCtx = routeContextBlock(routeOpts);
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You extract truck fleet update lines from pasted operational text. Return ONLY valid JSON matching this schema (no markdown):\n${ROW_SCHEMA}\nRules: registration uppercase no spaces; tons and hours as numbers; include every truck line; ignore headers like FLEET UPDATE, day names; route/date in meta when present.${routeCtx}`,
      },
      {
        role: 'user',
        content: String(text || '').slice(0, 120000),
      },
    ],
    max_tokens: 4000,
    temperature: 0.1,
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || '';
  let parsed;
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch (_) {
    return {
      ...regexResult,
      parseMethod: 'regex',
      aiError: 'AI response was not valid JSON; using rule-based parse only.',
    };
  }
  const aiRows = (parsed.rows || [])
    .map((r, i) => ({
      registration: String(r.registration || '').replace(/\s/g, '').toUpperCase(),
      entity: String(r.entity || '').trim(),
      status: String(r.status || '').trim(),
      tons: Number(r.tons),
      hours: Number(r.hours),
      date: parsed.meta?.date || regexResult.meta?.date,
      route: parsed.meta?.route || regexResult.meta?.route,
      lineNumber: i + 1,
    }))
    .filter((r) => r.registration && !Number.isNaN(r.tons) && !Number.isNaN(r.hours));

  const rows = aiRows.length >= regexResult.rows.length ? aiRows : regexResult.rows;
  return {
    rows,
    warnings: regexResult.warnings,
    comments: regexResult.comments,
    meta: {
      date: parsed.meta?.date || regexResult.meta?.date,
      route: parsed.meta?.route || regexResult.meta?.route,
    },
    parseMethod: aiRows.length > regexResult.rows.length ? 'ai' : 'hybrid',
  };
}
