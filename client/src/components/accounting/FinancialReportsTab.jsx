import { useState, useEffect } from 'react';
import { accounting as accountingApi } from '../../api';
import { getApiBase } from '../../lib/apiBase.js';
import { todayYmd } from '../../lib/appTime.js';
import { downloadAttachmentWithAuth } from '../../api';
import { formatZarDisplay } from '../../lib/accountingLineTotals.js';

const inputClass = 'rounded-lg border border-surface-300 px-3 py-2 text-sm';
const btnPrimary = 'px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700';
const btnSecondary = 'px-3 py-1.5 rounded-lg border border-surface-300 text-sm hover:bg-surface-50';

const API = getApiBase();

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

export default function FinancialReportsTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayYmd());
  const [reportType, setReportType] = useState('profit-loss');
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    accountingApi.accountTypes
      .list()
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => setAccounts([]));
  }, []);

  const periodParams = { from: from || undefined, to: to || undefined };

  const loadPreview = async () => {
    setLoading(true);
    setPreview(null);
    try {
      if (reportType === 'trial-balance') {
        const d = await accountingApi.reports.trialBalance(periodParams);
        setPreview({ type: 'trial-balance', rows: d.rows || [] });
      } else if (reportType === 'profit-loss') {
        const d = await accountingApi.reports.profitLoss(periodParams);
        setPreview({ type: 'profit-loss', report: d.report });
      } else if (reportType === 'account-ledger' && accountId) {
        const d = await accountingApi.reports.accountLedger(accountId, periodParams);
        setPreview({ type: 'account-ledger', ledger: d.ledger });
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const download = async (format) => {
    const q = qs(periodParams);
    let url;
    if (reportType === 'trial-balance') {
      url = `${API}/accounting/reports/trial-balance/${format}${q}`;
    } else if (reportType === 'profit-loss') {
      url = `${API}/accounting/reports/profit-loss/${format}${q}`;
    } else if (reportType === 'account-ledger' && accountId) {
      url = `${API}/accounting/reports/account-ledger/${encodeURIComponent(accountId)}/${format}${q}`;
    } else {
      alert('Select an account for the account statement.');
      return;
    }
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const name =
      reportType === 'profit-loss'
        ? `profit-and-loss.${ext}`
        : reportType === 'trial-balance'
          ? `trial-balance.${ext}`
          : `account-statement.${ext}`;
    try {
      await downloadAttachmentWithAuth(url, name);
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-surface-900">Financial statements</h2>
        <p className="text-sm text-surface-600 mt-1 max-w-2xl">
          Profit &amp; loss, trial balance, and per-account statements from your general ledger. Export professional PDF
          or Excel for your accountant.
        </p>
      </div>

      <div className="app-glass-card p-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">Report</span>
            <select className={`${inputClass} w-full`} value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="profit-loss">Profit &amp; loss</option>
              <option value="trial-balance">Trial balance</option>
              <option value="account-ledger">Account statement</option>
            </select>
          </label>
          {reportType === 'account-ledger' && (
            <label className="text-sm block lg:col-span-2">
              <span className="text-xs text-surface-500 block mb-1">Account</span>
              <select className={`${inputClass} w-full`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Select —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">From</span>
            <input type="date" className={`${inputClass} w-full`} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm block">
            <span className="text-xs text-surface-500 block mb-1">To</span>
            <input type="date" className={`${inputClass} w-full`} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className={btnPrimary} disabled={loading} onClick={loadPreview}>
            {loading ? 'Loading…' : 'Preview'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => download('pdf')}>
            Download PDF
          </button>
          <button type="button" className={btnSecondary} onClick={() => download('excel')}>
            Download Excel
          </button>
        </div>
      </div>

      {preview?.type === 'trial-balance' && (
        <div className="app-glass-card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b bg-surface-50 text-xs uppercase text-surface-500">
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-3 font-mono text-xs">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right tabular-nums">{formatZarDisplay(r.total_debit)}</td>
                  <td className="p-3 text-right tabular-nums">{formatZarDisplay(r.total_credit)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{formatZarDisplay(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview?.type === 'profit-loss' && preview.report && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="app-glass-card p-4">
            <h3 className="font-semibold text-emerald-800 mb-3">Income</h3>
            <ul className="space-y-2 text-sm">
              {(preview.report.income || []).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    {r.account_code} {r.account_name}
                  </span>
                  <span className="tabular-nums">{formatZarDisplay(r.balance)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 pt-3 border-t font-semibold flex justify-between">
              <span>Total income</span>
              <span>{formatZarDisplay(preview.report.totalIncome)}</span>
            </p>
          </div>
          <div className="app-glass-card p-4">
            <h3 className="font-semibold text-red-800 mb-3">Expenses</h3>
            <ul className="space-y-2 text-sm">
              {(preview.report.expenses || []).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    {r.account_code} {r.account_name}
                  </span>
                  <span className="tabular-nums">{formatZarDisplay(r.balance)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 pt-3 border-t font-semibold flex justify-between">
              <span>Total expenses</span>
              <span>{formatZarDisplay(preview.report.totalExpenses)}</span>
            </p>
          </div>
          <div className="md:col-span-2 app-glass-card p-4 bg-brand-50/50 border border-brand-200/60">
            <p className="text-lg font-semibold flex justify-between">
              <span>Net profit / (loss)</span>
              <span className={preview.report.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                {formatZarDisplay(preview.report.netProfit)}
              </span>
            </p>
          </div>
        </div>
      )}

      {preview?.type === 'account-ledger' && preview.ledger && (
        <div className="app-glass-card overflow-x-auto">
          <h3 className="p-4 pb-0 font-semibold">
            {preview.ledger.account?.account_code} — {preview.ledger.account?.account_name}
          </h3>
          <table className="w-full text-sm min-w-[720px] mt-2">
            <thead>
              <tr className="border-b bg-surface-50 text-xs uppercase text-surface-500">
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Journal</th>
                <th className="p-3 text-left">Description</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(preview.ledger.lines || []).map((row, i) => (
                <tr key={i} className="border-b">
                  <td className="p-3">{String(row.entry_date || '').slice(0, 10)}</td>
                  <td className="p-3 font-mono text-xs">{row.journal_number}</td>
                  <td className="p-3">{row.line_description || row.journal_description}</td>
                  <td className="p-3 text-right tabular-nums">{formatZarDisplay(row.debit)}</td>
                  <td className="p-3 text-right tabular-nums">{formatZarDisplay(row.credit)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{formatZarDisplay(row.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
