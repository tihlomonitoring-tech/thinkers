#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const sql = readFileSync(new URL('tracking-trip-positions.sql', import.meta.url), 'utf8');
const batches = sql
  .split(/\bGO\b/i)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);

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
console.log('Trip position trail schema applied.');
