import { query } from '../db.js';

/** Page IDs for app pages — keep in sync with `src/routes/users.js` `PAGE_IDS`. Used for super_admin page_roles. */
const PAGE_IDS = ['profile', 'management', 'users', 'tenants', 'contractor', 'command_centre', 'access_management', 'rector', 'tasks', 'transport_operations', 'recruitment', 'letters', 'accounting_management', 'tracking_integration', 'fuel_supply_management', 'fuel_customer_orders', 'team_leader_admin', 'performance_evaluations', 'auditor'];

/** Only platform super_admin skips page assignments (full app). Everyone else needs user_page_roles rows. */
export function isPageAccessExempt(user) {
  if (!user) return false;
  return user.role === 'super_admin';
}

/** Must have at least one page assigned in DB (or be exempt). Used for login and session validity. */
export function hasRequiredPageAssignments(user) {
  if (isPageAccessExempt(user)) return true;
  const roles = user.page_roles;
  return Array.isArray(roles) && roles.length > 0;
}

/** Get value from row with case-insensitive key (SQL Server may return different casing) */
function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

export async function loadUser(req, res, next) {
  if (!req.session?.userId) return next();
  try {
    const result = await query(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.status, u.avatar_url, u.last_login_at, u.login_count, u.created_at, u.login_locked_at,
              t.name AS tenant_name, t.[plan] AS tenant_plan
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = @userId`,
      { userId: req.session.userId }
    );
    const row = result.recordset[0];
    if (!row) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session invalid' });
    }
    if (get(row, 'login_locked_at')) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
      return res.status(401).json({
        error:
          'This account is locked after failed sign-in attempts. A super administrator can unlock it under User management → Block requests, or complete Forgot password to clear the lock after setting a new password.',
      });
    }
    let tenant_ids = [];
    try {
      const ut = await query(`SELECT tenant_id FROM user_tenants WHERE user_id = @userId`, { userId: req.session.userId });
      tenant_ids = (ut.recordset || []).map((r) => r.tenant_id ?? r.tenant_Id).filter(Boolean);
    } catch (_) {}
    const primaryTenantId = get(row, 'tenant_id');
    if (tenant_ids.length === 0 && primaryTenantId) tenant_ids = [primaryTenantId];
    const sessionTenantId = req.session.tenantId;
    const currentTenantId = (sessionTenantId && tenant_ids.includes(sessionTenantId)) ? sessionTenantId : (primaryTenantId || tenant_ids[0] || null);
    let tenant_name = get(row, 'tenant_name');
    let tenant_plan = get(row, 'tenant_plan');
    if (currentTenantId && currentTenantId !== primaryTenantId) {
      try {
        const trow = await query(`SELECT name, [plan] FROM tenants WHERE id = @id`, { id: currentTenantId });
        if (trow.recordset?.[0]) {
          tenant_name = trow.recordset[0].name ?? trow.recordset[0].name;
          tenant_plan = trow.recordset[0].plan ?? trow.recordset[0].plan;
        }
      } catch (_) {}
    }
    let page_roles = [];
    try {
      const pr = await query(`SELECT page_id FROM user_page_roles WHERE user_id = @userId`, { userId: req.session.userId });
      page_roles = (pr.recordset || []).map((r) => r.page_id ?? r.page_Id).filter(Boolean);
    } catch (_) {}
    if (get(row, 'role') === 'super_admin') page_roles = PAGE_IDS.slice();
    req.user = {
      id: get(row, 'id'),
      tenant_id: currentTenantId,
      tenant_ids,
      tenant_name,
      tenant_plan,
      email: get(row, 'email'),
      full_name: get(row, 'full_name'),
      role: get(row, 'role'),
      status: get(row, 'status'),
      avatar_url: get(row, 'avatar_url'),
      last_login_at: get(row, 'last_login_at'),
      login_count: get(row, 'login_count'),
      created_at: get(row, 'created_at'),
      page_roles,
    };
    if (!hasRequiredPageAssignments(req.user)) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
      return res.status(401).json({
        error: 'No page access assigned to this account. You have been signed out. Contact your administrator.',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Super admin only (can manage all tenants) */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/** Routes that create tenants/contractors/etc.: super_admin, tenant_admin, or enterprise tenant managers. (Separate from per-page requirePageAccess.) */
export function requireTenantAdmin(req, res, next) {
  const role = req.user?.role;
  const tenantPlan = req.user?.tenant_plan;
  const isEnterprise = String(tenantPlan).toLowerCase() === 'enterprise';
  if (role === 'super_admin' || role === 'tenant_admin' || isEnterprise) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

/**
 * Restrict route to users who have access to the given page(s).
 * allowedPageIds: string (one page_id) or string[] (any of).
 * Only super_admin bypasses (full access). All other roles, including tenant_admin and enterprise tenants,
 * must have the page in user_page_roles.
 */
export function requirePageAccess(allowedPageIds) {
  const allowed = Array.isArray(allowedPageIds) ? allowedPageIds : [allowedPageIds];
  const allowedNorm = allowed.map((p) => String(p).toLowerCase());
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'super_admin') return next();
    const roles = req.user.page_roles || [];
    const roleNorm = roles.map((r) => String(r).toLowerCase());
    const hasAccess = allowedNorm.some((pid) => roleNorm.includes(pid));
    if (hasAccess) return next();
    return res.status(403).json({ error: 'You do not have access to this page.' });
  };
}
