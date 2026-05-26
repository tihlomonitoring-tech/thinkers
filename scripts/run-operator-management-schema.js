import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../src/db.js';

const sql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'operator-management-schema.sql'), 'utf8');
const pool = await getPool();
const batches = sql.split(/\nGO\b/i).map((s) => s.trim()).filter(Boolean);
for (const batch of batches) {
  await pool.request().query(batch);
}
console.log('operator-management schema applied.');
process.exit(0);
