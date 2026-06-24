import { useState, useEffect, useCallback, useMemo } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';
import PdfInlineViewer from './PdfInlineViewer.jsx';

const SUBTABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'goals', label: 'Goals & KPIs' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'cv', label: 'Résumé / CV' },
];

function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  const map = {
    active: 'bg-brand-100 text-brand-800',
    achieved: 'bg-emerald-100 text-emerald-800',
    done: 'bg-emerald-100 text-emerald-800',
    paused: 'bg-surface-200 text-surface-700',
    planned: 'bg-sky-100 text-sky-800',
    in_progress: 'bg-amber-100 text-amber-900',
    deferred: 'bg-surface-200 text-surface-600',
  };
  return map[s] || 'bg-surface-100 text-surface-700';
}

export default function CareerDevelopmentManagementSection({ onError }) {
  const [employees, setEmployees] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sub, setSub] = useState('overview');
  const [cvPreview, setCvPreview] = useState(null);

  const loadList = useCallback(() => {
    setLoadingList(true);
    onError('');
    pm.careerDevelopment
      .directory()
      .then((d) => setEmployees(d.employees || []))
      .catch((e) => onError(e?.message || 'Could not load employees'))
      .finally(() => setLoadingList(false));
  }, [onError]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setBundle(null);
      setCvPreview(null);
      return;
    }
    setLoadingDetail(true);
    setCvPreview(null);
    onError('');
    pm.careerDevelopment
      .getForUser(selectedId)
      .then((d) => setBundle(d))
      .catch((e) => onError(e?.message || 'Could not load career profile'))
      .finally(() => setLoadingDetail(false));
  }, [selectedId, onError]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      String(e.full_name || '').toLowerCase().includes(q)
      || String(e.email || '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  const goals = parseJsonArray(bundle?.plan?.goals_json);
  const objectives = parseJsonArray(bundle?.plan?.objectives_json);
  const milestones = bundle?.milestones || [];
  const cvUploads = bundle?.cv_uploads || [];

  const openCv = (cv) => {
    if (!selectedId || !cv?.id) return;
    const url = pm.careerDevelopment.cvViewUrl(selectedId, cv.id);
    const isPdf = /\.pdf$/i.test(cv.file_name || '') || String(cv.content_type || '').includes('pdf');
    if (isPdf) {
      setCvPreview({ url, name: cv.file_name || 'CV' });
    } else {
      downloadAttachmentWithAuth(url, cv.file_name || 'cv').catch((e) => onError(e?.message || 'Download failed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Career &amp; personal development</h1>
        <InfoHint
          title="Employee career portfolios"
          text="Read-only view of each employee's personal career plan, goals, milestones, and uploaded CVs. Employees maintain this data on their Profile tab."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] min-h-[calc(100vh-14rem)]">
        <aside className="app-glass-card flex flex-col overflow-hidden">
          <div className="p-3 border-b border-surface-200">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees…"
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-surface-100">
            {loadingList && <p className="p-4 text-sm text-surface-500">Loading…</p>}
            {!loadingList && !filtered.length && (
              <p className="p-4 text-sm text-surface-500">No employees found.</p>
            )}
            {filtered.map((e) => (
              <button
                key={e.user_id}
                type="button"
                onClick={() => { setSelectedId(e.user_id); setSub('overview'); }}
                className={`w-full text-left px-4 py-3 hover:bg-surface-50 transition-colors ${
                  selectedId === e.user_id ? 'bg-brand-50/80 border-l-4 border-brand-500' : ''
                }`}
              >
                <p className="font-medium text-sm text-surface-900">{e.full_name || '—'}</p>
                <p className="text-xs text-surface-500 truncate">{e.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                  <span className="px-1.5 py-0.5 rounded bg-surface-100 text-surface-600">{e.milestone_count || 0} milestones</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-100 text-surface-600">{e.cv_count || 0} CV</span>
                  {e.plan_updated_at && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Plan updated</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="app-glass-card flex flex-col min-h-[32rem]">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <p className="text-surface-700 font-medium">Select an employee</p>
                <p className="text-sm text-surface-500 mt-1 max-w-md">
                  View professional summary, personal goals, career milestones, and résumé files. PDFs open in the built-in viewer.
                </p>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="flex-1 flex items-center justify-center text-sm text-surface-500">Loading career profile…</div>
          ) : (
            <>
              <div className="p-4 sm:p-5 border-b border-surface-200">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900">{bundle?.user?.full_name || 'Employee'}</h2>
                    <p className="text-sm text-surface-500">{bundle?.user?.email}</p>
                    {bundle?.plan?.updated_at && (
                      <p className="text-xs text-surface-400 mt-1">Plan last updated {fmtDateTime(bundle.plan.updated_at)}</p>
                    )}
                  </div>
                </div>
                <nav className="mt-4 flex flex-wrap gap-0 border-b border-surface-200 -mb-px" aria-label="Career sections">
                  {SUBTABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setSub(t.id); setCvPreview(null); }}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                        sub === t.id ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600 hover:text-surface-900'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                {sub === 'overview' && (
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-2 rounded-xl border border-surface-200 bg-white p-5">
                      <h3 className="text-sm font-semibold text-surface-900">Professional summary</h3>
                      <p className="mt-3 text-sm text-surface-700 whitespace-pre-wrap leading-relaxed min-h-[8rem]">
                        {bundle?.plan?.professional_summary?.trim() || 'No summary provided yet.'}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-xl border border-surface-200 bg-white p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Personal goals</p>
                        <p className="text-2xl font-bold text-surface-900 mt-1">{goals.length}</p>
                      </div>
                      <div className="rounded-xl border border-surface-200 bg-white p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Development objectives</p>
                        <p className="text-2xl font-bold text-surface-900 mt-1">{objectives.length}</p>
                      </div>
                      <div className="rounded-xl border border-surface-200 bg-white p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Milestones completed</p>
                        <p className="text-2xl font-bold text-emerald-700 mt-1">
                          {milestones.filter((m) => String(m.status).toLowerCase() === 'done').length}
                          <span className="text-sm font-normal text-surface-500"> / {milestones.length}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {sub === 'goals' && (
                  <div className="space-y-6">
                    {[
                      { title: 'Personal goals', rows: goals },
                      { title: 'Development objectives', rows: objectives },
                    ].map(({ title, rows }) => (
                      <div key={title} className="rounded-xl border border-surface-200 overflow-hidden bg-white">
                        <h3 className="px-4 py-3 text-sm font-semibold bg-surface-50 border-b border-surface-200">{title}</h3>
                        {!rows.length ? (
                          <p className="p-4 text-sm text-surface-500">None recorded.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-surface-500 bg-surface-50/80">
                              <tr>
                                <th className="px-4 py-2">Title</th>
                                <th className="px-4 py-2">Metric</th>
                                <th className="px-4 py-2">Target</th>
                                <th className="px-4 py-2">Unit</th>
                                <th className="px-4 py-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                              {rows.map((row) => (
                                <tr key={row.id || row.title}>
                                  <td className="px-4 py-2 font-medium text-surface-900">{row.title || '—'}</td>
                                  <td className="px-4 py-2 text-surface-600">{row.metric_name || '—'}</td>
                                  <td className="px-4 py-2 font-mono text-surface-700">{row.target_value ?? '—'}</td>
                                  <td className="px-4 py-2 text-surface-600">{row.unit || '—'}</td>
                                  <td className="px-4 py-2">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(row.status)}`}>
                                      {row.status || 'active'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {sub === 'milestones' && (
                  <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                    {!milestones.length ? (
                      <p className="p-4 text-sm text-surface-500">No milestones recorded.</p>
                    ) : (
                      <ul className="divide-y divide-surface-100">
                        {milestones.map((m) => (
                          <li key={m.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-surface-900">{m.title}</p>
                                {m.description && <p className="text-sm text-surface-600 mt-1 whitespace-pre-wrap">{m.description}</p>}
                              </div>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusBadge(m.status)}`}>
                                {m.status || 'planned'}
                              </span>
                            </div>
                            <p className="text-xs text-surface-400 mt-1">{fmtDate(m.milestone_date)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {sub === 'cv' && (
                  <div className="space-y-4">
                    {!cvUploads.length ? (
                      <p className="text-sm text-surface-500">No CV files uploaded.</p>
                    ) : (
                      <ul className="rounded-xl border border-surface-200 bg-white divide-y divide-surface-100">
                        {cvUploads.map((cv) => (
                          <li key={cv.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium text-sm text-surface-900">{cv.file_name}</p>
                              <p className="text-xs text-surface-500">{fmtDateTime(cv.uploaded_at)}</p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => openCv(cv)}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                              >
                                View in system
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadAttachmentWithAuth(
                                  pm.careerDevelopment.cvViewUrl(selectedId, cv.id),
                                  cv.file_name || 'cv'
                                ).catch((e) => onError(e?.message))}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50"
                              >
                                Download
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {cvPreview && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-surface-900">{cvPreview.name}</h3>
                          <button type="button" onClick={() => setCvPreview(null)} className="text-xs text-surface-500 hover:text-surface-800">
                            Close viewer
                          </button>
                        </div>
                        <PdfInlineViewer url={cvPreview.url} minHeight="75vh" onError={onError} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
