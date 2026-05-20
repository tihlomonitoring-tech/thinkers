/**
 * Subcontractor portal user auto-provisioning (User Management robot).
 * Usernames: abbreviation or first word @system.com — shared password Subcontra123.
 */

export const SUBCONTRACTOR_ROBOT_PASSWORD = 'Subcontra123';
export const SUBCONTRACTOR_ROBOT_EMAIL_DOMAIN = 'system.com';

/** Build local part from company name: multi-word → initials; single word → first word. */
export function buildSubcontractorLocalPart(companyName) {
  const words = String(companyName || '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return 'sub';
  if (words.length === 1) {
    return words[0].toLowerCase().slice(0, 12) || 'sub';
  }
  const abbr = words.map((w) => w.charAt(0)).join('').toLowerCase();
  if (abbr.length >= 2) return abbr.slice(0, 12);
  return words[0].toLowerCase().slice(0, 12) || 'sub';
}

/**
 * Assign unique @system.com emails within tenant + batch (collision-safe).
 * @param {Array<{ id: string, company_name?: string, companyName?: string }>} subcontractors
 * @param {Set<string>} existingEmailsLower emails already in tenant
 */
export function allocateSubcontractorEmails(subcontractors, existingEmailsLower = new Set()) {
  const used = new Set(existingEmailsLower);
  return (subcontractors || []).map((sub) => {
    const company = sub.company_name ?? sub.companyName ?? '';
    const base = buildSubcontractorLocalPart(company);
    let local = base;
    let email = `${local}@${SUBCONTRACTOR_ROBOT_EMAIL_DOMAIN}`;
    let n = 2;
    while (used.has(email)) {
      local = `${base}${n}`;
      email = `${local}@${SUBCONTRACTOR_ROBOT_EMAIL_DOMAIN}`;
      n += 1;
    }
    used.add(email);
    return {
      ...sub,
      proposed_email: email,
      proposed_full_name: String(company).trim() || 'Sub-contractor user',
    };
  });
}

/**
 * @param {object} sub subcontractor row with proposed_email
 * @param {Map<string, { email: string, full_name?: string }>} portalUserBySubId
 */
export function subcontractorRobotRowStatus(sub, portalUserBySubId) {
  const sid = String(sub.id ?? sub.Id ?? '');
  const existing = portalUserBySubId.get(sid);
  if (existing) {
    return {
      status: 'has_portal_user',
      message: `Portal user already exists (${existing.email})`,
      existing_user_email: existing.email,
      selectable: false,
    };
  }
  if (!sub.proposed_email) {
    return { status: 'invalid', message: 'Could not generate username', selectable: false };
  }
  return {
    status: 'ready',
    message: 'Ready to create',
    selectable: true,
  };
}
