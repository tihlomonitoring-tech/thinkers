import { useState, useEffect, useCallback, useMemo } from 'react';
import { companyPolicies as cpApi, downloadAttachmentWithAuth } from './api';
import InfoHint from './components/InfoHint.jsx';
import PolicyBillSectionEditor from './components/PolicyBillSectionEditor.jsx';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import {
  governmentBillTemplate,
  normalizeSectionFromApi,
  prepareSectionForSave,
  autoNumberSections,
  emptyBillSection,
} from './lib/policyBillFormat.js';

const ACT_SUGGESTIONS = [
  'Occupational Health and Safety Act, 1993 (Act 85 of 1993)',
  'Labour Relations Act, 1995 (Act 66 of 1995)',
  'Basic Conditions of Employment Act, 1997 (Act 75 of 1995)',
  'Protection of Personal Information Act, 2013 (Act 4 of 2013)',
  'Companies Act, 2008 (Act 71 of 2008)',
  'National Road Traffic Act, 1996 (Act 93 of 1996)',
  'Internal — Board resolution / delegated authority',
  'Section 8: General duties of employers',
];

const STATUS_STYLES = {
  draft: 'bg-amber-100 text-amber-900',
  published: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-surface-100 text-surface-500',
};

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function emptyDraft() {
  return {
    title: '',
    act_or_section: '',
    summary: '',
    policy_type: 'bill',
    classification: 'internal',
    department_name: '',
    effective_date: '',
    requires_acknowledgement: true,
  };
}

export default function PolicyDevelopment() {
  const [navHidden, setNavHidden] = useSecondaryNavHidden('policy-development');
  const [policies, setPolicies] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [view, setView] = useState('list');
  const [policyId, setPolicyId] = useState(null);
  const [meta, setMeta] = useState(emptyDraft());
  const [sections, setSections] = useState([]);
  const [policyStatus, setPolicyStatus] = useState('draft');
  const [policyRef, setPolicyRef] = useState('');
  const [policyVersion, setPolicyVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const outline = useMemo(
    () =>
      sections.map((s, i) => ({
        i,
        line: [s.section_number, s.title].filter(Boolean).join(' — ') || `Block ${i + 1}`,
        type: s.section_type,
      })),
    [sections]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = filter === 'all' ? {} : { status: filter };
      const r = await cpApi.dev.list(params);
      setPolicies(r.policies || []);
    } catch (e) {
      setError(e?.message || 'Failed to load bills');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (view === 'list') loadList();
  }, [view, loadList]);

  const openEditor = async (id) => {
    setPolicyId(id);
    setView('edit');
    setError('');
    try {
      const r = await cpApi.dev.get(id);
      const p = r.policy;
      setMeta({
        title: p.title || '',
        act_or_section: p.act_or_section || '',
        summary: p.summary || '',
        policy_type: p.policy_type || 'bill',
        classification: p.classification || 'internal',
        department_name: p.department_name || '',
        effective_date: p.effective_date ? fmtDate(p.effective_date) : '',
        requires_acknowledgement: p.requires_acknowledgement !== false,
      });
      setSections((p.sections || []).map(normalizeSectionFromApi));
      setPolicyStatus(p.status);
      setPolicyRef(p.reference_number);
      setPolicyVersion(p.version);
    } catch (e) {
      setError(e?.message || 'Failed to load bill');
      setView('list');
    }
  };

  const startNew = () => {
    setPolicyId(null);
    setMeta(emptyDraft());
    setSections([]);
    setPolicyStatus('draft');
    setPolicyRef('');
    setPolicyVersion(0);
    setView('edit');
  };

  const saveMeta = async () => {
    if (!meta.title.trim() || !meta.act_or_section.trim()) {
      setError('Long title and governing Act / Section are required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (policyId) {
        const r = await cpApi.dev.update(policyId, meta);
        setPolicyRef(r.policy.reference_number);
        setInfo('Bill metadata saved');
      } else {
        const r = await cpApi.dev.create(meta);
        setPolicyId(r.policy.id);
        setPolicyRef(r.policy.reference_number);
        setInfo('Draft bill created — add provisions below');
      }
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSections = async () => {
    if (!policyId) {
      setError('Save bill metadata first');
      return;
    }
    setBusy(true);
    try {
      const payload = sections.map(prepareSectionForSave);
      const r = await cpApi.dev.saveSections(policyId, payload);
      setSections((r.policy.sections || []).map(normalizeSectionFromApi));
      setInfo('Provisions saved');
    } catch (e) {
      setError(e?.message || 'Failed to save provisions');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!policyId) return;
    if (!window.confirm('Publish this bill? It becomes the official PDF for employees to read and sign.')) return;
    setBusy(true);
    try {
      await cpApi.dev.saveSections(policyId, sections.map(prepareSectionForSave));
      const r = await cpApi.dev.publish(policyId, { effective_date: meta.effective_date || undefined });
      setPolicyStatus(r.policy.status);
      setPolicyVersion(r.policy.version);
      setInfo(`Published — version ${r.policy.version}`);
      loadList();
    } catch (e) {
      setError(e?.message || 'Publish failed');
    } finally {
      setBusy(false);
    }
  };

  const previewPdf = () => {
    if (!policyId) return;
    downloadAttachmentWithAuth(cpApi.dev.pdfUrl(policyId), `${policyRef || 'bill'}.pdf`).catch((e) =>
      setError(e?.message || 'PDF failed')
    );
  };

  const applyGovernmentTemplate = () => {
    if (sections.length && !window.confirm('Replace all provisions with the government bill template?')) return;
    setSections(governmentBillTemplate());
    setInfo('Government bill structure loaded — edit clauses and auto-number when ready');
  };

  const runAutoNumber = () => {
    setSections(autoNumberSections(sections));
    setInfo('Provision numbers updated (PART, sections, (1), (a)…)');
  };

  const addProvision = (type = 'section') => {
    setSections([...sections, emptyBillSection(type, '', sections.length)]);
  };

  const updateSection = (idx, section) => {
    const next = [...sections];
    next[idx] = section;
    setSections(next);
  };

  const moveSection = (idx, dir) => {
    const next = [...sections];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next.map((s, i) => ({ ...s, sort_order: i })));
  };

  const loadGovernmentLabour = async () => {
    if (!window.confirm('Load SA government labour policy drafts (BCEA, LRA, OHS, EEA, NMW, SDL)? Existing GOV-LAB-* bills are skipped.')) return;
    setSeeding(true);
    setError('');
    try {
      const r = await cpApi.dev.seedGovernmentLabour();
      setInfo(
        `Loaded ${(r.inserted || []).length} draft bill(s)${(r.skipped || []).length ? ` · ${r.skipped.length} already on file` : ''}. Open any draft to edit.`
      );
      loadList();
    } catch (e) {
      setError(e?.message || 'Failed to load government labour policies');
    } finally {
      setSeeding(false);
    }
  };

  const filteredList = filter === 'all' ? policies : policies.filter((p) => p.status === filter);
  const readOnly = policyStatus !== 'draft';

  return (
    <div className="flex gap-0 w-full min-h-0 h-full -m-4 sm:-m-6 flex-col md:flex-row">
      <nav
        className={`hidden md:flex shrink-0 flex-col app-glass-secondary-nav transition-[width] duration-200 overflow-hidden ${navHidden ? 'w-0' : 'w-64'}`}
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 w-64">
          <h2 className="text-sm font-semibold">Bill drafting</h2>
          <p className="text-xs text-surface-500 mt-1">Legislative-style structure</p>
        </div>
        <div className="p-3 w-64 space-y-1">
          <button
            type="button"
            onClick={() => { setView('list'); setPolicyId(null); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${view === 'list' ? 'bg-brand-50 text-brand-700 font-medium' : ''}`}
          >
            Bill register
          </button>
          <button type="button" onClick={startNew} className="w-full text-left px-3 py-2 rounded-lg text-sm text-brand-600 font-medium">
            + New bill
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Bill drafting</h1>
          <InfoHint text="Draft like a government bill: preamble (WHEREAS), enacting formula, PARTS, chapters, numbered sections, subsections (1), paragraphs (a), and schedules. Auto-number provisions, preview the official PDF, then publish to Company policies." />
        </header>

        {error && <div className="mb-3 text-sm text-red-700 bg-red-50 rounded-lg px-4 py-2">{error}</div>}
        {info && <div className="mb-3 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-4 py-2">{info}</div>}

        {view === 'list' && (
          <div className="space-y-4">
            <div className="app-glass-card p-4 border border-slate-200 dark:border-slate-700">
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-50">Government labour policy library</p>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 max-w-2xl">
                Pre-loaded draft bills aligned to South African labour legislation (BCEA, LRA, OHS Act, Employment Equity, National Minimum Wage, Skills Development).
                Each loads as an editable draft — customise for your organisation, then publish to Company policies on employee profiles.
              </p>
              <button
                type="button"
                disabled={seeding}
                onClick={loadGovernmentLabour}
                className="mt-3 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
              >
                {seeding ? 'Loading policies…' : 'Load government labour policies into database'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex gap-2">
                {['all', 'draft', 'published', 'archived'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-full capitalize ${filter === f ? 'bg-slate-800 text-white' : 'border border-surface-300'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button type="button" onClick={startNew} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium">
                New bill
              </button>
            </div>
            {loading && <p className="text-sm text-surface-500">Loading…</p>}
            <div className="app-glass-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-surface-500 border-b bg-slate-50/80">
                    <th className="p-3">Bill no.</th>
                    <th className="p-3">Long title</th>
                    <th className="p-3">Act / authority</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Ver.</th>
                    <th className="p-3 w-28" />
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((p) => (
                    <tr key={p.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-3 font-mono text-xs">{p.reference_number}</td>
                      <td className="p-3 font-medium">{p.title}</td>
                      <td className="p-3 text-xs text-surface-600 max-w-[200px] truncate">{p.act_or_section}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[p.status] || ''}`}>{p.status}</span>
                      </td>
                      <td className="p-3 tabular-nums">{p.version || '—'}</td>
                      <td className="p-3">
                        <button type="button" onClick={() => openEditor(p.id)} className="text-brand-600 text-xs font-medium">
                          Draft
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !filteredList.length && (
                <p className="p-8 text-center text-surface-500">No bills yet — start a new draft.</p>
              )}
            </div>
          </div>
        )}

        {view === 'edit' && (
          <div className="space-y-6">
            <button type="button" onClick={() => setView('list')} className="text-sm text-brand-600 font-medium">
              ← Back to register
            </button>

            <div className="app-glass-card p-5 space-y-4 border-l-4 border-l-slate-800">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="text-xs text-surface-500 uppercase tracking-widest">Bill reference</p>
                  <p className="font-mono text-sm font-semibold">{policyRef || 'New draft'}</p>
                  {policyStatus !== 'draft' && (
                    <p className="text-xs text-surface-500">Version {policyVersion} · {policyStatus}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {policyId && (
                    <button type="button" onClick={previewPdf} className="text-xs px-3 py-1.5 rounded-lg border font-medium">
                      Preview PDF
                    </button>
                  )}
                  {policyId && policyStatus === 'draft' && (
                    <button type="button" disabled={busy} onClick={publish} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-medium disabled:opacity-50">
                      Publish bill
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  <span className="text-xs font-medium text-surface-500">Long title of the bill *</span>
                  <input
                    value={meta.title}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
                    placeholder="e.g. Policy on Occupational Health and Safety for Employees Bill"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-serif dark:bg-surface-900"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="text-xs font-medium text-surface-500">Governing Act or authority *</span>
                  <input
                    list="act-suggestions"
                    value={meta.act_or_section}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, act_or_section: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  />
                  <datalist id="act-suggestions">
                    {ACT_SUGGESTIONS.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-medium text-surface-500">Instrument type</span>
                  <select
                    value={meta.policy_type}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, policy_type: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  >
                    <option value="bill">Bill (as introduced)</option>
                    <option value="act">Act / regulation</option>
                    <option value="policy">Internal policy</option>
                    <option value="procedure">Procedure</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-medium text-surface-500">Classification</span>
                  <select
                    value={meta.classification}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, classification: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  >
                    <option value="internal">Internal</option>
                    <option value="confidential">Confidential</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-medium text-surface-500">Department / portfolio</span>
                  <input
                    value={meta.department_name}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, department_name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-medium text-surface-500">Commencement date</span>
                  <input
                    type="date"
                    value={meta.effective_date}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, effective_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  />
                </label>
                <label className="text-sm flex items-center gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={meta.requires_acknowledgement}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, requires_acknowledgement: e.target.checked }))}
                  />
                  <span className="text-xs">Require employee signature after publication</span>
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="text-xs font-medium text-surface-500">Memorandum / objects (optional)</span>
                  <textarea
                    value={meta.summary}
                    disabled={readOnly}
                    onChange={(e) => setMeta((m) => ({ ...m, summary: e.target.value }))}
                    rows={3}
                    placeholder="Brief statement of objects and reasons, as in a bill memorandum…"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-900"
                  />
                </label>
              </div>
              {!readOnly && (
                <button type="button" disabled={busy} onClick={saveMeta} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium disabled:opacity-50">
                  {busy ? 'Saving…' : policyId ? 'Save bill metadata' : 'Create draft bill'}
                </button>
              )}
            </div>

            {policyId && (
              <div className="flex flex-col lg:flex-row gap-4">
                {showOutline && (
                  <aside className="lg:w-56 shrink-0 app-glass-card p-3 max-h-[70vh] overflow-y-auto sticky top-4">
                    <p className="text-xs font-bold uppercase text-surface-500 mb-2">Outline</p>
                    <ol className="text-xs space-y-1 font-mono">
                      {outline.map((o) => (
                        <li key={o.i}>
                          <button
                            type="button"
                            className="text-left hover:text-brand-600 w-full truncate"
                            onClick={() => document.getElementById(`provision-${o.i}`)?.scrollIntoView({ behavior: 'smooth' })}
                          >
                            {o.line}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </aside>
                )}

                <div className="flex-1 min-w-0 space-y-4">
                  <div className="flex flex-wrap gap-2 items-center justify-between">
                    <h2 className="font-semibold text-lg">Provisions</h2>
                    <button type="button" onClick={() => setShowOutline((v) => !v)} className="text-xs text-surface-500 lg:hidden">
                      {showOutline ? 'Hide' : 'Show'} outline
                    </button>
                  </div>

                  {!readOnly && (
                    <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border">
                      <button type="button" onClick={applyGovernmentTemplate} className="text-xs px-3 py-1.5 rounded-lg border bg-white dark:bg-surface-900 font-medium">
                        Government bill template
                      </button>
                      <button type="button" onClick={runAutoNumber} className="text-xs px-3 py-1.5 rounded-lg border font-medium">
                        Auto-number all
                      </button>
                      <button type="button" onClick={() => addProvision('section')} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-white">
                        + Section
                      </button>
                      <button type="button" onClick={() => addProvision('part')} className="text-xs px-3 py-1.5 rounded-lg border">
                        + PART
                      </button>
                      <button type="button" onClick={() => addProvision('preamble')} className="text-xs px-3 py-1.5 rounded-lg border">
                        + WHEREAS
                      </button>
                      <button type="button" onClick={() => addProvision('schedule')} className="text-xs px-3 py-1.5 rounded-lg border">
                        + Schedule
                      </button>
                    </div>
                  )}

                  {sections.map((s, idx) => (
                    <div key={s.id || idx} id={`provision-${idx}`}>
                      <PolicyBillSectionEditor
                        section={s}
                        index={idx}
                        readOnly={readOnly}
                        onChange={(sec) => updateSection(idx, sec)}
                        onMove={(dir) => moveSection(idx, dir)}
                        onRemove={() => setSections(sections.filter((_, i) => i !== idx))}
                      />
                    </div>
                  ))}

                  {!sections.length && (
                    <p className="text-sm text-surface-500 p-6 text-center border rounded-xl border-dashed">
                      Load the government bill template or add provisions to begin drafting.
                    </p>
                  )}

                  {!readOnly && sections.length > 0 && (
                    <button type="button" disabled={busy} onClick={saveSections} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
                      {busy ? 'Saving…' : 'Save all provisions'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
