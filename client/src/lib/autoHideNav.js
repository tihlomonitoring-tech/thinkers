/** Fired on `window` after the delay so Layout can hide the main app sidebar. */
export const AUTO_HIDE_NAV_FIRE = 'thinkers:auto-hide-nav-fire';

/** Fired when the user changes the disable preference (e.g. other tab). */
export const AUTO_HIDE_NAV_PREF_CHANGED = 'thinkers:auto-hide-nav-pref-changed';

export const AUTO_HIDE_NAV_DISABLED_KEY = 'thinkers:disable-auto-hide-nav';

export const AUTO_HIDE_NAV_DELAY_MS = 5000;

let timeoutId = null;

export function isAutoHideNavDisabled() {
  try {
    return localStorage.getItem(AUTO_HIDE_NAV_DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoHideNavDisabled(disabled) {
  try {
    if (disabled) localStorage.setItem(AUTO_HIDE_NAV_DISABLED_KEY, '1');
    else localStorage.removeItem(AUTO_HIDE_NAV_DISABLED_KEY);
  } catch {
    /* ignore */
  }
  cancelAutoHideNav();
  try {
    window.dispatchEvent(new CustomEvent(AUTO_HIDE_NAV_PREF_CHANGED));
  } catch {
    /* ignore */
  }
}

export function cancelAutoHideNav() {
  if (timeoutId != null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

export function scheduleAutoHideNav() {
  cancelAutoHideNav();
  if (isAutoHideNavDisabled()) return;
  timeoutId = window.setTimeout(() => {
    timeoutId = null;
    try {
      window.dispatchEvent(new CustomEvent(AUTO_HIDE_NAV_FIRE));
    } catch {
      /* ignore */
    }
  }, AUTO_HIDE_NAV_DELAY_MS);
}
