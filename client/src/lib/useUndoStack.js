import { useCallback, useRef, useState } from 'react';

/** Simple undo stack for map draw / edit state. */
export function useUndoStack(initialValue) {
  const [value, setValue] = useState(initialValue);
  const pastRef = useRef([]);
  const futureRef = useRef([]);

  const commit = useCallback((nextOrFn) => {
    setValue((current) => {
      const next = typeof nextOrFn === 'function' ? nextOrFn(current) : nextOrFn;
      pastRef.current = [...pastRef.current, current].slice(-40);
      futureRef.current = [];
      return next;
    });
  }, []);

  const replace = useCallback((next) => {
    setValue(next);
  }, []);

  const undo = useCallback(() => {
    let restored = false;
    setValue((current) => {
      if (!pastRef.current.length) return current;
      futureRef.current = [current, ...futureRef.current];
      const prev = pastRef.current[pastRef.current.length - 1];
      pastRef.current = pastRef.current.slice(0, -1);
      restored = true;
      return prev;
    });
    return restored;
  }, []);

  const redo = useCallback(() => {
    let restored = false;
    setValue((current) => {
      if (!futureRef.current.length) return current;
      pastRef.current = [...pastRef.current, current];
      const next = futureRef.current[0];
      futureRef.current = futureRef.current.slice(1);
      restored = true;
      return next;
    });
    return restored;
  }, []);

  const reset = useCallback((next = initialValue) => {
    pastRef.current = [];
    futureRef.current = [];
    setValue(next);
  }, [initialValue]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return { value, commit, replace, undo, redo, reset, canUndo, canRedo };
}

export function cloneRing(ring) {
  return ring?.map((p) => ({ lat: p.lat, lng: p.lng })) ?? null;
}
