import { useState, useEffect, useCallback } from 'react';
import { contractor as contractorApi, commandCentre as ccApi } from '../api';
import InfoHint from './InfoHint.jsx';

/**
 * Table of truck counts per main contractor and sub-contractor: facility_access (integrated) vs not.
 * @param {object} props
 * @param {boolean} [props.commandCentre] — use Command Centre API + optional tenant filter from contractors list
 * @param {() => Promise<{ rows?: object[], totals?: object }>} [props.fetchSummary] — override loader (Rector, Access Management, Contractor)
 */
export default function FleetTruckApprovalSummaryPanel({ commandCentre = false, fetchSummary: fetchSummaryProp }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [contractors, setContractors] = useState([]);

  useEffect(() => {
    if (!commandCentre) return;
    ccApi.contractorsDetails()
      .then((r) => setContractors(r.contractors || []))
      .catch(() => setContractors([]));
  }, [commandCentre]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let data;
      if (fetchSummaryProp) {
        data = await fetchSummaryProp();
      } else if (commandCentre) {
        data = await ccApi.fleetTruckApprovalSummary(tenantFilter ? { tenantId: tenantFilter } : {});
      } else {
        data = await contractorApi.fleetTruckApprovalSummary({});
      }
      setRows(data.rows || []);
      setTotals(data.totals || { totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
    } catch (e) {
      setError(e?.message || 'Failed to load summary');
      setRows([]);
      setTotals({ totalTrucks: 0, integratedTrucks: 0, notIntegratedTrucks: 0 });
    } finally {
      setLoading(false);
    }
  }, [fetchSummaryProp, commandCentre, tenantFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const showTenantColumn = commandCentre;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-surface-900">Fleet facility access (trucks)</h2>
          <InfoHint
            title="Integrated vs not integrated"
            text="Integrated means facility access is approved for the truck. Not integrated counts trucks that are still on the fleet list without facility access. Totals include all trucks in each row’s scope."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {commandCentre && (
            <>
              <label className="text-sm font-medium text-surface-700">Contractor</label>
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[180px]"
                aria-label="Filter by tenant or contractor"
              >
                <option value="">All contractors</option>
                {contractors.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.tenantName || c.tenantId}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex justify-between items-center gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <section className="app-glass-panel-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-6 py-8 text-surface-500 text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-8 text-surface-500 text-center">No truck data for this view.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  {showTenantColumn && (
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Tenant</th>
                  )}
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Main contractor</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Sub-contractor</th>
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Integrated</th>
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Not integrated</th>
                  <th className="text-right font-semibold text-surface-700 px-4 py-2">Total trucks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={`${row.tenantId}-${row.contractorId}-${row.subcontractorDisplay}-${idx}`}
                    className="border-b border-surface-100 last:border-0 hover:bg-surface-50"
                  >
                    {showTenantColumn && <td className="px-4 py-2 text-surface-700">{row.tenantName || '—'}</td>}
                    <td className="px-4 py-2 text-surface-900 font-medium">{row.contractorName || '—'}</td>
                    <td className="px-4 py-2 text-surface-700">{row.subcontractorDisplay || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-800">{row.integratedTrucks}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-800">{row.notIntegratedTrucks}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-surface-900">{row.totalTrucks}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-100 border-t-2 border-surface-200 font-semibold">
                  <td
                    colSpan={showTenantColumn ? 3 : 2}
                    className="px-4 py-3 text-surface-800"
                  >
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-900">{totals.integratedTrucks}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-900">{totals.notIntegratedTrucks}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-surface-900">{totals.totalTrucks}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
