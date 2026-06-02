import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('team-credit-pools-schema.sql', import.meta.url), 'utf8');
for (const batch of sql.split(/\bGO\b/i).map((s) => s.trim()).filter(Boolean)) {
  await pool.request().query(batch);
}
await pool.close();
console.log('Team credit pools schema applied.');
process.exit(0);
