import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('team-goals-schema.sql', import.meta.url), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) await pool.request().query(batch);
await pool.close();
console.log('Team goals / department strategy / questionnaires schema applied.');
process.exit(0);
