import { useState } from 'react';
import { commandCentre as ccApi } from '../api';

const btnClass =
  'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border border-violet-200 text-violet-800 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Grammar / phrasing assist for a single shift report text field (on-demand to save tokens).
 */
export function ShiftReportTextAssist({ value, onApply, fieldLabel, getContext, disabled }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState(null);

  if (disabled) return null;

  const improve = () => {
    const text = String(value || '').trim();
    if (!text) return;
    setLoading(true);
    setError('');
    setSuggestion(null);
    const ctx = typeof getContext === 'function' ? getContext() : null;
    const body =
      ctx && typeof ctx === 'object'
        ? { text, field_label: fieldLabel, context_payload: ctx }
        : { text, field_label: fieldLabel, context_brief: String(ctx || '') };
    ccApi.shiftReportAi
      .improveText(body)
      .then((r) => setSuggestion({ revised: r.revised, tip: r.tip }))
      .catch((e) => setError(e?.message || 'Improvement failed'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mt-1 space-y-1">
      <button type="button" className={btnClass} onClick={improve} disabled={loading || !String(value || '').trim()}>
        <span aria-hidden>✨</span>
        {loading ? 'Improving…' : 'Improve wording'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {suggestion && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-2 text-sm space-y-2">
          <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">Suggested revision</p>
          <p className="whitespace-pre-wrap text-surface-800">{suggestion.revised}</p>
          {suggestion.tip ? <p className="text-xs text-violet-700">{suggestion.tip}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700"
              onClick={() => {
                onApply(suggestion.revised);
                setSuggestion(null);
              }}
            >
              Apply
            </button>
            <button type="button" className="text-xs px-2 py-1 rounded border border-surface-300" onClick={() => setSuggestion(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const summaryBtnClass =
  'inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-violet-300 text-violet-900 bg-violet-50 hover:bg-violet-100 disabled:opacity-50';

export function ShiftReportSummaryAssist({ getContext, onApply, disabled }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (disabled) return null;

  const generate = () => {
    setLoading(true);
    setError('');
    const ctx = typeof getContext === 'function' ? getContext() : null;
    const body =
      ctx && typeof ctx === 'object'
        ? { context_payload: ctx }
        : { context_brief: String(ctx || '') };
    ccApi.shiftReportAi
      .generateSummary(body)
      .then((r) => onApply({ overall_performance: r.overall_performance, key_highlights: r.key_highlights }))
      .catch((e) => setError(e?.message || 'Generation failed'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className={summaryBtnClass} onClick={generate} disabled={loading}>
        <span aria-hidden>✨</span>
        {loading ? 'Generating…' : 'Auto-generate overall performance & key highlights'}
      </button>
      <span className="text-xs text-surface-500">Uses data entered in this report so far</span>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
