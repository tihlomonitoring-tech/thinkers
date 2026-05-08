import { useState, useEffect, useCallback, useMemo } from 'react';
import { fuelData } from '../api';
import { FUEL_EXPORT_COLUMN_OPTIONS, DEFAULT_EXPORT_COLUMN_KEYS } from '../lib/fuelExportColumns.js';
import { inputClass } from '../lib/fuelSupplyUi.js';

const EVERY_N_DAYS_OPTIONS = [
  { value: 1, label: 'Every day' },
  { value: 2, label: 'Every 2 days' },
  { value: 3, label: 'Every 3 days' },
  { value: 7, label: 'Every 7 days' },
  { value: 14, label: 'Every 14 days' },
  { value: 30, label: 'Every 30 days' },
];

const STATUS_OPTIONS = [
  { value: 'verified', label: 'Verified only' },
  { value: 'pending', label: 'Pending only' },
  { value: 'all', label: 'All transactions' },
];

const EMPTY_FORM = {
  id: null,
  name: 'Fuel data — auto share',
  recipient_emails: [],
  cc_emails: [],
  supplier_id: '',
  customer_id: '',
  status_filter: 'verified',
  columns: [...DEFAULT_EXPORT_COLUMN_KEYS],
  attach_pdf: true,
  attach_excel: true,
  every_n_days: 2,
  time_hhmm: '08:00',
  start_date: '',
  is_active: true,
  subject: '',
  intro_message: '',
};

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) {
    return '—';
  }
}

function RecipientPicker({ label, value, onChange, recipients, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients.slice(0, 10);
    return recipients
      .filter(
        (r) =>
          (r.email || '').toLowerCase().includes(q) ||
          (r.full_name || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [search, recipients]);

  const addEmail = (email) => {
    const v = String(email || '').trim().toLowerCase();
    if (!v || !v.includes('@')) return;
    if (selectedSet.has(v)) return;
    onChange([...value, v]);
    setSearch('');
  };

  const removeEmail = (email) => {
    onChange(value.filter((e) => e.toLowerCase() !== email.toLowerCase()));
  };

  return (
    <div>
      <label className="text-xs text-surface-500 block">{label}</label>
      <div className="mt-1 flex flex-wrap gap-1.5 p-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 min-h-[44px]">
        {value.map((email) => {
          const meta = recipients.find((r) => (r.email || '').toLowerCase() === email.toLowerCase());
          return (
            <span
              key={email}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-brand-50 text-brand-800 text-xs border border-brand-200"
            >
              <span className="font-medium">{meta?.full_name || email}</span>
              {meta?.is_super_admin ? (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">SUPER ADMIN</span>
              ) : null}
              {!meta ? <span className="text-surface-500 text-[10px]">{email}</span> : null}
              <button
                type="button"
                onClick={() => removeEmail(email)}
                className="ml-1 w-5 h-5 rounded-full hover:bg-brand-100 text-brand-700"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          className="flex-1 min-w-[160px] outline-none bg-transparent text-sm py-1"
          placeholder={placeholder || 'Search users by name/email or type an email…'}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addEmail(search);
            } else if (e.key === 'Backspace' && !search && value.length) {
              removeEmail(value[value.length - 1]);
            }
          }}
        />
      </div>
      {open && filtered.length > 0 ? (
        <div className="mt-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg max-h-56 overflow-auto">
          {filtered.map((r) => {
            const already = selectedSet.has((r.email || '').toLowerCase());
            return (
              <button
                type="button"
                key={r.id || r.email}
                disabled={already}
                onClick={() => {
                  addEmail(r.email);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  already
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-800'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-surface-900 dark:text-surface-100">
                    {r.full_name || r.email}
                  </div>
                  <div className="truncate text-xs text-surface-500">{r.email}</div>
                </div>
                {r.is_super_admin ? (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                    SUPER ADMIN
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <div className="mt-1 text-[11px] text-surface-400">
          Press <span className="font-mono">Enter</span> or <span className="font-mono">,</span> to add a free-text
          email. Click outside to close.{' '}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="underline text-surface-500"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleForm({ form, setForm, suppliers, customers, recipients, onSubmit, onCancel, busy }) {
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleColumn = (key) => {
    setForm((f) => {
      const next = new Set(f.columns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      const ordered = DEFAULT_EXPORT_COLUMN_KEYS.filter((k) => next.has(k));
      return { ...f, columns: ordered };
    });
  };

  return (
    <form
      className="app-glass-card p-4 sm:p-5 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-surface-500 block sm:col-span-2">
          Schedule name
          <input
            className={inputClass('mt-1')}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            required
          />
        </label>

        <RecipientPicker
          label="Recipients (To)"
          value={form.recipient_emails}
          onChange={(v) => update({ recipient_emails: v })}
          recipients={recipients}
        />
        <RecipientPicker
          label="CC (optional)"
          value={form.cc_emails}
          onChange={(v) => update({ cc_emails: v })}
          recipients={recipients}
        />

        <label className="text-xs text-surface-500 block">
          Filter by supplier (optional)
          <select
            className={inputClass('mt-1')}
            value={form.supplier_id}
            onChange={(e) => update({ supplier_id: e.target.value })}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-surface-500 block">
          Filter by customer (optional)
          <select
            className={inputClass('mt-1')}
            value={form.customer_id}
            onChange={(e) => update({ customer_id: e.target.value })}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-surface-500 block">
          Transactions to include
          <select
            className={inputClass('mt-1')}
            value={form.status_filter}
            onChange={(e) => update({ status_filter: e.target.value })}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-surface-500 block">
          Cadence
          <select
            className={inputClass('mt-1')}
            value={form.every_n_days}
            onChange={(e) => update({ every_n_days: Number(e.target.value) })}
          >
            {EVERY_N_DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-surface-500 block">
          Send time (24h)
          <input
            className={inputClass('mt-1')}
            type="time"
            value={form.time_hhmm}
            onChange={(e) => update({ time_hhmm: e.target.value })}
            required
          />
        </label>
        <label className="text-xs text-surface-500 block">
          Start date (optional)
          <input
            className={inputClass('mt-1')}
            type="date"
            value={form.start_date || ''}
            onChange={(e) => update({ start_date: e.target.value })}
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-surface-500 block">
          Custom subject (optional)
          <input
            className={inputClass('mt-1')}
            value={form.subject}
            placeholder="e.g. Fuel data — MTD transactions"
            onChange={(e) => update({ subject: e.target.value })}
          />
        </label>
        <label className="text-xs text-surface-500 block sm:row-span-2">
          Email intro / observations note (optional)
          <textarea
            className={inputClass('mt-1 min-h-[110px]')}
            value={form.intro_message}
            placeholder="A short message that will appear above the auto-generated MTD observations."
            onChange={(e) => update({ intro_message: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 pt-5">
          <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200 cursor-pointer">
            <input
              type="checkbox"
              checked={form.attach_excel}
              onChange={(e) => update({ attach_excel: e.target.checked })}
            />
            Attach Excel
          </label>
          <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200 cursor-pointer">
            <input
              type="checkbox"
              checked={form.attach_pdf}
              onChange={(e) => update({ attach_pdf: e.target.checked })}
            />
            Attach PDF
          </label>
          <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => update({ is_active: e.target.checked })}
            />
            Active
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-100">Column layout</h4>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-surface-300"
              onClick={() => update({ columns: [...DEFAULT_EXPORT_COLUMN_KEYS] })}
            >
              All columns
            </button>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-surface-300"
              onClick={() =>
                update({
                  columns: ['supplier_name', 'customer_name', 'delivery_time', 'liters_filled', 'amount_rand'],
                })
              }
            >
              Minimal
            </button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2 p-3 rounded-lg bg-surface-50 dark:bg-surface-900/40 border border-surface-200 dark:border-surface-800">
          {FUEL_EXPORT_COLUMN_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form.columns.includes(opt.key)}
                onChange={() => toggleColumn(opt.key)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : form.id ? 'Save changes' : 'Create schedule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-surface-300 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function FuelDataAutoShareTab({ suppliers, customers }) {
  const [schedules, setSchedules] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [editing, setEditing] = useState(null); // form state when creating/editing
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, recs] = await Promise.all([
        fuelData.autoShare.list(),
        fuelData.autoShare.recipients(),
      ]);
      setSchedules(Array.isArray(list?.schedules) ? list.schedules : []);
      setRecipients(Array.isArray(recs?.recipients) ? recs.recipients : []);
    } catch (e) {
      setError(e.message || 'Failed to load schedules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const startCreate = () =>
    setEditing({
      ...EMPTY_FORM,
      recipient_emails: [],
      cc_emails: [],
      columns: [...DEFAULT_EXPORT_COLUMN_KEYS],
    });

  const startEdit = (s) =>
    setEditing({
      id: s.id,
      name: s.name || '',
      recipient_emails: Array.isArray(s.recipient_emails) ? s.recipient_emails : [],
      cc_emails: Array.isArray(s.cc_emails) ? s.cc_emails : [],
      supplier_id: s.supplier_id || '',
      customer_id: s.customer_id || '',
      status_filter: s.status_filter || 'verified',
      columns:
        Array.isArray(s.columns) && s.columns.length ? s.columns : [...DEFAULT_EXPORT_COLUMN_KEYS],
      attach_pdf: s.attach_pdf !== false,
      attach_excel: s.attach_excel !== false,
      every_n_days: Number(s.every_n_days) || 2,
      time_hhmm: s.time_hhmm || '08:00',
      start_date: s.start_date ? String(s.start_date).slice(0, 10) : '',
      is_active: s.is_active !== false,
      subject: s.subject || '',
      intro_message: s.intro_message || '',
    });

  const onSubmit = async () => {
    if (!editing) return;
    if (!editing.recipient_emails.length) {
      setError('Add at least one recipient.');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const payload = { ...editing };
      if (editing.id) {
        await fuelData.autoShare.update(editing.id, payload);
        setInfo('Schedule updated.');
      } else {
        await fuelData.autoShare.create(payload);
        setInfo('Schedule created.');
      }
      setEditing(null);
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to save schedule.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm('Delete this auto-share schedule?')) return;
    setBusy(true);
    setError('');
    try {
      await fuelData.autoShare.remove(id);
      setInfo('Schedule deleted.');
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to delete schedule.');
    } finally {
      setBusy(false);
    }
  };

  const onRunNow = async (id) => {
    setRunningId(id);
    setError('');
    setInfo('');
    try {
      const result = await fuelData.autoShare.runNow(id);
      if (result?.ok) {
        setInfo(
          `Sent ${result.sent || 0} email${result.sent === 1 ? '' : 's'} · ${
            result.row_count || 0
          } transaction${result.row_count === 1 ? '' : 's'}.`
        );
      } else {
        setError(result?.error || 'Send failed.');
      }
      await reload();
    } catch (e) {
      setError(e.message || 'Failed to run schedule.');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Auto share</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
            Schedule automated month-to-date transaction sheets to recipients via email. The system sends
            a beautifully formatted observations summary plus the Excel and PDF attachments using the column
            layout you choose. Cadence options range from every day to every 30 days.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium"
        >
          + New schedule
        </button>
      </div>

      {error ? (
        <div className="px-3 py-2 rounded bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          {info}
        </div>
      ) : null}

      {editing ? (
        <ScheduleForm
          form={editing}
          setForm={setEditing}
          suppliers={suppliers}
          customers={customers}
          recipients={recipients}
          onSubmit={onSubmit}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      ) : null}

      <div className="app-glass-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 dark:bg-surface-900/40 text-surface-600 dark:text-surface-300">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Recipients</th>
                <th className="text-left px-4 py-3 font-medium">Cadence</th>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Attachments</th>
                <th className="text-left px-4 py-3 font-medium">Last run</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-surface-500">
                    Loading…
                  </td>
                </tr>
              ) : schedules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-surface-500">
                    No schedules yet. Click <strong>New schedule</strong> to create the first one.
                  </td>
                </tr>
              ) : (
                schedules.map((s) => (
                  <tr key={s.id} className="border-t border-surface-100 dark:border-surface-800 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-surface-900 dark:text-surface-50">{s.name}</div>
                      {s.subject ? (
                        <div className="text-xs text-surface-500 mt-0.5">Subject: {s.subject}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-200">
                      <div className="space-y-0.5 max-w-xs">
                        {(s.recipient_emails || []).slice(0, 4).map((e) => (
                          <div key={e} className="truncate text-xs">{e}</div>
                        ))}
                        {(s.recipient_emails || []).length > 4 ? (
                          <div className="text-[11px] text-surface-500">
                            +{s.recipient_emails.length - 4} more
                          </div>
                        ) : null}
                        {s.cc_emails?.length ? (
                          <div className="text-[11px] text-surface-500">
                            CC: {s.cc_emails.length}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-200">
                      Every {s.every_n_days} day{s.every_n_days === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-200">{s.time_hhmm}</td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-200 text-xs">
                      {s.attach_excel ? <div>• Excel</div> : null}
                      {s.attach_pdf ? <div>• PDF</div> : null}
                      {!s.attach_excel && !s.attach_pdf ? <span className="text-surface-400">—</span> : null}
                    </td>
                    <td className="px-4 py-3 text-surface-700 dark:text-surface-200 text-xs">
                      <div>{fmtDate(s.last_run_at)}</div>
                      {s.last_run_status ? (
                        <div
                          className={`mt-0.5 ${
                            s.last_run_status === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {s.last_run_status}
                          {s.last_run_detail ? `: ${s.last_run_detail}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {s.is_active ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-surface-200 text-surface-700 text-[11px] font-medium">
                          Paused
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap gap-1.5 justify-end">
                        <button
                          type="button"
                          disabled={runningId === s.id}
                          onClick={() => onRunNow(s.id)}
                          className="text-xs px-2 py-1 rounded bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900 disabled:opacity-50"
                        >
                          {runningId === s.id ? 'Sending…' : 'Send now'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(s)}
                          className="text-xs px-2 py-1 rounded border border-surface-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(s.id)}
                          className="text-xs px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
