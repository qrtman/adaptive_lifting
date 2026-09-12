import { SyncMutation, saveMutation, getPendingMutations, updateMutationStatus } from './db';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';

let syncTimeout: number | null = null;
const SYNC_DEBOUNCE_MS = 2000;

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:8000';

export const LOCK_SYNC_CODES = new Set(['WORKOUT_LOCKED']);

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
  return pending.filter((m) => m.workout_id === workout_id);
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

export async function processSyncQueue(workout_id: string): Promise<any[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
  
  const pendingAll = await getPendingMutations();
  const pending = mutationsForWorkout(pendingAll, workout_id);
  if (pending.length === 0) return [];
  
  const payload = {
    schema_version: 1,
    client_device_id: getDeviceId(),
    workout_id,
    last_updated_at: new Date().toISOString(),
    changes: pending.map(m => ({
      entity: m.entity_type,
      id: m.entity_id,
      mutation_id: m.mutation_id,
      updated_at: m.updated_at,
      fields: m.fields
    }))
  };
  
  try {
    for (const m of pending) await updateMutationStatus(m.mutation_id, 'IN_FLIGHT');
    
    const response = await fetch(`${BACKEND_URL}/api/workouts/${workout_id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const result = await response.json();
      
      for (const id of result.accepted_mutation_ids || []) {
        await updateMutationStatus(id, 'ACKED');
      }
      for (const id of result.rejected_mutations || []) {
        await updateMutationStatus(id, 'REJECTED');
      }
      
      return result.conflicts || [];
    } else if (response.status === 409) {
      const err = await response.json().catch(() => ({}));
      const code = parseSyncErrorCode(err) || '409_CONFLICT';
      const message = parseSyncErrorMessage(err, 'This workout is locked right now.');
      // Keep the queue visible. A lock is not a discarded conflict.
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
      if (isLockSyncCode(code) || code === '409_CONFLICT') {
        window.dispatchEvent(new CustomEvent('sync-lock', {
          detail: { workout_id, code: code === '409_CONFLICT' ? 'WORKOUT_LOCKED' : code, message },
        }));
        return [];
      }
      return [{ reason: code, workout_id, message }];
    } else {
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
    }
  } catch (err) {
    for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
  }
  return [];
}
