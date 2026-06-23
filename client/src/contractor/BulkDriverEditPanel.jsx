import { useMemo, useState } from 'react';

const FIELD_META = [
  { key: 'full_name', label: 'First / full name', group: 'identity', placeholder: 'e.g. John' },
  { key: 'surname', label: 'Surname', group: 'identity', placeholder: 'e.g. Dlamini' },
  { key: 'id_number', label: 'ID number', group: 'identity', placeholder: 'SA ID (must be unique per driver)' },
  { key: 'license_number', label: 'Licence number', group: 'licence', placeholder: 'Must be unique per driver' },
  { key: 'license_expiry', label: 'Licence expiry', group: 'licence', type: 'date' },
  { key: 'phone', label: 'Cellphone', group: 'contact', placeholder: '+27…', type: 'tel' },
  { key: 'email', label: 'Email', group: 'contact', placeholder: 'name@company.com', type: 'email' },
  { key: 'linked_truck_id', label: 'Linked truck', group: 'assignment', type: 'truck' },
];

function driverSubKey(d) {
  const id = d.subcontractor_id ?? d.subcontractorId;
  if (id) return `id:${String(id).toLowerCase()}`;
  const name = (d.subcontractor_company_name || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return '__direct__';
}

function driverSubLabel(d) {
  return (d.subcontractor_company_name || '').trim() || 'Direct / unassigned';
}

function driverRowLabel(d) {
  const name = d.full_name || [d.name, d.surname].filter(Boolean).join(' ') || '—';
  return name;
}

function StepPill({ n, label, active, done }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-45'}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        active
          ? 'bg-white text-violet-700 shadow-lg shadow-violet-900/20'
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

function FieldCard({ field, enabled, value, onToggle, onChange, trucks, truckSearch, onTruckSearchChange }) {
  const meta = FIELD_META.find((f) => f.key === field);
  if (!meta) return null;
  const active = enabled.has(field);

  const filteredTrucks = useMemo(() => {
    if (meta.type !== 'truck') return [];
    const q = (truckSearch || '').trim().toLowerCase();
    return (trucks || []).filter((t) => {
      if (!q) return true;
      return (
        String(t.registration || '').toLowerCase().includes(q) ||
        String(t.make_model || t.makeModel || '').toLowerCase().includes(q) ||
        String(t.fleet_no || t.fleetNo || '').toLowerCase().includes(q)
      );
    }).slice(0, 40);
  }, [trucks, truckSearch, meta.type]);

  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${
      active
        ? 'border-violet-400/60 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/40 dark:to-surface-900 shadow-md shadow-violet-500/10 ring-1 ring-violet-300/40'
        : 'border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/40 opacity-70'
    }`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          onChange={() => onToggle(field)}
          className="mt-1 rounded border-surface-300 text-violet-600 focus:ring-violet-500"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{meta.label}</p>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">
              {meta.group === 'identity' ? 'Identity' : meta.group === 'licence' ? 'Licence' : meta.group === 'contact' ? 'Contact' : 'Truck assignment'}
            </p>
          </div>
          {active && meta.type === 'truck' && (
            <div className="space-y-2">
              <input
                type="search"
                value={truckSearch || ''}
                onChange={(e) => onTruckSearchChange?.(e.target.value)}
                placeholder="Search trucks by registration…"
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm bg-white dark:bg-surface-900"
              />
              <select
                value={value === '__CLEAR__' ? '__CLEAR__' : (value || '')}
                onChange={(e) => onChange(field, e.target.value)}
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm bg-white dark:bg-surface-900"
              >
                <option value="">— Select truck —</option>
                <option value="__CLEAR__">Clear truck link (unlink all)</option>
                {filteredTrucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.registration}{t.make_model || t.makeModel ? ` · ${t.make_model || t.makeModel}` : ''}{t.fleet_no || t.fleetNo ? ` #${t.fleet_no || t.fleetNo}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {active && meta.type !== 'truck' && (
            <input
              type={meta.type || 'text'}
              value={value ?? ''}
              onChange={(e) => onChange(field, e.target.value)}
              placeholder={meta.placeholder}
              className="w-full rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 text-sm bg-white dark:bg-surface-900"
            />
          )}
          {active && (field === 'id_number' || field === 'license_number') && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">Each driver must have a unique value — duplicates will be skipped.</p>
          )}
        </div>
      </label>
    </div>
  );
}

export default function BulkDriverEditPanel({
  drivers = [],
  allDrivers = [],
  trucks = [],
  initialSelectedIds = [],
  onClose,
  onApply,
  applying = false,
  isSubcontractorUser = false,
}) {
  const [step, setStep] = useState(1);
  const [targetIds, setTargetIds] = useState([...initialSelectedIds]);
  const [enabledFields, setEnabledFields] = useState(new Set());
  const [values, setValues] = useState({});
  const [spreadIds, setSpreadIds] = useState(new Set());
  const [truckSearch, setTruckSearch] = useState('');

  const pool = allDrivers.length ? allDrivers : drivers;

  const selectedDrivers = useMemo(
    () => pool.filter((d) => targetIds.includes(d.id)),
    [pool, targetIds]
  );

  const spreadGroups = useMemo(() => {
    const selectedSet = new Set(targetIds);
    const bySub = new Map();

    for (const d of selectedDrivers) {
      const key = driverSubKey(d);
      if (!bySub.has(key)) {
        bySub.set(key, { key, label: driverSubLabel(d), selected: [], siblings: [] });
      }
      bySub.get(key).selected.push(d);
    }

    for (const d of pool) {
      if (selectedSet.has(d.id)) continue;
      const key = driverSubKey(d);
      if (!bySub.has(key)) continue;
      bySub.get(key).siblings.push(d);
    }

    return [...bySub.values()].filter((g) => g.siblings.length > 0);
  }, [selectedDrivers, targetIds, pool]);

  const finalIds = useMemo(() => {
    const set = new Set(targetIds);
    spreadIds.forEach((id) => set.add(id));
    return [...set];
  }, [targetIds, spreadIds]);

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
    if (f === 'linked_truck_id') return values[f] != null && String(values[f]) !== '';
    const v = values[f];
    return v != null && String(v).trim() !== '';
  });

  const buildPayload = () => {
    const fields = [...enabledFields];
    const updates = {};
    for (const f of fields) {
      if (f === 'linked_truck_id') {
        updates.linked_truck_id = values[f] === '__CLEAR__' ? null : values[f];
      } else {
        updates[f] = values[f] ?? null;
      }
    }
    return { ids: finalIds, fields, updates };
  };

  const reviewFields = [...enabledFields];

  const formatReviewValue = (f) => {
    if (f === 'linked_truck_id') {
      if (values[f] === '__CLEAR__') return 'Unlink from truck';
      const t = trucks.find((x) => x.id === values[f]);
      return t ? t.registration : values[f] || '—';
    }
    return values[f] || '—';
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end" role="dialog" aria-modal="true" aria-label="Bulk driver edit">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close" />
      <div className="relative w-full max-w-2xl bg-white dark:bg-surface-950 shadow-2xl flex flex-col max-h-full overflow-hidden">
        <div className="relative overflow-hidden shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-700" />
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_80%_20%,white_0%,transparent_50%)]" />
          <div className="relative px-5 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 mb-1">Driver operations</p>
                <h2 className="text-xl font-bold tracking-tight">Bulk driver update</h2>
                <p className="text-sm text-white/80 mt-1 max-w-md">
                  Update contact details, licence info, and truck links across multiple drivers — then spread to others under the same sub-contractor.
                </p>
              </div>
              <button type="button" onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-white/20">
              <StepPill n={1} label="Configure" active={step === 1} done={step > 1} />
              <div className="h-px flex-1 bg-white/25 max-w-8" />
              <StepPill n={2} label="Spread" active={step === 2} done={step > 2} />
              <div className="h-px flex-1 bg-white/25 max-w-8" />
              <StepPill n={3} label="Review" active={step === 3} done={false} />
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
            {finalIds.length} driver{finalIds.length !== 1 ? 's' : ''} will be updated
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            {finalIds.map((id) => {
              const d = pool.find((x) => x.id === id);
              if (!d) return null;
              const isSpread = spreadIds.has(id) && !targetIds.includes(id);
              return (
                <span
                  key={id}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${
                    isSpread
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-950/50 dark:border-indigo-800 dark:text-indigo-200'
                      : 'bg-white border-surface-200 text-surface-800 dark:bg-surface-900 dark:border-surface-700 dark:text-surface-200'
                  }`}
                >
                  {driverRowLabel(d)}
                  {isSpread && <span className="text-[9px] font-sans text-indigo-500">+spread</span>}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900/50 px-4 py-3">
                <p className="text-sm text-violet-900 dark:text-violet-100">
                  <span className="font-semibold">Tip:</span> Tick only the fields you want to change. Driver updates apply immediately (no approval workflow).
                </p>
              </div>

              {['identity', 'licence', 'contact', 'assignment'].map((group) => (
                <div key={group}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-surface-500 mb-3">
                    {group === 'identity' ? 'Identity' : group === 'licence' ? 'Licence' : group === 'contact' ? 'Contact' : 'Truck link'}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {FIELD_META.filter((f) => f.group === group).map((f) => (
                      <FieldCard
                        key={f.key}
                        field={f.key}
                        enabled={enabledFields}
                        value={values[f.key]}
                        onToggle={toggleField}
                        onChange={setValue}
                        trucks={trucks}
                        truckSearch={truckSearch}
                        onTruckSearchChange={setTruckSearch}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-surface-600 dark:text-surface-400">
                Apply the same changes to more drivers under the same sub-contractor — useful when renewing licences or reassigning a team to one truck.
              </p>

              {spreadGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center">
                  <p className="text-sm font-medium text-surface-700 dark:text-surface-300">No additional drivers to spread to</p>
                  <p className="text-xs text-surface-500 mt-1">Your selection already covers all drivers under the matched sub-contractors.</p>
                </div>
              ) : (
                spreadGroups.map((group) => (
                  <div key={group.key} className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/40 dark:to-indigo-950/30 border-b border-surface-200 dark:border-surface-700">
                      <div>
                        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{group.label}</p>
                        <p className="text-xs text-surface-500">{group.siblings.length} more driver{group.siblings.length !== 1 ? 's' : ''} available</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSpreadIds((prev) => {
                            const next = new Set(prev);
                            const allSelected = group.siblings.every((d) => next.has(d.id));
                            if (allSelected) group.siblings.forEach((d) => next.delete(d.id));
                            else group.siblings.forEach((d) => next.add(d.id));
                            return next;
                          });
                        }}
                        className="text-xs font-semibold text-violet-700 hover:text-violet-800 dark:text-violet-300 px-2 py-1 rounded-lg hover:bg-white/60"
                      >
                        {group.siblings.every((d) => spreadIds.has(d.id)) ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <ul className="divide-y divide-surface-100 dark:divide-surface-800 max-h-48 overflow-y-auto">
                      {group.siblings.map((d) => (
                        <li key={d.id}>
                          <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-900/50">
                            <input
                              type="checkbox"
                              checked={spreadIds.has(d.id)}
                              onChange={() => {
                                setSpreadIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(d.id)) next.delete(d.id);
                                  else next.add(d.id);
                                  return next;
                                });
                              }}
                              className="rounded border-surface-300 text-violet-600"
                            />
                            <span className="text-sm font-medium text-surface-900 dark:text-surface-100 flex-1 truncate">{driverRowLabel(d)}</span>
                            <span className="text-xs text-surface-500 font-mono shrink-0">{d.license_number || '—'}</span>
                            {d.facility_access && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0">Approved</span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
                <div className="px-4 py-3 bg-surface-50 dark:bg-surface-900 border-b border-surface-200 dark:border-surface-700">
                  <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Changes to apply</h3>
                </div>
                <dl className="divide-y divide-surface-100 dark:divide-surface-800">
                  {reviewFields.map((f) => {
                    const meta = FIELD_META.find((x) => x.key === f);
                    return (
                      <div key={f} className="flex justify-between gap-4 px-4 py-3 text-sm">
                        <dt className="text-surface-500">{meta?.label || f}</dt>
                        <dd className="font-medium text-surface-900 dark:text-surface-100 text-right">{formatReviewValue(f)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>

              <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50 px-4 py-3">
                <p className="text-sm text-violet-900 dark:text-violet-100">
                  <span className="font-bold">{finalIds.length}</span> driver{finalIds.length !== 1 ? 's' : ''} will receive{' '}
                  <span className="font-bold">{reviewFields.length}</span> field update{reviewFields.length !== 1 ? 's' : ''}.
                </p>
                {(enabledFields.has('id_number') || enabledFields.has('license_number')) && (
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
                    Drivers with duplicate ID or licence numbers will be skipped; others will still update.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
            className="px-4 py-2 text-sm rounded-lg border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-900"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex gap-2">
            {step < 3 ? (
              <button
                type="button"
                disabled={step === 1 && !canProceedStep1}
                onClick={() => setStep((s) => s + 1)}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 shadow-lg shadow-violet-600/25"
              >
                {step === 1 ? 'Next: spread to team' : 'Review changes'}
              </button>
            ) : (
              <button
                type="button"
                disabled={applying || finalIds.length === 0}
                onClick={() => onApply?.(buildPayload())}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 shadow-lg shadow-violet-600/30"
              >
                {applying ? 'Applying…' : `Apply to ${finalIds.length} driver${finalIds.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { driverSubKey, driverSubLabel };
