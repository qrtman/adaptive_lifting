import type { ExerciseData, SetData } from '../../types';
import { compileVariation, defaultModifiers } from '../../services/liftVariation';
import type { CatalogExercise } from '../../services/exerciseCatalog';

/**
 * Copying a lift (session sheet phase 5): Duplicate and drag-from-the-week-rail.
 * The copy carries the lift's identity and its Plan sets only — never the Log.
 */

export type NewLiftPayload = {
  title: string;
  variation: string;
  tier?: ExerciseData['tier'];
  liftCategory?: ExerciseData['liftCategory'];
  movementPattern?: string;
  liftNote?: string;
};

export function liftCopyPayload(exercise: ExerciseData): NewLiftPayload {
  return {
    title: exercise.title,
    variation: exercise.variation || exercise.title,
    tier: exercise.tier,
    liftCategory: exercise.liftCategory,
    movementPattern: exercise.movementPattern,
    ...(exercise.liftNote?.trim() ? { liftNote: exercise.liftNote } : {}),
  };
}

/** Plan rows of a lift as new sets: prescription kept, Log empty, log-only extras dropped. */
export function planCopySets(sets: readonly SetData[]) {
  return sets
    .filter((set) => set.scope !== 'log')
    .map((set, i) => ({
      label: `Set ${i + 1}`,
      scope: 'both' as const,
      plannedWeight: set.plannedWeight ?? null,
      plannedReps: set.plannedReps ?? null,
      plannedRpe: (set as { target_value?: number | null }).target_value ?? set.plannedRpe ?? null,
      intensityType: set.intensity_type ?? 'RPE',
      dropPercent: set.dropPercent ?? 0,
      isTop: Boolean(set.isTop),
      isAuto: false,
      actual: null,
      reps: null,
      executedRpe: null,
    }));
}

/** A catalog pick (or a typed custom name) as a new lift, the same way Add lift builds it. */
export function catalogLiftPayload(choice: CatalogExercise | { name: string }): NewLiftPayload {
  if (!('liftCategory' in choice)) {
    return { title: choice.name, variation: choice.name, tier: 'Accessory', liftCategory: 'Other', movementPattern: 'Misc' };
  }
  const variation = choice.tier === 'Comp' ? compileVariation(choice.name, defaultModifiers(choice.liftCategory)) : choice.name;
  return { title: choice.name, variation, tier: choice.tier, liftCategory: choice.liftCategory, movementPattern: choice.movementPattern };
}

type LiftApi = {
  addSessionExercise: (sessionId: string, payload: NewLiftPayload) => Promise<ExerciseData>;
  replaceExerciseSets: (sessionId: string, exerciseId: string, sets: ReturnType<typeof planCopySets>, expectedRevision?: number) => Promise<ExerciseData>;
};

const isStale = (err: unknown) => {
  const status = (err as { status?: number } | null)?.status;
  return status === 409;
};

/**
 * Add a copy of `exercise` (Plan only) to `sessionId`. Returns the new lift.
 * A new lift already has a server revision (it is created with one empty set) that the create
 * reply does not carry, so the copy reads it back before replacing the sets, and re-reads once
 * if the server still calls it stale.
 */
export async function copyLiftIntoSession(
  api: LiftApi,
  sessionId: string,
  exercise: ExerciseData,
  readRevision: (sessionId: string, exerciseId: string) => Promise<number | null>,
): Promise<ExerciseData> {
  const created = await api.addSessionExercise(sessionId, liftCopyPayload(exercise));
  const sets = planCopySets(exercise.sets);
  if (sets.length === 0) return created;
  const write = async () => api.replaceExerciseSets(sessionId, created.id, sets, (await readRevision(sessionId, created.id)) ?? created.revision ?? 0);
  try {
    return await write();
  } catch (err) {
    if (!isStale(err)) throw err;
    return write();
  }
}
