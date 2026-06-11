export const UNASSIGNED_ROUTE_ID = '__unassigned__';

export const ALTERNATE_MODES = [
  { id: 'smart', label: 'Smart priority', hint: 'Focus routes with slips, alerts, then busiest lanes' },
  { id: 'sequential', label: 'Round robin', hint: 'Cycle every active route in order' },
  { id: 'actions_first', label: 'Actions only', hint: 'Only routes needing slip or driver capture' },
];

export const ALTERNATE_INTERVALS = [20, 30, 45, 60];

const PREFS_KEY = 'logistics-activity-route-view';

export function loadRouteViewPrefs() {
  try {
    const raw = sessionStorage.getItem(PREFS_KEY);
    if (!raw) return defaultRouteViewPrefs();
    const p = JSON.parse(raw);
    return { ...defaultRouteViewPrefs(), ...p };
  } catch {
    return defaultRouteViewPrefs();
  }
}

export function saveRouteViewPrefs(prefs) {
  try {
    sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function defaultRouteViewPrefs() {
  return {
    filterRouteId: 'all',
    autoAlternate: false,
    alternateMode: 'smart',
    intervalSec: 30,
    scheduleArchived: true,
    routeViewArchived: true,
  };
}

export function filterBoardStages(stages, routeId) {
  if (!routeId || routeId === 'all') return stages;
  return (stages || []).map((stage) => {
    const items = (stage.items || []).filter((item) =>
      routeId === UNASSIGNED_ROUTE_ID ? !item.contractor_route_id : item.contractor_route_id === routeId
    );
    return { ...stage, items, count: items.length };
  });
}

export function activeRouteSummaries(summaries) {
  return (summaries || []).filter((s) => s.total > 0);
}

/** Pick next route for auto-alternate rotation. */
export function pickNextAlternateRoute(summaries, currentRouteId, mode, visitedOrder = []) {
  let pool = activeRouteSummaries(summaries);
  if (!pool.length) return null;

  if (mode === 'actions_first') {
    pool = pool.filter((s) => s.action_needed > 0);
    if (!pool.length) return null;
  }

  if (mode === 'smart') {
    const ranked = [...pool].sort((a, b) => b.priority_score - a.priority_score || b.total - a.total);
    const top = ranked[0];
    if (!currentRouteId) return top.route_id;
    const current = ranked.find((s) => s.route_id === currentRouteId);
    if (!current) return top.route_id;
    const urgentElsewhere = ranked.find(
      (s) => s.route_id !== currentRouteId && s.priority_score > current.priority_score + 15
    );
    if (urgentElsewhere) return urgentElsewhere.route_id;
    const idx = ranked.findIndex((s) => s.route_id === currentRouteId);
    return ranked[(idx + 1) % ranked.length].route_id;
  }

  // sequential round robin on active routes
  const ordered = [...pool].sort((a, b) => a.route_name.localeCompare(b.route_name));
  if (!currentRouteId) return ordered[0].route_id;
  const idx = ordered.findIndex((s) => s.route_id === currentRouteId);
  if (idx === -1) return ordered[0].route_id;
  return ordered[(idx + 1) % ordered.length].route_id;
}

export function findRouteSummary(summaries, routeId) {
  return (summaries || []).find((s) => s.route_id === routeId) || null;
}

export function boardTotals(stages) {
  return (stages || []).reduce((sum, s) => sum + (s.items?.length || 0), 0);
}

/** Client fallback when API omits route_summaries (older server). */
export function buildRouteSummariesFromBoard(stages, routes) {
  const items = (stages || []).flatMap((s) => s.items || []);
  const map = new Map();

  for (const r of routes || []) {
    map.set(r.id, {
      route_id: r.id,
      route_name: r.name,
      loading_address: r.loading_address,
      destination_address: r.destination_address,
      total: 0,
      scheduled: 0,
      at_loading: 0,
      enroute: 0,
      at_destination: 0,
      action_needed: 0,
      alerts: 0,
      priority_score: 0,
      priority_reason: null,
    });
  }
  map.set(UNASSIGNED_ROUTE_ID, {
    route_id: UNASSIGNED_ROUTE_ID,
    route_name: 'Unassigned',
    loading_address: null,
    destination_address: null,
    total: 0,
    scheduled: 0,
    at_loading: 0,
    enroute: 0,
    at_destination: 0,
    action_needed: 0,
    alerts: 0,
    priority_score: 0,
    priority_reason: null,
  });

  for (const item of items) {
    const rid = item.contractor_route_id || UNASSIGNED_ROUTE_ID;
    if (!map.has(rid)) {
      map.set(rid, {
        route_id: rid,
        route_name: item.route_name || 'Unknown route',
        loading_address: item.loading_address,
        destination_address: item.destination_address,
        total: 0,
        scheduled: 0,
        at_loading: 0,
        enroute: 0,
        at_destination: 0,
        action_needed: 0,
        alerts: 0,
        priority_score: 0,
        priority_reason: null,
      });
    }
    const s = map.get(rid);
    s.total += 1;
    const stage = item.activity_stage;
    if (stage === 'scheduled') s.scheduled += 1;
    else if (stage === 'at_loading') s.at_loading += 1;
    else if (stage === 'enroute') s.enroute += 1;
    else if (stage === 'at_destination') s.at_destination += 1;
    if (item.needs_action) s.action_needed += 1;
    if (item.is_overdue || item.deviation_count > 0) s.alerts += 1;
  }

  const summaries = [...map.values()].filter(
    (s) => s.total > 0 || (routes || []).some((r) => r.id === s.route_id)
  );

  for (const s of summaries) {
    s.priority_score =
      s.action_needed * 100 +
      s.alerts * 45 +
      s.at_loading * 25 +
      s.at_destination * 30 +
      s.enroute * 8 +
      s.scheduled * 3;
    if (s.action_needed > 0) s.priority_reason = `${s.action_needed} slip(s) awaiting capture`;
    else if (s.alerts > 0) s.priority_reason = `${s.alerts} alert(s) on route`;
    else if (s.enroute > 0) s.priority_reason = `${s.enroute} en route`;
    else if (s.total > 0) s.priority_reason = `${s.total} active truck(s)`;
    else s.priority_reason = 'No activity';
  }

  summaries.sort(
    (a, b) => b.priority_score - a.priority_score || b.total - a.total || a.route_name.localeCompare(b.route_name)
  );
  return summaries;
}
