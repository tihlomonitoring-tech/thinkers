import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { profileManagement as pm, downloadAttachmentWithAuth, tasks as tasksApi } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';

const TABS = [
  { id: 'schedule', label: 'Work schedule' },
  { id: 'leave', label: 'Leave application' },
  { id: 'documents', label: 'Employee documents' },
  { id: 'disciplinary', label: 'Disciplinary & rewards' },
  { id: 'queries', label: 'Queries' },
  { id: 'growth', label: 'Growth' },
];

const SHIFT_DAY = '06:00 – 18:00';
const SHIFT_NIGHT = '18:00 – 06:00';

function getDaysInMonth(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const days = last.getDate();
  return { startPad, days, year, month };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

export default function Profile() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('profile');
  const [activeTab, setActiveTab] = useState('schedule');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState([]);
  const [leaveApplications, setLeaveApplications] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [queries, setQueries] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [pipPlans, setPipPlans] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const calendar = useMemo(() => getDaysInMonth(calendarYear, calendarMonth), [calendarYear, calendarMonth]);
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const scheduleByDate = useMemo(() => {
    const map = {};
    scheduleEntries.forEach((e) => {
      const d = e.work_date ? new Date(e.work_date).toISOString().slice(0, 10) : null;
      if (d) map[d] = e;
    });
    return map;
  }, [scheduleEntries]);

  const loadMySchedule = useCallback(() => {
    pm.mySchedule({ month: calendarMonth, year: calendarYear })
      .then((d) => setScheduleEntries(d.entries || []))
      .catch(() => setScheduleEntries([]));
  }, [calendarMonth, calendarYear]);

  useEffect(() => {
    if (activeTab === 'schedule') {
      loadMySchedule();
      pm.scheduleEvents.list(calendarMonth, calendarYear).then((d) => setScheduleEvents(d.events || [])).catch(() => setScheduleEvents([]));
      tasksApi.list({ assigned_to_me: 'true', limit: 100 }).then((d) => setMyTasks(d.tasks || [])).catch(() => setMyTasks([]));
    }
  }, [activeTab, loadMySchedule, calendarMonth, calendarYear]);

  useEffect(() => {
    if (activeTab === 'leave') {
      pm.leave.types().then((d) => setLeaveTypes(d.types || [])).catch(() => setLeaveTypes([]));
      pm.leave.balance().then((d) => setLeaveBalance(d.balance || [])).catch(() => setLeaveBalance([]));
      pm.leave.applications().then((d) => setLeaveApplications(d.applications || [])).catch(() => setLeaveApplications([]));
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'documents') pm.documents.list().then((d) => setDocuments(d.documents || [])).catch(() => setDocuments([]));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'disciplinary') {
      pm.warnings.list().then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]));
      pm.rewards.list().then((d) => setRewards(d.rewards || [])).catch(() => setRewards([]));
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'queries') pm.queries.list().then((d) => setQueries(d.queries || [])).catch(() => setQueries([]));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'growth') {
      pm.evaluations.list().then((d) => setEvaluations(d.evaluations || [])).catch(() => setEvaluations([]));
      pm.pip.list().then((d) => setPipPlans(d.plans || [])).catch(() => setPipPlans([]));
    }
  }, [activeTab]);

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Profile</h2>
            <p className="text-xs text-surface-500 mt-0.5">Your HR hub</p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                  activeTab === tab.id
                    ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                    : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="max-w-6xl mx-auto flex-1">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="flex gap-4 flex-1 min-w-0">
              <div className="flex-1 min-w-0 space-y-6">
              <h1 className="text-xl font-semibold text-surface-900">Work schedule</h1>
              <p className="text-sm text-surface-600">Click a date to see shift details, tasks due, and events in the side panel.</p>
              <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100">
                  <button
                    type="button"
                    onClick={() => {
                      if (calendarMonth === 0) {
                        setCalendarMonth(11);
                        setCalendarYear((y) => y - 1);
                      } else setCalendarMonth((m) => m - 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50"
                  >
                    ← Previous
                  </button>
                  <span className="font-medium text-surface-900">
                    {new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (calendarMonth === 11) {
                        setCalendarMonth(0);
                        setCalendarYear((y) => y + 1);
                      } else setCalendarMonth((m) => m + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50"
                  >
                    Next →
                  </button>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-surface-500 mb-2">
                    {weekDays.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: calendar.startPad }, (_, i) => (
                      <div key={`pad-${i}`} className="aspect-square rounded-lg bg-surface-50" />
                    ))}
                    {Array.from({ length: calendar.days }, (_, i) => {
                      const day = i + 1;
                      const date = new Date(calendarYear, calendarMonth, day);
                      const dateStr = date.toISOString().slice(0, 10);
                      const shift = scheduleByDate[dateStr];
                      const isToday =
                        date.getDate() === new Date().getDate() &&
                        date.getMonth() === new Date().getMonth() &&
                        date.getFullYear() === new Date().getFullYear();
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                      const shiftLabel = shift?.shift_type === 'night' ? SHIFT_NIGHT : shift?.shift_type === 'day' ? SHIFT_DAY : null;
                      const isSelected = selectedScheduleDate === dateStr;
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedScheduleDate((prev) => (prev === dateStr ? null : dateStr))}
                          className={`aspect-square rounded-lg border p-1 flex flex-col items-center justify-center text-xs cursor-pointer transition-colors ${
                            isToday ? 'border-brand-500 bg-brand-50' : 'border-surface-200 bg-white'
                          } ${isWeekend ? 'bg-surface-50' : ''} ${isSelected ? 'ring-2 ring-brand-500 ring-offset-1' : ''} hover:bg-surface-50`}
                        >
                          <span className="text-surface-700 font-medium">{day}</span>
                          {shiftLabel && (
                            <span className={`text-[10px] mt-0.5 ${shift?.shift_type === 'day' ? 'text-amber-700' : 'text-indigo-700'}`}>
                              {shift?.shift_type === 'day' ? 'Day' : 'Night'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-surface-100 flex gap-4 text-xs text-surface-500">
                  <span><span className="inline-block w-3 h-3 rounded bg-amber-200 align-middle mr-1" /> Day: {SHIFT_DAY}</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-indigo-200 align-middle mr-1" /> Night: {SHIFT_NIGHT}</span>
                </div>
              </div>
              </div>
              <ScheduleSidePanel
                selectedDate={selectedScheduleDate}
                onClose={() => setSelectedScheduleDate(null)}
                scheduleEntries={scheduleEntries}
                scheduleEvents={scheduleEvents}
                myTasks={myTasks}
                pipPlans={pipPlans}
              />
            </div>
          )}

          {activeTab === 'leave' && (
            <LeaveTab
              balance={leaveBalance}
              applications={leaveApplications}
              leaveTypes={leaveTypes}
              onRefresh={() => {
                pm.leave.types().then((d) => setLeaveTypes(d.types || []));
                pm.leave.balance().then((d) => setLeaveBalance(d.balance || []));
                pm.leave.applications().then((d) => setLeaveApplications(d.applications || []));
              }}
              onError={setError}
            />
          )}

          {activeTab === 'documents' && (
            <DocumentsTab
              documents={documents}
              onRefresh={() => pm.documents.list().then((d) => setDocuments(d.documents || []))}
              onError={setError}
            />
          )}

          {activeTab === 'disciplinary' && (
            <div className="space-y-6">
              <h1 className="text-xl font-semibold text-surface-900">Disciplinary & rewards</h1>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <p className="text-sm font-medium text-surface-700 mb-2">Warnings & cases</p>
                  {warnings.length === 0 ? (
                    <p className="text-sm text-surface-500">None on record.</p>
                  ) : (
                    <ul className="space-y-2">
                      {warnings.map((w) => (
                        <li key={w.id} className="text-sm border-l-2 border-amber-200 pl-2">
                          <span className="font-medium">{w.warning_type}</span>
                          <span className="text-surface-500 text-xs ml-1">{formatDate(w.created_at)}</span>
                          {w.description && <p className="text-surface-600 mt-0.5">{w.description}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <p className="text-sm font-medium text-surface-700 mb-2">Rewards</p>
                  {rewards.length === 0 ? (
                    <p className="text-sm text-surface-500">None yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {rewards.map((r) => (
                        <li key={r.id} className="text-sm border-l-2 border-emerald-200 pl-2">
                          <span className="font-medium">{r.reward_type}</span>
                          <span className="text-surface-500 text-xs ml-1">{formatDate(r.created_at)}</span>
                          {r.description && <p className="text-surface-600 mt-0.5">{r.description}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'queries' && (
            <QueriesTab
              queries={queries}
              onRefresh={() => pm.queries.list().then((d) => setQueries(d.queries || []))}
              onError={setError}
            />
          )}

          {activeTab === 'growth' && (
            <GrowthTab
              evaluations={evaluations}
              pipPlans={pipPlans}
              onRefreshPip={() => pm.pip.list().then((d) => setPipPlans(d.plans || []))}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GrowthTab({ evaluations, pipPlans, onRefreshPip, onError }) {
  const [pipProgress, setPipProgress] = useState({});
  const [addingProgress, setAddingProgress] = useState(null);
  const [progressDate, setProgressDate] = useState('');
  const [progressNotes, setProgressNotes] = useState('');
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    (pipPlans || []).forEach((p) => {
      pm.pip.getProgress(p.id).then((d) => setPipProgress((prev) => ({ ...prev, [p.id]: d.progress || [] }))).catch(() => {});
    });
  }, [pipPlans]);

  const addProgress = async (pipId) => {
    if (!progressDate) return;
    setAddingProgress(pipId);
    onError('');
    try {
      await pm.pip.addProgress(pipId, { progress_date: progressDate, notes: progressNotes.trim() || undefined });
      setProgressDate('');
      setProgressNotes('');
      pm.pip.getProgress(pipId).then((d) => setPipProgress((prev) => ({ ...prev, [pipId]: d.progress || [] })));
      onRefreshPip();
    } catch (err) {
      onError(err?.message || 'Failed to add progress');
    } finally {
      setAddingProgress(null);
    }
  };

  const downloadPipPdf = (p) => {
    const progress = pipProgress[p.id] || [];
    setDownloading(`pdf-${p.id}`);
    try {
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(14);
      doc.text(p.title, 14, y);
      y += 8;
      doc.setFontSize(10);
      doc.text(`Status: ${p.status}  |  ${formatDate(p.start_date)} – ${formatDate(p.end_date)}`, 14, y);
      y += 8;
      if (p.goals) {
        doc.setFontSize(10);
        doc.text('Goals:', 14, y);
        y += 6;
        doc.setFontSize(9);
        const goalLines = doc.splitTextToSize(p.goals, 180);
        doc.text(goalLines, 14, y);
        y += goalLines.length * 5 + 4;
      }
      if (progress.length > 0) {
        y += 6;
        doc.setFontSize(10);
        doc.text('Progress updates', 14, y);
        y += 6;
        progress.forEach((pr) => {
          doc.setFontSize(9);
          doc.text(`${formatDate(pr.progress_date)}: ${(pr.notes || '—').slice(0, 80)}`, 14, y);
          y += 6;
        });
      }
      doc.save(`pip-${(p.title || 'plan').replace(/[^a-z0-9]/gi, '-')}.pdf`);
    } catch (err) {
      onError(err?.message || 'PDF failed');
    } finally {
      setDownloading(null);
    }
  };

  const downloadPipExcel = async (p) => {
    const progress = pipProgress[p.id] || [];
    setDownloading(`excel-${p.id}`);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('PIP');
      ws.columns = [
        { header: 'Field', key: 'field', width: 20 },
        { header: 'Value', key: 'value', width: 50 },
      ];
      ws.addRows([
        { field: 'Title', value: p.title },
        { field: 'Status', value: p.status },
        { field: 'Start date', value: formatDate(p.start_date) },
        { field: 'End date', value: formatDate(p.end_date) },
        { field: 'Goals', value: (p.goals || '').slice(0, 500) },
      ]);
      if (progress.length > 0) {
        const ws2 = wb.addWorksheet('Progress');
        ws2.columns = [
          { header: 'Date', key: 'progress_date', width: 12 },
          { header: 'Notes', key: 'notes', width: 50 },
        ];
        ws2.addRows(progress);
      }
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = `pip-${(p.title || 'plan').replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      onError(err?.message || 'Excel failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Growth</h1>
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Employee evaluations</p>
          {evaluations.length === 0 ? (
            <p className="text-surface-500 text-sm">No evaluations yet.</p>
          ) : (
            <ul className="space-y-2">
              {evaluations.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.period}</span>
                  {e.rating && <span className="ml-2 text-surface-600">{e.rating}</span>}
                  <span className="text-surface-400 text-xs ml-1">{formatDate(e.created_at)}</span>
                  {e.notes && <p className="text-surface-600 mt-0.5">{e.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-sm font-medium text-surface-700 mb-2">Performance improvement plan</p>
          {(!pipPlans || pipPlans.length === 0) ? (
            <p className="text-surface-500 text-sm">None assigned.</p>
          ) : (
            <ul className="space-y-4">
              {pipPlans.map((p) => (
                <li key={p.id} className="border-b border-surface-100 pb-4 last:border-0">
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-surface-500 text-xs">{p.status} · {formatDate(p.start_date)} – {formatDate(p.end_date)}</span>
                  </div>
                  {p.goals && <p className="text-surface-600 mt-1 text-sm whitespace-pre-wrap">{p.goals}</p>}
                  <div className="mt-2">
                    <p className="text-xs font-medium text-surface-600 mb-1">Progress report</p>
                    {(pipProgress[p.id] || []).length === 0 ? (
                      <p className="text-surface-500 text-xs">No progress entries yet.</p>
                    ) : (
                      <ul className="text-xs space-y-1">
                        {(pipProgress[p.id] || []).map((pr) => (
                          <li key={pr.id}>{formatDate(pr.progress_date)} — {pr.notes || '—'}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2 items-end mt-2">
                      <input type="date" value={progressDate} onChange={(e) => setProgressDate(e.target.value)} className="rounded border border-surface-300 px-2 py-1 text-xs" />
                      <input type="text" value={progressNotes} onChange={(e) => setProgressNotes(e.target.value)} placeholder="Notes" className="rounded border border-surface-300 px-2 py-1 text-xs w-40" />
                      <button type="button" onClick={() => addProgress(p.id)} disabled={addingProgress === p.id || !progressDate} className="px-2 py-1 rounded bg-brand-600 text-white text-xs disabled:opacity-50">Add progress</button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button type="button" onClick={() => downloadPipPdf(p)} disabled={downloading === `pdf-${p.id}`} className="text-xs text-brand-600 hover:underline disabled:opacity-50">Download PDF</button>
                      <button type="button" onClick={() => downloadPipExcel(p)} disabled={downloading === `excel-${p.id}`} className="text-xs text-brand-600 hover:underline disabled:opacity-50">Download Excel</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleSidePanel({ selectedDate, onClose, scheduleEntries, scheduleEvents, myTasks, pipPlans }) {
  if (!selectedDate) {
    return (
      <div className="w-full lg:w-80 shrink-0 bg-surface-50 rounded-xl border border-surface-200 p-4 flex flex-col items-center justify-center text-center text-surface-500 text-sm min-h-[160px]">
        <p>Click a date on the calendar to see shift details, tasks due, and events for that day.</p>
      </div>
    );
  }
  const shift = (scheduleEntries || []).find((e) => e.work_date && new Date(e.work_date).toISOString().slice(0, 10) === selectedDate);
  const tasksOnDate = (myTasks || []).filter((t) => t.due_date && new Date(t.due_date).toISOString().slice(0, 10) === selectedDate);
  const eventsOnDate = (scheduleEvents || []).filter((e) => e.event_date && new Date(e.event_date).toISOString().slice(0, 10) === selectedDate);
  const dateLabel = formatDate(selectedDate);
  return (
    <div className="w-full lg:w-80 shrink-0 bg-white rounded-xl border border-surface-200 overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]">
      <div className="px-4 py-3 border-b border-surface-100 flex justify-between items-center">
        <span className="font-medium text-surface-900">{dateLabel}</span>
        <button type="button" onClick={onClose} className="p-1 rounded text-surface-500 hover:bg-surface-100" aria-label="Close">×</button>
      </div>
      <div className="p-4 overflow-y-auto space-y-4 text-sm">
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Shift</p>
          {shift ? (
            <p className="text-surface-800">
              {shift.shift_type === 'night' ? 'Night' : 'Day'} ({shift.shift_type === 'night' ? SHIFT_NIGHT : SHIFT_DAY})
              {shift.notes && <span className="block text-surface-600 mt-0.5">{shift.notes}</span>}
            </p>
          ) : (
            <p className="text-surface-500">No shift this day</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Tasks due</p>
          {tasksOnDate.length === 0 ? (
            <p className="text-surface-500">None</p>
          ) : (
            <ul className="space-y-1">
              {tasksOnDate.map((t) => (
                <li key={t.id} className="text-surface-800">{t.title}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Company events</p>
          {eventsOnDate.length === 0 ? (
            <p className="text-surface-500">None</p>
          ) : (
            <ul className="space-y-1">
              {eventsOnDate.map((e) => (
                <li key={e.id}>
                  <span className="text-surface-800">{e.title}</span>
                  {e.description && <span className="block text-surface-600 text-xs">{e.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase mb-1">Performance improvement</p>
          {(!pipPlans || pipPlans.length === 0) ? (
            <p className="text-surface-500">None assigned</p>
          ) : (
            <ul className="space-y-1">
              {pipPlans.slice(0, 3).map((p) => (
                <li key={p.id} className="text-surface-800">{p.title} <span className="text-surface-500">— {p.status}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LeaveTab({ balance, applications, leaveTypes = [], onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState('');
  const [leaveTypeOther, setLeaveTypeOther] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

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

  const year = new Date().getFullYear();
  const balanceByType = balance.reduce((acc, b) => {
    acc[b.leave_type] = { total: b.total_days, used: b.used_days, remaining: (b.total_days || 0) - (b.used_days || 0) };
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Leave application</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Leave balance ({year})</p>
          {balance.length === 0 ? (
            <p className="mt-1 text-surface-500 text-sm">No balance on record</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {balance.map((b) => (
                <li key={`${b.leave_type}-${b.year}`}>
                  <span className="font-medium">{b.leave_type}</span>: {(b.total_days || 0) - (b.used_days || 0)} days remaining
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="md:col-span-2 bg-white rounded-xl border border-surface-200 p-4">
          {!showForm ? (
            <>
              <p className="text-sm font-medium text-surface-700 mb-2">Apply for leave</p>
              <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                New leave application
              </button>
            </>
          ) : (
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
          )}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-surface-200 p-4">
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
                a.download = `leave-history-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    </div>
  );
}

function DocumentsTab({ documents, onRefresh, onError }) {
  const [uploading, setUploading] = useState(false);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    onError('');
    pm.documents.upload(file)
      .then(() => { onRefresh(); e.target.value = ''; })
      .catch((err) => onError(err?.message || 'Upload failed'))
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Employee documents</h1>
      <p className="text-sm text-surface-600">Your document library.</p>
      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <label className="inline-block">
          <span className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 cursor-pointer inline-block">
            {uploading ? 'Uploading…' : 'Upload document'}
          </span>
          <input type="file" className="sr-only" onChange={handleFile} disabled={uploading} />
        </label>
      </div>
      {documents.length === 0 ? (
        <p className="text-surface-500 text-sm">No documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span>{d.file_name}</span>
              <button
                type="button"
                onClick={() => downloadAttachmentWithAuth(pm.documents.downloadUrl(d.id), d.file_name).catch((err) => onError(err?.message))}
                className="text-brand-600 hover:underline"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueriesTab({ queries, onRefresh, onError }) {
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) {
      onError('Subject is required');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await pm.queries.create({ subject: subject.trim(), body: body.trim() || undefined });
      setShowForm(false);
      setSubject('');
      setBody('');
      onRefresh();
    } catch (err) {
      onError(err?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Queries</h1>
      <p className="text-sm text-surface-600">Submit grievances or complaints. Track status and responses.</p>
      {!showForm ? (
        <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
          Submit a query
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-surface-200 p-4 space-y-3 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Subject *</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Details</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
          </div>
        </form>
      )}
      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <p className="text-sm font-medium text-surface-700 mb-2">My queries</p>
        {queries.length === 0 ? (
          <p className="text-sm text-surface-500">No queries submitted yet.</p>
        ) : (
          <ul className="space-y-3">
            {queries.map((q) => (
              <li key={q.id} className="border-b border-surface-100 pb-3">
                <p className="font-medium">{q.subject}</p>
                <p className="text-surface-600 text-sm mt-0.5">{q.body}</p>
                <p className="text-xs text-surface-500 mt-1">{formatDate(q.created_at)} — <span className={q.status === 'closed' ? 'text-emerald-600' : 'text-amber-600'}>{q.status}</span></p>
                {q.response_text && <p className="text-sm mt-2 p-2 bg-surface-50 rounded">Response: {q.response_text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
