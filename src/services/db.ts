import {
  databaseNameForBoundary,
  IS_FRESH_PRODUCTION_CLIENT,
  legacyIndexedDbImportAllowed,
  mutationVisibleToAccount,
} from './clientDataBoundary';

export const DB_NAME = databaseNameForBoundary(IS_FRESH_PRODUCTION_CLIENT);
const LEGACY_DB_NAME = 'obsidian_kinetic_db';
export const DB_VERSION = 1;

let openPromise: Promise<IDBDatabase> | null = null;

export interface SyncMutation {
  mutation_id: string;
  /** Actor account that created the local edit; required for production queue isolation. */
  account_id?: string;
  client_device_id: string;
  workout_id?: string;
  entity_type: string;
  entity_id: string;
  field_path: string; // 'ALL' or specific field
  fields: Record<string, any>;
  base_revision?: number;
  base_fields?: Record<string, any>;
  snapshot_key?: string;
  conflict?: Record<string, any>;
  resolved_at?: string;
  updated_at: string;
  status: 'PENDING' | 'IN_FLIGHT' | 'ACKED' | 'REJECTED' | 'CONFLICTED' | 'RESOLVED_SERVER';
  retry_count: number;
}

export function isMutationCleanupEligible(mutation: SyncMutation, cutoff: Date): boolean {
  if (mutation.status === 'CONFLICTED') return false;
  if (mutation.status !== 'ACKED' && mutation.status !== 'REJECTED' && mutation.status !== 'RESOLVED_SERVER') return false;
  const retainedAt = mutation.status === 'RESOLVED_SERVER' ? mutation.resolved_at : mutation.updated_at;
  return !!retainedAt && new Date(retainedAt) < cutoff;
}

function ensureStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('snapshots')) {
    db.createObjectStore('snapshots', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('mutations')) {
    db.createObjectStore('mutations', { keyPath: 'mutation_id' });
  }
  if (!db.objectStoreNames.contains('tombstones')) {
    db.createObjectStore('tombstones', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('metadata')) {
    db.createObjectStore('metadata', { keyPath: 'key' });
  }
}

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      ensureStores(event.target.result);
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
}

function readAll(db: IDBDatabase, storeName: string): Promise<any[]> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function writeAll(db: IDBDatabase, storeName: string, records: any[]): Promise<void> {
  if (!db.objectStoreNames.contains(storeName) || records.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach((record) => store.put(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Merge without dropping records. Conflicting copies stop migration and keep the legacy DB. */
export function legacyStoreAdditions(
  storeName: string,
  sourceRecords: any[],
  destinationRecords: any[],
): any[] {
  const keys: Record<string, string> = {
    snapshots: 'id', mutations: 'mutation_id', tombstones: 'id', metadata: 'key',
  };
  const keyField = keys[storeName];
  if (!keyField) throw new Error(`Unsupported legacy IndexedDB store: ${storeName}`);
  const destination = new Map(destinationRecords.map(record => [record[keyField], record]));
  const additions: any[] = [];
  for (const record of sourceRecords) {
    const key = record?.[keyField];
    if (typeof key !== 'string' || !key) {
      throw new Error(`Invalid ${storeName} record key; legacy database retained`);
    }
    const existing = destination.get(key);
    if (existing === undefined) {
      destination.set(key, record);
      additions.push(record);
    } else if (stableJson(existing) !== stableJson(record)) {
      throw new Error(`Conflicting ${storeName} record ${key}; legacy database retained for recovery`);
    }
  }
  return additions;
}

async function migrateLegacyIndexedDB(): Promise<void> {
  // Keep historical browser data inert on the fresh production installation.
  // The old database is left intact for explicit user recovery; it is never
  // opened, copied, replayed, or deleted by production code.
  if (!legacyIndexedDbImportAllowed(IS_FRESH_PRODUCTION_CLIENT)) return;
  if (typeof indexedDB.databases !== 'function') return;
  const names = (await indexedDB.databases()).map((entry) => entry.name || '');
  if (!names.includes(LEGACY_DB_NAME)) return;

  const source = await openNamed(LEGACY_DB_NAME);
  const dest = await openNamed(DB_NAME);
  try {
    for (const storeName of ['snapshots', 'mutations', 'tombstones', 'metadata']) {
      const sourceRecords = await readAll(source, storeName);
      const destinationRecords = await readAll(dest, storeName);
      const additions = legacyStoreAdditions(storeName, sourceRecords, destinationRecords);
      await writeAll(dest, storeName, additions);
    }
  } finally {
    source.close();
    dest.close();
  }

  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = migrateLegacyIndexedDB()
      .then(() => openNamed(DB_NAME))
      .catch((err) => {
        openPromise = null;
        throw err;
      });
  }
  return openPromise;
}

export async function saveMutation(mutation: SyncMutation): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.put(mutation);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingMutations(workout_id?: string, accountId?: string): Promise<SyncMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const store = tx.objectStore('mutations');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as SyncMutation[];
      const pending = all.filter(m => (m.status === 'PENDING' || m.status === 'IN_FLIGHT') &&
        mutationVisibleToAccount(m, accountId, IS_FRESH_PRODUCTION_CLIENT));
      resolve(workout_id ? pending.filter((m) => m.workout_id === workout_id) : pending);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getConflictedMutations(accountId?: string): Promise<SyncMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const req = tx.objectStore('mutations').getAll();
    req.onsuccess = () => resolve((req.result as SyncMutation[]).filter(m =>
      m.status === 'CONFLICTED' && mutationVisibleToAccount(m, accountId, IS_FRESH_PRODUCTION_CLIENT)));
    req.onerror = () => reject(req.error);
  });
}

export async function countMutationsByStatus(status: SyncMutation['status'], accountId?: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const store = tx.objectStore('mutations');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as SyncMutation[];
      resolve(all.filter((m) => m.status === status &&
        mutationVisibleToAccount(m, accountId, IS_FRESH_PRODUCTION_CLIENT)).length);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateMutationStatus(mutation_id: string, status: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.get(mutation_id);
    req.onsuccess = () => {
      if (req.result) {
        req.result.status = status;
        store.put(req.result);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateMutationConflict(mutation_id: string, conflict: Record<string, any>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.get(mutation_id);
    req.onsuccess = () => {
      if (req.result) {
        req.result.status = 'CONFLICTED';
        req.result.conflict = conflict;
        store.put(req.result);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function applyServerFields(data: any[], mutation: SyncMutation): any[] {
  if (mutation.conflict?.reason === 'TOMBSTONE_CONFLICT') {
    return data.map(microcycle => ({ ...microcycle, workouts: microcycle.workouts
      .filter((workout: any) => !(mutation.entity_type === 'Workout' && workout.id === mutation.entity_id))
      .map((workout: any) => {
        if (workout.id !== mutation.workout_id) return workout;
        if (mutation.entity_type === 'Exercise') {
          return { ...workout, exercises: workout.exercises.filter((exercise: any) => exercise.id !== mutation.entity_id) };
        }
        if (mutation.entity_type === 'ExerciseSet') {
          return { ...workout, exercises: workout.exercises.map((exercise: any) => ({
            ...exercise, sets: exercise.sets.filter((set: any) => set.id !== mutation.entity_id),
          })) };
        }
        return workout;
      }) }));
  }
  const fieldAliases: Record<string, string> = {
    dayLabel: 'dayLabel', athlete_bw: 'athleteBw', block_label: 'blockLabel', week_label: 'weekLabel',
    lift_category: 'liftCategory', movement_pattern: 'movementPattern', lift_note: 'liftNote',
    plannedWeight: 'plannedWeight', plannedReps: 'plannedReps', plannedRpe: 'plannedRpe',
    executedRpe: 'executedRpe', intensity_type: 'intensityType', dropPercent: 'dropPercent',
    isAuto: 'isAuto', isTop: 'isTop', actual: 'actual', reps: 'reps', note: 'note',
  };
  const assign = (target: any, fields: Record<string, any>) => {
    for (const [key, value] of Object.entries(fields)) target[fieldAliases[key] || key] = value;
    if (Number.isSafeInteger(mutation.conflict?.server_revision) && mutation.conflict.server_revision > 0) {
      target.revision = mutation.conflict.server_revision;
    }
  };
  return data.map(mc => ({ ...mc, workouts: mc.workouts.map((workout: any) => {
    if (workout.id !== mutation.workout_id) return workout;
    if (mutation.entity_type === 'Workout' && workout.id === mutation.entity_id) {
      const result = { ...workout }; assign(result, mutation.conflict?.server_fields || {}); return result;
    }
    return { ...workout, exercises: workout.exercises.map((exercise: any) => {
      if (mutation.entity_type === 'Exercise' && exercise.id === mutation.entity_id) {
        const result = { ...exercise }; assign(result, mutation.conflict?.server_fields || {}); return result;
      }
      if (mutation.entity_type === 'ExerciseSet') {
        return { ...exercise, sets: exercise.sets.map((set: any) => {
          if (set.id !== mutation.entity_id) return set;
          const result = { ...set }; assign(result, mutation.conflict?.server_fields || {}); return result;
        }) };
      }
      return exercise;
    }) };
  }) }));
}

/** Resolve only after the server snapshot update and status change commit atomically. */
export async function resolveMutationKeepServer(mutationId: string, accountId?: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['mutations', 'snapshots'], 'readwrite');
    const mutations = tx.objectStore('mutations');
    const snapshots = tx.objectStore('snapshots');
    const req = mutations.get(mutationId);
    req.onsuccess = () => {
      const mutation = req.result as SyncMutation | undefined;
      if (!mutation || mutation.status !== 'CONFLICTED' ||
          !mutationVisibleToAccount(mutation, accountId, IS_FRESH_PRODUCTION_CLIENT)) { tx.abort(); return; }
      const finish = (rows: any[]) => {
        for (const row of rows) {
          if (!Array.isArray(row?.data)) continue;
          snapshots.put({ ...row, data: applyServerFields(row.data, mutation), updated_at: new Date().toISOString() });
        }
        mutation.status = 'RESOLVED_SERVER';
        mutation.resolved_at = new Date().toISOString();
        mutations.put(mutation);
      };
      if (mutation.snapshot_key) {
        const snapshotReq = snapshots.get(mutation.snapshot_key);
        snapshotReq.onsuccess = () => {
          const row = snapshotReq.result;
          finish(row ? [row] : []);
        };
        snapshotReq.onerror = () => tx.abort();
        return;
      }
      // Schema-v1 queued edits have no snapshot key. Find only caches that
      // contain this exact globally keyed workout/entity; never guess an owner.
      const allSnapshotsReq = snapshots.getAll();
      allSnapshotsReq.onsuccess = () => {
        const rows = (allSnapshotsReq.result as any[]).filter(row =>
          Array.isArray(row?.data) && row.data.some((microcycle: any) =>
            Array.isArray(microcycle?.workouts) && microcycle.workouts.some((workout: any) =>
              workout?.id === mutation.workout_id && (
                mutation.entity_type === 'Workout' && workout.id === mutation.entity_id ||
                Array.isArray(workout?.exercises) && workout.exercises.some((exercise: any) =>
                  mutation.entity_type === 'Exercise' && exercise?.id === mutation.entity_id ||
                  mutation.entity_type === 'ExerciseSet' && Array.isArray(exercise?.sets) && exercise.sets.some((set: any) => set?.id === mutation.entity_id)
                )
              )
            )
          )
        );
        finish(rows);
      };
      allSnapshotsReq.onerror = () => tx.abort();
    };
    req.onerror = () => tx.abort();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Conflict resolution was not persisted'));
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync-server-state-restored'));
}

export async function exportConflictMutation(mutationId: string, accountId?: string): Promise<SyncMutation | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const req = tx.objectStore('mutations').get(mutationId);
    req.onsuccess = () => {
      const mutation = req.result as SyncMutation | undefined;
      resolve(mutation && mutationVisibleToAccount(mutation, accountId, IS_FRESH_PRODUCTION_CLIENT) ? mutation : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export function microcycleSnapshotKey(ownerId: string): string {
  return `microcycles:${ownerId}`;
}

export async function saveSnapshot(id: string, data: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    const req = store.put({ id, data, updated_at: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSnapshot(id: string): Promise<any | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const req = store.get(id);
    req.onsuccess = () => {
      resolve(req.result ? req.result.data : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSnapshot(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const req = tx.objectStore('snapshots').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function evictOldSyncedData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const req = store.openCursor();
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    
    req.onsuccess = (event: any) => {
      const cursor = event.target.result;
      if (cursor) {
        const m = cursor.value;
        if (isMutationCleanupEligible(m, cutoff)) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

