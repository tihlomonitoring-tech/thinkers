import fs from 'fs';
import path from 'path';
import { query } from '../src/db.js';

const sql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'cc-truck-delivery-routes-schema.sql'), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter(Boolean);
for (const batch of batches) {
  await query(batch);
}
console.log('Command Centre truck delivery routes schema applied.');
