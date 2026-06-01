import { useState, useEffect, useCallback, useMemo } from 'react';
import { logisticsFinance as lfApi, downloadAttachmentWithAuth } from './api';
import InfoHint from './components/InfoHint.jsx';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', description: 'Revenue vs expense KPIs and trends' },
  { id: 'import', label: 'Import load transaction', description: 'Upload fleet performance Excel' },
  { id: 'pnl', label: 'Expense vs revenue', description: 'Edit, audit, and export transactions' },
];

function TabIcon({ name, className }) {
  const cn = className || 'w-5 h-5';
  if (name === 'upload') {
    return (
      <svg className={cn} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    );
  }
  if (name === 'table') {
    return (
      <svg className={cn} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M14 3v18M3 6h18M3 18h18" />
      </svg>
    );
  }
  return (
    <svg className={cn} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

const TAB_ICONS = { dashboard: 'chart', import: 'upload', pnl: 'table' };

function fmtZar(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DualBarChart({ rows, revenueKey = 'revenue', expenseKey = 'total_expense' }) {
  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date))), [rows]);
  const maxV = useMemo(
    () => Math.max(1, ...sorted.flatMap((r) => [Number(r[revenueKey]) || 0, Number(r[expenseKey]) || 0])),
    [sorted, revenueKey, expenseKey]
  );

  if (!sorted.length) {
    return (
      <p className="text-sm text-surface-500 dark:text-surface-400 py-8 text-center">
        Import load transactions or widen filters to see expense vs revenue trends.
      </p>
    );
  }

  return (
    <div className="h-64 flex gap-1 items-end overflow-x-auto pb-2">
      {sorted.map((r) => {
        const rev = Number(r[revenueKey]) || 0;
        const exp = Number(r[expenseKey]) || 0;
        const revPct = (rev / maxV) * 100;
        const expPct = (exp / maxV) * 100;
        return (
          <div key={r.date} className="flex flex-col items-center min-w-[2.5rem] flex-1 max-w-[4rem]" title={`${r.date}: Rev ${fmtZar(rev)} / Exp ${fmtZar(exp)}`}>
            <div className="flex gap-0.5 items-end h-48 w-full justify-center">
              <div className="w-2.5 bg-emerald-500 rounded-t" style={{ height: `${Math.max(revPct, rev > 0 ? 2 : 0)}%` }} />
              <div className="w-2.5 bg-rose-500 rounded-t" style={{ height: `${Math.max(expPct, exp > 0 ? 2 : 0)}%` }} />
            </div>
            <p className="text-[9px] text-surface-500 mt-1 truncate w-full text-center">{String(r.date).slice(5)}</p>
          </div>
        );
      })}
    </div>
  );
}

function FilterBar({ filters, onChange, hauliers, registrations }) {
  return (
    <div className="app-glass-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">From</span>
        <input type="date" value={filters.date_from || ''} onChange={(e) => onChange({ ...filters, date_from: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600" />
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">To</span>
        <input type="date" value={filters.date_to || ''} onChange={(e) => onChange({ ...filters, date_to: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600" />
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Haulier</span>
        <select value={filters.haulier || ''} onChange={(e) => onChange({ ...filters, haulier: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All hauliers</option>
          {(hauliers || []).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Registration</span>
        <select value={filters.registration || ''} onChange={(e) => onChange({ ...filters, registration: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All registrations</option>
          {(registrations || []).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button type="button" onClick={() => onChange({ date_from: '', date_to: '', haulier: '', registration: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          Clear filters
        </button>
      </div>
    </div>
  );
}

export default function LogisticsFinanceManagement() {
  const [navHidden, setNavHidden] = useSecondaryNavHidden('logistics-finance');
  const [tab, setTab] = useState('dashboard');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', haulier: '', registration: '' });
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [auditTx, setAuditTx] = useState(null);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await lfApi.dashboard(filters);
      setDashboard(d);
    } catch (e) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await lfApi.listTransactions(filters);
      setTransactions(r.transactions || []);
    } catch (e) {
      setError(e?.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'pnl') loadTransactions();
  }, [tab, loadDashboard, loadTransactions]);

  const hauliers = dashboard?.filters?.hauliers || [];
  const registrations = dashboard?.filters?.registrations || [];

  const handleImport = async () => {
    if (!importFile) {
      setError('Choose an Excel file (.xlsx) first');
      return;
    }
    setImportBusy(true);
    setError('');
    setImportResult(null);
    try {
      const r = await lfApi.importExcel(importFile);
      setImportResult(r);
      setInfo(`Imported ${r.inserted} rows${r.skipped_duplicates ? ` · ${r.skipped_duplicates} duplicate(s) skipped` : ''}`);
      setImportFile(null);
      loadDashboard();
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const openAudit = async (tx) => {
    setAuditTx(tx);
    setAuditData(null);
    setAuditLoading(true);
    try {
      const data = await lfApi.audit(tx.id);
      setAuditData(data);
    } catch (e) {
      setError(e?.message || 'Audit failed');
      setAuditTx(null);
    } finally {
      setAuditLoading(false);
    }
  };

  const startEdit = (tx) => {
    setEditingId(tx.id);
    setEditDraft({ ...tx });
  };

  const saveEdit = async () => {
    try {
      await lfApi.patch(editingId, editDraft);
      setInfo('Transaction saved');
      setEditingId(null);
      loadTransactions();
      loadDashboard();
    } catch (e) {
      setError(e?.message || 'Save failed');
    }
  };

  const deleteTx = async (id) => {
    if (!window.confirm('Delete this load transaction? This cannot be undone.')) return;
    try {
      await lfApi.delete(id);
      setInfo('Transaction deleted');
      loadTransactions();
      loadDashboard();
    } catch (e) {
      setError(e?.message || 'Delete failed');
    }
  };

  const downloadExport = async (format, view) => {
    const url = format === 'pdf' ? lfApi.exportPdfUrl({ ...filters, view }) : lfApi.exportExcelUrl({ ...filters, view });
    try {
      await downloadAttachmentWithAuth(url, `logistics-finance-${view}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (e) {
      setError(e?.message || 'Export failed');
    }
  };

  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const showFilters = tab === 'dashboard' || tab === 'pnl';

  return (
    <div className="flex gap-0 w-full min-h-0 h-full -m-4 sm:-m-6 flex-col md:flex-row">
      <nav
        className={`hidden md:flex shrink-0 flex-col app-glass-secondary-nav transition-[width] duration-200 ease-out overflow-hidden min-h-0 ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Logistics finance"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 flex items-start justify-between gap-2 w-72 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Logistics finance</h2>
              <InfoHint text="Fuel expenses match by registration and date. Accounting expenses match haulier/vendor on the same date. Use Audit on a row for full detail." />
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-snug">
              Load revenue, expenses, and margin
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
            aria-label="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72 min-h-0">
          <ul className="space-y-0.5">
            {TABS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    tab === t.id
                      ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium dark:bg-brand-950/50 dark:text-brand-200'
                      : 'text-surface-600 hover:bg-surface-50 border-l-2 border-l-transparent dark:text-surface-300 dark:hover:bg-surface-900/50'
                  }`}
                >
                  <TabIcon name={TAB_ICONS[t.id]} className="w-5 h-5 shrink-0 mt-0.5 opacity-90" />
                  <span className="min-w-0">
                    <span className="block break-words">{t.label}</span>
                    <span className="block text-[11px] font-normal opacity-70 mt-0.5">{t.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {navHidden && (
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="hidden md:flex shrink-0 self-start items-center gap-2 mx-4 mt-4 sm:mx-6 sm:mt-6 px-3 py-2 rounded-lg border border-surface-200 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-200 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Show navigation
          </button>
        )}

        <div className="md:hidden shrink-0 flex items-center gap-2 px-4 pt-4 sm:px-6">
          <label className="text-xs text-surface-500 shrink-0">Section</label>
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            className="flex-1 rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600"
          >
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <header className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 border-b border-surface-200/60 dark:border-surface-800/80">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">{activeTabMeta.label}</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">{activeTabMeta.description}</p>
        </header>

        <div className="shrink-0 px-4 sm:px-6 space-y-3 pt-3">
          {error && <div className="text-sm text-red-700 bg-red-50 dark:bg-red-950/40 rounded-lg px-4 py-2">{error}</div>}
          {info && <div className="text-sm text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-4 py-2">{info}</div>}
          {showFilters && (
            <FilterBar filters={filters} onChange={setFilters} hauliers={hauliers} registrations={registrations} />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 sm:px-6 sm:pb-6">
      {tab === 'dashboard' && (
        <div className="space-y-6 h-full">
          {loading && <p className="text-sm text-surface-500">Loading…</p>}
          {dashboard?.kpis && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: 'Total revenue', value: fmtZar(dashboard.kpis.total_revenue), cls: 'border-emerald-200 dark:border-emerald-800' },
                { label: 'Fuel expense', value: fmtZar(dashboard.kpis.total_fuel_expense), cls: 'border-rose-200 dark:border-rose-800' },
                { label: 'Accounting expense', value: fmtZar(dashboard.kpis.total_accounting_expense), cls: 'border-amber-200 dark:border-amber-800' },
                { label: 'Net margin', value: fmtZar(dashboard.kpis.net_margin), cls: 'border-brand-200 dark:border-brand-800' },
                { label: 'Load rows', value: dashboard.kpis.transaction_count, cls: 'border-surface-200' },
              ].map((k) => (
                <div key={k.label} className={`app-glass-card p-4 border ${k.cls}`}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">{k.label}</p>
                  <p className="text-xl font-bold mt-1 tabular-nums">{k.value}</p>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2 min-h-[min(24rem,50vh)]">
            <div className="app-glass-card p-5 flex flex-col min-h-[280px]">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50 mb-1">Revenue vs expense by day</h3>
              <p className="text-xs text-surface-500 mb-4">
                <span className="inline-block w-3 h-3 bg-emerald-500 rounded mr-1 align-middle" /> Revenue
                <span className="inline-block w-3 h-3 bg-rose-500 rounded ml-3 mr-1 align-middle" /> Expense
              </p>
              <div className="flex-1 min-h-[200px]">
                <DualBarChart rows={dashboard?.by_day} />
              </div>
            </div>
            <div className="app-glass-card p-5 flex flex-col min-h-[280px]">
              <h3 className="text-sm font-semibold mb-3">Top hauliers — revenue vs expense</h3>
              <div className="overflow-x-auto flex-1 min-h-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-surface-500 border-b border-surface-200 dark:border-surface-700">
                      <th className="py-2 pr-2">Haulier</th>
                      <th className="py-2 pr-2 text-right">Revenue</th>
                      <th className="py-2 pr-2 text-right">Expense</th>
                      <th className="py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard?.by_haulier || []).slice(0, 12).map((h) => (
                      <tr key={h.haulier} className="border-b border-surface-100 dark:border-surface-800">
                        <td className="py-2 pr-2 font-medium">{h.haulier}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{fmtZar(h.revenue)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-rose-600">{fmtZar(h.expense)}</td>
                        <td className={`py-2 text-right tabular-nums font-medium ${h.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtZar(h.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadDashboard} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600">
              Refresh
            </button>
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-4 max-w-2xl">
          <div className="app-glass-card p-5 space-y-4">
            <h3 className="font-semibold text-surface-900 dark:text-surface-50">Import load transaction</h3>
            <p className="text-sm text-surface-600 dark:text-surface-400">
              Upload the fleet performance Excel export as-is. All 15 columns are read, including{' '}
              <strong>Turnover Points</strong>, <strong>Target Points</strong>, and <strong>Variance Points</strong>.
              Registrations are matched to contractor trucks where possible.
            </p>
            <p className="text-xs font-medium text-surface-500 uppercase">Expected columns</p>
            <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
              Date · Vehicle Id · Vehicle Desc · Vehicle Registration · Haulier · Completed · Cancelled · Avg Hours ·
              Tons · Turnover · Target · Variance · Turnover Points · Target Points · Variance Points
            </p>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              disabled={importBusy || !importFile}
              onClick={handleImport}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {importBusy ? 'Importing…' : 'Import spreadsheet'}
            </button>
          </div>
          {importResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm">
              <strong>{importResult.inserted}</strong> rows imported
              {importResult.skipped_duplicates > 0 ? ` · ${importResult.skipped_duplicates} duplicates skipped` : ''}
              {importResult.parse_errors?.length > 0 && (
                <ul className="mt-2 text-xs list-disc list-inside text-amber-800">
                  {importResult.parse_errors.slice(0, 6).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'pnl' && (
        <div className="flex flex-col gap-4 min-h-full">
          <div className="flex flex-wrap gap-2 items-center justify-between shrink-0">
            <p className="text-sm text-surface-600 dark:text-surface-400">
              Edit turnover, points, and comments. Expenses are calculated from Fuel Data and Accounting (same date / haulier).
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadExport('excel', 'pnl')} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600">
                Excel (PnL)
              </button>
              <button type="button" onClick={() => downloadExport('pdf', 'pnl')} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600">
                PDF (PnL)
              </button>
              <button type="button" onClick={() => downloadExport('excel', 'load')} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600">
                Excel (loads)
              </button>
              <button type="button" onClick={loadTransactions} className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
                Refresh
              </button>
            </div>
          </div>
          {loading && <p className="text-sm text-surface-500 shrink-0">Loading…</p>}
          <div className="app-glass-card flex-1 min-h-[min(24rem,60vh)] flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-xs sm:text-sm min-w-[1200px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-surface-500 border-b border-surface-200 dark:border-surface-700 bg-surface-50/80 dark:bg-surface-900/50">
                  <th className="p-2">Date</th>
                  <th className="p-2">Reg</th>
                  <th className="p-2">Haulier</th>
                  <th className="p-2 text-right">Turnover</th>
                  <th className="p-2 text-right">T. Pts</th>
                  <th className="p-2 text-right">Var Pts</th>
                  <th className="p-2 text-right">Fuel exp.</th>
                  <th className="p-2 text-right">Acct exp.</th>
                  <th className="p-2 text-right">Net</th>
                  <th className="p-2">Comment</th>
                  <th className="p-2 w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isEdit = editingId === tx.id;
                  const row = isEdit ? editDraft : tx;
                  return (
                    <tr key={tx.id} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50/50 dark:hover:bg-surface-900/30">
                      <td className="p-2 whitespace-nowrap">{fmtDate(row.transaction_date)}</td>
                      <td className="p-2">
                        {isEdit ? (
                          <input value={row.vehicle_registration || ''} onChange={(e) => setEditDraft((d) => ({ ...d, vehicle_registration: e.target.value }))} className="w-24 rounded border px-1 py-0.5 text-xs dark:bg-surface-900" />
                        ) : (
                          row.vehicle_registration || '—'
                        )}
                      </td>
                      <td className="p-2">
                        {isEdit ? (
                          <input value={row.haulier || ''} onChange={(e) => setEditDraft((d) => ({ ...d, haulier: e.target.value }))} className="w-28 rounded border px-1 py-0.5 text-xs dark:bg-surface-900" />
                        ) : (
                          row.haulier || '—'
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {isEdit ? (
                          <input type="number" step="0.01" value={row.turnover ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, turnover: e.target.value }))} className="w-20 rounded border px-1 py-0.5 text-xs text-right dark:bg-surface-900" />
                        ) : (
                          fmtZar(row.turnover)
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">{row.turnover_points != null ? Number(row.turnover_points).toFixed(2) : '—'}</td>
                      <td className="p-2 text-right tabular-nums">{row.variance_points != null ? Number(row.variance_points).toFixed(2) : '—'}</td>
                      <td className="p-2 text-right tabular-nums text-rose-600">{fmtZar(row.fuel_expense)}</td>
                      <td className="p-2 text-right tabular-nums text-amber-700">{fmtZar(row.accounting_expense)}</td>
                      <td className={`p-2 text-right tabular-nums font-medium ${(row.net_margin ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtZar(row.net_margin)}</td>
                      <td className="p-2 max-w-[140px]">
                        {isEdit ? (
                          <input value={row.comment || ''} onChange={(e) => setEditDraft((d) => ({ ...d, comment: e.target.value }))} className="w-full rounded border px-1 py-0.5 text-xs dark:bg-surface-900" />
                        ) : (
                          <span className="truncate block" title={row.comment || ''}>{row.comment || '—'}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {isEdit ? (
                            <>
                              <button type="button" onClick={saveEdit} className="text-xs text-brand-600 font-medium">Save</button>
                              <button type="button" onClick={() => setEditingId(null)} className="text-xs text-surface-500">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => startEdit(tx)} className="text-xs text-brand-600 font-medium">Edit</button>
                              <button type="button" onClick={() => openAudit(tx)} className="text-xs text-indigo-600 font-medium">Audit</button>
                              <button type="button" onClick={() => deleteTx(tx.id)} className="text-xs text-red-600 font-medium">Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && !transactions.length && (
              <p className="p-8 text-center text-sm text-surface-500">No transactions — import a load spreadsheet first.</p>
            )}
            </div>
          </div>
        </div>
      )}
        </div>
      </div>

      {auditTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAuditTx(null)}>
          <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold">Transaction audit</h3>
                <p className="text-sm text-surface-600 dark:text-surface-400">
                  {fmtDate(auditTx.transaction_date)} · {auditTx.vehicle_registration} · {auditTx.haulier}
                </p>
              </div>
              <button type="button" onClick={() => setAuditTx(null)} className="text-surface-500 hover:text-surface-800 text-xl leading-none">
                ×
              </button>
            </div>
            {auditLoading && <p className="text-sm">Loading linked expenses…</p>}
            {auditData?.summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3">
                  <p className="text-xs text-surface-500">Revenue</p>
                  <p className="font-bold tabular-nums">{fmtZar(auditData.summary.revenue)}</p>
                </div>
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 p-3">
                  <p className="text-xs text-surface-500">Fuel (matched reg.)</p>
                  <p className="font-bold tabular-nums">{fmtZar(auditData.summary.fuel_expense)}</p>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="text-xs text-surface-500">Accounting (haulier)</p>
                  <p className="font-bold tabular-nums">{fmtZar(auditData.summary.accounting_expense_linked)}</p>
                </div>
                <div className="rounded-lg bg-brand-50 dark:bg-brand-950/30 p-3">
                  <p className="text-xs text-surface-500">Net margin</p>
                  <p className="font-bold tabular-nums">{fmtZar(auditData.summary.net_margin)}</p>
                </div>
              </div>
            )}
            {auditData?.fuel_expenses?.length > 0 && (
              <section className="mb-6">
                <h4 className="text-sm font-semibold mb-2">Fuel expenses — same date & registration</h4>
                <ul className="text-sm space-y-1 border rounded-lg divide-y dark:border-surface-700">
                  {auditData.fuel_expenses.map((f) => (
                    <li key={f.id} className="px-3 py-2 flex justify-between gap-2">
                      <span>{f.registration_number} · {f.litres != null ? `${f.litres} L` : ''}</span>
                      <span className="tabular-nums font-medium">{fmtZar(f.amount_rand)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {auditData?.accounting_expenses?.length > 0 && (
              <section>
                <h4 className="text-sm font-semibold mb-2">Accounting expenses on {fmtDate(auditTx.transaction_date)}</h4>
                <ul className="text-sm space-y-1 border rounded-lg divide-y dark:border-surface-700 max-h-48 overflow-y-auto">
                  {auditData.accounting_expenses.map((a) => (
                    <li
                      key={a.id}
                      className={`px-3 py-2 flex justify-between gap-2 ${a.linked_to_haulier ? 'bg-indigo-50/80 dark:bg-indigo-950/20' : 'opacity-70'}`}
                    >
                      <span>
                        {a.vendor_supplier || a.description || '—'}
                        {a.linked_to_haulier ? <span className="ml-1 text-[10px] text-indigo-600 font-medium">linked</span> : null}
                      </span>
                      <span className="tabular-nums font-medium">
                        {fmtZar((Number(a.amount) || 0) + (Number(a.tax_amount) || 0))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!auditLoading && !auditData?.fuel_expenses?.length && !auditData?.accounting_expenses?.length && (
              <p className="text-sm text-surface-500">No linked fuel or accounting expenses found for this date.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
