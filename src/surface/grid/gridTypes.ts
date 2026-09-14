export const GRID_COLUMNS = [
  'exercise',
  'set',
  'plannedWeight',
  'plannedReps',
  'plannedRpe',
  'plannedPct',
  'actual',
  'reps',
  'executedRpe',
  'e1rm',
  'note',
] as const;

export type GridColKey = (typeof GRID_COLUMNS)[number];

export const EDITABLE_COLS: readonly GridColKey[] = [
  'plannedWeight',
  'plannedReps',
  'plannedRpe',
  'actual',
  'reps',
  'executedRpe',
  'note',
];

export const PLANNED_COLS: readonly GridColKey[] = ['plannedWeight', 'plannedReps', 'plannedRpe'];
export const ACTUAL_COLS: readonly GridColKey[] = ['actual', 'reps', 'executedRpe'];
export const NUMERIC_COLS: readonly GridColKey[] = [
  'plannedWeight',
  'plannedReps',
  'plannedRpe',
  'plannedPct',
  'actual',
  'reps',
  'executedRpe',
  'e1rm',
];

export type GridRole = 'coach' | 'athlete';

export type CellKind = 'idle' | 'selected' | 'editing' | 'pending' | 'locked' | 'invalid';

export type GridPos = { row: number; col: number };

export type SetValues = {
  plannedWeight: number | null;
  plannedReps: number | null;
  plannedRpe: number | null;
  actual: number | null;
  reps: number | null;
  executedRpe: number | null;
  note: string;
  e1rmServer: number | null;
  e1rmPreview: number | null;
  plannedPct: number | null;
  suggestedWeight: number | null;
};

export type GridRow =
  | {
      kind: 'header';
      exerciseId: string;
      title: string;
      variation: string;
      movementPattern: string;
      setCount: number;
    }
  | {
      kind: 'set';
      exerciseId: string;
      exerciseTitle: string;
      setId: string;
      setIndex: number;
      values: SetValues;
    };

export type GridCommit = {
  exerciseId: string;
  setId: string;
  field: GridColKey;
  value: number | string | null;
};

export type GridState = {
  rows: GridRow[];
  hiddenCols: GridColKey[];
  role: GridRole;
  locked: boolean;
  selection: { anchor: GridPos; focus: GridPos };
  editing: { pos: GridPos; buffer: string } | null;
  invalid: { pos: GridPos; reason: string } | null;
  pending: Record<string, true>;
  clipboard: string[][] | null;
  committed: GridCommit[] | null;
};

export function cellKey(setId: string, col: GridColKey): string {
  return `${setId}:${col}`;
}

export function colIndex(key: GridColKey, hidden: GridColKey[]): number {
  return visibleCols(hidden).indexOf(key);
}

export function visibleCols(hidden: GridColKey[]): GridColKey[] {
  return GRID_COLUMNS.filter((col) => !hidden.includes(col));
}

export function defaultFocusCol(role: GridRole): GridColKey {
  return role === 'athlete' ? 'actual' : 'plannedWeight';
}

export function isEditableCol(col: GridColKey): boolean {
  return (EDITABLE_COLS as readonly string[]).includes(col);
}

export function posOf(
  rows: GridRow[],
  hidden: GridColKey[],
  setId: string,
  col: GridColKey,
): GridPos | null {
  const cols = visibleCols(hidden);
  const c = cols.indexOf(col);
  if (c < 0) return null;
  const r = rows.findIndex((row) => row.kind === 'set' && row.setId === setId);
  if (r < 0) return null;
  return { row: r, col: c };
}
