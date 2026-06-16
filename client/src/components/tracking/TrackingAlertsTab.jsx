import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/appTime.js';
import { tracking as trackingApi } from '../../api';
import AdvancedColumnSearchBar from '../AdvancedColumnSearchBar.jsx';
import { emptyColumnValues, matchesColumnSearch } from '../../lib/advancedColumnSearch.js';

const ALARM_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'overspeed', label: 'Overspeed' },
  { value: 'deviation', label: 'Route deviation' },
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'harsh_accel', label: 'Harsh acceleration' },
  { value: 'seatbelt', label: 'Seatbelt violation' },
  { value: 'geofence', label: 'Geofence breach' },
  { value: 'idle', label: 'Excessive idle' },
  { value: 'overdue', label: 'Overdue delivery' },
];

const TRUCK_COLUMNS = [
  { key: 'registration', label: 'Truck', get: (r) => r.truck_registration },
  { key: 'total', label: 'Total alerts', get: (r) => String(r.total_alerts) },
  { key: 'overspeed', label: 'Overspeed', get: (r) => String(r.overspeed_count) },
  { key: 'deviation', label: 'Deviations', get: (r) => String(r.deviation_count) },
  { key: 'other', label: 'Other', get: (r) => String(r.other_count) },
  { key: 'max_speed', label: 'Max speed', get: (r) => (r.max_speed_kmh != null ? `${r.max_speed_kmh} km/h` : '') },
  { key: 'last_type', label: 'Last type', get: (r) => r.last_alarm_type },
  { key: 'last_detail', label: 'Last detail', get: (r) => r.last_detail },
];

const ALERT_COLUMNS = [
  { key: 'time', label: 'Time', get: (a) => formatDt(a.occurred_at) },
  { key: 'truck', label: 'Truck', get: (a) => a.truck_registration },
  { key: 'type', label: 'Type', get: (a) => a.alarm_type },
  { key: 'severity', label: 'Severity', get: (a) => a.severity },
  { key: 'detail', label: 'Detail', get: (a) => a.detail },
  { key: 'speed', label: 'Speed', get: (a) => (a.speed_kmh != null ? `${a.speed_kmh} km/h` : '') },
  { key: 'ack', label: 'Acknowledged', get: (a) => (a.acknowledged ? 'Yes' : 'No') },
];

function formatDt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function sevColor(s) {
  if (s === 'critical') return 'text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-200';
  if (s === 'warning') return 'text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200';
  return 'text-surface-700 bg-surface-100 dark:bg-surface-800 dark:text-surface-300';
}

function aggregateByTruck(alarms) {
  const map = new Map();
  for (const a of alarms || []) {
    const reg = a.truck_registration || 'Unknown';
    if (!map.has(reg)) {
      map.set(reg, {
        truck_registration: reg,
        total_alerts: 0,
        overspeed_count: 0,
        deviation_count: 0,
        other_count: 0,
        unacked_count: 0,
        max_speed_kmh: null,
        last_occurred_at: null,
        last_alarm_type: '',
        last_detail: '',
      });
    }
    const row = map.get(reg);
    row.total_alerts += 1;
    const type = String(a.alarm_type || '').toLowerCase();
    if (type === 'overspeed') row.overspeed_count += 1;
    else if (type === 'deviation') row.deviation_count += 1;
    else row.other_count += 1;
    if (!a.acknowledged) row.unacked_count += 1;
    const spd = a.speed_kmh != null ? Number(a.speed_kmh) : null;
    if (spd != null && (row.max_speed_kmh == null || spd > row.max_speed_kmh)) {
      row.max_speed_kmh = spd;
    }
    const at = a.occurred_at ? new Date(a.occurred_at).getTime() : 0;
    const last = row.last_occurred_at ? new Date(row.last_occurred_at).getTime() : 0;
    if (at >= last) {
      row.last_occurred_at = a.occurred_at;
      row.last_alarm_type = a.alarm_type || '';
      row.last_detail = a.detail || '';
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.overspeed_count !== a.overspeed_count) return b.overspeed_count - a.overspeed_count;
    if (b.total_alerts !== a.total_alerts) return b.total_alerts - a.total_alerts;
    return String(a.truck_registration).localeCompare(String(b.truck_registration));
  });
}

export default function TrackingAlertsTab({ setError }) {
  const [view, setView] = useState('by_truck');
  const [alarms, setAlarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: (() => {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      return d.toISOString().slice(0, 10);
    })(),
    to: todayYmd(),
    type: 'all',
    severity: 'all',
    acknowledged: 'all',
  });
  const [truckSearch, setTruckSearch] = useState({ global: '', columns: emptyColumnValues(TRUCK_COLUMNS), expanded: false });
  const [alertSearch, setAlertSearch] = useState({ global: '', columns: emptyColumnValues(ALERT_COLUMNS), expanded: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.type !== 'all') params.type = filters.type;
      if (filters.severity !== 'all') params.severity = filters.severity;
      if (filters.acknowledged === 'true') params.acknowledged = 'true';
      if (filters.acknowledged === 'false') params.acknowledged = 'false';
      const d = await trackingApi.alarms.list(params);
      setAlarms(d.alarms || []);
    } catch (e) {
      setError(e?.message || 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [filters, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const truckRows = useMemo(() => aggregateByTruck(alarms), [alarms]);

  const filteredTrucks = useMemo(
    () => truckRows.filter((r) => matchesColumnSearch(r, TRUCK_COLUMNS, truckSearch.columns, truckSearch.global)),
    [truckRows, truckSearch]
  );

  const filteredAlerts = useMemo(
    () => alarms.filter((a) => matchesColumnSearch(a, ALERT_COLUMNS, alertSearch.columns, alertSearch.global)),
    [alarms, alertSearch]
  );

  const totals = useMemo(() => ({
    trucks: truckRows.length,
    alerts: alarms.length,
    overspeed: alarms.filter((a) => String(a.alarm_type).toLowerCase() === 'overspeed').length,
    unacked: alarms.filter((a) => !a.acknowledged).length,
  }), [alarms, truckRows.length]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Alerts</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
          Overspeed, route deviations, and other telematics alarms grouped per truck for logistics oversight.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300">
            {totals.trucks} truck{totals.trucks === 1 ? '' : 's'}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            {totals.overspeed} overspeed
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            {totals.unacked} unacknowledged
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-surface-200 dark:border-surface-800 pb-2">
        <button
          type="button"
          onClick={() => setView('by_truck')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'by_truck' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
        >
          By truck
        </button>
        <button
          type="button"
          onClick={() => setView('all_alerts')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === 'all_alerts' ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
        >
          All alerts
        </button>
      </div>

      <div className="app-glass-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 shadow-sm">
        <div>
          <label className="block text-xs text-surface-500 mb-1">From</label>
          <input type="date" className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">To</label>
          <input type="date" className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Alarm type</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            {ALARM_TYPES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Severity</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Acknowledged</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={filters.acknowledged} onChange={(e) => setFilters((f) => ({ ...f, acknowledged: e.target.value }))}>
            <option value="all">All</option>
            <option value="false">Unacked only</option>
            <option value="true">Acked only</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="button" onClick={load} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 w-full sm:w-auto">
            Apply
          </button>
        </div>
      </div>

      {view === 'by_truck' && (
        <>
          <AdvancedColumnSearchBar
            columns={TRUCK_COLUMNS}
            columnValues={truckSearch.columns}
            onColumnChange={(key, val) => setTruckSearch((s) => ({ ...s, columns: { ...s.columns, [key]: val } }))}
            globalQuery={truckSearch.global}
            onGlobalQueryChange={(v) => setTruckSearch((s) => ({ ...s, global: v }))}
            expanded={truckSearch.expanded}
            onToggleExpanded={() => setTruckSearch((s) => ({ ...s, expanded: !s.expanded }))}
            onClear={() => setTruckSearch({ global: '', columns: emptyColumnValues(TRUCK_COLUMNS), expanded: false })}
            resultCount={filteredTrucks.length}
            totalCount={truckRows.length}
          />
          <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
            <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-800 text-xs text-surface-500 bg-surface-50 dark:bg-surface-900">
              {loading ? 'Loading…' : `${filteredTrucks.length} truck${filteredTrucks.length === 1 ? '' : 's'} with alerts`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead className="text-xs uppercase text-surface-500 bg-surface-50 dark:bg-surface-900">
                  <tr>
                    <th className="text-left px-4 py-2">Truck</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="text-right px-4 py-2">Overspeed</th>
                    <th className="text-right px-4 py-2">Deviations</th>
                    <th className="text-right px-4 py-2">Other</th>
                    <th className="text-right px-4 py-2">Unacked</th>
                    <th className="text-right px-4 py-2">Max speed</th>
                    <th className="text-left px-4 py-2">Last alert</th>
                    <th className="text-left px-4 py-2">Last detail</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
                  ) : filteredTrucks.map((r) => (
                    <tr key={r.truck_registration} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50/50 dark:hover:bg-surface-900/50">
                      <td className="px-4 py-2 font-mono font-semibold">{r.truck_registration}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.total_alerts}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.overspeed_count > 0 ? (
                          <span className="font-semibold text-rose-700 dark:text-rose-300">{r.overspeed_count}</span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.deviation_count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.other_count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.unacked_count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.max_speed_kmh != null ? `${Math.round(r.max_speed_kmh)} km/h` : '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-xs">
                        {formatDt(r.last_occurred_at)}
                        {r.last_alarm_type && (
                          <span className="block text-surface-500">{r.last_alarm_type}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-surface-600 max-w-xs truncate" title={r.last_detail}>{r.last_detail || '—'}</td>
                    </tr>
                  ))}
                  {!loading && filteredTrucks.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-surface-500">No alerts match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {view === 'all_alerts' && (
        <>
          <AdvancedColumnSearchBar
            columns={ALERT_COLUMNS}
            columnValues={alertSearch.columns}
            onColumnChange={(key, val) => setAlertSearch((s) => ({ ...s, columns: { ...s.columns, [key]: val } }))}
            globalQuery={alertSearch.global}
            onGlobalQueryChange={(v) => setAlertSearch((s) => ({ ...s, global: v }))}
            expanded={alertSearch.expanded}
            onToggleExpanded={() => setAlertSearch((s) => ({ ...s, expanded: !s.expanded }))}
            onClear={() => setAlertSearch({ global: '', columns: emptyColumnValues(ALERT_COLUMNS), expanded: false })}
            resultCount={filteredAlerts.length}
            totalCount={alarms.length}
          />
          <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
            <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-800 text-xs text-surface-500 bg-surface-50 dark:bg-surface-900">
              {loading ? 'Loading…' : `${filteredAlerts.length} alert${filteredAlerts.length === 1 ? '' : 's'}`}
            </div>
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-surface-500 bg-surface-50 dark:bg-surface-900 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Truck</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Severity</th>
                    <th className="text-right px-4 py-2">Speed</th>
                    <th className="text-left px-4 py-2">Detail</th>
                    <th className="text-right px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
                  ) : filteredAlerts.map((a) => (
                    <tr key={a.id} className="border-t border-surface-100 dark:border-surface-800 hover:bg-surface-50/50">
                      <td className="px-4 py-2 whitespace-nowrap text-xs">{formatDt(a.occurred_at)}</td>
                      <td className="px-4 py-2 font-mono font-medium">{a.truck_registration}</td>
                      <td className="px-4 py-2">
                        <span className={String(a.alarm_type).toLowerCase() === 'overspeed' ? 'font-semibold text-rose-700 dark:text-rose-300' : ''}>
                          {a.alarm_type}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded ${sevColor(a.severity)}`}>{a.severity}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{a.speed_kmh != null ? `${Math.round(a.speed_kmh)} km/h` : '—'}</td>
                      <td className="px-4 py-2 text-xs max-w-md truncate" title={a.detail}>{a.detail || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {!a.acknowledged ? (
                          <button
                            type="button"
                            className="text-brand-600 hover:underline text-xs"
                            onClick={async () => {
                              try {
                                await trackingApi.alarms.acknowledge(a.id);
                                load();
                              } catch (e) {
                                setError(e?.message || 'Acknowledge failed');
                              }
                            }}
                          >
                            Acknowledge
                          </button>
                        ) : (
                          <span className="text-xs text-surface-400">Acked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredAlerts.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">No alerts match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
