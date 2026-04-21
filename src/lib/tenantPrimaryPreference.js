/**
 * Users who belong to both "Thinkers Africa" and "Mbuyelo" should treat Thinkers Africa
 * as the primary tenant for sessions, fallbacks, and ordered tenant_ids (tenant switcher).
 *
 * Matching is name/slug based (case-insensitive) so it works without hard-coded UUIDs.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if this tenant is the Thinkers Africa org (not e.g. "Thinkers" alone). */
export function isThinkersAfricaTenant(name, slug) {
  const n = norm(name);
  const sn = norm(slug).replace(/-/g, '_');
  if (!n && !sn) return false;
  const thinkers = n.includes('thinkers') || sn.includes('thinkers');
  const africa = n.includes('africa') || sn.includes('africa') || sn.includes('afrika');
  return thinkers && africa;
}

export function isMbuyeloTenant(name, slug) {
  const n = norm(name);
  const sn = norm(slug);
  return n.includes('mbuyelo') || sn.includes('mbuyelo');
}

export function isDualThinkersAfricaAndMbuyeloHomes(memberRows) {
  if (!memberRows?.length) return false;
  let thinkers = false;
  let mbuyelo = false;
  for (const r of memberRows) {
    const name = r.name ?? r.Name;
    const slug = r.slug ?? r.Slug;
    if (isThinkersAfricaTenant(name, slug)) thinkers = true;
    if (isMbuyeloTenant(name, slug)) mbuyelo = true;
  }
  return thinkers && mbuyelo;
}

/**
 * Among memberships, return Thinkers Africa tenant id when the user has both Thinkers Africa and Mbuyelo.
 * Otherwise null (caller keeps users.tenant_id as canonical primary).
 */
export function preferredThinkersAfricaTenantId(memberRows) {
  if (!isDualThinkersAfricaAndMbuyeloHomes(memberRows)) return null;
  const row = memberRows.find((r) => isThinkersAfricaTenant(r.name ?? r.Name, r.slug ?? r.Slug));
  const id = row?.tenant_id ?? row?.tenant_Id;
  return id != null ? String(id) : null;
}

/** Stable ordering: Thinkers Africa first, then Mbuyelo, then other tenants (by name). */
export function orderedTenantIdsFromMembership(memberRows) {
  if (!memberRows?.length) return [];
  const sortByName = (a, b) => norm(a.name ?? a.Name).localeCompare(norm(b.name ?? b.Name));
  if (!isDualThinkersAfricaAndMbuyeloHomes(memberRows)) {
    return [...memberRows].sort(sortByName).map((r) => String(r.tenant_id ?? r.tenant_Id)).filter(Boolean);
  }
  const byId = new Map();
  for (const r of memberRows) {
    const id = String((r.tenant_id ?? r.tenant_Id) || '');
    if (!id) continue;
    byId.set(id, r);
  }
  const rows = [...byId.values()];
  const thinkers = rows.filter((r) => isThinkersAfricaTenant(r.name ?? r.Name, r.slug ?? r.Slug)).sort(sortByName);
  const mbuyelo = rows.filter((r) => isMbuyeloTenant(r.name ?? r.Name, r.slug ?? r.Slug)).sort(sortByName);
  const rest = rows
    .filter(
      (r) =>
        !isThinkersAfricaTenant(r.name ?? r.Name, r.slug ?? r.Slug) && !isMbuyeloTenant(r.name ?? r.Name, r.slug ?? r.Slug)
    )
    .sort(sortByName);
  return [...thinkers, ...mbuyelo, ...rest].map((r) => String(r.tenant_id ?? r.tenant_Id));
}

/**
 * Default tenant when session is missing or invalid: Thinkers Africa id for dual-home users, else users.tenant_id, else first membership.
 */
export function defaultActiveTenantId(memberRows, usersTableTenantId) {
  const preferred = preferredThinkersAfricaTenantId(memberRows);
  if (preferred) return preferred;
  const u = usersTableTenantId != null ? String(usersTableTenantId) : '';
  const ordered = orderedTenantIdsFromMembership(memberRows);
  if (u && ordered.includes(u)) return u;
  return ordered[0] || u || null;
}

/**
 * Effective primary for permission/plan fallbacks (same as default active when not switching).
 */
export function effectivePrimaryTenantId(memberRows, usersTableTenantId) {
  return defaultActiveTenantId(memberRows, usersTableTenantId);
}

export async function loadUserTenantMembershipRows(query, userId) {
  let rows = [];
  try {
    const r = await query(
      `SELECT ut.tenant_id, t.name, t.slug
       FROM user_tenants ut
       INNER JOIN tenants t ON t.id = ut.tenant_id
       WHERE ut.user_id = @userId`,
      { userId }
    );
    rows = r.recordset || [];
  } catch (_) {
    rows = [];
  }
  return rows;
}

/**
 * @param {function} query - db query(sql, params)
 * @param {{ userId: string, sessionTenantId: string|null|undefined, usersRowTenantId: string|null|undefined, usersRowTenantName?: string|null, usersRowTenantPlan?: string|null }} opts
 */
export async function resolveUserTenantContext(query, opts) {
  const { userId, sessionTenantId, usersRowTenantId, usersRowTenantName, usersRowTenantPlan } = opts;
  let memberRows = await loadUserTenantMembershipRows(query, userId);
  if (!memberRows.length && usersRowTenantId) {
    try {
      const tr = await query(`SELECT id AS tenant_id, name, slug FROM tenants WHERE id = @id`, { id: usersRowTenantId });
      memberRows = tr.recordset || [];
    } catch (_) {
      memberRows = [];
    }
  }
  const tenant_ids = orderedTenantIdsFromMembership(memberRows);
  const effectivePrimary = effectivePrimaryTenantId(memberRows, usersRowTenantId);
  const sess = sessionTenantId != null && sessionTenantId !== '' ? String(sessionTenantId) : '';
  const currentTenantId =
    sess && tenant_ids.includes(sess) ? sess : effectivePrimary || tenant_ids[0] || (usersRowTenantId != null ? String(usersRowTenantId) : null);

  let tenant_name = usersRowTenantName ?? null;
  let tenant_plan = usersRowTenantPlan ?? null;
  if (currentTenantId) {
    try {
      const trow = await query(`SELECT name, [plan] AS tenant_plan FROM tenants WHERE id = @id`, { id: currentTenantId });
      const tw = trow.recordset?.[0];
      if (tw) {
        tenant_name = tw.name ?? tw.Name ?? tenant_name;
        tenant_plan = tw.tenant_plan ?? tw.Tenant_plan ?? tw.plan ?? tw.Plan ?? tenant_plan;
      }
    } catch (_) {}
  }
  return {
    memberRows,
    tenant_ids,
    effectivePrimaryTenantId: effectivePrimary,
    currentTenantId,
    tenant_name,
    tenant_plan,
  };
}
