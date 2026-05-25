import { useState, useEffect, useCallback, useMemo } from 'react';
import { fleetMaintenance as api, contractor as contractorApi } from '../api';
import InfoHint from '../components/InfoHint.jsx';
import { todayYmd } from '../lib/appTime.js';

const SCHEDULE_TYPES = [
  { value: 'preventive', label: 'Preventive' },
  { value: 'corrective', label: 'Corrective' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'tyre', label: 'Tyre replacement' },
  { value: 'service', label: 'Scheduled service' },
  { value: 'other', label: 'Other' },
];
const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-blue-100 text-blue-800' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-100 text-amber-800' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-900' },
  { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-900' },
];
const STATUSES = [
  { value: 'scheduled', label: 'Scheduled', color: 'bg-blue-100 text-blue-800 ring-blue-200' },
  { value: 'in_progress', label: 'In progress', color: 'bg-indigo-100 text-indigo-800 ring-indigo-200' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-surface-100 text-surface-600 ring-surface-200' },
];

function priorityBadge(p) {
  const m = PRIORITIES.find((x) => x.value === p) || PRIORITIES[1];
  return <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${m.color}`}>{m.label}</span>;
}

function statusBadge(s) {
  const m = STATUSES.find((x) => x.value === s) || STATUSES[0];
  return <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ring-1 ${m.color}`}>{m.label}</span>;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function isOverdue(row) {
  if (!row.due_date) return false;
  const s = String(row.status || '').toLowerCase();
  if (s === 'completed' || s === 'cancelled') return false;
  return new Date(row.due_date) < new Date(todayYmd());
}

function StatCard({ label, value, sub, accent = 'indigo', icon }) {
  const accents = {
    indigo: 'border-indigo-200 bg-indigo-50/50',
    emerald: 'border-emerald-200 bg-emerald-50/50',
    amber: 'border-amber-200 bg-amber-50/50',
    red: 'border-red-200 bg-red-50/50',
    surface: 'border-surface-200 bg-white',
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${accents[accent] || accents.surface}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{label}</p>
          <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{value ?? 0}</p>
          {sub && <p className="text-xs text-surface-500 mt-0.5">{sub}</p>}
        </div>
        {icon && <span className="text-2xl opacity-30">{icon}</span>}
      </div>
    </div>
  );
}

function DashboardTab({ dash, loading }) {
  if (loading) return <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading dashboard…</div>;
  if (!dash) return <div className="text-sm text-surface-500 py-12 text-center">Could not load dashboard data.</div>;
  const bs = dash.byStatus || {};
  const total = Object.values(bs).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total schedules" value={total} accent="surface" icon="📋" />
        <StatCard label="Scheduled" value={bs.scheduled || 0} accent="indigo" icon="🔧" />
        <StatCard label="In progress" value={bs.in_progress || 0} accent="amber" icon="⚡" />
        <StatCard label="Completed" value={bs.completed || 0} accent="emerald" icon="✅" />
        <StatCard label="Overdue" value={dash.overdue || 0} accent="red" sub="Not completed past due date" icon="⚠️" />
      </div>

      {dash.cost90d && (
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-3">Cost summary (last 90 days)</h3>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-surface-500 text-xs">Total spend</p>
              <p className="text-xl font-bold text-surface-900 tabular-nums">R {Number(dash.cost90d.total || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-surface-500 text-xs">Actual cost</p>
              <p className="text-lg font-semibold text-surface-800 tabular-nums">R {Number(dash.cost90d.actual || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-surface-500 text-xs">Estimated cost</p>
              <p className="text-lg font-semibold text-surface-800 tabular-nums">R {Number(dash.cost90d.estimated || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800 mb-3">Upcoming maintenance</h3>
          {(dash.upcoming || []).length === 0 ? (
            <p className="text-sm text-surface-500">No upcoming items.</p>
          ) : (
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto pr-1">
              {(dash.upcoming || []).map((r) => (
                <li key={r.id} className="flex justify-between items-center gap-2 border-b border-amber-100 pb-2">
                  <div className="min-w-0">
                    <span className="font-medium text-surface-900 truncate block">{r.truck_reg || r.fleet_registration || '—'}</span>
                    <span className="text-xs text-surface-500">{r.schedule_type} · {r.description?.slice(0, 60) || '—'}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block text-xs font-medium text-amber-800">{formatDate(r.due_date)}</span>
                    {priorityBadge(r.priority)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-800 mb-3">Recently completed</h3>
          {(dash.recentlyCompleted || []).length === 0 ? (
            <p className="text-sm text-surface-500">No recent completions.</p>
          ) : (
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto pr-1">
              {(dash.recentlyCompleted || []).map((r) => (
                <li key={r.id} className="flex justify-between items-center gap-2 border-b border-emerald-100 pb-2">
                  <div className="min-w-0">
                    <span className="font-medium text-surface-900 truncate block">{r.truck_reg || r.fleet_registration || '—'}</span>
                    <span className="text-xs text-surface-500">{r.schedule_type}</span>
                  </div>
                  <span className="text-xs text-emerald-700 shrink-0">{formatDateTime(r.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const fieldClass = 'w-full px-3 py-2 rounded-lg border border-surface-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-white';

function ScheduleForm({ trucks, drivers, onSave, saving, onCancel }) {
  const [form, setForm] = useState({
    fleet_registration: '', trailer_registration: '', schedule_type: 'preventive',
    truck_id: '', maintenance_subject: 'truck', description: '', driver_name: '', driver_id: '',
    responsible_mechanic: '', responsible_company: '', action_date: todayYmd(),
    scope_of_work: '', due_date: '', odometer_reading: '', estimated_cost: '', priority: 'medium',
  });
  const f = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const selectedTruck = form.truck_id ? trucks.find((x) => String(x.id) === String(form.truck_id)) : null;
  const trailer1 = selectedTruck?.trailer_1_reg_no || '';
  const trailer2 = selectedTruck?.trailer_2_reg_no || '';
  const hasTrailers = !!(trailer1 || trailer2);

  const subjectOptions = [
    { value: 'truck', label: `Truck${selectedTruck ? ` (${selectedTruck.registration})` : ''}` },
    ...(trailer1 ? [{ value: 'trailer_1', label: `Trailer 1 (${trailer1})` }] : []),
    ...(trailer2 ? [{ value: 'trailer_2', label: `Trailer 2 (${trailer2})` }] : []),
    ...(hasTrailers ? [{ value: 'truck_and_trailers', label: 'Truck + all trailers' }] : []),
  ];

  const handleTruckPick = (id) => {
    f('truck_id', id);
    if (id) {
      const t = trucks.find((x) => String(x.id) === id);
      if (t) {
        setForm((p) => ({
          ...p,
          truck_id: id,
          fleet_registration: t.registration || '',
          maintenance_subject: 'truck',
          trailer_registration: '',
        }));
      }
    } else {
      setForm((p) => ({ ...p, truck_id: '', fleet_registration: '', trailer_registration: '', maintenance_subject: 'truck' }));
    }
  };

  const handleSubjectChange = (val) => {
    f('maintenance_subject', val);
    if (val === 'trailer_1') {
      setForm((p) => ({ ...p, maintenance_subject: val, trailer_registration: trailer1 }));
    } else if (val === 'trailer_2') {
      setForm((p) => ({ ...p, maintenance_subject: val, trailer_registration: trailer2 }));
    } else if (val === 'truck_and_trailers') {
      setForm((p) => ({ ...p, maintenance_subject: val, trailer_registration: [trailer1, trailer2].filter(Boolean).join(', ') }));
    } else {
      setForm((p) => ({ ...p, maintenance_subject: val, trailer_registration: '' }));
    }
  };

  const handleDriverPick = (id) => {
    f('driver_id', id);
    if (id) {
      const d = drivers.find((x) => String(x.id) === id);
      if (d) f('driver_name', d.full_name || '');
    }
  };

  const submit = (e) => {
    e.preventDefault();
    onSave({ ...form, odometer_reading: form.odometer_reading ? Number(form.odometer_reading) : null, estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null });
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-surface-200 bg-white shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-semibold text-surface-900">Schedule maintenance</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Fleet / Truck</label>
          <select value={form.truck_id} onChange={(e) => handleTruckPick(e.target.value)} className={fieldClass}>
            <option value="">— Select or type below —</option>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration} {t.make_model ? `(${t.make_model})` : ''}</option>)}
          </select>
        </div>
        {selectedTruck && hasTrailers && (
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Maintenance subject</label>
            <select value={form.maintenance_subject} onChange={(e) => handleSubjectChange(e.target.value)} className={fieldClass}>
              {subjectOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-[10px] text-surface-400 mt-1">Select which unit requires maintenance</p>
          </div>
        )}
        {selectedTruck && hasTrailers && (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-xs space-y-1">
            <p className="font-semibold text-indigo-800">Linked trailers</p>
            {trailer1 && <p className="text-indigo-700">Trailer 1: <span className="font-medium">{trailer1}</span></p>}
            {trailer2 && <p className="text-indigo-700">Trailer 2: <span className="font-medium">{trailer2}</span></p>}
          </div>
        )}
        {!selectedTruck && (
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Fleet registration (manual)</label>
            <input value={form.fleet_registration} onChange={(e) => f('fleet_registration', e.target.value)} className={fieldClass} placeholder="e.g. ABC 123 GP" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Trailer registration {selectedTruck ? '(auto-filled)' : ''}</label>
          <input value={form.trailer_registration} onChange={(e) => f('trailer_registration', e.target.value)} className={fieldClass} placeholder="e.g. TR-456" readOnly={!!selectedTruck && hasTrailers} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Type of scheduling</label>
          <select value={form.schedule_type} onChange={(e) => f('schedule_type', e.target.value)} className={fieldClass}>
            {SCHEDULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Driver</label>
          <select value={form.driver_id} onChange={(e) => handleDriverPick(e.target.value)} className={fieldClass}>
            <option value="">— Select or type below —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
          {!form.driver_id && (
            <input value={form.driver_name} onChange={(e) => f('driver_name', e.target.value)} className={`${fieldClass} mt-1`} placeholder="Driver name (if not listed)" />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Priority</label>
          <select value={form.priority} onChange={(e) => f('priority', e.target.value)} className={fieldClass}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Responsible mechanic</label>
          <input value={form.responsible_mechanic} onChange={(e) => f('responsible_mechanic', e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Responsible company</label>
          <input value={form.responsible_company} onChange={(e) => f('responsible_company', e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Action date</label>
          <input type="date" value={form.action_date} onChange={(e) => f('action_date', e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Maintenance due date *</label>
          <input type="date" value={form.due_date} onChange={(e) => f('due_date', e.target.value)} className={fieldClass} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Current KM / ODO reading</label>
          <input type="number" step="0.1" min="0" value={form.odometer_reading} onChange={(e) => f('odometer_reading', e.target.value)} className={fieldClass} placeholder="e.g. 245000" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Estimated cost (R)</label>
          <input type="number" step="0.01" min="0" value={form.estimated_cost} onChange={(e) => f('estimated_cost', e.target.value)} className={fieldClass} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-surface-500 mb-1">Scope of work</label>
        <textarea value={form.scope_of_work} onChange={(e) => f('scope_of_work', e.target.value)} rows={3} className={fieldClass} placeholder="Detailed description of maintenance work…" />
      </div>
      <div>
        <label className="block text-xs font-medium text-surface-500 mb-1">Description</label>
        <textarea value={form.description} onChange={(e) => f('description', e.target.value)} rows={2} className={fieldClass} placeholder="Brief description of the issue or reason…" />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-surface-200 text-sm font-medium text-surface-700 hover:bg-surface-50">Cancel</button>
        )}
      </div>
    </form>
  );
}

function ScheduleHistoryTab({ trucks, drivers }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ status: 'all', priority: 'all', type: 'all', search: '', due_from: '', due_to: '', truck_id: '' });
  const ff = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.list(filters)
      .then((d) => setItems(d.schedules || []))
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    api.get(detailId).then((d) => setDetail(d.schedule || null)).catch(() => setDetail(null));
  }, [detailId]);

  const handleSave = async (body) => {
    setSaving(true);
    setError('');
    try {
      await api.create(body);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await api.update(id, { status });
      load();
      if (detailId === id) {
        const d = await api.get(id);
        setDetail(d.schedule || null);
      }
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      await api.remove(id);
      if (detailId === id) setDetailId(null);
      load();
    } catch (e) {
      setError(e?.message || 'Delete failed');
    }
  };

  const downloadExcel = () => {
    window.open(api.exportExcelUrl, '_blank');
  };

  const downloadPdf = () => {
    window.open(api.exportPdfUrl(filters), '_blank');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowForm((v) => !v)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
            {showForm ? 'Hide form' : '+ Schedule maintenance'}
          </button>
          <button type="button" onClick={downloadExcel} className="px-3 py-2 rounded-lg border border-emerald-200 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
            Export Excel
          </button>
          <button type="button" onClick={downloadPdf} className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 hover:bg-red-50">
            Export PDF
          </button>
        </div>
        <button type="button" onClick={load} className="px-3 py-2 rounded-lg border border-surface-200 text-sm font-medium hover:bg-surface-50">Refresh</button>
      </div>

      {showForm && <ScheduleForm trucks={trucks} drivers={drivers} onSave={handleSave} saving={saving} onCancel={() => setShowForm(false)} />}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-sm font-medium">Dismiss</button>
        </div>
      )}

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wide text-surface-500 mb-3">Filters</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <input value={filters.search} onChange={(e) => ff('search', e.target.value)} placeholder="Search…" className={fieldClass} />
          <select value={filters.status} onChange={(e) => ff('status', e.target.value)} className={fieldClass}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => ff('priority', e.target.value)} className={fieldClass}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => ff('type', e.target.value)} className={fieldClass}>
            <option value="all">All types</option>
            {SCHEDULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filters.truck_id} onChange={(e) => ff('truck_id', e.target.value)} className={fieldClass}>
            <option value="">All trucks</option>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
          </select>
          <input type="date" value={filters.due_from} onChange={(e) => ff('due_from', e.target.value)} className={fieldClass} title="Due from" />
          <input type="date" value={filters.due_to} onChange={(e) => ff('due_to', e.target.value)} className={fieldClass} title="Due to" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-surface-500 py-8 text-center animate-pulse">Loading schedules…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500">No maintenance schedules match your filters.</div>
      ) : (
        <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Fleet / Trailer</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Driver</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Mechanic</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Due date</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-700">Inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {items.map((r) => {
                  const reg = r.truck_reg || r.fleet_registration || '—';
                  const overdue = isOverdue(r);
                  return (
                    <tr key={r.id} className={`hover:bg-surface-50/80 ${overdue ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setDetailId(r.id)} className="font-medium text-brand-700 hover:underline text-left">
                          {reg}
                          {r.trailer_registration && <span className="text-surface-500 text-xs block">{r.trailer_registration}</span>}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-surface-700 capitalize">{r.schedule_type}</td>
                      <td className="px-4 py-3 text-surface-700 max-w-xs truncate">{r.description || '—'}</td>
                      <td className="px-4 py-3 text-surface-700">{r.driver_name || '—'}</td>
                      <td className="px-4 py-3 text-surface-700">{r.responsible_mechanic || '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-700 font-semibold' : 'text-surface-700'}`}>
                        {formatDate(r.due_date)} {overdue && <span className="text-[10px]">OVERDUE</span>}
                      </td>
                      <td className="px-4 py-3">{priorityBadge(r.priority)}</td>
                      <td className="px-4 py-3">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3">{r.inspection_ref ? <span className="text-xs font-semibold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">{r.inspection_ref}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-surface-100 text-xs text-surface-500">
            {items.length} record(s)
          </div>
        </div>
      )}

      {detail && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-5 space-y-4">
          <div className="flex justify-between items-start gap-3">
            <h3 className="text-sm font-semibold text-surface-900">Schedule detail</h3>
            <button type="button" onClick={() => setDetailId(null)} className="text-xs font-medium text-surface-600 px-2 py-1 border border-surface-200 rounded-lg bg-white hover:bg-surface-50">Close</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Fleet reg</span><p className="text-surface-900">{detail.truck_reg || detail.fleet_registration || '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Trailer reg</span><p className="text-surface-900">{detail.trailer_registration || '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Subject</span><p className="text-surface-900 capitalize">{(detail.maintenance_subject || 'truck').replace(/_/g, ' ')}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Type</span><p className="text-surface-900 capitalize">{detail.schedule_type}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Driver</span><p className="text-surface-900">{detail.driver_name || '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Mechanic</span><p className="text-surface-900">{detail.responsible_mechanic || '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Company</span><p className="text-surface-900">{detail.responsible_company || '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Action date</span><p className="text-surface-900">{formatDate(detail.action_date)}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Due date</span><p className={isOverdue(detail) ? 'text-red-700 font-semibold' : 'text-surface-900'}>{formatDate(detail.due_date)}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Priority</span><p>{priorityBadge(detail.priority)}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Status</span><p>{statusBadge(detail.status)}</p></div>
            {detail.inspection_ref && <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Linked inspection</span><p className="text-blue-800 font-semibold">{detail.inspection_ref} ({(detail.inspection_result || '—').toUpperCase()})</p></div>}
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">ODO reading (km)</span><p className="text-surface-900 tabular-nums">{detail.odometer_reading != null ? Number(detail.odometer_reading).toLocaleString() : '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Est. cost</span><p className="text-surface-900 tabular-nums">{detail.estimated_cost != null ? `R ${Number(detail.estimated_cost).toLocaleString()}` : '—'}</p></div>
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Actual cost</span><p className="text-surface-900 tabular-nums">{detail.actual_cost != null ? `R ${Number(detail.actual_cost).toLocaleString()}` : '—'}</p></div>
          </div>
          {detail.scope_of_work && (
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Scope of work</span><p className="text-surface-800 text-sm whitespace-pre-wrap mt-1">{detail.scope_of_work}</p></div>
          )}
          {detail.description && (
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Description</span><p className="text-surface-800 text-sm whitespace-pre-wrap mt-1">{detail.description}</p></div>
          )}
          {detail.completion_notes && (
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold">Completion notes</span><p className="text-surface-800 text-sm whitespace-pre-wrap mt-1">{detail.completion_notes}</p></div>
          )}
          <div className="text-xs text-surface-500">
            Created by {detail.created_by_name || '—'} · {formatDateTime(detail.created_at)}
            {detail.completed_at && <span> · Completed {formatDateTime(detail.completed_at)} by {detail.completed_by_name || '—'}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'schedule', label: 'Schedule & history' },
];

export default function FleetMaintenancePage() {
  const [tab, setTab] = useState('dashboard');
  const [dash, setDash] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);

  useEffect(() => {
    setDashLoading(true);
    api.dashboard().then(setDash).catch(() => setDash(null)).finally(() => setDashLoading(false));
    contractorApi.trucks.list().then((d) => setTrucks(d.trucks || [])).catch(() => setTrucks([]));
    contractorApi.drivers.list().then((d) => setDrivers(d.drivers || [])).catch(() => setDrivers([]));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Fleet maintenance</h1>
          <InfoHint
            title="Fleet maintenance"
            text="Schedule preventive, corrective, and emergency maintenance for trucks and trailers. The dashboard shows status counts, overdue items, upcoming jobs, and 90-day cost summaries. Use the Schedule & history tab to create, filter, and manage jobs. Export to PDF or Excel from the history view."
          />
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id
                ? 'bg-white text-brand-800 shadow-sm ring-1 ring-surface-200'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab dash={dash} loading={dashLoading} />}
      {tab === 'schedule' && <ScheduleHistoryTab trucks={trucks} drivers={drivers} />}
    </div>
  );
}
