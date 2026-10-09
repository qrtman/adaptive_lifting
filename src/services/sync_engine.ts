import { clearAuthorization } from './authAuthorization';
import { SyncMutation, saveMutation, getPendingMutations, updateMutationStatus, updateMutationConflict } from './db';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';
import { MATH_VERSION } from './mathEngine';
import { API_BASE_URL } from './apiBase';

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
  if (entity_type === 'InsightCard' || workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID) {
    await queueInsightCardMutation(entity_id, fields);
    return;
  }
  const prior = (await getPendingMutations(workout_id)).find(m =>
    m.entity_type === entity_type && m.entity_id === entity_id && m.status === 'PENDING'
  );
  if (prior) {
    prior.fields = entity_type === 'Exercise' ? fields : { ...prior.fields, ...fields };
    // Keep the first server-observed baseline for this coalesced local edit.
    prior.base_revision ??= baseline.revision;
    prior.base_fields ??= baseline.fields;
    prior.snapshot_key ??= baseline.snapshot_key;
    prior.updated_at = new Date().toISOString();
    await saveMutation(prior);
    scheduleSync(workout_id);
    return;
  }
  const mut: SyncMutation = {
    mutation_id: generateMutationId(),
    client_device_id: getDeviceId(),
    workout_id,
    entity_type,
    entity_id,
    field_path: 'ALL',
    fields,
    base_revision: baseline.revision,
    base_fields: baseline.fields,
    snapshot_key: baseline.snapshot_key,
    updated_at: new Date().toISOString(),
    status: 'PENDING',
    retry_count: 0
  };

  await saveMutation(mut);
  scheduleSync(workout_id);
}

export async function queueInsightCardMutation(entity_id: string, fields: Record<string, any>) {
  const mut: SyncMutation = {
    mutation_id: generateMutationId(),
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
  scheduleInsightCardSync();
}

function scheduleSync(workout_id: string) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = window.setTimeout(async () => {
    syncTimeout = null;
    const conflicts = await processSyncQueue(workout_id);
    if (conflicts && conflicts.length > 0) {
      window.dispatchEvent(new CustomEvent('sync-conflicts', { detail: conflicts }));
    }
  }, SYNC_DEBOUNCE_MS);
}

function scheduleInsightCardSync() {
  if (insightSyncTimeout) {
    clearTimeout(insightSyncTimeout);
  }
  insightSyncTimeout = window.setTimeout(async () => {
    insightSyncTimeout = null;
    const conflicts = await processInsightCardSync();
    if (conflicts && conflicts.length > 0) {
      window.dispatchEvent(new CustomEvent('sync-conflicts', { detail: conflicts }));
    }
  }, SYNC_DEBOUNCE_MS);
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
        const conflicts = Array.isArray(details.conflicts) ? details.conflicts : [];
        const acceptedIds = Array.isArray(details.accepted_mutation_ids) ? details.accepted_mutation_ids : [];
        for (const id of acceptedIds) await updateMutationStatus(id, 'ACKED');
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

export async function processInsightCardSync(): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const pending = mutationsForInsightCards(await getPendingMutations());
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

export async function processSyncQueue(workout_id: string): Promise<any[]> {
  if (workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID) {
    return processInsightCardSync();
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const pendingAll = await getPendingMutations();
  const pending = mutationsForWorkout(pendingAll, workout_id);
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

  return postSync(`${BACKEND_URL}/api/workouts/${workout_id}/sync`, payload, pending, workout_id);
}

/** Flush preserved queues after online recovery or an authenticated sign-in. */
export async function processPendingQueues(): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
  const pending = await getPendingMutations();
  const conflicts: any[] = [];
  if (pending.some(isInsightCardMutation)) {
    conflicts.push(...await processInsightCardSync());
  }
  const workoutIds = [...new Set(
    pending.filter(m => !isInsightCardMutation(m)).map(m => m.workout_id).filter(Boolean),
  )] as string[];
  for (const workoutId of workoutIds) conflicts.push(...await processSyncQueue(workoutId));
  return conflicts;
}
