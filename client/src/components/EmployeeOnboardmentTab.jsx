import { useState, useEffect, useCallback } from 'react';
import { profileManagement as pm, openAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function phaseStatusStyle(status, isCurrent) {
  if (isCurrent) return 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 ring-1 ring-brand-200';
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20';
  if (s === 'in_progress') return 'border-amber-200 bg-amber-50/50';
  return 'border-surface-200 bg-white dark:bg-surface-900 opacity-80';
}

export default function EmployeeOnboardmentTab({ onError }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [phases, setPhases] = useState([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState(null);
  const [journal, setJournal] = useState([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);

  const loadPlan = useCallback(() => {
    setLoading(true);
    pm.onboarding
      .my()
      .then((data) => {
        setPlan(data.plan);
        setPhases(data.phases || []);
        if (data.plan?.current_phase_id) setSelectedPhaseId(data.plan.current_phase_id);
        else if (data.phases?.length) setSelectedPhaseId(data.phases[0].id);
      })
      .catch((e) => onError?.(e?.message || 'Failed to load onboardment plan'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const loadJournal = useCallback(
    (phaseId) => {
      if (!phaseId) return;
      setJournalLoading(true);
      pm.onboarding
        .phaseJournal(phaseId)
        .then((d) => setJournal(d.entries || []))
        .catch((e) => onError?.(e?.message || 'Failed to load journal'))
        .finally(() => setJournalLoading(false));
    },
    [onError]
  );

  useEffect(() => {
    if (selectedPhaseId) loadJournal(selectedPhaseId);
  }, [selectedPhaseId, loadJournal]);

  const selectedPhase = phases.find((p) => p.id === selectedPhaseId);
  const canWriteJournal =
    selectedPhase &&
    (selectedPhase.is_current || selectedPhase.phase_status === 'completed' || selectedPhase.phase_status === 'in_progress');

  const saveJournal = async (publish) => {
    if (!selectedPhaseId || !draftBody.trim()) return;
    setSaving(true);
    onError?.('');
    try {
      if (editingEntryId) {
        await pm.onboarding.updateJournal(editingEntryId, { body: draftBody.trim(), publish });
      } else {
        await pm.onboarding.addJournal(selectedPhaseId, { body: draftBody.trim(), publish });
      }
      setDraftBody('');
      setEditingEntryId(null);
      loadJournal(selectedPhaseId);
    } catch (e) {
      onError?.(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry) => {
    setEditingEntryId(entry.id);
    setDraftBody(entry.body || '');
  };

  if (loading) {
    return <p className="text-surface-500 p-6">Loading your onboardment plan…</p>;
  }

  if (!plan) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Employee onboardment</h1>
          <InfoHint
            title="Employee onboardment"
            text="When management creates an onboardment plan for you, it will appear here with phases, resources, and a daily journal for each phase."
          />
        </div>
        <div className="app-glass-card p-8 text-center text-surface-600 dark:text-surface-400">
          <p className="font-medium text-surface-800 dark:text-surface-200">No active onboardment plan</p>
          <p className="text-sm mt-2">Your HR or manager will assign a plan when you join or change role.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">{plan.title}</h1>
            <InfoHint
              title="Your onboardment plan"
              text="Follow each phase in order. Open the current phase to read instructions, download attachments, and write daily journal entries (draft or published). Management is notified by email when you move to a new phase."
            />
          </div>
          {plan.plan_notes ? (
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-2 max-w-2xl whitespace-pre-wrap">{plan.plan_notes}</p>
          ) : null}
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
          {plan.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-surface-500 px-1">Onboardment map</h2>
          {phases.map((ph, idx) => (
            <button
              key={ph.id}
              type="button"
              onClick={() => setSelectedPhaseId(ph.id)}
              className={`w-full text-left rounded-xl border p-4 transition-all ${phaseStatusStyle(ph.phase_status, ph.is_current)} ${
                selectedPhaseId === ph.id ? 'ring-2 ring-brand-400' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    ph.phase_status === 'completed'
                      ? 'bg-emerald-600 text-white'
                      : ph.is_current
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-200 text-surface-600'
                  }`}
                >
                  {ph.phase_status === 'completed' ? '✓' : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-surface-900 dark:text-surface-100">{ph.title}</p>
                  <p className="text-xs text-surface-500 mt-0.5 capitalize">{ph.phase_status?.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-8 space-y-4">
          {selectedPhase ? (
            <>
              <div className="app-glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{selectedPhase.title}</h2>
                {selectedPhase.description ? (
                  <p className="text-sm text-surface-700 dark:text-surface-300 mt-3 whitespace-pre-wrap leading-relaxed">
                    {selectedPhase.description}
                  </p>
                ) : (
                  <p className="text-sm text-surface-500 mt-2">No description for this phase.</p>
                )}
                {selectedPhase.attachments?.length > 0 ? (
                  <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
                    <p className="text-xs font-semibold uppercase text-surface-500 mb-2">Attachments</p>
                    <ul className="space-y-2">
                      {selectedPhase.attachments.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => openAttachmentWithAuth(pm.onboarding.attachmentDownloadUrl(a.id))}
                            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
                          >
                            {a.original_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="app-glass-card p-5">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Daily journal & progress</h3>
                <p className="text-xs text-surface-500 mt-1 mb-4">
                  Record daily notes for this phase. Drafts are private until you publish; published entries include a timestamp for management.
                </p>

                {canWriteJournal ? (
                  <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4 bg-surface-50/80 dark:bg-surface-950/50 mb-4">
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      rows={4}
                      placeholder="Today's progress, learnings, or questions…"
                      className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm"
                    />
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        disabled={saving || !draftBody.trim()}
                        onClick={() => saveJournal(false)}
                        className="px-3 py-1.5 rounded-lg border border-surface-300 text-sm font-medium hover:bg-white disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : editingEntryId ? 'Update draft' : 'Save draft'}
                      </button>
                      <button
                        type="button"
                        disabled={saving || !draftBody.trim()}
                        onClick={() => saveJournal(true)}
                        className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                      >
                        Publish entry
                      </button>
                      {editingEntryId ? (
                        <button
                          type="button"
                          onClick={() => { setEditingEntryId(null); setDraftBody(''); }}
                          className="px-3 py-1.5 text-sm text-surface-600"
                        >
                          Cancel edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-amber-800 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                    Journal entries can be added when this phase is current or after it is completed.
                  </p>
                )}

                {journalLoading ? (
                  <p className="text-sm text-surface-500">Loading entries…</p>
                ) : journal.length === 0 ? (
                  <p className="text-sm text-surface-500">No journal entries yet for this phase.</p>
                ) : (
                  <ul className="space-y-3">
                    {journal.map((entry) => (
                      <li
                        key={entry.id}
                        className={`rounded-lg border p-4 ${
                          entry.entry_status === 'published'
                            ? 'border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20'
                            : 'border-dashed border-surface-300 bg-white dark:bg-surface-900'
                        }`}
                      >
                        <div className="flex flex-wrap justify-between gap-2 mb-2">
                          <span
                            className={`text-xs font-semibold uppercase ${
                              entry.entry_status === 'published' ? 'text-emerald-700' : 'text-surface-500'
                            }`}
                          >
                            {entry.entry_status}
                          </span>
                          <span className="text-xs text-surface-500">
                            {formatDateTime(entry.published_at || entry.updated_at || entry.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-surface-800 dark:text-surface-200 whitespace-pre-wrap">{entry.body}</p>
                        {entry.entry_status === 'draft' && canWriteJournal ? (
                          <button
                            type="button"
                            onClick={() => startEdit(entry)}
                            className="mt-2 text-xs text-brand-600 font-medium hover:underline"
                          >
                            Edit draft
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-surface-500 app-glass-card p-6">Select a phase from the map.</p>
          )}
        </div>
      </div>
    </div>
  );
}
