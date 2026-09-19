import { describe, expect, it } from 'vitest';
import type { MicrocycleData, WorkoutData } from '../types';
import { uniquePlanTitles } from './LabelCombo';

function micros(titles: string[]): MicrocycleData[] {
  return [{
    id: 'm1',
    weekName: 'Microcycle 01',
    focus: '',
    status: 'DRAFT',
    workouts: titles.map((title, index) => ({
      id: `w${index}`,
      date: '2026-09-01',
      dayLabel: '1',
      title,
      tonnage: 0,
      delta: 0,
      color: 'gray',
      exercises: [],
      status: 'PLANNED',
    } satisfies WorkoutData)),
  }];
}

describe('uniquePlanTitles', () => {
  it('drops empty, Session, and Day-slot titles', () => {
    expect(uniquePlanTitles(micros(['', 'Session', 'Day 1', 'day 1', 'D1', 'Squat', 'Meet', 'AM']))).toEqual([
      'AM',
      'Meet',
      'Squat',
    ]);
  });
});
