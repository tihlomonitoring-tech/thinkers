import { useState, useEffect, useCallback, useRef } from 'react';
import { fuelCustomerPortal } from './api';
import { inputClass } from './lib/fuelSupplyUi.js';
import InfoHint from './components/InfoHint.jsx';

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];

const REQUEST_TYPES = [
  { id: 'normal', label: 'Normal order' },
  { id: 'top_up', label: 'Top-up' },
  { id: 'emergency', label: 'Emergency' },
];

/** YYYY-MM-DD for <input type="date">; if the date is before today (local), use today. */
function dueDateForReorderForm(d) {
  if (d == null || d === '') return '';
  let ymd = '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.trim())) {
    ymd = d.trim().slice(0, 10);
  } else {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const pick = new Date(yy, mm - 1, dd);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (pick < startToday) {
    return `${startToday.getFullYear()}-${String(startToday.getMonth() + 1).padStart(2, '0')}-${String(startToday.getDate()).padStart(2, '0')}`;
  }
  return ymd;
}

export default function FuelCustomerOrders() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    liters_required: '',
    priority: 'normal',
    due_date: '',
    request_type: 'normal',
    delivery_site_name: '',
    delivery_site_address: '',
    site_responsible_name: '',
    site_responsible_phone: '',
    site_responsible_email: '',
    customer_notes: '',
  });
  const formRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    fuelCustomerPortal
      .myRequests()
      .then((r) => setRequests(r.requests || []))
      .catch((e) => setError(e?.message || 'Could not load requests'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const liters = Number(form.liters_required);
    if (Number.isNaN(liters) || liters <= 0) {
      setError('Enter a valid liters amount.');
      setSaving(false);
      return;
    }
    if (!form.due_date) {
      setError('Due date is required.');
      setSaving(false);
      return;
    }
    fuelCustomerPortal
      .createRequest({
        liters_required: liters,
        priority: form.priority,
        due_date: form.due_date,
        request_type: form.request_type,
        delivery_site_name: form.delivery_site_name.trim(),
        delivery_site_address: form.delivery_site_address.trim(),
        site_responsible_name: form.site_responsible_name.trim() || undefined,
        site_responsible_phone: form.site_responsible_phone.trim() || undefined,
        site_responsible_email: form.site_responsible_email.trim() || undefined,
        customer_notes: form.customer_notes.trim() || undefined,
      })
      .then(() => {
        setForm((f) => ({
          ...f,
          liters_required: '',
          due_date: '',
          customer_notes: '',
        }));
        load();
      })
      .catch((err) => setError(err?.message || 'Could not submit request'))
      .finally(() => setSaving(false));
  };

  const prefillFromRequest = (r) => {
    setError('');
    setForm({
      liters_required: r.liters_required != null ? String(r.liters_required) : '',
      priority: PRIORITIES.some((p) => p.id === r.priority) ? r.priority : 'normal',
      due_date: dueDateForReorderForm(r.due_date),
      request_type: REQUEST_TYPES.some((t) => t.id === r.request_type) ? r.request_type : 'normal',
      delivery_site_name: r.delivery_site_name || '',
      delivery_site_address: r.delivery_site_address || '',
      site_responsible_name: r.site_responsible_name || '',
      site_responsible_phone: r.site_responsible_phone || '',
      site_responsible_email: r.site_responsible_email || '',
      customer_notes: r.customer_notes || '',
    });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Customer diesel orders</h1>
        <InfoHint
          title="Customer diesel orders help"
          text="Request diesel delivery to your site. Your account must be created by an administrator and this page must be assigned to you under Users → Page access."
          bullets={[
            'Submitted requests appear in Fuel supply → Administration for approval.',
            'You will be emailed when your request is approved or declined, and again when delivery is recorded (when email is configured).',
            'Use Reorder on a past request to copy details into the form, then adjust liters or due date and submit.',
          ]}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-red-800 dark:text-red-200 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <form
          ref={formRef}
          onSubmit={submit}
          className="space-y-4 bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-800 p-4 sm:p-6 shadow-sm scroll-mt-4"
        >
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">New delivery request</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Liters required</label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass()}
                value={form.liters_required}
                onChange={(e) => setForm((f) => ({ ...f, liters_required: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Priority</label>
              <select className={inputClass()} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Due date</label>
              <input
                required
                type="date"
                className={inputClass()}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Request type</label>
              <select className={inputClass()} value={form.request_type} onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}>
                {REQUEST_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Delivery site name</label>
              <input
                required
                className={inputClass()}
                value={form.delivery_site_name}
                onChange={(e) => setForm((f) => ({ ...f, delivery_site_name: e.target.value }))}
                placeholder="Mine, plant, or depot name"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Delivery address</label>
              <textarea
                required
                rows={2}
                className={inputClass()}
                value={form.delivery_site_address}
                onChange={(e) => setForm((f) => ({ ...f, delivery_site_address: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Site contact name (optional)</label>
              <input className={inputClass()} value={form.site_responsible_name} onChange={(e) => setForm((f) => ({ ...f, site_responsible_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Site contact phone (optional)</label>
              <input className={inputClass()} value={form.site_responsible_phone} onChange={(e) => setForm((f) => ({ ...f, site_responsible_phone: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Site contact email (optional)</label>
              <input type="email" className={inputClass()} value={form.site_responsible_email} onChange={(e) => setForm((f) => ({ ...f, site_responsible_email: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Notes for fuel team (optional)</label>
              <textarea rows={2} className={inputClass()} value={form.customer_notes} onChange={(e) => setForm((f) => ({ ...f, customer_notes: e.target.value }))} />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Submitting…' : 'Submit request'}
          </button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Your requests &amp; status</h2>
            <InfoHint
              title="Request status help"
              text="Status updates when fuel administration approves your request, and when the linked diesel order is delivered. Rejected requests show the reason if one was provided."
            />
          </div>
          {loading ? (
            <p className="text-sm text-surface-500">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-surface-500 bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-800 p-6">No requests yet.</p>
          ) : (
            <ul className="space-y-3">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 text-sm shadow-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-surface-900 dark:text-surface-100">{r.delivery_site_name}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200">
                      {r.portal_status_label}
                    </span>
                  </div>
                  <p className="text-surface-600 dark:text-surface-400 mt-1">
                    {r.liters_required != null ? `${r.liters_required} L` : '—'} · {String(r.request_type || '').replace(/_/g, ' ')} · priority {r.priority} · due {formatDate(r.due_date)}
                  </p>
                  {r.rejection_reason && <p className="text-red-700 dark:text-red-300 text-xs mt-2">Reason: {r.rejection_reason}</p>}
                  <button
                    type="button"
                    onClick={() => prefillFromRequest(r)}
                    className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    Reorder — copy to form
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
