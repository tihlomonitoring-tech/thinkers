import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const sql = readFileSync(new URL('vehicle-tracker-compliance-blocked.sql', import.meta.url), 'utf8');
const pool = await getPool();
for (const batch of sql.split(/\nGO\b/i)) {
  const t = batch.trim();
  if (t) await pool.request().query(t);
}
console.log('Vehicle tracker compliance blocked-state migration applied.');
process.exit(0);
