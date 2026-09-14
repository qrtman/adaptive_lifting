import { refreshSetAnchors } from '../../services/setPrescription';
import { setPreviewMetrics } from '../../services/mathEngine';
import { trainingIntOrZero, trainingOrZero } from '../../services/numericTraining';
import type { ExerciseData, WorkoutData } from '../../types';
import type { GridRow, SetValues } from './gridTypes';

function valuesFromSet(set: ExerciseData['sets'][number]): SetValues {
  const wt = trainingOrZero(set.actual ?? set.plannedWeight);
  const rp = trainingIntOrZero(set.reps ?? set.plannedReps);
  const rpe = trainingOrZero(set.executedRpe ?? set.plannedRpe);
  const preview = wt > 0 && rp > 0 ? setPreviewMetrics(wt, rp, rpe) : null;
  const server = set.e1rmSource === 'server' ? (set.e1rm ?? null) : null;
  return {
    plannedWeight: set.plannedWeight ?? null,
    plannedReps: set.plannedReps ?? null,
    plannedRpe: set.plannedRpe ?? null,
    actual: set.actual ?? null,
    reps: set.reps ?? null,
    executedRpe: set.executedRpe ?? null,
    note: set.note ?? '',
    e1rmServer: server,
    e1rmPreview: preview?.e1rm ?? null,
    plannedPct: set.plannedPct ?? (set.plannedWeight && (server || preview?.e1rm)
      ? Math.round((set.plannedWeight / (server || preview!.e1rm)) * 10000) / 100
      : null),
    suggestedWeight: set.suggestedWeight ?? null,
  };
}

export function rowsFromWorkout(workout: WorkoutData): GridRow[] {
  const rows: GridRow[] = [];
  for (const exercise of workout.exercises) {
    const anchored = refreshSetAnchors(exercise.sets as unknown as Array<Record<string, unknown>>);
    rows.push({
      kind: 'header',
      exerciseId: exercise.id,
      title: exercise.title,
      variation: exercise.variation,
      movementPattern: exercise.movementPattern || 'Misc',
      setCount: anchored.length,
    });
    anchored.forEach((set, index) => {
      rows.push({
        kind: 'set',
        exerciseId: exercise.id,
        exerciseTitle: exercise.title,
        setId: String(set.id),
        setIndex: index,
        values: valuesFromSet(set as unknown as ExerciseData['sets'][number]),
      });
    });
  }
  return rows;
}
