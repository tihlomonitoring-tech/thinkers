import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { classifyStatus, matchRouteFromPaste } from '../lib/truckUpdateInsights.js';
import {
  buildWhatsAppFleetUpdateFromRows,
  refineRowForWhatsApp,
  WHATSAPP_FLEET_UPDATE_SAMPLE,
} from '../lib/rawExportToFleetUpdate.js';
import {
  buildDeliveryAnalytics,
  filterUpdatesByRoute,
  getClosedDeliveries,
  withClosedDelivery,
} from '../lib/logisticsFlowDelivery.js';
import InfoHint from './InfoHint.jsx';

function normReg(reg) {
  return String(reg || '').replace(/[\s\-_/]/g, '').toUpperCase();
}

function statusBadge(status) {
  const bucket = classifyStatus(status);
  if (bucket === 'complete') return 'bg-emerald-100 text-emerald-800';
  if (bucket === 'queue') return 'bg-amber-100 text-amber-800';
  if (bucket === 'transit') return 'bg-sky-100 text-sky-800';
  return 'bg-surface-100 text-surface-700';
}

function formatCell(row) {
  if (!row) return '—';
  const tons = row.tons != null ? Number(row.tons).toFixed(2) : '—';
  const hours = row.hours != null ? Number(row.hours).toFixed(2) : '—';
  const st = String(row.status || '').slice(0, 40);
  return `${st || '—'} · ${tons}t · ${hours}h`;
}

const SAMPLE_RAW_PASTE = `FLEET UPDATE/ALLOCATION
Monday
2026-05-18
NTSHOVELO -> MAJUBA POWER STATION
JW40LXGP - (SINGISI) - QUEUEING (D) - Tons: 33.00 - Hours: 24.19
JWV080MP - (SINGISI) - ENROUTE - Tons: 36.00 - Hours: 1.61
MF49BMGP - (COLT LOGISTICS) - Queuing at Ntshovelo - Tons: 34.80 - Hours: 0.26`;

export default function LogisticsFlowPage({ logisticsApi, routesApi, portal = 'command_centre' }) {
  const [view, setView] = useState('import');
  const [shift, setShift] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [confirmations, setConfirmations] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseMeta, setParseMeta] = useState({});
  const [parseWarnings, setParseWarnings] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(null);
  const [parseMethod, setParseMethod] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyDetail, setHistoryDetail] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [shiftSummary, setShiftSummary] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [routeTruckCount, setRouteTruckCount] = useState(null);
  const [whatsappExportText, setWhatsappExportText] = useState('');
  const [showExportAfterAccept, setShowExportAfterAccept] = useState(false);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [analyticsUpdateFocus, setAnalyticsUpdateFocus] = useState('all');
  const [dismissedPendingBanner, setDismissedPendingBanner] = useState(false);
  const parseAbortRef = useRef(null);

  const selectedRoute = useMemo(
    () => routes.find((r) => String(r.id) === String(selectedRouteId)),
    [routes, selectedRouteId]
  );

  const routeLabelForExport = useMemo(
    () => selectedRoute?.name || parseMeta.route || '',
    [selectedRoute, parseMeta.route]
  );

  const rebuildWhatsAppExport = useCallback(
    (rows, meta = parseMeta) => {
      if (!rows?.length) {
        setWhatsappExportText('');
        return;
      }
      const text = buildWhatsAppFleetUpdateFromRows({
        rows,
        routeLabel: routeLabelForExport || meta.route,
        dayName:
          meta.dayName ||
          (meta.date
            ? new Date(meta.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })
            : undefined),
        isoDate: meta.date,
      });
      setWhatsappExportText(text);
    },
    [routeLabelForExport, parseMeta]
  );

  const loadActive = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await logisticsApi.getActiveShift();
      if (r.migrationRequired) {
        setError('Database migration required: run npm run db:logistics-flow on the server.');
        return;
      }
      setShift(r.shift || null);
      setUpdates(r.updates || []);
      setConfirmations(r.shift?.confirmations || {});
      setShiftSummary(r.shift?.summary || null);
    } catch (e) {
      setError(e?.message || 'Failed to load shift');
    } finally {
      setLoading(false);
    }
  }, [logisticsApi]);

  useEffect(() => {
    loadActive();
  }, [loadActive]);

  useEffect(() => {
    if (!routesApi?.list) return;
    let cancelled = false;
    setRoutesLoading(true);
    routesApi
      .list()
      .then((r) => {
        if (!cancelled) setRoutes(r.routes || []);
      })
      .catch(() => {
        if (!cancelled) setRoutes([]);
      })
      .finally(() => {
        if (!cancelled) setRoutesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routesApi]);

  useEffect(() => {
    if (shift?.routeId && !selectedRouteId) {
      setSelectedRouteId(shift.routeId);
    }
  }, [shift?.routeId, selectedRouteId]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await logisticsApi.listShifts('completed');
      setHistory(r.shifts || []);
    } catch (_) {
      setHistory([]);
    }
  }, [logisticsApi]);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view, loadHistory]);

  const startShift = async () => {
    if (!selectedRouteId && !parseMeta.route) {
      setError('Select a route before starting a shift — analytics are kept per route.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const routeLabel =
        selectedRoute?.name || parseMeta.route || null;
      const r = await logisticsApi.createShift({
        portal,
        route_id: selectedRouteId || null,
        route_label: routeLabel,
        shift_date: parseMeta.date || null,
      });
      setShift(r.shift);
      setUpdates([]);
      setConfirmations({});
      setShiftSummary(null);
    } catch (e) {
      setError(e?.message || 'Could not start shift');
    } finally {
      setSaving(false);
    }
  };

  const applyParseResult = (r) => {
    const meta = r.meta || {};
    const label = selectedRoute?.name || meta.route || '';
    const rows = (r.rows || []).map((row, i) => {
      const refined = refineRowForWhatsApp(
        { ...row, entity: row.suggestedContractor || row.entity || '' },
        label
      );
      return { ...refined, _id: `row-${i}` };
    });
    setParsedRows(rows);
    setParseMeta(meta);
    setReviewSearch('');
    setReviewFilter('all');
    setParseWarnings(r.warnings || []);
    setParseMethod(r.parseMethod || 'regex');
    setAiAvailable(!!r.aiAvailable);
    setRouteTruckCount(r.routeTruckCount ?? null);
    rebuildWhatsAppExport(rows, meta);
    if (!selectedRouteId && meta.route && routes.length) {
      const matched = matchRouteFromPaste(meta.route, routes);
      if (matched) setSelectedRouteId(matched);
    }
  };

  const handleRouteSelect = (routeId) => {
    setSelectedRouteId(routeId);
    setRouteTruckCount(null);
    const label = routes.find((r) => String(r.id) === String(routeId))?.name || '';
    setParsedRows((prev) => {
      if (!prev.length) return prev;
      const next = prev.map((row) => refineRowForWhatsApp(row, label));
      rebuildWhatsAppExport(next, parseMeta);
      return next;
    });
  };

  const runParse = async (useAi) => {
    if (!pasteText.trim()) return;
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    setParsing(true);
    setParseProgress({ percent: 5, message: 'Starting…', phase: 'start' });
    setError('');
    try {
      const body = {
        text: pasteText,
        useAi,
        route_id: selectedRouteId || null,
        route_label: selectedRoute?.name || null,
      };
      const r = logisticsApi.parseStream
        ? await logisticsApi.parseStream(body, {
            signal: controller.signal,
            onProgress: (p) => setParseProgress(p),
          })
        : await logisticsApi.parse(body);
      applyParseResult(r);
      setParseProgress({ percent: 100, message: 'Complete', phase: 'done' });
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Parse failed');
    } finally {
      setParsing(false);
      setTimeout(() => setParseProgress(null), 1200);
    }
  };

  const cancelParse = () => {
    parseAbortRef.current?.abort();
    setParsing(false);
    setParseProgress(null);
  };

  const updateParsedRow = (id, field, value) => {
    setParsedRows((prev) => {
      const next = prev.map((r) => {
        if (r._id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === 'status') {
          updated.displayStatus = value;
          updated.statusManuallyEdited = true;
        }
        return updated;
      });
      rebuildWhatsAppExport(next, parseMeta);
      return next;
    });
  };

  const deleteParsedRow = (id) => {
    setParsedRows((prev) => {
      const next = prev.filter((r) => r._id !== id);
      rebuildWhatsAppExport(next, parseMeta);
      return next;
    });
  };

  const filteredParsedRows = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return parsedRows.filter((row) => {
      if (reviewFilter === 'not_register' && row.enrollmentFound) return false;
      if (reviewFilter === 'not_route' && (!row.enrollmentFound || !row.notOnSelectedRoute)) return false;
      if (reviewFilter === 'contractor_mismatch' && !row.contractorMismatch) return false;
      if (reviewFilter === 'ok' && (!row.enrollmentFound || row.notOnSelectedRoute || row.contractorMismatch)) {
        return false;
      }
      if (!q) return true;
      const hay = [
        row.registration,
        row.systemContractor,
        row.entity,
        row.suggestedContractor,
        row.displayStatus,
        row.status,
        row.rawStatus,
        row.comment,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [parsedRows, reviewSearch, reviewFilter]);

  const copyWhatsAppExport = async () => {
    if (!whatsappExportText.trim()) return;
    try {
      await navigator.clipboard.writeText(whatsappExportText);
      window.alert('WhatsApp update copied. Paste it into your client chat.');
    } catch (_) {
      window.alert('Could not copy to clipboard.');
    }
  };

  const acceptParsedUpdate = async () => {
    if (!parsedRows.length) return;
    const acceptRouteId = selectedRouteId || shift?.routeId || null;
    const acceptRouteLabel = routeLabelForExport || parseMeta.route || shift?.routeLabel || null;
    setSaving(true);
    setError('');
    try {
      let activeShift = shift;
      if (
        activeShift?.routeId &&
        acceptRouteId &&
        String(activeShift.routeId) !== String(acceptRouteId)
      ) {
        const ok = window.confirm(
          'This paste is for a different route than the active shift. Start a new shift for this route? (The current shift will be completed.)'
        );
        if (!ok) {
          setSaving(false);
          return;
        }
        if (activeShift.id) await logisticsApi.completeShift(activeShift.id).catch(() => {});
        const created = await logisticsApi.createShift({
          portal,
          route_id: acceptRouteId,
          route_label: acceptRouteLabel,
          shift_date: parseMeta.date || null,
        });
        activeShift = created.shift;
        setShift(created.shift);
        setUpdates([]);
        setConfirmations({});
      }
      let activeId = activeShift?.id;
      if (!activeId) {
        const created = await logisticsApi.createShift({
          portal,
          route_id: acceptRouteId || null,
          route_label: acceptRouteLabel,
          shift_date: parseMeta.date || null,
        });
        activeId = created.shift?.id;
        setShift(created.shift);
      }
      if (!activeId) {
        setError('Start a shift before accepting updates.');
        return;
      }
      const rows = parsedRows.map(({ _id, ...rest }) => rest);
      const exportText = buildWhatsAppFleetUpdateFromRows({
        rows,
        routeLabel: routeLabelForExport || parseMeta.route,
        dayName:
          parseMeta.dayName ||
          (parseMeta.date
            ? new Date(parseMeta.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })
            : undefined),
        isoDate: parseMeta.date,
      });
      setWhatsappExportText(exportText);
      await logisticsApi.addUpdate(activeId, {
        rows,
        raw_text: pasteText,
        meta: {
          ...parseMeta,
          whatsapp_export: exportText,
          route_id: selectedRouteId || shift?.routeId || null,
          route_label: routeLabelForExport || parseMeta.route || shift?.routeLabel || null,
        },
        label: `Update ${(updates.length || 0) + 1}`,
      });
      setParsedRows([]);
      setPasteText('');
      setDismissedPendingBanner(false);
      setShowExportAfterAccept(true);
      setView('analytics');
      await loadActive();
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const routeScopedUpdates = useMemo(
    () => filterUpdatesByRoute(updates, shift?.routeId || selectedRouteId, shift?.routeLabel || routeLabelForExport),
    [updates, shift?.routeId, shift?.routeLabel, selectedRouteId, routeLabelForExport]
  );

  const deliveryAnalytics = useMemo(
    () => buildDeliveryAnalytics(routeScopedUpdates, getClosedDeliveries(confirmations)),
    [routeScopedUpdates, confirmations]
  );

  const { visibleRows: matrixRows, pendingConfirm, progress: shiftProgress, sortedUpdates } = deliveryAnalytics;

  const displayUpdates = useMemo(() => {
    if (analyticsUpdateFocus === 'all') return sortedUpdates;
    return sortedUpdates.filter((u) => u.id === analyticsUpdateFocus);
  }, [sortedUpdates, analyticsUpdateFocus]);

  const closeDelivery = (reg, cycle, status, lastUpdateId, lastRow) => {
    const next = withClosedDelivery(confirmations, reg, cycle, status, lastUpdateId, lastRow);
    setConfirmations(next);
    if (shift?.id) {
      logisticsApi.saveConfirmations(shift.id, next).catch(() => {});
    }
  };

  const pendingConfirmations = shiftProgress.deliveriesPending;

  const completeShift = async () => {
    if (!shift?.id) return;
    if (pendingConfirmations > 0) {
      const ok = window.confirm(
        `${pendingConfirmations} truck(s) still need delivery confirmation (dropped off the latest update). Complete shift anyway?`
      );
      if (!ok) return;
    }
    setCompleting(true);
    try {
      const r = await logisticsApi.completeShift(shift.id);
      setShiftSummary(r.summary);
      setView('history');
      await loadHistory();
      setShift(null);
      setUpdates([]);
      setConfirmations({});
    } catch (e) {
      setError(e?.message || 'Could not complete shift');
    } finally {
      setCompleting(false);
    }
  };

  const openHistoryShift = async (id) => {
    try {
      const r = await logisticsApi.getShift(id);
      setHistoryDetail(r);
    } catch (e) {
      setError(e?.message || 'Failed to load history');
    }
  };

  return (
    <div className="space-y-4 max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-900 tracking-tight">Logistics flow and updates</h1>
          <p className="text-sm text-surface-600 mt-1 max-w-3xl">
            Import fleet updates from external systems, verify each truck against your register, confirm deliveries every paste — like an aviation checklist so nothing is missed.
          </p>
        </div>
        {shift && (
          <div className="text-sm bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
            <span className="font-medium text-brand-900">Active shift</span>
            {shift.routeLabel && <span className="text-brand-800 ml-2">{shift.routeLabel}</span>}
            <span className="text-brand-700 ml-2">
              · {routeScopedUpdates.length} update{routeScopedUpdates.length === 1 ? '' : 's'} on this route
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 flex justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-600 underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex gap-2 border-b border-surface-200">
        {[
          { id: 'import', label: 'Import & verify' },
          { id: 'analytics', label: 'Flow analytics & insights' },
          { id: 'history', label: 'Updates analysis history' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              view === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
            {t.id === 'analytics' && pendingConfirmations > 0 && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">{pendingConfirmations}</span>
            )}
          </button>
        ))}
      </div>

      {loading && view !== 'history' ? (
        <p className="text-sm text-surface-500 py-8">Loading…</p>
      ) : (
        <>
          {view === 'import' && (
            <div className="space-y-4">
              {!shift && (
                <section className="app-glass-card p-4 border border-amber-200 bg-amber-50/50">
                  <p className="text-sm text-amber-900 font-medium">Start a shift before importing updates</p>
                  <p className="text-sm text-amber-800 mt-1">Each shift groups every paste into analytics columns until you complete the analysis.</p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={startShift}
                    className="mt-3 px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {saving ? 'Starting…' : 'Start shift'}
                  </button>
                </section>
              )}

              <section className="app-glass-card p-4 border border-brand-100 bg-brand-50/30">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <label className="block text-xs font-medium text-surface-600 uppercase tracking-wider mb-1">
                      Route for this update
                    </label>
                    <select
                      value={selectedRouteId}
                      onChange={(e) => handleRouteSelect(e.target.value)}
                      disabled={routesLoading}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white"
                    >
                      <option value="">All fleet (no route filter)</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || r.id}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-surface-500 mt-1">
                      Select the route this paste concerns — matching is faster and flags trucks not enrolled on that route.
                    </p>
                  </div>
                  {selectedRouteId && routeTruckCount != null && (
                    <p className="text-sm text-brand-800 bg-white border border-brand-200 rounded-lg px-3 py-2">
                      <span className="font-medium">{routeTruckCount}</span> truck(s) enrolled on this route
                    </p>
                  )}
                </div>
              </section>

              <section className="app-glass-panel-2xl p-4 border border-surface-200">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h2 className="font-semibold text-surface-900">Paste exported text</h2>
                  <InfoHint
                    title="Import"
                    text="Paste WhatsApp or export-system fleet updates. Rule-based parse is free; use AI only when lines are messy."
                  />
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={12}
                  placeholder={SAMPLE_RAW_PASTE}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono"
                />
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    disabled={parsing || !pasteText.trim()}
                    onClick={() => runParse(false)}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {parsing ? 'Parsing…' : 'Study update (rule-based)'}
                  </button>
                  <button
                    type="button"
                    disabled={parsing || !pasteText.trim()}
                    onClick={() => runParse(true)}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-violet-300 text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                    title={aiAvailable ? 'Uses OpenAI when configured' : 'Requires OPENAI_API_KEY on server'}
                  >
                    Refine with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasteText(SAMPLE_RAW_PASTE)}
                    className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600"
                  >
                    Sample raw paste
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhatsappExportText(WHATSAPP_FLEET_UPDATE_SAMPLE)}
                    className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600"
                  >
                    Sample WhatsApp output
                  </button>
                  {parsing && (
                    <button
                      type="button"
                      onClick={cancelParse}
                      className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {(parsing || parseProgress) && (
                  <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/80 p-3" role="status" aria-live="polite">
                    <div className="flex justify-between text-xs text-violet-900 mb-1.5">
                      <span className="font-medium">{parseProgress?.message || 'Working…'}</span>
                      <span>{Math.round(parseProgress?.percent ?? 0)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-violet-200 overflow-hidden">
                      <div
                        className="h-full bg-violet-600 transition-all duration-500 ease-out rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, parseProgress?.percent ?? 0))}%` }}
                      />
                    </div>
                  </div>
                )}
                {parseMethod && (
                  <p className="text-xs text-surface-500 mt-2">
                    Parsed via {parseMethod}
                    {parseWarnings.length > 0 && ` · ${parseWarnings.length} line(s) could not be read automatically`}
                  </p>
                )}
              </section>

              {(whatsappExportText || parsedRows.length > 0) && (
                <section className="app-glass-panel-2xl p-4 border border-emerald-200 bg-emerald-50/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-semibold text-emerald-900">WhatsApp export preview</h3>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        Presentable text for clients — copy before or after accepting. Status lines use the route destination (e.g. Queuing at Majuba PS, not QUEUEING (D)).
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!whatsappExportText.trim()}
                      onClick={copyWhatsAppExport}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Copy for WhatsApp
                    </button>
                  </div>
                  <textarea
                    readOnly={parsedRows.length > 0}
                    value={whatsappExportText}
                    onChange={(e) => setWhatsappExportText(e.target.value)}
                    rows={10}
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-mono text-surface-800"
                    aria-label="WhatsApp fleet update export"
                  />
                </section>
              )}

              {parsedRows.length > 0 && (
                <section className="app-glass-panel-2xl overflow-hidden border border-surface-200">
                  <div className="px-4 py-3 bg-surface-50 border-b border-surface-200 flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold text-surface-900">Review before accepting ({parsedRows.length} trucks)</h3>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={acceptParsedUpdate}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Accept update'}
                    </button>
                  </div>
                  <div className="px-4 py-3 border-b border-surface-200 bg-white flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs font-medium text-surface-600 mb-1">Search</label>
                      <input
                        type="search"
                        value={reviewSearch}
                        onChange={(e) => setReviewSearch(e.target.value)}
                        placeholder="Registration, contractor, status…"
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="min-w-[180px]">
                      <label className="block text-xs font-medium text-surface-600 mb-1">Filter</label>
                      <select
                        value={reviewFilter}
                        onChange={(e) => setReviewFilter(e.target.value)}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white"
                      >
                        <option value="all">All trucks</option>
                        <option value="not_register">Not on register</option>
                        <option value="not_route">Not on selected route</option>
                        <option value="contractor_mismatch">Contractor mismatch</option>
                        <option value="ok">Matched OK</option>
                      </select>
                    </div>
                    <p className="text-xs text-surface-500 pb-2">
                      Showing {filteredParsedRows.length} of {parsedRows.length}
                    </p>
                  </div>
                  <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-red-800 text-white">
                          <th className="text-left px-3 py-2 font-semibold w-16" aria-label="Remove" />
                          <th className="text-left px-3 py-2 font-semibold">Registration</th>
                          <th className="text-left px-3 py-2 font-semibold">Contractor (system)</th>
                          <th className="text-left px-3 py-2 font-semibold">Pasted contractor</th>
                          <th className="text-left px-3 py-2 font-semibold min-w-[200px]">Status (WhatsApp)</th>
                          <th className="text-left px-3 py-2 font-semibold">Tons</th>
                          <th className="text-left px-3 py-2 font-semibold">Hours</th>
                          <th className="text-left px-3 py-2 font-semibold min-w-[140px]">Comment</th>
                          <th className="text-left px-3 py-2 font-semibold">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredParsedRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-4 py-8 text-center text-surface-500">
                              No trucks match your search or filter.
                            </td>
                          </tr>
                        ) : (
                        filteredParsedRows.map((row) => (
                          <tr
                            key={row._id}
                            className={`border-b border-surface-100 ${
                              row.notOnSelectedRoute
                                ? 'bg-amber-50'
                                : row.contractorMismatch
                                  ? 'bg-amber-50/70'
                                  : row.enrollmentFound
                                    ? ''
                                    : 'bg-red-50/60'
                            }`}
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => deleteParsedRow(row._id)}
                                className="text-red-700 hover:text-red-900 text-xs font-medium px-1.5 py-0.5 rounded border border-red-200 hover:bg-red-50"
                                title="Remove truck from this update"
                              >
                                Remove
                              </button>
                            </td>
                            <td className="px-3 py-2 font-mono font-medium">
                              <input
                                value={row.registration}
                                onChange={(e) => updateParsedRow(row._id, 'registration', e.target.value)}
                                className={`w-28 rounded border px-1 py-0.5 font-mono text-sm ${
                                  !row.enrollmentFound
                                    ? 'border-amber-400 bg-amber-50 font-bold'
                                    : 'border-surface-300'
                                }`}
                              />
                              {!row.enrollmentFound && (
                                <p className="text-[10px] text-amber-800 font-medium mt-0.5">⚠ Not integrated</p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-surface-700">{row.systemContractor || '—'}</td>
                            <td className="px-3 py-2">
                              <input
                                value={row.entity}
                                onChange={(e) => updateParsedRow(row._id, 'entity', e.target.value)}
                                className="w-full min-w-[120px] rounded border border-surface-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={row.displayStatus || row.status}
                                onChange={(e) => updateParsedRow(row._id, 'status', e.target.value)}
                                className="w-full min-w-[180px] rounded border border-surface-300 px-2 py-1 text-sm font-medium text-surface-900"
                              />
                              {row.rawStatus &&
                                String(row.rawStatus).trim() !== String(row.displayStatus || row.status).trim() && (
                                  <p className="text-[10px] text-surface-500 mt-0.5 truncate" title={row.rawStatus}>
                                    Import: {row.rawStatus}
                                  </p>
                                )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={row.tons}
                                onChange={(e) => updateParsedRow(row._id, 'tons', parseFloat(e.target.value))}
                                className="w-20 rounded border border-surface-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={row.hours}
                                onChange={(e) => updateParsedRow(row._id, 'hours', parseFloat(e.target.value))}
                                className="w-20 rounded border border-surface-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={row.comment || ''}
                                onChange={(e) => updateParsedRow(row._id, 'comment', e.target.value)}
                                placeholder="Optional note for WhatsApp"
                                className="w-full min-w-[120px] rounded border border-surface-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {!row.enrollmentFound && <span className="text-red-700 font-medium">Not on register</span>}
                              {row.enrollmentFound && row.notOnSelectedRoute && (
                                <span className="text-amber-800 font-medium">Not on selected route</span>
                              )}
                              {row.enrollmentFound && !row.notOnSelectedRoute && row.contractorMismatch && (
                                <span className="text-amber-800">Contractor name differs</span>
                              )}
                              {row.enrollmentFound && !row.notOnSelectedRoute && !row.contractorMismatch && (
                                <span className="text-emerald-700">OK</span>
                              )}
                            </td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}

          {view === 'analytics' && (
            <div className="space-y-4">
              {showExportAfterAccept && whatsappExportText && (
                <section className="app-glass-card p-4 border border-emerald-300 bg-emerald-50">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div>
                      <h3 className="font-semibold text-emerald-900">Export for WhatsApp</h3>
                      <p className="text-sm text-emerald-800">Update accepted. Copy this message and send it to your clients.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={copyWhatsAppExport}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800"
                      >
                        Copy for WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowExportAfterAccept(false)}
                        className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={whatsappExportText}
                    rows={8}
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-mono"
                  />
                </section>
              )}
              {!shift ? (
                <p className="text-sm text-surface-600 py-6">No active shift. Start a shift on Import & verify, then accept an update.</p>
              ) : routeScopedUpdates.length === 0 ? (
                <p className="text-sm text-surface-600 py-6">No updates yet for this route. Import and accept a fleet paste first.</p>
              ) : (
                <>
                  <section className="app-glass-card p-4 border border-brand-100">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-sm font-semibold text-surface-900">
                          {shift.routeLabel || 'Route'} — shift progress
                        </p>
                        <p className="text-xs text-surface-600 mt-0.5">
                          When a truck disappears on the next paste, confirm delivery once — it leaves the list. If it returns later, that counts as a new delivery.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={completing}
                        onClick={completeShift}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-red-800 text-white hover:bg-red-900 disabled:opacity-50"
                      >
                        {completing ? 'Completing…' : 'Complete shift analysis'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <div className="flex justify-between text-xs text-surface-600 mb-1">
                          <span>Trucks (latest update)</span>
                          <span className="font-semibold text-surface-900">{shiftProgress.trucksInLatest}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-200 overflow-hidden">
                          <div
                            className="h-full bg-brand-600 rounded-full transition-all"
                            style={{
                              width: `${shiftProgress.trucksVisible ? Math.min(100, (shiftProgress.trucksInLatest / shiftProgress.trucksVisible) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-surface-500 mt-1">{shiftProgress.trucksVisible} on active list</p>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-surface-600 mb-1">
                          <span>Tons (latest update)</span>
                          <span className="font-semibold text-surface-900">{shiftProgress.tonsLatestUpdate.toFixed(2)} t</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-200 overflow-hidden">
                          <div
                            className="h-full bg-sky-600 rounded-full transition-all"
                            style={{
                              width: `${shiftProgress.tonsAllUpdates ? Math.min(100, (shiftProgress.tonsLatestUpdate / shiftProgress.tonsAllUpdates) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-surface-500 mt-1">{shiftProgress.tonsAllUpdates.toFixed(2)} t across all updates</p>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-surface-600 mb-1">
                          <span>Deliveries confirmed</span>
                          <span className="font-semibold text-surface-900">
                            {shiftProgress.deliveriesConfirmed} /{' '}
                            {shiftProgress.deliveriesTotal ||
                              shiftProgress.deliveriesConfirmed + shiftProgress.deliveriesPending}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-200 overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full transition-all"
                            style={{
                              width: `${
                                (shiftProgress.deliveriesTotal ||
                                  shiftProgress.deliveriesPending + shiftProgress.deliveriesConfirmed) > 0
                                  ? Math.min(
                                      100,
                                      (shiftProgress.deliveriesConfirmed /
                                        (shiftProgress.deliveriesTotal ||
                                          shiftProgress.deliveriesPending + shiftProgress.deliveriesConfirmed)) *
                                        100
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-surface-500 mt-1">
                          {shiftProgress.deliveriesPending > 0
                            ? `${shiftProgress.deliveriesPending} awaiting confirmation`
                            : 'All drop-offs confirmed'}
                        </p>
                      </div>
                    </div>
                  </section>

                  {pendingConfirm.length > 0 && !dismissedPendingBanner && (
                    <section className="app-glass-card p-4 border border-amber-300 bg-amber-50">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-amber-900">
                            {pendingConfirm.length} truck{pendingConfirm.length === 1 ? '' : 's'} left the fleet update
                          </p>
                          <p className="text-xs text-amber-800 mt-0.5">
                            Confirm each delivery in the table — confirmed trucks are removed until they appear in a later paste (2nd delivery).
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDismissedPendingBanner(true)}
                          className="text-xs text-amber-800 underline shrink-0"
                        >
                          Dismiss banner
                        </button>
                      </div>
                    </section>
                  )}

                  <section className="app-glass-card p-3 border border-surface-200">
                    <p className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-2">Updates on this route</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAnalyticsUpdateFocus('all')}
                        className={`px-3 py-1.5 text-xs rounded-lg border ${
                          analyticsUpdateFocus === 'all'
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white border-surface-300 text-surface-700'
                        }`}
                      >
                        All columns
                      </button>
                      {sortedUpdates.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setAnalyticsUpdateFocus(u.id)}
                          className={`px-3 py-1.5 text-xs rounded-lg border ${
                            analyticsUpdateFocus === u.id
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white border-surface-300 text-surface-700'
                          }`}
                        >
                          {u.label}
                          <span className="opacity-80 ml-1">({(u.rows || []).length})</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="app-glass-panel-2xl overflow-hidden border border-surface-200 shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-red-800 text-white">
                            <th className="text-left px-3 py-2 font-semibold border border-red-900 sticky left-0 z-20 bg-red-800 min-w-[120px]">
                              Registration
                            </th>
                            <th className="text-left px-3 py-2 font-semibold border border-red-900 sticky left-[120px] z-20 bg-red-800 min-w-[120px]">
                              Contractor
                            </th>
                            <th className="text-left px-3 py-2 font-semibold border border-red-900 min-w-[72px]">Delivery</th>
                            <th className="text-left px-3 py-2 font-semibold border border-red-900 min-w-[100px]">Latest status</th>
                            {displayUpdates.map((u) => (
                              <th key={u.id} className="text-left px-2 py-2 font-semibold border border-red-900 min-w-[180px]">
                                <div>{u.label}</div>
                                <div className="text-xs font-normal opacity-90">
                                  {u.pastedAt ? new Date(u.pastedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </th>
                            ))}
                            <th className="text-left px-2 py-2 font-semibold border border-red-900 min-w-[200px]">Delivery action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matrixRows.length === 0 ? (
                            <tr>
                              <td colSpan={4 + displayUpdates.length + 1} className="px-4 py-10 text-center text-surface-500">
                                No active trucks on this route.
                              </td>
                            </tr>
                          ) : (
                            matrixRows.map((row) => (
                              <tr
                                key={row.rowKey}
                                className={`border-b border-surface-200 ${row.needsConfirmation ? 'bg-amber-50/90' : ''}`}
                              >
                                <td className="px-3 py-2 border border-surface-200 bg-white sticky left-0 z-10 font-mono font-medium">
                                  {row.registration}
                                </td>
                                <td className="px-3 py-2 border border-surface-200 bg-white sticky left-[120px] z-10 text-surface-800">
                                  {row.contractor}
                                </td>
                                <td className="px-3 py-2 border border-surface-200 bg-white text-xs">
                                  {row.cycle > 1 ? (
                                    <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-medium">
                                      #{row.cycle}
                                    </span>
                                  ) : (
                                    <span className="text-surface-500">1st</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 border border-surface-200 bg-white">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(row.latestStatus)}`}>
                                    {row.latestStatus || '—'}
                                  </span>
                                </td>
                                {displayUpdates.map((u) => {
                                  const cell = row.cells[u.id];
                                  return (
                                    <td key={u.id} className="px-2 py-2 border border-surface-200 align-top bg-white">
                                      {cell ? (
                                        <p className="text-xs text-surface-700 leading-snug">{formatCell(cell)}</p>
                                      ) : (
                                        <span className="text-surface-400 text-xs">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-2 border border-surface-200 align-top bg-white min-w-[200px]">
                                  {row.needsConfirmation && row.pendingMeta ? (
                                    <div className="space-y-1.5">
                                      <p className="text-[11px] text-amber-900 leading-snug">
                                        Not in {row.pendingMeta.missingLabel}. Last seen in {row.pendingMeta.label}. Was this delivery completed?
                                      </p>
                                      <div className="flex flex-wrap gap-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            closeDelivery(
                                              row.registration,
                                              row.cycle,
                                              'completed',
                                              row.pendingMeta.lastUpdateId,
                                              row.lastRow
                                            )
                                          }
                                          className="px-2 py-0.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700"
                                        >
                                          Yes, completed
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            closeDelivery(
                                              row.registration,
                                              row.cycle,
                                              'not_completed',
                                              row.pendingMeta.lastUpdateId,
                                              row.lastRow
                                            )
                                          }
                                          className="px-2 py-0.5 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                                        >
                                          Not completed
                                        </button>
                                      </div>
                                    </div>
                                  ) : row.isActive ? (
                                    <span className="text-xs text-emerald-700">On latest update</span>
                                  ) : (
                                    <span className="text-xs text-surface-500">—</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </div>
          )}

          {view === 'history' && (
            <div className="space-y-4">
              {shiftSummary && (
                <section className="app-glass-card p-4 border border-emerald-200 bg-emerald-50/40">
                  <h3 className="font-semibold text-emerald-900">Shift completed</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-sm">
                    <div>
                      <span className="text-surface-500 block text-xs">Deliveries confirmed</span>
                      <span className="font-semibold text-surface-900">{shiftSummary.deliveriesConfirmed ?? 0}</span>
                    </div>
                    <div>
                      <span className="text-surface-500 block text-xs">Total tons (snapshots)</span>
                      <span className="font-semibold text-surface-900">{shiftSummary.totalTons ?? 0}</span>
                    </div>
                    <div>
                      <span className="text-surface-500 block text-xs">Average tons</span>
                      <span className="font-semibold text-surface-900">{shiftSummary.averageTons ?? 0}</span>
                    </div>
                    <div>
                      <span className="text-surface-500 block text-xs">Average hours</span>
                      <span className="font-semibold text-surface-900">{shiftSummary.averageHours ?? 0}</span>
                    </div>
                  </div>
                </section>
              )}

              <section className="app-glass-panel-2xl border border-surface-200 overflow-hidden">
                <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
                  <h3 className="font-semibold text-surface-900">Completed shift analyses</h3>
                </div>
                {history.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-surface-500">No completed analyses yet.</p>
                ) : (
                  <ul className="divide-y divide-surface-100">
                    {history.map((h) => (
                      <li key={h.id} className="px-4 py-3 flex flex-wrap justify-between gap-2 hover:bg-surface-50">
                        <div>
                          <p className="font-medium text-surface-900">{h.routeLabel || 'Shift'}</p>
                          <p className="text-xs text-surface-500">
                            {h.completedAt ? new Date(h.completedAt).toLocaleString() : '—'}
                            {h.summary?.deliveriesConfirmed != null && (
                              <span className="ml-2">· {h.summary.deliveriesConfirmed} deliveries confirmed</span>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openHistoryShift(h.id)}
                          className="text-sm text-brand-600 hover:underline"
                        >
                          View
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {historyDetail?.shift && (
                <section className="app-glass-card p-4 border border-surface-200">
                  <h4 className="font-semibold text-surface-900 mb-2">Shift summary</h4>
                  <pre className="text-xs bg-surface-50 rounded-lg p-3 overflow-auto max-h-48">
                    {JSON.stringify(historyDetail.shift.summary, null, 2)}
                  </pre>
                  <p className="text-xs text-surface-500 mt-2">{historyDetail.updates?.length || 0} update column(s) archived</p>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
