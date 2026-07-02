import { useCallback, useEffect, useState } from 'react';
import { logisticsPlanning as lpApi } from '../../api';
import InfoHint from '../InfoHint.jsx';

const RISK_STYLES = {
  low: 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-900/50 dark:bg-emerald-950/20',
  medium: 'border-amber-300 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/20',
  high: 'border-rose-300 bg-rose-50/80 dark:border-rose-900/50 dark:bg-rose-950/20',
};

function DecisionTree({ nodes }) {
  if (!nodes?.length) return null;
  return (
    <div className="space-y-1.5 mt-2">
      {nodes.map((n) => (
        <div key={n.id} className="flex gap-2 text-xs">
          <span className="font-semibold text-surface-600 dark:text-surface-400 min-w-[6rem]">{n.label}</span>
          <span className="text-surface-800 dark:text-surface-200">{n.detail}</span>
        </div>
      ))}
    </div>
  );
}

export default function SystemAdviseTab({ planDate, onPlanChange, onError }) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [advise, setAdvise] = useState(null);
  const [plan, setPlan] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    onError('');
    try {
      const [adviseRes, planRes] = await Promise.all([
        lpApi.getAdvise(planDate),
        lpApi.getPlan(planDate),
      ]);
      setAdvise(adviseRes);
      setPlan(planRes.plan);
    } catch (e) {
      onError(e?.message || 'Could not load system advise');
    } finally {
      setLoading(false);
    }
  }, [planDate, onError]);

  useEffect(() => { load(); }, [load]);

  const applyAdvise = async () => {
    setApplying(true);
    onError('');
    try {
      const res = await lpApi.applyAdvise({ plan_date: planDate });
      setPlan(res.plan);
      onPlanChange?.(res);
      await load();
    } catch (e) {
      onError(e?.message || 'Could not apply advise');
    } finally {
      setApplying(false);
    }
  };

  const acceptPlan = async () => {
    if (!plan?.id) {
      await applyAdvise();
    }
    const current = plan?.id ? plan : (await lpApi.getPlan(planDate)).plan;
    if (!current?.id) return onError('Apply advise first');
    setAccepting(true);
    try {
      const res = await lpApi.acceptPlan(current.id, {
        execution_notes: advise?.summary?.learning_note,
      });
      setPlan(res.plan);
      onPlanChange?.({ plan: res.plan, routes: res.routes });
    } catch (e) {
      onError(e?.message || 'Accept failed');
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 p-4">Analysing routes…</p>;

  return (
    <div className="space-y-4">
      <InfoHint
        title="System advise — decision tree"
        text="Scores routes using slip-verified loads only (loading slip required). Learns from plan vs actual variance, margins, queue/travel time, and off-plan deviations. Accept to publish today's plan — team is notified by email."
      />

      {advise?.summary?.learning_note && (
        <p className="text-xs rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100">
          <strong>Learning:</strong> {advise.summary.learning_note}
          {advise.summary.slip_dependency && <> · {advise.summary.slip_dependency}</>}
        </p>
      )}

      <div className="app-glass-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Fleet avg margin (est.): R {(advise?.fleet_avg_margin ?? 0).toLocaleString('en-ZA')}</p>
          <p className="text-xs text-surface-500">{advise?.routes_analyzed ?? 0} routes analysed · Top: {advise?.summary?.top_route || '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="px-3 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600">Refresh</button>
          <button type="button" onClick={applyAdvise} disabled={applying} className="px-4 py-2 text-sm rounded-lg border border-violet-300 text-violet-800 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-50">
            {applying ? 'Applying…' : 'Apply to planner'}
          </button>
          <button type="button" onClick={acceptPlan} disabled={accepting} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {accepting ? 'Publishing…' : 'Accept & publish plan'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {(advise?.recommendations || []).map((r) => (
          <div key={r.contractor_route_id} className={`rounded-xl border p-4 ${RISK_STYLES[r.risk_level] || RISK_STYLES.medium}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-surface-900 dark:text-surface-100">
                  #{r.priority_rank} {r.route_name}
                  {r.is_plan_b && <span className="ml-2 text-[10px] uppercase font-bold text-violet-700 dark:text-violet-300">Plan B</span>}
                </p>
                <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">Score {r.system_score}/100 · {r.execution_reason}</p>
              </div>
              <div className="text-right text-xs tabular-nums">
                {r.expected_margin != null && <p className="font-semibold text-emerald-700 dark:text-emerald-300">~R {r.expected_margin.toLocaleString('en-ZA')} margin/load</p>}
                {r.expected_revenue != null && <p className="text-surface-500">Rev ~R {r.expected_revenue.toLocaleString('en-ZA')}</p>}
              </div>
            </div>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-2">{r.system_advice}</p>
            {r.risk_mitigation && (
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 whitespace-pre-line"><strong>Mitigation:</strong> {r.risk_mitigation}</p>
            )}
            {r.plan_b_route_name && (
              <p className="text-xs text-violet-700 dark:text-violet-300 mt-1">Plan B: {r.plan_b_route_name}</p>
            )}
            <DecisionTree nodes={r.decision_tree} />
          </div>
        ))}
      </div>
    </div>
  );
}
