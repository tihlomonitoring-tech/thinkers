import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { caseManagement as caseApi, tenants as tenantsApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'cases', label: 'Cases' },
  { id: 'create', label: 'Create case' },
  { id: 'alerts', label: 'Alerts' },
];

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function CaseManagement() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const openCaseId = searchParams.get('case');
  const [navHidden, setNavHidden] = useSecondaryNavHidden('case-management');
  const [activeTab, setActiveTab] = useState('dashboard');
  useAutoHideNavAfterTabChange(activeTab);
  const [stats, setStats] = useState({});
  const [recent, setRecent] = useState([]);
  const [cases, setCases] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertScope, setAlertScope] = useState('involved');
  const [alertUnreadOnly, setAlertUnreadOnly] = useState(false);
  const [alertCaseId, setAlertCaseId] = useState('');
  const [tenantUsers, setTenantUsers] = useState([]);
  const [tenantOptions, setTenantOptions] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const loadDashboard = useCallback(async () => {
    const d = await caseApi.dashboard();
    setStats(d.stats || {});
    setRecent(d.recent || []);
  }, []);

  const loadCases = useCallback(async () => {
    const d = await caseApi.list({ search: search || undefined });
    setCases(d.cases || []);
  }, [search]);

  const loadAlerts = useCallback(async () => {
    const params = {};
    if (alertScope && alertScope !== 'involved') params.scope = alertScope;
    if (alertUnreadOnly) params.unread = '1';
    if (alertCaseId) params.case_id = alertCaseId;
    const d = await caseApi.alerts(params);
    setAlerts(d.alerts || []);
  }, [alertScope, alertUnreadOnly, alertCaseId]);

  const loadDetail = useCallback(async () => {
    if (!selectedCaseId) return;
    const d = await caseApi.get(selectedCaseId);
    setDetail(d);
  }, [selectedCaseId]);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      loadDashboard(),
      loadCases(),
      caseApi.tenantUsers().then((d) => setTenantUsers(d.users || [])),
      tenantsApi.list().then((d) => {
        const allowed = new Set([...(user?.tenant_ids || []), user?.tenant_id].filter(Boolean));
        setTenantOptions((d.tenants || []).filter((t) => allowed.has(t.id)));
      }),
    ])
      .catch((e) => setError(e?.message || 'Failed to load case management'))
      .finally(() => setLoading(false));
  }, [loadCases, loadDashboard, user?.tenant_id, user?.tenant_ids]);

  useEffect(() => {
    loadAlerts().catch(() => {});
  }, [loadAlerts]);

  useEffect(() => {
    loadDetail().catch(() => {});
  }, [loadDetail]);

  useEffect(() => {
    if (!openCaseId) return;
    setSelectedCaseId(openCaseId);
    setActiveTab('cases');
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('case');
        return n;
      },
      { replace: true }
    );
  }, [openCaseId, setSearchParams]);

  return (
    <div className="flex gap-0 w-full min-h-0 flex-1 -m-4 sm:-m-6 overflow-hidden">
      <nav className={`shrink-0 app-glass-secondary-nav flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Case management</h2>
            <p className="text-xs text-surface-500 mt-0.5">Advanced internal + external case workflows.</p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700">×</button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          <ul className="space-y-0.5">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                    activeTab === tab.id ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium' : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6">
        {navHidden && <button type="button" onClick={() => setNavHidden(false)} className="mb-3 px-3 py-2 rounded-lg border border-surface-200 bg-white text-sm">Show navigation</button>}
        {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>}
        {loading && <p className="text-surface-500 text-sm">Loading case management…</p>}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold text-surface-900">Case dashboard</h1>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                ['Total', stats.total || 0],
                ['Open', stats.open || 0],
                ['In progress', stats.in_progress || 0],
                ['Pending internal', stats.pending_internal || 0],
                ['Closed', stats.closed || 0],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-surface-200 bg-white p-4">
                  <p className="text-xs text-surface-500">{k}</p>
                  <p className="text-2xl font-semibold text-surface-900 mt-1">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-surface-200 bg-white p-4">
              <p className="font-medium text-surface-900 mb-2">Recent cases</p>
              <ul className="space-y-2">
                {recent.map((c) => {
                  const done = c.stages_completed != null ? Number(c.stages_completed) : 0;
                  const total = c.stage_count != null ? Number(c.stage_count) : 0;
                  const stepsLabel = total ? `${done}/${total} steps done` : 'No steps';
                  return (
                    <li key={c.id} className="text-sm border-b border-surface-100 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-surface-900">{c.case_number} · {c.title}</p>
                          <p className="text-xs text-surface-600 mt-1">
                            <span className="capitalize">{String(c.status || '—').replace(/_/g, ' ')}</span>
                            {c.category && <> · <span className="capitalize">{c.category}</span></>}
                            {c.lead_name && <> · Lead: {c.lead_name}</>}
                          </p>
                          <p className="text-xs text-surface-500 mt-0.5">{stepsLabel} · Opened {fmt(c.created_at)}</p>
                        </div>
                        <button type="button" className="shrink-0 text-brand-600 hover:underline" onClick={() => { setSelectedCaseId(c.id); setActiveTab('cases'); }}>Open</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
        {activeTab === 'cases' && (
          <CasesTab
            cases={cases}
            search={search}
            setSearch={setSearch}
            onSearch={() => loadCases().catch((e) => setError(e?.message || 'Search failed'))}
            selectedCaseId={selectedCaseId}
            setSelectedCaseId={setSelectedCaseId}
            detail={detail}
            tenantUsers={tenantUsers}
            onReload={async () => { await loadCases(); await loadDashboard(); await loadDetail(); await loadAlerts(); }}
          />
        )}
        {activeTab === 'create' && (
          <CreateCaseTab
            tenantUsers={tenantUsers}
            tenantOptions={tenantOptions}
            defaultTenantId={user?.tenant_id || ''}
            onCreated={async (caseId) => {
              setSelectedCaseId(caseId);
              setActiveTab('cases');
              await loadCases();
              await loadDashboard();
              await loadAlerts();
            }}
          />
        )}
        {activeTab === 'alerts' && (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold text-surface-900">Case alerts</h1>
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-200 bg-white p-3">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Show</label>
                <select value={alertScope} onChange={(e) => setAlertScope(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px]">
                  <option value="involved">Applicable to me (lead, opener, or assigned)</option>
                  <option value="directed">Directed at me only</option>
                  <option value="tenant">All alerts in tenant</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Case</label>
                <select value={alertCaseId} onChange={(e) => setAlertCaseId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[220px]">
                  <option value="">All cases</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.case_number} — {c.title}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-surface-700 pb-2">
                <input type="checkbox" checked={alertUnreadOnly} onChange={(e) => setAlertUnreadOnly(e.target.checked)} />
                Unread only
              </label>
            </div>
            <ul className="space-y-2">
              {alerts.length === 0 && <p className="text-sm text-surface-500">No alerts match these filters.</p>}
              {alerts.map((a) => (
                <li key={a.id} className={`rounded-lg border px-3 py-2 ${a.is_read ? 'bg-white border-surface-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-900">{a.title}</p>
                      <p className="text-xs text-surface-600">{a.message}</p>
                      {(a.case_number || a.case_title) && (
                        <p className="text-[11px] text-surface-500 mt-1">
                          {a.case_number && <span>{a.case_number}</span>}
                          {a.case_title && <span className="ml-1">· {a.case_title}</span>}
                          {a.case_status && <span className="ml-1 capitalize">({String(a.case_status).replace(/_/g, ' ')})</span>}
                        </p>
                      )}
                      <p className="text-[11px] text-surface-500 mt-1">{fmt(a.created_at)}</p>
                    </div>
                    {!a.is_read && <button type="button" onClick={async () => { await caseApi.markAlertRead(a.id); await loadAlerts(); }} className="shrink-0 text-sm text-brand-600 hover:underline">Mark read</button>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateCaseTab({ tenantUsers, tenantOptions, defaultTenantId, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('departmental');
  const [tenantId, setTenantId] = useState(defaultTenantId || '');
  const [openedSource, setOpenedSource] = useState('internal');
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [leadUserId, setLeadUserId] = useState('');
  const [stages, setStages] = useState([{ title: '', instructions: '', assigned_user_id: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-surface-900">Create case</h1>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError('');
          try {
            const d = await caseApi.create({
              title,
              description,
              category,
              tenant_id: tenantId || undefined,
              opened_source: openedSource,
              external_name: openedSource === 'external' ? externalName : undefined,
              external_email: openedSource === 'external' ? externalEmail : undefined,
              lead_user_id: leadUserId || undefined,
              stages: stages.map((s) => ({ ...s, title: String(s.title || '').trim() })).filter((s) => s.title),
            });
            onCreated?.(d.case?.id);
          } catch (err) {
            setError(err?.message || 'Could not create case');
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-surface-200 bg-white p-4 grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Case title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Case description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
              <option value="departmental">Departmental</option>
              <option value="external">External</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tenant allocation</label>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
              {tenantOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Opened by</label>
            <select value={openedSource} onChange={(e) => setOpenedSource(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
              <option value="internal">Internal user</option>
              <option value="external">External person</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Internal case lead</label>
            <select value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
              <option value="">Assign later</option>
              {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
          {openedSource === 'external' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">External name</label>
                <input value={externalName} onChange={(e) => setExternalName(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">External email</label>
                <input type="email" value={externalEmail} onChange={(e) => setExternalEmail(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-surface-900">Design case steps</p>
            <button type="button" onClick={() => setStages((s) => [...s, { title: '', instructions: '', assigned_user_id: '' }])} className="text-sm text-brand-600 hover:underline">+ Add stage</button>
          </div>
          {stages.map((s, i) => (
            <div key={i} className="grid md:grid-cols-3 gap-2 border border-surface-200 rounded-lg p-3">
              <input placeholder={`Stage ${i + 1} title`} value={s.title} onChange={(e) => setStages((prev) => prev.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <input placeholder="What must be done?" value={s.instructions} onChange={(e) => setStages((prev) => prev.map((x, idx) => idx === i ? { ...x, instructions: e.target.value } : x))} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <div className="flex items-center gap-2">
                <select value={s.assigned_user_id} onChange={(e) => setStages((prev) => prev.map((x, idx) => idx === i ? { ...x, assigned_user_id: e.target.value } : x))} className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm">
                  <option value="">Assign later</option>
                  {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
                <button type="button" onClick={() => setStages((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-red-600 hover:underline">Remove</button>
              </div>
            </div>
          ))}
        </div>
        <button type="submit" disabled={saving || !title.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create case'}
        </button>
      </form>
    </div>
  );
}

function CaseLinkedTasksPanel({ caseId, linkedTasks, canManage, onReload }) {
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    setPickerOpen(false);
    setSearch('');
    setLinkNote('');
    setSelectedTaskId('');
  }, [caseId]);

  useEffect(() => {
    if (!canManage || !pickerOpen) return;
    const t = setTimeout(() => {
      caseApi
        .linkableTasks(caseId, search)
        .then((d) => setCandidates(d.tasks || []))
        .catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(t);
  }, [caseId, search, canManage, pickerOpen]);

  useEffect(() => {
    if (!selectedTaskId) return;
    if (!candidates.some((t) => String(t.id) === String(selectedTaskId))) {
      setSelectedTaskId('');
    }
  }, [candidates, selectedTaskId]);

  const taskSelectSize = Math.min(12, Math.max(4, candidates.length + 1));

  return (
    <div className="rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 to-white p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-surface-900">Linked tasks</p>
          <p className="text-xs text-surface-600 mt-0.5 max-w-xl">
            Tie work items to this case. Links are allowed only when you are involved on both sides (case lead, opener, or step assignee—and task creator, leader, reviewer, or assignee).
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="text-sm font-medium text-indigo-700 hover:underline"
          >
            {pickerOpen ? 'Close picker' : '+ Link a task'}
          </button>
        ) : null}
      </div>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
      {canManage && pickerOpen ? (
        <div className="rounded-lg border border-surface-200 bg-white p-3 space-y-2">
          <label className="block text-xs font-medium text-surface-600" htmlFor={`link-task-search-${caseId}`}>
            Search tasks you can attach
          </label>
          <input
            id={`link-task-search-${caseId}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to filter by title…"
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            autoComplete="off"
          />
          <label className="block text-xs font-medium text-surface-600" htmlFor={`link-task-select-${caseId}`}>
            Matching tasks (select one)
          </label>
          <select
            id={`link-task-select-${caseId}`}
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm bg-white shadow-inner"
            size={taskSelectSize}
          >
            <option value="">{candidates.length ? '— Select a task —' : 'No tasks match — try another search'}</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} — {String(t.status || '').replace(/_/g, ' ')} · {t.progress ?? 0}% · due{' '}
                {t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}
              </option>
            ))}
          </select>
          <label className="block text-xs font-medium text-surface-600">Context (optional)</label>
          <input
            value={linkNote}
            onChange={(e) => setLinkNote(e.target.value)}
            placeholder="Why this task relates to the case…"
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !selectedTaskId}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            onClick={async () => {
              if (!selectedTaskId) return;
              setErr('');
              setBusy(true);
              try {
                await caseApi.linkTask(caseId, {
                  task_id: selectedTaskId,
                  link_note: linkNote.trim() || undefined,
                });
                await onReload();
                setPickerOpen(false);
                setLinkNote('');
                setSelectedTaskId('');
              } catch (e) {
                setErr(e?.message || 'Could not link');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Linking…' : 'Link selected task'}
          </button>
        </div>
      ) : null}
      {!canManage ? (
        <p className="text-xs text-surface-500">Only people involved on this case can add or remove task links.</p>
      ) : null}
      <ul className="space-y-2">
        {(linkedTasks || []).length === 0 ? (
          <li className="text-sm text-surface-500">No tasks linked yet.</li>
        ) : (
          linkedTasks.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-surface-200 bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <Link
                  to={`/tasks?openTask=${encodeURIComponent(l.task_id)}`}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  {l.task?.title || 'Task'}
                </Link>
                <p className="text-[11px] text-surface-500 mt-0.5 capitalize">
                  {String(l.task?.status || '').replace(/_/g, ' ')} · {l.task?.progress ?? 0}% · Due{' '}
                  {l.task?.due_date ? new Date(l.task.due_date).toLocaleDateString() : '—'}
                  {l.linked_by_name ? <> · Linked by {l.linked_by_name}</> : null}
                </p>
                {l.link_note ? <p className="text-xs text-surface-600 mt-1 italic">&ldquo;{l.link_note}&rdquo;</p> : null}
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={async () => {
                    if (!window.confirm('Remove this task link?')) return;
                    setErr('');
                    try {
                      await caseApi.unlinkTask(caseId, l.id);
                      await onReload();
                    } catch (e) {
                      setErr(e?.message || 'Could not unlink');
                    }
                  }}
                >
                  Unlink
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function CasesTab({ cases, search, setSearch, onSearch, selectedCaseId, setSelectedCaseId, detail, tenantUsers, onReload }) {
  const [leadUserId, setLeadUserId] = useState('');
  useEffect(() => {
    setLeadUserId(detail?.case?.lead_user_id || '');
  }, [detail?.case?.id, detail?.case?.lead_user_id]);
  const stageUpdatesById = useMemo(() => {
    const by = {};
    for (const u of detail?.updates || []) {
      const sid = u.stage_id;
      if (!by[sid]) by[sid] = [];
      by[sid].push(u);
    }
    return by;
  }, [detail?.updates]);
  return (
    <div className="grid lg:grid-cols-[360px,1fr] gap-4">
      <div className="rounded-xl border border-surface-200 bg-white p-3 space-y-3">
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case number/title" className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          <button type="button" onClick={onSearch} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">Go</button>
        </div>
        <ul className="space-y-2 max-h-[70vh] overflow-y-auto">
          {cases.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setSelectedCaseId(c.id)} className={`w-full text-left rounded-lg border px-3 py-2 ${selectedCaseId === c.id ? 'border-brand-400 bg-brand-50' : 'border-surface-200 bg-white'}`}>
                <p className="text-xs text-surface-500">{c.case_number}</p>
                <p className="text-sm font-medium text-surface-900">{c.title}</p>
                <p className="text-xs text-surface-600 mt-1">{c.status} · {c.category}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-surface-200 bg-white p-4">
        {!detail ? (
          <p className="text-sm text-surface-500">Select a case to view details, stages, comments, files, and progression.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-surface-900">{detail.case.case_number} · {detail.case.title}</h2>
              <p className="text-sm text-surface-600 mt-1">{detail.case.description || 'No description'}</p>
              <p className="text-xs text-surface-500 mt-1">Opened: {fmt(detail.case.created_at)} · Source: {detail.case.opened_source}</p>
            </div>
            <div className="rounded-lg border border-surface-200 p-3">
              <p className="text-sm font-medium text-surface-900 mb-2">Lead assignment</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
                  <option value="">Select lead</option>
                  {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
                <button type="button" onClick={async () => { await caseApi.assignLead(detail.case.id, leadUserId || null); await onReload(); }} className="px-3 py-2 rounded-lg border border-surface-300 text-sm">Save lead</button>
              </div>
            </div>
            <CaseLinkedTasksPanel
              caseId={detail.case.id}
              linkedTasks={detail.linked_tasks || []}
              canManage={!!detail.meta?.can_manage_task_links}
              onReload={onReload}
            />
            <div className="space-y-3">
              <p className="text-sm font-medium text-surface-900">Case stages</p>
              {(detail.stages || []).map((s) => (
                <StageCard key={s.id} caseId={detail.case.id} stage={s} updates={stageUpdatesById[s.id] || []} onSaved={onReload} />
              ))}
            </div>
            <div className="rounded-lg border border-surface-200 p-3">
              <p className="text-sm font-medium text-surface-900 mb-2">Final completion and closure</p>
              <FinalizeCase caseId={detail.case.id} canFinalize={(detail.stages || []).every((s) => s.status === 'completed')} onDone={onReload} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StageCard({ caseId, stage, updates, onSaved }) {
  const [status, setStatus] = useState(stage.status || 'pending');
  const [comment, setComment] = useState('');
  const [notifyExternal, setNotifyExternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  return (
    <div className="rounded-lg border border-surface-200 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-surface-900">Step {stage.stage_order}: {stage.title}</p>
          <p className="text-xs text-surface-600 mt-0.5">{stage.instructions || 'No instructions provided'}</p>
          <p className="text-xs text-surface-500 mt-0.5">Assigned: {stage.assigned_user_name || 'Unassigned'} · Current status: {stage.status}</p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={notifyExternal} onChange={(e) => setNotifyExternal(e.target.checked)} /> Notify external requester</label>
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Leave a timestamped progress comment…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
      <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="w-full text-xs" />
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await caseApi.addStageUpdate(caseId, stage.id, { status, comment, notify_external: notifyExternal, files });
            setComment('');
            setFiles([]);
            onSaved?.();
          } finally {
            setSaving(false);
          }
        }}
        className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save stage progress'}
      </button>
      {updates.length > 0 && (
        <ul className="space-y-2 max-h-52 overflow-y-auto border border-surface-100 rounded-lg p-2 bg-surface-50">
          {updates.map((u) => (
            <li key={u.id} className="text-xs">
              <p className="text-surface-500">{fmt(u.created_at)} · {u.actor_name || u.actor_type} · {u.status}</p>
              {u.comment && <p className="text-surface-700 whitespace-pre-wrap">{u.comment}</p>}
              {(u.attachments || []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {u.attachments.map((a) => (
                    <a key={a.id} href={caseApi.attachmentDownloadUrl(caseId, a.id)} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{a.file_name}</a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FinalizeCase({ caseId, canFinalize, onDone }) {
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2">
      <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Final completion remarks before case closure…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
      <button
        type="button"
        disabled={!canFinalize || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await caseApi.finalize(caseId, remarks);
            setRemarks('');
            onDone?.();
          } finally {
            setSaving(false);
          }
        }}
        className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
      >
        {saving ? 'Closing…' : canFinalize ? 'Finalize and close case' : 'Complete all stages first'}
      </button>
    </div>
  );
}
