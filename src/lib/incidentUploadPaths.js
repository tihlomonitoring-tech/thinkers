import fs from 'fs';
import path from 'path';
import { parseGuid } from './guidUtils.js';

const DEFAULT_UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

/** Build a normalized relative path for incident attachment storage (lowercase GUID segments). */
export function incidentAttachmentRelPath(tenantId, incidentId, key, originalFilename) {
  const tid = parseGuid(tenantId) || String(tenantId || '').trim().toLowerCase();
  const iid = parseGuid(incidentId) || String(incidentId || '').trim().toLowerCase();
  const ext = (path.extname(originalFilename || '') || '.bin').replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
  return `incidents/${tid}/${iid}_${key}${ext}`;
}

function normalizeRelativePath(filePath) {
  return String(filePath || '')
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
    .replace(/^uploads\//i, '');
}

function normalizeGuidsInPath(relativePath) {
  return relativePath.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    (g) => (parseGuid(g) || g).toLowerCase()
  );
}

/**
 * Resolve a stored incident attachment path to an absolute file on disk.
 * Tries exact path, normalized GUID casing, and case-insensitive folder/file lookup.
 */
export function resolveIncidentUploadPath(storedPath, uploadsRoot = DEFAULT_UPLOADS_ROOT) {
  if (!storedPath) return null;
  const root = path.resolve(uploadsRoot);
  const relative = normalizeRelativePath(storedPath);
  const variants = [...new Set([
    relative,
    normalizeGuidsInPath(relative),
    relative.toLowerCase(),
    normalizeGuidsInPath(relative.toLowerCase()),
  ])];

  for (const rel of variants) {
    const full = path.resolve(path.join(root, rel.replace(/\//g, path.sep)));
    if ((full === root || full.startsWith(root + path.sep)) && fs.existsSync(full)) return full;
  }

  const parts = relative.split('/');
  if (parts.length < 3 || parts[0].toLowerCase() !== 'incidents') return null;

  const tenantPart = parts[1];
  const fileName = parts.slice(2).join('/');
  const incidentsDir = path.join(root, 'incidents');
  if (!fs.existsSync(incidentsDir)) return null;

  for (const dirName of fs.readdirSync(incidentsDir)) {
    if (dirName.toLowerCase() !== tenantPart.toLowerCase()) continue;
    const tenantPath = path.join(incidentsDir, dirName);
    const direct = path.join(tenantPath, fileName);
    if (fs.existsSync(direct)) return path.resolve(direct);
    const targetLower = fileName.toLowerCase();
    try {
      for (const entry of fs.readdirSync(tenantPath)) {
        if (entry.toLowerCase() === targetLower) {
          return path.resolve(path.join(tenantPath, entry));
        }
      }
    } catch (_) { /* skip unreadable dir */ }
  }
  return null;
}

export function attachmentContentType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}
