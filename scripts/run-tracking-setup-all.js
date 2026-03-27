#!/usr/bin/env node
/**
 * One-shot: create tracking tables, optional contractor columns, update user_page_roles CHECK.
 * Run from project root: npm run db:tracking-setup
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

async function runBatches(label, relativePath) {
  const schemaPath = new URL(relativePath, import.meta.url);
  const sql = readFileSync(schemaPath, 'utf8');
  const batches = sql
    .split(/\bGO\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
  const pool = await getPool();
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      await pool.request().query(batch);
    } catch (e) {
      console.error(`[${label}] batch ${i + 1}/${batches.length} failed:`, e?.message || e);
      const info = e?.originalError?.info || e?.info;
      if (info) console.error('SQL info:', JSON.stringify(info, null, 2));
      if (e?.number != null) console.error('SQL number:', e.number);
      console.error(batch.slice(0, 500));
      throw e;
    }
  }
  console.log(`OK: ${label}`);
}

try {
  await runBatches('tracking-integration-schema.sql', 'tracking-integration-schema.sql');
} catch (e) {
  console.error('tracking-integration-schema failed:', e?.message || e);
  process.exit(1);
}

try {
  await runBatches('tracking-expand-contractor-truck.sql', 'tracking-expand-contractor-truck.sql');
} catch (e) {
  console.warn('tracking-expand-contractor-truck (optional):', e?.message || e);
}

try {
  await runBatches('add-tracking-integration-page-role.sql', 'add-tracking-integration-page-role.sql');
} catch (e) {
  console.warn('add-tracking-integration-page-role:', e?.message || e);
}

const pool = await getPool();
await pool.close();
console.log('Tracking setup complete. Restart the API server.');
process.exit(0);
