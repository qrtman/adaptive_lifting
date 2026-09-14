import { describe, expect, it } from 'vitest';
import { buildMonthGrid, moveFocus, shiftMonth, weekStripDays } from './monthModel';
import { calendarShortcut } from './calendarKeyboard';
import { chipLabel, overflowChips, rescheduleFields } from './chipLabel';
import type { WorkoutData } from '../../types';

describe('month grid', () => {
  it('starts Monday by default and pads to full weeks', () => {
    const days = buildMonthGrid(2026, 8, 1);
    expect(days[0].iso).toBe('2026-08-31');
    expect(days[0].inMonth).toBe(false);
    expect(days.find((d) => d.iso === '2026-09-01')?.col).toBe(2);
    expect(days.length % 7).toBe(0);
    expect(days.length === 35 || days.length === 42).toBe(true);
  });

  it('moves focus with arrows and wraps at edges in-grid', () => {
    const days = buildMonthGrid(2026, 8, 1);
    expect(moveFocus('2026-09-14', 'ArrowRight', days)).toBe('2026-09-15');
    expect(moveFocus('2026-09-14', 'ArrowUp', days)).toBe('2026-09-07');
    expect(moveFocus(days[0].iso, 'ArrowLeft', days)).toBe(days[0].iso);
  });

  it('shifts month across year', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it('week strip is the focused week of seven days', () => {
    const days = buildMonthGrid(2026, 8, 1);
    const week = weekStripDays(days, '2026-09-14');
    expect(week).toHaveLength(7);
    expect(week.some((d) => d.iso === '2026-09-14')).toBe(true);
  });
});

describe('calendar shortcuts', () => {
  it('ignores typing in inputs', () => {
    expect(calendarShortcut({ key: 'n', target: { tagName: 'INPUT' } })).toBeNull();
  });

  it('maps operator keys', () => {
    expect(calendarShortcut({ key: 'n' })).toEqual({ type: 'create' });
    expect(calendarShortcut({ key: '[' })).toEqual({ type: 'prevMonth' });
    expect(calendarShortcut({ key: ']' })).toEqual({ type: 'nextMonth' });
    expect(calendarShortcut({ key: 't' })).toEqual({ type: 'today' });
    expect(calendarShortcut({ key: 'Enter' })).toEqual({ type: 'open' });
    expect(calendarShortcut({ key: '?' })).toEqual({ type: 'help' });
  });
});

describe('chips', () => {
  const workout = (patch: Partial<WorkoutData>): WorkoutData => ({
    id: 'w1',
    date: '2026-09-14',
    dayLabel: 'D1',
    title: 'Session',
    tonnage: 0,
    delta: 0,
    color: 'mac-blue',
    exercises: [],
    status: 'PLANNED',
    ...patch,
  });

  it('uses title unless default Session, else pattern abbrev', () => {
    expect(chipLabel(workout({ title: 'Meet day' }))).toBe('Meet day');
    expect(chipLabel(workout({
      title: 'Session',
      exercises: [{
        id: 'e1', title: 'Squat', variation: 'Squat', tags: [], top: '—', vol: '—', sets: [],
        movementPattern: 'Knee Dominant',
      }],
    }))).toBe('SQ');
  });

  it('caps visible chips and reports overflow', () => {
    expect(overflowChips([1, 2, 3]).overflow).toBe(0);
    expect(overflowChips([1, 2, 3, 4, 5]).overflow).toBe(2);
    expect(overflowChips([1, 2, 3, 4, 5]).shown).toEqual([1, 2, 3]);
  });

  it('reschedule payload is date-only', () => {
    expect(rescheduleFields('2026-09-20')).toEqual({ date: '2026-09-20' });
  });
});
