import { useCallback, useEffect, useState } from 'react';
import { truckOnboarding as obApi } from './api';
import InfoHint from './components/InfoHint.jsx';
import OnboardingActionRow from './components/onboarding/OnboardingActionRow.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'activities', label: 'Onboarding activities' },
  { id: 'updates', label: 'Onboarding updates' },
];

const ASSIGNEE_OPTIONS = [
  { value: 'admin', label: 'Onboarding admin' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'both', label: 'Both' },
];

function stageStatusBadge(status) {
  const map = {
    locked: 'bg-surface-200 text-surface-600',
    in_progress: 'bg-brand-100 text-brand-800',
    completed: 'bg-emerald-100 text-emerald-800',
  };
  return map[status] || map.locked;
}

export default function OnboardingAdmin() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [template, setTemplate] = useState({ name: '', description: '', stages: [] });
  const [startMapId, setStartMapId] = useState('');
  const [entityKind, setEntityKind] = useState('truck');
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reportDraft, setReportDraft] = useState('');

  const loadDashboard = useCallback(() => {
    obApi.dashboard().then(setDashboard).catch((e) => setError(e.message));
  }, []);

  const loadTemplates = useCallback(() => {
    obApi
      .listTemplates()
      .then((r) => {
        const list = r.templates || [];
        setTemplates(list);
        setSelectedMapId((prev) => prev || list[0]?.id || '');
        setStartMapId((prev) => prev || list[0]?.id || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  const loadTemplate = useCallback(
    (mapId) => {
      const id = mapId || selectedMapId;
      if (!id) return;
      obApi
        .getTemplate(id)
        .then((r) => setTemplate(r.template || { stages: [] }))
        .catch((e) => setError(e.message));
    },
    [selectedMapId]
  );

  const loadTrucks = useCallback(() => {
    obApi
      .trucks()
      .then((r) => setTrucks(r.trucks || []))
      .catch((e) => setError(e.message));
  }, []);

  const loadDrivers = useCallback(() => {
    obApi
      .drivers()
      .then((r) => setDrivers(r.drivers || []))
      .catch((e) => setError(e.message));
  }, []);

  const loadDetail = useCallback((id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    obApi
      .getOnboarding(id)
      .then((d) => {
        setDetail(d);
        setReportDraft(d.onboarding?.progress_report_draft || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadDashboard();
    loadTemplates();
    loadTrucks();
    loadDrivers();
  }, [loadDashboard, loadTemplates, loadTrucks, loadDrivers]);

  useEffect(() => {
    if (selectedMapId) loadTemplate(selectedMapId);
  }, [selectedMapId, loadTemplate]);

  const entityList = entityKind === 'driver' ? drivers : trucks;

  useEffect(() => {
    const row = entityList.find(
      (t) =>
        String(t.onboarding_id) === String(selectedEntityId) ||
        (!t.onboarding_id && String(t.id) === String(selectedEntityId))
    );
    if (row?.onboarding_id) loadDetail(row.onboarding_id);
    else setDetail(null);
  }, [selectedEntityId, entityList, loadDetail]);

  const addStage = () => {
    setTemplate((t) => ({
      ...t,
      stages: [...(t.stages || []), { title: `Stage ${(t.stages?.length || 0) + 1}`, description: '', tasks: [] }],
    }));
  };

  const saveTemplate = async () => {
    if (!selectedMapId) return;
    setBusy(true);
    setError('');
    try {
      const r = await obApi.saveTemplate(selectedMapId, { ...template, id: selectedMapId });
      setTemplate(r.template);
      setInfo('Onboarding map saved');
      loadTemplates();
      loadDashboard();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const createMap = async () => {
    const name = window.prompt('Name for this onboarding map', 'New onboarding map');
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const r = await obApi.createTemplate({ name: name.trim() });
      const id = r.template?.id;
      setTemplates((prev) => [...prev, { id, name: r.template.name, stage_count: 0 }]);
      setSelectedMapId(id);
      setTemplate(r.template);
      setStartMapId(id);
      setInfo('Map created');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startOnboarding = async (entityId) => {
    if (!startMapId) {
      setError('Select an onboarding map first');
      return;
    }
    setBusy(true);
    try {
      const body = {
        template_id: startMapId,
        ...(entityKind === 'driver' ? { driver_id: entityId } : { truck_id: entityId }),
      };
      const d = await obApi.startOnboarding(body);
      setInfo(entityKind === 'driver' ? 'Onboarding started for driver' : 'Onboarding started for truck');
      if (entityKind === 'driver') loadDrivers();
      else loadTrucks();
      setSelectedEntityId(entityId);
      setDetail(d);
      setActiveTab('updates');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  function entityRowLabel(row) {
    if (entityKind === 'driver') {
      const name = [row.full_name, row.surname].filter(Boolean).join(' ').trim();
      return name || row.license_number || 'Driver';
    }
    return row.registration || 'Truck';
  }

  const saveReport = async () => {
    if (!detail?.onboarding?.id) return;
    setBusy(true);
    try {
      const d = await obApi.patchOnboarding(detail.onboarding.id, { progress_report_draft: reportDraft });
      setDetail(d);
      setInfo('Progress report draft saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAdminTask = async (task, checked) => {
    if (!detail?.onboarding?.id) return;
    try {
      const d = await obApi.patchTask(detail.onboarding.id, task.id, { admin_completed: checked });
      setDetail(d);
    } catch (e) {
      setError(e.message);
    }
  };

  const completeStage = async (stageId) => {
    if (!detail?.onboarding?.id) return;
    if (!window.confirm('Mark this stage complete and unlock the next stage?')) return;
    setBusy(true);
    try {
      const d = await obApi.completeStage(detail.onboarding.id, stageId);
      setDetail(d);
      loadTrucks();
      loadDrivers();
      loadDashboard();
      setInfo('Stage completed');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="shrink-0 border-b border-surface-200 dark:border-surface-800 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Onboarding Admin</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
              Manage truck and driver onboarding stages, track contractor progress, and coordinate documentation with the
              Contractor onboarding tab.
            </p>
          </div>
          <InfoHint text="Define stages under Onboarding activities, then update truck or driver progress under Onboarding updates. Contractors respond on the Contractor page → Onboarding tab." />
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300" onAnimationEnd={() => setInfo('')}>
            {info}
          </p>
        )}
        <nav className="flex flex-wrap gap-2 mt-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                activeTab === t.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'dashboard' && dashboard && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="app-glass-card p-4">
              <p className="text-xs uppercase text-surface-500">Onboarding maps</p>
              <p className="text-2xl font-bold mt-1">{dashboard.templates_count ?? templates.length}</p>
            </div>
            <div className="app-glass-card p-4">
              <p className="text-xs uppercase text-surface-500">Fleet trucks</p>
              <p className="text-2xl font-bold mt-1">{dashboard.trucks_total}</p>
            </div>
            <div className="app-glass-card p-4">
              <p className="text-xs uppercase text-surface-500">Drivers</p>
              <p className="text-2xl font-bold mt-1">{dashboard.drivers_total ?? 0}</p>
            </div>
            <div className="app-glass-card p-4">
              <p className="text-xs uppercase text-surface-500">In progress</p>
              <p className="text-2xl font-bold mt-1 text-brand-600">{dashboard.onboardings_in_progress}</p>
            </div>
            <div className="app-glass-card p-4">
              <p className="text-xs uppercase text-surface-500">Completed</p>
              <p className="text-2xl font-bold mt-1 text-emerald-600">{dashboard.onboardings_completed}</p>
            </div>
          </div>
        )}

        {activeTab === 'activities' && (
          <div className="flex flex-col lg:flex-row gap-4 max-w-5xl">
            <div className="lg:w-56 shrink-0 space-y-2">
              <p className="text-sm font-semibold">Onboarding maps</p>
              <button type="button" onClick={createMap} className="w-full px-2 py-1.5 text-xs rounded-lg border border-brand-500 text-brand-600">
                + New map
              </button>
              <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                {templates.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMapId(m.id)}
                    className={`w-full text-left px-2 py-2 rounded-lg text-sm border ${
                      String(selectedMapId) === String(m.id)
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                        : 'border-surface-200 dark:border-surface-700'
                    }`}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="block text-[10px] text-surface-500">{m.stage_count ?? 0} stages</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Map name</span>
              <input
                className="mt-1 w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm"
                value={template.name || ''}
                onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
              />
            </label>
            {(template.stages || []).map((stage, si) => (
              <div key={si} className="app-glass-card p-4 space-y-3">
                <div className="flex gap-2 items-center">
                  <span className="text-xs font-bold text-surface-500 w-16">Stage {si + 1}</span>
                  <input
                    className="flex-1 rounded border px-2 py-1 text-sm"
                    value={stage.title || ''}
                    onChange={(e) => {
                      const stages = [...template.stages];
                      stages[si] = { ...stages[si], title: e.target.value };
                      setTemplate((t) => ({ ...t, stages }));
                    }}
                    placeholder="e.g. Subcontractor signed and MOU"
                  />
                </div>
                <textarea
                  className="w-full rounded border px-2 py-1 text-sm min-h-[60px]"
                  placeholder="Stage description"
                  value={stage.description || ''}
                  onChange={(e) => {
                    const stages = [...template.stages];
                    stages[si] = { ...stages[si], description: e.target.value };
                    setTemplate((t) => ({ ...t, stages }));
                  }}
                />
                <p className="text-xs font-medium text-surface-500">Actions / checklist</p>
                {(stage.tasks || []).map((task, ti) => (
                  <div key={ti} className="flex flex-wrap gap-2 items-center">
                    <input
                      className="flex-1 min-w-[200px] rounded border px-2 py-1 text-sm"
                      value={task.title || ''}
                      onChange={(e) => {
                        const stages = [...template.stages];
                        const tasks = [...(stages[si].tasks || [])];
                        tasks[ti] = { ...tasks[ti], title: e.target.value };
                        stages[si] = { ...stages[si], tasks };
                        setTemplate((t) => ({ ...t, stages }));
                      }}
                    />
                    <select
                      className="rounded border px-2 py-1 text-sm"
                      value={task.assignee || 'admin'}
                      onChange={(e) => {
                        const stages = [...template.stages];
                        const tasks = [...(stages[si].tasks || [])];
                        tasks[ti] = { ...tasks[ti], assignee: e.target.value };
                        stages[si] = { ...stages[si], tasks };
                        setTemplate((t) => ({ ...t, stages }));
                      }}
                    >
                      {ASSIGNEE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs text-brand-600"
                  onClick={() => {
                    const stages = [...template.stages];
                    stages[si] = {
                      ...stages[si],
                      tasks: [...(stages[si].tasks || []), { title: 'New action', assignee: 'admin' }],
                    };
                    setTemplate((t) => ({ ...t, stages }));
                  }}
                >
                  + Add action
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addStage} className="px-3 py-2 rounded-lg border text-sm">
                + Add stage
              </button>
              <button
                type="button"
                disabled={busy || !selectedMapId}
                onClick={saveTemplate}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
              >
                Save onboarding map
              </button>
            </div>
            </div>
          </div>
        )}

        {activeTab === 'updates' && (
          <div className="flex flex-col lg:flex-row gap-4 min-h-[400px]">
            <div className="lg:w-72 shrink-0 space-y-2">
              <div className="flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEntityKind('truck');
                    setSelectedEntityId('');
                    setDetail(null);
                  }}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md ${
                    entityKind === 'truck' ? 'bg-brand-600 text-white' : 'text-surface-600'
                  }`}
                >
                  Trucks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntityKind('driver');
                    setSelectedEntityId('');
                    setDetail(null);
                  }}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md ${
                    entityKind === 'driver' ? 'bg-brand-600 text-white' : 'text-surface-600'
                  }`}
                >
                  Drivers
                </button>
              </div>
              <label className="block text-xs">
                <span className="font-medium text-surface-600">Map for new onboarding</span>
                <select
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={startMapId}
                  onChange={(e) => setStartMapId(e.target.value)}
                >
                  {templates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm font-semibold">{entityKind === 'driver' ? 'Drivers' : 'Trucks'}</p>
              <div className="max-h-[60vh] overflow-y-auto space-y-1">
                {entityList.map((t) => (
                  <button
                    key={t.onboarding_id || t.id}
                    type="button"
                    onClick={() => setSelectedEntityId(t.onboarding_id || t.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${
                      String(selectedEntityId) === String(t.id) ||
                      String(selectedEntityId) === String(t.onboarding_id)
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                        : 'border-surface-200 dark:border-surface-700'
                    }`}
                  >
                    <span className="font-medium">{entityRowLabel(t)}</span>
                    {entityKind === 'truck' && t.fleet_no && (
                      <span className="text-surface-500"> · {t.fleet_no}</span>
                    )}
                    {entityKind === 'driver' && t.license_number && (
                      <span className="text-surface-500"> · {t.license_number}</span>
                    )}
                    <br />
                    <span className="text-xs text-surface-500">
                      {t.onboarding_id
                        ? `${t.template_name || 'Map'} · ${t.current_stage_title || 'Onboarding'} (${t.onboarding_status})`
                        : 'Not started'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              {!detail && selectedEntityId && !entityList.find((t) => String(t.onboarding_id) === String(selectedEntityId)) && (
                <div className="app-glass-card p-6 text-center space-y-3">
                  <p className="text-surface-600">
                    No onboarding on map &ldquo;{templates.find((m) => String(m.id) === String(startMapId))?.name || 'selected'}&rdquo; for this{' '}
                    {entityKind === 'driver' ? 'driver' : 'truck'} yet.
                  </p>
                  <button
                    type="button"
                    disabled={busy || !startMapId}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm"
                    onClick={() => {
                      const row = entityList.find((t) => String(t.id) === String(selectedEntityId));
                      if (row) startOnboarding(row.id);
                    }}
                  >
                    Start onboarding with selected map
                  </button>
                </div>
              )}

              {detail && (
                <div className="space-y-4">
                  <div className="app-glass-card p-4">
                    <h2 className="font-semibold text-lg">
                      {detail.onboarding.display_label ||
                        (detail.onboarding.entity_type === 'driver'
                          ? [detail.onboarding.driver_full_name, detail.onboarding.driver_surname]
                              .filter(Boolean)
                              .join(' ')
                          : `${detail.onboarding.registration || ''}${detail.onboarding.fleet_no ? ` · ${detail.onboarding.fleet_no}` : ''}`)}
                    </h2>
                    <p className="text-sm text-surface-500">{detail.onboarding.contractor_name || '—'}</p>
                    <p className="text-sm mt-1">
                      Status: <strong>{detail.onboarding.status}</strong>
                      {detail.onboarding.template_name && (
                        <span className="text-surface-500"> · Map: {detail.onboarding.template_name}</span>
                      )}
                    </p>
                  </div>

                  <div className="app-glass-card p-4 space-y-2">
                    <label className="text-sm font-medium">Progress report (draft)</label>
                    <textarea
                      className="w-full min-h-[100px] rounded-lg border px-3 py-2 text-sm"
                      value={reportDraft}
                      onChange={(e) => setReportDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveReport}
                      className="px-3 py-1.5 rounded-lg bg-surface-800 text-white text-sm dark:bg-surface-200 dark:text-surface-900"
                    >
                      Save draft
                    </button>
                  </div>

                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {detail.stages.map((stage) => (
                      <div
                        key={stage.id}
                        className={`shrink-0 w-72 rounded-xl border p-3 ${
                          stage.is_current ? 'border-brand-400 ring-2 ring-brand-200' : 'border-surface-200 dark:border-surface-700'
                        } ${stage.stage_status === 'locked' ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm">{stage.title}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${stageStatusBadge(stage.stage_status)}`}>
                            {stage.stage_status.replace('_', ' ')}
                          </span>
                        </div>
                        {stage.description && <p className="text-xs text-surface-500 mt-1">{stage.description}</p>}
                        <ul className="mt-3 space-y-1">
                          {stage.tasks.map((task) => (
                            <OnboardingActionRow
                              key={task.id}
                              task={task}
                              stageLocked={stage.stage_status === 'locked'}
                              role="admin"
                              attachmentDownloadUrl={obApi.attachmentDownloadUrl}
                              onAdminToggle={(checked) => toggleAdminTask(task, checked)}
                              onUpload={async (file) => {
                                const d = await obApi.uploadTaskAttachment(detail.onboarding.id, task.id, file);
                                setDetail(d);
                              }}
                            />
                          ))}
                        </ul>
                        {stage.is_current && stage.stage_status === 'in_progress' && (
                          <button
                            type="button"
                            className="mt-3 w-full py-1.5 text-xs rounded-lg bg-emerald-600 text-white"
                            onClick={() => completeStage(stage.id)}
                          >
                            Complete stage
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
