export const SCORE_CATEGORIES = [
  'punctuality',
  'evaluation',
  'tasks',
  'reportTiming',
  'teamProgress',
  'dailyPulse',
];

export const CAT_LABELS = {
  punctuality: 'Clock-in punctuality',
  evaluation: 'Telematics specialist evaluations',
  tasks: 'Tasks (on time vs overdue)',
  reportTiming: 'Shift report hand-in timing',
  teamProgress: 'Team progress (objectives & ratings)',
  dailyPulse: 'Daily pulse (team leaders)',
};

export const CAT_LABELS_SHORT = {
  punctuality: 'Clock-in',
  evaluation: 'Evaluations',
  tasks: 'Tasks',
  reportTiming: 'Report timing',
  teamProgress: 'Team progress',
  dailyPulse: 'Daily pulse',
};

function fmtDate(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function fmtDateTime(v) {
  if (!v) return '';
  try {
    return new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(v);
  }
}

/** Human-readable line for a scoring event in management breakdown views. */
export function describeScoreEvent(ev, category) {
  if (!ev) return '—';
  const d = ev.detail || '';
  const pts = ev.points != null ? `${ev.points > 0 ? '+' : ''}${ev.points} pts` : '';

  switch (category) {
    case 'punctuality':
      if (d === 'on_time') return `${pts} · On-time clock-in · ${ev.shift_type || 'shift'} · ${fmtDate(ev.work_date)}${ev.at ? ` · ${fmtDateTime(ev.at)}` : ''}`;
      if (d === 'late') return `${pts} · Late clock-in (after grace) · ${ev.shift_type || 'shift'} · ${fmtDate(ev.work_date)}${ev.at ? ` · ${fmtDateTime(ev.at)}` : ''}`;
      return `${pts} · ${d || 'Clock-in'} · ${fmtDate(ev.work_date)}`;
    case 'evaluation':
      if (d === 'strong') return `${pts} · Strong evaluation (${ev.yes ?? '?'}/${ev.total ?? '?'} Yes) · report ${String(ev.report_id || '').slice(0, 8)}…${ev.report_kind && ev.report_kind !== 'standard' ? ` · ${ev.report_kind}` : ''}`;
      if (d === 'needs_improvement') return `${pts} · Below threshold (${ev.yes ?? '?'}/${ev.total ?? '?'} Yes) · report ${String(ev.report_id || '').slice(0, 8)}…`;
      return `${pts} · ${d}${ev.at ? ` · ${fmtDateTime(ev.at)}` : ''}`;
    case 'tasks':
      if (d === 'on_time') return `${pts} · Task completed on/before due · due ${fmtDate(ev.due_date)}`;
      if (d === 'completed_late') return `${pts} · Task completed after due date · due ${fmtDate(ev.due_date)}`;
      if (d === 'overdue_open') return `${pts} · Task still open past due · due ${fmtDate(ev.due_date)}`;
      if (d === 'completed_no_due') return `${pts} · Task completed (no due date)`;
      return `${pts} · ${d} · ${fmtDate(ev.due_date)}`;
    case 'reportTiming':
      if (d === 'on_time') return `${pts} · Report submitted on time${ev.report_kind && ev.report_kind !== 'standard' ? ` · ${ev.report_kind}` : ''}${ev.submitted_at ? ` · ${fmtDateTime(ev.submitted_at)}` : ''}`;
      if (d === 'late') return `${pts} · Report submitted late${ev.report_kind && ev.report_kind !== 'standard' ? ` · ${ev.report_kind}` : ''}${ev.submitted_at ? ` · ${fmtDateTime(ev.submitted_at)}` : ''}`;
      return `${pts} · ${d}`;
    case 'teamProgress':
      if (d === 'objective_achieved') return `${pts} · Objective achieved · ${ev.title || 'Team objective'}`;
      if (d === 'management_rating') return `${pts} · Management rating ${ev.rating}/5 · ${ev.period || 'period'}${ev.work_date ? ` · ${fmtDate(ev.work_date)}` : ''}${ev.narrative ? ` · “${ev.narrative}”` : ''}`;
      return `${pts} · ${d}${ev.title ? ` · ${ev.title}` : ''}`;
    case 'dailyPulse':
      if (d === 'pulse_on_time') return `${pts} · Daily pulse on time · ${ev.shift_type} · ${fmtDate(ev.work_date)}`;
      if (d === 'pulse_missed') return `${pts} · Daily pulse missed (after deadline) · ${ev.shift_type} · ${fmtDate(ev.work_date)}`;
      if (d === 'pending') return `${pts} · Daily pulse pending · ${fmtDate(ev.work_date)}`;
      return `${pts} · ${d} · ${fmtDate(ev.work_date)}`;
    default:
      return `${pts} · ${d}`;
  }
}

export function ScoringRulesPanel({ scoring }) {
  const sc = scoring || {};
  return (
    <div className="rounded-xl border border-surface-200 bg-surface-50/80 p-4 text-xs text-surface-600 space-y-2">
      <p className="font-semibold text-surface-800">Point rules (this period)</p>
      <ul className="list-disc ml-4 space-y-1">
        <li>
          Punctuality: {sc.punctuality?.onTime ?? 15} on time, {sc.punctuality?.late ?? -15} late (after {sc.punctuality?.graceMinutes ?? 5} min grace).
        </li>
        <li>
          Evaluation: {sc.evaluation?.good ?? 20} if ≥ {sc.evaluation?.minYesOf || '9/11'} Yes; otherwise {sc.evaluation?.bad ?? -20}.
        </li>
        <li>
          Tasks: {sc.tasks?.onTime ?? 30} completed on/before due; {sc.tasks?.lateOrOverdue ?? -30} late or still overdue.
        </li>
        <li>
          Report hand-in: {sc.reportHandIn?.onTime ?? 50} by {sc.reportHandIn?.by || 'shift end + 15 min'}; {sc.reportHandIn?.late ?? -50} otherwise.
        </li>
        <li>
          Team progress: +{sc.teamProgress?.objectiveAchieved ?? 15} per achieved objective; management ratings (rating − {sc.teamProgress?.ratingNeutral ?? 3}) × {sc.teamProgress?.ratingMultiplier ?? 5}.
        </li>
        <li>
          Daily pulse: +{sc.dailyPulse?.onTime ?? 10} within {sc.dailyPulse?.withinHoursAfterShiftEnd ?? 12}h after shift end; {sc.dailyPulse?.missed ?? -30} if missed.
        </li>
      </ul>
    </div>
  );
}
