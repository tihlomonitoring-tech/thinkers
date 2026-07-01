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

const ALL_BOARD_STAGES = new Set(['scheduled', 'at_loading', 'enroute', 'at_destination', 'awaiting_reschedule']);

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

function normalizeLoadingSlipForm(form) {
  const slip = String(form?.loading_slip_no || '').trim();
  return {
    ...form,
    loading_slip_no: slip,
    driver_name: form?.driver_name != null ? String(form.driver_name).trim() : form?.driver_name,
    notes: form?.notes != null ? String(form.notes).trim() : form?.notes,
    tons_loaded: form?.tons_loaded !== '' && form?.tons_loaded != null ? Number(form.tons_loaded) : null,
  };
}

function shouldUpdateLoadingSlip(modal) {
  if (!modal) return false;
  if (modal.edit_loading_slip) return true;
  const stage = String(modal.activity_stage || '').toLowerCase();
  return stage !== 'at_loading' && stage !== 'scheduled';
}

function SlipModal({ title, fields, initial, truckRegistration, resetKey, onClose, onSave, saving, submitLabel = 'Save' }) {
  const [form, setForm] = useState(initial);
  const [driversLoading, setDriversLoading] = useState(false);
  const [loadedDrivers, setLoadedDrivers] = useState([]);
  const [driversError, setDriversError] = useState('');
  const [saveError, setSaveError] = useState('');
  const submitLockRef = useRef(false);

  useEffect(() => {
    setForm(initial);
    setSaveError('');
  }, [resetKey]);

  useEffect(() => {
    if (!truckRegistration) {
      setLoadedDrivers([]);
      return undefined;
    }
    let cancelled = false;
    setDriversLoading(true);
    setDriversError('');
    trackingApi.contractorDrivers
      .list({ truck_registration: truckRegistration })
      .then((res) => {
        if (!cancelled) setLoadedDrivers(res.drivers || []);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadedDrivers([]);
          setDriversError(e?.message || 'Could not load drivers');
        }
      })
      .finally(() => {
        if (!cancelled) setDriversLoading(false);
      });
    return () => { cancelled = true; };
  }, [truckRegistration]);

  useEffect(() => {
    if (!loadedDrivers.length) return;
    setForm((prev) => {
      if (prev.driver_id) return prev;
      const name = String(initial.driver_name || prev.driver_name || '').trim().toLowerCase();
      if (!name) return prev;
      const match = loadedDrivers.find((d) => String(d.full_name || '').trim().toLowerCase() === name);
      if (!match) return prev;
      return { ...prev, driver_id: match.id, driver_name: match.full_name };
    });
  }, [loadedDrivers, resetKey, initial.driver_name]);

  const linkedDrivers = loadedDrivers.filter((d) => d.linked_to_truck);
  const otherDrivers = loadedDrivers.filter((d) => !d.linked_to_truck);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-surface-950/50 backdrop-blur-sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitLockRef.current || saving) return;
          const normalized = normalizeLoadingSlipForm(form);
          const slipRequired = fields.some((f) => f.key === 'loading_slip_no' && f.required);
          if (slipRequired && !normalized.loading_slip_no) {
            setSaveError('Loading slip number is required');
            return;
          }
          submitLockRef.current = true;
          setSaveError('');
          try {
            await onSave(normalized);
          } catch (err) {
            setSaveError(err?.message || 'Save failed');
          } finally {
            submitLockRef.current = false;
          }
        }}
        className="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-xl p-5 space-y-3"
      >
        <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{title}</h3>
        {saveError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {saveError}
          </p>
        )}
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
                    const picked = loadedDrivers.find((d) => String(d.id) === String(id));
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
                {driversError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{driversError}</p>
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
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatKmNum(km) {
  if (km == null || !Number.isFinite(Number(km))) return null;
  const n = Number(km);
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(2);
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

function distanceBasisHint(item) {
  const basis = item.distance_basis ?? item.distanceBasis;
  if (basis === 'direct') return ' (direct est.)';
  if (basis === 'record') return '';
  return '';
}

function formatDistanceProgress(item, routes) {
  if (item.activity_stage === 'awaiting_reschedule') {
    return item.auto_completed_delivery ? '✓ Delivered (auto)' : '✓ Delivered';
  }
  if (item.activity_stage === 'at_destination') {
    const totalKm = resolveRouteTotalKm(item, routes);
    const total = formatKmNum(totalKm);
    return total != null ? `0/${total} km` : 'At destination';
  }
  const totalKm = resolveRouteTotalKm(item, routes);
  let leftKm = item.km_remaining ?? item.kmRemaining;
  leftKm = leftKm != null && Number.isFinite(Number(leftKm)) ? Number(leftKm) : null;
  if (leftKm != null && totalKm != null && leftKm > totalKm) leftKm = totalKm;
  const left = formatKmNum(leftKm);
  const total = formatKmNum(totalKm);
  const hint = distanceBasisHint(item);
  if (left != null && total != null) return `${left}/${total} km${hint}`;
  if (left != null) return `${left} km left${hint}`;
  if (total != null) return `${total} km route`;
  return '—';
}

function formatKmDone(item, routes) {
  if (item.activity_stage !== 'enroute') return null;
  const traveled = item.km_traveled ?? item.kmTraveled;
  if (traveled != null && Number.isFinite(Number(traveled))) {
    return Math.max(0, Number(traveled));
  }
  const total = resolveRouteTotalKm(item, routes);
  const left = Number(item.km_remaining ?? item.kmRemaining);
  if (!Number.isFinite(total) || !Number.isFinite(left)) return null;
  return Math.max(0, Math.min(total, total - left));
}

function progressPct(item, routes) {
  const traveled = item.km_traveled ?? item.kmTraveled;
  const total = resolveRouteTotalKm(item, routes);
  if (traveled != null && Number.isFinite(Number(traveled)) && Number.isFinite(total) && total > 0) {
    return Math.round(Math.max(0, Math.min(100, (Number(traveled) / total) * 100)));
  }
  const left = item.km_remaining ?? item.kmRemaining;
  if (!Number.isFinite(total) || total <= 0 || left == null) return null;
  const done = Math.max(0, Math.min(100, ((total - Number(left)) / total) * 100));
  return Math.round(done);
}

function progressLabel(item) {
  const basis = item.distance_basis ?? item.distanceBasis;
  if (basis === 'road') return 'route covered (road distance)';
  if (basis === 'direct') return 'approx. progress (direct-line est.)';
  return 'route progress';
}

function formatEta(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const m = Math.round(Number(minutes));
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `~${h}h ${r}m` : `~${h}h`;
}

function formatDurationMinutes(mins) {
  if (mins == null || !Number.isFinite(Number(mins))) return '—';
  const m = Math.max(0, Math.round(Number(mins)));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function formatEtaClock(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function ActivityCard({
  item,
  routes,
  styles,
  requireOffloadingSlip = true,
  requireLoadingSlipBeforeEnroute = true,
  onLoadingSlip,
  onProceedWithoutSlip,
  onEditLoadingSlip,
  onOffloadingSlip,
  onRedirect,
  onReschedule,
  onCancel,
  onShowOnMap,
  mapActive,
  isDragging = false,
  draggable = false,
  onDragStart,
  onDragEnd,
}) {
  const needsLoading = item.activity_stage === 'at_loading' && requireLoadingSlipBeforeEnroute;
  const needsOffload = item.activity_stage === 'at_destination' && requireOffloadingSlip;
  const awaitingNext = item.activity_stage === 'awaiting_reschedule';
  const deliveryComplete = item.delivery_completed || item.auto_completed_delivery;
  const loadingSlipMissing = !String(item.loading_slip_no || '').trim();
  const blockedAtDestination = item.activity_stage === 'at_destination' && loadingSlipMissing;
  const canEditLoadingSlip = ['enroute', 'at_destination', 'awaiting_reschedule', 'at_loading'].includes(item.activity_stage);
  const needsAction = needsLoading || needsOffload || blockedAtDestination || awaitingNext;
  const speed = Number(item.last_speed_kmh);
  const hasSpeed = Number.isFinite(speed);
  const moving = hasSpeed && speed >= 5;
  const pct = progressPct(item, routes);
  const kmDone = formatKmDone(item, routes);
  const alertCount = (item.deviation_count || 0) + (item.overspeed_count || 0);
  const destLabel = item.destination_name || item.destination_address || '—';
  const loadingTime = item.activity_stage === 'at_loading'
    ? formatDurationMinutes(item.loading_duration_minutes)
    : item.at_loading_at ? 'Done' : '—';
  const onRoadTime = ['enroute', 'at_destination', 'awaiting_reschedule'].includes(item.activity_stage)
    ? formatDurationMinutes(item.on_road_duration_minutes)
    : '—';
  const etaLabel = item.activity_stage === 'enroute'
    ? (formatEtaClock(item.eta_at) !== '—' ? formatEtaClock(item.eta_at) : formatEta(item.eta_minutes) || '—')
    : item.activity_stage === 'at_destination' ? 'Arrived' : '—';

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.trip_id);
        onDragStart?.(e);
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-2xl border border-surface-200/90 dark:border-surface-700/80 bg-white dark:bg-surface-900 border-l-[3px] ${styles.card} shadow-sm transition-all hover:shadow-lg hover:border-surface-300 dark:hover:border-surface-600 ${
        needsAction ? 'ring-1 ring-brand-300/50 dark:ring-brand-700/40' : ''
      } ${mapActive ? 'ring-2 ring-sky-400/70 dark:ring-sky-500/40 shadow-md' : ''} ${
        isDragging ? 'opacity-40 scale-[0.98] ring-2 ring-dashed ring-brand-400' : ''
      } ${draggable && !isDragging ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={draggable ? 'Drag to any column to move this truck' : undefined}
    >
      <div className="p-3.5 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onShowOnMap?.(item)}
              title="Show on map"
              className="font-mono font-bold text-[15px] tracking-tight text-surface-900 dark:text-surface-50 hover:text-brand-600 dark:hover:text-brand-400 transition-colors text-left"
            >
              {item.truck_registration}
            </button>
            <p className="text-[11px] font-medium text-surface-500 truncate mt-0.5">{item.route_name}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {hasSpeed && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                moving
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20'
                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${moving ? 'bg-emerald-500 animate-pulse' : 'bg-surface-400'}`} />
                {Math.round(speed)} km/h
              </span>
            )}
            {deliveryComplete && (
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">✓ Delivered</span>
            )}
            {(item.is_overdue || alertCount > 0) && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {item.is_overdue ? 'Overdue' : `${alertCount} alert${alertCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>

        {/* Timing metrics */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-50 dark:bg-surface-950/70 border border-surface-100 dark:border-surface-800 p-2">
          <div className="text-center px-1">
            <p className="text-[9px] font-bold uppercase tracking-wider text-surface-400">Loading</p>
            <p className="text-xs font-semibold tabular-nums text-surface-800 dark:text-surface-100 mt-0.5">{loadingTime}</p>
          </div>
          <div className="text-center px-1 border-x border-surface-200/80 dark:border-surface-800">
            <p className="text-[9px] font-bold uppercase tracking-wider text-surface-400">On road</p>
            <p className="text-xs font-semibold tabular-nums text-surface-800 dark:text-surface-100 mt-0.5">{onRoadTime}</p>
          </div>
          <div className="text-center px-1">
            <p className="text-[9px] font-bold uppercase tracking-wider text-surface-400">ETA</p>
            <p className="text-xs font-semibold tabular-nums text-brand-700 dark:text-brand-300 mt-0.5">{etaLabel}</p>
          </div>
        </div>

        {/* Route progress */}
        <div className="rounded-xl border border-surface-100 dark:border-surface-800 bg-white dark:bg-surface-900/50 px-3 py-2.5 space-y-2">
          <p className="text-[11px] font-medium text-surface-700 dark:text-surface-300 line-clamp-1" title={destLabel}>
            → {destLabel}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-bold tabular-nums text-surface-900 dark:text-surface-100 leading-none">
              {formatDistanceProgress(item, routes)}
            </span>
            {item.activity_stage === 'enroute' && item.eta_minutes != null && (
              <span className="text-[10px] text-surface-500 tabular-nums">{formatEta(item.eta_minutes)} left</span>
            )}
          </div>
          {pct != null && item.activity_stage === 'enroute' && (
            <div>
              <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-400 to-emerald-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-surface-500 mt-1 tabular-nums flex justify-between">
                <span>{pct}% {progressLabel(item)}</span>
                {kmDone != null && <span>{formatKmNum(kmDone)} km done</span>}
              </p>
            </div>
          )}
          {item.off_route_m != null && item.off_route_m > 500 && (
            <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Off corridor · {Math.round(item.off_route_m)} m</p>
          )}
        </div>

        {/* Driver */}
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-surface-100 dark:border-surface-800">
          <div className="min-w-0">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">{item.driver_name || 'Driver TBC'}</p>
            {item.driver_phone && (
              <p className="text-[10px] text-surface-500 truncate">{item.driver_phone}</p>
            )}
          </div>
          {item.contractor_name && (
            <span className="text-[10px] text-surface-400 truncate max-w-[42%] text-right">{item.contractor_name}</span>
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
        {item.loading_slip_no && canEditLoadingSlip && (
          <p className="text-[10px] text-brand-700 dark:text-brand-300">
            Loaded · slip {item.loading_slip_no}
            {item.tons_loaded != null ? ` · ${item.tons_loaded} t` : ''}
          </p>
        )}
        {item.activity_stage === 'at_loading' && !requireLoadingSlipBeforeEnroute && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
            <p className="text-[10px] font-medium leading-snug text-emerald-800 dark:text-emerald-200">
              Awaiting geofence exit — truck moves to En route automatically when it leaves the loading site.
            </p>
          </div>
        )}
        {blockedAtDestination && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300/80 bg-amber-50 px-2.5 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </span>
            <p className="text-[10px] font-medium leading-snug text-amber-900 dark:text-amber-200">
              Loading slip required before this delivery can leave destination.
            </p>
          </div>
        )}
        {item.activity_stage === 'at_destination' && !requireOffloadingSlip && !blockedAtDestination && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </span>
            <p className="text-[10px] font-medium leading-snug text-emerald-800 dark:text-emerald-200">
              Awaiting geofence exit — delivery completes automatically when the truck leaves destination.
            </p>
          </div>
        )}
        {awaitingNext && item.offloading_slip_no && !item.auto_completed_delivery && (
          <p className="text-[10px] text-violet-700 dark:text-violet-300">
            Delivered · slip {item.offloading_slip_no}
          </p>
        )}
        {awaitingNext && item.auto_completed_delivery && (
          <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            Delivered · auto-completed on geofence exit
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
          {needsOffload && !blockedAtDestination && (
            <button type="button" onClick={() => onOffloadingSlip(item)} className="text-[10px] px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 font-medium">
              Offloading slip
            </button>
          )}
          {item.activity_stage === 'at_loading' && !requireLoadingSlipBeforeEnroute && (
            <button
              type="button"
              onClick={() => onEditLoadingSlip(item)}
              className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              {item.loading_slip_no ? 'Edit loading slip' : 'Capture loading slip (optional)'}
            </button>
          )}
          {canEditLoadingSlip && (
            <button
              type="button"
              onClick={() => onEditLoadingSlip(item)}
              className="text-[10px] px-2.5 py-1 rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              {item.loading_slip_no || item.loading_slip_deferred ? 'Edit loading slip' : 'Capture loading slip'}
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
  const [dropHoverStage, setDropHoverStage] = useState(null);
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
    return (board.stages || []).flatMap((s) => s.items || []).filter((i) => i.needs_action).length;
  }, [board.stages]);

  const requireOffloadingSlip = board.workflow?.require_offloading_slip_at_destination !== false;
  const requireLoadingSlipBeforeEnroute = board.workflow?.require_loading_slip_before_enroute !== false;

  const persistLoadingSlip = async (tripId, form, { defer = false, update = false } = {}) => {
    const payload = {
      loading_slip_no: form.loading_slip_no,
      tons_loaded: form.tons_loaded,
      driver_name: form.driver_name,
      notes: form.notes,
    };
    if (update || defer) {
      if (update) {
        return trackingApi.logisticsActivity.updateLoadingSlip(tripId, payload);
      }
      return trackingApi.logisticsActivity.saveLoadingSlip(tripId, { ...payload, defer_slip: true });
    }
    return trackingApi.logisticsActivity.saveLoadingSlip(tripId, payload);
  };

  const submitLoadingSlip = async (tripId, form, defer = false, { forceUpdate = false } = {}) => {
    setSaving(true);
    setError('');
    try {
      const useUpdate = forceUpdate || (!defer && shouldUpdateLoadingSlip(modal));
      await persistLoadingSlip(tripId, form, { defer, update: useUpdate });
      setModal(null);
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Save failed');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleLoadingSave = async (form, defer = false) => {
    if (!modal) return;
    const useUpdate = !defer && shouldUpdateLoadingSlip(modal);
    return submitLoadingSlip(modal.trip_id, form, defer, { forceUpdate: useUpdate });
  };

  const handleLoadingEdit = async (form) => {
    if (!modal) return;
    setSaving(true);
    setError('');
    try {
      await persistLoadingSlip(modal.trip_id, form, { update: true });
      setModal(null);
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Update failed');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const moveTripStage = useCallback(async (tripId, targetStage, fromStage) => {
    if (!tripId || !targetStage || fromStage === targetStage) return;
    if (!ALL_BOARD_STAGES.has(targetStage)) return;
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
                  Schedule loads by route, track geofence arrivals, and capture loading and offloading slips. An{' '}
                  <strong>activity watcher</strong> runs on every refresh to auto-move trucks into the correct column when GPS or geofences disagree with the board. Click a{' '}
                  <strong>truck registration</strong> to open its live position on the map.{' '}
                  <strong>Drag a truck card</strong> to any column — the highlighted column shows where it will land when you release.
                </>
              }
            />
          </div>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {board.total_active || 0} active
            {actionNeeds > 0 && ` · ${actionNeeds} need action`}
            {!requireOffloadingSlip && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Auto-complete on exit
              </span>
            )}
            {!requireLoadingSlipBeforeEnroute && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Auto en route on exit
              </span>
            )}
            {filterRouteId !== 'all' && ` · ${focusedRoute?.route_name || 'Route'} (${filteredTotal})`}
            {board.watcher?.fixed > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-200" title="Activity watcher auto-corrected misplaced trucks">
                Watcher fixed {board.watcher.fixed}
              </span>
            )}
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

      <section className="app-glass-panel-2xl overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 shadow-sm relative">
        {draggingTrip && dropHoverStage && (
          <div className="sticky top-0 z-20 px-4 py-2 bg-brand-600 text-white text-xs font-semibold text-center shadow-md">
            Drop into: {searchedStages.find((s) => s.id === dropHoverStage)?.label || dropHoverStage}
          </div>
        )}
        <div className="overflow-x-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 min-w-[320px] xl:min-w-[1100px] divide-y md:divide-y-0 md:divide-x divide-surface-200 dark:divide-surface-800">
          {searchedStages.map((stage) => {
            const styles = STAGE_STYLES[stage.id] || STAGE_STYLES.scheduled;
            const isSameColumn = draggingTrip?.fromStage === stage.id;
            const isAligned = draggingTrip && dropHoverStage === stage.id;
            const isValidDrop = draggingTrip && !isSameColumn;
            const isActiveTarget = isAligned && isValidDrop;
            return (
              <div
                key={stage.id}
                className={`flex flex-col min-h-[420px] transition-all duration-150 ${
                  isActiveTarget
                    ? 'ring-2 ring-inset ring-brand-500 bg-brand-50/70 dark:bg-brand-950/35 z-10 shadow-inner'
                    : draggingTrip && isValidDrop
                      ? 'ring-1 ring-dashed ring-surface-300/80 dark:ring-surface-600 bg-surface-50/30 dark:bg-surface-900/20'
                      : draggingTrip && isSameColumn
                        ? 'opacity-60'
                        : ''
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (draggingTrip) setDropHoverStage(stage.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = isSameColumn ? 'none' : 'move';
                  if (draggingTrip) setDropHoverStage(stage.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDropHoverStage((prev) => (prev === stage.id ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingTrip && !isSameColumn) {
                    moveTripStage(draggingTrip.tripId, stage.id, draggingTrip.fromStage);
                  }
                  setDraggingTrip(null);
                  setDropHoverStage(null);
                }}
              >
                <div className={`px-3 py-3 ${styles.header} ${isActiveTarget ? 'bg-brand-100/90 dark:bg-brand-900/50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${styles.title}`}>{stage.label}</p>
                      <p className={`text-[10px] mt-0.5 leading-snug ${styles.hint}`}>{stage.hint}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-bold tabular-nums px-2 py-0.5 rounded-full ${styles.badge}`}>
                      {stage.count}
                    </span>
                  </div>
                  {isActiveTarget && (
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-brand-800 dark:text-brand-200 bg-brand-200/80 dark:bg-brand-800/60 rounded-md px-2 py-1.5 text-center">
                      ↓ Release here
                    </p>
                  )}
                  {draggingTrip && isSameColumn && isAligned && (
                    <p className="mt-2 text-[10px] text-surface-500 text-center">Already in this column</p>
                  )}
                </div>
                <div className={`flex-1 overflow-y-auto p-2 space-y-2 max-h-[min(78vh,680px)] ${
                  isActiveTarget ? 'bg-brand-50/40 dark:bg-brand-950/20' : 'bg-surface-50/50 dark:bg-surface-950/30'
                }`}>
                  {stage.items?.length ? (
                    stage.items.map((item) => (
                      <ActivityCard
                        key={item.trip_id}
                        item={item}
                        routes={board.routes || []}
                        styles={styles}
                        requireOffloadingSlip={requireOffloadingSlip}
                        requireLoadingSlipBeforeEnroute={requireLoadingSlipBeforeEnroute}
                        mapActive={mapTripId === item.trip_id}
                        isDragging={draggingTrip?.tripId === item.trip_id}
                        draggable
                        onDragStart={() => setDraggingTrip({ tripId: item.trip_id, fromStage: item.activity_stage })}
                        onDragEnd={() => {
                          setDraggingTrip(null);
                          setDropHoverStage(null);
                        }}
                        onShowOnMap={showTruckOnMap}
                        onLoadingSlip={setModal}
                        onProceedWithoutSlip={(it) => submitLoadingSlip(it.trip_id, { driver_name: it.driver_name || '' }, true)}
                        onEditLoadingSlip={(it) => setModal({ ...it, edit_loading_slip: true })}
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

      {(modal?.activity_stage === 'at_loading' || modal?.edit_loading_slip) && (
        <SlipModal
          title={`${modal.edit_loading_slip ? 'Edit loading slip' : 'Loading slip'} — ${modal.truck_registration}`}
          truckRegistration={modal.truck_registration}
          resetKey={`${modal.trip_id}-${modal.edit_loading_slip ? 'edit' : 'capture'}-loading`}
          initial={{
            loading_slip_no: modal.loading_slip_no || '',
            tons_loaded: modal.tons_loaded ?? '',
            driver_id: '',
            driver_name: modal.driver_name || '',
            notes: modal.loading_notes && modal.loading_notes !== 'Awaiting loading slip' ? modal.loading_notes : '',
          }}
          fields={[
            { key: 'loading_slip_no', label: 'Loading slip number', required: true },
            { key: 'tons_loaded', label: 'Tons loaded', type: 'number', step: '0.001' },
            { key: 'driver_name', label: 'Driver', type: 'driver_select' },
            { key: 'notes', label: 'Remarks', type: 'textarea' },
          ]}
          onClose={() => setModal(null)}
          onSave={(form) => (modal.edit_loading_slip || shouldUpdateLoadingSlip(modal)
            ? handleLoadingEdit(form)
            : handleLoadingSave(form, false))}
          submitLabel={modal.edit_loading_slip ? 'Update' : 'Save'}
          saving={saving}
        />
      )}

      {modal?.activity_stage === 'at_destination' && (
        <SlipModal
          title={`Offloading slip — ${modal.truck_registration}`}
          resetKey={`${modal.trip_id}-offloading`}
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
