import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import LogisticsArchivePanel from './LogisticsArchivePanel.jsx';
import LogisticsRouteViewBar from './LogisticsRouteViewBar.jsx';
import {
  boardTotals,
  buildRouteSummariesFromBoard,
  filterBoardStages,
  findRouteSummary,
  loadRouteViewPrefs,
  pickNextAlternateRoute,
  saveRouteViewPrefs,
} from '../../lib/logisticsActivityRouteView.js';

const STAGE_STYLES = {
  scheduled: {
    header: 'bg-sky-50/90 dark:bg-sky-950/25 border-b border-sky-200/80 dark:border-sky-900/60',
    title: 'text-sky-900 dark:text-sky-100',
    hint: 'text-sky-700/80 dark:text-sky-300/80',
    count: 'text-sky-800 dark:text-sky-200',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
    card: 'border-l-sky-500',
  },
  at_loading: {
    header: 'bg-amber-50/90 dark:bg-amber-950/25 border-b border-amber-200/80 dark:border-amber-900/60',
    title: 'text-amber-900 dark:text-amber-100',
    hint: 'text-amber-800/80 dark:text-amber-300/80',
    count: 'text-amber-900 dark:text-amber-200',
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
    card: 'border-l-amber-500',
  },
  enroute: {
    header: 'bg-emerald-50/90 dark:bg-emerald-950/25 border-b border-emerald-200/80 dark:border-emerald-900/60',
    title: 'text-emerald-900 dark:text-emerald-100',
    hint: 'text-emerald-800/80 dark:text-emerald-300/80',
    count: 'text-emerald-900 dark:text-emerald-200',
    badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
    card: 'border-l-emerald-500',
  },
  at_destination: {
    header: 'bg-brand-50/90 dark:bg-brand-950/30 border-b border-brand-200/80 dark:border-brand-800/60',
    title: 'text-brand-900 dark:text-brand-100',
    hint: 'text-brand-800/80 dark:text-brand-300/80',
    count: 'text-brand-800 dark:text-brand-200',
    badge: 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200',
    card: 'border-l-brand-500',
  },
};

const inputClass =
  'w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400';

function SlipModal({ title, fields, initial, onClose, onSave, saving }) {
  const [form, setForm] = useState(initial);
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-surface-950/50 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
        className="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl p-5 space-y-3"
      >
        <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{title}</h3>
        {fields.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-surface-500 block mb-1">
              {f.label}{f.required ? ' *' : ''}
            </span>
            {f.type === 'textarea' ? (
              <textarea
                className={inputClass}
                rows={3}
                value={form[f.key] || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                className={inputClass}
                type={f.type || 'text'}
                step={f.step}
                value={form[f.key] || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                required={!!f.required}
              />
            )}
          </label>
        ))}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-surface-200 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ActivityCard({ item, styles, onLoadingSlip, onProceedWithoutSlip, onOffloadingSlip, onRedirect, onCancel }) {
  const needsLoading = item.activity_stage === 'at_loading';
  const needsOffload = item.activity_stage === 'at_destination';
  const needsAction = needsLoading || needsOffload;

  return (
    <div
      className={`rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 border-l-4 ${styles.card} p-3 shadow-sm transition-shadow hover:shadow-md ${
        needsAction ? 'ring-1 ring-brand-200/60 dark:ring-brand-800/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono font-bold text-surface-900 dark:text-surface-100 tracking-tight">{item.truck_registration}</p>
        {(item.deviation_count > 0 || item.is_overdue) && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            Alert
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-surface-700 dark:text-surface-300 truncate mt-0.5">{item.route_name}</p>
      <p className="text-[10px] text-surface-500 truncate mt-0.5">
        {item.loading_address && item.destination_address
          ? `${item.loading_address} → ${item.destination_address}`
          : item.destination_address || '—'}
      </p>
      <p className="text-xs text-surface-500 mt-1">{item.driver_name || item.contractor_name || 'Driver TBC'}</p>
      {item.hours_on_route != null && (
        <p className="text-[10px] text-surface-500 mt-1 tabular-nums">{item.hours_on_route}h en route</p>
      )}
      {item.loading_slip_deferred && (
        <span className="inline-block mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Slip deferred
        </span>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {needsLoading && (
          <>
            <button
              type="button"
              onClick={() => onLoadingSlip(item)}
              className="text-[10px] px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 font-medium"
            >
              Loading slip
            </button>
            <button
              type="button"
              onClick={() => onProceedWithoutSlip(item)}
              className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              Proceed · slip later
            </button>
          </>
        )}
        {needsOffload && (
          <button
            type="button"
            onClick={() => onOffloadingSlip(item)}
            className="text-[10px] px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 font-medium"
          >
            Offloading slip
          </button>
        )}
        {item.activity_stage === 'scheduled' && (
          <button
            type="button"
            onClick={() => onCancel(item)}
            className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
          >
            Cancel
          </button>
        )}
        {(item.activity_stage === 'at_destination' || item.activity_stage === 'enroute') && (
          <button
            type="button"
            onClick={() => onRedirect(item)}
            className="text-[10px] px-2.5 py-1 rounded-md border border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
          >
            Redirect
          </button>
        )}
      </div>
    </div>
  );
}

export default function LogisticsActivityTab({ setError }) {
  const [board, setBoard] = useState({ stages: [], routes: [], route_summaries: [], total_active: 0 });
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleReg, setScheduleReg] = useState('');
  const [scheduleRouteId, setScheduleRouteId] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState(null);

  const initialPrefs = useMemo(() => loadRouteViewPrefs(), []);
  const [filterRouteId, setFilterRouteId] = useState(initialPrefs.filterRouteId);
  const [autoAlternate, setAutoAlternate] = useState(initialPrefs.autoAlternate);
  const [alternateMode, setAlternateMode] = useState(initialPrefs.alternateMode);
  const [intervalSec, setIntervalSec] = useState(initialPrefs.intervalSec);
  const [scheduleArchived, setScheduleArchived] = useState(initialPrefs.scheduleArchived !== false);
  const [routeViewArchived, setRouteViewArchived] = useState(initialPrefs.routeViewArchived !== false);
  const [autoPaused, setAutoPaused] = useState(false);
  const alternateTimerRef = useRef(null);

  const persistPrefs = useCallback(
    (patch) => {
      saveRouteViewPrefs({
        filterRouteId,
        autoAlternate,
        alternateMode,
        intervalSec,
        scheduleArchived,
        routeViewArchived,
        ...patch,
      });
    },
    [filterRouteId, autoAlternate, alternateMode, intervalSec, scheduleArchived, routeViewArchived]
  );

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    setError('');
    try {
      const [b, t] = await Promise.all([
        trackingApi.logisticsActivity.board(),
        trackingApi.contractorTrucks.list().catch(() => ({ trucks: [] })),
      ]);
      setBoard(b);
      setTrucks(t.trucks || []);
    } catch (e) {
      setError(e?.message || 'Failed to load logistics activity');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(id);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await trackingApi.poll.run().catch(() => ({}));
      await trackingApi.monitor.processPositions().catch(() => ({}));
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Refresh failed');
      setRefreshing(false);
    }
  };

  const schedule = async (e) => {
    e.preventDefault();
    if (!scheduleReg.trim() || !scheduleRouteId) return setError('Select truck and route');
    setScheduling(true);
    try {
      const truck = trucks.find((t) => t.registration === scheduleReg);
      await trackingApi.logisticsActivity.schedule({
        truck_registration: scheduleReg.trim(),
        contractor_truck_id: truck?.id,
        contractor_route_id: scheduleRouteId,
      });
      setScheduleReg('');
      await load({ silent: true });
    } catch (err) {
      setError(err?.message || 'Schedule failed');
    } finally {
      setScheduling(false);
    }
  };

  const actionNeeds = useMemo(() => {
    const atLoading = board.stages?.find((s) => s.id === 'at_loading')?.count || 0;
    const atDest = board.stages?.find((s) => s.id === 'at_destination')?.count || 0;
    return atLoading + atDest;
  }, [board.stages]);

  const submitLoadingSlip = async (tripId, form, defer = false) => {
    setSaving(true);
    try {
      await trackingApi.logisticsActivity.saveLoadingSlip(tripId, {
        loading_slip_no: form.loading_slip_no,
        tons_loaded: form.tons_loaded !== '' && form.tons_loaded != null ? Number(form.tons_loaded) : null,
        driver_name: form.driver_name,
        notes: form.notes,
        defer_slip: defer,
      });
      setModal(null);
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadingSave = (form, defer = false) => {
    if (!modal) return;
    return submitLoadingSlip(modal.trip_id, form, defer);
  };

  const routeSummaries = useMemo(() => {
    if (board.route_summaries?.length) return board.route_summaries;
    return buildRouteSummariesFromBoard(board.stages, board.routes);
  }, [board.route_summaries, board.stages, board.routes]);

  const filteredStages = useMemo(
    () => filterBoardStages(board.stages, filterRouteId),
    [board.stages, filterRouteId]
  );

  const filteredTotal = useMemo(() => boardTotals(filteredStages), [filteredStages]);

  const handleFilterRoute = useCallback((routeId) => {
    setFilterRouteId(routeId);
    if (autoAlternate) setAutoPaused(true);
    persistPrefs({ filterRouteId: routeId });
  }, [autoAlternate, persistPrefs]);

  const handleResumeAuto = useCallback(() => {
    setAutoPaused(false);
    const next = pickNextAlternateRoute(routeSummaries, filterRouteId === 'all' ? null : filterRouteId, alternateMode);
    if (next) setFilterRouteId(next);
  }, [routeSummaries, filterRouteId, alternateMode]);

  // Pick first route when auto-alternate starts while still on "all"
  useEffect(() => {
    if (!autoAlternate || autoPaused || filterRouteId !== 'all') return;
    const active = routeSummaries.filter((s) => s.total > 0);
    if (!active.length) return;
    const first = pickNextAlternateRoute(active, null, alternateMode);
    if (first) setFilterRouteId(first);
  }, [autoAlternate, autoPaused, filterRouteId, routeSummaries, alternateMode]);

  // Auto-alternate rotation timer (stable — does not reset when route changes)
  useEffect(() => {
    if (!autoAlternate || autoPaused) {
      if (alternateTimerRef.current) clearInterval(alternateTimerRef.current);
      return undefined;
    }
    const active = routeSummaries.filter((s) => s.total > 0);
    if (!active.length) return undefined;

    alternateTimerRef.current = setInterval(() => {
      setFilterRouteId((current) => {
        const next = pickNextAlternateRoute(routeSummaries, current === 'all' ? null : current, alternateMode);
        return next || current;
      });
    }, intervalSec * 1000);

    return () => {
      if (alternateTimerRef.current) clearInterval(alternateTimerRef.current);
    };
  }, [autoAlternate, autoPaused, alternateMode, intervalSec, routeSummaries]);

  const focusedRoute = useMemo(
    () => (filterRouteId !== 'all' ? findRouteSummary(routeSummaries, filterRouteId) : null),
    [routeSummaries, filterRouteId]
  );

  if (loading && !board.stages?.length) {
    return <p className="text-sm text-surface-500 py-12">Loading logistics activity…</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Logistics Activity</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5 max-w-3xl">
            Schedule loads by route, track geofence arrivals, and capture loading and offloading slips.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              {board.total_active || 0} active
            </span>
            {actionNeeds > 0 && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                {actionNeeds} awaiting slip or driver details
              </span>
            )}
            {filterRouteId !== 'all' && (
              <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
                Viewing: {focusedRoute?.route_name || 'Route'} · {filteredTotal} truck{filteredTotal === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh GPS'}
        </button>
      </header>

      <LogisticsArchivePanel
        title="Schedule truck to load"
        hint="Pick a truck and route to add it to the scheduled lane."
        archived={scheduleArchived}
        onToggleArchived={(v) => {
          setScheduleArchived(v);
          persistPrefs({ scheduleArchived: v });
        }}
        summary="Hidden — expand to schedule a new load"
        className="border border-brand-100 dark:border-brand-900/40 bg-brand-50/20 dark:bg-brand-950/10"
        contentClassName="px-4 pb-4"
      >
        <form onSubmit={schedule} className="flex flex-wrap gap-3 items-end">
          <label className="text-sm min-w-[180px] flex-1">
            <span className="text-xs text-surface-500 block mb-1">Truck</span>
            <select value={scheduleReg} onChange={(e) => setScheduleReg(e.target.value)} className={inputClass} required>
              <option value="">Select truck</option>
              {trucks.map((t) => (
                <option key={t.id || t.registration} value={t.registration}>
                  {t.registration}{t.contractor_name ? ` · ${t.contractor_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm min-w-[220px] flex-1">
            <span className="text-xs text-surface-500 block mb-1">Route</span>
            <select value={scheduleRouteId} onChange={(e) => setScheduleRouteId(e.target.value)} className={inputClass} required>
              <option value="">Select route</option>
              {(board.routes || []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={scheduling}
            className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50 shadow-sm"
          >
            {scheduling ? 'Scheduling…' : 'Schedule load'}
          </button>
        </form>
      </LogisticsArchivePanel>

      <LogisticsRouteViewBar
        routeSummaries={routeSummaries}
        filterRouteId={filterRouteId}
        onFilterRouteId={handleFilterRoute}
        autoAlternate={autoAlternate}
        onAutoAlternate={(v) => {
          setAutoAlternate(v);
          if (v) {
            setAutoPaused(false);
            const first = pickNextAlternateRoute(routeSummaries, null, alternateMode);
            if (first) setFilterRouteId(first);
          } else {
            setFilterRouteId('all');
          }
          persistPrefs({ filterRouteId: v ? filterRouteId : 'all', autoAlternate: v });
        }}
        alternateMode={alternateMode}
        onAlternateMode={(v) => {
          setAlternateMode(v);
          persistPrefs({ alternateMode: v });
        }}
        intervalSec={intervalSec}
        onIntervalSec={(v) => {
          setIntervalSec(v);
          persistPrefs({ intervalSec: v });
        }}
        autoPaused={autoPaused}
        onResumeAuto={handleResumeAuto}
        archived={routeViewArchived}
        onToggleArchived={(v) => {
          setRouteViewArchived(v);
          persistPrefs({ routeViewArchived: v });
        }}
        persistPrefs={persistPrefs}
      />

      <section className="app-glass-panel-2xl overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 min-w-0 divide-y md:divide-y-0 md:divide-x divide-surface-200 dark:divide-surface-800">
          {filteredStages.map((stage) => {
            const styles = STAGE_STYLES[stage.id] || STAGE_STYLES.scheduled;
            return (
              <div key={stage.id} className="flex flex-col min-h-[360px]">
                <div className={`px-3 py-3 ${styles.header}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${styles.title}`}>{stage.label}</p>
                      <p className={`text-[10px] mt-0.5 leading-snug ${styles.hint}`}>{stage.hint}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-bold tabular-nums px-2 py-0.5 rounded-full ${styles.badge}`}>
                      {stage.count}
                    </span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-surface-50/50 dark:bg-surface-950/30 max-h-[min(60vh,520px)]">
                  {stage.items?.length ? (
                    stage.items.map((item) => (
                      <ActivityCard
                        key={item.trip_id}
                        item={item}
                        styles={styles}
                        onLoadingSlip={setModal}
                        onProceedWithoutSlip={(it) => submitLoadingSlip(it.trip_id, { driver_name: it.driver_name || '' }, true)}
                        onOffloadingSlip={setModal}
                        onRedirect={(it) => setRedirectTarget({ trip_id: it.trip_id, route_id: '' })}
                        onCancel={async (it) => {
                          if (!window.confirm(`Cancel scheduled load for ${it.truck_registration}?`)) return;
                          await trackingApi.logisticsActivity.cancel(it.trip_id);
                          await load({ silent: true });
                        }}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-surface-400 text-center py-12 px-2">
                      {filterRouteId !== 'all' ? 'No trucks on this route in this stage' : 'No trucks in this stage'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {modal?.activity_stage === 'at_loading' && (
        <SlipModal
          title={`Loading slip — ${modal.truck_registration}`}
          initial={{ loading_slip_no: '', tons_loaded: '', driver_name: modal.driver_name || '', notes: '' }}
          fields={[
            { key: 'loading_slip_no', label: 'Loading slip number', required: true },
            { key: 'tons_loaded', label: 'Tons loaded', type: 'number', step: '0.001' },
            { key: 'driver_name', label: 'Driver name' },
            { key: 'notes', label: 'Remarks', type: 'textarea' },
          ]}
          onClose={() => setModal(null)}
          onSave={(form) => handleLoadingSave(form, false)}
          saving={saving}
        />
      )}

      {modal?.activity_stage === 'at_destination' && (
        <SlipModal
          title={`Offloading slip — ${modal.truck_registration}`}
          initial={{ offloading_slip_no: '', delivery_note_no: '', tons_loaded: modal.tons_loaded ?? '', notes: '' }}
          fields={[
            { key: 'offloading_slip_no', label: 'Offloading slip number', required: true },
            { key: 'delivery_note_no', label: 'Delivery note number' },
            { key: 'tons_loaded', label: 'Tons delivered', type: 'number', step: '0.001' },
            { key: 'notes', label: 'Remarks', type: 'textarea' },
          ]}
          onClose={() => setModal(null)}
          onSave={async (form) => {
            setSaving(true);
            try {
              await trackingApi.logisticsActivity.saveOffloadingSlip(modal.trip_id, form);
              setModal(null);
              await load({ silent: true });
            } catch (e) {
              setError(e?.message || 'Save failed');
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
        />
      )}

      {redirectTarget && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-surface-950/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-5 space-y-3 shadow-xl">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100">Redirect route</h3>
            <p className="text-xs text-surface-500">Completes this delivery and schedules the truck on a new route.</p>
            <select
              value={redirectTarget.route_id}
              onChange={(e) => setRedirectTarget((p) => ({ ...p, route_id: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select route</option>
              {(board.routes || []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setRedirectTarget(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-surface-200 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!redirectTarget.route_id || saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await trackingApi.logisticsActivity.redirect(redirectTarget.trip_id, {
                      contractor_route_id: redirectTarget.route_id,
                    });
                    setRedirectTarget(null);
                    await load({ silent: true });
                  } catch (e) {
                    setError(e?.message || 'Redirect failed');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Redirecting…' : 'Redirect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
