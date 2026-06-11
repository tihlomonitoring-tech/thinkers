import { useState, useMemo, useEffect } from 'react';
import { contractor as contractorApi } from '../api';
import {
  RISK_FACTOR_DEFS,
  SCORE_LABELS,
  defaultRiskAssessment,
  computeRiskAssessment,
  mergeRiskAssessment,
} from '../lib/routeRiskAssessment.js';
import { downloadRouteRiskAssessmentPdf } from '../lib/routeRiskAssessmentPdf.js';
import { loadShiftReportLogoDataUrl } from '../lib/shiftReportLogo.js';

const EMPTY_ROUTE = {
  name: '',
  starting_point: '',
  destination: '',
  loading_address: '',
  destination_address: '',
  distance_km: '',
  capacity: '',
  min_tons: '36',
  route_expiration: '',
};

function RiskBadge({ level, score }) {
  const styles = {
    low: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    medium: 'bg-amber-100 text-amber-900 border-amber-200',
    high: 'bg-orange-100 text-orange-900 border-orange-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
    not_assessed: 'bg-surface-100 text-surface-500 border-surface-200',
  };
  const labels = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', not_assessed: 'Not assessed' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${styles[level] || styles.not_assessed}`}>
      {labels[level] || level}
      {score != null && <span className="normal-case font-normal">({score}/5)</span>}
    </span>
  );
}

function ScoreSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded border border-surface-300 px-2 py-1 text-xs w-full">
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>{n} — {SCORE_LABELS[n]}</option>
      ))}
    </select>
  );
}

export default function RouteManagementModal({
  open,
  onClose,
  route,
  tenantName,
  tenantId,
  onSaved,
  onError,
  initialTab = 'details',
}) {
  const [tab, setTab] = useState(initialTab);
  const [routeForm, setRouteForm] = useState(EMPTY_ROUTE);
  const [assessment, setAssessment] = useState(defaultRiskAssessment());
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const isEdit = !!route?.id;
  const summary = useMemo(() => computeRiskAssessment(assessment), [assessment]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    if (route) {
      setRouteForm({
        name: route.name || '',
        starting_point: route.starting_point || '',
        destination: route.destination || '',
        loading_address: route.loading_address || '',
        destination_address: route.destination_address || '',
        distance_km: route.distance_km != null ? String(route.distance_km) : '',
        capacity: route.capacity != null ? String(route.capacity) : '',
        min_tons: route.min_tons != null ? String(route.min_tons) : (route.max_tons != null ? String(route.max_tons) : '36'),
        route_expiration: route.route_expiration ? String(route.route_expiration).slice(0, 10) : '',
      });
      setAssessment(mergeRiskAssessment(route.risk_assessment));
    } else {
      setRouteForm(EMPTY_ROUTE);
      setAssessment(defaultRiskAssessment());
    }
  }, [open, route, initialTab]);

  if (!open) return null;

  const saveDetails = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: routeForm.name.trim(),
        starting_point: routeForm.starting_point.trim() || null,
        destination: routeForm.destination.trim() || null,
        loading_address: routeForm.loading_address.trim() || null,
        destination_address: routeForm.destination_address.trim() || null,
        distance_km: routeForm.distance_km.trim() ? Number(routeForm.distance_km) : null,
        capacity: routeForm.capacity.trim() ? parseInt(routeForm.capacity, 10) : null,
        min_tons: routeForm.min_tons.trim() ? parseFloat(routeForm.min_tons) : 36,
        route_expiration: routeForm.route_expiration.trim() || null,
      };
      let saved;
      if (isEdit) {
        const data = await contractorApi.routes.update(route.id, payload);
        saved = data.route;
      } else {
        const data = await contractorApi.routes.create(payload);
        saved = data.route;
      }
      onSaved?.(saved);
      if (!isEdit) onClose();
    } catch (err) {
      onError?.(err?.message || 'Failed to save route');
    } finally {
      setSaving(false);
    }
  };

  const saveRisk = async () => {
    if (!isEdit) {
      onError?.('Save route details first, then complete the risk assessment.');
      setTab('details');
      return;
    }
    setSaving(true);
    try {
      const data = await contractorApi.routes.saveRiskAssessment(route.id, { assessment });
      onSaved?.(data.route);
    } catch (err) {
      onError?.(err?.message || 'Failed to save risk assessment');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!isEdit) {
      onError?.('Save the route before downloading the risk assessment PDF.');
      return;
    }
    setPdfLoading(true);
    try {
      const logoDataUrl = tenantId ? await loadShiftReportLogoDataUrl({ tenantId }) : null;
      const mergedRoute = { ...route, ...routeForm, distance_km: routeForm.distance_km ? Number(routeForm.distance_km) : route?.distance_km };
      downloadRouteRiskAssessmentPdf({
        route: mergedRoute,
        tenantName,
        assessment,
        logoDataUrl,
      }, `${route.name}-risk-assessment`);
    } catch (err) {
      onError?.(err?.message || 'PDF generation failed');
    } finally {
      setPdfLoading(false);
    }
  };

  const setScore = (id, val) => setAssessment((a) => ({ ...a, scores: { ...a.scores, [id]: val } }));
  const setMitigation = (id, val) => setAssessment((a) => ({ ...a, mitigations: { ...a.mitigations, [id]: val } }));
  const setNote = (id, val) => setAssessment((a) => ({ ...a, notes: { ...a.notes, [id]: val } }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden border border-surface-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-surface-200 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-surface-900">{isEdit ? 'Edit route' : 'Register route'}</p>
            <p className="text-sm text-surface-500">{isEdit ? route.name : 'Corridor details, addresses, distance & risk assessment'}</p>
            <p className="text-xs text-surface-400 mt-1">Loading site, addresses, and distance stay in sync with Rector → Targets regulations.</p>
          </div>
          {isEdit && <RiskBadge level={summary.level} score={summary.average_score} />}
        </div>

        <div className="flex border-b border-surface-200 px-4 gap-1 overflow-x-auto">
          {[
            { id: 'details', label: 'Route details' },
            { id: 'risk', label: 'Risk assessment' },
            { id: 'preview', label: 'RSO preview' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-500 hover:text-surface-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'details' && (
            <form onSubmit={saveDetails} className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-surface-600">Route name *</label>
                <input required value={routeForm.name} onChange={(e) => setRouteForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Loading site (short)</label>
                <input value={routeForm.starting_point} onChange={(e) => setRouteForm((f) => ({ ...f, starting_point: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Mine A loadout" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Destination (short)</label>
                <input value={routeForm.destination} onChange={(e) => setRouteForm((f) => ({ ...f, destination: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Richards Bay port" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-surface-600">Loading address (full)</label>
                <textarea value={routeForm.loading_address} onChange={(e) => setRouteForm((f) => ({ ...f, loading_address: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Street, GPS, landmark, province…" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-surface-600">Destination address (full)</label>
                <textarea value={routeForm.destination_address} onChange={(e) => setRouteForm((f) => ({ ...f, destination_address: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Distance (km)</label>
                <input type="number" min="0" step="0.1" value={routeForm.distance_km} onChange={(e) => setRouteForm((f) => ({ ...f, distance_km: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Route expiration</label>
                <input type="date" value={routeForm.route_expiration} onChange={(e) => setRouteForm((f) => ({ ...f, route_expiration: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Capacity</label>
                <input type="number" min="0" value={routeForm.capacity} onChange={(e) => setRouteForm((f) => ({ ...f, capacity: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-surface-600">Minimal tons</label>
                <input type="number" min="0" step="0.01" value={routeForm.min_tons} onChange={(e) => setRouteForm((f) => ({ ...f, min_tons: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="36" />
                <p className="text-[10px] text-surface-400 mt-1">Default 36 t — used for payload defaults on shift reports and finance. Editable per route.</p>
              </div>
            </form>
          )}

          {tab === 'risk' && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-surface-600">Corridor summary</label>
                  <textarea value={assessment.corridor_summary} onChange={(e) => setAssessment((a) => ({ ...a, corridor_summary: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Describe the corridor, terrain, and primary haulage context…" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Assessor name</label>
                  <input value={assessment.assessor_name} onChange={(e) => setAssessment((a) => ({ ...a, assessor_name: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Assessor role</label>
                  <input value={assessment.assessor_role} onChange={(e) => setAssessment((a) => ({ ...a, assessor_role: e.target.value }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. Route Safety Officer" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Review due date</label>
                  <input type="date" value={assessment.review_due_date || ''} onChange={(e) => setAssessment((a) => ({ ...a, review_due_date: e.target.value || null }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Recommended max speed (km/h)</label>
                  <input type="number" min="0" value={assessment.recommended_max_speed_kmh ?? ''} onChange={(e) => setAssessment((a) => ({ ...a, recommended_max_speed_kmh: e.target.value ? Number(e.target.value) : null }))} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-sm pt-6">
                  <input type="checkbox" checked={assessment.escort_required} onChange={(e) => setAssessment((a) => ({ ...a, escort_required: e.target.checked }))} />
                  Escort required
                </label>
                <label className="flex items-center gap-2 text-sm pt-6">
                  <input type="checkbox" checked={assessment.night_travel_allowed !== false} onChange={(e) => setAssessment((a) => ({ ...a, night_travel_allowed: e.target.checked }))} />
                  Night travel allowed
                </label>
              </div>

              {RISK_FACTOR_DEFS.map((sec) => (
                <div key={sec.id} className="rounded-xl border border-surface-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-surface-50 border-b border-surface-200 font-semibold text-sm text-surface-800">{sec.section}</div>
                  <div className="divide-y divide-surface-100">
                    {sec.items.map((item) => (
                      <div key={item.id} className="p-3 grid lg:grid-cols-12 gap-2 items-start">
                        <p className="lg:col-span-4 text-xs text-surface-700 font-medium leading-snug">{item.label}</p>
                        <div className="lg:col-span-2">
                          <ScoreSelect value={assessment.scores[item.id] ?? 2} onChange={(v) => setScore(item.id, v)} />
                        </div>
                        <div className="lg:col-span-3">
                          <input placeholder="Mitigation / control" value={assessment.mitigations[item.id] || ''} onChange={(e) => setMitigation(item.id, e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-xs" />
                        </div>
                        <div className="lg:col-span-3">
                          <input placeholder="Notes" value={assessment.notes[item.id] || ''} onChange={(e) => setNote(item.id, e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-3">
                <div>
                  <label className="text-xs font-medium text-surface-600">Hazards identified</label>
                  <textarea value={assessment.hazards_identified} onChange={(e) => setAssessment((a) => ({ ...a, hazards_identified: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Control measures</label>
                  <textarea value={assessment.control_measures} onChange={(e) => setAssessment((a) => ({ ...a, control_measures: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-surface-600">Emergency response plan</label>
                  <textarea value={assessment.emergency_plan} onChange={(e) => setAssessment((a) => ({ ...a, emergency_plan: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-800">Route Smart Outlook</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <RiskBadge level={summary.level} score={summary.average_score} />
                  <span className="text-sm text-surface-600">{routeForm.distance_km ? `${routeForm.distance_km} km corridor` : 'Distance not set'}</span>
                </div>
                {summary.top_risks?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-surface-600 mb-2">Top risks (≥4/5)</p>
                    <ul className="space-y-1 text-sm">
                      {summary.top_risks.map((r) => (
                        <li key={r.id} className="text-red-800">• {r.label} — {r.score}/5</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.recommendations?.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {summary.recommendations.map((rec, i) => (
                      <li key={i} className="text-xs rounded-lg bg-white border border-surface-200 px-3 py-2 text-surface-700">{rec}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-xs text-surface-500">Download a formal PDF for distribution to rectors, hauliers, and compliance files.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-surface-200 flex flex-wrap gap-2 justify-end bg-surface-50/80">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-white">Cancel</button>
          {isEdit && (
            <button type="button" onClick={downloadPdf} disabled={pdfLoading} className="px-4 py-2 text-sm rounded-lg border border-brand-300 text-brand-800 bg-brand-50 hover:bg-brand-100 disabled:opacity-50">
              {pdfLoading ? 'Generating PDF…' : 'Download risk PDF'}
            </button>
          )}
          {tab === 'risk' && isEdit && (
            <button type="button" onClick={saveRisk} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-surface-800 text-white hover:bg-surface-900 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save risk assessment'}
            </button>
          )}
          {(tab === 'details' || !isEdit) && (
            <button type="button" onClick={saveDetails} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save route details' : 'Register route'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { RiskBadge };
