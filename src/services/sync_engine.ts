import { SyncMutation, saveMutation, getPendingMutations, updateMutationStatus } from './db';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';
import { MATH_VERSION } from './mathEngine';
import { warnIfMathVersionMismatch } from './mathVersion';

let syncTimeout: number | null = null;
let insightSyncTimeout: number | null = null;
const SYNC_DEBOUNCE_MS = 2000;

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:8000';

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

export function isLockSyncCode(code: string | null | undefined): boolean {
  return Boolean(code && LOCK_SYNC_CODES.has(code));
}

export async function queueMutation(workout_id: string, entity_type: string, entity_id: string, fields: Record<string, any>) {
  if (entity_type === 'InsightCard' || workout_id === LEGACY_INSIGHT_CARD_WORKOUT_ID) {
    await queueInsightCardMutation(entity_id, fields);
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
      if (warnIfMathVersionMismatch(result.math_version, url)) {
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
      for (const id of result.rejected_mutations || result.rejected_mutation_ids || []) {
        await updateMutationStatus(id, 'REJECTED');
      }

      return result.conflicts || [];
    } else if (response.status === 409) {
      const err = await response.json().catch(() => ({}));
      const code = parseSyncErrorCode(err) || '409_CONFLICT';
      const message = parseSyncErrorMessage(err, 'This workout is locked right now.');
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
      if (code === 'MATH_VERSION_MISMATCH') {
        warnIfMathVersionMismatch(
          (err as { detail?: { error?: { details?: { server?: string } } } })?.detail?.error?.details?.server
            || 'unknown',
          url,
        );
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
      fields: m.fields
    }))
  };

  return postSync(`${BACKEND_URL}/api/workouts/${workout_id}/sync`, payload, pending, workout_id);
}
