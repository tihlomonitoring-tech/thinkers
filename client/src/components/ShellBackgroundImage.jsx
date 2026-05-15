import { useState, useCallback } from 'react';
import { SHELL_BG_SOURCES } from '../lib/shellBackground.js';

/**
 * Full-bleed background photo with automatic fallback when a source fails.
 */
export default function ShellBackgroundImage({ className = '', imageClassName = '' }) {
  const [srcIndex, setSrcIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);
  const lastIndex = SHELL_BG_SOURCES.length - 1;
  const src = SHELL_BG_SOURCES[Math.min(srcIndex, lastIndex)];

  const onError = useCallback(() => {
    setSrcIndex((i) => {
      if (i < lastIndex) return i + 1;
      setAllFailed(true);
      return i;
    });
  }, [lastIndex]);

  if (allFailed) {
    return (
      <div
        aria-hidden
        className={`${className || imageClassName} bg-gradient-to-br from-stone-950 via-amber-950/40 to-stone-900`}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      decoding="async"
      loading="eager"
      referrerPolicy="no-referrer"
      onError={onError}
      className={className || imageClassName}
    />
  );
}
