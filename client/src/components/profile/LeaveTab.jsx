import { useState, useEffect, useMemo } from 'react';
import { profileManagement as pm } from '../../api';
import { useAuth } from '../../AuthContext';
import InfoHint from '../InfoHint.jsx';
import ExcelJS from 'exceljs';
import { todayYmd, wallMonthYearInAppZone } from '../../lib/appTime.js';

const LEAVE_VIEW_KEY = 'profile.leave.activeView';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function leaveSectorLabel(s) {
  if (s === 'public') return 'Public sector';
  if (s === 'private') return 'Private sector';
  if (s === 'both') return 'Public & private';
  return '';
}

/**
 * Shared leave application UI used by both the normal Profile and the Operator Profile.
 * Both surfaces read/write the same per-user leave data via `profileManagement.leave`,
 * so an application submitted on one page appears on the other for the same user.
 */
export default function LeaveTab({ balance, applications, leaveTypes = [], onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState('');
  const [leaveTypeOther, setLeaveTypeOther] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadingBalance, setDownloadingBalance] = useState(false);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(LEAVE_VIEW_KEY) || 'balance';
    } catch (_) {
      return 'balance';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LEAVE_VIEW_KEY, view);
    } catch (_) {
      /* ignore */
    }
  }, [view]);

  const { user } = useAuth();

  const totals = useMemo(() => {
    return (balance || []).reduce(
      (acc, b) => {
        const allocated = b.total_days || 0;
        const used = b.used_days || 0;
        acc.allocated += allocated;
        acc.used += used;
        acc.remaining += allocated - used;
        return acc;
      },
      { allocated: 0, used: 0, remaining: 0 }
    );
  }, [balance]);

  const effectiveLeaveType = leaveType === '_other_' ? leaveTypeOther.trim() : leaveType;
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!effectiveLeaveType || !startDate || !endDate) {
      onError('Leave type, start date and end date are required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
      const res = await pm.leave.create({ leave_type: effectiveLeaveType, start_date: startDate, end_date: endDate, days_requested: days, reason: reason || undefined });
      if (res?.application?.id && files.length > 0) {
        await pm.leave.addAttachments(res.application.id, files);
      }
      setShowForm(false);
      setLeaveType('');
      setLeaveTypeOther('');
      setStartDate('');
      setEndDate('');
      setReason('');
      setFiles([]);
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const year = wallMonthYearInAppZone().year;

  const handleDownloadBalance = async () => {
    setDownloadingBalance(true);
    onError('');
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Thinkers';
      wb.created = new Date();
      const ws = wb.addWorksheet('Leave balance', {
        views: [{ state: 'frozen', ySplit: 5 }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
      });
      ws.columns = [
        { key: 'leave_type', width: 30 },
        { key: 'allocated', width: 16 },
        { key: 'used', width: 14 },
        { key: 'remaining', width: 16 },
        { key: 'typical', width: 18 },
        { key: 'sector', width: 20 },
      ];
      const lastCol = 'F';
      const employeeName = user?.full_name || user?.email || '';

      // Title band
      ws.mergeCells(`A1:${lastCol}1`);
      const titleCell = ws.getCell('A1');
      titleCell.value = 'Leave Balance Statement';
      titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
      ws.getRow(1).height = 34;

      // Employee / meta band
      ws.mergeCells(`A2:${lastCol}2`);
      const empCell = ws.getCell('A2');
      empCell.value = employeeName ? `Employee: ${employeeName}` : 'Leave balance';
      empCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
      empCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      empCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      ws.getRow(2).height = 22;

      ws.mergeCells(`A3:${lastCol}3`);
      const subCell = ws.getCell('A3');
      subCell.value = `Leave year ${year}    ·    Generated ${formatDate(todayYmd())}`;
      subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };
      subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      ws.getRow(3).height = 18;
      ws.getRow(4).height = 6;

      // Header row (row 5)
      const headerRowIndex = 5;
      const headerLabels = ['Leave type', 'Allocated (days)', 'Used (days)', 'Remaining (days)', 'Typical / year', 'Sector'];
      const headerRow = ws.getRow(headerRowIndex);
      headerLabels.forEach((label, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = label;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E293B' } } };
      });
      headerRow.height = 22;
      ws.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: 6 } };

      const thinBorder = { style: 'thin', color: { argb: 'FFE2E8F0' } };
      let totAllocated = 0;
      let totUsed = 0;
      (balance || []).forEach((b, idx) => {
        const allocated = b.total_days || 0;
        const used = b.used_days || 0;
        const remaining = allocated - used;
        totAllocated += allocated;
        totUsed += used;
        const row = ws.addRow({
          leave_type: b.leave_type,
          allocated,
          used,
          remaining,
          typical: b.type_default_days_per_year != null ? b.type_default_days_per_year : '—',
          sector: leaveSectorLabel(b.type_sector) || '—',
        });
        row.height = 18;
        row.eachCell((cell, col) => {
          cell.border = { bottom: thinBorder };
          cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
          if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        });
        row.getCell(1).font = { bold: true, color: { argb: 'FF0F172A' } };
        const remCell = row.getCell(4);
        remCell.font = { bold: true, color: { argb: remaining <= 0 ? 'FFB91C1C' : 'FF15803D' } };
      });

      if (!balance || balance.length === 0) {
        const row = ws.addRow({ leave_type: 'No balance on record' });
        ws.mergeCells(`A${row.number}:${lastCol}${row.number}`);
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
      } else {
        // Totals row
        const totalRow = ws.addRow({
          leave_type: 'TOTAL',
          allocated: totAllocated,
          used: totUsed,
          remaining: totAllocated - totUsed,
          typical: '',
          sector: '',
        });
        totalRow.height = 22;
        totalRow.eachCell((cell, col) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
          cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
        });
      }

      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `leave-balance-${year}-${todayYmd()}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      onError(err?.message || 'Export failed');
    } finally {
      setDownloadingBalance(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Leave application</h1>
          <InfoHint
            title="Leave application help"
            text="Submit new applications, check your leave balance, review the configured leave types, and browse your application history. Managers process approvals in Management."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 shadow-sm"
          >
            <span aria-hidden>＋</span>
            {showForm ? 'Close application' : 'New leave application'}
          </button>
          <button
            type="button"
            disabled={downloadingBalance}
            onClick={handleDownloadBalance}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
          >
            <span aria-hidden>⬇</span>
            {downloadingBalance ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="app-glass-card p-4">
          <p className="text-sm font-medium text-surface-700 mb-3">New leave application</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Leave type *</label>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                <option value="">Select or type below</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
                <option value="_other_">Other (type below)</option>
              </select>
              {leaveType === '_other_' && (
                <input type="text" value={leaveTypeOther} onChange={(e) => setLeaveTypeOther(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Study leave" required />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Start date *</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">End date *</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Reason (optional)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Attachments (optional)</label>
              <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="w-full text-sm text-surface-600 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border file:border-surface-300 file:bg-surface-50" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Submitting…' : 'Submit'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-2 border-b border-surface-200 flex-wrap">
        {[
          { id: 'balance', label: 'Leave balance' },
          { id: 'types', label: 'Leave types & typical day weights' },
          { id: 'history', label: `Leave application history${applications.length ? ` (${applications.length})` : ''}` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === t.id ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'balance' && (
      <section className="app-glass-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-50">Leave balance</h2>
          <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium border border-brand-100">{year}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Allocated', value: totals.allocated, accent: 'text-surface-900 dark:text-surface-50' },
            { label: 'Taken', value: totals.used, accent: 'text-amber-600' },
            { label: 'Remaining', value: totals.remaining, accent: totals.remaining <= 0 ? 'text-red-600' : 'text-emerald-600' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white/60 dark:bg-surface-800/40 px-4 py-3 text-center">
              <p className="text-[11px] uppercase tracking-wide text-surface-500">{s.label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${s.accent}`}>{s.value}</p>
              <p className="text-[11px] text-surface-400">days</p>
            </div>
          ))}
        </div>

        {balance.length === 0 ? (
          <p className="text-sm text-surface-500 text-center py-6">No leave balance on record yet. Your balance appears once leave types are allocated or leave is approved.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {balance.map((b) => {
              const allocated = b.total_days || 0;
              const used = b.used_days || 0;
              const remaining = allocated - used;
              const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : (used > 0 ? 100 : 0);
              const lowRatio = allocated > 0 ? remaining / allocated : 1;
              const barColor = remaining <= 0 ? 'bg-red-500' : lowRatio < 0.25 ? 'bg-amber-500' : 'bg-emerald-500';
              const remColor = remaining <= 0 ? 'text-red-600' : 'text-emerald-600';
              return (
                <div key={`${b.leave_type}-${b.year ?? year}`} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white/60 dark:bg-surface-800/40 p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-surface-900 dark:text-surface-50 truncate" title={b.leave_type}>{b.leave_type}</p>
                      {leaveSectorLabel(b.type_sector) && (
                        <span className="inline-block mt-0.5 text-[11px] text-surface-500">{leaveSectorLabel(b.type_sector)}</span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-2xl font-bold leading-none tabular-nums ${remColor}`}>{remaining}</p>
                      <p className="text-[11px] text-surface-400">days left</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-surface-500">
                      <span>{used} used of {allocated}</span>
                      <span>{b.type_default_days_per_year != null ? `Typical ${b.type_default_days_per_year}/yr` : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {view === 'types' && (
        <div className="app-glass-card p-4 overflow-x-auto">
          <p className="text-sm font-medium text-surface-700 mb-1">Leave types &amp; typical day weights</p>
          {leaveTypes.length === 0 ? (
            <p className="text-sm text-surface-500">No leave types configured yet. Management can add a South African starter set or custom types.</p>
          ) : (
            <>
              <p className="text-xs text-surface-500 mb-3">
                Configured for your organisation (database). Management can add a South African starter set or custom types.
              </p>
              <table className="w-full text-sm min-w-[520px]">
                <thead className="text-left text-surface-500 border-b border-surface-200">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Typical days / year</th>
                    <th className="py-2 pr-3 font-medium">Sector</th>
                    <th className="py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {leaveTypes.map((t) => (
                    <tr key={t.id} className="align-top">
                      <td className="py-2 pr-3 font-medium text-surface-900">{t.name}</td>
                      <td className="py-2 pr-3">{t.default_days_per_year != null ? t.default_days_per_year : '—'}</td>
                      <td className="py-2 pr-3">{leaveSectorLabel(t.sector) || '—'}</td>
                      <td className="py-2 text-surface-600 text-xs max-w-md">{t.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {view === 'history' && (
      <div className="app-glass-card p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-medium text-surface-700">Leave application history</p>
          <button
            type="button"
            disabled={applications.length === 0 || downloadingExcel}
            onClick={async () => {
              setDownloadingExcel(true);
              try {
                const wb = new ExcelJS.Workbook();
                const ws = wb.addWorksheet('Leave history');
                ws.columns = [
                  { header: 'Leave type', key: 'leave_type', width: 18 },
                  { header: 'Start date', key: 'start_date', width: 12 },
                  { header: 'End date', key: 'end_date', width: 12 },
                  { header: 'Days', key: 'days_requested', width: 8 },
                  { header: 'Status', key: 'status', width: 12 },
                  { header: 'Applied', key: 'created_at', width: 14 },
                  { header: 'Reviewed', key: 'reviewed_at', width: 14 },
                ];
                ws.addRows(applications.map((a) => ({
                  leave_type: a.leave_type,
                  start_date: formatDate(a.start_date),
                  end_date: formatDate(a.end_date),
                  days_requested: a.days_requested,
                  status: a.status,
                  created_at: formatDate(a.created_at),
                  reviewed_at: formatDate(a.reviewed_at),
                })));
                const buf = await wb.xlsx.writeBuffer();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([buf]));
                a.download = `leave-history-${todayYmd()}.xlsx`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (err) {
                onError(err?.message || 'Export failed');
              } finally {
                setDownloadingExcel(false);
              }
            }}
            className="text-sm text-brand-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloadingExcel ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        {applications.length === 0 ? (
          <p className="text-sm text-surface-500">No applications yet.</p>
        ) : (
          <ul className="space-y-2">
            {applications.map((a) => (
              <li key={a.id} className="flex justify-between items-start text-sm border-b border-surface-100 pb-2">
                <span>{a.leave_type} — {formatDate(a.start_date)} to {formatDate(a.end_date)} ({a.days_requested} days)</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  a.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : a.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                }`}>{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
