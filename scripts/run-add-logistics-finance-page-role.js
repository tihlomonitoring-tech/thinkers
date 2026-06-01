import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../src/db.js';

const sql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'add-logistics-finance-page-role.sql'), 'utf8');
const pool = await getPool();
for (const batch of sql.split(/\nGO\b/i).map((s) => s.trim()).filter(Boolean)) {
  await pool.request().query(batch);
}
console.log('logistics_finance_management page role added to check constraint.');
process.exit(0);
