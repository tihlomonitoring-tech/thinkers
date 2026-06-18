import { classifyStatus, normalizeRegistration } from './truckUpdateInsights.js';

/** Canonical key for matching paste ↔ fleet (spaces stripped, hyphens/underscores removed, uppercased). */
export function registrationKeyForLookup(reg) {
  return normalizeRegistration(reg).replace(/[-_/]/g, '');
}

/** Normalize a pasted line: unicode dashes, tabs, collapsed spaces, compatibility chars. */
function normalizeRawExportLine(line) {
  return String(line || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdownBold(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

/** WhatsApp single-asterisk bold. */
function wrapWhatsAppBold(inner) {
  const s = stripMarkdownBold(inner);
  return s ? `*${s}*` : '';
}

/** WhatsApp underscore italic (strip markers that would break formatting). */
function wrapWhatsAppItalic(inner) {
  const s = String(inner || '')
    .replace(/_/g, ' ')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? `_${s}_` : '';
}

/**
 * Registration at start of export lines: optional spaces/hyphens inside the plate (e.g. DK16 PTZN → DK16PTZN).
 * Spaced form must be tried before a plain contiguous run, or "DK16 PTZN" would match only "DK16".
 */
const REGISTRATION_FIRST_SEGMENT =
  '((?:[A-Za-z0-9](?:[A-Za-z0-9\\s\\-]{0,22}[A-Za-z0-9])|[A-Za-z0-9]{2,24}))';

function normalizeRegistrationFromExportSegment(seg) {
  return String(seg || '')
    .replace(/[\s\-_/]/g, '')
    .toUpperCase();
}

/** SQL Server / JSON may use different casings for column names. */
function pickRow(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (k && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
  }
  const first = keys[0];
  if (!first) return null;
  const lower = first.toLowerCase().replace(/_/g, '');
  for (const [key, val] of Object.entries(row)) {
    if (
      key &&
      key.toLowerCase().replace(/_/g, '') === lower &&
      val !== undefined &&
      val !== null &&
      String(val).trim() !== ''
    ) {
      return val;
    }
  }
  return null;
}

function labelFromTruckRow(t) {
  if (!t) return '';
  const co = String(
    pickRow(t, 'contractor_company_name', 'contractorCompanyName', 'contractor_name', 'company_name') || ''
  ).trim();
  if (co) return co;
  const main = String(pickRow(t, 'main_contractor', 'mainContractor', 'Main_Contractor') || '').trim();
  const sub = String(pickRow(t, 'sub_contractor', 'subContractor', 'Sub_Contractor') || '').trim();
  return main || sub || '';
}

/**
 * Right-hand side of route name for status text ("Offloading at …", "Enroute to …").
 * @param {string} routeName e.g. "NTSHOVELO -> KELVIN PS"
 * @returns {string}
 */
export function destinationFromRouteName(routeName) {
  const s = String(routeName || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\*/g, '')
    .trim();
  const parts = s.split(/\s*(?:→|->|=>)\s*/i);
  if (parts.length >= 2) {
    return parts[parts.length - 1]
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const toSplit = s.split(/\s+To\s+/i);
  if (toSplit.length >= 2) {
    return toSplit[toSplit.length - 1]
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return s || 'destination';
}

/** Left-hand side of route name (colliery / load-out). */
export function originFromRouteName(routeName) {
  const s = String(routeName || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\*/g, '')
    .trim();
  const parts = s.split(/\s*(?:→|->|=>)\s*/i);
  if (parts.length >= 2) {
    return parts[0]
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const toSplit = s.split(/\s+To\s+/i);
  if (toSplit.length >= 2) {
    return toSplit[0]
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function shortOriginLabel(fullOrigin) {
  let s = String(fullOrigin || '').trim();
  if (!s) return 'origin';
  const terminal = hyphenRouteTerminalSite(s);
  if (terminal) s = terminal;
  const words = s.split(/\s+/);
  if (words.length <= 2) {
    return words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }
  return words[0].charAt(0) + words[0].slice(1).toLowerCase();
}

export function resolveRouteOriginShort(routeLabel) {
  if (!routeLabel) return 'origin';
  return shortOriginLabel(originFromRouteName(routeLabel)) || 'origin';
}

function normalizeSiteToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bpower\s+station\b/g, ' ps')
    .replace(/\s*\([do]\)\s*/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function siteNamesMatch(a, b) {
  const na = normalizeSiteToken(a);
  const nb = normalizeSiteToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = na.split(' ').filter((w) => w.length >= 3);
  const wb = nb.split(' ').filter((w) => w.length >= 3);
  return wa.some((x) => wb.some((y) => x === y || x.includes(y) || y.includes(x)));
}

function extractAtLocation(statusText) {
  const plain = stripMarkdownBold(statusText);
  const m = plain.match(/\bat\s+(.+?)(?:\s*\([DO]\)\s*)?$/i);
  return m ? m[1].trim() : null;
}

const ORIGIN_SITE_HINTS = /ntshovelo|manungu|colliery|mine|load\s*out|tip\s*bin|stockpile|pit/i;

function isOriginSiteName(name, originLabel, destLabel) {
  if (!name) return false;
  if (siteNamesMatch(name, originLabel)) return true;
  if (destLabel && siteNamesMatch(name, destLabel)) return false;
  return ORIGIN_SITE_HINTS.test(String(name));
}

/**
 * Routes saved as "Khashani–kriel" or "Origin - Site": use the segment after the last hyphen
 * as the operational site name (e.g. Queuing at Kriel).
 */
function hyphenRouteTerminalSite(fragment) {
  const raw = String(fragment || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .trim();
  if (!raw) return null;
  const parts = raw.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  if (!last || last.length < 2) return null;
  if (!/^[A-Za-z][A-Za-z0-9\s]{0,60}$/.test(last)) return null;
  return last;
}

/** Human-friendly site label for status lines (prefer first word before POWER STATION, etc.). */
export function shortDestinationLabel(fullDest) {
  let s = String(fullDest || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const terminal = hyphenRouteTerminalSite(s);
  if (terminal) {
    s = terminal;
  }
  const words = s.split(/\s+/);
  const u = s.toUpperCase();
  if (/\bPOWER\s+STATION\b/.test(u) || /\bPS\b$/.test(u)) {
    const w0 = words[0] || s;
    return w0.charAt(0) + w0.slice(1).toLowerCase();
  }
  if (words.length <= 3) {
    return words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * @param {Array<object>} routeTrucks from GET /contractor/routes/:id (enrolled on route)
 * @param {Array<object>} [fleetTrucks] optional full fleet from GET /contractor/trucks — used when route row has no label (lookup by truck_id)
 * @returns {Map<string, string>} normalized reg -> display company (contractor record first, then main/sub free text)
 */
export function buildRegistrationEntityMap(routeTrucks, fleetTrucks) {
  const fleetById = new Map();
  const fleetByReg = new Map();
  for (const ft of fleetTrucks || []) {
    const id = pickRow(ft, 'id', 'Id');
    if (id != null && id !== '') fleetById.set(String(id), ft);
    const rawReg = pickRow(ft, 'registration', 'Registration');
    const fr = registrationKeyForLookup(rawReg);
    if (fr && !fleetByReg.has(fr)) fleetByReg.set(fr, ft);
  }
  const map = new Map();
  function putKeys(regStr, label) {
    if (!label) return;
    const n = normalizeRegistration(regStr);
    const k = registrationKeyForLookup(regStr);
    if (n) map.set(n, label);
    if (k && k !== n) map.set(k, label);
  }
  for (const t of routeTrucks || []) {
    const rawReg = pickRow(t, 'registration', 'Registration');
    const reg = normalizeRegistration(rawReg);
    const regKey = registrationKeyForLookup(rawReg);
    if (!regKey) continue;
    let label = labelFromTruckRow(t);
    if (!label) {
      const tid = pickRow(t, 'truck_id', 'truckId');
      if (tid != null && fleetById.has(String(tid))) {
        label = labelFromTruckRow(fleetById.get(String(tid)));
      }
    }
    if (!label && fleetByReg.has(regKey)) {
      label = labelFromTruckRow(fleetByReg.get(regKey));
    }
    if (label) putKeys(rawReg || reg, label);
  }
  return map;
}

/**
 * Match export-schedule style lines:
 * REG - STATUS - (COMPANY) - Hours: h - Weight|tons: w [- DRIVER]
 * Also: Weight/Tons before Hours (some exports reverse these).
 */
export function parseRawExportTruckLine(line) {
  const clean = stripMarkdownBold(normalizeRawExportLine(line));
  if (!clean || /^\*?FLEET\s+UPDATE/i.test(clean.trim())) return null;
  if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(clean)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(clean)) return null;
  if ((/→|->|=>/.test(clean) || /\*.*\*/.test(clean)) && !/Hours:\s*[\d.]+/i.test(clean) && !/(?:Weight|Tons|Load):\s*[\d.]+/i.test(clean)) {
    return null;
  }

  /** WhatsApp / fleet screenshot: REG - (Co) - Status at Site - Tons: x - Hours: y */
  const reFleetTonsFirst = new RegExp(
    `^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*\\(([^)]*)\\)\\s*-\\s*(.+?)\\s*-\\s*Tons:\\s*([\\d.]+)\\s*-\\s*Hours:\\s*([\\d.]+)\\s*$`,
    'i'
  );
  const fm = clean.match(reFleetTonsFirst);
  if (fm) {
    const registration = normalizeRegistrationFromExportSegment(fm[1]);
    const contractorFromPaste = fm[2].trim();
    const rawStatus = fm[3].trim();
    const tons = parseFloat(fm[4]);
    const hours = parseFloat(fm[5]);
    if (!Number.isNaN(hours) && !Number.isNaN(tons) && /^[A-Z0-9]{3,26}$/.test(registration)) {
      return { registration, rawStatus, contractorFromPaste, hours, tons, driverName: '' };
    }
  }

  const reHoursFirst = new RegExp(
    `^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*(.+?)\\s*-\\s*\\(([^)]*)\\)\\s*-\\s*Hours:\\s*([\\d.]+)\\s*-\\s*(?:Weight|Tons|Load):\\s*([\\d.]+)(?:\\s*-\\s*(.+))?$`,
    'i'
  );
  const reWeightFirst = new RegExp(
    `^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*(.+?)\\s*-\\s*\\(([^)]*)\\)\\s*-\\s*(?:Weight|Tons|Load):\\s*([\\d.]+)\\s*-\\s*Hours:\\s*([\\d.]+)(?:\\s*-\\s*(.+))?$`,
    'i'
  );

  let m = clean.match(reHoursFirst);
  let hoursIdx = 4;
  let tonsIdx = 5;
  if (!m) {
    m = clean.match(reWeightFirst);
    if (m) {
      tonsIdx = 4;
      hoursIdx = 5;
    }
  }
  if (!m) {
    const hoursOnly = tryParseRawExportHoursOnly(clean);
    if (hoursOnly) return hoursOnly;
    const segmented = tryParseRawExportSegmented(clean);
    if (segmented) return segmented;
    const loose = tryParseRawExportLineLoose(clean);
    if (loose) return loose;
    return null;
  }
  const registration = normalizeRegistrationFromExportSegment(m[1]);
  const rawStatus = m[2].trim();
  const contractorFromPaste = m[3].trim();
  const hours = parseFloat(m[hoursIdx]);
  const tons = parseFloat(m[tonsIdx]);
  const driverName = m[6] ? m[6].trim() : '';
  if (Number.isNaN(hours) || Number.isNaN(tons)) return null;
  return { registration, rawStatus, contractorFromPaste, hours, tons, driverName };
}

/**
 * Schedule export with hours only: REG - STATUS - (COMPANY) - Hours: 12.22
 */
function tryParseRawExportHoursOnly(clean) {
  const reStatusCompany = new RegExp(
    `^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*(.+?)\\s*-\\s*\\(([^)]*)\\)\\s*-\\s*Hours:\\s*([\\d.]+)\\s*$`,
    'i'
  );
  let m = clean.match(reStatusCompany);
  if (m) {
    const registration = normalizeRegistrationFromExportSegment(m[1]);
    const rawStatus = m[2].trim();
    const contractorFromPaste = m[3].trim();
    const hours = parseFloat(m[4]);
    if (!Number.isNaN(hours) && /^[A-Z0-9]{3,26}$/.test(registration)) {
      return { registration, rawStatus, contractorFromPaste, hours, tons: 0, driverName: '' };
    }
  }
  const reCompanyStatus = new RegExp(
    `^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*\\(([^)]*)\\)\\s*-\\s*(.+?)\\s*-\\s*Hours:\\s*([\\d.]+)\\s*$`,
    'i'
  );
  m = clean.match(reCompanyStatus);
  if (m) {
    const registration = normalizeRegistrationFromExportSegment(m[1]);
    const contractorFromPaste = m[2].trim();
    const rawStatus = m[3].trim();
    const hours = parseFloat(m[4]);
    if (!Number.isNaN(hours) && /^[A-Z0-9]{3,26}$/.test(registration)) {
      return { registration, rawStatus, contractorFromPaste, hours, tons: 0, driverName: '' };
    }
  }
  return null;
}

/**
 * Split the line before the first metric (Hours or Weight/Tons) and parse REG - … segments.
 * Handles: no parentheses around company; Hours before or after Weight; optional "Load" label.
 */
function tryParseRawExportSegmented(clean) {
  const hMatch = clean.match(/Hours:\s*([\d.]+)/i);
  const massMatch = clean.match(/(?:Weight|Tons|Load)\s*:\s*([\d.]+)/i);
  if (!hMatch) return null;
  const hours = parseFloat(hMatch[1]);
  const tons = massMatch ? parseFloat(massMatch[1]) : 0;
  if (Number.isNaN(hours) || Number.isNaN(tons)) return null;

  const hi = hMatch.index ?? 0;
  const mi = massMatch.index ?? 0;
  const cut = Math.min(hi, mi);
  let head = clean.slice(0, cut).replace(/\s+-\s*$/,'').trim();
  if (!head) return null;

  const parts = head.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const registration = normalizeRegistrationFromExportSegment(parts[0]);
  if (!/^[A-Z0-9]{3,26}$/.test(registration)) return null;

  let contractorFromPaste = '';
  let rawStatus = '';

  const parenIdx = parts.findIndex((p) => /^\([^)]*\)$/.test(p));
  if (parenIdx >= 1) {
    contractorFromPaste = parts[parenIdx].replace(/^\(|\)$/g, '').trim();
    rawStatus = parts.slice(1, parenIdx).join(' - ').trim() || 'ENROUTE';
  } else if (parts.length >= 3) {
    rawStatus = parts[1];
    contractorFromPaste = parts.slice(2).join(' - ').trim();
  } else {
    rawStatus = parts[1] || 'ENROUTE';
  }

  return { registration, rawStatus, contractorFromPaste, hours, tons, driverName: '' };
}

/** Last resort: find Hours + Weight/Tons and (company); registration = first segment before metrics. */
function tryParseRawExportLineLoose(clean) {
  const hoursOnly = tryParseRawExportHoursOnly(clean);
  if (hoursOnly) return hoursOnly;
  const h = clean.match(/Hours:\s*([\d.]+)/i);
  const w = clean.match(/(?:Weight|Tons|Load)\s*:\s*([\d.]+)/i);
  if (!h) return null;
  const hours = parseFloat(h[1]);
  const tons = w ? parseFloat(w[1]) : 0;
  if (Number.isNaN(hours) || Number.isNaN(tons)) return null;
  const contractorM = clean.match(/\(\s*([^)]{1,120})\s*\)/);
  const contractorFromPaste = contractorM ? contractorM[1].trim() : '';
  const hi = h.index ?? 0;
  const wi = w.index ?? 0;
  const cut = Math.min(hi, wi);
  const beforeMetrics = clean.slice(0, cut).replace(/\s+-\s*$/,'').trim();
  const regM = beforeMetrics.match(new RegExp(`^${REGISTRATION_FIRST_SEGMENT}\\s*-\\s*`, 'i'));
  if (!regM) return null;
  const registration = normalizeRegistrationFromExportSegment(regM[1]);
  if (!/^[A-Z0-9]{3,26}$/.test(registration)) return null;
  let rest = beforeMetrics.slice(regM[0].length).trim();
  const parenIdx = rest.lastIndexOf('(');
  const rawStatus = (parenIdx > 0 ? rest.slice(0, parenIdx) : rest).replace(/\s*-\s*$/, '').trim() || 'ENROUTE';
  return { registration, rawStatus, contractorFromPaste, hours, tons, driverName: '' };
}

/**
 * Build fleet-update status using the canonical destination from the active route header
 * so lines do not keep vague waypoints (e.g. "Enroute to Khashani-Kriel") when the route is Majuba.
 */
/** WhatsApp-style bold: one asterisk on each side; strip inner stars to avoid nested markers. */
function wrapFleetStatusBold(inner) {
  const s = String(inner || '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? `*${s}*` : '*—*';
}

function normalizeStatusToken(plain) {
  return String(plain || '')
    .replace(/\s*\([DO]\)\s*$/i, '')
    .replace(/\bOFF[\s-]?LOAD(?:ING)?\b/gi, 'OFFLOADING')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatStatusForFleetLine(rawStatus, dest, origin) {
  const d = (dest || 'destination').trim() || 'destination';
  const o = (origin || 'origin').trim() || 'origin';
  let plain = normalizeStatusToken(stripMarkdownBold(rawStatus));
  const u = plain.toUpperCase();
  const atLoc = extractAtLocation(plain);
  // Queuing / queueing / queue at (exports vary in spelling and spacing)
  const queuingAt =
    /QUEU(?:E)?ING\s+AT\b/i.test(plain) ||
    /\bQUEUE\s+AT\b/i.test(plain) ||
    /\bIN\s+QUEUE\s+(?:AT|FOR)\b/i.test(u);
  const offloading =
    /\bOFFLOAD(?:ING)?\b/i.test(plain) ||
    /\bOFF[\s-]?LOAD(?:ING)?\b/i.test(plain) ||
    /\bUNLOAD(?:ING)?\b/i.test(u);
  const queuingLoose =
    /\bQUEU(?:E)?ING\b/i.test(plain) &&
    !/\bDEQUEU/i.test(u) &&
    !/\bEN[\s-]?ROUTE\b/.test(u) &&
    !/\bENROUTE\b/.test(u) &&
    !offloading;
  if (offloading) {
    if (atLoc && isOriginSiteName(atLoc, o, d)) {
      return wrapFleetStatusBold(`Loading at ${shortOriginLabel(atLoc) || o}`);
    }
    return wrapFleetStatusBold(`Offloading at ${d}`);
  }
  if (queuingAt || queuingLoose) {
    if (atLoc && isOriginSiteName(atLoc, o, d)) {
      return wrapFleetStatusBold(`Queuing at ${shortOriginLabel(atLoc) || o}`);
    }
    return wrapFleetStatusBold(`Queuing at ${d}`);
  }
  if (/\bEN[\s-]?ROUTE\b/.test(u) || /\bENROUTE\b/.test(u) || /\bIN\s+TRANSIT\b/.test(u)) {
    return wrapFleetStatusBold(`Enroute to ${d}`);
  }
  if (/\bLOADING\b/i.test(u)) {
    if (atLoc && !siteNamesMatch(atLoc, d)) {
      return wrapFleetStatusBold(`Loading at ${shortOriginLabel(atLoc) || atLoc}`);
    }
    return wrapFleetStatusBold(`Loading at ${o}`);
  }
  if (atLoc && /\bat\s+[A-Za-z]/i.test(plain)) {
    return wrapFleetStatusBold(plain);
  }
  if (/\bAT\s+[A-Z0-9]/i.test(plain) && /\b(PARK|YARD|DEPOT)\b/i.test(u)) {
    return wrapFleetStatusBold(plain);
  }
  return wrapFleetStatusBold(plain);
}

function formatEntityParen(entity) {
  const e = String(entity || '').trim();
  if (!e) return '(—)';
  return `(${e})`;
}

/**
 * Parse optional header from raw paste (day + ISO date).
 * @returns {{ dayName: string, isoDate: string } | null}
 */
const MONTH_NAMES = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseDayMonthYearLine(t) {
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return '';
  const day = parseInt(m[1], 10);
  const mon = MONTH_NAMES[m[2].toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!mon || Number.isNaN(day) || Number.isNaN(year)) return '';
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseRawExportHeader(lines) {
  let dayName = '';
  let isoDate = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(t)) {
      dayName = t;
      continue;
    }
    const iso = t.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (iso) {
      isoDate = iso[1];
      continue;
    }
    const dmy = parseDayMonthYearLine(t);
    if (dmy) {
      isoDate = dmy;
      continue;
    }
  }
  if (!isoDate && !dayName) return null;
  return { dayName, isoDate };
}

/**
 * Route banner line: contains arrow, no truck metrics (screenshot style).
 * @returns {string|null} normalized line to echo into fleet output
 */
export function parseRouteHeaderFromPasteLine(line) {
  const c = stripMarkdownBold(normalizeRawExportLine(line));
  if (!c) return null;
  if (/Tons:\s*[\d.]+/i.test(c) || /Hours:\s*[\d.]+/i.test(c)) return null;
  if (!/→|->|=>/.test(c)) return null;
  if (/^\*?FLEET\s+UPDATE/i.test(c.trim())) return null;
  if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(c)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return null;
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(c)) return null;
  return c;
}

function defaultHeaderNow() {
  const d = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[d.getDay()];
  const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dayName, isoDate };
}

/**
 * @param {object} opts
 * @param {string} opts.rawText
 * @param {string} [opts.routeDisplayName] fallback route when the paste has no `→` route banners
 * @param {Map<string,string>} opts.regToEntity normalized registration -> company label
 * @param {{ dayName?: string, isoDate?: string }} [opts.headerOverride]
 * @returns {{ text: string, warnings: string[], linesConverted: number }}
 */
export function convertRawExportToFleetUpdate(opts) {
  const rawText = String(opts.rawText || '');
  const routeDisplayName = String(opts.routeDisplayName || '').trim();
  const regToEntity = opts.regToEntity instanceof Map ? opts.regToEntity : new Map();
  const lines = rawText.split(/\r?\n/);
  const headerFromPaste = parseRawExportHeader(lines);
  const fallback = defaultHeaderNow();
  const dayName = opts.headerOverride?.dayName || headerFromPaste?.dayName || fallback.dayName;
  const isoDate = opts.headerOverride?.isoDate || headerFromPaste?.isoDate || fallback.isoDate;

  const hasPastedRouteBanners = lines.some((ln) => !!parseRouteHeaderFromPasteLine(ln));
  if (!hasPastedRouteBanners && !routeDisplayName) {
    return {
      text: '',
      warnings: [
        'No route line found in the paste (expected e.g. NTSHOVELO → MAJUBA …). Either paste a full fleet block with route headers, or select a route above for a single-route export.',
      ],
      linesConverted: 0,
    };
  }

  let currentRouteLine = hasPastedRouteBanners ? null : routeDisplayName;
  let currentDestShort = currentRouteLine
    ? shortDestinationLabel(destinationFromRouteName(currentRouteLine))
    : '';

  const out = [];
  out.push('*FLEET UPDATE/ALLOCATION*');
  out.push('');
  out.push(dayName);
  out.push('');
  out.push(isoDate);
  out.push('');

  const pushRouteLine = (routeLine) => {
    const norm = String(routeLine || '')
      .replace(/\*/g, '')
      .trim();
    if (!norm) return;
    out.push(norm);
    out.push('');
    currentDestShort = shortDestinationLabel(destinationFromRouteName(norm));
  };

  let insertedFallbackRoute = false;
  if (!hasPastedRouteBanners) {
    pushRouteLine(routeDisplayName);
    insertedFallbackRoute = true;
  }

  const warnings = [];
  let linesConverted = 0;

  for (const line of lines) {
    const rh = parseRouteHeaderFromPasteLine(line);
    if (rh) {
      currentRouteLine = rh;
      pushRouteLine(rh);
      continue;
    }

    const row = parseRawExportTruckLine(line);
    if (!row) continue;

    if (!currentDestShort && routeDisplayName && !insertedFallbackRoute) {
      pushRouteLine(routeDisplayName);
      insertedFallbackRoute = true;
    }
    const destForStatus = currentDestShort || shortDestinationLabel(destinationFromRouteName(routeDisplayName)) || 'destination';
    const originForStatus =
      shortOriginLabel(originFromRouteName(currentRouteLine || routeDisplayName)) || 'origin';

    linesConverted += 1;
    const reg = normalizeRegistration(row.registration);
    const regLookup = registrationKeyForLookup(row.registration);
    const enrolled = regToEntity.get(reg) ?? regToEntity.get(regLookup);
    const entityLabel = enrolled || row.contractorFromPaste;
    if (!enrolled && row.contractorFromPaste) {
      warnings.push(`${reg}: not on selected route enrolment — used company from paste (${row.contractorFromPaste}).`);
    } else if (!enrolled && !row.contractorFromPaste) {
      warnings.push(`${reg}: not on selected route enrolment — company unknown; check paste or route.`);
    }
    const entity = formatEntityParen(entityLabel || 'Unknown');
    const statusPart = formatStatusForFleetLine(row.rawStatus, destForStatus, originForStatus);
    const tons = row.tons.toFixed(2);
    const hours = row.hours.toFixed(2);
    out.push(`${reg} - ${entity} - ${statusPart} - Tons: ${tons} - Hours: ${hours}`);
  }

  if (linesConverted === 0) {
    return {
      text: '',
      warnings: [
        'No truck lines found. Expected: REG - (Company) - Status - Tons: 0.00 - Hours: 0.00, or REG - Status - (Company) - Hours / Weight variants.',
      ],
      linesConverted: 0,
    };
  }

  return { text: `${out.join('\n')}\n`, warnings, linesConverted };
}

/** Plain status for tables (no WhatsApp asterisks). */
export function formatPresentableStatus(rawStatus, destShort, originShort) {
  const o = originShort || 'origin';
  return stripMarkdownBold(formatStatusForFleetLine(rawStatus, destShort, o));
}

export function resolveRouteDestinationShort(routeLabel) {
  if (!routeLabel) return 'destination';
  return shortDestinationLabel(destinationFromRouteName(routeLabel)) || String(routeLabel).trim() || 'destination';
}

/**
 * Refine parsed row status for WhatsApp (Queuing at Majuba PS, not QUEUEING (D)).
 */
export function refineRowForWhatsApp(row, routeLabel) {
  const route = routeLabel || row.route || '';
  const destShort = resolveRouteDestinationShort(route);
  const originShort = resolveRouteOriginShort(route);
  const imported = row.rawStatus ?? row.status ?? '';
  const displayStatus = formatPresentableStatus(imported, destShort, originShort);
  const statusBucket = statusBucketForRow(
    { ...row, displayStatus, status: displayStatus },
    destShort
  );
  return {
    ...row,
    rawStatus: row.rawStatus ?? imported,
    status: displayStatus,
    displayStatus,
    statusBucket,
  };
}

/** Operational order for WhatsApp sections (mine → road → queue → offload). */
export const WHATSAPP_STATUS_GROUP_ORDER = [
  { bucket: 'active_site', title: (d) => `Loading / at site — ${d}` },
  { bucket: 'transit', title: (d) => `En route to ${d}` },
  { bucket: 'queue', title: (d) => `Queuing at ${d}` },
  { bucket: 'complete', title: (d) => `Offloading at ${d}` },
  { bucket: 'other', title: () => 'Other status' },
];

function resolveRowExportStatusPlain(row, destShort, originShort) {
  if (row.statusManuallyEdited) {
    return stripMarkdownBold(row.displayStatus || row.status || '');
  }
  return formatPresentableStatus(
    row.rawStatus || row.displayStatus || row.status || '',
    destShort,
    originShort
  );
}

/** Status bucket for grouping export lines (aligns with truckUpdateInsights.classifyStatus). */
export function statusBucketForRow(row, destShort, originShort) {
  const plain = resolveRowExportStatusPlain(row, destShort, originShort);
  if (/^offloading\b/i.test(plain) || /\boffloading at\b/i.test(plain)) return 'complete';
  if (/^queuing\b/i.test(plain) || /\bqueuing at\b/i.test(plain)) return 'queue';
  if (/^enroute\b/i.test(plain) || /^en route\b/i.test(plain) || /\benroute to\b/i.test(plain)) {
    return 'transit';
  }
  if (/^loading\b/i.test(plain) || /\bloading at\b/i.test(plain)) return 'active_site';
  return classifyStatus(plain);
}

function sortRowsInWhatsAppGroup(bucket, rows) {
  const copy = [...rows];
  const byReg = (a, b) =>
    normalizeRegistration(a.registration).localeCompare(normalizeRegistration(b.registration));
  const byHoursDesc = (a, b) => (Number(b.hours) || 0) - (Number(a.hours) || 0);
  if (bucket === 'queue' || bucket === 'complete' || bucket === 'active_site') {
    return copy.sort((a, b) => byHoursDesc(a, b) || byReg(a, b));
  }
  if (bucket === 'transit') {
    return copy.sort((a, b) => (Number(a.hours) || 0) - (Number(b.hours) || 0) || byReg(a, b));
  }
  return copy.sort(byReg);
}

function sumGroupTons(rows) {
  return rows.reduce(
    (sum, r) => sum + (Number.isFinite(Number(r.tons)) ? Number(r.tons) : 0),
    0
  );
}

/**
 * Group reviewed rows for WhatsApp export (status sections, sorted within each group).
 * @returns {Array<{ bucket: string, title: string, rows: object[], truckCount: number, totalTons: number }>}
 */
export function groupRowsForWhatsAppExport(rows, destShort, originShort) {
  const d = (destShort || 'destination').trim() || 'destination';
  const o = originShort || 'origin';
  const bySection = new Map();
  for (const row of rows || []) {
    if (!normalizeRegistration(row.registration)) continue;
    const bucket = row.statusBucket || statusBucketForRow(row, d, o);
    const title = resolveRowExportStatusPlain(row, d, o) || 'Other status';
    const key = `${bucket}\0${title}`;
    if (!bySection.has(key)) {
      bySection.set(key, { bucket, title, rows: [] });
    }
    bySection.get(key).rows.push(row);
  }

  const bucketRank = (b) => {
    const i = WHATSAPP_STATUS_GROUP_ORDER.findIndex((g) => g.bucket === b);
    return i >= 0 ? i : WHATSAPP_STATUS_GROUP_ORDER.length;
  };

  return [...bySection.values()]
    .map((g) => {
      const sorted = sortRowsInWhatsAppGroup(g.bucket, g.rows);
      return {
        bucket: g.bucket,
        title: g.title,
        rows: sorted,
        truckCount: sorted.length,
        totalTons: sumGroupTons(sorted),
      };
    })
    .sort(
      (a, b) =>
        bucketRank(a.bucket) - bucketRank(b.bucket) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
}

function formatWhatsAppTruckLine(row, destShort, originShort) {
  const reg = normalizeRegistration(row.registration);
  const entity = formatEntityParen(
    row.suggestedContractor || row.systemContractor || row.entity || 'Unknown'
  );
  const statusPlain = resolveRowExportStatusPlain(row, destShort, originShort);
  const statusPart = wrapWhatsAppBold(statusPlain);
  const tons = Number(row.tons);
  const hours = Number(row.hours);
  if (Number.isNaN(tons) || Number.isNaN(hours)) return null;
  const regPart = row.enrollmentFound === false ? `*${reg}* ⚠ Not integrated` : reg;
  let line = `${regPart} - ${entity} - ${statusPart} - Tons ${tons.toFixed(2)} - Hours: ${hours.toFixed(2)}`;
  const comment = String(row.comment || '').trim();
  if (comment) {
    const italicComment = wrapWhatsAppItalic(comment);
    if (italicComment) line += ` — ⚠️ ${italicComment}`;
  }
  return line;
}

/**
 * Build full WhatsApp fleet update block from reviewed rows.
 */
export function buildWhatsAppFleetUpdateFromRows({
  rows,
  routeLabel,
  dayName,
  isoDate,
  groupByStatus = true,
}) {
  const fallback = defaultHeaderNow();
  const dn = dayName || fallback.dayName;
  const id = isoDate || fallback.isoDate;
  const routeLine = String(routeLabel || '')
    .replace(/\*/g, '')
    .trim();
  const destShort = resolveRouteDestinationShort(routeLine);
  const originShort = resolveRouteOriginShort(routeLine);
  const validRows = (rows || []).filter((r) => normalizeRegistration(r.registration));
  const truckCount = validRows.length;
  const totalTons = validRows.reduce(
    (sum, r) => sum + (Number.isFinite(Number(r.tons)) ? Number(r.tons) : 0),
    0
  );

  const out = [];
  out.push('*FLEET UPDATE/ALLOCATION*');
  out.push('');
  out.push(dn);
  out.push('');
  out.push(id);
  out.push('');
  out.push(`*Total trucks for this update:* ${truckCount}`);
  out.push(`*Total tonnages for this update:* ${totalTons.toFixed(2)}`);
  out.push('');
  if (routeLine) {
    out.push(`*${routeLine}*`);
    out.push('');
  }

  const emitTruckLine = (row) => {
    const line = formatWhatsAppTruckLine(row, destShort, originShort);
    if (line) out.push(line);
  };

  if (groupByStatus && validRows.length > 0) {
    const groups = groupRowsForWhatsAppExport(validRows, destShort, originShort);
    groups.forEach((group, idx) => {
      if (idx > 0) {
        out.push('');
        out.push('──────────────');
        out.push('');
      }
      const countLabel = `${group.truckCount} truck${group.truckCount === 1 ? '' : 's'}`;
      out.push(`*${group.title} · ${countLabel} · ${group.totalTons.toFixed(2)} t*`);
      out.push('');
      for (const row of group.rows) emitTruckLine(row);
    });
  } else {
    for (const row of validRows) emitTruckLine(row);
  }

  return `${out.join('\n')}\n`;
}

/** Example refined output (Load sample). */
export const WHATSAPP_FLEET_UPDATE_SAMPLE = `*FLEET UPDATE/ALLOCATION*

Monday

2026-05-18

*Total trucks for this update:* 6
*Total tonnages for this update:* 204.38

*NTSHOVELO -> MAJUBA POWER STATION*

*En route to Majuba · 1 truck · 36.00 t*

JWV080MP - (SINGISI) - *Enroute to Majuba PS* - Tons 36.00 - Hours: 1.61

──────────────

*Queuing at Majuba · 3 trucks · 99.00 t*

JW40LXGP - (SINGISI) - *Queuing at Majuba PS* - Tons 33.00 - Hours: 24.19
KGM364MP - (SINGISI) - *Queuing at Majuba PS* - Tons 33.00 - Hours: 24.18
LBG177MP - (TTC) - *Queuing at Majuba PS* - Tons 33.00 - Hours: 24.15

──────────────

*Offloading at Majuba · 1 truck · 34.40 t*

KGC381MP - (SINGISI) - *Offloading at Majuba PS* - Tons 34.40 - Hours: 1.48

──────────────

*Queuing at Ntshovelo · 1 truck · 34.80 t*

*MF49BMGP* ⚠ Not integrated - (COLT LOGISTICS) - *Queuing at Ntshovelo* - Tons 34.80 - Hours: 0.26
`;

const RE_BREAKDOWN_HINT =
  /\b(break\s*down|breakdown|broke\s+down|tyre|tire|puncture|overheat|accident|immobil|stuck|cannot\s+move|engine\s+fault|transmission\s+fault|hydraulic|axle)\b/i;
const RE_COMMENT_HINT =
  /\b(waiting\s+for|note\s*:|comment|slips?\s+to\s+confirm|please\s+note|heads?\s+up|awaiting|pending\s+confirmation)\b/i;

function extractRegsFromText(t) {
  const s = String(t || '');
  const found = new Set();
  const re = /\b([A-Z]{2,3}\d{2,3}[A-Z]{2,3}|[A-Z]\d{2,3}[A-Z]{2,3}\d{2})\b/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = normalizeRegistration(m[1]);
    if (n && /^[A-Z0-9]{5,12}$/.test(n)) found.add(n);
  }
  return [...found];
}

function normTxt(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lines that look like operational notes / breakdowns (not standard truck metric rows).
 * @param {string} rawText full paste
 * @returns {Array<{ id: string, line: number, text: string, kind: 'breakdown'|'comment', registrations: string[] }>}
 */
export function detectPasteIssueLines(rawText) {
  const rawLines = String(rawText || '').split(/\r?\n/);
  const issues = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const t = stripMarkdownBold(normalizeRawExportLine(raw));
    if (!t) continue;
    if (/^\*?FLEET\s+UPDATE/i.test(t.trim())) continue;
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(t)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(t)) continue;
    if (parseRouteHeaderFromPasteLine(raw)) continue;
    if (parseRawExportTruckLine(raw)) continue;
    if (/^[-_=•.\s]{2,}$/u.test(t)) continue;

    let kind = null;
    if (RE_BREAKDOWN_HINT.test(t)) kind = 'breakdown';
    else if (RE_COMMENT_HINT.test(t) || /^\(\s*[^)]{3,}/.test(t)) kind = 'comment';

    if (!kind) continue;
    const id = `issue-${i}-${kind}`;
    issues.push({
      id,
      line: i + 1,
      text: t.slice(0, 500),
      kind,
      registrations: extractRegsFromText(t),
    });
  }
  return issues;
}

/**
 * Match pasted issue line to an unresolved Command Centre breakdown (best effort).
 * @param {{ text: string, registrations: string[] }} issue
 * @param {Array<object>} breakdowns from GET /command-centre/breakdowns
 * @returns {object|null}
 */
export function matchBreakdownForPasteIssue(issue, breakdowns) {
  if (!issue || !Array.isArray(breakdowns)) return null;
  const issueRegs = issue.registrations || [];
  const blob = normTxt(issue.text);
  for (const b of breakdowns) {
    const breg = normalizeRegistration(b.truck_registration || '');
    if (!breg) continue;
    const regHit = issueRegs.length > 0 ? issueRegs.includes(breg) : blob.includes(normTxt(breg));
    if (!regHit) continue;
    const desc = normTxt(`${b.title || ''} ${b.description || ''}`);
    if (desc.length < 4) {
      return b;
    }
    const words = desc.split(/\s+/).filter((w) => w.length > 3);
    const overlap = words.some((w) => blob.includes(w));
    if (overlap || blob.includes(normTxt(breg))) return b;
  }
  for (const b of breakdowns) {
    const breg = normalizeRegistration(b.truck_registration || '');
    if (!breg || !blob.includes(normTxt(breg))) continue;
    return b;
  }
  return null;
}
