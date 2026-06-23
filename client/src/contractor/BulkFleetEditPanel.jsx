import { useMemo, useState } from 'react';
import { truckRowKey } from '../lib/truckKey.js';

const FIELD_META = [
  { key: 'main_contractor', label: 'Main contractor', group: 'contractor', placeholder: 'e.g. Teshuah Trucks' },
  { key: 'sub_contractor', label: 'Sub-contractor', group: 'contractor', placeholder: 'Sub-contractor company name' },
  { key: 'make_model', label: 'Make / model', group: 'vehicle', placeholder: 'e.g. Volvo FH16' },
  { key: 'tracking_provider', label: 'Tracking provider', group: 'login', type: 'provider' },
  { key: 'tracking_username', label: 'Tracking username', group: 'login', placeholder: 'Telematics login' },
  { key: 'tracking_password', label: 'Tracking password', group: 'login', type: 'password', placeholder: 'Leave blank to skip' },
  { key: 'camera_provider', label: 'Camera tracking provider', group: 'camera', type: 'provider' },
  { key: 'camera_username', label: 'Camera username', group: 'camera', placeholder: 'Camera portal login' },
  { key: 'camera_password', label: 'Camera password', group: 'camera', type: 'password', placeholder: 'Leave blank to skip' },
];

function truckSubKey(t) {
  const id = t.subcontractor_id ?? t.subcontractorId;
  if (id) return `id:${String(id).toLowerCase()}`;
  const name = (t.subcontractor_company_name || t.sub_contractor || t.subContractor || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return '__direct__';
}

function truckSubLabel(t) {
  return (t.subcontractor_company_name || t.sub_contractor || t.subContractor || '').trim() || 'Direct / unassigned';
}

function truckRowLabel(t) {
  return [t.registration, t.make_model || t.makeModel].filter(Boolean).join(' · ');
}

function StepPill({ n, label, active, done }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-45'}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        active
          ? 'bg-white text-brand-700 shadow-lg shadow-brand-900/20'
          : done
            ? 'bg-emerald-400/90 text-emerald-950'
            : 'bg-white/20 text-white'
      }`}>
        {done ? '✓' : n}
      </span>
      <span className={`text-xs font-semibold hidden sm:inline ${active ? 'text-white' : 'text-white/80'}`}>{label}</span>
    </div>
  );
}

function FieldCard({ field, enabled, value, onToggle, onChange, trackingProviders }) {
  const meta = FIELD_META.find((f) => f.key === field);
  if (!meta) return null;
  const active = enabled.has(field);

  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${
      active
        ? 'border-brand-400/60 bg-gradient-to-br from-brand-50 to-white dark:from-brand-950/40 dark:to-surface-900 shadow-md shadow-brand-500/10 ring-1 ring-brand-300/40'
        : 'border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/40 opacity-70'
    }`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          onChange={() => onToggle(field)}
          className="mt-1 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{meta.label}</p>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">
              {meta.group === 'login' ? 'Telematics login' : meta.group === 'camera' ? 'Camera login' : meta.group === 'contractor' ? 'Contractor labels' : 'Vehicle'}
            </p>
          </div>
          {active && (
            meta.type === 'provider' ? (
              <select
                value={value || ''}
                onChange={(e) => onChange(field, e.target.value)}
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm bg-white dark:bg-surface-900"
              >
                {trackingProviders.map((p) => (
                  <option key={p || 'blank'} value={p}>{p || '— Select provider —'}</option>
                ))}
                <option value="Other">Other</option>
              </select>
            ) : (
              <input
                type={meta.type === 'password' ? 'password' : 'text'}
                value={value ?? ''}
                onChange={(e) => onChange(field, e.target.value)}
                placeholder={meta.placeholder}
                autoComplete={meta.type === 'password' ? 'new-password' : 'off'}
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm bg-white dark:bg-surface-900"
              />
            )
          )}
        </div>
      </label>
    </div>
  );
}

export default function BulkFleetEditPanel({
  trucks = [],
  initialSelectedRegistrations = [],
  allTrucks = [],
  trackingProviders = ['', 'Fleetcam', 'Cartrack', 'Nest Tar'],
  onClose,
  onApply,
  applying = false,
  isSubcontractorUser = false,
}) {
  const [step, setStep] = useState(1);
  const [targetRegs, setTargetRegs] = useState([...initialSelectedRegistrations]);
  const [enabledFields, setEnabledFields] = useState(new Set());
  const [values, setValues] = useState({});
  const [spreadRegs, setSpreadRegs] = useState(new Set());
  const [changeComment, setChangeComment] = useState('');

  const pool = allTrucks.length ? allTrucks : trucks;

  const selectedTrucks = useMemo(
    () => pool.filter((t) => targetRegs.includes(truckRowKey(t))),
    [pool, targetRegs]
  );

  const spreadGroups = useMemo(() => {
    const selectedSet = new Set(targetRegs);
    const bySub = new Map();

    for (const t of selectedTrucks) {
      const key = truckSubKey(t);
      if (!bySub.has(key)) {
        bySub.set(key, { key, label: truckSubLabel(t), selected: [], siblings: [] });
      }
      bySub.get(key).selected.push(t);
    }

    for (const t of pool) {
      const rk = truckRowKey(t);
      if (!rk || selectedSet.has(rk)) continue;
      const key = truckSubKey(t);
      if (!bySub.has(key)) continue;
      bySub.get(key).siblings.push(t);
    }

    return [...bySub.values()].filter((g) => g.siblings.length > 0);
  }, [selectedTrucks, targetRegs, pool]);

  const finalRegs = useMemo(() => {
    const set = new Set(targetRegs);
    spreadRegs.forEach((r) => set.add(r));
    return [...set];
  }, [targetRegs, spreadRegs]);

  const finalRegistrations = useMemo(
    () => finalRegs.map((rk) => pool.find((t) => truckRowKey(t) === rk)?.registration).filter(Boolean),
    [finalRegs, pool]
  );

  const toggleField = (field) => {
    setEnabledFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const setValue = (field, val) => {
    setValues((v) => ({ ...v, [field]: val }));
  };

  const canProceedStep1 = enabledFields.size > 0 && [...enabledFields].every((f) => {
    if (f === 'tracking_password' || f === 'camera_password') return true;
    const v = values[f];
    return v != null && String(v).trim() !== '';
  });

  const buildPayload = () => {
    const fields = [...enabledFields];
    const updates = {};
    for (const f of fields) {
      if ((f === 'tracking_password' || f === 'camera_password') && !values[f]) continue;
      updates[f] = values[f] ?? null;
    }
    if (updates.tracking_provider === 'Other' && values.tracking_provider_other) {
      updates.tracking_provider = values.tracking_provider_other;
    }
    if (updates.camera_provider === 'Other' && values.camera_provider_other) {
      updates.camera_provider = values.camera_provider_other;
    }
    return {
      registrations: finalRegistrations,
      fields: fields.filter((f) => {
        if (f === 'tracking_password') return values.tracking_password;
        if (f === 'camera_password') return values.camera_password;
        return true;
      }),
      updates,
      change_comment: changeComment.trim() || undefined,
    };
  };

  const reviewFields = [...enabledFields].filter((f) => {
    if (f === 'tracking_password') return values.tracking_password;
    if (f === 'camera_password') return values.camera_password;
    return true;
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end" role="dialog" aria-modal="true" aria-label="Bulk fleet edit">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close" />
      <div className="relative w-full max-w-2xl bg-white dark:bg-surface-950 shadow-2xl flex flex-col max-h-full overflow-hidden">
        <div className="relative overflow-hidden shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-700" />
          <div className="relative px-5 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 mb-1">Fleet operations</p>
                <h2 className="text-xl font-bold tracking-tight">Bulk truck update</h2>
                <p className="text-sm text-white/80 mt-1">Updates are matched by registration — no database IDs needed.</p>
              </div>
              <button type="button" onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white" aria-label="Close">✕</button>
            </div>
            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-white/20">
              <StepPill n={1} label="Configure" active={step === 1} done={step > 1} />
              <StepPill n={2} label="Spread" active={step === 2} done={step > 2} />
              <StepPill n={3} label="Review" active={step === 3} done={false} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
            {finalRegistrations.length} truck{finalRegistrations.length !== 1 ? 's' : ''} will be updated
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            {finalRegs.map((rk) => {
              const t = pool.find((x) => truckRowKey(x) === rk);
              if (!t) return null;
              const isSpread = spreadRegs.has(rk) && !targetRegs.includes(rk);
              return (
                <span key={rk} className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-lg border ${
                  isSpread ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-surface-200 text-surface-800'
                }`}>
                  {t.registration}
                  {isSpread && <span className="text-[9px] font-sans text-indigo-500">+spread</span>}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Tick only the fields you want to change. Trucks with facility access may go to approval.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELD_META.map((f) => (
                  <FieldCard
                    key={f.key}
                    field={f.key}
                    enabled={enabledFields}
                    value={values[f.key]}
                    onToggle={toggleField}
                    onChange={setValue}
                    trackingProviders={trackingProviders}
                  />
                ))}
              </div>
              {enabledFields.has('tracking_provider') && values.tracking_provider === 'Other' && (
                <input
                  value={values.tracking_provider_other || ''}
                  onChange={(e) => setValue('tracking_provider_other', e.target.value)}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="Custom tracking provider name"
                />
              )}
              {enabledFields.has('camera_provider') && values.camera_provider === 'Other' && (
                <input
                  value={values.camera_provider_other || ''}
                  onChange={(e) => setValue('camera_provider_other', e.target.value)}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="Custom camera tracking provider name"
                />
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {spreadGroups.length === 0 ? (
                <p className="text-sm text-surface-500 text-center py-8">No additional trucks to spread to under the same sub-contractor.</p>
              ) : spreadGroups.map((group) => (
                <div key={group.key} className="rounded-xl border border-surface-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-b">
                    <div>
                      <p className="text-sm font-semibold">{group.label}</p>
                      <p className="text-xs text-surface-500">{group.siblings.length} more truck(s)</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSpreadRegs((prev) => {
                          const next = new Set(prev);
                          const allOn = group.siblings.every((t) => next.has(truckRowKey(t)));
                          group.siblings.forEach((t) => {
                            const rk = truckRowKey(t);
                            if (allOn) next.delete(rk);
                            else next.add(rk);
                          });
                          return next;
                        });
                      }}
                      className="text-xs font-semibold text-brand-700"
                    >
                      {group.siblings.every((t) => spreadRegs.has(truckRowKey(t))) ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <ul className="divide-y max-h-48 overflow-y-auto">
                    {group.siblings.map((t) => {
                      const rk = truckRowKey(t);
                      return (
                        <li key={rk}>
                          <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-50">
                            <input
                              type="checkbox"
                              checked={spreadRegs.has(rk)}
                              onChange={() => {
                                setSpreadRegs((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(rk)) next.delete(rk);
                                  else next.add(rk);
                                  return next;
                                });
                              }}
                            />
                            <span className="text-sm font-mono font-medium">{t.registration}</span>
                            <span className="text-xs text-surface-500 truncate flex-1">{t.make_model || '—'}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <dl className="rounded-xl border divide-y">
                {reviewFields.map((f) => {
                  const meta = FIELD_META.find((x) => x.key === f);
                  return (
                    <div key={f} className="flex justify-between gap-4 px-4 py-3 text-sm">
                      <dt className="text-surface-500">{meta?.label || f}</dt>
                      <dd className="font-medium">{(f === 'tracking_password' || f === 'camera_password') ? '••••••••' : (values[f] || '—')}</dd>
                    </div>
                  );
                })}
              </dl>
              <textarea
                value={changeComment}
                onChange={(e) => setChangeComment(e.target.value)}
                rows={2}
                placeholder="Comment for approvers (optional)"
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-4 border-t flex justify-between gap-3">
          <button type="button" onClick={step === 1 ? onClose : () => setStep((s) => s - 1)} className="px-4 py-2 text-sm rounded-lg border">
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={step === 1 && !canProceedStep1}
              onClick={() => setStep((s) => s + 1)}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white disabled:opacity-40"
            >
              {step === 1 ? 'Next' : 'Review'}
            </button>
          ) : (
            <button
              type="button"
              disabled={applying || finalRegistrations.length === 0}
              onClick={() => onApply?.(buildPayload())}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white disabled:opacity-40"
            >
              {applying ? 'Applying…' : `Apply to ${finalRegistrations.length} truck(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { truckSubKey, truckSubLabel };
