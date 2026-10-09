import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncMutation } from './db';
import { MATH_VERSION } from './mathEngine';
import legacyQueue from './fixtures/legacy-offline-queue-v1.json';
import {
  isInsightCardMutation,
  isLockSyncCode,
  mutationsForInsightCards,
  mutationsForWorkout,
  parseSyncErrorCode,
  parseSyncErrorMessage,
} from './sync_engine';

function insightMut(entity_id: string, workout_id?: string): SyncMutation {
  return {
    mutation_id: `mut-${entity_id}`,
    client_device_id: 'dev-1',
    workout_id,
    entity_type: 'InsightCard',
    entity_id,
    field_path: 'ALL',
    fields: { name: 'Card' },
    updated_at: '2026-09-12T00:00:00Z',
    status: 'PENDING',
    retry_count: 0,
  };
}

function mut(workout_id: string, entity_id: string): SyncMutation {
  return {
    mutation_id: `mut-${entity_id}`,
    client_device_id: 'dev-1',
    workout_id,
    entity_type: 'Exercise',
    entity_id,
    field_path: 'ALL',
    fields: { sets: [] },
    updated_at: '2026-09-12T00:00:00Z',
    status: 'PENDING',
    retry_count: 0,
  };
}

describe('sync queue workout scoping', () => {
  it('sends only mutations for the target workout_id', () => {
    const mixed = [mut('w-a', 'ex-1'), mut('w-b', 'ex-2'), mut('w-a', 'ex-3')];
    const scoped = mutationsForWorkout(mixed, 'w-a');
    expect(scoped.map((m) => m.entity_id)).toEqual(['ex-1', 'ex-3']);
    expect(scoped.every((m) => m.workout_id === 'w-a')).toBe(true);
  });

  it('keeps InsightCard rows out of workout flush and off the sentinel', () => {
    const mixed = [mut('w-a', 'ex-1'), insightMut('card-1'), insightMut('card-2', 'insight-cards')];
    expect(mutationsForWorkout(mixed, 'w-a').map((m) => m.entity_id)).toEqual(['ex-1']);
    expect(mutationsForInsightCards(mixed).map((m) => m.entity_id)).toEqual(['card-1', 'card-2']);
    expect(mixed.filter(isInsightCardMutation).every((m) => m.entity_type === 'InsightCard')).toBe(true);
  });

  it('parses FastAPI WORKOUT_LOCKED envelopes', () => {
    const body = { detail: { error: { code: 'WORKOUT_LOCKED', message: 'This workout is locked right now.' } } };
    expect(parseSyncErrorCode(body)).toBe('WORKOUT_LOCKED');
    expect(parseSyncErrorMessage(body, 'fallback')).toBe('This workout is locked right now.');
    expect(isLockSyncCode(parseSyncErrorCode(body))).toBe(true);
  });

  it('does not treat WORKOUT_MISMATCH as a lock', () => {
    expect(isLockSyncCode('WORKOUT_MISMATCH')).toBe(false);
    expect(parseSyncErrorCode({ error: { code: 'WORKOUT_MISMATCH' } })).toBe('WORKOUT_MISMATCH');
  });
});

describe('processSyncQueue mixed payload', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('never posts entities from other workouts', async () => {
    const updateMutationStatus = vi.fn(async () => {});
    vi.doMock('./db', () => ({
      getPendingMutations: async () => [mut('w-a', 'ex-1'), mut('w-b', 'ex-2'), insightMut('card-1')],
      updateMutationStatus,
      saveMutation: vi.fn(),
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'dev-test',
      setUiPref: () => {},
    }));

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted_mutation_ids: ['mut-ex-1'], rejected_mutations: [], conflicts: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });

    const { processSyncQueue } = await import('./sync_engine');
    const conflicts = await processSyncQueue('w-a');
    expect(conflicts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const posted = JSON.parse(requestInit.body);
    expect(posted.workout_id).toBe('w-a');
    expect(posted.mutation_type).toBe('workout');
    expect(posted.math_version).toBe(MATH_VERSION);
    expect(posted.changes).toHaveLength(1);
    expect(posted.changes[0].id).toBe('ex-1');
  });

  it('persists the first server baseline through offline coalescing and sync retry', async () => {
    const queue: SyncMutation[] = [];
    const saveMutation = vi.fn(async (mutation: SyncMutation) => {
      const index = queue.findIndex(row => row.mutation_id === mutation.mutation_id);
      if (index < 0) queue.push(mutation); else queue[index] = mutation;
    });
    const updateMutationStatus = vi.fn(async (id: string, status: string) => {
      const row = queue.find(item => item.mutation_id === id);
      if (row) row.status = status as SyncMutation['status'];
    });
    vi.doMock('./db', () => ({
      getPendingMutations: async (workoutId?: string) => queue.filter(row => row.status === 'PENDING' && (!workoutId || row.workout_id === workoutId)),
      updateMutationStatus,
      saveMutation,
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'device-a', setUiPref: () => {},
    }));
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: vi.fn(), dispatchEvent: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ accepted_mutation_ids: [queue[0]?.mutation_id], conflicts: [], math_version: MATH_VERSION }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { queueMutation, processSyncQueue } = await import('./sync_engine');
    await queueMutation('w-a', 'ExerciseSet', 'set-1', { actual: 100 }, {
      revision: 3, fields: { actual: 90 }, snapshot_key: 'microcycles:athlete-a',
    });
    const mutationId = queue[0].mutation_id;
    await queueMutation('w-a', 'ExerciseSet', 'set-1', { reps: 5 }, {
      revision: 4, fields: { actual: 100, reps: 3 }, snapshot_key: 'microcycles:athlete-a',
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      mutation_id: mutationId, fields: { actual: 100, reps: 5 }, base_revision: 3,
      base_fields: { actual: 90 }, snapshot_key: 'microcycles:athlete-a',
    });
    await processSyncQueue('w-a');
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const posted = JSON.parse(requestInit.body);
    expect(posted.changes[0]).toMatchObject({ mutation_id: mutationId, base_revision: 3, base_fields: { actual: 90 } });
    expect(queue[0].status).toBe('ACKED');
  });

  it('posts insight_card mutations without a workout_id', async () => {
    const updateMutationStatus = vi.fn(async () => {});
    vi.doMock('./db', () => ({
      getPendingMutations: async () => [insightMut('card-1'), mut('w-a', 'ex-1'), insightMut('card-2', 'insight-cards')],
      updateMutationStatus,
      saveMutation: vi.fn(),
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'dev-test',
      setUiPref: () => {},
    }));

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted_mutation_ids: ['mut-card-1', 'mut-card-2'], rejected_mutation_ids: [], conflicts: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });

    const { processInsightCardSync } = await import('./sync_engine');
    const conflicts = await processInsightCardSync();
    expect(conflicts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain('/api/insight-cards/sync');
    const posted = JSON.parse(requestInit.body);
    expect(posted.mutation_type).toBe('insight_card');
    expect(posted.workout_id).toBeUndefined();
    expect(posted.math_version).toBe(MATH_VERSION);
    expect(posted.changes.map((c: { id: string }) => c.id)).toEqual(['card-1', 'card-2']);
  });

  it('acknowledges accepted card mutations and rejects returned per-mutation IDs', async () => {
    const updateMutationStatus = vi.fn(async () => {});
    vi.doMock('./db', () => ({
      getPendingMutations: async () => [insightMut('card-1'), insightMut('card-2', 'insight-cards')],
      updateMutationStatus,
      saveMutation: vi.fn(),
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'dev-test',
      setUiPref: () => {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        accepted_mutation_ids: ['mut-card-1'],
        rejected_mutation_ids: ['mut-card-2'],
        math_version: MATH_VERSION,
      }),
    })));
    vi.stubGlobal('navigator', { onLine: true });

    const { processInsightCardSync } = await import('./sync_engine');
    expect(await processInsightCardSync()).toEqual([]);
    expect(updateMutationStatus).toHaveBeenCalledWith('mut-card-1', 'IN_FLIGHT');
    expect(updateMutationStatus).toHaveBeenCalledWith('mut-card-2', 'IN_FLIGHT');
    expect(updateMutationStatus).toHaveBeenCalledWith('mut-card-1', 'ACKED');
    expect(updateMutationStatus).toHaveBeenCalledWith('mut-card-2', 'REJECTED');
  });

  it('surfaces WORKOUT_LOCKED without a false conflict card payload', async () => {
    const updateMutationStatus = vi.fn(async () => {});
    vi.doMock('./db', () => ({
      getPendingMutations: async () => [mut('w-locked', 'ex-1')],
      updateMutationStatus,
      saveMutation: vi.fn(),
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'dev-test',
      setUiPref: () => {},
    }));

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: { error: { code: 'WORKOUT_LOCKED', message: 'This workout is locked right now.' } } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });
    const dispatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatch });

    const { processSyncQueue } = await import('./sync_engine');
    const conflicts = await processSyncQueue('w-locked');
    expect(conflicts).toEqual([]);
    expect(updateMutationStatus).toHaveBeenCalledWith('mut-ex-1', 'PENDING');
    expect(dispatch).toHaveBeenCalled();
    const event = dispatch.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('sync-lock');
    expect(event.detail.code).toBe('WORKOUT_LOCKED');
  });
});

describe('legacy offline queue recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('retains an in-flight schema-v1 mutation through reauthentication and parks its unbased edit for review', async () => {
    const queue = structuredClone(legacyQueue) as unknown as SyncMutation[];
    const updateMutationStatus = vi.fn(async (id: string, status: string) => {
      const row = queue.find(m => m.mutation_id === id);
      if (row) row.status = status as SyncMutation['status'];
    });
    const updateMutationConflict = vi.fn(async (id: string, conflict: Record<string, any>) => {
      const row = queue.find(m => m.mutation_id === id);
      if (row) { row.status = 'CONFLICTED'; row.conflict = conflict; }
    });
    vi.doMock('./db', () => ({
      getPendingMutations: async () => queue.filter(m => m.status === 'PENDING' || m.status === 'IN_FLIGHT'),
      updateMutationStatus,
      updateMutationConflict,
      clearSnapshot: vi.fn(async () => {}),
      getSnapshot: vi.fn(async () => null),
      saveSnapshot: vi.fn(async () => {}),
    }));
    vi.doMock('../storage/uiPrefs', () => ({
      UI_KEYS: { deviceId: 'al_client_device_id' },
      getUiPref: () => 'fixture-device-001',
      setUiPref: () => {},
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: 'Session expired' }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: { error: {
        code: 'SYNC_CONFLICT_REVIEW', message: 'Review this old edit.', details: { accepted_mutation_ids: [], conflicts: [{
          mutation_id: 'legacy-replay-set-001', entity_type: 'ExerciseSet', entity_id: 'fixture-set-active',
          reason: 'BASELINE_REQUIRED', server_revision: 2, server_fields: { actual: 95 },
        }] },
      } } }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });

    const { processPendingQueues } = await import('./sync_engine');
    expect(await processPendingQueues()).toEqual([]);
    expect(queue[0].status).toBe('PENDING');
    const conflicts = await processPendingQueues();
    expect(conflicts[0]).toMatchObject({ reason: 'BASELINE_REQUIRED', entity_id: 'fixture-set-active' });
    expect(queue[0].status).toBe('CONFLICTED');
    expect(queue[0].fields).toEqual({ actual: 92.5, reps: 5, executedRpe: 8 });
    expect(queue[0].conflict?.server_fields).toEqual({ actual: 95 });
    expect(await processPendingQueues()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const posted = JSON.parse(requestInit.body);
    expect(posted).toMatchObject({
      schema_version: 1, mutation_type: 'workout', workout_id: 'fixture-workout-active',
      math_version: MATH_VERSION,
    });
    expect(posted.changes[0]).toMatchObject({
      entity: 'ExerciseSet', id: 'fixture-set-active',
      mutation_id: 'legacy-replay-set-001', fields: { actual: 92.5, reps: 5, executedRpe: 8 },
    });
    expect(posted.changes[0].base_revision).toBeUndefined();
  });
});
