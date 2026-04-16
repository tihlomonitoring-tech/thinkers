import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('add-team-leader-admin-page-role.sql', import.meta.url), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) await pool.request().query(batch);
await pool.close();
console.log('team_leader_admin page role added to CHECK constraint.');
process.exit(0);
