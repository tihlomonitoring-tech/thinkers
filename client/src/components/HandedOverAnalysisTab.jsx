import { useState, useEffect, useMemo } from 'react';
import { commandCentre as ccApi } from '../api.js';
import { CollapsibleSectionHelp } from './CollapsibleSectionHelp.jsx';

export default function HandedOverAnalysisTab({ onContinueSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refFilter, setRefFilter] = useState('');
  const [handedOverHelpOpen, setHandedOverHelpOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    ccApi.truckAnalysis
      .listSessions()
      .then((r) => setSessions(r.sessions || []))
      .catch((e) => setError(e?.message || 'Could not load sessions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = refFilter.trim().toUpperCase();
    if (!q) return sessions;
    return sessions.filter((s) => String(s.reference_code || '').toUpperCase().includes(q));
  }, [sessions, refFilter]);

  return (
    <div className="space-y-6 max-w-4xl">
      <CollapsibleSectionHelp
        title="Handed over analysis"
        titleClassName="text-xl font-bold text-surface-900 tracking-tight"
        open={handedOverHelpOpen}
        setOpen={setHandedOverHelpOpen}
        topic="handed over analysis"
      >
        <p className="max-w-2xl">
          Pick a session by <strong className="text-surface-800 dark:text-surface-100">reference</strong> to continue truck update work
          another controller left off. Opening a session refreshes the 12-hour timer on the server. If nobody opens it for 12 hours,
          detailed paste data is removed—you will need to start a new analysis.
        </p>
      </CollapsibleSectionHelp>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-surface-500 mb-1">Filter by reference</label>
          <input
            type="text"
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            placeholder="e.g. TA7K2M3"
            className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm font-mono uppercase"
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800"
        >
          Refresh list
        </button>
      </div>

      {loading && <p className="text-sm text-surface-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-surface-600 rounded-xl border border-dashed border-surface-200 bg-surface-50 px-4 py-3">
          No matching sessions. After a controller uses <strong>Handover analysis</strong> on Truck update records, the reference
          appears here.
        </p>
      )}

      <ul className="space-y-3">
        {filtered.map((s) => {
          const sum = s.summary || {};
          const tt = sum.truckTotals || sum;
          const pruned = String(s.status || '').toLowerCase() === 'pruned';
          return (
            <li
              key={s.id}
              className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-mono font-semibold text-brand-800 dark:text-brand-300 text-lg">{s.reference_code}</p>
                <p className="text-xs text-surface-500 mt-1">
                  Status: <span className="font-medium text-surface-700">{s.status}</span>
                  {s.handed_over_at && ` · Handed over ${new Date(s.handed_over_at).toLocaleString()}`}
                </p>
                {(tt.trucksCompletedDelivery != null || tt.trucksNotDone != null) && (
                  <p className="text-sm text-surface-700 mt-2">
                    Completed: {tt.trucksCompletedDelivery ?? '—'} · Not done: {tt.trucksNotDone ?? '—'}
                  </p>
                )}
                {sum.routeName && <p className="text-sm text-surface-600 mt-1">Route: {sum.routeName}</p>}
                {pruned && (
                  <p className="text-xs text-amber-800 dark:text-amber-200 mt-2">Workspace data was removed after 12h idle—record kept for reference only.</p>
                )}
              </div>
              <button
                type="button"
                disabled={pruned}
                onClick={() => onContinueSession?.(s.id)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 shrink-0"
              >
                Continue this analysis
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
