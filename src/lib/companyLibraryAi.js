import fs from 'fs';
import { getAiModel, getOpenAiClient, isAiConfigured } from './ai.js';

const MAX_EXCERPT_CHARS = 120_000;
/** Total character budget sent to the model (stratified from long files). */
const MODEL_INPUT_CHARS = 96_000;

function buildStratifiedExcerpt(raw, maxChars) {
  const t = String(raw || '').trim();
  if (!t.length) return '';
  if (t.length <= maxChars) return t;
  const chunk = Math.floor((maxChars - 400) / 3);
  if (chunk < 500) return t.slice(0, maxChars);
  const head = t.slice(0, chunk);
  const midPos = Math.floor((t.length - chunk) / 2);
  const mid = t.slice(midPos, midPos + chunk);
  const tail = t.slice(-chunk);
  return [
    head,
    '\n\n--- [Middle of document excerpt] ---\n\n',
    mid,
    '\n\n--- [End of document excerpt] ---\n\n',
    tail,
    `\n\n(NOTE: File is longer than shown; ${t.length.toLocaleString()} characters total.)`,
  ].join('');
}

export async function extractTextSample(absPath, mimeType, originalName) {
  const mime = String(mimeType || '').toLowerCase();
  const lower = String(originalName || '').toLowerCase();
  try {
    const buf = fs.readFileSync(absPath);

    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.docx')
    ) {
      try {
        const mammoth = (await import('mammoth')).default;
        const { value } = await mammoth.extractRawText({ buffer: buf });
        return normalizeWs(String(value || '')).slice(0, MAX_EXCERPT_CHARS);
      } catch {
        return '';
      }
    }

    if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lower.endsWith('.xlsx')) {
      try {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const lines = [];
        wb.eachSheet((sheet, sheetIndex) => {
          if (sheetIndex > 15) return;
          lines.push(`[${sheet.name}]`);
          let rowNum = 0;
          sheet.eachRow({ includeEmpty: false }, (row) => {
            rowNum += 1;
            if (rowNum > 4000) return false;
            const cells = [];
            row.eachCell({ includeEmpty: false }, (cell) => {
              cells.push(cellText(cell.value));
            });
            if (cells.length) lines.push(cells.join(' | '));
          });
        });
        return lines.join('\n').trim().slice(0, MAX_EXCERPT_CHARS);
      } catch {
        return '';
      }
    }

    if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buf);
        const text = String(data.text || '')
          .replace(/\r\n/g, '\n')
          .replace(/[ \t]+/g, ' ')
          .trim();
        return text.slice(0, MAX_EXCERPT_CHARS);
      } catch {
        return '';
      }
    }

    if (mime.startsWith('text/') || mime === 'application/json' || lower.endsWith('.csv')) {
      return normalizeWs(buf.toString('utf8')).slice(0, MAX_EXCERPT_CHARS);
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeWs(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('text' in v && v.text != null) return String(v.text);
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((x) => x.text || '').join('');
    if ('result' in v && v.result != null) return String(v.result);
  }
  return '';
}

export async function summarizeForLibrary({ displayTitle, fileName, textSample }) {
  if (!isAiConfigured()) {
    return {
      summary: `Document “${displayTitle || fileName}”. Add OPENAI_API_KEY on the server for AI analysis of file contents and better search.`,
      status: 'no_ai',
    };
  }

  const raw = (textSample || '').trim();
  const sample = buildStratifiedExcerpt(raw, MODEL_INPUT_CHARS);
  const truncated = raw.length > MODEL_INPUT_CHARS;

  const prompt = [
    'You explain uploaded files to colleagues who have not opened them yet. Write plain text only (no markdown, no emojis).',
    '',
    'Your job is to answer: "If I read this file, what would I actually learn?" Use the EXCERPT as evidence.',
    'Quote or paraphrase specific content from the excerpt (figures, names, dates, section titles, sheet names, table headers).',
    'Never invent content. If the excerpt is empty or gibberish, say so and only infer cautiously from TITLE and FILE NAME.',
    '',
    'Required structure (use these exact labels):',
    '',
    'PLAIN EXPLANATION:',
    '(8–12 full sentences in simple language. Walk the reader through what the document is, what information it holds, and why it matters. This section must stand alone — someone should understand the file without reading the rest.)',
    '',
    'DOCUMENT TYPE:',
    '(one line)',
    '',
    'SUBJECT:',
    '(one line)',
    '',
    "WHAT'S INSIDE (specific points from the text):",
    '(6–12 lines, each starting with "- ". Each line must tie to the excerpt when possible: e.g. "Section X states…", "Row labels include…", "The agreement names…")',
    '',
    'KEY FACTS:',
    '(one short paragraph: numbers, deadlines, parties, or "Not enough text in excerpt.")',
    '',
    'SEARCH TERMS:',
    '(one line, comma-separated keywords)',
    '',
    `TITLE: ${displayTitle || fileName}`,
    `FILE NAME: ${fileName}`,
    truncated ? 'NOTE: Long file — excerpt is stratified (beginning, middle, end). Do not assume missing parts.' : '',
    sample ? `\nEXCERPT:\n${sample}` : '\nEXCERPT:\n(none — extraction failed or unsupported format)',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const client = getOpenAiClient();
    const model = getAiModel();
    const response = await Promise.race([
      client.responses.create({
        model,
        input: [{ role: 'user', content: prompt }],
        max_output_tokens: 4500,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 120_000)),
    ]);
    const out = String(response?.output_text || '').trim();
    if (!out) return { summary: null, status: 'empty' };
    return { summary: out.slice(0, 28_000), status: 'ok' };
  } catch (e) {
    return { summary: `AI analysis failed: ${e?.message || 'error'}`, status: 'error' };
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIntentJson(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Rank library documents by how well they match a natural-language "need" / use case.
 * Uses OpenAI when configured; otherwise keyword overlap on title, file name, and summary.
 */
export async function matchDocumentsByIntent({ intent, documents }) {
  const intentStr = String(intent || '').trim();
  if (!intentStr) {
    return { documents: [], fallback: true, message: 'Describe what you need the document for.' };
  }
  const list = Array.isArray(documents) ? documents : [];
  if (!list.length) {
    return { documents: [], fallback: true, message: 'No documents in the library yet.' };
  }

  const keywordFallback = () => {
    const stop = new Set(['the', 'and', 'for', 'you', 'are', 'with', 'that', 'this', 'from', 'have', 'need', 'want', 'will', 'your', 'was', 'has', 'not', 'can', 'any', 'all', 'get', 'use']);
    const tokens = intentStr
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !stop.has(t));
    const uniq = [...new Set(tokens)];
    const scored = list.map((d) => {
      const hay = `${d.display_title || ''} ${d.file_name || ''} ${d.ai_summary || ''}`.toLowerCase();
      let hits = 0;
      for (const t of uniq) {
        if (hay.includes(t)) hits += 1;
      }
      const phrase = intentStr.toLowerCase().slice(0, 80);
      if (phrase.length > 5 && hay.includes(phrase)) hits += 2;
      return { doc: d, hits };
    });
    scored.sort((a, b) => b.hits - a.hits);
    const picked = scored.filter((x) => x.hits > 0).slice(0, 25);
    const out = picked.map(({ doc, hits }) => ({
      ...doc,
      match_reason: 'Keyword match on titles and summaries (enable OpenAI on the server for smarter ranking).',
      relevance_score: Math.min(100, hits * 12 + 10),
    }));
    return {
      documents: out,
      fallback: true,
      message:
        out.length > 0
          ? null
          : 'No strong keyword matches. Try different words, or add OPENAI_API_KEY for AI ranking.',
    };
  };

  if (!isAiConfigured()) {
    return keywordFallback();
  }

  const catalog = list.slice(0, 100).map((d, i) => {
    const sum = String(d.ai_summary || '(No AI summary yet — infer cautiously from title and file name.)')
      .replace(/\s+/g, ' ')
      .slice(0, 1100);
    return `ENTRY ${i + 1}\nid: ${d.id}\ntitle: ${d.display_title || ''}\nfile: ${d.file_name || ''}\nsummary_excerpt: ${sum}`;
  });

  const prompt = [
    'You match company-library documents to a user need. Output JSON only, no markdown, no commentary.',
    '',
    'USER NEED (what they are trying to do or find):',
    intentStr.slice(0, 2000),
    '',
    'CANDIDATE DOCUMENTS (only use these exact "id" values):',
    catalog.join('\n\n---\n\n'),
    '',
    'Return a JSON object with this exact shape:',
    '{"ranks":[{"id":"<uuid>","score":<number 0-100>,"why":"<one short sentence, plain English>"}]}',
    '',
    'Rules:',
    '- score reflects how useful the document would be for the USER NEED (not keyword overlap alone).',
    '- Include at most 20 entries with score >= 25. Sort by score descending.',
    '- If nothing fits, return {"ranks":[]}.',
    '- Never invent ids; every id must appear exactly in the candidate list.',
  ].join('\n');

  try {
    const client = getOpenAiClient();
    const model = getAiModel();
    const response = await Promise.race([
      client.responses.create({
        model,
        input: [{ role: 'user', content: prompt }],
        max_output_tokens: 2500,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 90_000)),
    ]);
    const out = String(response?.output_text || '').trim();
    const parsed = parseIntentJson(out);
    const ranks = Array.isArray(parsed?.ranks) ? parsed.ranks : [];
    const byId = new Map(list.map((d) => [String(d.id).toLowerCase(), d]));

    const merged = [];
    for (const r of ranks) {
      const id = String(r?.id || '').trim();
      if (!UUID_RE.test(id)) continue;
      const doc = byId.get(id.toLowerCase());
      if (!doc) continue;
      const score = Math.max(0, Math.min(100, Number(r.score) || 0));
      if (score < 25) continue;
      merged.push({
        ...doc,
        relevance_score: score,
        match_reason: String(r.why || '').slice(0, 400) || 'Relevant to your request.',
      });
    }
    merged.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    if (merged.length) {
      return { documents: merged, fallback: false, message: null };
    }
    const fb = keywordFallback();
    if (fb.documents?.length) {
      return { ...fb, message: fb.message || 'AI found no strong matches; showing keyword matches instead.' };
    }
    return { documents: [], fallback: true, message: 'No documents matched this need. Try rephrasing or browse the full list.' };
  } catch (e) {
    console.error('[company-library] intent search', e?.message);
    const fb = keywordFallback();
    if (fb.documents?.length) {
      return { ...fb, message: 'AI search failed; showing keyword matches instead.' };
    }
    return { documents: [], fallback: true, message: e?.message || 'Search failed.' };
  }
}
