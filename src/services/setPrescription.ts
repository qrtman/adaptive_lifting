import { calculateE1RM } from './mathEngine';
import { trainingIntOrZero, trainingNumber, trainingOrZero } from './numericTraining';

/** Keep typed plan kg. e1RM is a readout from the top set. Never fill kg from e1RM. */
export function refreshSetAnchors<T extends Record<string, unknown>>(setArray: T[]): T[] {
  if (setArray.length === 0) return setArray;

  const top = setArray[0];
  const topWeight = trainingOrZero(top.actual ?? top.plannedWeight);
  const topReps = trainingIntOrZero(top.reps ?? top.plannedReps);
  const topRpe = trainingOrZero(top.executedRpe ?? top.plannedRpe ?? top.target_value);
  const topE1RM = calculateE1RM(topWeight, topReps, topRpe);

  return setArray.map((s) => ({
    ...s,
    plannedWeight: trainingNumber(s.plannedWeight),
    baseline_e1rm: topE1RM > 0 ? topE1RM : s.baseline_e1rm,
  }));
}
