import { describe, expect, it } from 'vitest';
import {
  addressFrom,
  cellIdOf,
  colOf,
  makeCellId,
  neighbor,
  parseCellId,
  reduceCellKey,
  type Address,
  type CellKeyEventLike,
  type CellKeyState,
} from './sheetsCellKeyboard';

const selected: CellKeyState = { mode: 'selected', composing: false };
const editing: CellKeyState = { mode: 'editing', composing: false };
const editingAtEdge: CellKeyState = {
  mode: 'editing',
  composing: false,
  caretAtStart: true,
  caretAtEnd: true,
};

function key(partial: Partial<CellKeyEventLike> & { key: string }): CellKeyEventLike {
  return {
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...partial,
  };
}

const lift = (row: number, col: number): Address => addressFrom('e-1', row, col);

describe('reduceCellKey selected', () => {
  it('moves with arrows and stays selected', () => {
    expect(reduceCellKey(selected, key({ key: 'ArrowRight' }))).toEqual({
      type: 'move',
      direction: 'right',
      kind: 'arrow',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'ArrowLeft' }))).toEqual({
      type: 'move',
      direction: 'left',
      kind: 'arrow',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'ArrowUp' }))).toEqual({
      type: 'move',
      direction: 'up',
      kind: 'arrow',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'ArrowDown' }))).toEqual({
      type: 'move',
      direction: 'down',
      kind: 'arrow',
      preventDefault: true,
    });
  });

  it('Enter / F2 begin insert-edit (keep value, no move)', () => {
    expect(reduceCellKey(selected, key({ key: 'Enter' }))).toEqual({
      type: 'beginEdit',
      overwrite: false,
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'F2' }))).toEqual({
      type: 'beginEdit',
      overwrite: false,
      preventDefault: true,
    });
  });

  it('printable begins overwrite-edit with that character', () => {
    expect(reduceCellKey(selected, key({ key: '5' }))).toEqual({
      type: 'beginEdit',
      overwrite: true,
      draft: '5',
      preventDefault: true,
    });
  });

  it('Backspace / Delete clear', () => {
    expect(reduceCellKey(selected, key({ key: 'Backspace' }))).toEqual({
      type: 'clear',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'Delete' }))).toEqual({
      type: 'clear',
      preventDefault: true,
    });
  });

  it('Tab / Shift+Tab move with tab kind', () => {
    expect(reduceCellKey(selected, key({ key: 'Tab' }))).toEqual({
      type: 'move',
      direction: 'right',
      kind: 'tab',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'Tab', shiftKey: true }))).toEqual({
      type: 'move',
      direction: 'left',
      kind: 'tab',
      preventDefault: true,
    });
  });

  it('Ctrl/Cmd+C copies and Ctrl/Cmd+V pastes', () => {
    expect(reduceCellKey(selected, key({ key: 'c', ctrlKey: true }))).toEqual({
      type: 'copy',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'v', metaKey: true }))).toEqual({
      type: 'paste',
      preventDefault: true,
    });
  });
});

describe('reduceCellKey editing', () => {
  it('arrows are caret-only even at string edges', () => {
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const) {
      expect(reduceCellKey(editingAtEdge, key({ key: arrow }))).toEqual({ type: 'caret' });
      expect(reduceCellKey(editing, key({ key: arrow }))).toEqual({ type: 'caret' });
    }
  });

  it('Enter commits + down same column; Shift+Enter commits + up', () => {
    expect(reduceCellKey(editing, key({ key: 'Enter' }))).toEqual({
      type: 'commit',
      move: 'down',
      kind: 'enter',
      preventDefault: true,
    });
    expect(reduceCellKey(editing, key({ key: 'Enter', shiftKey: true }))).toEqual({
      type: 'commit',
      move: 'up',
      kind: 'enter',
      preventDefault: true,
    });
  });

  it('Tab commits + right with wrap; Shift+Tab left with wrap', () => {
    expect(reduceCellKey(editing, key({ key: 'Tab' }))).toEqual({
      type: 'commit',
      move: 'right',
      kind: 'tab',
      preventDefault: true,
    });
    expect(reduceCellKey(editing, key({ key: 'Tab', shiftKey: true }))).toEqual({
      type: 'commit',
      move: 'left',
      kind: 'tab',
      preventDefault: true,
    });
  });

  it('Escape cancels', () => {
    expect(reduceCellKey(editing, key({ key: 'Escape' }))).toEqual({
      type: 'cancel',
      preventDefault: true,
    });
  });

  it('printable is not a grid command', () => {
    expect(reduceCellKey(editing, key({ key: 'a' }))).toEqual({ type: 'none' });
    expect(reduceCellKey(editing, key({ key: '5' }))).toEqual({ type: 'none' });
  });

  it('F2 is a no-op while editing', () => {
    expect(reduceCellKey(editing, key({ key: 'F2' }))).toEqual({
      type: 'noop',
      preventDefault: true,
    });
  });
});

describe('reduceCellKey composing', () => {
  it('ignores Enter / Tab / Arrow while composing', () => {
    const composing: CellKeyState = { mode: 'editing', composing: true };
    expect(reduceCellKey(composing, key({ key: 'Enter' }))).toEqual({ type: 'ignore' });
    expect(reduceCellKey(composing, key({ key: 'Tab' }))).toEqual({ type: 'ignore' });
    expect(reduceCellKey(composing, key({ key: 'ArrowLeft' }))).toEqual({ type: 'ignore' });
    expect(reduceCellKey(selected, key({ key: 'Enter', isComposing: true }))).toEqual({
      type: 'ignore',
    });
    expect(reduceCellKey(editing, key({ key: 'Process' }))).toEqual({ type: 'ignore' });
  });
});

describe('neighbor', () => {
  it('encodes lift:row:axis:field', () => {
    const id = makeCellId('e-1', 2, 3);
    expect(id).toBe('e-1:2:log:kg');
    expect(parseCellId(id)).toEqual({
      liftId: 'e-1',
      row: 2,
      axis: 'log',
      field: 'kg',
      col: 3,
    });
    expect(cellIdOf(lift(0, 0))).toBe('e-1:0:plan:kg');
  });

  it('ArrowRight on plan.kg → plan.reps; plan.rpe → log.kg (chrome skipped)', () => {
    expect(neighbor(lift(0, 0), 'right', 'arrow', 2)).toEqual(lift(0, 1));
    expect(neighbor(lift(0, 2), 'right', 'arrow', 2)).toEqual(lift(0, 3));
    expect(colOf(neighbor(lift(0, 2), 'right', 'arrow', 2))).toBe(3);
  });

  it('ArrowRight on log.rpe stays (no wrap)', () => {
    expect(neighbor(lift(0, 5), 'right', 'arrow', 2)).toEqual(lift(0, 5));
    expect(neighbor(lift(1, 5), 'right', 'arrow', 2)).toEqual(lift(1, 5));
  });

  it('ArrowLeft on plan.kg stays', () => {
    expect(neighbor(lift(0, 0), 'left', 'arrow', 2)).toEqual(lift(0, 0));
  });

  it('Tab plan.kg → plan.reps; plan.rpe → log.kg; log.rpe set0 → plan.kg set1', () => {
    expect(neighbor(lift(0, 0), 'right', 'tab', 2)).toEqual(lift(0, 1));
    expect(neighbor(lift(0, 2), 'right', 'tab', 2)).toEqual(lift(0, 3));
    expect(neighbor(lift(0, 5), 'right', 'tab', 2)).toEqual(lift(1, 0));
  });

  it('Tab on last-set log.rpe stays', () => {
    expect(neighbor(lift(1, 5), 'right', 'tab', 2)).toEqual(lift(1, 5));
  });

  it('Shift+Tab reverse wrap; first plan.kg stays', () => {
    expect(neighbor(lift(1, 0), 'left', 'tab', 2)).toEqual(lift(0, 5));
    expect(neighbor(lift(0, 0), 'left', 'tab', 2)).toEqual(lift(0, 0));
  });

  it('editing Enter plan.kg row0 → plan.kg row1; last row stays', () => {
    expect(neighbor(lift(0, 0), 'down', 'enter', 2)).toEqual(lift(1, 0));
    expect(neighbor(lift(1, 0), 'down', 'enter', 2)).toEqual(lift(1, 0));
    expect(neighbor(lift(0, 3), 'down', 'enter', 2)).toEqual(lift(1, 3));
  });

  it('Shift+Enter up same column; first row stays', () => {
    expect(neighbor(lift(1, 2), 'up', 'enter', 2)).toEqual(lift(0, 2));
    expect(neighbor(lift(0, 2), 'up', 'enter', 2)).toEqual(lift(0, 2));
  });

  it('ArrowUp/Down clamp same column', () => {
    expect(neighbor(lift(0, 4), 'down', 'arrow', 2)).toEqual(lift(1, 4));
    expect(neighbor(lift(1, 4), 'down', 'arrow', 2)).toEqual(lift(1, 4));
    expect(neighbor(lift(0, 4), 'up', 'arrow', 2)).toEqual(lift(0, 4));
  });
});
