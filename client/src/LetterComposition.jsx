import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  letters as lettersApi,
  tabAccess as tabAccessApi,
  downloadAttachmentWithAuth,
} from './api';
import {
  LETTER_TYPES,
  LETTER_TYPE_IDS,
  LETTER_TEMPLATES,
  LETTER_ACCENTS,
  letterTypeLabel,
} from './lib/letterTypes.js';
import SignaturePad from './components/SignaturePad.jsx';
import ManagePageTabAccess from './components/ManagePageTabAccess.jsx';
import { todayYmd } from './lib/appTime.js';

const TYPE_LABELS = Object.fromEntries(LETTER_TYPES.map((t) => [t.id, t.label]));

function emptyForm(type, user) {
  return {
    letter_type: type,
    title: '',
    template_key: 'executive',
    accent_color: 'navy',
    recipient_name: '',
    recipient_title: '',
    recipient_company: '',
    recipient_address: '',
    recipient_email: '',
    letter_date: todayYmd(),
    reference_line: '',
    intro_body: '',
    closing_text: 'Yours faithfully,',
    signatory_name: user?.full_name || '',
    signatory_title: '',
    signature_data_url: '',
    policy_refs: [],
  };
}

export default function LetterComposition() {
  const { user } = useAuth();
  const canManageAccess = user?.role === 'super_admin' || user?.role === 'tenant_admin';

  const [allowedTabs, setAllowedTabs] = useState(LETTER_TYPE_IDS);
  const [tabLoading, setTabLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('warning');

  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const [view, setView] = useState('list'); // 'list' | 'editor'
  const [editingId, setEditingId] = useState(null);
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('draft');
  const [form, setForm] = useState(() => emptyForm('warning', user));
  const [sections, setSections] = useState([]);
  const [autosave, setAutosave] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [policyOptions, setPolicyOptions] = useState([]);

  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [showEmail, setShowEmail] = useState(false);
  const [emailForm, setEmailForm] = useState({ to: '', cc: '', subject: '', message: '' });
  const [emailSending, setEmailSending] = useState(false);
  const [emailInfo, setEmailInfo] = useState('');

  const [permissions, setPermissions] = useState([]);
  const [accessUsers, setAccessUsers] = useState([]);

  const autosaveTimer = useRef(null);
  const previewTimer = useRef(null);
  const previewObjUrl = useRef('');

  // ---- Tab access ----
  useEffect(() => {
    let alive = true;
    tabAccessApi.myTabs('letters')
      .then((d) => {
        if (!alive) return;
        const tabs = d.tabs?.length ? d.tabs.filter((t) => LETTER_TYPE_IDS.includes(t)) : LETTER_TYPE_IDS;
        setAllowedTabs(tabs.length ? tabs : LETTER_TYPE_IDS);
        setActiveTab((prev) => (tabs.includes(prev) ? prev : tabs[0] || 'warning'));
      })
      .catch(() => setAllowedTabs(LETTER_TYPE_IDS))
      .finally(() => alive && setTabLoading(false));
    return () => { alive = false; };
  }, []);

  // ---- Policy options (once) ----
  useEffect(() => {
    lettersApi.policies().then((d) => setPolicyOptions(d.policies || [])).catch(() => {});
  }, []);

  // ---- Load list + templates whenever the active type changes ----
  const loadList = useCallback((type) => {
    setListLoading(true);
    lettersApi.list(type)
      .then((d) => setList(d.letters || []))
      .catch((e) => setError(e?.message || 'Failed to load letters'))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'manage-access') return undefined;
    loadList(activeTab);
    let alive = true;
    setTemplates([]);
    setTemplatesLoading(true);
    lettersApi.templates(activeTab)
      .then((d) => { if (alive) setTemplates(d.templates || []); })
      .catch(() => { if (alive) setTemplates([]); })
      .finally(() => { if (alive) setTemplatesLoading(false); });
    return () => { alive = false; };
  }, [activeTab, loadList]);

  // ---- Preview (fetch the real server PDF as a blob, with credentials) ----
  const refreshPreview = useCallback((id) => {
    if (!id) return;
    setPreviewLoading(true);
    fetch(lettersApi.pdfUrl(id), { credentials: 'include' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('preview failed'))))
      .then((blob) => {
        if (previewObjUrl.current) URL.revokeObjectURL(previewObjUrl.current);
        const url = URL.createObjectURL(blob);
        previewObjUrl.current = url;
        setPreviewUrl(url);
      })
      .catch(() => {})
      .finally(() => setPreviewLoading(false));
  }, []);

  const schedulePreview = useCallback((id) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => refreshPreview(id), 900);
  }, [refreshPreview]);

  useEffect(() => () => {
    if (previewObjUrl.current) URL.revokeObjectURL(previewObjUrl.current);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  // ---- Editor helpers ----
  const startNew = () => {
    setEditingId(null);
    setReference('');
    setStatus('draft');
    setForm(emptyForm(activeTab, user));
    setSections([]);
    setAutosave('');
    setError('');
    setPreviewUrl('');
    setView('editor');
  };

  const openLetter = async (id) => {
    setError('');
    setBusy(true);
    try {
      const { letter } = await lettersApi.get(id);
      setEditingId(letter.id);
      setReference(letter.reference_number || '');
      setStatus(letter.status || 'draft');
      setForm({
        letter_type: letter.letter_type || activeTab,
        title: letter.title || '',
        template_key: letter.template_key || 'executive',
        accent_color: letter.accent_color || 'navy',
        recipient_name: letter.recipient_name || '',
        recipient_title: letter.recipient_title || '',
        recipient_company: letter.recipient_company || '',
        recipient_address: letter.recipient_address || '',
        recipient_email: letter.recipient_email || '',
        letter_date: letter.letter_date ? String(letter.letter_date).slice(0, 10) : todayYmd(),
        reference_line: letter.reference_line || '',
        intro_body: letter.intro_body || '',
        closing_text: letter.closing_text || 'Yours faithfully,',
        signatory_name: letter.signatory_name || '',
        signatory_title: letter.signatory_title || '',
        signature_data_url: letter.signature_data_url || '',
        policy_refs: Array.isArray(letter.policy_refs)
          ? letter.policy_refs
          : (() => { try { return JSON.parse(letter.policy_refs || '[]'); } catch { return []; } })(),
      });
      setSections((letter.sections || []).map((s) => ({ heading: s.heading || '', body: s.body || '' })));
      setView('editor');
      refreshPreview(letter.id);
    } catch (e) {
      setError(e?.message || 'Failed to open letter');
    } finally {
      setBusy(false);
    }
  };

  const buildPayload = (f = form, secs = sections) => ({
    ...f,
    sections: secs,
  });

  const createDraft = async (overrides = {}) => {
    setBusy(true);
    setError('');
    try {
      const payload = buildPayload({ ...form, ...overrides.form }, overrides.sections || sections);
      const { letter } = await lettersApi.create(payload);
      setEditingId(letter.id);
      setReference(letter.reference_number || '');
      setStatus(letter.status || 'draft');
      setAutosave(`Saved ${new Date().toLocaleTimeString()}`);
      loadList(activeTab);
      refreshPreview(letter.id);
      return letter.id;
    } catch (e) {
      setError(e?.message || 'Failed to create letter');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const persist = useCallback(async (id, f, secs) => {
    if (!id) return;
    try {
      setAutosave('Saving…');
      const { letter } = await lettersApi.update(id, buildPayload(f, secs));
      setReference(letter.reference_number || '');
      setAutosave(`Saved ${new Date().toLocaleTimeString()}`);
      schedulePreview(id);
    } catch (e) {
      setAutosave('');
      setError(e?.message || 'Auto-save failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulePreview]);

  const scheduleAutosave = useCallback((nextForm, nextSections) => {
    if (!editingId) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setAutosave('Editing…');
    autosaveTimer.current = setTimeout(() => persist(editingId, nextForm, nextSections), 1200);
  }, [editingId, persist]);

  const setField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      scheduleAutosave(next, sections);
      return next;
    });
  };

  const updateSections = (next) => {
    setSections(next);
    scheduleAutosave(form, next);
  };

  const addSection = () => updateSections([...sections, { heading: '', body: '' }]);
  const updateSection = (i, key, val) => updateSections(sections.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  const removeSection = (i) => updateSections(sections.filter((_, idx) => idx !== i));
  const moveSection = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    updateSections(next);
  };

  const applyTemplate = async (tpl) => {
    const nextForm = {
      ...form,
      intro_body: tpl.intro_body || '',
      closing_text: tpl.closing_text || form.closing_text,
      title: form.title || tpl.template_name,
    };
    const nextSections = (tpl.sections || []).map((s) => ({ heading: s.heading || '', body: s.body || '' }));
    setForm(nextForm);
    setSections(nextSections);
    if (editingId) {
      persist(editingId, nextForm, nextSections);
    } else {
      await createDraft({ form: nextForm, sections: nextSections });
    }
  };

  const togglePolicy = (p) => {
    const exists = (form.policy_refs || []).some((r) => String(r.id) === String(p.id));
    const next = exists
      ? form.policy_refs.filter((r) => String(r.id) !== String(p.id))
      : [...(form.policy_refs || []), { id: p.id, reference_number: p.reference_number, title: p.title }];
    setField('policy_refs', next);
  };

  const ensureSavedThen = async (fn) => {
    let id = editingId;
    if (!id) {
      id = await createDraft();
      if (!id) return;
    } else if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      await persist(id, form, sections);
    }
    fn(id);
  };

  const downloadPdf = () => ensureSavedThen((id) => {
    const safeRef = (reference || 'letter').replace(/[^\w.-]+/g, '_');
    downloadAttachmentWithAuth(lettersApi.pdfUrl(id), `${safeRef}.pdf`).catch((e) => setError(e?.message || 'Download failed'));
  });

  const openEmail = () => ensureSavedThen(() => {
    setEmailInfo('');
    setEmailForm({
      to: form.recipient_email || '',
      cc: '',
      subject: `${letterTypeLabel(form.letter_type)} — ${form.title || reference}`,
      message: 'Please find the attached letter.',
    });
    setShowEmail(true);
  });

  const sendEmail = async () => {
    if (!editingId) return;
    setEmailSending(true);
    setEmailInfo('');
    try {
      await lettersApi.email(editingId, emailForm);
      setEmailInfo('Email sent successfully.');
      setTimeout(() => setShowEmail(false), 900);
    } catch (e) {
      setEmailInfo(e?.message || 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  };

  const exportQuickSign = () => ensureSavedThen(async (id) => {
    setBusy(true);
    try {
      await lettersApi.exportToQuickSign(id);
      setEmailInfo('');
      setError('');
      setAutosave('Exported to Quick Sign → Exported PDFs');
    } catch (e) {
      setError(e?.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  });

  const deleteLetter = async (id) => {
    if (!window.confirm('Delete this letter? This cannot be undone.')) return;
    try {
      await lettersApi.remove(id);
      if (editingId === id) { setView('list'); setEditingId(null); }
      loadList(activeTab);
    } catch (e) {
      setError(e?.message || 'Delete failed');
    }
  };

  const typeReferencesPolicies = LETTER_TYPES.find((t) => t.id === form.letter_type)?.referencesPolicies;

  // ---- Render ----
  const visibleTypeTabs = LETTER_TYPES.filter((t) => allowedTabs.includes(t.id));

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Letter composition</h1>
          <p className="text-sm text-surface-500 mt-0.5">Draft professional corporate letters with custom sections, signatures, advanced PDF templates, email and Quick Sign export.</p>
        </div>
        {view === 'editor' && (
          <button type="button" onClick={() => { setView('list'); setEditingId(null); }} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm font-medium hover:bg-surface-50">
            ← Back to list
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Type tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {visibleTypeTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setActiveTab(t.id); setView('list'); setEditingId(null); }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === t.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-200 text-surface-700 hover:bg-surface-50'}`}
          >
            {t.label}
          </button>
        ))}
        {canManageAccess && (
          <button
            type="button"
            onClick={() => { setActiveTab('manage-access'); setView('list'); }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === 'manage-access' ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-200 text-surface-700 hover:bg-surface-50'}`}
          >
            Manage tab access
          </button>
        )}
      </div>

      {activeTab === 'manage-access' && canManageAccess ? (
        <ManagePageTabAccess
          pageKey="letters"
          pageLabel="Letter composition"
          allTabIds={LETTER_TYPE_IDS}
          tabLabels={TYPE_LABELS}
          permissions={permissions}
          setPermissions={setPermissions}
          users={accessUsers}
          setUsers={setAccessUsers}
          onError={setError}
        />
      ) : view === 'list' ? (
        <ListView
          typeLabel={letterTypeLabel(activeTab)}
          loading={listLoading}
          list={list}
          templates={templates}
          templatesLoading={templatesLoading}
          onNew={startNew}
          onOpen={openLetter}
          onDelete={deleteLetter}
          onUseTemplate={(tpl) => { startNew(); setTimeout(() => applyTemplate(tpl), 0); }}
        />
      ) : (
        <EditorView
          user={user}
          form={form}
          setField={setField}
          sections={sections}
          addSection={addSection}
          updateSection={updateSection}
          removeSection={removeSection}
          moveSection={moveSection}
          templates={templates}
          applyTemplate={applyTemplate}
          policyOptions={policyOptions}
          togglePolicy={togglePolicy}
          typeReferencesPolicies={typeReferencesPolicies}
          reference={reference}
          status={status}
          autosave={autosave}
          busy={busy}
          editingId={editingId}
          onCreate={() => createDraft()}
          previewUrl={previewUrl}
          previewLoading={previewLoading}
          onRefreshPreview={() => ensureSavedThen((id) => refreshPreview(id))}
          onDownload={downloadPdf}
          onEmail={openEmail}
          onExport={exportQuickSign}
        />
      )}

      {showEmail && (
        <EmailModal
          form={emailForm}
          setForm={setEmailForm}
          sending={emailSending}
          info={emailInfo}
          onClose={() => setShowEmail(false)}
          onSend={sendEmail}
        />
      )}
    </div>
  );
}

function ListView({ typeLabel, loading, list, templates, templatesLoading, onNew, onOpen, onDelete, onUseTemplate }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-800">{typeLabel}s</h2>
          <button type="button" onClick={onNew} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">+ New letter</button>
        </div>
        {loading ? (
          <p className="text-sm text-surface-500">Loading…</p>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 p-8 text-center">
            <p className="text-sm text-surface-600">No letters yet. Start from a template on the right, or create a blank letter.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((l) => (
              <li key={l.id} className="rounded-xl border border-surface-200 bg-white p-3 flex items-center justify-between gap-3 hover:border-brand-300 transition-colors">
                <button type="button" onClick={() => onOpen(l.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-surface-900 truncate">{l.title || 'Untitled letter'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${l.status === 'draft' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>{l.status}</span>
                  </div>
                  <div className="text-xs text-surface-500 mt-0.5 truncate">
                    {l.reference_number}{l.recipient_name ? ` · ${l.recipient_name}` : ''}{l.recipient_company ? ` · ${l.recipient_company}` : ''}
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => onOpen(l.id)} className="text-brand-600 hover:underline text-xs">Open</button>
                  <button type="button" onClick={() => onDelete(l.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-surface-800">Starter templates</h2>
        {templatesLoading ? (
          <p className="text-xs text-surface-500">Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="text-xs text-surface-500">No templates for this type.</p>
        ) : (
          <ul className="space-y-2">
            {templates.map((tpl) => (
              <li key={tpl.id} className="rounded-xl border border-surface-200 bg-white p-3">
                <p className="text-sm font-medium text-surface-900">{tpl.template_name}</p>
                {tpl.description && <p className="text-xs text-surface-500 mt-0.5">{tpl.description}</p>}
                <button type="button" onClick={() => onUseTemplate(tpl)} className="mt-2 px-2.5 py-1.5 rounded-md bg-surface-100 text-surface-700 text-xs font-medium hover:bg-surface-200">
                  Use this template
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-surface-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none';

function EditorView({
  user, form, setField, sections, addSection, updateSection, removeSection, moveSection,
  templates, applyTemplate, policyOptions, togglePolicy, typeReferencesPolicies,
  reference, status, autosave, busy, editingId, onCreate,
  previewUrl, previewLoading, onRefreshPreview, onDownload, onEmail, onExport,
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-h-0">
      {/* Editor column */}
      <div className="space-y-4 min-w-0">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-surface-800">{letterTypeLabel(form.letter_type)}</h2>
            <div className="flex items-center gap-2 text-xs">
              {reference && <span className="px-2 py-1 rounded-md bg-surface-100 text-surface-700">{reference}</span>}
              {autosave && <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">{autosave}</span>}
              {!editingId && (
                <button type="button" disabled={busy} onClick={onCreate} className="px-2.5 py-1 rounded-md bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-60">
                  {busy ? 'Creating…' : 'Create draft'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Subject / title">
              <input type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} className={inputCls} placeholder="e.g. Final written warning" />
            </Field>
            <Field label="Date">
              <input type="date" value={form.letter_date} onChange={(e) => setField('letter_date', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="PDF template">
              <select value={form.template_key} onChange={(e) => setField('template_key', e.target.value)} className={inputCls}>
                {LETTER_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.desc}</option>)}
              </select>
            </Field>
            <Field label="Accent colour">
              <div className="flex flex-wrap gap-2 pt-1">
                {LETTER_ACCENTS.map((c) => (
                  <button key={c.id} type="button" onClick={() => setField('accent_color', c.id)} title={c.name}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${form.accent_color === c.id ? 'border-surface-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c.hex }} />
                ))}
              </div>
            </Field>
          </div>
        </div>

        {/* Recipient */}
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-surface-800">Recipient</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"><input type="text" value={form.recipient_name} onChange={(e) => setField('recipient_name', e.target.value)} className={inputCls} /></Field>
            <Field label="Title / position"><input type="text" value={form.recipient_title} onChange={(e) => setField('recipient_title', e.target.value)} className={inputCls} /></Field>
            <Field label="Company"><input type="text" value={form.recipient_company} onChange={(e) => setField('recipient_company', e.target.value)} className={inputCls} /></Field>
            <Field label="Email"><input type="email" value={form.recipient_email} onChange={(e) => setField('recipient_email', e.target.value)} className={inputCls} placeholder="for email/quick sign" /></Field>
          </div>
          <Field label="Address"><textarea rows={2} value={form.recipient_address} onChange={(e) => setField('recipient_address', e.target.value)} className={inputCls} /></Field>
        </div>

        {/* Templates quick apply */}
        {templates.length > 0 && (
          <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-surface-800 mb-2">Apply a starter template</h3>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => (
                <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl)} className="px-2.5 py-1.5 rounded-md border border-surface-300 bg-white text-xs text-surface-700 hover:bg-surface-100">
                  {tpl.template_name}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-surface-400 mt-2">Applying a template replaces the opening, sections and closing.</p>
          </div>
        )}

        {/* Body */}
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-surface-800">Opening</h3>
          <textarea rows={3} value={form.intro_body} onChange={(e) => setField('intro_body', e.target.value)} className={inputCls} placeholder="Opening paragraph(s)…" />
        </div>

        {/* Sections */}
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-800">Sections</h3>
            <button type="button" onClick={addSection} className="px-2.5 py-1.5 rounded-md bg-surface-100 text-surface-700 text-xs font-medium hover:bg-surface-200">+ Add section</button>
          </div>
          {sections.length === 0 ? (
            <p className="text-xs text-surface-500">No sections yet. Build your own sections, or apply a template.</p>
          ) : (
            <div className="space-y-3">
              {sections.map((s, i) => (
                <div key={i} className="rounded-lg border border-surface-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-surface-500 w-6">{i + 1}.</span>
                    <input type="text" value={s.heading} onChange={(e) => updateSection(i, 'heading', e.target.value)} className={`${inputCls} flex-1`} placeholder="Section heading" />
                    <button type="button" onClick={() => moveSection(i, -1)} className="px-1.5 text-surface-400 hover:text-surface-700" title="Move up">↑</button>
                    <button type="button" onClick={() => moveSection(i, 1)} className="px-1.5 text-surface-400 hover:text-surface-700" title="Move down">↓</button>
                    <button type="button" onClick={() => removeSection(i)} className="px-1.5 text-red-500 hover:text-red-700" title="Remove">✕</button>
                  </div>
                  <textarea rows={4} value={s.body} onChange={(e) => updateSection(i, 'body', e.target.value)} className={inputCls} placeholder="Section body…" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Policy references (warnings) */}
        {typeReferencesPolicies && (
          <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-surface-800 mb-2">Reference company policies</h3>
            {policyOptions.length === 0 ? (
              <p className="text-xs text-surface-500">No published policies available to reference.</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-auto">
                {policyOptions.map((p) => {
                  const checked = (form.policy_refs || []).some((r) => String(r.id) === String(p.id));
                  return (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-surface-700 cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => togglePolicy(p)} className="rounded border-surface-300" />
                      <span className="truncate"><span className="text-surface-500">{p.reference_number}</span> — {p.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Closing + signature */}
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-surface-800">Closing &amp; signature</h3>
          <Field label="Closing"><textarea rows={2} value={form.closing_text} onChange={(e) => setField('closing_text', e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Signatory name"><input type="text" value={form.signatory_name} onChange={(e) => setField('signatory_name', e.target.value)} className={inputCls} /></Field>
            <Field label="Signatory title"><input type="text" value={form.signatory_title} onChange={(e) => setField('signatory_title', e.target.value)} className={inputCls} placeholder="e.g. HR Manager" /></Field>
          </div>
          <div>
            <span className="text-xs font-medium text-surface-600 block mb-1">Signature (draw below)</span>
            {form.signature_data_url && (
              <img src={form.signature_data_url} alt="signature" className="h-12 mb-1 border border-surface-200 rounded bg-white object-contain" />
            )}
            <SignaturePad width={420} height={120} onChange={(dataUrl) => setField('signature_data_url', dataUrl)} />
          </div>
        </div>
      </div>

      {/* Preview column */}
      <div className="min-w-0">
        <div className="rounded-xl border border-surface-200 bg-white shadow-sm flex flex-col sticky top-2" style={{ height: 'calc(100vh - 120px)' }}>
          <div className="p-3 border-b border-surface-200 flex items-center justify-between gap-2 bg-surface-50 flex-wrap">
            <span className="text-sm font-medium text-surface-700">PDF preview</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onRefreshPreview} className="px-2.5 py-1.5 rounded-md border border-surface-300 text-surface-700 text-xs hover:bg-surface-100">Refresh</button>
              <button type="button" onClick={onDownload} className="px-2.5 py-1.5 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-700">Download PDF</button>
              <button type="button" onClick={onEmail} className="px-2.5 py-1.5 rounded-md bg-surface-200 text-surface-800 text-xs font-medium hover:bg-surface-300">Email</button>
              <button type="button" onClick={onExport} className="px-2.5 py-1.5 rounded-md bg-surface-200 text-surface-800 text-xs font-medium hover:bg-surface-300">Export to Quick Sign</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 bg-surface-100">
            {previewLoading && <div className="p-4 text-xs text-surface-500">Generating preview…</div>}
            {previewUrl ? (
              <iframe title="Letter preview" src={previewUrl} className="w-full h-full" />
            ) : (
              <div className="p-6 text-sm text-surface-500">
                {editingId ? 'Click Refresh to generate the preview.' : 'Create the draft to generate a live PDF preview. The letterhead, page numbering and reference are added automatically from your Accounting company profile.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailModal({ form, setForm, sending, info, onClose, onSend }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-surface-900 mb-3">Email letter</h3>
        <div className="space-y-3">
          <Field label="To"><input type="text" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} className={inputCls} placeholder="recipient@example.com" /></Field>
          <Field label="CC (comma-separated, any address)"><input type="text" value={form.cc} onChange={(e) => setForm((f) => ({ ...f, cc: e.target.value }))} className={inputCls} placeholder="manager@example.com, external@other.com" /></Field>
          <Field label="Subject"><input type="text" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className={inputCls} /></Field>
          <Field label="Message"><textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className={inputCls} /></Field>
        </div>
        {info && <p className="mt-2 text-sm text-surface-600">{info}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm hover:bg-surface-50">Cancel</button>
          <button type="button" disabled={sending || !form.to} onClick={onSend} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-60">
            {sending ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </div>
    </div>
  );
}
