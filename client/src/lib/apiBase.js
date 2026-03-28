/**
 * Resolved API base URL (includes `/api`).
 *
 * Build-time env can wrongly embed http://localhost:3001 (old CI or client/.env). Browsers on
 * https://wiseapp.co.za cannot reach that. We therefore resolve at RUNTIME first: if the page is
 * not opened on localhost/127.0.0.1, never use loopback — use same-origin /api (or a valid remote
 * VITE_API_BASE for split hosting).
 */

function isUnsafeProductionApiHost(hostname) {
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h === '0.0.0.0') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

/** True if VITE_API_BASE is safe to use as a remote API (split hosting). */
function isUsableProductionViteApiBase(raw) {
  if (!raw) return false;
  const t = raw.trim();
  if (t.startsWith('/')) return t === '/api' || t.endsWith('/api');
  try {
    const u = new URL(t);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    return !isUnsafeProductionApiHost(u.hostname);
  } catch {
    return false;
  }
}

function absoluteApiBaseFromRemoteUrl(raw) {
  const u = new URL(raw);
  const p = u.pathname.replace(/\/$/, '') || '';
  if (p.endsWith('/api')) return `${u.origin}${p}`;
  return `${u.origin}${p}/api`;
}

function bakedViteApiBase() {
  return typeof import.meta.env?.VITE_API_BASE === 'string' ? import.meta.env.VITE_API_BASE.trim() : '';
}

export function getApiBase() {
  const baked = bakedViteApiBase();

  // --- Runtime (browser): fixes bad bundles that still point at localhost on real domains ---
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      if (!baked || /localhost|127\.0\.0\.1/i.test(baked)) {
        return `${window.location.origin}/api`;
      }
      if (isUsableProductionViteApiBase(baked)) {
        try {
          return absoluteApiBaseFromRemoteUrl(baked);
        } catch {
          return `${window.location.origin}/api`;
        }
      }
      // Dev on LAN: VITE_API_BASE may point at another machine (private IP) — keep as-is
      if (import.meta.env.DEV && /^https?:\/\//i.test(baked)) {
        return baked;
      }
      return `${window.location.origin}/api`;
    }
  }

  // --- Vite dev on localhost / 127.0.0.1 ---
  if (import.meta.env.DEV) {
    if (baked) return baked;
    return 'http://localhost:3001/api';
  }

  // --- Production build, no window (SSR) or edge ---
  if (baked.startsWith('/')) {
    if (baked === '/api' || baked.endsWith('/api')) return baked;
    return '/api';
  }

  if (baked && isUsableProductionViteApiBase(baked)) {
    try {
      return absoluteApiBaseFromRemoteUrl(baked);
    } catch {
      return '/api';
    }
  }

  if (baked) {
    console.warn(
      '[api] Ignoring VITE_API_BASE for production:',
      baked,
      '→ using /api. For split hosting set VITE_API_BASE=https://your-api-host/api at build time.'
    );
  }
  return '/api';
}
