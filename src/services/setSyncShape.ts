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

const MERGE_FIELDS = [
  'label', 'scope', 'plannedWeight', 'plannedReps', 'plannedRpe', 'intensityType',
  'dropPercent', 'actual', 'reps', 'executedRpe',
] as const;

export type SetMergeResult =
  | { ok: true; sets: SyncSet[] }
  | { ok: false; reason: string };

type Indexed = { raw: Record<string, any>; index: number };

function indexById(list: unknown[]): Map<unknown, Indexed> | null {
  const map = new Map<unknown, Indexed>();
  list.forEach((row, index) => map.set((row as any)?.id, { raw: (row ?? {}) as Record<string, any>, index }));
  return map.size === list.length && !map.has(undefined) ? map : null;
}

const valuesOf = (entry: Indexed) => setTrainingValues(entry.raw, entry.index);

/**
 * Three-way merge of a lift's sets after a STALE_REVISION: `base` is what the edit started
 * from, `mine` is the edit, `server` is the current server copy. Sets match by id.
 * - A field takes my value if I changed it from base, otherwise the server's value.
 * - Both sides changing the same field of the same set to different values is a conflict.
 * - Sets I added stay; sets the server added are kept after mine; a set deleted on one side
 *   is dropped unless the other side changed it (then it is a conflict).
 * Order follows my list; `isTop` is re-derived from position by `toSyncSet`.
 */
export function mergeSetLists(base: unknown, mine: unknown, server: unknown): SetMergeResult {
  if (!Array.isArray(base) || !Array.isArray(mine) || !Array.isArray(server)) return { ok: false, reason: 'missing set lists' };
  const B = indexById(base);
  const M = indexById(mine);
  const S = indexById(server);
  if (!B || !M || !S) return { ok: false, reason: 'set ids missing or repeated' };

  const merged: Record<string, any>[] = [];
  for (const [id, m] of M) {
    const b = B.get(id);
    const s = S.get(id);
    const mine = toSyncSet(m.raw, m.index);
    if (!s) {
      // Not on the server: either I added it, or the server deleted it.
      if (b && !sameSetValues(valuesOf(b), valuesOf(m))) return { ok: false, reason: 'set deleted on the server was edited here' };
      if (!b) merged.push(mine);
      continue;
    }
    if (!b) {
      // On both sides but not in the base: no way to tell who changed what, so only an
      // identical copy merges; anything else is reviewed rather than overwriting the server.
      if (!sameSetValues(valuesOf(m), valuesOf(s))) return { ok: false, reason: 'set added on both sides differs' };
      merged.push(mine);
      continue;
    }
    const bv = valuesOf(b);
    const mv = valuesOf(m);
    const sv = valuesOf(s);
    const theirs = toSyncSet(s.raw, s.index);
    const out: Record<string, any> = { ...mine };
    for (const field of MERGE_FIELDS) {
      const mineChanged = (mv[field] ?? null) !== (bv[field] ?? null);
      const serverChanged = (sv[field] ?? null) !== (bv[field] ?? null);
      if (mineChanged && serverChanged && (mv[field] ?? null) !== (sv[field] ?? null)) {
        return { ok: false, reason: `both changed ${String(field)} of a set` };
      }
      if (!mineChanged) out[field] = (theirs as any)[field];
    }
    merged.push(out);
  }
  for (const [id, b] of B) {
    if (M.has(id)) continue;
    const s = S.get(id);
    // I deleted it; keep the deletion unless the server changed that set meanwhile.
    if (s && !sameSetValues(valuesOf(b), valuesOf(s))) return { ok: false, reason: 'set deleted here was edited on the server' };
  }
  for (const [id, s] of S) {
    if (!B.has(id) && !M.has(id)) merged.push(toSyncSet(s.raw, s.index));
  }
  return { ok: true, sets: merged.map((row, index) => toSyncSet(row, index)) };
}
