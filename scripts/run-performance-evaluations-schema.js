import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('performance-evaluations-schema.sql', import.meta.url), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  try {
    await pool.request().query(batch);
    console.log(`[performance-evaluations-schema] OK batch ${i + 1}/${batches.length}`);
  } catch (e) {
    console.error(`[performance-evaluations-schema] FAIL batch ${i + 1}/${batches.length}:`, e?.message || e);
    console.error(batch.slice(0, 500));
    await pool.close();
    process.exit(1);
  }
}
await pool.close();
console.log('Performance evaluations schema applied.');
process.exit(0);
