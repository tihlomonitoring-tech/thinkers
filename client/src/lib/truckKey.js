/** Client-side registration key — must match server normTruckRegistration. */
export function truckRegKey(registration) {
  return String(registration || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0\t\r\n]+/g, '');
}

/** Display format: no gaps (e.g. MK 20DD GP → MK20DDGP). */
export function formatTruckRegistration(registration) {
  const raw = String(registration || '').trim();
  if (!raw) return '';
  return raw.replace(/[\s\u00a0\t\r\n]+/g, '').toUpperCase();
}

const TRUCK_REG_FIELD_KEYS = new Set([
  'registration',
  'truckregistration',
  'truckreg',
  'linkedtruckregistration',
  'trailer1regno',
  'trailer2regno',
  'fleetregistration',
  'trailerregistration',
  'originalregistration',
  'systemregistration',
  'registrationnumber',
  'registrationno',
]);

function isTruckRegFieldName(key) {
  return TRUCK_REG_FIELD_KEYS.has(String(key || '').toLowerCase().replace(/_/g, ''));
}

/** Recursively format truck registration fields in API JSON (all pages). */
export function normalizeTruckRegsInData(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalizeTruckRegsInData);
  if (typeof value !== 'object') return value;
  const out = { ...value };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === 'string' && isTruckRegFieldName(key)) {
      const compact = formatTruckRegistration(v);
      out[key] = compact || (String(key).toLowerCase().includes('trailer') ? null : '');
    } else if (v && typeof v === 'object') {
      out[key] = normalizeTruckRegsInData(v);
    }
  }
  return out;
}

export function truckRowKey(truck) {
  return truckRegKey(truck?.registration);
}

export function truckSubcontractorLabel(truck) {
  return (truck?.subcontractor_company_name || truck?.sub_contractor || truck?.subContractor || '').trim();
}

/** One row per normalized registration — prefer linked subcontractor / facility data. */
export function dedupeFleetTrucks(trucks) {
  const byReg = new Map();
  for (const t of trucks || []) {
    const rk = truckRowKey(t);
    if (!rk) continue;
    const existing = byReg.get(rk);
    if (!existing) {
      byReg.set(rk, t);
      continue;
    }
    const score = (row) => {
      let s = 0;
      if (truckSubcontractorLabel(row)) s += 4;
      if (row.facility_access) s += 2;
      if (row.make_model || row.makeModel) s += 1;
      if (row.id) s += 0.5;
      return s;
    };
    if (score(t) > score(existing)) byReg.set(rk, t);
  }
  return [...byReg.values()];
}

export function fleetRowReactKey(truck) {
  const id = truck?.id != null ? String(truck.id).toLowerCase() : '';
  const rk = truckRowKey(truck);
  return id || rk || String(truck?.registration || '');
}
