import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import { companyLibrary as lib, profileManagement as pm } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import InfoHint from './components/InfoHint.jsx';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const b = Number(n);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function LibraryGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5h5.5L11 6h9v13a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 013 18.5v-9A1.5 1.5 0 014.5 8H4v-.5z" />
      <path strokeLinecap="round" d="M4 8V6.5A1.5 1.5 0 015.5 5H10" />
    </svg>
  );
}

function DocBadge({ doc }) {
  if (doc.is_private || doc.is_pin_protected) {
    return (
      <span className="inline-flex items-center rounded-md bg-violet-100/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
        Private
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-emerald-100/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
      Public
    </span>
  );
}

function expiryStatus(expiresAt) {
  if (!expiresAt) return { label: 'No expiry', className: 'text-surface-500' };
  const end = new Date(expiresAt);
  const now = new Date();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startOfEnd - startOfNow) / 86400000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, className: 'text-red-700 dark:text-red-300 font-semibold' };
  if (diffDays === 0) return { label: 'Expires today', className: 'text-amber-700 dark:text-amber-300 font-semibold' };
  if (diffDays <= 14) return { label: `${diffDays}d left`, className: 'text-amber-700 dark:text-amber-300 font-semibold' };
  return { label: `${diffDays}d left`, className: 'text-surface-600 dark:text-surface-400' };
}

const glassInput =
  'w-full rounded-lg border border-surface-200/70 dark:border-surface-600/60 bg-white/50 dark:bg-surface-900/35 backdrop-blur-sm px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400';
const btnPrimary =
  'px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 shadow-sm';
const btnSecondary =
  'px-4 py-2.5 rounded-xl border border-surface-200/70 dark:border-surface-600/60 bg-white/50 dark:bg-surface-900/35 backdrop-blur-sm text-sm font-semibold hover:bg-white/70 dark:hover:bg-surface-800/60 disabled:opacity-50';
const btnDanger =
  'px-4 py-2.5 rounded-xl border border-red-200/80 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-sm font-semibold hover:bg-red-100/90 dark:hover:bg-red-950/60 disabled:opacity-50';

function ReminderUserPicker({ users, selectedIds, onChange }) {
  const [query, setQuery] = useState('');
  const selected = useMemo(
    () => selectedIds.map((id) => users.find((u) => String(u.id) === String(id))).filter(Boolean),
    [selectedIds, users]
  );
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return users
      .filter((u) => {
        if (selectedIds.includes(String(u.id))) return false;
        const hay = `${u.full_name || ''} ${u.email || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 15);
  }, [query, users, selectedIds]);

  const addUser = (id) => {
    const s = String(id);
    if (!selectedIds.includes(s)) onChange([...selectedIds, s]);
    setQuery('');
  };

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200/80 bg-brand-50/80 dark:bg-brand-950/40 dark:border-brand-800/60 px-2.5 py-1 text-xs font-medium text-brand-900 dark:text-brand-100"
            >
              <span className="max-w-[12rem] truncate">{u.full_name || u.email}</span>
              <button
                type="button"
                className="text-brand-700 hover:text-brand-900 dark:text-brand-300 leading-none"
                aria-label={`Remove ${u.full_name || u.email}`}
                onClick={() => onChange(selectedIds.filter((x) => x !== String(u.id)))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="app-glass-toolbar flex items-center gap-2 px-3 py-1">
          <svg className="w-4 h-4 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email to add recipients…"
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-0"
            autoComplete="off"
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full rounded-xl border border-surface-200/80 dark:border-surface-600/60 bg-white/95 dark:bg-surface-900/95 backdrop-blur-xl py-1 shadow-lg max-h-52 overflow-auto">
            {suggestions.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-800/80"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addUser(u.id);
                  }}
                >
                  <span className="font-medium text-surface-900 dark:text-surface-50">{u.full_name || '—'}</span>
                  {u.email && <span className="block text-xs text-surface-500 truncate">{u.email}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && suggestions.length === 0 && (
          <p className="mt-1 text-xs text-surface-500 px-1">No users match &ldquo;{query.trim()}&rdquo;</p>
        )}
      </div>
      <p className="text-xs text-surface-500">
        {selected.length === 0 ? 'No reminder recipients yet.' : `${selected.length} recipient${selected.length === 1 ? '' : 's'} selected.`}
      </p>
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'catalog', label: 'Catalog & search' },
  { id: 'upload', label: 'Upload document' },
  { id: 'expiries', label: 'Document expiries' },
];

export default function CompanyLibrary() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const [navHidden, setNavHidden] = useSecondaryNavHidden('company-library');

  const [access, setAccess] = useState(null);
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('catalog');
  const [tenantUsers, setTenantUsers] = useState([]);
  const [accessInbox, setAccessInbox] = useState([]);
  const [emailBusy, setEmailBusy] = useState(false);

  const [upFolder, setUpFolder] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [upTitle, setUpTitle] = useState('');
  const [upFileName, setUpFileName] = useState('');
  const [upPrivate, setUpPrivate] = useState(true);
  const [upExpiry, setUpExpiry] = useState('');
  const [upLead, setUpLead] = useState('14');
  const [upReminders, setUpReminders] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [expiryDocs, setExpiryDocs] = useState([]);
  const [expiryLoading, setExpiryLoading] = useState(false);
  const [accessNote, setAccessNote] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteAuthPin, setDeleteAuthPin] = useState('');
  const [deleteCodeEmailBusy, setDeleteCodeEmailBusy] = useState(false);
  const [deleteCodeNotice, setDeleteCodeNotice] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canManageDoc = useCallback(
    (doc) => {
      if (!doc) return false;
      if (doc.is_owner) return true;
      if (isSuper) return true;
      return String(doc.uploaded_by) === String(user?.id);
    },
    [isSuper, user?.id]
  );

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
      const d = await lib.documents({
        q: searchQ.trim() || undefined,
        folder_id: folderFilter || undefined,
      });
      setDocuments(d.documents || []);
    } catch {
      setDocuments([]);
    }
  }, [searchQ, folderFilter]);

  const refreshInbox = useCallback(async () => {
    try {
      const d = await lib.accessInbox();
      setAccessInbox(d.requests || []);
    } catch {
      setAccessInbox([]);
    }
  }, []);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const a = await lib.access();
      setAccess(a);
      if (a.allowed_now) {
        await refreshFolders();
        await refreshDocs();
        await refreshInbox();
        pm.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => setTenantUsers([]));
      }
    } catch (e) {
      setError(e?.message || 'Could not load library');
    } finally {
      setLoading(false);
    }
  }, [refreshFolders, refreshDocs, refreshInbox]);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    if (!access?.allowed_now) return;
    const t = setTimeout(() => refreshDocs(), 280);
    return () => clearTimeout(t);
  }, [searchQ, folderFilter, access?.allowed_now, refreshDocs]);

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

  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  const folderLabel = useCallback(
    (fid) => {
      if (!fid) return '—';
      return folders.find((x) => String(x.id) === String(fid))?.name || '—';
    },
    [folders]
  );

  const expirySorted = useMemo(() => {
    const rows = [...(expiryDocs || [])];
    const withD = rows.filter((d) => d.expires_at);
    const noD = rows.filter((d) => !d.expires_at);
    withD.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
    const overdue = withD.filter((d) => expiryStatus(d.expires_at).label.includes('overdue'));
    const soon = withD.filter((d) => {
      const l = expiryStatus(d.expires_at).label;
      return !l.includes('overdue') && (l.includes('today') || (l.includes('left') && parseInt(l, 10) <= 14));
    });
    const later = withD.filter((d) => !overdue.includes(d) && !soon.includes(d));
    return { overdue, soon, later, noExpiry: noD };
  }, [expiryDocs]);

  const catalogDocs = useMemo(() => {
    const list = [...documents];
    list.sort(
      (a, b) =>
        (b.relevance_score || 0) - (a.relevance_score || 0) ||
        String(a.display_title).localeCompare(String(b.display_title))
    );
    return list;
  }, [documents]);

  const openDetail = async (id, opts = {}) => {
    setError('');
    setNotice('');
    setViewerOpen(false);
    setRenaming(!!opts.startRename);
    setRenameTitle('');
    setDeleteAuthPin('');
    setDeleteCodeNotice('');
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    try {
      const d = await lib.document(id);
      setSelected(d.document);
      if (opts.startRename) setRenameTitle(d.document?.display_title || '');
    } catch (e) {
      setError(e?.message || 'Could not open document');
    }
  };

  const startRename = () => {
    if (!selected) return;
    setRenameTitle(selected.display_title || '');
    setRenaming(true);
    setError('');
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameTitle('');
  };

  const saveRename = async () => {
    if (!selected) return;
    const title = renameTitle.trim();
    if (!title) {
      setError('Enter a display name.');
      return;
    }
    setRenameBusy(true);
    setError('');
    try {
      const d = await lib.patchDocument(selected.id, { display_title: title });
      setSelected(d.document);
      setRenaming(false);
      setNotice('Document renamed.');
      await refreshDocs();
      if (tab === 'expiries') {
        const all = await lib.documents({});
        setExpiryDocs(all.documents || []);
      }
    } catch (e) {
      setError(e?.message || 'Could not rename');
    } finally {
      setRenameBusy(false);
    }
  };

  const emailDeleteAuthorizationCode = async () => {
    if (!selected || !isSuper) return;
    setError('');
    setDeleteCodeNotice('');
    setDeleteCodeEmailBusy(true);
    try {
      const r = await lib.requestDocumentDeleteCode(selected.id);
      setDeleteCodeNotice(r.message || 'Check your email for the authorization code.');
    } catch (e) {
      setError(e?.message || 'Could not send email');
    } finally {
      setDeleteCodeEmailBusy(false);
    }
  };

  const deleteSelectedDocument = async () => {
    if (!selected || !isSuper) return;
    if (!deleteAuthPin.trim()) {
      setError('Enter the authorization code from your email.');
      return;
    }
    if (!window.confirm(`Permanently delete “${selected.display_title}”? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await lib.deleteDocument(selected.id, { authorization_pin: deleteAuthPin.trim() });
      setSelected(null);
      setRenaming(false);
      setDeleteAuthPin('');
      setDeleteCodeNotice('');
      setNotice('Document deleted.');
      await refreshDocs();
      if (tab === 'expiries') {
        const all = await lib.documents({});
        setExpiryDocs(all.documents || []);
      }
    } catch (e) {
      setError(e?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUpFileName(f.name);
    if (!upTitle.trim()) setUpTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const createFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setError('');
    try {
      const r = await lib.createFolder({ name: newFolderName.trim(), parent_folder_id: null });
      setNewFolderName('');
      await refreshFolders();
      const id = r.folder?.id || r.id;
      if (id) setUpFolder(String(id));
    } catch (err) {
      setError(err?.message || 'Could not create folder');
    }
  };

  const onUpload = async (e) => {
    e.preventDefault();
    if (!upFolder) {
      setError('Choose or create a folder first.');
      return;
    }
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder_id', upFolder);
      fd.append('display_title', (upTitle.trim() || file.name).slice(0, 500));
      fd.append('is_secured', upPrivate ? '1' : '0');
      if (upExpiry) fd.append('expires_at', upExpiry);
      fd.append('expiry_reminder_lead_days', upLead || '14');
      if (upReminders.length) fd.append('reminder_user_ids', JSON.stringify(upReminders));
      await lib.upload(fd);
      setNotice('Document uploaded successfully.');
      setUpTitle('');
      setUpFileName('');
      setUpExpiry('');
      setUpReminders([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshDocs();
      await refreshFolders();
      setTab('catalog');
    } catch (err) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const requestAccess = async () => {
    if (!selected) return;
    setError('');
    try {
      const r = await lib.requestAccess(selected.id, { note: accessNote.trim() });
      setNotice(r.message || 'Request sent.');
      await openDetail(selected.id);
    } catch (e) {
      setError(e?.message || 'Could not send request');
    }
  };

  const emailCopyToMe = async () => {
    if (!selected) return;
    setEmailBusy(true);
    setError('');
    try {
      const r = await lib.emailAttachment(selected.id, {});
      setNotice(r.message || `Emailed to ${r.to || user?.email}.`);
    } catch (e) {
      setError(e?.message || 'Could not send email');
    } finally {
      setEmailBusy(false);
    }
  };

  const lockDocument = async () => {
    if (!selected) return;
    if (!window.confirm('Lock this document? All live access for other users will end immediately.')) return;
    try {
      const r = await lib.lockDocument(selected.id);
      setNotice(r.message || 'Document locked.');
      await openDetail(selected.id);
      await refreshInbox();
    } catch (e) {
      setError(e?.message || 'Could not lock');
    }
  };

  const openViewer = async () => {
    if (!selected?.can_view && !selected?.is_public && !selected?.has_live_access) {
      setError('You need access before viewing this document.');
      return;
    }
    setError('');
    try {
      const res = await fetch(lib.previewUrl(selected.id), { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText);
      }
      const blob = await res.blob();
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
      setViewerOpen(true);
    } catch (e) {
      setError(e?.message || 'Could not open viewer');
    }
  };

  const approveRequest = async (requestId) => {
    try {
      const r = await lib.approveAccessRequest(requestId);
      setNotice(r.message || 'Approved.');
      await refreshInbox();
      if (selected) await openDetail(selected.id);
    } catch (e) {
      setError(e?.message || 'Could not approve');
    }
  };

  const denyRequest = async (requestId) => {
    try {
      await lib.denyAccessRequest(requestId);
      setNotice('Request denied.');
      await refreshInbox();
    } catch (e) {
      setError(e?.message || 'Could not deny');
    }
  };

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

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden relative -m-4 sm:-m-6">
      {access && !access.allowed_now && (
        <div className="absolute inset-x-0 top-0 z-10 mx-4 mt-4 sm:mx-6 rounded-lg border border-amber-200/90 bg-amber-50/90 dark:bg-amber-950/35 dark:border-amber-800/80 px-5 py-4 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-semibold">Library closed</p>
          <p className="mt-1 opacity-90">{access.message || 'Outside scheduled access hours.'}</p>
        </div>
      )}

      <nav
        className={`shrink-0 app-glass-secondary-nav flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${
          navHidden ? 'w-0 border-r-0' : 'w-72'
        }`}
        aria-label="Company library"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 shrink-0 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            <LibraryGlyph className="h-8 w-8 text-brand-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Company library</h2>
              <p className="text-[11px] text-surface-500 mt-0.5 leading-snug">Catalog · upload · expiries</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800"
            aria-label="Hide navigation"
            title="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 scrollbar-thin min-h-0 w-72">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    if (item.id !== 'catalog') setSelected(null);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    tab === item.id
                      ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium dark:bg-brand-950/40 dark:text-brand-100'
                      : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent dark:text-surface-300 dark:hover:bg-surface-800/50'
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          {accessInbox.length > 0 && (
            <div className="mt-4 px-4">
              <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                Pending access ({accessInbox.length})
              </p>
              <ul className="space-y-2 text-xs">
                {accessInbox.slice(0, 4).map((r) => (
                  <li key={r.id} className="app-glass-card p-2">
                    <p className="font-medium truncate">{r.document_title}</p>
                    <p className="text-surface-500 truncate">{r.requester_name}</p>
                    <div className="flex gap-2 mt-1">
                      <button type="button" className="text-brand-600 font-semibold" onClick={() => approveRequest(r.id)}>
                        Approve
                      </button>
                      <button type="button" className="text-surface-500" onClick={() => denyRequest(r.id)}>
                        Deny
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6 scrollbar-thin flex flex-col">
          {navHidden && (
            <button
              type="button"
              onClick={() => setNavHidden(false)}
              className="self-start flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border border-surface-200 bg-white/80 backdrop-blur-md text-surface-700 hover:bg-white text-sm font-medium shadow-sm dark:bg-surface-900/80 dark:border-surface-600 dark:text-surface-200"
              aria-label="Show navigation"
            >
              <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              Show navigation
            </button>
          )}

          <div className="w-full min-h-full flex-1 flex flex-col max-w-none">
            {(error || notice) && (
              <div
                className={`mb-4 text-sm rounded-lg px-4 py-3 border ${
                  error
                    ? 'text-red-800 dark:text-red-200 bg-red-50/90 dark:bg-red-950/35 border-red-200/80'
                    : 'text-emerald-900 dark:text-emerald-100 bg-emerald-50/90 dark:bg-emerald-950/35 border-emerald-200/80'
                }`}
              >
                <div className="flex justify-between gap-3">
                  <span>{error || notice}</span>
                  <button type="button" className="shrink-0 font-semibold hover:underline" onClick={() => { setError(''); setNotice(''); }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {!access?.allowed_now ? (
              <div className="app-glass-card p-8 text-center text-surface-600 dark:text-surface-400">
                <p>The library is not available right now. Check back during scheduled hours.</p>
              </div>
            ) : (
              <>
                {tab === 'upload' && (
                  <div className="w-full space-y-5 flex-1">
                    <div>
                      <h2 className="text-lg font-bold text-surface-900 dark:text-surface-50">Upload document</h2>
                      <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                        Select a folder, then upload. Private documents require owner approval for others to view or email.
                      </p>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-5 w-full">
                      <section className="app-glass-card p-5 space-y-4 h-fit">
                        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">1. Folder</h3>
                        <select value={upFolder} onChange={(e) => setUpFolder(e.target.value)} className={glassInput} required>
                          <option value="">Select folder…</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <form onSubmit={createFolder} className="flex gap-2">
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="New folder name"
                            className={glassInput}
                          />
                          <button type="submit" className={btnSecondary}>
                            Create
                          </button>
                        </form>
                      </section>

                      <form onSubmit={onUpload} className="app-glass-card p-5 space-y-4 lg:col-span-1">
                        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">2. File & details</h3>
                        <input ref={fileInputRef} type="file" className="text-sm w-full" onChange={onFilePicked} />
                        {upFileName && <p className="text-xs text-surface-500">Selected: {upFileName}</p>}
                        <div>
                          <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">Display name</label>
                          <input
                            type="text"
                            value={upTitle}
                            onChange={(e) => setUpTitle(e.target.value)}
                            placeholder="How it appears in the catalog"
                            className={glassInput}
                          />
                        </div>
                        <fieldset className="space-y-2">
                          <legend className="text-xs font-semibold uppercase text-surface-500">Visibility</legend>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="radio" checked={upPrivate} onChange={() => setUpPrivate(true)} />
                            Private — colleagues request access from you
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="radio" checked={!upPrivate} onChange={() => setUpPrivate(false)} />
                            Public — anyone in the library can view and email a copy
                          </label>
                        </fieldset>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">Expiry date</label>
                            <input type="date" value={upExpiry} onChange={(e) => setUpExpiry(e.target.value)} className={glassInput} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">Reminder lead (days)</label>
                            <input type="number" min={1} max={90} value={upLead} onChange={(e) => setUpLead(e.target.value)} className={glassInput} />
                          </div>
                        </div>
                        {tenantUsers.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-xs font-semibold uppercase text-surface-500">Expiry reminders</p>
                              <InfoHint title="Reminders" text="Search for colleagues by name or email. They receive an email before the document expires." />
                            </div>
                            <ReminderUserPicker users={tenantUsers} selectedIds={upReminders} onChange={setUpReminders} />
                          </div>
                        )}
                        <button type="submit" disabled={uploading || !upFolder} className={btnPrimary}>
                          {uploading ? 'Uploading…' : 'Upload to library'}
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {tab === 'catalog' && (
                  <div className="w-full flex-1 flex flex-col min-h-0 gap-5">
                    <div className="app-glass-toolbar p-4 flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 min-w-0">
                        <label className="text-xs font-semibold uppercase text-surface-500">Search catalog</label>
                        <input
                          type="search"
                          value={searchQ}
                          onChange={(e) => setSearchQ(e.target.value)}
                          placeholder="Title or file name…"
                          className={`mt-1 ${glassInput}`}
                        />
                      </div>
                      <div className="sm:w-56 shrink-0">
                        <label className="text-xs font-semibold uppercase text-surface-500">Folder</label>
                        <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} className={`mt-1 ${glassInput}`}>
                          <option value="">All folders</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {accessInbox.length > 0 && (
                      <div className="app-glass-card p-4 border-violet-200/60 dark:border-violet-800/50">
                        <h3 className="text-sm font-bold text-violet-900 dark:text-violet-100 mb-3">Access requests for your documents</h3>
                        <ul className="space-y-3">
                          {accessInbox.map((r) => (
                            <li
                              key={r.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-sm app-glass-toolbar px-4 py-3"
                            >
                              <div>
                                <p className="font-semibold">{r.document_title}</p>
                                <p className="text-surface-500">
                                  {r.requester_name} · {r.requester_email}
                                </p>
                                {r.requester_note && <p className="text-xs mt-1 italic">&ldquo;{r.requester_note}&rdquo;</p>}
                              </div>
                              <div className="flex gap-2">
                                <button type="button" className={btnPrimary} onClick={() => approveRequest(r.id)}>
                                  Approve
                                </button>
                                <button type="button" className={btnSecondary} onClick={() => denyRequest(r.id)}>
                                  Deny
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <ul className="app-glass-table flex-1 min-h-0 overflow-auto">
                      {catalogDocs.map((doc) => (
                        <li key={doc.id} className="app-glass-data-row last:border-b-0">
                          <div className="flex gap-2 items-stretch hover:bg-white/40 dark:hover:bg-surface-800/40">
                            <button
                              type="button"
                              onClick={() => openDetail(doc.id)}
                              className="flex-1 min-w-0 text-left px-4 py-4 flex gap-4 items-start"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-surface-900 dark:text-surface-50">{doc.display_title}</span>
                                  <DocBadge doc={doc} />
                                </div>
                                <p className="text-xs text-surface-500 mt-1">
                                  {folderLabel(doc.folder_id)} · {doc.uploader_name || '—'} · {formatDate(doc.created_at)}
                                  {doc.expires_at ? ` · Expires ${formatDate(doc.expires_at)}` : ''}
                                </p>
                              </div>
                              <span className="text-xs text-surface-400 shrink-0">{formatBytes(doc.size_bytes)}</span>
                            </button>
                            {(canManageDoc(doc) || isSuper) && (
                              <div className="flex flex-col justify-center gap-1 pr-3 py-2 shrink-0">
                                {canManageDoc(doc) && (
                                  <button
                                    type="button"
                                    className="text-xs font-semibold text-brand-600 hover:text-brand-800 dark:text-brand-400 px-2 py-1 rounded-md hover:bg-brand-50/80 dark:hover:bg-brand-950/40"
                                    onClick={() => openDetail(doc.id, { startRename: true })}
                                  >
                                    Rename
                                  </button>
                                )}
                                {isSuper && (
                                  <button
                                    type="button"
                                    className="text-xs font-semibold text-red-700 hover:text-red-900 dark:text-red-400 px-2 py-1 rounded-md hover:bg-red-50/80 dark:hover:bg-red-950/40"
                                    onClick={() => openDetail(doc.id)}
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                      {catalogDocs.length === 0 && (
                        <li className="p-12 text-center text-surface-500 text-sm">No documents match your search.</li>
                      )}
                    </ul>
                  </div>
                )}

                {tab === 'expiries' && (
                  <div className="w-full space-y-5 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-surface-900 dark:text-surface-50">Document expiries</h2>
                      <InfoHint title="Expiry monitoring" text="Overdue and upcoming items are grouped. Set expiry and reminder recipients when uploading." />
                    </div>
                    {expiryLoading ? (
                      <p className="text-sm text-surface-500">Loading…</p>
                    ) : (
                      <>
                        {['overdue', 'soon', 'later'].map((bucket) => {
                          const rows = expirySorted[bucket];
                          if (!rows?.length) return null;
                          const titles = { overdue: 'Overdue', soon: 'Expiring within 14 days', later: 'Later' };
                          return (
                            <section key={bucket} className="app-glass-table overflow-hidden">
                              <h3 className="px-4 py-3 text-sm font-bold app-glass-thead-row">{titles[bucket]} ({rows.length})</h3>
                              <ul>
                                {rows.map((doc) => {
                                  const st = expiryStatus(doc.expires_at);
                                  return (
                                    <li key={doc.id} className="app-glass-data-row last:border-b-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTab('catalog');
                                          openDetail(doc.id);
                                        }}
                                        className="w-full text-left px-4 py-3 flex justify-between gap-3"
                                      >
                                        <span className="font-medium">{doc.display_title}</span>
                                        <span className={`text-sm shrink-0 ${st.className}`}>
                                          {formatDate(doc.expires_at)} · {st.label}
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </section>
                          );
                        })}
                        {expirySorted.noExpiry.length > 0 && (
                          <p className="text-sm text-surface-500">{expirySorted.noExpiry.length} document(s) have no expiry date.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {selected && (tab === 'catalog' || tab === 'expiries') && access?.allowed_now && (
          <div className="shrink-0 border-t border-surface-200/70 dark:border-surface-700/70 app-glass-card rounded-none border-x-0 border-b-0 p-4 sm:p-5 max-h-[min(45vh,400px)] overflow-y-auto">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                {renaming && canManageDoc(selected) ? (
                  <div className="space-y-2 max-w-xl">
                    <label className="text-xs font-semibold uppercase text-surface-500">Display name</label>
                    <input
                      type="text"
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      className={glassInput}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnPrimary} disabled={renameBusy} onClick={saveRename}>
                        {renameBusy ? 'Saving…' : 'Save name'}
                      </button>
                      <button type="button" className={btnSecondary} disabled={renameBusy} onClick={cancelRename}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-surface-900 dark:text-surface-50">{selected.display_title}</h3>
                      <DocBadge doc={selected} />
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      {selected.file_name} · {folderLabel(selected.folder_id)} · {selected.uploader_name}
                    </p>
                    {selected.has_live_access && (
                      <p className="text-xs text-brand-600 mt-1 font-medium">Live access active until owner locks the document.</p>
                    )}
                  </>
                )}
              </div>
              <button type="button" className="text-sm text-surface-500 hover:underline shrink-0" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageDoc(selected) && !renaming && (
                <button type="button" className={btnSecondary} onClick={startRename}>
                  Rename
                </button>
              )}
              {selected.can_view && (
                <button type="button" className={btnPrimary} onClick={openViewer}>
                  View in library
                </button>
              )}
              {selected.can_email && (
                <button type="button" className={btnSecondary} disabled={emailBusy} onClick={emailCopyToMe}>
                  {emailBusy ? 'Sending…' : 'Email copy to me'}
                </button>
              )}
              {selected.needs_access_request && (
                <>
                  <input
                    type="text"
                    value={accessNote}
                    onChange={(e) => setAccessNote(e.target.value)}
                    placeholder="Optional note to owner"
                    className={`min-w-[12rem] flex-1 ${glassInput}`}
                  />
                  <button type="button" className={btnSecondary} onClick={requestAccess}>
                    Request access
                  </button>
                </>
              )}
              {selected.is_owner && selected.is_private && (
                <button type="button" className={btnSecondary} onClick={lockDocument}>
                  Lock document
                </button>
              )}
              {isSuper && selected.can_download && (
                <a href={lib.downloadUrl(selected.id)} className={btnSecondary} download>
                  Download (admin)
                </a>
              )}
            </div>
            {isSuper && (
              <div className="mt-4 pt-4 border-t border-surface-200/70 dark:border-surface-700/70 space-y-3">
                <p className="text-xs font-semibold uppercase text-surface-500">Delete document (super admin)</p>
                <p className="text-xs text-surface-600 dark:text-surface-400">
                  Request an email authorization code, then enter it below to permanently remove this file.
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={deleteCodeEmailBusy}
                    onClick={emailDeleteAuthorizationCode}
                  >
                    {deleteCodeEmailBusy ? 'Sending…' : 'Email me a code'}
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={deleteAuthPin}
                    onChange={(e) => setDeleteAuthPin(e.target.value)}
                    placeholder="Authorization code"
                    className={`w-40 ${glassInput}`}
                  />
                  <button type="button" className={btnDanger} disabled={deleting} onClick={deleteSelectedDocument}>
                    {deleting ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
                {deleteCodeNotice && <p className="text-xs text-emerald-700 dark:text-emerald-300">{deleteCodeNotice}</p>}
              </div>
            )}
            {viewerOpen && previewBlobUrl && (
              <div className="mt-4 rounded-xl border border-surface-200/70 overflow-hidden bg-surface-100/50 dark:bg-surface-950/50 min-h-[240px]">
                {String(selected.mime_type || '').includes('pdf') ? (
                  <iframe title="Document preview" src={previewBlobUrl} className="w-full h-[min(40vh,380px)]" />
                ) : String(selected.mime_type || '').startsWith('image/') ? (
                  <img src={previewBlobUrl} alt="" className="max-w-full max-h-[min(40vh,380px)] mx-auto block" />
                ) : (
                  <p className="p-6 text-sm text-surface-600 text-center">
                    Preview not available for this file type. Use &ldquo;Email copy to me&rdquo; to open from your inbox.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
