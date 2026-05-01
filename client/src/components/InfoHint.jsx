import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

function InfoIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Compact info control: full explanation on click. `text` may be a string or React node. Popover portals to document.body to avoid clipping in scroll areas. */
export default function InfoHint({ title = 'Details', text, bullets = [], className = '' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 320 });

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    let left = r.left;
    if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
    if (left < 12) left = 12;
    let top = r.bottom + 8;
    const estH = 200;
    if (top + estH > window.innerHeight - 12) top = Math.max(12, r.top - estH - 8);
    setCoords({ top, left, width: w });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        const el = e.target;
        if (el && el.closest && el.closest('[data-infohint-popover]')) return;
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const popover =
    open &&
    createPortal(
      <div
        data-infohint-popover
        className="fixed z-[100] rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 shadow-xl p-3 text-left"
        style={{ top: coords.top, left: coords.left, width: coords.width }}
      >
        {text && <div className="text-sm text-surface-700 dark:text-surface-300 leading-snug">{text}</div>}
        {bullets.length > 0 && (
          <ul className="text-sm text-surface-700 dark:text-surface-300 space-y-1 list-disc ml-4 mt-2">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>,
      document.body
    );

  return (
    <div className={`relative inline-flex align-middle ${className}`} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-full border border-surface-300/90 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        aria-expanded={open}
        aria-label={title}
        title={title}
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      {popover}
    </div>
  );
}
