import { useState, useEffect, useMemo } from 'react';
import InfoHint from './InfoHint.jsx';

const DECK_ROTATE_MS = 45_000;

function kpiShell(navigable, onClick, children, borderClass) {
  const base =
    'text-left rounded-xl border p-5 shadow-sm transition-all duration-200 ' +
    (navigable
      ? 'bg-white dark:bg-slate-900/80 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer group'
      : 'bg-slate-50/80 dark:bg-slate-900/50 border-dashed cursor-default opacity-90');
  if (navigable && onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${borderClass} w-full`}>
        {children}
      </button>
    );
  }
  return <div className={`${base} ${borderClass}`}>{children}</div>;
}

/** Vertical bar strip chart — liters or ZAR by calendar month */
function MonthlyStripChart({ rows, valueKey, label, gradientClass, formatVal }) {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => String(a.month).localeCompare(String(b.month))), [rows]);
  const maxV = useMemo(() => Math.max(1, ...sorted.map((r) => Number(r[valueKey]) || 0)), [sorted, valueKey]);

  const selectedRow = useMemo(
    () => (selectedMonth ? sorted.find((x) => String(x.month) === String(selectedMonth)) : null),
    [sorted, selectedMonth]
  );

  if (!sorted.length) {
    return (
      <div className="flex items-center justify-center min-h-[14rem] text-sm text-slate-500 dark:text-slate-400">
        No dated transactions yet — record deliveries with a delivery time to see this trend.
      </div>
    );
  }

  const fmt = formatVal || ((v) => `${Number(v).toFixed(1)} L`);

  return (
    <div className="px-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{label}</p>
      <div
        className={`mb-2 min-h-[2.75rem] rounded-lg border px-3 py-2 transition-colors ${
          selectedRow
            ? 'border-indigo-300/80 bg-indigo-50/90 dark:border-indigo-700/60 dark:bg-indigo-950/40'
            : 'border-transparent bg-slate-50/50 dark:bg-slate-800/30'
        }`}
      >
        {selectedRow ? (
          <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
            <span className="text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wide mr-2">
              {String(selectedRow.month).replace(/^(\d{4})-(\d{2})$/, '$2 / $1')}
            </span>
            {fmt(Number(selectedRow[valueKey]) || 0, selectedRow)}
            {selectedRow.transaction_count != null ? (
              <span className="text-slate-600 dark:text-slate-300 font-medium text-xs ml-2">
                · {Number(selectedRow.transaction_count)} tx
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">Click a bar to show the figure for that month.</p>
        )}
      </div>
      <div className="h-56 flex gap-1.5 sm:gap-2 items-stretch">
        {sorted.map((r) => {
          const v = Number(r[valueKey]) || 0;
          const pct = (v / maxV) * 100;
          const isSel = String(selectedMonth) === String(r.month);
          return (
            <button
              key={r.month}
              type="button"
              title={`${r.month}: ${fmt(v, r)}`}
              onClick={() => setSelectedMonth((m) => (String(m) === String(r.month) ? null : r.month))}
              className={`flex-1 min-w-0 flex flex-col min-h-0 rounded-t-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                isSel ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900' : ''
              }`}
            >
              <div className="flex-1 min-h-0 flex flex-col justify-end">
                <div
                  className={`w-full max-w-[3rem] mx-auto rounded-t-lg ${gradientClass} shadow-sm transition-[height,filter] duration-500 ease-out ${
                    isSel ? 'brightness-110 saturate-125' : 'hover:brightness-105'
                  }`}
                  style={{ height: `${Math.max(pct, v > 0 ? 2 : 0)}%` }}
                />
              </div>
              <p className="text-[9px] sm:text-[10px] text-center text-slate-500 dark:text-slate-400 truncate mt-1.5 leading-tight pointer-events-none">
                {String(r.month).replace(/^(\d{4})-(\d{2})$/, '$2/$1')}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Large horizontal bars — supplier share */
function SupplierFocusChart({ bySupplier, valueKey, label, formatVal, barClass }) {
  const [selectedName, setSelectedName] = useState(null);
  const list = useMemo(() => [...(bySupplier || [])].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)), [bySupplier, valueKey]);
  const maxV = useMemo(() => Math.max(1, ...list.map((r) => Number(r[valueKey]) || 0)), [list, valueKey]);

  if (!list.length) {
    return (
      <div className="flex items-center justify-center min-h-[14rem] text-sm text-slate-500 dark:text-slate-400">
        No verified supplier data yet.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[min(24rem,55vh)] overflow-y-auto pr-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      {list.map((r) => {
        const v = Number(r[valueKey]) || 0;
        const pct = (v / maxV) * 100;
        const isSel = selectedName === r.supplier_name;
        return (
          <div key={r.supplier_name} className={isSel ? 'rounded-lg p-2 -mx-2 bg-indigo-50/80 dark:bg-indigo-950/35 ring-1 ring-indigo-200/80 dark:ring-indigo-800/60' : ''}>
            <div className="flex justify-between text-xs sm:text-sm mb-1 gap-2 min-w-0">
              <span className={`font-semibold truncate ${isSel ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-800 dark:text-slate-100'}`}>
                {r.supplier_name}
              </span>
              <span
                className={`shrink-0 tabular-nums text-right transition-all ${isSel ? 'text-base font-bold text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'}`}
              >
                <span className="block sm:inline">{formatVal(v)}</span>
                {isSel && r.transaction_count != null ? (
                  <span className="block sm:inline text-[11px] font-semibold text-slate-600 dark:text-slate-400 sm:ml-1.5">
                    {Number(r.transaction_count)} tx
                  </span>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              title={formatVal(v)}
              aria-pressed={isSel}
              onClick={() => setSelectedName((n) => (n === r.supplier_name ? null : r.supplier_name))}
              className="block w-full text-left rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <div
                className={`h-3 rounded-full bg-slate-200/90 dark:bg-slate-700/90 overflow-hidden ring-1 transition-shadow ${
                  isSel ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-slate-900' : 'ring-slate-200/50 dark:ring-slate-600/40'
                }`}
              >
                <div
                  className={`h-full rounded-full ${barClass} transition-[width,filter] duration-700 ease-out ${isSel ? 'brightness-110' : 'hover:brightness-105'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Command Centre–style layout: KPI cards, rotating “fuel deck” charts, quick actions.
 */
export default function FuelAdvancedDashboard({ analytics, suppliers, loading, setActiveTab, allowedTabs }) {
  const [activeDeck, setActiveDeck] = useState('monthly');
  const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());
  const [nowTick, setNowTick] = useState(() => Date.now());

  const bySupplier = analytics?.by_supplier || [];
  const byMonth = analytics?.by_month || [];

  const totals = useMemo(() => {
    let liters = 0;
    let rand = 0;
    let txs = 0;
    bySupplier.forEach((r) => {
      liters += Number(r.total_liters) || 0;
      rand += Number(r.total_rand) || 0;
      txs += Number(r.transaction_count) || 0;
    });
    return { liters, rand, txs, supplierRows: bySupplier.length };
  }, [bySupplier]);

  useEffect(() => {
    setPhaseStartedAt(Date.now());
  }, [activeDeck]);

  useEffect(() => {
    const id = setTimeout(() => {
      setActiveDeck((d) => (d === 'monthly' ? 'suppliers' : 'monthly'));
    }, DECK_ROTATE_MS);
    return () => clearTimeout(id);
  }, [activeDeck]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.min(DECK_ROTATE_MS, Math.max(0, nowTick - phaseStartedAt));
  const progress = DECK_ROTATE_MS > 0 ? elapsed / DECK_ROTATE_MS : 0;
  const ringR = 17;
  const ringC = 2 * Math.PI * ringR;
  const dashLen = ringC * progress;

  const pillActive =
    'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md ring-1 ring-white/25';
  const pillIdle = 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/80';

  const go = (tab) => () => {
    if (allowedTabs?.includes(tab)) setActiveTab?.(tab);
  };

  const kpis = [
    {
      key: 'liters',
      label: 'Total liters (verified)',
      value: totals.liters >= 1000 ? `${(totals.liters / 1000).toFixed(1)}k` : totals.liters.toFixed(0),
      sub: 'All suppliers · verified only',
      tab: 'fuel_admin',
      border: 'border-indigo-200 dark:border-indigo-800/60',
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-700 dark:text-indigo-300',
    },
    {
      key: 'rand',
      label: 'Total spend (ZAR)',
      value: totals.rand >= 1e6 ? `${(totals.rand / 1e6).toFixed(2)}M` : totals.rand >= 1000 ? `${(totals.rand / 1000).toFixed(1)}k` : totals.rand.toFixed(0),
      sub: 'Verified transactions',
      tab: 'file_export',
      border: 'border-emerald-200 dark:border-emerald-800/60',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-700 dark:text-emerald-300',
    },
    {
      key: 'tx',
      label: 'Transaction count',
      value: String(totals.txs),
      sub: 'Verified rows',
      tab: 'fuel_admin',
      border: 'border-amber-200 dark:border-amber-800/60',
      bg: 'bg-amber-500/10',
      text: 'text-amber-800 dark:text-amber-200',
    },
    {
      key: 'sup',
      label: 'Suppliers on file',
      value: String((suppliers || []).length),
      sub: 'Master list',
      tab: 'supplier_details',
      border: 'border-violet-200 dark:border-violet-800/60',
      bg: 'bg-violet-500/10',
      text: 'text-violet-700 dark:text-violet-300',
    },
  ];

  const quickActions = [
    { label: 'Fuel Admin', tab: 'fuel_admin', desc: 'Filters, transactions, slip queue', icon: 'list' },
    { label: 'File Export', tab: 'file_export', desc: 'Excel, PDF, email sheets', icon: 'export' },
    { label: 'Analytics & AI', tab: 'analytics', desc: 'Trends and OpenAI insights', icon: 'spark' },
    { label: 'Supplier details', tab: 'supplier_details', desc: 'Prices, defaults, logos', icon: 'doc' },
  ];

  return (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50 tracking-tight">Fuel operations dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Verified diesel data at a glance — same visual rhythm as Command Centre: KPIs, live charts, and quick jumps.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Live metrics</h2>
        {loading ? (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-5 h-28 animate-pulse bg-slate-100/80 dark:bg-slate-800/60" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => {
              const ok = allowedTabs?.includes(k.tab);
              return (
                <div key={k.key}>
                  {kpiShell(
                    ok,
                    go(k.tab),
                    <>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{k.label}</p>
                      <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{k.value}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{k.sub}</p>
                      {ok ? (
                        <span className="inline-block mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 group-hover:underline">
                          Open →
                        </span>
                      ) : (
                        <span className="inline-block mt-2 text-xs text-slate-400">Tab not granted</span>
                      )}
                    </>,
                    k.border
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Command deck — mirrors Command Centre “DeliveryInsightsRotator” focus */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200/85 dark:border-slate-700/75 bg-gradient-to-br from-slate-50 via-indigo-50/35 to-violet-50/45 dark:from-slate-950 dark:via-indigo-950/25 dark:to-violet-950/20 shadow-[0_4px_32px_-8px_rgba(79,70,229,0.18)] dark:shadow-[0_10px_44px_-12px_rgba(0,0,0,0.5)]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_55%_at_100%_-15%,rgba(99,102,241,0.11),transparent_50%),radial-gradient(ellipse_80%_50%_at_0%_0%,rgba(168,85,247,0.1),transparent_48%)] dark:bg-[radial-gradient(ellipse_90%_55%_at_90%_0%,rgba(99,102,241,0.14),transparent_46%),radial-gradient(ellipse_70%_45%_at_0%_0%,rgba(192,132,252,0.12),transparent_45%)]"
          aria-hidden
        />
        <div className="relative px-4 py-3.5 sm:px-5 sm:py-4 border-b border-slate-200/70 dark:border-slate-700/55 bg-gradient-to-r from-white/92 via-indigo-50/35 to-violet-50/40 dark:from-slate-900/95 dark:via-slate-900/85 dark:to-violet-950/30">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-wrap items-start gap-3 sm:gap-4 min-w-0">
              <div className="relative shrink-0" title={`Chart focus rotates every ${DECK_ROTATE_MS / 1000}s`}>
                <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0 -rotate-90 drop-shadow-sm">
                  <circle cx="24" cy="24" r={ringR} fill="none" className="stroke-slate-200/95 dark:stroke-slate-600/90" strokeWidth="5" />
                  <circle
                    cx="24"
                    cy="24"
                    r={ringR}
                    fill="none"
                    className="stroke-indigo-500 dark:stroke-violet-400 transition-[stroke-dasharray] duration-200 ease-linear"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${dashLen} ${ringC}`}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-slate-500 dark:text-slate-400 pointer-events-none">
                  {DECK_ROTATE_MS / 1000}s
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2">
                  <span className="text-indigo-600 dark:text-indigo-300">Fuel deck</span>
                  <span className="text-slate-400">·</span>
                  <span>Verified volume</span>
                  <span className="rounded-md bg-slate-900/[0.06] dark:bg-white/[0.06] px-1.5 py-px text-[9px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-600/50">
                    auto-rotate
                  </span>
                </p>
                <div className="mt-2 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
                  <div className="inline-flex rounded-2xl p-1 bg-slate-900/[0.04] dark:bg-white/[0.05] ring-1 ring-slate-200/80 dark:ring-slate-600/55 shadow-inner w-fit">
                    <button
                      type="button"
                      onClick={() => setActiveDeck('monthly')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-300 ${activeDeck === 'monthly' ? pillActive : pillIdle}`}
                    >
                      Liters by month
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDeck('suppliers')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-300 ${activeDeck === 'suppliers' ? pillActive : pillIdle}`}
                    >
                      Supplier focus
                    </button>
                  </div>
                  <h2 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                    {activeDeck === 'monthly' ? 'Delivery month trend' : 'Spend & volume by supplier'}
                  </h2>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <InfoHint
                title="About these charts"
                text="All figures use verified fuel transactions only. Monthly bars need a delivery time on each row. Use Fuel Admin to correct or verify data."
              />
            </div>
          </div>
        </div>

        <div className="relative min-h-[min(26rem,70vh)] sm:min-h-[28rem]">
          {loading ? (
            <div className="p-6 sm:p-8">
              <div className="h-72 rounded-xl border border-slate-200/50 dark:border-slate-700/50 bg-gradient-to-br from-slate-100/70 to-indigo-50/40 dark:from-slate-800/50 dark:to-slate-900/80 animate-pulse" />
            </div>
          ) : (
            <>
              <div
                className={`absolute inset-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 transition-all duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  activeDeck === 'monthly'
                    ? 'opacity-100 z-10 translate-y-0 blur-0'
                    : 'opacity-0 z-0 pointer-events-none translate-y-3 blur-[1px]'
                }`}
                aria-hidden={activeDeck !== 'monthly'}
              >
                <div className="rounded-xl border border-slate-200/50 dark:border-slate-700/40 bg-white/40 dark:bg-slate-900/30 p-4 sm:p-5 backdrop-blur-sm">
                  <MonthlyStripChart
                    rows={byMonth}
                    valueKey="total_liters"
                    label="Liters delivered (by month)"
                    formatVal={(v) => `${Number(v).toFixed(1)} L`}
                    gradientClass="bg-gradient-to-t from-indigo-600 to-teal-500 dark:from-indigo-500 dark:to-teal-400"
                  />
                </div>
              </div>
              <div
                className={`absolute inset-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 transition-all duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  activeDeck === 'suppliers'
                    ? 'opacity-100 z-10 translate-y-0 blur-0'
                    : 'opacity-0 z-0 pointer-events-none -translate-y-3 blur-[1px]'
                }`}
                aria-hidden={activeDeck !== 'suppliers'}
              >
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-indigo-200/40 dark:border-indigo-800/35 bg-white/50 dark:bg-slate-900/40 p-4 sm:p-5">
                    <SupplierFocusChart
                      bySupplier={bySupplier}
                      valueKey="total_liters"
                      label="Liters by supplier"
                      formatVal={(v) => `${v.toFixed(1)} L`}
                      barClass="bg-gradient-to-r from-indigo-500 to-violet-500 dark:from-indigo-400 dark:to-violet-400"
                    />
                  </div>
                  <div className="rounded-xl border border-emerald-200/40 dark:border-emerald-800/35 bg-emerald-50/20 dark:bg-emerald-950/20 p-4 sm:p-5">
                    <SupplierFocusChart
                      bySupplier={bySupplier}
                      valueKey="total_rand"
                      label="Spend (ZAR) by supplier"
                      formatVal={(v) => `R ${v.toFixed(0)}`}
                      barClass="bg-gradient-to-r from-emerald-500 to-teal-500 dark:from-emerald-400 dark:to-teal-400"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((a) => {
            const ok = allowedTabs?.includes(a.tab);
            const inner = (
              <>
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    ok ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  {a.icon === 'list' && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  )}
                  {a.icon === 'export' && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                    </svg>
                  )}
                  {a.icon === 'spark' && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                  {a.icon === 'doc' && (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 text-left">
                  <p className={`font-semibold ${ok ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500'}`}>{a.label}</p>
                  <p className="text-xs text-slate-500 truncate">{a.desc}</p>
                  {!ok && <p className="text-[11px] text-slate-400 mt-1">Tab not granted</p>}
                </div>
              </>
            );
            return ok ? (
              <button
                key={a.tab}
                type="button"
                onClick={go(a.tab)}
                className="flex items-center gap-4 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 text-left shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition-all duration-200 group w-full"
              >
                {inner}
              </button>
            ) : (
              <div
                key={a.tab}
                className="flex items-center gap-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-4 opacity-90 cursor-not-allowed"
              >
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      {/* Compact supplier chips — same data as before, secondary */}
      {!loading && (suppliers || []).length > 0 ? (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50 p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Suppliers on file</p>
          <div className="flex flex-wrap gap-2">
            {(suppliers || []).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200/60 dark:ring-slate-600/50"
              >
                {s.name}
                {s.price_per_litre != null ? ` · R${s.price_per_litre}/L` : ''}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
