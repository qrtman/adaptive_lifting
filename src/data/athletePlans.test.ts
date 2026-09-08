import { describe, expect, it } from 'vitest';
import type { MicrocycleData } from '../types';
import { athleteIdsWithImportedPlan, importedPlanFor, planVersion } from './athletePlans';

function plan(topKg: number): MicrocycleData[] {
  return [
    {
      id: 'm-1',
      weekName: 'Week 1',
      focus: 'Base',
      status: 'ACTIVE',
      workouts: [
        {
          id: 'm-1-d1',
          date: '',
          dayLabel: 'D1',
          title: 'Squat',
          tonnage: topKg,
          delta: 0,
          color: 'gray',
          status: 'PLANNED',
          exercises: [
            {
              id: 'm-1-d1-e1',
              title: 'Squat',
              variation: 'Low bar',
              tags: ['Squat'],
              top: `${topKg}kg x 1`,
              vol: `${topKg}kg`,
              sets: [
                {
                  id: 'm-1-d1-e1-s1',
                  label: 'Top',
                  plannedWeight: topKg,
                  plannedReps: 1,
                  plannedRpe: 8,
                  isTop: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

describe('imported plan registry', () => {
  it('resolves a plan by athlete id and reports its own block name', () => {
    const [athleteId] = athleteIdsWithImportedPlan();
    const found = importedPlanFor(athleteId);
    expect(found?.athleteId).toBe(athleteId);
    expect(found?.blockName).toBeTruthy();
    expect(found?.microcycles.length).toBeGreaterThan(0);
  });

  it('returns null for an athlete with no imported block', () => {
    expect(importedPlanFor('athlete-without-a-block')).toBeNull();
    expect(importedPlanFor(null)).toBeNull();
    expect(importedPlanFor('')).toBeNull();
  });

  it('registers each athlete at most once', () => {
    const ids = athleteIdsWithImportedPlan();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every registered plan globally unique workout ids so a cached plan can be reconciled', () => {
    for (const athleteId of athleteIdsWithImportedPlan()) {
      const workoutIds = (importedPlanFor(athleteId)?.microcycles ?? []).flatMap((micro) =>
        micro.workouts.map((workout) => workout.id),
      );
      expect(new Set(workoutIds).size).toBe(workoutIds.length);
    }
  });
});

describe('planVersion', () => {
  it('is stable for identical content', () => {
    expect(planVersion(plan(200))).toBe(planVersion(plan(200)));
  });

  it('changes when any training value changes, so no one has to bump it by hand', () => {
    expect(planVersion(plan(200))).not.toBe(planVersion(plan(202.5)));
  });
});
