import { useState } from 'react';

export default function InfoHint({ title = 'How it works', text, bullets = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 shrink-0 rounded-full border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 text-xs font-semibold hover:bg-surface-100 dark:hover:bg-surface-800"
        aria-label={title}
        title={title}
      >
        i
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 p-3 max-w-2xl text-left">
          {text && <p className="text-sm text-surface-700 dark:text-surface-300">{text}</p>}
          {bullets.length > 0 && (
            <ul className="text-sm text-surface-700 dark:text-surface-300 space-y-1 list-disc ml-5 mt-2">
              {bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
