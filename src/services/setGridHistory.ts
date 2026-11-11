/**
 * Per-lift undo/redo for the set grid. Entries are whole-lift snapshots taken around each
 * local change. Undo only applies when the lift still looks like the snapshot it would
 * undo: if a coach edit or a sync merge changed it meanwhile, undo refuses instead of
 * overwriting someone else's work.
 */

export type GridHistory<T> = {
  undo: Array<{ before: T; after: T }>;
  redo: Array<{ before: T; after: T }>;
  limit: number;
};

export type HistoryStep<T> =
  | { status: 'empty' }
  | { status: 'conflict' }
  | { status: 'ok'; value: T };

export function createGridHistory<T>(limit = 50): GridHistory<T> {
  return { undo: [], redo: [], limit };
}

export function recordChange<T>(history: GridHistory<T>, before: T, after: T): void {
  history.undo.push({ before, after });
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo = [];
}

export function clearHistory<T>(history: GridHistory<T>): void {
  history.undo = [];
  history.redo = [];
}

export function stepUndo<T>(history: GridHistory<T>, current: T, same: (a: T, b: T) => boolean): HistoryStep<T> {
  const entry = history.undo.at(-1);
  if (!entry) return { status: 'empty' };
  if (!same(entry.after, current)) return { status: 'conflict' };
  history.undo.pop();
  history.redo.push(entry);
  return { status: 'ok', value: entry.before };
}

export function stepRedo<T>(history: GridHistory<T>, current: T, same: (a: T, b: T) => boolean): HistoryStep<T> {
  const entry = history.redo.at(-1);
  if (!entry) return { status: 'empty' };
  if (!same(entry.before, current)) return { status: 'conflict' };
  history.redo.pop();
  history.undo.push(entry);
  return { status: 'ok', value: entry.after };
}

const SET_FIELDS = [
  'id', 'scope', 'plannedWeight', 'plannedReps', 'plannedRpe', 'intensity_type', 'target_value',
  'dropPercent', 'actual', 'reps', 'executedRpe', 'isTop',
] as const;

/** Compare two set lists on the saved training fields only (ignores derived suggestions). */
export function sameSets(a: ReadonlyArray<Record<string, unknown>>, b: ReadonlyArray<Record<string, unknown>>): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, i) => {
    const right = b[i];
    return SET_FIELDS.every((field) => normalizeField(field, left[field]) === normalizeField(field, right[field]));
  });
}

/** A sync round-trip may turn `undefined` into 0 / false / null; treat those as equal. */
function normalizeField(field: (typeof SET_FIELDS)[number], value: unknown): unknown {
  if (field === 'isTop') return value === true;
  if (field === 'dropPercent') return Number(value ?? 0) || 0;
  if (field === 'scope') return value === 'plan' || value === 'log' ? value : 'both';
  if (field === 'intensity_type') return value ?? 'RPE';
  return value ?? null;
}
