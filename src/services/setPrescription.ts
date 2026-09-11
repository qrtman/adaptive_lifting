import { calculateE1RM } from './mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

/** Keep typed Rx kg. e1RM is derived from the top set, never the source of weight. */
export function refreshSetAnchors<T extends Record<string, unknown>>(setArray: T[]): T[] {
  if (setArray.length === 0) return setArray;

  const top = setArray[0];
  const topWeight = trainingOrZero(top.actual ?? top.plannedWeight);
  const topReps = trainingIntOrZero(top.reps ?? top.plannedReps);
  const topRpe = trainingOrZero(top.executedRpe ?? top.plannedRpe ?? top.target_value);
  const topE1RM = calculateE1RM(topWeight, topReps, topRpe);

  return setArray.map((s, index) => {
    let suggestedWeight = s.suggestedWeight;
    if (topWeight > 0 && index > 0 && s.isAuto) {
      const drop = typeof s.dropPercent === 'number' ? s.dropPercent : -5;
      suggestedWeight = topWeight * (1 + drop / 100);
    }

    return {
      ...s,
      plannedWeight: trainingNumber(s.plannedWeight),
      baseline_e1rm: topE1RM > 0 ? topE1RM : s.baseline_e1rm,
      suggestedWeight,
    };
  });
}
