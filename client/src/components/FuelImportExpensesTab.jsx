import { useState } from 'react';
import { fuelVehicleExpenses as fveApi } from '../api';
import InfoHint from './InfoHint.jsx';

export default function FuelImportExpensesTab({ onError, onInfo, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!file) {
      onError?.('Choose an Excel file (.xlsx) first');
      return;
    }
    setBusy(true);
    onError?.('');
    setResult(null);
    try {
      const r = await fveApi.importExcel(file);
      setResult(r);
      const dupMsg =
        r.skipped_duplicates > 0 ? ` · ${r.skipped_duplicates} duplicate(s) skipped` : '';
      onInfo?.(`Imported ${r.inserted} rows (${r.matched} matched to contractor trucks)${dupMsg}`);
      onImported?.();
      setFile(null);
    } catch (e) {
      onError?.(e?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Import fuel expenses</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
            Upload a fleet fuel Excel export. The system reads registration, date (driver capture datetime), litres,
            odometer readings, rand value, source type, input source, and price per litre — then matches registration to
            trucks on the Contractor page for your tenant. Duplicate transactions (same registration, date/time, litres, and amount) are skipped.
          </p>
        </div>
        <InfoHint text="Imported rows appear under Fuel expenditure. Re-uploading the same file will not create duplicates. Unmatched registrations can be linked manually after import." />
      </div>

      <div className="app-glass-card p-5 space-y-4 max-w-xl">
        <p className="text-xs font-medium text-surface-500 uppercase">Expected columns (flexible names)</p>
        <ul className="text-sm text-surface-700 dark:text-surface-300 list-disc list-inside space-y-0.5">
          <li>registration_number</li>
          <li>driver_capture_datetime</li>
          <li>litres, start_odometer, end_odometer</li>
          <li>rand value, rand value per litre</li>
          <li>source type name, input source</li>
        </ul>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Excel file (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !file}
          onClick={handleImport}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import into fuel expenditure'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100">
          <p>
            <strong>{result.inserted}</strong> transactions imported · <strong>{result.matched}</strong> matched to
            system trucks · <strong>{result.unmatched}</strong> unmatched
            {result.skipped_duplicates > 0 ? (
              <>
                {' '}
                · <strong>{result.skipped_duplicates}</strong> duplicate(s) skipped
              </>
            ) : null}
          </p>
          {result.duplicate_errors?.length > 0 && (
            <ul className="mt-2 text-xs text-surface-600 dark:text-surface-400 list-disc list-inside">
              {result.duplicate_errors.slice(0, 8).map((e, i) => (
                <li key={`dup-${i}`}>{e}</li>
              ))}
            </ul>
          )}
          {result.parse_errors?.length > 0 && (
            <ul className="mt-2 text-xs text-amber-800 dark:text-amber-200 list-disc list-inside">
              {result.parse_errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
