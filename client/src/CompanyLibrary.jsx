import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { companyLibrary as lib, profileManagement as pm } from './api';
import InfoHint from './components/InfoHint.jsx';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function auditRowBadge(action) {
  const a = String(action || '');
  if (a === 'document_delete') return 'DEL';
  if (a.startsWith('library_email_attachment')) return 'EML';
  if (a.startsWith('library_pin')) return 'PIN';
  if (a === 'download_super_admin') return 'ADM';
  if (a === 'download') return 'GET';
  if (a.includes('denied') || a.includes('invalid')) return '!';
  return (a.slice(0, 4) || '—').toUpperCase();
}

function auditBadgeClass(action) {
  const a = String(action || '');
  if (a === 'document_delete') return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 ring-rose-200/60 dark:ring-rose-800/50';
  if (a.startsWith('library_email_attachment')) {
    return 'bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200 ring-teal-200/60 dark:ring-teal-800/50';
  }
  if (a.startsWith('library_pin')) {
    return 'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200 ring-violet-200/60 dark:ring-violet-800/50';
  }
  if (a === 'download_super_admin') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 ring-amber-200/60 dark:ring-amber-800/50';
  if (a.includes('denied') || a.includes('invalid')) return 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 ring-orange-200/60 dark:ring-orange-800/50';
  if (a.includes('download')) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 ring-emerald-200/60 dark:ring-emerald-800/50';
  return 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200 ring-surface-300/60 dark:ring-surface-600/50';
}

function LibraryGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5h5.5L11 6h9v13a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 013 18.5v-9A1.5 1.5 0 014.5 8H4v-.5z" />
      <path strokeLinecap="round" d="M4 8V6.5A1.5 1.5 0 015.5 5H10" />
    </svg>
  );
}

export default function CompanyLibrary() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const isMgmt = isSuper || (user?.page_roles || []).some((r) => String(r).toLowerCase() === 'management');

  const [access, setAccess] = useState(null);
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [folderId, setFolderId] = useState('');
  const [selected, setSelected] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [emailAttachBusy, setEmailAttachBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState('browse');

  const [upTitle, setUpTitle] = useState('');
  const [upFolder, setUpFolder] = useState('');
  const [upSecured, setUpSecured] = useState(false);
  const [upExpiry, setUpExpiry] = useState('');
  const [upLead, setUpLead] = useState('14');
  const [upReminders, setUpReminders] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [deleteAuthPin, setDeleteAuthPin] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteCodeEmailBusy, setDeleteCodeEmailBusy] = useState(false);
  const [deleteCodeEmailNotice, setDeleteCodeEmailNotice] = useState(null);
  const [requestNotice, setRequestNotice] = useState(null);
  const [auditSearchQ, setAuditSearchQ] = useState('');
  const [auditKind, setAuditKind] = useState('all');
  const [aiIntent, setAiIntent] = useState('');
  const [aiSearchBusy, setAiSearchBusy] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState([]);
  const [aiSearchMessage, setAiSearchMessage] = useState(null);
  const [expiryDocs, setExpiryDocs] = useState([]);
  const [expiryLoading, setExpiryLoading] = useState(false);

  const refreshFolders = useCallback(async () => {
    try {
      const d = await lib.folders();
      setFolders(d.folders || []);
    } catch {
      setFolders([]);
    }
  }, []);

  const refreshDocs = useCallback(async () => {
    try {
      const d = await lib.documents({ q: searchQ.trim() || undefined, folder_id: folderId || undefined });
      setDocuments(d.documents || []);
    } catch {
      setDocuments([]);
    }
  }, [searchQ, folderId]);

  const refreshAudit = useCallback(async () => {
    if (!isMgmt) return;
    try {
      const d = await lib.auditRecent(80);
      setAudit(d.entries || []);
    } catch {
      setAudit([]);
    }
  }, [isMgmt]);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const a = await lib.access();
      setAccess(a);
      if (a.allowed_now) {
        await refreshFolders();
        await refreshDocs();
        pm.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => setTenantUsers([]));
        if (isMgmt) await refreshAudit();
      }
    } catch (e) {
      setError(e?.message || 'Could not load library');
    } finally {
      setLoading(false);
    }
  }, [refreshFolders, refreshDocs, refreshAudit, isMgmt]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    if (!access?.allowed_now) return;
    const t = setTimeout(() => refreshDocs(), 300);
    return () => clearTimeout(t);
  }, [searchQ, folderId, access?.allowed_now, refreshDocs]);

  useEffect(() => {
    setAiSearchResults([]);
    setAiSearchMessage(null);
  }, [folderId]);

  useEffect(() => {
    if (tab !== 'expiries' || !access?.allowed_now) return;
    let cancelled = false;
    setExpiryLoading(true);
    lib
      .documents({})
      .then((d) => {
        if (!cancelled) setExpiryDocs(d.documents || []);
      })
      .catch(() => {
        if (!cancelled) setExpiryDocs([]);
      })
      .finally(() => {
        if (!cancelled) setExpiryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, access?.allowed_now]);

  const folderLabel = useCallback(
    (fid) => {
      if (!fid) return '—';
      const f = folders.find((x) => String(x.id) === String(fid));
      return f?.name || '—';
    },
    [folders]
  );

  const expirySorted = useMemo(() => {
    const rows = Array.isArray(expiryDocs) ? [...expiryDocs] : [];
    const withD = rows.filter((d) => d.expires_at);
    const noD = rows.filter((d) => !d.expires_at);
    withD.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
    return { withExpiry: withD, noExpiry: noD };
  }, [expiryDocs]);

  const expiryStatus = useCallback((expiresAt) => {
    if (!expiresAt) return { label: 'No date', className: 'text-surface-500' };
    const end = new Date(expiresAt);
    const now = new Date();
    const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((startOfEnd - startOfNow) / 86400000);
    if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, className: 'text-red-700 dark:text-red-300 font-semibold' };
    if (diffDays === 0) return { label: 'Today', className: 'text-amber-700 dark:text-amber-300 font-semibold' };
    if (diffDays <= 14) return { label: `In ${diffDays}d`, className: 'text-amber-700 dark:text-amber-300 font-semibold' };
    return { label: `In ${diffDays}d`, className: 'text-surface-600 dark:text-surface-400' };
  }, []);

  const openDetail = async (id) => {
    setError('');
    setSessionToken(null);
    setSessionExpiresAt(null);
    setCodeInput('');
    setDeleteAuthPin('');
    setDeleteCodeEmailNotice(null);
    setRequestNotice(null);
    try {
      const d = await lib.document(id);
      setSelected(d.document);
    } catch (e) {
      setError(e?.message || 'Could not open document');
    }
  };

  /** Secured docs: email system PIN to uploader (or super admin’s own email). */
  const requestSystemPin = async () => {
    if (!selected || !selected.is_pin_protected) return;
    setError('');
    setRequestNotice(null);
    try {
      const r = await lib.requestAccess(selected.id, {});
      setRequestNotice(r.message || 'Check email for the system PIN.');
    } catch (e) {
      setError(e?.message || 'Could not send PIN email');
    }
  };

  const verifyCode = async () => {
    if (!selected || !codeInput.trim()) return;
    setError('');
    try {
      const r = await lib.verifyCode(selected.id, codeInput.trim());
      const tok = r.session_token || r.grant_token;
      setSessionToken(tok || null);
      setSessionExpiresAt(r.expires_at || null);
      setRequestNotice(r.message || 'PIN verified. You can email the file to yourself.');
    } catch (e) {
      setError(e?.message || 'Verification failed');
    }
  };

  /** Email attachment to the signed-in user’s address (only delivery method). */
  const emailCopyToMe = async () => {
    if (!selected) return;
    setError('');
    setEmailAttachBusy(true);
    try {
      const body = {};
      if (selected.is_pin_protected) {
        if (!sessionToken) {
          setError('Verify the system PIN first — then you can email the file to yourself.');
          return;
        }
        body.session_token = sessionToken;
      }
      const r = await lib.emailAttachment(selected.id, body);
      setRequestNotice(r.message || `Sent to ${r.to || user?.email || 'your inbox'}.`);
    } catch (e) {
      setError(e?.message || 'Could not send email');
    } finally {
      setEmailAttachBusy(false);
    }
  };

  const onUpload = async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[type=file]');
    const file = input?.files?.[0];
    if (!file) {
      setError('Choose a file');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('display_title', upTitle.trim() || file.name);
      if (upFolder) fd.append('folder_id', upFolder);
      if (upSecured) fd.append('is_secured', '1');
      if (upExpiry) fd.append('expires_at', upExpiry);
      fd.append('expiry_reminder_lead_days', upLead || '14');
      if (upReminders.length) fd.append('reminder_user_ids', JSON.stringify(upReminders));
      await lib.upload(fd);
      setUpTitle('');
      setUpSecured(false);
      setUpExpiry('');
      input.value = '';
      await refreshDocs();
      await refreshFolders();
    } catch (err) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const createFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setError('');
    try {
      await lib.createFolder({ name: newFolderName.trim(), parent_folder_id: null });
      setNewFolderName('');
      await refreshFolders();
    } catch (err) {
      setError(err?.message || 'Could not create folder');
    }
  };

  const toggleReminderUser = (id) => {
    const s = String(id);
    setUpReminders((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const emailDeleteAuthorizationCode = async () => {
    if (!selected || !isSuper) return;
    setError('');
    setDeleteCodeEmailNotice(null);
    setDeleteCodeEmailBusy(true);
    try {
      const r = await lib.requestDocumentDeleteCode(selected.id);
      setDeleteCodeEmailNotice(r.message || 'Check your email for the code.');
    } catch (e) {
      setError(e?.message || 'Could not send email');
    } finally {
      setDeleteCodeEmailBusy(false);
    }
  };

  const filteredAudit = useMemo(() => {
    let rows = audit;
    if (auditKind === 'downloads') {
      rows = rows.filter((a) => {
        const x = String(a.action || '');
        return x.includes('download') || x.startsWith('library_');
      });
    } else if (auditKind === 'deletes') {
      rows = rows.filter((a) => String(a.action || '') === 'document_delete');
    }
    const q = auditSearchQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) => {
        const hay = [a.action, a.user_name, a.document_title, a.detail]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [audit, auditKind, auditSearchQ]);

  const runIntentSearch = async () => {
    const intent = aiIntent.trim();
    if (!intent) {
      setError('Describe what you need the document for.');
      return;
    }
    setAiSearchBusy(true);
    setError('');
    setAiSearchMessage(null);
    try {
      const body = { intent };
      if (folderId) body.folder_id = folderId;
      const d = await lib.intentSearch(body);
      setAiSearchResults(d.documents || []);
      setAiSearchMessage(d.message || null);
    } catch (e) {
      setError(e?.message || 'AI search failed');
      setAiSearchResults([]);
    } finally {
      setAiSearchBusy(false);
    }
  };

  const deleteSelectedDocument = async () => {
    if (!selected || !isSuper) return;
    if (!deleteAuthPin.trim()) {
      setError('Enter the code from your email (or your organisation’s fallback PIN if configured).');
      return;
    }
    if (!window.confirm(`Permanently delete “${selected.display_title}”? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await lib.deleteDocument(selected.id, { authorization_pin: deleteAuthPin.trim() });
      setSelected(null);
      setDeleteAuthPin('');
      setDeleteCodeEmailNotice(null);
      await refreshDocs();
      if (tab === 'expiries') {
        try {
          const d = await lib.documents({});
          setExpiryDocs(d.documents || []);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setError(e?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const inputSurface =
    'rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 shadow-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 dark:focus:border-brand-500';

  if (loading && !access) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-surface-600 dark:text-surface-400">
          <span className="h-9 w-9 rounded-full border-2 border-surface-200 border-t-brand-600 animate-spin" aria-hidden />
          <span className="text-sm font-medium">Loading library…</span>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'browse', label: 'Documents' },
    ...(isMgmt ? [{ id: 'audit', label: 'Audit trail' }] : []),
    { id: 'expiries', label: 'Monitor document expiries' },
  ];

  return (
    <div className="flex flex-col min-h-0 w-full -m-4 sm:-m-6 bg-surface-100 dark:bg-surface-950">
      {error && (
        <div className="shrink-0 z-10 mx-4 mt-4 sm:mx-6 text-sm text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/35 border border-red-200/80 dark:border-red-900/60 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">{error}</span>
          <button type="button" className="shrink-0 text-sm font-semibold hover:underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {access && !access.allowed_now && (
        <div className="shrink-0 mx-4 mt-4 sm:mx-6 rounded-lg border border-amber-200/90 bg-amber-50/90 dark:bg-amber-950/35 dark:border-amber-800/80 px-5 py-4 text-sm text-amber-950 dark:text-amber-100">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-amber-900 dark:text-amber-50">Library closed</p>
            <InfoHint
              title="Access schedule"
              text={
                [access.message || 'Outside allowed hours.', access.restricted ? 'Organisation policy limits when the library is open.' : '']
                  .filter(Boolean)
                  .join(' ') || '—'
              }
            />
          </div>
        </div>
      )}

      {access?.allowed_now && (
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <div className="flex md:hidden shrink-0 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-2 gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  if (item.id === 'audit') setSelected(null);
                }}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${
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
                <LibraryGlyph className="h-9 w-9 text-brand-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                  <h1 className="text-sm font-bold text-surface-900 dark:text-surface-50 leading-tight">Company library</h1>
                  <InfoHint
                    title="About this library"
                    bullets={[
                      'AI summaries for search; originals by email attachment only (no browser download).',
                      'Secured uploads: system PIN by email (uploader, or super admin’s own inbox).',
                      'Audit: PIN steps, emails sent, blocks, deletions.',
                    ]}
                  />
                </div>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5" aria-label="Library sections">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    if (item.id === 'audit') setSelected(null);
                  }}
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

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-surface-50/80 dark:bg-surface-900/40">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {tab === 'audit' && isMgmt && (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center min-w-0">
                    <label className="sr-only" htmlFor="lib-audit-search">
                      Search audit log
                    </label>
                    <input
                      id="lib-audit-search"
                      type="search"
                      value={auditSearchQ}
                      onChange={(e) => setAuditSearchQ(e.target.value)}
                      placeholder="Search title, user, action, or detail…"
                      className={`w-full sm:max-w-xl min-w-0 ${inputSurface}`}
                    />
                    <label className="sr-only" htmlFor="lib-audit-kind">
                      Event type
                    </label>
                    <select
                      id="lib-audit-kind"
                      value={auditKind}
                      onChange={(e) => setAuditKind(e.target.value)}
                      className={`w-full sm:w-56 shrink-0 ${inputSurface}`}
                    >
                      <option value="all">All events</option>
                      <option value="downloads">Email &amp; access only</option>
                      <option value="deletes">File removals only</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <InfoHint
                      title="What this log shows"
                      bullets={[
                        'Email deliveries, PIN workflow, blocked access, legacy download attempts.',
                        'Super-admin file removals.',
                        'Not logged: search, uploads, opening panels.',
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => refreshAudit()}
                      className="px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-semibold hover:bg-surface-50 dark:hover:bg-surface-800 shadow-sm"
                    >
                      Refresh list
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-surface-200/90 dark:border-surface-700 bg-surface-50/40 dark:bg-surface-950/30 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-surface-200/80 dark:border-surface-800 flex flex-wrap items-center justify-between gap-3 bg-white/70 dark:bg-surface-900/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-lg font-bold text-surface-900 dark:text-surface-50">
                        {filteredAudit.length} event{filteredAudit.length === 1 ? '' : 's'}
                        {auditSearchQ.trim() || auditKind !== 'all' ? ' · filtered' : ''}
                      </p>
                      <InfoHint
                        title="Reading the log"
                        text="Each row is one event. Expand detail in the list for recipient, file name, size, and JSON metadata where recorded."
                      />
                    </div>
                  </div>
                  <ul className="divide-y divide-surface-100 dark:divide-surface-800/90 max-h-[min(55vh,520px)] overflow-y-auto bg-white dark:bg-surface-900">
                    {filteredAudit.map((a) => (
                      <li key={a.id}>
                        <div className="w-full text-left px-4 sm:px-5 py-4 flex gap-4 transition-colors hover:bg-surface-50/90 dark:hover:bg-surface-800/30">
                          <div
                            className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-[10px] font-bold leading-tight text-center ring-1 ${auditBadgeClass(a.action)}`}
                          >
                            {auditRowBadge(a.action)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-surface-900 dark:text-surface-50 leading-snug">{a.document_title || a.action || 'Event'}</p>
                            <p className="text-xs text-surface-500 mt-1 truncate">
                              <span className="font-mono text-[11px] text-surface-600 dark:text-surface-400">{a.action}</span>
                              {' · '}
                              {a.user_name || '—'} · {formatDateTime(a.created_at)}
                            </p>
                            {a.detail ? (
                              <p className="text-sm text-surface-600 dark:text-surface-400 mt-2 line-clamp-3 leading-relaxed">{a.detail}</p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {filteredAudit.length === 0 && (
                    <p className="p-12 text-center text-surface-500 text-sm bg-white dark:bg-surface-900">
                      {audit.length === 0
                        ? 'No events yet.'
                        : 'No matches — adjust search or filters.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'browse' && (
              <div className="space-y-6 max-w-6xl">
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
                  <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400" htmlFor="lib-search">
                          Search
                        </label>
                        <InfoHint title="Search" text="Matches title, file name, and AI summary text." />
                      </div>
                      <input
                        id="lib-search"
                        type="search"
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Search by title, file name, or summary text…"
                        className={`w-full min-w-0 py-3 px-4 text-sm ${inputSurface}`}
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="sr-only" htmlFor="lib-folder">
                        Folder
                      </label>
                      <select
                        id="lib-folder"
                        value={folderId}
                        onChange={(e) => setFolderId(e.target.value)}
                        className={`w-full sm:max-w-xs shrink-0 ${inputSurface}`}
                      >
                        <option value="">All folders</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setToolsOpen((o) => !o)}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
                            toolsOpen
                              ? 'border-brand-400 bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200 dark:border-brand-600'
                              : 'border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700'
                          }`}
                        >
                          {toolsOpen ? 'Close add panel' : 'Add files or folder'}
                        </button>
                        <button
                          type="button"
                          onClick={() => loadAccess()}
                          className="px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-semibold hover:bg-surface-50 dark:hover:bg-surface-800"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                  {toolsOpen && (
                    <div className="grid gap-4 md:grid-cols-1 rounded-2xl border border-surface-200/90 dark:border-surface-700 bg-gradient-to-b from-surface-50/90 to-white dark:from-surface-800/30 dark:to-surface-900/40 p-4 sm:p-5 shadow-inner">
                      <div className="rounded-2xl border border-surface-200/80 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 sm:p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <p className="text-sm font-bold text-surface-900 dark:text-surface-50">Upload</p>
                          <InfoHint
                            title="AI analysis"
                            text="PDF, Word (.docx), Excel (.xlsx), CSV, and plain text are read for summaries. Other types use the file name only."
                          />
                        </div>
                        <form onSubmit={onUpload} className="space-y-3">
                          <input
                            type="file"
                            className="text-sm w-full file:mr-3 file:rounded-xl file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold dark:file:bg-brand-950"
                            required
                          />
                          <input
                            type="text"
                            value={upTitle}
                            onChange={(e) => setUpTitle(e.target.value)}
                            placeholder="Title shown in the library"
                            className={`w-full ${inputSurface}`}
                          />
                          <select
                            value={upFolder}
                            onChange={(e) => setUpFolder(e.target.value)}
                            className={`w-full ${inputSurface}`}
                          >
                            <option value="">Folder (optional)</option>
                            {folders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-3 rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50/80 dark:bg-surface-950/30 px-4 py-3">
                            <input
                              id="lib-up-secured"
                              type="checkbox"
                              checked={upSecured}
                              onChange={(e) => setUpSecured(e.target.checked)}
                              className="rounded border-surface-300 text-brand-600"
                            />
                            <label htmlFor="lib-up-secured" className="text-sm font-semibold text-surface-900 dark:text-surface-50 cursor-pointer">
                              Secured
                            </label>
                            <InfoHint
                              title="Secured uploads"
                              text="Recipients need the system PIN (emailed to the uploader, or to a super admin’s own address) before they can email themselves the file. No direct download."
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-surface-600 dark:text-surface-400">Expiry date (optional)</label>
                              <input
                                type="date"
                                value={upExpiry}
                                onChange={(e) => setUpExpiry(e.target.value)}
                                className={`mt-1 w-full ${inputSurface}`}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-surface-600 dark:text-surface-400">Remind N days before</label>
                              <input
                                type="number"
                                min={1}
                                max={90}
                                value={upLead}
                                onChange={(e) => setUpLead(e.target.value)}
                                className={`mt-1 w-full ${inputSurface}`}
                              />
                            </div>
                          </div>
                          <div className="max-h-28 overflow-y-auto rounded-xl border border-surface-200 dark:border-surface-700 p-3 text-xs space-y-1 bg-surface-50/50 dark:bg-surface-950/20">
                            <p className="text-surface-600 dark:text-surface-400 mb-1 font-semibold">Expiry email recipients</p>
                            {tenantUsers.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                                <input type="checkbox" checked={upReminders.includes(String(u.id))} onChange={() => toggleReminderUser(u.id)} />
                                <span>{u.full_name || u.email}</span>
                              </label>
                            ))}
                          </div>
                          <button
                            type="submit"
                            disabled={uploading}
                            className="w-full py-3 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 disabled:opacity-50 shadow-md shadow-brand-900/20"
                          >
                            {uploading ? 'Uploading…' : 'Upload and analyse'}
                          </button>
                        </form>
                      </div>
                      <div className="rounded-2xl border border-surface-200/80 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 sm:p-5 shadow-sm flex flex-col">
                        <div className="flex items-center gap-2 mb-4">
                          <p className="text-sm font-bold text-surface-900 dark:text-surface-50">New folder</p>
                          <InfoHint title="Folders" text="Optional grouping for filtering the catalogue." />
                        </div>
                        <form onSubmit={createFolder} className="flex flex-col gap-3 flex-1">
                          <input
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Folder name"
                            className={`w-full ${inputSurface}`}
                          />
                          <button
                            type="submit"
                            className="w-full py-3 rounded-xl bg-surface-800 dark:bg-surface-200 dark:text-surface-900 text-white text-sm font-bold"
                          >
                            Create folder
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">AI search</p>
                    <InfoHint title="AI search" text="Describe what you need; ranking uses library summaries and metadata." />
                  </div>
                  <label className="sr-only" htmlFor="lib-ai-intent">
                    What you need the document for
                  </label>
                  <textarea
                    id="lib-ai-intent"
                    value={aiIntent}
                    onChange={(e) => setAiIntent(e.target.value)}
                    rows={4}
                    placeholder="What do you need the document for?"
                    className={`w-full min-h-[100px] resize-y text-sm leading-relaxed ${inputSurface}`}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runIntentSearch()}
                      disabled={aiSearchBusy}
                      className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                    >
                      {aiSearchBusy ? 'Searching…' : 'Find relevant documents'}
                    </button>
                    {aiSearchResults.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAiSearchResults([]);
                          setAiSearchMessage(null);
                        }}
                        className="text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-brand-700"
                      >
                        Clear results
                      </button>
                    )}
                  </div>
                  {aiSearchMessage && (
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-lg px-3 py-2">
                      {aiSearchMessage}
                    </p>
                  )}
                  {aiSearchResults.length > 0 && (
                    <div className="mt-4 border-t border-surface-200 dark:border-surface-700 pt-4">
                      <p className="text-xs font-semibold text-surface-500 mb-2">Matches ({aiSearchResults.length})</p>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {aiSearchResults.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => openDetail(doc.id)}
                            className="w-full text-left rounded border border-surface-200 dark:border-surface-600 px-3 py-2 text-sm hover:bg-surface-50 dark:hover:bg-surface-800/60"
                          >
                            <span className="font-medium text-surface-900 dark:text-surface-50">{doc.display_title}</span>
                            {doc.relevance_score != null && (
                              <span className="ml-2 text-xs text-brand-700 dark:text-brand-300">{Math.round(doc.relevance_score)}%</span>
                            )}
                            {doc.match_reason && (
                              <span className="block text-xs text-surface-500 mt-0.5 line-clamp-2">{doc.match_reason}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex flex-wrap items-center justify-between gap-2 bg-surface-50/80 dark:bg-surface-800/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-surface-50 truncate">
                        {documents.length} document{documents.length === 1 ? '' : 's'}
                        {folderId ? ' · folder' : ''}
                      </p>
                      <InfoHint title="Catalogue" text="Select a row to open the side panel — email copy and secured flow." />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[min(65vh,640px)] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="sticky top-0 z-[1] bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-600">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300">Title</th>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300 hidden sm:table-cell">File</th>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300 hidden md:table-cell">Folder</th>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300 hidden lg:table-cell">Uploaded by</th>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300">Expires</th>
                          <th className="px-4 py-2.5 font-semibold text-surface-700 dark:text-surface-300 w-24">Secured</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                        {documents.map((doc) => {
                          const active = selected?.id === doc.id;
                          return (
                            <tr
                              key={doc.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openDetail(doc.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openDetail(doc.id);
                                }
                              }}
                              className={`cursor-pointer transition-colors ${
                                active ? 'bg-brand-50/90 dark:bg-brand-950/25' : 'hover:bg-surface-50 dark:hover:bg-surface-800/40'
                              }`}
                            >
                              <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-50 max-w-[220px] truncate">{doc.display_title}</td>
                              <td className="px-4 py-3 text-surface-600 dark:text-surface-400 hidden sm:table-cell max-w-[180px] truncate">{doc.file_name}</td>
                              <td className="px-4 py-3 text-surface-600 dark:text-surface-400 hidden md:table-cell">{folderLabel(doc.folder_id)}</td>
                              <td className="px-4 py-3 text-surface-600 dark:text-surface-400 hidden lg:table-cell truncate max-w-[140px]">
                                {doc.uploader_name || '—'}
                              </td>
                              <td className="px-4 py-3 text-surface-600 dark:text-surface-400 whitespace-nowrap">
                                {doc.expires_at ? formatDate(doc.expires_at) : '—'}
                              </td>
                              <td className="px-4 py-3">{doc.is_pin_protected ? <span className="text-xs font-medium text-violet-700 dark:text-violet-300">Yes</span> : <span className="text-surface-400">—</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {documents.length === 0 && (
                    <p className="p-8 text-center text-surface-500 text-sm">No documents match your search or folder filter.</p>
                  )}
                </div>
              </div>
            )}

            {tab === 'expiries' && (
              <div className="space-y-4 max-w-5xl">
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-surface-900 dark:text-surface-50">Document expiries</h2>
                    <InfoHint
                      title="Expiry monitor"
                      text="All folders, sorted by expiry. Items without a date are listed below the table."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExpiryLoading(true);
                      lib
                        .documents({})
                        .then((d) => setExpiryDocs(d.documents || []))
                        .catch(() => setExpiryDocs([]))
                        .finally(() => setExpiryLoading(false));
                    }}
                    className="mt-3 px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-600 text-sm font-medium hover:bg-surface-50 dark:hover:bg-surface-800"
                  >
                    Refresh list
                  </button>
                </div>
                {expiryLoading ? (
                  <p className="text-sm text-surface-500 px-1">Loading…</p>
                ) : (
                  <>
                    <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
                      <div className="px-4 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50/80 dark:bg-surface-800/40 text-xs font-semibold uppercase tracking-wide text-surface-500">
                        With expiry date ({expirySorted.withExpiry.length})
                      </div>
                      <div className="overflow-x-auto max-h-[min(50vh,480px)] overflow-y-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="sticky top-0 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-600">
                            <tr>
                              <th className="px-4 py-2 font-semibold">Title</th>
                              <th className="px-4 py-2 font-semibold hidden sm:table-cell">File</th>
                              <th className="px-4 py-2 font-semibold hidden md:table-cell">Folder</th>
                              <th className="px-4 py-2 font-semibold">Expires</th>
                              <th className="px-4 py-2 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                            {expirySorted.withExpiry.map((doc) => {
                              const st = expiryStatus(doc.expires_at);
                              const active = selected?.id === doc.id;
                              return (
                                <tr
                                  key={doc.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openDetail(doc.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openDetail(doc.id);
                                    }
                                  }}
                                  className={`cursor-pointer ${active ? 'bg-brand-50/90 dark:bg-brand-950/25' : 'hover:bg-surface-50 dark:hover:bg-surface-800/40'}`}
                                >
                                  <td className="px-4 py-2.5 font-medium text-surface-900 dark:text-surface-50 max-w-[200px] truncate">{doc.display_title}</td>
                                  <td className="px-4 py-2.5 text-surface-600 hidden sm:table-cell truncate max-w-[160px]">{doc.file_name}</td>
                                  <td className="px-4 py-2.5 text-surface-600 hidden md:table-cell">{folderLabel(doc.folder_id)}</td>
                                  <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(doc.expires_at)}</td>
                                  <td className={`px-4 py-2.5 text-xs font-medium ${st.className}`}>{st.label}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {expirySorted.withExpiry.length === 0 && (
                        <p className="p-6 text-center text-surface-500 text-sm">No documents have an expiry date set.</p>
                      )}
                    </div>
                    {expirySorted.noExpiry.length > 0 && (
                      <div className="rounded-lg border border-dashed border-surface-300 dark:border-surface-600 bg-white/60 dark:bg-surface-900/40 p-4">
                        <p className="text-xs font-semibold uppercase text-surface-500 mb-2">No expiry ({expirySorted.noExpiry.length})</p>
                        <ul className="text-sm text-surface-600 dark:text-surface-400 space-y-1 max-h-32 overflow-y-auto">
                          {expirySorted.noExpiry.map((d) => (
                            <li key={d.id}>
                              <button type="button" className="text-left hover:text-brand-700 dark:hover:text-brand-300 underline-offset-2 hover:underline" onClick={() => openDetail(d.id)}>
                                {d.display_title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {selected && (tab === 'browse' || tab === 'expiries') && (
          <div className="fixed inset-0 z-50 flex items-stretch" aria-modal="true" role="dialog" aria-label="Document details">
            <button
              type="button"
              className="flex-1 cursor-default border-0 bg-black/45 p-0"
              aria-label="Close document panel"
              onClick={() => setSelected(null)}
            />
            <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
                <h2 className="min-w-0 truncate text-base font-semibold text-surface-900 dark:text-surface-50">{selected.display_title}</h2>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="shrink-0 space-y-1 border-b border-surface-100 px-4 py-3 text-xs text-surface-600 dark:border-surface-800 dark:text-surface-400">
                <p>
                  <span className="font-semibold text-surface-800 dark:text-surface-200">File</span> {selected.file_name}
                </p>
                <p>
                  <span className="font-semibold text-surface-800 dark:text-surface-200">Uploaded by</span> {selected.uploader_name || '—'}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-4 dark:border-surface-700 dark:bg-surface-800/30 space-y-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-surface-900 dark:text-surface-50">Email copy</p>
                    <InfoHint
                      title="How delivery works"
                      text={
                        <>
                          <p>No browser download — attachment only.</p>
                          <p className="mt-2 font-medium text-surface-800 dark:text-surface-200 break-all">{user?.email || 'Your login email'}</p>
                          {selected.is_pin_protected ? (
                            <p className="mt-2">Secured: system PIN first (uploader inbox, or yours if super admin).</p>
                          ) : (
                            <p className="mt-2">Open: use the button below — no PIN.</p>
                          )}
                        </>
                      }
                    />
                  </div>

                  {!selected.is_pin_protected && (
                    <button
                      type="button"
                      onClick={emailCopyToMe}
                      disabled={emailAttachBusy}
                      className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {emailAttachBusy ? 'Sending…' : 'Email copy to me'}
                    </button>
                  )}

                  {selected.is_pin_protected && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-900">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-semibold text-surface-900 dark:text-surface-50">1 · PIN</p>
                          <InfoHint
                            title="Request PIN"
                            text={
                              isSuper
                                ? 'PIN is sent to your email. No uploader handoff.'
                                : `PIN is sent to the uploader (${selected.uploader_email || '—'}). They share it with you. If nothing arrives, check SMTP settings.`
                            }
                          />
                        </div>
                        <button
                          type="button"
                          onClick={requestSystemPin}
                          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
                        >
                          {isSuper ? 'Send PIN to me' : 'Send PIN to uploader'}
                        </button>
                      </div>
                      <div className="rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-900">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-semibold text-surface-900 dark:text-surface-50">2 · Verify</p>
                          <InfoHint title="Verify PIN" text="Unlocks a timed session for multiple attachment emails." />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            placeholder="System PIN from email"
                            className="min-w-0 flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-950"
                          />
                          <button
                            type="button"
                            onClick={verifyCode}
                            className="rounded-lg border border-surface-300 px-3 py-2 text-sm font-semibold dark:border-surface-600 dark:hover:bg-surface-800"
                          >
                            Verify
                          </button>
                        </div>
                        {sessionExpiresAt && (
                          <p className="mt-2 text-[11px] text-surface-500 tabular-nums">
                            Until {formatDateTime(sessionExpiresAt)}
                          </p>
                        )}
                      </div>
                      <div className="rounded-lg border border-surface-200 bg-white p-3 dark:border-surface-700 dark:bg-surface-900">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-semibold text-surface-900 dark:text-surface-50">3 · Attach</p>
                          <InfoHint title="Email attachment" text="Each send is logged. Repeat until the session expires." />
                        </div>
                        <button
                          type="button"
                          onClick={emailCopyToMe}
                          disabled={emailAttachBusy || !sessionToken}
                          className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                        >
                          {emailAttachBusy ? 'Sending…' : 'Email copy to me'}
                        </button>
                      </div>
                    </div>
                  )}

                  {requestNotice && (
                    <p className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400">
                      {requestNotice}
                    </p>
                  )}

                  {isSuper && (
                    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/70 p-4 dark:border-red-900/50 dark:bg-red-950/20">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-red-900 dark:text-red-200">Delete file</p>
                        <InfoHint
                          title="Delete authorization"
                          text="One-time code by email, or server fallback PIN if configured. Permanent removal."
                        />
                      </div>
                      <button
                        type="button"
                        onClick={emailDeleteAuthorizationCode}
                        disabled={deleteCodeEmailBusy}
                        className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-900 disabled:opacity-50 dark:border-red-800 dark:bg-surface-900 dark:text-red-100"
                      >
                        {deleteCodeEmailBusy ? 'Sending…' : 'Email delete code'}
                      </button>
                      {deleteCodeEmailNotice && (
                        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                          {deleteCodeEmailNotice}
                        </p>
                      )}
                      <div>
                        <label className="text-xs font-medium text-red-900 dark:text-red-200">Code</label>
                        <input
                          type="password"
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          value={deleteAuthPin}
                          onChange={(e) => setDeleteAuthPin(e.target.value)}
                          placeholder="8-digit code from email"
                          className="mt-1 w-full rounded-lg border border-red-200 px-3 py-2 text-sm dark:border-red-800 dark:bg-surface-900"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={deleteSelectedDocument}
                        disabled={deleting}
                        className="w-full rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        {deleting ? 'Removing…' : 'Delete permanently'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}
