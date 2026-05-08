import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const schemaPath = new URL('fuel-data-auto-share.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');

const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);

const pool = await getPool();
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('fuel_data_auto_share_schedules schema applied.');
process.exit(0);
