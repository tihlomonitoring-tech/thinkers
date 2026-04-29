import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const schemaPath = new URL('add-case-management-page-role.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');
const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('Case management page role added to CK_user_page_roles_page_id.');
process.exit(0);
