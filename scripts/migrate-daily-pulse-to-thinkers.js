/**
 * Move all team leader Daily pulse (questionnaires) from Mbuyelo to Thinkers Africa.
 * Resolves leader+work_date duplicates by keeping the Thinkers row and removing the Mbuyelo row.
 *
 * Usage:
 *   node scripts/migrate-daily-pulse-to-thinkers.js           # dry-run
 *   node scripts/migrate-daily-pulse-to-thinkers.js --apply  # execute
 */
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import { isThinkersAfricaTenant, isMbuyeloTenant } from '../src/lib/tenantPrimaryPreference.js';

const APPLY = process.argv.includes('--apply');

async function pickTenantPair(pool) {
  const tenants = await pool.request().query(`SELECT id, name, slug FROM tenants`);
  const rows = tenants.recordset || [];
  const thinkers = rows.filter((r) => isThinkersAfricaTenant(r.name, r.slug));
  const mbuyelo = rows.filter((r) => isMbuyeloTenant(r.name, r.slug));
  if (!thinkers.length) throw new Error('No Thinkers Africa tenant found.');
  if (!mbuyelo.length) throw new Error('No Mbuyelo tenant found.');
  return {
    thinkersId: String(thinkers[0].id ?? thinkers[0].Id),
    thinkersName: thinkers[0].name ?? thinkers[0].Name,
    mbuyeloId: String(mbuyelo[0].id ?? mbuyelo[0].Id),
    mbuyeloName: mbuyelo[0].name ?? mbuyelo[0].Name,
  };
}

async function tableExists(pool, tableName) {
  const r = await pool
    .request()
    .input('tn', sql.NVarChar, tableName)
    .query(
      `SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn`
    );
  return (r.recordset || []).length > 0;
}

async function main() {
  const pool = await getPool();
  if (!(await tableExists(pool, 'team_leader_questionnaires'))) {
    console.log('team_leader_questionnaires table not found — nothing to do.');
    return;
  }

  const { thinkersId, thinkersName, mbuyeloId, mbuyeloName } = await pickTenantPair(pool);
  console.log(`Thinkers Africa: ${thinkersName} (${thinkersId})`);
  console.log(`Mbuyelo:         ${mbuyeloName} (${mbuyeloId})`);

  const countR = await pool
    .request()
    .input('mb', sql.UniqueIdentifier, mbuyeloId)
    .input('th', sql.UniqueIdentifier, thinkersId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM team_leader_questionnaires WHERE tenant_id = @mb) AS mb_rows,
        (SELECT COUNT(*) FROM team_leader_questionnaires q
         WHERE q.tenant_id = @mb
           AND EXISTS (
             SELECT 1 FROM team_leader_questionnaires x
             WHERE x.leader_user_id = q.leader_user_id AND x.work_date = q.work_date AND x.tenant_id = @th
           )) AS mb_dupes
    `);
  const mbRows = countR.recordset?.[0]?.mb_rows ?? 0;
  const mbDupes = countR.recordset?.[0]?.mb_dupes ?? 0;
  const mbToMove = mbRows - mbDupes;

  console.log(`\nMbuyelo questionnaires: ${mbRows}`);
  console.log(`Duplicate leader+date (will delete Mbuyelo copy): ${mbDupes}`);
  console.log(`Will reassign tenant_id to Thinkers Africa: ${mbToMove}`);

  if (!mbRows) {
    console.log('Nothing to migrate.');
    return;
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to execute.');
    return;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const del = new sql.Request(transaction);
    del.input('mb', sql.UniqueIdentifier, mbuyeloId);
    del.input('th', sql.UniqueIdentifier, thinkersId);
    const delResult = await del.query(`
      DELETE q FROM team_leader_questionnaires q
      WHERE q.tenant_id = @mb
        AND EXISTS (
          SELECT 1 FROM team_leader_questionnaires x
          WHERE x.leader_user_id = q.leader_user_id AND x.work_date = q.work_date AND x.tenant_id = @th
        )
    `);
    console.log(`Deleted duplicate rows: ${delResult.rowsAffected?.[0] ?? '?'}`);

    const upd = new sql.Request(transaction);
    upd.input('mb', sql.UniqueIdentifier, mbuyeloId);
    upd.input('th', sql.UniqueIdentifier, thinkersId);
    const updResult = await upd.query(`
      UPDATE team_leader_questionnaires SET tenant_id = @th WHERE tenant_id = @mb
    `);
    console.log(`Moved to Thinkers Africa: ${updResult.rowsAffected?.[0] ?? '?'}`);

    await transaction.commit();
    console.log('\nCommitted.');
  } catch (e) {
    await transaction.rollback();
    console.error('\nRolled back:', e?.message || e);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
