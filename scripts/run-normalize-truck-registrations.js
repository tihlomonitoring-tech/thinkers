import 'dotenv/config';
import { getPool } from '../src/db.js';
import { compactTruckRegistration, compactTruckRegistrationNullable, sqlRegNormExpr } from '../src/lib/truckRegistration.js';

const pool = await getPool();

async function normalizeColumn(column) {
  const rows = await pool.request().query(`
    SELECT id, tenant_id, contractor_id, ${column} AS value
    FROM contractor_trucks
    WHERE ${column} IS NOT NULL
      AND LTRIM(RTRIM(${column})) <> ''
      AND ${column} <> UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${column})), CHAR(160), ''), CHAR(9), ''), CHAR(10), ''), CHAR(13), ''), ' ', ''))
  `);
  let updated = 0;
  let skipped = 0;
  for (const row of rows.recordset || []) {
    const compact = column === 'registration'
      ? compactTruckRegistration(row.value)
      : compactTruckRegistrationNullable(row.value);
    if (!compact) continue;
    if (column === 'registration') {
      const conflict = await pool.request()
        .input('tenantId', row.tenant_id)
        .input('contractorId', row.contractor_id)
        .input('id', row.id)
        .input('regNorm', compact.toLowerCase())
        .query(`
          SELECT TOP 1 id FROM contractor_trucks
          WHERE tenant_id = @tenantId
            AND id <> @id
            AND (contractor_id = @contractorId OR (contractor_id IS NULL AND @contractorId IS NULL))
            AND ${sqlRegNormExpr('registration')} = @regNorm
        `);
      if (conflict.recordset?.length) {
        skipped += 1;
        console.warn(`Skipped ${row.value} -> ${compact} (duplicate under same contractor)`);
        continue;
      }
    }
    await pool.request()
      .input('id', row.id)
      .input('value', compact)
      .query(`UPDATE contractor_trucks SET ${column} = @value WHERE id = @id`);
    updated += 1;
  }
  console.log(`${column}: updated ${updated}, skipped ${skipped}`);
}

await normalizeColumn('registration');
await normalizeColumn('trailer_1_reg_no');
await normalizeColumn('trailer_2_reg_no');
await pool.close();
console.log('Truck registration normalization complete.');
process.exit(0);
