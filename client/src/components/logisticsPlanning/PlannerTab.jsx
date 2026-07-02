import { useCallback, useEffect, useState } from 'react';
import { logisticsPlanning as lpApi, contractor as contractorApi } from '../../api';
import InfoHint from '../InfoHint.jsx';

const inputClass =
  'w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950';

const RISK_STYLES = {
  low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  medium: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  high: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
};

export default function PlannerTab({ planDate, onPlanChange, onError }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allRoutes, setAllRoutes] = useState([]);
  const [plan, setPlan] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    onError('');
    try {
      const [planRes, routesRes] = await Promise.all([
        lpApi.getPlan(planDate),
        contractorApi.routes.list().catch(() => ({ routes: [] })),
      ]);
      setAllRoutes(routesRes.routes || routesRes || []);
      setPlan(planRes.plan);
      setRoutes(planRes.routes || []);
      setNotes(planRes.plan?.execution_notes || '');
      onPlanChange?.(planRes);
    } catch (e) {
      onError(e?.message || 'Could not load plan');
    } finally {
      setLoading(false);
    }
  }, [planDate, onError, onPlanChange]);

  useEffect(() => { load(); }, [load]);

  const toggleRoute = (routeId) => {
    const exists = routes.find((r) => r.contractor_route_id === routeId);
    if (exists) {
      setRoutes((prev) => prev.filter((r) => r.contractor_route_id !== routeId));
      return;
    }
    const meta = allRoutes.find((r) => r.id === routeId);
    setRoutes((prev) => [...prev, {
      contractor_route_id: routeId,
      route_name: meta?.name,
      priority_rank: prev.length + 1,
      is_plan_b: false,
      expected_loads: 1,
      risk_level: 'medium',
      execution_reason: '',
      risk_mitigation: '',
      enabled: true,
    }]);
  };

  const updateRoute = (routeId, patch) => {
    setRoutes((prev) => prev.map((r) => (r.contractor_route_id === routeId ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    setSaving(true);
    onError('');
    try {
      const ranked = routes.map((r, i) => ({ ...r, priority_rank: i + 1 }));
      const res = await lpApi.savePlan({
        plan_date: planDate,
        title: `Logistics plan — ${planDate}`,
        execution_notes: notes,
        routes: ranked,
      });
      setPlan(res.plan);
      setRoutes(res.routes || []);
      onPlanChange?.(res);
    } catch (e) {
      onError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!plan?.id) {
      await save();
    }
    const current = plan?.id ? plan : (await lpApi.getPlan(planDate)).plan;
    if (!current?.id) return onError('Save the plan first');
    setSaving(true);
    try {
      const res = await lpApi.acceptPlan(current.id, { execution_notes: notes });
      setPlan(res.plan);
      setRoutes(res.routes || []);
      onPlanChange?.({ plan: res.plan, routes: res.routes });
    } catch (e) {
      onError(e?.message || 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-surface-500 p-4">Loading planner…</p>;

  const selectedIds = new Set(routes.map((r) => r.contractor_route_id));

  return (
    <div className="space-y-4">
      <InfoHint
        title="Daily logistics planner"
        text="Select routes for today, set priorities, Plan B alternatives, risk mitigation, expected targets, and execution reasons. Publish to send the plan to Tracking Management schedule load."
      />

      <div className="app-glass-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">Plan for {planDate}</p>
          <p className="text-xs text-surface-500 mt-0.5">
            Status: <span className="font-medium uppercase">{plan?.status || 'draft'}</span>
            {plan?.published_at && ` · Published ${new Date(plan.published_at).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={publish} disabled={saving || !routes.length} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            Publish to tracking
          </button>
        </div>
      </div>

      <label className="block text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Execution notes (reasons for today&apos;s plan)</span>
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this mix of routes today — weather, stock, customer priority…" />
      </label>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="app-glass-card p-4">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">Available routes</h3>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {allRoutes.map((r) => (
              <label key={r.id} className="flex items-start gap-2 p-2 rounded-lg border border-surface-200 dark:border-surface-700 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-900/50">
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleRoute(r.id)} className="mt-1" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-surface-500 truncate">{[r.loading_address, r.destination_address].filter(Boolean).join(' → ')}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="app-glass-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Priority programme ({routes.length})</h3>
          {!routes.length && <p className="text-sm text-surface-500">Select routes from the left to build today&apos;s programme.</p>}
          {routes.map((r, idx) => (
            <div key={r.contractor_route_id} className="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">#{idx + 1} {r.route_name}</p>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${RISK_STYLES[r.risk_level] || RISK_STYLES.medium}`}>
                  {r.risk_level || 'medium'} risk
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  <span className="text-surface-500 block mb-0.5">Expected loads</span>
                  <input type="number" min="0" className={inputClass} value={r.expected_loads ?? ''} onChange={(e) => updateRoute(r.contractor_route_id, { expected_loads: e.target.value })} />
                </label>
                <label className="text-xs">
                  <span className="text-surface-500 block mb-0.5">Risk</span>
                  <select className={inputClass} value={r.risk_level || 'medium'} onChange={(e) => updateRoute(r.contractor_route_id, { risk_level: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <label className="text-xs block">
                <span className="text-surface-500 block mb-0.5">Plan B route</span>
                <select className={inputClass} value={r.plan_b_route_id || ''} onChange={(e) => updateRoute(r.contractor_route_id, { plan_b_route_id: e.target.value || null })}>
                  <option value="">None</option>
                  {allRoutes.filter((ar) => ar.id !== r.contractor_route_id).map((ar) => (
                    <option key={ar.id} value={ar.id}>{ar.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs block">
                <span className="text-surface-500 block mb-0.5">Execution reason</span>
                <input className={inputClass} value={r.execution_reason || ''} onChange={(e) => updateRoute(r.contractor_route_id, { execution_reason: e.target.value })} />
              </label>
              <label className="text-xs block">
                <span className="text-surface-500 block mb-0.5">Risk mitigation</span>
                <textarea className={inputClass} rows={2} value={r.risk_mitigation || ''} onChange={(e) => updateRoute(r.contractor_route_id, { risk_mitigation: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!!r.is_plan_b} onChange={(e) => updateRoute(r.contractor_route_id, { is_plan_b: e.target.checked })} />
                Mark as Plan B (contingency only)
              </label>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
