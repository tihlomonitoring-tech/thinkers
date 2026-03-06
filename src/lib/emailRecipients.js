/**
 * Resolve email recipients for notifications.
 * @param {Function} query - db query function (query(sql, params))
 */

/** All users who have Command Centre access (tab grant or page), or Rector/Access Management page, or are route factors. */
export async function getCommandCentreAndRectorEmails(query) {
  const emails = new Set();
  const getRowEmail = (row) => {
    if (!row || typeof row !== 'object') return null;
    const key = Object.keys(row).find((k) => k.toLowerCase() === 'email');
    const e = (key ? row[key] : row.email ?? row.Email ?? '').toString().trim();
    return e && e.includes('@') ? e : null;
  };
  let fromGrants = 0;
  let fromPages = 0;
  let fromFactors = 0;
  try {
    const ccResult = await query(
      `SELECT DISTINCT u.email FROM command_centre_grants g
       INNER JOIN users u ON u.id = g.user_id
       WHERE u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`
    );
    const rows = ccResult?.recordset ?? [];
    for (const row of rows) {
      const e = getRowEmail(row);
      if (e) { emails.add(e); fromGrants++; }
    }
  } catch (err) {
    console.warn('[emailRecipients] command_centre_grants:', err?.message || err);
  }
  try {
    const pageResult = await query(
      `SELECT DISTINCT u.email FROM user_page_roles r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.page_id IN (N'command_centre', N'rector', N'access_management') AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`
    );
    const rows = pageResult?.recordset ?? [];
    for (const row of rows) {
      const e = getRowEmail(row);
      if (e) { emails.add(e); fromPages++; }
    }
  } catch (err) {
    console.warn('[emailRecipients] user_page_roles:', err?.message || err);
  }
  try {
    const factorsResult = await query(
      `SELECT DISTINCT u.email FROM access_route_factors f
       INNER JOIN users u ON u.id = f.user_id
       WHERE f.user_id IS NOT NULL AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`
    );
    const rows = factorsResult?.recordset ?? [];
    for (const row of rows) {
      const e = getRowEmail(row);
      if (e) { emails.add(e); fromFactors++; }
    }
  } catch (err) {
    console.warn('[emailRecipients] access_route_factors:', err?.message || err);
  }
  const list = Array.from(emails);
  console.log('[emailRecipients] getCommandCentreAndRectorEmails: from_grants=', fromGrants, 'from_page_roles=', fromPages, 'from_route_factors=', fromFactors, 'total=', list.length);
  return list;
}

/** All users in a tenant (for contractor notifications e.g. approval). */
export async function getTenantUserEmails(query, tenantId) {
  if (!tenantId) return [];
  const emails = new Set();
  try {
    const result = await query(
      `SELECT email FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`,
      { tenantId }
    );
    for (const row of result.recordset || []) {
      const e = (row.email || '').trim();
      if (e) emails.add(e);
    }
  } catch (_) {}
  return Array.from(emails);
}

/** Users in a tenant who are scoped to a specific contractor (company): users with no user_contractors rows (tenant-wide) or linked to this contractor_id. Use for per-company alerts (approval, suspend, reinstate, breakdown). */
export async function getContractorUserEmails(query, tenantId, contractorId) {
  if (!tenantId || !contractorId) return [];
  const emails = new Set();
  try {
    const result = await query(
      `SELECT u.email FROM users u
       WHERE u.tenant_id = @tenantId AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''
         AND (NOT EXISTS (SELECT 1 FROM user_contractors uc WHERE uc.user_id = u.id)
              OR EXISTS (SELECT 1 FROM user_contractors uc WHERE uc.user_id = u.id AND uc.contractor_id = @contractorId))`,
      { tenantId, contractorId }
    );
    for (const row of result.recordset || []) {
      const e = (row.email || '').trim();
      if (e && e.includes('@')) emails.add(e);
    }
  } catch (err) {
    console.warn('[emailRecipients] getContractorUserEmails:', err?.message || err);
  }
  return Array.from(emails);
}

/** Management users' emails for a tenant (for leave application notifications). */
export async function getManagementEmailsForTenant(query, tenantId) {
  if (!tenantId) return [];
  const emails = new Set();
  try {
    const result = await query(
      `SELECT DISTINCT u.email FROM user_page_roles r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.page_id = N'management'
         AND (u.tenant_id = @tenantId OR EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id = @tenantId))
         AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`,
      { tenantId }
    );
    for (const row of result.recordset || []) {
      const e = (row.email || '').trim();
      if (e && e.includes('@')) emails.add(e);
    }
  } catch (err) {
    try {
      const fallback = await query(
        `SELECT DISTINCT u.email FROM user_page_roles r
         INNER JOIN users u ON u.id = r.user_id
         WHERE r.page_id = N'management' AND u.tenant_id = @tenantId
           AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`,
        { tenantId }
      );
      for (const row of fallback.recordset || []) {
        const e = (row.email || '').trim();
        if (e && e.includes('@')) emails.add(e);
      }
    } catch (_) {}
  }
  return Array.from(emails);
}

/** Users with Access Management page (for truck enrollment notifications). */
export async function getAccessManagementEmails(query) {
  const emails = new Set();
  const getRowEmail = (row) => {
    if (!row || typeof row !== 'object') return null;
    const key = Object.keys(row).find((k) => k.toLowerCase() === 'email');
    const e = (key ? row[key] : row.email ?? row.Email ?? '').toString().trim();
    return e && e.includes('@') ? e : null;
  };
  try {
    const result = await query(
      `SELECT DISTINCT u.email FROM user_page_roles r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.page_id = N'access_management' AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''`
    );
    const rows = result?.recordset ?? [];
    for (const row of rows) {
      const e = getRowEmail(row);
      if (e) emails.add(e);
    }
  } catch (err) {
    console.warn('[emailRecipients] getAccessManagementEmails:', err?.message || err);
  }
  return Array.from(emails);
}

/** Super admin users' emails (for new user / new tenant notifications). */
export async function getSuperAdminEmails(query) {
  const emails = new Set();
  try {
    const result = await query(
      `SELECT email FROM users WHERE role = N'super_admin' AND email IS NOT NULL AND LTRIM(RTRIM(email)) <> N''`
    );
    for (const row of result.recordset || []) {
      const e = (row.email || '').trim();
      if (e && e.includes('@')) emails.add(e);
    }
  } catch (_) {}
  return Array.from(emails);
}
