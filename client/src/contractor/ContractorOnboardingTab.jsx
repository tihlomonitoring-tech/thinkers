import { useCallback, useEffect, useState } from 'react';
import { truckOnboarding as obApi } from '../api';
import OnboardingActionRow from '../components/onboarding/OnboardingActionRow.jsx';

function stageStatusClass(status) {
  if (status === 'completed') return 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20';
  if (status === 'in_progress') return 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/20';
  return 'border-surface-200 bg-surface-50 dark:bg-surface-900/50 opacity-75';
}

export default function ContractorOnboardingTab({ onError }) {
  const [info, setInfo] = useState('');
  const [board, setBoard] = useState({ onboardings: [] });
  const [selectedObId, setSelectedObId] = useState('');
  const [detail, setDetail] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    obApi
      .contractorBoard()
      .then((r) => {
        setBoard(r);
        if (r.onboardings?.length && !selectedObId) setSelectedObId(r.onboardings[0].onboarding?.id);
      })
      .catch((e) => onError?.(e.message));
  }, [onError, selectedObId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedObId) {
      setDetail(null);
      return;
    }
    obApi
      .contractorGetOnboarding(selectedObId)
      .then(setDetail)
      .catch((e) => onError?.(e.message));
  }, [selectedObId, onError]);

  const toggleContractorTask = async (task, checked) => {
    if (!detail?.onboarding?.id) return;
    try {
      const d = await obApi.contractorPatchTask(detail.onboarding.id, task.id, {
        contractor_completed: checked,
      });
      setDetail(d);
      load();
    } catch (e) {
      onError?.(e.message);
    }
  };

  const sendMessage = async () => {
    if (!detail?.onboarding?.id || !message.trim()) return;
    setBusy(true);
    try {
      const d = await obApi.contractorPostMessage(detail.onboarding.id, {
        body: message.trim(),
        stage_id: detail.stages.find((s) => s.is_current)?.id,
      });
      setDetail(d);
      setMessage('');
      setInfo('Response sent to onboarding admin');
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onboardings = board.onboardings || [];

  return (
    <div className="space-y-6">
      {info && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-lg">
          {info}
        </p>
      )}
      <div>
        <h3 className="text-md font-semibold text-surface-900 dark:text-surface-50">Fleet onboarding</h3>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
          Complete your actions, upload files on each step, and tick contractor items. Admin approval is the second tick
          where required.
        </p>
      </div>

      {onboardings.length === 0 ? (
        <div className="app-glass-card p-8 text-center text-surface-600">
          <p>
            No trucks or drivers are in onboarding yet. Your onboarding admin will start onboarding from Onboarding
            Admin.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {onboardings.map((ob) => (
              <button
                key={ob.onboarding.id}
                type="button"
                onClick={() => setSelectedObId(ob.onboarding.id)}
                className={`px-3 py-2 rounded-lg text-sm border ${
                  selectedObId === ob.onboarding.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 font-medium'
                    : 'border-surface-200 dark:border-surface-700'
                }`}
              >
                {ob.onboarding.display_label ||
                  (ob.onboarding.entity_type === 'driver'
                    ? [ob.onboarding.driver_full_name, ob.onboarding.driver_surname].filter(Boolean).join(' ') ||
                      ob.onboarding.driver_license_number
                    : `${ob.onboarding.registration || 'Truck'}${ob.onboarding.fleet_no ? ` (${ob.onboarding.fleet_no})` : ''}`)}
                {ob.onboarding.template_name ? ` · ${ob.onboarding.template_name}` : ''}
                {ob.onboarding.entity_type === 'driver' ? ' · Driver' : ' · Truck'}
              </button>
            ))}
          </div>

          {detail && (
            <>
              <div className="overflow-x-auto pb-4">
                <div className="flex gap-3 min-w-max">
                  {detail.stages.map((liveStage) => (
                    <div
                      key={liveStage.id}
                      className={`w-72 shrink-0 rounded-xl border-2 p-3 ${stageStatusClass(liveStage.stage_status)}`}
                    >
                      <p className="font-semibold text-sm">{liveStage.title}</p>
                      <p className="text-[10px] uppercase tracking-wide text-surface-500 mt-1">
                        {liveStage.stage_status.replace('_', ' ')}
                      </p>
                      {liveStage.description && (
                        <p className="text-xs text-surface-600 mt-2">{liveStage.description}</p>
                      )}
                      {liveStage.stage_status !== 'locked' && (
                        <ul className="mt-3 space-y-1">
                          {liveStage.tasks.map((task) => (
                            <OnboardingActionRow
                              key={task.id}
                              task={task}
                              stageLocked={false}
                              role="contractor"
                              attachmentDownloadUrl={obApi.attachmentDownloadUrl}
                              onContractorToggle={(checked) => toggleContractorTask(task, checked)}
                              onUpload={async (file) => {
                                try {
                                  const d = await obApi.contractorUploadTaskAttachment(
                                    detail.onboarding.id,
                                    task.id,
                                    file
                                  );
                                  setDetail(d);
                                  setInfo('File uploaded');
                                } catch (err) {
                                  onError?.(err.message);
                                }
                              }}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {detail.onboarding.progress_report_draft && (
                <div className="app-glass-card p-4">
                  <p className="text-xs font-semibold uppercase text-surface-500">Admin progress report</p>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{detail.onboarding.progress_report_draft}</p>
                </div>
              )}

              <div className="app-glass-card p-4 space-y-3">
                <p className="text-sm font-semibold">Messages & responses</p>
                <ul className="space-y-2 max-h-40 overflow-y-auto text-sm">
                  {(detail.messages || []).map((m) => (
                    <li
                      key={m.id}
                      className={`p-2 rounded-lg ${
                        m.author_role === 'contractor' ? 'bg-brand-50 dark:bg-brand-950/30' : 'bg-surface-100 dark:bg-surface-800'
                      }`}
                    >
                      <span className="text-xs text-surface-500">
                        {m.author_name || m.author_role} · {new Date(m.created_at).toLocaleString()}
                      </span>
                      <p className="mt-1">{m.body}</p>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder="Reply to onboarding admin…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !message.trim()}
                    onClick={sendMessage}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
