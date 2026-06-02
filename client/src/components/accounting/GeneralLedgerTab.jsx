import { useState, useEffect, useCallback, useMemo } from 'react';
import { accounting as accountingApi } from '../../api';
import { getApiBase } from '../../lib/apiBase.js';
import { todayYmd } from '../../lib/appTime.js';
import { downloadAttachmentWithAuth } from '../../api';
import { formatZarDisplay } from '../../lib/accountingLineTotals.js';
import InfoHint from '../InfoHint.jsx';

const inputClass = 'rounded-lg border border-surface-300 px-3 py-2 text-sm w-full';
const btnPrimary = 'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50';

const SOURCE_TYPES = [
  { value: 'all', label: 'All sources' },
  { value: 'manual', label: 'Manual journal' },
  { value: 'invoice_payment', label: 'Invoice payment' },
  { value: 'invoice_accrual', label: 'Invoice accrual' },
  { value: 'expense_entry', label: 'Expense' },
  { value: 'income_entry', label: 'Income' },
];

const SOURCE_LABELS = {
  manual: 'Manual',
  invoice_payment: 'Invoice payment',
  invoice_accrual: 'Invoice accrual',
  expense_entry: 'Expense',
  income_entry: 'Income',
};

function sourceLabel(v) {
  return SOURCE_LABELS[v] || v || '—';
}

function emptyLine() {
  return { account_type_id: '', line_description: '', debit: '', credit: '' };
}

function buildFilterParams({ from, to, sourceType, accountId, search, status }) {
  const p = {};
  if (from) p.from = from;
  if (to) p.to = to;
  if (sourceType && sourceType !== 'all') p.source_type = sourceType;
  if (accountId) p.account_id = accountId;
  if (search.trim()) p.search = search.trim();
  if (status && status !== 'all') p.status = status;
  return p;
}

const API = getApiBase();

export default function GeneralLedgerTab() {
  const [accounts, setAccounts] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayYmd());
  const [sourceType, setSourceType] = useState('all');
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('posted');
  const [viewMode, setViewMode] = useState('entries');
  const [entries, setEntries] = useState([]);
  const [lines, setLines] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualForm, setManualForm] = useState({
    entry_date: todayYmd(),
    description: '',
    lines: [emptyLine(), emptyLine()],
  });

  const filters = useMemo(
    () => buildFilterParams({ from, to, sourceType, accountId, search, status }),
    [from, to, sourceType, accountId, search, status]
  );

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      accountingApi.generalLedger.summary(filters),
      viewMode === 'lines'
        ? accountingApi.generalLedger.lines(filters)
        : accountingApi.generalLedger.entries(filters),
    ])
      .then(([s, data]) => {
        setSummary(s.summary || null);
        if (viewMode === 'lines') setLines(data.lines || []);
        else setEntries(data.entries || []);
      })
      .catch(() => {
        setSummary(null);
        setEntries([]);
        setLines([]);
      })
      .finally(() => setLoading(false));
  }, [filters, viewMode]);

  useEffect(() => {
    accountingApi.accountTypes.list().then((d) => setAccounts(d.accounts || [])).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (id) => {
    setSelectedId(id);
    accountingApi.generalLedger.get(id).then(setDetail).catch(() => setDetail(null));
  };

  const manualTotals = useMemo(() => {
    const debit = manualForm.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = manualForm.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [manualForm.lines]);

  const postManual = async () => {
    if (!manualForm.description.trim()) return alert('Description is required.');
    if (!manualTotals.balanced) return alert('Debits must equal credits before posting.');
    setManualSaving(true);
    try {
      await accountingApi.generalLedger.create({
        entry_date: manualForm.entry_date,
        description: manualForm.description.trim(),
        lines: manualForm.lines
          .filter((l) => l.account_type_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            account_type_id: l.account_type_id,
            line_description: l.line_description || null,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
          })),
      });
      setShowManual(false);
      setManualForm({ entry_date: todayYmd(), description: '', lines: [emptyLine(), emptyLine()] });
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setManualSaving(false);
    }
  };

  const exportFile = (format) => {
    const q = new URLSearchParams(filters).toString();
    const url = `${API}/accounting/journal-entries/export/${format}${q ? `?${q}` : ''}`;
    downloadAttachmentWithAuth(url, `general-ledger.${format === 'pdf' ? 'pdf' : 'xlsx'}`).catch((e) => alert(e.message));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h2 className="text-xl font-semibold text-surface-900">General ledger</h2>
          <p className="text-sm text-surface-600 mt-1 max-w-2xl">
            Full double-entry register: automatic postings from invoices and expenses, plus manual journals. Filter,
            drill into entries, and export for your accountant.
          </p>
        </div>
        <InfoHint text="Every posted journal must balance (total debits = total credits). Invoice payments and approved expenses create entries automatically." />
      </div>

      {summary && (
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="app-glass-card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wide">Journal entries</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{summary.entry_count ?? 0}</p>
          </div>
          <div className="app-glass-card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wide">Total debits</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 text-emerald-800">{formatZarDisplay(summary.total_debit)}</p>
          </div>
          <div className="app-glass-card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wide">Total credits</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 text-blue-800">{formatZarDisplay(summary.total_credit)}</p>
          </div>
        </div>
      )}

      <div className="app-glass-card p-4 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">From</span>
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">To</span>
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">Source</span>
            <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              {SOURCE_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">Account</span>
            <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block lg:col-span-2">
            <span className="text-xs text-surface-500 block mb-1">Search</span>
            <input
              className={inputClass}
              placeholder="Journal # or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={viewMode === 'entries' ? btnPrimary : btnSecondary}
              onClick={() => setViewMode('entries')}
            >
              By journal
            </button>
            <button
              type="button"
              className={viewMode === 'lines' ? btnPrimary : btnSecondary}
              onClick={() => setViewMode('lines')}
            >
              Line register
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={load}>
              Refresh
            </button>
            <button type="button" className={btnSecondary} onClick={() => exportFile('pdf')}>
              PDF
            </button>
            <button type="button" className={btnSecondary} onClick={() => exportFile('excel')}>
              Excel
            </button>
            <button type="button" className={btnPrimary} onClick={() => setShowManual((v) => !v)}>
              {showManual ? 'Close manual entry' : 'Manual journal'}
            </button>
          </div>
        </div>
      </div>

      {showManual && (
        <div className="app-glass-card p-5 space-y-4 border-2 border-brand-200/50">
          <h3 className="font-semibold">Post manual journal</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm block">
              <span className="text-xs text-surface-500 block mb-1">Date *</span>
              <input
                type="date"
                className={inputClass}
                value={manualForm.entry_date}
                onChange={(e) => setManualForm((f) => ({ ...f, entry_date: e.target.value }))}
              />
            </label>
            <label className="text-sm block sm:col-span-2">
              <span className="text-xs text-surface-500 block mb-1">Description *</span>
              <input
                className={inputClass}
                value={manualForm.description}
                onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-surface-500 uppercase">Lines (debits must equal credits)</p>
            {manualForm.lines.map((line, idx) => (
              <div key={idx} className="grid sm:grid-cols-12 gap-2 items-end">
                <label className="text-sm sm:col-span-4 block">
                  <span className="text-xs text-surface-500">Account</span>
                  <select
                    className={inputClass}
                    value={line.account_type_id}
                    onChange={(e) =>
                      setManualForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], account_type_id: e.target.value };
                        return { ...f, lines };
                      })
                    }
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm sm:col-span-3 block">
                  <span className="text-xs text-surface-500">Line note</span>
                  <input
                    className={inputClass}
                    value={line.line_description}
                    onChange={(e) =>
                      setManualForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], line_description: e.target.value };
                        return { ...f, lines };
                      })
                    }
                  />
                </label>
                <label className="text-sm sm:col-span-2 block">
                  <span className="text-xs text-surface-500">Debit</span>
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass}
                    value={line.debit}
                    onChange={(e) =>
                      setManualForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], debit: e.target.value, credit: e.target.value ? '' : lines[idx].credit };
                        return { ...f, lines };
                      })
                    }
                  />
                </label>
                <label className="text-sm sm:col-span-2 block">
                  <span className="text-xs text-surface-500">Credit</span>
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass}
                    value={line.credit}
                    onChange={(e) =>
                      setManualForm((f) => {
                        const lines = [...f.lines];
                        lines[idx] = { ...lines[idx], credit: e.target.value, debit: e.target.value ? '' : lines[idx].debit };
                        return { ...f, lines };
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-xs text-red-600 sm:col-span-1 pb-2"
                  onClick={() =>
                    setManualForm((f) => ({
                      ...f,
                      lines: f.lines.length > 2 ? f.lines.filter((_, i) => i !== idx) : f.lines,
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setManualForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
            >
              Add line
            </button>
          </div>
          <p className={`text-sm ${manualTotals.balanced ? 'text-emerald-700' : 'text-amber-700'}`}>
            Debits: {formatZarDisplay(manualTotals.debit)} — Credits: {formatZarDisplay(manualTotals.credit)}
            {manualTotals.balanced ? ' (balanced)' : ' (not balanced)'}
          </p>
          <button type="button" className={btnPrimary} disabled={manualSaving || !manualTotals.balanced} onClick={postManual}>
            {manualSaving ? 'Posting…' : 'Post journal'}
          </button>
        </div>
      )}

      <div className="grid xl:grid-cols-3 gap-4">
        <div className={`${detail?.entry ? 'xl:col-span-2' : 'xl:col-span-3'} app-glass-card overflow-x-auto`}>
          {loading ? (
            <p className="p-6 text-surface-500">Loading…</p>
          ) : viewMode === 'entries' ? (
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b bg-surface-50 text-xs uppercase text-surface-500">
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Journal #</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-left">Source</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b cursor-pointer hover:bg-brand-50/40 ${selectedId === e.id ? 'bg-brand-50/80' : ''}`}
                    onClick={() => openDetail(e.id)}
                  >
                    <td className="p-3 whitespace-nowrap">{String(e.entry_date || '').slice(0, 10)}</td>
                    <td className="p-3 font-mono text-xs">{e.journal_number}</td>
                    <td className="p-3 max-w-[14rem] truncate" title={e.description}>
                      {e.description}
                    </td>
                    <td className="p-3 text-xs">{sourceLabel(e.source_type)}</td>
                    <td className="p-3 text-right tabular-nums">{formatZarDisplay(e.total_debit)}</td>
                    <td className="p-3 text-right tabular-nums">{formatZarDisplay(e.total_credit)}</td>
                  </tr>
                ))}
                {!entries.length && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-surface-500">
                      No journal entries for this period. Post a manual journal or record invoice payments / expenses.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b bg-surface-50 text-xs uppercase text-surface-500">
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Journal</th>
                  <th className="p-3 text-left">Account</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-left">Source</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((row) => (
                  <tr
                    key={row.line_id}
                    className={`border-b hover:bg-surface-50/60 cursor-pointer ${selectedId === row.journal_entry_id ? 'bg-brand-50/50' : ''}`}
                    onClick={() => openDetail(row.journal_entry_id)}
                  >
                    <td className="p-3 whitespace-nowrap">{String(row.entry_date || '').slice(0, 10)}</td>
                    <td className="p-3 font-mono text-xs">{row.journal_number}</td>
                    <td className="p-3">
                      <span className="font-mono text-xs text-surface-500">{row.account_code}</span>{' '}
                      {row.account_name}
                    </td>
                    <td className="p-3 max-w-[12rem] truncate">{row.line_description || row.journal_description}</td>
                    <td className="p-3 text-xs">{sourceLabel(row.source_type)}</td>
                    <td className="p-3 text-right tabular-nums">{formatZarDisplay(row.debit)}</td>
                    <td className="p-3 text-right tabular-nums">{formatZarDisplay(row.credit)}</td>
                  </tr>
                ))}
                {!lines.length && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-surface-500">
                      No lines for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {detail?.entry && (
          <div className="app-glass-card p-4 space-y-3 xl:col-span-1 h-fit sticky top-4">
            <button type="button" className="text-xs text-surface-500 hover:underline" onClick={() => { setSelectedId(null); setDetail(null); }}>
              Close
            </button>
            <h3 className="text-lg font-semibold font-mono">{detail.entry.journal_number}</h3>
            <p className="text-sm text-surface-600">{detail.entry.description}</p>
            <dl className="text-xs space-y-1 text-surface-600">
              <div className="flex justify-between">
                <dt>Date</dt>
                <dd>{String(detail.entry.entry_date || '').slice(0, 10)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Source</dt>
                <dd>{sourceLabel(detail.entry.source_type)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Posted by</dt>
                <dd>{detail.entry.created_by_name || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Status</dt>
                <dd className="capitalize">{detail.entry.status}</dd>
              </div>
            </dl>
            <table className="w-full text-sm border-t pt-3">
              <thead>
                <tr className="text-xs text-surface-500">
                  <th className="py-1 text-left">Account</th>
                  <th className="py-1 text-right">Dr</th>
                  <th className="py-1 text-right">Cr</th>
                </tr>
              </thead>
              <tbody>
                {(detail.lines || []).map((l) => (
                  <tr key={l.id} className="border-t border-surface-100">
                    <td className="py-2 pr-2">
                      <span className="block font-mono text-[10px] text-surface-500">{l.account_code}</span>
                      {l.account_name}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatZarDisplay(l.debit)}</td>
                    <td className="py-2 text-right tabular-nums">{formatZarDisplay(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td className="py-2">Totals</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatZarDisplay((detail.lines || []).reduce((s, l) => s + Number(l.debit), 0))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatZarDisplay((detail.lines || []).reduce((s, l) => s + Number(l.credit), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
