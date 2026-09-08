import { MicrocycleData } from '../types';
import { clearSnapshot, getSnapshot, saveSnapshot } from './db';

export const PLAN_SCHEMA = 1;

/** Pre-schema snapshot: a bare MicrocycleData[] shared by every athlete. */
export const LEGACY_PLAN_SNAPSHOT_ID = 'microcycles';

export type PlanSource = 'imported' | 'api' | 'local';

export interface StoredPlan {
  schema: number;
  athleteId: string | null;
  source: PlanSource;
  /** Fingerprint of the import this copy was built from. Null for api and local plans. */
  planVersion: string | null;
  /**
   * Sessions edited in the app. They are the athlete's work, so a refreshed
   * import must not overwrite them.
   */
  ownedWorkoutIds: string[];
  microcycles: MicrocycleData[];
}

export function planSnapshotId(athleteId: string | null): string {
  return athleteId ? `plan:${athleteId}` : 'plan:default';
}

function looksLikePlan(microcycles: unknown): microcycles is MicrocycleData[] {
  return (
    Array.isArray(microcycles) &&
    microcycles.length > 0 &&
    Array.isArray((microcycles[0] as MicrocycleData | undefined)?.workouts)
  );
}

/** Narrow an untrusted snapshot payload, so a stale or corrupt record is ignored. */
export function asStoredPlan(raw: unknown): StoredPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as {
    schema?: unknown;
    athleteId?: string | null;
    source?: unknown;
    planVersion?: string | null;
    ownedWorkoutIds?: unknown;
    microcycles?: unknown;
  };
  if (candidate.schema !== PLAN_SCHEMA) return null;
  if (!looksLikePlan(candidate.microcycles)) return null;
  // Pre-athlete snapshots used source 'seed'. They are unowned and must not load.
  if (candidate.source === 'seed') return null;
  const source: PlanSource =
    candidate.source === 'imported' || candidate.source === 'api' || candidate.source === 'local'
      ? candidate.source
      : 'local';
  return {
    schema: PLAN_SCHEMA,
    athleteId: candidate.athleteId ?? null,
    source,
    planVersion: candidate.planVersion ?? null,
    ownedWorkoutIds: Array.isArray(candidate.ownedWorkoutIds) ? candidate.ownedWorkoutIds : [],
    microcycles: candidate.microcycles,
  };
}

export function planSharesStructure(source: MicrocycleData[], cached: MicrocycleData[]): boolean {
  const sourceIds = new Set(source.flatMap((micro) => [micro.id, ...micro.workouts.map((w) => w.id)]));
  return cached.some(
    (micro) => sourceIds.has(micro.id) || micro.workouts.some((workout) => sourceIds.has(workout.id)),
  );
}

/**
 * Rebuild a cached plan on top of a refreshed import.
 *
 * The import owns structure and any session nobody has touched, so a corrected
 * conversion reaches the coach without being asked to re-import. Sessions edited
 * in the app, and sessions added in the app, are carried across untouched.
 */
export function reconcileImportedPlan(
  source: MicrocycleData[],
  stored: StoredPlan,
): MicrocycleData[] {
  const owned = new Set(stored.ownedWorkoutIds);
  const cachedById = new Map(stored.microcycles.map((micro) => [micro.id, micro]));
  const sourceMicroIds = new Set(source.map((micro) => micro.id));

  const merged: MicrocycleData[] = source.map((micro) => {
    const cached = cachedById.get(micro.id);
    if (!cached) return micro;

    const cachedWorkouts = new Map(cached.workouts.map((workout) => [workout.id, workout]));
    const sourceWorkoutIds = new Set(micro.workouts.map((workout) => workout.id));

    const workouts = micro.workouts.map((workout) => {
      const local = cachedWorkouts.get(workout.id);
      return local && owned.has(workout.id) ? local : workout;
    });

    for (const local of cached.workouts) {
      if (!sourceWorkoutIds.has(local.id) && owned.has(local.id)) workouts.push(local);
    }

    return { ...micro, workouts };
  });

  for (const cached of stored.microcycles) {
    if (sourceMicroIds.has(cached.id)) continue;
    const kept = cached.workouts.filter((workout) => owned.has(workout.id));
    if (kept.length > 0) merged.push({ ...cached, workouts: kept });
  }

  return merged;
}

/**
 * Best-effort ownership for a cache that predates edit tracking: a session that
 * already differs from the import must have been changed here. Keeping too much
 * only delays an import fix; keeping too little would destroy logged sets.
 */
export function inferOwnedWorkoutIds(
  source: MicrocycleData[],
  cached: MicrocycleData[],
): string[] {
  const sourceWorkouts = new Map<string, string>();
  const sourceMicroIds = new Set(source.map((micro) => micro.id));
  for (const micro of source) {
    for (const workout of micro.workouts) {
      sourceWorkouts.set(workout.id, JSON.stringify(workout));
    }
  }

  const owned: string[] = [];
  for (const micro of cached) {
    if (!sourceMicroIds.has(micro.id)) continue;
    for (const workout of micro.workouts) {
      const fromSource = sourceWorkouts.get(workout.id);
      if (fromSource === undefined || fromSource !== JSON.stringify(workout)) {
        owned.push(workout.id);
      }
    }
  }
  return owned;
}

export async function readStoredPlan(athleteId: string | null): Promise<StoredPlan | null> {
  try {
    return asStoredPlan(await getSnapshot(planSnapshotId(athleteId)));
  } catch (err) {
    console.error('Failed to read the cached plan from IndexedDB:', err);
    return null;
  }
}

export async function writeStoredPlan(plan: StoredPlan): Promise<void> {
  try {
    await saveSnapshot(planSnapshotId(plan.athleteId), plan);
  } catch (err) {
    console.error('Failed to write the cached plan to IndexedDB:', err);
  }
}

export async function clearStoredPlan(athleteId: string | null): Promise<void> {
  try {
    await clearSnapshot(planSnapshotId(athleteId));
  } catch (err) {
    console.error('Failed to clear the cached plan in IndexedDB:', err);
  }
}

/**
 * Move the pre-schema shared snapshot onto the active athlete's key. Version is
 * left null so the next load reconciles it against the current import.
 */
export async function migrateLegacyPlanSnapshot(
  athleteId: string | null,
  source: MicrocycleData[] | null,
): Promise<StoredPlan | null> {
  let legacy: unknown;
  try {
    legacy = await getSnapshot(LEGACY_PLAN_SNAPSHOT_ID);
  } catch (err) {
    console.error('Failed to read the legacy plan snapshot:', err);
    return null;
  }
  if (!looksLikePlan(legacy)) {
    if (legacy != null) await clearSnapshot(LEGACY_PLAN_SNAPSHOT_ID);
    return null;
  }

  const existing = await readStoredPlan(athleteId);
  if (existing) {
    await clearSnapshot(LEGACY_PLAN_SNAPSHOT_ID);
    return existing;
  }

  // The shared snapshot was the unowned seed. Never attach it to an athlete.
  if (!source || !planSharesStructure(source, legacy)) {
    await clearSnapshot(LEGACY_PLAN_SNAPSHOT_ID);
    return null;
  }

  const migrated: StoredPlan = {
    schema: PLAN_SCHEMA,
    athleteId,
    source: 'imported',
    planVersion: null,
    ownedWorkoutIds: source ? inferOwnedWorkoutIds(source, legacy) : [],
    microcycles: legacy,
  };
  await writeStoredPlan(migrated);
  await clearSnapshot(LEGACY_PLAN_SNAPSHOT_ID);
  return migrated;
}
