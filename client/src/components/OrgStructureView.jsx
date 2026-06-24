import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { orgStructure as orgApi, downloadAttachmentWithAuth } from '../api';
import { buildOrgTree, escalationChain, countOrgTreeNodes, orphanedManagerAssignments } from '../lib/orgChartTree.js';
import { printOrgChartVisual, downloadOrgChartPdf } from '../lib/orgChartExport.js';
import OrgChartTreeDiagram from './OrgChartTreeDiagram.jsx';
import InfoHint from './InfoHint.jsx';

function PersonDetailPanel({ person, assignments, attachments, onClose, onDownload }) {
  const chain = useMemo(
    () => (person?.user_id ? escalationChain(assignments, person.user_id) : []),
    [assignments, person?.user_id]
  );
  if (!person) return null;
  return (
    <aside className="w-full lg:w-[380px] shrink-0 rounded-xl border border-surface-200 bg-white shadow-lg dark:border-surface-600 dark:bg-surface-900 flex flex-col max-h-[min(72vh,640px)]">
      <div className="flex items-start justify-between gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-50">{person.display_name}</h3>
          <p className="text-sm text-brand-700 dark:text-brand-300">{person.position_title}</p>
          {person.grade_level && <p className="text-xs text-surface-500 mt-0.5">Grade: {person.grade_level}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-surface-400 hover:text-surface-700 text-xl leading-none px-1">
          ×
        </button>
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4 text-sm">
        {person.department_name && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Department</h4>
            <p className="mt-1 text-surface-800 dark:text-surface-100">{person.department_name}</p>
          </div>
        )}
        {person.position_description && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Role description</h4>
            <p className="mt-1 whitespace-pre-wrap text-surface-700 dark:text-surface-200">{person.position_description}</p>
          </div>
        )}
        {person.position_responsibilities && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Responsibilities</h4>
            <p className="mt-1 whitespace-pre-wrap text-surface-700 dark:text-surface-200">{person.position_responsibilities}</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2">
          {person.manager_name && (
            <div className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800">
              <span className="text-xs text-surface-500">Line manager</span>
              <p className="font-medium">{person.manager_name}</p>
            </div>
          )}
          {person.escalation_name && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <span className="text-xs text-amber-800 dark:text-amber-200">Escalation contact</span>
              <p className="font-medium text-amber-900 dark:text-amber-100">{person.escalation_name}</p>
            </div>
          )}
        </div>
        {chain.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Escalation path</h4>
            <ol className="mt-2 space-y-1 list-decimal list-inside text-surface-700 dark:text-surface-200">
              {chain.map((c) => (
                <li key={c.user_id}>
                  {c.display_name}
                  <span className="text-surface-500"> · {c.position_title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {attachments?.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Role documents</h4>
            <ul className="mt-2 space-y-1">
              {attachments.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="text-brand-600 hover:underline text-left text-sm dark:text-brand-400"
                    onClick={() => onDownload(a)}
                  >
                    {a.file_name || a.fileName || 'Document'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {person.email && (
          <p className="text-xs text-surface-500">
            <a href={`mailto:${person.email}`} className="text-brand-600 hover:underline">
              {person.email}
            </a>
          </p>
        )}
      </div>
    </aside>
  );
}

export default function OrgStructureView({ onError }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [personDetail, setPersonDetail] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    onError?.('');
    orgApi
      .bundle()
      .then(setBundle)
      .catch((e) => onError?.(e?.message || 'Could not load organisational structure'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const assignments = bundle?.assignments || [];
  const roots = useMemo(() => buildOrgTree(assignments), [assignments]);
  const chartNodeCount = useMemo(() => countOrgTreeNodes(roots), [roots]);
  const orphaned = useMemo(() => orphanedManagerAssignments(assignments, roots), [assignments, roots]);

  const exportOpts = useMemo(
    () => ({ title: 'Organisational structure', tenantName: user?.tenant_name || '' }),
    [user?.tenant_name]
  );

  const handlePrint = () => {
    onError?.('');
    try {
      printOrgChartVisual(roots, exportOpts);
    } catch (e) {
      onError?.(e?.message || 'Could not open print view');
    }
  };

  const handleDownloadPdf = async () => {
    onError?.('');
    try {
      await downloadOrgChartPdf(roots, exportOpts);
    } catch (e) {
      onError?.(e?.message || 'Could not download PDF');
    }
  };

  const filteredRoots = useMemo(() => {
    if (!search.trim() && !deptFilter) return roots;
    const q = search.trim().toLowerCase();
    const subtreeHas = (n) => {
      const deptOk = !deptFilter || String(n.department_name || '') === deptFilter;
      const textOk =
        !q ||
        String(n.display_name || '').toLowerCase().includes(q) ||
        String(n.position_title || '').toLowerCase().includes(q) ||
        String(n.department_name || '').toLowerCase().includes(q);
      return (deptOk && textOk) || (n.children || []).some(subtreeHas);
    };
    const prune = (nodes) =>
      nodes.map((n) => ({ ...n, children: prune(n.children || []) })).filter(subtreeHas);
    return prune(roots);
  }, [roots, search, deptFilter]);

  const departments = useMemo(() => {
    const names = new Set((bundle?.departments || []).map((d) => d.name).filter(Boolean));
    for (const a of assignments) if (a.department_name) names.add(a.department_name);
    return Array.from(names).sort();
  }, [bundle, assignments]);

  const selectedPerson = useMemo(() => {
    if (!selectedUserId) return null;
    return assignments.find((a) => String(a.user_id) === String(selectedUserId)) || personDetail?.person;
  }, [assignments, selectedUserId, personDetail]);

  const selectPerson = async (userId) => {
    setSelectedUserId(userId);
    onError?.('');
    try {
      const d = await orgApi.person(userId);
      setPersonDetail(d);
      setAttachments(d.attachments || []);
    } catch (e) {
      const local = assignments.find((a) => String(a.user_id) === String(userId));
      setPersonDetail(local ? { person: local } : null);
      setAttachments([]);
      if (!local) onError?.(e?.message || 'Could not load person');
    }
  };

  const handleDownload = (att) => {
    const id = att.id;
    const pid = selectedPerson?.position_id;
    if (!id || !pid) return;
    downloadAttachmentWithAuth(orgApi.attachmentDownloadUrl(pid, id), att.file_name || 'document').catch((e) =>
      onError?.(e?.message || 'Download failed')
    );
  };

  if (loading) {
    return <p className="text-sm text-surface-500 py-8 text-center">Loading organisational structure…</p>;
  }

  if (!bundle) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-300 py-6">
        Organisational structure is not available. Ask your administrator to configure it under Management.
      </p>
    );
  }

  const headcount = assignments.filter((a) => a.user_id).length;
  const vacant = assignments.filter((a) => !a.user_id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Organisational structure</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Reporting tree with linked nodes. Click an employee for role details, responsibilities, and escalation path.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!roots.length}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-surface-300 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-600 dark:hover:bg-surface-800"
          >
            Print chart
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!roots.length}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Download PDF
          </button>
          <InfoHint text="Print and PDF include the full structure (all roots and nodes), not just what matches your search." />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="inline-flex items-center rounded-full bg-surface-100 px-3 py-1 text-xs font-medium dark:bg-surface-800">
          {chartNodeCount} on chart
        </span>
        <span className="inline-flex items-center rounded-full bg-surface-100 px-3 py-1 text-xs font-medium dark:bg-surface-800">
          {headcount} filled
        </span>
        {vacant > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {vacant} vacant
          </span>
        )}
        {orphaned.length > 0 && (
          <span
            className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-100"
            title="These people report to a manager who is not on the chart, so they appear at the top level."
          >
            {orphaned.length} unlinked manager{orphaned.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search name, title, department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-surface-300 text-sm dark:bg-surface-900 dark:border-surface-600"
        />
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-surface-300 text-sm dark:bg-surface-900 dark:border-surface-600"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 w-full min-w-0">
          <OrgChartTreeDiagram
            roots={filteredRoots}
            selectedUserId={selectedUserId}
            onSelectPerson={selectPerson}
            interactive
            emptyMessage="No organisational structure has been published yet."
          />
        </div>
        {selectedPerson && (
          <PersonDetailPanel
            person={selectedPerson}
            assignments={assignments}
            attachments={attachments}
            onClose={() => {
              setSelectedUserId(null);
              setPersonDetail(null);
              setAttachments([]);
            }}
            onDownload={handleDownload}
          />
        )}
      </div>

      {!selectedUserId && filteredRoots.length > 0 && (
        <p className="text-xs text-surface-500 text-center">Select an employee in the chart to view role details.</p>
      )}
    </div>
  );
}
