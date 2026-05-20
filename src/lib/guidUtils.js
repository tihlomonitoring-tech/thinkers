/** Parse SQL Server UNIQUEIDENTIFIER values for mssql driver. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESERVED_PATH_IDS = new Set(['tenant-users', 'undefined', 'null']);

export function isReservedPathId(value) {
  return RESERVED_PATH_IDS.has(String(value || '').trim().toLowerCase());
}

export function parseGuid(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value) && value.length === 16) {
    const hex = value.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
  }
  let s = String(value).trim().replace(/^\{|\}$/g, '');
  if (!s || s === 'undefined' || s === 'null') return null;
  if (UUID_RE.test(s)) return s.toLowerCase();
  return null;
}
