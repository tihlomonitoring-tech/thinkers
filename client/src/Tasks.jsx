import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { tasks as tasksApi, openAttachmentWithAuth, downloadAttachmentWithAuth } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import InfoHint from './components/InfoHint.jsx';
import {
  TASK_PROGRESS_LEGEND_OPTIONS,
  taskLegendSurfaceClass,
  taskLegendDotClass,
  taskLegendLabel,
} from './lib/taskProgressLegend.js';
import TaskColourLegend from './components/TaskColourLegend.jsx';

const TABS = [
  { id: 'list', label: 'Task list', section: 'Workspace' },
  { id: 'board', label: 'Tasks board', section: 'Workspace' },
  { id: 'create', label: 'Create task', section: 'Tasks' },
  { id: 'library', label: 'Library', section: 'Library' },
];

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TASK_CATEGORIES = [
  { value: 'sales', label: 'Sales' },
  { value: 'departmental', label: 'Departmental' },
  { value: 'thinkers_afrika', label: 'Thinkers Afrika company' },
];

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function StatusBadge({ status }) {
  const styles = {
    not_started: 'bg-surface-100 text-surface-700',
    in_progress: 'bg-amber-100 text-amber-800',
    completed: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  const label = STATUS_OPTIONS.find((o) => o.value === status)?.label || status;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.not_started}`}>{label}</span>;
}

function CategoryBadge({ category }) {
  const c = category || 'departmental';
  const styles = {
    sales: 'bg-violet-100 text-violet-900 ring-1 ring-violet-200',
    departmental: 'bg-sky-100 text-sky-900 ring-1 ring-sky-200',
    thinkers_afrika: 'bg-amber-100 text-amber-950 ring-1 ring-amber-200',
  };
  const label = TASK_CATEGORIES.find((o) => o.value === c)?.label || c;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[c] || styles.departmental}`}>{label}</span>;
}

export default function Tasks() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('tasks');
  const [activeTab, setActiveTab] = useState('list');
  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [taskListView, setTaskListView] = useState('all'); // my_tasks | all | by_user | created_by_me
  const [taskListUserId, setTaskListUserId] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskSearchSubmit, setTaskSearchSubmit] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [taskDueFrom, setTaskDueFrom] = useState('');
  const [taskDueTo, setTaskDueTo] = useState('');
  const [taskStartFrom, setTaskStartFrom] = useState('');
  const [taskStartTo, setTaskStartTo] = useState('');
  const [filterLeaderId, setFilterLeaderId] = useState('');
  const [filterReviewerId, setFilterReviewerId] = useState('');
  const [taskSort, setTaskSort] = useState('due_asc');
  const [listPage, setListPage] = useState(1);
  const [showAdvancedTaskFilters, setShowAdvancedTaskFilters] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [detailTask, setDetailTask] = useState(null);
  const [tenantUsers, setTenantUsers] = useState([]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const pageNum = activeTab === 'board' ? 1 : listPage;
      const limitNum = activeTab === 'board' ? 100 : 50;
      const params = { page: pageNum, limit: limitNum, sort: taskSort };
      if (taskListView === 'my_tasks') params.assigned_to_me = 'true';
      if (taskListView === 'created_by_me') params.created_by_me = 'true';
      if (taskListView === 'by_user' && taskListUserId) params.user_id = taskListUserId;
      if (filterStatus && filterStatus !== 'all') params.status = filterStatus;
      if (filterCategory && filterCategory !== 'all') params.category = filterCategory;
      if (taskSearchSubmit.trim()) params.search = taskSearchSubmit.trim();
      if (taskDueFrom) params.due_from = taskDueFrom;
      if (taskDueTo) params.due_to = taskDueTo;
      if (taskStartFrom) params.start_from = taskStartFrom;
      if (taskStartTo) params.start_to = taskStartTo;
      if (filterLeaderId) params.leader_id = filterLeaderId;
      if (filterReviewerId) params.reviewer_id = filterReviewerId;
      const data = await tasksApi.list(params);
      setTasks(data.tasks || []);
      setPagination(data.pagination || { page: 1, limit: 50, total: 0 });
    } catch (e) {
      setError(e?.message || 'Failed to load tasks');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    listPage,
    taskSort,
    taskListView,
    taskListUserId,
    filterStatus,
    filterCategory,
    taskSearchSubmit,
    taskDueFrom,
    taskDueTo,
    taskStartFrom,
    taskStartTo,
    filterLeaderId,
    filterReviewerId,
  ]);

  useEffect(() => {
    setListPage(1);
  }, [taskListView, taskListUserId, filterStatus, filterCategory, taskDueFrom, taskDueTo, taskStartFrom, taskStartTo, filterLeaderId, filterReviewerId, taskSort]);

  useEffect(() => {
    if (activeTab === 'list' || activeTab === 'board' || selectedTaskId) loadTasks();
  }, [activeTab, loadTasks, selectedTaskId, listPage]);

  useEffect(() => {
    if (activeTab === 'create' || activeTab === 'list' || activeTab === 'board') {
      tasksApi.tenantUsers().then((d) => setTenantUsers(d.users || [])).catch(() => setTenantUsers([]));
    }
  }, [activeTab]);

  const refreshDetailTask = useCallback(() => {
    if (selectedTaskId) {
      tasksApi.get(selectedTaskId).then((d) => setDetailTask(d.task)).catch(() => setDetailTask(null));
    }
  }, [selectedTaskId]);

  const clearTaskFilters = useCallback(() => {
    setTaskSearch('');
    setTaskSearchSubmit('');
    setFilterStatus('all');
    setFilterCategory('all');
    setTaskDueFrom('');
    setTaskDueTo('');
    setTaskStartFrom('');
    setTaskStartTo('');
    setFilterLeaderId('');
    setFilterReviewerId('');
    setTaskListView('all');
    setTaskListUserId('');
    setListPage(1);
    setTaskSort('due_asc');
  }, []);

  const handleUpdateLeaderReviewer = async (taskId, payload) => {
    try {
      await tasksApi.update(taskId, payload);
      if (detailTask?.id === taskId) {
        const d = await tasksApi.get(taskId);
        setDetailTask(d.task);
      }
      setError('');
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  const handleUpdateProgressLegend = async (taskId, progress_legend) => {
    try {
      await tasksApi.update(taskId, { progress_legend });
      if (detailTask?.id === taskId) {
        const d = await tasksApi.get(taskId);
        setDetailTask(d.task);
      }
      setError('');
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  useEffect(() => {
    if (selectedTaskId) {
      tasksApi.get(selectedTaskId).then((d) => setDetailTask(d.task)).catch(() => setDetailTask(null));
    } else {
      setDetailTask(null);
    }
  }, [selectedTaskId]);

  const handleUpdateProgress = async (taskId, progress, progressNote) => {
    try {
      await tasksApi.update(taskId, { progress, progress_note: progressNote || undefined });
      if (detailTask?.id === taskId) setDetailTask((t) => (t ? { ...t, progress } : null));
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  const handleUpdateStatus = async (taskId, status) => {
    try {
      const data = await tasksApi.update(taskId, { status });
      if (detailTask?.id === taskId) setDetailTask((t) => (t ? { ...t, status: data.task?.status, completed_at: data.task?.completed_at } : null));
      setError('');
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Update failed');
    }
  };

  const handleTransfer = async (taskId, fromUserId, toUserId) => {
    try {
      await tasksApi.assign(taskId, { transfer_from_user_id: fromUserId, transfer_to_user_id: toUserId });
      if (detailTask?.id === taskId) {
        const d = await tasksApi.get(taskId);
        setDetailTask(d.task);
      }
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Transfer failed');
    }
  };

  const handleAddAssignees = async (taskId, userIds) => {
    try {
      await tasksApi.assign(taskId, { user_ids: userIds });
      if (detailTask?.id === taskId) {
        const d = await tasksApi.get(taskId);
        setDetailTask(d.task);
      }
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Assign failed');
    }
  };

  const handleUploadAttachment = async (taskId, file) => {
    try {
      await tasksApi.uploadAttachment(taskId, file);
      if (detailTask?.id === taskId) {
        const d = await tasksApi.get(taskId);
        setDetailTask(d.task);
      }
    } catch (e) {
      setError(e?.message || 'Upload failed');
    }
  };

  const handleAddProgressUpdate = async (taskId, progress, note) => {
    try {
      await tasksApi.addProgressUpdate(taskId, { progress, note: note || undefined });
      refreshDetailTask();
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Failed to log progress');
    }
  };

  const handleAddComment = async (taskId, body, files = []) => {
    try {
      const res = await tasksApi.addComment(taskId, { body });
      if (res?.comment?.id && files?.length) {
        await tasksApi.addCommentAttachments(taskId, res.comment.id, files);
      }
      refreshDetailTask();
      loadTasks();
    } catch (e) {
      setError(e?.message || 'Failed to add comment');
    }
  };

  const handleAddReminder = async (taskId, remind_at, note) => {
    try {
      await tasksApi.addReminder(taskId, { remind_at, note: note || undefined });
      refreshDetailTask();
    } catch (e) {
      setError(e?.message || 'Failed to add reminder');
    }
  };

  const handleDismissReminder = async (taskId, reminderId) => {
    try {
      await tasksApi.dismissReminder(taskId, reminderId);
      refreshDetailTask();
    } catch (e) {
      setError(e?.message || 'Failed to dismiss reminder');
    }
  };

  const assignedToMeCount = tasks.filter((t) => t.assignees?.some((a) => a.user_id === user?.id)).length;
  const createdByMeCount = tasks.filter((t) => t.created_by === user?.id).length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="flex gap-0 w-full min-h-0 flex-1 -m-4 sm:-m-6 overflow-hidden">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Tasks tracker</h2>
            <p className="text-xs text-surface-500 mt-0.5">Plan, assign, follow up.</p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 min-h-0 w-72">
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={() => { setActiveTab('create'); setSelectedTaskId(null); }}
              className="w-full py-2.5 px-3 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 shadow-sm"
            >
              + New task
            </button>
          </div>
          <div className="mb-4">
            <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">Workspace</p>
            <ul className="space-y-0.5">
              {TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => { setActiveTab(tab.id); setSelectedTaskId(null); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                      activeTab === tab.id ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium' : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                    }`}
                  >
                    <span className="min-w-0 break-words">{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {(activeTab === 'list' || activeTab === 'board') && (
            <div className="px-4 py-3 border-t border-surface-100">
              <button
                type="button"
                onClick={() => setShowAdvancedTaskFilters((v) => !v)}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {showAdvancedTaskFilters ? 'Hide advanced filters' : 'Show advanced filters'}
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 scrollbar-thin flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1 min-w-0">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {activeTab === 'list' && (
            <TabTaskList
              tasks={tasks}
              loading={loading}
              pagination={pagination}
              listPage={listPage}
              setListPage={setListPage}
              taskListView={taskListView}
              setTaskListView={setTaskListView}
              taskListUserId={taskListUserId}
              setTaskListUserId={setTaskListUserId}
              taskSearch={taskSearch}
              setTaskSearch={setTaskSearch}
              onApplySearch={() => { setListPage(1); setTaskSearchSubmit(taskSearch); }}
              onClearFilters={clearTaskFilters}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              filterCategory={filterCategory}
              setFilterCategory={setFilterCategory}
              taskDueFrom={taskDueFrom}
              setTaskDueFrom={setTaskDueFrom}
              taskDueTo={taskDueTo}
              setTaskDueTo={setTaskDueTo}
              taskStartFrom={taskStartFrom}
              setTaskStartFrom={setTaskStartFrom}
              taskStartTo={taskStartTo}
              setTaskStartTo={setTaskStartTo}
              filterLeaderId={filterLeaderId}
              setFilterLeaderId={setFilterLeaderId}
              filterReviewerId={filterReviewerId}
              setFilterReviewerId={setFilterReviewerId}
              taskSort={taskSort}
              setTaskSort={setTaskSort}
              showAdvancedTaskFilters={showAdvancedTaskFilters}
              assignedToMeCount={assignedToMeCount}
              createdByMeCount={createdByMeCount}
              completedCount={completedCount}
              onSelectTask={setSelectedTaskId}
              selectedTaskId={selectedTaskId}
              detailTask={detailTask}
              onCloseDetail={() => setSelectedTaskId(null)}
              onUpdateProgress={handleUpdateProgress}
              onUpdateStatus={handleUpdateStatus}
              onTransfer={handleTransfer}
              onAddAssignees={handleAddAssignees}
              onUploadAttachment={handleUploadAttachment}
              onRefreshDetail={refreshDetailTask}
              onAddProgressUpdate={handleAddProgressUpdate}
              onAddComment={handleAddComment}
              onAddReminder={handleAddReminder}
              onDismissReminder={handleDismissReminder}
              onUpdateCategory={async (taskId, category) => {
                try {
                  await tasksApi.update(taskId, { category });
                  loadTasks();
                  if (detailTask?.id === taskId) {
                    const d = await tasksApi.get(taskId);
                    setDetailTask(d.task);
                  }
                } catch (e) {
                  setError(e?.message || 'Update failed');
                }
              }}
              onUpdateLeaderReviewer={handleUpdateLeaderReviewer}
              onUpdateProgressLegend={handleUpdateProgressLegend}
              currentUserId={user?.id}
              tenantUsers={tenantUsers}
              onNewTask={() => setActiveTab('create')}
            />
          )}

          {activeTab === 'board' && (
            <TabTasksBoard
              tasks={tasks}
              loading={loading}
              tenantUsers={tenantUsers}
              onSelectTask={(id) => {
                setSelectedTaskId(id);
                setActiveTab('list');
              }}
              onNewTask={() => setActiveTab('create')}
              loadTasks={loadTasks}
              showAdvancedTaskFilters={showAdvancedTaskFilters}
              taskListView={taskListView}
              setTaskListView={setTaskListView}
              taskListUserId={taskListUserId}
              setTaskListUserId={setTaskListUserId}
              taskSearch={taskSearch}
              setTaskSearch={setTaskSearch}
              onApplySearch={() => { setListPage(1); setTaskSearchSubmit(taskSearch); }}
              onClearFilters={clearTaskFilters}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              filterCategory={filterCategory}
              setFilterCategory={setFilterCategory}
              taskDueFrom={taskDueFrom}
              setTaskDueFrom={setTaskDueFrom}
              taskDueTo={taskDueTo}
              setTaskDueTo={setTaskDueTo}
              taskStartFrom={taskStartFrom}
              setTaskStartFrom={setTaskStartFrom}
              taskStartTo={taskStartTo}
              setTaskStartTo={setTaskStartTo}
              filterLeaderId={filterLeaderId}
              setFilterLeaderId={setFilterLeaderId}
              filterReviewerId={filterReviewerId}
              setFilterReviewerId={setFilterReviewerId}
              taskSort={taskSort}
              setTaskSort={setTaskSort}
            />
          )}

          {activeTab === 'create' && (
            <TabCreateTask
              tenantUsers={tenantUsers}
              onCreated={(task) => { setActiveTab('list'); setSelectedTaskId(task?.id); loadTasks(); }}
              onCancel={() => setActiveTab('list')}
            />
          )}

          {activeTab === 'library' && <TabLibrary />}
        </div>
      </div>
    </div>
  );
}

function BoardTaskCard({ task, onSelectTask }) {
  const stripe = taskLegendSurfaceClass(task.progress_legend);
  return (
    <button
      type="button"
      onClick={() => onSelectTask(task.id)}
      className={`w-full text-left rounded-lg border-y border-r border-surface-200/70 pl-2 pr-2.5 py-2.5 shadow-sm hover:border-brand-300/80 hover:shadow transition ${stripe}`}
    >
      <p className="text-sm font-medium text-surface-900 line-clamp-2">{task.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <CategoryBadge category={task.category} />
        <StatusBadge status={task.status} />
      </div>
      <p className="text-[11px] text-surface-500 mt-1">Due {formatDate(task.due_date)}</p>
    </button>
  );
}

function TabTasksBoard({
  tasks,
  loading,
  tenantUsers,
  onSelectTask,
  onNewTask,
  loadTasks,
  showAdvancedTaskFilters,
  taskListView,
  setTaskListView,
  taskListUserId,
  setTaskListUserId,
  taskSearch,
  setTaskSearch,
  onApplySearch,
  onClearFilters,
  filterStatus,
  setFilterStatus,
  filterCategory,
  setFilterCategory,
  taskDueFrom,
  setTaskDueFrom,
  taskDueTo,
  setTaskDueTo,
  taskStartFrom,
  setTaskStartFrom,
  taskStartTo,
  setTaskStartTo,
  filterLeaderId,
  setFilterLeaderId,
  filterReviewerId,
  setFilterReviewerId,
  taskSort,
  setTaskSort,
}) {
  const { lanes, userOrder, unassigned, otherAssignees } = useMemo(() => {
    const q = tenantUsers || [];
    const boardUserIds = new Set(q.map((u) => u.id));
    const byUser = {};
    q.forEach((u) => {
      byUser[u.id] = [];
    });
    const unassignedList = [];
    const otherList = [];
    for (const t of tasks || []) {
      const as = t.assignees || [];
      if (!as.length) {
        unassignedList.push(t);
        continue;
      }
      if (as.every((a) => !boardUserIds.has(a.user_id))) {
        otherList.push(t);
        continue;
      }
      const seen = new Set();
      as.forEach((a) => {
        if (byUser[a.user_id] && !seen.has(`${t.id}-${a.user_id}`)) {
          byUser[a.user_id].push(t);
          seen.add(`${t.id}-${a.user_id}`);
        }
      });
    }
    return { lanes: byUser, userOrder: q, unassigned: unassignedList, otherAssignees: otherList };
  }, [tasks, tenantUsers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Tasks board</h1>
          <p className="text-sm text-surface-600 mt-1 max-w-2xl">
            One column per teammate who has access to Tasks. Assignees without that access appear under “Other assignees”. Filters match the task list.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => loadTasks()} className="px-3 py-2 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50">
            Refresh
          </button>
          <button type="button" onClick={onNewTask} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
            New task
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {[
          { id: 'my_tasks', label: 'My tasks' },
          { id: 'all', label: 'All tasks' },
          { id: 'by_user', label: 'By user' },
          { id: 'created_by_me', label: 'Created by me' },
        ].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setTaskListView(v.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              taskListView === v.id ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {taskListView === 'by_user' && (
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-surface-500 mb-1">Assignee</label>
          <select
            value={taskListUserId}
            onChange={(e) => setTaskListUserId(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          >
            <option value="">Select user…</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl border border-surface-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="search"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onApplySearch()}
            placeholder="Search title or description…"
            className="flex-1 min-w-0 rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={onApplySearch} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
              Search
            </button>
            <button type="button" onClick={onClearFilters} className="px-4 py-2 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50">
              Clear filters
            </button>
          </div>
        </div>
        {showAdvancedTaskFilters && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pt-2 border-t border-surface-100">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="all">All</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Category</label>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="all">All categories</option>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Task leader</label>
              <select value={filterLeaderId} onChange={(e) => setFilterLeaderId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="">Any</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Task reviewer</label>
              <select value={filterReviewerId} onChange={(e) => setFilterReviewerId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="">Any</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Start from</label>
              <input type="date" value={taskStartFrom} onChange={(e) => setTaskStartFrom(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Start to</label>
              <input type="date" value={taskStartTo} onChange={(e) => setTaskStartTo(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Due from</label>
              <input type="date" value={taskDueFrom} onChange={(e) => setTaskDueFrom(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Due to</label>
              <input type="date" value={taskDueTo} onChange={(e) => setTaskDueTo(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2 xl:col-span-3">
              <label className="block text-xs font-medium text-surface-500 mb-1">Sort by</label>
              <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)} className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="due_asc">Due date (earliest first)</option>
                <option value="due_desc">Due date (latest first)</option>
                <option value="created">Recently created</option>
                <option value="start_asc">Start date</option>
              </select>
            </div>
          </div>
        )}
        <TaskColourLegend className="pt-3 border-t border-surface-100" />
      </div>

      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 items-start">
          {userOrder.map((u) => (
            <div key={u.id} className="shrink-0 w-64 bg-surface-50 rounded-xl border border-surface-200 flex flex-col max-h-[70vh]">
              <div className="px-3 py-2 border-b border-surface-200 bg-white rounded-t-xl">
                <p className="font-medium text-surface-900 truncate">{u.full_name || 'User'}</p>
                <p className="text-xs text-surface-500 truncate">{u.email}</p>
                <p className="text-xs text-brand-600 mt-1">{(lanes[u.id] || []).length} task(s)</p>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-0">
                {(lanes[u.id] || []).length === 0 ? (
                  <p className="text-xs text-surface-500 px-1 py-4 text-center">No tasks in this lane.</p>
                ) : (
                  (lanes[u.id] || []).map((t) => (
                    <BoardTaskCard key={`${t.id}-${u.id}`} task={t} onSelectTask={onSelectTask} />
                  ))
                )}
              </div>
            </div>
          ))}
          <div className="shrink-0 w-64 bg-surface-50 rounded-xl border border-amber-200 flex flex-col max-h-[70vh]">
            <div className="px-3 py-2 border-b border-amber-100 bg-amber-50/80 rounded-t-xl">
              <p className="font-medium text-surface-900">Other assignees</p>
              <p className="text-xs text-surface-600">No assignee has Tasks page access</p>
              <p className="text-xs text-brand-600 mt-1">{otherAssignees.length} task(s)</p>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-0">
              {otherAssignees.length === 0 ? (
                <p className="text-xs text-surface-500 px-1 py-4 text-center">None.</p>
              ) : (
                otherAssignees.map((t) => (
                  <BoardTaskCard key={t.id} task={t} onSelectTask={onSelectTask} />
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 w-64 bg-surface-50 rounded-xl border border-dashed border-surface-300 flex flex-col max-h-[70vh]">
            <div className="px-3 py-2 border-b border-surface-200 bg-white/80 rounded-t-xl">
              <p className="font-medium text-surface-900">Queue (unassigned)</p>
              <p className="text-xs text-surface-500">No assignee yet</p>
              <p className="text-xs text-brand-600 mt-1">{unassigned.length} task(s)</p>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-0">
              {unassigned.length === 0 ? (
                <p className="text-xs text-surface-500 px-1 py-4 text-center">No unassigned tasks.</p>
              ) : (
                unassigned.map((t) => (
                  <BoardTaskCard key={t.id} task={t} onSelectTask={onSelectTask} />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabTaskList({
  tasks,
  loading,
  pagination,
  listPage,
  setListPage,
  taskListView,
  setTaskListView,
  taskListUserId,
  setTaskListUserId,
  taskSearch,
  setTaskSearch,
  onApplySearch,
  onClearFilters,
  filterStatus,
  setFilterStatus,
  filterCategory,
  setFilterCategory,
  taskDueFrom,
  setTaskDueFrom,
  taskDueTo,
  setTaskDueTo,
  taskStartFrom,
  setTaskStartFrom,
  taskStartTo,
  setTaskStartTo,
  filterLeaderId,
  setFilterLeaderId,
  filterReviewerId,
  setFilterReviewerId,
  taskSort,
  setTaskSort,
  showAdvancedTaskFilters,
  assignedToMeCount,
  createdByMeCount,
  completedCount,
  onSelectTask,
  selectedTaskId,
  detailTask,
  onCloseDetail,
  onUpdateProgress,
  onUpdateStatus,
  onTransfer,
  onAddAssignees,
  onUploadAttachment,
  onRefreshDetail,
  onAddProgressUpdate,
  onAddComment,
  onAddReminder,
  onDismissReminder,
  onUpdateCategory,
  onUpdateLeaderReviewer,
  onUpdateProgressLegend,
  currentUserId,
  tenantUsers,
  onNewTask,
}) {
  const [assigneeModal, setAssigneeModal] = useState(null);
  const [transferModal, setTransferModal] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const total = pagination?.total ?? tasks.length;
  const totalPages = Math.max(1, Math.ceil((pagination?.total || 0) / (pagination?.limit || 50)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Tasks</h1>
          <InfoHint
            title="Tasks"
            text="Filter by scope, category, status, start and due dates, task leader and reviewer, and search. Assignee and board columns only list people who have the Tasks page role."
          />
        </div>
        <button type="button" onClick={onNewTask} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 shadow-sm">
          New task
        </button>
      </div>

      <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {[
          { id: 'my_tasks', label: 'My tasks' },
          { id: 'all', label: 'All tasks' },
          { id: 'by_user', label: 'By user' },
          { id: 'created_by_me', label: 'Created by me' },
        ].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setTaskListView(v.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              taskListView === v.id ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {taskListView === 'by_user' && (
        <div className="max-w-xs">
          <label className="block text-xs font-medium text-surface-500 mb-1">Assignee</label>
          <select
            value={taskListUserId}
            onChange={(e) => setTaskListUserId(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          >
            <option value="">Select user…</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Matching total</p>
          <p className="mt-1 text-2xl font-semibold text-surface-900">{total}</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Assigned to me (page)</p>
          <p className="mt-1 text-2xl font-semibold text-surface-900">{assignedToMeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Created by me (page)</p>
          <p className="mt-1 text-2xl font-semibold text-surface-900">{createdByMeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-4">
          <p className="text-xs font-medium text-surface-500 uppercase">Completed (page)</p>
          <p className="mt-1 text-2xl font-semibold text-surface-900">{completedCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="search"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onApplySearch()}
            placeholder="Search title or description…"
            className="flex-1 min-w-0 rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={onApplySearch} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
              Search
            </button>
            <button type="button" onClick={onClearFilters} className="px-4 py-2 rounded-lg border border-surface-300 text-sm text-surface-700 hover:bg-surface-50">
              Clear filters
            </button>
          </div>
        </div>
        {showAdvancedTaskFilters && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pt-2 border-t border-surface-100">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="all">All</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Category</label>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="all">All categories</option>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Task leader</label>
              <select value={filterLeaderId} onChange={(e) => setFilterLeaderId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="">Any</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Task reviewer</label>
              <select value={filterReviewerId} onChange={(e) => setFilterReviewerId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="">Any</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Start from</label>
              <input type="date" value={taskStartFrom} onChange={(e) => setTaskStartFrom(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Start to</label>
              <input type="date" value={taskStartTo} onChange={(e) => setTaskStartTo(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Due from</label>
              <input type="date" value={taskDueFrom} onChange={(e) => setTaskDueFrom(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Due to</label>
              <input type="date" value={taskDueTo} onChange={(e) => setTaskDueTo(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2 xl:col-span-3">
              <label className="block text-xs font-medium text-surface-500 mb-1">Sort by</label>
              <select value={taskSort} onChange={(e) => setTaskSort(e.target.value)} className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="due_asc">Due date (earliest first)</option>
                <option value="due_desc">Due date (latest first)</option>
                <option value="created">Recently created</option>
                <option value="start_asc">Start date</option>
              </select>
            </div>
          </div>
        )}
        <TaskColourLegend className="pt-3 border-t border-surface-100" />
      </div>

      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-surface-700 w-8"></th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Title</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Category</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Status</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Progress</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Colour</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Leader</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Reviewer</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Start</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Due</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Assignees</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {tasks.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-surface-500">No tasks match your filters.</td></tr>
              ) : (
                tasks.map((t) => (
                  <tr
                    key={t.id}
                    className={`hover:bg-surface-50/90 cursor-pointer border-y border-r border-surface-100/80 ${taskLegendSurfaceClass(t.progress_legend)} ${selectedTaskId === t.id ? 'ring-1 ring-inset ring-brand-400/50' : ''}`}
                    onClick={() => onSelectTask(selectedTaskId === t.id ? null : t.id)}
                  >
                    <td className="px-4 py-2">
                      {t.status === 'completed' ? (
                        <span className="text-emerald-600" title="Completed">✓</span>
                      ) : (
                        <span className="text-surface-300">○</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium text-surface-900 max-w-[220px]">
                      <span className="line-clamp-2">{t.title}</span>
                    </td>
                    <td className="px-4 py-2"><CategoryBadge category={t.category} /></td>
                    <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-2 text-surface-600">{t.progress}%</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 text-surface-700" title={taskLegendLabel(t.progress_legend)}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${taskLegendDotClass(t.progress_legend)}`} aria-hidden />
                        <span className="text-xs truncate max-w-[7rem]">{taskLegendLabel(t.progress_legend)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-surface-600 max-w-[100px] truncate" title={t.task_leader_name || ''}>{t.task_leader_name || '—'}</td>
                    <td className="px-4 py-2 text-surface-600 max-w-[100px] truncate" title={t.task_reviewer_name || ''}>{t.task_reviewer_name || '—'}</td>
                    <td className="px-4 py-2 text-surface-600">{formatDate(t.start_date)}</td>
                    <td className="px-4 py-2 text-surface-600">{formatDate(t.due_date)}</td>
                    <td className="px-4 py-2 text-surface-600 max-w-[160px]">
                      <span className="line-clamp-2">{(t.assignees || []).map((a) => a.full_name).join(', ') || '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-surface-100 flex flex-wrap justify-between gap-2 text-sm text-surface-600">
            <span>
              Page {listPage} of {totalPages} · {total} task(s)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={listPage <= 1}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded border border-surface-300 disabled:opacity-40 hover:bg-surface-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={listPage >= totalPages}
                onClick={() => setListPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-surface-300 disabled:opacity-40 hover:bg-surface-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {detailTask && (
        <TaskDetailPanel
          task={detailTask}
          onClose={onCloseDetail}
          onUpdateProgress={onUpdateProgress}
          onUpdateStatus={onUpdateStatus}
          onTransfer={onTransfer}
          onAddAssignees={onAddAssignees}
          onUploadAttachment={onUploadAttachment}
          onRefreshDetail={onRefreshDetail}
          onAddProgressUpdate={onAddProgressUpdate}
          onAddComment={onAddComment}
          onAddReminder={onAddReminder}
          onDismissReminder={onDismissReminder}
          onUpdateCategory={onUpdateCategory}
          onUpdateLeaderReviewer={onUpdateLeaderReviewer}
          onUpdateProgressLegend={onUpdateProgressLegend}
          currentUserId={currentUserId}
          tenantUsers={tenantUsers}
          assigneeModal={assigneeModal}
          setAssigneeModal={setAssigneeModal}
          transferModal={transferModal}
          setTransferModal={setTransferModal}
          uploadingFile={uploadingFile}
          setUploadingFile={setUploadingFile}
        />
      )}
    </div>
  );
}

function TaskDetailPanel({
  task,
  onClose,
  onUpdateProgress,
  onUpdateStatus,
  onTransfer,
  onAddAssignees,
  onUploadAttachment,
  onRefreshDetail,
  onAddProgressUpdate,
  onAddComment,
  onAddReminder,
  onDismissReminder,
  onUpdateCategory,
  onUpdateLeaderReviewer,
  onUpdateProgressLegend,
  currentUserId,
  tenantUsers,
  assigneeModal,
  setAssigneeModal,
  transferModal,
  setTransferModal,
  uploadingFile,
  setUploadingFile,
}) {
  const isAssignee = (task.assignees || []).some((a) => a.user_id === currentUserId);
  const progressUpdates = task.progress_updates || [];
  const comments = task.comments || [];
  const reminders = task.reminders || [];

  const [progressNote, setProgressNote] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentFiles, setCommentFiles] = useState([]);
  const [remindAt, setRemindAt] = useState('');
  const [remindNote, setRemindNote] = useState('');
  const [savingProgress, setSavingProgress] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);

  const keyActions = Array.isArray(task.key_actions) ? task.key_actions : (task.key_actions ? (typeof task.key_actions === 'string' ? (() => { try { return JSON.parse(task.key_actions); } catch { return []; } })() : []) : []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-2xl bg-white shadow-xl overflow-y-auto flex flex-col max-h-full">
        <div className="sticky top-0 bg-white border-b border-surface-200 px-4 py-3 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-semibold text-surface-900">Task details</h2>
          <button type="button" onClick={onClose} className="text-surface-500 hover:text-surface-700 p-1">✕</button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-sm text-surface-500">Title</p>
            <p className="font-medium text-surface-900">{task.title}</p>
          </div>
          {task.description && (
            <div>
              <p className="text-sm text-surface-500">Description</p>
              <p className="text-surface-700 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}
          {keyActions.length > 0 && (
            <div>
              <p className="text-sm text-surface-500 mb-1">Key actions</p>
              <ul className="list-disc list-inside space-y-1 text-surface-700">
                {keyActions.map((action, i) => (
                  <li key={i}>{typeof action === 'string' ? action : action?.text || action}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-surface-500">Start date</p>
              <p className="text-surface-700">{formatDate(task.start_date)}</p>
            </div>
            <div>
              <p className="text-sm text-surface-500">Due date</p>
              <p className="text-surface-700">{formatDate(task.due_date)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-surface-500 mb-1">Category</p>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={task.category} />
              {onUpdateCategory && (
                <select
                  value={task.category || 'departmental'}
                  onChange={(e) => onUpdateCategory(task.id, e.target.value)}
                  className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm max-w-xs"
                >
                  {TASK_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {onUpdateProgressLegend && (
            <div>
              <p className="text-sm text-surface-500 mb-1">Progress colour (legend)</p>
              <p className="text-xs text-surface-500 mb-2">Pick how this task should read on the calendar and boards. Colours are intentionally soft.</p>
              <select
                value={task.progress_legend || 'not_started'}
                onChange={(e) => onUpdateProgressLegend(task.id, e.target.value)}
                className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                {TASK_PROGRESS_LEGEND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {onUpdateLeaderReviewer && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-surface-500 mb-1">Task leader</p>
                <select
                  value={task.task_leader_id || ''}
                  onChange={(e) => onUpdateLeaderReviewer(task.id, { task_leader_id: e.target.value || null })}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-sm text-surface-500 mb-1">Task reviewer</p>
                <select
                  value={task.task_reviewer_id || ''}
                  onChange={(e) => onUpdateLeaderReviewer(task.id, { task_reviewer_id: e.target.value || null })}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <p className="text-sm text-surface-500 mb-1">Progress</p>
            <input
              type="range"
              min="0"
              max="100"
              value={task.progress ?? 0}
              onChange={(e) => onUpdateProgress(task.id, parseInt(e.target.value, 10))}
              className="w-full"
            />
            <span className="text-sm text-surface-600">{task.progress ?? 0}%</span>
            {isAssignee && (
              <div className="mt-2 space-y-2">
                <textarea
                  placeholder="What did you do? (optional — saved with timestamp when you click Log progress)"
                  value={progressNote}
                  onChange={(e) => setProgressNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={savingProgress}
                  onClick={async () => {
                    setSavingProgress(true);
                    try {
                      await onAddProgressUpdate(task.id, task.progress ?? 0, progressNote || undefined);
                      setProgressNote('');
                      onRefreshDetail?.();
                    } finally {
                      setSavingProgress(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {savingProgress ? 'Saving…' : 'Log progress (with timestamp)'}
                </button>
              </div>
            )}
          </div>

          {progressUpdates.length > 0 && (
            <div>
              <p className="text-sm text-surface-500 mb-1">Progress history</p>
              <ul className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-surface-200 p-2 bg-surface-50">
                {progressUpdates.map((u) => (
                  <li key={u.id} className="text-sm">
                    <span className="text-surface-500">{formatDateTime(u.created_at)}</span>
                    <span className="mx-1">·</span>
                    <span className="font-medium text-surface-700">{u.user_name || 'Someone'}</span>
                    <span className="mx-1">→</span>
                    <span className="text-surface-700">{u.progress}%</span>
                    {u.note && <span className="block text-surface-600 mt-0.5">{u.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-sm text-surface-500 mb-1">Status</p>
            <select
              value={task.status || 'not_started'}
              onChange={(e) => onUpdateStatus(task.id, e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-full max-w-xs"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {task.status !== 'completed' && (
            <button
              type="button"
              onClick={() => onUpdateStatus(task.id, 'completed')}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              ✓ Mark complete
            </button>
          )}

          <div>
            <p className="text-sm text-surface-500 mb-1">Assignees</p>
            <ul className="space-y-1">
              {(task.assignees || []).map((a) => (
                <li key={a.user_id} className="flex items-center justify-between gap-2">
                  <span className="text-surface-700">{a.full_name || a.email}</span>
                  <button
                    type="button"
                    onClick={() => setTransferModal?.({ taskId: task.id, fromUserId: a.user_id, assigneeName: a.full_name })}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Transfer
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setAssigneeModal?.(task.id)} className="mt-2 text-sm text-brand-600 hover:underline">Add assignees</button>
          </div>

          <div>
            <p className="text-sm text-surface-500 mb-1">Comments</p>
            <ul className="space-y-2 max-h-56 overflow-y-auto rounded-lg border border-surface-200 p-2 bg-surface-50 mb-2">
              {comments.length === 0 ? (
                <li className="text-sm text-surface-500">No comments yet.</li>
              ) : (
                comments.map((c) => (
                  <li key={c.id} className="text-sm border-b border-surface-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-surface-500">{formatDateTime(c.created_at)}</span>
                    <span className="mx-1">·</span>
                    <span className="font-medium text-surface-700">{c.user_name || 'Someone'}</span>
                    <p className="text-surface-700 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                    {(c.attachments || []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-2 items-center">
                        {(c.attachments || []).map((att) => {
                          const url = tasksApi.commentAttachmentDownloadUrl(task.id, c.id, att.id);
                          return (
                            <span
                              key={att.id}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-surface-100 text-surface-700 text-xs"
                            >
                              <span className="truncate max-w-[120px]" title={att.file_name}>{att.file_name}</span>
                              <button
                                type="button"
                                onClick={() => openAttachmentWithAuth(url).catch((err) => window.alert(err?.message))}
                                className="text-brand-600 hover:underline"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadAttachmentWithAuth(url, att.file_name).catch((err) => window.alert(err?.message))}
                                className="text-brand-600 hover:underline"
                              >
                                Download
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))
              )}
            </ul>
            {isAssignee && (
              <div className="space-y-2">
                <textarea
                  placeholder="Add a comment…"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50">
                      {commentFiles.length ? `${commentFiles.length} file(s) chosen` : 'Choose files (multiple)'}
                    </span>
                    <input
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => setCommentFiles(Array.from(e.target.files || []))}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={savingComment || !commentText.trim()}
                    onClick={async () => {
                      setSavingComment(true);
                      try {
                        await onAddComment(task.id, commentText.trim(), commentFiles);
                        setCommentText('');
                        setCommentFiles([]);
                        onRefreshDetail?.();
                      } finally {
                        setSavingComment(false);
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {savingComment ? 'Adding…' : 'Add comment'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm text-surface-500 mb-1">Reminders</p>
            <ul className="space-y-2 max-h-40 overflow-y-auto rounded-lg border border-surface-200 p-2 bg-surface-50 mb-2">
              {reminders.length === 0 ? (
                <li className="text-sm text-surface-500">No reminders.</li>
              ) : (
                reminders.map((r) => (
                  <li key={r.id} className="text-sm flex items-start justify-between gap-2">
                    <span>
                      <span className="text-surface-500">{formatDateTime(r.remind_at)}</span>
                      {r.note && <span className="block text-surface-700 mt-0.5">{r.note}</span>}
                      <span className="text-surface-400 text-xs"> — {r.user_name}</span>
                    </span>
                    {!r.dismissed_at && onDismissReminder && (
                      <button
                        type="button"
                        onClick={() => onDismissReminder(task.id, r.id)}
                        className="text-xs text-brand-600 hover:underline shrink-0"
                      >
                        Dismiss
                      </button>
                    )}
                    {r.dismissed_at && <span className="text-surface-400 text-xs">Dismissed</span>}
                  </li>
                ))
              )}
            </ul>
            {isAssignee && onAddReminder && (
              <div className="space-y-2">
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Reminder note (optional)"
                  value={remindNote}
                  onChange={(e) => setRemindNote(e.target.value)}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={savingReminder || !remindAt}
                  onClick={async () => {
                    setSavingReminder(true);
                    try {
                      await onAddReminder(task.id, remindAt, remindNote || undefined);
                      setRemindAt('');
                      setRemindNote('');
                      onRefreshDetail?.();
                    } finally {
                      setSavingReminder(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {savingReminder ? 'Adding…' : 'Add reminder'}
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm text-surface-500 mb-1">Attachments</p>
            <ul className="space-y-1">
              {(task.attachments || []).map((att) => (
                <li key={att.id}>
                  <a
                    href={tasksApi.attachmentDownloadUrl(task.id, att.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline text-sm"
                  >
                    {att.file_name}
                  </a>
                </li>
              ))}
            </ul>
            <label className="inline-block mt-2">
              <span className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 cursor-pointer">
                {uploadingFile ? 'Uploading…' : 'Upload file'}
              </span>
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploadingFile(true);
                    onUploadAttachment(task.id, file).finally(() => { setUploadingFile(false); e.target.value = ''; });
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {assigneeModal && (
        <AddAssigneesModal
          taskId={assigneeModal}
          tenantUsers={tenantUsers}
          existingIds={(task.assignees || []).map((a) => a.user_id)}
          onAdd={(userIds) => { onAddAssignees(assigneeModal, userIds); setAssigneeModal?.(null); }}
          onClose={() => setAssigneeModal?.(null)}
        />
      )}
      {transferModal && (
        <TransferModal
          taskId={transferModal.taskId}
          fromUserId={transferModal.fromUserId}
          assigneeName={transferModal.assigneeName}
          tenantUsers={tenantUsers.filter((u) => u.id !== transferModal.fromUserId)}
          onTransfer={(toUserId) => { onTransfer(transferModal.taskId, transferModal.fromUserId, toUserId); setTransferModal?.(null); }}
          onClose={() => setTransferModal?.(null)}
        />
      )}
    </div>
  );
}

function AddAssigneesModal({ taskId, tenantUsers, existingIds, onAdd, onClose }) {
  const [selected, setSelected] = useState([]);
  const available = tenantUsers.filter((u) => !existingIds.includes(u.id));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-surface-900 mb-4">Add assignees</h3>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {available.length === 0 ? (
            <p className="text-sm text-surface-500">All tenant users are already assigned.</p>
          ) : (
            available.map((u) => (
              <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, u.id] : s.filter((id) => id !== u.id)))}
                  className="rounded border-surface-300 text-brand-600"
                />
                <span className="text-sm text-surface-700">{u.full_name || u.email}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => onAdd(selected)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700">Add</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TransferModal({ taskId, fromUserId, assigneeName, tenantUsers, onTransfer, onClose }) {
  const [toUserId, setToUserId] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-surface-900 mb-2">Transfer task</h3>
        <p className="text-sm text-surface-600 mb-4">Reassign from <strong>{assigneeName}</strong> to another user.</p>
        <select
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4"
        >
          <option value="">Select user</option>
          {tenantUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={() => toUserId && onTransfer(toUserId)} disabled={!toUserId} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700 disabled:opacity-50">Transfer</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TabCreateTask({ tenantUsers, onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('departmental');
  const [progressLegend, setProgressLegend] = useState('not_started');
  const [taskLeaderId, setTaskLeaderId] = useState('');
  const [taskReviewerId, setTaskReviewerId] = useState('');
  const [keyActions, setKeyActions] = useState(['']);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addKeyAction = () => setKeyActions((k) => [...k, '']);
  const removeKeyAction = (i) => setKeyActions((k) => k.filter((_, idx) => idx !== i));
  const setKeyAction = (i, v) => setKeyActions((k) => [...k.slice(0, i), v, ...k.slice(i + 1)]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        progress_legend: progressLegend,
        task_leader_id: taskLeaderId || undefined,
        task_reviewer_id: taskReviewerId || undefined,
        key_actions: keyActions.map((s) => s.trim()).filter(Boolean),
        start_date: startDate || undefined,
        due_date: dueDate || undefined,
        assignee_ids: assigneeIds,
      };
      const data = await tasksApi.create(payload);
      const taskId = data.task?.id;
      if (taskId && files.length > 0) {
        for (const file of files) {
          await tasksApi.uploadAttachment(taskId, file);
        }
      }
      onCreated(data.task);
    } catch (err) {
      setError(err?.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Create task</h1>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Task title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            placeholder="Enter task title"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            placeholder="Describe the task"
          />
        </div>

        <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-4 space-y-4">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Classification and ownership</p>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Category *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white">
              {TASK_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-surface-500 mt-1">Sales, departmental work, or Thinkers Afrika company tasks.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Progress colour (legend)</label>
            <select
              value={progressLegend}
              onChange={(e) => setProgressLegend(e.target.value)}
              className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white"
            >
              {TASK_PROGRESS_LEGEND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-surface-500 mt-1">Soft colours on your work schedule calendar and task views.</p>
            <TaskColourLegend className="mt-2 opacity-90" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Task leader</label>
              <select value={taskLeaderId} onChange={(e) => setTaskLeaderId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white">
                <option value="">None</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
              <p className="text-xs text-surface-500 mt-1">Optional — accountable lead (must have Tasks access).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Task reviewer</label>
              <select value={taskReviewerId} onChange={(e) => setTaskReviewerId(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white">
                <option value="">None</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
              <p className="text-xs text-surface-500 mt-1">Optional — who reviews completion.</p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Key actions</label>
          {keyActions.map((action, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="text"
                value={action}
                onChange={(e) => setKeyAction(i, e.target.value)}
                className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm"
                placeholder="Key action"
              />
              <button type="button" onClick={() => removeKeyAction(i)} className="text-surface-500 hover:text-red-600 px-2">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addKeyAction} className="text-sm text-brand-600 hover:underline">+ Add key action</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Assign to</label>
          <div className="space-y-2 max-h-40 overflow-y-auto border border-surface-200 rounded-lg p-2">
            {tenantUsers.length === 0 ? (
              <p className="text-sm text-surface-500">Loading users…</p>
            ) : (
              tenantUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(u.id)}
                    onChange={(e) => setAssigneeIds((ids) => (e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id)))}
                    className="rounded border-surface-300 text-brand-600"
                  />
                  <span className="text-sm text-surface-700">{u.full_name || u.email}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Upload files</label>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="w-full text-sm text-surface-600 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border file:border-surface-300 file:bg-surface-50"
          />
          {files.length > 0 && <p className="text-xs text-surface-500 mt-1">{files.length} file(s) selected. They will be uploaded after the task is created.</p>}
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={saving || !title.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create task'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function TabLibrary() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState('');
  const [migrationRequired, setMigrationRequired] = useState(false);

  const loadFolders = useCallback(async () => {
    setLoadingFolders(true);
    setError('');
    try {
      const data = await tasksApi.library.folders.list();
      setFolders(data.folders || []);
      if (data.migrationRequired) setMigrationRequired(true);
    } catch (e) {
      setError(e?.message || 'Failed to load folders');
      setFolders([]);
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    setError('');
    try {
      const data = await tasksApi.library.files.list(selectedFolderId);
      setFiles(data.files || []);
    } catch (e) {
      setError(e?.message || 'Failed to load files');
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [selectedFolderId]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError('');
    try {
      await tasksApi.library.folders.create({ name: newFolderName.trim(), parent_id: selectedFolderId || undefined });
      setNewFolderName('');
      loadFolders();
    } catch (err) {
      setError(err?.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await tasksApi.library.files.upload(file, selectedFolderId);
      loadFiles();
    } catch (err) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const downloadFile = (file) => {
    const url = tasksApi.library.files.downloadUrl(file.id);
    window.open(url, '_blank');
  };

  const buildFolderTree = (parentId = null) => {
    return folders
      .filter((f) => (parentId == null ? !f.parent_id : f.parent_id === parentId))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  };

  const rootFolders = buildFolderTree(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900">Library</h1>
        <InfoHint
          title="Library help"
          text="Upload files and organize them in folders. Select a folder on the left to view or add files."
        />
      </div>

      {migrationRequired && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2 text-sm">
          Library tables are not set up. Run: <code className="bg-amber-100 px-1 rounded">node scripts/run-tasks-library-schema.js</code>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-2 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <div className="flex gap-6 flex-1 min-h-0">
        <div className="w-64 shrink-0 rounded-xl border border-surface-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-500 uppercase">Folders</span>
            <span className="text-xs text-surface-500">Select folder then create below</span>
          </div>
          {loadingFolders ? (
            <p className="text-sm text-surface-500 py-2">Loading…</p>
          ) : (
            <ul className="space-y-0.5 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(null)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg ${selectedFolderId === null ? 'bg-brand-100 text-brand-800' : 'hover:bg-surface-100 text-surface-700'}`}
                >
                  Root
                </button>
              </li>
              {rootFolders.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(f.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-1 ${selectedFolderId === f.id ? 'bg-brand-100 text-brand-800' : 'hover:bg-surface-100 text-surface-700'}`}
                  >
                    <span className="truncate">{f.name}</span>
                  </button>
                  {buildFolderTree(f.id).map((sub) => (
                    <li key={sub.id} className="pl-3">
                      <button
                        type="button"
                        onClick={() => setSelectedFolderId(sub.id)}
                        className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-1 ${selectedFolderId === sub.id ? 'bg-brand-100 text-brand-800' : 'hover:bg-surface-100 text-surface-700'}`}
                      >
                        <span className="truncate">{sub.name}</span>
                      </button>
                    </li>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleCreateFolder} className="mt-3 pt-3 border-t border-surface-100">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={selectedFolderId ? 'New subfolder name' : 'New folder name (root)'}
              className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm mb-1"
            />
            <button type="submit" disabled={creatingFolder || !newFolderName.trim()} className="w-full py-1.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {creatingFolder ? 'Creating…' : 'Create folder'}
            </button>
          </form>
        </div>

        <div className="flex-1 min-w-0 rounded-xl border border-surface-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-surface-900">
              {selectedFolderId == null ? 'Files in Root' : `Files in "${folders.find((x) => x.id === selectedFolderId)?.name || 'Folder'}"`}
            </h2>
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                {uploading ? 'Uploading…' : 'Upload file'}
              </span>
              <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
          {loadingFiles ? (
            <p className="text-surface-500 py-4">Loading…</p>
          ) : files.length === 0 ? (
            <p className="text-surface-500 py-6 text-center">No files in this folder. Upload a file or select another folder.</p>
          ) : (
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-50">
                  <span className="text-sm text-surface-800 truncate">{file.file_name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {file.file_size != null && <span className="text-xs text-surface-500">{(file.file_size / 1024).toFixed(1)} KB</span>}
                    <button type="button" onClick={() => downloadFile(file)} className="text-sm text-brand-600 hover:text-brand-700">Download</button>
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
