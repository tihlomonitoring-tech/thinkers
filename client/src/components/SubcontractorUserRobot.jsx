import { useState, useEffect, useCallback, useMemo } from 'react';
import { users as usersApi } from '../api';

const ROBOT_PASSWORD = 'Subcontra123';

function StatusPill({ status }) {
  const styles = {
    ready: 'bg-emerald-100 text-emerald-800',
    has_portal_user: 'bg-surface-200 text-surface-600',
    invalid: 'bg-red-100 text-red-800',
  };
  const labels = {
    ready: 'Ready',
    has_portal_user: 'Has user',
    invalid: 'Invalid',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.invalid}`}>
      {labels[status] || status}
    </span>
  );
}

export default function SubcontractorUserRobot({ open, onClose, me, tenants, onCreated }) {
  const [tenantId, setTenantId] = useState(me?.tenant_id || '');
  const [contractors, setContractors] = useState([]);
  const [contractorsLoading, setContractorsLoading] = useState(false);
  const [selectedContractorIds, setSelectedContractorIds] = useState(new Set());
  const [rows, setRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedSubIds, setSelectedSubIds] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const effectiveTenantId = me?.role === 'super_admin' ? tenantId : (me?.tenant_id || tenantId);

  useEffect(() => {
    if (!open) return;
    setTenantId(me?.tenant_id || tenants?.[0]?.id || '');
    setSelectedContractorIds(new Set());
    setRows([]);
    setSelectedSubIds(new Set());
    setError('');
    setResult(null);
  }, [open, me?.tenant_id, tenants]);

  useEffect(() => {
    if (!open || !effectiveTenantId) {
      setContractors([]);
      return;
    }
    setContractorsLoading(true);
    usersApi.contractorsForTenants([effectiveTenantId])
      .then((d) => setContractors(d.contractors || []))
      .catch(() => setContractors([]))
      .finally(() => setContractorsLoading(false));
  }, [open, effectiveTenantId]);

  const loadPreview = useCallback(async () => {
    const cids = [...selectedContractorIds];
    if (!effectiveTenantId || cids.length === 0) {
      setRows([]);
      setSelectedSubIds(new Set());
      return;
    }
    setPreviewLoading(true);
    setError('');
    try {
      const r = await usersApi.subcontractorRobot.preview(effectiveTenantId, cids);
      const list = r.rows || [];
      setRows(list);
      setSelectedSubIds(new Set(list.filter((row) => row.selectable).map((row) => String(row.subcontractor_id))));
    } catch (e) {
      setError(e?.message || 'Could not load preview');
      setRows([]);
      setSelectedSubIds(new Set());
    } finally {
      setPreviewLoading(false);
    }
  }, [effectiveTenantId, selectedContractorIds]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { loadPreview(); }, 300);
    return () => clearTimeout(t);
  }, [open, loadPreview]);

  const readyCount = useMemo(() => rows.filter((r) => r.status === 'ready').length, [rows]);
  const selectedReadyCount = useMemo(
    () => rows.filter((r) => selectedSubIds.has(String(r.subcontractor_id)) && r.status === 'ready').length,
    [rows, selectedSubIds]
  );

  const toggleContractor = (id) => {
    const cid = String(id);
    setSelectedContractorIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  const toggleSub = (id) => {
    const sid = String(id);
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const selectAllReady = () => {
    setSelectedSubIds(new Set(rows.filter((r) => r.selectable).map((r) => String(r.subcontractor_id))));
  };

  const handleCreate = async () => {
    const items = rows
      .filter((r) => selectedSubIds.has(String(r.subcontractor_id)) && r.status === 'ready')
      .map((r) => ({
        subcontractor_id: r.subcontractor_id,
        email: r.proposed_email,
        full_name: r.proposed_full_name,
      }));
    if (items.length === 0) {
      setError('Select at least one sub-contractor marked Ready.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const r = await usersApi.subcontractorRobot.bulkCreate({
        tenant_id: effectiveTenantId,
        items,
      });
      setResult(r);
      onCreated?.(r);
      await loadPreview();
    } catch (e) {
      setError(e?.message || 'Bulk create failed');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Subcontractor user robot">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={() => !creating && onClose()} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-surface-900">Subcontractor user robot</h2>
            <p className="text-sm text-surface-600 mt-1">
              Auto-create portal users for sub-contractors registered under a main contractor. Usernames use company abbreviation or first word at <strong>@system.com</strong>. Password for all: <strong className="font-mono">{ROBOT_PASSWORD}</strong>.
            </p>
          </div>
          <button type="button" onClick={() => !creating && onClose()} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {result && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Created {result.created} user(s).
              {result.skipped > 0 ? ` Skipped ${result.skipped}.` : ''}
              {result.failed > 0 ? ` Failed ${result.failed}.` : ''}
            </p>
          )}

          {me?.role === 'super_admin' && tenants?.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Tenant</label>
              <select
                value={tenantId}
                onChange={(e) => { setTenantId(e.target.value); setSelectedContractorIds(new Set()); }}
                className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-sm font-medium text-surface-700">Main contractor(s)</label>
              {contractors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedContractorIds(new Set(contractors.map((c) => String(c.id))))}
                  className="text-xs text-brand-600 hover:underline"
                >
                  Select all contractors
                </button>
              )}
            </div>
            <p className="text-xs text-surface-500 mb-2">Only sub-contractors from Contractor → Subcontractor details for the selected company(ies) are listed below.</p>
            {contractorsLoading ? (
              <p className="text-sm text-surface-500">Loading contractors…</p>
            ) : contractors.length === 0 ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No contractor companies for this tenant. Add contractors first.</p>
            ) : (
              <div className="flex flex-wrap gap-3 max-h-28 overflow-y-auto border border-surface-200 rounded-lg p-3 bg-surface-50">
                {contractors.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedContractorIds.has(String(c.id))}
                      onChange={() => toggleContractor(c.id)}
                      className="rounded border-surface-300 text-brand-600"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {selectedContractorIds.size > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="text-sm font-medium text-surface-700">
                  Preview ({rows.length} sub-contractor{rows.length === 1 ? '' : 's'} · {readyCount} ready)
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAllReady} className="text-xs text-brand-600 hover:underline">Select all ready</button>
                  <button type="button" onClick={() => setSelectedSubIds(new Set())} className="text-xs text-surface-600 hover:underline">Clear</button>
                  <button type="button" onClick={loadPreview} disabled={previewLoading} className="text-xs text-surface-600 hover:underline">Refresh</button>
                </div>
              </div>
              {previewLoading ? (
                <p className="text-sm text-surface-500">Generating usernames…</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-surface-500">No sub-contractors registered under the selected contractor(s).</p>
              ) : (
                <div className="overflow-x-auto border border-surface-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 border-b border-surface-200">
                      <tr>
                        <th className="w-10 px-2 py-2" />
                        <th className="text-left px-3 py-2 font-medium text-surface-700">Sub-contractor</th>
                        <th className="text-left px-3 py-2 font-medium text-surface-700">Main contractor</th>
                        <th className="text-left px-3 py-2 font-medium text-surface-700">Username</th>
                        <th className="text-left px-3 py-2 font-medium text-surface-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.subcontractor_id} className="border-b border-surface-100 last:border-0">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              disabled={!row.selectable}
                              checked={selectedSubIds.has(String(row.subcontractor_id))}
                              onChange={() => toggleSub(row.subcontractor_id)}
                              className="rounded border-surface-300 text-brand-600 disabled:opacity-40"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-surface-900">{row.company_name}</td>
                          <td className="px-3 py-2 text-surface-600">{row.contractor_name || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-surface-800">{row.proposed_email || '—'}</td>
                          <td className="px-3 py-2">
                            <StatusPill status={row.status} />
                            <p className="text-xs text-surface-500 mt-0.5">{row.message}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-none flex flex-wrap gap-2 justify-end px-6 py-4 border-t border-surface-200 bg-surface-50">
          <button type="button" onClick={onClose} disabled={creating} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100 disabled:opacity-50">
            Close
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || selectedReadyCount === 0}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : `Create ${selectedReadyCount} user${selectedReadyCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
