import { describe, expect, it } from 'vitest';
import { WorkoutData } from '../types';
import {
  inferMicrocycleId,
  insertWorkoutChronologically,
  formatDateSpan,
  workoutDateSpan,
  firstPlanDate,
  firstUsableDate,
} from './workoutDays';

function session(id: string, date: string, dayLabel: string): WorkoutData {
  return {
    id,
    date,
    dayLabel,
    title: dayLabel,
    tonnage: 0,
    delta: 0,
    color: 'mac-blue',
    status: 'PLANNED',
    exercises: [],
  };
}

describe('insertWorkoutChronologically', () => {
  it('inserts between D1 and D2 as D2 and increments later days', () => {
    const existing = [
      session('w1', '2026-09-16', 'D1'),
      session('w2', '2026-09-18', 'D2'),
      session('w3', '2026-09-20', 'D3'),
    ];
    const inserted = session('w-new', '2026-09-17', '');
    const next = insertWorkoutChronologically(existing, inserted);
    expect(next.map((w) => [w.id, w.dayLabel])).toEqual([
      ['w1', 'D1'],
      ['w-new', 'D2'],
      ['w2', 'D3'],
      ['w3', 'D4'],
    ]);
  });

  it('appends after the last date as the next D label', () => {
    const existing = [
      session('w1', '2026-09-16', 'D1'),
      session('w2', '2026-09-18', 'D2'),
    ];
    const inserted = session('w-new', '2026-09-21', '');
    const next = insertWorkoutChronologically(existing, inserted);
    expect(next.map((w) => [w.id, w.dayLabel])).toEqual([
      ['w1', 'D1'],
      ['w2', 'D2'],
      ['w-new', 'D3'],
    ]);
  });
});

describe('workoutDateSpan', () => {
  it('uses the first and last workout dates', () => {
    const span = workoutDateSpan([
      session('w1', '2026-09-20', 'D3'),
      session('w2', '2026-09-16', 'D1'),
      session('w3', '2026-09-18', 'D2'),
    ]);
    expect(span).toEqual({ start: '2026-09-16', end: '2026-09-20' });
    expect(formatDateSpan(span)).toBe('2026-09-16 – 2026-09-20');
  });

  it('shows a single date when the week has one session', () => {
    expect(formatDateSpan(workoutDateSpan([session('w1', '2026-09-16', 'D1')]))).toBe('2026-09-16');
    expect(formatDateSpan(workoutDateSpan([]))).toBe('—');
  });
});

describe('inferMicrocycleId', () => {
  const micros = [
    {
      id: 'micro-1',
      weekName: 'Microcycle 1',
      focus: 'Primary',
      status: 'COMPLETED' as const,
      workouts: [session('a', '2026-09-02', 'D1'), session('b', '2026-09-04', 'D2')],
    },
    {
      id: 'micro-3',
      weekName: 'Microcycle 3',
      focus: 'Volume',
      status: 'ACTIVE' as const,
      workouts: [
        session('c', '2026-09-16', 'D1'),
        session('d', '2026-09-18', 'D2'),
        session('e', '2026-09-20', 'D3'),
      ],
    },
  ];

  it('assigns the microcycle that already owns the gap date', () => {
    expect(inferMicrocycleId('2026-09-17', micros, 'micro-1')).toBe('micro-3');
  });

  it('falls back when the date is outside every microcycle', () => {
    expect(inferMicrocycleId('2026-10-01', micros, 'micro-3')).toBe('micro-3');
  });

  it('ignores weeks whose sessions have no calendar date', () => {
    const mixed = [
      {
        id: 'undated',
        weekName: 'Week A',
        focus: 'Base',
        status: 'ACTIVE' as const,
        workouts: [session('u1', '', 'D1'), session('u2', '', 'D2')],
      },
      ...micros,
    ];
    expect(inferMicrocycleId('2026-09-17', mixed, 'undated')).toBe('micro-3');
  });
});

describe('firstUsableDate', () => {
  it('skips blank and non-ISO values', () => {
    expect(firstUsableDate(['', '  ', 'not-a-date', '2026-09-17'])).toBe('2026-09-17');
    expect(firstUsableDate(['', null, undefined])).toBe('2026-09-01');
  });
});

describe('firstPlanDate', () => {
  it('returns the fallback when every session is undated', () => {
    expect(firstPlanDate([
      {
        id: 'w1',
        weekName: 'Week 1',
        focus: 'Base',
        status: 'ACTIVE',
        workouts: [session('a', '', 'D1')],
      },
    ])).toBe('2026-09-01');
  });
});
