import { useEffect, useRef } from 'react';
import { cancelAutoHideNav, scheduleAutoHideNav } from './autoHideNav.js';

/**
 * After the user changes an in-page tab (and optional `ready` gate is true), starts a timer
 * to hide the main app sidebar only. Skips the first stable tab and programmatic corrections
 * while `ready` is false.
 *
 * @param {string} tabKey - Current tab/section id.
 * @param {{ ready?: boolean }} [options]
 */
export function useAutoHideNavAfterTabChange(tabKey, options = {}) {
  const { ready = true } = options;
  const wasReadyRef = useRef(false);
  const lastTabRef = useRef(null);

  useEffect(() => {
    if (!ready) {
      wasReadyRef.current = false;
      lastTabRef.current = null;
      cancelAutoHideNav();
      return;
    }
    if (!wasReadyRef.current) {
      wasReadyRef.current = true;
      lastTabRef.current = tabKey;
      return;
    }
    if (lastTabRef.current !== tabKey) {
      lastTabRef.current = tabKey;
      scheduleAutoHideNav();
    }
  }, [tabKey, ready]);

  useEffect(() => () => cancelAutoHideNav(), []);
}
