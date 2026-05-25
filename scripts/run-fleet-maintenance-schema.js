import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const schemaPath = new URL('fleet-maintenance-schema.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');

const pool = await getPool();
for (const batch of sql.split(/\nGO\b/i)) {
  const t = batch.trim();
  if (t) await pool.request().query(t);
}
console.log('Fleet maintenance schema applied.');
process.exit(0);
