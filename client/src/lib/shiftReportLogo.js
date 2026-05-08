import { commandCentre as ccApi, tenants as tenantsApi } from '../api';

const DEFAULT_LOGO_PATHS = ['/logos/tihlo-logo.png', '/logos/tihlo-logo.jpg', '/logos/logo.png'];

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const r = new FileReader();
    r.onloadend = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function fetchBlobOrNull(url, init = {}) {
  try {
    const r = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
    if (!r.ok) return null;
    return await r.blob();
  } catch (_) {
    return null;
  }
}

/**
 * Load the shift report logo as a base64 data URL.
 * Priority: tenant's Command Centre custom logo → tenant logo → packaged default logos.
 * Returns null when no logo is available.
 */
export async function loadShiftReportLogoDataUrl({ tenantId } = {}) {
  try {
    const ccBlob = await fetchBlobOrNull(`${ccApi.settings.logoUrl()}?t=${Date.now()}`);
    if (ccBlob) {
      const url = await blobToDataUrl(ccBlob);
      if (url) return url;
    }
  } catch (_) {}
  if (tenantId) {
    try {
      const blob = await fetchBlobOrNull(tenantsApi.logoUrl(tenantId));
      if (blob) {
        const url = await blobToDataUrl(blob);
        if (url) return url;
      }
    } catch (_) {}
  }
  for (const path of DEFAULT_LOGO_PATHS) {
    try {
      const blob = await fetchBlobOrNull(path);
      if (blob) {
        const url = await blobToDataUrl(blob);
        if (url) return url;
      }
    } catch (_) {}
  }
  return null;
}

export default loadShiftReportLogoDataUrl;
