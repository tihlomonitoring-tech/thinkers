import { useState, useEffect, useCallback, useRef } from 'react';
import { workshop as api, contractor as contractorApi } from '../api';
import InfoHint from '../components/InfoHint.jsx';

const ITEM_TYPES = [
  { value: 'part', label: 'Part' },
  { value: 'labour', label: 'Labour' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'other', label: 'Other' },
];

const JC_STATUSES = {
  open: { label: 'Open', cls: 'bg-blue-100 text-blue-800 ring-blue-200' },
  in_progress: { label: 'In progress', cls: 'bg-indigo-100 text-indigo-800 ring-indigo-200' },
  completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
};

function statusBadge(s) {
  const m = JC_STATUSES[s] || JC_STATUSES.open;
  return <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ring-1 ${m.cls}`}>{m.label}</span>;
}

function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }); }
function formatDateTime(d) { if (!d) return '—'; return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

const ATTACHMENT_TYPE_LABELS = {
  general: 'General',
  inspection: 'Inspection file',
  resolution_proof: 'Invoice / mechanic record',
};

function attachmentTypeLabel(type) {
  return ATTACHMENT_TYPE_LABELS[type] || ATTACHMENT_TYPE_LABELS.general;
}

const fc = 'w-full px-3 py-2 rounded-lg border border-surface-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-white';

// ─── Maintenance queue tab ───
function QueueTab({ queue, loading, onStartWork }) {
  if (loading) return <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading maintenance queue…</div>;
  if (!queue.length) return <div className="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500">No maintenance schedules found. Create schedules in Fleet maintenance first.</div>;
  return (
    <div className="space-y-3">
      {queue.map((s) => {
        const hasJc = !!s.job_card_id;
        const reg = s.truck_reg || s.fleet_registration || '—';
        return (
          <div key={s.id} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-surface-900">{reg}</span>
                {s.trailer_registration && <span className="text-xs text-surface-500">/ {s.trailer_registration}</span>}
                <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${s.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : s.status === 'in_progress' ? 'bg-indigo-100 text-indigo-800' : 'bg-blue-100 text-blue-800'}`}>{s.status?.replace(/_/g, ' ')}</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">{s.schedule_type} · Due {formatDate(s.due_date)} {s.description ? `· ${s.description.slice(0, 80)}` : ''}</p>
            </div>
            <div className="shrink-0">
              {hasJc ? (
                <span className="text-xs text-indigo-700 font-medium">Job card: {s.job_card_number || s.job_card_id?.slice(0, 8)} ({s.job_card_status})</span>
              ) : (
                <button type="button" onClick={() => onStartWork(s)} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">Start work</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Create job card form ───
function CreateJobCardForm({ schedule, trucks, users, onSave, saving, onCancel }) {
  const [form, setForm] = useState({
    maintenance_schedule_id: schedule?.id || '',
    truck_id: schedule?.truck_id || '',
    fleet_registration: schedule?.truck_reg || schedule?.fleet_registration || '',
    trailer_registration: schedule?.trailer_registration || '',
    maintenance_subject: schedule?.maintenance_subject || 'truck',
    provider_type: 'internal',
    provider_company_name: '', provider_contact_name: '', provider_contact_phone: '', provider_contact_email: '',
    internal_user_id: '',
    odometer_reading: schedule?.odometer_reading || '',
    description: schedule?.description || schedule?.scope_of_work || '',
  });
  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const isExternal = form.provider_type === 'external';

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-5 space-y-4">
      <div className="flex justify-between items-start gap-3">
        <h3 className="text-sm font-semibold text-surface-900">Create job card {schedule ? `for ${schedule.truck_reg || schedule.fleet_registration || '—'}` : ''}</h3>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-surface-600 px-2 py-1 border border-surface-200 rounded-lg bg-white hover:bg-surface-50">Cancel</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!schedule && (
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Fleet / Truck</label>
            <select value={form.truck_id} onChange={(e) => { const t = trucks.find((x) => String(x.id) === e.target.value); f('truck_id', e.target.value); if (t) f('fleet_registration', t.registration || ''); }} className={fc}>
              <option value="">— Select —</option>
              {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration} {t.make_model ? `(${t.make_model})` : ''}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Service provider</label>
          <select value={form.provider_type} onChange={(e) => f('provider_type', e.target.value)} className={fc}>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>
        {isExternal ? (
          <>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Company name *</label>
              <input value={form.provider_company_name} onChange={(e) => f('provider_company_name', e.target.value)} className={fc} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Contact person *</label>
              <input value={form.provider_contact_name} onChange={(e) => f('provider_contact_name', e.target.value)} className={fc} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Phone</label>
              <input value={form.provider_contact_phone} onChange={(e) => f('provider_contact_phone', e.target.value)} className={fc} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Email</label>
              <input type="email" value={form.provider_contact_email} onChange={(e) => f('provider_contact_email', e.target.value)} className={fc} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Assigned to (internal user)</label>
              <select value={form.internal_user_id} onChange={(e) => f('internal_user_id', e.target.value)} className={fc}>
                <option value="">— Select user —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Company name</label>
              <input value={form.provider_company_name} onChange={(e) => f('provider_company_name', e.target.value)} className={fc} />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Current KM / ODO</label>
          <input type="number" step="0.1" min="0" value={form.odometer_reading} onChange={(e) => f('odometer_reading', e.target.value)} className={fc} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-surface-500 mb-1">Description / scope</label>
        <textarea value={form.description} onChange={(e) => f('description', e.target.value)} rows={3} className={fc} />
      </div>
      <button type="button" disabled={saving} onClick={() => onSave(form)} className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
        {saving ? 'Creating…' : 'Create job card & start'}
      </button>
    </div>
  );
}

// ─── Job card detail (items, progress, attachments, close) ───
function JobCardDetail({ cardId, onBack, users }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newItem, setNewItem] = useState(null);
  const [progressNote, setProgressNote] = useState('');
  const [closeForm, setCloseForm] = useState(false);
  const [finalRes, setFinalRes] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [linkedInspectionId, setLinkedInspectionId] = useState('');
  const [inspections, setInspections] = useState([]);
  const [closeInspectionFile, setCloseInspectionFile] = useState(null);
  const [closeResolutionFile, setCloseResolutionFile] = useState(null);
  const fileRef = useRef(null);
  const closeInspectionFileRef = useRef(null);
  const closeResolutionFileRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    api.jobCards.get(cardId)
      .then((d) => {
        setData(d);
        if (d?.jobCard?.linked_inspection_id) setLinkedInspectionId(d.jobCard.linked_inspection_id);
      })
      .catch((e) => setError(e?.message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [cardId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.inspections().then((d) => setInspections(d.inspections || [])).catch(() => {}); }, []);

  if (loading) return <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading job card…</div>;
  if (!data?.jobCard) return <div className="text-sm text-red-600 py-8 text-center">{error || 'Job card not found.'}</div>;

  const jc = data.jobCard;
  const items = data.items || [];
  const progress = data.progress || [];
  const attachments = data.attachments || [];
  const isClosed = jc.status === 'completed';
  const itemsTotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0);

  const addItem = async () => {
    if (!newItem?.description) return;
    setSaving(true);
    try {
      await api.items.add(cardId, newItem);
      setNewItem(null);
      load();
    } catch (e) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const removeItem = async (itemId) => {
    if (!window.confirm('Remove this item?')) return;
    try { await api.items.remove(cardId, itemId); load(); } catch (e) { setError(e?.message || 'Failed'); }
  };

  const addProgress = async () => {
    if (!progressNote.trim()) return;
    setSaving(true);
    try {
      await api.progress.add(cardId, { note: progressNote.trim() });
      setProgressNote('');
      load();
    } catch (e) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const uploadFiles = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    setSaving(true);
    try { await api.attachments.upload(cardId, fd); load(); } catch (err) { setError(err?.message || 'Upload failed'); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const removeAttachment = async (attId) => {
    if (!window.confirm('Delete this file?')) return;
    try { await api.attachments.remove(attId); load(); } catch (e) { setError(e?.message || 'Failed'); }
  };

  const hasResolutionProof = attachments.some((a) => a.attachment_type === 'resolution_proof');

  const closeJobCard = async () => {
    if (!finalRes.trim()) { setError('Final resolution is required.'); return; }
    if (!linkedInspectionId) { setError('You must link an inspection before closing this work order.'); return; }
    if (!closeResolutionFile && !hasResolutionProof) {
      setError('Upload the physical invoice or mechanic record — this is required to close the job card.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (closeResolutionFile) {
        const fd = new FormData();
        fd.append('files', closeResolutionFile);
        await api.attachments.upload(cardId, fd, { attachment_type: 'resolution_proof' });
      }
      if (closeInspectionFile) {
        const fd = new FormData();
        fd.append('files', closeInspectionFile);
        await api.attachments.upload(cardId, fd, { attachment_type: 'inspection' });
      }
      await api.jobCards.update(cardId, {
        status: 'completed',
        final_resolution: finalRes.trim(),
        next_maintenance_date: nextDate || null,
        linked_inspection_id: linkedInspectionId,
      });
      setCloseForm(false);
      setCloseInspectionFile(null);
      setCloseResolutionFile(null);
      if (closeInspectionFileRef.current) closeInspectionFileRef.current.value = '';
      if (closeResolutionFileRef.current) closeResolutionFileRef.current.value = '';
      load();
    } catch (e) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const pauseJobCard = async () => {
    setSaving(true);
    try {
      await api.jobCards.update(cardId, { status: 'paused' });
      await api.progress.add(cardId, { note: 'Work paused — will continue later.', entry_type: 'status' });
      load();
    } catch (e) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const resumeJobCard = async () => {
    setSaving(true);
    try {
      await api.jobCards.update(cardId, { status: 'in_progress' });
      await api.progress.add(cardId, { note: 'Work resumed.', entry_type: 'status' });
      load();
    } catch (e) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-brand-700 hover:underline">← Back to list</button>
        <div className="flex gap-2">
          {!isClosed && jc.status !== 'paused' && (
            <button type="button" onClick={pauseJobCard} disabled={saving} className="px-3 py-2 rounded-lg border border-amber-200 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50">Pause</button>
          )}
          {jc.status === 'paused' && (
            <button type="button" onClick={resumeJobCard} disabled={saving} className="px-3 py-2 rounded-lg border border-indigo-200 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50">Resume</button>
          )}
          <a href={api.exportPdfUrl(cardId)} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 hover:bg-red-50 inline-flex items-center gap-1">PDF</a>
          <a href={api.exportExcelUrl(cardId)} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-emerald-200 text-sm font-medium text-emerald-800 hover:bg-emerald-50 inline-flex items-center gap-1">Excel</a>
          {!isClosed && (
            <button type="button" onClick={() => setCloseForm(true)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Close job card</button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between">
          <span>{error}</span><button type="button" onClick={() => setError('')} className="text-sm font-medium">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-surface-900">{jc.job_card_number || 'Job card'}</h2>
          {statusBadge(jc.status)}
          <span className="text-xs text-surface-500">{jc.fleet_registration || jc.truck_reg || '—'} {jc.trailer_registration ? `/ ${jc.trailer_registration}` : ''}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Subject</span>{(jc.maintenance_subject || 'truck').replace(/_/g, ' ')}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Provider</span>{jc.provider_type === 'external' ? 'External' : 'Internal'} — {jc.provider_company_name || '—'}</div>
          {jc.provider_type === 'external' && (
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Contact</span>{jc.provider_contact_name || '—'} {jc.provider_contact_phone ? `· ${jc.provider_contact_phone}` : ''}</div>
          )}
          {jc.provider_type === 'internal' && jc.internal_user_name && (
            <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Assigned to</span>{jc.internal_user_name}</div>
          )}
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">ODO (km)</span>{jc.odometer_reading != null ? Number(jc.odometer_reading).toLocaleString() : '—'}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Started</span>{formatDateTime(jc.started_at)}</div>
          {isClosed && <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Completed</span>{formatDateTime(jc.completed_at)}</div>}
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Created by</span>{jc.created_by_name || '—'}</div>
        </div>
        {jc.description && <p className="text-sm text-surface-700 whitespace-pre-wrap border-t border-surface-100 pt-3 mt-2">{jc.description}</p>}
        {jc.final_resolution && (
          <div className="border-t border-emerald-100 pt-3 mt-2">
            <span className="text-[10px] uppercase text-emerald-700 font-semibold block mb-1">Final resolution</span>
            <p className="text-sm text-surface-800 whitespace-pre-wrap">{jc.final_resolution}</p>
            {jc.next_maintenance_date && <p className="text-xs text-surface-500 mt-1">Next maintenance suggested: {formatDate(jc.next_maintenance_date)}</p>}
          </div>
        )}
        {jc.inspection_ref && (
          <div className="border-t border-blue-100 pt-3 mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase text-blue-700 font-semibold">Linked inspection:</span>
            <span className="text-sm font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded">{jc.inspection_ref}</span>
            <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${jc.inspection_result === 'pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{jc.inspection_result || '—'}</span>
          </div>
        )}
      </div>

      {/* Items / parts */}
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-200 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-surface-900">Parts & labour</h3>
          <span className="text-sm font-semibold text-surface-700 tabular-nums">Total: R {itemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-surface-600">Type</th>
                  <th className="text-left px-4 py-2 font-medium text-surface-600">Description</th>
                  <th className="text-left px-4 py-2 font-medium text-surface-600">Part #</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-600">Qty</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-600">Unit price</th>
                  <th className="text-right px-4 py-2 font-medium text-surface-600">Total</th>
                  {!isClosed && <th className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-2 capitalize text-surface-700">{it.item_type}</td>
                    <td className="px-4 py-2 text-surface-800">{it.description}{it.notes ? <span className="block text-xs text-surface-500">{it.notes}</span> : null}</td>
                    <td className="px-4 py-2 text-surface-600">{it.part_number || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{it.unit_price != null ? `R ${Number(it.unit_price).toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">R {Number(it.total_price || 0).toFixed(2)}</td>
                    {!isClosed && (
                      <td className="px-4 py-2">
                        <button type="button" onClick={() => removeItem(it.id)} className="text-xs text-red-600 hover:underline">Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isClosed && (
          <div className="px-5 py-3 border-t border-surface-100">
            {newItem ? (
              <div className="grid gap-3 sm:grid-cols-6 items-end">
                <select value={newItem.item_type} onChange={(e) => setNewItem((p) => ({ ...p, item_type: e.target.value }))} className={fc}>
                  {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input value={newItem.description} onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))} placeholder="Description *" className={fc} />
                <input value={newItem.part_number} onChange={(e) => setNewItem((p) => ({ ...p, part_number: e.target.value }))} placeholder="Part #" className={fc} />
                <input type="number" step="1" min="1" value={newItem.quantity} onChange={(e) => setNewItem((p) => ({ ...p, quantity: e.target.value }))} placeholder="Qty" className={fc} />
                <input type="number" step="0.01" min="0" value={newItem.unit_price} onChange={(e) => setNewItem((p) => ({ ...p, unit_price: e.target.value }))} placeholder="Unit price" className={fc} />
                <div className="flex gap-2">
                  <button type="button" onClick={addItem} disabled={saving} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50">Add</button>
                  <button type="button" onClick={() => setNewItem(null)} className="px-3 py-2 rounded-lg border border-surface-200 text-xs font-medium hover:bg-surface-50">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setNewItem({ item_type: 'part', description: '', part_number: '', quantity: '1', unit_price: '', notes: '' })} className="text-sm font-medium text-brand-700 hover:underline">+ Add part or labour item</button>
            )}
          </div>
        )}
      </div>

      {/* Attachments */}
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm p-5 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-surface-900">Attachments ({attachments.length})</h3>
          {!isClosed && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-medium text-brand-700 hover:underline">+ Upload files</button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={uploadFiles} />
            </>
          )}
        </div>
        {attachments.length > 0 ? (
          <ul className="space-y-2">
            {attachments.map((att) => (
              <li key={att.id} className="flex justify-between items-center gap-2 text-sm border-b border-surface-100 pb-2">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase text-surface-500 mr-2">{attachmentTypeLabel(att.attachment_type)}</span>
                  <a href={api.attachments.downloadUrl(att.id)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline truncate">{att.file_name}</a>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-surface-500">
                  <span>{att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</span>
                  <span>{formatDateTime(att.created_at)}</span>
                  {!isClosed && <button type="button" onClick={() => removeAttachment(att.id)} className="text-red-600 hover:underline">Remove</button>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-surface-500">No attachments yet.</p>
        )}
      </div>

      {/* Progress log */}
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-surface-900">Progress log</h3>
        {progress.length > 0 && (
          <div className="relative pl-4 border-l-2 border-surface-200 space-y-4 max-h-80 overflow-y-auto pr-1">
            {progress.map((p) => (
              <div key={p.id} className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm bg-brand-500" />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[10px] font-semibold text-surface-500 tabular-nums">{formatDateTime(p.created_at)}</span>
                  <span className="text-xs text-surface-600">{p.user_name || p.recorded_by_name || 'System'}</span>
                  {p.entry_type === 'status' && <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Status</span>}
                </div>
                <p className="text-sm text-surface-800 mt-0.5 whitespace-pre-wrap">{p.note}</p>
              </div>
            ))}
          </div>
        )}
        {!isClosed && (
          <div className="flex gap-2 pt-2 border-t border-surface-100">
            <input value={progressNote} onChange={(e) => setProgressNote(e.target.value)} placeholder="Add a progress note…" className={`${fc} flex-1`} onKeyDown={(e) => { if (e.key === 'Enter') addProgress(); }} />
            <button type="button" onClick={addProgress} disabled={saving || !progressNote.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">Post</button>
          </div>
        )}
      </div>

      {/* Close job card form */}
      {closeForm && !isClosed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-emerald-900">Close job card</h3>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Link inspection *</label>
            <select value={linkedInspectionId} onChange={(e) => setLinkedInspectionId(e.target.value)} className={fc} required>
              <option value="">— Select a completed inspection —</option>
              {inspections.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.reference_number} — {ins.fleet_registration || ins.trailer_registration || '—'} ({ins.overall_result?.toUpperCase()}) — {formatDate(ins.inspection_date)}
                </option>
              ))}
            </select>
            {!linkedInspectionId && <p className="text-[10px] text-amber-700 mt-1">An inspection must be completed and linked before closing this work order.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Final resolution *</label>
            <textarea value={finalRes} onChange={(e) => setFinalRes(e.target.value)} rows={3} className={fc} placeholder="Describe the final outcome and what was done…" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">
              Invoice / mechanic record (physical copy) <span className="text-red-600">*</span>
            </label>
            <p className="text-[10px] text-surface-500 mb-1.5">Required — upload a scan or photo of the invoice or workshop record.</p>
            <input
              ref={closeResolutionFileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
              className="text-sm w-full"
              onChange={(e) => setCloseResolutionFile(e.target.files?.[0] || null)}
            />
            {closeResolutionFile && <p className="text-xs text-emerald-700 mt-1">Selected: {closeResolutionFile.name}</p>}
            {hasResolutionProof && !closeResolutionFile && (
              <p className="text-xs text-emerald-700 mt-1">A resolution document is already attached to this job card.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspection file (optional)</label>
            <p className="text-[10px] text-surface-500 mb-1.5">Optional — attach a copy of the completed inspection report (PDF or image).</p>
            <input
              ref={closeInspectionFileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
              className="text-sm w-full"
              onChange={(e) => setCloseInspectionFile(e.target.files?.[0] || null)}
            />
            {closeInspectionFile && <p className="text-xs text-surface-600 mt-1">Selected: {closeInspectionFile.name}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Suggested next maintenance date</label>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={fc} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeJobCard}
              disabled={saving || !linkedInspectionId || !finalRes.trim() || (!closeResolutionFile && !hasResolutionProof)}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Closing…' : 'Close job card'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCloseForm(false);
                setCloseInspectionFile(null);
                setCloseResolutionFile(null);
              }}
              className="px-4 py-2.5 rounded-lg border border-surface-200 text-sm font-medium hover:bg-surface-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Job cards list ───
function JobCardsTab({ onOpenCard }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'all', provider_type: 'all', search: '' });
  const ff = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    api.jobCards.list(filters).then((d) => setCards(d.jobCards || [])).catch(() => {}).finally(() => setLoading(false));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={filters.search} onChange={(e) => ff('search', e.target.value)} placeholder="Search job cards…" className={fc} />
          <select value={filters.status} onChange={(e) => ff('status', e.target.value)} className={fc}>
            <option value="all">All statuses</option>
            {Object.entries(JC_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filters.provider_type} onChange={(e) => ff('provider_type', e.target.value)} className={fc}>
            <option value="all">All providers</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-surface-500 py-8 text-center animate-pulse">Loading job cards…</div>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500">No job cards match your filters.</div>
      ) : (
        <div className="space-y-3">
          {cards.map((jc) => (
            <div key={jc.id} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm hover:bg-surface-50/50 transition-colors">
              <button type="button" onClick={() => onOpenCard(jc.id)} className="w-full text-left">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold text-brand-800">{jc.job_card_number}</span>
                  {statusBadge(jc.status)}
                  <span className="text-sm text-surface-700">{jc.truck_reg || jc.fleet_registration || '—'}</span>
                  {jc.trailer_registration && <span className="text-xs text-surface-500">/ {jc.trailer_registration}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-surface-500">
                  <span>{jc.provider_type === 'external' ? 'External' : 'Internal'} — {jc.provider_company_name || '—'}</span>
                  <span>{jc.item_count || 0} items · R {Number(jc.items_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  <span>Created {formatDateTime(jc.created_at)}</span>
                  {jc.completed_at && <span>Closed {formatDateTime(jc.completed_at)}</span>}
                  {jc.inspection_ref && <span className="text-blue-700 font-medium">Inspection: {jc.inspection_ref}</span>}
                </div>
                {jc.description && <p className="mt-1 text-sm text-surface-600 truncate">{jc.description}</p>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───
const TABS = [
  { id: 'queue', label: 'Maintenance queue' },
  { id: 'job-cards', label: 'Job cards' },
];

export default function WorkshopManagementPage() {
  const [tab, setTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [trucks, setTrucks] = useState([]);
  const [users, setUsers] = useState([]);
  const [createFor, setCreateFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openCardId, setOpenCardId] = useState(null);

  const loadQueue = useCallback(() => {
    setQueueLoading(true);
    api.maintenanceQueue().then((d) => setQueue(d.queue || [])).catch(() => {}).finally(() => setQueueLoading(false));
  }, []);

  useEffect(() => {
    loadQueue();
    contractorApi.trucks.list().then((d) => setTrucks(d.trucks || [])).catch(() => {});
    api.users().then((d) => setUsers(d.users || [])).catch(() => {});
  }, [loadQueue]);

  const handleCreateJobCard = async (form) => {
    setSaving(true);
    setError('');
    try {
      const result = await api.jobCards.create(form);
      setCreateFor(null);
      loadQueue();
      if (result.jobCard?.id) { setOpenCardId(result.jobCard.id); setTab('job-cards'); }
    } catch (e) { setError(e?.message || 'Create failed'); }
    finally { setSaving(false); }
  };

  if (openCardId) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Workshop management</h1>
        </div>
        <JobCardDetail cardId={openCardId} onBack={() => { setOpenCardId(null); loadQueue(); }} users={users} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Workshop management</h1>
          <InfoHint
            title="Workshop management"
            text="View trucks scheduled for maintenance and create job cards. Each job card tracks parts, labour, costs, attachments, and timestamped progress notes. When closing a job card, link a completed inspection, enter a final resolution, and upload the physical invoice or mechanic record (required). You may also attach an optional inspection file copy. Download work order reports as PDF or Excel from the job card detail."
          />
        </div>
        <div className="flex gap-2">
          <a href={api.templatePdfUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 hover:bg-red-50">Template PDF</a>
          <a href={api.templateExcelUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-emerald-200 text-sm font-medium text-emerald-800 hover:bg-emerald-50">Template Excel</a>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'bg-white text-brand-800 shadow-sm ring-1 ring-surface-200' : 'text-surface-600 hover:text-surface-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between">
          <span>{error}</span><button type="button" onClick={() => setError('')} className="text-sm font-medium">Dismiss</button>
        </div>
      )}

      {createFor && (
        <CreateJobCardForm schedule={createFor} trucks={trucks} users={users} onSave={handleCreateJobCard} saving={saving} onCancel={() => setCreateFor(null)} />
      )}

      {tab === 'queue' && !createFor && <QueueTab queue={queue} loading={queueLoading} onStartWork={(s) => setCreateFor(s)} />}
      {tab === 'job-cards' && <JobCardsTab onOpenCard={(id) => setOpenCardId(id)} />}
    </div>
  );
}
