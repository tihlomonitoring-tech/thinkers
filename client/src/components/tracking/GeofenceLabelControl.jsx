import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'geofence.labelMode';
export const LABEL_MODES = ['all', 'loading', 'off'];

const MODE_META = {
  all: { short: 'Site names', menu: 'All site names', hint: 'Show every geofenced site' },
  loading: { short: 'Loading only', menu: 'Loading sites only', hint: 'Only origin / loading points' },
  off: { short: 'Names hidden', menu: 'Hide all names', hint: 'No labels on the map' },
};

function readMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LABEL_MODES.includes(v) ? v : 'all';
  } catch {
    return 'all';
  }
}

/** Shared, persisted preference for geofence name labels across maps/tabs. */
export function useGeofenceLabelMode() {
  const [mode, setMode] = useState(readMode);

  const update = useCallback((next) => {
    setMode((prev) => {
      const val = LABEL_MODES.includes(next) ? next : prev;
      try {
        localStorage.setItem(STORAGE_KEY, val);
      } catch {
        /* ignore persistence errors */
      }
      return val;
    });
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && LABEL_MODES.includes(e.newValue)) setMode(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [mode, update];
}

function TagIcon({ off }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7" cy="7" r="1.4" />
      {off && <path d="M3 3 21 21" />}
    </svg>
  );
}

/**
 * Advanced on-map control to show / filter / hide geofenced site name labels.
 * Compact pill button that opens a small menu; choice is persisted globally.
 */
export default function GeofenceLabelControl({ mode = 'all', onChange, count = null, className = '', menuPlacement = 'down' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const meta = MODE_META[mode] || MODE_META.all;
  const off = mode === 'off';

  return (
    <div ref={ref} className={`relative inline-block pointer-events-auto ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Show, filter or hide site names"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition-colors ${
          off
            ? 'bg-slate-900/85 text-slate-300 hover:bg-slate-900'
            : 'bg-sky-600/95 text-white hover:bg-sky-500'
        }`}
      >
        <TagIcon off={off} />
        <span>{meta.short}</span>
        {!off && count != null && (
          <span className="rounded-full bg-white/25 px-1.5 text-[10px] leading-4">{count}</span>
        )}
        <span className={`text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#1f232b]/97 p-1 shadow-2xl backdrop-blur ${
            menuPlacement === 'up' ? 'bottom-full mb-1.5' : 'mt-1.5'
          }`}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Site name labels
          </p>
          {LABEL_MODES.map((m) => {
            const mm = MODE_META[m];
            const active = m === mode;
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange?.(m);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-sky-500/15' : 'hover:bg-white/5'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-sky-400 bg-sky-500' : 'border-white/25'
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-white">{mm.menu}</span>
                  <span className="block text-[11px] text-slate-400">{mm.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
