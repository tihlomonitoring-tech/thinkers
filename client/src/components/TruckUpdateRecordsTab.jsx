import { useState, useMemo, useEffect, useCallback, startTransition, useDeferredValue, useRef } from 'react';
import {
  parseFleetUpdateText,
  loadTruckUpdateHistory,
  appendTruckUpdateSession,
  clearTruckUpdateHistory,
  flattenHistoryRows,
  flattenHistoryRowsAll,
  buildTrendAggregates,
  loadDeliveryConfirmations,
  saveDeliveryConfirmations,
  loadTruckUpdateSettings,
  saveTruckUpdateSettings,
  sliceSessionsForAnalysis,
  MAX_SESSIONS_FOR_ANALYSIS,
  loadShiftRecord,
  saveShiftRecord,
  filterSessionsInShiftPeriod,
  completeShiftAndClearWorkingData,
  appendShiftArchive,
  loadShiftArchives,
  buildWorkspacePayload,
  applyWorkspaceFromPayload,
} from '../lib/truckUpdateParse.js';
import {
  normalizeRegistration,
  normalizeRouteKey,
  matchRouteFromPaste,
  classifyStatus,
  buildCrossSessionInsights,
  buildDroppedFromLatestPaste,
  buildShiftDeliveryTruckTotals,
  dropConfirmationKey,
  enrollmentForRow,
} from '../lib/truckUpdateInsights.js';
import { contractor as contractorApi, commandCentre as ccApi } from '../api.js';
import {
  convertRawExportToFleetUpdate,
  buildRegistrationEntityMap,
  parseRouteHeaderFromPasteLine,
  detectPasteIssueLines,
  matchBreakdownForPasteIssue,
} from '../lib/rawExportToFleetUpdate.js';

function defaultShiftStartLocal() {
  const start = new Date();
  start.setHours(6, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const d = start;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SAMPLE = `FLEET UPDATE/ALLOCATION
Friday
2026-03-27
NTSHOVELO → KELVIN PS
KFD971MP - (IMPANGELE L.) - **Offloading at Kelvin PS (D)** - Tons: 35.85 - Hours: 4.72
JZS337MP - (IMPANGELE L.) - **Offloading at Kelvin PS (D)** - Tons: 34.65 - Hours: 4.09`;

function badgeEnrollment(kind) {
  if (kind === 'matched') {
    return 'bg-emerald-100 dark:bg-emerald-950/55 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-700';
  }
  if (kind === 'not_on_route') {
    return 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-700';
  }
  return 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 border-surface-200 dark:border-surface-600';
}

function badgeConfirmation(v) {
  if (v === 'completed') return 'bg-emerald-600 dark:bg-emerald-500 text-white';
  if (v === 'not_completed') return 'bg-red-600 dark:bg-red-500 text-white';
  return 'bg-surface-200 dark:bg-surface-600 text-surface-700 dark:text-surface-200';
}

export default function TruckUpdateRecordsTab({ resumeServerSessionId, onResumeConsumed }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState(() => loadTruckUpdateHistory());
  const [shiftRecord, setShiftRecord] = useState(() => loadShiftRecord());
  const [archives, setArchives] = useState(() => loadShiftArchives());
  const [shiftFormStart, setShiftFormStart] = useState(() => defaultShiftStartLocal());
  const [shiftFormRouteId, setShiftFormRouteId] = useState('');
  const [ccControllers, setCcControllers] = useState([]);
  const [selectedControllerIds, setSelectedControllerIds] = useState([]);
  const [serverSessionId, setServerSessionId] = useState(null);
  const [serverReference, setServerReference] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastParse, setLastParse] = useState(null);
  const [filterReg, setFilterReg] = useState('');
  const [confirmations, setConfirmations] = useState(() => loadDeliveryConfirmations());
  const [settings, setSettings] = useState(() => {
    const s = loadTruckUpdateSettings();
    const sh = loadShiftRecord();
    return sh?.routeId ? { ...s, routeId: sh.routeId } : s;
  });
  const [routes, setRoutes] = useState([]);
  const [routeDetail, setRouteDetail] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routesError, setRoutesError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [startShiftInfoOpen, setStartShiftInfoOpen] = useState(false);
  const [rawExportHelpOpen, setRawExportHelpOpen] = useState(false);
  /** Sub-views inside Command Centre → Truck update records */
  const [truckRecordsView, setTruckRecordsView] = useState('analysis');
  const [rawExportInput, setRawExportInput] = useState('');
  const [rawExportOutput, setRawExportOutput] = useState('');
  const [rawExportWarnings, setRawExportWarnings] = useState([]);
  const [rawExportIssues, setRawExportIssues] = useState([]);
  const [issueResolvedChoice, setIssueResolvedChoice] = useState({});
  const [pasteBreakdowns, setPasteBreakdowns] = useState([]);
  const [pasteBreakdownsLoading, setPasteBreakdownsLoading] = useState(false);
  /** Full fleet list for company lookup when route rows omit names (same registration / truck_id). */
  const [fleetTrucksList, setFleetTrucksList] = useState([]);
  const pasteRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    contractorApi.routes
      .list()
      .then((r) => {
        if (!cancelled) setRoutes(r.routes || []);
      })
      .catch((e) => {
        if (!cancelled) setRoutesError(e?.message || 'Could not load routes');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ccApi.truckAnalysis
      .controllers()
      .then((r) => {
        if (!cancelled) setCcControllers(r.controllers || []);
      })
      .catch(() => {
        if (!cancelled) setCcControllers([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!resumeServerSessionId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await ccApi.truckAnalysis.getSession(resumeServerSessionId);
        if (cancelled) return;
        const session = data.session;
        if (session.pruned || !session.payload) {
          window.alert(
            'This analysis is no longer available on the server (12 hours with no one opening it). Start a new analysis.'
          );
        } else {
          applyWorkspaceFromPayload(session.payload);
          setHistory(loadTruckUpdateHistory());
          setShiftRecord(loadShiftRecord());
          setConfirmations(loadDeliveryConfirmations());
          setSettings(loadTruckUpdateSettings());
          setArchives(loadShiftArchives());
          setServerSessionId(session.id);
          setServerReference(session.reference_code || null);
          setText('');
          setLastParse(null);
        }
      } catch (e) {
        if (!cancelled) window.alert(e?.message || 'Could not load analysis');
      } finally {
        if (!cancelled) onResumeConsumed?.();
      }
    })();
    return () => { cancelled = true; };
  }, [resumeServerSessionId, onResumeConsumed]);

  useEffect(() => {
    if (!settings.routeId) {
      setRouteDetail(null);
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    contractorApi.routes
      .get(settings.routeId)
      .then((d) => {
        if (!cancelled) setRouteDetail(d);
      })
      .catch(() => {
        if (!cancelled) setRouteDetail(null);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => { cancelled = true; };
  }, [settings.routeId]);

  useEffect(() => {
    let cancelled = false;
    contractorApi.trucks
      .list()
      .then((r) => {
        if (!cancelled) setFleetTrucksList(Array.isArray(r.trucks) ? r.trucks : []);
      })
      .catch(() => {
        if (!cancelled) setFleetTrucksList([]);
      });
    return () => { cancelled = true; };
  }, []);

  const refreshPasteBreakdowns = useCallback(() => {
    setPasteBreakdownsLoading(true);
    ccApi.breakdowns
      .list({ resolved: 'false' })
      .then((r) => setPasteBreakdowns(Array.isArray(r.breakdowns) ? r.breakdowns : []))
      .catch(() => setPasteBreakdowns([]))
      .finally(() => setPasteBreakdownsLoading(false));
  }, []);

  useEffect(() => {
    refreshPasteBreakdowns();
  }, [refreshPasteBreakdowns]);

  const issueBreakdownMatches = useMemo(() => {
    const map = {};
    for (const iss of rawExportIssues) {
      map[iss.id] = matchBreakdownForPasteIssue(iss, pasteBreakdowns);
    }
    return map;
  }, [rawExportIssues, pasteBreakdowns]);

  const persistSettings = useCallback((next) => {
    setSettings(next);
    saveTruckUpdateSettings(next);
    setShiftRecord((sr) => {
      if (!sr || next.routeId === sr.routeId) return sr;
      const u = { ...sr, routeId: next.routeId };
      saveShiftRecord(u);
      return u;
    });
  }, []);

  const scopedHistory = useMemo(() => {
    if (!shiftRecord) return [];
    return filterSessionsInShiftPeriod(history, shiftRecord.shiftStart, shiftRecord.shiftEnd);
  }, [history, shiftRecord]);

  const sessionsOutsideShift = useMemo(() => {
    if (!shiftRecord) return [];
    const t0 = new Date(shiftRecord.shiftStart).getTime();
    if (Number.isNaN(t0)) return [];
    return history.filter((s) => {
      const t = new Date(s.savedAt).getTime();
      if (Number.isNaN(t)) return false;
      if (t < t0) return true;
      if (shiftRecord.shiftEnd) {
        const t1 = new Date(shiftRecord.shiftEnd).getTime();
        if (!Number.isNaN(t1) && t > t1) return true;
      }
      return false;
    });
  }, [history, shiftRecord]);

  const enrolledRegs = useMemo(() => {
    const set = new Set();
    for (const t of routeDetail?.trucks || []) {
      const n = normalizeRegistration(t.registration);
      if (n) set.add(n);
    }
    return set;
  }, [routeDetail]);

  const rawExportEntityMap = useMemo(
    () => buildRegistrationEntityMap(routeDetail?.trucks || [], fleetTrucksList),
    [routeDetail, fleetTrucksList]
  );

  const selectedRouteDisplayName = useMemo(
    () => routes.find((r) => r.id === settings.routeId)?.name?.trim() || '',
    [routes, settings.routeId]
  );

  const deferredHistory = useDeferredValue(scopedHistory);
  const sessionsForAnalysis = useMemo(
    () => sliceSessionsForAnalysis(deferredHistory),
    [deferredHistory]
  );
  const flatRows = useMemo(() => flattenHistoryRows(sessionsForAnalysis), [sessionsForAnalysis]);
  const flatRowsAll = useMemo(() => flattenHistoryRowsAll(scopedHistory), [scopedHistory]);

  const filteredFlat = useMemo(() => {
    const q = filterReg.trim().toUpperCase();
    if (!q) return flatRows;
    return flatRows.filter((r) => (r.registration || '').includes(q));
  }, [flatRows, filterReg]);

  const trends = useMemo(
    () => buildTrendAggregates(filteredFlat, { entityMap: rawExportEntityMap }),
    [filteredFlat, rawExportEntityMap]
  );
  const trendsByDateCapped = useMemo(() => trends.byDate.slice(-45), [trends.byDate]);
  const maxTonsBar = Math.max(1, ...trends.byTruck.slice(0, 12).map((t) => t.totalTons));
  const maxDateTons = Math.max(1, ...trendsByDateCapped.map((d) => d.totalTons));

  const cross = useMemo(
    () =>
      buildCrossSessionInsights(sessionsForAnalysis, {
        compareWindowHours: settings.compareWindowHours,
        longQueueHours: settings.longQueueHours,
        longTransitHours: settings.longTransitHours,
        longHoursOnSite: settings.longHoursOnSite,
      }),
    [
      sessionsForAnalysis,
      settings.compareWindowHours,
      settings.longQueueHours,
      settings.longTransitHours,
      settings.longHoursOnSite,
    ]
  );

  const droppedFromLatest = useMemo(
    () => buildDroppedFromLatestPaste(sessionsForAnalysis),
    [sessionsForAnalysis]
  );

  const droppedPending = useMemo(() => {
    return droppedFromLatest.filter((d) => {
      const k = dropConfirmationKey(d.registration);
      const v = confirmations[k] || 'pending';
      return v === 'pending';
    });
  }, [droppedFromLatest, confirmations]);

  const sortedSessions = useMemo(
    () => [...scopedHistory].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt))),
    [scopedHistory]
  );
  const lastSession = sortedSessions[sortedSessions.length - 1];
  const staleForLastSession = useMemo(() => {
    if (!lastSession?.savedAt) return [];
    return cross.stale.filter((s) => s.at === lastSession.savedAt);
  }, [cross.stale, lastSession]);

  const staleRegSet = useMemo(
    () => new Set(staleForLastSession.map((s) => s.registration)),
    [staleForLastSession]
  );

  const autoRouteIdFromPaste = useMemo(() => {
    if (!lastParse?.rows?.length || !routes.length) return null;
    const pr = lastParse.rows.find((r) => r.route);
    if (!pr?.route) return null;
    return matchRouteFromPaste(pr.route, routes);
  }, [lastParse, routes]);

  const setConfirmation = (rowId, value) => {
    const next = { ...confirmations, [rowId]: value };
    setConfirmations(next);
    saveDeliveryConfirmations(next);
  };

  const handleParse = () => {
    if (!shiftRecord) return;
    const { rows, warnings, comments } = parseFleetUpdateText(text);
    if (rows.length === 0) {
      setLastParse({
        rows,
        warnings: warnings || [],
        comments: comments || [],
        at: new Date().toISOString(),
      });
      return;
    }
    const savedAt = new Date().toISOString();
    const updated = appendTruckUpdateSession({
      savedAt,
      sourcePreview: text.slice(0, 200),
      rows,
      warnings: warnings || [],
      comments: comments || [],
      shiftId: shiftRecord?.id ?? null,
    });
    const latest = updated[updated.length - 1];
    startTransition(() => {
      setHistory(updated);
      setLastParse({
        rows: latest?.rows || rows,
        warnings: warnings || [],
        comments: latest?.comments ?? comments ?? [],
        at: latest?.savedAt || savedAt,
      });
    });
  };

  const handleConvertRawExport = () => {
    const hasRouteInPaste = rawExportInput.split(/\r?\n/).some((ln) => parseRouteHeaderFromPasteLine(ln));
    if (!hasRouteInPaste && (!settings.routeId || !selectedRouteDisplayName)) {
      window.alert(
        'Select a route under Route for enrolment check when your paste does not include route lines (e.g. NTSHOVELO → MAJUBA …), or paste a full export that already contains those route headers.'
      );
      return;
    }
    const { text, warnings, linesConverted } = convertRawExportToFleetUpdate({
      rawText: rawExportInput,
      routeDisplayName: selectedRouteDisplayName,
      regToEntity: rawExportEntityMap,
    });
    setRawExportOutput(text);
    setRawExportWarnings(warnings || []);
    setRawExportIssues(detectPasteIssueLines(rawExportInput));
    setIssueResolvedChoice({});
    if (linesConverted === 0 && !text) {
      window.alert(warnings?.[0] || 'Could not parse any truck lines from the raw export.');
    }
  };

  const handleApplyRawExportToPaste = () => {
    if (!rawExportOutput.trim()) return;
    setText(rawExportOutput);
  };

  const handleCopyRawExport = async () => {
    if (!rawExportOutput.trim()) return;
    try {
      await navigator.clipboard.writeText(rawExportOutput);
    } catch (_) {
      window.alert('Could not copy to clipboard.');
    }
  };

  const handleStartNewRecords = () => {
    if (
      !window.confirm(
        'Delete all saved pastes and delivery confirmations in this browser, clear the text box, and start fresh? This cannot be undone.'
      )
    ) {
      return;
    }
    clearTruckUpdateHistory();
    saveShiftRecord(null);
    setShiftRecord(null);
    setConfirmations({});
    setHistory([]);
    setLastParse(null);
    setText('');
    setServerSessionId(null);
    setServerReference(null);
  };

  const handleStartShift = () => {
    if (selectedControllerIds.length === 0) {
      window.alert('Select at least one controller (Command Centre users).');
      return;
    }
    if (!shiftFormRouteId) {
      window.alert('Select a route for this shift.');
      return;
    }
    const tStart = new Date(shiftFormStart).getTime();
    if (Number.isNaN(tStart)) {
      window.alert('Invalid shift start.');
      return;
    }
    const shiftStart = new Date(shiftFormStart).toISOString();
    const names = selectedControllerIds
      .map((cid) => {
        const c = ccControllers.find((x) => x.id === cid);
        return c?.full_name || c?.email || cid;
      })
      .filter(Boolean);
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `shift-${Date.now()}`;
    const rec = {
      id,
      controllerNames: names,
      controllerUserIds: [...selectedControllerIds],
      shiftStart,
      shiftEnd: null,
      routeId: shiftFormRouteId,
    };
    saveShiftRecord(rec);
    setShiftRecord(rec);
    setServerSessionId(null);
    setServerReference(null);
    setSettings((s) => {
      const next = { ...s, routeId: shiftFormRouteId };
      saveTruckUpdateSettings(next);
      return next;
    });
  };

  const handleSaveToServer = async () => {
    setSaveError('');
    setSaving(true);
    try {
      const payload = buildWorkspacePayload();
      if (!serverSessionId) {
        const c = await ccApi.truckAnalysis.createSession(payload);
        setServerSessionId(c.id);
        setServerReference(c.reference_code);
      } else {
        await ccApi.truckAnalysis.saveSession(serverSessionId, payload);
      }
    } catch (e) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleExitLocal = () => {
    if (
      !window.confirm(
        'Exit this workspace in the browser? Use Save first if you need the latest state on the server. Unsaved local changes will be lost.'
      )
    ) {
      return;
    }
    setServerSessionId(null);
    setServerReference(null);
    completeShiftAndClearWorkingData();
    setShiftRecord(null);
    setHistory([]);
    setConfirmations({});
    setText('');
    setLastParse(null);
    setArchives(loadShiftArchives());
  };

  const handleNewAnalysis = () => {
    if (
      !window.confirm(
        'Start a new analysis here? Clears the current shift and pastes in this browser. Save to the server first if you need to keep this session.'
      )
    ) {
      return;
    }
    setServerSessionId(null);
    setServerReference(null);
    completeShiftAndClearWorkingData();
    setShiftRecord(null);
    setHistory([]);
    setConfirmations({});
    setText('');
    setLastParse(null);
    setArchives(loadShiftArchives());
    setSelectedControllerIds([]);
  };

  const handleHandoverAnalysis = async () => {
    if (!shiftRecord) return;
    const scoped = filterSessionsInShiftPeriod(history, shiftRecord.shiftStart, shiftRecord.shiftEnd);
    const sliced = sliceSessionsForAnalysis(scoped);
    const truckTotals = buildShiftDeliveryTruckTotals(sliced, confirmations);
    const confirmMsg =
      `Hand over this analysis for the next controller?\n\n` +
      `Trucks (unique registrations):\n` +
      `• Delivery completed: ${truckTotals.trucksCompletedDelivery}\n` +
      `• Not done (never marked completed): ${truckTotals.trucksNotDone}\n` +
      `• Still unset: ${truckTotals.trucksOutcomePending}\n\n` +
      `A short reference will be saved on the server. This browser workspace will clear. Others can continue from Handed over analysis. After 12 hours with no one opening that session, detailed pastes are removed from the server.`;
    if (!window.confirm(confirmMsg)) {
      return;
    }
    const flat = flattenHistoryRows(sliced);
    const agg = buildTrendAggregates(flat, { entityMap: rawExportEntityMap });
    const dropped = buildDroppedFromLatestPaste(sliced);
    let droppedCompleted = 0;
    let droppedNotDone = 0;
    let droppedPending = 0;
    for (const d of dropped) {
      const v = confirmations[dropConfirmationKey(d.registration)] || 'pending';
      if (v === 'completed') droppedCompleted += 1;
      else if (v === 'not_completed') droppedNotDone += 1;
      else droppedPending += 1;
    }
    const flatAll = flattenHistoryRowsAll(scoped);
    let rowDeliveryDone = 0;
    let rowDeliveryNotDone = 0;
    for (const r of flatAll) {
      const rid = r.rowId;
      if (!rid) continue;
      const v = confirmations[rid] || 'pending';
      if (v === 'completed') rowDeliveryDone += 1;
      else if (v === 'not_completed') rowDeliveryNotDone += 1;
    }
    const routeName = routes.find((x) => x.id === shiftRecord.routeId)?.name || shiftRecord.routeId || '—';
    const summaryForServer = {
      truckTotals,
      routeName,
      routeId: shiftRecord.routeId,
      shiftStart: shiftRecord.shiftStart,
      controllerNames: shiftRecord.controllerNames,
      pasteCount: scoped.length,
      rowCount: flat.length,
      uniqueTrucks: agg.summary.uniqueTrucks,
      totalTons: agg.summary.totalTons,
      totalHours: agg.summary.totalHours,
      droppedCompleted,
      droppedNotDone,
      droppedPending,
      rowDeliveryDone,
      rowDeliveryNotDone,
      handedOverAt: new Date().toISOString(),
    };

    setSaving(true);
    setSaveError('');
    try {
      const payload = buildWorkspacePayload();
      let sid = serverSessionId;
      let ref = serverReference;
      if (!sid) {
        const c = await ccApi.truckAnalysis.createSession(payload);
        sid = c.id;
        ref = c.reference_code;
        setServerSessionId(sid);
        setServerReference(ref);
      } else {
        await ccApi.truckAnalysis.saveSession(sid, payload);
      }
      const ho = await ccApi.truckAnalysis.handover(sid, summaryForServer);
      const finalRef = ho.reference_code || ref;
      appendShiftArchive({
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `arch-${Date.now()}`,
        referenceCode: finalRef,
        shiftId: shiftRecord.id,
        controllerNames: shiftRecord.controllerNames,
        shiftStart: shiftRecord.shiftStart,
        shiftEnd: shiftRecord.shiftEnd,
        routeId: shiftRecord.routeId,
        routeName,
        completedAt: new Date().toISOString(),
        summary: {
          pasteCount: scoped.length,
          rowCount: flat.length,
          uniqueTrucks: agg.summary.uniqueTrucks,
          totalTons: agg.summary.totalTons,
          totalHours: agg.summary.totalHours,
          trucksCompletedDelivery: truckTotals.trucksCompletedDelivery,
          trucksNotDone: truckTotals.trucksNotDone,
          trucksOutcomePending: truckTotals.trucksOutcomePending,
          droppedCompleted,
          droppedNotDone,
          droppedPending,
          rowDeliveryDone,
          rowDeliveryNotDone,
        },
      });
      setArchives(loadShiftArchives());
      window.alert(
        `Handover saved.\n\nReference: ${finalRef}\n\nUse the Handed over analysis tab to continue. If nobody opens this session for 12 hours, detailed paste data is removed from the server.`
      );
      completeShiftAndClearWorkingData();
      setShiftRecord(null);
      setHistory([]);
      setConfirmations({});
      setText('');
      setLastParse(null);
      setServerSessionId(null);
      setServerReference(null);
    } catch (e) {
      setSaveError(e?.message || 'Handover failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSample = () => setText(SAMPLE);

  const handleAddNewRecords = () => {
    setText('');
    setLastParse(null);
    requestAnimationFrame(() => {
      const el = pasteRef.current;
      if (!el) return;
      el.focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const enrollmentLabel = (registration) => {
    if (!settings.routeId) return { kind: 'unknown', label: 'Pick route' };
    if (routeLoading) return { kind: 'unknown', label: 'Loading…' };
    if (!routeDetail) return { kind: 'unknown', label: '—' };
    if (!enrolledRegs.size) return { kind: 'unknown', label: 'No trucks on route' };
    const k = enrollmentForRow(registration, enrolledRegs);
    return {
      kind: k,
      label: k === 'matched' ? 'On route' : k === 'not_on_route' ? 'Not enrolled' : '?',
    };
  };

  const mergedInsights = useMemo(() => {
    const base = [...(trends.insights || [])];
    for (const x of cross.insights || []) {
      base.push({ type: x.type, text: x.text });
    }
    return base;
  }, [trends.insights, cross.insights]);

  const confirmationSummary = useMemo(() => {
    const ids = new Set(flatRowsAll.map((r) => r.rowId).filter(Boolean));
    let completed = 0;
    let notCompleted = 0;
    let unset = 0;
    for (const [id, v] of Object.entries(confirmations)) {
      if (!ids.has(id)) continue;
      if (v === 'completed') completed += 1;
      else if (v === 'not_completed') notCompleted += 1;
      else unset += 1;
    }
    return { completed, notCompleted, unset, tracked: completed + notCompleted + unset };
  }, [flatRowsAll, confirmations]);

  return (
    <div className="space-y-6">
      <div
        className="flex flex-wrap gap-1 border-b border-surface-200 dark:border-surface-700"
        role="tablist"
        aria-label="Truck update records views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={truckRecordsView === 'analysis'}
          aria-controls="truck-records-panel-analysis"
          id="truck-records-tab-analysis"
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
            truckRecordsView === 'analysis'
              ? 'border-brand-600 text-brand-800 dark:text-brand-300 bg-surface-50 dark:bg-surface-900/80'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-300'
          }`}
          onClick={() => setTruckRecordsView('analysis')}
        >
          Analysis
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={truckRecordsView === 'summaries'}
          aria-controls="truck-records-panel-summaries"
          id="truck-records-tab-summaries"
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
            truckRecordsView === 'summaries'
              ? 'border-brand-600 text-brand-800 dark:text-brand-300 bg-surface-50 dark:bg-surface-900/80'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-300'
          }`}
          onClick={() => setTruckRecordsView('summaries')}
        >
          Completed shift summaries
          {archives.length > 0 ? (
            <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md bg-surface-200/80 dark:bg-surface-700 text-surface-700 dark:text-surface-200">
              {archives.length}
            </span>
          ) : null}
        </button>
      </div>

      {truckRecordsView === 'analysis' && (
        <div
          className="space-y-6"
          role="tabpanel"
          id="truck-records-panel-analysis"
          aria-labelledby="truck-records-tab-analysis"
        >
        {!shiftRecord ? (
        <section className="rounded-2xl border-2 border-brand-200 dark:border-brand-700/70 bg-gradient-to-br from-brand-50 to-white p-6 sm:p-8 shadow-sm space-y-5">
          <div>
            <div className="flex items-start gap-2">
              <h2 className="text-xl font-bold text-surface-900 tracking-tight flex-1">Start a shift</h2>
              <button
                type="button"
                className={`shrink-0 mt-0.5 p-1.5 rounded-full border transition-colors ${
                  startShiftInfoOpen
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'border-transparent text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:text-brand-400 dark:hover:bg-surface-800'
                }`}
                aria-expanded={startShiftInfoOpen}
                aria-label={startShiftInfoOpen ? 'Hide how starting a shift works' : 'How starting a shift works'}
                title="How it works"
                onClick={() => setStartShiftInfoOpen((v) => !v)}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            </div>
            {startShiftInfoOpen && (
              <div className="mt-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 p-3 text-sm text-surface-600 shadow-sm max-w-2xl">
                <p>
                  Create the shift record before pasting fleet updates. Only pastes saved <strong className="text-surface-800 dark:text-surface-200">on or after</strong> the shift start
                  time are analysed (open-ended shift). Select controllers who have Command Centre access, route, and start time.
                  Use <strong className="text-surface-800 dark:text-surface-200">Save</strong> to store progress on the server for handover; use <strong className="text-surface-800 dark:text-surface-200">Handover analysis</strong> when
                  leaving the shift for the next controller.
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-500 mb-1">Controllers on shift</label>
              <p className="text-xs text-surface-500 mb-2">Users with Command Centre access (multi-select).</p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-200 bg-surface-50 p-2 space-y-1">
                {ccControllers.length === 0 ? (
                  <p className="text-sm text-amber-800 dark:text-amber-200 px-2 py-1">Could not load controller list. Check tenant context or try again.</p>
                ) : (
                  ccControllers.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white dark:hover:bg-surface-800 cursor-pointer text-sm text-surface-900 dark:text-surface-100"
                    >
                      <input
                        type="checkbox"
                        checked={selectedControllerIds.includes(c.id)}
                        onChange={() => {
                          setSelectedControllerIds((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                          );
                        }}
                      />
                      <span>{c.full_name || c.email}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-500 mb-1">Shift start</label>
              <input
                type="datetime-local"
                value={shiftFormStart}
                onChange={(e) => setShiftFormStart(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm dark:[color-scheme:dark]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-surface-500 mb-1">Route</label>
              <select
                value={shiftFormRouteId}
                onChange={(e) => setShiftFormRouteId(e.target.value)}
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm"
              >
                <option value="">— Select route (required) —</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name || r.id}</option>
                ))}
              </select>
              {routesError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{routesError}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartShift}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            Start shift &amp; enable pasting
          </button>
          <p className="text-xs text-surface-500">
            After starting, use <strong className="text-surface-700">Save</strong> on Truck update records to sync to the server,
            then <strong className="text-surface-700">Handover analysis</strong> when finishing your leg. Continue from the{' '}
            <strong className="text-surface-700">Handed over analysis</strong> tab using the reference code.
          </p>
        </section>
      ) : (
        <>
      <div>
        <div className="flex items-start gap-2">
          <h2 className="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight flex-1">Truck update records</h2>
          <button
            type="button"
            className={`shrink-0 mt-0.5 p-1.5 rounded-full border transition-colors ${
              howToOpen
                ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
                : 'border-transparent text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:text-brand-400 dark:hover:bg-surface-800'
            }`}
            aria-expanded={howToOpen}
            aria-label={howToOpen ? 'Hide how truck update analysis works' : 'How truck update analysis works'}
            title="How it works"
            onClick={() => setHowToOpen((v) => !v)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
        {howToOpen && (
          <div className="mt-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/70 p-3 text-sm text-surface-600 dark:text-surface-300 space-y-3 shadow-sm">
            <p>
              Paste fleet updates in order (e.g. every 2–3 hours). Analysis is limited to pastes on or after shift start and
              route. After you have more than one saved paste in scope,{' '}
              <strong className="font-semibold text-surface-800 dark:text-surface-100">do this first:</strong> go to{' '}
              <span className="font-semibold text-surface-800 dark:text-surface-100">Step 1</span> and mark every truck that no longer appears on the
              latest paste as <em>Done</em> (delivery completed) or <em>Not done</em> (still active or unknown). Then use the
              latest-paste table and trends.
            </p>
            <ol className="list-decimal list-outside pl-5 space-y-1.5 text-surface-600 dark:text-surface-300">
              <li>
                <span className="text-surface-800 dark:text-surface-100 font-medium">Step 1 — Dropped off latest paste:</span> trucks that appeared in
                an earlier paste but not the newest must be recorded.
              </li>
              <li>
                <span className="text-surface-800 dark:text-surface-100 font-medium">Step 2 — Latest paste rows:</span> confirm deliveries for trucks
                still listed.
              </li>
              <li>
                Trends and cross-paste checks use the recent paste window (see thresholds), within the shift start.
              </li>
            </ol>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/90 px-4 py-3 text-sm flex flex-wrap items-start justify-between gap-3 shadow-sm dark:!border-zinc-600 dark:!bg-zinc-950 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="min-w-0">
          <p className="font-semibold text-surface-900 dark:text-white">Active shift</p>
          <p className="text-surface-700 dark:text-white/85 mt-0.5">
            Controllers: {shiftRecord.controllerNames.length ? shiftRecord.controllerNames.join(', ') : '—'} · From{' '}
            {new Date(shiftRecord.shiftStart).toLocaleString()} (open-ended)
          </p>
          {serverReference && (
            <p className="text-xs font-mono text-brand-800 dark:text-white/75 mt-1">Server reference: {serverReference}</p>
          )}
          {saveError && <p className="text-xs text-red-600 dark:text-red-300 mt-1">{saveError}</p>}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSaveToServer}
            disabled={saving}
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleExitLocal}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-800 hover:bg-surface-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
          >
            Exit
          </button>
          <button
            type="button"
            onClick={handleNewAnalysis}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-800 hover:bg-surface-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
          >
            New analysis
          </button>
          <button
            type="button"
            onClick={handleHandoverAnalysis}
            disabled={saving}
            className="px-3 py-2 text-sm font-semibold rounded-lg border border-amber-700 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-brand-500/35 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          >
            Handover analysis
          </button>
        </div>
      </div>

      {sessionsOutsideShift.length > 0 && (
        <div className="rounded-xl border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-medium">Pastes before shift start</p>
          <p className="mt-1">
            {sessionsOutsideShift.length} saved paste(s) are before this shift start — they are ignored for this analysis. Use
            “Delete past records &amp; start new” if you want to remove them from the browser.
          </p>
        </div>
      )}

      {droppedPending.length > 0 && (
        <div
          className="rounded-xl border-2 border-amber-500 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/45 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 shadow-sm"
          role="status"
        >
          <p className="font-semibold">Do this first</p>
          <p className="mt-1">
            {droppedPending.length} registration{droppedPending.length === 1 ? '' : 's'} disappeared from the latest paste — complete{' '}
            <a href="#truck-update-step1" className="underline font-medium text-amber-950 dark:text-amber-200">
              Step 1
            </a>{' '}
            and mark each as Done or Not done before relying on the summary below.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-4 dark:!border-zinc-600 dark:!bg-zinc-950 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] dark:text-white">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1 dark:text-white/75">Route for enrolment check</label>
            <select
              value={settings.routeId}
              onChange={(e) => persistSettings({ ...settings, routeId: e.target.value })}
              className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm"
            >
              <option value="">— Select route (required for system match) —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name || r.id}</option>
              ))}
            </select>
            {routesError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{routesError}</p>}
            {autoRouteIdFromPaste && !settings.routeId && lastParse?.rows?.length > 0 && (
              <p className="text-xs text-surface-500 mt-1 dark:text-white/70">
                Suggested from paste:{' '}
                <button
                  type="button"
                  className="text-brand-600 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
                  onClick={() => persistSettings({ ...settings, routeId: autoRouteIdFromPaste })}
                >
                  use matched route
                </button>
              </p>
            )}
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
            >
              {showSettings ? 'Hide' : 'Show'} comparison thresholds
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-surface-100 bg-surface-50 text-sm dark:border-zinc-700 dark:bg-zinc-900/90">
            <div>
              <label className="block text-xs text-surface-500 mb-1 dark:text-white/70">Compare window (h)</label>
              <input
                type="number"
                min={2}
                max={48}
                value={settings.compareWindowHours}
                onChange={(e) => persistSettings({ ...settings, compareWindowHours: Number(e.target.value) || 6 })}
                className="w-full rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1 dark:text-white/70">Long queue (h)</label>
              <input
                type="number"
                min={1}
                max={24}
                value={settings.longQueueHours}
                onChange={(e) => persistSettings({ ...settings, longQueueHours: Number(e.target.value) || 3 })}
                className="w-full rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1 dark:text-white/70">Long en-route (h)</label>
              <input
                type="number"
                min={1}
                max={24}
                value={settings.longTransitHours}
                onChange={(e) => persistSettings({ ...settings, longTransitHours: Number(e.target.value) || 5 })}
                className="w-full rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1 dark:text-white/70">Rising hours alert (h)</label>
              <input
                type="number"
                min={2}
                max={48}
                value={settings.longHoursOnSite}
                onChange={(e) => persistSettings({ ...settings, longHoursOnSite: Number(e.target.value) || 8 })}
                className="w-full rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-2 py-1"
              />
            </div>
            <p className="col-span-full text-xs text-surface-500 dark:text-white/65">
              Only consecutive pastes within the compare window are diffed for missing / undeclared trucks. Queue and en-route
              flags use status text plus the “Hours” field from each line.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-surface-200 bg-surface-100/90 p-4 space-y-3 dark:!border-zinc-700 dark:!bg-zinc-950 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
          <div>
            <div className="flex items-start gap-2">
              <h3 className="text-sm font-semibold text-surface-900 dark:!text-white flex-1">Paste raw export</h3>
              <button
                type="button"
                className={`shrink-0 mt-0.5 p-1.5 rounded-full border transition-colors ${
                  rawExportHelpOpen
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'border-transparent text-surface-400 hover:text-brand-600 hover:bg-surface-100 dark:hover:text-brand-400 dark:hover:bg-surface-800'
                }`}
                aria-expanded={rawExportHelpOpen}
                aria-label={rawExportHelpOpen ? 'Hide raw export format help' : 'Show raw export format help'}
                title="Supported formats and behaviour"
                onClick={() => setRawExportHelpOpen((v) => !v)}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            </div>
            {rawExportHelpOpen && (
              <div className="mt-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 p-3 text-xs text-surface-600 dark:text-surface-300 max-w-3xl leading-relaxed shadow-sm">
                <p>
                  Supports fleet screenshots: <span className="font-mono text-surface-800 dark:text-surface-100">REG - (Company) - Status at site - Tons: … - Hours: …</span>, route banners{' '}
                  <span className="font-mono text-surface-700 dark:text-surface-200">ORIGIN → DESTINATION (Client)</span>, and older{' '}
                  <span className="font-mono text-surface-700 dark:text-surface-200">Hours / Weight</span> orders. Multiple routes in one paste are split automatically; status lines use the{' '}
                  <strong className="text-surface-800 dark:text-surface-100">destination from each route banner</strong> (e.g. Majuba) so waypoints like &quot;Enroute to Khashani-Kriel&quot; are not copied into the fleet file.
                  Company names prefer the <strong className="text-surface-800 dark:text-surface-100">contractor company</strong> from trucks enrolled on the selected route. Dates: weekday + ISO or{' '}
                  <span className="font-mono text-surface-700 dark:text-surface-200">07 April 2026</span>. Edit the converted text before applying. Notes mentioning breakdowns or delays are listed below for follow-up.
                </p>
              </div>
            )}
          </div>
          <textarea
            value={rawExportInput}
            onChange={(e) => setRawExportInput(e.target.value)}
            rows={5}
            placeholder="Paste raw export text here…"
            className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm font-mono placeholder:text-surface-400 dark:placeholder:text-surface-500"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={handleConvertRawExport}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-500 shadow-sm"
            >
              Convert to fleet update format
            </button>
            {rawExportOutput ? (
              <>
                <button
                  type="button"
                  onClick={handleCopyRawExport}
                  className="px-3 py-2 text-sm font-medium rounded-lg border border-surface-400 dark:border-surface-500 bg-surface-200/80 dark:bg-surface-700 text-surface-900 dark:text-surface-100 hover:bg-surface-300 dark:hover:bg-surface-600"
                >
                  Copy result
                </button>
                <button
                  type="button"
                  onClick={handleApplyRawExportToPaste}
                  className="px-3 py-2 text-sm font-medium rounded-lg border border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-950/50 text-brand-900 dark:text-brand-100 hover:bg-brand-100 dark:hover:bg-brand-900/40"
                >
                  Use as paste text
                </button>
              </>
            ) : null}
          </div>
          {rawExportWarnings.length > 0 && (
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside max-w-3xl">
              {rawExportWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {rawExportOutput ? (
            <textarea
              value={rawExportOutput}
              onChange={(e) => setRawExportOutput(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 px-3 py-2 text-sm font-mono text-surface-800 dark:text-surface-100"
              aria-label="Converted fleet update text (editable)"
            />
          ) : null}
          {rawExportIssues.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-amber-950 dark:text-amber-100">Notes &amp; issues from paste</h4>
                <button
                  type="button"
                  onClick={refreshPasteBreakdowns}
                  disabled={pasteBreakdownsLoading}
                  className="text-xs font-medium px-2 py-1 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-surface-900 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50"
                >
                  {pasteBreakdownsLoading ? 'Refreshing…' : 'Refresh breakdown match'}
                </button>
              </div>
              <p className="text-xs text-amber-900/90 dark:text-amber-200/90">
                Lines that look like <strong>breakdowns</strong> or <strong>comments</strong> (e.g. waiting for slips) are flagged. For each, say whether it is resolved on site. If a breakdown is mentioned, we match open Command Centre breakdown reports by truck registration; if none match, use{' '}
                <a href="/report-breakdown" target="_blank" rel="noopener noreferrer" className="underline font-medium text-amber-950 dark:text-amber-50">
                  Report breakdown
                </a>{' '}
                then refresh — we&apos;ll acknowledge when a matching open report appears.
              </p>
              <div className="overflow-x-auto rounded-md border border-amber-200/80 dark:border-amber-800/80 bg-white dark:bg-surface-950">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left border-b border-amber-200 dark:border-amber-800 bg-amber-100/50 dark:bg-amber-950/60">
                      <th className="p-2 font-semibold text-amber-950 dark:text-amber-100">#</th>
                      <th className="p-2 font-semibold text-amber-950 dark:text-amber-100">Excerpt</th>
                      <th className="p-2 font-semibold text-amber-950 dark:text-amber-100">Type</th>
                      <th className="p-2 font-semibold text-amber-950 dark:text-amber-100">System</th>
                      <th className="p-2 font-semibold text-amber-950 dark:text-amber-100">Resolved on site?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawExportIssues.map((iss) => {
                      const match = issueBreakdownMatches[iss.id];
                      return (
                        <tr key={iss.id} className="border-b border-amber-100 dark:border-amber-900/50 align-top">
                          <td className="p-2 text-surface-600 dark:text-surface-400 whitespace-nowrap">{iss.line}</td>
                          <td className="p-2 font-mono text-surface-800 dark:text-surface-200 max-w-[220px] sm:max-w-md break-words">{iss.text}</td>
                          <td className="p-2 capitalize text-surface-700 dark:text-surface-300">{iss.kind}</td>
                          <td className="p-2 text-surface-700 dark:text-surface-300">
                            {iss.kind === 'breakdown' && match ? (
                              <span className="inline-flex flex-col gap-0.5">
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Matched open report</span>
                                <span className="text-surface-600 dark:text-surface-400">{match.title || 'Breakdown'} · {match.truck_registration || '—'}</span>
                              </span>
                            ) : iss.kind === 'breakdown' ? (
                              <span className="text-amber-800 dark:text-amber-200">No open match — report if real</span>
                            ) : (
                              <span className="text-surface-500 dark:text-surface-400">—</span>
                            )}
                          </td>
                          <td className="p-2">
                            <select
                              value={issueResolvedChoice[iss.id] || ''}
                              onChange={(e) => setIssueResolvedChoice((prev) => ({ ...prev, [iss.id]: e.target.value }))}
                              className="w-full min-w-[8rem] rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 text-xs py-1"
                            >
                              <option value="">Not recorded</option>
                              <option value="yes">Yes</option>
                              <option value="no">No / open</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium text-surface-700 dark:text-white" htmlFor="truck-update-paste">
            Paste update text
          </label>
          <button
            type="button"
            onClick={handleAddNewRecords}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100 dark:border-white/20 dark:bg-transparent dark:text-white dark:hover:bg-white/10"
          >
            Add new records
          </button>
        </div>
        <textarea
          id="truck-update-paste"
          ref={pasteRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Paste FLEET UPDATE/ALLOCATION text here…"
          className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 px-3 py-2 text-sm font-mono text-surface-900 dark:text-surface-100 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 focus:border-brand-500"
        />
        <p className="text-xs text-surface-500 dark:text-white/70">
          You can include extra notes or new wording: those lines are stored as <strong className="font-medium text-surface-700 dark:text-white">comments</strong> on the paste. As long as the usual truck lines parse (registration, status, Tons, Hours), the paste is saved and analysed.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={handleParse}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 dark:hover:bg-brand-500"
          >
            Parse &amp; add to analysis
          </button>
          <button
            type="button"
            onClick={handleLoadSample}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={handleStartNewRecords}
            disabled={history.length === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-950/70 disabled:opacity-40"
          >
            Delete past records &amp; start new
          </button>
        </div>
        <p className="text-xs text-surface-500 dark:text-white/65">
          {scopedHistory.length} saved paste(s) in this shift window
          {history.length !== scopedHistory.length && (
            <span> ({history.length} total in browser, including outside this shift)</span>
          )}
          . Charts use the most recent {MAX_SESSIONS_FOR_ANALYSIS} pastes in the window. Confirmations apply to rows in this shift until you delete pastes or complete the shift.
        </p>
        {deferredHistory !== scopedHistory && (
          <p className="text-xs text-amber-800 dark:text-amber-300">Updating analysis…</p>
        )}
      </div>

      {sortedSessions.length >= 2 && (
        <section
          id="truck-update-step1"
          className={`rounded-2xl border p-4 sm:p-5 shadow-sm dark:shadow-none scroll-mt-4 ${
            droppedPending.length > 0
              ? 'border-amber-400 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/40 ring-1 ring-amber-200/80 dark:ring-amber-800/80'
              : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/80'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="font-semibold text-surface-900 dark:text-surface-100">Step 1 — Trucks absent from the latest paste</h3>
              <p className="text-sm text-surface-600 dark:text-surface-300 mt-1 max-w-3xl">
                These registrations showed up in an earlier saved paste but not in the <strong>most recent</strong> update.
                If they stay off the list across the 2nd, 3rd, or 4th paste, they stay here until you record an outcome.
              </p>
            </div>
            {droppedFromLatest.length > 0 && droppedPending.length === 0 && (
              <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-700 px-2 py-1 rounded-lg shrink-0">
                Step 1 complete
              </span>
            )}
          </div>

          {droppedFromLatest.length === 0 ? (
            <p className="text-sm text-surface-600 dark:text-surface-300 rounded-lg border border-dashed border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/50 px-3 py-2">
              No open items: every registration from earlier pastes still appears on the latest paste (or route lines differ — those are skipped to avoid false flags).
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-950">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-50 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Registration</th>
                    <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Last seen in history</th>
                    <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Outcome (saved in this browser)</th>
                  </tr>
                </thead>
                <tbody>
                  {droppedFromLatest.map((d) => {
                    const ck = dropConfirmationKey(d.registration);
                    const cur = confirmations[ck] || 'pending';
                    return (
                      <tr key={d.registration} className="border-t border-surface-100 dark:border-surface-800">
                        <td className="px-3 py-2 font-mono font-medium text-surface-900 dark:text-surface-100">{d.registration}</td>
                        <td className="px-3 py-2 text-surface-600 dark:text-surface-400">
                          {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(['pending', 'completed', 'not_completed']).map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => setConfirmation(ck, v)}
                                className={`text-xs px-2 py-1 rounded font-medium ${
                                  cur === v ? badgeConfirmation(v) : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                                }`}
                              >
                                {v === 'not_completed' ? 'Not done' : v === 'completed' ? 'Done' : 'Unset'}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {sortedSessions.length === 1 && (
        <p className="text-sm text-surface-600 dark:text-surface-300 rounded-xl border border-dashed border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/40 px-4 py-3">
          Add and parse a <strong>second</strong> paste to compare updates. Step 1 will list trucks that appeared before but
          not on the latest paste.
        </p>
      )}

      {lastParse && (
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/60 p-4 text-sm space-y-3">
          <div>
            <p className="font-medium text-surface-800 dark:text-surface-100">Last parse</p>
            <p className="text-surface-600 dark:text-surface-300 mt-1">
              {lastParse.rows.length} truck line(s)
              {(lastParse.warnings || []).length > 0 &&
                ` · ${(lastParse.warnings || []).length} truck-style line(s) could not be parsed`}
              {(lastParse.comments || []).length > 0 &&
                ` · ${(lastParse.comments || []).length} other line(s) saved as comments`}
            </p>
            {lastParse.rows.length === 0 && (lastParse.comments || []).length > 0 && (
              <p className="text-amber-800 dark:text-amber-200 text-xs mt-2">
                Add at least one valid truck line (registration, status, Tons, Hours) to save this paste to shift history.
                Notes above are shown only for this preview.
              </p>
            )}
          </div>
          {(lastParse.warnings || []).length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">Lines with Tons/Hours that did not parse</p>
              <ul className="mt-1 text-amber-800 dark:text-amber-200/90 text-xs list-disc list-inside space-y-1">
                {(lastParse.warnings || []).slice(0, 8).map((w) => (
                  <li key={w.line}>
                    Line {w.line}: “{w.text.length > 120 ? `${w.text.slice(0, 120)}…` : w.text}”
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(lastParse.comments || []).length > 0 && (
            <div>
              <p className="text-xs font-medium text-surface-700 dark:text-surface-300">Recorded comments (extra notes / new wording — not used for truck totals)</p>
              <ul className="mt-1 text-surface-600 dark:text-surface-400 text-xs list-disc list-inside space-y-1 max-h-48 overflow-y-auto">
                {(lastParse.comments || []).slice(0, 25).map((c) => (
                  <li key={c.line}>
                    <span className="text-surface-400 dark:text-surface-500">L{c.line}:</span> {c.text.length > 200 ? `${c.text.slice(0, 200)}…` : c.text}
                  </li>
                ))}
              </ul>
              {(lastParse.comments || []).length > 25 && (
                <p className="text-surface-500 dark:text-surface-500 text-xs mt-1">Showing 25 of {(lastParse.comments || []).length}.</p>
              )}
            </div>
          )}
        </div>
      )}

      {(cross.missing.length > 0 || cross.undeclared.length > 0) && (
        <section className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-4 sm:p-5 space-y-3">
          <h3 className="font-semibold text-amber-950 dark:text-amber-100">Cross-paste checks (recent window)</h3>
          {cross.missing.length > 0 && (
            <p className="text-sm text-amber-900 dark:text-amber-200/95">
              Consecutive-pair “missing” hints ({cross.missing.length}) are covered by{' '}
              <a href="#truck-update-step1" className="underline font-medium">
                Step 1
              </a>{' '}
              for trucks absent from the <strong>latest</strong> paste.
            </p>
          )}
          {cross.undeclared.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Possibly undeclared / new</p>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mb-1">Appeared in a newer paste but not the one just before it.</p>
              <ul className="text-sm text-amber-950 dark:text-amber-100 list-disc list-inside space-y-0.5">
                {cross.undeclared.slice(0, 20).map((m, i) => (
                  <li key={i}>
                    <span className="font-mono font-medium">{m.registration}</span>
                    {' '}· first seen {new Date(m.firstSeenAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {staleForLastSession.length > 0 && (
        <section className="rounded-2xl border border-orange-300 dark:border-orange-800 bg-orange-50/90 dark:bg-orange-950/40 p-4 text-sm">
          <h3 className="font-semibold text-orange-950 dark:text-orange-100 mb-2">Flags on latest paste</h3>
          <ul className="space-y-1 text-orange-900 dark:text-orange-200/95">
            {staleForLastSession.map((s, i) => (
              <li key={i}>
                <span className="font-mono font-medium">{s.registration}</span>
                {' — '}
                {s.type === 'long_queue' && `Long queue (${s.hours} h): ${s.status}`}
                {s.type === 'long_transit' && `Long en-route (${s.hours} h): ${s.status}`}
                {s.type === 'hours_climbing' && `Hours rose ${s.hoursPrev} → ${s.hoursCurr} while still active: ${s.status}`}
                {s.type === 'same_phase_longer' && `Still ${s.phase} with higher hours (${s.hoursPrev} → ${s.hoursCurr})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {lastParse && lastParse.rows.length > 0 && (
        <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 overflow-hidden shadow-sm dark:shadow-none">
          <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/60 flex flex-wrap justify-between gap-2">
            <h3 className="font-semibold text-surface-900 dark:text-surface-100">Step 2 — Latest paste: confirm deliveries</h3>
            <span className="text-xs text-surface-500 dark:text-surface-400">
              Pasted route key: {lastParse.rows.find((x) => x.route)?.route ? normalizeRouteKey(lastParse.rows.find((x) => x.route).route) : '—'}
              {!settings.routeId && autoRouteIdFromPaste && (
                <span className="ml-2 text-amber-700 dark:text-amber-400">(you can apply suggested route above)</span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-50 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Registration</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">System</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Phase</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Tons</th>
                  <th className="text-right px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Hours</th>
                  <th className="text-left px-3 py-2 font-medium text-surface-700 dark:text-surface-200">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {lastParse.rows.map((r, i) => {
                  const rowId = r.rowId || `tmp:${i}`;
                  const enr = enrollmentLabel(r.registration);
                  const phase = classifyStatus(r.status);
                  const hot = staleRegSet.has(normalizeRegistration(r.registration));
                  return (
                    <tr
                      key={rowId}
                      className={`border-t border-surface-100 dark:border-surface-800 ${hot ? 'bg-orange-50/60 dark:bg-orange-950/35' : 'hover:bg-surface-50/80 dark:hover:bg-surface-800/50'}`}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-surface-900 dark:text-surface-100">
                        {r.registration}
                        {hot && <span className="ml-1 text-orange-700 dark:text-orange-400 text-xs" title="Queue / transit / hours flag">⚠</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded border ${badgeEnrollment(enr.kind)}`}>
                          {enr.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-surface-600 dark:text-surface-400 capitalize">{phase.replace('_', ' ')}</td>
                      <td className="px-3 py-2 text-surface-700 dark:text-surface-300 max-w-[220px] truncate" title={r.status}>{r.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.tons.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.hours.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(['pending', 'completed', 'not_completed']).map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setConfirmation(rowId, v)}
                              className={`text-xs px-2 py-1 rounded font-medium ${
                                (confirmations[rowId] || 'pending') === v ? badgeConfirmation(v) : 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                              }`}
                            >
                              {v === 'not_completed' ? 'Not done' : v === 'completed' ? 'Done' : 'Unset'}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">Filter trends by registration</label>
          <input
            type="text"
            value={filterReg}
            onChange={(e) => setFilterReg(e.target.value)}
            placeholder="e.g. KFD971"
            className="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 px-3 py-2 text-sm uppercase"
          />
        </div>
      </div>

      {flatRows.length === 0 && (
        <p className="text-sm text-surface-500 dark:text-surface-400 rounded-xl border border-dashed border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/40 px-4 py-3">
          No saved records yet. Paste an update and use “Parse &amp; add to analysis” to build comparisons and trends.
        </p>
      )}

      {confirmationSummary.tracked > 0 && (
        <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-4 shadow-sm dark:shadow-none text-sm">
          <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-2">Delivery confirmations (saved rows)</h3>
          <p className="text-surface-600 dark:text-surface-300">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{confirmationSummary.completed}</span> marked done ·{' '}
            <span className="text-red-700 dark:text-red-400 font-medium">{confirmationSummary.notCompleted}</span> not done ·{' '}
            <span className="text-surface-500 dark:text-surface-500">{confirmationSummary.unset}</span> unset — tied to each paste row for follow-up.
          </p>
        </section>
      )}

      {trends.summary.rowCount > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-4 shadow-sm dark:shadow-none">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Records (filtered)</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-50 mt-1">{trends.summary.rowCount}</p>
            </div>
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-4 shadow-sm dark:shadow-none">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Unique trucks</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-50 mt-1">{trends.summary.uniqueTrucks}</p>
            </div>
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-4 shadow-sm dark:shadow-none">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Total tons</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-50 mt-1">{trends.summary.totalTons.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-4 shadow-sm dark:shadow-none">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Avg tons / row</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-surface-50 mt-1">{trends.summary.avgTonsPerRow.toFixed(2)}</p>
            </div>
          </div>

          {trendsByDateCapped.length > 0 && (
            <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-6 shadow-sm dark:shadow-none">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-4">Tons by report date (recent)</h3>
              <div className="flex items-end gap-1 h-48 overflow-x-auto pb-6">
                {trendsByDateCapped.map((d) => (
                  <div key={d.date} className="flex flex-col items-center gap-1 min-w-[36px]" title={`${d.date}: ${d.totalTons.toFixed(2)} t`}>
                    <div className="w-full flex flex-col justify-end flex-1 min-h-[4px] min-w-[28px]">
                      <div
                        className="w-full bg-brand-600 rounded-t transition-all"
                        style={{ height: `${Math.max(4, (d.totalTons / maxDateTons) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-surface-500 dark:text-surface-400 whitespace-nowrap">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {trends.byTruck.length > 0 && (
            <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-6 shadow-sm dark:shadow-none">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-4">Total tons by truck (top 12)</h3>
              <div className="space-y-2">
                {trends.byTruck.slice(0, 12).map((t) => (
                  <div key={t.registration} className="flex items-center gap-3">
                    <div className="w-40 shrink-0">
                      <span className="text-sm font-mono font-medium text-surface-800 dark:text-surface-100 block">{t.registration}</span>
                      {t.entity ? (
                        <span className="text-xs text-surface-500 dark:text-surface-400 block truncate" title={t.entity}>
                          {t.entity}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex-1 h-6 bg-surface-100 dark:bg-surface-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-brand-500 dark:bg-brand-500 rounded"
                        style={{ width: `${Math.max(5, (t.totalTons / maxTonsBar) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm text-surface-600 dark:text-surface-300 w-40 text-right shrink-0">
                      {t.totalTons.toFixed(2)} t · {t.count}× · avg {t.avgTons.toFixed(2)} t
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {trends.byRoute.length > 0 && (
            <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-6 shadow-sm dark:shadow-none">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-4">By route (from pasted text)</h3>
              <ul className="space-y-2 text-sm">
                {trends.byRoute.slice(0, 15).map((r) => (
                  <li key={r.route} className="flex justify-between gap-4 border-b border-surface-100 dark:border-surface-800 pb-2">
                    <span className="text-surface-800 dark:text-surface-200 truncate" title={r.route}>{r.route}</span>
                    <span className="text-surface-600 dark:text-surface-400 shrink-0">{r.totalTons.toFixed(2)} t · {r.count} lines</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {trends.statusTop.length > 0 && (
            <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 p-6 shadow-sm dark:shadow-none">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-4">Status frequency</h3>
              <ul className="space-y-2 text-sm">
                {trends.statusTop.map((s, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-surface-700 dark:text-surface-300 truncate" title={s.status}>{s.status}</span>
                    <span className="text-surface-500 dark:text-surface-500 shrink-0">{s.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/85 overflow-hidden shadow-sm dark:shadow-none">
            <div className="px-6 py-4 border-b border-surface-100 dark:border-surface-800 bg-gradient-to-r from-surface-50 to-brand-50 dark:from-surface-900 dark:to-brand-950/40">
              <h3 className="font-semibold text-surface-900 dark:text-surface-100">Insights</h3>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">Trends, cross-paste diffs, and time-in-phase heuristics (rule-based).</p>
            </div>
            <div className="p-6 space-y-3">
              {mergedInsights.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-xl p-4 text-sm ${
                    item.type === 'positive'
                      ? 'bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-800 text-green-900 dark:text-green-100'
                      : item.type === 'attention'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800 text-amber-900 dark:text-amber-100'
                        : 'bg-surface-50 dark:bg-surface-800/80 border border-surface-100 dark:border-surface-700 text-surface-800 dark:text-surface-200'
                  }`}
                >
                  <span className="shrink-0 mt-0.5">
                    {item.type === 'positive' ? '✓' : item.type === 'attention' ? '!' : '●'}
                  </span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
        </>
      )}
        </div>
      )}

      {truckRecordsView === 'summaries' && (
        <section
          className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 p-4 sm:p-6 shadow-sm space-y-3"
          role="tabpanel"
          id="truck-records-panel-summaries"
          aria-labelledby="truck-records-tab-summaries"
        >
          <h3 className="font-semibold text-surface-900 dark:text-surface-100">Completed shift summaries</h3>
          <p className="text-sm text-surface-600 dark:text-surface-400">Stored in this browser only (most recent first).</p>
          {archives.length === 0 ? (
            <p className="text-sm text-surface-500 rounded-xl border border-dashed border-surface-200 dark:border-surface-600 bg-white/50 dark:bg-surface-950/30 px-4 py-6 text-center max-w-xl">
              No completed shifts archived yet. When you finish a shift from the Analysis tab, a summary is saved here.
            </p>
          ) : (
          <ul className="space-y-3 text-sm">
            {archives.map((a) => (
              <li key={a.id} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900/80 p-4">
                {a.referenceCode && (
                  <p className="font-mono text-sm font-semibold text-brand-800 dark:text-brand-300 mb-1">Ref: {a.referenceCode}</p>
                )}
                <p className="font-medium text-surface-900 dark:text-surface-100">{a.routeName || a.routeId || 'Route'}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                  From {a.shiftStart ? new Date(a.shiftStart).toLocaleString() : '—'}
                  {a.shiftEnd ? ` — ${new Date(a.shiftEnd).toLocaleString()}` : ''}
                  {' · '}
                  Controllers: {Array.isArray(a.controllerNames) ? a.controllerNames.join(', ') : '—'}
                </p>
                <div className="mt-3 rounded-lg border border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 px-3 py-2 space-y-1">
                  <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">Delivery outcomes (trucks)</p>
                  <p className="text-sm text-surface-800 dark:text-surface-200">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {a.summary?.trucksCompletedDelivery ?? a.summary?.droppedCompleted ?? 0}
                    </span>
                    {' '}delivery completed
                    <span className="text-surface-400 mx-2">·</span>
                    <span className="text-red-700 dark:text-red-400 font-medium">
                      {a.summary?.trucksNotDone ??
                        (a.summary?.droppedNotDone ?? 0) + (a.summary?.droppedPending ?? 0)}
                    </span>
                    {' '}not done (never marked completed)
                    {(a.summary?.trucksOutcomePending ?? 0) > 0 && (
                      <span className="text-surface-600">
                        <span className="text-surface-400 mx-2">·</span>
                        {a.summary.trucksOutcomePending} still unset
                      </span>
                    )}
                  </p>
                </div>
                <p className="text-surface-600 dark:text-surface-400 mt-2 text-sm">
                  {a.summary?.pasteCount ?? 0} paste(s) · {a.summary?.uniqueTrucks ?? 0} trucks in data ·{' '}
                  {(a.summary?.totalTons ?? 0).toFixed(2)} t
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-500 mt-1">
                  Archived {a.completedAt ? new Date(a.completedAt).toLocaleString() : '—'}
                </p>
              </li>
            ))}
          </ul>
          )}
        </section>
      )}
    </div>
  );
}
