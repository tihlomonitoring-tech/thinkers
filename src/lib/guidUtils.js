/** Parse SQL Server UNIQUEIDENTIFIER values for mssql driver. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESERVED_PATH_IDS = new Set(['tenant-users', 'undefined', 'null', 'bulk-update', 'bulk']);

export function isReservedPathId(value) {
  return RESERVED_PATH_IDS.has(String(value || '').trim().toLowerCase());
}

export function parseGuid(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value) && value.length === 16) {
    const hex = value.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.data) && String(value.type || '').toLowerCase() === 'buffer') {
      return parseGuid(Buffer.from(value.data));
    }
  }
  let s = String(value).trim().replace(/^\{|\}$/g, '');
  if (!s || s === 'undefined' || s === 'null' || s === '[object Object]') return null;
  if (UUID_RE.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) {
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`.toLowerCase();
  }
  return null;
}

const DEFAULT_GUID_ROW_KEYS = [
  'id', 'tenant_id', 'contractor_id', 'subcontractor_id', 'linked_truck_id',
  'route_id', 'truck_id', 'driver_id', 'trip_id', 'added_by_user_id', 'user_id',
  'entity_id', 'contractor_route_id',
];

/** Normalize UNIQUEIDENTIFIER columns on API rows (Buffer / braced strings → hyphenated uuid). */
export function mapRowGuids(row, extraKeys = []) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  const keys = new Set([...DEFAULT_GUID_ROW_KEYS, ...extraKeys].map((k) => k.toLowerCase()));
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (!keys.has(lower)) continue;
    if (out[key] == null) continue;
    const g = parseGuid(out[key]);
    if (g) {
      out[lower] = g;
      if (lower !== key) out[key] = g;
    }
  }
  return out;
}

/** Read a row's primary id regardless of SQL column casing. */
export function rowId(row) {
  if (!row) return null;
  return parseGuid(row.id ?? row.Id ?? row.ID) ?? row.id ?? row.Id ?? row.ID ?? null;
}
