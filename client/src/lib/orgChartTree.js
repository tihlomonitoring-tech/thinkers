/**
 * Build reporting-line tree from org assignments.
 */

export function buildOrgTree(assignments) {
  const active = (assignments || []).filter((a) => a.is_active !== false);
  const byUser = new Map();
  for (const a of active) {
    if (!a.user_id) continue;
    byUser.set(String(a.user_id), { ...a, children: [] });
  }
  const roots = [];
  for (const a of byUser.values()) {
    const mid = a.manager_user_id ? String(a.manager_user_id) : null;
    if (mid && byUser.has(mid) && mid !== String(a.user_id)) {
      byUser.get(mid).children.push(a);
    } else {
      roots.push(a);
    }
  }
  const sortKids = (nodes) => {
    nodes.sort((x, y) => {
      const so = (x.sort_order || 0) - (y.sort_order || 0);
      if (so !== 0) return so;
      return String(x.display_name || '').localeCompare(String(y.display_name || ''));
    });
    for (const n of nodes) sortKids(n.children);
  };
  sortKids(roots);
  return roots;
}

export function flattenOrgTree(roots) {
  const out = [];
  function walk(n, depth) {
    out.push({ ...n, depth });
    for (const c of n.children || []) walk(c, depth + 1);
  }
  for (const r of roots || []) walk(r, 0);
  return out;
}

export function escalationChain(assignments, userId) {
  const byUser = new Map();
  for (const a of assignments || []) {
    if (a.user_id) byUser.set(String(a.user_id), a);
  }
  const chain = [];
  let cur = byUser.get(String(userId));
  const seen = new Set();
  while (cur && !seen.has(String(cur.user_id))) {
    seen.add(String(cur.user_id));
    if (cur.escalation_user_id) {
      const esc = byUser.get(String(cur.escalation_user_id));
      if (esc) chain.push(esc);
    }
    const mid = cur.manager_user_id ? byUser.get(String(cur.manager_user_id)) : null;
    if (mid) chain.push(mid);
    cur = mid;
  }
  return chain.filter((x, i, arr) => arr.findIndex((y) => y.user_id === x.user_id) === i);
}
