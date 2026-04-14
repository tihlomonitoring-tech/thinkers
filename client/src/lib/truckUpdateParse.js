/**
 * Parse pasted fleet update / allocation text (e.g. WhatsApp-style reports).
 * Strips **markdown** bold; walks line-by-line for date, route, and truck rows.
 * Extra narrative or new-format lines are kept as comments when truck rows parse.
 */

import { normalizeRegistration } from './truckUpdateInsights.js';
import { registrationKeyForLookup } from './rawExportToFleetUpdate.js';

const MAX_COMMENT_LINE_LEN = 400;
const MAX_COMMENT_LINES_STORED = 120;

function entityFromEnrollmentMap(regRaw, entityMap) {
  if (!entityMap || !(entityMap instanceof Map)) return '';
  const n = normalizeRegistration(regRaw);
  const k = registrationKeyForLookup(regRaw);
  return String(entityMap.get(n) || entityMap.get(k) || '').trim();
}

const TRUCK_LINE =
  /^([A-Z0-9]+)\s*-\s*\(([^)]*)\)\s*-\s*(.+?)\s*-\s*Tons:\s*([\d.]+)\s*-\s*Hours:\s*([\d.]+)\s*$/i;

function stripBold(s) {
  return String(s || '').replace(/\*\*/g, '').trim();
}

/** Match fleet lines that use en-dash / em-dash instead of hyphen between segments. */
function normalizeFleetDashDelimiters(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-');
}

/** Parse a single truck line after bold stripped. */
export function parseTruckDataLine(line, lineNumber = 0) {
  const clean = normalizeFleetDashDelimiters(stripBold(line));
  const m = clean.match(TRUCK_LINE);
  if (m) {
    return {
      lineNumber,
      registration: m[1].toUpperCase(),
      entity: m[2].trim(),
      status: m[3].trim(),
      tons: parseFloat(m[4]),
      hours: parseFloat(m[5]),
    };
  }
  if (!/Tons:/i.test(clean) || !/Hours:/i.test(clean)) return null;
  const tonsM = clean.match(/Tons:\s*([\d.]+)/i);
  const hoursM = clean.match(/Hours:\s*([\d.]+)/i);
  if (!tonsM || !hoursM) return null;
  const idx = clean.indexOf('Tons:');
  const before = clean.slice(0, idx).trim().replace(/\s+-\s*$/, '');
  const parts = before.split(/\s*-\s*/).map((p) => p.trim());
  const registration = (parts[0] || '').replace(/\s/g, '').toUpperCase();
  if (!registration || !/^[A-Z0-9]{4,20}$/.test(registration)) return null;
  let entity = '';
  let status = '';
  if (parts[1] && /^\([^)]*\)$/.test(parts[1])) {
    entity = parts[1].replace(/^\(|\)$/g, '').trim();
    status = parts.slice(2).join(' - ').trim();
  } else {
    status = parts.slice(1).join(' - ').trim();
  }
  return {
    lineNumber,
    registration,
    entity,
    status,
    tons: parseFloat(tonsM[1]),
    hours: parseFloat(hoursM[1]),
  };
}

function isLikelyCommentLine(trimmed) {
  if (trimmed.length < 2) return false;
  if (/^[-_=•*.\s]+$/u.test(trimmed)) return false;
  return true;
}

/**
 * @param {string} text
 * @returns {{ rows: Array<{registration,entity,status,tons,hours,date,route,lineNumber}>, warnings: Array<{line:number,text:string}>, comments: Array<{line:number,text:string}> }}
 */
export function parseFleetUpdateText(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = rawLines.map((l) => stripBold(l));
  let currentDate = null;
  let currentRoute = null;
  const rows = [];
  const warnings = [];
  const comments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/^\*?FLEET\s+UPDATE/i.test(line.trim())) continue;

    if (/^day:\s*/i.test(line)) continue;

    const dayOnly = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(line);
    if (dayOnly) continue;

    const isoOnly = line.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (isoOnly) {
      currentDate = isoOnly[1];
      continue;
    }

    const datePref = line.match(/^date:\s*(\d{4}-\d{2}-\d{2})/i);
    if (datePref) {
      currentDate = datePref[1];
      continue;
    }

    const hasArrow = /→|->|=>/.test(line);
    const hasMetrics = /Tons:/i.test(line) && /Hours:/i.test(line);
    if (hasArrow && !hasMetrics) {
      currentRoute = line.replace(/\s+/g, ' ').trim();
      continue;
    }

    if (hasMetrics) {
      const row = parseTruckDataLine(rawLines[i], i + 1);
      if (row && !Number.isNaN(row.tons) && !Number.isNaN(row.hours)) {
        rows.push({
          ...row,
          date: currentDate,
          route: currentRoute,
        });
      } else {
        warnings.push({ line: i + 1, text: line.slice(0, MAX_COMMENT_LINE_LEN) });
      }
      continue;
    }

    if (isLikelyCommentLine(line.trim())) {
      if (comments.length < MAX_COMMENT_LINES_STORED) {
        comments.push({ line: i + 1, text: line.slice(0, MAX_COMMENT_LINE_LEN) });
      }
    }
  }

  return { rows, warnings, comments };
}

export const TRUCK_UPDATE_HISTORY_KEY = 'cc_truck_update_history_v1';
/** Stored pastes (capped to keep localStorage small). */
const MAX_SESSIONS_STORED = 60;
/** Only the last N pastes are used for charts / cross-paste math so the page stays responsive with many pastes. */
export const MAX_SESSIONS_FOR_ANALYSIS = 48;
/** Hard cap on flattened rows for aggregation (very large pastes). */
export const MAX_FLAT_ROWS = 3000;

/** @param {Array} sessions */
export function sliceSessionsForAnalysis(sessions) {
  const s = sessions || [];
  if (s.length <= MAX_SESSIONS_FOR_ANALYSIS) return s;
  return s.slice(-MAX_SESSIONS_FOR_ANALYSIS);
}

function migrateSessions(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((s, si) => {
    const id = s.id || `legacy-${s.savedAt || si}`;
    const rows = (s.rows || []).map((r, ri) => ({
      ...r,
      rowId: r.rowId || `${id}:${ri}`,
    }));
    return { ...s, id, rows };
  });
}

export function loadTruckUpdateHistory() {
  try {
    const raw = localStorage.getItem(TRUCK_UPDATE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return migrateSessions(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function saveTruckUpdateHistory(sessions) {
  try {
    localStorage.setItem(TRUCK_UPDATE_HISTORY_KEY, JSON.stringify(sessions.slice(-MAX_SESSIONS_STORED)));
  } catch (_) {}
}

/**
 * Append one paste session. Returns the new full history array (avoids a second full reload parse).
 */
export function appendTruckUpdateSession(session) {
  const prev = loadTruckUpdateHistory();
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}`;
  const rows = (session.rows || []).map((r, i) => ({
    ...r,
    rowId: `${id}:${i}`,
  }));
  const next = [
    ...prev,
    {
      ...session,
      id,
      rows,
      shiftId: session.shiftId ?? null,
      comments: Array.isArray(session.comments) ? session.comments.slice(0, MAX_COMMENT_LINES_STORED) : [],
    },
  ];
  saveTruckUpdateHistory(next);
  return next;
}

export const TRUCK_UPDATE_SHIFT_KEY = 'cc_truck_update_shift_v1';
export const TRUCK_UPDATE_SHIFT_ARCHIVES_KEY = 'cc_truck_update_shift_archives_v1';
export const MAX_SHIFT_ARCHIVES = 24;

/** @param {string} text */
export function parseControllerNamesInput(text) {
  return String(text || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {Array<{ savedAt: string }>} sessions
 * @param {string} shiftStart ISO
 * @param {string|null|undefined} shiftEnd ISO — if omitted or invalid, only lower bound (open-ended shift)
 */
export function filterSessionsInShiftPeriod(sessions, shiftStart, shiftEnd) {
  const t0 = new Date(shiftStart).getTime();
  if (Number.isNaN(t0)) return [];
  const t1 = shiftEnd ? new Date(shiftEnd).getTime() : null;
  if (shiftEnd && Number.isNaN(t1)) return [];
  return (sessions || []).filter((s) => {
    const t = new Date(s.savedAt).getTime();
    if (Number.isNaN(t)) return false;
    if (t < t0) return false;
    if (t1 != null && t > t1) return false;
    return true;
  });
}

/** @returns {{ id: string, controllerNames: string[], controllerUserIds?: string[], shiftStart: string, shiftEnd?: string|null, routeId: string } | null} */
export function loadShiftRecord() {
  try {
    const raw = localStorage.getItem(TRUCK_UPDATE_SHIFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.id || !d.shiftStart) return null;
    return {
      id: d.id,
      controllerNames: Array.isArray(d.controllerNames) ? d.controllerNames : [],
      controllerUserIds: Array.isArray(d.controllerUserIds) ? d.controllerUserIds : [],
      shiftStart: d.shiftStart,
      shiftEnd: d.shiftEnd || null,
      routeId: typeof d.routeId === 'string' ? d.routeId : '',
    };
  } catch {
    return null;
  }
}

/** @param {{ id: string, controllerNames: string[], controllerUserIds?: string[], shiftStart: string, shiftEnd?: string|null, routeId: string } | null} rec */
export function saveShiftRecord(rec) {
  try {
    if (!rec) {
      localStorage.removeItem(TRUCK_UPDATE_SHIFT_KEY);
      return;
    }
    localStorage.setItem(TRUCK_UPDATE_SHIFT_KEY, JSON.stringify(rec));
  } catch (_) {}
}

export function loadShiftArchives() {
  try {
    const raw = localStorage.getItem(TRUCK_UPDATE_SHIFT_ARCHIVES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {object} entry */
export function appendShiftArchive(entry) {
  try {
    const prev = loadShiftArchives();
    const next = [entry, ...prev].slice(0, MAX_SHIFT_ARCHIVES);
    localStorage.setItem(TRUCK_UPDATE_SHIFT_ARCHIVES_KEY, JSON.stringify(next));
  } catch (_) {}
}

export function saveShiftArchivesList(list) {
  try {
    localStorage.setItem(TRUCK_UPDATE_SHIFT_ARCHIVES_KEY, JSON.stringify((list || []).slice(0, MAX_SHIFT_ARCHIVES)));
  } catch (_) {}
}

/** Full workspace for server sync / resume. */
export function buildWorkspacePayload() {
  return {
    history: loadTruckUpdateHistory(),
    confirmations: loadDeliveryConfirmations(),
    settings: loadTruckUpdateSettings(),
    shiftRecord: loadShiftRecord(),
    shiftArchives: loadShiftArchives(),
  };
}

/** Apply server payload into localStorage (then reload state in UI). */
export function applyWorkspaceFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (Array.isArray(payload.history)) saveTruckUpdateHistory(payload.history);
  if (payload.confirmations && typeof payload.confirmations === 'object') {
    saveDeliveryConfirmations(payload.confirmations);
  }
  if (payload.settings && typeof payload.settings === 'object') {
    saveTruckUpdateSettings(payload.settings);
  }
  if (payload.shiftRecord === null || payload.shiftRecord === undefined) {
    saveShiftRecord(null);
  } else if (typeof payload.shiftRecord === 'object' && payload.shiftRecord.id && payload.shiftRecord.shiftStart) {
    saveShiftRecord({
      id: payload.shiftRecord.id,
      controllerNames: Array.isArray(payload.shiftRecord.controllerNames) ? payload.shiftRecord.controllerNames : [],
      controllerUserIds: Array.isArray(payload.shiftRecord.controllerUserIds) ? payload.shiftRecord.controllerUserIds : [],
      shiftStart: payload.shiftRecord.shiftStart,
      shiftEnd: payload.shiftRecord.shiftEnd || null,
      routeId: typeof payload.shiftRecord.routeId === 'string' ? payload.shiftRecord.routeId : '',
    });
  }
  if (Array.isArray(payload.shiftArchives)) saveShiftArchivesList(payload.shiftArchives);
}

/** Clears paste history + confirmations and removes the active shift record (after archiving). */
export function completeShiftAndClearWorkingData() {
  clearTruckUpdateHistory();
  saveShiftRecord(null);
}

const CONFIRMATIONS_KEY = 'cc_truck_update_confirmations_v1';
const SETTINGS_KEY = 'cc_truck_update_settings_v1';

export function loadDeliveryConfirmations() {
  try {
    const raw = localStorage.getItem(CONFIRMATIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDeliveryConfirmations(map) {
  try {
    localStorage.setItem(CONFIRMATIONS_KEY, JSON.stringify(map));
  } catch (_) {}
}

export function loadTruckUpdateSettings() {
  try {
    const d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      compareWindowHours: Math.min(48, Math.max(2, Number(d.compareWindowHours) || 6)),
      longQueueHours: Math.min(24, Math.max(1, Number(d.longQueueHours) || 3)),
      longTransitHours: Math.min(24, Math.max(1, Number(d.longTransitHours) || 5)),
      longHoursOnSite: Math.min(48, Math.max(2, Number(d.longHoursOnSite) || 8)),
      routeId: typeof d.routeId === 'string' ? d.routeId : '',
    };
  } catch {
    return {
      compareWindowHours: 6,
      longQueueHours: 3,
      longTransitHours: 5,
      longHoursOnSite: 8,
      routeId: '',
    };
  }
}

export function saveTruckUpdateSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (_) {}
}

export function clearTruckUpdateHistory() {
  try {
    localStorage.removeItem(TRUCK_UPDATE_HISTORY_KEY);
    localStorage.removeItem(CONFIRMATIONS_KEY);
  } catch (_) {}
}

/**
 * Flatten sessions into rows (caller should pass sliceSessionsForAnalysis(history) for large histories).
 * Caps row count for safety.
 * @param {Array<{ savedAt: string, rows: object[] }>} sessions
 */
export function flattenHistoryRows(sessions) {
  const out = [];
  for (const s of sessions || []) {
    const savedAt = s.savedAt || '';
    for (const r of s.rows || []) {
      out.push({ ...r, savedAt });
      if (out.length >= MAX_FLAT_ROWS) return out;
    }
  }
  return out;
}

/** Flatten all sessions for confirmation counts (bounded by stored session cap). */
export function flattenHistoryRowsAll(sessions) {
  const out = [];
  for (const s of sessions || []) {
    const savedAt = s.savedAt || '';
    for (const r of s.rows || []) {
      out.push({ ...r, savedAt });
      if (out.length >= MAX_FLAT_ROWS) return out;
    }
  }
  return out;
}

/**
 * @param {Array<object>} rows — flattened rows with optional date, route, savedAt
 * @param {{ entityMap?: Map<string, string> }} [opts] — reg keys → contractor company (from route enrollment / fleet); overrides pasted parentheses when present
 */
export function buildTrendAggregates(rows, opts = {}) {
  const { entityMap } = opts;
  const list = rows || [];
  const byTruck = new Map();
  const byRoute = new Map();
  const byDate = new Map();
  const statusCount = new Map();

  for (const r of list) {
    const reg = r.registration || '—';
    const route = r.route || '—';
    const date = r.date || (r.savedAt ? r.savedAt.slice(0, 10) : '—');
    const tons = Number(r.tons) || 0;
    const hours = Number(r.hours) || 0;
    const st = r.status || '—';
    const fleetEntity = entityFromEnrollmentMap(r.registration, entityMap);

    if (!byTruck.has(reg)) {
      const initialEntity = fleetEntity || String(r.entity || '').trim();
      byTruck.set(reg, { registration: reg, entity: initialEntity, count: 0, totalTons: 0, totalHours: 0, statuses: [] });
    }
    const t = byTruck.get(reg);
    t.count += 1;
    t.totalTons += tons;
    t.totalHours += hours;
    t.statuses.push({ status: st, tons, hours, date, route });
    if (fleetEntity) t.entity = fleetEntity;
    else if (r.entity && !t.entity) t.entity = r.entity;

    if (!byRoute.has(route)) byRoute.set(route, { route, count: 0, totalTons: 0 });
    const br = byRoute.get(route);
    br.count += 1;
    br.totalTons += tons;

    if (!byDate.has(date)) byDate.set(date, { date, count: 0, totalTons: 0 });
    const bd = byDate.get(date);
    bd.count += 1;
    bd.totalTons += tons;

    statusCount.set(st, (statusCount.get(st) || 0) + 1);
  }

  const truckArr = [...byTruck.values()].map((x) => ({
    ...x,
    avgTons: x.count ? x.totalTons / x.count : 0,
    avgHours: x.count ? x.totalHours / x.count : 0,
  }));
  truckArr.sort((a, b) => b.totalTons - a.totalTons);

  const routeArr = [...byRoute.values()].sort((a, b) => b.totalTons - a.totalTons);
  const dateArr = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const insights = [];
  const totalTons = list.reduce((s, r) => s + (Number(r.tons) || 0), 0);
  const totalHours = list.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  if (list.length === 0) {
    insights.push({ type: 'neutral', text: 'Paste a fleet update and click Parse to see trends. History is stored in this browser only.' });
  } else {
    insights.push({
      type: 'neutral',
      text: `${list.length} truck line(s) in history · ${truckArr.length} unique registration(s) · ${totalTons.toFixed(2)} total tons · ${totalHours.toFixed(2)} total hours.`,
    });
    const top = truckArr[0];
    if (top && top.count >= 2 && top.statuses.length >= 2) {
      const chronological = [...top.statuses].sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        return da.localeCompare(db);
      });
      const first = chronological[0].tons;
      const last = chronological[chronological.length - 1].tons;
      if (last < first * 0.85) {
        insights.push({
          type: 'attention',
          text: `${top.registration}: last recorded tons (${last.toFixed(2)}) are noticeably lower than the earliest (${first.toFixed(2)}) in your history — worth reviewing loads or reporting gaps.`,
        });
      }
    }
    const dominantStatus = [...statusCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominantStatus && dominantStatus[1] >= 3) {
      insights.push({
        type: 'positive',
        text: `Most common status: “${dominantStatus[0].slice(0, 80)}${dominantStatus[0].length > 80 ? '…' : ''}” (${dominantStatus[1]} times).`,
      });
    }
  }

  return {
    summary: {
      rowCount: list.length,
      uniqueTrucks: truckArr.length,
      totalTons,
      totalHours,
      avgTonsPerRow: list.length ? totalTons / list.length : 0,
      avgHoursPerRow: list.length ? totalHours / list.length : 0,
    },
    byTruck: truckArr,
    byRoute: routeArr,
    byDate: dateArr,
    statusTop: [...statusCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([status, count]) => ({ status, count })),
    insights,
  };
}
