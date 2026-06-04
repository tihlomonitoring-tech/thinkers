import { useState, useEffect } from 'react';
import { profileManagement as pm } from '../api';
import InfoHint from './InfoHint.jsx';
import WrittenWarningsManagement from './WrittenWarningsManagement.jsx';

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function CategoryEditor({ categories, onRefresh, onError }) {
  const [form, setForm] = useState({ kind: 'credit', name: '', description: '', default_points: 1, sort_order: 0 });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setForm({ kind: 'credit', name: '', description: '', default_points: 1, sort_order: 0 });
    setEditingId(null);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      onError('Category name required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      const body = {
        kind: form.kind,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        default_points: Number(form.default_points) || 1,
        sort_order: Number(form.sort_order) || 0,
        ...(editingId ? { is_active: form.is_active !== false } : {}),
      };
      if (editingId) await pm.creditDemeritCategories.update(editingId, body);
      else await pm.creditDemeritCategories.create(body);
      reset();
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      kind: c.kind,
      name: c.name || '',
      description: c.description || '',
      default_points: c.default_points ?? 1,
      sort_order: c.sort_order ?? 0,
      is_active: c.is_active !== false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-surface-900">Credit & demerit categories</h2>
        <InfoHint
          title="Categories"
          text="Define reusable categories for grace credits and debtor sanctions. Management selects these when recording credits or demerits from the productivity score roster or manually."
        />
      </div>
      <form onSubmit={save} className="app-glass-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Kind</label>
          <select
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            disabled={!!editingId}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          >
            <option value="credit">Grace credit</option>
            <option value="demerit">Debtor sanction (demerit)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            placeholder="e.g. Score recovery"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Default points</label>
          <input
            type="number"
            min={1}
            value={form.default_points}
            onChange={(e) => setForm((f) => ({ ...f, default_points: e.target.value }))}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-surface-600 mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : editingId ? 'Update' : 'Add category'}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-3 py-2 rounded-lg border border-surface-300 text-sm">
              Cancel
            </button>
          )}
        </div>
      </form>
      <div className="grid md:grid-cols-2 gap-4">
        {['credit', 'demerit'].map((kind) => (
          <div key={kind} className="app-glass-card overflow-hidden">
            <p className="px-4 py-2 text-sm font-medium border-b border-surface-100">
              {kind === 'credit' ? 'Grace credit categories' : 'Debtor sanction categories'}
            </p>
            <ul className="divide-y divide-surface-100 max-h-64 overflow-y-auto text-sm">
              {categories.filter((c) => c.kind === kind).map((c) => (
                <li key={c.id} className="px-4 py-2 flex justify-between gap-2">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-surface-500 text-xs ml-1">({c.default_points} pts)</span>
                    {c.is_active === false && <span className="text-red-600 text-xs ml-1">inactive</span>}
                  </div>
                  <button type="button" onClick={() => startEdit(c)} className="text-brand-600 text-xs font-medium shrink-0">
                    Edit
                  </button>
                </li>
              ))}
              {!categories.filter((c) => c.kind === kind).length && (
                <li className="px-4 py-3 text-surface-500">None yet.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WarningsRewardsManagement({
  tenantUsers,
  warnings = [],
  rewards = [],
  graceCredits = [],
  sanctions = [],
  onRefresh,
  onError,
}) {
  const [subTab, setSubTab] = useState('warnings');
  const [categories, setCategories] = useState([]);
  const [warningUser, setWarningUser] = useState('');
  const [warningType, setWarningType] = useState('');
  const [warningDesc, setWarningDesc] = useState('');
  const [rewardUser, setRewardUser] = useState('');
  const [rewardType, setRewardType] = useState('');
  const [rewardDesc, setRewardDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState([]);
  const [allocTeam, setAllocTeam] = useState('');
  const [allocKind, setAllocKind] = useState('credit');
  const [allocPoints, setAllocPoints] = useState(10);
  const [allocJust, setAllocJust] = useState('');
  const [allocSaving, setAllocSaving] = useState(false);

  const loadCategories = () => {
    pm.creditDemeritCategories
      .listAll()
      .then((d) => setCategories(d.categories || []))
      .catch(() => setCategories([]));
  };

  const loadTeams = () => {
    pm.teamPointPools.list().then((d) => setTeams(d.teams || [])).catch(() => setTeams([]));
  };

  useEffect(() => {
    loadCategories();
    loadTeams();
  }, []);

  const submitWarning = async (e) => {
    e.preventDefault();
    if (!warningUser || !warningType) {
      onError('Select employee and enter warning type');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.warnings.create({ user_id: warningUser, warning_type: warningType.trim(), description: warningDesc.trim() || undefined });
      setWarningUser('');
      setWarningType('');
      setWarningDesc('');
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const submitReward = async (e) => {
    e.preventDefault();
    if (!rewardUser || !rewardType) {
      onError('Select employee and enter reward type');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.rewards.create({ user_id: rewardUser, reward_type: rewardType.trim(), description: rewardDesc.trim() || undefined });
      setRewardUser('');
      setRewardType('');
      setRewardDesc('');
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const submitTeamAlloc = async (e) => {
    e.preventDefault();
    if (!allocTeam || !allocJust.trim()) {
      onError('Select team and enter justification');
      return;
    }
    setAllocSaving(true);
    onError('');
    try {
      await pm.teamPointPools.allocate({
        team_key: allocTeam,
        kind: allocKind,
        points: Number(allocPoints) || 1,
        justification: allocJust.trim(),
      });
      setAllocJust('');
      loadTeams();
      onRefresh?.();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setAllocSaving(false);
    }
  };

  const subTabs = [
    { id: 'warnings', label: 'Quick warnings & rewards' },
    { id: 'written', label: 'Written warnings & PIP' },
    { id: 'teams', label: 'Team points' },
    { id: 'categories', label: 'Categories' },
    { id: 'ledger', label: 'Member ledger' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Warnings & rewards</h1>
          <InfoHint
            title="Disciplinary programme"
            text="Management allocates grace credit and sanction points to teams (not individuals). Team leaders issue credits and demerits to members from Team leader admin → Daily pulse, using your categories. Employee credit requests go to team leaders."
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-surface-200 overflow-x-auto">
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              subTab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'written' && (
        <WrittenWarningsManagement tenantUsers={tenantUsers} onError={onError} />
      )}

      {subTab === 'warnings' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="app-glass-card p-4">
              <p className="text-sm font-medium text-surface-700 mb-2">Issue warning</p>
              <form onSubmit={submitWarning} className="space-y-2">
                <select value={warningUser} onChange={(e) => setWarningUser(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                  <option value="">Select employee</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
                <input type="text" value={warningType} onChange={(e) => setWarningType(e.target.value)} placeholder="Warning type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                <textarea value={warningDesc} onChange={(e) => setWarningDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50">
                  Submit warning
                </button>
              </form>
            </div>
            <div className="app-glass-card p-4">
              <p className="text-sm font-medium text-surface-700 mb-2">Issue reward</p>
              <form onSubmit={submitReward} className="space-y-2">
                <select value={rewardUser} onChange={(e) => setRewardUser(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                  <option value="">Select employee</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
                <input type="text" value={rewardType} onChange={(e) => setRewardType(e.target.value)} placeholder="Reward type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                <textarea value={rewardDesc} onChange={(e) => setRewardDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-sm font-medium hover:bg-emerald-200 disabled:opacity-50">
                  Submit reward
                </button>
              </form>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="app-glass-card overflow-hidden">
              <p className="px-4 py-2 text-sm font-medium text-surface-700 border-b border-surface-100">Warnings (history)</p>
              {warnings.length === 0 ? (
                <p className="p-4 text-sm text-surface-500">No warnings on record.</p>
              ) : (
                <ul className="divide-y divide-surface-100 max-h-80 overflow-y-auto">
                  {warnings.map((w) => (
                    <li key={w.id} className="px-4 py-3 text-sm">
                      <span className="font-medium">{w.user_name || w.user_email}</span>
                      <span className="text-amber-700 ml-1">— {w.warning_type}</span>
                      <span className="text-surface-400 text-xs ml-1">{formatDate(w.created_at)}</span>
                      {w.description && <p className="text-surface-600 mt-0.5">{w.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="app-glass-card overflow-hidden">
              <p className="px-4 py-2 text-sm font-medium text-surface-700 border-b border-surface-100">Rewards (history)</p>
              {rewards.length === 0 ? (
                <p className="p-4 text-sm text-surface-500">No rewards on record.</p>
              ) : (
                <ul className="divide-y divide-surface-100 max-h-80 overflow-y-auto">
                  {rewards.map((r) => (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <span className="font-medium">{r.user_name || r.user_email}</span>
                      <span className="text-emerald-700 ml-1">— {r.reward_type}</span>
                      <span className="text-surface-400 text-xs ml-1">{formatDate(r.created_at)}</span>
                      {r.description && <p className="text-surface-600 mt-0.5">{r.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {subTab === 'teams' && (
        <div className="space-y-4">
          <p className="text-sm text-surface-600">
            Allocate points to named teams (from shift &amp; team objectives). Team leaders spend team pool balances when issuing demerits; credits combine leader weekly wallet + team pool.
          </p>
          <form onSubmit={submitTeamAlloc} className="app-glass-card p-4 grid sm:grid-cols-2 gap-3 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Team</label>
              <select value={allocTeam} onChange={(e) => setAllocTeam(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" required>
                <option value="">— Select team —</option>
                {teams.map((t) => (
                  <option key={t.team_key} value={t.team_key}>
                    {t.team_key} (credits {t.grace_points_balance ?? 0}, sanctions {t.sanction_points_balance ?? 0})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Kind</label>
              <select value={allocKind} onChange={(e) => setAllocKind(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="credit">Grace credits (team pool)</option>
                <option value="demerit">Sanction points (team pool)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Points</label>
              <input type="number" min={1} value={allocPoints} onChange={(e) => setAllocPoints(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-600 mb-1">Justification</label>
              <textarea value={allocJust} onChange={(e) => setAllocJust(e.target.value)} rows={2} required className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={allocSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium sm:col-span-2">
              {allocSaving ? 'Saving…' : 'Allocate to team'}
            </button>
          </form>
          <div className="app-glass-card overflow-hidden">
            <p className="px-4 py-2 text-sm font-medium border-b">Team balances</p>
            <ul className="divide-y text-sm">
              {teams.map((t) => (
                <li key={t.team_key} className="px-4 py-2 flex justify-between">
                  <span className="font-medium">{t.team_key}</span>
                  <span className="text-surface-600 tabular-nums">
                    credits {t.grace_points_balance ?? 0} · sanctions {t.sanction_points_balance ?? 0}
                  </span>
                </li>
              ))}
              {!teams.length && <li className="px-4 py-4 text-surface-500">No teams yet — create team-scoped objectives first.</li>}
            </ul>
          </div>
        </div>
      )}

      {subTab === 'categories' && (
        <CategoryEditor
          categories={categories}
          onRefresh={() => {
            loadCategories();
            onRefresh?.();
          }}
          onError={onError}
        />
      )}

      {subTab === 'ledger' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="app-glass-card overflow-hidden">
            <p className="px-4 py-2 text-sm font-medium text-emerald-800 border-b border-emerald-100 bg-emerald-50/50">Grace credits</p>
            <ul className="divide-y divide-surface-100 max-h-96 overflow-y-auto text-sm">
              {graceCredits.map((g) => (
                <li key={g.id} className="px-4 py-3">
                  <span className="font-medium">{g.user_name || g.user_email}</span>
                  <span className="text-emerald-700 ml-1">+{g.points} pts</span>
                  {g.category_name && <span className="text-surface-500 text-xs block">{g.category_name}</span>}
                  <p className="text-surface-600 mt-0.5">{g.justification}</p>
                  <p className="text-xs text-surface-400">{formatDate(g.created_at)} · {g.issued_by_name || 'Management'}</p>
                </li>
              ))}
              {!graceCredits.length && <li className="px-4 py-4 text-surface-500">No grace credits yet.</li>}
            </ul>
          </div>
          <div className="app-glass-card overflow-hidden">
            <p className="px-4 py-2 text-sm font-medium text-red-800 border-b border-red-100 bg-red-50/50">Debtor sanctions</p>
            <ul className="divide-y divide-surface-100 max-h-96 overflow-y-auto text-sm">
              {sanctions.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <span className="font-medium">{s.user_name || s.user_email}</span>
                  <span className="text-red-700 ml-1">−{s.points} pts</span>
                  {s.category_name && <span className="text-surface-500 text-xs block">{s.category_name}</span>}
                  <p className="text-surface-600 mt-0.5">{s.justification}</p>
                  <p className="text-xs text-surface-400">{formatDate(s.created_at)} · {s.issued_by_name || 'Management'}</p>
                </li>
              ))}
              {!sanctions.length && <li className="px-4 py-4 text-surface-500">No sanctions yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
