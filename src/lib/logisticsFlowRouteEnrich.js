/**
 * Route-scoped enrollment matching for logistics flow import & verify.
 */

import { normReg } from './logisticsFlowParse.js';

export { normReg };

function normRouteKey(route) {
  return String(route || '')
    .replace(/\*\*/g, '')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/→|->|=>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** @param {Function} getRow */
export function pickRow(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (k && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
  }
  const first = keys[0];
  if (!first) return null;
  const lower = String(first).toLowerCase().replace(/_/g, '');
  for (const [key, val] of Object.entries(row)) {
    if (
      key &&
      String(key).toLowerCase().replace(/_/g, '') === lower &&
      val !== undefined &&
      val !== null &&
      String(val).trim() !== ''
    ) {
      return val;
    }
  }
  return null;
}

function contractorLabelFromTruckRow(row, getRow) {
  const co = String(pickRow(row, 'contractor_company_name', 'contractorCompanyName') || '').trim();
  if (co) return co;
  const main = String(pickRow(row, 'main_contractor', 'mainContractor') || '').trim();
  const sub = String(pickRow(row, 'sub_contractor', 'subContractor') || '').trim();
  return main || sub || '';
}

/**
 * @param {import('../db.js').query} queryFn
 * @param {string} tenantIdVal
 * @param {string} routeId
 */
export async function loadRouteEnrollmentDetail(queryFn, tenantIdVal, routeId) {
  if (!routeId) return { routeLabel: null, byRegistration: new Map(), registrations: [] };

  const routeRes = await queryFn(
    `SELECT id, name FROM contractor_routes WHERE id = @routeId AND tenant_id = @tenantId`,
    { routeId, tenantId: tenantIdVal }
  );
  const routeRow = routeRes.recordset?.[0];
  const routeLabel = pickRow(routeRow, 'name') ? String(pickRow(routeRow, 'name')).trim() : null;

  const trucksRes = await queryFn(
    `SELECT rt.truck_id, t.id, t.registration, t.make_model, t.fleet_no,
      COALESCE(co.name, t.main_contractor, t.sub_contractor) AS contractor_label,
      t.main_contractor, t.sub_contractor, t.facility_access
     FROM contractor_route_trucks rt
     INNER JOIN contractor_trucks t ON t.id = rt.truck_id AND t.tenant_id = @tenantId
     LEFT JOIN contractors co ON co.id = t.contractor_id AND co.tenant_id = @tenantId
     WHERE rt.route_id = @routeId
     ORDER BY t.registration`,
    { routeId, tenantId: tenantIdVal }
  );

  const byRegistration = new Map();
  for (const row of trucksRes.recordset || []) {
    const reg = normReg(pickRow(row, 'registration'));
    if (!reg) continue;
    const label = String(pickRow(row, 'contractor_label') || '').trim() || contractorLabelFromTruckRow(row, pickRow);
    byRegistration.set(reg, {
      truckId: pickRow(row, 'truck_id', 'id'),
      registration: reg,
      systemContractor: label,
      makeModel: pickRow(row, 'make_model', 'makeModel'),
      fleetNo: pickRow(row, 'fleet_no', 'fleetNo'),
      facilityAccess: !!pickRow(row, 'facility_access', 'facilityAccess'),
    });
  }

  return {
    routeLabel,
    byRegistration,
    registrations: [...byRegistration.keys()],
  };
}

/**
 * Score how well a pasted route banner matches the selected route name (0–100).
 */
export function scoreRouteLabelMatch(pasteRoute, selectedRouteLabel) {
  const a = normRouteKey(pasteRoute);
  const b = normRouteKey(selectedRouteLabel);
  if (!a || !b) return null;
  if (a === b || a.includes(b) || b.includes(a)) return 100;
  const tokensA = a.split(/[\s/]+/).filter((t) => t.length >= 3);
  const tokensB = b.split(/[\s/]+/).filter((t) => t.length >= 3);
  let score = 0;
  for (const t of tokensA) {
    if (b.includes(t)) score += t.length;
  }
  for (const t of tokensB) {
    if (a.includes(t)) score += t.length;
  }
  const denom = Math.max(tokensA.join('').length, tokensB.join('').length, 1);
  return Math.min(100, Math.round((score / denom) * 100));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * If pasted plate is close to an enrolled registration, suggest the enrolled plate.
 */
export function fuzzyMatchRouteRegistration(pastedReg, routeByReg) {
  const key = normReg(pastedReg);
  if (!key || routeByReg.has(key)) return routeByReg.has(key) ? { reg: key, fuzzy: false } : null;
  if (key.length < 6) return null;
  let best = null;
  let bestDist = 3;
  for (const enrolled of routeByReg.keys()) {
    if (Math.abs(enrolled.length - key.length) > 2) continue;
    const d = levenshtein(key, enrolled);
    if (d < bestDist) {
      bestDist = d;
      best = enrolled;
    }
  }
  if (best && bestDist <= 2) return { reg: best, fuzzy: true };
  return null;
}

function contractorsAlign(pasted, system) {
  if (!pasted || !system) return true;
  const p = pasted.toLowerCase();
  const s = system.toLowerCase();
  if (p === s) return true;
  if (s.includes(p) || p.includes(s)) return true;
  if (p.length >= 4 && s.includes(p.slice(0, Math.min(8, p.length)))) return true;
  return false;
}

/**
 * Enrich parsed rows using fleet register + route enrollment.
 */
export function enrichRowsWithRoute(rows, enrollmentMap, routeEnrollment, options = {}) {
  const {
    routeId = null,
    routeLabel = null,
    pasteRoute = null,
  } = options;

  const routeByReg = routeEnrollment?.byRegistration || new Map();
  const hasRoute = !!routeId && routeByReg.size > 0;
  const pasteRouteScore =
    pasteRoute && routeLabel ? scoreRouteLabelMatch(pasteRoute, routeLabel) : null;
  const pasteRouteMismatch =
    hasRoute && pasteRoute && pasteRouteScore != null && pasteRouteScore < 45;

  const pastedRegs = new Set();

  const enriched = (rows || []).map((r) => {
    let key = normReg(r.registration);
    pastedRegs.add(key);

    let registrationCorrected = false;
    if (hasRoute && key && !routeByReg.has(key)) {
      const fuzzy = fuzzyMatchRouteRegistration(key, routeByReg);
      if (fuzzy?.fuzzy) {
        key = fuzzy.reg;
        registrationCorrected = true;
        pastedRegs.add(key);
      }
    }

    const routeTruck = hasRoute ? routeByReg.get(key) : null;
    const sys = enrollmentMap.get(key);
    const pastedEntity = String(r.entity || '').trim();

    const routeContractor = routeTruck?.systemContractor || '';
    const fleetContractor = sys?.systemContractor || '';
    const systemContractor = routeContractor || fleetContractor;

    const enrollmentFound = !!sys || !!routeTruck;
    const enrolledOnRoute = hasRoute ? !!routeTruck : null;
    const notOnSelectedRoute = hasRoute && enrollmentFound && !routeTruck;

    const contractorMismatch =
      pastedEntity &&
      systemContractor &&
      !contractorsAlign(pastedEntity, systemContractor);

    const matchTier = routeTruck
      ? 'route_enrolled'
      : sys
        ? 'register_only'
        : 'unknown';

    return {
      ...r,
      registration: key || r.registration,
      registrationCorrected,
      truckId: routeTruck?.truckId || sys?.truckId || null,
      systemContractor,
      routeContractor: routeContractor || null,
      enrollmentFound,
      enrolledOnRoute,
      notOnSelectedRoute,
      contractorMismatch,
      suggestedContractor: systemContractor || pastedEntity,
      matchTier,
      routeEnrolled: !!routeTruck,
    };
  });

  const enrolledNotInPaste = hasRoute
    ? [...routeByReg.entries()]
        .filter(([reg]) => !pastedRegs.has(reg))
        .map(([reg, t]) => ({
          registration: reg,
          systemContractor: t.systemContractor,
          makeModel: t.makeModel,
          fleetNo: t.fleetNo,
        }))
        .sort((a, b) => a.registration.localeCompare(b.registration))
    : [];

  const onRouteCount = enriched.filter((r) => r.routeEnrolled).length;
  const notOnRouteCount = enriched.filter((r) => r.notOnSelectedRoute).length;
  const notOnRegisterCount = enriched.filter((r) => !r.enrollmentFound).length;
  const contractorMismatchCount = enriched.filter((r) => r.contractorMismatch).length;
  const correctedCount = enriched.filter((r) => r.registrationCorrected).length;
  const enrolledCount = routeByReg.size;

  const routeAnalysis = {
    routeId,
    routeLabel: routeLabel || routeEnrollment?.routeLabel || null,
    pasteRoute: pasteRoute || null,
    pasteRouteMatchScore: pasteRouteScore,
    pasteRouteMismatch,
    enrolledCount,
    pastedCount: enriched.length,
    onRouteCount,
    notOnRouteCount,
    notOnRegisterCount,
    contractorMismatchCount,
    registrationCorrectedCount: correctedCount,
    enrolledNotInPasteCount: enrolledNotInPaste.length,
    routeCoveragePercent:
      enrolledCount > 0 ? Math.round((onRouteCount / enrolledCount) * 100) : null,
    pasteCoveragePercent:
      enriched.length > 0 ? Math.round((onRouteCount / enriched.length) * 100) : null,
  };

  return {
    rows: enriched,
    routeAnalysis,
    enrolledNotInPaste,
  };
}
