export function pickRow(row, ...names) {
  if (!row) return undefined;
  for (const name of names) {
    if (name == null) continue;
    if (row[name] !== undefined && row[name] !== null) return row[name];
    const lower = String(name).toLowerCase();
    const key = Object.keys(row).find((k) => k && k.toLowerCase() === lower);
    if (key !== undefined && row[key] !== undefined) return row[key];
  }
  return undefined;
}

export function formatDt(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(d);
  }
}

export function inputClass(extra = '') {
  return `w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-surface-900 placeholder-surface-500 text-sm ${extra}`;
}
