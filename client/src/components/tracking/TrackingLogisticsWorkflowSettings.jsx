import { useEffect, useState } from 'react';
import { tracking as trackingApi } from '../../api';

const MODES = [
  {
    value: true,
    title: 'Require offloading slip',
    subtitle: 'Manual capture at destination',
    description:
      'Drivers or dispatch must enter an offloading slip while the truck is at the destination geofence. The trip moves to Awaiting reschedule only after the slip is saved.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    accent: 'border-brand-500 bg-brand-50/80 ring-brand-500/30',
    iconWrap: 'bg-brand-100 text-brand-700',
    badge: 'Default',
  },
  {
    value: false,
    title: 'Auto-complete on geofence exit',
    subtitle: 'No offloading slip required',
    description:
      'When the truck leaves the destination geofence, the delivery is marked complete automatically and the trip moves to Awaiting reschedule — no slip entry needed.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
    accent: 'border-emerald-500 bg-emerald-50/80 ring-emerald-500/30',
    iconWrap: 'bg-emerald-100 text-emerald-700',
    badge: 'Hands-free',
  },
];

export default function TrackingLogisticsWorkflowSettings({ setError }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requireSlip, setRequireSlip] = useState(true);

  useEffect(() => {
    setLoading(true);
    trackingApi.settings
      .get()
      .then((res) => {
        const s = res.settings || {};
        setRequireSlip(s.require_offloading_slip_at_destination !== false);
      })
      .catch((err) => {
        setError?.(err?.message || 'Failed to load logistics workflow settings');
        setRequireSlip(true);
      })
      .finally(() => setLoading(false));
  }, [setError]);

  const selectMode = (nextRequireSlip) => {
    if (nextRequireSlip === requireSlip || saving) return;
    const prev = requireSlip;
    setRequireSlip(nextRequireSlip);
    setSaving(true);
    trackingApi.settings
      .update({ require_offloading_slip_at_destination: nextRequireSlip })
      .catch((err) => {
        setError?.(err?.message || 'Failed to save workflow setting');
        setRequireSlip(prev);
      })
      .finally(() => setSaving(false));
  };

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-violet-50/60 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Destination delivery workflow</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Control whether operators must capture an offloading slip at destination, or whether deliveries
              complete automatically when the truck exits the destination geofence.
            </p>
          </div>
          {!loading && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              requireSlip
                ? 'bg-brand-100 text-brand-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${requireSlip ? 'bg-brand-500' : 'bg-emerald-500'}`} />
              {requireSlip ? 'Slip required' : 'Auto-complete active'}
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading workflow settings…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {MODES.map((mode) => {
              const selected = requireSlip === mode.value;
              return (
                <button
                  key={String(mode.value)}
                  type="button"
                  disabled={saving}
                  onClick={() => selectMode(mode.value)}
                  className={`group relative flex h-full flex-col rounded-xl border-2 p-4 text-left transition-all ${
                    selected
                      ? `${mode.accent} ring-2 shadow-md`
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  } ${saving ? 'opacity-70' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${mode.iconWrap}`}>
                      {mode.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{mode.title}</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {mode.badge}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">{mode.subtitle}</p>
                    </div>
                    <span
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                        selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white group-hover:border-slate-400'
                      }`}
                      aria-hidden
                    >
                      {selected && (
                        <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10.28 3.22a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-2-2a.75.75 0 111.06-1.06L5.25 7.19l3.97-3.97a.75.75 0 011.06 0z" />
                        </svg>
                      )}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-slate-600">{mode.description}</p>
                  {selected && !mode.value && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2 text-[11px] font-medium text-emerald-800">
                      <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Completed deliveries show a green check on the activity board.
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {saving && <p className="mt-3 text-xs text-slate-500">Saving…</p>}
      </div>
    </section>
  );
}
