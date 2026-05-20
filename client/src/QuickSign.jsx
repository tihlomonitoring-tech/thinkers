import { useState, useEffect, useCallback, useMemo } from 'react';
import { quickSign as qsApi } from './api';
import { openAttachmentWithAuth, downloadAttachmentWithAuth } from './api';
import InfoHint from './components/InfoHint.jsx';

const TABS = [
  { id: 'new', label: 'New signing request' },
  { id: 'history', label: 'Document history' },
];

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  const map = {
    draft: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
    sent: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
    accessed: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    signed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200',
    expired: 'bg-surface-200 text-surface-600',
  };
  return map[s] || 'bg-surface-100 text-surface-700';
}

function eventLabel(type) {
  const t = String(type || '');
  const labels = {
    created: 'Request created',
    sent: 'Invitation emailed',
    link_opened: 'Link opened',
    otp_verified: 'PIN verified',
    otp_failed: 'Incorrect PIN',
    document_viewed: 'Document viewed',
    signed: 'Document signed',
    cancelled: 'Cancelled',
  };
  return labels[t] || t.replace(/_/g, ' ');
}

const emptyForm = {
  title: '',
  notes: '',
  recipient_email: '',
  recipient_name: '',
  recipient_type: 'external',
  document: null,
};

function QuickSignGlyph({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

export default function QuickSign() {
  const [tab, setTab] = useState('new');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadList = useCallback(() => {
    setLoading(true);
    qsApi
      .list()
      .then((data) => setList(data.requests || []))
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
    qsApi.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => {});
  }, [loadList]);

  const filteredList = useMemo(() => {
    if (statusFilter === 'all') return list;
    return list.filter((r) => String(r.status).toLowerCase() === statusFilter);
  }, [list, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: list.length, draft: 0, sent: 0, accessed: 0, signed: 0, cancelled: 0 };
    for (const r of list) {
      const s = String(r.status || '').toLowerCase();
      if (c[s] != null) c[s] += 1;
    }
    return c;
  }, [list]);

  const loadDetail = (id) => {
    setDetailId(id);
    setDetailLoading(true);
    qsApi
      .get(id)
      .then((data) => setDetail(data.request))
      .catch((e) => setError(e?.message || 'Failed to load detail'))
      .finally(() => setDetailLoading(false));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.document) {
      setError('Select a document to upload.');
      return;
    }
    const email = (form.recipient_email || '').trim();
    if (!email) {
      setError('Recipient email is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('document', form.document);
      fd.append('title', form.title.trim() || form.document.name);
      fd.append('recipient_email', email);
      fd.append('recipient_name', (form.recipient_name || '').trim());
      fd.append('recipient_type', form.recipient_type);
      if (form.notes) fd.append('notes', form.notes.trim());
      const data = await qsApi.create(fd);
      resetForm();
      loadList();
      setTab('history');
      if (data.request?.id) loadDetail(data.request.id);
    } catch (err) {
      setError(err?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (id) => {
    if (!window.confirm('Send signing invitation email with one-time PIN to the recipient?')) return;
    setSending(true);
    setError('');
    try {
      await qsApi.send(id);
      loadList();
      if (detailId === id) loadDetail(id);
    } catch (err) {
      setError(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this signing request? The recipient link will no longer work.')) return;
    try {
      await qsApi.cancel(id);
      loadList();
      if (detailId === id) loadDetail(id);
    } catch (err) {
      setError(err?.message || 'Cancel failed');
    }
  };

  const pickInternalUser = (userId) => {
    const u = tenantUsers.find((x) => x.id === userId);
    if (!u) return;
    setForm((f) => ({
      ...f,
      recipient_type: 'internal',
      recipient_email: u.email || '',
      recipient_name: u.full_name || '',
    }));
  };

  return (
    <div className="flex flex-col min-h-0 w-full -m-4 sm:-m-6 bg-surface-100 dark:bg-surface-950">
      {error ? (
        <div className="shrink-0 z-10 mx-4 mt-4 sm:mx-6 text-sm text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/35 border border-red-200/80 dark:border-red-900/60 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">{error}</span>
          <button type="button" className="shrink-0 text-sm font-semibold hover:underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex md:hidden shrink-0 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-2 gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${
                tab === item.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
          <div className="p-4 border-b border-surface-200 dark:border-surface-700">
            <div className="flex items-start gap-2">
              <QuickSignGlyph className="h-9 w-9 text-brand-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-surface-900 dark:text-surface-50 leading-tight">Quick Sign</h1>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-snug">
                  Secure document signing with PIN and location audit.
                </p>
              </div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5" aria-label="Quick Sign sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex w-full items-center gap-2 text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === item.id
                    ? 'bg-brand-50 text-brand-900 border border-brand-200 dark:bg-brand-950/40 dark:text-brand-100 dark:border-brand-800'
                    : 'text-surface-700 hover:bg-surface-50 dark:text-surface-300 dark:hover:bg-surface-800/80 border border-transparent'
                }`}
              >
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8">
          {tab === 'new' ? (
            <div className="max-w-2xl">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-surface-900 dark:text-surface-100">New signing request</h2>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                  Upload a document and invite a signer. They will receive an email with a one-time PIN and secure link.
                </p>
              </div>

              <InfoHint className="mb-6">
                Supported: PDF, images, Word. After saving a draft, open <strong>Document history</strong> to send the invitation.
                Signers must enable location and confirm their ID number.
              </InfoHint>

              <form onSubmit={handleCreate} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Document</h3>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Title</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900"
                      placeholder="e.g. Service agreement"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">File *</label>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,image/*,application/pdf"
                      onChange={(e) => setForm((f) => ({ ...f, document: e.target.files?.[0] || null }))}
                      className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-800 file:font-medium"
                      required
                    />
                    {form.document ? (
                      <p className="text-xs text-surface-500 mt-1">{form.document.name}</p>
                    ) : null}
                  </div>
                </div>

                <div className="px-5 py-4 border-b border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Recipient</h3>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Type</label>
                      <select
                        value={form.recipient_type}
                        onChange={(e) => setForm((f) => ({ ...f, recipient_type: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                      >
                        <option value="external">External</option>
                        <option value="internal">Internal user</option>
                      </select>
                    </div>
                    {form.recipient_type === 'internal' && tenantUsers.length > 0 ? (
                      <div>
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Select user</label>
                        <select
                          value=""
                          onChange={(e) => pickInternalUser(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                        >
                          <option value="">— Choose —</option>
                          {tenantUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Email *</label>
                    <input
                      type="email"
                      value={form.recipient_email}
                      onChange={(e) => setForm((f) => ({ ...f, recipient_email: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Full name</label>
                    <input
                      value={form.recipient_name}
                      onChange={(e) => setForm((f) => ({ ...f, recipient_name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                    />
                  </div>
                </div>

                <div className="px-5 py-4 border-b border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                  <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wide">Notes</h3>
                </div>
                <div className="p-5">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800"
                    placeholder="Optional message for your records"
                  />
                </div>

                <div className="px-5 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-5 py-2.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 text-sm font-medium hover:bg-surface-50 dark:hover:bg-surface-800"
                  >
                    Clear form
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {tab === 'history' ? (
            <div className="max-w-6xl mx-auto w-full space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Document history</h2>
                  <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                    Track signing requests, access times, and download signed records.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadList}
                  disabled={loading}
                  className="px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-800 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'all', label: 'All', count: counts.all },
                  { id: 'draft', label: 'Draft', count: counts.draft },
                  { id: 'sent', label: 'Sent', count: counts.sent },
                  { id: 'accessed', label: 'Accessed', count: counts.accessed },
                  { id: 'signed', label: 'Signed', count: counts.signed },
                  { id: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      statusFilter === f.id
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700 hover:border-brand-300'
                    }`}
                  >
                    {f.label}
                    <span className="ml-1 opacity-80">({f.count})</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                <div className={`${detailId ? 'xl:col-span-2' : 'xl:col-span-5'}`}>
                  <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
                    {loading ? (
                      <p className="p-10 text-center text-surface-500">Loading…</p>
                    ) : filteredList.length === 0 ? (
                      <div className="p-12 text-center">
                        <p className="text-surface-600 dark:text-surface-400">No documents match this filter.</p>
                        <button
                          type="button"
                          onClick={() => setTab('new')}
                          className="mt-4 text-sm font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Create a signing request →
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-surface-50 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700">
                              <th className="text-left font-semibold text-surface-700 dark:text-surface-300 px-4 py-3">Document</th>
                              <th className="text-left font-semibold text-surface-700 dark:text-surface-300 px-4 py-3 hidden sm:table-cell">Recipient</th>
                              <th className="text-left font-semibold text-surface-700 dark:text-surface-300 px-4 py-3">Status</th>
                              <th className="text-left font-semibold text-surface-700 dark:text-surface-300 px-4 py-3 hidden md:table-cell">Created</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                            {filteredList.map((r) => (
                              <tr
                                key={r.id}
                                onClick={() => loadDetail(r.id)}
                                className={`cursor-pointer transition-colors ${
                                  detailId === r.id
                                    ? 'bg-brand-50/80 dark:bg-brand-950/25'
                                    : 'hover:bg-surface-50 dark:hover:bg-surface-800/40'
                                }`}
                              >
                                <td className="px-4 py-3">
                                  <span className="font-medium text-surface-900 dark:text-surface-100 block truncate max-w-[200px] sm:max-w-none">
                                    {r.title}
                                  </span>
                                  <span className="text-xs text-surface-500 sm:hidden truncate block">{r.recipient_email}</span>
                                </td>
                                <td className="px-4 py-3 text-surface-600 dark:text-surface-400 hidden sm:table-cell">
                                  <span className="block truncate max-w-[180px]">{r.recipient_name || '—'}</span>
                                  <span className="text-xs text-surface-500 truncate block max-w-[180px]">{r.recipient_email}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${statusBadge(r.status)}`}>
                                    {r.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-surface-500 text-xs hidden md:table-cell whitespace-nowrap">
                                  {formatDateTime(r.created_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {detailId ? (
                  <div className="xl:col-span-3">
                    <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm sticky top-4">
                      <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-surface-900 dark:text-surface-100">Request details</h3>
                        <button
                          type="button"
                          onClick={() => { setDetailId(null); setDetail(null); }}
                          className="text-surface-400 hover:text-surface-600 text-lg leading-none"
                          aria-label="Close details"
                        >
                          ×
                        </button>
                      </div>
                      {detailLoading ? (
                        <p className="p-8 text-center text-surface-500">Loading…</p>
                      ) : detail ? (
                        <div className="p-5 space-y-5 max-h-[calc(100vh-12rem)] overflow-y-auto">
                          <div>
                            <p className="text-lg font-semibold text-surface-900 dark:text-surface-100">{detail.title}</p>
                            <span className={`inline-flex mt-2 text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${statusBadge(detail.status)}`}>
                              {detail.status}
                            </span>
                          </div>

                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Recipient</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5">{detail.recipient_name || '—'}</dd>
                              <dd className="text-surface-500 text-xs">{detail.recipient_email}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">File</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5 truncate">{detail.document_original_name}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Sent</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5">{formatDateTime(detail.sent_at)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">First accessed</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5">{formatDateTime(detail.first_accessed_at)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Last accessed</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5">{formatDateTime(detail.last_accessed_at)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Signed</dt>
                              <dd className="text-surface-800 dark:text-surface-200 mt-0.5">{formatDateTime(detail.signed_at)}</dd>
                            </div>
                            {detail.status === 'signed' && detail.signer_latitude != null ? (
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Signing location</dt>
                                <dd className="text-surface-800 dark:text-surface-200 mt-0.5 font-mono text-xs">
                                  {detail.signer_latitude.toFixed(5)}, {detail.signer_longitude?.toFixed(5)}
                                  {detail.signer_location_accuracy != null ? ` · ±${Math.round(detail.signer_location_accuracy)}m` : ''}
                                </dd>
                              </div>
                            ) : null}
                            {detail.signer_id_number_full ? (
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-semibold uppercase tracking-wide text-surface-500">Signer ID</dt>
                                <dd className="text-surface-800 dark:text-surface-200 mt-0.5 font-mono">{detail.signer_id_number_full}</dd>
                              </div>
                            ) : null}
                          </dl>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => openAttachmentWithAuth(qsApi.documentUrl(detail.id, 'original'))}
                              className="px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 text-xs font-medium hover:bg-surface-50 dark:hover:bg-surface-800"
                            >
                              Original
                            </button>
                            {detail.has_signed_document ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openAttachmentWithAuth(qsApi.documentUrl(detail.id, 'signed'))}
                                  className="px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700"
                                >
                                  Signed record
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadAttachmentWithAuth(
                                      qsApi.documentUrl(detail.id, 'signed'),
                                      `signed-${detail.document_original_name || 'record'}.pdf`
                                    )
                                  }
                                  className="px-3 py-2 rounded-lg border border-brand-200 text-brand-700 text-xs font-medium"
                                >
                                  Download PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAttachmentWithAuth(qsApi.signatureImageUrl(detail.id))}
                                  className="px-3 py-2 rounded-lg border border-surface-300 text-xs font-medium"
                                >
                                  Signature
                                </button>
                              </>
                            ) : null}
                            {detail.status === 'draft' ? (
                              <button
                                type="button"
                                disabled={sending}
                                onClick={() => handleSend(detail.id)}
                                className="px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50"
                              >
                                {sending ? 'Sending…' : 'Send invitation'}
                              </button>
                            ) : null}
                            {detail.status !== 'signed' && detail.status !== 'cancelled' ? (
                              <button
                                type="button"
                                onClick={() => handleCancel(detail.id)}
                                className="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-xs font-medium"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>

                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500 mb-2">Activity log</h4>
                            <ul className="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800 text-xs max-h-40 overflow-y-auto">
                              {(detail.events || []).length === 0 ? (
                                <li className="px-3 py-4 text-surface-500 text-center">No activity yet.</li>
                              ) : (
                                detail.events.map((ev) => (
                                  <li key={ev.id} className="px-3 py-2.5 flex justify-between gap-3">
                                    <span className="text-surface-800 dark:text-surface-200">{eventLabel(ev.event_type)}</span>
                                    <span className="text-surface-500 shrink-0">{formatDateTime(ev.created_at)}</span>
                                  </li>
                                ))
                              )}
                            </ul>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
