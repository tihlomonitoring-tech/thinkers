/** Path -> page_id for main app pages. Must match backend PAGE_IDS. */
export const PATH_PAGE_IDS = {
  '/users': 'users',
  '/tenants': 'tenants',
  '/contractor': 'contractor',
  '/command-centre': 'command_centre',
  '/access-management': 'access_management',
  '/rector': 'rector',
  '/tasks': 'tasks',
  '/case-management': 'case_management',
  '/profile': 'profile',
  '/management': 'management',
  '/recruitment': 'recruitment',
  '/letters': 'letters',
  '/accounting-management': 'accounting_management',
  '/fuel-supply-management': 'fuel_supply_management',
  '/fuel-customer-orders': 'fuel_customer_orders',
  '/team-leader-admin': 'team_leader_admin',
  '/performance-evaluations': 'performance_evaluations',
  '/auditor': 'auditor',
  '/company-library': 'company_library',
};

export const ALL_PATHS_ORDER = ['/profile', '/team-leader-admin', '/performance-evaluations', '/auditor', '/management', '/company-library', '/users', '/tenants', '/contractor', '/command-centre', '/fuel-supply-management', '/fuel-customer-orders', '/access-management', '/rector', '/tasks', '/case-management', '/recruitment', '/letters', '/accounting-management'];

/**
 * Whether the user can access the given page.
 * Only super_admin sees all screens. Everyone else (including tenant_admin and enterprise tenants) needs page_id in page_roles.
 */
export function canAccessPage(user, pageId) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const pid = String(pageId).toLowerCase();
  const roles = user.page_roles;
  if (!roles || roles.length === 0) return false;
  return roles.some((r) => String(r).toLowerCase() === pid);
}

/**
 * First sidebar route the user may open, or `/no-access` when their assignments do not map to any registered screen.
 */
export function getFirstAllowedPath(user) {
  return ALL_PATHS_ORDER.find((p) => canAccessPage(user, PATH_PAGE_IDS[p])) ?? '/no-access';
}
