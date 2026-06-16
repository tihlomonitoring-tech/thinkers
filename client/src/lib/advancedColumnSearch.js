/** Client-side column + global text filtering for tables and card boards. */

export function matchesColumnSearch(row, columns, columnValues = {}, globalQuery = '') {
  const activeCols = Object.entries(columnValues || {}).filter(([, v]) => String(v || '').trim());
  if (activeCols.length) {
    for (const [key, q] of activeCols) {
      const col = columns.find((c) => c.key === key);
      if (!col) continue;
      const val = String(col.get(row) ?? '').toLowerCase();
      if (!val.includes(String(q).trim().toLowerCase())) return false;
    }
    return true;
  }
  const g = String(globalQuery || '').trim().toLowerCase();
  if (!g) return true;
  return columns.some((col) => String(col.get(row) ?? '').toLowerCase().includes(g));
}

export function countActiveSearchFilters(columnValues = {}, globalQuery = '') {
  const cols = Object.values(columnValues || {}).filter((v) => String(v || '').trim()).length;
  const global = String(globalQuery || '').trim() ? 1 : 0;
  return cols + global;
}

export function emptyColumnValues(columns) {
  return Object.fromEntries((columns || []).map((c) => [c.key, '']));
}
