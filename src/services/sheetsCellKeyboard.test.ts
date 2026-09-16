import { describe, expect, it } from 'vitest';
import {
  cellIdOf,
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

function addr(
  row: number,
  axis: Address['axis'],
  field: Address['field'],
  liftId = 'lift-1',
): Address {
  return { liftId, row, axis, field };
}

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

  it('Tab / Shift+Tab move with tab kind (not arrow)', () => {
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

  it('Home / End move to row ends', () => {
    expect(reduceCellKey(selected, key({ key: 'Home' }))).toEqual({
      type: 'move',
      direction: 'rowStart',
      kind: 'arrow',
      preventDefault: true,
    });
    expect(reduceCellKey(selected, key({ key: 'End' }))).toEqual({
      type: 'move',
      direction: 'rowEnd',
      kind: 'arrow',
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

  it('Enter commits + down; Shift+Enter commits + up', () => {
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

  it('Tab commits + right; Shift+Tab commits + left', () => {
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

describe('grid addresses', () => {
  it('encodes lift:row:axis:field and parses back', () => {
    const id = makeCellId('e-1', 2, 3);
    expect(id).toBe('e-1:2:log:kg');
    expect(parseCellId(id)).toEqual({
      liftId: 'e-1',
      row: 2,
      axis: 'log',
      field: 'kg',
      col: 3,
    });
    expect(cellIdOf({ liftId: 'e-1', row: 2, axis: 'log', field: 'kg' })).toBe(id);
  });
});

describe('neighbor (Tab wrap vs arrow clamp vs Enter same-column)', () => {
  it('Tab plan.kg → plan.reps', () => {
    expect(neighbor(addr(0, 'plan', 'kg'), 'right', 'tab', 2)).toEqual(addr(0, 'plan', 'reps'));
  });

  it('Tab plan.rpe → log.kg (skips chrome)', () => {
    expect(neighbor(addr(0, 'plan', 'rpe'), 'right', 'tab', 2)).toEqual(addr(0, 'log', 'kg'));
  });

  it('Tab log.rpe set0 → plan.kg set1', () => {
    expect(neighbor(addr(0, 'log', 'rpe'), 'right', 'tab', 2)).toEqual(addr(1, 'plan', 'kg'));
  });

  it('Tab on last-set log.rpe stays', () => {
    expect(neighbor(addr(1, 'log', 'rpe'), 'right', 'tab', 2)).toEqual(addr(1, 'log', 'rpe'));
  });

  it('Shift+Tab wraps: plan.kg set1 → log.rpe set0; first plan.kg stays', () => {
    expect(neighbor(addr(1, 'plan', 'kg'), 'left', 'tab', 2)).toEqual(addr(0, 'log', 'rpe'));
    expect(neighbor(addr(0, 'plan', 'kg'), 'left', 'tab', 2)).toEqual(addr(0, 'plan', 'kg'));
  });

  it('ArrowRight plan.kg → plan.reps; plan.rpe → log.kg', () => {
    expect(neighbor(addr(0, 'plan', 'kg'), 'right', 'arrow', 2)).toEqual(addr(0, 'plan', 'reps'));
    expect(neighbor(addr(0, 'plan', 'rpe'), 'right', 'arrow', 2)).toEqual(addr(0, 'log', 'kg'));
  });

  it('ArrowRight on log.rpe stays (no wrap)', () => {
    expect(neighbor(addr(0, 'log', 'rpe'), 'right', 'arrow', 2)).toEqual(addr(0, 'log', 'rpe'));
    expect(neighbor(addr(1, 'log', 'rpe'), 'right', 'arrow', 2)).toEqual(addr(1, 'log', 'rpe'));
  });

  it('ArrowLeft on plan.kg stays', () => {
    expect(neighbor(addr(0, 'plan', 'kg'), 'left', 'arrow', 2)).toEqual(addr(0, 'plan', 'kg'));
    expect(neighbor(addr(1, 'plan', 'kg'), 'left', 'arrow', 2)).toEqual(addr(1, 'plan', 'kg'));
  });

  it('ArrowUp / ArrowDown clamp same column', () => {
    expect(neighbor(addr(0, 'log', 'kg'), 'down', 'arrow', 2)).toEqual(addr(1, 'log', 'kg'));
    expect(neighbor(addr(1, 'log', 'kg'), 'down', 'arrow', 2)).toEqual(addr(1, 'log', 'kg'));
    expect(neighbor(addr(0, 'plan', 'reps'), 'up', 'arrow', 2)).toEqual(addr(0, 'plan', 'reps'));
    expect(neighbor(addr(1, 'plan', 'rpe'), 'up', 'arrow', 2)).toEqual(addr(0, 'plan', 'rpe'));
  });

  it('editing Enter plan.kg row0 → plan.kg row1', () => {
    const effect = reduceCellKey(editing, key({ key: 'Enter' }));
    expect(effect).toMatchObject({ type: 'commit', move: 'down', kind: 'enter' });
    expect(neighbor(addr(0, 'plan', 'kg'), 'down', 'enter', 2)).toEqual(addr(1, 'plan', 'kg'));
  });

  it('last-row Enter stays (no new set)', () => {
    expect(neighbor(addr(1, 'plan', 'kg'), 'down', 'enter', 2)).toEqual(addr(1, 'plan', 'kg'));
    expect(neighbor(addr(1, 'log', 'rpe'), 'down', 'enter', 2)).toEqual(addr(1, 'log', 'rpe'));
  });

  it('Shift+Enter up same column; first row stays', () => {
    const effect = reduceCellKey(editing, key({ key: 'Enter', shiftKey: true }));
    expect(effect).toMatchObject({ type: 'commit', move: 'up', kind: 'enter' });
    expect(neighbor(addr(1, 'plan', 'kg'), 'up', 'enter', 2)).toEqual(addr(0, 'plan', 'kg'));
    expect(neighbor(addr(0, 'plan', 'kg'), 'up', 'enter', 2)).toEqual(addr(0, 'plan', 'kg'));
  });

  it('Home / End stay on the same row', () => {
    expect(neighbor(addr(1, 'log', 'kg'), 'rowStart', 'arrow', 2)).toEqual(addr(1, 'plan', 'kg'));
    expect(neighbor(addr(1, 'plan', 'reps'), 'rowEnd', 'arrow', 2)).toEqual(addr(1, 'log', 'rpe'));
  });
});
