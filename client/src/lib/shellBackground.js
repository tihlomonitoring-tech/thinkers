/** Shared shell / login backdrop — mining haul trucks / open pit. */

/** Bundled aerial open-pit mine with haul trucks (public/backgrounds). */
export const SHELL_BG_LOCAL = '/backgrounds/shell-bg.jpg';

/** Haul trucks at a coal mine (Unsplash). */
export const SHELL_BG_REMOTE_PRIMARY =
  'https://images.unsplash.com/photo-1711012604128-8339024a3e12?auto=format&fit=crop&w=2400&q=85';

/** Excavators at a mining area (Unsplash). */
export const SHELL_BG_REMOTE_ALT =
  'https://images.unsplash.com/photo-1523848309072-c199db53f137?auto=format&fit=crop&w=2400&q=85';

/** Local photo first; Unsplash haul-truck shots if the bundle is missing. */
export const SHELL_BG_SOURCES = [SHELL_BG_LOCAL, SHELL_BG_REMOTE_PRIMARY, SHELL_BG_REMOTE_ALT];
