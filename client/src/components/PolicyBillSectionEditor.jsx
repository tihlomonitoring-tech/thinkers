import {
  SECTION_TYPES,
  newClause,
  newChildClause,
  sectionTypeLabel,
  plainTextFromSection,
} from '../lib/policyBillFormat.js';

function ClauseRow({ clause, clauseIdx, onChange, onRemove, onAddChild, readOnly, showNumbers }) {
  return (
    <div className="space-y-2 pl-0 border-l-2 border-slate-200 dark:border-slate-700 ml-1">
      <div className="flex flex-wrap gap-2 items-start">
        {showNumbers && (
          <input
            value={clause.number || ''}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...clause, number: e.target.value })}
            placeholder="(1)"
            className="w-14 rounded border px-1.5 py-1 text-xs font-mono text-center dark:bg-surface-900 shrink-0"
          />
        )}
        <textarea
          value={clause.text || ''}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...clause, text: e.target.value })}
          rows={Math.min(6, Math.max(2, (clause.text || '').split('\n').length))}
          placeholder="Draft the provision text…"
          className="flex-1 min-w-[12rem] rounded-lg border border-surface-200 px-3 py-2 text-sm font-serif leading-relaxed dark:bg-surface-900 dark:border-surface-600"
        />
        {!readOnly && (
          <button type="button" onClick={onRemove} className="text-xs text-red-600 shrink-0">
            Remove
          </button>
        )}
      </div>
      {(clause.children || []).map((ch, chi) => (
        <div key={ch.id || chi} className="flex flex-wrap gap-2 items-start ml-4">
          <input
            value={ch.number || ''}
            readOnly={readOnly}
            onChange={(e) => {
              const children = [...(clause.children || [])];
              children[chi] = { ...ch, number: e.target.value };
              onChange({ ...clause, children });
            }}
            className="w-12 rounded border px-1 py-1 text-xs font-mono text-center dark:bg-surface-900"
          />
          <textarea
            value={ch.text || ''}
            readOnly={readOnly}
            onChange={(e) => {
              const children = [...(clause.children || [])];
              children[chi] = { ...ch, text: e.target.value };
              onChange({ ...clause, children });
            }}
            rows={2}
            placeholder="Sub-paragraph (a), (b)…"
            className="flex-1 rounded-lg border px-2 py-1.5 text-sm font-serif dark:bg-surface-900"
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                const children = (clause.children || []).filter((_, i) => i !== chi);
                onChange({ ...clause, children });
              }}
              className="text-xs text-red-500"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && showNumbers && (
        <button
          type="button"
          onClick={onAddChild}
          className="text-xs text-brand-600 font-medium ml-4"
        >
          + Add paragraph (a), (b)…
        </button>
      )}
    </div>
  );
}

export default function PolicyBillSectionEditor({
  section,
  index,
  readOnly,
  onChange,
  onMove,
  onRemove,
}) {
  const type = section.section_type || 'section';
  const meta = SECTION_TYPES.find((t) => t.id === type) || SECTION_TYPES[4];
  const showClauseNumbers = !['preamble', 'enacting', 'part', 'chapter', 'schedule'].includes(type);

  const updateClause = (ci, clause) => {
    const clauses = [...(section.clauses || [])];
    clauses[ci] = clause;
    onChange({ ...section, clauses });
  };

  const insertClause = (kind) => {
    const clauses = [...(section.clauses || [])];
    if (kind === 'whereas') {
      clauses.push(newClause('AND WHEREAS …;', ''));
    } else if (kind === 'definition') {
      clauses.push(newClause('“term” means …;', '(a)'));
    } else {
      clauses.push(newClause('', showClauseNumbers ? `(${clauses.length + 1})` : ''));
    }
    onChange({ ...section, clauses });
  };

  const isHeadingOnly = ['part', 'chapter', 'schedule'].includes(type);

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface-900/50 shadow-sm overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-900/80 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Provision {index + 1} · {sectionTypeLabel(type)}
        </span>
        {!readOnly && (
          <div className="flex gap-1">
            <button type="button" onClick={() => onMove(-1)} className="text-xs px-2 py-0.5 border rounded">
              ↑
            </button>
            <button type="button" onClick={() => onMove(1)} className="text-xs px-2 py-0.5 border rounded">
              ↓
            </button>
            <button type="button" onClick={onRemove} className="text-xs px-2 py-0.5 text-red-600">
              Delete block
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="text-xs">
            <span className="font-medium text-surface-500">Block type</span>
            <select
              value={type}
              disabled={readOnly}
              onChange={(e) => onChange({ ...section, section_type: e.target.value })}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm dark:bg-surface-900"
            >
              {SECTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="font-medium text-surface-500">Number / label</span>
            <input
              value={section.section_number || ''}
              disabled={readOnly}
              onChange={(e) => onChange({ ...section, section_number: e.target.value })}
              placeholder={meta.numbering === 'part' ? 'PART I' : '1'}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm font-mono dark:bg-surface-900"
            />
          </label>
        </div>

        <label className="block text-xs">
          <span className="font-medium text-surface-500">Heading / rubric</span>
          <input
            value={section.title || ''}
            disabled={readOnly}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="e.g. Definitions, Application, Duties of employer"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-semibold uppercase tracking-wide dark:bg-surface-900"
          />
        </label>

        {!isHeadingOnly && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <p className="text-xs font-semibold text-surface-600 dark:text-surface-400">Body (clauses & sub-clauses)</p>
              {!readOnly && (
                <div className="flex flex-wrap gap-1">
                  {type === 'preamble' && (
                    <button type="button" onClick={() => insertClause('whereas')} className="text-[10px] px-2 py-1 rounded border">
                      + WHEREAS
                    </button>
                  )}
                  {type === 'definition' && (
                    <button type="button" onClick={() => insertClause('definition')} className="text-[10px] px-2 py-1 rounded border">
                      + Definition
                    </button>
                  )}
                  <button type="button" onClick={() => insertClause('clause')} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-white">
                    + Clause
                  </button>
                </div>
              )}
            </div>
            {(section.clauses || []).map((clause, ci) => (
              <ClauseRow
                key={clause.id || ci}
                clause={clause}
                clauseIdx={ci}
                readOnly={readOnly}
                showNumbers={showClauseNumbers}
                onChange={(c) => updateClause(ci, c)}
                onRemove={() => {
                  const clauses = (section.clauses || []).filter((_, i) => i !== ci);
                  onChange({ ...section, clauses: clauses.length ? clauses : [newClause('', '')] });
                }}
                onAddChild={() => {
                  const children = [...(clause.children || [])];
                  children.push(newChildClause('', `(${String.fromCharCode(97 + children.length)})`));
                  updateClause(ci, { ...clause, children });
                }}
              />
            ))}
          </div>
        )}

        {isHeadingOnly && (
          <p className="text-xs text-surface-500 italic">
            Division heading only — add sections below this PART or CHAPTER.
          </p>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-surface-500">Preview text</summary>
          <pre className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 font-serif text-sm whitespace-pre-wrap">
            {plainTextFromSection(section)}
          </pre>
        </details>
      </div>
    </article>
  );
}
