import { describe, expect, it } from 'vitest';
import { applyServerFields, isMutationCleanupEligible, legacyStoreAdditions, type SyncMutation } from './db';

describe('legacy IndexedDB merge', () => {
  it('copies a queued mutation even when the new database already has snapshots', () => {
    const oldMutation = {
      mutation_id: 'legacy-mutation-1', client_device_id: 'legacy-device-1',
      workout_id: 'legacy-workout-1', entity_type: 'ExerciseSet', entity_id: 'legacy-set-1',
      field_path: 'ALL', fields: { actual: 95, reps: 5, executedRpe: 8 },
      updated_at: '2026-09-01T12:00:00.000Z', status: 'IN_FLIGHT', retry_count: 1,
    };
    const additions = legacyStoreAdditions('mutations', [oldMutation], []);
    expect(additions).toEqual([oldMutation]);
    expect(legacyStoreAdditions('mutations', [oldMutation], [oldMutation])).toEqual([]);
  });

  it('fails closed on conflicting same-key queue rows so the legacy database can be recovered', () => {
    const oldMutation = { mutation_id: 'same-id', fields: { actual: 95 }, status: 'PENDING' };
    const newMutation = { mutation_id: 'same-id', fields: { actual: 100 }, status: 'ACKED' };
    expect(() => legacyStoreAdditions('mutations', [oldMutation], [newMutation]))
      .toThrow('Conflicting mutations record same-id');
  });

  it('unions tombstones and preserves nonconflicting metadata rows', () => {
    expect(legacyStoreAdditions('tombstones', [{ id: 'workout:gone', deleted_at: '2026-01-01' }], []))
      .toHaveLength(1);
    expect(legacyStoreAdditions('metadata', [{ key: 'last_sync', value: 'yesterday' }], [{ key: 'device', value: 'd1' }]))
      .toEqual([{ key: 'last_sync', value: 'yesterday' }]);
  });
});

it('retains conflicted edits beyond 28 days and starts resolved retention at explicit resolution', () => {
  const cutoff = new Date('2026-10-10T00:00:00Z');
  const mutation = { updated_at: '2026-09-01T00:00:00Z', status: 'CONFLICTED' } as SyncMutation;
  expect(isMutationCleanupEligible(mutation, cutoff)).toBe(false);
  expect(isMutationCleanupEligible({ ...mutation, status: 'RESOLVED_SERVER' }, cutoff)).toBe(false);
  expect(isMutationCleanupEligible({ ...mutation, status: 'RESOLVED_SERVER', resolved_at: '2026-09-01T00:00:00Z' }, cutoff)).toBe(true);
});

it('restores the authorized server state for a kept set conflict and removes a server tombstone', () => {
  const snapshot = [{ workouts: [{
    id: 'workout-1', exercises: [{ id: 'exercise-1', sets: [
      { id: 'set-1', actual: 100 }, { id: 'set-2', actual: 80 },
    ] }],
  }] }];
  const base = {
    mutation_id: 'mutation-1', client_device_id: 'device-1', workout_id: 'workout-1',
    entity_type: 'ExerciseSet', entity_id: 'set-1', field_path: 'ALL', fields: { actual: 95 },
    updated_at: '2026-10-01T00:00:00Z', status: 'CONFLICTED', retry_count: 0,
  } as SyncMutation;
  const refreshed = applyServerFields(snapshot, {
    ...base, conflict: { server_revision: 3, server_fields: { actual: 110 } },
  });
  expect(refreshed[0].workouts[0].exercises[0].sets).toEqual([
    { id: 'set-1', actual: 110, revision: 3 }, { id: 'set-2', actual: 80 },
  ]);
  const tombstoned = applyServerFields(snapshot, {
    ...base, conflict: { reason: 'TOMBSTONE_CONFLICT' },
  });
  expect(tombstoned[0].workouts[0].exercises[0].sets).toEqual([{ id: 'set-2', actual: 80 }]);
});
