import { useState, useEffect, useCallback, useRef } from 'react';
import { contractor as contractorApi } from '../api';
import { loadExcelJS } from '../lib/lazyExceljs.js';
import { formatTruckRegistration } from '../lib/truckKey.js';

const TEMPLATE_HEADERS = ['Fleet number', 'Truck registration', 'Trailer 1', 'Trailer 2'];

function mapHeaderToField(header) {
  const h = String(header || '').trim().toLowerCase();
  if (h.includes('fleet')) return 'fleet_no';
  if (h.includes('trailer 1') || h === 'trailer1') return 'trailer_1_reg_no';
  if (h.includes('trailer 2') || h === 'trailer2') return 'trailer_2_reg_no';
  if (h.includes('registration') || h.includes('reg no') || h === 'truck') return 'registration';
  return null;
}

export default function RectorAcceptedTrucksPanel({ routes = [] }) {
  const [routeId, setRouteId] = useState('');
  const [loading, setLoading] = useState(false);
  const [trucks, setTrucks] = useState([]);
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ fleet_no: '', registration: '', trailer_1_reg_no: '', trailer_2_reg_no: '' });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!routeId) { setTrucks([]); setSettings(null); return; }
    setLoading(true);
    setError('');
    try {
      const r = await contractorApi.rectorAcceptance.list(routeId);
      setTrucks(r.trucks || []);
      setSettings(r.settings || null);
    } catch (e) {
      setError(e?.message || 'Failed to load accepted trucks');
      setTrucks([]);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 4000); };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!routeId || !form.registration.trim()) return;
    setAdding(true);
    setError('');
    try {
      await contractorApi.rectorAcceptance.add({ routeId, ...form });
      setForm({ fleet_no: '', registration: '', trailer_1_reg_no: '', trailer_2_reg_no: '' });
      flash('Truck added to accepted list.');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to add truck');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await contractorApi.rectorAcceptance.remove(id);
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to remove truck');
    }
  };

  const saveSettings = async (patch) => {
    if (!routeId || !settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    try {
      const r = await contractorApi.rectorAcceptance.saveSettings(routeId, next);
      if (r.settings) setSettings(r.settings);
    } catch (e) {
      setError(e?.message || 'Failed to save settings');
      await load();
    } finally {
      setSavingSettings(false);
    }
  };

  const downloadTemplate = async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Accepted trucks');
    ws.addRow(TEMPLATE_HEADERS);
    ws.getRow(1).font = { bold: true };
    ws.addRow(['FL-001', 'MK20DDGP', 'TR1ABCGP', 'TR2ABCGP']);
    ws.columns = TEMPLATE_HEADERS.map(() => ({ width: 22 }));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'accepted-trucks-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !routeId) return;
    setImporting(true);
    setError('');
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('No worksheet found in file');
      const headerRow = ws.getRow(1);
      const colMap = {};
      headerRow.eachCell((cell, col) => {
        const field = mapHeaderToField(cell.value);
        if (field) colMap[col] = field;
      });
      if (!Object.values(colMap).includes('registration')) {
        throw new Error('Could not find a "Truck registration" column. Use the template.');
      }
      const rows = [];
      ws.eachRow((row, idx) => {
        if (idx === 1) return;
        const rec = {};
        row.eachCell((cell, col) => {
          const field = colMap[col];
          if (field) rec[field] = cell.value != null ? String(cell.value.text ?? cell.value).trim() : '';
        });
        if (rec.registration) rows.push(rec);
      });
      if (rows.length === 0) throw new Error('No rows with a registration were found.');
      const r = await contractorApi.rectorAcceptance.bulkAdd(routeId, rows);
      flash(`Imported ${r.added} truck(s)${r.skipped ? `, ${r.skipped} skipped (duplicate/blank)` : ''}.`);
      if (r.errors?.length) setError(`Some rows failed: ${r.errors.slice(0, 3).join('; ')}`);
      await load();
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const filtered = trucks.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.registration, t.fleet_no, t.trailer_1_reg_no, t.trailer_2_reg_no].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const Toggle = ({ checked, onChange, label, hint }) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 rounded border-surface-300 text-brand-600" />
      <span>
        <span className="text-sm text-surface-800">{label}</span>
        {hint ? <span className="block text-xs text-surface-400">{hint}</span> : null}
      </span>
    </label>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-surface-900">Accepted trucks</h3>
        <p className="text-sm text-surface-500 mt-1 max-w-3xl">
          Add or import the trucks you have accepted on a route. The contractor can only enroll trucks that match this list,
          verified against the fields you choose below. Trucks not on the list are blocked, and the contractor is prompted to request your acceptance.
        </p>
      </div>

      {routes.length === 0 ? (
        <p className="text-sm text-surface-500">No routes assigned to you yet.</p>
      ) : (
        <div className="app-glass-card p-4 max-w-md">
          <label className="block text-sm font-medium text-surface-700 mb-1">Route</label>
          <select
            value={routeId}
            onChange={(e) => { setRouteId(e.target.value); setSearch(''); setError(''); }}
            className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm"
          >
            <option value="">Choose a route…</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name || 'Unnamed route'}</option>)}
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{notice}</p>}

      {routeId && settings && (
        <div className="app-glass-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-surface-900">Verification settings</h4>
            {savingSettings && <span className="text-xs text-surface-400">Saving…</span>}
          </div>
          <p className="text-xs text-surface-500">Choose what the system checks when a contractor enrols a truck. A clear message tells them which field caused a rejection.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle checked={settings.verify_registration} onChange={(v) => saveSettings({ verify_registration: v })} label="Verify registration" />
            <Toggle checked={settings.verify_fleet_no} onChange={(v) => saveSettings({ verify_fleet_no: v })} label="Verify fleet number" />
            <Toggle checked={settings.verify_trailer_1} onChange={(v) => saveSettings({ verify_trailer_1: v })} label="Verify trailer 1" />
            <Toggle checked={settings.verify_trailer_2} onChange={(v) => saveSettings({ verify_trailer_2: v })} label="Verify trailer 2" />
          </div>
          <div className="border-t border-surface-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle
              checked={settings.enforce_acceptance}
              onChange={(v) => saveSettings({ enforce_acceptance: v })}
              label="Enforce acceptance for enrollment"
              hint="When off, the contractor can enrol any approved truck on this route (no rector check)."
            />
            <Toggle
              checked={settings.notify_email_enabled}
              onChange={(v) => saveSettings({ notify_email_enabled: v })}
              label="Email me acceptance requests"
              hint="Turn off to stop emails from contractors requesting acceptance."
            />
          </div>
        </div>
      )}

      {routeId && (
        <div className="app-glass-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-surface-900">Add a truck</h4>
            <div className="flex items-center gap-2">
              <button type="button" onClick={downloadTemplate} className="px-3 py-1.5 text-sm rounded-lg border border-surface-200 text-surface-700 hover:bg-surface-50">
                Download template
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="px-3 py-1.5 text-sm rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                {importing ? 'Importing…' : 'Import from Excel'}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
            </div>
          </div>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
            <div>
              <label className="block text-xs text-surface-500 mb-1">Fleet number</label>
              <input value={form.fleet_no} onChange={(e) => setForm((f) => ({ ...f, fleet_no: e.target.value }))} className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Registration *</label>
              <input value={form.registration} onChange={(e) => setForm((f) => ({ ...f, registration: e.target.value }))} required className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Trailer 1</label>
              <input value={form.trailer_1_reg_no} onChange={(e) => setForm((f) => ({ ...f, trailer_1_reg_no: e.target.value }))} className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">Trailer 2</label>
              <input value={form.trailer_2_reg_no} onChange={(e) => setForm((f) => ({ ...f, trailer_2_reg_no: e.target.value }))} className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={adding || !form.registration.trim()} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
          <p className="text-xs text-surface-400">Spaces in registrations are removed automatically (e.g. “MK 20 DD GP” → “MK20DDGP”).</p>
        </div>
      )}

      {routeId && (
        <div className="app-glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-200 bg-surface-50/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold text-surface-900">Accepted trucks on this route</h4>
              <p className="text-xs text-surface-500 mt-0.5 tabular-nums">{filtered.length} of {trucks.length}</p>
            </div>
            <input type="search" placeholder="Search registration, fleet, trailer…" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm w-64 max-w-full" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                  <th className="px-3 py-2 font-semibold">Registration</th>
                  <th className="px-3 py-2 font-semibold">Fleet no.</th>
                  <th className="px-3 py-2 font-semibold">Trailer 1</th>
                  <th className="px-3 py-2 font-semibold">Trailer 2</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Accepted by</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">{trucks.length === 0 ? 'No accepted trucks yet. Add or import trucks above.' : 'No trucks match your search.'}</td></tr>
                ) : filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-50/60">
                    <td className="px-3 py-2 font-medium text-surface-900 whitespace-nowrap">{formatTruckRegistration(t.registration) || '—'}</td>
                    <td className="px-3 py-2 text-surface-700">{t.fleet_no || '—'}</td>
                    <td className="px-3 py-2 text-surface-700 whitespace-nowrap">{formatTruckRegistration(t.trailer_1_reg_no) || '—'}</td>
                    <td className="px-3 py-2 text-surface-700 whitespace-nowrap">{formatTruckRegistration(t.trailer_2_reg_no) || '—'}</td>
                    <td className="px-3 py-2 text-surface-500 capitalize">{t.source || 'manual'}</td>
                    <td className="px-3 py-2 text-surface-600">{t.accepted_by_name || '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => handleDelete(t.id)} className="text-red-600 hover:text-red-700 text-xs">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
