import { clearAuthorization } from './authAuthorization';
import { SyncMutation, saveMutation, getPendingMutations, updateMutationStatus, updateMutationConflict, deleteSupersededMutation } from './db';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';
import { MATH_VERSION } from './mathEngine';
import { API_BASE_URL } from './apiBase';
import { IS_FRESH_PRODUCTION_CLIENT } from './clientDataBoundary';
import { mergeSetLists, setListsMatch } from './setSyncShape';

let syncTimeout: number | null = null;
let insightSyncTimeout: number | null = null;
const SYNC_DEBOUNCE_MS = 2000;

const BACKEND_URL = API_BASE_URL;

export const LOCK_SYNC_CODES = new Set(['WORKOUT_LOCKED']);

/** In-flight IndexedDB rows may still use this fake workout_id. Do not send it on new payloads. */
export const LEGACY_INSIGHT_CARD_WORKOUT_ID = 'insight-cards';

export function isInsightCardMutation(m: Pick<SyncMutation, 'entity_type' | 'workout_id'>): boolean {
  return m.entity_type === 'InsightCard' || m.workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID;
}

let lastStamp = 0;
/**
 * Strictly increasing edit time for this tab: two edits in the same millisecond still
 * order correctly, which planSyncBatch relies on to tell which edit is newer.
 */
function nextEditStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

function generateMutationId() {
  return 'mut-' + Math.random().toString(36).substr(2, 9);
}

function getDeviceId() {
  let id = getUiPref(UI_KEYS.deviceId);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).substr(2, 9);
    setUiPref(UI_KEYS.deviceId, id);
  }
  return id;
}

export function mutationsForWorkout(pending: SyncMutation[], workout_id: string): SyncMutation[] {
  return pending.filter((m) => !isInsightCardMutation(m) && m.workout_id === workout_id);
}

export function mutationsForInsightCards(pending: SyncMutation[]): SyncMutation[] {
  return pending.filter(isInsightCardMutation);
}

export function parseSyncErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { detail?: unknown; error?: { code?: unknown } };
  const detail = root.detail;
  if (detail && typeof detail === 'object') {
    const nested = detail as { error?: { code?: unknown }; code?: unknown };
    if (typeof nested.error?.code === 'string') return nested.error.code;
    if (typeof nested.code === 'string') return nested.code;
  }
  if (typeof root.error?.code === 'string') return root.error.code;
  return null;
}

export function parseSyncErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const root = body as { detail?: unknown; error?: { message?: unknown } };
  const detail = root.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    const nested = detail as { error?: { message?: unknown }; message?: unknown };
    if (typeof nested.error?.message === 'string' && nested.error.message.trim()) {
      return nested.error.message;
    }
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
  }
  if (typeof root.error?.message === 'string' && root.error.message.trim()) {
    return root.error.message;
  }
  return fallback;
}

function parseSyncErrorDetails(body: unknown): Record<string, any> | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { detail?: unknown; error?: { details?: unknown } };
  const value = (root.detail && typeof root.detail === 'object'
    ? (root.detail as { error?: { details?: unknown }; details?: unknown }).error?.details
      ?? (root.detail as { details?: unknown }).details
    : root.error?.details);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export function isLockSyncCode(code: string | null | undefined): boolean {
  return Boolean(code && LOCK_SYNC_CODES.has(code));
}

export async function queueMutation(
  workout_id: string,
  entity_type: string,
  entity_id: string,
  fields: Record<string, any>,
  baseline: { revision?: number; fields?: Record<string, any>; snapshot_key?: string } = {},
) {
  const accountId = IS_FRESH_PRODUCTION_CLIENT ? getUiPref(UI_KEYS.userId) || undefined : undefined;
  if (entity_type === 'InsightCard' || workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID) {
    await queueInsightCardMutation(entity_id, fields, accountId);
    return;
  }
  const prior = (await getPendingMutations(workout_id, accountId)).find(m =>
    m.entity_type === entity_type && m.entity_id === entity_id && m.status === 'PENDING'
  );
  if (prior) {
    prior.fields = entity_type === 'Exercise' ? fields : { ...prior.fields, ...fields };
    // Keep the first server-observed baseline for this coalesced local edit.
    prior.base_revision ??= baseline.revision;
    prior.base_fields ??= baseline.fields;
    prior.snapshot_key ??= baseline.snapshot_key;
    prior.updated_at = nextEditStamp();
    await saveMutation(prior);
    scheduleSync(workout_id, accountId);
    return;
  }
  const mut: SyncMutation = {
    mutation_id: generateMutationId(),
    ...(accountId ? { account_id: accountId } : {}),
    client_device_id: getDeviceId(),
    workout_id,
    entity_type,
    entity_id,
    field_path: 'ALL',
    fields,
    base_revision: baseline.revision,
    base_fields: baseline.fields,
    snapshot_key: baseline.snapshot_key,
    updated_at: nextEditStamp(),
    status: 'PENDING',
    retry_count: 0
  };

  await saveMutation(mut);
  scheduleSync(workout_id, accountId);
}

export async function queueInsightCardMutation(entity_id: string, fields: Record<string, any>, accountId?: string) {
  const mut: SyncMutation = {
    mutation_id: generateMutationId(),
    ...(accountId ? { account_id: accountId } : {}),
    client_device_id: getDeviceId(),
    entity_type: 'InsightCard',
    entity_id,
    field_path: 'ALL',
    fields,
    updated_at: new Date().toISOString(),
    status: 'PENDING',
    retry_count: 0
  };
  await saveMutation(mut);
  scheduleInsightCardSync(accountId);
}

function scheduleSync(workout_id: string, accountId?: string) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = window.setTimeout(async () => {
    syncTimeout = null;
    const conflicts = await processSyncQueue(workout_id, accountId);
    if (conflicts && conflicts.length > 0) {
      window.dispatchEvent(new CustomEvent('sync-conflicts', { detail: conflicts }));
    }
  }, SYNC_DEBOUNCE_MS);
}

function scheduleInsightCardSync(accountId?: string) {
  if (insightSyncTimeout) {
    clearTimeout(insightSyncTimeout);
  }
  insightSyncTimeout = window.setTimeout(async () => {
    insightSyncTimeout = null;
    const conflicts = await processInsightCardSync(accountId);
    if (conflicts && conflicts.length > 0) {
      window.dispatchEvent(new CustomEvent('sync-conflicts', { detail: conflicts }));
    }
  }, SYNC_DEBOUNCE_MS);
}

const MAX_SELF_CONFLICT_REBASES = 5;

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

// Baselines from older builds are raw UI rows (intensity_type / target_value); the server
// snapshot is normalized. setListsMatch normalizes both sides before comparing.
const setsMatch = setListsMatch;

/**
 * True when the server rejected an edit as STALE_REVISION but every field the edit changes
 * still has the value the edit was based on. That happens when our own earlier saves raised the
 * server revision before this device refreshed its copy. Nobody else's change is overwritten,
 * so the edit can be re-based on the server revision and sent again. Anything that differs,
 * or any field we cannot compare, stays a real conflict for review.
 */
export function isSelfConflict(mutation: SyncMutation, conflict: Record<string, any>): boolean {
  if (conflict?.reason !== 'STALE_REVISION') return false;
  const serverRevision = conflict.server_revision;
  if (!Number.isSafeInteger(serverRevision) || serverRevision <= (mutation.base_revision ?? 0)) return false;
  const base = mutation.base_fields;
  const server = conflict.server_fields;
  if (!base || typeof base !== 'object' || !server || typeof server !== 'object') return false;
  const keys = Object.keys(mutation.fields || {});
  if (keys.length === 0) return false;
  return keys.every((key) => key in base && key in server
    && (key === 'sets' ? setsMatch(base[key], server[key]) : sameValue(base[key], server[key])));
}

/**
 * For a STALE_REVISION on a lift's sets, the fields to resend on top of the server copy:
 * a three-way merge of (what the edit started from, the edit, the server copy). Returns
 * null when it cannot merge safely; then the conflict goes to review.
 */
export function mergeForResend(mutation: SyncMutation, conflict: Record<string, any>): Record<string, any> | null {
  if (conflict?.reason !== 'STALE_REVISION') return null;
  const serverRevision = conflict.server_revision;
  if (!Number.isSafeInteger(serverRevision) || serverRevision <= (mutation.base_revision ?? 0)) return null;
  const base = mutation.base_fields;
  const server = conflict.server_fields;
  const fields = mutation.fields || {};
  if (!base || typeof base !== 'object' || !server || typeof server !== 'object') return null;
  if (isSelfConflict(mutation, conflict)) return fields;
  if (mutation.entity_type !== 'Exercise' || !Array.isArray(fields.sets)) return null;
  // Any other field on the lift must still be as the edit started from.
  const others = Object.keys(fields).filter((key) => key !== 'sets');
  if (!others.every((key) => key in base && key in server && sameValue(base[key], server[key]))) return null;
  const merged = mergeSetLists(base.sets, fields.sets, server.sets);
  return merged.ok ? { ...fields, sets: merged.sets } : null;
}

async function rebaseSelfConflicts(
  pending: SyncMutation[],
  conflicts: any[],
): Promise<{ remaining: any[]; rebased: SyncMutation[] }> {
  const remaining: any[] = [];
  const rebased: SyncMutation[] = [];
  for (const conflict of conflicts) {
    const mutation = pending.find(item => item.mutation_id === conflict?.mutation_id);
    const resend = mutation && (mutation.rebase_count ?? 0) < MAX_SELF_CONFLICT_REBASES
      ? mergeForResend(mutation, conflict)
      : null;
    if (mutation && resend) {
      mutation.fields = resend;
      mutation.base_revision = conflict.server_revision;
      mutation.base_fields = conflict.server_fields;
      mutation.rebase_count = (mutation.rebase_count ?? 0) + 1;
      mutation.status = 'PENDING';
      await saveMutation(mutation);
      rebased.push(mutation);
    } else {
      remaining.push(conflict);
    }
  }
  return { remaining, rebased };
}

function scheduleRebasedSync(rebased: SyncMutation[]) {
  if (rebased.length === 0 || typeof window === 'undefined') return;
  const first = rebased[0];
  if (first.workout_id) scheduleSync(first.workout_id, first.account_id);
}

async function postSync(
  url: string,
  payload: Record<string, unknown>,
  pending: SyncMutation[],
  lockWorkoutId?: string,
): Promise<any[]> {
  try {
    for (const m of pending) await updateMutationStatus(m.mutation_id, 'IN_FLIGHT');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      if (result.math_version && result.math_version !== MATH_VERSION) {
        for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
        return [{
          reason: 'MATH_VERSION_MISMATCH',
          message: 'Client math version does not match the server. App update required.',
          workout_id: lockWorkoutId,
        }];
      }

      for (const id of result.accepted_mutation_ids || []) {
        await updateMutationStatus(id, 'ACKED');
      }
      const returnedConflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
      const conflictingIds = new Set(returnedConflicts.map((item: any) => item?.mutation_id).filter((id: unknown): id is string => typeof id === 'string'));
      for (const id of result.rejected_mutations || result.rejected_mutation_ids || []) {
        if (!conflictingIds.has(id)) await updateMutationStatus(id, 'REJECTED');
      }
      for (const conflict of returnedConflicts) {
        const mutation = pending.find(item => item.mutation_id === conflict?.mutation_id);
        if (mutation) await updateMutationConflict(mutation.mutation_id, { ...conflict, client_fields: mutation.fields });
      }
      if ((result.accepted_mutation_ids || []).length > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sync-server-state-restored'));
      }
      return returnedConflicts;
    } else if (response.status === 409) {
      const err = await response.json().catch(() => ({}));
      const code = parseSyncErrorCode(err) || '409_CONFLICT';
      const message = parseSyncErrorMessage(err, 'This workout is locked right now.');
      if (code === 'SYNC_CONFLICT_REVIEW') {
        const details = parseSyncErrorDetails(err) || {};
        const allConflicts = Array.isArray(details.conflicts) ? details.conflicts : [];
        const acceptedIds = Array.isArray(details.accepted_mutation_ids) ? details.accepted_mutation_ids : [];
        for (const id of acceptedIds) await updateMutationStatus(id, 'ACKED');
        const { remaining: conflicts, rebased } = await rebaseSelfConflicts(pending, allConflicts);
        const conflictingIds = new Set<string>();
        for (const conflict of conflicts) {
          if (typeof conflict.mutation_id !== 'string') continue;
          conflictingIds.add(conflict.mutation_id);
          await updateMutationConflict(conflict.mutation_id, conflict);
        }
        for (const m of pending) {
          if (!acceptedIds.includes(m.mutation_id) && !conflictingIds.has(m.mutation_id)) {
            await updateMutationStatus(m.mutation_id, 'PENDING');
          }
        }
        scheduleRebasedSync(rebased);
        return conflicts.map((conflict: any) => ({
          ...conflict,
          reason: conflict.reason || code,
          message,
        }));
      }
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
      if (code === 'MATH_VERSION_MISMATCH') {
        return [{ reason: code, workout_id: lockWorkoutId, message }];
      }
      if (isLockSyncCode(code) || code === '409_CONFLICT') {
        window.dispatchEvent(new CustomEvent('sync-lock', {
          detail: { workout_id: lockWorkoutId, code: code === '409_CONFLICT' ? 'WORKOUT_LOCKED' : code, message },
        }));
        return [];
      }
      return [{ reason: code, workout_id: lockWorkoutId, message }];
    } else {
      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401 || parseSyncErrorCode(body) === 'EMAIL_VERIFICATION_REQUIRED') {
          await clearAuthorization();
          window.dispatchEvent(new Event('auth-access-denied'));
        }
      }
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
    }
  } catch (err) {
    for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
  }
  return [];
}

export async function processInsightCardSync(accountId?: string): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const pending = mutationsForInsightCards(await getPendingMutations(undefined, accountId));
  if (pending.length === 0) return [];

  const payload = {
    schema_version: 1,
    mutation_type: 'insight_card',
    client_device_id: getDeviceId(),
    last_updated_at: new Date().toISOString(),
    math_version: MATH_VERSION,
    changes: pending.map(m => ({
      entity: m.entity_type,
      id: m.entity_id,
      mutation_id: m.mutation_id,
      updated_at: m.updated_at,
      ...(m.base_revision !== undefined ? { base_revision: m.base_revision } : {}),
      ...(m.base_fields !== undefined ? { base_fields: m.base_fields } : {}),
      fields: m.fields
    }))
  };

  return postSync(`${BACKEND_URL}/api/insight-cards/sync`, payload, pending);
}

const scopeOf = (m: SyncMutation) => `${m.entity_type}:${m.entity_id}`;
const fieldKeys = (m: SyncMutation) => Object.keys(m.fields || {});

/**
 * The server rejects a batch in which two changes to one entity touch the same field
 * (OVERLAPPING_BATCH_PATCH). That happens when an edit is queued while an earlier edit of
 * the same lift is in flight or being re-based. Per entity, oldest first:
 * - an older edit whose fields are all carried by the newest edit is superseded (dropped):
 *   the newest one holds the final values and was based on the older one's result;
 * - of the rest, edits that overlap one already in this batch wait for the next sync.
 * Order is by `updated_at`, since mutation ids are random and IndexedDB returns key order.
 */
export function planSyncBatch(pending: SyncMutation[]): {
  send: SyncMutation[]; superseded: SyncMutation[]; deferred: SyncMutation[];
} {
  const groups = new Map<string, SyncMutation[]>();
  for (const m of pending) {
    const list = groups.get(scopeOf(m)) ?? [];
    list.push(m);
    groups.set(scopeOf(m), list);
  }
  const superseded = new Set<SyncMutation>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
    const newest = list[list.length - 1];
    const newestKeys = new Set(fieldKeys(newest));
    for (const older of list.slice(0, -1)) {
      // Only a strictly older edit is dropped; on a tie the order is unknown, so keep both
      // (the overlap rule below then sends one and holds the other).
      if (String(older.updated_at) < String(newest.updated_at)
        && fieldKeys(older).every((key) => newestKeys.has(key))) superseded.add(older);
    }
  }
  const ordered = [...pending]
    .filter((m) => !superseded.has(m))
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  const seen = new Map<string, Set<string>>();
  const send: SyncMutation[] = [];
  const deferred: SyncMutation[] = [];
  for (const m of ordered) {
    const keys = seen.get(scopeOf(m)) ?? new Set<string>();
    if (fieldKeys(m).some((key) => keys.has(key))) {
      deferred.push(m);
      continue;
    }
    for (const key of fieldKeys(m)) keys.add(key);
    seen.set(scopeOf(m), keys);
    send.push(m);
  }
  return { send, superseded: [...superseded], deferred };
}

const syncRuns = new Map<string, Promise<any[]>>();
const syncRerun = new Set<string>();

/**
 * One sync request per session at a time. A second request would wait on the server lock
 * and then fail the lift's exact version check against the first one's write. Edits made
 * meanwhile stay PENDING (and coalesce); the session syncs again once the run finishes.
 */
export async function processSyncQueue(workout_id: string, accountId?: string): Promise<any[]> {
  if (workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID) {
    return processInsightCardSync(accountId);
  }
  if (syncRuns.has(workout_id)) {
    syncRerun.add(workout_id);
    return [];
  }
  const run = runSyncQueue(workout_id, accountId);
  syncRuns.set(workout_id, run);
  try {
    return await run;
  } finally {
    syncRuns.delete(workout_id);
    if (syncRerun.delete(workout_id) && typeof window !== 'undefined') scheduleSync(workout_id, accountId);
  }
}

async function runSyncQueue(workout_id: string, accountId?: string): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const pendingAll = await getPendingMutations(undefined, accountId);
  const { send: pending, superseded, deferred } = planSyncBatch(mutationsForWorkout(pendingAll, workout_id));
  for (const m of superseded) await deleteSupersededMutation(m.mutation_id, m.updated_at);
  if (pending.length === 0) return [];

  const payload = {
    schema_version: 1,
    mutation_type: 'workout',
    client_device_id: getDeviceId(),
    workout_id,
    last_updated_at: new Date().toISOString(),
    math_version: MATH_VERSION,
    changes: pending.map(m => ({
      entity: m.entity_type,
      id: m.entity_id,
      mutation_id: m.mutation_id,
      updated_at: m.updated_at,
      ...(m.base_revision !== undefined ? { base_revision: m.base_revision } : {}),
      ...(m.base_fields !== undefined ? { base_fields: m.base_fields } : {}),
      fields: m.fields
    }))
  };

  const conflicts = await postSync(`${BACKEND_URL}/api/workouts/${workout_id}/sync`, payload, pending, workout_id);
  // Edits held back to avoid an overlapping batch go out on the next run.
  if (deferred.length > 0 && typeof window !== 'undefined') scheduleSync(workout_id, accountId);
  return conflicts;
}

/** Flush preserved queues after online recovery or an authenticated sign-in. */
export async function processPendingQueues(accountId?: string): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
  const pending = await getPendingMutations(undefined, accountId);
  const conflicts: any[] = [];
  if (pending.some(isInsightCardMutation)) {
    conflicts.push(...await processInsightCardSync(accountId));
  }
  const workoutIds = [...new Set(
    pending.filter(m => !isInsightCardMutation(m)).map(m => m.workout_id).filter(Boolean),
  )] as string[];
  for (const workoutId of workoutIds) conflicts.push(...await processSyncQueue(workoutId, accountId));
  return conflicts;
}
