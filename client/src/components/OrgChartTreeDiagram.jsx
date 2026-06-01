/**
 * Org chart with visible parent–child connector lines (tree layout).
 */

function initials(name) {
  const p = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function NodeCard({ node, selectedUserId, onSelectPerson, interactive }) {
  const uid = node.user_id ? String(node.user_id) : null;
  const selected = uid && selectedUserId === uid;
  const vacant = !uid;
  const Tag = interactive && uid ? 'button' : 'div';

  return (
    <Tag
      type={interactive && uid ? 'button' : undefined}
      onClick={interactive && uid ? () => onSelectPerson?.(uid) : undefined}
      className={`org-chart-node relative z-[1] mx-1 min-w-[152px] max-w-[200px] rounded-xl border px-3 py-2.5 text-left shadow-sm transition ${
        vacant
          ? 'border-dashed border-surface-300 bg-surface-50 dark:border-surface-600 dark:bg-surface-900/50'
          : selected
            ? 'border-brand-500 ring-2 ring-brand-500/30 bg-brand-50 dark:bg-brand-950/50'
            : interactive && uid
              ? 'border-surface-200 bg-white hover:border-brand-400 hover:shadow-md cursor-pointer dark:border-surface-600 dark:bg-surface-800'
              : 'border-surface-200 bg-white dark:border-surface-600 dark:bg-surface-800'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
            vacant ? 'bg-surface-200 text-surface-500' : 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100'
          }`}
        >
          {vacant ? '—' : initials(node.display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-surface-900 dark:text-surface-50">
            {vacant ? 'Vacant' : node.display_name}
          </p>
          <p className="truncate text-[10px] text-brand-700 dark:text-brand-300">{node.position_title || '—'}</p>
          {node.department_name && <p className="truncate text-[9px] text-surface-500">{node.department_name}</p>}
        </div>
      </div>
    </Tag>
  );
}

function OrgChartLi({ node, selectedUserId, onSelectPerson, interactive }) {
  const children = node.children || [];
  const nodeKey = node.id || node.user_id || node.position_id || Math.random();

  return (
    <li className="org-chart-li">
      <NodeCard node={node} selectedUserId={selectedUserId} onSelectPerson={onSelectPerson} interactive={interactive} />
      {children.length > 0 && (
        <ul className="org-chart-ul">
          {children.map((c) => (
            <OrgChartLi
              key={c.id || c.user_id || c.position_id}
              node={c}
              selectedUserId={selectedUserId}
              onSelectPerson={onSelectPerson}
              interactive={interactive}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const CHART_STYLES = `
.org-chart-root .org-chart { display: flex; justify-content: center; padding: 0; margin: 0; list-style: none; }
.org-chart-root .org-chart-ul {
  display: flex; justify-content: center; padding-top: 24px; margin: 0; list-style: none; position: relative;
}
.org-chart-root .org-chart-ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 24px;
  border-left: 2px solid #94a3b8;
}
.org-chart-root .org-chart-li {
  display: flex; flex-direction: column; align-items: center; position: relative;
  padding: 24px 10px 0 10px; list-style: none;
}
.org-chart-root .org-chart-li::before,
.org-chart-root .org-chart-li::after {
  content: ''; position: absolute; top: 0; width: 50%; height: 24px;
  border-top: 2px solid #94a3b8;
}
.org-chart-root .org-chart-li::before { right: 50%; border-right: 2px solid #94a3b8; border-radius: 0 8px 0 0; }
.org-chart-root .org-chart-li::after { left: 50%; border-left: 2px solid #94a3b8; border-radius: 8px 0 0 0; }
.org-chart-root .org-chart-li:only-child::before,
.org-chart-root .org-chart-li:only-child::after { display: none; }
.org-chart-root .org-chart-li:first-child::before { border: none; }
.org-chart-root .org-chart-li:last-child::after { border: none; }
.org-chart-root .org-chart > .org-chart-li { padding-top: 0; }
.org-chart-root .org-chart > .org-chart-li::before,
.org-chart-root .org-chart > .org-chart-li::after { display: none; }
.org-chart-root .org-chart-li > .org-chart-node::before {
  content: ''; position: absolute; top: -24px; left: 50%; width: 0; height: 24px;
  border-left: 2px solid #94a3b8; transform: translateX(-50%);
}
.org-chart-root .org-chart > .org-chart-li > .org-chart-node::before { display: none; }
.dark .org-chart-root .org-chart-li::before,
.dark .org-chart-root .org-chart-li::after,
.dark .org-chart-root .org-chart-ul::before,
.dark .org-chart-root .org-chart-li > .org-chart-node::before {
  border-color: #64748b;
}
`;

export default function OrgChartTreeDiagram({ roots = [], selectedUserId, onSelectPerson, interactive = true, emptyMessage }) {
  if (!roots?.length) {
    return (
      <div className="rounded-xl border border-dashed border-surface-300 p-10 text-center text-sm text-surface-500 dark:border-surface-600">
        {emptyMessage || 'No reporting structure to display.'}
      </div>
    );
  }

  return (
    <div className="org-chart-root overflow-x-auto rounded-xl border border-surface-200 bg-surface-50/80 p-6 dark:border-surface-700 dark:bg-surface-900/40">
      <style>{CHART_STYLES}</style>
      <ul className="org-chart">
        {roots.map((r) => (
          <OrgChartLi
            key={r.id || r.user_id || r.position_id}
            node={r}
            selectedUserId={selectedUserId}
            onSelectPerson={onSelectPerson}
            interactive={interactive}
          />
        ))}
      </ul>
    </div>
  );
}
