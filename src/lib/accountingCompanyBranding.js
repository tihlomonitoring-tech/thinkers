/**
 * Company branding for PDFs — Accounting settings, then Command Centre tenant logo.
 */
import fs from 'fs';
import path from 'path';

const uploadsRoot = () => path.join(process.cwd(), 'uploads');

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

function readLogoFile(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) return { buffer: null, filePath: null };
  const normalized = String(relativeOrAbsolutePath).trim().replace(/\\/g, '/').replace(/^\/+/, '');
  let fp = path.isAbsolute(normalized)
    ? normalized
    : path.join(process.cwd(), normalized.split('/').join(path.sep));
  if (!path.isAbsolute(normalized) && !normalized.startsWith('uploads')) {
    fp = path.join(uploadsRoot(), normalized.split('/').join(path.sep));
  }
  const fpNorm = path.normalize(fp);
  const rootNorm = path.normalize(uploadsRoot());
  if (!fpNorm.startsWith(rootNorm + path.sep) && fpNorm !== rootNorm) return { buffer: null, filePath: null };
  if (!fs.existsSync(fpNorm)) return { buffer: null, filePath: null };
  try {
    return { buffer: fs.readFileSync(fpNorm), filePath: fpNorm };
  } catch {
    return { buffer: null, filePath: null };
  }
}

export function readAccountingLogoBuffer(logoPath) {
  return readLogoFile(logoPath).buffer;
}

/** uploads/accounting/{tenantId}/logo.* */
export function findTenantAccountingLogoBuffer(tenantId) {
  if (!tenantId) return { buffer: null, filePath: null };
  const accountingRoot = path.join(uploadsRoot(), 'accounting');
  if (!fs.existsSync(accountingRoot)) return { buffer: null, filePath: null };
  const tid = String(tenantId);
  let dir = path.join(accountingRoot, tid);
  if (!fs.existsSync(dir)) {
    const match = fs.readdirSync(accountingRoot).find((f) => f.toLowerCase() === tid.toLowerCase());
    if (match) dir = path.join(accountingRoot, match);
    else return { buffer: null, filePath: null };
  }
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^logo\.[a-z0-9]+$/i.test(n));
  } catch {
    return { buffer: null, filePath: null };
  }
  const prefer = ['logo.jpeg', 'logo.jpg', 'logo.png', 'logo.webp', 'logo.gif'];
  const ordered = [
    ...prefer.filter((p) => names.some((f) => f.toLowerCase() === p)),
    ...names.filter((n) => !prefer.some((p) => p === n.toLowerCase())),
  ];
  for (const name of ordered) {
    const actual = names.find((f) => f.toLowerCase() === name.toLowerCase()) || name;
    const hit = readLogoFile(path.join('uploads', 'accounting', path.basename(dir), actual));
    if (hit.buffer?.length) return hit;
  }
  return { buffer: null, filePath: null };
}

/** uploads/command-centre/logos/{tenantId}.* or tenants.cc_logo_url */
export function findCommandCentreLogoBuffer(tenantId, ccLogoUrl) {
  if (ccLogoUrl) {
    const rel = String(ccLogoUrl).replace(/\\/g, '/');
    const hit = readLogoFile(rel.startsWith('uploads/') ? rel : path.join('uploads', rel));
    if (hit.buffer?.length) return hit;
  }
  if (!tenantId) return { buffer: null, filePath: null };
  const dir = path.join(uploadsRoot(), 'command-centre', 'logos');
  if (!fs.existsSync(dir)) return { buffer: null, filePath: null };
  const tid = String(tenantId);
  for (const name of [`${tid}.png`, `${tid}.jpeg`, `${tid}.jpg`, `${tid}.webp`, `${tid}.gif`]) {
    const fp = path.join(dir, name);
    if (fs.existsSync(fp)) {
      try {
        return { buffer: fs.readFileSync(fp), filePath: fp };
      } catch {
        /* try next */
      }
    }
    const match = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
    if (match) {
      const hit = readLogoFile(path.join('uploads', 'command-centre', 'logos', match));
      if (hit.buffer?.length) return hit;
    }
  }
  return { buffer: null, filePath: null };
}

function pickLogo(...candidates) {
  for (const c of candidates) {
    if (c?.buffer?.length) return c;
  }
  return { buffer: null, filePath: null };
}

/**
 * @param {import('../db.js').query} queryFn
 * @param {string} tenantId
 */
export async function loadAccountingCompanyBranding(queryFn, tenantId) {
  if (!tenantId) {
    return { company: { company_name: 'Company' }, logoBuffer: null, logoPath: null };
  }
  const tid = String(tenantId);
  const [settingsR, tenantR] = await Promise.all([
    queryFn(
      `SELECT company_name, address, vat_number, company_registration, email, website, logo_path
       FROM accounting_company_settings WHERE tenant_id = @t`,
      { t: tid }
    ),
    queryFn(`SELECT name, cc_logo_url FROM tenants WHERE id = @t`, { t: tid }),
  ]);
  const row = settingsR.recordset?.[0];
  const tenantRow = tenantR.recordset?.[0];
  const ccLogoUrl = get(tenantRow, 'cc_logo_url');

  const company = row
    ? {
        company_name: get(row, 'company_name') || get(tenantRow, 'name') || 'Company',
        address: get(row, 'address'),
        vat_number: get(row, 'vat_number'),
        company_registration: get(row, 'company_registration'),
        email: get(row, 'email'),
        website: get(row, 'website'),
      }
    : { company_name: get(tenantRow, 'name') || 'Company' };

  const logo = pickLogo(
    readLogoFile(get(row, 'logo_path')),
    findTenantAccountingLogoBuffer(tid),
    findCommandCentreLogoBuffer(tid, ccLogoUrl)
  );

  return { company, logoBuffer: logo.buffer, logoPath: logo.filePath };
}
