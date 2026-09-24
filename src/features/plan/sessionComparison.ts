import type { ExerciseData, WorkoutData } from '../../types';
import { groupLabeledSessions } from './copyClipboard';
import { normalizeDayLabel } from './sessionLabels';
import { getLoggedLiftSummary } from './sessionSetReadout';
import { sortByFirstSession } from './weekBoard';

export type LoggedLiftSummary = ReturnType<typeof getLoggedLiftSummary>;

function liftKey(day: string, exercise: ExerciseData): string {
  return JSON.stringify([
    day,
    exercise.title.trim().toLocaleLowerCase(),
    exercise.variation.trim().toLocaleLowerCase(),
    exercise.tier ?? '',
  ]);
}

/** Compare only with the adjacent earlier labeled Week in the same Block. */
export function buildPreviousWeekLiftSummaries(workouts: readonly WorkoutData[]): Map<string, LoggedLiftSummary> {
  const comparisons = new Map<string, LoggedLiftSummary>();
  const groups = groupLabeledSessions([...workouts], (workout) => workout);
  const weekGroups = [...groups.blocks.map((block) => block.weeks), groups.weeksNoBlock];

  for (const weeks of weekGroups) {
    const ordered = sortByFirstSession(weeks, (workout) => workout.date);
    for (let index = 1; index < ordered.length; index += 1) {
      const baseline = new Map<string, LoggedLiftSummary>();
      for (const workout of ordered[index - 1].items) {
        const day = normalizeDayLabel(workout.dayLabel);
        if (!day) continue;
        for (const exercise of workout.exercises) {
          const key = liftKey(day, exercise);
          const summary = getLoggedLiftSummary(exercise.sets);
          const earlier = baseline.get(key);
          baseline.set(key, earlier ? {
            topE1RM: earlier.topE1RM ?? summary.topE1RM,
            tonnage: earlier.tonnage ?? summary.tonnage,
            avgIntensityPct: earlier.avgIntensityPct ?? summary.avgIntensityPct,
          } : summary);
        }
      }
      for (const workout of ordered[index].items) {
        const day = normalizeDayLabel(workout.dayLabel);
        if (!day) continue;
        for (const exercise of workout.exercises) {
          const previous = baseline.get(liftKey(day, exercise));
          if (previous) comparisons.set(exercise.id, previous);
        }
      }
    }
  }
  return comparisons;
}

export function metricChange(current: number | null, previous: number | null, digits: number): { amount: number; relativePct: number } | null {
  if (current == null || previous == null) return null;
  const factor = 10 ** digits;
  const amount = Math.round(current * factor) / factor - Math.round(previous * factor) / factor;
  return { amount, relativePct: previous === 0 ? 0 : (amount / previous) * 100 };
}

export function formatSigned(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}
