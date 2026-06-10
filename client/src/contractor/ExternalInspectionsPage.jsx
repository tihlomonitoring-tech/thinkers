import { useState, useEffect, useCallback } from 'react';
import { truckInspection as api } from '../api';
import InfoHint from '../components/InfoHint.jsx';
import InspectionSignaturesPanel from '../components/InspectionSignaturesPanel.jsx';

const fc = 'w-full px-3 py-2 rounded-lg border border-surface-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-white';

function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }); }
function formatDateTime(d) { if (!d) return '—'; return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

function overallBadge(r) {
  const v = String(r || 'pending').toLowerCase();
  const cls = v === 'pass' ? 'bg-emerald-100 text-emerald-800' : v === 'fail' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cls}`}>{v === 'pass' ? 'PASS' : v === 'fail' ? 'FAIL' : 'INCOMPLETE'}</span>;
}

function InspectionDetail({ inspectionId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    api.get(inspectionId).then(setData).catch(() => {});
  }, [inspectionId]);

  useEffect(() => {
    setLoading(true);
    api.get(inspectionId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [inspectionId]);

  if (loading) return <div className="text-sm text-surface-500 py-8 text-center animate-pulse">Loading…</div>;
  if (!data?.inspection) return <div className="text-sm text-red-600">Inspection not found.</div>;

  const insp = data.inspection;
  const items = data.items || [];
  const attByItem = (data.attachments || []).reduce((acc, a) => {
    if (a.item_id) {
      if (!acc[a.item_id]) acc[a.item_id] = [];
      acc[a.item_id].push(a);
    }
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm text-brand-600 hover:text-brand-700">← Back to list</button>
        <a
          href={api.exportPdfUrl(inspectionId)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto py-2 px-4 rounded-lg text-sm font-semibold border border-red-200 text-red-800 hover:bg-red-50"
        >
          Download PDF
        </a>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-lg">{insp.fleet_registration || insp.truck_reg || '—'}</span>
          {overallBadge(insp.overall_result)}
          {insp.reference_number && <span className="text-xs font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded">{insp.reference_number}</span>}
        </div>
        <p className="text-surface-600">Driver: {insp.inspector_name} · Contractor: {insp.inspector_company || insp.contractor_name || '—'}</p>
        <p className="text-surface-600">Date: {formatDateTime(insp.inspection_datetime || insp.inspection_date)}</p>
        {(insp.trailer_1_registration || insp.trailer_2_registration) && (
          <p className="text-surface-600">
            Trailers: {[insp.trailer_1_registration, insp.trailer_2_registration].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="text-surface-500">{insp.passed_items} pass · {insp.failed_items} fail · {insp.na_items} N/A</p>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Comment</th>
              <th className="px-3 py-2">Photo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {items.map((it) => {
              const photos = attByItem[it.id] || [];
              return (
                <tr key={it.id} className={it.result === 'fail' ? 'bg-red-50/50' : ''}>
                  <td className="px-3 py-2 text-xs text-surface-500">{it.item_code}</td>
                  <td className="px-3 py-2">{it.item_label}</td>
                  <td className="px-3 py-2 uppercase text-xs font-bold">{it.result}</td>
                  <td className="px-3 py-2 text-surface-600">{it.comment || '—'}</td>
                  <td className="px-3 py-2">
                    {photos.length > 0 ? (
                      <div className="flex gap-1">
                        {photos.filter((a) => a.mime_type?.startsWith('image/')).map((a) => (
                          <a key={a.id} href={api.attachmentDownloadUrl(a.id)} target="_blank" rel="noopener noreferrer">
                            <img src={api.attachmentDownloadUrl(a.id)} alt="" className="h-10 w-auto rounded border border-surface-200" />
                          </a>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <InspectionSignaturesPanel
        inspection={insp}
        inspectionId={inspectionId}
        signatureImageUrl={api.signatureImageUrl}
        signSupervisorApi={api.signSupervisor}
        formatDateTime={formatDateTime}
        onSupervisorSigned={reload}
      />
    </div>
  );
}

export default function ExternalInspectionsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({
    source: 'external_driver',
    result: 'all',
    search: '',
    from: '',
    to: '',
    contractor: '',
  });
  const ff = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  const load = useCallback(() => {
    setLoading(true);
    api.list(filters)
      .then((d) => setItems(d.inspections || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const filteredClient = items.filter((insp) => {
    const cq = filters.contractor.trim().toLowerCase();
    if (!cq) return true;
    const name = (insp.inspector_company || insp.contractor_name || '').toLowerCase();
    return name.includes(cq);
  });

  if (openId) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-surface-900 tracking-tight">External inspections</h1>
        <InspectionDetail inspectionId={openId} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 tracking-tight">External inspections</h1>
        <InfoHint
          title="Driver-submitted inspections"
          text="Inspections submitted by drivers via the public portal (no login). Side tipper national road safety checklist with photo evidence per item. Filter by date, result, registration, or contractor name. Download PDF reports with embedded photos."
        />
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            value={filters.search}
            onChange={(e) => ff('search', e.target.value)}
            placeholder="Search reg, ref, driver…"
            className={fc}
          />
          <input
            value={filters.contractor}
            onChange={(e) => ff('contractor', e.target.value)}
            placeholder="Filter contractor name…"
            className={fc}
          />
          <select value={filters.result} onChange={(e) => ff('result', e.target.value)} className={fc}>
            <option value="all">All results</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="incomplete">Incomplete</option>
          </select>
          <input type="date" value={filters.from} onChange={(e) => ff('from', e.target.value)} className={fc} title="From date" />
          <input type="date" value={filters.to} onChange={(e) => ff('to', e.target.value)} className={fc} title="To date" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-surface-500 py-8 text-center animate-pulse">Loading inspections…</div>
      ) : filteredClient.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center text-sm text-surface-500">No external inspections found.</div>
      ) : (
        <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-left text-xs uppercase text-surface-500 border-b border-surface-200">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date / time</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3">Trailers</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Contractor</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {filteredClient.map((insp) => (
                  <tr key={insp.id} className="hover:bg-surface-50/80">
                    <td className="px-4 py-3 font-medium text-blue-800">{insp.reference_number || '—'}</td>
                    <td className="px-4 py-3 text-surface-600 whitespace-nowrap">{formatDateTime(insp.inspection_datetime || insp.inspection_date)}</td>
                    <td className="px-4 py-3 font-medium">{insp.truck_reg || insp.fleet_registration || '—'}</td>
                    <td className="px-4 py-3 text-surface-600 text-xs">
                      {[insp.trailer_1_registration, insp.trailer_2_registration].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3">{insp.inspector_name || insp.driver_name || '—'}</td>
                    <td className="px-4 py-3">{insp.inspector_company || insp.contractor_name || '—'}</td>
                    <td className="px-4 py-3">{overallBadge(insp.overall_result)}</td>
                    <td className="px-4 py-3 text-xs text-surface-500 tabular-nums">
                      {insp.passed_items}P · {insp.failed_items}F · {insp.na_items}N
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setOpenId(insp.id)} className="text-brand-600 hover:text-brand-700 font-semibold text-xs">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
