import { describe, expect, it } from 'vitest';
import type { ExerciseData } from '../types';
import {
  EMPTY_LIFT_FILTER,
  exercisePassesFilter,
  parseLiftFilter,
  summarizeLiftFilter,
  workoutPassesFilter,
} from './liftFilter';

function ex(partial: Partial<ExerciseData>): ExerciseData {
  return {
    id: partial.id ?? 'e1',
    title: partial.title ?? 'Lift',
    variation: partial.variation ?? 'Lift',
    tags: [],
    top: '—',
    vol: '—',
    sets: [],
    tier: partial.tier,
    liftCategory: partial.liftCategory,
    movementPattern: partial.movementPattern,
  };
}

describe('liftFilter', () => {
  it('all-All keeps empty sessions', () => {
    expect(workoutPassesFilter({ exercises: [] }, EMPTY_LIFT_FILTER)).toBe(true);
  });

  it('any facet hides empty sessions', () => {
    expect(workoutPassesFilter({ exercises: [] }, { ...EMPTY_LIFT_FILTER, lift: 'Squat' })).toBe(false);
  });

  it('matches stored liftCategory, not title substrings', () => {
    const splitSquat = ex({ title: 'Split Squat', liftCategory: 'Other', movementPattern: 'Knee Dominant', tier: 'Accessory' });
    expect(exercisePassesFilter(splitSquat, { ...EMPTY_LIFT_FILTER, lift: 'Squat' })).toBe(false);
    expect(exercisePassesFilter(splitSquat, { ...EMPTY_LIFT_FILTER, lift: 'Other' })).toBe(true);
  });

  it('Knee Dominant + Bench hides a Squat', () => {
    const squat = ex({ title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', tier: 'Comp' });
    const bench = ex({ title: 'Bench', liftCategory: 'Bench', movementPattern: 'Horizontal Push', tier: 'Comp' });
    const filter = { lift: 'Bench' as const, pattern: 'Knee Dominant' as const, tier: 'All' as const };
    expect(workoutPassesFilter({ exercises: [squat, bench] }, filter)).toBe(false);
    expect(workoutPassesFilter({ exercises: [bench] }, { ...EMPTY_LIFT_FILTER, lift: 'Bench' })).toBe(true);
  });

  it('Comp + Deadlift hides a Variation RDL', () => {
    const rdl = ex({ title: 'RDL', liftCategory: 'Deadlift', movementPattern: 'Hip Dominant', tier: 'Variation' });
    expect(workoutPassesFilter({ exercises: [rdl] }, { lift: 'Deadlift', pattern: 'All', tier: 'Comp' })).toBe(false);
    expect(workoutPassesFilter({ exercises: [rdl] }, { lift: 'Deadlift', pattern: 'All', tier: 'Variation' })).toBe(true);
  });

  it('lift Bench keeps a mixed session that has a Bench', () => {
    const squat = ex({ title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', tier: 'Comp' });
    const bench = ex({ title: 'Bench', liftCategory: 'Bench', movementPattern: 'Horizontal Push', tier: 'Comp' });
    expect(workoutPassesFilter({ exercises: [squat, bench] }, { ...EMPTY_LIFT_FILTER, lift: 'Bench' })).toBe(true);
    expect(exercisePassesFilter(squat, { ...EMPTY_LIFT_FILTER, lift: 'Bench' })).toBe(false);
  });

  it('summarizes and parses prefs', () => {
    expect(summarizeLiftFilter(EMPTY_LIFT_FILTER)).toBe('All');
    expect(summarizeLiftFilter({ lift: 'Squat', pattern: 'Knee Dominant', tier: 'Comp' })).toBe('Squat · Knee Dominant · Comp');
    expect(parseLiftFilter(null)).toEqual(EMPTY_LIFT_FILTER);
    expect(parseLiftFilter('not-json')).toEqual(EMPTY_LIFT_FILTER);
    expect(parseLiftFilter('{"lift":"Bench","pattern":"Horizontal Push","tier":"Variation"}')).toEqual({
      lift: 'Bench',
      pattern: 'Horizontal Push',
      tier: 'Variation',
    });
  });
});
