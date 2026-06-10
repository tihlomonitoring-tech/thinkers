import fs from 'fs';
import path from 'path';

const SIG_DIR = path.join(process.cwd(), 'uploads', 'inspections', 'signatures');

/**
 * Save a PNG data-URL signature to disk.
 * @returns {string} absolute file path
 */
export function saveSignaturePng(dataUrl, { tenantId, inspectionId, role }) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/i);
  if (!match) throw new Error('Invalid signature image — draw your signature on the pad.');
  const buf = Buffer.from(match[1], 'base64');
  const dir = path.join(SIG_DIR, String(tenantId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `${inspectionId}_${role}_${Date.now()}.png`;
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, buf);
  return absPath;
}
