import 'dotenv/config';
import { getPool } from '../src/db.js';

// Links a contractor driver to a platform user (operator profile). Enables the
// "Link to operator profile" picker on Driver register and surfaces the driver's
// operator productivity / deliveries / integrations on the contractor page.
// Run once: npm run db:contractor-driver-linked-user
// Separate batches so ADD column commits before FK/index (Azure SQL / SQL Server).
const batch1 = `
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.contractor_drivers') AND name = 'linked_user_id')
  ALTER TABLE dbo.contractor_drivers ADD linked_user_id UNIQUEIDENTIFIER NULL;
`;
const batch2 = `
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_contractor_drivers_linked_user')
  ALTER TABLE dbo.contractor_drivers
  ADD CONSTRAINT FK_contractor_drivers_linked_user
  FOREIGN KEY (linked_user_id) REFERENCES dbo.users(id) ON DELETE NO ACTION;
`;
const batch3 = `
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contractor_drivers_linked_user_id' AND object_id = OBJECT_ID('dbo.contractor_drivers'))
  CREATE INDEX IX_contractor_drivers_linked_user_id ON dbo.contractor_drivers(linked_user_id);
`;

const pool = await getPool();
for (const [name, stmt] of [
  ['ADD linked_user_id column', batch1],
  ['FK_contractor_drivers_linked_user', batch2],
  ['IX_contractor_drivers_linked_user_id', batch3],
]) {
  try {
    await pool.request().query(stmt);
    console.log(name, 'OK');
  } catch (err) {
    console.error(name, 'failed:', err.message);
    if (err.precedingErrors) err.precedingErrors.forEach((e) => console.error('  ', e.message));
    await pool.close();
    process.exit(1);
  }
}
await pool.close();
console.log('Contractor driver linked_user_id column added.');
process.exit(0);
