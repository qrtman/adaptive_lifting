import { describe, expect, it } from 'vitest';
import type { ExerciseData } from '../types';
import {
  EMPTY_LIFT_FILTER,
  exercisePassesFilter,
  parseLiftFilter,
  summarizeLiftFilter,
  toggleLiftFilterChip,
  workoutPassesFilter,
  type LiftFilterState,
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

function filter(partial: Partial<LiftFilterState> = {}): LiftFilterState {
  return { lifts: [], patterns: [], tiers: [], ...partial };
}

describe('liftFilter', () => {
  it('all-All keeps empty sessions', () => {
    expect(workoutPassesFilter({ exercises: [] }, EMPTY_LIFT_FILTER)).toBe(true);
  });

  it('any facet hides empty sessions', () => {
    expect(workoutPassesFilter({ exercises: [] }, filter({ lifts: ['Squat'] }))).toBe(false);
  });

  it('matches stored liftCategory, not title substrings', () => {
    const splitSquat = ex({ title: 'Split Squat', liftCategory: 'Other', movementPattern: 'Knee Dominant', tier: 'Accessory' });
    expect(exercisePassesFilter(splitSquat, filter({ lifts: ['Squat'] }))).toBe(false);
    expect(exercisePassesFilter(splitSquat, filter({ lifts: ['Other'] }))).toBe(true);
  });

  it('Knee Dominant + Bench hides a Squat', () => {
    const squat = ex({ title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', tier: 'Comp' });
    const bench = ex({ title: 'Bench', liftCategory: 'Bench', movementPattern: 'Horizontal Push', tier: 'Comp' });
    const mixed = filter({ lifts: ['Bench'], patterns: ['Knee Dominant'] });
    expect(workoutPassesFilter({ exercises: [squat, bench] }, mixed)).toBe(false);
    expect(workoutPassesFilter({ exercises: [bench] }, filter({ lifts: ['Bench'] }))).toBe(true);
  });

  it('Comp + Deadlift hides a Variation RDL', () => {
    const rdl = ex({ title: 'RDL', liftCategory: 'Deadlift', movementPattern: 'Hip Dominant', tier: 'Variation' });
    expect(workoutPassesFilter({ exercises: [rdl] }, filter({ lifts: ['Deadlift'], tiers: ['Comp'] }))).toBe(false);
    expect(workoutPassesFilter({ exercises: [rdl] }, filter({ lifts: ['Deadlift'], tiers: ['Variation'] }))).toBe(true);
  });

  it('lift Bench keeps a mixed session that has a Bench', () => {
    const squat = ex({ title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', tier: 'Comp' });
    const bench = ex({ title: 'Bench', liftCategory: 'Bench', movementPattern: 'Horizontal Push', tier: 'Comp' });
    expect(workoutPassesFilter({ exercises: [squat, bench] }, filter({ lifts: ['Bench'] }))).toBe(true);
    expect(exercisePassesFilter(squat, filter({ lifts: ['Bench'] }))).toBe(false);
  });

  it('OR within a facet keeps Squat or Bench', () => {
    const squat = ex({ title: 'Squat', liftCategory: 'Squat', movementPattern: 'Knee Dominant', tier: 'Comp' });
    const bench = ex({ title: 'Bench', liftCategory: 'Bench', movementPattern: 'Horizontal Push', tier: 'Comp' });
    const rdl = ex({ title: 'RDL', liftCategory: 'Deadlift', movementPattern: 'Hip Dominant', tier: 'Variation' });
    const both = filter({ lifts: ['Squat', 'Bench'] });
    expect(exercisePassesFilter(squat, both)).toBe(true);
    expect(exercisePassesFilter(bench, both)).toBe(true);
    expect(exercisePassesFilter(rdl, both)).toBe(false);
  });

  it('toggles chips as multiple choice; All clears the row', () => {
    const squat = toggleLiftFilterChip(EMPTY_LIFT_FILTER, 'lift', 'Squat');
    expect(squat).toEqual(filter({ lifts: ['Squat'] }));
    const squatBench = toggleLiftFilterChip(squat, 'lift', 'Bench');
    expect(squatBench.lifts).toEqual(['Squat', 'Bench']);
    const benchFirst = toggleLiftFilterChip(toggleLiftFilterChip(EMPTY_LIFT_FILTER, 'lift', 'Bench'), 'lift', 'Squat');
    expect(summarizeLiftFilter(benchFirst)).toBe('Squat, Bench');
    const squatOnly = toggleLiftFilterChip(squatBench, 'lift', 'Bench');
    expect(squatOnly.lifts).toEqual(['Squat']);
    expect(toggleLiftFilterChip(squatOnly, 'lift', 'All')).toEqual(EMPTY_LIFT_FILTER);
  });

  it('summarizes and parses prefs, including legacy single values', () => {
    expect(summarizeLiftFilter(EMPTY_LIFT_FILTER)).toBe('All');
    expect(summarizeLiftFilter(filter({ lifts: ['Squat'], patterns: ['Knee Dominant'], tiers: ['Comp'] }))).toBe(
      'Squat · Knee Dominant · Comp',
    );
    expect(summarizeLiftFilter(filter({ lifts: ['Squat', 'Bench'] }))).toBe('Squat, Bench');
    expect(parseLiftFilter(null)).toEqual(EMPTY_LIFT_FILTER);
    expect(parseLiftFilter('not-json')).toEqual(EMPTY_LIFT_FILTER);
    expect(parseLiftFilter('{"lift":"Bench","pattern":"Horizontal Push","tier":"Variation"}')).toEqual(
      filter({ lifts: ['Bench'], patterns: ['Horizontal Push'], tiers: ['Variation'] }),
    );
    expect(parseLiftFilter('{"lifts":["Squat","Bench"],"patterns":[],"tiers":["Comp"]}')).toEqual(
      filter({ lifts: ['Squat', 'Bench'], tiers: ['Comp'] }),
    );
  });
});
