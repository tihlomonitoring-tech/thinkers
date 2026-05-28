const CACHE_KEY = 'cc-my-tabs-v1';
const TTL_MS = 5 * 60 * 1000;

export function readCachedCcTabs() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs) || !parsed.at) return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return parsed.tabs;
  } catch {
    return null;
  }
}

export function writeCachedCcTabs(tabs) {
  try {
    if (!Array.isArray(tabs)) return;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ tabs, at: Date.now() }));
  } catch {
    /* ignore quota */
  }
}
