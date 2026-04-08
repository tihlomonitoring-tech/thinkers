import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const schemaPath = new URL('accounting-invoice-show-issue-date-pdf.sql', import.meta.url);
const sql = readFileSync(schemaPath, 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
for (const batch of batches) await pool.request().query(batch);
await pool.close();
console.log('accounting_invoices.show_issue_date_on_pdf applied.');
process.exit(0);
