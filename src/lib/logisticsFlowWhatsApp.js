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
  return s;
}

export function shortDestinationLabel(fullDest) {
  let s = String(fullDest || '').trim();
  if (!s) return '';
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

export function resolveRouteDestinationShort(routeLabel) {
  if (!routeLabel) return 'destination';
  return shortDestinationLabel(destinationFromRouteName(routeLabel)) || String(routeLabel).trim() || 'destination';
}

function normalizeStatusToken(plain) {
  return String(plain || '')
    .replace(/\s*\([DO]\)\s*$/i, '')
    .replace(/\bOFF[\s-]?LOAD(?:ING)?\b/gi, 'OFFLOADING')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatPresentableStatus(rawStatus, destShort) {
  const d = (destShort || 'destination').trim() || 'destination';
  let plain = normalizeStatusToken(stripBold(rawStatus));
  const u = plain.toUpperCase();
  if (/\bat\s+[A-Za-z][A-Za-z0-9\s]{1,40}$/i.test(plain) && !/^\s*QUEU/i.test(plain)) {
    return plain;
  }
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
  if (offloading) return `Offloading at ${d}`;
  if (queuingLoose) return `Queuing at ${d}`;
  if (/\bEN[\s-]?ROUTE\b/.test(u) || /\bENROUTE\b/.test(u) || /\bIN\s+TRANSIT\b/.test(u)) {
    return `Enroute to ${d}`;
  }
  if (/\bLOADING\s+AT\b/.test(u)) return `Loading at ${d}`;
  return plain || '—';
}

export function refineRowForWhatsApp(row, routeLabel) {
  const route = routeLabel || row.route || '';
  const destShort = resolveRouteDestinationShort(route);
  const rawStatus = row.rawStatus ?? row.status ?? '';
  const displayStatus = formatPresentableStatus(rawStatus, destShort);
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
