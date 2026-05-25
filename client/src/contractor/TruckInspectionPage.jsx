import { useState, useEffect, useCallback, useRef } from 'react';
import { truckInspection as api, contractor as contractorApi } from '../api';
import InfoHint from '../components/InfoHint.jsx';
import { todayYmd } from '../lib/appTime.js';

const INSPECTION_TYPES = [
  { value: 'pre_trip', label: 'Pre-trip' },
  { value: 'post_trip', label: 'Post-trip' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual / COR' },
  { value: 'ad_hoc', label: 'Ad-hoc / spot check' },
];
const INSPECTOR_ROLES = [
  { value: 'driver', label: 'Truck driver' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'mechanic', label: 'Mechanic' },
  { value: 'manager', label: 'Manager' },
];
const RESULTS = { pass: 'Pass', fail: 'Fail', 'n/a': 'N/A', not_checked: '—' };
const RESULT_COLORS = {
  pass: 'bg-emerald-500 text-white',
  fail: 'bg-red-500 text-white',
  'n/a': 'bg-surface-300 text-surface-700',
  not_checked: 'bg-surface-100 text-surface-400',
};
const SEVERITIES = ['minor', 'major', 'critical'];

function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }); }
function formatDateTime(d) { if (!d) return '—'; return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

const fc = 'w-full px-3 py-2 rounded-lg border border-surface-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-white';

function resultBadge(r) {
  const v = String(r || 'not_checked').toLowerCase();
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${RESULT_COLORS[v] || RESULT_COLORS.not_checked}`}>{RESULTS[v] || '—'}</span>;
}

function overallBadge(r) {
  const v = String(r || 'pending').toLowerCase();
  const cls = v === 'pass' ? 'bg-emerald-100 text-emerald-800 ring-emerald-300' : v === 'fail' ? 'bg-red-100 text-red-800 ring-red-300' : 'bg-amber-100 text-amber-800 ring-amber-300';
  return <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ring-1 ${cls}`}>{v === 'pass' ? 'PASSED' : v === 'fail' ? 'FAILED' : 'INCOMPLETE'}</span>;
}

// ─── Inspection form ───
function InspectionForm({ checklist, trucks, users, onSubmit, saving }) {
  const [meta, setMeta] = useState({
    truck_id: '', fleet_registration: '', trailer_registration: '', odometer_reading: '',
    inspection_date: todayYmd(), inspection_type: 'pre_trip',
    inspector_role: 'driver', inspector_user_id: '', inspector_name: '', inspector_company: '',
    general_comments: '', signed_off: false,
  });
  const m = (k, v) => setMeta((p) => ({ ...p, [k]: v }));

  const [itemResults, setItemResults] = useState(() => {
    const map = {};
    for (const cat of checklist) {
      for (const it of cat.items) {
        map[it.code] = { result: 'not_checked', comment: '', severity: '' };
      }
    }
    return map;
  });

  const [expandedCat, setExpandedCat] = useState(checklist[0]?.category || '');
  const [commentOpen, setCommentOpen] = useState({});
  const fileRefs = useRef({});

  const setResult = (code, result) => setItemResults((p) => ({ ...p, [code]: { ...p[code], result } }));
  const setComment = (code, comment) => setItemResults((p) => ({ ...p, [code]: { ...p[code], comment } }));
  const setSeverity = (code, severity) => setItemResults((p) => ({ ...p, [code]: { ...p[code], severity } }));

  const handleTruckPick = (id) => {
    m('truck_id', id);
    if (id) {
      const t = trucks.find((x) => String(x.id) === id);
      if (t) {
        setMeta((p) => ({ ...p, truck_id: id, fleet_registration: t.registration || '', trailer_registration: t.trailer_1_reg_no || '' }));
      }
    }
  };

  const handleUserPick = (id) => {
    m('inspector_user_id', id);
    if (id) {
      const u = users.find((x) => String(x.id) === id);
      if (u) m('inspector_name', u.full_name || '');
    }
  };

  const allItems = checklist.flatMap((c) => c.items.map((it) => ({ ...it, category: c.category })));
  const totalItems = allItems.length;
  const failedCount = allItems.filter((it) => itemResults[it.code]?.result === 'fail').length;
  const passedCount = allItems.filter((it) => itemResults[it.code]?.result === 'pass').length;
  const naCount = allItems.filter((it) => ['n/a', 'na'].includes(itemResults[it.code]?.result)).length;
  const checkedCount = passedCount + failedCount + naCount;
  const progressPct = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;
  const autoDetectedFailures = allItems.filter((it) => itemResults[it.code]?.result === 'fail');

  const submit = () => {
    const items = allItems.map((it, idx) => ({
      category: it.category,
      item_code: it.code,
      item_label: it.label,
      result: itemResults[it.code]?.result || 'not_checked',
      severity: itemResults[it.code]?.severity || null,
      comment: itemResults[it.code]?.comment || null,
      sort_order: idx,
    }));
    onSubmit({ ...meta, items, odometer_reading: meta.odometer_reading ? Number(meta.odometer_reading) : null });
  };

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-sm font-semibold text-surface-900">Inspection progress</span>
          <span className="text-sm font-bold text-surface-700 tabular-nums">{checkedCount}/{totalItems} ({progressPct}%)</span>
        </div>
        <div className="h-3 rounded-full bg-surface-100 overflow-hidden">
          <div className="h-full rounded-full transition-all bg-gradient-to-r from-brand-600 to-indigo-500" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-xs text-surface-600">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500" />{passedCount} pass</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500" />{failedCount} fail</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-surface-300" />{naCount} N/A</span>
        </div>
      </div>

      {/* Auto failure detection */}
      {autoDetectedFailures.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-red-800">Automatic failure detection — {autoDetectedFailures.length} item(s) failed</h3>
          <ul className="space-y-1 text-sm text-red-900 max-h-40 overflow-y-auto">
            {autoDetectedFailures.map((it) => (
              <li key={it.code} className="flex items-start gap-2">
                <span className="text-[10px] font-mono text-red-600 shrink-0 mt-0.5">{it.code}</span>
                <span>{it.label}</span>
                {itemResults[it.code]?.severity && <span className="text-[10px] uppercase font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">{itemResults[it.code].severity}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta form */}
      <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-surface-900">Inspection details</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Fleet / Truck *</label>
            <select value={meta.truck_id} onChange={(e) => handleTruckPick(e.target.value)} className={fc}>
              <option value="">— Select —</option>
              {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration} {t.make_model ? `(${t.make_model})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Trailer registration</label>
            <input value={meta.trailer_registration} onChange={(e) => m('trailer_registration', e.target.value)} className={fc} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">ODO reading (km)</label>
            <input type="number" step="0.1" min="0" value={meta.odometer_reading} onChange={(e) => m('odometer_reading', e.target.value)} className={fc} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspection date *</label>
            <input type="date" value={meta.inspection_date} onChange={(e) => m('inspection_date', e.target.value)} className={fc} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspection type</label>
            <select value={meta.inspection_type} onChange={(e) => m('inspection_type', e.target.value)} className={fc}>
              {INSPECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspector role *</label>
            <select value={meta.inspector_role} onChange={(e) => m('inspector_role', e.target.value)} className={fc}>
              {INSPECTOR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspector (select user)</label>
            <select value={meta.inspector_user_id} onChange={(e) => handleUserPick(e.target.value)} className={fc}>
              <option value="">— Type name below —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspector name *</label>
            <input value={meta.inspector_name} onChange={(e) => m('inspector_name', e.target.value)} className={fc} placeholder="Full name" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Inspector company / contractor</label>
            <input value={meta.inspector_company} onChange={(e) => m('inspector_company', e.target.value)} className={fc} />
          </div>
        </div>
      </div>

      {/* Checklist categories */}
      <div className="space-y-3">
        {checklist.map((cat) => {
          const isOpen = expandedCat === cat.category;
          const catItems = cat.items;
          const catFails = catItems.filter((it) => itemResults[it.code]?.result === 'fail').length;
          const catChecked = catItems.filter((it) => itemResults[it.code]?.result !== 'not_checked').length;
          return (
            <div key={cat.category} className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
              <button type="button" onClick={() => setExpandedCat(isOpen ? '' : cat.category)} className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-surface-50/50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-surface-900">{cat.category}</span>
                  <span className="text-[10px] text-surface-500 tabular-nums">{catChecked}/{catItems.length}</span>
                  {catFails > 0 && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-800">{catFails} fail</span>}
                </div>
                <span className="text-surface-400">{isOpen ? '▼' : '▶'}</span>
              </button>
              {isOpen && (
                <div className="border-t border-surface-200 divide-y divide-surface-100">
                  {catItems.map((it) => {
                    const ir = itemResults[it.code] || {};
                    const isFail = ir.result === 'fail';
                    const showComment = commentOpen[it.code] || ir.comment;
                    return (
                      <div key={it.code} className={`px-5 py-3 ${isFail ? 'bg-red-50/50' : ''}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono text-surface-400 w-12 shrink-0">{it.code}</span>
                          <span className="text-sm text-surface-800 flex-1 min-w-0">{it.label}</span>
                          <div className="flex gap-1 shrink-0">
                            {['pass', 'fail', 'n/a'].map((rv) => (
                              <button key={rv} type="button" onClick={() => setResult(it.code, rv)}
                                className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg border transition-all ${ir.result === rv ? RESULT_COLORS[rv] + ' ring-2 ring-offset-1' : 'bg-white text-surface-500 border-surface-200 hover:bg-surface-50'}`}>
                                {RESULTS[rv]}
                              </button>
                            ))}
                          </div>
                          <button type="button" onClick={() => setCommentOpen((p) => ({ ...p, [it.code]: !p[it.code] }))} className="text-xs text-brand-600 hover:underline">
                            {showComment ? 'Hide' : 'Comment'}
                          </button>
                        </div>
                        {isFail && (
                          <div className="mt-2 ml-14">
                            <label className="text-[10px] uppercase text-red-700 font-semibold">Severity</label>
                            <div className="flex gap-1 mt-1">
                              {SEVERITIES.map((sev) => (
                                <button key={sev} type="button" onClick={() => setSeverity(it.code, sev)}
                                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${ir.severity === sev ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-200 hover:bg-red-50'}`}>
                                  {sev}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {(showComment || commentOpen[it.code]) && (
                          <div className="mt-2 ml-14">
                            <textarea value={ir.comment || ''} onChange={(e) => setComment(it.code, e.target.value)} rows={2} placeholder="Add comment or observation…" className={`${fc} text-xs`} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* General comments & submit */}
      <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">General comments</label>
          <textarea value={meta.general_comments} onChange={(e) => m('general_comments', e.target.value)} rows={3} className={fc} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={meta.signed_off} onChange={(e) => m('signed_off', e.target.checked)} className="rounded border-surface-300" />
          I confirm this inspection has been completed accurately
        </label>
        <button type="button" onClick={submit} disabled={saving || !meta.inspector_name || !meta.inspection_date}
          className="px-6 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Submitting…' : 'Submit inspection'}
        </button>
      </div>
    </div>
  );
}

// ─── Inspection detail view ───
function InspectionDetail({ inspectionId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    api.get(inspectionId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [inspectionId]);

  if (loading) return <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading inspection…</div>;
  if (!data?.inspection) return <div className="text-sm text-red-600 py-8 text-center">Inspection not found.</div>;

  const insp = data.inspection;
  const items = data.items || [];
  const attachments = data.attachments || [];
  const categories = [...new Set(items.map((it) => it.category))];

  const uploadFiles = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try { await api.uploadAttachments(inspectionId, fd); const d = await api.get(inspectionId); setData(d); } catch (err) { alert(err?.message || 'Upload failed'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-brand-700 hover:underline">← Back to history</button>
        <div className="flex gap-2">
          <a href={api.exportPdfUrl(inspectionId)} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-800 hover:bg-red-50">Download PDF</a>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-surface-900">{insp.truck_reg || insp.fleet_registration || '—'}</h2>
          {overallBadge(insp.overall_result)}
          {insp.reference_number && <span className="text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">{insp.reference_number}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Date</span>{formatDate(insp.inspection_date)}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Type</span>{(insp.inspection_type || '').replace(/_/g, ' ')}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Inspector</span>{insp.inspector_name} ({(insp.inspector_role || '').replace(/_/g, ' ')})</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Company</span>{insp.inspector_company || '—'}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">ODO</span>{insp.odometer_reading != null ? `${Number(insp.odometer_reading).toLocaleString()} km` : '—'}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Score</span>{insp.passed_items} pass / {insp.failed_items} fail / {insp.na_items} N/A of {insp.total_items}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Signed off</span>{insp.signed_off ? `Yes — ${formatDateTime(insp.signed_off_at)}` : 'No'}</div>
          <div><span className="text-[10px] uppercase text-surface-500 font-semibold block">Created by</span>{insp.created_by_name || '—'}</div>
        </div>
        {insp.general_comments && <p className="text-sm text-surface-700 whitespace-pre-wrap border-t border-surface-100 pt-3">{insp.general_comments}</p>}
      </div>

      {insp.failure_summary && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
          <h3 className="text-xs font-bold uppercase text-red-800 mb-2">Failure summary (auto-detected)</h3>
          <p className="text-sm text-red-900 whitespace-pre-wrap">{insp.failure_summary}</p>
        </div>
      )}

      {/* Checklist results */}
      <div className="space-y-3">
        {categories.map((cat) => {
          const catItems = items.filter((it) => it.category === cat);
          return (
            <div key={cat} className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-surface-50 border-b border-surface-200 flex items-center gap-3">
                <span className="text-sm font-semibold text-surface-900">{cat}</span>
                <span className="text-xs text-surface-500">{catItems.filter((i) => i.result === 'pass').length} pass · {catItems.filter((i) => i.result === 'fail').length} fail</span>
              </div>
              <div className="divide-y divide-surface-100">
                {catItems.map((it) => (
                  <div key={it.id} className={`px-5 py-2.5 flex flex-wrap items-center gap-2 ${it.result === 'fail' ? 'bg-red-50/50' : ''}`}>
                    <span className="text-[10px] font-mono text-surface-400 w-12 shrink-0">{it.item_code}</span>
                    <span className="text-sm text-surface-800 flex-1 min-w-0">{it.item_label}</span>
                    {resultBadge(it.result)}
                    {it.severity && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-800">{it.severity}</span>}
                    {it.comment && <p className="w-full ml-14 text-xs text-surface-600 italic mt-0.5">{it.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Attachments */}
      <div className="rounded-xl border border-surface-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-surface-900">Attachments ({attachments.length})</h3>
          <>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-medium text-brand-700 hover:underline">+ Upload</button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={uploadFiles} />
          </>
        </div>
        {attachments.length > 0 ? (
          <ul className="space-y-2">
            {attachments.map((att) => (
              <li key={att.id} className="flex justify-between items-center gap-2 text-sm border-b border-surface-100 pb-2">
                <a href={api.attachmentDownloadUrl(att.id)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline truncate">{att.file_name}</a>
                <span className="text-xs text-surface-500 shrink-0">{att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''} · {formatDateTime(att.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-surface-500">No attachments.</p>
        )}
      </div>
    </div>
  );
}

// ─── History tab ───
function HistoryTab({ trucks, onOpenInspection }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ result: 'all', inspector_role: 'all', truck_id: '', search: '', from: '', to: '' });
  const ff = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    api.list(filters).then((d) => setItems(d.inspections || [])).catch(() => {}).finally(() => setLoading(false));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input value={filters.search} onChange={(e) => ff('search', e.target.value)} placeholder="Search…" className={fc} />
          <select value={filters.result} onChange={(e) => ff('result', e.target.value)} className={fc}>
            <option value="all">All results</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="incomplete">Incomplete</option>
          </select>
          <select value={filters.inspector_role} onChange={(e) => ff('inspector_role', e.target.value)} className={fc}>
            <option value="all">All roles</option>
            {INSPECTOR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={filters.truck_id} onChange={(e) => ff('truck_id', e.target.value)} className={fc}>
            <option value="">All trucks</option>
            {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(e) => ff('from', e.target.value)} className={fc} title="From" />
          <input type="date" value={filters.to} onChange={(e) => ff('to', e.target.value)} className={fc} title="To" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-surface-500 py-8 text-center animate-pulse">Loading inspections…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500">No inspections found.</div>
      ) : (
        <div className="space-y-3">
          {items.map((insp) => (
            <button key={insp.id} type="button" onClick={() => onOpenInspection(insp.id)} className="w-full text-left rounded-xl border border-surface-200 bg-white p-4 shadow-sm hover:bg-surface-50/50 transition-colors">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-surface-900">{insp.truck_reg || insp.fleet_registration || '—'}</span>
                {overallBadge(insp.overall_result)}
                {insp.reference_number && <span className="text-xs font-semibold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">{insp.reference_number}</span>}
                <span className="text-xs text-surface-500">{formatDate(insp.inspection_date)}</span>
                <span className="text-xs text-surface-500 capitalize">{(insp.inspection_type || '').replace(/_/g, ' ')}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-surface-500">
                <span>By {insp.inspector_name} ({(insp.inspector_role || '').replace(/_/g, ' ')})</span>
                <span>{insp.passed_items} pass · {insp.failed_items} fail · {insp.na_items} N/A</span>
                {insp.failure_summary && <span className="text-red-600 font-semibold">Has failures</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───
const TABS = [
  { id: 'inspect', label: 'New inspection' },
  { id: 'history', label: 'History' },
];

export default function TruckInspectionPage() {
  const [tab, setTab] = useState('inspect');
  const [checklist, setChecklist] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [openInspId, setOpenInspId] = useState(null);

  useEffect(() => {
    api.checklist().then((d) => setChecklist(d.checklist || [])).catch(() => {});
    contractorApi.trucks.list().then((d) => setTrucks(d.trucks || [])).catch(() => {});
    api.users().then((d) => setUsers(d.users || [])).catch(() => {});
  }, []);

  const handleSubmit = async (body) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.create(body);
      const ref = result.inspection?.reference_number ? ` (${result.inspection.reference_number})` : '';
      const autoMsg = result.autoSchedule ? ' — URGENT maintenance schedule auto-created.' : '';
      setSuccess(`Inspection submitted${ref} — result: ${(result.inspection?.overall_result || 'pending').toUpperCase()}${autoMsg}`);
      if (result.inspection?.id) { setOpenInspId(result.inspection.id); setTab('history'); }
    } catch (e) { setError(e?.message || 'Submit failed'); }
    finally { setSaving(false); }
  };

  if (openInspId) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Truck inspection</h1>
        <InspectionDetail inspectionId={openInspId} onBack={() => setOpenInspId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 tracking-tight">Truck inspection</h1>
          <InfoHint
            title="SA standard truck inspection"
            text="Perform South African standard inspections for side tipper coal trucks. The checklist covers 12 categories per SANS, NRT Act, NRCS, and AARTO requirements: cab & exterior, lights, engine, brakes, steering, wheels, hydraulics, body & chassis, electrical, safety equipment, documentation, and environmental compliance. Failed items are auto-detected and highlighted. Download professional PDF inspection reports from the history view."
          />
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-100 border border-surface-200 w-fit">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? 'bg-white text-brand-800 shadow-sm ring-1 ring-surface-200' : 'text-surface-600 hover:text-surface-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</div>}
      {success && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2">{success}</div>}

      {tab === 'inspect' && checklist.length > 0 && <InspectionForm checklist={checklist} trucks={trucks} users={users} onSubmit={handleSubmit} saving={saving} />}
      {tab === 'inspect' && checklist.length === 0 && <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading checklist…</div>}
      {tab === 'history' && <HistoryTab trucks={trucks} onOpenInspection={(id) => setOpenInspId(id)} />}
    </div>
  );
}
