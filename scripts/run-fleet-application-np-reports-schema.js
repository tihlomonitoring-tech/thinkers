import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'fleet-application-np-reports-schema.sql');

async function main() {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const batches = sql.split(/\bGO\b/i).map((s) => s.trim()).filter(Boolean);
  for (const batch of batches) {
    await query(batch);
  }
  console.log('fleet-application-np-reports schema applied');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
