import { readFileSync } from 'fs';
import { query } from '../src/db.js';

const sql = readFileSync(new URL('cc-shift-report-ai-settings.sql', import.meta.url), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter(Boolean);
for (const batch of batches) {
  await query(batch);
}
console.log('Shift report AI settings column applied.');
