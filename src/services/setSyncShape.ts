import { trainingNumber } from './numericTraining';

/**
 * The exact set shape sent to the server in an `Exercise` `{ sets }` sync mutation.
 * Both the payload and the edit's baseline (`base_fields.sets`) use it, so a baseline
 * can be compared field-for-field with the server's `al_exercise_sets_snapshot`.
 */
export interface SyncSet {
  id: unknown;
  label: string;
  scope: 'plan' | 'log' | 'both';
  plannedWeight: unknown;
  plannedReps: unknown;
  plannedRpe: unknown;
  intensityType: string;
  dropPercent: unknown;
  isAuto: false;
  isTop: boolean;
  actual: unknown;
  reps: unknown;
  executedRpe: unknown;
}

const scopeOf = (value: unknown): SyncSet['scope'] => (value === 'plan' || value === 'log' ? value : 'both');

/** UI set row (intensity_type / target_value) or server row (intensityType / plannedRpe) → sync shape. */
export function toSyncSet(row: Record<string, any>, index: number): SyncSet {
  return {
    id: row.id,
    label: row.label || `Set ${index + 1}`,
    scope: scopeOf(row.scope),
    plannedWeight: row.plannedWeight ?? null,
    plannedReps: row.plannedReps ?? null,
    plannedRpe: row.target_value ?? row.plannedRpe ?? null,
    intensityType: row.intensity_type || row.intensityType || 'RPE',
    dropPercent: row.dropPercent ?? 0,
    isAuto: false,
    isTop: index === 0,
    actual: row.actual ?? null,
    reps: row.reps ?? null,
    executedRpe: row.executedRpe ?? null,
  };
}

export function toSyncSets(rows: unknown): SyncSet[] {
  return Array.isArray(rows) ? rows.map((row, index) => toSyncSet((row ?? {}) as Record<string, any>, index)) : [];
}

/** Sync-shape set → UI row, for showing a queued edit over a freshly fetched plan. */
export function fromSyncSet(set: Record<string, any>): Record<string, any> {
  return { ...set, intensity_type: set.intensityType || 'RPE', target_value: set.plannedRpe ?? null };
}

/**
 * The user-entered training values of one set, normalized so a UI row, a sync-shape row
 * and a server snapshot row with the same values compare equal. `isTop`/`isAuto` are left
 * out: the client always derives them (position / false), so they carry no edit.
 * Set order is compared separately by id.
 */
export function setTrainingValues(row: Record<string, any>, index: number) {
  const set = toSyncSet(row, index);
  return {
    label: String(set.label),
    scope: set.scope,
    plannedWeight: trainingNumber(set.plannedWeight),
    plannedReps: trainingNumber(set.plannedReps),
    plannedRpe: trainingNumber(set.plannedRpe),
    intensityType: String(set.intensityType).toUpperCase(),
    dropPercent: trainingNumber(set.dropPercent) ?? 0,
    actual: trainingNumber(set.actual),
    reps: trainingNumber(set.reps),
    executedRpe: trainingNumber(set.executedRpe),
  };
}

export type SetTrainingValues = ReturnType<typeof setTrainingValues>;

export function sameSetValues(a: SetTrainingValues, b: SetTrainingValues): boolean {
  return (Object.keys(a) as (keyof SetTrainingValues)[]).every((key) => (a[key] ?? null) === (b[key] ?? null));
}

/**
 * Same set ids with the same training values. Matched by id, not position: the server
 * orders by a text rank ('a' || index), so 11+ sets come back as a0, a1, a10, a2, ….
 */
export function setListsMatch(base: unknown, server: unknown): boolean {
  if (!Array.isArray(base) || !Array.isArray(server) || base.length !== server.length) return false;
  const serverById = new Map<unknown, { row: any; index: number }>(server.map((row: any, index) => [row?.id, { row, index }]));
  if (serverById.size !== server.length) return false;
  return base.every((row: any, index) => {
    const other = serverById.get(row?.id);
    return !!row && !!other
      && sameSetValues(setTrainingValues(row, index), setTrainingValues(other.row, other.index));
  });
}

interface QueuedSetsEdit {
  entity_type: string;
  entity_id: string;
  workout_id?: string;
  fields?: Record<string, any>;
  base_revision?: number;
  updated_at?: string;
}

/**
 * Show still-queued `Exercise` set edits over a freshly fetched plan. A reload after an
 * earlier save is acknowledged must not put server values back into the grid while a
 * later edit of the same lift is waiting to sync; the next edit would then be built
 * from (and send) the stale rows. Returns `data` unchanged when nothing applies.
 *
 * The overlaid lift also keeps the queued edit's base revision, not the fetched one: the
 * shown sets are only known to be based on that revision. A follow-up edit then cannot
 * pair the fetched (possibly coach-changed) revision with these older sets and silently
 * overwrite that change; it conflicts or self-rebases like the queued edit does.
 */
export function overlayQueuedExerciseSets<T>(data: T, queued: QueuedSetsEdit[]): T {
  const latest = new Map<string, QueuedSetsEdit>();
  for (const edit of queued) {
    if (edit.entity_type !== 'Exercise' || !edit.workout_id || !Array.isArray(edit.fields?.sets)) continue;
    const key = `${edit.workout_id}\u0000${edit.entity_id}`;
    const prior = latest.get(key);
    if (!prior || String(edit.updated_at ?? '') >= String(prior.updated_at ?? '')) latest.set(key, edit);
  }
  if (latest.size === 0 || !Array.isArray(data)) return data;
  return data.map((microcycle: any) => {
    if (!Array.isArray(microcycle?.workouts)) return microcycle;
    return {
      ...microcycle,
      workouts: microcycle.workouts.map((workout: any) => {
        if (!Array.isArray(workout?.exercises)) return workout;
        let changed = false;
        const exercises = workout.exercises.map((exercise: any) => {
          const edit = latest.get(`${workout.id}\u0000${exercise?.id}`);
          if (!edit) return exercise;
          changed = true;
          return {
            ...exercise,
            ...(edit.base_revision !== undefined ? { revision: edit.base_revision } : {}),
            sets: (edit.fields!.sets as Record<string, any>[]).map(fromSyncSet),
          };
        });
        return changed ? { ...workout, exercises } : workout;
      }),
    };
  }) as T;
}
