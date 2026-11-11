import { describe, expect, it } from 'vitest';
import {
  cellsIn, extendEnd, normalizePastedNumber, parseTsv, planFillDown, planPaste, rectHas, rectOf, toTsv,
} from './sheetRange';
import {
  createGridHistory, recordChange, sameSets, stepRedo, stepUndo,
} from './setGridHistory';

describe('sheetRange', () => {
  it('builds a rectangle from any two corners', () => {
    expect(rectOf({ row: 3, col: 5 }, { row: 1, col: 2 })).toEqual({ top: 1, bottom: 3, left: 2, right: 5 });
    expect(rectOf({ row: 2, col: 1 })).toEqual({ top: 2, bottom: 2, left: 1, right: 1 });
    expect(rectHas(rectOf({ row: 0, col: 1 }, { row: 1, col: 3 }), 1, 2)).toBe(true);
    expect(cellsIn(rectOf({ row: 0, col: 1 }, { row: 1, col: 2 }))).toHaveLength(4);
  });

  it('extends the range and stops at the edges', () => {
    expect(extendEnd({ row: 0, col: 6 }, 'right', 3, 7)).toEqual({ row: 0, col: 6 });
    expect(extendEnd({ row: 2, col: 1 }, 'down', 3, 7)).toEqual({ row: 2, col: 1 });
    expect(extendEnd({ row: 1, col: 1 }, 'up', 3, 7)).toEqual({ row: 0, col: 1 });
  });

  it('parses Sheets/Excel clipboard text', () => {
    expect(parseTsv('100\t5\t8\r\n110\t5\t8.5\r\n')).toEqual([['100', '5', '8'], ['110', '5', '8.5']]);
    expect(parseTsv('')).toEqual([['']]);
    expect(normalizePastedNumber('8,5')).toBe('8.5');
    expect(normalizePastedNumber('100 kg')).toBe('100');
    expect(normalizePastedNumber('80%')).toBe('80');
  });

  it('copies a range as TSV', () => {
    const rect = rectOf({ row: 0, col: 1 }, { row: 1, col: 2 });
    expect(toTsv(rect, (row, col) => `${row}${col}`)).toBe('01\t02\n11\t12');
  });

  it('pastes from the top-left and clips rows that do not fit, without adding rows', () => {
    const result = planPaste(rectOf({ row: 1, col: 1 }), [['100', '5'], ['110', '5'], ['120', '3']], 2, 7);
    expect(result.writes).toEqual([{ row: 1, col: 1, raw: '100' }, { row: 1, col: 2, raw: '5' }]);
    expect(result.clippedRows).toBe(2);
    expect(result.pastedRows).toBe(1);
  });

  it('clips columns past the last one', () => {
    const result = planPaste(rectOf({ row: 0, col: 5 }), [['5', '8', 'extra']], 1, 7);
    expect(result.writes.map((w) => w.col)).toEqual([5, 6]);
  });

  it('fills the whole selection with a single pasted value', () => {
    const result = planPaste(rectOf({ row: 0, col: 2 }, { row: 2, col: 2 }), [['5']], 3, 7);
    expect(result.writes).toEqual([0, 1, 2].map((row) => ({ row, col: 2, raw: '5' })));
  });

  it('fills down from the first row, or from the row above for one row', () => {
    const read = (row: number, col: number) => `${row}:${col}`;
    expect(planFillDown(rectOf({ row: 0, col: 1 }, { row: 2, col: 1 }), read))
      .toEqual([{ row: 1, col: 1, raw: '0:1' }, { row: 2, col: 1, raw: '0:1' }]);
    expect(planFillDown(rectOf({ row: 2, col: 1 }, { row: 2, col: 2 }), read))
      .toEqual([{ row: 2, col: 1, raw: '1:1' }, { row: 2, col: 2, raw: '1:2' }]);
    expect(planFillDown(rectOf({ row: 0, col: 1 }), read)).toEqual([]);
  });
});

describe('setGridHistory', () => {
  const a = [{ id: 's1', plannedWeight: 100 }];
  const b = [{ id: 's1', plannedWeight: 110 }];
  const c = [{ id: 's1', plannedWeight: 120 }];

  it('undoes and redoes', () => {
    const history = createGridHistory<typeof a>();
    recordChange(history, a, b);
    expect(stepUndo(history, b, sameSets)).toEqual({ status: 'ok', value: a });
    expect(stepRedo(history, a, sameSets)).toEqual({ status: 'ok', value: b });
    expect(stepRedo(history, b, sameSets)).toEqual({ status: 'empty' });
  });

  it('refuses to undo over a change made elsewhere', () => {
    const history = createGridHistory<typeof a>();
    recordChange(history, a, b);
    expect(stepUndo(history, c, sameSets)).toEqual({ status: 'conflict' });
    expect(history.undo).toHaveLength(1);
  });

  it('ignores derived fields when comparing', () => {
    expect(sameSets([{ id: 's1', plannedWeight: 100, suggestedWeight: 90 }], [{ id: 's1', plannedWeight: 100 }])).toBe(true);
    expect(sameSets([{ id: 's1', actual: null }], [{ id: 's1' }])).toBe(true);
    expect(sameSets([{ id: 's1', dropPercent: 0, isTop: false, scope: 'both' }], [{ id: 's1' }])).toBe(true);
    expect(sameSets([{ id: 's1', dropPercent: -5 }], [{ id: 's1', dropPercent: 0 }])).toBe(false);
  });

  it('a new change clears redo and the stack is capped', () => {
    const history = createGridHistory<number>(2);
    recordChange(history, 1, 2);
    recordChange(history, 2, 3);
    recordChange(history, 3, 4);
    expect(history.undo).toHaveLength(2);
    stepUndo(history, 4, Object.is);
    recordChange(history, 3, 5);
    expect(history.redo).toHaveLength(0);
  });
});
