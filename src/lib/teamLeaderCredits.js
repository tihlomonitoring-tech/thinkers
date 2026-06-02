import { query } from '../db.js';

export const PULSES_FOR_WEEKLY_GRANT = 6;
export const WEEKLY_LEADER_CREDIT_GRANT = 10;
export const LEADER_SELF_BONUS_ON_MEMBER_CREDIT = 15;

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

export function normalizeTeamKey(name) {
  return String(name || '').trim() || 'Unnamed team';
}

/** ISO week key e.g. 2026-W21 */
export function isoWeekKeyFromDate(ymdOrDate) {
  const s = String(ymdOrDate || '').slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(ymdOrDate);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function parseMemberIds(raw) {
  if (!raw) return [];
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export async function listTenantTeams(tenantId) {
  const r = await query(
    `SELECT DISTINCT LTRIM(RTRIM(team_name)) AS team_name
     FROM shift_team_objectives
     WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(scope))) = N'team' AND team_name IS NOT NULL AND LTRIM(RTRIM(team_name)) <> ''`,
    { tenantId }
  );
  const names = (r.recordset || []).map((row) => normalizeTeamKey(getRow(row, 'team_name')));
  return [...new Set(names)].sort();
}

export async function ensureTeamPool(tenantId, teamKey) {
  const key = normalizeTeamKey(teamKey);
  await query(
    `MERGE team_point_pools AS t
     USING (SELECT @tenantId AS tenant_id, @teamKey AS team_key) AS s
     ON t.tenant_id = s.tenant_id AND t.team_key = s.team_key
     WHEN NOT MATCHED THEN INSERT (tenant_id, team_key) VALUES (s.tenant_id, s.team_key);`,
    { tenantId, teamKey: key }
  );
  const row = await query(
    `SELECT * FROM team_point_pools WHERE tenant_id = @tenantId AND team_key = @teamKey`,
    { tenantId, teamKey: key }
  );
  return row.recordset?.[0] || null;
}

export async function ensureLeaderWallet(tenantId, leaderUserId) {
  await query(
    `MERGE team_leader_credit_wallets AS t
     USING (SELECT @tenantId AS tenant_id, @uid AS leader_user_id) AS s
     ON t.tenant_id = s.tenant_id AND t.leader_user_id = s.leader_user_id
     WHEN NOT MATCHED THEN INSERT (tenant_id, leader_user_id) VALUES (s.tenant_id, s.leader_user_id);`,
    { tenantId, uid: leaderUserId }
  );
  const row = await query(
    `SELECT * FROM team_leader_credit_wallets WHERE tenant_id = @tenantId AND leader_user_id = @uid`,
    { tenantId, uid: leaderUserId }
  );
  return row.recordset?.[0] || null;
}

/** Count distinct pulse work dates in the ISO week containing refYmd. */
export async function countLeaderPulsesInWeek(tenantId, leaderUserId, refYmd) {
  const weekKey = isoWeekKeyFromDate(refYmd);
  if (!weekKey) return 0;
  const r = await query(
    `SELECT COUNT(DISTINCT work_date) AS c
     FROM team_leader_questionnaires
     WHERE tenant_id = @tenantId AND leader_user_id = @uid`,
    { tenantId, uid: leaderUserId }
  );
  const all = await query(
    `SELECT DISTINCT work_date FROM team_leader_questionnaires
     WHERE tenant_id = @tenantId AND leader_user_id = @uid`,
    { tenantId, uid: leaderUserId }
  );
  let c = 0;
  for (const row of all.recordset || []) {
    const wd = String(getRow(row, 'work_date') || '').slice(0, 10);
    if (isoWeekKeyFromDate(wd) === weekKey) c += 1;
  }
  return c;
}

/** Grant 10 credits once per ISO week when leader has >= 6 pulses in that week. */
export async function maybeGrantWeeklyLeaderCredits(tenantId, leaderUserId, refYmd) {
  const weekKey = isoWeekKeyFromDate(refYmd || new Date());
  if (!weekKey) return { granted: false };
  const pulseCount = await countLeaderPulsesInWeek(tenantId, leaderUserId, refYmd || new Date());
  const wallet = await ensureLeaderWallet(tenantId, leaderUserId);
  const lastGrant = getRow(wallet, 'last_weekly_grant_week');
  if (pulseCount >= PULSES_FOR_WEEKLY_GRANT && lastGrant !== weekKey) {
    await query(
      `UPDATE team_leader_credit_wallets
       SET available_credits = available_credits + @grant,
           last_weekly_grant_week = @weekKey,
           updated_at = SYSUTCDATETIME()
       WHERE tenant_id = @tenantId AND leader_user_id = @uid`,
      { grant: WEEKLY_LEADER_CREDIT_GRANT, weekKey, tenantId, uid: leaderUserId }
    );
    return { granted: true, pulseCount, weekKey, amount: WEEKLY_LEADER_CREDIT_GRANT };
  }
  return { granted: false, pulseCount, weekKey, lastGrant };
}

export async function getLeaderTeams(tenantId, leaderUserId) {
  const r = await query(
    `SELECT DISTINCT team_name FROM shift_team_objectives
     WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(scope))) = N'team'
       AND leader_user_id = @uid AND team_name IS NOT NULL`,
    { tenantId, uid: leaderUserId }
  );
  const teams = [];
  for (const row of r.recordset || []) {
    const key = normalizeTeamKey(getRow(row, 'team_name'));
    const pool = await ensureTeamPool(tenantId, key);
    teams.push({
      team_key: key,
      team_name: key,
      grace_points_balance: getRow(pool, 'grace_points_balance') || 0,
      sanction_points_balance: getRow(pool, 'sanction_points_balance') || 0,
    });
  }
  return teams;
}

export async function memberBelongsToLeader(tenantId, leaderUserId, memberUserId) {
  if (String(leaderUserId) === String(memberUserId)) return false;
  const r = await query(
    `SELECT member_user_ids FROM shift_team_objectives
     WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(scope))) = N'team' AND leader_user_id = @uid`,
    { tenantId, uid: leaderUserId }
  );
  for (const row of r.recordset || []) {
    const ids = parseMemberIds(getRow(row, 'member_user_ids'));
    if (ids.includes(String(memberUserId))) return true;
  }
  const pulses = await query(
    `SELECT TOP 40 individual_checks_json FROM team_leader_questionnaires
     WHERE tenant_id = @tenantId AND leader_user_id = @uid ORDER BY work_date DESC`,
    { tenantId, uid: leaderUserId }
  );
  for (const row of pulses.recordset || []) {
    let checks = [];
    try {
      const raw = getRow(row, 'individual_checks_json');
      checks = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      checks = [];
    }
    if (!Array.isArray(checks)) continue;
    for (const c of checks) {
      if (c?.member_user_id && String(c.member_user_id) === String(memberUserId)) return true;
    }
  }
  return false;
}

export async function resolveApplicantLeaderId(tenantId, applicantUserId) {
  const r = await query(
    `SELECT TOP 1 leader_user_id, member_user_ids, work_date
     FROM shift_team_objectives
     WHERE tenant_id = @tenantId AND LOWER(LTRIM(RTRIM(scope))) = N'team' AND leader_user_id IS NOT NULL
     ORDER BY work_date DESC`,
    { tenantId }
  );
  for (const row of r.recordset || []) {
    const ids = parseMemberIds(getRow(row, 'member_user_ids'));
    if (ids.includes(String(applicantUserId))) return getRow(row, 'leader_user_id');
  }
  return null;
}

export async function deductLeaderCreditsForIssue(tenantId, leaderUserId, teamKey, points) {
  const pts = Math.max(1, parseInt(points, 10) || 1);
  await maybeGrantWeeklyLeaderCredits(tenantId, leaderUserId, new Date());
  const wallet = await ensureLeaderWallet(tenantId, leaderUserId);
  let walletBal = Number(getRow(wallet, 'available_credits')) || 0;
  let teamBal = 0;
  if (teamKey) {
    const pool = await ensureTeamPool(tenantId, teamKey);
    teamBal = Number(getRow(pool, 'grace_points_balance')) || 0;
  }
  if (walletBal + teamBal < pts) {
    throw new Error(`Insufficient credits (wallet ${walletBal}, team pool ${teamBal}, need ${pts})`);
  }
  let fromWallet = Math.min(walletBal, pts);
  let fromTeam = pts - fromWallet;
  if (fromWallet > 0) {
    await query(
      `UPDATE team_leader_credit_wallets SET available_credits = available_credits - @n, updated_at = SYSUTCDATETIME()
       WHERE tenant_id = @tenantId AND leader_user_id = @uid`,
      { n: fromWallet, tenantId, uid: leaderUserId }
    );
  }
  if (fromTeam > 0 && teamKey) {
    await query(
      `UPDATE team_point_pools SET grace_points_balance = grace_points_balance - @n, updated_at = SYSUTCDATETIME()
       WHERE tenant_id = @tenantId AND team_key = @teamKey`,
      { n: fromTeam, tenantId, teamKey: normalizeTeamKey(teamKey) }
    );
  }
  return { fromWallet, fromTeam };
}

export async function deductTeamSanctionPool(tenantId, teamKey, points) {
  const pts = Math.max(1, parseInt(points, 10) || 1);
  const pool = await ensureTeamPool(tenantId, teamKey);
  const bal = Number(getRow(pool, 'sanction_points_balance')) || 0;
  if (bal < pts) throw new Error(`Insufficient team sanction points (have ${bal}, need ${pts})`);
  await query(
    `UPDATE team_point_pools SET sanction_points_balance = sanction_points_balance - @n, updated_at = SYSUTCDATETIME()
     WHERE tenant_id = @tenantId AND team_key = @teamKey`,
    { n: pts, tenantId, teamKey: normalizeTeamKey(teamKey) }
  );
}

export async function recordMemberGraceCredit({
  tenantId,
  memberUserId,
  leaderUserId,
  categoryId,
  points,
  justification,
  teamKey,
  source,
}) {
  const ins = await query(
    `INSERT INTO employee_grace_credits (tenant_id, user_id, category_id, points, justification, source, issued_by, team_key)
     OUTPUT INSERTED.id
     VALUES (@tenantId, @memberId, @catId, @pts, @just, @source, @leaderId, @teamKey)`,
    {
      tenantId,
      memberId: memberUserId,
      catId: categoryId || null,
      pts: points,
      just: justification,
      source: source || 'team_leader_to_member',
      leaderId: leaderUserId,
      teamKey: teamKey ? normalizeTeamKey(teamKey) : null,
    }
  );
  return getRow(ins.recordset?.[0], 'id');
}

export async function grantLeaderSelfBonus(tenantId, leaderUserId, relatedJustification) {
  await query(
    `INSERT INTO employee_grace_credits (tenant_id, user_id, points, justification, source, issued_by)
     VALUES (@tenantId, @uid, @pts, @just, N'team_leader_self_bonus', @uid)`,
    {
      tenantId,
      uid: leaderUserId,
      pts: LEADER_SELF_BONUS_ON_MEMBER_CREDIT,
      just: `[Leader bonus] ${relatedJustification}`.slice(0, 4000),
    }
  );
}
