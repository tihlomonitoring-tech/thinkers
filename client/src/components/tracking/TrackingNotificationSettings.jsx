import { useEffect, useState } from 'react';
import { tracking as trackingApi } from '../../api';

const NOTIFICATION_TOGGLES = [
  {
    key: 'notify_email_deviation',
    label: 'Route deviations',
    hint: 'Corridor exits and logged route deviations',
  },
  {
    key: 'notify_email_overspeed',
    label: 'Speed alerts',
    hint: 'When a truck exceeds the tenant speed limit',
  },
  {
    key: 'notify_email_parking',
    label: 'Parking / idle alerts',
    hint: 'When a truck stays stationary beyond the idle threshold',
  },
  {
    key: 'notify_email_loading',
    label: 'Loading alerts',
    hint: 'When a truck enters the origin / loading geofence',
  },
  {
    key: 'notify_email_offloading',
    label: 'Offloading alerts',
    hint: 'When a truck enters the destination geofence',
  },
];

export default function TrackingNotificationSettings({ setError }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState({});

  useEffect(() => {
    setLoading(true);
    trackingApi.settings
      .get()
      .then((res) => {
        const s = res.settings || {};
        setPrefs({
          notify_email_deviation: s.notify_email_deviation !== false,
          notify_email_overspeed: s.notify_email_overspeed !== false,
          notify_email_parking: s.notify_email_parking !== false,
          notify_email_loading: s.notify_email_loading !== false,
          notify_email_offloading: s.notify_email_offloading !== false,
        });
      })
      .catch((err) => {
        setError?.(err?.message || 'Failed to load notification settings');
        setPrefs(Object.fromEntries(NOTIFICATION_TOGGLES.map((t) => [t.key, true])));
      })
      .finally(() => setLoading(false));
  }, [setError]);

  const handleToggle = (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    trackingApi.settings
      .update({ [key]: next[key] })
      .catch((err) => {
        setError?.(err?.message || 'Failed to save notification setting');
        setPrefs(prefs);
      })
      .finally(() => setSaving(false));
  };

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Email notifications</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose which tracking alerts send email to users with Tracking Management access. Alarm records are still
          created when a type is switched off.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading notification settings…</p>
        ) : (
          NOTIFICATION_TOGGLES.map(({ key, label, hint }) => (
            <label
              key={key}
              className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
              </span>
              <span className="relative inline-flex shrink-0 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={!!prefs[key]}
                  disabled={saving}
                  onChange={() => handleToggle(key)}
                />
                <span
                  className="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2"
                  aria-hidden
                />
                <span
                  className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"
                  aria-hidden
                />
              </span>
            </label>
          ))
        )}
      </div>
      {saving && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">Saving…</p>}
    </section>
  );
}
