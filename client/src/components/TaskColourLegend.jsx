import { TASK_PROGRESS_LEGEND_OPTIONS, taskLegendDotClass } from '../lib/taskProgressLegend.js';

export default function TaskColourLegend({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-surface-600 ${className}`}>
      <span className="font-semibold text-surface-500 shrink-0">Task progress colours</span>
      {TASK_PROGRESS_LEGEND_OPTIONS.map((o) => (
        <span key={o.value} className="inline-flex items-center gap-1.5 max-w-[11rem]" title={o.hint}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${taskLegendDotClass(o.value)}`} aria-hidden />
          <span className="truncate">{o.label}</span>
        </span>
      ))}
    </div>
  );
}
