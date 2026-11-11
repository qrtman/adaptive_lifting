/**
 * One keyboard table for the whole session (session sheet phase 4).
 *
 * Every open lift grid marks its wrapper with `data-lift-grid-host="<liftId>"`. When an arrow
 * or Enter runs off the top or bottom of one lift, focus moves to the previous / next lift in
 * page order (same column, its last / first row). Collapsed lifts render no host and are skipped.
 */

export const GRID_ENTER_EVENT = 'al-grid-enter';
export type GridEnterDetail = { edge: 'first' | 'last'; col: number };

/** Returns true when another lift took the focus. */
export function handOffGrid(fromLiftId: string, direction: 'up' | 'down', col: number, root: ParentNode = document): boolean {
  const hosts = [...root.querySelectorAll<HTMLElement>('[data-lift-grid-host]')];
  const at = hosts.findIndex((host) => host.dataset.liftGridHost === fromLiftId);
  if (at < 0) return false;
  const target = hosts[direction === 'down' ? at + 1 : at - 1];
  if (!target) return false;
  const detail: GridEnterDetail = { edge: direction === 'down' ? 'first' : 'last', col };
  target.dispatchEvent(new CustomEvent<GridEnterDetail>(GRID_ENTER_EVENT, { detail }));
  return true;
}
