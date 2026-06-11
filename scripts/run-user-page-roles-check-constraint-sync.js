import 'dotenv/config';
import { getPool } from '../src/db.js';
import { PAGE_IDS } from '../src/routes/users.js';

/** Screen IDs used in DB but not listed in User Management PAGE_ROLES. */
const EXTRA_PAGE_IDS = ['operator_profile', 'operator_management'];

function rowVal(row, key) {
  const entry = Object.entries(row || {}).find(([k]) => k && String(k).toLowerCase() === key.toLowerCase());
  return entry ? entry[1] : null;
}

function sqlLiteral(id) {
  return `N'${String(id).replace(/'/g, "''")}'`;
}

const pool = await getPool();

const distinctR = await pool.request().query('SELECT DISTINCT page_id FROM dbo.user_page_roles');
const inDb = (distinctR.recordset || [])
  .map((row) => String(rowVal(row, 'page_id') || '').trim())
  .filter(Boolean);

const allowed = [...new Set([...PAGE_IDS, ...EXTRA_PAGE_IDS])];
const unknownInDb = inDb.filter((id) => !allowed.includes(id));

if (unknownInDb.length) {
  console.warn('Unknown page_id values already in user_page_roles (will allow in CHECK):', unknownInDb.join(', '));
  for (const id of unknownInDb) allowed.push(id);
}

const missingFromDb = allowed.filter((id) => !inDb.includes(id));
if (missingFromDb.length) {
  console.log('Page IDs allowed but not yet assigned to any user:', missingFromDb.join(', '));
}

await pool.request().query(`
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_user_page_roles_page_id'
    AND parent_object_id = OBJECT_ID(N'dbo.user_page_roles')
)
  ALTER TABLE dbo.user_page_roles DROP CONSTRAINT CK_user_page_roles_page_id;
`);

const inList = allowed.map(sqlLiteral).join(',\n  ');
await pool.request().query(`
ALTER TABLE dbo.user_page_roles ADD CONSTRAINT CK_user_page_roles_page_id CHECK (page_id IN (
  ${inList}
));
`);

await pool.close();
console.log(`user_page_roles CHECK constraint synced (${allowed.length} page IDs).`);
process.exit(0);
