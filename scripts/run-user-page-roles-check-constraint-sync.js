import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const schemaPath = new URL('user-page-roles-check-constraint-sync.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');
const batches = sql
  .split(/^\s*GO\s*$/gim)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('user_page_roles CHECK constraint synced to current PAGE_IDS.');
process.exit(0);
