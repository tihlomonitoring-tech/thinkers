import { useState, useEffect, useMemo } from 'react';
import { profileManagement as pm } from '../api';
import InfoHint from './InfoHint.jsx';
import { calendarMonthStartYmd, wallMonthYearInAppZone } from '../lib/appTime.js';
import {
  DEFAULT_SHIFT_SETTINGS,
  formatShiftWindow,
  countWeekdayDates,
} from '../lib/workScheduleShiftTimes.js';

function formatDate(v) {
  if (!v) return '—';
  const s = String(v);
  const d = s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return s;
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 7, label: 'Sun' },
];

export default function WorkSchedulesSection({ schedules, tenantUsers, onRefresh, onError }) {
  const [tab, setTab] = useState('shift');
  const [shiftSettings, setShiftSettings] = useState({ ...DEFAULT_SHIFT_SETTINGS });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [applyUserIds, setApplyUserIds] = useState([]);
  const [applyFromDate, setApplyFromDate] = useState('');
  const [applyToDate, setApplyToDate] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllUserId, setDeleteAllUserId] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [scheduleUserId, setScheduleUserId] = useState('');
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [entryDate, setEntryDate] = useState('');
  const [entryShift, setEntryShift] = useState('day');
  const [entryNotes, setEntryNotes] = useState('');
  const [addingEntry, setAddingEntry] = useState(false);
  const [filterUserId, setFilterUserId] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkUserId, setBulkUserId] = useState('');
  const [bulkStartDate, setBulkStartDate] = useState(() => {
    const w = wallMonthYearInAppZone();
    return calendarMonthStartYmd(w.year, w.monthIndex0);
  });
  const [bulkMonths, setBulkMonths] = useState(1);
  const [bulkPattern, setBulkPattern] = useState(['day', 'day', 'night', 'off']);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const [fixedUserIds, setFixedUserIds] = useState([]);
  const [fixedPeriodStart, setFixedPeriodStart] = useState('');
  const [fixedPeriodEnd, setFixedPeriodEnd] = useState('');
  const [fixedStartTime, setFixedStartTime] = useState('09:00');
  const [fixedEndTime, setFixedEndTime] = useState('17:00');
  const [fixedWeekdays, setFixedWeekdays] = useState([1, 2, 3, 4, 5]);
  const [fixedTitle, setFixedTitle] = useState('Office hours');
  const [fixedNotes, setFixedNotes] = useState('');
  const [fixedSkipExisting, setFixedSkipExisting] = useState(true);
  const [fixedSaving, setFixedSaving] = useState(false);
  const [fixedSelectAll, setFixedSelectAll] = useState(false);

  useEffect(() => {
    pm.schedules.shiftSettings
      .get()
      .then((d) => setShiftSettings({ ...DEFAULT_SHIFT_SETTINGS, ...(d.settings || {}) }))
      .catch(() => setShiftSettings({ ...DEFAULT_SHIFT_SETTINGS }))
      .finally(() => setLoadingSettings(false));
  }, []);

  const rotatingSchedules = useMemo(
    () => (schedules || []).filter((s) => String(s.schedule_kind || 'rotating') !== 'fixed'),
    [schedules]
  );
  const fixedSchedules = useMemo(
    () => (schedules || []).filter((s) => String(s.schedule_kind || '') === 'fixed'),
    [schedules]
  );

  const usersWithoutRotating = useMemo(() => {
    const withRotating = new Set(rotatingSchedules.map((s) => String(s.user_id)));
    return (tenantUsers || []).filter((u) => !withRotating.has(String(u.id)));
  }, [tenantUsers, rotatingSchedules]);

  const fixedPreviewCount = useMemo(() => {
    if (!fixedPeriodStart || !fixedPeriodEnd || fixedUserIds.length === 0) return 0;
    const days = countWeekdayDates(fixedPeriodStart, fixedPeriodEnd, fixedWeekdays);
    return days * fixedUserIds.length;
  }, [fixedPeriodStart, fixedPeriodEnd, fixedWeekdays, fixedUserIds]);

  const dayWindow = formatShiftWindow(shiftSettings.day_start, shiftSettings.day_end);
  const nightWindow = formatShiftWindow(shiftSettings.night_start, shiftSettings.night_end);

  const toggleApplyUser = (id) => {
    setApplyUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleFixedUser = (id) => {
    setFixedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleFixedWeekday = (id) => {
    setFixedWeekdays((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b)));
  };

  const handleSaveShiftSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    onError('');
    try {
      const res = await pm.schedules.shiftSettings.update({
        ...shiftSettings,
        apply_to_existing: applyToExisting,
        user_ids: applyUserIds.length ? applyUserIds : undefined,
        from_date: applyFromDate || undefined,
        to_date: applyToDate || undefined,
      });
      setShiftSettings({ ...DEFAULT_SHIFT_SETTINGS, ...(res.settings || {}) });
      const n = res.updated_entries ?? 0;
      alert(
        applyToExisting && n > 0
          ? `Shift times saved. Updated ${n} existing shift entr${n === 1 ? 'y' : 'ies'}.`
          : 'Shift times saved for new shifts.'
      );
    } catch (err) {
      onError(err?.message || 'Failed to save shift times');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!scheduleUserId || !title || !periodStart || !periodEnd) {
      onError('Select employee and enter title and period dates');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.schedules.create({ user_id: scheduleUserId, title: title.trim(), period_start: periodStart, period_end: periodEnd });
      setShowForm(false);
      setScheduleUserId('');
      setTitle('');
      setPeriodStart('');
      setPeriodEnd('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllForUser = async (e) => {
    e.preventDefault();
    if (!deleteAllUserId) {
      onError('Select an employee');
      return;
    }
    const u = tenantUsers.find((x) => x.id === deleteAllUserId);
    const label = u?.full_name || u?.email || 'this employee';
    const n = schedules.filter((s) => s.user_id === deleteAllUserId).length;
    if (
      !window.confirm(
        `Delete ALL work schedules for ${label}? This removes ${n || 'all'} schedule record(s), every shift, related shift swap requests, and shift clock sessions tied to those shifts. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingAll(true);
    onError('');
    try {
      const res = await pm.schedules.deleteAllForUser(deleteAllUserId);
      const removed = res?.deleted?.schedules ?? 0;
      setShowDeleteAll(false);
      setDeleteAllUserId('');
      setSelectedSchedule(null);
      onRefresh();
      if (removed === 0) {
        onError('');
        alert('No schedules were on file for that employee.');
      } else {
        alert(`Removed ${removed} schedule(s) for ${label}.`);
      }
    } catch (err) {
      onError(err?.message || 'Failed to delete schedules');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!selectedSchedule || !entryDate) {
      onError('Select a schedule and enter date');
      return;
    }
    setAddingEntry(true);
    onError('');
    try {
      await pm.schedules.addEntries(selectedSchedule.id, [{ work_date: entryDate, shift_type: entryShift, notes: entryNotes.trim() || undefined }]);
      setEntryDate('');
      setEntryNotes('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to add entry');
    } finally {
      setAddingEntry(false);
    }
  };

  const handleBulkGenerate = async (e) => {
    e.preventDefault();
    if (!bulkUserId || !bulkStartDate || bulkPattern.length === 0) {
      onError('Select employee, start date, and add at least one pattern slot');
      return;
    }
    const hasWork = bulkPattern.some((p) => p === 'day' || p === 'night');
    if (!hasWork) {
      onError('Pattern must include at least one Day or Night');
      return;
    }
    setBulkGenerating(true);
    onError('');
    try {
      const res = await pm.schedules.generateBulk({
        user_id: bulkUserId,
        start_date: bulkStartDate,
        time_frame_months: bulkMonths,
        pattern: bulkPattern,
      });
      onRefresh();
      setShowBulk(false);
      setBulkUserId('');
      setBulkPattern(['day', 'day', 'night', 'off']);
      alert(`Schedule created: ${res.schedule?.title}. ${res.entries_created ?? 0} shifts added.`);
    } catch (err) {
      onError(err?.message || 'Bulk generate failed');
    } finally {
      setBulkGenerating(false);
    }
  };

  const handleFixedBulk = async (e) => {
    e.preventDefault();
    if (!fixedUserIds.length || !fixedPeriodStart || !fixedPeriodEnd) {
      onError('Select at least one employee and a date range');
      return;
    }
    if (!fixedWeekdays.length) {
      onError('Select at least one weekday');
      return;
    }
    setFixedSaving(true);
    onError('');
    try {
      const res = await pm.schedules.generateFixedBulk({
        user_ids: fixedUserIds,
        period_start: fixedPeriodStart,
        period_end: fixedPeriodEnd,
        start_time: fixedStartTime,
        end_time: fixedEndTime,
        weekdays: fixedWeekdays,
        title: fixedTitle.trim() || 'Fixed hours',
        notes: fixedNotes.trim() || undefined,
        skip_existing: fixedSkipExisting,
      });
      onRefresh();
      alert(
        `Created ${res.schedules_created ?? 0} schedule(s), ${res.entries_created ?? 0} day(s) scheduled` +
          (res.entries_skipped ? ` (${res.entries_skipped} skipped — already had a shift that day).` : '.')
      );
      setFixedUserIds([]);
    } catch (err) {
      onError(err?.message || 'Fixed schedule bulk failed');
    } finally {
      setFixedSaving(false);
    }
  };

  const addPatternSlot = () => setBulkPattern((p) => [...p, 'day']);
  const removePatternSlot = (index) => setBulkPattern((p) => (p.length > 1 ? p.filter((_, i) => i !== index) : p));
  const setPatternSlot = (index, value) => setBulkPattern((p) => p.map((v, i) => (i === index ? value : v)));

  const listSchedules = tab === 'fixed' ? fixedSchedules : rotatingSchedules;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Work schedules</h1>
        <InfoHint
          title="Work schedules help"
          text="Shift workers use rotating day/night patterns. Non-shift staff use fixed hours on selected weekdays. Set tenant-wide day/night times once, then apply in bulk."
        />
      </div>

      <div className="app-glass-segmented">
        <button
          type="button"
          onClick={() => setTab('shift')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${tab === 'shift' ? 'bg-brand-600 text-white shadow-sm' : 'app-glass-pill-idle'}`}
        >
          Shift workers
        </button>
        <button
          type="button"
          onClick={() => setTab('fixed')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${tab === 'fixed' ? 'bg-brand-600 text-white shadow-sm' : 'app-glass-pill-idle'}`}
        >
          Fixed hours (non-shift)
        </button>
      </div>

      {tab === 'shift' && (
        <>
          <form onSubmit={handleSaveShiftSettings} className="app-glass-card p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-900">Tenant shift times</h2>
              <InfoHint
                title="Bulk shift times"
                text="Set default day and night windows for all shift workers. Enable “Apply to existing shifts” to update entries already on file (optionally filter by employee and date range)."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Day shift start</label>
                <input type="time" value={shiftSettings.day_start} onChange={(e) => setShiftSettings((s) => ({ ...s, day_start: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" disabled={loadingSettings} />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Day shift end</label>
                <input type="time" value={shiftSettings.day_end} onChange={(e) => setShiftSettings((s) => ({ ...s, day_end: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" disabled={loadingSettings} />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Night shift start</label>
                <input type="time" value={shiftSettings.night_start} onChange={(e) => setShiftSettings((s) => ({ ...s, night_start: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" disabled={loadingSettings} />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1">Night shift end</label>
                <input type="time" value={shiftSettings.night_end} onChange={(e) => setShiftSettings((s) => ({ ...s, night_end: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" disabled={loadingSettings} />
              </div>
            </div>
            <p className="text-xs text-surface-500">
              Preview: Day {dayWindow || '—'} · Night {nightWindow || '—'}
            </p>
            <label className="flex items-center gap-2 text-sm text-surface-700">
              <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
              Apply to existing shift entries when saving
            </label>
            {applyToExisting && (
              <div className="space-y-3 pl-1 border-l-2 border-brand-200">
                <div className="grid grid-cols-2 gap-2 max-w-md">
                  <div>
                    <label className="block text-xs text-surface-500 mb-1">From date (optional)</label>
                    <input type="date" value={applyFromDate} onChange={(e) => setApplyFromDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-surface-500 mb-1">To date (optional)</label>
                    <input type="date" value={applyToDate} onChange={(e) => setApplyToDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-600 mb-1">Employees (leave empty = all shift workers)</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {tenantUsers.map((u) => (
                      <label key={u.id} className="inline-flex items-center gap-1.5 text-xs bg-surface-50 border border-surface-200 rounded-full px-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={applyUserIds.includes(u.id)} onChange={() => toggleApplyUser(u.id)} />
                        {u.full_name || u.email}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button type="submit" disabled={savingSettings || loadingSettings} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {savingSettings ? 'Saving…' : 'Save shift times'}
            </button>
          </form>

          {!showForm && !showDeleteAll ? (
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" onClick={() => { setShowDeleteAll(false); setShowForm(true); }} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                Create schedule for employee
              </button>
              <button type="button" onClick={() => { setShowForm(false); setShowDeleteAll(true); }} className="px-4 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-medium hover:bg-red-50">
                Delete all schedules for an employee
              </button>
            </div>
          ) : showForm ? (
            <form onSubmit={handleCreate} className="app-glass-card p-4 space-y-3 max-w-md">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
                <select value={scheduleUserId} onChange={(e) => setScheduleUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                  <option value="">Select employee</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Title *</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. March 2025" required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Period start *</label>
                  <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Period end *</label>
                  <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create'}</button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleDeleteAllForUser} className="bg-white rounded-xl border border-red-100 p-4 space-y-3 max-w-md">
              <span className="text-sm font-medium text-surface-800">Delete all schedules for one employee</span>
              <select value={deleteAllUserId} onChange={(e) => setDeleteAllUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                <option value="">Select employee</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="submit" disabled={deletingAll} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">{deletingAll ? 'Deleting…' : 'Delete all schedules'}</button>
                <button type="button" onClick={() => { setShowDeleteAll(false); setDeleteAllUserId(''); }} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
              </div>
            </form>
          )}

          <div className="app-glass-card overflow-hidden">
            <button type="button" onClick={() => setShowBulk(!showBulk)} className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-medium text-surface-700 hover:bg-surface-50 transition-colors">
              <span>Bulk schedule generator (rotating pattern)</span>
              <span className="text-surface-400">{showBulk ? '▼' : '▶'}</span>
            </button>
            {showBulk && (
              <form onSubmit={handleBulkGenerate} className="p-4 border-t border-surface-100 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
                    <select value={bulkUserId} onChange={(e) => setBulkUserId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required>
                      <option value="">Select employee</option>
                      {tenantUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1">Start date *</label>
                    <input type="date" value={bulkStartDate} onChange={(e) => setBulkStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1">Time frame *</label>
                    <select value={bulkMonths} onChange={(e) => setBulkMonths(Number(e.target.value))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                      <option value={1}>1 month</option>
                      <option value={3}>3 months</option>
                      <option value={6}>6 months</option>
                      <option value={12}>12 months</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-surface-700">Pattern (repeats daily)</label>
                    <button type="button" onClick={addPatternSlot} className="text-xs text-brand-600 hover:underline">+ Add slot</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bulkPattern.map((slot, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <select value={slot} onChange={(e) => setPatternSlot(i, e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm min-w-[90px]">
                          <option value="day">Day ({dayWindow})</option>
                          <option value="night">Night ({nightWindow})</option>
                          <option value="off">Off</option>
                        </select>
                        <button type="button" onClick={() => removePatternSlot(i)} className="p-1.5 rounded text-surface-500 hover:bg-surface-100 hover:text-red-600" title="Remove slot">×</button>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="submit" disabled={bulkGenerating} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                  {bulkGenerating ? 'Generating…' : 'Generate schedule'}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {tab === 'fixed' && (
        <form onSubmit={handleFixedBulk} className="app-glass-card p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-surface-900">Bulk fixed hours</h2>
            <InfoHint
              title="Non-shift staff"
              text="For employees who do not work rotating shifts — set the same start/end time on selected weekdays across a date range. Skips days that already have a shift if enabled."
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => {
                const ids = usersWithoutRotating.map((u) => u.id);
                setFixedUserIds(fixedSelectAll ? [] : ids);
                setFixedSelectAll(!fixedSelectAll);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50"
            >
              {fixedSelectAll ? 'Clear selection' : `Select staff without rotating schedule (${usersWithoutRotating.length})`}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border border-surface-100 rounded-lg p-3">
            {tenantUsers.map((u) => (
              <label key={u.id} className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-1 cursor-pointer border ${fixedUserIds.includes(u.id) ? 'bg-brand-50 border-brand-300' : 'bg-surface-50 border-surface-200'}`}>
                <input type="checkbox" checked={fixedUserIds.includes(u.id)} onChange={() => toggleFixedUser(u.id)} />
                {u.full_name || u.email}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Period start *</label>
              <input type="date" value={fixedPeriodStart} onChange={(e) => setFixedPeriodStart(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Period end *</label>
              <input type="date" value={fixedPeriodEnd} onChange={(e) => setFixedPeriodEnd(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Start time *</label>
              <input type="time" value={fixedStartTime} onChange={(e) => setFixedStartTime(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">End time *</label>
              <input type="time" value={fixedEndTime} onChange={(e) => setFixedEndTime(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-600 mb-2">Weekdays</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleFixedWeekday(d.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${fixedWeekdays.includes(d.id) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-surface-300 text-surface-700'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Schedule title</label>
              <input type="text" value={fixedTitle} onChange={(e) => setFixedTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">Notes (optional)</label>
              <input type="text" value={fixedNotes} onChange={(e) => setFixedNotes(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-surface-700">
            <input type="checkbox" checked={fixedSkipExisting} onChange={(e) => setFixedSkipExisting(e.target.checked)} />
            Skip days that already have a shift for that employee
          </label>
          {fixedPreviewCount > 0 && (
            <p className="text-sm text-brand-700 font-medium">
              Will schedule approximately {fixedPreviewCount} day{fixedPreviewCount === 1 ? '' : 's'} ({formatShiftWindow(fixedStartTime, fixedEndTime)})
            </p>
          )}
          <button type="submit" disabled={fixedSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {fixedSaving ? 'Creating…' : 'Create fixed schedules'}
          </button>
        </form>
      )}

      <div className="app-glass-card overflow-hidden">
        <div className="px-4 py-2 border-b border-surface-100 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-surface-700">
            {tab === 'fixed' ? 'Fixed-hour schedules' : 'Rotating shift schedules'}
          </span>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1 text-sm">
            <option value="">All employees</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
        {listSchedules.length === 0 ? (
          <p className="p-4 text-sm text-surface-500">No schedules yet.</p>
        ) : (
          <ul className="divide-y divide-surface-100">
            {(filterUserId ? listSchedules.filter((s) => s.user_id === filterUserId) : listSchedules).map((s) => (
              <li key={s.id} className="px-4 py-3 flex justify-between items-center gap-2">
                <span>
                  <strong>{s.user_name || s.user_email || s.user_id}</strong> — {s.title}{' '}
                  <span className="text-surface-500 text-xs">({formatDate(s.period_start)} to {formatDate(s.period_end)})</span>
                </span>
                {tab === 'shift' && (
                  <button type="button" onClick={() => setSelectedSchedule(selectedSchedule?.id === s.id ? null : s)} className="text-sm text-brand-600 hover:underline shrink-0">
                    {selectedSchedule?.id === s.id ? 'Hide' : 'Add shifts'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {tab === 'shift' && selectedSchedule && (
        <div className="app-glass-card p-4">
          <p className="font-medium text-surface-800 mb-2">
            Add shift to {selectedSchedule.user_name || selectedSchedule.user_email}&apos;s schedule: {selectedSchedule.title}
          </p>
          <form onSubmit={handleAddEntry} className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Date *</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Shift</label>
              <select value={entryShift} onChange={(e) => setEntryShift(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="day">Day ({dayWindow})</option>
                <option value="night">Night ({nightWindow})</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Notes (optional)</label>
              <input type="text" value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Notes" className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={addingEntry} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {addingEntry ? 'Adding…' : 'Add shift'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
