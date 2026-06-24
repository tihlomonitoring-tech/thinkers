/** Tracks open shift-report compose/edit surfaces so auth can use a longer inactivity timeout. */
let activeCount = 0;
const listeners = new Set();

export function setShiftReportComposeActive(active) {
  if (active) activeCount += 1;
  else activeCount = Math.max(0, activeCount - 1);
  const on = activeCount > 0;
  listeners.forEach((fn) => {
    try {
      fn(on);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeShiftReportComposeActive(fn) {
  listeners.add(fn);
  fn(activeCount > 0);
  return () => listeners.delete(fn);
}

export function isShiftReportComposeActive() {
  return activeCount > 0;
}
