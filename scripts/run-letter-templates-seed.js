#!/usr/bin/env node
import 'dotenv/config';
import { getPool } from '../src/db.js';
import { buildSeedRows } from '../src/lib/letterTemplateSeeds.js';
import sql from 'mssql';

const rows = buildSeedRows();
const pool = await getPool();
let inserted = 0;
let skipped = 0;

for (const r of rows) {
  try {
    const existing = await pool
      .request()
      .input('seed_key', sql.NVarChar(200), r.seed_key)
      .query('SELECT 1 AS hit FROM letter_templates WHERE seed_key = @seed_key');
    if (existing.recordset?.length) {
      skipped += 1;
      continue;
    }
    await pool
      .request()
      .input('letter_type', sql.NVarChar(50), r.letter_type)
      .input('template_name', sql.NVarChar(255), r.template_name)
      .input('description', sql.NVarChar(1000), r.description)
      .input('intro_body', sql.NVarChar(sql.MAX), r.intro_body)
      .input('sections_json', sql.NVarChar(sql.MAX), r.sections_json)
      .input('closing_text', sql.NVarChar(sql.MAX), r.closing_text)
      .input('sort_order', sql.Int, r.sort_order)
      .input('seed_key', sql.NVarChar(200), r.seed_key)
      .query(
        `INSERT INTO letter_templates (tenant_id, letter_type, template_name, description, intro_body, sections_json, closing_text, is_system, seed_key, sort_order)
         VALUES (NULL, @letter_type, @template_name, @description, @intro_body, @sections_json, @closing_text, 1, @seed_key, @sort_order)`
      );
    inserted += 1;
  } catch (e) {
    console.error(`Seed failed for ${r.seed_key}:`, e?.message || e);
  }
}

await pool.close();
console.log(`Letter templates seeded: ${inserted} inserted, ${skipped} already present (total ${rows.length}).`);
