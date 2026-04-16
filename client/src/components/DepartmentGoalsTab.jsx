import { useState, useEffect, useCallback } from 'react';
import { teamGoals } from '../api';
import InfoHint from './InfoHint.jsx';

function parseJsonArray(raw, fallback = []) {
  if (!raw) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function newRow() {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: '',
    metric_name: '',
    target_value: '',
    unit: '',
    status: 'active',
  };
}

export default function DepartmentGoalsTab() {
  const [vision, setVision] = useState('');
  const [mission, setMission] = useState('');
  const [goals, setGoals] = useState([newRow()]);
  const [objectives, setObjectives] = useState([newRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    teamGoals
      .getDepartment()
      .then((d) => {
        setVision(d.vision || '');
        setMission(d.mission || '');
        const g = parseJsonArray(d.goals_json);
        const o = parseJsonArray(d.objectives_json);
        setGoals(g.length ? g.map((x) => ({ ...newRow(), ...x, title: x.title || x.name || '' })) : [newRow()]);
        setObjectives(o.length ? o.map((x) => ({ ...newRow(), ...x, title: x.title || x.name || '' })) : [newRow()]);
        setUpdatedAt(d.updated_at || null);
      })
      .catch((e) => setError(e?.message || 'Could not load department strategy'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
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
      await teamGoals.putDepartment({
        vision,
        mission,
        goals_json: JSON.stringify(goalsClean),
        objectives_json: JSON.stringify(objClean),
      });
      await load();
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const renderMeasurableTable = (rows, setRows, label) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-surface-900">{label}</h3>
        <button
          type="button"
          onClick={() => setRows((r) => [...r, newRow()])}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Add row
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-surface-50 border-b border-surface-200 text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-surface-700">Title</th>
              <th className="px-3 py-2 font-medium text-surface-700 w-[140px]">Metric</th>
              <th className="px-3 py-2 font-medium text-surface-700 w-[100px]">Target</th>
              <th className="px-3 py-2 font-medium text-surface-700 w-[80px]">Unit</th>
              <th className="px-3 py-2 font-medium text-surface-700 w-[110px]">Status</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {rows.map((row, idx) => (
              <tr key={row.id || idx}>
                <td className="px-3 py-2">
                  <input
                    value={row.title}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                    placeholder="e.g. Reduce handover defects"
                    className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.metric_name || ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, metric_name: e.target.value } : x)))}
                    placeholder="e.g. count"
                    className="w-full px-2 py-1.5 rounded border border-surface-200 text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={row.target_value ?? ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, target_value: e.target.value } : x)))}
                    className="w-full px-2 py-1.5 rounded border border-surface-200 text-xs font-mono"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.unit || ''}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                    placeholder="%"
                    className="w-full px-2 py-1.5 rounded border border-surface-200 text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.status || 'active'}
                    onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, status: e.target.value } : x)))}
                    className="w-full px-2 py-1.5 rounded border border-surface-200 text-xs"
                  >
                    <option value="active">Active</option>
                    <option value="achieved">Achieved</option>
                    <option value="paused">Paused</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== idx)))}
                    className="text-surface-400 hover:text-red-600 text-xs"
                    aria-label="Remove row"
                  >
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
      <div className="rounded-xl border border-surface-200 bg-white p-8 animate-pulse space-y-4">
        <div className="h-8 bg-surface-100 rounded w-1/3" />
        <div className="h-40 bg-surface-100 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-surface-900">Departmental goals &amp; objectives</h2>
            <InfoHint
              title="Vision, mission, measurable goals"
              text="Set organisation-wide vision and mission. Goals and objectives should include a clear metric and target where possible. Mark rows as Achieved when completed — management and profile share the same record for your tenant."
            />
          </div>
          {updatedAt && (
            <p className="text-xs text-surface-500 mt-1">Last updated {new Date(updatedAt).toLocaleString()}</p>
          )}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wide mb-1">Vision</label>
          <textarea
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm"
            placeholder="Where we are heading…"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wide mb-1">Mission</label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-xl border border-surface-200 text-sm"
            placeholder="Why we exist and how we serve…"
          />
        </div>
      </div>

      {renderMeasurableTable(goals, setGoals, 'Strategic goals (measurable)')}
      {renderMeasurableTable(objectives, setObjectives, 'Objectives (measurable)')}
    </div>
  );
}
