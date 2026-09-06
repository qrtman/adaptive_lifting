import { SyncMutation, saveMutation, getPendingMutations, updateMutationStatus } from './db';
import { UI_KEYS, getUiPref, setUiPref } from '../storage/uiPrefs';

let syncTimeout: number | null = null;
const SYNC_DEBOUNCE_MS = 2000;

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
  if (!navigator.onLine) return []; // Wait until online
  
  const pending = await getPendingMutations();
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
    
    const response = await fetch(`http://localhost:8000/api/workouts/${workout_id}/sync`, {
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
      const err = await response.json();
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'REJECTED');
      return [{ reason: err?.error?.code || '409_CONFLICT' }];
    } else {
      for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
    }
  } catch (err) {
    for (const m of pending) await updateMutationStatus(m.mutation_id, 'PENDING');
  }
  return [];
}
