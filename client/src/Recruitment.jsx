import { useState, useEffect, useMemo } from 'react';
import { recruitment as recruitmentApi, downloadAttachmentWithAuth, users as usersApi } from './api';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';

const ALL_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'recruit-registration', label: 'Recruit registration' },
  { id: 'cv-library', label: 'CV library' },
  { id: 'screening', label: 'Screening' },
  { id: 'interview', label: 'Interview' },
  { id: 'panel', label: 'Panel' },
  { id: 'results', label: 'Results' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'panel-members', label: 'Panel members' },
  { id: 'access', label: 'Access' },
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}
function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function Recruitment() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('recruitment');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [vacancies, setVacancies] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowedTabIds, setAllowedTabIds] = useState(null);

  useEffect(() => {
    recruitmentApi.vacancies.list()
      .then((r) => setVacancies(r.vacancies || []))
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    recruitmentApi.myTabs()
      .then((r) => setAllowedTabIds(r.tabs || []))
      .catch(() => setAllowedTabIds(ALL_TABS.map((t) => t.id)));
  }, []);

  useEffect(() => {
    recruitmentApi.applicants.list()
      .then((r) => setApplicants(r.applicants || []))
      .catch(() => setApplicants([]));
  }, [activeTab]);

  const isSuperAdmin = user?.role === 'super_admin';
  const baseTabs = allowedTabIds && allowedTabIds.length > 0 ? ALL_TABS.filter((t) => allowedTabIds.includes(t.id)) : ALL_TABS;
  const visibleTabs = isSuperAdmin ? baseTabs : baseTabs.filter((t) => t.id !== 'panel-members' && t.id !== 'access');
  const allowedTabIdSet = useMemo(() => new Set(visibleTabs.map((t) => t.id)), [visibleTabs]);
  const firstAllowedTabId = visibleTabs[0]?.id ?? 'dashboard';

  // Enforce: if user has no access to current tab (e.g. from quick link or URL), switch to first allowed tab
  useEffect(() => {
    if (allowedTabIds === null) return;
    if (!allowedTabIdSet.has(activeTab)) {
      setActiveTab(firstAllowedTabId);
    }
  }, [allowedTabIds, activeTab, firstAllowedTabId, allowedTabIdSet]);

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-label="Recruitment" aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Recruitment</h2>
            <p className="text-xs text-surface-500 mt-0.5">Vacancies, CVs, screening, interviews</p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          <div className="mb-4">
            <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">Recruitment</p>
            <ul className="space-y-0.5">
              {visibleTabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                      activeTab === tab.id
                        ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                        : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                    }`}
                  >
                    <span className="min-w-0 break-words">{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 scrollbar-thin flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {allowedTabIdSet.has(activeTab) && activeTab === 'dashboard' && (
            <TabDashboard vacancies={vacancies} applicants={applicants} loading={loading} setActiveTab={setActiveTab} allowedTabIds={allowedTabIdSet} />
          )}
          {allowedTabIdSet.has(activeTab) && activeTab === 'recruit-registration' && (
            <TabRecruitRegistration vacancies={vacancies} setVacancies={setVacancies} setError={setError} />
          )}
          {allowedTabIdSet.has(activeTab) && activeTab === 'cv-library' && <TabCvLibrary setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'screening' && <TabScreening vacancies={vacancies} setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'interview' && <TabInterview vacancies={vacancies} setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'panel' && <TabPanel vacancies={vacancies} setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'results' && <TabResults vacancies={vacancies} setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'appointments' && <TabAppointments vacancies={vacancies} setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'panel-members' && <TabPanelMembers setError={setError} />}
          {allowedTabIdSet.has(activeTab) && activeTab === 'access' && <TabAccess setError={setError} />}
        </div>
      </div>
    </div>
  );
}

/** Derive stage for pipeline: Screening → Interview → Appointment */
function getApplicantStage(a) {
  if (a?.appointment_id) return { stage: 'Appointment', status: (a.appointment_status || 'pending').toLowerCase(), key: 'appointment' };
  if (a?.has_panel_session) return { stage: 'Interview', status: 'conducted', key: 'interview-done' };
  if (a?.interview_invite_sent_at) return { stage: 'Interview', status: 'invited', key: 'interview-invited' };
  const verdict = (a?.screening_verdict || 'pending').toLowerCase();
  return { stage: 'Screening', status: verdict, key: `screening-${verdict}` };
}

function TabDashboard({ vacancies, applicants, loading, setActiveTab, allowedTabIds }) {
  const canAccess = (tabId) => allowedTabIds && allowedTabIds.has(tabId);
  const [filterVacancyId, setFilterVacancyId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [dashboardApplicants, setDashboardApplicants] = useState([]);
  const [tableLoading, setTableLoading] = useState(true);

  useEffect(() => {
    setTableLoading(true);
    const params = {};
    if (filterVacancyId) params.vacancy_id = filterVacancyId;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    recruitmentApi.applicants.list(Object.keys(params).length ? params : undefined)
      .then((r) => setDashboardApplicants(r.applicants || []))
      .catch(() => setDashboardApplicants([]))
      .finally(() => setTableLoading(false));
  }, [filterVacancyId, filterDateFrom, filterDateTo]);

  const open = vacancies.filter((v) => (v.status || '').toLowerCase() === 'open').length;
  const pending = applicants.filter((a) => (a.screening_verdict || '').toLowerCase() === 'pending').length;
  const passed = applicants.filter((a) => (a.screening_verdict || '').toLowerCase() === 'passed').length;
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Dashboard</h2>
      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {canAccess('recruit-registration') && (
              <button type="button" onClick={() => setActiveTab('recruit-registration')} className="p-4 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-300 hover:shadow-sm">
                <p className="text-2xl font-bold text-surface-900">{vacancies.length}</p>
                <p className="text-sm text-surface-600">Vacancies</p>
                <p className="text-xs text-surface-500 mt-1">{open} open</p>
              </button>
            )}
            {canAccess('cv-library') && (
              <button type="button" onClick={() => setActiveTab('cv-library')} className="p-4 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-300 hover:shadow-sm">
                <p className="text-2xl font-bold text-surface-900">CV Library</p>
                <p className="text-sm text-surface-600">Upload & organise CVs</p>
              </button>
            )}
            {canAccess('screening') && (
              <button type="button" onClick={() => setActiveTab('screening')} className="p-4 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-300 hover:shadow-sm">
                <p className="text-2xl font-bold text-surface-900">{applicants.length}</p>
                <p className="text-sm text-surface-600">Applicants</p>
                <p className="text-xs text-surface-500 mt-1">{pending} pending screening, {passed} passed</p>
              </button>
            )}
            {canAccess('appointments') && (
              <button type="button" onClick={() => setActiveTab('appointments')} className="p-4 rounded-xl border border-surface-200 bg-white text-left hover:border-brand-300 hover:shadow-sm">
                <p className="text-2xl font-bold text-surface-900">Appointments</p>
                <p className="text-sm text-surface-600">Offers & acceptances</p>
              </button>
            )}
          </div>

          <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <h3 className="font-medium text-surface-800">Applicants on screening – pipeline status</h3>
              <p className="text-xs text-surface-500">Each applicant goes through: Screening → Interview → Appointment</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-surface-600">
                <span>Recruit registration:</span>
                <select value={filterVacancyId} onChange={(e) => setFilterVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[180px]">
                  <option value="">All vacancies</option>
                  {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-surface-600">
                <span>From date:</span>
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-sm text-surface-600">
                <span>To date:</span>
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </label>
            </div>
            {tableLoading ? (
              <p className="text-surface-500 text-sm py-4">Loading applicants…</p>
            ) : dashboardApplicants.length === 0 ? (
              <p className="text-surface-500 text-sm py-4">No applicants match the filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-surface-200 text-left">
                      <th className="py-2 pr-4 font-medium text-surface-700">Name</th>
                      <th className="py-2 pr-4 font-medium text-surface-700">Recruit registration</th>
                      <th className="py-2 pr-4 font-medium text-surface-700">Stage</th>
                      <th className="py-2 pr-4 font-medium text-surface-700">Status</th>
                      <th className="py-2 pr-4 font-medium text-surface-700">Interview date</th>
                      <th className="py-2 font-medium text-surface-700">Date added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardApplicants.map((a) => {
                      const { stage, status } = getApplicantStage(a);
                      const statusLabel = stage === 'Screening' ? (status === 'passed' ? 'Passed' : status === 'rejected' ? 'Rejected' : 'Pending') : stage === 'Interview' ? (status === 'conducted' ? 'Conducted' : 'Invited') : (status === 'accepted' ? 'Accepted' : status === 'declined' ? 'Declined' : 'Pending');
                      const badge = stage === 'Screening' ? (status === 'passed' ? 'bg-emerald-100 text-emerald-800' : status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800') : stage === 'Interview' ? 'bg-blue-100 text-blue-800' : (status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : status === 'declined' ? 'bg-surface-200 text-surface-700' : 'bg-amber-100 text-amber-800');
                      return (
                        <tr key={a.id} className="border-b border-surface-100 hover:bg-surface-50">
                          <td className="py-2.5 pr-4 text-surface-900">{a.name || '—'}</td>
                          <td className="py-2.5 pr-4 text-surface-600">{a.vacancy_title || '—'}</td>
                          <td className="py-2.5 pr-4">{stage}</td>
                          <td className="py-2.5 pr-4">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${badge}`}>{statusLabel}</span>
                          </td>
                          <td className="py-2.5 pr-4 text-surface-600">{a.interview_date ? formatDateTime(a.interview_date) : '—'}</td>
                          <td className="py-2.5">{formatDate(a.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TabRecruitRegistration({ vacancies, setVacancies, setError }) {
  const [editingId, setEditingId] = useState(null);
  const [selectedVacancy, setSelectedVacancy] = useState(null);
  const [form, setForm] = useState({ title: '', role_title: '', description: '', requirements: '', status: 'draft' });
  const [saving, setSaving] = useState(false);

  const loadList = () => recruitmentApi.vacancies.list().then((r) => setVacancies(r.vacancies || []));

  const save = () => {
    if (!(form.title || '').trim()) { setError('Title is required'); return; }
    setSaving(true);
    const wasEditingId = editingId;
    (editingId ? recruitmentApi.vacancies.update(editingId, form) : recruitmentApi.vacancies.create(form))
      .then((r) => {
        setEditingId(null);
        setForm({ title: '', role_title: '', description: '', requirements: '', status: 'draft' });
        loadList();
        if (wasEditingId && r?.vacancy) setSelectedVacancy(r.vacancy);
      })
      .catch((e) => setError(e?.message || 'Save failed'))
      .finally(() => setSaving(false));
  };

  const edit = (v) => {
    setSelectedVacancy(null);
    setEditingId(v.id);
    setForm({ title: v.title || '', role_title: v.role_title || '', description: v.description || '', requirements: v.requirements || '', status: v.status || 'draft' });
  };

  const remove = (id) => {
    if (!window.confirm('Delete this vacancy?')) return;
    recruitmentApi.vacancies.delete(id).then(() => { loadList(); setSelectedVacancy((s) => (s?.id === id ? null : s)); }).catch((e) => setError(e?.message));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Recruit registration</h2>
      <p className="text-sm text-surface-600">Register a post or vacancy with full role details and descriptions. Click a vacancy to view full details.</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-3">
          {selectedVacancy ? (
            <>
              <h3 className="font-medium text-surface-800">Vacancy details</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Job title</p>
                  <p className="text-surface-900 mt-0.5">{selectedVacancy.title || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Role title</p>
                  <p className="text-surface-900 mt-0.5">{selectedVacancy.role_title || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Status</p>
                  <p className="mt-0.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      (selectedVacancy.status || '').toLowerCase() === 'open' ? 'bg-emerald-100 text-emerald-800' :
                      (selectedVacancy.status || '').toLowerCase() === 'closed' ? 'bg-surface-200 text-surface-700' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {selectedVacancy.status || 'draft'}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Full description</p>
                  <p className="text-surface-900 mt-0.5 whitespace-pre-wrap">{selectedVacancy.description || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Requirements</p>
                  <p className="text-surface-900 mt-0.5 whitespace-pre-wrap">{selectedVacancy.requirements || '—'}</p>
                </div>
                {selectedVacancy.created_at && (
                  <div>
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Created</p>
                    <p className="text-surface-600 mt-0.5">{formatDateTime(selectedVacancy.created_at)}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2 border-t border-surface-100">
                <button type="button" onClick={() => edit(selectedVacancy)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">Edit</button>
                <button type="button" onClick={() => setSelectedVacancy(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Back to list</button>
                <button type="button" onClick={() => remove(selectedVacancy.id)} className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm">Delete</button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-medium text-surface-800">{editingId ? 'Edit vacancy' : 'New vacancy'}</h3>
              <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Job title *" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <input type="text" value={form.role_title} onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))} placeholder="Role title" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Full description" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <textarea value={form.requirements} onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))} placeholder="Requirements" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">Save</button>
                {editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ title: '', role_title: '', description: '', requirements: '', status: 'draft' }); }} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Cancel</button>}
              </div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="font-medium text-surface-800 mb-2">Vacancies</h3>
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {vacancies.map((v) => (
              <li
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedVacancy(v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedVacancy(v); } }}
                className={`flex justify-between items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${selectedVacancy?.id === v.id ? 'border-brand-300 bg-brand-50' : 'border-surface-100 hover:bg-surface-50'}`}
              >
                <span className="font-medium text-surface-800 truncate">{v.title || 'Untitled'}</span>
                <span className="text-xs text-surface-500 shrink-0">{v.status}</span>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => edit(v)} className="text-brand-600 text-xs hover:underline">Edit</button>
                  <button type="button" onClick={() => remove(v.id)} className="text-red-600 text-xs hover:underline">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TabCvLibrary({ setError }) {
  const [folders, setFolders] = useState([]);
  const [cvs, setCvs] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewingCv, setViewingCv] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  /** Advanced filters: 'all' | 'yes' (linked to interview) | 'no' (not linked) */
  const [linkedToInterviewFilter, setLinkedToInterviewFilter] = useState('all');
  /** Search by file name (and applicant name/email) */
  const [fileSearch, setFileSearch] = useState('');

  const loadFolders = () => recruitmentApi.folders.list().then((r) => setFolders(r.folders || []));
  const loadCvs = () => {
    const opts = linkedToInterviewFilter === 'yes' ? { linked_to_interview: true } : linkedToInterviewFilter === 'no' ? { linked_to_interview: false } : {};
    return recruitmentApi.cvs.list(selectedFolderId || undefined, opts).then((r) => setCvs(r.cvs || []));
  };

  const filteredCvs = useMemo(() => {
    const q = (fileSearch || '').trim().toLowerCase();
    if (!q) return cvs;
    return cvs.filter((cv) => {
      const name = (cv.file_name || '').toLowerCase();
      const applicant = [cv.applicant_name, cv.applicant_email].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || applicant.includes(q);
    });
  }, [cvs, fileSearch]);

  useEffect(() => { loadFolders(); }, []);
  useEffect(() => { loadCvs(); }, [selectedFolderId, linkedToInterviewFilter]);

  useEffect(() => () => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
  }, [viewingCv?.url]);

  const addFolder = () => {
    if (!(newFolderName || '').trim()) return;
    recruitmentApi.folders.create({ name: newFolderName.trim() }).then(() => { setNewFolderName(''); loadFolders(); }).catch((e) => setError(e?.message));
  };

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    recruitmentApi.cvs.upload(file, { folder_id: selectedFolderId || undefined })
      .then(loadCvs)
      .catch((e) => setError(e?.message))
      .finally(() => { setUploading(false); e.target.value = ''; });
  };

  const viewCv = (cv) => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
    setViewingCv(null);
    setViewLoading(true);
    fetch(recruitmentApi.cvs.downloadUrl(cv.id), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          let msg = res.status === 401 ? 'Please sign in again' : 'Could not load CV';
          try {
            const data = await res.json();
            if (data?.error) msg = data.hint ? `${data.error}. ${data.hint}` : data.error;
          } catch (_) {}
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setViewingCv({ url, name: cv.file_name || 'CV', isPdf: (cv.file_name || '').toLowerCase().endsWith('.pdf') });
      })
      .catch((e) => setError(e?.message))
      .finally(() => setViewLoading(false));
  };

  const closeViewer = () => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
    setViewingCv(null);
  };

  const deleteCv = (id) => {
    if (!window.confirm('Delete this CV?')) return;
    recruitmentApi.cvs.delete(id).then(loadCvs).catch((e) => setError(e?.message));
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredCvs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredCvs.map((c) => c.id)));
  };

  const bulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected CV(s)?`)) return;
    setBulkDeleting(true);
    recruitmentApi.cvs.bulkDelete([...selectedIds])
      .then((r) => {
        setSelectedIds(new Set());
        loadCvs();
        if (r?.errors?.length) setError(`Deleted ${r.deleted?.length ?? 0}; some failed: ${r.errors.map((e) => e.message).join(', ')}`);
      })
      .catch((e) => setError(e?.message))
      .finally(() => setBulkDeleting(false));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">CV library</h2>
      <p className="text-sm text-surface-600">Upload CVs and organise them under folders. View on screen or download.</p>
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-2">
          <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="New folder name" className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-48" />
          <button type="button" onClick={addFolder} className="px-3 py-2 rounded-lg bg-surface-100 text-surface-700 text-sm font-medium">Add folder</button>
        </div>
        <label className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium cursor-pointer">
          Upload CV
          <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={onFileSelect} disabled={uploading} />
        </label>
      </div>

      <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
        <h3 className="text-sm font-semibold text-surface-800 mb-3">Advanced filters</h3>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-sm text-surface-600">Linked to interview step</span>
            <select
              value={linkedToInterviewFilter}
              onChange={(e) => setLinkedToInterviewFilter(e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white min-w-[140px]"
            >
              <option value="all">All CVs</option>
              <option value="yes">Yes – linked to interview</option>
              <option value="no">No – not linked</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-48 rounded-lg border border-surface-200 bg-white p-2">
          <p className="text-xs font-medium text-surface-500 uppercase mb-2">Folders</p>
          <button type="button" onClick={() => setSelectedFolderId('')} className={`block w-full text-left px-2 py-1 rounded text-sm ${!selectedFolderId ? 'bg-brand-100 text-brand-800' : 'text-surface-700'}`}>All</button>
          {folders.map((f) => (
            <button key={f.id} type="button" onClick={() => setSelectedFolderId(f.id)} className={`block w-full text-left px-2 py-1 rounded text-sm truncate ${selectedFolderId === f.id ? 'bg-brand-100 text-brand-800' : 'text-surface-700'}`}>{f.name}</button>
          ))}
        </div>
        <div className="flex-1 rounded-xl border border-surface-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
              <input
                type="search"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Search by file name or applicant…"
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-64 max-w-full"
                aria-label="Search file names"
              />
              <p className="text-sm text-surface-600">CVs {fileSearch.trim() ? `(${filteredCvs.length} of ${cvs.length})` : `(${cvs.length})`}</p>
            </div>
            <div className="flex items-center gap-2">
              {filteredCvs.length > 0 && (
                <>
                  <label className="inline-flex items-center gap-1.5 text-sm text-surface-600 cursor-pointer">
                    <input type="checkbox" checked={selectedIds.size === filteredCvs.length && filteredCvs.length > 0} onChange={selectAll} className="rounded border-surface-300" />
                    Select all
                  </label>
                  {selectedIds.size > 0 && (
                    <button type="button" onClick={bulkDelete} disabled={bulkDeleting} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                      {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.size})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <ul className="space-y-2">
            {filteredCvs.map((cv) => (
              <li key={cv.id} className={`flex justify-between items-center gap-2 p-2 rounded border ${selectedIds.has(cv.id) ? 'border-brand-300 bg-brand-50' : 'border-surface-100'}`}>
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.has(cv.id)} onChange={() => toggleSelect(cv.id)} className="rounded border-surface-300 shrink-0" />
                  <span className="text-sm text-surface-800 truncate" title={cv.file_name}>{cv.file_name}</span>
                </label>
                <span className="text-xs text-surface-500 shrink-0 flex items-center gap-2">
                  {cv.linked_to_interview && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-100 text-brand-800" title="This CV is linked to an applicant in the interview step">Interview</span>
                  )}
                  {cv.applicant_name || cv.applicant_email || '—'}
                </span>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => viewCv(cv)} className="px-2 py-1 rounded border border-brand-300 text-brand-700 text-xs font-medium hover:bg-brand-50">View</button>
                  <button type="button" onClick={() => downloadAttachmentWithAuth(recruitmentApi.cvs.downloadUrl(cv.id), cv.file_name).catch((e) => setError(e?.message))} className="px-2 py-1 rounded border border-surface-300 text-surface-700 text-xs hover:bg-surface-50">Download</button>
                  <button type="button" onClick={() => deleteCv(cv.id)} className="text-red-600 text-xs hover:underline">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {viewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl px-6 py-4 shadow-xl">Loading CV…</div>
        </div>
      )}
      {viewingCv && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" aria-modal="true" role="dialog">
          <div className="flex items-center justify-between gap-2 p-3 border-b border-surface-200 bg-surface-50 shrink-0">
            <h3 className="font-medium text-surface-800 truncate">{viewingCv.name}</h3>
            <button type="button" onClick={closeViewer} className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-100">Close</button>
          </div>
          <div className="flex-1 min-h-0 p-2">
            {viewingCv.isPdf ? (
              <iframe src={viewingCv.url} title={viewingCv.name} className="w-full h-full min-h-[70vh] rounded-lg border border-surface-200" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full min-h-[70vh] text-center p-6">
                <p className="text-surface-600 mb-2">Word documents (.doc / .docx) cannot be displayed in the browser.</p>
                <p className="text-sm text-surface-500 mb-4">Use the Download button to open the file on your device, or convert the CV to PDF for in-browser viewing.</p>
                <a href={viewingCv.url} download={viewingCv.name} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">Download file</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabScreening({ vacancies, setError }) {
  const [applicants, setApplicants] = useState([]);
  const [vacancyId, setVacancyId] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ screening_grade: '', screening_comments: '', screening_call_notes: '', screening_applicant_response: '', screening_verdict: 'pending' });
  const [inviteModal, setInviteModal] = useState(null);
  const [addApplicantModal, setAddApplicantModal] = useState(null);
  const [editApplicantModal, setEditApplicantModal] = useState(null);
  const [cvs, setCvs] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (vacancyId) recruitmentApi.applicants.list(vacancyId).then((r) => setApplicants(r.applicants || []));
    else recruitmentApi.applicants.list().then((r) => setApplicants(r.applicants || []));
  }, [vacancyId]);

  useEffect(() => {
    if (addApplicantModal || editApplicantModal) recruitmentApi.cvs.list().then((r) => setCvs(r.cvs || [])).catch(() => setCvs([]));
  }, [addApplicantModal, editApplicantModal]);

  useEffect(() => {
    if (selected) setForm({
      screening_grade: selected.screening_grade || '',
      screening_comments: selected.screening_comments || '',
      screening_call_notes: selected.screening_call_notes || '',
      screening_applicant_response: selected.screening_applicant_response || '',
      screening_verdict: selected.screening_verdict || 'pending',
    });
  }, [selected]);

  const saveScreening = () => {
    if (!selected) return;
    setSaving(true);
    recruitmentApi.applicants.update(selected.id, form)
      .then((r) => { setSelected(r.applicant); setApplicants((prev) => prev.map((a) => a.id === r.applicant.id ? r.applicant : a)); })
      .catch((e) => setError(e?.message))
      .finally(() => setSaving(false));
  };

  const sendInvite = () => {
    if (!inviteModal?.applicant?.id) return;
    const { interview_date, interview_location, interview_notes } = inviteModal;
    if (!(interview_date || '').trim()) { setError('Please set interview date and time'); return; }
    recruitmentApi.applicants.sendInterviewInvite(inviteModal.applicant.id, { interview_date, interview_location, interview_notes })
      .then((r) => { setInviteModal(null); setApplicants((prev) => prev.map((a) => a.id === r.applicant.id ? r.applicant : a)); if (selected?.id === r.applicant.id) setSelected(r.applicant); })
      .catch((e) => setError(e?.message));
  };

  const sendRegret = (applicant) => {
    if (!window.confirm(`Send regret email to ${applicant.name}?`)) return;
    recruitmentApi.applicants.sendRegret(applicant.id)
      .then((r) => setApplicants((prev) => prev.map((a) => a.id === r.applicant.id ? r.applicant : a)))
      .catch((e) => setError(e?.message));
  };

  const openAddApplicant = () => setAddApplicantModal({ vacancy_id: vacancyId || '', name: '', email: '', phone: '', cv_id: '' });
  const createApplicant = () => {
    const v = addApplicantModal?.vacancy_id;
    if (!v) { setError('Select a vacancy'); return; }
    if (!(addApplicantModal?.name || '').trim()) { setError('Name is required'); return; }
    recruitmentApi.applicants.create({ vacancy_id: v, name: addApplicantModal.name.trim(), email: (addApplicantModal.email || '').trim(), phone: (addApplicantModal.phone || '').trim(), cv_id: addApplicantModal.cv_id || undefined })
      .then((r) => { setApplicants((prev) => [r.applicant, ...prev]); setAddApplicantModal(null); setSelected(r.applicant); })
      .catch((e) => setError(e?.message));
  };

  const openEditApplicant = () => {
    if (!selected) return;
    setEditApplicantModal({ name: selected.name || '', email: selected.email || '', phone: selected.phone || '', cv_id: selected.cv_id || '' });
  };
  const saveEditApplicant = () => {
    if (!selected || !editApplicantModal) return;
    const name = (editApplicantModal.name || '').trim();
    const email = (editApplicantModal.email || '').trim();
    if (!name) { setError('Name is required'); return; }
    if (!email) { setError('Email is required'); return; }
    setSaving(true);
    recruitmentApi.applicants.update(selected.id, { name, email, phone: (editApplicantModal.phone || '').trim() || undefined, cv_id: editApplicantModal.cv_id || undefined })
      .then((r) => { setSelected(r.applicant); setApplicants((prev) => prev.map((a) => a.id === r.applicant.id ? r.applicant : a)); setEditApplicantModal(null); })
      .catch((e) => setError(e?.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Screening</h2>
      <p className="text-sm text-surface-600">Review CVs, grade, add comments, document calls and applicant response, make a verdict. Send interview invite or regret email.</p>
      <div className="flex gap-4 flex-wrap">
        <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
          <option value="">All vacancies</option>
          {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
        </select>
        <button type="button" onClick={openAddApplicant} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">Add applicant</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="font-medium text-surface-800 mb-2">Applicants</h3>
          <ul className="space-y-1 max-h-96 overflow-y-auto">
            {applicants.map((a) => (
              <li key={a.id} className={`p-2 rounded cursor-pointer ${selected?.id === a.id ? 'bg-brand-50 border border-brand-200' : 'hover:bg-surface-50 border border-transparent'}`} onClick={() => setSelected(a)}>
                <p className="font-medium text-surface-800">{a.name}</p>
                <p className="text-xs text-surface-500">{a.email} · {a.screening_verdict || 'pending'}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-3">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-medium text-surface-800">{selected.name}</h3>
                <button type="button" onClick={openEditApplicant} className="px-3 py-1.5 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50">Edit applicant</button>
              </div>
              <p className="text-xs text-surface-500">{selected.email}{selected.phone ? ` · ${selected.phone}` : ''}</p>
              <input type="text" value={form.screening_grade} onChange={(e) => setForm((f) => ({ ...f, screening_grade: e.target.value }))} placeholder="Grade" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <textarea value={form.screening_comments} onChange={(e) => setForm((f) => ({ ...f, screening_comments: e.target.value }))} placeholder="Comments" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <textarea value={form.screening_call_notes} onChange={(e) => setForm((f) => ({ ...f, screening_call_notes: e.target.value }))} placeholder="Call notes" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <textarea value={form.screening_applicant_response} onChange={(e) => setForm((f) => ({ ...f, screening_applicant_response: e.target.value }))} placeholder="Applicant response" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <select value={form.screening_verdict} onChange={(e) => setForm((f) => ({ ...f, screening_verdict: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="pending">Pending</option>
                <option value="passed">Passed</option>
                <option value="rejected">Rejected</option>
              </select>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveScreening} disabled={saving} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm">Save screening</button>
                <button type="button" onClick={() => setInviteModal({ applicant: selected, interview_date: '', interview_location: '', interview_notes: '' })} className="px-3 py-2 rounded-lg border border-surface-300 text-sm">Send interview invite</button>
                <button type="button" onClick={() => sendRegret(selected)} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm">Send regret email</button>
              </div>
            </>
          ) : (
            <p className="text-surface-500 text-sm">Select an applicant</p>
          )}
        </div>
      </div>
      {inviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setInviteModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Send interview invite</h3>
            <p className="text-sm text-surface-600 mb-3">To: {inviteModal.applicant?.name} ({inviteModal.applicant?.email})</p>
            <label className="block text-sm font-medium text-surface-700 mb-1">Interview date and time</label>
            <input type="datetime-local" value={inviteModal.interview_date} onChange={(e) => setInviteModal((m) => ({ ...m, interview_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <label className="block text-sm font-medium text-surface-700 mb-1">Location</label>
            <input type="text" value={inviteModal.interview_location} onChange={(e) => setInviteModal((m) => ({ ...m, interview_location: e.target.value }))} placeholder="Location" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <textarea value={inviteModal.interview_notes} onChange={(e) => setInviteModal((m) => ({ ...m, interview_notes: e.target.value }))} placeholder="Notes" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button type="button" onClick={sendInvite} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">Send</button>
              <button type="button" onClick={() => setInviteModal(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {addApplicantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddApplicantModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-3">Add applicant</h3>
            <select value={addApplicantModal.vacancy_id} onChange={(e) => setAddApplicantModal((m) => ({ ...m, vacancy_id: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" required>
              <option value="">Select vacancy *</option>
              {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
            <input type="text" value={addApplicantModal.name} onChange={(e) => setAddApplicantModal((m) => ({ ...m, name: e.target.value }))} placeholder="Name *" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <input type="email" value={addApplicantModal.email} onChange={(e) => setAddApplicantModal((m) => ({ ...m, email: e.target.value }))} placeholder="Email" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <input type="text" value={addApplicantModal.phone} onChange={(e) => setAddApplicantModal((m) => ({ ...m, phone: e.target.value }))} placeholder="Phone" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <select value={addApplicantModal.cv_id} onChange={(e) => setAddApplicantModal((m) => ({ ...m, cv_id: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4">
              <option value="">Link CV (optional)</option>
              {cvs.map((c) => <option key={c.id} value={c.id}>{c.file_name} {c.applicant_name ? `– ${c.applicant_name}` : ''}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={createApplicant} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">Add</button>
              <button type="button" onClick={() => setAddApplicantModal(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {editApplicantModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditApplicantModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-3">Edit applicant</h3>
            <input type="text" value={editApplicantModal.name} onChange={(e) => setEditApplicantModal((m) => ({ ...m, name: e.target.value }))} placeholder="Name *" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <input type="email" value={editApplicantModal.email} onChange={(e) => setEditApplicantModal((m) => ({ ...m, email: e.target.value }))} placeholder="Email *" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <input type="text" value={editApplicantModal.phone} onChange={(e) => setEditApplicantModal((m) => ({ ...m, phone: e.target.value }))} placeholder="Phone" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
            <select value={editApplicantModal.cv_id} onChange={(e) => setEditApplicantModal((m) => ({ ...m, cv_id: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4">
              <option value="">Link CV (optional)</option>
              {cvs.map((c) => <option key={c.id} value={c.id}>{c.file_name} {c.applicant_name ? `– ${c.applicant_name}` : ''}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={saveEditApplicant} disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setEditApplicantModal(null)} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabInterview({ vacancies, setError }) {
  const [vacancyId, setVacancyId] = useState('');
  const [questions, setQuestions] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ question_text: '', possible_answers: [], max_score: 10, sort_order: 0, allowed_asker_user_ids: [] });

  useEffect(() => {
    recruitmentApi.interviewQuestions.list(vacancyId || undefined).then((r) => setQuestions(r.questions || []));
  }, [vacancyId]);
  useEffect(() => {
    recruitmentApi.panelMembers.options().then((r) => setUsers(r.users || [])).catch(() => setUsers([]));
  }, []);

  const addQuestion = () => {
    if (!(form.question_text || '').trim()) return;
    recruitmentApi.interviewQuestions.create({
      ...form,
      vacancy_id: vacancyId || null,
      allowed_asker_user_ids: Array.isArray(form.allowed_asker_user_ids) && form.allowed_asker_user_ids.length > 0 ? form.allowed_asker_user_ids : undefined,
    })
      .then((r) => { setQuestions((prev) => [...prev, r.question]); setForm({ question_text: '', possible_answers: [], max_score: 10, sort_order: questions.length, allowed_asker_user_ids: [] }); })
      .catch((e) => setError(e?.message));
  };

  const toggleAsker = (userId) => {
    setForm((f) => ({
      ...f,
      allowed_asker_user_ids: f.allowed_asker_user_ids.includes(userId) ? f.allowed_asker_user_ids.filter((id) => id !== userId) : [...f.allowed_asker_user_ids, userId],
    }));
  };

  const removeQuestion = (id) => {
    if (!window.confirm('Delete this question?')) return;
    recruitmentApi.interviewQuestions.delete(id).then(() => setQuestions((prev) => prev.filter((q) => q.id !== id))).catch((e) => setError(e?.message));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Interview</h2>
      <p className="text-sm text-surface-600">Create interview questions with possible answers and grading sheet. Assign who can ask each question.</p>
      <div className="flex gap-4">
        <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
          <option value="">Global (all vacancies)</option>
          {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-4">
        <h3 className="font-medium text-surface-800">Add question</h3>
        <textarea value={form.question_text} onChange={(e) => setForm((f) => ({ ...f, question_text: e.target.value }))} placeholder="Question text" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        <div className="flex gap-2 items-center">
          <input type="number" value={form.max_score} onChange={(e) => setForm((f) => ({ ...f, max_score: Number(e.target.value) || 10 }))} min={1} className="w-20 rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          <span className="text-sm text-surface-600">Max score</span>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 mb-1">Who can ask this question (optional; leave empty = any panel member)</p>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 rounded border border-surface-200 bg-surface-50">
            {users.map((u) => (
              <label key={u.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form.allowed_asker_user_ids.includes(u.id)} onChange={() => toggleAsker(u.id)} className="rounded border-surface-300" />
                <span className="text-sm text-surface-800">{u.full_name || u.email}</span>
              </label>
            ))}
          </div>
        </div>
        <button type="button" onClick={addQuestion} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">Add question</button>
      </div>
      <div className="rounded-xl border border-surface-200 bg-white p-4">
        <h3 className="font-medium text-surface-800 mb-2">Questions ({questions.length})</h3>
        <ul className="space-y-2">
          {questions.map((q) => (
            <li key={q.id} className="flex justify-between items-start gap-2 p-3 rounded-lg border border-surface-100">
              <div>
                <p className="text-surface-800">{q.question_text}</p>
                <p className="text-xs text-surface-500">Max score: {q.max_score}{q.allowed_asker_user_ids?.length > 0 ? ` · Assigned askers: ${q.allowed_asker_user_ids.length}` : ''}</p>
              </div>
              <button type="button" onClick={() => removeQuestion(q.id)} className="text-red-600 text-xs">Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TabPanel({ vacancies, setError }) {
  const [applicants, setApplicants] = useState([]);
  const [vacancyId, setVacancyId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [scores, setScores] = useState([]);
  const [draftScores, setDraftScores] = useState({});
  const [filterApplicantName, setFilterApplicantName] = useState('');
  const [filterSessionApplicant, setFilterSessionApplicant] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterScoreMin, setFilterScoreMin] = useState('');
  const [filterScoreMax, setFilterScoreMax] = useState('');
  const [viewingCv, setViewingCv] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  useEffect(() => {
    if (vacancyId) {
      recruitmentApi.applicants.list(vacancyId).then((r) => setApplicants((r.applicants || []).filter((a) => (a.screening_verdict || '').toLowerCase() === 'passed')));
      recruitmentApi.panelSessions.list({ vacancy_id: vacancyId }).then((r) => setSessions(r.sessions || []));
      recruitmentApi.interviewQuestions.list(vacancyId).then((r) => setQuestions(r.questions || []));
    } else setApplicants([]);
  }, [vacancyId]);

  useEffect(() => {
    if (selectedSession) recruitmentApi.panelSessions.getScores(selectedSession.id).then((r) => setScores(r.scores || []));
    else setScores([]);
    setDraftScores({});
  }, [selectedSession]);

  const startSession = (applicantId) => {
    if (!applicantId || !vacancyId) return;
    recruitmentApi.panelSessions.create({ applicant_id: applicantId, vacancy_id: vacancyId })
      .then((r) => { setSessions((prev) => [r.session, ...prev]); setSelectedSession(r.session); })
      .catch((e) => setError(e?.message));
  };

  const saveScore = (questionId, score, comments) => {
    if (!selectedSession) return;
    recruitmentApi.panelSessions.saveScore(selectedSession.id, { question_id: questionId, score: score ?? null, comments: (comments ?? '').toString().trim() })
      .then((r) => { setScores(r.scores || []); setDraftScores((prev) => { const next = { ...prev }; delete next[questionId]; return next; }); })
      .catch((e) => setError(e?.message));
  };

  const getDisplayScore = (q, scoreRow) => {
    const d = draftScores[q.id];
    if (d?.score !== undefined && d?.score !== null) return d.score;
    return scoreRow?.score ?? '';
  };
  const getDisplayComments = (q, scoreRow) => {
    const d = draftScores[q.id];
    if (d?.comments !== undefined) return d.comments;
    return scoreRow?.comments ?? '';
  };
  const handleScoreChange = (q, scoreRow, value) => {
    const scoreVal = value === '' ? null : Number(value);
    setDraftScores((prev) => ({ ...prev, [q.id]: { score: scoreVal, comments: prev[q.id]?.comments ?? scoreRow?.comments ?? '' } }));
  };
  const handleCommentsChange = (q, scoreRow, value) => {
    setDraftScores((prev) => ({ ...prev, [q.id]: { score: prev[q.id]?.score ?? scoreRow?.score ?? null, comments: value } }));
  };
  const handleScoreBlur = (q, scoreRow) => {
    const d = draftScores[q.id];
    const score = d?.score !== undefined && d?.score !== null ? d.score : scoreRow?.score ?? null;
    const comments = d?.comments !== undefined ? d.comments : (scoreRow?.comments ?? '');
    saveScore(q.id, score, comments);
  };
  const handleCommentsBlur = (q, scoreRow) => {
    const d = draftScores[q.id];
    const score = d?.score !== undefined && d?.score !== null ? d.score : scoreRow?.score ?? null;
    const comments = d?.comments !== undefined ? d.comments : (scoreRow?.comments ?? '');
    saveScore(q.id, score, comments);
  };

  const applicantNameLower = (filterApplicantName || '').toLowerCase().trim();
  const filteredApplicants = applicantNameLower
    ? applicants.filter((a) => (a.name || '').toLowerCase().includes(applicantNameLower) || (a.email || '').toLowerCase().includes(applicantNameLower))
    : applicants;
  const sessionApplicantLower = (filterSessionApplicant || '').toLowerCase().trim();
  const filterDateFromVal = filterDateFrom ? new Date(filterDateFrom) : null;
  const filterDateToVal = filterDateTo ? new Date(filterDateTo) : null;
  const filterScoreMinNum = filterScoreMin === '' ? null : Number(filterScoreMin);
  const filterScoreMaxNum = filterScoreMax === '' ? null : Number(filterScoreMax);
  const filteredSessions = sessions.filter((s) => {
    if (sessionApplicantLower && !(s.applicant_name || '').toLowerCase().includes(sessionApplicantLower)) return false;
    const conducted = s.conducted_at ? new Date(s.conducted_at) : null;
    if (filterDateFromVal && conducted && conducted < filterDateFromVal) return false;
    if (filterDateToVal && conducted && conducted > filterDateToVal) return false;
    const total = s.total_score != null ? Number(s.total_score) : null;
    if (filterScoreMinNum != null && !isNaN(filterScoreMinNum) && (total == null || total < filterScoreMinNum)) return false;
    if (filterScoreMaxNum != null && !isNaN(filterScoreMaxNum) && (total == null || total > filterScoreMaxNum)) return false;
    return true;
  });
  const clearFilters = () => {
    setFilterApplicantName('');
    setFilterSessionApplicant('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterScoreMin('');
    setFilterScoreMax('');
  };

  useEffect(() => () => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
  }, [viewingCv?.url]);

  const viewCvPanel = (cvId, fileName) => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
    setViewingCv(null);
    setViewLoading(true);
    fetch(recruitmentApi.cvs.downloadUrl(cvId), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          let msg = res.status === 401 ? 'Please sign in again' : 'Could not load CV';
          try {
            const data = await res.json();
            if (data?.error) msg = data.hint ? `${data.error}. ${data.hint}` : data.error;
          } catch (_) {}
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const name = fileName || 'CV';
        setViewingCv({ url, name, isPdf: (name || '').toLowerCase().endsWith('.pdf') });
      })
      .catch((e) => setError(e?.message))
      .finally(() => setViewLoading(false));
  };

  const closeCvViewer = () => {
    if (viewingCv?.url) URL.revokeObjectURL(viewingCv.url);
    setViewingCv(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Panel</h2>
      <p className="text-sm text-surface-600">Pick questions from the Interview tab and grade the interviewee. Add comments on scoring. Changes save when you leave each field.</p>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-surface-500">Vacancy</span>
          <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[180px]">
            <option value="">Select vacancy</option>
            {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4">
        <h3 className="font-medium text-surface-800 mb-2">Advanced filters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Applicant name (evaluation list)</span>
            <input type="text" value={filterApplicantName} onChange={(e) => setFilterApplicantName(e.target.value)} placeholder="Search applicants" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Session applicant</span>
            <input type="text" value={filterSessionApplicant} onChange={(e) => setFilterSessionApplicant(e.target.value)} placeholder="Filter sessions by name" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Date from</span>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Date to</span>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Min total score</span>
            <input type="number" min={0} value={filterScoreMin} onChange={(e) => setFilterScoreMin(e.target.value)} placeholder="Min" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-surface-500">Max total score</span>
            <input type="number" min={0} value={filterScoreMax} onChange={(e) => setFilterScoreMax(e.target.value)} placeholder="Max" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={clearFilters} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-600 text-sm hover:bg-surface-50">Clear filters</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="font-medium text-surface-800 mb-2">Start evaluation</h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {filteredApplicants.map((a) => (
              <li key={a.id} className="flex justify-between items-center p-2 rounded border border-surface-100">
                <span>{a.name}</span>
                <button type="button" onClick={() => startSession(a.id)} className="text-brand-600 text-sm">Start</button>
              </li>
            ))}
          </ul>
          {applicantNameLower ? <p className="text-xs text-surface-500 mt-1">Showing {filteredApplicants.length} of {applicants.length} applicants</p> : null}
          <h3 className="font-medium text-surface-800 mt-4 mb-2">Sessions</h3>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {filteredSessions.map((s) => (
              <li key={s.id} className={`p-2 rounded cursor-pointer border border-surface-100 ${selectedSession?.id === s.id ? 'bg-brand-50' : 'hover:bg-surface-50'}`} onClick={() => setSelectedSession(s)}>
                {s.applicant_name} · {s.total_score != null ? s.total_score : '—'}
                {s.conducted_at ? <span className="block text-xs text-surface-500">{formatDateTime(s.conducted_at)}</span> : null}
              </li>
            ))}
          </ul>
          {(filterSessionApplicant || filterDateFrom || filterDateTo || filterScoreMin !== '' || filterScoreMax !== '') ? <p className="text-xs text-surface-500 mt-1">Showing {filteredSessions.length} of {sessions.length} sessions</p> : null}
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          {selectedSession ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="font-medium text-surface-800">{selectedSession.applicant_name}</h3>
                {selectedSession.applicant_cv_id ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => viewCvPanel(selectedSession.applicant_cv_id, selectedSession.applicant_cv_file_name)} className="px-3 py-1.5 rounded-lg border border-brand-300 text-brand-700 text-sm font-medium hover:bg-brand-50">View CV</button>
                    <button type="button" onClick={() => downloadAttachmentWithAuth(recruitmentApi.cvs.downloadUrl(selectedSession.applicant_cv_id), selectedSession.applicant_cv_file_name || 'CV.pdf').catch((e) => setError(e?.message))} className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50">Download CV</button>
                  </div>
                ) : (
                  <span className="text-xs text-surface-500">No CV linked</span>
                )}
              </div>
              <p className="text-xs text-surface-500 mb-3">Score and comment per question; changes save when you leave the field.</p>
              {questions.map((q) => {
                const scoreRow = scores.find((sc) => sc.question_id === q.id);
                return (
                  <div key={q.id} className="mb-3 p-2 rounded border border-surface-100">
                    <p className="text-sm text-surface-800">{q.question_text}</p>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="number"
                        placeholder="Score"
                        min={0}
                        max={q.max_score}
                        value={getDisplayScore(q, scoreRow)}
                        onChange={(e) => handleScoreChange(q, scoreRow, e.target.value)}
                        onBlur={() => handleScoreBlur(q, scoreRow)}
                        className="w-20 rounded border border-surface-300 px-2 py-1.5 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Comments"
                        value={getDisplayComments(q, scoreRow)}
                        onChange={(e) => handleCommentsChange(q, scoreRow, e.target.value)}
                        onBlur={() => handleCommentsBlur(q, scoreRow)}
                        className="flex-1 rounded border border-surface-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                );
              })}
              <div className="mt-4 pt-3 border-t border-surface-200">
                <h4 className="text-sm font-medium text-surface-800 mb-2">Add question</h4>
                <p className="text-xs text-surface-500 mb-2">New questions are added to the Interview list for this vacancy and linked to you as the asker.</p>
                <AddQuestionForm sessionId={selectedSession.id} vacancyId={selectedSession.vacancy_id} onAdded={() => { recruitmentApi.panelSessions.getScores(selectedSession.id).then((r) => setScores(r.scores || [])); recruitmentApi.interviewQuestions.list(selectedSession.vacancy_id).then((r) => setQuestions(r.questions || [])); }} setError={setError} />
              </div>
              <button type="button" onClick={() => recruitmentApi.panelSessions.update(selectedSession.id, { total_score: scores.reduce((a, s) => a + (Number(s.score) || 0), 0) }).then(() => setSelectedSession((s) => ({ ...s, total_score: scores.reduce((a, s) => a + (Number(s.score) || 0), 0) })))} className="mt-2 px-3 py-2 rounded-lg bg-surface-100 text-sm">Update total score</button>
            </>
          ) : (
            <p className="text-surface-500 text-sm">Select or start a session</p>
          )}
        </div>
      </div>

      {viewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl px-6 py-4 shadow-xl">Loading CV…</div>
        </div>
      )}
      {viewingCv && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" aria-modal="true" role="dialog">
          <div className="flex items-center justify-between gap-2 p-3 border-b border-surface-200 bg-surface-50 shrink-0">
            <h3 className="font-medium text-surface-800 truncate">{viewingCv.name}</h3>
            <button type="button" onClick={closeCvViewer} className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-100">Close</button>
          </div>
          <div className="flex-1 min-h-0 p-2">
            {viewingCv.isPdf ? (
              <iframe src={viewingCv.url} title={viewingCv.name} className="w-full h-full min-h-[70vh] rounded-lg border border-surface-200" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full min-h-[70vh] text-center p-6">
                <p className="text-surface-600 mb-2">Word documents (.doc / .docx) cannot be displayed in the browser.</p>
                <p className="text-sm text-surface-500 mb-4">Use the Download button to open the file on your device, or convert the CV to PDF for in-browser viewing.</p>
                <a href={viewingCv.url} download={viewingCv.name} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">Download file</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddQuestionForm({ sessionId, vacancyId, onAdded, setError }) {
  const [questionText, setQuestionText] = useState('');
  const [maxScore, setMaxScore] = useState(10);
  const [saving, setSaving] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (!(questionText || '').trim()) { setError('Question text is required'); return; }
    setSaving(true);
    recruitmentApi.panelAddQuestion({ session_id: sessionId, question_text: questionText.trim(), max_score: maxScore })
      .then(() => { setQuestionText(''); setMaxScore(10); onAdded(); })
      .catch((e) => setError(e?.message))
      .finally(() => setSaving(false));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
      <input type="text" value={questionText} onChange={(e) => setQuestionText(e.target.value)} placeholder="Question text" className="flex-1 min-w-[200px] rounded border border-surface-300 px-2 py-1.5 text-sm" />
      <input type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value) || 10)} className="w-16 rounded border border-surface-300 px-2 py-1.5 text-sm" />
      <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">Add question</button>
    </form>
  );
}

function TabResults({ vacancies, setError }) {
  const [vacancyId, setVacancyId] = useState('');
  const [results, setResults] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);

  useEffect(() => {
    recruitmentApi.results.list(vacancyId || undefined).then((r) => { setResults(r.results || []); setAiAnalysis(r.ai_analysis || null); }).catch((e) => setError(e?.message));
  }, [vacancyId]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Results</h2>
      <p className="text-sm text-surface-600">View grading results and AI analysis and recommendations.</p>
      <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
        <option value="">All vacancies</option>
        {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
      </select>
      {aiAnalysis && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
          <h3 className="font-medium text-brand-900 mb-1">AI analysis</h3>
          <p className="text-sm text-brand-800">{aiAnalysis.summary}</p>
          <p className="text-sm text-brand-800 mt-1">{aiAnalysis.recommendation}</p>
        </div>
      )}
      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left p-2 font-medium">Applicant</th>
              <th className="text-left p-2 font-medium">Vacancy</th>
              <th className="text-left p-2 font-medium">Total score</th>
              <th className="text-left p-2 font-medium">Conducted</th>
              <th className="text-left p-2 font-medium">Comments</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className="border-b border-surface-100">
                <td className="p-2">{r.applicant_name}</td>
                <td className="p-2">{r.vacancy_title}</td>
                <td className="p-2">{r.total_score != null ? r.total_score : '—'}</td>
                <td className="p-2">{formatDateTime(r.conducted_at)}</td>
                <td className="p-2 max-w-xs truncate">{r.overall_comments || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabAppointments({ vacancies, setError }) {
  const [vacancyId, setVacancyId] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [results, setResults] = useState([]);

  useEffect(() => {
    recruitmentApi.appointments.list(vacancyId || undefined).then((r) => setAppointments(r.appointments || []));
    recruitmentApi.results.list(vacancyId || undefined).then((r) => setResults(r.results || []));
  }, [vacancyId]);

  const createOffer = (applicantId) => {
    if (!applicantId || !vacancyId) return;
    recruitmentApi.appointments.create({ applicant_id: applicantId, vacancy_id: vacancyId })
      .then((r) => setAppointments((prev) => [r.appointment, ...prev]))
      .catch((e) => setError(e?.message));
  };

  const sendCongratulations = (id) => {
    recruitmentApi.appointments.sendCongratulations(id)
      .then((r) => setAppointments((prev) => prev.map((a) => a.id === r.appointment.id ? r.appointment : a)))
      .catch((e) => setError(e?.message));
  };

  const sendRegret = (id) => {
    if (!window.confirm('Send regret email?')) return;
    recruitmentApi.appointments.sendRegret(id)
      .then((r) => setAppointments((prev) => prev.map((a) => a.id === r.appointment.id ? r.appointment : a)))
      .catch((e) => setError(e?.message));
  };

  const setAccepted = (id) => {
    recruitmentApi.appointments.update(id, { status: 'accepted' })
      .then((r) => setAppointments((prev) => prev.map((a) => a.id === r.appointment.id ? r.appointment : a)))
      .catch((e) => setError(e?.message));
  };

  const offeredIds = appointments.map((o) => o.applicant_id);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Appointments</h2>
      <p className="text-sm text-surface-600">Select suitable candidates and send congratulations or regret email. When the successful candidate responds, set status to Accepted.</p>
      <select value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
        <option value="">Select vacancy</option>
        {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
      </select>
      {vacancyId && (
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <h3 className="font-medium text-surface-800 mb-2">Create offer from results</h3>
          <ul className="space-y-1">
            {results.filter((r) => !offeredIds.includes(r.applicant_id)).map((r) => (
              <li key={r.id} className="flex justify-between items-center p-2 rounded border border-surface-100">
                <span>{r.applicant_name} (Score: {r.total_score ?? '—'})</span>
                <button type="button" onClick={() => createOffer(r.applicant_id)} className="text-brand-600 text-sm">Create offer</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left p-2 font-medium">Applicant</th>
              <th className="text-left p-2 font-medium">Vacancy</th>
              <th className="text-left p-2 font-medium">Status</th>
              <th className="text-left p-2 font-medium">Congratulations sent</th>
              <th className="text-left p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((o) => (
              <tr key={o.id} className="border-b border-surface-100">
                <td className="p-2">{o.applicant_name}</td>
                <td className="p-2">{o.vacancy_title}</td>
                <td className="p-2">{o.status}</td>
                <td className="p-2">{o.congratulations_sent_at ? formatDateTime(o.congratulations_sent_at) : '—'}</td>
                <td className="p-2 flex flex-wrap gap-1">
                  {!o.congratulations_sent_at && <button type="button" onClick={() => sendCongratulations(o.id)} className="text-brand-600 text-xs">Send congratulations</button>}
                  <button type="button" onClick={() => sendRegret(o.id)} className="text-red-600 text-xs">Send regret</button>
                  {o.status !== 'accepted' && <button type="button" onClick={() => setAccepted(o.id)} className="text-green-600 text-xs">Mark accepted</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabPanelMembers({ setError }) {
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    recruitmentApi.panelMembers.list().then((r) => setMembers(r.members || [])).catch((e) => setError(e?.message));
  }, []);
  useEffect(() => {
    usersApi.list({ limit: 200 }).then((r) => setUsers(r.users || [])).catch(() => setUsers([]));
  }, []);

  const memberUserIds = members.map((m) => m.user_id);
  const addMember = () => {
    if (!selectedUserId) return;
    setAdding(true);
    recruitmentApi.panelMembers.add({ user_id: selectedUserId })
      .then((r) => { setMembers((prev) => [r.member, ...prev]); setSelectedUserId(''); })
      .catch((e) => setError(e?.message))
      .finally(() => setAdding(false));
  };
  const removeMember = (userId) => {
    if (!window.confirm('Remove this user from the panel?')) return;
    recruitmentApi.panelMembers.remove(userId).then(() => setMembers((prev) => prev.filter((m) => m.user_id !== userId))).catch((e) => setError(e?.message));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Panel members</h2>
      <p className="text-sm text-surface-600">Choose which users are part of the recruitment panel. When you add a user, they receive an email invitation.</p>
      <div className="rounded-xl border border-surface-200 bg-white p-4">
        <h3 className="font-medium text-surface-800 mb-2">Add panel member</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px]">
            <option value="">Select user</option>
            {users.filter((u) => !memberUserIds.includes(u.id)).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>
            ))}
          </select>
          <button type="button" onClick={addMember} disabled={adding || !selectedUserId} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">Add and send email</button>
        </div>
      </div>
      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left p-2 font-medium">User</th>
              <th className="text-left p-2 font-medium">Email</th>
              <th className="text-left p-2 font-medium">Invited</th>
              <th className="text-left p-2 font-medium">Email sent</th>
              <th className="text-left p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} className="border-b border-surface-100">
                <td className="p-2">{m.full_name}</td>
                <td className="p-2">{m.email}</td>
                <td className="p-2">{m.invited_at ? formatDateTime(m.invited_at) : '—'}</td>
                <td className="p-2">{m.email_sent_at ? formatDateTime(m.email_sent_at) : '—'}</td>
                <td className="p-2"><button type="button" onClick={() => removeMember(m.user_id)} className="text-red-600 text-xs">Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabAccess({ setError }) {
  const [permissions, setPermissions] = useState([]);
  const [allTabIds, setAllTabIds] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([recruitmentApi.tabPermissions.list(), usersApi.list({ limit: 200 })])
      .then(([permRes, usersRes]) => {
        setPermissions(permRes.permissions || []);
        setAllTabIds(permRes.allTabIds || []);
        setUsers(usersRes.users || []);
      })
      .catch((e) => setError(e?.message))
      .finally(() => setLoading(false));
  }, []);

  const permByUser = (permissions || []).reduce((acc, p) => { acc[p.user_id] = p; return acc; }, {});

  const grant = (userId, tabId) => {
    recruitmentApi.tabPermissions.grant({ user_id: userId, tab_id: tabId })
      .then(() => recruitmentApi.tabPermissions.list().then((r) => setPermissions(r.permissions || [])))
      .catch((e) => setError(e?.message));
  };
  const revoke = (userId, tabId) => {
    recruitmentApi.tabPermissions.revoke({ user_id: userId, tab_id: tabId })
      .then(() => recruitmentApi.tabPermissions.list().then((r) => setPermissions(r.permissions || [])))
      .catch((e) => setError(e?.message));
  };

  if (loading) return <p className="text-surface-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-800">Access</h2>
      <p className="text-sm text-surface-600">Regulate which users can access which tabs inside Recruitment. Only super admins see this. Grant or revoke tab access per user.</p>
      <div className="rounded-xl border border-surface-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left p-2 font-medium">User</th>
              {allTabIds.map((tabId) => (
                <th key={tabId} className="text-left p-2 font-medium w-24">{tabId.replace(/-/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-surface-100">
                <td className="p-2">{u.full_name || u.email}</td>
                {allTabIds.map((tabId) => {
                  const has = (permByUser[u.id]?.tabs || []).includes(tabId);
                  return (
                    <td key={tabId} className="p-2">
                      {has ? (
                        <button type="button" onClick={() => revoke(u.id, tabId)} className="text-green-600 text-xs font-medium">Yes</button>
                      ) : (
                        <button type="button" onClick={() => grant(u.id, tabId)} className="text-surface-400 text-xs">No</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
