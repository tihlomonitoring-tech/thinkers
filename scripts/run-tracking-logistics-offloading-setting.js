#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, 'tracking-logistics-offloading-setting.sql'), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0);

const pool = await getPool();
for (const batch of batches) {
  await pool.request().query(batch);
}
await pool.close();
console.log('tracking-logistics-offloading-setting applied');
