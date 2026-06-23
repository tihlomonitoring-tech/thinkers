import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { query } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, 'budget-transaction-expense-link.sql'), 'utf8');

const batches = sql.split(/\nGO\s*\n/i).map((s) => s.trim()).filter(Boolean);
for (const batch of batches) {
  await query(batch);
}
console.log('Budget transaction expense link schema applied.');
