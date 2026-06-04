import 'dotenv/config';
import { readFileSync } from 'fs';
import { getPool } from '../src/db.js';

const pool = await getPool();
const sql = readFileSync(new URL('add-policy-development-page-role.sql', import.meta.url), 'utf8');
for (const batch of sql.split(/\bGO\b/i).map((s) => s.trim()).filter((s) => s.length > 0)) {
  await pool.request().query(batch);
}
await pool.close();
console.log('Policy development page role added to CK_user_page_roles_page_id.');
process.exit(0);
