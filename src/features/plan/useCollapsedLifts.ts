import { useCallback, useState } from 'react';
import { getCollapsedLifts, setCollapsedLifts } from '../../storage/uiPrefs';
import { usePhoneWidth } from '../layout/phoneWidth';

/**
 * Which lift cards are collapsed.
 * - Desktop: lifts are open unless the person collapsed them (remembered per device).
 * - Phone (< 768px): every lift starts minimized so the session fits on screen; lifts opened
 *   during this visit stay open until the page reloads (not saved).
 */
export function useCollapsedLifts() {
  const phone = usePhoneWidth();
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => getCollapsedLifts());
  const [phoneOpen, setPhoneOpen] = useState<Set<string>>(() => new Set());

  const setMany = useCallback((ids: readonly string[], value: boolean) => {
    if (phone) {
      setPhoneOpen((prev) => {
        const next = new Set<string>(prev);
        for (const id of ids) {
          if (value) next.delete(id);
          else next.add(id);
        }
        return next;
      });
      return;
    }
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
  }, [phone]);

  const setCollapsed = useCallback((id: string, value: boolean) => setMany([id], value), [setMany]);
  const isCollapsed = useCallback(
    (id: string) => (phone ? !phoneOpen.has(id) : collapsed.has(id)),
    [phone, phoneOpen, collapsed],
  );

  return { isCollapsed, setCollapsed, setMany };
}
