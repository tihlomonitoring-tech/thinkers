import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool } from '../src/db.js';

async function applyFile(pool, filename) {
  const sql = fs.readFileSync(path.join(process.cwd(), 'scripts', filename), 'utf8');
  for (const batch of sql.split(/\nGO\b/i).map((s) => s.trim()).filter(Boolean)) {
    await pool.request().query(batch);
  }
}

const pool = await getPool();
await applyFile(pool, 'truck-onboarding-schema.sql');
await applyFile(pool, 'truck-onboarding-drivers.sql');
await applyFile(pool, 'truck-onboarding-v2.sql');
console.log('Truck & driver onboarding schema applied.');
process.exit(0);
