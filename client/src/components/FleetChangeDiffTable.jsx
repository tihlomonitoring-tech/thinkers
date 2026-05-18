import { computeTruckChangeRows } from '../lib/fleetChangeDiff.js';

/**
 * Side-by-side table of field changes (current vs requested).
 */
export default function FleetChangeDiffTable({ previous, proposed, emptyMessage = 'No field changes — comment only.' }) {
  const rows = computeTruckChangeRows(previous, proposed);
  if (rows.length === 0) {
    return <p className="text-sm text-surface-600">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-50 border-b border-surface-200">
            <th className="text-left px-3 py-2 font-semibold text-surface-700">Field</th>
            <th className="text-left px-3 py-2 font-semibold text-surface-700">Current (on system)</th>
            <th className="text-left px-3 py-2 font-semibold text-red-800">Requested change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-surface-100 last:border-0">
              <td className="px-3 py-2 font-medium text-surface-800 whitespace-nowrap">{row.label}</td>
              <td className="px-3 py-2 text-surface-600">{row.before}</td>
              <td className="px-3 py-2 text-red-900 font-medium bg-red-50/60">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
