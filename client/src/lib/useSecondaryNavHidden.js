import { useState, useEffect } from 'react';

const STORAGE_PREFIX = 'thinkers-secondary-nav-hidden-';

/**
 * Persisted state for hiding the secondary (in-page) nav so content can use full width.
 * @param {string} storageKey - Unique key per page (e.g. 'access-mgmt', 'contractor', 'rector').
 * @returns {[boolean, (value: boolean) => void]}
 */
export function useSecondaryNavHidden(storageKey) {
  const [hidden, setHidden] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PREFIX + storageKey) ?? 'false');
    } catch {
      return false;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(hidden));
  }, [hidden, storageKey]);

  return [hidden, setHidden];
}
