/** Normalize registration for matching (ignore case and whitespace). */
export function normTruckRegistration(registration) {
  return String(registration || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0\t\r\n]+/g, '');
}

/** Display/storage format: no internal whitespace, uppercased (e.g. MK 20DD GP → MK20DDGP). */
export function compactTruckRegistration(registration) {
  const raw = String(registration || '').trim();
  if (!raw) return '';
  return raw.replace(/[\s\u00a0\t\r\n]+/g, '').toUpperCase();
}

export function compactTruckRegistrationNullable(registration) {
  if (registration == null || String(registration).trim() === '') return null;
  return compactTruckRegistration(registration);
}

/** Field names (normalized) that hold truck/trailer registration values in API payloads. */
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

function compactRegValue(key, value) {
  if (value == null || typeof value !== 'string') return value;
  const compact = compactTruckRegistration(value);
  if (!compact) return String(key).toLowerCase().includes('trailer') ? null : '';
  return compact;
}

/** Normalize registration + trailer fields on a truck row for API responses. */
export function mapTruckRegistrationFields(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (!isTruckRegFieldName(key)) continue;
    out[key] = compactRegValue(key, out[key]);
  }
  return out;
}

/** Recursively compact truck registration fields in nested API payloads. */
export function mapTruckRegistrationFieldsDeep(value) {
  if (value == null) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(mapTruckRegistrationFieldsDeep);
  if (typeof value !== 'object') return value;
  const out = mapTruckRegistrationFields(value);
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v instanceof Date) continue;
    if (v && typeof v === 'object') out[key] = mapTruckRegistrationFieldsDeep(v);
  }
  return out;
}

/** SQL expression matching @regNorm against a registration column. */
export function sqlRegNormExpr(columnExpr) {
  return `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${columnExpr})), CHAR(160), ''), CHAR(9), ''), CHAR(10), ''), CHAR(13), ''), ' ', ''))`;
}

/** SQL expression to compact a registration column (strip whitespace, uppercase). */
export function sqlRegCompactExpr(columnExpr) {
  return `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${columnExpr})), CHAR(160), ''), CHAR(9), ''), CHAR(10), ''), CHAR(13), ''), ' ', ''))`;
}
