import { MOVEMENT_PATTERNS, type MovementPattern } from './exerciseCatalog';
import type { ExerciseData, WorkoutData } from '../types';

export const LIFT_FILTER_LIFTS = ['All', 'Squat', 'Bench', 'Deadlift', 'Other'] as const;
export const LIFT_FILTER_TIERS = ['All', 'Comp', 'Variation', 'Accessory'] as const;

export type LiftFilterLift = (typeof LIFT_FILTER_LIFTS)[number];
export type LiftFilterTier = (typeof LIFT_FILTER_TIERS)[number];
export type LiftFilterPattern = 'All' | MovementPattern;

export type LiftFilterState = {
  lift: LiftFilterLift;
  pattern: LiftFilterPattern;
  tier: LiftFilterTier;
};

export const EMPTY_LIFT_FILTER: LiftFilterState = {
  lift: 'All',
  pattern: 'All',
  tier: 'All',
};

export function isEmptyLiftFilter(filter: LiftFilterState): boolean {
  return filter.lift === 'All' && filter.pattern === 'All' && filter.tier === 'All';
}

export function summarizeLiftFilter(filter: LiftFilterState): string {
  if (isEmptyLiftFilter(filter)) return 'All';
  return [filter.lift, filter.pattern, filter.tier].filter((value) => value !== 'All').join(' · ');
}

export function exercisePassesFilter(
  exercise: Pick<ExerciseData, 'liftCategory' | 'movementPattern' | 'tier'>,
  filter: LiftFilterState,
): boolean {
  if (filter.lift !== 'All' && (exercise.liftCategory ?? '') !== filter.lift) return false;
  if (filter.pattern !== 'All' && (exercise.movementPattern ?? '') !== filter.pattern) return false;
  if (filter.tier !== 'All' && (exercise.tier ?? '') !== filter.tier) return false;
  return true;
}

export function workoutPassesFilter(
  workout: Pick<WorkoutData, 'exercises'>,
  filter: LiftFilterState,
): boolean {
  if (isEmptyLiftFilter(filter)) return true;
  if (workout.exercises.length === 0) return false;
  return workout.exercises.some((exercise) => exercisePassesFilter(exercise, filter));
}

function isLift(value: string): value is LiftFilterLift {
  return (LIFT_FILTER_LIFTS as readonly string[]).includes(value);
}

function isTier(value: string): value is LiftFilterTier {
  return (LIFT_FILTER_TIERS as readonly string[]).includes(value);
}

function isPattern(value: string): value is LiftFilterPattern {
  return value === 'All' || (MOVEMENT_PATTERNS as readonly string[]).includes(value);
}

export function parseLiftFilter(raw: string | null | undefined): LiftFilterState {
  if (!raw) return { ...EMPTY_LIFT_FILTER };
  try {
    const parsed = JSON.parse(raw) as Partial<LiftFilterState>;
    const lift = typeof parsed.lift === 'string' && isLift(parsed.lift) ? parsed.lift : 'All';
    const pattern = typeof parsed.pattern === 'string' && isPattern(parsed.pattern) ? parsed.pattern : 'All';
    const tier = typeof parsed.tier === 'string' && isTier(parsed.tier) ? parsed.tier : 'All';
    return { lift, pattern, tier };
  } catch {
    return { ...EMPTY_LIFT_FILTER };
  }
}
