/**
 * One-off data fix: users who belong to BOTH Thinkers Africa and Mbuyelo should have
 * user-scoped rows under Mbuyelo's tenant_id moved to Thinkers Africa's tenant_id so
 * reporting and filters by tenant show the same history under Thinkers Africa.
 *
 * Does NOT remove user_tenants rows (users can still switch to Mbuyelo in the app).
 *
 * Usage:
 *   node scripts/reassign-mbuyelo-rows-to-thinkers-dual-home.js           # dry-run (default)
 *   node scripts/reassign-mbuyelo-rows-to-thinkers-dual-home.js --apply  # execute in a transaction
 */
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import { isThinkersAfricaTenant, isMbuyeloTenant } from '../src/lib/tenantPrimaryPreference.js';

const APPLY = process.argv.includes('--apply');

function bindDual(request, thinkersId, mbuyeloId, dualIds) {
  request.input('th', sql.UniqueIdentifier, thinkersId);
  request.input('mb', sql.UniqueIdentifier, mbuyeloId);
  dualIds.forEach((id, i) => {
    request.input(`u${i}`, sql.UniqueIdentifier, id);
  });
}

async function pickTenantPair(pool) {
  const tenants = await pool.request().query(`SELECT id, name, slug FROM tenants`);
  const rows = tenants.recordset || [];
  const thinkers = rows.filter((r) => isThinkersAfricaTenant(r.name, r.slug));
  const mbuyelo = rows.filter((r) => isMbuyeloTenant(r.name, r.slug));
  if (!thinkers.length) {
    throw new Error('No tenant matched Thinkers Africa (name/slug must include thinkers + africa/afrika).');
  }
  if (!mbuyelo.length) {
    throw new Error('No tenant matched Mbuyelo.');
  }
  if (thinkers.length > 1) {
    console.warn(`Multiple Thinkers Africa–like tenants; using first: ${thinkers[0].name}`);
  }
  if (mbuyelo.length > 1) {
    console.warn(`Multiple Mbuyelo-like tenants; using first: ${mbuyelo[0].name}`);
  }
  const th = thinkers[0].id ?? thinkers[0].Id;
  const mb = mbuyelo[0].id ?? mbuyelo[0].Id;
  return {
    thinkersId: String(th),
    thinkersName: thinkers[0].name ?? thinkers[0].Name,
    mbuyeloId: String(mb),
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
  const { thinkersId, thinkersName, mbuyeloId, mbuyeloName } = await pickTenantPair(pool);
  console.log(`Thinkers Africa tenant: ${thinkersName} (${thinkersId})`);
  console.log(`Mbuyelo tenant:        ${mbuyeloName} (${mbuyeloId})`);

  const dualR = await pool.request().input('th', sql.UniqueIdentifier, thinkersId).input('mb', sql.UniqueIdentifier, mbuyeloId)
    .query(`
    SELECT u.user_id AS id
    FROM user_tenants u
    INNER JOIN user_tenants m ON m.user_id = u.user_id AND m.tenant_id = @mb
    WHERE u.tenant_id = @th
  `);
  const dualIds = (dualR.recordset || []).map((x) => String(x.id ?? x.Id)).filter(Boolean);
  console.log(`Dual-home users (both tenants): ${dualIds.length}`);
  if (!dualIds.length) {
    console.log('Nothing to do.');
    process.exit(0);
    return;
  }

  const idList = dualIds.map((_, i) => `@u${i}`).join(', ');
  const userIn = `IN (${idList})`;

  const runCount = async (label, sqlText) => {
    const r = new sql.Request(pool);
    bindDual(r, thinkersId, mbuyeloId, dualIds);
    const out = await r.query(sqlText);
    const c = out.recordset?.[0]?.c ?? out.recordset?.[0]?.C ?? 0;
    console.log(`  ${label}: ${c}`);
  };

  console.log('\nPlanned row updates (Mbuyelo → Thinkers Africa):');
  await runCount('users.tenant_id', `SELECT COUNT(*) AS c FROM users WHERE tenant_id = @mb AND id ${userIn}`);
  if (await tableExists(pool, 'work_schedules')) {
    await runCount('work_schedules', `SELECT COUNT(*) AS c FROM work_schedules WHERE tenant_id = @mb AND user_id ${userIn}`);
  }
  if (await tableExists(pool, 'shift_clock_sessions')) {
    await runCount(
      'shift_clock_sessions',
      `SELECT COUNT(*) AS c FROM shift_clock_sessions WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'shift_clock_alert_sent')) {
    await runCount(
      'shift_clock_alert_sent (via session user)',
      `SELECT COUNT(*) AS c FROM shift_clock_alert_sent a
       INNER JOIN shift_clock_sessions s ON s.id = a.session_id
       WHERE a.tenant_id = @mb AND s.user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'leave_applications')) {
    await runCount(
      'leave_applications',
      `SELECT COUNT(*) AS c FROM leave_applications WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'leave_balance')) {
    await runCount(
      'leave_balance (only non-conflicting)',
      `SELECT COUNT(*) AS c FROM leave_balance lb
       WHERE lb.tenant_id = @mb AND lb.user_id ${userIn}
         AND NOT EXISTS (
           SELECT 1 FROM leave_balance x
           WHERE x.user_id = lb.user_id AND x.tenant_id = @th
             AND x.[year] = lb.[year] AND x.leave_type = lb.leave_type
         )`
    );
  }
  if (await tableExists(pool, 'profile_documents')) {
    await runCount(
      'profile_documents',
      `SELECT COUNT(*) AS c FROM profile_documents WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'user_login_activity')) {
    await runCount(
      'user_login_activity',
      `SELECT COUNT(*) AS c FROM user_login_activity WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'user_personal_career_plan')) {
    await runCount(
      'user_personal_career_plan (only non-conflicting)',
      `SELECT COUNT(*) AS c FROM user_personal_career_plan p
       WHERE p.tenant_id = @mb AND p.user_id ${userIn}
         AND NOT EXISTS (SELECT 1 FROM user_personal_career_plan x WHERE x.user_id = p.user_id AND x.tenant_id = @th)`
    );
  }
  if (await tableExists(pool, 'user_career_milestones')) {
    await runCount(
      'user_career_milestones',
      `SELECT COUNT(*) AS c FROM user_career_milestones WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'user_cv_uploads')) {
    await runCount(
      'user_cv_uploads',
      `SELECT COUNT(*) AS c FROM user_cv_uploads WHERE tenant_id = @mb AND user_id ${userIn}`
    );
  }
  if (await tableExists(pool, 'pe_submissions')) {
    await runCount(
      'pe_submissions',
      `SELECT COUNT(*) AS c FROM pe_submissions WHERE tenant_id = @mb
         AND (evaluator_user_id ${userIn} OR evaluatee_user_id ${userIn})`
    );
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to execute in one transaction.');
    process.exit(0);
    return;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const exec = async (label, sqlText) => {
      const r = new sql.Request(transaction);
      bindDual(r, thinkersId, mbuyeloId, dualIds);
      const result = await r.query(sqlText);
      console.log(`  ${label}: ${result.rowsAffected?.[0] ?? '?'} rows`);
    };

    await exec(
      'users.tenant_id',
      `UPDATE users SET tenant_id = @th, updated_at = SYSUTCDATETIME()
       WHERE tenant_id = @mb AND id ${userIn}`
    );

    if (await tableExists(pool, 'work_schedules')) {
      await exec(
        'work_schedules',
        `UPDATE work_schedules SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'shift_clock_sessions')) {
      await exec(
        'shift_clock_sessions',
        `UPDATE shift_clock_sessions SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'shift_clock_alert_sent')) {
      await exec(
        'shift_clock_alert_sent',
        `UPDATE a SET tenant_id = @th
         FROM shift_clock_alert_sent a
         INNER JOIN shift_clock_sessions s ON s.id = a.session_id
         WHERE a.tenant_id = @mb AND s.user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'leave_applications')) {
      await exec(
        'leave_applications',
        `UPDATE leave_applications SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'leave_balance')) {
      await exec(
        'leave_balance',
        `UPDATE lb SET tenant_id = @th
         FROM leave_balance lb
         WHERE lb.tenant_id = @mb AND lb.user_id ${userIn}
           AND NOT EXISTS (
             SELECT 1 FROM leave_balance x
             WHERE x.user_id = lb.user_id AND x.tenant_id = @th
               AND x.[year] = lb.[year] AND x.leave_type = lb.leave_type
           )`
      );
    }
    if (await tableExists(pool, 'profile_documents')) {
      await exec(
        'profile_documents',
        `UPDATE profile_documents SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'disciplinary_warnings')) {
      await exec(
        'disciplinary_warnings',
        `UPDATE disciplinary_warnings SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'rewards')) {
      await exec('rewards', `UPDATE rewards SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`);
    }
    if (await tableExists(pool, 'queries')) {
      await exec('queries', `UPDATE queries SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`);
    }
    if (await tableExists(pool, 'evaluations')) {
      await exec(
        'evaluations',
        `UPDATE evaluations SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'performance_improvement_plans')) {
      await exec(
        'performance_improvement_plans',
        `UPDATE performance_improvement_plans SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'user_login_activity')) {
      await exec(
        'user_login_activity',
        `UPDATE user_login_activity SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'user_personal_career_plan')) {
      await exec(
        'user_personal_career_plan',
        `UPDATE p SET tenant_id = @th
         FROM user_personal_career_plan p
         WHERE p.tenant_id = @mb AND p.user_id ${userIn}
           AND NOT EXISTS (SELECT 1 FROM user_personal_career_plan x WHERE x.user_id = p.user_id AND x.tenant_id = @th)`
      );
    }
    if (await tableExists(pool, 'user_career_milestones')) {
      await exec(
        'user_career_milestones',
        `UPDATE user_career_milestones SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'user_cv_uploads')) {
      await exec(
        'user_cv_uploads',
        `UPDATE user_cv_uploads SET tenant_id = @th WHERE tenant_id = @mb AND user_id ${userIn}`
      );
    }
    if (await tableExists(pool, 'pe_submissions')) {
      await exec(
        'pe_submissions',
        `UPDATE pe_submissions SET tenant_id = @th
         WHERE tenant_id = @mb AND (evaluator_user_id ${userIn} OR evaluatee_user_id ${userIn})`
      );
    }

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
