import { useState, useEffect, useCallback, useMemo } from 'react';
import { teamGoals } from '../api';
import InfoHint from './InfoHint.jsx';
import { todayYmd } from '../lib/appTime.js';
import { useAuth } from '../AuthContext';

function parseMembers(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

function normId(v) {
  return v != null ? String(v).toLowerCase().replace(/[{}]/g, '') : '';
}

export default function ShiftObjectivesTab({ userId, tenantUsers = [], leadershipMode = false }) {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [isTeamLeader, setIsTeamLeader] = useState(false);
  const [form, setForm] = useState({
    scope: 'shift',
    title: '',
    metric_name: '',
    target_value: '',
    current_value: '',
    unit: '',
    work_date: todayYmd(),
    shift_type: 'day',
    team_name: '',
    leader_user_id: '',
    member_user_ids: [],
  });

  const uid = userId != null ? String(userId) : '';
  const uidN = normId(uid);

  useEffect(() => {
    if (form.scope === 'team' && uid && isTeamLeader) {
      setForm((f) => (f.leader_user_id ? f : { ...f, leader_user_id: uid }));
    }
  }, [form.scope, uid, isTeamLeader]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([teamGoals.listObjectives().catch(() => ({ objectives: [] })), teamGoals.teamLeaderMe().catch(() => ({ isAssigned: false }))])
      .then(([o, me]) => {
        setList(o.objectives || []);
        setIsTeamLeader(!!me.isAssigned);
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (leadershipMode) return list || [];
    return (list || []).filter((row) => {
      const created = normId(row.created_by ?? row.created_By);
      const leader = normId(row.leader_user_id ?? row.leader_User_Id);
      const members = parseMembers(row.member_user_ids ?? row.member_User_Ids);
      const scope = String(row.scope || '').toLowerCase();
      if (scope === 'shift') return created === uidN;
      if (scope === 'team') {
        return created === uidN || leader === uidN || members.map(normId).includes(uidN);
      }
      return false;
    });
  }, [list, uidN, leadershipMode]);

  const nameById = useMemo(() => {
    const m = new Map();
    (tenantUsers || []).forEach((u) => {
      const id = u.id != null ? String(u.id) : '';
      if (id) m.set(normId(id), u.full_name || u.email || id);
    });
    return m;
  }, [tenantUsers]);

  const canEditObjective = (row) => {
    if (leadershipMode) return true;
    const scope = String(row.scope || '').toLowerCase();
    const leader = normId(row.leader_user_id ?? row.leader_User_Id);
    const created = normId(row.created_by ?? row.created_By);
    if (scope === 'shift') return created === uidN;
    if (scope === 'team') return leader === uidN && isTeamLeader;
    return false;
  };

  const canUseTeamScope = leadershipMode && (isTeamLeader || user?.role === 'super_admin');

  const submitCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (form.scope === 'team' && !canUseTeamScope) {
      setError('Only users with the Team leader admin page role (or platform admin) can create team objectives.');
      return;
    }
    const leaderId = form.scope === 'team' ? form.leader_user_id || uid : null;
    try {
      await teamGoals.createObjective({
        scope: form.scope,
        title: form.title.trim(),
        metric_name: form.metric_name || null,
        target_value: form.target_value === '' ? null : Number(form.target_value),
        current_value: form.current_value === '' ? null : Number(form.current_value),
        unit: form.unit || null,
        status: 'active',
        work_date: form.work_date || null,
        shift_type: form.shift_type,
        team_name: form.team_name || null,
        leader_user_id: leaderId,
        member_user_ids: form.scope === 'team' ? form.member_user_ids : [],
      });
      setForm((f) => ({
        ...f,
        title: '',
        metric_name: '',
        target_value: '',
        current_value: '',
        unit: '',
        team_name: '',
        member_user_ids: [],
      }));
      await load();
    } catch (err) {
      setError(err?.message || 'Could not create objective');
    }
  };

  const patchRow = async (id, body) => {
    setBusyId(id);
    setError('');
    try {
      await teamGoals.patchObjective(id, body);
      await load();
    } catch (e) {
      setError(e?.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-8 animate-pulse space-y-4">
        <div className="h-8 bg-surface-100 rounded w-1/2" />
        <div className="h-32 bg-surface-100 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900">
          {leadershipMode ? 'Operations · shift & team objectives' : 'Shift & team objectives'}
        </h2>
        <InfoHint
          title="Measurable shift and team goals"
          text={
            leadershipMode
              ? 'Maintain operational shift and crew-wide team objectives for your tenant. Updates feed Command Centre productivity scoring when objectives are achieved.'
              : 'Create personal shift objectives, or team objectives when you have the Team leader admin page role. Use metric, target, and current value. Mark Achieved when met — credited users earn team-progress productivity points (Command Centre roster).'
          }
        />
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <form onSubmit={submitCreate} className="rounded-xl border border-surface-200 bg-white p-4 space-y-3 shadow-sm">
        <h3 className="text-sm font-semibold text-surface-900">New objective</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-surface-500 mb-1">Scope</label>
            <select
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
              className="px-2 py-1.5 rounded border border-surface-200 text-sm"
            >
              <option value="shift">{leadershipMode ? 'Shift / operational' : 'My shift'}</option>
              <option value="team" disabled={!canUseTeamScope}>
                Team {canUseTeamScope ? '' : '(team leader page role only)'}
              </option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-surface-500 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
              placeholder="Objective title"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Work date</label>
            <input
              type="date"
              value={form.work_date}
              onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))}
              className="px-2 py-1.5 rounded border border-surface-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Shift</label>
            <select
              value={form.shift_type}
              onChange={(e) => setForm((f) => ({ ...f, shift_type: e.target.value }))}
              className="px-2 py-1.5 rounded border border-surface-200 text-sm"
            >
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-surface-500 mb-1">Metric</label>
            <input
              value={form.metric_name}
              onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Target</label>
            <input
              type="number"
              value={form.target_value}
              onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Current</label>
            <input
              type="number"
              value={form.current_value}
              onChange={(e) => setForm((f) => ({ ...f, current_value: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-500 mb-1">Unit</label>
            <input
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
            />
          </div>
        </div>
        {form.scope === 'team' && canUseTeamScope && (
          <div className="grid gap-2 sm:grid-cols-2 border-t border-surface-100 pt-3">
            <div>
              <label className="block text-xs text-surface-500 mb-1">Team name</label>
              <input
                value={form.team_name}
                onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))}
                className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">You as leader</label>
              <select
                value={form.leader_user_id}
                onChange={(e) => setForm((f) => ({ ...f, leader_user_id: e.target.value }))}
                className="w-full px-2 py-1.5 rounded border border-surface-200 text-sm"
              >
                <option value="">Select…</option>
                {uid && (
                  <option value={uid}>
                    Me ({nameById.get(normId(uid)) || 'self'})
                  </option>
                )}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-surface-500 mb-1">Members (same shift/day)</label>
              <select
                multiple
                value={form.member_user_ids}
                onChange={(e) => {
                  const opts = [...e.target.selectedOptions].map((o) => o.value);
                  setForm((f) => ({ ...f, member_user_ids: opts }));
                }}
                className="w-full min-h-[88px] px-2 py-1.5 rounded border border-surface-200 text-sm"
              >
                {(tenantUsers || []).map((u) => {
                  const id = String(u.id);
                  if (normId(id) === uidN) return null;
                  return (
                    <option key={id} value={id}>
                      {u.full_name || u.email}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-surface-500 mt-1">Hold Cmd/Ctrl to select multiple.</p>
            </div>
          </div>
        )}
        <button type="submit" className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Add objective
        </button>
      </form>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80">
          <h3 className="font-semibold text-surface-900 text-sm">Your objectives</h3>
          <p className="text-xs text-surface-500 mt-0.5">
            {leadershipMode ? `${visible.length} objectives in tenant` : `${visible.length} visible (shift + teams you belong to)`}
          </p>
        </div>
        <div className="overflow-x-auto">
          {visible.length === 0 ? (
            <p className="p-4 text-sm text-surface-500">No objectives yet.</p>
          ) : (
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-surface-700">Title</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700">Scope</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700">Metric / progress</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 w-[200px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {visible.map((row) => {
                  const id = row.id ?? row.Id;
                  const editable = canEditObjective(row);
                  const members = parseMembers(row.member_user_ids ?? row.member_User_Ids);
                  return (
                    <tr key={id}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-surface-900">{row.title}</span>
                        {row.team_name && <span className="block text-xs text-surface-500">{row.team_name}</span>}
                      </td>
                      <td className="px-3 py-2 capitalize text-xs">{row.scope}</td>
                      <td className="px-3 py-2 text-xs text-surface-700">
                        {row.metric_name && (
                          <span>
                            {row.metric_name}: {row.current_value ?? '—'} / {row.target_value ?? '—'} {row.unit || ''}
                          </span>
                        )}
                        {!row.metric_name && '—'}
                        {String(row.scope).toLowerCase() === 'team' && members.length > 0 && (
                          <span className="block text-surface-500 mt-0.5">{members.length} members</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            row.status === 'achieved' ? 'bg-emerald-100 text-emerald-900' : 'bg-surface-100 text-surface-700'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <div className="flex flex-wrap gap-2 items-center">
                            <input
                              type="number"
                              defaultValue={row.current_value ?? ''}
                              key={`cv-${id}-${row.updated_at}`}
                              className="w-24 px-2 py-1 rounded border border-surface-200 text-xs font-mono"
                              id={`cv-${id}`}
                            />
                            <button
                              type="button"
                              disabled={busyId === id}
                              onClick={() => {
                                const el = document.getElementById(`cv-${id}`);
                                const v = el?.value;
                                patchRow(id, { current_value: v === '' ? null : Number(v) });
                              }}
                              className="text-xs text-brand-600 font-medium"
                            >
                              Save progress
                            </button>
                            <select
                              defaultValue={row.status}
                              key={`st-${id}-${row.updated_at}`}
                              disabled={busyId === id}
                              onChange={(e) => patchRow(id, { status: e.target.value })}
                              className="text-xs rounded border border-surface-200 px-2 py-1"
                            >
                              <option value="active">active</option>
                              <option value="achieved">achieved</option>
                              <option value="paused">paused</option>
                            </select>
                          </div>
                        ) : (
                          <span className="text-xs text-surface-400">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
