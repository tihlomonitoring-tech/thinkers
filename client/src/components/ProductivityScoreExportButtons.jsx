import { useState } from 'react';
import {
  downloadProductivityScoreExcel,
  downloadProductivityScorePdf,
} from '../lib/productivityScoreExport.js';

export default function ProductivityScoreExportButtons({
  data,
  selectedPerson = null,
  disabled = false,
  onError,
  compact = false,
}) {
  const [exporting, setExporting] = useState(null);

  const canExport = !!data?.people?.length && !disabled;

  const runExport = async (kind) => {
    if (!canExport || exporting) return;
    setExporting(kind);
    try {
      const options = selectedPerson ? { selectedPerson } : {};
      if (kind === 'pdf') {
        downloadProductivityScorePdf(data, options);
      } else {
        await downloadProductivityScoreExcel(data, options);
      }
    } catch (e) {
      onError?.(e?.message || `Could not generate ${kind === 'pdf' ? 'PDF' : 'Excel'} export`);
    } finally {
      setExporting(null);
    }
  };

  const btnClass = compact
    ? 'inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-900'
    : 'inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm font-medium text-surface-700 shadow-sm hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-900';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : ''}`}>
      <button
        type="button"
        disabled={!canExport || !!exporting}
        onClick={() => runExport('pdf')}
        className={btnClass}
        title={selectedPerson ? `Download PDF for ${selectedPerson.full_name}` : 'Download full team PDF report'}
      >
        <svg className="w-4 h-4 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {exporting === 'pdf' ? 'Generating PDF…' : selectedPerson ? 'PDF (employee)' : 'Download PDF'}
      </button>
      <button
        type="button"
        disabled={!canExport || !!exporting}
        onClick={() => runExport('excel')}
        className={btnClass}
        title={selectedPerson ? `Download Excel for ${selectedPerson.full_name}` : 'Download full team Excel workbook'}
      >
        <svg className="w-4 h-4 text-emerald-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {exporting === 'excel' ? 'Generating Excel…' : selectedPerson ? 'Excel (employee)' : 'Download Excel'}
      </button>
    </div>
  );
}
