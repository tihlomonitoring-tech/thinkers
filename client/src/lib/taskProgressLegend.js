/**
 * Task progress legend: user-selected visual stage (muted colours on cards & Profile calendar).
 * Keep in sync with CK_tasks_progress_legend in scripts/task-progress-legend-schema.sql.
 */
export const TASK_PROGRESS_LEGEND_VALUES = [
  'not_started',
  'early',
  'active',
  'on_hold',
  'proposal',
  'near_complete',
  'finalised',
];

export const TASK_PROGRESS_LEGEND_OPTIONS = [
  { value: 'not_started', label: 'Not started', hint: 'Neutral — no work yet' },
  { value: 'early', label: 'Early / slow start', hint: 'Started; limited progress so far' },
  { value: 'active', label: 'In progress', hint: 'Work underway' },
  { value: 'on_hold', label: 'On hold', hint: 'Paused or blocked' },
  { value: 'proposal', label: 'Proposal stage', hint: 'Draft or awaiting sign-off' },
  { value: 'near_complete', label: 'Near completion', hint: 'Mostly done' },
  { value: 'finalised', label: 'Finalised', hint: 'Wrapped up or ready to close' },
];

const LEGEND_KEYS = new Set(TASK_PROGRESS_LEGEND_VALUES);

export function normalizeProgressLegend(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (LEGEND_KEYS.has(s)) return s;
  return 'not_started';
}

/** Left stripe + soft fill for list rows, side panel, board cards (muted). */
export function taskLegendSurfaceClass(legend) {
  const k = normalizeProgressLegend(legend);
  const map = {
    not_started: 'border-l-[3px] border-slate-400/70 bg-slate-50/90',
    early: 'border-l-[3px] border-amber-600/45 bg-amber-50/85',
    active: 'border-l-[3px] border-emerald-700/40 bg-emerald-50/80',
    on_hold: 'border-l-[3px] border-rose-700/38 bg-rose-50/82',
    proposal: 'border-l-[3px] border-violet-700/38 bg-violet-50/82',
    near_complete: 'border-l-[3px] border-orange-700/38 bg-orange-50/82',
    finalised: 'border-l-[3px] border-sky-700/38 bg-sky-50/82',
  };
  return map[k] || map.not_started;
}

/** Small dot on calendar days (muted, not neon). */
export function taskLegendDotClass(legend) {
  const k = normalizeProgressLegend(legend);
  const map = {
    not_started: 'bg-slate-300',
    early: 'bg-amber-500/65',
    active: 'bg-emerald-600/55',
    on_hold: 'bg-rose-500/55',
    proposal: 'bg-violet-500/55',
    near_complete: 'bg-orange-500/55',
    finalised: 'bg-sky-600/50',
  };
  return map[k] || map.not_started;
}

export function taskLegendLabel(legend) {
  const k = normalizeProgressLegend(legend);
  return TASK_PROGRESS_LEGEND_OPTIONS.find((o) => o.value === k)?.label || k;
}
