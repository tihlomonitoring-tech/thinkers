import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../src/db.js';

const sql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'budget-category-account-type.sql'), 'utf8');
const pool = await getPool();
for (const batch of sql.split(/\nGO\b/i).map((s) => s.trim()).filter(Boolean)) {
  await pool.request().query(batch);
}
console.log('budget category account_type_id applied.');
process.exit(0);
