import { useState, useEffect, useCallback } from 'react';
import { logisticsFinance as lfApi, downloadAttachmentWithAuth } from './api';
import InfoHint from './components/InfoHint.jsx';
import DeliveryActivityLedgerPanel from './components/logistics/DeliveryActivityLedgerPanel.jsx';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', description: 'Ledger KPIs — deliveries, revenue, diesel & margin' },
  { id: 'ledger', label: 'Delivery Activity Ledger', description: 'Diesel, expenses, CC deliveries & trial balance' },
  { id: 'import', label: 'Import load transaction', description: 'Upload fleet performance Excel (legacy)' },
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
  if (name === 'ledger') {
    return (
      <svg className={cn} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    );
  }
  return (
    <svg className={cn} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

const TAB_ICONS = { dashboard: 'chart', ledger: 'ledger', import: 'upload' };

function fmtZar(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DualBarChart({ rows }) {
  const sorted = [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const maxV = Math.max(1, ...sorted.flatMap((r) => [Number(r.revenue) || 0, Number(r.total_expense) || 0]));

  if (!sorted.length) {
    return (
      <p className="text-sm text-surface-500 dark:text-surface-400 py-8 text-center">
        Capture deliveries and diesel in the Delivery Activity Ledger to see trends.
      </p>
    );
  }

  return (
    <div className="h-64 flex gap-1 items-end overflow-x-auto pb-2">
      {sorted.map((r) => {
        const rev = Number(r.revenue) || 0;
        const exp = Number(r.total_expense) || 0;
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

function FilterBar({ filters, onChange, routes, trucks }) {
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
        <span className="text-xs font-medium text-surface-500 block mb-1">Route</span>
        <select value={filters.route_id || ''} onChange={(e) => onChange({ ...filters, route_id: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All routes</option>
          {(routes || []).map((r) => (
            <option key={r.id || r.name} value={r.id || ''}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs font-medium text-surface-500 block mb-1">Truck</span>
        <select value={filters.truck_id || ''} onChange={(e) => onChange({ ...filters, truck_id: e.target.value })} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
          <option value="">All trucks</option>
          {(trucks || []).map((r) => (
            <option key={r.id} value={r.id}>{r.registration}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button type="button" onClick={() => onChange({ date_from: '', date_to: '', route_id: '', truck_id: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          Clear filters
        </button>
      </div>
    </div>
  );
}

export default function LogisticsFinanceManagement() {
  const [navHidden, setNavHidden] = useSecondaryNavHidden('logistics-finance');
  const [tab, setTab] = useState('dashboard');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', route_id: '', truck_id: '' });
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);

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

  useEffect(() => {
    if (tab === 'dashboard' || tab === 'ledger') loadDashboard();
  }, [tab, loadDashboard, ledgerRefresh]);

  const routes = dashboard?.filters?.routes || [];
  const trucks = dashboard?.filters?.trucks || [];

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
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const showFilters = tab === 'dashboard';

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
              <InfoHint text="Dashboard and trial balance are driven by the Delivery Activity Ledger — diesel captures, truck expenses, and Command Centre completed deliveries." />
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 leading-snug">
              Activity ledger accounting
            </p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800" aria-label="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
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
          <button type="button" onClick={() => setNavHidden(false)} className="hidden md:flex shrink-0 self-start items-center gap-2 mx-4 mt-4 sm:mx-6 sm:mt-6 px-3 py-2 rounded-lg border border-surface-200 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-200 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}

        <div className="md:hidden shrink-0 flex items-center gap-2 px-4 pt-4 sm:px-6">
          <label className="text-xs text-surface-500 shrink-0">Section</label>
          <select value={tab} onChange={(e) => setTab(e.target.value)} className="flex-1 rounded-lg border border-surface-300 px-2 py-1.5 text-sm dark:bg-surface-900 dark:border-surface-600">
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
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
            <FilterBar filters={filters} onChange={setFilters} routes={routes} trucks={trucks} />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 sm:px-6 sm:pb-6 pt-4">
          {tab === 'dashboard' && (
            <div className="space-y-6">
              {loading && <p className="text-sm text-surface-500">Loading…</p>}
              {dashboard?.kpis && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                  {[
                    { label: 'Completed deliveries', value: dashboard.kpis.completed_deliveries, cls: 'border-brand-200' },
                    { label: 'Revenue', value: fmtZar(dashboard.kpis.total_revenue), cls: 'border-emerald-200' },
                    { label: 'Diesel litres', value: dashboard.kpis.diesel_litres?.toLocaleString?.('en-ZA') ?? dashboard.kpis.diesel_litres, cls: 'border-amber-200' },
                    { label: 'Diesel expense', value: fmtZar(dashboard.kpis.diesel_expense), cls: 'border-rose-200' },
                    { label: 'Truck expenses', value: fmtZar(dashboard.kpis.truck_expense), cls: 'border-orange-200' },
                    { label: 'Net margin', value: fmtZar(dashboard.kpis.net_margin), cls: 'border-brand-200' },
                    { label: 'Total expense', value: fmtZar(dashboard.kpis.total_expense), cls: 'border-surface-200' },
                  ].map((k) => (
                    <div key={k.label} className={`app-glass-card p-4 border ${k.cls}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{k.label}</p>
                      <p className="text-lg font-bold mt-1 tabular-nums">{k.value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="app-glass-card p-5 flex flex-col min-h-[280px]">
                  <h3 className="text-sm font-semibold mb-1">Revenue vs expense by day</h3>
                  <p className="text-xs text-surface-500 mb-4">
                    <span className="inline-block w-3 h-3 bg-emerald-500 rounded mr-1 align-middle" /> Revenue
                    <span className="inline-block w-3 h-3 bg-rose-500 rounded ml-3 mr-1 align-middle" /> Diesel + truck costs
                  </p>
                  <DualBarChart rows={dashboard?.by_day} />
                </div>
                <div className="app-glass-card p-5 flex flex-col min-h-[280px]">
                  <h3 className="text-sm font-semibold mb-3">Trial balance by route</h3>
                  <div className="overflow-x-auto flex-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-surface-500 border-b">
                          <th className="py-2 pr-2">Route</th>
                          <th className="py-2 pr-2 text-right">Loads</th>
                          <th className="py-2 pr-2 text-right">Revenue</th>
                          <th className="py-2 pr-2 text-right">Diesel</th>
                          <th className="py-2 text-right">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard?.by_route || []).slice(0, 10).map((r) => (
                          <tr key={r.key} className="border-b border-surface-100">
                            <td className="py-2 pr-2 font-medium">{r.route_name || r.label}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{r.completed_deliveries}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{fmtZar(r.revenue)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums text-rose-600">{fmtZar(r.diesel_cost)}</td>
                            <td className={`py-2 text-right tabular-nums font-medium ${(r.net_margin ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtZar(r.net_margin)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="app-glass-card p-5">
                <h3 className="text-sm font-semibold mb-3">By truck — diesel vs deliveries</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-surface-500 border-b">
                        <th className="py-2 pr-2">Truck</th>
                        <th className="py-2 pr-2 text-right">Deliveries</th>
                        <th className="py-2 pr-2 text-right">Diesel L</th>
                        <th className="py-2 pr-2 text-right">L / load</th>
                        <th className="py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboard?.by_truck || []).slice(0, 10).map((r) => (
                        <tr key={r.key} className="border-b border-surface-100">
                          <td className="py-2 pr-2 font-medium">{r.truck_registration || r.label}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{r.completed_deliveries}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{r.diesel_litres?.toFixed?.(1) ?? '—'}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{r.litres_per_delivery ?? '—'}</td>
                          <td className={`py-2 text-right tabular-nums font-medium ${(r.net_margin ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtZar(r.net_margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button type="button" onClick={loadDashboard} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 hover:bg-surface-50">Refresh</button>
            </div>
          )}

          {tab === 'ledger' && (
            <DeliveryActivityLedgerPanel
              filters={filters}
              onFiltersChange={setFilters}
              routes={routes}
              trucks={trucks}
              onError={setError}
              onSuccess={setInfo}
              onDataChange={() => setLedgerRefresh((n) => n + 1)}
            />
          )}

          {tab === 'import' && (
            <div className="space-y-4 max-w-2xl">
              <div className="app-glass-card p-5 space-y-4">
                <h3 className="font-semibold">Import load transaction (legacy)</h3>
                <p className="text-sm text-surface-600">Excel fleet performance import. Primary revenue source is now Command Centre deliveries in the Delivery Activity Ledger.</p>
                <input type="file" accept=".xlsx" className="text-sm" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                <button type="button" disabled={importBusy || !importFile} onClick={handleImport} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                  {importBusy ? 'Importing…' : 'Import spreadsheet'}
                </button>
              </div>
              {importResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                  <strong>{importResult.inserted}</strong> rows imported
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
