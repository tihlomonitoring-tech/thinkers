import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const sql = readFileSync(new URL('add-office-admin-page-role.sql', import.meta.url), 'utf8');
const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);

const pool = await getPool();
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('office_admin page role added.');
process.exit(0);
