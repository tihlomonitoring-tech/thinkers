/** Shared colours for haul-road route options A, B, C… on map and in UI. */
export const ROUTE_OPTION_PALETTE = [
  { id: 'A', line: '#0ea5e9', corridor: '#7c3aed', chip: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
  { id: 'B', line: '#0891b2', corridor: '#0891b2', chip: 'bg-cyan-600', text: 'text-cyan-700 dark:text-cyan-300' },
  { id: 'C', line: '#ea580c', corridor: '#ea580c', chip: 'bg-orange-600', text: 'text-orange-700 dark:text-orange-300' },
  { id: 'D', line: '#84cc16', corridor: '#65a30d', chip: 'bg-lime-600', text: 'text-lime-700 dark:text-lime-300' },
];

export function routeOptionStyle(index) {
  const i = Number(index) || 0;
  const p = ROUTE_OPTION_PALETTE[i] || {
    id: String.fromCharCode(65 + i),
    line: '#64748b',
    corridor: '#64748b',
    chip: 'bg-slate-500',
    text: 'text-slate-700',
  };
  return { ...p, label: `Route ${p.id}`, letter: p.id };
}

export function polylineMidpoint(polyline) {
  if (!polyline?.length) return null;
  return polyline[Math.floor(polyline.length / 2)];
}
