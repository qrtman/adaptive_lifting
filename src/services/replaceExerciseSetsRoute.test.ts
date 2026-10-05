import { describe, expect, it } from 'vitest';
import { ApiError } from '../../supabase/functions/_shared/errors/mod.ts';
import {
  handleReplaceExerciseSets,
  parseReplaceExerciseSetsInput,
} from '../../supabase/functions/_shared/replaceExerciseSetsRoute.ts';

describe('Set replacement request contract', () => {
  it('requires an array but permits an empty complete replacement', () => {
    expect(() => parseReplaceExerciseSetsInput({})).toThrow(ApiError);
    expect(() => parseReplaceExerciseSetsInput({ sets: null })).toThrow(ApiError);
    expect(() => parseReplaceExerciseSetsInput({ sets: 'bad' })).toThrow(ApiError);
    expect(parseReplaceExerciseSetsInput({ sets: [] })).toEqual([]);
  });

  it('keeps stable defaults, ignores unknown row keys, and coerces numeric strings', () => {
    expect(parseReplaceExerciseSetsInput({ sets: [{
      id: null,
      plannedWeight: '182.5',
      plannedReps: '3',
      plannedRpe: 8.5,
      actual: '180',
      reps: 3,
      target_value: 99,
    }] })).toEqual([{
      id: null, label: null, scope: 'both', plannedWeight: 182.5,
      plannedReps: 3, plannedRpe: 8.5, intensityType: null, isAuto: false,
      isTop: null, actual: 180, reps: 3, executedRpe: null, dropPercent: null,
    }]);
  });

  it('rejects invalid numbers and fractional integer fields', () => {
    for (const row of [
      { plannedWeight: 'heavy' },
      { plannedReps: '5.5' },
      { reps: 2.25 },
      { executedRpe: {} },
      { isAuto: null },
      { isTop: 'maybe' },
    ]) {
      expect(() => parseReplaceExerciseSetsInput({ sets: [row] })).toThrow(ApiError);
    }
  });

  it('matches the existing session numeric and boolean coercion contract', () => {
    expect(parseReplaceExerciseSetsInput({ sets: [{
      plannedWeight: true,
      plannedReps: 5.0,
      reps: false,
      isAuto: 't',
      isTop: 'off',
    }] })).toEqual([{
      id: null, label: null, scope: 'both', plannedWeight: 1,
      plannedReps: 5, plannedRpe: null, intensityType: null,
      isAuto: true, isTop: false, actual: null, reps: 0,
      executedRpe: null, dropPercent: null,
    }]);
  });

  it('calls only the narrow replacement RPC and returns its exact exercise object', async () => {
    let query = '';
    let params: unknown[] = [];
    const exercise = { id: 'e-1', title: 'Squat', sets: [] };
    const db = { connect: async () => ({
      queryObject: async (sql: string, values: unknown[]) => {
        query = sql;
        params = values;
        return { rows: [{ payload: { denial: null, exercise } }] };
      },
      release: () => undefined,
    }) } as any;
    const principal = { user: { id: 'athlete' }, sessionId: 'app-session' } as any;
    const config = { enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3 } as any;
    const response = await handleReplaceExerciseSets(
      new Request('https://local/api/sessions/w-1/exercises/e-1/sets', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [{ id: 's-client', plannedWeight: 180 }] }),
      }), 'w-1', 'e-1', db, principal, config,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(exercise);
    expect(query).toContain('al_private.al_session_replace_exercise_sets');
    expect(params).toEqual([
      'athlete', 'app-session', 'w-1', 'e-1', false, 3,
      JSON.stringify([{
        id: 's-client', label: null, scope: 'both', plannedWeight: 180,
        plannedReps: null, plannedRpe: null, intensityType: null,
        isAuto: false, isTop: null, actual: null, reps: null,
        executedRpe: null, dropPercent: null,
      }]),
    ]);
  });

  it('maps tombstone and cross-Exercise Set conflicts without exposing another Exercise', async () => {
    const principal = { user: { id: 'athlete' }, sessionId: 'app-session' } as any;
    const config = { enforceLegacyEmailVerification: false, analyticsPastDueGraceDays: 3 } as any;
    for (const [denial, status, detail] of [
      ['tombstoned_set', 409, { code: 'TOMBSTONE_CONFLICT', message: 'Deleted sets cannot be restored.' }],
      ['set_id_owned_elsewhere', 404, 'Set not found'],
    ] as const) {
      const db = { connect: async () => ({
        queryObject: async () => ({ rows: [{ payload: { denial } }] }),
        release: () => undefined,
      }) } as any;
      await expect(handleReplaceExerciseSets(
        new Request('https://local/api/sessions/w-1/exercises/e-1/sets', {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sets: [] }),
        }), 'w-1', 'e-1', db, principal, config,
      )).rejects.toMatchObject({ status, detail });
    }
  });
});
