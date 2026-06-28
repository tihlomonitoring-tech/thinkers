/**
 * Canonical letter types and PDF template designs for Letter composition.
 * Mirror of client/src/lib/letterTypes.js (keep in sync). Pure data — no deps.
 */

export const LETTER_TYPES = [
  { id: 'warning', label: 'Warning letter', referencesPolicies: true },
  { id: 'reward', label: 'Reward letter' },
  { id: 'employment_contract', label: 'Employment contract' },
  { id: 'supply_contract', label: 'Supply contract' },
  { id: 'sla', label: 'Service level agreement (SLA)' },
  { id: 'letter_of_intent', label: 'Letter of intent' },
  { id: 'promotion', label: 'Promotion letter' },
  { id: 'contractor_termination', label: 'Contractor termination letter' },
  { id: 'transfer', label: 'Transfer letter' },
  { id: 'generic', label: 'Generic letter' },
];

export const LETTER_TYPE_IDS = LETTER_TYPES.map((t) => t.id);

export function letterTypeLabel(id) {
  return LETTER_TYPES.find((t) => t.id === id)?.label || 'Letter';
}

/** PDF template designs the user can pick from. */
export const LETTER_TEMPLATES = [
  { id: 'executive', label: 'Executive', desc: 'Accent side rule, bold corporate letterhead' },
  { id: 'modern', label: 'Modern', desc: 'Full-width accent band, clean sans headings' },
  { id: 'classic', label: 'Classic', desc: 'Centred serif-style formal letterhead' },
  { id: 'minimal', label: 'Minimal', desc: 'Understated header, generous whitespace' },
];

export const LETTER_TEMPLATE_IDS = LETTER_TEMPLATES.map((t) => t.id);

/** Accent palette (shared with the on-screen preview). */
export const LETTER_ACCENTS = [
  { id: 'navy', hex: '#1e3a8a', name: 'Corporate navy' },
  { id: 'brand', hex: '#991B1B', name: 'Brand red' },
  { id: 'slate', hex: '#334155', name: 'Slate' },
  { id: 'emerald', hex: '#047857', name: 'Emerald' },
  { id: 'indigo', hex: '#4338ca', name: 'Indigo' },
  { id: 'amber', hex: '#b45309', name: 'Amber' },
];

export function accentHexById(id) {
  return LETTER_ACCENTS.find((a) => a.id === id)?.hex || LETTER_ACCENTS[0].hex;
}
