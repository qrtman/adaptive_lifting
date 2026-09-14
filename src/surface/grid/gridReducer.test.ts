import { describe, expect, it } from 'vitest';
import { validateCell } from './gridValidation';
import { cellKind, gridReducer, initialGridState } from './gridReducer';
import type { GridRow, GridState } from './gridTypes';

function setRow(id: string, extras: Partial<Extract<GridRow, { kind: 'set' }>['values']> = {}): GridRow {
  return {
    kind: 'set',
    exerciseId: 'e1',
    setId: id,
    setIndex: 0,
    values: {
      plannedWeight: 100,
      plannedReps: 5,
      plannedRpe: 8,
      actual: null,
      reps: null,
      executedRpe: null,
      note: '',
      e1rmServer: 117.65,
      e1rmPreview: 117.65,
      plannedPct: 85,
      suggestedWeight: null,
      ...extras,
    },
  };
}

function ready(role: 'coach' | 'athlete' = 'coach'): GridState {
  return gridReducer(initialGridState(), {
    type: 'hydrate',
    rows: [setRow('s1'), setRow('s2', { plannedWeight: null })],
    role,
    locked: false,
  });
}

describe('validation', () => {
  it('accepts empty, kg, integer reps, and 0.5 RPE', () => {
    expect(validateCell('plannedWeight', '')).toEqual({ ok: true, value: null });
    expect(validateCell('plannedWeight', '180')).toEqual({ ok: true, value: 180 });
    expect(validateCell('plannedReps', '5')).toEqual({ ok: true, value: 5 });
    expect(validateCell('plannedRpe', '8.5')).toEqual({ ok: true, value: 8.5 });
    expect(validateCell('plannedRpe', '5.5').ok).toBe(false);
    expect(validateCell('plannedRpe', '8.2').ok).toBe(false);
    expect(validateCell('reps', '-1').ok).toBe(false);
  });
});

describe('grid state machine', () => {
  it('coach lands on planned load; athlete on actual', () => {
    const coach = ready('coach');
    expect(coach.selection.focus).toEqual({ row: 0, col: 2 });
    const athlete = ready('athlete');
    expect(athlete.selection.focus).toEqual({ row: 0, col: 6 });
  });

  it('enter/commit/cancel/move', () => {
    let state = ready();
    state = gridReducer(state, { type: 'startEdit' });
    expect(cellKind(state, state.selection.focus, 's1', 'plannedWeight')).toBe('editing');
    state = gridReducer(state, { type: 'editBuffer', buffer: '180' });
    state = gridReducer(state, { type: 'commit', move: 'down' });
    expect(state.committed?.[0]).toMatchObject({ setId: 's1', field: 'plannedWeight', value: 180 });
    expect(state.selection.focus.row).toBe(1);
    expect(cellKind(state, { row: 0, col: 2 }, 's1', 'plannedWeight')).toBe('pending');

    state = gridReducer(state, { type: 'startEdit' });
    state = gridReducer(state, { type: 'editBuffer', buffer: '99' });
    state = gridReducer(state, { type: 'cancel' });
    expect(state.editing).toBeNull();
    const row = state.rows[1];
    if (row.kind !== 'set') throw new Error('expected set');
    expect(row.values.plannedWeight).toBeNull();
  });

  it('keeps invalid edit open', () => {
    let state = ready();
    state = gridReducer(state, { type: 'startEdit' });
    state = gridReducer(state, { type: 'editBuffer', buffer: '-4' });
    state = gridReducer(state, { type: 'commit', move: 'down' });
    expect(state.invalid?.reason).toMatch(/Load/);
    expect(state.editing).not.toBeNull();
  });

  it('range select, fill-down, copy/paste', () => {
    let state = ready();
    state = gridReducer(state, { type: 'select', pos: { row: 1, col: 2 }, extend: true });
    state = gridReducer(state, { type: 'fillDown' });
    const row = state.rows[1];
    if (row.kind !== 'set') throw new Error('expected set');
    expect(row.values.plannedWeight).toBe(100);

    state = gridReducer(state, { type: 'select', pos: { row: 0, col: 2 } });
    state = gridReducer(state, { type: 'copy' });
    expect(state.clipboard).toEqual([['100']]);
    state = gridReducer(state, { type: 'select', pos: { row: 1, col: 2 } });
    state = gridReducer(state, { type: 'paste', text: '190' });
    const pasted = state.rows[1];
    if (pasted.kind !== 'set') throw new Error('expected set');
    expect(pasted.values.plannedWeight).toBe(190);
  });

  it('delete clears actuals always and planned only for coach', () => {
    let coach = gridReducer(ready('coach'), { type: 'select', pos: { row: 0, col: 2 } });
    coach = gridReducer(coach, { type: 'delete' });
    const c0 = coach.rows[0];
    if (c0.kind !== 'set') throw new Error('expected set');
    expect(c0.values.plannedWeight).toBeNull();

    let athlete = gridReducer(ready('athlete'), { type: 'select', pos: { row: 0, col: 2 } });
    athlete = gridReducer(athlete, { type: 'delete' });
    const a0 = athlete.rows[0];
    if (a0.kind !== 'set') throw new Error('expected set');
    expect(a0.values.plannedWeight).toBe(100);

    athlete = gridReducer(athlete, { type: 'select', pos: { row: 0, col: 6 } });
    athlete = gridReducer(athlete, { type: 'typeStart', char: '1' });
    athlete = gridReducer(athlete, { type: 'editBuffer', buffer: '180' });
    athlete = gridReducer(athlete, { type: 'commit' });
    athlete = gridReducer(athlete, { type: 'delete' });
    const a1 = athlete.rows[0];
    if (a1.kind !== 'set') throw new Error('expected set');
    expect(a1.values.actual).toBeNull();
  });

  it('locked is read-only', () => {
    let state = gridReducer(ready(), { type: 'setLocked', locked: true });
    state = gridReducer(state, { type: 'startEdit' });
    expect(state.editing).toBeNull();
    expect(cellKind(state, { row: 0, col: 2 }, 's1', 'plannedWeight')).toBe('locked');
  });

  it('marks preview vs server e1RM on the row', () => {
    const state = ready();
    const row = state.rows[0];
    if (row.kind !== 'set') throw new Error('expected set');
    expect(row.values.e1rmServer).toBe(117.65);
    expect(row.values.e1rmPreview).toBe(117.65);
  });
});
