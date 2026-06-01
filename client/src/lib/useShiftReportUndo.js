import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_UNDO = 50;

function cloneSnapshot(snapshot) {
  if (!snapshot) return null;
  try {
    return JSON.parse(JSON.stringify(snapshot));
  } catch {
    return snapshot;
  }
}

function snapshotsEqual(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Undo stack for shift report compose forms.
 * Snapshots should be captured immediately before destructive edits (remove row, import, etc.).
 */
export function useShiftReportUndo({ enabled = true, onRestore, onUndone }) {
  const stackRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const onRestoreRef = useRef(onRestore);
  const onUndoneRef = useRef(onUndone);
  onRestoreRef.current = onRestore;
  onUndoneRef.current = onUndone;

  const syncCanUndo = useCallback(() => {
    setCanUndo(stackRef.current.length > 0);
  }, []);

  const pushUndo = useCallback(
    (snapshot) => {
      if (!enabled || !snapshot) return;
      const cloned = cloneSnapshot(snapshot);
      const stack = stackRef.current;
      if (stack.length && snapshotsEqual(stack[stack.length - 1], cloned)) return;
      stackRef.current = [...stack.slice(-(MAX_UNDO - 1)), cloned];
      syncCanUndo();
    },
    [enabled, syncCanUndo]
  );

  const undo = useCallback(() => {
    const stack = stackRef.current;
    if (!stack.length) return false;
    const prev = cloneSnapshot(stack[stack.length - 1]);
    stackRef.current = stack.slice(0, -1);
    syncCanUndo();
    onRestoreRef.current?.(prev);
    onUndoneRef.current?.();
    return true;
  }, [syncCanUndo]);

  const clearUndo = useCallback(() => {
    stackRef.current = [];
    syncCanUndo();
  }, [syncCanUndo]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      if (!stackRef.current.length) return;
      e.preventDefault();
      e.stopPropagation();
      undo();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, undo]);

  return { pushUndo, undo, canUndo, clearUndo };
}
