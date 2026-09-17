import { calculateCapacityScaledWeight, calculateE1RM, calculateWeightFromE1RM, roundToCompetitionPlates } from './mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

function executedE1RM(row: Record<string, unknown>): number {
  return calculateE1RM(
    trainingOrZero(row.actual),
    trainingIntOrZero(row.reps),
    trainingOrZero(row.executedRpe),
  );
}

function suggestKg(row: Record<string, unknown>, e1rm: number): number | null {
  const reps = trainingIntOrZero(row.plannedReps);
  const intensity = String(row.intensity_type || row.intensityType || 'RPE');
  const target = trainingOrZero(row.target_value ?? (intensity === 'PERCENT' ? null : row.plannedRpe));
  if (e1rm <= 0 || reps <= 0 || target <= 0) return null;
  const raw = intensity === 'PERCENT'
    ? calculateCapacityScaledWeight(e1rm, 'PERCENT', target, reps)
    : roundToCompetitionPlates(calculateWeightFromE1RM(e1rm, reps, target));
  return raw > 0 ? raw : null;
}

/** Show `use {n}` when suggestion exists and differs from typed Plan kg (empty counts as differ). */
export function planKgOfferKg(
  suggestedWeight: number | null,
  plannedWeight: unknown,
): number | null {
  if (suggestedWeight == null || suggestedWeight <= 0) return null;
  const planned = trainingNumber(plannedWeight);
  if (planned === suggestedWeight) return null;
  return suggestedWeight;
}

/**
 * Typed plan kg stays until the athlete accepts `use {n}`.
 * After a log with executed e1RM > 0, later rows get a client-derived suggestedWeight
 * even when plannedWeight is already filled. Rows with LOG kg (actual) get none.
 */
export function refreshSetAnchors<T extends Record<string, unknown>>(
  setArray: T[],
): Array<T & { suggestedWeight: number | null }> {
  if (setArray.length === 0) return [];

  let lastLoggedIndex = -1;
  let lastLoggedE1RM = 0;
  setArray.forEach((row, index) => {
    const e1 = executedE1RM(row);
    if (e1 > 0) {
      lastLoggedIndex = index;
      lastLoggedE1RM = e1;
    }
  });

  const top = setArray[0];
  const topWeight = trainingOrZero(top.actual ?? top.plannedWeight);
  const topReps = trainingIntOrZero(top.reps ?? top.plannedReps);
  const topRpe = trainingOrZero(top.executedRpe ?? top.plannedRpe ?? top.target_value);
  const topE1RM = lastLoggedE1RM > 0 ? lastLoggedE1RM : calculateE1RM(topWeight, topReps, topRpe);

  return setArray.map((row, index) => {
    const plannedWeight = trainingNumber(row.plannedWeight);
    const loggedKg = trainingNumber(row.actual);
    const suggestedWeight = lastLoggedE1RM > 0 && index > lastLoggedIndex && loggedKg == null
      ? suggestKg(row, lastLoggedE1RM)
      : null;
    return {
      ...row,
      plannedWeight,
      suggestedWeight,
      baseline_e1rm: topE1RM > 0 ? topE1RM : row.baseline_e1rm,
    };
  });
}
