import { MOVEMENT_PATTERNS, type MovementPattern } from './exerciseCatalog';
import type { ExerciseData, WorkoutData } from '../types';

export const LIFT_FILTER_LIFT_OPTIONS = ['Squat', 'Bench', 'Deadlift', 'Other'] as const;
export const LIFT_FILTER_TIER_OPTIONS = ['Comp', 'Variation', 'Accessory'] as const;

export const LIFT_FILTER_LIFTS = ['All', ...LIFT_FILTER_LIFT_OPTIONS] as const;
export const LIFT_FILTER_TIERS = ['All', ...LIFT_FILTER_TIER_OPTIONS] as const;

export type LiftFilterLift = (typeof LIFT_FILTER_LIFT_OPTIONS)[number];
export type LiftFilterTier = (typeof LIFT_FILTER_TIER_OPTIONS)[number];
export type LiftFilterPattern = MovementPattern;

export type LiftFilterFacet = 'lift' | 'pattern' | 'tier';

export type LiftFilterState = {
  lifts: LiftFilterLift[];
  patterns: LiftFilterPattern[];
  tiers: LiftFilterTier[];
};

export const EMPTY_LIFT_FILTER: LiftFilterState = {
  lifts: [],
  patterns: [],
  tiers: [],
};

export function isEmptyLiftFilter(filter: LiftFilterState): boolean {
  return filter.lifts.length === 0 && filter.patterns.length === 0 && filter.tiers.length === 0;
}

export function summarizeLiftFilter(filter: LiftFilterState): string {
  if (isEmptyLiftFilter(filter)) return 'All';
  const parts = [
    filter.lifts.join(', '),
    filter.patterns.join(', '),
    filter.tiers.join(', '),
  ].filter(Boolean);
  return parts.join(' · ');
}

function selected(values: readonly string[]): boolean {
  return values.length > 0;
}

export function exercisePassesFilter(
  exercise: Pick<ExerciseData, 'liftCategory' | 'movementPattern' | 'tier'>,
  filter: LiftFilterState,
): boolean {
  if (selected(filter.lifts) && !filter.lifts.includes((exercise.liftCategory ?? '') as LiftFilterLift)) {
    return false;
  }
  if (selected(filter.patterns) && !filter.patterns.includes((exercise.movementPattern ?? '') as LiftFilterPattern)) {
    return false;
  }
  if (selected(filter.tiers) && !filter.tiers.includes((exercise.tier ?? '') as LiftFilterTier)) {
    return false;
  }
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
  return (LIFT_FILTER_LIFT_OPTIONS as readonly string[]).includes(value);
}

function isTier(value: string): value is LiftFilterTier {
  return (LIFT_FILTER_TIER_OPTIONS as readonly string[]).includes(value);
}

function isPattern(value: string): value is LiftFilterPattern {
  return (MOVEMENT_PATTERNS as readonly string[]).includes(value);
}

function uniqueValid<T extends string>(
  values: readonly string[],
  guard: (value: string) => value is T,
  canon: readonly T[],
): T[] {
  const seen = new Set<T>();
  for (const value of values) {
    if (!guard(value) || seen.has(value)) continue;
    seen.add(value);
  }
  return canon.filter((item) => seen.has(item));
}

function parseFacet<T extends string>(
  raw: unknown,
  legacy: unknown,
  guard: (value: string) => value is T,
  canon: readonly T[],
): T[] {
  if (Array.isArray(raw)) {
    return uniqueValid(
      raw.filter((value): value is string => typeof value === 'string'),
      guard,
      canon,
    );
  }
  if (typeof legacy === 'string' && guard(legacy)) return [legacy];
  return [];
}

export function parseLiftFilter(raw: string | null | undefined): LiftFilterState {
  if (!raw) return { lifts: [], patterns: [], tiers: [] };
  try {
    const parsed = JSON.parse(raw) as {
      lifts?: unknown;
      patterns?: unknown;
      tiers?: unknown;
      lift?: unknown;
      pattern?: unknown;
      tier?: unknown;
    };
    return {
      lifts: parseFacet(parsed.lifts, parsed.lift, isLift, LIFT_FILTER_LIFT_OPTIONS),
      patterns: parseFacet(parsed.patterns, parsed.pattern, isPattern, MOVEMENT_PATTERNS),
      tiers: parseFacet(parsed.tiers, parsed.tier, isTier, LIFT_FILTER_TIER_OPTIONS),
    };
  } catch {
    return { lifts: [], patterns: [], tiers: [] };
  }
}

function toggleIn<T extends string>(current: readonly T[], value: T, canon: readonly T[]): T[] {
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return canon.filter((item) => next.includes(item));
}

export function toggleLiftFilterChip(
  filter: LiftFilterState,
  facet: LiftFilterFacet,
  value: string,
): LiftFilterState {
  if (value === 'All') {
    if (facet === 'lift') return { ...filter, lifts: [] };
    if (facet === 'pattern') return { ...filter, patterns: [] };
    return { ...filter, tiers: [] };
  }
  if (facet === 'lift' && isLift(value)) {
    return { ...filter, lifts: toggleIn(filter.lifts, value, LIFT_FILTER_LIFT_OPTIONS) };
  }
  if (facet === 'pattern' && isPattern(value)) {
    return { ...filter, patterns: toggleIn(filter.patterns, value, MOVEMENT_PATTERNS) };
  }
  if (facet === 'tier' && isTier(value)) {
    return { ...filter, tiers: toggleIn(filter.tiers, value, LIFT_FILTER_TIER_OPTIONS) };
  }
  return filter;
}

export function facetIsAll(filter: LiftFilterState, facet: LiftFilterFacet): boolean {
  if (facet === 'lift') return filter.lifts.length === 0;
  if (facet === 'pattern') return filter.patterns.length === 0;
  return filter.tiers.length === 0;
}

export function facetHasValue(filter: LiftFilterState, facet: LiftFilterFacet, value: string): boolean {
  if (value === 'All') return facetIsAll(filter, facet);
  if (facet === 'lift') return filter.lifts.includes(value as LiftFilterLift);
  if (facet === 'pattern') return filter.patterns.includes(value as LiftFilterPattern);
  return filter.tiers.includes(value as LiftFilterTier);
}
