import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import InfoHint from '../InfoHint.jsx';
import AdvancedColumnSearchBar from '../AdvancedColumnSearchBar.jsx';
import { emptyColumnValues, matchesColumnSearch } from '../../lib/advancedColumnSearch.js';
import LogisticsArchivePanel from './LogisticsArchivePanel.jsx';
import LogisticsRouteViewBar from './LogisticsRouteViewBar.jsx';
import LogisticsActivityMapPanel from './LogisticsActivityMapPanel.jsx';
import {
  boardTotals,
  buildRouteSummariesFromBoard,
  filterBoardStages,
  findRouteSummary,
  loadRouteViewPrefs,
  pickNextAlternateRoute,
  saveRouteViewPrefs,
} from '../../lib/logisticsActivityRouteView.js';

const MANUAL_DROP_STAGES = new Set(['scheduled', 'at_loading', 'enroute']);

const ACTIVITY_SEARCH_COLUMNS = [
  { key: 'truck', label: 'Truck', get: (i) => i.truck_registration },
  { key: 'route', label: 'Route', get: (i) => i.route_name },
  { key: 'destination', label: 'Destination', get: (i) => i.destination_name || i.destination_address },
  { key: 'driver', label: 'Driver', get: (i) => i.driver_name },
  { key: 'phone', label: 'Driver phone', get: (i) => i.driver_phone },
  { key: 'contractor', label: 'Contractor', get: (i) => i.contractor_name },
  { key: 'loading_slip', label: 'Loading slip', get: (i) => i.loading_slip_no },
  { key: 'offload_slip', label: 'Offloading slip', get: (i) => i.offloading_slip_no },
  { key: 'stage', label: 'Stage', get: (i) => i.activity_stage },
  { key: 'status', label: 'Status', get: (i) => i.status },
  { key: 'alerts', label: 'Alerts', get: (i) => `${(i.deviation_count || 0) + (i.overspeed_count || 0)}` },
];

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
  awaiting_reschedule: {
    header: 'bg-violet-50/90 dark:bg-violet-950/25 border-b border-violet-200/80 dark:border-violet-900/60',
    title: 'text-violet-900 dark:text-violet-100',
    hint: 'text-violet-800/80 dark:text-violet-300/80',
    count: 'text-violet-900 dark:text-violet-200',
    badge: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100',
    card: 'border-l-violet-500',
  },
};

const inputClass =
  'w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950 focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-shadow';

function ScheduleLoadPanel({
  expanded,
  onToggle,
  trucks,
  routes,
  scheduleReg,
  setScheduleReg,
  scheduleRouteId,
  setScheduleRouteId,
  scheduling,
  onSubmit,
}) {
  if (!expanded) return null;

  const selectedRoute = routes.find((r) => r.id === scheduleRouteId);
  const selectedTruck = trucks.find((t) => t.registration === scheduleReg);

  return (
    <div className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 shadow-sm">
      <h3 className="font-medium text-surface-900 dark:text-surface-100 mb-3">Schedule load</h3>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">
              Truck <span className="text-red-500">*</span>
            </span>
            <select
              value={scheduleReg}
              onChange={(e) => setScheduleReg(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select truck registration</option>
              {trucks.map((t) => (
                <option key={t.id || t.registration} value={t.registration}>
                  {t.registration}{t.contractor_name ? ` · ${t.contractor_name}` : ''}
                </option>
              ))}
            </select>
            {selectedTruck?.make_model && (
              <p className="text-xs text-surface-500 mt-1">{selectedTruck.make_model}{selectedTruck.year_model ? ` · ${selectedTruck.year_model}` : ''}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1">
              Route <span className="text-red-500">*</span>
            </span>
            <select
              value={scheduleRouteId}
              onChange={(e) => setScheduleRouteId(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select route</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {selectedRoute && (selectedRoute.loading_address || selectedRoute.destination_address) && (
              <p className="text-xs text-surface-500 mt-1 truncate" title={`${selectedRoute.loading_address || ''} → ${selectedRoute.destination_address || ''}`}>
                {[selectedRoute.loading_address, selectedRoute.destination_address].filter(Boolean).join(' → ')}
              </p>
            )}
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={scheduling || !scheduleReg.trim() || !scheduleRouteId}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduling ? 'Scheduling…' : 'Confirm schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SlipModal({ title, fields, initial, truckRegistration, onClose, onSave, saving }) {
  const [form, setForm] = useState(initial);
  const [driversLoading, setDriversLoading] = useState(false);
  const [loadedDrivers, setLoadedDrivers] = useState([]);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  useEffect(() => {
    if (!truckRegistration) {
      setLoadedDrivers([]);
      return undefined;
    }
    let cancelled = false;
    setDriversLoading(true);
    trackingApi.contractorDrivers
      .list({ truck_registration: truckRegistration })
      .then((res) => {
        if (!cancelled) setLoadedDrivers(res.drivers || []);
      })
      .catch(() => {
        if (!cancelled) setLoadedDrivers([]);
      })
      .finally(() => {
        if (!cancelled) setDriversLoading(false);
      });
    return () => { cancelled = true; };
  }, [truckRegistration]);

  useEffect(() => {
    if (!loadedDrivers.length || form.driver_id) return;
    const name = String(initial.driver_name || '').trim().toLowerCase();
    if (!name) return;
    const match = loadedDrivers.find((d) => String(d.full_name || '').trim().toLowerCase() === name);
    if (match) {
      setForm((prev) => ({ ...prev, driver_id: match.id, driver_name: match.full_name }));
    }
  }, [loadedDrivers, initial.driver_name, form.driver_id]);

  const linkedDrivers = loadedDrivers.filter((d) => d.linked_to_truck);
  const otherDrivers = loadedDrivers.filter((d) => !d.linked_to_truck);

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
            ) : f.type === 'driver_select' ? (
              <div className="space-y-2">
                <select
                  className={inputClass}
                  value={form.driver_id || ''}
                  disabled={driversLoading}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setForm((prev) => ({ ...prev, driver_id: '', driver_name: prev.driver_name || '' }));
                      return;
                    }
                    if (id === '__manual__') {
                      setForm((prev) => ({ ...prev, driver_id: '__manual__', driver_name: '' }));
                      return;
                    }
                    const picked = loadedDrivers.find((d) => d.id === id);
                    setForm((prev) => ({
                      ...prev,
                      driver_id: id,
                      driver_name: picked?.full_name || '',
                    }));
                  }}
                >
                  <option value="">{driversLoading ? 'Loading drivers…' : 'Select driver'}</option>
                  {linkedDrivers.length > 0 && (
                    <optgroup label={truckRegistration ? `Linked to ${truckRegistration}` : 'Linked drivers'}>
                      {linkedDrivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}{d.phone ? ` · ${d.phone}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherDrivers.length > 0 && (
                    <optgroup label="Other drivers">
                      {otherDrivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                          {d.linked_truck_registration ? ` (${d.linked_truck_registration})` : ''}
                          {d.contractor_name ? ` · ${d.contractor_name}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__manual__">Other — enter name manually</option>
                </select>
                {(form.driver_id === '__manual__' || !form.driver_id) && (
                  <input
                    className={inputClass}
                    type="text"
                    placeholder="Driver name"
                    value={form.driver_name || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, driver_name: e.target.value }))}
                  />
                )}
                {form.driver_id && form.driver_id !== '__manual__' && form.driver_name && (
                  <p className="text-xs text-surface-500">Selected: {form.driver_name}</p>
                )}
              </div>
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

function formatKmNum(km) {
  if (km == null || !Number.isFinite(Number(km))) return null;
  const n = Number(km);
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function resolveRouteTotalKm(item, routes) {
  const direct = item.route_distance_km ?? item.routeDistanceKm;
  if (direct != null && Number.isFinite(Number(direct)) && Number(direct) > 0) {
    return Number(direct);
  }
  const rid = item.contractor_route_id;
  if (rid && routes?.length) {
    const route = routes.find((r) => r.id === rid);
    const km = route?.distance_km ?? route?.distanceKm;
    if (km != null && Number.isFinite(Number(km)) && Number(km) > 0) return Number(km);
  }
  return null;
}

function formatDistanceProgress(item, routes) {
  if (item.activity_stage === 'awaiting_reschedule') return 'Delivered';
  const totalKm = resolveRouteTotalKm(item, routes);
  let leftKm = item.km_remaining ?? item.kmRemaining;
  leftKm = leftKm != null && Number.isFinite(Number(leftKm)) ? Number(leftKm) : null;
  if (leftKm != null && totalKm != null && leftKm > totalKm) leftKm = totalKm;
  const left = formatKmNum(leftKm);
  const total = formatKmNum(totalKm);
  if (left != null && total != null) return `${left}/${total} km`;
  if (left != null) return `${left} km left`;
  if (total != null) return `${total} km`;
  return '—';
}

function formatKmDone(item, routes) {
  if (item.activity_stage !== 'enroute') return null;
  const total = resolveRouteTotalKm(item, routes);
  const left = Number(item.km_remaining ?? item.kmRemaining);
  if (!Number.isFinite(total) || !Number.isFinite(left)) return null;
  return Math.max(0, Math.min(total, total - left));
}

function progressPct(item, routes) {
  const total = resolveRouteTotalKm(item, routes);
  const left = item.km_remaining ?? item.kmRemaining;
  if (!Number.isFinite(total) || total <= 0 || left == null) return null;
  const done = Math.max(0, Math.min(100, ((total - Number(left)) / total) * 100));
  return Math.round(done);
}

function formatEta(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const m = Math.round(Number(minutes));
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `~${h}h ${r}m` : `~${h}h`;
}

function ActivityCard({
  item,
  routes,
  styles,
  onLoadingSlip,
  onProceedWithoutSlip,
  onOffloadingSlip,
  onRedirect,
  onReschedule,
  onCancel,
  onShowOnMap,
  mapActive,
  draggable = false,
  onDragStart,
  onDragEnd,
}) {
  const needsLoading = item.activity_stage === 'at_loading';
  const needsOffload = item.activity_stage === 'at_destination';
  const awaitingNext = item.activity_stage === 'awaiting_reschedule';
  const needsAction = needsLoading || needsOffload || awaitingNext;
  const speed = Number(item.last_speed_kmh);
  const hasSpeed = Number.isFinite(speed);
  const moving = hasSpeed && speed >= 5;
  const pct = progressPct(item, routes);
  const kmDone = formatKmDone(item, routes);
  const alertCount = (item.deviation_count || 0) + (item.overspeed_count || 0);
  const destLabel = item.destination_name || item.destination_address || item.route_name || '—';

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 border-l-4 ${styles.card} shadow-sm transition-all hover:shadow-md ${
        needsAction ? 'ring-1 ring-brand-200/60 dark:ring-brand-800/40' : ''
      } ${mapActive ? 'ring-2 ring-sky-400/80 dark:ring-sky-500/50' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={draggable ? 'Drag to Scheduled, At loading, or En route' : undefined}
    >
      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onShowOnMap?.(item)}
              title="Show this truck on the map"
              className="font-mono font-bold text-base text-left tracking-tight text-brand-700 dark:text-brand-300 hover:underline underline-offset-2 decoration-brand-400/60"
            >
              {item.truck_registration}
            </button>
            <p className="text-[10px] text-surface-500 truncate">{item.route_name}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {hasSpeed && (
              <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${
                moving
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                  : 'bg-slate-100 text-slate-600 dark:bg-surface-800 dark:text-surface-300'
              }`}>
                {Math.round(speed)} km/h
              </span>
            )}
            {(item.is_overdue || alertCount > 0) && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {item.is_overdue ? 'Overdue' : `${alertCount} alert${alertCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-surface-50 dark:bg-surface-950/60 border border-surface-100 dark:border-surface-800 px-2.5 py-2 space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 w-14 shrink-0 pt-0.5">Dest</span>
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 leading-snug line-clamp-2">{destLabel}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-400 shrink-0">Dist</span>
              <span className="text-sm font-bold tabular-nums text-brand-700 dark:text-brand-300">
                {formatDistanceProgress(item, routes)}
              </span>
              {item.eta_minutes != null && item.activity_stage === 'enroute' && (
                <span className="text-[10px] text-surface-500 tabular-nums">{formatEta(item.eta_minutes)}</span>
              )}
            </div>
            {kmDone != null && (
              <span className="text-[10px] text-surface-500 tabular-nums shrink-0">
                {formatKmNum(kmDone)} km done
              </span>
            )}
          </div>
          {pct != null && item.activity_stage === 'enroute' && (
            <div className="pt-0.5">
              <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-surface-500 mt-0.5 tabular-nums">{pct}% of corridor covered</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-surface-800 dark:text-surface-200 truncate">{item.driver_name || 'Driver TBC'}</p>
            {item.driver_phone && (
              <p className="text-[10px] text-surface-500 truncate">{item.driver_phone}</p>
            )}
          </div>
          {item.contractor_name && (
            <span className="text-[10px] text-surface-500 truncate max-w-[40%]">{item.contractor_name}</span>
          )}
        </div>

        {(item.deviation_count > 0 || item.overspeed_count > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {item.deviation_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                ⚠ {item.deviation_count} deviation{item.deviation_count === 1 ? '' : 's'}
              </span>
            )}
            {item.overspeed_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                ⏱ {item.overspeed_count} overspeed
              </span>
            )}
          </div>
        )}

        {item.loading_slip_deferred && (
          <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Slip deferred
          </span>
        )}
        {awaitingNext && item.offloading_slip_no && (
          <p className="text-[10px] text-violet-700 dark:text-violet-300">
            Delivered · slip {item.offloading_slip_no}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {needsLoading && (
            <>
              <button type="button" onClick={() => onLoadingSlip(item)} className="text-[10px] px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 font-medium">
                Loading slip
              </button>
              <button type="button" onClick={() => onProceedWithoutSlip(item)} className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800">
                Proceed · slip later
              </button>
            </>
          )}
          {needsOffload && (
            <button type="button" onClick={() => onOffloadingSlip(item)} className="text-[10px] px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 font-medium">
              Offloading slip
            </button>
          )}
          {awaitingNext && (
            <button type="button" onClick={() => onReschedule(item)} className="text-[10px] px-2.5 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700 font-medium">
              Schedule next load
            </button>
          )}
          {item.activity_stage === 'scheduled' && (
            <button type="button" onClick={() => onCancel(item)} className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800">
              Cancel
            </button>
          )}
          {(item.activity_stage === 'at_destination' || item.activity_stage === 'enroute' || awaitingNext) && (
            <button type="button" onClick={() => onRedirect(item)} className="text-[10px] px-2.5 py-1 rounded-md border border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40">
              {awaitingNext ? 'Redirect route' : 'Redirect'}
            </button>
          )}
        </div>
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
  const [mapTripId, setMapTripId] = useState(null);
  const [geofences, setGeofences] = useState([]);
  const mapPanelRef = useRef(null);
  const [draggingTrip, setDraggingTrip] = useState(null);
  const [boardSearch, setBoardSearch] = useState({
    global: '',
    columns: emptyColumnValues(ACTIVITY_SEARCH_COLUMNS),
    expanded: false,
  });

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

  useEffect(() => {
    trackingApi.geofences.list()
      .then((r) => setGeofences(r.geofences || []))
      .catch(() => setGeofences([]));
  }, []);

  const allBoardItems = useMemo(
    () => (board.stages || []).flatMap((s) => s.items || []),
    [board.stages]
  );

  const mapTrips = useMemo(
    () => allBoardItems.map((item) => ({
      id: item.trip_id,
      truck_registration: item.truck_registration,
      last_lat: item.last_lat,
      last_lng: item.last_lng,
      last_speed_kmh: item.last_speed_kmh,
      last_heading_deg: item.last_heading_deg,
      last_seen_at: item.last_seen_at,
      status: item.status,
      driver_name: item.driver_name,
      contractor_name: item.contractor_name,
      contractor_route_id: item.contractor_route_id,
      collection_point_name: item.loading_address,
      destination_name: item.destination_name,
    })),
    [allBoardItems]
  );

  const selectedMapTrip = useMemo(
    () => allBoardItems.find((item) => item.trip_id === mapTripId) || null,
    [allBoardItems, mapTripId]
  );

  const showTruckOnMap = useCallback((item) => {
    setMapTripId(item.trip_id);
    window.setTimeout(() => {
      mapPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  useEffect(() => {
    if (mapTripId && !allBoardItems.some((item) => item.trip_id === mapTripId)) {
      setMapTripId(null);
    }
  }, [mapTripId, allBoardItems]);

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
      setScheduleRouteId('');
      setScheduleArchived(true);
      persistPrefs({ scheduleArchived: true });
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
    const awaiting = board.stages?.find((s) => s.id === 'awaiting_reschedule')?.count || 0;
    return atLoading + atDest + awaiting;
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

  const moveTripStage = useCallback(async (tripId, targetStage, fromStage) => {
    if (!tripId || !targetStage || fromStage === targetStage) return;
    if (!MANUAL_DROP_STAGES.has(targetStage)) return;
    try {
      await trackingApi.logisticsActivity.moveStage(tripId, {
        activity_stage: targetStage,
        defer_slip: targetStage === 'enroute',
      });
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Could not move truck');
    }
  }, [load, setError]);

  const routeSummaries = useMemo(() => {
    if (board.route_summaries?.length) return board.route_summaries;
    return buildRouteSummariesFromBoard(board.stages, board.routes);
  }, [board.route_summaries, board.stages, board.routes]);

  const filteredStages = useMemo(
    () => filterBoardStages(board.stages, filterRouteId),
    [board.stages, filterRouteId]
  );

  const searchedStages = useMemo(() => {
    const hasSearch = Boolean(
      boardSearch.global.trim() || Object.values(boardSearch.columns).some((v) => String(v || '').trim())
    );
    if (!hasSearch) return filteredStages;
    return filteredStages.map((stage) => {
      const items = (stage.items || []).filter((item) =>
        matchesColumnSearch(item, ACTIVITY_SEARCH_COLUMNS, boardSearch.columns, boardSearch.global)
      );
      return { ...stage, items, count: items.length };
    });
  }, [filteredStages, boardSearch]);

  const filteredTotal = useMemo(() => boardTotals(searchedStages), [searchedStages]);
  const boardTotalBeforeSearch = useMemo(() => boardTotals(filteredStages), [filteredStages]);

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
    <div className="space-y-2">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Logistics Activity</h1>
            <InfoHint
              title="Logistics Activity"
              text={
                <>
                  Schedule loads by route, track geofence arrivals, and capture loading and offloading slips. Click a{' '}
                  <strong>truck registration</strong> to open its live position on the map.{' '}
                  <strong>Drag a truck card</strong> to Scheduled, At loading, or En route if it was not scheduled on time.
                </>
              }
            />
          </div>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {board.total_active || 0} active
            {actionNeeds > 0 && ` · ${actionNeeds} awaiting slip`}
            {filterRouteId !== 'all' && ` · ${focusedRoute?.route_name || 'Route'} (${filteredTotal})`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh GPS'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (scheduleArchived) {
                setScheduleArchived(false);
                persistPrefs({ scheduleArchived: false });
              }
            }}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Schedule load
          </button>
        </div>
      </header>

      <ScheduleLoadPanel
        expanded={!scheduleArchived}
        onToggle={(open) => {
          setScheduleArchived(!open);
          persistPrefs({ scheduleArchived: !open });
        }}
        trucks={trucks}
        routes={board.routes || []}
        scheduleReg={scheduleReg}
        setScheduleReg={setScheduleReg}
        scheduleRouteId={scheduleRouteId}
        setScheduleRouteId={setScheduleRouteId}
        scheduling={scheduling}
        onSubmit={schedule}
      />

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

      <AdvancedColumnSearchBar
        columns={ACTIVITY_SEARCH_COLUMNS}
        columnValues={boardSearch.columns}
        onColumnChange={(key, val) => setBoardSearch((s) => ({ ...s, columns: { ...s.columns, [key]: val } }))}
        globalQuery={boardSearch.global}
        onGlobalQueryChange={(v) => setBoardSearch((s) => ({ ...s, global: v }))}
        expanded={boardSearch.expanded}
        onToggleExpanded={() => setBoardSearch((s) => ({ ...s, expanded: !s.expanded }))}
        onClear={() => setBoardSearch({ global: '', columns: emptyColumnValues(ACTIVITY_SEARCH_COLUMNS), expanded: false })}
        resultCount={filteredTotal}
        totalCount={boardTotalBeforeSearch}
      />

      {mapTripId && selectedMapTrip && (
        <div ref={mapPanelRef}>
          <LogisticsActivityMapPanel
            tripId={mapTripId}
            trip={selectedMapTrip}
            mapTrips={mapTrips}
            routes={board.routes || []}
            geofences={geofences}
            onSelectTrip={setMapTripId}
            onClose={() => setMapTripId(null)}
          />
        </div>
      )}

      <section className="app-glass-panel-2xl overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 shadow-sm">
        <div className="overflow-x-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 min-w-[320px] xl:min-w-[1100px] divide-y md:divide-y-0 md:divide-x divide-surface-200 dark:divide-surface-800">
          {searchedStages.map((stage) => {
            const styles = STAGE_STYLES[stage.id] || STAGE_STYLES.scheduled;
            const acceptsDrop = MANUAL_DROP_STAGES.has(stage.id);
            const isDropTarget = draggingTrip && acceptsDrop && draggingTrip.fromStage !== stage.id;
            return (
              <div
                key={stage.id}
                className={`flex flex-col min-h-[420px] ${isDropTarget ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''}`}
                onDragOver={acceptsDrop ? (e) => { e.preventDefault(); } : undefined}
                onDrop={acceptsDrop ? (e) => {
                  e.preventDefault();
                  if (draggingTrip) {
                    moveTripStage(draggingTrip.tripId, stage.id, draggingTrip.fromStage);
                    setDraggingTrip(null);
                  }
                } : undefined}
              >
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
                <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-surface-50/50 dark:bg-surface-950/30 max-h-[min(78vh,680px)]">
                  {stage.items?.length ? (
                    stage.items.map((item) => (
                      <ActivityCard
                        key={item.trip_id}
                        item={item}
                        routes={board.routes || []}
                        styles={styles}
                        mapActive={mapTripId === item.trip_id}
                        draggable
                        onDragStart={() => setDraggingTrip({ tripId: item.trip_id, fromStage: item.activity_stage })}
                        onDragEnd={() => setDraggingTrip(null)}
                        onShowOnMap={showTruckOnMap}
                        onLoadingSlip={setModal}
                        onProceedWithoutSlip={(it) => submitLoadingSlip(it.trip_id, { driver_name: it.driver_name || '' }, true)}
                        onOffloadingSlip={setModal}
                        onRedirect={(it) => setRedirectTarget({ trip_id: it.trip_id, route_id: '', registration: it.truck_registration })}
                        onReschedule={(it) => {
                          setScheduleReg(it.truck_registration);
                          setScheduleRouteId('');
                          setScheduleArchived(false);
                        }}
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
        </div>
      </section>

      {modal?.activity_stage === 'at_loading' && (
        <SlipModal
          title={`Loading slip — ${modal.truck_registration}`}
          truckRegistration={modal.truck_registration}
          initial={{ loading_slip_no: '', tons_loaded: '', driver_id: '', driver_name: modal.driver_name || '', notes: '' }}
          fields={[
            { key: 'loading_slip_no', label: 'Loading slip number', required: true },
            { key: 'tons_loaded', label: 'Tons loaded', type: 'number', step: '0.001' },
            { key: 'driver_name', label: 'Driver', type: 'driver_select' },
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
            <h3 className="font-semibold text-surface-900 dark:text-surface-100">
              Redirect route{redirectTarget.registration ? ` — ${redirectTarget.registration}` : ''}
            </h3>
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
