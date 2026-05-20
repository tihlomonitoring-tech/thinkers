import { useState, useEffect, useCallback } from 'react';
import { profileManagement as pm, openAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const map = {
    active: 'bg-brand-100 text-brand-800',
    completed: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-red-100 text-red-800',
    pending: 'bg-surface-200 text-surface-700',
    in_progress: 'bg-amber-100 text-amber-900',
    completed_phase: 'bg-emerald-100 text-emerald-800',
  };
  return map[s] || 'bg-surface-100 text-surface-700';
}

const emptyPhase = () => ({ title: '', description: '' });

export default function ComposeOnboardmentSection({ tenantUsers, onError }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [planDetail, setPlanDetail] = useState(null);
  const [journals, setJournals] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [subTab, setSubTab] = useState('phases');

  const [userId, setUserId] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [phases, setPhases] = useState([emptyPhase(), emptyPhase()]);

  const loadPlans = useCallback(() => {
    setLoading(true);
    pm.onboarding.plans
      .list()
      .then((d) => setPlans(d.plans || []))
      .catch((e) => onError?.(e?.message || 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const loadDetail = (id) => {
    setSelectedPlanId(id);
    setDetailLoading(true);
    setSubTab('phases');
    Promise.all([pm.onboarding.plans.get(id), pm.onboarding.plans.journals(id)])
      .then(([detail, journalData]) => {
        setPlanDetail(detail);
        setJournals(journalData.entries || []);
      })
      .catch((e) => onError?.(e?.message || 'Failed to load plan'))
      .finally(() => setDetailLoading(false));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!userId || !planTitle.trim()) {
      onError?.('Select employee and enter plan title');
      return;
    }
    const validPhases = phases.filter((p) => p.title.trim());
    if (validPhases.length === 0) {
      onError?.('Add at least one phase with a title');
      return;
    }
    setSaving(true);
    onError?.('');
    try {
      const data = await pm.onboarding.plans.create({
        user_id: userId,
        title: planTitle.trim(),
        plan_notes: planNotes.trim() || undefined,
        start_date: startDate || undefined,
        phases: validPhases.map((p, i) => ({
          title: p.title.trim(),
          description: p.description?.trim() || undefined,
          sort_order: i,
        })),
      });
      setView('list');
      resetComposeForm();
      loadPlans();
      if (data.plan?.id) loadDetail(data.plan.id);
    } catch (err) {
      onError?.(err?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const resetComposeForm = () => {
    setUserId('');
    setPlanTitle('');
    setPlanNotes('');
    setStartDate('');
    setPhases([emptyPhase(), emptyPhase()]);
  };

  const handleAdvance = async () => {
    if (!selectedPlanId) return;
    if (!window.confirm('Mark the current phase complete and move the employee to the next phase? They will receive an email.')) return;
    setAdvancing(true);
    onError?.('');
    try {
      const result = await pm.onboarding.plans.advance(selectedPlanId);
      loadDetail(selectedPlanId);
      loadPlans();
      if (result.completed) alert('Onboardment plan completed for this employee.');
    } catch (e) {
      onError?.(e?.message || 'Advance failed');
    } finally {
      setAdvancing(false);
    }
  };

  const updatePhaseField = (phaseId, field, value) => {
    if (!planDetail) return;
    pm.onboarding
      .updatePhase(phaseId, { [field]: value })
      .then(() => loadDetail(selectedPlanId))
      .catch((e) => onError?.(e?.message || 'Update failed'));
  };

  const uploadAttachment = async (phaseId, file) => {
    if (!file) return;
    onError?.('');
    try {
      await pm.onboarding.uploadAttachment(phaseId, file);
      loadDetail(selectedPlanId);
    } catch (e) {
      onError?.(e?.message || 'Upload failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900">Compose onboardment</h1>
          <InfoHint
            title="Compose onboardment"
            text="Build a phased onboardment map per employee (e.g. interview, induction, probation). Attach resources per phase, advance phases when ready (employee gets email), and review their published daily journals."
          />
        </div>
        <div className="flex gap-2">
          {view === 'list' ? (
            <button
              type="button"
              onClick={() => { setView('compose'); resetComposeForm(); }}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              New onboardment plan
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView('list')}
              className="px-4 py-2 rounded-lg border border-surface-300 text-sm font-medium text-surface-700 hover:bg-surface-50"
            >
              Back to list
            </button>
          )}
        </div>
      </div>

      {view === 'compose' ? (
        <form onSubmit={handleCreate} className="app-glass-card p-6 max-w-3xl space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-surface-700 mb-1">Employee *</label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                required
              >
                <option value="">Select employee</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-surface-700 mb-1">Plan title *</label>
              <input
                type="text"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                placeholder="e.g. New hire onboardment — Q2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-surface-700 mb-1">Plan notes</label>
              <textarea value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-surface-800 uppercase tracking-wide">Phases</h2>
              <button
                type="button"
                onClick={() => setPhases((p) => [...p, emptyPhase()])}
                className="text-sm text-brand-600 font-medium hover:underline"
              >
                + Add phase
              </button>
            </div>
            <div className="space-y-4">
              {phases.map((ph, idx) => (
                <div key={idx} className="rounded-lg border border-surface-200 p-4 bg-surface-50/50">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-surface-500">Phase {idx + 1}</span>
                    {phases.length > 1 ? (
                      <button type="button" onClick={() => setPhases((p) => p.filter((_, i) => i !== idx))} className="text-xs text-red-600">
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    value={ph.title}
                    onChange={(e) => setPhases((p) => p.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2"
                    placeholder="e.g. Interview & offer"
                    required={idx === 0}
                  />
                  <textarea
                    value={ph.description}
                    onChange={(e) => setPhases((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                    rows={3}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                    placeholder="What the employee should complete in this phase…"
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-surface-500">The first phase starts immediately. The employee receives an email with phase details.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create plan & notify employee'}
            </button>
            <button type="button" onClick={() => setView('list')} className="px-4 py-2 rounded-lg border border-surface-300 text-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-5">
            <div className="app-glass-card overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-200 bg-surface-50">
                <h2 className="text-sm font-semibold text-surface-800">Onboardment plans</h2>
              </div>
              {loading ? (
                <p className="p-6 text-surface-500 text-sm">Loading…</p>
              ) : plans.length === 0 ? (
                <p className="p-8 text-center text-sm text-surface-500">No plans yet. Create one to get started.</p>
              ) : (
                <ul className="divide-y divide-surface-100 max-h-[520px] overflow-y-auto">
                  {plans.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => loadDetail(p.id)}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-50 ${selectedPlanId === p.id ? 'bg-brand-50' : ''}`}
                      >
                        <p className="font-medium text-surface-900 truncate">{p.title}</p>
                        <p className="text-xs text-surface-600">{p.employee_name}</p>
                        <div className="flex gap-2 mt-1 items-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusPill(p.status)}`}>{p.status}</span>
                          <span className="text-xs text-surface-400">{p.phase_count} phases</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="xl:col-span-7">
            {!selectedPlanId ? (
              <p className="app-glass-card p-8 text-center text-surface-500 text-sm">Select a plan to manage phases and review journals.</p>
            ) : detailLoading ? (
              <p className="app-glass-card p-8 text-center text-surface-500">Loading…</p>
            ) : planDetail ? (
              <div className="app-glass-card overflow-hidden">
                <div className="px-5 py-4 border-b border-surface-200 bg-surface-50 flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-surface-900">{planDetail.plan.title}</h2>
                    <p className="text-sm text-surface-600">{planDetail.plan.employee_name} · {planDetail.plan.employee_email}</p>
                  </div>
                  {planDetail.plan.status === 'active' ? (
                    <button
                      type="button"
                      disabled={advancing}
                      onClick={handleAdvance}
                      className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 shrink-0"
                    >
                      {advancing ? 'Advancing…' : 'Advance to next phase'}
                    </button>
                  ) : null}
                </div>

                <div className="flex border-b border-surface-200 px-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setSubTab('phases')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${subTab === 'phases' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600'}`}
                  >
                    Phases & attachments
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubTab('journals')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${subTab === 'journals' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-600'}`}
                  >
                    Employee journals ({journals.filter((j) => j.entry_status === 'published').length} published)
                  </button>
                </div>

                <div className="p-5 max-h-[calc(100vh-16rem)] overflow-y-auto">
                  {subTab === 'phases' ? (
                    <div className="space-y-4">
                      {(planDetail.phases || []).map((ph, idx) => {
                        const isCurrent = ph.id === planDetail.plan.current_phase_id;
                        return (
                          <div
                            key={ph.id}
                            className={`rounded-xl border p-4 ${isCurrent ? 'border-brand-300 bg-brand-50/40' : 'border-surface-200'}`}
                          >
                            <div className="flex flex-wrap justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-surface-500">#{idx + 1}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusPill(ph.phase_status)}`}>
                                  {ph.phase_status}
                                </span>
                                {isCurrent ? <span className="text-xs font-semibold text-brand-700">Current</span> : null}
                              </div>
                            </div>
                            <input
                              type="text"
                              defaultValue={ph.title}
                              onBlur={(e) => e.target.value !== ph.title && updatePhaseField(ph.id, 'title', e.target.value)}
                              className="w-full font-semibold text-surface-900 border border-transparent hover:border-surface-200 focus:border-brand-400 rounded px-2 py-1 mb-2"
                            />
                            <textarea
                              defaultValue={ph.description || ''}
                              onBlur={(e) => e.target.value !== (ph.description || '') && updatePhaseField(ph.id, 'description', e.target.value)}
                              rows={3}
                              className="w-full text-sm border border-surface-200 rounded-lg px-3 py-2 mb-3"
                              placeholder="Phase description for the employee…"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-xs font-medium text-surface-600 cursor-pointer px-2 py-1 rounded border border-surface-300 hover:bg-surface-50">
                                Upload attachment
                                <input
                                  type="file"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadAttachment(ph.id, f);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            </div>
                            {ph.attachments?.length > 0 ? (
                              <ul className="mt-2 space-y-1">
                                {ph.attachments.map((a) => (
                                  <li key={a.id} className="flex items-center justify-between text-sm">
                                    <button
                                      type="button"
                                      onClick={() => openAttachmentWithAuth(pm.onboarding.attachmentDownloadUrl(a.id))}
                                      className="text-brand-600 hover:underline truncate"
                                    >
                                      {a.original_name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {journals.length === 0 ? (
                        <p className="text-sm text-surface-500">No journal entries yet.</p>
                      ) : (
                        journals.map((j) => (
                          <div
                            key={j.id}
                            className={`rounded-lg border p-4 text-sm ${
                              j.entry_status === 'published' ? 'border-emerald-200 bg-emerald-50/40' : 'border-dashed border-surface-300'
                            }`}
                          >
                            <div className="flex flex-wrap justify-between gap-2 mb-2">
                              <span className="font-medium text-surface-800">{j.phase_title}</span>
                              <span className={`text-xs uppercase font-semibold ${j.entry_status === 'published' ? 'text-emerald-700' : 'text-surface-500'}`}>
                                {j.entry_status}
                              </span>
                            </div>
                            <p className="text-xs text-surface-500 mb-2">
                              {formatDateTime(j.published_at || j.updated_at || j.created_at)}
                              {j.author_name ? ` · ${j.author_name}` : ''}
                            </p>
                            <p className="text-surface-800 whitespace-pre-wrap">{j.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
