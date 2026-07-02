#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, 'tracking-logistics-route-mismatch.sql'), 'utf8');
const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0);

const pool = await getPool();
for (let i = 0; i < batches.length; i++) {
  try {
    await pool.request().query(batches[i]);
  } catch (e) {
    console.error(`Batch ${i + 1}/${batches.length} failed:`, e?.message || e);
    process.exit(1);
  }
}
await pool.close();
console.log('tracking-logistics-route-mismatch schema applied');
