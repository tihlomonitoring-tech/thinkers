/** Path -> page_id for main app pages. Must match backend PAGE_IDS. */
export const PATH_PAGE_IDS = {
  '/users': 'users',
  '/tenants': 'tenants',
  '/contractor': 'contractor',
  '/command-centre': 'command_centre',
  '/access-management': 'access_management',
  '/rector': 'rector',
  '/tasks': 'tasks',
  '/profile': 'profile',
  '/management': 'management',
  '/transport-operations': 'transport_operations',
};

export const ALL_PATHS_ORDER = ['/profile', '/management', '/users', '/tenants', '/contractor', '/command-centre', '/access-management', '/rector', '/tasks', '/transport-operations'];

/**
 * Whether the user can access the given page.
 * Super_admin: all. No page_roles assigned: all. Otherwise only assigned pages.
 */
export function canAccessPage(user, pageId) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const roles = user.page_roles;
  if (!roles || roles.length === 0) return true;
  return roles.includes(pageId);
}

/** First path the user is allowed to access, or /profile as fallback. */
export function getFirstAllowedPath(user) {
  return ALL_PATHS_ORDER.find((p) => canAccessPage(user, PATH_PAGE_IDS[p])) || '/profile';
}
