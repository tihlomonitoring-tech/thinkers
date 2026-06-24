/**
 * Build reporting-line tree from org assignments.
 * Includes every assignment (filled and vacant) and links via normalized manager user ids.
 */

function normalizeUserId(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim().replace(/^\{|\}$/g, '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s) ? s : '';
}

function nodeKey(a) {
  return String(a?.id || a?.user_id || a?.position_id || '');
}

function pickManagerNode(managerUid, byUserUid, selfKey) {
  if (!managerUid) return null;
  const candidates = (byUserUid.get(managerUid) || []).filter((n) => nodeKey(n) !== selfKey);
  if (!candidates.length) return null;
  return candidates.find((n) => n.is_primary !== false && n.is_primary !== 0) || candidates[0];
}

export function buildOrgTree(assignments) {
  const active = (assignments || []).filter((a) => a.is_active !== false);
  const nodes = active.map((a) => ({
    ...a,
    children: [],
    manager_uid: normalizeUserId(a.manager_user_id),
    user_uid: normalizeUserId(a.user_id),
  }));

  const byUserUid = new Map();
  for (const n of nodes) {
    if (!n.user_uid) continue;
    if (!byUserUid.has(n.user_uid)) byUserUid.set(n.user_uid, []);
    byUserUid.get(n.user_uid).push(n);
  }

  const roots = [];
  for (const n of nodes) {
    const parent = pickManagerNode(n.manager_uid, byUserUid, nodeKey(n));
    if (parent) parent.children.push(n);
    else roots.push(n);
  }

  const sortKids = (list) => {
    list.sort((x, y) => {
      const so = (x.sort_order || 0) - (y.sort_order || 0);
      if (so !== 0) return so;
      const xName = x.display_name || x.position_title || '';
      const yName = y.display_name || y.position_title || '';
      return String(xName).localeCompare(String(yName));
    });
    for (const n of list) sortKids(n.children || []);
  };
  sortKids(roots);
  return roots;
}

export function flattenOrgTree(roots) {
  const out = [];
  function walk(n, depth, path) {
    const key = nodeKey(n);
    if (path.has(key)) return;
    path.add(key);
    out.push({ ...n, depth });
    for (const c of n.children || []) walk(c, depth + 1, new Set(path));
  }
  for (const r of roots || []) walk(r, 0, new Set());
  return out;
}

export function countOrgTreeNodes(roots) {
  return flattenOrgTree(roots).length;
}

export function maxOrgTreeBreadth(roots) {
  const levels = [];
  const walk = (nodes, depth) => {
    if (!nodes?.length) return;
    levels[depth] = (levels[depth] || 0) + nodes.length;
    for (const n of nodes) walk(n.children || [], depth + 1);
  };
  walk(roots || [], 0);
  return levels.length ? Math.max(...levels) : 0;
}

export function maxOrgTreeDepth(roots) {
  const walk = (nodes, depth) => {
    if (!nodes?.length) return depth;
    return Math.max(...nodes.map((n) => walk(n.children || [], depth + 1)));
  };
  return walk(roots || [], 0);
}

/** Approximate chart canvas size for layout / print scaling. */
export function orgChartCanvasSize(roots) {
  const breadth = maxOrgTreeBreadth(roots);
  const depth = maxOrgTreeDepth(roots);
  const rootCount = (roots || []).length;
  const nodeW = 268;
  const nodeH = 92;
  const levelGap = 60;
  const hPad = 32;
  return {
    width: Math.max(400, breadth * (nodeW + hPad), rootCount * (nodeW + 40)),
    height: Math.max(220, depth * (nodeH + levelGap) + 100),
  };
}

/** Assignments whose manager is set but not present on the chart (shown as top-level). */
export function orphanedManagerAssignments(assignments, roots) {
  const onChartUserIds = new Set();
  for (const n of flattenOrgTree(roots)) {
    if (n.user_uid) onChartUserIds.add(n.user_uid);
  }
  return (assignments || []).filter((a) => {
    const mid = normalizeUserId(a.manager_user_id);
    return mid && !onChartUserIds.has(mid);
  });
}

export function escalationChain(assignments, userId) {
  const byUser = new Map();
  for (const a of assignments || []) {
    const uid = normalizeUserId(a.user_id);
    if (uid) byUser.set(uid, a);
  }
  const chain = [];
  let cur = byUser.get(normalizeUserId(userId));
  const seen = new Set();
  while (cur) {
    const curUid = normalizeUserId(cur.user_id);
    if (!curUid || seen.has(curUid)) break;
    seen.add(curUid);
    const escUid = normalizeUserId(cur.escalation_user_id);
    if (escUid) {
      const esc = byUser.get(escUid);
      if (esc) chain.push(esc);
    }
    const mid = cur.manager_uid || normalizeUserId(cur.manager_user_id);
    const mgr = mid ? byUser.get(mid) : null;
    if (mgr) chain.push(mgr);
    cur = mgr;
  }
  return chain.filter((x, i, arr) => arr.findIndex((y) => normalizeUserId(y.user_id) === normalizeUserId(x.user_id)) === i);
}
