import { query } from '../db.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export function normalizeCodePrefix(prefix, fallbackName = '') {
  let p = String(prefix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!p && fallbackName) {
    p = String(fallbackName)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
  }
  if (!p) p = 'AST';
  return p.slice(0, 8);
}

/**
 * Next short code for a tenant: {PREFIX}-{NNN} (e.g. IT-001, FUR-042).
 */
export async function generateNextAssetCode(tenantId, codePrefix) {
  const prefix = normalizeCodePrefix(codePrefix);
  const pattern = `${prefix}-%`;
  const r = await query(
    `SELECT asset_code FROM office_admin_assets
     WHERE tenant_id = @tenantId AND asset_code LIKE @pattern`,
    { tenantId, pattern }
  );
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const row of r.recordset || []) {
    const code = String(get(row, 'asset_code') || '');
    const m = code.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export async function getCategoryById(tenantId, categoryId) {
  if (!categoryId) return null;
  const r = await query(
    `SELECT * FROM office_admin_asset_categories WHERE id = @id AND tenant_id = @tenantId`,
    { id: categoryId, tenantId }
  );
  return r.recordset?.[0] || null;
}
