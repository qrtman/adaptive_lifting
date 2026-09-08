import { describe, expect, it } from 'vitest';
import type { MicrocycleData, WorkoutData } from '../types';
import {
  PLAN_SCHEMA,
  StoredPlan,
  asStoredPlan,
  inferOwnedWorkoutIds,
  planSnapshotId,
  reconcileImportedPlan,
} from './planStore';

function workout(id: string, topKg: number, logged: number | null = null): WorkoutData {
  return {
    id,
    date: '',
    dayLabel: id.toUpperCase(),
    title: 'Squat',
    tonnage: logged ?? 0,
    delta: 0,
    color: 'gray',
    status: logged ? 'COMPLETED' : 'PLANNED',
    exercises: [
      {
        id: `${id}-e1`,
        title: 'Squat',
        variation: 'Low bar',
        tags: ['Squat'],
        top: `${topKg}kg x 1`,
        vol: `${logged ?? 0}kg`,
        sets: [
          {
            id: `${id}-e1-s1`,
            label: 'Top',
            plannedWeight: topKg,
            plannedReps: 1,
            plannedRpe: 8,
            isTop: true,
            actual: logged,
            reps: logged ? 1 : null,
          },
        ],
      },
    ],
  };
}

function micro(id: string, workouts: WorkoutData[]): MicrocycleData {
  return { id, weekName: id, focus: 'Base', status: 'ACTIVE', workouts };
}

function storedPlan(microcycles: MicrocycleData[], ownedWorkoutIds: string[]): StoredPlan {
  return {
    schema: PLAN_SCHEMA,
    athleteId: 'athlete-1',
    source: 'imported',
    planVersion: 'old',
    ownedWorkoutIds,
    microcycles,
  };
}

function topKgOf(plan: MicrocycleData[], microId: string, workoutId: string): number | null {
  const found = plan
    .find((row) => row.id === microId)
    ?.workouts.find((row) => row.id === workoutId);
  return found?.exercises[0].sets[0].plannedWeight ?? null;
}

describe('planSnapshotId', () => {
  it('keeps each athlete on their own key so opening one does not clobber another', () => {
    expect(planSnapshotId('athlete-1')).not.toBe(planSnapshotId('athlete-2'));
    expect(planSnapshotId(null)).toBe('plan:default');
  });
});

describe('asStoredPlan', () => {
  it('rejects payloads that are not a current-schema plan', () => {
    expect(asStoredPlan(null)).toBeNull();
    expect(asStoredPlan([])).toBeNull();
    expect(asStoredPlan({ schema: 99, microcycles: [micro('m1', [workout('d1', 200)])] })).toBeNull();
    expect(asStoredPlan({ schema: PLAN_SCHEMA, microcycles: [] })).toBeNull();
  });

  it('defaults edit tracking when an older record omits it', () => {
    const parsed = asStoredPlan({
      schema: PLAN_SCHEMA,
      athleteId: 'athlete-1',
      microcycles: [micro('m1', [workout('d1', 200)])],
    });
    expect(parsed?.ownedWorkoutIds).toEqual([]);
    expect(parsed?.planVersion).toBeNull();
  });
});

describe('reconcileImportedPlan', () => {
  it('takes the corrected import for sessions nobody edited', () => {
    const cached = storedPlan([micro('m1', [workout('d1', 200)])], []);
    const source = [micro('m1', [workout('d1', 205)])];

    expect(topKgOf(reconcileImportedPlan(source, cached), 'm1', 'd1')).toBe(205);
  });

  it('keeps a session that was edited in the app', () => {
    const cached = storedPlan([micro('m1', [workout('d1', 200, 202.5)])], ['d1']);
    const source = [micro('m1', [workout('d1', 205)])];

    const merged = reconcileImportedPlan(source, cached);
    expect(topKgOf(merged, 'm1', 'd1')).toBe(200);
    expect(merged[0].workouts[0].exercises[0].sets[0].actual).toBe(202.5);
  });

  it('refreshes untouched sessions while preserving edited ones in the same week', () => {
    const cached = storedPlan(
      [micro('m1', [workout('d1', 200, 202.5), workout('d2', 100)])],
      ['d1'],
    );
    const source = [micro('m1', [workout('d1', 205), workout('d2', 110)])];

    const merged = reconcileImportedPlan(source, cached);
    expect(topKgOf(merged, 'm1', 'd1')).toBe(200);
    expect(topKgOf(merged, 'm1', 'd2')).toBe(110);
  });

  it('keeps a session the coach added in the app', () => {
    const cached = storedPlan([micro('m1', [workout('d1', 200), workout('d9', 150)])], ['d9']);
    const source = [micro('m1', [workout('d1', 205)])];

    const merged = reconcileImportedPlan(source, cached);
    expect(merged[0].workouts.map((row) => row.id)).toEqual(['d1', 'd9']);
  });

  it('adds weeks the import gained', () => {
    const cached = storedPlan([micro('m1', [workout('d1', 200)])], []);
    const source = [micro('m1', [workout('d1', 200)]), micro('m2', [workout('d3', 210)])];

    expect(reconcileImportedPlan(source, cached).map((row) => row.id)).toEqual(['m1', 'm2']);
  });

  it('keeps logged work from a week the import dropped, and drops the rest', () => {
    const cached = storedPlan(
      [micro('m1', [workout('d1', 200)]), micro('m2', [workout('d3', 210, 212.5), workout('d4', 90)])],
      ['d3'],
    );
    const source = [micro('m1', [workout('d1', 200)])];

    const merged = reconcileImportedPlan(source, cached);
    expect(merged.map((row) => row.id)).toEqual(['m1', 'm2']);
    expect(merged[1].workouts.map((row) => row.id)).toEqual(['d3']);
  });
});

describe('inferOwnedWorkoutIds', () => {
  it('claims only the sessions that already differ from the import', () => {
    const source = [micro('m1', [workout('d1', 200), workout('d2', 100)])];
    const cached = [micro('m1', [workout('d1', 200, 202.5), workout('d2', 100)])];

    expect(inferOwnedWorkoutIds(source, cached)).toEqual(['d1']);
  });

  it('claims sessions the import does not have', () => {
    const source = [micro('m1', [workout('d1', 200)])];
    const cached = [micro('m1', [workout('d1', 200), workout('d9', 150)])];

    expect(inferOwnedWorkoutIds(source, cached)).toEqual(['d9']);
  });
});
