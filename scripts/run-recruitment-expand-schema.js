import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const schemaPath = new URL('recruitment-expand-schema.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');

const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);

const pool = await getPool();
for (const batch of batches) {
  try {
    await pool.request().query(batch);
  } catch (err) {
    if (err.message && (err.message.includes('already exists') || err.message.includes('duplicate column'))) {
      console.warn('Skip (already applied):', err.message.slice(0, 60));
    } else throw err;
  }
}
await pool.close();
console.log('Recruitment expand schema applied.');
process.exit(0);
