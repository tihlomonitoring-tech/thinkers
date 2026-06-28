/** Path -> page_id for main app pages. Must match backend PAGE_IDS. */
export const PATH_PAGE_IDS = {
  '/users': 'users',
  '/tenants': 'tenants',
  '/contractor': 'contractor',
  '/command-centre': 'command_centre',
  '/report-generation': 'report_generation',
  '/office-admin': 'office_admin',
  '/access-management': 'access_management',
  '/rector': 'rector',
  '/tasks': 'tasks',
  '/case-management': 'case_management',
  '/profile': 'profile',
  '/management': 'management',
  '/recruitment': 'recruitment',
  '/letters': 'letters',
  '/letter-composition': 'letters',
  '/accounting-management': 'accounting_management',
  '/logistics-finance-management': 'logistics_finance_management',
  '/tracking-management': 'tracking_integration',
  '/tracking-integration': 'tracking_integration',
  '/fuel-supply-management': 'fuel_supply_management',
  '/fuel-customer-orders': 'fuel_customer_orders',
  '/fuel-data': 'fuel_data',
  '/team-leader-admin': 'team_leader_admin',
  '/performance-evaluations': 'performance_evaluations',
  '/auditor': 'auditor',
  '/company-library': 'company_library',
  '/policy-development': 'policy_development',
  '/quick-sign': 'quick_sign',
  '/operator-profile': 'operator_profile',
  '/operator-management': 'operator_management',
  '/onboarding-admin': 'onboarding_admin',
};

/** page_id values that also grant access to onboarding_admin screen */
const PAGE_ROLE_ALIASES = {
  onboarding_admin: ['onboarding_admin', 'command_centre', 'management'],
  /** Command Centre and management users open Profile → Productivity score from the CC dashboard. */
  profile: ['profile', 'command_centre', 'management', 'team_leader_admin', 'performance_evaluations'],
};

export const ALL_PATHS_ORDER = ['/profile', '/operator-profile', '/team-leader-admin', '/performance-evaluations', '/auditor', '/management', '/operator-management', '/company-library', '/policy-development', '/quick-sign', '/users', '/tenants', '/contractor', '/command-centre', '/onboarding-admin', '/report-generation', '/office-admin', '/fuel-supply-management', '/fuel-customer-orders', '/fuel-data', '/access-management', '/rector', '/tasks', '/case-management', '/recruitment', '/letter-composition', '/accounting-management', '/logistics-finance-management', '/tracking-management'];

/**
 * Whether the user can access the given page.
 * Only super_admin sees all screens. Everyone else (including tenant_admin and enterprise tenants) needs page_id in page_roles.
 */
export function canAccessPage(user, pageId) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const pid = String(pageId).toLowerCase();
  const roles = (user.page_roles || []).map((r) => String(r).toLowerCase());
  if (!roles.length) return false;
  const aliases = PAGE_ROLE_ALIASES[pid];
  if (aliases) return aliases.some((a) => roles.includes(a));
  return roles.includes(pid);
}

/**
 * First sidebar route the user may open, or `/no-access` when their assignments do not map to any registered screen.
 */
export function getFirstAllowedPath(user) {
  return ALL_PATHS_ORDER.find((p) => canAccessPage(user, PATH_PAGE_IDS[p])) ?? '/no-access';
}
