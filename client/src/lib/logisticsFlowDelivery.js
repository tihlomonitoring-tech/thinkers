/**
 * Delivery-cycle tracking for logistics flow analytics.
 * A truck "delivery" opens on first sighting in an update column and should close
 * when it disappears from the next update (user confirms completed / not completed).
 * Reappearing after a closed completed delivery starts delivery #2.
 */

export function normReg(reg) {
  return String(reg || '').replace(/[\s\-_/]/g, '').toUpperCase();
}

export function deliveryCloseKey(reg, cycle) {
  return `${normReg(reg)}|${cycle}`;
}

/** @typedef {'completed'|'not_completed'} DeliveryStatus */

/**
 * @param {object} confirmations shift.confirmations
 * @returns {Record<string, { status: DeliveryStatus, lastUpdateId?: string, closedAt?: string, tons?: number }>}
 */
export function getClosedDeliveries(confirmations) {
  if (!confirmations || typeof confirmations !== 'object') return {};
  if (confirmations.closedDeliveries && typeof confirmations.closedDeliveries === 'object') {
    return confirmations.closedDeliveries;
  }
  return {};
}

/**
 * @param {Array<{ id: string, columnIndex?: number, rows?: object[], meta?: object }>} updates
 * @param {Record<string, object>} closedDeliveries
 */
export function buildDeliveryAnalytics(updates, closedDeliveries = {}) {
  const sorted = [...(updates || [])].sort(
    (a, b) => (a.columnIndex ?? 0) - (b.columnIndex ?? 0)
  );
  const latestUpdate = sorted[sorted.length - 1] || null;
  const latestId = latestUpdate?.id || null;
  const latestRegs = new Set();
  if (latestUpdate) {
    for (const r of latestUpdate.rows || []) {
      const reg = normReg(r.registration);
      if (reg) latestRegs.add(reg);
    }
  }

  /** @type {Map<string, { reg: string, cycle: number, startUpdateId: string, lastSeenUpdateId: string, lastRow: object, cells: Record<string, object> }>} */
  const openByKey = new Map();

  /** @type {Array<{ reg: string, cycle: number, lastUpdateId: string, missingFromUpdateId: string, lastRow: object, label: string }>} */
  const pendingConfirm = [];

  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    const regsNow = new Set();

    for (const r of u.rows || []) {
      const reg = normReg(r.registration);
      if (!reg) continue;
      regsNow.add(reg);

      const rowKey = `${reg}`;
      let st = openByKey.get(rowKey);
      const closeKey = deliveryCloseKey(reg, st?.cycle || 1);
      const wasClosed = !!closedDeliveries[closeKey];

      if (st && wasClosed) {
        st = {
          reg,
          cycle: st.cycle + 1,
          startUpdateId: u.id,
          lastSeenUpdateId: u.id,
          lastRow: r,
          cells: { [u.id]: r },
        };
        openByKey.set(rowKey, st);
      } else if (!st) {
        st = {
          reg,
          cycle: 1,
          startUpdateId: u.id,
          lastSeenUpdateId: u.id,
          lastRow: r,
          cells: { [u.id]: r },
        };
        openByKey.set(rowKey, st);
      } else {
        st.lastSeenUpdateId = u.id;
        st.lastRow = r;
        st.cells[u.id] = r;
      }
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const prevRegs = new Set();
      for (const r of prev.rows || []) {
        const reg = normReg(r.registration);
        if (reg) prevRegs.add(reg);
      }
      for (const reg of prevRegs) {
        if (regsNow.has(reg)) continue;
        const st = openByKey.get(reg);
        if (!st) continue;
        const closeKey = deliveryCloseKey(reg, st.cycle);
        if (closedDeliveries[closeKey]) continue;
        pendingConfirm.push({
          reg,
          cycle: st.cycle,
          lastUpdateId: prev.id,
          missingFromUpdateId: u.id,
          lastRow: st.lastRow,
          label: prev.label || `Update ${i}`,
          missingLabel: u.label || `Update ${i + 1}`,
        });
      }
    }
  }

  const visibleRows = [];
  const seenPending = new Set();

  for (const p of pendingConfirm) {
    const key = `${p.reg}|${p.cycle}`;
    if (seenPending.has(key)) continue;
    seenPending.add(key);
    const st = openByKey.get(p.reg);
    visibleRows.push({
      rowKey: key,
      registration: p.reg,
      cycle: p.cycle,
      contractor:
        p.lastRow?.suggestedContractor ||
        p.lastRow?.systemContractor ||
        p.lastRow?.entity ||
        '—',
      cells: st?.cells || { [p.lastUpdateId]: p.lastRow },
      latestStatus: p.lastRow?.displayStatus || p.lastRow?.status || '—',
      lastRow: p.lastRow,
      needsConfirmation: true,
      pendingMeta: p,
      isActive: false,
    });
  }

  for (const [reg, st] of openByKey) {
    const closeKey = deliveryCloseKey(reg, st.cycle);
    const isClosed = !!closedDeliveries[closeKey];
    const inLatest = latestId && latestRegs.has(reg);
    const isPending = pendingConfirm.some((p) => p.reg === reg && p.cycle === st.cycle);

    if (isPending) continue;
    if (isClosed && !inLatest) continue;

    if (inLatest || !isClosed) {
      visibleRows.push({
        rowKey: `${reg}|${st.cycle}`,
        registration: reg,
        cycle: st.cycle,
        contractor:
          st.lastRow?.suggestedContractor ||
          st.lastRow?.systemContractor ||
          st.lastRow?.entity ||
          '—',
        cells: st.cells,
        latestStatus: st.lastRow?.displayStatus || st.lastRow?.status || '—',
        lastRow: st.lastRow,
        needsConfirmation: false,
        pendingMeta: null,
        isActive: !!inLatest,
      });
    }
  }

  visibleRows.sort((a, b) => {
    if (a.needsConfirmation !== b.needsConfirmation) return a.needsConfirmation ? -1 : 1;
    return a.registration.localeCompare(b.registration) || a.cycle - b.cycle;
  });

  let deliveriesConfirmed = 0;
  let deliveriesNotCompleted = 0;
  for (const v of Object.values(closedDeliveries)) {
    if (v?.status === 'completed') deliveriesConfirmed += 1;
    else if (v?.status === 'not_completed') deliveriesNotCompleted += 1;
  }

  const pendingCount = pendingConfirm.length;
  const activeTruckCount = [...openByKey.values()].filter((st) => {
    const closeKey = deliveryCloseKey(st.reg, st.cycle);
    return latestRegs.has(st.reg) && !closedDeliveries[closeKey];
  }).length;

  let latestTons = 0;
  if (latestUpdate) {
    for (const r of latestUpdate.rows || []) {
      const t = Number(r.tons);
      if (Number.isFinite(t)) latestTons += t;
    }
  }

  let shiftTons = 0;
  for (const u of sorted) {
    for (const r of u.rows || []) {
      const t = Number(r.tons);
      if (Number.isFinite(t)) shiftTons += t;
    }
  }

  const deliveriesTotal = deliveriesConfirmed + deliveriesNotCompleted + pendingCount;

  return {
    sortedUpdates: sorted,
    latestUpdate,
    visibleRows,
    pendingConfirm,
    progress: {
      trucksInLatest: latestRegs.size,
      trucksActive: activeTruckCount,
      trucksPendingConfirm: pendingCount,
      trucksVisible: visibleRows.length,
      tonsLatestUpdate: Math.round(latestTons * 100) / 100,
      tonsAllUpdates: Math.round(shiftTons * 100) / 100,
      deliveriesConfirmed,
      deliveriesNotCompleted,
      deliveriesPending: pendingCount,
      deliveriesTotal: Math.max(deliveriesTotal, deliveriesConfirmed + deliveriesNotCompleted + pendingCount),
      updateCount: sorted.length,
    },
  };
}

/**
 * Merge closed delivery into confirmations blob (preserves legacy keys).
 */
export function withClosedDelivery(confirmations, reg, cycle, status, lastUpdateId, lastRow) {
  const base = { ...(confirmations || {}) };
  const closedDeliveries = { ...getClosedDeliveries(base) };
  const key = deliveryCloseKey(reg, cycle);
  closedDeliveries[key] = {
    status,
    lastUpdateId,
    closedAt: new Date().toISOString(),
    tons: lastRow?.tons != null ? Number(lastRow.tons) : undefined,
  };
  return { ...base, closedDeliveries };
}

/** Filter updates to a single route label/id (per-route analytics). */
export function filterUpdatesByRoute(updates, routeId, routeLabel) {
  if (!routeId && !routeLabel) return updates || [];
  const labelNorm = String(routeLabel || '').trim().toLowerCase();
  return (updates || []).filter((u) => {
    const meta = u.meta || {};
    const uRouteId = meta.route_id || meta.routeId;
    if (routeId && uRouteId && String(uRouteId) === String(routeId)) return true;
    const uRoute = String(meta.route || meta.routeLabel || '').trim().toLowerCase();
    if (labelNorm && uRoute && uRoute === labelNorm) return true;
    if (!uRouteId && !uRoute) return true;
    return false;
  });
}

export function normalizeRouteKey(routeId, routeLabel) {
  if (routeId) return `id:${routeId}`;
  const l = String(routeLabel || '').trim().toLowerCase();
  return l ? `label:${l}` : 'default';
}
