import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const schemaPath = new URL('add-fuel-customer-orders-page-role.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) await pool.request().query(batch);
await pool.close();
console.log('fuel_customer_orders page role added to CHECK constraint.');
process.exit(0);
