/**
 * Seed editable draft bills for SA government labour policies (all active tenants).
 * Run: npm run db:seed-government-labour-policies
 * Optional: TENANT_ID=<uuid> to limit to one tenant.
 */
import 'dotenv/config';
import { query, getPool } from '../src/db.js';
import { seedGovernmentLabourPoliciesForTenant } from '../src/lib/governmentLabourPolicySeeds.js';

const tenantFilter = process.env.TENANT_ID?.trim() || null;

const tenants = await query(
  tenantFilter
    ? `SELECT id, name FROM tenants WHERE id = @id`
    : `SELECT id, name FROM tenants WHERE status = N'active' OR status IS NULL ORDER BY created_at`,
  tenantFilter ? { id: tenantFilter } : {}
);

if (!tenants.recordset?.length) {
  console.error('No tenant(s) found.');
  process.exit(1);
}

let totalInserted = 0;
let totalSkipped = 0;

for (const row of tenants.recordset) {
  const tenantId = row.id ?? row.Id;
  const name = row.name ?? row.Name ?? tenantId;
  console.log(`\nTenant: ${name}`);
  const { inserted, skipped } = await seedGovernmentLabourPoliciesForTenant(tenantId, null, query);
  console.log(`  Inserted: ${inserted.length ? inserted.join(', ') : '(none)'}`);
  console.log(`  Skipped (already present): ${skipped.length ? skipped.join(', ') : '(none)'}`);
  totalInserted += inserted.length;
  totalSkipped += skipped.length;
}

const pool = await getPool();
await pool.close();
console.log(`\nDone. ${totalInserted} new draft bill(s), ${totalSkipped} skipped.`);
console.log('Open Bill drafting → edit drafts → publish when ready.');
process.exit(0);
