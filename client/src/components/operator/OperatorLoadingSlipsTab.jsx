import { useCallback, useEffect, useState } from 'react';
import { operatorManagement as opMgmt } from '../../api';
import InfoHint from '../InfoHint.jsx';
import FuelSlipAiCameraModal from '../FuelSlipAiCameraModal.jsx';

const inputClass =
  'w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100';

function stageLabel(stage) {
  const map = {
    scheduled: 'Scheduled',
    at_loading: 'At loading',
    enroute: 'En route',
  };
  return map[stage] || stage || '—';
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function emptyConfirmForm(driverName = '') {
  return {
    loading_slip_no: '',
    driver_name: driverName,
    tons_loaded: '',
    loaded_at: '',
    notes: '',
  };
}

export default function OperatorLoadingSlipsTab({ user, onError }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState(() => emptyConfirmForm(user?.full_name || ''));
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    onError('');
    opMgmt.loadingSlips
      .assignments()
      .then((d) => setAssignments(d.assignments || []))
      .catch((e) => {
        setAssignments([]);
        onError(e?.message || 'Could not load your trucks');
      })
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const openTruck = (item) => {
    setSelected(item);
    setSuccessMsg('');
    setConfirmOpen(false);
    setForm({
      loading_slip_no: item.loading_slip_no || '',
      driver_name: item.driver_name || user?.full_name || '',
      tons_loaded: item.tons_loaded != null ? String(item.tons_loaded) : '',
      loaded_at: '',
      notes: item.loading_notes && item.loading_notes !== 'Awaiting loading slip' ? item.loading_notes : '',
    });
  };

  const runParseFile = async (file) => {
    if (!file) return;
    setParsing(true);
    onError('');
    try {
      const fd = new FormData();
      fd.append('slip', file);
      const res = await opMgmt.loadingSlips.parse(fd);
      const ex = res.extracted || {};
      if (ex.parse_error) {
        onError('Could not read the slip clearly — please enter details manually.');
      }
      setForm((prev) => ({
        ...prev,
        loading_slip_no: ex.loading_slip_no || prev.loading_slip_no,
        driver_name: ex.driver_name || prev.driver_name || user?.full_name || '',
        tons_loaded: ex.tons_loaded != null ? String(ex.tons_loaded) : prev.tons_loaded,
        loaded_at: toDatetimeLocal(ex.loaded_at) || prev.loaded_at,
        notes: ex.notes || prev.notes,
      }));
      setCameraOpen(false);
      setConfirmOpen(true);
    } catch (e) {
      onError(e?.message || 'Could not read slip');
    } finally {
      setParsing(false);
    }
  };

  const submitSlip = async (e) => {
    e.preventDefault();
    if (!selected?.trip_id) return;
    if (!form.loading_slip_no?.trim()) {
      onError('Loading slip number is required');
      return;
    }
    setSubmitting(true);
    onError('');
    try {
      await opMgmt.loadingSlips.submit(selected.trip_id, {
        loading_slip_no: form.loading_slip_no.trim(),
        driver_name: form.driver_name?.trim() || user?.full_name,
        tons_loaded: form.tons_loaded !== '' ? Number(form.tons_loaded) : null,
        loaded_at: form.loaded_at ? new Date(form.loaded_at).toISOString() : null,
        notes: form.notes?.trim() || null,
      });
      setSuccessMsg(`Loading slip saved for ${selected.truck_registration}`);
      setConfirmOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      onError(err?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { setSelected(null); setConfirmOpen(false); setSuccessMsg(''); }}
          className="text-sm text-brand-600 hover:underline"
        >
          ← Back to my trucks
        </button>

        <div className="app-glass-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">{selected.truck_registration}</h2>
              <p className="text-sm text-surface-500">{selected.route_name || 'Route TBC'}</p>
            </div>
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
              {stageLabel(selected.activity_stage)}
            </span>
          </div>
          <div className="text-sm text-surface-600 dark:text-surface-300 space-y-1">
            <p><span className="text-surface-400">Load at:</span> {selected.loading_address || '—'}</p>
            <p><span className="text-surface-400">Destination:</span> {selected.destination_address || '—'}</p>
            <p><span className="text-surface-400">Scheduled:</span> {formatWhen(selected.scheduled_at)}</p>
          </div>
          {selected.loading_slip_no && (
            <p className="text-sm text-brand-700 dark:text-brand-300">
              Current slip: {selected.loading_slip_no}
              {selected.tons_loaded != null ? ` · ${selected.tons_loaded} t` : ''}
            </p>
          )}
        </div>

        {!confirmOpen ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex-1 px-4 py-3 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
            >
              Scan loading slip
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="flex-1 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 text-sm font-medium hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              Enter manually
            </button>
            <label className="flex-1 px-4 py-3 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 text-sm font-medium text-center cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800">
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={parsing}
                onChange={(e) => runParseFile(e.target.files?.[0]).finally(() => { e.target.value = ''; })}
              />
            </label>
          </div>
        ) : (
          <form onSubmit={submitSlip} className="app-glass-card p-4 space-y-4">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Confirm loading slip details</h3>
            <p className="text-xs text-surface-500">Check the values read from your slip and edit anything that looks wrong.</p>
            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Loading slip number *</span>
              <input className={`${inputClass} mt-1`} required value={form.loading_slip_no} onChange={(e) => setForm((f) => ({ ...f, loading_slip_no: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Driver name</span>
              <input className={`${inputClass} mt-1`} value={form.driver_name} onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Tons loaded</span>
              <input className={`${inputClass} mt-1`} type="number" step="0.001" value={form.tons_loaded} onChange={(e) => setForm((f) => ({ ...f, tons_loaded: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Date & time loaded</span>
              <input className={`${inputClass} mt-1`} type="datetime-local" value={form.loaded_at} onChange={(e) => setForm((f) => ({ ...f, loaded_at: e.target.value }))} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Remarks</span>
              <textarea className={`${inputClass} mt-1`} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600">
                Back
              </button>
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-medium disabled:opacity-50">
                {submitting ? 'Saving…' : 'Confirm & submit'}
              </button>
            </div>
          </form>
        )}

        <FuelSlipAiCameraModal
          open={cameraOpen}
          busy={parsing}
          onClose={() => setCameraOpen(false)}
          onCapture={runParseFile}
          title="Scan loading slip"
          subtitle="Hold the slip flat in good light. We will read slip number, driver, tons, and date/time."
          captureLabel="Capture & read slip"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">My loading assignments</h1>
        <InfoHint
          title="Loading slips"
          text="Trucks scheduled for you (by driver name or linked truck). Open a truck, scan the loading slip, confirm the details, and submit — it appears on Logistics Activity for controllers."
        />
        <button type="button" onClick={load} className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800">
          Refresh
        </button>
      </div>

      {successMsg && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          {successMsg}
        </p>
      )}

      <p className="text-sm text-surface-500">
        Signed in as <span className="font-medium text-surface-700 dark:text-surface-200">{user?.full_name || '—'}</span>
        . Trucks must be linked to your driver name on the Contractor page.
      </p>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="app-glass-card p-8 text-center text-surface-500">
          <p className="font-medium text-surface-700 dark:text-surface-300">No trucks scheduled for you right now</p>
          <p className="text-sm mt-2">When a truck is scheduled and linked to your name, it will show here.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {assignments.map((item) => (
            <button
              key={item.trip_id}
              type="button"
              onClick={() => openTruck(item)}
              className="app-glass-card p-4 text-left hover:ring-2 hover:ring-brand-400/60 transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-bold text-surface-900 dark:text-surface-50">{item.truck_registration}</p>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300">
                  {stageLabel(item.activity_stage)}
                </span>
              </div>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">{item.route_name || '—'}</p>
              <p className="text-xs text-surface-500 mt-2 line-clamp-2">{item.loading_address || 'Loading point TBC'}</p>
              {item.loading_slip_deferred && !item.loading_slip_no && (
                <span className="inline-block mt-2 text-[10px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  Slip still needed
                </span>
              )}
              {item.loading_slip_no && (
                <p className="text-xs text-brand-700 dark:text-brand-300 mt-2">Slip {item.loading_slip_no}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
