/**
 * Server-side WhatsApp fleet update formatting (mirrors client rawExportToFleetUpdate helpers).
 */

function stripBold(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

export function destinationFromRouteName(routeName) {
  const s = String(routeName || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
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
  return s;
}

export function originFromRouteName(routeName) {
  const s = String(routeName || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-')
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

export function shortDestinationLabel(fullDest) {
  let s = String(fullDest || '').trim();
  if (!s) return '';
  const terminal = hyphenRouteTerminalSite(s);
  if (terminal) s = terminal;
  const words = s.split(/\s+/);
  const u = s.toUpperCase();
  if (/\bPOWER\s+STATION\b/.test(u) || /\bPS\b$/.test(u)) {
    const w0 = words[0] || s;
    return w0.charAt(0) + w0.slice(1).toLowerCase() + ' PS';
  }
  if (words.length <= 3) {
    return words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function shortOriginLabel(fullOrigin) {
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

export function resolveRouteDestinationShort(routeLabel) {
  if (!routeLabel) return 'destination';
  return shortDestinationLabel(destinationFromRouteName(routeLabel)) || String(routeLabel).trim() || 'destination';
}

export function resolveRouteOriginShort(routeLabel) {
  if (!routeLabel) return 'origin';
  return shortOriginLabel(originFromRouteName(routeLabel)) || 'origin';
}

export function normalizeSiteToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bpower\s+station\b/g, ' ps')
    .replace(/\s*\([do]\)\s*/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function siteNamesMatch(a, b) {
  const na = normalizeSiteToken(a);
  const nb = normalizeSiteToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = na.split(' ').filter((w) => w.length >= 3);
  const wb = nb.split(' ').filter((w) => w.length >= 3);
  return wa.some((x) => wb.some((y) => x === y || x.includes(y) || y.includes(x)));
}

export function extractAtLocation(statusText) {
  const plain = stripBold(statusText);
  const m = plain.match(/\bat\s+(.+?)(?:\s*\([DO]\)\s*)?$/i);
  return m ? m[1].trim() : null;
}

const ORIGIN_SITE_HINTS = /ntshovelo|manungu|colliery|mine|load\s*out|tip\s*bin|stockpile|pit/i;

export function isOriginSiteName(name, originLabel, destLabel) {
  if (!name) return false;
  if (siteNamesMatch(name, originLabel)) return true;
  if (destLabel && siteNamesMatch(name, destLabel)) return false;
  return ORIGIN_SITE_HINTS.test(String(name));
}

function normalizeStatusToken(plain) {
  return String(plain || '')
    .replace(/\s*\([DO]\)\s*$/i, '')
    .replace(/\bOFF[\s-]?LOAD(?:ING)?\b/gi, 'OFFLOADING')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format status for display / shift report. Loading uses colliery (origin); offload & queue use PS (destination).
 */
export function formatPresentableStatus(rawStatus, destShort, originShort) {
  const d = (destShort || 'destination').trim() || 'destination';
  const o = (originShort || 'origin').trim() || 'origin';
  let plain = normalizeStatusToken(stripBold(rawStatus));
  const u = plain.toUpperCase();
  const atLoc = extractAtLocation(plain);

  const offloading =
    /\bOFFLOAD(?:ING)?\b/i.test(plain) ||
    /\bOFF[\s-]?LOAD(?:ING)?\b/i.test(plain) ||
    /\bUNLOAD(?:ING)?\b/i.test(u);
  const queuingAt =
    /QUEU(?:E)?ING\s+AT\b/i.test(plain) ||
    /\bQUEUE\s+AT\b/i.test(plain) ||
    /\bIN\s+QUEUE\s+(?:AT|FOR)\b/i.test(u);
  const queuingLoose =
    /\bQUEU(?:E)?ING\b/i.test(plain) &&
    !/\bDEQUEU/i.test(u) &&
    !/\bEN[\s-]?ROUTE\b/.test(u) &&
    !/\bENROUTE\b/.test(u) &&
    !offloading;
  const loading = /\bLOADING\b/i.test(plain);
  const enroute =
    /\bEN[\s-]?ROUTE\b/.test(u) || /\bENROUTE\b/.test(u) || /\bIN\s+TRANSIT\b/.test(u);

  if (offloading) {
    if (atLoc && isOriginSiteName(atLoc, o, d)) {
      return `Loading at ${shortOriginLabel(atLoc) || o}`;
    }
    return `Offloading at ${d}`;
  }
  if (queuingAt || queuingLoose) {
    if (atLoc && isOriginSiteName(atLoc, o, d)) {
      return `Queuing at ${shortOriginLabel(atLoc) || o}`;
    }
    return `Queuing at ${d}`;
  }
  if (enroute) return `Enroute to ${d}`;
  if (loading) {
    if (atLoc && !siteNamesMatch(atLoc, d)) {
      return `Loading at ${shortOriginLabel(atLoc) || atLoc}`;
    }
    return `Loading at ${o}`;
  }
  if (atLoc && /\bat\s+[A-Za-z]/i.test(plain)) return plain;
  return plain || '—';
}

export function refineRowForWhatsApp(row, routeLabel) {
  const route = routeLabel || row.route || '';
  const destShort = resolveRouteDestinationShort(route);
  const originShort = resolveRouteOriginShort(route);
  const rawStatus = row.rawStatus ?? row.status ?? '';
  const displayStatus = formatPresentableStatus(rawStatus, destShort, originShort);
  return {
    ...row,
    rawStatus,
    status: displayStatus,
    displayStatus,
  };
}

export function refineRowsForWhatsApp(rows, routeLabel) {
  return (rows || []).map((r) => refineRowForWhatsApp(r, routeLabel));
}

/** Parse WhatsApp export section headers (*Queuing at Majuba · 12 trucks · …*). */
export function parseWhatsAppExportSectionCounts(whatsappExport, { originLabel, destLabel } = {}) {
  const counts = {
    loading_origin: 0,
    enroute: 0,
    queuing_origin: 0,
    queuing_dest: 0,
    offloading_dest: 0,
  };
  if (!whatsappExport) return counts;

  for (const line of String(whatsappExport).split('\n')) {
    const m = line.match(/\*([^*]+?)\s*·\s*(\d+)\s*truck/i);
    if (!m) continue;
    const title = stripBold(m[1]).trim();
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n) || n < 0) continue;
    const tl = title.toLowerCase();

    if (/offloading/i.test(tl)) {
      if (isOriginSiteName(title, originLabel, destLabel)) continue;
      counts.offloading_dest = Math.max(counts.offloading_dest, n);
    } else if (/queuing|queueing/i.test(tl)) {
      if (isOriginSiteName(title, originLabel, destLabel)) {
        counts.queuing_origin = Math.max(counts.queuing_origin, n);
      } else {
        counts.queuing_dest = Math.max(counts.queuing_dest, n);
      }
    } else if (/en\s*route|enroute|transit/i.test(tl)) {
      counts.enroute = Math.max(counts.enroute, n);
    } else if (/loading|at site/i.test(tl)) {
      counts.loading_origin = Math.max(counts.loading_origin, n);
    }
  }
  return counts;
}
