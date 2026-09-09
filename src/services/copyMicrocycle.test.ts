import { describe, expect, it } from 'vitest';
import type { MicrocycleData, WorkoutData } from '../types';
import { copyMicrocycle, copyWeekName } from './copyMicrocycle';
import { resolvedMicrocycleBounds } from './workoutDays';

function session(id: string, date: string, loggedKg: number | null = null): WorkoutData {
  return {
    id,
    date,
    dayLabel: id,
    title: 'Squat',
    tonnage: loggedKg ?? 0,
    delta: 0,
    color: 'mac-blue',
    status: loggedKg ? 'COMPLETED' : 'PLANNED',
    exercises: [
      {
        id: `${id}-e1`,
        title: 'Squat',
        variation: 'Low bar',
        tags: ['Squat'],
        top: '200kg x 1',
        vol: '200kg',
        sets: [
          {
            id: `${id}-e1-s1`,
            label: 'Top',
            plannedWeight: 200,
            plannedReps: 1,
            plannedRpe: 8,
            isTop: true,
            actual: loggedKg,
            reps: loggedKg ? 1 : null,
            executedRpe: loggedKg ? 9 : null,
          },
        ],
      },
    ],
  };
}

function week(id: string, weekName: string, workouts: WorkoutData[]): MicrocycleData {
  return { id, weekName, focus: 'Base', status: 'ACTIVE', workouts };
}

describe('copyWeekName', () => {
  it('appends copy, then increments', () => {
    expect(copyWeekName('Week 3')).toBe('Week 3 copy');
    expect(copyWeekName('Week 3 copy')).toBe('Week 3 copy 2');
    expect(copyWeekName('Week 3 copy 2')).toBe('Week 3 copy 3');
  });
});

describe('copyMicrocycle', () => {
  const plan = [
    week('w1', 'Week 1', [session('d1', '2026-09-01', 202.5), session('d2', '2026-09-03')]),
    week('w2', 'Week 2', [session('d3', '2026-09-08')]),
  ];

  it('returns null when the week is missing', () => {
    expect(copyMicrocycle(plan, 'missing')).toBeNull();
  });

  it('appends a prescription-only copy with new ids and shifted dates', () => {
    const result = copyMicrocycle(plan, 'w1');
    expect(result).not.toBeNull();
    const { copied, microcycles } = result!;
    expect(microcycles).toHaveLength(3);
    expect(copied.id).not.toBe('w1');
    expect(copied.weekName).toBe('Week 1 copy');
    expect(copied.status).toBe('DRAFT');
    expect(copied.workouts.map((row) => row.id)).not.toContain('d1');
    expect(copied.workouts.map((row) => row.id)).not.toContain('d2');

    const ids = [
      copied.id,
      ...copied.workouts.flatMap((workout) => [
        workout.id,
        ...workout.exercises.flatMap((exercise) => [exercise.id, ...exercise.sets.map((set) => set.id)]),
      ]),
    ];
    expect(new Set(ids).size).toBe(ids.length);

    const set = copied.workouts[0].exercises[0].sets[0];
    expect(set.plannedWeight).toBe(200);
    expect(set.plannedReps).toBe(1);
    expect(set.plannedRpe).toBe(8);
    expect(set.actual).toBeNull();
    expect(set.reps).toBeNull();
    expect(set.executedRpe).toBeNull();
    expect(copied.workouts[0].status).toBe('PLANNED');
    expect(copied.workouts[0].tonnage).toBe(0);

    const sourceBounds = resolvedMicrocycleBounds(plan[0], 0);
    expect(sourceBounds).toEqual({ start: '2026-08-31', end: '2026-09-06' });
    expect(copied.startDate).toBe('2026-09-14');
    expect(copied.endDate).toBe('2026-09-20');
    expect(copied.workouts[0].date).toBe('2026-09-15');
    expect(copied.workouts[1].date).toBe('2026-09-17');
  });
});
