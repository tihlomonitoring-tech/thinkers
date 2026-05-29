/**
 * Server-side fleet update text parsing (regex-first, no API cost).
 * Mirrors client truckUpdateParse / rawExport patterns for common exports.
 */

function stripBold(s) {
  return String(s || '').replace(/\*\*/g, '').trim();
}

function normReg(reg) {
  return String(reg || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s\-_/]/g, '')
    .toUpperCase();
}

function normDashes(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014\u2212]/g, '-');
}

const TRUCK_LINE_COLON =
  /^([A-Z0-9]+)\s*-\s*\(([^)]*)\)\s*-\s*(.+?)\s*-\s*Tons:\s*([\d.]+)\s*-\s*Hours:\s*([\d.]+)\s*$/i;

const TRUCK_LINE_SPACE_TONS =
  /^([A-Z0-9]+)\s*-\s*\(([^)]*)\)\s*-\s*(.+?)\s*-\s*Tons\s+([\d.]+)\s*-\s*Hours:\s*([\d.]+)\s*$/i;

const TRUCK_LINE_HOURS_WEIGHT =
  /^([A-Z0-9]+)\s*-\s*(.+?)\s*-\s*\(([^)]*)\)\s*-\s*Hours:\s*([\d.]+)\s*-\s*(?:Weight|Tons|Load):\s*([\d.]+)\s*$/i;

/** REG - STATUS - (COMPANY) - Hours: 12.22 (no tons on export) */
const TRUCK_LINE_HOURS_ONLY =
  /^([A-Z0-9]+)\s*-\s*(.+?)\s*-\s*\(([^)]*)\)\s*-\s*Hours:?\s*([\d.]+)\s*$/i;

function parseTruckLine(line) {
  const clean = normDashes(stripBold(line));
  let m = clean.match(TRUCK_LINE_COLON) || clean.match(TRUCK_LINE_SPACE_TONS);
  if (m) {
    return {
      registration: m[1].toUpperCase(),
      entity: m[2].trim(),
      status: m[3].trim(),
      tons: parseFloat(m[4]),
      hours: parseFloat(m[5]),
    };
  }
  m = clean.match(TRUCK_LINE_HOURS_WEIGHT);
  if (m) {
    return {
      registration: normReg(m[1]),
      entity: m[3].trim(),
      status: m[2].trim(),
      tons: parseFloat(m[5]),
      hours: parseFloat(m[4]),
    };
  }
  m = clean.match(TRUCK_LINE_HOURS_ONLY);
  if (m) {
    return {
      registration: normReg(m[1]),
      entity: m[3].trim(),
      status: m[2].trim(),
      tons: 0,
      hours: parseFloat(m[4]),
    };
  }
  if (!/Tons/i.test(clean) && !/Hours/i.test(clean) && !/Weight/i.test(clean)) return null;
  const tonsM = clean.match(/(?:Tons|Weight|Load):?\s*([\d.]+)/i);
  const hoursM = clean.match(/Hours:?\s*([\d.]+)/i);
  if (!hoursM) return null;
  const idx = Math.min(
    clean.search(/(?:Tons|Weight|Load)/i),
    clean.search(/Hours/i)
  );
  const before = clean.slice(0, idx >= 0 ? idx : clean.length).trim().replace(/\s+-\s*$/, '');
  const parts = before.split(/\s*-\s*/).map((p) => p.trim());
  const registration = normReg(parts[0] || '');
  if (!registration || registration.length < 4) return null;
  let entity = '';
  let status = '';
  for (let i = 1; i < parts.length; i++) {
    if (/^\([^)]*\)$/.test(parts[i])) {
      entity = parts[i].replace(/^\(|\)$/g, '').trim();
    } else if (!status) {
      status = parts[i];
    } else {
      status += ` - ${parts[i]}`;
    }
  }
  return {
    registration,
    entity,
    status,
    tons: tonsM ? parseFloat(tonsM[1]) : 0,
    hours: parseFloat(hoursM[1]),
  };
}

/**
 * @param {string} text
 * @returns {{ rows: object[], warnings: object[], comments: object[], meta: { date?: string, route?: string } }}
 */
export function parseLogisticsFlowText(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = rawLines.map((l) => stripBold(l));
  let currentDate = null;
  let currentDayName = null;
  let currentRoute = null;
  const rows = [];
  const warnings = [];
  const comments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^\*?FLEET\s+UPDATE/i.test(line.trim())) continue;
    if (/^day:\s*/i.test(line)) continue;
    const dayOnly = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i);
    if (dayOnly) {
      currentDayName = dayOnly[1];
      continue;
    }

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
    const hasMetrics = /(?:Tons|Weight|Load)/i.test(line) && /Hours/i.test(line);
    if (hasArrow && !hasMetrics) {
      currentRoute = line.replace(/\s+/g, ' ').trim();
      continue;
    }
    if (hasMetrics || /Hours:\s*[\d.]+/i.test(line)) {
      const row = parseTruckLine(rawLines[i]);
      if (row && !Number.isNaN(row.hours)) {
        rows.push({
          ...row,
          date: currentDate,
          route: currentRoute,
          lineNumber: i + 1,
        });
      } else {
        warnings.push({ line: i + 1, text: line.slice(0, 200) });
      }
      continue;
    }
    if (line.trim().length > 2) {
      comments.push({ line: i + 1, text: line.slice(0, 200) });
    }
  }

  return {
    rows,
    warnings,
    comments: comments.slice(0, 80),
    meta: { date: currentDate, route: currentRoute, dayName: currentDayName },
  };
}

export { normReg };
