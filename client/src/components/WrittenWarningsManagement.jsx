import { useState, useEffect, useCallback } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export default function WrittenWarningsManagement({ tenantUsers = [], onError }) {
  const [section, setSection] = useState('issue');
  const [types, setTypes] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [typeForm, setTypeForm] = useState({ code: '', title: '', body_template: '' });
  const [form, setForm] = useState({
    user_id: '',
    warning_type_id: '',
    company_policy_id: '',
    title: '',
    incident_summary: '',
    corrective_action: '',
  });
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, p, w] = await Promise.all([
        pm.writtenWarnings.types(),
        pm.writtenWarnings.policies(),
        pm.writtenWarnings.listAll(),
      ]);
      setTypes(t.types || []);
      setPolicies(p.policies || []);
      setWarnings(w.warnings || []);
    } catch (e) {
      onError?.(e?.message || 'Failed to load written warnings');
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditId(null);
    setForm({
      user_id: '',
      warning_type_id: '',
      company_policy_id: '',
      title: '',
      incident_summary: '',
      corrective_action: '',
    });
  };

  const saveDraft = async (e) => {
    e.preventDefault();
    if (!form.user_id || !form.company_policy_id) {
      onError('Select employee and policy');
      return;
    }
    setSaving(true);
    onError('');
    try {
      if (editId) await pm.writtenWarnings.update(editId, form);
      else await pm.writtenWarnings.create(form);
      resetForm();
      load();
    } catch (err) {
      onError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const publish = async (id) => {
    setSaving(true);
    try {
      await pm.writtenWarnings.publish(id);
      load();
    } catch (err) {
      onError(err?.message || 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (w) => {
    if (w.status !== 'draft') return;
    setEditId(w.id);
    setForm({
      user_id: w.user_id,
      warning_type_id: w.warning_type_id || '',
      company_policy_id: w.company_policy_id,
      title: w.title || '',
      incident_summary: w.incident_summary || '',
      corrective_action: w.corrective_action || '',
    });
    setSection('issue');
  };

  const addType = async (e) => {
    e.preventDefault();
    if (!typeForm.code || !typeForm.title) return;
    setSaving(true);
    try {
      await pm.writtenWarnings.createType(typeForm);
      setTypeForm({ code: '', title: '', body_template: '' });
      load();
    } catch (err) {
      onError(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const sections = [
    { id: 'issue', label: 'Issue warning' },
    { id: 'types', label: 'Warning types' },
    { id: 'history', label: 'History' },
    { id: 'pip', label: 'PIP oversight' },
  ];

  const [pipPlans, setPipPlans] = useState([]);
  const [pipDetail, setPipDetail] = useState(null);
  const [objForm, setObjForm] = useState({ week_number: 1, title: '', description: '', target_outcome: '' });
  const [pipSign, setPipSign] = useState({ approaches: '', interventions: '', goals: '' });

  useEffect(() => {
    if (section === 'pip') {
      pm.pip.listAll().then((d) => setPipPlans(d.plans || [])).catch(() => setPipPlans([]));
    }
  }, [section]);

  const loadPip = async (id) => {
    try {
      const r = await pm.pip.getFull(id);
      setPipDetail(r);
      const p = r.plan || {};
      setPipSign({
        approaches: p.approaches || '',
        interventions: p.interventions || '',
        goals: p.goals || '',
      });
    } catch (e) {
      onError(e?.message || 'Failed to load PIP');
    }
  };

  const addObjective = async (pipId) => {
    if (!objForm.title) return;
    setSaving(true);
    try {
      await pm.pip.addObjective(pipId, objForm);
      setObjForm({ week_number: objForm.week_number + 1, title: '', description: '', target_outcome: '' });
      loadPip(pipId);
    } catch (e) {
      onError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const signPip = async (pipId) => {
    setSaving(true);
    try {
      await pm.pip.managementSign(pipId, pipSign);
      loadPip(pipId);
    } catch (e) {
      onError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const closePip = async (pipId) => {
    if (!window.confirm('Close this performance improvement plan? Only do this when objectives are met or the process is complete.')) return;
    setSaving(true);
    try {
      await pm.pip.close(pipId);
      loadPip(pipId);
      pm.pip.listAll().then((d) => setPipPlans(d.plans || []));
    } catch (e) {
      onError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900">Written warnings & PIP</h2>
        <InfoHint
          title="Formal disciplinary workflow"
          text="Issue written warnings linked to a published company policy. Publish to the employee for signature. Signing auto-creates a performance improvement plan. Set weekly objectives and close the PIP when complete."
        />
      </div>

      <div className="flex gap-1 border-b border-surface-200 overflow-x-auto">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              section === s.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-500'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'issue' && (
        <form onSubmit={saveDraft} className="app-glass-card p-4 grid sm:grid-cols-2 gap-3 max-w-3xl">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Employee</label>
            <select
              value={form.user_id}
              onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              required
            >
              <option value="">Select employee</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Warning type</label>
            <select
              value={form.warning_type_id}
              onChange={(e) => setForm((f) => ({ ...f, warning_type_id: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Policy contravened *</label>
            <select
              value={form.company_policy_id}
              onChange={(e) => setForm((f) => ({ ...f, company_policy_id: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              required
            >
              <option value="">Select published policy</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>{p.title} ({p.reference_number})</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Optional — defaults to warning type"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Incident summary</label>
            <textarea
              value={form.incident_summary}
              onChange={(e) => setForm((f) => ({ ...f, incident_summary: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-surface-600 mb-1">Required corrective action</label>
            <textarea
              value={form.corrective_action}
              onChange={(e) => setForm((f) => ({ ...f, corrective_action: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">
              {saving ? 'Saving…' : editId ? 'Update draft' : 'Save draft'}
            </button>
            {editId && (
              <button type="button" onClick={resetForm} className="px-3 py-2 rounded-lg border text-sm">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {section === 'types' && (
        <div className="space-y-4 max-w-2xl">
          <form onSubmit={addType} className="app-glass-card p-4 grid sm:grid-cols-2 gap-3">
            <input
              value={typeForm.code}
              onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="Code e.g. FIRST"
              className="rounded-lg border px-3 py-2 text-sm"
              required
            />
            <input
              value={typeForm.title}
              onChange={(e) => setTypeForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title"
              className="rounded-lg border px-3 py-2 text-sm"
              required
            />
            <button type="submit" className="sm:col-span-2 px-4 py-2 rounded-lg bg-surface-800 text-white text-sm">Add type</button>
          </form>
          <ul className="app-glass-card divide-y text-sm">
            {types.map((t) => (
              <li key={t.id} className="px-4 py-2 flex justify-between">
                <span><span className="font-medium">{t.title}</span> <span className="text-surface-500">({t.code})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section === 'history' && (
        <div className="app-glass-card overflow-hidden">
          <ul className="divide-y max-h-[32rem] overflow-y-auto text-sm">
            {warnings.map((w) => (
              <li key={w.id} className="px-4 py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <span className="font-medium">{w.user_name}</span>
                    <span className="text-amber-800 ml-1">— {w.reference_number}</span>
                    <span className="text-xs text-surface-500 ml-2">{w.status}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => downloadAttachmentWithAuth(pm.writtenWarnings.pdfUrl(w.id), `${w.reference_number}.pdf`)}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      PDF
                    </button>
                    {w.status === 'draft' && (
                      <>
                        <button type="button" onClick={() => startEdit(w)} className="text-xs text-brand-600 hover:underline">Edit</button>
                        <button type="button" onClick={() => publish(w.id)} className="text-xs font-medium text-amber-800 hover:underline">Publish</button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-surface-600 mt-1">{w.policy_title}</p>
                <p className="text-xs text-surface-400">{fmtDate(w.created_at)} {w.signed ? '· Signed' : ''}</p>
              </li>
            ))}
            {!warnings.length && <li className="px-4 py-6 text-surface-500">No written warnings yet.</li>}
          </ul>
        </div>
      )}

      {section === 'pip' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <ul className="app-glass-card divide-y max-h-96 overflow-y-auto text-sm">
            {pipPlans.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => loadPip(p.id)} className="w-full text-left px-4 py-3 hover:bg-surface-50">
                  <span className="font-medium">{p.title || 'PIP'}</span>
                  <span className="text-xs text-surface-500 block">{p.user_name} · {p.status}</span>
                </button>
              </li>
            ))}
          </ul>
          {pipDetail?.plan && (
            <div className="app-glass-card p-4 space-y-3 text-sm">
              <p className="font-medium">{pipDetail.plan.title}</p>
              <button
                type="button"
                onClick={() => downloadAttachmentWithAuth(pm.pip.pdfUrl(pipDetail.plan.id), 'pip.pdf')}
                className="text-brand-600 hover:underline text-xs"
              >
                Download PIP PDF
              </button>
              {pipDetail.plan.status !== 'closed' && (
                <>
                  <div>
                    <p className="text-xs font-medium text-surface-600 mb-1">Approaches (management sign-off)</p>
                    <textarea
                      value={pipSign.approaches}
                      onChange={(e) => setPipSign((s) => ({ ...s, approaches: e.target.value }))}
                      rows={3}
                      className="w-full rounded border px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-surface-600 mb-1">Interventions</p>
                    <textarea
                      value={pipSign.interventions}
                      onChange={(e) => setPipSign((s) => ({ ...s, interventions: e.target.value }))}
                      rows={3}
                      className="w-full rounded border px-2 py-1 text-xs"
                    />
                  </div>
                  <button type="button" onClick={() => signPip(pipDetail.plan.id)} className="text-xs text-brand-600 font-medium">
                    Save management PIP sign-off
                  </button>
                  <hr />
                  <p className="font-medium text-xs">Add weekly objective</p>
                  <input
                    type="number"
                    min={1}
                    value={objForm.week_number}
                    onChange={(e) => setObjForm((o) => ({ ...o, week_number: Number(e.target.value) }))}
                    className="w-20 rounded border px-2 py-1 text-xs mb-1"
                  />
                  <input
                    value={objForm.title}
                    onChange={(e) => setObjForm((o) => ({ ...o, title: e.target.value }))}
                    placeholder="Objective title"
                    className="w-full rounded border px-2 py-1 text-xs mb-1"
                  />
                  <textarea
                    value={objForm.description}
                    onChange={(e) => setObjForm((o) => ({ ...o, description: e.target.value }))}
                    placeholder="Description"
                    rows={2}
                    className="w-full rounded border px-2 py-1 text-xs mb-1"
                  />
                  <input
                    value={objForm.target_outcome}
                    onChange={(e) => setObjForm((o) => ({ ...o, target_outcome: e.target.value }))}
                    placeholder="Target outcome"
                    className="w-full rounded border px-2 py-1 text-xs mb-1"
                  />
                  <button type="button" onClick={() => addObjective(pipDetail.plan.id)} className="px-3 py-1 rounded bg-brand-600 text-white text-xs">
                    Add objective
                  </button>
                  <button
                    type="button"
                    onClick={() => closePip(pipDetail.plan.id)}
                    className="block mt-2 px-3 py-1 rounded border border-red-300 text-red-800 text-xs"
                  >
                    Close PIP (management only)
                  </button>
                </>
              )}
              <ul className="text-xs space-y-1 mt-2">
                {(pipDetail.objectives || []).map((o) => (
                  <li key={o.id}>Week {o.week_number}: {o.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
