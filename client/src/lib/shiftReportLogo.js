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

/** Logo assets for shift report PDFs. */
export async function loadShiftReportPdfAssets({ tenantId } = {}) {
  const logoDataUrl = await loadShiftReportLogoDataUrl({ tenantId });
  return { logoDataUrl };
}

/**
 * Load image attachments for an investigation report as base64 data URLs for PDF
 * embedding. Returns [{ caption, dataUrl }]. Broken / unreachable attachments are skipped.
 */
export async function loadInvestigationReportAttachmentImages(reportId) {
  if (!reportId) return [];
  let attachments = [];
  try {
    const res = await ccApi.investigationReportAttachments.list(reportId);
    attachments = Array.isArray(res?.attachments) ? res.attachments : [];
  } catch (_) {
    return [];
  }
  const images = [];
  for (const att of attachments) {
    try {
      const blob = await fetchBlobOrNull(ccApi.investigationReportAttachments.fileUrl(att.id));
      if (!blob) continue;
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrl && /^data:image\//i.test(dataUrl)) {
        images.push({ caption: att.caption || att.file_name || '', dataUrl });
      }
    } catch (_) { /* skip broken attachment */ }
  }
  return images;
}

/** Logo + attachment image assets for investigation report PDFs. */
export async function loadInvestigationReportPdfAssets({ tenantId, reportId } = {}) {
  const [logoDataUrl, attachmentImages] = await Promise.all([
    loadShiftReportLogoDataUrl({ tenantId }),
    loadInvestigationReportAttachmentImages(reportId),
  ]);
  return { logoDataUrl, attachmentImages };
}

export default loadShiftReportLogoDataUrl;
