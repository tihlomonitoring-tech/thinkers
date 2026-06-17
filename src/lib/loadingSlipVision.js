import { getOpenAiClient, getAiModel, isAiConfigured } from './ai.js';

function parseJsonFromModel(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, raw: text };
  }
}

function pickNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Normalize vision model output for loading / weighbridge slips (South African mining logistics). */
export function normalizeLoadingSlipExtracted(extracted) {
  if (!extracted || extracted.parse_error) return extracted;
  const tons = pickNum(extracted.tons_loaded ?? extracted.tons ?? extracted.net_tons ?? extracted.weight_tonnes);
  let kg = pickNum(extracted.net_weight_kg ?? extracted.weight_kg);
  if (tons == null && kg != null && kg > 500) {
    // Likely kg on slip — convert to tonnes for logistics activity
    return {
      loading_slip_no: String(extracted.loading_slip_no ?? extracted.slip_no ?? extracted.slip_number ?? '').trim(),
      driver_name: String(extracted.driver_name ?? extracted.driver ?? extracted.operator_name ?? '').trim(),
      tons_loaded: Math.round((kg / 1000) * 1000) / 1000,
      loaded_at: String(extracted.loaded_at ?? extracted.loading_datetime ?? extracted.date_time ?? '').trim(),
      notes: String(extracted.notes ?? extracted.remarks ?? '').trim(),
    };
  }
  return {
    loading_slip_no: String(extracted.loading_slip_no ?? extracted.slip_no ?? extracted.slip_number ?? '').trim(),
    driver_name: String(extracted.driver_name ?? extracted.driver ?? extracted.operator_name ?? '').trim(),
    tons_loaded: tons,
    loaded_at: String(extracted.loaded_at ?? extracted.loading_datetime ?? extracted.date_time ?? '').trim(),
    notes: String(extracted.notes ?? extracted.remarks ?? '').trim(),
  };
}

/** Read a loading slip photo with OpenAI vision. */
export async function parseLoadingSlipImage(buffer, mime = 'image/jpeg') {
  if (!isAiConfigured()) {
    const err = new Error('OPENAI_API_KEY not set — AI slip reading unavailable.');
    err.status = 503;
    throw err;
  }
  const b64 = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
  const client = getOpenAiClient();
  const model = getAiModel();
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You read handwritten or printed LOADING / weighbridge slips for bulk haulage (coal, minerals). Reply with ONE JSON object only, no markdown.\n' +
          'Fields:\n' +
          '- loading_slip_no: slip / ticket / document number (string, or empty)\n' +
          '- driver_name: driver / operator name if shown (string, or empty)\n' +
          '- tons_loaded: net mass in metric TONNES if shown (number or null). If only kg is shown, put kg in net_weight_kg instead.\n' +
          '- net_weight_kg: net mass in kilograms if only kg is printed (number or null)\n' +
          '- loaded_at: combine printed date and time into ISO 8601 local context, or empty string\n' +
          '- notes: any remarks / product / grade line worth keeping (string, or empty)\n' +
          'Use null for missing numbers; empty string for missing text.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this loading slip image and return the JSON object.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      },
    ],
    max_tokens: 700,
  });
  const raw = completion.choices?.[0]?.message?.content;
  const parsed = parseJsonFromModel(raw);
  if (parsed.parse_error) return parsed;
  return normalizeLoadingSlipExtracted(parsed);
}
