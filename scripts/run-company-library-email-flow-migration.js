import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('company-library-email-flow-migration.sql', import.meta.url), 'utf8');
const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('Company library email-flow migration applied.');
process.exit(0);
