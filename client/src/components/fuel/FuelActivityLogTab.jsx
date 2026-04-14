import { useState, useEffect, useMemo } from 'react';
import { fuelSupply } from '../../api';
import { inputClass, pickRow, formatDt } from '../../lib/fuelSupplyUi';
import { exportFuelActivitiesExcel, exportFuelActivitiesPdf } from '../../lib/fuelSupplyExports';
import InfoHint from '../InfoHint.jsx';

export default function FuelActivityLogTab({ orders, onError }) {
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    activity_type: '',
    order_id: '',
    search: '',
  });
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    const params = { limit: 500 };
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.activity_type) params.activity_type = filters.activity_type;
    if (filters.order_id) params.order_id = filters.order_id;
    if (filters.search.trim()) params.search = filters.search.trim();
    fuelSupply
      .activitiesFiltered(params)
      .then((r) => setRows(r.activities || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const sorted = useMemo(() => {
    const k = sort.key;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = pickRow(a, k, k);
      const bv = pickRow(b, k, k);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (k === 'created_at') return (new Date(av) - new Date(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort]);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const exportRows = async (kind) => {
    try {
      const params = { limit: 500 };
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.activity_type) params.activity_type = filters.activity_type;
      if (filters.order_id) params.order_id = filters.order_id;
      if (filters.search.trim()) params.search = filters.search.trim();
      const r = await fuelSupply.activitiesFiltered(params);
      const list = r.activities || [];
      if (kind === 'xlsx') await exportFuelActivitiesExcel(list);
      else exportFuelActivitiesPdf(list);
    } catch (err) {
      onError(err?.message || 'Export failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Activity log</h2>
          <InfoHint
            title="Activity log help"
            text="Filter supply activities by date, type, order, and free text. Excel and PDF exports match the current filters."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportRows('xlsx')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => exportRows('pdf')}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">From</label>
            <input type="date" className={inputClass()} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">To</label>
            <input type="date" className={inputClass()} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Type</label>
            <select
              className={inputClass()}
              value={filters.activity_type}
              onChange={(e) => setFilters((f) => ({ ...f, activity_type: e.target.value }))}
            >
              <option value="">Any</option>
              <option value="collected">collected</option>
              <option value="collection">collection</option>
              <option value="in_transit">in_transit</option>
              <option value="other">other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Order</label>
            <select
              className={inputClass()}
              value={filters.order_id}
              onChange={(e) => setFilters((f) => ({ ...f, order_id: e.target.value }))}
            >
              <option value="">Any</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.depot_name} → {o.delivery_site_name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Search</label>
            <input
              className={inputClass()}
              placeholder="Title, notes, tags, depot, site…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Apply filters'}
        </button>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto shadow-sm">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="bg-surface-50 text-left text-surface-600">
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                <button type="button" className="hover:text-brand-600" onClick={() => toggleSort('created_at')}>
                  When {sort.key === 'created_at' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Driver</th>
              <th className="px-3 py-2 font-medium">L</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Odo</th>
              <th className="px-3 py-2 font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const id = pickRow(a, 'id', 'Id');
              return (
                <tr key={id} className="border-t border-surface-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-surface-500">{formatDt(pickRow(a, 'created_at', 'createdAt'))}</td>
                  <td className="px-3 py-2">{pickRow(a, 'activity_type', 'activityType')}</td>
                  <td className="px-3 py-2 max-w-[220px] break-words">{pickRow(a, 'title', 'Title')}</td>
                  <td className="px-3 py-2 text-xs">
                    {pickRow(a, 'depot_name', 'depotName')} → {pickRow(a, 'delivery_site_name', 'deliverySiteName')}
                  </td>
                  <td className="px-3 py-2 text-xs">{pickRow(a, 'driver_name', 'driverName')}</td>
                  <td className="px-3 py-2">{pickRow(a, 'liters_related', 'litersRelated') ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{pickRow(a, 'location_label', 'locationLabel') || '—'}</td>
                  <td className="px-3 py-2">{pickRow(a, 'odometer_km', 'odometerKm') ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{pickRow(a, 'tags', 'Tags') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && (
          <p className="p-8 text-center text-surface-500 text-sm">No rows. Adjust filters and apply.</p>
        )}
      </div>
    </div>
  );
}
