import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { tracking as trackingApi } from '../../api';

const PROVIDER_TYPES = [
  { value: 'cartrack', label: 'Cartrack' },
  { value: 'fleetcam', label: 'FleetCam' },
  { value: 'netstar', label: 'Netstar / Nest Tar' },
  { value: 'mixtelematics', label: 'Mix Telematics' },
  { value: 'geotab', label: 'Geotab' },
  { value: 'custom_rest', label: 'Custom REST API' },
];

const FLEETCAM_DEFAULT_URL = 'https://track.fleetcamonline.com';

const EMPTY_FORM = {
  display_name: '',
  provider_type: 'fleetcam',
  api_base_url: FLEETCAM_DEFAULT_URL,
  api_key: '',
  api_secret: '',
  username: '',
};

export default function FleetIntegrationTab({ setError }) {
  const [providers, setProviders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [contractorTrucks, setContractorTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [vForm, setVForm] = useState({ provider_id: '', contractor_truck_id: '', truck_registration: '', external_vehicle_id: '' });
  const [fcBusy, setFcBusy] = useState(null);
  const [monitorBusyId, setMonitorBusyId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [p, v, ct] = await Promise.all([
        trackingApi.providers.list(),
        trackingApi.vehicles.list(),
        trackingApi.contractorTrucks.list().catch(() => ({ trucks: [] })),
      ]);
      setProviders(p.providers || []);
      setVehicles(v.vehicles || []);
      setContractorTrucks(ct.trucks || []);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const syncFromContractor = async () => {
    setSyncing(true);
    try {
      const r = await trackingApi.sync.contractorFleet();
      await load();
      alert(`Imported ${r.linked || 0} vehicle link(s). ${r.providersCreated || 0} new provider(s).`);
    } catch (err) {
      setError(err?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const addProvider = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form };
      if (body.provider_type === 'fleetcam') {
        body.api_base_url = body.api_base_url || FLEETCAM_DEFAULT_URL;
        if (!body.api_secret && body.api_key) body.api_secret = body.api_key;
      }
      await trackingApi.providers.create(body);
      setForm({ ...EMPTY_FORM });
      load();
    } catch (err) {
      setError(err?.message || 'Save failed');
    }
  };

  const addVehicle = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.vehicles.create({
        ...vForm,
        contractor_truck_id: vForm.contractor_truck_id || undefined,
      });
      setVForm({ provider_id: '', contractor_truck_id: '', truck_registration: '', external_vehicle_id: '' });
      load();
    } catch (err) {
      setError(err?.message || 'Link failed');
    }
  };

  const testFleetcam = async (providerId) => {
    setFcBusy(providerId);
    setError('');
    try {
      const r = await trackingApi.providers.fleetcam.test(providerId);
      alert(`FleetCam connected — ${r.device_count ?? 0} device(s) on account.`);
    } catch (err) {
      setError(err?.message || 'Connection test failed');
    } finally {
      setFcBusy(null);
    }
  };

  const autoLinkFleetcam = async (providerId) => {
    setFcBusy(`link-${providerId}`);
    setError('');
    try {
      const r = await trackingApi.providers.fleetcam.autoLink(providerId);
      await load();
      alert(`Auto-linked ${r.linked || 0} truck(s) by registration. ${r.skipped || 0} skipped (no Contractor match or already linked).`);
    } catch (err) {
      setError(err?.message || 'Auto-link failed');
    } finally {
      setFcBusy(null);
    }
  };

  const isFleetcamForm = form.provider_type === 'fleetcam';
  const fleetcamProviders = providers.filter((p) => p.provider_type === 'fleetcam');
  const monitoredCount = vehicles.filter((v) => !!v.monitor_enabled).length;

  const toggleVehicleMonitoring = async (vehicle) => {
    const next = !vehicle.monitor_enabled;
    const prev = !!vehicle.monitor_enabled;
    setMonitorBusyId(vehicle.id);
    setVehicles((list) => list.map((v) => (v.id === vehicle.id ? { ...v, monitor_enabled: next } : v)));
    setError('');
    try {
      await trackingApi.vehicles.update(vehicle.id, { monitor_enabled: next });
      await load({ silent: true });
    } catch (err) {
      setVehicles((list) => list.map((v) => (v.id === vehicle.id ? { ...v, monitor_enabled: prev } : v)));
      setError(err?.message || 'Failed to update monitoring');
    } finally {
      setMonitorBusyId(null);
    }
  };

  if (loading) return <p className="text-sm text-surface-500">Loading integrations…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Fleet integration</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
            Connect Cartrack, FleetCam, and other providers. FleetCam uses your{' '}
            <a href="https://track.fleetcamonline.com/objects" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">track.fleetcamonline.com</a>{' '}
            login. Match trucks on the{' '}
            <Link to="/contractor" className="text-brand-600 hover:underline">Contractor</Link> page by registration.
          </p>
        </div>
        <button type="button" onClick={syncFromContractor} disabled={syncing} className="rounded-lg border border-brand-600 text-brand-700 px-4 py-2 text-sm font-medium hover:bg-brand-50 disabled:opacity-50">
          {syncing ? 'Importing…' : 'Import from Contractor fleet'}
        </button>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={addProvider} className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold">Tracking provider</h2>
          <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Display name" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} required />
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            value={form.provider_type}
            onChange={(e) => {
              const pt = e.target.value;
              setForm((f) => ({
                ...f,
                provider_type: pt,
                api_base_url: pt === 'fleetcam' ? (f.api_base_url || FLEETCAM_DEFAULT_URL) : f.api_base_url,
              }));
            }}
          >
            {PROVIDER_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono text-xs dark:border-surface-700 dark:bg-surface-950"
            placeholder={isFleetcamForm ? 'https://track.fleetcamonline.com' : 'API base URL'}
            value={form.api_base_url}
            onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
          />
          {isFleetcamForm ? (
            <>
              <input
                type="email"
                className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                placeholder="FleetCam email (login)"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                autoComplete="username"
              />
              <input
                type="password"
                className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
                placeholder="FleetCam password"
                value={form.api_secret}
                onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))}
                autoComplete="new-password"
              />
              <p className="text-xs text-surface-500">Live GPS is polled every 60s from FleetCam after you link trucks by registration.</p>
            </>
          ) : (
            <>
              <input type="password" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="API key" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} autoComplete="off" />
              <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="Username (optional)" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </>
          )}
          <button type="submit" className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium">Add provider</button>
        </form>

        <form onSubmit={addVehicle} className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold">Link vehicle unit</h2>
          <select className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" value={vForm.provider_id} onChange={(e) => setVForm((f) => ({ ...f, provider_id: e.target.value }))} required>
            <option value="">— Provider —</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950"
            value={vForm.contractor_truck_id}
            onChange={(e) => {
              const id = e.target.value;
              const t = contractorTrucks.find((x) => x.id === id);
              setVForm((f) => ({ ...f, contractor_truck_id: id, truck_registration: t?.registration || f.truck_registration }));
            }}
          >
            <option value="">— Contractor truck —</option>
            {contractorTrucks.map((t) => (
              <option key={t.id} value={t.id}>{t.registration}{t.contractor_name ? ` · ${t.contractor_name}` : ''}</option>
            ))}
          </select>
          <input className="w-full rounded-lg border px-3 py-2 text-sm uppercase dark:border-surface-700 dark:bg-surface-950" placeholder="Registration" value={vForm.truck_registration} onChange={(e) => setVForm((f) => ({ ...f, truck_registration: e.target.value }))} required />
          <input className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" placeholder="External unit ID (FleetCam device id)" value={vForm.external_vehicle_id} onChange={(e) => setVForm((f) => ({ ...f, external_vehicle_id: e.target.value }))} />
          <button type="submit" className="rounded-lg border border-brand-600 text-brand-700 px-4 py-2 text-sm font-medium">Link unit</button>
        </form>
      </div>

      {fleetcamProviders.length > 0 && (
        <section className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold">FleetCam accounts</h2>
          {fleetcamProviders.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-100 dark:border-surface-800 px-3 py-2">
              <div>
                <p className="text-sm font-medium">{p.display_name}</p>
                <p className="text-xs text-surface-500 font-mono">{p.api_base_url || FLEETCAM_DEFAULT_URL} · {p.username || 'no email'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={fcBusy === p.id} onClick={() => testFleetcam(p.id)} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50">
                  {fcBusy === p.id ? 'Testing…' : 'Test connection'}
                </button>
                <button type="button" disabled={fcBusy === `link-${p.id}`} onClick={() => autoLinkFleetcam(p.id)} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                  {fcBusy === `link-${p.id}` ? 'Linking…' : 'Auto-link by registration'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-semibold bg-surface-50 dark:bg-surface-900">
          Linked units ({vehicles.length}) · Monitored: {monitoredCount}
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-surface-500">
            <tr>
              <th className="text-left px-4 py-2">Registration</th>
              <th className="text-left px-4 py-2">Provider</th>
              <th className="text-left px-4 py-2">External ID</th>
              <th className="text-left px-4 py-2">Contractor</th>
              <th className="text-left px-4 py-2">Monitoring</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-surface-100 dark:border-surface-800">
                <td className="px-4 py-2 font-semibold">{v.truck_registration}</td>
                <td className="px-4 py-2">{v.provider_name}</td>
                <td className="px-4 py-2 font-mono text-xs">{v.external_vehicle_id || '—'}</td>
                <td className="px-4 py-2 text-surface-600">{v.contractor_company_name || '—'}</td>
                <td className="px-4 py-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!v.monitor_enabled}
                      disabled={monitorBusyId === v.id}
                      onChange={() => toggleVehicleMonitoring(v)}
                      className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                    />
                    <span className="text-xs text-surface-600">{v.monitor_enabled ? 'Monitored' : 'Excluded'}</span>
                  </label>
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-surface-500">No units linked. Add a FleetCam provider, then auto-link or link manually.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
