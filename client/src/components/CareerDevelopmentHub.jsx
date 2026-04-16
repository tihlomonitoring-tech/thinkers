import { useState, useEffect, useCallback } from 'react';
import { userCareer, openAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';

const SUBTABS = [
  { id: 'overview', label: 'Executive overview' },
  { id: 'plan', label: 'Goals & KPIs' },
  { id: 'milestones', label: 'Career milestones' },
  { id: 'cv', label: 'Résumé & CV' },
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

function newGoalRow() {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: '',
    metric_name: '',
    target_value: '',
    unit: '',
    status: 'active',
  };
}

export default function CareerDevelopmentHub() {
  const [sub, setSub] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [goals, setGoals] = useState([newGoalRow()]);
  const [objectives, setObjectives] = useState([newGoalRow()]);
  const [milestones, setMilestones] = useState([]);
  const [cvList, setCvList] = useState([]);
  const [planUpdated, setPlanUpdated] = useState(null);

  const loadAll = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      userCareer.getPlan().catch(() => ({})),
      userCareer.listMilestones().catch(() => ({ milestones: [] })),
      userCareer.listCv().catch(() => ({ uploads: [] })),
    ])
      .then(([p, m, c]) => {
        setSummary(p.professional_summary || '');
        const g = parseJsonArray(p.goals_json);
        const o = parseJsonArray(p.objectives_json);
        setGoals(g.length ? g.map((x) => ({ ...newGoalRow(), ...x, title: x.title || '' })) : [newGoalRow()]);
        setObjectives(o.length ? o.map((x) => ({ ...newGoalRow(), ...x, title: x.title || '' })) : [newGoalRow()]);
        setPlanUpdated(p.updated_at || null);
        setMilestones(m.milestones || []);
        setCvList(c.uploads || []);
      })
      .catch((e) => setError(e?.message || 'Could not load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const savePlan = async () => {
    setSaving(true);
    setError('');
    try {
      const goalsClean = goals
        .filter((r) => String(r.title || '').trim())
        .map((r) => ({
          id: r.id,
          title: String(r.title).trim(),
          metric_name: r.metric_name != null ? String(r.metric_name).trim() : '',
          target_value:
            r.target_value === '' || r.target_value == null
              ? null
              : (Number.isFinite(Number(r.target_value)) ? Number(r.target_value) : null),
          unit: r.unit != null ? String(r.unit).trim() : '',
          status: ['achieved', 'paused'].includes(String(r.status).toLowerCase()) ? String(r.status).toLowerCase() : 'active',
        }));
      const objClean = objectives
        .filter((r) => String(r.title || '').trim())
        .map((r) => ({
          id: r.id,
          title: String(r.title).trim(),
          metric_name: r.metric_name != null ? String(r.metric_name).trim() : '',
          target_value:
            r.target_value === '' || r.target_value == null
              ? null
              : (Number.isFinite(Number(r.target_value)) ? Number(r.target_value) : null),
          unit: r.unit != null ? String(r.unit).trim() : '',
          status: ['achieved', 'paused'].includes(String(r.status).toLowerCase()) ? String(r.status).toLowerCase() : 'active',
        }));
      await userCareer.putPlan({
        professional_summary: summary,
        goals_json: JSON.stringify(goalsClean),
        objectives_json: JSON.stringify(objClean),
      });
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addMilestone = async () => {
    setError('');
    try {
      await userCareer.createMilestone({
        title: 'New milestone',
        status: 'planned',
        display_order: milestones.length,
      });
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Could not add');
    }
  };

  const patchMs = async (id, body) => {
    try {
      await userCareer.patchMilestone(id, body);
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  const delMs = async (id) => {
    if (!window.confirm('Remove this milestone?')) return;
    try {
      await userCareer.deleteMilestone(id);
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Delete failed');
    }
  };

  const onCv = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    try {
      await userCareer.uploadCv(f);
      await loadAll();
    } catch (err) {
      setError(err?.message || 'Upload failed');
    }
  };

  const goalTable = (rows, setRows, title) => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">{title}</h4>
        <button type="button" onClick={() => setRows((r) => [...r, newGoalRow()])} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
          + Add
        </button>
      </div>
      <div className="rounded-xl border border-surface-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 border-b border-surface-200 text-left text-xs uppercase tracking-wide text-surface-500">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2 w-[100px]">Metric</th>
              <th className="px-3 py-2 w-[72px]">Target</th>
              <th className="px-3 py-2 w-[56px]">Unit</th>
              <th className="px-3 py-2 w-[100px]">Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {rows.map((row, idx) => (
              <tr key={row.id || idx}>
                <td className="px-3 py-2">
                  <input
                    value={row.title}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                    className="w-full bg-transparent border-0 border-b border-transparent focus:border-brand-400 focus:ring-0 text-sm py-1"
                    placeholder="Goal title"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.metric_name || ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, metric_name: e.target.value } : x)))}
                    className="w-full text-xs bg-surface-50 rounded px-2 py-1 border border-surface-200"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={row.target_value ?? ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, target_value: e.target.value } : x)))}
                    className="w-full text-xs font-mono bg-surface-50 rounded px-2 py-1 border border-surface-200"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.unit || ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                    className="w-full text-xs bg-surface-50 rounded px-2 py-1 border border-surface-200"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.status || 'active'}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, status: e.target.value } : x)))}
                    className="w-full text-xs rounded border border-surface-200 bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="achieved">Achieved</option>
                    <option value="paused">Paused</option>
                  </select>
                </td>
                <td className="px-1">
                  <button type="button" className="text-surface-400 hover:text-red-600 text-lg leading-none" onClick={() => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== idx)))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-12 flex items-center justify-center shadow-sm">
        <div className="text-sm text-surface-500 font-medium">Loading career workspace…</div>
      </div>
    );
  }

  const doneMs = milestones.filter((m) => String(m.status).toLowerCase() === 'done').length;

  return (
    <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-surface-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-surface-900">Career &amp; personal development</h2>
              <InfoHint
                title="Data privacy"
                text="Stored against your user account in this tenant. Management does not edit this tab from here; export or share your CV only as you choose."
              />
            </div>
            <p className="text-sm text-surface-600 mt-1 max-w-3xl">
              Personal narrative, measurable goals, milestones, and résumé files — separate from organisation team objectives.
            </p>
          </div>
        </div>
        <nav className="mt-5 flex flex-wrap gap-0 border-b border-surface-200 -mb-px" aria-label="Career sections">
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                sub === t.id
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-surface-600 hover:text-surface-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 sm:p-6 min-h-[420px] bg-surface-50/30">
        {error && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

        {sub === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-surface-900">Professional summary</h3>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={10}
                className="mt-3 w-full rounded-lg border border-surface-200 bg-white px-4 py-3 text-sm text-surface-800 leading-relaxed focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                placeholder="Concise executive summary: roles, domains, impact, and direction. This anchors your goals and CV narrative."
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={savePlan}
                  className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save summary'}
                </button>
                {planUpdated && <span className="text-xs text-surface-500 self-center">Last saved {new Date(planUpdated).toLocaleString()}</span>}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Personal goals</p>
                <p className="mt-2 text-3xl font-semibold text-surface-900 tabular-nums">{goals.filter((g) => g.title?.trim()).length}</p>
                <p className="text-xs text-surface-500 mt-1">Defined in Goals &amp; KPIs</p>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Milestones done</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-700 tabular-nums">
                  {doneMs}/{milestones.length || 0}
                </p>
                <p className="text-xs text-surface-500 mt-1">Career milestones tab</p>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">CV versions</p>
                <p className="mt-2 text-3xl font-semibold text-surface-900 tabular-nums">{cvList.length}</p>
                <p className="text-xs text-surface-500 mt-1">Résumé &amp; CV tab</p>
              </div>
            </div>
          </div>
        )}

        {sub === 'plan' && (
          <div className="space-y-8 max-w-5xl">
            {goalTable(goals, setGoals, 'Personal goals (measurable)')}
            {goalTable(objectives, setObjectives, 'Personal objectives (measurable)')}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={savePlan}
                className="px-6 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save goals & objectives'}
              </button>
            </div>
          </div>
        )}

        {sub === 'milestones' && (
          <div className="max-w-4xl space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-surface-600">Define promotions, certifications, rotations, or portfolio drops — with dates and status.</p>
              <button type="button" onClick={addMilestone} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                + Add milestone
              </button>
            </div>
            <ul className="space-y-3">
              {milestones.map((ms) => (
                <li key={ms.id} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm grid gap-3 sm:grid-cols-12 items-start">
                  <input
                    defaultValue={ms.title}
                    key={`t-${ms.id}-${ms.updated_at}`}
                    className="sm:col-span-4 w-full text-sm font-medium border border-surface-200 rounded-lg px-3 py-2"
                    onBlur={(e) => {
                      if (e.target.value !== ms.title) patchMs(ms.id, { title: e.target.value });
                    }}
                  />
                  <input
                    type="date"
                    defaultValue={ms.milestone_date ? String(ms.milestone_date).slice(0, 10) : ''}
                    key={`d-${ms.id}-${ms.updated_at}`}
                    className="sm:col-span-2 w-full text-xs border border-surface-200 rounded-lg px-2 py-2"
                    onBlur={(e) => patchMs(ms.id, { milestone_date: e.target.value || null })}
                  />
                  <select
                    defaultValue={ms.status}
                    key={`s-${ms.id}-${ms.updated_at}`}
                    className="sm:col-span-2 w-full text-xs border border-surface-200 rounded-lg px-2 py-2"
                    onChange={(e) => patchMs(ms.id, { status: e.target.value })}
                  >
                    <option value="planned">Planned</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                    <option value="deferred">Deferred</option>
                  </select>
                  <input
                    defaultValue={ms.description || ''}
                    key={`b-${ms.id}-${ms.updated_at}`}
                    placeholder="Notes"
                    className="sm:col-span-3 w-full text-xs border border-surface-200 rounded-lg px-2 py-2"
                    onBlur={(e) => patchMs(ms.id, { description: e.target.value || null })}
                  />
                  <button type="button" className="sm:col-span-1 text-red-600 text-xs font-semibold justify-self-end" onClick={() => delMs(ms.id)}>
                    Remove
                  </button>
                </li>
              ))}
              {milestones.length === 0 && <li className="text-sm text-surface-500">No milestones yet.</li>}
            </ul>
          </div>
        )}

        {sub === 'cv' && (
          <div className="max-w-2xl space-y-6">
            <div className="rounded-xl border-2 border-dashed border-surface-300 bg-surface-50 px-6 py-10 text-center">
              <p className="text-sm font-medium text-surface-900">Upload résumé or CV</p>
              <p className="text-xs text-surface-500 mt-1">PDF or Word, up to 15 MB. Stored securely for your account.</p>
              <label className="mt-4 inline-flex cursor-pointer px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
                Choose file
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,application/pdf" onChange={onCv} />
              </label>
            </div>
            <ul className="divide-y divide-surface-200 rounded-xl border border-surface-200 bg-white">
              {cvList.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-surface-900">{u.file_name}</p>
                    <p className="text-xs text-surface-500">{u.uploaded_at ? new Date(u.uploaded_at).toLocaleString() : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-600 hover:underline"
                      onClick={() => openAttachmentWithAuth(userCareer.cvDownloadUrl(u.id))}
                    >
                      Open
                    </button>
                    <button type="button" className="text-xs font-semibold text-red-600" onClick={() => userCareer.deleteCv(u.id).then(loadAll).catch((e) => setError(e?.message))}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {cvList.length === 0 && <li className="px-4 py-6 text-sm text-surface-500">No uploads yet.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
