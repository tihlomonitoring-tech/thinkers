import { useState, useEffect, useCallback } from 'react';
import { todayYmd } from './lib/appTime.js';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { tracking as trackingApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import FleetLiveMap from './components/FleetLiveMap.jsx';

const TABS = [
  { id: 'vehicles', label: 'Vehicle integration', section: 'Integrations' },
  { id: 'weighbridge', label: 'Weighbridge integration', section: 'Integrations' },
  { id: 'movement', label: 'Fleet movement', section: 'Operations' },
  { id: 'settings', label: 'Settings', section: 'Configuration' },
  { id: 'deliveries', label: 'Delivery records', section: 'Reports' },
  { id: 'alarms', label: 'Alarm records', section: 'Reports' },
];

const SECTIONS = [...new Set(TABS.map((t) => t.section))];

/** Values stored in tracking_integration_provider.provider_type; extend when adding real connectors. */
const PROVIDER_TYPES = [
  { value: 'bitrack', label: 'Bitrack' },
  { value: 'car_track', label: 'Car Track' },
  { value: 'cartrack', label: 'Cartrack' },
  { value: 'ctrack', label: 'Ctrack' },
  { value: 'fleetcam', label: 'FleetCam' },
  { value: 'geotab', label: 'Geotab' },
  { value: 'mixtelematics', label: 'Mix Telematics' },
  { value: 'netstar', label: 'Netstar / Nestar' },
  { value: 'tracker', label: 'Tracker' },
  { value: 'custom_rest', label: 'Custom (REST API)' },
];

const ALARM_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'overspeed', label: 'Overspeed' },
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'harsh_accel', label: 'Harsh acceleration' },
  { value: 'seatbelt', label: 'Seatbelt violation' },
  { value: 'deviation', label: 'Route deviation' },
  { value: 'geofence', label: 'Geofence breach' },
  { value: 'idle', label: 'Excessive idle' },
  { value: 'overdue', label: 'Overdue delivery' },
];

const FENCE_TYPES = [
  { value: 'deviation', label: 'Deviation corridor' },
  { value: 'no_stop', label: 'No-stop zone' },
  { value: 'hazard', label: 'Hazard / buffer' },
  { value: 'destination', label: 'Destination geofence' },
];

/** Shown in UI + documented in docs/TRACKING-INTEGRATION-ROADMAP.md */
const TRACKING_FOLLOWUPS = [
  'Real telematics / weighbridge polling or webhooks (background jobs).',
  'Map (Mapbox / Leaflet) using route and geofence coordinates.',
  'Encrypt API secrets at rest (e.g. Azure Key Vault).',
  'Provider connectors: Car Track, Cartrack, FleetCam, Nestar / Netstar, Tracker, Bitrack, Ctrack — plus Mix Telematics, Geotab, and custom REST as needed.',
];

function formatDt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function downloadCsv(filename, rows, headers) {
  const esc = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const line = (r) => (Array.isArray(r) ? r : headers.map((h) => r[h])).map(esc).join(',');
  const csv = [headers.join(','), ...rows.map(line)].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function TrackingIntegration() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('tracking-integration');
  const [tab, setTab] = useState('movement');
  useAutoHideNavAfterTabChange(tab);
  const [error, setError] = useState('');
  const [migrationHint, setMigrationHint] = useState('');

  useEffect(() => {
    trackingApi
      .dashboard()
      .then((d) => {
        if (d.migration_required && d.migration_hint) setMigrationHint(d.migration_hint);
        else setMigrationHint('');
      })
      .catch((e) => {
        const m = e?.message || '';
        if (/Invalid object name|not installed|503/i.test(m)) {
          setMigrationHint('Run: npm run db:tracking-setup (then restart the API).');
        }
      });
  }, [tab]);

  return (
    <div className="flex gap-0 w-full min-h-0 flex-1 -m-4 sm:-m-6 overflow-hidden">
      <nav
        className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Tracking and integration"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Tracking & integration</h2>
            <p className="text-xs text-surface-500 mt-0.5">Providers, weighbridges, live fleet & alarms</p>
            {user?.tenant_name && (
              <p className="text-xs text-surface-500 mt-1">
                Tenant: <strong className="text-surface-700">{user.tenant_name}</strong>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100"
            aria-label="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          {SECTIONS.map((section) => (
            <div key={section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">{section}</p>
              <ul className="space-y-0.5">
                {TABS.filter((t) => t.section === section).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                        tab === t.id
                          ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                          : 'text-surface-600 hover:bg-surface-50 border-l-2 border-l-transparent'
                      }`}
                    >
                      <span className="min-w-0 break-words">{t.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 flex flex-col bg-surface-50/80">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}

        <div className="w-full max-w-[1600px] mx-auto flex-1 min-w-0">
          {migrationHint && (
            <div className="mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
              <p className="font-semibold">Tracking tables are not installed on the database yet.</p>
              <p className="text-amber-800/90 text-xs leading-relaxed">{migrationHint}</p>
              <p className="text-xs text-amber-700">
                Command: <code className="bg-white/80 px-1 rounded font-mono">npm run db:tracking-setup</code> then restart the API.
              </p>
            </div>
          )}
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button type="button" className="text-red-600 hover:underline" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}

          {tab === 'vehicles' && <TabVehicleIntegration setError={setError} />}
          {tab === 'weighbridge' && <TabWeighbridge setError={setError} />}
          {tab === 'movement' && <TabFleetMovement setError={setError} />}
          {tab === 'settings' && <TabSettings setError={setError} />}
          {tab === 'deliveries' && <TabDeliveryRecords setError={setError} />}
          {tab === 'alarms' && <TabAlarmRecords setError={setError} />}
        </div>
      </div>
    </div>
  );
}

function TabVehicleIntegration({ setError }) {
  const [providers, setProviders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [contractorTrucks, setContractorTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ display_name: '', provider_type: 'mixtelematics', api_base_url: '', api_key: '', api_secret: '', username: '' });
  const [vForm, setVForm] = useState({ provider_id: '', contractor_truck_id: '', truck_registration: '', external_vehicle_id: '', fleet_no: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, []);

  const addProvider = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.providers.create(form);
      setForm({ display_name: '', provider_type: 'mixtelematics', api_base_url: '', api_key: '', api_secret: '', username: '' });
      load();
    } catch (err) {
      setError(err?.message || 'Save failed');
    }
  };

  const addVehicle = async (e) => {
    e.preventDefault();
    if (!vForm.provider_id || !vForm.truck_registration) {
      setError('Select provider and enter registration');
      return;
    }
    try {
      await trackingApi.vehicles.create({
        ...vForm,
        contractor_truck_id: vForm.contractor_truck_id || undefined,
      });
      setVForm({ ...vForm, contractor_truck_id: '', truck_registration: '', external_vehicle_id: '', fleet_no: '', notes: '' });
      load();
    } catch (err) {
      setError(err?.message || 'Save failed');
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Vehicle integration</h1>
          <p className="text-surface-600 mt-1 max-w-3xl">
            Connect telematics providers with API credentials. Link vehicles by registration or pick a truck from your{' '}
            <Link to="/contractor" className="text-brand-600 font-medium hover:underline">
              Contractor
            </Link>{' '}
            fleet (same tenant).
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-dashed border-surface-300 bg-surface-50/80 p-5 text-sm text-surface-700">
        <h2 className="text-sm font-semibold text-surface-900 mb-2">Follow-ups you may want later</h2>
        <ul className="list-disc pl-5 space-y-1.5 text-surface-600 leading-relaxed">
          {TRACKING_FOLLOWUPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-surface-500">
          See <code className="bg-white px-1 rounded border border-surface-200">docs/TRACKING-INTEGRATION-ROADMAP.md</code> in the repo for the full roadmap.
        </p>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-surface-900 mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-700 text-sm font-bold">1</span>
            Tracking providers
          </h2>
          <form onSubmit={addProvider} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Display name</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="e.g. Main fleet — Mix"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Provider</label>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.provider_type}
                onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
              >
                {PROVIDER_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">API base URL</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono text-xs"
                value={form.api_base_url}
                onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
                placeholder="https://api.provider.com/v1"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-surface-500 uppercase mb-1">API key</label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 uppercase mb-1">API secret / password</label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={form.api_secret}
                  onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Username (optional)</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
              Add provider
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-surface-900 mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 text-sm font-bold">2</span>
            Link vehicles
          </h2>
          <form onSubmit={addVehicle} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Provider</label>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={vForm.provider_id}
                onChange={(e) => setVForm((f) => ({ ...f, provider_id: e.target.value }))}
                required
              >
                <option value="">— Select —</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} ({p.provider_type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Contractor fleet truck (optional)</label>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={vForm.contractor_truck_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const t = contractorTrucks.find((x) => x.id === id);
                  setVForm((f) => ({
                    ...f,
                    contractor_truck_id: id,
                    truck_registration: t ? (t.registration || '') : f.truck_registration,
                    fleet_no: t ? (t.fleet_no || f.fleet_no) : f.fleet_no,
                  }));
                }}
              >
                <option value="">— Type registration manually below —</option>
                {contractorTrucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.registration}
                    {t.fleet_no ? ` · ${t.fleet_no}` : ''}
                    {t.contractor_name ? ` · ${t.contractor_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Truck registration</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm uppercase"
                value={vForm.truck_registration}
                onChange={(e) => setVForm((f) => ({ ...f, truck_registration: e.target.value }))}
                required={!vForm.contractor_truck_id}
                placeholder="Required if no contractor truck selected"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-surface-500 uppercase mb-1">External vehicle ID</label>
                <input
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={vForm.external_vehicle_id}
                  onChange={(e) => setVForm((f) => ({ ...f, external_vehicle_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Fleet no.</label>
                <input
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={vForm.fleet_no}
                  onChange={(e) => setVForm((f) => ({ ...f, fleet_no: e.target.value }))}
                />
              </div>
            </div>
            <button type="submit" className="rounded-lg border border-brand-600 text-brand-700 px-4 py-2.5 text-sm font-medium hover:bg-brand-50">
              Link vehicle
            </button>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-3 border-b border-surface-100 bg-surface-50/80 flex justify-between items-center">
          <h3 className="font-semibold text-surface-900">Configured providers</h3>
          {loading && <span className="text-xs text-surface-500">Loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">API key</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {providers.map((p) => (
                <tr key={p.id} className="hover:bg-surface-50/50">
                  <td className="px-4 py-3 font-medium">{p.display_name}</td>
                  <td className="px-4 py-3 text-surface-600">{p.provider_type}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.api_key_set ? p.api_key_masked : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-red-600 hover:underline text-xs"
                      onClick={async () => {
                        if (!confirm('Delete this provider?')) return;
                        try {
                          await trackingApi.providers.delete(p.id);
                          load();
                        } catch (err) {
                          setError(err?.message);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-3 border-b border-surface-100 bg-surface-50/80">
          <h3 className="font-semibold text-surface-900">Linked vehicles</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500">
              <tr>
                <th className="px-4 py-3">Registration</th>
                <th className="px-4 py-3">Contractor</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">External ID</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-3 font-mono font-medium">{v.truck_registration}</td>
                  <td className="px-4 py-3 text-surface-600 text-sm">{v.contractor_company_name || '—'}</td>
                  <td className="px-4 py-3">{v.provider_name}</td>
                  <td className="px-4 py-3 text-surface-600">{v.external_vehicle_id || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-red-600 hover:underline text-xs"
                      onClick={async () => {
                        if (!confirm('Unlink this vehicle?')) return;
                        try {
                          await trackingApi.vehicles.delete(v.id);
                          load();
                        } catch (err) {
                          setError(err?.message);
                        }
                      }}
                    >
                      Unlink
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TabWeighbridge({ setError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    colliery_name: '',
    site_code: '',
    api_endpoint: 'https://',
    api_key: '',
    auth_type: 'api_key',
    extra_json: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await trackingApi.weighbridges.list();
      setRows(d.weighbridges || []);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.weighbridges.create(form);
      setForm({ colliery_name: '', site_code: '', api_endpoint: 'https://', api_key: '', auth_type: 'api_key', extra_json: '' });
      load();
    } catch (err) {
      setError(err?.message || 'Failed');
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-surface-900">Weighbridge integration</h1>
        <p className="text-surface-600 mt-1 max-w-3xl">
          Register each colliery weighbridge with its API endpoint and credentials. Use for automatic gross weight capture and trip start signals.
        </p>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1 rounded-2xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-surface-900 mb-4">Add weighbridge</h2>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Colliery name</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.colliery_name}
                onChange={(e) => setForm((f) => ({ ...f, colliery_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Site code</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.site_code}
                onChange={(e) => setForm((f) => ({ ...f, site_code: e.target.value }))}
                placeholder="e.g. WB-01"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">API endpoint</label>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono text-xs"
                value={form.api_endpoint}
                onChange={(e) => setForm((f) => ({ ...f, api_endpoint: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Auth type</label>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.auth_type}
                onChange={(e) => setForm((f) => ({ ...f, auth_type: e.target.value }))}
              >
                <option value="api_key">API key</option>
                <option value="bearer">Bearer token</option>
                <option value="basic">Basic auth</option>
                <option value="oauth2">OAuth2</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">API key / token</label>
              <input
                type="password"
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 uppercase mb-1">Extra JSON (headers, tenant id)</label>
              <textarea
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-xs font-mono"
                rows={3}
                value={form.extra_json}
                onChange={(e) => setForm((f) => ({ ...f, extra_json: e.target.value }))}
                placeholder='{"header_X_Tenant": "..."}'
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
              Save weighbridge
            </button>
          </form>
        </section>

        <section className="lg:col-span-2 rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-3 border-b border-surface-100 flex justify-between items-center">
            <h3 className="font-semibold text-surface-900">Colliery weighbridges</h3>
            {loading && <span className="text-xs text-surface-500">Loading…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500">
                <tr>
                  <th className="px-4 py-3">Colliery</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Endpoint</th>
                  <th className="px-4 py-3">Auth</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {rows.map((w) => (
                  <tr key={w.id} className="hover:bg-surface-50/50">
                    <td className="px-4 py-3 font-medium">{w.colliery_name}</td>
                    <td className="px-4 py-3">{w.site_code || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate" title={w.api_endpoint}>
                      {w.api_endpoint}
                    </td>
                    <td className="px-4 py-3">{w.auth_type}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs"
                        onClick={async () => {
                          if (!confirm('Delete?')) return;
                          try {
                            await trackingApi.weighbridges.delete(w.id);
                            load();
                          } catch (err) {
                            setError(err?.message);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function TabFleetMovement({ setError }) {
  const [dash, setDash] = useState(null);
  const [trips, setTrips] = useState([]);
  const [wb, setWb] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [contractorTrucks, setContractorTrucks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [liveOn, setLiveOn] = useState(false);
  const [selected, setSelected] = useState(null);
  const [newTrip, setNewTrip] = useState({
    contractor_truck_id: '',
    truck_registration: '',
    weighbridge_id: '',
    route_id: '',
    collection_point_name: '',
    destination_name: '',
  });

  const load = useCallback(async () => {
    try {
      const [d, t, w, r, ct] = await Promise.all([
        trackingApi.dashboard(),
        trackingApi.trips.list({ status: filter === 'all' ? undefined : filter }),
        trackingApi.weighbridges.list(),
        trackingApi.routes.list(),
        trackingApi.contractorTrucks.list().catch(() => ({ trucks: [] })),
      ]);
      setDash(d);
      setTrips(t.trips || []);
      setWb(w.weighbridges || []);
      setRoutes(r.routes || []);
      setContractorTrucks(ct.trucks || []);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    }
  }, [filter, setError]);

  useEffect(() => {
    load();
  }, [load]);

  /** Demo: nudge MOCK-* trip positions server-side, then refresh list (see npm run db:tracking-mock). */
  useEffect(() => {
    if (!liveOn) return;
    const run = async () => {
      try {
        await trackingApi.demo.tick();
        await load();
      } catch {
        /* ignore */
      }
    };
    run();
    const iv = setInterval(run, 6000);
    return () => clearInterval(iv);
  }, [liveOn, load]);

  const createTrip = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.trips.create({
        ...newTrip,
        contractor_truck_id: newTrip.contractor_truck_id || undefined,
      });
      setNewTrip({
        contractor_truck_id: '',
        truck_registration: '',
        weighbridge_id: '',
        route_id: '',
        collection_point_name: '',
        destination_name: '',
      });
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const activate = async (id) => {
    try {
      await trackingApi.trips.activateDelivery(id);
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const simTelemetry = async (trip) => {
    try {
      await trackingApi.trips.telemetry(trip.id, {
        lat: -26.1 + Math.random() * 0.05,
        lng: 28.0 + Math.random() * 0.05,
        speed_kmh: 40 + Math.floor(Math.random() * 80),
        heading_deg: 90,
      });
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const complete = async (trip) => {
    try {
      await trackingApi.trips.complete(trip.id, {});
      load();
      setSelected(null);
    } catch (err) {
      setError(err?.message);
    }
  };

  const logDeviation = async (trip) => {
    try {
      await trackingApi.trips.deviation(trip.id, { detail: 'Route deviation (manual)', lat: trip.last_lat, lng: trip.last_lng });
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const statusStyle = (s) => {
    const m = {
      pending: 'bg-amber-100 text-amber-900 border-amber-200',
      enroute: 'bg-cyan-100 text-cyan-900 border-cyan-200',
      deviated: 'bg-orange-100 text-orange-900 border-orange-200',
      completed: 'bg-emerald-100 text-emerald-900 border-emerald-200',
      overdue: 'bg-red-100 text-red-900 border-red-200',
      cancelled: 'bg-surface-200 text-surface-700 border-surface-300',
    };
    return m[s] || 'bg-surface-100 text-surface-800 border-surface-200';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Fleet movement</h1>
        <p className="text-surface-600 mt-1 max-w-3xl text-sm">
          Monitor trips from collection to destination. Choose a truck from the{' '}
          <Link to="/contractor" className="text-brand-600 font-medium hover:underline">
            Contractor
          </Link>{' '}
          fleet list or type a registration. When weighbridge, route and destination are set, use           <strong>Activate delivery</strong> to start ETA tracking (configure max en-route time under the <strong>Settings</strong> tab here).
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-surface-900">Live fleet map</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-surface-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                checked={liveOn}
                onChange={(e) => setLiveOn(e.target.checked)}
              />
              <span>
                Live updates <span className="text-surface-500">(demo: moves MOCK-* trips every 6s)</span>
              </span>
            </label>
            {liveOn && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                Live
              </span>
            )}
          </div>
        </div>
        <FleetLiveMap trips={trips} routes={routes} />
        <p className="text-xs text-surface-500">
          Demo data: run <code className="bg-surface-100 px-1 rounded">npm run db:tracking-mock</code> from the project root (three trucks on the JHB–PTA corridor). OpenStreetMap tiles.
        </p>
      </section>

      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-surface-900">Overview</h2>
        <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-surface-500 uppercase tracking-wider mr-1">Status</span>
          {['all', 'pending', 'enroute', 'overdue', 'completed'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filter === s ? 'bg-brand-50 text-brand-700 border-brand-400' : 'bg-surface-50 border-surface-200 text-surface-600 hover:bg-surface-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'En route', v: dash?.counts?.enroute ?? '—' },
            { label: 'Overdue', v: dash?.counts?.overdue ?? '—', warn: true },
            { label: 'Pending', v: dash?.counts?.pending ?? '—' },
            { label: 'Unacked alarms (24h)', v: dash?.counts?.unacked_alarms_24h ?? '—', alert: true },
          ].map((k) => (
            <div key={k.label} className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">{k.label}</p>
              <p
                className={`mt-1 text-2xl font-semibold text-surface-900 tabular-nums ${
                  k.warn ? 'text-red-600' : k.alert ? 'text-orange-600' : ''
                }`}
              >
                {k.v}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-surface-900 mb-3">New trip / delivery</h3>
            <form onSubmit={createTrip} className="space-y-2 text-sm">
              <div>
                <label className="block text-xs text-surface-500 mb-1">Contractor fleet (optional)</label>
                <select
                  className="w-full rounded-lg border border-surface-300 px-3 py-2"
                  value={newTrip.contractor_truck_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const tr = contractorTrucks.find((x) => x.id === id);
                    setNewTrip((t) => ({
                      ...t,
                      contractor_truck_id: id,
                      truck_registration: tr ? (tr.registration || '') : t.truck_registration,
                    }));
                  }}
                >
                  <option value="">— Select truck or enter registration —</option>
                  {contractorTrucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.registration}
                      {tr.fleet_no ? ` · ${tr.fleet_no}` : ''}
                      {tr.contractor_name ? ` · ${tr.contractor_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-surface-500 mb-1">Truck registration</label>
                <input
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 uppercase"
                  placeholder="e.g. ABC123GP"
                  value={newTrip.truck_registration}
                  onChange={(e) => setNewTrip((t) => ({ ...t, truck_registration: e.target.value }))}
                  required={!newTrip.contractor_truck_id}
                />
              </div>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2"
                value={newTrip.weighbridge_id}
                onChange={(e) => setNewTrip((t) => ({ ...t, weighbridge_id: e.target.value }))}
              >
                <option value="">Weighbridge (optional)</option>
                {wb.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.colliery_name}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-lg border border-surface-300 px-3 py-2"
                value={newTrip.route_id}
                onChange={(e) => setNewTrip((t) => ({ ...t, route_id: e.target.value }))}
              >
                <option value="">Monitor route (optional)</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2"
                placeholder="Collection point"
                value={newTrip.collection_point_name}
                onChange={(e) => setNewTrip((t) => ({ ...t, collection_point_name: e.target.value }))}
              />
              <input
                className="w-full rounded-lg border border-surface-300 px-3 py-2"
                placeholder="Destination"
                value={newTrip.destination_name}
                onChange={(e) => setNewTrip((t) => ({ ...t, destination_name: e.target.value }))}
              />
              <button type="submit" className="w-full rounded-lg bg-brand-600 text-white py-2 font-medium hover:bg-brand-700">
                Create trip
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 p-4 text-xs text-surface-600">
            <p className="font-semibold text-surface-800 mb-1">How activation works</p>
            <p className="leading-relaxed">
              Set <strong>weighbridge</strong>, <strong>route</strong>, and <strong>destination</strong> on the trip, then <strong>Activate delivery</strong>. The trip goes en route, ETA uses{' '}
              <em>Settings → max en-route minutes</em>, and deviations / overspeed feed <strong>Alarm records</strong>.
            </p>
          </div>
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex justify-between items-center">
            <h3 className="font-semibold text-surface-900">Active trips</h3>
            <button type="button" onClick={() => load()} className="text-sm text-brand-600 hover:underline">
              Refresh
            </button>
          </div>
          <div className="divide-y divide-surface-100 max-h-[560px] overflow-y-auto">
            {trips.length === 0 && <p className="p-8 text-center text-surface-500">No trips for this filter.</p>}
            {trips.map((trip) => (
              <div
                key={trip.id}
                className={`p-4 hover:bg-surface-50/80 cursor-pointer transition-colors ${selected?.id === trip.id ? 'bg-brand-50/50' : ''}`}
                onClick={() => setSelected(trip)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-surface-900">{trip.truck_registration}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${statusStyle(trip.status)}`}>{trip.status}</span>
                      {trip.is_overdue && <span className="text-[10px] text-red-600 font-bold">OVERDUE</span>}
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {trip.trip_ref} · Leg #{trip.trip_leg_index} · Deviations: {trip.deviation_count}
                    </p>
                    {trip.contractor_company_name && (
                      <p className="text-xs text-surface-500 mt-0.5">Contractor: {trip.contractor_company_name}</p>
                    )}
                    <p className="text-sm text-surface-700 mt-1">
                      {trip.collection_point_name || '—'} → {trip.destination_name || '—'}
                    </p>
                    <p className="text-xs text-surface-500 mt-1">
                      ETA {formatDt(trip.eta_due_at)} · Last seen {formatDt(trip.last_seen_at)}
                      {trip.last_lat != null && (
                        <span className="ml-2 font-mono">
                          ({trip.last_lat?.toFixed?.(4) ?? trip.last_lat}, {trip.last_lng?.toFixed?.(4) ?? trip.last_lng}) {trip.last_speed_kmh != null ? `${Math.round(trip.last_speed_kmh)} km/h` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    {trip.status === 'pending' && (
                      <button type="button" className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700" onClick={() => activate(trip.id)}>
                        Activate delivery
                      </button>
                    )}
                    {(trip.status === 'enroute' || trip.status === 'deviated') && (
                      <>
                        <button type="button" className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-100" onClick={() => simTelemetry(trip)}>
                          Simulate GPS
                        </button>
                        <button type="button" className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-50" onClick={() => logDeviation(trip)}>
                          Log deviation
                        </button>
                        <button type="button" className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => complete(trip)}>
                          Complete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-surface-900">Trip detail</h3>
            <p className="font-mono text-sm text-surface-600 mt-1">{selected.trip_ref}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-surface-500">Status</dt>
                <dd className="font-medium">{selected.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">ETA</dt>
                <dd>{formatDt(selected.eta_due_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-surface-500">Deviations</dt>
                <dd>{selected.deviation_count}</dd>
              </div>
            </dl>
            <button type="button" className="mt-6 w-full py-2 rounded-lg border border-surface-300" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabSettings({ setError }) {
  const [settings, setSettings] = useState(null);
  const [geofences, setGeofences] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [gForm, setGForm] = useState({ name: '', fence_type: 'deviation', center_lat: '', center_lng: '', radius_m: 500, polygon_json: '', alert_on_exit: true, alert_on_entry: false });
  const [rForm, setRForm] = useState({ name: '', collection_point_name: '', destination_name: '', origin_lat: '', origin_lng: '', dest_lat: '', dest_lng: '' });

  const load = useCallback(async () => {
    try {
      const [s, g, r] = await Promise.all([trackingApi.settings.get(), trackingApi.geofences.list(), trackingApi.routes.list()]);
      setSettings(s.settings);
      setGeofences(g.geofences || []);
      setRoutes(r.routes || []);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.settings.update(settings);
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const addGeofence = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.geofences.create({
        ...gForm,
        center_lat: gForm.center_lat ? Number(gForm.center_lat) : null,
        center_lng: gForm.center_lng ? Number(gForm.center_lng) : null,
        radius_m: gForm.radius_m ? Number(gForm.radius_m) : null,
      });
      setGForm({ name: '', fence_type: 'deviation', center_lat: '', center_lng: '', radius_m: 500, polygon_json: '', alert_on_exit: true, alert_on_entry: false });
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  const addRoute = async (e) => {
    e.preventDefault();
    try {
      await trackingApi.routes.create({
        ...rForm,
        origin_lat: rForm.origin_lat ? Number(rForm.origin_lat) : null,
        origin_lng: rForm.origin_lng ? Number(rForm.origin_lng) : null,
        dest_lat: rForm.dest_lat ? Number(rForm.dest_lat) : null,
        dest_lng: rForm.dest_lng ? Number(rForm.dest_lng) : null,
      });
      setRForm({ name: '', collection_point_name: '', destination_name: '', origin_lat: '', origin_lng: '', dest_lat: '', dest_lng: '' });
      load();
    } catch (err) {
      setError(err?.message);
    }
  };

  if (!settings) return <p className="text-surface-500">Loading settings…</p>;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-600 mt-1">Geofences for deviations, en-route timers, alarms, and monitor routes.</p>
      </header>

      <form onSubmit={saveSettings} className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-surface-900 mb-3">Timers & speed</h3>
          <label className="block text-xs text-surface-500 mb-1">Max en-route time (minutes)</label>
          <input
            type="number"
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            value={settings.max_enroute_minutes ?? 240}
            onChange={(e) => setSettings((s) => ({ ...s, max_enroute_minutes: Number(e.target.value) }))}
          />
          <p className="text-xs text-surface-500 mt-1">Used to compute ETA when a delivery is activated.</p>
        </div>
        <div>
          <h3 className="font-semibold text-surface-900 mb-3">Alarm thresholds</h3>
          <label className="block text-xs text-surface-500 mb-1">Overspeed (km/h)</label>
          <input
            type="number"
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            value={settings.alarm_overspeed_kmh ?? 90}
            onChange={(e) => setSettings((s) => ({ ...s, alarm_overspeed_kmh: Number(e.target.value) }))}
          />
          <div className="flex flex-wrap gap-4 mt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!settings.alarm_harsh_braking}
                onChange={(e) => setSettings((s) => ({ ...s, alarm_harsh_braking: e.target.checked }))}
              />
              Harsh braking
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!settings.alarm_harsh_accel}
                onChange={(e) => setSettings((s) => ({ ...s, alarm_harsh_accel: e.target.checked }))}
              />
              Harsh acceleration
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!settings.alarm_seatbelt}
                onChange={(e) => setSettings((s) => ({ ...s, alarm_seatbelt: e.target.checked }))}
              />
              Seatbelt violation
            </label>
          </div>
          <label className="block text-xs text-surface-500 mt-3 mb-1">Idle alarm (minutes)</label>
          <input
            type="number"
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            value={settings.alarm_idle_minutes ?? 30}
            onChange={(e) => setSettings((s) => ({ ...s, alarm_idle_minutes: Number(e.target.value) }))}
          />
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Save settings
          </button>
        </div>
      </form>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-surface-900 mb-4">Geofences</h3>
          <form onSubmit={addGeofence} className="space-y-2 text-sm">
            <input className="w-full rounded-lg border border-surface-300 px-3 py-2" placeholder="Name" value={gForm.name} onChange={(e) => setGForm((f) => ({ ...f, name: e.target.value }))} required />
            <select
              className="w-full rounded-lg border border-surface-300 px-3 py-2"
              value={gForm.fence_type}
              onChange={(e) => setGForm((f) => ({ ...f, fence_type: e.target.value }))}
            >
              {FENCE_TYPES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Center lat" value={gForm.center_lat} onChange={(e) => setGForm((f) => ({ ...f, center_lat: e.target.value }))} />
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Center lng" value={gForm.center_lng} onChange={(e) => setGForm((f) => ({ ...f, center_lng: e.target.value }))} />
            </div>
            <input
              type="number"
              className="w-full rounded-lg border border-surface-300 px-3 py-2"
              placeholder="Radius (m)"
              value={gForm.radius_m}
              onChange={(e) => setGForm((f) => ({ ...f, radius_m: e.target.value }))}
            />
            <textarea
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-xs font-mono"
              rows={2}
              placeholder="Polygon GeoJSON (optional)"
              value={gForm.polygon_json}
              onChange={(e) => setGForm((f) => ({ ...f, polygon_json: e.target.value }))}
            />
            <button type="submit" className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm">Add geofence</button>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {geofences.map((g) => (
              <li key={g.id} className="flex justify-between items-center border border-surface-100 rounded-lg px-3 py-2">
                <span>
                  {g.name} <span className="text-surface-500">({g.fence_type})</span>
                </span>
                <button type="button" className="text-red-600 text-xs" onClick={() => trackingApi.geofences.delete(g.id).then(load).catch((e) => setError(e.message))}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-surface-900 mb-4">Monitor routes</h3>
          <form onSubmit={addRoute} className="space-y-2 text-sm">
            <input className="w-full rounded-lg border border-surface-300 px-3 py-2" placeholder="Route name" value={rForm.name} onChange={(e) => setRForm((f) => ({ ...f, name: e.target.value }))} required />
            <input
              className="w-full rounded-lg border border-surface-300 px-3 py-2"
              placeholder="Collection point label"
              value={rForm.collection_point_name}
              onChange={(e) => setRForm((f) => ({ ...f, collection_point_name: e.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-surface-300 px-3 py-2"
              placeholder="Destination label"
              value={rForm.destination_name}
              onChange={(e) => setRForm((f) => ({ ...f, destination_name: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Origin lat" value={rForm.origin_lat} onChange={(e) => setRForm((f) => ({ ...f, origin_lat: e.target.value }))} />
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Origin lng" value={rForm.origin_lng} onChange={(e) => setRForm((f) => ({ ...f, origin_lng: e.target.value }))} />
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Dest lat" value={rForm.dest_lat} onChange={(e) => setRForm((f) => ({ ...f, dest_lat: e.target.value }))} />
              <input className="rounded-lg border border-surface-300 px-3 py-2" placeholder="Dest lng" value={rForm.dest_lng} onChange={(e) => setRForm((f) => ({ ...f, dest_lng: e.target.value }))} />
            </div>
            <button type="submit" className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm">Add route</button>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {routes.map((r) => (
              <li key={r.id} className="flex justify-between items-center border border-surface-100 rounded-lg px-3 py-2">
                <span>{r.name}</span>
                <button type="button" className="text-red-600 text-xs" onClick={() => trackingApi.routes.delete(r.id).then(load).catch((e) => setError(e.message))}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function TabDeliveryRecords({ setError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', registration: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.registration.trim()) params.registration = filters.registration.trim();
      const d = await trackingApi.deliveries.list(params);
      setRows(d.deliveries || []);
    } catch (e) {
      setError(e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [filters, setError]);

  useEffect(() => {
    load();
  }, []);

  const exportCsv = () => {
    downloadCsv(`deliveries-${todayYmd()}.csv`, rows, [
      'trip_ref',
      'truck_registration',
      'delivered_at',
      'destination_name',
      'net_weight_kg',
      'status',
      'notes',
    ]);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Delivery records</h1>
          <p className="text-surface-600 mt-1">Historical completed deliveries with optional weight and references.</p>
        </div>
        <button type="button" onClick={exportCsv} className="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium hover:bg-surface-50" disabled={!rows.length}>
          Export CSV
        </button>
      </header>

      <div className="rounded-xl border border-surface-200 bg-white p-4 flex flex-wrap gap-3 items-end shadow-sm">
        <div>
          <label className="block text-xs text-surface-500 mb-1">From</label>
          <input type="date" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">To</label>
          <input type="date" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Registration contains</label>
          <input
            className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-40"
            value={filters.registration}
            onChange={(e) => setFilters((f) => ({ ...f, registration: e.target.value }))}
            placeholder="ABC"
          />
        </div>
        <button type="button" onClick={() => load()} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700">
          Apply filters
        </button>
      </div>

      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-surface-100 text-xs text-surface-500">{loading ? 'Loading…' : `${rows.length} records`}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500">
              <tr>
                <th className="px-4 py-3">Trip ref</th>
                <th className="px-4 py-3">Registration</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3 text-right">Net kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-50/50">
                  <td className="px-4 py-3 font-mono text-xs">{r.trip_ref || '—'}</td>
                  <td className="px-4 py-3 font-medium">{r.truck_registration}</td>
                  <td className="px-4 py-3">{formatDt(r.delivered_at)}</td>
                  <td className="px-4 py-3">{r.destination_name || '—'}</td>
                  <td className="px-4 py-3 text-right">{r.net_weight_kg != null ? r.net_weight_kg : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabAlarmRecords({ setError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    type: 'all',
    severity: 'all',
    registration: '',
    acknowledged: 'all',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.type !== 'all') params.type = filters.type;
      if (filters.severity !== 'all') params.severity = filters.severity;
      if (filters.registration.trim()) params.registration = filters.registration.trim();
      if (filters.acknowledged === 'true') params.acknowledged = 'true';
      if (filters.acknowledged === 'false') params.acknowledged = 'false';
      const d = await trackingApi.alarms.list(params);
      setRows(d.alarms || []);
    } catch (e) {
      setError(e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [filters, setError]);

  useEffect(() => {
    load();
  }, []);

  const exportCsv = () => {
    downloadCsv(`alarms-${todayYmd()}.csv`, rows, [
      'occurred_at',
      'truck_registration',
      'alarm_type',
      'severity',
      'detail',
      'speed_kmh',
      'lat',
      'lng',
      'acknowledged',
    ]);
  };

  const sevColor = (s) => {
    if (s === 'critical') return 'text-red-700 bg-red-50';
    if (s === 'warning') return 'text-amber-800 bg-amber-50';
    return 'text-surface-700 bg-surface-100';
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Alarm records</h1>
          <p className="text-surface-600 mt-1">Overspeed, harsh events, seatbelt, deviations, geofences — filter and export.</p>
        </div>
        <button type="button" onClick={exportCsv} className="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium hover:bg-surface-50" disabled={!rows.length}>
          Export CSV
        </button>
      </header>

      <div className="rounded-xl border border-surface-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 shadow-sm">
        <div>
          <label className="block text-xs text-surface-500 mb-1">From</label>
          <input type="date" className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">To</label>
          <input type="date" className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Alarm type</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            {ALARM_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Severity</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm" value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Registration</label>
          <input
            className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm"
            value={filters.registration}
            onChange={(e) => setFilters((f) => ({ ...f, registration: e.target.value }))}
            placeholder="Filter…"
          />
        </div>
        <div>
          <label className="block text-xs text-surface-500 mb-1">Acknowledged</label>
          <select className="w-full rounded-lg border border-surface-300 px-2 py-2 text-sm" value={filters.acknowledged} onChange={(e) => setFilters((f) => ({ ...f, acknowledged: e.target.value }))}>
            <option value="all">All</option>
            <option value="false">Unacked only</option>
            <option value="true">Acked only</option>
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4 xl:col-span-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => load()} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700">
            Apply filters
          </button>
          <button type="button" onClick={() => setFilters({ from: '', to: '', type: 'all', severity: 'all', registration: '', acknowledged: 'all' })} className="rounded-lg border border-surface-300 px-4 py-2 text-sm">
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-surface-100 text-xs text-surface-500">{loading ? 'Loading…' : `${rows.length} alarms`}</div>
        <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500 sticky top-0">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Detail</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-surface-50/50">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDt(a.occurred_at)}</td>
                  <td className="px-4 py-3 font-mono">{a.truck_registration}</td>
                  <td className="px-4 py-3">{a.alarm_type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${sevColor(a.severity)}`}>{a.severity}</span>
                  </td>
                  <td className="px-4 py-3 max-w-md truncate" title={a.detail}>
                    {a.detail}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!a.acknowledged && (
                      <button
                        type="button"
                        className="text-brand-600 hover:underline text-xs"
                        onClick={async () => {
                          try {
                            await trackingApi.alarms.acknowledge(a.id);
                            load();
                          } catch (err) {
                            setError(err?.message);
                          }
                        }}
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
