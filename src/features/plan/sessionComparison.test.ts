import { describe, expect, it } from 'vitest';
import type { ExerciseData, WorkoutData } from '../../types';
import { buildPreviousWeekLiftSummaries, formatSigned, metricChange } from './sessionComparison';

function lift(id: string, title = 'Competition Squat', actual: number | null = 150, rpe: number | null = 8): ExerciseData {
  return {
    id, title, variation: 'Standard', tier: 'Comp', tags: [], top: '', vol: '',
    sets: [{ id: `${id}-set`, label: '1', scope: 'both', plannedWeight: 300, plannedReps: 5, plannedRpe: 8, actual, reps: actual == null ? null : 5, executedRpe: rpe }],
  };
}

function workout(id: string, date: string, blockLabel: string | null, weekLabel: string | null, dayLabel: string, exercises: ExerciseData[]): WorkoutData {
  return { id, date, blockLabel, weekLabel, dayLabel, exercises, title: id, tonnage: 0, delta: 0, color: 'gray', status: 'PLANNED' };
}

describe('previous Week lift comparisons', () => {
  it('uses date order, adjacent Week, Day, title, variation, tier, and logged values only', () => {
    const first = workout('first', '2026-09-01', 'B', '9', 'D1', [lift('base', 'Competition Squat', 140)]);
    const second = workout('second', '2026-09-08', 'B', '2', 'Day 1', [lift('current', 'Competition Squat', 150)]);
    const third = workout('third', '2026-09-15', 'B', '3', '1', [lift('later', 'Competition Squat', 160)]);
    const map = buildPreviousWeekLiftSummaries([third, second, first]);
    expect(map.get('current')?.tonnage).toBe(700);
    expect(map.get('later')?.tonnage).toBe(750);
    expect(map.has('base')).toBe(false);
  });

  it('keeps Block boundaries and omits mismatched and unlogged baselines', () => {
    const base = workout('base', '2026-09-01', 'B', '1', '1', [lift('logged'), lift('empty', 'Bench', null)]);
    const sameBlock = workout('same', '2026-09-08', 'B', '2', '1', [lift('match'), lift('no-log', 'Bench'), lift('different', 'Deadlift')]);
    const otherBlock = workout('other', '2026-09-09', 'C', '2', '1', [lift('other-lift')]);
    const otherDay = workout('other-day', '2026-09-08', 'B', '2', '2', [lift('day-lift')]);
    const map = buildPreviousWeekLiftSummaries([base, sameBlock, otherBlock, otherDay]);
    expect(map.get('match')?.tonnage).toBe(750);
    expect(map.get('no-log')?.tonnage).toBeNull();
    expect(map.has('different')).toBe(false);
    expect(map.has('other-lift')).toBe(false);
    expect(map.has('day-lift')).toBe(false);
  });

  it('compares no-Block Weeks only with no-Block Weeks', () => {
    const map = buildPreviousWeekLiftSummaries([
      workout('no-block-1', '2026-09-01', null, '1', '1', [lift('base')]),
      workout('block', '2026-09-05', 'B', '1', '1', [lift('block-lift')]),
      workout('no-block-2', '2026-09-08', null, '2', '1', [lift('current')]),
    ]);
    expect(map.get('current')?.tonnage).toBe(750);
  });
});

describe('displayed metric changes', () => {
  it('shows 224 to 237 as +13 kg (+5.8%)', () => {
    const change = metricChange(237, 224, 0);
    expect(change).toEqual({ amount: 13, relativePct: 13 / 224 * 100 });
    expect(`${formatSigned(change!.amount)} kg (${formatSigned(change!.relativePct, 1)}%)`).toBe('+13 kg (+5.8%)');
  });

  it('handles decreases, ties, and missing metrics', () => {
    expect(formatSigned(metricChange(82, 79, 0)!.amount)).toBe('+3');
    expect(formatSigned(metricChange(79, 82, 0)!.amount)).toBe('-3');
    expect(formatSigned(metricChange(82, 82, 0)!.amount)).toBe('0');
    expect(metricChange(null, 82, 0)).toBeNull();
    expect(metricChange(82, null, 0)).toBeNull();
  });
});
