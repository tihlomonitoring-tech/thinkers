const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalize API / SQL ids to lowercase hyphenated UUID strings for URL paths and payloads. */
export function normalizeEntityId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (Array.isArray(value.data) && String(value.type || '').toLowerCase() === 'buffer') {
      const hex = value.data.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
      if (hex.length === 32) {
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toLowerCase();
      }
    }
    return null;
  }
  let s = String(value).trim().replace(/^\{|\}$/g, '');
  if (!s || s === 'undefined' || s === 'null' || s === '[object Object]') return null;
  if (UUID_RE.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) {
    const h = s.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  return null;
}

export function rowEntityId(row) {
  if (!row) return null;
  return normalizeEntityId(row.id ?? row.Id ?? row.ID);
}

/** Resolve truck id from a row, or match by registration in a fleet list. */
export function resolveTruckId(truck, fleet = []) {
  const direct = rowEntityId(truck);
  if (direct) return direct;
  const reg = String(truck?.registration || '').trim().toLowerCase();
  if (!reg || !Array.isArray(fleet)) return null;
  const match = fleet.find((t) => String(t?.registration || '').trim().toLowerCase() === reg);
  return rowEntityId(match);
}

export function normalizeTruckRow(truck) {
  if (!truck) return truck;
  const id = rowEntityId(truck);
  return id ? { ...truck, id } : truck;
}

export function normalizeDriverRow(driver) {
  if (!driver) return driver;
  const id = rowEntityId(driver);
  const linked = normalizeEntityId(driver.linked_truck_id ?? driver.linkedTruckId);
  return {
    ...driver,
    ...(id ? { id } : {}),
    ...(linked ? { linked_truck_id: linked, linkedTruckId: linked } : {}),
  };
}
