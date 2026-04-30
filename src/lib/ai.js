import OpenAI from 'openai';

export function getAiApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

export function getAiModel() {
  const explicit = String(process.env.OPENAI_MODEL || '').trim();
  if (explicit) return explicit;
  const legacy = String(process.env.OPENAI_RESEARCH_MODEL || '').trim();
  if (legacy) return legacy;
  return 'gpt-4o-mini';
}

export function isAiConfigured() {
  return !!getAiApiKey();
}

let client;
export function getOpenAiClient() {
  const apiKey = getAiApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing');
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

