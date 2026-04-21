import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const schemaPath = new URL('task-progress-legend-schema.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');
// Split only on lines that are solely "GO" (avoid breaking on words like "GO" inside comments).
const batches = sql
  .split(/^\s*GO\s*$/gim)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('Task progress_legend column applied.');
process.exit(0);
