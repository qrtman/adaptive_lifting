/** Pure PLAN/LOG set-grid keyboard reducer. Sheets-parity subset — no grid library. */

export type CellMode = 'selected' | 'editing';

export type GridMove = 'left' | 'right' | 'up' | 'down' | 'rowStart' | 'rowEnd';
export type NeighborDir = GridMove;

export type Axis = 'plan' | 'log';
export type Field = 'adjust' | 'kg' | 'reps' | 'rpe';
export type MoveKind = 'arrow' | 'tab' | 'enter';

export type Address = { liftId: string; row: number; axis: Axis; field: Field };

export type CellKeyState = {
  mode: CellMode;
  composing: boolean;
  caretAtStart?: boolean;
  caretAtEnd?: boolean;
};

export type CellKeyEventLike = {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
};

export type CellKeyEffect =
  | { type: 'none' }
  | { type: 'ignore' }
  | { type: 'move'; direction: GridMove; kind: MoveKind; preventDefault: true }
  | { type: 'beginEdit'; overwrite: boolean; draft?: string; preventDefault: true }
  | { type: 'clear'; preventDefault: true }
  | { type: 'commit'; move: GridMove; kind: MoveKind; preventDefault: true }
  | { type: 'cancel'; preventDefault: true }
  | { type: 'caret' }
  | { type: 'copy'; preventDefault: true }
  | { type: 'paste'; preventDefault: true }
  | { type: 'noop'; preventDefault: true };

export const GRID_COL_COUNT = 7;

export const COLS: ReadonlyArray<{ axis: Axis; field: Field }> = [
  { axis: 'plan', field: 'adjust' },
  { axis: 'plan', field: 'kg' },
  { axis: 'plan', field: 'reps' },
  { axis: 'plan', field: 'rpe' },
  { axis: 'log', field: 'kg' },
  { axis: 'log', field: 'reps' },
  { axis: 'log', field: 'rpe' },
];

/** @deprecated alias — COLS is canonical */
export const GRID_COLUMNS = COLS;

export type SetGridBind = {
  cellId: string;
  row: number;
  col: number;
  isActive: boolean;
  mode: CellMode;
  editOverwrite: boolean;
  editSeed?: string;
  tabStop: boolean;
  onSelect: (row: number, col: number) => void;
  onBeginEdit: (row: number, col: number, overwrite: boolean, seed?: string) => void;
  onCommit: (row: number, col: number, value: string, move?: GridMove, kind?: MoveKind) => void;
  onCancel: (row: number, col: number) => void;
  onMove: (row: number, col: number, direction: GridMove, kind: MoveKind) => void;
};

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function isPrintableKey(event: CellKeyEventLike): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  const { key } = event;
  if (key.length !== 1) return false;
  return key >= ' ';
}

export function colOf(address: Address): number {
  return COLS.findIndex((entry) => entry.axis === address.axis && entry.field === address.field);
}

export function addressAt(liftId: string, row: number, col: number): Address {
  const spec = COLS[col];
  return { liftId, row, axis: spec.axis, field: spec.field };
}

export const addressFrom = addressAt;

export function makeCellId(liftId: string, row: number, col: number): string {
  const spec = COLS[col];
  return `${liftId}:${row}:${spec.axis}:${spec.field}`;
}

export function cellIdOf(address: Address): string {
  return `${address.liftId}:${address.row}:${address.axis}:${address.field}`;
}

export function parseCellId(cellId: string): (Address & { col: number }) | null {
  const parts = cellId.split(':');
  if (parts.length < 4) return null;
  const field = parts[parts.length - 1] as Field;
  const axis = parts[parts.length - 2] as Axis;
  const row = Number(parts[parts.length - 3]);
  const liftId = parts.slice(0, -3).join(':');
  const col = COLS.findIndex((entry) => entry.axis === axis && entry.field === field);
  if (!liftId || !Number.isInteger(row) || row < 0 || col < 0) return null;
  if (axis !== 'plan' && axis !== 'log') return null;
  if (field !== 'adjust' && field !== 'kg' && field !== 'reps' && field !== 'rpe') return null;
  return { liftId, row, axis, field, col };
}

/**
 * Total: always returns an address. Never null. Never creates a set. Never leaves the lift.
 * Tab wraps within the 7-col table; arrows and Enter clamp at the edge.
 */
export function neighbor(
  address: Address,
  dir: GridMove,
  kind: MoveKind,
  rowCount: number,
): Address {
  const col = colOf(address);
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = GRID_COL_COUNT - 1;
  let row = Math.min(Math.max(0, address.row), lastRow);
  let nextCol = col < 0 ? 0 : col;

  switch (dir) {
    case 'left':
      if (nextCol > 0) {
        nextCol -= 1;
      } else if (kind === 'tab' && row > 0) {
        row -= 1;
        nextCol = lastCol;
      }
      break;
    case 'right':
      if (nextCol < lastCol) {
        nextCol += 1;
      } else if (kind === 'tab' && row < lastRow) {
        row += 1;
        nextCol = 0;
      }
      break;
    case 'up':
      if (row > 0) row -= 1;
      break;
    case 'down':
      if (row < lastRow) row += 1;
      break;
    case 'rowStart':
      nextCol = 0;
      break;
    case 'rowEnd':
      nextCol = lastCol;
      break;
    default: {
      const _exhaustive: never = dir;
      return _exhaustive;
    }
  }

  return addressAt(address.liftId, row, nextCol);
}

export function moveGridAddress(
  row: number,
  col: number,
  direction: GridMove,
  rowCount: number,
  kind: MoveKind,
): { row: number; col: number } {
  const next = neighbor(addressAt('_', row, col), direction, kind, rowCount);
  return { row: next.row, col: colOf(next) };
}

function normalizeKey(key: string): string {
  return key === 'NumpadEnter' ? 'Enter' : key;
}

export function reduceCellKey(state: CellKeyState, event: CellKeyEventLike): CellKeyEffect {
  const composing = state.composing || !!event.isComposing || event.key === 'Process';
  const key = normalizeKey(event.key);
  const shift = !!event.shiftKey;
  const ctrl = !!event.ctrlKey || !!event.metaKey;

  if (composing) {
    if (event.key === 'Process' || ARROWS.has(key) || key === 'Enter' || key === 'Tab' || key === 'Escape') {
      return { type: 'ignore' };
    }
  }

  if (state.mode === 'selected') {
    if (ctrl && (key === 'c' || key === 'C')) {
      return { type: 'copy', preventDefault: true };
    }
    if (ctrl && (key === 'v' || key === 'V')) {
      return { type: 'paste', preventDefault: true };
    }
    if (key === 'ArrowLeft') {
      return { type: 'move', direction: 'left', kind: 'arrow', preventDefault: true };
    }
    if (key === 'ArrowRight') {
      return { type: 'move', direction: 'right', kind: 'arrow', preventDefault: true };
    }
    if (key === 'ArrowUp') {
      return { type: 'move', direction: 'up', kind: 'arrow', preventDefault: true };
    }
    if (key === 'ArrowDown') {
      return { type: 'move', direction: 'down', kind: 'arrow', preventDefault: true };
    }
    if (key === 'Tab') {
      return { type: 'move', direction: shift ? 'left' : 'right', kind: 'tab', preventDefault: true };
    }
    if (key === 'Home') {
      return { type: 'move', direction: 'rowStart', kind: 'arrow', preventDefault: true };
    }
    if (key === 'End') {
      return { type: 'move', direction: 'rowEnd', kind: 'arrow', preventDefault: true };
    }
    if (key === 'Enter' || key === 'F2') {
      return { type: 'beginEdit', overwrite: false, preventDefault: true };
    }
    if (key === 'Backspace' || key === 'Delete') {
      return { type: 'clear', preventDefault: true };
    }
    if (isPrintableKey({ ...event, key })) {
      return { type: 'beginEdit', overwrite: true, draft: key, preventDefault: true };
    }
    return { type: 'none' };
  }

  if (key === 'Escape') return { type: 'cancel', preventDefault: true };
  if (key === 'Enter') {
    return { type: 'commit', move: shift ? 'up' : 'down', kind: 'enter', preventDefault: true };
  }
  if (key === 'Tab') {
    return { type: 'commit', move: shift ? 'left' : 'right', kind: 'tab', preventDefault: true };
  }
  if (ARROWS.has(key) || key === 'Home' || key === 'End') {
    return { type: 'caret' };
  }
  if (key === 'F2') return { type: 'noop', preventDefault: true };
  return { type: 'none' };
}
