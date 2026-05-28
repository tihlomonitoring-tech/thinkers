import { getAiModel, getOpenAiClient, isAiConfigured } from './ai.js';

const IMPROVE_MAX_CHARS = 2400;
const CONTEXT_MAX_CHARS = 3200;
const IMPROVE_MAX_TOKENS = 380;
const SUMMARY_MAX_TOKENS = 520;

const rateBuckets = new Map();

function checkRateLimit(userId, action, limit, windowMs) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const err = new Error('Too many AI requests. Please wait a few minutes and try again.');
    err.status = 429;
    throw err;
  }
}

function clip(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function parseJsonObject(raw) {
  const text = String(raw || '')
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(text);
}

/**
 * Compact narrative context for summary generation (keeps token use low).
 */
export function buildShiftReportContextBrief(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const lines = [];
  const push = (label, val) => {
    const t = clip(val, 280);
    if (t) lines.push(`${label}: ${t}`);
  };

  push('Route', p.route || (Array.isArray(p.routes) ? p.routes.join(', ') : ''));
  push('Report date', p.report_date);
  push('Shift', [p.shift_date, p.shift_start, p.shift_end].filter(Boolean).join(' '));
  push('Controllers', [p.controller1_name, p.controller2_name].filter(Boolean).join(' & '));
  push('Trucks scheduled', p.total_trucks_scheduled);
  push('Loads dispatched', p.total_loads_dispatched);
  push('Pending deliveries', p.total_pending_deliveries);
  push('Loads delivered', p.total_loads_delivered);
  push('Balance brought down', p.balance_brought_down);

  const list = (title, items, fmt, max = 6) => {
    const rows = (items || []).slice(0, max);
    if (!rows.length) return;
    lines.push(`${title}:`);
    rows.forEach((row, i) => lines.push(`  ${i + 1}. ${clip(fmt(row), 200)}`));
    if ((items || []).length > max) lines.push(`  … +${items.length - max} more`);
  };

  list('Truck updates', p.truck_updates, (r) => [r.time, r.summary, r.delays].filter(Boolean).join(' | '));
  list('Incidents', p.incidents, (r) => [r.truck_reg, r.issue, r.status].filter(Boolean).join(' | '));
  list('Non-compliance', p.non_compliance_calls, (r) =>
    [r.rule_violated, r.summary, r.driver_response].filter(Boolean).join(' | ')
  );
  list('Investigations', p.investigations, (r) =>
    [r.truck_reg, r.issue_identified, r.findings, r.action_taken].filter(Boolean).join(' | ')
  );
  list('Communications', p.communication_log, (r) =>
    [r.recipient, r.subject, r.action_required].filter(Boolean).join(' | ')
  );
  list('Truck deliveries', p.truck_deliveries, (r) =>
    [r.truck_registration, r.completed_deliveries, r.remarks].filter(Boolean).join(' | ')
  );
  list('Route load totals', p.route_load_totals, (r) =>
    [r.route_name, r.total_loads_delivered].filter(Boolean).join(': ')
  );

  push('Outstanding issues', p.outstanding_issues);
  push('Handover', p.handover_key_info);
  push('Current overall performance draft', p.overall_performance);
  push('Current key highlights draft', p.key_highlights);

  return lines.join('\n').slice(0, CONTEXT_MAX_CHARS);
}

export async function improveShiftReportText({ text, fieldLabel, contextBrief, userId }) {
  if (!isAiConfigured()) {
    const err = new Error('AI is not configured on the server (OPENAI_API_KEY).');
    err.status = 503;
    throw err;
  }
  const input = clip(text, IMPROVE_MAX_CHARS);
  if (!input) {
    const err = new Error('Enter some text before requesting improvements.');
    err.status = 400;
    throw err;
  }
  checkRateLimit(userId, 'improve', 40, 60 * 60 * 1000);

  const client = getOpenAiClient();
  const completion = await client.chat.completions.create({
    model: getAiModel(),
    temperature: 0.2,
    max_tokens: IMPROVE_MAX_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You edit South African logistics/telematics shift report text. Fix grammar and spelling; improve professional clarity. Do not invent facts, numbers, names, or events. Keep meaning. Return JSON only: {"revised":"full improved text","tip":"one short optional writing tip or empty string"}',
      },
      {
        role: 'user',
        content: `Field: ${clip(fieldLabel, 80)}\n${contextBrief ? `Report context (reference only):\n${clip(contextBrief, 900)}\n\n` : ''}Text to improve:\n${input}`,
      },
    ],
  });

  let parsed;
  try {
    parsed = parseJsonObject(completion.choices?.[0]?.message?.content);
  } catch (_) {
    const err = new Error('AI returned an invalid response. Try again.');
    err.status = 502;
    throw err;
  }
  return {
    revised: clip(parsed.revised, IMPROVE_MAX_CHARS + 200),
    tip: clip(parsed.tip, 200),
  };
}

export async function generateShiftReportSummary({ contextBrief, userId }) {
  if (!isAiConfigured()) {
    const err = new Error('AI is not configured on the server (OPENAI_API_KEY).');
    err.status = 503;
    throw err;
  }
  const ctx = clip(contextBrief, CONTEXT_MAX_CHARS);
  if (!ctx || ctx.length < 40) {
    const err = new Error('Add more shift details (metrics, updates, or incidents) before generating a summary.');
    err.status = 400;
    throw err;
  }
  checkRateLimit(userId, 'summary', 12, 60 * 60 * 1000);

  const client = getOpenAiClient();
  const completion = await client.chat.completions.create({
    model: getAiModel(),
    temperature: 0.35,
    max_tokens: SUMMARY_MAX_TOKENS,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You write concise shift report summaries for a South African coal/logistics control room. Use only facts from the context. overall_performance: 2–4 professional sentences. key_highlights: 3–5 bullet lines starting with "• ". No markdown headings. Return JSON only: {"overall_performance":"...","key_highlights":"..."}',
      },
      {
        role: 'user',
        content: `Shift report data:\n${ctx}`,
      },
    ],
  });

  let parsed;
  try {
    parsed = parseJsonObject(completion.choices?.[0]?.message?.content);
  } catch (_) {
    const err = new Error('AI returned an invalid response. Try again.');
    err.status = 502;
    throw err;
  }
  return {
    overall_performance: clip(parsed.overall_performance, 2000),
    key_highlights: clip(parsed.key_highlights, 1200),
  };
}
