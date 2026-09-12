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

/** Typed plan kg stays. After a log, later empty rows get a suggested kg from executed e1RM. */
export function refreshSetAnchors<T extends Record<string, unknown>>(setArray: T[]): T[] {
  if (setArray.length === 0) return setArray;

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
    const suggestedWeight = lastLoggedE1RM > 0 && index > lastLoggedIndex
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
