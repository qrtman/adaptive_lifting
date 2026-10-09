import { describe, expect, it } from 'vitest';
import { legacyStoreAdditions } from './db';

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
