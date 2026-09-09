import { ExerciseData, MicrocycleData, SetData, WorkoutData } from '../types';
import {
  addUtcDays,
  placeCopiedBounds,
  resolvedMicrocycleBounds,
  sessionCalendarDate,
  utcDayDiff,
} from './workoutDays';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextWeekName(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const match = /^Week (\d+)$/i.exec(name.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Week ${max + 1}`;
}

export function createBlankMicrocycle(
  existing: MicrocycleData[],
  startDate: string,
  endDate: string,
): MicrocycleData {
  return {
    id: newId('mc'),
    weekName: nextWeekName(existing.map((micro) => micro.weekName)),
    focus: '',
    status: 'DRAFT',
    startDate,
    endDate,
    workouts: [],
  };
}

export function copyWeekName(name: string, existingNames: string[] = []): string {
  const taken = new Set(existingNames);
  const copied = /^(.*) copy(?: (\d+))?$/.exec(name);
  const stem = copied ? copied[1] : name;
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? `${stem} copy` : `${stem} copy ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} copy ${Date.now().toString(36)}`;
}

function cloneSet(set: SetData): SetData {
  return {
    ...set,
    id: newId('s'),
    actual: null,
    reps: null,
    executedRpe: null,
    velocity: null,
    readiness: null,
    hrv: null,
  };
}

function cloneExercise(exercise: ExerciseData): ExerciseData {
  return {
    ...exercise,
    id: newId('ex'),
    top: '---',
    vol: '0kg',
    sets: exercise.sets.map(cloneSet),
  };
}

function cloneWorkout(
  workout: WorkoutData,
  microIndex: number,
  workoutIndex: number,
  shiftDays: number,
): WorkoutData {
  const placed = sessionCalendarDate(workout, microIndex, workoutIndex);
  return {
    ...workout,
    id: newId('w'),
    date: addUtcDays(placed, shiftDays),
    status: 'PLANNED',
    tonnage: 0,
    delta: 0,
    color: 'mac-blue',
    exercises: workout.exercises.map(cloneExercise),
  };
}

export function copyMicrocycle(
  microcycles: MicrocycleData[],
  sourceId: string,
): { microcycles: MicrocycleData[]; copied: MicrocycleData } | null {
  const sourceIndex = microcycles.findIndex((micro) => micro.id === sourceId);
  if (sourceIndex === -1) return null;

  const source = microcycles[sourceIndex];
  const sourceBounds = resolvedMicrocycleBounds(source, sourceIndex);
  const existing = microcycles.map((micro, index) => resolvedMicrocycleBounds(micro, index));
  const bounds = placeCopiedBounds(existing, sourceBounds);
  const shiftDays = utcDayDiff(bounds.start, sourceBounds.start);

  const copied: MicrocycleData = {
    id: newId('mc'),
    weekName: copyWeekName(
      source.weekName,
      microcycles.map((micro) => micro.weekName),
    ),
    focus: source.focus,
    status: 'DRAFT',
    startDate: bounds.start,
    endDate: bounds.end,
    workouts: source.workouts.map((workout, workoutIndex) =>
      cloneWorkout(workout, sourceIndex, workoutIndex, shiftDays),
    ),
  };

  return { microcycles: [...microcycles, copied], copied };
}
