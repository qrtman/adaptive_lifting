import { describe, expect, it } from 'vitest';
import type { MicrocycleData } from '../types';
import { athleteIdsWithImportedPlan, importedPlanFor, pickActiveAthlete, planVersion } from './athletePlans';

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

describe('pickActiveAthlete', () => {
  const withPlan = {
    id: athleteIdsWithImportedPlan()[0],
    name: 'Has Plan',
    email: null,
    currentBlock: 'Block A',
    activeMicrocycles: 1,
    peakE1RM: { squat: null, bench: null, deadlift: null },
    linked: false,
  };
  const extra = {
    id: 'athlete-extra',
    name: 'Extra',
    email: null,
    currentBlock: null,
    activeMicrocycles: 0,
    peakE1RM: { squat: null, bench: null, deadlift: null },
    linked: false,
  };

  it('returns null for an empty roster', () => {
    expect(pickActiveAthlete([], 'athlete-extra')).toBeNull();
  });

  it('keeps the preferred athlete when they are still on the roster', () => {
    expect(pickActiveAthlete([withPlan, extra], extra.id)?.id).toBe(extra.id);
  });

  it('falls back to the first athlete who has a plan', () => {
    expect(pickActiveAthlete([extra, withPlan], 'gone')?.id).toBe(withPlan.id);
  });
});
