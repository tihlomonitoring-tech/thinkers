import { useState, useEffect, useCallback, useMemo } from 'react';
import { orgStructure as orgApi } from '../api';
import { buildOrgTree } from '../lib/orgChartTree.js';
import OrgChartTreeDiagram from './OrgChartTreeDiagram.jsx';
import InfoHint from './InfoHint.jsx';

const btnDelete = 'px-2 py-1 text-xs font-medium rounded-md border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-surface-300 bg-white text-sm dark:bg-surface-900 dark:border-surface-600 dark:text-surface-50';

const SUB = [
  { id: 'overview', label: 'Overview & chart' },
  { id: 'departments', label: 'Departments' },
  { id: 'positions', label: 'Job titles' },
  { id: 'assignments', label: 'People & reporting' },
];

function userLabel(u) {
  return u?.full_name || u?.email || u?.id || '—';
}

export default function OrgStructureManagementSection({ onError }) {
  const [sub, setSub] = useState('overview');
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schemaHint, setSchemaHint] = useState('');

  const [deptForm, setDeptForm] = useState({ name: '', code: '', description: '', parent_department_id: '' });
  const [posForm, setPosForm] = useState({
    title: '',
    department_id: '',
    description: '',
    responsibilities: '',
    grade_level: '',
  });
  const [asgForm, setAsgForm] = useState({
    user_id: '',
    position_id: '',
    manager_user_id: '',
    escalation_user_id: '',
    notes: '',
  });
  const [editPosId, setEditPosId] = useState(null);
  const [editPos, setEditPos] = useState({});
  const [uploadPosId, setUploadPosId] = useState('');
  const [uploadFiles, setUploadFiles] = useState(null);

  const refresh = useCallback(() => {
    onError?.('');
    setSchemaHint('');
    return orgApi
      .bundle()
      .then(setBundle)
      .catch((e) => {
        const msg = e?.message || 'Load failed';
        if (msg.includes('db:org-structure') || msg.includes('Schema')) setSchemaHint(msg);
        onError?.(msg);
      });
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const departments = bundle?.departments || [];
  const positions = bundle?.positions || [];
  const assignments = bundle?.assignments || [];
  const tenantUsers = bundle?.tenant_users || [];
  const roots = useMemo(() => buildOrgTree(assignments), [assignments]);

  const run = async (fn) => {
    setBusy(true);
    onError?.('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError?.(e?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const createDepartment = () =>
    run(async () => {
      if (!deptForm.name.trim()) throw new Error('Department name required');
      await orgApi.departments.create({
        name: deptForm.name,
        code: deptForm.code || null,
        description: deptForm.description || null,
        parent_department_id: deptForm.parent_department_id || null,
      });
      setDeptForm({ name: '', code: '', description: '', parent_department_id: '' });
    });

  const createPosition = () =>
    run(async () => {
      if (!posForm.title.trim()) throw new Error('Job title required');
      await orgApi.positions.create({
        title: posForm.title,
        department_id: posForm.department_id || null,
        description: posForm.description || null,
        responsibilities: posForm.responsibilities || null,
        grade_level: posForm.grade_level || null,
      });
      setPosForm({ title: '', department_id: '', description: '', responsibilities: '', grade_level: '' });
    });

  const savePositionEdit = () =>
    run(async () => {
      if (!editPosId) return;
      await orgApi.positions.patch(editPosId, editPos);
      setEditPosId(null);
      setEditPos({});
    });

  const createAssignment = () =>
    run(async () => {
      if (!asgForm.position_id) throw new Error('Select a position');
      await orgApi.assignments.create({
        user_id: asgForm.user_id || null,
        position_id: asgForm.position_id,
        manager_user_id: asgForm.manager_user_id || null,
        escalation_user_id: asgForm.escalation_user_id || null,
        notes: asgForm.notes || null,
      });
      setAsgForm({ user_id: '', position_id: '', manager_user_id: '', escalation_user_id: '', notes: '' });
    });

  const uploadAttachments = () =>
    run(async () => {
      if (!uploadPosId || !uploadFiles?.length) throw new Error('Select position and files');
      await orgApi.positions.uploadAttachments(uploadPosId, Array.from(uploadFiles));
      setUploadFiles(null);
    });

  const patchAssignment = (id, body) => run(() => orgApi.assignments.patch(id, body));

  const deleteAssignment = (id) => {
    if (!window.confirm('Remove this person from the structure?')) return;
    run(() => orgApi.assignments.delete(id));
  };

  const deleteDepartment = (id) => {
    if (
      !window.confirm(
        'Delete this department? Job titles linked to it will stay but lose their department tag. Sub-departments will become top-level.'
      )
    ) {
      return;
    }
    run(() => orgApi.departments.delete(id));
  };

  const deletePosition = (id, title) => {
    if (!window.confirm(`Delete position "${title}"? Remove all assignments first.`)) return;
    run(() => orgApi.positions.delete(id));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Organisational structure</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Build departments, define job titles and responsibilities, assign employees, and align line managers with escalation contacts.
          </p>
        </div>
        <InfoHint text="Run npm run db:org-structure once on the server database before first use." />
      </div>

      {schemaHint && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          {schemaHint}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-surface-200 dark:border-surface-700 pb-1">
        {SUB.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 rounded-t-lg text-sm font-medium ${
              sub === t.id
                ? 'bg-brand-600 text-white'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Departments', departments.length],
              ['Positions', positions.length],
              ['Assignments', assignments.length],
              ['Employees on chart', assignments.filter((a) => a.user_id).length],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl border border-surface-200 p-4 dark:border-surface-700">
                <p className="text-xs text-surface-500">{label}</p>
                <p className="text-2xl font-semibold mt-1">{n}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Organisation chart ({roots.length} top-level)</p>
            <OrgChartTreeDiagram
              roots={roots}
              interactive={false}
              emptyMessage="Add assignments with line managers to build the reporting tree."
            />
          </div>
        </div>
      )}

      {sub === 'departments' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <form
            className="space-y-3 rounded-xl border border-surface-200 p-4 dark:border-surface-700"
            onSubmit={(e) => {
              e.preventDefault();
              createDepartment();
            }}
          >
            <h3 className="font-medium">New department</h3>
            <input className={inputCls} placeholder="Name *" value={deptForm.name} onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))} />
            <input className={inputCls} placeholder="Code" value={deptForm.code} onChange={(e) => setDeptForm((f) => ({ ...f, code: e.target.value }))} />
            <select
              className={inputCls}
              value={deptForm.parent_department_id}
              onChange={(e) => setDeptForm((f) => ({ ...f, parent_department_id: e.target.value }))}
            >
              <option value="">No parent</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <textarea
              className={inputCls}
              rows={3}
              placeholder="Description"
              value={deptForm.description}
              onChange={(e) => setDeptForm((f) => ({ ...f, description: e.target.value }))}
            />
            <button type="submit" disabled={busy} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
              Add department
            </button>
          </form>
          <div className="rounded-xl border border-surface-200 p-4 dark:border-surface-700">
            <h3 className="font-medium mb-3">Departments</h3>
            <ul className="space-y-2 text-sm max-h-80 overflow-y-auto">
              {departments.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 items-start border-b border-surface-100 pb-2 dark:border-surface-800">
                  <div>
                    <span className="font-medium">{d.name}</span>
                    {d.code && <span className="text-surface-500 ml-1">({d.code})</span>}
                    {d.description && <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{d.description}</p>}
                  </div>
                  <button type="button" className={btnDelete} onClick={() => deleteDepartment(d.id)}>
                    Delete
                  </button>
                </li>
              ))}
              {!departments.length && <li className="text-surface-500">None yet</li>}
            </ul>
          </div>
        </div>
      )}

      {sub === 'positions' && (
        <div className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <form
              className="space-y-3 rounded-xl border border-surface-200 p-4 dark:border-surface-700"
              onSubmit={(e) => {
                e.preventDefault();
                createPosition();
              }}
            >
              <h3 className="font-medium">New job title / position</h3>
              <input className={inputCls} placeholder="Title *" value={posForm.title} onChange={(e) => setPosForm((f) => ({ ...f, title: e.target.value }))} />
              <select className={inputCls} value={posForm.department_id} onChange={(e) => setPosForm((f) => ({ ...f, department_id: e.target.value }))}>
                <option value="">Department (optional)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="Grade level" value={posForm.grade_level} onChange={(e) => setPosForm((f) => ({ ...f, grade_level: e.target.value }))} />
              <textarea className={inputCls} rows={2} placeholder="Role description" value={posForm.description} onChange={(e) => setPosForm((f) => ({ ...f, description: e.target.value }))} />
              <textarea
                className={inputCls}
                rows={4}
                placeholder="Key responsibilities (shown on Profile org chart)"
                value={posForm.responsibilities}
                onChange={(e) => setPosForm((f) => ({ ...f, responsibilities: e.target.value }))}
              />
              <button type="submit" disabled={busy} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                Create position
              </button>
            </form>
            <div className="rounded-xl border border-surface-200 p-4 dark:border-surface-700 space-y-3">
              <h3 className="font-medium">Upload role documents</h3>
              <select className={inputCls} value={uploadPosId} onChange={(e) => setUploadPosId(e.target.value)}>
                <option value="">Select position</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <input type="file" multiple className="text-sm" onChange={(e) => setUploadFiles(e.target.files)} />
              <button type="button" disabled={busy} className="btn-secondary text-sm px-4 py-2 rounded-lg" onClick={uploadAttachments}>
                Upload files
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-surface-200 overflow-hidden dark:border-surface-700">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 dark:bg-surface-800">
                <tr>
                  <th className="text-left p-2">Title</th>
                  <th className="text-left p-2">Department</th>
                  <th className="text-left p-2">Grade</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-surface-100 dark:border-surface-800">
                    <td className="p-2 font-medium">{p.title}</td>
                    <td className="p-2 text-surface-600">{p.department_name || '—'}</td>
                    <td className="p-2">{p.grade_level || '—'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-brand-600 text-xs font-medium"
                          onClick={() => {
                            setEditPosId(p.id);
                            setEditPos({
                              title: p.title,
                              description: p.description || '',
                              responsibilities: p.responsibilities || '',
                              grade_level: p.grade_level || '',
                              department_id: p.department_id || '',
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className={btnDelete} onClick={() => deletePosition(p.id, p.title)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editPosId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditPosId(null)}>
              <div className="bg-white dark:bg-surface-900 rounded-xl p-5 max-w-lg w-full space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold">Edit position</h3>
                <input className={inputCls} value={editPos.title || ''} onChange={(e) => setEditPos((x) => ({ ...x, title: e.target.value }))} />
                <select className={inputCls} value={editPos.department_id || ''} onChange={(e) => setEditPos((x) => ({ ...x, department_id: e.target.value || null }))}>
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <textarea className={inputCls} rows={2} value={editPos.description || ''} onChange={(e) => setEditPos((x) => ({ ...x, description: e.target.value }))} />
                <textarea className={inputCls} rows={4} value={editPos.responsibilities || ''} onChange={(e) => setEditPos((x) => ({ ...x, responsibilities: e.target.value }))} />
                <div className="flex gap-2 justify-end">
                  <button type="button" className="px-3 py-1.5 text-sm rounded-lg border" onClick={() => setEditPosId(null)}>
                    Cancel
                  </button>
                  <button type="button" disabled={busy} className="btn-primary text-sm px-4 py-2 rounded-lg" onClick={savePositionEdit}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {sub === 'assignments' && (
        <div className="space-y-6">
          <form
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-xl border border-surface-200 p-4 dark:border-surface-700"
            onSubmit={(e) => {
              e.preventDefault();
              createAssignment();
            }}
          >
            <h3 className="sm:col-span-2 lg:col-span-3 font-medium">Assign person to position</h3>
            <select className={inputCls} value={asgForm.position_id} onChange={(e) => setAsgForm((f) => ({ ...f, position_id: e.target.value }))} required>
              <option value="">Position *</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <select className={inputCls} value={asgForm.user_id} onChange={(e) => setAsgForm((f) => ({ ...f, user_id: e.target.value }))}>
              <option value="">Vacant (no employee)</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)} {u.on_structure ? '· on chart' : ''}
                </option>
              ))}
            </select>
            <select className={inputCls} value={asgForm.manager_user_id} onChange={(e) => setAsgForm((f) => ({ ...f, manager_user_id: e.target.value }))}>
              <option value="">Line manager</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            <select className={inputCls} value={asgForm.escalation_user_id} onChange={(e) => setAsgForm((f) => ({ ...f, escalation_user_id: e.target.value }))}>
              <option value="">Escalation contact</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            <input className={inputCls} placeholder="Notes" value={asgForm.notes} onChange={(e) => setAsgForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="submit" disabled={busy} className="btn-primary text-sm px-4 py-2 rounded-lg disabled:opacity-50 sm:col-span-2 lg:col-span-3 w-fit">
              Add to structure
            </button>
          </form>

          <div className="rounded-xl border border-surface-200 overflow-x-auto dark:border-surface-700">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-surface-50 dark:bg-surface-800">
                <tr>
                  <th className="text-left p-2">Employee</th>
                  <th className="text-left p-2">Position</th>
                  <th className="text-left p-2">Manager</th>
                  <th className="text-left p-2">Escalation</th>
                  <th className="p-2">Quick align</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} className="border-t border-surface-100 dark:border-surface-800">
                    <td className="p-2">{a.user_id ? a.display_name : <span className="text-amber-600">Vacant</span>}</td>
                    <td className="p-2">{a.position_title}</td>
                    <td className="p-2">{a.manager_name || '—'}</td>
                    <td className="p-2">{a.escalation_name || '—'}</td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        <select
                          className="text-xs border rounded px-1 py-0.5 dark:bg-surface-900"
                          value={a.manager_user_id || ''}
                          onChange={(e) => patchAssignment(a.id, { manager_user_id: e.target.value || null })}
                        >
                          <option value="">Manager…</option>
                          {tenantUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {userLabel(u)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="text-xs border rounded px-1 py-0.5 dark:bg-surface-900"
                          value={a.escalation_user_id || ''}
                          onChange={(e) => patchAssignment(a.id, { escalation_user_id: e.target.value || null })}
                        >
                          <option value="">Escalation…</option>
                          {tenantUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {userLabel(u)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="p-2">
                      <button type="button" className={btnDelete} onClick={() => deleteAssignment(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!assignments.length && <p className="p-4 text-sm text-surface-500">No assignments yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
