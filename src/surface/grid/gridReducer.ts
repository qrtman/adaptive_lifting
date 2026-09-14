import { setPreviewMetrics } from '../../services/mathEngine';
import { trainingIntOrZero, trainingOrZero } from '../../services/numericTraining';
import { validateCell } from './gridValidation';
import {
  ACTUAL_COLS,
  EDITABLE_COLS,
  PLANNED_COLS,
  cellKey,
  defaultFocusCol,
  isEditableCol,
  visibleCols,
  type GridColKey,
  type GridCommit,
  type GridPos,
  type GridRole,
  type GridRow,
  type GridState,
  type SetValues,
} from './gridTypes';

export type GridAction =
  | { type: 'hydrate'; rows: GridRow[]; role: GridRole; locked: boolean; hiddenCols?: GridColKey[] }
  | { type: 'syncRows'; rows: GridRow[] }
  | { type: 'select'; pos: GridPos; extend?: boolean }
  | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; extend?: boolean }
  | { type: 'startEdit' }
  | { type: 'typeStart'; char: string }
  | { type: 'editBuffer'; buffer: string }
  | { type: 'commit'; move?: 'down' | 'right' | 'up' | 'left' | null }
  | { type: 'cancel' }
  | { type: 'delete' }
  | { type: 'fillDown' }
  | { type: 'copy' }
  | { type: 'paste'; text: string }
  | { type: 'markPending'; keys: string[] }
  | { type: 'clearPending'; keys: string[] }
  | { type: 'setLocked'; locked: boolean }
  | { type: 'setHiddenCols'; cols: GridColKey[] }
  | { type: 'clearCommitted' };

function clampPos(state: GridState, pos: GridPos): GridPos {
  const cols = visibleCols(state.hiddenCols);
  const maxRow = Math.max(0, state.rows.length - 1);
  const maxCol = Math.max(0, cols.length - 1);
  return {
    row: Math.min(Math.max(0, pos.row), maxRow),
    col: Math.min(Math.max(0, pos.col), maxCol),
  };
}

function firstSetPos(rows: GridRow[], hidden: GridColKey[], role: GridRole): GridPos {
  const cols = visibleCols(hidden);
  const col = Math.max(0, cols.indexOf(defaultFocusCol(role)));
  const row = Math.max(0, rows.findIndex((item) => item.kind === 'set'));
  return { row, col };
}

function rowRange(a: GridPos, b: GridPos): number[] {
  const start = Math.min(a.row, b.row);
  const end = Math.max(a.row, b.row);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function colRange(a: GridPos, b: GridPos): number[] {
  const start = Math.min(a.col, b.col);
  const end = Math.max(a.col, b.col);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function colAt(state: GridState, col: number): GridColKey {
  return visibleCols(state.hiddenCols)[col];
}

function setRowAt(rows: GridRow[], index: number): Extract<GridRow, { kind: 'set' }> | null {
  const row = rows[index];
  return row && row.kind === 'set' ? row : null;
}

function valueFor(values: SetValues, col: GridColKey): string {
  if (col === 'note') return values.note;
  if (col === 'e1rm') {
    const n = values.e1rmServer ?? values.e1rmPreview;
    return n == null ? '' : String(n);
  }
  if (col === 'plannedPct') return values.plannedPct == null ? '' : String(values.plannedPct);
  const map: Record<string, number | null> = {
    plannedWeight: values.plannedWeight,
    plannedReps: values.plannedReps,
    plannedRpe: values.plannedRpe,
    actual: values.actual,
    reps: values.reps,
    executedRpe: values.executedRpe,
  };
  const n = map[col];
  return n == null ? '' : String(n);
}

function applyField(values: SetValues, col: GridColKey, value: number | string | null): SetValues {
  const next = { ...values };
  if (col === 'note') next.note = typeof value === 'string' ? value : '';
  else if (col === 'plannedWeight') next.plannedWeight = typeof value === 'number' ? value : null;
  else if (col === 'plannedReps') next.plannedReps = typeof value === 'number' ? value : null;
  else if (col === 'plannedRpe') next.plannedRpe = typeof value === 'number' ? value : null;
  else if (col === 'actual') next.actual = typeof value === 'number' ? value : null;
  else if (col === 'reps') next.reps = typeof value === 'number' ? value : null;
  else if (col === 'executedRpe') next.executedRpe = typeof value === 'number' ? value : null;
  const wt = trainingOrZero(next.actual ?? next.plannedWeight);
  const rp = trainingIntOrZero(next.reps ?? next.plannedReps);
  const rpe = trainingOrZero(next.executedRpe ?? next.plannedRpe);
  if (wt > 0 && rp > 0) {
    const preview = setPreviewMetrics(wt, rp, rpe);
    next.e1rmPreview = preview.e1rm;
    next.plannedPct = next.plannedWeight && preview.e1rm
      ? Math.round((next.plannedWeight / preview.e1rm) * 10000) / 100
      : null;
  }
  return next;
}

function patchRows(state: GridState, commits: GridCommit[]): GridRow[] {
  return state.rows.map((row) => {
    if (row.kind !== 'set') return row;
    const hits = commits.filter((c) => c.setId === row.setId);
    if (!hits.length) return row;
    let values = row.values;
    for (const hit of hits) values = applyField(values, hit.field, hit.value);
    return { ...row, values };
  });
}

function shift(pos: GridPos, dir: 'up' | 'down' | 'left' | 'right', state: GridState): GridPos {
  const delta = dir === 'up' ? { row: -1, col: 0 }
    : dir === 'down' ? { row: 1, col: 0 }
      : dir === 'left' ? { row: 0, col: -1 }
        : { row: 0, col: 1 };
  return clampPos(state, { row: pos.row + delta.row, col: pos.col + delta.col });
}

export function initialGridState(): GridState {
  return {
    rows: [],
    hiddenCols: [],
    role: 'coach',
    locked: false,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    editing: null,
    invalid: null,
    pending: {},
    clipboard: null,
    committed: null,
  };
}

export function gridReducer(state: GridState, action: GridAction): GridState {
  switch (action.type) {
    case 'hydrate': {
      const focus = firstSetPos(action.rows, action.hiddenCols ?? state.hiddenCols, action.role);
      return {
        ...state,
        rows: action.rows,
        role: action.role,
        locked: action.locked,
        hiddenCols: action.hiddenCols ?? state.hiddenCols,
        selection: { anchor: focus, focus },
        editing: null,
        invalid: null,
        committed: null,
      };
    }
    case 'syncRows': {
      const pending = { ...state.pending };
      const rows = action.rows.map((row) => {
        if (row.kind !== 'set') return row;
        const local = state.rows.find((item) => item.kind === 'set' && item.setId === row.setId);
        if (!local || local.kind !== 'set') return row;
        let values = row.values;
        for (const col of EDITABLE_COLS) {
          const key = cellKey(row.setId, col);
          if (!pending[key]) continue;
          if (valueFor(row.values, col) === valueFor(local.values, col)) {
            delete pending[key];
          } else {
            const kept = col === 'note'
              ? local.values.note
              : col === 'plannedWeight' ? local.values.plannedWeight
                : col === 'plannedReps' ? local.values.plannedReps
                  : col === 'plannedRpe' ? local.values.plannedRpe
                    : col === 'actual' ? local.values.actual
                      : col === 'reps' ? local.values.reps
                        : col === 'executedRpe' ? local.values.executedRpe
                          : null;
            values = applyField(values, col, kept);
          }
        }
        return values === row.values ? row : { ...row, values };
      });
      return { ...state, rows, pending };
    }
    case 'setLocked':
      return { ...state, locked: action.locked, editing: action.locked ? null : state.editing };
    case 'setHiddenCols':
      return { ...state, hiddenCols: action.cols, editing: null };
    case 'clearCommitted':
      return { ...state, committed: null };
    case 'select': {
      if (state.locked) return state;
      const pos = clampPos(state, action.pos);
      return {
        ...state,
        selection: action.extend ? { ...state.selection, focus: pos } : { anchor: pos, focus: pos },
        editing: null,
        invalid: null,
        committed: null,
      };
    }
    case 'move': {
      const next = shift(state.selection.focus, action.dir, state);
      return gridReducer(state, { type: 'select', pos: next, extend: action.extend });
    }
    case 'startEdit': {
      if (state.locked) return state;
      const col = colAt(state, state.selection.focus.col);
      const row = setRowAt(state.rows, state.selection.focus.row);
      if (!row || !isEditableCol(col)) return state;
      return {
        ...state,
        editing: { pos: state.selection.focus, buffer: valueFor(row.values, col) },
        invalid: null,
        committed: null,
      };
    }
    case 'typeStart': {
      if (state.locked) return state;
      const col = colAt(state, state.selection.focus.col);
      const row = setRowAt(state.rows, state.selection.focus.row);
      if (!row || !isEditableCol(col)) return state;
      return {
        ...state,
        editing: { pos: state.selection.focus, buffer: action.char },
        invalid: null,
        committed: null,
      };
    }
    case 'editBuffer': {
      if (state.locked) return state;
      if (state.editing) {
        return { ...state, editing: { ...state.editing, buffer: action.buffer }, invalid: null };
      }
      const col = colAt(state, state.selection.focus.col);
      const row = setRowAt(state.rows, state.selection.focus.row);
      if (!row || !isEditableCol(col)) return state;
      return {
        ...state,
        editing: { pos: state.selection.focus, buffer: action.buffer },
        invalid: null,
        committed: null,
      };
    }
    case 'cancel':
      return { ...state, editing: null, invalid: null, committed: null };
    case 'commit': {
      if (state.locked || !state.editing) return state;
      const col = colAt(state, state.editing.pos.col);
      const row = setRowAt(state.rows, state.editing.pos.row);
      if (!row || !isEditableCol(col)) return { ...state, editing: null };
      const parsed = validateCell(col, state.editing.buffer);
      if (parsed.ok === false) {
        return { ...state, invalid: { pos: state.editing.pos, reason: parsed.reason } };
      }
      const commit: GridCommit = {
        exerciseId: row.exerciseId,
        setId: row.setId,
        field: col,
        value: parsed.value,
      };
      const nextRows = patchRows(state, [commit]);
      const moved = action.move ? shift(state.editing.pos, action.move, { ...state, rows: nextRows }) : state.editing.pos;
      return {
        ...state,
        rows: nextRows,
        editing: null,
        invalid: null,
        selection: { anchor: moved, focus: moved },
        committed: [commit],
        pending: { ...state.pending, [cellKey(row.setId, col)]: true },
      };
    }
    case 'delete': {
      if (state.locked) return state;
      const rowsIdx = rowRange(state.selection.anchor, state.selection.focus);
      const colsIdx = colRange(state.selection.anchor, state.selection.focus);
      const commits: GridCommit[] = [];
      for (const r of rowsIdx) {
        const row = setRowAt(state.rows, r);
        if (!row) continue;
        for (const c of colsIdx) {
          const col = colAt(state, c);
          const planned = (PLANNED_COLS as readonly string[]).includes(col);
          const actual = (ACTUAL_COLS as readonly string[]).includes(col);
          if (actual || col === 'note') {
            commits.push({ exerciseId: row.exerciseId, setId: row.setId, field: col, value: col === 'note' ? '' : null });
          } else if (planned && state.role === 'coach') {
            commits.push({ exerciseId: row.exerciseId, setId: row.setId, field: col, value: null });
          }
        }
      }
      if (!commits.length) return state;
      const pending = { ...state.pending };
      for (const commit of commits) pending[cellKey(commit.setId, commit.field)] = true;
      return {
        ...state,
        rows: patchRows(state, commits),
        committed: commits,
        pending,
        editing: null,
      };
    }
    case 'fillDown': {
      if (state.locked) return state;
      const rowsIdx = rowRange(state.selection.anchor, state.selection.focus);
      const colsIdx = colRange(state.selection.anchor, state.selection.focus);
      const top = Math.min(...rowsIdx);
      const commits: GridCommit[] = [];
      for (const c of colsIdx) {
        const col = colAt(state, c);
        if (!isEditableCol(col)) continue;
        const source = setRowAt(state.rows, top);
        if (!source) continue;
        const raw = valueFor(source.values, col);
        const parsed = validateCell(col, raw);
        if (!parsed.ok) continue;
        for (const r of rowsIdx) {
          if (r === top) continue;
          const row = setRowAt(state.rows, r);
          if (!row) continue;
          commits.push({ exerciseId: row.exerciseId, setId: row.setId, field: col, value: parsed.value });
        }
      }
      const pending = { ...state.pending };
      for (const commit of commits) pending[cellKey(commit.setId, commit.field)] = true;
      return { ...state, rows: patchRows(state, commits), committed: commits, pending, editing: null };
    }
    case 'copy': {
      const rowsIdx = rowRange(state.selection.anchor, state.selection.focus);
      const colsIdx = colRange(state.selection.anchor, state.selection.focus);
      const table = rowsIdx.map((r) => {
        const row = setRowAt(state.rows, r);
        return colsIdx.map((c) => (row ? valueFor(row.values, colAt(state, c)) : ''));
      });
      return { ...state, clipboard: table, committed: null };
    }
    case 'paste': {
      if (state.locked) return state;
      const table = action.text.split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split('\t'));
      const start = state.selection.focus;
      const commits: GridCommit[] = [];
      table.forEach((line, ri) => {
        line.forEach((cell, ci) => {
          const pos = clampPos(state, { row: start.row + ri, col: start.col + ci });
          const col = colAt(state, pos.col);
          const row = setRowAt(state.rows, pos.row);
          if (!row || !isEditableCol(col)) return;
          const parsed = validateCell(col, cell);
          if (!parsed.ok) return;
          commits.push({ exerciseId: row.exerciseId, setId: row.setId, field: col, value: parsed.value });
        });
      });
      const pending = { ...state.pending };
      for (const commit of commits) pending[cellKey(commit.setId, commit.field)] = true;
      return { ...state, rows: patchRows(state, commits), committed: commits, pending, clipboard: table, editing: null };
    }
    case 'markPending': {
      const pending = { ...state.pending };
      for (const key of action.keys) pending[key] = true;
      return { ...state, pending };
    }
    case 'clearPending': {
      const pending = { ...state.pending };
      for (const key of action.keys) delete pending[key];
      return { ...state, pending };
    }
    default:
      return state;
  }
}

function parseCellKey(key: string): { setId: string; col: GridColKey } | null {
  const idx = key.lastIndexOf(':');
  if (idx < 0) return null;
  return { setId: key.slice(0, idx), col: key.slice(idx + 1) as GridColKey };
}

export function cellKind(state: GridState, pos: GridPos, setId: string, col: GridColKey): import('./gridTypes').CellKind {
  if (state.locked) return 'locked';
  if (state.invalid && state.invalid.pos.row === pos.row && state.invalid.pos.col === pos.col) return 'invalid';
  if (state.editing && state.editing.pos.row === pos.row && state.editing.pos.col === pos.col) return 'editing';
  if (state.pending[cellKey(setId, col)]) return 'pending';
  const inRange = rowRange(state.selection.anchor, state.selection.focus).includes(pos.row)
    && colRange(state.selection.anchor, state.selection.focus).includes(pos.col);
  if (inRange) return 'selected';
  return 'idle';
}

export function tsvFromClipboard(table: string[][] | null): string {
  if (!table) return '';
  return table.map((row) => row.join('\t')).join('\n');
}
