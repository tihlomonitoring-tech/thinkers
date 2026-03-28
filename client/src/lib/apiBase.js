/**
 * Resolved API base URL (includes `/api`).
 *
 * Production: defaults to same-origin `/api` so any hostname (custom domain, Azure) works without
 * baking URLs. Only uses VITE_API_BASE when it points to a real remote API (split hosting).
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

/** True if VITE_API_BASE is safe to use in a production build. */
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

export function getApiBase() {
  if (import.meta.env.DEV) {
    const raw = typeof import.meta.env?.VITE_API_BASE === 'string' ? import.meta.env.VITE_API_BASE.trim() : '';
    if (raw) return raw;
    return 'http://localhost:3001/api';
  }

  const raw = typeof import.meta.env?.VITE_API_BASE === 'string' ? import.meta.env.VITE_API_BASE.trim() : '';

  if (raw.startsWith('/')) {
    if (raw === '/api' || raw.endsWith('/api')) return raw;
    console.warn('[api] VITE_API_BASE should be /api or end with /api; using /api');
    return '/api';
  }

  if (raw && isUsableProductionViteApiBase(raw)) {
    try {
      return absoluteApiBaseFromRemoteUrl(raw);
    } catch {
      return '/api';
    }
  }

  if (raw) {
    console.warn(
      '[api] Ignoring VITE_API_BASE for production (loopback, LAN, or invalid):',
      raw,
      '→ using same-origin /api. For split hosting set VITE_API_BASE=https://your-api-host/api at build time.'
    );
  }
  return '/api';
}
