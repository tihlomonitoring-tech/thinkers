import { useState, useEffect, useCallback } from 'react';
import { teamGoals } from '../api';
import InfoHint from './InfoHint.jsx';

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

function StatPill({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-surface-50 text-surface-800 border-surface-200',
    positive: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone] || tones.neutral}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5 text-surface-900">{value}</p>
    </div>
  );
}

export default function DepartmentStrategyView() {
  const [dept, setDept] = useState(null);
  const [teamObj, setTeamObj] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([teamGoals.getDepartment(), teamGoals.listProfileTeamObjectives().catch(() => ({ objectives: [] }))])
      .then(([d, o]) => {
        setDept(d);
        setTeamObj(o.objectives || []);
      })
      .catch((e) => setError(e?.message || 'Could not load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-200 bg-white p-10 animate-pulse space-y-6">
        <div className="h-8 bg-surface-100 rounded-lg w-2/5" />
        <div className="h-32 bg-surface-100 rounded-xl" />
      </div>
    );
  }

  const goals = parseJsonArray(dept?.goals_json);
  const objectives = parseJsonArray(dept?.objectives_json);
  const activeGoals = goals.filter((g) => String(g.status || 'active').toLowerCase() !== 'paused');
  const achievedGoals = goals.filter((g) => String(g.status || '').toLowerCase() === 'achieved');
  const activeTeam = (teamObj || []).filter((x) => String(x.status || '').toLowerCase() === 'active').length;
  const doneTeam = (teamObj || []).filter((x) => String(x.status || '').toLowerCase() === 'achieved').length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-surface-900">Department vision &amp; direction</h2>
              <InfoHint
                title="Why read-only?"
                text="Alignment metrics and narrative strategy are owned by management so everyone sees the same official line. Use Career & personal goals for your own development plan."
              />
            </div>
            <p className="text-sm text-surface-600 mt-1 max-w-3xl">
              Read-only dashboard. Updates are published by <strong className="text-surface-800">Management</strong> under Management → Team goals &amp; shift objectives.
            </p>
            {dept?.updated_at && (
              <p className="text-xs text-surface-500 mt-2">Strategy last updated {new Date(dept.updated_at).toLocaleString()}</p>
            )}
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Strategic goals (active)" value={activeGoals.length} tone="neutral" />
        <StatPill label="Goals achieved" value={achievedGoals.length} tone="positive" />
        <StatPill label="Team objectives active" value={activeTeam} tone="neutral" />
        <StatPill label="Team objectives achieved" value={doneTeam} tone="positive" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Vision</h3>
          <p className="mt-3 text-surface-800 text-sm leading-relaxed whitespace-pre-wrap">{dept?.vision?.trim() || '— Not yet published —'}</p>
        </section>
        <section className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Mission</h3>
          <p className="mt-3 text-surface-800 text-sm leading-relaxed whitespace-pre-wrap">{dept?.mission?.trim() || '— Not yet published —'}</p>
        </section>
      </div>

      <section className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-surface-900">Published goals &amp; objectives</h3>
          <span className="text-xs text-surface-500">{goals.length + objectives.length} rows</span>
        </div>
        <div className="p-4 sm:p-6 grid gap-8 lg:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-surface-600 uppercase tracking-wide mb-3">Strategic goals</h4>
            <ul className="space-y-3">
              {goals.length === 0 && <li className="text-sm text-surface-500">None published.</li>}
              {goals.map((g, i) => (
                <li key={g.id || i} className="rounded-lg border border-surface-100 bg-surface-50/80 px-4 py-3">
                  <div className="flex justify-between gap-2 items-start">
                    <span className="font-medium text-surface-900 text-sm">{g.title || '—'}</span>
                    <span className="text-[10px] uppercase font-semibold text-surface-500 shrink-0">{g.status || 'active'}</span>
                  </div>
                  {(g.metric_name || g.target_value != null) && (
                    <p className="text-xs text-surface-600 mt-1">
                      {g.metric_name}
                      {g.target_value != null && (
                        <>
                          : <span className="font-mono tabular-nums">{g.target_value}</span> {g.unit || ''}
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-surface-600 uppercase tracking-wide mb-3">Objectives</h4>
            <ul className="space-y-3">
              {objectives.length === 0 && <li className="text-sm text-surface-500">None published.</li>}
              {objectives.map((g, i) => (
                <li key={g.id || i} className="rounded-lg border border-surface-100 bg-surface-50/80 px-4 py-3">
                  <div className="flex justify-between gap-2 items-start">
                    <span className="font-medium text-surface-900 text-sm">{g.title || '—'}</span>
                    <span className="text-[10px] uppercase font-semibold text-surface-500 shrink-0">{g.status || 'active'}</span>
                  </div>
                  {(g.metric_name || g.target_value != null) && (
                    <p className="text-xs text-surface-600 mt-1">
                      {g.metric_name}
                      {g.target_value != null && (
                        <>
                          : <span className="font-mono tabular-nums">{g.target_value}</span> {g.unit || ''}
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100 bg-surface-50">
          <h3 className="text-sm font-semibold text-surface-900">Team shift objectives (visibility)</h3>
          <p className="text-xs text-surface-500 mt-1">Operational team goals your leaders maintain — view only.</p>
        </div>
        <div className="overflow-x-auto">
          {teamObj.length === 0 ? (
            <p className="p-6 text-sm text-surface-500">No team objectives published yet.</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-surface-50 border-b border-surface-200 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium text-surface-700">Objective</th>
                  <th className="px-4 py-2 font-medium text-surface-700">Team</th>
                  <th className="px-4 py-2 font-medium text-surface-700">Progress</th>
                  <th className="px-4 py-2 font-medium text-surface-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {teamObj.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-50/80">
                    <td className="px-4 py-3 font-medium text-surface-900">{row.title}</td>
                    <td className="px-4 py-3 text-surface-600 text-xs">{row.team_name || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-surface-700">
                      {row.metric_name ? (
                        <>
                          {row.current_value ?? '—'} / {row.target_value ?? '—'} {row.unit || ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface-100 text-surface-800 capitalize">{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
