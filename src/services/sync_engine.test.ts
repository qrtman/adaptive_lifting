import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncMutation } from './db';
import {
  isLockSyncCode,
  mutationsForWorkout,
  parseSyncErrorCode,
  parseSyncErrorMessage,
} from './sync_engine';

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
      getPendingMutations: async () => [mut('w-a', 'ex-1'), mut('w-b', 'ex-2')],
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
    expect(posted.changes).toHaveLength(1);
    expect(posted.changes[0].id).toBe('ex-1');
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
