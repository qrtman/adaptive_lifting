import { useCallback, useState } from 'react';
import { getCollapsedLifts, setCollapsedLifts } from '../../storage/uiPrefs';

/** Which lift cards are collapsed. Lifts are open unless the person collapsed them (remembered per device). */
export function useCollapsedLifts() {
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => getCollapsedLifts());

  const setMany = useCallback((ids: readonly string[], value: boolean) => {
    setCollapsedState((prev) => {
      const next = new Set<string>(prev);
      for (const id of ids) {
        // Delete first so a re-collapsed id moves to the end (most recent survives the cap).
        next.delete(id);
        if (value) next.add(id);
      }
      setCollapsedLifts(next);
      return next;
    });
  }, []);

  const setCollapsed = useCallback((id: string, value: boolean) => setMany([id], value), [setMany]);
  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed]);

  return { isCollapsed, setCollapsed, setMany };
}
