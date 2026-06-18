import { useEffect, useMemo, useState } from 'react';
import { formatShiftReportRef } from '../lib/shiftReportPdf.js';

const inputClass =
  'w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100';

export default function LogisticsShiftReportLinkModal({
  open,
  onClose,
  onLinked,
  logisticsApi,
  payload,
  routeLabel,
}) {
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [form, setForm] = useState({ time: '', summary: '', delays: '' });
  const [aiUsed, setAiUsed] = useState(false);
  const [reviewNotes, setReviewNotes] = useState([]);

  const reportKey = (d) => `${d.report_kind || 'shift'}-${d.id}`;

  const selectedReport = useMemo(
    () => drafts.find((d) => reportKey(d) === selectedReportKey),
    [drafts, selectedReportKey]
  );

  useEffect(() => {
    if (!open) {
      setDrafts([]);
      setSelectedReportKey('');
      setForm({ time: '', summary: '', delays: '' });
      setReviewNotes([]);
      setAiUsed(false);
      setError('');
      return;
    }
    if (!payload || !logisticsApi?.shiftReportDrafts) return;
    setLoadingDrafts(true);
    setError('');
    logisticsApi
      .shiftReportDrafts({ route_label: routeLabel })
      .then((r) => {
        const list = r.reports || [];
        setDrafts(list);
        if (list.length) setSelectedReportKey(reportKey(list[0]));
      })
      .catch((e) => {
        setDrafts([]);
        setError(e?.message || 'Could not load draft shift reports');
      })
      .finally(() => setLoadingDrafts(false));
  }, [open, payload, logisticsApi, routeLabel]);

  useEffect(() => {
    if (!open || !payload || !logisticsApi?.composeShiftReportEntry || loadingDrafts) return;
    setComposing(true);
    setError('');
    const previous = selectedReport?.truck_updates || [];
    logisticsApi
      .composeShiftReportEntry({
        rows: payload.rows,
        route_label: routeLabel,
        route_analysis: payload.routeAnalysis,
        parse_warnings: payload.parseWarnings,
        whatsapp_export: payload.whatsappExport || '',
        previous_truck_updates: previous,
        useAi: true,
      })
      .then((r) => {
        const entry = r.entry || {};
        setForm({
          time: entry.time || '',
          summary: entry.summary || '',
          delays: entry.delays || '',
        });
        setAiUsed(!!entry.aiUsed);
        setReviewNotes(entry.reviewNotes || []);
      })
      .catch((e) => setError(e?.message || 'Could not compose shift report entry'))
      .finally(() => setComposing(false));
  }, [
    open,
    payload,
    logisticsApi,
    routeLabel,
    loadingDrafts,
    selectedReportKey,
    selectedReport?.truck_updates?.length,
  ]);

  const regenerateDelays = () => {
    if (!payload || !logisticsApi?.composeShiftReportEntry) return;
    setComposing(true);
    logisticsApi
      .composeShiftReportEntry({
        rows: payload.rows,
        route_label: routeLabel,
        route_analysis: payload.routeAnalysis,
        parse_warnings: payload.parseWarnings,
        previous_truck_updates: selectedReport?.truck_updates || [],
        useAi: true,
      })
      .then((r) => {
        setForm((f) => ({
          ...f,
          summary: r.entry?.summary || f.summary,
          delays: r.entry?.delays || f.delays,
          time: r.entry?.time || f.time,
        }));
        setAiUsed(!!r.entry?.aiUsed);
        setReviewNotes(r.entry?.reviewNotes || []);
      })
      .catch((e) => setError(e?.message || 'Regenerate failed'))
      .finally(() => setComposing(false));
  };

  const handleLink = async () => {
    if (!selectedReport || !payload?.shiftId || !payload?.updateId) return;
    if (!form.summary?.trim()) {
      setError('Summary is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await logisticsApi.linkShiftReport(payload.shiftId, payload.updateId, {
        report_id: selectedReport.id,
        report_kind: selectedReport.report_kind || 'shift',
        entry: {
          time: form.time,
          summary: form.summary.trim(),
          delays: form.delays?.trim() || 'No delays',
        },
      });
      onLinked?.(result);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not link to shift report');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !payload) return null;

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-surface-950/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl">
        <div className="p-5 border-b border-surface-200 dark:border-surface-700">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
            Link update to shift report
          </h2>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
            WhatsApp export is saved. Choose your draft shift report (by ref number) — this update will auto-populate the{' '}
            <span className="font-medium">Truck updates &amp; logistics flow</span> section.
          </p>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {loadingDrafts ? (
            <p className="text-sm text-surface-500">Loading your draft shift reports…</p>
          ) : drafts.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium">No editable draft shift report found</p>
              <p className="mt-1 text-amber-800 dark:text-amber-200">
                Start a draft shift report in Command Centre first (Shift reports tab), then accept your logistics update again to link it.
              </p>
            </div>
          ) : (
            <>
              <label className="block text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-surface-500">
                  Shift report ref *
                </span>
                <select
                  className={`${inputClass} mt-1`}
                  value={selectedReportKey}
                  onChange={(e) => setSelectedReportKey(e.target.value)}
                >
                  {drafts.map((d) => (
                    <option key={reportKey(d)} value={reportKey(d)}>
                      Ref {formatShiftReportRef(d.ref_number, { isSingleOps: d.report_kind === 'single_ops' }) || '—'}
                      {' · '}
                      {d.route_display || d.route || 'Route TBC'}
                      {' · '}
                      {(d.status || 'draft').replace(/_/g, ' ')}
                      {d.relevance_score >= 40 ? ' · best match' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-surface-500 mt-1">
                  Suggested report is the best route/date match among your draft, provisional, or rejected reports.
                </p>
              </label>

              {reviewNotes.length > 0 && (
                <div className="rounded-lg border border-violet-200 bg-violet-50/60 dark:bg-violet-950/30 px-3 py-2">
                  <p className="text-xs font-semibold text-violet-900 dark:text-violet-200 uppercase tracking-wide">
                    Review context used for delays
                  </p>
                  <ul className="mt-1.5 text-xs text-violet-900/90 dark:text-violet-100 space-y-0.5 max-h-24 overflow-y-auto">
                    {reviewNotes.slice(0, 12).map((n, i) => (
                      <li key={i}>• {typeof n === 'string' ? n : n.text}</li>
                    ))}
                  </ul>
                </div>
              )}

              {composing ? (
                <p className="text-sm text-surface-500">Composing summary and AI delays insight…</p>
              ) : (
                <div className="space-y-3">
                  <label className="block text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Time</span>
                    <input
                      className={`${inputClass} mt-1`}
                      value={form.time}
                      onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                      placeholder="HH:MM"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Summary</span>
                    <textarea
                      className={`${inputClass} mt-1`}
                      rows={3}
                      value={form.summary}
                      onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-surface-500 flex items-center gap-2">
                      Delays
                      {aiUsed && (
                        <span className="text-[10px] font-normal normal-case px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                          AI insight
                        </span>
                      )}
                    </span>
                    <textarea
                      className={`${inputClass} mt-1`}
                      rows={3}
                      value={form.delays}
                      onChange={(e) => setForm((f) => ({ ...f, delays: e.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={regenerateDelays}
                    disabled={composing}
                    className="text-xs text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    Regenerate summary &amp; delays with AI
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-surface-200 dark:border-surface-700 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600"
          >
            {drafts.length ? 'Skip for now' : 'Close'}
          </button>
          {drafts.length > 0 && (
            <button
              type="button"
              disabled={saving || composing || !selectedReport}
              onClick={handleLink}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save to shift report'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
